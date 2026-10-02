// cardActiveOrderCore.js — Monitor 機台卡片「目前工單」要挑哪一張（owner 2026-10-02）。
//
// 為什麼存在：舊 MES 一台機台可以同時掛好幾張沒收工的單，App 的 work_order_processes 也一樣（一台機台多列
// off_station_at 是 null）。原本卡片只照「排程佇列 → 製程狀態 → 交期 → 單號」挑第一張，結果挑到很久沒動的單
// （2026-10-02 正式庫：B04 卡片顯示 4 月的 A37九孔座〔舊 MES 08-27 最後更新〕，今天在做的是 CPDF-16本體〔10-02 16:14〕）。
//
// owner 定的規則：
//   每台機台的「目前工單」＝這台機台上「最近有活動」的那一道在站工序。活動時間取下列中最新的一個：
//     1. 這道工序 App 報工的最後時間（production_reports；batch_report_progress.last_report_at）
//     2. 舊 MES 結算時間 legacy_station_progress.legacy_updated_at（同單、同機台；有同步序就用同步序那列，否則取這台這張單最新的一列）
//     3. work_order_processes.actual_start_at（開工時間）
//   不用 work_order_processes.updated_at：派工橋每次同步都會更新它，會被誤判成「有活動」（owner 2026-10-02）。
//   沒有任何活動時間 → 退回原本的規則（呼叫端傳進來的 fallbackCompare）。同一個時間 → 也用原本的規則排。
//   畫面上可以手動切換卡片顯示哪一張（只改畫面，不寫資料庫）；那張單不在這台了就自動回到依活動挑選。
//
// 已報 ≥ 訂單數量但仍在站的單照樣是卡片候選，卡片標「超量 +N」（見檔尾 isCardCandidate／overQtyInfo）。
//
// DOM 與 fetch 留在 app.js；這裡只做可測的決策。卡片、單台報工（QR 只帶機台）、批次報工的預設工單都用這裡挑出來的同一張。
(function attachMachTileCardActiveOrderCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileCardActiveOrderCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileCardActiveOrderCore() {
  "use strict";

  // 活動來源（同一個時間點時，前面的優先標示）
  const SOURCES = Object.freeze(["report", "legacy", "start"]);
  const SOURCE_LABEL = Object.freeze({ report: "App 報工", legacy: "舊 MES 報工", start: "開工" });

  function toMs(value) {
    if (value === null || value === undefined || value === "") return NaN;
    const ms = typeof value === "number" ? value : Date.parse(value);
    return Number.isFinite(ms) ? ms : NaN;
  }

  function normCode(value) {
    return String(value ?? "").trim().toUpperCase();
  }

  // 卡片／批次用的一張單的鍵：工序 id（逐工序卡片 #45 之後同一張單可能在兩台），沒有就用單號
  function orderKey(order) {
    if (!order) return "";
    return String(order.processId || order.id || "");
  }

  // activity：{ lastReportAt, legacyUpdatedAt, actualStartAt } →（updatedAt 就算有也不看） 最新的一個（沒有任何有效時間 → null）
  function latestActivity(activity) {
    if (!activity) return null;
    const values = {
      report: activity.lastReportAt,
      legacy: activity.legacyUpdatedAt,
      start: activity.actualStartAt,
    };
    let best = null;
    SOURCES.forEach((source) => {
      const ms = toMs(values[source]);
      if (!Number.isFinite(ms)) return;
      if (!best || ms > best.ms) best = { ms, at: new Date(ms).toISOString(), source, label: SOURCE_LABEL[source] };
    });
    return best;
  }

  // 舊 MES 結算時間：同單、同機台。rows＝legacy_station_progress 的列（work_order_no, machine_code, process_order, legacy_updated_at）。
  // 有這道工序的步序、而且舊 MES 有同步序那一列 → 用那一列（逐工序 #45 之後同一張單可能同一台不同道）；
  // 否則取這台這張單最新的一列（目前正式庫一單一道，步序可能對不上，例：App 第 7 道、舊 MES 第 1 道）。
  function legacyUpdatedAtFor(rows, { workOrderNo, machineCode, step } = {}) {
    const wo = String(workOrderNo || "").trim();
    const code = normCode(machineCode);
    if (!wo || !code) return null;
    const same = (Array.isArray(rows) ? rows : []).filter((row) => row
      && String(row.work_order_no || "").trim() === wo && normCode(row.machine_code) === code
      && Number.isFinite(toMs(row.legacy_updated_at)));
    if (!same.length) return null;
    const stepNo = Number(step);
    const exact = Number.isFinite(stepNo) && stepNo > 0 ? same.filter((row) => Number(row.process_order) === stepNo) : [];
    const pool = exact.length ? exact : same;
    let best = null;
    pool.forEach((row) => { if (!best || toMs(row.legacy_updated_at) > toMs(best.legacy_updated_at)) best = row; });
    return best ? new Date(toMs(best.legacy_updated_at)).toISOString() : null;
  }

  // 一台機台的在站單排序：有活動的依最新活動（新→舊），沒有活動的排在後面；同時間或都沒有活動 → fallbackCompare（原本的規則）。
  // 回傳 [{ order, latest }]（latest＝latestActivity 的結果或 null）。
  function rankOrders(orders, activityOf, fallbackCompare) {
    const lookup = typeof activityOf === "function" ? activityOf : () => null;
    const list = (Array.isArray(orders) ? orders : []).filter(Boolean).map((order, index) => ({ order, index, latest: latestActivity(lookup(order)) }));
    list.sort((a, b) => {
      const am = a.latest ? a.latest.ms : -Infinity;
      const bm = b.latest ? b.latest.ms : -Infinity;
      if (am !== bm) return bm - am;
      const f = typeof fallbackCompare === "function" ? Number(fallbackCompare(a.order, b.order)) || 0 : 0;
      return f || a.index - b.index;
    });
    return list.map(({ order, latest }) => ({ order, latest }));
  }

  // 挑卡片要顯示的那張。overrideKey＝畫面上手動切換的那張（orderKey）；不在這台的在站清單裡 → 忽略、回到自動。
  // 回傳 { order, latest, basis: "activity"|"fallback"|"manual"|"none", ranked, others }
  //   others＝這台其他在站單數（卡片「這台還掛 N 張」）。
  function pickActiveOrder(orders, { activityOf, fallbackCompare, overrideKey } = {}) {
    const ranked = rankOrders(orders, activityOf, fallbackCompare);
    if (!ranked.length) return { order: null, latest: null, basis: "none", ranked, others: 0, autoKey: "" };
    const auto = ranked[0];
    const autoKey = orderKey(auto.order);
    const manual = overrideKey ? ranked.find((item) => orderKey(item.order) === String(overrideKey)) : null;
    const chosen = manual || auto;
    const basis = manual && orderKey(manual.order) !== autoKey ? "manual" : auto.latest ? "activity" : "fallback";
    return { order: chosen.order, latest: chosen.latest, basis, ranked, others: ranked.length - 1, autoKey };
  }

  function moreOrdersLabel(others) {
    const n = Math.max(0, Math.floor(Number(others) || 0));
    return n > 0 ? `這台還掛 ${n} 張` : "";
  }

  // 批次報工的預設工單：卡片顯示的那張在這台的候選清單裡 → 用它；否則用候選清單第一張（原本的規則）。
  function defaultCandidate(candidates, cardOrder) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (!list.length) return null;
    const key = orderKey(cardOrder);
    const byKey = key ? list.find((o) => orderKey(o) === key) : null;
    // 卡片那張沒有工序 id（Dev 示範資料）才用單號對；有工序 id 卻不在候選裡 → 不拿同單別道硬配
    const byNo = !byKey && cardOrder && !cardOrder.processId && cardOrder.id ? list.find((o) => String(o.id) === String(cardOrder.id)) : null;
    return byKey || byNo || list[0];
  }

  // ---- 超量（已報良品 ≥ 訂單數量）仍在站的單（owner 2026-10-02）----
  // 原本卡片候選＝app.js machtileIsSchedulableOrder（跟排程板共用），裡面有一條「已報 ≥ 數量 → 視為做完」。
  // 派工橋改讀 SFC 後，B05 XX01202606050003 已報 689／訂單 536，被這條排除 → 卡片變「無工單指派中」，
  // 但這張單在舊 MES 還在報、App 裡也還在站。改成：卡片候選不再看「已報 ≥ 數量」，其他條件不變
  // （在站、工序沒有完工／略過／待品檢、工單不是完工／出貨／取消）。排程板仍用原本的規則。
  const CLOSED_WORK_STATUS = Object.freeze(["completed", "shipped", "cancelled"]);
  const CLOSED_PROCESS_STATUS = Object.freeze(["completed", "skipped", "waiting_inspection"]);

  // assigned＝這張單有指派實際機台（未排機的單維持原規則：報滿就不放進「未排機」那一格）。
  function isCardCandidate(order, { assigned = true } = {}) {
    if (!order) return false;
    if (order.offStation === true) return false;
    const workStatus = String(order.workStatus || "").toLowerCase();
    const processStatus = String(order.processStatus || "").toLowerCase();
    if (CLOSED_WORK_STATUS.includes(workStatus)) return false;
    if (CLOSED_PROCESS_STATUS.includes(processStatus)) return false;
    if (!assigned && overQtyInfo(order).full) return false;
    return true;
  }

  // 已報良品（done）與訂單數量（total）的比較。percent 照實（可以超過 100），bar 給進度條用（最多 100）。
  function overQtyInfo(order, doneOverride) {
    const total = Math.max(0, Number(order?.total) || 0);
    const doneRaw = doneOverride === undefined || doneOverride === null ? order?.done : doneOverride;
    const done = Math.max(0, Number(doneRaw) || 0);
    if (!total) return { total, done, full: false, over: 0, percent: 0, bar: 0 };
    // 無條件捨去（owner 例：689/536＝128%）；不會把 99.6% 顯示成 100% 讓人以為報滿
    const percent = Math.floor((done / total) * 100);
    return { total, done, full: done >= total, over: Math.max(0, done - total), percent, bar: Math.min(100, percent) };
  }

  function overQtyLabel(info) {
    if (!info || !info.full) return "";
    return info.over > 0 ? `超量 +${info.over}` : "已報滿";
  }

  // 報工畫面（單台、批次）選到報滿／超量的單：提醒，不擋報工。
  function overQtyReportWarning(info) {
    if (!info || !info.full) return "";
    const head = info.over > 0
      ? `這張單已報良品 ${info.done}，超過訂單數量 ${info.total}（超量 +${info.over}）。`
      : `這張單已報良品 ${info.done}，已達訂單數量 ${info.total}。`;
    return `${head}仍可以報工，請確認單號和數量沒有報錯。`;
  }

  return {
    SOURCES, SOURCE_LABEL,
    orderKey, latestActivity, legacyUpdatedAtFor, rankOrders, pickActiveOrder, moreOrdersLabel, defaultCandidate,
    isCardCandidate, overQtyInfo, overQtyLabel, overQtyReportWarning,
  };
});
