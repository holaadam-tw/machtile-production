// 純邏輯測試，無相依：repo 根目錄執行 `node accountAdminCore.test.js`
// （這個 repo 沒有測試框架，比照 workOrderPrefillCore.test.js 寫成單檔 node 腳本。）
const c = require("./accountAdminCore.js");
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got  " + g + "\n        want " + w); }
};

const U = (id, name, role, extra = {}) => ({ id, name, role, account: `${id}@machtile.local`, is_active: true, ...extra });

console.log("== sortAccounts ==");
{
  const users = [
    U("op2", "陳柏叡", "operator"),
    U("st1", "HMC-01 站別", "operator", { account: "hola.adam+mt-hmc01@gmail.com" }),
    U("pl1", "排程小陳", "planner"),
    U("br1", "派工橋（系統帳號）", "planner", { account: "bridge.dispatch@machtile.local" }),
    U("me", "系統管理者", "admin", { account: "owner@example.com" }),
    U("mg2", "黃主管", "manager"),
    U("op1", "阮文英", "operator"),
    U("off2", "測試員", "planner", { is_active: false }),
    U("mg1", "主管", "manager"),
    U("in1", "品檢A", "inspector"),
    U("off1", "現場主管B", "manager", { is_active: false }),
    U("ad2", "另一位管理者", "admin"),
    U("st2", "HMC-02 站別", "operator", { account: "hmc-02" }),
  ];
  const s = c.sortAccounts(users, "me", {});
  eq("自己固定最上", s.self && s.self.id, "me");
  eq("啟用的人員：管理者→主管→排程→品檢→作業員，同角色依名稱（站別／系統不在這裡）",
    s.active.map((u) => u.id), ["ad2", "mg1", "mg2", "pl1", "in1", "op1", "op2"]);
  eq("系統與站別區：系統在前、站別在後", s.special.map((u) => u.id), ["br1", "st1", "st2"]);
  eq("停用的全部在後面、依名稱（中文依筆畫：現 11 畫 < 測 12 畫）", s.inactive.map((u) => u.id), ["off1", "off2"]);
  eq("自己不重複出現", [...s.active, ...s.special, ...s.inactive].some((u) => u.id === "me"), false);
  eq("停用的系統帳號放已停用區", c.sortAccounts([U("b", "派工橋（系統帳號）", "planner", { account: "bridge.x@machtile.local", is_active: false })], "", {}).inactive.length, 1);
  const noSelf = c.sortAccounts(users, "", {});
  eq("沒有 selfId：沒有置頂", noSelf.self, null);
  eq("伺服器說不是站別就以伺服器為準", c.roleGroup(users[1], { station: false }), "operator");
  eq("伺服器說是站別", c.roleGroup(U("x", "某人", "operator"), { station: true }), "station");
  eq("停用中的自己也置頂、不進停用區", c.sortAccounts([U("me", "我", "admin", { is_active: false })], "me", {}).inactive.length, 0);
  eq("null 安全", c.sortAccounts(null, "me", null), { self: null, active: [], special: [], inactive: [] });
}

console.log("== isStationAccount ==");
eq("名稱含站別", c.isStationAccount({ name: "HMC-01 站別", account: "x" }), true);
eq("帳號 hmc-01", c.isStationAccount({ name: "x", account: "HMC-01" }), true);
eq("帳號 mt-hmc02@gmail", c.isStationAccount({ name: "x", account: "hola.adam+mt-hmc02@gmail.com" }), true);
eq("一般工號不是", c.isStationAccount({ name: "陳柏叡", account: "1080301" }), false);
eq("hmc 在中間不算", c.isStationAccount({ name: "x", account: "hmc01x" }), false);

console.log("== isSystemAccount / accountKind / accountImpact ==");
eq("bridge.dispatch 是系統", c.isSystemAccount({ name: "x", account: "bridge.dispatch@machtile.local" }), true);
eq("bridge.任何 是系統", c.isSystemAccount({ name: "x", account: "Bridge.Writeback" }), true);
eq("名稱含系統帳號", c.isSystemAccount({ name: "I-Reporter（系統帳號）", account: "ireporter@machtile.local" }), true);
eq("bridgeman 不是", c.isSystemAccount({ name: "x", account: "bridgeman@machtile.local" }), false);
eq("一般人不是", c.isSystemAccount({ name: "黃主管", account: "pm1001@machtile.local" }), false);
eq("系統優先於站別", c.accountKind({ name: "HMC-01 站別（系統帳號）", account: "x" }), "system");
eq("站別", c.accountKind({ name: "HMC-01 站別", account: "x" }), "station");
eq("人員", c.accountKind({ name: "王", account: "0990001" }), "person");
eq("派工橋影響", c.accountImpact({ name: "派工橋（系統帳號）", account: "bridge.dispatch@machtile.local" }).impact, "停用後派工同步會中斷：新工單、工序變更都不會再進來。");
eq("站別影響", c.accountImpact({ name: "HMC-02 站別", account: "x" }).impact, "停用後，這台機台的平板無法登入報工。");
eq("其他系統帳號影響", c.accountImpact({ name: "某程式（系統帳號）", account: "svc" }).kind, "system");
eq("人員沒有影響說明", c.accountImpact({ name: "王", account: "0990001" }), null);

console.log("== deleteVerdict ==");
const clean = { blockers: [], deletable: true, reportCount: 0, usageTotal: 0 };
eq("停用＋乾淨→可刪", c.deleteVerdict(U("a", "a", "operator", { is_active: false }), clean, "me").canDelete, true);
eq("啟用中＋乾淨→不可刪，請先停用", c.deleteVerdict(U("a", "a", "operator"), { blockers: ["ACTIVE_ACCOUNT"], deletable: false }, "me").text, "🔒 啟用中，請先停用");
eq("啟用中但舊伺服器說可刪→前端仍不給刪", c.deleteVerdict(U("a", "a", "operator"), clean, "me"), { show: true, canDelete: false, code: "ACTIVE_ACCOUNT", text: "🔒 啟用中，請先停用", title: c.blockerText("ACTIVE_ACCOUNT").title });
eq("啟用中＋曾登入→顯示曾登入（停用了也刪不掉，不叫人先停用）", c.deleteVerdict(U("a", "a", "operator"), { blockers: ["SIGNED_IN", "ACTIVE_ACCOUNT"] }, "me").text, "🔒 曾登入過，請改用停用");
eq("啟用中＋有報工→顯示報工", c.deleteVerdict(U("a", "a", "operator"), { blockers: ["HAS_REPORTS", "ACTIVE_ACCOUNT"], reportCount: 3 }, "me").text, "🔒 不可刪除（有 3 筆報工）");
eq("自己永遠不能刪（即使伺服器沒回）", c.deleteVerdict(U("me", "me", "admin"), null, "me").text, "🔒 不能刪除自己");
eq("沒載到使用紀錄→不顯示刪除相關", c.deleteVerdict(U("a", "a", "operator"), null, "me").show, false);
eq("blockers 不是陣列→不顯示", c.deleteVerdict(U("a", "a", "operator"), { deletable: true }, "me").show, false);
eq("deletable 不是 true 就不給刪（防呆）", c.deleteVerdict(U("a", "a", "operator"), { blockers: [] }, "me").canDelete, false);
eq("有報工", c.deleteVerdict(U("a", "a", "operator"), { blockers: ["HAS_REPORTS", "SIGNED_IN"], reportCount: 18, usageTotal: 28 }, "me").text, "🔒 不可刪除（有 18 筆報工）");
eq("站別優先於報工", c.deleteVerdict(U("a", "a", "operator"), { blockers: ["HAS_REPORTS", "STATION"], reportCount: 18 }, "me").text, "🔒 站別帳號，機台綁定中");
eq("系統帳號：不可刪、不叫人停用", c.deleteVerdict(U("b", "派工橋（系統帳號）", "planner", { account: "bridge.dispatch@machtile.local" }), { blockers: ["SIGNED_IN", "ACTIVE_ACCOUNT"] }, "me").text, "🔒 系統帳號，程式使用中");
eq("停用的系統帳號即使伺服器說可刪也不給刪", c.deleteVerdict(U("b", "x", "planner", { account: "bridge.x", is_active: false }), clean, "me").canDelete, false);
eq("伺服器原因碼 SYSTEM_ACCOUNT 也顯示系統帳號鎖頭（即使前端規則沒認出）", c.deleteVerdict(U("x", "某人", "operator", { is_active: false }), { blockers: ["SIGNED_IN", "SYSTEM_ACCOUNT"] }, "me").text, "🔒 系統帳號，程式使用中");
eq("站別鎖頭說明不叫人停用", c.blockerText("STATION").title.includes("也請不要停用"), true);
eq("曾登入", c.deleteVerdict(U("a", "a", "operator"), { blockers: ["SIGNED_IN"] }, "me").text, "🔒 曾登入過，請改用停用");
eq("其他使用紀錄＝總數−報工", c.deleteVerdict(U("a", "a", "manager"), { blockers: ["HAS_USAGE"], reportCount: 0, usageTotal: 5 }, "me").text, "🔒 不可刪除（有 5 筆使用紀錄）");
eq("未知代碼也是鎖", c.deleteVerdict(U("a", "a", "operator"), { blockers: ["NEW_RULE"] }, "me").canDelete, false);
eq("滑鼠提示列出紀錄種類",
  c.deleteVerdict(U("a", "a", "manager"), { blockers: ["HAS_USAGE"], reportCount: 0, usageTotal: 5,
    usage: { "public.hmc_daily_worklist_item_quantities.reviewed_by": 3, "public.hmc_formal_report_items.source_reviewed_by": 1, "public.hmc_formal_report_draft_items.source_reviewed_by": 1 } }, "me").title.includes("HMC 日報審核 3 筆、HMC 正式報表 2 筆"), true);

console.log("== confirmMatches ==");
const fan = { account: "fan.wenlin" };
eq("帳號本身", c.confirmMatches(fan, "fan.wenlin"), true);
eq("大小寫、空白不拘", c.confirmMatches({ account: "E813" }, "  e813 "), true);
eq("可省略 @machtile.local", c.confirmMatches({ account: "0991001@machtile.local" }, "0991001"), true);
eq("伺服器給的真實登入也可以", c.confirmMatches(fan, "1100801", { loginLabel: "1100801" }), true);
eq("名字不行", c.confirmMatches(fan, "范文林"), false);
eq("空白不行", c.confirmMatches(fan, "   "), false);

console.log("== faceEntry ==");
const URL = "https://login.machtile.com/admin/face";
eq("作業員：連結帶入登入帳號", c.faceEntry(U("1080301", "陳柏叡", "operator"), { faceActive: 0 }, URL),
  { show: true, eligible: true, href: URL + "?account=1080301", badge: "未登記", note: "" });
eq("已登記 N 張", c.faceEntry(U("adam", "Adam", "operator"), { faceActive: 2 }, URL).badge, "已登記 2 張");
eq("使用紀錄沒載到→不顯示張數", c.faceEntry(U("adam", "Adam", "operator"), null, URL).badge, "");
eq("用伺服器的真實登入帶入", c.faceEntry({ id: "f", name: "范文林", role: "operator", account: "fan.wenlin", is_active: true }, { loginLabel: "1100801", faceActive: 0 }, URL).href, URL + "?account=1100801");
eq("主管顯示（owner 2026-09-29）", c.faceEntry(U("pm1001", "黃主管", "manager"), { faceActive: 0 }, URL).href, URL + "?account=pm1001");
eq("排程顯示", c.faceEntry(U("pl9", "排程", "planner"), null, URL).show, true);
eq("品檢不顯示", c.faceEntry(U("i", "品檢", "inspector"), null, URL).show, false);
eq("系統帳號（派工橋，排程角色）不顯示", c.faceEntry(U("b", "派工橋（系統帳號）", "planner", { account: "bridge.dispatch@machtile.local" }), null, URL).show, false);
eq("外部信箱主管：不給按鈕、講原因", c.faceEntry(U("m", "主管", "manager", { account: "boss@gmail.com" }), null, URL).eligible, false);
eq("管理者不顯示", c.faceEntry(U("a", "管理者", "admin"), null, URL).show, false);
eq("站別不顯示", c.faceEntry(U("s", "HMC-01 站別", "operator"), null, URL).show, false);
eq("停用不顯示", c.faceEntry(U("o", "o", "operator", { is_active: false }), null, URL).show, false);
eq("功能關（沒設網址）不顯示", c.faceEntry(U("o", "o", "operator"), null, "").show, false);
eq("外部信箱：不給按鈕、講原因", c.faceEntry(U("o", "o", "operator", { account: "someone@gmail.com" }), null, URL),
  { show: true, eligible: false, href: "", badge: "", note: "外部信箱帳號不能刷臉" });
eq("網址已有參數用 &", c.faceEntry(U("o1", "o", "operator"), null, URL + "?x=1").href, URL + "?x=1&account=o1");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
