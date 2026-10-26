(function attachMachTileTakeoverCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileTakeoverCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileTakeoverCore() {
  "use strict";

  const DEFAULT_POLICIES = Object.freeze([
    { code: "MACHINE_FAULT", label_zh: "機台故障／維修", label_vi: "Máy hỏng / bảo trì", default_allow: true, note_required: true, sort: 10 },
    { code: "RUSH_ORDER", label_zh: "換做急單", label_vi: "Chuyển sang đơn gấp", default_allow: true, note_required: false, sort: 20 },
    { code: "TOOLING", label_zh: "刀具／治具問題", label_vi: "Vấn đề dao / đồ gá", default_allow: true, note_required: false, sort: 30 },
    { code: "MATERIAL_WAIT", label_zh: "缺料／等料", label_vi: "Thiếu / chờ vật liệu", default_allow: false, note_required: false, sort: 40 },
    { code: "QUALITY_HOLD", label_zh: "品質問題／等檢驗", label_vi: "Vấn đề chất lượng / chờ kiểm tra", default_allow: false, note_required: false, sort: 50 },
    { code: "OTHER", label_zh: "其他", label_vi: "Khác", default_allow: true, note_required: true, sort: 60 },
  ]);

  const text = (value) => String(value == null ? "" : value).trim();
  const machineSet = (machines) => new Set((Array.isArray(machines) ? machines : []).map((v) => text(v).toUpperCase()).filter(Boolean));
  function enabledForMachine(enabled, machines, machineCode) {
    if (enabled !== true) return false;
    const set = machineSet(machines);
    return set.has("*") || set.has(text(machineCode).toUpperCase());
  }
  function idleActionVisible({ enabled, machines, machineCode, availability, hasOrder } = {}) {
    return hasOrder !== true && availability === "ready" && enabledForMachine(enabled, machines, machineCode);
  }
  function normalizePolicies(rows) {
    const valid = (Array.isArray(rows) ? rows : []).filter((row) => row && text(row.code));
    return (valid.length ? valid : DEFAULT_POLICIES).map((row, index) => ({
      code: text(row.code).toUpperCase(), label_zh: text(row.label_zh) || text(row.code),
      label_vi: text(row.label_vi) || text(row.label_zh) || text(row.code), default_allow: row.default_allow === true,
      note_required: row.note_required === true, sort: Number.isFinite(Number(row.sort)) ? Number(row.sort) : index,
    })).sort((a, b) => a.sort - b.sort);
  }
  function initialStopForm(policy) {
    return { good_qty: "", fail_qty: "", reason_code: policy?.code || "", allow_takeover: policy?.default_allow === true,
      allow_takeover_touched: false, fail_reason_code: "", note: "" };
  }
  function validateStop(form, policies) {
    const policy = normalizePolicies(policies).find((row) => row.code === text(form?.reason_code).toUpperCase());
    const integer = (value) => /^\d+$/.test(text(value)) && Number(value) >= 0;
    const errors = {};
    if (!integer(form?.good_qty)) errors.good_qty = "required_nonnegative_integer";
    if (!integer(form?.fail_qty)) errors.fail_qty = "required_nonnegative_integer";
    if (integer(form?.fail_qty) && Number(form.fail_qty) > 0 && !text(form?.fail_reason_code)) errors.fail_reason_code = "required";
    if (!policy) errors.reason_code = "required";
    if (form?.allow_takeover_touched !== true) errors.allow_takeover = "must_confirm";
    if (policy?.note_required && !text(form?.note)) errors.note = "required";
    return { ok: Object.keys(errors).length === 0, errors, policy };
  }
  function stopPayload(form) {
    return { good_qty: Number(form.good_qty), fail_qty: Number(form.fail_qty), reason_code: text(form.reason_code).toUpperCase(),
      fail_reason_code: Number(form.fail_qty) > 0 ? text(form.fail_reason_code) || null : null,
      allow_takeover: form.allow_takeover === true, note: text(form.note) };
  }
  function stopReportPayload({ commandUuid, machineCode, orderNo, indexSn, partNo, manufactureIiId, expectedSimulationId, form } = {}) {
    const stop = stopPayload(form || {});
    return { p_command_uuid: commandUuid, p_machine_code: text(machineCode).toUpperCase(), p_order_no: text(orderNo),
      p_index_sn: Number(indexSn), p_part_no: text(partNo) || null, p_manufacture_ii_id: text(manufactureIiId) || null,
      p_expected_simulation_id: text(expectedSimulationId) || null, p_good_qty: stop.good_qty, p_fail_qty: stop.fail_qty,
      p_fail_reason_code: stop.fail_reason_code, p_stop_reason_code: stop.reason_code,
      p_allow_takeover: stop.allow_takeover, p_stop_note: stop.note || null };
  }
  function takeoverPayload({ commandUuid, machineCode, stopNoteId } = {}) {
    return { p_command_uuid: commandUuid, p_machine_code: text(machineCode).toUpperCase(), p_stop_note_id: text(stopNoteId) };
  }
  // remainingQty must use the whole step's cumulative completion (work_order_processes.qty_completed
  // that the APP already reads), not only this stop note's segment: on a second or later takeover the
  // note only holds the last machine's segment and would overstate what is left. When the cumulative
  // read is missing or lags behind the note (stop report not applied yet), fall back to the larger value.
  function candidateView(row, plannedQty, reasonLabel, processDoneQty) {
    const done = Number(row?.good_qty || 0) + Number(row?.fail_qty || 0);
    const planned = Math.max(0, Number(plannedQty || 0));
    const cumulative = Number(processDoneQty);
    const processDone = Number.isFinite(cumulative) && cumulative > 0 ? cumulative : 0;
    return { stopNoteId: text(row?.id), orderNo: text(row?.order_no), indexSn: row?.index_sn,
      sourceMachine: text(row?.source_machine), stoppedBy: text(row?.stopped_by_name), stoppedAt: row?.stopped_at,
      reasonCode: text(row?.reason_code), reasonLabel: text(reasonLabel) || text(row?.reason_code), note: text(row?.note),
      goodQty: Number(row?.good_qty || 0), failQty: Number(row?.fail_qty || 0), doneQty: done,
      processDoneQty: Math.max(processDone, done), remainingQty: Math.max(0, planned - Math.max(processDone, done)) };
  }
  function candidateMap(rows) {
    return new Map((Array.isArray(rows) ? rows : []).filter((row) => row?.stopNoteId).map((row) => [row.stopNoteId, row]));
  }
  function availabilityAfterProbeError(error) {
    const value = `${text(error?.code)} ${text(error?.message || error)}`.toUpperCase();
    return value.includes("TAKEOVER_DISABLED") ? "off" : "missing";
  }
  function probeMachine(machines, visibleMachineCodes) {
    const configured = [...machineSet(machines)];
    if (!configured.includes("*")) return configured[0] || "";
    return (Array.isArray(visibleMachineCodes) ? visibleMachineCodes : []).map((value) => text(value).toUpperCase()).find(Boolean) || "";
  }
  function rejectText(code) {
    return ({
      TARGET_BUSY: "目標機台忙碌，請稍後再試 / Máy đích đang bận, vui lòng thử lại sau",
      ALREADY_TAKEN: "此工單已被其他機台接手 / Lệnh này đã được máy khác tiếp quản",
      ALREADY_CLAIMED: "此工單已被其他機台接手 / Lệnh này đã được máy khác tiếp quản",
      TAKEOVER_NOT_ALLOWED: "生管已收回接手權限 / Điều độ đã thu hồi quyền tiếp quản",
      TAKEOVER_DISABLED: "工廠未啟用，請用一般停工",
      STATION_CLASS_MISMATCH: "這台與來源機台類型不同，不能接手",
      // vi: _draft
      NOT_ELIGIBLE: "這台機台不能接這筆停工單（不在可接機台名單） / Máy này không thể tiếp nhận lệnh dừng này (không có trong danh sách máy được tiếp nhận)",
    })[text(code).toUpperCase()] || "";
  }
  function resultText(view) {
    if (view?.phase === "applied") return "已接手 / Đã tiếp quản";
    if (view?.phase === "rejected") return rejectText(view.code) || `接手失敗（${text(view.code) || "UNKNOWN"}） / Tiếp quản thất bại`;
    return "";
  }
  function startTabs(enabled) { return enabled ? ["new", "takeover"] : ["new"]; }
  // 選工單／開工分開（owner 2026-10-26）：卡片在哪個階段，只給那個階段該按的按鈕。
  //   pick＝沒掛單（只有「選工單」）／pending＝掛了單還沒開工（只有「開工」）／
  //   running＝已開工（報工、停工、完工）／stopped＝自己停工中（雲端 stop／stop_report applied → status paused；「開工」接回＋「完工」，owner 2026-10-26 21:3x）。
  // 判斷順序：本機剛 applied 的開工／停工（同單同道次）→ process status → machines.status → actual_start_at。
  // 雲端開工 applied 會把 status 改 running、寫 actual_start_at；接手 applied 改回 pending（actual_start_at 保留第一次開工），
  // 所以 status 有值就以 status 為準，只有 status 讀不到才退回看 actual_start_at／machines.status。
  function pickStartPhase({ hasOrder, processStatus, actualStartAt, rawStatus, localRun } = {}) {
    if (hasOrder !== true) return "pick";
    const local = text(localRun).toLowerCase();
    if (local === "stop") return "stopped";
    if (local === "start") return "running";
    const status = text(processStatus).toLowerCase();
    const raw = text(rawStatus).toLowerCase();
    if (status === "paused" || status === "stopped") return "stopped";
    if (status === "pending") return "pending";
    if (raw === "paused" || raw === "stopped") return "stopped";
    if (["running", "abnormal", "waiting_inspection"].includes(status)) return "running";
    return text(actualStartAt) || raw === "running" ? "running" : "pending";
  }
  // 本機剛 applied 的開工／停工跟雲端讀到的 status 矛盾，而且雲端那次讀取是在本機紀錄之後才開始 → 以雲端為準（清掉本機）。
  // status 讀不到（空）不算矛盾。
  function pickStartLocalStale({ localRun, localAt, cloudReadAt, ...input } = {}) {
    if (!text(localRun) || !text(input.processStatus)) return false;
    if (!(Number(cloudReadAt) > 0) || !(Number(cloudReadAt) >= Number(localAt || 0))) return false;
    const cloud = pickStartPhase(input);
    const local = pickStartPhase({ ...input, localRun });
    return cloud !== local;
  }
  function pickStartActions(phase) {
    return ({ pick: ["pick"], pending: ["start"], running: ["report", "stop", "finish"], stopped: ["start", "finish"] })[text(phase)] || [];
  }
  return { DEFAULT_POLICIES, enabledForMachine, idleActionVisible, normalizePolicies, initialStopForm, validateStop, stopPayload,
    stopReportPayload, takeoverPayload, candidateView, candidateMap, availabilityAfterProbeError, probeMachine, rejectText, resultText, startTabs,
    pickStartPhase, pickStartActions, pickStartLocalStale };
});
