// 機台卡片「開工／停工」回寫舊 MES（2026-10-07 第 1 階段）——瀏覽器端到端測試（Playwright，1440 桌機＋390 手機）。
//   1. 旗標關（預設）：沒有按鈕、完全不讀 station_commands；Monitor 卡片 HTML 跟 origin/main 的程式一字不差。
//   2. 旗標開但 station_commands 表不存在 → 整個藏起來（卡片 HTML 一樣跟 origin/main 相同）。
//   3. 旗標只開 A04：只有 A04 出按鈕；按「開工」→ 確認卡大字列出 機台／工單號／料號＋品名／第幾道＋工序名／舊 MES 現況。
//   4. 「不是這張單」→ 只叫他找生管，不送、不給換單。
//   5. 確認 → 呼叫 machtile_submit_station_command（App 產生的 command_uuid、合約欄位）；等待中按鈕鎖住、連按只送一次；
//      pending → claimed → applied；rejected（白話原因＋工廠說明）；expired。
//   6. 送出時 RPC 不存在 → 功能藏起來；送出時網路斷 → 「重送」用同一個 command_uuid。
// 不會碰任何真的後端：config.js 換成指向假專案網域的測試設定，Supabase 請求全部由這支腳本用假資料回應；
// 其他對外請求一律擋掉（最後斷言沒有打到正式專案）。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node stationCommand.browser.test.mjs           （截圖寫到 ./.e2e-out/station-command/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node stationCommand.browser.test.mjs
//   對照基準預設 origin/main（STATION_CMD_BASELINE_REF 可換）；讀不到 git 就跳過「跟 main 一字不差」那幾項並標 SKIP。
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.STATION_CMD_E2E_OUT || path.join(root, ".e2e-out", "station-command");
const baselineRef = process.env.STATION_CMD_BASELINE_REF || "origin/main";
const modSpec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const pw = await import(modSpec);
const { chromium } = pw.default || pw;

let pass = 0, fail = 0, skip = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "\n        " + extra : "")); }
}

// ---------- static server：/ ＝這份程式；/__baseline/ ＝ origin/main 的同一批檔案（git show） ----------
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const baselineCache = new Map();
let baselineAvailable = true;
try { execFileSync("git", ["-C", root, "rev-parse", "--verify", `${baselineRef}^{commit}`], { stdio: "pipe" }); }
catch { baselineAvailable = false; }
function baselineFile(rel) {
  if (!baselineCache.has(rel)) {
    try { baselineCache.set(rel, execFileSync("git", ["-C", root, "show", `${baselineRef}:${rel}`], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 })); }
    catch { baselineCache.set(rel, null); }
  }
  return baselineCache.get(rel);
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let p = decodeURIComponent(url.pathname);
  const isBaseline = p.startsWith("/__baseline/");
  if (isBaseline) p = p.slice("/__baseline".length);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  const type = types[path.extname(file)] || "application/octet-stream";
  if (isBaseline) {
    const body = baselineFile(p.replace(/^\//, ""));
    if (!body) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": type }); res.end(body); return;
  }
  try { const body = await readFile(file); res.writeHead(200, { "Content-Type": type }); res.end(body); }
  catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---------- fixtures ----------
const FAKE = "https://e2estationcmdzzzzzzzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const users = [{ id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) }];
const procs = [
  { n: 1, wo: "XX01202609020008", part: "MPW-01止油閥座", partNo: "MPW-01", machine: "A01", step: 2, proc: "車床加工", qty: 5000 },
  { n: 4, wo: "XX01202502050012", part: "HCG-06本體", partNo: "HCG-06-01", machine: "A04", step: 5, proc: "CNC車床二序", qty: 600 },
  { n: 33, wo: "XX01202606300001", part: "A37軸蓋", partNo: "A37-02", machine: "B03", step: 3, proc: "銑床加工", qty: 196 },
];
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: "", status: "idle", display_order: i,
}));
const cards = procs.map((p) => ({
  id: id(100 + p.n), tenant_id: T, work_order_no: p.wo, customer_name: "測試客戶", part_name: p.part, drawing_no: p.partNo,
  quantity: p.qty, due_date: "2026-10-30", priority: "normal", work_order_status: "in_progress",
  current_process_id: id(300 + p.n), current_process_name: p.proc, current_process_status: "pending",
  machine_name: p.machine, qty_completed: 0, qty_defect: 0, progress_percent: 0,
  last_report_at: null, open_risk_level: null, current_process_off_station: false,
}));
const legacyRows = [
  { work_order_no: "XX01202502050012", machine_code: "A04", process_order: 5, legacy_input: 210, legacy_output: 208, legacy_fail: 2, legacy_updated_at: "2026-10-07T01:30:00Z", legacy_snapshot_at: "2026-10-07T01:35:00Z", legacy_synced_at: "2026-10-07T01:35:10Z" },
  { work_order_no: "XX01202502050012", machine_code: "A04", process_order: 4, legacy_input: 600, legacy_output: 598, legacy_fail: 2, legacy_updated_at: "2026-10-01T01:30:00Z", legacy_snapshot_at: "2026-10-07T01:35:00Z", legacy_synced_at: "2026-10-07T01:35:10Z" },
];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwtFor = (role) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: users[0].auth, email: "op@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role } })}.sig`;
const testConfig = (extra) => `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key-for-e2e-only", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: true, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
  ${extra || ""}
};`;

// ---------- fake backend（每個情境一份） ----------
function makeBackend({ tableMissing = false, rpcMissing = false, role = "operator", submitError = null } = {}) {
  const be = {
    tableMissing, rpcMissing, role, submitError,
    stationReads: 0,          // 任何對 station_commands 的請求
    submits: [],              // RPC body
    commands: new Map(),      // uuid → row
    mode: "hold",             // 輪詢回覆：hold（pending→claimed）／applied／rejected／expired
    reject: { code: "ORDER_MISMATCH", message: "Manufacture.OrderNO=XX01202509300001 IndexSN=2" },
    abortNextSubmit: false,
    otherWrites: [],
  };
  be.handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const q = decodeURIComponent(url.search);
    const method = req.method();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/rest/v1/rpc/machine_department_context") return json(200, { tenant_id: T, role: be.role, is_bridge: false, all_departments: true, department_codes: ["LATHE", "MILL"] });
    if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "op@test.invalid" });
    if (p === "/rest/v1/station_commands") {
      be.stationReads++;
      if (be.tableMissing) return json(404, { code: "PGRST205", message: "Could not find the table 'public.station_commands' in the schema cache" });
      const m = q.match(/command_uuid=eq\.([0-9a-f-]+)/);
      if (!m) return json(200, []);
      const row = be.commands.get(m[1]);
      if (!row) return json(200, []);
      if (be.mode === "hold") { row.status = row.status === "pending" ? "claimed" : row.status; }
      else if (be.mode === "applied") { row.status = "applied"; row.applied_at = new Date().toISOString(); }
      else if (be.mode === "rejected") { row.status = "rejected"; row.reject_code = be.reject.code; row.reject_message = be.reject.message; }
      else if (be.mode === "expired") { row.status = "expired"; row.reject_code = "EXPIRED"; }
      else if (be.mode === "stale") { row.status = "pending"; row.requested_at = new Date(Date.now() - 11 * 60000).toISOString(); }   // 伺服器還沒落地 expired（合約 §3）
      return json(200, [row]);
    }
    if (p === "/rest/v1/rpc/machtile_submit_station_command") {
      be.stationReads++;
      const body = JSON.parse(req.postData() || "{}");
      be.submits.push(body);
      if (be.rpcMissing) return json(404, { code: "PGRST202", message: "Could not find the function public.machtile_submit_station_command" });
      if (be.abortNextSubmit) { be.abortNextSubmit = false; return route.abort("failed"); }
      if (be.submitError) return json(400, { code: "P0001", message: be.submitError, details: null, hint: null });
      let row = be.commands.get(body.p_command_uuid);
      if (!row) {
        row = { id: id(9000 + be.commands.size), command_uuid: body.p_command_uuid, command_type: body.p_command_type, machine_code: body.p_machine_code,
          expected_order_no: body.p_expected_order_no, expected_index_sn: body.p_expected_index_sn, requested_at: new Date().toISOString(), status: "pending", reject_code: null, reject_message: null, applied_at: null };
        be.commands.set(body.p_command_uuid, row);
      }
      return json(200, row);
    }
    if (p === "/rest/v1/work_order_processes" && (url.searchParams.get("select") || "").includes("work_orders!inner")) {
      return json(200, procs.map((x) => {
        const c = cards.find((k) => k.work_order_no === x.wo);
        return {
          id: c.current_process_id, tenant_id: T, process_order: x.step, process_name: x.proc, process_type: "cnc", status: "pending",
          off_station_at: null, qty_completed: 0, queue_order: null,
          work_orders: { id: c.id, work_order_no: x.wo, part_no: x.partNo, part_name: x.part, quantity: x.qty, due_date: c.due_date, status: "in_progress" },
          machines: machines.find((m) => m.machine_code === x.machine),
        };
      }));
    }
    if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
    if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
    if (p === "/rest/v1/app_users") {
      if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: users[0].name }]);
      return json(200, users.map(({ auth, ...u }) => u));
    }
    if (p === "/rest/v1/legacy_station_progress") {
      const m = q.match(/work_order_no=in\.\(([^)]*)\)/);
      const wanted = m ? m[1].split(",").map((s) => s.replace(/"/g, "")) : [];
      return json(200, legacyRows.filter((r) => wanted.includes(r.work_order_no)));
    }
    if (p === "/rest/v1/work_order_processes") {
      const m = q.match(/id=in\.\(([^)]*)\)/);
      if (m && q.includes("actual_start_at")) return json(200, m[1].split(",").map((pid) => ({ id: pid, process_order: procs.find((x) => id(300 + x.n) === pid)?.step || 1, process_type: "cnc", actual_start_at: null })));
      return json(200, []);
    }
    if (p === "/rest/v1/rpc/batch_report_progress") return json(200, []);
    const readRpc = /^\/rest\/v1\/rpc\/(batch_report_progress|[a-z_]+_snapshot|[a-z_]+_list)$/.test(p);
    if (method !== "GET" && method !== "HEAD" && !readRpc) be.otherWrites.push(`${method} ${p}`);
    if (p.startsWith("/rest/v1/rpc/")) return json(200, null);
    if (p.startsWith("/rest/v1/")) return json(200, []);
    return json(200, {});
  };
  return be;
}

const blocked = [];
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

async function newPage(browser, vp, { backend, configExtra = "", baseline = false }) {
  const context = await browser.newContext({ ...VIEWPORTS[vp], serviceWorkers: "block", timezoneId: "Asia/Taipei", locale: "zh-TW" });
  const token = jwtFor(backend.role || "operator");
  await context.addInitScript(([token]) => {
    try {
      sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
    } catch {}
  }, [token]);
  const appBase = baseline ? `${base}__baseline/` : base;
  await context.route("**/*", async (route) => {
    const u = route.request().url();
    if (u.startsWith(FAKE)) return backend.handle(route);
    if (u.startsWith(base)) {
      if (new URL(u).pathname.endsWith("/config.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: testConfig(configExtra) });
      return route.continue();
    }
    blocked.push(u);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(appBase, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid .machine-tile-card").length > 0, null, { timeout: 20000 });
  await page.waitForFunction(() => typeof machtileCardPickState === "undefined" || machtileCardPickState.status === "ready", null, { timeout: 20000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { deriveMachines(); renderWorkOrders(); });
  return { context, page, errors };
}

const cardOf = (page, code) => page.locator("#workOrderGrid .machine-tile-card").filter({ has: page.locator("h2", { hasText: code }) }).first();
const realErrors = (errors) => errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));
// 卡片裡的報工／完整單連結會帶頁面網址（對照組在 /__baseline/ 底下）→ 比較前把那段拿掉
const gridHtml = (page) => page.evaluate(() => document.getElementById("workOrderGrid").innerHTML.replace(/\s+/g, " ").split("/__baseline/").join("/"));
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return `@${i}: …${a.slice(Math.max(0, i - 80), i + 80)}… vs …${b.slice(Math.max(0, i - 80), i + 80)}…`; };
const sheet = (page) => page.locator("#machtileStationCmdSheet");
const fieldText = async (page, key) => (await sheet(page).locator(`[data-station-cmd-field="${key}"]`).innerText()).trim();

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

// ---------------------------------------------------------------------------------------------
for (const vp of ["desktop", "phone"]) {
  const W = VIEWPORTS[vp].viewport.width;
  console.log(`\n== ${W}px：旗標關（預設）＝跟現在一模一樣 ==`);
  let baselineGrid = null;
  if (baselineAvailable) {
    const be0 = makeBackend();
    const b = await newPage(browser, vp, { backend: be0, baseline: true });
    baselineGrid = await gridHtml(b.page);
    await b.context.close();
  }
  {
    const be = makeBackend();
    const { context, page, errors } = await newPage(browser, vp, { backend: be });
    ok(await page.locator(".station-cmd-row, [data-station-cmd]").count() === 0, `${W}：旗標關 → 沒有開工／停工按鈕`);
    ok(be.stationReads === 0, `${W}：旗標關 → 完全沒讀 station_commands／沒呼叫 RPC（${be.stationReads}）`);
    if (baselineGrid !== null) { const g = await gridHtml(page); ok(g === baselineGrid, `${W}：旗標關 → Monitor 卡片 HTML 跟 ${baselineRef} 一字不差`, firstDiff(g, baselineGrid)); }
    else { skip++; console.log(`  SKIP ${W}：讀不到 ${baselineRef}，略過一字不差比對`); }
    ok(be.otherWrites.length === 0, `${W}：旗標關 → 沒有任何寫入`, be.otherWrites.join(" "));
    ok(realErrors(errors).length === 0, `${W}：旗標關 → 沒有 JS 錯誤`, realErrors(errors).join(" | "));
    await context.close();
  }

  console.log(`== ${W}px：旗標開但 station_commands 表不存在 ==`);
  {
    const be = makeBackend({ tableMissing: true });
    const { context, page, errors } = await newPage(browser, vp, { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
    ok(await page.locator(".station-cmd-row, [data-station-cmd]").count() === 0, `${W}：表不存在 → 沒有按鈕`);
    ok(be.stationReads >= 1 && be.submits.length === 0, `${W}：只試讀一次，沒送任何指令`);
    if (baselineGrid !== null) { const g = await gridHtml(page); ok(g === baselineGrid, `${W}：表不存在 → 卡片 HTML 跟 ${baselineRef} 一字不差`, firstDiff(g, baselineGrid)); }
    ok(realErrors(errors).length === 0, `${W}：表不存在 → 沒有 JS 錯誤`, realErrors(errors).join(" | "));
    await context.close();
  }

  console.log(`== ${W}px：旗標只開 A04 ==`);
  {
    const be = makeBackend();
    const { context, page, errors } = await newPage(browser, vp, { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
    const a04 = cardOf(page, "A04");
    ok(await a04.locator("[data-station-cmd]").count() === 2, `${W}：A04 有「開工」「停工」`);
    ok(await page.locator("#workOrderGrid [data-station-cmd]").count() === 2, `${W}：只有 A04 有（A01、B03 沒有）`);
    ok(be.submits.length === 0, `${W}：還沒按 → 沒送`);
    await a04.scrollIntoViewIfNeeded();
    await a04.screenshot({ path: path.join(outDir, `${vp}-01-a04-card.png`) });

    // 確認卡內容
    await a04.locator('[data-station-cmd="start"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
    ok(!(await page.locator("#detailSheet").evaluate((el) => el.classList.contains("is-open"))), `${W}：按開工不會打開工單明細`);
    ok((await sheet(page).locator("h2").innerText()).trim() === "確認開工", `${W}：確認卡標題「確認開工」`);
    ok(await fieldText(page, "machine") === "A04", `${W}：機台 A04`);
    ok(await fieldText(page, "order") === "XX01202502050012", `${W}：工單號`);
    ok(await fieldText(page, "part") === "HCG-06-01　HCG-06本體", `${W}：料號＋品名`, await fieldText(page, "part"));
    ok(await fieldText(page, "step") === "第 5 道　CNC車床二序", `${W}：第幾道＋工序名`, await fieldText(page, "step"));
    const legacyText = (await sheet(page).locator("[data-station-cmd-legacy]").innerText()).replace(/\s+/g, " ");
    ok(legacyText.includes("舊 MES 已報：良品 208、不良 2") && legacyText.includes("舊 MES 最後報工：2026-10-07 09:30") && legacyText.includes("派工橋同步時間：2026-10-07 09:35"),
      `${W}：舊 MES 現況＝第 5 道那列（不是第 4 道）`, legacyText);
    ok(legacyText.includes("派工橋沒有同步") , `${W}：照實說開停狀態沒有同步`);
    const fontPx = await sheet(page).locator('[data-station-cmd-field="order"]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    ok(fontPx >= 22, `${W}：工單號是大字（${fontPx}px）`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, `${W}：沒有橫向捲動（${overflow}px）`);
    ok(be.submits.length === 0, `${W}：開確認卡還沒送`);
    await page.screenshot({ path: path.join(outDir, `${vp}-02-confirm-start.png`) });

    // 不是這張單 → 只叫他找生管
    await sheet(page).locator("[data-station-cmd-notthis-open]").click();
    const notThis = (await sheet(page).locator("[data-station-cmd-notthis]").innerText()).trim();
    ok(notThis.includes("請找生管") && notThis.includes("不會幫你換單"), `${W}：不是這張單 → 找生管`, notThis);
    ok(await sheet(page).locator("[data-station-cmd-confirm]").count() === 0 && await sheet(page).locator("[data-card-select-process], [data-card-pick]").count() === 0, `${W}：不給確認、也不給換單`);
    await page.screenshot({ path: path.join(outDir, `${vp}-03-not-this-order.png`) });
    await sheet(page).locator("[data-station-cmd-close]").click();
    ok(await sheet(page).count() === 0 && be.submits.length === 0, `${W}：關掉 → 沒送`);

    // 確認 → 等待中（連按只送一次、卡片按鈕鎖住）
    be.mode = "hold";
    await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
    await sheet(page).locator("[data-station-cmd-confirm]").evaluate((el) => { el.click(); el.click(); el.click(); });
    await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor({ timeout: 10000 });
    ok(be.submits.length === 1, `${W}：連按三下只送一次（${be.submits.length}）`);
    const sent = be.submits[0] || {};
    ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sent.p_command_uuid || ""), `${W}：command_uuid 由 App 產生（v4）`, sent.p_command_uuid);
    ok(sent.p_command_type === "start" && sent.p_machine_code === "A04" && sent.p_expected_order_no === "XX01202502050012" && sent.p_expected_index_sn === 5 && sent.p_expected_part_no === "HCG-06-01" && sent.p_manufacture_ii_id === null,
      `${W}：送出內容＝合約欄位`, JSON.stringify(sent));
    ok((await sheet(page).locator("[data-station-cmd-result]").innerText()).includes("不要重按"), `${W}：等待中提示不要重按`);
    await page.waitForTimeout(2600);   // 至少一次輪詢 → claimed
    ok((await sheet(page).locator("[data-station-cmd-result] strong").innerText()).trim() === "工廠處理中…", `${W}：輪詢到 claimed → 工廠處理中`);
    await page.screenshot({ path: path.join(outDir, `${vp}-04-pending.png`) });
    await sheet(page).locator("[data-station-cmd-close]").click();
    const disabled = await cardOf(page, "A04").locator("[data-station-cmd]").evaluateAll((els) => els.map((e) => e.disabled));
    ok(disabled.length === 2 && disabled.every(Boolean), `${W}：等待中 A04 兩個按鈕都鎖住`, JSON.stringify(disabled));
    ok((await cardOf(page, "A04").locator("[data-station-cmd-status]").innerText()).includes("等待工廠套用"), `${W}：卡片顯示等待中`);
    await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click({ force: true }).catch(() => {});
    ok(await sheet(page).count() === 0 && be.submits.length === 1, `${W}：等待中按停工沒反應`);

    // applied
    be.mode = "applied";
    await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-station-cmd-status]')?.textContent.includes("已開工"), null, { timeout: 15000 });
    const enabled = await cardOf(page, "A04").locator("[data-station-cmd]").evaluateAll((els) => els.map((e) => !e.disabled));
    ok(enabled.every(Boolean), `${W}：套用完成 → 按鈕解鎖`);
    ok((await cardOf(page, "A04").locator("[data-station-cmd-status]").innerText()).trim() === "已開工", `${W}：卡片顯示「已開工」`);
    await cardOf(page, "A04").scrollIntoViewIfNeeded();
    await cardOf(page, "A04").screenshot({ path: path.join(outDir, `${vp}-05-a04-applied.png`) });

    // 開著確認卡看到 applied
    be.mode = "hold";
    await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
    ok((await sheet(page).locator("h2").innerText()).trim() === "確認停工", `${W}：停工確認卡`);
    await sheet(page).locator("[data-station-cmd-confirm]").click();
    await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor();
    ok(be.submits.length === 2 && be.submits[1].p_command_type === "stop" && be.submits[1].p_command_uuid !== be.submits[0].p_command_uuid, `${W}：停工是新的一筆指令（新 uuid）`);
    be.mode = "applied";
    await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
    ok((await sheet(page).locator("[data-station-cmd-result] strong").innerText()).trim() === "已停工", `${W}：確認卡顯示「已停工」`);
    await page.screenshot({ path: path.join(outDir, `${vp}-06-applied-stop.png`) });
    await sheet(page).locator("[data-station-cmd-close]").click();

    // rejected
    be.mode = "hold";
    await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
    await sheet(page).locator("[data-station-cmd-confirm]").click();
    await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor();
    be.mode = "rejected";
    await sheet(page).locator('[data-station-cmd-result="rejected"]').waitFor({ timeout: 15000 });
    const rej = (await sheet(page).locator("[data-station-cmd-result]").innerText()).replace(/\s+/g, " ");
    ok(rej.includes("沒有開工") && rej.includes("舊 MES 這台現在不是這張工單") && rej.includes("請找生管") && rej.includes("Manufacture.OrderNO=XX01202509300001") && rej.includes("ORDER_MISMATCH"),
      `${W}：被拒 → 白話原因＋工廠說明＋代碼`, rej);
    await page.screenshot({ path: path.join(outDir, `${vp}-07-rejected.png`) });
    await sheet(page).locator("[data-station-cmd-close]").click();
    ok((await cardOf(page, "A04").locator("[data-station-cmd-status]").innerText()).includes("沒有開工"), `${W}：卡片顯示被拒`);
    ok(await cardOf(page, "A04").locator('[data-station-cmd="start"]').isEnabled(), `${W}：被拒後可以再按`);

    // expired
    be.mode = "hold";
    await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
    await sheet(page).locator("[data-station-cmd-confirm]").click();
    await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor();
    be.mode = "expired";
    await sheet(page).locator('[data-station-cmd-result="expired"]').waitFor({ timeout: 15000 });
    const exp = (await sheet(page).locator("[data-station-cmd-result]").innerText()).replace(/\s+/g, " ");
    ok(exp.includes("已過期") && exp.includes("超過 10 分鐘工廠都沒有處理") && exp.includes("沒有生效"), `${W}：過期 → 白話`, exp);
    await page.screenshot({ path: path.join(outDir, `${vp}-08-expired.png`) });
    await sheet(page).locator("[data-station-cmd-close]").click();

    ok(be.otherWrites.length === 0, `${W}：除了指令 RPC 沒有任何其他寫入`, be.otherWrites.join(" "));
    ok(realErrors(errors).length === 0, `${W}：沒有 JS 錯誤`, realErrors(errors).join(" | "));
    await context.close();
  }
}

console.log("\n== 390px：送出時 RPC 不存在 → 功能藏起來 ==");
{
  const be = makeBackend({ rpcMissing: true });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 10000 });
  ok((await sheet(page).locator("[data-station-cmd-error]").innerText()).includes("還沒在伺服器啟用"), "RPC 不存在 → 白話「還沒啟用」");
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(await page.locator("#workOrderGrid [data-station-cmd]").count() === 0, "RPC 不存在 → 卡片按鈕全部藏起來");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：送出時網路斷 → 重送用同一個 command_uuid ==");
{
  const be = makeBackend();
  be.abortNextSubmit = true;
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 10000 });
  ok((await sheet(page).locator("[data-station-cmd-error]").innerText()).includes("不會重複"), "網路斷 → 說明重送不會重複");
  ok((await sheet(page).locator("[data-station-cmd-confirm]").innerText()).trim() === "重送", "按鈕變「重送」");
  ok(await page.locator('#workOrderGrid [data-station-cmd="start"]').isDisabled(), "不確定有沒有送到 → 卡片先鎖住");
  be.mode = "applied";
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  ok(be.submits.length === 2 && be.submits[0].p_command_uuid === be.submits[1].p_command_uuid, "重送用同一個 command_uuid", JSON.stringify(be.submits.map((s) => s.p_command_uuid)));
  ok(be.commands.size === 1, "伺服器只有一筆指令");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 1440px：旗標開但登入的是生管（planner）→ 不出按鈕、不讀 ==");
{
  const be = makeBackend({ role: "planner" });
  const { context, page, errors } = await newPage(browser, "desktop", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  ok(await page.locator("#workOrderGrid [data-station-cmd]").count() === 0, "planner → 沒有開工／停工按鈕（RPC 只收作業員）");
  ok(be.stationReads === 0, `planner → 沒讀 station_commands（${be.stationReads}）`);
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：pending 超過 10 分鐘（伺服器還沒落地）→ 直接顯示已過期 ==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  be.mode = "stale";
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="expired"]').waitFor({ timeout: 15000 });
  ok((await sheet(page).locator("[data-station-cmd-result] strong").innerText()).trim() === "已過期", "requested_at 超過 10 分鐘的 pending → 已過期");
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(await cardOf(page, "A04").locator('[data-station-cmd="start"]').isEnabled(), "過期後解鎖、可以再按");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：同一台已有指令在途（別台平板按的）→ 白話、不鎖 ==");
{
  const be = makeBackend({ submitError: "MACHINE_COMMAND_IN_FLIGHT: A04 already has a pending command" });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 10000 });
  const t = (await sheet(page).locator("[data-station-cmd-error]").innerText()).trim();
  ok(t.includes("已經有一筆開工／停工在等工廠處理"), "在途 → 白話", t);
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(await cardOf(page, "A04").locator('[data-station-cmd="stop"]').isEnabled(), "伺服器明確拒絕 → 不鎖卡片");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

await browser.close();
server.close();

const prodHits = blocked.filter((u) => u.includes("muditjubqflrqofbkmav") || u.includes("machtile.com"));
ok(prodHits.length === 0, "沒有任何請求打到正式後端／正式網域", prodHits.join(" "));
console.log(`  (blocked external requests: ${blocked.length}${blocked.length ? " e.g. " + [...new Set(blocked.map((u) => new URL(u).host))].join(",") : ""})`);
console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ""}  (screenshots: ${outDir})`);
process.exit(fail ? 1 : 0);
