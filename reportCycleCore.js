// Pure submission rules for first-start cycle-time samples.
(function attachMachTileReportCycleCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileReportCycleCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileReportCycleCore() {
  "use strict";

  function cycleTimeToSend(reportType, currentSeconds, prefilledSeconds) {
    const current = Number(currentSeconds);
    if (!Number.isFinite(current) || current <= 0) return null;
    const roundedCurrent = Math.round(current);
    if (reportType === "workStart" && Number.isFinite(Number(prefilledSeconds)) && roundedCurrent === Math.round(Number(prefilledSeconds))) return null;
    return roundedCurrent;
  }

  return { cycleTimeToSend };
});
