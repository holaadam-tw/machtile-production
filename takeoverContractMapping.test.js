const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require("./takeoverCore.js");
const stationCore = require("./stationCommandCore.js");

const takeoverMigration = "D:/Codex/wt-takeover-cloud/supabase/migrations/20261025054531_station_takeover_v1_cloud.sql";

function rpcParameterNames(sql, functionName) {
  const match = sql.match(new RegExp(`create function public\\.${functionName}\\s*\\(([\\s\\S]*?)\\)\\s*returns`, "i"));
  assert.ok(match, `${functionName} signature must exist in migration`);
  return [...match[1].matchAll(/\b(p_[a-z0-9_]+)\s+[a-z]/gi)].map((item) => item[1]);
}

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
  const takeoverPayload = core.takeoverPayload({ commandUuid: "cmd", machineCode: "A05", stopNoteId: candidate.stopNoteId });
  const sql = fs.readFileSync(takeoverMigration, "utf8");
  assert.deepEqual(Object.keys(takeoverPayload), rpcParameterNames(sql, "machtile_submit_takeover"));
});

test("stop_report payload parameter names exactly match migration RPC signature", () => {
  const payload = core.stopReportPayload({ commandUuid: "cmd", machineCode: "A04", orderNo: "WO-1", indexSn: 3,
    partNo: "P-1", manufactureIiId: "MII-1", expectedSimulationId: "SIM-1",
    form: { good_qty: "7", fail_qty: "1", fail_reason_code: "尺寸不良", reason_code: "TOOLING", allow_takeover: true, note: "換刀" } });
  const sql = fs.readFileSync(takeoverMigration, "utf8");
  assert.deepEqual(Object.keys(payload), rpcParameterNames(sql, "machtile_submit_stop_report"));
  assert.equal(payload.p_expected_simulation_id, "SIM-1");
  assert.equal(payload.p_fail_reason_code, "尺寸不良");
  assert.equal(payload.p_stop_reason_code, "TOOLING");
  assert.equal(payload.p_stop_note, "換刀");
  assert.equal(Object.hasOwn(payload, "p_reason_code"), false);
  assert.equal(Object.hasOwn(payload, "p_note"), false);
});

test("stop_report survives reload in the shared station pending lock", () => {
  const now = Date.now();
  const restored = stationCore.restorePending({ A04: { commandUuid: "20000000-0000-4000-9000-000000000001",
    commandType: "stop_report", machineCode: "A04", orderNo: "WO-1", step: 3, startedAt: now } }, now);
  assert.equal(restored.A04.commandType, "stop_report");
  assert.equal(stationCore.statusView({ status: "pending" }, restored.A04.commandType, 0).terminal, false);
});

test("takeover survives reload and app submits through the shared result poller", () => {
  const now = Date.now();
  const restored = stationCore.restorePending({ A05: { commandUuid: "20000000-0000-4000-9000-000000000002",
    commandType: "takeover", machineCode: "A05", stopNoteId: "note-1", startedAt: now } }, now);
  assert.equal(restored.A05.commandType, "takeover");
  const app = fs.readFileSync(require.resolve("./app.js"), "utf8");
  assert.match(app, /commandType: "takeover"/);
  assert.match(app, /record\.commandType === "takeover"[\s\S]*resultText\(view\)/);
});

test("APP renders SQL display names and delegates probe error classification", () => {
  const app = fs.readFileSync(require.resolve("./app.js"), "utf8");
  assert.match(app, /who: taken\.taken_by_name/);
  assert.match(app, /select=order_no,index_sn,source_machine,taken_by_machine,taken_by_name,taken_at,status/);
  assert.match(app, /availabilityAfterProbeError\(error\)/);
  assert.match(app, /is_enabled=eq\.true/);
  assert.match(app, /takeover_stop_waiting/);
  assert.match(app, /data-takeover-legacy-stop>改用一般停工/);
  assert.match(app, /!viewState\.order\.simulationId \|\| viewState\.offerLegacyStop/);
  assert.match(app, /view\?\.phase === "rejected"[\s\S]*machtileTakeoverUseLegacyStop\(code, null\)/);
  assert.doesNotMatch(app, /who: taken\.taken_by(?:\s|\|)/);
});
