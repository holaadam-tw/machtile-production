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
    urgencyLabel,
    dueText,
    plannedStartText,
    quantityText,
    latestSyncedAt,
  });
});
