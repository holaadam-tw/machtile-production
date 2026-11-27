(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileHmcNoOrderMergeCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const ROLES = Object.freeze(["planner", "manager", "admin"]);
  const ERROR_KEYS = Object.freeze({
    WORK_ORDER_CLOSED: "hmc_merge_err_work_order_closed", MULTIPLE_STAGED_TOTALS: "hmc_merge_err_multiple_totals",
    TOTAL_BELOW_REPORTED: "hmc_merge_err_total_below", MERGE_SYNC_PENDING: "hmc_merge_err_sync_pending",
    OPERATOR_LIST_INVALID: "hmc_merge_err_operator_required", OPERATOR_LIST_TOO_LONG: "hmc_merge_err_operator_too_many",
    OPERATOR_LIST_MEMBER_NOT_FOUND: "hmc_merge_err_operator_not_found", OPERATOR_LIST_MEMBER_INACTIVE: "hmc_merge_err_operator_inactive",
    OPERATOR_LIST_MEMBER_LEGACY_ID_MISSING: "hmc_merge_err_operator_legacy_missing",
    OPERATOR_LIST_MEMBER_LEGACY_ID_INVALID: "hmc_merge_err_operator_legacy_invalid", PLANNER_REQUIRED: "hmc_merge_err_planner",
    WORK_ORDER_NOT_FOUND: "hmc_merge_err_work_order_not_found", PROCESS_NOT_FOUND: "hmc_merge_err_process_not_found",
    PART_NO_MISMATCH: "hmc_merge_err_part_mismatch", PROCESS_MACHINE_MISMATCH: "hmc_merge_err_machine_mismatch",
    MACHINE_DEPARTMENT_INACTIVE: "hmc_merge_err_department", INVALID_REPORT_TARGET: "hmc_merge_err_target",
    LEGACY_PROGRESS_MISSING: "hmc_merge_err_legacy_progress_missing",
    CAPTURE_NOT_FOUND: "hmc_merge_err_capture_missing", CAPTURE_SUPERSEDED: "hmc_merge_err_capture_superseded",
    COMMAND_UUID_CONFLICT: "hmc_merge_err_conflict", MACHINE_COMMAND_IN_FLIGHT: "hmc_merge_err_in_flight",
    TENANT_INACTIVE: "hmc_merge_err_tenant", AUTH_REQUIRED: "hmc_merge_err_auth",
    INVALID_PAYLOAD: "hmc_merge_err_invalid", INVALID_MERGE_UUID: "hmc_merge_err_invalid",
    INVALID_CAPTURE_ID: "hmc_merge_err_invalid", INVALID_WORK_ORDER_NO: "hmc_merge_err_invalid",
    INVALID_PROCESS_ORDER: "hmc_merge_err_invalid"
  });
  const text = (v) => String(v == null ? "" : v).trim();
  const upper = (v) => text(v).toUpperCase();
  const uuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(v));
  function allowedRole(role) { return ROLES.includes(text(role).toLowerCase()); }
  function pendingRows(read) {
    if (!read || !Array.isArray(read.pending_no_order)) return [];
    return read.pending_no_order.flatMap((row) => {
      const total = Number(row?.counter_total_qty), pallet = Number(row?.pallet_no);
      if (!uuid(row?.capture_id) || !Number.isInteger(total) || total < 0 || !Number.isInteger(pallet)) return [];
      return [{ captureId: text(row.capture_id), palletNo: pallet, partNo: upper(row.part_no), workpieceKey: text(row.workpiece_key),
        counterTotalQty: total, capturedAt: text(row.captured_at), workDate: text(row.work_date), shiftScope: text(row.shift_scope) }];
    });
  }
  function eligibleProcesses(rows, machineCode, partNo) {
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      const wo = row?.work_orders || {}, machine = row?.machines || {};
      return upper(machine.machine_code) === upper(machineCode) && upper(wo.part_no) === upper(partNo)
        && !["completed", "skipped"].includes(text(row.status).toLowerCase())
        && !["completed", "shipped", "cancelled"].includes(text(wo.status).toLowerCase());
    }).map((row) => ({ id: text(row.id), workOrderNo: text(row.work_orders.work_order_no), processOrder: Number(row.process_order),
      processName: text(row.process_name), partNo: upper(row.work_orders.part_no) }))
      .filter((row) => row.workOrderNo && Number.isInteger(row.processOrder));
  }
  function buildPayload(input) {
    const operators = [...new Set((Array.isArray(input?.operatorAppUserIds) ? input.operatorAppUserIds : []).map(text).filter(uuid))];
    const payload = { merge_uuid: text(input?.mergeUuid), capture_id: text(input?.captureId), work_order_no: text(input?.workOrderNo),
      process_order: Number(input?.processOrder), operator_app_user_ids: operators };
    if (!uuid(payload.merge_uuid) || !uuid(payload.capture_id) || !payload.work_order_no || !Number.isInteger(payload.process_order)) return { ok: false, error: "INVALID_PAYLOAD" };
    if (!operators.length) return { ok: false, error: "OPERATOR_LIST_INVALID" };
    if (operators.length > 10) return { ok: false, error: "OPERATOR_LIST_TOO_LONG" };
    return { ok: true, payload };
  }
  function contentKey(input) { return JSON.stringify({ capture_id: text(input.captureId), work_order_no: text(input.workOrderNo), process_order: Number(input.processOrder), operator_app_user_ids: [...new Set(input.operatorAppUserIds.map(text))].sort() }); }
  function createCommandStore(makeUuid) { const map = new Map(); return { uuidFor(input) { const key = contentKey(input); if (!map.has(key)) map.set(key, makeUuid()); return map.get(key); }, done(input) { map.delete(contentKey(input)); } }; }
  function errorCode(error) { const hay = `${error?.message || ""} ${error?.details || ""}`; return Object.keys(ERROR_KEYS).find((code) => hay.includes(code)) || ""; }
  function resultKey(result) { return result?.result === "nothing_to_merge" ? "hmc_merge_nothing" : ["merged", "replayed", "already_merged"].includes(result?.result) ? "hmc_merge_success" : "hmc_merge_err_generic"; }
  function errorKey(error) { return ERROR_KEYS[errorCode(error)] || "hmc_merge_err_generic"; }
  return Object.freeze({ ROLES, ERROR_KEYS, allowedRole, pendingRows, eligibleProcesses, buildPayload, createCommandStore, errorCode, errorKey, resultKey });
}));
