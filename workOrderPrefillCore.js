// workOrderPrefillCore.js — 建單表單「貼單號→其餘欄位自動帶出」的純邏輯。
//
// 為什麼存在：派工橋（2026-07-15 起 LIVE）已經把 MES 工單同步進 work_orders，
// 品號／品名／數量／交期在資料庫裡都有；但建單表單仍要求人逐格手打，欄位標籤
// 甚至寫著「請照抄 ERP/MES 派工單號」。16 碼單號抄錯一碼不會當場報錯，要到現場
// 掃碼被拒才發現，錯誤深埋難查。（UI_ISSUE_LOG ISSUE-007）
//
// DOM 與 fetch 留在 app.js；這裡只做可測的決策：哪幾格該填、填什麼、哪幾格不能動。
(function attachMachTileWorkOrderPrefillCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileWorkOrderPrefillCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileWorkOrderPrefillCore() {
  "use strict";

  // 表單欄位 ← work_orders 欄位。順序決定提示文字裡的列舉順序。
  const FIELD_MAP = Object.freeze([
    Object.freeze({ field: "partNo", source: "part_no", label: "品號" }),
    Object.freeze({ field: "partName", source: "part_name", label: "品名" }),
    Object.freeze({ field: "qty", source: "quantity", label: "數量" }),
    Object.freeze({ field: "due", source: "due_date", label: "交期" }),
    Object.freeze({ field: "process", source: "process_name", label: "製程名稱" }),
    Object.freeze({ field: "machine", source: "machine_code", label: "指派機台" }),
  ]);

  // 從 Excel／LINE 貼過來常夾空白與全形字；單號本身只會是英數。
  // 刻意不去掉連字號：有些單號真的含 '-'，去掉會查不到而不是查錯，
  // 但那會讓人以為「橋沒同步」。寧可原樣送查、查不到就明講。
  function normalizeWorkOrderNo(value) {
    return String(value ?? "")
      .replace(/[\u3000\s]+/g, "")
      .toUpperCase()
      .trim();
  }

  function isBlank(value) {
    return value === null || value === undefined || String(value).trim() === "";
  }

  // date 欄位只吃 yyyy-MM-dd；DB 可能給 ISO 或帶時間。
  function asDateInputValue(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : "";
  }

  function readSource(record, entry) {
    if (entry.source === "due_date") return asDateInputValue(record.due_date);
    if (entry.source === "quantity") {
      const n = Number(record.quantity);
      return Number.isFinite(n) && n > 0 ? String(n) : "";
    }
    return isBlank(record[entry.source]) ? "" : String(record[entry.source]).trim();
  }

  // 回傳「要填哪幾格」而不是直接改 DOM，這樣可以測，也讓呼叫端決定怎麼呈現。
  //
  //   record  work_orders 這一列（沒查到就傳 null）
  //   current 目前表單各欄的值
  //   edited  使用者手動改過的欄位（真值＝不准覆蓋）
  function planPrefill({ record, current, edited } = {}) {
    const cur = current || {};
    const dirty = edited || {};
    if (!record || isBlank(record.work_order_no)) {
      return Object.freeze({ status: "no-record", fill: Object.freeze({}), filledLabels: Object.freeze([]), keptLabels: Object.freeze([]) });
    }
    const fill = {};
    const filledLabels = [];
    const keptLabels = [];
    for (const entry of FIELD_MAP) {
      const incoming = readSource(record, entry);
      if (!incoming) continue;
      if (dirty[entry.field]) {
        // 使用者已經自己改過這格 —— 帶入會蓋掉他的判斷，只在有差異時提醒。
        if (String(cur[entry.field] ?? "").trim() !== incoming) keptLabels.push(entry.label);
        continue;
      }
      if (String(cur[entry.field] ?? "").trim() === incoming) continue;
      fill[entry.field] = incoming;
      filledLabels.push(entry.label);
    }
    return Object.freeze({
      status: filledLabels.length ? "filled" : "nothing-to-fill",
      fill: Object.freeze(fill),
      filledLabels: Object.freeze(filledLabels),
      keptLabels: Object.freeze(keptLabels),
    });
  }

  // 提示文字也放這裡，才測得到「查無此單」不會被說成「已帶入」。
  function prefillNote(plan) {
    if (!plan) return "";
    if (plan.status === "no-record") {
      return "查無此派工單號 — 請確認單號，或此單尚未由派工橋同步；也可以手動填寫下面欄位。";
    }
    const parts = [];
    if (plan.filledLabels.length) parts.push(`已帶入 ${plan.filledLabels.join("、")}（可修改）`);
    if (plan.keptLabels.length) parts.push(`${plan.keptLabels.join("、")} 保留你手動輸入的值`);
    if (!parts.length) return "此單資料與資料庫一致，無需帶入。";
    return parts.join("；");
  }

  return { FIELD_MAP, normalizeWorkOrderNo, asDateInputValue, planPrefill, prefillNote };
});
