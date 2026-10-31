// assemblyReport.js — 組裝站報工畫面（旗標 assemblyReportEnabled，預設關）。必須在 app.js 之後載入：
// 直接用 app.js 的全域函式（supabaseFetch、submitReport、machtileAskOutsourceReceipt…），不另做一套網路層。
// 純邏輯在 assemblyReportCore.js。所有寫入都是既有合約：
//   開工／完工關站 → rpc/machtile_submit_station_command（start／close，帶 manufacture_ii_id）
//   報工 → rpc/machtile_submit_station_report（先預覽、再正式；帶 manufacture_ii_id 指定站上哪一張單）
//   App 紀錄 → submitReport（production_reports／field_report_upsert，operators＝勾選的報工人）
// 舊 MES 那邊同一站一次只能有一筆指令在處理（雲端 uq_station_commands_inflight_machine），所以整站一個鎖。
/* global config, state, supabaseFetch, escapeHtml, machtileTranslate, showToast, machtileMachineCardOrders,
   machtileLoadAssignedCardProcesses, machtileResolveAppUserId, machtileHasPendingReport, machtileAskOutsourceReceipt,
   MACHTILE_OUTSOURCE_RECEIPT_SUPERSEDED, machtileOutsourceReceiptDialogEnabled, submitReport, machtileActualRole,
   machtileDepartmentAccess, machtileFactoryDateIso, isUuid */
"use strict";

const machtileAsmCore = () => window.MachTileAssemblyReportCore || null;
const machtileAsmT = (key, params) => machtileTranslate(key, params);

const machtileAsm = {
  station: "",
  line: "all",
  loading: false,
  loadedAt: 0,
  error: "",
  actorId: "",
  users: [],
  guard: { status: "idle", enabled: false, failReasons: [] },
  identityByProcess: new Map(),
  progressByProcess: new Map(),
  shiftByOrder: new Map(),
  forms: new Map(),
  results: new Map(),
  closed: new Set(),
  confirmStart: "",
  ack: null,
  busy: null,
};

// 登入者的租戶：伺服器回的 machine_department_context.tenant_id 優先，其次是登入 JWT 簽過的 app_metadata.tenant_id。
// 刻意不退回 config.tenantId（那是部署預設值，不是這個人的租戶）；都沒有＝不明＝關。
function machtileAsmTenantId() {
  const fromServer = typeof machtileDepartmentAccess !== "undefined" ? machtileDepartmentAccess?.tenant_id : "";
  const fromJwt = typeof machtileAuthState !== "undefined" ? machtileAuthState?.hmcFixedSignedTenantId : "";
  return String(fromServer || fromJwt || "");
}
function machtileAsmStations() { return machtileAsmCore()?.enabledStations(window.MACHTILE_CONFIG || config, machtileAsmTenantId()) || []; }
function machtileAsmEnabled() { return machtileAsmStations().length > 0; }
function machtileAsmPollMs() { const v = Number(config.assemblyPollIntervalMs); return Number.isFinite(v) && v >= 10 ? v : 2000; }
const machtileAsmDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function machtileAsmRoot() { return document.querySelector("[data-assembly-root]"); }

function machtileAsmSyncEntry() {
  const stations = machtileAsmStations();
  // 登入／換帳號後才知道租戶：開了就插入入口與畫面；關了（含登出、換到別的客戶）就整個拿掉。
  if (stations.length) machtileAsmEnsureDom();
  else machtileAsmRemoveDom();
  document.querySelectorAll("[data-assembly-entry]").forEach((button) => {
    button.hidden = stations.length === 0;
    if (stations.length) button.textContent = machtileAsmT("asm_entry", { stations: stations.join("・") });
  });
}

function machtileAsmForm(processId) {
  let form = machtileAsm.forms.get(processId);
  if (!form) {
    form = { open: false, mode: "report", good: "", bad: "", defectOpen: false, failReasonCode: "", note: "", operatorIds: null, error: "" };
    machtileAsm.forms.set(processId, form);
  }
  return form;
}

// null＝還沒動過＝預設「我」（等人員清單讀到才算得出來，所以不能在建表單時就定下來）
function machtileAsmFormOperators(form) {
  return form.operatorIds === null ? machtileAsmCore().defaultOperatorIds(machtileAsm.users, machtileAsm.actorId) : form.operatorIds;
}

function machtileAsmDefectAllowed() { return machtileAsmCore().defectAllowed(config, machtileAsm.station); }
function machtileAsmDefectReasons() { return machtileAsmCore().defectReasons(config, machtileAsm.guard.failReasons); }
function machtileAsmReportedGood(processId) {
  const row = machtileAsm.progressByProcess.get(String(processId));
  const shown = row && window.MachTileBatchReportCore?.displayProgress ? window.MachTileBatchReportCore.displayProgress(row) : null;
  return shown && shown.available ? shown.totalOutput : null;
}

function machtileAsmOrders() {
  const core = machtileAsmCore();
  return core.ordersForStation(machtileMachineCardOrders(), machtileAsm.station).filter((o) => !machtileAsm.closed.has(String(o.processId)));
}

function machtileAsmVisibleOrders() {
  const core = machtileAsmCore();
  const orders = machtileAsmOrders();
  if (!core.stationHasLines(config, machtileAsm.station) || machtileAsm.line === "all") return orders;
  return orders.filter((o) => core.lineOf(o.part) === machtileAsm.line);
}

function machtileAsmOrderByProcess(processId) {
  return machtileAsmOrders().find((o) => String(o.processId) === String(processId)) || null;
}

function machtileAsmContext(order) {
  const legacy = machtileAsm.identityByProcess.get(String(order?.processId || ""));
  return machtileAsmCore().legacyContext(order, legacy, machtileAsm.station);
}

// ------------------------------------------------------------------ 讀取
async function machtileAsmLoadGuard(station) {
  machtileAsm.guard = { status: "idle", enabled: false, failReasons: [] };
  const reportCore = window.MachTileStationReportCore;
  if (!reportCore || state.source !== "supabase") return;
  try {
    const client = reportCore.createClient({ request: (path, options) => supabaseFetch(path, options) });
    const row = await client.getGuardConfig(station);
    if (!reportCore.isGuardConfig(row, station)) throw new Error("guard config invalid");
    machtileAsm.guard = { status: "loaded", enabled: reportCore.guardConfigReportEnabled(row, station), failReasons: row.fail_reason_codes.slice() };
  } catch (error) {
    machtileAsm.guard = { status: "unavailable", enabled: false, failReasons: [] };
    console.info("assembly report guard config unavailable; report stays closed", error?.message || error);
  }
}

async function machtileAsmLoadIdentity(processIds) {
  const map = new Map();
  const ids = [...new Set(processIds.filter((id) => isUuid(String(id))))];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80).map(encodeURIComponent).join(",");
    try {
      const rows = await supabaseFetch(`work_order_processes?select=id,legacy_index_sn,manufacture_ii_id,simulation_id,work_orders!inner(part_no)&id=in.(${chunk})`);
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (row && isUuid(String(row.id))) map.set(String(row.id), { legacy_index_sn: row.legacy_index_sn, manufacture_ii_id: row.manufacture_ii_id, simulation_id: row.simulation_id, part_no: row.work_orders?.part_no });
      });
    } catch (error) {
      console.info("assembly legacy identity unavailable; submit stays blocked", error?.message || error);
    }
  }
  machtileAsm.identityByProcess = map;
}

async function machtileAsmLoadProgress(processIds) {
  const ids = [...new Set(processIds.filter((id) => isUuid(String(id))))];
  if (!ids.length) return;
  try {
    const rows = await supabaseFetch("rpc/batch_report_progress", { method: "POST", body: JSON.stringify({ p_process_ids: ids, p_pending_since: config.batchReportPendingSince || null }) });
    (Array.isArray(rows) ? rows : []).forEach((row) => machtileAsm.progressByProcess.set(String(row.process_id), row));
  } catch (error) {
    console.info("assembly progress unavailable; 已報 shows —", error?.message || error);
  }
}

async function machtileAsmLoadShift(station) {
  machtileAsm.shiftByOrder = new Map();
  try {
    const start = new Date(`${machtileFactoryDateIso()}T00:00:00+08:00`).toISOString();
    const rows = await supabaseFetch(`station_commands?select=command_type,status,expected_order_no,expected_index_sn,requested_at,applied_at&machine_code=eq.${encodeURIComponent(station)}&command_type=in.(start,stop)&status=eq.applied&requested_at=gte.${encodeURIComponent(start)}&order=requested_at.asc`);
    machtileAsm.shiftByOrder = machtileAsmCore().shiftStateByOrder(rows);
  } catch (error) {
    console.info("assembly start/stop state unavailable", error?.message || error);
  }
}

async function machtileAsmLoad({ reloadOrders = false } = {}) {
  if (!machtileAsmEnabled()) { machtileAsmRender(); return; }
  if (!machtileAsmStations().includes(machtileAsm.station)) machtileAsm.station = machtileAsmStations()[0];
  machtileAsm.loading = true;
  machtileAsm.error = "";
  machtileAsmRender();
  try {
    if (state.source === "supabase") {
      if (reloadOrders) await machtileLoadAssignedCardProcesses();
      const station = machtileAsm.station;
      const [actorId, users] = await Promise.all([
        machtileResolveAppUserId(),
        supabaseFetch("app_users?select=id,name,legacy_user_id&is_active=eq.true&order=name").catch(() => []),
        machtileAsmLoadGuard(station),
        machtileAsmLoadShift(station),
      ]);
      machtileAsm.actorId = String(actorId || "");
      machtileAsm.users = machtileAsmCore().operatorChoices(users, machtileAsm.actorId);
      const processIds = machtileAsmOrders().map((o) => String(o.processId));
      await Promise.all([machtileAsmLoadIdentity(processIds), machtileAsmLoadProgress(processIds)]);
      if (state.cardProcessError) machtileAsm.error = state.cardProcessError;
    }
  } catch (error) {
    machtileAsm.error = `${machtileAsmT("asm_load_failed")}${error?.message ? `：${error.message}` : ""}`;
  } finally {
    machtileAsm.loading = false;
    machtileAsm.loadedAt = Date.now();
    machtileAsmRender();
  }
}

function machtileAssemblyOnView() {
  machtileAsmSyncEntry();
  void machtileAsmLoad();
}

// ------------------------------------------------------------------ 畫面
function machtileAsmStatusPill(order) {
  const core = machtileAsmCore();
  const shift = machtileAsm.shiftByOrder.get(core.orderKey(order.id, order.stationStep));
  const s = core.displayState(order, shift);
  return `<span class="asm-status is-${s}" data-asm-status="${escapeHtml(order.processId)}">${escapeHtml(machtileAsmT(`asm_state_${s}`))}</span>`;
}

function machtileAsmProgressHtml(order) {
  const row = machtileAsm.progressByProcess.get(String(order.processId));
  const core = window.MachTileBatchReportCore;
  const shown = row && core?.displayProgress ? core.displayProgress(row) : null;
  const good = shown && shown.available ? shown.totalOutput : null;
  const fail = shown && shown.available ? shown.totalFail : null;
  return `<span class="asm-progress" data-asm-progress="${escapeHtml(order.processId)}">${escapeHtml(machtileAsmT("asm_reported", { good: good ?? "—", fail: fail ?? "—", total: order.total || "—" }))}</span>`;
}

function machtileAsmFormHtml(order, form, disabledAll) {
  const pid = escapeHtml(order.processId);
  const reasons = machtileAsmDefectReasons();
  const finish = form.mode === "finish";
  const defectOk = machtileAsmDefectAllowed();
  const sp = finish ? form.shortPrompt : null;
  const shortLabels = { MATERIAL_SHORT: "short_completion_material", SCRAP: "short_completion_scrap", OTHER: "short_completion_other" };
  const shortHtml = sp ? `<div class="asm-short" role="alertdialog" data-asm-short="${pid}">
      <p class="asm-short-question">${escapeHtml(machtileAsmT("asm_short_question", { short: sp.short, planned: sp.planned, done: sp.done }))}</p>
      <div class="asm-short-reasons">${machtileAsmCore().SHORT_REASONS.map((code) => `<label class="asm-operator${form.shortReason === code ? " is-checked" : ""}"><input type="radio" name="asmShort-${pid}" data-asm-short-reason="${pid}" value="${code}"${form.shortReason === code ? " checked" : ""}${disabledAll}><span>${escapeHtml(machtileAsmT(shortLabels[code]))}</span></label>`).join("")}</div>
      <label class="asm-note"${form.shortReason === "OTHER" ? "" : " hidden"}><span>${escapeHtml(machtileAsmT("short_completion_note"))}</span><textarea rows="2" maxlength="500" data-asm-short-note="${pid}"${disabledAll}>${escapeHtml(form.shortNote || "")}</textarea></label>
    </div>` : "";
  const operators = machtileAsm.users.map((u) => {
    const checked = machtileAsmFormOperators(form).includes(u.id);
    return `<label class="asm-operator${checked ? " is-checked" : ""}"><input type="checkbox" data-asm-operator="${pid}" value="${escapeHtml(u.id)}"${checked ? " checked" : ""}${disabledAll}><span>${escapeHtml(u.name)}${u.isMe ? `（${escapeHtml(machtileAsmT("asm_me"))}）` : ""}</span></label>`;
  }).join("");
  const reasonOptions = [`<option value="">${escapeHtml(machtileAsmT("report_fail_reason_placeholder"))}</option>`,
    ...reasons.map((r) => `<option value="${escapeHtml(r)}"${form.failReasonCode === r ? " selected" : ""}>${escapeHtml(r)}</option>`)].join("");
  return `<div class="asm-form${finish ? " is-finish" : ""}" data-asm-form="${pid}">
    ${finish ? `<p class="asm-finish-question">${escapeHtml(machtileAsmT("asm_finish_question", { order: order.id }))}</p>` : ""}
    <label class="asm-qty is-good"><span>${escapeHtml(machtileAsmT(finish ? "asm_finish_good_label" : "asm_good_label"))}</span>
      <input type="number" inputmode="numeric" min="0" step="1" data-asm-good="${pid}" value="${escapeHtml(form.good)}"${disabledAll}></label>
    ${defectOk ? `<label class="asm-defect-toggle"><input type="checkbox" data-asm-defect-toggle="${pid}"${form.defectOpen ? " checked" : ""}${disabledAll}><span>${escapeHtml(machtileAsmT("batch_defect_toggle"))}</span></label>
    <div class="asm-defect"${form.defectOpen ? "" : " hidden"}>
      <label class="asm-qty is-bad"><span>${escapeHtml(machtileAsmT("asm_bad_label"))}</span><input type="number" inputmode="numeric" min="0" step="1" data-asm-bad="${pid}" value="${escapeHtml(form.bad)}"${disabledAll}></label>
      <label class="asm-reason"><span>${escapeHtml(machtileAsmT("report_fail_reason_label"))}</span><select data-asm-reason="${pid}"${disabledAll}>${reasonOptions}</select></label>
      <label class="asm-note"${form.failReasonCode === "其他" ? "" : " hidden"}><span>${escapeHtml(machtileAsmT("report_fail_reason_note_label"))}</span><textarea rows="2" data-asm-note="${pid}"${disabledAll}>${escapeHtml(form.note)}</textarea></label>
    </div>` : ""}
    <fieldset class="asm-operators"><legend>${escapeHtml(machtileAsmT("asm_operators_label"))}</legend>${operators || `<p class="asm-muted">${escapeHtml(machtileAsmT("asm_no_operators"))}</p>`}</fieldset>
    ${shortHtml}
    ${form.error ? `<p class="asm-error" role="alert" data-asm-form-error="${pid}">${escapeHtml(form.error)}</p>` : ""}
    <div class="asm-form-actions">
      <button type="button" class="primary-action${finish ? " is-finish" : ""}" data-asm-submit="${pid}"${disabledAll}>${escapeHtml(machtileAsmT(sp ? "asm_short_submit" : finish ? "asm_finish_submit" : "asm_submit"))}</button>
      <button type="button" class="secondary-action" data-asm-cancel="${pid}"${disabledAll}>${escapeHtml(machtileAsmT("cancel"))}</button>
    </div>
  </div>`;
}

function machtileAsmOrderHtml(order) {
  const core = machtileAsmCore();
  const pid = escapeHtml(order.processId);
  const ctx = machtileAsmContext(order);
  const busy = machtileAsm.busy;
  const busyHere = busy && busy.processId === String(order.processId);
  const lock = busy || machtileAsm.loading ? " disabled" : "";
  const form = machtileAsmForm(String(order.processId));
  const shift = machtileAsm.shiftByOrder.get(core.orderKey(order.id, order.stationStep));
  const running = core.displayState(order, shift) === "running";
  const reportOpen = machtileAsm.guard.enabled === true;
  const blockers = [];
  if (!ctx.ok) blockers.push(machtileAsmT("asm_missing_identity", { fields: ctx.missing.join("、") }));
  if (!reportOpen) blockers.push(machtileAsmT(machtileAsm.guard.status === "loaded" ? "asm_report_closed" : "asm_report_unavailable"));
  const line = core.stationHasLines(config, machtileAsm.station) ? core.lineOf(order.part) : "";
  const result = machtileAsm.results.get(String(order.processId));
  const ack = machtileAsm.ack && machtileAsm.ack.processId === String(order.processId) ? machtileAsm.ack : null;
  const startConfirm = machtileAsm.confirmStart === String(order.processId);
  const actions = form.open ? "" : `<div class="asm-actions">
      ${startConfirm
        ? `<button type="button" class="primary-action" data-asm-start-confirm="${pid}"${lock}>${escapeHtml(machtileAsmT("asm_start_confirm"))}</button><button type="button" class="secondary-action" data-asm-start-cancel="${pid}"${lock}>${escapeHtml(machtileAsmT("cancel"))}</button>`
        : `${running ? "" : `<button type="button" class="secondary-action asm-start" data-asm-start="${pid}"${lock || (!ctx.ok ? " disabled" : "")}>${escapeHtml(machtileAsmT("asm_start"))}</button>`}
           <button type="button" class="primary-action asm-report" data-asm-report="${pid}"${lock || (!ctx.ok || !reportOpen ? " disabled" : "")}>${escapeHtml(machtileAsmT("asm_report"))}</button>
           <button type="button" class="secondary-action asm-finish" data-asm-finish="${pid}"${lock || (!ctx.ok ? " disabled" : "")}>${escapeHtml(machtileAsmT("asm_finish"))}</button>`}
    </div>`;
  return `<article class="asm-order${running ? " is-running" : ""}${busyHere ? " is-busy" : ""}" data-asm-order="${pid}" data-asm-order-no="${escapeHtml(order.id)}">
    <header class="asm-order-head">
      <div><strong class="asm-order-no">${escapeHtml(order.id)}</strong>${line ? `<span class="asm-line is-${line}">${escapeHtml(machtileAsmT(`asm_line_${line}`))}</span>` : ""}</div>
      ${machtileAsmStatusPill(order)}
    </header>
    <p class="asm-part">${escapeHtml(order.part)}</p>
    <p class="asm-meta">${escapeHtml(order.process)}${order.stationStep ? `・${escapeHtml(machtileAsmT("asm_step", { step: order.stationStep }))}` : ""}・${machtileAsmProgressHtml(order)}</p>
    ${blockers.length ? `<p class="asm-blocker" role="note" data-asm-blocker="${pid}">${escapeHtml(blockers.join(" "))}</p>` : ""}
    ${busyHere ? `<p class="asm-busy" role="status">${escapeHtml(busy.text || machtileAsmT("asm_sending"))}</p>` : ""}
    ${ack ? `<div class="asm-ack" role="alertdialog" data-asm-ack="${pid}"><p>${escapeHtml(ack.message)}</p><button type="button" class="primary-action" data-asm-ack-confirm="${pid}"${busy ? " disabled" : ""}>${escapeHtml(machtileAsmT("asm_ack_confirm"))}</button><button type="button" class="secondary-action" data-asm-ack-cancel="${pid}"${busy ? " disabled" : ""}>${escapeHtml(machtileAsmT("cancel"))}</button></div>` : ""}
    ${result ? `<p class="asm-result is-${result.tone}" role="status" data-asm-result="${pid}">${escapeHtml(result.text)}</p>` : ""}
    ${actions}
    ${form.open ? machtileAsmFormHtml(order, form, lock) : ""}
  </article>`;
}

function machtileAsmRender() {
  const root = machtileAsmRoot();
  if (!root) return;
  machtileAsmSyncEntry();
  const core = machtileAsmCore();
  const stations = machtileAsmStations();
  if (!core || !stations.length) { root.innerHTML = `<p class="asm-muted" role="note">${escapeHtml(machtileAsmT("asm_flag_off"))}</p>`; return; }
  if (!stations.includes(machtileAsm.station)) machtileAsm.station = stations[0];
  const demo = state.source !== "supabase";
  const hasLines = core.stationHasLines(config, machtileAsm.station);
  const orders = machtileAsmVisibleOrders();
  const role = typeof machtileActualRole === "function" ? machtileActualRole() : "";
  const roleNote = !demo && role && role !== "operator" ? `<p class="asm-notice is-warn" role="note">${escapeHtml(machtileAsmT("asm_role_note"))}</p>` : "";
  root.innerHTML = `
    <div class="asm-toolbar">
      ${stations.length > 1 ? `<div class="asm-stations" role="tablist">${stations.map((code) => `<button type="button" role="tab" class="asm-station-btn${code === machtileAsm.station ? " is-active" : ""}" data-asm-station="${code}"${machtileAsm.busy ? " disabled" : ""}>${escapeHtml(core.stationLabel(code))}</button>`).join("")}</div>` : `<h2 class="asm-station-title">${escapeHtml(core.stationLabel(machtileAsm.station))}</h2>`}
      ${hasLines ? `<div class="asm-lines" role="tablist">${["all", "valve", "pump", "other"].map((key) => `<button type="button" class="asm-line-btn${machtileAsm.line === key ? " is-active" : ""}" data-asm-line="${key}">${escapeHtml(machtileAsmT(`asm_line_${key}`))}</button>`).join("")}</div>` : ""}
      <button type="button" class="secondary-action" data-asm-refresh${machtileAsm.loading || machtileAsm.busy ? " disabled" : ""}>${escapeHtml(machtileAsm.loading ? machtileAsmT("loading") : machtileAsmT("asm_refresh"))}</button>
    </div>
    <p class="asm-hint">${escapeHtml(machtileAsmT("asm_hint"))}</p>
    ${demo ? `<p class="asm-notice" role="note">${escapeHtml(machtileAsmT("asm_demo"))}</p>` : ""}
    ${roleNote}
    ${machtileAsm.error ? `<p class="asm-notice is-error" role="alert">${escapeHtml(machtileAsm.error)}</p>` : ""}
    ${!demo && !machtileAsm.loading && !machtileAsm.users.length ? `<p class="asm-notice is-error" role="alert">${escapeHtml(machtileAsmT("asm_no_operators"))}</p>` : ""}
    <p class="asm-count" data-asm-count>${escapeHtml(machtileAsmT("asm_order_count", { count: orders.length }))}</p>
    <div class="asm-orders">${orders.length ? orders.map(machtileAsmOrderHtml).join("") : `<p class="asm-muted" data-asm-empty>${escapeHtml(machtileAsmT("asm_no_orders"))}</p>`}</div>`;
}

// ------------------------------------------------------------------ 指令（開工／完工關站）
async function machtileAsmWaitStationCommand(uuid, type, maxMs = 5 * 60 * 1000) {
  const cmdCore = window.MachTileStationCommandCore;
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    await machtileAsmDelay(machtileAsmPollMs());
    const rows = await supabaseFetch(`station_commands?select=command_uuid,command_type,status,requested_at,claimed_at,reject_code,reject_message,legacy_snapshot,applied_at&command_uuid=eq.${encodeURIComponent(uuid)}`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row) {
      const view = cmdCore.statusView(row, type, null);
      if (view.terminal) return { row, view };
      machtileAsmSetBusyText(view.title);
    }
  }
  return { row: null, view: { terminal: false, tone: "warn", title: machtileAsmT("asm_result_unknown"), text: "" } };
}

async function machtileAsmSendStationCommand(order, type, shortCompletion = null) {
  const cmdCore = window.MachTileStationCommandCore;
  const ctx = machtileAsmContext(order);
  if (!ctx.ok) throw new Error(machtileAsmT("asm_missing_identity", { fields: ctx.missing.join("、") }));
  const uuid = cmdCore.newUuid(window.crypto);
  const payload = cmdCore.submitPayload({ commandUuid: uuid, commandType: type, machineCode: machtileAsm.station, ...machtileAsmCore().commandFields(ctx.context),
    ...(type === "close" && shortCompletion ? { shortCompletion } : {}) });
  let row;
  try {
    const result = await supabaseFetch(`rpc/${cmdCore.SUBMIT_RPC}`, { method: "POST", body: JSON.stringify(payload) });
    row = Array.isArray(result) ? result[0] : result;
  } catch (error) {
    const info = cmdCore.submitErrorText(error);
    return { ok: false, tone: "bad", text: info.text || error?.message || "" };
  }
  let view = cmdCore.statusView(row || { status: "pending" }, type, null);
  if (!view.terminal) ({ view } = await machtileAsmWaitStationCommand(uuid, type));
  return { ok: view.phase === "applied", tone: view.phase === "applied" ? "ok" : (view.tone || "warn"), text: `${view.title}${view.text ? `：${view.text}` : ""}`, view };
}

async function machtileAsmStart(processId) {
  const order = machtileAsmOrderByProcess(processId);
  if (!order || machtileAsm.busy) return;
  machtileAsm.confirmStart = "";
  machtileAsm.busy = { processId: String(processId), kind: "start", text: machtileAsmT("asm_sending") };
  machtileAsm.results.delete(String(processId));
  machtileAsmRender();
  try {
    const res = await machtileAsmSendStationCommand(order, "start");
    machtileAsm.results.set(String(processId), { tone: res.tone, text: res.text });
    if (res.ok) machtileAsm.shiftByOrder.set(machtileAsmCore().orderKey(order.id, order.stationStep), { state: "running", at: new Date().toISOString() });
  } catch (error) {
    machtileAsm.results.set(String(processId), { tone: "bad", text: error?.message || String(error) });
  } finally {
    machtileAsm.busy = null;
    machtileAsmRender();
  }
}

// ------------------------------------------------------------------ 報工（預覽 → 正式）
function machtileAsmSetBusyText(textValue) {
  if (!machtileAsm.busy) return;
  machtileAsm.busy.text = textValue;
  const holder = document.querySelector(`[data-asm-order="${CSS.escape(machtileAsm.busy.processId)}"] .asm-busy`);
  if (holder) holder.textContent = textValue;
}

function machtileAsmReportClient() {
  const reportCore = window.MachTileStationReportCore;
  return reportCore.createClient({ request: (path, options) => supabaseFetch(path, options) });
}

async function machtileAsmRunReportCommand(args) {
  const reportCore = window.MachTileStationReportCore;
  const client = machtileAsmReportClient();
  const submitted = await client.submit(args);
  const item = Array.isArray(submitted) ? submitted[0] : submitted;
  if (item && item.command_uuid === args.p_command_uuid && reportCore.isTerminal(item)) return item;
  return client.waitForTerminal(args.p_command_uuid, { intervalMs: machtileAsmPollMs(), maxAttempts: 150 });
}

// 委外代收貨（沿用既有對話框）：預覽或正式被要求收貨 → 問數量 → 用新 uuid 重送同一種指令。
async function machtileAsmHandleReceipt(args, row) {
  const reportCore = window.MachTileStationReportCore;
  const action = reportCore.outsourceReceiptAction(row, machtileOutsourceReceiptDialogEnabled());
  if (action.kind === "none") return { args, row, handled: false };
  if (action.kind === "blocked") return { args, row, handled: true, error: action.message };
  let next;
  if (action.kind === "retry-without-receipt") next = reportCore.withoutOutsourceReceipt(args, crypto.randomUUID());
  else if (action.kind === "refresh-preview") next = reportCore.refreshOutsourceReceiptPreview(args, crypto.randomUUID());
  else {
    const qty = await machtileAskOutsourceReceipt(action.snapshot, action.message);
    if (qty === MACHTILE_OUTSOURCE_RECEIPT_SUPERSEDED || qty === null) return { args, row, handled: true, error: machtileAsmT("outsource_receipt_cancelled") };
    next = reportCore.withOutsourceReceipt(args, qty, action.snapshot.expectedDoc4Fingerprint, crypto.randomUUID());
  }
  const nextRow = await machtileAsmRunReportCommand(next);
  return { args: next, row: nextRow, handled: true };
}

async function machtileAsmFollow(args, row) {
  let current = { args, row };
  for (let i = 0; i < 3; i += 1) {
    const handled = await machtileAsmHandleReceipt(current.args, current.row);
    if (handled.error) return { ...current, error: handled.error };
    if (!handled.handled) return current;
    current = { args: handled.args, row: handled.row };
  }
  return current;
}

function machtileAsmOperatorText(code, soft) {
  const reportCore = window.MachTileStationReportCore;
  const key = reportCore.operatorMessageKey(code, soft);
  // 組裝站沒有機台計數器：這幾句改成不提「機台數字」的版本
  const overrides = { simple_block_qty_exceeds: "asm_block_qty_exceeds", simple_block_qty_invalid: "asm_block_qty_invalid", simple_block_not_started: "asm_block_not_started" };
  return machtileAsmT(overrides[key] || key);
}

async function machtileAsmRecordAndFinish(processId, finalArgs, finalRow, ctx) {
  const reportCore = window.MachTileStationReportCore;
  const order = ctx.order;
  const card = reportCore.resultCard(finalRow);
  if (!["applied", "applied-late"].includes(card.kind)) {
    if (card.kind === "soft") {
      machtileAsm.ack = { processId, message: machtileAsmOperatorText(card.code, true), next: () => reportCore.retryWithAck(finalArgs, card.code, crypto.randomUUID()), ctx };
      return { tone: "warn", text: machtileAsmT("asm_needs_confirm") };
    }
    return { tone: "bad", text: `${machtileAsmT("asm_report_failed")}${machtileAsmOperatorText(card.code, false)}` };
  }
  const names = ctx.valid.operatorIds.map((id) => machtileAsm.users.find((u) => u.id === id)?.name).filter(Boolean);
  let recordNote = "";
  try {
    const reportType = ctx.mode === "finish" ? "finish" : "noon";
    const reportPayload = machtileAsmCore().productionReportPayload({ args: finalArgs, reportType, operatorIds: ctx.valid.operatorIds, stationCode: machtileAsm.station,
      line: machtileAsmCore().stationHasLines(config, machtileAsm.station) ? machtileAsmCore().lineOf(order.part) : "" });
    const saved = await submitReport(finalArgs.p_good_qty, finalArgs.p_fail_qty, finalArgs.p_report_note || "", reportType, {
      order, reportUuid: finalArgs.p_command_uuid, reportPayload, operators: ctx.valid.operatorIds, requireStructured: true, noFiles: true,
    });
    if (!saved?.wroteCloud) recordNote = machtileAsmT("asm_record_unconfirmed");
  } catch (error) {
    recordNote = `${machtileAsmT("asm_record_unconfirmed")} ${error?.message || ""}`.trim();
  }
  const summary = machtileAsmCore().resultSummary({ good: finalArgs.p_good_qty, bad: finalArgs.p_fail_qty, operatorNames: names });
  const base = card.kind === "applied-late" ? machtileAsmT("asm_applied_late") : machtileAsmT("asm_applied", summary);
  const form = machtileAsmForm(processId);
  Object.assign(form, { open: false, good: "", bad: "", defectOpen: false, failReasonCode: "", note: "", error: "" });
  void machtileAsmLoadProgress([processId]).then(machtileAsmRender);
  if (ctx.mode === "finish") {
    machtileAsmSetBusyText(machtileAsmT("asm_closing"));
    const close = await machtileAsmSendStationCommand(order, "close", ctx.shortCompletion || null);
    if (close.ok) machtileAsm.closed.add(processId);
    return { tone: close.ok ? "ok" : close.tone, text: `${base} ${close.ok ? machtileAsmT("asm_closed") : `${machtileAsmT("asm_close_failed")}${close.text}`} ${recordNote}`.trim(), closed: close.ok };
  }
  return { tone: recordNote ? "warn" : "ok", text: `${base} ${recordNote}`.trim() };
}

async function machtileAsmSubmit(processId) {
  const core = machtileAsmCore();
  const reportCore = window.MachTileStationReportCore;
  const order = machtileAsmOrderByProcess(processId);
  if (!order || machtileAsm.busy) return;
  const form = machtileAsmForm(processId);
  const mode = form.mode;
  const valid = core.validateForm({ ...form, operatorIds: machtileAsmFormOperators(form) }, { failReasons: machtileAsmDefectReasons(), choices: machtileAsm.users, mode, defectAllowed: machtileAsmDefectAllowed() });
  if (!valid.ok) {
    const first = ["good", "bad", "failReasonCode", "note", "operators"].find((k) => valid.errors[k]);
    form.error = machtileAsmT(`asm_err_${valid.errors[first]}`);
    machtileAsmRender();
    return;
  }
  const ctxRes = machtileAsmContext(order);
  if (!ctxRes.ok) { form.error = machtileAsmT("asm_missing_identity", { fields: ctxRes.missing.join("、") }); machtileAsmRender(); return; }
  // 完工：做的數量（已報良品＋最後這次良品）少於工單數量 → 先問「還差 N 個，確定短交？」＋原因（車床同一份短交合約）。
  // 預設＝做滿，不會跳這個問題。
  let shortCompletion = null;
  if (mode === "finish") {
    if (form.shortPrompt) {
      const sc = core.shortCompletionValue(form.shortReason, form.shortNote);
      if (!sc.ok) { form.error = machtileAsmT(`asm_err_${sc.error}`); machtileAsmRender(); return; }
      shortCompletion = sc.value;
    } else {
      await machtileAsmLoadProgress([processId]);
      const sf = core.shortfall({ planned: order.total, reportedGood: machtileAsmReportedGood(processId), thisGood: valid.goodQty });
      if (!sf.known) { form.error = machtileAsmT("asm_err_progress_unknown"); machtileAsmRender(); return; }
      if (sf.short > 0) {
        if (typeof machtileShortCompletionEnabled !== "function" || !machtileShortCompletionEnabled(machtileAsm.station)) {
          form.error = machtileAsmT("asm_short_not_enabled", { short: sf.short }); machtileAsmRender(); return;
        }
        form.shortPrompt = sf; form.shortReason = ""; form.shortNote = ""; form.error = "";
        machtileAsmRender();
        return;
      }
    }
  }
  form.error = "";
  machtileAsm.ack = null;
  machtileAsm.results.delete(processId);
  machtileAsm.busy = { processId, kind: mode, text: machtileAsmT("asm_sending") };
  machtileAsmRender();
  let outcome;
  try {
    if (mode === "finish" && !valid.hasQty) {
      machtileAsmSetBusyText(machtileAsmT("asm_closing"));
      const close = await machtileAsmSendStationCommand(order, "close", shortCompletion);
      if (close.ok) { machtileAsm.closed.add(processId); form.open = false; form.shortPrompt = null; }
      outcome = { tone: close.ok ? "ok" : close.tone, text: close.ok ? machtileAsmT("asm_closed") : `${machtileAsmT("asm_close_failed")}${close.text}` };
    } else {
      if (!machtileAsm.guard.enabled) throw new Error(machtileAsmT("asm_report_closed"));
      if (await machtileHasPendingReport(machtileAsm.station, order)) throw new Error(machtileAsmT("asm_pending_report"));
      const receiptEnabled = machtileOutsourceReceiptDialogEnabled();
      const previewArgs = core.buildReportArgs(ctxRes.context, valid, crypto.randomUUID(), { preview: true, failReasons: machtileAsmDefectReasons(), outsourceReceiptDialogEnabled: receiptEnabled });
      machtileAsmSetBusyText(machtileAsmT("asm_previewing"));
      const followed = await machtileAsmFollow(previewArgs, await machtileAsmRunReportCommand(previewArgs));
      if (followed.error) throw new Error(followed.error);
      const card = reportCore.resultCard(followed.row);
      const ctx = { order, valid, mode, shortCompletion };
      if (card.kind === "preview-soft") {
        machtileAsm.ack = { processId, message: machtileAsmOperatorText(card.guardCode, true),
          next: () => reportCore.retryPreviewWithAck(followed.args, followed.row, card.guardCode, crypto.randomUUID(), valid.note), ctx };
        outcome = { tone: "warn", text: machtileAsmT("asm_needs_confirm") };
      } else if (card.kind !== "previewed") {
        outcome = { tone: "bad", text: `${machtileAsmT("asm_report_failed")}${machtileAsmOperatorText(card.code || card.guardCode, false)}` };
      } else {
        const snapshot = reportCore.buildClientGuardSnapshot(followed.row);
        const receipt = receiptEnabled ? reportCore.confirmedPreviewReceipt(followed.args, followed.row) : null;
        const finalArgs = core.buildReportArgs(ctxRes.context, valid, crypto.randomUUID(), { preview: false, failReasons: machtileAsmDefectReasons(),
          outsourceReceiptDialogEnabled: receiptEnabled, clientGuardSnapshot: snapshot,
          previousOutsourceReceiptQty: receipt?.previousOutsourceReceiptQty ?? null, expectedDoc4Fingerprint: receipt?.expectedDoc4Fingerprint ?? null });
        machtileAsmSetBusyText(machtileAsmT("asm_writing"));
        const done = await machtileAsmFollow(finalArgs, await machtileAsmRunReportCommand(finalArgs));
        if (done.error) throw new Error(done.error);
        outcome = await machtileAsmRecordAndFinish(processId, done.args, done.row, ctx);
      }
    }
  } catch (error) {
    outcome = { tone: "bad", text: `${machtileAsmT("asm_report_failed")}${error?.message || error}` };
  } finally {
    machtileAsm.busy = null;
  }
  machtileAsm.results.set(processId, outcome);
  if (outcome?.tone === "ok") showToast(outcome.text);
  machtileAsmRender();
}

async function machtileAsmConfirmAck(processId) {
  const ack = machtileAsm.ack;
  if (!ack || ack.processId !== processId || machtileAsm.busy) return;
  machtileAsm.ack = null;
  machtileAsm.busy = { processId, kind: "ack", text: machtileAsmT("asm_writing") };
  machtileAsmRender();
  let outcome;
  try {
    const args = ack.next();
    const done = await machtileAsmFollow(args, await machtileAsmRunReportCommand(args));
    if (done.error) throw new Error(done.error);
    outcome = await machtileAsmRecordAndFinish(processId, done.args, done.row, ack.ctx);
  } catch (error) {
    outcome = { tone: "bad", text: `${machtileAsmT("asm_report_failed")}${error?.message || error}` };
  } finally {
    machtileAsm.busy = null;
  }
  machtileAsm.results.set(processId, outcome);
  machtileAsmRender();
}

// ------------------------------------------------------------------ 事件
function machtileAsmHandleClick(event) {
  const t = event.target instanceof Element ? event.target.closest("button") : null;
  if (!t || !t.closest("[data-assembly-root]")) return;
  const d = t.dataset;
  if (d.asmRefresh !== undefined) { void machtileAsmLoad({ reloadOrders: true }); return; }
  if (d.asmStation) { machtileAsm.station = d.asmStation; machtileAsm.line = "all"; void machtileAsmLoad(); return; }
  if (d.asmLine) { machtileAsm.line = d.asmLine; machtileAsmRender(); return; }
  if (d.asmStart) { machtileAsm.confirmStart = d.asmStart; machtileAsmRender(); return; }
  if (d.asmStartCancel) { machtileAsm.confirmStart = ""; machtileAsmRender(); return; }
  if (d.asmStartConfirm) { void machtileAsmStart(d.asmStartConfirm); return; }
  if (d.asmReport || d.asmFinish) {
    const pid = d.asmReport || d.asmFinish;
    const form = machtileAsmForm(pid);
    form.open = true; form.mode = d.asmFinish ? "finish" : "report"; form.error = ""; form.shortPrompt = null;
    machtileAsm.results.delete(pid);
    machtileAsmRender();
    document.querySelector(`[data-asm-good="${CSS.escape(pid)}"]`)?.focus();
    return;
  }
  if (d.asmCancel) { const form = machtileAsmForm(d.asmCancel); form.open = false; form.error = ""; machtileAsmRender(); return; }
  if (d.asmSubmit) { void machtileAsmSubmit(d.asmSubmit); return; }
  if (d.asmAckConfirm) { void machtileAsmConfirmAck(d.asmAckConfirm); return; }
  if (d.asmAckCancel) { machtileAsm.ack = null; machtileAsm.results.set(d.asmAckCancel, { tone: "warn", text: machtileAsmT("asm_ack_cancelled") }); machtileAsmRender(); }
}

function machtileAsmHandleInput(event) {
  const el = event.target;
  if (!(el instanceof HTMLElement) || !el.closest("[data-assembly-root]")) return;
  const d = el.dataset;
  // 改了數字＝之前的「需要確認」不再對應畫面上的值 → 收掉，要重新送出（重新預覽）
  const pid = d.asmGood || d.asmBad || d.asmNote;
  if (pid && machtileAsm.ack?.processId === pid) { machtileAsm.ack = null; document.querySelector(`[data-asm-ack="${CSS.escape(pid)}"]`)?.remove(); }
  if (d.asmShortNote) { machtileAsmForm(d.asmShortNote).shortNote = el.value; return; }
  if (d.asmGood && machtileAsmForm(d.asmGood).shortPrompt) {
    // 改了最後件數＝差幾個要重算：收掉短交問題，按鈕回到「確認完工關站」
    machtileAsmForm(d.asmGood).shortPrompt = null;
    document.querySelector(`[data-asm-short="${CSS.escape(d.asmGood)}"]`)?.remove();
    const btn = document.querySelector(`[data-asm-submit="${CSS.escape(d.asmGood)}"]`);
    if (btn) btn.textContent = machtileAsmT("asm_finish_submit");
  }
  if (d.asmGood) machtileAsmForm(d.asmGood).good = el.value;
  else if (d.asmBad) machtileAsmForm(d.asmBad).bad = el.value;
  else if (d.asmNote) machtileAsmForm(d.asmNote).note = el.value;
}

function machtileAsmHandleChange(event) {
  const el = event.target;
  if (!(el instanceof HTMLElement) || !el.closest("[data-assembly-root]")) return;
  const d = el.dataset;
  if (machtileAsm.ack && [d.asmDefectToggle, d.asmReason, d.asmOperator].includes(machtileAsm.ack.processId)) machtileAsm.ack = null;
  if (d.asmShortReason) { const f = machtileAsmForm(d.asmShortReason); f.shortReason = el.value; f.error = ""; machtileAsmRender(); return; }
  if (d.asmDefectToggle) { const f = machtileAsmForm(d.asmDefectToggle); f.defectOpen = el.checked; if (!el.checked) { f.bad = ""; f.failReasonCode = ""; } machtileAsmRender(); return; }
  if (d.asmReason) { machtileAsmForm(d.asmReason).failReasonCode = el.value; machtileAsmRender(); return; }
  if (d.asmOperator) { const f = machtileAsmForm(d.asmOperator); f.operatorIds = machtileAsmCore().toggleOperator(machtileAsmFormOperators(f), el.value); machtileAsmRender(); }
}

// 旗標關＝頁面 DOM 跟沒有這個功能時一模一樣（不放入口、不放畫面）；旗標開才插入。
function machtileAsmEnsureDom() {
  if (!machtileAsmEnabled()) return;
  if (!document.querySelector("[data-assembly-entry]")) {
    const anchor = document.querySelector('#dashboardView [data-monitor-batch-entry="mill"]');
    if (anchor) {
      const button = document.createElement("button");
      button.className = "primary-action monitor-batch-entry";
      button.type = "button";
      button.dataset.view = "assembly";
      button.setAttribute("data-assembly-entry", "");
      anchor.after(button);
    }
  }
  if (!document.getElementById("assemblyView")) {
    const settings = document.getElementById("settingsView");
    if (settings) {
      const section = document.createElement("section");
      section.id = "assemblyView";
      section.className = "view";
      section.setAttribute("aria-labelledby", "assemblyTitle");
      section.innerHTML = `<div class="view-heading"><div><p class="eyebrow">Assembly Report</p><h1 id="assemblyTitle">${escapeHtml(machtileAsmT("asm_title"))}</h1></div></div><div class="assembly-report" data-assembly-root></div>`;
      settings.before(section);
    }
  }
}

function machtileAsmRemoveDom() {
  document.querySelectorAll("[data-assembly-entry]").forEach((el) => el.remove());
  const view = document.getElementById("assemblyView");
  if (view) {
    const wasActive = view.classList.contains("is-active");
    view.remove();
    if (wasActive && typeof switchView === "function") switchView("dashboard");
  }
}

machtileAsmEnsureDom();
document.addEventListener("click", machtileAsmHandleClick);
document.addEventListener("input", machtileAsmHandleInput);
document.addEventListener("change", machtileAsmHandleChange);
machtileAsmSyncEntry();
