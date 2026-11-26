"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { configuredStripModel } = require("./hmcPalletCardCore.js");
const doing = require("./hmcPalletDoingCore.js");
const entry = (id, partNo, extra = {}) => ({ order: { id, processId: `${id}-P`, partNo, total: 100, done: 10, ...extra } });
const map = {
  3: [{ id: "3-1", partNos: ["AR22-01"], label: "AR22" }],
  4: [{ id: "4-1", partNos: ["P16-R01-04A"], label: "P16" }, { id: "4-2", partNos: ["P22-R01-01A"], label: "P22" }],
  5: [{ id: "5-1", partNos: ["A37-01"], label: "A37" }],
};
const model = () => configuredStripModel([entry("W1", "AR22-01"), entry("W2", "P16-R01-04A"), entry("W3", "P22-R01-01A")], map, null);
const wp = (m, palletNo, id) => m.pallets.find((p) => p.palletNo === palletNo).workpieces.find((w) => w.id === id);
const read = (...rows) => ({ machine_code: "B02", require_planner_confirm: true, pallets: rows.reduce((acc, row) => {
  let p = acc.find((x) => x.pallet_no === row.pallet_no);
  if (!p) { p = { pallet_no: row.pallet_no, workpieces: [] }; acc.push(p); }
  const { pallet_no, ...rest } = row; p.workpieces.push(rest); return acc;
}, []) });

test("three states merge into workpieces and pallets", () => {
  const r = doing.parseRead(read(
    { pallet_no: 3, workpiece_key: "3-1", part_no: "AR22-01", status: "doing" },
    { pallet_no: 4, workpiece_key: "4-1", part_no: "P16-R01-04A", status: "doing", mold_group_code: "P16_P22" },
    { pallet_no: 4, workpiece_key: "4-2", part_no: "P22-R01-01A", status: "idle_reason", reason_code: "shared_mold_on_other", mold_group_code: "P16_P22" },
    { pallet_no: 5, workpiece_key: "5-1", part_no: "A37-01", status: "doing_no_order" },
  ));
  const m = doing.mergeDoing(model(), r);
  assert.equal(wp(m, 3, "3-1").doing.state, "doing");
  assert.equal(wp(m, 4, "4-2").doing.state, "idle");
  assert.equal(wp(m, 4, "4-2").doing.otherPartNo, "P16-R01-04A");
  assert.equal(wp(m, 5, "5-1").doing.state, "noOrder");
  assert.equal(m.pallets.find((p) => p.palletNo === 3).doingState, "doing");
  assert.equal(m.pallets.find((p) => p.palletNo === 4).doingState, "doing");
  assert.equal(m.pallets.find((p) => p.palletNo === 5).doingState, "noOrder");
  assert.equal(m.pallets.find((p) => p.palletNo === 1).doingState, "none");
  assert.deepEqual(doing.chipClasses(m.pallets[4]), ["is-doing", "is-doing-no-order"]);
  assert.equal(doing.chipTextKey(m.pallets[2]), "hmc_doing_chip_on");
  assert.equal(doing.chipTextKey(m.pallets[4]), "hmc_doing_chip_no_order");
  assert.equal(doing.chipTextKey(m.pallets[0]), "");
  assert.equal(doing.pillInfo(wp(m, 4, "4-2").doing).kind, "idle");
  assert.equal(doing.pillInfo(null), null);
});

test("existing is-active / is-over / hasOrder are untouched by merge", () => {
  const before = model();
  const after = doing.mergeDoing(model(), doing.parseRead(read({ pallet_no: 3, workpiece_key: "3-1", part_no: "AR22-01", status: "doing" })));
  for (const [i, p] of before.pallets.entries()) {
    assert.equal(after.pallets[i].isActive, p.isActive);
    assert.equal(after.pallets[i].isOver, p.isOver);
    assert.equal(after.pallets[i].hasOrder, p.hasOrder);
  }
});

test("part_no matching is case- and whitespace-insensitive (fallback when key differs)", () => {
  const r = doing.parseRead(read({ pallet_no: 3, workpiece_key: "other-key", part_no: "  ar22-01 ", status: "doing" }));
  assert.equal(r.rows[0].partNo, "AR22-01");
  const m = doing.mergeDoing(model(), r);
  assert.equal(wp(m, 3, "3-1").doing.state, "doing");
  const lower = configuredStripModel([entry("W1", "ar22-01")], { 3: [{ id: "3-1", partNos: [" ar22-01"], label: "x" }] }, null);
  assert.equal(doing.partNoFor(lower.pallets[2].workpieces[0]), "AR22-01");
});

test("unknown status or malformed read is not shown", () => {
  const r = doing.parseRead(read({ pallet_no: 3, workpiece_key: "3-1", part_no: "AR22-01", status: "mystery" }));
  assert.equal(r.rows.length, 0);
  assert.equal(wp(doing.mergeDoing(model(), r), 3, "3-1").doing, null);
  assert.equal(doing.parseRead(null), null);
  assert.equal(doing.parseRead({ pallets: "x" }), null);
  assert.equal(doing.parseRead([]), null);
  const m = model();
  assert.equal(doing.mergeDoing(m, null), m);
});

test("set payload carries exactly the contract fields", () => {
  const res = doing.buildSetPayload({ machineCode: "b02", palletNo: 4, workpieceKey: "4-1", partNo: " p16-r01-04a ", status: "doing", commandUuid: "u-1" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.payload, { machine_code: "B02", pallet_no: 4, workpiece_key: "4-1", part_no: "P16-R01-04A", status: "doing",
    reason_code: null, reason_text: null, switch_mold: false, command_uuid: "u-1" });
  assert.equal(typeof res.payload.pallet_no, "number");
  const idle = doing.buildSetPayload({ machineCode: "B02", palletNo: 4, workpieceKey: "4-1", partNo: "P16-R01-04A", status: "idle_reason", reasonCode: "waiting_material", reasonText: "ignored? no, kept", commandUuid: "u-2" });
  assert.equal(idle.payload.reason_code, "waiting_material");
  const doingWithReason = doing.buildSetPayload({ machineCode: "B02", palletNo: 4, workpieceKey: "4-1", partNo: "P", status: "doing", reasonCode: "other", reasonText: "x", commandUuid: "u" });
  assert.equal(doingWithReason.payload.reason_code, null);
  assert.equal(doingWithReason.payload.reason_text, null);
});

test("payload pre-checks mirror the server", () => {
  const base = { machineCode: "B02", palletNo: 4, workpieceKey: "4-1", partNo: "P", commandUuid: "u" };
  assert.equal(doing.buildSetPayload({ ...base, status: "idle_reason" }).error, "INVALID_REASON_CODE");
  assert.equal(doing.buildSetPayload({ ...base, status: "idle_reason", reasonCode: "bogus" }).error, "INVALID_REASON_CODE");
  assert.equal(doing.buildSetPayload({ ...base, status: "idle_reason", reasonCode: "other", reasonText: "  " }).error, "REASON_TEXT_REQUIRED");
  assert.equal(doing.buildSetPayload({ ...base, status: "doing", partNo: "" }).error, "PART_NO_REQUIRED");
  assert.equal(doing.buildSetPayload({ ...base, status: "weird" }).error, "INVALID_STATUS");
  assert.equal(doing.buildSetPayload({ ...base, status: "doing", palletNo: 0 }).error, "INVALID_PALLET_NO");
  assert.equal(doing.buildSetPayload({ ...base, status: "doing", commandUuid: "" }).error, "INVALID_COMMAND_UUID");
  assert.equal(doing.REASON_CODES.length, 5);
  const allCodes = ["shared_mold_on_other", "waiting_material", "waiting_program", "waiting_inspection", "other"];
  for (const code of allCodes) assert.equal(doing.buildSetPayload({ ...base, status: "idle_reason", reasonCode: code, reasonText: "t" }).ok, true);
});

test("retry keeps the same command_uuid until success; different content gets a new one", () => {
  let n = 0;
  const store = doing.createCommandStore(() => `uuid-${++n}`);
  const c = { machineCode: "B02", palletNo: 4, workpieceKey: "4-1", partNo: "p16", status: "doing" };
  const first = store.uuidFor(c);
  assert.equal(store.uuidFor({ ...c, partNo: " P16 " }), first);
  assert.equal(store.uuidFor(c), first);
  assert.notEqual(store.uuidFor({ ...c, status: "idle_reason", reasonCode: "other", reasonText: "x" }), first);
  store.done(c);
  assert.notEqual(store.uuidFor(c), first);
});

test("start status and part number choice", () => {
  const m = model();
  assert.equal(doing.startStatus(wp(m, 3, "3-1")), "doing");
  assert.equal(doing.startStatus(wp(m, 5, "5-1") && { orderCount: 0 }), "doing_no_order");
  assert.equal(doing.partNoFor(wp(m, 4, "4-2")), "P22-R01-01A");
});

test("error mapping: server codes, offline and generic", () => {
  assert.equal(doing.errorKey(new Error('400 {"message":"SHARED_MOLD_BUSY"}'), true), "hmc_doing_err_shared_mold");
  assert.equal(doing.errorKey(new Error("400 MACHINE_NOT_ALLOWED"), true), "hmc_doing_err_machine");
  assert.equal(doing.errorKey(new Error("BRIDGE_NOT_ALLOWED"), true), "hmc_doing_err_bridge");
  assert.equal(doing.errorKey(new Error("ACCOUNT_DISABLED"), true), "hmc_doing_err_disabled");
  assert.equal(doing.errorKey(new TypeError("Failed to fetch"), true), "hmc_doing_err_offline");
  assert.equal(doing.errorKey(new Error("whatever"), false), "hmc_doing_err_offline");
  assert.equal(doing.errorKey(new Error("500 boom"), true), "hmc_doing_err_generic");
});
