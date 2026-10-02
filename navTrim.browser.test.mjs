// 導覽列精簡（owner 2026-10-02）的瀏覽器端到端測試：
//   上方主選單拿掉「紀錄」、第二排子選單拿掉「機台管理」，入口改由「管理」抽屜（更多功能→紀錄查詢、機台管理群組）進。
// Playwright，手機（Pixel 7、360px）＋平板（810×1080）。不會碰任何真的後端：config.js 換成指向
// 一個不存在的 *.supabase.co 子網域（見 FAKE）的測試設定，Supabase 請求由這支腳本用假資料回應，其他對外請求一律擋掉。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node navTrim.browser.test.mjs            （截圖寫到 ./.e2e-out/nav-trim/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node navTrim.browser.test.mjs
//   NAV_SHOT_TAG=before|after 可替截圖檔名加前綴（改前／改後對照用）。
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.NAV_E2E_OUT || path.join(root, ".e2e-out", "nav-trim");
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

const tag = process.env.NAV_SHOT_TAG ? `${process.env.NAV_SHOT_TAG}-` : "";
const shot = (name) => path.join(outDir, `${tag}${name}.png`);

// 一排導覽的幾何：項目數、欄數、每格寬度是否平均、有沒有空洞（最後一格右緣要貼齊容器內緣）、有沒有橫向捲動
async function navGeometry(page, navSel, itemSel) {
  return page.evaluate(([navSel, itemSel]) => {
    const nav = document.querySelector(navSel);
    const cs = getComputedStyle(nav);
    const box = nav.getBoundingClientRect();
    const items = [...nav.querySelectorAll(itemSel)].filter((el) => el.getBoundingClientRect().width > 0);
    const widths = items.map((el) => el.getBoundingClientRect().width);
    const last = items[items.length - 1]?.getBoundingClientRect();
    const innerRight = box.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    return {
      count: items.length,
      cols: cs.gridTemplateColumns.split(" ").filter(Boolean).length,
      spread: widths.length ? Math.max(...widths) - Math.min(...widths) : 0,
      gapRight: last ? innerRight - last.right : 0,
      labels: items.map((el) => (el.querySelector("span")?.textContent || el.textContent).trim()),
      overflow: document.documentElement.scrollWidth - innerWidth,
      navOverflow: nav.scrollWidth - nav.clientWidth,
    };
  }, [navSel, itemSel]);
}

function checkEven(geo, label, expected) {
  ok(geo.count === expected && geo.cols === expected, `${label}：${expected} 個項目、${expected} 欄（${geo.count} 個／${geo.cols} 欄：${geo.labels.join("、")}）`);
  ok(geo.spread <= 1, `${label}：每格一樣寬（差 ${geo.spread.toFixed(2)}px）`);
  ok(Math.abs(geo.gapRight) <= 1, `${label}：最後一格貼齊右邊、沒有空洞（${geo.gapRight.toFixed(2)}px）`);
  ok(geo.overflow <= 1 && geo.navOverflow <= 1, `${label}：沒有橫向捲動（頁 ${geo.overflow}px／列 ${geo.navOverflow}px）`);
}

async function openDrawer(page) {
  if (!(await page.locator("#adminDrawer").isVisible())) await page.locator("#adminDrawerBtn").click();
  await page.locator("#adminDrawer").waitFor({ state: "visible" });
}

const machineModules = [
  ["add", "新增機台"], ["list", "機台列表管理"], ["calendar", "產能日曆與保養"], ["alarm", "警報參數設定"],
];

// 從「管理」抽屜逐一打開：紀錄查詢＋機台管理四頁
async function checkDrawerEntries(page, label) {
  await openDrawer(page);
  ok(await page.locator('[data-drawer-module="__history"]').isVisible(), `${label}：管理抽屜看得到「紀錄查詢」`);
  await page.locator('[data-drawer-module="__history"]').click();
  ok(await page.locator("#historyView").evaluate((el) => el.classList.contains("is-active")), `${label}：管理 → 紀錄查詢 打開紀錄頁`);
  for (const [key, text] of machineModules) {
    await openDrawer(page);
    const item = page.locator(`[data-drawer-module="${key}"]`);
    ok(await item.isVisible() && (await item.innerText()).includes(text), `${label}：管理抽屜看得到「${text}」`);
    await item.click();
    await page.waitForFunction(() => document.getElementById("adminModuleSheet")?.classList.contains("is-open"));
    const content = (await page.locator("#adminModuleContent").innerText()).trim();
    ok(content.length > 0, `${label}：管理 → ${text} 打開管理頁（${(await page.locator("#adminModuleTitle").innerText()).trim()}）`);
    await page.evaluate(() => closeAdminModule());
  }
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const tabletDevice = { ...devices["iPad (gen 7)"], viewport: { width: 810, height: 1080 } };

// ================= tablet =================
console.log("== 平板（810×1080）：上方主選單＋第二排子選單 ==");
{
  const { context, page, errors } = await newPage(browser, tabletDevice);
  await waitLoaded(page);
  const navBottom = await page.evaluate(() => document.querySelector(".desktop-tool-nav").getBoundingClientRect().bottom);
  await page.screenshot({ path: shot("tablet-nav"), clip: { x: 0, y: 0, width: 810, height: Math.ceil(navBottom) + 8 } });
  await page.screenshot({ path: shot("tablet-full") });

  ok(await page.locator('.desktop-nav [data-view="history"]').count() === 0, "主選單沒有「紀錄」");
  ok(await page.locator('.desktop-nav [data-view="reports"]').isVisible(), "主選單「分析」保留");
  checkEven(await navGeometry(page, ".desktop-nav", ".nav-item"), "平板主選單", 4);
  ok(await page.locator('.desktop-tool-nav [data-admin-module="list"]').count() === 0, "子選單沒有「機台管理」");
  ok(await page.locator(".desktop-tool-nav [data-open-admin-drawer]").isVisible(), "子選單「管理」保留");
  checkEven(await navGeometry(page, ".desktop-tool-nav", ".tool-nav-item"), "平板子選單", 4);

  // 子選單「管理」→ 抽屜
  await page.locator(".desktop-tool-nav [data-open-admin-drawer]").click();
  ok(await page.locator("#adminDrawer").isVisible(), "子選單「管理」打開管理抽屜");
  await checkDrawerEntries(page, "平板");

  // 程式內切換照常
  await page.evaluate(() => switchView("dashboard"));
  await page.evaluate(() => switchView("history"));
  ok(await page.locator("#historyView").evaluate((el) => el.classList.contains("is-active")), "程式 switchView(\"history\") 照常打開紀錄頁");
  ok(await page.locator(".desktop-nav .nav-item.active").count() === 0, "紀錄頁時主選單沒有亮錯項目");
  await page.evaluate(() => openAdminModule("list"));
  ok(await page.locator("#adminModuleSheet").evaluate((el) => el.classList.contains("is-open")), "程式 openAdminModule(\"list\") 照常打開機台列表管理");
  await page.evaluate(() => closeAdminModule());
  await page.locator('.desktop-nav [data-view="reports"]').click();
  ok(await page.locator("#reportsView").evaluate((el) => el.classList.contains("is-active")), "主選單「分析」照常");
  ok(realErrors(errors).length === 0, "平板沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= old URL =================
console.log("== 舊網址 ?view=history 照常 ==");
{
  const { context, page, errors } = await newPage(browser, tabletDevice);
  await page.goto(`${base}?view=history`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
  await page.waitForFunction(() => document.getElementById("historyView")?.classList.contains("is-active"), null, { timeout: 10000 }).catch(() => {});
  ok(await page.locator("#historyView").evaluate((el) => el.classList.contains("is-active")), "直接開 ?view=history 進到紀錄頁");
  ok(realErrors(errors).length === 0, "舊網址沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= phone =================
for (const [label, device, name] of [
  ["手機（Pixel 7）", devices["Pixel 7"], "phone"],
  ["手機（360px）", { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } }, "phone360"],
]) {
  console.log(`== ${label}：底部分頁＋管理抽屜 ==`);
  const { context, page, errors } = await newPage(browser, device);
  await waitLoaded(page);
  await page.screenshot({ path: shot(`${name}-full`) });
  await page.locator(".mobile-tabs").screenshot({ path: shot(`${name}-tabs`) });
  ok(!(await page.locator(".desktop-nav").isVisible()) && !(await page.locator(".desktop-tool-nav").isVisible()), `${label}：上方兩排在手機本來就收起`);
  ok(await page.locator('.mobile-tabs [data-view="history"], .mobile-tabs [data-admin-module="list"]').count() === 0, `${label}：底部分頁沒有「紀錄」「機台管理」`);
  checkEven(await navGeometry(page, ".mobile-tabs", ".mobile-tab"), `${label}底部分頁`, 6);
  await page.locator(".mobile-tab[data-open-admin-drawer]").click();
  ok(await page.locator("#adminDrawer").isVisible(), `${label}：「更多」打開管理抽屜`);
  await page.locator("#adminDrawer").screenshot({ path: shot(`${name}-drawer`) });
  await checkDrawerEntries(page, label);
  ok(realErrors(errors).length === 0, `${label}：沒有 JS 錯誤`, realErrors(errors).join(" | "));
  await context.close();
}

// ================= roles =================
console.log("== 角色：作業員也能從管理抽屜進紀錄查詢與機台管理 ==");
for (const role of ["operator", "planner", "manager", "admin"]) {
  const { context, page } = await newPage(browser, tabletDevice, { role });
  await waitLoaded(page);
  ok(await page.locator(".desktop-tool-nav [data-open-admin-drawer]").isVisible() && await page.locator("#adminDrawerBtn").isVisible(), `${role}：看得到「管理」與右上角選單鈕`);
  await openDrawer(page);
  const visible = async (k) => page.locator(`[data-drawer-module="${k}"]`).isVisible();
  ok(await visible("__history") && await visible("list") && await visible("add") && await visible("calendar") && await visible("alarm"), `${role}：抽屜有紀錄查詢＋機台管理四項`);
  if (role === "operator") await page.locator("#adminDrawer").screenshot({ path: shot("tablet-operator-drawer") });
  await page.locator('[data-drawer-module="__history"]').click();
  ok(await page.locator("#historyView").evaluate((el) => el.classList.contains("is-active")), `${role}：從抽屜進得了紀錄頁`);
  await context.close();
}

await browser.close();
server.close();

const prodHits = [...blocked, ...seen].filter((u) => u.includes("muditjubqflrqofbkmav") || u.includes("machtile.com"));
ok(prodHits.length === 0, "沒有任何請求打到正式後端／正式網域", prodHits.join(" "));
console.log(`  (blocked external requests: ${blocked.length}${blocked.length ? " e.g. " + [...new Set(blocked.map((u) => new URL(u).host))].join(",") : ""})`);
console.log(`\n${pass} passed, ${fail} failed  (screenshots: ${outDir})`);
process.exit(fail ? 1 : 0);
