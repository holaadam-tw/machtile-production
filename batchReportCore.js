// batchReportCore.js — 車床／銑床「批次報工」的純邏輯（owner 2026-10-01「做批次報工」）。
//
// 為什麼存在：回寫橋開到 11 台後，所有報工只在 App 做；一個人顧 5 台車床，一台一台開報工單太慢。
// 批次畫面一台一列，只填「這次的良品／不良」，一次送出＝每台各建一筆報工（沿用單台報工的
// field_report_upsert＋offline outbox，同一個 report_uuid 冪等）。
//
// DOM 與 fetch 留在 app.js；這裡只做可測的決策：
//   - 哪幾台算哪一組（B01/B02 臥式多盤不放進批次，owner 2026-10-01 決定）
//   - 每台目前是哪張單（派工資料，舊 MES 移走的不算）
//   - 已報＝舊 MES 累計＋待回寫（後端 batch_report_progress 已在同一個快照算好，這裡只負責顯示與加總）
//   - started_at 的規則（回寫橋要求合法的開工時間，cycle time 才不會錯）
//   - 驗證、報工人、冪等鍵（report_uuid）、送出 payload
(function attachMachTileBatchReportCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileBatchReportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileBatchReportCore() {
  "use strict";

  // 車床 A01–A05；銑床先只放 B03–B06（B01/B02 是臥式多盤，用現有多盤報工畫面）。
  const GROUPS = Object.freeze({
    lathe: Object.freeze({ key: "lathe", view: "batchLathe", title: "車床報工", machines: Object.freeze(["A01", "A02", "A03", "A04", "A05"]) }),
    mill: Object.freeze({ key: "mill", view: "batchMill", title: "銑床報工", machines: Object.freeze(["B03", "B04", "B05", "B06"]) }),
  });
  const EXCLUDED_MACHINES = Object.freeze(["B01", "B02"]);
  const REPORT_TYPE = "batch";
  // 一次報工的數量上限：擋手滑多打一個 0（不是業務規則；真的超過就分兩次報）。
  const MAX_QTY_PER_REPORT = 100000;
  // 待回寫超過這麼久還沒被回寫橋寫回 → 畫面提醒找管理者（可能被回寫橋擋下）。
  const STALE_PENDING_MS = 2 * 60 * 60 * 1000;

  function groupFor(key) {
    return GROUPS[key] || null;
  }

  function groupForView(view) {
    return Object.values(GROUPS).find((g) => g.view === view) || null;
  }

  function normCode(value) {
    return String(value ?? "").trim().toUpperCase();
  }

  // 卡片上的 machine 是 machines.name；正式庫 name＝machine_code（A01…）。保險起見也接受「A01 小瀧澤」式。
  function machineCodeOf(order) {
    const raw = normCode(order?.machineCode || order?.machine);
    const m = raw.match(/^([A-Z]\d{2})\b/);
    return m ? m[1] : raw;
  }

  const ACTIVE_STATUS_RANK = { running: 0, abnormal: 1, paused: 2, waiting_inspection: 3, pending: 4 };

  // 這台機台目前可報的工單：派工到這台、舊 MES 沒移走、工序沒完工、有工序 id。
  // 排序：加工中的優先 → 交期早的 → 單號。多工站（B03–B06）可能同時掛幾張，畫面讓人選。
  function candidateOrdersForMachine(orders, machineCode) {
    const code = normCode(machineCode);
    return (Array.isArray(orders) ? orders : [])
      .filter((o) => o && machineCodeOf(o) === code && o.offStation !== true && o.processId
        && !["completed", "cancelled"].includes(String(o.processStatus || ""))
        && !["completed", "shipped", "cancelled"].includes(String(o.workStatus || "")))
      .slice()
      .sort((a, b) => {
        const ra = ACTIVE_STATUS_RANK[a.processStatus] ?? 9;
        const rb = ACTIVE_STATUS_RANK[b.processStatus] ?? 9;
        if (ra !== rb) return ra - rb;
        const da = String(a.dueDate || "9999-12-31");
        const db = String(b.dueDate || "9999-12-31");
        if (da !== db) return da < db ? -1 : 1;
        return String(a.id).localeCompare(String(b.id));
      });
  }

  function toInt(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }

  // 已報（顯示用）：後端 batch_report_progress 的一列 → 舊 MES＋待回寫。
  // 後端在同一個 SQL 快照裡判斷「待回寫」＝不在舊 MES 已寫回清單裡的 App 報工，所以兩者相加不會重複。
  // legacy_* 為 null＝舊 MES 這站還沒有結算列（或還沒開同步）：只顯示 App 待回寫，並標示。
  function displayProgress(row, nowMs = Date.now()) {
    if (!row) {
      return { available: false, legacyKnown: false, legacyOutput: 0, legacyFail: 0, pendingOutput: 0, pendingFail: 0,
        pendingCount: 0, totalOutput: 0, totalFail: 0, stalePending: false, syncedAt: null };
    }
    const legacyKnown = row.legacy_output !== null && row.legacy_output !== undefined;
    const legacyOutput = legacyKnown ? Number(row.legacy_output) || 0 : 0;
    const legacyFail = legacyKnown ? Number(row.legacy_fail) || 0 : 0;
    const pendingOutput = Number(row.pending_output) || 0;
    const pendingFail = Number(row.pending_fail) || 0;
    const pendingCount = Number(row.pending_count) || 0;
    const oldest = row.oldest_pending_at ? Date.parse(row.oldest_pending_at) : NaN;
    return {
      available: true,
      legacyKnown,
      legacyOutput,
      legacyFail,
      pendingOutput,
      pendingFail,
      pendingCount,
      totalOutput: legacyOutput + pendingOutput,
      totalFail: legacyFail + pendingFail,
      stalePending: pendingCount > 0 && Number.isFinite(oldest) && nowMs - oldest > STALE_PENDING_MS,
      syncedAt: row.legacy_synced_at || null,
    };
  }

  // Monitor 機台卡片「完成進度」（owner 2026-10-02）：跟批次報工同一套口徑。
  //   有舊 MES 結算列（legacy_output 不是 null）→ 完成數＝舊 MES 已報＋待回寫（displayProgress，同一個 SQL
  //   快照，已寫回的 App 報工只算在舊 MES 那邊，不會重複）。App 自己的累計（appDone）此時不再加進來，
  //   因為已寫回的那部分已經在舊 MES 數字裡、沒寫回的那部分就是待回寫。
  //   沒有結算列／讀不到（row 為 null，例如 RPC 失敗）→ 照原本算法（App 累計），並標「舊 MES 尚無資料」。
  function cardProgress(appDone, row, nowMs = Date.now()) {
    const app = Math.max(0, Number(appDone) || 0);
    const p = displayProgress(row, nowMs);
    if (!p.available || !p.legacyKnown) {
      return { done: app, appDone: app, source: "app", legacyKnown: false, legacyOutput: 0, legacyFail: 0,
        pendingOutput: 0, pendingFail: 0, pendingCount: 0, totalFail: null, label: "舊 MES 尚無資料" };
    }
    return {
      done: p.totalOutput,
      appDone: app,
      source: "legacy",
      legacyKnown: true,
      legacyOutput: p.legacyOutput,
      legacyFail: p.legacyFail,
      pendingOutput: p.pendingOutput,
      pendingFail: p.pendingFail,
      pendingCount: p.pendingCount,
      totalFail: p.totalFail,
      label: p.pendingOutput > 0 ? `含舊 MES・待回寫 ${p.pendingOutput}` : "含舊 MES",
    };
  }

  function isoOrNull(value) {
    if (!value) return null;
    const t = Date.parse(value);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }

  // started_at 規則（回寫橋：started_at 不合法 → 拒收；工時＝ended_at − started_at，cycle time＝工時÷件數）：
  //   started_at ＝ 下列「不晚於這次送出時間」的時間裡最晚的一個：
  //     1. 這道工序在 App 上一次報工的結束時間（任何裝置、任何類型，含開工／暫停；後端 last_report_at）
  //     2. 這台裝置記得的同一道工序上一次報工時間（單台報工的 rolling ledger，可能比伺服器還新：離線待送）
  //     3. 這道工序的開工時間（work_order_processes.actual_start_at）
  //   取最晚＝每一筆報工的時段首尾相接、不重疊，加總等於實際經過時間（跟單台報工同一套）。
  //   都沒有 → 不送，請先用單台畫面「今日開工」（絕不自己編一個開工時間）。
  function resolveStartedAt({ serverLastReportAt, localLedgerAt, actualStartAt, endedAt }) {
    const end = isoOrNull(endedAt);
    if (!end) return { startedAt: null, source: null, reason: "沒有送出時間" };
    const candidates = [
      { at: isoOrNull(serverLastReportAt), source: "lastReport" },
      { at: isoOrNull(localLedgerAt), source: "deviceLedger" },
      { at: isoOrNull(actualStartAt), source: "processStart" },
    ].filter((c) => c.at && c.at <= end);
    if (!candidates.length) {
      return { startedAt: null, source: null, reason: "這台這張單在 App 上還沒有開工或報工紀錄，請先用單台畫面按「今日開工」" };
    }
    candidates.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return { startedAt: candidates[0].at, source: candidates[0].source, reason: "" };
  }

  // 一列的輸入 → 要不要送／能不能送。空白列（良品、不良都沒填或都是 0）＝不送、不算錯。
  function validateRow(row) {
    const good = toInt(row?.good);
    const bad = toInt(row?.bad);
    if (Number.isNaN(good) || Number.isNaN(bad)) return { send: false, empty: false, error: "數量要填整數" };
    const goodN = good === null ? 0 : good;
    const badN = bad === null ? 0 : bad;
    if (goodN === 0 && badN === 0) return { send: false, empty: true, error: "" };
    if (!Number.isInteger(goodN) || !Number.isInteger(badN)) return { send: false, empty: false, error: "數量要填整數" };
    if (goodN < 0 || badN < 0) return { send: false, empty: false, error: "數量不能是負的" };
    if (goodN > MAX_QTY_PER_REPORT || badN > MAX_QTY_PER_REPORT) return { send: false, empty: false, error: `一次最多 ${MAX_QTY_PER_REPORT} 件，請確認有沒有多打 0` };
    if (!row?.order?.processId || !row?.order?.workOrderId) return { send: false, empty: false, error: "這台目前沒有派工，不能報工" };
    if (!row?.operatorId) return { send: false, empty: false, error: "請選報工人" };
    if (row?.operatorMapped !== true) return { send: false, empty: false, error: "這位報工人還沒對照舊 MES 工號，產值歸不到人" };
    if (!row?.startedAt) return { send: false, empty: false, error: row?.startedAtReason || "沒有開工時間" };
    return { send: true, empty: false, error: "", good: goodN, bad: badN };
  }

  // 冪等：同一列、同樣的輸入 → 同一個 report_uuid（重複按、送到一半斷線再按都一樣）；
  // 輸入改了才換新的。送成功（或已進離線待送）後呼叫端清掉這列，下一次就是新的一筆。
  function rowFingerprint(row) {
    return [
      normCode(row?.machineCode),
      String(row?.order?.processId || ""),
      String(toInt(row?.good) ?? 0),
      String(toInt(row?.bad) ?? 0),
      String(row?.operatorId || ""),
    ].join("|");
  }

  function ensureReportUuid(draft, row, uuidFn) {
    const fp = rowFingerprint(row);
    if (draft && draft.fingerprint === fp && draft.reportUuid) return { reportUuid: draft.reportUuid, fingerprint: fp, reused: true };
    return { reportUuid: uuidFn(), fingerprint: fp, reused: false };
  }

  // 一列 → field_report_upsert 的 payload（與單台報工 submitReport 同形；不帶 cycle_time_seconds，
  // 免得把「報工間隔」當成純切削時間灌進工時基準）。operators＝這列選的報工人（單工站回寫橋要求剛好一位）。
  function buildPayload({ row, groupKey, actorAppUserId, endedAt, reportUuid, tenantId }) {
    const v = validateRow(row);
    if (!v.send) throw new Error(v.error || "row is not sendable");
    const group = groupFor(groupKey);
    const payload = {
      report_uuid: reportUuid,
      tenant_id: tenantId || row.order.tenantId || undefined,
      work_order_id: row.order.workOrderId,
      process_id: row.order.processId,
      report_date: localDate(endedAt),
      completed_qty: v.good,
      defect_qty: v.bad,
      status_after_report: row.order.processStatus || "running",
      remark: `[批次報工] ${group ? group.title : ""}`.trim(),
      report_type: REPORT_TYPE,
      report_payload: {
        report_type: REPORT_TYPE,
        batch_group: groupKey,
        machine_code: normCode(row.machineCode),
        completed_qty: v.good,
        defect_qty: v.bad,
        started_at_source: row.startedAtSource || null,
      },
      started_at: row.startedAt,
      ended_at: endedAt,
    };
    if (!payload.tenant_id) delete payload.tenant_id;
    if (actorAppUserId) payload.user_id = actorAppUserId;
    return { payload, operators: [row.operatorId] };
  }

  // report_date 用台灣當地日期（與舊 MES 同一天），不是 UTC 日期。
  function localDate(iso, timeZone = "Asia/Taipei") {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
      const p = (t) => parts.find((x) => x.type === t)?.value || "";
      return `${p("year")}-${p("month")}-${p("day")}`;
    } catch {
      return d.toISOString().slice(0, 10);
    }
  }

  // 報工人候選：有舊 MES 工號對照（legacy_user_id）的人。預設＝登入者（他本人有對照時）；
  // 站別帳號登入就留空，逼人選（同單台報工 F-2 規則）。
  function operatorChoices(users) {
    return (Array.isArray(users) ? users : [])
      .filter((u) => u && u.id && String(u.legacy_user_id ?? "").trim())
      .map((u) => ({ id: u.id, name: u.name || u.id, legacyUserId: String(u.legacy_user_id).trim() }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  }

  function defaultOperatorId(choices, actorAppUserId) {
    return (Array.isArray(choices) ? choices : []).some((c) => c.id === actorAppUserId) ? actorAppUserId : "";
  }

  function summarizeResults(results) {
    const list = Array.isArray(results) ? results : [];
    const count = (s) => list.filter((r) => r.status === s).length;
    return { sent: count("sent"), queued: count("queued"), failed: count("failed"), total: list.length };
  }

  return {
    GROUPS, EXCLUDED_MACHINES, REPORT_TYPE, MAX_QTY_PER_REPORT, STALE_PENDING_MS,
    groupFor, groupForView, machineCodeOf, candidateOrdersForMachine, displayProgress, cardProgress,
    resolveStartedAt, validateRow, rowFingerprint, ensureReportUuid, buildPayload, localDate,
    operatorChoices, defaultOperatorId, summarizeResults,
  };
});
