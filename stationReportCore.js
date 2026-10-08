// Stage-2 station report command contract (stage2-report/03).
// This module only builds/verifies the APP boundary. It never writes directly
// to production_reports and never treats a preview as an applied report.
(function attachMachTileStationReportCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileStationReportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileStationReportCore() {
  "use strict";

  const FAIL_REASON_DEFAULTS = Object.freeze(["尺寸不良", "外觀", "刀具崩", "試刀", "材料不良", "其他"]);
  const ALLOWED_ACKS = Object.freeze([
    "PREV_OUTSOURCE_UNCONFIRMED", "AUTO_PULL_ACK", "OLD_ORDER_NEWER_OPEN",
    "HIGH_FAIL_RATIO", "FAIL_ONLY", "EXCEEDS_ORDER_QTY", "DUPLICATE_SUSPECTED",
    "GUARD_STATE_CHANGED",
  ]);
  const HARD_REJECTS = Object.freeze([
    "QTY_EXCEEDS_AVAILABLE", "AUTO_PULL_WOULD_GO_NEGATIVE", "REPORT_NOTE_REQUIRED",
    "INVALID_REPORT_QTY", "FAIL_REASON_REQUIRED", "INVALID_FAIL_REASON", "INVALID_ACK",
    "INVALID_GUARD_SNAPSHOT", "REPORT_DISABLED", "STATION_NOT_STARTED", "ITEM_CLOSED",
    "LEGACY_STATE_INCONSISTENT", "REPORT_ENGINE_FAILED", "TX_PROMOTION_BLOCKED", "LEDGER_CONFLICT",
    "STALE_COMMAND", "ORDER_MISMATCH", "PART_NO_MISMATCH", "INVALID_FINISH_STATUS",
  ]);
  const SOFT_REJECTS = Object.freeze([
    "PREV_OUTSOURCE_UNCONFIRMED", "AUTO_PULL_ACK", "OLD_ORDER_NEWER_OPEN", "HIGH_FAIL_RATIO",
    "FAIL_ONLY", "EXCEEDS_ORDER_QTY", "DUPLICATE_SUSPECTED", "GUARD_STATE_CHANGED",
  ]);
  const REPORT_SELECT = "command_uuid,command_type,status,good_qty,fail_qty,preview_result,reject_code,reject_message,legacy_snapshot,requested_at";
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  class ContractError extends Error {
    constructor(code, message) { super(message); this.name = "StationReportContractError"; this.code = code; }
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function jsonBytes(value) {
    const json = JSON.stringify(value);
    if (typeof TextEncoder === "function") return new TextEncoder().encode(json).length;
    return unescape(encodeURIComponent(json)).length;
  }

  function reportMachineEnabled(reportEnabledMachines, machineCode) {
    if (!isPlainObject(reportEnabledMachines)) return false;
    const code = String(machineCode || "").trim().toUpperCase();
    return Boolean(code && reportEnabledMachines[code] === true);
  }

  function isGuardConfig(value, machineCode) {
    const code = String(machineCode || "").trim().toUpperCase();
    return isPlainObject(value) && value.factory_synced === true && String(value.machine_code || "").trim() === code &&
      isPlainObject(value.report_enabled_machines) && typeof value.report_enabled === "boolean" &&
      value.report_enabled === (value.report_enabled_machines[code] === true) &&
      Array.isArray(value.fail_reason_codes) && value.fail_reason_codes.length > 0 &&
      value.fail_reason_codes.every((reason) => typeof reason === "string" && reason.trim().length > 0);
  }

  function legacyIdentityFromProjection(row) {
    if (!isPlainObject(row) || !Number.isInteger(row.legacy_index_sn) || row.legacy_index_sn < 1 ||
        (row.manufacture_ii_id != null && (typeof row.manufacture_ii_id !== "string" || !row.manufacture_ii_id.trim() || row.manufacture_ii_id.length > 100)) ||
        typeof row.simulation_id !== "string" || !row.simulation_id.trim() || row.simulation_id.length > 20) {
      throw new ContractError("REPORT_CONTEXT_REQUIRED", "舊 MES IndexSN、ManufactureII Id 或 SimulationId 不完整；已阻擋送出。");
    }
    return {
      expectedIndexSn: row.legacy_index_sn,
      manufactureIiId: row.manufacture_ii_id == null ? null : row.manufacture_ii_id.trim(),
      expectedSimulationId: row.simulation_id.trim(),
    };
  }

  function validateReportInput(input, failReasonCodes = FAIL_REASON_DEFAULTS) {
    const x = input || {};
    const good = Number(x.goodQty);
    const fail = Number(x.failQty);
    if (!Number.isInteger(good) || !Number.isInteger(fail) || good < 0 || fail < 0 || good > 100000 || fail > 100000 || good + fail < 1) {
      throw new ContractError("INVALID_REPORT_QTY", "良品與不良品須為 0–100000 件，合計至少 1 件。");
    }
    const reasons = Array.isArray(failReasonCodes) ? failReasonCodes.filter((v) => typeof v === "string") : [];
    if (fail > 0 && (!x.failReasonCode || !reasons.includes(x.failReasonCode))) {
      throw new ContractError(x.failReasonCode ? "INVALID_FAIL_REASON" : "FAIL_REASON_REQUIRED", "請選擇有效的不良原因。");
    }
    if (fail === 0 && x.failReasonCode) throw new ContractError("INVALID_FAIL_REASON", "沒有不良品時不可帶不良原因。");
    const note = String(x.reportNote || "");
    if (note.length > 500) throw new ContractError("INVALID_REPORT_NOTE", "備註不可超過 500 字。");
    const acks = Array.isArray(x.acks) ? [...new Set(x.acks)] : [];
    if (acks.some((ack) => !ALLOWED_ACKS.includes(ack))) throw new ContractError("INVALID_ACK", "確認項目無效，請重新預覽。");
    if (acks.includes("OLD_ORDER_NEWER_OPEN") && !note.trim()) throw new ContractError("REPORT_NOTE_REQUIRED", "報在舊工單須填原因。");
    const snapshot = x.clientGuardSnapshot ?? null;
    if (snapshot !== null && (!isPlainObject(snapshot) || jsonBytes(snapshot) > 16 * 1024)) {
      throw new ContractError("INVALID_GUARD_SNAPSHOT", "報工預覽資料無效，請重新預覽。");
    }
    return { goodQty: good, failQty: fail, failReasonCode: fail > 0 ? x.failReasonCode : null, reportNote: note || null, acks, clientGuardSnapshot: snapshot };
  }

  function buildSubmitArgs(input, commandUuid, preview = false, failReasonCodes = FAIL_REASON_DEFAULTS) {
    const x = input || {};
    if (!UUID_RE.test(String(commandUuid || ""))) throw new ContractError("COMMAND_UUID_REQUIRED", "報工識別碼無效，請重新操作。");
    const machine = String(x.machineCode || "").trim().toUpperCase();
    const order = String(x.expectedOrderNo || "").trim();
    const part = x.expectedPartNo == null ? null : String(x.expectedPartNo).trim() || null;
    const mii = x.manufactureIiId == null ? null : String(x.manufactureIiId).trim() || null;
    const simulation = x.expectedSimulationId == null ? null : String(x.expectedSimulationId).trim() || null;
    const index = Number(x.expectedIndexSn);
    if (!machine || machine.length > 30 || !order || order.length > 100 || !Number.isInteger(index) || index < 1 ||
        (mii && mii.length > 100) || !simulation || simulation.length > 20 ||
        !part || part.length > 200) {
      throw new ContractError("REPORT_CONTEXT_REQUIRED", "工單、工序或機台資料不完整，無法送出智慧報工。");
    }
    const form = validateReportInput(x, failReasonCodes);
    return {
      p_command_uuid: commandUuid,
      p_preview: preview === true,
      p_machine_code: machine,
      p_expected_order_no: order,
      p_expected_index_sn: index,
      p_expected_part_no: part,
      p_manufacture_ii_id: mii,
      p_expected_simulation_id: simulation,
      p_good_qty: form.goodQty,
      p_fail_qty: form.failQty,
      p_fail_reason_code: form.failReasonCode,
      p_report_note: form.reportNote,
      p_acks: form.acks.length ? form.acks : null,
      p_client_guard_snapshot: form.clientGuardSnapshot,
    };
  }

  function commandReadPath(commandUuid) {
    if (!UUID_RE.test(String(commandUuid || ""))) throw new ContractError("COMMAND_UUID_REQUIRED", "報工識別碼無效。");
    return `station_commands?select=${REPORT_SELECT}&command_uuid=eq.${encodeURIComponent(commandUuid)}&limit=1`;
  }

  function buildClientGuardSnapshot(previewCommand) {
    const id = previewCommand?.command_uuid;
    const result = previewCommand?.preview_result;
    const legacy = result?.legacy_snapshot;
    const report = legacy?.report;
    const guard = report?.guard;
    const details = guard?.Details;
    const valueFields = ["available", "supply", "done_c", "prev_index_sn", "prev_kind", "predicted_ac03_qty", "order_qty", "order_start", "shown_at"];
    if (previewCommand?.command_type !== "report_preview" || previewCommand?.status !== "previewed" ||
        !UUID_RE.test(String(id || "")) || !isPlainObject(result) || result.status !== "previewed" ||
        typeof result.allowed !== "boolean" || typeof result.hard !== "boolean" || !isPlainObject(legacy) || !isPlainObject(report) ||
        !isPlainObject(guard) || !isPlainObject(details) || !Number.isInteger(result.available)) {
      throw new ContractError("PREVIEW_RESULT_INCOMPLETE", "預覽回傳的 guard 欄位不完整；已阻擋確認送出。");
    }
    if (result.allowed !== (guard.code === "" || guard.code == null) ||
        (typeof guard.hard === "boolean" && guard.hard !== result.hard)) {
      throw new ContractError("PREVIEW_RESULT_INCOMPLETE", "預覽 guard 判定不一致；已阻擋確認送出。");
    }
    const guardCode = result.guard_code || guard.code || "";
    if (!result.allowed && (result.hard || !SOFT_REJECTS.includes(guardCode))) {
      throw new ContractError(result.guard_code || guard.code || "PREVIEW_NOT_ALLOWED",
        result.message || guard.message || "舊 MES guard 未允許此筆報工；已阻擋確認送出。");
    }
    for (const key of valueFields) {
      const value = result[key];
      if (key === "available" && !Number.isInteger(value)) throw new ContractError("PREVIEW_RESULT_INCOMPLETE", "預覽缺少可報數量；已阻擋確認送出。");
      if (value != null && (key === "prev_kind" || key === "order_start" || key === "shown_at") && typeof value !== "string") {
        throw new ContractError("PREVIEW_RESULT_INCOMPLETE", `預覽 ${key} 格式不正確；已阻擋確認送出。`);
      }
      if (value != null && !["prev_kind", "order_start", "shown_at"].includes(key) && !Number.isInteger(value)) {
        throw new ContractError("PREVIEW_RESULT_INCOMPLETE", `預覽 ${key} 格式不正確；已阻擋確認送出。`);
      }
      if (Object.prototype.hasOwnProperty.call(details, key) && details[key] !== value) {
        throw new ContractError("PREVIEW_RESULT_MISMATCH", `預覽 ${key} 與舊 MES guard 明細不一致；已阻擋送出。`);
      }
    }
    if (!result.allowed && guardCode !== (guard.code || "")) throw new ContractError("PREVIEW_RESULT_MISMATCH", "預覽 guard code 不一致；已阻擋送出。");
    return {
      source: "preview",
      preview_command_uuid: id,
      ...Object.fromEntries(valueFields.filter((key) => result[key] != null).map((key) => [key, result[key]])),
      shown_at: result.shown_at || new Date().toISOString(),
    };
  }

  function isTerminal(row) {
    if (!row || row.command_type === "report_preview") return row?.status === "previewed" || row?.status === "rejected" || row?.status === "expired";
    return row.status === "applied" || row.status === "rejected" || row.status === "expired";
  }

  function resultCard(row) {
    if (!row || typeof row !== "object") return { kind: "blocked", title: "讀取報工結果失敗", message: "請重新整理確認狀態；先不要重送。" };
    if (row.command_type === "report_preview") {
      if (row.status === "previewed") {
        const result = row.preview_result;
        const guard = result?.legacy_snapshot?.report?.guard;
        if (!isPlainObject(result) || typeof result.allowed !== "boolean") {
          return { kind: "preview-invalid", title: "預覽資料不完整", message: "缺少舊 MES guard verdict；已阻擋正式送出。" };
        }
        const code = result.guard_code || guard?.code || "";
        const isPreviewSoft = result.allowed === false && result.hard === false && SOFT_REJECTS.includes(code);
        const verdict = result.allowed ? "舊 MES guard 允許目前數量繼續；尚未寫入舊 MES。" : "舊 MES guard 未允許目前數量；尚未寫入舊 MES。";
        return {
          kind: result.allowed ? "previewed" : isPreviewSoft ? "preview-soft" : "preview-blocked",
          title: result.allowed ? "預覽完成・尚未報工" : isPreviewSoft ? "預覽需要明確確認" : "預覽遭 guard 阻擋",
          message: [result.message || guard?.message, verdict].filter(Boolean).join(" "),
          guardCode: code,
          allowed: result.allowed,
          values: result,
          preview: result,
        };
      }
      if (row.status === "rejected") return { kind: "hard", title: "預覽未通過", message: row.reject_message || row.reject_code || "預覽遭拒。", code: row.reject_code || "" };
      if (row.status === "expired") return { kind: "hard", title: "預覽已過期", message: "請重新預覽後再送。", code: "EXPIRED" };
      return { kind: "pending", title: "正在預覽", message: "等待套用端計算；舊 MES 尚未寫入。" };
    }
    if (row.status === "applied") return { kind: "applied", title: "報工完成", message: `已報工 ${Number(row.good_qty || 0)} 件（舊 MES 已更新）`, snapshot: row.legacy_snapshot || null };
    if (row.status === "rejected" && SOFT_REJECTS.includes(row.reject_code)) return { kind: "soft", title: "需要再次確認", message: row.reject_message || "此筆報工遇到軟性提醒。", code: row.reject_code, snapshot: row.legacy_snapshot || null };
    if (row.status === "rejected" && row.reject_code === "LEGACY_APPLIED_LATE") return { kind: "applied-late", title: "舊 MES 已記錄，請勿重送", message: "舊 MES 已記這筆報工（回報太晚），不要再按；請到電子紙或 Factory 確認。", snapshot: row.legacy_snapshot || null };
    if (row.status === "rejected") return { kind: HARD_REJECTS.includes(row.reject_code) ? "hard" : "rejected", title: "報工未送入舊 MES", message: row.reject_message || row.reject_code || "請聯絡管理員。", code: row.reject_code || "" };
    if (row.status === "expired") return { kind: "hard", title: "報工已過期，未套用", message: "這筆未寫入舊 MES。請重新確認現況後再送。", code: "EXPIRED" };
    return { kind: "pending", title: "等待套用端處理", message: "結果尚未確認；請勿重複建立報工。" };
  }

  function retryWithAck(previousArgs, ack, nextCommandUuid) {
    if (!UUID_RE.test(String(nextCommandUuid || "")) || nextCommandUuid === previousArgs?.p_command_uuid) {
      throw new ContractError("COMMAND_UUID_REQUIRED", "再次確認必須使用新的報工識別碼。");
    }
    if (!SOFT_REJECTS.includes(ack)) throw new ContractError("INVALID_ACK", "此項目不能以再次確認略過。");
    const acks = [...new Set([...(previousArgs.p_acks || []), ack])];
    return { ...previousArgs, p_command_uuid: nextCommandUuid, p_preview: false, p_acks: acks };
  }

  function retryPreviewWithAck(previousArgs, previewCommand, ack, nextCommandUuid) {
    const result = previewCommand?.preview_result;
    if (!isPlainObject(result) || result.allowed !== false || result.hard !== false ||
        (result.guard_code || result.legacy_snapshot?.report?.guard?.code) !== ack || !SOFT_REJECTS.includes(ack)) {
      throw new ContractError("INVALID_ACK", "只有預覽明確指出的軟性 guard 才能由使用者確認略過。");
    }
    const snapshot = buildClientGuardSnapshot(previewCommand);
    const retry = retryWithAck({ ...previousArgs, p_client_guard_snapshot: snapshot }, ack, nextCommandUuid);
    return retry;
  }

  function createClient({ request, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    if (typeof request !== "function") throw new TypeError("request callback required");
    return {
      async submit(args) {
        try {
          return await request("rpc/machtile_submit_station_report", { method: "POST", body: JSON.stringify(args) });
        } catch (error) {
          const message = String(error?.message || error);
          if (/404|PGRST202|function .* not found|schema cache/i.test(message)) {
            throw new ContractError("STATION_REPORT_BACKEND_UNAVAILABLE", "智慧報工後端尚未同步；未建立報工，請稍後再試。 ");
          }
          throw error;
        }
      },
      async getGuardConfig(machineCode) {
        const code = String(machineCode || "").trim().toUpperCase();
        if (!code || code.length > 30) throw new ContractError("INVALID_MACHINE_CODE", "機台代碼無效。");
        return request("rpc/machtile_get_station_report_guard_config", {
          method: "POST",
          body: JSON.stringify({ p_machine_code: code }),
        });
      },
      async read(commandUuid) {
        const rows = await request(commandReadPath(commandUuid), { method: "GET" });
        if (!Array.isArray(rows) || rows.length !== 1) throw new ContractError("COMMAND_STATUS_UNAVAILABLE", "找不到唯一的報工狀態；請勿重送，先確認網路或聯絡管理員。");
        return rows[0];
      },
      async waitForTerminal(commandUuid, { signal, intervalMs = 2000, maxAttempts = Infinity } = {}) {
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          if (signal?.aborted) throw new ContractError("POLL_CANCELLED", "已停止查詢；原報工狀態仍待確認，請勿重送。");
          const row = await this.read(commandUuid);
          if (isTerminal(row)) return row;
          await delay(intervalMs);
        }
        return this.read(commandUuid);
      },
    };
  }

  return Object.freeze({
    FAIL_REASON_DEFAULTS, ALLOWED_ACKS, HARD_REJECTS, SOFT_REJECTS, REPORT_SELECT,
    ContractError, isPlainObject, reportMachineEnabled, isGuardConfig, legacyIdentityFromProjection, validateReportInput, buildSubmitArgs,
    commandReadPath, buildClientGuardSnapshot, isTerminal, resultCard, retryWithAck, retryPreviewWithAck, createClient,
  });
});
