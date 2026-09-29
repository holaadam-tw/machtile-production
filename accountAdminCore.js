// accountAdminCore.js — 「員工帳號管理」的純邏輯（排序、可不可以刪、人臉登記入口）。
//
// DOM 與 fetch 留在 app.js；這裡只做可測的決策。repo 根目錄執行
//   node accountAdminCore.test.js
//
// ⚠️ 這裡的「可不可以刪」只決定畫面要不要顯示刪除鈕、以及鎖頭寫什麼原因。
// 真正的規則在伺服器（machtile-mini-mes：migration 20260929120000 的
// am_user_usage／am_delete_app_user，Edge Function am-delete-user），刪除前會在
// 伺服器端用同一套條件再檢查一次；前端藏按鈕不是安全措施。
(function attachMachTileAccountAdminCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileAccountAdminCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileAccountAdminCore() {
  "use strict";

  const LOGIN_SUFFIX = "@machtile.local";

  // 啟用中的帳號依這個順序排：管理者→主管→排程→品檢→站別→作業員（同角色依名稱）。
  const ROLE_ORDER = Object.freeze(["admin", "manager", "planner", "inspector", "station", "operator"]);

  const ROLE_LABELS = Object.freeze({
    admin: "管理者",
    manager: "主管",
    planner: "排程",
    inspector: "品檢",
    station: "站別",
    operator: "作業員",
  });

  // 站別帳號＝機台共用的登入（HMC-01 站別…）。與伺服器 am_user_usage 的判斷同一條規則：
  // 名稱含「站別」，或登入帳號（@ 前面）結尾是 hmc01／hmc-01 這種機台代號。
  const STATION_ACCOUNT_RE = /(^|[^a-z0-9])hmc-?\d{1,3}$/i;

  function loginLabel(account) {
    const raw = String(account || "").trim().toLowerCase();
    return raw.endsWith(LOGIN_SUFFIX) ? raw.slice(0, raw.length - LOGIN_SUFFIX.length) : raw;
  }

  function isStationAccount(user, usage) {
    if (usage && typeof usage.station === "boolean") return usage.station;
    if (String(user?.name || "").includes("站別")) return true;
    const local = loginLabel(user?.account).split("@")[0];
    return STATION_ACCOUNT_RE.test(local);
  }

  function roleGroup(user, usage) {
    if (isStationAccount(user, usage)) return "station";
    const role = String(user?.role || "");
    return ROLE_ORDER.includes(role) ? role : "operator";
  }

  function roleRank(group) {
    const index = ROLE_ORDER.indexOf(group);
    return index === -1 ? ROLE_ORDER.length : index;
  }

  function compareName(a, b) {
    const an = String(a?.name || a?.account || "");
    const bn = String(b?.name || b?.account || "");
    const byName = an.localeCompare(bn, "zh-Hant-TW", { numeric: true, sensitivity: "base" });
    if (byName !== 0) return byName;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  }

  // → { self, active, inactive }
  //   self：目前登入的管理者（固定最上），不論啟用與否都只出現在這裡。
  //   active：啟用中，依角色順序、同角色依名稱。
  //   inactive：停用的全部，依名稱（畫面收在「已停用（N）」摺疊區）。
  function sortAccounts(users, selfId, usageById) {
    const list = Array.isArray(users) ? users.filter(Boolean) : [];
    const usageOf = (user) => (usageById && user ? usageById[user.id] : undefined);
    const self = selfId ? list.find((user) => user.id === selfId) || null : null;
    const others = list.filter((user) => user !== self);
    const active = others
      .filter((user) => user.is_active !== false)
      .sort((a, b) => (roleRank(roleGroup(a, usageOf(a))) - roleRank(roleGroup(b, usageOf(b)))) || compareName(a, b));
    const inactive = others.filter((user) => user.is_active === false).sort(compareName);
    return { self, active, inactive };
  }

  // 使用紀錄的欄位 → 白話名稱（滑鼠提示用）。沒列到的歸「其他紀錄」。
  const USAGE_LABELS = Object.freeze({
    "public.production_reports.user_id": "報工",
    "public.production_reports.operator_ids": "報工",
    "public.status_logs.changed_by": "狀態紀錄",
    "public.audit_logs.actor_user_id": "操作紀錄",
    "public.cnc_machining_runs.operator_id": "加工紀錄",
    "public.attachments.uploaded_by": "附件",
    "public.work_orders.created_by": "工單",
    "public.work_order_processes.assigned_user_id": "工序指派",
    "public.quality_checks.checked_by": "品檢",
    "public.abnormal_events.reported_by": "異常回報",
    "public.hmc_daily_worklist_item_quantities.converted_by": "HMC 日報",
    "public.hmc_daily_worklist_item_quantities.reviewed_by": "HMC 日報審核",
    "public.hmc_formal_report_draft_items.source_reviewed_by": "HMC 正式報表",
    "public.hmc_formal_report_items.source_reviewed_by": "HMC 正式報表",
    "public.hmc_shift_worklists.created_by": "HMC 班表",
  });

  function usageSummary(usage) {
    const totals = new Map();
    const entries = usage && usage.usage && typeof usage.usage === "object" ? Object.entries(usage.usage) : [];
    for (const [key, value] of entries) {
      const label = USAGE_LABELS[key] || "其他紀錄";
      totals.set(label, (totals.get(label) || 0) + (Number(value) || 0));
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, n]) => `${label} ${n} 筆`)
      .join("、");
  }

  const STOP_HINT = "不用的帳號請按「停用」：停用後無法登入，但歷史紀錄仍對得到人。";

  // 伺服器回的 blockers 依這個順序挑「最該讓管理者知道」的那一個顯示。
  // 「永久」的原因排前面（停用了也刪不掉的：站別、有紀錄、登入過…）；ACTIVE_ACCOUNT 排最後，
  // 只有在「停用後就真的可以刪」時才會看到「🔒 啟用中，請先停用」，不會叫人停用了還是刪不掉。
  const BLOCKER_PRIORITY = Object.freeze([
    "STATION", "HAS_REPORTS", "HAS_USAGE", "SIGNED_IN", "FACE_ENROLLED", "OTHER_SYSTEMS", "SHARED_AUTH", "ADMIN_ACCOUNT",
    "ACTIVE_ACCOUNT", "REFERENCED",
  ]);

  function blockerText(code, usage) {
    const reports = Number(usage?.reportCount) || 0;
    const others = Math.max(0, (Number(usage?.usageTotal) || 0) - reports);
    switch (code) {
      case "SELF":
        return { text: "🔒 不能刪除自己", title: "不能刪除目前登入中的管理者帳號。" };
      case "STATION":
        return {
          text: "🔒 站別帳號，機台綁定中",
          title: `這是機台共用的站別帳號，平板用它報工；刪掉會讓整台機台的報工對不到帳號（2026-09-23 發生過報工歸零）。${STOP_HINT}`,
        };
      case "HAS_REPORTS":
        return {
          text: `🔒 不可刪除（有 ${reports} 筆報工）`,
          title: `這個帳號有報工紀錄（${usageSummary(usage) || `報工 ${reports} 筆`}），刪掉歷史產量會對不到人。${STOP_HINT}`,
        };
      case "HAS_USAGE":
        return {
          text: `🔒 不可刪除（有 ${others} 筆使用紀錄）`,
          title: `這個帳號在系統裡留有紀錄（${usageSummary(usage) || `${others} 筆`}），刪掉紀錄會對不到人。${STOP_HINT}`,
        };
      case "SIGNED_IN":
        return {
          text: "🔒 曾登入過，請改用停用",
          title: `這個帳號登入過系統，可能已經在平板或別處留下使用痕跡，為了安全只能停用、不能刪除。${STOP_HINT}`,
        };
      case "FACE_ENROLLED":
        return {
          text: "🔒 有人臉登記，請改用停用",
          title: `這個帳號有人臉登記紀錄（含已刪除的樣板），刪帳號前需先由平台處理人臉資料。${STOP_HINT}`,
        };
      case "OTHER_SYSTEMS":
        return {
          text: "🔒 也能登入工廠站，不能在這裡刪",
          title: "這個登入帳號同時開通了其他系統（例如工廠站），在這裡刪會連帶讓那邊也登不進去。請到登入中心處理。",
        };
      case "SHARED_AUTH":
        return { text: "🔒 登入與其他帳號共用", title: `同一個登入身分被其他帳號列共用，刪掉會影響另一個帳號。${STOP_HINT}` };
      case "ACTIVE_ACCOUNT":
        return {
          text: "🔒 啟用中，請先停用",
          title: "只有已停用的帳號才能刪除（owner 2026-09-29 決定）。先按「停用」，確認這個人真的不再使用後，再到「已停用」區刪除。",
        };
      case "ADMIN_ACCOUNT":
        return { text: "🔒 管理者由平台管理", title: "管理者帳號由平台管理員（super admin）處理，不能在這裡刪除。" };
      case "REFERENCED":
        return { text: "🔒 不可刪除（剛剛有新紀錄）", title: `刪除時發現這個帳號剛被資料引用。${STOP_HINT}` };
      default:
        return { text: "🔒 不可刪除", title: STOP_HINT };
    }
  }

  // → { show, canDelete, code, text, title }
  //   show=false：伺服器使用紀錄沒載入（功能未開或查詢失敗）→ 畫面完全不出現刪除相關的東西。
  function deleteVerdict(user, usage, selfId) {
    if (user && selfId && user.id === selfId) {
      return { show: true, canDelete: false, code: "SELF", ...blockerText("SELF") };
    }
    if (!usage || !Array.isArray(usage.blockers)) {
      return { show: false, canDelete: false, code: "UNKNOWN", text: "", title: "" };
    }
    const blockers = usage.blockers.map(String);
    // 啟用中一律不給刪（伺服器也會擋）；舊版伺服器沒回這個原因時，前端自己補上。
    if (user && user.is_active !== false && !blockers.includes("ACTIVE_ACCOUNT")) blockers.push("ACTIVE_ACCOUNT");
    if (blockers.length === 0 && usage.deletable === true) {
      return {
        show: true,
        canDelete: true,
        code: "",
        text: "刪除",
        title: "這個帳號已停用、從未登入、也沒有任何紀錄，可以刪除。刪除後無法復原。",
      };
    }
    const code = BLOCKER_PRIORITY.find((c) => blockers.includes(c)) || blockers[0] || "UNKNOWN";
    return { show: true, canDelete: false, code, ...blockerText(code, usage) };
  }

  // 刪除二次確認：要輸入帳號名稱（工號或 Email，大小寫不拘、可省略 @machtile.local）。
  function confirmMatches(user, typed, usage) {
    const value = loginLabel(typed);
    if (!value) return false;
    const accepted = new Set([loginLabel(user?.account)]);
    if (usage && usage.loginLabel) accepted.add(loginLabel(usage.loginLabel));
    return accepted.has(value);
  }

  // 人臉登記入口：只給啟用中的作業員（不含站別、主管、管理者…）。
  // → { show, eligible, href, badge, note }
  function faceEntry(user, usage, faceAdminUrl) {
    const base = String(faceAdminUrl || "").trim();
    if (!base || !user || user.is_active === false) return { show: false };
    if (String(user.role) !== "operator" || isStationAccount(user, usage)) return { show: false };
    const label = loginLabel((usage && usage.loginLabel) || user.account);
    const badge = usage && Number.isFinite(Number(usage.faceActive))
      ? (Number(usage.faceActive) > 0 ? `已登記 ${Number(usage.faceActive)} 張` : "未登記")
      : "";
    // 刷臉只給 @machtile.local 的員工帳號（登入中心 eligibility.ts 同規則）；外部信箱不給按鈕。
    if (!label || label.includes("@")) {
      return { show: true, eligible: false, href: "", badge: "", note: "外部信箱帳號不能刷臉" };
    }
    const joiner = base.includes("?") ? "&" : "?";
    return { show: true, eligible: true, href: `${base}${joiner}account=${encodeURIComponent(label)}`, badge, note: "" };
  }

  return {
    ROLE_ORDER,
    ROLE_LABELS,
    BLOCKER_PRIORITY,
    loginLabel,
    isStationAccount,
    roleGroup,
    sortAccounts,
    usageSummary,
    blockerText,
    deleteVerdict,
    confirmMatches,
    faceEntry,
  };
});
