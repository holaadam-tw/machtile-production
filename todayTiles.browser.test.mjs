// Monitor 總覽「今日報工狀態」三格（今日未開工／今日未報工／未收工・可能加班）——瀏覽器端到端測試（Playwright，手機＋平板，假時鐘）。
// 不會碰任何真的後端：config.js 換成指向假專案網域的測試設定，所有 Supabase 請求由這支腳本攔截、用假資料回應；
// 其他對外請求一律擋掉並記錄（最後斷言一次都沒有打到正式專案）。時間用 Playwright 假時鐘（page.clock），
// 瀏覽器時區故意設成美西（America/Los_Angeles），證明判斷用的是台灣時間、不是瀏覽器時區。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node todayTiles.browser.test.mjs            （截圖寫到 ./.e2e-out/today-tiles/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node todayTiles.browser.test.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.CARD_E2E_OUT || path.join(root, ".e2e-out", "today-tiles");
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

// ---------- fixtures（台灣 2026-10-02）----------
const FAKE = "https://e2etodaytileszzzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DAY = "2026-10-02";
const tw = (hhmm, day = DAY) => Date.parse(`${day}T${hhmm}:00+08:00`);
const twIso = (hhmm, day = DAY) => new Date(tw(hhmm, day)).toISOString();

const users = [
  { id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) },
  { id: id(902), name: "李大華", legacy_user_id: "1021101" },
];
const card = (n, wo, machine, extra = {}) => ({
  id: id(100 + n), tenant_id: T, work_order_no: wo, customer_name: "測試客戶", part_name: `零件${n}`, drawing_no: null,
  quantity: 400, due_date: "2026-10-20", priority: "normal", work_order_status: "in_progress",
  current_process_id: id(300 + n), current_process_name: machine.startsWith("A") ? "車削" : "銑削",
  current_process_status: "running", machine_name: machine, qty_completed: 0, qty_defect: 0, progress_percent: 0,
  last_report_at: twIso("08:00"), open_risk_level: null, current_process_off_station: false, ...extra,
});
// 有工單：A01 A02 A03 A04 B03 B01；空閒（無工單）：A05 B02 B04 B05 B06
const cards = [
  card(1, "XX01202609020008", "A01"),
  card(2, "XX01202609160002", "A02"),
  card(3, "XX01202609160003", "A03"),
  card(4, "XX01202604140011", "A04"),
  card(6, "XX01202609170001", "B03"),
  card(10, "XX01202609290004", "B01"),
];
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: "", status: "idle", display_order: i,
}));
const r = (n, type, hhmm, day = DAY) => ({ process_id: id(300 + n), report_type: type, ended_at: twIso(hhmm, day), created_at: twIso(hhmm, day), user_id: users[1].id, operator_ids: [users[1].id] });
// A01：開工、中午、17:05 收工（全部有報）
// A02：今天沒開工（昨天有）→ 今日未開工
// A03：只有開工 → 13:00 後未報工（20:45 後也缺收工，仍只算 1 台）
// A04、B03：開工＋中午、沒收工 → 17:15–20:45 可能加班、20:45 後未報工
// B01：開工、中午、16:30 收工
const todayRowsAll = [
  r(1, "dailyStart", "08:05"), r(1, "noon", "12:00"), r(1, "finish", "17:05"),
  r(2, "dailyStart", "08:00", "2026-10-01"),
  r(3, "dailyStart", "08:10"),
  r(4, "dailyStart", "08:00"), r(4, "noon", "12:05"),
  r(6, "dailyStart", "08:20"), r(6, "noon", "12:30"),
  r(10, "dailyStart", "08:00"), r(10, "noon", "12:00"), r(10, "finish", "16:30"),
];
// 全部都有報（0 台＝綠）：A02 今天開工＋中午、A03 補中午（A02、A03、A04、B03 都還沒收工 → 18:00 可能加班 4 台）
const todayRowsAllGood = [...todayRowsAll, r(2, "dailyStart", "08:15"), r(2, "noon", "12:15"), r(3, "noon", "12:10")];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: users[0].auth, email: "op@test.invalid", exp: Math.floor(Date.parse("2026-10-03T00:00:00Z") / 1000) + 86400 * 30, role: "authenticated", app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const testConfig = `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key-for-e2e-only", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: true, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
};`;

// ---------- fake backend ----------
// 只回傳「現在」（假時鐘）以前的報工；clockNow 由測試在每個情境設定，並在快轉時跟著改
function makeBackend({ rows = todayRowsAll } = {}) {
  const b = { todayReads: [], writes: [], clockNow: 0 };
  b.handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const q = decodeURIComponent(url.search);
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() !== "GET") b.writes.push(`${req.method()} ${p}`);
    if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "op@test.invalid" });
    if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
    if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
    if (p === "/rest/v1/app_users") {
      if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: users[0].name }]);
      return json(200, users.map(({ auth, ...u }) => u));
    }
    if (p === "/rest/v1/production_reports") {
      if (q.includes("report_type=in.(dailyStart,noon,finish)")) {
        b.todayReads.push(q);
        const since = Date.parse((q.match(/created_at=gte\.([^&]+)/) || [])[1] || "");
        return json(200, rows.filter((row) => Date.parse(row.created_at) <= b.clockNow && (!Number.isFinite(since) || Date.parse(row.created_at) >= since)));
      }
      return json(200, []);
    }
    if (p.startsWith("/rest/v1/rpc/")) return json(200, []);
    if (p.startsWith("/rest/v1/")) return json(200, []);
    return json(200, {});
  };
  return b;
}

const blocked = [];
async function newPage(browser, device, backend, { atMs, storage = {} } = {}) {
  const context = await browser.newContext({ ...device, serviceWorkers: "block", timezoneId: "America/Los_Angeles" });
  await context.addInitScript(([token, store]) => {
    try {
      sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
      Object.entries(store).forEach(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); });
    } catch {}
  }, [jwt, storage]);
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
  backend.clockNow = atMs;
  await page.clock.install({ time: atMs });
  await page.clock.pauseAt(atMs);
  page.on("dialog", (d) => d.accept());
  const errors = [];
  if (process.env.CARD_DEBUG) page.on("console", (m) => { if (m.type() !== "log") console.log("CONSOLE", m.type(), m.text().slice(0, 300)); });
  page.on("pageerror", (e) => { errors.push(String(e)); if (process.env.CARD_DEBUG) console.log("PAGEERROR", String(e)); });
  return { context, page, errors };
}

async function waitLoaded(page) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  // 假時鐘暫停中：讓計時器（逾時、輪詢）也跑一點點，頁面才會走完載入
  for (let i = 0; i < 80; i++) {
    const done = await page.evaluate(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase")
      && document.querySelectorAll("#workOrderGrid .machine-tile-card").length > 0
      && document.querySelectorAll("#statsGrid [data-today-tile]").length === 3).catch(() => false);
    if (done) return;
    await page.clock.runFor(50);
    await page.waitForTimeout(50);
  }
  throw new Error("page never finished loading: " + await page.evaluate(() => document.getElementById("statsGrid")?.innerText.slice(0, 300)));
}

// 快轉 n 分鐘（每分鐘的重算會跑），後端的「現在」也跟著走
async function advance(page, be, minutes) {
  for (let i = 0; i < minutes; i++) {
    be.clockNow += 60000;
    await page.clock.runFor(60000);
    await page.waitForTimeout(80);
  }
}

const tile = (page, kind) => page.locator(`#statsGrid [data-today-tile="${kind}"]`);
async function tileInfo(page, kind) {
  return page.evaluate((k) => {
    const el = document.querySelector(`#statsGrid [data-today-tile="${k}"]`);
    if (!el) return null;
    const value = el.querySelector(".stat-value");
    return { label: el.querySelector(".stat-label").textContent.trim(), value: value.textContent.replace(/\s+/g, "").trim(), tone: el.dataset.todayTone, count: el.dataset.todayCount, color: getComputedStyle(value).color, pressed: el.getAttribute("aria-pressed"), hint: el.querySelector(".today-tile-hint").textContent.trim() };
  }, kind);
}
const shownMachines = (page) => page.evaluate(() => [...document.querySelectorAll("#workOrderGrid .machine-tile-card h2")].map((h) => h.childNodes[0].textContent.trim()));
const realErrors = (errors) => errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));
const GREEN = "rgb(21, 128, 61)", ORANGE = "rgb(234, 88, 12)", YELLOW = "rgb(202, 138, 4)", RED = "rgb(217, 45, 32)", GRAY = "rgb(152, 162, 179)";

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const phone = devices["Pixel 7"];
const tablet = { ...devices["iPad (gen 7)"], defaultBrowserType: undefined };

async function overviewShot(page, file) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#statsGrid").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, file), fullPage: false });
}

// ================= 08:29 → 08:31：未開工從「—」變成數字（假時鐘切換）=================
console.log("== 08:29 → 08:31（手機，瀏覽器時區＝美西）==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, phone, be, { atMs: tw("08:29") });
  await waitLoaded(page);
  const tz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  ok(tz === "America/Los_Angeles", `瀏覽器時區是美西（${tz}）`);
  ok(be.todayReads.length === 1, `載入只讀一次今天的報工（卡片底部與三格共用，${be.todayReads.length} 次）`);
  ok(be.todayReads[0]?.includes(`created_at=gte.${twIso("00:00")}`), "查詢下限＝台灣今天 00:00", be.todayReads[0]);
  const ns = await tileInfo(page, "notStarted");
  ok(ns?.value === "—" && ns.tone === "na" && ns.color === GRAY, "08:29 今日未開工＝「—」（灰）", JSON.stringify(ns));
  ok((await tileInfo(page, "unreported")).value === "—" && (await tileInfo(page, "overtime")).value === "—", "08:29 未報工、可能加班也是「—」");
  ok((await tileInfo(page, "notStarted")).label === "今日未開工" && (await tileInfo(page, "unreported")).label === "今日未報工" && (await tileInfo(page, "overtime")).label === "未收工（可能加班）", "三格標題");
  await advance(page, be, 2);
  const ns2 = await tileInfo(page, "notStarted");
  ok(ns2?.value === "1台" && ns2.tone === "notStarted" && ns2.color === ORANGE, "08:31 自動切換：今日未開工 1 台（A02，橘）；空閒 A05 等不算", JSON.stringify(ns2));
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= 13:30：數字、顏色、點擊篩選、恢復 =================
for (const [devName, device, tag] of [["手機（Pixel 7）", phone, "phone"], ["平板（iPad）", tablet, "tablet"]]) {
  console.log(`== 13:30 ${devName} ==`);
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, device, be, { atMs: tw("13:30") });
  await waitLoaded(page);
  const ns = await tileInfo(page, "notStarted");
  const un = await tileInfo(page, "unreported");
  const ot = await tileInfo(page, "overtime");
  ok(ns.value === "1台" && ns.color === ORANGE, "今日未開工 1 台（橘）", JSON.stringify(ns));
  ok(un.value === "1台" && un.tone === "unreported" && un.color === RED, "今日未報工 1 台（A03 沒有中午報工，紅）", JSON.stringify(un));
  ok(ot.value === "—" && ot.hint.includes("17:15"), "可能加班：這個時段「—」並說明 17:15–20:45 才計算", JSON.stringify(ot));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `沒有橫向捲動（${overflow}px）`);
  await overviewShot(page, `${tag}-1330-overview.png`);
  const all = await shownMachines(page);
  ok(all.length === 11, `一開始卡片牆 11 台（${all.length}）`);

  await tile(page, "unreported").click();
  await page.waitForTimeout(100);
  ok(JSON.stringify(await shownMachines(page)) === JSON.stringify(["A03"]), "點「今日未報工」→ 只剩 A03", JSON.stringify(await shownMachines(page)));
  const bar = page.locator("#todayFilterBar");
  ok(await bar.isVisible() && (await bar.innerText()).includes("篩選中：今日未報工 1 台") && (await bar.innerText()).includes("A03"), "卡片牆上方有「篩選中：今日未報工 1 台 A03」", await bar.innerText());
  ok((await tileInfo(page, "unreported")).pressed === "true" && (await tileInfo(page, "unreported")).hint.includes("篩選中"), "格子標示篩選中（aria-pressed、提示字）");
  ok(await page.evaluate(() => localStorage.getItem("machtile-monitor-today-filter")) === "unreported", "localStorage 記住篩選");
  await page.clock.runFor(5000);   // 等提示訊息（toast）收起來再拍
  await page.waitForTimeout(100);
  // 從「今日未報工」那一格開始拍：格子、篩選中標示、篩選後的卡片在同一張
  await page.evaluate(() => { const t = document.querySelector('[data-today-tile="unreported"]'); window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - 12); });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outDir, `${tag}-1330-filter-unreported.png`), fullPage: false });

  await tile(page, "unreported").click();
  await page.waitForTimeout(100);
  ok((await shownMachines(page)).length === 11 && !(await bar.isVisible()), "再點一次 → 恢復全部 11 台、標示消失");
  ok(await page.evaluate(() => localStorage.getItem("machtile-monitor-today-filter")) === null, "localStorage 清掉");

  await tile(page, "notStarted").click();
  await page.waitForTimeout(100);
  ok(JSON.stringify(await shownMachines(page)) === JSON.stringify(["A02"]), "點「今日未開工」→ 只剩 A02", JSON.stringify(await shownMachines(page)));
  await bar.locator("[data-today-filter-clear]").click();
  await page.waitForTimeout(100);
  ok((await shownMachines(page)).length === 11 && !(await bar.isVisible()), "按「顯示全部」→ 恢復 11 台");

  await tile(page, "overtime").click();
  await page.waitForTimeout(100);
  ok((await shownMachines(page)).length === 11 && !(await bar.isVisible()), "點「—」的格子不篩選（只跳說明）");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  const mutating = be.writes.filter((w) => !w.startsWith("POST /rest/v1/rpc/") || /upsert|insert|update|delete|reorder|submit/i.test(w));
  ok(mutating.length === 0, `沒有任何寫入請求（非 GET 只有唯讀 RPC：${[...new Set(be.writes)].join(", ") || "無"}）`, mutating.join(", "));
  await context.close();
}

// ================= 記住篩選：重新載入後還在 =================
console.log("== 重新整理後記住篩選 ==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, phone, be, { atMs: tw("13:30"), storage: { "machtile-monitor-today-filter": "unreported" } });
  await waitLoaded(page);
  ok(JSON.stringify(await shownMachines(page)) === JSON.stringify(["A03"]) && await page.locator("#todayFilterBar").isVisible(), "localStorage 有 unreported → 一進來就是篩選中、只顯示 A03");
  // 點上方狀態籤（例：加工中）→ 今日篩選自動取消
  await page.locator('#statsGrid [data-stat-filter="全部狀態"]').click();
  await page.waitForTimeout(100);
  ok((await shownMachines(page)).length === 11 && !(await page.locator("#todayFilterBar").isVisible()), "點「總機台」→ 今日篩選取消");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= localStorage 不能用也不會壞 =================
console.log("== localStorage 丟錯 ==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, phone, be, { atMs: tw("13:30") });
  // 只讓這個功能用的 key 讀寫都丟錯（整個 localStorage 擋掉的話別的舊功能本來就會壞，不是這次的範圍）
  await context.addInitScript(() => {
    const KEY = "machtile-monitor-today-filter";
    ["getItem", "setItem", "removeItem"].forEach((name) => {
      const orig = Storage.prototype[name];
      Storage.prototype[name] = function (key, ...rest) {
        if (key === KEY) throw new Error("storage blocked");
        return orig.call(this, key, ...rest);
      };
    });
  });
  await waitLoaded(page);
  await tile(page, "unreported").click();
  await page.waitForTimeout(100);
  ok(JSON.stringify(await shownMachines(page)) === JSON.stringify(["A03"]), "localStorage 丟錯也能篩選");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= 18:00：可能加班 =================
for (const [devName, device, tag] of [["手機（Pixel 7）", phone, "phone"], ["平板（iPad）", tablet, "tablet"]]) {
  console.log(`== 18:00 ${devName} ==`);
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, device, be, { atMs: tw("18:00") });
  await waitLoaded(page);
  const un = await tileInfo(page, "unreported");
  const ot = await tileInfo(page, "overtime");
  ok(un.value === "1台" && un.color === RED, "今日未報工 1 台（A03 缺中午；沒收工的不算在這格）", JSON.stringify(un));
  ok(ot.value === "2台" && ot.tone === "overtime" && ot.color === YELLOW, "未收工（可能加班）2 台（A04、B03，黃）；A01、B01 已收工", JSON.stringify(ot));
  await overviewShot(page, `${tag}-1800-overview.png`);
  await tile(page, "overtime").click();
  await page.waitForTimeout(100);
  ok(JSON.stringify(await shownMachines(page)) === JSON.stringify(["A04", "B03"]), "點「可能加班」→ A04、B03", JSON.stringify(await shownMachines(page)));
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= 時段切換：12:59→13:01、17:14→17:16、20:44→20:46（篩選中的格子到點自動恢復）=================
console.log("== 時段切換（假時鐘快轉）==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, phone, be, { atMs: tw("12:59") });
  await waitLoaded(page);
  ok((await tileInfo(page, "unreported")).value === "—", "12:59 未報工「—」");
  await advance(page, be, 2);
  ok((await tileInfo(page, "unreported")).value === "1台", "13:01 未報工 1 台（自動切換）", JSON.stringify(await tileInfo(page, "unreported")));
  ok(be.todayReads.length >= 2, `每 2 分鐘重讀同一份今天的報工（${be.todayReads.length} 次）`);
  await context.close();
  if (realErrors(errors).length) ok(false, "沒有 JS 錯誤", realErrors(errors).join(" | "));
}
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, phone, be, { atMs: tw("17:14") });
  await waitLoaded(page);
  ok((await tileInfo(page, "overtime")).value === "—", "17:14 可能加班「—」");
  await advance(page, be, 2);
  ok((await tileInfo(page, "overtime")).value === "2台", "17:16 可能加班 2 台（A04、B03；A01 17:05 已收工）", JSON.stringify(await tileInfo(page, "overtime")));
  await context.close();
  if (realErrors(errors).length) ok(false, "沒有 JS 錯誤", realErrors(errors).join(" | "));
}
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, phone, be, { atMs: tw("20:44") });
  await waitLoaded(page);
  ok((await tileInfo(page, "overtime")).value === "2台" && (await tileInfo(page, "unreported")).value === "1台", "20:44 可能加班 2、未報工 1");
  await tile(page, "overtime").click();
  await page.waitForTimeout(100);
  ok(JSON.stringify(await shownMachines(page)) === JSON.stringify(["A04", "B03"]), "20:44 篩選可能加班 → A04、B03");
  await advance(page, be, 2);
  const un = await tileInfo(page, "unreported");
  ok(un.value === "3台" && un.color === RED, "20:46 未報工 3 台（A03 缺中午＋收工只算 1 台、A04、B03 沒收工）", JSON.stringify(un));
  ok((await tileInfo(page, "overtime")).value === "—", "20:46 可能加班回到「—」");
  ok((await shownMachines(page)).length === 11 && !(await page.locator("#todayFilterBar").isVisible()), "篩選中的「可能加班」到 20:45 不再計算 → 自動顯示全部");
  await tile(page, "unreported").click();
  await page.waitForTimeout(100);
  ok(JSON.stringify(await shownMachines(page)) === JSON.stringify(["A03", "A04", "B03"]), "20:46 點未報工 → A03、A04、B03", JSON.stringify(await shownMachines(page)));
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= 0 台＝綠 =================
console.log("== 全部都報了 → 0 台綠 ==");
{
  const be = makeBackend({ rows: todayRowsAllGood });
  const { context, page, errors } = await newPage(browser, phone, be, { atMs: tw("18:00") });
  await waitLoaded(page);
  const ns = await tileInfo(page, "notStarted"), un = await tileInfo(page, "unreported"), ot = await tileInfo(page, "overtime");
  ok(ns.value === "0台" && ns.color === GREEN && un.value === "0台" && un.color === GREEN, "未開工 0、未報工 0 → 綠", JSON.stringify([ns, un]));
  ok(ot.value === "4台" && ot.color === YELLOW, "還沒收工的照樣算可能加班 4 台（A02、A03、A04、B03，黃）", JSON.stringify(ot));
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

await browser.close();
server.close();

const prodHits = blocked.filter((u) => u.includes("muditjubqflrqofbkmav") || u.includes("machtile.com") || (u.includes("supabase.co") && !u.startsWith(FAKE)));
ok(prodHits.length === 0, "沒有任何請求打到正式後端／正式網域", prodHits.join(" "));
console.log(`  (blocked external requests: ${blocked.length}${blocked.length ? " e.g. " + [...new Set(blocked.map((u) => new URL(u).host))].join(",") : ""})`);
console.log(`\n${pass} passed, ${fail} failed  (screenshots: ${outDir})`);
process.exit(fail ? 1 : 0);
