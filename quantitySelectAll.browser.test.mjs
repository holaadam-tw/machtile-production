import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const moduleUrl = process.env.MACHTILE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const imported = await import(moduleUrl);
const { chromium } = imported.default || imported;

async function openReportForm(page, origin) {
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.locator("#completedQty").waitFor({ state: "attached" });
  await page.evaluate(() => {
    const sheet = document.getElementById("reportSheet");
    sheet?.classList.add("is-open");
    sheet?.setAttribute("aria-hidden", "false");
    const good = document.getElementById("completedQty");
    good.value = "0";
    document.getElementById("reportNote").value = "原備註";
  });
}

test("report quantity focus replaces the value on desktop and touch without selecting notes", async (t) => {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/config.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end('window.MACHTILE_CONFIG={authMode:"dev",useSupabase:false,disableServiceWorker:true,oauthEnabled:false,hmcFixedStagingEnabled:false};');
      return;
    }
    const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
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
  const origin = `http://127.0.0.1:${server.address().port}`;

  const page = await browser.newPage();
  await openReportForm(page, origin);
  const good = page.locator("#completedQty");
  await good.click();
  await page.keyboard.type("5");
  assert.equal(await good.inputValue(), "5", "typing 5 must replace the initial 0");
  await good.click();
  await page.keyboard.type("12");
  assert.equal(await good.inputValue(), "12", "typing 12 must replace the previous 5");

  const note = page.locator("#reportNote");
  await note.click();
  assert.equal(await note.evaluate((el) => el.selectionStart === 0 && el.selectionEnd === el.value.length), false,
    "notes must not be automatically selected");
  await page.screenshot({ path: path.join(os.tmpdir(), "machtile-qty-select-desktop.png") });

  const touchContext = await browser.newContext({ hasTouch: true, viewport: { width: 820, height: 1180 } });
  t.after(() => touchContext.close());
  const touchPage = await touchContext.newPage();
  await openReportForm(touchPage, origin);
  const touchGood = touchPage.locator("#completedQty");
  await touchGood.tap();
  await touchPage.keyboard.type("5");
  assert.equal(await touchGood.inputValue(), "5", "touch typing must replace the initial 0");
  await touchGood.tap();
  await touchPage.keyboard.type("12");
  assert.equal(await touchGood.inputValue(), "12", "touch typing must replace the previous value");
  await touchPage.screenshot({ path: path.join(os.tmpdir(), "machtile-qty-select-touch.png") });

  console.log("PASS report quantity select-all: desktop 0→5→12, note unchanged, touch 0→5→12");
});
