const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./takeoverCore.js");

test("stop quantities require explicit non-negative integers including explicit zero", () => {
  const policy = core.DEFAULT_POLICIES[0];
  const form = core.initialStopForm(policy);
  assert.equal(core.validateStop(form).ok, false);
  form.good_qty = "0"; form.fail_qty = "0"; form.allow_takeover_touched = true;
  assert.equal(core.validateStop(form).ok, true);
  form.fail_qty = "-1";
  assert.equal(core.validateStop(form).errors.fail_qty, "required_nonnegative_integer");
});

test("reason default is highlighted but takeover choice still requires a tap", () => {
  const form = core.initialStopForm(core.DEFAULT_POLICIES[0]);
  form.good_qty = "4"; form.fail_qty = "0";
  assert.equal(form.allow_takeover, true);
  assert.equal(core.validateStop(form).errors.allow_takeover, "must_confirm");
  form.allow_takeover_touched = true;
  assert.equal(core.validateStop(form).ok, true);
});

test("OTHER requires a note", () => {
  const policy = core.DEFAULT_POLICIES.find((row) => row.code === "OTHER");
  const form = { ...core.initialStopForm(policy), good_qty: "0", fail_qty: "0", allow_takeover_touched: true };
  assert.equal(core.validateStop(form).errors.note, "required");
  form.note = "等待確認";
  assert.equal(core.validateStop(form).ok, true);
});

test("start tabs and all takeover surfaces are absent when flag or machine is off", () => {
  assert.deepEqual(core.startTabs(false), ["new"]);
  assert.equal(core.enabledForMachine(false, ["A04"], "A04"), false);
  assert.equal(core.enabledForMachine(true, [], "A04"), false);
  assert.equal(core.enabledForMachine(true, ["A04"], "A04"), true);
  assert.deepEqual(core.startTabs(core.enabledForMachine(false, ["A04"], "A04")), ["new"]);
});

test("takeover confirmation is plain language and uses done plus remaining", () => {
  assert.equal(core.takeoverConfirmation({ source_machine: "A04", order_no: "MD-02", index_sn: 1, good_qty: 3, fail_qty: 1, remaining_qty: 6 }, "A05"),
    "從 A04 接手 MD-02 第 1 道：A04 已做 4，A05 接手剩 6");
});
