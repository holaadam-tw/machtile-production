import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const moduleUrl = process.env.MACHTILE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const playwright = await import(moduleUrl);
const { chromium } = playwright.default || playwright;

test("operator can switch machine card actions to Vietnamese and back while admin stays Chinese", async (t) => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    if (relative === "/config.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end('window.MACHTILE_CONFIG={authMode:"dev",useSupabase:false,disableServiceWorker:true,oauthEnabled:false,hmcFixedStagingEnabled:false};');
      return;
    }
    const file = path.join(root, relative);
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try {
      const body = await readFile(file);
      const ext = path.extname(file);
      res.writeHead(200, { "content-type": ext === ".js" ? "text/javascript; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
  await page.locator("#workOrderGrid .machine-report-button").first().waitFor({ timeout: 15000 });

  await page.selectOption("#machtileLanguageSelect", "vi");
  await page.waitForLoadState("domcontentloaded");
  await page.locator("#workOrderGrid .machine-report-button").first().waitFor();
  assert.equal(await page.locator("#workOrderGrid .machine-report-button").first().innerText(), "Báo cáo");
  assert.equal(await page.locator("html").getAttribute("lang"), "vi");
  assert.equal((await page.locator('[data-view="schedule"]').first().innerText()).trim(), "排程");

  await page.selectOption("#machtileLanguageSelect", "zh-Hant");
  await page.waitForLoadState("domcontentloaded");
  await page.locator("#workOrderGrid .machine-report-button").first().waitFor();
  assert.equal(await page.locator("#workOrderGrid .machine-report-button").first().innerText(), "報工");
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-Hant");
});
