// switchStepCore.js — 機台卡片「換道次」（owner 2026-11-12：「訂單對，但是製程順序錯誤」）。
//
// 同一張工單、換成待做池裡另一道：先把現在這一道退回（return_claim，CONTRACT-P2，沿用 returnClaimCore 的送出與輪詢），
// 工廠確認退回之後，重讀待做池、確認選的那一道還在而且這台可以接，再用既有的 dispatch_pool_claim 接。沒有新的請求格式。
// 旗標：config.enableSwitchStep（預設 false），而且 config.enableReturnClaim 也要開才有效。
// 這裡只做可測的決策；DOM 與 fetch 留在 app.js。畫面文字一律回 i18n key。
// 不存任何東西到 localStorage：平板在「退回」與「接新的一道」之間重新整理，就只剩一筆普通的退回，不會自動接。
(function attachMachTileSwitchStepCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileSwitchStepCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileSwitchStepCore() {
  "use strict";

  // 合約 §2：退回成功（applied）時 legacy_snapshot.return_claim.mode 的三個值。其他值＝看不懂＝不接。
  const APPLIED_MODES = Object.freeze(["unassigned", "stale_assignment_reconciled", "already_returned"]);
  // 按下「換成第 x 道」之後，退回的結果超過這麼久才回來＝人多半已經離開或改做別的事 → 不自動接。
  const CONTINUE_MAX_MS = 3 * 60 * 1000;
  // 重讀待做池最多幾次（只是讀；接單本身絕不重試）
  const POOL_READ_ATTEMPTS = 2;

  const text = (value) => String(value ?? "").trim();
  const normCode = (value) => text(value).toUpperCase();
  function positiveInt(value) {
    const n = Number(value);
    return value !== null && value !== "" && Number.isInteger(n) && n > 0 ? n : null;
  }

  function enabled({ flag, returnClaimEnabled } = {}) {
    return flag === true && returnClaimEnabled === true;
  }

  // ---------------------------------------------------------------- 這台可不可以接這個池列
  // machine＝{ machineCode, departmentCode（LATHE／MILL）, status, multiStation, enabledMachines（config.dispatchPoolMachines）}
  // 跟「選工單」的接單條件一樣（機台有開放接單、不是維修／離線、單工站要是空閒狀態、同課、在可做機台清單），
  // 只是不看「機台上沒有工單」——換道次時機台上還掛著要退回的那一道。
  function machineMayTake(item, machine) {
    const no = (reason) => ({ ok: false, reason });
    const code = normCode(machine && machine.machineCode);
    if (!code) return no("no_machine");
    if (!(Array.isArray(machine.enabledMachines) ? machine.enabledMachines : []).map(normCode).includes(code)) return no("machine_not_open");
    const status = text(machine.status).toLowerCase();
    if (["maintenance", "offline"].includes(status)) return no("machine_unavailable");
    // 雲端接單規則：單工站（A 機）機台狀態要是空閒才接得到；多工站（B 機）空閒／生產中／暫停都可以
    if (machine.multiStation !== true && status !== "idle") return no("machine_not_idle");
    const department = text(machine.departmentCode);
    if (!department) return no("no_department");
    if (!item) return no("no_item");
    // 清單只查 status=waiting 的列（沒有 status 欄）；有帶 status 的話必須是 waiting
    if (item.status !== undefined && item.status !== null && text(item.status) !== "waiting") return no("not_waiting");
    if (text(item.department_code) !== department) return no("other_department");
    if (!(Array.isArray(item.eligible_machine_codes) ? item.eligible_machine_codes : []).map(normCode).includes(code)) return no("not_eligible");
    return { ok: true, reason: "" };
  }

  // ---------------------------------------------------------------- 同一張工單、待做池裡的其他道次
  // 回 { ready, choices, notEligible }：ready＝待做池這次有讀到（status ready）；choices＝這台可以接的其他道（依道次排序）；
  // notEligible＝同一張工單還有其他道在池裡、但這台不能接的數量。
  function otherSteps({ poolStatus, items, orderNo, currentStep, currentSourceKey, machine } = {}) {
    if (poolStatus !== "ready" || !Array.isArray(items)) return { ready: false, choices: [], notEligible: 0 };
    const order = text(orderNo);
    const current = positiveInt(currentStep);
    const currentKey = text(currentSourceKey);
    if (!order || current === null) return { ready: true, choices: [], notEligible: 0 };
    const choices = [];
    let notEligible = 0;
    const seen = new Set();
    for (const item of items) {
      if (!item || text(item.work_order_no) !== order) continue;
      const sourceKey = text(item.source_key);
      const step = positiveInt(item.process_order);
      if (sourceKey.length < 5 || sourceKey.length > 120 || step === null) continue;
      if (sourceKey === currentKey || step === current || seen.has(sourceKey)) continue;
      seen.add(sourceKey);
      if (!machineMayTake(item, machine).ok) { notEligible += 1; continue; }
      const quantity = positiveInt(item.quantity);
      choices.push({ sourceKey, step, name: text(item.operation_name), quantity, partNo: text(item.part_no), partName: text(item.part_name) });
    }
    choices.sort((a, b) => a.step - b.step || a.sourceKey.localeCompare(b.sourceKey));
    return { ready: true, choices, notEligible };
  }

  // 卡片要不要出現「換道次」：跟「接錯了，退回」同一套條件（returnShow），再加「已載入的待做池裡，同一張工單有這台可以接的其他道」。
  // 待做池沒載入／載入失敗＝不顯示（不猜）。
  function visibility({ enabled: on, returnShow, poolStatus, items, orderNo, currentStep, currentSourceKey, machine } = {}) {
    const no = (reason) => ({ show: false, reason, choices: [] });
    if (on !== true) return no("flag_off");
    if (returnShow !== true) return no("return_hidden");
    const found = otherSteps({ poolStatus, items, orderNo, currentStep, currentSourceKey, machine });
    if (!found.ready) return no("pool_not_ready");
    if (!found.choices.length) return no(found.notEligible > 0 ? "other_step_not_eligible" : "no_other_step");
    return { show: true, reason: "", choices: found.choices };
  }

  // ---------------------------------------------------------------- 狀態機
  // choosing（確認卡開著）→ returning（退回已送出，等結果）→ verifying（退回成功，重讀待做池）→ claiming（接新的一道）→ done
  // 任何一步不成立就停在一個「結束」狀態；claiming 只有 verifying 一條路進得來，而且出去之後回不來（＝接單最多做一次）。
  const TRANSITIONS = Object.freeze({
    choosing: Object.freeze({ confirm: "returning", cancel: "closed" }),
    returning: Object.freeze({
      return_applied: "verifying",              // 工廠確認已退回（三種 mode 之一）而且沒有等太久
      return_applied_no_continue: "returned_not_claimed",   // 已退回，但 mode 看不懂或等太久 → 不接
      return_rejected: "return_rejected",       // 確定沒有退回：什麼都沒變
      return_unsure: "return_unsure",           // 工廠說結果不確定：不接
      return_uncertain: "stopped_uncertain",    // 送出時斷線／逾時，不知道有沒有送到：不接
    }),
    verifying: Object.freeze({ verify_ok: "claiming", verify_failed: "returned_not_claimed" }),
    claiming: Object.freeze({ claim_ok: "done", claim_failed: "returned_not_claimed", claim_uncertain: "claim_uncertain",
      claim_ok_unrefreshed: "claimed_refresh_failed" }),   // 接單 RPC 成功，但之後重讀畫面失敗／逾時：接到了，只是畫面沒更新
  });
  const TERMINAL_STATES = Object.freeze(["closed", "return_rejected", "return_unsure", "stopped_uncertain", "returned_not_claimed", "claim_uncertain", "claimed_refresh_failed", "done"]);
  // 第二步進行中（退回的等待紀錄已經收掉）：這兩個狀態自己鎖住機台
  const HOLDING_STATES = Object.freeze(["verifying", "claiming"]);

  function next(state, event) {
    const row = Object.prototype.hasOwnProperty.call(TRANSITIONS, state) ? TRANSITIONS[state] : null;
    return row && Object.prototype.hasOwnProperty.call(row, event) ? row[event] : null;
  }
  function isTerminal(state) { return TERMINAL_STATES.includes(state); }
  function holds(state) { return HOLDING_STATES.includes(state); }
  function claimAllowed(state) { return state === "claiming"; }

  // 退回那筆指令有了結果（returnClaimCore.resultView 的 view）→ 狀態機事件
  function returnEvent({ view, startedAt, nowMs } = {}) {
    const phase = text(view && view.phase);
    if (phase === "applied") {
      if (!APPLIED_MODES.includes(text(view.mode))) return { event: "return_applied_no_continue", reasonKey: "switch_step_reason_unknown_mode" };
      const waited = Number(nowMs) - Number(startedAt);
      if (!(waited >= 0) || waited > CONTINUE_MAX_MS) return { event: "return_applied_no_continue", reasonKey: "switch_step_reason_late" };
      return { event: "return_applied", reasonKey: "" };
    }
    // 工廠回「結果不確定」的那幾個碼（returnClaimCore 用 warn 色）；expired＝確定沒有退回
    if (phase === "rejected" && text(view.tone) === "warn") return { event: "return_unsure", reasonKey: "" };
    return { event: "return_rejected", reasonKey: "" };
  }

  // 退回成功之後、接單之前：重讀到的待做池裡，選的那一道還在（＝還是 waiting）、還是同一張單同一道、這台還可以接。
  function verifyTarget({ poolFresh, items, target, orderNo, machine } = {}) {
    const no = (reasonKey) => ({ ok: false, reasonKey });
    if (poolFresh !== true || !Array.isArray(items)) return no("switch_step_reason_pool_unread");
    const key = text(target && target.sourceKey);
    const item = key ? items.find((row) => row && text(row.source_key) === key) : null;
    if (!item) return no("switch_step_reason_not_in_pool");
    if (text(item.work_order_no) !== text(orderNo) || positiveInt(item.process_order) !== positiveInt(target.step)) return no("switch_step_reason_not_in_pool");
    const may = machineMayTake(item, machine);
    if (!may.ok) {
      return no(may.reason === "not_waiting" ? "switch_step_reason_not_in_pool"
        : may.reason === "machine_not_idle" ? "switch_step_reason_machine_not_idle" : "switch_step_reason_not_eligible");
    }
    return { ok: true, reasonKey: "" };
  }

  // 既有接單函式（machtileClaimDispatchPool）的結果 → 狀態機事件。
  //   { ok: true }＝接到了；{ ok: false, claimed: true, error }＝接單 RPC 成功、之後重讀畫面失敗（接到了，畫面沒更新）；
  //   { ok: false, error }＝沒接到或不確定；其他（undefined）＝函式沒有送出（例：另一筆接單正在處理）。
  const CLAIM_REASON_KEY = Object.freeze({
    POOL_ITEM_NOT_WAITING: "switch_step_reason_taken",
    UNACKNOWLEDGED_CLAIM_EXISTS: "switch_step_reason_taken",
    PROCESS_ALREADY_ASSIGNED: "switch_step_reason_taken",
    MACHINE_ALREADY_ASSIGNED: "switch_step_reason_machine_busy",
    MACHINE_NOT_EMPTY: "switch_step_reason_machine_busy",
    MACHINE_NOT_IDLE: "switch_step_reason_machine_not_idle",
    MACHINE_NOT_ELIGIBLE: "switch_step_reason_not_eligible",
    MACHINE_DEPARTMENT_MISMATCH: "switch_step_reason_not_eligible",
    DEPARTMENT_ACCESS_DENIED: "switch_step_reason_not_eligible",
    POOL_ITEM_INCOMPLETE: "switch_step_reason_generic",
    DISPATCH_POOL_CLAIM_DISABLED: "switch_step_reason_not_open",
    AUTH_REQUIRED: "switch_step_reason_login",
    TENANT_REQUIRED: "switch_step_reason_login",
  });
  function claimErrorCode(error) {
    const message = text((error && error.message) || error);
    const match = message.match(/(?:^|[^A-Z0-9_])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?=[^A-Z0-9_]|$)/);
    return match ? match[1] : "";
  }
  function claimEvent(result) {
    if (!result || typeof result !== "object") return { event: "claim_failed", reasonKey: "switch_step_reason_busy" };
    if (result.ok === true) return { event: "claim_ok", reasonKey: "" };
    // 只認嚴格的 true：RPC 已經成功回來，後面出什麼錯都不會改變「接到了」這件事
    if (result.claimed === true) return { event: "claim_ok_unrefreshed", reasonKey: "" };
    const message = text((result.error && result.error.message) || result.error);
    const code = claimErrorCode(result.error);
    if (code && Object.prototype.hasOwnProperty.call(CLAIM_REASON_KEY, code)) return { event: "claim_failed", reasonKey: CLAIM_REASON_KEY[code] };
    // 伺服器明確回 4xx＝確定沒接；斷線、逾時、5xx＝不知道有沒有接到
    if (/^4\d\d\b/.test(message)) return { event: "claim_failed", reasonKey: message.startsWith("401") ? "switch_step_reason_login" : "switch_step_reason_generic" };
    return { event: "claim_uncertain", reasonKey: "" };
  }

  // 結束狀態 → 畫面上那一句（卡片、確認卡、提示共用）。phase 一律 "applied"：走到這裡退回都已經成功。
  function outcome({ state, mode, from, to, reasonKey } = {}) {
    const base = { switchStep: true, state, phase: "applied", terminal: true, mode: text(mode), code: "", params: { from: positiveInt(from), to: positiveInt(to) } };
    if (state === "done") return { ...base, tone: "ok", messageKey: "switch_step_done", reasonKey: "" };
    if (state === "claim_uncertain") return { ...base, tone: "warn", messageKey: "switch_step_claim_uncertain", reasonKey: "" };
    if (state === "claimed_refresh_failed") return { ...base, tone: "warn", messageKey: "switch_step_claimed_refresh_failed", reasonKey: "" };
    // stale_assignment_reconciled＝工廠沒碰機台（機台掛的是別道）：不可以說「這台現在沒有工單」
    return { ...base, state: "returned_not_claimed", tone: "warn",
      messageKey: text(mode) === "stale_assignment_reconciled" ? "switch_step_claim_failed_reconciled" : "switch_step_claim_failed",
      reasonKey: text(reasonKey) || "switch_step_reason_generic" };
  }

  // ================================================================ 第 2 階段：已開工、還沒報工（DESIGN 20261113-2230 §3／§4）
  // 一筆新的指令 switch_step（rpc/machtile_submit_switch_step_command，九個參數），工廠一個交易做完「停工（0 件）→ 舊道次退回
  // → 新道次設到這台」，所以只有 choosing → submitting → done｜rejected｜unsure，沒有第 1 階段的「退了、沒接到」。
  // 結果用既有的指令輪詢看（returnClaimCore.pollPath：同一串 select，不多讀新欄位）。
  // 旗標：config.enableSwitchStepStarted（預設 false，跟第 1 階段的 enableSwitchStep 分開，也不需要 enableReturnClaim）；
  //       config.switchStepStartedAllowUnpooled（預設 false）＝不在待做池的道次也列出來（要跟工廠 SwitchStepAllowUnpooledTarget 一起開）。
  const STARTED_COMMAND_TYPE = "switch_step";
  const STARTED_SUBMIT_RPC = "machtile_submit_switch_step_command";
  // 雲端 RPC 的參數名稱，逐字（20261114090000_station_switch_step_commands.sql）
  const STARTED_ARG_KEYS = Object.freeze(["p_command_uuid", "p_machine_code", "p_pool_item_id", "p_expected_order_no", "p_expected_index_sn",
    "p_target_index_sn", "p_target_pool_item_id", "p_expected_part_no", "p_reason"]);
  const STARTED_ROLES = Object.freeze(["operator", "admin", "planner"]);
  const STARTED_REASON_ROLES = Object.freeze(["admin", "planner"]);
  const STARTED_REASON_MAX = 500;
  const STARTED_PENDING_KEEP_MS = 24 * 60 * 60 * 1000;
  // 雲端 process 狀態：running／paused＝已開工；pending 但有開工時間（或這台平板今天看到開工）也算
  const STARTED_STATUSES = Object.freeze(["running", "paused"]);
  // 目標清單排除：做完的、跳過的、待檢的（雲端 TARGET_STEP_CLOSED 擋 completed／skipped；待檢也不給換過去）
  const STARTED_CLOSED_STEP = Object.freeze(["completed", "skipped", "waiting_inspection"]);
  const STARTED_CLOSED_ORDER = Object.freeze(["completed", "shipped", "cancelled"]);
  // 「第 N 道現在不在任何機台、也不在待做池」提醒：作業員在那台卡片上看 24 小時；管理員／生管看 72 小時（或在這台平板按「已安排」）
  const UNPOOLED_NOTICE_OPERATOR_MS = 24 * 60 * 60 * 1000;
  const UNPOOLED_NOTICE_ADMIN_MS = 72 * 60 * 60 * 1000;
  // 結果不確定之後，同一張單同一道這麼久之內不再出「換道次」（不重複送；請他重新整理看結果）
  const STARTED_UNSURE_HOLD_MS = 10 * 60 * 1000;

  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  const normRole = (value) => text(value).toLowerCase();
  const validKey = (value) => { const key = text(value); return key.length >= 5 && key.length <= 120 ? key : ""; };

  function startedEnabled({ flag } = {}) { return flag === true; }
  function startedRoleAllowed(role, isBridge) { return STARTED_ROLES.includes(normRole(role)) && isBridge !== true; }
  function startedNeedsReason(role) { return STARTED_REASON_ROLES.includes(normRole(role)); }

  // ---------------------------------------------------------------- 卡片要不要出現「換道次」（已開工）
  // 第 1 階段的按鈕只在「接了、還沒開工」出現；這一顆只在「已開工、還沒報工」出現，兩者不會同時成立。
  // 單工站（A 機）才有；多工站（B 機）不出（工廠只做 A01–A05 單工站）。任何一項不確定＝不顯示。
  function startedVisibility({ enabled: on, role, isBridge, cardDetailsReady, isUnassignedBucket, multiStation, machineCode, order, actualStartAt,
    startedLocally, startedToday, hasTodayReport, commandInFlight, unsureHold, machineAllowed } = {}) {
    const no = (reason) => ({ show: false, reason, needsReason: false });
    if (on !== true) return no("flag_off");
    if (!startedRoleAllowed(role, isBridge)) return no("role");
    if (isUnassignedBucket === true) return no("no_machine");
    const code = normCode(machineCode);
    if (!code || code.length > 30) return no("no_machine");
    // config.switchStepStartedMachines（預設 []＝一台都沒有）：機台要在名單裡才出
    if (machineAllowed !== true) return no("machine_not_listed");
    if (multiStation === true) return no("multi_station");
    if (!order) return no("no_order");
    if (order.offStation === true) return no("off_station");
    const orderNo = text(order.id);
    if (!orderNo || orderNo.length > 100) return no("no_order_no");
    if (positiveInt(order.stationStep) === null) return no("no_step");
    if (!isUuid(order.processId)) return no("no_process");
    if (cardDetailsReady !== true) return no("card_not_ready");
    if (Number(order.done) !== 0 || hasTodayReport === true) return no("has_reports");
    const status = text(order.processStatus);
    const started = STARTED_STATUSES.includes(status)
      || (status === "pending" && (Boolean(text(actualStartAt)) || startedLocally === true || startedToday === true));
    if (!started) return no("not_started");
    if (commandInFlight === true) return no("command_in_flight");
    if (unsureHold === true) return no("unsure_hold");
    return { show: true, reason: "", needsReason: startedNeedsReason(role) };
  }

  // 開確認卡時重讀的這一道（work_order_processes＋work_orders＋machines）：還在這台、同一張單同一道、已開工或還沒開工但沒有數量。
  function startedFreshCheck({ machineCode, orderNo, step, row } = {}) {
    const bad = (reason) => ({ ok: false, reason, partNo: null, workOrderId: "" });
    if (!row) return bad("process_not_found");
    const wo = row.work_orders || {};
    const machine = row.machines || {};
    if (row.off_station_at) return bad("off_station");
    if (normCode(machine.machine_code) !== normCode(machineCode)) return bad("machine_changed");
    if (positiveInt(row.process_order) !== positiveInt(step)) return bad("step_changed");
    if (text(wo.work_order_no) !== text(orderNo)) return bad("order_changed");
    if (STARTED_CLOSED_ORDER.includes(text(wo.status))) return bad("order_closed");
    if (!["pending", "running", "paused"].includes(text(row.status))) return bad("not_switchable");
    if (Number(row.qty_completed || 0) !== 0 || Number(row.qty_defect || 0) !== 0) return bad("has_reports");
    return { ok: true, reason: "", partNo: text(wo.part_no) || null, workOrderId: isUuid(wo.id) ? String(wo.id) : "" };
  }

  // ---------------------------------------------------------------- 今天這一道有沒有「報工」
  // 卡片的 todayRows（production_reports：dailyStart／noon／finish）。開工確認卡會在開工 applied 後寫一筆 0／0 的 dailyStart
  // （app.js machtileDailyStartSubmit → submitReport(0, 0, …, "dailyStart")）：那不是報工。規則跟雲端 submit 的 SWITCH_STEP_HAS_REPORTS
  // 一樣：有數量，或 report_type 不是 workStart／dailyStart／pause → 算有報工。
  const NON_REPORT_TYPES = Object.freeze(["workStart", "dailyStart", "pause"]);
  function todayReportBlocks(rows, processId) {
    const pid = text(processId);
    if (!pid || !Array.isArray(rows)) return false;
    return rows.some((row) => row && text(row.process_id) === pid
      && (Number(row.completed_qty || 0) > 0 || Number(row.defect_qty || 0) > 0 || !NON_REPORT_TYPES.includes(text(row.report_type))));
  }

  // ---------------------------------------------------------------- 現在這一道的池列鍵（p_pool_item_id）
  // 先用 machtile_held_pool_claims()（returnClaimCore.heldPoolKey 算好的 heldKey；但那支 RPC 只回「工序還是 pending」的接單，
  // 已開工的多半查不到）；查不到再看這台這張單的 station_commands 歷史（applied 的 claim_next／return_claim／switch_step）：
  // 這一道最後一件事是「接到」（claim_next，或換道次換進來而且雲端記了接單）就用那個鍵；最後一件事是「放掉」或什麼都沒有＝空字串
  // （送 null＝當成生管設定的；伺服器若發現它其實是從池裡接的，回 POOL_ITEM_REQUIRED → 叫他找生管）。不猜。
  function historyPoolKey({ rows, machineCode, orderNo, step } = {}) {
    const code = normCode(machineCode);
    const order = text(orderNo);
    const index = positiveInt(step);
    if (!Array.isArray(rows) || !code || !order || index === null) return "";
    const events = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || text(row.status) !== "applied") continue;
      if (normCode(row.machine_code) !== code || text(row.expected_order_no) !== order) continue;
      const at = Date.parse(row.requested_at);
      if (!Number.isFinite(at)) continue;
      const type = text(row.command_type);
      const from = positiveInt(row.expected_index_sn);
      if ((type === "return_claim" || type === "switch_step") && from === index) events.push({ at, key: "" });
      if (type === "claim_next" && from === index) events.push({ at, key: validKey(row.pool_item_id) });
      if (type === "switch_step") {
        const snap = snapshotOf(row);
        const info = snap.switch_step && typeof snap.switch_step === "object" ? snap.switch_step : {};
        const finalize = snap.cloud_finalize && typeof snap.cloud_finalize === "object" ? snap.cloud_finalize : {};
        // 換進來的那一道：雲端有記一筆接單（target_claim_id）才算「從池裡接的」
        if (positiveInt(info.to_index_sn) === index && finalize.target_claim_id) events.push({ at: at + 1, key: validKey(info.target_pool_item_id) });
      }
    }
    if (!events.length) return "";
    events.sort((a, b) => a.at - b.at);
    return events[events.length - 1].key;
  }
  function sourcePoolKey({ heldKey, historyRows, machineCode, orderNo, step } = {}) {
    const held = validKey(heldKey);
    if (held) return { key: held, source: "held" };
    const fromHistory = historyPoolKey({ rows: historyRows, machineCode, orderNo, step });
    return fromHistory ? { key: fromHistory, source: "history" } : { key: "", source: "none" };
  }

  // ---------------------------------------------------------------- 目標清單
  // 同一張工單、不是現在這一道、沒做完、沒有掛在別台。在待做池（waiting）的標「待做池」；不在池裡的只有 allowUnpooled 才列。
  // machine＝{ machineCode, departmentCode }：池列要同課、而且這台在可做機台清單裡（機台忙不忙不看：換道次時它本來就在做）。
  // processes＝雲端 work_order_processes（這張單的每一道；processesReady＝這次有讀到）。讀不到時只列池裡的（伺服器會再驗）。
  function targetEligible(item, machine) {
    const code = normCode(machine && machine.machineCode);
    const department = text(machine && machine.departmentCode);
    if (!code || !department || !item) return false;
    if (item.status !== undefined && item.status !== null && text(item.status) !== "waiting") return false;
    if (text(item.department_code) !== department) return false;
    return (Array.isArray(item.eligible_machine_codes) ? item.eligible_machine_codes : []).map(normCode).includes(code);
  }
  function startedTargets({ orderNo, currentStep, poolReady, poolItems, processesReady, processes, machine, allowUnpooled } = {}) {
    const order = text(orderNo);
    const current = positiveInt(currentStep);
    const code = normCode(machine && machine.machineCode);
    const unpooledOn = allowUnpooled === true;
    const ready = (poolReady === true && Array.isArray(poolItems)) || (unpooledOn && processesReady === true && Array.isArray(processes));
    const result = { ready, choices: [], notEligible: 0 };
    if (!ready || !order || current === null || !code) return result;
    // 雲端各道的狀態：同一道有任何一列做完＝做完；任何一列掛在別台而且還在站上＝在別台
    const steps = new Map();
    if (processesReady === true && Array.isArray(processes)) {
      for (const row of processes) {
        const step = positiveInt(row && row.process_order);
        if (step === null) continue;
        const info = steps.get(step) || { closed: false, elsewhere: false, name: "" };
        if (STARTED_CLOSED_STEP.includes(text(row.status))) info.closed = true;
        const on = normCode(row.machines && row.machines.machine_code);
        if (!row.off_station_at && on && on !== code) info.elsewhere = true;
        if (!info.name) info.name = text(row.process_name);
        steps.set(step, info);
      }
    }
    const blocked = (step) => { const info = steps.get(step); return Boolean(info && (info.closed || info.elsewhere)); };
    const pooledSteps = new Set();
    const seen = new Set();
    if (poolReady === true && Array.isArray(poolItems)) {
      for (const item of poolItems) {
        if (!item || text(item.work_order_no) !== order) continue;
        const sourceKey = validKey(item.source_key);
        const step = positiveInt(item.process_order);
        if (!sourceKey || step === null || step === current || seen.has(sourceKey)) continue;
        seen.add(sourceKey);
        if (!targetEligible(item, machine)) { result.notEligible += 1; continue; }
        pooledSteps.add(step);
        if (blocked(step)) continue;
        result.choices.push({ id: sourceKey, step, sourceKey, pooled: true, name: text(item.operation_name), quantity: positiveInt(item.quantity) });
      }
    }
    if (unpooledOn && processesReady === true && Array.isArray(processes)) {
      for (const [step, info] of steps) {
        if (step === current || pooledSteps.has(step) || info.closed || info.elsewhere) continue;
        result.choices.push({ id: `step:${step}`, step, sourceKey: "", pooled: false, name: info.name, quantity: null });
      }
    }
    result.choices.sort((a, b) => a.step - b.step || a.id.localeCompare(b.id));
    return result;
  }

  // ---------------------------------------------------------------- 送出參數（九個鍵、名稱逐字）
  function startedReasonCheck(role, reason) {
    const value = text(reason);
    if (value.length > STARTED_REASON_MAX) return { ok: false, messageKey: "switch_step_started_reason_too_long", value };
    if (startedNeedsReason(role) && !value) return { ok: false, messageKey: "switch_step_started_reason_required", value };
    return { ok: true, messageKey: "", value };
  }
  function startedBuildArgs({ commandUuid, machineCode, poolItemId, orderNo, step, targetStep, targetPoolItemId, partNo, reason, role } = {}) {
    if (!isUuid(commandUuid)) throw new Error("BAD_COMMAND_UUID");
    const code = normCode(machineCode);
    if (!code || code.length > 30) throw new Error("NO_MACHINE");
    const pool = text(poolItemId);
    if (pool && !validKey(pool)) throw new Error("BAD_POOL_ITEM_ID");
    const order = text(orderNo);
    if (!order || order.length > 100) throw new Error("NO_ORDER");
    const index = positiveInt(step);
    if (index === null) throw new Error("NO_STEP");
    const target = positiveInt(targetStep);
    if (target === null) throw new Error("NO_TARGET_STEP");
    if (target === index) throw new Error("SAME_STEP");
    const targetPool = text(targetPoolItemId);
    if (targetPool && (!validKey(targetPool) || targetPool === pool)) throw new Error("BAD_TARGET_POOL_ITEM_ID");
    if (!STARTED_ROLES.includes(normRole(role))) throw new Error("BAD_ROLE");
    const checked = startedReasonCheck(role, reason);
    if (!checked.ok) throw new Error(checked.messageKey === "switch_step_started_reason_required" ? "REASON_REQUIRED" : "REASON_TOO_LONG");
    const part = text(partNo);
    return {
      p_command_uuid: commandUuid,
      p_machine_code: code,
      // 生管設定的（不是從池裡接的）＝null
      p_pool_item_id: pool || null,
      p_expected_order_no: order,
      p_expected_index_sn: index,
      p_target_index_sn: target,
      // 目標不在池裡＝null
      p_target_pool_item_id: targetPool || null,
      p_expected_part_no: part && part.length <= 200 ? part : null,
      // 作業員不填 → null，伺服器存 operator_switch_step；管理員／生管必填
      p_reason: checked.value || null,
    };
  }

  // ---------------------------------------------------------------- 拒絕碼 → 一句白話（i18n key）
  // 雲端 submit 的 raise（machtile_submit_switch_step_command）＋工廠套用端的 reject_code（StationSwitchStepApplier.cs、
  // StationSwitchStepRules.ValidateShape、StationCommandProcessor／Poller）共用一張表。畫面絕不顯示代碼本身。
  const STARTED_REJECT_MESSAGE_KEY = Object.freeze({
    // ---- 雲端 submit
    AUTH_REQUIRED: "switch_step_started_err_login",
    OPERATOR_REQUIRED: "switch_step_started_err_role",
    APPLIER_CANNOT_SUBMIT: "switch_step_started_err_role",
    TENANT_INACTIVE: "switch_step_started_err_account",
    APP_USER_REQUIRED: "switch_step_started_err_account",
    OPERATOR_LEGACY_ID_MISSING: "switch_step_started_err_account",
    OPERATOR_LEGACY_ID_INVALID: "switch_step_started_err_account",
    ADMIN_LEGACY_ID_MISSING: "switch_step_started_err_account",
    FORBIDDEN: "switch_step_started_err_account",
    ADMIN_SUBMIT_DISABLED: "switch_step_started_err_admin_disabled",
    COMMAND_UUID_REQUIRED: "switch_step_started_err_card_data",
    INVALID_MACHINE_CODE: "switch_step_started_err_card_data",
    INVALID_POOL_ITEM_ID: "switch_step_started_err_card_data",
    INVALID_TARGET_POOL_ITEM_ID: "switch_step_started_err_card_data",
    INVALID_TARGET_STEP: "switch_step_started_err_card_data",
    SAME_STEP: "switch_step_started_err_card_data",
    TARGET_STEP_MISMATCH: "switch_step_started_err_card_data",
    TARGET_NOT_SAME_WORK_ORDER: "switch_step_started_err_card_data",
    COMMAND_UUID_CONFLICT: "switch_step_started_err_conflict",
    SWITCH_STEP_DISABLED: "switch_step_started_err_not_open",
    STALE: "switch_step_started_err_stale",
    SWITCH_REASON_REQUIRED: "switch_step_started_reason_required",
    INVALID_SWITCH_REASON: "switch_step_started_reason_too_long",
    MACHINE_NOT_ALLOWED: "switch_step_started_err_machine_not_allowed",
    NOT_CLAIM_OWNER: "switch_step_started_err_not_owner",
    CLAIM_NOT_APPLIED: "switch_step_started_err_claim_not_applied",
    ACTIVE_CLAIM_NOT_FOUND: "switch_step_started_err_no_pool_record",
    POOL_ITEM_REQUIRED: "switch_step_started_err_no_pool_record",
    POOL_ITEM_AMBIGUOUS: "switch_step_started_err_no_pool_record",   // 沒送池列鍵、帳本裡這台這一道有不只一筆（雲端 95129ab6）
    SWITCH_STEP_HAS_REPORTS: "switch_step_started_err_reported",
    HAS_REPORTS: "switch_step_started_err_reported",
    SOURCE_STEP_NOT_SWITCHABLE: "switch_step_started_err_source_state",
    TARGET_POOL_ITEM_NOT_FOUND: "switch_step_started_err_target_gone",
    TARGET_STEP_NOT_FOUND: "switch_step_started_err_target_gone",
    TARGET_TAKEN: "switch_step_started_err_target_taken",
    TARGET_NOT_ELIGIBLE: "switch_step_started_err_target_not_here",
    TARGET_STEP_CLOSED: "switch_step_started_err_target_closed",
    MACHINE_COMMAND_IN_FLIGHT: "switch_step_started_err_busy",
    // ---- 工廠套用端
    FACTORY_SWITCH_DISABLED: "switch_step_started_err_not_open",
    UNSUPPORTED_STATION: "switch_step_started_err_not_open",
    STATION_NOT_ENABLED: "switch_step_started_err_not_open",
    COMMAND_INVALID: "switch_step_started_err_not_open",   // 工廠旗標關＝當成不認得的指令種類（同 return_claim）
    OPERATOR_UNKNOWN: "switch_step_started_err_account",
    POOL_ITEM_NOT_FOUND: "switch_step_started_err_no_pool_record",
    SWITCH_STEP_STARTED_BEFORE_CLAIM: "switch_step_started_err_before_claim",
    SWITCH_STEP_NOT_OPERATOR: "switch_step_started_err_not_operator",
    SWITCH_STEP_STATE_UNSUPPORTED: "switch_step_started_err_state",
    SWITCH_STEP_TARGET_TAKEN: "switch_step_started_err_target_taken",
    SWITCH_STEP_TARGET_NOT_HERE: "switch_step_started_err_target_not_here",
    SWITCH_STEP_TARGET_CLOSED: "switch_step_started_err_target_closed",
    SWITCH_STEP_TARGET_NOT_POOLED: "switch_step_started_err_target_not_pooled",
    SWITCH_STEP_SOURCE_NOT_POOLED: "switch_step_started_err_source_not_pooled",
    LEGACY_STATE_INCONSISTENT: "switch_step_started_err_inconsistent",
    LOCK_TIMEOUT: "switch_step_started_err_busy_retry",
    INTERNAL_ERROR: "switch_step_started_err_internal_retry",
    LEDGER_CONFLICT: "switch_step_started_err_factory_problem",
    WRITE_TARGET_DENIED: "switch_step_started_err_factory_problem",
    STALE_COMMAND: "switch_step_started_err_expired",
    EXPIRED: "switch_step_started_err_expired",
    // 結果不確定：不可以說「沒有換」
    OUTCOME_UNKNOWN: "switch_step_started_unsure",
    LEGACY_APPLIED_LATE: "switch_step_started_unsure",
    MANUAL_RELEASED: "switch_step_started_err_released",
  });
  const STARTED_GENERIC_MESSAGE_KEY = "switch_step_started_err_generic";
  const STARTED_UNCERTAIN_CODES = Object.freeze(["OUTCOME_UNKNOWN", "LEGACY_APPLIED_LATE", "MANUAL_RELEASED"]);
  // 只有這幾個「等一下再按」有機會成功
  const STARTED_RETRY_LATER_CODES = Object.freeze(["CLAIM_NOT_APPLIED", "MACHINE_COMMAND_IN_FLIGHT", "STALE_COMMAND", "EXPIRED", "LOCK_TIMEOUT", "INTERNAL_ERROR"]);

  function startedRejectInfo(code) {
    const key = normCode(code);
    const known = Object.prototype.hasOwnProperty.call(STARTED_REJECT_MESSAGE_KEY, key);
    return { code: key, known, messageKey: known ? STARTED_REJECT_MESSAGE_KEY[key] : STARTED_GENERIC_MESSAGE_KEY,
      uncertain: STARTED_UNCERTAIN_CODES.includes(key), retryLater: known && STARTED_RETRY_LATER_CODES.includes(key) };
  }

  // 送出失敗：base＝returnClaimCore.submitErrorInfo(error) 的 { kind, code }（同一套 missing／uncertain／rejected 判斷），換成這裡的文字。
  // error＝原本的錯誤（可省略）：只用來從 TARGET_TAKEN 的 DETAIL 拿機台代號。
  function startedSubmitErrorInfo(base, error) {
    const kind = text(base && base.kind);
    const code = normCode(base && base.code);
    if (kind === "missing") return { kind, code: "", messageKey: "switch_step_started_err_not_open", params: {} };
    if (kind === "uncertain") return { kind, code, messageKey: "switch_step_started_uncertain", params: {} };
    if (code === "AUTH_REQUIRED" || (!code && text(base && base.messageKey) === "return_claim_err_login")) return { kind: "rejected", code, messageKey: "switch_step_started_err_login", params: {} };
    if (code === "TARGET_TAKEN") {
      const machine = takenMachineOf(error);
      if (machine) return { kind: "rejected", code, messageKey: "switch_step_started_err_target_taken_on", params: { machine } };
    }
    return { kind: "rejected", code, messageKey: startedRejectInfo(code).messageKey, params: {} };
  }

  // 雲端 submit：raise exception 'TARGET_TAKEN' using detail=jsonb_build_object('claimed_machine_code',v_taken)::text
  // → supabaseFetch 的錯誤訊息＝`400 {"code":"P0001","details":"{\"claimed_machine_code\": \"A04\"}","hint":null,"message":"TARGET_TAKEN"}`。
  // details 是一段 JSON 文字；拆不出來、是 null、或不像機台代號＝空字串（照原本那一句，不猜）。
  function takenMachineOf(error) {
    const msg = String((error && error.message) || error || "");
    const start = msg.indexOf("{");
    if (start < 0) return "";
    try {
      const body = JSON.parse(msg.slice(start));
      if (!body || normCode(body.message) !== "TARGET_TAKEN" || typeof body.details !== "string") return "";
      const detail = JSON.parse(body.details);
      const machine = normCode(detail && typeof detail === "object" ? detail.claimed_machine_code : "");
      return /^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(machine) ? machine : "";
    } catch { return ""; }
  }

  // ---------------------------------------------------------------- 伺服器那一列 → 畫面狀態
  function snapshotOf(row) {
    const raw = row && row.legacy_snapshot;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
    if (typeof raw !== "string" || !raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }
  // 合約 r2（CONTRACT-r2.md）：legacy_snapshot.switch_step = { mode, source_pool_status, target_pool_status, moved_qty, source_unpooled, ... }
  function appliedInfo(row) {
    const snap = snapshotOf(row);
    const info = snap.switch_step && typeof snap.switch_step === "object" && !Array.isArray(snap.switch_step) ? snap.switch_step : {};
    const sourcePool = text(info.source_pool_status).toLowerCase();
    return {
      mode: text(info.mode),
      from: positiveInt(info.from_index_sn) ?? positiveInt(row && row.expected_index_sn),
      to: positiveInt(info.to_index_sn),
      orderNo: text(info.order_no) || text(row && row.expected_order_no),
      machineCode: normCode(info.station) || normCode(row && row.machine_code),
      sourcePoolStatus: sourcePool,
      targetPoolStatus: text(info.target_pool_status).toLowerCase(),
      // 只認嚴格的 true（合約：舊道次換完後不在任何機台、也不在待做池）
      sourceUnpooled: info.source_unpooled === true,
      returnedToPool: ["returned", "pending"].includes(sourcePool),
    };
  }

  // known＝{ from, to }：送出時記下的（輪詢的 select 不含 target_index_sn；applied 時以快照為準）
  function startedResultView(row, known = {}) {
    const status = text(row && row.status).toLowerCase();
    const params = { from: positiveInt(known.from) ?? positiveInt(row && row.expected_index_sn), to: positiveInt(known.to) };
    const base = { switchStarted: true, status, mode: "", code: "", sourceUnpooled: false, params };
    if (status === "applied") {
      const info = appliedInfo(row);
      const view = { ...base, phase: "applied", terminal: true, tone: "ok", mode: info.mode, sourceUnpooled: info.sourceUnpooled,
        params: { from: info.from ?? params.from, to: info.to ?? params.to, order: info.orderNo },
        messageKey: info.returnedToPool && !info.sourceUnpooled ? "switch_step_started_done" : "switch_step_started_done_plain" };
      if (info.sourceUnpooled) view.noticeKey = "switch_step_started_unpooled_notice";
      return view;
    }
    if (status === "rejected") {
      const info = startedRejectInfo(row.reject_code);
      return { ...base, phase: "rejected", terminal: true, tone: info.uncertain ? "warn" : "bad", code: info.code, messageKey: info.messageKey };
    }
    if (status === "expired") return { ...base, phase: "expired", terminal: true, tone: "warn", code: "EXPIRED", messageKey: STARTED_REJECT_MESSAGE_KEY.EXPIRED };
    if (status === "claimed") return { ...base, phase: "pending", terminal: false, tone: "wait", messageKey: "switch_step_started_processing" };
    return { ...base, phase: "pending", status: "pending", terminal: false, tone: "wait", messageKey: "switch_step_started_waiting" };
  }
  function startedIsUnsure(view) {
    return Boolean(view) && view.phase === "rejected" && STARTED_UNCERTAIN_CODES.includes(text(view.code));
  }

  // ---------------------------------------------------------------- 「第 N 道不在任何機台、也不在待做池」提醒
  // rows＝station_commands（applied 的 switch_step）。只有快照 source_unpooled===true 才算。dismissed＝這台平板按過「已安排」的 command_uuid。
  function unpooledNotices({ rows, nowMs, role, dismissed } = {}) {
    const keep = startedNeedsReason(role) ? UNPOOLED_NOTICE_ADMIN_MS : UNPOOLED_NOTICE_OPERATOR_MS;
    const hidden = dismissed instanceof Set ? dismissed : new Set(Array.isArray(dismissed) ? dismissed : []);
    const out = [];
    const seen = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || text(row.command_type) !== STARTED_COMMAND_TYPE || text(row.status) !== "applied") continue;
      const uuid = text(row.command_uuid).toLowerCase();
      if (!isUuid(uuid) || seen.has(uuid) || hidden.has(uuid)) continue;
      const info = appliedInfo(row);
      if (!info.sourceUnpooled) continue;
      const at = Date.parse(row.applied_at || row.requested_at);
      const age = Number(nowMs) - at;
      if (!Number.isFinite(at) || !(age >= -5 * 60 * 1000) || age > keep) continue;
      seen.add(uuid);
      out.push({ commandUuid: uuid, machineCode: info.machineCode, orderNo: info.orderNo, from: info.from, to: info.to, at });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  // ---------------------------------------------------------------- 等結果中的紀錄（重新整理後也記得；只屬於送出的那個人）
  function startedPendingRecord(rec = {}) {
    const args = {};
    STARTED_ARG_KEYS.forEach((key) => { args[key] = rec.args && rec.args[key] !== undefined ? rec.args[key] : null; });
    return {
      commandUuid: text(rec.commandUuid),
      machineCode: normCode(rec.machineCode),
      orderNo: text(rec.orderNo),
      step: positiveInt(rec.step),
      targetStep: positiveInt(rec.targetStep),
      processId: isUuid(rec.processId) ? String(rec.processId) : "",
      tenantId: text(rec.tenantId),
      appUserId: text(rec.appUserId),
      args,
      startedAt: Number(rec.startedAt) || Date.now(),
      unconfirmed: rec.unconfirmed === true,
      notFound: rec.notFound === true,
      lastStatus: ["pending", "claimed"].includes(String(rec.lastStatus || "")) ? String(rec.lastStatus) : null,
    };
  }
  function startedSameSession(rec, session) {
    const tenantId = text(session && session.tenantId);
    const appUserId = text(session && session.appUserId);
    return Boolean(rec) && tenantId !== "" && appUserId !== "" && text(rec.tenantId) === tenantId && text(rec.appUserId) === appUserId;
  }
  function startedRestoreAll(raw, nowMs) {
    let obj = raw;
    if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { return {}; } }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out = {};
    Object.keys(obj).forEach((code) => {
      const rec = obj[code];
      if (!rec || !isUuid(rec.commandUuid) || !rec.args || rec.args.p_command_uuid !== rec.commandUuid) return;
      if (Number(nowMs) - Number(rec.startedAt) > STARTED_PENDING_KEEP_MS) return;
      if (normCode(rec.args.p_machine_code) !== normCode(code)) return;
      if (positiveInt(rec.args.p_target_index_sn) === null) return;
      out[normCode(code)] = startedPendingRecord(rec);
    });
    return out;
  }
  function startedRestoreForSession(raw, nowMs, session) {
    const all = startedRestoreAll(raw, nowMs);
    const out = {};
    Object.keys(all).forEach((code) => { if (startedSameSession(all[code], session)) out[code] = all[code]; });
    return out;
  }
  function startedMergeForSave(raw, own, nowMs, session) {
    const all = startedRestoreAll(raw, nowMs);
    const out = {};
    Object.keys(all).forEach((code) => { if (!startedSameSession(all[code], session)) out[code] = all[code]; });
    Object.keys(own || {}).forEach((code) => { out[normCode(code)] = own[code]; });
    return out;
  }
  // 這筆紀錄是不是卡片現在這張單這一道（不是＝只說「這台有一筆換道次在處理」，不給重送）
  function startedRecordMatchesOrder(rec, order) {
    return Boolean(rec) && Boolean(order) && text(rec.orderNo) !== "" && text(rec.orderNo) === text(order.id)
      && positiveInt(rec.step) !== null && positiveInt(rec.step) === positiveInt(order.stationStep);
  }
  // 鎖不鎖這台（開工／報工／完工／選工單／批次）：查了幾次都查不到（notFound）＝沒送到，不鎖；
  // released＝本機等超過解鎖時間而且最後看到的不是 claimed。
  function startedLocks(record, released) {
    if (!record) return false;
    if (record.notFound === true) return false;
    if (released === true && record.lastStatus !== "claimed") return false;
    return true;
  }
  // 最後一次結果在卡片上留多久：成功 2 分鐘（有「不在待做池」提醒的另外顯示，不靠這個）；沒成功 10 分鐘而且卡片還是同一張單同一道。
  function startedLastResultVisible(last, { orderNo, step, nowMs } = {}) {
    if (!last || !last.view) return false;
    const age = Number(nowMs) - Number(last.at);
    if (!(age >= 0)) return false;
    if (last.view.phase === "applied") return age <= 2 * 60 * 1000;
    return age <= 10 * 60 * 1000 && text(last.orderNo) === text(orderNo) && Number(last.step) === Number(step);
  }
  // 結果不確定（OUTCOME_UNKNOWN 等）之後：同一張單同一道 10 分鐘內不再出按鈕（不重複送；請他重新整理看這台掛第幾道）
  function startedUnsureHold(last, { orderNo, step, nowMs } = {}) {
    if (!last || !startedIsUnsure(last.view)) return false;
    const age = Number(nowMs) - Number(last.at);
    return age >= 0 && age <= STARTED_UNSURE_HOLD_MS && text(last.orderNo) === text(orderNo) && Number(last.step) === Number(step);
  }

  // ================================================================ 第 3 階段：換道次＋已報數量一起搬（DESIGN 20261114-1545 §7；合約 r3）
  // 已經報過工的道次（掛錯道次又報了工）→ 先預覽（switch_step_preview：工廠整套跑完一定回滾，回「會搬多少、目標道會變怎樣、擋不擋」）
  // → 確認卡（良／不良、筆數、目標道、數量規則；第一道超工單量要勾選）→ 送 switch_step（帶 expected_moved_good／fail）→ 輪詢。
  // 狀態：choosing → previewing → confirming → submitting → done｜rejected｜unsure（另有 preview_blocked／preview_failed／uncertain）。
  // 旗標：config.enableSwitchStepMove（預設 false）＋機台名單 config.switchStepMoveMachines（預設 []），跟第 1／2 階段分開。
  //
  // ---- 合約欄位全部集中在 MOVE_CONTRACT 與下面三個 move*Adapter 函式（其他地方一律不寫欄位名稱）。
  //   工廠 CONTRACT-r3.md（2026-11-14 16:29）：指令欄 expected_moved_good／expected_moved_fail（兩個都非 NULL＝搬數量；兩個都 NULL＝第 2 階段）、
  //   acks 只允許 ["EXCEEDS_ORDER_QTY"]；預覽 command_type＝switch_step_preview、status＝previewed、結果在 preview_result.switch_step_preview；
  //   applied 快照 legacy_snapshot.switch_step 多 contract/moved_good/moved_fail/moved_report_uuids/correction_ids/target_change_log；
  //   rejected 快照 legacy_snapshot.switch_step_rejected.move.block_code。
  //   雲端 RPC 參數（p_expected_moved_good／p_expected_moved_fail integer、p_acks text[]、p_preview boolean，都有預設值）：跟雲端
  //   wt-phase3-cloud 20261114160000_station_switch_step_move.sql（尚未合併）的 machtile_submit_switch_step_command 一致；改名只改 moveAdapterArgs。
  const MOVE_CONTRACT = Object.freeze({
    submitRpc: STARTED_SUBMIT_RPC,                 // 同一支 submit RPC（假設：多四個有預設值的參數）
    commandType: "switch_step",
    previewCommandType: "switch_step_preview",
    previewedStatus: "previewed",
    previewResultKey: "switch_step_preview",       // preview_result.<key>
    appliedSnapshotKey: "switch_step",             // legacy_snapshot.<key>
    rejectedSnapshotKey: "switch_step_rejected",   // legacy_snapshot.<key>.move.block_code
    overrunAck: "EXCEEDS_ORDER_QTY",
    extraArgKeys: Object.freeze(["p_expected_moved_good", "p_expected_moved_fail", "p_acks", "p_preview"]),
  });
  const MOVE_ARG_KEYS = Object.freeze([...STARTED_ARG_KEYS, ...MOVE_CONTRACT.extraArgKeys]);
  const MOVE_QTY_MAX = 100000;   // 合約 §0：良＋不良 > 100000 → COMMAND_INVALID
  // 預覽送出後最多等多久（只是算，不改東西；等不到＝請他再看一次）
  // Factory move transactions may legitimately take close to 120 seconds. Keep the
  // HTTP request alive beyond that ceiling, and never declare a preview timed out
  // before the contract's ~120-second UI window has elapsed.
  const MOVE_SUBMIT_TIMEOUT_MS = 130 * 1000;
  const MOVE_PREVIEW_WAIT_MS = 120 * 1000;
  const MOVE_TRANSITIONS = Object.freeze({
    choosing: Object.freeze({ preview: "previewing", cancel: "closed" }),
    previewing: Object.freeze({ preview_ok: "confirming", preview_blocked: "preview_blocked", preview_failed: "preview_failed", repick: "choosing", cancel: "closed" }),
    confirming: Object.freeze({ submit: "submitting", repick: "choosing", cancel: "closed" }),
    preview_blocked: Object.freeze({ repick: "choosing", preview: "previewing", cancel: "closed" }),
    preview_failed: Object.freeze({ repick: "choosing", preview: "previewing", cancel: "closed" }),
    submitting: Object.freeze({ sent: "status", applied: "done", rejected: "rejected", unsure: "unsure", uncertain: "uncertain" }),
    uncertain: Object.freeze({ resend: "submitting", sent: "status", applied: "done", rejected: "rejected", unsure: "unsure", cancel: "closed" }),
    status: Object.freeze({ applied: "done", rejected: "rejected", unsure: "unsure", cancel: "closed" }),
  });
  function moveNext(state, event) {
    const row = Object.prototype.hasOwnProperty.call(MOVE_TRANSITIONS, state) ? MOVE_TRANSITIONS[state] : null;
    return row && Object.prototype.hasOwnProperty.call(row, event) ? row[event] : null;
  }
  const nonNegInt = (value) => {
    const n = Number(value);
    return value !== null && value !== "" && value !== undefined && typeof value !== "boolean" && Number.isInteger(n) && n >= 0 ? n : null;
  };

  function moveEnabled({ flag } = {}) { return flag === true; }

  // ---------------------------------------------------------------- 卡片要不要出現「換道次（數量一起搬）」
  // 跟第 2 階段同一套條件，只差數量：第 2 階段要 0 件；這一顆要「已經有報工」（卡片完成數 > 0，或今天有報工列）。兩顆不會同時出現。
  function moveVisibility({ enabled: on, role, isBridge, cardDetailsReady, isUnassignedBucket, multiStation, machineCode, order, hasTodayReport,
    commandInFlight, unsureHold, machineAllowed } = {}) {
    const no = (reason) => ({ show: false, reason, needsReason: false });
    if (on !== true) return no("flag_off");
    if (!startedRoleAllowed(role, isBridge)) return no("role");
    if (isUnassignedBucket === true) return no("no_machine");
    const code = normCode(machineCode);
    if (!code || code.length > 30) return no("no_machine");
    if (machineAllowed !== true) return no("machine_not_listed");
    if (multiStation === true) return no("multi_station");
    if (!order) return no("no_order");
    if (order.offStation === true) return no("off_station");
    const orderNo = text(order.id);
    if (!orderNo || orderNo.length > 100) return no("no_order_no");
    if (positiveInt(order.stationStep) === null) return no("no_step");
    if (!isUuid(order.processId)) return no("no_process");
    if (cardDetailsReady !== true) return no("card_not_ready");
    const done = Number(order.done);
    if (!((Number.isFinite(done) && done > 0) || hasTodayReport === true)) return no("no_reports");
    // 報過工＝開過工；雲端狀態沒做完、沒待檢才給（做完／待檢＝伺服器一定擋，不出按鈕）
    if (!["pending", "running", "paused"].includes(text(order.processStatus))) return no("not_switchable");
    if (commandInFlight === true) return no("command_in_flight");
    if (unsureHold === true) return no("unsure_hold");
    return { show: true, reason: "", needsReason: startedNeedsReason(role) };
  }

  // 開確認卡時重讀這一道：跟第 2 階段一樣（還在這台、同一張單同一道、沒做完），只是不要求 0 件（雲端數量可能還沒同步，不拿它擋）。
  function moveFreshCheck({ machineCode, orderNo, step, row } = {}) {
    const checked = startedFreshCheck({ machineCode, orderNo, step, row: row ? { ...row, qty_completed: 0, qty_defect: 0 } : row });
    return checked.ok ? checked : { ok: false, reason: checked.reason, partNo: null, workOrderId: "" };
  }

  // ---------------------------------------------------------------- 送出參數（合約介面 1／3）
  // preview＝true：預覽（expected_moved_* 送 NULL＝只算）；false：真的搬（expected_moved_*＝預覽算出來、確認卡上給他看的數字）。
  function moveAdapterArgs({ preview, expectedGood, expectedFail, overrunAck, ...started } = {}) {
    const args = startedBuildArgs(started);
    if (preview === true) {
      return { ...args, p_expected_moved_good: null, p_expected_moved_fail: null, p_acks: null, p_preview: true };
    }
    const good = nonNegInt(expectedGood);
    const fail = nonNegInt(expectedFail);
    if (good === null || fail === null || good + fail > MOVE_QTY_MAX) throw new Error("BAD_EXPECTED_MOVED");
    return { ...args, p_expected_moved_good: good, p_expected_moved_fail: fail, p_acks: overrunAck === true ? [MOVE_CONTRACT.overrunAck] : null, p_preview: false };
  }

  // ---------------------------------------------------------------- 預覽結果（合約介面 2／3）
  function previewResultOf(row) {
    let raw = row && row.preview_result;
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = null; } }
    const box = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const inner = box[MOVE_CONTRACT.previewResultKey];
    return inner && typeof inner === "object" && !Array.isArray(inner) ? inner : null;
  }
  function moveAdapterPreview(row) {
    const result = previewResultOf(row);
    if (!result) return null;
    const target = result.target && typeof result.target === "object" && !Array.isArray(result.target) ? result.target : {};
    return {
      ok: result.ok === true,
      blockCode: normCode(result.block_code),
      from: positiveInt(result.from_index_sn),
      to: positiveInt(result.to_index_sn),
      orderNo: text(result.order_no),
      station: normCode(result.station),
      good: nonNegInt(result.movable_good),
      fail: nonNegInt(result.movable_fail),
      count: nonNegInt(result.report_count),
      firstStep: target.first_step === true,
      targetBefore: nonNegInt(target.reported_good_before),
      targetAfter: nonNegInt(target.reported_good_after),
      available: nonNegInt(target.available),
      orderQty: nonNegInt(target.order_qty),
      exceedsOrderQty: target.exceeds_order_qty === true,
      needsOverrunAck: target.needs_overrun_ack === true,
      willStop: result.will_stop !== false,
      planText: (Array.isArray(result.plan_text) ? result.plan_text : []).map(text).filter(Boolean).slice(0, 20),
    };
  }

  // 預覽那一列（輪詢回來的）→ 確認卡要的東西。known＝{ from, to, orderNo, machineCode }：送出時的值，回覆對不上＝看不懂（不拿它送）。
  //   phase：pending（還在算）｜ready（可以搬）｜blocked（會被擋：code）｜failed（工廠沒算到：code）｜invalid（回覆看不懂）
  function movePreviewView(row, known = {}) {
    const status = text(row && row.status).toLowerCase();
    if (status === "pending" || status === "claimed" || !status) return { phase: "pending", terminal: false, code: "" };
    if (status === "expired") return { phase: "failed", terminal: true, code: "EXPIRED" };
    if (status === "rejected") return { phase: "failed", terminal: true, code: normCode(row.reject_code) };
    if (status !== MOVE_CONTRACT.previewedStatus || text(row.command_type) !== MOVE_CONTRACT.previewCommandType) return { phase: "invalid", terminal: true, code: "" };
    const p = moveAdapterPreview(row);
    if (!p) return { phase: "invalid", terminal: true, code: "" };
    if ((p.from !== null && p.from !== positiveInt(known.from)) || (p.to !== null && p.to !== positiveInt(known.to))
      || (p.orderNo && known.orderNo && p.orderNo !== text(known.orderNo)) || (p.station && known.machineCode && p.station !== normCode(known.machineCode))) {
      return { phase: "invalid", terminal: true, code: "" };
    }
    if (!p.ok) return { phase: "blocked", terminal: true, code: p.blockCode || "SWITCH_MOVE_PLAN_REFUSED", preview: p };
    if (p.good === null || p.fail === null || p.count === null || p.good + p.fail > MOVE_QTY_MAX) return { phase: "invalid", terminal: true, code: "" };
    // 第一道補報後超過工單量：伺服器說要勾，或自己算出來超過（保守：任何一邊說要就要）
    const overrun = p.firstStep && (p.needsOverrunAck || p.exceedsOrderQty || (p.orderQty !== null && p.targetAfter !== null && p.targetAfter > p.orderQty));
    return { phase: "ready", terminal: true, code: "", preview: { ...p, needsOverrunAck: overrun }, nothing: p.good === 0 && p.fail === 0 };
  }

  // 數量規則那一行（D5）：第一道不限（超過工單量要勾）；第二道以後 ≤ 上一道良品，不會從倉庫先領。
  function moveRuleLine(preview) {
    if (!preview) return { key: "", params: {} };
    return preview.firstStep ? { key: "switch_step_move_rule_first", params: { qty: preview.orderQty ?? "—" } }
      : { key: "switch_step_move_rule_next", params: { to: preview.to ?? "—", available: preview.available ?? "—" } };
  }
  function moveTargetLine(preview) {
    if (!preview) return { key: "", params: {} };
    const params = { to: preview.to ?? "—", targetBefore: preview.targetBefore ?? "—", targetAfter: preview.targetAfter ?? "—", available: preview.available ?? "—", qty: preview.orderQty ?? "—" };
    return { key: preview.firstStep ? "switch_step_move_target_info_first" : "switch_step_move_target_info", params };
  }

  // ---------------------------------------------------------------- 拒絕碼 → 一句白話＋結尾（「沒有換，這台還是第 X 道，數字沒有變；…」）
  // reason：i18n key（switch_step_move_why_*）；tail：planner（請找生管）｜retry（請等一下再按一次）｜reload（請重新整理）｜repreview（請重新看會怎麼搬）｜login。
  // 結果不確定的碼沒有結尾（不可以說「沒有換」）。畫面絕不顯示代碼本身。
  const MOVE_REJECT = Object.freeze({
    // ---- r3 擋單碼（合約 §3）
    SWITCH_MOVE_DISABLED: ["switch_step_move_why_disabled", "planner"],
    SWITCH_MOVE_MIXED_HISTORY: ["switch_step_move_why_mixed_history", "planner"],
    SWITCH_MOVE_QTY_CHANGED: ["switch_step_move_why_qty_changed", "repreview"],
    SWITCH_MOVE_DOWNSTREAM_USED: ["switch_step_move_why_downstream_used", "planner"],
    SWITCH_MOVE_SOURCE_CLOSED: ["switch_step_move_why_source_closed", "planner"],
    SWITCH_MOVE_LAST_STEP: ["switch_step_move_why_last_step", "planner"],
    SWITCH_MOVE_STOCK_CONFIRMED: ["switch_step_move_why_stock_confirmed", "planner"],
    SWITCH_MOVE_AC01: ["switch_step_move_why_ac01", "planner"],
    SWITCH_MOVE_RESERVED: ["switch_step_move_why_reserved", "planner"],
    SWITCH_MOVE_OUTSOURCE_DOC: ["switch_step_move_why_outsource_doc", "planner"],
    SWITCH_MOVE_DEFERRED_MATERIAL: ["switch_step_move_why_deferred_material", "planner"],
    SWITCH_MOVE_AMBIGUOUS: ["switch_step_move_why_ambiguous", "planner"],
    SWITCH_MOVE_NOT_ENGINE: ["switch_step_move_why_not_engine", "planner"],
    SWITCH_MOVE_ORDER_CLOSED: ["switch_step_move_why_order_closed", "planner"],
    SWITCH_MOVE_TARGET_SHORT: ["switch_step_move_why_target_short", "planner"],
    SWITCH_MOVE_TOO_MANY_REPORTS: ["switch_step_move_why_too_many_reports", "planner"],
    SWITCH_MOVE_PLAN_REFUSED: ["switch_step_move_why_plan_refused", "planner"],
    EXCEEDS_ORDER_QTY: ["switch_step_move_why_exceeds_order_qty", "repreview"],
    QTY_EXCEEDS_AVAILABLE: ["switch_step_move_why_target_short", "planner"],
    REPORT_ENGINE_FAILED: ["switch_step_move_why_report_engine_failed", "planner"],
    INVALID_ACK: ["switch_step_move_why_card_data", "reload"],
    INVALID_EXPECTED_MOVED: ["switch_step_move_why_card_data", "reload"],   // 雲端 r3 submit：expected_moved_* 形狀不對
    TX_PROMOTION_BLOCKED: ["switch_step_move_why_factory_problem", "planner"],
    // ---- 雲端 submit（第 2 階段的碼；搬數量時一樣會出現）
    AUTH_REQUIRED: ["switch_step_move_why_login", "login"],
    OPERATOR_REQUIRED: ["switch_step_move_why_role", "planner"],
    APPLIER_CANNOT_SUBMIT: ["switch_step_move_why_role", "planner"],
    TENANT_INACTIVE: ["switch_step_move_why_account", "planner"],
    APP_USER_REQUIRED: ["switch_step_move_why_account", "planner"],
    OPERATOR_LEGACY_ID_MISSING: ["switch_step_move_why_account", "planner"],
    OPERATOR_LEGACY_ID_INVALID: ["switch_step_move_why_account", "planner"],
    ADMIN_LEGACY_ID_MISSING: ["switch_step_move_why_account", "planner"],
    FORBIDDEN: ["switch_step_move_why_account", "planner"],
    ADMIN_SUBMIT_DISABLED: ["switch_step_move_why_admin_disabled", "planner"],
    COMMAND_UUID_REQUIRED: ["switch_step_move_why_card_data", "reload"],
    INVALID_MACHINE_CODE: ["switch_step_move_why_card_data", "reload"],
    INVALID_POOL_ITEM_ID: ["switch_step_move_why_card_data", "reload"],
    INVALID_TARGET_POOL_ITEM_ID: ["switch_step_move_why_card_data", "reload"],
    INVALID_TARGET_STEP: ["switch_step_move_why_card_data", "reload"],
    SAME_STEP: ["switch_step_move_why_card_data", "reload"],
    TARGET_STEP_MISMATCH: ["switch_step_move_why_card_data", "reload"],
    TARGET_NOT_SAME_WORK_ORDER: ["switch_step_move_why_card_data", "reload"],
    COMMAND_UUID_CONFLICT: ["switch_step_move_why_conflict", "reload"],
    SWITCH_STEP_DISABLED: ["switch_step_move_why_not_open", "planner"],
    STALE: ["switch_step_move_why_stale", "reload"],
    SWITCH_REASON_REQUIRED: ["switch_step_move_why_reason_required", "reload"],
    INVALID_SWITCH_REASON: ["switch_step_move_why_reason_required", "reload"],
    MACHINE_NOT_ALLOWED: ["switch_step_move_why_machine_not_allowed", "planner"],
    NOT_CLAIM_OWNER: ["switch_step_move_why_not_owner", "planner"],
    CLAIM_NOT_APPLIED: ["switch_step_move_why_claim_not_applied", "retry"],
    ACTIVE_CLAIM_NOT_FOUND: ["switch_step_move_why_no_pool_record", "planner"],
    POOL_ITEM_REQUIRED: ["switch_step_move_why_no_pool_record", "planner"],
    POOL_ITEM_AMBIGUOUS: ["switch_step_move_why_no_pool_record", "planner"],
    SWITCH_STEP_HAS_REPORTS: ["switch_step_move_why_has_reports", "planner"],   // 雲端「數量一起搬」還沒開（旗標關＝跟今天一樣擋有報工的）
    HAS_REPORTS: ["switch_step_move_why_has_reports", "planner"],
    SOURCE_STEP_NOT_SWITCHABLE: ["switch_step_move_why_source_state", "planner"],
    TARGET_POOL_ITEM_NOT_FOUND: ["switch_step_move_why_target_gone", "reload"],
    TARGET_STEP_NOT_FOUND: ["switch_step_move_why_target_gone", "reload"],
    TARGET_TAKEN: ["switch_step_move_why_target_taken", "planner"],
    TARGET_NOT_ELIGIBLE: ["switch_step_move_why_target_not_here", "planner"],
    TARGET_STEP_CLOSED: ["switch_step_move_why_target_closed", "planner"],
    MACHINE_COMMAND_IN_FLIGHT: ["switch_step_move_why_busy", "retry"],
    // ---- 工廠套用端（第 2 階段的碼）
    FACTORY_SWITCH_DISABLED: ["switch_step_move_why_not_open", "planner"],
    UNSUPPORTED_STATION: ["switch_step_move_why_not_open", "planner"],
    STATION_NOT_ENABLED: ["switch_step_move_why_not_open", "planner"],
    COMMAND_INVALID: ["switch_step_move_why_not_open", "planner"],
    OPERATOR_UNKNOWN: ["switch_step_move_why_account", "planner"],
    POOL_ITEM_NOT_FOUND: ["switch_step_move_why_no_pool_record", "planner"],
    SWITCH_STEP_STARTED_BEFORE_CLAIM: ["switch_step_move_why_before_claim", "planner"],
    SWITCH_STEP_NOT_OPERATOR: ["switch_step_move_why_not_operator", "planner"],
    SWITCH_STEP_STATE_UNSUPPORTED: ["switch_step_move_why_state", "planner"],
    SWITCH_STEP_TARGET_TAKEN: ["switch_step_move_why_target_taken", "planner"],
    SWITCH_STEP_TARGET_NOT_HERE: ["switch_step_move_why_target_not_here", "planner"],
    SWITCH_STEP_TARGET_CLOSED: ["switch_step_move_why_target_closed", "planner"],
    SWITCH_STEP_TARGET_NOT_POOLED: ["switch_step_move_why_target_not_pooled", "planner"],
    SWITCH_STEP_SOURCE_NOT_POOLED: ["switch_step_move_why_source_not_pooled", "planner"],
    LEGACY_STATE_INCONSISTENT: ["switch_step_move_why_inconsistent", "planner"],
    LOCK_TIMEOUT: ["switch_step_move_why_factory_busy", "retry"],
    INTERNAL_ERROR: ["switch_step_move_why_internal", "retry"],
    LEDGER_CONFLICT: ["switch_step_move_why_factory_problem", "planner"],
    WRITE_TARGET_DENIED: ["switch_step_move_why_factory_problem", "planner"],
    STALE_COMMAND: ["switch_step_move_why_expired", "retry"],
    EXPIRED: ["switch_step_move_why_expired", "retry"],
  });
  const MOVE_UNCERTAIN_CODES = STARTED_UNCERTAIN_CODES;
  const MOVE_TAIL_KEYS = Object.freeze({ planner: "switch_step_move_tail_planner", retry: "switch_step_move_tail_retry", reload: "switch_step_move_tail_reload",
    repreview: "switch_step_move_tail_repreview", login: "switch_step_move_tail_login" });

  // { code, known, reasonKey, tailKey, uncertain, retryLater, repreview }；uncertain＝只說「結果不確定」（switch_step_move_unsure），沒有結尾
  function moveRejectInfo(code) {
    const key = normCode(code);
    if (MOVE_UNCERTAIN_CODES.includes(key)) {
      return { code: key, known: true, reasonKey: "switch_step_move_unsure", tailKey: "", uncertain: true, retryLater: false, repreview: false };
    }
    const known = Object.prototype.hasOwnProperty.call(MOVE_REJECT, key);
    const [reasonKey, tail] = known ? MOVE_REJECT[key] : ["switch_step_move_why_generic", "planner"];
    return { code: key, known, reasonKey, tailKey: MOVE_TAIL_KEYS[tail], uncertain: false,
      retryLater: tail === "retry", repreview: tail === "repreview" };
  }

  // 送出失敗（雲端 submit raise／網路）：base＝returnClaimCore.submitErrorInfo(error)
  function moveSubmitErrorInfo(base, error) {
    const kind = text(base && base.kind);
    const code = normCode(base && base.code);
    // RPC 不存在（雲端還沒部署）＝當成「還沒開放」
    if (kind === "missing") return { kind, code: "SWITCH_STEP_DISABLED", info: moveRejectInfo("SWITCH_STEP_DISABLED"), params: {} };
    if (kind === "uncertain") return { kind, code, info: null, params: {} };
    const effective = code || (text(base && base.messageKey) === "return_claim_err_login" ? "AUTH_REQUIRED" : "");
    const params = {};
    if (effective === "TARGET_TAKEN") { const machine = takenMachineOf(error); if (machine) params.machine = machine; }
    return { kind: "rejected", code: effective, info: moveRejectInfo(effective), params };
  }

  // ---------------------------------------------------------------- applied／rejected（合約介面 3／3）
  function moveAdapterApplied(row) {
    const snap = snapshotOf(row);
    const info = snap[MOVE_CONTRACT.appliedSnapshotKey] && typeof snap[MOVE_CONTRACT.appliedSnapshotKey] === "object" && !Array.isArray(snap[MOVE_CONTRACT.appliedSnapshotKey])
      ? snap[MOVE_CONTRACT.appliedSnapshotKey] : {};
    return { mode: text(info.mode), good: nonNegInt(info.moved_good), fail: nonNegInt(info.moved_fail), contract: text(info.contract), qtyPolicy: text(info.qty_policy) };
  }
  function moveAdapterRejectedBlock(row) {
    const snap = snapshotOf(row);
    const rejected = snap[MOVE_CONTRACT.rejectedSnapshotKey];
    const move = rejected && typeof rejected === "object" && rejected.move && typeof rejected.move === "object" ? rejected.move : {};
    return normCode(move.block_code);
  }

  // 伺服器那一列 → 畫面。known＝{ from, to, good, fail }：送出時記下的（輪詢不讀 target_index_sn；applied 以快照為準）。
  // view.lines＝[{ key, params }]：一句理由＋一句結尾（或成功那一句＋提醒）。
  function moveResultView(row, known = {}) {
    const status = text(row && row.status).toLowerCase();
    const params = { from: positiveInt(known.from) ?? positiveInt(row && row.expected_index_sn), to: positiveInt(known.to),
      good: nonNegInt(known.good) ?? 0, fail: nonNegInt(known.fail) ?? 0 };
    const base = { switchMove: true, status, mode: "", code: "", sourceUnpooled: false, params };
    if (status === "applied") {
      const step = appliedInfo(row);
      const moved = moveAdapterApplied(row);
      const p = { ...params, from: step.from ?? params.from, to: step.to ?? params.to, order: step.orderNo,
        good: moved.good ?? params.good, fail: moved.fail ?? params.fail };
      const already = moved.mode === "already_switched";
      const view = { ...base, phase: "applied", terminal: true, tone: "ok", mode: moved.mode, sourceUnpooled: step.sourceUnpooled, params: p,
        messageKey: already ? "switch_step_move_done_already" : "switch_step_move_done", lines: [{ key: already ? "switch_step_move_done_already" : "switch_step_move_done", params: p }] };
      if (step.sourceUnpooled) { view.noticeKey = "switch_step_started_unpooled_notice"; view.lines.push({ key: view.noticeKey, params: p }); }
      return view;
    }
    if (status === "rejected" || status === "expired") {
      // reject_code＝合約 §3 的碼；萬一是空的，用快照 switch_step_rejected.move.block_code（同一個碼）
      const code = status === "expired" ? "EXPIRED" : normCode(row.reject_code) || moveAdapterRejectedBlock(row);
      return { ...base, ...moveFailureView(code, params), phase: status === "expired" ? "expired" : "rejected" };
    }
    if (status === "claimed") return { ...base, phase: "pending", terminal: false, tone: "wait", messageKey: "switch_step_move_processing", lines: [{ key: "switch_step_move_processing", params }] };
    return { ...base, phase: "pending", status: "pending", terminal: false, tone: "wait", messageKey: "switch_step_move_waiting", lines: [{ key: "switch_step_move_waiting", params }] };
  }
  // 一個碼 → 失敗畫面（預覽與送出共用）
  function moveFailureView(code, params = {}) {
    const info = moveRejectInfo(code);
    const lines = [{ key: info.reasonKey, params }];
    if (info.tailKey) lines.push({ key: info.tailKey, params });
    return { phase: "rejected", terminal: true, tone: info.uncertain ? "warn" : "bad", code: info.code, messageKey: info.reasonKey, uncertain: info.uncertain,
      retryLater: info.retryLater, repreview: info.repreview, lines };
  }
  // 不是伺服器的碼、是 APP 自己的狀況（預覽送不出去／看不懂／等太久）：一句理由＋指定的結尾
  function moveMessageView(reasonKey, tail, params = {}) {
    const tailKey = MOVE_TAIL_KEYS[tail] || MOVE_TAIL_KEYS.planner;
    return { phase: "rejected", terminal: true, tone: "bad", code: "", messageKey: reasonKey, uncertain: false,
      retryLater: tail === "retry", repreview: tail === "repreview", lines: [{ key: reasonKey, params }, { key: tailKey, params }] };
  }
  function moveIsUnsure(view) { return Boolean(view) && MOVE_UNCERTAIN_CODES.includes(text(view.code)) && view.phase === "rejected"; }

  // ---------------------------------------------------------------- 等結果中的紀錄（跟第 2 階段同規則；多了 expected_moved_* 等四個參數）
  function movePendingRecord(rec = {}) {
    const base = startedPendingRecord(rec);
    const args = {};
    MOVE_ARG_KEYS.forEach((key) => { args[key] = rec.args && rec.args[key] !== undefined ? rec.args[key] : null; });
    return { ...base, args, good: nonNegInt(rec.good) ?? 0, fail: nonNegInt(rec.fail) ?? 0 };
  }
  function moveRestoreAll(raw, nowMs) {
    let obj = raw;
    if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { return {}; } }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out = {};
    Object.keys(obj).forEach((code) => {
      const rec = obj[code];
      if (!rec || !isUuid(rec.commandUuid) || !rec.args || rec.args.p_command_uuid !== rec.commandUuid) return;
      if (Number(nowMs) - Number(rec.startedAt) > STARTED_PENDING_KEEP_MS) return;
      if (normCode(rec.args.p_machine_code) !== normCode(code)) return;
      if (positiveInt(rec.args.p_target_index_sn) === null) return;
      // 只還原真的搬數量那一筆（預覽不存）
      if (rec.args.p_preview !== false || nonNegInt(rec.args.p_expected_moved_good) === null || nonNegInt(rec.args.p_expected_moved_fail) === null) return;
      out[normCode(code)] = movePendingRecord(rec);
    });
    return out;
  }
  function moveRestoreForSession(raw, nowMs, session) {
    const all = moveRestoreAll(raw, nowMs);
    const out = {};
    Object.keys(all).forEach((code) => { if (startedSameSession(all[code], session)) out[code] = all[code]; });
    return out;
  }
  function moveMergeForSave(raw, own, nowMs, session) {
    const all = moveRestoreAll(raw, nowMs);
    const out = {};
    Object.keys(all).forEach((code) => { if (!startedSameSession(all[code], session)) out[code] = all[code]; });
    Object.keys(own || {}).forEach((code) => { out[normCode(code)] = own[code]; });
    return out;
  }
  // 結果不確定之後：同一張單同一道 10 分鐘內不再出按鈕（同第 2 階段）
  function moveUnsureHold(last, { orderNo, step, nowMs } = {}) {
    if (!last || !moveIsUnsure(last.view)) return false;
    const age = Number(nowMs) - Number(last.at);
    return age >= 0 && age <= STARTED_UNSURE_HOLD_MS && text(last.orderNo) === text(orderNo) && Number(last.step) === Number(step);
  }

  return Object.freeze({
    APPLIED_MODES, CONTINUE_MAX_MS, POOL_READ_ATTEMPTS, TRANSITIONS, TERMINAL_STATES, HOLDING_STATES, CLAIM_REASON_KEY,
    enabled, machineMayTake, otherSteps, visibility, next, isTerminal, holds, claimAllowed, returnEvent, verifyTarget,
    claimErrorCode, claimEvent, outcome,
    // 第 2 階段（已開工）
    STARTED_COMMAND_TYPE, STARTED_SUBMIT_RPC, STARTED_ARG_KEYS, STARTED_ROLES, STARTED_REASON_ROLES, STARTED_REASON_MAX, STARTED_PENDING_KEEP_MS,
    STARTED_REJECT_MESSAGE_KEY, STARTED_GENERIC_MESSAGE_KEY, STARTED_UNCERTAIN_CODES, STARTED_RETRY_LATER_CODES,
    UNPOOLED_NOTICE_OPERATOR_MS, UNPOOLED_NOTICE_ADMIN_MS, STARTED_UNSURE_HOLD_MS,
    startedEnabled, startedRoleAllowed, startedNeedsReason, startedVisibility, todayReportBlocks, startedFreshCheck, historyPoolKey, sourcePoolKey,
    targetEligible, startedTargets, startedReasonCheck, startedBuildArgs, startedRejectInfo, startedSubmitErrorInfo, takenMachineOf, appliedInfo,
    startedResultView, startedIsUnsure, unpooledNotices, startedPendingRecord, startedSameSession, startedRestoreForSession,
    startedMergeForSave, startedRecordMatchesOrder, startedLocks, startedLastResultVisible, startedUnsureHold,
    // 第 3 階段（數量一起搬）
    MOVE_CONTRACT, MOVE_ARG_KEYS, MOVE_QTY_MAX, MOVE_SUBMIT_TIMEOUT_MS, MOVE_PREVIEW_WAIT_MS, MOVE_TRANSITIONS, MOVE_REJECT, MOVE_UNCERTAIN_CODES, MOVE_TAIL_KEYS,
    moveNext, moveEnabled, moveVisibility, moveFreshCheck, moveAdapterArgs, moveAdapterPreview, movePreviewView, moveRuleLine, moveTargetLine,
    moveRejectInfo, moveSubmitErrorInfo, moveAdapterApplied, moveAdapterRejectedBlock, moveResultView, moveFailureView, moveMessageView, moveIsUnsure,
    movePendingRecord, moveRestoreForSession, moveMergeForSave, moveUnsureHold,
  });
});
