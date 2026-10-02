// Monitor 機台卡片：超量（已報良品 ≥ 訂單數量）仍在站的單照樣顯示（owner 2026-10-02）——瀏覽器端到端測試（Playwright，手機）。
//   起因：派工橋改讀 SFC 後，B05 XX01202606050003 HCG(HG)-06長蓋 已報 689／訂單 536，被「已報 ≥ 數量＝做完」排除，
//   B05 卡片變成「無工單指派中」，但現場 16:15 還在舊 MES 報這張單。
//   1. 超量單照樣顯示：B05 卡片＝HCG-06、紅色「超量 +153」、完成進度 689/536、128%、進度條滿格紅色。
//   2. 剛好報滿（194/194）也照樣是候選，「這台還掛 N 張」清單裡標「已報滿」；最近活動挑單規則不變。
//   3. 已離站（off_station_at 有值）或工單已完工的超量單照樣不顯示。
//   4. 報工畫面（單台、批次）選到超量單 → 紅字提醒，但照樣可以送出（不擋報工）。
// 不會碰任何真的後端：config.js 換成指向假專案網域的測試設定，所有 Supabase 請求由這支腳本攔截、用假資料回應；
// 其他對外請求一律擋掉並記錄（最後斷言一次都沒有打到正式專案）。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node cardOverQty.browser.test.mjs            （截圖寫到 ./.e2e-out/card-overqty/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node cardOverQty.browser.test.mjs
//   只拍截圖（例：拿改前的程式拍對照）：CARD_OVERQTY_ROOT=<另一份 repo 目錄> CARD_OVERQTY_SHOT_ONLY=before node cardOverQty.browser.test.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = process.env.CARD_OVERQTY_ROOT ? path.resolve(process.env.CARD_OVERQTY_ROOT) : path.dirname(fileURLToPath(import.meta.url));
const shotOnly = process.env.CARD_OVERQTY_SHOT_ONLY || "";
const outDir = process.env.CARD_OVERQTY_E2E_OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), ".e2e-out", "card-overqty");
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

// ---------- fixtures（假資料，數字照 2026-10-02 正式庫唯讀查到的樣子）----------
const FAKE = "https://e2ecardoverqtyzzzzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const users = [{ id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) }];
const card = (n, wo, part, machine, qty, extra = {}) => ({
  id: id(100 + n), tenant_id: T, work_order_no: wo, customer_name: "測試客戶", part_name: part, drawing_no: null,
  quantity: qty, due_date: "2026-10-30", priority: "normal", work_order_status: "not_started",
  current_process_id: id(300 + n), current_process_name: "加工製程", current_process_status: "pending",
  machine_name: machine, qty_completed: 0, qty_defect: 0, progress_percent: 0,
  last_report_at: null, open_risk_level: null, current_process_off_station: false, ...extra,
});
const cards = [
  card(1, "XX01202609020008", "MPW-01止油閥座", "A01", 5000),
  // B03：A37 在做（最近活動）＋BR-03 剛好報滿 194/194（以前會被排除）
  card(31, "XX01202606300001", "A37軸蓋", "B03", 196),
  card(32, "XX01202609170001", "BR-03背壓板", "B03", 194),
  // B05：HCG-06 超量 689/536 在站；另外兩張工單 completed（不顯示）
  card(51, "XX01202606050003", "HCG(HG)-06長蓋", "B05", 536),
  card(52, "XX01202605220021", "AR16(22)泵浦上蓋", "B05", 317, { work_order_status: "completed" }),
  card(53, "XX01202601210013", "A37泵浦上蓋", "B05", 111, { work_order_status: "completed" }),
  // B06：超量但已離站、超量但工單已完工 → 都不顯示 → 「無工單指派中」
  card(61, "XX01202609300061", "已離站超量件", "B06", 100, { current_process_off_station: true }),
  card(62, "XX01202609300062", "已完工超量件", "B06", 100, { work_order_status: "completed" }),
];
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: { B05: "大立" }[code] || "", status: "idle", display_order: i,
}));
const prog = (legacyOutput, legacyFail, legacyAt, extra = {}) => ({
  legacy_input: null, legacy_output: legacyOutput, legacy_fail: legacyFail, legacy_updated_at: legacyAt,
  legacy_snapshot_at: legacyAt, legacy_synced_at: legacyAt, pending_output: 0, pending_fail: 0, pending_count: 0,
  oldest_pending_at: null, last_report_at: null, actual_start_at: null, ...extra,
});
const progress = {
  [id(301)]: prog(3440, 2, ago(600)),
  [id(331)]: prog(143, 1, ago(30)),
  [id(332)]: prog(194, 0, ago(1500)),
  [id(351)]: prog(689, 10, ago(20), { actual_start_at: ago(3000) }),
  [id(361)]: prog(150, 0, ago(10)),
  [id(362)]: prog(150, 0, ago(10)),
};

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
const calls = [];          // field_report_upsert bodies（報工有沒有被擋）
const writes = [];         // 其他寫入（不該有：不改資料庫、不標離站、不改工單狀態）
const blocked = [];
const procToMachine = Object.fromEntries(cards.map((c) => [c.current_process_id, c.machine_name]));
async function handleFake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const q = decodeURIComponent(url.search);
  const method = req.method();
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "op@test.invalid" });
  if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
  if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
  if (p === "/rest/v1/app_users") {
    if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: users[0].name }]);
    return json(200, users.map(({ auth, ...u }) => u));
  }
  if (p === "/rest/v1/rpc/field_report_upsert") {
    const body = JSON.parse(req.postData() || "{}");
    calls.push(body);
    return json(200, { report_id: id(7000 + calls.length), inserted: true });
  }
  const readRpc = /^\/rest\/v1\/rpc\/(batch_report_progress|[a-z_]+_snapshot|[a-z_]+_list)$/.test(p);
  if (method !== "GET" && method !== "HEAD" && !readRpc) writes.push(`${method} ${p}`);
  if (p === "/rest/v1/work_order_processes") {
    if (q.includes("queue_order=not.is.null")) return json(200, []);
    const m = q.match(/id=in\.\(([^)]*)\)/);
    if (m && q.includes("actual_start_at")) return json(200, m[1].split(",").map((pid) => ({ id: pid, process_order: 1, actual_start_at: progress[pid]?.actual_start_at || null })));
    return json(200, []);
  }
  if (p === "/rest/v1/legacy_station_progress") return json(200, []);
  if (p === "/rest/v1/rpc/batch_report_progress") {
    const body = JSON.parse(req.postData() || "{}");
    return json(200, (body.p_process_ids || []).filter((pid) => progress[pid]).map((pid) => ({ process_id: pid, ...progress[pid] })));
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
      localStorage.setItem("machtile.cardOrdersOpen.v1", JSON.stringify(["B03"]));
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

async function waitLoaded(page) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid .machine-tile-card").length > 0, null, { timeout: 20000 });
  // 等卡片活動時間載入完（卡片挑單依最近活動）
  await page.waitForFunction(() => typeof machtileCardPickState === "undefined" || machtileCardPickState.status === "ready", null, { timeout: 20000 });
  await page.evaluate(() => { deriveMachines(); renderWorkOrders(); });
}

const cardOf = (page, code) => page.locator("#workOrderGrid .machine-tile-card").filter({ has: page.locator("h2", { hasText: code }) }).first();
const realErrors = (errors) => errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

if (shotOnly) {
  // 只拍 B05 卡片（給改前／改後對照用），不做斷言
  const { context, page } = await newPage(browser, devices["Pixel 7"]);
  await waitLoaded(page);
  const b05 = cardOf(page, "B05");
  await b05.scrollIntoViewIfNeeded();
  await b05.screenshot({ path: path.join(outDir, `b05-card-${shotOnly}.png`) });
  await page.evaluate(() => document.querySelector("#workOrderGrid .machine-tile-card h2") && [...document.querySelectorAll("#workOrderGrid .machine-tile-card")].find((el) => el.querySelector("h2")?.textContent.startsWith("B05"))?.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(outDir, `b05-phone-${shotOnly}.png`) });
  console.log(`B05 卡片：${(await b05.locator(".machine-job-strip").innerText()).replace(/\s+/g, " ")}`);
  await context.close();
  await browser.close();
  server.close();
  process.exit(0);
}

console.log("== 手機（Pixel 7）：Monitor 卡片 ==");
{
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"]);
  await waitLoaded(page);

  // 1. B05：超量單照樣顯示
  const b05 = cardOf(page, "B05");
  const job = (await b05.locator(".machine-job-strip").innerText()).replace(/\s+/g, " ");
  ok(job.includes("XX01202606050003") && job.includes("HCG(HG)-06長蓋"), "B05 卡片顯示 HCG-06（不再是「無工單指派中」）", job);
  ok(!job.includes("無工單指派中"), "B05 沒有「無工單指派中」");
  const tag = b05.locator(".machine-job-strip .card-overqty-tag");
  ok(await tag.count() === 1 && (await tag.innerText()).trim() === "超量 +153", "B05 紅色標籤「超量 +153」", await tag.count() ? await tag.innerText() : "(none)");
  const tagColor = await tag.evaluate((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, fg: s.color }; });
  ok(tagColor.bg === "rgb(217, 45, 32)" && tagColor.fg === "rgb(255, 255, 255)", "標籤是紅底白字", JSON.stringify(tagColor));
  const metric = b05.locator(".machine-metrics > div").first();
  ok((await metric.locator("strong").innerText()).trim() === "689/536", "完成進度照實 689/536", await metric.locator("strong").innerText());
  ok((await metric.locator(".card-progress-pct").innerText()).trim() === "128%", "百分比照實 128%", await metric.locator(".card-progress-pct").innerText());
  const bar = await metric.locator(".card-progress-track").evaluate((el) => ({
    over: el.classList.contains("is-over"),
    width: el.querySelector(".progress-fill").style.width,
    fill: getComputedStyle(el.querySelector(".progress-fill")).backgroundColor,
  }));
  ok(bar.over && bar.width === "100%" && bar.fill === "rgb(217, 45, 32)", "進度條滿格、紅色", JSON.stringify(bar));
  ok(await b05.locator("[data-card-orders]").count() === 0, "B05 另外兩張工單 completed → 不列入（沒有「這台還掛」）");

  // 2. B03：最近活動挑單不變（A37），報滿的 BR-03 列在「這台還掛 1 張」並標「已報滿」
  const b03 = cardOf(page, "B03");
  const b03Job = (await b03.locator(".machine-job-strip").innerText()).replace(/\s+/g, " ");
  ok(b03Job.includes("XX01202606300001"), "B03 卡片仍是最近有活動的 A37（挑單規則不變）", b03Job);
  ok(await b03.locator(".machine-job-strip .card-overqty-tag").count() === 0, "B03 顯示中的單沒滿 → 沒有標籤");
  ok((await b03.locator("[data-card-orders-summary]").innerText()).includes("這台還掛 1 張"), "B03「這台還掛 1 張」（報滿的 BR-03 也算）");
  const brItem = b03.locator('.card-order-item', { hasText: "XX01202609170001" });
  ok(await brItem.count() === 1, "清單裡有 BR-03（194/194，以前會被排除）");
  ok((await brItem.locator(".card-overqty-tag").innerText()).trim() === "已報滿", "清單裡 BR-03 標「已報滿」");
  ok((await brItem.locator("[data-card-order-progress]").innerText()).includes("194/194（100%）"), "清單進度 194/194（100%）", await brItem.locator("[data-card-order-progress]").innerText());
  // 2026-10-02 清單改版：報滿／超量的列，數字紅色、細進度條滿格紅色（沿用 #51）
  const brLook = await brItem.evaluate((el) => ({
    qty: getComputedStyle(el.querySelector(".card-order-qty")).color,
    over: el.querySelector(".card-order-bar")?.classList.contains("is-over"),
    width: el.querySelector(".card-order-bar .progress-fill")?.style.width,
    fill: getComputedStyle(el.querySelector(".card-order-bar .progress-fill")).backgroundColor,
    tagBg: getComputedStyle(el.querySelector(".card-overqty-tag")).backgroundColor,
    pick: el.querySelector(".card-order-pick")?.textContent.trim(),
  }));
  ok(brLook.qty === "rgb(217, 45, 32)" && brLook.over && brLook.width === "100%" && brLook.fill === "rgb(217, 45, 32)" && brLook.tagBg === "rgb(217, 45, 32)", "報滿的列：數字紅色、進度條滿格紅色、紅色標籤", JSON.stringify(brLook));
  ok(brLook.pick === "切換顯示", "按鈕字樣「切換顯示」", brLook.pick);
  const a37Item = b03.locator(".card-order-item.is-shown");
  ok((await a37Item.locator(".card-order-shown").innerText()).trim() === "目前顯示" && await a37Item.locator(".card-order-pick").count() === 0, "顯示中的 A37 標「目前顯示」、沒有切換按鈕");
  ok(await a37Item.locator(".card-order-qty").evaluate((el) => getComputedStyle(el).color) !== "rgb(217, 45, 32)", "沒滿的列數字不是紅色");
  // 手動切到 BR-03 → 卡片顯示 BR-03、100%、紅色滿格（超量單可以被選）
  await brItem.locator(".card-order-pick").click();
  const b03b = cardOf(page, "B03");
  ok((await b03b.locator(".machine-job-strip").innerText()).includes("XX01202609170001"), "手動切換到報滿的單 → 卡片顯示它");
  ok((await b03b.locator(".machine-job-strip .card-overqty-tag").innerText()).trim() === "已報滿", "卡片標「已報滿」");
  await b03b.locator(".card-order-auto").click();

  // 3. B06：已離站／工單已完工的超量單照樣不顯示
  const b06Job = (await cardOf(page, "B06").locator(".machine-job-strip").innerText()).replace(/\s+/g, " ");
  ok(b06Job.includes("無工單指派中") && !b06Job.includes("XX01202609300061") && !b06Job.includes("XX01202609300062"), "B06：已離站、已完工的超量單都不顯示", b06Job);

  // 4. A01 一般單：沒有標籤、進度條原色
  const a01 = cardOf(page, "A01");
  ok(await a01.locator(".card-overqty-tag").count() === 0 && !(await a01.locator(".card-progress-track").evaluate((el) => el.classList.contains("is-over"))), "一般單（3440/5000）沒有超量標籤、進度條原色");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `手機沒有橫向捲動（${overflow}px）`);
  await b05.scrollIntoViewIfNeeded();
  await b05.screenshot({ path: path.join(outDir, "01-phone-b05-card.png") });
  await b03.scrollIntoViewIfNeeded();
  await cardOf(page, "B03").screenshot({ path: path.join(outDir, "02-phone-b03-card.png") });

  // 5. 單台報工：從 B05 卡片「回報」進去 → 提醒、不擋
  console.log("== 手機：單台報工（B05 超量單）==");
  await cardOf(page, "B05").locator(".machine-report-button").click();
  await page.locator("#reportSheet.is-open").waitFor();
  ok((await page.locator("#reportWorkNo").innerText()).trim() === "XX01202606050003", "單台報工帶 HCG-06");
  const warn = page.locator("#reportOverQty");
  ok(await warn.isVisible(), "單台報工顯示超量提醒");
  ok((await warn.innerText()).includes("超量 +153") && (await warn.innerText()).includes("仍可以報工"), "提醒內容：超量 +153、仍可以報工", await warn.innerText());
  await page.locator('.report-type-tab[data-report-type="noon"]').click();
  await page.locator("#completedQty").fill("5");
  ok(!(await page.locator("#reportForm button[type=submit].submit-report").isDisabled()), "送出鈕沒有被擋");
  await page.waitForTimeout(800);   // 等報工畫面滑入動畫結束再拍
  await page.screenshot({ path: path.join(outDir, "03-phone-single-report.png") });
  await page.locator("#machtileOperatorList input[type=checkbox]").first().waitFor({ timeout: 10000 });
  const before = calls.length;
  await page.evaluate(() => document.getElementById("reportForm").requestSubmit());
  await page.waitForFunction((n) => true, before);
  await page.waitForTimeout(1500);
  const single = calls.slice(before);
  ok(single.length === 1 && single[0].p_payload.process_id === id(351) && single[0].p_payload.completed_qty === 5, "超量單照樣送出報工（不擋）", JSON.stringify(single.map((c) => [c.p_payload?.process_id, c.p_payload?.completed_qty])));
  await page.evaluate(() => closeReport());

  // 一般單不顯示提醒
  await cardOf(page, "A01").locator(".machine-report-button").click();
  await page.locator("#reportSheet.is-open").waitFor();
  ok(!(await page.locator("#reportOverQty").isVisible()), "一般單（A01）報工沒有超量提醒");
  await page.evaluate(() => closeReport());

  // 6. 批次報工（銑床）：B05 列提醒、照樣可以送
  console.log("== 手機：銑床批次報工（B05 超量單）==");
  await page.evaluate(() => switchView("batchMill"));
  const mill = page.locator('[data-batch-root="mill"]');
  await mill.locator('[data-batch-row="B05"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-batch-root="mill"] [data-batch-refresh]')?.disabled);
  const b05Row = mill.locator('[data-batch-row="B05"]');
  ok((await b05Row.locator(".batch-order").innerText()).includes("XX01202606050003"), "批次 B05 列＝HCG-06");
  const bw = b05Row.locator("[data-batch-overqty]");
  ok(await bw.count() === 1 && (await bw.innerText()).includes("超量 +153"), "批次 B05 列顯示超量提醒", await bw.count() ? await bw.innerText() : "(none)");
  ok(await mill.locator('[data-batch-row="B03"] [data-batch-overqty]').count() === 0, "批次 B03（預設 A37，沒滿）沒有提醒");
  ok(!(await b05Row.locator("[data-batch-good]").isDisabled()), "批次 B05 數字框可以填（不擋）");
  await b05Row.locator("[data-batch-good]").fill("3");
  await page.screenshot({ path: path.join(outDir, "04-phone-batch-mill.png"), fullPage: true });
  const beforeBatch = calls.length;
  await mill.locator("[data-batch-submit]").click();
  await page.waitForFunction(() => document.querySelector('[data-batch-root="mill"] [data-batch-row="B05"] .batch-result'), null, { timeout: 15000 });
  const batchCalls = calls.slice(beforeBatch).filter((c) => procToMachine[c.p_payload?.process_id] === "B05");
  ok(batchCalls.length === 1 && batchCalls[0].p_payload.process_id === id(351) && batchCalls[0].p_payload.completed_qty === 3, "批次：超量單照樣送出（不擋）", JSON.stringify(batchCalls.map((c) => c.p_payload?.completed_qty)));

  ok(writes.length === 0, "除了報工本身，沒有任何寫入（不改資料庫、不標離站、不改工單狀態）", writes.join(" "));
  ok(realErrors(errors).length === 0, "頁面沒有 JS 錯誤（排除假網域觸發的 CATALOG_ENDPOINT_INVALID）", realErrors(errors).join(" | "));
  await context.close();
}

await browser.close();
server.close();

const prodHits = blocked.filter((u) => u.includes("muditjubqflrqofbkmav") || u.includes("machtile.com"));
ok(prodHits.length === 0, "沒有任何請求打到正式後端／正式網域", prodHits.join(" "));
console.log(`  (blocked external requests: ${blocked.length}${blocked.length ? " e.g. " + [...new Set(blocked.map((u) => new URL(u).host))].join(",") : ""})`);
console.log(`\n${pass} passed, ${fail} failed  (screenshots: ${outDir})`);
process.exit(fail ? 1 : 0);
