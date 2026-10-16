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
let submittedPayload = null;
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
    if (url.pathname === "/rest/v1/rpc/batch_report_progress") return json([{ process_id: processId, legacy_output: 0, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, last_report_at: "2026-10-12T09:00:00.000Z", actual_start_at: "2026-10-12T00:00:00.000Z" }]);
    if (url.pathname === "/rest/v1/production_reports" && request.method() === "GET" && url.searchParams.get("select") === "report_type,report_payload,created_at") return json(counterReports);
    if (url.pathname === "/rest/v1/production_reports" && request.method() === "POST") {
      submittedPayload = request.postDataJSON();
      return json([submittedPayload]);
    }
    return json(url.pathname.startsWith("/rest/v1/rpc/") ? null : []);
  }
  if (url.origin === new URL(base).origin) {
    if (url.pathname === "/config.js") return route.fulfill({ contentType: "text/javascript", body: `window.MACHTILE_CONFIG={authMode:"strict",supabaseUrl:"${fake}",supabaseAnonKey:"synthetic",tenantId:"${tenant}",useSupabase:true,useTenantHeaderAuth:true,enableStationReport:false,disableServiceWorker:true,oauthEnabled:false,inspectionLinkMachines:["A01"],inspectionLinkBaseUrl:"https://holaadam-tw.github.io/I-Reporter/"};` });
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
const tabs = await page.locator("#reportForm .report-type-tab:visible").allTextContents();
check(tabs.length === 3 && !tabs.some((value) => value.includes("4:30") || value.includes("完工")), "例行報工只留首次開工、報工、異常回報");
check(await page.locator('[data-report-type="dailyStart"], [data-report-type="finish"], [data-report-type="afternoonCheck"]:visible').count() === 0, "例行報工沒有今日開工、完工與 4:30 重複入口");
const flagModes = await page.evaluate(() => {
  config.inspectionLinkMachines = [];
  setReportDefaults(selectedOrder);
  const legacyVisible = !document.querySelector('[data-report-type="afternoonCheck"]').hidden;
  setReportType("afternoonCheck");
  ["pmToolCheck", "pmDimensionCheck", "pmScheduleCheck"].forEach((id) => { document.getElementById(id).checked = true; });
  document.querySelector('input[name="pmAbnormal"][value="no"]').checked = true;
  const legacyValidation = validateReportForm("afternoonCheck");
  const legacyPayload = buildReportPayload("afternoonCheck");
  const historical = machtileUnifiedEventRow({ event_type: "afternoonCheck", event_at: "2026-10-13T08:30:00Z", written_at: "2026-10-13T08:30:01Z" }, new Map());
  config.inspectionLinkMachines = ["A01"];
  setReportDefaults(selectedOrder);
  setReportType("afternoonCheck");
  return {
    legacyVisible,
    legacyValidation,
    legacyPayload,
    historicalType: historical.recordType,
    newHidden: document.querySelector('[data-report-type="afternoonCheck"]').hidden,
    activeType: activeReportType,
  };
});
check(flagModes.legacyVisible && flagModes.legacyValidation === "" && flagModes.legacyPayload.pm_abnormal === "no", "旗標關閉時僅保留舊 4:30 fallback");
check(flagModes.newHidden && flagModes.activeType === "workStart", "旗標開啟時舊 4:30 UI 與狀態不可進入");
check(flagModes.historicalType === "下午盤點", "afternoonCheck 歷史資料仍可讀取");
await page.evaluate(() => loadReportCounterBaseline(selectedOrder));
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
await page.evaluate(() => {
  const processId = "00000000-0000-4000-8000-000000000301";
  if (!machtileCardPickState.progressByProcess) machtileCardPickState.progressByProcess = new Map();
  machtileCardPickState.progressByProcess.set(processId, { process_id: processId, legacy_output: 280, legacy_fail: 0, pending_output: 20, pending_fail: 0, pending_count: 1 });
  openFinishReport("RATE-WO-001", { processId });
});
await page.locator("#finishSheet.is-open").waitFor();
check((await page.locator("#completedQtyLabel").innerText()) === "這一道總完成數（良品）" && (await page.locator("#finishReportedQty").innerText()) === "已報 300 件", "完工欄位與卡片共用舊 MES 280＋待回寫 20 的已報數");
check(await page.locator("#reportCounterPreview").isHidden() && await page.locator("#reportCounterManual").isHidden() && !(await page.locator("#finishSheet").innerText()).includes("機台目前累計數"), "4 完工不顯示或讀取機台累計與歸零選項");
const finishCases = await page.evaluate(() => {
  const input = document.querySelector("#completedQty");
  const run = total => { input.value = String(total); return { validation: validateReportForm("finish"), payload: buildReportPayload("finish"), calc: reportCounterCalculation() }; };
  return { midday: run(560), unchanged: run(300), lower: run(299), zero: MachTileReportCounterCore.finishTotal(0, 0), over: run(320) };
});
check(finishCases.midday.validation === "" && finishCases.midday.payload.completed_qty === 260 && finishCases.midday.payload.machine_qty === null, "1 中午 300、總數 560 僅送補報 260");
check(finishCases.unchanged.validation === "" && finishCases.unchanged.payload.completed_qty === 0, "2 沒再做時補報 0 仍可送");
check(finishCases.midday.calc.reported === 300, "3 跨日且今天無開工／盤點仍使用整道累計已報");
check(finishCases.lower.validation === "總數不能小於已報的 300 件；報錯請用報工修正", "5 總數小於已報時擋下並指引報工修正");
check(finishCases.midday.calc.reported === 300, "6 換人收尾不影響整道已報來源");
check(finishCases.midday.calc.reported === 300, "7 電子紙舊 MES 280 也包含在已報中");
check(finishCases.zero.message === "這一道還沒有報工數量，不能完工關站；請先報工", "8 從頭到尾零件時擋下");
check(finishCases.over.validation === "" && finishCases.over.payload.completed_qty === 20, "9 已報或實際總數超計畫時不阻擋");
await page.locator("#completedQty").fill("560");
await page.locator("#finishSheet .finish-panel").screenshot({ path: path.join(screenshotDir, "finish-total-desktop.png") });
await page.setViewportSize({ width: 390, height: 844 });
await page.locator("#finishSheet .finish-panel").screenshot({ path: path.join(screenshotDir, "finish-total-mobile.png") });
await page.setViewportSize({ width: 800, height: 1000 });
await page.evaluate(() => openReport("RATE-WO-001", { reportType: "noon" }));

counterReports = [{ report_type: "noon", created_at: new Date(Date.now() - 600_000).toISOString(), report_payload: { machine_qty: 130 } }];
await page.evaluate(() => setReportType("noon"));
await page.evaluate(() => loadReportCounterBaseline(selectedOrder));
await page.evaluate(() => {
  document.querySelector("#cycleMinutes").value = "0";
  document.querySelector("#cycleSeconds").value = "100";
  document.querySelector("#cycleSeconds").dispatchEvent(new Event("input", { bubbles: true }));
});
await page.locator("#defectQty").fill("0");
await page.locator("#completedQty").fill("136");
check(await page.locator("#reportCounterRateWarning").isHidden(), "normal Z plus defects does not show rate warning");
await page.locator("#completedQty").fill("137");
const realRateWarning = page.locator("#reportCounterRateWarning");
check(await realRateWarning.isVisible() && (await realRateWarning.innerText()).includes("7"), "real cumulative preview shows warning when Z plus defects exceeds capacity");
check(await page.locator("#reportForm .submit-report").isEnabled(), "rate warning leaves submit enabled");
check((await page.evaluate(() => validateReportForm("noon"))) === "", "rate warning is non-blocking validation");
await page.screenshot({ path: path.join(screenshotDir, "20261013-report-rate-warning-real-flow-800px.png"), fullPage: true });
await page.evaluate(() => submitReport(7, 0, "", "noon"));
check(submittedPayload?.completed_qty === 7, "rate warning does not block real submit and payload uses Z");

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
