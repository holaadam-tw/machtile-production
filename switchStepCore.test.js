// 機台卡片「換道次」（同一張工單換成待做池裡另一道）純邏輯＋ app.js 接線測試。不連任何後端。
// `node --test switchStepCore.test.js`
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const childProcess = require("node:child_process");
const core = require("./switchStepCore.js");
const returnCore = require("./returnClaimCore.js");
const stationCore = require("./stationCommandCore.js");
const poolCore = require("./dispatchPoolCore.js");

const UUID = "3f0c1a52-7c1e-4b7e-9d43-2f6a8f1f0a11";
const UUID2 = "99999999-9999-4999-8999-999999999999";
const PROCESS_ID = "00000000-0000-4000-8000-000000000303";
const SESSION = { tenantId: "00000000-0000-4000-8000-000000000001", appUserId: "00000000-0000-4000-8000-000000000902" };
const keyOf = (step) => `01|TEST-WO-1|S${step}`;
const CURRENT_KEY = keyOf(3);
const poolRow = (step, extra) => Object.assign({ source_key: keyOf(step), work_order_no: "TEST-WO-1", process_order: step, operation_name: step === 1 ? "CNC車床加工" : "車牙",
  part_no: "TEST-P1", part_name: "測試軸", quantity: 120, due_date: null, planned_start: null, urgency: 2, department_code: "LATHE",
  eligible_machine_codes: ["A03", "A05"], source_status: "pending", synced_at: null }, extra);
const OTHER_ORDER_ROW = poolRow(1, { source_key: "01|TEST-WO-9|S1", work_order_no: "TEST-WO-9" });
const MACHINE = { machineCode: "A05", departmentCode: "LATHE", status: "idle", enabledMachines: ["A03", "A05"] };
const see = (extra) => core.visibility(Object.assign({ enabled: true, returnShow: true, poolStatus: "ready", items: [poolRow(1), poolRow(2), OTHER_ORDER_ROW],
  orderNo: "TEST-WO-1", currentStep: 3, currentSourceKey: CURRENT_KEY, machine: MACHINE }, extra));

function dictionaries() {
  delete require.cache[require.resolve("./i18n.js")];
  delete global.MachTileI18n; delete global.machtileT;
  global.localStorage = { getItem() { return null; }, setItem() {} };
  const i18n = require("./i18n.js");
  return { zh: i18n.dictionaries["zh-Hant"], vi: i18n.dictionaries.vi,
    zhFile: JSON.parse(fs.readFileSync(path.join(__dirname, "locales/zh-Hant.json"), "utf8")),
    viFile: JSON.parse(fs.readFileSync(path.join(__dirname, "locales/vi.json"), "utf8")) };
}
const fill = (template, params) => String(template).replace(/\{\{(\w+)\}\}/g, (_, name) => String(params?.[name] ?? ""));

// ================================================================ 純邏輯
test("flag: effective only when enableSwitchStep is exactly true AND return-claim is enabled", () => {
  assert.equal(core.enabled({ flag: true, returnClaimEnabled: true }), true);
  for (const flag of [undefined, false, "true", 1, null]) assert.equal(core.enabled({ flag, returnClaimEnabled: true }), false, String(flag));
  assert.equal(core.enabled({ flag: true, returnClaimEnabled: false }), false);
  assert.equal(core.enabled({ flag: true }), false);
  assert.equal(core.enabled(), false);
  assert.match(fs.readFileSync(path.join(__dirname, "config.js"), "utf8"), /\n\s*enableSwitchStep: false,\r?\n/, "config.js default is false");
});

test("visibility matrix: return-claim rules AND another claimable step of the same order in the loaded pool", () => {
  const shown = see();
  assert.equal(shown.show, true);
  assert.deepEqual(shown.choices.map((c) => [c.step, c.sourceKey, c.name, c.quantity]), [[1, keyOf(1), "CNC車床加工", 120], [2, keyOf(2), "車牙", 120]], "other steps of the same order, sorted by step");
  assert.deepEqual(see({ items: [poolRow(2), poolRow(1)] }).choices.map((c) => c.step), [1, 2]);
  // 旗標／退回條件
  assert.deepEqual(see({ enabled: false }), { show: false, reason: "flag_off", choices: [] });
  assert.deepEqual(see({ enabled: "true" }), { show: false, reason: "flag_off", choices: [] });
  assert.deepEqual(see({ returnShow: false }), { show: false, reason: "return_hidden", choices: [] }, "started / reported / command pending … (the return-claim gate) hides it");
  // 待做池沒載入、載入失敗、資料不是陣列 → 不顯示（不猜）
  for (const poolStatus of ["idle", "error", "missing", "", undefined]) assert.equal(see({ poolStatus }).reason, "pool_not_ready", String(poolStatus));
  assert.equal(see({ items: null }).reason, "pool_not_ready");
  // 池裡只有現在這一道（同一個池列、或同一道）、或只有別張單
  assert.equal(see({ items: [] }).reason, "no_other_step");
  assert.equal(see({ items: [poolRow(3)] }).reason, "no_other_step", "only the current step in the pool");
  assert.equal(see({ items: [poolRow(3, { source_key: "01|TEST-WO-1|S3-dup" })] }).reason, "no_other_step", "another row of the SAME step is not 'another step'");
  assert.equal(see({ items: [poolRow(1, { source_key: CURRENT_KEY })] }).reason, "no_other_step", "the row this machine holds is never offered");
  assert.equal(see({ items: [OTHER_ORDER_ROW] }).reason, "no_other_step", "steps of another work order do not count");
  assert.equal(see({ items: [poolRow(1, { process_order: null }), poolRow(2, { source_key: "x" })] }).reason, "no_other_step", "rows without a step or a usable key are ignored");
  // 有其他道，但這台不能接
  assert.equal(see({ items: [poolRow(1, { eligible_machine_codes: ["A03"] })] }).reason, "other_step_not_eligible", "machine not in eligible_machine_codes");
  assert.equal(see({ items: [poolRow(1, { eligible_machine_codes: null })] }).reason, "other_step_not_eligible");
  assert.equal(see({ items: [poolRow(1, { department_code: "MILL" })] }).reason, "other_step_not_eligible", "other department");
  assert.equal(see({ items: [poolRow(1, { status: "claimed" })] }).reason, "other_step_not_eligible", "a row that says it is not waiting");
  assert.equal(see({ machine: { ...MACHINE, enabledMachines: ["A03"] } }).reason, "other_step_not_eligible", "machine not open for pool claims");
  assert.equal(see({ machine: { ...MACHINE, departmentCode: "" } }).reason, "other_step_not_eligible", "machine department unknown");
  assert.equal(see({ machine: { ...MACHINE, status: "maintenance" } }).reason, "other_step_not_eligible");
  // 雲端接單規則：單工站機台狀態不是空閒就接不到 → 不給換（不要退了才發現接不到）；多工站空閒／生產中／暫停都可以
  for (const status of ["paused", "running", "", undefined]) assert.equal(see({ machine: { ...MACHINE, status } }).reason, "other_step_not_eligible", `single station, status ${status}`);
  for (const status of ["idle", "paused", "running"]) assert.equal(see({ machine: { ...MACHINE, status, multiStation: true } }).show, true, `multi station, status ${status}`);
  assert.equal(see({ machine: { ...MACHINE, status: "offline", multiStation: true } }).show, false);
  assert.deepEqual(core.machineMayTake(poolRow(1), { ...MACHINE, status: "paused" }), { ok: false, reason: "machine_not_idle" });
  assert.equal(see({ machine: { ...MACHINE, machineCode: "" } }).reason, "other_step_not_eligible");
  // 一道可以、一道不行 → 只列可以的
  assert.deepEqual(see({ items: [poolRow(1, { eligible_machine_codes: ["A03"] }), poolRow(2)] }).choices.map((c) => c.step), [2]);
  assert.equal(see({ items: [poolRow(1, { status: "waiting" })] }).show, true, "an explicit waiting status is fine");
  assert.equal(see({ machine: { ...MACHINE, machineCode: " a05 " } }).show, true, "machine code is normalised");
  assert.equal(see({ items: [poolRow(1, { quantity: null })] }).choices[0].quantity, null, "unknown quantity stays unknown");
  assert.deepEqual(core.machineMayTake(poolRow(1), MACHINE), { ok: true, reason: "" });
  assert.equal(core.machineMayTake(null, MACHINE).ok, false);
});

test("state machine: the only way into claiming is returning → verifying → claiming, and nothing leads back", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(core.TRANSITIONS)), {
    choosing: { confirm: "returning", cancel: "closed" },
    returning: { return_applied: "verifying", return_applied_no_continue: "returned_not_claimed", return_rejected: "return_rejected",
      return_unsure: "return_unsure", return_uncertain: "stopped_uncertain" },
    verifying: { verify_ok: "claiming", verify_failed: "returned_not_claimed" },
    claiming: { claim_ok: "done", claim_failed: "returned_not_claimed", claim_uncertain: "claim_uncertain" },
  });
  assert.equal(core.next("choosing", "confirm"), "returning");
  assert.equal(core.next("returning", "return_applied"), "verifying");
  assert.equal(core.next("verifying", "verify_ok"), "claiming");
  assert.equal(core.next("claiming", "claim_ok"), "done");
  // 每一個結束狀態都沒有出路；不認得的事件、不認得的狀態＝null
  for (const state of core.TERMINAL_STATES) {
    assert.equal(core.isTerminal(state), true);
    for (const events of Object.values(core.TRANSITIONS)) for (const event of Object.keys(events)) assert.equal(core.next(state, event), null, `${state} + ${event}`);
  }
  assert.equal(core.next("returning", "claim_ok"), null);
  assert.equal(core.next("returning", "verify_ok"), null, "cannot skip the return result");
  assert.equal(core.next("choosing", "return_applied"), null);
  assert.equal(core.next("nope", "confirm"), null);
  assert.equal(core.next("constructor", "toString"), null);
  // 哪些轉移會到 claiming：只有一條；離開 claiming 之後的狀態都是結束狀態（＝接單最多一次，不會自動重試）
  const into = [];
  for (const [state, events] of Object.entries(core.TRANSITIONS)) for (const [event, to] of Object.entries(events)) if (to === "claiming") into.push(`${state}+${event}`);
  assert.deepEqual(into, ["verifying+verify_ok"]);
  for (const to of Object.values(core.TRANSITIONS.claiming)) assert.equal(core.isTerminal(to), true, to);
  for (const to of Object.values(core.TRANSITIONS.verifying)) assert.ok(to === "claiming" || core.isTerminal(to));
  assert.equal(core.claimAllowed("claiming"), true);
  for (const state of ["choosing", "returning", "verifying", "done", "returned_not_claimed", null]) assert.equal(core.claimAllowed(state), false, String(state));
  assert.deepEqual([...core.HOLDING_STATES], ["verifying", "claiming"]);
  assert.equal(core.holds("verifying") && core.holds("claiming"), true);
  assert.equal(core.holds("returning") || core.holds("done") || core.holds(undefined), false);
});

test("return result → event: only applied with a contract mode, in time, continues to the claim", () => {
  const applied = (mode) => returnCore.resultView({ status: "applied", legacy_snapshot: { return_claim: { mode, pool_status: "returned", station_cleared: true } } });
  assert.deepEqual([...core.APPLIED_MODES], ["unassigned", "stale_assignment_reconciled", "already_returned"]);
  for (const mode of core.APPLIED_MODES) assert.deepEqual(core.returnEvent({ view: applied(mode), startedAt: 1000, nowMs: 5000 }), { event: "return_applied", reasonKey: "" }, mode);
  assert.deepEqual(core.returnEvent({ view: applied("something_new"), startedAt: 1000, nowMs: 5000 }), { event: "return_applied_no_continue", reasonKey: "switch_step_reason_unknown_mode" });
  assert.equal(core.returnEvent({ view: returnCore.resultView({ status: "applied" }), startedAt: 1000, nowMs: 5000 }).event, "return_applied_no_continue", "applied without a mode");
  assert.equal(core.returnEvent({ view: applied("unassigned"), startedAt: 0, nowMs: core.CONTINUE_MAX_MS }).event, "return_applied");
  assert.deepEqual(core.returnEvent({ view: applied("unassigned"), startedAt: 0, nowMs: core.CONTINUE_MAX_MS + 1 }), { event: "return_applied_no_continue", reasonKey: "switch_step_reason_late" });
  assert.equal(core.returnEvent({ view: applied("unassigned"), startedAt: 5000, nowMs: 1000 }).event, "return_applied_no_continue", "clock went backwards: do not continue");
  assert.equal(core.returnEvent({ view: applied("unassigned") }).event, "return_applied_no_continue", "no start time: do not continue");
  assert.equal(core.returnEvent({ view: returnCore.resultView({ status: "rejected", reject_code: "CLAIM_ALREADY_STARTED" }), startedAt: 0, nowMs: 1 }).event, "return_rejected");
  assert.equal(core.returnEvent({ view: returnCore.resultView({ status: "rejected", reject_code: "BRAND_NEW" }), startedAt: 0, nowMs: 1 }).event, "return_rejected");
  assert.equal(core.returnEvent({ view: returnCore.resultView({ status: "expired", reject_code: "EXPIRED" }), startedAt: 0, nowMs: 1 }).event, "return_rejected", "expired = certainly not returned");
  for (const code of returnCore.UNCERTAIN_CODES) {
    assert.equal(core.returnEvent({ view: returnCore.resultView({ status: "rejected", reject_code: code }), startedAt: 0, nowMs: 1 }).event, "return_unsure", code);
  }
  for (const event of ["return_rejected", "return_unsure", "return_applied_no_continue"]) assert.equal(core.claimAllowed(core.next("returning", event)), false);
});

test("re-verify before the claim: fresh pool, same row still there, still this order + step, machine may still take it", () => {
  const target = { sourceKey: keyOf(1), step: 1, name: "CNC車床加工" };
  const verify = (extra) => core.verifyTarget(Object.assign({ poolFresh: true, items: [poolRow(1), poolRow(2)], target, orderNo: "TEST-WO-1", machine: MACHINE }, extra));
  assert.deepEqual(verify(), { ok: true, reasonKey: "" });
  assert.deepEqual(verify({ poolFresh: false }), { ok: false, reasonKey: "switch_step_reason_pool_unread" });
  assert.equal(verify({ items: null }).reasonKey, "switch_step_reason_pool_unread");
  assert.equal(verify({ items: [poolRow(2)] }).reasonKey, "switch_step_reason_not_in_pool", "someone else took it");
  assert.equal(verify({ items: [poolRow(1, { status: "claimed" })] }).reasonKey, "switch_step_reason_not_in_pool");
  assert.equal(verify({ items: [poolRow(1, { work_order_no: "TEST-WO-9" })] }).reasonKey, "switch_step_reason_not_in_pool", "the key now points at another order");
  assert.equal(verify({ items: [poolRow(1, { process_order: 4 })] }).reasonKey, "switch_step_reason_not_in_pool");
  assert.equal(verify({ items: [poolRow(1, { eligible_machine_codes: ["A03"] })] }).reasonKey, "switch_step_reason_not_eligible");
  assert.equal(verify({ machine: { ...MACHINE, status: "offline" } }).reasonKey, "switch_step_reason_not_eligible");
  assert.equal(verify({ machine: { ...MACHINE, status: "paused" } }).reasonKey, "switch_step_reason_machine_not_idle");
  assert.equal(verify({ target: null }).ok, false);
});

test("claim result → event: ok, certainly failed (one reason), or uncertain; a function that did not send counts as failed", () => {
  assert.deepEqual(core.claimEvent({ ok: true }), { event: "claim_ok", reasonKey: "" });
  for (const nothing of [undefined, null, true, "ok"]) assert.deepEqual(core.claimEvent(nothing), { event: "claim_failed", reasonKey: "switch_step_reason_busy" });
  const failed = (message) => core.claimEvent({ ok: false, error: new Error(message) });
  // dispatchPoolCore 認得的每一個接單錯誤碼都有一個原因
  const known = ["UNACKNOWLEDGED_CLAIM_EXISTS", "MACHINE_ALREADY_ASSIGNED", "POOL_ITEM_NOT_WAITING", "MACHINE_NOT_IDLE", "MACHINE_NOT_EMPTY", "MACHINE_NOT_ELIGIBLE",
    "MACHINE_DEPARTMENT_MISMATCH", "DEPARTMENT_ACCESS_DENIED", "PROCESS_ALREADY_ASSIGNED", "POOL_ITEM_INCOMPLETE", "DISPATCH_POOL_CLAIM_DISABLED", "AUTH_REQUIRED", "TENANT_REQUIRED"];
  assert.deepEqual(Object.keys(core.CLAIM_REASON_KEY).sort(), [...known].sort());
  for (const code of known) {
    const message = `400 {"code":"P0001","message":"${code}"}`;
    assert.notEqual(poolCore.claimErrorText(new Error(message)), code, `${code} is a code the existing claim flow knows`);
    assert.deepEqual(failed(message), { event: "claim_failed", reasonKey: core.CLAIM_REASON_KEY[code] }, code);
    assert.equal(core.claimErrorCode(new Error(message)), poolCore.errorCode(new Error(message)), "same code extraction as dispatchPoolCore");
  }
  assert.equal(failed('400 {"message":"POOL_ITEM_NOT_WAITING"}').reasonKey, "switch_step_reason_taken");
  assert.equal(failed('400 {"message":"MACHINE_NOT_IDLE"}').reasonKey, "switch_step_reason_machine_not_idle");
  assert.equal(failed('400 {"message":"MACHINE_ALREADY_ASSIGNED: 機台已有未完成指派，請先處理既有工序"}').reasonKey, "switch_step_reason_machine_busy", "the cloud appends text after the code");
  assert.deepEqual(failed('400 {"code":"P0001","message":"SOMETHING_NEW_HERE"}'), { event: "claim_failed", reasonKey: "switch_step_reason_generic" });
  assert.deepEqual(failed("401 unauthorized"), { event: "claim_failed", reasonKey: "switch_step_reason_login" });
  assert.deepEqual(failed("Failed to fetch"), { event: "claim_uncertain", reasonKey: "" });
  assert.deepEqual(failed("503 upstream"), { event: "claim_uncertain", reasonKey: "" });
  assert.deepEqual(core.claimEvent({ ok: false }), { event: "claim_uncertain", reasonKey: "" }, "no error object: we do not know");
});

test("outcome sentences (zh-Hant): done, returned-but-not-claimed (machine empty / machine untouched), claim uncertain", () => {
  const d = dictionaries();
  const say = (view) => fill(d.zh[view.messageKey], { ...view.params, reason: view.reasonKey ? d.zh[view.reasonKey] : "" });
  const done = core.outcome({ state: "done", mode: "unassigned", from: 3, to: 1 });
  assert.equal(say(done), "已換成第 1 道。原本的第 3 道已退回待做池。");
  assert.deepEqual({ tone: done.tone, phase: done.phase, switchStep: done.switchStep, terminal: done.terminal }, { tone: "ok", phase: "applied", switchStep: true, terminal: true });
  const failed = core.outcome({ state: "returned_not_claimed", mode: "unassigned", from: 3, to: 1, reasonKey: "switch_step_reason_taken" });
  assert.equal(say(failed), "原本那一道已經退回待做池，這台現在沒有工單；第 1 道沒有接成功（已經被別台接走）。請到「選工單」重新接。");
  assert.equal(failed.tone, "warn");
  assert.equal(say(core.outcome({ state: "returned_not_claimed", mode: "already_returned", from: 3, to: 2 })),
    "原本那一道已經退回待做池，這台現在沒有工單；第 2 道沒有接成功（系統沒有接成功）。請到「選工單」重新接。", "no reason given → the generic one");
  assert.equal(say(core.outcome({ state: "returned_not_claimed", mode: "stale_assignment_reconciled", from: 3, to: 1, reasonKey: "switch_step_reason_machine_busy" })),
    "原本那一道已經退回待做池，這台機台目前掛的工單沒有動；第 1 道沒有接成功（系統上這台還有未完成的工單）。請到「選工單」重新接。", "factory did not touch the machine: never claim the machine is empty");
  const unsure = core.outcome({ state: "claim_uncertain", mode: "unassigned", from: 3, to: 1 });
  assert.equal(say(unsure), "原本那一道已經退回待做池；第 1 道不確定有沒有接到（網路不穩）。請重新整理畫面看這台現在掛哪張單；沒有的話請到「選工單」重新接。");
  assert.doesNotMatch(say(unsure), /沒有接成功/, "uncertain is never worded as a failure");
  assert.equal(core.outcome({ state: "anything_else", from: 3, to: 1 }).state, "returned_not_claimed", "an unexpected state is reported as returned-but-not-claimed");
});

test("every switch_step string exists in both languages, vi is draft, no raw code, and nothing tells the operator to press again", () => {
  const d = dictionaries();
  const sources = ["app.js", "switchStepCore.js"].map((name) => fs.readFileSync(path.join(__dirname, name), "utf8")).join("\n");
  const used = new Set([...sources.matchAll(/"(switch_step_[a-z0-9_]+)"/g)].map((m) => m[1]));
  assert.ok(used.size >= 30, `expected the full string set, found ${used.size}`);
  const defined = Object.keys(d.zh).filter((key) => key.startsWith("switch_step_"));
  assert.deepEqual([...used].sort(), defined.sort(), "keys used by code == keys defined (no missing, no orphan)");
  for (const key of used) {
    for (const [name, value] of [["i18n zh-Hant", d.zh[key]], ["i18n vi", d.vi[key]], ["locales zh-Hant", d.zhFile[key]], ["locales vi", d.viFile[key]?.value]]) {
      assert.equal(typeof value, "string", `${key} ${name}`);
      assert.ok(value.length > 0, `${key} ${name}`);
      assert.doesNotMatch(value, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `${key} ${name} must not show a raw code`);
    }
    assert.equal(d.zh[key], d.zhFile[key], `${key} zh-Hant i18n.js == locales`);
    assert.equal(d.vi[key], d.viFile[key].value, `${key} vi i18n.js == locales`);
    assert.equal(d.viFile[key]._draft, true, `${key} vi is marked draft`);
    assert.notEqual(d.vi[key], d.zh[key], `${key} is translated`);
    assert.deepEqual([...d.vi[key].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort(), [...d.zh[key].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort(), `${key} same placeholders`);
    // 除了「等一下、不要重按」那一句，沒有任何一句叫人再按一次
    if (key !== "switch_step_progress_return") assert.doesNotMatch(d.zh[key], /再按|重按|重送|再試|重試/, `${key} zh-Hant`);
  }
  assert.equal(d.zh.switch_step_button, "換道次");
  assert.match(d.zh.switch_step_busy, /換道次/);
  assert.doesNotMatch(d.zh.switch_step_busy, /開工|停工|退回/, "the blocking sentence is about the step switch");
});

// ================================================================ app.js 接線（從 app.js 取出真正的函式在 vm 裡跑）
const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const NL = appSource.includes("\r\n") ? "\r\n" : "\n";
function slice(from, to) {
  const start = appSource.indexOf(from.replace(/\n/g, NL));
  const end = appSource.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `app.js must contain: ${from.slice(0, 50)} … ${to.slice(0, 50)}`);
  return appSource.slice(start, end);
}
const blockSource = slice("// ============================================================================================\n// 機台卡片「接錯了，退回」", "function renderMachineCard(machine) {");
const switchSource = slice("// ---- 換道次 ----", "function renderMachineCard(machine) {");
const poolSource = slice("const machtileDispatchPoolState = {", "function machtileDispatchPoolOpenRefreshState(machine) {");
const claimSource = slice("async function machtileClaimDispatchPool(sourceKey, machineCode) {", "async function machtileReplaceStoppedDispatchPool(sourceKey, machineCode) {");
const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const PENDING_KEY = "machtile.returnClaimPending.v1";
const POOL_URL = "dispatch_pool_items?select=source_key,work_order_no,process_order,operation_name,part_no,part_name,quantity,due_date,planned_start,urgency,department_code,eligible_machine_codes,source_status,synced_at&status=eq.waiting&order=urgency.asc,due_date.asc.nullslast,planned_start.asc.nullslast,work_order_no.asc,process_order.asc&limit=500";
const heldOrder = (extra) => Object.assign({ id: "TEST-WO-1", stationStep: 3, processId: PROCESS_ID, part: "測試軸", process: "精車", heldPoolKey: CURRENT_KEY,
  processStatus: "pending", done: 0, offStation: false }, extra);
const freshRow = (extra) => [Object.assign({ id: PROCESS_ID, process_order: 3, process_name: "精車", status: "pending", off_station_at: null, qty_completed: 0,
  work_orders: { work_order_no: "TEST-WO-1", part_no: "TEST-P1", part_name: "測試軸", status: "in_progress" }, machines: { machine_code: "A05" } }, extra)];
const commandRow = (extra) => Object.assign({ command_uuid: UUID, command_type: "return_claim", machine_code: "A05", pool_item_id: CURRENT_KEY,
  expected_order_no: "TEST-WO-1", expected_index_sn: 3, status: "pending", requested_at: new Date().toISOString(), claimed_at: null, applied_at: null,
  reject_code: null, reject_message: null, legacy_snapshot: null }, extra);
const appliedRow = (mode = "unassigned") => commandRow({ status: "applied", applied_at: new Date().toISOString(),
  legacy_snapshot: { return_claim: { mode, pool_status: "returned", station_cleared: mode === "unassigned" } } });
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

// 假後端：退回送出／輪詢、待做池清單、接單。state 可以中途改。
function backendOf(state) {
  Object.assign(state, { returns: [], claims: [], poolReads: 0, row: null, ...state });
  return async (url, init) => {
    if (url.startsWith("work_order_processes?")) return freshRow();
    if (url.startsWith(returnCore.HELD_POOL_PATH_PREFIX)) {
      // 卡片明細載入時查「機台上這一道是池裡哪一列」（returnClaimCore.heldPoolPath）
      state.heldReads = (state.heldReads || 0) + 1;
      return state.held ? state.held() : [];
    }
    if (url.startsWith("dispatch_pool_items?")) {
      assert.equal(url, POOL_URL, "the pool is re-read with the existing select (no new select)");
      state.poolReads += 1;
      if (state.poolFail) throw new TypeError("Failed to fetch");
      return state.pool ? state.pool() : [poolRow(1), poolRow(2), OTHER_ORDER_ROW];
    }
    if (url === "rpc/machtile_submit_return_claim_command") {
      state.returns.push(JSON.parse(init.body));
      if (state.returnError) throw new Error(state.returnError);
      state.row = commandRow({ command_uuid: JSON.parse(init.body).p_command_uuid });
      return [state.row];
    }
    if (url.startsWith("station_commands?")) return state.row ? [state.row] : [];
    if (url === "rpc/dispatch_pool_claim") {
      state.claims.push({ url, init });
      if (state.claimGate) await state.claimGate;
      if (state.claimError) throw new Error(state.claimError);
      return null;
    }
    throw new Error(`unexpected ${url} ${init?.method || ""}`);
  };
}

function harness(options = {}) {
  const d = dictionaries();
  const dict = options.language === "vi" ? d.vi : d.zh;
  const timers = [];
  const holders = {};
  const storage = options.storage instanceof Map ? options.storage : new Map(Object.entries(options.storage || {}));
  const calls = { fetch: [], toasts: [], rerenders: 0, refresh: [], storageReads: 0, reloads: 0, closedSelection: 0 };
  const machine = { code: "A05", name: "A05", status: options.machineStatus || "idle", order: options.order === undefined ? heldOrder() : options.order, isUnassignedBucket: false };
  const config = { dispatchPoolMachines: ["A03", "A05"] };
  if (options.returnFlag !== undefined) config.enableReturnClaim = options.returnFlag;
  if (options.flag !== undefined) config.enableSwitchStep = options.flag;
  const context = {
    window: { MachTileReturnClaimCore: returnCore, MachTileSwitchStepCore: options.noCore ? undefined : core, crypto: { randomUUID: () => (options.uuids ? options.uuids.shift() : UUID) } },
    config,
    state: { source: "supabase", dailyStationStartRows: options.startRows || [], localStationStartRows: [], assignedCardOrders: options.assigned === undefined ? null : options.assigned },
    machtileDeferredLoadGeneration: 7,
    machtileStationCmdCore: stationCore,
    machtileDispatchPoolCore: poolCore,
    machtileStationCmd: { pending: options.stationPending || {} },
    machtileInstantStartPending: {},
    machtilePickStartLocal: {},
    machtileCardState: { todayStatus: "ok", todayRows: options.todayRows || [] },
    machtileDeferredLoadState: new Map([["card-details", { status: "ready" }]]),
    machtileDepartmentAccess: { role: options.role || "operator", is_bridge: false },
    machtileAuthState: Object.assign({}, SESSION),
    machtileBatchState: { formError: "" },
    machtileRenderBatchReport() {},
    machtileActualRole: () => options.role || "operator",
    machtileCardActivityOf: () => null,
    machtileStrictMode: () => true,
    normalizedMachineDepartment: () => options.department || "車床課",
    machtileStationCmdMachineCode: (m) => String(m?.code || m?.name || "").trim().toUpperCase(),
    machtileStationCmdMachineByCode: (code) => (code === "A05" ? machine : null),
    machtileScheduleMachine: (code) => (code === "A05" ? machine : null),
    machtileStationCmdRerender: () => { calls.rerenders += 1; },
    machtileRefreshAfterApplied: async (code, type) => { calls.refresh.push([code, type]); },
    machtileCloseCardSelection: () => { calls.closedSelection += 1; },
    machtileOpenCardSelection() {}, machtileCardSelectionReopenOptions() { return {}; }, machtilePickOrderConfirm: () => true,
    loadFromSupabase: async () => { calls.reloads += 1; }, deriveMachines() {}, renderAll() {},
    machtileTranslate: (key, params) => String(dict[key] ?? `MISSING:${key}`).replace(/\{\{(\w+)\}\}/g, (_, name) => String(params?.[name] ?? "")),
    escapeHtml: htmlEscape,
    showToast: (message) => { calls.toasts.push(message); },
    supabaseFetch: async (url, init) => {
      calls.fetch.push({ url, init });
      if (!options.backend) throw new Error("unexpected fetch");
      return options.backend(url, init);
    },
    localStorage: {
      getItem(key) { calls.storageReads += 1; return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, value); },
    },
    document: {
      activeElement: null, addEventListener() {}, querySelector() { return null; },
      getElementById(id) { return holders[id] || null; },
      createElement() { return { id: "", innerHTML: "", contains() { return false; }, querySelector() { return null; }, querySelectorAll() { return []; }, remove() { delete holders[this.id]; } }; },
      body: { appendChild(el) { holders[el.id] = el; } },
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    AbortController, console: { warn() {}, log() {} }, Date, JSON, Object, Array, Number, String, Boolean, Error, Map, Set, TypeError,
  };
  const api = vm.runInNewContext(`${poolSource}
    ${claimSource}
    ${blockSource}
    ({ machtileReturnClaim, machtileSwitchStep, poolState: machtileDispatchPoolState, claim: machtileClaimDispatchPool,
       returnEnabled: machtileReturnClaimEnabled, enabled: machtileSwitchStepEnabled, locks: machtileReturnClaimLocks, blockMessage: machtileReturnClaimBlockMessage,
       markup: machtileReturnClaimCardMarkup, buttonMarkup: machtileSwitchStepButtonMarkup, gate: machtileSwitchStepGate, active: machtileSwitchStepActive,
       holds: machtileSwitchStepHolds, restore: machtileReturnClaimRestore, open: machtileReturnClaimOpen, openRetry: machtileReturnClaimOpenRetry,
       choose: machtileSwitchStepChoose, submit: machtileReturnClaimSubmit, handleClick: machtileReturnClaimHandleClick, switchClick: machtileSwitchStepHandleClick,
       closeSheet: machtileReturnClaimCloseSheet, loadHeldKeys: machtileReturnClaimLoadHeldPoolKeys })`, context);
  // 待做池：畫面載入時已經讀到的那一份
  if (options.pool !== null) Object.assign(api.poolState, { status: options.poolStatus || "ready", items: options.pool || [poolRow(1), poolRow(2), OTHER_ORDER_ROW] });
  const sheetHtml = () => holders.machtileReturnClaimSheet?.innerHTML || "";
  const runPoll = async () => {
    const index = timers.findIndex((timer) => timer.ms !== stationCore.SUBMIT_TIMEOUT_MS);
    assert.ok(index >= 0, "a poll timer must be scheduled");
    const [timer] = timers.splice(index, 1);
    await timer.fn();
    await settle();
  };
  const pollTimers = () => timers.filter((timer) => timer.ms !== stationCore.SUBMIT_TIMEOUT_MS).length;
  const urls = (prefix) => calls.fetch.filter((call) => call.url.startsWith(prefix));
  return { api, calls, machine, storage, sheetHtml, runPoll, pollTimers, urls, context };
}
const RETURN_BUTTON = '<button type="button" class="card-select-entry pool-return-action" data-no-detail data-return-claim-open="A05">接錯了，退回</button>';
const SWITCH_BUTTON = '<button type="button" class="card-select-entry pool-return-action" data-no-detail data-switch-step-open="A05">換道次</button>';
const SWITCH_BUSY = "這台正在「換道次」，等它有結果再操作。";
// 走到「退回已送出、等工廠」：開卡 → 選第 step 道 → 按確認
async function startSwitch(h, step = 1) {
  await h.api.open("A05", null, true);
  h.api.choose(keyOf(step));
  await h.api.submit();
}
const NORMAL_CLAIM = (async () => {
  // 一般接單（選工單面板按「接單」）送出的請求：用同一支真的 machtileClaimDispatchPool 量一次，當成比對基準
  const state = {};
  const h = harness({ backend: backendOf(state) });
  const result = await h.api.claim(keyOf(1), "A05");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true });
  assert.equal(state.claims.length, 1);
  return state.claims[0];
})();

test("existing claim function: same request as before, now also reports its result (ok / error) to the caller", async () => {
  const normal = await NORMAL_CLAIM;
  assert.equal(normal.url, "rpc/dispatch_pool_claim");
  assert.deepEqual(Object.keys(normal.init), ["method", "body"]);
  assert.equal(normal.init.method, "POST");
  assert.equal(normal.init.body, JSON.stringify({ p_source_key: keyOf(1), p_machine_code: "A05" }));
  assert.equal(normal.init.body, JSON.stringify(poolCore.claimArgs(keyOf(1), "A05")));
  const state = { claimError: '400 {"code":"P0001","message":"POOL_ITEM_NOT_WAITING"}' };
  const h = harness({ backend: backendOf(state) });
  const failed = await h.api.claim(keyOf(1), "A05");
  assert.equal(failed.ok, false);
  assert.match(failed.error.message, /POOL_ITEM_NOT_WAITING/);
  assert.deepEqual(h.calls.toasts, ["這張單已被別台接走。"], "the existing failure toast is unchanged");
  assert.equal(await h.api.claim("", "A05"), undefined, "nothing to claim: returns nothing, sends nothing");
  assert.equal(state.claims.length, 1);
});

test("flag off (missing / false / non-boolean, or return-claim off): markup and behaviour identical to the return-claim-only build", async () => {
  const baseline = harness({ returnFlag: true });
  assert.equal(baseline.api.markup(baseline.machine), RETURN_BUTTON);
  for (const flag of [undefined, false, "true", 1, null]) {
    const h = harness({ returnFlag: true, flag });
    assert.equal(h.api.enabled(), false, String(flag));
    assert.equal(h.api.markup(h.machine), RETURN_BUTTON, `markup flag=${flag}: only the return button, byte-identical`);
    assert.equal(h.api.buttonMarkup(h.machine), "");
    assert.deepEqual(JSON.parse(JSON.stringify(h.api.gate(h.machine))), { show: false, reason: "flag_off", choices: [] });
    assert.equal(h.api.switchClick({ closest: () => ({ dataset: { switchStepOpen: "A05", switchStepChoice: keyOf(1) } }) }), false);
    await h.api.open("A05", null, true);
    assert.equal(h.sheetHtml(), "", "asking for a switch sheet with the flag off opens nothing");
    assert.equal(h.api.active("A05"), null);
    assert.equal(h.api.holds("A05"), false);
    assert.equal(h.api.locks("A05"), false);
    assert.equal(h.api.blockMessage("A05"), "");
    assert.deepEqual(h.calls, { fetch: [], toasts: [], rerenders: 0, refresh: [], storageReads: 0, reloads: 0, closedSelection: 0 });
    assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileSwitchStep)), { active: {}, claimPass: "" });
  }
  // 換道次開、退回關 → 兩個都不出現
  for (const returnFlag of [undefined, false]) {
    const h = harness({ returnFlag, flag: true });
    assert.equal(h.api.enabled(), false);
    assert.equal(h.api.markup(h.machine), "");
    await h.api.open("A05", null, true);
    assert.equal(h.sheetHtml(), "");
    assert.deepEqual(h.calls.fetch, []);
  }
  // 核心檔沒載到（舊快取）＝當作關
  const noCore = harness({ returnFlag: true, flag: true, noCore: true });
  assert.equal(noCore.api.enabled(), false);
  assert.equal(noCore.api.markup(noCore.machine), RETURN_BUTTON);
  // 旗標關時「接錯了，退回」整個流程照舊：送出的參數、輪詢、結果、提示都跟以前一樣，沒有任何接單
  const state = {};
  const h = harness({ returnFlag: true, flag: false, backend: backendOf(state) });
  await h.api.open("A05", null);
  assert.doesNotMatch(h.sheetHtml(), /switch-step/);
  assert.match(h.sheetHtml(), /確認退回這張單/);
  await h.api.submit();
  assert.equal(h.api.blockMessage("A05"), "這台有一筆「退回接單」還在等工廠處理，等它有結果再操作。");
  assert.match(h.api.markup(h.machine), /data-return-claim-status="pending"[^>]*>退回中，等工廠處理…</);
  state.row = appliedRow();
  await h.runPoll();
  assert.deepEqual(h.calls.toasts, ["已退回待做池，這台現在沒有工單。"]);
  assert.deepEqual(h.calls.refresh, [["A05", "return_claim"]]);
  assert.equal(state.claims.length, 0);
  assert.equal(state.poolReads, 0, "a plain return never reads the pool for a switch");
});

test("flag on: 「換道次」 sits next to 「接錯了，退回」 only when the loaded pool has another claimable step; rendering is read-only", () => {
  const h = harness({ returnFlag: true, flag: true });
  const html = h.api.markup(h.machine);
  assert.equal(html, RETURN_BUTTON + SWITCH_BUTTON);
  assert.equal(h.api.markup(h.machine), html, "rendering twice gives the same result");
  assert.deepEqual(h.calls, { fetch: [], toasts: [], rerenders: 0, refresh: [], storageReads: 0, reloads: 0, closedSelection: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileSwitchStep)), { active: {}, claimPass: "" }, "render does not touch flow state");
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileReturnClaim)), { pending: {}, timers: {}, lastResult: {}, sheet: null });
  assert.match(harness({ returnFlag: true, flag: true, language: "vi" }).api.markup(h.machine), />Đổi công đoạn</);
  // 待做池的狀況 → 只剩退回鈕
  for (const [label, options] of [
    ["pool not loaded", { pool: null }], ["pool load failed", { poolStatus: "error" }], ["pool table missing", { poolStatus: "missing" }],
    ["only the current step in the pool", { pool: [poolRow(3)] }], ["empty pool", { pool: [] }], ["only another order", { pool: [OTHER_ORDER_ROW] }],
    ["other step not eligible for this machine", { pool: [poolRow(1, { eligible_machine_codes: ["A03"] })] }],
    ["other step of another department", { pool: [poolRow(1, { department_code: "MILL" })] }],
    ["machine department unknown", { department: "未設定課別" }],
    ["single-station machine that is not idle in the cloud (a claim would be refused)", { machineStatus: "paused" }],
  ]) {
    const other = harness({ returnFlag: true, flag: true, ...options });
    assert.equal(other.api.markup(other.machine), RETURN_BUTTON, label);
  }
  // 退回的條件不成立 → 兩顆都沒有
  for (const options of [
    { order: heldOrder({ processStatus: "running" }) }, { order: heldOrder({ done: 5 }) }, { order: heldOrder({ heldPoolKey: "" }) },
    { order: heldOrder({ heldPoolKey: undefined }) }, { role: "manager" }, { stationPending: { A05: { commandType: "start" } } },
    { todayRows: [{ report_type: "noon", process_id: PROCESS_ID }] },
    { startRows: [{ machine_code: "A05", command_type: "start", status: "applied", expected_order_no: "TEST-WO-1", expected_index_sn: 3, applied_at: new Date().toISOString() }] },
  ]) {
    const hidden = harness({ returnFlag: true, flag: true, ...options });
    assert.equal(hidden.api.markup(hidden.machine), "", JSON.stringify(options));
  }
  assert.equal(harness({ returnFlag: true, flag: true, order: null }).api.markup({ code: "A05", name: "A05", order: null }), "");
});

test("sheet: order · part in the title, the step it holds now, the other steps (step · name · quantity), one confirm button, plain explanation", async () => {
  const state = {};
  const h = harness({ returnFlag: true, flag: true, backend: backendOf(state) });
  await h.api.open("A05", null, true);
  assert.deepEqual(h.calls.fetch.map((call) => call.url.split("?")[0]), ["work_order_processes", "dispatch_pool_items"], "opening re-reads the process row and the pool; nothing is written");
  const html = h.sheetHtml();
  assert.match(html, /<h2 id="returnClaimTitle">換道次：TEST-WO-1 · TEST-P1 測試軸<\/h2>/);
  assert.match(html, /data-switch-step-current>現在掛的：第 3 道 · 精車</);
  assert.match(html, /data-switch-step-choice="01\|TEST-WO-1\|S1" data-switch-step-choice-step="1">第 1 道 · CNC車床加工 · 120 件</);
  assert.match(html, /data-switch-step-choice="01\|TEST-WO-1\|S2" data-switch-step-choice-step="2">第 2 道 · 車牙 · 120 件</);
  assert.equal(html.split("data-switch-step-choice=").length, 3, "exactly the two other steps of this order (not the current step, not another order)");
  assert.doesNotMatch(html, /TEST-WO-9/);
  assert.match(html, /現在這一道（第 3 道）會退回待做池，別人可以再接。/);
  assert.match(html, /你選的那一道會掛到這台機台。/);
  assert.match(html, /不會報工，也不會記任何數量。/);
  assert.equal(html.split("data-return-claim-confirm").length, 2, "a single confirm button");
  assert.match(html, /data-switch-step-confirm disabled>請先選要換成哪一道</, "two choices: nothing is preselected and confirm is disabled");
  assert.doesNotMatch(html, /data-return-claim-reason/, "operator is not asked for a reason");
  await h.api.submit();
  assert.equal(state.returns.length, 0, "confirm without a choice sends nothing");
  assert.equal(h.api.active("A05"), null);
  h.api.choose("01|NOT-IN-LIST|S1");
  assert.match(h.sheetHtml(), /data-switch-step-confirm disabled/, "a key that is not in the list cannot be chosen");
  h.api.choose(keyOf(2));
  assert.match(h.sheetHtml(), /aria-checked="true" data-switch-step-choice="01\|TEST-WO-1\|S2"/);
  assert.match(h.sheetHtml(), /data-switch-step-confirm >換成第 2 道</);
  h.api.choose(keyOf(1));
  assert.match(h.sheetHtml(), /data-switch-step-confirm >換成第 1 道</);
  assert.equal(h.sheetHtml().split('aria-checked="true"').length, 2, "one selected choice");
  h.api.closeSheet();
  assert.equal(h.sheetHtml(), "");
  assert.deepEqual([state.returns.length, state.claims.length], [0, 0], "cancel: nothing sent");
  // 只有一道可以換：先選好，還是要按確認
  const one = harness({ returnFlag: true, flag: true, backend: backendOf({ pool: () => [poolRow(1, { quantity: null })] }) });
  await one.api.open("A05", null, true);
  assert.match(one.sheetHtml(), /data-switch-step-confirm >換成第 1 道</);
  assert.match(one.sheetHtml(), /data-switch-step-choice-step="1">第 1 道 · CNC車床加工</, "unknown quantity is simply not shown");
  // 開卡時重讀：待做池讀不到／已經沒有其他道／這張單狀況變了 → 說明原因，不能按
  const unread = harness({ returnFlag: true, flag: true, backend: backendOf({ poolFail: true }) });
  await unread.api.open("A05", null, true);
  assert.match(unread.sheetHtml(), /data-switch-step-pool-failed>讀不到最新的待做池，現在不能換道次。請檢查網路後重新整理畫面。</);
  assert.match(unread.sheetHtml(), /data-switch-step-confirm disabled/);
  assert.doesNotMatch(unread.sheetHtml(), /data-switch-step-choice=/, "stale choices are never listed");
  await unread.api.submit();
  assert.equal(unread.urls("rpc/").length, 0);
  const gone = harness({ returnFlag: true, flag: true, backend: backendOf({ pool: () => [poolRow(3), OTHER_ORDER_ROW] }) });
  await gone.api.open("A05", null, true);
  assert.match(gone.sheetHtml(), /data-switch-step-no-other>待做池裡現在沒有這張單、這台可以接的其他道次，不能換。</);
  assert.match(gone.sheetHtml(), /data-switch-step-confirm disabled/);
  const changed = harness({ returnFlag: true, flag: true, backend: async (url) => (url.startsWith("work_order_processes?") ? freshRow({ status: "running" }) : [poolRow(1)]) });
  await changed.api.open("A05", null, true);
  assert.match(changed.sheetHtml(), /這張單的狀況變了/);
  assert.match(changed.sheetHtml(), /data-switch-step-confirm disabled/);
  changed.api.choose(keyOf(1));
  await changed.api.submit();
  assert.equal(changed.urls("rpc/").length, 0, "started meanwhile: nothing is sent");
});

test("happy path (A05 holds step 3, switches to step 1): return with the existing args → existing poll → pool re-read → the EXISTING claim, byte-identical", async () => {
  let release;
  const state = { claimGate: new Promise((resolve) => { release = resolve; }) };
  const h = harness({ returnFlag: true, flag: true, backend: backendOf(state) });
  await startSwitch(h, 1);
  // (a) 退回：同一支 buildArgs、同一支 RPC、新的 command_uuid；退的是現在這一道（第 3 道）
  assert.equal(state.returns.length, 1);
  assert.deepEqual(state.returns[0], returnCore.buildArgs({ commandUuid: UUID, machineCode: "A05", poolItemId: CURRENT_KEY, orderNo: "TEST-WO-1", step: 3, partNo: "TEST-P1", reason: "", role: "operator" }));
  assert.deepEqual(state.returns[0], { p_command_uuid: UUID, p_machine_code: "A05", p_pool_item_id: CURRENT_KEY, p_expected_order_no: "TEST-WO-1", p_expected_index_sn: 3, p_expected_part_no: "TEST-P1", p_reason: null });
  assert.equal(h.urls("rpc/")[0].url, `rpc/${returnCore.SUBMIT_RPC}`);
  assert.equal(state.claims.length, 0, "nothing is claimed before the factory confirms the return");
  // 等待中：跟退回一樣鎖住，話說的是換道次；沒有第二顆可以按的送出
  assert.equal(h.api.locks("A05"), true);
  assert.equal(h.api.blockMessage("A05"), SWITCH_BUSY);
  assert.equal(h.api.blockMessage("A03"), "", "other machines are not blocked");
  assert.equal(h.api.markup(h.machine), '<p class="station-cmd-status is-wait" data-no-detail data-return-claim-status="pending" role="status">換道次處理中，等工廠處理…</p>');
  assert.match(h.sheetHtml(), /data-switch-step-result="returning"[^>]*><p>換道次處理中（1／2）：正在把第 3 道退回待做池，等工廠處理。請稍等，不要重按。</);
  assert.doesNotMatch(h.sheetHtml(), /data-return-claim-confirm|data-switch-step-choice=/, "no confirm button and no choices while in flight");
  await h.api.submit(); await h.api.submit();
  await h.api.open("A05", null, true);
  assert.equal(state.returns.length, 1, "pressing again / reopening sends nothing");
  // 存到 localStorage 的只有那一筆普通的退回：沒有要接哪一道
  const stored = h.storage.get(PENDING_KEY);
  assert.ok(stored.includes(UUID));
  assert.doesNotMatch(stored, /S1|switch|target/i, "nothing that could auto-claim after a reload is persisted");
  assert.deepEqual([...h.storage.keys()], [PENDING_KEY]);
  // 輪詢＝退回既有的那一支
  state.row = commandRow({ status: "claimed", claimed_at: new Date().toISOString() });
  await h.runPoll();
  assert.equal(h.calls.fetch.at(-1).url, returnCore.pollPath(UUID));
  assert.equal(state.claims.length, 0);
  assert.equal(h.api.blockMessage("A05"), SWITCH_BUSY);
  // (b) 退回 applied → 重讀待做池 → 接
  const poolReadsBefore = state.poolReads;
  state.row = appliedRow("unassigned");
  await h.runPoll();
  assert.equal(state.poolReads, poolReadsBefore + 1, "the pool is re-read after the return and before the claim");
  assert.equal(state.claims.length, 1, "claim sent");
  const order = h.calls.fetch.map((call) => call.url.split("?")[0]);
  assert.ok(order.lastIndexOf("dispatch_pool_items") < order.lastIndexOf("rpc/dispatch_pool_claim") && order.lastIndexOf("station_commands") < order.lastIndexOf("dispatch_pool_items"), "order: return result → pool re-read → claim");
  // 接單進行中：退回的等待紀錄已經收掉，但這台還是鎖著，說的還是換道次
  assert.deepEqual(Object.keys(h.api.machtileReturnClaim.pending), []);
  assert.equal(h.api.holds("A05"), true);
  assert.equal(h.api.locks("A05"), true);
  assert.equal(h.api.blockMessage("A05"), SWITCH_BUSY);
  assert.equal(h.api.markup(h.machine), '<p class="station-cmd-status is-wait" data-no-detail data-switch-step-status="claiming" role="status">換道次處理中（2／2）：第 3 道已退回，正在接第 1 道…</p>');
  assert.match(h.sheetHtml(), /data-switch-step-result="claiming"[^>]*><p>換道次處理中（2／2）：第 3 道已退回，正在接第 1 道…</);
  assert.equal(await h.api.claim(keyOf(2), "A05"), undefined, "any other claim for this machine is refused while the switch is running");
  assert.equal(state.claims.length, 1);
  assert.equal(h.api.machtileSwitchStep.claimPass, "", "the pass for the switch's own claim is not left open");
  release();
  await settle();
  // 接單的請求＝一般接單逐字相同（網址、方法、內容）
  const normal = await NORMAL_CLAIM;
  assert.deepEqual(JSON.parse(JSON.stringify(state.claims[0])), JSON.parse(JSON.stringify(normal)), "claim request identical to a normal claim");
  assert.equal(state.claims[0].init.body, normal.init.body, "payload byte-identical");
  assert.equal(state.claims[0].init.body, '{"p_source_key":"01|TEST-WO-1|S1","p_machine_code":"A05"}');
  // 結果
  assert.equal(h.calls.toasts.at(-1), "已換成第 1 道。原本的第 3 道已退回待做池。");
  assert.match(h.sheetHtml(), /data-switch-step-result="done"[^>]*><p>已換成第 1 道。原本的第 3 道已退回待做池。</);
  assert.equal(h.api.locks("A05"), false);
  assert.equal(h.api.blockMessage("A05"), "");
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileSwitchStep)), { active: {}, claimPass: "" });
  assert.equal(h.calls.reloads, 1, "the existing claim function reloads the cards");
  assert.deepEqual(h.calls.refresh, [], "no extra reload after a successful claim");
  assert.equal(h.pollTimers(), 0);
  assert.deepEqual([state.returns.length, state.claims.length], [1, 1], "exactly one return and one claim");
  assert.equal(h.storage.get(PENDING_KEY), "{}");
  // 重讀後卡片是新的那一道：留一行結果（2 分鐘）
  const after = h.api.markup({ code: "A05", name: "A05", status: "idle", order: heldOrder({ stationStep: 1, heldPoolKey: keyOf(1), process: "CNC車床加工", processId: "00000000-0000-4000-8000-000000000301" }) });
  assert.match(after, /^<p class="station-cmd-status is-ok"[^>]*data-return-claim-status="applied"[^>]*>已換成第 1 道。原本的第 3 道已退回待做池。<\/p>/);
});

test("stale_assignment_reconciled and already_returned also count as returned and go on to the claim", async () => {
  for (const mode of ["stale_assignment_reconciled", "already_returned"]) {
    const state = {};
    const h = harness({ returnFlag: true, flag: true, backend: backendOf(state) });
    await startSwitch(h, 2);
    state.row = appliedRow(mode);
    await h.runPoll();
    assert.equal(state.claims.length, 1, mode);
    assert.equal(state.claims[0].init.body, JSON.stringify(poolCore.claimArgs(keyOf(2), "A05")));
    assert.equal(h.calls.toasts.at(-1), "已換成第 2 道。原本的第 3 道已退回待做池。");
  }
});

test("return rejected (at submit or by the factory): nothing changed, the existing reject sentence, no claim, card not locked", async () => {
  // 送出當場被拒絕
  const atSubmit = { returnError: '400 {"code":"P0001","message":"CLAIM_ALREADY_STARTED"}' };
  const a = harness({ returnFlag: true, flag: true, backend: backendOf(atSubmit) });
  await startSwitch(a, 1);
  assert.match(a.sheetHtml(), /data-switch-step-result="return_rejected">沒有換道次，這台還是原本的第 3 道。</);
  assert.match(a.sheetHtml(), /data-switch-step-return-message>這張單已經開工或已有報工，不能退回。要換單請找生管。</);
  assert.doesNotMatch(a.sheetHtml(), /CLAIM_ALREADY_STARTED|data-return-claim-confirm/);
  assert.equal(a.api.locks("A05"), false);
  assert.equal(a.api.active("A05"), null);
  assert.deepEqual(JSON.parse(JSON.stringify(a.api.machtileSwitchStep)), { active: {}, claimPass: "" });
  assert.deepEqual([atSubmit.claims.length, a.pollTimers()], [0, 0]);
  assert.equal(a.api.markup(a.machine), RETURN_BUTTON + SWITCH_BUTTON, "both buttons are back");
  // 工廠拒絕（輪詢拿到）
  for (const [row, sentence, kind] of [
    [{ status: "rejected", reject_code: "CLAIM_ALREADY_STARTED", reject_message: "raw" }, "這張單已經開工或已有報工，不能退回。要換單請找生管。", "return_rejected"],
    [{ status: "rejected", reject_code: "LEGACY_STATE_INCONSISTENT" }, "舊 MES 的資料對不起來，系統不敢退回。請找生管處理。", "return_rejected"],
    [{ status: "expired", reject_code: "EXPIRED" }, "超過 10 分鐘工廠都沒有接手，這次沒有退回，工單還在這台。需要的話請再按一次。", "return_rejected"],
    [{ status: "rejected", reject_code: "OUTCOME_UNKNOWN" }, null, "return_unsure"],
    [{ status: "rejected", reject_code: "LEGACY_APPLIED_LATE" }, null, "return_unsure"],
  ]) {
    const state = {};
    const h = harness({ returnFlag: true, flag: true, backend: backendOf(state) });
    await startSwitch(h, 1);
    state.row = commandRow(row);
    await h.runPoll();
    const expected = sentence || dictionaries().zh.return_claim_err_outcome_unknown;
    assert.deepEqual(h.calls.toasts, [expected], `${row.reject_code}: the existing return sentence`);
    assert.ok(h.sheetHtml().includes(`data-switch-step-result="${kind}"`), row.reject_code);
    assert.ok(h.sheetHtml().includes(`<p>${kind === "return_unsure" ? "換道次停下來了，沒有幫你接第 1 道。" : "沒有換道次，這台還是原本的第 3 道。"}</p><p>${expected}</p>`), row.reject_code);
    if (kind === "return_unsure") assert.doesNotMatch(h.sheetHtml(), /沒有換道次|還是原本的/, "an uncertain factory answer is never worded as 'nothing changed'");
    assert.doesNotMatch(h.sheetHtml(), /CLAIM_ALREADY_STARTED|LEGACY_STATE_INCONSISTENT|OUTCOME_UNKNOWN|LEGACY_APPLIED_LATE|>raw</);
    assert.equal(state.claims.length, 0, `${row.reject_code}: no claim`);
    assert.equal(state.poolReads, 1, "no pool re-read for a claim (only the one when the sheet opened)");
    assert.equal(h.api.locks("A05"), false);
    assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileSwitchStep)), { active: {}, claimPass: "" });
    assert.deepEqual(h.calls.refresh, [["A05", "return_claim"]], "the card reloads as after any return result");
    assert.ok(h.api.markup(h.machine).includes(expected), "the card keeps the return sentence");
  }
});

test("return uncertain (network cut / timeout on submit): the switch stops there — a later applied result does NOT claim; resend is the plain same-uuid return", async () => {
  const state = { returnError: "Failed to fetch" };
  const h = harness({ returnFlag: true, flag: true, uuids: [UUID, UUID2], backend: backendOf(state) });
  await startSwitch(h, 1);
  assert.match(h.sheetHtml(), /data-return-claim-result="uncertain">網路不穩，還不知道有沒有送到。/);
  assert.match(h.sheetHtml(), /data-switch-step-stopped>換道次先停下來：還不知道退回有沒有成功，所以沒有幫你接第 1 道。等退回有結果後，請到「選工單」自己接。</);
  assert.match(h.sheetHtml(), /data-return-claim-confirm>用同一筆重送</, "the existing uncertain handling");
  assert.equal(h.api.active("A05"), null, "the switch is over");
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileSwitchStep)), { active: {}, claimPass: "" });
  assert.equal(h.api.locks("A05"), true, "the uncertain return itself still locks the card, as before");
  assert.equal(h.api.blockMessage("A05"), "這台有一筆「退回接單」還在等工廠處理，等它有結果再操作。", "now it is only a return");
  assert.match(h.api.markup(h.machine), /data-return-claim-status="uncertain"/);
  // 重送＝同一個 uuid、同樣內容的退回；不會重新變成換道次
  state.returnError = "";
  await h.api.submit();
  assert.equal(state.returns.length, 2);
  assert.deepEqual(state.returns[1], state.returns[0]);
  assert.equal(h.api.active("A05"), null);
  assert.match(h.sheetHtml(), /換道次先停下來/);
  state.row = appliedRow();
  await h.runPoll();
  assert.equal(state.claims.length, 0, "applied after an uncertain submit: no claim");
  assert.equal(state.poolReads, 1);
  assert.deepEqual(h.calls.toasts, ["已退回待做池，這台現在沒有工單。"]);
  assert.match(h.sheetHtml(), /data-switch-step-result="stopped_uncertain"[^>]*><p>已退回待做池，這台現在沒有工單。<\/p><p>換道次之前已經停下來，系統沒有自動接第 1 道。請到「選工單」自己接。</);
  assert.equal(h.api.locks("A05"), false);
  // 伺服器回的不是這一筆 → 一樣當成不確定，換道次停
  const odd = { };
  const o = harness({ returnFlag: true, flag: true, backend: async (url, init) => (url === "rpc/machtile_submit_return_claim_command" ? [commandRow({ command_uuid: UUID2 })] : backendOf(odd)(url, init)) });
  await startSwitch(o, 1);
  assert.equal(o.api.active("A05"), null);
  assert.match(o.sheetHtml(), /data-switch-step-stopped/);
});

test("returned, but the chosen step cannot be claimed: one honest sentence, at most one claim attempt, card reloaded and never left locked", async () => {
  const sentence = (reason, to = 1) => `原本那一道已經退回待做池，這台現在沒有工單；第 ${to} 道沒有接成功（${reason}）。請到「選工單」重新接。`;
  for (const [label, setup, expected, claims, poolReads] of [
    ["chosen step no longer in the pool", (s) => { s.pool = () => [poolRow(2)]; }, sentence("待做池裡已經沒有這一道"), 0, 1],
    ["chosen step no longer eligible for this machine", (s) => { s.pool = () => [poolRow(1, { eligible_machine_codes: ["A03"] })]; }, sentence("這台不能做這一道"), 0, 1],
    ["pool cannot be re-read", (s) => { s.poolFail = true; }, sentence("讀不到最新的待做池"), 0, core.POOL_READ_ATTEMPTS],
    ["claim refused: taken by another machine", (s) => { s.claimError = '400 {"code":"P0001","message":"POOL_ITEM_NOT_WAITING"}'; }, sentence("已經被別台接走"), 1, 1],
    ["claim refused: machine still has an order", (s) => { s.claimError = '400 {"code":"P0001","message":"MACHINE_ALREADY_ASSIGNED"}'; }, sentence("系統上這台還有未完成的工單"), 1, 1],
    ["claim refused: unknown code", (s) => { s.claimError = '400 {"code":"P0001","message":"SOME_NEW_CODE"}'; }, sentence("系統沒有接成功"), 1, 1],
    ["claim: network cut", (s) => { s.claimError = "Failed to fetch"; },
      "原本那一道已經退回待做池；第 1 道不確定有沒有接到（網路不穩）。請重新整理畫面看這台現在掛哪張單；沒有的話請到「選工單」重新接。", 1, 1],
  ]) {
    const state = {};
    const h = harness({ returnFlag: true, flag: true, backend: backendOf(state) });
    await startSwitch(h, 1);
    const readsBefore = state.poolReads;
    setup(state);
    state.row = appliedRow();
    await h.runPoll();
    assert.equal(h.calls.toasts.at(-1), expected, label);
    assert.equal(state.claims.length, claims, `${label}: claim attempts`);
    assert.equal(state.poolReads - readsBefore, poolReads + (claims && state.claimError ? 1 : 0), `${label}: pool reads (the existing claim function re-reads the pool once after a failure)`);
    assert.ok(h.sheetHtml().includes(`<p>${expected}</p>`), label);
    assert.match(h.sheetHtml(), new RegExp(`data-switch-step-result="${label.includes("network") ? "claim_uncertain" : "returned_not_claimed"}"`), label);
    assert.doesNotMatch(h.sheetHtml(), /POOL_ITEM_NOT_WAITING|MACHINE_ALREADY_ASSIGNED|SOME_NEW_CODE|data-return-claim-confirm/, `${label}: no raw code, no retry button`);
    assert.equal(h.api.locks("A05"), false, `${label}: card not left locked`);
    assert.equal(h.api.blockMessage("A05"), "");
    assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileSwitchStep)), { active: {}, claimPass: "" });
    assert.deepEqual(h.calls.refresh, [["A05", "return_claim"]], `${label}: the card and pool are reloaded so the machine shows its real state`);
    assert.equal(h.pollTimers(), 0);
    await settle(); await settle();
    assert.equal(state.claims.length, claims, `${label}: never retried`);
    // 機台重讀後是空的：卡片留那一句
    assert.equal(h.api.markup({ code: "A05", name: "A05", status: "idle", order: null }),
      `<p class="station-cmd-status is-warn" data-no-detail data-return-claim-status="applied" role="status">${expected}</p>`, label);
  }
  // 工廠沒碰機台（stale_assignment_reconciled）＋接單被拒：不可以說這台沒有工單
  const state = { claimError: '400 {"code":"P0001","message":"MACHINE_ALREADY_ASSIGNED"}' };
  const h = harness({ returnFlag: true, flag: true, backend: backendOf(state) });
  await startSwitch(h, 1);
  state.row = appliedRow("stale_assignment_reconciled");
  await h.runPoll();
  assert.equal(h.calls.toasts.at(-1), "原本那一道已經退回待做池，這台機台目前掛的工單沒有動；第 1 道沒有接成功（系統上這台還有未完成的工單）。請到「選工單」重新接。");
  // 另一筆接單正在處理（既有函式直接不送）
  const busy = {};
  const b = harness({ returnFlag: true, flag: true, backend: backendOf(busy) });
  await startSwitch(b, 1);
  b.api.poolState.claimBusy = "01|SOMETHING|ELSE";
  busy.row = appliedRow();
  await b.runPoll();
  assert.equal(b.calls.toasts.at(-1), sentence("另一筆接單正在處理"));
  assert.equal(busy.claims.length, 0);
  assert.equal(b.api.locks("A05"), false);
});

test("returned too late or with an unknown mode: no claim, said plainly", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const state = {};
    const h = harness({ returnFlag: true, flag: true, backend: backendOf(state) });
    await startSwitch(h, 1);
    now += core.CONTINUE_MAX_MS + 1000;
    state.row = appliedRow();
    await h.runPoll();
    assert.equal(state.claims.length, 0);
    assert.equal(state.poolReads, 1);
    assert.equal(h.calls.toasts.at(-1), "原本那一道已經退回待做池，這台現在沒有工單；第 1 道沒有接成功（工廠回覆太慢，系統沒有自動接）。請到「選工單」重新接。");
    assert.equal(h.api.locks("A05"), false);
    assert.deepEqual(h.calls.refresh, [["A05", "return_claim"]]);
  } finally { Date.now = realNow; }
  const state = {};
  const h = harness({ returnFlag: true, flag: true, backend: backendOf(state) });
  await startSwitch(h, 1);
  state.row = appliedRow("brand_new_mode");
  await h.runPoll();
  assert.equal(state.claims.length, 0);
  assert.equal(h.calls.toasts.at(-1), "原本那一道已經退回待做池，這台現在沒有工單；第 1 道沒有接成功（工廠的回覆系統看不懂，沒有自動接）。請到「選工單」重新接。");
  assert.equal(h.api.locks("A05"), false);
});

test("reload between the return and the claim: only the plain return is restored; step (b) is never continued", async () => {
  const state = {};
  const first = harness({ returnFlag: true, flag: true, backend: backendOf(state) });
  await startSwitch(first, 1);
  assert.equal(first.api.blockMessage("A05"), SWITCH_BUSY);
  // 平板重新整理：localStorage 還在，記憶體全部重來
  const second = harness({ returnFlag: true, flag: true, storage: first.storage, backend: backendOf(state) });
  state.returns.length = 0;
  second.api.restore();
  assert.equal(second.api.machtileReturnClaim.pending.A05.commandUuid, UUID, "the pending return is restored");
  assert.equal(second.api.active("A05"), null, "there is no switch after a reload");
  assert.equal(second.api.locks("A05"), true);
  assert.equal(second.api.blockMessage("A05"), "這台有一筆「退回接單」還在等工廠處理，等它有結果再操作。");
  assert.match(second.api.markup(second.machine), /data-return-claim-status="pending"[^>]*>退回中，等工廠處理…</);
  state.row = appliedRow();
  await second.runPoll();
  assert.deepEqual(second.calls.toasts, ["已退回待做池，這台現在沒有工單。"], "the real state: returned, machine empty");
  assert.equal(state.claims.length, 0, "no claim after a reload");
  assert.equal(second.urls("dispatch_pool_items").length, 0, "the pool is not even read");
  assert.equal(state.returns.length, 0, "nothing resubmitted");
  assert.deepEqual(second.calls.refresh, [["A05", "return_claim"]]);
  assert.equal(second.api.locks("A05"), false);
  assert.equal(second.storage.get(PENDING_KEY), "{}");
});

test("admin / planner: the reason is mandatory exactly as in return-claim and travels as p_reason", async () => {
  for (const role of ["admin", "planner"]) {
    const state = {};
    const h = harness({ returnFlag: true, flag: true, role, backend: backendOf(state) });
    await h.api.open("A05", null, true);
    assert.match(h.sheetHtml(), /data-return-claim-reason/);
    assert.match(h.sheetHtml(), /退回原因（必填）/);
    assert.match(h.sheetHtml(), /你是用管理員／生管身分代退，這筆會記成你按的。/);
    h.api.choose(keyOf(1));
    await h.api.submit();
    assert.equal(state.returns.length, 0, "nothing is sent without a reason");
    assert.equal(h.api.active("A05"), null, "and no switch is registered");
    assert.match(h.sheetHtml(), /代退要寫原因，請填一句話。/);
    h.api.machtileReturnClaim.sheet.reason = "x".repeat(returnCore.REASON_MAX + 1);
    await h.api.submit();
    assert.equal(state.returns.length, 0);
    assert.match(h.sheetHtml(), /原因太長了，最多 500 個字。/);
    h.api.machtileReturnClaim.sheet.reason = "  生管：道次接錯  ";
    await h.api.submit();
    assert.equal(state.returns[0].p_reason, "生管：道次接錯");
    assert.deepEqual(state.returns[0], returnCore.buildArgs({ commandUuid: UUID, machineCode: "A05", poolItemId: CURRENT_KEY, orderNo: "TEST-WO-1", step: 3, partNo: "TEST-P1", reason: "生管：道次接錯", role }));
    state.row = appliedRow();
    await h.runPoll();
    assert.equal(state.claims[0].init.body, (await NORMAL_CLAIM).init.body, "the claim has no reason field: identical to a normal claim");
  }
});

test("click delegation: the card button opens the switch sheet; choices are picked inside the sheet", async () => {
  const state = {};
  const h = harness({ returnFlag: true, flag: true, backend: backendOf(state) });
  const target = (hits) => ({ closest: (selector) => (Object.prototype.hasOwnProperty.call(hits, selector) ? { dataset: hits[selector] } : null) });
  assert.equal(h.api.handleClick({ target: target({ "[data-switch-step-open]": { switchStepOpen: "A05" } }) }), true);
  await settle();
  assert.match(h.sheetHtml(), /data-switch-step-sheet="A05"/);
  assert.equal(h.api.handleClick({ target: target({ "#machtileReturnClaimSheet [data-switch-step-choice]": { switchStepChoice: keyOf(2) }, "#machtileReturnClaimSheet": {} }) }), true);
  assert.match(h.sheetHtml(), /data-switch-step-confirm >換成第 2 道</);
  assert.equal(h.api.handleClick({ target: target({ "[data-return-claim-confirm]": {}, "#machtileReturnClaimSheet": {} }) }), true);
  await settle();
  assert.equal(state.returns.length, 1, "the confirm button goes through the existing return submit");
  assert.equal(h.api.active("A05").target.step, 2);
});

// ---------------------------------------------------------------- 池列鍵從待做池自己查（不靠 work_orders.external_ref）
const claimedRow = (step, extra) => Object.assign({ source_key: keyOf(step), work_order_no: "TEST-WO-1", process_order: step, status: "claimed" }, extra);

test("after a switch (3 → 1) the new step's card shows both buttons again, and the next return/switch carries the NEW step's pool row", async () => {
  // 換完之後雲端的樣子：work_orders.external_ref 還是第 3 道（第一次接的那一道，on conflict 不更新）；機台上掛的是第 1 道；
  // 池裡第 1 道 claimed、第 3 道退回後 waiting、第 2 道一直 waiting。
  const after = heldOrder({ stationStep: 1, process: "CNC車床加工", processId: "00000000-0000-4000-8000-000000000301", heldPoolKey: undefined,
    dispatchPoolSourceKey: keyOf(3), dispatchPoolStatus: "waiting" });
  const state = { held: () => [claimedRow(1)], pool: () => [poolRow(2), poolRow(3, { source_status: "returned" }), OTHER_ORDER_ROW] };
  const backend = backendOf(state);
  const h = harness({ returnFlag: true, flag: true, order: after, assigned: [after], pool: [poolRow(2), poolRow(3, { source_status: "returned" }), OTHER_ORDER_ROW],
    backend: async (url, init) => (url.startsWith("work_order_processes?") ? freshRow({ id: after.processId, process_order: 1, process_name: "CNC車床加工" }) : backend(url, init)) });
  assert.equal(h.api.markup(h.machine), "", "before the lookup of this load: no button (the stale external_ref key is not used)");
  await h.api.loadHeldKeys(7);
  assert.equal(state.heldReads, 1);
  assert.equal(after.heldPoolKey, keyOf(1));
  assert.equal(h.api.markup(h.machine), RETURN_BUTTON + SWITCH_BUTTON, "both buttons on the new step's card");
  assert.deepEqual(h.api.gate(h.machine).choices.map((choice) => choice.step), [2, 3], "the other steps: 2 and the one just returned (3); not the held step 1");
  // 再換一次（1 → 3）：退回的是第 1 道的池列
  await h.api.open("A05", null, true);
  assert.match(h.sheetHtml(), /data-switch-step-current>現在掛的：第 1 道 · CNC車床加工</);
  assert.equal(h.sheetHtml().split("data-switch-step-choice=").length, 3);
  h.api.choose(keyOf(3));
  await h.api.submit();
  await settle();
  assert.equal(state.returns.length, 1);
  assert.equal(state.returns[0].p_pool_item_id, keyOf(1), "the return names the pool row of the step the machine holds now");
  assert.equal(state.returns[0].p_expected_index_sn, 1);
  assert.equal(h.api.active("A05").target.sourceKey, keyOf(3));
});

test("held step ≠ first-claimed step, ambiguous or missing pool row: 「換道次」 follows the same fail-closed lookup as 「接錯了，退回」", async () => {
  const run = async (held) => {
    const order = heldOrder({ heldPoolKey: undefined, dispatchPoolSourceKey: keyOf(1), dispatchPoolStatus: "waiting" });   // external_ref＝第 1 道；機台上是第 3 道
    const state = { held };
    const h = harness({ returnFlag: true, flag: true, order, assigned: [order], backend: backendOf(state) });
    await h.api.loadHeldKeys(7);
    return { h, order, state };
  };
  const good = await run(() => [claimedRow(3)]);
  assert.equal(good.order.heldPoolKey, keyOf(3));
  assert.equal(good.h.api.markup(good.h.machine), RETURN_BUTTON + SWITCH_BUTTON);
  assert.deepEqual(good.h.api.gate(good.h.machine).choices.map((choice) => choice.sourceKey), [keyOf(1), keyOf(2)], "step 1 (the first-claimed one, back in the pool) is offered, not mistaken for the held step");
  for (const [label, held] of [
    ["no claimed row", () => []],
    ["two claimed rows for the held step", () => [claimedRow(3), claimedRow(3, { source_key: "01|TEST-WO-1|S3-DUP" })]],
    ["only another step is claimed", () => [claimedRow(1)]],
    ["read failed", () => { throw new TypeError("Failed to fetch"); }],
  ]) {
    const bad = await run(held);
    assert.equal(bad.order.heldPoolKey, "", label);
    assert.equal(bad.h.api.markup(bad.h.machine), "", `${label}: neither button`);
    assert.equal(bad.h.api.gate(bad.h.machine).reason, "return_hidden", label);
    await bad.h.api.open("A05", null, true);
    assert.equal(bad.h.sheetHtml(), "", `${label}: the sheet does not open`);
    assert.deepEqual([bad.state.returns.length, bad.state.claims.length], [0, 0]);
  }
});

// ---------------------------------------------------------------- 旗標關＝跟「只有退回」那一版逐字相同（原始碼層）
test("app.js minus the switch-step section and its listed hooks is byte-identical to the return-claim build; other files only gain what is listed", (t) => {
  const git = (args) => childProcess.execFileSync("git", args, { cwd: __dirname, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const base = process.env.SWITCH_STEP_BASE || "68c86b4feea120be569ae10e22a894a36e0a77fd";
  let baseApp;
  try { baseApp = git(["show", `${base}:app.js`]); } catch { t.skip("git base (return-claim build) not available"); return; }
  const norm = (text) => text.replace(/\r\n/g, "\n");
  baseApp = norm(baseApp);
  assert.doesNotMatch(baseApp, /machtileSwitchStep/, "the base has no switch-step code");
  let current = norm(appSource);
  const section = norm(switchSource);
  assert.equal(current.split(section).length, 2);
  current = current.replace(section, () => "");
  // 每一個掛進既有程式的地方：[現在的字串, 旗標關時等價的原字串]。旗標關時（上面「flag off」那個測試逐一斷言）
  // machtileSwitchStepHolds()＝false、ClaimPass()＝false、Active()＝null、ButtonMarkup()＝""、HandleClick()＝false、
  // AfterReturn()＝false、sheet.switchStep 不存在、last.view.switchStep 不存在，所以每一個都等於原字串。
  const hooks = [
    ["  if (!machtileReturnClaimEnabled()) return false;\n  if (machtileSwitchStepHolds(code)) return true;\n", "  if (!machtileReturnClaimEnabled()) return false;\n"],
    ["  if (machtileSwitchStepClaimPass(code)) return \"\";\n  return machtileReturnClaimLocks(code) ? machtileTranslate(machtileSwitchStepActive(code) ? \"switch_step_busy\" : \"return_claim_busy\") : \"\";\n",
      "  return machtileReturnClaimLocks(code) ? machtileTranslate(\"return_claim_busy\") : \"\";\n"],
    ["  if (machtileSwitchStepHolds(code)) return machtileSwitchStepHoldingMarkup(code);\n", ""],
    ["role=\"status\">${escapeHtml(machtileTranslate(machtileSwitchStepActive(code) ? \"switch_step_busy\" : \"return_claim_busy\"))}</p>`;", "role=\"status\">${escapeHtml(machtileTranslate(\"return_claim_busy\"))}</p>`;"],
    ["? \"return_claim_card_slow\" : machtileSwitchStepActive(code) ? \"switch_step_card_pending\" : \"return_claim_card_pending\";", "? \"return_claim_card_slow\" : \"return_claim_card_pending\";"],
    ["${escapeHtml(last.view.switchStep ? machtileSwitchStepText(last.view) : machtileTranslate(last.view.messageKey))}", "${escapeHtml(machtileTranslate(last.view.messageKey))}"],
    ["  return note + button + machtileSwitchStepButtonMarkup(machine);\n", "  return note + button;\n"],
    ["  if (sheet.switchStep) { machtileSwitchStepRenderSheet(sheet, holder, focus); return; }\n", ""],
    ["async function machtileReturnClaimOpen(code, returnFocus, switchStep = false) {", "async function machtileReturnClaimOpen(code, returnFocus) {"],
    ["  if (switchStep && !machtileSwitchStepGate(machine).show) return;\n", ""],
    ["    ...(switchStep ? { switchStep: machtileSwitchStepNewState() } : {}),\n", ""],
    ["  if (sheet.switchStep && machtileReturnClaim.sheet === sheet) await machtileSwitchStepLoadChoices(sheet);\n", ""],
    ["    if (sheet.switchStep && !machtileSwitchStepBegin(sheet)) return;\n", ""],
    ["  const uncertain = () => {\n    machtileSwitchStepStop(sheet);\n", "  const uncertain = () => {\n"],
    ["info.code || info.kind, error);\n    machtileSwitchStepStop(sheet);\n", "info.code || info.kind, error);\n"],
    ["  if (machtileSwitchStepAfterReturn(code, rec, view)) return;\n", ""],
    ["  if (machtileSwitchStepHandleClick(target)) return true;\n", ""],
    // 既有接單函式多回一個結果物件；原本的呼叫端（`void machtileClaimDispatchPool(...)`）不看回傳值
    ["    showToast(machtileTranslate(\"claim_success\"), \"success\");\n    return { ok: true };\n", "    showToast(machtileTranslate(\"claim_success\"), \"success\");\n"],
    ["    await machtileLoadDispatchPool();\n    return { ok: false, error };\n  } finally {", "    await machtileLoadDispatchPool();\n  } finally {"],
  ];
  for (const [now, before] of hooks) {
    assert.equal(current.split(now).length, 2, `hook must appear exactly once: ${now.slice(0, 70)}`);
    current = current.replace(now, () => before);
  }
  // ---- 不是「換道次旗標關＝等於原字串」的那一類：下面幾處是修正「池列鍵靠 work_orders.external_ref」的錯（退回與換道次共用），
  //      enableReturnClaim 開著就生效，跟 enableSwitchStep 無關；enableReturnClaim 關＝都不執行（退回那支測試的「flag off」與
  //      它的 base 對照測試負責證明）。這裡只是把它們逐一列出來、還原，證明除此之外沒有別的差異。
  const cut = (text, from, to) => {
    const start = text.indexOf(from);
    const end = text.indexOf(to, start);
    assert.ok(start >= 0 && end > start && text.indexOf(from, start + 1) === -1, `must appear exactly once: ${from.slice(0, 50)}`);
    return text.slice(0, start) + text.slice(end);
  };
  const heldKeyFix = [
    ["async function machtileLoadAssignedDispatchPoolStatuses(generation = machtileDeferredLoadGeneration) {\n  if (machtileReturnClaimEnabled()) await machtileReturnClaimLoadHeldPoolKeys(generation);   // 「接錯了，退回」／「換道次」用的池列鍵（旗標關＝不叫）\n",
      "async function machtileLoadAssignedDispatchPoolStatuses(generation = machtileDeferredLoadGeneration) {\n"],
    ["fields: { poolItemId: order.heldPoolKey, orderNo: order.id,", "fields: { poolItemId: order.dispatchPoolSourceKey, orderNo: order.id,"],
  ];
  for (const [now, before] of heldKeyFix) {
    assert.equal(current.split(now).length, 2, `held-key fix must appear exactly once: ${now.slice(0, 70)}`);
    current = current.replace(now, () => before);
  }
  current = cut(current, "// 卡片明細載入時叫（旗標開才會進來）", "function machtileReturnClaimGate(machine) {");
  assert.doesNotMatch(current, /heldPoolKey|HeldPoolKeys|heldPoolPath/, "no other held-key reference outside the switch-step section");
  assert.doesNotMatch(current, /machtileSwitchStep|enableSwitchStep|switch_step|switchStep/, "no other switch-step reference in app.js");
  assert.equal(current, baseApp, "with the section removed and the hooks reverted, app.js is byte-identical to the return-claim build");
  assert.doesNotMatch(appSource, /void machtileClaimDispatchPool\([^)]*\)[^;]*;[^\n]*\.ok/, "sanity");
  assert.equal([...appSource.matchAll(/machtileClaimDispatchPool\(/g)].length, 3, "the claim function has exactly one new caller (definition, the pool panel's click handler, the switch)");
  // 其他檔案
  const show = (file) => norm(git(["show", `${base}:${file}`]));
  const read = (file) => norm(fs.readFileSync(path.join(__dirname, file), "utf8"));
  // returnClaimCore.js：只多了池列鍵那幾樣（同一個修正），其餘逐字相同
  let returnCoreNow = read("returnClaimCore.js");
  returnCoreNow = cut(returnCoreNow, "  // 機台上這一道的池列鍵（source_key）＝從待做池自己查", "  const ROLES = Object.freeze(");
  returnCoreNow = cut(returnCoreNow, "  // ---------------------------------------------------------------- 機台上這一道的池列鍵\n", "  // ---------------------------------------------------------------- 卡片要不要出現「接錯了，退回」");
  for (const [now, before] of [
    ["  // 「接了、還沒開工」＝這一道在待做池裡剛好有一列 claimed（order.heldPoolKey，這次載入用 heldPoolKey 查到的）、\n",
      "  // 「接了、還沒開工」＝這張單是從待做池接的（工單來源 dispatch_pool＋池列狀態 claimed，這次載入有核對到）、\n"],
    ["    if (cardDetailsReady !== true) return no(\"pool_status_unverified\");\n    const poolItemId = text(order.heldPoolKey);\n    if (poolItemId.length < 5 || poolItemId.length > 120) return no(\"pool_not_claimed\");\n",
      "    const poolItemId = text(order.dispatchPoolSourceKey);\n    if (poolItemId.length < 5 || poolItemId.length > 120) return no(\"not_from_pool\");\n    if (cardDetailsReady !== true) return no(\"pool_status_unverified\");\n    if (text(order.dispatchPoolStatus) !== \"claimed\") return no(\"pool_not_claimed\");\n"],
    ["    HELD_POOL_PATH_PREFIX, HELD_POOL_ROW_LIMIT, heldPoolPath, heldPoolKey,\n", ""],
  ]) {
    assert.equal(returnCoreNow.split(now).length, 2, `returnClaimCore.js change must appear exactly once: ${now.slice(0, 60)}`);
    returnCoreNow = returnCoreNow.replace(now, () => before);
  }
  assert.equal(returnCoreNow, show("returnClaimCore.js"), "returnClaimCore.js: only the held-pool-key lookup and the visibility lines that use it");
  for (const file of ["dispatchPoolCore.js", "stationCommandCore.js", "fixtures/return_claim_poll_select.txt", "version.json", "sw.js"]) {
    assert.equal(read(file), show(file), `${file} is unchanged`);
  }
  const config = read("config.js");
  assert.match(config, /\n  enableSwitchStep: false,\n/);
  assert.equal(config.split("\n").filter((line) => !/enableSwitchStep|換道次|enableReturnClaim 也要開才有效/.test(line)).join("\n"), show("config.js"), "config.js: only the new default-off flag and its comment");
  assert.equal(read("index.html").split("\n").filter((line) => !line.includes("./switchStepCore.js?v=")).join("\n"), show("index.html"), "index.html: only the new core script tag (same version string)");
  assert.equal(read("styles.css").split("\n").filter((line) => !/switch-step|換道次確認卡/.test(line)).join("\n"), show("styles.css"), "styles.css: only the new .switch-step-* rules");
  for (const file of ["i18n.js", "locales/zh-Hant.json", "locales/vi.json"]) {
    const removed = [], added = [];
    const baseLines = show(file).split("\n"), nowLines = read(file).split("\n");
    const baseSet = new Set(baseLines), nowSet = new Set(nowLines);
    baseLines.forEach((line) => { if (!nowSet.has(line)) removed.push(line); });
    nowLines.forEach((line) => { if (!baseSet.has(line)) added.push(line); });
    assert.ok(added.filter((line) => !/switch_step_|換道次（switch step/.test(line)).every((line) => removed.some((old) => line.replace(/,(\s*\/\/ _draft)?$/, "$1") === old.replace(/,(\s*\/\/ _draft)?$/, "$1") || line === `${old},`)),
      `${file}: only switch_step_ entries are added (plus the comma after the previous last entry)`);
    assert.ok(removed.length <= 1, `${file}: no existing string changed`);
  }
  // 沒有新的 station_commands select，也沒有新的資料表查詢
  assert.doesNotMatch(section, /\?select=/, "the switch-step section adds no select");
  // app.js 也沒有多任何寫死的 select：新的那一個查詢路徑由 returnClaimCore.heldPoolPath 組（stationCommandPollColumns.test.js 逐欄核對）
  assert.equal([...norm(appSource).matchAll(/\?select=/g)].length, [...baseApp.matchAll(/\?select=/g)].length, "app.js gains no literal select");
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "switchStepCore.js"), "utf8").replace(/^\s*\/\/.*$/gm, ""), /\?select=|fetch\(|localStorage|sessionStorage|document\.|window\./, "the core does no I/O");
  assert.doesNotMatch(section.replace(/^\s*\/\/.*$/gm, ""), /localStorage|sessionStorage|indexedDB/, "the switch-step section persists nothing (comments aside)");
  assert.doesNotMatch(section, /(?:const|let|var)\s+\w+\s*=\s*machtile\w*Core\s*[;,]/, "no core aliases (coreExportsUsed must see every member)");
});
