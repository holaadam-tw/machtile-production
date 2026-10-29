const assert = require("node:assert/strict");
const { latestBaseline, calculate, finishTotal, totalSemantics, efficiencyPayload, rateReasonableness } = require("./reportCounterCore.js");

const start = { report_type: "dailyStart", created_at: "2026-10-13T00:10:00Z", report_payload: { machine_qty: 100 } };
const report = { report_type: "noon", created_at: "2026-10-13T03:00:00Z", report_payload: { machine_qty: 145 } };
assert.deepEqual(latestBaseline([start]), { qty: 100, source: "dailyStart", createdAt: start.created_at }, "daily start is a baseline");
assert.deepEqual(latestBaseline([report, start]), { qty: 145, source: "report", createdAt: report.created_at }, "later report wins over daily start");
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
  { kind: "start_backfill", good: 10 }, { kind: "counter_today", good: 20 },
], "total semantics splits the pre-start gap from today's output");
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
console.log("PASS: cumulative report counter and finish-total rules (27 assertions)");
