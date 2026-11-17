import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = "D:/04_SoftNet/ops/codex-inbox/20261117-1940-pallet-strip";
await mkdir(outDir, { recursive: true });
const baseFiles = new Map(["index.html", "app.js", "i18n.js", "styles.css"].map((file) => [file, childProcess.execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 })]));
const mod = await import(pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE || "D:/04_SoftNet/temp-playwright-deps-20261008/node_modules/playwright/index.mjs").href);
const { chromium } = mod.default || mod;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const b01Map = {
  1: [{ partNos: ["SF-03-01"], label: "SF-03本體" }, { partNos: ["BG-03-01"], label: "BG-03本體" }],
  3: [{ partNos: ["DSHG-04-01"], label: "DSHG-04中座體(小流量)" }],
  4: [{ partNos: ["HG-06-01"], label: "HG-06", default: true }],
};
function fixtureApp(source) {
  return source
    .replace('id: "WO-20260428-011"', 'id: "XX01202610290003"')
    .replace('part: "治具底板"', 'part: "SF-03本體"')
    .replace('drawing: "JIG-PLT-332"', 'drawing: "SF-03-01"')
    .replace('machine: "CNC-05"', 'machine: "B01"')
    .replace(/done: 8,\r?\n    total: 20,/, 'done: 42,\n    total: 135,')
    .replace(/\r?\n\];\r?\n\r?\nconst baseMachines = \[/, `
  { id:"XX01202610140007", processId:"fixture-hg", part:"HG-06本體", drawing:"HG-06-01", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:121, total:215 },
  { id:"XX01202610140006", processId:"fixture-dshg", part:"DSHG-04中座體(小流量)", drawing:"DSHG-04-01", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:95, total:140 },
  { id:"XX-OTHER", processId:"fixture-other", part:"未對應工件", drawing:"UNKNOWN-01", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:1, total:9 }
];

const baseMachines = [`);
}
const server = createServer(async (req, res) => {
  const relative = new URL(req.url, "http://localhost").pathname.replace(/^\//, "") || "index.html";
  try { const body = await readFile(path.join(root, relative)); res.writeHead(200, { "Content-Type": mime[path.extname(relative)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
async function open(base, { card = false, strip = false, rpc = null, viewport = { width: 1280, height: 800 } } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    const relative = url.pathname.replace(/^\//, "") || "index.html";
    if (relative === "config.js") return route.fulfill({ contentType: mime[".js"], body: `window.MACHTILE_CONFIG={useSupabase:false,disableServiceWorker:true,enableHmcPalletCard:${card},enableHmcPalletStrip:${strip},hmcPalletCardMachines:["B01"],hmcPalletMap:${JSON.stringify({ B01: b01Map })},supabaseUrl:"http://127.0.0.1:${server.address().port}",supabaseAnonKey:"fake"};` });
    if (url.pathname.endsWith("/rest/v1/rpc/hmc_pallet_card_read")) return rpc instanceof Error
      ? route.fulfill({ status: 503, contentType: mime[".json"], body: JSON.stringify({ message: rpc.message }) })
      : route.fulfill({ contentType: mime[".json"], body: JSON.stringify(rpc) });
    if (base && baseFiles.has(relative)) return route.fulfill({ contentType: mime[path.extname(relative)], body: baseFiles.get(relative) });
    if (!base && relative === "app.js" && (card || strip)) return route.fulfill({ contentType: mime[".js"], body: fixtureApp(await readFile(path.join(root, relative), "utf8")) });
    return route.fallback();
  });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
  try { await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid article").length > 0, null, { timeout: 5000 }); }
  catch (error) { throw new Error(`fixture did not render: ${errors.join(" | ") || error.message}`); }
  return { context, page, errors };
}
const dom = (page) => page.evaluate(() => { const body = document.body.cloneNode(true); body.querySelectorAll("script, #appUpdateCard, .job-part-number, .report-part-number, .finish-part-number").forEach((node) => node.remove()); return body.innerHTML.replace(/\n\s*\n/g, "\n").trimEnd(); });
const rpc = { ok: true, machine_code: "B01", pallets: [1, 2, 3, 4, 5, 6].map((pallet_no) => ({ pallet_no, parts: [] })) };
try {
  const baseline = await open(true), flagOff = await open(false);
  assert.equal(await dom(flagOff.page), await dom(baseline.page), "flag off stays byte-identical to HEAD");
  assert.equal(await flagOff.page.locator("[data-hmc-pallet-strip]").count(), 0);
  assert.deepEqual(flagOff.errors, []);
  await baseline.context.close(); await flagOff.context.close();

  for (const viewport of [{ width: 360, height: 800 }, { width: 1280, height: 800 }]) {
    const opened = await open(false, { card: true, strip: true, rpc, viewport });
    const card = opened.page.locator('[data-hmc-pallet-strip="B01"]');
    await card.waitFor();
    assert.equal(await card.locator('[data-hmc-strip-chip]:not([data-hmc-strip-chip="unmatched"])').count(), 6);
    const boxes = await card.locator('.hmc-pallet-chip:not([data-hmc-strip-chip="unmatched"])').evaluateAll((nodes) => nodes.map((node) => { const { y, height } = node.getBoundingClientRect(); return { y, height }; }));
    assert.ok(boxes.every((box) => box.height >= 44), "44px touch targets");
    assert.ok(boxes.every((box) => Math.abs(box.y - boxes[0].y) < 1), "chips do not wrap");
    assert.equal(await card.locator('[data-hmc-strip-panel="1"]').count(), 1, "current pallet expands by default");
    assert.match(await card.locator('[data-hmc-strip-panel="1"]').textContent(), /SF-03本體.*42\/135（31%）/s);
    const emptyRow = card.locator('[data-hmc-workpiece="1:1-2"]');
    assert.equal(await emptyRow.isDisabled(), true, "empty workpiece is greyed and not tappable");
    await card.locator('[data-hmc-workpiece="1:1-1"]').click();
    assert.equal(await card.locator('[data-hmc-workpiece-detail="1:1-1"] [data-hmc-strip-order]').count(), 1, "level two opens per-order details");
    assert.match(await card.locator('[data-hmc-workpiece-detail="1:1-1"]').textContent(), /XX01202610290003/);
    await card.screenshot({ path: path.join(outDir, `pallet-strip-r2-${viewport.width}x${viewport.height}.png`) });
    await card.locator('[data-hmc-strip-chip="1"]').click();
    assert.equal(await card.locator("[data-hmc-strip-panel]").count(), 0, "same chip collapses");
    await card.locator('[data-hmc-strip-chip="4"]').click();
    assert.match(await card.locator('[data-hmc-strip-panel="4"]').textContent(), /HG-06.*121\/215（56%）/s);
    assert.match(await card.locator('[data-hmc-strip-chip="unmatched"]').textContent(), /其他 1/);
    assert.deepEqual(opened.errors, []);
    await opened.context.close();
  }

  const failed = await open(false, { card: true, strip: true, rpc: new Error("temporary") });
  await failed.page.waitForTimeout(150);
  assert.equal(await failed.page.locator('[data-hmc-pallet-strip="B01"]').count(), 0, "failure has no misleading strip");
  assert.ok(await failed.page.getByText("SF-03本體", { exact: true }).count() >= 1, "failure preserves today's card");
  await failed.context.close();
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
console.log("PASS: HMC pallet-card and pallet-strip browser assertions");
