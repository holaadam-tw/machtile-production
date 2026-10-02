// Monitor 機台卡片：點「機台加工時間」直接填、今日開工狀態、每日估算（上下料）——瀏覽器端到端測試（Playwright，手機＋平板）。
// 不會碰任何真的後端：config.js 換成指向假專案網域（e2ecardestimatezzzzz.supabase.co）的測試設定，所有 Supabase 請求由這支腳本攔截、
// 用假資料回應；其他對外請求一律擋掉並記錄（最後斷言一次都沒有打到正式專案）。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node cardEstimate.browser.test.mjs            （截圖寫到 ./.e2e-out/card-estimate/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node cardEstimate.browser.test.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.CARD_E2E_OUT || path.join(root, ".e2e-out", "card-estimate");
const modSpec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const pw = await import(modSpec);
const { chromium, devices } = pw.default || pw;

let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "\n        " + extra : "")); }
}

// ---------- static server for the repo ----------
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

// ---------- fixtures ----------
// 假專案網域要長得像 *.supabase.co（HMC 品號目錄會檢查網址格式），但所有請求都被下面的 route 攔截，不會出網
const FAKE = "https://e2ecardestimatezzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
// 台灣「今天」幾點幾分 → ISO（台灣固定 +08:00）
const taipeiDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
const todayAt = (hhmm) => new Date(`${taipeiDate}T${hhmm}:00+08:00`).toISOString();
const yesterdayAt = (hhmm) => new Date(Date.parse(todayAt(hhmm)) - 86400000).toISOString();

const users = [
  { id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) },   // the signed-in person
  { id: id(902), name: "李大華", legacy_user_id: "1021101" },
  { id: id(903), name: "B03站別", legacy_user_id: "" },
];
const card = (n, wo, machine, status, extra = {}) => ({
  id: id(100 + n), tenant_id: T, work_order_no: wo, customer_name: "測試客戶", part_name: `零件${n}`, drawing_no: null,
  quantity: 400, due_date: "2026-10-20", priority: "normal", work_order_status: "in_progress",
  current_process_id: id(300 + n), current_process_name: machine.startsWith("A") ? "車削" : "銑削",
  current_process_status: status, machine_name: machine, qty_completed: 0, qty_defect: 0, progress_percent: 0,
  last_report_at: ago(30), open_risk_level: null, current_process_off_station: false, ...extra,
});
const cards = [
  card(1, "XX01202609020008", "A01", "running"),
  card(2, "XX01202609160002", "A02", "pending", { last_report_at: null }),
  card(4, "XX01202604140011", "A04", "running"),
  card(6, "XX01202609170001", "B03", "running"),
  card(10, "XX01202609290004", "B01", "running"),
];
// 正式庫幾乎每張單只有品號、沒有圖號：v_work_order_cards 沒有 part_no → App 另外讀 work_orders 補
const partNo = { [id(101)]: "MPW-01-03", [id(102)]: "P16-R01-09", [id(104)]: "CPDG-03-01", [id(106)]: "DSHG-04-02", [id(110)]: "SBSG-03-01" };
const workOrders = cards.map((c) => ({ id: c.id, drawing_no: null, part_no: partNo[c.id], part_name: c.part_name }));
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: { A01: "小瀧澤", A02: "大瀧澤", B03: "大立" }[code] || "", status: "idle", display_order: i,
}));
const progress = {
  [id(301)]: { legacy_output: 110, legacy_fail: 1, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: ago(60), actual_start_at: ago(300), legacy_synced_at: ago(3) },
  [id(302)]: { legacy_output: null, legacy_fail: null, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: null, actual_start_at: null, legacy_synced_at: null },
  [id(304)]: { legacy_output: 0, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: ago(20), actual_start_at: ago(400), legacy_synced_at: ago(3) },
  [id(306)]: { legacy_output: 0, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: ago(15), actual_start_at: null, legacy_synced_at: ago(3) },
};
const t0 = "2026-09-20T00:00:00.000Z";
const after = (sec) => new Date(Date.parse(t0) + sec * 1000).toISOString();
const wop = (name) => ({ process_name: name });
const prodA01 = { drawing_no: null, part_no: "MPW-01-03", part_name: "零件1" };
// 機台加工時間（latestMachineTimeByProcess）：A01＝95 秒、A04＝100 秒、B03＝600 秒、B01＝300 秒
const machineTimeRows = [
  { process_id: id(301), cycle_time_seconds: 95, created_at: "2026-09-20T00:00:00Z" },
  { process_id: id(304), cycle_time_seconds: 100, created_at: "2026-09-20T00:00:00Z" },
  { process_id: id(306), cycle_time_seconds: 600, created_at: "2026-09-20T00:00:00Z" },
  { process_id: id(310), cycle_time_seconds: 300, created_at: "2026-09-20T00:00:00Z" },
];
// 上下料校正樣本：A01 這張單（機台 95 秒）＋同產品同工序、已完工的舊單 id(399)（機台 150 秒）
//   上下料樣本：65、105（A01）、110、2850（舊單，後者跨午休）→ 中位數 107.5 → 108 秒（1分48秒），實績 4 次
//   實際每件時間：160、200、260、3000 → 中位數 230 秒 → 實際約 25800/230 = 112 個／天
//   每日估算：25800 /（95＋108）＝ 127 件
// A04：同產品只有 2 筆 → 用車床預設 60 秒；每日估算 25800/(100+60) = 161；實際每件只有 2 筆 → 不顯示實際約
const calibrationRows = [
  { process_id: id(301), cycle_time_seconds: 95, created_at: "2026-09-20T00:00:00Z", completed_qty: 0, defect_qty: 0, started_at: t0, ended_at: t0, work_order_processes: wop("車削"), work_orders: prodA01 },
  { process_id: id(301), created_at: "2026-09-20T01:00:00Z", completed_qty: 10, defect_qty: 0, started_at: t0, ended_at: after(1600), work_order_processes: wop("車削"), work_orders: prodA01 },
  { process_id: id(301), created_at: "2026-09-20T02:00:00Z", completed_qty: 9, defect_qty: 1, started_at: t0, ended_at: after(2000), work_order_processes: wop("車削"), work_orders: prodA01 },
  { process_id: id(399), cycle_time_seconds: 150, created_at: "2026-09-10T00:00:00Z", completed_qty: 5, defect_qty: 0, started_at: t0, ended_at: after(1300), work_order_processes: wop("車削"), work_orders: prodA01 },
  { process_id: id(399), created_at: "2026-09-10T01:00:00Z", completed_qty: 2, defect_qty: 0, started_at: t0, ended_at: after(6000), work_order_processes: wop("車削"), work_orders: prodA01 },
  // 每件 > 1 小時（跨夜）→ 排除
  { process_id: id(399), created_at: "2026-09-10T02:00:00Z", completed_qty: 1, defect_qty: 0, started_at: t0, ended_at: after(5000), work_order_processes: wop("車削"), work_orders: prodA01 },
  // 推算 < 0（每件 120 秒 < 機台 150 秒）→ 整筆排除
  { process_id: id(399), created_at: "2026-09-10T03:00:00Z", completed_qty: 5, defect_qty: 0, started_at: t0, ended_at: after(600), work_order_processes: wop("車削"), work_orders: prodA01 },
  { process_id: id(304), cycle_time_seconds: 100, created_at: "2026-09-20T00:00:00Z", completed_qty: 0, defect_qty: 0, started_at: t0, ended_at: t0, work_order_processes: wop("車削"), work_orders: { part_no: "CPDG-03-01", part_name: "零件4" } },
  { process_id: id(304), created_at: "2026-09-20T01:00:00Z", completed_qty: 4, defect_qty: 0, started_at: t0, ended_at: after(720), work_order_processes: wop("車削"), work_orders: { part_no: "CPDG-03-01", part_name: "零件4" } },
  { process_id: id(304), created_at: "2026-09-20T02:00:00Z", completed_qty: 5, defect_qty: 0, started_at: t0, ended_at: after(1000), work_order_processes: wop("車削"), work_orders: { part_no: "CPDG-03-01", part_name: "零件4" } },
];
// 今日開工狀態：A01 今天 08:05 王小明開工（operator_ids）；A04 今天 08:00 開工、17:00 收工；A02 昨天開工（不算）；B03 沒有
const todayRows = [
  { process_id: id(301), report_type: "dailyStart", ended_at: todayAt("08:05"), created_at: todayAt("08:05"), user_id: users[1].id, operator_ids: [users[0].id] },
  { process_id: id(304), report_type: "dailyStart", ended_at: todayAt("08:00"), created_at: todayAt("08:00"), user_id: users[1].id, operator_ids: [users[1].id] },
  { process_id: id(304), report_type: "finish", ended_at: todayAt("17:00"), created_at: todayAt("17:00"), user_id: users[1].id, operator_ids: [users[1].id] },
  { process_id: id(302), report_type: "dailyStart", ended_at: yesterdayAt("23:50"), created_at: yesterdayAt("23:50"), user_id: users[1].id, operator_ids: [users[1].id] },
];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: users[0].auth, email: "op@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const testConfig = `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key-for-e2e-only", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: true, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
};`;

// ---------- fake backend ----------
function makeBackend(opts = {}) {
  const b = { calls: [], inserted: new Map(), failNext: 0, reads: [] };
  b.handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const q = decodeURIComponent(url.search);
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "op@test.invalid" });
    if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
    if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
    if (p === "/rest/v1/app_users") {
      const list = users.map(({ auth, ...u }) => (opts.actorUnmapped && u.id === users[0].id ? { ...u, legacy_user_id: "" } : u));
      if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: users[0].name }]);
      return json(200, list);
    }
    if (p === "/rest/v1/work_orders") {
      b.reads.push("work_orders");
      if (opts.failReads) return json(500, { message: "simulated outage" });
      return json(200, workOrders);
    }
    if (p === "/rest/v1/production_reports") {
      if (q.includes("report_type=in.(dailyStart,finish)")) {
        b.reads.push("today");
        if (opts.failReads) return json(500, { message: "simulated outage" });
        return json(200, todayRows);
      }
      if (q.includes("or=(completed_qty.gt.0")) {
        b.reads.push("calibration");
        if (opts.failReads) return json(500, { message: "simulated outage" });
        return json(200, calibrationRows);
      }
      if (q.includes("cycle_time_seconds=not.is.null")) return json(200, machineTimeRows);
      return json(200, []);
    }
    if (p === "/rest/v1/rpc/batch_report_progress") {
      const body = JSON.parse(req.postData() || "{}");
      return json(200, (body.p_process_ids || []).filter((pid) => progress[pid]).map((pid) => ({ process_id: pid, ...progress[pid] })));
    }
    if (p === "/rest/v1/rpc/field_report_upsert") {
      const body = JSON.parse(req.postData() || "{}");
      b.calls.push(body);
      if (b.failNext > 0) { b.failNext -= 1; return json(400, { message: "simulated permanent rejection" }); }
      if (b.inserted.has(body.p_report_uuid)) return json(200, { report_id: id(7000), inserted: false });
      b.inserted.set(body.p_report_uuid, body.p_payload);
      return json(200, { report_id: id(7000 + b.inserted.size), inserted: true });
    }
    if (p.startsWith("/rest/v1/rpc/")) return json(200, null);
    if (p.startsWith("/rest/v1/")) return json(200, []);
    return json(200, {});
  };
  return b;
}

const blocked = [];
async function newPage(browser, device, backend) {
  const context = await browser.newContext({ ...device, serviceWorkers: "block" });
  await context.addInitScript(([token]) => {
    try {
      sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
    } catch {}
  }, [jwt]);
  await context.route("**/*", async (route) => {
    const u = route.request().url();
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
  if (process.env.CARD_DEBUG) page.on("console", (m) => { if (m.type() !== "log") console.log("CONSOLE", m.type(), m.text().slice(0, 300)); });
  page.on("pageerror", (e) => { errors.push(String(e)); if (process.env.CARD_DEBUG) console.log("PAGEERROR", String(e)); });
  return { context, page, errors };
}

async function waitLoaded(page) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid .machine-tile-card").length > 0, null, { timeout: 20000 }).catch(async (e) => {
    console.log("    cards never rendered:", await page.evaluate(() => JSON.stringify({ grid: document.getElementById("workOrderGrid")?.outerHTML.slice(0, 300), orders: state.workOrders.length,  machines: state.machines.length, src: state.source, dash: document.getElementById("dashboardView")?.innerText.slice(0, 400) })));
    throw e;
  });
}

const cardOf = (page, code) => page.locator("#workOrderGrid .machine-tile-card").filter({ has: page.locator("h2", { hasText: code }) }).first();
const realErrors = (errors) => errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

// ================= phone：估算＋今日狀態＋點卡片填時間 =================
console.log("== 手機（Pixel 7）==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"], be);
  await waitLoaded(page);
  const a01 = cardOf(page, "A01");
  const grid = async (code) => cardOf(page, code).locator(".cycle-mini-grid").innerText();

  console.log("-- 每日估算 --");
  ok((await grid("A01")).match(/每日估算\s*\n?\s*127 件/), "A01：25800 ÷（95＋實績上下料 108）＝ 127 件", await grid("A01"));
  ok((await grid("A01")).includes("上下料 1分48秒（實績 4 次）"), "A01：上下料標明實績、次數（中位數，跨單累積，排除 < 0 與 > 1 小時）", await grid("A01"));
  ok((await grid("A01")).includes("實際約 112 個／天"), "A01：實際約 112 個／天（實際每件中位數 230 秒）", await grid("A01"));
  ok((await grid("A04")).match(/每日估算\s*\n?\s*161 件/) && (await grid("A04")).includes("上下料 1分（預設）"), "A04：同產品只有 2 筆 → 車床預設 60 秒，161 件", await grid("A04"));
  ok(!(await grid("A04")).includes("實際約"), "A04：實績只有 2 筆（< 3）→ 不顯示實際約 N 個／天（owner 2026-10-02）", await grid("A04"));
  ok((await grid("B03")).match(/每日估算\s*\n?\s*33 件/) && (await grid("B03")).includes("上下料 3分（預設）"), "B03 銑床：25800 ÷（600＋180）＝ 33 件", await grid("B03"));
  ok(!(await grid("B03")).includes("實際約"), "B03 沒有實績樣本 → 不顯示實際約");
  ok((await grid("B01")).match(/每日估算\s*\n?\s*53 件/) && (await grid("B01")).includes("上下料 3分（預設）"), "B01 臥式：暫用銑床 180 秒（25800 ÷ 480 ＝ 53）", await grid("B01"));
  ok((await grid("A02")).includes("未填") && (await grid("A02")).match(/每日估算\s*\n?\s*-/), "A02 沒填機台加工時間 → 每日估算「-」", await grid("A02"));
  ok(be.reads.includes("work_orders") && be.reads.includes("calibration"), "有讀品號與報工樣本（只讀）");

  console.log("-- 今日開工狀態 --");
  const foot = async (code) => cardOf(page, code).locator(".machine-tile-footer > span").first();
  ok((await (await foot("A01")).innerText()) === "今日已開工 08:05・王小明" && await (await foot("A01")).getAttribute("data-today-status") === "started", "A01：今日已開工 08:05・王小明（綠）", await (await foot("A01")).innerText());
  ok((await (await foot("A04")).innerText()) === "今日已收工 17:00" && await (await foot("A04")).getAttribute("data-today-status") === "finished", "A04：先開工後收工 → 今日已收工 17:00", await (await foot("A04")).innerText());
  ok((await (await foot("B03")).innerText()) === "今日尚未開工" && await (await foot("B03")).getAttribute("data-today-status") === "none", "B03：今日尚未開工（灰）");
  ok((await (await foot("A02")).innerText()) === "今日尚未開工", "A02：昨天的開工不算");
  const colors = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".card-today-status")].map((e) => [e.dataset.todayStatus, getComputedStyle(e).color])));
  ok(colors.started === "rgb(21, 128, 61)" && colors.none === "rgb(115, 128, 149)", "顏色：開工綠、未開工灰", JSON.stringify(colors));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `手機沒有橫向捲動（${overflow}px）`);
  await a01.scrollIntoViewIfNeeded();
  await a01.screenshot({ path: path.join(outDir, "01-phone-card-a01.png") });
  await page.screenshot({ path: path.join(outDir, "02-phone-monitor.png"), fullPage: true });

  console.log("-- 權限：不能報工的卡片不能開框 --");
  ok(await cardOf(page, "B01").locator("[data-card-ct-edit]").count() === 0, "B01 臥式多盤（卡片沒有「回報」鈕）→ 機台加工時間只讀");
  ok(await cardOf(page, "A01").locator("[data-card-ct-edit]").count() === 1, "A01 可報工 → 可以點");

  console.log("-- 點卡片填時間 --");
  await a01.locator("[data-card-ct-edit]").click();
  const sheet = page.locator("#cardMachineTimeSheet");
  await sheet.locator("[data-card-ct-save]:not([disabled])").waitFor({ timeout: 10000 });
  ok(await sheet.isVisible(), "點了跳出小框");
  ok(!(await page.locator("#detailSheet").evaluate((e) => e.classList.contains("is-open")).catch(() => false)), "不會順便打開工單明細");
  ok(await page.locator("#cardCtMinutes").inputValue() === "1" && await page.locator("#cardCtSeconds").inputValue() === "35", "預填目前的值 1 分 35 秒");
  ok((await sheet.innerText()).includes("報工人：王小明"), "報工人＝登入者");
  // 沒改就按儲存 → 不送
  await sheet.locator("[data-card-ct-save]").click();
  await page.waitForTimeout(200);
  ok(be.calls.length === 0 && (await sheet.locator("[data-card-ct-error]").innerText()).includes("一樣"), "時間沒變 → 不送、說明原因");
  await page.locator("#cardCtMinutes").fill("1");
  await page.locator("#cardCtSeconds").fill("40");
  ok(await sheet.locator("[data-card-ct-error]").count() === 0, "改了數字 → 上一次的紅字消失");
  await page.screenshot({ path: path.join(outDir, "03-phone-editor.png") });
  be.failNext = 1;   // 第一次伺服器拒收 → 再按一次要沿用同一個 report_uuid
  await sheet.locator("[data-card-ct-save]").click();
  await sheet.locator("[data-card-ct-error]").filter({ hasText: "拒收" }).waitFor({ timeout: 15000 });
  ok(be.calls.length === 1, "第一次送出被拒收", String(be.calls.length));
  ok(await sheet.isVisible(), "失敗時小框不關、保留輸入");
  await sheet.locator("[data-card-ct-save]").click();
  await page.waitForFunction(() => !document.getElementById("cardMachineTimeSheet")?.classList.contains("is-open"), null, { timeout: 15000 });
  ok(be.calls.length === 2 && be.calls[0].p_report_uuid === be.calls[1].p_report_uuid, "重按沿用同一個 report_uuid（冪等）");
  ok(be.inserted.size === 1, `後端只收到 1 筆（${be.inserted.size}）`);
  const sent = be.calls[1].p_payload;
  const last = progress[id(301)].last_report_at;
  ok(sent.completed_qty === 0 && sent.defect_qty === 0 && sent.cycle_time_seconds === 100, "0／0 報工，只帶 cycle_time_seconds＝100", JSON.stringify(sent));
  ok(sent.started_at === last && sent.ended_at === last, "started_at＝ended_at＝上一筆報工的時間（不推進起算點）", `${sent.started_at} / ${sent.ended_at} vs ${last}`);
  ok(sent.user_id === users[0].id && JSON.stringify(sent.operators) === JSON.stringify([users[0].id]), "報工人＝登入者（user_id、operators）");
  ok(sent.report_type === "noon" && sent.report_payload?.cycle_time_seconds === 100 && sent.process_id === id(301) && sent.work_order_id === id(101), "類型與工序正確");
  // payload 跟批次報工「只改時間」逐欄一樣：在頁面裡用批次的 buildReportPayload 以同樣輸入再組一次比對
  const expected = await page.evaluate(([s, uid]) => {
    const core = window.MachTileBatchReportCore;
    const order = { workOrderId: s.work_order_id, processId: s.process_id, tenantId: s.tenant_id, processStatus: s.status_after_report, done: s.report_payload.machine_qty, total: s.report_payload.work_total_qty };
    const row = { mode: "noon", machineCode: "A01", order, good: "", bad: "", ctDefault: 95, ctMinutes: "1", ctSeconds: "40", overtime: "", operatorId: uid, operatorMapped: true, startedAt: s.started_at };
    const built = core.buildReportPayload({ row, actorAppUserId: uid, endedAt: new Date().toISOString(), reportUuid: s.report_uuid, tenantId: s.tenant_id });
    return { ...built.payload, operators: built.operators };
  }, [sent, users[0].id]);
  const norm = (o) => JSON.stringify(Object.keys(o).sort().reduce((a, k) => ({ ...a, [k]: o[k] }), {}));
  ok(norm(expected) === norm(sent), "payload 跟批次報工「只改時間」逐欄相同（同一個 buildReportPayload）", `\n        card  ${norm(sent)}\n        batch ${norm(expected)}`);
  ok((await grid("A01")).includes("1分40秒"), "存完卡片立刻顯示新的值 1分40秒", await grid("A01"));
  ok((await grid("A01")).match(/每日估算\s*\n?\s*124 件/), "每日估算跟著更新：25800 ÷（100＋108）＝ 124", await grid("A01"));
  await cardOf(page, "A01").screenshot({ path: path.join(outDir, "04-phone-card-a01-saved.png") });

  console.log("-- 報工畫面的估算跟卡片一致 --");
  await cardOf(page, "A04").locator("[data-report]").click();
  await page.locator("#reportEstimate").waitFor();
  await page.waitForTimeout(300);
  const est = await page.locator("#reportEstimate").innerText();
  ok(est.includes("每日約 161 件") && est.includes("上下料 1分（預設）"), "報工畫面 A04：每日約 161 件（同卡片），並列出上下料來源", est);
  await page.screenshot({ path: path.join(outDir, "05-phone-report-estimate.png") });
  ok(realErrors(errors).length === 0, "頁面沒有 JS 錯誤（排除假網域觸發的 CATALOG_ENDPOINT_INVALID）", realErrors(errors).join(" | "));
  await context.close();
}

// ================= 沒有對照工號的登入者：只讀 =================
console.log("== 登入者沒有對照舊 MES 工號 → 只讀 ==");
{
  const be = makeBackend({ actorUnmapped: true });
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"], be);
  await waitLoaded(page);
  await cardOf(page, "A01").locator("[data-card-ct-edit]").click();
  const sheet = page.locator("#cardMachineTimeSheet");
  await sheet.locator("[data-card-ct-notice]").waitFor({ timeout: 10000 });
  ok((await sheet.locator("[data-card-ct-notice]").innerText()).includes("對照"), "說明為什麼不能填");
  ok(await sheet.locator("[data-card-ct-save]").isDisabled() && await page.locator("#cardCtMinutes").isDisabled(), "輸入框與儲存都鎖住");
  await page.screenshot({ path: path.join(outDir, "06-phone-editor-readonly.png") });
  await sheet.locator("[data-card-ct-close]").last().click();
  ok(!(await sheet.isVisible()), "取消可以關掉");
  ok(be.calls.length === 0, "沒有送出任何報工");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= 讀取失敗 → 退回原本的顯示 =================
console.log("== 讀取失敗 → 退回原本的顯示 ==");
{
  const be = makeBackend({ failReads: true });
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"], be);
  await waitLoaded(page);
  const footA01 = await cardOf(page, "A01").locator(".machine-tile-footer > span").first().innerText();
  const footA02 = await cardOf(page, "A02").locator(".machine-tile-footer > span").first().innerText();
  ok(footA01 === "30 分鐘前", "A01 底部退回原本的「最後回報」", footA01);
  ok(footA02 === "尚未回報", "A02 底部退回原本的「尚未回報」", footA02);
  ok(await page.locator(".card-today-status").count() === 0, "沒有任何今日狀態標籤");
  const g = await cardOf(page, "A01").locator(".cycle-mini-grid").innerText();
  ok(g.match(/每日估算\s*\n?\s*166 件/) && g.includes("上下料 1分（預設）"), "樣本讀不到 → 用車床預設 60 秒（25800 ÷（95＋60）＝ 166）", g);
  ok(realErrors(errors).length === 0, "頁面沒有壞（沒有 JS 錯誤）", realErrors(errors).join(" | "));
  await page.screenshot({ path: path.join(outDir, "07-phone-read-failed.png"), fullPage: true });
  await context.close();
}

// ================= 平板 =================
console.log("== 平板（iPad 810×1080）==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, { ...devices["iPad (gen 7)"], defaultBrowserType: undefined }, be);
  await waitLoaded(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `平板沒有橫向捲動（${overflow}px）`);
  await page.screenshot({ path: path.join(outDir, "08-tablet-monitor.png"), fullPage: false });
  await cardOf(page, "B03").locator("[data-card-ct-edit]").click();
  await page.locator("#cardMachineTimeSheet [data-card-ct-save]:not([disabled])").waitFor({ timeout: 10000 });
  await page.locator("#cardCtMinutes").fill("9");
  await page.locator("#cardCtSeconds").fill("30");
  await page.screenshot({ path: path.join(outDir, "09-tablet-editor.png"), fullPage: false });
  const hit = await page.evaluate(() => { const r = (e) => e.getBoundingClientRect(); const save = document.querySelector("[data-card-ct-save]"); const b = r(save); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return save.contains(top); });
  ok(hit, "平板：儲存鈕沒有被登入徽章蓋住");
  await page.locator("#cardMachineTimeSheet [data-card-ct-save]").click();
  await page.waitForFunction(() => !document.getElementById("cardMachineTimeSheet")?.classList.contains("is-open"), null, { timeout: 15000 });
  const s = be.calls[0]?.p_payload;
  ok(s && s.cycle_time_seconds === 570 && s.completed_qty === 0 && s.started_at === progress[id(306)].last_report_at && s.ended_at === s.started_at, "B03：0／0、570 秒、起訖＝上一筆報工", JSON.stringify(s));
  const g = await cardOf(page, "B03").locator(".cycle-mini-grid").innerText();
  ok(g.includes("9分30秒") && g.match(/每日估算\s*\n?\s*34 件/), "B03 卡片更新：25800 ÷（570＋180）＝ 34", g);
  await cardOf(page, "B03").screenshot({ path: path.join(outDir, "10-tablet-card-b03-saved.png") });
  ok(realErrors(errors).length === 0, "平板沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

await browser.close();
server.close();

const prodHits = blocked.filter((u) => u.includes("muditjubqflrqofbkmav") || u.includes("machtile.com") || (u.includes("supabase.co") && !u.startsWith(FAKE)));
ok(prodHits.length === 0, "沒有任何請求打到正式後端／正式網域", prodHits.join(" "));
console.log(`  (blocked external requests: ${blocked.length}${blocked.length ? " e.g. " + [...new Set(blocked.map((u) => new URL(u).host))].join(",") : ""})`);
console.log(`\n${pass} passed, ${fail} failed  (screenshots: ${outDir})`);
process.exit(fail ? 1 : 0);
