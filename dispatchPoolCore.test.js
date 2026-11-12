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
eq("入口數量只算此機 eligible，不算同課全部", c.eligibleCount(lathe.items, "A02"), 1);
eq("空白機台沒有 eligible", c.eligibleCount(lathe.items, ""), 0);
eq("作業員：本機不在可做清單的不列", c.itemsForMachine(pool, { departmentName: "車床課", machineCode: "A02" }, { hideNotEligible: true }).items.map((x) => x.work_order_no), ["L1"]);
eq("作業員：可做清單有本機的照 owner 排序", c.itemsForMachine(pool, { departmentName: "車床課", machineCode: "A05" }, { hideNotEligible: true }).items.map((x) => x.work_order_no), ["L2"]);
eq("沒給 options＝生管：全部同課照列", c.itemsForMachine(pool, { departmentName: "車床課", machineCode: "A05" }).items.length, 2);

console.log("== claim（旗標＋站型＋空閒＋eligible）==");
eq("既有接單 RPC 不增加參數", c.claimArgs(" pool-1 ", " A01 "), { p_source_key: "pool-1", p_machine_code: "A01" });
eq("改掛 RPC 明確送 true", c.claimArgs("pool-1", "A04", true), { p_source_key: "pool-1", p_machine_code: "A04", p_replace_stopped: true });
eq("只有 admin/planner 可釋放，不含 operator/manager", ["operator", "manager", "planner", "admin"].map(c.canRelease), [false, false, true, true]);
eq("釋放 RPC 只帶 source key", c.releaseArgs(" pool-1 "), { p_source_key: "pool-1" });
eq("只有 planner/admin 可退回", ["operator", "manager", "planner", "admin"].map(c.canReturn), [false, false, true, true]);
eq("退回 RPC 參數去除前後空白", c.returnArgs(" pool-1 ", " 排程調整 "), { p_source_key: "pool-1", p_reason: "排程調整" });
eq("旗標未開不能接", c.claimState(item({ eligible_machine_codes: ["A01"] }), { machineCode: "A01", status: "idle", hasOrder: false }, []), { enabled: false, reason: "此機台尚未開放接單" });
eq("未知站型預設 single", c.stationMode({}), "single");
eq("只有明確 multi 才是多工", c.stationMode({ stationMode: "multi" }), "multi");
eq("A04 single 忙機不能接", c.claimState(item({ eligible_machine_codes: ["A04"] }), { machineCode: "A04", stationMode: "single", status: "running", hasOrder: true }, ["A04"]), { enabled: false, reason: "單工站必須空閒且沒有工單" });
eq("A04 single idle 且無工單可接", c.claimState(item({ eligible_machine_codes: ["A04"] }), { machineCode: "A04", stationMode: "single", status: "idle", hasOrder: false }, ["A04"]), { enabled: true, reason: "" });
eq("B04 multi running 且已有工單仍可接", c.claimState(item({ eligible_machine_codes: ["B04"] }), { machineCode: "B04", stationMode: "multi", status: "running", hasOrder: true }, ["B04"]), { enabled: true, reason: "" });
eq("B04 multi paused 且已有兩張 active 工序仍可接", c.claimState(item({ eligible_machine_codes: ["B04"] }), { machineCode: "B04", stationMode: "multi", status: "paused", hasOrder: true, activeOrderCount: 2 }, ["B04"]), { enabled: true, reason: "" });
eq("multi 維修中仍不可接", c.claimState(item({ eligible_machine_codes: ["B04"] }), { machineCode: "B04", stationMode: "multi", status: "maintenance", hasOrder: false }, ["B04"]), { enabled: false, reason: "機台目前不可接單" });
eq("不在 eligible list 不能接", c.claimState(item({ eligible_machine_codes: ["A03"] }), { machineCode: "A01", status: "idle", hasOrder: false }, ["A01"]), { enabled: false, reason: "此機台不在可做清單" });
eq("pilot 空閒 eligible 可接", c.claimState(item({ eligible_machine_codes: ["A01", "A03"] }), { machineCode: "A01", status: "idle", hasOrder: false }, ["A01", "A03"]), { enabled: true, reason: "" });
const stopped = { machineCode: "A04", status: "paused", hasOrder: true, order: { id: "OLD", stationStep: 6 } };
eq("主管可看且可改掛 eligible 停工機", c.replaceStoppedState(item({ eligible_machine_codes: ["A04"] }), stopped, "manager", ["A04"]), { enabled: true, visible: true, reason: "" });
eq("管理員可看且可改掛 eligible 停工機", c.replaceStoppedState(item({ eligible_machine_codes: ["A04"] }), stopped, "admin", ["A04"]), { enabled: true, visible: true, reason: "" });
eq("作業員完全看不到改掛", c.replaceStoppedState(item({ eligible_machine_codes: ["A04"] }), stopped, "operator", ["A04"]).visible, false);
eq("主管在生產中看不到改掛", c.replaceStoppedState(item({ eligible_machine_codes: ["A04"] }), { ...stopped, status: "running" }, "manager", ["A04"]).visible, false);
eq("搶輸顯示原因", c.claimErrorText(new Error("409 POOL_ITEM_NOT_WAITING")), "這張單已被別台接走。");
eq("server 判定非空閒", c.claimErrorText(new Error("MACHINE_NOT_IDLE")), "機台已不是空閒狀態，請重新整理。");
const claimErrors = {
  "UNACKNOWLEDGED_CLAIM_EXISTS: 尚有未確認接單": "這張單已有未確認的接單，請找生管釋放。",
  MACHINE_ALREADY_ASSIGNED: "機台還有未完成的工單。",
  MACHINE_NOT_ELIGIBLE: "這台機台不在這張單的可做清單。",
  MACHINE_DEPARTMENT_MISMATCH: "這張單不屬於這台機台的課別。",
  DEPARTMENT_ACCESS_DENIED: "你沒有這張單所屬課別的權限。",
  PROCESS_ALREADY_ASSIGNED: "這道工序已排到其他機台。",
  POOL_ITEM_INCOMPLETE: "待做池資料不完整，請生管確認。",
  DISPATCH_POOL_CLAIM_DISABLED: "接單功能尚未由系統端開啟。",
  AUTH_REQUIRED: "登入已失效，請重新登入。",
  TENANT_REQUIRED: "找不到公司資料，請重新登入或聯絡管理員。",
};
for (const [message, expected] of Object.entries(claimErrors)) eq(`錯誤碼 ${message.split(":")[0]}`, c.claimErrorText(new Error(message)), expected);
eq("可解析 PostgREST 狀態碼前綴與中文訊息", c.errorCode(new Error("409 UNACKNOWLEDGED_CLAIM_EXISTS: 已有接單")), "UNACKNOWLEDGED_CLAIM_EXISTS");
eq("可解析 PostgREST JSON 錯誤本文", c.errorCode(new Error('409 {"message":"POOL_ITEM_NOT_WAITING"}')), "POOL_ITEM_NOT_WAITING");
eq("未知錯誤碼原樣顯示", c.claimErrorText(new Error("409 FUTURE_CLAIM_RULE: 新規則")), "FUTURE_CLAIM_RULE");
const releaseErrors = {
  AUTH_REQUIRED: "登入狀態已失效，請重新登入。",
  TENANT_REQUIRED: "找不到公司資料，請重新登入或聯絡管理員。",
  "DISPATCH_POOL_CLAIM_RELEASE_FORBIDDEN: 僅限管理員或生管": "只有管理員或生管可以釋放接單。",
  INVALID_CLAIM_RELEASE_PAYLOAD: "找不到要釋放的派工池項目，請重新整理後再試。",
  "UNACKNOWLEDGED_CLAIM_NOT_FOUND: 找不到可釋放紀錄": "這筆接單已被處理或不存在，請重新整理。",
  CLAIM_RELEASE_CAS_FAILED: "接單狀態已變更，請重新整理後再試。",
};
for (const [message, expected] of Object.entries(releaseErrors)) eq(`釋放錯誤 ${message.split(":")[0]} 使用白話`, c.releaseErrorText(new Error(message)), expected);
eq("釋放未知新錯誤碼保留原碼", c.releaseErrorText(new Error("FUTURE_RELEASE_RULE")), "FUTURE_RELEASE_RULE");
eq("已開工不可退回", c.returnErrorText(new Error("CLAIM_ALREADY_STARTED")), "工序已開工或已有報工，不能退回池子。");
eq("operator 不可退回", c.returnErrorText(new Error("DISPATCH_POOL_RETURN_FORBIDDEN")), "只有生管或管理員可以退回池子。");

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
eq("名稱 null → 未提供", c.displayName(null), "未提供");
eq("名稱空白 → 未提供", c.displayName("   "), "未提供");
eq("最近同步時間", c.latestSyncedAt([{ synced_at: "2026-10-07T01:00:00Z" }, { synced_at: "2026-10-07T02:30:00Z" }]), "10/07 10:30");
eq("沒有同步時間", c.latestSyncedAt([]), "");

console.log("== 選工單搜尋 ==");
const searchable = [
  { work_order_no: "WO-AR16-0004", part_no: "AR-16", part_name: "主軸 套", operation_name: "CNC 車削" },
  { work_order_no: "WO-0005", part_no: "B20", part_name: "底座", operation_name: "銑削" },
];
eq("搜尋不分大小寫且忽略連字號", c.filterOrderSearch(searchable, "ar16").map(x => x.work_order_no), ["WO-AR16-0004"]);
eq("有連字號輸入也找到無差異內容", c.filterOrderSearch(searchable, "AR-16").map(x => x.work_order_no), ["WO-AR16-0004"]);
eq("工單末碼可搜尋", c.filterOrderSearch(searchable, "0004").map(x => x.work_order_no), ["WO-AR16-0004"]);
eq("多關鍵字全部符合", c.filterOrderSearch(searchable, "主軸 車削").map(x => x.work_order_no), ["WO-AR16-0004"]);
eq("多關鍵字任一不符即排除", c.filterOrderSearch(searchable, "主軸 銑削"), []);
eq("空字串保留全部", c.filterOrderSearch(searchable, "  "), searchable);

console.log("== groupByWorkOrder／earlierPoolSteps（同一張工單多道，只供顯示）==");
const multi = c.sortItems([
  item({ source_key: "k-a3", work_order_no: "W-a", process_order: 3, planned_start: "2026-10-08T00:00:00Z", part_no: "P-a", part_name: "軸" }),
  item({ source_key: "k-a1", work_order_no: "W-a", process_order: 1, planned_start: "2026-10-10T00:00:00Z", part_no: "P-a", part_name: "軸" }),
  item({ source_key: "k-b1", work_order_no: "W-b", process_order: 1, urgency: 1 }),
  item({ source_key: "k-a2", work_order_no: "W-a", process_order: 2, planned_start: "2026-10-09T00:00:00Z", part_no: "", part_name: null }),
  item({ source_key: "k-c2", work_order_no: "W-c", process_order: 2, urgency: 4 }),
]);
const groups = c.groupByWorkOrder(multi);
eq("不同工單之間維持 owner 排序（緊急 → 交期 → 預計開始）", groups.map((g) => g.workOrderNo), ["W-b", "W-a", "W-c"]);
eq("同一張工單的列收在一起、依道次由小到大", groups[1].items.map((x) => x.source_key), ["k-a1", "k-a2", "k-a3"]);
eq("組標題的料號／品名取第一個有值的", [groups[1].partNo, groups[1].partName], ["P-a", "軸"]);
eq("分組不丟列、不重複", groups.flatMap((g) => g.items.map((x) => x.source_key)).sort(), multi.map((x) => x.source_key).sort());
eq("分組不改傳入陣列的順序", multi.map((x) => x.source_key), ["k-b1", "k-a3", "k-a2", "k-a1", "k-c2"]);
eq("分組回傳原本的列物件（不複製、不加欄位）", groups[1].items.every((x) => multi.includes(x)), true);
const singles = c.sortItems([item({ work_order_no: "W-1", urgency: 3 }), item({ work_order_no: "W-2", urgency: 1 }), item({ work_order_no: "W-3", urgency: 2 })]);
eq("每張工單只有一列：攤平後順序與傳入完全相同", c.groupByWorkOrder(singles).flatMap((g) => g.items), singles);
eq("每張工單只有一列：每組一列", c.groupByWorkOrder(singles).map((g) => g.items.length), [1, 1, 1]);
eq("沒有工單號的列各自一組（不互相併）", c.groupByWorkOrder([{ work_order_no: "", process_order: 1 }, { work_order_no: null, process_order: 2 }]).length, 2);
eq("非陣列 → 空", c.groupByWorkOrder(null), []);
eq("道次：正整數才算", [c.stepNumber({ process_order: 2 }), c.stepNumber({ process_order: "3" }), c.stepNumber({ process_order: 0 }), c.stepNumber({}), c.stepNumber(null)], [2, 3, null, null, null]);
eq("第 1 道前面沒有", c.earlierPoolSteps(multi, multi.find((x) => x.source_key === "k-a1")), []);
eq("第 3 道前面還有第 1、2 道在池子", c.earlierPoolSteps(multi, multi.find((x) => x.source_key === "k-a3")), [1, 2]);
eq("別張工單的道次不算", c.earlierPoolSteps(multi, multi.find((x) => x.source_key === "k-c2")), []);
eq("同道次／較後面的不算", c.earlierPoolSteps([item({ process_order: 2 }), item({ process_order: 5 })], item({ process_order: 2 })), []);
eq("道次不明不提示", c.earlierPoolSteps(multi, { work_order_no: "W-a", process_order: null }), []);
eq("接單參數與分組無關：同一列分組前後相同", groups.flatMap((g) => g.items).map((x) => JSON.stringify(c.claimArgs(x.source_key, "A02"))).sort(),
  multi.map((x) => JSON.stringify(c.claimArgs(x.source_key, "A02"))).sort());

console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail) process.exit(1);
