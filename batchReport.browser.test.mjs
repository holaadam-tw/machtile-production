// 批次報工的瀏覽器端到端測試（Playwright，手機＋平板模擬）。
// 不會碰任何真的後端：config.js 被換成指向假網域 fake-supabase.test 的測試設定，所有 Supabase 請求由
// 這支腳本攔截、用假資料回應；其他對外請求一律擋掉並記錄（最後斷言一次都沒有打到正式專案）。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node batchReport.browser.test.mjs            （截圖寫到 ./.e2e-out/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node batchReport.browser.test.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.BATCH_E2E_OUT || path.join(root, ".e2e-out");
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
const FAKE = "https://fake-supabase.test";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const users = [
  { id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) },   // the signed-in person
  { id: id(902), name: "李大華", legacy_user_id: "1021101" },
  { id: id(903), name: "B03站別", legacy_user_id: "" },
];
const card = (n, wo, machine, status, extra = {}) => ({
  id: id(100 + n), tenant_id: T, work_order_no: wo, customer_name: "測試客戶", part_name: `零件${n}`, drawing_no: `DWG-${n}`,
  quantity: 400, due_date: "2026-10-20", priority: "normal", work_order_status: "in_progress",
  current_process_id: id(300 + n), current_process_name: machine.startsWith("A") ? "車削" : "銑削",
  current_process_status: status, machine_name: machine, qty_completed: 0, qty_defect: 0, progress_percent: 0,
  last_report_at: null, open_risk_level: null, current_process_off_station: false, ...extra,
});
const cards = [
  card(1, "XX01202609020008", "A01", "running"),
  card(2, "XX01202609160002", "A02", "pending"),
  card(4, "XX01202604140011", "A04", "pending"),
  card(5, "XX01202609020009", "A05", "running"),
  card(6, "XX01202609170001", "B03", "running"),
  card(7, "XX01202609170009", "B03", "pending"),
  card(8, "XX01202609170004", "B04", "running"),
  card(9, "XX01202609030002", "B06", "pending"),
  card(10, "XX01202609290004", "B01", "running"),
  card(11, "XX01202609300001", "A03", "pending", { current_process_off_station: true }),   // moved off by the old MES
];
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: { A01: "小瀧澤", A02: "大瀧澤", B03: "大立" }[code] || "", status: "idle", display_order: i,
}));
const progress = {
  [id(301)]: { legacy_output: 110, legacy_fail: 1, pending_output: 10, pending_fail: 0, pending_count: 2, oldest_pending_at: ago(20), last_report_at: ago(60), actual_start_at: ago(300), legacy_synced_at: ago(3) },
  [id(302)]: { legacy_output: null, legacy_fail: null, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: null, actual_start_at: ago(180), legacy_synced_at: null },
  [id(304)]: { legacy_output: 55, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: null, actual_start_at: null, legacy_synced_at: ago(3) },
  [id(305)]: { legacy_output: 0, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: ago(30), actual_start_at: ago(400), legacy_synced_at: ago(3) },
  [id(306)]: { legacy_output: 172, legacy_fail: 0, pending_output: 12, pending_fail: 1, pending_count: 1, oldest_pending_at: ago(180), last_report_at: ago(170), actual_start_at: null, legacy_synced_at: ago(3) },
  [id(307)]: { legacy_output: 0, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: null, actual_start_at: ago(90), legacy_synced_at: ago(3) },
  [id(308)]: { legacy_output: 67, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: ago(45), actual_start_at: null, legacy_synced_at: ago(3) },
  [id(309)]: { legacy_output: 0, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: ago(15), actual_start_at: null, legacy_synced_at: ago(3) },
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: users[0].auth, email: "op@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const testConfig = `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: true, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
};`;

// ---------- fake backend ----------
const calls = [];          // every field_report_upsert body
const inserted = new Map(); // report_uuid -> payload
const blocked = [];        // non-local, non-fake requests (must stay empty of production hosts)
let failNextFor = null;    // machine code whose next upsert answers 400 once
const procToMachine = Object.fromEntries(cards.map((c) => [c.current_process_id, c.machine_name]));

async function handleFake(route) {
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
    return json(200, (body.p_process_ids || []).filter((pid) => progress[pid]).map((pid) => ({ process_id: pid, ...progress[pid] })));
  }
  if (p === "/rest/v1/rpc/field_report_upsert") {
    const body = JSON.parse(req.postData() || "{}");
    calls.push(body);
    const machine = procToMachine[body.p_payload?.process_id];
    if (failNextFor && machine === failNextFor) {
      failNextFor = null;
      return json(400, { message: "simulated permanent rejection" });
    }
    if (inserted.has(body.p_report_uuid)) return json(200, { report_id: id(7000), inserted: false });
    inserted.set(body.p_report_uuid, body.p_payload);
    return json(200, { report_id: id(7000 + inserted.size), inserted: true });
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

async function waitLoaded(page) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

// ================= phone =================
console.log("== 手機（Pixel 7）：車床批次報工 ==");
{
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"]);
  await waitLoaded(page);
  // 手機版面：登入徽章收成右上角小按鈕，不能壓住底部分頁列和「＋回報」（真的用點的，不用 dispatchEvent）
  const geo = await page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const badge = r(document.getElementById("machtileSessionBadge"));
    const tabs = r(document.querySelector(".mobile-tabs"));
    const fab = r(document.querySelector(".fab"));
    const bell = r(document.querySelector(".topbar-actions .icon-button"));
    return { badge, overTabs: hit(badge, tabs), overFab: hit(badge, fab), overBell: hit(badge, bell) };
  });
  ok(!geo.overTabs && !geo.overFab && !geo.overBell, "手機：登入徽章不壓分頁列、不壓「＋回報」、不壓鈴鐺", JSON.stringify(geo));
  await page.locator("[data-machtile-session-toggle]").click();
  ok(await page.locator("[data-machtile-logout]").isVisible(), "點小按鈕展開帳號面板（登出看得到）");
  await page.screenshot({ path: path.join(outDir, "00-phone-badge-expanded.png") });
  await page.locator("[data-machtile-session-toggle]").click();
  ok(!(await page.locator("[data-machtile-logout]").isVisible()), "再點一次收起");
  await page.locator('.mobile-tab[data-view="batchLathe"]').click();
  const root = page.locator('[data-batch-root="lathe"]');
  await root.locator('[data-batch-row="A01"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled);
  ok(await root.locator(".batch-row").count() === 5, "車床畫面五台 A01–A05");
  const a01 = root.locator('[data-batch-row="A01"]');
  const a01Stats = await a01.locator(".batch-stat strong").allInnerTexts();
  ok(a01Stats[0] === "120" && a01Stats[1] === "1", "A01 已報（數字卡）＝舊 MES 110＋待回寫 10（不良 1）", a01Stats.join(","));
  ok((await a01.locator(".batch-done").innerText()).includes("含待回寫 10"), "A01 標出待回寫");
  ok((await root.locator('[data-batch-row="A02"] .batch-done').innerText()).includes("舊 MES 尚無結算"), "A02 舊 MES 沒有結算列時明講");
  ok(await root.locator('[data-batch-row="A03"] [data-batch-good]').isDisabled(), "A03 舊 MES 已移走的單不出現、沒派工不能填");
  ok((await root.locator('[data-batch-row="A04"] .batch-start').innerText()).includes("今日開工"), "A04 沒有開工／報工紀錄 → 提示先今日開工");
  ok(await root.locator('[data-batch-row="A01"] [data-batch-operator]').inputValue() === users[0].id, "報工人預設＝登入者");
  const opts = await root.locator('[data-batch-row="A01"] [data-batch-operator] option').allInnerTexts();
  ok(!opts.some((t) => t.includes("站別")), "候選人只有有工號對照的人", opts.join(","));
  const box = await root.locator('[data-batch-row="A01"] [data-batch-good]').boundingBox();
  ok(box && box.height >= 48, `數字框夠大（${box && Math.round(box.height)}px）`);
  const phoneOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(phoneOverflow <= 1, `手機沒有橫向捲動（${phoneOverflow}px）`);
  await page.screenshot({ path: path.join(outDir, "01-phone-lathe-before.png"), fullPage: true });

  // A04 has no start time: blocked before anything is sent
  await root.locator('[data-batch-row="A04"] [data-batch-good]').fill("3");
  await root.locator("[data-batch-submit]").click();
  await page.waitForTimeout(300);
  ok(calls.length === 0, "有一台不能送 → 整批都不送");
  ok((await root.locator('[data-batch-row="A04"] .batch-result').innerText()).includes("今日開工"), "A04 紅字說明原因");
  await page.screenshot({ path: path.join(outDir, "02-phone-lathe-blocked.png"), fullPage: true });
  await root.locator('[data-batch-row="A04"] [data-batch-good]').fill("");

  await root.locator('[data-batch-row="A01"] [data-batch-good]').fill("12");
  await root.locator('[data-batch-row="A02"] [data-batch-good]').fill("5");
  await root.locator('[data-batch-row="A02"] [data-batch-bad]').fill("1");
  await root.locator('[data-batch-row="A05"] [data-batch-good]').fill("8");
  await root.locator('[data-batch-row="A05"] [data-batch-operator]').selectOption(users[1].id);   // 一人顧多台：這列改成別人
  ok((await root.locator("[data-batch-submit]").innerText()).includes("3 台"), "送出鈕顯示 3 台");
  failNextFor = "A02";   // A02 first send: server rejects (permanent) -> must be retried with the SAME uuid
  // double press in one task: the second press must not create anything
  await page.evaluate(() => { const b = document.querySelector('[data-batch-root="lathe"] [data-batch-submit]'); b.click(); b.click(); });
  await page.waitForFunction(() => document.querySelectorAll('[data-batch-root="lathe"] .batch-result').length >= 3, null, { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled);
  ok(calls.length === 3, `連按兩下只送 3 筆（A01、A02、A05），實際 ${calls.length}`);
  ok(new Set(calls.map((c) => c.p_report_uuid)).size === 3, "每台各一個 report_uuid");
  const byMachine = (m) => calls.filter((c) => procToMachine[c.p_payload.process_id] === m);
  const pA01 = byMachine("A01")[0].p_payload, pA05 = byMachine("A05")[0].p_payload, pA02 = byMachine("A02")[0].p_payload;
  ok(pA01.completed_qty === 12 && pA01.defect_qty === 0 && pA02.completed_qty === 5 && pA02.defect_qty === 1, "數量照填（這次的量）");
  ok(pA01.started_at === progress[id(301)].last_report_at, "A01 started_at＝上次報工時間");
  ok(pA02.started_at === progress[id(302)].actual_start_at, "A02 started_at＝開工時間（沒有報工紀錄時）");
  ok(pA01.ended_at === pA05.ended_at && Date.parse(pA01.ended_at) > Date.parse(pA01.started_at), "同一批 ended_at 相同且晚於 started_at");
  ok(JSON.stringify(pA01.operators) === JSON.stringify([users[0].id]) && JSON.stringify(pA05.operators) === JSON.stringify([users[1].id]), "operators：預設登入者；A05 改成李大華（各一位）");
  ok(pA05.user_id === users[0].id, "user_id 記按送出的人");
  ok(pA01.report_type === "noon" && pA01.cycle_time_seconds === null && pA01.remark === "[中午報工]", "預設分頁＝中午報工：report_type=noon、remark 同單台、機台加工時間沒改＝null");
  ok((await root.locator('[data-batch-row="A01"] .batch-result').innerText()).includes("已送出"), "A01 顯示已送出");
  ok((await root.locator('[data-batch-row="A02"] .batch-result').innerText()).includes("拒收"), "A02 顯示失敗原因");
  ok(await root.locator('[data-batch-row="A02"] [data-batch-good]').inputValue() === "5", "失敗的列保留輸入");
  ok(await root.locator('[data-batch-row="A01"] [data-batch-good]').inputValue() === "", "成功的列清空（下一次是新的一筆）");
  await page.screenshot({ path: path.join(outDir, "03-phone-lathe-results.png"), fullPage: true });

  // retry the failed row: same inputs -> same report_uuid; the server stores it once
  const firstA02 = byMachine("A02")[0].p_report_uuid;
  await root.locator("[data-batch-submit]").click();
  await page.waitForFunction(() => document.querySelector('[data-batch-root="lathe"] [data-batch-row="A02"] .batch-result')?.textContent.includes("已送出"), null, { timeout: 15000 });
  ok(byMachine("A02").length === 2 && byMachine("A02")[1].p_report_uuid === firstA02, "重按：A02 沿用同一個 report_uuid");
  ok(byMachine("A01").length === 1 && byMachine("A05").length === 1, "已成功的列沒有被重送");
  ok(inserted.size === 3, `後端只收到 3 筆報工（${inserted.size}）`);
  ok(byMachine("A02")[1].p_payload.started_at === pA02.started_at && byMachine("A02")[1].p_payload.ended_at === pA02.ended_at, "重送的內容跟第一次一樣（時間不變）");

  // 銑床
  console.log("== 手機：銑床批次報工 ==");
  await page.locator('[data-batch-root="lathe"] .batch-switch-btn[data-view="batchMill"]').click();
  const mill = page.locator('[data-batch-root="mill"]');
  await mill.locator('[data-batch-row="B03"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-batch-root="mill"] [data-batch-refresh]')?.disabled);
  const millRows = await mill.locator(".batch-row").evaluateAll((els) => els.map((e) => e.dataset.batchRow));
  ok(JSON.stringify(millRows) === JSON.stringify(["B03", "B04", "B05", "B06"]), "銑床只有 B03–B06（B01/B02 不在批次）", millRows.join(","));
  ok(await mill.locator('[data-batch-order="B03"] option').count() === 2, "B03 同時掛兩張單 → 可以選");
  ok((await mill.locator('[data-batch-row="B03"] .batch-pending').innerText()).includes("逾 2 小時"), "待回寫超過 2 小時 → 提醒");
  ok(await page.locator('.mobile-tab[data-view="batchLathe"]').evaluate((b) => b.classList.contains("active")), "手機底部「報工」分頁在銑床畫面也亮著");
  await page.locator("#adminDrawerBtn").click();
  ok(await page.locator('[data-drawer-module="__batchLathe"]').isVisible() && await page.locator('[data-drawer-module="__batchMill"]').isVisible(), "「更多」抽屜也有車床／銑床報工入口");
  await page.locator("#adminDrawerBackdrop").click({ position: { x: 10, y: 300 } });
  await mill.locator('[data-batch-order="B03"]').selectOption(id(307));
  await mill.locator('[data-batch-row="B03"] [data-batch-good]').fill("6");
  await mill.locator('[data-batch-row="B04"] [data-batch-good]').fill("4");
  await mill.locator('[data-batch-row="B04"] [data-batch-bad]').fill("1");
  await page.screenshot({ path: path.join(outDir, "04-phone-mill-filled.png"), fullPage: true });
  await mill.locator("[data-batch-submit]").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-batch-root="mill"] .batch-result.is-sent').length >= 2, null, { timeout: 15000 });
  ok(byMachine("B03").length === 1 && byMachine("B03")[0].p_payload.process_id === id(307), "B03 報在選的那張單");
  ok(byMachine("B03")[0].p_payload.started_at === progress[id(307)].actual_start_at, "B03 第二張單 started_at＝開工時間");
  await page.screenshot({ path: path.join(outDir, "05-phone-mill-results.png"), fullPage: true });

  // regression: the single-machine report sheet still sends through the outbox
  console.log("== 回歸：單台報工 ==");
  const before = calls.length;
  await page.locator('.mobile-tab[data-view="dashboard"]').click();
  await page.locator(".fab[data-open-report]").click();
  await page.locator('.report-type-tab[data-report-type="noon"]').click();
  ok((await page.locator('label[for="completedQty"]').innerText()).startsWith("這次良品") && (await page.locator('label[for="defectQty"]').innerText()).startsWith("這次不良"), "單台報工欄位改成「這次良品」「這次不良」");
  ok((await page.locator(".report-qty-help").innerText()).includes("填這次新做的數量，不是累計"), "旁邊有說明小字");
  ok(await page.locator("#completedQty").inputValue() === "0", "這次良品預設 0（不再帶已完成數）");
  const reportLabels = await page.locator("#reportSheet").innerText();
  ok(!reportLabels.includes("良品累計"), "報工畫面沒有「良品累計」字樣");
  await page.locator("#completedQty").fill("7");
  ok((await page.locator("#noonAdvice").innerText()).includes("已完成＋這次") || (await page.locator("#noonAdvice").innerText()).includes("cycle time"), "中午建議改用「已完成＋這次」判斷");
  await page.screenshot({ path: path.join(outDir, "08-phone-single-report.png") });
  await page.locator("#machtileOperatorList input[type=checkbox]").first().waitFor({ timeout: 10000 });
  await page.evaluate(() => document.getElementById("reportForm").requestSubmit());
  await page.waitForFunction((n) => window.__noop || true, before);
  await page.waitForTimeout(1500);
  const single = calls.slice(before);
  ok(single.length === 1 && single[0].p_payload.report_type === "noon" && single[0].p_payload.completed_qty === 7, "單台「中午報工」照常送出（report_type=noon）", JSON.stringify(single.map((c) => c.p_payload?.report_type)));
  ok(Array.isArray(single[0]?.p_payload?.operators) && single[0].p_payload.operators.length >= 1, "單台報工仍帶 operators");
  // CATALOG_ENDPOINT_INVALID：HMC 品號目錄只接受 *.supabase.co，測試用的假網域必然觸發（環境造成，與本功能無關）
  const realErrors = errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));
  ok(realErrors.length === 0, "頁面沒有 JS 錯誤（排除假網域觸發的 CATALOG_ENDPOINT_INVALID）", realErrors.join(" | "));
  await context.close();
}

// ================= HMC regression =================
console.log("== 回歸：B01 臥式多盤報工路由 ==");
{
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"]);
  await page.goto(`${base}?route=%2Fm%2Fhmc-report&machine=B01`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("hmc-report-route-mode"), null, { timeout: 20000 });
  ok(true, "B01 多盤報工畫面照常進入（hmc-report-route-mode）");
  await page.waitForTimeout(800);
  const hmcText = await page.locator("body").innerText();
  ok(hmcText.includes("多盤多工件每日盤點") && hmcText.includes("白班") && hmcText.includes("夜班"), "多盤報工畫面內容照常（標題、白班／夜班）");
  ok(!hmcText.includes("良品累計"), "多盤報工畫面沒有「累計」數量欄");
  const hmcGeo = await page.evaluate(() => { const b = document.getElementById("machtileSessionBadge").getBoundingClientRect(); return b.top < 120; });
  ok(hmcGeo, "多盤報工畫面：登入徽章在上方，不擋底部內容");
  ok(errors.length === 0, "多盤報工畫面沒有 JS 錯誤", errors.join(" | "));
  await page.screenshot({ path: path.join(outDir, "06-phone-hmc-b01.png"), fullPage: false });
  await context.close();
}

// ================= tablet =================
console.log("== 平板（iPad 尺寸 810×1080，桌面版導覽）==");
{
  const { context, page, errors } = await newPage(browser, { ...devices["iPad (gen 7)"], defaultBrowserType: undefined });
  await waitLoaded(page);
  // 2026-10-02：入口從上方導覽列移到 Monitor 頁標題列（「+ 現場回報」前面）
  await page.locator('#dashboardView [data-monitor-batch-entry="lathe"]').click();
  const root = page.locator('[data-batch-root="lathe"]');
  await root.locator('[data-batch-row="A01"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled);
  ok(await page.locator('.nav-item[data-view="batchLathe"], .nav-item[data-view="batchMill"]').count() === 0, "平板上方導覽不再有「車床報工」「銑床報工」（已移到 Monitor 頁）");
  const tb = await page.evaluate(() => { const b = document.getElementById("machtileSessionBadge"); const r = b.getBoundingClientRect(); return { bottomGap: innerHeight - r.bottom, toggle: getComputedStyle(b.querySelector("[data-machtile-session-toggle]")).display, logout: getComputedStyle(b.querySelector("[data-machtile-logout]")).display }; });
  ok(tb.bottomGap >= 10 && tb.bottomGap <= 14 && tb.toggle === "none" && tb.logout !== "none", "平板：登入徽章維持原樣（右下角整條、沒有收合按鈕）", JSON.stringify(tb));
  const sb = await root.locator("[data-batch-submit]").boundingBox();
  ok(sb && sb.height >= 56, `送出鈕夠大（${sb && Math.round(sb.height)}px）`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `沒有橫向捲動（${overflow}px）`);
  await root.locator('[data-batch-row="A01"] [data-batch-good]').fill("9");
  await page.screenshot({ path: path.join(outDir, "07-tablet-lathe.png"), fullPage: true });
  const tabletErrors = errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));
  ok(tabletErrors.length === 0, "平板沒有 JS 錯誤（同上排除）", tabletErrors.join(" | "));
  await context.close();
}

await browser.close();
server.close();

const prodHits = blocked.filter((u) => u.includes("muditjubqflrqofbkmav") || u.includes("machtile.com"));
ok(prodHits.length === 0, "沒有任何請求打到正式後端／正式網域", prodHits.join(" "));
console.log(`  (blocked external requests: ${blocked.length}${blocked.length ? " e.g. " + [...new Set(blocked.map((u) => new URL(u).host))].join(",") : ""})`);
console.log(`\n${pass} passed, ${fail} failed  (screenshots: ${outDir})`);
process.exit(fail ? 1 : 0);
