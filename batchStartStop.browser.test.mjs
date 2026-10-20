import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { assignedCardFixture } from "./assignedCardFixture.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright");
const { chromium } = mod.default || mod;
let pass = 0;
const ok = (value, label) => { if (!value) throw new Error(label); pass += 1; console.log(`PASS ${label}`); };
const appSource = await readFile(path.join(root, "app.js"), "utf8");
const sharedCalls = appSource.match(/machtileStationCmdRunSubmission\s*\(\s*\{/g) || [];
ok(sharedCalls.length === 4 && (appSource.match(/rpc\/\$\{core\.SUBMIT_RPC\}/g) || []).length === 1,
  "single-machine and batch paths share one submit lifecycle helper");
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname === "/" ? "/index.html" : new URL(req.url, "http://localhost").pathname;
  try { const body = await readFile(path.join(root, decodeURIComponent(pathname))); res.writeHead(200); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const FAKE = "https://fake-supabase.test";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = { id: id(901), name: "測試員", legacy_user_id: "1080301", auth: id(801) };
const card = (code, n) => ({ id: id(100 + n), tenant_id: T, work_order_no: `WO-${code}`, part_name: "測試品", quantity: 10,
  work_order_status: "in_progress", current_process_id: id(300 + n), current_process_name: "加工", current_process_status: "running",
  machine_name: code, qty_completed: 0, qty_defect: 0, progress_percent: 0, current_process_off_station: false });
const cards = [card("A04", 4), card("A05", 5), card("B03", 13)];
const machines = ["A01", "A02", "A03", "A04", "A05", "B03", "B04", "B05", "B06"].map((code, n) => ({ id: id(200 + n), machine_code: code, machine_name: code, status: "idle", display_order: n }));
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = `${b64({ alg: "HS256" })}.${b64({ sub: user.auth, exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const config = `window.MACHTILE_CONFIG={authMode:"strict",supabaseUrl:"${FAKE}",supabaseAnonKey:"test",tenantId:"${T}",useSupabase:true,useTenantHeaderAuth:true,stationCommandMachines:["A04","A05","B03"],disableServiceWorker:true};`;
const calls = [];
let a05Attempts = 0;
const stationRows = ["A04", "A05", "B03"].map((machine_code) => ({ machine_code, command_type: "stop", status: "applied", requested_at: "2026-10-14T00:00:00Z", applied_at: "2026-10-14T00:00:00Z" }));
async function fake(route) {
  const req = route.request(); const url = new URL(req.url()); const p = url.pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (p.startsWith("/auth/v1/user")) return json({ id: user.auth });
  if (p.endsWith("/rpc/machine_department_context")) return json({ tenant_id: T, role: "operator", is_bridge: false, all_departments: false, department_codes: ["LATHE"] });
  if (p.endsWith("/v_work_order_cards")) return json(cards);
  if (p.endsWith("/v_machine_management_cards")) return json(machines);
  if (p.endsWith("/app_users")) return json(url.searchParams.has("auth_user_id") ? [user] : [user]);
  if (p.endsWith("/work_order_processes") && url.searchParams.get("id")?.startsWith("eq.")) {
    const pid = url.searchParams.get("id").slice(3); const found = cards.find((x) => x.current_process_id === pid);
    return json(found ? [{ id: pid, process_order: 1, process_name: "加工", status: "running", off_station_at: null,
      work_orders: { work_order_no: found.work_order_no, part_no: `P-${found.machine_name}`, part_name: found.part_name, status: "in_progress" }, machines: { machine_code: found.machine_name } }] : []);
  }
  if (p.endsWith("/work_order_processes") && (url.searchParams.get("select") || "").includes("work_orders!inner")) return json(assignedCardFixture(cards, machines));
  if (p.endsWith("/rpc/batch_report_progress")) return json([]);
  if (p.endsWith("/production_reports")) return json([]);
  if (p.endsWith("/station_commands")) return json(url.searchParams.has("limit") ? [] : stationRows);
  if (p.endsWith("/rpc/machtile_submit_station_command")) {
    const body = JSON.parse(req.postData() || "{}"); calls.push(body);
    if (body.p_machine_code === "A05" && ++a05Attempts === 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return json({ command_uuid: body.p_command_uuid, command_type: body.p_command_type, status: "pending", requested_at: new Date().toISOString() });
  }
  if (p.includes("/rest/v1/")) return json([]);
  return json({});
}

const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 412, height: 915 } });
await context.addInitScript((token) => sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", mode: "session", createdAt: Date.now() })), jwt);
await context.route("**/*", (route) => route.request().url().startsWith(FAKE) ? fake(route)
  : route.request().url().startsWith(base) && new URL(route.request().url()).pathname.endsWith("/config.js")
    ? route.fulfill({ status: 200, contentType: "text/javascript", body: config }) : route.continue());
const page = await context.newPage();
page.on("dialog", (dialog) => dialog.accept());
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"));
await page.evaluate(() => { window.MachTileStationCommandCore.SUBMIT_TIMEOUT_MS = 30; });
await page.locator('.mobile-tab[data-view="batchLathe"]').click();
const panel = page.locator('[data-batch-root="lathe"] [data-batch-command-panel]');
await panel.waitFor();
ok(await panel.locator('[data-batch-command-select="B03"]').count() === 0, "department gate keeps mill machines out of lathe batch entry");
ok(await panel.locator('[data-batch-command-select="A04"]').isChecked() && await panel.locator('[data-batch-command-select="A05"]').isChecked(), "stopped machines with orders are preselected for start");
await panel.locator('[data-batch-command-type="stop"]').click();
ok(await panel.locator('[data-batch-command-select="A04"]').isDisabled() && !(await panel.locator('[data-batch-command-select="A04"]').isChecked()), "stopped machine is disabled and not selected for stop");
await panel.locator('[data-batch-command-type="start"]').click();
await panel.locator('[data-batch-command-submit]').click();
await page.waitForFunction(() => document.querySelectorAll("[data-batch-command-result]").length === 2);
ok(calls.length === 2 && calls.every((x) => x.p_command_type === "start" && x.p_expected_index_sn === 1 && x.p_expected_order_no === `WO-${x.p_machine_code}`), "each machine uses shared station-command RPC parameters");
ok((await panel.locator('[data-batch-command-result="A04"]').innerText()).startsWith("成功：") && (await panel.locator('[data-batch-command-result="A05"]').innerText()).startsWith("失敗："), "timeout is shown per machine in Chinese");
ok(await panel.locator('[data-batch-command-select="A04"]').isDisabled() && !(await panel.locator('[data-batch-command-select="A04"]').isChecked())
  && await panel.locator('[data-batch-command-submit]').isDisabled(), "pending machines stay locked and cannot be selected or submitted again");
await panel.locator('[data-batch-command-submit]').evaluate((button) => button.click());
await page.waitForTimeout(100);
ok(calls.filter((x) => x.p_machine_code === "A04").length === 1, "pressing batch start again while pending cannot create a second UUID");
const timedOutUuid = calls.find((x) => x.p_machine_code === "A05").p_command_uuid;
ok(await panel.locator('[data-batch-command-select="A05"]').isDisabled() && await panel.locator('[data-batch-command-retry="A05"]').isVisible(), "timed-out machine is locked but offers same-command retry");
await panel.locator('[data-batch-command-retry="A05"]').click();
await page.waitForFunction(() => document.querySelector('[data-batch-command-result="A05"]')?.textContent.startsWith("成功："));
const a05Calls = calls.filter((x) => x.p_machine_code === "A05");
ok(a05Calls.length === 2 && a05Calls[0].p_command_uuid === timedOutUuid && a05Calls[1].p_command_uuid === timedOutUuid,
  "timeout retry reuses the same UUID");
await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
console.log(`PASS: ${pass} batch start/stop browser assertions`);
