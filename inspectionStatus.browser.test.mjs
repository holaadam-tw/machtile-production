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
  try { const body = await readFile(file); res.writeHead(200, { "Content-Type": `${{ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "application/octet-stream"}; charset=utf-8` }); res.end(body); }
  catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}/`, API = "https://inspection-status-test.supabase.co";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TENANT = uuid(1), AUTH = uuid(2), APP_USER = uuid(3);
const specs = [
  ["A01", "pass", "今日已檢驗 15:42"], ["A02", "fail", "今日檢驗異常 16:01"],
  ["A03", "skipped", "今日免檢"], ["A04", null, "今日未檢驗"], ["A05", "conditional_pass", "今日已檢驗 16:20"],
];
const machines = specs.map(([code], i) => ({ id: uuid(100 + i), machine_id: uuid(100 + i), machine_code: code, machine_name: code, machine_type: "lathe", status: "running", display_order: i + 1 }));
const cards = specs.map(([code], i) => ({ id: uuid(200 + i), tenant_id: TENANT, work_order_no: `WO-${code}`, part_name: `Part ${code}`, quantity: 10, due_date: "2026-10-31", current_process_id: uuid(300 + i), current_process_name: "CNC", current_process_status: "running", machine_name: code, qty_completed: 1 }));
const inspections = specs.flatMap(([code, result], i) => result ? [{ work_order_id: cards[i].id, process_id: cards[i].current_process_id, machine_id: machines[i].id, result, inspected_at: ({ A01: "2026-10-13T07:42:00Z", A02: "2026-10-13T08:01:00Z", A03: "2026-10-13T08:10:00Z", A05: "2026-10-13T08:20:00Z" })[code] }] : []);
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${b64({ alg: "HS256" })}.${b64({ sub: AUTH, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: TENANT, role: "operator" } })}.sig`;

async function runCase({ failRead = false } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: "block" });
  let inspectionRequests = 0;
  try {
    await context.addInitScript(([jwt]) => sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: jwt, mode: "session", createdAt: Date.now() })), [token]);
    await context.addInitScript(() => {
      const NativeDate = Date, fixed = new NativeDate("2026-10-13T09:00:00Z").getTime();
      globalThis.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [fixed])); }
        static now() { return fixed; }
      };
    });
    await context.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (req.url().startsWith(base)) {
        if (url.pathname.endsWith("/config.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: `window.MACHTILE_CONFIG={authMode:"strict",supabaseUrl:"${API}",supabaseAnonKey:"test",tenantId:"${TENANT}",useSupabase:true,useTenantHeaderAuth:true,oauthEnabled:false,disableServiceWorker:true,enableScheduleContracts:false,useHmcWorklistSupabase:false,hmcFixedStagingEnabled:false,inspectionLinkMachines:["A01","A02","A03","A04","A05"],inspectionLinkBaseUrl:"https://holaadam-tw.github.io/I-Reporter/",stationCommandMachines:[]};` });
        return route.continue();
      }
      if (!req.url().startsWith(API)) return route.abort();
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/auth/v1/user") return json({ id: AUTH });
      if (url.pathname === "/rest/v1/app_users" && url.searchParams.has("auth_user_id")) return json([{ id: APP_USER, name: "Operator" }]);
      if (url.pathname === "/rest/v1/v_work_order_cards") return json(cards);
      if (url.pathname === "/rest/v1/v_machine_management_cards") return json(machines);
      if (url.pathname === "/rest/v1/work_order_processes" && (url.searchParams.get("select") || "").includes("work_orders!inner")) return json(cards.map((card, i) => ({ id: card.current_process_id, tenant_id: TENANT, process_order: 1, process_name: "CNC", process_type: "cnc", status: "running", qty_completed: 1, work_orders: { id: card.id, work_order_no: card.work_order_no, part_name: card.part_name, quantity: 10, due_date: card.due_date, status: "in_progress" }, machines: { id: machines[i].id, machine_code: machines[i].machine_code } })));
      if (url.pathname === "/rest/v1/rpc/machine_department_context") return json({ tenant_id: TENANT, role: "operator", is_bridge: false, all_departments: true, department_codes: ["LATHE"] });
      if (url.pathname === "/rest/v1/process_inspections") { inspectionRequests += 1; return failRead ? json({ message: "mock failure" }, 503) : json(inspections); }
      return json(url.pathname.startsWith("/rest/v1/") ? [] : {});
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.locator(".machine-inspection-status").first().waitFor({ timeout: 20000 });
    const statusText = async (code) => page.locator(".machine-tile-card").filter({ has: page.locator("h2", { hasText: code }) }).locator(".machine-inspection-status").innerText();
    if (failRead) {
      for (const [code] of specs) assert.equal(await statusText(code), "檢驗狀態讀取失敗");
      assert.equal(await page.getByText("今日未檢驗", { exact: true }).count(), 0, "read failure is never shown as missing");
    } else {
      for (const [code, , expected] of specs) assert.equal(await statusText(code), expected, code);
      await page.locator('[data-view="alerts"]').first().click();
      assert.equal(await page.locator("#alertList").getByText("WO-A04", { exact: true }).count(), 1, "after-cutoff missing inspection appears in the all-attention list");
      assert.match(await page.locator('[data-alert-filter="全部"] span').innerText(), /[1-9]/, "all-attention count includes inspection attention");
      await page.locator('[data-view="dashboard"]').first().click();
      const failButton = page.locator(".machine-inspection-status.is-fail");
      await failButton.click();
      assert.equal(await page.locator("#alertsView").evaluate((node) => node.classList.contains("is-active")), true, "fail links to the attention center");
      assert.equal(await page.locator('#alertChips [data-alert-filter="異常"]').evaluate((node) => node.classList.contains("active")), true, "fail selects the abnormal filter");
      const focusedFail = page.locator('[data-alert-card-order="WO-A02"]');
      assert.equal(await focusedFail.count(), 1, "the abnormal list contains the selected failed-inspection order");
      await assert.doesNotReject(() => focusedFail.scrollIntoViewIfNeeded(), "the failed-inspection order can be located");
      assert.equal(await page.evaluate(() => MachTileInspectionStatusCore.taipeiDate("2026-10-13T16:00:00Z")), "2026-10-14", "browser core handles Taipei midnight");
    }
    assert.equal(inspectionRequests, 1, "one batch request serves all enabled cards");
    assert.equal(errors.length, 0, errors.join(" | "));
  } finally { await context.close(); await browser.close(); }
}

try { await runCase(); await runCase({ failRead: true }); console.log("PASS inspection status browser integration: pass/fail/skipped/missing/read-failure/midnight"); }
finally { server.close(); }



