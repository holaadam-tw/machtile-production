import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = process.env.MACHTILE_SCREENSHOT_DIR || "D:/04_SoftNet/ops/codex-inbox/shots";
await mkdir(screenshotDir, { recursive: true });
const moduleSpec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const imported = await import(moduleSpec);
const { chromium } = imported.default || imported;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.resolve(root, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const fake = "https://fake-supabase.test";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1), processId = id(301), appUserId = id(901);
const card = { id: id(101), tenant_id: tenant, work_order_no: "RATE-WO-001", part_no: "RATE-PART", part_name: "速度測試件", drawing_no: "RATE-DWG", quantity: 100,
  due_date: "2026-10-20", priority: "normal", work_order_status: "in_progress", current_process_id: processId, current_process_name: "車削", current_process_status: "running",
  machine_name: "A01", qty_completed: 0, qty_defect: 0, progress_percent: 0, last_report_at: "2026-10-13T01:00:00.000Z", open_risk_level: null, current_process_off_station: false };
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id(801), email: "operator@test.invalid", exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: tenant, role: "operator" } })}.synthetic`;
let checks = 0;
let counterReports = [{ report_type: "dailyStart", created_at: "2026-10-13T00:10:00.000Z", report_payload: { machine_qty: 100 } }];
function check(value, label) { assert.ok(value, label); checks++; console.log(`PASS ${label}`); }

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, serviceWorkers: "block" });
await context.addInitScript(sessionToken => sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: sessionToken, refreshToken: "", email: "operator@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 })), token);
const external = [];
await context.route("**/*", async route => {
  const request = route.request(), url = new URL(request.url());
  const json = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  if (url.origin === new URL(fake).origin) {
    if (url.pathname === "/auth/v1/user") return json({ id: id(801), email: "operator@test.invalid" });
    if (url.pathname === "/rest/v1/app_users") return json([{ id: appUserId, name: "測試作業員", legacy_user_id: "TEST-001" }]);
    if (url.pathname === "/rest/v1/rpc/machine_department_context") return json({ tenant_id: tenant, role: "operator", is_bridge: false, all_departments: false, department_codes: ["LATHE"] });
    if (url.pathname === "/rest/v1/v_work_order_cards") return json([card]);
    if (url.pathname === "/rest/v1/v_machine_management_cards") return json([{ id: id(201), machine_code: "A01", machine_name: "A01", machine_type: "車床", status: "idle", display_order: 1 }]);
    if (url.pathname === "/rest/v1/rpc/batch_report_progress") return json([{ process_id: processId, legacy_output: 0, legacy_fail: 0, last_report_at: "2026-10-13T01:00:00.000Z", actual_start_at: "2026-10-13T00:00:00.000Z" }]);
    if (url.pathname === "/rest/v1/production_reports" && request.method() === "GET" && url.searchParams.get("select") === "report_type,report_payload,created_at") return json(counterReports);
    return json(url.pathname.startsWith("/rest/v1/rpc/") ? null : []);
  }
  if (url.origin === new URL(base).origin) {
    if (url.pathname === "/config.js") return route.fulfill({ contentType: "text/javascript", body: `window.MACHTILE_CONFIG={authMode:"strict",supabaseUrl:"${fake}",supabaseAnonKey:"synthetic",tenantId:"${tenant}",useSupabase:true,useTenantHeaderAuth:true,enableStationReport:false,disableServiceWorker:true,oauthEnabled:false};` });
    return route.continue();
  }
  external.push(url.href);
  return route.abort();
});

const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await page.locator("[data-open-report]:visible").first().click();
await page.locator("#reportSheet.is-open").waitFor();
const tabs = await page.locator("#reportForm .report-type-tab").allTextContents();
check(JSON.stringify(tabs.map(v => v.trim())) === JSON.stringify(["首次開工", "報工", "收工/完工", "異常回報"]), "報工表單只有四分頁且名稱正確");
check(await page.locator('[data-report-type="dailyStart"], [data-report-type="afternoonCheck"]').count() === 0, "今日開工與下午 4:30 入口已移除");
await page.locator('[data-report-type="noon"]').click();
await page.waitForFunction(() => document.querySelector("#reportCounterPreview")?.textContent.includes("上次 100"));
await page.locator("#completedQty").fill("130");
const startBaseline = await page.evaluate(() => ({
  text: document.querySelector("#reportCounterPreview")?.textContent,
  validation: validateReportForm("noon"),
  payload: buildReportPayload("noon"),
}));
check(startBaseline.text === "累計 130｜上次 100｜這次 30", "開工計數器作基準並預覽 X/Y/Z");
check(startBaseline.validation === "" && startBaseline.payload.completed_qty === 30 && startBaseline.payload.machine_qty === 130, "正常累計只送差額 Z 並記錄目前累計");
await page.locator("#completedQty").fill("100");
check((await page.evaluate(() => validateReportForm("noon"))).includes("差額需大於 0"), "Z <= 0 有說明且擋送出");

counterReports = [...counterReports, { report_type: "noon", created_at: "2026-10-13T03:00:00.000Z", report_payload: { machine_qty: 130 } }];
await page.evaluate(() => loadReportCounterBaseline(selectedOrder));
await page.waitForFunction(() => document.querySelector("#reportCounterPreview")?.textContent.includes("上次 130"));
await page.locator("#completedQty").fill("145");
const consecutive = await page.evaluate(() => ({ text: document.querySelector("#reportCounterPreview")?.textContent, payload: buildReportPayload("noon") }));
check(consecutive.text === "累計 145｜上次 130｜這次 15" && consecutive.payload.completed_qty === 15, "連續第二次報工使用第一次累計作基準");
counterReports = [];
await page.evaluate(() => loadReportCounterBaseline(selectedOrder));
await page.waitForFunction(() => !document.querySelector("#reportCounterManual")?.hidden);
check((await page.locator("#reportCounterManual").innerText()).includes("請先按開工"), "無基準時提示先按開工並開放手填基準");
await page.locator("#reportCounterManualBaseline").fill("120");
await page.locator("#completedQty").fill("150");
const manual = await page.evaluate(() => buildReportPayload("noon"));
check(manual.completed_qty === 30 && manual.counter_baseline_qty === 120 && manual.counter_baseline_source === "manual", "手填基準會記錄來源且送出差額");
counterReports = [{ report_type: "noon", created_at: "2026-10-13T03:00:00.000Z", report_payload: { machine_qty: 130 } }];
await page.evaluate(() => loadReportCounterBaseline(selectedOrder));
await page.locator("#completedQty").fill("145");
const sourceCoverage = await page.evaluate(() => {
  const core = window.MachTileReportCounterCore;
  return {
    start: core.latestBaseline([{ report_type: "dailyStart", created_at: "2026-10-13T00:00:00Z", report_payload: { machine_qty: 10 } }]),
    report: core.latestBaseline([{ report_type: "dailyStart", created_at: "2026-10-13T00:00:00Z", report_payload: { machine_qty: 10 } }, { report_type: "noon", created_at: "2026-10-13T02:00:00Z", report_payload: { machine_qty: 20 } }]),
  };
});
check(sourceCoverage.start.source === "dailyStart" && sourceCoverage.report.source === "report", "browser core 涵蓋兩種基準來源");
check((await page.locator('[data-report-section="noon"]').innerText()).includes("照機台計數器填累計數量") && !(await page.locator('[data-report-section="noon"]').innerText()).includes("中午"), "報工說明沒有時間字樣且維持累計語意");
check((await page.locator('label[for="completedQty"]').innerText()).startsWith("機台目前累計數") && (await page.locator('label[for="defectQty"]').innerText()).startsWith("這次不良數"), "報工欄位區分機台累計與這次不良");
await page.screenshot({ path: path.join(screenshotDir, "20261013-report-cumulative-counter-800px.png"), fullPage: true });
await page.locator('[data-report-type="finish"]').click();
check((await page.locator("#reportCounterPreview").innerText()) === "累計 145｜上次 130｜這次 15" && (await page.locator("#completedQtyLabel").innerText()) === "機台目前累計數", "收工分頁套用相同累計差額規則");

const rate = await page.evaluate(() => {
  const core = window.MachTileStationReportCore;
  const shared = { startedAt: "2026-10-13T01:00:00.000Z", serverNow: "2026-10-13T01:10:00.000Z", previewResult: { rate_check: { FWC_OwnerCycleSeconds: 100 } } };
  const warning = core.rateReasonableness({ ...shared, reportedQty: 7 });
  const normal = core.rateReasonableness({ ...shared, reportedQty: 6 });
  const missing = core.rateReasonableness({ ...shared, previewResult: {}, reportedQty: 7 });
  const host = document.createElement("section");
  host.className = "station-report-panel";
  host.innerHTML = `<div class="station-report-heading"><strong>智慧報工預覽</strong><span>套用端預覽 → 確認</span></div><div class="station-report-result is-success"><strong>預覽完成・尚未報工</strong><p class="station-report-rate-warning" role="note">${warning.message}</p></div><div class="station-report-actions"><button type="button" class="primary-action station-report-action" data-station-report-confirm>長按 1 秒確認報工</button></div>`;
  document.querySelector("#reportForm").prepend(host);
  host.scrollIntoView();
  return { warning, normal, missing, confirmEnabled: !host.querySelector("[data-station-report-confirm]").disabled };
});
check(rate.warning.warn && rate.warning.message === "照工時這段時間最多約 6 件，你報 7 件，請確認", "M>N 顯示指定黃字警告");
check(!rate.normal.warn && rate.normal.message === "", "M≤N 不顯示警告");
check(rate.missing === null, "工序無工時資料時不顯示");
check(rate.confirmEnabled, "速度警告不擋確認送出");
await page.screenshot({ path: path.join(screenshotDir, "20261013-report-rate-warning-800px.png"), fullPage: true });
check(pageErrors.length === 0, `沒有 JavaScript 錯誤：${pageErrors.join(" | ")}`);
check(!external.some(url => /machtile\.com|supabase\.co/.test(url)), "沒有連正式 Supabase／正式網域");
console.log(`${checks} passed; screenshots=${screenshotDir}`);
await browser.close();
await new Promise(resolve => server.close(resolve));
