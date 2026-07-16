(function initMachTileHmcRuntimeCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MachTileHmcRuntimeCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createHmcRuntimeCore() {
  "use strict";

  const MACHINE_CODES = ["B01", "B02"];
  const PALLET_STATES = {
    empty: { label: "未設定", tone: "idle" },
    waiting: { label: "外部等待", tone: "waiting" },
    external_preparing: { label: "外部準備", tone: "preparing" },
    ready: { label: "備盤完成", tone: "ready" },
    spindle: { label: "主軸加工中", tone: "spindle" },
    blocked: { label: "盤位受阻", tone: "blocked" },
    material_missing: { label: "缺料", tone: "blocked" },
  };
  const EVENT_TYPES = [
    "pallet_waiting",
    "pallet_prep_start",
    "pallet_ready",
    "pallet_spindle_start",
    "pallet_spindle_complete",
    "material_missing",
    "material_ready",
    "machine_stop",
    "machine_resume",
  ];
  const EVENT_META = {
    pallet_waiting: { label: "移至外部等待", scope: "pallet" },
    pallet_prep_start: { label: "開始外部備盤", scope: "pallet" },
    pallet_ready: { label: "備盤完成", scope: "pallet" },
    pallet_spindle_start: { label: "進入主軸加工", scope: "pallet" },
    pallet_spindle_complete: { label: "主軸加工完成", scope: "pallet" },
    material_missing: { label: "回報缺料", scope: "pallet", reasonRequired: true, risk: true },
    material_ready: { label: "補料完成", scope: "pallet" },
    machine_stop: { label: "機台臨時停機", scope: "machine", reasonRequired: true, risk: true },
    machine_resume: { label: "機台恢復運轉", scope: "machine" },
  };
  const PALLET_EVENTS = new Set(EVENT_TYPES.filter((type) => !type.startsWith("machine_")));
  const REPLAN_EVENTS = new Set(["material_missing", "material_ready", "machine_stop", "machine_resume"]);

  function normalizeMachineCode(value) {
    return String(value || "").trim().toUpperCase();
  }

  function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  function machineProfile(code, profiles) {
    const normalized = normalizeMachineCode(code);
    const source = profiles && typeof profiles === "object" ? profiles[normalized] : null;
    return {
      machineCode: normalized,
      palletCount: positiveInteger(source?.palletCount ?? source?.pallet_count, 6),
      spindleCapacity: 1,
      externalPrepAllowed: source?.externalPrepAllowed ?? source?.external_prep_allowed ?? true,
    };
  }

  function normalizePallet(raw, palletNo) {
    const state = PALLET_STATES[raw?.state] ? raw.state : "empty";
    return {
      palletNo,
      palletId: raw?.pallet_id || raw?.palletId || "",
      state,
      stateLabel: PALLET_STATES[state].label,
      tone: PALLET_STATES[state].tone,
      materialStatus: raw?.material_status || raw?.materialStatus || (state === "material_missing" ? "missing" : "unknown"),
      fixtureName: raw?.fixture_name || raw?.fixtureName || "",
      workOrderNo: raw?.work_order_no || raw?.workOrderNo || "",
      processId: raw?.process_id || raw?.processId || "",
      observedAt: raw?.observed_at || raw?.observedAt || "",
    };
  }

  function normalizeMachine(raw, profiles) {
    const machineCode = normalizeMachineCode(raw?.machine_code || raw?.machineCode);
    const profile = machineProfile(machineCode, profiles);
    const byNo = new Map();
    (Array.isArray(raw?.pallets) ? raw.pallets : []).forEach((pallet) => {
      const palletNo = positiveInteger(pallet?.pallet_no ?? pallet?.palletNo, 0);
      if (palletNo >= 1 && palletNo <= profile.palletCount && !byNo.has(palletNo)) byNo.set(palletNo, pallet);
    });
    const pallets = Array.from({ length: profile.palletCount }, (_, index) => normalizePallet(byNo.get(index + 1), index + 1));
    const spindlePallets = pallets.filter((pallet) => pallet.state === "spindle");
    const anomalies = [];
    spindlePallets.slice(1).forEach((pallet) => {
      pallet.state = "waiting";
      pallet.stateLabel = PALLET_STATES.waiting.label;
      pallet.tone = PALLET_STATES.waiting.tone;
      anomalies.push(`第 ${pallet.palletNo} 盤被降為外部等待：同一主軸不可同時加工多盤`);
    });
    const activeIncidents = Array.isArray(raw?.active_incidents) ? raw.active_incidents : Array.isArray(raw?.activeIncidents) ? raw.activeIncidents : [];
    const stopped = activeIncidents.some((incident) => incident.incident_type === "machine_stop" || incident.incidentType === "machine_stop");
    const spindle = pallets.find((pallet) => pallet.state === "spindle") || null;
    const missingCount = pallets.filter((pallet) => pallet.state === "material_missing" || pallet.materialStatus === "missing").length;
    return {
      ...profile,
      machineId: raw?.machine_id || raw?.machineId || "",
      status: stopped ? "stopped" : spindle ? "running" : "idle",
      spindlePalletNo: spindle?.palletNo || null,
      missingCount,
      pendingReplanCount: Number(raw?.pending_replan_count ?? raw?.pendingReplanCount ?? 0),
      replanRevision: raw?.replan_revision || raw?.replanRevision || "",
      activeIncidents,
      pallets,
      anomalies,
    };
  }

  function normalizeSnapshot(snapshot, profiles) {
    const rows = Array.isArray(snapshot?.machines) ? snapshot.machines : [];
    const byCode = new Map(rows.map((row) => [normalizeMachineCode(row?.machine_code || row?.machineCode), row]));
    const machineCodes = [...new Set([...MACHINE_CODES, ...byCode.keys()].filter(Boolean))];
    return {
      machines: machineCodes.map((code) => normalizeMachine(byCode.get(code) || { machine_code: code }, profiles)),
      generatedAt: snapshot?.generated_at || snapshot?.generatedAt || "",
    };
  }

  function validateEvent(input, profiles) {
    const event = input && typeof input === "object" ? input : {};
    const machineCode = normalizeMachineCode(event.machine_code || event.machineCode);
    const eventType = String(event.event_type || event.eventType || "").trim();
    const sourceEventId = String(event.source_event_id || event.sourceEventId || "").trim();
    if (!MACHINE_CODES.includes(machineCode)) return { ok: false, error: "INVALID_HMC_MACHINE" };
    if (!EVENT_TYPES.includes(eventType)) return { ok: false, error: "INVALID_HMC_EVENT_TYPE" };
    if (!sourceEventId) return { ok: false, error: "SOURCE_EVENT_ID_REQUIRED" };
    let palletNo = null;
    if (PALLET_EVENTS.has(eventType)) {
      palletNo = positiveInteger(event.pallet_no ?? event.palletNo, 0);
      const profile = machineProfile(machineCode, profiles);
      if (palletNo < 1 || palletNo > profile.palletCount) return { ok: false, error: "INVALID_PALLET_NO" };
    }
    if (["material_missing", "machine_stop"].includes(eventType) && String(event.reason || "").trim().length < 2) {
      return { ok: false, error: "REASON_REQUIRED" };
    }
    return {
      ok: true,
      value: { ...event, machineCode, eventType, sourceEventId, palletNo, replanRequired: REPLAN_EVENTS.has(eventType) },
    };
  }

  function eventOptions(scope) {
    return EVENT_TYPES
      .filter((eventType) => EVENT_META[eventType]?.scope === scope)
      .map((eventType) => ({ eventType, ...EVENT_META[eventType] }));
  }

  function defaultPalletEvent(state) {
    return {
      empty: "pallet_prep_start",
      waiting: "pallet_prep_start",
      external_preparing: "pallet_ready",
      ready: "pallet_spindle_start",
      spindle: "pallet_spindle_complete",
      blocked: "pallet_waiting",
      material_missing: "material_ready",
    }[state] || "pallet_waiting";
  }

  function buildEventPayload(input, profiles) {
    const event = input && typeof input === "object" ? input : {};
    const validation = validateEvent(event, profiles);
    if (!validation.ok) return validation;
    const value = validation.value;
    const payload = {
      machine_code: value.machineCode,
      event_type: value.eventType,
      source_system: String(event.source_system || event.sourceSystem || "machtile_ui").trim() || "machtile_ui",
      source_event_id: value.sourceEventId,
      occurred_at: event.occurred_at || event.occurredAt || new Date().toISOString(),
    };
    if (value.palletNo !== null) payload.pallet_no = value.palletNo;
    const reason = String(event.reason || "").trim();
    if (reason) payload.reason = reason;
    ["process_id", "worklist_id", "worklist_item_id", "pallet_id", "fixture_name", "work_order_no"].forEach((key) => {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      const fieldValue = event[key] ?? event[camelKey];
      if (fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim()) payload[key] = fieldValue;
    });
    return { ok: true, value: payload, replanRequired: value.replanRequired };
  }

  function replanReason(eventType) {
    return {
      material_missing: "缺料：移出可排程並重新計算交期",
      material_ready: "補料完成：恢復可排程並重新計算",
      machine_stop: "機台臨時停機：凍結主軸容量並重排",
      machine_resume: "機台恢復：釋放主軸容量並重排",
    }[eventType] || "";
  }

  return {
    EVENT_TYPES,
    EVENT_META,
    MACHINE_CODES,
    PALLET_STATES,
    machineProfile,
    buildEventPayload,
    defaultPalletEvent,
    eventOptions,
    normalizeMachineCode,
    normalizeSnapshot,
    replanReason,
    validateEvent,
  };
}));
