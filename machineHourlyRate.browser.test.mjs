import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright");
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/config.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end("window.MACHTILE_CONFIG={authMode:'dev',useSupabase:false,disableServiceWorker:true};");
    return;
  }
  const file = path.resolve(root, `.${url.pathname === "/" ? "/index.html" : url.pathname}`);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("requestfailed", (request) => {
  if (!request.url().includes("/config.pages-dev.js")) errors.push(`REQUEST ${request.url()} ${request.failure()?.errorText || "failed"}`);
});

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(() => typeof openAdminModule), "function", `app loaded: ${errors.join(" | ")}`);
  await page.evaluate(() => {
    const machines = [...Array(11)].map((_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      machine_code: index < 5 ? `A0${index + 1}` : `B0${index - 4}`,
      name: `測試機台 ${index + 1}`,
      hourly_rate: index < 5 ? 300 : 480,
    }));
    window.__rateCalls = [];
    machtileAuthState.role = "admin";
    supabaseFetch = async (path, options = {}) => {
      if (path === "rpc/machine_hourly_rate_admin_snapshot") return {
        machines,
        history: [{ id: "h1", machine_code: "A01", actor_name: "測試管理員", old_rate: 250, new_rate: 300, changed_at: "2026-10-17T10:00:00Z" }],
      };
      if (path === "rpc/machine_hourly_rate_admin_set") {
        const body = JSON.parse(options.body); window.__rateCalls.push(body);
        machines[0].hourly_rate = body.p_hourly_rate;
        return { changed: true, machine_code: "A01" };
      }
      return [];
    };
    renderSettings();
    openAdminModule("hourlyRate");
  });
  await page.locator("[data-hourly-rate-row]").first().waitFor();
  assert.equal(await page.locator("[data-hourly-rate-row]").count(), 11, "all DB-returned machines render");
  assert.match(await page.locator(".machine-hourly-rate-history").innerText(), /250.*300.*測試管理員/s);
  const first = page.locator("[data-hourly-rate-row]").first();
  await first.locator("input").fill("0");
  await first.locator("button").click();
  assert.equal(await page.evaluate(() => window.__rateCalls.length), 0, "invalid zero never writes");
  await first.locator("input").fill("360.50");
  await first.locator("button").click();
  await page.waitForFunction(() => window.__rateCalls.length === 1);
  assert.equal(await page.evaluate(() => window.__rateCalls[0].p_hourly_rate), 360.5);

  await page.evaluate(() => { machtileAuthState.role = "manager"; closeAdminModule(); renderSettings(); openAdminModule("hourlyRate"); });
  assert.equal(await page.locator('[data-admin-module="hourlyRate"]').count(), 0, "manager has no hourly-rate entry");
  assert.equal(await page.locator("#adminModuleSheet").getAttribute("aria-hidden"), "true", "manager cannot force-open module");
  assert.deepEqual(errors, []);
  console.log("PASS machine hourly rate browser: DB-driven 11 rows, audit history, validation, save RPC, admin-only gate");
} finally {
  await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
}
