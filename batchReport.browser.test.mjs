import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { assignedCardFixture } from "./assignedCardFixture.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.BATCH_E2E_OUT || path.join(root, ".e2e-out");
const mod = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright");
const { chromium, devices } = mod.default || mod;
let pass = 0;
const ok = (value, label) => { if (!value) throw new Error(label); pass += 1; console.log(`PASS ${label}`); };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname === "/" ? "/index.html" : new URL(req.url, "http://localhost").pathname;
  const file = path.join(root, decodeURIComponent(pathname));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { const body = await readFile(file); res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const FAKE = "https://fake-supabase.test";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const user = { id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) };
const cards = [{ id: id(101), tenant_id: T, work_order_no: "WO-A04", customer_name: "測試", part_name: "零件", drawing_no: "D-1", quantity: 500,
  due_date: "2026-10-20", priority: "normal", work_order_status: "in_progress", current_process_id: id(304), current_process_name: "車削",
  current_process_status: "running", machine_name: "A04", qty_completed: 0, qty_defect: 0, progress_percent: 0, current_process_off_station: false }];
const machines = ["A01", "A02", "A03", "A04", "A05", "B03", "B04", "B05", "B06"].map((code, index) => ({ id: id(200 + index), machine_code: code,
  machine_name: code, machine_type: code.startsWith("A") ? "車床" : "加工中心", location: "", status: "idle", display_order: index }));
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = `${b64({ alg: "HS256" })}.${b64({ sub: user.auth, email: "op@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const config = `window.MACHTILE_CONFIG={authMode:"strict",supabaseUrl:"${FAKE}",supabaseAnonKey:"test",tenantId:"${T}",useSupabase:true,useTenantHeaderAuth:true,enableOutboxSubmit:false,enableFileUpload:false,enableStationReport:false,reportTotalSemanticsEnabled:true,disableServiceWorker:true};`;
const upserts = [];
const blocked = [];
const stationRows = [
  { machine_code: "A04", command_type: "start", status: "applied", requested_at: new Date(now - 120 * 60000).toISOString(), applied_at: new Date(now - 120 * 60000).toISOString() },
  { machine_code: "A04", command_type: "stop", status: "applied", requested_at: new Date(now - 30 * 60000).toISOString(), applied_at: new Date(now - 30 * 60000).toISOString() },
];
async function fake(route) {
  const req = route.request(); const url = new URL(req.url()); const p = url.pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (p.startsWith("/auth/v1/user")) return json({ id: user.auth, email: "op@test.invalid" });
  if (p.endsWith("/rpc/machine_department_context")) return json({ tenant_id: T, role: "planner", is_bridge: false, all_departments: true, department_codes: ["LATHE", "MILL"] });
  if (p.endsWith("/v_work_order_cards")) return json(cards);
  if (p.endsWith("/work_order_processes") && (url.searchParams.get("select") || "").includes("work_orders!inner")) return json(assignedCardFixture(cards, machines));
  if (p.endsWith("/work_order_processes") && (url.searchParams.get("select") || "").includes("qty_completed")) return json([{ id: id(304), qty_completed: 0, qty_defect: 0 }]);
  if (p.endsWith("/v_machine_management_cards")) return json(machines);
  if (p.endsWith("/app_users")) return json(url.searchParams.has("auth_user_id") ? [{ id: user.id, name: user.name }] : [user]);
  if (p.endsWith("/rpc/batch_report_progress")) {
    const pendingOutput = upserts.reduce((sum, item) => sum + Number(item.p_payload?.completed_qty || 0), 0);
    return json([{ process_id: id(304), legacy_output: 140, legacy_fail: 0, pending_output: pendingOutput, pending_fail: 0,
      pending_count: upserts.length, last_report_at: new Date(now - 30 * 60000).toISOString(), actual_start_at: new Date(now - 180 * 60000).toISOString() }]);
  }
  if (p.endsWith("/production_reports") && req.method() === "GET" && (url.searchParams.get("select") || "").includes("report_payload")) return json([
    { process_id: id(304), report_type: "dailyStart", report_payload: { machine_qty: 150 }, created_at: new Date(now - 180 * 60000).toISOString() },
  ]);
  if (p.endsWith("/station_commands") && req.method() === "GET") return json((url.searchParams.get("status") || "").includes("pending") ? [] : stationRows);
  if (p.endsWith("/rpc/field_report_upsert")) { const body = JSON.parse(req.postData() || "{}"); upserts.push(body); return json({ inserted: true, report_id: id(700) }); }
  if (p.includes("/rest/v1/")) return json([]);
  return json({});
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "block" });
await context.addInitScript((token) => sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", mode: "session", createdAt: Date.now() })), jwt);
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith(FAKE)) return fake(route);
  if (url.startsWith(base)) return new URL(url).pathname.endsWith("/config.js") ? route.fulfill({ status: 200, contentType: "text/javascript", body: config }) : route.continue();
  blocked.push(url); return route.abort();
});
const page = await context.newPage();
page.on("pageerror", (error) => console.error("PAGEERROR", error.message));
page.on("dialog", (dialog) => dialog.accept());
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await page.locator('.mobile-tab[data-view="batchLathe"]').click();
const rootView = page.locator('[data-batch-root="lathe"]');
await rootView.locator('[data-batch-row="A04"] [data-batch-current]').waitFor();
await page.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled);
ok(await rootView.locator("[data-batch-mode]").count() === 0, "three time-slot tabs are removed");
ok((await rootView.locator(".batch-mode-tabs").innerText()).trim() === "報工", "single Report tab remains");
ok(await rootView.locator("[data-batch-ct-min],[data-batch-ct-sec]").count() === 0, "manual machine-time fields are removed");
ok(await rootView.locator('[data-batch-row="A04"] [data-batch-finished]').count() === 1, "each enabled machine has a finish checkbox");
ok((await rootView.locator('[data-batch-machine-state="A04"]').innerText()).includes("停工｜本班開工→停工累計 90 分"), "station_commands drives stopped status and read-only minutes");
ok(await rootView.locator('[data-batch-row="A01"] [data-batch-current]').isDisabled(), "machine without assignment cannot report");
await rootView.locator('[data-batch-row="A04"] [data-batch-current]').fill("170");
ok((await rootView.locator('[data-batch-counter-preview="A04"]').innerText()).includes("30"), "DOM preview uses card-reported total rather than today's start counter");
await rootView.locator('[data-batch-row="A04"] [data-batch-bad]').fill("2");
ok(await rootView.locator('[data-batch-row="A04"] [data-batch-reason-field]').isVisible(), "defect quantity reveals the centralized reason selector");
await rootView.locator('[data-batch-row="A04"] [data-batch-finished]').check();
await rootView.locator("[data-batch-submit]").click();
ok(upserts.length === 0, "defects without a selected reason are blocked before every write");
await rootView.locator('[data-batch-row="A04"] [data-batch-reason]').selectOption("其他");
await rootView.locator("[data-batch-submit]").click();
ok(upserts.length === 0, "Other without an explanation is blocked before every write");
await rootView.locator('[data-batch-row="A04"] [data-batch-reason]').selectOption({ index: 1 });
await page.evaluate(() => machtileBatchRefreshSubmitButton());
await rootView.locator("[data-batch-submit]").evaluate((button) => button.click());
await page.waitForFunction(() => document.querySelector('[data-batch-row="A04"] .batch-result')?.textContent.includes("已送出"));
ok(upserts.length === 1, "R=140, S=150, total=170 creates exactly one report");
const payload = upserts[0].p_payload;
ok(payload.report_type === "finish" && payload.completed_qty === 30 && payload.defect_qty === 2, "finish keeps its report type and sends the full delta once");
ok(payload.report_payload.backfill_qty === 10 && payload.report_payload.counter_today_qty === 20 && payload.report_payload.start_counter === 150 && payload.report_payload.reported_before === 140, "single payload carries shared backfill/today metadata");
ok((payload.remark || "").startsWith("含前一班未報 10 件；"), "single payload remark starts with the backfill annotation");
ok(payload.report_payload.fail_reason_code === "尺寸不良", "batch payload persists the selected defect reason");
ok(payload.report_payload.machine_qty === 170 && payload.report_payload.counter_baseline_qty === 140 && payload.cycle_time_seconds === null, "payload baseline uses the freshly reread card-reported total");
await page.waitForFunction(() => document.querySelector('[data-batch-row="A04"]')?.textContent.includes("170"));
ok((await rootView.locator('[data-batch-row="A04"]').innerText()).includes("170"), "card reported total becomes the entered machine total");
const browserCases = await page.evaluate(() => ({
  one: MachTileReportCounterCore.totalSemantics(170, 150, 150),
  lower: MachTileReportCounterCore.totalSemantics(130, 140, 150),
  missing: MachTileReportCounterCore.totalSemantics(170, null, 150),
}));
ok(browserCases.one.reports.length === 1 && browserCases.one.reports[0].good === 20, "R=S=150, total=170 produces one report of 20");
ok(browserCases.lower.code === "TOTAL_BELOW_REPORTED", "total below freshly reported quantity is blocked");
ok(browserCases.missing.code === "REPORTED_REQUIRED", "missing freshly reported quantity fails closed");
ok(blocked.length === 0, "browser did not contact production or another external host");
await page.screenshot({ path: path.join(outDir, "batch-report-align-a04.png"), fullPage: true });
await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
console.log(`PASS: ${pass} browser assertions; screenshot ${path.join(outDir, "batch-report-align-a04.png")}`);
