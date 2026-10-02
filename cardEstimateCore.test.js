// 純邏輯測試，無相依：repo 根目錄執行 `node cardEstimateCore.test.js`
const c = require("./cardEstimateCore.js");
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got  " + g + "\n        want " + w); }
};

console.log("== 常數 ==");
eq("一天可加工 430 分", c.WORK_MINUTES_PER_DAY, 430);
eq("預設上下料：車床 60、銑床 180、臥式 180（待拍板）", [c.DEFAULT_LOAD_UNLOAD_SECONDS.lathe, c.DEFAULT_LOAD_UNLOAD_SECONDS.mill, c.DEFAULT_LOAD_UNLOAD_SECONDS.hmc], [60, 180, 180]);
eq("至少 3 筆才採用實績", c.MIN_SAMPLES, 3);

console.log("== 車床／銑床判斷 ==");
eq("正式庫「車床」→ lathe", c.machineKind({ type: "車床" }), "lathe");
eq("正式庫「加工中心」→ mill", c.machineKind({ type: "加工中心" }), "mill");
eq("正式庫「臥式加工中心」→ hmc", c.machineKind({ type: "臥式加工中心" }), "hmc");
eq("「銑床」→ mill", c.machineKind({ type: "銑床" }), "mill");
eq("「五軸」→ mill", c.machineKind({ type: "五軸" }), "mill");
eq("「車銑複合」→ lathe", c.machineKind({ type: "車銑複合" }), "lathe");
eq("英文 lathe／mill", [c.machineKind({ type: "lathe" }), c.machineKind({ type: "milling" })], ["lathe", "mill"]);
eq("機型 other＋課別 車床課 → lathe", c.machineKind({ type: "other", department: "車床課" }), "lathe");
eq("機型 other＋課別 銑床課 → mill", c.machineKind({ type: "other", department: "銑床課" }), "mill");
eq("名稱帶 HMC → hmc", c.machineKind({ type: "other", name: "HMC-01" }), "hmc");
eq("view 欄位名稱（machine_type／department_name）也可以", c.machineKind({ machine_type: "加工中心", department_name: "" }), "mill");
eq("分不出來 → unknown", c.machineKind({ type: "外包站" }), "unknown");
eq("空值 → unknown", c.machineKind(null), "unknown");
eq("unknown 預設上下料用銑床值 180", c.defaultLoadUnloadSeconds("unknown"), 180);

console.log("== productKey ==");
eq("圖號優先", c.productKey({ drawingNo: "dwg-1", partNo: "P-1", partName: "本體", processName: "車削" }), "DWG-1|車削");
eq("沒圖號用品號（正式庫 73/74 張單只有品號）", c.productKey({ drawingNo: null, partNo: "MPW-01-03", partName: "止油閥座", processName: "車削" }), "MPW-01-03|車削");
eq("「-」當沒有，退到品名", c.productKey({ drawingNo: "-", partNo: "", partName: "止油閥座", processName: "車削" }), "止油閥座|車削");
eq("沒有工序名稱 → null", c.productKey({ partNo: "X", processName: "" }), null);
eq("沒有任何品項 → null", c.productKey({ processName: "車削" }), null);

console.log("== median ==");
eq("奇數個", c.median([5, 1, 3]), 3);
eq("偶數個取中間兩個平均", c.median([4, 1, 3, 2]), 2.5);
eq("空 → null", c.median([]), null);
eq("中位數不被離群值拉走（平均會是 1020）", c.median([60, 70, 80, 90, 4800]), 80);

console.log("== perPieceSeconds ==");
const t0 = "2026-10-02T00:00:00.000Z";
const at = (sec) => new Date(Date.parse(t0) + sec * 1000).toISOString();
eq("10 件 1000 秒 → 100 秒／件", c.perPieceSeconds({ completed_qty: 8, defect_qty: 2, started_at: t0, ended_at: at(1000) }), 100);
eq("沒數量 → null", c.perPieceSeconds({ completed_qty: 0, defect_qty: 0, started_at: t0, ended_at: at(1000) }), null);
eq("沒開始時間 → null", c.perPieceSeconds({ completed_qty: 3, started_at: null, ended_at: at(1000) }), null);
eq("時間倒退 → null", c.perPieceSeconds({ completed_qty: 3, started_at: at(10), ended_at: t0 }), null);
eq("每件超過 1 小時 → null（跨夜）", c.perPieceSeconds({ completed_qty: 2, started_at: t0, ended_at: at(2 * 3601) }), null);
eq("剛好 1 小時 → 收", c.perPieceSeconds({ completed_qty: 1, started_at: t0, ended_at: at(3600) }), 3600);

console.log("== buildLoadUnloadStats ==");
{
  const keys = new Map([["pA", "MPW-01-03|車削"], ["pB", "MPW-01-03|車削"], ["pC", "OTHER|銑削"]]);
  const rows = [
    // pA：先填機台加工時間 100 秒（0/0 只改時間），之後三次報工
    { process_id: "pA", created_at: "2026-10-01T01:00:00Z", completed_qty: 0, defect_qty: 0, cycle_time_seconds: 100, started_at: t0, ended_at: t0 },
    { process_id: "pA", created_at: "2026-10-01T02:00:00Z", completed_qty: 10, defect_qty: 0, started_at: t0, ended_at: at(10 * 180) },   // 180/件 → 上下料 80
    { process_id: "pA", created_at: "2026-10-01T03:00:00Z", completed_qty: 9, defect_qty: 1, started_at: t0, ended_at: at(10 * 190) },    // 190/件 → 90
    { process_id: "pA", created_at: "2026-10-01T04:00:00Z", completed_qty: 2, defect_qty: 0, started_at: t0, ended_at: at(2 * 3000) },    // 3000/件 → 2900（跨午休，中位數會忽略）
    // pB：另一張單同產品同工序；機台加工時間後來改成 150
    { process_id: "pB", created_at: "2026-10-02T01:00:00Z", completed_qty: 5, defect_qty: 0, cycle_time_seconds: 150, started_at: t0, ended_at: at(5 * 220) }, // 220 → 70
    { process_id: "pB", created_at: "2026-10-02T02:00:00Z", completed_qty: 5, defect_qty: 0, started_at: t0, ended_at: at(5 * 120) },    // 120 < 150 → 推算 < 0，整筆排除
    { process_id: "pB", created_at: "2026-10-02T03:00:00Z", completed_qty: 1, defect_qty: 0, started_at: t0, ended_at: at(4000) },        // 每件 > 1 小時，排除
    // pC：沒填機台加工時間 → 只有實際每件時間，沒有上下料樣本
    { process_id: "pC", created_at: "2026-10-02T02:00:00Z", completed_qty: 4, defect_qty: 0, started_at: t0, ended_at: at(4 * 300) },
    // 不認得的工序（不在 key 表）→ 不算
    { process_id: "pZ", created_at: "2026-10-02T02:00:00Z", completed_qty: 4, defect_qty: 0, cycle_time_seconds: 10, started_at: t0, ended_at: at(400) },
  ];
  const stats = c.buildLoadUnloadStats(rows, keys);
  const s = stats.get("MPW-01-03|車削");
  eq("跨工單累積（pA＋pB 同一個 key）", s.loadUnloadSamples.slice().sort((a, b) => a - b), [70, 80, 90, 2900]);
  eq("當時的機台加工時間：pB 用 150，不是 pA 的 100", s.loadUnloadSamples.includes(70), true);
  eq("實際每件時間樣本（推算 < 0、> 1 小時的整筆不算）", s.perPieceSamples.slice().sort((a, b) => a - b), [180, 190, 220, 3000]);
  eq("排除 2 筆（< 0、> 1 小時）", s.excluded, 2);
  eq("沒填機台加工時間 → 沒有上下料樣本", stats.get("OTHER|銑削").loadUnloadSamples, []);
  eq("沒填機台加工時間 → 仍有實際每件時間", stats.get("OTHER|銑削").perPieceSamples, [300]);
  eq("不認得的工序不進統計", stats.size, 2);
  eq("keyOfProcess 也可以是物件", c.buildLoadUnloadStats(rows, { pC: "K" }).get("K").perPieceSamples, [300]);
  eq("keyOfProcess 也可以是函式", c.buildLoadUnloadStats(rows, (pid) => (pid === "pC" ? "K" : null)).size, 1);
  eq("報工順序亂也照 created_at 算當時的時間", c.buildLoadUnloadStats(rows.slice().reverse(), keys).get("MPW-01-03|車削").loadUnloadSamples.slice().sort((a, b) => a - b), [70, 80, 90, 2900]);

  console.log("== resolveLoadUnload ==");
  const r = c.resolveLoadUnload({ kind: "lathe", stats: s });
  eq("≥ 3 筆 → 實績中位數（(80+90)/2＝85），不是平均（785）", [r.source, r.seconds, r.samples], ["actual", 85, 4]);
  eq("實際每件時間中位數 (190+220)/2＝205", r.actualPerPieceSec, 205);
  eq("標籤：實績", c.loadUnloadLabel(r), "上下料 1分25秒（實績 4 次）");
  const few = c.resolveLoadUnload({ kind: "lathe", stats: { loadUnloadSamples: [80, 90], perPieceSamples: [180, 190] } });
  eq("只有 2 筆 → 用預設 車床 60", [few.source, few.seconds, few.samples], ["default", 60, 2]);
  eq("樣本不足時，實際每件時間仍給（卡片可顯示實際約 N 個／天）", few.actualPerPieceSec, 185);
  eq("標籤：預設", c.loadUnloadLabel(few), "上下料 1分（預設）");
  const none = c.resolveLoadUnload({ kind: "mill", stats: null });
  eq("沒有樣本 → 銑床預設 180", [none.source, none.seconds, none.actualPerPieceSec, none.actualSamples], ["default", 180, null, 0]);
  eq("臥式 → 180（暫同銑床）", c.resolveLoadUnload({ kind: "hmc" }).seconds, 180);
  eq("不認得的 kind → unknown 180", [c.resolveLoadUnload({ kind: "weird" }).kind, c.resolveLoadUnload({ kind: "weird" }).seconds], ["unknown", 180]);
}

console.log("== dailyEstimate（公式）==");
eq("車床：430 分 ÷（95 秒＋60 秒）＝ 166", c.dailyEstimate(95, 60), 166);
eq("銑床：430 分 ÷（600 秒＋180 秒）＝ 33", c.dailyEstimate(600, 180), 33);
eq("上下料 0 ＝ 舊公式（430 分 ÷ 機台時間）", c.dailyEstimate(95, 0), 271);
eq("可傳入別的分鐘數（中午 210）", c.dailyEstimate(95, 60, c.NOON_MINUTES), 81);
eq("沒有機台加工時間 → null", [c.dailyEstimate(0, 60), c.dailyEstimate(null, 60), c.dailyEstimate("x", 60)], [null, null, null]);
eq("很慢也至少 1 件", c.dailyEstimate(40000, 180), 1);
eq("上下料負值當 0", c.dailyEstimate(95, -10), 271);
eq("實際約 N 個／天＝430 分 ÷ 實際每件時間", c.actualDailyEstimate(190), 135);
eq("沒有實際樣本 → null", c.actualDailyEstimate(null), null);

console.log("== formatDuration ==");
eq("80 秒", c.formatDuration(80), "1分20秒");
eq("60 秒", c.formatDuration(60), "1分");
eq("45 秒", c.formatDuration(45), "45秒");
eq("無效 → -", [c.formatDuration(null), c.formatDuration("x"), c.formatDuration(-1)], ["-", "-", "-"]);

console.log("== 今日開工狀態 ==");
{
  // 現在＝台灣 2026-10-02 10:00（UTC 02:00）
  const now = Date.parse("2026-10-02T02:00:00Z");
  eq("今天 00:00（台灣）", c.todayStartIso(now), "2026-10-01T16:00:00.000Z");
  const rows = [
    { process_id: "p1", report_type: "dailyStart", ended_at: "2026-10-02T00:05:00Z", created_at: "2026-10-02T00:05:01Z", operator_ids: ["u1"], user_id: "u9" }, // 08:05
    { process_id: "p2", report_type: "dailyStart", ended_at: "2026-10-02T00:10:00Z", created_at: "2026-10-02T00:10:01Z", user_id: "u2" },
    { process_id: "p2", report_type: "finish", ended_at: "2026-10-02T09:00:00Z", created_at: "2026-10-02T09:00:01Z", user_id: "u2" },                    // 17:00
    { process_id: "p3", report_type: "dailyStart", ended_at: "2026-10-01T15:59:00Z", created_at: "2026-10-01T15:59:01Z", user_id: "u3" },                // 昨天 23:59
    { process_id: "p4", report_type: "noon", ended_at: "2026-10-02T04:00:00Z", created_at: "2026-10-02T04:00:01Z", user_id: "u4" },                      // 中午報工不算
    { process_id: "p5", report_type: "dailyStart", ended_at: null, created_at: "2026-10-02T00:30:00Z", user_id: "u5" },                                  // 沒 ended_at 用 created_at
  ];
  const m = c.todayStatusByProcess(rows, now);
  const names = { u1: "王小明", u2: "李大華", u5: "陳一" };
  const label = (pid) => c.todayStatusLabel(m.get(pid), (id) => names[id]);
  eq("開工：時間＋報工人（operator_ids 第一位優先）", label("p1"), { tone: "started", text: "今日已開工 08:05・王小明" });
  eq("同一道先開工後收工 → 取最新：收工 17:00", label("p2"), { tone: "finished", text: "今日已收工 17:00" });
  eq("昨天的開工不算 → 今日尚未開工", label("p3"), { tone: "none", text: "今日尚未開工" });
  eq("中午報工不算", m.has("p4"), false);
  eq("沒有 ended_at 用 created_at（08:30）", label("p5"), { tone: "started", text: "今日已開工 08:30・陳一" });
  eq("找不到姓名 → 只顯示時間", c.todayStatusLabel(m.get("p1"), () => ""), { tone: "started", text: "今日已開工 08:05" });
  eq("報工順序亂也取最新", c.todayStatusLabel(c.todayStatusByProcess(rows.slice().reverse(), now).get("p2")).tone, "finished");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
