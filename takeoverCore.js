(function attachMachTileTakeoverCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileTakeoverCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileTakeoverCore() {
  "use strict";

  const DEFAULT_POLICIES = Object.freeze([
    { code: "MACHINE_FAULT", label_zh: "機台故障", label_vi: "Máy bị sự cố", default_allow: true, note_required: false, sort: 10 },
    { code: "RUSH_ORDER", label_zh: "插急單", label_vi: "Chen đơn gấp", default_allow: true, note_required: false, sort: 20 },
    { code: "TOOLING", label_zh: "刀具／治具問題", label_vi: "Vấn đề dao／đồ gá", default_allow: true, note_required: false, sort: 30 },
    { code: "MATERIAL_WAIT", label_zh: "待料", label_vi: "Chờ vật liệu", default_allow: false, note_required: false, sort: 40 },
    { code: "QUALITY_HOLD", label_zh: "品質確認中", label_vi: "Đang xác nhận chất lượng", default_allow: false, note_required: false, sort: 50 },
    { code: "OTHER", label_zh: "其他", label_vi: "Khác", default_allow: true, note_required: true, sort: 60 },
  ]);

  const text = (value) => String(value == null ? "" : value).trim();
  const machineSet = (machines) => new Set((Array.isArray(machines) ? machines : []).map((v) => text(v).toUpperCase()).filter(Boolean));
  function enabledForMachine(enabled, machines, machineCode) {
    if (enabled !== true) return false;
    const set = machineSet(machines);
    return set.has("*") || set.has(text(machineCode).toUpperCase());
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
      allow_takeover_touched: false, note: "" };
  }
  function validateStop(form, policies) {
    const policy = normalizePolicies(policies).find((row) => row.code === text(form?.reason_code).toUpperCase());
    const integer = (value) => /^\d+$/.test(text(value)) && Number(value) >= 0;
    const errors = {};
    if (!integer(form?.good_qty)) errors.good_qty = "required_nonnegative_integer";
    if (!integer(form?.fail_qty)) errors.fail_qty = "required_nonnegative_integer";
    if (!policy) errors.reason_code = "required";
    if (form?.allow_takeover_touched !== true) errors.allow_takeover = "must_confirm";
    if (policy?.note_required && !text(form?.note)) errors.note = "required";
    return { ok: Object.keys(errors).length === 0, errors, policy };
  }
  function stopPayload(form) {
    return { good_qty: Number(form.good_qty), fail_qty: Number(form.fail_qty), reason_code: text(form.reason_code).toUpperCase(),
      allow_takeover: form.allow_takeover === true, note: text(form.note) };
  }
  function startTabs(enabled) { return enabled ? ["new", "takeover"] : ["new"]; }
  function takeoverConfirmation(candidate, machineCode) {
    const source = text(candidate?.source_machine), target = text(machineCode), order = text(candidate?.order_no);
    const step = candidate?.index_sn ?? "—", done = Number(candidate?.good_qty || 0) + Number(candidate?.fail_qty || 0);
    const remaining = Math.max(0, Number(candidate?.remaining_qty || 0));
    return `從 ${source} 接手 ${order} 第 ${step} 道：${source} 已做 ${done}，${target} 接手剩 ${remaining}`;
  }
  return { DEFAULT_POLICIES, enabledForMachine, normalizePolicies, initialStopForm, validateStop, stopPayload, startTabs, takeoverConfirmation };
});
