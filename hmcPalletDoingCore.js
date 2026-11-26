(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileHmcPalletDoingCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Contract: supabase/migrations/20261126090000_hmc_pallet_doing.sql (hmc_pallet_doing_read / hmc_pallet_doing_set).
  const STATUSES = Object.freeze(["doing", "idle_reason", "doing_no_order"]);
  const REASON_CODES = Object.freeze(["shared_mold_on_other", "waiting_material", "waiting_program", "waiting_inspection", "other"]);
  const normalize = (value) => String(value == null ? "" : value).trim().toUpperCase();
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  // read result -> { machineCode, requirePlannerConfirm, rows: [{ palletNo, workpieceKey, partNo, status, ... }] }
  // Anything that is not the documented shape returns null (caller shows nothing, strip is unaffected).
  function parseRead(result) {
    if (!isObject(result) || !Array.isArray(result.pallets)) return null;
    const rows = [];
    for (const pallet of result.pallets) {
      const palletNo = Number(pallet?.pallet_no);
      if (!Number.isInteger(palletNo) || !Array.isArray(pallet?.workpieces)) continue;
      for (const row of pallet.workpieces) {
        if (!isObject(row)) continue;
        // Unknown status (future server value) is dropped: never guessed into a state.
        if (!STATUSES.includes(row.status)) continue;
        rows.push({
          palletNo,
          workpieceKey: String(row.workpiece_key == null ? "" : row.workpiece_key).trim(),
          partNo: normalize(row.part_no),
          status: row.status,
          reasonCode: row.reason_code || null,
          reasonText: row.reason_text || null,
          moldGroup: row.mold_group_code || null,
        });
      }
    }
    return { machineCode: normalize(result.machine_code), requirePlannerConfirm: result.require_planner_confirm !== false, rows,
      pending_unmerged_count: Number(result.pending_unmerged_count || 0),
      pending_no_order: Array.isArray(result.pending_no_order) ? result.pending_no_order : [] };
  }

  const isActiveStatus = (status) => status === "doing" || status === "doing_no_order";

  function rowFor(rows, palletNo, workpiece) {
    const onPallet = rows.filter((row) => row.palletNo === palletNo);
    const byKey = onPallet.find((row) => row.workpieceKey && row.workpieceKey === String(workpiece.id));
    if (byKey) return byKey;
    const parts = Array.isArray(workpiece.partNos) ? workpiece.partNos.map(normalize) : [];
    return onPallet.find((row) => row.partNo && parts.includes(row.partNo)) || null;
  }

  // doing = null | { state: "doing"|"idle"|"noOrder", status, reasonCode, reasonText, otherPartNo }
  function mergeDoing(model, doingRead) {
    if (!model || !Array.isArray(model.pallets) || !doingRead || !Array.isArray(doingRead.rows)) return model;
    const rows = doingRead.rows;
    const pallets = model.pallets.map((pallet) => {
      const workpieces = pallet.workpieces.map((workpiece) => {
        const row = rowFor(rows, pallet.palletNo, workpiece);
        if (!row) return { ...workpiece, doing: null };
        const state = row.status === "doing" ? "doing" : row.status === "doing_no_order" ? "noOrder" : "idle";
        let otherPartNo = "";
        if (state === "idle" && row.reasonCode === "shared_mold_on_other" && row.moldGroup) {
          otherPartNo = rows.find((other) => other !== row && other.moldGroup === row.moldGroup && isActiveStatus(other.status))?.partNo || "";
        }
        return { ...workpiece, doing: { state, status: row.status, reasonCode: row.reasonCode, reasonText: row.reasonText, otherPartNo } };
      });
      const states = workpieces.map((workpiece) => workpiece.doing?.state);
      const doingState = states.includes("noOrder") ? "noOrder" : states.includes("doing") ? "doing" : "none";
      return { ...pallet, workpieces, doingState };
    });
    return { ...model, pallets };
  }

  function chipClasses(pallet) {
    if (pallet?.doingState === "noOrder") return ["is-doing", "is-doing-no-order"];
    if (pallet?.doingState === "doing") return ["is-doing"];
    return [];
  }

  // Translation key for the chip's second line; "" = keep the existing text.
  function chipTextKey(pallet) {
    if (pallet?.doingState === "noOrder") return "hmc_doing_chip_no_order";
    if (pallet?.doingState === "doing") return "hmc_doing_chip_on";
    return "";
  }

  // { kind: "on"|"idle"|"noorder", key, reasonCode, reasonText, otherPartNo } or null (no pill).
  function pillInfo(doing) {
    if (!doing) return null;
    if (doing.state === "doing") return { kind: "on", key: "hmc_doing_pill_on" };
    if (doing.state === "noOrder") return { kind: "noorder", key: "hmc_doing_pill_no_order" };
    if (doing.state === "idle") {
      return { kind: "idle", key: "hmc_doing_pill_idle", reasonCode: doing.reasonCode, reasonText: doing.reasonText || "", otherPartNo: doing.otherPartNo || "" };
    }
    return null;
  }

  function isDoingActive(doing) { return Boolean(doing) && (doing.state === "doing" || doing.state === "noOrder"); }

  // Which status to send when the operator presses 「在做」: no order on the workpiece -> doing_no_order.
  function startStatus(workpiece) { return Number(workpiece?.orderCount) > 0 ? "doing" : "doing_no_order"; }

  // Part number sent to the server: the part of the first order if there is one, else the first mapped part. upper+trim.
  // Part number sent when there is no choice to make: the first of partNoChoices (same rule as the menu, so the
  // pill / direct send / menu never disagree). Review MEDIUM 11/26: first order outside the map used to fall back
  // to mapped[0] even when a later order matched the map.
  function partNoFor(workpiece) {
    return partNoChoices(workpiece)[0] || "";
  }

  // Distinct part numbers (upper+trim) the operator may mean for this workpiece: parts of its open orders (limited to the
  // mapped parts when there are any), else the mapped parts. 1 -> use directly, >=2 -> ask.
  function partNoChoices(workpiece) {
    const mapped = Array.isArray(workpiece?.partNos) ? workpiece.partNos.map(normalize).filter(Boolean) : [];
    const uniq = (list) => list.filter((part, index) => list.indexOf(part) === index);
    const fromOrders = (workpiece?.orders || []).map((entry) => {
      const o = entry?.order || entry || {};
      return normalize(o.partNo || o.part_no || o.drawing);
    }).filter(Boolean);
    const matched = uniq(mapped.length ? fromOrders.filter((part) => mapped.includes(part)) : fromOrders);
    if (matched.length) return matched;
    return uniq(mapped.length ? mapped : fromOrders);
  }

  // The other part number currently active in the same mold group as `partNo` ("" when unknown).
  function conflictPartNo(rows, partNo) {
    const part = normalize(partNo);
    if (!Array.isArray(rows) || !part) return "";
    const groups = rows.filter((row) => row.partNo === part && row.moldGroup).map((row) => row.moldGroup);
    const other = rows.find((row) => groups.includes(row.moldGroup) && row.partNo && row.partNo !== part && isActiveStatus(row.status));
    return other ? other.partNo : "";
  }

  // Returns { ok:true, payload } or { ok:false, error: "<CODE>" } (client-side pre-check; the server re-validates).
  function buildSetPayload(input) {
    const status = input?.status;
    if (!STATUSES.includes(status)) return { ok: false, error: "INVALID_STATUS" };
    const palletNo = Number(input.palletNo);
    if (!Number.isInteger(palletNo) || palletNo < 1 || palletNo > 99) return { ok: false, error: "INVALID_PALLET_NO" };
    const machine = normalize(input.machineCode);
    if (!machine) return { ok: false, error: "INVALID_MACHINE_CODE" };
    const workpieceKey = String(input.workpieceKey == null ? "" : input.workpieceKey).trim();
    if (!workpieceKey) return { ok: false, error: "INVALID_WORKPIECE_KEY" };
    const partNo = normalize(input.partNo);
    if (isActiveStatus(status) && !partNo) return { ok: false, error: "PART_NO_REQUIRED" };
    const reasonCode = status === "idle_reason" ? String(input.reasonCode || "").trim() : "";
    if (status === "idle_reason" && !REASON_CODES.includes(reasonCode)) return { ok: false, error: "INVALID_REASON_CODE" };
    const reasonText = reasonCode ? String(input.reasonText || "").trim() : "";
    if (reasonCode === "other" && !reasonText) return { ok: false, error: "REASON_TEXT_REQUIRED" };
    if (reasonText.length > 200) return { ok: false, error: "INVALID_REASON_TEXT" };
    const commandUuid = String(input.commandUuid || "").trim();
    if (!commandUuid) return { ok: false, error: "INVALID_COMMAND_UUID" };
    return { ok: true, payload: {
      machine_code: machine,
      pallet_no: palletNo,
      workpiece_key: workpieceKey,
      part_no: partNo || null,
      status,
      reason_code: reasonCode || null,
      reason_text: reasonText || null,
      switch_mold: input.switchMold === true,
      command_uuid: commandUuid,
    } };
  }

  // Same content keeps the same command_uuid until it succeeds (retry after failure = same uuid, server replays).
  function createCommandStore(generate) {
    const pending = new Map();
    const signature = (content) => JSON.stringify([normalize(content.machineCode), Number(content.palletNo), String(content.workpieceKey || "").trim(),
      normalize(content.partNo), content.status, content.reasonCode || "", content.reasonText || "", content.switchMold === true]);
    return {
      uuidFor(content) {
        const key = signature(content);
        if (!pending.has(key)) pending.set(key, generate());
        return pending.get(key);
      },
      done(content) { pending.delete(signature(content)); },
      size() { return pending.size; },
    };
  }

  const ERROR_KEYS = Object.freeze({
    SHARED_MOLD_BUSY: "hmc_doing_err_shared_mold",
    MACHINE_NOT_ALLOWED: "hmc_doing_err_machine",
    BRIDGE_NOT_ALLOWED: "hmc_doing_err_bridge",
    ACCOUNT_DISABLED: "hmc_doing_err_disabled",
    ROLE_NOT_ALLOWED: "hmc_doing_err_role",
    AUTH_REQUIRED: "hmc_doing_err_auth",
    COMMAND_UUID_CONFLICT: "hmc_doing_err_conflict",
    REASON_TEXT_REQUIRED: "hmc_doing_err_reason_text",
    INVALID_REASON_CODE: "hmc_doing_err_reason",
    PART_NO_REQUIRED: "hmc_doing_err_part",
  });

  const OFFLINE_PATTERN = /failed to fetch|networkerror|network request failed|load failed|err_internet|err_network|aborterror|timeout|timed out/i;

  // error -> "offline" | i18n key. Network-level failures are never reported as server errors.
  function errorKey(error, onLine) {
    if (onLine === false) return "hmc_doing_err_offline";
    const text = String(error?.message || error || "");
    const found = Object.keys(ERROR_KEYS).find((code) => text.includes(code));
    if (found) return ERROR_KEYS[found];
    if (error?.name === "TypeError" || error?.name === "AbortError" || error?.name === "TimeoutError" || OFFLINE_PATTERN.test(text)) return "hmc_doing_err_offline";
    return "hmc_doing_err_generic";
  }

  return Object.freeze({ STATUSES, REASON_CODES, parseRead, mergeDoing, chipClasses, chipTextKey, pillInfo, isDoingActive,
    startStatus, partNoFor, partNoChoices, conflictPartNo, buildSetPayload, createCommandStore, errorKey });
}));
