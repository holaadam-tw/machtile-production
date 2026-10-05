// 批次報工「今日開工／中午報工／收工 / 完工」三種類型＋機台加工時間的瀏覽器端到端測試（Playwright，手機＋平板）。
// 不會碰任何真的後端：config.js 換成指向不存在的假專案網址的測試設定，Supabase 請求全部由這支腳本攔截、
// 用假資料回應；其他對外請求一律擋掉並記錄（最後斷言一次都沒有打到正式專案）。
//
// 重點：每種類型都拿「單台報工畫面真的送出的 payload」跟「批次送出的 payload」逐欄比對（同一道工序、同一類型）。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node batchModes.browser.test.mjs            （截圖寫到 ./.e2e-out/modes/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node batchModes.browser.test.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.BATCH_E2E_OUT || path.join(root, ".e2e-out", "modes");
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

// ---------- fixtures ----------
// 卡片牆的 HMC 品號目錄只接受 *.supabase.co 形式的網址，所以用一個不存在的子網域（請求全部在瀏覽器內攔下）
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
// 跟正式庫的痛點一樣：A01、A04 在 App 上沒有任何開工／報工紀錄（以前都在舊 MES 報工）
const cards = [
  card(1, "XX01202609020008", "A01", "pending", { quantity: 5000 }),
  card(2, "XX01202609160002", "A02", "running"),
  card(4, "XX01202604140011", "A04", "pending"),
  card(5, "XX01202609020009", "A05", "running"),
  card(6, "XX01202609170001", "B03", "running"),
];
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : "加工中心",
  location: { A01: "小瀧澤", A02: "大瀧澤" }[code] || "", status: "idle", display_order: i, department_name: code.startsWith("A") ? "車床課" : "銑床課",
}));
const baseProgress = {
  [id(301)]: { legacy_output: 3440, legacy_fail: 3, last_report_at: null, actual_start_at: null },
  [id(302)]: { legacy_output: 110, legacy_fail: 1, last_report_at: ago(90), actual_start_at: ago(300) },
  [id(304)]: { legacy_output: 55, legacy_fail: 0, last_report_at: null, actual_start_at: null },
  [id(305)]: { legacy_output: 0, legacy_fail: 0, last_report_at: ago(30), actual_start_at: ago(400) },
  [id(306)]: { legacy_output: 172, legacy_fail: 0, last_report_at: ago(60), actual_start_at: null },
};
// 機台加工時間：A02 這張單上一次填 1 分 35 秒；其他還沒填過
const machineTimeRows = [
  { process_id: id(302), cycle_time_seconds: 95, created_at: ago(90) },
];
const procToMachine = Object.fromEntries(cards.map((c) => [c.current_process_id, c.machine_name]));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: users[0].auth, email: "op@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const testConfigFor = ({ outbox = true } = {}) => `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key-for-e2e-only", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: ${outbox}, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
};`;

// ---------- fake backend（報工寫進來之後，進度／上次報工時間／機台加工時間都會跟著變，跟真的後端一樣）----------
const calls = [];
const inserted = new Map();   // report_uuid -> payload
const blocked = [];
let failNextFor = null;
let dropResponseFor = null;
let switchAnswer = true;   // 「上一次送出還沒確認成功，仍要切換？」要按確定還是取消
function progressRow(pid) {
  const b = baseProgress[pid];
  if (!b) return null;
  let last = b.last_report_at;
  let pendingOutput = 0, pendingFail = 0, pendingCount = 0;
  for (const p of inserted.values()) {
    if (p.process_id !== pid) continue;
    const at = p.ended_at || p.__created;
    if (!last || at > last) last = at;
    if ((p.completed_qty || 0) + (p.defect_qty || 0) > 0) { pendingOutput += p.completed_qty; pendingFail += p.defect_qty; pendingCount += 1; }
  }
  return { process_id: pid, legacy_output: b.legacy_output, legacy_fail: b.legacy_fail, pending_output: pendingOutput, pending_fail: pendingFail,
    pending_count: pendingCount, oldest_pending_at: null, last_report_at: last, actual_start_at: b.actual_start_at, legacy_synced_at: ago(3) };
}
async function handleFake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "op@test.invalid" });
  if (p === "/rest/v1/work_order_processes" && (url.searchParams.get("select") || "").includes("work_orders!inner")) {
    return json(200, cards.filter(c => machines.some(m => m.machine_code === c.machine_name)).map(c => ({
      id: c.current_process_id, tenant_id: c.tenant_id, process_order: 1,
      process_name: c.current_process_name, process_type: "cnc", status: c.current_process_status,
      off_station_at: c.current_process_off_station ? "2026-01-01T00:00:00Z" : null,
      qty_completed: c.qty_completed, queue_order: null,
      work_orders: { id: c.id, work_order_no: c.work_order_no, part_no: c.drawing_no,
        part_name: c.part_name, quantity: c.quantity, due_date: c.due_date, status: c.work_order_status },
      machines: machines.find(m => m.machine_code === c.machine_name),
    })));
  }
  if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
  if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
  if (p === "/rest/v1/app_users") {
    if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: users[0].name }]);
    return json(200, users.map(({ auth, ...u }) => u));
  }
  if (p === "/rest/v1/rpc/batch_report_progress") {
    const body = JSON.parse(req.postData() || "{}");
    return json(200, (body.p_process_ids || []).map(progressRow).filter(Boolean));
  }
  if (p === "/rest/v1/production_reports") {
    if ((url.searchParams.get("cycle_time_seconds") || "") === "not.is.null") {
      const extra = [...inserted.values()].filter((x) => x.cycle_time_seconds != null).map((x) => ({ process_id: x.process_id, cycle_time_seconds: x.cycle_time_seconds, created_at: x.__created }));
      return json(200, [...machineTimeRows, ...extra]);
    }
    // 單台報工用它找「伺服器上這道工序最後一次報工」：跟 batch_report_progress 的 last_report_at 同一份資料
    const pid = (url.searchParams.get("process_id") || "").replace(/^eq\./, "");
    const rows = [...inserted.values()].filter((x) => x.process_id === pid).map((x) => ({ ended_at: x.ended_at, created_at: x.__created }));
    if (baseProgress[pid]?.last_report_at) rows.push({ ended_at: baseProgress[pid].last_report_at, created_at: baseProgress[pid].last_report_at });
    return json(200, rows);
  }
  if (p === "/rest/v1/rpc/field_report_upsert") {
    const body = JSON.parse(req.postData() || "{}");
    calls.push(body);
    const machine = procToMachine[body.p_payload?.process_id];
    if (failNextFor && machine === failNextFor) { failNextFor = null; return json(400, { message: "simulated permanent rejection" }); }
    // 審查 L1：伺服器其實寫進去了，但回應在路上掉了（瀏覽器只看到網路錯誤）
    if (dropResponseFor && machine === dropResponseFor) {
      dropResponseFor = null;
      if (!inserted.has(body.p_report_uuid)) inserted.set(body.p_report_uuid, { ...body.p_payload, __created: new Date().toISOString() });
      return route.abort("connectionreset");
    }
    if (inserted.has(body.p_report_uuid)) return json(200, { report_id: id(7000), inserted: false });
    inserted.set(body.p_report_uuid, { ...body.p_payload, __created: new Date().toISOString() });
    return json(200, { report_id: id(7000 + inserted.size), inserted: true });
  }
  if (p.startsWith("/rest/v1/rpc/")) return json(200, null);
  if (p.startsWith("/rest/v1/")) return json(200, []);
  return json(200, {});
}

async function newPage(browser, device, { outbox = true } = {}) {
  const testConfig = testConfigFor({ outbox });
  const context = await browser.newContext({ ...device, serviceWorkers: "block" });
  await context.addInitScript(([token]) => {
    try { sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 })); } catch {}
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
  page.on("dialog", (d) => (d.message().includes("還沒確認成功") && !switchAnswer ? d.dismiss() : d.accept()));
  const errors = [];
  page.on("pageerror", (e) => { errors.push(String(e)); if (process.env.DBG) console.log("PAGEERROR", String(e)); });
  page.on("console", (m) => { if (process.env.DBG && m.type() !== "log") console.log("CONSOLE", m.type(), m.text().slice(0, 300)); });
  return { context, page, errors };
}
async function waitLoaded(page) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000, polling: 100 });
  await page.locator("#workOrderGrid .machine-tile-card").first().waitFor();
}
async function openBatch(page) {
  await page.evaluate(() => document.querySelector('#dashboardView [data-monitor-batch-entry="lathe"]').click());
  const root = page.locator('[data-batch-root="lathe"]');
  await root.locator('[data-batch-row="A01"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled);
  return root;
}
async function waitBatchDone(page) {
  try {
    await page.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-submit]')?.textContent.includes("送出中…"), null, { timeout: 20000, polling: 100 });
    await page.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled, null, { timeout: 20000, polling: 100 });
  } catch (error) {
    console.log("STATE", await page.evaluate(() => ({ submit: document.querySelector('[data-batch-root="lathe"] [data-batch-submit]')?.textContent, refresh: document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled, toast: document.querySelector(".toast, #toast")?.textContent, a04: document.querySelector('[data-batch-row="A04"]')?.innerText })), calls.length);
    throw error;
  }
}
const byMachine = (m, type) => calls.filter((c) => procToMachine[c.p_payload.process_id] === m && (!type || c.p_payload.report_type === type));

// 單台報工畫面真的送一筆（同一個 sheet、同一顆送出鈕）→ 回傳它送出的 RPC body
async function singleReport(page, workOrderNo, type, fill) {
  await page.evaluate(([wo, t]) => openReport(wo, { reportType: t }), [workOrderNo, type]);
  await page.locator("#machtileOperatorList input[type=checkbox]").first().waitFor({ timeout: 10000 });
  const boxes = page.locator("#machtileOperatorList input[type=checkbox]");
  for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).uncheck();
  await boxes.first().check();
  await fill(page);
  const before = calls.length;
  await page.evaluate(() => document.getElementById("reportForm").requestSubmit());
  for (let i = 0; i < 80 && calls.length === before; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  return calls[before] || null;
}
const png = { name: "photo.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex") };

// 逐欄比對：同類型、同工序。只有「本來就該不同」的欄位排除（uuid、送出時間、起算時間）；
// cycle_time_seconds、report_date 另外斷言（差異寫在 PR 對照表）。
const VOLATILE = new Set(["report_uuid", "ended_at", "started_at", "report_date", "cycle_time_seconds"]);
function parity(name, single, batch) {
  if (!single || !batch) { ok(false, name, "缺少 payload"); return; }
  const s = single.p_payload, b = batch.p_payload;
  const keysS = Object.keys(s).sort().join(","), keysB = Object.keys(b).sort().join(",");
  ok(keysS === keysB, `${name}：欄位名稱完全相同`, `single=${keysS}\n        batch =${keysB}`);
  const rpS = Object.keys(s.report_payload || {}).sort().join(","), rpB = Object.keys(b.report_payload || {}).sort().join(",");
  ok(rpS === rpB, `${name}：report_payload 欄位完全相同`, `single=${rpS}\n        batch =${rpB}`);
  const diffs = [];
  for (const k of Object.keys(s)) {
    if (VOLATILE.has(k)) continue;
    if (k === "report_payload") {
      for (const kk of Object.keys(s.report_payload)) {
        if (kk === "cycle_time_seconds") continue;
        if (JSON.stringify(s.report_payload[kk]) !== JSON.stringify(b.report_payload[kk])) diffs.push(`report_payload.${kk}: ${JSON.stringify(s.report_payload[kk])} vs ${JSON.stringify(b.report_payload[kk])}`);
      }
    } else if (JSON.stringify(s[k]) !== JSON.stringify(b[k])) diffs.push(`${k}: ${JSON.stringify(s[k])} vs ${JSON.stringify(b[k])}`);
  }
  ok(diffs.length === 0, `${name}：除時間欄位外逐欄值相同（含 remark、operators、user_id、machine_qty、overtime_plan）`, diffs.join(" | "));
  ok(("started_at" in s) === ("started_at" in b), `${name}：started_at 有／沒有的規則相同`, `single=${"started_at" in s} batch=${"started_at" in b}`);
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  // ================= phone =================
  console.log("== 手機（Pixel 7）：今日開工 ==");
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"]);
  await waitLoaded(page);

  // Monitor 卡片：A02 顯示上一次填的機台加工時間；A01 沒填過 → 「未填」（不是「-」）
  const cardText = async (code) => page.locator("#workOrderGrid .machine-tile-card").filter({ has: page.locator("h2", { hasText: code }) }).first().locator(".cycle-mini-grid").innerText();
  ok((await cardText("A02")).includes("機台加工時間") && (await cardText("A02")).includes("1分35秒"), "卡片 A02：機台加工時間 1分35秒 / 件", await cardText("A02"));
  ok((await cardText("A01")).includes("未填"), "卡片 A01：沒填過 → 寫「未填」", await cardText("A01"));
  ok((await cardText("A02")).match(/每日估算\s*\n?\s*\d+ 件/), "卡片 A02：每日估算用機台加工時間算", await cardText("A02"));

  const root = await openBatch(page);
  const tabs = await root.locator("[data-batch-mode]").allInnerTexts();
  ok(JSON.stringify(tabs) === JSON.stringify(["今日開工", "中午報工", "收工 / 完工"]), "最上方三個分頁：今日開工／中午報工／收工 / 完工", tabs.join(","));
  ok(await root.locator('[data-batch-mode="noon"]').getAttribute("aria-selected") === "true", "預設分頁＝中午報工（原本的行為）");
  ok((await root.locator('[data-batch-row="A01"] .batch-warn').innerText()).includes("今日開工"), "中午報工：A01 沒有開工紀錄 → 提示條請先按今日開工");
  await root.locator('[data-batch-mode="dailyStart"]').click();
  const checked = await root.locator("[data-batch-select]").evaluateAll((els) => Object.fromEntries(els.map((e) => [e.dataset.batchSelect, e.checked && !e.disabled])));
  ok(checked.A01 && checked.A02 && checked.A04 && checked.A05 && !checked.A03, "今日開工：預設勾有派工的 A01/A02/A04/A05，A03 沒派工不能勾", JSON.stringify(checked));
  ok((await root.locator("[data-batch-submit]").innerText()).includes("送出今日開工（4 台）"), "送出鈕：送出今日開工（4 台）");
  ok(await root.locator('[data-batch-row="A01"] [data-batch-good]').count() === 0, "今日開工不填數量");
  const overflow0 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow0 <= 1, `手機沒有橫向捲動（${overflow0}px）`);
  await page.screenshot({ path: path.join(outDir, "m1-phone-dailyStart.png"), fullPage: true });

  // 2026-10-05：批次今日開工不再有「當日首件檢查」勾選（首件只在首次開工）
  ok(await root.locator("[data-batch-first-article]").count() === 0, "批次今日開工沒有首件檢查勾選");
  await root.locator('[data-batch-select="A02"]').uncheck();   // A02 留給下面跟單台比對
  await page.evaluate(() => { const b = document.querySelector('[data-batch-root="lathe"] [data-batch-submit]'); b.click(); b.click(); });
  await waitBatchDone(page);
  ok(calls.length === 3, `連按兩下只送 3 台（A01、A04、A05），實際 ${calls.length}`);
  const dA01 = byMachine("A01", "dailyStart")[0]?.p_payload, dA04 = byMachine("A04", "dailyStart")[0]?.p_payload, dA05 = byMachine("A05", "dailyStart")[0]?.p_payload;
  ok(dA01 && dA01.report_type === "dailyStart" && dA01.completed_qty === 0 && dA01.defect_qty === 0, "今日開工：report_type=dailyStart、0／0");
  ok(dA01 && !("started_at" in dA01) && !("started_at" in dA04), "A01、A04 第一次在 App 開工：不帶 started_at（同單台）");
  ok(dA05 && dA05.started_at === baseProgress[id(305)].last_report_at, "A05 有上一筆：started_at＝上一筆（同單台規則）");
  ok(dA01 && dA01.remark === "[今日開工]；機台已加工數量 3440", "remark 同單台（機台已加工數量＝卡片完成數）", dA01?.remark);
  ok(dA01 && JSON.stringify(dA01.operators) === JSON.stringify([users[0].id]) && dA01.user_id === users[0].id, "operators＝這列報工人、user_id＝按送出的人");
  ok(dA01 && dA01.cycle_time_seconds === null, "今日開工不寫機台加工時間");
  ok(await root.locator('[data-batch-select="A01"]').isChecked() === false, "送出成功的機台取消勾選（再按不會再記一次）");
  ok((await root.locator('[data-batch-row="A01"] .batch-result').innerText()).includes("今日開工"), "A01 顯示已送出：今日開工");
  await page.screenshot({ path: path.join(outDir, "m2-phone-dailyStart-sent.png"), fullPage: true });

  console.log("== 手機：開工後中午報工＋機台加工時間 ==");
  await root.locator('[data-batch-mode="noon"]').click();
  await page.waitForTimeout(200);
  ok(!(await root.locator('[data-batch-row="A01"]').innerText()).includes("請先按上方「今日開工」"), "開工後 A01 不再被擋");
  ok(await root.locator('[data-batch-ct-min="A02"]').inputValue() === "1" && await root.locator('[data-batch-ct-sec="A02"]').inputValue() === "35", "A02 機台加工時間預設＝上一次填的 1 分 35 秒");
  ok(await root.locator('[data-batch-ct-min="A01"]').inputValue() === "", "A01 沒填過 → 留白（不自己編）");
  await root.locator('[data-batch-good="A01"]').fill("12");                  // 只填數量
  await root.locator('[data-batch-good="A04"]').fill("6");
  await root.locator('[data-batch-ct-min="A04"]').fill("2");                 // 數量＋第一次填時間
  await root.locator('[data-batch-ct-sec="A04"]').fill("10");
  await root.locator('[data-batch-ct-min="A05"]').fill("3");                 // 只填時間
  await root.locator('[data-batch-ct-sec="A05"]').fill("0");
  ok((await root.locator("[data-batch-submit]").innerText()).includes("送出中午報工（3 台）"), "送出鈕：送出中午報工（3 台）（只改時間的也算）");
  await page.screenshot({ path: path.join(outDir, "m3-phone-noon-filled.png"), fullPage: true });
  failNextFor = "A04";
  await root.locator("[data-batch-submit]").click();
  await waitBatchDone(page);
  const nA01 = byMachine("A01", "noon")[0]?.p_payload, nA05 = byMachine("A05", "noon")[0]?.p_payload;
  ok(nA01 && nA01.started_at === dA01.ended_at, "A01 中午報工 started_at＝今日開工的 ended_at（痛點解決：工時從開工起算）", `${nA01?.started_at} vs ${dA01?.ended_at}`);
  ok(nA01 && nA01.cycle_time_seconds === null && nA01.report_payload.cycle_time_seconds === null, "A01 只填數量、時間沒動 → 不寫時間");
  ok(nA05 && nA05.completed_qty === 0 && nA05.defect_qty === 0 && nA05.cycle_time_seconds === 180, "A05 只改時間 → 送 0／0＋cycle_time_seconds=180");
  ok(nA05 && nA05.started_at === dA05.ended_at && nA05.ended_at === dA05.ended_at, "A05 只改時間：started_at＝ended_at＝上一筆（不推進起算點、不吃工時）", `${nA05?.started_at} ${nA05?.ended_at} vs ${dA05?.ended_at}`);
  ok((await root.locator('[data-batch-row="A04"] .batch-result').innerText()).includes("拒收"), "A04 失敗 → 顯示原因、保留輸入");
  const firstA04 = byMachine("A04", "noon")[0]?.p_report_uuid;
  await root.locator("[data-batch-submit]").click();
  await waitBatchDone(page);
  const a04s = byMachine("A04", "noon");
  ok(a04s.length === 2 && a04s[1].p_report_uuid === firstA04, "重按：只重送 A04、沿用同一個 report_uuid");
  ok(byMachine("A01", "noon").length === 1 && byMachine("A05", "noon").length === 1, "已成功的列沒有被重送");
  ok(a04s[1].p_payload.cycle_time_seconds === 130 && a04s[1].p_payload.completed_qty === 6, "A04 數量＋機台加工時間 2 分 10 秒一起帶");
  ok(await root.locator('[data-batch-ct-min="A05"]').inputValue() === "3" && await root.locator('[data-batch-ct-sec="A05"]').inputValue() === "0", "送出後 A05 預設變成剛填的 3 分 0 秒");
  await page.screenshot({ path: path.join(outDir, "m4-phone-noon-sent.png"), fullPage: true });

  console.log("== 手機：收工 / 完工 ==");
  await root.locator('[data-batch-mode="finish"]').click();
  await root.locator('[data-batch-good="A01"]').fill("20");
  await root.locator("[data-batch-submit]").click();
  await page.waitForTimeout(300);
  ok(byMachine("A01", "finish").length === 0 && (await root.locator(".batch-notice.is-error").innerText()).includes("是否加班"), "收工沒選是否加班 → 不送、提示條說明");
  await root.locator('[data-batch-overtime][value="2030"]').check();
  await page.screenshot({ path: path.join(outDir, "m5-phone-finish.png"), fullPage: true });
  await root.locator("[data-batch-submit]").click();
  await waitBatchDone(page);
  const fA01 = byMachine("A01", "finish")[0]?.p_payload;
  ok(fA01 && fA01.remark === "[收工 / 完工]；加班收工 20:30" && fA01.report_payload.overtime_plan === "2030" && fA01.status_after_report === "pending", "收工：remark／overtime_plan 同單台、不把工序標成完工", JSON.stringify(fA01 && { r: fA01.remark, s: fA01.status_after_report }));
  ok(fA01 && fA01.started_at === nA01.ended_at, "收工 started_at＝中午報工的 ended_at（時段接續）");

  console.log("== 回到 Monitor：卡片馬上顯示新的機台加工時間 ==");
  await page.locator('.mobile-tab[data-view="dashboard"]').click();
  await page.waitForTimeout(300);
  ok((await cardText("A05")).includes("3分00秒"), "卡片 A05：機台加工時間＝剛在批次填的 3分00秒", await cardText("A05"));
  ok((await cardText("A04")).includes("2分10秒"), "卡片 A04：2分10秒", await cardText("A04"));

  console.log("== 跟單台報工畫面逐欄比對（同工序 A02、同類型）==");
  const sDaily = await singleReport(page, "XX01202609160002", "dailyStart", async (pg) => {
    await pg.locator("#machinePhoto").setInputFiles(png);
    ok(await pg.locator('[data-report-section="dailyStart"] .checklist-card').count() === 0, "單台今日開工不再有首次開工首件表");
    await pg.locator("#completedQty").fill("0");
  });
  const sNoon = await singleReport(page, "XX01202609160002", "noon", async (pg) => { await pg.locator("#completedQty").fill("7"); await pg.locator("#defectQty").fill("1"); });
  const sFinish = await singleReport(page, "XX01202609160002", "finish", async (pg) => {
    await pg.locator("#finishPhoto").setInputFiles(png);
    await pg.locator('input[name="finishOvertime"][value="none"]').check();
    await pg.locator("#completedQty").fill("9"); await pg.locator("#defectQty").fill("0");
  });
  ok(sDaily?.p_payload?.report_type === "dailyStart" && sNoon?.p_payload?.report_type === "noon" && sFinish?.p_payload?.report_type === "finish", "單台三種類型都送出了");
  const root2 = await openBatch(page);
  await root2.locator('[data-batch-mode="dailyStart"]').click();
  for (const c of ["A01", "A04", "A05"]) await root2.locator(`[data-batch-select="${c}"]`).uncheck().catch(() => {});
  await root2.locator('[data-batch-select="A02"]').check();
  await root2.locator("[data-batch-submit]").click();
  await waitBatchDone(page);
  const batchDaily = byMachine("A02", "dailyStart").at(-1);
  ok(batchDaily.p_payload.remark === sDaily.p_payload.remark, "批次與單台今日開工都不再宣告首件完成（remark 相同）");
  parity("今日開工", sDaily, batchDaily);
  await root2.locator('[data-batch-mode="noon"]').click();
  await root2.locator('[data-batch-good="A02"]').fill("7");
  await root2.locator('[data-batch-bad="A02"]').fill("1");
  await root2.locator("[data-batch-submit]").click();
  await waitBatchDone(page);
  parity("中午報工", sNoon, byMachine("A02", "noon").at(-1));
  await root2.locator('[data-batch-mode="finish"]').click();
  await root2.locator('[data-batch-overtime][value="none"]').check();
  await root2.locator('[data-batch-good="A02"]').fill("9");
  await root2.locator("[data-batch-submit]").click();
  await waitBatchDone(page);
  parity("收工 / 完工", sFinish, byMachine("A02", "finish").at(-1));
  const bNoon = byMachine("A02", "noon").at(-1)?.p_payload;
  ok([sDaily, sNoon, sFinish].every((c) => c.p_payload.cycle_time_seconds === null && c.p_payload.report_payload.cycle_time_seconds === null) && bNoon?.cycle_time_seconds === null,
    "審查 H1/M1：單台今日開工／中午／收工沒動 Cycle time → cycle_time_seconds=null（不再送隱藏的 95／550），跟批次一致",
    [sDaily, sNoon, sFinish].map((c) => c.p_payload.cycle_time_seconds).join(","));

  console.log("== 審查 H1/M1：單台首次開工的 Cycle time ==");
  // 先開有時間的 A02（欄位帶 1 分 35 秒），再開沒填過時間的 A01：不可以沿用 A02 的值，也不可以是 9 分 10 秒
  await page.evaluate(() => openReport("XX01202609160002", { reportType: "workStart" }));
  const a02Cycle = [await page.locator("#cycleMinutes").inputValue(), await page.locator("#cycleSeconds").inputValue()];
  await page.evaluate(() => openReport("XX01202609020008", { reportType: "workStart" }));
  const a01Cycle = [await page.locator("#cycleMinutes").inputValue(), await page.locator("#cycleSeconds").inputValue()];
  ok(a02Cycle.join(":") === "1:35" && a01Cycle.join(":") === ":", "先開 A02（1:35）再開沒填過的 A01 → Cycle time 留白（不沿用、不是 9:10）", `${a02Cycle} → ${a01Cycle}`);
  const sWork = await singleReport(page, "XX01202609020008", "workStart", async (pg) => {
    await pg.locator("#workTotalQty").fill("5000");
    await pg.locator("#cycleMinutes").fill("2");
    await pg.locator("#cycleSeconds").fill("5");
    await pg.locator("#startPhoto").setInputFiles(png);
    for (const cb of ["firstArticleSize", "firstArticleSurface", "firstArticleTool"]) await pg.locator(`#${cb}`).check();
  });
  ok(sWork?.p_payload?.report_type === "workStart" && sWork.p_payload.cycle_time_seconds === 125, "單台首次開工：使用者填的 2 分 5 秒照送（125）", JSON.stringify(sWork?.p_payload?.cycle_time_seconds));
  const sNoon2 = await singleReport(page, "XX01202609020008", "noon", async (pg) => {
    await pg.locator('.report-type-tab[data-report-type="workStart"]').click();
    await pg.locator("#cycleMinutes").fill("2");
    await pg.locator("#cycleSeconds").fill("20");
    await pg.locator('.report-type-tab[data-report-type="noon"]').click();
    await pg.locator("#completedQty").fill("3");
  });
  ok(sNoon2?.p_payload?.cycle_time_seconds === 140, "單台中午報工：使用者這次真的改過 Cycle time 才送（140）", JSON.stringify(sNoon2?.p_payload?.cycle_time_seconds));
  ok(inserted.size === new Set(calls.map((c) => c.p_report_uuid)).size, `後端沒有重複的報工（${inserted.size} 筆）`);

  const realErrors = errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));
  ok(realErrors.length === 0, "頁面沒有 JS 錯誤（排除假網域觸發的 CATALOG_ENDPOINT_INVALID）", realErrors.join(" | "));
  await context.close();

  // ================= L1：直送模式回應掉了 → 不可以換分頁再算一次 =================
  console.log("== 審查 L1：直送模式（enableOutboxSubmit:false），寫入成功但回應掉了 ==");
  {
    const d = await newPage(browser, devices["Pixel 7"], { outbox: false });
    await waitLoaded(d.page);
    const r = await openBatch(d.page);
    await r.locator('[data-batch-good="A05"]').fill("5");
    dropResponseFor = "A05";
    await r.locator("[data-batch-submit]").click();
    await waitBatchDone(d.page);
    const sumA05 = () => [...inserted.values()].filter((x) => procToMachine[x.process_id] === "A05" && x.report_type !== "dailyStart").reduce((s, x) => s + (x.completed_qty || 0), 0);
    const before = sumA05();
    ok((await r.locator('[data-batch-row="A05"] .batch-result').innerText()).includes("送出失敗"), "回應掉了 → 畫面顯示失敗（其實後端已寫入）");
    switchAnswer = false;
    await r.locator('[data-batch-mode="finish"]').click();
    await d.page.waitForTimeout(200);
    ok(await r.locator('[data-batch-mode="noon"]').getAttribute("aria-selected") === "true" && await r.locator('[data-batch-good="A05"]').inputValue() === "5", "有沒確認的 draft → 按取消就留在中午報工、數量保留");
    await d.page.screenshot({ path: path.join(outDir, "l1-phone-blocked-switch.png"), fullPage: true });
    const lastUuid = calls.filter((c) => procToMachine[c.p_payload.process_id] === "A05").at(-1).p_report_uuid;
    await r.locator("[data-batch-submit]").click();
    await waitBatchDone(d.page);
    const again = calls.filter((c) => procToMachine[c.p_payload.process_id] === "A05").at(-1);
    ok(again.p_report_uuid === lastUuid && (await r.locator('[data-batch-row="A05"] .batch-result').innerText()).includes("先前已收到"), "重按送出：同一個 report_uuid，後端回「先前已收到」");
    ok(sumA05() === before, `A05 這次 5 件只算一次（後端合計沒變：${before} → ${sumA05()}）`);
    // 確定切換：清空數量與待送紀錄，不會帶著 3 件去收工
    await r.locator('[data-batch-good="A04"]').fill("3");
    dropResponseFor = "A04";
    await r.locator("[data-batch-submit]").click();
    await waitBatchDone(d.page);
    switchAnswer = true;
    await r.locator('[data-batch-mode="finish"]').click();
    await d.page.waitForTimeout(200);
    const draftsLeft = await d.page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("machtile-batch-report-drafts") || "{}")));
    ok(await r.locator('[data-batch-mode="finish"]').getAttribute("aria-selected") === "true" && await r.locator('[data-batch-good="A04"]').inputValue() === "" && !draftsLeft.includes("A04"), "按確定切換 → A04 數量和待送紀錄清空（不會換新 uuid 再送一次）", JSON.stringify(draftsLeft));
    const dErr = d.errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));
    ok(dErr.length === 0, "直送模式沒有 JS 錯誤", dErr.join(" | "));
    await d.context.close();
  }

  // ================= tablet =================
  console.log("== 平板（810×1080）：三個分頁 ==");
  const tablet = await newPage(browser, { ...devices["iPad (gen 7)"], viewport: { width: 810, height: 1080 } });
  await waitLoaded(tablet.page);
  const troot = await openBatch(tablet.page);
  for (const mode of ["dailyStart", "noon", "finish"]) {
    await troot.locator(`[data-batch-mode="${mode}"]`).click();
    await tablet.page.waitForTimeout(150);
    const ov = await tablet.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(ov <= 1, `平板 ${mode}：沒有橫向捲動（${ov}px）`);
    const tb = await troot.locator(`[data-batch-mode="${mode}"]`).boundingBox();
    ok(tb && tb.height >= 48, `平板 ${mode}：分頁按鈕夠大（${tb && Math.round(tb.height)}px）`);
    await tablet.page.screenshot({ path: path.join(outDir, `t-${mode}.png`), fullPage: true });
  }
  const ctBox = await troot.locator('[data-batch-ct-min="A02"]').boundingBox();
  ok(ctBox && ctBox.height >= 48, `機台加工時間輸入框夠大（${ctBox && Math.round(ctBox.height)}px）`);
  const tErr = tablet.errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));
  ok(tErr.length === 0, "平板沒有 JS 錯誤", tErr.join(" | "));
  await tablet.context.close();
} finally {
  await browser.close();
  server.close();
}

const prodHits = blocked.filter((u) => u.includes("muditjubqflrqofbkmav") || u.includes("machtile.com"));
ok(prodHits.length === 0, "沒有任何請求打到正式後端／正式網域", prodHits.join(" "));
console.log(`\n${pass} passed, ${fail} failed  (screenshots: ${outDir})`);
process.exit(fail ? 1 : 0);
