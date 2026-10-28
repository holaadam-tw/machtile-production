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
    if (url.pathname.endsWith("/app_users")) return json([{ id: id(901), name: "試點員", legacy_user_id: "TEST-001" }]);
    if (url.pathname.endsWith("/rpc/batch_report_progress")) return json([{ process_id: processId, legacy_output: 920, legacy_fail: 0, last_report_at: "2026-10-13T03:00:00Z", actual_start_at: "2026-10-13T00:00:00Z" }]);
    if (url.pathname.endsWith("/production_reports") && req.method() === "GET" && url.searchParams.get("select") === "report_type,report_payload,created_at") return json([{ report_type: "noon", created_at: "2026-10-13T03:00:00Z", report_payload: { machine_qty: 920 } }]);
    if (url.pathname.endsWith("/rpc/machtile_submit_station_report")) {
      const body = req.postDataJSON(); calls.commands.push(body);
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
    if (url.pathname === "/config.js") return route.fulfill({ contentType: "text/javascript", body: `window.MACHTILE_CONFIG={authMode:"dev-nologin",supabaseUrl:"${fake}",supabaseAnonKey:"test",useSupabase:true,enableStationReport:true,stationReportMachines:["A04"],enableFinishButton:${finishButtonEnabled},enableFinishClose:true,finishCloseMachines:["A04"],enableShortCompletion:true,shortCompletionMachines:["A04"],stationCommandMachines:["A04"],enablePickStartFlow:${pickStartEnabled},pickStartFlowMachines:${pickStartEnabled ? '["A04"]' : "[]"},disableServiceWorker:true};` });
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
await page.locator("[data-open-report]:visible").first().click();
await page.locator('[data-report-type="noon"]').click();
assert.equal(await page.locator('#reportForm .report-type-tab[data-report-type="finish"]').count(), 0, "routine report has no finish tab");
await page.locator("#completedQty").fill("958");
await page.locator("#defectQty").fill("2");
await page.waitForFunction(() => document.querySelector('[data-station-report-preview="A04"]'));
assert.equal(await page.locator("#reportFailReasonField").isHidden(), true, "A04 smart report does not show a duplicate general fail-reason field");
assert.equal(await page.locator('.station-report-reason:visible').count(), 1, "A04 with defects shows exactly one fail-reason field");

const routeState = await page.evaluate(() => ({ allowlisted: machtileSingleStationReportAllowlisted("A04"), active: machtileSingleStationReportActive(), panelHidden: document.querySelector("#singleStationReportPanel").hidden, submitHidden: document.querySelector("#reportForm .submit-report").hidden }));
assert.equal(routeState.submitHidden, false, `allowlisted station keeps the primary submit visible: ${JSON.stringify(routeState)}`);
assert.equal(await page.locator("#reportForm .submit-report").innerText(), "預覽並送出");
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
await page.locator("#reportForm .submit-report").click();
await page.waitForTimeout(500);
assert.equal(await page.locator('#singleStationReportPanel [data-station-report-confirm="A04"]').count(), 1, `${await page.locator("#singleStationReportPanel").innerText()} calls=${JSON.stringify(calls.commands)}`);
assert.equal(calls.commands.length, 1, "preview creates one command");
assert.equal(calls.commands[0].p_preview, true);
assert.equal(calls.commands[0].p_good_qty, 38);
assert.equal(calls.commands[0].p_fail_qty, 2);
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
assert.match(await page.locator("#singleStationReportPanel").innerText(), /工廠沒有回應，可再按一次/, "25-second preview timeout offers a retry in place");
await page.locator('#singleStationReportPanel [data-station-report-preview-retry="A04"]').click();
await page.waitForFunction(() => document.querySelector('[data-station-report-confirm="A04"]'));
assert.equal(calls.commands.at(-1).p_command_uuid, previewUuid, "preview retry reuses the same idempotent command_uuid");

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
await outsider.locator('[data-report-type="noon"]').click();
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
await disabledGuard.locator('[data-report-type="noon"]').click();
await disabledGuard.waitForFunction(() => !document.querySelector("#reportForm .submit-report").hidden);
assert.equal(await disabledGuard.locator("#reportForm .submit-report").isVisible(), true, "loaded runtime kill switch restores legacy submit");
await disabledGuard.close();

guardEnabled = true; finalSubmitFails = true; reconciledCommand = null;
const reconcile = await context.newPage();
await reconcile.goto(base, { waitUntil: "domcontentloaded" });
await reconcile.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await reconcile.locator("[data-open-report]:visible").first().click();
await reconcile.locator('[data-report-type="noon"]').click();
await reconcile.locator("#completedQty").fill("958");
await reconcile.locator("#defectQty").fill("2");
await reconcile.waitForFunction(() => document.querySelector('[data-station-report-preview="A04"]'));
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

currentMachine = "A04"; guardFails = true;
const failedGuard = await context.newPage();
await failedGuard.goto(base, { waitUntil: "domcontentloaded" });
await failedGuard.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await failedGuard.locator("[data-open-report]:visible").first().click();
await failedGuard.locator('[data-report-type="noon"]').click();
await failedGuard.waitForFunction(() => document.querySelector("#singleStationReportPanel")?.textContent.includes("智慧報工後端尚未同步"));
const failedState = await failedGuard.evaluate(() => ({ submitHidden: document.querySelector("#reportForm .submit-report").hidden, submitDisabled: document.querySelector("#reportForm .submit-report").disabled, panelHidden: document.querySelector("#singleStationReportPanel").hidden, allowlisted: machtileSingleStationReportAllowlisted("A04") }));
assert.equal(failedState.submitHidden, false, `guard failure keeps its disabled primary action visible: ${JSON.stringify(failedState)}`);
assert.equal(failedState.submitDisabled, true, "guard failure remains fail-closed");
assert.match(await failedGuard.locator("#reportSubmitError").innerText(), /智慧報工後端尚未同步/, "guard failure remains visible above submit");
assert.equal(await failedGuard.locator("[data-station-report-reload-guard]").innerText(), "重新載入設定");
guardFails = false;
await failedGuard.locator("[data-station-report-reload-guard]").click();
await failedGuard.waitForFunction(() => !document.querySelector("#reportForm .submit-report").disabled);
assert.equal(await failedGuard.locator("#reportForm .submit-report").innerText(), "預覽並送出", "guard reload restores smart primary action");
assert.deepEqual(errors, []);
console.log("PASS single station smart report browser contract");
await browser.close();
await new Promise(resolve => server.close(resolve));
