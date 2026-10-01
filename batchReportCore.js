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
  // 舊版批次報工送的 report_type（2026-10-01～10-02）。新版改成跟單台同類型（dailyStart／noon／finish），
  // 這個值只留給歷史頁顯示舊資料用。
  const REPORT_TYPE = "batch";
  // 報工類型（owner 2026-10-02「是否也需要今日開工、中午報工、收工完工」）。label／submitLabel／remark 前綴
  // 全部照單台報工 app.js reportTypeMeta，送出的 payload 跟單台同類型逐欄同形（見 buildReportPayload）。
  // 單台的「收工 / 完工」是同一個類型 finish（不會把工序標成完工），所以這裡也只有一個，不另外發明「完工」。
  const MODES = Object.freeze({
    dailyStart: Object.freeze({ key: "dailyStart", label: "今日開工", submitLabel: "送出今日開工", quantity: false }),
    noon: Object.freeze({ key: "noon", label: "中午報工", submitLabel: "送出中午報工", quantity: true }),
    finish: Object.freeze({ key: "finish", label: "收工 / 完工", submitLabel: "送出收工回報", quantity: true }),
  });
  const MODE_ORDER = Object.freeze(["dailyStart", "noon", "finish"]);
  const FINISH_OVERTIME = Object.freeze({ none: "一般下班 17:00", "2030": "加班收工 20:30" });
  // 機台加工時間（每件秒數）上限：擋手滑（一件 24 小時以上的不收）。
  const MAX_MACHINE_SECONDS = 24 * 3600;
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
  //   includeProcessStart=false：今日開工用，跟單台報工 machtileTakeStartedAt 同一套（只看上一次報工＋本機 ledger）；
  //   都沒有＝第一次開工，started_at 不帶（單台也是不帶），這不是錯誤。
  function resolveStartedAt({ serverLastReportAt, localLedgerAt, actualStartAt, endedAt, includeProcessStart = true }) {
    const end = isoOrNull(endedAt);
    if (!end) return { startedAt: null, source: null, reason: "沒有送出時間" };
    const candidates = [
      { at: isoOrNull(serverLastReportAt), source: "lastReport" },
      { at: isoOrNull(localLedgerAt), source: "deviceLedger" },
      { at: includeProcessStart ? isoOrNull(actualStartAt) : null, source: "processStart" },
    ].filter((c) => c.at && c.at <= end);
    if (!candidates.length) {
      return { startedAt: null, source: null, reason: "這台這張單在 App 上還沒有開工或報工紀錄，請先按上方「今日開工」" };
    }
    candidates.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return { startedAt: candidates[0].at, source: candidates[0].source, reason: "" };
  }

  function modeOf(row) {
    return MODES[row?.mode] ? row.mode : "noon";
  }

  // 機台加工時間（分＋秒，跟單台「首次開工」的 Cycle time 欄位同一種填法）→ 每件秒數。
  // 兩格都空白＝沒填（null）。
  function parseMachineTime(minutes, seconds) {
    const m = toInt(minutes);
    const s = toInt(seconds);
    if (m === null && s === null) return { seconds: null, error: "" };
    if (Number.isNaN(m) || Number.isNaN(s)) return { seconds: null, error: "機台加工時間要填整數" };
    const mm = m === null ? 0 : m;
    const ss = s === null ? 0 : s;
    if (!Number.isInteger(mm) || !Number.isInteger(ss)) return { seconds: null, error: "機台加工時間要填整數" };
    if (mm < 0 || ss < 0) return { seconds: null, error: "機台加工時間不能是負的" };
    if (ss > 59) return { seconds: null, error: "機台加工時間的秒數要在 0–59" };
    const total = mm * 60 + ss;
    if (total === 0) return { seconds: null, error: "機台加工時間不能是 0" };
    if (total > MAX_MACHINE_SECONDS) return { seconds: null, error: "機台加工時間超過 24 小時，請確認" };
    return { seconds: total, error: "" };
  }

  function splitSeconds(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return { minutes: "", seconds: "" };
    const t = Math.round(n);
    return { minutes: String(Math.floor(t / 60)), seconds: String(t % 60) };
  }

  // 這次要不要寫機台加工時間：跟預設（這台這張單上一次填的值，ctDefault）不一樣才寫；沒動就不寫（不重寫時間）。
  // 欄位清空＝不寫（不會把時間清掉；要改就填新的值）。
  function machineTimeToSend(row) {
    const parsed = parseMachineTime(row?.ctMinutes, row?.ctSeconds);
    if (parsed.error) return { seconds: null, changed: false, error: parsed.error };
    if (parsed.seconds === null) return { seconds: null, changed: false, error: "" };
    const prev = Number(row?.ctDefault) > 0 ? Math.round(Number(row.ctDefault)) : null;
    if (parsed.seconds === prev) return { seconds: null, changed: false, error: "" };
    return { seconds: parsed.seconds, changed: true, error: "" };
  }

  // 單台報工 Cycle time 欄位以前的 HTML 預設值（9 分 10 秒）。2026-10-02 前單台每一種報工都會把它當成
  // cycle_time_seconds 送出（正式庫 9 筆都是這個值），分不出是不是真的有人填，所以一律不採用。
  // owner 清掉那批資料、且單台修正上線後，可以拿掉這條。
  const LEGACY_DEFAULT_CYCLE_SECONDS = 550;

  // production_reports（cycle_time_seconds 不是 null）→ 每道工序：最新一次填的機台加工時間（秒／件）、
  // 樣本數、歷次平均（至少 2 次才當基準）。550（舊預設值）不算。
  function latestMachineTimeByProcess(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      const sec = Number(r?.cycle_time_seconds);
      if (!r?.process_id || !Number.isFinite(sec) || sec <= 0) return;
      if (Math.round(sec) === LEGACY_DEFAULT_CYCLE_SECONDS) return;
      const at = String(r.created_at || "");
      const key = String(r.process_id);
      const prev = map.get(key) || { seconds: 0, at: "", count: 0, sum: 0 };
      const next = { ...prev, count: prev.count + 1, sum: prev.sum + Math.round(sec) };
      if (!prev.at || at > prev.at) { next.seconds = Math.round(sec); next.at = at; }
      map.set(key, next);
    });
    map.forEach((v) => { v.baselineSeconds = v.count >= 2 ? Math.round(v.sum / v.count) : null; });
    return map;
  }

  // 一列的輸入 → 要不要送／能不能送。
  //   今日開工：有勾＝送（數量 0／0，跟單台今日開工的預設一樣）；沒勾＝不送。第一次開工沒有 started_at 也可以送（同單台）。
  //   中午報工／收工：良品、不良都沒填（或 0）而且機台加工時間沒改＝空白列，不送、不算錯。
  //     只改機台加工時間＝送一筆 0／0 的報工（只帶時間），時段長度 0、接在上一筆後面，不會吃掉工時。
  function validateRow(row) {
    const mode = modeOf(row);
    if (mode === "dailyStart") {
      if (row?.selected !== true) return { send: false, empty: true, error: "" };
      if (!row?.order?.processId || !row?.order?.workOrderId) return { send: false, empty: false, error: "這台目前沒有派工，不能報工" };
      if (!row?.operatorId) return { send: false, empty: false, error: "請選報工人" };
      if (row?.operatorMapped !== true) return { send: false, empty: false, error: "這位報工人還沒對照舊 MES 工號，產值歸不到人" };
      return { send: true, empty: false, error: "", good: 0, bad: 0, machineSeconds: null, timeOnly: false };
    }
    const good = toInt(row?.good);
    const bad = toInt(row?.bad);
    if (Number.isNaN(good) || Number.isNaN(bad)) return { send: false, empty: false, error: "數量要填整數" };
    const goodN = good === null ? 0 : good;
    const badN = bad === null ? 0 : bad;
    const time = machineTimeToSend(row);
    if (goodN === 0 && badN === 0 && !time.error && !time.changed) return { send: false, empty: true, error: "" };
    if (!Number.isInteger(goodN) || !Number.isInteger(badN)) return { send: false, empty: false, error: "數量要填整數" };
    if (goodN < 0 || badN < 0) return { send: false, empty: false, error: "數量不能是負的" };
    if (goodN > MAX_QTY_PER_REPORT || badN > MAX_QTY_PER_REPORT) return { send: false, empty: false, error: `一次最多 ${MAX_QTY_PER_REPORT} 件，請確認有沒有多打 0` };
    if (time.error) return { send: false, empty: false, error: time.error };
    if (!row?.order?.processId || !row?.order?.workOrderId) return { send: false, empty: false, error: "這台目前沒有派工，不能報工" };
    if (!row?.operatorId) return { send: false, empty: false, error: "請選報工人" };
    if (row?.operatorMapped !== true) return { send: false, empty: false, error: "這位報工人還沒對照舊 MES 工號，產值歸不到人" };
    if (!row?.startedAt) return { send: false, empty: false, error: row?.startedAtReason || "沒有開工時間" };
    return { send: true, empty: false, error: "", good: goodN, bad: badN, machineSeconds: time.seconds, timeOnly: goodN === 0 && badN === 0 };
  }

  // 冪等：同一列、同樣的輸入 → 同一個 report_uuid（重複按、送到一半斷線再按都一樣）；
  // 輸入改了才換新的（含類型、機台加工時間、收工是否加班）。送成功（或已進離線待送）後呼叫端清掉這列，下一次就是新的一筆。
  function rowFingerprint(row) {
    const mode = modeOf(row);
    const qty = mode !== "dailyStart";
    return [
      mode,
      normCode(row?.machineCode),
      String(row?.order?.processId || ""),
      qty ? String(toInt(row?.good) ?? 0) : "0",
      qty ? String(toInt(row?.bad) ?? 0) : "0",
      String(row?.operatorId || ""),
      qty ? String(machineTimeToSend(row).seconds ?? "") : "",
      mode === "finish" ? String(row?.overtime || "") : "",
    ].join("|");
  }

  function ensureReportUuid(draft, row, uuidFn) {
    const fp = rowFingerprint(row);
    if (draft && draft.fingerprint === fp && draft.reportUuid) return { reportUuid: draft.reportUuid, fingerprint: fp, reused: true };
    return { reportUuid: uuidFn(), fingerprint: fp, reused: false };
  }

  // 備註：照單台 buildReportRemark（批次畫面沒有備註欄，所以只有前綴＋固定段落）。
  function buildRemark(mode, { machineQty = 0, overtime = "" } = {}) {
    const m = MODES[mode] ? mode : "noon";
    const parts = [`[${MODES[m].label}]`];
    if (m === "dailyStart") {
      parts.push(`機台已加工數量 ${machineQty || 0}`);
      parts.push("首件檢查完成");
    }
    if (m === "finish") parts.push(overtime === "2030" ? FINISH_OVERTIME["2030"] : FINISH_OVERTIME.none);
    return parts.join("；");
  }

  // 一列 → field_report_upsert 的 payload，跟單台報工 submitReport＋machtileSubmitReportViaOutbox 同類型逐欄同形：
  //   tenant_id, work_order_id, process_id, report_date, completed_qty, defect_qty, status_after_report, remark,
  //   user_id, report_type, report_payload{report_type, work_total_qty, cycle_time_seconds, machine_qty,
  //   completed_qty, defect_qty, has_program_upload, overtime_plan, pm_abnormal, abnormal_type},
  //   work_total_qty, cycle_time_seconds, ended_at, started_at（有才帶，同單台）。
  // 跟單台不同、刻意的（PR 內文有對照表）：
  //   - report_date 用台灣日期（單台用 UTC 日期，早上 8 點前會變成前一天）；回寫橋不讀這欄。
  //   - cycle_time_seconds＝這列「機台加工時間」有改才帶，沒改＝null（單台是把隱藏欄位的值每次都送，
  //     沒有基準時就是 HTML 預設 550 秒）。
  //   - 只改機台加工時間（0／0）：started_at＝ended_at＝上一次的時間點，不推進下一筆的起算時間。
  // operators＝這列選的報工人（單工站回寫橋要求剛好一位）。
  function buildReportPayload({ row, actorAppUserId, endedAt, reportUuid, tenantId }) {
    const v = validateRow(row);
    if (!v.send) throw new Error(v.error || "row is not sendable");
    const mode = modeOf(row);
    const order = row.order;
    const machineQty = Number(order.done || 0) || 0;
    const workTotal = Number(order.total || 0) || null;
    const overtime = mode === "finish" ? (row.overtime === "2030" ? "2030" : "none") : "";
    const cycle = v.machineSeconds ?? null;
    const payload = {
      report_uuid: reportUuid,
      tenant_id: tenantId || order.tenantId || undefined,
      work_order_id: order.workOrderId,
      process_id: order.processId,
      report_date: localDate(endedAt),
      completed_qty: v.good,
      defect_qty: v.bad,
      status_after_report: order.processStatus || "running",
      remark: buildRemark(mode, { machineQty, overtime }),
      report_type: mode,
      report_payload: {
        report_type: mode,
        work_total_qty: workTotal,
        cycle_time_seconds: cycle,
        machine_qty: machineQty,
        completed_qty: v.good,
        defect_qty: v.bad,
        has_program_upload: false,
        overtime_plan: overtime,
        pm_abnormal: "",
        abnormal_type: "",
      },
      work_total_qty: workTotal,
      cycle_time_seconds: cycle,
      ended_at: v.timeOnly ? row.startedAt : endedAt,
    };
    if (row.startedAt) payload.started_at = row.startedAt;
    if (!payload.tenant_id) delete payload.tenant_id;
    if (actorAppUserId) payload.user_id = actorAppUserId;
    return { payload, operators: [row.operatorId], timeOnly: v.timeOnly };
  }

  // 舊名稱保留給既有呼叫端：沒帶 mode 的列當中午報工。
  function buildPayload(args) {
    return buildReportPayload(args);
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
    GROUPS, EXCLUDED_MACHINES, REPORT_TYPE, MODES, MODE_ORDER, FINISH_OVERTIME, MAX_QTY_PER_REPORT, STALE_PENDING_MS,
    MAX_MACHINE_SECONDS, parseMachineTime, splitSeconds, machineTimeToSend, buildRemark, buildReportPayload,
    latestMachineTimeByProcess, LEGACY_DEFAULT_CYCLE_SECONDS,
    groupFor, groupForView, machineCodeOf, candidateOrdersForMachine, displayProgress, cardProgress,
    resolveStartedAt, validateRow, rowFingerprint, ensureReportUuid, buildPayload, localDate,
    operatorChoices, defaultOperatorId, summarizeResults,
  };
});
