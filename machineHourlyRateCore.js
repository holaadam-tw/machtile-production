(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MachTileMachineHourlyRateCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_HOURLY_RATE = 100000;

  function parseRate(value) {
    const text = String(value ?? "").trim();
    if (!text || !/^\d+(?:\.\d{1,2})?$/.test(text)) {
      return { ok: false, error: "請輸入數字，最多小數 2 位" };
    }
    const rate = Number(text);
    if (!Number.isFinite(rate) || rate <= 0) return { ok: false, error: "時率必須大於 0" };
    if (rate > MAX_HOURLY_RATE) return { ok: false, error: `時率不可超過 ${MAX_HOURLY_RATE.toLocaleString("zh-TW")} 元／時` };
    return { ok: true, value: rate };
  }

  function normalizeSnapshot(payload) {
    const machines = Array.isArray(payload?.machines) ? payload.machines : [];
    const history = Array.isArray(payload?.history) ? payload.history : [];
    return {
      machines: machines.map((row) => ({
        id: String(row?.id || ""),
        code: String(row?.machine_code || ""),
        name: String(row?.name || row?.machine_code || ""),
        hourlyRate: row?.hourly_rate == null ? null : Number(row.hourly_rate),
      })).filter((row) => row.id && row.code),
      history: history.map((row) => ({
        id: String(row?.id || ""),
        machineCode: String(row?.machine_code || ""),
        actorName: String(row?.actor_name || row?.actor_account || "未知管理員"),
        oldRate: row?.old_rate == null ? null : Number(row.old_rate),
        newRate: row?.new_rate == null ? null : Number(row.new_rate),
        changedAt: String(row?.changed_at || ""),
      })),
    };
  }

  function canOpen(role) {
    return String(role || "").trim().toLowerCase() === "admin";
  }

  return { MAX_HOURLY_RATE, parseRate, normalizeSnapshot, canOpen };
});
