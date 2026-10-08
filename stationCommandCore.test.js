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

console.log("== 管理員也能按（owner 2026-10-08 方案 C）==");
eq("admin → 顯示", c.eligibility({ ...base, role: "admin" }), { ok: true, reason: "" });
eq("admin 大小寫／空白不影響", c.eligibility({ ...base, role: " Admin " }).ok, true);
eq("admin＋橋接 → 不顯示", c.eligibility({ ...base, role: "admin", isBridge: true }).reason, "not_operator");
eq("operator＋橋接 → 不顯示", c.roleAllowed("operator", true), false);
eq("manager → 不顯示（D4b 先只開 admin）", c.eligibility({ ...base, role: "manager" }).reason, "not_operator");
eq("planner → 不顯示", c.roleAllowed("planner", false), false);
eq("roleAllowed：admin／operator 可，manager／planner／空／supervisor 不可", ["admin", "operator", "manager", "planner", "", "supervisor"].map((r) => c.roleAllowed(r, false)), [true, true, false, false, false, false]);
eq("SUBMIT_ROLES 恰好 operator＋admin", c.SUBMIT_ROLES, ["operator", "admin"]);
eq("isAdminActor：admin 是、橋接 admin 不是、operator 不是", [c.isAdminActor("admin", false), c.isAdminActor("admin", true), c.isAdminActor("operator", false)], [true, false, false]);
eq("admin 也要旗標開", c.eligibility({ ...base, role: "admin", flag: c.parseFlag([]) }).reason, "flag_off");
eq("admin 也要功能可用", c.eligibility({ ...base, role: "admin", availability: "missing" }).reason, "unavailable");
eq("actorLines：管理員兩行", c.actorLines("admin", "Adam"), ["你是管理員 Adam，這筆會記成你按的", "你不在機台旁，請先確認現場狀況"]);
eq("actorLines：沒有名字也不寫空白", c.actorLines("admin", " ")[0], "你是管理員，這筆會記成你按的");
eq("actorLines：作業員沒有", c.actorLines("operator", "王小明"), []);

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

const adminModel = c.confirmModel({ commandType: "start", machineCode: "A04", order, fresh: fr, legacy, nowMs: now, actorRole: "admin", actorName: "Adam" });
eq("confirmModel 管理員 → isAdmin＋兩行", [adminModel.isAdmin, adminModel.adminLines], [true, ["你是管理員 Adam，這筆會記成你按的", "你不在機台旁，請先確認現場狀況"]]);
eq("confirmModel 作業員（沒傳角色）→ 沒有管理員字樣", [m.isAdmin, m.adminLines], [false, []]);
eq("confirmModel 管理員：其他欄位跟作業員一樣", (({ isAdmin, adminLines, ...rest }) => rest)(adminModel), (({ isAdmin, adminLines, ...rest }) => rest)(c.confirmModel({ commandType: "start", machineCode: "A04", order, fresh: fr, legacy, nowMs: now })));

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

eq("ADMIN_LEGACY_ID_MISSING → 白話、不可重送", (({ retry, code, text }) => ({ retry, code, text }))(c.submitErrorText(rpcErr("ADMIN_LEGACY_ID_MISSING"))), { retry: false, code: "ADMIN_LEGACY_ID_MISSING", text: "管理員帳號還沒對應舊 MES 工號，請找 Claude 設定" });
eq("ADMIN_SUBMIT_DISABLED → 白話、不可重送", (({ retry, code, text }) => ({ retry, code, text }))(c.submitErrorText(rpcErr("ADMIN_SUBMIT_DISABLED"))), { retry: false, code: "ADMIN_SUBMIT_DISABLED", text: "管理員開工／停工尚未開放" });
eq("FORBIDDEN → 中文白話、不可重送", (({ retry, code, text }) => ({ retry, code, text }))(c.submitErrorText(rpcErr("FORBIDDEN"))), { retry: false, code: "FORBIDDEN", text: "這個管理員帳號的角色資料不一致，請找管理員檢查。" });

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
const weird = c.statusView({ status: "rejected", reject_code: "WEIRD" }, "stop");
eq("rejected 未知代碼 → 保守：不說沒生效，請核對", [weird.title, weird.text, weird.tone], ["結果待核對", "沒有完成，舊 MES 狀態請核對", "warn"]);
eq("rejected 沒動清單內但沒專用文案（LOCK_TIMEOUT）→ 沒有停工＋通用沒套用", (() => { const v = c.statusView({ status: "rejected", reject_code: "LOCK_TIMEOUT" }, "stop"); return [v.title, v.text, v.tone]; })(), ["沒有停工", "舊 MES 沒有套用這次指令。", "bad"]);
eq("每個工廠拒絕代碼都有白話", ["ORDER_MISMATCH", "STATION_NOT_SET", "OPERATOR_NOT_SET", "ALREADY_RUNNING", "ALREADY_STOPPED", "RMS_UNAVAILABLE", "APS_SIM_NOT_FOUND", "STALE_COMMAND", "LEGACY_APPLIED_LATE", "MANUAL_RELEASED", "EXPIRED",
  "NEED_PAUSED", "LEGACY_PARTIAL_WRITE", "ORDER_CHANGED_DURING_APPLY", "OPERATOR_LIST_TOO_LONG"].every((k) => c.REJECT_TEXT[k]), true);
const opNotSet = c.statusView({ status: "rejected", reject_code: "OPERATOR_NOT_SET" }, "start");
eq("P3-b OPERATOR_NOT_SET → 「這台還沒設定好作業員」，不說「你還沒掛在名單」", [opNotSet.title, opNotSet.text, /你還沒掛/.test(opNotSet.text)], ["沒有開工", "舊 MES 這台還沒設定好作業員，請找生管。", false]);
const rv = (code) => c.statusView({ status: "rejected", reject_code: code, reject_message: "detail-" + code }, "start");
const needPaused = rv("NEED_PAUSED");
eq("#785 NEED_PAUSED（舊 MES 沒動）→ 沒有開工＋「這張單暫停中，請問生管」", [needPaused.title, needPaused.text, needPaused.tone, needPaused.detail], ["沒有開工", "這張單暫停中，請問生管", "bad", "detail-NEED_PAUSED"]);
const tooLong = rv("OPERATOR_LIST_TOO_LONG");
eq("#785 OPERATOR_LIST_TOO_LONG（舊 MES 沒動）→ 沒有開工＋白話", [tooLong.title, tooLong.text], ["沒有開工", "這台的作業員名單太長，請生管先整理名單"]);
const partial = rv("LEGACY_PARTIAL_WRITE");
eq("#785 LEGACY_PARTIAL_WRITE（舊 MES 已改）→ 舊 MES 已改一部分＋白話", [partial.title, partial.text, partial.tone], ["舊 MES 已改一部分", "舊 MES 已經改了一部分，請看機台電子紙或問生管核對", "warn"]);
const swapped = rv("ORDER_CHANGED_DURING_APPLY");
eq("#785 ORDER_CHANGED_DURING_APPLY（舊 MES 已改）→ 白話", [swapped.title, swapped.text, swapped.tone], ["舊 MES 已改（單剛好被換）", "套用時機台上的單剛好被換了，舊 MES 已經改了，請問生管核對", "warn"]);
eq("舊 MES 已改的代碼（3 個）標題與內文都不說「沒生效／沒有開工」", c.LEGACY_CHANGED_CODES.filter((k) => { const v = rv(k); return /沒有生效|沒生效|沒有開工|沒有停工|沒動/.test(v.title + v.text); }), []);
eq("舊 MES 已改的代碼都有專用標題", c.LEGACY_CHANGED_CODES.every((k) => c.REJECT_TITLE[k]), true);
// L3 P2-1：OUTCOME_UNKNOWN／INTERNAL_ERROR＝不確定 → 標題「結果不確定」，內文叫人先看電子紙或問生管，不說沒生效
["OUTCOME_UNKNOWN", "INTERNAL_ERROR"].forEach((k) => {
  for (const type of ["start", "stop"]) {
    const v = c.statusView({ status: "rejected", reject_code: k, reject_message: "detail-" + k }, type);
    eq(`${k}（${type}）→ 結果不確定、warn`, [v.title, v.tone], ["結果不確定", "warn"]);
    eq(`${k}（${type}）→ 內文叫人看電子紙或問生管`, /電子紙/.test(v.text) && /生管/.test(v.text) && /不確定/.test(v.text), true);
    eq(`${k}（${type}）→ 不說沒生效／沒有開工停工／沒動`, /沒有生效|沒生效|沒有開工|沒有停工|沒動|沒有套用/.test(v.title + v.text), false);
  }
});
// L3 P2-1：不在「舊 MES 沒動」清單的代碼，標題不可以用「沒有」開頭（含未知代碼、伺服器保留碼）
{
  const probe = [...new Set([...Object.keys(c.REJECT_TEXT), ...Object.keys(c.REJECT_TITLE), ...c.LEGACY_CHANGED_CODES, ...c.LEGACY_UNTOUCHED_CODES,
    "OUTCOME_UNKNOWN", "INTERNAL_ERROR", "WEIRD", "SOME_FUTURE_CODE", ""])];
  const bad = [];
  for (const k of probe) for (const type of ["start", "stop"]) {
    const v = c.statusView({ status: "rejected", reject_code: k }, type);
    if (!c.LEGACY_UNTOUCHED_CODES.includes(v.code) && /^沒有/.test(v.title)) bad.push(`${k}/${type}:${v.title}`);
  }
  eq("不在沒動清單的代碼，標題都不以「沒有」開頭", bad, []);
  eq("沒動清單和已改清單沒有交集", c.LEGACY_UNTOUCHED_CODES.filter((k) => c.LEGACY_CHANGED_CODES.includes(k)), []);
  eq("沒動清單不含不確定代碼", ["OUTCOME_UNKNOWN", "INTERNAL_ERROR", "MANUAL_RELEASED", "EXPIRED"].filter((k) => c.LEGACY_UNTOUCHED_CODES.includes(k)), []);
  eq("L3 列的沒動代碼都在清單內", ["ORDER_MISMATCH", "ALREADY_RUNNING", "ALREADY_STOPPED", "STALE_COMMAND", "RMS_UNAVAILABLE", "NEED_PAUSED", "OPERATOR_LIST_TOO_LONG",
    "STATION_NOT_SET", "OPERATOR_NOT_SET", "APS_SIM_NOT_FOUND", "LABEL_DATA_INVALID", "LEGACY_REJECTED", "WRITE_TARGET_DENIED", "LOCK_TIMEOUT"].every((k) => c.LEGACY_UNTOUCHED_CODES.includes(k)), true);
}
// 管理員新代碼：寫入前就拒絕＝舊 MES 沒動 → 在沒動清單、不在已改／不確定清單
for (const k of ["ADMIN_LEGACY_ID_MISSING", "ADMIN_SUBMIT_DISABLED"]) {
  eq(`${k} 在沒動清單`, c.LEGACY_UNTOUCHED_CODES.includes(k), true);
  eq(`${k} 不在已改清單`, c.LEGACY_CHANGED_CODES.includes(k), false);
  const v = c.statusView({ status: "rejected", reject_code: k }, "start");
  eq(`${k} 萬一出現在 reject_code → 沒有開工＋同一句白話`, [v.title, v.text, v.tone], ["沒有開工", c.SUBMIT_ERROR_TEXT[k], "bad"]);
}
eq("REJECT_TEXT 與 SUBMIT_ERROR_TEXT 的管理員文字一致", ["ADMIN_LEGACY_ID_MISSING", "ADMIN_SUBMIT_DISABLED"].every((k) => c.REJECT_TEXT[k] === c.SUBMIT_ERROR_TEXT[k]), true);
const lateP = c.statusView({ status: "pending" }, "start", 4 * 60000);
eq("pending 超過 3 分鐘（伺服器時間）→ 仍是等待中（不是結果），加提示", [lateP.phase, lateP.terminal, lateP.late, lateP.text], ["pending", false, true, "工廠還沒處理，這筆應該不會生效；請等最終結果或問生管"]);
const lateC = c.statusView({ status: "claimed" }, "start", 30 * 60000);
eq("claimed 超過 3 分鐘 → 仍是工廠處理中＋提示", [lateC.title, lateC.terminal, lateC.late], ["工廠處理中…", false, true]);
eq("claimed 超過 3 分鐘 → 不說「不會生效」（工廠可能已經動了舊 MES）", lateC.text, "工廠正在處理，結果還沒回來；請等最終結果或問生管");
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
eq("unconfirmed：查不到 3 次但才 10 秒 → 還不解鎖", c.unconfirmedNotSent({ unconfirmed: true, emptyPolls: 3, startedAt: 0 }, 10000), false);
eq("unconfirmed：查不到 3 次且過 30 秒 → 解鎖", c.unconfirmedNotSent({ unconfirmed: true, emptyPolls: 3, startedAt: 0 }, 30000), true);
eq("unconfirmed：過 60 秒但只查不到 2 次 → 還不解鎖", c.unconfirmedNotSent({ unconfirmed: true, emptyPolls: 2, startedAt: 0 }, 60000), false);
eq("解鎖後最後狀態 pending → 可以再按", c.releasedNote("pending"), { unlock: true, text: "可以再按；伺服器會先把太舊的這筆作廢" });
eq("解鎖後最後狀態不明 → 當 pending", c.releasedNote(null).unlock, true);
eq("解鎖後最後狀態 claimed → 工廠還在處理上一筆、不解鎖", c.releasedNote("claimed"), { unlock: false, text: "工廠還在處理上一筆，請等結果或問生管" });
eq("lastStatus 會存（pending／claimed）", [c.pendingRecord({ ...rec, lastStatus: "claimed" }).lastStatus, c.pendingRecord({ ...rec, lastStatus: "weird" }).lastStatus], ["claimed", null]);
eq("已確認的紀錄不適用", c.unconfirmedNotSent({ unconfirmed: false, emptyPolls: 9, startedAt: 0 }, 60000), false);

console.log("== 開工時一起填今日開工數量（owner 2026-10-08）==");
eq("空白 → 跟報工今日開工同一句", c.dailyStartQtyCheck(""), { ok: false, text: "請填寫目前機台已加工數量。" });
eq("null／空白字元 → 必填", [c.dailyStartQtyCheck(null).ok, c.dailyStartQtyCheck("   ").ok], [false, false]);
eq("0 可以（min=0）", c.dailyStartQtyCheck("0"), { ok: true, value: 0 });
eq("正整數", c.dailyStartQtyCheck("1234"), { ok: true, value: 1234 });
eq("沒有上限（表單沒有 max）", c.dailyStartQtyCheck("99999999"), { ok: true, value: 99999999 });
eq("負數 → 擋", c.dailyStartQtyCheck("-1"), { ok: false, text: "機台目前加工數量要填 0 或正整數。" });
eq("小數 → 擋（step 預設 1）", c.dailyStartQtyCheck("12.5").ok, false);
eq("非數字 → 擋", c.dailyStartQtyCheck("abc").ok, false);
eq("數字型別也可", c.dailyStartQtyCheck(208), { ok: true, value: 208 });
const todayRows = [
  { process_id: PID, report_type: "noon" },
  { process_id: "00000000-0000-4000-8000-000000000301", report_type: "dailyStart" },
];
eq("只有別道的今日開工、這道只有中午 → 還沒記", c.dailyStartRecordedToday(todayRows, PID), false);
eq("這道有今日開工 → 已記", c.dailyStartRecordedToday([...todayRows, { process_id: PID, report_type: "dailyStart" }], PID), true);
eq("收工不算今日開工", c.dailyStartRecordedToday([{ process_id: PID, report_type: "finish" }], PID), false);
eq("rows 不是陣列 → 當沒記", c.dailyStartRecordedToday(null, PID), false);
const ask = (o) => c.askDailyStart({ commandType: "start", role: "operator", isBridge: false, todayStatus: "ok", rows: [], processId: PID, ...o });
eq("作業員＋開工＋今天還沒記 → 問", ask({}), true);
eq("停工 → 不問", ask({ commandType: "stop" }), false);
eq("管理員 → 不問", ask({ role: "admin" }), false);
eq("橋接帳號 → 不問", ask({ isBridge: true }), false);
eq("manager／planner → 不問", [ask({ role: "manager" }), ask({ role: "planner" })], [false, false]);
eq("今天已記 → 不問", ask({ rows: [{ process_id: PID, report_type: "dailyStart" }] }), false);
eq("今天的紀錄讀不到（error／idle）→ 不問", [ask({ todayStatus: "error" }), ask({ todayStatus: "idle" })], [false, false]);
eq("沒有工序 id → 不問", ask({ processId: "" }), false);
eq("角色大小寫／空白不影響", ask({ role: " Operator " }), true);
eq("沒存到的提示", c.DAILY_START_FAILED_TEXT, "今日開工數量沒存到，請到報工→今日開工補填");
eq("欄位名稱", c.DAILY_START_FIELD_LABEL, "機台目前加工數量（今日開工）");
const WO = "00000000-0000-4000-8000-000000000104";
const dsOk = { qty: 208, processId: PID, workOrderId: WO, tenantId: "t1", processStatus: "pending" };
eq("暫存今日開工：正常", c.pendingDailyStart(dsOk), { qty: 208, processId: PID, workOrderId: WO, tenantId: "t1", processStatus: "pending", reportUuid: null });
eq("暫存今日開工：0 可以", c.pendingDailyStart({ ...dsOk, qty: 0 }).qty, 0);
eq("暫存今日開工：負數／小數／空白／null → 丟掉", [c.pendingDailyStart({ ...dsOk, qty: -1 }), c.pendingDailyStart({ ...dsOk, qty: 1.5 }), c.pendingDailyStart({ ...dsOk, qty: "" }), c.pendingDailyStart({ ...dsOk, qty: null })], [null, null, null, null]);
eq("暫存今日開工：工序 id 壞 → 丟掉", c.pendingDailyStart({ ...dsOk, processId: "x" }), null);
eq("暫存今日開工：沒有 → null", c.pendingDailyStart(undefined), null);
eq("pendingRecord 帶著今日開工數量", c.pendingRecord({ ...rec, dailyStart: dsOk }).dailyStart.qty, 208);
eq("pendingRecord 沒帶 → null", c.pendingRecord(rec).dailyStart, null);
eq("重新整理後還記得數量", c.restorePending(JSON.stringify({ A04: { ...rec, startedAt: now, dailyStart: dsOk } }), now).A04.dailyStart.qty, 208);
eq("指令被接受（pending／claimed／applied）→ 寫", ["pending", "claimed", "applied"].map(c.delayedDailyStartAction), ["write", "write", "write"]);
eq("被拒／過期 → 丟掉", ["rejected", "expired"].map(c.delayedDailyStartAction), ["discard", "discard"]);
eq("不明狀態 → 等", c.delayedDailyStartAction("weird"), "wait");
eq("排入待送的提示", c.DAILY_START_QUEUED_TEXT, "今日開工數量已排入待送，連線後會自動送出，請不要再補填");
eq("報工擋第二筆的提示", c.dailyStartBlockedText(208), "今日開工已排入待送（數量 208），不用再填");
eq("暫存今日開工：report_uuid 跟著存", c.pendingDailyStart({ ...dsOk, reportUuid: "ABCDEF01-2345-4678-89ab-0123456789ab" }).reportUuid, "abcdef01-2345-4678-89ab-0123456789ab");
eq("暫存今日開工：壞 report_uuid → null", c.pendingDailyStart({ ...dsOk, reportUuid: "x" }).reportUuid, null);
eq("台灣日期（UTC 16:30 已是隔天）", [c.taiwanDay(Date.parse("2026-10-07T16:30:00Z")), c.taiwanDay(Date.parse("2026-10-07T15:59:00Z"))], ["2026-10-08", "2026-10-07"]);
const ruArgs = { tenantId: "t1", machineCode: "A04", processId: PID, commandUuid: UUID, day: "2026-10-08" };
const ru = c.dailyStartReportUuid(ruArgs);
eq("今日開工 report_uuid：合法 UUID（第 8 版、RFC variant）", /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ru) && c.isUuid(ru), true);
eq("今日開工 report_uuid：同樣輸入永遠同一個（機台代號大小寫不影響）", [c.dailyStartReportUuid(ruArgs), c.dailyStartReportUuid({ ...ruArgs, machineCode: "a04" })], [ru, ru]);
eq("今日開工 report_uuid：換機台／工序／日期／指令／租戶就不同", new Set([ru,
  c.dailyStartReportUuid({ ...ruArgs, machineCode: "A05" }), c.dailyStartReportUuid({ ...ruArgs, processId: WO }),
  c.dailyStartReportUuid({ ...ruArgs, day: "2026-10-09" }), c.dailyStartReportUuid({ ...ruArgs, commandUuid: PID }),
  c.dailyStartReportUuid({ ...ruArgs, tenantId: "t2" })]).size, 6);
eq("結果不確定的提示", c.DAILY_START_UNCONFIRMED_TEXT, "今日開工可能已送出，請稍等卡片底部更新；若 2 分鐘後仍顯示未開工再補填");
eq("報工擋伺服器已有的提示", c.DAILY_START_ALREADY_TEXT, "今天已有今日開工紀錄");
eq("重讀讀不到：確認卡提示", c.DAILY_START_RETRY_TEXT, "暫時查不到伺服器，今日開工數量先存在這台平板，會自動再試；請不要補填");
eq("重讀讀不到：報工提示", c.DAILY_START_UNREADABLE_TEXT, "暫時查不到伺服器今天的紀錄，請稍後再送");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
