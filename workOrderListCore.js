// workOrderListCore.js — 「工單管理」清單的純邏輯（owner 2026-10-02：加來源欄＋清單優化）。
//
// 來源判斷（2026-10-02 查正式庫）：
//   work_orders 有 source_system／legacy_mes_source／legacy_work_order_no 這幾個「來源」欄位，但 76 張全部是 null，
//   派工橋（DispatchBridge.ps1）跟 App 建單表單呼叫的是同一支 rpc/work_order_upsert，這支 RPC 不寫 created_by。
//   所以目前唯一分得出來的訊號是 created_by：有值＝有人掛名建的（App 手動）；null＝派工橋自動同步（舊 MES 派工）。
//   將來後端把來源欄位填上，就以那幾欄為準（明確來源優先於推斷）。
//
// DOM 與 fetch 留在 app.js；這裡只做可測的決策：來源、交期狀態、排序、搜尋、篩選。
(function attachMachTileWorkOrderListCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileWorkOrderListCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileWorkOrderListCore() {
  "use strict";

  const SOON_DAYS = 3;
  const CLOSED_STATUSES = Object.freeze(["completed", "shipped", "cancelled"]);
  const FILTERS = Object.freeze([
    Object.freeze({ key: "all", label: "全部" }),
    Object.freeze({ key: "overdue", label: "逾期" }),
    Object.freeze({ key: "legacy", label: "舊 MES 派工" }),
    Object.freeze({ key: "app", label: "App 手動" }),
  ]);

  const text = (v) => (v === null || v === undefined ? "" : String(v).trim());

  // 來源。回傳 { kind: "legacy" | "app", label, basis, createdBy }
  //   basis：判斷依據（"source_system" / "legacy_mes_source" / "legacy_work_order_no" / "created_by" / "created_by_null"）
  function sourceOf(row) {
    const r = row || {};
    const sourceSystem = text(r.source_system);
    if (sourceSystem) {
      const isApp = /^(app|machtile|manual)/i.test(sourceSystem);
      return isApp
        ? { kind: "app", label: "App 手動", basis: "source_system", createdBy: text(r.created_by) || null }
        : { kind: "legacy", label: "舊 MES 派工", basis: "source_system", createdBy: null };
    }
    if (text(r.legacy_mes_source)) return { kind: "legacy", label: "舊 MES 派工", basis: "legacy_mes_source", createdBy: null };
    if (text(r.legacy_work_order_no)) return { kind: "legacy", label: "舊 MES 派工", basis: "legacy_work_order_no", createdBy: null };
    if (text(r.created_by)) return { kind: "app", label: "App 手動", basis: "created_by", createdBy: text(r.created_by) };
    return { kind: "legacy", label: "舊 MES 派工", basis: "created_by_null", createdBy: null };
  }

  // "YYYY-MM-DD"（本地日期）→ 自 1970-01-01 起的日數；不合法回 NaN。用日數比，避開時區與時分。
  function dayNumber(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
    if (!m) return NaN;
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(t) ? Math.round(t / 86400000) : NaN;
  }

  function localToday(now = new Date()) {
    const d = now instanceof Date ? now : new Date(now);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function isClosed(row) {
    return CLOSED_STATUSES.includes(text(row && row.status).toLowerCase());
  }

  // 交期狀態：overdue＝交期已過（今天不算逾期）；soon＝今天起 3 天內；ok；none＝沒有交期；closed＝已完工／出貨／取消（不標顏色）
  function dueState(row, today) {
    if (isClosed(row)) return "closed";
    const due = dayNumber(row && row.due_date);
    const base = dayNumber(today);
    if (!Number.isFinite(due) || !Number.isFinite(base)) return "none";
    const diff = due - base;
    if (diff < 0) return "overdue";
    if (diff <= SOON_DAYS) return "soon";
    return "ok";
  }

  function dueNote(row, today) {
    const due = dayNumber(row && row.due_date);
    const base = dayNumber(today);
    if (isClosed(row) || !Number.isFinite(due) || !Number.isFinite(base)) return "";
    const diff = due - base;
    if (diff < 0) return `逾期 ${-diff} 天`;
    if (diff === 0) return "今天到期";
    if (diff <= SOON_DAYS) return `剩 ${diff} 天`;
    return "";
  }

  // 依交期排序，最急的在最上面：未結案的照交期由早到晚（沒交期的排在後面），已結案的全部放最後；同交期照單號。
  function sortRows(rows) {
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
      const ca = isClosed(a) ? 1 : 0;
      const cb = isClosed(b) ? 1 : 0;
      if (ca !== cb) return ca - cb;
      const da = dayNumber(a && a.due_date);
      const db = dayNumber(b && b.due_date);
      const fa = Number.isFinite(da), fb = Number.isFinite(db);
      if (fa !== fb) return fa ? -1 : 1;
      if (fa && da !== db) return da - db;
      return text(a && a.work_order_no).localeCompare(text(b && b.work_order_no));
    });
  }

  // 搜尋：單號、品名、品號；不分大小寫、忽略空白（含全形空白）。空字串＝全部符合。
  function normalizeQuery(q) {
    return text(q).replace(/[\s　]+/g, "").toLowerCase();
  }

  function matchesQuery(row, query) {
    const q = normalizeQuery(query);
    if (!q) return true;
    return [row && row.work_order_no, row && row.part_name, row && row.part_no]
      .some((v) => normalizeQuery(v).includes(q));
  }

  function matchesFilter(row, filter, today) {
    switch (filter) {
      case "overdue": return dueState(row, today) === "overdue";
      case "legacy": return sourceOf(row).kind === "legacy";
      case "app": return sourceOf(row).kind === "app";
      default: return true;
    }
  }

  function filterRows(rows, { query = "", filter = "all", today } = {}) {
    return sortRows(rows).filter((row) => matchesQuery(row, query) && matchesFilter(row, filter, today));
  }

  function counts(rows, today) {
    const list = Array.isArray(rows) ? rows : [];
    return {
      all: list.length,
      overdue: list.filter((r) => dueState(r, today) === "overdue").length,
      legacy: list.filter((r) => sourceOf(r).kind === "legacy").length,
      app: list.filter((r) => sourceOf(r).kind === "app").length,
    };
  }

  // 進度條寬度（0–100）。數量不合法回 0；超量封頂 100。
  function progressPercent(done, quantity) {
    const q = Number(quantity);
    const d = Math.max(0, Number(done) || 0);
    if (!Number.isFinite(q) || q <= 0) return 0;
    return Math.min(100, Math.round((d / q) * 100));
  }

  // 要不要在送出前跳「會被同步覆蓋」確認：既有的舊 MES 派工單，且機台要改成不一樣的（含改成暫不指派）。
  // existing＝{ source: sourceOf(...), machine_code }；不存在（新單）不跳。
  function needsReassignConfirm(existing, nextMachineCode) {
    if (!existing || !existing.source || existing.source.kind !== "legacy") return false;
    return text(existing.machine_code) !== text(nextMachineCode);
  }

  return {
    SOON_DAYS, CLOSED_STATUSES, FILTERS,
    sourceOf, dayNumber, localToday, isClosed, dueState, dueNote, sortRows,
    normalizeQuery, matchesQuery, matchesFilter, filterRows, counts, progressPercent, needsReassignConfirm,
  };
});
