// 純邏輯測試，無相依：repo 根目錄執行 `node batchReportCore.test.js`
const c = require("./batchReportCore.js");
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got  " + g + "\n        want " + w); }
};

console.log("== groups ==");
eq("車床 A01–A05", c.GROUPS.lathe.machines, ["A01", "A02", "A03", "A04", "A05"]);
eq("銑床只放 B03–B06", c.GROUPS.mill.machines, ["B03", "B04", "B05", "B06"]);
eq("B01/B02 不在任何批次組", Object.values(c.GROUPS).some((g) => g.machines.includes("B01") || g.machines.includes("B02")), false);
eq("view → group", c.groupForView("batchMill").key, "mill");
eq("未知 view", c.groupForView("dashboard"), null);

console.log("== candidateOrdersForMachine ==");
const orders = [
  { id: "WO-3", machine: "B03", processId: "p3", workOrderId: "w3", processStatus: "pending", dueDate: "2026-10-05" },
  { id: "WO-1", machine: "B03", processId: "p1", workOrderId: "w1", processStatus: "running", dueDate: "2026-10-09" },
  { id: "WO-2", machine: "B03", processId: "p2", workOrderId: "w2", processStatus: "pending", dueDate: "2026-10-02" },
  { id: "WO-OFF", machine: "B03", processId: "p4", workOrderId: "w4", processStatus: "running", offStation: true },
  { id: "WO-DONE", machine: "B03", processId: "p5", workOrderId: "w5", processStatus: "completed" },
  { id: "WO-SHIP", machine: "B03", processId: "p7", workOrderId: "w7", processStatus: "pending", workStatus: "shipped" },
  { id: "WO-NOPROC", machine: "B03", processId: null, workOrderId: "w6" },
  { id: "WO-A01", machine: "A01 小瀧澤", processId: "pa", workOrderId: "wa", processStatus: "pending" },
];
eq("B03：加工中優先，再依交期；移走／完工／出貨／沒工序的不算", c.candidateOrdersForMachine(orders, "B03").map((o) => o.id), ["WO-1", "WO-2", "WO-3"]);
eq("「A01 小瀧澤」也認得是 A01", c.candidateOrdersForMachine(orders, "a01").map((o) => o.id), ["WO-A01"]);
eq("沒派工 → 空", c.candidateOrdersForMachine(orders, "A05"), []);

console.log("== displayProgress（已報＝舊 MES＋待回寫）==");
const now = Date.parse("2026-10-01T06:00:00Z");
eq("加總", (({ totalOutput, totalFail, legacyKnown }) => ({ totalOutput, totalFail, legacyKnown }))(c.displayProgress({ legacy_output: 110, legacy_fail: 1, pending_output: 10, pending_fail: 2, pending_count: 2, oldest_pending_at: "2026-10-01T05:00:00Z" }, now)), { totalOutput: 120, totalFail: 3, legacyKnown: true });
eq("舊 MES 還沒有這站的結算列 → legacyKnown=false，只算待回寫", (({ totalOutput, legacyKnown }) => ({ totalOutput, legacyKnown }))(c.displayProgress({ legacy_output: null, legacy_fail: null, pending_output: 4, pending_fail: 1, pending_count: 1 }, now)), { totalOutput: 4, legacyKnown: false });
eq("待回寫超過 2 小時 → 提醒", c.displayProgress({ legacy_output: 0, legacy_fail: 0, pending_output: 1, pending_fail: 0, pending_count: 1, oldest_pending_at: "2026-10-01T03:00:00Z" }, now).stalePending, true);
eq("沒有待回寫 → 不提醒", c.displayProgress({ legacy_output: 5, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null }, now).stalePending, false);
eq("讀不到進度 → available=false、全 0", (({ available, totalOutput }) => ({ available, totalOutput }))(c.displayProgress(null, now)), { available: false, totalOutput: 0 });

console.log("== cardProgress（Monitor 卡片完成數＝舊 MES＋待回寫）==");
const pick = (o) => ({ done: o.done, source: o.source, label: o.label });
eq("有舊 MES：3440（App 自己 0）→ 3440、標含舊 MES", pick(c.cardProgress(0, { legacy_output: 3440, legacy_fail: 3, pending_output: 0, pending_fail: 0, pending_count: 0 }, now)), { done: 3440, source: "legacy", label: "含舊 MES" });
eq("舊 MES＋待回寫：110＋10 → 120、標待回寫 10（不再加 App 累計，避免重複）", pick(c.cardProgress(95, { legacy_output: 110, legacy_fail: 1, pending_output: 10, pending_fail: 0, pending_count: 2 }, now)), { done: 120, source: "legacy", label: "含舊 MES・待回寫 10" });
eq("舊 MES 還沒有結算列 → 照 App 累計、標尚無資料", pick(c.cardProgress(7, { legacy_output: null, legacy_fail: null, pending_output: 4, pending_fail: 0, pending_count: 1 }, now)), { done: 7, source: "app", label: "舊 MES 尚無資料" });
eq("讀不到（RPC 失敗／沒這道工序）→ 照 App 累計、標尚無資料", pick(c.cardProgress(12, null, now)), { done: 12, source: "app", label: "舊 MES 尚無資料" });
eq("舊 MES 結算 0（有列）→ 0、仍標含舊 MES", pick(c.cardProgress(0, { legacy_output: 0, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0 }, now)), { done: 0, source: "legacy", label: "含舊 MES" });
eq("不良＝舊 MES 不良＋待回寫不良", c.cardProgress(0, { legacy_output: 10, legacy_fail: 2, pending_output: 1, pending_fail: 1, pending_count: 1 }, now).totalFail, 3);

console.log("== resolveStartedAt ==");
const end = "2026-10-01T06:00:00.000Z";
eq("取最晚：上一次報工", c.resolveStartedAt({ serverLastReportAt: "2026-10-01T04:00:00Z", localLedgerAt: "2026-10-01T03:00:00Z", actualStartAt: "2026-10-01T00:30:00Z", endedAt: end }), { startedAt: "2026-10-01T04:00:00.000Z", source: "lastReport", reason: "" });
eq("本機 ledger 比伺服器新（離線待送）→ 用本機", c.resolveStartedAt({ serverLastReportAt: "2026-10-01T04:00:00Z", localLedgerAt: "2026-10-01T05:00:00Z", actualStartAt: null, endedAt: end }).source, "deviceLedger");
eq("只有開工時間 → 用開工時間", c.resolveStartedAt({ serverLastReportAt: null, localLedgerAt: null, actualStartAt: "2026-10-01T00:30:00Z", endedAt: end }), { startedAt: "2026-10-01T00:30:00.000Z", source: "processStart", reason: "" });
eq("未來時間（時鐘亂掉）不採用", c.resolveStartedAt({ serverLastReportAt: "2026-10-01T07:00:00Z", localLedgerAt: null, actualStartAt: "2026-10-01T00:30:00Z", endedAt: end }).source, "processStart");
eq("都沒有 → 不給、說明原因（絕不自己編）", c.resolveStartedAt({ serverLastReportAt: null, localLedgerAt: "garbage", actualStartAt: null, endedAt: end }).startedAt, null);
eq("started_at 可以等於 ended_at（回寫橋只拒 ended<started）", c.resolveStartedAt({ serverLastReportAt: end, endedAt: end }).startedAt, end);

console.log("== validateRow ==");
const okRow = { machineCode: "A01", order: { processId: "p", workOrderId: "w" }, good: "12", bad: "1", operatorId: "u1", operatorMapped: true, startedAt: "2026-10-01T04:00:00.000Z" };
eq("正常列", c.validateRow(okRow), { send: true, empty: false, error: "", good: 12, bad: 1 });
eq("空白列不送、不算錯", c.validateRow({ ...okRow, good: "", bad: "" }), { send: false, empty: true, error: "" });
eq("0／0 也是空白列（回寫橋會拒 zero quantity）", c.validateRow({ ...okRow, good: "0", bad: "0" }).empty, true);
eq("只有不良也可以送", c.validateRow({ ...okRow, good: "", bad: "2" }).send, true);
eq("小數擋下", c.validateRow({ ...okRow, good: "1.5" }).error, "數量要填整數");
eq("文字擋下", c.validateRow({ ...okRow, good: "abc" }).error, "數量要填整數");
eq("負數擋下", c.validateRow({ ...okRow, good: "-1" }).error, "數量不能是負的");
eq("多打 0 擋下", c.validateRow({ ...okRow, good: "1000000" }).send, false);
eq("沒派工擋下", c.validateRow({ ...okRow, order: null }).error, "這台目前沒有派工，不能報工");
eq("沒選報工人擋下", c.validateRow({ ...okRow, operatorId: "" }).error, "請選報工人");
eq("報工人沒有工號對照擋下（回寫橋會 HOLD）", c.validateRow({ ...okRow, operatorMapped: false }).send, false);
eq("沒有開工時間擋下並帶原因", c.validateRow({ ...okRow, startedAt: null, startedAtReason: "請先今日開工" }).error, "請先今日開工");

console.log("== 冪等 report_uuid ==");
let n = 0;
const uuidFn = () => `uuid-${++n}`;
const first = c.ensureReportUuid(null, okRow, uuidFn);
eq("第一次產生新 uuid", [first.reportUuid, first.reused], ["uuid-1", false]);
const again = c.ensureReportUuid(first, { ...okRow }, uuidFn);
eq("同樣的輸入再按一次 → 同一個 uuid（不會變兩筆）", [again.reportUuid, again.reused], ["uuid-1", true]);
const changed = c.ensureReportUuid(first, { ...okRow, good: "13" }, uuidFn);
eq("改了數量 → 新 uuid", [changed.reportUuid, changed.reused], ["uuid-2", false]);
eq("換報工人 → 新 uuid", c.ensureReportUuid(first, { ...okRow, operatorId: "u2" }, uuidFn).reused, false);
eq("換工單 → 新 uuid", c.ensureReportUuid(first, { ...okRow, order: { processId: "p9", workOrderId: "w" } }, uuidFn).reused, false);

console.log("== buildPayload ==");
const built = c.buildPayload({ row: { ...okRow, order: { processId: "p", workOrderId: "w", processStatus: "running", tenantId: "t" }, startedAtSource: "lastReport" }, groupKey: "lathe", actorAppUserId: "actor", endedAt: "2026-09-30T17:30:00.000Z", reportUuid: "uuid-x", tenantId: "t" });
eq("payload 欄位", {
  report_uuid: built.payload.report_uuid, work_order_id: built.payload.work_order_id, process_id: built.payload.process_id,
  completed_qty: built.payload.completed_qty, defect_qty: built.payload.defect_qty, started_at: built.payload.started_at,
  ended_at: built.payload.ended_at, user_id: built.payload.user_id, report_type: built.payload.report_type,
}, { report_uuid: "uuid-x", work_order_id: "w", process_id: "p", completed_qty: 12, defect_qty: 1, started_at: "2026-10-01T04:00:00.000Z", ended_at: "2026-09-30T17:30:00.000Z", user_id: "actor", report_type: "batch" });
eq("report_date＝台灣日期（UTC 17:30＝台灣隔天 01:30）", built.payload.report_date, "2026-10-01");
eq("operators＝這列的報工人（剛好一位）", built.operators, ["u1"]);
eq("不帶 cycle_time_seconds（不汙染純切削工時基準）", "cycle_time_seconds" in built.payload, false);
eq("登入者不是報工人時 user_id 仍記登入者（誰按的）", built.payload.user_id, "actor");
let threw = false;
try { c.buildPayload({ row: { ...okRow, good: "" , bad: ""}, groupKey: "lathe", endedAt: "2026-10-01T00:00:00Z", reportUuid: "u" }); } catch { threw = true; }
eq("不能送的列 buildPayload 會丟錯（雙重保險）", threw, true);

console.log("== operatorChoices ==");
const users = [{ id: "s", name: "B03站別", legacy_user_id: "" }, { id: "u2", name: "王小明", legacy_user_id: " 1080301 " }, { id: "u1", name: "李大華", legacy_user_id: "1080302" }];
eq("只列有工號對照的人", c.operatorChoices(users).map((u) => u.id).sort(), ["u1", "u2"]);
eq("預設＝登入者（有對照）", c.defaultOperatorId(c.operatorChoices(users), "u1"), "u1");
eq("站別帳號登入 → 預設空白，逼人選", c.defaultOperatorId(c.operatorChoices(users), "s"), "");

console.log("== summarizeResults ==");
eq("計數", c.summarizeResults([{ status: "sent" }, { status: "queued" }, { status: "failed" }, { status: "sent" }]), { sent: 2, queued: 1, failed: 1, total: 4 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
