// accountAdminCore.js — 「員工帳號管理」的純邏輯（排序、可不可以刪、人臉登記入口、主管能動誰）。
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

  // 系統帳號＝程式自動登入用的帳號（不是人）。規則（owner 2026-09-29）：
  //   1. 登入帳號（@ 前面）以「bridge.」開頭，例如 bridge.dispatch（派工橋，每 5 分鐘寫入派工）；
  //   2. 或名稱含「系統帳號」。
  // 站別帳號另用 isStationAccount（名稱含「站別」或帳號結尾 hmc01／hmc-01）。
  // 兩種都「不要停用」：畫面把它們移到人員帳號之後的「系統與站別帳號」區，停用前要多確認一次。
  const SYSTEM_ACCOUNT_RE = /^bridge\./i;

  function isSystemAccount(user) {
    if (String(user?.name || "").includes("系統帳號")) return true;
    const local = loginLabel(user?.account).split("@")[0];
    return SYSTEM_ACCOUNT_RE.test(local);
  }

  // → "system" | "station" | "person"（系統優先於站別）
  function accountKind(user, usage) {
    if (isSystemAccount(user)) return "system";
    if (isStationAccount(user, usage)) return "station";
    return "person";
  }

  // 系統／站別帳號的用途與「停用會造成什麼影響」（列上小字＋停用前的確認框）。人員帳號回 null。
  function accountImpact(user, usage) {
    const kind = accountKind(user, usage);
    if (kind === "system") {
      const local = loginLabel(user?.account).split("@")[0];
      if (local === "bridge.dispatch" || String(user?.name || "").includes("派工橋")) {
        return {
          kind,
          purpose: "系統帳號：派工橋每 5 分鐘用它把 MES 派工寫進來。",
          impact: "停用後派工同步會中斷：新工單、工序變更都不會再進來。",
        };
      }
      return { kind, purpose: "系統帳號：程式自動登入用，不是人。", impact: "停用後，用這個帳號的程式會無法登入、寫入中斷。" };
    }
    if (kind === "station") {
      return { kind, purpose: "站別帳號：機台平板登入報工用（整台機台共用）。", impact: "停用後，這台機台的平板無法登入報工。" };
    }
    return null;
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

  // → { self, active, special, inactive }
  //   self：目前登入的管理者（固定最上），不論啟用與否都只出現在這裡。
  //   active：啟用中的「人員」帳號，依角色順序、同角色依名稱。
  //   special：啟用中的系統與站別帳號（系統在前、站別在後，同類依名稱），畫面收在
  //            「系統與站別帳號（N）」摺疊區，放在「已停用」之前。
  //   inactive：停用的全部（含系統／站別），依名稱（畫面收在「已停用（N）」摺疊區）。
  function sortAccounts(users, selfId, usageById) {
    const list = Array.isArray(users) ? users.filter(Boolean) : [];
    const usageOf = (user) => (usageById && user ? usageById[user.id] : undefined);
    const self = selfId ? list.find((user) => user.id === selfId) || null : null;
    const others = list.filter((user) => user !== self);
    const enabled = others.filter((user) => user.is_active !== false);
    const active = enabled
      .filter((user) => accountKind(user, usageOf(user)) === "person")
      .sort((a, b) => (roleRank(roleGroup(a, usageOf(a))) - roleRank(roleGroup(b, usageOf(b)))) || compareName(a, b));
    const kindRank = (user) => (accountKind(user, usageOf(user)) === "system" ? 0 : 1);
    const special = enabled
      .filter((user) => accountKind(user, usageOf(user)) !== "person")
      .sort((a, b) => (kindRank(a) - kindRank(b)) || compareName(a, b));
    const inactive = others.filter((user) => user.is_active === false).sort(compareName);
    return { self, active, special, inactive };
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
    "SYSTEM_ACCOUNT", "STATION", "HAS_REPORTS", "HAS_USAGE", "SIGNED_IN", "FACE_ENROLLED", "OTHER_SYSTEMS", "SHARED_AUTH", "ADMIN_ACCOUNT",
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
          title: "這是機台共用的站別帳號，平板用它報工；刪掉會讓整台機台的報工對不到帳號（2026-09-23 發生過報工歸零）。也請不要停用：停用後這台機台的平板無法登入報工。",
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
      case "SYSTEM":
      case "SYSTEM_ACCOUNT": // 伺服器（machtile-mini-mes#80 am_user_usage）同一條規則的原因碼
        return {
          text: "🔒 系統帳號，程式使用中",
          title: "這是程式自動登入用的系統帳號（例如派工橋），不能刪除，也請不要停用：停用會讓對應的同步中斷。",
        };
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
    // 系統帳號一律不可刪（在任何伺服器原因之前）：它的鎖頭不該叫人「改用停用」。
    if (isSystemAccount(user)) return { show: true, canDelete: false, code: "SYSTEM", ...blockerText("SYSTEM") };
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

  // 人臉登記入口：啟用中的作業員、主管、排程（owner 2026-09-29 開放主管與排程）。
  // 管理者、品檢、站別、系統帳號、已停用都不顯示；外部信箱只寫原因不給按鈕。
  // 登入中心 /admin/face 本身不看角色（eligibility.ts：@machtile.local、有租戶、未停用、
  // 有勾系統、非 HMC-nn），所以主管／排程的 @machtile.local 帳號登記得了。
  const FACE_ROLES = Object.freeze(["operator", "manager", "planner"]);
  // → { show, eligible, href, badge, note }
  // 兩個開關（config.js）決定要不要呼叫 am-list-user-usage、以及它的結果拿來做什麼：
  //   enableAccountDelete：刪除鈕／鎖頭（預設 false，後端部署後才開）
  //   enableFaceStatus：人臉「已登記 N 張／未登記」（預設 true；owner 2026-09-30 拆開，不再綁刪除）
  // 只要任一個是 true 就呼叫；兩個都不是 true 就完全不呼叫。
  function usageMode(cfg) {
    const deleteEnabled = cfg?.enableAccountDelete === true;
    const faceStatusEnabled = cfg?.enableFaceStatus === true;
    return { fetchUsage: deleteEnabled || faceStatusEnabled, deleteEnabled, faceStatusEnabled };
  }

  // 人臉狀態徽章。
  //   statusEnabled=false → 不顯示。
  //   有 usage 且 faceActive 是數字 → 「已登記 N 張」（ok，綠）／「未登記」（none，灰）。
  //   否則（函式未部署、呼叫失敗、清單裡沒有這個人）→ 「—」（unknown），title 說明讀不到。
  function faceBadge(usage, statusEnabled) {
    if (!statusEnabled) return { badge: "", badgeKind: "", badgeTitle: "" };
    const n = usage ? Number(usage.faceActive) : NaN;
    if (usage && usage.faceActive !== null && usage.faceActive !== undefined && Number.isFinite(n)) {
      return n > 0
        ? { badge: `已登記 ${n} 張`, badgeKind: "ok", badgeTitle: `已登記 ${n} 張臉部樣板，可以在共用平板刷臉登入。` }
        : { badge: "未登記", badgeKind: "none", badgeTitle: "還沒有登記人臉，按「📷 人臉登記」開始（本人要在場）。" };
    }
    return { badge: "—", badgeKind: "unknown", badgeTitle: "人臉登記狀態暫時讀不到（稍後重新整理再看）；不影響其他按鈕。" };
  }

  // options.faceStatus：true/false 明確指定要不要顯示徽章；沒給時沿用舊行為（有 usage 才顯示）。
  function faceEntry(user, usage, faceAdminUrl, options) {
    const base = String(faceAdminUrl || "").trim();
    if (!base || !user || user.is_active === false) return { show: false };
    if (!FACE_ROLES.includes(String(user.role)) || accountKind(user, usage) !== "person") return { show: false };
    const label = loginLabel((usage && usage.loginLabel) || user.account);
    const statusEnabled = options && typeof options.faceStatus === "boolean" ? options.faceStatus : Boolean(usage);
    const { badge, badgeKind, badgeTitle } = faceBadge(usage, statusEnabled);
    // 刷臉只給 @machtile.local 的員工帳號（登入中心 eligibility.ts 同規則）；外部信箱不給按鈕。
    if (!label || label.includes("@")) {
      return { show: true, eligible: false, href: "", badge: "", badgeKind: "", badgeTitle: "", note: "外部信箱帳號不能刷臉" };
    }
    const joiner = base.includes("?") ? "&" : "?";
    return { show: true, eligible: true, href: `${base}${joiner}account=${encodeURIComponent(label)}`, badge, badgeKind, badgeTitle, note: "" };
  }

  // ---- 誰能動誰（owner 2026-09-30「做主管帳號管理」）----
  // 管理者（admin）：照舊。主管（manager）：只能管「作業員、一般人員帳號（非系統／站別）、不是自己」，
  // 可以新增（角色固定作業員）、編輯名稱／登入帳號、重設密碼、停用／啟用、人臉登記；
  // 不能刪除、不能改角色與可用系統、不能動主管／管理者／排程／品檢／系統與站別帳號、不能動自己。
  // ⚠️ 這裡只決定畫面；真正的規則在伺服器（machtile-mini-mes supabase/functions/_shared/accountPolicy.ts），
  // 目標帳號的角色是伺服器當場查的，不信任畫面。
  const ACCOUNT_MANAGER_ROLES = Object.freeze(["admin", "manager"]);
  const ADMIN_CREATABLE_ROLES = Object.freeze(["manager", "planner", "operator", "inspector"]);
  const MANAGER_CREATABLE_ROLES = Object.freeze(["operator"]);
  // 主管建立的作業員一律只開 MachTile Cloud（伺服器寫死；主管畫面不出現可用系統）。
  const MANAGER_DEFAULT_SYSTEMS = Object.freeze(["cloud"]);

  const MANAGER_LOCK = Object.freeze({
    text: "🔒 只有管理者可以調整",
    title: "主管只能管理作業員帳號（新增、編輯、重設密碼、停用／啟用、人臉登記）。主管、管理者、排程、品檢、系統與站別帳號，以及角色、可用系統、刪除，請找管理者。",
  });
  const MANAGER_SELF_LOCK = Object.freeze({
    text: "🔒 自己的帳號由管理者調整",
    title: "主管不能調整自己的帳號與權限。要改自己的密碼，請走一般的登入流程或請管理者重設。",
  });

  function canManageAccounts(role) {
    return ACCOUNT_MANAGER_ROLES.includes(String(role || ""));
  }

  function creatableRoles(viewerRole) {
    if (viewerRole === "admin") return ADMIN_CREATABLE_ROLES.slice();
    if (viewerRole === "manager") return MANAGER_CREATABLE_ROLES.slice();
    return [];
  }

  // 主管可不可以動這個帳號（與伺服器 managerTargetRefusal 同規則；伺服器另外還看登入身分的
  // platform_role／auth 角色，畫面看不到，被擋時會回 403）。
  function managerCanManage(user, usage, selfId) {
    if (!user) return false;
    if (selfId && user.id === selfId) return false;
    if (String(user.role || "") !== "operator") return false;
    return accountKind(user, usage) === "person";
  }

  // viewer = { role, selfId } → 這一列畫面上可以出現哪些按鈕。
  //   { manageable, canEdit, canReset, canToggle, allowDelete, allowFace, lock }
  //   lock：不能動時顯示的鎖頭（{ text, title }），可以動時為 null。
  //   allowDelete：是否「允許」出現刪除區（實際能不能刪仍看 deleteVerdict）。
  function accountPermissions(viewer, user, usage) {
    const role = String(viewer?.role || "");
    const selfId = viewer?.selfId || "";
    const isSelf = Boolean(user && selfId && user.id === selfId);
    const none = { manageable: false, canEdit: false, canReset: false, canToggle: false, allowDelete: false, allowFace: false, lock: null };
    if (!user) return none;
    if (role === "admin") {
      const isAdmin = user.role === "admin";
      return {
        manageable: true,
        canEdit: !isAdmin,
        canReset: !isAdmin || isSelf,
        canToggle: !isAdmin && !isSelf,
        allowDelete: true,
        allowFace: true,
        lock: null,
      };
    }
    if (role === "manager") {
      if (isSelf) return { ...none, lock: MANAGER_SELF_LOCK };
      if (!managerCanManage(user, usage, selfId)) return { ...none, lock: MANAGER_LOCK };
      return { manageable: true, canEdit: true, canReset: true, canToggle: true, allowDelete: false, allowFace: true, lock: null };
    }
    return none;
  }

  // 伺服器 403 的 reason（supabase/functions/_shared/accountPolicy.ts）→ 白話。
  const REFUSAL_TEXT = Object.freeze({
    SELF: "主管不能調整自己的帳號，請找管理者。",
    NOT_OPERATOR: "主管只能管理作業員帳號；這個帳號請找管理者調整。",
    SYSTEM_ACCOUNT: "這是系統帳號（程式使用），只有管理者可以調整。",
    STATION: "這是站別帳號（機台平板共用），只有管理者可以調整。",
    PLATFORM_ADMIN: "這個帳號有平台管理權限，只有管理者可以調整。",
    AUTH_ROLE_MISMATCH: "這個帳號的登入權限不是作業員，只有管理者可以調整。",
    AUTH_TENANT_MISMATCH: "這個帳號的登入身分屬於別的工廠，只有管理者可以調整。",
    PERMISSION_FIELD: "主管不能設定角色、可用系統或平台權限。",
    RESERVED_IDENTITY: "名稱或帳號看起來像系統帳號（bridge.、系統帳號）或站別帳號（站別、HMC-nn），這類帳號請找管理者建立。",
  });

  function refusalText(reason) {
    return REFUSAL_TEXT[String(reason || "")] || "";
  }

  return {
    ROLE_ORDER,
    ROLE_LABELS,
    BLOCKER_PRIORITY,
    loginLabel,
    FACE_ROLES,
    usageMode,
    faceBadge,
    isStationAccount,
    isSystemAccount,
    accountKind,
    accountImpact,
    roleGroup,
    sortAccounts,
    usageSummary,
    blockerText,
    deleteVerdict,
    confirmMatches,
    faceEntry,
    ACCOUNT_MANAGER_ROLES,
    MANAGER_DEFAULT_SYSTEMS,
    canManageAccounts,
    creatableRoles,
    managerCanManage,
    accountPermissions,
    refusalText,
  };
});
