// 營運分析三區塊（稼動率／產量實際 vs 估算／交期風險）——瀏覽器端到端測試（Playwright，手機＋平板，假時鐘）。
// 不會碰任何真的後端：config.js 換成指向假專案網域的測試設定，所有 Supabase 請求由這支腳本攔截、用假資料回應；
// 其他對外請求一律擋掉並記錄（最後斷言一次都沒有打到正式專案）。瀏覽器時區故意設成美西，證明用的是台灣時間。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node analytics.browser.test.mjs            （截圖寫到 ./.e2e-out/analytics/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node analytics.browser.test.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { assignedCardFixture } from "./assignedCardFixture.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.CARD_E2E_OUT || path.join(root, ".e2e-out", "analytics");
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

// ---------- fixtures（台灣 2026-10-02 週五 15:00）----------
const FAKE = "https://e2eanalyticszzzzzzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DAY = "2026-10-02";
const tw = (hhmm, day = DAY) => Date.parse(`${day}T${hhmm}:00+08:00`);
const twIso = (hhmm, day = DAY) => new Date(tw(hhmm, day)).toISOString();
const NOW = tw("15:00");

const users = [{ id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) }];
const CODES = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"];
const machines = CODES.map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: "", status: "idle", display_order: i,
}));
const mid = (code) => id(200 + CODES.indexOf(code));
const card = (n, wo, machine, extra = {}) => ({
  id: id(100 + n), tenant_id: T, work_order_no: wo, customer_name: "測試客戶", part_name: `零件${n}`, drawing_no: null,
  quantity: 400, due_date: "2026-10-20", priority: "normal", work_order_status: "in_progress",
  current_process_id: id(300 + n), current_process_name: machine.startsWith("A") ? "車削" : "銑削",
  current_process_status: "running", machine_name: machine, qty_completed: 0, qty_defect: 0, progress_percent: 0,
  last_report_at: twIso("08:00"), open_risk_level: null, current_process_off_station: false, ...extra,
});
const cards = [
  card(1, "WO-A01", "A01", { quantity: 1000, due_date: "2026-10-05" }),
  card(2, "WO-A02", "A02"),
  card(3, "WO-A03", "A03"),
  card(4, "WO-A04-LATE", "A04", { quantity: 100, due_date: "2026-09-28" }),
  card(5, "WO-A05", "A05", { quantity: 100, due_date: "2026-10-05" }),
  card(6, "WO-B03", "B03"),
  card(7, "WO-B04-OVER", "B04", { quantity: 100, due_date: "2026-10-03" }),
  card(8, "WO-B05", "B05"),
];
// 舊 MES 已報（batch_report_progress）：A01 已報 300（舊 MES 200＋待回寫 100）、B04 已報 120（超量）
const progress = { [id(301)]: { legacy_output: 200, pending_output: 100 }, [id(307)]: { legacy_output: 120, pending_output: 0 } };

const P = (n) => id(300 + n);
const rep = (n, code, type, hhmm, day = DAY, extra = {}) => ({
  id: id(5000 + Math.floor(Math.random() * 1e6)), process_id: P(n), machine_id: mid(code), report_type: type,
  started_at: null, ended_at: twIso(hhmm, day), created_at: twIso(hhmm, day), completed_qty: 0, defect_qty: 0,
  cycle_time_seconds: null, overtime_plan: "", user_id: users[0].id, operator_ids: [users[0].id], ...extra,
});
const fullRows = [
  // A05：機台加工時間 600 秒（9/25，7 天以前填的）→ 卡片估算 430×60÷(600+60)=39 件／天
  rep(5, "A05", "noon", "10:00", "2026-09-25", { cycle_time_seconds: 600, started_at: twIso("10:00", "2026-09-25") }),
  // A01：9/30 只有中午 100 件（沒有今日開工）；10/1 開工＋收工 100 件；今天開工＋中午 100 件並填機台加工時間 60 秒
  rep(1, "A01", "noon", "12:00", "2026-09-30", { completed_qty: 100 }),
  rep(1, "A01", "dailyStart", "08:00", "2026-10-01"),
  rep(1, "A01", "finish", "17:00", "2026-10-01", { completed_qty: 100, started_at: twIso("08:00", "2026-10-01"), overtime_plan: "none" }),
  rep(1, "A01", "dailyStart", "08:00"),
  rep(1, "A01", "noon", "12:00", DAY, { completed_qty: 100, cycle_time_seconds: 60, started_at: twIso("08:00") }),
  // A02：開工＋50 件，沒填機台加工時間
  rep(2, "A02", "dailyStart", "08:00"),
  rep(2, "A02", "noon", "12:00", DAY, { completed_qty: 50, started_at: twIso("08:00") }),
  // A03：只有開工
  rep(3, "A03", "dailyStart", "08:30"),
  // B03：開工＋30 件、機台加工時間 300 秒
  rep(6, "B03", "dailyStart", "08:00"),
  rep(6, "B03", "noon", "12:00", DAY, { completed_qty: 30, cycle_time_seconds: 300, started_at: twIso("08:00") }),
];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: users[0].auth, email: "pl@test.invalid", exp: Math.floor(Date.parse("2026-10-03T00:00:00Z") / 1000) + 86400 * 30, role: "authenticated", app_metadata: { tenant_id: T, role: "planner" } })}.sig`;
const testConfig = `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key-for-e2e-only", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: true, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
};`;

// ---------- fake backend ----------
function makeBackend({ rows = fullRows, failAnalytics = false, failCycle = false } = {}) {
  const b = { writes: [], analyticsReads: [], cycleReads: [], rows };
  b.handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const sp = url.searchParams;
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() !== "GET") b.writes.push(`${req.method()} ${p}`);
    if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "pl@test.invalid" });
    if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
    if (p === "/rest/v1/work_order_processes" && (url.searchParams.get("select") || "").includes("work_orders!inner")) {
      return json(200, assignedCardFixture(cards, machines));
    }
    if (p === "/rest/v1/rpc/machine_department_context") {
      return json(200, { tenant_id: T, all_departments: true, department_codes: ["LATHE", "MILL"] });
    }
    if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
    if (p === "/rest/v1/machines") return json(200, machines.map((m) => ({ id: m.id, machine_code: m.machine_code })));
    if (p === "/rest/v1/app_users") {
      if (sp.get("auth_user_id")) return json(200, [{ id: users[0].id, name: users[0].name }]);
      return json(200, users.map(({ auth, ...u }) => u));
    }
    if (p === "/rest/v1/production_reports") {
      const select = sp.get("select") || "";
      const isAnalytics = select.includes("overtime_plan:report_payload->>overtime_plan");
      if (isAnalytics) {
        b.analyticsReads.push(decodeURIComponent(url.search));
        if (failAnalytics) return json(500, { message: "fake server down" });
      }
      let list = rows.filter((r) => Date.parse(r.created_at) <= NOW);
      const gte = (sp.get("created_at") || "").match(/^gte\.(.+)$/);
      if (gte) list = list.filter((r) => Date.parse(r.created_at) >= Date.parse(gte[1]));
      const inp = (sp.get("process_id") || "").match(/^in\.\((.*)\)$/);
      if (inp) {
        const set = new Set(inp[1].split(","));
        list = list.filter((r) => set.has(r.process_id));
      }
      if (sp.get("cycle_time_seconds") === "not.is.null") {
        if (select === "process_id,cycle_time_seconds,created_at" && sp.get("limit") === "1000" && !sp.has("report_type")) b.cycleReads.push(1);
        if (failCycle && select === "process_id,cycle_time_seconds,created_at") return json(500, { message: "cycle lookup down" });
        list = list.filter((r) => r.cycle_time_seconds != null);
      }
      const types = (sp.get("report_type") || "").match(/^in\.\((.*)\)$/);
      if (types) { const set = new Set(types[1].split(",")); list = list.filter((r) => set.has(r.report_type)); }
      const desc = (sp.get("order") || "").includes("desc");
      list = [...list].sort((a, c) => (a.created_at < c.created_at ? -1 : 1));
      if (desc) list.reverse();
      return json(200, list.map((r) => ({ ...r, work_order_processes: { machine_id: r.machine_id, process_name: "車削" }, work_orders: { drawing_no: null, part_no: "P", part_name: "零件" } })));
    }
    if (p === "/rest/v1/rpc/batch_report_progress") {
      const body = JSON.parse(req.postData() || "{}");
      return json(200, (body.p_process_ids || []).map((pid) => {
        const pr = progress[pid];
        return { process_id: pid, legacy_output: pr ? pr.legacy_output : null, legacy_fail: pr ? 0 : null, pending_output: pr ? pr.pending_output : 0, pending_fail: 0, pending_count: pr && pr.pending_output ? 1 : 0, oldest_pending_at: null, last_report_at: null, actual_start_at: null, legacy_synced_at: null };
      }));
    }
    if (p.startsWith("/rest/v1/rpc/")) return json(200, []);
    if (p.startsWith("/rest/v1/")) return json(200, []);
    return json(200, {});
  };
  return b;
}

const blocked = [];
async function newPage(browser, device, backend, { storage = {} } = {}) {
  const context = await browser.newContext({ ...device, serviceWorkers: "block", timezoneId: "America/Los_Angeles" });
  await context.addInitScript(([token, store]) => {
    try {
      sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "pl@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
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
  await page.clock.install({ time: NOW - 2000 });
  await page.clock.pauseAt(NOW);
  page.on("dialog", (d) => d.accept());
  const errors = [];
  if (process.env.CARD_DEBUG) page.on("console", (m) => { if (m.type() !== "log") console.log("CONSOLE", m.type(), m.text().slice(0, 300)); });
  page.on("pageerror", (e) => { errors.push(String(e)); if (process.env.CARD_DEBUG) console.log("PAGEERROR", String(e)); });
  return { context, page, errors };
}

async function openAnalytics(page) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) {
    const done = await page.evaluate(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase")
      && document.querySelectorAll("#workOrderGrid .machine-tile-card").length > 0).catch(() => false);
    if (done) break;
    await page.clock.runFor(50);
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => switchView("reports"));
  for (let i = 0; i < 80; i++) {
    const st = await page.evaluate(() => document.querySelector("#machtileAnalytics [data-analytics-section], #machtileAnalytics [data-analytics-state=error]") !== null).catch(() => false);
    if (st) return;
    await page.clock.runFor(50);
    await page.waitForTimeout(50);
  }
  throw new Error("analytics never rendered: " + await page.evaluate(() => document.getElementById("machtileAnalytics")?.innerText.slice(0, 300)));
}

const utilRows = (page) => page.evaluate(() => [...document.querySelectorAll("[data-util-machine]")].map((el) => ({
  code: el.dataset.utilMachine, status: el.dataset.utilStatus, value: el.querySelector("[data-util-value]")?.textContent.trim(),
  reason: el.querySelector("[data-util-reason]")?.textContent.trim() || "", lowest: el.classList.contains("is-lowest"), text: el.innerText,
})));
const outRows = (page) => page.evaluate(() => [...document.querySelectorAll("[data-out-machine]")].map((el) => ({
  code: el.dataset.outMachine, status: el.dataset.outStatus, text: el.innerText.replace(/\s+/g, " "),
  reason: el.querySelector("[data-out-reason]")?.textContent.trim() || "",
})));
const riskRows = (page) => page.evaluate(() => [...document.querySelectorAll("[data-risk-wo]")].map((el) => ({
  wo: el.dataset.riskWo, level: el.dataset.riskLevel, text: el.innerText.replace(/\s+/g, " "), basis: el.querySelector("[data-risk-basis]")?.dataset.riskBasis,
})));
const realErrors = (errors) => errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));
const mutatingWrites = (be) => be.writes.filter((w) => !w.startsWith("POST /rest/v1/rpc/") || /upsert|insert|update|delete|reorder|submit/i.test(w));

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const phone = devices["Pixel 7"];
const tablet = { ...devices["iPad (gen 7)"], defaultBrowserType: undefined };
const phone360 = { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } };

// ================= 完整資料：今天 =================
for (const [devName, device, tag] of [["手機 360px", phone360, "phone"], ["平板（iPad）", tablet, "tablet"]]) {
  console.log(`== 15:00 今天 ${devName} ==`);
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, device, be);
  await openAnalytics(page);
  ok(be.analyticsReads.length === 1, `只讀一次近 7 天報工（${be.analyticsReads.length}）`);
  ok(be.analyticsReads[0]?.includes(`created_at=gte.${new Date(tw("00:00", "2026-09-26")).toISOString()}`), "查詢下限＝台灣 9/26 00:00（近 7 天）", be.analyticsReads[0]);
  ok(/limit=5000/.test(be.analyticsReads[0] || ""), "有筆數上限");
  ok(be.cycleReads.length >= 1, "另外讀了工序歷次的機台加工時間");

  const u = await utilRows(page);
  ok(u.length === 11, `11 台都列出（${u.length}）`);
  ok(JSON.stringify(u.slice(0, 2).map((r) => [r.code, r.value])) === JSON.stringify([["A01", "24%"], ["B03", "36%"]]), "有數字的由低到高：A01 24%（100×60秒÷7時）、B03 36%（30×300秒÷7時）", JSON.stringify(u.slice(0, 3)));
  ok(u[0].lowest && !u[1].lowest, "最低的標「最低」（A01），最高的不標");
  ok(u[0].text.includes("報工覆蓋 57%"), "A01 報工覆蓋＝08–12 ÷ 08–15＝57%", u[0].text);
  const byU = Object.fromEntries(u.map((r) => [r.code, r]));
  ok(byU.A02.value === "—" && byU.A02.reason.includes("未填機台加工時間"), "A02 沒填機台加工時間 → 寫原因、不顯示 0%", JSON.stringify(byU.A02));
  ok(byU.A03.reason === "已開工，還沒有數量報工", "A03 已開工沒數量 → 原因", JSON.stringify(byU.A03));
  ok(byU.A04.reason === "今日未開工" && byU.A05.reason === "今日未開工" && byU.B06.reason === "今日未開工", "沒報工的機台＝今日未開工");
  ok(!u.some((r) => r.value === "0%"), "沒有任何一台顯示 0%");

  const o = await outRows(page);
  ok(JSON.stringify(o.slice(0, 2).map((r) => r.code)) === JSON.stringify(["A01", "B03"]), "產量：落後最多的在前（A01 −115、B03 −23）", JSON.stringify(o.map((r) => r.code)));
  ok(/實際良品 100 件 估算 215 件 差額 −115 件 達成率 47%/.test(o[0].text), "A01：實際 100、估算 215（430×60÷(60+60)）、差 −115、達成 47%", o[0].text);
  ok(/實際良品 30 件 估算 53 件 差額 −23 件 達成率 57%/.test(o[1].text), "B03：實際 30、估算 53（430×60÷(300+180)）", o[1].text);
  const byO = Object.fromEntries(o.map((r) => [r.code, r]));
  ok(byO.A02.status === "noEstimate" && byO.A02.text.includes("估算缺值") && byO.A02.text.includes("實際良品 50 件"), "A02 估算缺值有標出、實際照列", byO.A02.text);
  ok(byO.A04.status === "notOpened" && byO.A04.text.includes("實際良品 —") && byO.A04.reason === "今日未開工", "A04 今日未開工：實際不補 0", byO.A04.text);
  ok(byO.B01.reason === "今日未開工", "B01 沒工單也沒報工＝今日未開工");

  const rk = await riskRows(page);
  ok(JSON.stringify(rk.map((r) => [r.wo, r.level])) === JSON.stringify([["WO-A04-LATE", "overdue"], ["WO-A01", "late"], ["WO-A05", "late"], ["WO-B03", "late"]]), "交期風險依嚴重度：逾期 → 延誤 → 緊", JSON.stringify(rk.map((r) => [r.wo, r.level])));
  ok(rk[0].text.includes("已逾期 4 天"), "A04 已逾期 4 天", rk[0].text);
  ok(rk[1].text.includes("會延誤 7 天") && rk[1].basis === "actual" && rk[1].text.includes("100 件／天") && rk[1].text.includes("10/12") && rk[1].text.includes("已報 300/1000・含舊 MES・待回寫 100"), "A01：已報 300（舊 MES＋待回寫）、實際 100 件／天、預計 10/12（週六日不算）、延誤 7 天", rk[1].text);
  ok(rk[2].basis === "estimate" && rk[2].text.includes("估算") && rk[2].text.includes("39 件／天") && rk[2].text.includes("10/05"), "A05：速度用估算並標「估算」、預計 10/05", rk[2].text);
  ok(rk[3].basis === "actual" && rk[3].text.includes("10/21") && rk[3].text.includes("會延誤 1 天"), "B03：實際 30 件／天、預計 10/21（週六日不算）、交期 10/20 → 延誤 1 天", rk[3].text);
  ok(!rk.some((r) => r.wo === "WO-B04-OVER"), "超量的 B04 不列");
  const summary = await page.locator("[data-risk-summary]").innerText();
  ok(summary.includes("已報滿／超量 1 張不列") && summary.includes("資料不足 2 張") && summary.includes("OK 1 張"), "摘要：超量 1、資料不足 2（A03、B05）、OK 1（A02）", summary);
  const formulas = await page.evaluate(() => [...document.querySelectorAll(".analytics-formula")].map((d) => d.textContent));
  ok(formulas.length === 3 && formulas[1].includes("估算") && formulas[1].includes("430 分") && formulas[2].includes("週六、週日不算"), "三個區塊都有公式說明（估算標明、週六日不算）");
  ok(await page.locator("#reportsLegacy").count() === 1 && !(await page.locator("#reportsLegacy").evaluate((d) => d.open)), "原本內容收在下方摺疊（預設收起）");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `沒有橫向捲動（${overflow}px）`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(outDir, `${tag}-today.png`), fullPage: true });

  // 切近 7 天
  await page.locator('[data-analytics-range="7d"]').click();
  await page.waitForTimeout(100);
  const u7 = await utilRows(page);
  const a7 = u7.find((r) => r.code === "A01");
  ok(a7.value === "21%" && a7.text.includes("（2 天）"), "近 7 天 A01：(100+100)×60 ÷ (9時＋7時)＝21%，2 天", a7.text);
  ok(a7.text.includes("1 天有數量報工但沒有「今日開工」") && a7.text.includes("卡片"), "註明 9/30 沒有開工紀錄、10/1 那筆用卡片的機台加工時間", a7.text);
  const o7 = (await outRows(page)).find((r) => r.code === "A01");
  ok(/實際良品 300 件 估算 645 件/.test(o7.text) && o7.text.includes("開工 3 天 × 每日估算 215 件"), "近 7 天 A01：實際 300、估算 215×3 天", o7.text);
  const totals = await page.locator("[data-out-totals]").innerText();
  ok(totals.includes("09/30") && totals.includes("10/02") && totals.includes("無報工") && totals.includes("180 件"), "每天合計：沒報工的天寫「無報工」、今天 180 件", totals);
  ok(await page.evaluate(() => localStorage.getItem("machtile-analytics-range")) === "7d", "記住期間選項");
  ok(be.analyticsReads.length === 1, "切換期間不重查");
  ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, "近 7 天也沒有橫向捲動");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(outDir, `${tag}-7d.png`), fullPage: true });

  // 打開原本的內容
  await page.locator("#reportsLegacy > summary").click();
  await page.waitForTimeout(150);
  ok(await page.locator("#reportsLegacy").evaluate((d) => d.open) && (await page.locator("#reportsLegacy").innerText()).includes("各機台目前工單進度"), "摺疊打開看得到原本內容");

  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  ok(mutatingWrites(be).length === 0, `0 次寫入（非 GET：${[...new Set(be.writes)].join(", ") || "無"}）`, mutatingWrites(be).join(", "));
  await context.close();
}

// ================= 資料不足（10/2 以前幾乎沒有 App 報工的真實狀況）=================
console.log("== 沒有任何報工 → 資料不足 ==");
{
  const be = makeBackend({ rows: [] });
  const { context, page, errors } = await newPage(browser, phone360, be);
  await openAnalytics(page);
  const empties = await page.locator("[data-analytics-empty]").allInnerTexts();
  ok(empties.length === 2 && empties[0].startsWith("資料不足") && empties[1].startsWith("資料不足"), "稼動率、產量都寫「資料不足」", JSON.stringify(empties));
  const u = await utilRows(page);
  ok(u.every((r) => r.value === "—" && r.reason === "今日未開工"), "每台都是「—」＋今日未開工，沒有 0%");
  const o = await outRows(page);
  ok(o.every((r) => r.text.includes("實際良品 —")), "實際產量沒有補 0");
  const rk = await riskRows(page);
  ok(rk.length === 1 && rk[0].wo === "WO-A04-LATE", "交期：只剩逾期的 A04（不需要速度就知道）", JSON.stringify(rk.map((r) => r.wo)));
  const summary = await page.locator("[data-risk-summary]").innerText();
  ok(summary.includes("資料不足 6 張"), "交期資料不足 6 張（沒有報工也就沒有實際日產、也沒有填過機台加工時間）", summary);
  await page.screenshot({ path: path.join(outDir, "phone-nodata.png"), fullPage: true });
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  ok(mutatingWrites(be).length === 0, "0 次寫入");
  await context.close();
}

// ================= 讀取失敗 =================
console.log("== 報工讀取失敗 → 錯誤訊息、不顯示任何數字 ==");
{
  const be = makeBackend({ failAnalytics: true });
  const { context, page, errors } = await newPage(browser, phone360, be);
  await openAnalytics(page);
  const err = page.locator('#machtileAnalytics [data-analytics-state="error"]');
  ok(await err.count() === 1 && (await err.innerText()).includes("讀取失敗") && (await err.innerText()).includes("不顯示假資料"), "顯示讀取失敗", await err.innerText());
  ok(await page.locator("[data-util-machine], [data-out-machine], [data-risk-wo]").count() === 0, "三個區塊都沒有顯示任何數字");
  await page.screenshot({ path: path.join(outDir, "phone-error.png"), fullPage: false });
  ok(await page.locator("[data-analytics-retry]").count() === 1, "有「重新讀取」按鈕");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  ok(mutatingWrites(be).length === 0, "0 次寫入");
  await context.close();
}
console.log("== 機台加工時間讀取失敗 → 只有稼動率顯示錯誤 ==");
{
  const be = makeBackend({ failCycle: true });
  const { context, page, errors } = await newPage(browser, phone360, be);
  await openAnalytics(page);
  const util = page.locator('[data-analytics-section="utilization"]');
  ok((await util.innerText()).includes("機台加工時間讀取失敗") && await page.locator("[data-util-machine]").count() === 0, "稼動率區塊顯示錯誤、不給數字", await util.innerText());
  ok(await page.locator("[data-out-machine]").count() === 11 && await page.locator("[data-risk-wo]").count() > 0, "產量、交期照常");
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
