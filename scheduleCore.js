(function attachMachTileScheduleCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileScheduleCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileScheduleCore() {
  "use strict";

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function estimateDuration(input) {
    const setupMinutes = finiteNumber(input?.setupMinutes);
    const standardUnitMinutes = finiteNumber(input?.standardUnitMinutes);
    const handlingMinutes = finiteNumber(input?.handlingMinutes);
    const remainingQty = finiteNumber(input?.remainingQty);
    const overrideMinutes = finiteNumber(input?.overrideMinutes);
    const overrideReason = String(input?.overrideReason || "").trim();
    const missing = [];

    if (setupMinutes === null || setupMinutes < 0) missing.push("換線／架機時間");
    if (standardUnitMinutes === null || standardUnitMinutes <= 0) missing.push("標準單件時間");
    if (handlingMinutes === null || handlingMinutes < 0) missing.push("本批上下料時間");
    if (remainingQty === null || remainingQty < 0) missing.push("剩餘數量");

    if (missing.length) {
      return {
        ready: false,
        missing,
        baselineMinutes: null,
        effectiveMinutes: null,
        source: "missing",
      };
    }

    const baselineMinutes = setupMinutes + standardUnitMinutes * remainingQty + handlingMinutes;
    const hasValidOverride = overrideMinutes !== null && overrideMinutes > 0 && Boolean(overrideReason);
    return {
      ready: true,
      missing: [],
      baselineMinutes,
      effectiveMinutes: hasValidOverride ? overrideMinutes : baselineMinutes,
      source: hasValidOverride ? "override" : "calculated",
      invalidOverride: overrideMinutes !== null && !hasValidOverride,
    };
  }

  function normalizeServerEstimate(input) {
    const missing = Array.isArray(input?.missing)
      ? input.missing.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const baselineMinutes = finiteNumber(input?.baseline_minutes ?? input?.baselineMinutes);
    const effectiveMinutes = finiteNumber(input?.effective_minutes ?? input?.effectiveMinutes);
    const remainingQty = finiteNumber(input?.remaining_qty ?? input?.remainingQty);
    const activeHoldCount = finiteNumber(input?.active_hold_count ?? input?.activeHoldCount) || 0;
    const source = ["calculated", "override"].includes(input?.source) ? input.source : "missing";
    const ready = input?.ready === true && baselineMinutes !== null && effectiveMinutes !== null;
    return {
      processId: String(input?.process_id ?? input?.processId ?? ""),
      ready,
      schedulable: ready && input?.schedulable === true && activeHoldCount === 0,
      missing: ready ? [] : (missing.length ? missing : ["排程工時資料不完整"]),
      baselineMinutes: ready ? baselineMinutes : null,
      effectiveMinutes: ready ? effectiveMinutes : null,
      remainingQty,
      source: ready ? source : "missing",
      scheduleInputId: String(input?.schedule_input_id ?? input?.scheduleInputId ?? ""),
      overrideId: String(input?.override_id ?? input?.overrideId ?? ""),
      activeHoldCount,
    };
  }

  function scheduleErrorCode(error) {
    const text = String(error?.message || error || "");
    const known = [
      "TENANT_REQUIRED", "FORBIDDEN", "ACTOR_NOT_FOUND", "PROCESS_NOT_FOUND",
      "PROCESS_ID_REQUIRED", "IDEMPOTENCY_KEY_REQUIRED", "INVALID_STANDARD_TIME",
      "INVALID_BASELINE_SOURCE", "INVALID_SOURCE_DATA", "PROCESS_CLOSED",
      "REASON_REQUIRED", "INVALID_DURATION", "MISSING_STANDARD_TIME",
      "OVERRIDE_NOT_FOUND", "ACTIVE_REQUIRED", "INVALID_HOLD_TYPE",
      "HOLD_ID_REQUIRED", "ACTIVE_HOLD_NOT_FOUND", "INVALID_EVENT_KIND",
      "INVALID_TIME_RANGE",
    ];
    return known.find((code) => new RegExp(`(?:^|[^A-Z_])${code}(?:$|[^A-Z_])`).test(text)) || "";
  }

  function dateAtLocalMinutes(day, minutes) {
    const value = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
    value.setMinutes(minutes);
    return value;
  }

  function localDateKey(value) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }

  function subtractBlocks(windows, blocks) {
    const normalizedBlocks = (Array.isArray(blocks) ? blocks : [])
      .map((block) => ({ start: new Date(block.start), end: new Date(block.end) }))
      .filter((block) => !Number.isNaN(block.start.getTime()) && !Number.isNaN(block.end.getTime()) && block.end > block.start)
      .sort((a, b) => a.start - b.start);

    return windows.flatMap((window) => {
      let parts = [{ start: new Date(window.start), end: new Date(window.end), shift: window.shift }];
      normalizedBlocks.forEach((block) => {
        parts = parts.flatMap((part) => {
          if (block.end <= part.start || block.start >= part.end) return [part];
          const next = [];
          if (block.start > part.start) next.push({ ...part, end: new Date(block.start) });
          if (block.end < part.end) next.push({ ...part, start: new Date(block.end) });
          return next;
        });
      });
      return parts;
    }).filter((window) => window.end > window.start);
  }

  function buildAvailabilityWindows(calendar, from, dayCount, blocks) {
    if (!calendar || !Array.isArray(calendar.shifts) || !calendar.shifts.length) return [];
    const workdays = new Set(Array.isArray(calendar.workdays) ? calendar.workdays.map(Number) : []);
    const holidays = new Set(Array.isArray(calendar.holidays) ? calendar.holidays : []);
    const anchor = new Date(from);
    if (Number.isNaN(anchor.getTime())) return [];
    const windows = [];

    for (let offset = -1; offset <= dayCount; offset += 1) {
      const day = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + offset, 0, 0, 0, 0);
      if (!workdays.has(day.getDay()) || holidays.has(localDateKey(day))) continue;
      calendar.shifts.forEach((shift) => {
        const startMinutes = finiteNumber(shift.startMinutes);
        const endMinutes = finiteNumber(shift.endMinutes);
        if (startMinutes === null || endMinutes === null || startMinutes < 0 || endMinutes <= startMinutes) return;
        windows.push({
          start: dateAtLocalMinutes(day, startMinutes),
          end: dateAtLocalMinutes(day, endMinutes),
          shift: shift.label || "班別",
        });
      });
    }

    return subtractBlocks(windows.sort((a, b) => a.start - b.start), blocks);
  }

  function allocateMinutes(windows, requestedStart, durationMinutes) {
    const minutes = finiteNumber(durationMinutes);
    const cursorStart = new Date(requestedStart);
    if (minutes === null || minutes <= 0 || Number.isNaN(cursorStart.getTime())) return null;
    let remainingMs = minutes * 60000;
    let firstStart = null;
    let cursor = cursorStart;

    for (const window of Array.isArray(windows) ? windows : []) {
      if (window.end <= cursor) continue;
      const start = new Date(Math.max(window.start.getTime(), cursor.getTime()));
      if (start >= window.end) continue;
      if (!firstStart) firstStart = new Date(start);
      const availableMs = window.end.getTime() - start.getTime();
      if (availableMs >= remainingMs) {
        return {
          start: firstStart,
          end: new Date(start.getTime() + remainingMs),
        };
      }
      remainingMs -= availableMs;
      cursor = new Date(window.end);
    }
    return null;
  }

  return Object.freeze({
    estimateDuration,
    normalizeServerEstimate,
    scheduleErrorCode,
    buildAvailabilityWindows,
    allocateMinutes,
    subtractBlocks,
    localDateKey,
  });
});
