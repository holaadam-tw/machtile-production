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

  function isCycleTimeOnlyReport(row) {
    if (!row || row.report_type !== "noon" || Number(row.completed_qty) !== 0 || Number(row.defect_qty) !== 0 || !(Number(row.cycle_time_seconds) > 0)) return false;
    const start = Date.parse(row.started_at);
    const end = Date.parse(row.ended_at);
    return Number.isFinite(start) && Number.isFinite(end) && start === end;
  }

  function latestBaseline(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter(row => ELIGIBLE_TYPES.has(row?.report_type) && !isCycleTimeOnlyReport(row) && counterFromReport(row) !== null)
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

  function finishTotal(totalValue, reportedValue) {
    const total = finiteCounter(totalValue);
    const reported = finiteCounter(reportedValue);
    if (total === null) return { valid: false, code: "TOTAL_REQUIRED", message: "請填寫這一道總完成數。", total, reported, delta: null };
    if (reported === null) return { valid: false, code: "REPORTED_REQUIRED", message: "讀不到這一道已報數量，請重新整理後再試。", total, reported, delta: null };
    const delta = total - reported;
    if (delta < 0) return { valid: false, code: "TOTAL_BELOW_REPORTED", message: `總數不能小於已報的 ${reported} 件；報錯請用報工修正`, total, reported, delta };
    if (total === 0 && reported === 0) return { valid: false, code: "ZERO_TOTAL", message: "這一道還沒有報工數量，不能完工關站；請先報工", total, reported, delta };
    return { valid: true, code: "OK", message: "", total, reported, delta };
  }

  // Owner 2026-10-29: every counter entry is the machine's current total for
  // this order.  The reported total is authoritative and must be freshly read
  // from the same source as the card before this function is used.
  // Owner 2026-10-31: the machine counter INCLUDES defective parts.  The
  // counter position already reported is therefore goodDone + failDone, and the
  // good quantity of this report is total - (goodDone + failDone) - thisFail.
  // `delta` keeps meaning "good quantity to send" for every caller; `added` is
  // the parts made since the last report (good + this-time defects).
  // failDone unknown (null): fail = 0 keeps the goodDone-only baseline; fail > 0
  // fails closed instead of guessing.
  function totalSemantics(totalValue, reportedValue, startValue = null, options = {}) {
    const total = finiteCounter(totalValue);
    const reported = finiteCounter(reportedValue);
    const start = finiteCounter(startValue);
    const failReported = finiteCounter(options?.failDone);
    const failRaw = options?.fail;
    const fail = failRaw === null || failRaw === undefined || failRaw === "" ? 0 : Number(failRaw);
    const base = { total, current: total, reported, failReported, start, fail };
    const blocked = (code, message, extra = {}) => ({ valid: false, code, message, ...base, baseline: extra.baseline ?? reported, delta: extra.delta ?? null, added: extra.added ?? null, good: null, backfill: 0, today: 0, reports: [] });
    if (total === null) return blocked("TOTAL_REQUIRED", "請填寫機台目前顯示總數（這張單）。");
    if (reported === null) return blocked("REPORTED_REQUIRED", "暫時無法核對已報數量，請稍後再按");
    if (!Number.isInteger(fail) || fail < 0) return blocked("FAIL_INVALID", "良品與這次不良數不可小於 0。");
    if (failReported === null && fail > 0) return blocked("FAIL_REPORTED_REQUIRED", "暫時無法核對已報不良數，請稍後再按");
    const baseline = reported + (failReported ?? 0);
    if (total < baseline) return blocked("TOTAL_BELOW_REPORTED", "機台數字比系統少，請確認是這張單的數字", { baseline, delta: total - baseline, added: total - baseline });
    const added = total - baseline;
    const good = added - fail;
    if (good < 0) return blocked("FAIL_EXCEEDS_ADDED", "不良數比這次多出來的件數還多，請確認", { baseline, added });
    const backfill = start === null ? 0 : Math.min(good, Math.max(0, Math.min(total, start) - baseline));
    const today = good - backfill;
    const payload = { start_counter: start, reported_before: reported, backfill_qty: backfill, counter_today_qty: today };
    const reports = [{ kind: "total_delta", good, fail, payload }];
    return { valid: true, code: "OK", message: "", ...base, baseline, delta: good, added, good, backfill, today, reports };
  }

  function efficiencyPayload(result) {
    const good = Number(result?.delta);
    const reported = Number(result?.reported);
    const start = Number.isInteger(result?.start) ? result.start : null;
    if (!result?.valid || !Number.isInteger(good) || !Number.isInteger(reported)) return null;
    const backfillQty = Number.isInteger(result?.backfill) ? result.backfill
      : start === null ? 0 : Math.max(0, Math.min(result.total, start) - reported);
    return {
      start_counter: start,
      reported_before: reported,
      backfill_qty: backfillQty,
      counter_today_qty: good - backfillQty,
    };
  }

  function backfillRemark(result, remark = "") {
    const note = String(remark || "");
    const qty = Number(result?.backfill);
    return `${Number.isInteger(qty) && qty > 0 ? `含前一班未報 ${qty} 件；` : ""}${note}` || null;
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

  return { isCycleTimeOnlyReport, latestBaseline, calculate, finishTotal, totalSemantics, efficiencyPayload, backfillRemark, rateReasonableness };
});
