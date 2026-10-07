// stationCommandCore.js — 機台卡片「開工／停工」回寫舊 MES（第 1 階段，owner 2026-10-07）。
//
// 為什麼存在：作業員在 App 按「開工／停工」要跟電子紙 LabelWork 一樣改到舊 MES（Manufacture State）。
// App 只送一筆「指令」到 Supabase station_commands（machtile_submit_station_command），工廠端
// （Factory 背景服務）核對舊 MES 現況後才套用，結果寫回同一列；App 輪詢那一列顯示結果。
//
// 合約：ops/factory-deploy/2026-10-07-cnc-writeback/CONTRACT_station_commands.md r3（mini-mes #103 head 72728385）。
//   狀態形狀（DB CHECK）：pending＝claimed_*／reject_* 全空；claimed＝有 claimed_at/by；
//   applied／rejected＝有 claimed；expired＝沒有 claimed、reject_code 只能是 EXPIRED。
//   時間：pending 10 分鐘沒人領 → expired（只在下一次 submit/claim 才落地）；claimed 租約 2 分鐘，逾期仍是
//   claimed、會被重新領走；requested_at 起 3 分鐘（max_apply_age）後不能 applied，套用端只能 rejected STALE_COMMAND。
//   MANUAL_RELEASED＝rejected（主管釋放租約已過的 claimed，舊 MES 狀態未知）。
//   LEGACY_APPLIED_LATE＝rejected（r3：舊 MES 其實已改，只是回報太晚）。
//   → App 只依伺服器 status 顯示結果（applied／rejected／expired），自己絕不判「過期／沒生效」。
//     年齡只用伺服器的 requested_at 加「伺服器時鐘差」算，且只拿來加一句提示，不當結果。
//
// 防呆（2026-10-06 事故：作業員報到錯的單）：
//   送出前一定先跳確認卡，大字列出 機台／工單號／料號＋品名／第幾道＋工序名／畫面資料時間的舊 MES 現況，
//   開卡時重讀這一道是否還在這台，作業員要按「確認」才送。第 1 階段不換單：「不是這張單」只叫他找生管。
//
// 旗標：config.stationCommandMachines（陣列，例 ["A04"]；"*"＝全部）。空／沒設＝全部機台關（預設）。
// 表或 RPC 不存在 → 功能整個藏起來（App 跟現在一模一樣）。
//
// DOM 與 fetch 留在 app.js；這裡只做可測的決策與文字。
(function attachMachTileStationCommandCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileStationCommandCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileStationCommandCore() {
  "use strict";

  const COMMAND_TYPES = Object.freeze(["start", "stop"]);
  const TYPE_LABEL = Object.freeze({ start: "開工", stop: "停工" });
  const TERMINAL = Object.freeze(["applied", "rejected", "expired"]);
  // 合約 r2 §2 的伺服器常數（App 只用來寫提示與決定何時停止輪詢，不用來判結果）
  const MAX_APPLY_AGE_MS = 3 * 60 * 1000;      // max_apply_age()
  const CLAIM_LEASE_MS = 2 * 60 * 1000;        // claim_lease()
  const PENDING_EXPIRE_MS = 10 * 60 * 1000;    // expire_stale（寫死 10 分鐘）
  // App 不會自己結束一筆指令：一直輪詢到伺服器給 applied／rejected／expired。
  // 只是在本機經過 10 分鐘＋1 分鐘後解開按鈕（伺服器下一次 submit 會先把 >10 分鐘的 pending 轉成 expired，
  // 所以那時重按不會撞 MACHINE_COMMAND_IN_FLIGHT），輪詢照樣繼續、改 15 秒一次。用本機經過時間（同一個時鐘）。
  const CLIENT_UNLOCK_MS = PENDING_EXPIRE_MS + 60 * 1000;
  // 重新整理後還記得的上限（超過一天的紀錄丟掉）
  const PENDING_KEEP_MS = 24 * 60 * 60 * 1000;
  // 送出 RPC 的逾時（逾時走「不知道有沒有送到」的路，uuid 不變）
  const SUBMIT_TIMEOUT_MS = 20 * 1000;
  const SUBMIT_RPC = "machtile_submit_station_command";
  const MISSING_PART_NO = "未提供";

  function normCode(value) {
    return String(value ?? "").trim().toUpperCase();
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  // ---------------------------------------------------------------- 旗標
  // 接受陣列或逗號字串；"*" ＝全部。其他型別（true、物件…）一律當作關，避免誤開全廠。
  function parseFlag(value) {
    let items = [];
    if (Array.isArray(value)) items = value;
    else if (typeof value === "string") items = value.split(",");
    const codes = items.map(normCode).filter(Boolean);
    return { all: codes.includes("*"), machines: codes.filter((c) => c !== "*") };
  }

  function flagIsOn(flag) {
    return Boolean(flag && (flag.all || (flag.machines && flag.machines.length)));
  }

  function enabledForMachine(flag, machineCode) {
    if (!flagIsOn(flag)) return false;
    const code = normCode(machineCode);
    if (!code) return false;
    return flag.all || flag.machines.includes(code);
  }

  // 舊 MES 多工站（ManufactureII，B01–B06）。第 1 階段派工橋還沒把 ManufactureII.Id 同步上來，
  // 沒有這個 id 的多工站不顯示按鈕（工廠端必須用 Id 才知道是哪一筆）。
  function isMultiStation(machineCode) {
    return /^B\d/.test(normCode(machineCode));
  }

  // 只有作業員帳號能送（合約 §3.1：role=operator、非橋接；套用帳號另有 APPLIER_CANNOT_SUBMIT）。
  function roleAllowed(role, isBridge) {
    return String(role || "").trim().toLowerCase() === "operator" && isBridge !== true;
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  // 卡片要不要出現「開工／停工」：旗標開、作業員、功能可用、有目前工單（含工序 id、單號、第幾道）。
  function eligibility({ flag, role, isBridge, availability, machineCode, order, isUnassignedBucket } = {}) {
    if (!enabledForMachine(flag, machineCode)) return { ok: false, reason: "flag_off" };
    if (!roleAllowed(role, isBridge)) return { ok: false, reason: "not_operator" };
    if (availability !== "ready") return { ok: false, reason: "unavailable" };
    if (isUnassignedBucket) return { ok: false, reason: "no_machine" };
    if (!order) return { ok: false, reason: "no_order" };
    if (order.offStation === true) return { ok: false, reason: "off_station" };
    if (!text(order.id)) return { ok: false, reason: "no_order_no" };
    if (!isUuid(order.processId)) return { ok: false, reason: "no_process" };
    const step = Number(order.stationStep);
    if (!Number.isInteger(step) || step <= 0) return { ok: false, reason: "no_step" };
    if (isMultiStation(machineCode) && !text(order.manufactureIiId)) return { ok: false, reason: "multi_station_unsupported" };
    return { ok: true, reason: "" };
  }

  // ---------------------------------------------------------------- uuid
  // crypto.randomUUID 舊 WebView 沒有 → 用 getRandomValues 組 v4；兩個都沒有 → 丟錯（不出按鈕的責任在呼叫端）
  function newUuid(cryptoObj) {
    const c = cryptoObj || (typeof crypto !== "undefined" ? crypto : null);
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    if (!c || typeof c.getRandomValues !== "function") throw new Error("NO_CRYPTO");
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // ---------------------------------------------------------------- 時間
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatTime(value) {
    if (!value) return "";
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // 「畫面資料（hh:mm）」：同一天只寫時分，不同天加月/日
  function formatHm(value, nowMs) {
    if (!value) return "";
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    const n = new Date(Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now());
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }

  // 伺服器時鐘差：送出 RPC 回來那一刻，新建的列 requested_at＝伺服器 now()。offset＝平板時間－伺服器時間。
  function serverOffset(requestedAt, clientNowMs) {
    const at = Date.parse(requestedAt);
    const now = Number(clientNowMs);
    return Number.isFinite(at) && Number.isFinite(now) ? now - at : null;
  }

  // 指令在伺服器時鐘上的年齡；沒有時鐘差 → null（不判斷）
  function serverAgeMs(requestedAt, offset, clientNowMs) {
    const at = Date.parse(requestedAt);
    if (!Number.isFinite(at) || offset === null || offset === undefined || !Number.isFinite(Number(offset))) return null;
    return Number(clientNowMs) - Number(offset) - at;
  }

  // ---------------------------------------------------------------- 確認卡
  function legacyRowFor(rows, { workOrderNo, machineCode, step }) {
    const list = Array.isArray(rows) ? rows : [];
    const wo = text(workOrderNo);
    const code = normCode(machineCode);
    const n = Number(step);
    return list.find((r) => r && text(r.work_order_no) === wo && normCode(r.machine_code) === code && Number(r.process_order) === n) || null;
  }

  const OPEN_PROCESS_STATUS = Object.freeze(["pending", "running", "abnormal", "waiting_inspection"]);
  const CLOSED_WO_STATUS = Object.freeze(["completed", "shipped", "cancelled"]);

  // 開卡時重讀的 work_order_processes 列（含 work_orders、machines）→ 這一道是不是還掛在這台、道次沒變。
  // 不符就不給送（卡片資料過時），料號只取 work_orders.part_no（不拿圖號頂替）。
  function freshCheck({ order, machineCode, row } = {}) {
    const stale = (reason) => ({ ok: false, reason, text: "畫面上的工單資料已經過時（這一道不在這台、道次變了或已結束），請重新整理畫面再按。" });
    if (!row) return stale("process_not_found");
    const wo = row.work_orders || {};
    const machine = row.machines || {};
    if (row.off_station_at) return stale("off_station");
    if (normCode(machine.machine_code) !== normCode(machineCode)) return stale("machine_changed");
    if (Number(row.process_order) !== Number(order && order.stationStep)) return stale("step_changed");
    if (text(wo.work_order_no) !== text(order && order.id)) return stale("order_changed");
    if (!OPEN_PROCESS_STATUS.includes(text(row.status))) return stale("process_closed");
    if (CLOSED_WO_STATUS.includes(text(wo.status))) return stale("order_closed");
    return {
      ok: true, reason: "", text: "",
      partNo: text(wo.part_no) || null,
      partName: text(wo.part_name),
      operationName: text(row.process_name),
    };
  }

  // 舊 MES 現況：一律寫成「畫面資料（時間）顯示…」，不寫肯定句（資料是派工橋 legacy_snapshot_at 那一刻讀的）。
  function legacyStateLines({ order, legacy, legacyError, nowMs } = {}) {
    const step = Number(order && order.stationStep);
    const at = legacy ? formatHm(legacy.legacy_snapshot_at, nowMs) : "";
    const stamp = `畫面資料（${at || "時間不明"}）`;
    const lines = [];
    lines.push(`${stamp}顯示：舊 MES 這台掛的是這張單的第 ${Number.isInteger(step) && step > 0 ? step : "?"} 道，工廠套用前會再核對`);
    if (legacyError) {
      lines.push("舊 MES 報工數字暫時讀不到");
    } else if (legacy) {
      lines.push(`${stamp}顯示：舊 MES 已報 良品 ${Number(legacy.legacy_output || 0)}、不良 ${Number(legacy.legacy_fail || 0)}`);
      const settled = formatTime(legacy.legacy_updated_at);
      if (settled) lines.push(`舊 MES 最後報工：${settled}`);
    } else {
      lines.push("畫面資料裡這一道還沒有舊 MES 報工數字");
    }
    lines.push("開工中／停工中：派工橋沒有同步，工廠會在套用前再核對");
    return lines;
  }

  function confirmModel({ commandType, machineCode, order, fresh, legacy, legacyError, otherOrderCount, nowMs } = {}) {
    const type = COMMAND_TYPES.includes(commandType) ? commandType : "";
    const step = Number(order && order.stationStep);
    const others = Number(otherOrderCount || 0);
    const f = fresh && fresh.ok ? fresh : null;
    return {
      commandType: type,
      actionLabel: TYPE_LABEL[type] || "",
      title: type ? `確認${TYPE_LABEL[type]}` : "",
      machine: normCode(machineCode),
      workOrderNo: text(order && order.id),
      partNo: f ? (f.partNo || "") : "",
      partNoDisplay: f && f.partNo ? f.partNo : MISSING_PART_NO,
      partName: (f && f.partName) || text(order && order.part),
      stepNo: Number.isInteger(step) && step > 0 ? step : null,
      stepLabel: Number.isInteger(step) && step > 0 ? `第 ${step} 道` : "",
      operationName: (f && f.operationName) || text(order && order.process),
      legacyLines: legacyStateLines({ order, legacy, legacyError, nowMs }),
      otherOrders: others > 0 ? `這台還掛 ${others} 張別的單` : "",
      notThisOrder: "現在做的不是這張？請找生管在舊 MES 換單。App 第一階段不會幫你換單。",
      confirmLabel: type ? `確認${TYPE_LABEL[type]}` : "",
    };
  }

  // ---------------------------------------------------------------- 送出
  // fields：{ commandUuid, commandType, machineCode, orderNo, step, partNo, manufactureIiId }
  // partNo 只能是 work_orders.part_no；沒有就送 null（不拿圖號頂替）。
  function submitPayload({ commandUuid, commandType, machineCode, orderNo, step, partNo, manufactureIiId } = {}) {
    if (!isUuid(commandUuid)) throw new Error("BAD_COMMAND_UUID");
    if (!COMMAND_TYPES.includes(commandType)) throw new Error("BAD_COMMAND_TYPE");
    const code = normCode(machineCode);
    if (!code) throw new Error("NO_MACHINE");
    if (!text(orderNo)) throw new Error("NO_ORDER");
    const n = Number(step);
    if (!Number.isInteger(n) || n <= 0) throw new Error("NO_STEP");
    return {
      p_command_uuid: commandUuid,
      p_command_type: commandType,
      p_machine_code: code,
      p_expected_order_no: text(orderNo),
      p_expected_index_sn: n,
      p_expected_part_no: text(partNo) || null,
      p_manufacture_ii_id: text(manufactureIiId) || null,
    };
  }

  // ---------------------------------------------------------------- 錯誤分類
  // supabaseFetch 丟出的錯誤訊息形如 `404 {"code":"PGRST202",...}`。
  function isMissingResourceError(error) {
    const msg = String((error && error.message) || error || "");
    return /^404\b/.test(msg) || /PGRST20[25]|42P01|42883/.test(msg);
  }

  function isNetworkError(error) {
    const msg = String((error && error.message) || error || "");
    const name = String((error && error.name) || "");
    if (/^\d{3}\b/.test(msg)) return false;
    return name === "AbortError" || name === "TypeError" || /Failed to fetch|NetworkError|Load failed|network|timeout|逾時|abort/i.test(msg);
  }

  function serverMessage(error) {
    const msg = String((error && error.message) || error || "");
    const jsonStart = msg.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const body = JSON.parse(msg.slice(jsonStart));
        return text(body.message || body.hint || body.details || "");
      } catch { /* 不是 JSON */ }
    }
    return msg.replace(/^\d{3}\s*/, "").trim();
  }

  // 合約 r2 §3.1：RPC 例外訊息開頭是錯誤碼
  const SUBMIT_ERROR_TEXT = Object.freeze({
    AUTH_REQUIRED: "登入已過期，請重新登入。",
    TENANT_ACCESS_DENIED: "這個帳號不屬於這間工廠，請重新登入。",
    ACCOUNT_DISABLED: "這個帳號已停用，請找管理員。",
    OPERATOR_REQUIRED: "只有作業員帳號可以按開工／停工。",
    APPLIER_CANNOT_SUBMIT: "這是工廠套用帳號，不能按開工／停工，請用作業員帳號登入。",
    TENANT_INACTIVE: "工廠帳戶目前停用，請找管理員。",
    APP_USER_REQUIRED: "這個帳號沒有對到作業員資料，請找管理員。",
    OPERATOR_LEGACY_ID_MISSING: "你的帳號還沒對到舊 MES 工號，請找生管或管理員設定。",
    OPERATOR_LEGACY_ID_INVALID: "你的帳號對到的舊 MES 工號格式不對，請找管理員修正。",
    MACHINE_NOT_ALLOWED: "你的帳號不能操作這台機台（課別不符），請找生管。",
    COMMAND_UUID_CONFLICT: "這筆指令跟之前送過的內容不一樣，請關掉重新按一次。",
    MACHINE_COMMAND_IN_FLIGHT: "這台已經有一筆開工／停工在等工廠處理（可能是別台平板按的），請等它有結果再按。",
  });
  const INVALID_INPUT_TEXT = "卡片上的工單資料不完整（機台、工單號、第幾道或料號），請重新整理；還是不行請找生管。";

  function errorCodeOf(message) {
    const m = String(message || "").match(/^([A-Z][A-Z0-9_]{2,63})(?![A-Z0-9_])/);
    return m ? m[1] : "";
  }

  // RPC 本身拒絕（還沒建成指令）→ 白話。retry＝不知道有沒有送到，可以用同一個 uuid 重送。
  function submitErrorText(error) {
    if (isMissingResourceError(error)) return { missing: true, retry: false, text: "這個功能還沒在伺服器啟用，請改用電子紙。" };
    if (isNetworkError(error)) return { missing: false, retry: true, text: "網路不穩，還不知道有沒有送到。按「重送」會用同一筆指令，不會重複開工／停工。" };
    const msg = serverMessage(error);
    const status = Number(String((error && error.message) || "").slice(0, 3));
    const code = errorCodeOf(msg);
    if (code && SUBMIT_ERROR_TEXT[code]) return { missing: false, retry: false, code, text: SUBMIT_ERROR_TEXT[code] };
    if (/^INVALID_|^COMMAND_UUID_REQUIRED$/.test(code)) return { missing: false, retry: false, code, text: INVALID_INPUT_TEXT };
    if (status === 401 || status === 403) return { missing: false, retry: false, text: "登入已過期或沒有權限，請重新登入。" };
    return { missing: false, retry: status >= 500, text: msg ? `送出失敗：${msg}` : "送出失敗，請稍後再試或找生管。" };
  }

  // 工廠回的拒絕代碼（finish rejected）＋伺服器保留碼（EXPIRED、MANUAL_RELEASED）
  const REJECT_TEXT = Object.freeze({
    ORDER_MISMATCH: "舊 MES 這台現在不是這張工單（或不是這一道）。請找生管確認；App 不會幫你換單。",
    STATION_NOT_SET: "舊 MES 這台還沒設定工單，請找生管。",
    OPERATOR_NOT_SET: "你還沒掛在舊 MES 這台的作業員名單，請找生管。",
    ALREADY_RUNNING: "舊 MES 這台已經是開工中，不用再開工。",
    ALREADY_STOPPED: "舊 MES 這台已經是停工中（或還沒開工），不用再停工。",
    RMS_UNAVAILABLE: "工廠的機台服務沒有回應，請找生管確認舊 MES 狀態。",
    APS_SIM_NOT_FOUND: "舊 MES 找不到這張單的排程資料，請找生管。",
    STALE_COMMAND: "太久沒套用，舊 MES 沒動，請重按",
    LEGACY_APPLIED_LATE: "舊 MES 已經改了，但回報太晚；不要再按，請看機台電子紙或問生管核對",
    // 套用端 #785 新增：NEED_PAUSED、OPERATOR_LIST_TOO_LONG＝舊 MES 沒動；LEGACY_PARTIAL_WRITE、ORDER_CHANGED_DURING_APPLY＝舊 MES 已改（不可說沒生效）
    NEED_PAUSED: "這張單暫停中，請問生管",
    OPERATOR_LIST_TOO_LONG: "這台的作業員名單太長，請生管先整理名單",
    LEGACY_PARTIAL_WRITE: "舊 MES 已經改了一部分，請看機台電子紙或問生管核對",
    ORDER_CHANGED_DURING_APPLY: "套用時機台上的單剛好被換了，舊 MES 已經改了，請問生管核對",
    MANUAL_RELEASED: "主管已取消這筆；舊 MES 是否已改變不確定，請先看機台電子紙或問生管，再決定要不要重按",
    EXPIRED: "超過 10 分鐘工廠都沒有接手，這次沒有生效（舊 MES 沒動）。要的話請重新按一次。",
    // 套用端速查表（#785 runbook）：OUTCOME_UNKNOWN／INTERNAL_ERROR＝舊 MES 有沒有改「不確定」，不能說沒生效
    OUTCOME_UNKNOWN: "舊 MES 有沒有改不確定，請先看機台電子紙或問生管核對，再決定要不要重按",
    INTERNAL_ERROR: "工廠套用時出錯，舊 MES 有沒有改不確定，請先看機台電子紙或問生管核對，再決定要不要重按",
  });
  // 這些代碼不是一般的「沒有開工／停工」：LEGACY_APPLIED_LATE／LEGACY_PARTIAL_WRITE／ORDER_CHANGED_DURING_APPLY
  // 舊 MES 其實已經改了；MANUAL_RELEASED 不確定。標題不能寫「沒有開工／停工」。
  const REJECT_TITLE = Object.freeze({
    STALE_COMMAND: "已作廢",
    MANUAL_RELEASED: "主管已取消",
    LEGACY_APPLIED_LATE: "舊 MES 已改（回報太晚）",
    LEGACY_PARTIAL_WRITE: "舊 MES 已改一部分",
    ORDER_CHANGED_DURING_APPLY: "舊 MES 已改（單剛好被換）",
    OUTCOME_UNKNOWN: "結果不確定",
    INTERNAL_ERROR: "結果不確定",
  });
  // 舊 MES 已經被改過（全部或部分）的代碼
  const LEGACY_CHANGED_CODES = Object.freeze(["LEGACY_APPLIED_LATE", "LEGACY_PARTIAL_WRITE", "ORDER_CHANGED_DURING_APPLY"]);
  // 舊 MES 確定「沒動」的代碼（套用端 StationCommandRejectCodes 扣掉上面 3 個已改＋OUTCOME_UNKNOWN／INTERNAL_ERROR 不確定）。
  // 只有這些代碼可以用「沒有開工／停工」這種肯定標題；清單外的（含套用端以後新加、App 還沒跟上的）一律保守寫「請核對」。
  const LEGACY_UNTOUCHED_CODES = Object.freeze([
    "COMMAND_INVALID", "STALE_COMMAND", "STATION_NOT_ENABLED", "STATION_NOT_FOUND", "STATION_TYPE_MISMATCH", "STATION_NOT_SET",
    "ORDER_MISMATCH", "INDEX_SN_MISMATCH", "PART_NO_MISMATCH", "MII_NOT_FOUND", "MII_CLOSED", "OPERATOR_NOT_SET", "OPERATOR_UNKNOWN",
    "ALREADY_RUNNING", "ALREADY_STOPPED", "NOT_STARTED", "WORK_ORDER_NOT_FOUND", "APS_SIM_NOT_FOUND", "LABEL_DATA_INVALID",
    "RMS_UNAVAILABLE", "LEGACY_REJECTED", "WRITE_TARGET_DENIED", "LOCK_TIMEOUT", "OPERATOR_LIST_TOO_LONG", "NEED_PAUSED",
  ]);
  const UNTOUCHED_FALLBACK_TEXT = "舊 MES 沒有套用這次指令。";
  const UNKNOWN_CODE_TEXT = "沒有完成，舊 MES 狀態請核對";
  const UNKNOWN_CODE_TITLE = "結果待核對";

  function rejectText(code, message) {
    const key = text(code).toUpperCase();
    const base = REJECT_TEXT[key] || (LEGACY_UNTOUCHED_CODES.includes(key) ? UNTOUCHED_FALLBACK_TEXT : UNKNOWN_CODE_TEXT);
    const detail = text(message);
    return { text: base, code: key, detail: detail && detail !== base ? detail : "" };
  }

  // ---------------------------------------------------------------- 狀態
  // 結果只看伺服器 status。ageMs＝伺服器時鐘上的年齡（可為 null）：超過 max_apply_age 只多一句提示，仍是等待中。
  function statusView(row, commandType, ageMs) {
    const type = COMMAND_TYPES.includes(commandType) ? commandType : text(row && row.command_type);
    const action = TYPE_LABEL[type] || "指令";
    const status = text(row && row.status).toLowerCase();
    if (status === "applied") {
      return { phase: "applied", terminal: true, tone: "ok", title: type === "stop" ? "已停工" : type === "start" ? "已開工" : "已套用", text: `舊 MES 已${action}。` };
    }
    if (status === "rejected") {
      const r = rejectText(row.reject_code, row.reject_message);
      const special = REJECT_TITLE[r.code];
      const untouched = LEGACY_UNTOUCHED_CODES.includes(r.code);
      const title = special || (untouched ? `沒有${action}` : UNKNOWN_CODE_TITLE);
      return { phase: "rejected", terminal: true, tone: special || !untouched ? "warn" : "bad", title, text: r.text, code: r.code, detail: r.detail };
    }
    if (status === "expired") {
      const r = rejectText("EXPIRED", row.reject_message);
      return { phase: "expired", terminal: true, tone: "warn", title: "已過期", text: r.text, code: "EXPIRED", detail: r.detail };
    }
    const late = ageMs !== null && ageMs !== undefined && Number(ageMs) > MAX_APPLY_AGE_MS;
    // 合約 r3：伺服器時間超過 3 分鐘的指令不會再變成 applied（可能是 STALE_COMMAND，也可能是 LEGACY_APPLIED_LATE）
    // → 只加提示，照樣等伺服器結果。claimed 時工廠可能已經動了舊 MES，所以不說「不會生效」。
    if (status === "claimed") {
      return { phase: "pending", terminal: false, tone: "wait", title: "工廠處理中…", text: late ? "工廠正在處理，結果還沒回來；請等最終結果或問生管" : "工廠已收到，正在核對舊 MES。請稍等，不要重按。", late };
    }
    return { phase: "pending", terminal: false, tone: "wait", title: "等待工廠套用…", text: late ? "工廠還沒處理，這筆應該不會生效；請等最終結果或問生管" : "已送出，等工廠接手。請稍等，不要重按。", late };
  }

  // 輪詢間隔：前 30 秒每 2 秒，之後每 5 秒，解鎖後每 15 秒
  function pollDelay(elapsedMs) {
    const e = Number(elapsedMs);
    if (e < 30000) return 2000;
    return e > CLIENT_UNLOCK_MS ? 15000 : 5000;
  }

  // 本機經過時間（同一個時鐘）超過 CLIENT_UNLOCK_MS → 按鈕解鎖（輪詢不停）
  function lockReleased(startedAtMs, nowMs) {
    return Number(nowMs) - Number(startedAtMs) > CLIENT_UNLOCK_MS;
  }

  // 提示用的年齡：有伺服器時鐘差就用伺服器時間；沒有（例：重送後才確認）就用按下後的本機經過時間（只會偏大一點）
  function ageForHint(record, requestedAt, nowMs) {
    const age = serverAgeMs(requestedAt, record && record.serverOffset, nowMs);
    if (age !== null) return age;
    return record && Number.isFinite(Number(record.startedAt)) ? Number(nowMs) - Number(record.startedAt) : null;
  }

  // ---------------------------------------------------------------- 等待中鎖（重新整理後也記得）
  // unconfirmed＝送出時網路斷、不知道伺服器有沒有收到；這時卡片可以立刻用同一個 uuid 重送。
  function pendingRecord(rec = {}) {
    const out = {
      commandUuid: rec.commandUuid,
      commandType: rec.commandType,
      machineCode: normCode(rec.machineCode),
      orderNo: text(rec.orderNo),
      step: Number(rec.step) || null,
      partNo: text(rec.partNo) || null,
      partName: text(rec.partName),
      operationName: text(rec.operationName),
      manufactureIiId: text(rec.manufactureIiId) || null,
      startedAt: Number(rec.startedAt) || Date.now(),
      unconfirmed: rec.unconfirmed === true,
      lastStatus: ["pending", "claimed"].includes(String(rec.lastStatus || "")) ? String(rec.lastStatus) : null,
      serverOffset: Number.isFinite(Number(rec.serverOffset)) && rec.serverOffset !== null ? Number(rec.serverOffset) : null,
    };
    return out;
  }

  function restorePending(raw, nowMs) {
    let obj = raw;
    if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { return {}; } }
    if (!obj || typeof obj !== "object") return {};
    const out = {};
    Object.keys(obj).forEach((code) => {
      const rec = obj[code];
      if (!rec || !isUuid(rec.commandUuid) || !COMMAND_TYPES.includes(rec.commandType)) return;
      if (Number(nowMs) - Number(rec.startedAt) > PENDING_KEEP_MS) return;
      out[normCode(code)] = pendingRecord(rec);
    });
    return out;
  }

  // 送出時網路斷或逾時 → 至少 30 秒、而且連續 3 次都查不到這筆 → 解鎖（文案只說「目前查不到」，不宣稱伺服器沒收到）
  const UNCONFIRMED_MIN_MS = 30 * 1000;
  function unconfirmedNotSent(record, nowMs) {
    return Boolean(record && record.unconfirmed && (record.emptyPolls || 0) >= 3 && Number(nowMs) - Number(record.startedAt) >= UNCONFIRMED_MIN_MS);
  }

  // 本機 11 分鐘解鎖後卡片的說明：最後看到的伺服器狀態是 pending 才能再按（伺服器下一次 submit 會把它轉 expired）；
  // 是 claimed → 工廠還在處理，按鈕繼續鎖住（再按也只會得到 MACHINE_COMMAND_IN_FLIGHT）。
  function releasedNote(lastStatus) {
    if (String(lastStatus || "").toLowerCase() === "claimed") return { unlock: false, text: "工廠還在處理上一筆，請等結果或問生管" };
    return { unlock: true, text: "可以再按；伺服器會先把太舊的這筆作廢" };
  }

  return {
    COMMAND_TYPES, TYPE_LABEL, TERMINAL, MAX_APPLY_AGE_MS, CLAIM_LEASE_MS, PENDING_EXPIRE_MS, CLIENT_UNLOCK_MS, PENDING_KEEP_MS,
    SUBMIT_TIMEOUT_MS, SUBMIT_RPC, MISSING_PART_NO, REJECT_TEXT, REJECT_TITLE, LEGACY_CHANGED_CODES, LEGACY_UNTOUCHED_CODES, SUBMIT_ERROR_TEXT,
    parseFlag, flagIsOn, enabledForMachine, isMultiStation, roleAllowed, isUuid, eligibility, newUuid,
    formatTime, formatHm, serverOffset, serverAgeMs,
    legacyRowFor, freshCheck, legacyStateLines, confirmModel, submitPayload,
    isMissingResourceError, isNetworkError, errorCodeOf, submitErrorText, rejectText,
    statusView, pollDelay, lockReleased, ageForHint, pendingRecord, restorePending, unconfirmedNotSent, releasedNote, UNCONFIRMED_MIN_MS,
  };
});
