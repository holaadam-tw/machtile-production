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

test("stop good quantity is a step total and payload sends only the fresh delta", () => {
  const policy = core.DEFAULT_POLICIES.find((row) => row.code === "RUSH_ORDER");
  const form = { ...core.initialStopForm(policy), good_qty: "140", fail_qty: "0", allow_takeover_touched: true };
  const totals = { goodDone: 94, failDone: 0 };
  assert.equal(core.validateStop(form, undefined, totals).ok, true);
  assert.equal(core.stopPayload(form, totals).good_qty, 46);
  form.good_qty = "94";
  assert.equal(core.validateStop(form, undefined, totals).ok, true);
  assert.equal(core.stopPayload(form, totals).good_qty, 0);
  form.good_qty = "90";
  assert.equal(core.validateStop(form, undefined, totals).errors.good_qty, "total_less_than_done");
  form.good_qty = "94.5";
  assert.equal(core.validateStop(form, undefined, totals).errors.good_qty, "required_nonnegative_integer");
});

test("duplicate confirmation rebuilds the same quantity delta", () => {
  const form = { good_qty: "140", fail_qty: "3", fail_reason_code: "尺寸不良", reason_code: "RUSH_ORDER", allow_takeover: true, allow_takeover_touched: true, note: "" };
  const input = { machineCode: "A04", orderNo: "WO-1", indexSn: 1, form, totals: { goodDone: 94, failDone: 1 } };
  const first = core.stopReportPayload({ ...input, commandUuid: "first" });
  const confirmed = core.stopReportPayload({ ...input, commandUuid: "confirmed" });
  assert.equal(first.p_good_qty, 46);
  assert.equal(first.p_fail_qty, 2);
  delete first.p_command_uuid;
  delete confirmed.p_command_uuid;
  assert.deepEqual(confirmed, first);
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

test("stop rejection tells operators old MES stopped but quantities were not sent", () => {
  assert.match(core.stopReportRejectedText("ORDER_CHANGED_DURING_APPLY"), /舊 MES 已停工/);
  assert.match(core.stopReportRejectedText("ORDER_CHANGED_DURING_APPLY"), /件數沒有送出/);
  assert.doesNotMatch(core.stopReportRejectedText("ORDER_CHANGED_DURING_APPLY"), /一般停工/);
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
    goodQty: 3, failQty: 1, doneQty: 4, processDoneQty: 4, remainingQty: 6,
  });
});

test("second and later takeovers use the whole step's cumulative completion for remaining qty", () => {
  // Plan 10: A04 made 4, A05 took over and made 3 more, then stopped again (note holds only its own 3).
  const secondNote = { id: "note-2", order_no: "WO-1", index_sn: 2, source_machine: "A05", reason_code: "TOOLING",
    good_qty: 3, fail_qty: 0, stopped_by_name: "Operator Lin", stopped_at: "2026-10-25T02:00:00Z" };
  const view = core.candidateView(secondNote, 10, "刀具／治具問題", 7);
  assert.equal(view.doneQty, 7, "doneQty shows the step's cumulative completion so done + remaining = planned");
  assert.equal(view.goodQty, 3, "goodQty still holds the stop note's own segment");
  assert.equal(view.processDoneQty, 7);
  assert.equal(view.remainingQty, 3, "remaining = planned 10 - cumulative 7, not 10 - 3 = 7");
  // Cumulative read lagging behind the note (stop report not applied yet) never overstates remaining.
  assert.equal(core.candidateView(secondNote, 10, "", 0).remainingQty, 7);
  assert.equal(core.candidateView(secondNote, 10, "", 2).remainingQty, 7);
  assert.equal(core.candidateView(secondNote, 10, "", undefined).remainingQty, 7);
  // Over-completion clamps at zero.
  assert.equal(core.candidateView(secondNote, 10, "", 12).remainingQty, 0);
});

test("candidate doneQty counts quantities reported before the stop, not only the stop note", () => {
  // Plan 10: reported 4 before stopping, stop note filled 0 -> cumulative 4.
  const zeroNote = { id: "note-z", order_no: "WO-1", index_sn: 2, source_machine: "A04", reason_code: "RUSH_ORDER",
    good_qty: 0, fail_qty: 0, stopped_by_name: "Operator Chen", stopped_at: "2026-10-27T01:00:00Z" };
  const zeroView = core.candidateView(zeroNote, 10, "", 4);
  assert.equal(zeroView.doneQty, 4);
  assert.equal(zeroView.remainingQty, 6);
  assert.equal(zeroView.doneQty + zeroView.remainingQty, 10);
  // Reported 4, then the stop report adds 4 more -> cumulative 8.
  const fourNote = { ...zeroNote, id: "note-4", good_qty: 4 };
  const fourView = core.candidateView(fourNote, 10, "", 8);
  assert.equal(fourView.doneQty, 8);
  assert.equal(fourView.remainingQty, 2);
  assert.equal(fourView.goodQty, 4, "goodQty / failQty still hold the stop note's own segment");
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

test("idle takeover action needs every gate and never applies to a machine with an order", () => {
  const ready = { enabled: true, machines: ["A02"], machineCode: "a02", availability: "ready", hasOrder: false };
  assert.equal(core.idleActionVisible(ready), true);
  assert.equal(core.idleActionVisible({ ...ready, enabled: false }), false);
  assert.equal(core.idleActionVisible({ ...ready, machines: ["A03"] }), false);
  assert.equal(core.idleActionVisible({ ...ready, availability: "missing" }), false);
  assert.equal(core.idleActionVisible({ ...ready, hasOrder: true }), false);
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
  assert.equal(core.rejectText("NOT_ELIGIBLE").split(" / ")[0], "這台機台不能接這筆停工單（不在可接機台名單）");
  assert.doesNotMatch(core.rejectText("NOT_ELIGIBLE"), /B 機合併站/);
  for (const code of ["TARGET_BUSY", "ALREADY_TAKEN", "TAKEOVER_NOT_ALLOWED", "NOT_ELIGIBLE"])
    assert.match(core.rejectText(code), / \/ /, `${code} has Chinese and Vietnamese feedback`);
  assert.equal(core.resultText({ phase: "applied" }), "已接手 / Đã tiếp quản");
});

test("pick/start phase: no order = pick, pending = start only, running = report/stop/finish, own stop (paused) = start + finish", () => {
  assert.equal(core.pickStartPhase({ hasOrder: false, processStatus: "running" }), "pick");
  assert.equal(core.pickStartPhase({ hasOrder: true, processStatus: "pending" }), "pending");
  // 接手 applied 改回 pending：actual_start_at 保留第一次開工，但這台還沒按開工
  assert.equal(core.pickStartPhase({ hasOrder: true, processStatus: "pending", actualStartAt: "2026-10-20T01:00:00Z" }), "pending");
  assert.equal(core.pickStartPhase({ hasOrder: true, processStatus: "running" }), "running");
  assert.equal(core.pickStartPhase({ hasOrder: true, processStatus: "abnormal" }), "running");
  assert.equal(core.pickStartPhase({ hasOrder: true, processStatus: "paused" }), "stopped");
  assert.equal(core.pickStartPhase({ hasOrder: true, processStatus: "", rawStatus: "paused" }), "stopped");
  assert.equal(core.pickStartPhase({ hasOrder: true, processStatus: "pending", rawStatus: "paused" }), "pending");
  // status 讀不到 → 退回 actual_start_at／machines.status
  assert.equal(core.pickStartPhase({ hasOrder: true, actualStartAt: "2026-10-20T01:00:00Z" }), "running");
  assert.equal(core.pickStartPhase({ hasOrder: true, rawStatus: "running" }), "running");
  assert.equal(core.pickStartPhase({ hasOrder: true }), "pending");
  // 本機剛 applied 的開工／停工優先（雲端還沒重讀）
  assert.equal(core.pickStartPhase({ hasOrder: true, processStatus: "pending", localRun: "start" }), "running");
  assert.equal(core.pickStartPhase({ hasOrder: true, processStatus: "running", localRun: "stop" }), "stopped");
  assert.deepEqual(core.pickStartActions("pick"), ["pick"]);
  assert.deepEqual(core.pickStartActions("pending"), ["start"]);
  assert.deepEqual(core.pickStartActions("running"), ["report", "stop", "finish"]);
  assert.deepEqual(core.pickStartActions("stopped"), ["start", "finish"]);
  assert.deepEqual(core.pickStartActions("unknown"), []);
});

test("local start/stop is dropped when a newer cloud read contradicts it", () => {
  // 本機記開工，雲端之後讀到 paused／pending → 矛盾，以雲端為準
  assert.equal(core.pickStartLocalStale({ hasOrder: true, processStatus: "paused", localRun: "start", localAt: 100, cloudReadAt: 200 }), true);
  assert.equal(core.pickStartLocalStale({ hasOrder: true, processStatus: "pending", localRun: "start", localAt: 100, cloudReadAt: 200 }), true);
  assert.equal(core.pickStartLocalStale({ hasOrder: true, processStatus: "running", localRun: "stop", localAt: 100, cloudReadAt: 200 }), true);
  // 雲端讀取比本機紀錄早開始（還沒反映）→ 保留本機
  assert.equal(core.pickStartLocalStale({ hasOrder: true, processStatus: "pending", localRun: "start", localAt: 300, cloudReadAt: 200 }), false);
  // 一致／status 讀不到／沒有雲端讀取 → 保留
  assert.equal(core.pickStartLocalStale({ hasOrder: true, processStatus: "running", localRun: "start", localAt: 100, cloudReadAt: 200 }), false);
  assert.equal(core.pickStartLocalStale({ hasOrder: true, processStatus: "", localRun: "start", localAt: 100, cloudReadAt: 200 }), false);
  assert.equal(core.pickStartLocalStale({ hasOrder: true, processStatus: "paused", localRun: "start", localAt: 100 }), false);
  assert.equal(core.pickStartLocalStale({ hasOrder: true, processStatus: "paused", localRun: "", localAt: 100, cloudReadAt: 200 }), false);
});
