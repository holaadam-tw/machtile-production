const assert = require("node:assert/strict");
const core = require("./machineHourlyRateCore.js");

assert.equal(core.canOpen("admin"), true);
for (const role of ["manager", "planner", "operator", "", null]) assert.equal(core.canOpen(role), false);

for (const bad of ["", "abc", "-1", "0", "1.234", "100000.01", "Infinity"]) {
  assert.equal(core.parseRate(bad).ok, false, `${bad} must be rejected`);
}
assert.deepEqual(core.parseRate("480"), { ok: true, value: 480 });
assert.deepEqual(core.parseRate("0.01"), { ok: true, value: 0.01 });
assert.deepEqual(core.parseRate("100000.00"), { ok: true, value: 100000 });

const snapshot = core.normalizeSnapshot({
  machines: [{ id: "m1", machine_code: "A01", name: "車床 1", hourly_rate: "300.00" }],
  history: [{ id: "h1", machine_code: "A01", actor_name: "管理者", old_rate: "250", new_rate: "300", changed_at: "2026-10-17T10:00:00Z" }],
});
assert.equal(snapshot.machines[0].hourlyRate, 300);
assert.equal(snapshot.history[0].actorName, "管理者");
assert.equal(snapshot.history[0].oldRate, 250);

console.log("PASS machine hourly rate core: admin gate, bounds, numeric precision, snapshot normalization");
