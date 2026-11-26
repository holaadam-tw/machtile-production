const assert = require("node:assert/strict");
const core = require("./hmcNoOrderMergeCore.js");
const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222", U3 = "33333333-3333-4333-8333-333333333333";

assert.equal(core.allowedRole("planner"), true);
assert.equal(core.allowedRole("manager"), true);
assert.equal(core.allowedRole("admin"), true);
assert.equal(core.allowedRole("operator"), false);
assert.deepEqual(core.pendingRows({ pending_no_order: [{ capture_id: U1, pallet_no: 2, part_no: " ab-1 ", workpiece_key: "x", counter_total_qty: 9, captured_at: "2026-11-26T00:00:00Z" }] }),
  [{ captureId: U1, palletNo: 2, partNo: "AB-1", workpieceKey: "x", counterTotalQty: 9, capturedAt: "2026-11-26T00:00:00Z", workDate: "", shiftScope: "" }]);
const processes = core.eligibleProcesses([{ id: U1, process_order: 2, process_name: "銑削", status: "pending", work_orders: { work_order_no: "WO-1", part_no: "AB-1", status: "in_progress" }, machines: { machine_code: "B01" } }], "B01", "ab-1");
assert.deepEqual(processes, [{ id: U1, workOrderNo: "WO-1", processOrder: 2, processName: "銑削", partNo: "AB-1" }]);
const built = core.buildPayload({ mergeUuid: U1, captureId: U2, workOrderNo: "WO-1", processOrder: 2, operatorAppUserIds: [U3, U3] });
assert.deepEqual(built, { ok: true, payload: { merge_uuid: U1, capture_id: U2, work_order_no: "WO-1", process_order: 2, operator_app_user_ids: [U3] } });
assert.equal(core.buildPayload({ mergeUuid: U1, captureId: U2, workOrderNo: "WO", processOrder: 1, operatorAppUserIds: [] }).error, "OPERATOR_LIST_INVALID");
let minted = 0; const store = core.createCommandStore(() => (++minted, U1));
const content = { captureId: U2, workOrderNo: "WO", processOrder: 1, operatorAppUserIds: [U3] };
assert.equal(store.uuidFor(content), store.uuidFor({ ...content })); assert.equal(minted, 1);
for (const [code, key] of Object.entries(core.ERROR_KEYS)) assert.equal(core.errorKey(new Error(`server: ${code}`)), key, code);
assert.equal(core.resultKey({ result: "nothing_to_merge" }), "hmc_merge_nothing");
assert.equal(core.resultKey({ result: "merged" }), "hmc_merge_success");
console.log("hmcNoOrderMergeCore: ok");
