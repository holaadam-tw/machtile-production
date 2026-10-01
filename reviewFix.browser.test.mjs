// 2026-10-02 獨立驗收修正的瀏覽器測試（Playwright，手機模擬；不碰任何真的後端）。
// 1. 單台報工的 started_at 也看伺服器上這道工序最後一次報工（任何裝置）：手機批次報工之後，
//    平板單台報工不再把同一段時間重報一次（工時重複＝CT／每人產值灌水）。
// 2. 伺服器讀不到（離線／逾時）→ 照舊只用本機 ledger；本機沒有 ledger 但伺服器有 → 用伺服器時間。
// 3. 手機登入徽章（帳號小按鈕）跟著頁首捲走，不再浮在下面的報工欄位上。
//
// 跑法同 batchReport.browser.test.mjs：
//   MACHTILE_PLAYWRIGHT_MODULE=<playwright/index.js> node reviewFix.browser.test.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const modSpec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const pw = await import(modSpec);
const { chromium, devices } = pw.default || pw;

let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "\n        " + extra : "")); }
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const FAKE = "https://fake-supabase.test";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const users = [
  { id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) },
  { id: id(902), name: "李大華", legacy_user_id: "1021101" },
];
const card = (n, wo, machine) => ({
  id: id(100 + n), tenant_id: T, work_order_no: wo, customer_name: "測試客戶", part_name: `零件${n}`, drawing_no: `DWG-${n}`,
  quantity: 400, due_date: "2026-10-20", priority: "normal", work_order_status: "in_progress",
  current_process_id: id(300 + n), current_process_name: "車削", current_process_status: "running",
  machine_name: machine, qty_completed: 100, qty_defect: 0, progress_percent: 25,
  last_report_at: null, open_risk_level: null, current_process_off_station: false,
});
const cards = [card(1, "WO-A01", "A01"), card(2, "WO-A02", "A02"), card(5, "WO-A05", "A05")];
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: "", status: "idle", display_order: i,
}));
const reports = [];         // what the fake server has stored (for production_reports GET)
reports.push({ process_id: id(301), ended_at: ago(240), created_at: ago(240) });
reports.push({ process_id: id(302), ended_at: ago(300), created_at: ago(300) });
const calls = [];
const blocked = [];
let failReportsRead = false;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: users[0].auth, email: "op@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const testConfig = `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: true, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false };`;

async function handleFake(r) {
  const req = r.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const json = (status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "op@test.invalid" });
  if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
  if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
  if (p === "/rest/v1/app_users") {
    if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: users[0].name, legacy_user_id: users[0].legacy_user_id }]);
    return json(200, users.map(({ auth, ...u }) => u));
  }
  if (p === "/rest/v1/production_reports" && req.method() === "GET") {
    if (failReportsRead) return r.abort();
    const pid = (url.searchParams.get("process_id") || "").replace(/^eq\./, "");
    return json(200, reports.filter((x) => x.process_id === pid).slice().reverse());
  }
  if (p === "/rest/v1/rpc/batch_report_progress") {
    const body = JSON.parse(req.postData() || "{}");
    return json(200, (body.p_process_ids || []).map((pid) => {
      const mine = reports.filter((x) => x.process_id === pid).map((x) => x.ended_at || x.created_at).sort();
      return { process_id: pid, legacy_output: 100, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: mine[mine.length - 1] || null, actual_start_at: ago(600), legacy_synced_at: ago(2) };
    }));
  }
  if (p === "/rest/v1/rpc/field_report_upsert") {
    const body = JSON.parse(req.postData() || "{}");
    calls.push(body);
    const pl = body.p_payload || {};
    reports.push({ process_id: pl.process_id, ended_at: pl.ended_at || null, created_at: new Date().toISOString() });
    return json(200, { report_id: id(7000 + calls.length), inserted: true });
  }
  if (p.startsWith("/rest/v1/rpc/")) return json(200, null);
  if (p.startsWith("/rest/v1/")) return json(200, []);
  return json(200, {});
}

async function newPage(browser, device, ledger) {
  const context = await browser.newContext({ ...device, serviceWorkers: "block" });
  await context.addInitScript(([token, ledgerJson]) => {
    try {
      sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
      if (ledgerJson && !localStorage.getItem("__seeded")) { localStorage.setItem("machtile-outbox-started-at", ledgerJson); localStorage.setItem("__seeded", "1"); }
    } catch {}
  }, [jwt, ledger ? JSON.stringify(ledger) : null]);
  await context.route("**/*", async (route) => {
    const u = route.request().url();
    if (u.startsWith(FAKE)) return handleFake(route);
    if (u.startsWith(base)) {
      if (new URL(u).pathname.endsWith("/config.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: testConfig });
      return route.continue();
    }
    blocked.push(u);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  return { context, page };
}
async function waitLoaded(page) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
}
// single report on the first card (A01) via the phone ＋回報 sheet
async function singleNoonReport(page, qty) {
  await page.locator(".fab[data-open-report]").click();
  await page.locator('.report-type-tab[data-report-type="noon"]').click();
  await page.locator("#completedQty").fill(String(qty));
  await page.locator("#machtileOperatorList input[type=checkbox]").first().check().catch(() => {});
  const before = calls.length;
  await page.evaluate(() => document.getElementById("reportForm").requestSubmit());
  for (let i = 0; i < 60 && calls.length === before; i++) await page.waitForTimeout(100);
  return calls[before]?.p_payload || null;
}

const browser = await chromium.launch();
try {
  console.log("== 1. 手機批次報工後，另一台裝置單台報工不重疊 ==");
  {
    const phone = await newPage(browser, devices["Pixel 7"]);
    await waitLoaded(phone.page);
    await phone.page.locator('.mobile-tab[data-view="batchLathe"]').click();
    const root = phone.page.locator('[data-batch-root="lathe"]');
    await root.locator('[data-batch-row="A01"]').waitFor();
    await phone.page.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled);
    await root.locator('[data-batch-good="A01"]').fill("5");
    await root.locator('[data-batch-operator="A01"]').selectOption(id(901));
    await root.locator("[data-batch-submit]").click();
    await phone.page.waitForFunction(() => document.querySelector('[data-batch-root="lathe"] [data-batch-row="A01"] .batch-result.is-sent'), null, { timeout: 15000 });
    const batch = calls[calls.length - 1].p_payload;
    ok(batch.report_type === "batch" && batch.started_at === ago(240), "手機批次報工 A01：started_at＝伺服器上次報工", batch.started_at);
    await phone.context.close();

    // the machine's tablet last reported A01 four hours ago (its own ledger)
    const tablet = await newPage(browser, devices["Galaxy S9+"], { [id(301)]: ago(240) });
    await waitLoaded(tablet.page);
    const single = await singleNoonReport(tablet.page, 4);
    ok(Boolean(single), "平板單台報工送出");
    ok(single && single.started_at === batch.ended_at, "平板單台報工 started_at＝手機批次報工的 ended_at（時段接續、不重疊）", `${single?.started_at} vs ${batch.ended_at}`);
    ok(single && Date.parse(single.ended_at) >= Date.parse(single.started_at), "ended_at ≥ started_at");
    ok(single && single.completed_qty === 4, "數量仍是增量 4");
    await tablet.context.close();
  }

  console.log("== 2. 伺服器讀不到 → 照舊只用本機 ledger；本機沒 ledger → 用伺服器時間 ==");
  {
    failReportsRead = true;
    const t = await newPage(browser, devices["Galaxy S9+"], { [id(301)]: ago(30) });
    await waitLoaded(t.page);
    const pl = await singleNoonReport(t.page, 2);
    ok(pl && pl.started_at === ago(30), "讀不到伺服器：started_at＝本機 ledger（行為與修正前相同）", pl?.started_at);
    await t.context.close();
    failReportsRead = false;

    const n = await newPage(browser, devices["Galaxy S9+"], null);
    await waitLoaded(n.page);
    const last = reports.filter((x) => x.process_id === id(301)).map((x) => x.ended_at || x.created_at).sort().pop();
    const pl2 = await singleNoonReport(n.page, 1);
    ok(pl2 && pl2.started_at === new Date(Date.parse(last)).toISOString(), "新裝置（本機沒有 ledger）：started_at＝伺服器上次報工，不再是空值被回寫橋退件", `${pl2?.started_at} vs ${last}`);
    await n.context.close();
  }

  console.log("== 3. 手機帳號小按鈕跟著頁首捲走 ==");
  {
    const { context, page } = await newPage(browser, devices["Pixel 7"]);
    await waitLoaded(page);
    await page.locator('.mobile-tab[data-view="batchLathe"]').click();
    await page.locator('[data-batch-root="lathe"] [data-batch-row="A05"]').waitFor();
    const topAt0 = await page.evaluate(() => document.querySelector("[data-machtile-session-toggle]").getBoundingClientRect().top);
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(200);
    const topAt800 = await page.evaluate(() => document.querySelector("[data-machtile-session-toggle]").getBoundingClientRect().top);
    ok(topAt0 >= 0 && topAt0 < 80, "未捲動：小按鈕在頁首", String(topAt0));
    ok(topAt800 < 0, "捲動 800px 後小按鈕已捲出畫面（不再浮在報工欄位上）", String(topAt800));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("[data-machtile-session-toggle]").click();
    ok(await page.locator("[data-machtile-logout]").isVisible(), "展開後登出看得到");
    await context.close();
  }
  ok(blocked.filter((u) => /supabase\.co|machtile\.com/.test(u)).length === 0, "沒有任何請求打到正式後端／正式網域", JSON.stringify(blocked.slice(0, 5)));
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
