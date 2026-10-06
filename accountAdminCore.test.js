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
  { show: true, eligible: true, href: URL + "?account=1080301", badge: "未登記", badgeKind: "none", badgeTitle: c.faceBadge({ faceActive: 0 }, true).badgeTitle, note: "" });
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
  { show: true, eligible: false, href: "", badge: "", badgeKind: "", badgeTitle: "", note: "外部信箱帳號不能刷臉" });
eq("網址已有參數用 &", c.faceEntry(U("o1", "o", "operator"), null, URL + "?x=1").href, URL + "?x=1&account=o1");

console.log("== usageMode（兩個開關組合）==");
eq("刪除關＋人臉狀態開（預設）→ 呼叫、只顯示人臉", c.usageMode({ enableAccountDelete: false, enableFaceStatus: true }), { fetchUsage: true, deleteEnabled: false, faceStatusEnabled: true });
eq("刪除開＋人臉狀態關 → 呼叫、只用於刪除", c.usageMode({ enableAccountDelete: true, enableFaceStatus: false }), { fetchUsage: true, deleteEnabled: true, faceStatusEnabled: false });
eq("兩個都開", c.usageMode({ enableAccountDelete: true, enableFaceStatus: true }), { fetchUsage: true, deleteEnabled: true, faceStatusEnabled: true });
eq("兩個都關 → 完全不呼叫", c.usageMode({ enableAccountDelete: false, enableFaceStatus: false }), { fetchUsage: false, deleteEnabled: false, faceStatusEnabled: false });
eq("舊 config（沒有新開關）→ 不呼叫", c.usageMode({}), { fetchUsage: false, deleteEnabled: false, faceStatusEnabled: false });
eq("字串 \"true\" 不算開", c.usageMode({ enableFaceStatus: "true" }).faceStatusEnabled, false);

console.log("== faceBadge / faceEntry 狀態 ==");
eq("已登記", c.faceBadge({ faceActive: 3 }, true).badge, "已登記 3 張");
eq("已登記是綠（ok）", c.faceBadge({ faceActive: 1 }, true).badgeKind, "ok");
eq("未登記是灰（none）", c.faceBadge({ faceActive: 0 }, true).badgeKind, "none");
eq("讀不到（沒部署／失敗）→ —", c.faceBadge(null, true).badge, "—");
eq("讀不到的 title", c.faceBadge(undefined, true).badgeTitle.startsWith("人臉登記狀態暫時讀不到"), true);
eq("清單裡沒 faceActive → —", c.faceBadge({ blockers: [] }, true).badge, "—");
eq("faceActive=null → —", c.faceBadge({ faceActive: null }, true).badge, "—");
eq("關閉 → 不顯示", c.faceBadge({ faceActive: 3 }, false).badge, "");
eq("faceEntry：狀態開、讀不到 → 按鈕照常＋—", (() => { const f = c.faceEntry(U("0990001", "王", "operator"), undefined, URL, { faceStatus: true }); return [f.eligible, f.href !== "", f.badge]; })(), [true, true, "—"]);
eq("faceEntry：狀態關、有資料 → 不顯示張數", c.faceEntry(U("0990001", "王", "operator"), { faceActive: 2 }, URL, { faceStatus: false }).badge, "");
eq("faceEntry：狀態開、刪除關也有張數", c.faceEntry(U("0990001", "王", "operator"), { faceActive: 2 }, URL, { faceStatus: true }).badge, "已登記 2 張");

console.log("== 主管帳號管理：誰能動誰（owner 2026-09-30）==");
{
  const ME = U("mg1", "黃主管", "manager");
  const V = { role: "manager", selfId: "mg1" };
  const A = { role: "admin", selfId: "ad1" };
  const op = U("op1", "阮文英", "operator");
  const perm = (viewer, user, usage) => c.accountPermissions(viewer, user, usage);
  const buttons = (p) => [p.canEdit, p.canReset, p.canToggle, p.allowDelete, p.allowFace];

  eq("canManageAccounts：admin／manager 可進、其他不行",
    ["admin", "manager", "planner", "operator", "inspector", "", undefined].map((r) => c.canManageAccounts(r)),
    [true, true, false, false, false, false, false]);
  eq("新增角色：admin 四種（不含 admin）", c.creatableRoles("admin"), ["manager", "planner", "operator", "inspector"]);
  eq("新增角色：manager 只能作業員", c.creatableRoles("manager"), ["operator"]);
  eq("新增角色：其他角色沒有", c.creatableRoles("planner"), []);
  eq("主管建立的作業員可用系統固定 cloud", c.MANAGER_DEFAULT_SYSTEMS, ["cloud"]);

  eq("主管→一般作業員：編輯／重設／停用／人臉可，刪除不行", buttons(perm(V, op)), [true, true, true, false, true]);
  eq("主管→一般作業員：沒有鎖頭", perm(V, op).lock, null);
  eq("主管→已停用作業員：可以啟用", perm(V, U("off", "離職", "operator", { is_active: false })).canToggle, true);
  for (const [label, user] of [
    ["另一位主管", U("mg2", "主管B", "manager")],
    ["管理者", U("ad1", "管理者", "admin")],
    ["排程", U("pl1", "排程", "planner")],
    ["品檢", U("in1", "品檢", "inspector")],
    ["系統帳號（bridge.）", U("br1", "派工橋", "operator", { account: "bridge.dispatch@machtile.local" })],
    ["系統帳號（名稱）", U("sy1", "報表（系統帳號）", "operator")],
    ["站別（名稱）", U("st1", "HMC-01 站別", "operator")],
    ["站別（帳號 hmc-02）", U("st2", "二號機", "operator", { account: "hmc-02@machtile.local" })],
  ]) {
    const p = perm(V, user);
    eq(`主管→${label}：全部按鈕不出現`, buttons(p), [false, false, false, false, false]);
    eq(`主管→${label}：鎖頭「只有管理者可以調整」`, p.lock && p.lock.text, "🔒 只有管理者可以調整");
  }
  eq("主管→伺服器說是站別的作業員：鎖", perm(V, op, { station: true }).manageable, false);
  eq("主管→自己：全部不行、鎖頭寫自己", [buttons(perm(V, ME)), perm(V, ME).lock.text],
    [[false, false, false, false, false], "🔒 自己的帳號由管理者調整"]);
  eq("managerCanManage 與 accountPermissions 一致", c.managerCanManage(op, undefined, "mg1"), true);

  eq("管理者：照舊——作業員全開", buttons(perm(A, op)), [true, true, true, true, true]);
  eq("管理者：照舊——主管可編輯、重設、停用", buttons(perm(A, U("mg2", "主管B", "manager"))), [true, true, true, true, true]);
  eq("管理者：照舊——其他管理者只剩刪除區（由 deleteVerdict 顯示鎖頭）", buttons(perm(A, U("ad2", "另一位管理者", "admin"))), [false, false, false, true, true]);
  eq("管理者：照舊——自己可重設密碼、不能停用", buttons(perm(A, U("ad1", "我", "admin"))), [false, true, false, true, true]);
  eq("管理者：站別帳號可操作（有確認框）", perm(A, U("st1", "HMC-01 站別", "operator")).canToggle, true);
  eq("排程／作業員看不到任何按鈕", [buttons(perm({ role: "planner" }, op)), buttons(perm({ role: "operator" }, op))],
    [[false, false, false, false, false], [false, false, false, false, false]]);

  eq("伺服器拒絕原因有白話", c.refusalText("STATION").includes("站別"), true);
  eq("沒有的原因回空字串", c.refusalText("WHAT"), "");
}

console.log("== 修改紀錄排版（owner 2026-09-30）==");
{
  const mgr = { appUserId: "mg1", name: "黃主管", account: "mgr01@machtile.local" };
  const reset = { id: "1", at: "2026-09-30T07:04:00Z", action: "account.reset_password", actorRole: "manager", actor: mgr,
    target: { appUserId: "op1", name: "阮文英", account: "1100801@machtile.local" }, changes: {},
    targetSystems: ["cloud", "factory"], otherSystems: ["factory"], affectsOtherSystems: true };
  eq("時間固定台灣時間", c.auditTime("2026-09-30T07:04:00Z"), "2026-09-30 15:04");
  eq("壞時間→空字串", c.auditTime("nope"), "");
  eq("重設密碼（也能登入工廠站）", c.auditEntryView(reset),
    { when: "2026-09-30 15:04", who: "黃主管（主管）", what: "重設密碼（此帳號也能登入：工廠站）", fields: [], warn: true });
  eq("只開 cloud 的重設密碼：不標", c.auditEntryView({ ...reset, targetSystems: ["cloud"], otherSystems: [], affectsOtherSystems: false }).what, "重設密碼");
  eq("沒有系統清單：未限定系統", c.auditEntryView({ ...reset, targetSystems: null, otherSystems: [], affectsOtherSystems: true }).what, "重設密碼（此帳號也能登入：未限定系統）");
  eq("編輯：欄位新舊值、登入帳號去尾碼", c.auditEntryView({ ...reset, action: "account.update", affectsOtherSystems: null,
    changes: { name: { old: "阮文英", new: "阮文英A" }, account: { old: "1100801@machtile.local", new: "1100811@machtile.local" } } }).fields,
    ["姓名：阮文英 → 阮文英A", "登入帳號：1100801 → 1100811"]);
  eq("建立：只列新值（角色、狀態、可用系統白話）", c.auditEntryView({ ...reset, action: "account.create", actorRole: "admin", actor: { name: "系統管理者" },
    changes: { role: { old: null, new: "operator" }, is_active: { old: null, new: true }, systems: { old: null, new: ["cloud"] } } }),
    { when: "2026-09-30 15:04", who: "系統管理者（管理者）", what: "建立帳號", fields: ["角色：作業員", "狀態：啟用", "可用系統：MachTile Cloud"], warn: false });
  eq("停用", c.auditEntryView({ ...reset, action: "account.disable", changes: { is_active: { old: true, new: false } } }).fields, ["狀態：啟用 → 停用"]);
  eq("含 password 的欄位一律不顯示", c.auditEntryView({ ...reset, changes: { password: { old: "a", new: "b" } } }).fields, []);
  eq("舊紀錄沒有角色、名稱：用帳號", c.auditEntryView({ at: "2026-09-01T00:00:00Z", action: "account.enable", actor: { account: "owner@example.com" } }).who, "owner@example.com");
  eq("重設成功訊息：會影響工廠站", c.resetDoneMessage({ affectsOtherSystems: true, otherSystems: ["factory"] }),
    "密碼已重設。這個帳號也能登入工廠站，那邊的密碼也一起變了；已留下修改紀錄。");
  eq("重設成功訊息：只有 cloud", c.resetDoneMessage({ affectsOtherSystems: false, otherSystems: [] }), "密碼已重設。");
  eq("重設成功訊息：舊伺服器沒回欄位", c.resetDoneMessage({ status: "ok" }), "密碼已重設。");
}

console.log("== 所屬課別 ==");
{
  eq("勾選整理：去重、固定順序、丟掉未知值", c.departmentSelection(["MILL", "LATHE", "MILL", "X", null]), ["LATHE", "MILL"]);
  eq("都不勾＝明確空陣列", c.departmentSelection([]), []);
  eq("非陣列＝空", c.departmentSelection(undefined), []);
  eq("徽章：只有車床", c.departmentBadge({ department_codes: ["LATHE"], configured: true }).text, "車床");
  eq("徽章：只有銑床", c.departmentBadge({ department_codes: ["MILL"], configured: true }).text, "銑床");
  eq("徽章：兩課", c.departmentBadge({ department_codes: ["LATHE", "MILL"], configured: true }).kind, "both");
  eq("徽章：沒有資料列＝預設兩課", c.departmentBadge({ department_codes: null, configured: false }), { text: "兩課", kind: "both", title: "尚未設定，預設車床課＋銑床課。" });
  eq("徽章：明確空＝無課別⚠", c.departmentBadge({ department_codes: [], configured: true }).text, "無課別⚠");
  eq("徽章：橋接帳號鎖住", c.departmentBadge({ department_codes: ["LATHE"], is_bridge: true }).kind, "bridge");
  eq("徽章：沒有資料＝不顯示", c.departmentBadge(undefined), null);
  eq("勾選初值：沒資料列＝兩課都勾", c.departmentChecked({ department_codes: null }), ["LATHE", "MILL"]);
  eq("勾選初值：空", c.departmentChecked({ department_codes: [] }), []);
  eq("文字：無課別", c.departmentText([]), "無課別");
  eq("錯誤：PostgREST 404＝尚未部署", c.departmentErrorInfo(new Error('404 {"code":"PGRST202","message":"Could not find the function"}')).missing, true);
  eq("錯誤：FORBIDDEN 白話", c.departmentErrorText(new Error('400 {"code":"P0001","message":"FORBIDDEN"}')), "沒有權限修改這個帳號的課別（主管只能改作業員）。");
  eq("錯誤：橋接", c.departmentErrorInfo(new Error('400 {"message":"BRIDGE_DEPARTMENTS_IMMUTABLE"}')).code, "BRIDGE_DEPARTMENTS_IMMUTABLE");
  eq("錯誤：非 JSON", c.departmentErrorText(new Error("500 gateway")), "課別儲存失敗，請稍後再試。");
  eq("修改紀錄：課別新舊值", c.auditEntryView({ at: "2026-10-06T07:04:00Z", action: "account.machine_departments", actorRole: "manager", actor: { name: "黃主管" },
    changes: { department_codes: { old: ["LATHE", "MILL"], new: ["LATHE"] } } }),
    { when: "2026-10-06 15:04", who: "黃主管（主管）", what: "修改所屬課別", fields: ["所屬課別：車床課、銑床課 → 車床課"], warn: false });
  eq("修改紀錄：改成無課別、原本沒資料列", c.auditEntryView({ at: "2026-10-06T07:04:00Z", action: "account.machine_departments",
    changes: { department_codes: { old: null, new: [] } } }).fields, ["所屬課別：無課別"]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
