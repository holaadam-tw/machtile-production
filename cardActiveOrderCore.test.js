// 純邏輯測試，無相依：repo 根目錄執行 `node cardActiveOrderCore.test.js`
const c = require("./cardActiveOrderCore.js");
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got  " + g + "\n        want " + w); }
};

// 原本的規則（app.js machtileCompareScheduleOrders 的簡化版：佇列 → 狀態 → 交期 → 單號）
const RANK = { running: 0, paused: 1, abnormal: 2, pending: 3 };
const fallback = (a, b) => {
  const qa = a.queue ?? Infinity, qb = b.queue ?? Infinity;
  if (qa !== qb) return qa - qb;
  const s = (RANK[a.processStatus] ?? 4) - (RANK[b.processStatus] ?? 4);
  if (s) return s;
  const d = String(a.dueDate || "").localeCompare(String(b.dueDate || ""));
  if (d) return d;
  return String(a.id).localeCompare(String(b.id));
};

console.log("== latestActivity ==");
eq("沒有資料 → null", c.latestActivity(null), null);
eq("全部空白 → null", c.latestActivity({ lastReportAt: null, legacyUpdatedAt: "", actualStartAt: undefined, updatedAt: "not-a-date" }), null);
const la = c.latestActivity({ lastReportAt: "2026-10-01T08:00:00Z", legacyUpdatedAt: "2026-10-02T08:14:47Z", actualStartAt: null, updatedAt: "2026-09-17T08:13:45Z" });
eq("取最新的一個（舊 MES 10-02 16:14）", [la.source, la.at, la.label], ["legacy", "2026-10-02T08:14:47.000Z", "舊 MES 報工"]);
eq("App 報工最新 → report", c.latestActivity({ lastReportAt: "2026-10-02T09:00:00Z", legacyUpdatedAt: "2026-10-02T08:00:00Z" }).source, "report");
eq("只有 updated_at → 不算活動（派工橋同步會更新它）→ null", c.latestActivity({ updatedAt: "2026-10-02T08:19:55Z" }), null);
eq("updated_at 比較新也不看 → 仍是舊 MES 時間", c.latestActivity({ legacyUpdatedAt: "2026-09-07T08:13:37Z", updatedAt: "2026-10-02T09:00:00Z" }).at, "2026-09-07T08:13:37.000Z");
eq("來源只有三項：App 報工、舊 MES、開工", c.SOURCES, ["report", "legacy", "start"]);
eq("同一個時間 → App 報工優先標示", c.latestActivity({ lastReportAt: "2026-10-02T08:00:00Z", legacyUpdatedAt: "2026-10-02T08:00:00Z" }).source, "report");

console.log("== legacyUpdatedAtFor ==");
const legacy = [
  { work_order_no: "XX01202604140005", machine_code: "B04", process_order: 7, legacy_updated_at: "2026-08-27T08:08:13Z" },
  { work_order_no: "XX01202609170004", machine_code: "B04", process_order: 1, legacy_updated_at: "2026-10-02T08:14:47Z" },
  { work_order_no: "XX01202609170004", machine_code: "A02", process_order: 2, legacy_updated_at: "2026-10-02T09:30:00Z" },
  { work_order_no: "XX01202609160002", machine_code: "B01", process_order: 3, legacy_updated_at: "2026-10-02T08:56:56Z" },
  { work_order_no: "XX01202609160002", machine_code: "B01", process_order: 2, legacy_updated_at: "2026-10-02T09:59:00Z" },
];
eq("同單同機台（不管步序）", c.legacyUpdatedAtFor(legacy, { workOrderNo: "XX01202609170004", machineCode: "B04" }), "2026-10-02T08:14:47.000Z");
eq("別台的列不算（A02 那列比較新也不採用）", c.legacyUpdatedAtFor(legacy, { workOrderNo: "XX01202609170004", machineCode: "b04", step: 5 }), "2026-10-02T08:14:47.000Z");
eq("步序對不上（App 第 7 道、舊 MES 第 1 道）→ 仍依機台＋單號對應", c.legacyUpdatedAtFor([legacy[1]], { workOrderNo: "XX01202609170004", machineCode: "B04", step: 7 }), "2026-10-02T08:14:47.000Z");
eq("逐工序（#45）：同台兩道、有同步序 → 用同步序那列", c.legacyUpdatedAtFor(legacy, { workOrderNo: "XX01202609160002", machineCode: "B01", step: 3 }), "2026-10-02T08:56:56.000Z");
eq("沒有步序 → 取這台這張單最新的一列", c.legacyUpdatedAtFor(legacy, { workOrderNo: "XX01202609160002", machineCode: "B01" }), "2026-10-02T09:59:00.000Z");
eq("沒有對應 → null", c.legacyUpdatedAtFor(legacy, { workOrderNo: "XX01202609030001", machineCode: "B06" }), null);
eq("缺單號或機台 → null", [c.legacyUpdatedAtFor(legacy, { machineCode: "B04" }), c.legacyUpdatedAtFor(legacy, { workOrderNo: "XX01202609170004" })], [null, null]);

console.log("== B04 情境（正式庫 2026-10-02 實查）：3 張在站，挑最近活動的那張 ==");
const b04 = [
  { id: "XX01202604140005", part: "A37九孔座", processId: "p-0005", processStatus: "pending", dueDate: "2026-04-30" },
  { id: "XX01202606030002", part: "P08九孔座-AR齒", processId: "p-0002", processStatus: "pending", dueDate: "2026-06-30" },
  { id: "XX01202609170004", part: "CPDF-16本體", processId: "p-0004", processStatus: "pending", dueDate: "2026-10-31" },
];
const b04Activity = {
  "p-0005": { legacyUpdatedAt: "2026-08-27T08:08:13Z", updatedAt: "2026-09-01T01:20:06Z" },
  "p-0002": { legacyUpdatedAt: "2026-09-07T08:12:33Z", updatedAt: "2026-09-01T01:20:06Z" },
  "p-0004": { legacyUpdatedAt: "2026-10-02T08:14:47Z", updatedAt: "2026-09-17T08:13:45Z" },
};
const actOf = (map) => (o) => map[o.processId] || null;
const before = [...b04].sort(fallback)[0];
eq("改前（原本規則：交期最早）→ A37九孔座", before.id, "XX01202604140005");
const p = c.pickActiveOrder(b04, { activityOf: actOf(b04Activity), fallbackCompare: fallback });
eq("改後 → CPDF-16本體（舊 MES 10-02 16:14）", [p.order.id, p.basis, p.latest.source], ["XX01202609170004", "activity", "legacy"]);
eq("這台還掛 2 張", [p.others, c.moreOrdersLabel(p.others)], [2, "這台還掛 2 張"]);
eq("清單依最近活動排（新→舊）", p.ranked.map((x) => x.order.id), ["XX01202609170004", "XX01202606030002", "XX01202604140005"]);

console.log("== B06 情境：今天 16:16 開工的 CRG-10本體 ==");
const b06 = [
  { id: "XX01202609030001", processId: "q1", processStatus: "pending", dueDate: "2026-10-31" },
  { id: "XX01202609030002", processId: "q2", processStatus: "pending", dueDate: "2026-10-31" },
  { id: "XX01202609290017", processId: "q3", processStatus: "pending", dueDate: "2026-11-30" },
];
const b06Act = {
  q1: { legacyUpdatedAt: "2026-09-07T08:13:37Z", updatedAt: "2026-09-07T06:28:05Z" },
  q2: { legacyUpdatedAt: "2026-09-07T08:13:48Z", updatedAt: "2026-09-07T06:28:05Z" },
  q3: { legacyUpdatedAt: "2026-10-02T08:16:24Z", updatedAt: "2026-10-02T08:19:55Z" },
};
eq("改前 → CPDG-10平蓋(小孔)", [...b06].sort(fallback)[0].id, "XX01202609030001");
const p6 = c.pickActiveOrder(b06, { activityOf: actOf(b06Act), fallbackCompare: fallback });
eq("改後 → CRG-10本體（舊 MES 10-02 16:16；updated_at 不算）", [p6.order.id, p6.latest.source, p6.latest.at], ["XX01202609290017", "legacy", "2026-10-02T08:16:24.000Z"]);
const syncTouched = { ...b04Activity, "p-0005": { legacyUpdatedAt: "2026-08-27T08:08:13Z", updatedAt: "2026-10-02T09:30:00Z" } };
eq("派工橋今天同步碰過 A37（updated_at 最新）→ 不會被選，仍是 CPDF-16", c.pickActiveOrder(b04, { activityOf: actOf(syncTouched), fallbackCompare: fallback }).order.id, "XX01202609170004");
eq("只有 updated_at、沒有其他三項 → 退回原本規則", c.pickActiveOrder(b04, { activityOf: () => ({ updatedAt: "2026-10-02T09:30:00Z" }), fallbackCompare: fallback }).basis, "fallback");

console.log("== App 報工時間 ==");
const appAct = { ...b04Activity, "p-0002": { ...b04Activity["p-0002"], lastReportAt: "2026-10-02T09:30:00Z" } };
const pa = c.pickActiveOrder(b04, { activityOf: actOf(appAct), fallbackCompare: fallback });
eq("App 今天 17:30 報了 P08 → 換成 P08", [pa.order.id, pa.latest.source], ["XX01202606030002", "report"]);
const startAct = { ...b04Activity, "p-0005": { actualStartAt: "2026-10-02T10:00:00Z" } };
eq("actual_start_at 最新 → 那張", c.pickActiveOrder(b04, { activityOf: actOf(startAct), fallbackCompare: fallback }).order.id, "XX01202604140005");

console.log("== 沒有活動時間 → 退回原本的規則 ==");
const none = c.pickActiveOrder(b04, { activityOf: () => null, fallbackCompare: fallback });
eq("全部沒有活動 → 交期最早（原本規則）", [none.order.id, none.basis, none.latest], ["XX01202604140005", "fallback", null]);
const queued = b04.map((o) => (o.id === "XX01202606030002" ? { ...o, queue: 1 } : o));
eq("全部沒有活動、有排程佇列 → 佇列第一張（原本規則）", c.pickActiveOrder(queued, { fallbackCompare: fallback }).order.id, "XX01202606030002");
const partial = c.pickActiveOrder(b04, { activityOf: (o) => (o.processId === "p-0002" ? { actualStartAt: "2026-01-01T00:00:00Z" } : null), fallbackCompare: fallback });
eq("只有一張有活動（再舊都算）→ 那張；其他照原本規則排在後面", partial.ranked.map((x) => x.order.id), ["XX01202606030002", "XX01202604140005", "XX01202609170004"]);
const tie = c.pickActiveOrder(b06.slice(0, 2), { activityOf: () => ({ legacyUpdatedAt: "2026-09-07T08:13:37Z" }), fallbackCompare: fallback });
eq("同一個時間 → 用原本規則決定", tie.order.id, "XX01202609030001");
eq("沒有 fallbackCompare 也不會壞（維持原順序）", c.pickActiveOrder(b04, {}).order.id, "XX01202604140005");

console.log("== 手動切換（只改畫面）==");
const m = c.pickActiveOrder(b04, { activityOf: actOf(b04Activity), fallbackCompare: fallback, overrideKey: "p-0005" });
eq("切到 A37 → 顯示 A37、basis=manual、清單順序不變", [m.order.id, m.basis, m.others, m.autoKey, m.ranked[0].order.id], ["XX01202604140005", "manual", 2, "p-0004", "XX01202609170004"]);
eq("切到的就是自動那張 → basis=activity", c.pickActiveOrder(b04, { activityOf: actOf(b04Activity), fallbackCompare: fallback, overrideKey: "p-0004" }).basis, "activity");
eq("切換的那張已不在這台 → 自動回到最近活動", c.pickActiveOrder(b04, { activityOf: actOf(b04Activity), fallbackCompare: fallback, overrideKey: "gone" }).order.id, "XX01202609170004");

console.log("== 還掛 N 張 ==");
eq("只有一張 → others 0、不顯示", [c.pickActiveOrder([b04[0]]).others, c.moreOrdersLabel(0)], [0, ""]);
eq("沒有單 → none", [c.pickActiveOrder([]).order, c.pickActiveOrder([]).basis, c.pickActiveOrder(null).others], [null, "none", 0]);
eq("負數／亂值 → 不顯示", [c.moreOrdersLabel(-1), c.moreOrdersLabel("x")], ["", ""]);

console.log("== orderKey ==");
eq("工序 id 優先、沒有用單號", [c.orderKey({ processId: "p1", id: "W1" }), c.orderKey({ id: "W1" }), c.orderKey(null)], ["p1", "W1", ""]);

console.log("== 批次報工預設 ==");
const cands = [
  { id: "XX01202604140005", processId: "p-0005" },
  { id: "XX01202606030002", processId: "p-0002" },
  { id: "XX01202609170004", processId: "p-0004" },
];
eq("卡片顯示 CPDF-16 → 批次預設 CPDF-16", c.defaultCandidate(cands, b04[2]).processId, "p-0004");
eq("卡片那張不在候選（例：已滿量）→ 候選第一張（原本規則）", c.defaultCandidate(cands, { id: "Z", processId: "zz" }).processId, "p-0005");
eq("卡片沒有單 → 候選第一張", c.defaultCandidate(cands, null).processId, "p-0005");
eq("沒有候選 → null", c.defaultCandidate([], b04[2]), null);
eq("工序 id 對不上（同單另一道）不會用單號硬配到別道", c.defaultCandidate([{ id: "W", processId: "x2" }, { id: "W", processId: "x3" }], { id: "W", processId: "x3" }).processId, "x3");
eq("卡片那道不在候選、同單別道在 → 不硬配，用候選第一張", c.defaultCandidate([{ id: "A", processId: "a1" }, { id: "W", processId: "x2" }], { id: "W", processId: "x9" }).processId, "a1");
eq("示範資料沒有工序 id → 用單號對", c.defaultCandidate([{ id: "A" }, { id: "W" }], { id: "W" }).id, "W");

console.log("== 超量仍在站（owner 2026-10-02：B05 HCG-06 已報 689／訂單 536）==");
const hcg = { id: "XX01202606050003", processId: "p-hcg", machine: "B05", total: 536, done: 689, workStatus: "not_started", processStatus: "pending", offStation: false };
eq("超量、在站、工序 pending → 卡片候選", c.isCardCandidate(hcg), true);
eq("剛好報滿（194/194）→ 卡片候選", c.isCardCandidate({ ...hcg, done: 536 }), true);
eq("未報滿 → 卡片候選", c.isCardCandidate({ ...hcg, done: 10 }), true);
eq("已離站（off_station_at 有值）→ 不顯示", c.isCardCandidate({ ...hcg, offStation: true }), false);
eq("工單 completed → 不顯示", c.isCardCandidate({ ...hcg, workStatus: "completed" }), false);
eq("工單 shipped → 不顯示", c.isCardCandidate({ ...hcg, workStatus: "shipped" }), false);
eq("工單 cancelled → 不顯示", c.isCardCandidate({ ...hcg, workStatus: "cancelled" }), false);
eq("工序 completed → 不顯示", c.isCardCandidate({ ...hcg, processStatus: "completed" }), false);
eq("工序 skipped → 不顯示（原規則）", c.isCardCandidate({ ...hcg, processStatus: "skipped" }), false);
eq("工序 waiting_inspection → 不顯示（原規則）", c.isCardCandidate({ ...hcg, processStatus: "waiting_inspection" }), false);
eq("未排機＋超量 → 維持原規則不顯示", c.isCardCandidate({ ...hcg, machine: "" }, { assigned: false }), false);
eq("未排機＋未滿 → 顯示（原規則）", c.isCardCandidate({ ...hcg, machine: "", done: 1 }, { assigned: false }), true);
eq("null → false", c.isCardCandidate(null), false);
const info = c.overQtyInfo(hcg);
eq("超量資訊 689/536 → +153、128%、進度條 100", [info.full, info.over, info.percent, info.bar], [true, 153, 128, 100]);
eq("超量標籤", c.overQtyLabel(info), "超量 +153");
eq("剛好報滿 → 標「已報滿」", c.overQtyLabel(c.overQtyInfo({ total: 194, done: 194 })), "已報滿");
eq("未滿 → 沒有標籤", c.overQtyLabel(c.overQtyInfo({ total: 536, done: 500 })), "");
eq("訂單數量 0 → 不算超量", c.overQtyInfo({ total: 0, done: 5 }).full, false);
eq("doneOverride（批次用後端進度）", c.overQtyInfo({ total: 100, done: 0 }, 120).over, 20);
eq("報工提醒（超量）", c.overQtyReportWarning(info), "這張單已報良品 689，超過訂單數量 536（超量 +153）。仍可以報工，請確認單號和數量沒有報錯。");
eq("報工提醒（剛好報滿）", c.overQtyReportWarning(c.overQtyInfo({ total: 194, done: 194 })), "這張單已報良品 194，已達訂單數量 194。仍可以報工，請確認單號和數量沒有報錯。");
eq("未滿 → 沒有提醒", c.overQtyReportWarning(c.overQtyInfo({ total: 536, done: 1 })), "");
// 「最近活動」挑單規則不變，超量單照樣參與：B05 只有 HCG-06 在候選（另兩張工單 completed）
const b05 = [hcg, { ...hcg, id: "XX01202605220021", processId: "p-ar16", total: 317, done: 0, workStatus: "completed" }, { ...hcg, id: "XX01202601210013", processId: "p-a37", total: 111, done: 0, workStatus: "completed" }].filter((o) => c.isCardCandidate(o));
const b05pick = c.pickActiveOrder(b05, { activityOf: (o) => (o.processId === "p-hcg" ? { legacyUpdatedAt: "2026-10-02T08:15:16Z" } : null), fallbackCompare: fallback });
eq("B05 卡片＝HCG-06（依舊 MES 活動）", [b05pick.order && b05pick.order.id, b05pick.basis, b05pick.others], ["XX01202606050003", "activity", 0]);
const mixed = c.pickActiveOrder([{ ...hcg, processId: "p-old", id: "OLD", done: 1 }, hcg], { activityOf: (o) => ({ legacyUpdatedAt: o.processId === "p-hcg" ? "2026-10-02T08:15:16Z" : "2026-09-01T00:00:00Z" }), fallbackCompare: fallback });
eq("超量單活動較新 → 挑超量單", mixed.order.processId, "p-hcg");
const mixed2 = c.pickActiveOrder([{ ...hcg, processId: "p-new", id: "NEW", done: 1 }, hcg], { activityOf: (o) => ({ legacyUpdatedAt: o.processId === "p-hcg" ? "2026-09-01T00:00:00Z" : "2026-10-02T09:00:00Z" }), fallbackCompare: fallback });
eq("另一張活動較新 → 挑另一張，超量單排在「這台還掛」", [mixed2.order.processId, mixed2.others], ["p-new", 1]);

// ---- 清單的最後活動：相對時間（本地時間；用 new Date(年,月,日,時,分) 建，跟時區無關）----
const L = (y, mo, d, h, mi, sec = 0) => new Date(y, mo - 1, d, h, mi, sec).getTime();
const NOW = L(2026, 10, 2, 20, 30);
eq("30 秒前 → 剛剛", c.relativeActivityText(NOW - 30000, NOW), "剛剛");
eq("時間在未來（時鐘差）→ 剛剛", c.relativeActivityText(NOW + 5 * 60000, NOW), "剛剛");
eq("5 分鐘前", c.relativeActivityText(NOW - 5 * 60000, NOW), "5 分鐘前");
eq("59 分 59 秒前 → 59 分鐘前", c.relativeActivityText(NOW - 59 * 60000 - 59000, NOW), "59 分鐘前");
eq("今天 17:20 → 3 小時前（無條件捨去）", c.relativeActivityText(L(2026, 10, 2, 17, 20), NOW), "3 小時前");
eq("今天 00:05 → 20 小時前", c.relativeActivityText(L(2026, 10, 2, 0, 5), NOW), "20 小時前");
eq("昨天 16:57", c.relativeActivityText(L(2026, 10, 1, 16, 57, 12), NOW), "昨天 16:57");
eq("昨天 23:50", c.relativeActivityText(L(2026, 10, 1, 23, 50), NOW), "昨天 23:50");
eq("凌晨 00:30 看昨天 23:50 → 40 分鐘前", c.relativeActivityText(L(2026, 10, 1, 23, 50), L(2026, 10, 2, 0, 30)), "40 分鐘前");
eq("前天以前、同一年 → 月/日 時:分", c.relativeActivityText(L(2026, 9, 29, 17, 5), NOW), "09/29 17:05");
eq("月初看上個月最後一天 → 昨天", c.relativeActivityText(L(2026, 9, 30, 8, 0), L(2026, 10, 1, 9, 0)), "昨天 08:00");
eq("去年 → 年/月/日", c.relativeActivityText(L(2025, 12, 31, 9, 0), NOW), "2025/12/31");
eq("ISO 字串也可以", c.relativeActivityText(new Date(NOW - 2 * 3600000).toISOString(), NOW), "2 小時前");
eq("沒有時間 → 空字串", c.relativeActivityText(null, NOW), "");
eq("壞時間 → 空字串", c.relativeActivityText("not-a-date", NOW), "");
eq("來源短字", [c.SOURCE_SHORT.report, c.SOURCE_SHORT.legacy, c.SOURCE_SHORT.start], ["App 報工", "舊 MES", "開工"]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
