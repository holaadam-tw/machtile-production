// Monitor 頁的車床／銑床報工入口＋機台卡片完成數（owner 2026-10-02）的瀏覽器端到端測試。
// Playwright，手機（Pixel 7）＋平板（810×1080）。不會碰任何真的後端：config.js 換成指向假網域
// 一個不存在的 *.supabase.co 子網域（見 FAKE）的測試設定，Supabase 請求由這支腳本用假資料回應，其他對外請求一律擋掉。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node monitorEntry.browser.test.mjs            （截圖寫到 ./.e2e-out/monitor/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node monitorEntry.browser.test.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MONITOR_E2E_OUT || path.join(root, ".e2e-out", "monitor");
const modSpec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const pw = await import(modSpec);
const { chromium, devices } = pw.default || pw;

let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "\n        " + extra : "")); }
}

// ---------- static server ----------
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---------- fixtures（假資料）----------
// 假專案網址：卡片牆的 B01/B02 會建 HMC 品號目錄，目錄只接受 *.supabase.co 形式的網址（否則整面卡片牆
// 渲染失敗；子網域須 20 個英數字）。所以這裡用一個不存在的 *.supabase.co 子網域；所有對它的請求都在瀏覽器內被攔下、用假資料回應，
// 不會真的連線。正式專案 ref 另外檢查一次絕對沒有出現。
const FAKE = "https://e2efakeprojectzzzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const users = [
  { id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) },
  { id: id(902), name: "李大華", legacy_user_id: "1021101" },
];
const card = (n, wo, machine, status, extra = {}) => ({
  id: id(100 + n), tenant_id: T, work_order_no: wo, customer_name: "測試客戶", part_name: `零件${n}`, drawing_no: `DWG-${n}`,
  quantity: 400, due_date: "2026-10-20", priority: "normal", work_order_status: "in_progress",
  current_process_id: id(300 + n), current_process_name: machine.startsWith("A") ? "車削" : "銑削",
  current_process_status: status, machine_name: machine, qty_completed: 0, qty_defect: 0, progress_percent: 0,
  last_report_at: null, open_risk_level: null, current_process_off_station: false, ...extra,
});
const cards = [
  card(1, "XX01202609020008", "A01", "running", { quantity: 5000, qty_completed: 0 }), // 舊 MES 3440、App 0 → 3440/5000
  card(2, "XX01202609160002", "A02", "running", { qty_completed: 7 }),                  // 舊 MES 尚無結算 → 照 App 7
  card(5, "XX01202609020009", "A05", "running", { qty_completed: 95 }),                 // 舊 MES 110＋待回寫 10 → 120（不加 App 95）
  card(6, "XX01202609170001", "B03", "running", { qty_completed: 3 }),                  // RPC 沒回這道工序 → 照 App 3
  card(8, "XX01202609170004", "B04", "running"),
];
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: { A01: "小瀧澤", A02: "大瀧澤", B03: "大立" }[code] || "", status: "idle", display_order: i, department_name: code.startsWith("A") ? "車床課" : "銑床課",
}));
const progress = {
  [id(301)]: { legacy_output: 3440, legacy_fail: 3, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: ago(60), actual_start_at: ago(600), legacy_synced_at: ago(3) },
  [id(302)]: { legacy_output: null, legacy_fail: null, pending_output: 2, pending_fail: 0, pending_count: 1, oldest_pending_at: ago(10), last_report_at: ago(10), actual_start_at: ago(180), legacy_synced_at: null },
  [id(305)]: { legacy_output: 110, legacy_fail: 1, pending_output: 10, pending_fail: 0, pending_count: 2, oldest_pending_at: ago(20), last_report_at: ago(20), actual_start_at: ago(400), legacy_synced_at: ago(3) },
  [id(308)]: { legacy_output: 67, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: ago(45), actual_start_at: ago(300), legacy_synced_at: ago(3) },
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwtFor = (role) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: users[0].auth, email: "op@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role } })}.sig`;
const testConfig = `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key-for-e2e-only", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: true, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
};`;

const blocked = [];
const seen = [];   // 所有離開本機靜態伺服器的請求網址（含被攔下改用假資料回應的）
function makeBackend({ progressFails = false } = {}) {
  const progressCalls = [];
  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "op@test.invalid" });
    if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
    if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
    if (p === "/rest/v1/app_users") {
      if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: users[0].name }]);
      return json(200, users.map(({ auth, ...u }) => u));
    }
    if (p === "/rest/v1/rpc/batch_report_progress") {
      const body = JSON.parse(req.postData() || "{}");
      progressCalls.push(body);
      if (progressFails) return json(500, { message: "simulated outage" });
      return json(200, (body.p_process_ids || []).filter((pid) => progress[pid]).map((pid) => ({ process_id: pid, ...progress[pid] })));
    }
    if (p.startsWith("/rest/v1/rpc/")) return json(200, null);
    if (p.startsWith("/rest/v1/")) return json(200, []);
    return json(200, {});
  }
  return { handle, progressCalls };
}

async function newPage(browser, device, { role = "operator", progressFails = false } = {}) {
  const backend = makeBackend({ progressFails });
  const context = await browser.newContext({ ...device, serviceWorkers: "block" });
  await context.addInitScript(([token]) => {
    try {
      sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
    } catch {}
  }, [jwtFor(role)]);
  await context.route("**/*", async (route) => {
    const u = route.request().url();
    if (!u.startsWith(base)) seen.push(u);
    if (u.startsWith(FAKE)) return backend.handle(route);
    if (u.startsWith(base)) {
      if (new URL(u).pathname.endsWith("/config.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: testConfig });
      return route.continue();
    }
    blocked.push(u);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, errors, backend };
}

async function waitLoaded(page) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
  await page.locator("#workOrderGrid .machine-tile-card").first().waitFor();
}

const cardFor = (page, code) => page.locator("#workOrderGrid .machine-tile-card").filter({ has: page.locator("h2", { hasText: code }) }).first();
const metric = async (page, code) => {
  const box = cardFor(page, code).locator(".machine-metrics > div").first();
  return { value: (await box.locator("strong").innerText()).trim(), note: (await box.locator(".machine-progress-source").count()) ? (await box.locator(".machine-progress-source").innerText()).trim() : "" };
};
const realErrors = (errors) => errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));

async function checkEntryGeometry(page, label) {
  const geo = await page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height, width: b.width, visible: b.width > 0 && b.height > 0 }; };
    const title = r(document.getElementById("dashboardTitle"));
    const lathe = r(document.querySelector('#dashboardView [data-monitor-batch-entry="lathe"]'));
    const mill = r(document.querySelector('#dashboardView [data-monitor-batch-entry="mill"]'));
    const report = r(document.querySelector("#dashboardView .view-heading [data-open-report]"));
    const stats = r(document.getElementById("statsGrid"));
    const order = [...document.querySelectorAll("#dashboardView .view-heading button")].map((b) => b.dataset.monitorBatchEntry || (b.hasAttribute("data-open-report") ? "report" : "?"));
    return { title, lathe, mill, report, stats, order, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  ok(JSON.stringify(geo.order) === JSON.stringify(["lathe", "mill", "report"]), `${label}：DOM 順序＝車床、銑床、＋現場回報`, JSON.stringify(geo.order));
  ok(geo.lathe.visible && geo.mill.visible, `${label}：兩顆按鈕看得到`);
  ok(geo.lathe.height >= 44 && geo.mill.height >= 44, `${label}：按鈕夠大（${Math.round(geo.lathe.height)}px）`);
  ok(geo.lathe.bottom <= geo.stats.top + 1, `${label}：按鈕在標題列（統計卡上方）`, JSON.stringify(geo));
  ok(geo.overflow <= 1, `${label}：沒有橫向捲動（${geo.overflow}px）`);
  return geo;
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const tabletDevice = { ...devices["iPad (gen 7)"], viewport: { width: 810, height: 1080 } };

// ================= phone =================
console.log("== 手機（Pixel 7）：Monitor 頁報工入口＋卡片完成數 ==");
{
  const { context, page, errors, backend } = await newPage(browser, devices["Pixel 7"]);
  await waitLoaded(page);
  const geo = await checkEntryGeometry(page, "手機");
  ok(geo.lathe.top >= geo.title.bottom - 1, "手機：按鈕排在標題下面（一整排）", JSON.stringify({ title: geo.title, lathe: geo.lathe }));
  ok(!geo.report.visible && await page.locator(".fab[data-open-report]").isVisible(), "手機：「+ 現場回報」照舊用右下角浮動鈕");
  ok(await page.locator('.mobile-tab[data-view="batchLathe"]').isVisible(), "手機底部「報工」分頁照舊在");
  await page.screenshot({ path: path.join(outDir, "01-phone-monitor-entries.png") });

  // 卡片完成數
  ok(backend.progressCalls.length === 1, `進度只查一次（${backend.progressCalls.length} 次）`);
  const asked = backend.progressCalls[0]?.p_process_ids || [];
  ok(cards.every((c) => asked.includes(c.current_process_id)), "一次帶齊畫面上所有卡片的工序", JSON.stringify(asked));
  const a01 = await metric(page, "A01");
  ok(a01.value === "3440/5000" && a01.note === "含舊 MES", "A01 有舊 MES：3440/5000、標「含舊 MES」", JSON.stringify(a01));
  const a05 = await metric(page, "A05");
  ok(a05.value === "120/400" && a05.note === "含舊 MES・待回寫 10", "A05 舊 MES＋待回寫：110＋10＝120（App 自己的 95 不重複加）", JSON.stringify(a05));
  const a02 = await metric(page, "A02");
  ok(a02.value === "7/400" && a02.note === "舊 MES 尚無資料", "A02 舊 MES 尚無結算：照原本 App 7、標「舊 MES 尚無資料」", JSON.stringify(a02));
  const b03 = await metric(page, "B03");
  ok(b03.value === "3/400" && b03.note === "舊 MES 尚無資料", "B03 RPC 沒回這道工序：照原本 App 3、標尚無資料", JSON.stringify(b03));
  const pctA01 = (await cardFor(page, "A01").locator(".machine-metrics > div").first().locator("small").first().innerText()).trim();
  ok(pctA01 === "69%", `A01 百分比跟著新完成數（${pctA01}）`);
  await cardFor(page, "A01").scrollIntoViewIfNeeded();
  await cardFor(page, "A01").screenshot({ path: path.join(outDir, "02-phone-card-a01-3440.png") });
  await cardFor(page, "A05").screenshot({ path: path.join(outDir, "03-phone-card-a05-pending.png") });
  await cardFor(page, "A02").screenshot({ path: path.join(outDir, "04-phone-card-a02-no-legacy.png") });

  // 點車床 → 批次畫面
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('#dashboardView [data-monitor-batch-entry="lathe"]').click();
  await page.locator('[data-batch-root="lathe"] [data-batch-row="A01"]').waitFor();
  ok(await page.locator("#batchLatheView").evaluate((el) => el.classList.contains("is-active")), "手機：點「車床報工」打開車床批次畫面");
  ok(await page.locator('[data-batch-root="lathe"] .batch-row').count() === 5, "車床批次畫面五台 A01–A05（行為不變）");
  await page.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled);
  ok((await page.locator('[data-batch-root="lathe"] [data-batch-row="A01"] .batch-done').innerText()).includes("3440"), "批次畫面 A01 已報也是 3440（同一套口徑）");
  await page.screenshot({ path: path.join(outDir, "05-phone-after-click-lathe.png") });
  await page.locator('.mobile-tab[data-view="dashboard"]').click();
  await page.locator('#dashboardView [data-monitor-batch-entry="mill"]').click();
  await page.locator('[data-batch-root="mill"] [data-batch-row="B03"]').waitFor();
  ok(await page.locator("#batchMillView").evaluate((el) => el.classList.contains("is-active")), "手機：點「銑床報工」打開銑床批次畫面");
  await page.locator("#adminDrawerBtn").click();
  ok(await page.locator('[data-drawer-module="__batchLathe"]').isVisible() && await page.locator('[data-drawer-module="__batchMill"]').isVisible(), "「更多」抽屜照舊有車床／銑床報工入口");
  ok(realErrors(errors).length === 0, "手機沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= tablet =================
console.log("== 平板（810×1080）：Monitor 頁報工入口 ==");
{
  const { context, page, errors } = await newPage(browser, tabletDevice);
  await waitLoaded(page);
  const geo = await checkEntryGeometry(page, "平板");
  ok(geo.report.visible && geo.lathe.top >= geo.title.bottom - 1 && Math.abs(geo.lathe.top - geo.report.top) < 2 && geo.lathe.right <= geo.mill.left + 1 && geo.mill.right <= geo.report.left + 1, "平板：標題下面一排：車床 → 銑床 → ＋現場回報", JSON.stringify(geo));
  ok(await page.locator('.nav-item[data-view="batchLathe"], .nav-item[data-view="batchMill"]').count() === 0, "上方導覽列不再有車床／銑床報工");
  const navCols = await page.evaluate(() => getComputedStyle(document.querySelector(".desktop-nav")).gridTemplateColumns.split(" ").length);
  ok(navCols === 5 && await page.locator(".desktop-nav .nav-item").count() === 5, `上方導覽恢復 5 欄（${navCols}）`);
  ok((await metric(page, "A01")).value === "3440/5000", "平板卡片 A01 也是 3440/5000");
  await page.screenshot({ path: path.join(outDir, "06-tablet-monitor-entries.png") });
  await page.locator('#dashboardView [data-monitor-batch-entry="mill"]').click();
  await page.locator('[data-batch-root="mill"] [data-batch-row="B03"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-batch-root="mill"] [data-batch-refresh]')?.disabled);
  ok(await page.locator('[data-batch-root="mill"] .batch-row').count() === 4, "平板：點「銑床報工」打開銑床批次畫面（B03–B06）");
  await page.screenshot({ path: path.join(outDir, "07-tablet-after-click-mill.png") });
  await page.locator('.nav-item[data-view="dashboard"]').click();
  await page.locator('#dashboardView [data-monitor-batch-entry="lathe"]').click();
  await page.locator('[data-batch-root="lathe"] [data-batch-row="A01"]').waitFor();
  ok(await page.locator("#batchLatheView").evaluate((el) => el.classList.contains("is-active")), "平板：點「車床報工」打開車床批次畫面");
  ok(realErrors(errors).length === 0, "平板沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= roles =================
console.log("== 角色：原本批次報工不分角色，入口一樣都看得到 ==");
for (const role of ["admin", "manager", "planner"]) {
  const { context, page } = await newPage(browser, tabletDevice, { role });
  await waitLoaded(page);
  ok(await page.locator('#dashboardView [data-monitor-batch-entry="lathe"]').isVisible() && await page.locator('#dashboardView [data-monitor-batch-entry="mill"]').isVisible(), `${role}：Monitor 頁看得到兩顆入口`);
  await context.close();
}

// ================= RPC failure =================
console.log("== batch_report_progress 失敗：照原本算法、標尚無資料、整頁不壞 ==");
{
  const { context, page, errors, backend } = await newPage(browser, devices["Pixel 7"], { progressFails: true });
  await waitLoaded(page);
  ok(backend.progressCalls.length >= 1, "有嘗試查進度");
  const a01 = await metric(page, "A01");
  ok(a01.value === "0/5000" && a01.note === "舊 MES 尚無資料", "A01 讀不到 → 照 App 0/5000、標「舊 MES 尚無資料」（不顯示假數字）", JSON.stringify(a01));
  const a05 = await metric(page, "A05");
  ok(a05.value === "95/400" && a05.note === "舊 MES 尚無資料", "A05 讀不到 → 照 App 95", JSON.stringify(a05));
  ok(await page.locator("#workOrderGrid .machine-tile-card").count() >= 5, "卡片牆照常顯示");
  await cardFor(page, "A01").screenshot({ path: path.join(outDir, "08-phone-card-rpc-failed.png") });
  ok(realErrors(errors).length === 0, "RPC 失敗時沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

await browser.close();
server.close();

const prodHits = [...blocked, ...seen].filter((u) => u.includes("muditjubqflrqofbkmav") || u.includes("machtile.com"));
ok(prodHits.length === 0, "沒有任何請求打到正式後端／正式網域", prodHits.join(" "));
console.log(`  (blocked external requests: ${blocked.length}${blocked.length ? " e.g. " + [...new Set(blocked.map((u) => new URL(u).host))].join(",") : ""})`);
console.log(`\n${pass} passed, ${fail} failed  (screenshots: ${outDir})`);
process.exit(fail ? 1 : 0);
