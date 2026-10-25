const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./takeoverCore.js");
const stationCore = require("./stationCommandCore.js");

test("APP mapping matches PR #135 candidate and write RPC contracts", () => {
  const candidate = core.candidateView({ stop_note_id: "note-1", order_no: "WO-1", index_sn: 3,
    source_machine: "A04", stopped_by: "user-1", stopped_at: "2026-10-25T00:00:00Z",
    reason_code: "TOOLING", note: null, good_qty: 7, fail_qty: 1 }, 20, "刀具／治具問題");
  assert.equal(candidate.stopNoteId, "note-1");
  assert.equal(candidate.remainingQty, 12);
  assert.equal(Object.hasOwn(candidate, "id"), false);
  assert.equal(Object.hasOwn(candidate, "stopped_by_name"), false);
  assert.equal(Object.hasOwn(candidate, "reason_label"), false);
  assert.equal(Object.hasOwn(candidate, "remaining_qty"), false);
  assert.deepEqual(Object.keys(core.takeoverPayload({ commandUuid: "cmd", machineCode: "A05", stopNoteId: candidate.stopNoteId })).sort(),
    ["p_command_uuid", "p_machine_code", "p_stop_note_id"]);
});

test("stop_report survives reload in the shared station pending lock", () => {
  const now = Date.now();
  const restored = stationCore.restorePending({ A04: { commandUuid: "20000000-0000-4000-9000-000000000001",
    commandType: "stop_report", machineCode: "A04", orderNo: "WO-1", step: 3, startedAt: now } }, now);
  assert.equal(restored.A04.commandType, "stop_report");
  assert.equal(stationCore.statusView({ status: "pending" }, restored.A04.commandType, 0).terminal, false);
});
