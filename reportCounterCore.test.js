const assert = require("node:assert/strict");
const { latestBaseline, calculate, rateReasonableness } = require("./reportCounterCore.js");

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
console.log("PASS: cumulative report counter rules (10 assertions)");
