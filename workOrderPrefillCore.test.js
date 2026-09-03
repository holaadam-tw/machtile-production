// 純邏輯測試，無相依：repo 根目錄執行 `node workOrderPrefillCore.test.js`
// 這個 repo 沒有測試框架，所以刻意寫成單檔 node 腳本，改 core 後跑一次就好。
const c = require("./workOrderPrefillCore.js");
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got  " + g + "\n        want " + w); }
};

console.log("== normalizeWorkOrderNo ==");
eq("去空白+轉大寫", c.normalizeWorkOrderNo("  xx01202607100012 "), "XX01202607100012");
eq("去全形空白", c.normalizeWorkOrderNo("XX0120\u3000260710"), "XX0120260710");
eq("null 安全", c.normalizeWorkOrderNo(null), "");
eq("連字號保留（查不到要明講，不能悄悄改單號）", c.normalizeWorkOrderNo("AB-01-002"), "AB-01-002");

console.log("== asDateInputValue ==");
eq("ISO 帶時間 -> 只留日期", c.asDateInputValue("2026-09-30T00:00:00+08:00"), "2026-09-30");
eq("純日期原樣", c.asDateInputValue("2026-09-30"), "2026-09-30");
eq("垃圾值 -> 空", c.asDateInputValue("not a date"), "");

const rec = {
  work_order_no: "XX01202607100012",
  part_no: "DSHG-04-01",
  part_name: "液壓閥體",
  quantity: 120,
  due_date: "2026-09-30T00:00:00+08:00",
  process_name: "CNC 加工",
  machine_code: "B01",
};
const empty = { partNo: "", partName: "", qty: "", due: "", process: "", machine: "" };

console.log("== planPrefill ==");
let p = c.planPrefill({ record: rec, current: empty, edited: {} });
eq("空表單全帶入", p.status, "filled");
eq("帶入的值", p.fill, { partNo: "DSHG-04-01", partName: "液壓閥體", qty: "120", due: "2026-09-30", process: "CNC 加工", machine: "B01" });
eq("列舉順序照 FIELD_MAP", p.filledLabels, ["品號", "品名", "數量", "交期", "製程名稱", "指派機台"]);

p = c.planPrefill({ record: null, current: empty, edited: {} });
eq("查無此單 status", p.status, "no-record");
eq("查無此單不填任何格", p.fill, {});
eq("查無此單提示不能說已帶入", c.prefillNote(p).includes("已帶入"), false);
eq("查無此單提示要講原因", c.prefillNote(p).includes("尚未由派工橋同步"), true);

p = c.planPrefill({ record: rec, current: { ...empty, qty: "999" }, edited: { qty: true } });
eq("使用者改過的數量不被覆蓋", "qty" in p.fill, false);
eq("其餘照填", p.filledLabels, ["品號", "品名", "交期", "製程名稱", "指派機台"]);
eq("有差異才提醒保留", p.keptLabels, ["數量"]);
eq("提示同時講帶入與保留", c.prefillNote(p), "已帶入 品號、品名、交期、製程名稱、指派機台（可修改）；數量 保留你手動輸入的值");

p = c.planPrefill({ record: rec, current: { ...empty, qty: "120" }, edited: { qty: true } });
eq("改過但值相同 -> 不當成衝突", p.keptLabels, []);

p = c.planPrefill({
  record: rec,
  current: { partNo: "DSHG-04-01", partName: "液壓閥體", qty: "120", due: "2026-09-30", process: "CNC 加工", machine: "B01" },
  edited: {},
});
eq("已經一致 -> nothing-to-fill", p.status, "nothing-to-fill");
eq("一致時的提示", c.prefillNote(p), "此單資料與資料庫一致，無需帶入。");

p = c.planPrefill({ record: { work_order_no: "X1", part_name: "只有品名" }, current: empty, edited: {} });
eq("缺欄位不填空字串", p.fill, { partName: "只有品名" });

p = c.planPrefill({ record: { work_order_no: "X1", quantity: 0 }, current: empty, edited: {} });
eq("數量 0 視為無效不帶入", p.fill, {});

p = c.planPrefill({ record: { work_order_no: "" }, current: empty, edited: {} });
eq("單號空的 record 當查無", p.status, "no-record");

p = c.planPrefill();
eq("無參數不炸", p.status, "no-record");

eq("回傳物件已凍結（呼叫端改不到）", Object.isFrozen(p) && Object.isFrozen(p.fill), true);

console.log(`\n== ${pass} passed, ${fail} failed ==`);
process.exit(fail ? 1 : 0);
