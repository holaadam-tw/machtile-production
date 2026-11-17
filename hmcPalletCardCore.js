(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileHmcPalletCardCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const normalize = (value) => String(value || "").trim().toUpperCase();
  const orderOf = (entry) => entry?.order || entry || {};
  const partNoOf = (entry) => normalize(orderOf(entry).partNo || orderOf(entry).part_no || orderOf(entry).drawing);
  const orderKey = (entry) => normalize(orderOf(entry).processId || orderOf(entry).process_id || orderOf(entry).id);

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
      const partNo = partNoOf(entry);
      const matches = partNo ? pallets.filter((pallet) => pallet.partNos.includes(partNo)) : [];
      if (matches.length === 1) matches[0].orders.push(entry);
      else unmatched.push(entry);
    }
    return { pallets, unmatched };
  }

  function normalizeMap(machineMap, palletCount) {
    return Array.from({ length: palletCount }, (_, index) => {
      const palletNo = index + 1;
      const workpieces = (Array.isArray(machineMap?.[palletNo]) ? machineMap[palletNo] : []).map((item, itemIndex) => ({
        id: String(item?.id || `${palletNo}-${itemIndex + 1}`),
        label: String(item?.label || item?.partNos?.[0] || "-"),
        partNos: [...new Set((Array.isArray(item?.partNos) ? item.partNos : []).map(normalize).filter(Boolean))],
        isDefault: item?.default !== false,
        dual: item?.dual === true,
        sharedWith: Number(item?.sharedWith) || null,
      }));
      return { palletNo, configured: workpieces.length > 0, workpieces };
    });
  }

  function configuredStripModel(orders, machineMap, activeOrder, palletCount = 6) {
    const pallets = normalizeMap(machineMap, palletCount);
    const unmatched = [];
    for (const entry of Array.isArray(orders) ? orders : []) {
      const partNo = partNoOf(entry);
      const candidates = pallets.flatMap((pallet) => pallet.workpieces
        .filter((workpiece) => workpiece.partNos.includes(partNo))
        .map((workpiece) => ({ pallet, workpiece })));
      const explicitPallet = Number(orderOf(entry).palletNo || orderOf(entry).pallet_no);
      let selected = candidates.filter(({ pallet }) => explicitPallet && pallet.palletNo === explicitPallet);
      if (!selected.length) selected = candidates.filter(({ workpiece }) => workpiece.dual || workpiece.isDefault);
      if (!selected.length && candidates.length === 1) selected = candidates;
      if (!selected.length) { unmatched.push(entry); continue; }
      selected.forEach(({ workpiece }) => workpiece.orders = [...(workpiece.orders || []), entry]);
    }
    return decorate(pallets, unmatched, activeOrder, false);
  }

  function inferredStripModel(orders, palletStates, activeOrder, palletCount = 6) {
    const mapped = mapOrdersToPallets(orders, palletStates, palletCount);
    const pallets = mapped.pallets.map((pallet) => ({
      palletNo: pallet.palletNo,
      configured: pallet.configured,
      workpieces: pallet.partNos.map((partNo) => ({
        id: partNo,
        label: partNo,
        partNos: [partNo],
        orders: pallet.orders.filter((entry) => partNoOf(entry) === partNo),
      })),
    }));
    return decorate(pallets, mapped.unmatched, activeOrder, true);
  }

  function decorate(pallets, unmatched, activeOrder, inferred) {
    const activeKey = orderKey(activeOrder);
    const decorated = pallets.map((pallet) => {
      const workpieces = pallet.workpieces.map((workpiece) => {
        const entries = workpiece.orders || [];
        const done = entries.reduce((sum, entry) => sum + Number(orderOf(entry).done || 0), 0);
        const total = entries.reduce((sum, entry) => sum + Number(orderOf(entry).total || 0), 0);
        const statusEntry = entries.find((entry) => {
          const order = orderOf(entry);
          return Number(order.total) > 0 && Number(order.done) > Number(order.total);
        }) || entries.find((entry) => {
          const order = orderOf(entry);
          return Number(order.total) > 0 && Number(order.done) >= Number(order.total);
        });
        const statusOrder = statusEntry ? orderOf(statusEntry) : null;
        return { ...workpiece, orders: entries, orderCount: entries.length, done, total,
          percent: total > 0 ? (done >= total ? Math.floor((done / total) * 100) : Math.round((done / total) * 100)) : 0,
          isActive: Boolean(activeKey && entries.some((entry) => orderKey(entry) === activeKey)),
          isFull: Boolean(statusOrder), statusOrder,
          isOver: entries.some((entry) => Number(orderOf(entry).total) > 0 && Number(orderOf(entry).done) > Number(orderOf(entry).total)) };
      });
      return { ...pallet, workpieces, hasOrder: workpieces.some((workpiece) => workpiece.orderCount > 0),
        isActive: workpieces.some((workpiece) => workpiece.isActive), isOver: workpieces.some((workpiece) => workpiece.isOver), inferred };
    });
    return { pallets: decorated, unmatched, hasUnmatched: unmatched.length > 0,
      defaultOpen: String(decorated.find((pallet) => pallet.isActive)?.palletNo || "") };
  }

  function stripModel(orders, palletStates, activeOrder, palletCount = 6) {
    return inferredStripModel(orders, palletStates, activeOrder, palletCount);
  }

  return Object.freeze({ mapOrdersToPallets, stripModel, configuredStripModel, inferredStripModel });
}));
