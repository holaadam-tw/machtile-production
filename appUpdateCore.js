(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MachTileAppUpdateCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const RELOAD_COOLDOWN_MS = 30 * 60 * 1000;

  function normalizeVersion(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function deploymentSequence(value) {
    const version = normalizeVersion(value);
    const match = version.match(/^(\d{8}).*?-r(\d+)$/i);
    return match ? (Number(match[1]) * 1000) + Number(match[2]) : null;
  }

  function isNewerVersion(pageVersion, latestVersion) {
    const page = deploymentSequence(pageVersion);
    const latest = deploymentSequence(latestVersion);
    return page !== null && latest !== null && latest > page;
  }

  function decide({ pageVersion, latestVersion, busy = false, tv = false } = {}) {
    const page = normalizeVersion(pageVersion);
    const latest = normalizeVersion(latestVersion);
    if (!page || !latest || !isNewerVersion(page, latest)) return "none";
    if (busy) return "defer";
    return tv ? "reload" : "prompt";
  }

  function reloadAllowed(record, latestVersion, now = Date.now()) {
    if (!record || record.version !== normalizeVersion(latestVersion)) return true;
    const reloadedAt = Number(record.reloadedAt);
    return !Number.isFinite(reloadedAt) || now - reloadedAt >= RELOAD_COOLDOWN_MS;
  }

  return { CHECK_INTERVAL_MS, RELOAD_COOLDOWN_MS, normalizeVersion, deploymentSequence, isNewerVersion, decide, reloadAllowed };
});
