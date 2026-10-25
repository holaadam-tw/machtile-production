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
  const form = { good_qty: "3", fail_qty: "1", reason_code: "RUSH_ORDER", allow_takeover: true, note: "" };
  assert.deepEqual(core.stopReportPayload({ commandUuid: "cmd", machineCode: "a04", orderNo: "WO-1", indexSn: 2, partNo: "P-1", form }), {
    p_command_uuid: "cmd", p_machine_code: "A04", p_order_no: "WO-1", p_index_sn: 2, p_part_no: "P-1",
    p_manufacture_ii_id: null, p_good_qty: 3, p_fail_qty: 1, p_reason_code: "RUSH_ORDER", p_allow_takeover: true, p_note: null,
  });
  assert.deepEqual(core.takeoverPayload({ commandUuid: "cmd", machineCode: "a05", stopNoteId: "note" }),
    { p_command_uuid: "cmd", p_machine_code: "A05", p_stop_note_id: "note" });
});

test("candidate mapping only consumes contract fields and derives remaining quantity", () => {
  const row = { stop_note_id: "note", order_no: "WO-1", index_sn: 2, source_machine: "A04", stopped_by: "user",
    stopped_at: "2026-10-25T00:00:00Z", reason_code: "RUSH_ORDER", note: "rush", good_qty: 3, fail_qty: 1,
    id: "forbidden", stopped_by_name: "forbidden", reason_label: "forbidden", remaining_qty: 999 };
  assert.deepEqual(core.candidateView(row, 10, "換做急單"), {
    stopNoteId: "note", orderNo: "WO-1", indexSn: 2, sourceMachine: "A04", stoppedBy: "user",
    stoppedAt: "2026-10-25T00:00:00Z", reasonCode: "RUSH_ORDER", reasonLabel: "換做急單", note: "rush",
    goodQty: 3, failQty: 1, doneQty: 4, remainingQty: 6,
  });
});
