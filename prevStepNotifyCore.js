// prevStepNotifyCore.js — 報工／關站被「上一道」擋住時，白話寫出卡在哪一台／哪一道、找誰，以及「通知生管」。
//
// Owner 2026-11-14「照建議」（ops/codex-inbox/20261114-1630-report-friction/REPORT.md）：
//   上一道造成的擋（報工 QTY_EXCEEDS_AVAILABLE 且有上一道、關站 PREVIOUS_STEP_OPEN、PREV_OUTSOURCE_RECEIPT_REQUIRED）
//   要寫清楚找誰，並可按「通知生管」；生管在管理頁看板看到。
// 旗標（預設都 false；關＝畫面與行為跟以前一模一樣）：
//   config.enablePrevStepBlockHint  只顯示「卡在哪一台／哪一道、找誰」那一句。
//   config.enablePrevStepNotify     再加「通知生管」鍵＋管理頁看板（需要雲端 migration 20261114170000）。
//   config.hideLegacyReportForStationMachines  A/B 機台已開智慧報工時，不再走直接寫 production_reports 的舊報工（REPORT #9）。
// 讀的欄位（Factory，只讀、缺欄位＝不顯示）：
//   報工預覽 preview_result.previous_station_code / previous_step_name（#1120）、
//   legacy_snapshot.report.guard.Details.prev_index_sn / previous_station_code / previous_step_name /
//   blocked_short_qty / previous_vendor_name / blocked_by_outsource（softnet-mes #1149）；
//   關站 legacy_snapshot.previous_station_code / previous_index_sn（#1149，ClosePreviousStepStaleRelaxEnabled 開時才有）。
// DOM 與 fetch 留在 app.js；這裡只做可測的決策。畫面文字一律回 i18n key（i18n.js 兩種語言都要有）。
(function attachMachTilePrevStepNotifyCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTilePrevStepNotifyCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTilePrevStepNotifyCore() {
  "use strict";

  const CODES = Object.freeze(["QTY_EXCEEDS_AVAILABLE", "PREVIOUS_STEP_OPEN", "PREV_OUTSOURCE_RECEIPT_REQUIRED"]);
  const NOTIFY_RPC = "machtile_notify_prev_step_block";
  const LIST_RPC = "machtile_prev_step_block_notices";
  const RESOLVE_RPC = "machtile_resolve_prev_step_block_notice";
  const MACHINE_RE = /^[A-Z0-9_-]{1,30}$/;
  const STATION_MACHINE_RE = /^[AB]\d{2}$/;
  const BOARD_ROLES = Object.freeze(["admin", "manager", "planner"]);

  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const text = (value) => (typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "");
  const machine = (value) => { const code = text(value).toUpperCase(); return MACHINE_RE.test(code) ? code : ""; };
  const wholeNumber = (value, max = 1000000) => (Number.isInteger(value) && value >= 0 && value <= max ? value : null);
  const positiveIndex = (value) => { const n = typeof value === "string" && /^\d{1,3}$/.test(value.trim()) ? Number(value) : value; return Number.isInteger(n) && n > 0 && n <= 999 ? n : null; };
  const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

  function hintEnabled(config) { return config?.enablePrevStepBlockHint === true || config?.enablePrevStepNotify === true; }
  function notifyEnabled(config) { return config?.enablePrevStepNotify === true; }
  function boardAllowed(config, role) { return notifyEnabled(config) && BOARD_ROLES.includes(text(role).toLowerCase()); }

  function guardOf(snapshot) {
    const guard = snapshot?.report?.guard;
    return isObject(guard) ? guard : null;
  }
  function detailsOf(guard) {
    const details = guard && (guard.Details || guard.details);
    return isObject(details) ? details : {};
  }

  // station_commands 列 → 上一道擋住的資訊；不是上一道造成的擋（或讀不到）→ null。只讀。
  // receipt：呼叫端可傳 stationReportCore.findOutsourceReceiptSnapshot(row) 的結果（委外收貨擋才用得到）。
  function blockInfo(row, { receipt = null } = {}) {
    if (!isObject(row)) return null;
    const type = text(row.command_type);
    const status = text(row.status).toLowerCase();
    let code = "";
    let preview = null;
    let snapshot = isObject(row.legacy_snapshot) ? row.legacy_snapshot : {};
    if (type === "report_preview") {
      preview = isObject(row.preview_result) ? row.preview_result : null;
      if (status === "previewed") {
        if (!preview || preview.allowed !== false) return null;
        snapshot = isObject(preview.legacy_snapshot) ? preview.legacy_snapshot : {};
        code = text(first(preview.guard_code, guardOf(snapshot)?.code));
      } else if (status === "rejected") code = text(row.reject_code);
    } else if (status === "rejected") code = text(row.reject_code);
    code = code.toUpperCase();
    if (!CODES.includes(code)) return null;

    if (code === "PREVIOUS_STEP_OPEN") {
      if (type && type !== "close") return null;
      const station = machine(snapshot.previous_station_code);
      const indexSn = positiveIndex(snapshot.previous_index_sn);
      return { code, station, indexSn, stepName: "", vendor: "", shortQty: null, outsource: false };
    }

    const guard = guardOf(snapshot);
    const details = detailsOf(guard);
    if (code === "PREV_OUTSOURCE_RECEIPT_REQUIRED") {
      const steps = Array.isArray(receipt?.receiptSteps) ? receipt.receiptSteps : [];
      const step = steps.find((item) => text(item?.vendorName) || text(item?.processName)) || {};
      return {
        code, station: "", indexSn: positiveIndex(first(step.indexSn, details.prev_index_sn, guard?.prev_index_sn)),
        stepName: text(first(step.processName, receipt?.previousStepName, details.previous_step_name)),
        vendor: text(first(step.vendorName, details.previous_vendor_name)),
        shortQty: wholeNumber(receipt?.receiptRequiredQty), outsource: true,
      };
    }

    // QTY_EXCEEDS_AVAILABLE：只有「上一道」造成的才算（第一道／工單本身不夠 → null，照原本那句）。
    const indexSn = positiveIndex(first(details.prev_index_sn, guard?.prev_index_sn, preview?.prev_index_sn));
    if (!indexSn) return null;
    const outsource = details.blocked_by_outsource === true || text(first(details.prev_kind, preview?.prev_kind)).toUpperCase() === "OUTSOURCE";
    const requested = wholeNumber(first(preview?.requested, guard?.requested, details.requested));
    const available = Number.isInteger(first(preview?.available, details.available)) ? first(preview?.available, details.available) : null;
    const derivedShort = requested !== null && available !== null ? Math.max(0, requested - Math.max(0, available)) : null;
    return {
      code,
      station: outsource ? "" : machine(first(details.previous_station_code, preview?.previous_station_code)),
      indexSn,
      stepName: text(first(details.previous_step_name, preview?.previous_step_name)),
      vendor: outsource ? text(details.previous_vendor_name) : "",
      shortQty: wholeNumber(first(details.blocked_short_qty, derivedShort)),
      outsource,
    };
  }

  // 一句白話（i18n key ＋參數）。
  function message(info) {
    if (!info) return null;
    const params = { station: info.station, index: info.indexSn ?? "?", step: info.stepName || "—", vendor: info.vendor || "—", short: info.shortQty ?? "?" };
    if (info.code === "PREVIOUS_STEP_OPEN") {
      return { key: info.station ? "prev_block_close_station" : "prev_block_close_generic", params };
    }
    if (info.code === "PREV_OUTSOURCE_RECEIPT_REQUIRED") return { key: "prev_block_receipt", params };
    if (info.outsource) return { key: "prev_block_qty_outsource", params };
    if (info.station) return { key: info.shortQty === null ? "prev_block_qty_station_noshort" : "prev_block_qty_station", params };
    return { key: "prev_block_qty_index", params };
  }

  // 「通知生管」送出的 payload（雲端 RPC machtile_notify_prev_step_block 的 p_payload）。不合法 → null（不送）。
  function buildNotifyPayload(info, { machineCode, workOrderNo, processOrder, messageText } = {}) {
    if (!info || !CODES.includes(info.code)) return null;
    const code = machine(machineCode);
    const order = text(workOrderNo);
    const step = typeof processOrder === "number" ? processOrder
      : /^\d{1,3}$/.test(String(processOrder ?? "").trim()) ? Number(processOrder) : NaN;
    const msg = text(messageText).slice(0, 500);
    if (!code || !order || order.length > 60 || !Number.isInteger(step) || step < 0 || step > 999 || !msg) return null;
    return {
      machine_code: code,
      work_order_no: order,
      process_order: step,
      reason_code: info.code,
      blocking_machine_code: info.station || null,
      blocking_process_order: info.indexSn ?? null,
      blocking_step_name: info.stepName ? info.stepName.slice(0, 100) : null,
      blocking_vendor_name: info.vendor ? info.vendor.slice(0, 100) : null,
      short_qty: info.shortQty ?? null,
      message: msg,
    };
  }

  function notifyResultKey(result) {
    const value = text(result?.result);
    if (value === "created" || value === "repeated") return "prev_block_notify_sent";
    if (value === "throttled") return "prev_block_notify_already";
    return "prev_block_notify_failed";
  }
  function notifyErrorKey(error) {
    const message = String(error?.message || error || "");
    if (/404|PGRST202|function .* not found|schema cache/i.test(message)) return "prev_block_notify_unavailable";
    if (/MACHINE_NOT_ALLOWED/.test(message)) return "prev_block_notify_not_allowed";
    return "prev_block_notify_failed";
  }

  // 看板列（生管）→ 一行白話。
  function boardLine(row) {
    if (!isObject(row)) return null;
    const info = { code: text(row.reason_code), station: machine(row.blocking_machine_code), indexSn: positiveIndex(row.blocking_process_order),
      stepName: text(row.blocking_step_name), vendor: text(row.blocking_vendor_name), shortQty: wholeNumber(row.short_qty),
      outsource: Boolean(text(row.blocking_vendor_name)) || text(row.reason_code) === "PREV_OUTSOURCE_RECEIPT_REQUIRED" };
    if (!CODES.includes(info.code)) return null;
    return { id: text(row.id), machine: machine(row.machine_code), workOrderNo: text(row.work_order_no), processOrder: Number(row.process_order),
      count: Number.isInteger(row.notify_count) ? row.notify_count : 1, lastAt: text(row.last_notified_at), status: text(row.status),
      message: message(info), raw: text(row.message) };
  }

  // REPORT #9：A/B 機台已開智慧報工（stationReportMachines 有它、enableStationReport 開）時，
  // 單台報工表單的「午報／完工」不可再退回直接寫 production_reports（那筆只進雲端、不會進舊 MES）。
  function legacyReportBlocked(config, machineCode, reportType) {
    if (config?.hideLegacyReportForStationMachines !== true || config?.enableStationReport !== true) return false;
    const code = text(machineCode).toUpperCase();
    if (!STATION_MACHINE_RE.test(code) || !["noon", "finish"].includes(text(reportType))) return false;
    const allowed = Array.isArray(config.stationReportMachines) ? config.stationReportMachines.map((item) => text(item).toUpperCase()) : [];
    return allowed.includes(code) || allowed.includes("*");
  }

  return Object.freeze({
    CODES, NOTIFY_RPC, LIST_RPC, RESOLVE_RPC, BOARD_ROLES,
    hintEnabled, notifyEnabled, boardAllowed, blockInfo, message, buildNotifyPayload,
    notifyResultKey, notifyErrorKey, boardLine, legacyReportBlocked,
  });
});
