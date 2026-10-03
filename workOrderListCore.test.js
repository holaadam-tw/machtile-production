// 純邏輯測試，無相依：repo 根目錄執行 `node workOrderListCore.test.js`
const c = require("./workOrderListCore.js");
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got  " + g + "\n        want " + w); }
};

console.log("== sourceOf ==");
eq("created_by null → 舊 MES 派工（推斷）", c.sourceOf({ created_by: null }), { kind: "legacy", label: "舊 MES 派工", basis: "created_by_null", createdBy: null });
eq("created_by 有值 → App 手動", c.sourceOf({ created_by: "u-1" }), { kind: "app", label: "App 手動", basis: "created_by", createdBy: "u-1" });
eq("空白 created_by 當 null", c.sourceOf({ created_by: "  " }).kind, "legacy");
eq("source_system null 時退回 created_by（即使舊欄位有值）", c.sourceOf({ created_by: "u-1", legacy_mes_source: "SoftNet", legacy_work_order_no: "X" }).basis, "created_by");
eq("source_system null 且 created_by null 時以舊資料規則判斷", c.sourceOf({ legacy_mes_source: "SoftNet" }).basis, "created_by_null");
eq("source_system=softnet → 舊 MES", c.sourceOf({ source_system: "softnet_aps", created_by: "u-1" }).kind, "legacy");
eq("source_system=app_manual 優先於 created_by null", c.sourceOf({ source_system: "app_manual", created_by: null }).kind, "app");
eq("source_system=softnet_bridge 優先於 created_by 有值", c.sourceOf({ source_system: "softnet_bridge", created_by: "u-1" }).createdBy, null);
eq("undefined source_system 也退回 created_by", c.sourceOf({ source_system: undefined, created_by: "u-2" }).basis, "created_by");
eq("空字串 source_system 視為已明確填值，不退回 created_by", c.sourceOf({ source_system: "", created_by: "u-2" }).basis, "source_system");
eq("null 列安全", c.sourceOf(null).kind, "legacy");

console.log("== dueState / dueNote ==");
const today = "2026-10-02";
eq("昨天 → overdue", c.dueState({ due_date: "2026-10-01" }, today), "overdue");
eq("今天 → soon（今天不算逾期）", c.dueState({ due_date: "2026-10-02" }, today), "soon");
eq("3 天後 → soon", c.dueState({ due_date: "2026-10-05" }, today), "soon");
eq("4 天後 → ok", c.dueState({ due_date: "2026-10-06" }, today), "ok");
eq("沒有交期 → none", c.dueState({ due_date: null }, today), "none");
eq("已完工的逾期單不標紅 → closed", c.dueState({ due_date: "2026-01-01", status: "completed" }, today), "closed");
eq("跨月", c.dueState({ due_date: "2026-09-30" }, today), "overdue");
eq("帶時間的 ISO 只看日期", c.dueState({ due_date: "2026-10-02T23:00:00Z" }, today), "soon");
eq("逾期天數", c.dueNote({ due_date: "2026-09-28" }, today), "逾期 4 天");
eq("今天到期", c.dueNote({ due_date: today }, today), "今天到期");
eq("剩 2 天", c.dueNote({ due_date: "2026-10-04" }, today), "剩 2 天");
eq("遠的不標", c.dueNote({ due_date: "2026-12-04" }, today), "");
eq("localToday 用本地日期", c.localToday(new Date(2026, 9, 2, 23, 59)), "2026-10-02");

console.log("== sortRows ==");
const rows = [
  { work_order_no: "C", due_date: "2026-10-20" },
  { work_order_no: "Z", due_date: "2026-01-01", status: "completed" },
  { work_order_no: "N", due_date: null },
  { work_order_no: "B", due_date: "2026-09-01" },
  { work_order_no: "A", due_date: "2026-10-20" },
];
eq("交期最早在上、同交期照單號、沒交期在後、已結案最後", c.sortRows(rows).map((r) => r.work_order_no), ["B", "A", "C", "N", "Z"]);
eq("不改原陣列", rows.map((r) => r.work_order_no), ["C", "Z", "N", "B", "A"]);

console.log("== 搜尋 ==");
const r1 = { work_order_no: "XX01202609290006", part_name: "HCG-06 本體", part_no: "HCG-06-01" };
eq("單號片段", c.matchesQuery(r1, "0929"), true);
eq("品名（不分大小寫、忽略空白）", c.matchesQuery(r1, "hcg-06本體"), true);
eq("品號", c.matchesQuery(r1, "06-01"), true);
eq("全形空白", c.matchesQuery(r1, "　本體 "), true);
eq("不符合", c.matchesQuery(r1, "CPDF"), false);
eq("空字串全部符合", c.matchesQuery(r1, ""), true);

console.log("== 篩選 ==");
const set = [
  { work_order_no: "L1", due_date: "2026-09-01", created_by: null },
  { work_order_no: "L2", due_date: "2026-11-01", created_by: null },
  { work_order_no: "M1", due_date: "2026-09-15", created_by: "u-1" },
  { work_order_no: "D1", due_date: "2026-09-01", created_by: null, status: "completed" },
];
eq("全部（排序後）", c.filterRows(set, { filter: "all", today }).map((r) => r.work_order_no), ["L1", "M1", "L2", "D1"]);
eq("逾期（已結案不算）", c.filterRows(set, { filter: "overdue", today }).map((r) => r.work_order_no), ["L1", "M1"]);
eq("舊 MES 派工", c.filterRows(set, { filter: "legacy", today }).map((r) => r.work_order_no), ["L1", "L2", "D1"]);
eq("App 手動", c.filterRows(set, { filter: "app", today }).map((r) => r.work_order_no), ["M1"]);
eq("篩選＋搜尋", c.filterRows(set, { filter: "legacy", query: "l2", today }).map((r) => r.work_order_no), ["L2"]);
eq("counts", c.counts(set, today), { all: 4, overdue: 2, legacy: 3, app: 1 });

console.log("== progressPercent ==");
eq("一半", c.progressPercent(50, 100), 50);
eq("超量封頂", c.progressPercent(150, 100), 100);
eq("數量 0", c.progressPercent(5, 0), 0);
eq("負數當 0", c.progressPercent(-3, 10), 0);

console.log("== needsReassignConfirm ==");
const legacy = c.sourceOf({ created_by: null });
const app = c.sourceOf({ created_by: "u" });
eq("舊 MES 單改機台 → 跳", c.needsReassignConfirm({ source: legacy, machine_code: "A01" }, "A02"), true);
eq("舊 MES 單改成暫不指派 → 跳", c.needsReassignConfirm({ source: legacy, machine_code: "A01" }, ""), true);
eq("舊 MES 單原本沒指派、現在指派 → 跳", c.needsReassignConfirm({ source: legacy, machine_code: "" }, "B01"), true);
eq("舊 MES 單機台不變 → 不跳", c.needsReassignConfirm({ source: legacy, machine_code: "A01" }, "A01"), false);
eq("App 手動單改機台 → 不跳", c.needsReassignConfirm({ source: app, machine_code: "A01" }, "A02"), false);
eq("新單 → 不跳", c.needsReassignConfirm(null, "A02"), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
