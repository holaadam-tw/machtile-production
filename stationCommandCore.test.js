// 純邏輯測試，無相依：repo 根目錄執行 `node stationCommandCore.test.js`
process.env.TZ = "Asia/Taipei";
const c = require("./stationCommandCore.js");
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got  " + g + "\n        want " + w); }
};
const throws = (name, fn, msg) => {
  try { fn(); fail++; console.log("  FAIL " + name + " (did not throw)"); }
  catch (e) { if (!msg || String(e.message) === msg) { pass++; console.log("  PASS " + name); } else { fail++; console.log("  FAIL " + name + " threw " + e.message); } }
};

const UUID = "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const order = { id: "XX01202502050012", part: "HCG-06本體", drawing: "HCG-06-01", process: "車床加工", stationStep: 5, offStation: false };

console.log("== parseFlag／enabledForMachine ==");
eq("沒設 → 關", c.flagIsOn(c.parseFlag(undefined)), false);
eq("空陣列 → 關", c.flagIsOn(c.parseFlag([])), false);
eq("true 不是合法值 → 關（不誤開全廠）", c.flagIsOn(c.parseFlag(true)), false);
eq("物件 → 關", c.flagIsOn(c.parseFlag({ A04: true })), false);
eq("[\"a04\"] → 只開 A04（大小寫、空白不影響）", c.parseFlag([" a04 "]), { all: false, machines: ["A04"] });
eq("逗號字串也可以", c.parseFlag("A04, A05").machines, ["A04", "A05"]);
eq("* → 全部", c.parseFlag(["*"]).all, true);
const flagA04 = c.parseFlag(["A04"]);
eq("A04 開", c.enabledForMachine(flagA04, "A04"), true);
eq("A01 關", c.enabledForMachine(flagA04, "A01"), false);
eq("空代號 → 關", c.enabledForMachine(flagA04, ""), false);
eq("* → B03 也開", c.enabledForMachine(c.parseFlag("*"), "b03"), true);

console.log("== isMultiStation ==");
eq("A04 單工站", c.isMultiStation("A04"), false);
eq("B03 多工站", c.isMultiStation("B03"), true);
eq("b01 多工站", c.isMultiStation("b01"), true);

console.log("== eligibility ==");
const base = { flag: flagA04, role: "operator", availability: "ready", machineCode: "A04", order };
eq("全部符合 → 顯示", c.eligibility(base), { ok: true, reason: "" });
eq("旗標關 → 不顯示", c.eligibility({ ...base, flag: c.parseFlag([]) }).reason, "flag_off");
eq("別台 → 不顯示", c.eligibility({ ...base, machineCode: "A01" }).reason, "flag_off");
eq("planner 不是作業員 → 不顯示（RPC 只收 operator）", c.eligibility({ ...base, role: "planner" }).reason, "not_operator");
eq("沒有角色 → 不顯示", c.eligibility({ ...base, role: "" }).reason, "not_operator");
eq("橋接帳號 → 不顯示", c.eligibility({ ...base, isBridge: true }).reason, "not_operator");
eq("角色大小寫不影響", c.eligibility({ ...base, role: " Operator " }).ok, true);
eq("表還在探測 → 不顯示", c.eligibility({ ...base, availability: "probing" }).reason, "unavailable");
eq("表不存在 → 不顯示", c.eligibility({ ...base, availability: "missing" }).reason, "unavailable");
eq("沒工單 → 不顯示", c.eligibility({ ...base, order: null }).reason, "no_order");
eq("未排機 → 不顯示", c.eligibility({ ...base, isUnassignedBucket: true }).reason, "no_machine");
eq("已離站 → 不顯示", c.eligibility({ ...base, order: { ...order, offStation: true } }).reason, "off_station");
eq("沒有第幾道 → 不顯示（工廠無法核對 IndexSN）", c.eligibility({ ...base, order: { ...order, stationStep: null } }).reason, "no_step");
eq("第 0 道 → 不顯示", c.eligibility({ ...base, order: { ...order, stationStep: 0 } }).reason, "no_step");
eq("多工站沒有 ManufactureII Id → 不顯示", c.eligibility({ ...base, flag: c.parseFlag("*"), machineCode: "B03" }).reason, "multi_station_unsupported");
eq("多工站有 Id → 顯示", c.eligibility({ ...base, flag: c.parseFlag("*"), machineCode: "B03", order: { ...order, manufactureIiId: "123" } }).ok, true);

console.log("== confirmModel ==");
const legacy = { work_order_no: order.id, machine_code: "A04", process_order: 5, legacy_output: 208, legacy_fail: 2, legacy_updated_at: "2026-10-07T01:30:00Z", legacy_synced_at: "2026-10-07T01:35:00Z" };
const m = c.confirmModel({ commandType: "start", machineCode: "a04", order, legacy, otherOrderCount: 2 });
eq("標題", m.title, "確認開工");
eq("確認鈕", m.confirmLabel, "確認開工");
eq("機台大寫", m.machine, "A04");
eq("工單號", m.workOrderNo, "XX01202502050012");
eq("料號", m.partNo, "HCG-06-01");
eq("品名", m.partName, "HCG-06本體");
eq("第幾道", m.stepLabel, "第 5 道");
eq("工序名", m.operationName, "車床加工");
eq("舊 MES 現況照實（台北時間）", m.legacyLines, [
  "舊 MES 這台掛的是這張單的這一道（派工橋同步）",
  "舊 MES 已報：良品 208、不良 2",
  "舊 MES 最後報工：2026-10-07 09:30",
  "派工橋同步時間：2026-10-07 09:35",
  "開工中／停工中：派工橋沒有同步，工廠會在套用前再核對",
]);
eq("還掛別的單 → 提醒", m.otherOrders, "這台還掛 2 張別的單");
eq("不是這張 → 叫他找生管，不換單", m.notThisOrder.includes("請找生管") && m.notThisOrder.includes("不會幫你換單"), true);
const ms = c.confirmModel({ commandType: "stop", machineCode: "A04", order: { ...order, drawing: "-" }, legacy: null });
eq("停工標題", ms.title, "確認停工");
eq("料號是「-」→ 空", ms.partNo, "");
eq("沒有舊 MES 數字 → 照實說", ms.legacyLines[1], "舊 MES 這一道還沒有報工數字");
eq("沒有別的單 → 不提醒", ms.otherOrders, "");
eq("讀不到 → 照實說", c.confirmModel({ commandType: "stop", machineCode: "A04", order, legacyError: true }).legacyLines[1], "舊 MES 報工數字暫時讀不到");
eq("legacyRowFor 挑同單同機台同一道", c.legacyRowFor([{ ...legacy, process_order: 4 }, legacy, { ...legacy, machine_code: "A05" }], { workOrderNo: order.id, machineCode: "a04", step: 5 }).process_order, 5);
eq("legacyRowFor 沒有 → null", c.legacyRowFor([{ ...legacy, process_order: 4 }], { workOrderNo: order.id, machineCode: "A04", step: 5 }), null);

console.log("== submitPayload ==");
eq("合約欄位齊全", c.submitPayload({ commandUuid: UUID, commandType: "start", machineCode: "a04", order }), {
  p_command_uuid: UUID, p_command_type: "start", p_machine_code: "A04", p_expected_order_no: "XX01202502050012",
  p_expected_index_sn: 5, p_expected_part_no: "HCG-06-01", p_manufacture_ii_id: null,
});
eq("多工站帶 Id", c.submitPayload({ commandUuid: UUID, commandType: "stop", machineCode: "B03", order: { ...order, manufactureIiId: "77" } }).p_manufacture_ii_id, "77");
throws("壞 uuid", () => c.submitPayload({ commandUuid: "x", commandType: "start", machineCode: "A04", order }), "BAD_COMMAND_UUID");
throws("不支援的指令（換單）", () => c.submitPayload({ commandUuid: UUID, commandType: "switch", machineCode: "A04", order }), "BAD_COMMAND_TYPE");
throws("沒有第幾道", () => c.submitPayload({ commandUuid: UUID, commandType: "start", machineCode: "A04", order: { ...order, stationStep: null } }), "NO_STEP");
throws("沒有工單", () => c.submitPayload({ commandUuid: UUID, commandType: "start", machineCode: "A04", order: { ...order, id: "" } }), "NO_ORDER");

console.log("== 錯誤分類 ==");
eq("表不存在 PGRST205 → missing", c.isMissingResourceError(new Error('404 {"code":"PGRST205","message":"Could not find the table"}')), true);
eq("函式不存在 PGRST202 → missing", c.submitErrorText(new Error('404 {"code":"PGRST202","message":"Could not find the function"}')).missing, true);
eq("一般 400 不算 missing", c.isMissingResourceError(new Error('400 {"code":"P0001","message":"legacy user not mapped"}')), false);
eq("網路錯誤 → 可重送", c.submitErrorText(new TypeError("Failed to fetch")).retry, true);
eq("沒對到工號 → 白話", c.submitErrorText(new Error('400 {"code":"P0001","message":"legacy user id missing"}')).text, "你的帳號還沒對到舊 MES 工號，請找生管或管理員設定。");
eq("同 uuid 不同內容 → 白話", c.submitErrorText(new Error('409 {"code":"P0001","message":"command_uuid reused with different payload"}')).text, "這筆指令跟之前送過的內容不一樣，請關掉重新按一次。");
const rpcErr = (code) => new Error('400 {"code":"P0001","message":"' + code + ': detail"}');
eq("合約錯誤碼 OPERATOR_LEGACY_ID_MISSING → 白話", c.submitErrorText(rpcErr("OPERATOR_LEGACY_ID_MISSING")).text, c.SUBMIT_ERROR_TEXT.OPERATOR_LEGACY_ID_MISSING);
eq("合約錯誤碼 MACHINE_COMMAND_IN_FLIGHT → 白話、不可重送", [c.submitErrorText(rpcErr("MACHINE_COMMAND_IN_FLIGHT")).text.includes("已經有一筆"), c.submitErrorText(rpcErr("MACHINE_COMMAND_IN_FLIGHT")).retry], [true, false]);
eq("合約錯誤碼 MACHINE_NOT_ALLOWED → 課別", c.submitErrorText(rpcErr("MACHINE_NOT_ALLOWED")).text.includes("課別不符"), true);
eq("合約錯誤碼 OPERATOR_REQUIRED → 只有作業員", c.submitErrorText(rpcErr("OPERATOR_REQUIRED")).text, "只有作業員帳號可以按開工／停工。");
eq("INVALID_* → 資料不完整", c.submitErrorText(rpcErr("INVALID_EXPECTED_INDEX_SN")).text.includes("資料不完整"), true);
eq("合約 §2.1 每個錯誤碼都有白話（INVALID_* 共用一句）", ["AUTH_REQUIRED","TENANT_ACCESS_DENIED","ACCOUNT_DISABLED","OPERATOR_REQUIRED","TENANT_INACTIVE","APP_USER_REQUIRED","OPERATOR_LEGACY_ID_MISSING","COMMAND_UUID_REQUIRED","INVALID_COMMAND_TYPE","INVALID_MACHINE_CODE","INVALID_EXPECTED_ORDER_NO","INVALID_EXPECTED_INDEX_SN","INVALID_EXPECTED_PART_NO","INVALID_MANUFACTURE_II_ID","MACHINE_NOT_ALLOWED","COMMAND_UUID_CONFLICT","MACHINE_COMMAND_IN_FLIGHT"].filter((k) => !c.submitErrorText(rpcErr(k)).text.startsWith("送出失敗")), ["AUTH_REQUIRED","TENANT_ACCESS_DENIED","ACCOUNT_DISABLED","OPERATOR_REQUIRED","TENANT_INACTIVE","APP_USER_REQUIRED","OPERATOR_LEGACY_ID_MISSING","INVALID_COMMAND_TYPE","INVALID_MACHINE_CODE","INVALID_EXPECTED_ORDER_NO","INVALID_EXPECTED_INDEX_SN","INVALID_EXPECTED_PART_NO","INVALID_MANUFACTURE_II_ID","MACHINE_NOT_ALLOWED","COMMAND_UUID_CONFLICT","MACHINE_COMMAND_IN_FLIGHT"]);
eq("其他 → 帶伺服器訊息", c.submitErrorText(new Error('400 {"message":"machine A09 unknown"}')).text, "送出失敗：machine A09 unknown");

console.log("== statusView ==");
eq("pending → 等待", c.statusView({ status: "pending" }, "start"), { phase: "pending", terminal: false, tone: "wait", title: "等待工廠套用…", text: "已送出，等工廠接手。請稍等，不要重按。" });
eq("claimed → 處理中", c.statusView({ status: "claimed" }, "start").title, "工廠處理中…");
eq("applied 開工", c.statusView({ status: "applied" }, "start"), { phase: "applied", terminal: true, tone: "ok", title: "已開工", text: "舊 MES 已開工。" });
eq("applied 停工", c.statusView({ status: "applied" }, "stop").title, "已停工");
const rej = c.statusView({ status: "rejected", reject_code: "ORDER_MISMATCH", reject_message: "Manufacture.OrderNO=XX01202509300001" }, "start");
eq("rejected 工單不符 → 白話＋原因", [rej.phase, rej.terminal, rej.title, rej.text, rej.code, rej.detail], ["rejected", true, "沒有開工", c.REJECT_TEXT.ORDER_MISMATCH, "ORDER_MISMATCH", "Manufacture.OrderNO=XX01202509300001"]);
eq("rejected 未知代碼 → 通用＋代碼", c.statusView({ status: "rejected", reject_code: "WEIRD", reject_message: "x" }, "stop").text, "舊 MES 沒有套用這次指令。");
eq("每個合約拒絕代碼都有白話", ["ORDER_MISMATCH", "STATION_NOT_SET", "OPERATOR_NOT_SET", "ALREADY_RUNNING", "ALREADY_STOPPED", "RMS_UNAVAILABLE", "APS_SIM_NOT_FOUND", "EXPIRED"].every((k) => c.REJECT_TEXT[k]), true);
const exp = c.statusView({ status: "expired" }, "start");
eq("expired → 過期白話", [exp.phase, exp.terminal, exp.title, exp.text], ["expired", true, "已過期", c.REJECT_TEXT.EXPIRED]);
const reqAt = "2026-10-07T02:00:00Z";
eq("pending 未滿 10 分鐘 → 還在等", c.statusView({ status: "pending", requested_at: reqAt }, "start", Date.parse(reqAt) + 9 * 60000).phase, "pending");
eq("pending 超過 10 分鐘 → 直接顯示已過期（合約 §3）", c.statusView({ status: "pending", requested_at: reqAt }, "start", Date.parse(reqAt) + 11 * 60000).phase, "expired");
eq("claimed 超過 10 分鐘 → 不算過期（claimed 不會過期）", c.statusView({ status: "claimed", requested_at: reqAt }, "start", Date.parse(reqAt) + 30 * 60000).phase, "pending");
eq("沒給現在時間 → 不判過期", c.statusView({ status: "pending", requested_at: reqAt }, "start").phase, "pending");
eq("沒有 status → 當等待", c.statusView({}, "start").phase, "pending");

console.log("== 輪詢 ==");
eq("前 30 秒 2 秒一次", c.pollDelay(5000), 2000);
eq("之後 5 秒一次", c.pollDelay(60000), 5000);
eq("12 分鐘內不放棄", c.shouldGiveUp(0, 11 * 60000), false);
eq("超過 12 分鐘放棄", c.shouldGiveUp(0, 13 * 60000), true);
eq("放棄 → 不宣稱成功或失敗", c.giveUpView("start").text.includes("不知道舊 MES 有沒有開工"), true);

console.log("== 等待中鎖（重新整理後）==");
const now = Date.parse("2026-10-07T02:00:00Z");
const rec = c.pendingRecord({ commandUuid: UUID, commandType: "start", machineCode: "a04", orderNo: order.id, step: 5, startedAt: now - 60000 });
eq("pendingRecord", rec, { commandUuid: UUID, commandType: "start", machineCode: "A04", orderNo: order.id, step: 5, startedAt: now - 60000 });
eq("還在等 → 還原", Object.keys(c.restorePending(JSON.stringify({ A04: rec }), now)), ["A04"]);
eq("太舊 → 丟掉", c.restorePending({ A04: { ...rec, startedAt: now - 20 * 60000 } }, now), {});
eq("壞 JSON → 空", c.restorePending("{oops", now), {});
eq("壞資料 → 丟掉", c.restorePending({ A04: { commandUuid: "x", commandType: "start" } }, now), {});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
