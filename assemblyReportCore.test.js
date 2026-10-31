"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./assemblyReportCore.js");

const uuid = "00000000-0000-4000-8000-000000000123";

test("flag off returns no stations; flag on defaults to F01 and ignores non-assembly codes", () => {
  assert.deepEqual(core.enabledStations({}), []);
  assert.deepEqual(core.enabledStations({ assemblyReportEnabled: "true", assemblyStations: ["F01"] }), []);
  assert.deepEqual(core.enabledStations({ assemblyReportEnabled: true, assemblyReportTenants: ["a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f"] }, "a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f"), ["F01"]);
  assert.deepEqual(core.enabledStations({ assemblyReportEnabled: true, assemblyReportTenants: ["a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f"], assemblyStations: ["f01", "G01", "A04", "F01"] }, "a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f"), ["F01", "G01"]);
  assert.equal(core.isAssemblyStation({ assemblyReportEnabled: true, assemblyReportTenants: ["a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f"] }, "F01", "a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f"), true);
  assert.equal(core.isAssemblyStation({ assemblyReportEnabled: true, assemblyReportTenants: ["a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f"] }, "A04", "a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f"), false);
  assert.deepEqual(core.enabledStations({ assemblyReportEnabled: true }), [], "flag on but no tenant gate = off");
});

test("ordersForStation lists every open order on the station, running first then due date", () => {
  const orders = [
    { id: "WO-3", processId: "p3", machine: "F01", processStatus: "pending", dueDate: "2026-11-05" },
    { id: "WO-1", processId: "p1", machine: "F01", processStatus: "running", dueDate: "2026-11-09" },
    { id: "WO-2", processId: "p2", machine: "F01", processStatus: "pending", dueDate: "2026-11-01" },
    { id: "WO-X", processId: "px", machine: "F01", processStatus: "completed" },
    { id: "WO-Y", processId: "py", machine: "F01", processStatus: "pending", offStation: true },
    { id: "WO-Z", processId: "pz", machine: "A04", processStatus: "running" },
    { id: "WO-N", processId: null, machine: "F01", processStatus: "running" },
  ];
  assert.deepEqual(core.ordersForStation(orders, "f01").map((o) => o.id), ["WO-1", "WO-2", "WO-3"]);
});

test("G01 line split uses model prefixes in the part name (longest prefix, A/P only before a digit)", () => {
  assert.equal(core.lineOf("DSHG-02 電磁閥"), "valve");
  assert.equal(core.lineOf("PV2R1-19 葉片泵"), "pump");
  assert.equal(core.lineOf("AR16-FR01 柱塞泵"), "pump");
  assert.equal(core.lineOf("A10 柱塞泵"), "pump");
  assert.equal(core.lineOf("PF-02 閥"), "valve");
  assert.equal(core.lineOf("中座"), "valve");
  assert.equal(core.lineOf("油水分離機 SLC-150"), "other");
  assert.equal(core.stationHasLines({}, "G01"), true);
  assert.equal(core.stationHasLines({}, "F01"), false);
});

test("operators: only mapped users, me first, default = me; toggle adds/removes", () => {
  const choices = core.operatorChoices([
    { id: "u2", name: "陳大華", legacy_user_id: "1002" },
    { id: "u1", name: "王小明", legacy_user_id: "1001" },
    { id: "u9", name: "未對照", legacy_user_id: "" },
  ], "u1");
  assert.deepEqual(choices.map((c) => [c.id, c.isMe]), [["u1", true], ["u2", false]]);
  assert.deepEqual(core.defaultOperatorIds(choices, "u1"), ["u1"]);
  assert.deepEqual(core.defaultOperatorIds(choices, "u9"), []);
  assert.deepEqual(core.toggleOperator(["u1"], "u2"), ["u1", "u2"]);
  assert.deepEqual(core.toggleOperator(["u1", "u2"], "u1"), ["u2"]);
});

test("validateForm: good-only, defect needs reason, 其他 needs note, operators required, finish allows 0", () => {
  const choices = [{ id: "u1" }, { id: "u2" }];
  const reasons = ["尺寸不良", "其他"];
  const ok = core.validateForm({ good: "12", operatorIds: ["u1", "u2"] }, { failReasons: reasons, choices });
  assert.equal(ok.ok, true);
  assert.equal(ok.goodQty, 12); assert.equal(ok.failQty, 0); assert.equal(ok.failReasonCode, null);
  assert.deepEqual(ok.operatorIds, ["u1", "u2"]);
  // defect closed: bad typed earlier is ignored
  assert.equal(core.validateForm({ good: "3", bad: "9", defectOpen: false, operatorIds: ["u1"] }, { failReasons: reasons, choices }).failQty, 0);
  assert.equal(core.validateForm({ good: "", operatorIds: ["u1"] }, { failReasons: reasons, choices }).errors.good, "qty_required");
  assert.equal(core.validateForm({ good: "1.5", operatorIds: ["u1"] }, { failReasons: reasons, choices }).errors.good, "qty_invalid");
  assert.equal(core.validateForm({ good: "5", bad: "2", defectOpen: true, operatorIds: ["u1"] }, { failReasons: reasons, choices }).errors.failReasonCode, "reason_required");
  assert.equal(core.validateForm({ good: "5", bad: "2", defectOpen: true, failReasonCode: "其他", operatorIds: ["u1"] }, { failReasons: reasons, choices }).errors.note, "note_required");
  const defect = core.validateForm({ good: "5", bad: "2", defectOpen: true, failReasonCode: "尺寸不良", operatorIds: ["u1"] }, { failReasons: reasons, choices });
  assert.equal(defect.ok, true); assert.equal(defect.failQty, 2); assert.equal(defect.failReasonCode, "尺寸不良");
  assert.equal(core.validateForm({ good: "5", operatorIds: [] }, { failReasons: reasons, choices }).errors.operators, "operator_required");
  assert.equal(core.validateForm({ good: "5", operatorIds: ["ghost"] }, { failReasons: reasons, choices }).errors.operators, "operator_required");
  const finishEmpty = core.validateForm({ good: "", operatorIds: [] }, { failReasons: reasons, choices, mode: "finish" });
  assert.equal(finishEmpty.ok, true); assert.equal(finishEmpty.hasQty, false);
  assert.equal(core.validateForm({ good: "4", operatorIds: [] }, { failReasons: reasons, choices, mode: "finish" }).errors.operators, "operator_required");
});

test("legacyContext requires bridge identity incl. manufacture_ii_id (type 8 station)", () => {
  const order = { id: "WO-1", processId: "p1" };
  const full = { legacy_index_sn: 4, manufacture_ii_id: "MII-1", simulation_id: "SIM-1", part_no: "PN-1" };
  const good = core.legacyContext(order, full, "F01");
  assert.equal(good.ok, true);
  assert.deepEqual(good.context, { machineCode: "F01", expectedOrderNo: "WO-1", expectedIndexSn: 4, manufactureIiId: "MII-1", expectedSimulationId: "SIM-1", expectedPartNo: "PN-1" });
  assert.deepEqual(core.legacyContext(order, { ...full, manufacture_ii_id: null }, "F01").missing, ["manufacture_ii_id"]);
  assert.equal(core.legacyContext(order, null, "F01").ok, false);
  assert.ok(core.legacyContext(order, { ...full, simulation_id: "" }, "F01").missing.includes("legacy_index_sn/simulation_id"));
});

test("buildReportArgs uses the existing station-report contract and never sends counter metadata", () => {
  const { context } = core.legacyContext({ id: "WO-1" }, { legacy_index_sn: 4, manufacture_ii_id: "MII-1", simulation_id: "SIM-1", part_no: "PN-1" }, "F01");
  const valid = core.validateForm({ good: "5", bad: "1", defectOpen: true, failReasonCode: "尺寸不良", operatorIds: ["u1"] }, { failReasons: ["尺寸不良"], choices: [{ id: "u1" }] });
  const args = core.buildReportArgs(context, valid, uuid, { preview: true, failReasons: ["尺寸不良"] });
  assert.equal(args.p_preview, true);
  assert.equal(args.p_machine_code, "F01");
  assert.equal(args.p_manufacture_ii_id, "MII-1");
  assert.equal(args.p_expected_index_sn, 4);
  assert.equal(args.p_good_qty, 5); assert.equal(args.p_fail_qty, 1); assert.equal(args.p_fail_reason_code, "尺寸不良");
  assert.equal("p_backfill_qty" in args, false);
  assert.equal("p_previous_outsource_receipt_qty" in args, false);
  const withReceipt = core.buildReportArgs(context, valid, uuid, { preview: true, failReasons: ["尺寸不良"], outsourceReceiptDialogEnabled: true });
  assert.equal(withReceipt.p_previous_outsource_receipt_qty, null);
  const fields = core.commandFields(context);
  assert.deepEqual(fields, { orderNo: "WO-1", step: 4, partNo: "PN-1", manufactureIiId: "MII-1", expectedSimulationId: "SIM-1" });
});

test("productionReportPayload marks the station command so the writeback bridge does not write twice", () => {
  const payload = core.productionReportPayload({ args: { p_good_qty: 5, p_fail_qty: 1, p_fail_reason_code: "外觀", p_command_uuid: uuid, p_manufacture_ii_id: "MII-1" },
    reportType: "noon", operatorIds: ["u1", "u2"], stationCode: "f01", line: "" });
  assert.deepEqual(payload, { report_type: "noon", completed_qty: 5, defect_qty: 1, fail_reason_code: "外觀", station_command_uuid: uuid,
    report_source: "assembly_app", assembly_station: "F01", operator_count: 2, manufacture_ii_id: "MII-1" });
  assert.equal(core.productionReportPayload({ args: { p_command_uuid: uuid }, reportType: "finish", operatorIds: [], stationCode: "G01", line: "pump" }).assembly_line, "pump");
});

test("shiftStateByOrder keeps the latest applied start/stop per order+step", () => {
  const map = core.shiftStateByOrder([
    { command_type: "start", status: "applied", expected_order_no: "WO-1", expected_index_sn: 4, applied_at: "2026-10-31T00:10:00Z" },
    { command_type: "stop", status: "applied", expected_order_no: "WO-1", expected_index_sn: 4, applied_at: "2026-10-31T02:10:00Z" },
    { command_type: "start", status: "rejected", expected_order_no: "WO-2", expected_index_sn: 1, applied_at: "2026-10-31T02:10:00Z" },
    { command_type: "start", status: "applied", expected_order_no: "WO-3", expected_index_sn: 2, applied_at: "2026-10-31T03:10:00Z" },
  ]);
  assert.equal(map.get(core.orderKey("WO-1", 4)).state, "stopped");
  assert.equal(map.has(core.orderKey("WO-2", 1)), false);
  assert.equal(core.displayState({ processStatus: "pending" }, map.get(core.orderKey("WO-3", 2))), "running");
  assert.equal(core.displayState({ processStatus: "running" }, null), "running");
  assert.equal(core.displayState({ processStatus: "pending" }, null), "notStarted");
});

test("defect only on test stations (default G01); assemblyDefectReasons hook overrides factory list", () => {
  assert.equal(core.defectAllowed({}, "G01"), true);
  for (const code of ["D01", "D03", "E01", "F01", "H01"]) assert.equal(core.defectAllowed({}, code), false);
  assert.equal(core.defectAllowed({ assemblyDefectStations: ["F01"] }, "F01"), true);
  assert.deepEqual(core.defectReasons({}, ["尺寸不良", "其他"]), ["尺寸不良", "其他"]);
  assert.deepEqual(core.defectReasons({ assemblyDefectReasons: [] }, ["尺寸不良"]), ["尺寸不良"]);
  assert.deepEqual(core.defectReasons({ assemblyDefectReasons: ["漏油", " 壓力不足 "] }, ["尺寸不良"]), ["漏油", "壓力不足"]);
  // defect not allowed: anything typed in bad is ignored → fail 0
  const v = core.validateForm({ good: "4", bad: "3", defectOpen: true, failReasonCode: "外觀", operatorIds: ["u1"] },
    { failReasons: ["外觀"], choices: [{ id: "u1" }], defectAllowed: false });
  assert.equal(v.ok, true); assert.equal(v.failQty, 0); assert.equal(v.failReasonCode, null);
});

test("shortfall: planned vs reported good + last good; unknown progress is not treated as full", () => {
  assert.deepEqual(core.shortfall({ planned: 50, reportedGood: 22, thisGood: 0 }), { known: true, short: 28, done: 22, planned: 50 });
  assert.equal(core.shortfall({ planned: 30, reportedGood: 15, thisGood: 15 }).short, 0);
  assert.equal(core.shortfall({ planned: 30, reportedGood: 40, thisGood: 0 }).short, 0);
  assert.equal(core.shortfall({ planned: 30, reportedGood: null }).known, false);
  assert.equal(core.shortfall({ planned: 0, reportedGood: null }).short, 0);
});

test("shortCompletionValue reuses the lathe close contract reasons", () => {
  assert.deepEqual(core.SHORT_REASONS, ["MATERIAL_SHORT", "SCRAP", "OTHER"]);
  assert.equal(core.shortCompletionValue("", "").error, "short_reason_required");
  assert.equal(core.shortCompletionValue("LOST", "").error, "short_reason_required");
  assert.equal(core.shortCompletionValue("OTHER", " ").error, "short_note_required");
  assert.deepEqual(core.shortCompletionValue("SCRAP", "").value, { reason_code: "SCRAP", note: "" });
  assert.deepEqual(core.shortCompletionValue("OTHER", " 客戶改單 ").value, { reason_code: "OTHER", note: "客戶改單" });
});

test("isAssemblyEnabledForTenant: only flag on AND tenant in list (fail closed)", () => {
  const T = "a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f";
  const on = { assemblyReportEnabled: true, assemblyReportTenants: [T] };
  assert.equal(core.isAssemblyEnabledForTenant(on, T), true);
  assert.equal(core.isAssemblyEnabledForTenant(on, T.toUpperCase()), true);
  assert.equal(core.isAssemblyEnabledForTenant(on, "11111111-1111-4111-8111-111111111111"), false, "not in list");
  assert.equal(core.isAssemblyEnabledForTenant({ assemblyReportEnabled: true, assemblyReportTenants: [] }, T), false, "empty list");
  assert.equal(core.isAssemblyEnabledForTenant({ assemblyReportEnabled: true }, T), false, "list missing");
  assert.equal(core.isAssemblyEnabledForTenant({ ...on, assemblyReportEnabled: false }, T), false, "flag off");
  assert.equal(core.isAssemblyEnabledForTenant({ ...on, assemblyReportEnabled: "true" }, T), false, "flag must be boolean true");
  assert.equal(core.isAssemblyEnabledForTenant(on, null), false, "null tenant");
  assert.equal(core.isAssemblyEnabledForTenant(on, ""), false, "empty tenant");
  assert.equal(core.isAssemblyEnabledForTenant(null, T), false);
});
