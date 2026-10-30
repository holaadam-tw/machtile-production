// cardMachineTimeCore.js — Monitor 卡片「只改機台加工時間」的專用 payload。
// 批次報工自 PR #93 起使用累計數契約，不再承擔 cycle-time-only 報工。
(function attachMachTileCardMachineTimeCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileCardMachineTimeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileCardMachineTimeCore() {
  "use strict";

  function localDate(iso, timeZone = "Asia/Taipei") {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
      const part = (type) => parts.find((x) => x.type === type)?.value || "";
      return `${part("year")}-${part("month")}-${part("day")}`;
    } catch {
      return d.toISOString().slice(0, 10);
    }
  }

  function buildPayload({ order, actorAppUserId, endedAt, startedAt, reportUuid, tenantId, cycleTimeSeconds, allowWithoutStart = false }) {
    const cycle = Number(cycleTimeSeconds);
    if (!order?.workOrderId || !order?.processId) throw new Error("這台目前沒有派工，不能儲存機台加工時間");
    if (!actorAppUserId) throw new Error("找不到登入者，不能儲存機台加工時間");
    if (!startedAt && allowWithoutStart !== true) throw new Error("沒有開工時間");
    if (!reportUuid) throw new Error("缺少 report_uuid");
    if (!Number.isInteger(cycle) || cycle <= 0) throw new Error("機台加工時間要大於 0 秒");
    const effectiveStartedAt = startedAt || endedAt;
    if (!effectiveStartedAt) throw new Error("沒有開工時間");
    const workTotal = Number(order.total || 0) || null;
    const machineQty = Number(order.done || 0) || 0;
    const payload = {
      report_uuid: reportUuid,
      tenant_id: tenantId || order.tenantId || undefined,
      work_order_id: order.workOrderId,
      process_id: order.processId,
      report_date: localDate(endedAt),
      completed_qty: 0,
      defect_qty: 0,
      status_after_report: order.processStatus || "running",
      remark: "[中午報工]",
      report_type: "noon",
      report_payload: {
        report_type: "noon",
        work_total_qty: workTotal,
        cycle_time_seconds: cycle,
        machine_qty: machineQty,
        completed_qty: 0,
        defect_qty: 0,
        has_program_upload: false,
        overtime_plan: "",
        pm_abnormal: "",
        abnormal_type: "",
      },
      work_total_qty: workTotal,
      cycle_time_seconds: cycle,
      started_at: effectiveStartedAt,
      ended_at: effectiveStartedAt,
      user_id: actorAppUserId,
    };
    if (!payload.tenant_id) delete payload.tenant_id;
    return { payload, operators: [actorAppUserId], timeOnly: true };
  }

  function fingerprint({ processId, actorAppUserId, cycleTimeSeconds }) {
    return [String(processId || ""), String(actorAppUserId || ""), String(Number(cycleTimeSeconds) || "")].join("|");
  }

  function ensureReportUuid(draft, values, uuidFn) {
    const nextFingerprint = fingerprint(values);
    if (draft?.fingerprint === nextFingerprint && draft.reportUuid) {
      return { reportUuid: draft.reportUuid, fingerprint: nextFingerprint, reused: true };
    }
    return { reportUuid: uuidFn(), fingerprint: nextFingerprint, reused: false };
  }

  return Object.freeze({ localDate, buildPayload, fingerprint, ensureReportUuid });
});
