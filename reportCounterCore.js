(function attachMachTileReportCounterCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileReportCounterCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileReportCounterCore() {
  "use strict";

  const ELIGIBLE_TYPES = new Set(["dailyStart", "noon"]);

  function finiteCounter(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function counterFromReport(row) {
    const payload = row?.report_payload && typeof row.report_payload === "object" ? row.report_payload : {};
    return finiteCounter(payload.machine_qty ?? row?.machine_qty);
  }

  function latestBaseline(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter(row => ELIGIBLE_TYPES.has(row?.report_type) && counterFromReport(row) !== null)
      .map(row => ({
        qty: counterFromReport(row),
        source: row.report_type === "noon" ? "report" : "dailyStart",
        createdAt: String(row.created_at || ""),
      }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
  }

  function calculate(currentValue, baselineValue) {
    const current = finiteCounter(currentValue);
    const baseline = finiteCounter(baselineValue);
    if (current === null) return { valid: false, code: "CURRENT_REQUIRED", message: "請填寫機台目前累計數。", current, baseline, delta: null };
    if (baseline === null) return { valid: false, code: "BASELINE_REQUIRED", message: "今天尚無開工或報工基準；請先按開工，或手填基準。", current, baseline, delta: null };
    const delta = current - baseline;
    if (delta <= 0) return { valid: false, code: "NON_POSITIVE_DELTA", message: `機台累計 ${current} 必須大於上次 ${baseline}；這次差額需大於 0。`, current, baseline, delta };
    return { valid: true, code: "OK", message: "", current, baseline, delta };
  }

  function rateReasonableness({ cycleSeconds, startedAt, now, reportedQty } = {}) {
    const seconds = Number(cycleSeconds);
    const startMs = Date.parse(startedAt);
    const nowMs = Date.parse(now);
    const qty = Number(reportedQty);
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(startMs) ||
        !Number.isFinite(nowMs) || nowMs < startMs || !Number.isInteger(qty) || qty < 0) return null;
    const maxQty = Math.floor((nowMs - startMs) / 1000 / seconds);
    return { maxQty, reportedQty: qty, warn: qty > maxQty,
      message: qty > maxQty ? `照工時這段時間最多約 ${maxQty} 件，你報 ${qty} 件，請確認` : "" };
  }

  return { latestBaseline, calculate, rateReasonableness };
});
