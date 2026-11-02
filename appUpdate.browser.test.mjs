import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const moduleUrl = process.env.MACHTILE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const imported = await import(moduleUrl);
const { chromium } = imported.default || imported;

test("version update stays silent when current, defers while busy, then reloads on click", async (t) => {
  let deployedVersion = "20261103-update-toast-r1";
  let indexRequests = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/__version/r2") {
      deployedVersion = "20261103-update-toast-r2";
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === "/version.json") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ version: deployedVersion }));
      return;
    }
    if (url.pathname === "/config.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end('window.MACHTILE_CONFIG={authMode:"dev",useSupabase:false,disableServiceWorker:true,oauthEnabled:false,hmcFixedStagingEnabled:false};');
      return;
    }
    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    if (relative === "/index.html") indexRequests += 1;
    const file = path.resolve(root, `.${relative}`);
    if (!file.startsWith(`${root}${path.sep}`)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      const type = path.extname(file) === ".js" ? "text/javascript" : path.extname(file) === ".css" ? "text/css" : "text/html";
      res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
      res.end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.MachTileAppUpdate));

  await page.evaluate(() => window.MachTileAppUpdate.check());
  assert.equal(await page.locator("#appUpdateCard").isHidden(), true, "same version must stay hidden");

  await page.request.get(`${origin}/__version/r2`);
  await page.evaluate(() => {
    const sheet = document.getElementById("reportSheet");
    sheet.classList.add("is-open");
    sheet.setAttribute("aria-hidden", "false");
  });
  await page.evaluate(() => window.MachTileAppUpdate.check());
  assert.equal(await page.locator("#appUpdateCard").isHidden(), true, "busy dialog must defer the prompt");

  await page.evaluate(() => {
    const sheet = document.getElementById("reportSheet");
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    window.MachTileAppUpdate.present();
  });
  await page.locator("#appUpdateCard").waitFor({ state: "visible" });
  assert.equal((await page.locator("#appUpdateCard strong").innerText()).trim(), "有新版本");

  await page.evaluate(() => {
    const sheet = document.getElementById("reportSheet");
    sheet.classList.add("is-open");
    sheet.setAttribute("aria-hidden", "false");
  });
  await page.locator("#appUpdateButton").click();
  await page.waitForTimeout(100);
  assert.equal(indexRequests, 1, "update click must not reload after a dialog becomes busy");
  assert.equal(await page.locator("#appUpdateCard").isHidden(), true);

  await page.evaluate(() => {
    const sheet = document.getElementById("reportSheet");
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    window.MachTileAppUpdate.present();
  });
  await page.locator("#appUpdateCard").waitFor({ state: "visible" });

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("#appUpdateButton").click(),
  ]);
  assert.equal(indexRequests, 2, "idle update click must reload exactly once");
  assert.equal(new URL(page.url()).pathname, "/", "update button must reload the current page");
});
