// 純邏輯測試，無相依：repo 根目錄執行 `node analyticsCore.test.js`
const c = require("./analyticsCore.js");
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got  " + g + "\n        want " + w); }
};
const tw = (hhmm, day = "2026-10-02") => Date.parse(`${day}T${hhmm}:00+08:00`);
const iso = (hhmm, day) => new Date(tw(hhmm, day)).toISOString();
const rep = (pid, code, type, endHHMM, extra = {}, day) => ({
  process_id: pid, machine_code: code, report_type: type, ended_at: iso(endHHMM, day), created_at: iso(endHHMM, day),
  started_at: null, completed_qty: 0, defect_qty: 0, cycle_time_seconds: null, overtime_plan: "", ...extra,
});

console.log("== 時間（台灣時區）==");
eq("UTC 2026-10-01T16:30Z ＝ 台灣 10/2", c.taipeiDate(Date.parse("2026-10-01T16:30:00Z")), "2026-10-02");
eq("近 7 天（含今天）", c.windowDates(tw("10:00")), ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
eq("查詢下限＝9/26 台灣 00:00", c.windowStartIso(tw("10:00")), "2026-09-25T16:00:00.000Z");
eq("10/4 是週日", c.weekday("2026-10-04"), 0);
eq("週日不是工作天、週六是", [c.isWorkday("2026-10-04"), c.isWorkday("2026-10-03")], [false, true]);

console.log("== 報工 → 機台 ==");
{
  const r = c.attachMachineCodes([
    { process_id: "p1", machine_id: "m1" },
    { process_id: "p2", machine_id: null, work_order_processes: { machine_id: "m2" } },
    { process_id: "p3" },
    { process_id: "p9" },
  ], { codeByMachineId: new Map([["m1", "a01"], ["m2", "B03"]]), codeByProcessId: { p3: "A05" } });
  eq("machine_id → 工序 machine_id → 畫面工序對照；都沒有算未知", [r.rows.map((x) => x.machine_code), r.unknown], [["A01", "B03", "A05", ""], 1]);
}

console.log("== 當時的機台加工時間 ==");
{
  const idx = c.buildCycleTimeIndex([
    { process_id: "p", cycle_time_seconds: 100, created_at: iso("08:00") },
    { process_id: "p", cycle_time_seconds: 120, created_at: iso("12:00") },
    { process_id: "p", cycle_time_seconds: null, created_at: iso("13:00") },
  ]);
  eq("10:00 的報工用 08:00 填的 100", c.cycleTimeAt(idx, "p", tw("10:00"), 999), { seconds: 100, source: "history" });
  eq("12:00 同時填的那筆用 120", c.cycleTimeAt(idx, "p", tw("12:00"), 999), { seconds: 120, source: "history" });
  eq("07:00（第一次填以前）→ 卡片最新值", c.cycleTimeAt(idx, "p", tw("07:00"), 130), { seconds: 130, source: "card" });
  eq("都沒有 → null", c.cycleTimeAt(idx, "q", tw("07:00"), null), { seconds: null, source: null });
}

console.log("== 區間聯集 ==");
eq("重疊＋裁切", c.unionLength([[0, 10], [5, 20], [30, 40], [50, 60]], 2, 55), (20 - 2) + 10 + 5);

console.log("== 稼動率：今天 ==");
{
  const cycleRows = [{ process_id: "pA1", cycle_time_seconds: 60, created_at: iso("07:00") }];
  const reports = [
    // A01：08:00 開工、12:00 中午 100 件（60 秒）、17:00 收工 80+2 件 → 純加工 182×60＝3時02分；在班 9 小時
    rep("pA1", "A01", "dailyStart", "08:00"),
    rep("pA1", "A01", "noon", "12:00", { started_at: iso("08:00"), completed_qty: 100 }),
    rep("pA1", "A01", "finish", "17:00", { started_at: iso("12:00"), completed_qty: 80, defect_qty: 2, overtime_plan: "none" }),
    // A02：開工、沒有任何數量
    rep("pA2", "A02", "dailyStart", "08:30"),
    // A03：開工＋報了 50 件，但從來沒填機台加工時間、卡片也沒有
    rep("pA3", "A03", "dailyStart", "08:00"),
    rep("pA3", "A03", "noon", "12:00", { started_at: iso("08:00"), completed_qty: 50 }),
    // A04：開工，沒收工、選了加班 20:30（下午檢查）；現在 21:00 → 在班算到 20:30；卡片時間 300 秒
    rep("pA4", "A04", "dailyStart", "08:00"),
    rep("pA4", "A04", "afternoonCheck", "15:00", { overtime_plan: "2030" }),
    rep("pA4", "A04", "noon", "20:00", { started_at: iso("08:00"), completed_qty: 100 }),
    // B03：沒有今日開工，但有數量 → 算不出在班時間
    rep("pB3", "B03", "noon", "12:00", { started_at: iso("08:00"), completed_qty: 10 }),
    // B04：只有昨天的紀錄 → 今日未開工
    rep("pB4", "B04", "dailyStart", "08:00", {}, "2026-10-01"),
    // B05：開工、兩張單，一張有時間 30 件×120，一張沒時間 5 件 → partial
    rep("pB5", "B05", "dailyStart", "08:00"),
    rep("pB5", "B05", "noon", "12:00", { started_at: iso("08:00"), completed_qty: 30, cycle_time_seconds: 120 }),
    rep("pB5x", "B05", "noon", "13:00", { started_at: iso("12:00"), completed_qty: 5 }),
    rep("pB5", "B05", "finish", "17:00", { started_at: iso("13:00") }),
  ];
  const machines = ["A01", "A02", "A03", "A04", "B03", "B04", "B05", "B06"].map((code) => ({ code }));
  const u = c.machineUtilization({ machines, reports, cycleRows, cardSecondsByProcess: new Map([["pA4", 300]]), nowMs: tw("21:00"), range: "today" });
  const by = Object.fromEntries(u.rows.map((r) => [r.code, r]));
  eq("A01 稼動率＝182×60 ÷ 9 時", Math.round(by.A01.utilization * 1000) / 1000, Math.round((182 * 60) / (9 * 3600) * 1000) / 1000);
  eq("A01 報工覆蓋＝08:00–17:00 全段＝100%", by.A01.coverage, 1);
  eq("A01 status ok", by.A01.status, "ok");
  eq("A02 已開工沒數量 → 不給數字、給原因", [by.A02.utilization, by.A02.status, by.A02.reason], [null, "noQty", "已開工，還沒有數量報工"]);
  eq("A03 未填機台加工時間 → 不給數字", [by.A03.utilization, by.A03.status, by.A03.reason], [null, "noCycle", "未填機台加工時間（50 件無法換算）"]);
  eq("A04 加班 20:30、沒收工、現在 21:00 → 在班 08:00–20:30", by.A04.shiftSec, 12.5 * 3600);
  eq("A04 用卡片時間 300 秒", Math.round(by.A04.utilization * 10000), Math.round((100 * 300) / (12.5 * 3600) * 10000));
  eq("A04 註記用卡片時間、算到 20:30", by.A04.notes.some((n) => n.includes("卡片")) && by.A04.notes.some((n) => n.includes("20:30")), true);
  eq("B03 沒有今日開工 → 原因", [by.B03.utilization, by.B03.status], [null, "noStart"]);
  eq("B04 今日未開工（不是 0%）", [by.B04.utilization, by.B04.coverage, by.B04.reason], [null, null, "今日未開工"]);
  eq("B06 完全沒資料 → 今日未開工", by.B06.reason, "今日未開工");
  eq("B05 部分沒時間 → partial、5 件未計", [by.B05.status, by.B05.missingQty, Math.round(by.B05.pureSec)], ["partial", 5, 3600]);
  eq("排序：有數字的由低到高，其他照機台號", u.rows.map((r) => r.code), ["B05", "A01", "A04", "A02", "A03", "B03", "B04", "B06"]);
  eq("最低的幾台（有數字 3 台 → 標 2 台，最高的不標）", u.rows.filter((r) => r.lowest).map((r) => r.code), ["B05", "A01"]);
}

console.log("== 稼動率：今天還沒收工（算到現在）＋一般下班 ==");
{
  const reports = [
    rep("p", "A01", "dailyStart", "08:00"),
    rep("p", "A01", "noon", "10:00", { started_at: iso("08:00"), completed_qty: 60, cycle_time_seconds: 60 }),
  ];
  const at10 = c.machineUtilization({ machines: [{ code: "A01" }], reports, nowMs: tw("11:00") }).rows[0];
  eq("11:00 在班＝3 小時（算到現在）", at10.shiftSec, 3 * 3600);
  eq("11:00 稼動率＝60 分 ÷ 3 時", Math.round(at10.utilization * 1000), 333);
  eq("報工覆蓋＝08–10 ÷ 3 時", Math.round(at10.coverage * 1000), 667);
  const at18 = c.machineUtilization({ machines: [{ code: "A01" }], reports, nowMs: tw("18:00") }).rows[0];
  eq("18:00 沒收工、沒選加班 → 算到 17:00", [at18.shiftSec, at18.notes.some((n) => n.includes("17:00"))], [9 * 3600, true]);
  const late = c.machineUtilization({ machines: [{ code: "A01" }], reports: [rep("p", "A01", "dailyStart", "08:00"), rep("p", "A01", "noon", "10:00", { started_at: iso("08:00"), completed_qty: 600, cycle_time_seconds: 60 })], nowMs: tw("09:00") }).rows[0];
  eq("超過 100% → 照實顯示並提醒", [late.utilization > 1, late.notes.some((n) => n.includes("超過 100%"))], [true, true]);
}

console.log("== 稼動率：近 7 天 ==");
{
  const reports = [
    rep("p", "A01", "dailyStart", "08:00", {}, "2026-09-30"),
    rep("p", "A01", "finish", "17:00", { started_at: iso("08:00", "2026-09-30"), completed_qty: 100, cycle_time_seconds: 90, overtime_plan: "none" }, "2026-09-30"),
    // 10/1 開工沒收工 → 算到 17:00 並標示
    rep("p", "A01", "dailyStart", "08:00", {}, "2026-10-01"),
    rep("p", "A01", "noon", "12:00", { started_at: iso("08:00", "2026-10-01"), completed_qty: 60 }, "2026-10-01"),
    // 9/20 在 7 天外，不算
    rep("p", "A01", "dailyStart", "08:00", {}, "2026-09-20"),
  ];
  const u = c.machineUtilization({ machines: [{ code: "A01" }, { code: "A02" }], reports, nowMs: tw("10:00"), range: "7d" });
  const a = u.rows[0];
  eq("7 天：2 天有在班、共 18 小時", [a.days, a.shiftSec], [2, 18 * 3600]);
  eq("7 天：純加工＝160×90", a.pureSec, 160 * 90);
  eq("7 天：註記 1 天沒收工", a.notes.some((n) => n.includes("1 天沒有收工")), true);
  eq("A02 近 7 天沒有開工紀錄", u.rows[1].reason, "近 7 天沒有開工紀錄");
}

console.log("== 每日產量：實際 vs 估算 ==");
{
  const reports = [
    rep("p1", "A01", "dailyStart", "08:00"),
    rep("p1", "A01", "noon", "12:00", { completed_qty: 40, defect_qty: 1 }),
    rep("p2", "A02", "dailyStart", "08:00"),
    rep("p2", "A02", "noon", "12:00", { completed_qty: 90 }),
    rep("p3", "A03", "dailyStart", "08:00"),
    rep("p3", "A03", "noon", "12:00", { completed_qty: 10 }),
    rep("p1", "A01", "noon", "12:00", { completed_qty: 70 }, "2026-10-01"),
  ];
  const machines = [
    { code: "A01", estimate: 100 }, { code: "A02", estimate: 80 }, { code: "A03", estimate: null, estimateReason: "未填機台加工時間" }, { code: "A04", estimate: 50 },
  ];
  const d = c.dailyOutput({ machines, reports, nowMs: tw("17:30"), range: "today" });
  const by = Object.fromEntries(d.rows.map((r) => [r.code, r]));
  eq("A01 實際 40（良品）、估算 100、差 −60、達成 40%", [by.A01.actual, by.A01.estimate, by.A01.diff, by.A01.rate], [40, 100, -60, 0.4]);
  eq("A02 超前 +10", [by.A02.diff, Math.round(by.A02.rate * 100)], [10, 113]);
  eq("A03 估算缺值 → 標出來、有實際", [by.A03.status, by.A03.actual, by.A03.estimate, by.A03.reason], ["noEstimate", 10, null, "未填機台加工時間"]);
  eq("A04 今日未開工 → 實際不補 0", [by.A04.status, by.A04.actual], ["notOpened", null]);
  eq("排序：落後最多在前，再估算缺值，再未開工", d.rows.map((r) => r.code), ["A01", "A02", "A03", "A04"]);
  eq("今天工廠合計良品 140", d.dailyTotals[0].good, 140);
  const w = c.dailyOutput({ machines, reports, nowMs: tw("17:30"), range: "7d" });
  const a = w.rows.find((r) => r.code === "A01");
  eq("7 天：A01 開工 2 天 → 估算 200、實際 110", [a.openedDays, a.estimate, a.actual], [2, 200, 110]);
  eq("7 天：每日合計列 7 天、10/1＝70", [w.dailyTotals.length, w.dailyTotals.find((t) => t.date === "2026-10-01").good], [7, 70]);
}

console.log("== 交期風險 ==");
{
  // 今天 2026-10-02（週五）
  const now = tw("10:00");
  const reports = [
    rep("pAct", "A01", "noon", "12:00", { completed_qty: 100 }, "2026-09-30"),
    rep("pAct", "A01", "noon", "12:00", { completed_qty: 100 }, "2026-10-01"),
  ];
  const orders = [
    // 實際日產 100（2 天 200 件），剩 500 → 5 個工作天：10/2(五)、10/3(六)、10/5(一)、10/6、10/7 → 10/7；交期 10/5 → 延誤 2 天
    { processId: "pAct", workOrderNo: "WO-ACT", total: 1000, done: 500, dueDate: "2026-10-05", estimateDaily: 999 },
    // 估算 50／天、剩 100 → 2 工作天 10/2、10/3 → 10/3；交期 10/5 → 餘裕 2 天＝緊
    { processId: "pEst", workOrderNo: "WO-EST", total: 300, done: 200, dueDate: "2026-10-05", estimateDaily: 50 },
    // 已逾期
    { processId: "pOver", workOrderNo: "WO-OVERDUE", total: 100, done: 10, dueDate: "2026-09-28", estimateDaily: 10 },
    // 超量 → 不列
    { processId: "pDone", workOrderNo: "WO-OVERQTY", total: 100, done: 120, dueDate: "2026-09-01" },
    // 資料不足
    { processId: "pNone", workOrderNo: "WO-NODATA", total: 100, done: 0, dueDate: "2026-10-20", estimateDaily: null },
    { processId: "pNoDue", workOrderNo: "WO-NODUE", total: 100, done: 0, dueDate: null, estimateDaily: 10 },
    // OK：估算 100、剩 100、交期 10/30
    { processId: "pOk", workOrderNo: "WO-OK", total: 100, done: 0, dueDate: "2026-10-30", estimateDaily: 100 },
  ];
  const r = c.dueRisk({ orders, reports, nowMs: now });
  const by = Object.fromEntries(r.risks.map((x) => [x.workOrderNo, x]));
  eq("實際速度：100／天、5 工作天、預計 10/7、延誤 2 天、依據實際", [by["WO-ACT"].speed, by["WO-ACT"].daysNeeded, by["WO-ACT"].projected, by["WO-ACT"].delayDays, by["WO-ACT"].basis], [100, 5, "2026-10-07", 2, "actual"]);
  eq("估算速度：預計 10/3、餘裕 2 天＝緊、依據估算", [by["WO-EST"].projected, by["WO-EST"].level, by["WO-EST"].slackDays, by["WO-EST"].basis], ["2026-10-03", "tight", 2, "estimate"]);
  eq("已逾期 4 天", [by["WO-OVERDUE"].level, by["WO-OVERDUE"].overdueDays, c.riskLabel(by["WO-OVERDUE"])], ["overdue", 4, "已逾期 4 天"]);
  eq("超量的單不列、算在排除", [Boolean(by["WO-OVERQTY"]), r.excludedOver], [false, 1]);
  eq("資料不足兩張（沒速度、沒交期）", r.insufficient.map((x) => [x.workOrderNo, x.reason]), [["WO-NODATA", "沒有近 7 天實際日產，也沒有機台加工時間可估算"], ["WO-NODUE", "沒有交期"]]);
  eq("OK 的不列", [Boolean(by["WO-OK"]), r.okCount], [false, 1]);
  eq("排序：逾期 → 延誤 → 緊", r.risks.map((x) => x.workOrderNo), ["WO-OVERDUE", "WO-ACT", "WO-EST"]);
  // 跨週日：今天週六 10/3，估算 10／天、剩 20 → 10/3、10/5（週日 10/4 跳過）；交期 10/4 → 延誤 1 天
  const sun = c.dueRisk({ orders: [{ processId: "pSun", workOrderNo: "WO-SUN", total: 20, done: 0, dueDate: "2026-10-04", estimateDaily: 10 },
    { processId: "pSun2", workOrderNo: "WO-SUN2", total: 40, done: 0, dueDate: "2026-10-05", estimateDaily: 10 }], reports: [], nowMs: tw("09:00", "2026-10-03") });
  eq("週日不算：預計 10/5、延誤 1 天", [sun.risks.find((x) => x.workOrderNo === "WO-SUN")?.projected, sun.risks.find((x) => x.workOrderNo === "WO-SUN")?.delayDays], ["2026-10-05", 1]);
  eq("延誤多的排前面（40 件＝4 工作天 10/3、10/5、10/6、10/7 → 延誤 2 天）", sun.risks.map((x) => [x.workOrderNo, x.delayDays]), [["WO-SUN2", 2], ["WO-SUN", 1]]);
  eq("標籤", [c.riskLabel(by["WO-ACT"]), c.riskLabel(by["WO-EST"])], ["會延誤 2 天", "緊（只剩 2 天餘裕）"]);
  eq("今天週日也能起算（從週一開始）", c.nthWorkday("2026-10-04", 1), "2026-10-05");
  eq("自訂工作天（週一～五）：10/2 起第 2 天＝10/5", c.nthWorkday("2026-10-02", 2, [1, 2, 3, 4, 5]), "2026-10-05");
  eq("同一道工序只列一次", c.dueRisk({ orders: [orders[2], orders[2]], reports, nowMs: now }).risks.length, 1);
}

console.log("== 格式 ==");
eq("formatHours", [c.formatHours(3 * 3600 + 12 * 60), c.formatHours(45 * 60), c.formatHours(7200)], ["3時12分", "45分", "2時"]);
eq("formatPercent", [c.formatPercent(0.625), c.formatPercent(null)], ["63%", "—"]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
