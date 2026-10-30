const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./cardQtyOverlayCore.js");

const order = { machine: "A01", id: "WO-1", stationStep: 20, processId: "p-1" };
const input = { machine: "a01", orderNo: "WO-1", step: 20, processId: "p-1", total: 12 };

test("creates an overlay only after an applied outcome", () => {
  assert.equal(core.create(input, "accepted", 100), null);
  assert.equal(core.create(input, "queued", 100), null);
  assert.deepEqual(core.create(input, "applied", 100), { ...input, machine: "A01", at: 100 });
  assert.equal(core.create(input, "rejected", 100), null);
  assert.equal(core.create(input, "stale", 100), null);
});

test("applies max while the server is behind", () => {
  assert.deepEqual(core.apply(8, core.create(input, "applied", 100), order, 200), {
    completed: 12, overlay: { ...input, machine: "A01", at: 100 }, state: "syncing", clear: false,
  });
});

test("clears when server catches up", () => {
  assert.deepEqual(core.apply(12, core.create(input, "applied", 100), order, 200), { completed: 12, overlay: null, state: "synced", clear: true });
});

test("clears after fifteen minutes and returns server quantity", () => {
  assert.deepEqual(core.apply(8, core.create(input, "applied", 100), order, 100 + core.MAX_AGE_MS), { completed: 8, overlay: null, state: "slow", clear: true });
});

test("does not apply after an order or route change", () => {
  const overlay = core.create(input, "applied", 100);
  assert.equal(core.apply(8, overlay, { ...order, id: "WO-2" }, 200).completed, 8);
  assert.equal(core.apply(8, overlay, { ...order, stationStep: 30 }, 200).completed, 8);
});

test("flag-off caller can preserve the original rendered bytes", () => {
  const original = '<strong>8/100</strong><em>含舊 MES</em>';
  const render = (enabled) => enabled ? original.replace("8/100", `${core.apply(8, core.create(input, "applied", 100), order, 200).completed}/100`) : original;
  assert.equal(render(false), original);
});
