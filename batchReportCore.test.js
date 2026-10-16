"use strict";
const assert = require("node:assert/strict");
const core = require("./batchReportCore.js");
const counter = require("./reportCounterCore.js");
const order = { processId: "p1", workOrderId: "w1", processStatus: "running", tenantId: "t1", total: 500 };
const base = { machineCode: "A04", order, current: "145", baseline: 130, baselineSource: "report", bad: "2", failReasonCode: "尺寸不良", reportNote: "", operatorId: "u1", operatorMapped: true, startedAt: "2026-10-14T00:00:00.000Z" };

assert.deepEqual(core.GROUPS.lathe.machines, ["A01", "A02", "A03", "A04", "A05"]);
assert.deepEqual(core.GROUPS.mill.machines, ["B03", "B04", "B05", "B06"]);
assert.equal(core.operatorSelectionLimit({ department: "車床課", machineType: "CNC" }), 1);
assert.equal(core.operatorSelectionLimit({ department: "銑床課", machineType: "車床" }), null, "verified department wins over type fallback");
assert.equal(core.operatorSelectionLimit({ machine_type: "CNC Lathe" }), 1);
assert.equal(core.operatorSelectionLimit({ machine_type: "Machining Center" }), null);
assert.deepEqual(core.validateOperatorSelection({ department: "車床課" }, ["u1", "u2"]), { valid: false, code: "LATHE_SINGLE_OPERATOR", max: 1 });
assert.deepEqual(core.validateOperatorSelection({ department: "銑床課" }, ["u1", "u2"]), { valid: true, code: null, max: null });
assert.deepEqual(core.counterCalculation(base), counter.calculate(145, 130), "batch must use the shared cumulative-counter core");
assert.deepEqual(core.validateRow(base), { send: true, empty: false, error: "", good: 15, bad: 2, current: 145, baseline: 130, machineSeconds: null, timeOnly: false });
assert.equal(core.validateRow({ ...base, failReasonCode: "" }).error, "有不良數時，需選擇不良原因");
assert.equal(core.validateRow({ ...base, failReasonCode: "非集中原因" }).error, "有不良數時，需選擇不良原因");
assert.equal(core.validateRow({ ...base, failReasonCode: "其他", reportNote: "" }).error, "選擇其他不良原因時，備註必須填寫一句說明");
assert.equal(core.validateRow({ ...base, failReasonCode: "其他", reportNote: "刀具試切造成" }).send, true);
assert.equal(core.validateRow({ ...base, bad: "0", failReasonCode: "尺寸不良" }).error, "沒有不良品時不可帶不良原因");
assert.equal(core.validateRow({ ...base, current: "130" }).error, "機台累計 130 必須大於上次 130；這次差額需大於 0。");
assert.equal(core.validateRow({ ...base, current: "" }).error, "請填寫機台目前累計數。");
assert.equal(core.validateRow({ ...base, current: "", bad: "" }).empty, true);
assert.equal(core.validateRow({ ...base, baseline: null }).error, "今天尚無開工或報工基準；請先按開工，或手填基準。");

const report = core.buildReportPayload({ row: base, actorAppUserId: "actor", endedAt: "2026-10-14T01:00:00.000Z", reportUuid: "r1" }).payload;
assert.equal(report.report_type, "noon");
assert.equal(report.completed_qty, 15);
assert.equal(report.defect_qty, 2);
assert.equal(report.report_payload.fail_reason_code, "尺寸不良");
assert.equal(report.cycle_time_seconds, null, "batch must never write manual machine time");
assert.deepEqual({ machine_qty: report.report_payload.machine_qty, completed_qty: report.report_payload.completed_qty,
  counter_baseline_qty: report.report_payload.counter_baseline_qty, counter_baseline_source: report.report_payload.counter_baseline_source },
{ machine_qty: 145, completed_qty: 15, counter_baseline_qty: 130, counter_baseline_source: "report" });

const finish = core.buildReportPayload({ row: { ...base, finished: true }, actorAppUserId: "actor", endedAt: "2026-10-14T01:00:00.000Z", reportUuid: "r2" }).payload;
assert.equal(finish.report_type, "finish");
assert.equal(finish.report_payload.overtime_plan, "none");
assert.match(finish.remark, /^\[收工 \/ 完工\]/);
assert.notEqual(core.rowFingerprint(base), core.rowFingerprint({ ...base, finished: true }));

const dailyStartRow = { ...base, mode: "dailyStart", selected: true, order: { ...order, done: 96 } };
assert.equal(core.validateRow({ ...dailyStartRow, selected: false }).empty, true);
assert.deepEqual(core.validateRow(dailyStartRow), { send: true, empty: false, error: "", good: 0, bad: 0, current: 96, baseline: null, machineSeconds: null, timeOnly: false });
const dailyStart = core.buildReportPayload({ row: dailyStartRow, actorAppUserId: "actor", endedAt: "2026-10-14T01:00:00.000Z", reportUuid: "r3" }).payload;
assert.equal(dailyStart.report_type, "dailyStart");
assert.equal(dailyStart.report_payload.machine_qty, 96);
assert.equal(dailyStart.report_payload.fail_reason_code, null);
assert.equal("counter_baseline_qty" in dailyStart.report_payload, false);

const legacyNoon = core.buildReportPayload({ row: { ...base, current: "", legacyGood: "3" }, actorAppUserId: "actor", endedAt: "2026-10-14T01:00:00.000Z", reportUuid: "r4" }).payload;
assert.equal(legacyNoon.report_type, "noon");
assert.equal(legacyNoon.completed_qty, 3);
assert.equal(legacyNoon.process_id, "p1");

assert.deepEqual(core.summarizeStationCommands([], "2026-10-14T04:00:00Z"), { status: "notStarted", minutes: null });
assert.deepEqual(core.summarizeStationCommands([{ command_type: "start", status: "applied", applied_at: "2026-10-14T00:00:00Z" },
  { command_type: "stop", status: "applied", applied_at: "2026-10-14T01:30:00Z" }], "2026-10-14T04:00:00Z"), { status: "stopped", minutes: 90 });
assert.deepEqual(core.summarizeStationCommands([{ command_type: "start", status: "applied", applied_at: "2026-10-14T02:00:00Z" }],
  "2026-10-14T04:00:00Z"), { status: "running", minutes: 120 });
assert.deepEqual(core.batchCommandChoice("start", { status: "running" }, true), { eligible: false, checked: false, reason: "已開工" });
assert.deepEqual(core.batchCommandChoice("start", { status: "stopped" }, true), { eligible: true, checked: true, reason: "" });
assert.deepEqual(core.batchCommandChoice("stop", { status: "notStarted" }, true), { eligible: false, checked: false, reason: "未開工" });
assert.deepEqual(core.batchCommandChoice("stop", { status: "running" }, true), { eligible: true, checked: true, reason: "" });
assert.deepEqual(core.batchCommandChoice("start", { status: "stopped" }, false), { eligible: false, checked: false, reason: "沒有工單" });
console.log("PASS: batch report cumulative payload, compatibility routes, finish toggle, and station-command shift summary");
