// 現場大螢幕電視頁（?view=tv）——瀏覽器端到端測試（Playwright，1920×1080／1280×720／手機，假時鐘，假後端）。
// 不會碰任何真的後端：config.js 換成指向假專案網域的測試設定，所有 Supabase 請求由這支腳本攔截、用假資料回應；
// 其他對外請求一律擋掉並記錄（最後斷言一次都沒有打到正式專案）。瀏覽器時區故意設成美西，證明時間用台灣時間。
//
// 驗：兩種電視解析度一頁看完不捲動、字夠大；異常上色（正常不上色）；每 60 秒自動刷新；讀取失敗保留畫面＋角落提示；
//     登入過期顯示登入畫面；選單「管理 → 更多功能 → 現場電視」入口；手機可以捲動；全程 0 次寫入。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node tvWall.browser.test.mjs            （截圖寫到 ./.e2e-out/tv-wall/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node tvWall.browser.test.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { assignedCardFixture } from './assignedCardFixture.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.TV_E2E_OUT || path.join(root, ".e2e-out", "tv-wall");
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

// ---------- fixtures（台灣 2026-10-02 週五）----------
const FAKE = "https://e2etvwallzzzzzzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DAY = "2026-10-02";
const tw = (hhmm, day = DAY) => Date.parse(`${day}T${hhmm}:00+08:00`);
const twIso = (hhmm, day = DAY) => new Date(tw(hhmm, day)).toISOString();

const users = [
  { id: id(901), name: "電視帳號", legacy_user_id: "TV01", auth: id(801) },
  { id: id(902), name: "李大華", legacy_user_id: "1021101" },
];
const card = (n, wo, machine, part, extra = {}) => ({
  id: id(100 + n), tenant_id: T, work_order_no: wo, customer_name: "測試客戶", part_name: part, drawing_no: null,
  quantity: 400, due_date: "2026-10-20", priority: "normal", work_order_status: "in_progress",
  current_process_id: id(300 + n), current_process_name: machine.startsWith("A") ? "車削" : "銑削",
  current_process_status: "running", machine_name: machine, qty_completed: 0, qty_defect: 0, progress_percent: 0,
  last_report_at: twIso("08:00"), open_risk_level: null, current_process_off_station: false, ...extra,
});
// A01 正常（含舊 MES 120/400）、A02 今日未開工、A03 未報工（缺中午）、A04 超量（689/536）、A05 無工單
// B01 正常、B02 無工單、B03 逾期（交期 09/30）、B04 正常、B05、B06 無工單
const cards = [
  card(1, "XX01202609020008", "A01", "法蘭盤 φ120 外徑精車"),
  card(2, "XX01202609160002", "A02", "傳動軸 S45C"),
  card(3, "XX01202609160003", "A03", "軸套 SUS304"),
  card(4, "XX01202604140011", "A04", "連接座 AL6061", { quantity: 536 }),
  card(10, "XX01202609290004", "B01", "泵浦殼體 FC250"),
  card(6, "XX01202609170001", "B03", "齒輪箱上蓋", { due_date: "2026-09-30" }),
  card(7, "XX01202609210005", "B04", "馬達座 SS400"),
];
const legacy = { 1: [100, 20], 2: [0, 0], 3: [210, 0], 4: [689, 0], 10: [42, 0], 6: [88, 0], 7: [300, 12] };
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: code === "A01" ? "小瀧澤" : "", status: "idle", display_order: i,
}));
const r = (n, type, hhmm, day = DAY) => ({ process_id: id(300 + n), report_type: type, ended_at: twIso(hhmm, day), created_at: twIso(hhmm, day), started_at: null, completed_qty: type === "noon" ? 10 : 0, defect_qty: 0, user_id: users[1].id, operator_ids: [users[1].id] });
const todayRows = [
  r(1, "dailyStart", "08:05"), r(1, "noon", "12:00"),
  r(2, "dailyStart", "08:00", "2026-10-01"),
  r(3, "dailyStart", "08:10"),
  r(4, "dailyStart", "08:00"), r(4, "noon", "12:05"),
  r(10, "dailyStart", "08:00"), r(10, "noon", "12:00"),
  r(6, "dailyStart", "08:20"), r(6, "noon", "12:30"),
  r(7, "dailyStart", "07:55"), r(7, "noon", "12:10"),
];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: users[0].auth, email: "tv@test.invalid", exp: Math.floor(Date.parse("2026-10-03T00:00:00Z") / 1000) + 86400 * 30, role: "authenticated", app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const testConfig = `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key-for-e2e-only", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: true, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
};`;

// ---------- fake backend ----------
// 唯讀 RPC（POST 但只查詢）：卡片完成數、開機時的排程日曆／提醒中心／HMC 盤況／事件清單快照。其他任何非 GET 都算寫入。
const READ_RPCS = new Set(["/rest/v1/rpc/batch_report_progress", "/rest/v1/rpc/schedule_calendar_snapshot", "/rest/v1/rpc/attention_case_snapshot", "/rest/v1/rpc/hmc_runtime_snapshot", "/rest/v1/rpc/unified_event_list"]);
function makeBackend() {
  const rows = [...todayRows];
  const b = { rows, clockNow: 0, mode: "ok", cardReads: 0, todayReads: 0, writes: [], requests: [] };
  b.handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const q = decodeURIComponent(url.search);
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    b.requests.push(`${req.method()} ${p}`);
    if (req.method() !== "GET" && !READ_RPCS.has(p)) b.writes.push(`${req.method()} ${p}`);
    if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "tv@test.invalid" });
    if (b.mode === "down" && p.startsWith("/rest/v1/")) return json(503, { message: "service unavailable (test)" });
    if (b.mode === "expired" && p.startsWith("/rest/v1/")) return json(401, { message: "JWT expired (test)" });
    if (p === "/rest/v1/v_work_order_cards") { b.cardReads++; return json(200, cards); }
    if (p === '/rest/v1/work_order_processes' && (url.searchParams.get('select') || '').includes('work_orders!inner')) return json(200, assignedCardFixture(cards, machines));
    if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
    if (p === "/rest/v1/app_users") {
      if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: users[0].name }]);
      return json(200, users.map(({ auth, ...u }) => u));
    }
    if (p === "/rest/v1/production_reports") {
      if (q.includes("report_type=in.(dailyStart,noon,finish)")) {
        b.todayReads++;
        return json(200, rows.filter((row) => Date.parse(row.created_at) <= b.clockNow));
      }
      return json(200, []);
    }
    if (p === "/rest/v1/rpc/batch_report_progress") {
      const body = JSON.parse(req.postData() || "{}");
      return json(200, (body.p_process_ids || []).map((pid) => {
        const n = Number(pid.slice(-3)) - 300;
        const [out, pend] = legacy[n] || [null, 0];
        const mine = rows.filter((row) => row.process_id === pid && Date.parse(row.created_at) <= b.clockNow);
        const last = mine.map((row) => row.ended_at).sort().pop() || null;
        return { process_id: pid, legacy_output: out, legacy_fail: 0, pending_output: pend, pending_fail: 0, pending_count: pend ? 1 : 0, oldest_pending_at: null, last_report_at: last, actual_start_at: last, legacy_synced_at: twIso("07:00") };
      }));
    }
    if (p.startsWith("/rest/v1/")) return json(200, []);
    return json(200, {});
  };
  return b;
}

const blocked = [];
async function newPage(browser, contextOptions, backend, { atMs } = {}) {
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: "block", timezoneId: "America/Los_Angeles" });
  await context.addInitScript((token) => {
    try {
      sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "tv@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
    } catch {}
  }, jwt);
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
  await page.clock.install({ time: atMs - 2000 });
  await page.clock.pauseAt(atMs);
  page.on("dialog", (d) => d.accept());
  const errors = [];
  if (process.env.TV_DEBUG) page.on("console", (m) => { if (m.type() !== "log") console.log("CONSOLE", m.type(), m.text().slice(0, 300)); });
  page.on("pageerror", (e) => { errors.push(String(e)); if (process.env.TV_DEBUG) console.log("PAGEERROR", String(e)); });
  return { context, page, errors };
}

async function settle(page, cond, label) {
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(cond).catch(() => false)) return true;
    await page.clock.runFor(50);
    await page.waitForTimeout(40);
  }
  throw new Error("never settled: " + label + " :: " + await page.evaluate(() => document.getElementById("tvWall")?.dataset.tvState + " " + document.body.innerText.slice(0, 200)).catch(() => ""));
}

async function openTv(page) {
  await page.goto(base + "?view=tv", { waitUntil: "domcontentloaded" });
  await settle(page, () => document.getElementById("tvWall")?.dataset.tvState === "ok" && document.querySelectorAll("#tvWall .tv-cell").length === 11, "tv ok");
}

// 快轉 n 秒（計時器照跑），後端的「現在」也跟著走
async function advance(page, be, seconds) {
  for (let s = 0; s < seconds; s += 10) {
    be.clockNow += 10000;
    await page.clock.runFor(10000);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(150);
}

const tvInfo = (page) => page.evaluate(() => {
  const wall = document.getElementById("tvWall");
  const cells = [...wall.querySelectorAll(".tv-cell")].map((c) => ({
    code: c.dataset.tvMachine, sev: c.dataset.tvSeverity,
    today: c.querySelector(".tv-today")?.textContent.trim() || "", todayTone: c.querySelector(".tv-today")?.dataset.tvToday || "",
    qty: c.querySelector(".tv-qty")?.dataset.tvQty || "", part: c.querySelector(".tv-part")?.textContent.trim() || "",
    tags: [...c.querySelectorAll(".tv-tag")].map((t) => t.textContent.trim()),
    border: getComputedStyle(c).borderTopColor, stripe: getComputedStyle(c, "::before").backgroundColor,
    bar: c.querySelector(".tv-bar i") ? getComputedStyle(c.querySelector(".tv-bar i")).backgroundColor : "",
  }));
  const tiles = Object.fromEntries([...wall.querySelectorAll("[data-tv-tile]")].map((t) => [t.dataset.tvTile, { value: t.querySelector(".tv-tile-value").textContent.trim(), tone: t.dataset.tvTone, color: getComputedStyle(t.querySelector(".tv-tile-value")).color, sub: t.querySelector(".tv-tile-sub").textContent.trim() }]));
  return { state: wall.dataset.tvState, updated: wall.dataset.tvUpdated, clock: wall.querySelector("[data-tv-clock]")?.textContent, alert: wall.querySelector("[data-tv-alert]")?.innerText || "", cells, tiles };
});
const cellOf = (info, code) => info.cells.find((c) => c.code === code);

const layout = (page) => page.evaluate(() => {
  const se = document.scrollingElement;
  const vw = window.innerWidth, vh = window.innerHeight;
  const cells = [...document.querySelectorAll("#tvWall .tv-cell")];
  const out = cells.filter((c) => { const r = c.getBoundingClientRect(); return r.top < -0.5 || r.left < -0.5 || r.bottom > vh + 0.5 || r.right > vw + 0.5; }).map((c) => c.dataset.tvMachine);
  // 每格裡的每一行都要在格子裡面（overflow:hidden 不能把內容藏掉）
  const clipped = cells.filter((c) => {
    const box = c.getBoundingClientRect();
    return [...c.children].some((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.bottom > box.bottom + 0.5; });
  }).map((c) => c.dataset.tvMachine);
  const px = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
  return {
    scrollX: se.scrollWidth - vw, scrollY: se.scrollHeight - vh, out, clipped,
    code: px("#tvWall .tv-code"), part: px("#tvWall .tv-part"), done: px("#tvWall .tv-done"), today: px("#tvWall .tv-today"), clock: px("#tvWall [data-tv-clock]"), tile: px("#tvWall .tv-tile-value"),
    shellHidden: getComputedStyle(document.querySelector(".app-shell")).display === "none",
    navHidden: getComputedStyle(document.querySelector(".mobile-tabs")).display === "none",
  };
});

const realErrors = (errors) => errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));
const BAD_TEXT = "rgb(163, 38, 29)", WARN_TEXT = "rgb(138, 82, 0)", BAD = "rgb(194, 59, 48)", WARN = "rgb(184, 110, 0)", LINE = "rgb(215, 221, 228)", BAR = "rgb(125, 143, 163)", TRANSPARENT = "rgba(0, 0, 0, 0)";

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const tvSizes = [["1920×1080", { viewport: { width: 1920, height: 1080 } }, "tv-1920x1080", { code: 60, part: 30, done: 45, clock: 80 }], ["1280×720", { viewport: { width: 1280, height: 720 } }, "tv-1280x720", { code: 40, part: 20, done: 30, clock: 55 }]];

// ================= 兩種電視解析度：版面、上色 =================
for (const [label, opts, tag, minPx] of tvSizes) {
  console.log(`== ${label}（13:30）==`);
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, opts, be, { atMs: tw("13:30") });
  await openTv(page);
  const lay = await layout(page);
  ok(lay.scrollX <= 0 && lay.scrollY <= 0, `一頁看完：不能捲動（橫 ${lay.scrollX}px、直 ${lay.scrollY}px）`);
  ok(lay.out.length === 0, `11 台全部在畫面內（超出：${lay.out.join(",") || "無"}）`);
  ok(lay.clipped.length === 0, `每格內容沒有被裁掉（${lay.clipped.join(",") || "無"}）`);
  ok(lay.shellHidden && lay.navHidden, "沒有側欄、導覽（一般畫面整個藏起來）");
  ok(lay.code >= minPx.code && lay.part >= minPx.part && lay.done >= minPx.done && lay.clock >= minPx.clock, `字夠大：代號 ${lay.code}px、品名 ${lay.part}px、已報 ${lay.done}px、時間 ${lay.clock}px`, JSON.stringify(lay));
  const info = await tvInfo(page);
  ok(info.clock === "13:30", `時間＝台灣 13:30（瀏覽器是美西時區）：${info.clock}`);
  ok(JSON.stringify(info.cells.map((c) => c.code)) === JSON.stringify(["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"]), "車床 A01–A05 一排、銑床 B01–B06 一排");
  ok(await page.evaluate(() => [...document.querySelectorAll("#tvWall .tv-line")].map((l) => l.querySelectorAll(".tv-cell").length).join(",")) === "5,6", "兩排：5 台＋6 台");
  ok(info.tiles.notStarted.value === "1台" && info.tiles.notStarted.color === WARN_TEXT && info.tiles.notStarted.sub === "A02", "今日未開工 1 台（橘，列出 A02）", JSON.stringify(info.tiles.notStarted));
  ok(info.tiles.unreported.value === "1台" && info.tiles.unreported.color === BAD_TEXT && info.tiles.unreported.sub === "A03", "今日未報工 1 台（紅，列出 A03）", JSON.stringify(info.tiles.unreported));
  ok(info.tiles.overtime.value === "—" && info.tiles.overtime.tone === "na", "未收工（可能加班）13:30＝「—」（不計算時段，不上色）", JSON.stringify(info.tiles.overtime));
  const a1 = cellOf(info, "A01");
  ok(a1.qty === "120/400" && a1.today === "08:05 開工" && a1.tags.length === 0 && a1.sev === "", "A01：已報 120／400（舊 MES＋待回寫，同卡片口徑）、08:05 開工、沒有標籤", JSON.stringify(a1));
  ok(a1.border === LINE && a1.stripe === TRANSPARENT && a1.bar === BAR, "正常機台不上色（灰框、無色條、灰藍進度條）", JSON.stringify(a1));
  const a2 = cellOf(info, "A02");
  ok(a2.today === "今日未開工" && a2.sev === "notStarted" && a2.border === WARN && a2.stripe === WARN, "A02 今日未開工：橘色", JSON.stringify(a2));
  const a3 = cellOf(info, "A03");
  ok(JSON.stringify(a3.tags) === JSON.stringify(["未報工・缺中午"]) && a3.border === BAD && a3.stripe === BAD, "A03 未報工・缺中午：紅色", JSON.stringify(a3));
  const a4 = cellOf(info, "A04");
  ok(a4.qty === "689/536" && a4.tags.includes("超量 +153") && a4.bar === BAD && a4.sev === "over", "A04 超量 +153：紅色進度條＋標籤", JSON.stringify(a4));
  const b3 = cellOf(info, "B03");
  ok(b3.tags.includes("逾期 2 天") && b3.sev === "overdue" && b3.border === WARN, "B03 逾期 2 天（交期 09/30）：橘色", JSON.stringify(b3));
  const a5 = cellOf(info, "A05");
  ok(a5.part === "無工單" && a5.tags.length === 0 && a5.sev === "" && a5.border === LINE, "A05 無工單：中性", JSON.stringify(a5));
  const unexpected = info.cells.filter((c) => !["A02", "A03", "A04", "B03"].includes(c.code) && (c.sev || c.tags.length));
  ok(unexpected.length === 0, `其他機台都沒上色（${unexpected.map((c) => c.code).join(",") || "無"}）`);
  ok(info.alert === "", "沒有錯誤提示");
  await page.screenshot({ path: path.join(outDir, `${tag}.png`) });
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  ok(be.writes.length === 0, `0 次寫入（${be.writes.join(", ") || "無"}）`);
  await context.close();
}

// ================= 自動刷新、讀取失敗、恢復（假時鐘）=================
console.log("== 每 60 秒自動刷新／讀取失敗保留畫面 ==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, tvSizes[1][1], be, { atMs: tw("12:58") });
  await openTv(page);
  const reads0 = be.cardReads;
  const today0 = be.todayReads;
  // A02 12:58:30 開工（下一輪才會看到）
  be.rows.push({ ...r(2, "dailyStart", "12:58"), ended_at: new Date(tw("12:58") + 30000).toISOString(), created_at: new Date(tw("12:58") + 30000).toISOString() });
  await advance(page, be, 50);
  ok(be.cardReads === reads0, `60 秒內不重讀（${be.cardReads - reads0} 次）`);
  ok(cellOf(await tvInfo(page), "A02").today === "今日未開工", "還沒到 60 秒：A02 照舊");
  await advance(page, be, 20);
  let info = await tvInfo(page);
  ok(be.cardReads === reads0 + 1 && be.todayReads >= today0 + 1, `60 秒自動重讀一次（工單 ${be.cardReads - reads0} 次、今日報工 ${be.todayReads - today0} 次）`);
  ok(cellOf(info, "A02").today === "12:58 開工" && cellOf(info, "A02").sev === "" && info.tiles.notStarted.value === "0台" && info.tiles.notStarted.tone === "zero", "刷新後 A02 變成 12:58 開工、不再上色；未開工 0 台（中性）", JSON.stringify([cellOf(info, "A02"), info.tiles.notStarted]));
  ok(info.updated === "12:59" && info.clock === "12:59", `更新時間 ${info.updated}、時鐘 ${info.clock}`);

  be.mode = "down";
  await advance(page, be, 60);
  info = await tvInfo(page);
  ok(info.state === "error" && info.alert.includes("資料更新失敗，最後更新 12:59"), "讀取失敗 → 角落「資料更新失敗，最後更新 12:59」", info.alert);
  ok(info.cells.length === 11 && cellOf(info, "A01").qty === "120/400" && cellOf(info, "A04").tags.includes("超量 +153"), "畫面沒有被清空（11 台、數字、標籤都還在）");
  ok(info.clock === "13:00", `時鐘照走（${info.clock}）`);
  const lay = await layout(page);
  ok(lay.scrollX <= 0 && lay.scrollY <= 0, "提示出現也不會造成捲動");
  await page.screenshot({ path: path.join(outDir, "tv-1280x720-error.png") });
  await advance(page, be, 60);
  info = await tvInfo(page);
  ok(info.alert.includes("最後更新 12:59"), "再失敗一次：最後更新時間不變（12:59）", info.alert);

  be.mode = "ok";
  await advance(page, be, 60);
  info = await tvInfo(page);
  ok(info.state === "ok" && info.alert === "" && info.updated === "13:02", `恢復 → 提示消失、更新時間 ${info.updated}`, info.alert);
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  ok(be.writes.length === 0, `0 次寫入（${be.writes.join(", ") || "無"}）`);
  await context.close();
}

// ================= 登入過期 =================
console.log("== 登入過期（401）==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, tvSizes[1][1], be, { atMs: tw("13:30") });
  await openTv(page);
  be.mode = "expired";
  await advance(page, be, 60);
  const gate = await page.evaluate(() => { const g = document.getElementById("machtileLoginGate"); return g ? { text: g.innerText, z: getComputedStyle(g).zIndex, visible: g.getBoundingClientRect().height > 0 } : null; });
  ok(gate && gate.visible && gate.text.includes("登入"), "401 → 出現登入畫面（蓋在電視頁上）", JSON.stringify(gate));
  const info = await tvInfo(page);
  ok(info.alert.includes("資料更新失敗，最後更新 13:30") && info.alert.includes("登入已過期"), "電視頁角落也寫「登入已過期」", info.alert);
  await page.screenshot({ path: path.join(outDir, "tv-1280x720-expired.png") });
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  ok(be.writes.length === 0, `0 次寫入（${be.writes.join(", ") || "無"}）`);
  await context.close();
}

// ================= 手機：可以捲動、看得到 11 台 =================
console.log("== 手機（Pixel 7）==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"], be, { atMs: tw("13:30") });
  await openTv(page);
  const lay = await layout(page);
  ok(lay.scrollX <= 1, `手機沒有橫向捲動（${lay.scrollX}px）`);
  ok(lay.scrollY > 0, `手機可以往下捲（內容高出 ${lay.scrollY}px）`);
  ok(lay.code >= 28 && lay.part >= 16, `手機字也夠大（代號 ${lay.code}px、品名 ${lay.part}px）`);
  await page.screenshot({ path: path.join(outDir, "tv-phone.png"), fullPage: true });
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
  await page.waitForTimeout(100);
  const lastVisible = await page.evaluate(() => { const r = document.querySelector('#tvWall [data-tv-machine="B06"]').getBoundingClientRect(); return r.bottom <= window.innerHeight + 1 && r.top >= 0; });
  ok(lastVisible, "捲到底看得到 B06");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  ok(be.writes.length === 0, `0 次寫入（${be.writes.join(", ") || "無"}）`);
  await context.close();
}

// ================= 選單入口：管理 → 更多功能 → 現場電視 =================
console.log("== 選單入口 ==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, tvSizes[0][1], be, { atMs: tw("13:30") });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await settle(page, () => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase") && document.querySelectorAll("#workOrderGrid .machine-tile-card").length > 0, "dashboard");
  const readsBefore = be.cardReads;
  await page.locator("#adminDrawerBtn").click();
  const item = page.locator('[data-drawer-module="__tv"]');
  ok(await item.isVisible() && (await item.innerText()).includes("現場電視"), "管理抽屜有「現場電視」");
  const group = await page.evaluate(() => { const el = document.querySelector('[data-drawer-module="__tv"]'); let p = el.previousElementSibling; while (p && !p.classList.contains("admin-drawer-group-title")) p = p.previousElementSibling; return p?.textContent.trim(); });
  ok(group === "更多功能", `在「更多功能」群組（${group}）`);
  await item.click();
  await settle(page, () => document.getElementById("tvWall")?.dataset.tvState === "ok", "tv from menu");
  ok(new URL(page.url()).searchParams.get("view") === "tv", `網址變成 ?view=tv（${page.url()}）`);
  ok(be.cardReads === readsBefore, "開機剛讀過的資料直接用，不多讀一次");
  const lay = await layout(page);
  ok(lay.shellHidden && lay.scrollY <= 0, "切到電視頁：一般畫面藏起來、不捲動");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  ok(be.writes.length === 0, `0 次寫入（${be.writes.join(", ") || "無"}）`);
  await context.close();
}

ok(!blocked.some((u) => u.includes("muditjubqflrqofbkmav")), "沒有打到正式專案", blocked.filter((u) => u.includes("muditjubq")).join(", "));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
