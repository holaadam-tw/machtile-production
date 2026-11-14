"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mapOrdersToPallets } = require("./hmcPalletCardCore.js");
const entry = (id, partNo) => ({ order: { id, partNo } });
const pallet = (palletNo, ...partNos) => ({ palletNo, slots: partNos.map((partNo, i) => ({ slotId: `slot-${i + 1}`, part: { partNo } })) });
test("one pallet can list several different hung parts", () => {
  const result = mapOrdersToPallets([entry("WO-1", "SF-03-01"), entry("WO-2", "BG-03-01")], [pallet(1, "SF-03-01", "BG-03-01")]);
  assert.deepEqual(result.pallets[0].orders.map((x) => x.order.id), ["WO-1", "WO-2"]);
  assert.equal(result.unmatched.length, 0);
});
test("a part configured on two pallets is not guessed", () => {
  const result = mapOrdersToPallets([entry("WO-X", "CPDG-06-01")], [pallet(2, "CPDG-06-01"), pallet(4, "CPDG-06-01")]);
  assert.equal(result.pallets[1].orders.length, 0);
  assert.equal(result.pallets[3].orders.length, 0);
  assert.deepEqual(result.unmatched.map((x) => x.order.id), ["WO-X"]);
});
test("an unknown part is placed under unmatched", () => {
  assert.deepEqual(mapOrdersToPallets([entry("WO-U", "UNKNOWN")], [pallet(1, "KNOWN")]).unmatched.map((x) => x.order.id), ["WO-U"]);
});
test("missing configuration leaves all pallets unconfigured and keeps orders unmatched", () => {
  const result = mapOrdersToPallets([entry("WO-1", "SF-03-01")], []);
  assert.ok(result.pallets.every((x) => x.configured === false));
  assert.deepEqual(result.unmatched.map((x) => x.order.id), ["WO-1"]);
});
