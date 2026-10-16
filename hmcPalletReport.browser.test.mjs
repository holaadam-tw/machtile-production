import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright");
const { chromium } = mod.default || mod;
let pass = 0;
const ok = (value, label) => { if (!value) throw new Error(label); pass += 1; console.log(`PASS ${label}`); };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
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
const authId = id(801), userId = id(901), worklistId = id(100), pallet1 = id(101), pallet2 = id(102), item1 = id(201), item2 = id(202);
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = `${b64({ alg: "HS256" })}.${b64({ sub: authId, email: "op@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const config = `window.MACHTILE_CONFIG={authMode:"strict",supabaseUrl:"${FAKE}",supabaseAnonKey:"test",tenantId:"${T}",useSupabase:true,useTenantHeaderAuth:true,enableHmcPalletReport:true,hmcFixedStagingEnabled:false,disableServiceWorker:true};`;
const worklist = [{ id: worklistId, tenant_id: T, machine_code: "B01", shift_scope: "day", status: "active", work_date_start: "2026-10-15", work_date_end: null, version_no: 1, updated_at: new Date(now).toISOString(), created_at: new Date(now).toISOString() }];
const pallets = [
  { id: pallet1, tenant_id: T, worklist_id: worklistId, pallet_no: 1, sort_order: 1, fixture_name: "FIX-1" },
  { id: pallet2, tenant_id: T, worklist_id: worklistId, pallet_no: 2, sort_order: 2, fixture_name: "FIX-2" },
];
const items = [
  { id: item1, tenant_id: T, worklist_id: worklistId, pallet_id: pallet1, pallet_no: 1, sort_order: 1, position_code: "A", work_order_no: "WO-1", workpiece_name: "PART-1", operation_name: "OP-1", operation_id: id(301), planned_qty: 10, completed_qty_before: 0, remaining_qty_snapshot: 10, material_status: "ready", status: "active" },
  { id: item2, tenant_id: T, worklist_id: worklistId, pallet_id: pallet2, pallet_no: 2, sort_order: 2, position_code: "B", work_order_no: "WO-2", workpiece_name: "PART-2", operation_name: "OP-2", operation_id: id(302), planned_qty: 10, completed_qty_before: 0, remaining_qty_snapshot: 10, material_status: "ready", status: "active" },
];
const rpcCalls = [];
const blocked = [];
async function fake(route) {
  const req = route.request(); const url = new URL(req.url()); const p = url.pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (p.startsWith("/auth/v1/user")) return json({ id: authId, email: "op@test.invalid" });
  if (p.endsWith("/rpc/machine_department_context")) return json({ tenant_id: T, role: "operator", is_bridge: false, all_departments: true, department_codes: [] });
  if (p.endsWith("/v_machine_management_cards")) return json([{ id: id(10), machine_code: "B01", machine_name: "B01", machine_type: "臥式加工中心", status: "running", display_order: 1 }]);
  if (p.endsWith("/v_work_order_cards")) return json([]);
  if (p.endsWith("/work_order_processes")) return json([]);
  if (p.endsWith("/app_users")) return json([{ id: userId, tenant_id: T, auth_user_id: authId, name: "Operator", is_active: true }]);
  if (p.endsWith("/hmc_shift_worklists")) return json(worklist);
  if (p.endsWith("/hmc_worklist_pallets")) return json(pallets);
  if (p.endsWith("/hmc_worklist_items")) return json(items);
  if (p.endsWith("/hmc_daily_worklist_item_quantities")) return json([]);
  if (p.endsWith("/rpc/hmc_submit_pallet_reports")) { rpcCalls.push(JSON.parse(req.postData() || "{}")); return json({ report_count: 2, completed_qty: 7, defect_qty: 2, released_position_count: 0 }); }
  if (p.includes("/rest/v1/")) return json([]);
  return json({});
}

const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: "block" });
await context.addInitScript((token) => sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", mode: "session", createdAt: Date.now() })), jwt);
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith(FAKE)) return fake(route);
  if (url.startsWith(base)) return new URL(url).pathname.endsWith("/config.js") ? route.fulfill({ status: 200, contentType: "text/javascript", body: config }) : route.continue();
  blocked.push(url); return route.abort();
});
const page = await context.newPage();
page.on("pageerror", (error) => console.error("PAGEERROR", error.message));
await page.goto(`${base}?route=/m/hmc-report&machine=B01&shift=day&worklistSource=db`, { waitUntil: "domcontentloaded" });
await page.locator("#hmcReportRoute").waitFor();
// /m routes deliberately skip the dashboard data boot. Seed the same verified
// machine/source state that the production shell supplies before exercising UI behavior.
await page.evaluate(() => {
  state.source = "supabase";
  state.machineMasters = [{ code: "B01", machine_code: "B01", machine_type: "臥式加工中心", type: "臥式加工中心" }];
  renderHmcReportRoute();
});
await page.locator("[data-hmc-submit-pallet-report]").waitFor();
await page.locator(`[data-hmc-pallet-work="${pallet2}"]`).click();
const qty = page.locator(".hmc-selected-qty");
const bad = page.locator(".hmc-selected-defect-qty");
await qty.nth(0).fill("3");
await qty.nth(1).fill("4");
await bad.nth(0).fill("2");
ok(await page.locator("[data-hmc-pallet-fail-reason-field]").isVisible(), "defect input reveals the HMC fail-reason selector");
await page.locator("[data-hmc-submit-pallet-report]").click();
ok(rpcCalls.length === 0, "missing reason blocks HMC RPC submission");
ok((await page.locator('.hmc-pallet-report-submit [role="status"]').innerText()).includes("選擇不良原因"), "missing reason displays the required validation message");
await page.locator("[data-hmc-pallet-fail-reason]").selectOption({ label: "其他" });
await page.locator("[data-hmc-submit-pallet-report]").click();
ok(rpcCalls.length === 0, "Other without a note blocks HMC RPC submission");
ok((await page.locator('.hmc-pallet-report-submit [role="status"]').innerText()).includes("備註"), "Other without a note displays the note validation message");
await page.locator("[data-hmc-pallet-fail-reason]").selectOption({ label: "尺寸不良" });
const rpcRequest = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/rpc/hmc_submit_pallet_reports"));
await page.locator("[data-hmc-submit-pallet-report]").click();
await rpcRequest;
await page.waitForTimeout(100);
ok(rpcCalls.length === 1, "valid HMC reason submits exactly one RPC request");
const payload = rpcCalls[0];
ok(payload.p_worklist_id === worklistId && payload.p_report_type === "noon" && payload.p_finish_scope === null, "HMC RPC header matches the active worklist and report action");
ok(payload.p_items.length === 2, "multi-pallet selection sends both selected worklist items");
const byId = Object.fromEntries(payload.p_items.map((item) => [item.worklist_item_id, item]));
ok(byId[item1].completed_qty === 3 && byId[item1].defect_qty === 2 && byId[item1].fail_reason_code === "尺寸不良", "defective pallet item carries quantity and fail_reason_code");
ok(byId[item2].completed_qty === 4 && byId[item2].defect_qty === 0 && byId[item2].fail_reason_code === null, "non-defective pallet item carries quantity and null fail_reason_code");
ok(blocked.length === 0, "browser contacted no production or external host");
await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
console.log(`PASS: ${pass} HMC multi-pallet browser assertions`);
