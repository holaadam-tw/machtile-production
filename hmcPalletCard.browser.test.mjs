import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const files = ["index.html", "app.js", "i18n.js", "styles.css"];
const baseFiles = new Map(files.map((file) => [file, childProcess.execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 })]));
const mod = await import(pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE || "D:/04_SoftNet/temp-playwright-deps-20261008/node_modules/playwright/index.mjs").href);
const { chromium } = mod.default || mod;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const relative = new URL(req.url, "http://localhost").pathname.replace(/^\//, "") || "index.html";
  try { const body = await readFile(path.join(root, relative)); res.writeHead(200, { "Content-Type": mime[path.extname(relative)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
async function open(base, { flag = false, rpc = null } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    const relative = url.pathname.replace(/^\//, "") || "index.html";
    if (relative === "config.js") return route.fulfill({ contentType: "text/javascript", body: `window.MACHTILE_CONFIG={useSupabase:false,disableServiceWorker:true,enableHmcPalletCard:${flag},hmcPalletCardMachines:["CNC-01"],supabaseUrl:"http://127.0.0.1:${server.address().port}",supabaseAnonKey:"fake"};` });
    if (url.pathname.endsWith("/rest/v1/rpc/hmc_pallet_card_read")) {
      if (rpc instanceof Error) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: rpc.message }) });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(rpc) });
    }
    if (base && baseFiles.has(relative)) return route.fulfill({ contentType: mime[path.extname(relative)], body: baseFiles.get(relative) });
    return route.fallback();
  });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid article").length > 0);
  return { context, page, errors };
}
const dom = (page) => page.evaluate(() => { const body = document.body.cloneNode(true); body.querySelectorAll("script, #appUpdateCard").forEach((node) => node.remove()); return body.innerHTML.replace(/\n\s*\n/g, "\n").trimEnd(); });
try {
  const before = await open(true), after = await open(false);
  assert.equal(await dom(after.page), await dom(before.page), "flag off keeps the machine-card body DOM byte-identical to HEAD");
  assert.equal(await after.page.locator("[data-hmc-pallet-card]").count(), 0, "flag off renders no pallet-card node");
  assert.deepEqual(after.errors, [], "flag-off page has no browser errors");
  const mapped = await after.page.evaluate(() => window.MachTileHmcPalletCardCore.mapOrdersToPallets(
    [{ order: { id: "WO-1", partNo: "A" } }, { order: { id: "WO-2", partNo: "B" } }, { order: { id: "WO-X", partNo: "X" } }],
    [{ palletNo: 1, slots: [{ part: { partNo: "A" } }, { part: { partNo: "B" } }] }, { palletNo: 2, slots: [{ part: { partNo: "X" } }] }, { palletNo: 4, slots: [{ part: { partNo: "X" } }] }]
  ));
  assert.deepEqual(mapped.pallets[0].orders.map((x) => x.order.id), ["WO-1", "WO-2"], "browser maps several parts to one pallet");
  assert.deepEqual(mapped.unmatched.map((x) => x.order.id), ["WO-X"], "browser does not guess a duplicated pallet match");
  await before.context.close(); await after.context.close();

  const success = await open(false, { flag: true, rpc: { ok: true, machine_code: "CNC-01", pallets: [
    { pallet_no: 1, parts: ["SS-BUSH-118", "EXTRA-PART"] },
    { pallet_no: 2, parts: [] }, { pallet_no: 3, parts: [] }, { pallet_no: 4, parts: [] }, { pallet_no: 5, parts: [] }, { pallet_no: 6, parts: [] },
  ] } });
  const card = success.page.locator('[data-hmc-pallet-card="CNC-01"]');
  await card.locator('[data-hmc-pallet="1"]').waitFor();
  assert.doesNotMatch(await card.locator('[data-hmc-pallet="1"]').textContent(), /尚未登錄/, "flag on accepts a multi-part pallet response as configured");
  assert.match(await card.locator('[data-hmc-pallet="2"]').textContent(), /尚未登錄/, "only an ok empty pallet renders not configured");
  assert.equal(await success.page.evaluate(() => window.MachTileHmcPalletCardCore.mapOrdersToPallets(
    [{ order: { id: "WO-UNMAPPED", partNo: "NO-MATCH" } }],
    [{ palletNo: 1, slots: [{ part: { partNo: "SS-BUSH-118" } }, { part: { partNo: "EXTRA-PART" } }] }]
  ).unmatched[0].order.id), "WO-UNMAPPED", "flag-on browser keeps an unmapped order in the unmatched result");
  await success.context.close();

  const failed = await open(false, { flag: true, rpc: new Error("temporary") });
  const failedCard = failed.page.locator('[data-hmc-pallet-card="CNC-01"]');
  await failedCard.getByText("固定工件設定暫時讀不到").waitFor();
  assert.doesNotMatch(await failedCard.textContent(), /尚未登錄|未對應/, "RPC failure renders only the read-error state");
  await failed.context.close();
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
console.log("PASS: 9 HMC pallet-card browser assertions");
