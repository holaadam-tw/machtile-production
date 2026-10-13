import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const pw = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright");
const { chromium } = pw.default || pw;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.resolve(root, `.${url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname}`);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` }); res.end(body);
  } catch (_) { res.writeHead(404); res.end("not found"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}/`;
const API = "https://inspection-link-test.supabase.co";
const TENANT = "11111111-1111-4111-8111-111111111111";
const AUTH = "22222222-2222-4222-8222-222222222222";
const APP_USER = "44444444-4444-4444-8444-444444444444";
const PROCESS = "55555555-5555-4555-8555-555555555555";
const WORK_ORDER = "66666666-6666-4666-8666-666666666666";
const MACHINE = "77777777-7777-4777-8777-777777777777";
const id = (n) => `88888888-8888-4888-8888-${String(n).padStart(12, "0")}`;
const cards = [
  { id: WORK_ORDER, tenant_id: TENANT, work_order_no: "WO 100/甲", part_name: "測試工件", quantity: 10, due_date: "2026-10-31", current_process_id: PROCESS, current_process_name: "精銑 & 去毛邊", current_process_status: "running", machine_name: "A04", qty_completed: 2 },
  { id: id(2), tenant_id: TENANT, work_order_no: "WO-B01", part_name: "旗標外工件", quantity: 5, due_date: "2026-10-31", current_process_id: id(3), current_process_name: "研磨", current_process_status: "pending", machine_name: "B01", qty_completed: 0 },
];
const machines = [
  { id: MACHINE, machine_id: MACHINE, machine_code: "A04", machine_name: "A04", machine_type: "lathe", location: "第一廠", status: "running", display_order: 1 },
  { id: id(4), machine_id: id(4), machine_code: "B01", machine_name: "B01", machine_type: "mill", location: "第二廠", status: "idle", display_order: 2 },
];
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${b64({ alg: "HS256" })}.${b64({ sub: AUTH, email: "operator@test.invalid", exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: TENANT, role: "operator" } })}.sig`;
const config = `window.MACHTILE_CONFIG={authMode:"strict",supabaseUrl:"${API}",supabaseAnonKey:"test-key",tenantId:"${TENANT}",useSupabase:true,useTenantHeaderAuth:true,oauthEnabled:false,disableServiceWorker:true,enableOutboxSubmit:false,enableScheduleContracts:false,enableCalibrationGovernance:false,enableManufacturingQuoteTracking:false,useHmcWorklistSupabase:false,hmcFixedStagingEnabled:false,inspectionLinkMachines:["A04"],inspectionLinkBaseUrl:"https://holaadam-tw.github.io/I-Reporter/",stationCommandMachines:[]};`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 800, height: 900 }, serviceWorkers: "block" });
const blocked = [];
try {
  await context.addInitScript(([jwt]) => sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: jwt, refreshToken: "", email: "operator@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 })), [token]);
  await context.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (req.url().startsWith(base)) {
      if (url.pathname.endsWith("/config.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: config });
      return route.continue();
    }
    if (req.url().startsWith(API)) {
      const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/auth/v1/user") return json({ id: AUTH, email: "operator@test.invalid" });
      if (url.pathname === "/rest/v1/app_users" && url.searchParams.has("auth_user_id")) return json([{ id: APP_USER, name: "王小明" }]);
      if (url.pathname === "/rest/v1/v_work_order_cards") return json(cards);
      if (url.pathname === "/rest/v1/v_machine_management_cards") return json(machines);
      if (url.pathname === "/rest/v1/work_order_processes" && (url.searchParams.get("select") || "").includes("work_orders!inner")) return json(cards.map((card) => ({
        id: card.current_process_id, tenant_id: card.tenant_id, process_order: 1,
        process_name: card.current_process_name, process_type: "cnc", status: card.current_process_status,
        off_station_at: null, qty_completed: card.qty_completed, queue_order: null,
        work_orders: { id: card.id, work_order_no: card.work_order_no, part_no: null, part_name: card.part_name, quantity: card.quantity, due_date: card.due_date, status: "not_started" },
        machines: { id: machines.find((machine) => machine.machine_code === card.machine_name).id, machine_code: card.machine_name },
      })));
      if (url.pathname === "/rest/v1/rpc/machine_department_context") return json({ tenant_id: TENANT, role: "operator", is_bridge: false, all_departments: true, department_codes: ["LATHE", "MILL"] });
      return json(url.pathname.startsWith("/rest/v1/") ? [] : {});
    }
    if (url.origin === "https://holaadam-tw.github.io") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>I-Reporter test</title>" });
    blocked.push(req.url()); return route.abort();
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".machine-tile-card h2", { hasText: "A04" }).waitFor({ timeout: 20000 });
  const card = (code) => page.locator(".machine-tile-card").filter({ has: page.locator("h2", { hasText: code }) });
  const link = card("A04").locator(".machine-inspection-link");
  const diagnostic = await page.evaluate(() => ({ machines: config.inspectionLinkMachines, hasCore: Boolean(window.MachTileInspectionLinkCore), appUserId: machtileAuthState.appUserId, cards: [...document.querySelectorAll(".machine-tile-card h2")].map((el) => el.textContent), state: state.machines.map((m) => ({ code: m.code, name: m.name, order: m.order?.id })) }));
  assert.equal(await link.count(), 1, JSON.stringify(diagnostic));
  assert.equal(await link.getAttribute("target"), "_blank");
  assert.equal(await link.getAttribute("rel"), "noopener");
  assert.equal(await card("B01").locator(".machine-inspection-link").count(), 0);
  const popupPromise = page.waitForEvent("popup"); await link.click();
  const popup = await popupPromise; await popup.waitForLoadState("domcontentloaded");
  const opened = new URL(popup.url());
  const expected = { tab: "process_record", wo_id: WORK_ORDER, wo: "WO 100/甲", process_id: PROCESS, process: "N1 精銑 & 去毛邊", machine_id: MACHINE, machine: "A04 第一廠", operator_id: APP_USER, operator: "王小明", return_url: "https://app.machtile.com/" };
  assert.equal(`${opened.origin}${opened.pathname}`, "https://holaadam-tw.github.io/I-Reporter/");
  for (const [key, value] of Object.entries(expected)) assert.equal(opened.searchParams.get(key), value, key);
  assert.notEqual(opened.searchParams.get("operator_id"), AUTH, "Auth/JWT subject must not be operator_id");
  const unresolvedHref = await page.evaluate(() => {
    machtileAuthState.appUserId = ""; machtileAuthState.appUserName = "";
    const machine = state.machines.find((item) => item.code === "A04");
    const holder = document.createElement("div"); holder.innerHTML = machtileInspectionLinkMarkup(machine, machine.order);
    return holder.querySelector("a")?.href || "";
  });
  const unresolved = new URL(unresolvedHref);
  assert.equal(unresolved.searchParams.has("operator_id"), false, "unresolved app user does not fall back to Auth UUID");
  assert.equal(unresolved.searchParams.has("operator"), false, "unresolved display name is not presented as identity");
  assert.equal(errors.length, 0, errors.join(" | "));
  assert.equal(blocked.some((url) => /muditjubqflrqofbkmav|app\.machtile\.com/.test(url)), false);
  console.log("PASS real app.js machine-card integration opens the correct I-Reporter URL");
} finally { await context.close(); await browser.close(); server.close(); }
