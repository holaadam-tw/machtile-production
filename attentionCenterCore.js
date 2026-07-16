(function attachMachTileAttentionCenterCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileAttentionCenterCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileAttentionCenterCore() {
  "use strict";

  const workflowMeta = Object.freeze({
    unassigned: { label: "未指派", className: "attention-unassigned" },
    in_progress: { label: "處理中", className: "attention-progress" },
    waiting: { label: "等待回覆", className: "attention-waiting" },
    closed: { label: "已結案", className: "attention-closed" },
  });

  const workflowFilters = Object.freeze(["待處理", "未指派", "處理中", "等待回覆", "已結案"]);

  function normalizedText(value) {
    return String(value ?? "").trim();
  }

  function workflowStatus(value) {
    return Object.hasOwn(workflowMeta, value) ? value : "unassigned";
  }

  function sourceKey(order, riskStatus) {
    const workOrderKey = normalizedText(order?.workOrderId || order?.id || "unknown");
    const dueDate = normalizedText(order?.dueDate || "no-date");
    return `work_order:${workOrderKey}:${normalizedText(riskStatus || "risk")}:${dueDate}`;
  }

  function mergeCase(order, riskStatus, persisted) {
    const status = workflowStatus(persisted?.status);
    return {
      sourceKey: sourceKey(order, riskStatus),
      status,
      statusLabel: workflowMeta[status].label,
      statusClassName: workflowMeta[status].className,
      caseId: normalizedText(persisted?.id),
      assignedTo: normalizedText(persisted?.assigned_to),
      assigneeName: normalizedText(persisted?.assignee_name) || "尚未指派",
      resolutionReason: normalizedText(persisted?.resolution_reason),
      updatedAt: normalizedText(persisted?.updated_at),
      persisted: Boolean(persisted?.id),
    };
  }

  function matchesWorkflow(caseState, filter) {
    const status = workflowStatus(caseState?.status);
    if (filter === "待處理") return status !== "closed";
    if (filter === "未指派") return status === "unassigned";
    if (filter === "處理中") return status === "in_progress";
    if (filter === "等待回覆") return status === "waiting";
    if (filter === "已結案") return status === "closed";
    return status !== "closed";
  }

  function validateMutation(input) {
    const status = workflowStatus(input?.status);
    const reason = normalizedText(input?.reason);
    const assignedTo = normalizedText(input?.assignedTo);
    const itemCount = Number(input?.itemCount || 0);
    const errors = [];
    if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > 100) errors.push("請選擇 1–100 筆待處理項目");
    if (reason.length < 2) errors.push("修改原因至少需要 2 個字");
    if (["in_progress", "waiting"].includes(status) && !assignedTo) errors.push("處理中或等待回覆必須指定負責人");
    return { valid: errors.length === 0, errors, status, reason, assignedTo };
  }

  return {
    workflowMeta,
    workflowFilters,
    workflowStatus,
    sourceKey,
    mergeCase,
    matchesWorkflow,
    validateMutation,
  };
});
