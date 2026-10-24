// dispatchPoolCore.js — 派工待做池第 2 步（2026-10-07）的純邏輯：只讀顯示，不寫任何資料。
//
// 資料：dispatch_pool_items（machtile-mini-mes migration 20261007120000）＝Factory 課別待做池（FWC_DispatchPool）
// 裡「待接／退回待接」的工序，由派工橋送來。RLS 已限制同租戶＋自己的課別；這裡再依「機台卡的課別」篩（同課）。
// 排序（owner 2026-10-06）：緊急程度 → 交期 → APS 預計開始；不知道的日期排最後。
// DOM 與 fetch 留在 app.js；這裡只做可測的決策。
(function attachMachTileDispatchPoolCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileDispatchPoolCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileDispatchPoolCore() {
  "use strict";

  // 只認明確的課別名稱（同 #94：不從 A/B 代號或機型猜）。
  const DEPARTMENT_CODE_BY_NAME = Object.freeze({ "車床課": "LATHE", "銑床課": "MILL" });
  const URGENCY_LABEL = Object.freeze({ 1: "緊急 1", 2: "緊急 2", 3: "緊急 3", 4: "緊急 4" });

  const text = (v) => (v === null || v === undefined ? "" : String(v).trim());
  const displayName = (v) => text(v) || "未提供";

  function departmentCodeOf(departmentName) {
    return DEPARTMENT_CODE_BY_NAME[text(departmentName)] || "";
  }

  function urgencyOf(item) {
    const u = Number(item && item.urgency);
    return Number.isInteger(u) && u >= 1 && u <= 4 ? u : null;
  }

  // 日期字串（YYYY-MM-DD 或 ISO 時間）→ 毫秒；沒有／不合法＝null（排最後）
  function timeOf(value) {
    const v = text(value);
    if (!v) return null;
    const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + "T00:00:00" : v);
    return Number.isFinite(ms) ? ms : null;
  }

  function compareNullableAsc(a, b) {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  }

  function compareItems(a, b) {
    return compareNullableAsc(urgencyOf(a), urgencyOf(b))
      || compareNullableAsc(timeOf(a.due_date), timeOf(b.due_date))
      || compareNullableAsc(timeOf(a.planned_start), timeOf(b.planned_start))
      || text(a.work_order_no).localeCompare(text(b.work_order_no))
      || (Number(a.process_order) || 0) - (Number(b.process_order) || 0);
  }

  function sortItems(items) {
    return (Array.isArray(items) ? items : []).slice().sort(compareItems);
  }

  // 機台卡的「待做池（同課）」：只有機台課別明確是車床課／銑床課才列；eligibleHere＝這台在不在可做機台清單。
  // hideNotEligible（owner 2026-10-07：作業員）＝這台不在可做機台清單的工序不列；生管／主管照列（畫面淡化＋標註）。
  function itemsForMachine(items, machine, options) {
    const hideNotEligible = Boolean(options && options.hideNotEligible);
    const department = departmentCodeOf(machine && machine.departmentName);
    const code = text(machine && machine.machineCode);
    if (!department) return { department: "", items: [] };
    const list = sortItems((Array.isArray(items) ? items : []).filter((item) => text(item.department_code) === department))
      .map((item) => Object.assign({}, item, {
        eligibleHere: Boolean(code) && (Array.isArray(item.eligible_machine_codes) ? item.eligible_machine_codes : []).map(text).includes(code),
      }));
    return { department, items: hideNotEligible ? list.filter((item) => item.eligibleHere) : list };
  }

  function claimArgs(sourceKey, machineCode, replaceStopped = false) {
    const args = { p_source_key: text(sourceKey), p_machine_code: text(machineCode) };
    if (replaceStopped === true) args.p_replace_stopped = true;
    return args;
  }

  function replaceStoppedState(item, machine, role, enabledMachines) {
    const base = claimState(item, machine, enabledMachines);
    const privileged = ["admin", "manager"].includes(text(role).toLowerCase());
    const stopped = text(machine && machine.status).toLowerCase() === "paused";
    const current = machine && machine.order;
    if (!privileged || !stopped || !current) return { enabled: false, visible: false, reason: base.reason };
    const code = text(machine && (machine.machineCode || machine.code || machine.name));
    const enabled = (Array.isArray(enabledMachines) ? enabledMachines : []).map(text).includes(code);
    if (!enabled) return { enabled: false, visible: true, reason: "此機台尚未開放接單" };
    const eligible = Array.isArray(item && item.eligible_machine_codes) && item.eligible_machine_codes.map(text).includes(code);
    if (!eligible) return { enabled: false, visible: true, reason: "此機台不在可做清單" };
    return { enabled: true, visible: true, reason: "" };
  }

  function canRelease(role) {
    return ["admin", "planner"].includes(text(role).toLowerCase());
  }

  function releaseArgs(sourceKey) {
    return { p_source_key: text(sourceKey) };
  }

  function canReturn(role) {
    return ["planner", "admin"].includes(text(role).toLowerCase());
  }

  function returnArgs(sourceKey, reason) {
    return { p_source_key: text(sourceKey), p_reason: text(reason) };
  }

  function eligibleCount(items, machineCode) {
    const code = text(machineCode);
    if (!code) return 0;
    return (Array.isArray(items) ? items : []).filter((item) =>
      Array.isArray(item && item.eligible_machine_codes)
      && item.eligible_machine_codes.map(text).includes(code)).length;
  }

  // machines / v_machine_management_cards 目前沒有同步舊 MES Station_Type。
  // 只接受呼叫端明確提供的 stationMode；缺值一律 single（fail closed）。
  function stationMode(machine) {
    return text(machine && machine.stationMode).toLowerCase() === "multi" ? "multi" : "single";
  }

  function claimState(item, machine, enabledMachines) {
    const code = text(machine && (machine.machineCode || machine.code || machine.name));
    const enabled = (Array.isArray(enabledMachines) ? enabledMachines : []).map(text).includes(code);
    if (!enabled) return { enabled: false, reason: "此機台尚未開放接單" };
    const status = text(machine && machine.status).toLowerCase();
    if (["maintenance", "offline"].includes(status)) return { enabled: false, reason: "機台目前不可接單" };
    if (stationMode(machine) === "single"
      && (status !== "idle" || Boolean(machine && machine.hasOrder))) {
      return { enabled: false, reason: "單工站必須空閒且沒有工單" };
    }
    const eligible = Array.isArray(item && item.eligible_machine_codes)
      && item.eligible_machine_codes.map(text).includes(code);
    if (!eligible) return { enabled: false, reason: "此機台不在可做清單" };
    return { enabled: true, reason: "" };
  }

  const CLAIM_ERROR_TEXT = Object.freeze({
    UNACKNOWLEDGED_CLAIM_EXISTS: "這張單已有未確認的接單，請找生管釋放。",
    MACHINE_ALREADY_ASSIGNED: "機台還有未完成的工單。",
    POOL_ITEM_NOT_WAITING: "這張單已被別台接走。",
    MACHINE_NOT_IDLE: "機台已不是空閒狀態，請重新整理。",
    MACHINE_NOT_EMPTY: "機台還有未完成的工單。",
    MACHINE_NOT_ELIGIBLE: "這台機台不在這張單的可做清單。",
    MACHINE_DEPARTMENT_MISMATCH: "這張單不屬於這台機台的課別。",
    DEPARTMENT_ACCESS_DENIED: "你沒有這張單所屬課別的權限。",
    PROCESS_ALREADY_ASSIGNED: "這道工序已排到其他機台。",
    POOL_ITEM_INCOMPLETE: "待做池資料不完整，請生管確認。",
    DISPATCH_POOL_CLAIM_DISABLED: "接單功能尚未由系統端開啟。",
    AUTH_REQUIRED: "登入已失效，請重新登入。",
    TENANT_REQUIRED: "找不到公司資料，請重新登入或聯絡管理員。",
  });

  function errorCode(error) {
    const message = text(error && error.message || error);
    const match = message.match(/(?:^|[^A-Z0-9_])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?=[^A-Z0-9_]|$)/);
    return match ? match[1] : "";
  }

  function claimErrorText(error) {
    const code = errorCode(error);
    if (code) return CLAIM_ERROR_TEXT[code] || code;
    return "接單失敗，請重新整理後再試。";
  }

  const RELEASE_ERROR_TEXT = Object.freeze({
    AUTH_REQUIRED: "登入狀態已失效，請重新登入。",
    TENANT_REQUIRED: "找不到公司資料，請重新登入或聯絡管理員。",
    DISPATCH_POOL_CLAIM_RELEASE_FORBIDDEN: "只有管理員或生管可以釋放接單。",
    INVALID_CLAIM_RELEASE_PAYLOAD: "找不到要釋放的派工池項目，請重新整理後再試。",
    UNACKNOWLEDGED_CLAIM_NOT_FOUND: "這筆接單已被處理或不存在，請重新整理。",
    CLAIM_RELEASE_CAS_FAILED: "接單狀態已變更，請重新整理後再試。",
  });

  function releaseErrorText(error) {
    const code = errorCode(error);
    if (code) return RELEASE_ERROR_TEXT[code] || code;
    return "釋放接單失敗，請重新整理後再試。";
  }

  function returnErrorText(error) {
    const message = text(error && error.message || error);
    if (message.includes("ACTIVE_CLAIM_NOT_FOUND") || message.includes("POOL_ITEM_NOT_CLAIMED")) return "這張單已退回或狀態已變更，請重新整理。";
    if (message.includes("CLAIM_ALREADY_STARTED")) return "工序已開工或已有報工，不能退回池子。";
    if (message.includes("DISPATCH_POOL_RETURN_FORBIDDEN")) return "只有生管或管理員可以退回池子。";
    if (message.includes("INVALID_RETURN_PAYLOAD")) return "請填寫 1–500 字退回原因。";
    return "退回失敗，請重新整理後再試。";
  }

  function urgencyLabel(item) {
    const u = urgencyOf(item);
    return u ? URGENCY_LABEL[u] : "緊急程度未提供";
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  // 交期：日期本身（不受時區影響）
  function dueText(value) {
    const v = text(value);
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[2]}/${m[3]}` : "未提供";
  }

  // APS 預計開始：時間點，以瀏覽器所在時區顯示（工廠＝台灣）
  function plannedStartText(value) {
    const ms = timeOf(value);
    if (ms === null) return "未提供";
    const d = new Date(ms);
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function quantityText(value) {
    const q = Number(value);
    return value !== null && value !== undefined && Number.isInteger(q) && q > 0 ? String(q) : "未提供";
  }

  // 最近一次同步時間（橋每次送清單會刷新 synced_at）；沒有資料＝""。
  function latestSyncedAt(items) {
    let best = null;
    for (const item of Array.isArray(items) ? items : []) {
      const ms = timeOf(item.synced_at);
      if (ms !== null && (best === null || ms > best)) best = ms;
    }
    return best === null ? "" : plannedStartText(new Date(best).toISOString());
  }

  return Object.freeze({
    DEPARTMENT_CODE_BY_NAME,
    departmentCodeOf,
    urgencyOf,
    sortItems,
    itemsForMachine,
    eligibleCount,
    claimArgs,
    replaceStoppedState,
    canRelease,
    releaseArgs,
    canReturn,
    returnArgs,
    stationMode,
    claimState,
    errorCode,
    claimErrorText,
    releaseErrorText,
    returnErrorText,
    urgencyLabel,
    dueText,
    plannedStartText,
    quantityText,
    displayName,
    latestSyncedAt,
  });
});
