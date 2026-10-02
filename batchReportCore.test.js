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
eq("正常列（沒帶 mode＝中午報工）", c.validateRow(okRow), { send: true, empty: false, error: "", good: 12, bad: 1, machineSeconds: null, timeOnly: false });
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
}, { report_uuid: "uuid-x", work_order_id: "w", process_id: "p", completed_qty: 12, defect_qty: 1, started_at: "2026-10-01T04:00:00.000Z", ended_at: "2026-09-30T17:30:00.000Z", user_id: "actor", report_type: "noon" });
eq("report_date＝台灣日期（UTC 17:30＝台灣隔天 01:30）", built.payload.report_date, "2026-10-01");
eq("operators＝這列的報工人（剛好一位）", built.operators, ["u1"]);
eq("機台加工時間沒填 → cycle_time_seconds＝null（不寫時間）", [built.payload.cycle_time_seconds, built.payload.report_payload.cycle_time_seconds], [null, null]);
eq("登入者不是報工人時 user_id 仍記登入者（誰按的）", built.payload.user_id, "actor");
let threw = false;
try { c.buildPayload({ row: { ...okRow, good: "" , bad: ""}, groupKey: "lathe", endedAt: "2026-10-01T00:00:00Z", reportUuid: "u" }); } catch { threw = true; }
eq("不能送的列 buildPayload 會丟錯（雙重保險）", threw, true);

console.log("== 報工類型（今日開工／中午報工／收工）==");
eq("三種類型、順序固定", c.MODE_ORDER, ["dailyStart", "noon", "finish"]);
eq("名稱照單台 reportTypeMeta", c.MODE_ORDER.map((k) => [c.MODES[k].label, c.MODES[k].submitLabel]), [["今日開工", "送出今日開工"], ["中午報工", "送出中午報工"], ["收工 / 完工", "送出收工回報"]]);

// 單台報工（app.js submitReport＋buildReportPayload＋buildReportRemark＋machtileSubmitReportViaOutbox）實際送出的形狀，
// 照抄成參考：表單用預設值（今日開工的「目前機台已加工數量」預設＝order.done、這次良品／不良預設 0、沒有備註）。
// cycle_time_seconds 例外：單台每次都送隱藏欄位的值（沒基準時是 HTML 預設 550），批次只在機台加工時間有改時才送，
// 所以參考值用 null（＝批次的規則），差異寫在 PR 對照表。
function singleScreenPayload(type, order, { completed = 0, defects = 0, cycle = null, overtime = "", startedAt = null, endedAt, uuid, actor }) {
  const label = { dailyStart: "今日開工", noon: "中午報工", finish: "收工 / 完工" }[type];
  const parts = [`[${label}]`];
  if (type === "dailyStart") { parts.push(`機台已加工數量 ${order.done || 0}`); parts.push("首件檢查完成"); }
  if (type === "finish") parts.push(overtime === "2030" ? "加班收工 20:30" : "一般下班 17:00");
  const reportPayload = {
    report_type: type, work_total_qty: Number(order.total || 0) || null, cycle_time_seconds: cycle,
    machine_qty: Number(order.done || 0), completed_qty: completed, defect_qty: defects, has_program_upload: false,
    overtime_plan: overtime, pm_abnormal: "", abnormal_type: "",
  };
  const p = {
    report_uuid: uuid, tenant_id: order.tenantId, work_order_id: order.workOrderId, process_id: order.processId,
    report_date: "(date)", completed_qty: completed, defect_qty: defects, status_after_report: order.processStatus || "running",
    remark: parts.join("；"), user_id: actor, report_type: type, report_payload: reportPayload,
    work_total_qty: reportPayload.work_total_qty, cycle_time_seconds: reportPayload.cycle_time_seconds, ended_at: endedAt,
  };
  if (startedAt) p.started_at = startedAt;
  return p;
}
const sortKeys = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o).sort().reduce((a, k) => { a[k] = sortKeys(o[k]); return a; }, {}) : o);
const ord = { processId: "p", workOrderId: "w", processStatus: "running", tenantId: "t", done: 3440, total: 5000 };
const END = "2026-10-02T00:10:00.000Z";
const base = { machineCode: "A01", order: ord, operatorId: "u1", operatorMapped: true };
const cmp = (name, built, ref) => {
  const b = { ...built.payload, report_date: "(date)" };
  eq(name, JSON.stringify(sortKeys(b)), JSON.stringify(sortKeys(ref)));
};

const ds = c.buildReportPayload({ row: { ...base, mode: "dailyStart", selected: true, startedAt: null }, actorAppUserId: "actor", endedAt: END, reportUuid: "u-ds", tenantId: "t" });
cmp("今日開工（第一次、沒有上一筆）＝單台今日開工逐欄相同（不帶 started_at）", ds, singleScreenPayload("dailyStart", ord, { endedAt: END, uuid: "u-ds", actor: "actor" }));
eq("今日開工：0／0、remark 帶機台已加工數量", [ds.payload.completed_qty, ds.payload.defect_qty, ds.payload.remark], [0, 0, "[今日開工]；機台已加工數量 3440；首件檢查完成"]);
const ds2 = c.buildReportPayload({ row: { ...base, mode: "dailyStart", selected: true, startedAt: "2026-10-01T09:00:00.000Z" }, actorAppUserId: "actor", endedAt: END, reportUuid: "u-ds2", tenantId: "t" });
cmp("今日開工（有昨天收工）＝單台：started_at＝上一筆", ds2, singleScreenPayload("dailyStart", ord, { startedAt: "2026-10-01T09:00:00.000Z", endedAt: END, uuid: "u-ds2", actor: "actor" }));
eq("今日開工 operators＝這列報工人", ds.operators, ["u1"]);

const nn = c.buildReportPayload({ row: { ...base, mode: "noon", good: "12", bad: "1", startedAt: "2026-10-02T00:10:00.000Z" }, actorAppUserId: "actor", endedAt: "2026-10-02T04:00:00.000Z", reportUuid: "u-n", tenantId: "t" });
cmp("中午報工＝單台中午報工逐欄相同", nn, singleScreenPayload("noon", ord, { completed: 12, defects: 1, startedAt: "2026-10-02T00:10:00.000Z", endedAt: "2026-10-02T04:00:00.000Z", uuid: "u-n", actor: "actor" }));
const fin = c.buildReportPayload({ row: { ...base, mode: "finish", good: "20", bad: "0", overtime: "2030", startedAt: "2026-10-02T04:00:00.000Z" }, actorAppUserId: "actor", endedAt: "2026-10-02T12:30:00.000Z", reportUuid: "u-f", tenantId: "t" });
cmp("收工（加班 20:30）＝單台收工逐欄相同", fin, singleScreenPayload("finish", ord, { completed: 20, overtime: "2030", startedAt: "2026-10-02T04:00:00.000Z", endedAt: "2026-10-02T12:30:00.000Z", uuid: "u-f", actor: "actor" }));
const fin2 = c.buildReportPayload({ row: { ...base, mode: "finish", good: "5", overtime: "none", startedAt: "2026-10-02T04:00:00.000Z" }, actorAppUserId: "actor", endedAt: "2026-10-02T09:00:00.000Z", reportUuid: "u-f2", tenantId: "t" });
eq("收工（一般下班）remark／overtime_plan 同單台", [fin2.payload.remark, fin2.payload.report_payload.overtime_plan], ["[收工 / 完工]；一般下班 17:00", "none"]);

console.log("== 今日開工 validate ==");
eq("沒勾＝不送、不算錯", c.validateRow({ ...base, mode: "dailyStart", selected: false }), { send: false, empty: true, error: "" });
eq("勾了、沒有上一筆也能送（解 A01/A04 痛點）", c.validateRow({ ...base, mode: "dailyStart", selected: true, startedAt: null }).send, true);
eq("勾了但沒派工 → 擋", c.validateRow({ ...base, mode: "dailyStart", selected: true, order: null }).error, "這台目前沒有派工，不能報工");
eq("勾了但報工人沒對照 → 擋", c.validateRow({ ...base, mode: "dailyStart", selected: true, operatorMapped: false }).send, false);
eq("今日開工的 started_at 規則＝單台（不看工序開工時間）", c.resolveStartedAt({ serverLastReportAt: null, localLedgerAt: null, actualStartAt: "2026-10-01T00:00:00Z", endedAt: END, includeProcessStart: false }).startedAt, null);
eq("今日開工：有上一筆就接上一筆", c.resolveStartedAt({ serverLastReportAt: "2026-10-01T09:00:00Z", localLedgerAt: null, actualStartAt: null, endedAt: END, includeProcessStart: false }).source, "lastReport");
const dsFp1 = c.rowFingerprint({ ...base, mode: "dailyStart", selected: true });
eq("類型不同 → 指紋不同（換分頁不會沿用別類型的 uuid）", dsFp1 === c.rowFingerprint({ ...base, mode: "noon", selected: true }), false);
eq("今日開工指紋不受殘留數量影響", dsFp1 === c.rowFingerprint({ ...base, mode: "dailyStart", selected: true, good: "9" }), true);

console.log("== 機台加工時間 ==");
eq("分＋秒 → 秒", c.parseMachineTime("1", "35"), { seconds: 95, error: "" });
eq("兩格空白＝沒填", c.parseMachineTime("", ""), { seconds: null, error: "" });
eq("只填秒", c.parseMachineTime("", "45").seconds, 45);
eq("秒數 60 擋", c.parseMachineTime("1", "60").error, "機台加工時間的秒數要在 0–59");
eq("0 擋", c.parseMachineTime("0", "0").error, "機台加工時間不能是 0");
eq("負數擋", c.parseMachineTime("-1", "0").error, "機台加工時間不能是負的");
eq("小數擋", c.parseMachineTime("1.5", "").error, "機台加工時間要填整數");
eq("超過 24 小時擋", c.parseMachineTime("1441", "").error, "機台加工時間超過 24 小時，請確認");
eq("splitSeconds", [c.splitSeconds(95), c.splitSeconds(null)], [{ minutes: "1", seconds: "35" }, { minutes: "", seconds: "" }]);
const tRow = { ...base, mode: "noon", startedAt: "2026-10-02T04:00:00.000Z", ctDefault: 95 };
eq("預設值沒動 → 不寫時間", c.machineTimeToSend({ ...tRow, ctMinutes: "1", ctSeconds: "35" }), { seconds: null, changed: false, error: "" });
eq("改了 → 寫新值", c.machineTimeToSend({ ...tRow, ctMinutes: "1", ctSeconds: "40" }), { seconds: 100, changed: true, error: "" });
eq("清空 → 不寫（不會把時間清掉）", c.machineTimeToSend({ ...tRow, ctMinutes: "", ctSeconds: "" }).changed, false);
eq("沒有上一次的值、第一次填 → 寫", c.machineTimeToSend({ ...tRow, ctDefault: null, ctMinutes: "2", ctSeconds: "0" }).seconds, 120);
eq("只填數量、時間沒動 → 送，cycle_time_seconds＝null", (() => { const b = c.buildReportPayload({ row: { ...tRow, good: "5", ctMinutes: "1", ctSeconds: "35" }, endedAt: "2026-10-02T05:00:00.000Z", reportUuid: "x" }); return [b.payload.completed_qty, b.payload.cycle_time_seconds, b.payload.report_payload.cycle_time_seconds]; })(), [5, null, null]);
eq("數量＋改時間 → 同一筆一起帶", (() => { const b = c.buildReportPayload({ row: { ...tRow, good: "5", ctMinutes: "1", ctSeconds: "40" }, endedAt: "2026-10-02T05:00:00.000Z", reportUuid: "x" }); return [b.payload.completed_qty, b.payload.cycle_time_seconds, b.payload.report_payload.cycle_time_seconds, b.payload.ended_at]; })(), [5, 100, 100, "2026-10-02T05:00:00.000Z"]);
const to = c.validateRow({ ...tRow, good: "", bad: "", ctMinutes: "1", ctSeconds: "40" });
eq("只改時間、不填數量 → 也能送（timeOnly）", [to.send, to.timeOnly, to.machineSeconds], [true, true, 100]);
const toB = c.buildReportPayload({ row: { ...tRow, good: "", bad: "", ctMinutes: "1", ctSeconds: "40" }, endedAt: "2026-10-02T05:00:00.000Z", reportUuid: "x" });
eq("只改時間：0／0、started_at＝ended_at＝上一筆時間（不推進起算點、不吃工時）", [toB.payload.completed_qty, toB.payload.defect_qty, toB.payload.started_at, toB.payload.ended_at, toB.timeOnly], [0, 0, "2026-10-02T04:00:00.000Z", "2026-10-02T04:00:00.000Z", true]);
eq("只改時間但沒有任何開工紀錄 → 擋（請先今日開工）", c.validateRow({ ...tRow, startedAt: null, startedAtReason: "請先按上方「今日開工」", good: "", ctMinutes: "2", ctSeconds: "0" }).error, "請先按上方「今日開工」");
eq("時間沒改、數量空白 → 空白列", c.validateRow({ ...tRow, ctMinutes: "1", ctSeconds: "35" }).empty, true);
eq("時間填錯 → 紅字", c.validateRow({ ...tRow, good: "3", ctMinutes: "1", ctSeconds: "75" }).error, "機台加工時間的秒數要在 0–59");
eq("改時間 → 新 uuid（指紋含時間）", c.rowFingerprint({ ...tRow, good: "5", ctMinutes: "1", ctSeconds: "40" }) === c.rowFingerprint({ ...tRow, good: "5", ctMinutes: "1", ctSeconds: "35" }), false);
eq("收工改加班選項 → 新 uuid", c.rowFingerprint({ ...tRow, mode: "finish", good: "5", overtime: "none" }) === c.rowFingerprint({ ...tRow, mode: "finish", good: "5", overtime: "2030" }), false);
const lm = c.latestMachineTimeByProcess([
  { process_id: "p1", cycle_time_seconds: 90, created_at: "2026-10-01T01:00:00Z" },
  { process_id: "p1", cycle_time_seconds: 95, created_at: "2026-10-01T03:00:00Z" },
  { process_id: "p2", cycle_time_seconds: null, created_at: "2026-10-01T03:00:00Z" },
  { process_id: "p3", cycle_time_seconds: 0, created_at: "2026-10-01T03:00:00Z" },
]);
eq("每道工序取最新一次填的值；null／0 不算", [lm.get("p1")?.seconds, lm.has("p2"), lm.has("p3")], [95, false, false]);
eq("審查 N2：只有兩筆（90 舊、95 最新）→ 最新以前只有 1 筆，沒有基準", [lm.get("p1")?.count, lm.get("p1")?.seconds, lm.get("p1")?.baselineSeconds], [2, 95, null]);
const lm3 = c.latestMachineTimeByProcess([
  { process_id: "r", cycle_time_seconds: 80, created_at: "2026-10-01T01:00:00Z" },
  { process_id: "r", cycle_time_seconds: 90, created_at: "2026-10-01T02:00:00Z" },
  { process_id: "r", cycle_time_seconds: 120, created_at: "2026-10-01T03:00:00Z" },
]).get("r");
eq("審查 N2：三筆（80、90、最新 120）→ 基準＝(80+90)/2＝85，不含最新那筆", [lm3.count, lm3.seconds, lm3.baselineSeconds], [3, 120, 85]);
eq("審查 N2：三筆時差異＝(120−85)/85≈+41%（含最新一起平均會變成 (120−97)/97≈+24%）", Math.round(((lm3.seconds - lm3.baselineSeconds) / lm3.baselineSeconds) * 100), 41);
const lm3b = c.latestMachineTimeByProcess([
  { process_id: "s", cycle_time_seconds: 100, created_at: "2026-10-01T03:00:00Z" },
  { process_id: "s", cycle_time_seconds: 60, created_at: "2026-10-01T01:00:00Z" },
  { process_id: "s", cycle_time_seconds: 81, created_at: "2026-10-01T02:00:00Z" },
]).get("s");
eq("審查 N2：資料順序亂也一樣（最新＝100，基準＝(60+81)/2＝70.5→71）", [lm3b.seconds, lm3b.baselineSeconds], [100, 71]);
const lm550 = c.latestMachineTimeByProcess([
  { process_id: "q1", cycle_time_seconds: 550, created_at: "2026-10-01T05:00:00Z" },
  { process_id: "q2", cycle_time_seconds: 550, created_at: "2026-10-01T05:00:00Z" },
  { process_id: "q2", cycle_time_seconds: 120, created_at: "2026-10-01T01:00:00Z" },
]);
eq("550 測試資料已清（2026-10-02），暫時規則拿掉：真的 9 分 10 秒照常採用", [lm550.get("q1")?.seconds, lm550.get("q2")?.seconds, lm550.get("q2")?.count], [550, 550, 2]);
eq("只有一筆 → 沒有基準", lm.get("p1") && c.latestMachineTimeByProcess([{ process_id: "z", cycle_time_seconds: 80, created_at: "x" }]).get("z").baselineSeconds, null);

console.log("== operatorChoices ==");
const users = [{ id: "s", name: "B03站別", legacy_user_id: "" }, { id: "u2", name: "王小明", legacy_user_id: " 1080301 " }, { id: "u1", name: "李大華", legacy_user_id: "1080302" }];
eq("只列有工號對照的人", c.operatorChoices(users).map((u) => u.id).sort(), ["u1", "u2"]);
eq("預設＝登入者（有對照）", c.defaultOperatorId(c.operatorChoices(users), "u1"), "u1");
eq("站別帳號登入 → 預設空白，逼人選", c.defaultOperatorId(c.operatorChoices(users), "s"), "");

console.log("== summarizeResults ==");
eq("計數", c.summarizeResults([{ status: "sent" }, { status: "queued" }, { status: "failed" }, { status: "sent" }]), { sent: 2, queued: 1, failed: 1, total: 4 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
