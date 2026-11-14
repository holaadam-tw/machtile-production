(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileHmcPalletCardCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const normalize = (value) => String(value || "").trim().toUpperCase();
  function mapOrdersToPallets(orders, palletStates, palletCount = 6) {
    const states = new Map((Array.isArray(palletStates) ? palletStates : []).map((state) => [Number(state?.palletNo), state]));
    const pallets = Array.from({ length: palletCount }, (_, index) => {
      const palletNo = index + 1;
      const state = states.get(palletNo);
      const partNos = new Set((Array.isArray(state?.slots) ? state.slots : []).map((slot) => normalize(slot?.part?.partNo)).filter(Boolean));
      return { palletNo, configured: partNos.size > 0, partNos: [...partNos], orders: [] };
    });
    const unmatched = [];
    for (const entry of Array.isArray(orders) ? orders : []) {
      const order = entry?.order || entry;
      const partNo = normalize(order?.partNo || order?.part_no || order?.drawing);
      const matches = partNo ? pallets.filter((pallet) => pallet.partNos.includes(partNo)) : [];
      if (matches.length === 1) matches[0].orders.push(entry);
      else unmatched.push(entry);
    }
    return { pallets, unmatched };
  }
  return Object.freeze({ mapOrdersToPallets });
}));
