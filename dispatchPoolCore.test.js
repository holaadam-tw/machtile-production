// 純邏輯測試，無相依：repo 根目錄執行 `node dispatchPoolCore.test.js`
process.env.TZ = "Asia/Taipei";
const c = require("./dispatchPoolCore.js");
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got  " + g + "\n        want " + w); }
};
const item = (o) => Object.assign({ work_order_no: "TEST-WO", process_order: 1, urgency: 2, due_date: "2026-10-20", planned_start: "2026-10-08T00:00:00Z",
  department_code: "LATHE", eligible_machine_codes: ["A02", "A03"] }, o);

console.log("== departmentCodeOf ==");
eq("車床課 → LATHE", c.departmentCodeOf("車床課"), "LATHE");
eq("銑床課 → MILL", c.departmentCodeOf(" 銑床課 "), "MILL");
eq("不從代號猜", c.departmentCodeOf("A01"), "");
eq("未設定課別 → 空", c.departmentCodeOf("未設定課別"), "");

console.log("== sortItems（緊急 → 交期 → 預計開始；未知排最後）==");
const sorted = c.sortItems([
  item({ work_order_no: "W-a", urgency: 3 }),
  item({ work_order_no: "W-b", urgency: 1, due_date: "2026-10-30" }),
  item({ work_order_no: "W-c", urgency: 2, due_date: null }),
  item({ work_order_no: "W-d", urgency: 2, due_date: "2026-10-15", planned_start: null }),
  item({ work_order_no: "W-e", urgency: 2, due_date: "2026-10-15", planned_start: "2026-10-07T00:00:00Z" }),
  item({ work_order_no: "W-f", urgency: null }),
]).map((x) => x.work_order_no);
eq("owner 排序", sorted, ["W-b", "W-e", "W-d", "W-c", "W-a", "W-f"]);
eq("同條件依工單、步序", c.sortItems([item({ process_order: 3 }), item({ process_order: 1 })]).map((x) => x.process_order), [1, 3]);
eq("不改原陣列", (() => { const a = [item({ urgency: 4 }), item({ urgency: 1 })]; c.sortItems(a); return a[0].urgency; })(), 4);
eq("非陣列 → 空", c.sortItems(null), []);

console.log("== itemsForMachine（同課）==");
const pool = [item({ work_order_no: "L1" }), item({ work_order_no: "M1", department_code: "MILL", eligible_machine_codes: ["B03"] }),
  item({ work_order_no: "L2", urgency: 1, eligible_machine_codes: ["A05"] })];
const lathe = c.itemsForMachine(pool, { departmentName: "車床課", machineCode: "A02" });
eq("車床卡只列車床課", lathe.items.map((x) => x.work_order_no), ["L2", "L1"]);
eq("department 回傳代碼", lathe.department, "LATHE");
eq("本機可做標記", lathe.items.map((x) => x.eligibleHere), [false, true]);
eq("銑床卡只列銑床課", c.itemsForMachine(pool, { departmentName: "銑床課", machineCode: "B03" }).items.map((x) => x.work_order_no), ["M1"]);
eq("課別不明的機台不列任何池子工序", c.itemsForMachine(pool, { departmentName: "其他", machineCode: "C01" }), { department: "", items: [] });
eq("不改原資料（不加 eligibleHere）", "eligibleHere" in pool[0], false);
eq("作業員：本機不在可做清單的不列", c.itemsForMachine(pool, { departmentName: "車床課", machineCode: "A02" }, { hideNotEligible: true }).items.map((x) => x.work_order_no), ["L1"]);
eq("作業員：可做清單有本機的照 owner 排序", c.itemsForMachine(pool, { departmentName: "車床課", machineCode: "A05" }, { hideNotEligible: true }).items.map((x) => x.work_order_no), ["L2"]);
eq("沒給 options＝生管：全部同課照列", c.itemsForMachine(pool, { departmentName: "車床課", machineCode: "A05" }).items.length, 2);

console.log("== 顯示文字 ==");
eq("緊急標籤", c.urgencyLabel({ urgency: 1 }), "緊急 1");
eq("緊急未提供", c.urgencyLabel({ urgency: 7 }), "緊急程度未提供");
eq("交期 MM/DD", c.dueText("2026-10-20"), "10/20");
eq("交期未提供", c.dueText(null), "未提供");
eq("預計開始以台灣時間顯示", c.plannedStartText("2026-10-08T00:00:00Z"), "10/08 08:00");
eq("預計開始未提供", c.plannedStartText(""), "未提供");
eq("數量", c.quantityText(120), "120");
eq("數量 null → 未提供（不補 1）", c.quantityText(null), "未提供");
eq("數量 0 → 未提供", c.quantityText(0), "未提供");
eq("最近同步時間", c.latestSyncedAt([{ synced_at: "2026-10-07T01:00:00Z" }, { synced_at: "2026-10-07T02:30:00Z" }]), "10/07 10:30");
eq("沒有同步時間", c.latestSyncedAt([]), "");

console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail) process.exit(1);
