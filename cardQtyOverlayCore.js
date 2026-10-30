(function attachCardQtyOverlayCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileCardQtyOverlayCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCardQtyOverlayCore() {
  "use strict";

  const MAX_AGE_MS = 15 * 60 * 1000;
  const text = (value) => String(value ?? "").trim();
  const machine = (value) => text(value).toUpperCase();

  function normalize(value) {
    const total = Number(value?.total);
    const at = Number(value?.at);
    if (!machine(value?.machine) || !text(value?.orderNo) || !Number.isFinite(total) || total < 0 || !Number.isFinite(at)) return null;
    return { machine: machine(value.machine), orderNo: text(value.orderNo), step: Number(value.step) || 0,
      processId: text(value.processId), total, at };
  }

  function create(input, status = "accepted", nowMs = Date.now()) {
    if (!["applied", "applied-late"].includes(text(status).toLowerCase())) return null;
    return normalize({ ...input, at: nowMs });
  }

  function matches(overlay, order) {
    const item = normalize(overlay);
    if (!item || machine(order?.machineCode || order?.machine) !== item.machine || text(order?.id) !== item.orderNo) return false;
    if (item.processId && text(order?.processId) !== item.processId) return false;
    return !item.step || Number(order?.stationStep) === item.step;
  }

  function apply(serverProgress, overlay, order, nowMs = Date.now()) {
    const server = Math.max(0, Number(serverProgress) || 0);
    const item = normalize(overlay);
    if (!item || !matches(item, order)) return { completed: server, overlay: item, state: "none", clear: false };
    if (server >= item.total) return { completed: server, overlay: null, state: "synced", clear: true };
    if (nowMs - item.at >= MAX_AGE_MS) return { completed: server, overlay: null, state: "slow", clear: true };
    return { completed: Math.max(server, item.total), overlay: item, state: "syncing", clear: false };
  }

  return { MAX_AGE_MS, normalize, create, matches, apply };
});
