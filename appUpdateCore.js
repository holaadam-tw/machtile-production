(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MachTileAppUpdateCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const CHECK_INTERVAL_MS = 5 * 60 * 1000;

  function normalizeVersion(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function decide({ pageVersion, latestVersion, busy = false, tv = false } = {}) {
    const page = normalizeVersion(pageVersion);
    const latest = normalizeVersion(latestVersion);
    if (!page || !latest || page === latest) return "none";
    if (tv) return "reload";
    return busy ? "defer" : "prompt";
  }

  return { CHECK_INTERVAL_MS, normalizeVersion, decide };
});
