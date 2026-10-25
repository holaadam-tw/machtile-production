const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./takeoverCore.js");

test("stop quantities require explicit non-negative integers including explicit zero", () => {
  const form = core.initialStopForm(core.DEFAULT_POLICIES[0]);
  assert.equal(core.validateStop(form).ok, false);
  form.good_qty = "0"; form.fail_qty = "0"; form.allow_takeover_touched = true; form.note = "repair";
  assert.equal(core.validateStop(form).ok, true);
  form.fail_qty = "-1";
  assert.equal(core.validateStop(form).errors.fail_qty, "required_nonnegative_integer");
});

test("reason default is highlighted but takeover choice still requires a tap", () => {
  const policy = core.DEFAULT_POLICIES.find((row) => row.code === "RUSH_ORDER");
  const form = core.initialStopForm(policy);
  form.good_qty = "4"; form.fail_qty = "0";
  assert.equal(form.allow_takeover, true);
  assert.equal(core.validateStop(form).errors.allow_takeover, "must_confirm");
  form.allow_takeover_touched = true;
  assert.equal(core.validateStop(form).ok, true);
});

test("MACHINE_FAULT and OTHER require notes and labels match the cloud contract", () => {
  assert.equal(core.DEFAULT_POLICIES.find((row) => row.code === "MACHINE_FAULT").note_required, true);
  assert.equal(core.DEFAULT_POLICIES.find((row) => row.code === "OTHER").note_required, true);
  assert.deepEqual(core.DEFAULT_POLICIES.map((row) => row.label_zh), ["機台故障／維修", "換做急單", "刀具／治具問題", "缺料／等料", "品質問題／等檢驗", "其他"]);
});

test("start tabs and all takeover surfaces are absent when flag or machine is off", () => {
  assert.deepEqual(core.startTabs(false), ["new"]);
  assert.equal(core.enabledForMachine(false, ["A04"], "A04"), false);
  assert.equal(core.enabledForMachine(true, [], "A04"), false);
  assert.equal(core.enabledForMachine(true, ["A04"], "A04"), true);
});

test("cloud payloads use dedicated RPC parameter names", () => {
  const form = { good_qty: "3", fail_qty: "1", fail_reason_code: "尺寸不良", reason_code: "RUSH_ORDER", allow_takeover: true, note: "" };
  assert.deepEqual(core.stopReportPayload({ commandUuid: "cmd", machineCode: "a04", orderNo: "WO-1", indexSn: 2, partNo: "P-1", expectedSimulationId: "SIM-1", form }), {
    p_command_uuid: "cmd", p_machine_code: "A04", p_order_no: "WO-1", p_index_sn: 2, p_part_no: "P-1",
    p_manufacture_ii_id: null, p_expected_simulation_id: "SIM-1", p_good_qty: 3, p_fail_qty: 1,
    p_fail_reason_code: "尺寸不良", p_stop_reason_code: "RUSH_ORDER", p_allow_takeover: true, p_stop_note: null,
  });
  assert.deepEqual(core.takeoverPayload({ commandUuid: "cmd", machineCode: "a05", stopNoteId: "note" }),
    { p_command_uuid: "cmd", p_machine_code: "A05", p_stop_note_id: "note" });
});

test("candidate mapping uses the station_stop_notes id and display-name columns", () => {
  const row = { id: "note", tenant_id: "tenant", order_no: "WO-1", index_sn: 2, part_no: "P-1", source_machine: "A04",
    manufacture_ii_id: null, reason_code: "RUSH_ORDER", allow_takeover: true, note: "rush", good_qty: 3, fail_qty: 1,
    stopped_by: "user-uuid", stopped_by_name: "Operator Chen", stopped_at: "2026-10-25T00:00:00Z", status: "stopped",
    taken_by_machine: null, taken_by: null, taken_by_name: null, taken_at: null, command_uuid: "command",
    policy_changed_by: null, policy_changed_by_name: null, policy_changed_at: null };
  assert.deepEqual(core.candidateView(row, 10, "換做急單"), {
    stopNoteId: "note", orderNo: "WO-1", indexSn: 2, sourceMachine: "A04", stoppedBy: "Operator Chen",
    stoppedAt: "2026-10-25T00:00:00Z", reasonCode: "RUSH_ORDER", reasonLabel: "換做急單", note: "rush",
    goodQty: 3, failQty: 1, doneQty: 4, remainingQty: 6,
  });
});

test("a non-empty SQL-contract candidate fixture produces a takeover row", () => {
  const sqlRow = { id: "note", tenant_id: "tenant", order_no: "WO-1", index_sn: 2, part_no: "P-1", source_machine: "A04",
    manufacture_ii_id: null, reason_code: "RUSH_ORDER", allow_takeover: true, note: null, good_qty: 3, fail_qty: 1,
    stopped_by: "user-uuid", stopped_by_name: "Operator Chen", stopped_at: "2026-10-25T00:00:00Z", status: "stopped",
    taken_by_machine: null, taken_by: null, taken_by_name: null, taken_at: null, command_uuid: "command",
    policy_changed_by: null, policy_changed_by_name: null, policy_changed_at: null };
  const view = core.candidateView(sqlRow, 10, "Rush");
  const rows = core.candidateMap([view]);
  assert.equal(rows.size, 1);
  assert.equal(rows.get("note").stoppedBy, "Operator Chen");
});

test("any unavailable takeover capability fails open to the legacy stop flow", () => {
  assert.equal(core.availabilityAfterProbeError(new Error("NOT_ELIGIBLE")), "missing");
  assert.equal(core.availabilityAfterProbeError({ code: "42883", message: "function does not exist" }), "missing");
  assert.equal(core.availabilityAfterProbeError({ code: "PGRST202", message: "schema cache miss" }), "missing");
  assert.equal(core.availabilityAfterProbeError(new Error("temporary network failure")), "missing");
  assert.equal(core.availabilityAfterProbeError(new Error("TAKEOVER_DISABLED")), "off");
});

test("defects require their own fail reason and wildcard config picks a visible probe machine", () => {
  const form = { ...core.initialStopForm(core.DEFAULT_POLICIES[1]), good_qty: "3", fail_qty: "1", allow_takeover_touched: true };
  assert.equal(core.validateStop(form).errors.fail_reason_code, "required");
  form.fail_reason_code = "尺寸不良";
  assert.equal(core.validateStop(form).ok, true);
  assert.equal(core.probeMachine(["*"], ["a04", "A05"]), "A04");
  assert.equal(core.probeMachine(["A05"], ["A04"]), "A05");
});

test("known takeover rejects have operator-facing text", () => {
  assert.match(core.rejectText("TAKEOVER_DISABLED"), /一般停工/);
  assert.match(core.rejectText("STATION_CLASS_MISMATCH"), /類型不同/);
  assert.match(core.rejectText("NOT_ELIGIBLE"), /B 機合併站/);
});
