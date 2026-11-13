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
    claiming: { claim_ok: "done", claim_failed: "returned_not_claimed", claim_uncertain: "claim_uncertain", claim_ok_unrefreshed: "claimed_refresh_failed" },
  });
  assert.deepEqual([...core.TERMINAL_STATES], ["closed", "return_rejected", "return_unsure", "stopped_uncertain", "returned_not_claimed", "claim_uncertain", "claimed_refresh_failed", "done"]);
  assert.equal(core.next("claiming", "claim_ok_unrefreshed"), "claimed_refresh_failed");
  assert.equal(core.claimAllowed("claimed_refresh_failed") || core.holds("claimed_refresh_failed"), false, "claimed-but-not-refreshed ends the flow: no lock, no second claim");
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
  // 接單 RPC 成功、之後重讀畫面出錯：不管錯誤長什麼樣子（401、4xx 碼、斷線）都是「接到了」，不是沒接到、也不是不確定
  for (const message of ["401 unauthorized", '400 {"code":"P0001","message":"POOL_ITEM_NOT_WAITING"}', "Failed to fetch", "SWITCH_STEP_TIMEOUT", "503 upstream"]) {
    assert.deepEqual(core.claimEvent({ ok: false, claimed: true, error: new Error(message) }), { event: "claim_ok_unrefreshed", reasonKey: "" }, message);
  }
  assert.deepEqual(core.claimEvent({ ok: false, claimed: true }), { event: "claim_ok_unrefreshed", reasonKey: "" });
  // claimed 只認嚴格的 true；沒有它＝照舊判斷
  for (const claimed of [false, undefined, null, "true", 1]) {
    assert.deepEqual(core.claimEvent({ ok: false, claimed, error: new Error("401 unauthorized") }), { event: "claim_failed", reasonKey: "switch_step_reason_login" }, String(claimed));
  }
  assert.deepEqual(core.claimEvent({ ok: true, claimed: true }), { event: "claim_ok", reasonKey: "" });
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
  // 接到了、但畫面沒更新：自己的一句，不說沒接到、不說不確定、不叫人去「選工單」再接
  for (const mode of core.APPLIED_MODES) {
    const stale = core.outcome({ state: "claimed_refresh_failed", mode, from: 3, to: 1, reasonKey: "switch_step_reason_login" });
    assert.equal(say(stale), "已換成第 1 道（原本的第 3 道已退回待做池），但畫面沒有更新成功。請重新整理畫面。", mode);
    assert.deepEqual({ state: stale.state, tone: stale.tone, phase: stale.phase, reasonKey: stale.reasonKey, messageKey: stale.messageKey },
      { state: "claimed_refresh_failed", tone: "warn", phase: "applied", reasonKey: "", messageKey: "switch_step_claimed_refresh_failed" });
    assert.doesNotMatch(say(stale), /沒有接成功|不確定|選工單/);
  }
  assert.equal(fill(d.vi.switch_step_claimed_refresh_failed, { from: 3, to: 1 }),
    "Đã đổi sang công đoạn 1 (công đoạn 3 ban đầu đã được trả về danh sách chờ), nhưng màn hình chưa cập nhật được. Hãy tải lại màn hình.");
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
    // 第 1 階段：除了「等一下、不要重按」那一句，沒有任何一句叫人再按一次（第 2 階段的規則在它自己的測試裡）
    if (key !== "switch_step_progress_return" && !key.startsWith("switch_step_started_")) assert.doesNotMatch(d.zh[key], /再按|重按|重送|再試|重試/, `${key} zh-Hant`);
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
// 第 2 階段（已開工）那一段：緊接在「接錯了，退回」block 前面，Locks 掛在 machtileReturnClaimLocks／BlockMessage 第一行，vm 裡也要有它
const startedSource = slice("// ==== 換道次（已開工、還沒報工；第 2 階段）", `// ============================================================================================${NL}// 機台卡片「接錯了，退回」`);
// 第 2 階段掛進既有程式的每一個地方：[現在的字串, 旗標關時等價的原字串]（換行已正規化成 \n）
const STARTED_HOOKS = [
  ["function machtileReturnClaimLocks(code) {\n  if (machtileSwitchStartedLocks(code)) return true;\n", "function machtileReturnClaimLocks(code) {\n"],
  ["function machtileReturnClaimBlockMessage(code) {\n  if (machtileSwitchStartedLocks(code)) return machtileTranslate(\"switch_step_started_busy\");\n", "function machtileReturnClaimBlockMessage(code) {\n"],
  ["  machtileSwitchStartedRestore();   // 「換道次（已開工）」等結果中的那筆＋不在待做池提醒（旗標關＝什麼都不做）\n", ""],
  ["${machtileSwitchStartedCardMarkup(machine)}", ""],
  ["    if (machtileSwitchStartedHandleClick(event)) return;\n", ""],
  ["  if (machtileAuthState.userId !== (authResponse?.user?.id || jwtPayload.sub || \"\")) machtileSwitchStartedForgetUser();\n", ""],
  ["  machtileSwitchStartedForgetUser();\n  machtileSwitchStepForgetUser();\n", "  machtileSwitchStepForgetUser();\n"],
];
const poolSource = slice("const machtileDispatchPoolState = {", "function machtileDispatchPoolOpenRefreshState(machine) {");
const claimSource = slice("async function machtileClaimDispatchPool(sourceKey, machineCode, switchStep = null) {", "async function machtileReplaceStoppedDispatchPool(sourceKey, machineCode) {");
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
const NEVER = new Promise(() => {});   // 一個永遠不會回來的請求（卡住的網路）

// 假後端：退回送出／輪詢、待做池清單、接單。state 可以中途改。
function backendOf(state) {
  Object.assign(state, { returns: [], claims: [], poolReads: 0, row: null, ...state });
  return async (url, init) => {
    if (url.startsWith("work_order_processes?")) return freshRow();
    if (url === `rpc/${returnCore.HELD_CLAIMS_RPC}`) {
      // 卡片明細載入時問「機台上這一道是帳本裡哪一筆接單」（唯讀 RPC machtile_held_pool_claims，不帶參數）
      assert.deepEqual([init.method, init.body], ["POST", "{}"]);
      state.heldReads = (state.heldReads || 0) + 1;
      return state.held ? state.held() : [];
    }
    if (url.startsWith("dispatch_pool_items?")) {
      assert.equal(url, POOL_URL, "the pool is re-read with the existing select (no new select)");
      state.poolReads += 1;
      if (state.poolHang) await NEVER;
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
      // claimAbortable＝像真的 fetch：signal 被中止就馬上以 AbortError 結束；沒設＝中止不了的請求（照 claimGate 等）
      if (state.claimGate && state.claimAbortable && init.signal) {
        await Promise.race([state.claimGate, new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => { state.claimAborted = (state.claimAborted || 0) + 1; reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" })); });
        })]);
      } else if (state.claimGate) await state.claimGate;
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
  let timerSeq = 0;
  const holders = {};
  const storage = options.storage instanceof Map ? options.storage : new Map(Object.entries(options.storage || {}));
  const calls = { fetch: [], toasts: [], rerenders: 0, refresh: [], storageReads: 0, reloads: 0, closedSelection: 0 };
  const selectionUpdates = [];   // 換道次放開 claimBusy 時叫既有的面板更新（不放進 calls：既有測試逐欄比對 calls）
  const machine = { code: "A05", name: "A05", status: options.machineStatus || "idle", order: options.order === undefined ? heldOrder() : options.order, isUnassignedBucket: false };
  const config = { dispatchPoolMachines: ["A03", "A05"] };
  if (options.returnFlag !== undefined) config.enableReturnClaim = options.returnFlag;
  if (options.flag !== undefined) config.enableSwitchStep = options.flag;
  if (options.started !== undefined) config.enableSwitchStepStarted = options.started;
  if (options.started !== undefined) config.switchStepStartedMachines = options.startedMachines === undefined ? ["A05"] : options.startedMachines;
  if (options.allowUnpooled !== undefined) config.switchStepStartedAllowUnpooled = options.allowUnpooled;
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
    machtileAuthState: Object.assign({}, SESSION, options.userId === undefined ? {} : { userId: options.userId }),
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
    machtileUpdateDispatchPoolSelection: (code) => { selectionUpdates.push(code); return true; },
    machtileOpenCardSelection() {}, machtileCardSelectionReopenOptions() { return {}; }, machtilePickOrderConfirm: () => true,
    loadFromSupabase: async (...args) => { calls.reloads += 1; if (options.reload) await options.reload(...args); }, deriveMachines() {}, renderAll() {},
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
    setTimeout: (fn, ms) => { timerSeq += 1; timers.push({ fn, ms, id: `t${timerSeq}` }); return ms === stationCore.SUBMIT_TIMEOUT_MS ? `t${timerSeq}` : timers.length; },
    // 既有的輪詢計時器照舊不清（跟原本一樣）；只有「逾時期限」（SUBMIT_TIMEOUT_MS）被清掉時真的拿掉，才數得出還有幾個期限沒結束
    clearTimeout: (id) => { const index = timers.findIndex((timer) => timer.id === id && timer.ms === stationCore.SUBMIT_TIMEOUT_MS); if (index >= 0) timers.splice(index, 1); },
    AbortController, console: { warn() {}, log() {} }, Date, JSON, Object, Array, Number, String, Boolean, Error, Map, Set, TypeError,
  };
  const api = vm.runInNewContext(`${poolSource}
    ${claimSource}
    ${startedSource}
    ${blockSource}
    ({ machtileReturnClaim, machtileSwitchStep, poolState: machtileDispatchPoolState, claim: machtileClaimDispatchPool,
       returnEnabled: machtileReturnClaimEnabled, enabled: machtileSwitchStepEnabled, locks: machtileReturnClaimLocks, blockMessage: machtileReturnClaimBlockMessage,
       markup: machtileReturnClaimCardMarkup, buttonMarkup: machtileSwitchStepButtonMarkup, gate: machtileSwitchStepGate, active: machtileSwitchStepActive,
       holds: machtileSwitchStepHolds, restore: machtileReturnClaimRestore, open: machtileReturnClaimOpen, openRetry: machtileReturnClaimOpenRetry,
       choose: machtileSwitchStepChoose, submit: machtileReturnClaimSubmit, handleClick: machtileReturnClaimHandleClick, switchClick: machtileSwitchStepHandleClick,
       closeSheet: machtileReturnClaimCloseSheet, loadHeldKeys: machtileReturnClaimLoadHeldPoolKeys, forgetUser: machtileSwitchStepForgetUser,
       started: { state: machtileSwitchStarted, enabled: machtileSwitchStartedEnabled, gate: machtileSwitchStartedGate, markup: machtileSwitchStartedCardMarkup,
         locks: machtileSwitchStartedLocks, open: machtileSwitchStartedOpen, choose: machtileSwitchStartedChoose, submit: machtileSwitchStartedSubmit,
         openRetry: machtileSwitchStartedOpenRetry, restore: machtileSwitchStartedRestore, handleClick: machtileSwitchStartedHandleClick,
         loadNotices: machtileSwitchStartedLoadNotices, forgetUser: machtileSwitchStartedForgetUser, closeSheet: machtileSwitchStartedCloseSheet } })`, context);
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
  // 換道次的等待期限（setTimeout SUBMIT_TIMEOUT_MS）：測試裡時間不會自己走，由這裡讓「最早排的那一個期限」到期
  const timeouts = () => timers.filter((timer) => timer.ms === stationCore.SUBMIT_TIMEOUT_MS).length;
  const expire = async () => {
    const index = timers.findIndex((timer) => timer.ms === stationCore.SUBMIT_TIMEOUT_MS);
    assert.ok(index >= 0, "a switch-step time limit must be pending");
    const [timer] = timers.splice(index, 1);
    timer.fn();
    await settle();
  };
  const startedSheetHtml = () => holders.machtileSwitchStartedSheet?.innerHTML || "";
  return { api, calls, machine, storage, sheetHtml, startedSheetHtml, runPoll, pollTimers, urls, context, timeouts, expire, holders, selectionUpdates };
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
  // 換道次的接單多帶一個 signal（等不到時中止用，不會送到伺服器）；網址、方法、內容跟一般接單逐字相同
  assert.deepEqual(Object.keys(state.claims[0].init), ["method", "body", "signal"]);
  assert.equal(state.claims[0].init.signal.aborted, false, "a claim that completes is never aborted");
  const { signal: _signal, ...sentInit } = state.claims[0].init;
  assert.deepEqual(JSON.parse(JSON.stringify({ url: state.claims[0].url, init: sentInit })), JSON.parse(JSON.stringify(normal)), "claim request identical to a normal claim");
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

test("claims the held-claims RPC lists but the server will not return (not mine / not yet acknowledged / already started): 「換道次」 stops with one plain sentence, no claim, no retry", async () => {
  const d = dictionaries();
  for (const [code, sentence] of [["NOT_CLAIM_OWNER", "這張單不是你接的，你不能退回。請找接單的人或生管。"],
    ["CLAIM_NOT_APPLIED", "接單還沒被工廠確認，現在不能退回。請等一兩分鐘再試。"],
    ["CLAIM_ALREADY_STARTED", "這張單已經開工或已有報工，不能退回。要換單請找生管。"]]) {
    assert.equal(d.zh[returnCore.REJECT_MESSAGE_KEY[code]], sentence, code);
    for (const viaPoll of [false, true]) {
      const label = `${code} ${viaPoll ? "from Factory (poll)" : "at submit"}`;
      const state = viaPoll ? {} : { returnError: `400 {"code":"P0001","message":"${code}","details":null,"hint":null}` };
      const h = harness({ returnFlag: true, flag: true, backend: backendOf(state) });
      await startSwitch(h, 1);
      if (viaPoll) { state.row = commandRow({ status: "rejected", reject_code: code, reject_message: "raw factory text" }); await h.runPoll(); }
      await settle();
      assert.ok(h.sheetHtml().includes('data-switch-step-result="return_rejected"'), label);
      assert.ok(h.sheetHtml().includes("沒有換道次，這台還是原本的第 3 道。") && h.sheetHtml().includes(sentence), `${label}: nothing changed + why / what to do`);
      assert.doesNotMatch(`${h.sheetHtml()}\n${h.calls.toasts.join("\n")}`, new RegExp(`${code}|raw factory text|MISSING:`), `${label}: no raw code`);
      assert.doesNotMatch(h.sheetHtml(), /data-return-claim-confirm|data-switch-step-confirm/, `${label}: nothing to press again in the sheet`);
      assert.deepEqual([state.returns.length, state.claims.length], [1, 0], `${label}: one return submit, no claim`);
      assert.equal(h.pollTimers(), 0, `${label}: no further poll, no automatic retry`);
      assert.equal(h.api.locks("A05"), false, label);
      assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileSwitchStep)), { active: {}, claimPass: "" }, label);
    }
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

// ================================================================ 審查修正（opus L3 @ c0e7af04）
test("MEDIUM-1: claim RPC succeeded but the screen reload failed → reported as CLAIMED (screen not refreshed), one toast, never 'not claimed'", async () => {
  const CLAIMED = "已換成第 1 道（原本的第 3 道已退回待做池），但畫面沒有更新成功。請重新整理畫面。";
  for (const [label, reload] of [
    ["reload 401", async () => { throw new Error("401 {\"message\":\"JWT expired\"}"); }],
    ["reload refused with a code the claim flow knows", async () => { throw new Error('400 {"code":"P0001","message":"POOL_ITEM_NOT_WAITING"}'); }],
    ["reload network cut", async () => { throw new TypeError("Failed to fetch"); }],
  ]) {
    const state = {};
    const h = harness({ returnFlag: true, flag: true, backend: backendOf(state), reload });
    await startSwitch(h, 1);
    const readsBefore = state.poolReads;
    state.row = appliedRow();
    await h.runPoll();
    assert.equal(state.claims.length, 1, `${label}: the claim went out once`);
    assert.equal(h.calls.reloads, 1, `${label}: the reload was tried once`);
    assert.deepEqual(h.calls.toasts, [CLAIMED], `${label}: exactly one toast, and it says the step WAS switched`);
    assert.match(h.sheetHtml(), /data-switch-step-result="claimed_refresh_failed"/, label);
    assert.ok(h.sheetHtml().includes(`<p>${CLAIMED}</p>`), label);
    assert.doesNotMatch(h.sheetHtml(), /沒有接成功|不確定有沒有接到|JWT|POOL_ITEM_NOT_WAITING|data-return-claim-confirm/, `${label}: not worded as a failure, no raw text, no retry button`);
    assert.equal(h.api.poolState.claimMessage, "", `${label}: no 'claim failed' message is left for the pool panel`);
    assert.equal(h.api.poolState.claimBusy, "", label);
    assert.equal(state.poolReads - readsBefore, 1, `${label}: only the verify re-read (no failure re-read of the pool)`);
    assert.equal(h.api.locks("A05"), false, `${label}: card not left locked`);
    assert.equal(h.api.blockMessage("A05"), "");
    assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileSwitchStep)), { active: {}, claimPass: "" });
    assert.deepEqual(h.calls.refresh, [["A05", "return_claim"]], `${label}: one more background reload is asked for`);
    assert.equal(h.timeouts(), 0, `${label}: no time limit left pending`);
    await settle(); await settle();
    assert.equal(state.claims.length, 1, `${label}: never retried`);
    assert.equal(h.api.markup({ code: "A05", name: "A05", status: "idle", order: null }),
      `<p class="station-cmd-status is-warn" data-no-detail data-return-claim-status="applied" role="status">${CLAIMED}</p>`, `${label}: the card keeps that sentence`);
  }
});

test("MEDIUM-1: the switch flow shows ONE toast per outcome (the claim function stays quiet in switch mode); a normal claim keeps its own toasts", async () => {
  // 換成功：只有換道次那一句
  const okState = {};
  const ok = harness({ returnFlag: true, flag: true, backend: backendOf(okState) });
  await startSwitch(ok, 1);
  okState.row = appliedRow();
  await ok.runPoll();
  assert.deepEqual(ok.calls.toasts, ["已換成第 1 道。原本的第 3 道已退回待做池。"]);
  assert.equal(ok.calls.reloads, 1);
  // 接單被拒：只有換道次那一句；待做池面板照舊留下既有的那一句失敗訊息
  const badState = { claimError: '400 {"code":"P0001","message":"POOL_ITEM_NOT_WAITING"}' };
  const bad = harness({ returnFlag: true, flag: true, backend: backendOf(badState) });
  await startSwitch(bad, 1);
  badState.row = appliedRow();
  await bad.runPoll();
  assert.deepEqual(bad.calls.toasts, ["原本那一道已經退回待做池，這台現在沒有工單；第 1 道沒有接成功（已經被別台接走）。請到「選工單」重新接。"]);
  assert.equal(bad.api.poolState.claimMessage, "這張單已被別台接走。");
  assert.equal(bad.calls.reloads, 0, "a refused claim does not reload the screen");
  // 一般接單（選工單面板）：成功／失敗／接到了但重讀失敗，提示跟以前一樣
  const normalOk = harness({ backend: backendOf({}) });
  assert.deepEqual(JSON.parse(JSON.stringify(await normalOk.api.claim(keyOf(1), "A05"))), { ok: true });
  assert.deepEqual(normalOk.calls.toasts, ["接單成功，工單已進入這台機台。"]);
  const reloadFails = {};
  const normalStale = harness({ backend: backendOf(reloadFails), reload: async () => { throw new Error("401 unauthorized"); } });
  const stale = await normalStale.api.claim(keyOf(1), "A05");
  assert.equal(stale.ok, false);
  assert.equal(stale.claimed, undefined, "the normal caller's result has no new field");
  assert.equal(normalStale.calls.toasts.length, 1, "normal claim + failed reload: one error toast, as before this change");
  assert.equal(normalStale.calls.toasts[0], poolCore.claimErrorText(new Error("401 unauthorized")));
  assert.equal(reloadFails.poolReads, 1, "normal claim + failed reload: the pool is re-read once, as before");
});

test("LOW-2: the logged-in user changes / logs out → the switch in memory is dropped and no claim goes out under the next session", async () => {
  // (1) 退回還在等工廠：登出 → 之後退回成功只是一筆普通的退回
  const state = {};
  const h = harness({ returnFlag: true, flag: true, userId: "user-a", backend: backendOf(state) });
  await startSwitch(h, 1);
  assert.equal(h.api.active("A05").userId, "user-a", "the switch remembers who pressed it");
  assert.match(h.sheetHtml(), /data-switch-step-sheet="A05"/);
  h.api.forgetUser();
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileSwitchStep)), { active: {}, claimPass: "" });
  assert.equal(h.sheetHtml(), "", "the open switch sheet is closed");
  assert.equal(h.api.active("A05"), null);
  h.context.machtileAuthState.userId = "user-b";
  const readsBefore = state.poolReads;
  state.row = appliedRow();
  await h.runPoll();
  assert.equal(state.claims.length, 0, "return applied after the user changed: NO claim");
  assert.equal(state.poolReads, readsBefore, "the pool is not even re-read");
  assert.deepEqual(h.calls.toasts, ["已退回待做池，這台現在沒有工單。"], "it ends as a plain return");
  assert.equal(h.api.locks("A05"), false);
  // (2) 退回已成功、正在重讀待做池時換人：重讀回來之後不接、不留結果、不跳提示、不鎖
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const state2 = {};
  const backend2 = backendOf(state2);
  let gated = false;
  const h2 = harness({ returnFlag: true, flag: true, userId: "user-a",
    backend: async (url, init) => { if (gated && url.startsWith("dispatch_pool_items?select=source_key,work_order_no,process_order,operation_name")) await gate; return backend2(url, init); } });
  await startSwitch(h2, 1);
  gated = true;
  state2.row = appliedRow();
  await h2.runPoll();
  assert.equal(h2.api.holds("A05"), true, "step (b) is waiting on the pool re-read and holds the machine");
  h2.api.forgetUser();
  h2.context.machtileAuthState.userId = "user-b";
  assert.equal(h2.api.holds("A05"), false, "the lock goes with the forgotten switch");
  release();
  await settle(); await settle();
  assert.equal(state2.claims.length, 0, "pool re-read returns after the user changed: NO claim");
  assert.deepEqual(h2.calls.toasts, [], "nothing is announced on the next user's screen");
  assert.equal(h2.api.machtileReturnClaim.lastResult.A05.view.messageKey, "return_claim_applied", "the card keeps only the plain return result (the true state)");
  assert.equal(h2.api.machtileReturnClaim.lastResult.A05.view.switchStep, undefined, "and no switch-step result line");
  assert.equal(h2.api.locks("A05"), false);
  assert.equal(h2.timeouts(), 0);
  // (3) 保險：active 沒被清掉、但現在登入的不是按的那個人 → 一樣不接，而且不會留著鎖
  const state3 = {};
  const h3 = harness({ returnFlag: true, flag: true, userId: "user-a", backend: backendOf(state3) });
  await startSwitch(h3, 1);
  h3.context.machtileAuthState.userId = "user-b";
  state3.row = appliedRow();
  await h3.runPoll();
  assert.equal(state3.claims.length, 0, "user id differs from the one who pressed: NO claim");
  assert.deepEqual(JSON.parse(JSON.stringify(h3.api.machtileSwitchStep)), { active: {}, claimPass: "" });
  assert.equal(h3.api.locks("A05"), false);
  // (4) 沒換人：照常接
  const state4 = {};
  const h4 = harness({ returnFlag: true, flag: true, userId: "user-a", backend: backendOf(state4) });
  await startSwitch(h4, 1);
  state4.row = appliedRow();
  await h4.runPoll();
  assert.equal(state4.claims.length, 1);
  // 旗標關：叫了也沒有任何效果（不關「接錯了，退回」的確認卡、不碰任何東西）
  const off = harness({ returnFlag: true, flag: false, backend: backendOf({}) });
  await off.api.open("A05", null);
  const before = off.sheetHtml();
  off.api.forgetUser();
  assert.equal(off.sheetHtml(), before, "flag off: the plain return sheet stays open");
  assert.deepEqual(JSON.parse(JSON.stringify(off.api.machtileSwitchStep)), { active: {}, claimPass: "" });
  // 接線：登出與換人兩個地方都叫得到（machtileClearSession 在清 userId 之前；machtileSetSession 只在 userId 真的不同時）
  assert.equal([...appSource.matchAll(/\n  machtileSwitchStepForgetUser\(\);\r?\n  machtileAuthState\.userId = "";/g)].length, 1, "logout hook, before the user id is cleared");
  assert.equal([...appSource.matchAll(/\n  if \(machtileAuthState\.userId !== \(authResponse\?\.user\?\.id \|\| jwtPayload\.sub \|\| ""\)\) machtileSwitchStepForgetUser\(\);\r?\n  machtileAuthState\.userId = authResponse\?\.user\?\.id \|\| jwtPayload\.sub \|\| "";/g)].length, 1, "sign-in hook, only when the user id really differs");
  assert.equal([...appSource.matchAll(/machtileSwitchStepForgetUser\(\)/g)].length, 3, "definition + the two session hooks");
});

test("LOW-4: every wait in the switch flow has a time limit, so the machine lock always releases without a page reload; a timeout never claims", async () => {
  assert.equal(stationCore.SUBMIT_TIMEOUT_MS, 20000, "the limit is the existing command-submit timeout");
  // (1) 開確認卡時待做池讀不回來 → 期限到＝「讀不到最新的待做池」，不能按、沒有送任何東西
  const openState = { poolHang: true };
  const o = harness({ returnFlag: true, flag: true, backend: backendOf(openState) });
  const opening = o.api.open("A05", null, true);
  await settle();
  assert.equal(o.timeouts(), 1, "the pool read is on a time limit");
  await o.expire();
  await opening;
  assert.match(o.sheetHtml(), /data-switch-step-pool-failed>讀不到最新的待做池，現在不能換道次。請檢查網路後重新整理畫面。</);
  assert.match(o.sheetHtml(), /data-switch-step-confirm disabled/);
  assert.equal(openState.poolReads, 1, "after the limit no second read is started");
  await o.api.submit();
  assert.equal(o.urls("rpc/").length, 0);
  // (2) 退回成功後重讀待做池卡住 → 期限到＝沒接（讀不到最新的待做池），鎖放開，沒有送接單
  const verifyState = {};
  const v = harness({ returnFlag: true, flag: true, backend: backendOf(verifyState) });
  await startSwitch(v, 1);
  verifyState.poolHang = true;
  verifyState.row = appliedRow();
  await v.runPoll();
  assert.equal(v.api.holds("A05"), true, "waiting on the pool re-read: the machine is held");
  assert.equal(v.api.blockMessage("A05"), SWITCH_BUSY);
  assert.equal(v.timeouts(), 1);
  await v.expire();
  assert.equal(verifyState.claims.length, 0, "pool re-read timed out: NO claim");
  assert.deepEqual(v.calls.toasts, ["原本那一道已經退回待做池，這台現在沒有工單；第 1 道沒有接成功（讀不到最新的待做池）。請到「選工單」重新接。"]);
  assert.match(v.sheetHtml(), /data-switch-step-result="returned_not_claimed"/);
  assert.equal(v.api.locks("A05"), false, "lock released without a page reload");
  assert.equal(v.api.blockMessage("A05"), "");
  assert.deepEqual(JSON.parse(JSON.stringify(v.api.machtileSwitchStep)), { active: {}, claimPass: "" });
  assert.equal(v.timeouts(), 0);
  // (3) 接單送出後沒有回應 → 期限到＝既有的「不確定」那一句，鎖放開，不重送
  const claimState = { claimGate: NEVER };
  const c = harness({ returnFlag: true, flag: true, backend: backendOf(claimState) });
  await startSwitch(c, 1);
  claimState.row = appliedRow();
  await c.runPoll();
  assert.equal(claimState.claims.length, 1);
  assert.equal(c.api.holds("A05"), true);
  assert.equal(c.timeouts(), 1, "the claim wait is on a time limit");
  await c.expire();
  assert.deepEqual(c.calls.toasts, ["原本那一道已經退回待做池；第 1 道不確定有沒有接到（網路不穩）。請重新整理畫面看這台現在掛哪張單；沒有的話請到「選工單」重新接。"]);
  assert.match(c.sheetHtml(), /data-switch-step-result="claim_uncertain"/);
  assert.equal(c.api.locks("A05"), false, "lock released without a page reload");
  assert.equal(c.api.blockMessage("A05"), "");
  await settle(); await settle();
  assert.equal(claimState.claims.length, 1, "a timeout never sends a second claim");
  // (4) 接單 RPC 成功、之後重讀畫面卡住 → 期限到＝「接到了，但畫面沒更新」，鎖放開
  const reloadState = {};
  const r = harness({ returnFlag: true, flag: true, backend: backendOf(reloadState), reload: () => NEVER });
  await startSwitch(r, 1);
  reloadState.row = appliedRow();
  await r.runPoll();
  assert.equal(reloadState.claims.length, 1);
  assert.equal(r.calls.reloads, 1);
  assert.equal(r.api.holds("A05"), true, "waiting on the reload: the machine is held");
  assert.equal(r.timeouts(), 2, "the claim wait and the reload each have a limit");
  await r.expire();
  assert.deepEqual(r.calls.toasts, ["已換成第 1 道（原本的第 3 道已退回待做池），但畫面沒有更新成功。請重新整理畫面。"]);
  assert.match(r.sheetHtml(), /data-switch-step-result="claimed_refresh_failed"/);
  assert.equal(r.api.locks("A05"), false, "lock released without a page reload");
  assert.deepEqual(JSON.parse(JSON.stringify(r.api.machtileSwitchStep)), { active: {}, claimPass: "" });
  await r.expire();   // 既有接單函式裡的那一個期限也到了：它自己收尾（claimBusy 放開），不再多說一次
  assert.equal(r.api.poolState.claimBusy, "", "the claim function itself is not left busy");
  assert.equal(r.api.poolState.claimMessage, "");
  assert.equal(r.calls.toasts.length, 1, "still one toast");
  assert.equal(reloadState.claims.length, 1);
  // (5) 接單被拒之後那一次重讀待做池卡住 → 已經知道的結果不等它：馬上說沒接到（那個原因），鎖放開，沒有期限留著
  const refusedState = { claimError: '400 {"code":"P0001","message":"POOL_ITEM_NOT_WAITING"}' };
  const refusedBackend = backendOf(refusedState);
  let claimSeen = false;
  const f = harness({ returnFlag: true, flag: true, backend: async (url, init) => {
    if (url === "rpc/dispatch_pool_claim") claimSeen = true;
    else if (claimSeen && url.startsWith("dispatch_pool_items?select=source_key,work_order_no,process_order,operation_name")) refusedState.poolHang = true;
    return refusedBackend(url, init);
  } });
  await startSwitch(f, 1);
  refusedState.row = appliedRow();
  await f.runPoll();
  assert.deepEqual(f.calls.toasts, ["原本那一道已經退回待做池，這台現在沒有工單；第 1 道沒有接成功（已經被別台接走）。請到「選工單」重新接。"]);
  assert.equal(f.api.locks("A05"), false, "lock released without waiting for the hung pool read");
  assert.equal(f.api.poolState.claimBusy, "");
  assert.equal(f.timeouts(), 0);
  assert.equal(refusedState.claims.length, 1);
  // 正常路徑不留任何還沒清掉的期限
  const okState = {};
  const ok = harness({ returnFlag: true, flag: true, backend: backendOf(okState) });
  await startSwitch(ok, 1);
  okState.row = appliedRow();
  await ok.runPoll();
  assert.equal(ok.calls.toasts.at(-1), "已換成第 1 道。原本的第 3 道已退回待做池。");
  assert.equal(ok.timeouts(), 0, "the happy path leaves no time limit pending");
});

// ================================================================ 審查修正（opus @ 185d16d8：LOW-B、LOW-C）
const UNCERTAIN = "原本那一道已經退回待做池；第 1 道不確定有沒有接到（網路不穩）。請重新整理畫面看這台現在掛哪張單；沒有的話請到「選工單」重新接。";
const gateOf = () => { let release, fail; const gate = new Promise((resolve, reject) => { release = resolve; fail = reject; }); gate.catch(() => {}); return { gate, release, fail }; };
// 走到「接單已送出、還沒回來」
async function switchUntilClaimInFlight(state, options = {}) {
  const h = harness(Object.assign({ returnFlag: true, flag: true, backend: backendOf(state) }, options));
  await startSwitch(h, 1);
  state.row = appliedRow();
  await h.runPoll();
  assert.equal(state.claims.length, 1, "the claim is in flight");
  assert.equal(h.api.poolState.claimBusy, keyOf(1), "the existing claim function is busy with it");
  assert.equal(h.api.holds("A05"), true);
  return h;
}

test("LOW-B: the claim wait times out while dispatch_pool_claim is in flight → the request is aborted, claimBusy is released at once, the outcome stays 'uncertain', nothing is resent", async () => {
  const g = gateOf();
  const state = { claimGate: g.gate, claimAbortable: true };
  const h = await switchUntilClaimInFlight(state);
  const signal = state.claims[0].init.signal;
  assert.equal(signal.aborted, false);
  const closedBefore = h.calls.closedSelection;
  // 這時別台開著「選工單」面板（按鈕因為 claimBusy 是灰的）
  h.holders.machtileCardSelection = { dataset: { machineCode: "A03" } };
  await h.expire();
  assert.equal(signal.aborted, true, "the hung claim request is aborted through the fetch signal");
  assert.equal(state.claimAborted, 1);
  assert.equal(h.api.poolState.claimBusy, "", "claimBusy is released at the timeout, not when the request finally settles");
  assert.deepEqual(h.selectionUpdates, ["A03"], "an open pick-order panel is refreshed once so its buttons work again");
  assert.deepEqual(h.calls.toasts, [UNCERTAIN], "an aborted request may still have reached the server: the outcome is 'uncertain', exactly as before");
  assert.match(h.sheetHtml(), /data-switch-step-result="claim_uncertain"/);
  assert.equal(h.api.machtileReturnClaim.lastResult.A05.view.state, "claim_uncertain");
  assert.equal(h.api.poolState.claimMessage, "", "the abort does not leave a 'claim failed' message for the pool panel");
  assert.equal(h.calls.closedSelection, closedBefore, "no panel is closed");
  assert.equal(h.calls.reloads, 0);
  assert.equal(state.poolReads, 2, "no failure re-read of the pool either (open + verify only)");
  assert.equal(h.api.locks("A05"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileSwitchStep)), { active: {}, claimPass: "" });
  assert.equal(h.timeouts(), 0, "no time limit left pending");
  assert.deepEqual(h.calls.refresh, [["A05", "return_claim"]], "one background re-read, as before");
  // 「選工單」馬上可以再接（操作員自己按的另一筆；伺服器決定收不收）——不是換道次重送
  delete h.holders.machtileCardSelection;
  state.claimGate = null;
  const next = await h.api.claim(keyOf(2), "A05");
  assert.deepEqual(JSON.parse(JSON.stringify(next)), { ok: true }, "a pick-order claim right after the timeout is not silently dropped");
  assert.equal(state.claims.length, 2);
  assert.deepEqual(Object.keys(state.claims[1].init), ["method", "body"], "that one is a plain claim (no signal)");
  assert.equal(JSON.parse(state.claims[1].init.body).p_source_key, keyOf(2));
  g.release();
  await settle(); await settle();
  assert.equal(state.claims.length, 2, "the switch never sends a second claim of its own");
  assert.deepEqual(h.calls.toasts, [UNCERTAIN, "接單成功，工單已進入這台機台。"]);
});

test("LOW-B: a claim that cannot be aborted answers late (success or failure) → no panel closed, no stale claimMessage, no toast, and a newer claim's claimBusy is not cleared", async () => {
  for (const [label, finish] of [
    ["late success", (g) => g.release()],
    ["late refusal", (g) => g.fail(new Error('400 {"code":"P0001","message":"POOL_ITEM_NOT_WAITING"}'))],
    ["late network error", (g) => g.fail(new TypeError("Failed to fetch"))],
  ]) {
    const g = gateOf();
    const state = { claimGate: g.gate };   // 不看 signal：中止不了
    const h = await switchUntilClaimInFlight(state);
    await h.expire();
    assert.equal(state.claims[0].init.signal.aborted, true, `${label}: the abort is still asked for`);
    assert.deepEqual(h.calls.toasts, [UNCERTAIN], `${label}: 'uncertain', exactly as before`);
    assert.equal(h.api.poolState.claimBusy, "", `${label}: claimBusy released at the timeout`);
    assert.equal(h.api.locks("A05"), false, label);
    const result = JSON.stringify(h.api.machtileReturnClaim.lastResult.A05);
    // 操作員這時在「選工單」接另一筆，而且那一筆還在路上
    const g2 = gateOf();
    state.claimGate = g2.gate;
    const second = h.api.claim(keyOf(2), "A05");
    await settle();
    assert.equal(state.claims.length, 2, `${label}: the operator's own pick-order claim goes out`);
    assert.equal(h.api.poolState.claimBusy, keyOf(2));
    const before = { closed: h.calls.closedSelection, reloads: h.calls.reloads, rerenders: h.calls.rerenders, poolReads: state.poolReads, refresh: h.calls.refresh.length };
    finish(g);
    await settle(); await settle();
    assert.equal(h.api.poolState.claimBusy, keyOf(2), `${label}: the late answer does not clear the newer claim's claimBusy`);
    assert.equal(h.calls.closedSelection, before.closed, `${label}: no panel is closed`);
    assert.equal(h.calls.reloads, before.reloads, `${label}: no screen reload is started for it`);
    assert.equal(h.calls.rerenders, before.rerenders, `${label}: nothing is re-rendered for it`);
    assert.equal(state.poolReads, before.poolReads, `${label}: no pool re-read`);
    assert.equal(h.calls.refresh.length, before.refresh, label);
    assert.equal(h.api.poolState.claimMessage, "", `${label}: no stale 'claim failed' message`);
    assert.deepEqual(h.calls.toasts, [UNCERTAIN], `${label}: no second toast`);
    assert.equal(JSON.stringify(h.api.machtileReturnClaim.lastResult.A05), result, `${label}: the card keeps the sentence it already showed`);
    assert.match(h.sheetHtml(), /data-switch-step-result="claim_uncertain"/, label);
    g2.release();
    assert.deepEqual(JSON.parse(JSON.stringify(await second)), { ok: true }, `${label}: the newer claim finishes normally`);
    assert.equal(h.api.poolState.claimBusy, "");
    assert.equal(state.claims.length, 2, `${label}: two claims in total — one from the switch, one the operator pressed`);
  }
});

test("LOW-B: the wait times out during the reload after a successful claim → the late reload does not close a panel or touch claimBusy; outcome unchanged", async () => {
  const reload = gateOf();
  const state = {};
  const h = harness({ returnFlag: true, flag: true, backend: backendOf(state), reload: () => reload.gate });
  await startSwitch(h, 1);
  state.row = appliedRow();
  await h.runPoll();
  assert.equal(h.calls.reloads, 1);
  await h.expire();
  assert.deepEqual(h.calls.toasts, ["已換成第 1 道（原本的第 3 道已退回待做池），但畫面沒有更新成功。請重新整理畫面。"]);
  assert.equal(state.claims[0].init.signal.aborted, true, "aborting a request that already answered is harmless");
  assert.equal(h.api.poolState.claimBusy, "", "claimBusy released at the timeout");
  const g2 = gateOf();
  state.claimGate = g2.gate;
  const second = h.api.claim(keyOf(2), "A05");
  await settle();
  assert.equal(h.api.poolState.claimBusy, keyOf(2));
  const closed = h.calls.closedSelection;
  reload.release();
  await settle(); await settle();
  assert.equal(h.calls.closedSelection, closed, "the late reload does not close the panel the operator has open now");
  assert.equal(h.api.poolState.claimBusy, keyOf(2), "…and does not clear the newer claim's claimBusy");
  assert.equal(h.api.poolState.claimMessage, "");
  assert.equal(h.calls.toasts.length, 1);
  g2.release();
  await second;
  assert.equal(h.timeouts(), 0);
});

test("LOW-B: a claim that settles in time is not abandoned — the existing claim function finishes exactly as before", async () => {
  const state = {};
  const h = harness({ returnFlag: true, flag: true, backend: backendOf(state) });
  await startSwitch(h, 1);
  state.row = appliedRow();
  await h.runPoll();
  assert.deepEqual(h.calls.toasts, ["已換成第 1 道。原本的第 3 道已退回待做池。"]);
  assert.equal(state.claims[0].init.signal.aborted, false);
  assert.equal(h.api.poolState.claimBusy, "");
  assert.deepEqual(h.selectionUpdates, []);
  // 結束之後才換人：已經收尾的那一筆沒有東西可放棄
  h.api.forgetUser();
  assert.equal(state.claims[0].init.signal.aborted, false);
  // 一般接單（沒有第三個參數）不看 abandoned：失敗也一定放開 claimBusy
  const plainState = { claimError: "500 boom" };
  const plain = harness({ backend: backendOf(plainState) });
  assert.equal((await plain.api.claim(keyOf(1), "A05")).ok, false);
  assert.equal(plain.api.poolState.claimBusy, "");
});

test("LOW-C: the logged-in user changes while the switch's claim is in flight → the result is dropped: no lastResult write, no toast, nothing left locked or busy", async () => {
  // (1) 登出／換人（machtileSwitchStepForgetUser）時接單還在路上
  for (const [label, abortable] of [["abortable request", true], ["request that cannot be aborted", false]]) {
    const g = gateOf();
    const state = { claimGate: g.gate, claimAbortable: abortable };
    const h = await switchUntilClaimInFlight(state, { userId: "user-a" });
    const resultBefore = JSON.stringify(h.api.machtileReturnClaim.lastResult.A05);
    const closed = h.calls.closedSelection;
    h.api.forgetUser();
    h.context.machtileAuthState.userId = "user-b";
    assert.equal(state.claims[0].init.signal.aborted, true, `${label}: the in-flight claim is no longer waited for`);
    assert.equal(h.api.poolState.claimBusy, "", `${label}: the next user's pick-order is not blocked`);
    assert.equal(h.api.holds("A05"), false);
    await settle(); await settle();
    if (!abortable) { g.release(); await settle(); await settle(); }
    assert.deepEqual(h.calls.toasts, [], `${label}: nothing is announced on the next user's screen`);
    assert.equal(JSON.stringify(h.api.machtileReturnClaim.lastResult.A05), resultBefore, `${label}: no switch-step result is written`);
    assert.equal(h.api.machtileReturnClaim.lastResult.A05?.view?.switchStep, undefined, label);
    assert.equal(h.api.poolState.claimMessage, "", label);
    assert.equal(h.api.poolState.claimBusy, "", label);
    assert.equal(h.calls.closedSelection, closed, `${label}: no panel closed afterwards`);
    assert.equal(h.calls.reloads, 0, `${label}: no reload under the next session`);
    assert.deepEqual(h.calls.refresh, [], label);
    assert.equal(h.sheetHtml(), "", `${label}: the switch sheet was closed with the session`);
    assert.equal(h.api.locks("A05"), false);
    assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileSwitchStep)), { active: {}, claimPass: "" });
    assert.equal(h.timeouts(), 0, `${label}: no time limit left pending`);
    assert.equal(state.claims.length, 1, `${label}: nothing is resent`);
  }
  // (2) 保險：active 沒被清掉，但接單回來時登入的已經不是按的那個人（成功／被拒／逾時都一樣丟掉）
  for (const [label, finish] of [
    ["claim succeeds", async (h, g) => { g.release(); await settle(); await settle(); }],
    ["claim refused", async (h, g) => { g.fail(new Error('400 {"code":"P0001","message":"POOL_ITEM_NOT_WAITING"}')); await settle(); await settle(); }],
    ["claim wait times out", async (h) => { await h.expire(); }],
  ]) {
    const g = gateOf();
    const state = { claimGate: g.gate };
    const h = await switchUntilClaimInFlight(state, { userId: "user-a" });
    const resultBefore = JSON.stringify(h.api.machtileReturnClaim.lastResult.A05);
    h.context.machtileAuthState.userId = "user-b";
    await finish(h, g);
    assert.deepEqual(h.calls.toasts, [], `${label}: no toast for the next user`);
    assert.equal(JSON.stringify(h.api.machtileReturnClaim.lastResult.A05), resultBefore, `${label}: no lastResult write`);
    assert.deepEqual(h.calls.refresh, [], `${label}: no background re-read is asked for by the dropped switch`);
    assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileSwitchStep)), { active: {}, claimPass: "" }, `${label}: the machine is not left held`);
    assert.equal(h.api.locks("A05"), false, label);
    assert.equal(h.api.poolState.claimBusy, "", label);
    assert.equal(state.claims.length, 1, label);
  }
  // (3) 沒換人：照常有結果
  const g = gateOf();
  const state = { claimGate: g.gate };
  const h = await switchUntilClaimInFlight(state, { userId: "user-a" });
  g.release();
  await settle(); await settle();
  assert.deepEqual(h.calls.toasts, ["已換成第 1 道。原本的第 3 道已退回待做池。"]);
  assert.equal(h.api.machtileReturnClaim.lastResult.A05.view.state, "done");
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
// machtile_held_pool_claims() 回的列（接單帳本；沒有 status 欄——Factory 確認後池列是 gone，帳本列照樣在）
const claimedRow = (step, extra) => Object.assign({ machine_code: "A05", work_order_no: "TEST-WO-1", process_order: step, source_key: keyOf(step), claimed_at: "2026-11-13T01:00:00+00:00" }, extra);

test("after a switch (3 → 1) the new step's card shows both buttons again, and the next return/switch carries the NEW step's pool row", async () => {
  // 換完之後雲端的樣子：work_orders.external_ref 還是第 3 道（第一次接的那一道，on conflict 不更新）；機台上掛的是第 1 道；
  // 池裡第 1 道 claimed、第 3 道退回後 waiting、第 2 道一直 waiting。
  const after = heldOrder({ stationStep: 1, process: "CNC車床加工", processId: "00000000-0000-4000-8000-000000000301", heldPoolKey: undefined,
    machine: "A05", dispatchPoolSourceKey: keyOf(3), dispatchPoolStatus: "waiting" });
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
    const order = heldOrder({ heldPoolKey: undefined, machine: "A05", dispatchPoolSourceKey: keyOf(1), dispatchPoolStatus: "waiting" });   // external_ref＝第 1 道；機台上是第 3 道
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
    ["only another machine holds this order/step", () => [claimedRow(3, { machine_code: "A04" })]],
    ["read failed", () => { throw new TypeError("Failed to fetch"); }],
    ["RPC not deployed (404 PGRST202)", () => { throw new Error('404 {"code":"PGRST202","message":"Could not find the function public.machtile_held_pool_claims without parameters in the schema cache"}'); }],
    ["not an array", () => ({ message: "nope" })],
  ]) {
    const bad = await run(held);
    assert.equal(bad.order.heldPoolKey, "", label);
    assert.equal(bad.h.api.markup(bad.h.machine), "", `${label}: neither button`);
    assert.equal(bad.h.api.gate(bad.h.machine).reason, "return_hidden", label);
    await bad.h.api.open("A05", null, true);
    assert.equal(bad.h.sheetHtml(), "", `${label}: the sheet does not open`);
    assert.deepEqual([bad.state.returns.length, bad.state.claims.length], [0, 0]);
    assert.equal(bad.state.heldReads, 1, `${label}: asked once, not retried`);
    assert.deepEqual(bad.h.calls.toasts, [], `${label}: no message to the operator`);
  }
});

// ---------------------------------------------------------------- 旗標關＝跟「只有退回」那一版逐字相同（原始碼層）
test("app.js minus the switch-step section and its listed hooks is byte-identical to the return-claim build; other files only gain what is listed", (t) => {
  const git = (args) => childProcess.execFileSync("git", args, { cwd: __dirname, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const base = process.env.SWITCH_STEP_BASE || "4213c94a5d3985f056b6e6dbfb016888a894b188";
  let baseApp;
  try { baseApp = git(["show", `${base}:app.js`]); } catch { t.skip("git base (return-claim build) not available"); return; }
  const norm = (text) => text.replace(/\r\n/g, "\n");
  baseApp = norm(baseApp);
  assert.doesNotMatch(baseApp, /machtileSwitchStep/, "the base has no switch-step code");
  let current = norm(appSource);
  // 第 2 階段（已開工，enableSwitchStepStarted 預設關）先整段拿掉、掛點還原；它旗標關時每一個掛點都等於原字串
  // （Locks()＝false、Restore／HandleClick 直接 return／回 false、CardMarkup()＝""、ForgetUser 沒有東西可丟；下面第 2 階段的「flag off」測試逐一斷言）。
  const startedSection = norm(startedSource);
  assert.equal(current.split(startedSection).length, 2);
  current = current.replace(startedSection, () => "");
  for (const [now, before] of STARTED_HOOKS) {
    assert.equal(current.split(now).length, 2, `started hook must appear exactly once: ${now.slice(0, 70)}`);
    current = current.replace(now, () => before);
  }
  assert.doesNotMatch(current, /machtileSwitchStarted|enableSwitchStepStarted|switch_step_started_/, "no other started switch-step reference in app.js");
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
    ["    if (!switchStep) showToast(machtileTranslate(\"claim_success\"), \"success\");\n    return { ok: true };\n", "    showToast(machtileTranslate(\"claim_success\"), \"success\");\n"],
    // 換道次模式（第三個參數，只有換道次會傳；一般接單＝null）：記下 RPC 已成功、重讀畫面有期限、不跳提示、錯誤交給換道次自己說
    ["async function machtileClaimDispatchPool(sourceKey, machineCode, switchStep = null) {", "async function machtileClaimDispatchPool(sourceKey, machineCode) {"],
    ["    if (switchStep) switchStep.claimed = true;\n", ""],
    ["    await (switchStep ? switchStep.reload() : loadFromSupabase({ preserveDepartmentOnFailure: true }));\n", "    await loadFromSupabase({ preserveDepartmentOnFailure: true });\n"],
    ["    if (switchStep) return machtileSwitchStepClaimError(switchStep, error);\n", ""],
    // 換道次的接單請求多帶一個 signal（等不到時可以中止）；一般接單 switchStep＝null → 展開 null＝什麼都不加，請求物件逐字相同
    ["    await supabaseFetch(\"rpc/dispatch_pool_claim\", { method: \"POST\", body: JSON.stringify(args), ...(switchStep ? switchStep.request : null) });\n",
      "    await supabaseFetch(\"rpc/dispatch_pool_claim\", { method: \"POST\", body: JSON.stringify(args) });\n"],
    // 換道次已經不等的那一筆接單晚到時，不動 claimBusy（可能是後來另一筆接單的）；一般接單 switchStep＝null → 照舊一定清
    ["    if (!(switchStep && switchStep.abandoned)) machtileDispatchPoolState.claimBusy = \"\";\n    const machine = machtileScheduleMachine(machineCode);\n",
      "    machtileDispatchPoolState.claimBusy = \"\";\n    const machine = machtileScheduleMachine(machineCode);\n"],
    // 登入的人換了／登出：丟掉記憶體裡的換道次（旗標關時 active 本來就是空的、也沒有換道次確認卡＝沒有效果）
    ["  if (machtileAuthState.userId !== (authResponse?.user?.id || jwtPayload.sub || \"\")) machtileSwitchStepForgetUser();\n", ""],
    ["  machtileAuthState.email = \"\";\n  machtileSwitchStepForgetUser();\n", "  machtileAuthState.email = \"\";\n"],
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
    // 池列鍵跟池列狀態同時讀（Promise.all）：旗標關＝第二個參數永遠是預設的 false、那個 if 整句不成立，後面逐字是原本的函式
    ["async function machtileLoadAssignedDispatchPoolStatuses(generation = machtileDeferredLoadGeneration, statusOnly = false) {\n  // 「接錯了，退回」／「換道次」用的池列鍵（旗標關＝不叫）：跟下面的池列狀態同時讀、兩個都回來才算載入完；它只寫 order.heldPoolKey\n  if (!statusOnly && machtileReturnClaimEnabled()) { await Promise.all([machtileReturnClaimLoadHeldPoolKeys(generation), machtileLoadAssignedDispatchPoolStatuses(generation, true)]); return; }\n",
      "async function machtileLoadAssignedDispatchPoolStatuses(generation = machtileDeferredLoadGeneration) {\n"],
    // 唯讀 RPC 名單多一個名字（嚴格模式下不先讀課別權限）。旗標關＝這支 RPC 從來不叫，名單裡多一個名字沒有任何效果
    ["    \"manufacturing_quote_tracking_snapshot\", \"machtile_held_pool_claims\"]);\n", "    \"manufacturing_quote_tracking_snapshot\"]);\n"],
    ["fields: { poolItemId: order.heldPoolKey, orderNo: order.id,", "fields: { poolItemId: order.dispatchPoolSourceKey, orderNo: order.id,"],
  ];
  for (const [now, before] of heldKeyFix) {
    assert.equal(current.split(now).length, 2, `held-key fix must appear exactly once: ${now.slice(0, 70)}`);
    current = current.replace(now, () => before);
  }
  current = cut(current, "// 卡片明細載入時叫（旗標開才會進來）", "function machtileReturnClaimGate(machine) {");
  assert.doesNotMatch(current, /heldPoolKey|HeldPoolKeys|heldPoolPath|HELD_CLAIMS_RPC|machtile_held_pool_claims/, "no other held-key reference outside the switch-step section");
  assert.doesNotMatch(current, /machtileSwitchStep|enableSwitchStep|switch_step|switchStep/, "no other switch-step reference in app.js");
  assert.equal(current, baseApp, "with the section removed and the hooks reverted, app.js is byte-identical to the return-claim build");
  assert.doesNotMatch(appSource, /void machtileClaimDispatchPool\([^)]*\)[^;]*;[^\n]*\.ok/, "sanity");
  assert.equal([...appSource.matchAll(/machtileClaimDispatchPool\(/g)].length, 3, "the claim function has exactly one new caller (definition, the pool panel's click handler, the switch)");
  // 其他檔案
  const show = (file) => norm(git(["show", `${base}:${file}`]));
  const read = (file) => norm(fs.readFileSync(path.join(__dirname, file), "utf8"));
  // returnClaimCore.js：只多了池列鍵那幾樣（同一個修正），其餘逐字相同
  let returnCoreNow = read("returnClaimCore.js");
  returnCoreNow = cut(returnCoreNow, "  // 機台上這一道的池列鍵（source_key）＝問雲端的唯讀 RPC machtile_held_pool_claims()", "  const ROLES = Object.freeze(");
  returnCoreNow = cut(returnCoreNow, "  // ---------------------------------------------------------------- 機台上這一道的池列鍵\n", "  // ---------------------------------------------------------------- 卡片要不要出現「接錯了，退回」");
  for (const [now, before] of [
    ["  // 「接了、還沒開工」＝這台這一道在接單帳本裡剛好有一筆還沒退回的接單（order.heldPoolKey，這次載入用 heldPoolKey 查到的）、\n",
      "  // 「接了、還沒開工」＝這張單是從待做池接的（工單來源 dispatch_pool＋池列狀態 claimed，這次載入有核對到）、\n"],
    ["    if (cardDetailsReady !== true) return no(\"pool_status_unverified\");\n    const poolItemId = text(order.heldPoolKey);\n    if (poolItemId.length < 5 || poolItemId.length > 120) return no(\"pool_not_claimed\");\n",
      "    const poolItemId = text(order.dispatchPoolSourceKey);\n    if (poolItemId.length < 5 || poolItemId.length > 120) return no(\"not_from_pool\");\n    if (cardDetailsReady !== true) return no(\"pool_status_unverified\");\n    if (text(order.dispatchPoolStatus) !== \"claimed\") return no(\"pool_not_claimed\");\n"],
    ["    HELD_CLAIMS_RPC, HELD_POOL_ROW_LIMIT, heldPoolKey,\n", ""],
  ]) {
    assert.equal(returnCoreNow.split(now).length, 2, `returnClaimCore.js change must appear exactly once: ${now.slice(0, 60)}`);
    returnCoreNow = returnCoreNow.replace(now, () => before);
  }
  assert.equal(returnCoreNow, show("returnClaimCore.js"), "returnClaimCore.js: only the held-pool-key lookup and the visibility lines that use it");
  for (const file of ["dispatchPoolCore.js", "stationCommandCore.js", "fixtures/return_claim_poll_select.txt", "sw.js"]) {
    assert.equal(read(file), show(file), `${file} is unchanged`);
  }
  // 版號：第 2 階段那一包 bump 了快取版號（version.json＋index.html 的 meta／?v=，全部同一個字串）；除了版號字串之外逐字相同
  const deployed = JSON.parse(read("version.json")).version;
  const baseDeployed = JSON.parse(show("version.json")).version;
  const unversion = (text, version) => text.split(version).join("<VERSION>");
  assert.match(read("version.json"), /^\{"version":"[^"]+","deploymentSequence":\d+\}$/);
  const config = read("config.js");
  assert.match(config, /\n  enableSwitchStep: false,\n/);
  assert.equal(config.split("\n").filter((line) => !/enableSwitchStep|switchStepStarted|換道次|enableReturnClaim 也要開才有效/.test(line)).join("\n"), show("config.js"), "config.js: only the new default-off flag and its comment");
  assert.equal(unversion(read("index.html"), deployed).split("\n").filter((line) => !line.includes("./switchStepCore.js?v=")).join("\n"), unversion(show("index.html"), baseDeployed), "index.html: only the new core script tag and the version string");
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
  // app.js 也沒有多任何寫死的 select：機台上這一道的池列鍵改問 RPC（returnClaimCore.HELD_CLAIMS_RPC，沒有 select；stationCommandPollColumns.test.js 核對回傳欄位）
  // （第 2 階段那一段另外有自己的 select：這一道、這張單的各道、指令歷史、不在待做池提醒；欄位由 stationCommandPollColumns.test.js 核對）
  assert.equal([...norm(appSource).matchAll(/\?select=/g)].length, [...baseApp.matchAll(/\?select=/g)].length + [...startedSection.matchAll(/\?select=/g)].length,
    "app.js gains no literal select outside the started section");
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "switchStepCore.js"), "utf8").replace(/^\s*\/\/.*$/gm, ""), /\?select=|fetch\(|localStorage|sessionStorage|document\.|window\./, "the core does no I/O");
  assert.doesNotMatch(section.replace(/^\s*\/\/.*$/gm, ""), /localStorage|sessionStorage|indexedDB/, "the switch-step section persists nothing (comments aside)");
  assert.doesNotMatch(section, /(?:const|let|var)\s+\w+\s*=\s*machtile\w*Core\s*[;,]/, "no core aliases (coreExportsUsed must see every member)");
});

// ================================================================================================
// 第 2 階段：已開工、還沒報工 → 一筆 switch_step 指令（config.enableSwitchStepStarted）
//   合約：雲端 20261114090000_station_switch_step_commands.sql（submit RPC 九個參數）、快照合約 r2（CONTRACT-r2.md）。
//   三個 applied 快照樣本＝ops/codex-inbox/20261114-0000-switchstep-reviews/sample-applied-snapshot.json（工廠由真的 AppliedSnapshotJson 產生，
//   雲端 pglite 也用同一份）。這裡用 vendored 副本 fixtures/switch_step_applied_snapshot_samples.json；原檔在這台電腦上時逐字比對。
// ================================================================================================
const SAMPLES = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "switch_step_applied_snapshot_samples.json"), "utf8"));
const SAMPLE_NAMES = ["pooled_to_pooled", "planner_source_unpooled_to_pooled", "pooled_to_unpooled_target"];
const OPS_SAMPLE_FILE = process.env.SWITCH_STEP_SAMPLE_FILE || "D:/04_SoftNet/ops/codex-inbox/20261114-0000-switchstep-reviews/sample-applied-snapshot.json";
const CLOUD_SWITCH_SQL = process.env.SWITCH_STEP_CLOUD_SQL || "D:/04_SoftNet/wt-switch-cloud/supabase/migrations/20261114090000_station_switch_step_commands.sql";
const FACTORY_SWITCH_DIR = process.env.SWITCH_STEP_FACTORY_DIR || "D:/04_SoftNet/wt-switch-factory/SoftNet/SoftNetWebII/Services/StationCommands";
// 雲端 submit 會 raise 的每一個碼（20261114090000 的 machtile_submit_switch_step_command；檔案在這台電腦上時從原始碼重抓比對）
const CLOUD_SUBMIT_CODES = ["ACTIVE_CLAIM_NOT_FOUND", "ADMIN_LEGACY_ID_MISSING", "ADMIN_SUBMIT_DISABLED", "APPLIER_CANNOT_SUBMIT", "APP_USER_REQUIRED", "AUTH_REQUIRED",
  "CLAIM_NOT_APPLIED", "COMMAND_UUID_CONFLICT", "COMMAND_UUID_REQUIRED", "FORBIDDEN", "INVALID_MACHINE_CODE", "INVALID_POOL_ITEM_ID", "INVALID_SWITCH_REASON",
  "INVALID_TARGET_POOL_ITEM_ID", "INVALID_TARGET_STEP", "MACHINE_COMMAND_IN_FLIGHT", "MACHINE_NOT_ALLOWED", "NOT_CLAIM_OWNER", "OPERATOR_LEGACY_ID_INVALID",
  "OPERATOR_LEGACY_ID_MISSING", "OPERATOR_REQUIRED", "POOL_ITEM_AMBIGUOUS", "POOL_ITEM_REQUIRED", "SAME_STEP", "SOURCE_STEP_NOT_SWITCHABLE", "STALE", "SWITCH_REASON_REQUIRED",
  "SWITCH_STEP_DISABLED", "SWITCH_STEP_HAS_REPORTS", "TARGET_NOT_ELIGIBLE", "TARGET_NOT_SAME_WORK_ORDER", "TARGET_POOL_ITEM_NOT_FOUND", "TARGET_STEP_CLOSED",
  "TARGET_STEP_MISMATCH", "TARGET_STEP_NOT_FOUND", "TARGET_TAKEN", "TENANT_INACTIVE"];
// 工廠套用端 switch_step 會回的每一個 reject_code（StationSwitchStepApplier.cs＋Processor 的 switch_step 分支＋Poller）
const FACTORY_SWITCH_CODES = ["COMMAND_INVALID", "FACTORY_SWITCH_DISABLED", "INTERNAL_ERROR", "LEDGER_CONFLICT", "LEGACY_APPLIED_LATE", "LEGACY_STATE_INCONSISTENT",
  "LOCK_TIMEOUT", "OPERATOR_UNKNOWN", "OUTCOME_UNKNOWN", "POOL_ITEM_NOT_FOUND", "STALE_COMMAND", "SWITCH_STEP_HAS_REPORTS", "SWITCH_STEP_NOT_OPERATOR",
  "SWITCH_STEP_SOURCE_NOT_POOLED", "SWITCH_STEP_STARTED_BEFORE_CLAIM", "SWITCH_STEP_STATE_UNSUPPORTED", "SWITCH_STEP_TARGET_CLOSED", "SWITCH_STEP_TARGET_NOT_HERE",
  "SWITCH_STEP_TARGET_NOT_POOLED", "SWITCH_STEP_TARGET_TAKEN", "UNSUPPORTED_STATION", "WRITE_TARGET_DENIED"];
const S_UUID = "5b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a40";
const S_UUID2 = "6c2d3e4f-5061-4b72-8c83-0d9e8f7a6b51";
const WO_ID = "00000000-0000-4000-8000-000000000201";
const sampleOf = (name, extra) => {
  const snap = JSON.parse(JSON.stringify(SAMPLES[name]));
  Object.assign(snap.switch_step, extra);
  return snap;
};
// 雲端 finish 寫回去的那一列：工廠的快照 || cloud_finalize（雲端只加 cloud_finalize，switch_step 原樣）
const switchRow = (extra) => Object.assign({ command_uuid: S_UUID, command_type: "switch_step", machine_code: "A05", pool_item_id: null, expected_order_no: "WO1",
  expected_index_sn: 3, status: "pending", requested_at: new Date().toISOString(), claimed_at: null, applied_at: null, reject_code: null, reject_message: null, legacy_snapshot: null }, extra);
const appliedSwitchRow = (name, extra, snapExtra) => switchRow(Object.assign({ status: "applied", claimed_at: new Date().toISOString(), applied_at: new Date().toISOString(),
  legacy_snapshot: Object.assign(sampleOf(name, snapExtra), { cloud_finalize: { old_claim_returned: name !== "planner_source_unpooled_to_pooled", old_process_reset: true,
    old_item_reopened: name !== "planner_source_unpooled_to_pooled", target_attached: true, target_item_claimed: name !== "pooled_to_unpooled_target", moved_qty: 0 } }) }, extra));
const runningOrder = (extra) => heldOrder(Object.assign({ processStatus: "running", heldPoolKey: "", workOrderId: WO_ID }, extra));
const MACHINE_LATHE = { machineCode: "A05", departmentCode: "LATHE" };
const procRow = (step, status, machineCode, extra) => Object.assign({ id: `00000000-0000-4000-8000-0000000004${String(step).padStart(2, "0")}`, process_order: step,
  process_name: ["", "粗車", "車牙", "精車", "銑削", "鑽孔", "研磨"][step] || `S${step}`, status, off_station_at: null, machines: machineCode ? { machine_code: machineCode } : null }, extra);
// 雲端這張單的各道：1／2 在池裡（waiting）、3＝A05 正在做、4 做完了、5 在 A03 做、6 沒進池
const STEPS = () => [procRow(1, "pending", null), procRow(2, "pending", null), procRow(3, "running", "A05"), procRow(4, "completed", "A05", { off_station_at: "2026-11-12T08:00:00Z" }),
  procRow(5, "running", "A03"), procRow(6, "pending", null)];

test("phase 2 fixtures: the vendored applied-snapshot samples are the shared contract file (3 cases), each carries the r2 contract keys", () => {
  assert.deepEqual(Object.keys(SAMPLES), SAMPLE_NAMES);
  let original = null;
  try { original = fs.readFileSync(OPS_SAMPLE_FILE, "utf8"); } catch { /* ops folder not on this machine */ }
  if (original) assert.deepEqual(SAMPLES, JSON.parse(original), "fixtures/switch_step_applied_snapshot_samples.json == ops sample-applied-snapshot.json");
  for (const name of SAMPLE_NAMES) {
    const ss = SAMPLES[name].switch_step;
    assert.ok(["switched", "already_switched"].includes(ss.mode), name);
    for (const key of ["source_pool_status", "target_pool_status"]) assert.equal(typeof ss[key], "string", `${name}.${key}`);
    assert.equal(ss.moved_qty, 0, name);
    assert.equal(typeof ss.source_unpooled, "boolean", name);
  }
  assert.deepEqual(SAMPLE_NAMES.map((name) => SAMPLES[name].switch_step.source_unpooled), [false, true, false], "only the planner-assigned source ends up unpooled");
});

test("phase 2 flags: enableSwitchStepStarted / switchStepStartedAllowUnpooled default false; only a strict true turns phase 2 on (independent of phase 1)", () => {
  assert.equal(core.startedEnabled({ flag: true }), true);
  for (const flag of [undefined, false, "true", 1, null]) assert.equal(core.startedEnabled({ flag }), false, String(flag));
  assert.equal(core.startedEnabled(), false);
  const config = fs.readFileSync(path.join(__dirname, "config.js"), "utf8");
  assert.match(config, /\n\s*enableSwitchStepStarted: false,\r?\n/);
  assert.match(config, /\n\s*switchStepStartedAllowUnpooled: false,\r?\n/);
  assert.equal(core.STARTED_SUBMIT_RPC, "machtile_submit_switch_step_command");
  assert.equal(core.STARTED_COMMAND_TYPE, "switch_step");
});

test("phase 2 visibility: only a STARTED step (running / paused, or pending with a start) with zero quantity, single-station, nothing in flight", () => {
  const order = runningOrder();
  const see2 = (extra) => core.startedVisibility(Object.assign({ enabled: true, role: "operator", cardDetailsReady: true, machineCode: "A05", order, machineAllowed: true }, extra));
  assert.equal(see2({ machineAllowed: false }).reason, "machine_not_listed");
  assert.equal(see2({ machineAllowed: undefined }).reason, "machine_not_listed", "not in switchStepStartedMachines = hidden");
  assert.deepEqual(see2(), { show: true, reason: "", needsReason: false });
  assert.equal(see2({ order: runningOrder({ processStatus: "paused" }) }).show, true, "stopped (paused) counts as started");
  assert.equal(see2({ role: "admin" }).needsReason, true);
  assert.equal(see2({ role: "planner" }).needsReason, true);
  // 還沒開工（第 1 階段的範圍）→ 這一顆不出；pending 但有開工證據 → 出
  assert.equal(see2({ order: runningOrder({ processStatus: "pending" }) }).reason, "not_started");
  for (const evidence of [{ actualStartAt: "2026-11-13T08:05:00Z" }, { startedLocally: true }, { startedToday: true }]) {
    assert.equal(see2(Object.assign({ order: runningOrder({ processStatus: "pending" }) }, evidence)).show, true, JSON.stringify(evidence));
  }
  for (const status of ["completed", "waiting_inspection", "", undefined]) assert.equal(see2({ order: runningOrder({ processStatus: status }) }).reason, "not_started", String(status));
  // 有數量（任何地方）→ 不出（找生管：第 3 階段）
  assert.equal(see2({ order: runningOrder({ done: 5 }) }).reason, "has_reports");
  assert.equal(see2({ hasTodayReport: true }).reason, "has_reports");
  assert.equal(see2({ enabled: false }).reason, "flag_off");
  assert.equal(see2({ enabled: "true" }).reason, "flag_off");
  assert.equal(see2({ role: "viewer" }).reason, "role");
  assert.equal(see2({ isBridge: true }).reason, "role");
  assert.equal(see2({ multiStation: true }).reason, "multi_station");
  assert.equal(see2({ isUnassignedBucket: true }).reason, "no_machine");
  assert.equal(see2({ order: null }).reason, "no_order");
  assert.equal(see2({ order: runningOrder({ offStation: true }) }).reason, "off_station");
  assert.equal(see2({ order: runningOrder({ stationStep: 0 }) }).reason, "no_step");
  assert.equal(see2({ order: runningOrder({ processId: "x" }) }).reason, "no_process");
  assert.equal(see2({ cardDetailsReady: false }).reason, "card_not_ready");
  assert.equal(see2({ commandInFlight: true }).reason, "command_in_flight");
  assert.equal(see2({ unsureHold: true }).reason, "unsure_hold");
});

test("phase 2 fresh read: still this machine, same order + step, started or not, zero quantity", () => {
  const row = (extra) => Object.assign({ id: PROCESS_ID, process_order: 3, status: "running", off_station_at: null, qty_completed: 0, qty_defect: 0,
    work_orders: { id: WO_ID, work_order_no: "TEST-WO-1", part_no: "TEST-P1", status: "in_progress" }, machines: { machine_code: "A05" } }, extra);
  const check = (extra, args) => core.startedFreshCheck(Object.assign({ machineCode: "A05", orderNo: "TEST-WO-1", step: 3, row: row(extra) }, args));
  assert.deepEqual(check(), { ok: true, reason: "", partNo: "TEST-P1", workOrderId: WO_ID });
  for (const status of ["running", "paused", "pending"]) assert.equal(check({ status }).ok, true, status);
  assert.equal(check({ status: "completed" }).reason, "not_switchable");
  assert.equal(check({ qty_completed: 1 }).reason, "has_reports");
  assert.equal(check({ qty_defect: 2 }).reason, "has_reports");
  assert.equal(check({ off_station_at: "2026-11-13T09:00:00Z" }).reason, "off_station");
  assert.equal(check({ machines: { machine_code: "A04" } }).reason, "machine_changed");
  assert.equal(check({ process_order: 1 }).reason, "step_changed");
  assert.equal(check({ work_orders: { id: WO_ID, work_order_no: "X", status: "in_progress" } }).reason, "order_changed");
  assert.equal(check({ work_orders: { id: WO_ID, work_order_no: "TEST-WO-1", status: "cancelled" } }).reason, "order_closed");
  assert.equal(core.startedFreshCheck({ machineCode: "A05", orderNo: "TEST-WO-1", step: 3, row: null }).reason, "process_not_found");
});

test("phase 2 source pool key: held-claims RPC first; else the last applied claim/return/switch event of this step on this machine; else null (planner-assigned)", () => {
  const at = (minutes) => new Date(Date.UTC(2026, 10, 13, 8, minutes)).toISOString();
  const ev = (type, step, extra) => Object.assign({ command_uuid: UUID, command_type: type, machine_code: "A05", pool_item_id: keyOf(step), expected_order_no: "TEST-WO-1",
    expected_index_sn: step, status: "applied", requested_at: at(0), legacy_snapshot: null }, extra);
  const key = (rows, step = 3) => core.historyPoolKey({ rows, machineCode: "A05", orderNo: "TEST-WO-1", step });
  assert.equal(key([ev("claim_next", 3)]), keyOf(3), "claimed through claim_next");
  assert.equal(key([ev("claim_next", 3, { requested_at: at(1) }), ev("return_claim", 3, { requested_at: at(2) })]), "", "returned afterwards");
  assert.equal(key([ev("claim_next", 3, { requested_at: at(1) }), ev("return_claim", 3, { requested_at: at(2) }), ev("claim_next", 3, { requested_at: at(3), pool_item_id: keyOf(3) + "b" })]), keyOf(3) + "b", "claimed again");
  assert.equal(key([ev("claim_next", 3, { status: "rejected" })]), "", "only applied rows count");
  assert.equal(key([ev("claim_next", 3, { machine_code: "A04" })]), "", "another machine's claim is not this card's");
  assert.equal(key([ev("claim_next", 3, { expected_order_no: "TEST-WO-9" })]), "");
  assert.equal(key([ev("claim_next", 2)]), "", "another step");
  // 換道次換進來的那一道：雲端記了接單（cloud_finalize.target_claim_id）才算池裡接的；之後再從它換走＝放掉
  const switchedIn = (finalize) => ev("switch_step", 1, { requested_at: at(5), pool_item_id: keyOf(1),
    legacy_snapshot: { switch_step: { from_index_sn: 1, to_index_sn: 3, target_pool_item_id: keyOf(3), target_pool_status: "assigned" }, cloud_finalize: finalize } });
  assert.equal(key([switchedIn({ target_claim_id: "c1" })]), keyOf(3));
  assert.equal(key([switchedIn({ target_attached: true })]), "", "no ledger claim recorded → not pooled");
  assert.equal(key([switchedIn({ target_claim_id: "c1" }), ev("switch_step", 3, { requested_at: at(9) })]), "", "switched away again");
  assert.equal(key(null), "");
  assert.equal(key([ev("claim_next", 3, { requested_at: "nonsense" })]), "");
  // 優先順序
  const pick = (heldKey, historyRows) => core.sourcePoolKey({ heldKey, historyRows, machineCode: "A05", orderNo: "TEST-WO-1", step: 3 });
  assert.deepEqual(pick(keyOf(3), [ev("claim_next", 3, { pool_item_id: "01|OTHER|S3" })]), { key: keyOf(3), source: "held" });
  assert.deepEqual(pick("", [ev("claim_next", 3)]), { key: keyOf(3), source: "history" });
  assert.deepEqual(pick("abc", []), { key: "", source: "none" }, "a malformed held key is ignored");
});

test("phase 2 targets: same order, not this step, not done, not on another machine; pooled ones labeled; unpooled only with switchStepStartedAllowUnpooled", () => {
  const pool = [poolRow(1), poolRow(2), poolRow(4, { source_key: keyOf(4) }), poolRow(5), OTHER_ORDER_ROW, poolRow(3)];
  const found = (extra) => core.startedTargets(Object.assign({ orderNo: "TEST-WO-1", currentStep: 3, poolReady: true, poolItems: pool, processesReady: true,
    processes: STEPS(), machine: MACHINE_LATHE, allowUnpooled: false }, extra));
  const ids = (result) => result.choices.map((c) => [c.step, c.pooled, c.sourceKey]);
  assert.deepEqual(ids(found()), [[1, true, keyOf(1)], [2, true, keyOf(2)]], "step 4 done, step 5 on A03, step 3 is the current one, other orders ignored");
  assert.equal(found().choices[0].name, "CNC車床加工");
  assert.equal(found().choices[0].quantity, 120);
  assert.deepEqual(ids(found({ allowUnpooled: true })), [[1, true, keyOf(1)], [2, true, keyOf(2)], [6, false, ""]], "step 6 is not pooled: listed only with the flag");
  assert.equal(found({ allowUnpooled: true }).choices[2].id, "step:6");
  assert.equal(found({ allowUnpooled: true }).choices[2].name, "研磨");
  // 這台不能做的池列（別課、不在可做機台清單、不是 waiting）→ 不列、記數
  const notMine = found({ poolItems: [poolRow(1, { department_code: "MILL" }), poolRow(2, { eligible_machine_codes: ["A03"] }), poolRow(6, { status: "claimed" })] });
  assert.deepEqual(notMine.choices, []);
  assert.equal(notMine.notEligible, 3);
  // 讀不到各道：池裡的照列（伺服器會再驗），不在池裡的不列
  assert.deepEqual(ids(found({ processesReady: false, processes: null, allowUnpooled: true })), [[1, true, keyOf(1)], [2, true, keyOf(2)], [4, true, keyOf(4)], [5, true, keyOf(5)]]);
  // 待做池讀不到：旗標關＝沒有清單；旗標開＝只列不在池裡的（池裡那幾道也列成不在池裡會送錯 → 不列）
  assert.equal(found({ poolReady: false }).ready, false);
  assert.deepEqual(ids(found({ poolReady: false, allowUnpooled: true })), [[1, false, ""], [2, false, ""], [6, false, ""]]);
  assert.equal(found({ orderNo: "" }).choices.length, 0);
  assert.equal(found({ machine: {} }).choices.length, 0);
});

test("phase 2 submit args: exactly the nine RPC parameter names, nullable pools, admin reason mandatory", () => {
  const args = core.startedBuildArgs({ commandUuid: S_UUID, machineCode: " a05 ", poolItemId: keyOf(3), orderNo: "TEST-WO-1", step: 3, targetStep: 1,
    targetPoolItemId: keyOf(1), partNo: "TEST-P1", reason: "", role: "operator" });
  assert.deepEqual(Object.keys(args), [...core.STARTED_ARG_KEYS]);
  assert.deepEqual(args, { p_command_uuid: S_UUID, p_machine_code: "A05", p_pool_item_id: keyOf(3), p_expected_order_no: "TEST-WO-1", p_expected_index_sn: 3,
    p_target_index_sn: 1, p_target_pool_item_id: keyOf(1), p_expected_part_no: "TEST-P1", p_reason: null });
  // 雲端函式簽章（檔案在這台電腦上時）：參數名稱與順序逐字相同
  let sql = "";
  try { sql = fs.readFileSync(CLOUD_SWITCH_SQL, "utf8"); } catch { /* cloud worktree not on this machine */ }
  if (sql) {
    const sig = /create function public\.machtile_submit_switch_step_command\(([\s\S]*?)\)\s*returns/.exec(sql);
    assert.ok(sig, "cloud migration declares the submit RPC");
    assert.deepEqual(sig[1].split(",").map((part) => part.trim().split(/\s+/)[0]), [...core.STARTED_ARG_KEYS], "parameter names == cloud signature");
  }
  const plain = core.startedBuildArgs({ commandUuid: S_UUID, machineCode: "A05", poolItemId: "", orderNo: "TEST-WO-1", step: 3, targetStep: 6, targetPoolItemId: "", role: "admin", reason: " 生管代換 " });
  assert.equal(plain.p_pool_item_id, null, "planner-assigned source → null");
  assert.equal(plain.p_target_pool_item_id, null, "unpooled target → null");
  assert.equal(plain.p_reason, "生管代換");
  assert.equal(plain.p_expected_part_no, null);
  const bad = (extra) => () => core.startedBuildArgs(Object.assign({ commandUuid: S_UUID, machineCode: "A05", poolItemId: keyOf(3), orderNo: "TEST-WO-1", step: 3, targetStep: 1, role: "operator" }, extra));
  assert.throws(bad({ commandUuid: "x" }), /BAD_COMMAND_UUID/);
  assert.throws(bad({ targetStep: 3 }), /SAME_STEP/);
  assert.throws(bad({ targetStep: 0 }), /NO_TARGET_STEP/);
  assert.throws(bad({ targetPoolItemId: keyOf(3) }), /BAD_TARGET_POOL_ITEM_ID/, "target pool row must differ from the source pool row");
  assert.throws(bad({ poolItemId: "abc" }), /BAD_POOL_ITEM_ID/);
  assert.throws(bad({ role: "admin", reason: "" }), /REASON_REQUIRED/);
  assert.throws(bad({ reason: "x".repeat(501) }), /REASON_TOO_LONG/);
  assert.throws(bad({ role: "viewer" }), /BAD_ROLE/);
  assert.throws(bad({ orderNo: "" }), /NO_ORDER/);
});

test("phase 2 error codes: every cloud submit raise and every Factory reject_code has its own plain sentence; reports → 找生管; unsure ≠ 'not switched'", () => {
  const d = dictionaries();
  // 原始碼在這台電腦上時：清單＝原始碼（不多不少）
  let sql = "";
  try { sql = fs.readFileSync(CLOUD_SWITCH_SQL, "utf8"); } catch { /* not on this machine */ }
  if (sql) {
    const body = sql.slice(sql.indexOf("create function public.machtile_submit_switch_step_command"), sql.indexOf("create function public.machtile_finish_switch_step_command"));
    assert.deepEqual([...new Set([...body.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]))].sort(), [...CLOUD_SUBMIT_CODES].sort(), "vendored cloud code list == the submit RPC");
  }
  let applier = "", models = "", processor = "";
  try {
    applier = fs.readFileSync(path.join(FACTORY_SWITCH_DIR, "StationSwitchStepApplier.cs"), "utf8");
    models = fs.readFileSync(path.join(FACTORY_SWITCH_DIR, "StationCommandModels.cs"), "utf8");
    processor = fs.readFileSync(path.join(FACTORY_SWITCH_DIR, "StationCommandProcessor.cs"), "utf8");
  } catch { /* factory worktree not on this machine */ }
  if (applier && models && processor) {
    const value = new Map([...models.matchAll(/public const string (\w+) = "([A-Z0-9_]+)";/g)].map((m) => [m[1], m[2]]));
    const branch = processor.slice(processor.indexOf("if (type == StationCommandMatcher.SwitchStep"), processor.indexOf("if (type != StationCommandMatcher.Start"));
    const names = new Set([...`${applier}\n${branch}`.matchAll(/StationCommandRejectCodes\.(\w+)/g)].map((m) => m[1]));
    const fromSource = [...names].map((name) => value.get(name)).filter(Boolean);
    for (const code of fromSource) assert.ok(FACTORY_SWITCH_CODES.includes(code), `factory code ${code} is in the vendored list`);
  }
  for (const code of [...CLOUD_SUBMIT_CODES, ...FACTORY_SWITCH_CODES, "HAS_REPORTS", "EXPIRED", "MANUAL_RELEASED"]) {
    const info = core.startedRejectInfo(code);
    assert.equal(info.known, true, `${code} is mapped`);
    assert.notEqual(info.messageKey, core.STARTED_GENERIC_MESSAGE_KEY, `${code} has its own sentence`);
    assert.equal(typeof d.zh[info.messageKey], "string", `${code} → ${info.messageKey} exists`);
    assert.doesNotMatch(fill(d.zh[info.messageKey], { from: 3, to: 1 }), /[A-Z][A-Z0-9]*_[A-Z0-9_]+|\{\{/, `${code}: no raw code, no unfilled placeholder`);
  }
  for (const code of ["HAS_REPORTS", "SWITCH_STEP_HAS_REPORTS"]) {
    const text = fill(d.zh[core.startedRejectInfo(code).messageKey], { from: 3, to: 1 });
    assert.match(text, /找生管/, `${code} tells them to find the planner`);
    assert.match(text, /第 3 道已經有報工數量/);
  }
  assert.equal(fill(d.zh[core.startedRejectInfo("SWITCH_STEP_HAS_REPORTS").messageKey], { from: 3 }), "第 3 道已經有報工數量，不能直接換道次。請找生管處理（報工修正）。");
  // 結果不確定：不說「沒有換」，叫他重新整理、不要重按
  for (const code of core.STARTED_UNCERTAIN_CODES) {
    const info = core.startedRejectInfo(code);
    assert.equal(info.uncertain, true);
    assert.doesNotMatch(d.zh[info.messageKey], /沒有換/, code);
    assert.match(d.zh[info.messageKey], /不要重按/, code);
  }
  // 「等一下再按」有機會成功的才叫人再按；其他確定沒換的都說「這台沒有變／還是第 N 道」或叫他找生管
  for (const code of core.STARTED_RETRY_LATER_CODES) assert.match(d.zh[core.startedRejectInfo(code).messageKey], /再按|再試/, code);
  assert.equal(core.startedRejectInfo("SOMETHING_NEW").messageKey, core.STARTED_GENERIC_MESSAGE_KEY);
  assert.equal(core.startedRejectInfo("SOMETHING_NEW").known, false);
  // 送出失敗（returnClaimCore.submitErrorInfo 先分 missing／uncertain／rejected）
  const via = (error) => core.startedSubmitErrorInfo(returnCore.submitErrorInfo(error));
  assert.deepEqual(via(new Error('400 {"code":"P0001","message":"SWITCH_STEP_HAS_REPORTS"}')), { kind: "rejected", code: "SWITCH_STEP_HAS_REPORTS", messageKey: "switch_step_started_err_reported", params: {} });
  assert.deepEqual(via(new Error('400 {"code":"P0001","message":"TARGET_TAKEN","details":"{\\"claimed_machine_code\\":\\"A04\\"}"}')).messageKey, "switch_step_started_err_target_taken");
  assert.equal(via(Object.assign(new TypeError("Failed to fetch"))).kind, "uncertain");
  assert.equal(via(new Error("503 upstream")).kind, "uncertain");
  assert.equal(via(new Error('404 {"code":"PGRST202"}')).messageKey, "switch_step_started_err_not_open", "RPC not deployed yet");
  assert.equal(via(new Error("401 jwt expired")).messageKey, "switch_step_started_err_login");
  assert.equal(via(new Error('400 {"message":"WHATEVER_ELSE"}')).messageKey, "switch_step_started_err_generic");
});

test("phase 2 result view from the three contract samples: done sentence, and source_unpooled → the 'not on any machine, not in the pool' notice", () => {
  const d = dictionaries();
  const say = (view) => fill(d.zh[view.messageKey], view.params);
  const pooled = core.startedResultView(appliedSwitchRow("pooled_to_pooled"), { from: 3, to: 1 });
  assert.equal(pooled.phase, "applied");
  assert.equal(pooled.tone, "ok");
  assert.equal(pooled.sourceUnpooled, false);
  assert.equal(pooled.noticeKey, undefined);
  assert.equal(say(pooled), "已換成第 1 道，請按「開工」開始做。第 3 道已退回待做池，沒有記任何數量。");
  const planner = core.startedResultView(appliedSwitchRow("planner_source_unpooled_to_pooled"), { from: 3, to: 1 });
  assert.equal(planner.sourceUnpooled, true);
  assert.equal(planner.noticeKey, "switch_step_started_unpooled_notice");
  assert.equal(say(planner), "已換成第 1 道，請按「開工」開始做。第 3 道沒有記任何數量。", "never claims the old step went back to the pool");
  assert.equal(fill(d.zh[planner.noticeKey], planner.params), "注意：第 3 道現在不在任何機台、也不在待做池。請生管用「設定到這台」重新安排。");
  const unpooledTarget = core.startedResultView(appliedSwitchRow("pooled_to_unpooled_target"), { from: 3, to: 1 });
  assert.equal(unpooledTarget.sourceUnpooled, false);
  assert.equal(say(unpooledTarget), say(pooled), "unpooled target: same sentence (the old step went back to the pool)");
  // 快照為準（from／to／order 從 switch_step 讀；輪詢沒有 target_index_sn 時用送出時記下的）
  assert.deepEqual(core.appliedInfo(appliedSwitchRow("pooled_to_pooled")), { mode: "switched", from: 3, to: 1, orderNo: "WO1", machineCode: "A05",
    sourcePoolStatus: "returned", targetPoolStatus: "assigned", sourceUnpooled: false, returnedToPool: true });
  assert.equal(core.startedResultView(appliedSwitchRow("pooled_to_pooled", {}, { to_index_sn: undefined }), { from: 3, to: 2 }).params.to, 2);
  // 快照是字串（PostgREST 有時回 text）也讀得到；source_unpooled 只認嚴格的 true
  assert.equal(core.startedResultView(Object.assign(appliedSwitchRow("planner_source_unpooled_to_pooled"), { legacy_snapshot: JSON.stringify(sampleOf("planner_source_unpooled_to_pooled")) })).sourceUnpooled, true);
  assert.equal(core.startedResultView(appliedSwitchRow("planner_source_unpooled_to_pooled", {}, { source_unpooled: "true" })).sourceUnpooled, false);
  assert.equal(core.startedResultView(appliedSwitchRow("pooled_to_pooled", {}, { mode: "already_switched" })).messageKey, "switch_step_started_done", "already_switched = success");
  // 其他狀態
  assert.deepEqual([core.startedResultView(switchRow()).phase, core.startedResultView(switchRow()).terminal], ["pending", false]);
  assert.equal(core.startedResultView(switchRow({ status: "claimed" })).messageKey, "switch_step_started_processing");
  const rejected = core.startedResultView(switchRow({ status: "rejected", reject_code: "SWITCH_STEP_TARGET_TAKEN" }), { from: 3, to: 1 });
  assert.deepEqual([rejected.tone, rejected.code, say(rejected)], ["bad", "SWITCH_STEP_TARGET_TAKEN", "第 1 道已經在別台機台上或被別台接走，沒有換。這台還是第 3 道，狀態沒有變。"]);
  const unsure = core.startedResultView(switchRow({ status: "rejected", reject_code: "OUTCOME_UNKNOWN" }), { from: 3, to: 1 });
  assert.deepEqual([unsure.tone, core.startedIsUnsure(unsure)], ["warn", true]);
  assert.equal(core.startedResultView(switchRow({ status: "expired", reject_code: "EXPIRED" }), { from: 3 }).messageKey, "switch_step_started_err_expired");
});

test("phase 2 unpooled notices: only source_unpooled samples; operators 24 h, admins / planners 72 h unless dismissed on this tablet", () => {
  const now = Date.parse("2026-11-14T08:00:00Z");
  const rows = SAMPLE_NAMES.map((name, i) => appliedSwitchRow(name, { command_uuid: [S_UUID, S_UUID2, UUID][i], applied_at: "2026-11-14T07:00:00Z" }));
  const op = core.unpooledNotices({ rows, nowMs: now, role: "operator" });
  assert.deepEqual(op, [{ commandUuid: S_UUID2, machineCode: "A05", orderNo: "WO1", from: 3, to: 1, at: Date.parse("2026-11-14T07:00:00Z") }], "only the planner-assigned sample");
  const old = rows.map((row) => Object.assign({}, row, { applied_at: "2026-11-12T09:00:00Z" }));   // 47 小時前
  assert.deepEqual(core.unpooledNotices({ rows: old, nowMs: now, role: "operator" }), []);
  assert.equal(core.unpooledNotices({ rows: old, nowMs: now, role: "admin" }).length, 1);
  assert.equal(core.unpooledNotices({ rows: old, nowMs: now, role: "planner" }).length, 1);
  assert.deepEqual(core.unpooledNotices({ rows: old, nowMs: now + 30 * 3600 * 1000, role: "admin" }), [], "older than 72 h");
  assert.deepEqual(core.unpooledNotices({ rows, nowMs: now, role: "admin", dismissed: new Set([S_UUID2]) }), []);
  assert.deepEqual(core.unpooledNotices({ rows: rows.map((row) => Object.assign({}, row, { status: "rejected" })), nowMs: now, role: "admin" }), []);
  assert.deepEqual(core.unpooledNotices({ rows: rows.map((row) => Object.assign({}, row, { command_type: "return_claim" })), nowMs: now, role: "admin" }), []);
  assert.deepEqual(core.unpooledNotices({ rows: null, nowMs: now }), []);
});

test("phase 2 strings: zh-Hant + vi draft for every key, same placeholders; retry wording only where pressing again can help", () => {
  const d = dictionaries();
  const keys = Object.keys(d.zh).filter((key) => key.startsWith("switch_step_started_"));
  assert.ok(keys.length >= 60, `found ${keys.length}`);
  const retryAllowed = new Set(["switch_step_started_progress", "switch_step_started_uncertain", "switch_step_started_not_found", "switch_step_started_resend",
    "switch_step_started_unsure", "switch_step_started_err_busy", "switch_step_started_err_claim_not_applied", "switch_step_started_err_busy_retry",
    "switch_step_started_err_internal_retry", "switch_step_started_err_expired", "switch_step_started_err_released", "switch_step_started_read_failed"]);
  for (const key of keys) {
    assert.equal(d.vi[key], d.viFile[key]?.value, `${key} vi i18n.js == locales`);
    assert.equal(d.viFile[key]._draft, true, `${key} vi draft`);
    assert.equal(d.zh[key], d.zhFile[key], `${key} zh i18n.js == locales`);
    if (/再按|重按|重送|再試|重試/.test(d.zh[key].replace(/再按「開工」/g, ""))) assert.ok(retryAllowed.has(key), `${key} must not tell the operator to press again`);
  }
  assert.equal(d.zh.switch_step_started_button, "換道次");
  assert.match(d.zh.switch_step_started_unpooled_card, /不在任何機台、也不在待做池/);
  assert.match(d.zh.switch_step_started_unpooled_card, /請生管用「設定到這台」重新安排/);
  assert.equal(d.zh.switch_step_started_tag_pool, "待做池");
});

test("phase 2 pending record: nine args kept, session-scoped restore, lock rules, unsure hold", () => {
  const args = core.startedBuildArgs({ commandUuid: S_UUID, machineCode: "A05", poolItemId: keyOf(3), orderNo: "TEST-WO-1", step: 3, targetStep: 1, targetPoolItemId: keyOf(1), role: "operator" });
  const rec = core.startedPendingRecord({ commandUuid: S_UUID, machineCode: "a05", orderNo: "TEST-WO-1", step: 3, targetStep: 1, processId: PROCESS_ID, ...SESSION, args, startedAt: 1000 });
  assert.deepEqual(rec.args, args);
  assert.equal(rec.machineCode, "A05");
  const raw = JSON.stringify({ A05: rec, A03: Object.assign({}, rec, { machineCode: "A03" }) });
  assert.deepEqual(Object.keys(core.startedRestoreForSession(raw, 2000, SESSION)), ["A05"], "the A03 record names machine A05 in its args → dropped");
  assert.deepEqual(core.startedRestoreForSession(raw, 2000, { tenantId: SESSION.tenantId, appUserId: "someone-else" }), {});
  assert.deepEqual(core.startedRestoreForSession(raw, 1000 + core.STARTED_PENDING_KEEP_MS + 1, SESSION), {}, "older than 24 h");
  assert.deepEqual(core.startedRestoreForSession("{bad", 2000, SESSION), {});
  const merged = core.startedMergeForSave(JSON.stringify({ A03: Object.assign({}, rec, { appUserId: "other", args: Object.assign({}, args, { p_machine_code: "A03" }) }) }), { A05: rec }, 2000, SESSION);
  assert.deepEqual(Object.keys(merged).sort(), ["A03", "A05"], "another user's record on this tablet is kept");
  assert.equal(core.startedLocks(rec, false), true);
  assert.equal(core.startedLocks(Object.assign({}, rec, { notFound: true }), false), false);
  assert.equal(core.startedLocks(Object.assign({}, rec, { lastStatus: "pending" }), true), false);
  assert.equal(core.startedLocks(Object.assign({}, rec, { lastStatus: "claimed" }), true), true);
  const unsureView = core.startedResultView(switchRow({ status: "rejected", reject_code: "OUTCOME_UNKNOWN" }));
  const last = { view: unsureView, at: 0, orderNo: "TEST-WO-1", step: 3 };
  assert.equal(core.startedUnsureHold(last, { orderNo: "TEST-WO-1", step: 3, nowMs: 60000 }), true);
  assert.equal(core.startedUnsureHold(last, { orderNo: "TEST-WO-1", step: 1, nowMs: 60000 }), false, "the card moved on");
  assert.equal(core.startedUnsureHold(last, { orderNo: "TEST-WO-1", step: 3, nowMs: core.STARTED_UNSURE_HOLD_MS + 1 }), false);
  assert.equal(core.startedUnsureHold(Object.assign({}, last, { view: core.startedResultView(switchRow({ status: "rejected", reject_code: "STALE" })) }), { orderNo: "TEST-WO-1", step: 3, nowMs: 1 }), false);
});

// ---------------------------------------------------------------- 第 2 階段 app.js 接線
function startedBackendOf(state) {
  Object.assign(state, { submits: [], polls: 0, reads: [], row: null, ...state });
  return async (url, init) => {
    if (url.startsWith("work_order_processes?") && url.includes("&id=eq.")) {
      state.reads.push("fresh");
      if (state.freshFail) throw new TypeError("Failed to fetch");
      return state.fresh ? state.fresh() : freshRow({ status: "running", qty_defect: 0, work_orders: { id: WO_ID, work_order_no: "TEST-WO-1", part_no: "TEST-P1", part_name: "測試軸", status: "in_progress" } });
    }
    if (url.startsWith("work_order_processes?") && url.includes("&work_order_id=eq.")) {
      state.reads.push("steps");
      assert.match(url, new RegExp(`&work_order_id=eq\\.${WO_ID}&`), "the order's steps are read by the work order id from the fresh read");
      return state.steps ? state.steps() : STEPS();
    }
    if (url === `rpc/${returnCore.HELD_CLAIMS_RPC}`) { state.reads.push("held"); assert.deepEqual([init.method, init.body], ["POST", "{}"]); return state.held ? state.held() : []; }
    if (url.startsWith("station_commands?") && url.includes("&command_type=in.(claim_next,return_claim,switch_step)&")) {
      state.reads.push("history");
      assert.match(url, /&machine_code=eq\.A05&expected_order_no=eq\.TEST-WO-1&/);
      return state.history ? state.history() : [];
    }
    if (url.startsWith("station_commands?") && url.includes("&command_type=eq.switch_step&")) { state.reads.push("notices"); return state.noticeRows ? state.noticeRows() : []; }
    if (url.startsWith("dispatch_pool_items?")) { state.reads.push("pool"); return state.pool ? state.pool() : [poolRow(1), poolRow(2), OTHER_ORDER_ROW]; }
    if (url === `rpc/${core.STARTED_SUBMIT_RPC}`) {
      const body = JSON.parse(init.body);
      state.submits.push({ body, raw: init.body });
      if (state.submitError) throw state.submitError;
      state.row = switchRow({ command_uuid: body.p_command_uuid, pool_item_id: body.p_pool_item_id, expected_order_no: body.p_expected_order_no, expected_index_sn: body.p_expected_index_sn });
      return [state.row];
    }
    if (url.startsWith(returnCore.POLL_PATH_PREFIX)) { state.polls += 1; return state.row ? [state.row] : []; }
    throw new Error(`unexpected ${url} ${init?.method || ""}`);
  };
}
// 工廠做完之後雲端那一列（快照照樣本，工單號換成這裡的 TEST-WO-1）
const finishedAs = (state, name, extra) => {
  state.row = appliedSwitchRow(name, { command_uuid: state.row.command_uuid, expected_order_no: "TEST-WO-1", pool_item_id: state.row.pool_item_id }, Object.assign({ order_no: "TEST-WO-1" }, extra));
};
const STARTED_BUTTON = '<button type="button" class="card-select-entry pool-return-action" data-no-detail data-switch-step-started-open="A05">換道次</button>';
const clickOf = (attr, value) => ({ target: { closest: (selector) => (selector.includes(attr) ? { dataset: value } : null) } });

test("phase 2 flag off (missing / false / non-boolean): no button, no lock, no fetch, no storage — the card is what it was", async () => {
  for (const started of [undefined, false, "true", 1, null]) {
    const h = harness({ started, order: runningOrder(), backend: startedBackendOf({}) });
    assert.equal(h.api.started.enabled(), false, String(started));
    assert.equal(h.api.started.markup(h.machine), "");
    assert.equal(h.api.started.locks("A05"), false);
    assert.equal(h.api.locks("A05"), false);
    assert.equal(h.api.blockMessage("A05"), "");
    assert.equal(h.api.started.handleClick(clickOf("data-switch-step-started-open", { switchStepStartedOpen: "A05" })), false);
    await h.api.started.open("A05", null);
    h.api.started.restore();
    await h.api.started.loadNotices();
    assert.equal(h.startedSheetHtml(), "");
    assert.deepEqual(h.calls, { fetch: [], toasts: [], rerenders: 0, refresh: [], storageReads: 0, reloads: 0, closedSelection: 0 });
  }
  // 核心檔沒載到（舊快取）＝當作關
  const noCore = harness({ started: true, noCore: true, order: runningOrder() });
  assert.equal(noCore.api.started.enabled(), false);
  assert.equal(noCore.api.started.markup(noCore.machine), "");
});

test("phase 2 flag on: 「換道次」 only on a started, zero-quantity card; never together with the phase-1 buttons; rendering is read-only", () => {
  const h = harness({ started: true, order: runningOrder() });
  assert.equal(h.api.started.markup(h.machine), STARTED_BUTTON);
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.started.gate(h.machine))), { show: true, reason: "", needsReason: false });
  assert.equal(h.calls.fetch.length, 0, "drawing the card fetches nothing");
  assert.equal(h.calls.storageReads, 0, "no notices → drawing the card does not even read the dismissed-notice list");
  // 還沒開工 → 第 1 階段的範圍，這一顆不出
  const notStarted = harness({ started: true, returnFlag: true, flag: true });
  assert.equal(notStarted.api.started.markup(notStarted.machine), "");
  assert.match(notStarted.api.markup(notStarted.machine), /data-switch-step-open="A05"/, "phase 1 button stays as it was");
  // 已開工 → 第 1 階段的按鈕不出，只有這一顆
  const both = harness({ started: true, returnFlag: true, flag: true, order: runningOrder({ heldPoolKey: CURRENT_KEY }) });
  assert.equal(both.api.markup(both.machine), "");
  assert.equal(both.api.started.markup(both.machine), STARTED_BUTTON);
  for (const order of [runningOrder({ done: 2 }), runningOrder({ processStatus: "completed" }), null]) {
    const hidden = harness({ started: true, order });
    assert.equal(hidden.api.started.markup(hidden.machine), "", JSON.stringify(order && order.processStatus));
  }
  const busy = harness({ started: true, order: runningOrder(), stationPending: { A05: { commandUuid: UUID2, commandType: "stop" } } });
  assert.equal(busy.api.started.markup(busy.machine), "", "another station command in flight");
  const reported = harness({ started: true, order: runningOrder(), todayRows: [{ process_id: PROCESS_ID }] });
  assert.equal(reported.api.started.markup(reported.machine), "", "reported today");
});

test("phase 2 happy path (A05 running step 3 → step 1, pooled → pooled sample): four reads, one submit with the nine args, existing poll, done sentence", async () => {
  const state = { held: () => [claimedRow(3)] };
  const h = harness({ started: true, order: runningOrder(), backend: startedBackendOf(state), uuids: [S_UUID] });
  h.api.started.handleClick(clickOf("data-switch-step-started-open", { switchStepStartedOpen: "A05" }));
  await settle();
  await settle();
  assert.deepEqual([...state.reads].sort(), ["fresh", "held", "history", "pool", "steps"].sort());
  const html = h.startedSheetHtml();
  assert.match(html, /換道次：TEST-WO-1 · TEST-P1 測試軸/);
  assert.match(html, /現在掛的：第 3 道 · 精車（已開工、還沒報工）/);
  assert.match(html, /data-switch-step-started-choice="01\|TEST-WO-1\|S1"[^>]*>第 1 道 · CNC車床加工 · 120 件 · 待做池</);
  assert.match(html, /data-switch-step-started-choice="01\|TEST-WO-1\|S2"[^>]*>第 2 道 · 車牙 · 120 件 · 待做池</);
  assert.doesNotMatch(html, /step:6/, "unpooled steps are not listed with the flag off");
  assert.match(html, /data-switch-step-started-confirm disabled/, "nothing picked yet (two choices)");
  h.api.started.handleClick({ target: { closest: (selector) => (selector === "#machtileSwitchStartedSheet" ? {} : selector === "[data-switch-step-started-choice]" ? { dataset: { switchStepStartedChoice: keyOf(1) } } : null) } });
  assert.match(h.startedSheetHtml(), /這台現在做的是 TEST-WO-1 第 3 道（已開工、還沒報工）。要換成第 1 道嗎？/);
  assert.match(h.startedSheetHtml(), />換成第 1 道</);
  await h.api.started.submit();
  assert.equal(state.submits.length, 1);
  assert.deepEqual(state.submits[0].body, { p_command_uuid: S_UUID, p_machine_code: "A05", p_pool_item_id: CURRENT_KEY, p_expected_order_no: "TEST-WO-1", p_expected_index_sn: 3,
    p_target_index_sn: 1, p_target_pool_item_id: keyOf(1), p_expected_part_no: "TEST-P1", p_reason: null });
  // 等結果中：這台全部鎖住，按鈕換成一行字，另一次開卡不會有第二筆
  assert.equal(h.api.locks("A05"), true);
  assert.equal(h.api.blockMessage("A05"), "這台正在「換道次」，等它有結果再操作。");
  assert.match(h.api.started.markup(h.machine), /data-switch-step-started-status="pending"[^>]*>換道次處理中（第 3 道 → 第 1 道），等工廠處理…</);
  assert.match(h.startedSheetHtml(), /換道次處理中，等工廠處理（約 10–30 秒）。請不要重按。/);
  assert.ok(h.storage.get("machtile.switchStepStartedPending.v1").includes(S_UUID), "kept across a reload");
  await h.api.started.open("A05", null);
  assert.equal(state.submits.length, 1);
  finishedAs(state, "pooled_to_pooled");
  await h.runPoll();
  assert.deepEqual(h.calls.toasts, ["已換成第 1 道，請按「開工」開始做。第 3 道已退回待做池，沒有記任何數量。"]);
  assert.deepEqual(h.calls.refresh, [["A05", "switch_step"]]);
  assert.match(h.startedSheetHtml(), /data-switch-step-started-result="applied"/);
  assert.doesNotMatch(h.startedSheetHtml(), /data-switch-step-started-unpooled/);
  assert.equal(h.api.locks("A05"), false);
  assert.equal(JSON.parse(h.storage.get("machtile.switchStepStartedPending.v1")).A05, undefined);
  assert.equal(state.submits.length, 1, "never resubmitted");
});

test("phase 2 planner-assigned source (sample 2): p_pool_item_id null, admin reason; applied with source_unpooled → persistent notice on the sheet and card, visible to admins everywhere", async () => {
  const state = {};
  const h = harness({ started: true, role: "admin", order: runningOrder(), backend: startedBackendOf(state), uuids: [S_UUID] });
  await h.api.started.open("A05", null);
  assert.match(h.startedSheetHtml(), /data-switch-step-started-on-behalf/);
  h.api.started.choose(keyOf(1));
  await h.api.started.submit();
  assert.equal(state.submits.length, 0, "admin without a reason: not sent");
  assert.match(h.startedSheetHtml(), /data-switch-step-started-reason-error[^>]*>請寫換道次的原因。</);
  h.api.started.state.sheet.reason = "生管代換：接錯道次";
  await h.api.started.submit();
  assert.equal(state.submits[0].body.p_pool_item_id, null, "no held claim, no claim history → planner-assigned");
  assert.equal(state.submits[0].body.p_reason, "生管代換：接錯道次");
  finishedAs(state, "planner_source_unpooled_to_pooled");
  state.noticeRows = () => [state.row];
  await h.runPoll();
  await settle();
  const notice = "注意：第 3 道現在不在任何機台、也不在待做池。請生管用「設定到這台」重新安排。";
  assert.deepEqual(h.calls.toasts, [`已換成第 1 道，請按「開工」開始做。第 3 道沒有記任何數量。 ${notice}`]);
  assert.match(h.startedSheetHtml(), new RegExp(`data-switch-step-started-unpooled>${notice}<`));
  const cardLine = "待安排：TEST-WO-1 第 3 道現在不在任何機台、也不在待做池（A05 換成第 1 道時撤下）。請生管用「設定到這台」重新安排。";
  const card = h.api.started.markup(h.machine);
  assert.ok(card.includes(cardLine), card);
  assert.match(card, new RegExp(`data-switch-step-unpooled-dismiss="${S_UUID}"`), "admins get 已安排，收起");
  assert.ok(state.reads.includes("notices"), "the cloud list is re-read after an unpooled switch");
  // 收起只在這台平板；收起後卡片上不再顯示
  h.api.started.handleClick(clickOf("data-switch-step-unpooled-dismiss", { switchStepUnpooledDismiss: S_UUID }));
  assert.ok(!h.api.started.markup(h.machine).includes(cardLine));
  // 另一台平板的生管：開機時從雲端讀到（不用是自己按的）
  const planner = harness({ started: true, role: "planner", order: runningOrder({ id: "TEST-WO-2" }), backend: startedBackendOf({ noticeRows: () => [state.row] }) });
  planner.api.started.restore();
  await settle();
  assert.ok(planner.api.started.markup(planner.machine).includes(cardLine), "visible to a planner on another tablet");
  // 作業員：看得到，但沒有「收起」
  const operator = harness({ started: true, order: runningOrder({ id: "TEST-WO-2" }), backend: startedBackendOf({ noticeRows: () => [state.row] }) });
  operator.api.started.restore();
  await settle();
  const opCard = operator.api.started.markup(operator.machine);
  assert.ok(opCard.includes(cardLine));
  assert.doesNotMatch(opCard, /data-switch-step-unpooled-dismiss/);
  operator.api.started.handleClick(clickOf("data-switch-step-unpooled-dismiss", { switchStepUnpooledDismiss: S_UUID }));
  assert.ok(operator.api.started.markup(operator.machine).includes(cardLine), "an operator cannot dismiss it");
});

test("phase 2 pooled → unpooled target (sample 3): listed only with switchStepStartedAllowUnpooled, labeled 不在待做池, sent with p_target_pool_item_id null", async () => {
  const state = { history: () => [{ command_uuid: UUID, command_type: "claim_next", machine_code: "A05", pool_item_id: CURRENT_KEY, expected_order_no: "TEST-WO-1",
    expected_index_sn: 3, status: "applied", requested_at: "2026-11-13T00:00:00Z", legacy_snapshot: null }] };
  const off = harness({ started: true, order: runningOrder(), backend: startedBackendOf({}) });
  await off.api.started.open("A05", null);
  assert.doesNotMatch(off.startedSheetHtml(), /step:6|不在待做池/);
  const h = harness({ started: true, allowUnpooled: true, order: runningOrder(), backend: startedBackendOf(state), uuids: [S_UUID] });
  await h.api.started.open("A05", null);
  assert.match(h.startedSheetHtml(), /data-switch-step-started-choice="step:6" data-switch-step-started-pooled="0"[^>]*>第 6 道 · 研磨 · 不在待做池</);
  h.api.started.choose("step:6");
  await h.api.started.submit();
  assert.equal(state.submits[0].body.p_target_index_sn, 6);
  assert.equal(state.submits[0].body.p_target_pool_item_id, null);
  assert.equal(state.submits[0].body.p_pool_item_id, CURRENT_KEY, "held-claims RPC empty (started step) → the claim_next history gives the pool key");
  finishedAs(state, "pooled_to_unpooled_target", { to_index_sn: 6 });
  await h.runPoll();
  assert.deepEqual(h.calls.toasts, ["已換成第 6 道，請按「開工」開始做。第 3 道已退回待做池，沒有記任何數量。"]);
  assert.doesNotMatch(h.api.started.markup(h.machine), /待安排/);
});

test("phase 2 refusals: HAS_REPORTS at submit and SWITCH_STEP_HAS_REPORTS from the Factory both say 找生管; nothing left pending; no raw code", async () => {
  for (const code of ["SWITCH_STEP_HAS_REPORTS", "HAS_REPORTS"]) {
    const state = { submitError: new Error(`400 {"code":"P0001","message":"${code}"}`) };
    const h = harness({ started: true, order: runningOrder(), backend: startedBackendOf(state), uuids: [S_UUID] });
    await h.api.started.open("A05", null);
    h.api.started.choose(keyOf(1));
    await h.api.started.submit();
    assert.match(h.startedSheetHtml(), /data-switch-step-started-result="failed"[^>]*>第 3 道已經有報工數量，不能直接換道次。請找生管處理（報工修正）。</);
    assert.doesNotMatch(h.startedSheetHtml(), /HAS_REPORTS/);
    assert.equal(h.api.locks("A05"), false);
    assert.equal(h.pollTimers(), 0);
  }
  const state = {};
  const h = harness({ started: true, order: runningOrder(), backend: startedBackendOf(state), uuids: [S_UUID] });
  await h.api.started.open("A05", null);
  h.api.started.choose(keyOf(2));
  await h.api.started.submit();
  state.row = Object.assign({}, state.row, { status: "rejected", claimed_at: new Date().toISOString(), reject_code: "SWITCH_STEP_HAS_REPORTS", reject_message: "Factory: SFC qty" });
  await h.runPoll();
  assert.deepEqual(h.calls.toasts, ["第 3 道已經有報工數量，不能直接換道次。請找生管處理（報工修正）。"]);
  assert.deepEqual(h.calls.refresh, [["A05", "switch_step"]]);
  assert.equal(h.api.started.markup(h.machine).includes(STARTED_BUTTON), true, "definitely not switched: the card is usable again");
});

test("phase 2 OUTCOME_UNKNOWN: 'not sure' (never 'not switched'), and the button stays hidden for that step — no second command", async () => {
  const state = {};
  const h = harness({ started: true, order: runningOrder(), backend: startedBackendOf(state), uuids: [S_UUID, S_UUID2] });
  await h.api.started.open("A05", null);
  h.api.started.choose(keyOf(1));
  await h.api.started.submit();
  state.row = Object.assign({}, state.row, { status: "rejected", claimed_at: new Date().toISOString(), reject_code: "OUTCOME_UNKNOWN" });
  await h.runPoll();
  assert.deepEqual(h.calls.toasts, ["換道次結果還不確定。請重新整理，看這台現在掛第幾道；不要重按。"]);
  const card = h.api.started.markup(h.machine);
  assert.match(card, /data-switch-step-started-status="rejected"[^>]*>換道次結果還不確定/);
  assert.doesNotMatch(card, /data-switch-step-started-open/, "no button while the outcome is unknown");
  assert.equal(h.api.started.gate(h.machine).reason, "unsure_hold");
  await h.api.started.open("A05", null);
  assert.equal(h.startedSheetHtml().includes("data-switch-step-started-choice"), false);
  assert.equal(state.submits.length, 1);
});

test("phase 2 network cut on submit: 'not sure it was sent', polled with the same uuid; resend reuses the same uuid and byte-identical args; a reload never resubmits", async () => {
  const state = { submitError: new TypeError("Failed to fetch") };
  const h = harness({ started: true, order: runningOrder(), backend: startedBackendOf(state), uuids: [S_UUID, S_UUID2] });
  await h.api.started.open("A05", null);
  h.api.started.choose(keyOf(1));
  await h.api.started.submit();
  assert.match(h.startedSheetHtml(), /data-switch-step-started-result="uncertain"/);
  assert.match(h.api.started.markup(h.machine), /data-switch-step-started-retry="A05"/);
  assert.equal(h.api.locks("A05"), true, "locked until the poll knows");
  // 卡片上再按「換道次」：不會開新的一筆
  await h.api.started.open("A05", null);
  assert.equal(state.submits.length, 1);
  // 用同一筆重送
  delete state.submitError;
  h.api.started.handleClick(clickOf("data-switch-step-started-retry", { switchStepStartedRetry: "A05" }));
  assert.match(h.startedSheetHtml(), />用同一筆重送</);
  await h.api.started.submit();
  assert.equal(state.submits.length, 2);
  assert.equal(state.submits[1].raw, state.submits[0].raw, "same uuid, same nine args");
  assert.equal(state.submits[1].body.p_command_uuid, S_UUID);
  // 重新整理：只還原、輪詢，不送
  const stored = h.storage.get("machtile.switchStepStartedPending.v1");
  const reloaded = harness({ started: true, order: runningOrder(), backend: startedBackendOf(state), storage: { "machtile.switchStepStartedPending.v1": stored } });
  reloaded.api.started.restore();
  assert.match(reloaded.api.started.markup(reloaded.machine), /data-switch-step-started-status="pending"/);
  finishedAs(state, "pooled_to_pooled");
  await reloaded.runPoll();
  assert.equal(state.submits.length, 2, "restore polls, never submits");
  assert.equal(reloaded.calls.toasts.length, 1);
  // 換了人登入：別人的紀錄不還原
  const other = harness({ started: true, order: runningOrder(), backend: startedBackendOf({}), storage: { "machtile.switchStepStartedPending.v1": stored }, userId: "x" });
  other.context.machtileAuthState.appUserId = "00000000-0000-4000-8000-000000000999";
  other.api.started.restore();
  assert.equal(other.api.started.locks("A05"), false);
});

test("phase 2 open-time reads fail closed: fresh read changed / reported / unreadable → no list, no send", async () => {
  for (const [fresh, text] of [
    [() => freshRow({ status: "running", qty_completed: 4, work_orders: { id: WO_ID, work_order_no: "TEST-WO-1", status: "in_progress" } }), "第 3 道已經有報工數量"],
    [() => freshRow({ status: "running", process_order: 2, work_orders: { id: WO_ID, work_order_no: "TEST-WO-1", status: "in_progress" } }), "這台的工單或道次已經變了"],
    [null, "讀不到這台最新的資料"],
  ]) {
    const state = fresh ? { fresh } : { freshFail: true };
    const h = harness({ started: true, order: runningOrder(), backend: startedBackendOf(state) });
    await h.api.started.open("A05", null);
    assert.ok(h.startedSheetHtml().includes(text), text);
    assert.doesNotMatch(h.startedSheetHtml(), /data-switch-step-started-choice/);
    assert.deepEqual(state.reads, ["fresh"], "nothing else read");
    await h.api.started.submit();
    assert.equal(state.submits.length, 0);
  }
  const noOther = { steps: () => [procRow(3, "running", "A05")], pool: () => [] };
  const h = harness({ started: true, allowUnpooled: true, order: runningOrder(), backend: startedBackendOf(noOther) });
  await h.api.started.open("A05", null);
  assert.match(h.startedSheetHtml(), /這張單現在沒有可以換過去的道次/);
});

test("phase 2 machine allowlist: switchStepStartedMachines default [] (no machine); the button only for listed machines AND the flag", async () => {
  assert.match(fs.readFileSync(path.join(__dirname, "config.js"), "utf8"), /\n\s*switchStepStartedMachines: \[\],\r?\n/, "config.js default is an empty list");
  for (const startedMachines of [[], ["A04"], undefined === 1 ? [] : null, "A05"]) {
    const h = harness({ started: true, startedMachines, order: runningOrder(), backend: startedBackendOf({}) });
    assert.equal(h.api.started.markup(h.machine), "", JSON.stringify(startedMachines));
    assert.equal(h.api.started.gate(h.machine).reason, "machine_not_listed");
    await h.api.started.open("A05", null);
    assert.equal(h.startedSheetHtml(), "", "not listed: the sheet does not open either");
    assert.deepEqual(h.calls.fetch, []);
  }
  for (const startedMachines of [["A05"], ["a05 "], ["A03", "A05"]]) {
    const h = harness({ started: true, startedMachines, order: runningOrder() });
    assert.equal(h.api.started.markup(h.machine), STARTED_BUTTON, JSON.stringify(startedMachines));
  }
  // 名單有、旗標關 → 還是不出
  const off = harness({ started: false, startedMachines: ["A05"], order: runningOrder() });
  assert.equal(off.api.started.markup(off.machine), "");
});

test("phase 2 TARGET_TAKEN: the machine code from the cloud DETAIL (jsonb claimed_machine_code) is named; unparsable / null detail keeps the generic sentence", async () => {
  // 雲端原始碼：raise exception 'TARGET_TAKEN' using detail=jsonb_build_object('claimed_machine_code',v_taken)::text（檔案在這台電腦上時確認格式沒變）
  let sql = "";
  try { sql = fs.readFileSync(CLOUD_SWITCH_SQL, "utf8"); } catch { /* not on this machine */ }
  if (sql) {
    const raises = [...sql.matchAll(/raise exception 'TARGET_TAKEN'([^;]*);/g)].map((m) => m[1].trim());
    assert.ok(raises.length >= 1);
    for (const tail of raises) assert.equal(tail, "using detail=jsonb_build_object('claimed_machine_code',v_taken)::text", "every TARGET_TAKEN carries the same DETAIL shape");
  }
  const err = (details) => new Error(`400 ${JSON.stringify({ code: "P0001", details, hint: null, message: "TARGET_TAKEN" })}`);
  assert.equal(core.takenMachineOf(err(JSON.stringify({ claimed_machine_code: "A04" }))), "A04");
  assert.equal(core.takenMachineOf(err('{"claimed_machine_code": "a03"}')), "A03", "jsonb::text spacing");
  for (const bad of ['{"claimed_machine_code": null}', "not json", null, '{"x":"A04"}', '{"claimed_machine_code": "<b>"}']) assert.equal(core.takenMachineOf(err(bad)), "", String(bad));
  assert.equal(core.takenMachineOf(new Error('400 {"message":"STALE","details":"{\\"claimed_machine_code\\":\\"A04\\"}"}')), "", "only for TARGET_TAKEN");
  assert.equal(core.takenMachineOf(new TypeError("Failed to fetch")), "");
  const d = dictionaries();
  const via = (error) => core.startedSubmitErrorInfo(returnCore.submitErrorInfo(error), error);
  const named = via(err('{"claimed_machine_code": "A04"}'));
  assert.deepEqual(JSON.parse(JSON.stringify(named)), { kind: "rejected", code: "TARGET_TAKEN", messageKey: "switch_step_started_err_target_taken_on", params: { machine: "A04" } });
  assert.equal(fill(d.zh[named.messageKey], { from: 3, to: 1, ...named.params }), "第 1 道已經在 A04 上或被 A04 接走，沒有換。這台還是第 3 道，狀態沒有變。");
  assert.equal(via(err('{"claimed_machine_code": null}')).messageKey, "switch_step_started_err_target_taken");
  // 畫面：送出被擋 → 確認卡上那一句帶機台代號
  const state = { submitError: err('{"claimed_machine_code": "A04"}') };
  const h = harness({ started: true, order: runningOrder(), backend: startedBackendOf(state), uuids: [S_UUID] });
  await h.api.started.open("A05", null);
  h.api.started.choose(keyOf(1));
  await h.api.started.submit();
  assert.match(h.startedSheetHtml(), /data-switch-step-started-result="failed"[^>]*>第 1 道已經在 A04 上或被 A04 接走，沒有換。這台還是第 3 道，狀態沒有變。</);
  assert.equal(h.api.locks("A05"), false);
  // 工廠回的 SWITCH_STEP_TARGET_TAKEN 沒有 DETAIL：照原本那一句
  assert.equal(core.startedRejectInfo("SWITCH_STEP_TARGET_TAKEN").messageKey, "switch_step_started_err_target_taken");
});

test("phase 2 pool key unknown: no pre-block — sent with p_pool_item_id null (the cloud resolves it from the ledger); POOL_ITEM_REQUIRED still says 找生管", async () => {
  const state = { submitError: new Error('400 {"code":"P0001","message":"POOL_ITEM_REQUIRED"}') };
  const h = harness({ started: true, order: runningOrder(), backend: startedBackendOf(state), uuids: [S_UUID] });
  await h.api.started.open("A05", null);
  assert.match(h.startedSheetHtml(), /data-switch-step-started-confirm disabled/, "two choices: nothing picked yet");
  assert.doesNotMatch(h.startedSheetHtml(), /找不到第|data-switch-step-started-stale/, "an unknown pool key is not a reason to block the sheet");
  h.api.started.choose(keyOf(1));
  assert.doesNotMatch(h.startedSheetHtml(), /data-switch-step-started-confirm disabled/, "the confirm button is enabled");
  await h.api.started.submit();
  assert.equal(state.submits.length, 1, "sent");
  assert.equal(state.submits[0].body.p_pool_item_id, null);
  assert.match(h.startedSheetHtml(), />系統找不到第 3 道是從待做池哪一筆接的，不能直接換。這台還是第 3 道。請找生管。</);
});

test("phase 2 POOL_ITEM_AMBIGUOUS (cloud resolves the held pool item from the ledger and finds more than one): same 找生管 sentence", () => {
  const d = dictionaries();
  const info = core.startedRejectInfo("POOL_ITEM_AMBIGUOUS");
  assert.equal(info.known, true);
  assert.equal(info.messageKey, "switch_step_started_err_no_pool_record");
  assert.match(fill(d.zh[info.messageKey], { from: 3 }), /請找生管/);
  assert.equal(core.startedSubmitErrorInfo(returnCore.submitErrorInfo(new Error('400 {"code":"P0001","message":"POOL_ITEM_AMBIGUOUS"}'))).messageKey, "switch_step_started_err_no_pool_record");
});

test("phase 2 pool-key reads FAIL (held-claims RPC or command history: network / HTTP error, not empty) → 讀取失敗，請再試一次, confirm disabled, nothing sent", async () => {
  const boom = () => { throw new TypeError("Failed to fetch"); };
  const http500 = () => { throw new Error("500 internal"); };
  const missing = () => { throw new Error('404 {"code":"PGRST202"}'); };
  for (const [label, extra] of [["held network", { held: boom }], ["held 500", { held: http500 }], ["held RPC missing", { held: missing }],
    ["history network", { history: boom }], ["history 500", { history: http500 }], ["held not an array", { held: () => ({}) }]]) {
    const state = Object.assign({}, extra);
    const h = harness({ started: true, order: runningOrder(), backend: startedBackendOf(state), uuids: [S_UUID] });
    await h.api.started.open("A05", null);
    h.api.started.choose(keyOf(1));
    assert.match(h.startedSheetHtml(), /data-switch-step-started-read-failed>讀取失敗，請再試一次。</, label);
    assert.match(h.startedSheetHtml(), /data-switch-step-started-confirm disabled/, `${label}: confirm disabled`);
    await h.api.started.submit();
    assert.equal(state.submits.length, 0, `${label}: nothing sent`);
  }
  // 讀到了、只是空的＝不是失敗：照送 null
  const empty = { held: () => [], history: () => [] };
  const h = harness({ started: true, order: runningOrder(), backend: startedBackendOf(empty), uuids: [S_UUID] });
  await h.api.started.open("A05", null);
  h.api.started.choose(keyOf(1));
  assert.doesNotMatch(h.startedSheetHtml(), /data-switch-step-started-read-failed/);
  await h.api.started.submit();
  assert.equal(empty.submits.length, 1);
  assert.equal(empty.submits[0].body.p_pool_item_id, null);
});

test("phase 2 'reported today' ignores the 0/0 dailyStart the start confirm sheet writes (same rule as the cloud's SWITCH_STEP_HAS_REPORTS)", () => {
  const row = (extra) => Object.assign({ process_id: PROCESS_ID, report_type: "dailyStart", completed_qty: 0, defect_qty: 0 }, extra);
  assert.equal(core.todayReportBlocks([row()], PROCESS_ID), false, "0/0 dailyStart (開工確認卡) is not a report");
  assert.equal(core.todayReportBlocks([row({ report_type: "workStart" }), row({ report_type: "pause" })], PROCESS_ID), false);
  assert.equal(core.todayReportBlocks([row({ completed_qty: 3 })], PROCESS_ID), true, "a dailyStart with quantity is");
  assert.equal(core.todayReportBlocks([row({ defect_qty: 1 })], PROCESS_ID), true);
  assert.equal(core.todayReportBlocks([row({ report_type: "noon" })], PROCESS_ID), true, "noon / finish count even at 0 (the cloud refuses them too)");
  assert.equal(core.todayReportBlocks([row({ report_type: "finish" })], PROCESS_ID), true);
  assert.equal(core.todayReportBlocks([row({ process_id: "other", report_type: "finish" })], PROCESS_ID), false, "another step's report");
  assert.equal(core.todayReportBlocks(null, PROCESS_ID), false);
  // 卡片：剛開工、今日開工 0／0 已寫 → 按鈕還在；有報工 → 不出
  const started = harness({ started: true, order: runningOrder(), todayRows: [row()] });
  assert.equal(started.api.started.markup(started.machine), STARTED_BUTTON, "the button survives the start's own dailyStart row");
  const reported = harness({ started: true, order: runningOrder(), todayRows: [row(), row({ report_type: "noon", completed_qty: 5, created_at: "x" })] });
  assert.equal(reported.api.started.gate(reported.machine).reason, "has_reports");
});
