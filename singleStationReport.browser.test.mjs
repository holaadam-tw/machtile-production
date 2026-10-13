import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const shots = process.env.MACHTILE_SCREENSHOT_DIR || "D:/04_SoftNet/ops/codex-inbox/shots";
await mkdir(shots, { recursive: true });
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
const calls = { commands: [], reports: [] };
const requestUrls = [];
let currentMachine = "A04";
let guardFails = false;
let guardEnabled = true;
let finalSubmitFails = false;
let reconciledCommand = null;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 800, height: 1100 }, serviceWorkers: "block" });
await context.route("**/*", async route => {
  const req = route.request(); const url = new URL(req.url());
  if (url.origin === fake) {
    requestUrls.push(url.href);
    const json = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/rpc/machtile_get_station_report_guard_config")) return guardFails ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "guard 讀取失敗" }) }) : json({ factory_synced: true, machine_code: "A04", report_enabled: guardEnabled, report_enabled_machines: { A04: guardEnabled }, fail_reason_codes: ["尺寸不良"] });
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
      return json(body.p_preview
        ? { command_uuid: body.p_command_uuid, command_type: "report_preview", status: "previewed", preview_result: { ...previewResult, command_uuid: body.p_command_uuid } }
        : { command_uuid: body.p_command_uuid, command_type: "report", status: "applied", good_qty: body.p_good_qty, fail_qty: body.p_fail_qty });
    }
    if (url.pathname.endsWith("/station_commands") && req.method() === "GET") return json(reconciledCommand ? [reconciledCommand] : []);
    if (url.pathname.endsWith("/production_reports") && req.method() === "POST") { calls.reports.push(req.postDataJSON()); return json([calls.reports.at(-1)]); }
    return json([]);
  }
  if (url.origin === base.slice(0, -1)) {
    if (url.pathname === "/config.js") return route.fulfill({ contentType: "text/javascript", body: `window.MACHTILE_CONFIG={authMode:"dev-nologin",supabaseUrl:"${fake}",supabaseAnonKey:"test",useSupabase:true,enableStationReport:true,stationReportMachines:["A04"],disableServiceWorker:true};` });
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
await page.locator("#completedQty").fill("958");
await page.locator("#defectQty").fill("2");
await page.waitForFunction(() => document.querySelector('[data-station-report-preview="A04"]'));

const routeState = await page.evaluate(() => ({ allowlisted: machtileSingleStationReportAllowlisted("A04"), active: machtileSingleStationReportActive(), panelHidden: document.querySelector("#singleStationReportPanel").hidden, submitHidden: document.querySelector("#reportForm .submit-report").hidden }));
assert.equal(routeState.submitHidden, true, `allowlisted station hides legacy submit: ${JSON.stringify(routeState)}`);
assert.match(await page.locator("#singleStationReportPanel").innerText(), /智慧報工/);
assert.equal(await page.locator('[data-station-report-reason="A04"]').isEnabled(), true, `${await page.locator("#singleStationReportPanel").innerText()}\n${requestUrls.filter(u => u.includes("work_order_processes")).join("\n")}`);
await page.evaluate(operatorId => {
  const list = document.createElement("div");
  list.id = "machtileOperatorList";
  list.innerHTML = `<input type="checkbox" value="${operatorId}" data-mapped="1">`;
  document.body.append(list);
}, id(901));
await page.locator('[data-station-report-reason="A04"]').selectOption("尺寸不良");
await page.locator('#singleStationReportPanel [data-station-report-preview="A04"]').click();
assert.equal(calls.commands.length, 0, "smart preview rejects an unselected mapped operator");
assert.match(await page.locator("#singleStationReportPanel").innerText(), /請勾選實際操作的人員/);
await page.evaluate(() => {
  const input = document.querySelector('#machtileOperatorList input[type="checkbox"]');
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.locator('#singleStationReportPanel [data-station-report-preview="A04"]').click();
await page.waitForTimeout(500);
assert.equal(await page.locator('#singleStationReportPanel [data-station-report-confirm="A04"]').count(), 1, `${await page.locator("#singleStationReportPanel").innerText()} calls=${JSON.stringify(calls.commands)}`);
assert.equal(calls.commands.length, 1, "preview creates one command");
assert.equal(calls.commands[0].p_preview, true);
assert.equal(calls.commands[0].p_good_qty, 38);
assert.equal(calls.commands[0].p_fail_qty, 2);
assert.deepEqual(await page.evaluate(() => machtileBatchRow("A04").stationReport.singleReport.operators), [id(901)], "selected mapped operator is frozen into the smart-report flow");
assert.equal(calls.reports.length, 0, "preview never records production report");

const confirm = page.locator('#singleStationReportPanel [data-station-report-confirm="A04"]');
await confirm.dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
await page.waitForTimeout(400);
await confirm.dispatchEvent("pointerup", { pointerType: "mouse", button: 0 });
await page.waitForTimeout(700);
assert.equal(calls.commands.length, 1, "short press sends no report command");
await confirm.dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
await page.waitForTimeout(1600);
assert.equal(calls.commands.length, 2, "long press sends one final report command");
assert.equal(calls.commands[1].p_preview, false);
assert.equal(calls.commands[1].p_good_qty, 38);
assert.equal(calls.commands[1].p_fail_qty, 2);
assert.equal(calls.reports.length, 1, "applied command records production_reports exactly once");
assert.equal(calls.reports[0].completed_qty, 38);
assert.equal(calls.reports[0].defect_qty, 2);
const happyUuid = calls.commands[1].p_command_uuid;
await page.evaluate(() => machtileRecordSingleStationProductionReport("A04", machtileBatchRow("A04").stationReport.args));
assert.equal(calls.reports.length, 1, "same successful command_uuid does not duplicate production_reports");
assert.equal(calls.reports[0].report_uuid, happyUuid);
await page.screenshot({ path: path.join(shots, "20261013-single-station-smart-report-800px.png"), fullPage: true });

await page.close();
currentMachine = "A03";
const outsider = await context.newPage();
await outsider.goto(base, { waitUntil: "domcontentloaded" });
await outsider.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await outsider.locator("[data-open-report]:visible").first().click();
await outsider.locator('[data-report-type="noon"]').click();
assert.equal(await outsider.locator("#reportForm .submit-report").isVisible(), true, "non-allowlisted station keeps legacy submit");
assert.equal(await outsider.locator("#singleStationReportPanel").isHidden(), true);
await outsider.close();

currentMachine = "A04";
const finishValidation = await context.newPage();
await finishValidation.goto(base, { waitUntil: "domcontentloaded" });
await finishValidation.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await finishValidation.locator("[data-open-report]:visible").first().click();
await finishValidation.locator('[data-report-type="finish"]').click();
await finishValidation.locator("#completedQty").fill("958");
await finishValidation.locator("#defectQty").fill("0");
await finishValidation.waitForFunction(() => document.querySelector('[data-station-report-preview="A04"]'));
const finishCommandsBefore = calls.commands.length;
await finishValidation.locator('[data-station-report-preview="A04"]').click();
assert.equal(calls.commands.length, finishCommandsBefore, "finish preview rejects a missing overtime choice");
assert.match(await finishValidation.locator("#singleStationReportPanel").innerText(), /請確認是否加班/);
await finishValidation.close();

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
await reconcile.waitForFunction(() => document.querySelector('[data-station-report-reconcile="A04"]'), null, { timeout: 5000 });
const reconcileReportsBefore = calls.reports.length;
const reconcileCommandsBefore = calls.commands.length;
await reconcile.locator('#singleStationReportPanel [data-station-report-reconcile="A04"]').click();
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
const failedState = await failedGuard.evaluate(() => ({ submitHidden: document.querySelector("#reportForm .submit-report").hidden, panelHidden: document.querySelector("#singleStationReportPanel").hidden, allowlisted: machtileSingleStationReportAllowlisted("A04") }));
assert.equal(failedState.submitHidden, true, `guard failure remains fail-closed: ${JSON.stringify(failedState)}`);
assert.deepEqual(errors, []);
console.log("PASS single station smart report browser contract");
await browser.close();
await new Promise(resolve => server.close(resolve));
