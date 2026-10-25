const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require("./takeoverCore.js");
const stationCore = require("./stationCommandCore.js");

test("APP mapping matches PR #135 candidate and write RPC contracts", () => {
  const candidate = core.candidateView({ id: "note-1", tenant_id: "tenant-1", order_no: "WO-1", index_sn: 3,
    part_no: "P-1", source_machine: "A04", manufacture_ii_id: null, reason_code: "TOOLING", allow_takeover: true,
    note: null, good_qty: 7, fail_qty: 1, stopped_by: "user-1", stopped_by_name: "Operator Nguyen",
    stopped_at: "2026-10-25T00:00:00Z", status: "stopped", taken_by_machine: null, taken_by: null,
    taken_by_name: null, taken_at: null, command_uuid: "command-1", policy_changed_by: null,
    policy_changed_by_name: null, policy_changed_at: null }, 20, "刀具／治具問題");
  assert.equal(candidate.stopNoteId, "note-1");
  assert.equal(candidate.stoppedBy, "Operator Nguyen");
  assert.equal(candidate.remainingQty, 12);
  assert.equal(core.candidateMap([candidate]).size, 1);
  assert.equal(Object.hasOwn(candidate, "reason_label"), false);
  assert.equal(Object.hasOwn(candidate, "remaining_qty"), false);
  assert.deepEqual(Object.keys(core.takeoverPayload({ commandUuid: "cmd", machineCode: "A05", stopNoteId: candidate.stopNoteId })).sort(),
    ["p_command_uuid", "p_machine_code", "p_stop_note_id"]);
});

test("stop_report uses v2 dedicated columns and current SQL identities", () => {
  const payload = core.stopReportPayload({ commandUuid: "cmd", machineCode: "A04", orderNo: "WO-1", indexSn: 3,
    partNo: "P-1", manufactureIiId: "MII-1", expectedSimulationId: "SIM-1",
    form: { good_qty: "7", fail_qty: "1", fail_reason_code: "尺寸不良", reason_code: "TOOLING", allow_takeover: true, note: "換刀" } });
  assert.equal(payload.p_expected_simulation_id, "SIM-1");
  assert.equal(payload.p_fail_reason_code, "尺寸不良");
  assert.equal(payload.p_reason_code, "TOOLING");
  assert.equal(Object.hasOwn(payload, "p_stop_reason_code"), false);
});

test("stop_report survives reload in the shared station pending lock", () => {
  const now = Date.now();
  const restored = stationCore.restorePending({ A04: { commandUuid: "20000000-0000-4000-9000-000000000001",
    commandType: "stop_report", machineCode: "A04", orderNo: "WO-1", step: 3, startedAt: now } }, now);
  assert.equal(restored.A04.commandType, "stop_report");
  assert.equal(stationCore.statusView({ status: "pending" }, restored.A04.commandType, 0).terminal, false);
});

test("APP renders SQL display names and delegates probe error classification", () => {
  const app = fs.readFileSync(require.resolve("./app.js"), "utf8");
  assert.match(app, /who: taken\.taken_by_name/);
  assert.match(app, /select=order_no,index_sn,source_machine,taken_by_machine,taken_by_name,taken_at,status/);
  assert.match(app, /availabilityAfterProbeError\(error\)/);
  assert.match(app, /is_enabled=eq\.true/);
  assert.match(app, /takeover_stop_waiting/);
  assert.doesNotMatch(app, /who: taken\.taken_by(?:\s|\|)/);
});
