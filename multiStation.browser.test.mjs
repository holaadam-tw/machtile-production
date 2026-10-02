// 逐工序卡片（同一張工單同時在兩台機台）的瀏覽器端到端測試（owner 2026-10-02）。
// 情境照 2026-10-02 實例：XX01202609160002 舊 MES 同時在 A02 做第 2 道、在 B01 做第 3 道。
// v_work_order_cards 一張單只回一道（B01#3）；App 另外讀 work_order_processes 把 A02#2 也掛到 A02 卡片上。
// 不會碰任何真的後端：config.js 換成指向假網域的測試設定，Supabase 請求由這支腳本用假資料回應，其他對外請求一律擋掉。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node multiStation.browser.test.mjs            （截圖寫到 ./.e2e-out/multistation/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node multiStation.browser.test.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MULTISTATION_E2E_OUT || path.join(root, ".e2e-out", "multistation");
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
// 卡片牆的 B01/B02 會建 HMC 品號目錄，目錄只接受 *.supabase.co（子網域 20 個英數字）形式的網址，否則整面卡片牆不渲染；
// 所以用一個不存在的 *.supabase.co 子網域，所有請求都在瀏覽器內攔下、用假資料回應（同 monitorEntry.browser.test.mjs）。
const FAKE = "https://e2emultistationzzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const users = [{ id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) }];
const CODES = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"];
const machineId = (code) => id(200 + CODES.indexOf(code));
const machines = CODES.map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: "", status: "idle", display_order: i, department_name: code.startsWith("A") ? "車床課" : "銑床課",
}));
const AR = "XX01202609160002";
const PROC = "AR16-R01-01_加工製程";
const P = { arStep1: id(351), arStep2: id(352), arStep3: id(353), a01: id(301) };
const card = (woId, wo, machine, procId, status, extra = {}) => ({
  id: woId, tenant_id: T, work_order_no: wo, customer_name: "測試客戶", part_name: wo === AR ? "AR16/AR22泵浦本體" : "零件", drawing_no: "AR16-R01-01",
  quantity: 210, due_date: "2026-10-31", priority: "normal", work_order_status: "in_progress",
  current_process_id: procId, current_process_name: wo === AR ? PROC : "車削", current_process_status: status, machine_name: machine,
  qty_completed: 0, qty_defect: 0, progress_percent: 0, last_report_at: null, open_risk_level: null, current_process_off_station: false, ...extra,
});
// v_work_order_cards: one row per order. AR's current step is B01#3 (what the view picks today).
const cards = [
  card(id(101), AR, "B01", P.arStep3, "pending", { last_report_at: ago(5), open_risk_level: "high" }),
  card(id(102), "XX01202609020008", "A01", P.a01, "running", { quantity: 5000 }),
];
// work_order_processes as the per-step station sync leaves them: A02#2 and B01#3 on station, A03#1 off station.
const procs = [
  { id: P.arStep1, work_order_id: id(101), process_order: 1, process_name: PROC, status: "pending", machine_id: machineId("A03"), qty_completed: 0, off_station_at: ago(600) },
  { id: P.arStep2, work_order_id: id(101), process_order: 2, process_name: PROC, status: "pending", machine_id: machineId("A02"), qty_completed: 0, off_station_at: null },
  { id: P.arStep3, work_order_id: id(101), process_order: 3, process_name: PROC, status: "pending", machine_id: machineId("B01"), qty_completed: 0, off_station_at: null },
  { id: P.a01, work_order_id: id(102), process_order: 3, process_name: "車削", status: "running", machine_id: machineId("A01"), qty_completed: 0, off_station_at: null },
];
const progress = {
  [P.arStep2]: { legacy_output: null, legacy_fail: null, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: null, actual_start_at: ago(120), legacy_synced_at: null },
  [P.arStep3]: { legacy_output: 4, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: ago(60), actual_start_at: ago(300), legacy_synced_at: ago(3) },
  [P.a01]: { legacy_output: 3440, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: ago(30), actual_start_at: ago(400), legacy_synced_at: ago(3) },
};
const procToMachine = { [P.arStep1]: "A03", [P.arStep2]: "A02", [P.arStep3]: "B01", [P.a01]: "A01" };

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
const calls = [];
const procQueries = [];
const blocked = [];
let procsMode = "ok";   // "ok" | "error" (Dev project without off_station_at)

async function handleFake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "op@test.invalid" });
  if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
  if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
  if (p === "/rest/v1/work_order_processes" && url.searchParams.get("off_station_at") === "is.null") {
    procQueries.push(url.search);
    if (procsMode === "error") return json(400, { code: "42703", message: "column work_order_processes.off_station_at does not exist" });
    return json(200, procs.filter((r) => !r.off_station_at));
  }
  if (p === "/rest/v1/work_order_processes") return json(200, []);
  if (p === "/rest/v1/app_users") {
    if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: users[0].name }]);
    return json(200, users.map(({ auth, ...u }) => u));
  }
  if (p === "/rest/v1/rpc/batch_report_progress") {
    const body = JSON.parse(req.postData() || "{}");
    return json(200, (body.p_process_ids || []).filter((pid) => progress[pid]).map((pid) => ({ process_id: pid, ...progress[pid] })));
  }
  if (p === "/rest/v1/rpc/field_report_upsert") {
    const body = JSON.parse(req.postData() || "{}");
    calls.push(body);
    return json(200, { report_id: id(7000 + calls.length), inserted: true });
  }
  if (p.startsWith("/rest/v1/rpc/")) return json(200, null);
  if (p.startsWith("/rest/v1/")) return json(200, []);
  return json(200, {});
}

async function newPage(browser, device) {
  const context = await browser.newContext({ ...device, serviceWorkers: "block" });
  await context.addInitScript(([token]) => {
    try {
      sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
    } catch {}
  }, [jwt]);
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, errors };
}

async function waitLoaded(page, query = "") {
  await page.goto(base + query, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
}

const tile = (page, code) => page.locator("#workOrderGrid .machine-tile-card").filter({ has: page.locator("h2", { hasText: code }) }).first();
const selectedProcess = (page) => page.evaluate(() => (typeof selectedOrder !== "undefined" && selectedOrder ? selectedOrder.processId : null));
const realErrors = (errors) => errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

console.log("== 平板：Monitor 卡片（同一張單在 A02 第 2 道＋B01 第 3 道）==");
{
  const { context, page, errors } = await newPage(browser, { ...devices["iPad (gen 7)"], defaultBrowserType: undefined });
  await waitLoaded(page);
  await page.locator("#workOrderGrid .machine-tile-card").first().waitFor();
  ok(procQueries.length >= 1 && procQueries[0].includes("machine_id=not.is.null"), "讀在站工序（off_station_at=is.null、有機台）", procQueries[0] || "");
  const a02 = await tile(page, "A02").innerText();
  const b01 = await tile(page, "B01").innerText();
  const a03 = await tile(page, "A03").innerText();
  const a01 = await tile(page, "A01").innerText();
  ok(a02.includes(AR) && a02.includes("第 2 道"), "A02 卡片顯示 XX01202609160002（第 2 道），不再是空閒", a02.slice(0, 200));
  ok(b01.includes(AR) && b01.includes("第 3 道"), "B01 卡片照常顯示 XX01202609160002（第 3 道）", b01.slice(0, 200));
  ok(!a03.includes(AR), "A03（舊 MES 已移走的第 1 道）不顯示這張單");
  ok(a01.includes("XX01202609020008") && !a01.includes("第 3 道"), "只在一台的單：卡片跟原本一樣（不加「第 N 道」）");
  const a02Footer = (await tile(page, "A02").locator(".machine-tile-footer").innerText()).trim();
  const b01Footer = (await tile(page, "B01").locator(".machine-tile-footer").innerText()).trim();
  ok(a02Footer.includes("尚未回報") && !b01Footer.includes("尚未回報"), "審查 #45：A02 的「最後回報」是第 2 道自己的（尚未回報），不是 B01 那道的時間", `A02=${a02Footer} | B01=${b01Footer}`);
  ok(a02.includes("整單 ·") && !b01.includes("整單 ·"), "審查 #45：A02 卡片上工單風險標「整單」（風險掛在整張單）", a02.slice(0, 240));
  await page.screenshot({ path: path.join(outDir, "01-tablet-monitor.png"), fullPage: true });

  // A02 card: 回報 opens the report sheet on A02's step (process_id of step 2), not B01's
  await tile(page, "A02").locator(".machine-report-button").click();
  await page.locator("#reportSheet.is-open").waitFor();
  ok((await page.locator("#reportMachine").innerText()).trim() === "A02", "A02 卡片「回報」：報工畫面機台＝A02");
  ok(await selectedProcess(page) === P.arStep2, "A02 卡片「回報」：報工對到第 2 道（A02 的工序 id）", String(await selectedProcess(page)));
  await page.evaluate(() => closeReport());

  // B01 card: 明細 picks B01's step (step 3)
  await tile(page, "B01").locator(".machine-detail-button").click();
  await page.locator("#detailSheet.is-open").waitFor();
  ok(await selectedProcess(page) === P.arStep3, "B01 卡片「明細」：對到第 3 道（B01 的工序 id）", String(await selectedProcess(page)));
  await page.screenshot({ path: path.join(outDir, "02-tablet-b01-detail.png") });
  // 從 B01 明細進報工：仍是第 3 道
  const openBtn = page.locator('#detailSheet [data-open-report-type="dailyStart"]');
  if (await openBtn.count()) {
    await openBtn.first().click();
    await page.locator("#reportSheet.is-open").waitFor();
    ok(await selectedProcess(page) === P.arStep3 && (await page.locator("#reportMachine").innerText()).trim() === "B01", "B01 明細→今日開工：報工仍是 B01 第 3 道");
    await page.evaluate(() => closeReport());
  } else {
    ok(true, "B01 明細沒有開工按鈕（依權限），略過");
  }
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤（排除假網域觸發的 CATALOG_ENDPOINT_INVALID）", realErrors(errors).join(" | "));
  await context.close();
}

console.log("== 手機：只帶單號＋機台開報工（舊連結／警示的參照方式）==");
{
  // 註：/m/report 路由（P0）目前不讀 Supabase、只用示範資料，這裡直接呼叫同一個 openReport(單號, { machine })。
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"]);
  await waitLoaded(page);
  await page.locator("#workOrderGrid .machine-tile-card").first().waitFor();
  await page.evaluate((wo) => openReport(wo, { machine: "A02", reportType: "dailyStart" }), AR);
  await page.locator("#reportSheet.is-open").waitFor();
  ok(await selectedProcess(page) === P.arStep2 && (await page.locator("#reportMachine").innerText()).trim() === "A02", "openReport(XX01202609160002, A02) → A02 第 2 道（不是 B01 第 3 道）", String(await selectedProcess(page)));
  await page.evaluate(() => closeReport());
  await page.evaluate((wo) => openReport(wo, { machine: "B01", reportType: "dailyStart" }), AR);
  ok(await selectedProcess(page) === P.arStep3, "openReport(XX01202609160002, B01) → B01 第 3 道");
  await page.evaluate(() => closeReport());
  await page.evaluate((wo) => openDetail(wo), AR);
  ok(await selectedProcess(page) === P.arStep3, "只帶單號（舊工單連結）→ 原本那筆（view 挑的 B01 第 3 道）");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("== 手機：車床批次報工 A02 報這張單 ==");
{
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"]);
  await waitLoaded(page);
  await page.locator('.mobile-tab[data-view="batchLathe"]').click();
  const lathe = page.locator('[data-batch-root="lathe"]');
  await lathe.locator('[data-batch-row="A02"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled);
  const a02Row = await lathe.locator('[data-batch-row="A02"]').innerText();
  ok(a02Row.includes(AR) && a02Row.includes("第 2 道"), "批次：A02 列帶出 XX01202609160002 第 2 道", a02Row.slice(0, 160));
  ok(!(await lathe.locator('[data-batch-row="A02"] [data-batch-good]').isDisabled()), "A02 可以填數量");
  await lathe.locator('[data-batch-row="A02"] [data-batch-good]').fill("10");
  await lathe.locator("[data-batch-submit]").click();
  await page.waitForFunction(() => document.querySelector('[data-batch-root="lathe"] [data-batch-row="A02"] .batch-result')?.textContent.includes("已送出"), null, { timeout: 15000 });
  ok(calls.length === 1, `只送 1 筆（${calls.length}）`);
  const pl = calls[0]?.p_payload || {};
  ok(pl.process_id === P.arStep2 && procToMachine[pl.process_id] === "A02", "報工 process_id＝A02 第 2 道（回寫橋就會寫 StationNO=A02、IndexSN=2）", JSON.stringify({ process_id: pl.process_id }));
  ok(pl.completed_qty === 10 && pl.started_at === progress[P.arStep2].actual_start_at, "數量 10、started_at＝第 2 道的開工時間");
  await page.screenshot({ path: path.join(outDir, "04-phone-batch-a02.png"), fullPage: true });
  ok(realErrors(errors).length === 0, "批次沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("== 退回：讀不到在站工序（例：Dev 專案沒有 off_station_at）==");
{
  procsMode = "error";
  const { context, page, errors } = await newPage(browser, { ...devices["iPad (gen 7)"], defaultBrowserType: undefined });
  await waitLoaded(page);
  await page.locator("#workOrderGrid .machine-tile-card").first().waitFor();
  const a02 = await tile(page, "A02").innerText();
  const b01 = await tile(page, "B01").innerText();
  ok(!a02.includes(AR) && b01.includes(AR) && !b01.includes("第 3 道"), "退回一單一筆：B01 照常、A02 空著，畫面不壞");
  ok(realErrors(errors).length === 0, "退回時沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
  procsMode = "ok";
}

await browser.close();
server.close();

const prodHits = blocked.filter((u) => u.includes("muditjubqflrqofbkmav") || u.includes("machtile.com"));
ok(prodHits.length === 0, "沒有任何請求打到正式後端／正式網域", prodHits.join(" "));
console.log(`\n${pass} passed, ${fail} failed  (screenshots: ${outDir})`);
process.exit(fail ? 1 : 0);
