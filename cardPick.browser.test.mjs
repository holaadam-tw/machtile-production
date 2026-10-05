// Monitor 機台卡片「目前工單」挑最近有活動的那張＋「這台還掛 N 張」——瀏覽器端到端測試（Playwright，手機＋平板）。
// 不會碰任何真的後端：config.js 換成指向假專案網域的測試設定，所有 Supabase 請求由這支腳本攔截、用假資料回應；
// 其他對外請求一律擋掉並記錄（最後斷言一次都沒有打到正式專案）。
// 假資料＝2026-10-02 正式庫唯讀實查的 B04／B06 狀態（單號、品名、舊 MES 結算時間、工序更新時間照抄；id 換成假的）。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node cardPick.browser.test.mjs            （截圖寫到 ./.e2e-out/card-pick/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node cardPick.browser.test.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.CARD_PICK_E2E_OUT || path.join(root, ".e2e-out", "card-pick");
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

// ---------- fixtures（2026-10-02 正式庫實查）----------
const FAKE = "https://e2ecardpickzzzzzzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();

const users = [
  { id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) },
  { id: id(902), name: "李大華", legacy_user_id: "1021101" },
];
// n → 工序 id＝id(300+n)、工單 id＝id(100+n)
const card = (n, wo, part, machine, due, qty, extra = {}) => ({
  id: id(100 + n), tenant_id: T, work_order_no: wo, customer_name: "測試客戶", part_name: part, drawing_no: null,
  quantity: qty, due_date: due, priority: "normal", work_order_status: "not_started",
  current_process_id: id(300 + n), current_process_name: "加工製程", current_process_status: "pending",
  machine_name: machine, qty_completed: 0, qty_defect: 0, progress_percent: 0,
  last_report_at: null, open_risk_level: null, current_process_off_station: false, ...extra,
});
const cards = [
  card(1, "XX01202609020008", "MPW-01止油閥座", "A01", "2026-09-30", 5000),
  // B04：3 張在站。原本（交期最早）＝A37九孔座；今天真正在做的是 CPDF-16本體（舊 MES 10-02 16:14）
  card(41, "XX01202604140005", "A37九孔座", "B04", "2026-04-30", 165),
  card(42, "XX01202606030002", "P08九孔座-AR齒 (素材用AR16-R01-04-N)", "B04", "2026-06-30", 300),
  card(43, "XX01202609170004", "CPDF-16本體", "B04", "2026-10-31", 219),
  // B06：原本＝CPDG-10平蓋(小孔)；今天 16:16 開工的是 CRG-10本體（工序 10-02 16:19 更新）
  card(61, "XX01202609030001", "CPDG-10平蓋(小孔)", "B06", "2026-10-31", 343),
  card(62, "XX01202609030002", "CPDG-10平蓋(大孔)", "B06", "2026-10-31", 343),
  card(63, "XX01202609290017", "CRG-10本體(新型)(大孔)", "B06", "2026-11-30", 62),
];
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: "", status: "idle", display_order: i,
}));
const wop = {
  [id(301)]: { process_order: 3, actual_start_at: null, updated_at: "2026-09-11T00:34:40Z" },
  // A37 的 updated_at 故意設成今天（模擬派工橋同步碰過）：updated_at 不算活動，仍不能被選上
  [id(341)]: { process_order: 7, actual_start_at: null, updated_at: "2026-10-02T09:30:00Z" },
  [id(342)]: { process_order: 7, actual_start_at: null, updated_at: "2026-09-01T01:20:06Z" },
  [id(343)]: { process_order: 1, actual_start_at: null, updated_at: "2026-09-17T08:13:45Z" },
  [id(361)]: { process_order: 1, actual_start_at: null, updated_at: "2026-09-07T06:28:05Z" },
  [id(362)]: { process_order: 1, actual_start_at: null, updated_at: "2026-09-07T06:28:05Z" },
  [id(363)]: { process_order: 1, actual_start_at: null, updated_at: "2026-10-02T08:19:55Z" },
};
const legacy = [
  { work_order_no: "XX01202609020008", machine_code: "A01", process_order: 3, legacy_output: 3440, legacy_updated_at: "2026-09-30T08:36:40Z" },
  { work_order_no: "XX01202604140005", machine_code: "B04", process_order: 7, legacy_output: 55, legacy_updated_at: "2026-08-27T08:08:13Z" },
  { work_order_no: "XX01202606030002", machine_code: "B04", process_order: 7, legacy_output: 120, legacy_updated_at: "2026-09-07T08:12:33Z" },
  { work_order_no: "XX01202609170004", machine_code: "B04", process_order: 1, legacy_output: 96, legacy_updated_at: "2026-10-02T08:14:47Z" },
  { work_order_no: "XX01202609030001", machine_code: "B06", process_order: 1, legacy_output: 0, legacy_updated_at: "2026-09-07T08:13:37Z" },
  { work_order_no: "XX01202609030002", machine_code: "B06", process_order: 1, legacy_output: 0, legacy_updated_at: "2026-09-07T08:13:48Z" },
  { work_order_no: "XX01202609290017", machine_code: "B06", process_order: 1, legacy_output: 0, legacy_updated_at: "2026-10-02T08:16:24Z" },
];
const cardByPid = Object.fromEntries(cards.map((c) => [c.current_process_id, c]));
// batch_report_progress：同一張單同機台同步序的舊 MES 數字（照後端 join 規則）
function progressRow(pid) {
  const c = cardByPid[pid];
  const step = wop[pid]?.process_order;
  const lp = legacy.find((r) => r.work_order_no === c.work_order_no && r.machine_code === c.machine_name && r.process_order === step) || null;
  return {
    process_id: pid, work_order_no: c.work_order_no, machine_code: c.machine_name, process_order: step,
    legacy_input: lp ? lp.legacy_output : null, legacy_output: lp ? lp.legacy_output : null, legacy_fail: lp ? 0 : null,
    legacy_updated_at: lp ? lp.legacy_updated_at : null, legacy_snapshot_at: lp ? lp.legacy_updated_at : null, legacy_synced_at: lp ? lp.legacy_updated_at : null,
    pending_output: 0, pending_fail: 0, pending_count: 0, oldest_pending_at: null, last_report_at: null, actual_start_at: wop[pid]?.actual_start_at || null,
  };
}

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
// opts.noActivity：活動時間全部讀不到（work_order_processes／legacy_station_progress 500、進度 RPC 500）→ 退回原本規則
// opts.appReport：{ pid: ISO }＝這道工序 App 報工的最後時間
function makeBackend(opts = {}) {
  const b = { calls: [], inserted: new Map(), writes: [], reads: [] };
  b.handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const q = decodeURIComponent(url.search);
    const method = req.method();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "op@test.invalid" });
    if (p === "/rest/v1/rpc/machine_department_context") return json(200, { tenant_id: T, role: "planner", is_bridge: false, all_departments: true, department_codes: ["LATHE", "MILL"] });
    // 寫入紀錄：除了讀用的 RPC 以外，任何 POST／PATCH／DELETE 都記下來（切換卡片不可以有任何一筆）
    // 讀用的 RPC（快照／清單／進度）不算寫入
    const readRpc = /^\/rest\/v1\/rpc\/(machine_department_context|batch_report_progress|[a-z_]+_snapshot|[a-z_]+_list)$/.test(p);
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
      if (m && q.includes("actual_start_at")) {
        b.reads.push("wop");
        if (q.includes("updated_at")) b.reads.push("wop-asked-updated_at");
        if (opts.noActivity) return json(500, { message: "simulated outage" });
        return json(200, m[1].split(",").filter((pid) => wop[pid]).map((pid) => ({ id: pid, ...wop[pid] })));
      }
      return json(200, []);
    }
    if (p === "/rest/v1/legacy_station_progress") {
      b.reads.push("legacy");
      if (opts.noActivity) return json(500, { message: "simulated outage" });
      const m = q.match(/work_order_no=in\.\(([^)]*)\)/);
      const wanted = m ? m[1].split(",").map((s) => s.replace(/"/g, "")) : [];
      return json(200, legacy.filter((r) => wanted.includes(r.work_order_no)).map(({ legacy_output, ...r }) => r));
    }
    if (p === "/rest/v1/rpc/batch_report_progress") {
      b.reads.push("progress");
      if (opts.noActivity) return json(500, { message: "simulated outage" });
      const body = JSON.parse(req.postData() || "{}");
      return json(200, (body.p_process_ids || []).filter((pid) => cardByPid[pid]).map((pid) => {
        const row = progressRow(pid);
        if (opts.appReport && opts.appReport[pid]) row.last_report_at = opts.appReport[pid];
        return row;
      }));
    }
    if (p === "/rest/v1/rpc/field_report_upsert") {
      const body = JSON.parse(req.postData() || "{}");
      b.calls.push(body);
      if (b.inserted.has(body.p_report_uuid)) return json(200, { report_id: id(7000), inserted: false });
      b.inserted.set(body.p_report_uuid, body.p_payload);
      return json(200, { report_id: id(7000 + b.inserted.size), inserted: true });
    }
    if (p.startsWith("/rest/v1/rpc/")) return json(200, null);
    if (p.startsWith("/rest/v1/")) return json(200, []);
    return json(200, {});
  };
  return b;
}

const blocked = [];
async function newPage(browser, device, backend) {
  const context = await browser.newContext({ ...device, serviceWorkers: "block" });
  await context.addInitScript(([token]) => {
    try {
      sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
    } catch {}
  }, [jwt]);
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
}

const cardOf = (page, code) => page.locator("#workOrderGrid .machine-tile-card").filter({ has: page.locator("h2", { hasText: code }) }).first();
const shownOn = async (page, code) => (await cardOf(page, code).locator(".job-order-highlight").innerText()).trim();
const realErrors = (errors) => errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

// ================= 手機：B04／B06 挑最近活動、還掛 N 張、切換、報工預設 =================
console.log("== 手機（Pixel 7）：正式庫 10-02 狀態 ==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"], be);
  await waitLoaded(page);

  console.log("-- 挑最近活動的那張 --");
  ok((await shownOn(page, "B04")).startsWith("XX01202609170004 · CPDF-16本體"), "B04 卡片＝CPDF-16本體（舊 MES 10-02 16:14），不是 4 月的 A37九孔座", await shownOn(page, "B04"));
  ok((await shownOn(page, "B06")).startsWith("XX01202609290017 · CRG-10本體"), "B06 卡片＝CRG-10本體（舊 MES 10-02 16:16），不是 CPDG-10平蓋(小孔)", await shownOn(page, "B06"));
  ok((await shownOn(page, "A01")).startsWith("XX01202609020008"), "A01 只有一張 → 照舊");
  ok(be.reads.includes("wop") && be.reads.includes("legacy"), "有讀開工時間與舊 MES 結算時間（只讀）");
  ok(!be.reads.includes("wop-asked-updated_at"), "不再讀 work_order_processes.updated_at");
  ok(be.reads.filter((r) => r === "progress").length === 1, `進度 RPC 只查一次（卡片完成數與挑單共用，${be.reads.filter((r) => r === "progress").length} 次）`);
  ok((await cardOf(page, "B04").locator(".machine-metrics").innerText()).includes("96/219"), "B04 完成進度跟著那張單（舊 MES 96／219）", await cardOf(page, "B04").locator(".machine-metrics").innerText());

  console.log("-- 這台還掛 N 張 --");
  const sumB04 = cardOf(page, "B04").locator("[data-card-orders-summary]");
  ok((await sumB04.innerText()).trim() === "這台還掛 2 張", "B04：這台還掛 2 張", await sumB04.innerText());
  ok((await cardOf(page, "B06").locator("[data-card-orders-summary]").innerText()).trim() === "這台還掛 2 張", "B06：這台還掛 2 張");
  ok(await cardOf(page, "A01").locator("[data-card-orders]").count() === 0, "A01 只有一張 → 不顯示「還掛」");
  ok(await cardOf(page, "A02").locator("[data-card-orders]").count() === 0, "A02 沒有單 → 不顯示");
  await sumB04.click();
  const items = cardOf(page, "B04").locator(".card-order-item");
  ok(await items.count() === 3, "點開：B04 全部 3 張在站單", String(await items.count()));
  const listText = await cardOf(page, "B04").locator(".card-order-list").innerText();
  // 2026-10-02 清單改版：品名當標題 → 單號（灰色小字）→ 進度「96/219（44%）」→ 最後活動相對時間＋來源小色塊；完整時間放在 title
  ok(/CPDF-16本體[\s\S]*目前顯示[\s\S]*XX01202609170004[\s\S]*96\/219（44%）[\s\S]*最後活動[\s\S]*舊 MES/.test(listText), "第一列：品名、目前顯示、單號、進度（百分比）、最後活動、來源", listText);
  ok(!listText.includes("顯示中") && !listText.includes("改顯示這張"), "舊字樣「顯示中」「改顯示這張」不再出現", listText);
  const rowInfo = await items.evaluateAll((els) => els.map((el) => ({
    key: el.dataset.cardOrderKey,
    part: el.querySelector(".card-order-part")?.textContent.trim(),
    no: el.querySelector(".card-order-no")?.textContent.trim(),
    qty: el.querySelector(".card-order-qty")?.textContent.trim(),
    title: el.querySelector("[data-card-order-activity]")?.getAttribute("title") || "",
    when: el.querySelector(".card-order-when")?.textContent.trim() || "",
    src: el.querySelector("[data-card-order-src]")?.dataset.cardOrderSrc || "",
    srcText: el.querySelector("[data-card-order-src]")?.textContent.trim() || "",
    badge: el.querySelector(".card-order-shown")?.textContent.trim() || "",
    pick: el.querySelector(".card-order-pick")?.textContent.trim() || "",
  })));
  ok(JSON.stringify(rowInfo.map((r) => [r.part, r.no, r.qty])) === JSON.stringify([["CPDF-16本體", "XX01202609170004", "96/219（44%）"], ["P08九孔座-AR齒 (素材用AR16-R01-04-N)", "XX01202606030002", "120/300（40%）"], ["A37九孔座", "XX01202604140005", "55/165（33%）"]]), "三張依最近活動排序；品名、單號、進度（百分比）各自正確", JSON.stringify(rowInfo));
  ok(rowInfo[0].title === "最後活動 10/02 16:14（舊 MES 報工）" && rowInfo[1].title === "最後活動 09/07 16:12（舊 MES 報工）" && rowInfo[2].title === "最後活動 08/27 16:08（舊 MES 報工）", "完整最後活動時間（台灣時間）放在 title", JSON.stringify(rowInfo.map((r) => r.title)));
  const expectWhen = await page.evaluate(() => ["2026-10-02T08:14:47Z", "2026-09-07T08:12:33Z", "2026-08-27T08:08:13Z"].map((t) => `最後活動 ${machtileCardActiveCore.relativeActivityText(t)}`));
  ok(JSON.stringify(rowInfo.map((r) => r.when)) === JSON.stringify(expectWhen), "最後活動改成相對時間（例：3 小時前／昨天 16:57）", JSON.stringify(rowInfo.map((r) => r.when)));
  ok(rowInfo.every((r) => r.src === "legacy" && r.srcText === "舊 MES"), "來源小色塊：舊 MES", JSON.stringify(rowInfo.map((r) => r.srcText)));
  ok(rowInfo[0].badge === "目前顯示" && rowInfo[0].pick === "" && rowInfo.slice(1).every((r) => r.badge === "" && r.pick === "切換顯示"), "目前顯示那列只有「目前顯示」小標、沒有切換按鈕；其他列「切換顯示」", JSON.stringify(rowInfo.map((r) => [r.badge, r.pick])));
  const look = await cardOf(page, "B04").evaluate((card) => {
    const cs = (el) => getComputedStyle(el);
    const shown = card.querySelector(".card-order-item.is-shown");
    const other = card.querySelector(".card-order-item:not(.is-shown)");
    const badge = shown.querySelector(".card-order-shown");
    const pick = other.querySelector(".card-order-pick");
    const src = other.querySelector(".card-order-src");
    return {
      shownBg: cs(shown).backgroundColor, shownLeft: cs(shown).borderLeftWidth, shownLeftColor: cs(shown).borderLeftColor,
      otherBg: cs(other).backgroundColor, otherLeft: cs(other).borderLeftWidth,
      badgeBg: cs(badge).backgroundColor, badgeFg: cs(badge).color,
      partSize: parseFloat(cs(other.querySelector(".card-order-part")).fontSize), partWeight: Number(cs(other.querySelector(".card-order-part")).fontWeight),
      noSize: parseFloat(cs(other.querySelector(".card-order-no")).fontSize), noColor: cs(other.querySelector(".card-order-no")).color,
      pickBorder: cs(pick).borderTopWidth, pickBg: cs(pick).backgroundColor, pickH: pick.getBoundingClientRect().height,
      srcBg: cs(src).backgroundColor,
      bar: !!other.querySelector(".card-order-progress .card-order-bar .progress-fill"),
      note: card.querySelector(".card-order-note").textContent.trim(),
    };
  });
  ok(look.shownBg === "rgb(234, 243, 255)" && look.shownLeft === "4px" && look.shownLeftColor === "rgb(0, 103, 255)", "目前顯示那列：淡藍底＋左側 4px 藍條", JSON.stringify(look));
  ok(look.otherBg === "rgb(255, 255, 255)" && look.otherLeft === "1px", "其他列：白底、一般框線");
  ok(look.badgeBg === "rgb(0, 103, 255)" && look.badgeFg === "rgb(255, 255, 255)", "「目前顯示」藍底白字小標", JSON.stringify(look));
  ok(look.partSize > look.noSize && look.partWeight >= 700 && look.noColor === "rgb(102, 112, 133)", "品名放大加粗；單號小一號、灰色", JSON.stringify(look));
  ok(look.pickBorder === "1px" && look.pickBg === "rgb(255, 255, 255)" && look.pickH >= 32 && look.pickH <= 40, "「切換顯示」細框次要按鈕（不再是大藍框）", JSON.stringify(look));
  ok(look.srcBg === "rgb(238, 242, 246)", "舊 MES 來源色塊＝灰", look.srcBg);
  ok(look.bar, "每列有細進度條");
  ok(look.note === "依最近活動自動挑選；切換只影響這個畫面", "說明縮成一行小字", look.note);
  ok(!(await page.locator("#detailSheet").evaluate((e) => e.classList.contains("is-open"))), "點「還掛」不會打開工單明細");
  await cardOf(page, "B04").scrollIntoViewIfNeeded();
  await cardOf(page, "B04").screenshot({ path: path.join(outDir, "01-phone-b04-list.png") });

  console.log("-- 報工預設＝卡片那張 --");
  await cardOf(page, "B04").locator(".machine-report-button").click();
  await page.locator("#reportSheet.is-open").waitFor();
  ok((await page.locator("#reportWorkNo").innerText()).trim() === "XX01202609170004", "B04 卡片「回報」→ 報工單號＝CPDF-16本體", await page.locator("#reportWorkNo").innerText());
  ok(await page.evaluate(() => selectedOrder?.processId) === id(343), "報工的工序＝CPDF-16 那道");
  await page.evaluate(() => closeReport());
  await page.evaluate(() => openReport("", { machine: "B04", reportType: "dailyStart" }));
  ok((await page.locator("#reportWorkNo").innerText()).trim() === "XX01202609170004", "只帶機台（機台 QR 路徑）→ 也是卡片那張（原本會挑交期最早的 A37）", await page.locator("#reportWorkNo").innerText());
  await page.evaluate(() => closeReport());

  console.log("-- 切換卡片顯示（只改畫面）--");
  const writesBefore = be.writes.length;
  await cardOf(page, "B04").locator('[data-card-pick-key="' + id(341) + '"]').click();
  ok((await shownOn(page, "B04")).startsWith("XX01202604140005 · A37九孔座"), "切到 A37 → 卡片顯示 A37九孔座", await shownOn(page, "B04"));
  ok((await cardOf(page, "B04").locator("[data-card-orders-summary]").innerText()).replace(/\s+/g, "") === "這台還掛2張手動切換中", "標示手動切換中（同一行）", await cardOf(page, "B04").locator("[data-card-orders-summary]").innerText());
  ok((await cardOf(page, "B04").locator(".machine-metrics").innerText()).includes("55/165"), "進度跟著換成 55／165");
  ok(be.writes.length === writesBefore, "切換沒有任何寫入請求", be.writes.slice(writesBefore).join(" | "));
  await cardOf(page, "B04").locator(".machine-report-button").click();
  await page.locator("#reportSheet.is-open").waitFor();
  ok((await page.locator("#reportWorkNo").innerText()).trim() === "XX01202604140005", "切換後「回報」→ 報到畫面上顯示的 A37（看到哪張報哪張）");
  await page.evaluate(() => closeReport());
  // 2026-10-02 起展開／收起會記住：切換後重畫仍維持展開，不用再點一次
  ok(await cardOf(page, "B04").locator("[data-card-orders]").evaluate((el) => el.open), "切換後清單仍展開");
  await cardOf(page, "B04").screenshot({ path: path.join(outDir, "02-phone-b04-switched.png") });
  const switched = await cardOf(page, "B04").evaluate((card) => ({
    shown: card.querySelector(".card-order-item.is-shown .card-order-part")?.textContent.trim(),
    badges: card.querySelectorAll(".card-order-shown").length,
    picks: [...card.querySelectorAll(".card-order-pick")].map((b) => b.textContent.trim()),
    auto: card.querySelector(".card-order-note .card-order-auto")?.textContent.trim() || "",
  }));
  ok(switched.shown === "A37九孔座" && switched.badges === 1 && switched.picks.length === 2 && switched.picks.every((t) => t === "切換顯示"), "切換後「目前顯示」移到 A37，其他兩列「切換顯示」", JSON.stringify(switched));
  ok(switched.auto === "恢復自動", "手動切換中 → 說明那行有「恢復自動」");
  await cardOf(page, "B04").locator(".card-order-auto").click();
  ok((await shownOn(page, "B04")).startsWith("XX01202609170004"), "恢復自動 → 回到 CPDF-16本體");
  ok(await cardOf(page, "B04").locator(".card-order-auto").count() === 0, "恢復自動後按鈕消失");
  ok(be.writes.length === writesBefore, "恢復自動也沒有寫入");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `手機沒有橫向捲動（${overflow}px）`);
  await page.screenshot({ path: path.join(outDir, "03-phone-monitor.png"), fullPage: true });

  console.log("-- 批次報工預設＝卡片那張，送出報到對的單 --");
  await page.locator('.mobile-tab[data-view="batchLathe"]').click();
  await page.locator('[data-batch-root="lathe"] .batch-switch-btn[data-view="batchMill"]').click();
  const mill = page.locator('[data-batch-root="mill"]');
  await mill.locator('[data-batch-row="B04"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-batch-root="mill"] [data-batch-refresh]')?.disabled);
  ok(await mill.locator('[data-batch-order="B04"] option').count() === 3, "B04 下拉選單本來就能選同機台的 3 張單");
  ok(await mill.locator('[data-batch-order="B04"]').inputValue() === id(343), "B04 預設＝CPDF-16（跟卡片一致）", await mill.locator('[data-batch-order="B04"]').inputValue());
  ok(await mill.locator('[data-batch-order="B06"]').inputValue() === id(363), "B06 預設＝CRG-10本體（跟卡片一致）", await mill.locator('[data-batch-order="B06"]').inputValue());
  await mill.locator('[data-batch-mode="dailyStart"]').click();
  for (const code of ["B03", "B05", "B06"]) {
    const box = mill.locator(`[data-batch-select="${code}"]`);
    if (await box.count() && await box.isEnabled() && await box.isChecked()) await box.uncheck();
  }
  ok(await mill.locator("[data-batch-first-article]").count() === 0, "今日開工已不要求首件檢查（首件在首次開工）");
  await page.screenshot({ path: path.join(outDir, "04-phone-mill-default.png"), fullPage: true });
  await mill.locator("[data-batch-submit]").click();
  for (let i = 0; i < 80 && be.calls.length === 0; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  ok(be.calls.length === 1, `只送 B04 一台（${be.calls.length}）`);
  ok(be.calls[0]?.p_payload?.process_id === id(343) && be.calls[0]?.p_payload?.work_order_id === id(143), "批次今日開工報在 CPDF-16 那道（不是 A37）", JSON.stringify(be.calls[0]?.p_payload || {}).slice(0, 200));
  ok(realErrors(errors).length === 0, "頁面沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= 批次：填到一半卡片換張，送出仍是填的那張 =================
console.log("== 批次：開始填之後卡片切換 → 這一列不會偷偷換單 ==");
{
  const be = makeBackend({ appReport: { [id(343)]: new Date(now - 30 * 60000).toISOString() } });
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"], be);
  await waitLoaded(page);
  ok((await shownOn(page, "B04")).startsWith("XX01202609170004"), "App 30 分鐘前報過 CPDF-16 → B04 卡片＝CPDF-16");
  await page.evaluate(() => switchView("batchMill"));
  const mill = page.locator('[data-batch-root="mill"]');
  await mill.locator('[data-batch-row="B04"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-batch-root="mill"] [data-batch-refresh]')?.disabled);
  // 中午報工：在 B04 這一列填良品＝開始填 → 這一列固定成畫面上的 CPDF-16
  ok(await mill.locator('[data-batch-order="B04"]').inputValue() === id(343), "B04 預設＝CPDF-16");
  await mill.locator('[data-batch-row="B04"] [data-batch-good]').fill("3");
  await page.evaluate((key) => machtileSetCardPick("B04", key), id(342));   // 別的畫面把卡片切到 P08
  ok((await page.evaluate(() => machtileCardOrderForMachine("B04")?.id)) === "XX01202606030002", "卡片已切到 P08");
  ok(await mill.locator('[data-batch-order="B04"]').inputValue() === id(343), "批次這一列仍是填的時候看到的 CPDF-16", await mill.locator('[data-batch-order="B04"]').inputValue());
  ok(await mill.locator('[data-batch-row="B04"] [data-batch-good]').inputValue() === "3", "填的數字還在");
  await mill.locator("[data-batch-submit]").click();
  for (let i = 0; i < 80 && be.calls.length === 0; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  ok(be.calls.length === 1 && be.calls[0]?.p_payload?.process_id === id(343) && be.calls[0]?.p_payload?.completed_qty === 3, "送出報在 CPDF-16、良品 3（不會報到錯的單）", JSON.stringify(be.calls.map((c) => [c.p_payload?.process_id, c.p_payload?.completed_qty])));
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= 沒有活動時間 → 退回原本規則 =================
console.log("== 活動時間全部讀不到 → 退回原本的規則（交期最早），頁面不壞 ==");
{
  const be = makeBackend({ noActivity: true });
  const { context, page, errors } = await newPage(browser, devices["Pixel 7"], be);
  await waitLoaded(page);
  ok((await shownOn(page, "B04")).startsWith("XX01202604140005 · A37九孔座"), "B04 退回原本規則 → A37九孔座（交期 04-30 最早）", await shownOn(page, "B04"));
  ok((await shownOn(page, "B06")).startsWith("XX01202609030001 · CPDG-10平蓋(小孔)"), "B06 退回原本規則 → CPDG-10平蓋(小孔)", await shownOn(page, "B06"));
  ok((await cardOf(page, "B04").locator("[data-card-orders-summary]").innerText()).trim() === "這台還掛 2 張", "仍顯示這台還掛 2 張");
  await cardOf(page, "B04").locator("[data-card-orders-summary]").click();
  ok((await cardOf(page, "B04").locator(".card-order-list").innerText()).includes("沒有活動紀錄"), "清單標示沒有活動紀錄");
  const idle = await cardOf(page, "B04").locator(".card-order-item").evaluateAll((els) => els.map((el) => ({ shown: el.classList.contains("is-shown"), opacity: Number(getComputedStyle(el).opacity), text: el.querySelector("[data-card-order-activity]")?.textContent.trim() })));
  ok(idle.every((r) => r.text === "沒有活動紀錄"), "每列都寫「沒有活動紀錄」", JSON.stringify(idle));
  ok(idle.filter((r) => !r.shown).every((r) => r.opacity < 1) && idle.filter((r) => r.shown).every((r) => r.opacity === 1), "沒有活動紀錄的其他列整列變淡（目前顯示那列不變淡）", JSON.stringify(idle));
  await page.evaluate(() => openReport("", { machine: "B04", reportType: "dailyStart" }));
  ok((await page.locator("#reportWorkNo").innerText()).trim() === "XX01202604140005", "報工預設也跟卡片一致（A37）");
  ok(realErrors(errors).length === 0, "頁面沒有 JS 錯誤", realErrors(errors).join(" | "));
  await page.evaluate(() => closeReport());
  await cardOf(page, "B04").screenshot({ path: path.join(outDir, "05-phone-b04-fallback.png") });
  await context.close();
}

// ================= 窄手機 360px：不橫向捲動、品名換行不截斷 =================
console.log("== 窄手機（360px）：清單不橫向捲動、長品名換行 ==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, { ...devices["Pixel 7"], viewport: { width: 360, height: 780 }, screen: { width: 360, height: 780 } }, be);
  await waitLoaded(page);
  await cardOf(page, "B04").locator("[data-card-orders-summary]").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `360px 沒有橫向捲動（${overflow}px）`);
  const fit = await cardOf(page, "B04").locator(".card-order-item").evaluateAll((els) => els.map((el) => {
    const li = el.getBoundingClientRect();
    const inside = [...el.querySelectorAll("*")].every((n) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.left >= li.left - 0.5 && r.right <= li.right + 0.5); });
    const part = el.querySelector(".card-order-part");
    const cs = getComputedStyle(part);
    return { text: part.textContent.trim(), inside, clipped: part.scrollWidth > part.clientWidth + 1 || cs.textOverflow === "ellipsis" || cs.whiteSpace === "nowrap", lines: Math.round(part.getBoundingClientRect().height / parseFloat(cs.lineHeight)) };
  }));
  ok(fit.every((r) => r.inside && !r.clipped), "每列內容都在框內、品名沒有被截斷", JSON.stringify(fit));
  const longName = fit.find((r) => r.text.startsWith("P08九孔座"));
  ok(longName && longName.lines >= 2, "長品名（P08九孔座-AR齒 (素材用AR16-R01-04-N)）換行顯示", JSON.stringify(longName));
  await cardOf(page, "B04").locator("[data-card-orders]").screenshot({ path: path.join(outDir, "08-phone360-b04-list.png") });
  ok(be.writes.length === 0, "沒有任何寫入請求", be.writes.join(" | "));
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ================= 平板 =================
console.log("== 平板（iPad 810×1080）==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, { ...devices["iPad (gen 7)"], defaultBrowserType: undefined }, be);
  await waitLoaded(page);
  await cardOf(page, "B06").locator("[data-card-orders-summary]").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `平板沒有橫向捲動（${overflow}px）`);
  const listText = await cardOf(page, "B06").locator(".card-order-list").innerText();
  ok(/^CRG-10本體\(新型\)\(大孔\)[\s\S]*目前顯示[\s\S]*XX01202609290017/.test(listText.trim()), "B06 清單第一列＝CRG-10本體（目前顯示）", listText);
  ok(await cardOf(page, "B06").locator(".card-order-item").first().locator("[data-card-order-activity]").getAttribute("title") === "最後活動 10/02 16:16（舊 MES 報工）", "B06 第一列最後活動 10/02 16:16（舊 MES）");
  const hit = await cardOf(page, "B06").locator(".card-order-pick").first().evaluate((btn) => { const r = btn.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return btn.contains(top) && r.height >= 32 && btn.textContent.trim() === "切換顯示"; });
  ok(hit, "平板：「切換顯示」按得到（沒有被蓋住、夠高）");
  await cardOf(page, "B06").scrollIntoViewIfNeeded();
  await cardOf(page, "B06").screenshot({ path: path.join(outDir, "06-tablet-b06-list.png") });
  await page.screenshot({ path: path.join(outDir, "07-tablet-monitor.png"), fullPage: false });
  ok(be.writes.length === 0, "整個過程沒有任何寫入請求", be.writes.join(" | "));
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
