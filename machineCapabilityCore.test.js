const assert = require("node:assert/strict");
const core = require("./machineCapabilityCore.js");

const config = {
  multiStationMachines: ["B01"], enableStationReport: true, stationReportMachines: ["B01"],
  enableFinishClose: true, finishCloseMachines: ["B01"], enableFinishClaimStartCombo: true,
  finishClaimStartComboMachines: ["B01"], dispatchPoolMachines: ["B01"], stationCommandMachines: ["B01"],
};
const opposite = { machine_code: "B01", station_mode: "single", report_mode: "field", close_enabled: false,
  claim_next_enabled: false, replace_stopped_enabled: false, dispatch_pool_enabled: false, enabled: false };
const result = core.compare(config, { stale: false, machines: [opposite] });
assert.equal(result.status, "ready");
assert.deepEqual(result.mismatches.map((item) => item.field), core.FIELDS, "all capability fields are compared");
assert.equal(core.missingMachine({ machines: [opposite] }, "A01"), true);
assert.equal(core.missingMachine({ machines: [opposite] }, "b01"), false);
assert.deepEqual(core.compare(config, null), { status: "no_snapshot", mismatches: [], machines: 0 });
assert.equal(core.compare(config, { stale: true, machines: [opposite] }).status, "stale");
assert.equal(core.classifySnapshot({ error: "unavailable" }).status, "error");
console.log("PASS machine capability comparator: all fields, missing machine, no snapshot, stale, error");
