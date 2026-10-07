// stationCommandCore.js — 機台卡片「開工／停工」回寫舊 MES（第 1 階段，owner 2026-10-07）。
//
// 為什麼存在：作業員在 App 按「開工／停工」要跟電子紙 LabelWork 一樣改到舊 MES（Manufacture State）。
// App 只送一筆「指令」到 Supabase station_commands（machtile_submit_station_command），工廠端
// （Factory 背景服務）核對舊 MES 現況後才套用，結果寫回同一列；App 輪詢那一列顯示結果。
//
// 防呆（2026-10-06 事故：作業員報到錯的單）：
//   送出前一定先跳確認卡，大字列出 機台／工單號／料號＋品名／第幾道＋工序名／派工橋同步的舊 MES 現況，
//   作業員要按「確認」才送。第 1 階段不換單：卡片上的單不是現在在做的那張 → 只叫他找生管，不給換單按鈕。
//
// 旗標：config.stationCommandMachines（陣列，例 ["A04"]；"*"＝全部）。空／沒設＝全部機台關（預設）。
// 表或 RPC 不存在 → 功能整個藏起來（App 跟現在一模一樣）。
//
// DOM 與 fetch 留在 app.js；這裡只做可測的決策與文字。
(function attachMachTileStationCommandCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileStationCommandCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileStationCommandCore() {
  "use strict";

  const COMMAND_TYPES = Object.freeze(["start", "stop"]);
  const TYPE_LABEL = Object.freeze({ start: "開工", stop: "停工" });
  const TERMINAL = Object.freeze(["applied", "rejected", "expired"]);
  // 伺服器端 10 分鐘沒被工廠接走就 expired；App 端多等 2 分鐘，還沒結果就停止輪詢（不再自己判定成功或失敗）
  const CLIENT_GIVE_UP_MS = 12 * 60 * 1000;
  const SUBMIT_RPC = "machtile_submit_station_command";

  function normCode(value) {
    return String(value ?? "").trim().toUpperCase();
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  // ---------------------------------------------------------------- 旗標
  // 接受陣列或逗號字串；"*" ＝全部。其他型別（true、物件…）一律當作關，避免誤開全廠。
  function parseFlag(value) {
    let items = [];
    if (Array.isArray(value)) items = value;
    else if (typeof value === "string") items = value.split(",");
    const codes = items.map(normCode).filter(Boolean);
    return { all: codes.includes("*"), machines: codes.filter((c) => c !== "*") };
  }

  function flagIsOn(flag) {
    return Boolean(flag && (flag.all || (flag.machines && flag.machines.length)));
  }

  function enabledForMachine(flag, machineCode) {
    if (!flagIsOn(flag)) return false;
    const code = normCode(machineCode);
    if (!code) return false;
    return flag.all || flag.machines.includes(code);
  }

  // 舊 MES 多工站（ManufactureII，B01–B06）。第 1 階段派工橋還沒把 ManufactureII.Id 同步上來，
  // 沒有這個 id 的多工站不顯示按鈕（工廠端必須用 Id 才知道是哪一筆）。
  function isMultiStation(machineCode) {
    return /^B\d/.test(normCode(machineCode));
  }

  // 只有作業員帳號能送（合約：submit RPC 要求 role=operator、非橋接帳號）。其他角色不出按鈕，免得按了必被拒。
  function roleAllowed(role, isBridge) {
    return String(role || "").trim().toLowerCase() === "operator" && isBridge !== true;
  }

  // 卡片要不要出現「開工／停工」：旗標開、作業員、功能可用（表與 RPC 都在）、有目前工單、工單有單號與第幾道。
  function eligibility({ flag, role, isBridge, availability, machineCode, order, isUnassignedBucket } = {}) {
    if (!enabledForMachine(flag, machineCode)) return { ok: false, reason: "flag_off" };
    if (!roleAllowed(role, isBridge)) return { ok: false, reason: "not_operator" };
    if (availability !== "ready") return { ok: false, reason: "unavailable" };
    if (isUnassignedBucket) return { ok: false, reason: "no_machine" };
    if (!order) return { ok: false, reason: "no_order" };
    if (order.offStation === true) return { ok: false, reason: "off_station" };
    if (!text(order.id)) return { ok: false, reason: "no_order_no" };
    const step = Number(order.stationStep);
    if (!Number.isInteger(step) || step <= 0) return { ok: false, reason: "no_step" };
    if (isMultiStation(machineCode) && !text(order.manufactureIiId)) return { ok: false, reason: "multi_station_unsupported" };
    return { ok: true, reason: "" };
  }

  // ---------------------------------------------------------------- 確認卡
  function partNoOf(order) {
    const raw = text(order && (order.partNo || order.drawing));
    return raw && raw !== "-" ? raw : "";
  }

  function formatTime(value) {
    if (!value) return "";
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // legacyRows：legacy_station_progress 讀回來的列；挑「同單、同機台、同一道」那列（沒有就 null）。
  function legacyRowFor(rows, { workOrderNo, machineCode, step }) {
    const list = Array.isArray(rows) ? rows : [];
    const wo = text(workOrderNo);
    const code = normCode(machineCode);
    const n = Number(step);
    return list.find((r) => r && text(r.work_order_no) === wo && normCode(r.machine_code) === code && Number(r.process_order) === n) || null;
  }

  // 派工橋同步的舊 MES 現況（白話）。派工橋只同步「這台掛哪張單、第幾道」和結算數字，
  // 沒有同步「開工中／停工中」；這點照實寫，不推算。
  function legacyStateLines({ order, legacy, legacyError } = {}) {
    const lines = [];
    if (order && order.offStation !== true) lines.push("舊 MES 這台掛的是這張單的這一道（派工橋同步）");
    if (legacyError) {
      lines.push("舊 MES 報工數字暫時讀不到");
    } else if (legacy) {
      const out = Number(legacy.legacy_output || 0);
      const fail = Number(legacy.legacy_fail || 0);
      lines.push(`舊 MES 已報：良品 ${out}、不良 ${fail}`);
      const settled = formatTime(legacy.legacy_updated_at);
      if (settled) lines.push(`舊 MES 最後報工：${settled}`);
      const synced = formatTime(legacy.legacy_synced_at || legacy.legacy_snapshot_at);
      if (synced) lines.push(`派工橋同步時間：${synced}`);
    } else {
      lines.push("舊 MES 這一道還沒有報工數字");
    }
    lines.push("開工中／停工中：派工橋沒有同步，工廠會在套用前再核對");
    return lines;
  }

  function confirmModel({ commandType, machineCode, order, legacy, legacyError, otherOrderCount } = {}) {
    const type = COMMAND_TYPES.includes(commandType) ? commandType : "";
    const step = Number(order && order.stationStep);
    const others = Number(otherOrderCount || 0);
    return {
      commandType: type,
      actionLabel: TYPE_LABEL[type] || "",
      title: type ? `確認${TYPE_LABEL[type]}` : "",
      machine: normCode(machineCode),
      workOrderNo: text(order && order.id),
      partNo: partNoOf(order),
      partName: text(order && order.part),
      stepNo: Number.isInteger(step) && step > 0 ? step : null,
      stepLabel: Number.isInteger(step) && step > 0 ? `第 ${step} 道` : "",
      operationName: text(order && order.process),
      legacyLines: legacyStateLines({ order, legacy, legacyError }),
      otherOrders: others > 0 ? `這台還掛 ${others} 張別的單` : "",
      notThisOrder: "現在做的不是這張？請找生管在舊 MES 換單。App 第一階段不會幫你換單。",
      confirmLabel: type ? `確認${TYPE_LABEL[type]}` : "",
    };
  }

  // ---------------------------------------------------------------- 送出
  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  function submitPayload({ commandUuid, commandType, machineCode, order } = {}) {
    if (!isUuid(commandUuid)) throw new Error("BAD_COMMAND_UUID");
    if (!COMMAND_TYPES.includes(commandType)) throw new Error("BAD_COMMAND_TYPE");
    const code = normCode(machineCode);
    if (!code) throw new Error("NO_MACHINE");
    const orderNo = text(order && order.id);
    if (!orderNo) throw new Error("NO_ORDER");
    const step = Number(order && order.stationStep);
    if (!Number.isInteger(step) || step <= 0) throw new Error("NO_STEP");
    return {
      p_command_uuid: commandUuid,
      p_command_type: commandType,
      p_machine_code: code,
      p_expected_order_no: orderNo,
      p_expected_index_sn: step,
      p_expected_part_no: partNoOf(order) || null,
      p_manufacture_ii_id: text(order && order.manufactureIiId) || null,
    };
  }

  // ---------------------------------------------------------------- 錯誤分類
  // supabaseFetch 丟出的錯誤訊息形如 `404 {"code":"PGRST202",...}`。
  // 表不存在：PGRST205／42P01；函式不存在：PGRST202／42883；HTTP 404 也算。
  function isMissingResourceError(error) {
    const msg = String((error && error.message) || error || "");
    return /^404\b/.test(msg) || /PGRST20[25]|42P01|42883/.test(msg);
  }

  function isNetworkError(error) {
    const msg = String((error && error.message) || error || "");
    return /Failed to fetch|NetworkError|Load failed|network|timeout|逾時|AbortError/i.test(msg) && !/^\d{3}\b/.test(msg);
  }

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

  // 合約 CONTRACT_station_commands.md §2.1：RPC 例外訊息開頭是錯誤碼
  const SUBMIT_ERROR_TEXT = Object.freeze({
    AUTH_REQUIRED: "登入已過期，請重新登入。",
    TENANT_ACCESS_DENIED: "這個帳號不屬於這間工廠，請重新登入。",
    ACCOUNT_DISABLED: "這個帳號已停用，請找管理員。",
    OPERATOR_REQUIRED: "只有作業員帳號可以按開工／停工。",
    TENANT_INACTIVE: "工廠帳戶目前停用，請找管理員。",
    APP_USER_REQUIRED: "這個帳號沒有對到作業員資料，請找管理員。",
    OPERATOR_LEGACY_ID_MISSING: "你的帳號還沒對到舊 MES 工號，請找生管或管理員設定。",
    MACHINE_NOT_ALLOWED: "你的帳號不能操作這台機台（課別不符），請找生管。",
    COMMAND_UUID_CONFLICT: "這筆指令跟之前送過的內容不一樣，請關掉重新按一次。",
    MACHINE_COMMAND_IN_FLIGHT: "這台已經有一筆開工／停工在等工廠處理（可能是別台平板按的），請等它有結果再按。",
  });
  const INVALID_INPUT_TEXT = "卡片上的工單資料不完整（機台、工單號、第幾道或料號），請重新整理；還是不行請找生管。";

  function errorCodeOf(message) {
    const m = String(message || "").match(/^([A-Z][A-Z0-9_]{2,63})/);
    return m ? m[1] : "";
  }

  // RPC 本身拒絕（還沒建成指令）→ 白話
  function submitErrorText(error) {
    if (isMissingResourceError(error)) return { missing: true, retry: false, text: "這個功能還沒在伺服器啟用，請改用電子紙。" };
    if (isNetworkError(error)) return { missing: false, retry: true, text: "網路不穩，還不知道有沒有送到。按「重送」會用同一筆指令，不會重複開工／停工。" };
    const msg = serverMessage(error);
    const status = Number(String((error && error.message) || "").slice(0, 3));
    const code = errorCodeOf(msg);
    if (code && SUBMIT_ERROR_TEXT[code]) return { missing: false, retry: false, code, text: SUBMIT_ERROR_TEXT[code] };
    if (/^INVALID_/.test(code)) return { missing: false, retry: false, code, text: INVALID_INPUT_TEXT };
    if (/legacy|工號|對照/i.test(msg)) return { missing: false, retry: false, text: "你的帳號還沒對到舊 MES 工號，請找生管或管理員設定。" };
    if (/department|課別|machine.*not.*allowed|not allowed/i.test(msg)) return { missing: false, retry: false, text: "你的帳號不能操作這台機台（課別不符），請找生管。" };
    if (/different|conflict|mismatch|不同/i.test(msg)) return { missing: false, retry: false, text: "這筆指令跟之前送過的內容不一樣，請關掉重新按一次。" };
    if (status === 401 || status === 403) return { missing: false, retry: false, text: "登入已過期或沒有權限，請重新登入。" };
    return { missing: false, retry: status >= 500, text: msg ? `送出失敗：${msg}` : "送出失敗，請稍後再試或找生管。" };
  }

  // 伺服器的指令最長壽命（合約 L3 修訂：送出後約 3 分鐘沒套用 → STALE_COMMAND／expired）。
  // App 端看到 pending 超過這個時間就直接顯示已過期（伺服器下一輪才落地）。
  const SERVER_MAX_AGE_MS = 3 * 60 * 1000;
  const SERVER_MAX_AGE_LABEL = "3 分鐘";

  const REJECT_TEXT = Object.freeze({
    ORDER_MISMATCH: "舊 MES 這台現在不是這張工單（或不是這一道）。請找生管確認；App 不會幫你換單。",
    STATION_NOT_SET: "舊 MES 這台還沒設定工單，請找生管。",
    OPERATOR_NOT_SET: "你還沒掛在舊 MES 這台的作業員名單，請找生管。",
    ALREADY_RUNNING: "舊 MES 這台已經是開工中，不用再開工。",
    ALREADY_STOPPED: "舊 MES 這台已經是停工中（或還沒開工），不用再停工。",
    RMS_UNAVAILABLE: "工廠的機台服務沒有回應，請找生管確認舊 MES 狀態。",
    APS_SIM_NOT_FOUND: "舊 MES 找不到這張單的排程資料，請找生管。",
    EXPIRED: `超過 ${SERVER_MAX_AGE_LABEL}工廠都沒有處理，這次沒有生效。要的話請重新按一次。`,
    STALE_COMMAND: "太久沒處理，已作廢，請確認機台狀態後重按",
    MANUAL_RELEASED: "主管已取消這筆，請重按",
  });
  // 這兩個代碼不論伺服器把狀態記成 rejected 還是 expired，畫面都用自己的標題
  const SPECIAL_REJECT_TITLE = Object.freeze({ STALE_COMMAND: "已作廢", MANUAL_RELEASED: "主管已取消" });

  function rejectText(code, message) {
    const key = text(code).toUpperCase();
    const base = REJECT_TEXT[key] || "舊 MES 沒有套用這次指令。";
    const detail = text(message);
    return { text: base, code: key, detail: detail && detail !== base ? detail : "" };
  }

  // ---------------------------------------------------------------- 狀態
  // row：station_commands 讀回來的那一列。回傳畫面要的一切（phase／tone／白話）。
  // 合約 §3：過期只在下一次 submit/claim 才落地；pending 且 requested_at 超過伺服器最長壽命 → 直接當已過期。
  // claimed（工廠租約 2 分鐘，逾期可被重新領走）不由 App 判過期，一律顯示「工廠處理中」直到伺服器給結果。
  const EXPIRE_AFTER_MS = SERVER_MAX_AGE_MS;
  function pendingTooOld(row, nowMs) {
    const at = Date.parse(row && row.requested_at);
    return Number.isFinite(at) && Number.isFinite(Number(nowMs)) && Number(nowMs) - at > EXPIRE_AFTER_MS;
  }

  function statusView(row, commandType, nowMs) {
    const type = COMMAND_TYPES.includes(commandType) ? commandType : (row && row.command_type) || "";
    const action = TYPE_LABEL[type] || "指令";
    let status = text(row && row.status).toLowerCase();
    const claimedBefore = Boolean(text(row && row.claimed_at));
    if (status === "pending" && !claimedBefore && nowMs !== undefined && pendingTooOld(row, nowMs)) status = "expired";
    const special = text(row && row.reject_code).toUpperCase();
    if ((status === "rejected" || status === "expired") && SPECIAL_REJECT_TITLE[special]) {
      const r = rejectText(special, row.reject_message);
      return { phase: status, terminal: true, tone: "warn", title: SPECIAL_REJECT_TITLE[special], text: r.text, code: special, detail: r.detail };
    }
    if (status === "applied") {
      return { phase: "applied", terminal: true, tone: "ok", title: type === "stop" ? "已停工" : type === "start" ? "已開工" : "已套用", text: `舊 MES 已${action}。` };
    }
    if (status === "rejected") {
      const r = rejectText(row.reject_code, row.reject_message);
      return { phase: "rejected", terminal: true, tone: "bad", title: `沒有${action}`, text: r.text, code: r.code, detail: r.detail };
    }
    if (status === "expired") {
      const r = rejectText("EXPIRED", row.reject_message);
      return { phase: "expired", terminal: true, tone: "warn", title: "已過期", text: r.text, code: "EXPIRED", detail: r.detail };
    }
    // 租約逾期後回到可重新領取（pending 但領過）也照樣是「工廠處理中」
    if (status === "claimed" || (status === "pending" && claimedBefore)) {
      return { phase: "pending", terminal: false, tone: "wait", title: "工廠處理中…", text: "工廠已收到，正在核對舊 MES。請稍等，不要重按。" };
    }
    return { phase: "pending", terminal: false, tone: "wait", title: "等待工廠套用…", text: "已送出，等工廠接手。請稍等，不要重按。" };
  }

  // 輪詢間隔：前 30 秒每 2 秒，之後每 5 秒
  function pollDelay(elapsedMs) {
    return Number(elapsedMs) < 30000 ? 2000 : 5000;
  }

  function shouldGiveUp(startedAtMs, nowMs) {
    return Number(nowMs) - Number(startedAtMs) > CLIENT_GIVE_UP_MS;
  }

  function giveUpView(commandType) {
    const action = TYPE_LABEL[commandType] || "指令";
    return { phase: "unknown", terminal: true, tone: "warn", title: "還沒有結果", text: `等了很久工廠都沒回覆，不知道舊 MES 有沒有${action}。請看電子紙或找生管確認，不要重按。` };
  }

  // ---------------------------------------------------------------- 等待中鎖（重新整理後也記得）
  function pendingRecord({ commandUuid, commandType, machineCode, orderNo, step, startedAt }) {
    return { commandUuid, commandType, machineCode: normCode(machineCode), orderNo: text(orderNo), step: Number(step) || null, startedAt: Number(startedAt) || Date.now() };
  }

  function restorePending(raw, nowMs) {
    let obj = raw;
    if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { return {}; } }
    if (!obj || typeof obj !== "object") return {};
    const out = {};
    Object.keys(obj).forEach((code) => {
      const rec = obj[code];
      if (!rec || !isUuid(rec.commandUuid) || !COMMAND_TYPES.includes(rec.commandType)) return;
      if (shouldGiveUp(rec.startedAt, nowMs)) return;
      out[normCode(code)] = pendingRecord(rec);
    });
    return out;
  }

  return {
    COMMAND_TYPES, TYPE_LABEL, TERMINAL, CLIENT_GIVE_UP_MS, SUBMIT_RPC, REJECT_TEXT,
    parseFlag, flagIsOn, enabledForMachine, isMultiStation, roleAllowed, eligibility,
    partNoOf, formatTime, legacyRowFor, legacyStateLines, confirmModel,
    isUuid, submitPayload,
    isMissingResourceError, isNetworkError, errorCodeOf, submitErrorText, SUBMIT_ERROR_TEXT, rejectText,
    SERVER_MAX_AGE_MS, EXPIRE_AFTER_MS, pendingTooOld, statusView, pollDelay, shouldGiveUp, giveUpView,
    pendingRecord, restorePending,
  };
});
