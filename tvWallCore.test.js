// 純邏輯測試，無相依：repo 根目錄執行 `node tvWallCore.test.js`
const c = require("./tvWallCore.js");
const today = require("./todayReportStatusCore.js");
const est = require("./cardEstimateCore.js");
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got  " + g + "\n        want " + w); }
};

const DAY = "2026-10-03";
const at = (hhmm, day = DAY) => Date.parse(`${day}T${hhmm}:00+08:00`);
const iso = (hhmm, day = DAY) => new Date(at(hhmm, day)).toISOString();
const rep = (pid, type, hhmm, day = DAY) => ({ process_id: pid, report_type: type, ended_at: iso(hhmm, day), created_at: iso(hhmm, day) });

console.log("== 時鐘（台灣時間，跟執行環境時區無關）==");
const savedTZ = process.env.TZ;
process.env.TZ = "America/Los_Angeles";
eq("UTC 06:05 → 台灣 14:05 週六", c.clockParts(Date.parse("2026-10-03T06:05:00Z")), { ymd: "2026-10-03", date: "10/03", weekday: "週六", time: "14:05" });
eq("UTC 16:01 前一天 → 台灣隔天 00:01", c.clockParts(Date.parse("2026-10-02T16:01:00Z")).time, "00:01");
process.env.TZ = savedTZ;
eq("壞值 → --:--", c.clockParts(NaN).time, "--:--");

console.log("== 讀取失敗的提示 ==");
eq("有上一次成功 → 最後更新 HH:MM", c.failureText(at("14:02")), "資料更新失敗，最後更新 14:02");
eq("從來沒成功 → 尚未取得資料", c.failureText(0), "資料讀取失敗，尚未取得資料");

console.log("== 逾期天數（台灣日期）==");
eq("交期昨天 → 1", c.overdueDays("2026-10-02", at("09:00")), 1);
eq("交期今天 → 0", c.overdueDays("2026-10-03", at("23:59")), 0);
eq("台灣 00:30 跨日：交期 10/02 → 1（UTC 還是 10/02）", c.overdueDays("2026-10-02", at("00:30")), 1);
eq("交期未來 → 0", c.overdueDays("2026-12-31", at("09:00")), 0);
eq("沒有交期 → null", c.overdueDays(null, at("09:00")), null);

console.log("== 整台的今日狀態＝所有工序最新一筆 ==");
const todayMap = est.todayStatusByProcess([rep("p1", "dailyStart", "08:05"), rep("p2", "dailyStart", "09:10"), rep("p3", "finish", "16:30"), rep("p3", "dailyStart", "08:00")], at("17:00"));
eq("兩道工序都開工 → 取較晚的 09:10", c.latestTodayEntry(todayMap, ["p1", "p2"]).time, "09:10");
eq("收工那道最新 → 已收工", c.latestTodayEntry(todayMap, ["p1", "p3"]).type, "finish");
eq("沒有報工 → null", c.latestTodayEntry(todayMap, ["zz"]), null);

console.log("== 機台格 ==");
// A01 正常、A02 今日未開工、A03 未報工（缺中午）、A04 超量＋逾期、A05 無工單、B03 可能加班
const reports = [
  rep("a1", "dailyStart", "08:05"), rep("a1", "noon", "12:00"),
  rep("a3", "dailyStart", "08:10"),
  rep("a4", "dailyStart", "08:00"), rep("a4", "noon", "12:01"),
  rep("b3", "dailyStart", "08:20"), rep("b3", "noon", "12:30"),
];
const order = (id, extra = {}) => ({ id, part: `零件${id}`, process: "車削", done: 100, total: 400, dueDate: "2026-10-20", ...extra });
const inputs = [
  { code: "A01", key: "A01", alias: "小瀧澤", order: order("WO1"), processIds: ["a1"] },
  { code: "A02", key: "A02", order: order("WO2", { done: 0 }), processIds: ["a2"] },
  { code: "A03", key: "A03", order: order("WO3"), processIds: ["a3"] },
  { code: "A04", key: "A04", order: order("WO4", { done: 689, total: 536, dueDate: "2026-10-01" }), processIds: ["a4"] },
  { code: "A05", key: "A05", order: null, processIds: [] },
  { code: "B03", key: "B03", order: order("WO6", { done: 400, total: 400 }), processIds: ["b3"] },
];
const summaryAt = (hhmm) => today.summarize({ machines: inputs.map((m) => ({ key: m.key, hasOrder: Boolean(m.order), processIds: m.processIds })), reports, nowMs: at(hhmm) });
const build = (hhmm) => c.buildModel({ machinesByCode: new Map(inputs.map((m) => [m.code, m])), summary: summaryAt(hhmm), todayMap: est.todayStatusByProcess(reports, at(hhmm)), nowMs: at(hhmm) });
const cellOf = (model, code) => model.lines.flatMap((l) => l.machines).find((m) => m.code === code);

const m1330 = build("13:30");
eq("兩排：車床 5 台、銑床 6 台", m1330.lines.map((l) => [l.title, l.machines.map((m) => m.code)]), [["車床", ["A01", "A02", "A03", "A04", "A05"]], ["銑床", ["B01", "B02", "B03", "B04", "B05", "B06"]]]);
eq("時鐘", [m1330.clock.time, m1330.clock.date], ["13:30", "10/03"]);
eq("三格 13:30：未開工 1（A02）、未報工 1（A03）、可能加班「—」", m1330.tiles.map((t) => [t.kind, t.value, t.tone]), [["notStarted", "1", "notStarted"], ["unreported", "1", "unreported"], ["overtime", "—", "na"]]);
const a1 = cellOf(m1330, "A01");
eq("A01 正常：開工時間、已報／訂單、沒有標籤、沒有色條", [a1.today, a1.done, a1.total, a1.percent, a1.bar, a1.tags, a1.severity, a1.alias, a1.part], [{ tone: "started", text: "08:05 開工" }, 100, 400, 25, 25, [], "", "小瀧澤", "零件WO1"]);
const a2 = cellOf(m1330, "A02");
eq("A02 今日未開工（上色）", [a2.today, a2.severity], [{ tone: "notStarted", text: "今日未開工" }, "notStarted"]);
const a3 = cellOf(m1330, "A03");
eq("A03 未報工・缺中午（紅）", [a3.tags, a3.severity], [[{ kind: "unreported", label: "未報工・缺中午" }], "unreported"]);
const a4 = cellOf(m1330, "A04");
eq("A04 超量 +153（128%，進度條滿格）＋逾期 2 天", [a4.tags, a4.percent, a4.bar, a4.severity], [[{ kind: "over", label: "超量 +153" }, { kind: "overdue", label: "逾期 2 天" }], 128, 100, "over"]);
const a5 = cellOf(m1330, "A05");
eq("A05 無工單（中性）", [a5.hasOrder, a5.today, a5.tags, a5.severity, a5.done], [false, { tone: "idle", text: "無工單" }, [], "", null]);
const b3 = cellOf(m1330, "B03");
eq("B03 已報滿（不是異常、不上色）", [b3.full, b3.over, b3.fullNote, b3.tags, b3.severity], [true, 0, "已報滿", [], ""]);
const b1 = cellOf(m1330, "B01");
eq("沒有資料的機台（B01）照樣佔一格", [b1.found, b1.hasOrder, b1.today.tone], [false, false, "idle"]);

const m1800 = build("18:00");
eq("18:00：A04、B03 未收工（可能加班）；A01 也還沒收工", m1800.tiles.find((t) => t.kind === "overtime").keys, ["A01", "A04", "B03"]);
eq("B03 標籤＝未收工・可能加班（黃）", [cellOf(m1800, "B03").tags, cellOf(m1800, "B03").severity], [[{ kind: "overtime", label: "未收工・可能加班" }], "overtime"]);
const m2100 = build("21:00");
eq("21:00：A03 同時缺中午和收工 → 一個標籤", cellOf(m2100, "A03").tags, [{ kind: "unreported", label: "未報工・缺中午、收工" }]);
eq("21:00：A01 缺收工", cellOf(m2100, "A01").tags, [{ kind: "unreported", label: "未報工・缺收工" }]);

const m0800 = build("08:00");
eq("08:00 三格都是「—」（還沒到計算時間）", m0800.tiles.map((t) => t.value), ["—", "—", "—"]);
eq("08:00 有工單沒開工 → 「尚未開工」中性、不上色", [cellOf(m0800, "A02").today, cellOf(m0800, "A02").severity], [{ tone: "none", text: "尚未開工" }, ""]);

const zero = c.headerTiles(today.summarize({ machines: [], reports: [], nowMs: at("14:00") }));
eq("0 台＝中性（不上色）", zero.map((t) => [t.value, t.tone]), [["0", "zero"], ["0", "zero"], ["—", "na"]]);
eq("沒有 summary（讀不到今日報工）→ 三格「—」", c.headerTiles(null).map((t) => [t.value, t.tone]), [["—", "na"], ["—", "na"], ["—", "na"]]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
