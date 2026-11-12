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

  return Object.freeze({
    APPLIED_MODES, CONTINUE_MAX_MS, POOL_READ_ATTEMPTS, TRANSITIONS, TERMINAL_STATES, HOLDING_STATES, CLAIM_REASON_KEY,
    enabled, machineMayTake, otherSteps, visibility, next, isTerminal, holds, claimAllowed, returnEvent, verifyTarget,
    claimErrorCode, claimEvent, outcome,
  });
});
