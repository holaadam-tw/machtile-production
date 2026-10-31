import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const shots = process.env.MACHTILE_SCREENSHOT_DIR || "D:/04_SoftNet/ops/codex-inbox/shots";
await mkdir(shots, { recursive: true });
await mkdir("D:/04_SoftNet/ops/codex-inbox/20261015-app-finish-dialog-shots", { recursive: true });
const moduleSpec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const imported = await import(moduleSpec);
const { chromium } = imported.default || imported;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.resolve(root, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const fake = "https://single-report.test";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenantId = id(1), workOrderId = id(101), processId = id(301);
const previewResult = {
  command_uuid: id(701), status: "previewed", allowed: true, guard_code: null, hard: false, message: "可送出",
  available: 80, supply: 100, done_c: 20, prev_index_sn: 1, prev_kind: "INHOUSE", predicted_ac03_qty: 38,
  order_qty: 1000, order_start: "2026-10-01", shown_at: "2026-10-13T04:00:00.000Z",
  legacy_snapshot: { report: { guard: { code: "", hard: false, message: "可送出", Details: {
    available: 80, supply: 100, done_c: 20, prev_index_sn: 1, prev_kind: "INHOUSE", predicted_ac03_qty: 38,
    order_start: "2026-10-01", effective_need: 1000,
  } } } },
};
const calls = { commands: [], reports: [], closeCommands: [] };
const requestUrls = [];
let currentMachine = "A04";
let guardFails = false;
let guardEnabled = true;
let finishButtonEnabled = true;
let pickStartEnabled = false;
let assignedPausedA04 = false;
const assignedQueries = [];
let finalSubmitFails = false;
let finalSubmitDelayMs = 0;
let reconciledCommand = null;
let closeCommand = null;
let reportedOutput = 920;
let reportedFail = 0; let noStartCounter = false;
let freshReadEnabled = false;
let outsourceReceiptEnabled = false;
let outsourceReceiptRequired = false;
let outsourceReceiptContract = "material_confirm";
let receiptFingerprint = "a".repeat(64);
let finalStaleOnce = false;
let finalRequiredOnce = false;
let starterUserId = null;
let previewBlockedCode = "";
let previewSoftCode = "";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 800, height: 1100 }, serviceWorkers: "block" });
await context.route("**/*", async route => {
  const req = route.request(); const url = new URL(req.url());
  if (url.origin === fake) {
    requestUrls.push(url.href);
    const json = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/rpc/machtile_get_station_report_guard_config")) return guardFails ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "guard 讀取失敗" }) }) : json({ factory_synced: true, machine_code: "A04", report_enabled: guardEnabled, report_enabled_machines: { A04: guardEnabled }, fail_reason_codes: ["尺寸不良", "外觀", "刀具崩", "試刀", "材料不良", "其他"] });
    if (url.pathname.endsWith("/v_work_order_cards")) return json([{ id: workOrderId, tenant_id: tenantId, work_order_no: "XX01202604140011", part_no: "GQ7Q", part_name: "試點件", quantity: 1000, due_date: "2026-10-20", priority: "normal", work_order_status: "in_progress", current_process_id: processId, current_process_name: "車床", current_process_status: "running", machine_name: currentMachine, qty_completed: 920, qty_defect: 0, progress_percent: 92, last_report_at: "2026-10-13T03:00:00Z", current_process_off_station: false }]);
    if (url.pathname.endsWith("/v_machine_management_cards")) return json([{ id: id(201), machine_code: currentMachine, machine_name: currentMachine, machine_type: "車床", status: "running", display_order: 1 }]);
    if (url.pathname.endsWith("/work_order_processes") && url.searchParams.get("select")?.includes("legacy_index_sn")) return json([{ id: processId, legacy_index_sn: 2, manufacture_ii_id: "MII-42", simulation_id: "Y011BG35APT0", work_orders: { part_no: "GQ7Q" } }]);
    if (freshReadEnabled && url.pathname.endsWith("/work_order_processes") && url.searchParams.get("select")?.includes("qty_completed") && !url.searchParams.get("select")?.includes("machines!")) return json([{ id: processId, qty_completed: 920, qty_defect: 0 }]);
    if (url.pathname.endsWith("/app_users")) return json([{ id: id(901), name: "試點員", legacy_user_id: "TEST-001" }, { id: id(902), name: "陳柏叡", legacy_user_id: "TEST-002" }]);
    // 單台報工簡化：報工人預設＝今天開工（dailyStart）的人，同批次頁規則。
    if (url.pathname.endsWith("/production_reports") && req.method() === "GET" && url.searchParams.get("select")?.includes("operator_ids") && url.searchParams.get("report_type") === "eq.dailyStart") {
      return json(starterUserId ? [{ process_id: processId, report_type: "dailyStart", created_at: "2026-10-31T00:05:00Z", user_id: starterUserId, operator_ids: [starterUserId] }] : []);
    }
    if (url.pathname.endsWith("/rpc/batch_report_progress")) return json([{ process_id: processId, legacy_output: reportedOutput, legacy_fail: reportedFail, pending_output: 0, pending_fail: 0, pending_count: 0, last_report_at: "2026-10-13T03:00:00Z", actual_start_at: "2026-10-13T00:00:00Z" }]);
    if (url.pathname.endsWith("/production_reports") && req.method() === "GET" && url.searchParams.get("select") === "report_type,report_payload,created_at") return json(noStartCounter ? [] : [{ report_type: "noon", created_at: "2026-10-13T03:00:00Z", report_payload: { machine_qty: 920 } }]);
    if (url.pathname.endsWith("/rpc/machtile_submit_station_report")) {
      const body = req.postDataJSON(); calls.commands.push(body);
      // REAL Factory preview shape for a receipt failure (wt-deploy40 SoftNet/SoftNetWebII/Services/StationCommands):
      // StationReportPreview.cs Preview() :61-79 returns Status=previewed (never rejected) with
      // SerializePreviewResult :126-178 → allowed:false, hard:true, guard_code, receipt fields at top level;
      // StationCommandSources.cs :155-176 writes it back with p_reject_code=null, p_legacy_snapshot=null.
      if (body.p_preview && outsourceReceiptRequired && body.p_previous_outsource_receipt_qty == null) {
        outsourceReceiptRequired = false;
        const guardCode = "PREV_OUTSOURCE_RECEIPT_REQUIRED";
        return json({ command_uuid: body.p_command_uuid, command_type: "report_preview", status: "previewed",
          reject_code: null, reject_message: null, legacy_snapshot: null,
          preview_result: { status: "previewed", allowed: false, guard_code: guardCode, hard: true,
            message: "請確認『素材外包』（路線甲廠）原料委外已收貨。",
            legacy_snapshot: { report: { guard: { code: guardCode, hard: true, message: "請確認『素材外包』（路線甲廠）原料委外已收貨。", Details: {} } } },
            command_uuid: body.p_command_uuid, available: 0, supply: 0, done_c: 0, prev_index_sn: 1, prev_kind: "OUTSOURCE", predicted_ac03_qty: 0,
            previous_outsource_step_name: "素材外包", previous_outsource_doc4_numbers: ["D4-20261031-01"], outsource_unconfirmed_qty: 12,
            expected_doc4_fingerprint: receiptFingerprint, receipt_mode: outsourceReceiptContract, receipt_required_qty: 12,
            receipt_steps: [{ index_sn: 1, process_name: "素材外包", vendor_name: "路線甲廠", unconfirmed_qty: 12 }],
            order_qty: 1000, order_start: "2026-10-01", shown_at: "2026-10-31T01:00:00.000Z" } });
      }
      // REAL Factory final reject shapes: StationReportApplier.cs :90-92 (Validate → WithSnapshot :276-301 merges
      // failure_detail from StationReportOutsourceReceipt.cs :56-67) and :119-121 (in-transaction STALE, no detail);
      // StationCommandSources.cs :159-161 stores legacy_snapshot={report, guard}, :163-176 preview_result=null.
      if (!body.p_preview && finalStaleOnce && body.p_previous_outsource_receipt_qty != null) {
        finalStaleOnce = false;
        receiptFingerprint = "e".repeat(64);
        outsourceReceiptRequired = true;
        return json({ command_uuid: body.p_command_uuid, command_type: "report", status: "rejected",
          reject_code: "PREV_OUTSOURCE_RECEIPT_STALE", reject_message: "委外未收貨明細已改變，請重新預覽後再送。", preview_result: null,
          legacy_snapshot: { report: { command_uuid: body.p_command_uuid, guard: { code: "PREV_OUTSOURCE_RECEIPT_STALE", hard: true } },
            guard: { code: "PREV_OUTSOURCE_RECEIPT_STALE", hard: true } } });
      }
      if (!body.p_preview && finalRequiredOnce && body.p_previous_outsource_receipt_qty == null) {
        finalRequiredOnce = false;
        const guardCode = "PREV_OUTSOURCE_RECEIPT_REQUIRED";
        return json({ command_uuid: body.p_command_uuid, command_type: "report", status: "rejected",
          reject_code: guardCode, reject_message: "上一道『研磨』（丙廠）還沒收貨，回來幾件？", preview_result: null,
          legacy_snapshot: { report: { command_uuid: body.p_command_uuid, guard: { code: guardCode, hard: true },
            failure_detail: { previous_step_name: "研磨", vendor_name: "丙廠", doc4_numbers: ["D4-20261031-02"], unconfirmed_qty: 6,
              receipt_mode: "count", receipt_required_qty: 6, receipt_steps: [{ index_sn: 1, process_name: "研磨", vendor_name: "丙廠", unconfirmed_qty: 6 }],
              expected_doc4_fingerprint: "f".repeat(64), doc4_line_ids: ["L-1"] } }, guard: { code: guardCode, hard: true } } });
      }
      if (body.p_preview && previewSoftCode) {
        const guard = { code: previewSoftCode, hard: false, message: "同料號已有較新工單", Details: { ...previewResult.legacy_snapshot.report.guard.Details } };
        return json({ command_uuid: body.p_command_uuid, command_type: "report_preview", status: "previewed", reject_code: null, reject_message: null, legacy_snapshot: null,
          preview_result: { ...previewResult, command_uuid: body.p_command_uuid, allowed: false, hard: false, guard_code: previewSoftCode, message: guard.message,
            legacy_snapshot: { report: { guard } } } });
      }
      if (body.p_preview && previewBlockedCode) {
        const guard = { code: previewBlockedCode, hard: true, message: "本次數量超過可報數", Details: { ...previewResult.legacy_snapshot.report.guard.Details, available: 30 } };
        return json({ command_uuid: body.p_command_uuid, command_type: "report_preview", status: "previewed", reject_code: null, reject_message: null, legacy_snapshot: null,
          preview_result: { ...previewResult, command_uuid: body.p_command_uuid, allowed: false, hard: true, guard_code: previewBlockedCode, message: guard.message, available: 30,
            legacy_snapshot: { report: { guard } } } });
      }
      if (!body.p_preview && finalSubmitFails) {
        reconciledCommand = { command_uuid: body.p_command_uuid, command_type: "report", status: "applied", good_qty: body.p_good_qty, fail_qty: body.p_fail_qty };
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "response lost" }) });
      }
      if (!body.p_preview && finalSubmitDelayMs) await new Promise(resolve => setTimeout(resolve, finalSubmitDelayMs));
      return json(body.p_preview
        ? { command_uuid: body.p_command_uuid, command_type: "report_preview", status: "previewed", preview_result: { ...previewResult, command_uuid: body.p_command_uuid } }
        : { command_uuid: body.p_command_uuid, command_type: "report", status: "applied", good_qty: body.p_good_qty, fail_qty: body.p_fail_qty });
    }
    if (url.pathname.endsWith("/rpc/machtile_submit_station_command")) {
      const body = req.postDataJSON(); calls.closeCommands.push(body);
      closeCommand = { command_uuid: body.p_command_uuid, command_type: "close", status: "applied", reject_code: null, reject_message: null };
      return json(closeCommand);
    }
    if (url.pathname.endsWith("/station_commands") && req.method() === "GET") {
      const requested = url.searchParams.get("command_uuid") || "";
      if (closeCommand && requested.includes(closeCommand.command_uuid)) return json([closeCommand]);
      return json(reconciledCommand ? [reconciledCommand] : []);
    }
    if (url.pathname.endsWith("/work_order_processes") && url.searchParams.get("select")?.includes("machines!work_order_processes_machine_id_fkey")) {
      assignedQueries.push(url.href);
      if (assignedPausedA04) return json([{ id: processId, tenant_id: tenantId, process_order: 2, process_name: "車床", process_type: "cnc", status: "paused", off_station_at: null, qty_completed: 920, queue_order: null, manufacture_ii_id: "MII-42", simulation_id: "Y011BG35APT0",
        work_orders: { id: workOrderId, work_order_no: "XX01202604140011", part_no: "GQ7Q", part_name: "試點件", quantity: 1000, due_date: "2026-10-20", status: "in_progress", legacy_mes_source: null, external_ref: null },
        machines: { id: id(201), machine_code: "A04" } }]);
    }
    if (url.pathname.endsWith("/production_reports") && req.method() === "POST") { calls.reports.push(req.postDataJSON()); return json([calls.reports.at(-1)]); }
    return json([]);
  }
  if (url.origin === base.slice(0, -1)) {
    if (url.pathname === "/config.js") return route.fulfill({ contentType: "text/javascript", body: `window.MACHTILE_CONFIG={authMode:"dev-nologin",supabaseUrl:"${fake}",supabaseAnonKey:"test",useSupabase:true,enableStationReport:true,stationReportMachines:["A04"],outsourceReceiptDialogEnabled:${outsourceReceiptEnabled},enableFinishButton:${finishButtonEnabled},enableFinishClose:true,finishCloseMachines:["A04"],enableShortCompletion:true,shortCompletionMachines:["A04"],stationCommandMachines:["A04"],enablePickStartFlow:${pickStartEnabled},pickStartFlowMachines:${pickStartEnabled ? '["A04"]' : "[]"},disableServiceWorker:true};` });
    return route.continue();
  }
  return route.abort();
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof machtileRenderSingleStationReport === "function");
await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
// Admin keeps the full smart-report detail (preview / hold confirm / reconcile) behind 技術細節.
await page.evaluate(() => { machtileAuthState.role = "admin"; });
await page.locator("[data-open-report]:visible").first().click();
await page.locator('#reportForm [data-report-type="noon"]').click();
assert.equal(await page.locator('#reportForm .report-type-tab[data-report-type="finish"]').count(), 0, "routine report has no finish tab");
await page.locator("#completedQty").fill("958");
await page.waitForFunction(() => document.querySelector("[data-simple-report-defect]"));
await page.locator("[data-simple-report-defect]").check();
await page.locator("#defectQty").fill("2");
await page.waitForFunction(() => document.querySelector('[data-station-report-preview="A04"]'));
assert.equal(await page.locator("[data-station-report-tech]").count(), 1, "admin view has the 技術細節 expander");
assert.equal(await page.locator('[data-station-report-preview="A04"]').isVisible(), false, "technical controls start collapsed for admin");
await page.locator("[data-station-report-tech] > summary").click();
assert.equal(await page.locator("#singleStationReportPanel .station-report-panel").isVisible(), true, "single-machine smart-report card remains visible by default");
assert.equal(await page.locator("#singleStationReportPanel [data-station-report-panel]").count(), 0, "batch-only collapsed-panel marker does not leak into the single-machine report card");
assert.equal(await page.locator("#reportFailReasonField").isHidden(), true, "A04 smart report does not show a duplicate general fail-reason field");
assert.equal(await page.locator('.station-report-reason:visible').count(), 1, "A04 with defects shows exactly one fail-reason field");

const routeState = await page.evaluate(() => ({ allowlisted: machtileSingleStationReportAllowlisted("A04"), active: machtileSingleStationReportActive(), panelHidden: document.querySelector("#singleStationReportPanel").hidden, submitHidden: document.querySelector("#reportForm .submit-report").hidden }));
assert.equal(routeState.submitHidden, false, `allowlisted station keeps the primary submit visible: ${JSON.stringify(routeState)}`);
assert.equal(await page.locator("#reportForm .submit-report").innerText(), "送出報工");
assert.match(await page.locator("#singleStationReportPanel").innerText(), /智慧報工/);
assert.equal(await page.locator('[data-station-report-reason="A04"]').isEnabled(), true, `${await page.locator("#singleStationReportPanel").innerText()}\n${requestUrls.filter(u => u.includes("work_order_processes")).join("\n")}`);
await page.evaluate(operatorId => {
  const list = document.createElement("div");
  list.id = "machtileOperatorList";
  list.innerHTML = `<input type="checkbox" value="${operatorId}" data-mapped="1">`;
  document.body.append(list);
}, id(901));
await page.locator('[data-station-report-reason="A04"]').selectOption("尺寸不良");
await page.locator("#reportForm .submit-report").click();
await page.waitForFunction(() => document.querySelector("#reportSubmitError")?.textContent.includes("請勾選實際操作的人員"));
assert.equal(calls.commands.length, 0, "smart preview rejects an unselected mapped operator");
assert.match(await page.locator("#singleStationReportPanel").innerText(), /請勾選實際操作的人員/);
assert.match(await page.locator("#toast").innerText(), /請勾選實際操作的人員/, "blocked smart report also shows a toast");
assert.match(await page.locator("#reportSubmitError").innerText(), /請勾選實際操作的人員/, "primary submit keeps validation visible");
await page.evaluate(() => {
  const input = document.querySelector('#machtileOperatorList input[type="checkbox"]');
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.evaluate(secondOperatorId => {
  const second = document.createElement("input");
  second.type = "checkbox";
  second.value = secondOperatorId;
  second.dataset.mapped = "1";
  second.checked = true;
  document.getElementById("machtileOperatorList").append(second);
}, id(902));
await page.locator('#singleStationReportPanel [data-station-report-preview="A04"]').click();
assert.equal(calls.commands.length, 0, "lathe preview rejects multiple operators before any command is created");
assert.match(await page.locator("#singleStationReportPanel").innerText(), /車床報工一次只能選一位報工人員/);
await page.evaluate(() => document.querySelectorAll('#machtileOperatorList input[type="checkbox"]')[1].remove());
await page.evaluate(({ processId, workOrderId, tenantId, commandUuid }) => {
  localStorage.setItem("machtile.stationCmdStartBackfill.v1", JSON.stringify({
    [commandUuid]: { machineCode: "A04", snap: { qty: 10, processId, workOrderId, tenantId } },
  }));
}, { processId, workOrderId, tenantId, commandUuid: id(777) });
await page.locator("#reportForm .submit-report").click();
await page.waitForFunction(() => document.querySelector("#reportSubmitError")?.textContent.includes("這台還有報工在送出中"));
assert.equal(calls.commands.length + calls.reports.length, 0, "start-backfill queue blocks smart preview before every write");
await page.evaluate(() => localStorage.removeItem("machtile.stationCmdStartBackfill.v1"));
await page.evaluate(({ processId }) => {
  config.enableOutboxSubmit = true;
  machtileGetOutbox = async () => ({ outbox: { list: async () => [{ status: "pending", payload: { process_id: processId } }] } });
}, { processId });
await page.locator("#reportForm .submit-report").click();
await page.waitForFunction(() => document.querySelector("#reportSubmitError")?.textContent.includes("這台還有報工在送出中"));
assert.equal(calls.commands.length + calls.reports.length, 0, "pending outbox blocks smart preview before every write");
await page.evaluate(() => { config.enableOutboxSubmit = false; });
await page.evaluate(() => {
  const flow = machtileStationReportState(machtileBatchRow("A04"));
  flow.phase = "waiting-preview";
  flow.previewStartedAt = Date.now() - 5200;
  machtileRenderStationReportSurfaces();
});
assert.match(await page.locator("#singleStationReportPanel .station-report-preview-wait").innerText(), /工廠計算中…\s*5 秒/, "five-second preview wait stays visible at the primary action");
await page.evaluate(() => {
  const flow = machtileStationReportState(machtileBatchRow("A04"));
  flow.phase = "idle";
  flow.previewStartedAt = null;
  machtileRenderStationReportSurfaces();
});
await page.locator('#singleStationReportPanel [data-station-report-preview="A04"]').click();
await page.waitForTimeout(500);
assert.equal(await page.locator('#singleStationReportPanel [data-station-report-confirm="A04"]').count(), 1, `${await page.locator("#singleStationReportPanel").innerText()} calls=${JSON.stringify(calls.commands)}`);
assert.equal(calls.commands.length, 1, "preview creates one command");
assert.equal(calls.commands[0].p_preview, true);
assert.equal(calls.commands[0].p_good_qty, 38);
assert.equal(calls.commands[0].p_fail_qty, 2);
for (const field of ["p_backfill_qty", "p_counter_today_qty", "p_start_counter", "p_reported_before"]) {
  assert.equal(field in calls.commands[0], false, `flag off omits ${field} from the real APP RPC payload`);
}
assert.equal(calls.commands[0].p_fail_reason_code, "尺寸不良");
assert.deepEqual(await page.evaluate(() => machtileBatchRow("A04").stationReport.singleReport.operators), [id(901)], "selected mapped operator is frozen into the smart-report flow");
assert.equal(calls.reports.length, 0, "preview never records production report");

const previewUuid = calls.commands.at(-1).p_command_uuid;
await page.evaluate(() => {
  const flow = machtileStationReportState(machtileBatchRow("A04"));
  flow.phase = "preview-timeout";
  flow.previewStartedAt = Date.now() - 25000;
  flow.result = null;
  machtileRenderStationReportSurfaces();
});
assert.match(await page.locator("#singleStationReportPanel").innerText(), /工廠沒有回應，請再按一次送出/, "25-second preview timeout offers a retry in place");
assert.equal(await page.locator("#reportForm .submit-report").innerText(), "重新送出", "timeout turns the one primary button into the retry");
await page.evaluate(() => machtileStationReportRetryPreview("A04"));
await page.waitForFunction(() => document.querySelector('[data-station-report-confirm="A04"]'));
assert.equal(calls.commands.at(-1).p_command_uuid, previewUuid, "preview retry reuses the same idempotent command_uuid");

reportedOutput = 921;
freshReadEnabled = true;
const finalsBeforeChangedR = calls.commands.filter(command => !command.p_preview).length;
await page.evaluate(() => {
  config.reportTotalSemanticsEnabled = true;
  machtileStationReportState(machtileBatchRow("A04")).singleReport.previewReported = 920;
});
await page.evaluate(() => machtileStationReportSubmitFinal("A04"));
await page.waitForFunction(() => document.querySelector("#singleStationReportPanel")?.textContent.includes("已報數量已改變，請重新預覽"));
assert.equal(calls.commands.filter(command => !command.p_preview).length, finalsBeforeChangedR, "changed R after preview blocks final submit with zero writes");
reportedOutput = 920;
freshReadEnabled = false;
await page.evaluate(() => {
  config.reportTotalSemanticsEnabled = false;
  const flow = machtileStationReportState(machtileBatchRow("A04"));
  flow.phase = "idle";
  flow.error = "";
  machtileRenderStationReportSurfaces();
});
await page.locator('#singleStationReportPanel [data-station-report-preview="A04"]').click();
await page.waitForFunction(() => document.querySelector('[data-station-report-confirm="A04"]'));

const confirm = page.locator('#singleStationReportPanel [data-station-report-confirm="A04"]');
await confirm.dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
assert.equal(await confirm.evaluate(button => button.classList.contains("is-holding")), true, "hold progress starts visibly");
await page.waitForTimeout(400);
await confirm.dispatchEvent("pointerup", { pointerType: "mouse", button: 0 });
await page.waitForTimeout(700);
assert.equal(calls.commands.filter(command => !command.p_preview).length, 0, "releasing before 0.8 seconds sends no report command");
assert.equal(await confirm.evaluate(button => button.classList.contains("is-holding")), false, "released hold clears its progress");
await confirm.dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
finalSubmitDelayMs = 300;
await page.waitForTimeout(900);
assert.equal(calls.commands.filter(command => !command.p_preview).length, 1, "0.8-second hold sends one final report command");
const finalCommand = calls.commands.find(command => !command.p_preview);
assert.equal(finalCommand.p_preview, false);
assert.equal(finalCommand.p_good_qty, 38);
assert.equal(finalCommand.p_fail_qty, 2);
assert.equal("p_previous_outsource_receipt_qty" in finalCommand, false, "flag off: final RPC body has no receipt keys");
assert.equal("p_expected_doc4_fingerprint" in finalCommand, false, "flag off: final RPC body has no fingerprint key");
assert.equal(calls.commands.some(command => "p_previous_outsource_receipt_qty" in command), false, "flag off: no RPC body carries receipt keys");
assert.equal(await page.locator("#reportSheet").getAttribute("aria-hidden"), "true", "confirmation closes the report sheet immediately");
assert.match(await page.locator("#toast").innerText(), /已送出，工廠寫入中|工廠已完成寫入/, "background submission gives immediate or completed feedback");
await page.evaluate(() => { selectedOrder = { id: "OTHER-WO", processId: "other-process", machine: "A01" }; });
await page.waitForFunction(() => document.querySelector("#stationReportBackgroundStatus")?.textContent.includes("工廠已完成寫入"));
assert.equal(calls.reports.length, 1, "applied command records production_reports exactly once");
assert.equal(calls.reports[0].process_id, processId, "switching machines during background submit still records the originally submitted order");
assert.equal(calls.reports[0].completed_qty, 38);
assert.equal(calls.reports[0].defect_qty, 2);
assert.equal(calls.reports[0].report_payload.fail_reason_code, "尺寸不良", "A04 production report payload preserves the smart-report fail reason");
const happyUuid = finalCommand.p_command_uuid;
await page.evaluate(() => machtileRecordSingleStationProductionReport("A04", machtileBatchRow("A04").stationReport.args));
assert.equal(calls.reports.length, 1, "same successful command_uuid does not duplicate production_reports");
assert.equal(calls.reports[0].report_uuid, happyUuid);
assert.equal(await page.locator("#stationReportBackgroundStatus").isVisible(), true, "successful background status remains visible before its five-second timeout");
await page.waitForFunction(() => document.querySelector("#stationReportBackgroundStatus")?.hidden, null, { timeout: 6000 });
finalSubmitDelayMs = 0;
await page.screenshot({ path: path.join(shots, "20261013-single-station-smart-report-800px.png"), fullPage: true });

await page.close();
currentMachine = "A01";
const outsider = await context.newPage();
await outsider.goto(base, { waitUntil: "domcontentloaded" });
await outsider.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await outsider.locator("[data-open-report]:visible").first().click();
await outsider.locator('#reportForm [data-report-type="noon"]').click();
assert.equal(await outsider.locator("#reportForm .submit-report").isVisible(), true, "non-allowlisted station keeps legacy submit");
assert.equal(await outsider.locator("#singleStationReportPanel").isHidden(), true);
await outsider.locator("#completedQty").fill("958");
await outsider.locator("#defectQty").fill("0");
assert.equal(await outsider.locator("#reportFailReasonField").isHidden(), true, "zero defects hides the general fail-reason field");
assert.equal(Boolean(await outsider.evaluate(() => validateReportForm("noon"))), false, "zero defects needs no reason");
await outsider.locator("#defectQty").fill("3");
const generalReasonState = await outsider.evaluate(() => ({ hidden: document.querySelector("#reportFailReasonField").hidden, active: machtileSingleStationReportActive(), machineCode: machtileSingleStationReportState.machineCode, defect: document.querySelector("#defectQty").value, type: activeReportType }));
assert.equal(await outsider.locator("#reportFailReasonField").isVisible(), true, `non-smart machine with defects shows the fail-reason field: ${JSON.stringify(generalReasonState)}`);
assert.equal(await outsider.evaluate(() => validateReportForm("noon")), "有不良數時，需選擇不良原因");
await outsider.locator("#reportFailReason").selectOption("其他");
assert.match(await outsider.evaluate(() => validateReportForm("noon")), /備註必須填寫一句說明/);
await outsider.locator("#reportNote").fill("刀具撞傷");
assert.equal(Boolean(await outsider.evaluate(() => validateReportForm("noon"))), false);
assert.equal(await outsider.evaluate(() => buildReportPayload("noon").fail_reason_code), "其他", "non-smart report stores reason in report_payload");
await outsider.setViewportSize({ width: 390, height: 844 });
await outsider.evaluate(() => { document.documentElement.scrollLeft = 0; document.body.scrollLeft = 0; const layout = document.querySelector("#reportSheet .report-layout"); layout.scrollLeft = 0; layout.scrollTop = 0; });
await outsider.locator("#reportFailReasonField").scrollIntoViewIfNeeded();
await outsider.screenshot({ path: "D:/04_SoftNet/ops/codex-inbox/20261015-app-finish-dialog-shots/defect-reason-mobile.png" });
await outsider.close();

currentMachine = "A04";
const finishValidation = await context.newPage();
await finishValidation.goto(base, { waitUntil: "domcontentloaded" });
await finishValidation.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await finishValidation.locator("[data-open-report]:visible").first().waitFor();
await finishValidation.waitForFunction(() => state.workOrders?.length && state.machines?.length);
await finishValidation.evaluate(() => {
  const machine = state.machines.find(item => String(item.code || item.name).toUpperCase() === "A04") || state.machines[0];
  machine.order = state.workOrders[0];
  state.assignedCardOrders = [state.workOrders[0]];
  document.querySelector("#workOrderGrid").innerHTML = renderMachineCard(machine);
});
assert.equal(await finishValidation.locator('[data-open-report-type="finish"]:visible').count(), 1, "enabled finish flag shows one machine-card finish button");
assert.equal(await finishValidation.locator('[data-open-report-type="finish"]:visible').innerText(), "完工");
await finishValidation.locator('.machine-report-button:visible').click();
assert.equal(await finishValidation.locator('.report-type-tab[data-report-type="noon"]').getAttribute("class").then(value => value.includes("active")), true, "machine-card report button opens directly on routine report");
await finishValidation.evaluate(() => closeReport());
await finishValidation.locator('[data-open-report-type="finish"]:visible').click();
await finishValidation.waitForTimeout(200);
const finishOpenState = await finishValidation.evaluate(() => ({ finishOpen: document.querySelector("#finishSheet")?.classList.contains("is-open"), reportOpen: document.querySelector("#reportSheet")?.classList.contains("is-open"), activeReportType, formHost: document.querySelector("#reportForm")?.parentElement?.id, toast: document.querySelector("#toast")?.textContent, dataset: { ...document.querySelector('.machine-finish-button')?.dataset }, orders: machtileMachineCardOrders().map(o => ({ id: o.id, machine: o.machine, processId: o.processId })) }));
assert.equal(finishOpenState.finishOpen, true, `finish card button opens independent finish screen: ${JSON.stringify(finishOpenState)}`);
assert.equal(finishOpenState.reportOpen, false, "finish screen does not open the routine report sheet");
assert.equal(finishOpenState.activeReportType, "finish");
assert.equal(finishOpenState.formHost, "finishFormHost", "finish reuses the canonical report form and submit orchestration");
assert.equal(await finishValidation.locator("#completedQtyLabel").innerText(), "這一道總完成數（良品）", "independent finish screen labels the production input as whole-operation good total");
assert.equal(await finishValidation.locator("#finishReportedQty").innerText(), "已報 920 件", "finish screen reuses card progress as reported quantity");
assert.equal(await finishValidation.locator('[data-report-section="finish"] .radio-card').isHidden(), true, "overtime choice is hidden");
assert.match(await finishValidation.locator("#shortCompletionSection").innerText(), /80/, "short-completion prompt shows the actual plan gap");
await finishValidation.locator("#completedQty").fill("1000");
assert.equal(await finishValidation.locator("#shortCompletionSection").isHidden(), true, "total completed quantity at plan hides short completion");
assert.equal(await finishValidation.evaluate(() => {
  const shortCompletion = machtileShortCompletionValue(selectedOrder);
  const payload = machtileStationCmdCore.submitPayload({ commandUuid: crypto.randomUUID(), commandType: "close", machineCode: "A04", orderNo: "XX01202604140011", step: 2, expectedSimulationId: "Y011BG35APT0", shortCompletion });
  return Object.hasOwn(payload, "p_short_completion");
}), false, "full completion payload omits p_short_completion");
await finishValidation.locator("#completedQty").fill("950");
assert.equal(await finishValidation.locator("#shortCompletionSection").isVisible(), true, "total below plan shows short completion");
assert.match(await finishValidation.locator("#shortCompletionSection").innerText(), /50/, "short-completion prompt uses the current total's plan gap");
await finishValidation.locator('input[name="shortCompletionReason"][value="MATERIAL_SHORT"]').check();
await finishValidation.evaluate(() => machtileRenderShortCompletion(selectedOrder));
assert.equal(await finishValidation.locator('input[name="shortCompletionReason"][value="MATERIAL_SHORT"]').isChecked(), true, "rerender preserves the selected short-completion reason");
assert.equal(await finishValidation.locator('input[name="finishOvertime"][value="none"]').isChecked(), true, "hidden overtime field defaults to none");
await finishValidation.evaluate(operatorId => {
  const list = document.createElement("div");
  list.id = "machtileOperatorList";
  list.innerHTML = `<input type="checkbox" value="${operatorId}" data-mapped="1" checked>`;
  document.body.append(list);
}, id(901));
await finishValidation.locator("#completedQty").fill("919");
await finishValidation.locator("#defectQty").fill("0");
await finishValidation.waitForFunction(() => document.querySelector('[data-station-report-preview="A04"]'));
await finishValidation.locator("#finishSheet .finish-panel").screenshot({ path: path.join(shots, "20261015-app-finish-dialog-desktop.png") });
await finishValidation.setViewportSize({ width: 390, height: 1200 });
await finishValidation.locator("#finishSheet .finish-panel").screenshot({ path: path.join(shots, "20261015-app-finish-dialog-mobile.png") });
await finishValidation.setViewportSize({ width: 800, height: 1100 });
assert.equal(await finishValidation.locator('#singleStationReportPanel [data-station-report-preview="A04"]').isEnabled(), true, "total below reported remains clickable so validation can explain why submission is blocked");
const zeroCommandsBefore = calls.commands.length;
await finishValidation.locator("#reportForm .submit-report").click();
assert.equal(calls.commands.length, zeroCommandsBefore, "total below reported is blocked before creating a command");
assert.match(await finishValidation.locator("#toast").innerText(), /總數不能小於已報的 920 件；報錯請用報工修正/, "below-reported block gives the approved correction guidance");
assert.match(await finishValidation.locator("#reportSubmitError").innerText(), /總數不能小於已報的 920 件/, "quantity validation remains visible above submit");
assert.equal(await finishValidation.evaluate(() => document.activeElement?.id), "completedQty", "quantity validation scroll target receives focus");
await finishValidation.locator("#completedQty").fill("958");
await finishValidation.locator("#defectQty").fill("0");
const finishCommandsBefore = calls.commands.length;
await finishValidation.locator('#singleStationReportPanel [data-station-report-preview="A04"]').click();
await finishValidation.waitForFunction(() => document.querySelector('[data-station-report-confirm="A04"]'));
assert.equal(calls.commands.length, finishCommandsBefore + 1, "finish preview no longer requires an overtime choice");
assert.equal(await finishValidation.evaluate(() => machtileBatchRow("A04").stationReport.singleReport.reportPayload.finish_scope), "all");
assert.equal(await finishValidation.evaluate(() => machtileBatchRow("A04").stationReport.singleReport.reportPayload.overtime_plan), "");
assert.doesNotMatch(await finishValidation.evaluate(() => buildReportRemark("finish", "")), /一般下班 17:00/);
const finishConfirm = finishValidation.locator('#singleStationReportPanel [data-station-report-confirm="A04"]');
await finishConfirm.dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
await finishValidation.waitForFunction(() => machtileBatchRow("A04").stationReport.close?.phase === "applied", null, { timeout: 10000 });
assert.equal(calls.closeCommands.length, 1, "finish applied submits exactly one close command");
assert.equal(calls.closeCommands[0].p_command_type, "close");
assert.equal(calls.closeCommands[0].p_expected_order_no, "XX01202604140011");
assert.equal(calls.closeCommands[0].p_expected_index_sn, 2);
assert.equal(calls.closeCommands[0].p_expected_simulation_id, "Y011BG35APT0");
assert.deepEqual(calls.closeCommands[0].p_short_completion, { reason_code: "MATERIAL_SHORT", note: "" }, "APP fixture uses the cloud RPC parameter and Factory JSON field names");
assert.equal(await finishValidation.locator("#finishSheet").getAttribute("aria-hidden"), "true", "finish confirmation closes immediately while factory work continues");
assert.match(await finishValidation.locator("#stationReportBackgroundStatus").innerText(), /工廠已完成寫入/, "successful background finish shows a temporary completion status");
assert.equal(await finishValidation.evaluate(() => {
  const flow = machtileStationReportState(machtileBatchRow("A04"));
  flow.singleReport.shortCompletion = null;
  machtileFinishCloseSetResult("A04", { phase: "applied", warning: "Factory 原始警告" });
  return flow.close.message;
}), "Factory 原始警告", "non-short completion preserves Factory's original warning");
await finishValidation.close();

finishButtonEnabled = false;
const finishFlagOff = await context.newPage();
await finishFlagOff.goto(base, { waitUntil: "domcontentloaded" });
await finishFlagOff.waitForFunction(() => state.workOrders?.length && state.machines?.length);
await finishFlagOff.evaluate(() => {
  const machine = state.machines.find(item => String(item.code || item.name).toUpperCase() === "A04") || state.machines[0];
  machine.order = state.workOrders[0];
  state.assignedCardOrders = [state.workOrders[0]];
  document.querySelector("#workOrderGrid").innerHTML = renderMachineCard(machine);
});
assert.equal(await finishFlagOff.locator('.machine-finish-button').count(), 0, "disabled finish flag removes machine-card finish button");
await finishFlagOff.close();
finishButtonEnabled = true;

// d35 整合：#130 選工單／開工開關開＋雲端工序 paused（停工卡）→ 按「完工」走原本完工畫面，
// 實做<計畫時出 #131 短交對話框，送出的 close 指令帶 p_short_completion（沿用既有送出流程，不另寫）。
currentMachine = "A04"; pickStartEnabled = true; assignedPausedA04 = true; finishButtonEnabled = true;
const pausedFinish = await context.newPage();
await pausedFinish.goto(base, { waitUntil: "domcontentloaded" });
await pausedFinish.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await pausedFinish.waitForFunction(() => machtileCardOrderForMachine("A04")?.processStatus === "paused");
assert.ok(assignedQueries.at(-1).includes("status=in.(pending,running,abnormal,waiting_inspection,paused)"), "pick/start flag on → assigned-card query includes paused");
await pausedFinish.waitForFunction(() => machtileDeferredLoadsSettled === true, null, { timeout: 15000 });
// dev-nologin fixture has no session role; act as an operator (like stationCommand fixture) and reload through the normal loader.
await pausedFinish.evaluate(async () => { machtileAuthState.role = "operator"; await loadFromSupabase({ preserveDepartmentOnFailure: true }); deriveMachines(); renderAll(); });
assert.equal(await pausedFinish.evaluate(() => machtileStationCmd.availability), "ready", "operator session enables station commands");
assert.equal(await pausedFinish.evaluate(() => machtilePickStartPhase(state.machines.find(m => machtileStationCmdMachineCode(m) === "A04"), machtileCardOrderForMachine("A04"))), "stopped", "cloud paused → pick/start phase stopped");
const pausedCard = pausedFinish.locator("#workOrderGrid .machine-tile-card").filter({ has: pausedFinish.locator('.machine-finish-button[data-report-machine="A04"]') });
await pausedCard.first().waitFor();
assert.equal(await pausedCard.locator(".machine-report-button").count(), 0, "paused card hides routine report");
assert.equal(await pausedCard.locator('[data-station-cmd="start"]').count(), 1, "paused card shows 開工 (resume)");
const pausedFinishButton = pausedCard.locator('.machine-finish-button[data-open-report-type="finish"]');
assert.equal(await pausedFinishButton.count(), 1, "paused card keeps exactly one finish button");
assert.equal(await pausedFinishButton.isDisabled(), false, "paused card finish button is enabled");
const pausedCloseBefore = calls.closeCommands.length;
await pausedFinishButton.click();
await pausedFinish.waitForFunction(() => document.querySelector("#finishSheet")?.classList.contains("is-open"));
assert.equal(await pausedFinish.evaluate(() => ({ type: activeReportType, host: document.querySelector("#reportForm")?.parentElement?.id, report: document.querySelector("#reportSheet")?.classList.contains("is-open") })).then(v => JSON.stringify(v)),
  JSON.stringify({ type: "finish", host: "finishFormHost", report: false }), "paused finish opens the original finish screen (canonical form, not routine report)");
assert.equal(await pausedFinish.locator("#finishReportedQty").innerText(), "已報 920 件", "paused finish reuses reported quantity");
assert.equal(calls.closeCommands.length, pausedCloseBefore, "opening finish sends no command");
await pausedFinish.locator("#completedQty").fill("950");
await pausedFinish.locator("#defectQty").fill("0");
assert.equal(await pausedFinish.locator("#shortCompletionSection").isVisible(), true, "paused finish below plan shows the #131 short-completion dialog");
assert.match(await pausedFinish.locator("#shortCompletionSection").innerText(), /50/, "paused short-completion prompt shows the plan gap");
await pausedFinish.locator('input[name="shortCompletionReason"][value="MATERIAL_SHORT"]').check();
await pausedFinish.evaluate(operatorId => {
  const list = document.createElement("div");
  list.id = "machtileOperatorList";
  list.innerHTML = `<input type="checkbox" value="${operatorId}" data-mapped="1" checked>`;
  document.body.append(list);
}, id(901));
await pausedFinish.locator('#singleStationReportPanel [data-station-report-preview="A04"]').click();
await pausedFinish.waitForFunction(() => document.querySelector('[data-station-report-confirm="A04"]'));
await pausedFinish.locator('#singleStationReportPanel [data-station-report-confirm="A04"]').dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
await pausedFinish.waitForFunction(() => machtileBatchRow("A04").stationReport.close?.phase === "applied", null, { timeout: 10000 });
assert.equal(calls.closeCommands.length, pausedCloseBefore + 1, "paused finish submits exactly one close command");
const pausedClose = calls.closeCommands.at(-1);
assert.equal(pausedClose.p_command_type, "close");
assert.equal(pausedClose.p_machine_code, "A04");
assert.equal(pausedClose.p_expected_order_no, "XX01202604140011");
assert.equal(pausedClose.p_expected_index_sn, 2);
assert.equal(pausedClose.p_expected_simulation_id, "Y011BG35APT0");
assert.deepEqual(pausedClose.p_short_completion, { reason_code: "MATERIAL_SHORT", note: "" }, "paused-card finish sends p_short_completion through the existing close submit");
await pausedFinish.close();
pickStartEnabled = false; assignedPausedA04 = false;
console.log("PASS paused-card finish → short completion → p_short_completion");

currentMachine = "A04"; guardEnabled = false;
const disabledGuard = await context.newPage();
await disabledGuard.goto(base, { waitUntil: "domcontentloaded" });
await disabledGuard.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await disabledGuard.locator("[data-open-report]:visible").first().click();
await disabledGuard.locator('#reportForm [data-report-type="noon"]').click();
await disabledGuard.waitForFunction(() => !document.querySelector("#reportForm .submit-report").hidden);
assert.equal(await disabledGuard.locator("#reportForm .submit-report").isVisible(), true, "loaded runtime kill switch restores legacy submit");
await disabledGuard.close();

guardEnabled = true; finalSubmitFails = true; reconciledCommand = null;
const reconcile = await context.newPage();
await reconcile.goto(base, { waitUntil: "domcontentloaded" });
await reconcile.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await reconcile.evaluate(() => { machtileAuthState.role = "admin"; });
await reconcile.locator("[data-open-report]:visible").first().click();
await reconcile.locator('#reportForm [data-report-type="noon"]').click();
await reconcile.locator("#completedQty").fill("958");
await reconcile.waitForFunction(() => document.querySelector("[data-simple-report-defect]"));
await reconcile.locator("[data-simple-report-defect]").check();
await reconcile.locator("#defectQty").fill("2");
await reconcile.waitForFunction(() => document.querySelector('[data-station-report-preview="A04"]'));
await reconcile.locator("[data-station-report-tech] > summary").click();
await reconcile.locator('[data-station-report-reason="A04"]').selectOption("尺寸不良");
await reconcile.locator('[data-station-report-preview="A04"]').click();
await reconcile.waitForFunction(() => document.querySelector('[data-station-report-confirm="A04"]'));
const reconcileConfirm = reconcile.locator('#singleStationReportPanel [data-station-report-confirm="A04"]');
await reconcileConfirm.dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
await reconcile.waitForFunction(() => document.querySelector('#stationReportBackgroundStatus.is-error:not([hidden])'), null, { timeout: 5000 });
assert.match(await reconcile.locator("#stationReportBackgroundStatus").innerText(), /套用結果尚未確認|response lost|請勿重送/, "background failure remains as a visible red persistent warning");
assert.equal(await reconcile.locator("[data-station-report-background-dismiss]").innerText(), "知道了", "background failure offers an explicit dismiss action");
await reconcile.locator("[data-station-report-background-dismiss]").click();
assert.equal(await reconcile.locator("#stationReportBackgroundStatus").isHidden(), true, "知道了 closes the persistent red warning");
const reconcileReportsBefore = calls.reports.length;
const reconcileCommandsBefore = calls.commands.length;
await reconcile.evaluate(() => machtileStationReportReconcile("A04"));
await reconcile.waitForFunction(() => machtileBatchRow("A04").stationProductionReportUuid === machtileBatchRow("A04").stationReport.args.p_command_uuid);
assert.equal(calls.commands.length, reconcileCommandsBefore, "reconcile reads by UUID without resending command");
assert.equal(calls.reports.length, reconcileReportsBefore + 1, "reconcile applied records production_reports once");
const reconcileUuid = reconciledCommand.command_uuid;
assert.equal(calls.reports.at(-1).report_uuid, reconcileUuid);
await reconcile.evaluate(() => machtileStationReportReconcile("A04"));
assert.equal(calls.reports.length, reconcileReportsBefore + 1, "repeated reconcile with same command_uuid stays idempotent");
await reconcile.close();
finalSubmitFails = false;

// Flag OFF + Factory asks for a receipt (real previewed/allowed:false shape): no dialog, behaviour unchanged.
outsourceReceiptEnabled = false; outsourceReceiptRequired = true; reconciledCommand = null;
async function openReceiptPage() {
  const receiptPage = await context.newPage();
  receiptPage.on("pageerror", error => errors.push(error.message));
  await receiptPage.goto(base, { waitUntil: "domcontentloaded" });
  await receiptPage.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
  await receiptPage.evaluate(() => { machtileAuthState.role = "admin"; });
  await receiptPage.locator("[data-open-report]:visible").first().click();
  await receiptPage.locator('#reportForm [data-report-type="noon"]').click();
  await receiptPage.locator("#completedQty").fill("958");
  // 有不良品 is unchecked in the simple view, so the defect field stays 0 and hidden.
  await receiptPage.evaluate(operatorId => {
    const list = document.createElement("div"); list.id = "machtileOperatorList";
    list.innerHTML = `<input type="checkbox" value="${operatorId}" data-mapped="1" checked>`; document.body.append(list);
  }, id(901));
  await receiptPage.waitForFunction(() => document.querySelector('[data-station-report-preview="A04"]'));
  await receiptPage.locator("[data-station-report-tech] > summary").click();
  return receiptPage;
}
const holdConfirm = async (receiptPage) => {
  await receiptPage.locator('#singleStationReportPanel [data-station-report-confirm="A04"]').dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
};
const flagOff = await openReceiptPage();
const flagOffBefore = calls.commands.length;
await flagOff.locator('[data-station-report-preview="A04"]').click();
await flagOff.waitForFunction(() => document.querySelector("#singleStationReportPanel")?.textContent.includes("預覽遭 guard 阻擋"));
await flagOff.waitForTimeout(300);
assert.equal(await flagOff.locator("#machtileOutsourceReceiptDialog").count(), 0, "flag off: real receipt preview never opens the dialog");
assert.equal(calls.commands.length, flagOffBefore + 1, "flag off: exactly one preview, nothing re-sent");
assert.equal("p_previous_outsource_receipt_qty" in calls.commands[flagOffBefore], false, "flag off: preview RPC body has no receipt keys");
assert.equal(await flagOff.locator('[data-station-report-confirm="A04"]').count(), 0, "flag off: blocked preview offers no confirm");
await flagOff.close();

// Flag ON, real preview shape → material dialog → preview with receipt → final carries qty+fingerprint once.
outsourceReceiptEnabled = true; outsourceReceiptRequired = true; receiptFingerprint = "a".repeat(64); reconciledCommand = null;
const receiptDialog = await openReceiptPage();
const receiptCallsBefore = calls.commands.length;
const receiptReportsBefore = calls.reports.length;
await receiptDialog.locator('[data-station-report-preview="A04"]').click();
await receiptDialog.waitForSelector("#machtileOutsourceReceiptDialog", { timeout: 5000 }).catch(() => null);
assert.equal(await receiptDialog.locator("#machtileOutsourceReceiptDialog").count(), 1,
  `receipt dialog missing; calls=${JSON.stringify(calls.commands.slice(receiptCallsBefore))}; errors=${JSON.stringify(errors)}; panel=${await receiptDialog.locator("#singleStationReportPanel").innerText()}`);
assert.equal(calls.commands[receiptCallsBefore].p_previous_outsource_receipt_qty, null, "first preview sends receipt qty NULL");
assert.equal(calls.commands[receiptCallsBefore].p_expected_doc4_fingerprint, null, "first preview sends fingerprint NULL");
assert.match(await receiptDialog.locator("#outsourceReceiptTitle").innerText(), /上一道『素材外包（路線甲廠）』的素材收到了嗎？/);
assert.equal(await receiptDialog.locator("[data-outsource-receipt-qty]").count(), 0, "material confirmation has no quantity input");
assert.match(await receiptDialog.locator(".outsource-receipt-doc4").innerText(), /D4-20261031-01/, "doc4 numbers come from previous_outsource_doc4_numbers");
await receiptDialog.locator("[data-outsource-receipt-confirm]").click();
await receiptDialog.waitForFunction(() => document.querySelector('[data-station-report-confirm="A04"]'));
assert.equal(calls.commands[receiptCallsBefore + 1].p_preview, true);
assert.equal(calls.commands[receiptCallsBefore + 1].p_previous_outsource_receipt_qty, 12, "material confirmation submits required qty exactly");
assert.equal(calls.commands[receiptCallsBefore + 1].p_expected_doc4_fingerprint, "a".repeat(64), "fingerprint is returned verbatim");
assert.notEqual(calls.commands[receiptCallsBefore + 1].p_command_uuid, calls.commands[receiptCallsBefore].p_command_uuid);
await holdConfirm(receiptDialog);
await receiptDialog.waitForFunction(() => document.querySelector("#stationReportBackgroundStatus")?.textContent.includes("工廠已完成寫入"), null, { timeout: 5000 });
const receiptFinals = calls.commands.slice(receiptCallsBefore).filter(command => !command.p_preview);
assert.equal(receiptFinals.length, 1, "exactly one final command");
assert.equal(receiptFinals[0].p_previous_outsource_receipt_qty, 12, "final carries the confirmed receipt qty");
assert.equal(receiptFinals[0].p_expected_doc4_fingerprint, "a".repeat(64), "final carries the confirmed fingerprint");
assert.equal(await receiptDialog.locator("#machtileOutsourceReceiptDialog").count(), 0, "operator is not asked a second time");
assert.equal(calls.reports.length, receiptReportsBefore + 1, "applied final records production_reports once");
assert.equal(calls.reports.at(-1).report_uuid, receiptFinals[0].p_command_uuid);
await receiptDialog.close();

// Final rejected STALE → fresh preview (receipt NULL) → dialog again → preview with new fingerprint →
// final re-sent with a NEW uuid; App production_reports uses the applied command uuid.
outsourceReceiptRequired = true; receiptFingerprint = "a".repeat(64); finalStaleOnce = true;
const stale = await openReceiptPage();
const staleBefore = calls.commands.length;
const staleReportsBefore = calls.reports.length;
await stale.locator('[data-station-report-preview="A04"]').click();
await stale.waitForSelector("#machtileOutsourceReceiptDialog", { timeout: 5000 });
await stale.locator("[data-outsource-receipt-confirm]").click();
await stale.waitForFunction(() => document.querySelector('[data-station-report-confirm="A04"]'));
await holdConfirm(stale);
await stale.waitForSelector("#machtileOutsourceReceiptDialog", { timeout: 5000 });
const staleSent = calls.commands.slice(staleBefore);
assert.equal(staleSent.length, 4, `preview, receipt preview, stale final, fresh preview: ${JSON.stringify(staleSent.map(c => [c.p_preview, c.p_previous_outsource_receipt_qty]))}`);
assert.equal(staleSent[2].p_preview, false);
assert.equal(staleSent[3].p_preview, true, "STALE final re-runs a fresh PREVIEW");
assert.equal(staleSent[3].p_previous_outsource_receipt_qty, null, "fresh preview sends receipt NULL");
assert.equal(staleSent[3].p_expected_doc4_fingerprint, null);
assert.equal(staleSent[3].p_client_guard_snapshot, null, "fresh preview has no stale client snapshot");
assert.equal(await stale.locator("#machtileOutsourceReceiptDialog").count(), 1, "dialog shown again after STALE");
await stale.locator("[data-outsource-receipt-confirm]").click();
await stale.waitForFunction(() => document.querySelector("#stationReportBackgroundStatus")?.textContent.includes("工廠已完成寫入"), null, { timeout: 5000 });
const staleAll = calls.commands.slice(staleBefore);
assert.equal(staleAll.length, 6, "then receipt preview + final re-send");
assert.equal(staleAll[4].p_preview, true);
assert.equal(staleAll[4].p_expected_doc4_fingerprint, "e".repeat(64), "re-confirmed against the new fingerprint");
assert.equal(staleAll[5].p_preview, false);
assert.equal(staleAll[5].p_previous_outsource_receipt_qty, 12);
assert.equal(staleAll[5].p_expected_doc4_fingerprint, "e".repeat(64));
assert.notEqual(staleAll[5].p_command_uuid, staleAll[2].p_command_uuid, "re-sent final uses a new uuid");
assert.equal(staleAll[5].p_client_guard_snapshot.preview_command_uuid, staleAll[4].p_command_uuid, "re-sent final binds the fresh preview");
assert.equal(calls.reports.length, staleReportsBefore + 1, "only the applied final is recorded");
assert.equal(calls.reports.at(-1).report_uuid, staleAll[5].p_command_uuid, "recorded report uuid = applied command uuid");
assert.equal(calls.reports.at(-1).report_payload.station_command_uuid, staleAll[5].p_command_uuid);
assert.equal(await stale.evaluate(() => machtileBatchRow("A04").stationReport.args.p_command_uuid), staleAll[5].p_command_uuid);
await stale.close();

// Final rejected REQUIRED (real failure_detail shape) → count dialog → final re-submit; record uses the new uuid.
outsourceReceiptRequired = false; finalRequiredOnce = true;
const finalAsk = await openReceiptPage();
const finalAskBefore = calls.commands.length;
const finalAskReportsBefore = calls.reports.length;
await finalAsk.locator('[data-station-report-preview="A04"]').click();
await finalAsk.waitForFunction(() => document.querySelector('[data-station-report-confirm="A04"]'));
assert.equal(await finalAsk.locator("#machtileOutsourceReceiptDialog").count(), 0);
await holdConfirm(finalAsk);
await finalAsk.waitForSelector("#machtileOutsourceReceiptDialog", { timeout: 5000 });
assert.match(await finalAsk.locator("#outsourceReceiptTitle").innerText(), /上一道『研磨（丙廠）』委外回來幾件？/);
await finalAsk.locator("[data-outsource-receipt-qty]").fill("5");
await finalAsk.locator("[data-outsource-receipt-confirm]").click();
await finalAsk.waitForFunction(() => document.querySelector("#stationReportBackgroundStatus")?.textContent.includes("工廠已完成寫入"), null, { timeout: 5000 });
const finalAskSent = calls.commands.slice(finalAskBefore).filter(command => !command.p_preview);
assert.equal(finalAskSent.length, 2);
assert.equal(finalAskSent[1].p_previous_outsource_receipt_qty, 5);
assert.equal(finalAskSent[1].p_expected_doc4_fingerprint, "f".repeat(64));
assert.equal(calls.reports.length, finalAskReportsBefore + 1);
assert.equal(calls.reports.at(-1).report_uuid, finalAskSent[1].p_command_uuid, "recorded report uuid = applied (re-submitted) command uuid");
assert.notEqual(calls.reports.at(-1).report_uuid, finalAskSent[0].p_command_uuid);
await finalAsk.close();

// F6: replacing an open dialog settles the earlier promise instead of leaving it pending.
const superseded = await context.newPage();
await superseded.goto(base, { waitUntil: "domcontentloaded" });
await superseded.waitForFunction(() => typeof machtileAskOutsourceReceipt === "function");
const supersededResult = await superseded.evaluate(async () => {
  const snapshot = { receiptMode: "count", receiptRequiredQty: 3, unconfirmedQty: 3, previousStepName: "", doc4Numbers: [], expectedDoc4Fingerprint: "c".repeat(64), receiptSteps: [] };
  const first = machtileAskOutsourceReceipt(snapshot);
  const second = machtileAskOutsourceReceipt(snapshot);
  const firstValue = await Promise.race([first, new Promise(resolve => setTimeout(() => resolve("pending"), 500))]);
  const count = document.querySelectorAll("#machtileOutsourceReceiptDialog").length;
  document.querySelector("[data-outsource-receipt-cancel]").click();
  return { first: firstValue, second: await second, count };
});
assert.deepEqual(supersededResult, { first: { superseded: true }, second: null, count: 1 });
await superseded.close();
outsourceReceiptEnabled = false; finalStaleOnce = false; finalRequiredOnce = false;
const countDialog = await context.newPage();
await countDialog.goto(base, { waitUntil: "domcontentloaded" });
await countDialog.evaluate(() => { void machtileAskOutsourceReceipt({ receiptMode: "count", receiptRequiredQty: 6, unconfirmedQty: 6,
  previousStepName: "", doc4Numbers: [], expectedDoc4Fingerprint: "b".repeat(64), receiptSteps: [
    { indexSn: 1, processName: "熱處理", vendorName: "乙廠", unconfirmedQty: 6 },
    { indexSn: 2, processName: "研磨", vendorName: "丙廠", unconfirmedQty: 6 },
  ] }); });
assert.match(await countDialog.locator("#outsourceReceiptTitle").innerText(), /上一道『研磨（丙廠）』委外回來幾件？/);
assert.equal(await countDialog.locator("[data-outsource-receipt-qty]").inputValue(), "6");
assert.match(await countDialog.locator(".outsource-receipt-note").innerText(), /連續 2 道委外，每一道都會收這個數量/);
await countDialog.locator("[data-outsource-receipt-cancel]").click();
await countDialog.close();
console.log("PASS material/count outsource receipt dialogs → preview success");


// ---- 單台報工簡化（owner 2026-10-31「單台報工簡化 照圖做」）：作業員畫面 ----
const implShots = "D:/04_SoftNet/ops/owner-pack/20261031-single-report-mock/impl-final";
await mkdir(implShots, { recursive: true });
currentMachine = "A04"; guardFails = false; guardEnabled = true; outsourceReceiptEnabled = false; outsourceReceiptRequired = false;
finalStaleOnce = false; finalRequiredOnce = false; finalSubmitFails = false; reconciledCommand = null; starterUserId = id(902);
async function openOperatorPage() {
  const op = await context.newPage();
  op.on("pageerror", error => errors.push(error.message));
  await op.setViewportSize({ width: 800, height: 1200 });
  await op.goto(base, { waitUntil: "domcontentloaded" });
  await op.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
  await op.evaluate(() => { machtileAuthState.role = "operator"; });
  await op.locator("[data-open-report]:visible").first().click();
  await op.locator('#reportForm [data-report-type="noon"]').click();
  await op.waitForFunction(() => document.querySelector("#reportForm.is-simple-report") && machtileSingleStationReportState.starterLoaded);
  // Strict-mode 操作人員 section stand-in (dev-nologin never renders it): two mapped people, none pre-checked.
  await op.evaluate(([a, b]) => {
    const section = document.createElement("section");
    section.id = "machtileOperatorSection";
    section.className = "report-section";
    section.innerHTML = `<div class="report-section-head"><strong>操作人員</strong></div><div class="checklist-card" id="machtileOperatorList"><label><input type="checkbox" value="${a}" data-mapped="1"> 試點員</label><label><input type="checkbox" value="${b}" data-mapped="1"> 陳柏叡</label></div>`;
    const form = document.getElementById("reportForm");
    form.insertBefore(section, form.querySelector('label[for="reportNote"]'));
    machtileApplySimpleReportChrome();
  }, [id(901), id(902)]);
  await op.locator("#completedQty").fill("958");
  return op;
}
const sheetShot = async (op, name) => {
  await op.evaluate(() => { const layout = document.querySelector("#reportSheet .report-layout"); if (layout) layout.scrollTop = 0; });
  await op.locator("#reportSheet .report-panel").screenshot({ path: path.join(implShots, name) });
};

// ① 一般報工：沒有智慧報工字樣、一行摘要、大總數、良品提示、報工人＝開工的人、一顆送出鈕
const op = await openOperatorPage();
const formText = await op.locator("#reportForm").innerText();
assert.doesNotMatch(formText, /智慧報工|套用端預覽|送出前會先由套用端|guard|先預覽，不寫入|查詢報工狀態|技術細節/, `operator view has no technical wording: ${formText}`);
assert.match(await op.locator("[data-simple-report-summary]").innerText(), /^這次報：車床（第 \d+ 道）・已報 920$|^這次報：車床・已報 920$/, "one summary line: process, step, reported");
assert.equal(await op.locator("[data-simple-report-flow-strip]").count(), 0, "process flow strip is collapsed by default");
await op.locator("[data-simple-report-flow]").click();
assert.equal(await op.locator("[data-simple-report-flow-strip]").isVisible(), true, "▸流程 expands the existing process-flow strip");
await op.locator("[data-simple-report-flow]").click();
assert.equal(await op.locator("[data-simple-report-flow-strip]").count(), 0, "▾流程 collapses it again");
assert.equal(await op.locator("#completedQtyLabel").innerText(), "機台目前總數（這張單）");
assert.equal(await op.locator("#simpleReportHint").innerText(), "這次良品 38 件、不良 0 件", "live hint comes from the existing counter calculation");
assert.equal(await op.locator("#defectQty").isVisible(), false, "defect quantity stays behind 有不良品");
assert.equal(await op.locator("#reportNote").isVisible(), false, "general note is hidden for operators");
assert.equal(await op.locator("#reportCounterPreview").isVisible(), false, "technical counter line is hidden for operators");
assert.deepEqual(await op.evaluate(() => [...document.querySelectorAll('#machtileOperatorList input:checked')].map(i => i.value)), [id(902)], "報工人 defaults to today's starter");
assert.equal(await op.locator("#simpleReportOperator").innerText().then(t => t.replace(/\s+/g, "")), "報工人：陳柏叡（開工的人）換人");
assert.equal(await op.locator("#machtileOperatorSection").isVisible(), false, "operator checklist hides behind 換人");
await op.locator("[data-simple-report-change-operator]").click();
assert.equal(await op.locator("#machtileOperatorSection").isVisible(), true, "換人 reveals the existing operator checklist");
await op.locator("[data-simple-report-change-operator]").click();
assert.equal(await op.locator("#machtileOperatorSection").isVisible(), false);
assert.equal(await op.locator('#reportSheet [data-station-report-preview]').count(), 0, "operators never see 先預覽");
assert.equal(await op.locator('#reportSheet [data-station-report-reconcile]').count(), 0, "operators never see 查詢報工狀態");
assert.equal(await op.locator("[data-station-report-tech]").count(), 0, "operators have no 技術細節");
assert.equal(await op.locator("#reportForm button.submit-report:visible").count(), 1);
assert.equal(await op.locator("#reportForm .submit-report").innerText(), "送出報工", "one primary button 送出報工");
await sheetShot(op, "01-operator-normal.png");

// ② 有不良品：標籤含不良、不良幾件＋原因、提示同步
await op.locator("[data-simple-report-defect]").check();
assert.equal(await op.locator("#completedQtyLabel").innerText(), "機台目前總數（這張單，含不良）");
assert.equal(await op.locator("#defectQty").isVisible(), true);
assert.equal(await op.locator("#defectQtyLabelText").innerText(), "這次不良幾件");
await op.locator("#defectQty").fill("1");
await op.locator('#simpleReportReason [data-station-report-reason="A04"]').selectOption("尺寸不良");
assert.match(await op.locator("#simpleReportHint").innerText(), /^這次良品 \d+ 件、不良 1 件$/, "hint shows this time's good / defect from the calculation");
assert.equal(await op.locator(".station-report-reason:visible").count(), 1, "exactly one reason field");
await op.locator('#simpleReportReason [data-station-report-reason="A04"]').selectOption("其他");
assert.equal(await op.locator('#simpleReportReason [data-station-report-note="A04"]').isVisible(), true, "其他 asks for a one-line note");
await op.locator('#simpleReportReason [data-station-report-reason="A04"]').selectOption("尺寸不良");
await op.locator("[data-simple-report-defect]").uncheck();
assert.equal(await op.locator("#defectQty").inputValue(), "0", "unchecking 有不良品 clears the defect quantity");
assert.equal(await op.evaluate(() => machtileBatchRow("A04").failReasonCode), "", "and its reason");
assert.equal(await op.locator("#simpleReportHint").innerText(), "這次良品 38 件、不良 0 件");

// Production runs reportTotalSemanticsEnabled=true: the hint reads the same totalSemantics result.
freshReadEnabled = true;
await op.evaluate(async () => { config.reportTotalSemanticsEnabled = true; await machtileRefreshReportTotalState(selectedOrder); });
await op.locator("#completedQty").fill("900");
assert.equal(await op.locator("#simpleReportHint.is-error").count(), 1, "total below reported turns the hint into one plain warning");
assert.equal(await op.locator("#simpleReportHint").innerText(), "機台數字比系統少，請確認是這張單的數字", "plain sentence from the existing calculation");
await op.locator("#completedQty").fill("958");
assert.equal(await op.locator("#simpleReportHint").innerText(), "這次良品 38 件、不良 0 件", "total semantics: 958 − 已報 920 = 38");
await op.evaluate(() => { config.reportTotalSemanticsEnabled = false; });
freshReadEnabled = false;
// One button: preview → final in one press, payload unchanged.
const oneBefore = calls.commands.length;
const oneReportsBefore = calls.reports.length;
await op.locator("#reportForm .submit-report").click();
await op.waitForFunction(() => document.querySelector("#stationReportBackgroundStatus")?.textContent.includes("工廠已完成寫入"), null, { timeout: 8000 });
const oneSent = calls.commands.slice(oneBefore);
assert.deepEqual(oneSent.map(c => c.p_preview), [true, false], "one press = existing preview then final");
assert.equal(oneSent[1].p_good_qty, 38); assert.equal(oneSent[1].p_fail_qty, 0);
assert.equal(oneSent[1].p_client_guard_snapshot.preview_command_uuid, oneSent[0].p_command_uuid, "final binds the preview just made");
assert.equal(calls.reports.length, oneReportsBefore + 1, "applied final records production_reports once");
assert.deepEqual(await op.evaluate(() => machtileBatchRow("A04").stationReport.singleReport.operators), [id(902)], "report credited to the starter");
assert.equal(await op.locator("#reportSheet").getAttribute("aria-hidden"), "true", "sheet closes while the factory writes");
await op.close();

// ③ 代收貨對話框（真實 previewed 形狀）→ 取消 → 灰字＋重新送出 → 再送 → 收到了 → 正式送出帶收貨量
outsourceReceiptEnabled = true; outsourceReceiptRequired = true; receiptFingerprint = "a".repeat(64);
const rc = await openOperatorPage();
const rcBefore = calls.commands.length;
await rc.locator("#reportForm .submit-report").click();
await rc.waitForSelector("#machtileOutsourceReceiptDialog", { timeout: 5000 });
assert.match(await rc.locator("#outsourceReceiptTitle").innerText(), /上一道『素材外包（路線甲廠）』的素材收到了嗎？/);
await rc.screenshot({ path: path.join(implShots, "03-operator-receipt-dialog.png") });
await rc.locator("[data-outsource-receipt-cancel]").click();
await rc.waitForFunction(() => document.querySelector('[data-simple-report-status="muted"]'));
assert.equal(await rc.locator('[data-simple-report-status="muted"]').innerText(), "已取消，沒有收貨也沒有報工。");
assert.equal(await rc.locator("#reportForm .submit-report").innerText(), "重新送出");
assert.equal(await rc.locator('.station-report-simple-status.is-error:visible, #reportSubmitError:visible, #singleStationReportPanel .batch-notice.is-error:visible').count(), 0, "cancel shows no red box");
assert.deepEqual(calls.commands.slice(rcBefore).map(c => c.p_preview), [true], "cancel: only the first preview, nothing written");
await sheetShot(rc, "04-operator-cancelled.png");
outsourceReceiptRequired = true;
await rc.locator("#reportForm .submit-report").click();
await rc.waitForSelector("#machtileOutsourceReceiptDialog", { timeout: 5000 });
await rc.locator("[data-outsource-receipt-confirm]").click();
await rc.waitForFunction(() => document.querySelector("#stationReportBackgroundStatus")?.textContent.includes("工廠已完成寫入"), null, { timeout: 8000 });
const rcSent = calls.commands.slice(rcBefore);
assert.deepEqual(rcSent.map(c => [c.p_preview, c.p_previous_outsource_receipt_qty]), [[true, null], [true, null], [true, 12], [false, 12]], "re-send: preview → dialog → receipt preview → final with receipt");
assert.equal(rcSent[3].p_expected_doc4_fingerprint, "a".repeat(64));
assert.equal(await rc.locator("#machtileOutsourceReceiptDialog").count(), 0, "dialog asked only once per press");
await rc.close();
outsourceReceiptEnabled = false; outsourceReceiptRequired = false;

// ② 有不良品（正式環境總數語意）：機台 761、已報 750、這次不良 1 → 良品 10、不良 1；一顆鈕送出照新公式。
// F1：按下後預覽前重讀已報不良變 5 → 一顆鈕流程送出的是重算後的良品 5，不是畫面上的舊 10。
reportedOutput = 750; reportedFail = 0; freshReadEnabled = true; noStartCounter = true;
const dt = await openOperatorPage();
await dt.evaluate(async () => { config.reportTotalSemanticsEnabled = true; await machtileRefreshReportTotalState(selectedOrder); });
await dt.waitForFunction(() => reportTotalState.status === "ready" && reportTotalState.reported === 750 && reportTotalState.failReported === 0);
await dt.locator("#completedQty").fill("761");
await dt.locator("[data-simple-report-defect]").check();
await dt.locator("#defectQty").fill("1");
await dt.locator('#simpleReportReason [data-station-report-reason="A04"]').selectOption("尺寸不良");
assert.equal(await dt.locator("#completedQtyLabel").innerText(), "機台目前總數（這張單，含不良）");
assert.equal(await dt.locator("#simpleReportHint").innerText(), "這次良品 10 件、不良 1 件", "761 − 750 − 1 = 10 good");
assert.match(await dt.locator("[data-simple-report-summary]").innerText(), /已報 750$/, "defect 0 → 已報 750 (no 含不良 part)");
await sheetShot(dt, "02-operator-defect.png");
const dtBefore = calls.commands.length;
await dt.locator("#reportForm .submit-report").click();
await dt.waitForFunction(() => document.querySelector("#stationReportBackgroundStatus")?.textContent.includes("工廠已完成寫入"), null, { timeout: 8000 });
const dtSent = calls.commands.slice(dtBefore);
assert.deepEqual(dtSent.map(c => [c.p_preview, c.p_good_qty, c.p_fail_qty, c.p_fail_reason_code]), [[true, 10, 1, "尺寸不良"], [false, 10, 1, "尺寸不良"]], "one button sends good 10 / fail 1 (defect-aware)");
await dt.close();
const dt2 = await openOperatorPage();
await dt2.evaluate(async () => { config.reportTotalSemanticsEnabled = true; await machtileRefreshReportTotalState(selectedOrder); });
await dt2.waitForFunction(() => reportTotalState.status === "ready" && reportTotalState.failReported === 0);
await dt2.locator("#completedQty").fill("761");
await dt2.locator("[data-simple-report-defect]").check();
await dt2.locator("#defectQty").fill("1");
await dt2.locator('#simpleReportReason [data-station-report-reason="A04"]').selectOption("尺寸不良");
assert.equal(await dt2.locator("#simpleReportHint").innerText(), "這次良品 10 件、不良 1 件");
reportedFail = 5;
await dt2.evaluate(() => machtileRefreshReportTotalState(selectedOrder));
await dt2.waitForFunction(() => reportTotalState.failReported === 5);
assert.match(await dt2.locator("[data-simple-report-summary]").innerText(), /已報 755（含不良 5）$/, "reported good 750 + defect 5 → 已報 755（含不良 5）");
await dt2.evaluate(() => { reportTotalState = { ...reportTotalState, failReported: null }; machtileRenderSingleStationReport(); });
assert.match(await dt2.locator("[data-simple-report-summary]").innerText(), /已報 750$/, "failDone unknown → reported good as before");
reportedFail = 0;
await dt2.evaluate(() => machtileRefreshReportTotalState(selectedOrder));
await dt2.waitForFunction(() => reportTotalState.failReported === 0);
reportedFail = 5;   // someone else's defects landed after the screen was drawn
const dt2Before = calls.commands.length;
await dt2.locator("#reportForm .submit-report").click();
await dt2.waitForFunction(() => document.querySelector("#stationReportBackgroundStatus")?.textContent.includes("工廠已完成寫入"), null, { timeout: 8000 });
const dt2Sent = calls.commands.slice(dt2Before);
assert.deepEqual(dt2Sent.map(c => [c.p_preview, c.p_good_qty, c.p_fail_qty]), [[true, 5, 1], [false, 5, 1]], "F1 in the one-button flow: fresh reread → good 5 (761 − 750 − 5 − 1), never the stale 10");
await dt2.close();
reportedOutput = 920; reportedFail = 0; freshReadEnabled = false; noStartCounter = false;

// L3 #1：連點兩下（含 Enter 再送一次）只能有一條寫入鏈：一筆預覽、最多一筆正式送出。
const dbl = await openOperatorPage();
const dblBefore = calls.commands.length;
await dbl.evaluate(() => {
  const form = document.getElementById("reportForm");
  const button = form.querySelector(".submit-report");
  button.click();
  button.click();
  form.requestSubmit();
});
assert.equal(await dbl.locator("#reportForm .submit-report").isDisabled(), true, "button is disabled synchronously after the first tap");
await dbl.waitForFunction(() => document.querySelector("#stationReportBackgroundStatus")?.textContent.includes("工廠已完成寫入"), null, { timeout: 8000 });
await dbl.waitForTimeout(1500);
const dblSent = calls.commands.slice(dblBefore);
assert.equal(dblSent.filter(c => c.p_preview).length, 1, `double tap → exactly one preview: ${JSON.stringify(dblSent.map(c => c.p_preview))}`);
assert.ok(dblSent.filter(c => !c.p_preview).length <= 1, "double tap → at most one final");
await dbl.close();

// L3 #2：預覽後改了不良數 → 正式送出擋下（零寫入），要重新預覽。
const bad = await openOperatorPage();
await bad.locator("[data-simple-report-defect]").check();
await bad.locator("#defectQty").fill("1");
await bad.locator('#simpleReportReason [data-station-report-reason="A04"]').selectOption("尺寸不良");
await bad.evaluate(() => machtileStationReportSubmitPreview("A04"));
await bad.waitForFunction(() => machtileStationReportState(machtileBatchRow("A04")).phase === "previewed");
assert.equal(await bad.evaluate(() => machtileStationReportState(machtileBatchRow("A04")).args.p_fail_qty), 1);
await bad.locator("#defectQty").fill("2");
const badFinals = calls.commands.filter(c => !c.p_preview).length;
await bad.evaluate(() => machtileStationReportSubmitFinal("A04"));
assert.equal(calls.commands.filter(c => !c.p_preview).length, badFinals, "changed defects after preview → no final");
assert.match(await bad.evaluate(() => machtileStationReportState(machtileBatchRow("A04")).error), /已報數量已改變/);
await bad.close();

// L3 #3：舊單確認（OLD_ORDER_NEWER_OPEN）沒寫原因 → 留在確認狀態、提示寫原因，不重新預覽；寫了才送出。
previewSoftCode = "OLD_ORDER_NEWER_OPEN";
const old = await openOperatorPage();
const oldBefore = calls.commands.length;
await old.locator("#reportForm .submit-report").click();
await old.waitForFunction(() => document.querySelector('[data-simple-report-status="warning"]'));
assert.match(await old.locator('[data-simple-report-status="warning"]').innerText(), /同一個料號已經有比較新的工單/);
assert.equal(await old.locator("#reportForm .submit-report").innerText(), "確認沒錯，送出");
assert.equal(await old.locator('#simpleReportReason [data-station-report-note="A04"]').isVisible(), true, "old-order note field is shown");
await old.locator("#reportForm .submit-report").click();
await old.waitForFunction(() => document.querySelector("#reportSubmitError")?.textContent.includes("請寫一句原因再送出"));
assert.equal(calls.commands.length, oldBefore + 1, "missing note → no fresh preview, no final");
assert.equal(await old.locator("#reportForm .submit-report").innerText(), "確認沒錯，送出", "stays in the soft-confirm state");
await old.locator('#simpleReportReason [data-station-report-note="A04"]').fill("舊單補報");
await old.locator("#reportForm .submit-report").click();
await old.waitForFunction(() => machtileBatchRow("A04").stationReport.result?.status === "applied", null, { timeout: 8000 });
const oldSent = calls.commands.slice(oldBefore);
assert.deepEqual(oldSent.map(c => c.p_preview), [true, false], "note given → one ack final, no second preview");
assert.ok(oldSent[1].p_acks.includes("OLD_ORDER_NEWER_OPEN"));
assert.equal(oldSent[1].p_report_note, "舊單補報");
await old.close();
previewSoftCode = "";
console.log("PASS L3: double tap single chain, defect change blocks final, old-order note keeps soft state");

// ④ 被擋：只有一句白話、沒有技術數字、沒有重複紅框；管理員在技術細節看得到可報數
previewBlockedCode = "QTY_EXCEEDS_AVAILABLE";
const bl = await openOperatorPage();
const blBefore = calls.commands.length;
await bl.locator("#reportForm .submit-report").click();
await bl.waitForFunction(() => document.querySelector('[data-simple-report-status="error"]'));
assert.equal(calls.commands.slice(blBefore).filter(c => !c.p_preview).length, 0, "blocked preview never sends a final");
assert.equal(await bl.locator('[data-simple-report-status="error"]').innerText(), "這次數量比可以報的還多，請確認機台數字是這張單的。");
const blText = await bl.locator("#singleStationReportPanel").innerText();
assert.doesNotMatch(blText, /可報|先領|guard|QTY_EXCEEDS|30/, `no technical numbers for operators: ${blText}`);
assert.equal(await bl.locator('.station-report-simple-status.is-error:visible, #reportSubmitError:visible, #singleStationReportPanel .batch-notice.is-error:visible').count(), 1, "exactly one red sentence");
assert.equal(await bl.locator("#reportForm .submit-report").innerText(), "重新送出");
await sheetShot(bl, "05-operator-blocked.png");
await bl.evaluate(() => { machtileAuthState.role = "admin"; machtileRenderSingleStationReport(); });
assert.equal(await bl.locator("[data-station-report-tech]").count(), 1, "admin keeps 技術細節");
await bl.locator("[data-station-report-tech] > summary").click();
const adminText = await bl.locator("[data-station-report-tech]").innerText();
assert.match(adminText, /目前可報 30 件/, "admin sees the technical available quantity");
assert.match(adminText, /預估先領 38 件/);
assert.equal(await bl.locator('#singleStationReportPanel [data-station-report-preview="A04"]').isVisible(), true, "admin keeps 先預覽");
assert.match(await bl.locator('[data-simple-report-status="error"]').innerText(), /這次數量比可以報的還多/, "admin still gets the same plain sentence on top");
await sheetShot(bl, "06-admin-view.png");
await bl.locator("[data-station-report-tech]").screenshot({ path: path.join(implShots, "07-admin-tech-details.png") });
await bl.close();
previewBlockedCode = ""; starterUserId = null;
console.log("PASS single report simplified operator view (one button, receipt cancel, blocked, admin details)");

// Owner 2026-10-31: the machine counter includes defects. Total semantics on:
// good = machine total - (goodDone + failDone) - this-time defects.
currentMachine = "A04"; reportedOutput = 750; reportedFail = 0; freshReadEnabled = true; noStartCounter = true;
const defectTotal = await context.newPage();
defectTotal.on("pageerror", error => errors.push(error.message));
await defectTotal.goto(base, { waitUntil: "domcontentloaded" });
await defectTotal.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await defectTotal.evaluate(() => { config.reportTotalSemanticsEnabled = true; machtileAuthState.role = "admin"; });
await defectTotal.locator("[data-open-report]:visible").first().click();
await defectTotal.locator('#reportForm [data-report-type="noon"]').click();
await defectTotal.evaluate(() => machtileRefreshReportTotalState(selectedOrder));
await defectTotal.waitForFunction(() => reportTotalState.status === "ready" && reportTotalState.reported === 750 && reportTotalState.failReported === 0);
await defectTotal.locator("#completedQty").fill("761");
await defectTotal.waitForFunction(() => document.querySelector("[data-simple-report-defect]"));
await defectTotal.locator("[data-simple-report-defect]").check();
await defectTotal.locator("#defectQty").fill("1");
assert.equal(await defectTotal.locator("#simpleReportHint").innerText(), "這次良品 10 件、不良 1 件", "simplified operator hint uses the defect-aware result (761 − 750 − 1)");
assert.equal(await defectTotal.locator("#reportCounterPreview").textContent(), "系統已報 750 → 送出後 = 761；這次良品 10 件、不良 1 件", "live hint shows the good/defect split");
assert.deepEqual(await defectTotal.evaluate(() => { const r = reportCounterCalculation(); return { valid: r.valid, good: r.delta, fail: r.fail }; }), { valid: true, good: 10, fail: 1 }, "761 - 750 - 1 defect = 10 good");
const defectCommandsBefore = calls.commands.length;
await defectTotal.locator("[data-station-report-tech] > summary").click();
await defectTotal.locator('#simpleReportReason [data-station-report-reason="A04"]').selectOption("尺寸不良");
await defectTotal.locator('#singleStationReportPanel [data-station-report-preview="A04"]').click();
await defectTotal.waitForFunction(() => document.querySelector('#singleStationReportPanel [data-station-report-confirm="A04"]'));
const defectPreview = calls.commands.slice(defectCommandsBefore).find(command => command.p_preview);
assert.equal(defectPreview.p_good_qty, 10, "smart-report preview sends good 10, not 11");
assert.equal(defectPreview.p_fail_qty, 1);
// F1: the preview reread sees failDone 5 → good is recomputed from the fresh baseline, never the stale 10.
reportedFail = 5;
const staleCommandsBefore = calls.commands.length;
await defectTotal.evaluate(() => { const flow = machtileStationReportState(machtileBatchRow("A04")); flow.phase = "idle"; flow.preview = null; flow.result = null; flow.error = ""; });
await defectTotal.evaluate(() => machtileStationReportSubmitPreview("A04"));
const waitPreviewCommand = async (after) => {
  for (let i = 0; i < 100; i++) {
    const hit = calls.commands.slice(after).find(command => command.p_preview);
    if (hit) return hit;
    await defectTotal.waitForTimeout(50);
  }
  return null;
};
const freshPreview = await waitPreviewCommand(staleCommandsBefore);
assert.equal(freshPreview?.p_good_qty, 5, "preview after a fresh reread sends the fresh good 5 (761 - 750 - 5 - 1)");
assert.equal(await defectTotal.evaluate(() => machtileStationReportState(machtileBatchRow("A04")).singleReport.previewGood), 5);
reportedFail = 0;
await defectTotal.evaluate(() => machtileRefreshReportTotalState(selectedOrder));
await defectTotal.waitForFunction(() => reportTotalState.failReported === 0);
await defectTotal.evaluate(() => { const flow = machtileStationReportState(machtileBatchRow("A04")); flow.phase = "idle"; flow.preview = null; flow.result = null; flow.error = ""; });
await defectTotal.evaluate(() => machtileStationReportSubmitPreview("A04"));
await defectTotal.waitForFunction(() => document.querySelector('#singleStationReportPanel [data-station-report-confirm="A04"]'));
reportedFail = 5;
await defectTotal.evaluate(() => machtileRefreshReportTotalState(selectedOrder));
assert.equal(await defectTotal.locator("#reportCounterPreview").textContent(), "系統已報 755 → 送出後 = 761；這次良品 5 件、不良 1 件", "already-reported defects move the baseline");
assert.equal(await defectTotal.evaluate(() => reportCounterCalculation().delta), 5, "failDone 5 → good 5");
// The preview was taken with failDone 0; a final after failDone changed is blocked with zero writes.
const defectFinalsBefore = calls.commands.filter(command => !command.p_preview).length;
await defectTotal.evaluate(() => machtileStationReportSubmitFinal("A04"));
await defectTotal.waitForFunction(() => document.querySelector("#singleStationReportPanel")?.textContent.includes("已報數量已改變，請重新預覽"));
assert.equal(calls.commands.filter(command => !command.p_preview).length, defectFinalsBefore, "changed reported defects after preview blocks the final");
await defectTotal.evaluate(() => { const flow = machtileStationReportState(machtileBatchRow("A04")); flow.phase = "idle"; flow.error = ""; flow.preview = null; machtileRenderStationReportSurfaces(); });
await defectTotal.locator("#defectQty").fill("7");
assert.equal(await defectTotal.locator("#reportCounterPreview").textContent(), "不良數比這次多出來的件數還多，請確認", "this-time defects above the added parts are blocked");
assert.equal(await defectTotal.evaluate(() => validateReportForm("noon")), "不良數比這次多出來的件數還多，請確認");
await defectTotal.locator("#defectQty").fill("6");
assert.equal(await defectTotal.evaluate(() => validateReportForm("noon")), "", "fail-only (good 0, defect 6) is not blocked by the zero-report rule; factory FAIL_ONLY ack decides");
// failDone unknown (legacy progress has no reliable fail total)
await defectTotal.evaluate(() => { reportTotalState = { ...reportTotalState, failReported: null }; updateReportCounterPreview(); });
await defectTotal.locator("#defectQty").fill("0");
assert.equal(await defectTotal.locator("#reportCounterPreview").textContent(), "系統已報 750 → 送出後 = 761；這次良品 11 件、不良 0 件", "failDone unknown + fail 0 behaves as before");
await defectTotal.locator("#defectQty").fill("1");
assert.equal(await defectTotal.locator("#reportCounterPreview").textContent(), "暫時無法核對已報不良數，請稍後再按", "failDone unknown + fail > 0 fails closed");
assert.equal(await defectTotal.evaluate(() => validateReportForm("noon")), "暫時無法核對已報不良數，請稍後再按");
// F5 + F3: finish prefill = reported good + reported defect; short completion compares planned vs GOOD.
reportedFail = 5;
await defectTotal.evaluate(async () => { activeReportType = "finish"; setReportDefaults(selectedOrder); await machtileRefreshReportTotalState(selectedOrder); });
assert.equal(await defectTotal.locator("#completedQty").inputValue(), "755", "finish prefill = 750 good + 5 defect (machine total so far)");
await defectTotal.locator("#completedQty").fill("761");
await defectTotal.locator("#defectQty").fill("1");
const shortGap = await defectTotal.evaluate(() => ({ hidden: document.getElementById("shortCompletionSection")?.hidden, text: document.querySelector("[data-short-completion-gap]")?.textContent || "" }));
assert.equal(shortGap.hidden, false, "short completion shows when good total 755 < planned 1000");
assert.match(shortGap.text, /245/, `差幾件 = 1000 - (761 - 5 - 1) = 245: ${shortGap.text}`);
await defectTotal.evaluate(() => { activeReportType = "noon"; });
await defectTotal.close();
reportedOutput = 920; reportedFail = 0; freshReadEnabled = false; noStartCounter = false;
console.log("PASS total semantics subtract reported and this-time defects from the machine total");

currentMachine = "A04"; guardFails = true;
const failedGuard = await context.newPage();
await failedGuard.goto(base, { waitUntil: "domcontentloaded" });
await failedGuard.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await failedGuard.locator("[data-open-report]:visible").first().click();
await failedGuard.locator('#reportForm [data-report-type="noon"]').click();
await failedGuard.waitForFunction(() => document.querySelector("#singleStationReportPanel")?.textContent.includes("智慧報工後端尚未同步"));
const failedState = await failedGuard.evaluate(() => ({ submitHidden: document.querySelector("#reportForm .submit-report").hidden, submitDisabled: document.querySelector("#reportForm .submit-report").disabled, panelHidden: document.querySelector("#singleStationReportPanel").hidden, allowlisted: machtileSingleStationReportAllowlisted("A04") }));
assert.equal(failedState.submitHidden, false, `guard failure keeps its disabled primary action visible: ${JSON.stringify(failedState)}`);
assert.equal(failedState.submitDisabled, true, "guard failure remains fail-closed");
assert.match(await failedGuard.locator("#reportSubmitError").innerText(), /智慧報工後端尚未同步/, "guard failure remains visible above submit");
assert.equal(await failedGuard.locator("[data-station-report-reload-guard]").innerText(), "重新載入設定");
guardFails = false;
await failedGuard.locator("[data-station-report-reload-guard]").click();
await failedGuard.waitForFunction(() => !document.querySelector("#reportForm .submit-report").disabled);
assert.equal(await failedGuard.locator("#reportForm .submit-report").innerText(), "送出報工", "guard reload restores the one primary action");
assert.deepEqual(errors, []);
console.log("PASS single station smart report browser contract");
await browser.close();
await new Promise(resolve => server.close(resolve));
