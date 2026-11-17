"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mapOrdersToPallets, inferredStripModel, configuredStripModel } = require("./hmcPalletCardCore.js");
const entry = (id, partNo, extra = {}) => ({ order: { id, processId: `${id}-P`, partNo, ...extra } });
const pallet = (palletNo, ...partNos) => ({ palletNo, slots: partNos.map((partNo, i) => ({ slotId: `slot-${i + 1}`, part: { partNo } })) });
const map = {
  1: [{ partNos: ["SF-03-01"], label: "SF-03本體" }, { partNos: ["EMPTY"], label: "空工件" }],
  2: [{ partNos: ["CPDG-06-01"], label: "CPDG-06", default: true }, { partNos: ["HG-06-01"], label: "HG-06", default: false }, { partNos: ["MPW-01-01"], label: "MPW-01", dual: true, sharedWith: 5 }],
  4: [{ partNos: ["CPDG-06-01"], label: "CPDG-06", default: false }, { partNos: ["HG-06-01"], label: "HG-06", default: true }],
  5: [{ partNos: ["MPW-01-01"], label: "MPW-01", dual: true, sharedWith: 2 }],
};

test("RPC inferred mapping retains unique pallets and unmatched orders", () => {
  const result = mapOrdersToPallets([entry("WO-1", "SF-03-01"), entry("WO-X", "UNKNOWN")], [pallet(1, "SF-03-01")]);
  assert.deepEqual(result.pallets[0].orders.map((x) => x.order.id), ["WO-1"]);
  assert.deepEqual(result.unmatched.map((x) => x.order.id), ["WO-X"]);
  assert.equal(inferredStripModel([entry("WO-1", "SF-03-01")], [pallet(1, "SF-03-01")], null).pallets[0].inferred, true);
});

test("configured map applies defaults, explicit alternates, dual pallets, and other", () => {
  const orders = [
    entry("CP-DEFAULT", "CPDG-06-01"), entry("CP-ALT", "CPDG-06-01", { palletNo: 4 }),
    entry("HG-DEFAULT", "HG-06-01"), entry("HG-ALT", "HG-06-01", { palletNo: 2 }),
    entry("DUAL", "MPW-01-01"), entry("OTHER", "UNKNOWN"),
  ];
  const result = configuredStripModel(orders, map, null);
  const ids = (palletNo, label) => result.pallets[palletNo - 1].workpieces.find((x) => x.label === label).orders.map((x) => x.order.id);
  assert.deepEqual(ids(2, "CPDG-06"), ["CP-DEFAULT"]);
  assert.deepEqual(ids(4, "CPDG-06"), ["CP-ALT"]);
  assert.deepEqual(ids(4, "HG-06"), ["HG-DEFAULT"]);
  assert.deepEqual(ids(2, "HG-06"), ["HG-ALT"]);
  assert.deepEqual(ids(2, "MPW-01"), ["DUAL"]);
  assert.deepEqual(ids(5, "MPW-01"), ["DUAL"]);
  assert.deepEqual(result.unmatched.map((x) => x.order.id), ["OTHER"]);
  assert.equal(result.pallets[1].inferred, false);
});

test("workpiece rows aggregate multiple orders, preserve empty rows, and select active pallet by default", () => {
  const first = entry("SF-A", "SF-03-01", { done: 42, total: 135 });
  const second = entry("SF-B", "SF-03-01", { done: 8, total: 15 });
  const result = configuredStripModel([first, second], map, first.order);
  const workpieces = result.pallets[0].workpieces;
  assert.deepEqual({ count: workpieces[0].orderCount, done: workpieces[0].done, total: workpieces[0].total, percent: workpieces[0].percent }, { count: 2, done: 50, total: 150, percent: 33 });
  assert.equal(workpieces[1].orderCount, 0);
  assert.equal(result.defaultOpen, "1");
});

test("dual-pallet display does not mutate or multiply input totals", () => {
  const dual = entry("DUAL", "MPW-01-01", { done: 3, total: 10 });
  const result = configuredStripModel([dual], map, dual.order);
  assert.equal(result.pallets[1].workpieces.find((x) => x.label === "MPW-01").done, 3);
  assert.equal(result.pallets[4].workpieces.find((x) => x.label === "MPW-01").done, 3);
  assert.equal(dual.order.done, 3);
});

test("progress uses the list floor rule and any over-quantity order flags its workpiece and pallet", () => {
  const result = configuredStripModel([
    entry("OVER", "SF-03-01", { done: 12, total: 10 }),
    entry("ZERO", "SF-03-01", { done: 0, total: 10 }),
  ], map, null);
  const workpiece = result.pallets[0].workpieces[0];
  assert.deepEqual({ done: workpiece.done, total: workpiece.total, percent: workpiece.percent }, { done: 12, total: 20, percent: 60 });
  assert.equal(workpiece.isOver, true);
  assert.equal(result.pallets[0].isOver, true);
  assert.equal(workpiece.statusOrder.id, "OVER");
});

test("aggregate and order detail use floor rounding, including 689/536, and exact full has a marker source", () => {
  const over = configuredStripModel([entry("OVER", "SF-03-01", { done: 689, total: 536 })], map, null).pallets[0].workpieces[0];
  assert.equal(over.percent, 128);
  assert.equal(over.statusOrder.id, "OVER");
  const full = configuredStripModel([entry("FULL", "SF-03-01", { done: 10, total: 10 })], map, null).pallets[0].workpieces[0];
  assert.equal(full.percent, 100);
  assert.equal(full.isFull, true);
  assert.equal(full.isOver, false);
  assert.equal(full.statusOrder.id, "FULL");
});

test("not-yet-full aggregate uses normal rounding like order detail", () => {
  const workpiece = configuredStripModel([entry("PARTIAL", "SF-03-01", { done: 2, total: 3 })], map, null).pallets[0].workpieces[0];
  assert.equal(workpiece.percent, 67);
});

test("over-quantity order takes precedence over an earlier exactly-full order", () => {
  const workpiece = configuredStripModel([
    entry("FULL", "SF-03-01", { done: 10, total: 10 }),
    entry("OVER", "SF-03-01", { done: 12, total: 10 }),
  ], map, null).pallets[0].workpieces[0];
  assert.equal(workpiece.statusOrder.id, "OVER");
  assert.equal(workpiece.statusOrder.done - workpiece.statusOrder.total, 2);
});

test("inferred strip requires at least one current order placed on an RPC pallet", () => {
  const orders = [entry("CURRENT", "SF-03-01")];
  const productionEmpty = [1, 2, 3, 4, 5, 6].map((palletNo) => pallet(palletNo));
  assert.equal(inferredStripModel(orders, productionEmpty, null).pallets.some((item) => item.hasOrder), false);
  assert.equal(inferredStripModel(orders, [pallet(1, "NOT-A-CURRENT-ORDER")], null).pallets.some((item) => item.hasOrder), false);
  assert.equal(inferredStripModel(orders, [pallet(1, "SF-03-01")], null).pallets.some((item) => item.hasOrder), true);
});

test("unmatched group reports over-quantity when any hidden order is over", () => {
  const result = configuredStripModel([
    entry("OVER-11-1", "UNKNOWN-A", { done: 11, total: 1 }),
    entry("OVER-377-372", "UNKNOWN-B", { done: 377, total: 372 }),
  ], map, null);
  assert.equal(result.hasUnmatched, true);
  assert.equal(result.unmatchedIsOver, true);
});

test("specified partial quantities round consistently", () => {
  const cases = [[87, 159, 55], [95, 140, 68]];
  for (const [done, total, expected] of cases) {
    const workpiece = configuredStripModel([entry(`${done}-${total}`, "SF-03-01", { done, total })], map, null).pallets[0].workpieces[0];
    assert.equal(workpiece.percent, expected);
  }
});
