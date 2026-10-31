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
  current_process_status: "running", machine_name: "A04", qty_completed: 0, qty_defect: 0, progress_percent: 0, current_process_off_station: false },
{ id: id(102), tenant_id: T, work_order_no: "WO-A05", customer_name: "測試", part_name: "零件二", drawing_no: "D-2", quantity: 500,
  due_date: "2026-10-20", priority: "normal", work_order_status: "in_progress", current_process_id: id(305), current_process_name: "車削",
  current_process_status: "running", machine_name: "A05", qty_completed: 0, qty_defect: 0, progress_percent: 0, current_process_off_station: false }];
const machines = ["A01", "A02", "A03", "A04", "A05", "B03", "B04", "B05", "B06"].map((code, index) => ({ id: id(200 + index), machine_code: code,
  machine_name: code, machine_type: code.startsWith("A") ? "車床" : "加工中心", location: "", status: "idle", display_order: index }));
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = `${b64({ alg: "HS256" })}.${b64({ sub: user.auth, email: "op@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const config = `window.MACHTILE_CONFIG={authMode:"strict",supabaseUrl:"${FAKE}",supabaseAnonKey:"test",tenantId:"${T}",useSupabase:true,useTenantHeaderAuth:true,enableOutboxSubmit:false,enableFileUpload:false,enableStationReport:true,stationReportMachines:["A01","A02","A03","A04","A05"],reportTotalSemanticsEnabled:true,disableServiceWorker:true};`;
const upserts = [];
const stationSubmits = [];
let stationScenario = "clean";
let legacyOutputA04 = 140;
let staleFinalsLeft = 0;
let staleReceiptNeeded = false;
let staleClearsReceipt = true;
let staleDrift = 0;
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
  if (p.endsWith("/work_order_processes") && (url.searchParams.get("select") || "").includes("legacy_index_sn")) return json([{
    id: id(304), legacy_index_sn: 1, manufacture_ii_id: "MII-A04", simulation_id: "SIM-A04", work_orders: { part_no: "D-1" },
  }, { id: id(305), legacy_index_sn: 1, manufacture_ii_id: "MII-A05", simulation_id: "SIM-A05", work_orders: { part_no: "D-2" } }]);
  if (p.endsWith("/work_order_processes") && (url.searchParams.get("select") || "").includes("qty_completed")) return json([{ id: id(304), qty_completed: 0, qty_defect: 0 }, { id: id(305), qty_completed: 0, qty_defect: 0 }]);
  if (p.endsWith("/v_machine_management_cards")) return json(machines);
  if (p.endsWith("/app_users")) return json(url.searchParams.has("auth_user_id") ? [{ id: user.id, name: user.name }] : [user]);
  if (p.endsWith("/rpc/batch_report_progress")) {
    const pendingOutput = upserts.reduce((sum, item) => sum + Number(item.p_payload?.completed_qty || 0), 0);
    const pendingFail = upserts.reduce((sum, item) => sum + Number(item.p_payload?.defect_qty || 0), 0);
    return json([{ process_id: id(304), legacy_output: legacyOutputA04, legacy_fail: 0, pending_output: pendingOutput, pending_fail: pendingFail,
      pending_count: upserts.length, last_report_at: new Date(now - 30 * 60000).toISOString(), actual_start_at: new Date(now - 180 * 60000).toISOString() },
    { process_id: id(305), legacy_output: 50, legacy_fail: 0, pending_output: 0, pending_fail: 0,
      pending_count: 0, last_report_at: new Date(now - 30 * 60000).toISOString(), actual_start_at: new Date(now - 180 * 60000).toISOString() }]);
  }
  if (p.endsWith("/production_reports") && req.method() === "GET" && (url.searchParams.get("select") || "").includes("report_payload")) return json([
    { process_id: id(304), report_type: "dailyStart", report_payload: { machine_qty: 150 }, user_id: user.id, operator_ids: [user.id], created_at: new Date(now - 180 * 60000).toISOString() },
  ]);
  if (p.endsWith("/station_commands") && req.method() === "GET") return json((url.searchParams.get("status") || "").includes("pending") ? [] : stationRows);
  if (p.endsWith("/rpc/machtile_get_station_report_guard_config")) {
    const code = JSON.parse(req.postData() || "{}").p_machine_code;
    return json({ factory_synced: true, machine_code: code, report_enabled: true,
      report_enabled_machines: Object.fromEntries(["A01", "A02", "A03", "A04", "A05"].map((x) => [x, true])),
      fail_reason_codes: ["尺寸不良", "其他"] });
  }
  if (p.endsWith("/rpc/machtile_submit_station_report")) {
    const body = JSON.parse(req.postData() || "{}"); stationSubmits.push(structuredClone(body));
    if (stationScenario === "error" && body.p_preview) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "preview exploded" }) });
    // REAL Factory receipt preview shape: StationReportPreview.cs Preview() :61-79 + SerializePreviewResult :126-178
    // (wt-deploy40) → status previewed, preview_result.allowed:false/hard:true/guard_code, written back by
    // StationCommandSources.cs :155-176 with reject_code null.
    if (body.p_preview && (stationScenario === "receipt-a04" || (stationScenario === "stale-a04" && staleReceiptNeeded)) && body.p_expected_order_no === "WO-A04" && body.p_previous_outsource_receipt_qty == null) {
      const code = "PREV_OUTSOURCE_RECEIPT_REQUIRED";
      return json([{ command_uuid: body.p_command_uuid, command_type: "report_preview", status: "previewed", reject_code: null, reject_message: null, legacy_snapshot: null,
        preview_result: { status: "previewed", allowed: false, hard: true, guard_code: code, message: "請確認原料委外已收貨。", available: 0,
          legacy_snapshot: { report: { guard: { code, hard: true, message: "請確認原料委外已收貨。", Details: { available: 0 } } } },
          previous_outsource_step_name: "素材外包", previous_outsource_doc4_numbers: ["D4-B1"], outsource_unconfirmed_qty: 30,
          expected_doc4_fingerprint: "9".repeat(64), receipt_mode: "material_confirm", receipt_required_qty: 30,
          receipt_steps: [{ index_sn: 1, process_name: "素材外包", vendor_name: "批次甲廠", unconfirmed_qty: 30 }] } }]);
    }
    // REAL final STALE shape thrown inside the receipt transaction (StationReportApplier.cs :119-121 →
    // WithSnapshot, no failure_detail; StationCommandSources.cs :159-161 {report, guard}, preview_result null).
    if (!body.p_preview && stationScenario === "stale-a04" && body.p_expected_order_no === "WO-A04" && staleFinalsLeft > 0 && body.p_previous_outsource_receipt_qty != null) {
      staleFinalsLeft -= 1;
      staleReceiptNeeded = !staleClearsReceipt; // someone else received it (or the doc4 set just changed)
      legacyOutputA04 += staleDrift;            // e.g. another report landed meanwhile
      const code = "PREV_OUTSOURCE_RECEIPT_STALE";
      return json([{ command_uuid: body.p_command_uuid, command_type: "report", status: "rejected", reject_code: code,
        reject_message: "委外未收貨明細已改變，請重新預覽後再送。", preview_result: null,
        legacy_snapshot: { report: { command_uuid: body.p_command_uuid, guard: { code, hard: true } }, guard: { code, hard: true } } }]);
    }
    if (body.p_preview) {
      const soft = stationScenario === "ack" || (stationScenario === "ack-a04" && body.p_expected_order_no === "WO-A04");
      const code = soft ? "HIGH_FAIL_RATIO" : "";
      const preview = { status: "previewed", allowed: !soft, hard: false, guard_code: code, available: 999,
        legacy_snapshot: { report: { guard: { code, hard: false, message: soft ? "needs ack" : "", Details: { available: 999 } } } } };
      return json([{ command_uuid: body.p_command_uuid, command_type: "report_preview", status: "previewed", preview_result: preview }]);
    }
    return json([{ command_uuid: body.p_command_uuid, command_type: "report", status: "applied", good_qty: body.p_good_qty, fail_qty: body.p_fail_qty }]);
  }
  if (p.endsWith("/rpc/field_report_upsert")) { const body = JSON.parse(req.postData() || "{}"); upserts.push(body); return json({ inserted: true, report_id: id(700) }); }
  if (p.includes("/rest/v1/")) return json([]);
  return json({});
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
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
await page.locator('.mobile-tab[data-view="batchLathe"]').evaluate((button) => button.click());
const rootView = page.locator('[data-batch-root="lathe"]');
await rootView.locator('[data-batch-row="A04"] [data-batch-current]').waitFor();
await page.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled);
ok(await rootView.locator("[data-batch-mode]").count() === 0, "three time-slot tabs are removed");
ok((await rootView.locator(".batch-mode-tabs").innerText()).trim() === "報工", "single Report tab remains");
ok(await rootView.locator("[data-batch-command-panel]").count() === 1, "batch start/stop command panel remains present");
ok(await rootView.locator("[data-batch-ct-min],[data-batch-ct-sec]").count() === 0, "manual machine-time fields are removed");
ok(await rootView.locator('[data-batch-row="A04"] [data-batch-finished]').count() === 0, "batch cards no longer duplicate the finish checkbox");
ok(await rootView.locator('[data-batch-row="A04"] [data-batch-operator]').inputValue() === user.id, "today's starter is preselected");
ok((await rootView.locator('[data-batch-machine-state="A04"]').textContent()).includes("90"), "station_commands drives stopped status and read-only minutes");
ok(await rootView.locator('[data-batch-row="A01"] [data-batch-current]').isDisabled(), "machine without assignment cannot report");
await page.evaluate(() => {
  window.MACHTILE_CONFIG.enableStationReport = true;
  machtileBatchState.stationReportSettings = { status: "loaded", machines: { A04: true }, failReasonCodesByMachine: { A04: ["尺寸不良"] }, error: "" };
  machtileBatchState.stationReportIdentityByProcess.set("00000000-0000-4000-8000-000000000304", {
    legacy_index_sn: 1, manufacture_ii_id: "MII-A04", simulation_id: "SIM-A04", part_no: "D-1",
  });
  machtileRenderBatchReport();
});
ok(await rootView.locator('[data-batch-row="A04"] [data-station-report-preview="A04"]').count() === 1, "smart-report panel remains in the card DOM");
ok(await rootView.locator('[data-batch-row="A04"] [data-station-report-panel]').isHidden(), "smart-report panel is collapsed by default");
await page.evaluate(() => {
  window.MACHTILE_CONFIG.enableStationReport = false;
  machtileBatchState.stationReportSettings = { status: "unavailable", machines: {}, failReasonCodesByMachine: {}, error: "" };
  machtileRenderBatchReport();
});
await rootView.locator('[data-batch-row="A04"] [data-batch-current]').fill("170");
ok((await rootView.locator('[data-batch-counter-preview="A04"]').innerText()).includes("30"), "DOM preview uses card-reported total rather than today's start counter");
await rootView.locator('[data-batch-row="A04"] [data-batch-defect-toggle]').check();
await rootView.locator('[data-batch-row="A04"] [data-batch-bad]').fill("2");
ok(await rootView.locator('[data-batch-row="A04"] [data-batch-reason-field]').isVisible(), "defect quantity reveals the centralized reason selector");
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
// owner 2026-10-31: machine counter includes defects → good = 170 - 140 - 2 = 28
ok(payload.report_type === "noon" && payload.completed_qty === 28 && payload.defect_qty === 2, `machine total includes this-time defects: good 28 + fail 2 (got ${payload.completed_qty}/${payload.defect_qty})`);
ok(payload.report_payload.backfill_qty === 10 && payload.report_payload.counter_today_qty === 18 && payload.report_payload.start_counter === 150 && payload.report_payload.reported_before === 140, "single payload carries shared backfill/today metadata");
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

// Clean smart preview automatically drives the panel's own final handler.
await page.evaluate(() => {
  window.MACHTILE_CONFIG.enableStationReport = true;
  machtileBatchState.stationReportSettings = { status: "loaded", machines: { A01: true, A02: true, A03: true, A04: true, A05: true }, failReasonCodesByMachine: { A04: ["尺寸不良", "其他"], A05: ["尺寸不良", "其他"] }, error: "" };
  machtileBatchState.stationReportIdentityByProcess.set("00000000-0000-4000-8000-000000000304", { legacy_index_sn: 1, manufacture_ii_id: "MII-A04", simulation_id: "SIM-A04", part_no: "D-1" });
  machtileBatchState.stationReportIdentityByProcess.set("00000000-0000-4000-8000-000000000305", { legacy_index_sn: 1, manufacture_ii_id: "MII-A05", simulation_id: "SIM-A05", part_no: "D-2" });
  machtileBatchState.machineTimeByProcess.set("00000000-0000-4000-8000-000000000304", 60);
  machtileBatchState.machineTimeByProcess.set("00000000-0000-4000-8000-000000000305", 60);
  machtileRenderBatchReport();
});
stationScenario = "clean";
const autoStart = stationSubmits.length;
await rootView.locator('[data-batch-row="A04"] [data-batch-current]').fill("180");
await rootView.locator("[data-batch-submit]").click();
await page.waitForFunction(() => document.querySelector('[data-batch-row="A04"] .batch-result')?.textContent.includes("✓"));
ok(stationSubmits.length === autoStart + 2 && stationSubmits[autoStart].p_preview === true && stationSubmits[autoStart + 1].p_preview === false, "clean preview is automatically submitted in order");
ok(await rootView.locator('[data-batch-row="A04"] [data-station-report-panel]').isHidden(), "clean auto-submit keeps the panel hidden");

// Calling the same handlers manually must produce the same command payloads.
const manualStart = stationSubmits.length;
await page.evaluate(async () => {
  const row = machtileBatchRow("A04");
  row.current = "180"; row.processId = "00000000-0000-4000-8000-000000000304"; row.operatorId = machtileBatchState.users[0].id; row.stationReport = null;
  machtileBatchState.stationReportIdentityByProcess.set(row.processId, { legacy_index_sn: 1, manufacture_ii_id: "MII-A04", simulation_id: "SIM-A04", part_no: "D-1" });
  machtileBatchRowModel("A04", new Date().toISOString());
  await machtileStationReportSubmitPreview("A04", { batch: true });
  await machtileStationReportSubmitFinal("A04", { batch: true });
});
const normalize = (value) => JSON.parse(JSON.stringify(value), (key, item) => key.includes("uuid") || key === "shown_at" ? "<dynamic>" : item);
ok(JSON.stringify(normalize(stationSubmits.slice(autoStart, autoStart + 2))) === JSON.stringify(normalize(stationSubmits.slice(manualStart, manualStart + 2))), "automatic payloads are identical to manual panel handler payloads");

// A soft guard expands only that card and the sequential loop continues.
await page.evaluate(() => {
  for (const [code, processId] of [["A04", "00000000-0000-4000-8000-000000000304"], ["A05", "00000000-0000-4000-8000-000000000305"]]) {
    const row = machtileBatchRow(code); row.stationReport = null; row.result = null; row.error = ""; row.processId = processId; row.operatorId = machtileBatchState.users[0].id;
  }
  machtileBatchState.stationReportIdentityByProcess.set("00000000-0000-4000-8000-000000000304", { legacy_index_sn: 1, manufacture_ii_id: "MII-A04", simulation_id: "SIM-A04", part_no: "D-1" });
  machtileBatchState.stationReportIdentityByProcess.set("00000000-0000-4000-8000-000000000305", { legacy_index_sn: 1, manufacture_ii_id: "MII-A05", simulation_id: "SIM-A05", part_no: "D-2" });
  machtileRenderBatchReport();
});
stationScenario = "ack-a04";
const ackStart = stationSubmits.length;
await rootView.locator('[data-batch-row="A04"] [data-batch-current]').fill("180");
await rootView.locator('[data-batch-row="A05"] [data-batch-current]').fill("60");
await rootView.locator("[data-batch-submit]").click();
await page.waitForFunction(() => document.querySelector('[data-batch-needs-confirmation="A04"]') && document.querySelector('[data-batch-row="A05"] .batch-result')?.textContent.includes("✓"));
ok(await rootView.locator('[data-batch-row="A04"] [data-station-report-panel]').isVisible(), "preview needing acknowledgement expands the panel with a confirmation marker");
ok(stationSubmits.slice(ackStart).filter((x) => x.p_expected_order_no === "WO-A04" && !x.p_preview).length === 0, "ack row is not submitted automatically");
ok(stationSubmits.slice(ackStart).filter((x) => x.p_expected_order_no === "WO-A05" && !x.p_preview).length === 1, "other rows continue after an acknowledgement is required");

// Receipt flag ON: the batch row stops for the dialog (explicit click), then the final carries the
// confirmed receipt once — no second prompt mid-batch.
// Let the previous scenario's background refresh (which reloads the identity map) settle first.
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.MACHTILE_CONFIG.outsourceReceiptDialogEnabled = true;
  for (const [code, processId] of [["A04", "00000000-0000-4000-8000-000000000304"], ["A05", "00000000-0000-4000-8000-000000000305"]]) {
    const row = machtileBatchRow(code); row.stationReport = null; row.result = null; row.error = ""; row.processId = processId; row.operatorId = machtileBatchState.users[0].id;
  }
  machtileBatchState.stationReportIdentityByProcess.set("00000000-0000-4000-8000-000000000304", { legacy_index_sn: 1, manufacture_ii_id: "MII-A04", simulation_id: "SIM-A04", part_no: "D-1" });
  machtileBatchState.stationReportIdentityByProcess.set("00000000-0000-4000-8000-000000000305", { legacy_index_sn: 1, manufacture_ii_id: "MII-A05", simulation_id: "SIM-A05", part_no: "D-2" });
  machtileRenderBatchReport();
});
stationScenario = "receipt-a04";
const receiptStart = stationSubmits.length;
await rootView.locator('[data-batch-row="A04"] [data-batch-current]').fill("180");
await rootView.locator('[data-batch-row="A05"] [data-batch-current]').fill("");
await rootView.locator("[data-batch-submit]").click();
await page.waitForSelector("#machtileOutsourceReceiptDialog", { timeout: 5000 });
ok(stationSubmits.slice(receiptStart).filter((x) => !x.p_preview).length === 0, "batch row waits for the receipt dialog; no final sent before the click");
ok((await page.locator("#outsourceReceiptTitle").innerText()).includes("素材外包（批次甲廠）"), "batch receipt dialog names the route step and vendor");
await page.locator("[data-outsource-receipt-confirm]").click();
await page.waitForFunction(() => document.querySelector('[data-batch-row="A04"] .batch-result')?.textContent.includes("✓"));
const receiptSent = stationSubmits.slice(receiptStart).filter((x) => x.p_expected_order_no === "WO-A04");
const receiptFinals = receiptSent.filter((x) => !x.p_preview);
ok(receiptSent.length === 3 && receiptSent[1].p_previous_outsource_receipt_qty === 30, "batch: blocked preview → receipt preview → final");
ok(receiptFinals.length === 1 && receiptFinals[0].p_previous_outsource_receipt_qty === 30 && receiptFinals[0].p_expected_doc4_fingerprint === "9".repeat(64), "batch final carries the confirmed receipt qty + fingerprint");
ok(await page.locator("#machtileOutsourceReceiptDialog").count() === 0, "batch final does not prompt a second time");
await page.evaluate(() => { window.MACHTILE_CONFIG.outsourceReceiptDialogEnabled = false; });
stationScenario = "clean";

// r4 M1/L1: a FINAL rejected STALE re-previews and may re-send unattended only after the same
// pre-final checks as SubmitFinal; at most one automatic retry.
async function resetStaleRows() {
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.MACHTILE_CONFIG.outsourceReceiptDialogEnabled = true;
    for (const [code, processId] of [["A04", "00000000-0000-4000-8000-000000000304"], ["A05", "00000000-0000-4000-8000-000000000305"]]) {
      const row = machtileBatchRow(code); row.stationReport = null; row.result = null; row.error = ""; row.processId = processId; row.operatorId = machtileBatchState.users[0].id;
    }
    machtileBatchState.stationReportIdentityByProcess.set("00000000-0000-4000-8000-000000000304", { legacy_index_sn: 1, manufacture_ii_id: "MII-A04", simulation_id: "SIM-A04", part_no: "D-1" });
    machtileBatchState.stationReportIdentityByProcess.set("00000000-0000-4000-8000-000000000305", { legacy_index_sn: 1, manufacture_ii_id: "MII-A05", simulation_id: "SIM-A05", part_no: "D-2" });
    machtileRenderBatchReport();
  });
}
async function runStaleCase({ finals, clears, drift, dialogs }) {
  await resetStaleRows();
  stationScenario = "stale-a04"; staleFinalsLeft = finals; staleReceiptNeeded = true; staleClearsReceipt = clears; staleDrift = drift;
  const start = stationSubmits.length;
  const current = 180 + (legacyOutputA04 - 140);
  await rootView.locator('[data-batch-row="A04"] [data-batch-current]').fill(String(current));
  await rootView.locator('[data-batch-row="A05"] [data-batch-current]').fill("");
  await rootView.locator("[data-batch-submit]").click();
  for (let i = 0; i < dialogs; i += 1) {
    await page.waitForSelector("#machtileOutsourceReceiptDialog", { timeout: 5000 });
    await page.locator("[data-outsource-receipt-confirm]").click();
  }
  await page.waitForFunction(() => { const r = document.querySelector('[data-batch-row="A04"] .batch-result'); return r && r.textContent.trim().length > 0; }, null, { timeout: 10000 });
  return { sent: stationSubmits.slice(start).filter((x) => x.p_expected_order_no === "WO-A04"),
    result: (await rootView.locator('[data-batch-row="A04"] .batch-result').innerText()).trim() };
}
// (a) reported total changed between the operator's confirmation and the STALE re-preview → no re-send.
const drifted = await runStaleCase({ finals: 1, clears: true, drift: 5, dialogs: 1 });
ok(drifted.sent.length === 4 && drifted.sent[2].p_preview === false && drifted.sent[3].p_preview === true && drifted.sent[3].p_previous_outsource_receipt_qty === null,
  `STALE final re-runs a fresh preview (no receipt needed now): ${JSON.stringify(drifted.sent.map((x) => [x.p_preview, x.p_previous_outsource_receipt_qty]))}`);
ok(drifted.sent.filter((x) => !x.p_preview).length === 1, "reported total changed → the STALE final is NOT re-sent");
ok(drifted.result.includes("已報數量已改變，請重新預覽後再送出"), `changed total shows the re-preview message: ${drifted.result}`);
ok(await page.locator("#machtileOutsourceReceiptDialog").count() === 0, "no dialog left open after the drift stop");
// (b) positive: totals unchanged, receipt resolved elsewhere → exactly one unattended re-send, applied.
const resent = await runStaleCase({ finals: 1, clears: true, drift: 0, dialogs: 1 });
const resentFinals = resent.sent.filter((x) => !x.p_preview);
ok(resentFinals.length === 2 && resentFinals[1].p_command_uuid !== resentFinals[0].p_command_uuid && resentFinals[1].p_previous_outsource_receipt_qty === null,
  "unchanged totals → one re-send with a new uuid (no receipt, it was resolved elsewhere)");
ok(resentFinals[1].p_client_guard_snapshot?.preview_command_uuid === resent.sent[3].p_command_uuid, "re-sent final binds the fresh preview");
ok(resent.result.includes("✓"), `re-sent final is applied: ${resent.result}`);
// (c) L1: the re-sent final is STALE again → stop after one automatic retry with the stale message.
const twice = await runStaleCase({ finals: 2, clears: false, drift: 0, dialogs: 2 });
const twiceFinals = twice.sent.filter((x) => !x.p_preview);
ok(twiceFinals.length === 2, `second STALE does not trigger another re-preview/re-send: ${JSON.stringify(twice.sent.map((x) => [x.p_preview, x.p_previous_outsource_receipt_qty]))}`);
ok(twice.sent.length === 6 && twice.sent.at(-1).p_preview === false && twice.sent[4].p_expected_doc4_fingerprint === "9".repeat(64), "preview, receipt preview, STALE, fresh preview, receipt preview, STALE — and no preview after the second STALE");
ok(twice.result.includes("委外單剛被別人改過，請重新預覽"), `second STALE stops with the stale message: ${twice.result}`);
await page.evaluate(() => { window.MACHTILE_CONFIG.outsourceReceiptDialogEnabled = false; });
stationScenario = "clean"; staleFinalsLeft = 0; staleReceiptNeeded = false; staleDrift = 0;

// A preview transport error is attached to the card and does not submit.
await page.evaluate(() => { const row = machtileBatchRow("A04"); row.stationReport = null; row.result = null; row.error = ""; machtileRenderBatchReport(); });
stationScenario = "error";
const errorStart = stationSubmits.length;
await rootView.locator('[data-batch-row="A04"] [data-batch-current]').fill("180");
await rootView.locator("[data-batch-submit]").click();
await page.waitForFunction(() => document.querySelector('[data-batch-row="A04"]')?.classList.contains("has-error"));
ok(stationSubmits.slice(errorStart).filter((x) => !x.p_preview).length === 0, "preview error never submits that row");
ok((await rootView.locator('[data-batch-row="A04"] .batch-result').innerText()).trim().length > 0, "preview error is shown on the card");

await page.evaluate(() => { for (const code of ["A04", "A05"]) { const row = machtileBatchRow(code); row.stationReport = null; row.result = null; row.error = ""; row.current = ""; row.good = ""; row.bad = ""; row.failReasonCode = ""; row.reportNote = ""; row.defectOpen = false; } machtileRenderBatchReport(); });

// Owner 2026-10-31: machine total includes defects (A05 row, flag on).
const A05 = "00000000-0000-4000-8000-000000000305";
const setA05 = (failDone) => page.evaluate(({ processId, failDone }) => {
  machtileBatchState.freshReportedByProcess.set(processId, 750);
  machtileBatchState.freshFailReportedByProcess.set(processId, failDone);
  machtileBatchState.counterBaselineByProcess.delete(processId);
  machtileRenderBatchReport();
}, { processId: A05, failDone });
const a05Model = () => page.evaluate(() => { const m = machtileBatchRowModel("A05", new Date().toISOString()); const v = machtileBatchCore().validateRow(m); return { valid: m.counter.valid, code: m.counter.code, good: m.good, fail: m.counter.fail, send: v.send, error: v.error }; });
await page.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled);
await rootView.locator('[data-batch-row="A05"] [data-batch-current]').fill("761");
await rootView.locator('[data-batch-row="A05"] [data-batch-defect-toggle]').check();
await setA05(0);
await rootView.locator('[data-batch-row="A05"] [data-batch-bad]').fill("1");
ok((await rootView.locator('[data-batch-counter-preview="A05"]').innerText()) === "這次良品 10 件、不良 1 件", `batch preview shows the split: ${await rootView.locator('[data-batch-counter-preview="A05"]').innerText()}`);
let m05 = await a05Model();
ok(m05.valid && m05.good === 10 && m05.fail === 1, `761 / goodDone 750 / failDone 0 / fail 1 → good 10 fail 1: ${JSON.stringify(m05)}`);
await setA05(5);
m05 = await a05Model();
ok(m05.valid && m05.good === 5 && m05.fail === 1, `failDone 5 → good 5: ${JSON.stringify(m05)}`);
await rootView.locator('[data-batch-row="A05"] [data-batch-bad]').fill("7");
m05 = await a05Model();
ok(!m05.valid && m05.code === "FAIL_EXCEEDS_ADDED" && m05.error === "不良數比這次多出來的件數還多，請確認", `fail above added parts is blocked: ${JSON.stringify(m05)}`);
ok((await rootView.locator('[data-batch-counter-preview="A05"]').innerText()) === "不良數比這次多出來的件數還多，請確認", "batch preview shows the block sentence");
await rootView.locator('[data-batch-row="A05"] [data-batch-bad]').fill("6");
m05 = await a05Model();
ok(m05.valid && m05.good === 0 && m05.error !== "本次增加 0 件，不需報工。", `fail-only row is not rejected by the zero-report rule: ${JSON.stringify(m05)}`);
await setA05(null);
await rootView.locator('[data-batch-row="A05"] [data-batch-bad]').fill("0");
m05 = await a05Model();
ok(m05.valid && m05.good === 11, `failDone unknown + fail 0 behaves as before: ${JSON.stringify(m05)}`);
await rootView.locator('[data-batch-row="A05"] [data-batch-bad]').fill("1");
m05 = await a05Model();
ok(!m05.valid && m05.code === "FAIL_REPORTED_REQUIRED" && m05.error === "暫時無法核對已報不良數，請稍後再按", `failDone unknown + fail > 0 fails closed: ${JSON.stringify(m05)}`);
await page.evaluate(() => { const row = machtileBatchRow("A05"); row.current = ""; row.bad = ""; row.defectOpen = false; machtileRenderBatchReport(); });
ok(blocked.length === 0, "browser did not contact production or another external host");
await page.screenshot({ path: path.join(outDir, "preview-r3-1280.png"), fullPage: true });
await context.close();

const phoneContext = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "block" });
await phoneContext.addInitScript(({ token }) => {
  sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", mode: "session", createdAt: Date.now() }));
  localStorage.setItem("machtile.language", "vi");
}, { token: jwt });
await phoneContext.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith(FAKE)) return fake(route);
  if (url.startsWith(base)) return new URL(url).pathname.endsWith("/config.js") ? route.fulfill({ status: 200, contentType: "text/javascript", body: config }) : route.continue();
  blocked.push(url); return route.abort();
});
const phone = await phoneContext.newPage();
await phone.goto(base, { waitUntil: "domcontentloaded" });
await phone.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await phone.locator('.mobile-tab[data-view="batchLathe"]').evaluate((button) => button.click());
const phoneRoot = phone.locator('[data-batch-root="lathe"]');
await phoneRoot.locator('[data-batch-row="A04"] [data-batch-current]').waitFor();
await phone.waitForFunction(() => !document.querySelector('[data-batch-root="lathe"] [data-batch-refresh]')?.disabled);
ok((await phoneRoot.locator('[data-batch-row="A04"] .batch-total-input span').first().innerText()).includes("Tổng số hiện tại trên máy"), "Vietnamese locale renders the batch total label");
ok((await phoneRoot.locator('[data-batch-row="A04"] .batch-defect-toggle').innerText()).includes("Có hàng lỗi"), "Vietnamese locale renders the defect toggle");
ok((await phoneRoot.locator('[data-batch-submit]').innerText()).includes("Gửi tất cả một lần"), "Vietnamese locale renders the submit action");
await phone.screenshot({ path: path.join(outDir, "preview-r3-pixel7.png"), fullPage: true });
await phoneContext.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
console.log(`PASS: ${pass} browser assertions; screenshots ${path.join(outDir, "preview-r3-1280.png")} and preview-r3-pixel7.png`);
