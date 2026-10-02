// 機台卡片「這台還掛 N 張」清單：改前／改後截圖（假資料，手機 360px）。
// 用法：CARD_LIST_ROOT=<repo 目錄> CARD_LIST_TAG=before|after CARD_LIST_OUT=<輸出目錄> MACHTILE_PLAYWRIGHT_MODULE=... node cardListShots.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(process.env.CARD_LIST_ROOT);
const tag = process.env.CARD_LIST_TAG || "after";
const outDir = process.env.CARD_LIST_OUT;
const pw = await import(pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href);
const { chromium, devices } = pw.default || pw;

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  try { const body = await readFile(file); res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const FAKE = "https://e2ecardlistzzzzzzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 3600e3).toISOString();
const y = new Date(now); y.setDate(y.getDate() - 1); y.setHours(16, 57, 12, 0);
const yesterday1657 = y.toISOString();

const card = (n, wo, part, machine, due, qty, done) => ({
  id: id(100 + n), tenant_id: T, work_order_no: wo, customer_name: "測試客戶", part_name: part, drawing_no: null,
  quantity: qty, due_date: due, priority: "normal", work_order_status: "not_started",
  current_process_id: id(300 + n), current_process_name: "加工製程", current_process_status: "pending",
  machine_name: machine, qty_completed: done, qty_defect: 0, progress_percent: 0,
  last_report_at: null, open_risk_level: null, current_process_off_station: false,
});
// B01：4 張在站（假資料）
const cards = [
  card(11, "XX01202610010003", "HCG-06-01本體", "B01", "2026-10-20", 124, 52),
  card(12, "XX01202606050003", "HCG(HG)-06長蓋", "B01", "2026-07-31", 536, 689),
  card(13, "XX01202609300012", "CPDF-16本體", "B01", "2026-10-31", 300, 80),
  card(14, "XX01202606030002", "P08九孔座-AR齒 (素材用AR16-R01-04-N)", "B01", "2026-06-30", 300, 0),
];
const machines = ["A01", "B01", "B02", "B03"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: "", status: "idle", display_order: i,
}));
const wop = {
  [id(311)]: { process_order: 1, actual_start_at: hoursAgo(30) },
  [id(312)]: { process_order: 1, actual_start_at: null },
  [id(313)]: { process_order: 1, actual_start_at: hoursAgo(75) },
  [id(314)]: { process_order: 1, actual_start_at: null },
};
const appReport = { [id(311)]: hoursAgo(3.1) };
const legacy = [
  { work_order_no: "XX01202606050003", machine_code: "B01", process_order: 1, legacy_output: 689, legacy_updated_at: yesterday1657 },
];
const cardByPid = Object.fromEntries(cards.map((c) => [c.current_process_id, c]));
function progressRow(pid) {
  const c = cardByPid[pid];
  const lp = legacy.find((r) => r.work_order_no === c.work_order_no && r.machine_code === c.machine_name) || null;
  return {
    process_id: pid, work_order_no: c.work_order_no, machine_code: c.machine_name, process_order: 1,
    legacy_input: lp ? lp.legacy_output : null, legacy_output: lp ? lp.legacy_output : null, legacy_fail: lp ? 0 : null,
    legacy_updated_at: lp ? lp.legacy_updated_at : null, legacy_snapshot_at: lp ? lp.legacy_updated_at : null, legacy_synced_at: lp ? lp.legacy_updated_at : null,
    pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: appReport[pid] || null, actual_start_at: wop[pid]?.actual_start_at || null,
  };
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id(801), email: "op@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const testConfig = `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key-for-e2e-only", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: true, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
};`;
const writes = [];
async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const q = decodeURIComponent(url.search);
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const readRpc = /^\/rest\/v1\/rpc\/(batch_report_progress|[a-z_]+_snapshot|[a-z_]+_list)$/.test(p);
  if (req.method() !== "GET" && req.method() !== "HEAD" && !readRpc) writes.push(`${req.method()} ${p}`);
  if (p.startsWith("/auth/v1/user")) return json(200, { id: id(801), email: "op@test.invalid" });
  if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
  if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
  if (p === "/rest/v1/app_users") return json(200, [{ id: id(901), name: "王小明" }]);
  if (p === "/rest/v1/work_order_processes") {
    if (q.includes("queue_order=not.is.null")) return json(200, []);
    const m = q.match(/id=in\.\(([^)]*)\)/);
    if (m && q.includes("actual_start_at")) return json(200, m[1].split(",").filter((pid) => wop[pid]).map((pid) => ({ id: pid, ...wop[pid] })));
    return json(200, []);
  }
  if (p === "/rest/v1/legacy_station_progress") return json(200, legacy.map(({ legacy_output, ...r }) => r));
  if (p === "/rest/v1/rpc/batch_report_progress") {
    const body = JSON.parse(req.postData() || "{}");
    return json(200, (body.p_process_ids || []).filter((pid) => cardByPid[pid]).map(progressRow));
  }
  if (p.startsWith("/rest/v1/")) return json(200, []);
  return json(200, {});
}

const phone = { ...devices["Pixel 7"], viewport: { width: 360, height: 1800 }, screen: { width: 360, height: 1800 } };
const browser = await chromium.launch();
await mkdir(outDir, { recursive: true });
async function shoot(name, { dark = false, manual = false } = {}) {
  const context = await browser.newContext({ ...phone, colorScheme: dark ? "dark" : "light", serviceWorkers: "block" });
  await context.addInitScript(([token]) => {
    try { sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 })); } catch {}
  }, [jwt]);
  await context.route("**/*", async (route) => {
    const u = route.request().url();
    if (u.startsWith(FAKE)) return handle(route);
    if (u.startsWith(base)) {
      if (new URL(u).pathname.endsWith("/config.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: testConfig });
      return route.continue();
    }
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid .machine-tile-card").length > 0, null, { timeout: 20000 });
  await page.waitForFunction(() => typeof machtileCardPickState === "undefined" || machtileCardPickState.status === "ready", null, { timeout: 20000 });
  await page.evaluate(() => { deriveMachines(); renderWorkOrders(); });
  const b01 = page.locator("#workOrderGrid .machine-tile-card").filter({ has: page.locator("h2", { hasText: "B01" }) }).first();
  await b01.locator("[data-card-orders-summary]").click();
  if (manual) await b01.locator(".card-order-list [data-card-pick-key]").first().click();
  const list = b01.locator("[data-card-orders]");
  await list.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await list.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`${name}: overflow=${overflow}px writes=${writes.length}\n${(await list.innerText()).replace(/\n+/g, " | ")}`);
  await context.close();
}
await shoot(`b01-list-${tag}`);
if (tag === "after") {
  await shoot(`b01-list-${tag}-dark`, { dark: true });
  await shoot(`b01-list-${tag}-manual`, { manual: true });
}
await browser.close();
server.close();
