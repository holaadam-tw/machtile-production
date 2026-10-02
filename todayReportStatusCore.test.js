// 純邏輯測試，無相依：repo 根目錄執行 `node todayReportStatusCore.test.js`
const c = require("./todayReportStatusCore.js");
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got  " + g + "\n        want " + w); }
};

const DAY = "2026-10-02";
const at = (hhmm, day = DAY) => Date.parse(`${day}T${hhmm}:00+08:00`);
const iso = (hhmm, day = DAY) => new Date(at(hhmm, day)).toISOString();
const rep = (pid, type, hhmm, day = DAY) => ({ process_id: pid, report_type: type, ended_at: iso(hhmm, day), created_at: iso(hhmm, day) });

console.log("== 台灣時間（跟執行環境時區無關）==");
eq("UTC 00:29 → 台灣 08:29", c.taipeiParts(Date.parse("2026-10-02T00:29:00Z")), { date: "2026-10-02", minute: 509 });
eq("UTC 16:30 前一天 → 台灣隔天 00:30", c.taipeiParts(Date.parse("2026-10-01T16:30:00Z")), { date: "2026-10-02", minute: 30 });
eq("壞值 → null", c.taipeiParts("not a date"), null);
const savedTZ = process.env.TZ;
process.env.TZ = "America/Los_Angeles";
eq("TZ=America/Los_Angeles 下照樣是台灣 08:31", c.phaseAt(at("08:31")).time, "08:31");
process.env.TZ = savedTZ;

// 機台：
//  A01 有工單、今天 08:05 開工、11:50 中午報工、17:30 收工
//  A02 有工單、今天沒開工（昨天有開工）
//  A03 有工單、今天開工、沒中午、沒收工（同時缺兩樣 → 只算 1 台）
//  A04 有工單、今天開工、有中午、沒收工（加班候選）
//  A05 空閒無工單（今天沒報工，不算未開工）
//  B03 有工單、開工＋中午報工在「還掛的另一張單」上（同一台多張單合起來看）
//  B04 有工單、開工後 12:00 就收工（提早收工，不算缺中午）
//  B05 空閒無工單，但今天有開工＋中午（只要開工就看報工；有中午、沒收工 → 加班候選）
const machines = [
  { key: "A01", hasOrder: true, processIds: ["p1"] },
  { key: "A02", hasOrder: true, processIds: ["p2"] },
  { key: "A03", hasOrder: true, processIds: ["p3"] },
  { key: "A04", hasOrder: true, processIds: ["p4"] },
  { key: "A05", hasOrder: false, processIds: [] },
  { key: "B03", hasOrder: true, processIds: ["p6", "p6b"] },
  { key: "B04", hasOrder: true, processIds: ["p7"] },
  { key: "A01", hasOrder: true, processIds: ["p1"] },          // 重複 → 只算一次
];
const reports = [
  rep("p1", "dailyStart", "08:05"), rep("p1", "noon", "11:50"), rep("p1", "finish", "17:30"),
  rep("p2", "dailyStart", "08:00", "2026-10-01"), rep("p2", "noon", "12:00", "2026-10-01"),
  rep("p3", "dailyStart", "08:10"),
  rep("p4", "dailyStart", "08:20"), rep("p4", "noon", "12:10"),
  rep("p6b", "dailyStart", "08:15"), rep("p6", "noon", "12:20"),
  rep("p7", "dailyStart", "08:00"), rep("p7", "finish", "12:00"),
  rep("p1", "workStart", "08:00"), // 不是今天的報工類型 → 忽略
];
// 實際上報工時間在「現在」之後的不會出現；測試只看現在之前的報工
const upTo = (hhmm) => reports.filter((r) => Date.parse(r.ended_at) <= at(hhmm));
const sum = (hhmm, rows = upTo(hhmm)) => c.summarize({ machines, reports: rows, nowMs: at(hhmm) });
const brief = (s) => ({
  notStarted: [s.notStarted.count, s.notStarted.keys, s.notStarted.tone],
  unreported: [s.unreported.count, s.unreported.keys, s.unreported.tone],
  overtime: [s.overtime.count, s.overtime.keys, s.overtime.tone],
});

console.log("== 08:29 / 08:31 ==");
eq("08:29：三格都不計算（—）", brief(sum("08:29")), {
  notStarted: [null, [], "na"], unreported: [null, [], "na"], overtime: [null, [], "na"],
});
eq("08:31：未開工＝A02（昨天開工不算）；A05 空閒不算", brief(sum("08:31")).notStarted, [1, ["A02"], "notStarted"]);
eq("08:31：未報工、加班都還不計算", [sum("08:31").unreported.active, sum("08:31").overtime.active], [false, false]);

console.log("== 12:59 / 13:01 ==");
eq("12:59：未報工還不計算", [sum("12:59").unreported.count, sum("12:59").unreported.hint], [null, "13:00 起計算"]);
eq("13:01：未報工＝A03（沒中午）；B03 中午報在另一張單也算有；B04 提早收工不算", brief(sum("13:01")).unreported, [1, ["A03"], "unreported"]);
eq("13:01：A03 原因＝缺中午", sum("13:01").unreported.reasons, { A03: ["noon"] });
eq("13:01：加班不計算", sum("13:01").overtime.count, null);

console.log("== 17:14 / 17:16 ==");
eq("17:14：加班還不計算", [sum("17:14").overtime.count, sum("17:14").overtime.tone], [null, "na"]);
eq("17:16：可能加班＝A01（17:30 才收工）、A04、B03；A03 已算未報工不重複", brief(sum("17:16")).overtime, [3, ["A01", "A04", "B03"], "overtime"]);
eq("17:16：未報工仍只有 A03", brief(sum("17:16")).unreported, [1, ["A03"], "unreported"]);
eq("17:31：A01 收工了 → 可能加班＝A04、B03", brief(sum("17:31")).overtime, [2, ["A04", "B03"], "overtime"]);

console.log("== 20:44 / 20:46 ==");
eq("20:44：還在加班時段，A04、B03 是可能加班，不算未報工", [brief(sum("20:44")).overtime, brief(sum("20:44")).unreported], [[2, ["A04", "B03"], "overtime"], [1, ["A03"], "unreported"]]);
eq("20:45 整：加班時段結束", sum("20:45").overtime.active, false);
eq("20:46：沒收工的 A03、A04、B03 都算未報工（紅）", brief(sum("20:46")).unreported, [3, ["A03", "A04", "B03"], "unreported"]);
eq("20:46：A03 同時缺中午和收工 → 只算 1 台（原因兩個）", sum("20:46").unreported.reasons.A03, ["noon", "finish"]);
eq("20:46：加班格回到「—」", [sum("20:46").overtime.count, sum("20:46").overtime.hint], [null, "只在 17:15–20:45 計算"]);
eq("20:46：未開工仍是 A02", sum("20:46").notStarted.keys, ["A02"]);

console.log("== 加班後收工 ==");
const lateFinish = [...upTo("20:44"), rep("p4", "finish", "19:40")];
eq("A04 19:40 收工（加班完）→ 20:44 可能加班只剩 B03", brief(sum("20:44", lateFinish)).overtime, [1, ["B03"], "overtime"]);
eq("A04 19:40 收工 → 20:46 不算未報工", brief(sum("20:46", lateFinish)).unreported, [2, ["A03", "B03"], "unreported"]);

console.log("== 空閒機台、同一台不重複 ==");
const idleStarted = c.summarize({
  machines: [{ key: "A05", hasOrder: false, processIds: [] }, { key: "B05", hasOrder: false, processIds: ["p9"] }],
  reports: [rep("p9", "dailyStart", "08:00"), rep("p9", "noon", "12:00")],
  nowMs: at("13:30"),
});
eq("空閒、無工單、沒開工 → 不算未開工（0 台，綠）", [idleStarted.notStarted.count, idleStarted.notStarted.tone], [0, "ok"]);
eq("同一台列兩次 → 只算一次", sum("08:31").notStarted.keys.filter((k) => k === "A02").length, 1);
const dup = c.summarize({ machines: [{ key: "A03", hasOrder: true, processIds: ["p3", "p3"] }], reports: [rep("p3", "dailyStart", "08:00"), rep("p3", "dailyStart", "08:30")], nowMs: at("21:00") });
eq("兩筆開工、缺中午又缺收工 → 1 台", dup.unreported.count, 1);

console.log("== 0 台＝綠、沒有資料 ==");
const allGood = c.summarize({ machines: [{ key: "A01", hasOrder: true, processIds: ["p1"] }], reports, nowMs: at("18:00") });
eq("全部都報了 → 三格 0、綠（加班格 0 台也是綠）", [allGood.notStarted.tone, allGood.unreported.tone, allGood.overtime.tone, allGood.overtime.count], ["ok", "ok", "ok", 0]);
eq("沒有報工資料、沒有機台 → 0", c.summarize({ machines: [], reports: null, nowMs: at("14:00") }).notStarted.count, 0);

console.log("== 報工時間用 ended_at（離線補送 created_at 晚）、跨日 ==");
const offline = [{ process_id: "p1", report_type: "dailyStart", ended_at: iso("23:50", "2026-10-01"), created_at: iso("00:10") }];
eq("ended_at 是昨天 → 不算今天開工", c.todayTypesByProcess(offline, at("09:00")).size, 0);
const noEnded = [{ process_id: "p1", report_type: "dailyStart", ended_at: null, created_at: iso("08:00") }];
eq("沒有 ended_at → 用 created_at", [...(c.todayTypesByProcess(noEnded, at("09:00")).get("p1") || [])], ["dailyStart"]);

console.log("== 下一個切換點 ==");
eq("08:29:30 → 30 秒後到 08:30", c.msUntilNextBoundary(at("08:29") + 30000), 30000);
eq("13:00 整 → 下一個是 17:15", c.msUntilNextBoundary(at("13:00")), (17 * 60 + 15 - 13 * 60) * 60000);
eq("21:00 → 下一個是午夜", c.msUntilNextBoundary(at("21:00")), 3 * 60 * 60000);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
