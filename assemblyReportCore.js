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

  // 依客戶（租戶）開（owner 2026-10-31）：assemblyReportEnabled===true 且登入者的 tenant_id 在
  // assemblyReportTenants 裡才算開。租戶不明（null／空）、清單空或沒設、不在清單 → 一律關（fail closed）。
  function isAssemblyEnabledForTenant(config, tenantId) {
    const c = config || {};
    if (c.assemblyReportEnabled !== true) return false;
    const tenant = text(tenantId).toLowerCase();
    if (!tenant) return false;
    const list = Array.isArray(c.assemblyReportTenants) ? c.assemblyReportTenants.map((t) => text(t).toLowerCase()).filter(Boolean) : [];
    return list.includes(tenant);
  }

  // 關＝空陣列（呼叫端什麼都不做：不讀資料、不出入口）。
  function enabledStations(config, tenantId) {
    const c = config || {};
    if (!isAssemblyEnabledForTenant(c, tenantId)) return [];
    const list = Array.isArray(c.assemblyStations) ? c.assemblyStations : DEFAULT_STATIONS;
    return [...new Set(list.map(normCode).filter((code) => ALL_ASSEMBLY_STATIONS.includes(code)))];
  }

  function isAssemblyStation(config, code, tenantId) {
    return enabledStations(config, tenantId).includes(normCode(code));
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

  // ---- 不良（owner 2026-10-31：組裝不會發現不良，測試台才會）----
  // assemblyDefectStations（預設 ["G01"]）以外的站：不顯示「有不良品」、一律送不良 0。
  function defectAllowed(config, stationCode) {
    const list = Array.isArray(config?.assemblyDefectStations) ? config.assemblyDefectStations : ["G01"];
    return list.map(normCode).includes(normCode(stationCode));
  }
  // 不良原因：assemblyDefectReasons 有設（非空陣列）就用它，否則用工廠同步的清單。
  // 注意：工廠 guard 會檢查原因在不在它的 ReportFailReasonCodes 裡，自訂原因要兩邊一起改。
  function defectReasons(config, factoryReasons) {
    const custom = Array.isArray(config?.assemblyDefectReasons) ? config.assemblyDefectReasons.map(text).filter(Boolean) : [];
    return custom.length ? custom : (Array.isArray(factoryReasons) ? factoryReasons.slice() : []);
  }

  // ---- 短交（owner 2026-10-31：允許短交，但一般訂單數量多少就組多少）----
  // 沿用車床短交合約：close 指令的 p_short_completion = { reason_code: MATERIAL_SHORT|SCRAP|OTHER, note }。
  const SHORT_REASONS = Object.freeze(["MATERIAL_SHORT", "SCRAP", "OTHER"]);
  // planned＝工單數量；reportedGood＝已報良品（舊 MES＋待回寫）；thisGood＝完工時最後這次的良品。
  // 讀不到已報數 → known=false（呼叫端不可當作做滿）。
  function shortfall({ planned, reportedGood, thisGood = 0 }) {
    const plan = Number(planned);
    const done = Number(reportedGood);
    if (!Number.isFinite(plan) || plan <= 0) return { known: true, short: 0, done: null, planned: null };
    if (reportedGood == null || !Number.isFinite(done)) return { known: false, short: null, done: null, planned: plan };
    const total = done + (Number(thisGood) || 0);
    return { known: true, short: Math.max(0, plan - total), done: total, planned: plan };
  }
  function shortCompletionValue(reasonCode, note) {
    const reason = text(reasonCode);
    const n = text(note);
    if (!SHORT_REASONS.includes(reason)) return { ok: false, error: "short_reason_required" };
    if (n.length > 500) return { ok: false, error: "note_too_long" };
    if (reason === "OTHER" && !n) return { ok: false, error: "short_note_required" };
    return { ok: true, value: { reason_code: reason, note: n } };
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
  function validateForm(form, { failReasons = [], choices = [], mode = "report", defectAllowed: allowDefect = true } = {}) {
    const f = allowDefect ? (form || {}) : { ...(form || {}), defectOpen: false, bad: "", failReasonCode: "" };
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

  // ---- 多人報工送雲端（旗標 assemblyMultiOperatorCommandEnabled，預設關）----
  // 雲端 migration 20261101090000 給 machtile_submit_station_report 加了 p_operator_app_user_ids uuid[]：
  // 伺服器一定把登入者排第一、去重、最多 10 人、舊 MES 工號用「;」接起來 ≤ 50 字。migration 沒套之前帶這個參數
  // 會找不到函式 → 旗標關＝參數「不存在」（不是 null），送出內容跟今天一個 byte 都不差。只給組裝站用。
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const OPERATOR_LEGACY_JOINED_MAX = 50;

  function multiOperatorCommandEnabled(config) {
    return config?.assemblyMultiOperatorCommandEnabled === true;
  }

  // 勾選的人去掉登入者本人（伺服器自己會把登入者放第一）、去重、照勾選順序。回傳新陣列（凍結），
  // 同一次報工的預覽、正式、再次確認、代收貨重送都用這同一份。
  function coOperatorAppUserIds(operatorIds, actorId) {
    const me = String(actorId || "").toLowerCase();
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(operatorIds) ? operatorIds : []) {
      const id = String(raw || "").trim();
      const key = id.toLowerCase();
      if (!id || key === me || seen.has(key)) continue;
      seen.add(key);
      out.push(id);
    }
    return Object.freeze(out);
  }

  // 送出前先在平板上擋掉伺服器一定會拒絕的名單（回 i18n 錯誤代碼；null＝可以送）。
  // 跟伺服器同一套算法：登入者＋其他人（依舊 MES 工號去重）≤ 10 人、工號用「;」接起來 ≤ 50 字。
  // 登入者自己的工號不在名單裡（沒對照）時，只檢查人數，其餘交給伺服器。
  function checkCoOperators(coIds, { choices = [], actorId = "", actorLegacyUserId = "" } = {}) {
    const ids = Array.isArray(coIds) ? coIds : [];
    if (ids.some((id) => !UUID_RE.test(String(id)))) return "operator_list_invalid";
    const byId = new Map((Array.isArray(choices) ? choices : []).map((c) => [String(c.id), c]));
    const meLegacy = text(actorLegacyUserId) || text(byId.get(String(actorId || ""))?.legacyUserId);
    const nos = meLegacy ? [meLegacy] : [];
    for (const id of ids) {
      const no = text(byId.get(String(id))?.legacyUserId);
      if (!no) return "operator_list_member_legacy_missing";
      if (no.includes(";") || no.length > OPERATOR_LEGACY_JOINED_MAX) return "operator_list_member_legacy_invalid";
      if (!nos.includes(no)) nos.push(no);
    }
    const count = (meLegacy ? 0 : 1) + nos.length;
    if (count > MAX_OPERATORS) return "operator_list_too_long";
    if (meLegacy && nos.join(";").length > OPERATOR_LEGACY_JOINED_MAX) return "operator_list_too_long";
    return null;
  }

  // 伺服器回的錯誤（例外訊息裡帶代碼）→ i18n 鍵；不是多人名單的錯誤回 null（照原本方式顯示）。
  const OPERATOR_LIST_ERROR_KEYS = Object.freeze({
    OPERATOR_LIST_INVALID: "asm_err_operator_list_invalid",
    OPERATOR_LIST_TOO_LONG: "asm_err_operator_list_too_long",
    OPERATOR_LIST_MEMBER_NOT_FOUND: "asm_err_operator_list_member_not_found",
    OPERATOR_LIST_MEMBER_INACTIVE: "asm_err_operator_list_member_inactive",
    OPERATOR_LIST_MEMBER_LEGACY_ID_MISSING: "asm_err_operator_list_member_legacy_missing",
    OPERATOR_LIST_MEMBER_LEGACY_ID_INVALID: "asm_err_operator_list_member_legacy_invalid",
    OPERATOR_LEGACY_ID_INVALID: "asm_err_operator_legacy_invalid",
  });
  function operatorListErrorKey(errorOrMessage) {
    const message = String(errorOrMessage?.message ?? errorOrMessage ?? "");
    // 長的代碼先比（OPERATOR_LIST_MEMBER_* 含 OPERATOR_LIST_ 前綴）
    const code = Object.keys(OPERATOR_LIST_ERROR_KEYS).sort((a, b) => b.length - a.length)
      .find((c) => new RegExp(`(^|[^A-Z_])${c}([^A-Z_]|$)`).test(message));
    return code ? OPERATOR_LIST_ERROR_KEYS[code] : null;
  }

  // 報工預覽 args：組裝站沒有機台計數器 → 永遠不帶計數器欄位（reportCounterMetaRpcEnabled=false）。
  // operatorAppUserIds：undefined／null＝不帶 p_operator_app_user_ids（旗標關＝今天的送出內容）；
  // 陣列＝帶（可以是空陣列＝只有登入者一人）。
  function buildReportArgs(context, valid, commandUuid, { preview = true, failReasons = [], outsourceReceiptDialogEnabled = false, clientGuardSnapshot = null,
    previousOutsourceReceiptQty = null, expectedDoc4Fingerprint = null, operatorAppUserIds = undefined } = {}) {
    const core = stationCore();
    const args = core.buildSubmitArgs({ ...context, goodQty: valid.goodQty, failQty: valid.failQty, failReasonCode: valid.failReasonCode,
      reportNote: valid.note, acks: [], clientGuardSnapshot,
      outsourceReceiptDialogEnabled, previousOutsourceReceiptQty, expectedDoc4Fingerprint,
      reportCounterMetaRpcEnabled: false, reportCounterMeta: null }, commandUuid, preview, failReasons);
    if (operatorAppUserIds != null) {
      if (!Array.isArray(operatorAppUserIds) || operatorAppUserIds.length > MAX_OPERATORS
        || operatorAppUserIds.some((id) => !UUID_RE.test(String(id)))) {
        throw new Error("OPERATOR_LIST_INVALID");
      }
      args.p_operator_app_user_ids = operatorAppUserIds.map(String);
    }
    return args;
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
    SHORT_REASONS, defectAllowed, defectReasons, shortfall, shortCompletionValue,
    isAssemblyEnabledForTenant, enabledStations, isAssemblyStation, stationLabel, machineCodeOf, ordersForStation, lineOf, stationHasLines,
    operatorChoices, defaultOperatorIds, toggleOperator, validateForm, legacyContext, buildReportArgs, commandFields,
    multiOperatorCommandEnabled, coOperatorAppUserIds, checkCoOperators, operatorListErrorKey, OPERATOR_LIST_ERROR_KEYS,
    productionReportPayload, shiftStateByOrder, orderKey, displayState, resultSummary,
  });
});
