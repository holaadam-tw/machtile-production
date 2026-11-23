// returnClaimCore.js — 機台卡片「接錯了，退回」（作業員退回自己接、還沒開工的單；P2，owner 2026-11-12 Q4／Q5）。
//
// 合約：ops/codex-inbox/20261112-1920-operator-self-serve/CONTRACT-P2.md r1。
//   送出：rpc/machtile_submit_return_claim_command（七個參數，名稱見 buildArgs）；不走通用 machtile_submit_station_command。
//   結果：station_commands 那一列 pending → claimed → applied｜rejected，或 pending → expired。App 只照伺服器 status 顯示。
//   輪詢欄位＝雲端 repo supabase/tests/pglite/fixtures/return_claim_poll_select.txt（逐字相同；測試會比對）。
// 旗標：config.enableReturnClaim（預設 false）。關＝卡片與行為跟以前一模一樣。
// DOM 與 fetch 留在 app.js；這裡只做可測的決策。畫面文字一律回 i18n key（i18n.js／locales 兩種語言都要有）。
(function attachMachTileReturnClaimCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileReturnClaimCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileReturnClaimCore() {
  "use strict";

  const COMMAND_TYPE = "return_claim";
  const SUBMIT_RPC = "machtile_submit_return_claim_command";
  // 整串寫死（不要拆成變數組合）：stationCommandPollColumns.test.js 會掃這個檔的 select 逐欄核對正式庫欄位。
  const POLL_PATH_PREFIX = "station_commands?select=command_uuid,command_type,machine_code,pool_item_id,expected_order_no,expected_index_sn,status,requested_at,claimed_at,applied_at,reject_code,reject_message,legacy_snapshot&command_uuid=eq.";
  const POLL_SELECT = POLL_PATH_PREFIX.slice(POLL_PATH_PREFIX.indexOf("select=") + 7, POLL_PATH_PREFIX.indexOf("&"));
  // 機台上這一道的池列鍵（source_key）＝問雲端的唯讀 RPC machtile_held_pool_claims()（接單帳本裡還沒退回、工序還是 pending、
  // 還掛在那台的接單；只回呼叫者租戶＋課別看得到的機台）。回來的列：machine_code, work_order_no, process_order, source_key, claimed_at。
  // 不查 dispatch_pool_items（Factory 確認接單後池列變 gone，RLS 只給 waiting／claimed → 永遠查不到），
  // 也不看 work_orders.external_ref（它永遠停在這張工單第一次被接的那一道）。RPC 也會列出伺服器不給退的列（別人接的
  // NOT_CLAIM_OWNER、工廠還沒確認 CLAIM_NOT_APPLIED、已有數量／報工 CLAIM_ALREADY_STARTED）：按下去由伺服器擋，各有一句白話。
  const HELD_CLAIMS_RPC = "machtile_held_pool_claims";
  const HELD_POOL_ROW_LIMIT = 1000;   // PostgREST 一次最多回這麼多列；頂到＝可能沒讀完＝不猜
  const ROLES = Object.freeze(["operator", "admin", "planner"]);
  const REASON_ROLES = Object.freeze(["admin", "planner"]);
  const REASON_MAX = 500;
  const PENDING_KEEP_MS = 24 * 60 * 60 * 1000;

  const text = (value) => String(value ?? "").trim();
  const normCode = (value) => text(value).toUpperCase();
  const normRole = (value) => text(value).toLowerCase();
  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }
  function positiveInt(value) {
    const n = Number(value);
    return value !== null && value !== "" && Number.isInteger(n) && n > 0 ? n : null;
  }

  function roleAllowed(role, isBridge) {
    return ROLES.includes(normRole(role)) && isBridge !== true;
  }
  function needsReason(role) {
    return REASON_ROLES.includes(normRole(role));
  }

  // ---------------------------------------------------------------- 機台上這一道的池列鍵
  // 從 RPC 回來的列裡找「這台機台、這張工單、這一道」的那一列。剛好一列＝它的 source_key；0 列、超過 1 列、鍵長度不對、
  // 回來的不是陣列、或筆數頂到上限（可能沒讀完）＝空字串（不猜；按鈕不出）。別台機台接的同工單同道次不算這張卡片的。
  function heldPoolKey({ rows, machineCode, orderNo, step } = {}) {
    const code = normCode(machineCode);
    const order = text(orderNo);
    const index = positiveInt(step);
    if (!Array.isArray(rows) || rows.length >= HELD_POOL_ROW_LIMIT || !code || !order || index === null) return "";
    const hits = rows.filter((row) => row && typeof row === "object" && normCode(row.machine_code) === code
      && text(row.work_order_no) === order && positiveInt(row.process_order) === index);
    if (hits.length !== 1) return "";
    const key = text(hits[0].source_key);
    return key.length >= 5 && key.length <= 120 ? key : "";
  }

  // ---------------------------------------------------------------- 卡片要不要出現「接錯了，退回」
  // 「接了、還沒開工」＝這台這一道在接單帳本裡剛好有一筆還沒退回的接單（order.heldPoolKey，這次載入用 heldPoolKey 查到的）、
  // 工序 pending、已報 0、沒有開工時間、這台平板也沒看到今天的開工／報工、這台沒有別的指令在等。任何一項不確定＝不顯示。
  // 接單人是誰 App 讀不到（claims 在私有 schema）→ 作業員一律顯示，不是自己接的由伺服器回 NOT_CLAIM_OWNER。
  function visibility({ enabled, role, isBridge, cardDetailsReady, isUnassignedBucket, machineCode, order, actualStartAt,
    startedLocally, startedToday, hasTodayReport, commandInFlight } = {}) {
    const no = (reason) => ({ show: false, reason, needsReason: false });
    if (enabled !== true) return no("flag_off");
    if (!roleAllowed(role, isBridge)) return no("role");
    if (isUnassignedBucket === true) return no("no_machine");
    const code = normCode(machineCode);
    if (!code || code.length > 30) return no("no_machine");
    if (!order) return no("no_order");
    if (order.offStation === true) return no("off_station");
    const orderNo = text(order.id);
    if (!orderNo || orderNo.length > 100) return no("no_order_no");
    if (positiveInt(order.stationStep) === null) return no("no_step");
    if (!isUuid(order.processId)) return no("no_process");
    if (cardDetailsReady !== true) return no("pool_status_unverified");
    const poolItemId = text(order.heldPoolKey);
    if (poolItemId.length < 5 || poolItemId.length > 120) return no("pool_not_claimed");
    if (text(order.processStatus) !== "pending") return no("started");
    if (Number(order.done) !== 0) return no("has_reports");
    if (text(actualStartAt)) return no("started");
    if (startedLocally === true || startedToday === true) return no("started");
    if (hasTodayReport === true) return no("has_reports");
    if (commandInFlight === true) return no("command_in_flight");
    return { show: true, reason: "", needsReason: needsReason(role) };
  }

  // 按下按鈕時重讀的 work_order_processes 列（含 work_orders、machines）：還在這台、同一道、還是 pending、已報 0 才給送。
  const CLOSED_WO_STATUS = Object.freeze(["completed", "shipped", "cancelled"]);
  function freshCheck({ machineCode, orderNo, step, row } = {}) {
    const bad = (reason) => ({ ok: false, reason, partNo: null });
    if (!row) return bad("process_not_found");
    const wo = row.work_orders || {};
    const machine = row.machines || {};
    if (row.off_station_at) return bad("off_station");
    if (normCode(machine.machine_code) !== normCode(machineCode)) return bad("machine_changed");
    if (Number(row.process_order) !== Number(step)) return bad("step_changed");
    if (text(wo.work_order_no) !== text(orderNo)) return bad("order_changed");
    if (CLOSED_WO_STATUS.includes(text(wo.status))) return bad("order_closed");
    if (text(row.status) !== "pending") return bad("started");
    if (Number(row.qty_completed || 0) !== 0) return bad("has_reports");
    return { ok: true, reason: "", partNo: text(wo.part_no) || null };
  }

  // ---------------------------------------------------------------- 送出參數（合約 §1，七個鍵、名稱逐字）
  function reasonCheck(role, reason) {
    const value = text(reason);
    if (value.length > REASON_MAX) return { ok: false, messageKey: "return_claim_reason_too_long", value };
    if (needsReason(role) && !value) return { ok: false, messageKey: "return_claim_reason_required", value };
    return { ok: true, messageKey: "", value };
  }

  function buildArgs({ commandUuid, machineCode, poolItemId, orderNo, step, partNo, reason, role } = {}) {
    if (!isUuid(commandUuid)) throw new Error("BAD_COMMAND_UUID");
    const code = normCode(machineCode);
    if (!code || code.length > 30) throw new Error("NO_MACHINE");
    const pool = text(poolItemId);
    if (pool.length < 5 || pool.length > 120) throw new Error("NO_POOL_ITEM_ID");
    const order = text(orderNo);
    if (!order || order.length > 100) throw new Error("NO_ORDER");
    const index = positiveInt(step);
    if (index === null) throw new Error("NO_STEP");
    if (!ROLES.includes(normRole(role))) throw new Error("BAD_ROLE");
    const checked = reasonCheck(role, reason);
    if (!checked.ok) throw new Error(checked.messageKey === "return_claim_reason_required" ? "REASON_REQUIRED" : "REASON_TOO_LONG");
    const part = text(partNo);
    return {
      p_command_uuid: commandUuid,
      p_machine_code: code,
      p_pool_item_id: pool,
      p_expected_order_no: order,
      p_expected_index_sn: index,
      // 料號只給 Factory 交叉核對；沒有或太長就送 null（不拿圖號頂替）
      p_expected_part_no: part && part.length <= 200 ? part : null,
      // 作業員不填 → null，伺服器存 operator_wrong_claim；管理員／生管必填
      p_reason: checked.value || null,
    };
  }

  // ---------------------------------------------------------------- 拒絕碼 → 一句白話（i18n key）
  // submit 的 raise 與 Factory finish 的 reject_code 共用一張表。畫面絕不顯示代碼本身。
  // Factory 那一半＝從套用端原始碼列出 return_claim 會回的每一個碼（StationReturnClaimApplier.cs、StationCommandProcessor.cs、
  // StationCommandMatcher.cs、StationCommandPoller.cs；測試 FACTORY_CODES 是同一份清單）。
  const REJECT_MESSAGE_KEY = Object.freeze({
    AUTH_REQUIRED: "return_claim_err_login",
    OPERATOR_REQUIRED: "return_claim_err_role",
    APPLIER_CANNOT_SUBMIT: "return_claim_err_role",
    TENANT_INACTIVE: "return_claim_err_account",
    APP_USER_REQUIRED: "return_claim_err_account",
    OPERATOR_LEGACY_ID_MISSING: "return_claim_err_account",
    OPERATOR_LEGACY_ID_INVALID: "return_claim_err_account",
    ADMIN_LEGACY_ID_MISSING: "return_claim_err_account",
    FORBIDDEN: "return_claim_err_account",
    ADMIN_SUBMIT_DISABLED: "return_claim_err_admin_disabled",
    COMMAND_UUID_REQUIRED: "return_claim_err_card_data",
    INVALID_MACHINE_CODE: "return_claim_err_card_data",
    INVALID_POOL_ITEM_ID: "return_claim_err_card_data",
    COMMAND_UUID_CONFLICT: "return_claim_err_conflict",
    RETURN_CLAIM_DISABLED: "return_claim_err_not_open",
    FACTORY_RETURN_DISABLED: "return_claim_err_not_open",
    UNSUPPORTED_STATION: "return_claim_err_station_not_open",
    STALE: "return_claim_err_stale",
    RETURN_REASON_REQUIRED: "return_claim_reason_required",
    INVALID_RETURN_REASON: "return_claim_reason_too_long",
    MACHINE_NOT_ALLOWED: "return_claim_err_machine_not_allowed",
    ACTIVE_CLAIM_NOT_FOUND: "return_claim_err_no_claim",
    NOT_CLAIM_OWNER: "return_claim_err_not_owner",
    CLAIM_NOT_APPLIED: "return_claim_err_claim_not_applied",
    CLAIM_ALREADY_STARTED: "return_claim_err_started",
    MACHINE_COMMAND_IN_FLIGHT: "return_claim_err_in_flight",
    LEGACY_STATE_INCONSISTENT: "return_claim_err_inconsistent",
    POOL_ITEM_NOT_FOUND: "return_claim_err_pool_missing",
    STALE_COMMAND: "return_claim_err_stale_command",
    EXPIRED: "return_claim_err_expired",
    MANUAL_RELEASED: "return_claim_err_released",
    // ---- Factory 套用端另外會回的碼（合約 §2 的表沒列）
    // 工廠旗標關（當成不認得的指令種類）、指令欄位不合、管理員代退但稽核表缺欄位 → 都是「還沒開放／找生管」
    COMMAND_INVALID: "return_claim_err_not_open",
    OPERATOR_UNKNOWN: "return_claim_err_account",
    // 整筆已取消、沒有寫入；等一下再按有機會成功
    LOCK_TIMEOUT: "return_claim_err_busy_retry",
    INTERNAL_ERROR: "return_claim_err_internal_retry",
    // 結果不確定：不可以說「沒有退回」
    OUTCOME_UNKNOWN: "return_claim_err_outcome_unknown",
    LEGACY_APPLIED_LATE: "return_claim_err_outcome_unknown",
    // 沒有寫入，再按也一樣 → 找生管
    LEDGER_CONFLICT: "return_claim_err_factory_problem",
    WRITE_TARGET_DENIED: "return_claim_err_factory_problem",
  });
  const GENERIC_MESSAGE_KEY = "return_claim_err_generic";
  // 只有這幾個「等一下再按」有機會成功；其餘再按也一樣，文字不可以叫人再按。
  const RETRY_LATER_CODES = Object.freeze(["CLAIM_NOT_APPLIED", "MACHINE_COMMAND_IN_FLIGHT", "STALE_COMMAND", "EXPIRED", "LOCK_TIMEOUT", "INTERNAL_ERROR"]);
  // 結果不確定的碼：畫面用「注意」色，不用「失敗」色；文字不說沒有退回。
  const UNCERTAIN_CODES = Object.freeze(["OUTCOME_UNKNOWN", "LEGACY_APPLIED_LATE", "MANUAL_RELEASED"]);

  function rejectInfo(code) {
    const key = normCode(code);
    const known = Object.prototype.hasOwnProperty.call(REJECT_MESSAGE_KEY, key);
    return { code: key, known, messageKey: known ? REJECT_MESSAGE_KEY[key] : GENERIC_MESSAGE_KEY, retryLater: known && RETRY_LATER_CODES.includes(key) };
  }

  // supabaseFetch 丟出的錯誤訊息形如 `400 {"code":"P0001","message":"NOT_CLAIM_OWNER"}`。
  function serverMessage(error) {
    const msg = String((error && error.message) || error || "");
    const jsonStart = msg.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const body = JSON.parse(msg.slice(jsonStart));
        return text(body.message || body.hint || body.details || "");
      } catch { /* 不是 JSON */ }
    }
    return msg.replace(/^\d{3}\s*/, "").trim();
  }
  function errorCodeOf(message) {
    const m = String(message || "").match(/^([A-Z][A-Z0-9_]{2,63})(?![A-Z0-9_])/);
    return m ? m[1] : "";
  }
  function isMissingResourceError(error) {
    const msg = String((error && error.message) || error || "");
    return /^404\b/.test(msg) || /PGRST20[25]|42P01|42883/.test(msg);
  }
  function isNetworkError(error) {
    const msg = String((error && error.message) || error || "");
    const name = String((error && error.name) || "");
    if (/^\d{3}\b/.test(msg)) return false;
    return name === "AbortError" || name === "TypeError" || /Failed to fetch|NetworkError|Load failed|network|timeout|逾時|abort/i.test(msg);
  }

  // 送出 RPC 失敗 → missing（伺服器沒有這支）／uncertain（不知道有沒有送到：可以用同一個 uuid 重送）／rejected（確定沒建成指令）
  function submitErrorInfo(error) {
    if (isMissingResourceError(error)) return { kind: "missing", code: "", messageKey: "return_claim_err_not_open" };
    if (isNetworkError(error)) return { kind: "uncertain", code: "", messageKey: "return_claim_uncertain" };
    const code = errorCodeOf(serverMessage(error));
    if (code && Object.prototype.hasOwnProperty.call(REJECT_MESSAGE_KEY, code)) {
      return { kind: "rejected", code, messageKey: REJECT_MESSAGE_KEY[code] };
    }
    const status = Number(String((error && error.message) || "").slice(0, 3));
    if (status >= 500) return { kind: "uncertain", code, messageKey: "return_claim_uncertain" };
    if (status === 401) return { kind: "rejected", code, messageKey: "return_claim_err_login" };
    return { kind: "rejected", code, messageKey: GENERIC_MESSAGE_KEY };
  }

  // ---------------------------------------------------------------- 伺服器那一列 → 畫面狀態
  function legacySnapshot(row) {
    const raw = row && row.legacy_snapshot;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
    if (typeof raw !== "string" || !raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  function resultView(row) {
    const status = text(row && row.status).toLowerCase();
    if (status === "applied") {
      const info = legacySnapshot(row).return_claim;
      const mode = info && typeof info === "object" ? text(info.mode) : "";
      // stale_assignment_reconciled＝機台已是別道，Factory 沒碰機台，只把殘留池列退回
      const untouched = mode === "stale_assignment_reconciled";
      return { phase: "applied", status, terminal: true, tone: "ok", mode, code: "",
        messageKey: untouched ? "return_claim_applied_reconciled" : "return_claim_applied" };
    }
    if (status === "rejected") {
      const info = rejectInfo(row.reject_code);
      return { phase: "rejected", status, terminal: true, tone: UNCERTAIN_CODES.includes(info.code) ? "warn" : "bad", mode: "", code: info.code, messageKey: info.messageKey };
    }
    if (status === "expired") {
      return { phase: "expired", status, terminal: true, tone: "warn", mode: "", code: "EXPIRED", messageKey: REJECT_MESSAGE_KEY.EXPIRED };
    }
    if (status === "claimed") return { phase: "pending", status, terminal: false, tone: "wait", mode: "", code: "", messageKey: "return_claim_processing" };
    return { phase: "pending", status: "pending", terminal: false, tone: "wait", mode: "", code: "", messageKey: "return_claim_waiting" };
  }

  function rowIsThis(row, commandUuid) {
    return Boolean(row) && text(row.command_uuid).toLowerCase() === text(commandUuid).toLowerCase() && text(commandUuid) !== "";
  }

  function pollPath(commandUuid) {
    if (!isUuid(commandUuid)) throw new Error("BAD_COMMAND_UUID");
    return `${POLL_PATH_PREFIX}${commandUuid}`;
  }

  // ---------------------------------------------------------------- 等結果中的紀錄（重新整理後也記得）
  // args＝送出的那七個參數原樣保存：同一次嘗試重送必須「同一個 uuid＋同樣內容」，否則伺服器回 COMMAND_UUID_CONFLICT。
  const ARG_KEYS = Object.freeze(["p_command_uuid", "p_machine_code", "p_pool_item_id", "p_expected_order_no", "p_expected_index_sn", "p_expected_part_no", "p_reason"]);
  function pendingRecord(rec = {}) {
    const args = {};
    ARG_KEYS.forEach((key) => { args[key] = rec.args && rec.args[key] !== undefined ? rec.args[key] : null; });
    return {
      commandUuid: text(rec.commandUuid),
      machineCode: normCode(rec.machineCode),
      orderNo: text(rec.orderNo),
      step: positiveInt(rec.step),
      processId: isUuid(rec.processId) ? String(rec.processId) : "",
      // 這筆是誰（哪個租戶、哪個 app_users.id）送的：共用平板換人登入後不可以把別人的等待紀錄套到自己身上
      tenantId: text(rec.tenantId),
      appUserId: text(rec.appUserId),
      args,
      startedAt: Number(rec.startedAt) || Date.now(),
      unconfirmed: rec.unconfirmed === true,
      notFound: rec.notFound === true,
      lastStatus: ["pending", "claimed"].includes(String(rec.lastStatus || "")) ? String(rec.lastStatus) : null,
    };
  }

  function restorePending(raw, nowMs) {
    let obj = raw;
    if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { return {}; } }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out = {};
    Object.keys(obj).forEach((code) => {
      const rec = obj[code];
      if (!rec || !isUuid(rec.commandUuid) || !rec.args || rec.args.p_command_uuid !== rec.commandUuid) return;
      if (Number(nowMs) - Number(rec.startedAt) > PENDING_KEEP_MS) return;
      if (normCode(rec.args.p_machine_code) !== normCode(code)) return;
      out[normCode(code)] = pendingRecord(rec);
    });
    return out;
  }

  // 這筆紀錄是不是目前登入的這個人（同租戶＋同 app_users.id）送的。任一邊是空的＝無法確認＝不是。
  function sameSession(rec, session) {
    const tenantId = text(session && session.tenantId);
    const appUserId = text(session && session.appUserId);
    return Boolean(rec) && tenantId !== "" && appUserId !== "" && text(rec.tenantId) === tenantId && text(rec.appUserId) === appUserId;
  }

  // 還原：只拿回「目前登入的這個人」送的紀錄；別人的、沒有記是誰的（舊格式）一律不還原。
  function restoreForSession(raw, nowMs, session) {
    const all = restorePending(raw, nowMs);
    const out = {};
    Object.keys(all).forEach((code) => { if (sameSession(all[code], session)) out[code] = all[code]; });
    return out;
  }

  // 存檔：自己的紀錄照寫；同一台平板上別人還沒過期的紀錄原樣留著（不替別人刪），同一台機台以自己的為準。
  function mergeForSave(raw, own, nowMs, session) {
    const all = restorePending(raw, nowMs);
    const out = {};
    Object.keys(all).forEach((code) => { if (!sameSession(all[code], session)) out[code] = all[code]; });
    Object.keys(own || {}).forEach((code) => { out[normCode(code)] = own[code]; });
    return out;
  }

  // 這筆紀錄講的是不是卡片現在顯示的那張單、那一道。不是＝卡片不可以顯示「這張單…」的字與重送／不退了。
  function recordMatchesOrder(rec, order) {
    return Boolean(rec) && Boolean(order) && text(rec.orderNo) !== "" && text(rec.orderNo) === text(order.id)
      && positiveInt(rec.step) !== null && positiveInt(rec.step) === positiveInt(order.stationStep);
  }

  // 卡片上這筆紀錄要怎麼顯示：
  //   own＝就是這張單這一道 → 照原本（等待中／不確定＋重送／查不到＋重送、不退了）
  //   machine＝還鎖著這台、但卡片已經是別張單（或沒有單）→ 只說「這台有一筆退回在處理」，不給重送
  //   none＝不鎖、也不是這張單 → 不顯示（紀錄已過時；按新的退回時丟掉）
  function cardRecordMode(rec, order, released) {
    if (!rec) return "none";
    if (recordMatchesOrder(rec, order)) return "own";
    return locks(rec, released) ? "machine" : "none";
  }

  // 這筆等結果的退回要不要鎖住這台的開工／報工（合約 §5：退回 pending 期間鎖住）。
  // 查了幾次都查不到（notFound）＝沒送到，不鎖；released＝本機等超過解鎖時間而且最後看到的不是 claimed。
  function locks(record, released) {
    if (!record) return false;
    if (record.notFound === true) return false;
    if (released === true && record.lastStatus !== "claimed") return false;
    return true;
  }

  // 最後一次結果在卡片上留多久：成功 2 分鐘；沒成功 10 分鐘而且卡片還是同一張單同一道。
  function lastResultVisible(last, { orderNo, step, nowMs } = {}) {
    if (!last || !last.view) return false;
    const age = Number(nowMs) - Number(last.at);
    if (!(age >= 0)) return false;
    if (last.view.phase === "applied") return age <= 2 * 60 * 1000;
    return age <= 10 * 60 * 1000 && text(last.orderNo) === text(orderNo) && Number(last.step) === Number(step);
  }

  return Object.freeze({
    COMMAND_TYPE, SUBMIT_RPC, POLL_PATH_PREFIX, POLL_SELECT, ROLES, REASON_ROLES, REASON_MAX, PENDING_KEEP_MS, ARG_KEYS,
    REJECT_MESSAGE_KEY, GENERIC_MESSAGE_KEY, RETRY_LATER_CODES, UNCERTAIN_CODES,
    HELD_CLAIMS_RPC, HELD_POOL_ROW_LIMIT, heldPoolKey,
    isUuid, roleAllowed, needsReason, visibility, freshCheck, reasonCheck, buildArgs, rejectInfo, errorCodeOf, serverMessage,
    isMissingResourceError, isNetworkError, submitErrorInfo, legacySnapshot, resultView, rowIsThis, pollPath,
    pendingRecord, restorePending, restoreForSession, mergeForSave, sameSession, recordMatchesOrder, cardRecordMode, locks, lastResultVisible,
  });
});
