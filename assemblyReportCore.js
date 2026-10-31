// assemblyReportCore.js — 組裝站（F01 組立等，舊 MES Station_Type 8 多工站）在 APP 報工的純邏輯。
//
// owner 2026-10-31 三週計畫：第 2 週 F01 組立改在平板報工、第 3 週全部組裝站（D01 研磨、D03 壓合、
// E01 清洗、F01 組立、G01 測試〔閥件測試／幫浦測試兩條線〕、H01 包裝）。旗標 assemblyReportEnabled 預設關。
//
// 跟 CNC 機台不同的地方（為什麼不直接用車床／銑床的批次頁）：
//   - 組裝站同一時間掛好幾張單（ManufactureII 每張單一列），報工要指定「哪一列」＝ manufacture_ii_id；
//   - 沒有機台計數器 → 數量欄是「這次完成幾件（良品）」＋「這次不良幾件」，不是機台總數；
//   - 一次報工可以有好幾個作業員（F01 三個人），每人選自己的名字（之後要算每人產值）。
// 只用既有合約：station_commands 的 start／close（machtile_submit_station_command）、
// 報工預覽／正式（machtile_submit_station_report，帶 p_manufacture_ii_id），App 紀錄走既有
// production_reports（field_report_upsert outbox，operators＝勾選的人）。這支檔案不碰 DOM、不打網路。
(function attachMachTileAssemblyReportCore(root, factory) {
  const stationCore = () => root?.MachTileStationReportCore || (typeof require === "function" ? require("./stationReportCore.js") : null);
  const api = factory(stationCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileAssemblyReportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileAssemblyReportCore(stationCore) {
  "use strict";

  const ALL_ASSEMBLY_STATIONS = Object.freeze(["D01", "D03", "E01", "F01", "G01", "H01"]);
  const DEFAULT_STATIONS = Object.freeze(["F01"]);
  const STATION_LABELS = Object.freeze({ D01: "研磨", D03: "壓合", E01: "清洗", F01: "組立", G01: "測試", H01: "包裝" });
  const MAX_QTY = 100000;
  const MAX_OPERATORS = 10;

  function normCode(value) { return String(value ?? "").trim().toUpperCase(); }
  function text(value) { return value == null ? "" : String(value).trim(); }

  // 旗標關＝空陣列（呼叫端什麼都不做：不讀資料、不出入口）。
  function enabledStations(config) {
    const c = config || {};
    if (c.assemblyReportEnabled !== true) return [];
    const list = Array.isArray(c.assemblyStations) ? c.assemblyStations : DEFAULT_STATIONS;
    return [...new Set(list.map(normCode).filter((code) => ALL_ASSEMBLY_STATIONS.includes(code)))];
  }

  function isAssemblyStation(config, code) {
    return enabledStations(config).includes(normCode(code));
  }

  function stationLabel(code) {
    const c = normCode(code);
    return STATION_LABELS[c] ? `${c} ${STATION_LABELS[c]}` : c;
  }

  function machineCodeOf(order) {
    const raw = normCode(order?.machineCode || order?.machine);
    const m = raw.match(/^([A-Z]\d{2})\b/);
    return m ? m[1] : raw;
  }

  const STATUS_RANK = { running: 0, abnormal: 1, paused: 2, waiting_inspection: 3, pending: 4 };

  // 站上目前所有的單：派工到這站、舊 MES 沒移走、工序與工單都沒完。加工中優先 → 交期 → 單號。
  function ordersForStation(orders, stationCode) {
    const code = normCode(stationCode);
    return (Array.isArray(orders) ? orders : [])
      .filter((o) => o && o.processId && machineCodeOf(o) === code && o.offStation !== true
        && !["completed", "cancelled"].includes(String(o.processStatus || ""))
        && !["completed", "shipped", "cancelled"].includes(String(o.workStatus || "")))
      .slice()
      .sort((a, b) => {
        const ra = STATUS_RANK[a.processStatus] ?? 9;
        const rb = STATUS_RANK[b.processStatus] ?? 9;
        if (ra !== rb) return ra - rb;
        const da = String(a.dueDate || "9999-12-31");
        const db = String(b.dueDate || "9999-12-31");
        if (da !== db) return da < db ? -1 : 1;
        return String(a.id).localeCompare(String(b.id));
      });
  }

  // ---- G01 閥件測試／幫浦測試（看品名裡的型號，最長前綴；單字母 A／P 只有後面接數字才算幫浦） ----
  const PUMP_PREFIXES = Object.freeze(["ASR16", "PV2R1", "PV2R2", "PV2R3", "PV2R4", "PV2R", "JP20", "AR"]);
  const VALVE_PREFIXES = Object.freeze([
    "DB-G03", "SBSG", "S-BG", "SBSR", "BSG", "BR", "SBR", "MCA-06", "RG", "RCG", "BUCG", "ST-798", "DG-01", "DG-02", "DT", "BG", "BT",
    "DSHG", "DSG", "4WE-6", "MD-02", "DCG", "DCT", "CRG", "CPDG", "CPG", "CPDT", "CPT", "PF", "SG", "SCTF-02",
    "EDG-01", "EBG", "SRCG", "SRCT", "SRG", "SRT", "SKF", "THF", "SDF", "SF", "SD", "MSCP", "MSP", "MB", "MR", "MH", "MS", "MC", "MP",
  ]);
  const LINE_LABELS = Object.freeze({ valve: "閥件測試", pump: "幫浦測試", other: "未分類" });

  function lineOf(partName) {
    const name = normCode(partName).replace(/\s+/g, "");
    if (!name) return "other";
    if (name.includes("中座")) return "valve"; // owner 10/17：中座都是油壓閥件
    const tokens = name.split(/[^A-Z0-9-]+/).filter(Boolean);
    let best = { len: 0, line: "other" };
    for (const token of tokens) {
      for (const p of PUMP_PREFIXES) if (token.startsWith(p) && p.length > best.len) best = { len: p.length, line: "pump" };
      for (const p of VALVE_PREFIXES) if (token.startsWith(p) && p.length > best.len) best = { len: p.length, line: "valve" };
      if (best.len === 0 && /^[AP]\d/.test(token)) best = { len: 1, line: "pump" };
    }
    return best.line;
  }

  function stationHasLines(config, stationCode) {
    const split = config?.assemblyLineSplit;
    const list = Array.isArray(split) ? split : ["G01"];
    return list.map(normCode).includes(normCode(stationCode));
  }

  // ---- 報工人 ----
  // 只列有對照舊 MES 工號的人（產值要歸得到人）。預設＝「我」（登入的人，若有對照）。
  function operatorChoices(users, actorId) {
    return (Array.isArray(users) ? users : [])
      .filter((u) => u && u.id && text(u.legacy_user_id))
      .map((u) => ({ id: String(u.id), name: text(u.name) || String(u.id), legacyUserId: text(u.legacy_user_id), isMe: String(u.id) === String(actorId || "") }))
      .sort((a, b) => (a.isMe === b.isMe ? a.name.localeCompare(b.name, "zh-Hant") : a.isMe ? -1 : 1));
  }

  function defaultOperatorIds(choices, actorId) {
    return (Array.isArray(choices) ? choices : []).some((c) => c.id === String(actorId || "")) ? [String(actorId)] : [];
  }

  function toggleOperator(selectedIds, id) {
    const set = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
    const key = String(id || "");
    if (!key) return [...set];
    if (set.has(key)) set.delete(key); else set.add(key);
    return [...set];
  }

  // ---- 表單驗證 ----
  // mode: "report"（一般報工，合計至少 1 件）／"finish"（完工：可以都填 0＝只關站）
  function validateForm(form, { failReasons = [], choices = [], mode = "report" } = {}) {
    const f = form || {};
    const errors = {};
    const parse = (raw) => {
      const s = text(raw);
      if (s === "") return 0;
      const n = Number(s);
      return Number.isInteger(n) && n >= 0 && n <= MAX_QTY ? n : NaN;
    };
    const good = parse(f.good);
    const bad = f.defectOpen === true ? parse(f.bad) : 0;
    if (Number.isNaN(good)) errors.good = "qty_invalid";
    if (Number.isNaN(bad)) errors.bad = "qty_invalid";
    if (!errors.good && !errors.bad && mode !== "finish" && good + bad < 1) errors.good = "qty_required";
    const reason = bad > 0 ? text(f.failReasonCode) : "";
    if (bad > 0 && (!reason || !failReasons.includes(reason))) errors.failReasonCode = "reason_required";
    const note = text(f.note);
    if (bad > 0 && reason === "其他" && !note) errors.note = "note_required";
    if (note.length > 500) errors.note = "note_too_long";
    const allowed = new Set((Array.isArray(choices) ? choices : []).map((c) => c.id));
    const operators = [...new Set((Array.isArray(f.operatorIds) ? f.operatorIds : []).map(String))].filter((id) => allowed.has(id));
    if (good + bad > 0 || mode !== "finish") {
      if (!operators.length) errors.operators = "operator_required";
      else if (operators.length > MAX_OPERATORS) errors.operators = "operator_too_many";
    }
    const ok = Object.keys(errors).length === 0;
    return { ok, errors, goodQty: ok ? good : null, failQty: ok ? bad : null, failReasonCode: bad > 0 ? reason : null,
      note: note || null, operatorIds: operators, hasQty: ok && good + bad > 0 };
  }

  // ---- 舊 MES 對照（只用派工橋同步的欄位；多工站一定要 manufacture_ii_id） ----
  function legacyContext(order, identityRow, stationCode) {
    const core = stationCore();
    if (!core || !order?.id || !identityRow) return { ok: false, missing: ["legacy_identity"] };
    const missing = [];
    let identity = null;
    try { identity = core.legacyIdentityFromProjection(identityRow); } catch { missing.push("legacy_index_sn/simulation_id"); }
    if (!text(identityRow.manufacture_ii_id)) missing.push("manufacture_ii_id");
    const partNo = text(identityRow.part_no);
    if (!partNo) missing.push("part_no");
    if (missing.length) return { ok: false, missing };
    return { ok: true, context: {
      machineCode: normCode(stationCode),
      expectedOrderNo: text(order.id),
      expectedIndexSn: identity.expectedIndexSn,
      manufactureIiId: identity.manufactureIiId,
      expectedSimulationId: identity.expectedSimulationId,
      expectedPartNo: partNo,
    } };
  }

  // 報工預覽 args：組裝站沒有機台計數器 → 永遠不帶計數器欄位（reportCounterMetaRpcEnabled=false）。
  function buildReportArgs(context, valid, commandUuid, { preview = true, failReasons = [], outsourceReceiptDialogEnabled = false, clientGuardSnapshot = null,
    previousOutsourceReceiptQty = null, expectedDoc4Fingerprint = null } = {}) {
    const core = stationCore();
    return core.buildSubmitArgs({ ...context, goodQty: valid.goodQty, failQty: valid.failQty, failReasonCode: valid.failReasonCode,
      reportNote: valid.note, acks: [], clientGuardSnapshot,
      outsourceReceiptDialogEnabled, previousOutsourceReceiptQty, expectedDoc4Fingerprint,
      reportCounterMetaRpcEnabled: false, reportCounterMeta: null }, commandUuid, preview, failReasons);
  }

  // start／close 共用的指令欄位（給 stationCommandCore.submitPayload）
  function commandFields(context) {
    return { orderNo: context.expectedOrderNo, step: context.expectedIndexSn, partNo: context.expectedPartNo,
      manufactureIiId: context.manufactureIiId, expectedSimulationId: context.expectedSimulationId };
  }

  // App 紀錄（production_reports.report_payload）。report_uuid＝正式報工指令的 command_uuid，
  // station_command_uuid 標記＝這筆已由 Factory 寫進舊 MES（回寫橋不可再寫一次）。
  function productionReportPayload({ args, reportType, operatorIds, stationCode, line }) {
    return {
      report_type: reportType,
      completed_qty: args.p_good_qty,
      defect_qty: args.p_fail_qty,
      fail_reason_code: args.p_fail_reason_code || null,
      station_command_uuid: args.p_command_uuid,
      report_source: "assembly_app",
      assembly_station: normCode(stationCode),
      ...(line && line !== "all" ? { assembly_line: line } : {}),
      operator_count: Array.isArray(operatorIds) ? operatorIds.length : 0,
      manufacture_ii_id: args.p_manufacture_ii_id,
    };
  }

  // 今天這站 start／stop 指令（已套用）→ 每張單目前是開工中還是停工
  function shiftStateByOrder(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : [])
      .filter((r) => r && r.status === "applied" && ["start", "stop"].includes(r.command_type))
      .slice().sort((a, b) => String(a.applied_at || a.requested_at || "").localeCompare(String(b.applied_at || b.requested_at || "")))
      .forEach((r) => map.set(`${text(r.expected_order_no)}#${Number(r.expected_index_sn)}`, { state: r.command_type === "start" ? "running" : "stopped", at: r.applied_at || r.requested_at || null }));
    return map;
  }

  function orderKey(orderNo, indexSn) { return `${text(orderNo)}#${Number(indexSn)}`; }

  // 畫面上的狀態：今天有已套用的開工＝生產中；有停工＝停工；都沒有→看雲端工序狀態
  function displayState(order, shift) {
    if (shift?.state === "running") return "running";
    if (shift?.state === "stopped") return "stopped";
    return order?.processStatus === "running" ? "running" : "notStarted";
  }

  function resultSummary({ good, bad, operatorNames }) {
    return { good: Number(good) || 0, bad: Number(bad) || 0, names: (Array.isArray(operatorNames) ? operatorNames : []).filter(Boolean).join("、") };
  }

  return Object.freeze({
    ALL_ASSEMBLY_STATIONS, DEFAULT_STATIONS, STATION_LABELS, LINE_LABELS, MAX_OPERATORS,
    enabledStations, isAssemblyStation, stationLabel, machineCodeOf, ordersForStation, lineOf, stationHasLines,
    operatorChoices, defaultOperatorIds, toggleOperator, validateForm, legacyContext, buildReportArgs, commandFields,
    productionReportPayload, shiftStateByOrder, orderKey, displayState, resultSummary,
  });
});
