(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MachTileOperationalTrackingCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FINISHED_PROCESS_STATUSES = new Set(["completed", "skipped", "cancelled"]);

  function finitePositive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function round(value, digits = 1) {
    if (!Number.isFinite(value)) return null;
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function summarizeEstimateAccuracy(runs = [], input = {}) {
    const excludedIds = new Set((input.excludedIds || []).map(String));
    const fromTime = input.from ? new Date(input.from).getTime() : Number.NEGATIVE_INFINITY;
    const samples = [];
    const rejected = { excluded: 0, outsidePeriod: 0, missingActual: 0, missingEstimate: 0 };

    (Array.isArray(runs) ? runs : []).forEach((run) => {
      const id = String(run?.id || "");
      if (excludedIds.has(id)) { rejected.excluded += 1; return; }
      const runTime = new Date(run?.run_date || run?.created_at || 0).getTime();
      if (Number.isFinite(fromTime) && Number.isFinite(runTime) && runTime < fromTime) { rejected.outsidePeriod += 1; return; }
      const actualSeconds = finitePositive(run?.pure_cutting_seconds ?? run?.actual_seconds);
      const estimatedSeconds = finitePositive(run?.cnc_program_versions?.estimated_seconds ?? run?.estimated_seconds);
      if (!actualSeconds) { rejected.missingActual += 1; return; }
      if (!estimatedSeconds) { rejected.missingEstimate += 1; return; }
      const signedPct = ((actualSeconds - estimatedSeconds) / estimatedSeconds) * 100;
      samples.push({
        id,
        runDate: run?.run_date || run?.created_at || "",
        machineId: String(run?.machine_id || ""),
        programId: String(run?.program_id || ""),
        programVersionId: String(run?.program_version_id || ""),
        versionLabel: String(run?.cnc_program_versions?.version_no || "-"),
        programLabel: String(run?.cnc_programs?.part_name || run?.work_orders?.part_name || "未命名程式"),
        machineLabel: String(run?.machines?.machine_code || run?.machine_code || "未指定機台"),
        actualSeconds,
        estimatedSeconds,
        signedPct,
        absolutePct: Math.abs(signedPct),
      });
    });

    const averageAbsolutePct = samples.length
      ? samples.reduce((sum, sample) => sum + sample.absolutePct, 0) / samples.length
      : null;
    const averageSignedPct = samples.length
      ? samples.reduce((sum, sample) => sum + sample.signedPct, 0) / samples.length
      : null;
    const within20Count = samples.filter((sample) => sample.absolutePct <= 20).length;

    return {
      sampleCount: samples.length,
      averageAbsolutePct: round(averageAbsolutePct),
      medianAbsolutePct: round(median(samples.map((sample) => sample.absolutePct))),
      averageSignedPct: round(averageSignedPct),
      within20Count,
      within20Rate: samples.length ? round((within20Count / samples.length) * 100) : null,
      samples: samples.sort((left, right) => String(right.runDate).localeCompare(String(left.runDate))),
      rejected,
    };
  }

  function normalizeReason(reason) {
    const value = String(reason || "").trim();
    return value || "未填結構化原因";
  }

  function groupReasons(items) {
    const groups = new Map();
    items.forEach((item) => {
      const reason = normalizeReason(item.reason);
      const current = groups.get(reason) || { reason, count: 0 };
      current.count += 1;
      groups.set(reason, current);
    });
    return [...groups.values()].sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
  }

  function summarizeScheduleDelay(input = {}) {
    const now = new Date(input.now || Date.now()).getTime();
    const fromTime = input.from ? new Date(input.from).getTime() : Number.NEGATIVE_INFINITY;
    const processes = new Map((input.processes || []).map((process) => [String(process.id), process]));
    const activeHolds = new Map();
    (input.holds || []).forEach((hold) => {
      if (hold?.released_at) return;
      const key = String(hold?.process_id || "");
      if (!key) return;
      const list = activeHolds.get(key) || [];
      list.push(hold);
      activeHolds.set(key, list);
    });

    const overdue = (input.reservations || []).filter((reservation) => {
      if (reservation?.is_active === false) return false;
      if (reservation?.resource_kind && reservation.resource_kind !== "machine_spindle") return false;
      const endsAt = new Date(reservation?.ends_at || 0).getTime();
      if (!Number.isFinite(endsAt) || endsAt >= now) return false;
      const process = processes.get(String(reservation?.process_id || ""));
      return !FINISHED_PROCESS_STATUSES.has(String(process?.status || "").toLowerCase());
    }).map((reservation) => {
      const process = processes.get(String(reservation?.process_id || "")) || {};
      const holds = activeHolds.get(String(reservation?.process_id || "")) || [];
      const reason = holds.length ? holds.map((hold) => normalizeReason(hold.reason)).join("；") : "未填結構化原因";
      return {
        processId: String(reservation?.process_id || ""),
        machineId: String(reservation?.machine_id || ""),
        machineLabel: String(reservation?.machines?.machine_code || reservation?.machine_code || "未指定機台"),
        workOrderNo: String(process?.work_orders?.work_order_no || process?.work_order_no || "-"),
        partName: String(process?.work_orders?.part_name || process?.part_name || ""),
        processName: String(process?.process_name || "未命名工序"),
        plannedEndAt: reservation.ends_at,
        delayMinutes: Math.max(0, Math.floor((now - new Date(reservation.ends_at).getTime()) / 60000)),
        reason,
      };
    }).sort((left, right) => right.delayMinutes - left.delayMinutes);

    const replans = (input.replans || []).filter((request) => {
      const requestedAt = new Date(request?.requested_at || 0).getTime();
      return !Number.isFinite(fromTime) || !Number.isFinite(requestedAt) || requestedAt >= fromTime;
    }).map((request) => ({
      reason: normalizeReason(request?.reason),
      triggerType: String(request?.trigger_type || "unknown"),
      status: String(request?.status || "pending"),
      requestedAt: request?.requested_at || "",
      machineLabel: String(request?.machine_code || "未指定機台"),
    }));

    return {
      overdueCount: overdue.length,
      overdue,
      overdueReasons: groupReasons(overdue),
      replanCount: replans.length,
      pendingReplanCount: replans.filter((request) => request.status === "pending").length,
      replanReasons: groupReasons(replans),
      replans,
    };
  }

  return { summarizeEstimateAccuracy, summarizeScheduleDelay };
});
