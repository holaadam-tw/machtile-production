// 組裝站平板報工（assemblyReport.js）瀏覽器測試：假 Supabase（攔截所有網路），不碰正式環境。
// 涵蓋：旗標關＝完全不變；站上多張單列表；逐單開工；兩位報工人報工；不良＋軟性確認；委外代收貨對話框；
// 完工（帶最後件數→報工＋關站、不帶件數→直接關站）；G01 閥件／幫浦分線；越南文。
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const shotDir = process.env.ASSEMBLY_SHOT_DIR || "D:/04_SoftNet/ops/owner-pack/20261031-assembly-app";
const mod = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright");
const { chromium } = mod.default || mod;
let pass = 0;
const ok = (value, label) => { if (!value) throw new Error(`FAIL ${label}`); pass += 1; console.log(`PASS ${label}`); };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
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
const users = [
  { id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) },
  { id: id(902), name: "陳大華", legacy_user_id: "1080302" },
  { id: id(903), name: "林美玲", legacy_user_id: "1080303" },
  { id: id(904), name: "未對照", legacy_user_id: "" },
];
const me = users[0];
const machines = ["A04", "F01", "G01"].map((code, i) => ({ id: id(200 + i), machine_code: code, machine_name: code,
  machine_type: code === "A04" ? "車床" : code === "F01" ? "組立" : "測試", location: "", status: "idle", display_order: i }));
const machineByCode = (code) => machines.find((m) => m.machine_code === code);
// 站上的單（Station_Type 8：同一站同時好幾張，各有自己的 ManufactureII Id）
const orders = [
  { pid: id(301), wo: "WO-F1", part: "AR16 柱塞泵組立", partNo: "PA-F1", qty: 50, status: "running", machine: "F01", index: 5, mii: "MII-F1", sim: "SIM-F1", due: "2026-11-03" },
  { pid: id(302), wo: "WO-F2", part: "DSHG-02 電磁閥組立", partNo: "PA-F2", qty: 20, status: "pending", machine: "F01", index: 3, mii: "MII-F2", sim: "SIM-F2", due: "2026-11-04" },
  { pid: id(303), wo: "WO-F3", part: "PV2R1 葉片泵組立", partNo: "PA-F3", qty: 30, status: "pending", machine: "F01", index: 4, mii: "MII-F3", sim: "SIM-F3", due: "2026-11-06" },
  { pid: id(304), wo: "WO-G1", part: "DSG-01 方向閥測試", partNo: "PA-G1", qty: 40, status: "running", machine: "G01", index: 6, mii: "MII-G1", sim: "SIM-G1", due: "2026-11-02" },
  { pid: id(305), wo: "WO-G2", part: "PV2R2 葉片泵測試", partNo: "PA-G2", qty: 40, status: "pending", machine: "G01", index: 6, mii: "MII-G2", sim: "SIM-G2", due: "2026-11-05" },
  { pid: id(306), wo: "WO-A4", part: "車削件", partNo: "PA-A4", qty: 100, status: "running", machine: "A04", index: 1, mii: null, sim: "SIM-A4", due: "2026-11-01" },
];
const processRow = (o) => ({ id: o.pid, tenant_id: T, process_order: o.index, process_name: o.machine === "A04" ? "車削" : "組立", process_type: "assembly",
  status: o.status, off_station_at: null, qty_completed: 0, queue_order: null, manufacture_ii_id: o.mii, simulation_id: o.sim,
  work_orders: { id: id(400 + Number(o.pid.slice(-3)) - 300), work_order_no: o.wo, part_no: o.partNo, part_name: o.part, quantity: o.qty, due_date: o.due, status: "in_progress", legacy_mes_source: null, external_ref: null },
  machines: { id: machineByCode(o.machine).id, machine_code: o.machine } });

function makeState() {
  return { reportSubmits: [], commandSubmits: [], commandRows: new Map(), upserts: [], guardCalls: [], assemblyReads: [], blocked: [], receiptAsked: 0 };
}
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = `${b64({ alg: "HS256" })}.${b64({ sub: me.auth, email: "op@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const baseConfig = `authMode:"strict",supabaseUrl:"${FAKE}",supabaseAnonKey:"test",tenantId:"${T}",useSupabase:true,useTenantHeaderAuth:true,enableOutboxSubmit:true,enableFileUpload:false,enableStationReport:true,stationReportMachines:["A01","A02","A03","A04","A05"],reportTotalSemanticsEnabled:true,outsourceReceiptDialogEnabled:true,disableServiceWorker:true`;

function fakeFor(st) {
  return async function fake(route) {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname; const sel = url.searchParams.get("select") || "";
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const body = () => JSON.parse(req.postData() || "{}");
    if (p.startsWith("/auth/v1/user")) return json({ id: me.auth, email: "op@test.invalid" });
    if (p.endsWith("/rpc/machine_department_context")) return json({ tenant_id: T, role: "operator", is_bridge: false, all_departments: true, department_codes: [] });
    if (p.endsWith("/v_work_order_cards")) return json([]);
    if (p.endsWith("/v_machine_management_cards")) return json(machines);
    if (p.endsWith("/work_order_processes") && sel.includes("legacy_index_sn")) {
      st.assemblyReads.push(url.search);
      const ids = (url.searchParams.get("id") || "").replace(/^in\.\(|\)$/g, "").split(",");
      return json(orders.filter((o) => ids.includes(o.pid)).map((o) => ({ id: o.pid, legacy_index_sn: o.index, manufacture_ii_id: o.mii, simulation_id: o.sim, work_orders: { part_no: o.partNo } })));
    }
    if (p.endsWith("/work_order_processes") && sel.includes("work_orders!inner")) return json(orders.map(processRow));
    if (p.endsWith("/app_users")) return json(url.searchParams.has("auth_user_id") ? [{ id: me.id, name: me.name }] : users.map(({ auth, ...u }) => u));
    if (p.endsWith("/rpc/batch_report_progress")) {
      return json(body().p_process_ids.map((pid) => {
        const done = st.upserts.filter((u) => u.p_payload?.process_id === pid);
        return { process_id: pid, legacy_output: 10, legacy_fail: 0, pending_output: done.reduce((s, u) => s + Number(u.p_payload.completed_qty || 0), 0),
          pending_fail: done.reduce((s, u) => s + Number(u.p_payload.defect_qty || 0), 0), pending_count: done.length, last_report_at: null, actual_start_at: null };
      }));
    }
    if (p.endsWith("/rpc/machtile_get_station_report_guard_config")) {
      const code = body().p_machine_code; st.guardCalls.push(code);
      const enabled = ["F01", "G01"].includes(code);
      return json({ factory_synced: true, machine_code: code, report_enabled: enabled, report_enabled_machines: { F01: true, G01: true }, fail_reason_codes: ["尺寸不良", "外觀", "其他"] });
    }
    if (p.endsWith("/station_commands") && req.method() === "GET") {
      const uuid = (url.searchParams.get("command_uuid") || "").replace(/^eq\./, "");
      if (uuid) return json(st.commandRows.has(uuid) ? [st.commandRows.get(uuid)] : []);
      return json([]);
    }
    if (p.endsWith("/rpc/machtile_submit_station_command")) {
      const b = body(); st.commandSubmits.push(b);
      // 回 pending（真實：工廠還沒接手），之後輪詢才拿到 applied
      st.commandRows.set(b.p_command_uuid, { command_uuid: b.p_command_uuid, command_type: b.p_command_type, status: "applied", requested_at: new Date().toISOString(), applied_at: new Date().toISOString(), legacy_snapshot: {} });
      return json([{ command_uuid: b.p_command_uuid, command_type: b.p_command_type, status: "pending", requested_at: new Date().toISOString() }]);
    }
    if (p.endsWith("/rpc/machtile_submit_station_report")) {
      const b = body(); st.reportSubmits.push(structuredClone(b));
      if (b.p_preview) {
        // WO-F2：上一道委外未收貨（真實 Factory 預覽形狀，見 batchReport.browser.test.mjs）
        if (b.p_expected_order_no === "WO-F2" && b.p_previous_outsource_receipt_qty == null) {
          const code = "PREV_OUTSOURCE_RECEIPT_REQUIRED";
          return json([{ command_uuid: b.p_command_uuid, command_type: "report_preview", status: "previewed", reject_code: null, reject_message: null, legacy_snapshot: null,
            preview_result: { status: "previewed", allowed: false, hard: true, guard_code: code, message: "請確認委外已收貨。", available: 0,
              legacy_snapshot: { report: { guard: { code, hard: true, message: "請確認委外已收貨。", Details: { available: 0 } } } },
              expected_doc4_fingerprint: "7".repeat(64), receipt_mode: "count", receipt_required_qty: 20, previous_outsource_doc4_numbers: ["D4-77"],
              receipt_steps: [{ index_sn: 2, process_name: "電鍍", vendor_name: "甲電鍍", unconfirmed_qty: 20 }] } }]);
        }
        const soft = Number(b.p_fail_qty) >= 2 && !(b.p_acks || []).length;
        const code = soft ? "HIGH_FAIL_RATIO" : "";
        return json([{ command_uuid: b.p_command_uuid, command_type: "report_preview", status: "previewed",
          preview_result: { status: "previewed", allowed: !soft, hard: false, guard_code: code, available: 999,
            legacy_snapshot: { report: { guard: { code, hard: false, message: soft ? "needs ack" : "", Details: { available: 999 } } } } } }]);
      }
      return json([{ command_uuid: b.p_command_uuid, command_type: "report", status: "applied", good_qty: b.p_good_qty, fail_qty: b.p_fail_qty }]);
    }
    if (p.endsWith("/rpc/field_report_upsert")) { const b = body(); st.upserts.push(b); return json({ inserted: true, report_id: id(700 + st.upserts.length) }); }
    if (p.includes("/rest/v1/")) return json([]);
    return json({});
  };
}

const browser = await chromium.launch();
async function openApp(st, cfg, { viewport = { width: 1280, height: 900 }, lang = "" } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.addInitScript(([token, language]) => {
    sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", mode: "session", createdAt: Date.now() }));
    if (language) localStorage.setItem("machtile.language", language);
  }, [jwt, lang]);
  const fake = fakeFor(st);
  await context.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(FAKE)) return fake(route);
    if (u.startsWith(base)) return new URL(u).pathname.endsWith("/config.js") ? route.fulfill({ status: 200, contentType: "text/javascript", body: `window.MACHTILE_CONFIG={${cfg}};` }) : route.continue();
    st.blocked.push(u); return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error("PAGEERROR", error.message); });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
  return { context, page, errors };
}
const orderCard = (page, wo) => page.locator(`[data-assembly-root] [data-asm-order-no="${wo}"]`);
await mkdir(shotDir, { recursive: true });

// ---------------------------------------------------------------- 1. 旗標關＝完全不變
{
  const st = makeState();
  const { context, page, errors } = await openApp(st, baseConfig);
  await page.waitForTimeout(800);
  ok(await page.locator("[data-assembly-entry]").count() === 0 && await page.locator("#assemblyView").count() === 0, "flag off: 頁面沒有組裝入口與畫面（DOM 與原本相同）");
  ok(await page.locator('[data-monitor-batch-entry="lathe"]').count() === 1, "flag off: 原本車床批次入口仍在");
  await page.evaluate(() => { switchView("assembly"); machtileAssemblyOnView(); });
  await page.waitForTimeout(300);
  ok(await page.locator("#dashboardView").evaluate((el) => el.classList.contains("is-active")), "flag off: 硬切 assembly 畫面不存在、維持原頁");
  ok(!st.guardCalls.includes("F01") && st.assemblyReads.length === 0, "flag off: 沒有讀 F01 報工設定、沒有讀組裝對照");
  ok(st.commandSubmits.length === 0 && st.reportSubmits.length === 0, "flag off: 沒有任何寫入");
  ok(errors.length === 0, "flag off: 沒有頁面錯誤");
  await context.close();
}

// ---------------------------------------------------------------- 1b. 旗標開但登入者租戶不在 assemblyReportTenants＝關（fail closed）
{
  const st0 = makeState();
  const offCfg = `${baseConfig},disableServiceWorker:true`;
  const wrongCfg = `${baseConfig},assemblyReportEnabled:true,assemblyReportTenants:["a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f"],assemblyStations:["F01","G01"]`;
  const off = await openApp(makeState(), offCfg);
  const { context, page, errors } = await openApp(st0, wrongCfg);
  await page.waitForTimeout(800); await off.page.waitForTimeout(800);
  ok(await page.locator("[data-assembly-entry], #assemblyView").count() === 0, "租戶不在清單：沒有組裝入口與畫面");
  const heading = (p) => p.locator("#dashboardView .monitor-heading-actions").evaluate((el) => el.outerHTML);
  ok(await heading(page) === await heading(off.page), "租戶不在清單：Monitor 入口列跟旗標關完全相同");
  ok(!st0.guardCalls.some((c) => ["F01", "G01"].includes(c)) && st0.assemblyReads.length === 0 && st0.commandSubmits.length === 0, "租戶不在清單：不讀組裝資料、沒有寫入");
  ok(errors.length === 0, "租戶不在清單：沒有頁面錯誤");
  await context.close(); await off.context.close();
}

// ---------------------------------------------------------------- 2. 旗標開（F01＋G01）
const st = makeState();
const cfgOn = `${baseConfig},assemblyReportEnabled:true,assemblyReportTenants:["${T}"],assemblyStations:["F01","G01"],assemblyPollIntervalMs:50,enableShortCompletion:true,shortCompletionMachines:["F01","G01"]`;
const { context, page, errors } = await openApp(st, cfgOn);
const entry = page.locator("#dashboardView [data-assembly-entry]");
await entry.waitFor({ state: "visible" });
ok((await entry.innerText()).includes("F01・G01"), "flag on: Monitor 入口顯示「組裝報工（F01・G01）」");
await entry.click();
await orderCard(page, "WO-F1").waitFor();
const rootEl = page.locator("[data-assembly-root]");
ok((await rootEl.locator("[data-asm-count]").innerText()).includes("3"), "列出 F01 站上全部 3 張單");
const orderNos = await rootEl.locator("[data-asm-order]").evaluateAll((els) => els.map((e) => e.dataset.asmOrderNo));
ok(JSON.stringify(orderNos) === JSON.stringify(["WO-F1", "WO-F2", "WO-F3"]), "排序：生產中優先、再依交期（不含 A04、G01 的單）");
ok((await orderCard(page, "WO-F1").locator("[data-asm-status]").innerText()).includes("生產中"), "WO-F1 顯示生產中");
ok((await orderCard(page, "WO-F2").locator("[data-asm-status]").innerText()).includes("未開工"), "WO-F2 顯示未開工");
ok((await orderCard(page, "WO-F1").innerText()).includes("已報 良 10"), "已報數來自 batch_report_progress");
ok(st.guardCalls.includes("F01"), "讀 F01 報工設定（ReportPilotStations 同步）");
await page.screenshot({ path: path.join(shotDir, "01-f01-station-orders.png"), fullPage: true });

// ---- 開工 WO-F2
await orderCard(page, "WO-F2").locator("[data-asm-start]").click();
await orderCard(page, "WO-F2").locator("[data-asm-start-confirm]").click();
await orderCard(page, "WO-F2").locator('[data-asm-result]').waitFor();
const start = st.commandSubmits.at(-1);
ok(start.p_command_type === "start" && start.p_machine_code === "F01" && start.p_expected_order_no === "WO-F2", "開工送 machtile_submit_station_command start（F01／WO-F2）");
ok(start.p_manufacture_ii_id === "MII-F2" && start.p_expected_index_sn === 3 && start.p_expected_part_no === "PA-F2", "開工帶這張單的 ManufactureII Id、IndexSN、料號");
ok((await orderCard(page, "WO-F2").locator("[data-asm-result]").innerText()).includes("已開工"), "輪詢到 applied → 顯示已開工");
ok((await orderCard(page, "WO-F2").locator("[data-asm-status]").innerText()).includes("生產中"), "WO-F2 狀態變生產中");

// ---- 報工 WO-F1：兩位報工人
const f1 = orderCard(page, "WO-F1");
await f1.locator("[data-asm-report]").click();
const meBox = f1.locator(`[data-asm-operator][value="${me.id}"]`);
ok(await meBox.isChecked(), "報工人預設勾「我」");
ok((await f1.locator(".asm-operators").innerText()).includes("王小明（我）"), "「我」標示在名字後面");
ok(!(await f1.locator(".asm-operators").innerText()).includes("未對照"), "沒對照工號的人不列出");
await f1.locator("[data-asm-good]").fill("12");
await f1.locator(`[data-asm-operator][value="${users[1].id}"]`).check();
await page.screenshot({ path: path.join(shotDir, "02-f01-report-two-operators.png"), fullPage: true });
await f1.locator("[data-asm-submit]").click();
await f1.locator("[data-asm-result]").waitFor();
const f1Reports = st.reportSubmits.filter((r) => r.p_expected_order_no === "WO-F1");
ok(f1Reports.length === 2 && f1Reports[0].p_preview === true && f1Reports[1].p_preview === false, "報工＝先預覽再正式（machtile_submit_station_report）");
ok(f1Reports.every((r) => r.p_manufacture_ii_id === "MII-F1" && r.p_machine_code === "F01" && r.p_expected_index_sn === 5 && r.p_expected_simulation_id === "SIM-F1"), "兩次都帶 WO-F1 的 ManufactureII Id（指定多工站上的哪一張）");
ok(f1Reports[1].p_good_qty === 12 && f1Reports[1].p_fail_qty === 0, "數量＝這次完成 12 件（不是機台總數）");
ok(!Object.keys(f1Reports[0]).some((k) => ["p_backfill_qty", "p_counter_today_qty", "p_start_counter", "p_reported_before"].includes(k)), "組裝站不送機台計數器欄位");
ok(f1Reports[1].p_client_guard_snapshot?.preview_command_uuid === f1Reports[0].p_command_uuid, "正式報工帶預覽的 guard snapshot");
const f1Upsert = st.upserts.find((u) => u.p_payload?.process_id === id(301));
ok(f1Upsert && f1Upsert.p_report_uuid === f1Reports[1].p_command_uuid, "App 紀錄 report_uuid＝正式報工指令 uuid（冪等）");
ok(JSON.stringify([...(f1Upsert.p_payload.operators || [])].sort()) === JSON.stringify([me.id, users[1].id].sort()), "App 紀錄 operators＝兩位報工人");
ok(f1Upsert.p_payload.report_payload?.station_command_uuid === f1Reports[1].p_command_uuid && f1Upsert.p_payload.report_payload?.report_source === "assembly_app", "report_payload 標 station_command_uuid（回寫橋不重寫）");
ok((await f1.locator("[data-asm-result]").innerText()).includes("良品 12、不良 0（報工人：王小明、陳大華）"), "結果：良品 12、報工人兩位");
await page.screenshot({ path: path.join(shotDir, "03-f01-report-applied.png"), fullPage: true });

// ---- 報工 WO-F3：F01 組立不顯示「有不良品」，一律送不良 0（owner：組裝不會發現不良，測試台才會）
const f3 = orderCard(page, "WO-F3");
await f3.locator("[data-asm-report]").click();
ok(await f3.locator("[data-asm-defect-toggle]").count() === 0 && await f3.locator("[data-asm-bad]").count() === 0, "F01：沒有「有不良品」也沒有不良數欄位");
await f3.locator("[data-asm-good]").fill("5");
await f3.locator("[data-asm-submit]").click();
await f3.locator("[data-asm-result].is-ok").waitFor();
const f3Calls = st.reportSubmits.filter((r) => r.p_expected_order_no === "WO-F3");
ok(f3Calls.length === 2 && f3Calls.every((r) => r.p_fail_qty === 0 && r.p_fail_reason_code === null), "F01：預覽與正式都送不良 0、不帶原因");
ok(st.upserts.find((u) => u.p_payload?.process_id === id(303))?.p_payload.defect_qty === 0, "F01：App 紀錄不良 0");

// ---- 報工 WO-F2：上一道委外未收貨 → 既有代收貨對話框
const f2 = orderCard(page, "WO-F2");
await f2.locator("[data-asm-report]").click();
await f2.locator("[data-asm-good]").fill("20");
await f2.locator("[data-asm-submit]").click();
const dialog = page.locator("#machtileOutsourceReceiptDialog");
await dialog.waitFor();
ok((await dialog.innerText()).includes("電鍍"), "代收貨對話框（沿用既有）問上一道委外回來幾件");
await page.screenshot({ path: path.join(shotDir, "05-f02-outsource-receipt.png"), fullPage: true });
await dialog.locator("[data-outsource-receipt-confirm]").click();
await f2.locator("[data-asm-result].is-ok").waitFor();
const f2Calls = st.reportSubmits.filter((r) => r.p_expected_order_no === "WO-F2");
ok(f2Calls.length === 3 && f2Calls[1].p_preview === true && f2Calls[1].p_previous_outsource_receipt_qty === 20, "收貨後用新 uuid 重新預覽並帶收貨數 20");
ok(f2Calls[2].p_preview === false && f2Calls[2].p_previous_outsource_receipt_qty === 20 && f2Calls[2].p_expected_doc4_fingerprint === "7".repeat(64), "正式報工沿用同一份收貨確認（不再問第二次）");

// ---- 完工 WO-F3（工單 30；已報 舊 MES 10＋App 5＝15）：最後 15 件＝做滿 → 不問短交，報工(finish)＋關站
await f3.locator("[data-asm-finish]").click();
ok((await f3.locator(".asm-finish-question").innerText()).includes("全部做完"), "完工先問「全部做完了？」");
await f3.locator("[data-asm-good]").fill("15");
await page.screenshot({ path: path.join(shotDir, "06-f03-finish-confirm.png"), fullPage: true });
await f3.locator("[data-asm-submit]").click();
await page.waitForFunction(() => !document.querySelector('[data-asm-order-no="WO-F3"]'));
const f3Close = st.commandSubmits.filter((c) => c.p_expected_order_no === "WO-F3").at(-1);
const f3FinishReport = st.reportSubmits.filter((r) => r.p_expected_order_no === "WO-F3" && r.p_preview === false).at(-1);
ok(f3FinishReport.p_good_qty === 15 && f3FinishReport.p_fail_qty === 0, "完工最後 15 件先報工");
ok(st.upserts.filter((u) => u.p_payload?.process_id === id(303)).at(-1).p_payload.report_type === "finish", "最後那筆 App 紀錄 report_type＝finish");
ok(f3Close?.p_command_type === "close" && f3Close.p_manufacture_ii_id === "MII-F3" && f3Close.p_expected_simulation_id === "SIM-F3" && f3Close.p_expected_index_sn === 4, "再送 close（帶 ManufactureII Id＋SimulationId）");
ok(!("p_short_completion" in f3Close), "做滿：沒有短交提問、close 不帶 p_short_completion");

// ---- 完工 WO-F1（工單 50；已報 10＋12＝22）：不帶件數 → 差 28 → 短交確認＋原因
const beforeReports = st.reportSubmits.length;
const beforeCommands = st.commandSubmits.length;
await f1.locator("[data-asm-finish]").click();
await f1.locator("[data-asm-submit]").click();
await f1.locator("[data-asm-short]").waitFor();
ok((await f1.locator("[data-asm-short]").innerText()).includes("這張單還差 28 個沒組"), "短交確認：「這張單還差 28 個沒組…確定要短交完工？」");
ok(st.commandSubmits.length === beforeCommands, "還沒確認短交前不送 close");
ok((await f1.locator("[data-asm-submit]").innerText()).includes("確定短交完工"), "按鈕改成「確定短交完工」");
await f1.locator("[data-asm-submit]").click();
ok((await f1.locator("[data-asm-form-error]").innerText()).includes("要選原因"), "沒選原因 → 擋下");
ok(st.commandSubmits.length === beforeCommands, "擋下時仍沒送 close");
await f1.locator('[data-asm-short-reason][value="OTHER"]').check();
await f1.locator("[data-asm-submit]").click();
ok((await f1.locator("[data-asm-form-error]").innerText()).includes("寫一句說明"), "選「其他」沒寫說明 → 擋下");
await f1.locator("[data-asm-short-note]").fill("客戶改單");
await page.screenshot({ path: path.join(shotDir, "07-f01-short-close-confirm.png"), fullPage: true });
await f1.locator("[data-asm-submit]").click();
await page.waitForFunction(() => !document.querySelector('[data-asm-order-no="WO-F1"]'));
const f1Close = st.commandSubmits.filter((c) => c.p_expected_order_no === "WO-F1").at(-1);
ok(st.reportSubmits.length === beforeReports, "沒填件數的完工不送報工");
ok(f1Close.p_command_type === "close" && JSON.stringify(f1Close.p_short_completion) === JSON.stringify({ reason_code: "OTHER", note: "客戶改單" }), "close 帶既有短交合約 p_short_completion＝{OTHER, 客戶改單}");
ok((await rootEl.locator("[data-asm-count]").innerText()).includes("1"), "關站後站上剩 1 張單");

// ---- G01：閥件測試／幫浦測試分線；測試站可以報不良
await rootEl.locator('[data-asm-station="G01"]').click();
await orderCard(page, "WO-G1").waitFor();
ok(await rootEl.locator("[data-asm-line]").count() === 4, "G01 有 全部／閥件測試／幫浦測試／未分類 分線鈕");
await rootEl.locator('[data-asm-line="valve"]').click();
let gNos = await rootEl.locator("[data-asm-order]").evaluateAll((els) => els.map((e) => e.dataset.asmOrderNo));
ok(JSON.stringify(gNos) === JSON.stringify(["WO-G1"]), "閥件測試只看 DSG 閥件單");
await page.screenshot({ path: path.join(shotDir, "08-g01-valve-line.png"), fullPage: true });
await rootEl.locator('[data-asm-line="pump"]').click();
gNos = await rootEl.locator("[data-asm-order]").evaluateAll((els) => els.map((e) => e.dataset.asmOrderNo));
ok(JSON.stringify(gNos) === JSON.stringify(["WO-G2"]), "幫浦測試只看 PV2R 幫浦單");
await rootEl.locator('[data-asm-line="all"]').click();
const g1 = orderCard(page, "WO-G1");
await g1.locator("[data-asm-report]").click();
ok(await g1.locator("[data-asm-defect-toggle]").count() === 1, "G01 測試站有「有不良品」");
await g1.locator("[data-asm-good]").fill("20");
await g1.locator("[data-asm-defect-toggle]").check();
await g1.locator("[data-asm-bad]").fill("2");
await g1.locator("[data-asm-submit]").click();
ok((await g1.locator("[data-asm-form-error]").innerText()).includes("不良原因"), "G01 有不良沒選原因 → 擋下（沒送出）");
ok(!st.reportSubmits.some((r) => r.p_expected_order_no === "WO-G1"), "擋下時沒有任何報工指令");
await g1.locator("[data-asm-reason]").selectOption("尺寸不良");
await g1.locator("[data-asm-submit]").click();
await g1.locator("[data-asm-ack]").waitFor();
ok((await g1.locator("[data-asm-ack]").innerText()).includes("不良比較多"), "預覽軟性提醒（不良比例高）→ 要人確認");
await page.screenshot({ path: path.join(shotDir, "04-g01-defect-soft-confirm.png"), fullPage: true });
await g1.locator("[data-asm-ack-confirm]").click();
await g1.locator("[data-asm-result].is-ok").waitFor();
const g1Final = st.reportSubmits.filter((r) => r.p_expected_order_no === "WO-G1" && r.p_preview === false).at(-1);
ok(g1Final.p_good_qty === 20 && g1Final.p_fail_qty === 2 && g1Final.p_fail_reason_code === "尺寸不良", "G01 不良 2 件＋原因 送出");
ok(JSON.stringify(g1Final.p_acks) === JSON.stringify(["HIGH_FAIL_RATIO"]) && g1Final.p_manufacture_ii_id === "MII-G1", "確認後正式報工帶 p_acks＝HIGH_FAIL_RATIO");
const g1Upsert = st.upserts.find((u) => u.p_payload?.process_id === id(304));
ok(g1Upsert?.p_payload.defect_qty === 2 && g1Upsert.p_payload.report_payload.fail_reason_code === "尺寸不良", "App 紀錄不良 2＋原因");
ok(g1Upsert.p_payload.report_payload.assembly_line === "valve", "G01 App 紀錄帶 assembly_line＝valve");

ok(errors.length === 0, "flag on: 沒有頁面錯誤");
ok(st.blocked.length === 0, "沒有連到任何外部網址（正式 Supabase 不會被碰到）");
await context.close();

// ---------------------------------------------------------------- 3. 越南文＋平板直式
{
  const st2 = makeState();
  const { context: c2, page: p2, errors: e2 } = await openApp(st2, `${baseConfig},assemblyReportEnabled:true,assemblyReportTenants:["${T}"],assemblyPollIntervalMs:50`, { viewport: { width: 800, height: 1280 }, lang: "vi" });
  const entry2 = p2.locator("#dashboardView [data-assembly-entry]");
  await entry2.waitFor({ state: "visible" });
  ok((await entry2.innerText()).includes("Báo công lắp ráp (F01)"), "vi：入口越南文");
  await entry2.click();
  await orderCard(p2, "WO-F1").waitFor();
  await orderCard(p2, "WO-F1").locator("[data-asm-report]").click();
  const text = await p2.locator("[data-assembly-root]").innerText();
  ok(text.includes("Gửi báo công") && text.includes("Lần này làm xong bao nhiêu") && text.includes("Tôi"), "vi：送出報工／這次完成幾件／我 皆有越南文");
  ok((await p2.locator("#assemblyTitle").innerText()).includes("Báo công trạm lắp ráp"), "vi：頁面標題越南文");
  ok(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "平板直式沒有橫向捲動");
  await p2.screenshot({ path: path.join(shotDir, "09-vi-tablet-report.png"), fullPage: true });
  ok(e2.length === 0 && st2.blocked.length === 0, "vi：沒有頁面錯誤、沒有外部連線");
  await c2.close();
}

await browser.close();
server.close();
console.log(`PASS: ${pass} assembly report browser assertions`);
