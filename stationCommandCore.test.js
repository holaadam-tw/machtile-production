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
const PID = "00000000-0000-4000-8000-000000000304";
const order = { id: "XX01202502050012", processId: PID, part: "HCG-06本體", drawing: "DRW-77", process: "車床加工", stationStep: 5, offStation: false };

console.log("== parseFlag／enabledForMachine ==");
eq("沒設 → 關", c.flagIsOn(c.parseFlag(undefined)), false);
eq("空陣列 → 關", c.flagIsOn(c.parseFlag([])), false);
eq("true 不是合法值 → 關（不誤開全廠）", c.flagIsOn(c.parseFlag(true)), false);
eq("物件 → 關", c.flagIsOn(c.parseFlag({ A04: true })), false);
eq("[\" a04 \"] → 只開 A04", c.parseFlag([" a04 "]), { all: false, machines: ["A04"] });
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

console.log("== eligibility ==");
const base = { flag: flagA04, role: "operator", availability: "ready", machineCode: "A04", order };
eq("全部符合 → 顯示", c.eligibility(base), { ok: true, reason: "" });
eq("旗標關 → 不顯示", c.eligibility({ ...base, flag: c.parseFlag([]) }).reason, "flag_off");
eq("別台 → 不顯示", c.eligibility({ ...base, machineCode: "A01" }).reason, "flag_off");
eq("planner → 不顯示（RPC 只收 operator）", c.eligibility({ ...base, role: "planner" }).reason, "not_operator");
eq("沒有角色 → 不顯示", c.eligibility({ ...base, role: "" }).reason, "not_operator");
eq("橋接帳號 → 不顯示", c.eligibility({ ...base, isBridge: true }).reason, "not_operator");
eq("角色大小寫不影響", c.eligibility({ ...base, role: " Operator " }).ok, true);
eq("表還在探測 → 不顯示", c.eligibility({ ...base, availability: "probing" }).reason, "unavailable");
eq("表不存在 → 不顯示", c.eligibility({ ...base, availability: "missing" }).reason, "unavailable");
eq("沒工單 → 不顯示", c.eligibility({ ...base, order: null }).reason, "no_order");
eq("未排機 → 不顯示", c.eligibility({ ...base, isUnassignedBucket: true }).reason, "no_machine");
eq("已離站 → 不顯示", c.eligibility({ ...base, order: { ...order, offStation: true } }).reason, "off_station");
eq("沒有工序 id → 不顯示（開卡時要重讀）", c.eligibility({ ...base, order: { ...order, processId: "WO-1" } }).reason, "no_process");
eq("沒有第幾道 → 不顯示", c.eligibility({ ...base, order: { ...order, stationStep: null } }).reason, "no_step");
eq("多工站沒有 ManufactureII Id → 不顯示", c.eligibility({ ...base, flag: c.parseFlag("*"), machineCode: "B03" }).reason, "multi_station_unsupported");
eq("多工站有 Id → 顯示", c.eligibility({ ...base, flag: c.parseFlag("*"), machineCode: "B03", order: { ...order, manufactureIiId: "123" } }).ok, true);

console.log("== newUuid ==");
eq("有 randomUUID 就用它", c.newUuid({ randomUUID: () => UUID }), UUID);
const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } };
const fb = c.newUuid(fake);
eq("沒有 randomUUID → getRandomValues 組 v4", [c.isUuid(fb), fb[14], "89ab".includes(fb[19])], [true, "4", true]);
throws("兩個都沒有 → 丟錯", () => c.newUuid({}), "NO_CRYPTO");

console.log("== freshCheck（開卡時重讀工序）==");
const row = { id: PID, process_order: 5, process_name: "CNC車床二序", status: "pending", off_station_at: null,
  work_orders: { work_order_no: order.id, part_no: "HCG-06-01", part_name: "HCG-06本體", status: "in_progress" }, machines: { machine_code: "A04" } };
const fr = c.freshCheck({ order, machineCode: "a04", row });
eq("還在這台、同一道 → ok，料號＝work_orders.part_no", [fr.ok, fr.partNo, fr.partName, fr.operationName], [true, "HCG-06-01", "HCG-06本體", "CNC車床二序"]);
eq("料號空 → null（不拿圖號頂替）", c.freshCheck({ order, machineCode: "A04", row: { ...row, work_orders: { ...row.work_orders, part_no: "" } } }).partNo, null);
eq("讀不到 → 不給送", c.freshCheck({ order, machineCode: "A04", row: null }).reason, "process_not_found");
eq("已離站 → 不給送", c.freshCheck({ order, machineCode: "A04", row: { ...row, off_station_at: "2026-10-07T01:00:00Z" } }).reason, "off_station");
eq("換到別台 → 不給送", c.freshCheck({ order, machineCode: "A04", row: { ...row, machines: { machine_code: "A05" } } }).reason, "machine_changed");
eq("道次變了 → 不給送", c.freshCheck({ order, machineCode: "A04", row: { ...row, process_order: 6 } }).reason, "step_changed");
eq("工單號不同 → 不給送", c.freshCheck({ order, machineCode: "A04", row: { ...row, work_orders: { ...row.work_orders, work_order_no: "X" } } }).reason, "order_changed");
eq("工序已完成 → 不給送", c.freshCheck({ order, machineCode: "A04", row: { ...row, status: "completed" } }).reason, "process_closed");
eq("工單已結案 → 不給送", c.freshCheck({ order, machineCode: "A04", row: { ...row, work_orders: { ...row.work_orders, status: "completed" } } }).reason, "order_closed");
eq("不符時的白話叫他重新整理", c.freshCheck({ order, machineCode: "A04", row: null }).text.includes("請重新整理畫面"), true);

console.log("== confirmModel ==");
const now = Date.parse("2026-10-07T02:00:00Z");
const legacy = { work_order_no: order.id, machine_code: "A04", process_order: 5, legacy_output: 208, legacy_fail: 2, legacy_updated_at: "2026-10-07T01:30:00Z", legacy_snapshot_at: "2026-10-07T01:35:00Z", legacy_synced_at: "2026-10-07T01:59:00Z" };
const m = c.confirmModel({ commandType: "start", machineCode: "a04", order, fresh: fr, legacy, otherOrderCount: 2, nowMs: now });
eq("標題／確認鈕", [m.title, m.confirmLabel], ["確認開工", "確認開工"]);
eq("機台／工單號", [m.machine, m.workOrderNo], ["A04", "XX01202502050012"]);
eq("料號＝重讀的 part_no（不是圖號 DRW-77）", [m.partNo, m.partNoDisplay, m.partName], ["HCG-06-01", "HCG-06-01", "HCG-06本體"]);
eq("第幾道／工序（重讀）", [m.stepLabel, m.operationName], ["第 5 道", "CNC車床二序"]);
eq("舊 MES 現況：畫面資料（legacy_snapshot_at 時分）顯示…，不寫肯定句", m.legacyLines, [
  "畫面資料（09:35）顯示：舊 MES 這台掛的是這張單的第 5 道，工廠套用前會再核對",
  "畫面資料（09:35）顯示：舊 MES 已報 良品 208、不良 2",
  "舊 MES 最後報工：2026-10-07 09:30",
  "開工中／停工中：派工橋沒有同步，工廠會在套用前再核對",
]);
eq("用 legacy_snapshot_at 不用 legacy_synced_at（09:59）", m.legacyLines.join("").includes("09:59"), false);
eq("不同天 → 加月/日", c.legacyStateLines({ order, legacy: { ...legacy, legacy_snapshot_at: "2026-10-05T01:35:00Z" }, nowMs: now })[0].startsWith("畫面資料（10/5 09:35）"), true);
eq("沒有舊 MES 列 → 時間不明", c.legacyStateLines({ order, legacy: null, nowMs: now })[0].startsWith("畫面資料（時間不明）顯示"), true);
eq("還掛別的單 → 提醒", m.otherOrders, "這台還掛 2 張別的單");
eq("不是這張 → 找生管、不換單", m.notThisOrder.includes("請找生管") && m.notThisOrder.includes("不會幫你換單"), true);
const noPart = c.confirmModel({ commandType: "stop", machineCode: "A04", order, fresh: { ...fr, partNo: null } });
eq("沒有料號 → 顯示「未提供」、送 null", [noPart.partNoDisplay, noPart.partNo], ["未提供", ""]);
eq("讀不到 → 照實說", c.confirmModel({ commandType: "stop", machineCode: "A04", order, legacyError: true }).legacyLines[1], "舊 MES 報工數字暫時讀不到");
eq("legacyRowFor 挑同單同機台同一道", c.legacyRowFor([{ ...legacy, process_order: 4 }, legacy], { workOrderNo: order.id, machineCode: "a04", step: 5 }).process_order, 5);

console.log("== submitPayload ==");
eq("合約欄位齊全", c.submitPayload({ commandUuid: UUID, commandType: "start", machineCode: "a04", orderNo: order.id, step: 5, partNo: "HCG-06-01" }), {
  p_command_uuid: UUID, p_command_type: "start", p_machine_code: "A04", p_expected_order_no: "XX01202502050012",
  p_expected_index_sn: 5, p_expected_part_no: "HCG-06-01", p_manufacture_ii_id: null,
});
eq("料號沒有 → null", c.submitPayload({ commandUuid: UUID, commandType: "start", machineCode: "A04", orderNo: "X", step: 1, partNo: null }).p_expected_part_no, null);
eq("多工站帶 Id", c.submitPayload({ commandUuid: UUID, commandType: "stop", machineCode: "B03", orderNo: "X", step: 1, manufactureIiId: "77" }).p_manufacture_ii_id, "77");
throws("壞 uuid", () => c.submitPayload({ commandUuid: "x", commandType: "start", machineCode: "A04", orderNo: "X", step: 1 }), "BAD_COMMAND_UUID");
throws("不支援的指令（換單）", () => c.submitPayload({ commandUuid: UUID, commandType: "switch", machineCode: "A04", orderNo: "X", step: 1 }), "BAD_COMMAND_TYPE");
throws("沒有第幾道", () => c.submitPayload({ commandUuid: UUID, commandType: "start", machineCode: "A04", orderNo: "X", step: null }), "NO_STEP");
throws("沒有工單", () => c.submitPayload({ commandUuid: UUID, commandType: "start", machineCode: "A04", orderNo: "", step: 1 }), "NO_ORDER");

console.log("== 錯誤分類 ==");
eq("表不存在 PGRST205 → missing", c.isMissingResourceError(new Error('404 {"code":"PGRST205","message":"Could not find the table"}')), true);
eq("函式不存在 PGRST202 → missing", c.submitErrorText(new Error('404 {"code":"PGRST202","message":"Could not find the function"}')).missing, true);
eq("一般 400 不算 missing", c.isMissingResourceError(new Error('400 {"code":"P0001","message":"MACHINE_NOT_ALLOWED"}')), false);
eq("網路錯誤 → 可重送", c.submitErrorText(new TypeError("Failed to fetch")).retry, true);
const abortErr = new Error("signal is aborted without reason"); abortErr.name = "AbortError";
eq("逾時（AbortError）→ 可重送", c.submitErrorText(abortErr).retry, true);
eq("逾時（abort(new Error('timeout'))）→ 可重送", c.submitErrorText(new Error("timeout")).retry, true);
const rpcErr = (code) => new Error('400 {"code":"P0001","message":"' + code + ': detail"}');
const ALL = ["AUTH_REQUIRED","TENANT_ACCESS_DENIED","ACCOUNT_DISABLED","OPERATOR_REQUIRED","APPLIER_CANNOT_SUBMIT","TENANT_INACTIVE","APP_USER_REQUIRED","OPERATOR_LEGACY_ID_MISSING","OPERATOR_LEGACY_ID_INVALID","COMMAND_UUID_REQUIRED","INVALID_COMMAND_TYPE","INVALID_MACHINE_CODE","INVALID_EXPECTED_ORDER_NO","INVALID_EXPECTED_INDEX_SN","INVALID_EXPECTED_PART_NO","INVALID_MANUFACTURE_II_ID","MACHINE_NOT_ALLOWED","COMMAND_UUID_CONFLICT","MACHINE_COMMAND_IN_FLIGHT"];
eq("合約 r3 §3.1 每個 submit 錯誤碼都有白話、都不可重送", ALL.filter((k) => { const r = c.submitErrorText(rpcErr(k)); return r.text.startsWith("送出失敗") || r.retry; }), []);
eq("MACHINE_COMMAND_IN_FLIGHT → 白話", c.submitErrorText(rpcErr("MACHINE_COMMAND_IN_FLIGHT")).text.includes("已經有一筆"), true);
eq("APPLIER_CANNOT_SUBMIT → 用作業員帳號", c.submitErrorText(rpcErr("APPLIER_CANNOT_SUBMIT")).text.includes("作業員帳號"), true);
eq("錯誤碼要整個字（OPERATOR_REQUIREDX 不算）", c.errorCodeOf("OPERATOR_REQUIRED: x"), "OPERATOR_REQUIRED");
eq("其他 → 帶伺服器訊息", c.submitErrorText(new Error('400 {"message":"machine A09 unknown"}')).text, "送出失敗：machine A09 unknown");

console.log("== statusView（結果只看伺服器 status）==");
eq("pending → 等待", c.statusView({ status: "pending" }, "start", null), { phase: "pending", terminal: false, tone: "wait", title: "等待工廠套用…", text: "已送出，等工廠接手。請稍等，不要重按。", late: false });
eq("claimed → 工廠處理中", c.statusView({ status: "claimed" }, "start", 1000).title, "工廠處理中…");
eq("applied 開工", c.statusView({ status: "applied" }, "start"), { phase: "applied", terminal: true, tone: "ok", title: "已開工", text: "舊 MES 已開工。" });
eq("applied 停工", c.statusView({ status: "applied" }, "stop").title, "已停工");
const rej = c.statusView({ status: "rejected", reject_code: "ORDER_MISMATCH", reject_message: "Manufacture.OrderNO=XX01202509300001" }, "start");
eq("rejected 工單不符 → 白話＋原因", [rej.phase, rej.terminal, rej.title, rej.text, rej.code, rej.detail], ["rejected", true, "沒有開工", c.REJECT_TEXT.ORDER_MISMATCH, "ORDER_MISMATCH", "Manufacture.OrderNO=XX01202509300001"]);
const exp = c.statusView({ status: "expired", reject_code: "EXPIRED" }, "start");
eq("expired（伺服器給的）→ 已過期", [exp.phase, exp.terminal, exp.title], ["expired", true, "已過期"]);
const stale = c.statusView({ status: "rejected", reject_code: "STALE_COMMAND", reject_message: "not applied within 180s" }, "start");
eq("rejected/STALE_COMMAND → 已作廢＋指定白話", [stale.terminal, stale.title, stale.text], [true, "已作廢", "太久沒套用，舊 MES 沒動，請重按"]);
const rel = c.statusView({ status: "rejected", reject_code: "MANUAL_RELEASED", reject_message: "舊 MES 狀態未知，請人工核對" }, "stop");
eq("rejected/MANUAL_RELEASED → 主管已取消＋不確定舊 MES", [rel.title, rel.text, rel.detail], ["主管已取消", "主管已取消這筆；舊 MES 是否已改變不確定，請先看機台電子紙或問生管，再決定要不要重按", "舊 MES 狀態未知，請人工核對"]);
const lateApplied = c.statusView({ status: "rejected", reject_code: "LEGACY_APPLIED_LATE", reject_message: "ChangeStatus ok at 09:03:10" }, "start");
eq("rejected/LEGACY_APPLIED_LATE → 舊 MES 已改（不說沒生效）", [lateApplied.title, lateApplied.text, lateApplied.tone], ["舊 MES 已改（回報太晚）", "舊 MES 已經改了，但回報太晚；不要再按，請看機台電子紙或問生管核對", "warn"]);
eq("LEGACY_APPLIED_LATE 文案沒有「沒有生效」", /沒有生效|沒生效|沒有開工/.test(lateApplied.title + lateApplied.text), false);
eq("rejected 未知代碼 → 通用", c.statusView({ status: "rejected", reject_code: "WEIRD" }, "stop").text, "舊 MES 沒有套用這次指令。");
eq("每個工廠拒絕代碼都有白話", ["ORDER_MISMATCH", "STATION_NOT_SET", "OPERATOR_NOT_SET", "ALREADY_RUNNING", "ALREADY_STOPPED", "RMS_UNAVAILABLE", "APS_SIM_NOT_FOUND", "STALE_COMMAND", "LEGACY_APPLIED_LATE", "MANUAL_RELEASED", "EXPIRED"].every((k) => c.REJECT_TEXT[k]), true);
const lateP = c.statusView({ status: "pending" }, "start", 4 * 60000);
eq("pending 超過 3 分鐘（伺服器時間）→ 仍是等待中（不是結果），加提示", [lateP.phase, lateP.terminal, lateP.late, lateP.text], ["pending", false, true, "工廠還沒處理，這筆應該不會生效；請等最終結果或問生管"]);
const lateC = c.statusView({ status: "claimed" }, "start", 30 * 60000);
eq("claimed 超過 3 分鐘 → 仍是工廠處理中＋提示", [lateC.title, lateC.terminal, lateC.late], ["工廠處理中…", false, true]);
eq("沒有年齡 → 不加提示", c.statusView({ status: "pending" }, "start", null).late, false);
eq("3 分鐘內 → 不加提示", c.statusView({ status: "pending" }, "start", 170000).late, false);

console.log("== 伺服器時鐘差（不用平板時鐘直接判斷）==");
const reqAt = "2026-10-07T02:00:00Z";
const tabletFast = Date.parse(reqAt) + 5 * 60000;   // 平板快 5 分鐘，送出回來那一刻
const off = c.serverOffset(reqAt, tabletFast);
eq("時鐘差＝平板－伺服器", off, 300000);
eq("平板快 5 分鐘、剛送出 10 秒 → 伺服器年齡 10 秒（不會誤判過 3 分鐘）", c.serverAgeMs(reqAt, off, tabletFast + 10000), 10000);
eq("沒有時鐘差 → null", c.serverAgeMs(reqAt, null, tabletFast), null);
eq("ageForHint：有時鐘差用伺服器年齡", c.ageForHint({ serverOffset: off, startedAt: tabletFast - 1000 }, reqAt, tabletFast + 10000), 10000);
eq("ageForHint：沒有時鐘差用按下後的本機經過時間", c.ageForHint({ serverOffset: null, startedAt: 1000 }, reqAt, 61000), 60000);

console.log("== 輪詢與解鎖（App 不自己結束）==");
eq("前 30 秒 2 秒一次", c.pollDelay(5000), 2000);
eq("之後 5 秒一次", c.pollDelay(60000), 5000);
eq("解鎖後 15 秒一次（照樣輪詢）", c.pollDelay(c.CLIENT_UNLOCK_MS + 1), 15000);
eq("解鎖＝伺服器 pending 10 分鐘＋1 分鐘", c.CLIENT_UNLOCK_MS, 11 * 60000);
eq("10 分鐘內不解鎖", c.lockReleased(0, 10 * 60000), false);
eq("11 分鐘後解鎖", c.lockReleased(0, 11 * 60000 + 1), true);
eq("沒有「自己判結束」的函式", [typeof c.giveUpView, typeof c.shouldGiveUp], ["undefined", "undefined"]);
eq("合約常數", [c.MAX_APPLY_AGE_MS, c.CLAIM_LEASE_MS, c.PENDING_EXPIRE_MS], [180000, 120000, 600000]);
eq("送出逾時 20 秒", c.SUBMIT_TIMEOUT_MS, 20000);

console.log("== 等待中紀錄（重新整理後）==");
const rec = c.pendingRecord({ commandUuid: UUID, commandType: "start", machineCode: "a04", orderNo: order.id, step: 5, partNo: "HCG-06-01", partName: "HCG-06本體", operationName: "CNC車床二序", startedAt: now - 60000, unconfirmed: true, serverOffset: null });
eq("pendingRecord 保留 unconfirmed 與重送需要的欄位", [rec.machineCode, rec.unconfirmed, rec.partNo, rec.step, rec.serverOffset], ["A04", true, "HCG-06-01", 5, null]);
const restored = c.restorePending(JSON.stringify({ A04: rec }), now);
eq("重新整理後 unconfirmed 還在", restored.A04 && restored.A04.unconfirmed, true);
eq("時鐘差也還在", c.restorePending(JSON.stringify({ A04: { ...rec, serverOffset: 1234 } }), now).A04.serverOffset, 1234);
eq("超過一天 → 丟掉", c.restorePending({ A04: { ...rec, startedAt: now - 25 * 3600000 } }, now), {});
eq("十幾分鐘前的還在（不再 12 分鐘就丟）", Object.keys(c.restorePending({ A04: { ...rec, startedAt: now - 20 * 60000 } }, now)), ["A04"]);
eq("壞 JSON → 空", c.restorePending("{oops", now), {});
eq("壞資料 → 丟掉", c.restorePending({ A04: { commandUuid: "x", commandType: "start" } }, now), {});
eq("unconfirmed：查不到 3 次且過 10 秒＝沒送到", c.unconfirmedNotSent({ unconfirmed: true, emptyPolls: 3, startedAt: 0 }, 10000), true);
eq("unconfirmed：查不到 2 次還不能下結論", c.unconfirmedNotSent({ unconfirmed: true, emptyPolls: 2, startedAt: 0 }, 60000), false);
eq("已確認的紀錄不適用", c.unconfirmedNotSent({ unconfirmed: false, emptyPolls: 9, startedAt: 0 }, 60000), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
