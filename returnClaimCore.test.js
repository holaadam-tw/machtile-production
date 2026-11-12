// 機台卡片「接錯了，退回」（return_claim，CONTRACT-P2 r1）純邏輯＋ app.js 接線測試。不連任何後端。
// `node --test returnClaimCore.test.js`
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const childProcess = require("node:child_process");
const core = require("./returnClaimCore.js");
const stationCore = require("./stationCommandCore.js");

const UUID = "3f0c1a52-7c1e-4b7e-9d43-2f6a8f1f0a11";
const PROCESS_ID = "00000000-0000-4000-8000-000000000301";
const POOL_KEY = "01|TEST-WO-1|S1";
// 合約 §6／雲端 fixture supabase/tests/pglite/fixtures/return_claim_poll_select.txt 的內容（逐字）
const CONTRACT_POLL_SELECT = "command_uuid,command_type,machine_code,pool_item_id,expected_order_no,expected_index_sn,status,requested_at,claimed_at,applied_at,reject_code,reject_message,legacy_snapshot";
// 合約 §1（submit raise）＋ §2（Factory reject_code）列出的每一個碼，加上伺服器保留碼 EXPIRED／MANUAL_RELEASED
const CONTRACT_CODES = ["AUTH_REQUIRED", "OPERATOR_REQUIRED", "APPLIER_CANNOT_SUBMIT", "TENANT_INACTIVE", "APP_USER_REQUIRED",
  "OPERATOR_LEGACY_ID_MISSING", "OPERATOR_LEGACY_ID_INVALID", "ADMIN_SUBMIT_DISABLED", "FORBIDDEN", "ADMIN_LEGACY_ID_MISSING",
  "COMMAND_UUID_REQUIRED", "COMMAND_UUID_CONFLICT", "RETURN_CLAIM_DISABLED", "INVALID_MACHINE_CODE", "INVALID_POOL_ITEM_ID", "STALE",
  "RETURN_REASON_REQUIRED", "INVALID_RETURN_REASON", "MACHINE_NOT_ALLOWED", "ACTIVE_CLAIM_NOT_FOUND", "NOT_CLAIM_OWNER", "CLAIM_NOT_APPLIED",
  "CLAIM_ALREADY_STARTED", "MACHINE_COMMAND_IN_FLIGHT",
  "LEGACY_STATE_INCONSISTENT", "POOL_ITEM_NOT_FOUND", "UNSUPPORTED_STATION", "FACTORY_RETURN_DISABLED", "STALE_COMMAND",
  "EXPIRED", "MANUAL_RELEASED"];
// Factory 套用端對 return_claim 會回的每一個 reject_code（從原始碼列出，machtile softnet-mes feat/return-claim-applier）：
//   StationReturnClaimApplier.cs  ValidateShape：FACTORY_RETURN_DISABLED、COMMAND_INVALID、UNSUPPORTED_STATION、OPERATOR_UNKNOWN、STALE_COMMAND
//                                 Decide：POOL_ITEM_NOT_FOUND、STALE_COMMAND、LEGACY_STATE_INCONSISTENT、CLAIM_ALREADY_STARTED
//                                 Replay／Apply／ApplyWithin：LEDGER_CONFLICT、OUTCOME_UNKNOWN、LOCK_TIMEOUT、INTERNAL_ERROR、
//                                   FACTORY_RETURN_DISABLED、UNSUPPORTED_STATION、LEGACY_STATE_INCONSISTENT；Guard()：WRITE_TARGET_DENIED
//   StationCommandProcessor.cs    COMMAND_INVALID（角色不認得／工廠旗標關＝不支援的指令種類／稽核表缺 ActorRole）、FACTORY_RETURN_DISABLED
//   StationCommandMatcher.cs      COMMAND_INVALID（缺 command_uuid、角色、代報）
//   StationCommandPoller.cs       OUTCOME_UNKNOWN／INTERNAL_ERROR（處理時例外）、LEGACY_APPLIED_LATE（applied 但雲端 finish 拒收）
const FACTORY_CODES = ["FACTORY_RETURN_DISABLED", "COMMAND_INVALID", "UNSUPPORTED_STATION", "OPERATOR_UNKNOWN", "STALE_COMMAND",
  "POOL_ITEM_NOT_FOUND", "LEGACY_STATE_INCONSISTENT", "CLAIM_ALREADY_STARTED", "LEDGER_CONFLICT", "OUTCOME_UNKNOWN", "LOCK_TIMEOUT",
  "INTERNAL_ERROR", "WRITE_TARGET_DENIED", "LEGACY_APPLIED_LATE"];
const ALL_CODES = [...new Set([...CONTRACT_CODES, ...FACTORY_CODES])];
// 等一下再按有機會成功的碼（Factory 的訊息自己寫「請再按一次／稍後再按」的：LOCK_TIMEOUT、INTERNAL_ERROR、逾時的 STALE_COMMAND）
const RETRYABLE_CODES = ["CLAIM_NOT_APPLIED", "MACHINE_COMMAND_IN_FLIGHT", "STALE_COMMAND", "EXPIRED", "LOCK_TIMEOUT", "INTERNAL_ERROR"];
const SESSION = { tenantId: "00000000-0000-4000-8000-000000000001", appUserId: "00000000-0000-4000-8000-000000000902" };
const OTHER_USER = { tenantId: SESSION.tenantId, appUserId: "00000000-0000-4000-8000-000000000903" };
const OTHER_TENANT = { tenantId: "00000000-0000-4000-8000-000000000002", appUserId: SESSION.appUserId };

const claimedOrder = (extra) => Object.assign({ id: "TEST-WO-1", stationStep: 1, processId: PROCESS_ID, part: "測試軸", process: "CNC車床加工",
  dispatchPoolSourceKey: POOL_KEY, dispatchPoolStatus: "claimed", processStatus: "pending", done: 0, offStation: false }, extra);
const visible = (extra) => core.visibility(Object.assign({ enabled: true, role: "operator", isBridge: false, cardDetailsReady: true,
  isUnassignedBucket: false, machineCode: "A01", order: claimedOrder(), actualStartAt: null, startedLocally: false, startedToday: false,
  hasTodayReport: false, commandInFlight: false }, extra));

// ---------------------------------------------------------------- 輪詢 select
test("poll select is exactly the contract list and the cloud fixture", () => {
  assert.equal(core.POLL_SELECT, CONTRACT_POLL_SELECT);
  assert.equal(core.pollPath(UUID), `station_commands?select=${CONTRACT_POLL_SELECT}&command_uuid=eq.${UUID}`);
  assert.throws(() => core.pollPath("not-a-uuid"), /BAD_COMMAND_UUID/);
  // 雲端 fixture 的複本放在這個 repo（fixtures/return_claim_poll_select.txt，檔頭註明來源檔與 commit）：任何機器都比得到。
  const vendoredText = fs.readFileSync(path.join(__dirname, "fixtures/return_claim_poll_select.txt"), "utf8");
  assert.match(vendoredText, /machtile-mini-mes/, "vendored fixture names its source repo");
  assert.match(vendoredText, /d8ee0d18/, "vendored fixture names its source commit");
  assert.match(vendoredText, /supabase\/tests\/pglite\/fixtures\/return_claim_poll_select\.txt/, "vendored fixture names its source file");
  const vendored = vendoredText.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  assert.equal(vendored.length, 1, "vendored fixture holds exactly one select line");
  assert.equal(core.POLL_SELECT, vendored[0], "core select == vendored cloud fixture");
  // 雲端工作樹在這台機器上 → 複本必須跟它逐字相同（漂移就失敗）；不在＝上面的複本比對已經足夠
  const sibling = process.env.RETURN_CLAIM_POLL_FIXTURE
    || "D:/04_SoftNet/wt-mini-return/supabase/tests/pglite/fixtures/return_claim_poll_select.txt";
  if (fs.existsSync(sibling)) assert.equal(vendored[0], fs.readFileSync(sibling, "utf8").trim(), "vendored copy drifted from the cloud fixture");
  else console.log(`  (cloud worktree not on this machine: ${sibling}; compared with the vendored copy)`);
});

// ---------------------------------------------------------------- 按鈕什麼時候出現
test("button shows only for a claimed, not-started pool job; any doubt hides it", () => {
  assert.deepEqual(visible(), { show: true, reason: "", needsReason: false });
  assert.deepEqual(visible({ role: "admin" }), { show: true, reason: "", needsReason: true });
  assert.deepEqual(visible({ role: "planner" }), { show: true, reason: "", needsReason: true });
  const hidden = [
    [{ enabled: false }, "flag_off"], [{ enabled: undefined }, "flag_off"], [{ enabled: "true" }, "flag_off"],
    [{ role: "manager" }, "role"], [{ role: "" }, "role"], [{ role: "operator", isBridge: true }, "role"],
    [{ isUnassignedBucket: true }, "no_machine"], [{ machineCode: "" }, "no_machine"],
    [{ order: null }, "no_order"],
    [{ order: claimedOrder({ offStation: true }) }, "off_station"],
    [{ order: claimedOrder({ id: "" }) }, "no_order_no"],
    [{ order: claimedOrder({ stationStep: 0 }) }, "no_step"], [{ order: claimedOrder({ stationStep: null }) }, "no_step"],
    [{ order: claimedOrder({ processId: "process-1" }) }, "no_process"],
    [{ order: claimedOrder({ dispatchPoolSourceKey: "" }) }, "not_from_pool"],
    [{ order: claimedOrder({ dispatchPoolSourceKey: "abcd" }) }, "not_from_pool"],
    [{ cardDetailsReady: false }, "pool_status_unverified"],
    [{ order: claimedOrder({ dispatchPoolStatus: "" }) }, "pool_not_claimed"],
    [{ order: claimedOrder({ dispatchPoolStatus: "gone" }) }, "pool_not_claimed"],
    [{ order: claimedOrder({ dispatchPoolStatus: "waiting" }) }, "pool_not_claimed"],
    [{ order: claimedOrder({ processStatus: "running" }) }, "started"],
    [{ order: claimedOrder({ processStatus: "paused" }) }, "started"],
    [{ order: claimedOrder({ processStatus: "abnormal" }) }, "started"],
    [{ order: claimedOrder({ done: 1 }) }, "has_reports"], [{ order: claimedOrder({ done: undefined }) }, "has_reports"],
    [{ actualStartAt: "2026-11-12T01:00:00Z" }, "started"],
    [{ startedLocally: true }, "started"], [{ startedToday: true }, "started"],
    [{ hasTodayReport: true }, "has_reports"],
    [{ commandInFlight: true }, "command_in_flight"],
  ];
  for (const [extra, reason] of hidden) {
    const got = visible(extra);
    assert.equal(got.show, false, JSON.stringify(extra));
    assert.equal(got.reason, reason, JSON.stringify(extra));
    assert.equal(got.needsReason, false);
  }
});

test("re-read at tap time: only same machine, same step, pending, nothing reported passes", () => {
  const row = (extra) => Object.assign({ id: PROCESS_ID, process_order: 1, status: "pending", off_station_at: null, qty_completed: 0,
    work_orders: { work_order_no: "TEST-WO-1", part_no: "TEST-P1", part_name: "測試軸", status: "in_progress" }, machines: { machine_code: "A01" } }, extra);
  const check = (r) => core.freshCheck({ machineCode: "a01", orderNo: "TEST-WO-1", step: 1, row: r });
  assert.deepEqual(check(row()), { ok: true, reason: "", partNo: "TEST-P1" });
  assert.equal(check(row({ work_orders: { work_order_no: "TEST-WO-1", part_no: " ", status: "in_progress" } })).partNo, null);
  assert.equal(check(null).reason, "process_not_found");
  assert.equal(check(row({ off_station_at: "2026-11-12T00:00:00Z" })).reason, "off_station");
  assert.equal(check(row({ machines: { machine_code: "A02" } })).reason, "machine_changed");
  assert.equal(check(row({ machines: null })).reason, "machine_changed");
  assert.equal(check(row({ process_order: 2 })).reason, "step_changed");
  assert.equal(check(row({ work_orders: { work_order_no: "TEST-WO-2", status: "in_progress" } })).reason, "order_changed");
  assert.equal(check(row({ work_orders: { work_order_no: "TEST-WO-1", status: "cancelled" } })).reason, "order_closed");
  assert.equal(check(row({ status: "running" })).reason, "started");
  assert.equal(check(row({ qty_completed: 3 })).reason, "has_reports");
});

// ---------------------------------------------------------------- 送出參數
test("args builder sends exactly the seven contract parameters", () => {
  const args = core.buildArgs({ commandUuid: UUID, machineCode: " a01 ", poolItemId: ` ${POOL_KEY} `, orderNo: " TEST-WO-1 ", step: "1",
    partNo: " TEST-P1 ", reason: "  ", role: "operator" });
  assert.deepEqual(args, { p_command_uuid: UUID, p_machine_code: "A01", p_pool_item_id: POOL_KEY, p_expected_order_no: "TEST-WO-1",
    p_expected_index_sn: 1, p_expected_part_no: "TEST-P1", p_reason: null });
  assert.deepEqual(Object.keys(args), ["p_command_uuid", "p_machine_code", "p_pool_item_id", "p_expected_order_no", "p_expected_index_sn", "p_expected_part_no", "p_reason"]);
  assert.deepEqual(Object.keys(args), [...core.ARG_KEYS]);
  assert.equal(core.SUBMIT_RPC, "machtile_submit_return_claim_command");
  const base = { commandUuid: UUID, machineCode: "A01", poolItemId: POOL_KEY, orderNo: "TEST-WO-1", step: 1, role: "operator" };
  assert.equal(core.buildArgs({ ...base, partNo: null }).p_expected_part_no, null);
  assert.equal(core.buildArgs({ ...base, partNo: "x".repeat(201) }).p_expected_part_no, null);
  assert.equal(core.buildArgs({ ...base, role: "admin", reason: " 接錯機台 " }).p_reason, "接錯機台");
  assert.equal(core.buildArgs({ ...base, role: "planner", reason: "x".repeat(500) }).p_reason.length, 500);
  assert.throws(() => core.buildArgs({ ...base, role: "admin", reason: " " }), /REASON_REQUIRED/);
  assert.throws(() => core.buildArgs({ ...base, role: "planner" }), /REASON_REQUIRED/);
  assert.throws(() => core.buildArgs({ ...base, reason: "x".repeat(501) }), /REASON_TOO_LONG/);
  assert.throws(() => core.buildArgs({ ...base, commandUuid: "abc" }), /BAD_COMMAND_UUID/);
  assert.throws(() => core.buildArgs({ ...base, machineCode: "" }), /NO_MACHINE/);
  assert.throws(() => core.buildArgs({ ...base, machineCode: "M".repeat(31) }), /NO_MACHINE/);
  assert.throws(() => core.buildArgs({ ...base, poolItemId: "1234" }), /NO_POOL_ITEM_ID/);
  assert.throws(() => core.buildArgs({ ...base, poolItemId: "k".repeat(121) }), /NO_POOL_ITEM_ID/);
  assert.throws(() => core.buildArgs({ ...base, orderNo: "" }), /NO_ORDER/);
  assert.throws(() => core.buildArgs({ ...base, orderNo: "o".repeat(101) }), /NO_ORDER/);
  for (const step of [0, -1, 1.5, "", null, "x"]) assert.throws(() => core.buildArgs({ ...base, step }), /NO_STEP/);
  assert.throws(() => core.buildArgs({ ...base, role: "manager" }), /BAD_ROLE/);
  assert.deepEqual(core.reasonCheck("operator", ""), { ok: true, messageKey: "", value: "" });
  assert.equal(core.reasonCheck("admin", "").messageKey, "return_claim_reason_required");
  assert.equal(core.reasonCheck("operator", "x".repeat(501)).messageKey, "return_claim_reason_too_long");
});

// ---------------------------------------------------------------- 拒絕碼 → 一句白話
function dictionaries() {
  delete require.cache[require.resolve("./i18n.js")];
  delete global.MachTileI18n; delete global.machtileT;
  global.localStorage = { getItem() { return null; }, setItem() {} };
  const i18n = require("./i18n.js");
  return { zh: i18n.dictionaries["zh-Hant"], vi: i18n.dictionaries.vi,
    zhFile: JSON.parse(fs.readFileSync(path.join(__dirname, "locales/zh-Hant.json"), "utf8")),
    viFile: JSON.parse(fs.readFileSync(path.join(__dirname, "locales/vi.json"), "utf8")) };
}

test("every contract reject code maps to one sentence; unknown codes get the generic one", () => {
  for (const code of CONTRACT_CODES) {
    const info = core.rejectInfo(code);
    assert.equal(info.known, true, code);
    assert.match(info.messageKey, /^return_claim_/, code);
    assert.notEqual(info.messageKey, core.GENERIC_MESSAGE_KEY, code);
  }
  assert.deepEqual(Object.keys(core.REJECT_MESSAGE_KEY).sort(), [...ALL_CODES].sort(), "no code outside the contract + factory lists");
  assert.deepEqual(core.rejectInfo("SOMETHING_NEW"), { code: "SOMETHING_NEW", known: false, messageKey: "return_claim_err_generic", retryLater: false });
  assert.equal(core.rejectInfo("").messageKey, "return_claim_err_generic");
  assert.equal(core.rejectInfo(null).messageKey, "return_claim_err_generic");
  assert.equal(core.rejectInfo("constructor").messageKey, "return_claim_err_generic");
  assert.equal(core.rejectInfo("not_claim_owner").messageKey, "return_claim_err_not_owner");
  assert.deepEqual([...core.RETRY_LATER_CODES], RETRYABLE_CODES);
});

test("every factory reject code has its own correct sentence (uncertain ≠ failed, retry only where retrying can work)", () => {
  const d = dictionaries();
  const keyOf = (code) => core.rejectInfo(code).messageKey;
  for (const code of FACTORY_CODES) {
    assert.equal(core.rejectInfo(code).known, true, code);
    assert.notEqual(keyOf(code), core.GENERIC_MESSAGE_KEY, `${code} must not fall to the generic "did not return" sentence`);
    assert.equal(typeof d.zh[keyOf(code)], "string", code);
    assert.equal(typeof d.vi[keyOf(code)], "string", code);
  }
  // 結果不確定：不可以說沒有退回；要說不確定、重新整理、問生管；不可以叫人再按
  for (const code of ["OUTCOME_UNKNOWN", "LEGACY_APPLIED_LATE", "MANUAL_RELEASED"]) {
    const zh = d.zh[keyOf(code)], vi = d.vi[keyOf(code)];
    assert.match(zh, /不確定/, code);
    assert.match(zh, /重新整理/, code);
    assert.match(zh, /生管/, code);
    assert.doesNotMatch(zh, /沒有退回|沒退回|退回失敗|沒有成功/, `${code} zh-Hant must not claim the return failed`);
    assert.match(vi, /[Cc]hưa chắc/, code);
    assert.match(vi, /tải lại màn hình/, code);
    assert.match(vi, /kế hoạch/, code);
    assert.doesNotMatch(vi, /chưa trả lại|không trả lại được|thất bại/i, `${code} vi must not claim the return failed`);
    assert.equal(core.rejectInfo(code).retryLater, false, code);
    assert.equal(core.resultView({ status: "rejected", reject_code: code }).tone, "warn", `${code} is shown as a warning, not a failure`);
    assert.ok(core.UNCERTAIN_CODES.includes(code), code);
  }
  assert.deepEqual([...core.UNCERTAIN_CODES], ["OUTCOME_UNKNOWN", "LEGACY_APPLIED_LATE", "MANUAL_RELEASED"]);
  assert.equal(core.resultView({ status: "rejected", reject_code: "CLAIM_ALREADY_STARTED" }).tone, "bad");
  // 整筆取消、沒有寫入，等一下再按有機會成功
  for (const code of ["LOCK_TIMEOUT", "INTERNAL_ERROR"]) {
    assert.equal(core.rejectInfo(code).retryLater, true, code);
    assert.match(d.zh[keyOf(code)], /沒有退回/, code);
    assert.match(d.zh[keyOf(code)], /等一下再按一次|過幾分鐘再試一次/, code);
    assert.match(d.vi[keyOf(code)], /bấm lại|thử lại/, code);
  }
  assert.equal(keyOf("LOCK_TIMEOUT"), "return_claim_err_busy_retry");
  assert.equal(keyOf("INTERNAL_ERROR"), "return_claim_err_internal_retry");
  // 工廠旗標關（當成不支援的指令種類）／指令欄位不合 → 還沒開放、找生管
  assert.equal(keyOf("COMMAND_INVALID"), "return_claim_err_not_open");
  assert.equal(keyOf("FACTORY_RETURN_DISABLED"), "return_claim_err_not_open");
  assert.equal(d.zh.return_claim_err_not_open, "退回功能還沒開放，請找生管幫你處理。");
  assert.equal(keyOf("OPERATOR_UNKNOWN"), "return_claim_err_account");
  assert.match(d.zh.return_claim_err_account, /帳號/);
  for (const code of ["LEDGER_CONFLICT", "WRITE_TARGET_DENIED"]) {
    assert.equal(keyOf(code), "return_claim_err_factory_problem", code);
    assert.equal(core.rejectInfo(code).retryLater, false, code);
  }
  assert.match(d.zh.return_claim_err_factory_problem, /生管/);
  assert.match(d.vi.return_claim_err_factory_problem, /kế hoạch/);
  assert.equal(keyOf("UNSUPPORTED_STATION"), "return_claim_err_station_not_open");
  assert.equal(keyOf("POOL_ITEM_NOT_FOUND"), "return_claim_err_pool_missing");
  assert.equal(keyOf("LEGACY_STATE_INCONSISTENT"), "return_claim_err_inconsistent");
  assert.equal(keyOf("CLAIM_ALREADY_STARTED"), "return_claim_err_started");
  assert.equal(keyOf("STALE_COMMAND"), "return_claim_err_stale_command");
});

test("factory source (when the sibling worktree is on this machine): every reject code the return-claim applier can send is mapped", (t) => {
  const dir = process.env.RETURN_CLAIM_FACTORY_DIR || "D:/04_SoftNet/wt-return-factory/SoftNet/SoftNetWebII/Services/StationCommands";
  const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");
  if (!fs.existsSync(path.join(dir, "StationReturnClaimApplier.cs"))) { t.skip(`factory worktree not on this machine: ${dir}`); return; }
  const constants = new Map([...read("StationCommandModels.cs").matchAll(/public const string (\w+) = "([A-Z][A-Z0-9_]+)";/g)].map((m) => [m[1], m[2]]));
  const codesIn = (source) => [...new Set([...source.matchAll(/StationCommandRejectCodes\.(\w+)/g)].map((m) => {
    assert.ok(constants.has(m[1]), `unknown reject-code constant ${m[1]}`);
    return constants.get(m[1]);
  }))];
  // 套用端整個檔＝全部都是 return_claim 的碼
  const applier = codesIn(read("StationReturnClaimApplier.cs"));
  assert.ok(applier.length >= 11, `expected the applier's codes, found ${applier.length}`);
  // Processor 的 return_claim 分支＋旗標關時落到的「不支援的指令種類」那一行＋角色檢查
  const processor = read("StationCommandProcessor.cs");
  const branch = processor.slice(processor.indexOf("if (type == StationCommandMatcher.ReturnClaim"), processor.indexOf("// A disabled/non-pilot close"));
  assert.ok(branch.includes("_applyReturnClaim(c)") && branch.includes("不支援的指令種類"), "return_claim branch of the processor located");
  // Poller：處理時例外（OUTCOME_UNKNOWN／INTERNAL_ERROR）與 LEGACY_APPLIED_LATE
  const poller = read("StationCommandPoller.cs");
  const handle = poller.slice(poller.indexOf("private static async Task HandleAsync"), poller.indexOf("public static async Task<bool> SyncTakeoverOpenAsync"));
  // Guard()：WRITE_TARGET_DENIED
  const guardSource = read("LegacyStationStateApplier.cs");
  const guard = guardSource.slice(guardSource.indexOf(" Guard(SqlConnection"));
  const fromSource = [...new Set([...applier, ...codesIn(branch), ...codesIn(handle), ...codesIn(guard.slice(0, guard.indexOf("GetSessionLock")))])].sort();
  assert.deepEqual(fromSource, [...FACTORY_CODES].sort(), "FACTORY_CODES in this test == the codes in the factory source");
  for (const code of fromSource) assert.equal(core.rejectInfo(code).known, true, `${code} (factory source) has a sentence`);
});

test("every return_claim string exists in both languages, shows no raw code, and never says press-again for a dead end", () => {
  const d = dictionaries();
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const coreSource = fs.readFileSync(path.join(__dirname, "returnClaimCore.js"), "utf8");
  const used = new Set([...appSource.matchAll(/"(return_claim_[a-z0-9_]+)"/g), ...coreSource.matchAll(/"(return_claim_[a-z0-9_]+)"/g)].map((m) => m[1]));
  Object.values(core.REJECT_MESSAGE_KEY).forEach((key) => used.add(key));
  used.add(core.GENERIC_MESSAGE_KEY);
  assert.ok(used.size >= 45, `expected the full string set, found ${used.size}`);
  const defined = Object.keys(d.zh).filter((key) => key.startsWith("return_claim_"));
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
  }
  // 再按也不會成功的碼：文字不可以叫人再按／重按／重送
  const retryKeys = new Set(core.RETRY_LATER_CODES.map((code) => core.REJECT_MESSAGE_KEY[code]));
  const deadEndKeys = new Set([...Object.values(core.REJECT_MESSAGE_KEY), core.GENERIC_MESSAGE_KEY].filter((key) => !retryKeys.has(key)));
  for (const key of deadEndKeys) {
    assert.doesNotMatch(d.zh[key], /再按|重按|重送|再試|重試/, `${key} zh-Hant`);
    assert.doesNotMatch(d.vi[key], /bấm lại|thử lại|gửi lại/i, `${key} vi`);
  }
  assert.equal(d.zh.return_claim_button, "接錯了，退回");
});

test("submit errors: refused, uncertain (same uuid may be resent), or missing", () => {
  const err = (message, name) => Object.assign(new Error(message), name ? { name } : {});
  assert.deepEqual(core.submitErrorInfo(err('400 {"code":"P0001","message":"NOT_CLAIM_OWNER","details":null,"hint":null}')),
    { kind: "rejected", code: "NOT_CLAIM_OWNER", messageKey: "return_claim_err_not_owner" });
  assert.equal(core.submitErrorInfo(err('400 {"code":"P0001","message":"CLAIM_ALREADY_STARTED: applied start exists"}')).messageKey, "return_claim_err_started");
  assert.equal(core.submitErrorInfo(err('400 {"code":"P0001","message":"RETURN_CLAIM_DISABLED"}')).messageKey, "return_claim_err_not_open");
  assert.deepEqual(core.submitErrorInfo(err('400 {"code":"P0001","message":"BRAND_NEW_CODE"}')), { kind: "rejected", code: "BRAND_NEW_CODE", messageKey: "return_claim_err_generic" });
  assert.equal(core.submitErrorInfo(err('401 {"message":"JWT expired"}')).messageKey, "return_claim_err_login");
  assert.equal(core.submitErrorInfo(err('404 {"code":"PGRST202","message":"Could not find the function"}')).kind, "missing");
  for (const e of [err("Failed to fetch", "TypeError"), err("timeout", "AbortError"), err('503 {"message":"upstream"}'), err("500 Internal Server Error")]) {
    assert.deepEqual({ kind: core.submitErrorInfo(e).kind, key: core.submitErrorInfo(e).messageKey }, { kind: "uncertain", key: "return_claim_uncertain" });
  }
  // 5xx 但訊息是認得的拒絕碼 → 照拒絕處理
  assert.equal(core.submitErrorInfo(err('500 {"message":"STALE"}')).kind, "rejected");
});

test("server row → view: only the server status decides", () => {
  assert.deepEqual(core.resultView({ status: "pending" }), { phase: "pending", status: "pending", terminal: false, tone: "wait", mode: "", code: "", messageKey: "return_claim_waiting" });
  assert.equal(core.resultView({ status: "claimed" }).messageKey, "return_claim_processing");
  assert.equal(core.resultView(null).terminal, false);
  const applied = core.resultView({ status: "applied", legacy_snapshot: { return_claim: { mode: "unassigned", pool_status: "returned", station_cleared: true } } });
  assert.deepEqual({ phase: applied.phase, terminal: applied.terminal, key: applied.messageKey, mode: applied.mode }, { phase: "applied", terminal: true, key: "return_claim_applied", mode: "unassigned" });
  assert.equal(core.resultView({ status: "applied", legacy_snapshot: JSON.stringify({ return_claim: { mode: "stale_assignment_reconciled" } }) }).messageKey, "return_claim_applied_reconciled");
  assert.equal(core.resultView({ status: "applied", legacy_snapshot: { return_claim: { mode: "already_returned" } } }).messageKey, "return_claim_applied");
  assert.equal(core.resultView({ status: "applied", legacy_snapshot: null }).messageKey, "return_claim_applied");
  const rejected = core.resultView({ status: "rejected", reject_code: "CLAIM_ALREADY_STARTED", reject_message: "x" });
  assert.deepEqual({ phase: rejected.phase, terminal: rejected.terminal, key: rejected.messageKey }, { phase: "rejected", terminal: true, key: "return_claim_err_started" });
  assert.equal(core.resultView({ status: "rejected", reject_code: "WHO_KNOWS" }).messageKey, "return_claim_err_generic");
  assert.equal(core.resultView({ status: "rejected", reject_code: null }).messageKey, "return_claim_err_generic");
  assert.deepEqual({ phase: core.resultView({ status: "expired", reject_code: "EXPIRED" }).phase, key: core.resultView({ status: "expired" }).messageKey }, { phase: "expired", key: "return_claim_err_expired" });
  assert.equal(core.rowIsThis({ command_uuid: UUID.toUpperCase() }, UUID), true);
  assert.equal(core.rowIsThis({ command_uuid: "other" }, UUID), false);
  assert.equal(core.rowIsThis(null, UUID), false);
});

test("pending record keeps the exact args for a same-uuid resend; lock and last-result rules", () => {
  const args = core.buildArgs({ commandUuid: UUID, machineCode: "A01", poolItemId: POOL_KEY, orderNo: "TEST-WO-1", step: 1, role: "admin", reason: "接錯" });
  const rec = core.pendingRecord({ commandUuid: UUID, machineCode: "a01", orderNo: "TEST-WO-1", step: 1, args, startedAt: 1000, unconfirmed: true, emptyPolls: 2 });
  assert.deepEqual(rec.args, args);
  assert.deepEqual({ code: rec.machineCode, unconfirmed: rec.unconfirmed, notFound: rec.notFound, lastStatus: rec.lastStatus }, { code: "A01", unconfirmed: true, notFound: false, lastStatus: null });
  const restored = core.restorePending(JSON.stringify({ A01: rec, A02: { ...rec, commandUuid: "bad" }, A03: { ...rec, startedAt: -core.PENDING_KEEP_MS - 1 }, A04: rec }), 2000);
  assert.deepEqual(Object.keys(restored), ["A01"], "bad uuid, too old, and wrong-machine records are dropped");
  assert.deepEqual(restored.A01.args, args);
  assert.deepEqual(core.restorePending("not json", 0), {});
  assert.deepEqual(core.restorePending(null, 0), {});
  assert.equal(core.locks(null, false), false);
  assert.equal(core.locks(rec, false), true);
  assert.equal(core.locks({ ...rec, notFound: true }, false), false);
  assert.equal(core.locks({ ...rec, lastStatus: "pending" }, true), false);
  assert.equal(core.locks({ ...rec, lastStatus: "claimed" }, true), true);
  const okView = core.resultView({ status: "applied" });
  const badView = core.resultView({ status: "rejected", reject_code: "NOT_CLAIM_OWNER" });
  assert.equal(core.lastResultVisible({ view: okView, at: 0, orderNo: "TEST-WO-1", step: 1 }, { nowMs: 119000 }), true);
  assert.equal(core.lastResultVisible({ view: okView, at: 0 }, { nowMs: 121000 }), false);
  assert.equal(core.lastResultVisible({ view: badView, at: 0, orderNo: "TEST-WO-1", step: 1 }, { orderNo: "TEST-WO-1", step: 1, nowMs: 60000 }), true);
  assert.equal(core.lastResultVisible({ view: badView, at: 0, orderNo: "TEST-WO-1", step: 1 }, { orderNo: "TEST-WO-2", step: 1, nowMs: 60000 }), false);
  assert.equal(core.lastResultVisible({ view: badView, at: 0, orderNo: "TEST-WO-1", step: 1 }, { orderNo: "TEST-WO-1", step: 1, nowMs: 601000 }), false);
  assert.equal(core.lastResultVisible(null, { nowMs: 0 }), false);
});

// ================================================================ app.js 接線（從 app.js 取出真正的函式在 vm 裡跑）
const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const BLOCK_START = "// ============================================================================================\r\n// 機台卡片「接錯了，退回」";
const blockFrom = appSource.indexOf(BLOCK_START.replace(/\r\n/g, appSource.includes("\r\n") ? "\r\n" : "\n"));
const blockTo = appSource.indexOf("function renderMachineCard(machine) {", blockFrom);
assert.ok(blockFrom >= 0 && blockTo > blockFrom, "app.js must contain the return-claim block right before renderMachineCard");
const blockSource = appSource.slice(blockFrom, blockTo);
const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function harness(options = {}) {
  const d = dictionaries();
  const dict = options.language === "vi" ? d.vi : d.zh;
  const timers = [];
  const holders = {};
  const storage = new Map(Object.entries(options.storage || {}));
  const calls = { fetch: [], toasts: [], rerenders: 0, refresh: [], storageReads: 0 };
  const order = options.order === undefined ? claimedOrder() : options.order;
  const machine = { code: "A01", name: "A01", order, isUnassignedBucket: false };
  // 目前登入的人（測試可以中途改：換人登入）
  const session = Object.assign({}, options.session === undefined ? SESSION : options.session);
  const batchState = { formError: "" };
  const context = {
    window: { MachTileReturnClaimCore: options.noCore ? null : core, crypto: { randomUUID: () => options.uuids ? options.uuids.shift() : UUID } },
    config: options.flag === undefined ? {} : { enableReturnClaim: options.flag },
    state: { source: "supabase", dailyStationStartRows: options.startRows || [], localStationStartRows: [] },
    machtileStationCmdCore: stationCore,
    machtileStationCmd: { pending: options.stationPending || {} },
    machtileInstantStartPending: {},
    machtilePickStartLocal: options.pickLocal || {},
    machtileCardState: { todayStatus: "ok", todayRows: options.todayRows || [] },
    machtileDeferredLoadState: new Map([["card-details", { status: options.cardDetails || "ready" }]]),
    machtileDepartmentAccess: { role: options.role || "operator", is_bridge: false },
    machtileAuthState: session,
    machtileBatchState: batchState,
    machtileRenderBatchReport: () => { calls.batchRenders = (calls.batchRenders || 0) + 1; },
    machtileActualRole: () => options.role || "operator",
    machtileCardActivityOf: () => null,
    machtileStationCmdMachineCode: (m) => String(m?.code || m?.name || "").trim().toUpperCase(),
    machtileStationCmdMachineByCode: (code) => (code === "A01" ? machine : null),
    machtileStationCmdRerender: () => { calls.rerenders += 1; },
    machtileRefreshAfterApplied: async (code, type) => { calls.refresh.push([code, type]); },
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
      createElement() { return { id: "", innerHTML: "", contains() { return false; }, querySelector() { return null; }, remove() { delete holders[this.id]; } }; },
      body: { appendChild(el) { holders[el.id] = el; } },
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    AbortController, console: { warn() {}, log() {} }, Date, JSON, Object, Array, Number, String, Boolean, Error,
  };
  const api = vm.runInNewContext(`${blockSource}
    ({ machtileReturnClaim, enabled: machtileReturnClaimEnabled, locks: machtileReturnClaimLocks, markup: machtileReturnClaimCardMarkup,
       restore: machtileReturnClaimRestore, open: machtileReturnClaimOpen, openRetry: machtileReturnClaimOpenRetry, submit: machtileReturnClaimSubmit,
       dismiss: machtileReturnClaimDismiss, handleClick: machtileReturnClaimHandleClick, closeSheet: machtileReturnClaimCloseSheet,
       blockMessage: machtileReturnClaimBlockMessage, batchBlock: machtileReturnClaimBatchBlock, save: machtileReturnClaimSave })`, context);
  const sheetHtml = () => holders.machtileReturnClaimSheet?.innerHTML || "";
  // 跑下一個輪詢 timer（跳過送出逾時用的 20 秒 timer）
  const runPoll = async () => {
    const index = timers.findIndex((timer) => timer.ms !== stationCore.SUBMIT_TIMEOUT_MS);
    assert.ok(index >= 0, "a poll timer must be scheduled");
    const [timer] = timers.splice(index, 1);
    await timer.fn();
  };
  const pollTimers = () => timers.filter((timer) => timer.ms !== stationCore.SUBMIT_TIMEOUT_MS).length;
  return { api, calls, machine, storage, sheetHtml, runPoll, pollTimers, context, session, batchState };
}
const freshRow = (extra) => [Object.assign({ id: PROCESS_ID, process_order: 1, process_name: "CNC車床加工", status: "pending", off_station_at: null, qty_completed: 0,
  work_orders: { work_order_no: "TEST-WO-1", part_no: "TEST-P1", part_name: "測試軸", status: "in_progress" }, machines: { machine_code: "A01" } }, extra)];
const commandRow = (extra) => Object.assign({ command_uuid: UUID, command_type: "return_claim", machine_code: "A01", pool_item_id: POOL_KEY,
  expected_order_no: "TEST-WO-1", expected_index_sn: 1, status: "pending", requested_at: new Date().toISOString(), claimed_at: null, applied_at: null,
  reject_code: null, reject_message: null, legacy_snapshot: null }, extra);
const PENDING_KEY = "machtile.returnClaimPending.v1";

test("flag off (missing, false, or non-boolean): every hook is inert — no markup, no lock, no fetch, no storage access", async () => {
  const stored = { [PENDING_KEY]: JSON.stringify({ A01: core.pendingRecord({ commandUuid: UUID, machineCode: "A01", orderNo: "TEST-WO-1", step: 1,
    args: core.buildArgs({ commandUuid: UUID, machineCode: "A01", poolItemId: POOL_KEY, orderNo: "TEST-WO-1", step: 1, role: "operator" }), startedAt: Date.now() }) }) };
  for (const flag of [undefined, false, "true", 1, null]) {
    const h = harness({ flag, storage: stored });
    assert.equal(h.api.enabled(), false);
    assert.equal(h.api.markup(h.machine), "", `markup flag=${flag}`);
    assert.equal(h.api.locks("A01"), false);
    assert.equal(h.api.blockMessage("A01"), "", "flag off: other entry points are never blocked");
    assert.equal(h.api.batchBlock(["A01", "A02"]), false);
    assert.equal(h.batchState.formError, "");
    h.api.restore();
    assert.deepEqual(Object.keys(h.api.machtileReturnClaim.pending), []);
    assert.equal(h.api.handleClick({ target: { closest: () => ({ dataset: { returnClaimOpen: "A01" } }) } }), false);
    await h.api.open("A01", null);
    await h.api.submit();
    assert.equal(h.sheetHtml(), "");
    assert.deepEqual(h.calls, { fetch: [], toasts: [], rerenders: 0, refresh: [], storageReads: 0 });
    assert.equal(h.pollTimers(), 0);
  }
  // 核心檔沒載到（舊快取）＝一樣當作關
  const noCore = harness({ flag: true, noCore: true });
  assert.equal(noCore.api.markup(noCore.machine), "");
  assert.equal(noCore.api.locks("A01"), false);
});

test("flag on: card markup follows the visibility rule and stays read-only", () => {
  const h = harness({ flag: true });
  const html = h.api.markup(h.machine);
  assert.equal(html, '<button type="button" class="card-select-entry pool-return-action" data-no-detail data-return-claim-open="A01">接錯了，退回</button>');
  assert.equal(h.api.markup(h.machine), html, "rendering twice gives the same result");
  assert.deepEqual(h.calls, { fetch: [], toasts: [], rerenders: 0, refresh: [], storageReads: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.machtileReturnClaim)), { pending: {}, timers: {}, lastResult: {}, sheet: null }, "render does not touch flow state");
  assert.match(harness({ flag: true, language: "vi" }).api.markup(h.machine), />Nhận nhầm, trả lại</);
  assert.equal(harness({ flag: true, order: null }).api.markup({ code: "A01", order: null }), "");
  for (const options of [
    { order: claimedOrder({ processStatus: "running" }) }, { order: claimedOrder({ done: 5 }) }, { order: claimedOrder({ dispatchPoolStatus: "gone" }) },
    { order: claimedOrder({ dispatchPoolSourceKey: "" }) }, { cardDetails: "loading" }, { role: "manager" },
    { stationPending: { A01: { commandType: "start" } } },
    { pickLocal: { A01: { type: "start", orderNo: "TEST-WO-1", step: 1, at: Date.now() } } },
    { todayRows: [{ report_type: "noon", process_id: PROCESS_ID }] },
    { startRows: [{ machine_code: "A01", command_type: "start", status: "applied", expected_order_no: "TEST-WO-1", expected_index_sn: 1, applied_at: new Date().toISOString() }] },
  ]) {
    const hidden = harness({ flag: true, ...options });
    assert.equal(hidden.api.markup(hidden.machine), "", JSON.stringify(options));
  }
});

test("operator flow: confirm sheet → contract RPC → contract poll → applied → card and pool reload", async () => {
  const state = { row: null };
  const h = harness({ flag: true, backend: async (url, init) => {
    if (url.startsWith("work_order_processes?")) return freshRow();
    if (url === "rpc/machtile_submit_return_claim_command") { state.row = commandRow(); return state.row; }
    if (url.startsWith("station_commands?")) return state.row ? [state.row] : [];
    throw new Error(`unexpected ${url} ${init?.method || ""}`);
  } });
  await h.api.open("A01", null);
  const confirmHtml = h.sheetHtml();
  assert.match(confirmHtml, /確認退回這張單/);
  assert.match(confirmHtml, /這張單會回到待做池，別人可以再接。/);
  assert.match(confirmHtml, /這台機台會變成沒有工單。/);
  assert.match(confirmHtml, /不會報工，也不會記任何數量。/);
  assert.match(confirmHtml, /TEST-WO-1/);
  assert.match(confirmHtml, /第 1 道/);
  assert.doesNotMatch(confirmHtml, /data-return-claim-reason/, "operator is not asked for a reason");
  assert.match(confirmHtml, /data-return-claim-confirm >確認退回</, "confirm enabled after the re-read passed");
  assert.equal(h.calls.fetch.length, 1, "opening the sheet only re-reads the process row");
  await h.api.submit();
  const post = h.calls.fetch[1];
  assert.equal(post.url, "rpc/machtile_submit_return_claim_command");
  assert.equal(post.init.method, "POST");
  assert.deepEqual(JSON.parse(post.init.body), { p_command_uuid: UUID, p_machine_code: "A01", p_pool_item_id: POOL_KEY, p_expected_order_no: "TEST-WO-1",
    p_expected_index_sn: 1, p_expected_part_no: "TEST-P1", p_reason: null });
  assert.equal(h.api.locks("A01"), true, "start/report locked while the return is pending");
  assert.match(h.api.markup(h.machine), /data-return-claim-status="pending"[^>]*>退回中，等工廠處理…</);
  assert.doesNotMatch(h.api.markup(h.machine), /data-return-claim-open/, "no second button while pending");
  assert.match(h.sheetHtml(), /已送出，等工廠處理。請稍等，不要重按。/);
  assert.ok(h.storage.get(PENDING_KEY).includes(UUID), "pending survives a reload");
  state.row = commandRow({ status: "claimed", claimed_at: new Date().toISOString() });
  await h.runPoll();
  assert.equal(h.calls.fetch[2].url, `station_commands?select=${CONTRACT_POLL_SELECT}&command_uuid=eq.${UUID}`);
  assert.match(h.sheetHtml(), /工廠處理中，請稍等。/);
  state.row = commandRow({ status: "applied", applied_at: new Date().toISOString(), legacy_snapshot: { return_claim: { mode: "unassigned", pool_status: "returned", station_cleared: true } } });
  await h.runPoll();
  assert.equal(h.api.locks("A01"), false);
  assert.deepEqual(Object.keys(h.api.machtileReturnClaim.pending), []);
  assert.equal(h.storage.get(PENDING_KEY), "{}");
  assert.deepEqual(h.calls.toasts, ["已退回待做池，這台現在沒有工單。"]);
  assert.deepEqual(h.calls.refresh, [["A01", "return_claim"]], "card + pool reload after applied");
  assert.match(h.sheetHtml(), /data-return-claim-result="applied"/);
  assert.equal(h.pollTimers(), 0, "polling stops at a terminal status");
  assert.equal(h.calls.fetch.filter((call) => call.url.startsWith("rpc/")).length, 1, "exactly one submit");
  // 重讀後機台沒有單：卡片只留一行結果
  assert.match(h.api.markup({ code: "A01", name: "A01", order: null }), /^<p[^>]*data-return-claim-status="applied"[^>]*>已退回待做池，這台現在沒有工單。<\/p>$/);
});

test("admin/planner must type a reason; it is sent as p_reason", async () => {
  for (const role of ["admin", "planner"]) {
    let posted = null;
    const h = harness({ flag: true, role, backend: async (url, init) => {
      if (url.startsWith("work_order_processes?")) return freshRow();
      if (url.startsWith("rpc/")) { posted = JSON.parse(init.body); return [commandRow()]; }
      return [];
    } });
    await h.api.open("A01", null);
    assert.match(h.sheetHtml(), /data-return-claim-reason/);
    assert.match(h.sheetHtml(), /退回原因（必填）/);
    await h.api.submit();
    assert.equal(posted, null, "nothing is sent without a reason");
    assert.match(h.sheetHtml(), /代退要寫原因，請填一句話。/);
    h.api.machtileReturnClaim.sheet.reason = "  生管代退：接錯機台  ";
    await h.api.submit();
    assert.equal(posted.p_reason, "生管代退：接錯機台");
    assert.equal(posted.p_command_uuid, UUID);
  }
});

test("re-read at tap time blocks a stale card (started elsewhere) and an unreadable one", async () => {
  const started = harness({ flag: true, backend: async () => freshRow({ status: "running" }) });
  await started.api.open("A01", null);
  assert.match(started.sheetHtml(), /這張單的狀況變了/);
  assert.match(started.sheetHtml(), /data-return-claim-confirm disabled/);
  await started.api.submit();
  assert.equal(started.calls.fetch.length, 1, "no submit");
  const offline = harness({ flag: true, backend: async () => { throw new TypeError("Failed to fetch"); } });
  await offline.api.open("A01", null);
  assert.match(offline.sheetHtml(), /讀不到這張單的最新資料/);
  await offline.api.submit();
  assert.equal(offline.calls.fetch.length, 1);
});

test("server refusal: one plain sentence, no raw code, nothing left pending, no resend button", async () => {
  for (const [code, sentence] of [["NOT_CLAIM_OWNER", "這張單不是你接的，你不能退回。請找接單的人或生管。"],
    ["CLAIM_ALREADY_STARTED", "這張單已經開工或已有報工，不能退回。要換單請找生管。"],
    ["RETURN_CLAIM_DISABLED", "退回功能還沒開放，請找生管幫你處理。"],
    ["NEVER_SEEN_BEFORE", "沒有退回成功。請重新整理畫面確認這台的工單；還是不對請找生管。"]]) {
    const h = harness({ flag: true, backend: async (url) => {
      if (url.startsWith("work_order_processes?")) return freshRow();
      throw new Error(`400 {"code":"P0001","message":"${code}"}`);
    } });
    await h.api.open("A01", null);
    await h.api.submit();
    assert.ok(h.sheetHtml().includes(sentence), code);
    assert.doesNotMatch(h.sheetHtml(), new RegExp(code), `${code} must not be shown`);
    assert.doesNotMatch(h.sheetHtml(), /data-return-claim-confirm/, "a refusal offers no resend");
    assert.deepEqual(Object.keys(h.api.machtileReturnClaim.pending), []);
    assert.equal(h.api.locks("A01"), false);
    assert.equal(h.pollTimers(), 0);
  }
});

test("factory rejection and expiry arrive through the poll and are shown as plain sentences", async () => {
  for (const [row, sentence] of [[{ status: "rejected", reject_code: "LEGACY_STATE_INCONSISTENT", reject_message: "x" }, "舊 MES 的資料對不起來，系統不敢退回。請找生管處理。"],
    [{ status: "rejected", reject_code: "FUTURE_CODE", reject_message: "raw factory text" }, "沒有退回成功。請重新整理畫面確認這台的工單；還是不對請找生管。"],
    [{ status: "expired", reject_code: "EXPIRED" }, "超過 10 分鐘工廠都沒有接手，這次沒有退回，工單還在這台。需要的話請再按一次。"]]) {
    const state = { row: null };
    const h = harness({ flag: true, backend: async (url) => {
      if (url.startsWith("work_order_processes?")) return freshRow();
      if (url.startsWith("rpc/")) { state.row = commandRow(); return [state.row]; }
      return [state.row];
    } });
    await h.api.open("A01", null);
    await h.api.submit();
    state.row = commandRow(row);
    await h.runPoll();
    assert.deepEqual(h.calls.toasts, [sentence]);
    assert.ok(h.sheetHtml().includes(sentence));
    assert.doesNotMatch(h.sheetHtml(), /LEGACY_STATE_INCONSISTENT|FUTURE_CODE|raw factory text|EXPIRED/);
    assert.equal(h.api.locks("A01"), false);
    assert.ok(h.api.markup(h.machine).includes(sentence), "the card keeps the sentence for this order");
    assert.deepEqual(h.calls.refresh, [["A01", "return_claim"]], "card reloads after a rejection too");
  }
});

test("network cut on submit: no blind resend; the retry reuses the same command_uuid and the same args", async () => {
  const state = { submits: [], fail: true, row: null };
  const h = harness({ flag: true, uuids: [UUID, "99999999-9999-4999-8999-999999999999"], backend: async (url, init) => {
    if (url.startsWith("work_order_processes?")) return freshRow();
    if (url.startsWith("rpc/")) {
      state.submits.push(JSON.parse(init.body));
      if (state.fail) throw new TypeError("Failed to fetch");
      state.row = commandRow();
      return [state.row];
    }
    return state.row ? [state.row] : [];
  } });
  await h.api.open("A01", null);
  await h.api.submit();
  assert.match(h.sheetHtml(), /網路不穩，還不知道有沒有送到。/);
  assert.match(h.sheetHtml(), /data-return-claim-confirm>用同一筆重送</);
  assert.equal(state.submits.length, 1);
  assert.equal(h.api.locks("A01"), true, "locked while we do not know");
  assert.match(h.api.markup(h.machine), /data-return-claim-retry="A01"/);
  // 輪詢只查不送
  await h.runPoll(); await h.runPoll();
  assert.equal(state.submits.length, 1, "polling never resubmits");
  // 關掉確認卡 → 從卡片重開 → 重送＝同一個 uuid、同樣內容
  h.api.closeSheet();
  h.api.openRetry("A01", null);
  state.fail = false;
  await h.api.submit();
  assert.equal(state.submits.length, 2);
  assert.deepEqual(state.submits[1], state.submits[0]);
  assert.equal(state.submits[1].p_command_uuid, UUID);
  assert.match(h.api.markup(h.machine), /data-return-claim-status="pending"/);
});

test("uncertain submit that the server never saw: unlocks after 3 empty polls ≥30 s, keeps the uuid for an explicit resend, can be dismissed", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const submits = [];
    const h = harness({ flag: true, backend: async (url, init) => {
      if (url.startsWith("work_order_processes?")) return freshRow();
      if (url.startsWith("rpc/")) { submits.push(JSON.parse(init.body)); throw new Error("503 upstream"); }
      return [];
    } });
    await h.api.open("A01", null);
    await h.api.submit();
    h.api.closeSheet();
    await h.runPoll(); await h.runPoll();
    now += 31000;
    await h.runPoll();
    assert.equal(h.api.locks("A01"), false, "start/report unlocked");
    assert.equal(h.pollTimers(), 0, "polling stopped");
    const html = h.api.markup(h.machine);
    assert.match(html, /data-return-claim-status="not-found"/);
    assert.match(html, /data-return-claim-retry="A01"/);
    assert.match(html, /data-return-claim-dismiss="A01"/);
    assert.equal(submits.length, 1);
    assert.equal(h.api.machtileReturnClaim.pending.A01.commandUuid, UUID);
    h.api.dismiss("A01");
    assert.deepEqual(Object.keys(h.api.machtileReturnClaim.pending), []);
    assert.match(h.api.markup(h.machine), /data-return-claim-open="A01"/, "back to the plain button");
  } finally { Date.now = realNow; }
});

test("reload with a pending return: restored from storage, polled with the same uuid, never resubmitted", async () => {
  const args = core.buildArgs({ commandUuid: UUID, machineCode: "A01", poolItemId: POOL_KEY, orderNo: "TEST-WO-1", step: 1, role: "operator" });
  const stored = { [PENDING_KEY]: JSON.stringify({ A01: core.pendingRecord({ commandUuid: UUID, machineCode: "A01", orderNo: "TEST-WO-1", step: 1, args, startedAt: Date.now(), lastStatus: "pending", ...SESSION }) }) };
  const h = harness({ flag: true, storage: stored, backend: async (url) => {
    assert.ok(url.startsWith("station_commands?"), url);
    return [commandRow({ status: "applied", legacy_snapshot: { return_claim: { mode: "stale_assignment_reconciled", pool_status: "returned", station_cleared: false } } })];
  } });
  h.api.restore();
  assert.equal(h.api.locks("A01"), true);
  await h.runPoll();
  assert.deepEqual(h.calls.toasts, ["已把這張單退回待做池；這台機台目前掛的工單沒有動。"]);
  assert.equal(h.calls.fetch.length, 1);
});

// ---------------------------------------------------------------- 審查修正（REVIEW-P2-app-opus：MAJOR 4、MINOR 7、MINOR 8）
const UUID2 = "99999999-9999-4999-8999-999999999999";
const BUSY_ZH = "這台有一筆「退回接單」還在等工廠處理，等它有結果再操作。";
const acceptingBackend = (state) => async (url, init) => {
  if (url.startsWith("work_order_processes?")) return state.fresh ? state.fresh() : freshRow();
  if (url.startsWith("rpc/")) {
    state.submits.push(JSON.parse(init.body));
    if (state.fail) throw new TypeError("Failed to fetch");
    state.row = commandRow({ command_uuid: JSON.parse(init.body).p_command_uuid });
    return [state.row];
  }
  return state.row ? [state.row] : [];
};

test("pending return: other entry points for that machine get a sentence about the RETURN (batch start/stop, reports, pick order)", async () => {
  const state = { submits: [], row: null };
  const h = harness({ flag: true, backend: acceptingBackend(state) });
  assert.equal(h.api.blockMessage("A01"), "", "nothing pending: not blocked");
  assert.equal(h.api.batchBlock(["A01", "A02"]), false);
  await h.api.open("A01", null);
  await h.api.submit();
  assert.equal(h.api.blockMessage("A01"), BUSY_ZH);
  assert.equal(h.api.blockMessage(" a01 "), BUSY_ZH, "machine code is normalised");
  assert.match(BUSY_ZH, /退回/);
  assert.doesNotMatch(BUSY_ZH, /開工|停工/, "the sentence is about the return, not start/stop");
  assert.equal(h.api.blockMessage("A02"), "", "other machines are not blocked");
  assert.equal(h.api.batchBlock(["A02"]), false);
  assert.equal(h.api.batchBlock(["A02", "A01"]), true, "a batch that contains the machine is stopped as a whole");
  assert.equal(h.batchState.formError, `A01：${BUSY_ZH}`);
  assert.equal(h.calls.toasts.at(-1), `A01：${BUSY_ZH}`);
  assert.equal(h.calls.batchRenders, 1);
  assert.equal(state.submits.length, 1, "blocking never sends anything");
  state.row = commandRow({ status: "applied", legacy_snapshot: { return_claim: { mode: "unassigned", pool_status: "returned", station_cleared: true } } });
  await h.runPoll();
  assert.equal(h.api.blockMessage("A01"), "", "unblocked as soon as the server gives a result");
  // 越南文
  const vi = harness({ flag: true, language: "vi", backend: acceptingBackend({ submits: [], row: null }) });
  await vi.api.open("A01", null);
  await vi.api.submit();
  assert.match(vi.api.blockMessage("A01"), /trả lại phiếu/);
});

test("lock release after 11 minutes: only when the last server status was pending; claimed keeps every entry point blocked", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    for (const [status, stillLocked] of [["pending", false], ["claimed", true]]) {
      const state = { submits: [], row: null };
      const h = harness({ flag: true, backend: acceptingBackend(state) });
      await h.api.open("A01", null);
      await h.api.submit();
      state.row = commandRow({ status });
      await h.runPoll();
      assert.equal(h.api.locks("A01"), true, status);
      now += 12 * 60 * 1000;
      assert.equal(h.api.locks("A01"), stillLocked, `${status} after 12 minutes`);
      assert.equal(h.api.blockMessage("A01"), stillLocked ? BUSY_ZH : "", status);
    }
  } finally { Date.now = realNow; }
});

test("a record never renders as 'this order' on a card that shows another order or step; a stale not-found record is dropped on the next return", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const state = { submits: [], row: null, fail: true, fresh: null };
    const h = harness({ flag: true, uuids: [UUID, UUID2], backend: acceptingBackend(state) });
    await h.api.open("A01", null);
    await h.api.submit();
    h.api.closeSheet();
    // 還在確認有沒有送到（鎖著）而卡片換成別張單 → 只說這台有一筆退回在處理，不給重送／不退了
    const otherOrder = claimedOrder({ id: "TEST-WO-2" });
    const lockedOther = h.api.markup({ code: "A01", name: "A01", order: otherOrder });
    assert.equal(lockedOther, `<p class="station-cmd-status is-wait" data-no-detail data-return-claim-status="other-order" role="status">${BUSY_ZH}</p>`);
    assert.equal(h.api.markup({ code: "A01", name: "A01", order: null }), lockedOther, "empty card: same machine-level line");
    assert.equal(h.api.markup({ code: "A01", name: "A01", order: claimedOrder({ stationStep: 2 }) }), lockedOther, "same order, another step");
    assert.equal(h.api.locks("A01"), true, "the machine stays locked");
    // 連續查不到 → notFound（不鎖）
    await h.runPoll(); await h.runPoll();
    now += 31000;
    await h.runPoll();
    assert.equal(h.api.machtileReturnClaim.pending.A01.notFound, true);
    assert.match(h.api.markup(h.machine), /data-return-claim-status="not-found"/, "same order: the not-found line with resend / dismiss is still offered");
    // 卡片換單：不顯示「這張單還在這台」、沒有重送／不退了；新單照規則出按鈕
    h.machine.order = otherOrder;
    const html = h.api.markup(h.machine);
    assert.doesNotMatch(html, /data-return-claim-status|data-return-claim-retry|data-return-claim-dismiss|這張單還在這台/);
    assert.equal(html, '<button type="button" class="card-select-entry pool-return-action" data-no-detail data-return-claim-open="A01">接錯了，退回</button>');
    h.api.openRetry("A01", null);
    assert.equal(h.sheetHtml(), "", "resend is not offered for an order that is no longer on the card");
    assert.equal(state.submits.length, 1);
    // 對新單按退回：過時的那筆丟掉，用新的 uuid、新單的內容
    state.fail = false;
    state.fresh = () => freshRow({ work_orders: { work_order_no: "TEST-WO-2", part_no: "TEST-P2", part_name: "測試軸", status: "in_progress" } });
    await h.api.open("A01", null);
    assert.deepEqual(Object.keys(h.api.machtileReturnClaim.pending), [], "stale record dropped");
    assert.equal(h.storage.get(PENDING_KEY), "{}");
    assert.match(h.sheetHtml(), /TEST-WO-2/);
    await h.api.submit();
    assert.equal(state.submits.length, 2);
    assert.equal(state.submits[1].p_command_uuid, UUID2, "a new attempt, not the stale uuid");
    assert.equal(state.submits[1].p_expected_order_no, "TEST-WO-2");
    assert.equal(h.api.machtileReturnClaim.pending.A01.orderNo, "TEST-WO-2");
  } finally { Date.now = realNow; }
  // 純邏輯
  const rec = core.pendingRecord({ commandUuid: UUID, machineCode: "A01", orderNo: "TEST-WO-1", step: 1, args: {}, startedAt: 1 });
  assert.equal(core.recordMatchesOrder(rec, { id: "TEST-WO-1", stationStep: 1 }), true);
  assert.equal(core.recordMatchesOrder(rec, { id: "TEST-WO-1", stationStep: "1" }), true);
  assert.equal(core.recordMatchesOrder(rec, { id: "TEST-WO-1", stationStep: 2 }), false);
  assert.equal(core.recordMatchesOrder(rec, { id: "TEST-WO-2", stationStep: 1 }), false);
  assert.equal(core.recordMatchesOrder(rec, null), false);
  assert.equal(core.recordMatchesOrder(null, { id: "TEST-WO-1", stationStep: 1 }), false);
  assert.equal(core.cardRecordMode(null, null, false), "none");
  assert.equal(core.cardRecordMode(rec, { id: "TEST-WO-1", stationStep: 1 }, false), "own");
  assert.equal(core.cardRecordMode({ ...rec, notFound: true }, { id: "TEST-WO-1", stationStep: 1 }, false), "own");
  assert.equal(core.cardRecordMode(rec, { id: "TEST-WO-2", stationStep: 1 }, false), "machine");
  assert.equal(core.cardRecordMode({ ...rec, lastStatus: "claimed" }, null, true), "machine");
  assert.equal(core.cardRecordMode({ ...rec, notFound: true }, { id: "TEST-WO-2", stationStep: 1 }, false), "none");
  assert.equal(core.cardRecordMode({ ...rec, lastStatus: "pending" }, { id: "TEST-WO-2", stationStep: 1 }, true), "none");
});

test("resend does the same fresh re-read as the first submit: changed or unreadable → nothing is sent", async () => {
  for (const reopenFromCard of [false, true]) {
    const state = { submits: [], row: null, fail: true, fresh: null };
    const h = harness({ flag: true, backend: acceptingBackend(state) });
    await h.api.open("A01", null);
    await h.api.submit();
    assert.equal(state.submits.length, 1);
    if (reopenFromCard) { h.api.closeSheet(); h.api.openRetry("A01", null); }
    assert.match(h.sheetHtml(), /data-return-claim-confirm>用同一筆重送</);
    state.fail = false;
    // 這張單在等的時候已經開工
    state.fresh = () => freshRow({ status: "running" });
    const readsBefore = h.calls.fetch.filter((call) => call.url.startsWith("work_order_processes?")).length;
    await h.api.submit();
    assert.equal(h.calls.fetch.filter((call) => call.url.startsWith("work_order_processes?")).length, readsBefore + 1, "resend re-reads the process row");
    assert.equal(h.calls.fetch.at(-1).url, h.calls.fetch[0].url, "the same re-read query as the first submit");
    assert.equal(state.submits.length, 1, "started meanwhile: the resend is not sent");
    assert.match(h.sheetHtml(), /這張單的狀況變了/);
    // 讀不到
    state.fresh = () => { throw new TypeError("Failed to fetch"); };
    await h.api.submit();
    assert.equal(state.submits.length, 1, "unreadable: the resend is not sent");
    assert.match(h.sheetHtml(), /讀不到這張單的最新資料/);
    // 重讀通過 → 同一個 uuid、同樣內容
    state.fresh = null;
    await h.api.submit();
    assert.equal(state.submits.length, 2);
    assert.deepEqual(state.submits[1], state.submits[0]);
    assert.match(h.api.markup(h.machine), /data-return-claim-status="pending"/);
  }
});

test("stored record carries tenant + app user; restore drops other sessions' records and never deletes them; re-login as someone else releases the card", async () => {
  const args = (machineCode) => core.buildArgs({ commandUuid: UUID2, machineCode, poolItemId: POOL_KEY, orderNo: "TEST-WO-9", step: 1, role: "operator" });
  const foreign = (machineCode, who) => core.pendingRecord({ commandUuid: UUID2, machineCode, orderNo: "TEST-WO-9", step: 1, args: args(machineCode), startedAt: Date.now(), lastStatus: "pending", ...who });
  // 純邏輯
  const raw = JSON.stringify({ A01: foreign("A01", SESSION), A02: foreign("A02", OTHER_USER), A03: foreign("A03", OTHER_TENANT), A04: foreign("A04", {}) });
  assert.deepEqual(Object.keys(core.restoreForSession(raw, Date.now(), SESSION)), ["A01"]);
  assert.deepEqual(Object.keys(core.restoreForSession(raw, Date.now(), OTHER_USER)), ["A02"]);
  assert.deepEqual(Object.keys(core.restoreForSession(raw, Date.now(), OTHER_TENANT)), ["A03"]);
  for (const unknown of [null, {}, { tenantId: SESSION.tenantId, appUserId: "" }, { tenantId: "", appUserId: SESSION.appUserId }]) {
    assert.deepEqual(core.restoreForSession(raw, Date.now(), unknown), {}, "session not known → nothing is restored");
  }
  assert.equal(core.sameSession(foreign("A04", {}), { tenantId: "", appUserId: "" }), false, "empty never matches empty");
  assert.deepEqual(Object.keys(core.mergeForSave(raw, {}, Date.now(), SESSION)).sort(), ["A02", "A03", "A04"], "own finished record removed, other sessions' kept");
  assert.deepEqual(Object.keys(core.mergeForSave(raw, { A02: foreign("A02", SESSION) }, Date.now(), SESSION)).sort(), ["A02", "A03", "A04"]);
  assert.equal(core.mergeForSave(raw, { A02: foreign("A02", SESSION) }, Date.now(), SESSION).A02.appUserId, SESSION.appUserId, "same machine: own record wins");
  assert.deepEqual(core.mergeForSave(raw, {}, Date.now() + core.PENDING_KEEP_MS + 1000, SESSION), {}, "expired records are not kept");

  // 別人（同租戶另一個人／另一個租戶／沒記是誰）的紀錄：不還原、不鎖、不輪詢、localStorage 不動
  for (const who of [OTHER_USER, OTHER_TENANT, {}]) {
    const stored = JSON.stringify({ A01: foreign("A01", who) });
    const h = harness({ flag: true, storage: { [PENDING_KEY]: stored } });
    h.api.restore();
    assert.deepEqual(Object.keys(h.api.machtileReturnClaim.pending), [], JSON.stringify(who));
    assert.equal(h.api.locks("A01"), false);
    assert.equal(h.pollTimers(), 0);
    assert.equal(h.calls.fetch.length, 0);
    assert.equal(h.storage.get(PENDING_KEY), stored);
    assert.match(h.api.markup(h.machine), /^<button[^>]*data-return-claim-open="A01"/, "the card is not locked by someone else's record");
  }
  // 還不知道自己是誰（app_users 還沒查到）→ 不還原
  const unknown = harness({ flag: true, session: { tenantId: SESSION.tenantId, appUserId: "" }, storage: { [PENDING_KEY]: JSON.stringify({ A01: foreign("A01", SESSION) }) } });
  unknown.api.restore();
  assert.deepEqual(Object.keys(unknown.api.machtileReturnClaim.pending), []);

  // 自己送出：紀錄記下租戶＋app user＋工序；同一台平板上別人的紀錄（A02）原樣留著
  const state = { submits: [], row: null };
  const othersA02 = foreign("A02", OTHER_USER);
  const h = harness({ flag: true, storage: { [PENDING_KEY]: JSON.stringify({ A02: othersA02 }) }, backend: acceptingBackend(state) });
  h.api.restore();
  assert.deepEqual(Object.keys(h.api.machtileReturnClaim.pending), []);
  await h.api.open("A01", null);
  await h.api.submit();
  let saved = JSON.parse(h.storage.get(PENDING_KEY));
  assert.deepEqual(Object.keys(saved).sort(), ["A01", "A02"]);
  assert.deepEqual({ tenantId: saved.A01.tenantId, appUserId: saved.A01.appUserId, processId: saved.A01.processId }, { ...SESSION, processId: PROCESS_ID });
  assert.deepEqual(saved.A02, JSON.parse(JSON.stringify(othersA02)), "the other user's record is untouched");
  assert.equal(h.api.locks("A01"), true);

  // session 過期 → 換另一個人登入（沒有重新整理頁面）：記憶體裡前一個人的放掉，卡片不鎖；localStorage 那筆還在
  h.session.appUserId = OTHER_USER.appUserId;
  h.api.restore();
  assert.deepEqual(Object.keys(h.api.machtileReturnClaim.pending), ["A02"], "now only the new user's own record is in memory");
  assert.equal(h.api.locks("A01"), false, "the previous user's return no longer locks the card");
  assert.equal(h.api.blockMessage("A01"), "");
  assert.equal(h.api.locks("A02"), true);
  assert.ok(JSON.parse(h.storage.get(PENDING_KEY)).A01, "the previous user's record stays in storage");
  // 原來的人重新登入（session 過期重登）：自己的那筆還原、繼續輪詢，不重送
  h.session.appUserId = SESSION.appUserId;
  h.api.restore();
  assert.deepEqual(Object.keys(h.api.machtileReturnClaim.pending), ["A01"]);
  assert.equal(h.api.locks("A01"), true);
  assert.equal(h.api.machtileReturnClaim.pending.A01.commandUuid, state.submits[0].p_command_uuid);
  assert.equal(state.submits.length, 1);
  state.row = commandRow({ command_uuid: state.submits[0].p_command_uuid, status: "applied", legacy_snapshot: { return_claim: { mode: "unassigned", pool_status: "returned", station_cleared: true } } });
  while (h.api.machtileReturnClaim.pending.A01 && h.pollTimers() > 0) await h.runPoll();
  assert.equal(h.api.locks("A01"), false);
  saved = JSON.parse(h.storage.get(PENDING_KEY));
  assert.deepEqual(Object.keys(saved), ["A02"], "after my result only the other user's record is left");
});

// ---------------------------------------------------------------- 旗標關＝跟上線版逐字相同（原始碼層）
test("outside the return-claim block, app.js differs from the base only by the listed flag-guarded hooks", (t) => {
  const git = (args) => childProcess.execFileSync("git", args, { cwd: __dirname, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let base;
  try { base = process.env.RETURN_CLAIM_BASE || git(["merge-base", "HEAD", "origin/main"]).trim(); } catch { t.skip("git base not available"); return; }
  const norm = (text) => text.replace(/\r\n/g, "\n");
  const baseApp = norm(git(["show", `${base}:app.js`]));
  if (baseApp.includes("machtileReturnClaim")) { t.skip("base already contains the return-claim code (already merged)"); return; }
  let current = norm(appSource);
  const block = norm(blockSource);
  assert.equal(current.split(block).length, 2);
  current = current.replace(block, () => "");
  // 每一個掛進既有程式的地方：[現在的字串, 旗標關時等價的原字串]
  const hooks = [
    ["function machtileStationCmdRestorePendingEarly() {\n  machtileReturnClaimRestore();   // 「接錯了，退回」等結果中的那筆也一起還原（旗標關＝什麼都不做）\n", "function machtileStationCmdRestorePendingEarly() {\n"],
    ["  const locked = (Boolean(pending) && !instantStartTimedOut && !(releaseNote && releaseNote.unlock)) || machtileReturnClaimLocks(code);",
      "  const locked = Boolean(pending) && !instantStartTimedOut && !(releaseNote && releaseNote.unlock);"],
    ["(pending && !machtileStationCmdUnlocked(pending)) || machtileReturnClaimLocks(code)) return;", "(pending && !machtileStationCmdUnlocked(pending))) return;"],
    ["  // 這台有一筆「接錯了，退回」在等結果 → 報工／完工先鎖住（旗標關＝永遠 false）\n  const returnClaimLocked = machtileReturnClaimLocks(machine.code || machine.name);\n", ""],
    ["order && canReport && !returnClaimLocked\n    ? `<button type=\"button\" class=\"machine-report-button\"", "order && canReport\n    ? `<button type=\"button\" class=\"machine-report-button\""],
    ["machtileFinishButtonEnabled() && order && canReport && !returnClaimLocked\n", "machtileFinishButtonEnabled() && order && canReport\n"],
    ["${machtileReturnClaimCardMarkup(machine)}", ""],
    ["    if (machtileReturnClaimHandleClick(event)) return;\n", ""],
    // ---- 審查修正加的掛點。旗標關時 machtileReturnClaimEnabled()＝false、machtileReturnClaimBlockMessage()＝""、
    //      machtileReturnClaimBatchBlock()＝false（上面「flag off」那個測試逐一斷言），所以每一個都等於原字串。
    // 舊的「退回池子」：新功能開著就不出、也不給按
    ["machtileCanReturnDispatchPool() && isPendingClaim && !machtileReturnClaimEnabled()) {", "machtileCanReturnDispatchPool() && isPendingClaim) {"],
    ["!machtileCanReturnDispatchPool() || machtileReturnClaimEnabled()) return;", "!machtileCanReturnDispatchPool()) return;"],
    // 退回等待中：接單、選工單／待做池面板
    ["  if (!sourceKey || !machineCode || machtileDispatchPoolState.claimBusy) return;\n  if (machtileReturnClaimBlockMessage(machineCode)) { showToast(machtileReturnClaimBlockMessage(machineCode), \"error\"); return; }\n",
      "  if (!sourceKey || !machineCode || machtileDispatchPoolState.claimBusy) return;\n"],
    ["  if (!machine) return;\n  if (machtileReturnClaimBlockMessage(machineCode)) { showToast(machtileReturnClaimBlockMessage(machineCode), \"error\"); return; }\n",
      "  if (!machine) return;\n"],
    // 退回等待中：智慧報工預覽／正式送出（單台報工面板與批次智慧報工共用）
    ["  if (machtileReturnClaimBlockMessage(code)) { block(machtileReturnClaimBlockMessage(code)); return; }\n", ""],
    ["  if (machtileReturnClaimBlockMessage(code)) { flow.error = machtileReturnClaimBlockMessage(code); machtileRenderStationReportSurfaces(); return; }\n", ""],
    // 退回等待中：批次開工／停工
    ["  if (machtileReturnClaimBlockMessage(code)) return { eligible: false, checked: false, reason: machtileReturnClaimBlockMessage(code) };\n", ""],
    // 退回等待中：批次報工（直送 field_report_upsert 那條與智慧報工）、單台報工表單送出
    ["  if (machtileReturnClaimBatchBlock(toSend.map(({ model }) => model.machineCode))) return;\n", ""],
    ["    if (machtileReturnClaimBlockMessage(selectedOrder.machine)) { machtileShowReportSubmitError(machtileReturnClaimBlockMessage(selectedOrder.machine)); return; }\n", ""],
  ];
  for (const [now, before] of hooks) {
    assert.equal(current.split(now).length, 2, `hook must appear exactly once: ${now.slice(0, 60)}`);
    current = current.replace(now, () => before);
  }
  assert.doesNotMatch(current, /machtileReturnClaim|returnClaimLocked|enableReturnClaim/, "no other reference outside the block");
  assert.equal(current, baseApp, "with the block removed and the hooks reverted, app.js is byte-identical to the base");
  // 設定檔：只多一個預設關的旗標
  const baseConfig = norm(git(["show", `${base}:config.js`]));
  const config = norm(fs.readFileSync(path.join(__dirname, "config.js"), "utf8"));
  assert.match(config, /\n  enableReturnClaim: false,\n/);
  assert.equal(config.split("\n").filter((line) => !/enableReturnClaim|接錯了，退回|return_claim/.test(line)).join("\n"), baseConfig);
});
