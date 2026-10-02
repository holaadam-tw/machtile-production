// Monitor 機台卡片整理（owner 2026-10-02）——瀏覽器端到端測試（Playwright，手機＋平板）。
//   1. 「這台還掛 N 張」預設收起：只顯示一行「這台還掛 N 張 ▸」，點了展開、再點收起；手動切換時收起也看得到「手動切換中」；
//      展開／收起用 localStorage 記住（每台各自記），讀寫失敗就當預設收起。
//   2. B01／B02 卡片不再放「6 盤最近人工盤況」和「固定工件配置 · Staging」：搬到「明細」（完整單同一個畫面）；
//      卡片上留報工主流程（「多盤多工件每日盤點」＋「明細」），盤位按鈕和「回報停機」跟著盤況一起搬到明細。
// 不會碰任何真的後端：config.js 換成指向假專案網域的測試設定，所有 Supabase 請求由這支腳本攔截、用假資料回應；
// 其他對外請求一律擋掉並記錄（最後斷言一次都沒有打到正式專案）。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node cardTidy.browser.test.mjs            （截圖寫到 ./.e2e-out/card-tidy/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node cardTidy.browser.test.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.CARD_TIDY_E2E_OUT || path.join(root, ".e2e-out", "card-tidy");
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

// ---------- fixtures（假資料）----------
const FAKE = "https://e2ecardtidyzzzzzzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const users = [{ id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) }];
const card = (n, wo, part, machine, due, qty, extra = {}) => ({
  id: id(100 + n), tenant_id: T, work_order_no: wo, customer_name: "測試客戶", part_name: part, drawing_no: null,
  quantity: qty, due_date: due, priority: "normal", work_order_status: "not_started",
  current_process_id: id(300 + n), current_process_name: "加工製程", current_process_status: "pending",
  machine_name: machine, qty_completed: 0, qty_defect: 0, progress_percent: 0,
  last_report_at: null, open_risk_level: null, current_process_off_station: false, ...extra,
});
const cards = [
  card(1, "XX01202609020008", "MPW-01止油閥座", "A01", "2026-10-30", 5000),
  // B01：2 張在站（臥式多盤）；B02：1 張
  card(11, "XX01202609150001", "HCG-06本體", "B01", "2026-10-20", 400),
  card(12, "XX01202609150002", "HCG-06蓋板", "B01", "2026-11-05", 400),
  card(21, "XX01202609160003", "CPDF-20閥體", "B02", "2026-10-25", 120),
  // B04：3 張在站（一般加工中心）
  card(41, "XX01202604140005", "A37九孔座", "B04", "2026-04-30", 165),
  card(42, "XX01202606030002", "P08九孔座", "B04", "2026-06-30", 300),
  card(43, "XX01202609170004", "CPDF-16本體", "B04", "2026-10-31", 219),
];
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: "", status: "idle", display_order: i,
}));
const legacyAt = { [id(343)]: "2026-10-02T08:14:47Z", [id(311)]: "2026-10-02T07:10:00Z" };
const hmcSnapshot = {
  generated_at: new Date(now).toISOString(),
  machines: ["B01", "B02"].map((code) => ({
    machine_code: code,
    status: "running",
    pallets: Array.from({ length: 6 }, (_, i) => ({
      pallet_no: i + 1,
      state: i === 0 ? "spindle" : i === 1 ? "external_preparing" : i === 2 ? "ready" : "waiting",
      work_order_no: i === 0 ? (code === "B01" ? "XX01202609150001" : "XX01202609160003") : null,
    })),
  })),
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
// 主管帳號：盤位按鈕、「回報停機」才會出現（machtileHmcRuntimeCanWrite）
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: users[0].auth, email: "mgr@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role: "manager" } })}.sig`;
const testConfig = `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key-for-e2e-only", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: true, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
};`;

function makeBackend() {
  const b = { writes: [] };
  b.handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const q = decodeURIComponent(url.search);
    const method = req.method();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "mgr@test.invalid" });
    const readRpc = /^\/rest\/v1\/rpc\/(batch_report_progress|[a-z_]+_snapshot|[a-z_]+_list)$/.test(p);
    if (method !== "GET" && method !== "HEAD" && !readRpc) b.writes.push(`${method} ${p}`);
    if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
    if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
    if (p === "/rest/v1/app_users") {
      if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: users[0].name }]);
      return json(200, users.map(({ auth, ...u }) => u));
    }
    if (p === "/rest/v1/work_order_processes") {
      if (q.includes("queue_order=not.is.null")) return json(200, []);
      const m = q.match(/id=in\.\(([^)]*)\)/);
      if (m && q.includes("actual_start_at")) return json(200, m[1].split(",").map((pid) => ({ id: pid, process_order: 1, actual_start_at: null })));
      return json(200, []);
    }
    if (p === "/rest/v1/rpc/hmc_runtime_snapshot") return json(200, hmcSnapshot);
    if (p === "/rest/v1/rpc/batch_report_progress") {
      const body = JSON.parse(req.postData() || "{}");
      return json(200, (body.p_process_ids || []).map((pid) => ({
        process_id: pid, legacy_input: null, legacy_output: null, legacy_fail: null,
        legacy_updated_at: legacyAt[pid] || null, legacy_snapshot_at: null, legacy_synced_at: null,
        pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: null, actual_start_at: null,
      })));
    }
    if (p.startsWith("/rest/v1/rpc/")) return json(200, null);
    if (p.startsWith("/rest/v1/")) return json(200, []);
    return json(200, {});
  };
  return b;
}

const blocked = [];
async function newPage(browser, device, backend, opts = {}) {
  const context = await browser.newContext({ ...device, serviceWorkers: "block" });
  await context.addInitScript(([token, blockStorage]) => {
    try {
      sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "mgr@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
    } catch {}
    if (blockStorage) {
      // 模擬讀寫失敗（私密視窗額度 0、網站資料被封鎖）：這個功能的 key 讀寫一律丟錯
      const KEY = "machtile.cardOrdersOpen.v1";
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (k) { if (k === KEY) throw new Error("SecurityError: storage blocked"); return get.call(this, k); };
      Storage.prototype.setItem = function (k, v) { if (k === KEY) throw new Error("QuotaExceededError"); return set.call(this, k, v); };
    }
  }, [jwt, Boolean(opts.blockStorage)]);
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
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, errors };
}

async function waitLoaded(page) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid .machine-tile-card").length > 0, null, { timeout: 20000 });
  // 固定工件配置（Staging）在正式站要另外開旗標＋簽章租戶；測試直接讓入口「可用」，好確認它出現在哪裡
  await page.evaluate(() => {
    const host = machtileGetHmcFixedHost();
    const opened = [];
    window.__hmcFixedOpened = opened;
    machtileHmcFixedHost = { ...host, available: () => true, open: (view, ctx) => { opened.push({ view, ...ctx }); return Promise.resolve(true); } };
    deriveMachines();
    renderWorkOrders();
  });
}

const cardOf = (page, code) => page.locator("#workOrderGrid .machine-tile-card").filter({ has: page.locator("h2", { hasText: code }) }).first();
const realErrors = (errors) => errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));
const caretOf = (summary) => summary.evaluate((el) => {
  const caret = el.querySelector(".card-orders-caret");
  return caret ? getComputedStyle(caret, "::before").content.replace(/"/g, "") : "";
});
const isOpen = (loc) => loc.evaluate((el) => el.open === true);
// 卡片各區塊在 DOM 裡的先後順序
const sectionOrder = (cardLoc) => cardLoc.evaluate((el) => {
  const pick = (sel) => { const n = el.querySelector(sel); return n ? [...el.querySelectorAll("*")].indexOf(n) : -1; };
  return {
    job: pick(".machine-job-strip"), more: pick("[data-card-orders]"), metrics: pick(".machine-metrics"),
    cycle: pick(".cycle-mini-grid"), footer: pick(".machine-tile-footer"),
  };
});

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

// ================= 手機 =================
console.log("== 手機（Pixel 7）==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"], be);
  await waitLoaded(page);
  await cardOf(page, "B01").scrollIntoViewIfNeeded();
  await cardOf(page, "B01").screenshot({ path: path.join(outDir, "01-phone-b01-card.png") });

  console.log("-- 「這台還掛 N 張」預設收起 --");
  const d04 = cardOf(page, "B04").locator("[data-card-orders]");
  const s04 = cardOf(page, "B04").locator("[data-card-orders-summary]");
  ok(!(await isOpen(d04)), "B04：清單預設收起");
  ok((await s04.innerText()).trim() === "這台還掛 2 張", "收起時只顯示一行「這台還掛 2 張」", await s04.innerText());
  ok(await caretOf(s04) === "▸", "收起時箭頭＝▸", await caretOf(s04));
  ok(!(await cardOf(page, "B04").locator(".card-order-list").isVisible()), "收起時看不到清單內容");
  await s04.click();
  ok(await isOpen(d04), "點一下 → 展開");
  ok(await caretOf(s04) === "▾", "展開時箭頭＝▾", await caretOf(s04));
  ok(await cardOf(page, "B04").locator(".card-order-item").count() === 3, "展開看到 3 張在站單");
  ok(!(await page.locator("#detailSheet").evaluate((e) => e.classList.contains("is-open"))), "點「還掛」不會打開工單明細");
  await cardOf(page, "B04").scrollIntoViewIfNeeded();
  await cardOf(page, "B04").screenshot({ path: path.join(outDir, "03-phone-b04-list-open.png") });
  await s04.click();
  ok(!(await isOpen(d04)), "再點一下 → 收起");
  ok(await caretOf(s04) === "▸", "收起後箭頭回到 ▸");

  console.log("-- 手動切換中：收起也看得到 --");
  await s04.click();
  await cardOf(page, "B04").locator('[data-card-pick-key="' + id(341) + '"]').click();
  ok((await cardOf(page, "B04").locator(".job-order-highlight").innerText()).startsWith("XX01202604140005"), "切到 A37 → 卡片顯示 A37");
  ok(await isOpen(cardOf(page, "B04").locator("[data-card-orders]")), "切換後清單維持展開（不會每次重畫就收起來）");
  await cardOf(page, "B04").locator("[data-card-orders-summary]").click();
  ok(!(await isOpen(cardOf(page, "B04").locator("[data-card-orders]"))), "收起");
  const manual = cardOf(page, "B04").locator("[data-card-orders-summary] .card-orders-manual");
  ok(await manual.isVisible(), "收起時「手動切換中」仍看得到");
  ok((await cardOf(page, "B04").locator("[data-card-orders-summary]").innerText()).replace(/\s+/g, "") === "這台還掛2張手動切換中", "那一行＝這台還掛 2 張 ▸ 手動切換中", await cardOf(page, "B04").locator("[data-card-orders-summary]").innerText());
  await cardOf(page, "B04").screenshot({ path: path.join(outDir, "04-phone-b04-manual-collapsed.png") });
  await cardOf(page, "B04").locator("[data-card-orders-summary]").click();
  // 2026-10-02 清單改版：「恢復自動」樣式維持 #50（藍框、白底、圓角 8px、36px 高），放在一行小字說明旁
  const autoLook = await cardOf(page, "B04").locator(".card-order-note .card-order-auto").evaluate((el) => { const s = getComputedStyle(el); return { text: el.textContent.trim(), border: s.borderTopColor, bw: s.borderTopWidth, bg: s.backgroundColor, radius: s.borderTopLeftRadius, h: el.getBoundingClientRect().height }; });
  ok(autoLook.text === "恢復自動" && autoLook.border === "rgb(0, 103, 255)" && autoLook.bw === "1px" && autoLook.bg === "rgb(255, 255, 255)" && autoLook.radius === "8px" && autoLook.h >= 36, "「恢復自動」維持 #50 樣式", JSON.stringify(autoLook));
  ok((await cardOf(page, "B04").locator(".card-order-note > span").innerText()).trim() === "依最近活動自動挑選；切換只影響這個畫面", "說明縮成一行小字");
  ok(await cardOf(page, "B04").locator(".card-order-item.is-shown .card-order-shown").innerText() === "目前顯示", "切到的那張標「目前顯示」");
  await cardOf(page, "B04").locator(".card-order-auto").click();
  ok(await cardOf(page, "B04").locator("[data-card-orders-summary] .card-orders-manual").count() === 0, "恢復自動 → 標記消失");
  ok(await cardOf(page, "B04").locator(".card-order-auto").count() === 0, "恢復自動 → 「恢復自動」按鈕也消失");

  console.log("-- 個人偏好：localStorage 記住每台展開或收起 --");
  ok(await isOpen(cardOf(page, "B04").locator("[data-card-orders]")), "B04 目前展開");
  ok(!(await isOpen(cardOf(page, "B01").locator("[data-card-orders]"))), "B01 沒動過 → 仍收起（每台各自記）");
  await page.evaluate(() => { deriveMachines(); renderWorkOrders(); });
  ok(await isOpen(cardOf(page, "B04").locator("[data-card-orders]")), "定時重畫後 B04 仍展開");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid [data-card-orders]").length > 0, null, { timeout: 20000 });
  ok(await isOpen(cardOf(page, "B04").locator("[data-card-orders]")), "重新整理後 B04 仍展開（localStorage）");
  await cardOf(page, "B04").locator("[data-card-orders-summary]").click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid [data-card-orders]").length > 0, null, { timeout: 20000 });
  ok(!(await isOpen(cardOf(page, "B04").locator("[data-card-orders]"))), "收起後重新整理 → 收起");
  await waitLoaded(page);

  console.log("-- B01 卡片：拿掉兩塊、版面跟其他機台一致 --");
  const b01 = cardOf(page, "B01");
  ok(await b01.locator(".machine-hmc-runtime").count() === 0, "B01 卡片上沒有「6 盤最近人工盤況」");
  ok(!(await b01.innerText()).includes("盤最近人工盤況"), "B01 卡片文字裡沒有「盤最近人工盤況」");
  ok(!(await b01.innerText()).includes("固定工件配置"), "B01 卡片上沒有「固定工件配置 · Staging」");
  ok(await b01.locator("[data-hmc-runtime-pallet], [data-hmc-fixed-pallet], [data-hmc-runtime-machine-action]").count() === 0, "B01 卡片上沒有盤位按鈕、沒有「回報停機」");
  ok(await cardOf(page, "B02").locator(".machine-hmc-runtime, [data-hmc-fixed-pallet]").count() === 0, "B02 卡片同樣拿掉");
  const o1 = await sectionOrder(b01);
  const o4 = await sectionOrder(cardOf(page, "B04"));
  const inOrder = (o) => o.job >= 0 && o.more > o.job && o.metrics > o.more && o.cycle > o.metrics && o.footer > o.cycle;
  ok(inOrder(o1), "B01：目前工單 → 還掛 1 張 → 完成進度／交期 → 機台加工時間／每日估算 → 底部", JSON.stringify(o1));
  ok(inOrder(o4), "B04 也是同一個順序", JSON.stringify(o4));
  ok((await b01.locator("[data-card-orders-summary]").innerText()).trim() === "這台還掛 1 張", "B01：這台還掛 1 張（收起）");
  ok(await b01.locator(".machine-tile-footer .machine-hmc-report-link").isVisible(), "報工主流程「多盤多工件每日盤點」仍在卡片底部");
  ok(await b01.locator(".machine-tile-footer .machine-detail-button").isVisible(), "「明細」按鈕仍在卡片底部");
  ok(await cardOf(page, "B04").locator(".machine-tile-footer .machine-report-button").isVisible(), "一般機台（B04）「回報」按鈕還在");
  ok(await cardOf(page, "A01").locator(".machine-tile-footer .machine-report-button").isVisible(), "車床（A01）「回報」按鈕還在");
  await b01.scrollIntoViewIfNeeded();
  await b01.screenshot({ path: path.join(outDir, "02-phone-b01-card-after.png") });

  console.log("-- 明細頁看得到兩塊，按鈕照常能用 --");
  await b01.locator(".machine-detail-button").click();
  await page.locator("#detailSheet.is-open").waitFor();
  const hmcSection = page.locator("#detailContent [data-detail-hmc]");
  await hmcSection.waitFor();
  const secText = await hmcSection.innerText();
  ok(secText.includes("6 盤最近人工盤況"), "明細裡有「6 盤最近人工盤況」", secText.slice(0, 200));
  ok(secText.includes("固定工件配置 · Staging"), "明細裡有「固定工件配置 · Staging」");
  ok(await hmcSection.locator("[data-hmc-runtime-pallet]").count() === 6, "明細裡 6 個盤位按鈕（主管可更新）");
  ok(await hmcSection.locator("[data-hmc-fixed-pallet]").count() === 6, "明細裡 6 個固定工件盤位");
  ok(await hmcSection.locator('[data-hmc-runtime-machine-action="B01"]').innerText() === "回報停機", "「回報停機」在明細裡");
  ok(await page.locator("#detailContent [data-open-report]").count() >= 1, "明細裡原本的開工按鈕還在");
  await hmcSection.scrollIntoViewIfNeeded();
  await hmcSection.screenshot({ path: path.join(outDir, "05-phone-b01-detail.png") });
  await hmcSection.locator('[data-hmc-runtime-pallet="2"]').click();
  await page.locator("#hmcRuntimeActionSheet.is-open").waitFor();
  ok((await page.locator("#hmcRuntimeActionSummary").innerText()).includes("B01 · 盤 2"), "明細裡點盤 2 → 開「更新交換盤狀態」", await page.locator("#hmcRuntimeActionSummary").innerText());
  await page.waitForTimeout(600);   // 等小框滑進來
  const onTop = await page.locator("#hmcRuntimeActionSubmit").evaluate((el) => { el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el === top || el.contains(top); });
  ok(onTop, "更新盤況的小框蓋在明細上面（送出鈕按得到）");
  await page.evaluate(() => machtileCloseHmcRuntimeAction());
  await hmcSection.locator('[data-hmc-runtime-machine-action="B01"]').click();
  await page.locator("#hmcRuntimeActionSheet.is-open").waitFor();
  ok((await page.locator("#hmcRuntimeActionTitle").innerText()).includes("更新機台狀態"), "明細裡「回報停機」→ 開更新機台狀態");
  await page.evaluate(() => machtileCloseHmcRuntimeAction());
  await hmcSection.locator('[data-hmc-fixed-pallet="3"]').click();
  ok(await page.evaluate(() => JSON.stringify(window.__hmcFixedOpened)) === JSON.stringify([{ view: "slots", machineCode: "B01", palletNo: 3 }]), "明細裡點固定工件盤 3 → 開固定工件畫面", await page.evaluate(() => JSON.stringify(window.__hmcFixedOpened)));
  // 定時更新盤況（每 30 秒）時，明細裡那一塊也跟著換
  await page.evaluate(() => {
    machtileHmcRuntimeState.snapshot.machines.find((m) => m.machineCode === "B01").pendingReplanCount = 2;
    renderWorkOrders();
  });
  ok((await hmcSection.innerText()).includes("2 待重排"), "盤況更新時明細那一塊跟著重畫");
  await page.evaluate(() => closeDetail());

  console.log("-- 一般機台的明細不會多出這兩塊 --");
  await cardOf(page, "B04").locator(".machine-detail-button").click();
  await page.locator("#detailSheet.is-open").waitFor();
  await page.waitForFunction(() => document.querySelector("#detailContent .detail-head"));
  ok(await page.locator("#detailContent [data-detail-hmc]").count() === 0, "B04 明細沒有盤況區塊");
  await page.evaluate(() => closeDetail());

  console.log("-- 完整單（網址開的是同一個明細畫面：openDetail routeMode）--");
  await page.evaluate(() => openDetail("XX01202609150001", { routeMode: true }));
  await page.locator("#detailSheet.is-open.route-sheet").waitFor();
  await page.locator("#detailContent [data-detail-hmc]").waitFor();
  ok((await page.locator("#detailContent [data-detail-hmc]").innerText()).includes("盤最近人工盤況"), "完整單畫面也看得到盤況");
  await page.evaluate(() => closeDetail());

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `手機沒有橫向捲動（${overflow}px）`);
  ok(be.writes.length === 0, "整個過程沒有任何寫入請求", be.writes.join(" | "));
  ok(realErrors(errors).length === 0, "頁面沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= 沒有工單的臥式機台：明細仍進得去 =================
console.log("== 臥式機台沒有工單：卡片「明細」仍可看盤況 ==");
{
  const saved = cards.splice(cards.findIndex((c) => c.machine_name === "B02"), 1);
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"], be);
  await waitLoaded(page);
  const b02 = cardOf(page, "B02");
  ok(await b02.locator(".machine-hmc-runtime").count() === 0, "B02（無工單）卡片上也沒有盤況");
  ok(await b02.locator(".machine-tile-footer .machine-hmc-report-link").isVisible(), "「多盤多工件每日盤點」還在");
  await b02.locator("[data-hmc-machine-detail]").click();
  await page.locator("#detailSheet.is-open").waitFor();
  ok((await page.locator("#detailContent [data-detail-hmc]").innerText()).includes("6 盤最近人工盤況"), "B02 明細看得到盤況");
  ok(await page.locator('#detailContent [data-hmc-runtime-machine-action="B02"]').count() === 1, "B02 的「回報停機」在明細裡");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  cards.push(...saved);
  await context.close();
}

// ================= localStorage 讀寫失敗 =================
console.log("== localStorage 被封鎖：預設收起、點開收起照常 ==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"], be, { blockStorage: true });
  await waitLoaded(page);
  const d = cardOf(page, "B04").locator("[data-card-orders]");
  ok(!(await isOpen(d)), "預設收起");
  await cardOf(page, "B04").locator("[data-card-orders-summary]").click();
  ok(await isOpen(d), "點開照常");
  await page.evaluate(() => { deriveMachines(); renderWorkOrders(); });
  ok(await isOpen(cardOf(page, "B04").locator("[data-card-orders]")), "這次開啟期間重畫仍記得（存在記憶體）");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= 平板 =================
console.log("== 平板（iPad 810×1080）==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, { ...devices["iPad (gen 7)"], defaultBrowserType: undefined }, be);
  await waitLoaded(page);
  ok(!(await isOpen(cardOf(page, "B04").locator("[data-card-orders]"))), "平板：預設收起");
  ok(await cardOf(page, "B01").locator(".machine-hmc-runtime").count() === 0, "平板：B01 卡片沒有盤況");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `平板沒有橫向捲動（${overflow}px）`);
  await page.screenshot({ path: path.join(outDir, "06-tablet-monitor.png"), fullPage: false });
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
