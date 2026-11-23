import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const base = childProcess.execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: root, encoding: "utf8" }).trim();
const baseFiles = new Map(["index.html", "app.js", "config.js"].map((file) => [file, childProcess.execFileSync("git", ["show", `${base}:${file}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 })]));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const relative = new URL(req.url, "http://localhost").pathname.replace(/^\//, "") || "index.html";
  try { const body = await readFile(path.join(root, relative)); res.writeHead(200, { "Content-Type": mime[path.extname(relative)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const mod = await import(pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE || "D:/04_SoftNet/temp-playwright-deps-20261008/node_modules/playwright/index.mjs").href);
const { chromium } = mod.default || mod;
const browser = await chromium.launch();

async function open(useBase) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const capabilityRequests = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("machtile_get_machine_capabilities")) capabilityRequests.push(url.href);
    const relative = url.pathname.replace(/^\//, "") || "index.html";
    if (relative === "config.js") return route.fulfill({ contentType: mime[".js"], body: "window.MACHTILE_CONFIG={useSupabase:false,disableServiceWorker:true,enableMachineCapabilityDualRead:false};" });
    if (useBase && baseFiles.has(relative)) return route.fulfill({ contentType: mime[path.extname(relative)], body: baseFiles.get(relative) });
    return route.fallback();
  });
  const page = await context.newPage();
  await page.addInitScript(() => { const fixed = 1795017600000; Date.now = () => fixed; });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid article").length > 0);
  const dom = await page.evaluate(() => { const body = document.body.cloneNode(true); body.querySelectorAll("script, #appUpdateCard").forEach((node) => node.remove()); return body.innerHTML.replace(/\n\s*\n/g, "\n").trimEnd(); });
  return { context, dom, capabilityRequests };
}

try {
  const baseline = await open(true);
  const current = await open(false);
  if (current.dom !== baseline.dom) {
    let at = 0; while (current.dom[at] === baseline.dom[at]) at += 1;
    throw new Error(`flag-off DOM differs at ${at}: current=${JSON.stringify(current.dom.slice(at - 80, at + 120))} baseline=${JSON.stringify(baseline.dom.slice(at - 80, at + 120))}`);
  }
  assert.deepEqual(current.capabilityRequests, [], "flag off makes zero capability RPC requests");
  await baseline.context.close(); await current.context.close();
} finally {
  await browser.close(); await new Promise((resolve) => server.close(resolve));
}
console.log("PASS machine capability flag-off DOM and zero-network assertions");
