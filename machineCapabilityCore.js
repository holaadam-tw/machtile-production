(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MachTileMachineCapabilityCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const FIELDS = Object.freeze([
    "station_mode", "report_mode", "close_enabled", "claim_next_enabled",
    "replace_stopped_enabled", "dispatch_pool_enabled", "enabled",
  ]);

  function code(value) { return String(value || "").trim().toUpperCase(); }
  function listed(list, machineCode) {
    const wanted = code(machineCode);
    return Array.isArray(list) && list.some((item) => code(item) === wanted || String(item).trim() === "*");
  }
  function legacyValues(config, machineCode) {
    return {
      station_mode: listed(config.multiStationMachines, machineCode) ? "multi" : "single",
      report_mode: config.enableStationReport === true && listed(config.stationReportMachines, machineCode) ? "smart" : "field",
      close_enabled: config.enableFinishClose === true && listed(config.finishCloseMachines, machineCode),
      claim_next_enabled: config.enableFinishClaimStartCombo === true && listed(config.finishClaimStartComboMachines, machineCode),
      replace_stopped_enabled: listed(config.dispatchPoolMachines, machineCode),
      dispatch_pool_enabled: listed(config.dispatchPoolMachines, machineCode),
      enabled: listed(config.stationCommandMachines, machineCode),
    };
  }
  function classifySnapshot(payload) {
    if (payload?.error) return { status: "error", machines: [] };
    if (!payload || !Array.isArray(payload.machines) || payload.machines.length === 0) return { status: "no_snapshot", machines: [] };
    return { status: payload.stale === true ? "stale" : "ready", machines: payload.machines };
  }
  function compare(config, payload) {
    const snapshot = classifySnapshot(payload);
    const mismatches = [];
    for (const machine of snapshot.machines) {
      const machineCode = code(machine.machine_code);
      const legacy = legacyValues(config || {}, machineCode);
      for (const field of FIELDS) {
        if (machine[field] !== legacy[field]) mismatches.push({ machineCode, field, legacy: legacy[field], capability: machine[field] });
      }
    }
    return { status: snapshot.status, mismatches, machines: snapshot.machines.length };
  }
  function missingMachine(payload, machineCode) {
    return !classifySnapshot(payload).machines.some((machine) => code(machine.machine_code) === code(machineCode));
  }
  return { FIELDS, classifySnapshot, compare, legacyValues, missingMachine };
});
