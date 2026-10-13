(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MachTileInspectionLinkCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const PARAMS = ["wo_id", "wo", "process_id", "process", "machine_id", "machine", "operator_id", "operator", "return_url"];
  function normalizedMachine(value) { return String(value || "").trim().toUpperCase(); }
  function isAllowed(machineCode, allowlist) {
    const code = normalizedMachine(machineCode);
    if (!code || !Array.isArray(allowlist)) return false;
    const allowed = allowlist.map(normalizedMachine).filter(Boolean);
    return allowed.includes("*") || allowed.includes(code);
  }
  function buildUrl(baseUrl, values) {
    if (!String(baseUrl || "").trim()) return "";
    let url;
    try { url = new URL(String(baseUrl).trim()); } catch (_) { return ""; }
    if (!['https:', 'http:'].includes(url.protocol)) return "";
    url.searchParams.set("tab", "process_record");
    PARAMS.forEach((key) => {
      const value = String(values && values[key] != null ? values[key] : "").trim();
      if (value) url.searchParams.set(key, value);
    });
    return url.toString();
  }
  return Object.freeze({ PARAMS, normalizedMachine, isAllowed, buildUrl });
});
