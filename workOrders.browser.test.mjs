// 工單管理（owner 2026-10-02：加來源欄＋清單優化）——瀏覽器端到端測試（Playwright，手機 360px＋平板 810px）。
//   1. 來源欄：created_by 為 null →「舊 MES 派工」（灰）；有 created_by →「App 手動」（藍）＋建立者
//   2. 清單：單號／品名（品號小字）／數量（已報／訂單＋進度條，cardProgress 口徑）／交期（逾期紅、3 天內橘）／機台／來源；
//      依交期排序；搜尋（單號、品名、品號）；篩選（全部／逾期／舊 MES 派工／App 手動）
//   3. 建單表單上方黃色提示；舊 MES 派工單改派機台 → 確認視窗（取消＝不送）
//   4. 360px 不橫向捲動、窄螢幕是卡片；除了建單送出（rpc/work_order_upsert）之外沒有任何寫入
// 不會碰任何真的後端：config.js 換成指向假專案網域的測試設定，所有 Supabase 請求由這支腳本攔截、用假資料回應。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node workOrders.browser.test.mjs            （截圖寫到 ./.e2e-out/work-orders/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node workOrders.browser.test.mjs
//   WO_SHOT_TAG=before|after 可替截圖檔名加前綴；WO_SHOTS_ONLY=1 只截圖不斷言（拿來截改前畫面）。
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.WO_E2E_OUT || path.join(root, ".e2e-out", "work-orders");
const modSpec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const pw = await import(modSpec);
const { chromium, devices } = pw.default || pw;
const shotsOnly = process.env.WO_SHOTS_ONLY === "1";

let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
  if (shotsOnly) return;
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

// ---------- fixtures（假資料）----------
const FAKE = "https://e2eworkorderszzzzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const pad = (n) => String(n).padStart(2, "0");
const dayOffset = (d) => { const t = new Date(); t.setDate(t.getDate() + d); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
const users = [{ id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) }];
const creators = { [id(950)]: "測試員" };
const machineCodes = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"];
const machineRows = machineCodes.map((code, i) => ({ id: id(200 + i), machine_code: code, name: code, location: { A01: "小瀧澤", B04: "大立" }[code] || "" }));
const mid = (code) => machineRows.find((m) => m.machine_code === code).id;
const proc = (n, code, extra = {}) => ({ id: id(300 + n), machine_id: code ? mid(code) : null, process_order: 1, qty_completed: 0, off_station_at: null, process_name: "CNC 加工", ...extra });
// 刻意打亂順序：畫面要自己依交期排
const workOrders = [
  { id: id(104), work_order_no: "XX01202609200002", part_no: "CPDF-20-01", part_name: "CPDF-20閥體", quantity: 300, due_date: dayOffset(20), status: "not_started", created_by: null, work_order_processes: [] },
  { id: id(103), work_order_no: "WO-GATE-P3-001", part_no: null, part_name: "P3 Gate 驗證件", quantity: 10, due_date: dayOffset(10), status: "in_progress", created_by: id(950), work_order_processes: [proc(3, "A02", { qty_completed: 4 }), proc(8, "A02", { process_order: 2 })] },
  { id: id(105), work_order_no: "XX01202605010001", part_no: "A37-01", part_name: "A37九孔座", quantity: 165, due_date: dayOffset(-60), status: "completed", created_by: null, work_order_processes: [proc(5, "A03", { off_station_at: new Date(now - 86400000).toISOString(), qty_completed: 165 })] },
  { id: id(101), work_order_no: "XX01202609100001", part_no: "MPW-01-02", part_name: "MPW-01止油閥座", quantity: 500, due_date: dayOffset(-5), status: "in_progress", created_by: null, work_order_processes: [proc(1, "A01", { qty_completed: 12 })] },
  { id: id(106), work_order_no: "XX01202609250003", part_no: "HCG-06-02", part_name: "HCG-06蓋板", quantity: 80, due_date: dayOffset(30), status: "not_started", created_by: null, work_order_processes: [proc(6, "B01", { off_station_at: new Date(now - 3600000).toISOString() })] },
  { id: id(102), work_order_no: "XX01202609290006", part_no: "HCG-06-01", part_name: "HCG-06本體（長品名測試：雙面加工含攻牙與去毛邊）", quantity: 120, due_date: dayOffset(2), status: "in_progress", created_by: null, work_order_processes: [proc(2, "B04", { qty_completed: 30 }), proc(7, "B04", { process_order: 2 })] },
];
const expectedOrder = ["XX01202609100001", "XX01202609290006", "WO-GATE-P3-001", "XX01202609200002", "XX01202609250003", "XX01202605010001"];
// 舊 MES 結算：第 1 張有（舊 MES 300＋待回寫 20 → 320）；其他沒有 → 照 App 累計
const progress = {
  [id(301)]: { legacy_output: 300, legacy_fail: 2, pending_output: 20, pending_fail: 0, pending_count: 1, oldest_pending_at: new Date(now - 600000).toISOString(), last_report_at: null, actual_start_at: null, legacy_synced_at: new Date(now - 180000).toISOString() },
};
const cards = [{
  id: id(101), tenant_id: T, work_order_no: "XX01202609100001", customer_name: "測試客戶", part_name: "MPW-01止油閥座", drawing_no: null,
  quantity: 500, due_date: dayOffset(-5), priority: "normal", work_order_status: "in_progress",
  current_process_id: id(301), current_process_name: "CNC 加工", current_process_status: "running",
  machine_name: "A01", qty_completed: 12, qty_defect: 0, progress_percent: 2, last_report_at: null, open_risk_level: null, current_process_off_station: false,
}];
const cardMachines = machineCodes.map((code, i) => ({ id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : "加工中心", location: "", status: "idle", display_order: i }));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwtFor = (role) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: users[0].auth, email: "planner@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role } })}.sig`;
const testConfig = `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key-for-e2e-only", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: true, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
};`;

const blocked = [];
const seen = [];
function makeBackend() {
  const writes = [];     // 開啟工單管理之後的所有非 GET 請求（路徑＋body）
  const upserts = [];
  let recording = false;
  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (recording && req.method() !== "GET" && req.method() !== "HEAD") writes.push({ method: req.method(), path: p, body: req.postData() || "" });
    if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "planner@test.invalid" });
    if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
    if (p === "/rest/v1/v_machine_management_cards") return json(200, cardMachines);
    if (p === "/rest/v1/machines") return json(200, machineRows);
    if (p === "/rest/v1/work_orders") {
      const select = url.searchParams.get("select") || "";
      const eq = url.searchParams.get("work_order_no");
      let rows = workOrders;
      if (eq && eq.startsWith("eq.")) rows = rows.filter((w) => w.work_order_no === eq.slice(3));
      return json(200, rows.map((w) => {
        const out = { ...w };
        if (select.includes("source_system")) Object.assign(out, { source_system: null, legacy_mes_source: null, legacy_work_order_no: null });
        return out;
      }));
    }
    if (p === "/rest/v1/app_users") {
      const inIds = url.searchParams.get("id");
      if (inIds && inIds.startsWith("in.(")) return json(200, inIds.slice(4, -1).split(",").filter((k) => creators[k]).map((k) => ({ id: k, name: creators[k] })));
      if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: users[0].name }]);
      return json(200, users.map(({ auth, ...u }) => u));
    }
    if (p === "/rest/v1/rpc/batch_report_progress") {
      const body = JSON.parse(req.postData() || "{}");
      return json(200, (body.p_process_ids || []).map((pid) => ({ process_id: pid, legacy_output: null, pending_output: 0, last_report_at: null, ...progress[pid] })));
    }
    if (p === "/rest/v1/rpc/work_order_upsert") {
      const body = JSON.parse(req.postData() || "{}");
      upserts.push(body.p_payload);
      return json(200, { work_order_id: id(999), action: "updated", process_id: id(998), machine_code: body.p_payload?.machine_code || null });
    }
    if (p.startsWith("/rest/v1/rpc/")) return json(200, null);
    if (p.startsWith("/rest/v1/")) return json(200, []);
    return json(200, {});
  }
  return { handle, writes, upserts, startRecording: () => { recording = true; } };
}

async function newPage(browser, device, { role = "planner" } = {}) {
  const backend = makeBackend();
  const context = await browser.newContext({ ...device, serviceWorkers: "block" });
  await context.addInitScript(([token]) => {
    try {
      sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "planner@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
      localStorage.removeItem("machtile.wo.recent.v1");
    } catch {}
  }, [jwtFor(role)]);
  await context.route("**/*", async (route) => {
    const u = route.request().url();
    if (!u.startsWith(base)) seen.push(u);
    if (u.startsWith(FAKE)) return backend.handle(route);
    if (u.startsWith(base)) {
      if (new URL(u).pathname.endsWith("/config.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: testConfig });
      return route.continue();
    }
    blocked.push(u);
    return route.abort();
  });
  const page = await context.newPage();
  const dialogs = [];
  let dialogAnswer = true;
  page.on("dialog", async (d) => { dialogs.push({ type: d.type(), message: d.message() }); if (dialogAnswer) await d.accept(); else await d.dismiss(); });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, errors, backend, dialogs, setDialogAnswer: (v) => { dialogAnswer = v; } };
}

async function openWorkOrders(page, backend) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
  await page.waitForTimeout(300);
  backend.startRecording();
  await page.evaluate(() => openAdminModule("workOrders"));
  await page.waitForFunction(() => {
    const list = document.getElementById("machtileWoList");
    return list && !list.textContent.includes("載入工單中");
  }, null, { timeout: 10000 });
  await page.waitForTimeout(200);
}

const realErrors = (errors) => errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));
const tag = process.env.WO_SHOT_TAG ? `${process.env.WO_SHOT_TAG}-` : "";
const shot = (name) => path.join(outDir, `${tag}${name}.png`);
const rowNos = (page) => page.$$eval("#machtileWoList [data-wo-row]", (els) => els.map((el) => el.dataset.woRow));
const visibleRowNos = (page) => page.$$eval("#machtileWoList [data-wo-row]", (els) => els.filter((el) => el.offsetParent !== null).map((el) => el.dataset.woRow));
const rowLoc = (page, no) => page.locator(`#machtileWoList [data-wo-row="${no}"]`);

async function sheetShots(page, name) {
  // 整個管理視窗＋把清單內容展開截一張長圖（內容區本來會捲動）
  await page.screenshot({ path: shot(`${name}-viewport`) });
  const content = page.locator("#adminModuleContent");
  await content.evaluate((el) => { el.dataset.prevStyle = el.getAttribute("style") || ""; el.style.overflow = "visible"; el.style.maxHeight = "none"; });
  await page.locator(".admin-module-panel").evaluate((el) => { el.style.maxHeight = "none"; el.style.overflow = "visible"; });
  await page.locator(".admin-module-panel").screenshot({ path: shot(`${name}-full`) }).catch(() => {});
  await page.locator(".admin-module-panel").evaluate((el) => { el.style.maxHeight = ""; el.style.overflow = ""; });
  await content.evaluate((el) => el.setAttribute("style", el.dataset.prevStyle));
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const tabletDevice = { ...devices["iPad (gen 7)"], viewport: { width: 810, height: 1080 } };
const phone360 = { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } };

for (const [label, device, name] of [["平板（810×1080）", tabletDevice, "tablet"], ["手機（360px）", phone360, "phone360"]]) {
  console.log(`== ${label} ==`);
  const { context, page, errors, backend, dialogs, setDialogAnswer } = await newPage(browser, device);
  await openWorkOrders(page, backend);
  await sheetShots(page, name);
  if (shotsOnly) { await context.close(); continue; }

  // ---- 排序 ----
  ok(JSON.stringify(await rowNos(page)) === JSON.stringify(expectedOrder), `${label}：依交期排序（逾期最上、已結案最下）`, (await rowNos(page)).join(","));

  // ---- 來源 ----
  const srcOf = async (no) => rowLoc(page, no).locator("[data-wo-source]").getAttribute("data-wo-source");
  ok(await srcOf("XX01202609290006") === "legacy" && (await rowLoc(page, "XX01202609290006").locator(".wo-source").innerText()).includes("舊 MES 派工"), `${label}：created_by null →「舊 MES 派工」`);
  const manualText = await rowLoc(page, "WO-GATE-P3-001").locator(".wo-source").innerText();
  ok(await srcOf("WO-GATE-P3-001") === "app" && manualText.includes("App 手動") && manualText.includes("測試員"), `${label}：有 created_by →「App 手動」＋建立者`, manualText);
  const badgeBg = async (no) => rowLoc(page, no).locator(".wo-source-badge").evaluate((el) => getComputedStyle(el).backgroundColor);
  ok(await badgeBg("XX01202609290006") === "rgb(238, 242, 246)", `${label}：舊 MES 派工＝灰底`, await badgeBg("XX01202609290006"));
  ok(await badgeBg("WO-GATE-P3-001") === "rgb(230, 241, 251)", `${label}：App 手動＝藍底`, await badgeBg("WO-GATE-P3-001"));

  // ---- 品名＋品號小字、數量＋進度條 ----
  const part = await rowLoc(page, "XX01202609290006").locator(".wo-part").innerText();
  ok(part.includes("HCG-06本體") && part.includes("HCG-06-01"), `${label}：品名＋品號小字`);
  const qty1 = await rowLoc(page, "XX01202609100001").locator(".wo-qty-text").innerText();
  ok(qty1.replace(/\s/g, "") === "320/500", `${label}：已報＝舊 MES 300＋待回寫 20（cardProgress 口徑，不加 App 12）`, qty1);
  const bar1 = await rowLoc(page, "XX01202609100001").locator(".wo-progress").getAttribute("aria-valuenow");
  ok(bar1 === "64", `${label}：進度條 64%`, bar1);
  const qty2 = await rowLoc(page, "XX01202609290006").locator(".wo-qty-text").innerText();
  ok(qty2.replace(/\s/g, "") === "30/120" && (await rowLoc(page, "XX01202609290006").locator(".wo-qty").innerText()).includes("舊 MES 尚無資料"), `${label}：沒有舊 MES 結算 → App 累計＋標「舊 MES 尚無資料」`, qty2);

  // ---- 交期顏色 ----
  const dueColor = async (no) => rowLoc(page, no).locator(".wo-due span").first().evaluate((el) => getComputedStyle(el).color);
  ok(await dueColor("XX01202609100001") === "rgb(200, 30, 30)" && (await rowLoc(page, "XX01202609100001").locator(".wo-due").innerText()).includes("逾期 5 天"), `${label}：逾期＝紅＋「逾期 5 天」`, await dueColor("XX01202609100001"));
  ok(await dueColor("XX01202609290006") === "rgb(180, 83, 9)" && (await rowLoc(page, "XX01202609290006").locator(".wo-due").innerText()).includes("剩 2 天"), `${label}：3 天內＝橘＋「剩 2 天」`, await dueColor("XX01202609290006"));
  ok(!["rgb(200, 30, 30)", "rgb(180, 83, 9)"].includes(await dueColor("XX01202609200002")), `${label}：20 天後不上色`);
  ok(!["rgb(200, 30, 30)", "rgb(180, 83, 9)"].includes(await dueColor("XX01202605010001")) && (await rowLoc(page, "XX01202605010001").locator(".wo-due").innerText()).includes("已結案"), `${label}：已完工的過期單不標紅（已結案）`);

  // ---- 機台 ----
  ok((await rowLoc(page, "XX01202609100001").locator(".wo-machine").innerText()).includes("A01 小瀧澤"), `${label}：機台顯示代號＋現場別名`);
  ok((await rowLoc(page, "XX01202609200002").locator(".wo-machine").innerText()).includes("未指派"), `${label}：沒有工序＝未指派`);
  ok((await rowLoc(page, "XX01202609250003").locator(".wo-machine").innerText()).includes("已離站"), `${label}：工序已離站要標出來`);

  // ---- 搜尋 ----
  const search = page.locator("#machtileWoSearch");
  await search.fill("0929");
  ok(JSON.stringify(await visibleRowNos(page)) === JSON.stringify(["XX01202609290006"]), `${label}：搜尋單號片段`);
  await search.fill("止油閥");
  ok(JSON.stringify(await visibleRowNos(page)) === JSON.stringify(["XX01202609100001"]), `${label}：搜尋品名`);
  await search.fill("hcg-06-0");
  ok(JSON.stringify(await visibleRowNos(page)) === JSON.stringify(["XX01202609290006", "XX01202609250003"]), `${label}：搜尋品號（不分大小寫）`);
  await search.fill("沒有這張");
  ok((await page.locator("#machtileWoList").innerText()).includes("沒有符合的工單"), `${label}：搜不到要講`);
  await search.fill("");

  // ---- 篩選 ----
  const clickFilter = async (key) => page.locator(`[data-wo-filter="${key}"]`).click();
  await clickFilter("overdue");
  ok(JSON.stringify(await visibleRowNos(page)) === JSON.stringify(["XX01202609100001"]), `${label}：篩選「逾期」`);
  await clickFilter("legacy");
  ok(JSON.stringify(await visibleRowNos(page)) === JSON.stringify(expectedOrder.filter((n) => n !== "WO-GATE-P3-001")), `${label}：篩選「舊 MES 派工」`);
  await clickFilter("app");
  ok(JSON.stringify(await visibleRowNos(page)) === JSON.stringify(["WO-GATE-P3-001"]), `${label}：篩選「App 手動」`);
  ok((await page.locator('[data-wo-filter="app"]').getAttribute("aria-pressed")) === "true", `${label}：目前篩選有標示`);
  const countText = (await page.locator(".wo-filter-chips").innerText()).replace(/\s+/g, "");
  ok(countText.includes("全部6") && countText.includes("逾期1") && countText.includes("舊MES派工5") && countText.includes("App手動1"), `${label}：篩選鈕顯示張數`, countText);
  await clickFilter("all");
  ok((await visibleRowNos(page)).length === 6, `${label}：篩選「全部」回到 6 張`);

  // ---- 版面：360px 不橫向捲動、窄螢幕是卡片 ----
  const geo = await page.evaluate(() => {
    const panel = document.querySelector(".admin-module-panel").getBoundingClientRect();
    const content = document.getElementById("adminModuleContent");
    const rows = [...document.querySelectorAll("#machtileWoList [data-wo-row]")];
    const head = document.querySelector("#machtileWoList .wo-row-head");
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      contentOverflow: content.scrollWidth - content.clientWidth,
      rowsInside: rows.every((r) => { const b = r.getBoundingClientRect(); return b.left >= panel.left - 0.5 && b.right <= panel.right + 0.5; }),
      cellsInside: rows.every((r) => { const rb = r.getBoundingClientRect(); return [...r.querySelectorAll(".wo-cell")].every((c) => { const b = c.getBoundingClientRect(); return b.right <= rb.right + 0.5 && c.scrollWidth <= c.clientWidth + 1; }); }),
      headVisible: head ? head.offsetParent !== null && getComputedStyle(head).display !== "none" : false,
      gridCols: rows[0] ? getComputedStyle(rows[0]).gridTemplateColumns.split(" ").length : 0,
      warnBottom: document.querySelector(".wo-sync-warning")?.getBoundingClientRect().bottom ?? null,
      formTop: document.getElementById("machtileWoForm")?.getBoundingClientRect().top ?? null,
    };
  });
  ok(geo.pageOverflow <= 0 && geo.contentOverflow <= 1, `${label}：沒有橫向捲動（頁 ${geo.pageOverflow}px／內容 ${geo.contentOverflow}px）`);
  ok(geo.rowsInside && geo.cellsInside, `${label}：每列／每格都在視窗內、沒有被截斷`);
  if (name === "phone360") ok(!geo.headVisible && geo.gridCols === 2, `${label}：窄螢幕改卡片（沒有表頭、每張卡 2 欄）`, JSON.stringify(geo));
  else ok(geo.headVisible && geo.gridCols === 6, `${label}：平板是 6 欄清單＋表頭`, JSON.stringify(geo));

  // ---- 提示 ----
  const warn = page.locator(".wo-sync-warning");
  ok(await warn.isVisible() && (await warn.innerText()).includes("工單由舊 MES 派工自動同步；這裡手動建立或改派，下一輪同步可能被舊 MES 覆蓋。一般情況請在舊 MES 派工。"), `${label}：表單上方有黃色提示（原文）`);
  ok(geo.warnBottom !== null && geo.formTop !== null && geo.warnBottom <= geo.formTop, `${label}：提示在表單上方`);
  ok(await warn.evaluate((el) => getComputedStyle(el).backgroundColor) === "rgb(255, 243, 214)", `${label}：提示是黃底`);
  ok(await page.locator("#machtileWoForm").isVisible() && await page.locator("#machtileWoForm button[type=submit]").isVisible(), `${label}：建單表單保留`);

  // ---- 開模組到現在：只有讀取 ----
  const nonReadSoFar = backend.writes.filter((w) => w.path !== "/rest/v1/rpc/batch_report_progress");
  ok(nonReadSoFar.length === 0, `${label}：瀏覽／搜尋／篩選沒有任何寫入`, JSON.stringify(nonReadSoFar));

  // ---- 改派確認：舊 MES 派工單 ----
  await rowLoc(page, "XX01202609290006").locator("[data-wo-edit]").click();
  await page.waitForFunction(() => document.querySelectorAll('#machtileWoStep option').length === 3);
  ok(await page.locator("#machtileWoNo").inputValue() === "XX01202609290006" && await page.locator("#machtileWoStep").inputValue() === "" && await page.locator("#machtileWoMachine").isDisabled(), `${label}：點單號先選工序，不自動挑第一台`);
  ok(backend.upserts.length === 0, `${label}：點單號只帶入、不送出`);
  await page.locator('#machtileWoStep').selectOption(id(302));
  ok(await page.locator('#machtileWoMachine').isDisabled(), `${label}：已報工 N1 不可改派`);
  await page.locator('#machtileWoStep').selectOption(id(307));
  if (name === "phone360") await page.locator("#machtileWoFormSection").screenshot({ path: shot(`${name}-form`) });
  await page.locator("#machtileWoMachine").selectOption("A05");
  setDialogAnswer(false);
  await page.locator("#machtileWoForm button[type=submit]").click();
  await page.waitForTimeout(400);
  const d1 = dialogs.at(-1);
  ok(dialogs.length === 1 && d1.type === "confirm" && d1.message.includes("舊 MES 派工") && d1.message.includes("B04") && d1.message.includes("A05") && d1.message.includes("覆蓋"), `${label}：舊 MES 單改派 → 跳確認，說明會被同步覆蓋`, JSON.stringify(dialogs));
  ok(backend.upserts.length === 0, `${label}：按取消＝不送出`);
  setDialogAnswer(true);
  await page.locator("#machtileWoForm button[type=submit]").click();
  await page.waitForTimeout(500);
  ok(dialogs.length === 2 && backend.upserts.length === 1 && backend.upserts[0].machine_code === "A05" && backend.upserts[0].process_order === 2 && backend.upserts[0].process_id === id(307), `${label}：按確定＝只改選定 N2，一次送出（A05）`, JSON.stringify(backend.upserts));

  // ---- 舊 MES 單、機台不變 → 不跳 ----
  await rowLoc(page, "XX01202609100001").locator("[data-wo-edit]").click();
  await page.waitForFunction(() => document.querySelectorAll('#machtileWoStep option').length === 2);
  await page.locator('#machtileWoStep').selectOption(id(301));
  await page.locator("#machtileWoForm button[type=submit]").click();
  await page.waitForTimeout(500);
  ok(dialogs.length === 2 && backend.upserts.length === 2, `${label}：舊 MES 單機台沒改 → 不跳確認`, JSON.stringify(dialogs.slice(2)));

  // ---- App 手動單改派 → 不跳 ----
  await rowLoc(page, "WO-GATE-P3-001").locator("[data-wo-edit]").click();
  await page.waitForFunction(() => document.querySelectorAll('#machtileWoStep option').length === 3);
  await page.locator('#machtileWoStep').selectOption(id(308));
  await page.locator("#machtileWoMachine").selectOption("A04");
  await page.locator("#machtileWoForm button[type=submit]").click();
  await page.waitForTimeout(500);
  ok(dialogs.length === 2 && backend.upserts.length === 3 && backend.upserts[2].machine_code === "A04" && backend.upserts[2].process_order === 2, `${label}：App 手動單未報工 N2 改派 → 不跳確認`);

  // ---- 全程寫入只有建單送出 ----
  // 送出後卡片牆會重新載入（原本就有的行為），那幾支是唯讀快照 RPC（POST 但不寫入），列在這裡、其餘一律算寫入
  const readOnlyRpc = new Set(["/rest/v1/rpc/batch_report_progress", "/rest/v1/rpc/schedule_calendar_snapshot", "/rest/v1/rpc/attention_case_snapshot", "/rest/v1/rpc/hmc_runtime_snapshot", "/rest/v1/rpc/unified_event_list"]);
  const nonRead = backend.writes.filter((w) => !readOnlyRpc.has(w.path));
  ok(nonRead.length === 3 && nonRead.every((w) => w.path === "/rest/v1/rpc/work_order_upsert" && w.method === "POST"), `${label}：除了 3 次建單送出（rpc/work_order_upsert）之外沒有其他寫入`, JSON.stringify(nonRead.map((w) => w.method + " " + w.path)));
  ok(realErrors(errors).length === 0, `${label}：沒有 JS 錯誤`, realErrors(errors).join(" | "));
  await context.close();
}

// ---- 作業員看不到 ----
console.log("== 權限：作業員打不開工單管理 ==");
{
  const { context, page, backend } = await newPage(browser, tabletDevice, { role: "operator" });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
  await page.evaluate(() => openAdminModule("workOrders"));
  const txt = await page.locator("#adminModuleContent").innerText();
  ok(txt.includes("需要排程以上權限") && await page.locator("#machtileWoList").count() === 0, "作業員：只看到權限說明，沒有清單／表單");
  ok(await page.locator('[data-card-select-open]').count() === 0, '作業員：沒有機台佇列選取入口');
  await context.close();
}

await browser.close();
server.close();

const prodHits = [...blocked, ...seen].filter((u) => u.includes("muditjubqflrqofbkmav") || u.includes("machtile.com"));
ok(prodHits.length === 0, "沒有任何請求打到正式後端／正式網域", prodHits.join(" "));
console.log(`\n${pass} passed, ${fail} failed  (screenshots: ${outDir})`);
process.exit(fail ? 1 : 0);
