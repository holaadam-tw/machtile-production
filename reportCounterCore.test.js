const assert = require("node:assert/strict");
const { latestBaseline, calculate, finishTotal, totalSemantics, efficiencyPayload, backfillRemark, rateReasonableness } = require("./reportCounterCore.js");

const start = { report_type: "dailyStart", created_at: "2026-10-13T00:10:00Z", report_payload: { machine_qty: 100 } };
const report = { report_type: "noon", created_at: "2026-10-13T03:00:00Z", report_payload: { machine_qty: 145 } };
const cycleOnly = { ...report, created_at: "2026-10-13T04:00:00Z", started_at: "2026-10-13T04:00:00Z", ended_at: "2026-10-13T04:00:00Z", completed_qty: 0, defect_qty: 0, cycle_time_seconds: 125, report_payload: { machine_qty: 999, cycle_time_seconds: 125 } };
assert.deepEqual(latestBaseline([start]), { qty: 100, source: "dailyStart", createdAt: start.created_at }, "daily start is a baseline");
assert.deepEqual(latestBaseline([report, start]), { qty: 145, source: "report", createdAt: report.created_at }, "later report wins over daily start");
assert.deepEqual(latestBaseline([cycleOnly, report, start]), { qty: 145, source: "report", createdAt: report.created_at }, "cycle-time-only report never becomes the counter or efficiency baseline");
assert.equal(calculate(145, 145).code, "NON_POSITIVE_DELTA", "equal cumulative count is blocked");
assert.equal(calculate(144, 145).code, "NON_POSITIVE_DELTA", "lower cumulative count is blocked");
assert.deepEqual(calculate(160, 145), { valid: true, code: "OK", message: "", current: 160, baseline: 145, delta: 15 }, "positive delta is sent as good quantity");
const first = calculate(145, latestBaseline([start]).qty);
const second = calculate(160, latestBaseline([start, { ...report, report_payload: { machine_qty: 145 } }]).qty);
assert.equal(first.delta, 45, "first report uses daily-start counter");
assert.equal(second.delta, 15, "second report uses first report cumulative counter");
assert.equal(calculate(10, null).code, "BASELINE_REQUIRED", "missing baseline requires start or manual baseline");
assert.equal(rateReasonableness({ cycleSeconds: 100, startedAt: "2026-10-13T01:00:00Z", now: "2026-10-13T01:10:00Z", reportedQty: 7 }).warn, true, "quantity over elapsed capacity warns");
assert.equal(rateReasonableness({ cycleSeconds: 100, startedAt: "2026-10-13T01:00:00Z", now: "2026-10-13T01:10:00Z", reportedQty: 6 }).warn, false, "quantity at elapsed capacity is normal");
assert.equal(finishTotal(560, 300).delta, 260, "1 noon 300 then total 560 sends 260");
assert.deepEqual(finishTotal(300, 300), { valid: true, code: "OK", message: "", total: 300, reported: 300, delta: 0 }, "2 unchanged total may close with zero supplement");
assert.equal(finishTotal(560, 300).valid, true, "3 yesterday's cumulative reported quantity remains usable");
assert.equal(finishTotal(560, 300).delta, 260, "4 machine counter reset is irrelevant to finish total");
assert.equal(finishTotal(299, 300).message, "總數不能小於已報的 300 件；報錯請用報工修正", "5 total below reported is blocked with correction guidance");
assert.equal(finishTotal(560, 300).reported, 300, "6 reported quantity is independent of current operator");
assert.equal(finishTotal(560, 300).reported, 300, "7 legacy MES reports are accepted through card progress total");
assert.equal(finishTotal(0, 0).message, "這一道還沒有報工數量，不能完工關站；請先報工", "8 zero throughout is blocked");
assert.equal(finishTotal(120, 110).delta, 10, "9 over-plan actual total remains sendable");
assert.deepEqual(totalSemantics(170, 140, 150).reports.map(({ kind, good }) => ({ kind, good })), [
  { kind: "total_delta", good: 30 },
], "total semantics sends one report while retaining backfill metadata");
assert.deepEqual(totalSemantics(170, 150, 150).reports.map(({ kind, good }) => ({ kind, good })), [
  { kind: "total_delta", good: 20 },
], "reported at start counter sends one delta");
assert.equal(totalSemantics(130, 140, 150).code, "TOTAL_BELOW_REPORTED", "machine total below reported is blocked");
assert.equal(totalSemantics(170, null, 150).code, "REPORTED_REQUIRED", "missing fresh reported total fails closed");
assert.equal(totalSemantics(150, 150, 150).delta, 0, "equal total preserves the existing zero-report rule");
assert.deepEqual(efficiencyPayload(totalSemantics(170, 140, 150)), {
  start_counter: 150, reported_before: 140, backfill_qty: 10, counter_today_qty: 20,
}, "smart-report efficiency payload separates the pre-shift gap without splitting the report");
assert.deepEqual(efficiencyPayload(totalSemantics(170, 150, 150)), {
  start_counter: 150, reported_before: 150, backfill_qty: 0, counter_today_qty: 20,
}, "reported-at-start has no backfill");
assert.deepEqual(efficiencyPayload(totalSemantics(170, 140, null)), {
  start_counter: null, reported_before: 140, backfill_qty: 0, counter_today_qty: 30,
}, "missing start counter is explicit and all delta belongs to today");
assert.deepEqual(efficiencyPayload(totalSemantics(253, 250, 260)), {
  start_counter: 260, reported_before: 250, backfill_qty: 3, counter_today_qty: 0,
}, "when S exceeds total, all of the delta is pre-shift backfill");
assert.equal(backfillRemark(totalSemantics(253, 250, 260), "交班"), "含前一班未報 3 件；交班", "remark uses the same core backfill calculation");
assert.equal(backfillRemark(totalSemantics(170, 150, 150), "交班"), "交班", "zero backfill does not print a zero annotation");
// Owner 2026-10-31: the machine counter includes defective parts.
const pick = (r) => ({ valid: r.valid, code: r.code, good: r.delta, fail: r.fail });
assert.deepEqual(pick(totalSemantics(761, 750, null, { failDone: 0, fail: 1 })), { valid: true, code: "OK", good: 10, fail: 1 }, "761 with 750 good reported and 1 defect now sends good 10 + fail 1");
assert.equal(totalSemantics(761, 750, null, { failDone: 0, fail: 1 }).added, 11, "added counts the parts made since the last report, defects included");
assert.equal(totalSemantics(761, 750, null, { failDone: 0, fail: 1 }).baseline, 750, "baseline is goodDone + failDone");
assert.deepEqual(pick(totalSemantics(761, 750, null, { failDone: 5, fail: 1 })), { valid: true, code: "OK", good: 5, fail: 1 }, "already-reported defects are part of the counter baseline");
assert.equal(totalSemantics(761, 750, null, { failDone: 5, fail: 1 }).baseline, 755, "baseline 750 + 5");
const over = totalSemantics(761, 750, null, { failDone: 0, fail: 12 });
assert.equal(over.code, "FAIL_EXCEEDS_ADDED", "this-time defects above the added parts are blocked");
assert.equal(over.message, "不良數比這次多出來的件數還多，請確認");
assert.equal(over.valid, false);
assert.deepEqual(pick(totalSemantics(761, 750, null, { failDone: 0, fail: 11 })), { valid: true, code: "OK", good: 0, fail: 11 }, "fail-only stays representable (factory FAIL_ONLY ack decides)");
assert.deepEqual(pick(totalSemantics(761, 750, null, { failDone: null, fail: 0 })), pick(totalSemantics(761, 750, null)), "failDone unknown + fail 0 keeps the old goodDone-only behaviour");
assert.equal(totalSemantics(761, 750, null, { failDone: null, fail: 0 }).delta, 11, "unknown failDone + fail 0 = today's 11");
const unknown = totalSemantics(761, 750, null, { failDone: null, fail: 1 });
assert.equal(unknown.code, "FAIL_REPORTED_REQUIRED", "failDone unknown + fail > 0 fails closed");
assert.equal(unknown.message, "暫時無法核對已報不良數，請稍後再按");
assert.equal(totalSemantics(752, 750, null, { failDone: 5, fail: 0 }).code, "TOTAL_BELOW_REPORTED", "total below goodDone + failDone is blocked");
assert.deepEqual(efficiencyPayload(totalSemantics(761, 750, 755, { failDone: 0, fail: 1 })), {
  start_counter: 755, reported_before: 750, backfill_qty: 5, counter_today_qty: 5,
}, "backfill is measured from the full counter baseline and stays within the good quantity");
assert.deepEqual(efficiencyPayload(totalSemantics(752, 750, 760, { failDone: 0, fail: 1 })), {
  start_counter: 760, reported_before: 750, backfill_qty: 1, counter_today_qty: 0,
}, "backfill never exceeds the good quantity (RPC contract backfill_qty <= good)");
assert.deepEqual(efficiencyPayload(totalSemantics(761, 750, 758, { failDone: 5, fail: 1 })), {
  start_counter: 758, reported_before: 755, backfill_qty: 3, counter_today_qty: 2,
}, "reported_before is the counter baseline (good + defect) the backfill was measured from");
assert.equal(totalSemantics(761, 750, null, { failDone: 5, fail: 1 }).reports[0].payload.reported_before, 755, "report payload carries the same baseline");
assert.deepEqual(efficiencyPayload({ valid: true, delta: 5, reported: 750, baseline: 755, total: 761, start: 758 }), {
  start_counter: 758, reported_before: 755, backfill_qty: 3, counter_today_qty: 2,
}, "fallback (no precomputed backfill) uses the same baseline");
console.log("PASS: cumulative report counter and finish-total rules (49 assertions)");
