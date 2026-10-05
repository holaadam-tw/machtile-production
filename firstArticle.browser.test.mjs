// Real index.html + app.js, synthetic account/orders, all backend requests intercepted.
// MACHTILE_PLAYWRIGHT_MODULE=<playwright/index.mjs> node firstArticle.browser.test.mjs
// --baseline records the old form contract before editing; never connects to a real backend.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const baseline = process.argv.includes("--baseline");
const spec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const imported = await import(spec);
const { chromium } = imported.default || imported;
const out = path.resolve(process.env.MACHTILE_SCREENSHOT_DIR || path.join(root, "output/playwright/first-article"));
await mkdir(out, { recursive: true });
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer(async (req, res) => {
  if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
  const url = new URL(req.url, "http://localhost");
  const file = path.resolve(root, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try { const data = await readFile(file); res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const fake = "https://fake-supabase.test";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1);
const user = { id: id(901), name: "測試作業員", legacy_user_id: "TEST-001" };
const card = { id: id(101), tenant_id: tenant, work_order_no: "TEST-WO-001", customer_name: "測試客戶", part_name: "測試零件", drawing_no: "TEST-DRAWING",
  quantity: 100, due_date: "2026-10-20", priority: "normal", work_order_status: "in_progress", current_process_id: id(301),
  current_process_name: "車削", current_process_status: "running", machine_name: "A01", qty_completed: 0, qty_defect: 0,
  progress_percent: 0, last_report_at: null, open_risk_level: null, current_process_off_station: false };
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : "加工中心", location: "", status: "idle", display_order: i }));
const encode = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id(801), email: "operator@test.invalid", exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: tenant, role: "operator" } })}.synthetic`;
const photo = { name: "synthetic-camera.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG5kAAAAASUVORK5CYII=", "base64") };
let checks = 0;
function check(value, label) { assert.ok(value, label); console.log(`PASS ${label}`); checks++; }
const browser = await chromium.launch();
const blocked = [];
const errors = [];
async function scenario(outbox) {
  const posts = [], uploads = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await context.addInitScript(token => {
    sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "operator@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
  }, token);
  await context.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    const json = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.origin === new URL(fake).origin) {
      const p = url.pathname;
      if (p === "/auth/v1/user") return json({ id: id(801), email: "operator@test.invalid" });
      if (p === "/rest/v1/app_users") return json([user]);
      if (p === "/rest/v1/rpc/machine_department_context") return json({tenant_id:tenant,role:"operator",is_bridge:false,all_departments:false,department_codes:["LATHE","MILL"]});
      if (p === "/rest/v1/v_work_order_cards") return json([card]);
      if (p === "/rest/v1/v_machine_management_cards") return json(machines);
      if (p === "/rest/v1/rpc/batch_report_progress") return json([{ process_id: id(301), legacy_output: 0, legacy_fail: 0, last_report_at: null, actual_start_at: null }]);
      if (p === "/rest/v1/rpc/field_report_upsert") { posts.push(JSON.parse(req.postData()).p_payload); return json({ report_id: id(7000 + posts.length), inserted: true }); }
      if (p === "/rest/v1/production_reports" && req.method() === "POST") { posts.push(JSON.parse(req.postData())); return json([{ id: id(7000 + posts.length) }]); }
      if (p.startsWith("/storage/v1/object/") && req.method() === "POST") { uploads.push(p); return json({ Key: p }); }
      if (p === "/rest/v1/attachments" && req.method() === "POST") return json([]);
      if (req.method() !== "GET" && !p.startsWith("/rest/v1/rpc/")) throw new Error(`Unexpected fake write: ${req.method()} ${p}`);
      return json(p.startsWith("/rest/v1/rpc/") ? null : []);
    }
    if (url.origin === new URL(base).origin && req.method() === "GET") {
      if (url.pathname === "/config.js") return route.fulfill({ contentType: "text/javascript", body: `window.MACHTILE_CONFIG={authMode:"strict",supabaseUrl:"${fake}",supabaseAnonKey:"synthetic-public-key",tenantId:"${tenant}",useSupabase:true,useTenantHeaderAuth:true,enableOutboxSubmit:${outbox},enableFileUpload:true,enableScheduleContracts:false,enableCalibrationGovernance:false,enableManufacturingQuoteTracking:false,useHmcWorklistSupabase:false,oauthEnabled:false,enableJevTriage:false,enableAccountDelete:false,enableFaceStatus:false,disableServiceWorker:true,hmcFixedStagingEnabled:false};` });
      return route.continue();
    }
    blocked.push({ method: req.method(), host: url.host });
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
  const open = async type => {
    await page.locator(".fab[data-open-report]").click();
    await page.locator(`[data-report-type="${type}"]`).click();
    const operator = page.locator("#machtileOperatorList input[type=checkbox]").first();
    if (await operator.count()) await operator.check();
  };
  const submit = () => page.locator("#reportForm button[type=submit]").click();
  const closed = () => page.waitForFunction(() => !document.querySelector("#reportSheet")?.classList.contains("is-open"));
  const screenshot = async name => {
    const mobile = name.endsWith("mobile");
    if (!mobile) await page.setViewportSize({ width: 1000, height: 1200 });
    if (!baseline) await page.waitForFunction(() => !document.querySelector("#toast")?.classList.contains("is-visible"));
    await page.waitForTimeout(350); // Allow the toast's opacity transition to finish.
    await page.evaluate(() => {
      document.querySelectorAll('#reportSheet *').forEach(element => {
        if (element.scrollHeight > element.clientHeight) element.scrollTop = 0;
      });
    });
    await page.screenshot({ path: path.join(out, `${baseline ? "before" : "after"}-${outbox ? "outbox" : "direct"}-${name}.png`) });
    if (!baseline && name.startsWith("work-start") && !mobile) {
      await page.locator('[data-report-section="workStart"] .checklist-card').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, `after-${outbox ? "outbox" : "direct"}-${name}-checklist.png`) });
    }
    if (!mobile) await page.setViewportSize({ width: 390, height: 844 });
  };

  await open("workStart");
  await page.locator("#workTotalQty").fill("100");
  await page.locator("#cycleMinutes").fill("1");
  await page.locator("#cycleSeconds").fill("30");
  await page.locator("#startPhoto").setInputFiles(photo);
  const before = posts.length;
  await submit();
  if (baseline) {
    await closed();
    check(posts.length === before + 1, "BASELINE workStart without checklist passes (old contract)");
    await screenshot("work-start-without-checklist");
    await open("dailyStart");
    await page.locator("#machineQty").fill("0");
    await submit();
    await page.waitForFunction(() => document.body.textContent.includes("今日開工必須拍攝機台照片"));
    check(posts.length === before + 1, "BASELINE dailyStart without photo is blocked, no request");
    await screenshot("daily-start-photo-required");
    console.log(`BASELINE ${new Date().toISOString()} artifact=origin/main path=/rest/v1/${outbox ? "rpc/field_report_upsert" : "production_reports"} firstHTTP=mock200 dailyHTTP=NO_REQUEST`);
    await context.close();
    return;
  }
  await page.waitForFunction(() => document.body.textContent.includes("請完成首次開工首件檢查表"));
  check(posts.length === before, "workStart with photo but no checklist blocks before submission");
  check(await page.locator('[data-report-section="workStart"] .checklist-card input').count() === 3, "three checks belong to workStart only");
  await screenshot("work-start-blocked");
  for (const name of ["firstArticleSize", "firstArticleSurface"]) await page.locator(`#${name}`).check();
  await submit();
  check(posts.length === before, "incomplete checklist remains blocked");
  await page.locator("#firstArticleTool").check();
  await page.locator("#startPhoto").setInputFiles([]);
  await submit();
  await page.waitForFunction(() => document.body.textContent.includes("首次開工必須拍照"));
  check(posts.length === before, "workStart still requires startPhoto after all checks");
  await page.locator("#startPhoto").setInputFiles(photo);
  await screenshot("work-start-complete");
  await submit();
  await closed();
  check(posts.length === before + 1, "complete workStart submits exactly once");
  check(posts.at(-1).report_payload.first_article_size === true && posts.at(-1).report_payload.first_article_surface === true && posts.at(-1).report_payload.first_article_tool === true, "workStart persists all first-article results in existing report_payload JSON");
  check(posts.at(-1).remark.includes("首件檢查完成"), "workStart remark includes first-article completion");
  check(uploads.length === 1, "required workStart photo uploads once");
  await open("workStart");
  check(await page.locator("#firstArticleSize:checked, #firstArticleSurface:checked, #firstArticleTool:checked").count() === 0, "reopening form resets all first-article checks");
  check(await page.locator("#startPhoto").evaluate(input => input.files.length) === 0, "reopening resets captured/file photo");
  await page.locator('[data-report-type="dailyStart"]').click();
  check(await page.locator('[data-report-section="dailyStart"] .checklist-card').count() === 0, "dailyStart has no first-article checklist");
  check((await page.locator('#quantitySection .field-label small').allTextContents()).every(text => text === "選填"), "dailyStart quantity helper labels do not falsely claim additional required fields");
  await page.locator("#completedQty").fill("");
  await page.locator("#defectQty").fill("");
  await page.locator("#machineQty").fill("");
  await submit();
  await page.waitForFunction(() => document.body.textContent.includes("請填寫目前機台已加工數量"));
  check(posts.length === before + 1, "dailyStart still blocks missing machine quantity");
  await page.locator("#machineQty").fill("0");
  await screenshot("daily-start-no-photo");
  await submit();
  await closed();
  check(posts.length === before + 2, "dailyStart with zero quantity and no photo/checklist submits");
  check(!Object.keys(posts.at(-1).report_payload).some(k => k.startsWith("first_article")), "dailyStart omits first-article results");
  check(!posts.at(-1).remark.includes("首件"), "dailyStart does not falsely claim first-article completion");
  check(uploads.length === 1, "dailyStart without photo performs no upload");
  await open("dailyStart");
  await page.locator("#machinePhoto").setInputFiles(photo);
  await submit();
  await closed();
  check(posts.length === before + 3 && uploads.length === 2, "optional dailyStart photo still uploads if supplied");
  await page.setViewportSize({ width: 390, height: 844 });
  await open("workStart");
  await screenshot("work-start-mobile");
  check(await page.locator("#firstArticleTool").isVisible(), "mobile first-article checks visible");
  await context.close();
}
try {
  await scenario(true);
  await scenario(false);
  check(errors.length === 0, "zero JavaScript page errors");
  check(!blocked.some(r => /muditjubqflrqofbkmav|machtile\.com/.test(r.host)), "zero production-domain attempts");
  console.log(`${checks} passed; external requests blocked=${blocked.length}; artifacts=${out}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
