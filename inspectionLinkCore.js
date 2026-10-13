(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MachTileInspectionLinkCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const PARAMS = ["wo_id", "wo", "process_id", "process", "machine_id", "machine", "operator_id", "operator", "return_url"];
  const DEFAULT_RETURN_URL = "https://app.machtile.com/";
  const RETURN_URL_ALLOWLIST = Object.freeze([
    DEFAULT_RETURN_URL,
    "http://localhost:4173/",
    "http://127.0.0.1:4173/",
  ]);
  function normalizedMachine(value) { return String(value || "").trim().toUpperCase(); }
  function isAllowed(machineCode, allowlist) {
    const code = normalizedMachine(machineCode);
    if (!code || !Array.isArray(allowlist)) return false;
    const allowed = allowlist.map(normalizedMachine).filter(Boolean);
    return allowed.includes("*") || allowed.includes(code);
  }
  function allowedReturnUrl(value) {
    const candidate = String(value || "").trim();
    if (!candidate) return DEFAULT_RETURN_URL;
    let parsed;
    try { parsed = new URL(candidate); } catch (_) { return DEFAULT_RETURN_URL; }
    if (parsed.username || parsed.password) return DEFAULT_RETURN_URL;
    const normalized = parsed.toString();
    return RETURN_URL_ALLOWLIST.includes(normalized) ? normalized : DEFAULT_RETURN_URL;
  }
  function buildUrl(baseUrl, values) {
    if (!String(baseUrl || "").trim()) return "";
    let url;
    try { url = new URL(String(baseUrl).trim()); } catch (_) { return ""; }
    if (!['https:', 'http:'].includes(url.protocol)) return "";
    url.searchParams.set("tab", "process_record");
    PARAMS.forEach((key) => {
      const value = key === "return_url"
        ? allowedReturnUrl(values && values[key])
        : String(values && values[key] != null ? values[key] : "").trim();
      if (value) url.searchParams.set(key, value);
    });
    return url.toString();
  }
  return Object.freeze({ PARAMS, DEFAULT_RETURN_URL, RETURN_URL_ALLOWLIST, normalizedMachine, isAllowed, allowedReturnUrl, buildUrl });
});
