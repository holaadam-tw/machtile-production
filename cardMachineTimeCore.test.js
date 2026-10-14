const assert = require("node:assert/strict");
const core = require("./cardMachineTimeCore.js");

const order = { workOrderId: "wo-1", processId: "process-1", tenantId: "tenant-1", processStatus: "running", done: 17, total: 40 };
const built = core.buildPayload({
  order,
  actorAppUserId: "user-1",
  endedAt: "2026-10-14T04:30:00.000Z",
  startedAt: "2026-10-14T00:10:00.000Z",
  reportUuid: "report-1",
  cycleTimeSeconds: 125,
});

assert.equal(built.timeOnly, true);
assert.deepEqual(built.operators, ["user-1"]);
assert.equal(built.payload.report_type, "noon");
assert.equal(built.payload.completed_qty, 0);
assert.equal(built.payload.defect_qty, 0);
assert.equal(built.payload.cycle_time_seconds, 125);
assert.equal(built.payload.report_payload.cycle_time_seconds, 125);
assert.equal(built.payload.report_payload.machine_qty, 17);
assert.equal(built.payload.started_at, built.payload.ended_at);
assert.equal(built.payload.report_date, "2026-10-14");
assert.equal("counter_baseline_qty" in built.payload.report_payload, false);
const firstId = core.ensureReportUuid(null, { processId: order.processId, actorAppUserId: "user-1", cycleTimeSeconds: 125 }, () => "uuid-1");
assert.equal(firstId.reused, false);
assert.equal(core.ensureReportUuid(firstId, { processId: order.processId, actorAppUserId: "user-1", cycleTimeSeconds: 125 }, () => "uuid-2").reportUuid, "uuid-1");
assert.equal(core.ensureReportUuid(firstId, { processId: order.processId, actorAppUserId: "user-1", cycleTimeSeconds: 126 }, () => "uuid-2").reportUuid, "uuid-2");
assert.throws(() => core.buildPayload({ order, actorAppUserId: "user-1", endedAt: "2026-10-14T04:30:00.000Z", startedAt: null, reportUuid: "report-2", cycleTimeSeconds: 125 }), /沒有開工時間/);
assert.throws(() => core.buildPayload({ order, actorAppUserId: "user-1", endedAt: "2026-10-14T04:30:00.000Z", startedAt: "2026-10-14T00:10:00.000Z", reportUuid: "report-3", cycleTimeSeconds: 0 }), /大於 0 秒/);

console.log("CARD_MACHINE_TIME_CORE PASS");
