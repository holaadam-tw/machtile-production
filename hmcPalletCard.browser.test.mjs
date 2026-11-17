import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MACHTILE_E2E_OUT_DIR || path.join(root, ".e2e-out");
await mkdir(outDir, { recursive: true });
let baselineRef;
try { baselineRef = childProcess.execFileSync("git", ["rev-parse", "--verify", "origin/main^{commit}"], { cwd: root, encoding: "utf8" }).trim(); }
catch {
  baselineRef = process.env.MACHTILE_FLAG_OFF_BASE;
  if (!baselineRef) throw new Error("origin/main is unavailable; set MACHTILE_FLAG_OFF_BASE to the flag-off baseline commit");
}
const baseFiles = new Map(["index.html", "app.js", "i18n.js", "styles.css"].map((file) => [file, childProcess.execFileSync("git", ["show", `${baselineRef}:${file}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 })]));
const mod = await import(pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE || "D:/04_SoftNet/temp-playwright-deps-20261008/node_modules/playwright/index.mjs").href);
const { chromium } = mod.default || mod;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const b01Map = {
  1: [{ partNos: ["SF-03-01"], label: "SF-03本體" }, { partNos: ["BG-03-01"], label: "BG-03本體" }, { partNos: ["EMPTY"], label: "空工件" }],
  2: [{ partNos: ["CPDG-06-01"], label: "CPDG-06" }],
  3: [{ partNos: ["DSHG-04-01"], label: "DSHG-04中座體(小流量)" }, { partNos: ["DSHG-04-02"], label: "DSHG-04" }],
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
  { id:"XX01202610140006", processId:"fixture-dshg", part:"DSHG-04中座體(小流量)", drawing:"DSHG-04-01", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:2, total:3 },
  { id:"BG-FULL", processId:"fixture-bg-full", part:"BG-03本體", drawing:"BG-03-01", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:10, total:10 },
  { id:"BG-OVER", processId:"fixture-bg-over", part:"BG-03本體", drawing:"BG-03-01", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:12, total:10 },
  { id:"ROUND-87-159", processId:"fixture-round-87", part:"CPDG-06", drawing:"CPDG-06-01", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:87, total:159 },
  { id:"ROUND-95-140", processId:"fixture-round-95", part:"DSHG-04", drawing:"DSHG-04-02", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:95, total:140 },
  { id:"OVER-11-1", processId:"fixture-over-11", part:"未對應工件", drawing:"UNKNOWN-OVER-1", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:11, total:1 },
  { id:"OVER-377-372", processId:"fixture-over-377", part:"未對應工件", drawing:"UNKNOWN-OVER-2", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:377, total:372 },
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
async function open(base, { card = false, strip = false, mapped = true, machineCode = "B01", rpc = null, rpcSequence = null, fixture = false, language = "zh-Hant", viewport = { width: 1280, height: 800 } } = {}) {
  let rpcCalls = 0;
  const context = await browser.newContext({ serviceWorkers: "block", viewport });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    const relative = url.pathname.replace(/^\//, "") || "index.html";
    if (relative === "config.js") return route.fulfill({ contentType: mime[".js"], body: `window.MACHTILE_CONFIG={useSupabase:false,disableServiceWorker:true,enableHmcPalletCard:${card},enableHmcPalletStrip:${strip},hmcPalletCardMachines:["${machineCode}"],hmcPalletMap:${JSON.stringify(mapped ? { [machineCode]: b01Map } : {})},supabaseUrl:"http://127.0.0.1:${server.address().port}",supabaseAnonKey:"fake"};` });
    if (url.pathname.endsWith("/rest/v1/rpc/hmc_pallet_card_read")) {
      const response = Array.isArray(rpcSequence) ? rpcSequence[Math.min(rpcCalls++, rpcSequence.length - 1)] : rpc;
      if (response?.delay) await new Promise((resolve) => setTimeout(resolve, response.delay));
      return response instanceof Error
        ? route.fulfill({ status: 503, contentType: mime[".json"], body: JSON.stringify({ message: response.message }) })
        : route.fulfill({ contentType: mime[".json"], body: JSON.stringify(response?.body ?? response) });
    }
    if (base && baseFiles.has(relative)) return route.fulfill({ contentType: mime[path.extname(relative)], body: baseFiles.get(relative) });
    if (!base && relative === "app.js" && fixture) return route.fulfill({ contentType: mime[".js"], body: fixtureApp(await readFile(path.join(root, relative), "utf8")).replaceAll('machine:"B01"', `machine:"${machineCode}"`).replaceAll('machine: "B01"', `machine: "${machineCode}"`) });
    return route.fallback();
  });
  const page = await context.newPage();
  await page.addInitScript((value) => localStorage.setItem("machtile.language", value), language);
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
  try { await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid article").length > 0, null, { timeout: 5000 }); }
  catch (error) { throw new Error(`fixture did not render: ${errors.join(" | ") || error.message}`); }
  return { context, page, errors, rpcCalls: () => rpcCalls };
}
const dom = (page) => page.evaluate(() => { const body = document.body.cloneNode(true); body.querySelectorAll("script, #appUpdateCard, .job-part-number, .report-part-number, .finish-part-number").forEach((node) => node.remove()); return body.innerHTML.replace(/\n\s*\n/g, "\n").trimEnd(); });
const rpc = { ok: true, machine_code: "B01", pallets: [1, 2, 3, 4, 5, 6].map((pallet_no) => ({ pallet_no, parts: [] })) };
try {
  for (const flags of [{ card: false, strip: false, rpc: null }, { card: true, strip: false, rpc: { ok: true, pallets: [] } }]) {
    const baseline = await open(true, flags), flagOff = await open(false, flags);
    assert.equal(await dom(flagOff.page), await dom(baseline.page), `flag-off/old-flag DOM stays byte-identical to main ${baselineRef}`);
    assert.equal(await flagOff.page.locator("[data-hmc-pallet-strip]").count(), 0);
    assert.deepEqual(flagOff.errors, []);
    await baseline.context.close(); await flagOff.context.close();
  }

  for (const viewport of [{ width: 360, height: 800 }, { width: 1280, height: 800 }]) {
    const opened = await open(false, { card: true, strip: true, rpc, fixture: true, viewport });
    const card = opened.page.locator('[data-hmc-pallet-strip="B01"]');
    await card.waitFor();
    assert.equal(await card.locator('[data-hmc-strip-chip]:not([data-hmc-strip-chip="unmatched"])').count(), 6);
    const boxes = await card.locator('.hmc-pallet-chip:not([data-hmc-strip-chip="unmatched"])').evaluateAll((nodes) => nodes.map((node) => { const { y, height } = node.getBoundingClientRect(); return { y, height }; }));
    assert.ok(boxes.every((box) => box.height >= 44), "44px touch targets");
    assert.ok(boxes.every((box) => Math.abs(box.y - boxes[0].y) < 1), "chips do not wrap");
    assert.equal(await card.locator('.hmc-pallet-strip-chips').evaluate((node) => node.scrollWidth <= node.clientWidth), true, "six chips do not overflow");
    assert.ok(await card.locator('[data-hmc-strip-chip="1"] em').evaluate((node) => parseFloat(getComputedStyle(node).fontSize) >= 11), "over-quantity badge is at least 11px");
    assert.equal(await card.locator('[data-hmc-strip-panel="1"]').count(), 1, "current pallet expands by default");
    assert.match(await card.locator('[data-hmc-strip-panel="1"]').textContent(), /SF-03本體.*42\/135（31%）/s);
    assert.match(await card.locator('[data-hmc-strip-panel="1"]').textContent(), /BG-03本體.*22\/20（110%）.*超量 \+2/s, "aggregate row prefers over-quantity label");
    const emptyRow = card.locator('[data-hmc-workpiece="1:1-3"]');
    assert.equal(await emptyRow.isDisabled(), true, "empty workpiece is greyed and not tappable");
    await card.locator('[data-hmc-workpiece="1:1-1"]').click();
    assert.equal(await card.locator('[data-hmc-workpiece-detail="1:1-1"] [data-hmc-strip-order]').count(), 1, "level two opens per-order details");
    assert.match(await card.locator('[data-hmc-workpiece-detail="1:1-1"]').textContent(), /XX01202610290003/);
    await card.screenshot({ path: path.join(outDir, `pallet-strip-r3-${viewport.width}x${viewport.height}.png`) });
    await card.locator('[data-hmc-strip-chip="1"]').click();
    assert.equal(await card.locator("[data-hmc-strip-panel]").count(), 0, "same chip collapses");
    await card.locator('[data-hmc-strip-chip="4"]').click();
    assert.match(await card.locator('[data-hmc-strip-panel="4"]').textContent(), /HG-06.*121\/215（56%）/s);
    assert.match(await card.locator('[data-hmc-strip-chip="unmatched"]').textContent(), /其他 3/);
    assert.ok((await card.locator('[data-hmc-strip-chip="unmatched"]').getAttribute("class")).includes("is-over"), "other chip gets the over-quantity red-border state");
    assert.equal(await card.locator('[data-hmc-strip-chip="unmatched"] em').textContent(), "!", "other chip exposes the over-quantity mark");
    await card.locator('[data-hmc-strip-chip="3"]').click();
    assert.match(await card.locator('[data-hmc-strip-panel="3"]').textContent(), /DSHG-04中座體\(小流量\).*2\/3（67%）/s, "level one normally rounds 2/3 to 67%");
    await card.locator('[data-hmc-workpiece="3:3-1"]').click();
    assert.match(await card.locator('[data-hmc-workpiece-detail="3:3-1"]').textContent(), /2\/3（67%）/s, "level two normally rounds 2/3 to 67%");
    await card.locator('[data-hmc-strip-chip="2"]').click();
    assert.match(await card.locator('[data-hmc-strip-panel="2"]').textContent(), /87\/159（55%）/s, "87/159 is 55% at level one");
    await card.locator('[data-hmc-workpiece="2:2-1"]').click();
    assert.match(await card.locator('[data-hmc-workpiece-detail="2:2-1"]').textContent(), /87\/159（55%）/s, "87/159 is 55% at level two");
    await card.locator('[data-hmc-strip-chip="3"]').click();
    assert.match(await card.locator('[data-hmc-strip-panel="3"]').textContent(), /95\/140（68%）/s, "95/140 is 68% at level one");
    await card.locator('[data-hmc-workpiece="3:3-2"]').click();
    assert.match(await card.locator('[data-hmc-workpiece-detail="3:3-2"]').textContent(), /95\/140（68%）/s, "95/140 is 68% at level two");
    await card.locator('[data-hmc-strip-chip="unmatched"]').click();
    await card.locator('[data-hmc-strip-panel="unmatched"] .card-order-pick').first().click();
    const rerendered = opened.page.locator('[data-hmc-pallet-strip="B01"]');
    await rerendered.locator('.card-orders-manual').waitFor();
    assert.equal(await rerendered.locator('.card-order-auto[data-card-pick="B01"][data-card-pick-key=""]').count(), 1, "manual marker and restore-auto action stay in strip header");
    assert.equal((await rerendered.locator('.card-orders-manual').textContent()).trim(), "手動切換中", "manual wording matches the old list");
    assert.equal((await rerendered.locator('.card-order-auto').textContent()).trim(), "恢復自動");
    assert.ok(await rerendered.locator('.card-order-auto').evaluate((node) => node.getBoundingClientRect().height >= 44), "restore-auto action is at least 44px tall");
    assert.deepEqual(opened.errors, []);
    await opened.context.close();
  }

  const failed = await open(false, { card: true, strip: true, mapped: true, rpc: new Error("temporary"), fixture: true });
  await failed.page.waitForTimeout(150);
  assert.equal(await failed.page.locator('[data-hmc-pallet-strip="B01"]').count(), 1, "mapped machine renders without RPC data");
  assert.equal(failed.rpcCalls(), 0, "mapped machine does not call pallet RPC");
  await failed.context.close();

  const b02Rpc = { ok: true, machine_code: "B02", pallets: [{ pallet_no: 1, parts: ["SF-03-01", "BG-03-01"] }, ...[2, 3, 4, 5, 6].map((pallet_no) => ({ pallet_no, parts: [] }))] };
  const inferred = await open(false, { card: true, strip: true, mapped: false, machineCode: "B02", rpc: b02Rpc, fixture: true });
  const inferredCard = inferred.page.locator('[data-hmc-pallet-strip="B02"]');
  await inferredCard.waitFor();
  assert.match(await inferredCard.locator('.hmc-pallet-strip-inferred').textContent(), /推算/);
  assert.equal(await inferredCard.locator('.hmc-pallet-chip i').count(), 0, "inferred mark appears once in the header, never on a chip");
  await inferredCard.locator('[data-hmc-workpiece="1:SF-03-01"]').click();
  const before = await inferredCard.evaluate((node) => ({ height: node.getBoundingClientRect().height, panel: node.querySelector('[data-hmc-strip-panel]')?.getAttribute('data-hmc-strip-panel'), detail: node.querySelector('[data-hmc-workpiece-detail]')?.getAttribute('data-hmc-workpiece-detail') }));
  await inferred.page.evaluate(() => { const now = Date.now(); Date.now = () => now + 31000; renderWorkOrders(); });
  await inferred.page.waitForTimeout(50);
  const during = await inferred.page.locator('[data-hmc-pallet-strip="B02"]').last().evaluate((node) => ({ height: node.getBoundingClientRect().height, panel: node.querySelector('[data-hmc-strip-panel]')?.getAttribute('data-hmc-strip-panel'), detail: node.querySelector('[data-hmc-workpiece-detail]')?.getAttribute('data-hmc-workpiece-detail') }));
  assert.deepEqual(during, before, "31-second reload keeps strip, open pallet/workpiece, and layout height");
  await inferred.context.close();

  const advanceRefresh = async (page, milliseconds = 31000) => {
    await page.evaluate((delta) => { const now = Date.now(); Date.now = () => now + delta; renderWorkOrders(); }, milliseconds);
    await page.waitForTimeout(100);
  };
  const intermittent = await open(false, { card: true, strip: true, mapped: false, machineCode: "B02", rpcSequence: [b02Rpc, new Error("temporary-1"), b02Rpc, new Error("temporary-2")], fixture: true });
  await intermittent.page.locator('[data-hmc-pallet-strip="B02"]').waitFor();
  for (const expectedCall of [2, 3, 4]) {
    await advanceRefresh(intermittent.page);
    assert.equal(await intermittent.page.locator('[data-hmc-pallet-strip="B02"]').count(), 1, `ok/fail sequence keeps strip after RPC call ${expectedCall}`);
    assert.equal(await intermittent.page.locator('[data-card-orders="B02"]').count(), 0, `ok/fail sequence never shows old list after RPC call ${expectedCall}`);
  }
  await intermittent.context.close();

  const neverSucceeded = await open(false, { card: true, strip: true, mapped: false, machineCode: "B02", rpc: new Error("unavailable"), fixture: true });
  await neverSucceeded.page.waitForTimeout(150);
  assert.equal(await neverSucceeded.page.locator('[data-hmc-pallet-strip="B02"]').count(), 0, "never-succeeded failure uses old list");
  assert.equal(await neverSucceeded.page.locator('[data-card-orders="B02"]').count(), 1, "never-succeeded failure keeps old list available");
  await neverSucceeded.context.close();

  const expired = await open(false, { card: true, strip: true, mapped: false, machineCode: "B02", rpcSequence: [b02Rpc, new Error("expired")], fixture: true });
  await expired.page.locator('[data-hmc-pallet-strip="B02"]').waitFor();
  await advanceRefresh(expired.page, 10 * 60 * 1000 + 1);
  assert.equal(await expired.page.locator('[data-hmc-pallet-strip="B02"]').count(), 0, "success older than ten minutes falls back after failure");
  assert.equal(await expired.page.locator('[data-card-orders="B02"]').count(), 1, "expired success restores old list");
  await expired.context.close();

  const f1AfterGood = await open(false, { card: true, strip: true, mapped: false, machineCode: "B02", rpcSequence: [b02Rpc, { ok: true, machine_code: "B02", pallets: [1, 2, 3, 4, 5, 6].map((pallet_no) => ({ pallet_no, parts: [] })) }], fixture: true });
  await f1AfterGood.page.locator('[data-hmc-pallet-strip="B02"]').waitFor();
  await advanceRefresh(f1AfterGood.page);
  assert.equal(await f1AfterGood.page.locator('[data-hmc-pallet-strip="B02"]').count(), 0, "successful F1 response falls back immediately after a good response");
  assert.equal(await f1AfterGood.page.locator('[data-card-orders="B02"]').count(), 1, "successful F1 response shows old list");
  await f1AfterGood.context.close();

  const vietnamese = await open(false, { card: true, strip: true, rpc, fixture: true, language: "vi" });
  const vietnameseCard = vietnamese.page.locator('[data-hmc-pallet-strip="B01"]');
  await vietnameseCard.locator('[data-hmc-strip-chip="unmatched"]').click();
  await vietnameseCard.locator('[data-hmc-strip-panel="unmatched"] .card-order-pick').first().click();
  await vietnameseCard.locator('.card-orders-manual').waitFor();
  assert.equal((await vietnameseCard.locator('.card-orders-manual').textContent()).trim(), "Đang chuyển thủ công");
  assert.equal((await vietnameseCard.locator('.card-order-auto').textContent()).trim(), "Khôi phục tự động");
  await vietnamese.context.close();

  const fallbackCases = [
    { name: "production-empty-parts", rpc: { ok: true, machine_code: "B02", pallets: [1, 2, 3, 4, 5, 6].map((pallet_no) => ({ items: [], parts: [], pallet_no })) } },
    { name: "parts-without-current-order", rpc: { ok: true, machine_code: "B02", pallets: [{ pallet_no: 1, parts: ["NOT-A-CURRENT-ORDER"] }] } },
  ];
  for (const fallbackCase of fallbackCases) {
    const oldList = await open(false, { card: false, strip: false, mapped: false, machineCode: "B02", rpc: fallbackCase.rpc, fixture: true });
    const fallback = await open(false, { card: true, strip: true, mapped: false, machineCode: "B02", rpc: fallbackCase.rpc, fixture: true });
    await fallback.page.waitForTimeout(150);
    assert.equal(await fallback.page.locator('[data-hmc-pallet-strip="B02"]').count(), 0, `${fallbackCase.name}: no inferred strip`);
    const oldCardHtml = await oldList.page.locator('[data-card-orders="B02"]').locator("xpath=ancestor::article").evaluate((node) => node.outerHTML);
    const fallbackHtml = await fallback.page.locator('[data-card-orders="B02"]').locator("xpath=ancestor::article").evaluate((node) => node.outerHTML);
    assert.equal(fallbackHtml, oldCardHtml, `${fallbackCase.name}: card HTML is exactly the old list`);
    if (fallbackCase.name === "production-empty-parts") {
      for (const viewport of [{ width: 360, height: 800 }, { width: 1280, height: 800 }]) {
        await fallback.page.setViewportSize(viewport);
        await fallback.page.locator('[data-card-orders="B02"]').locator("xpath=ancestor::article").screenshot({ path: path.join(outDir, `B02-fallback-${viewport.width}x${viewport.height}.png`) });
      }
    }
    await oldList.context.close(); await fallback.context.close();
  }

  for (const viewport of [{ width: 360, height: 800 }, { width: 800, height: 1280 }, { width: 1280, height: 800 }]) {
    const matching = await open(false, { card: true, strip: true, mapped: false, machineCode: "B02", rpc: b02Rpc, fixture: true, viewport });
    const strip = matching.page.locator('[data-hmc-pallet-strip="B02"]');
    await strip.waitFor();
    const activeOver = strip.locator('[data-hmc-strip-chip="1"]');
    const classes = await activeOver.getAttribute("class");
    assert.match(classes, /is-active/, `${viewport.width}px current pallet class`);
    assert.match(classes, /is-over/, `${viewport.width}px over-quantity class`);
    const marks = await activeOver.locator('b, em, i').evaluateAll((nodes) => nodes.map((node) => { const box = node.getBoundingClientRect(); const style = getComputedStyle(node); return { tag: node.tagName, left: box.left, right: box.right, top: box.top, bottom: box.bottom, fontSize: parseFloat(style.fontSize), color: style.color, backgroundColor: style.backgroundColor }; }));
    assert.ok(marks.every((mark) => mark.fontSize >= 11), `${viewport.width}px number and marks are at least 11px`);
    for (let a = 0; a < marks.length; a += 1) for (let b = a + 1; b < marks.length; b += 1) {
      const intersects = marks[a].left < marks[b].right && marks[a].right > marks[b].left && marks[a].top < marks[b].bottom && marks[a].bottom > marks[b].top;
      assert.equal(intersects, false, `${viewport.width}px ${marks[a].tag}/${marks[b].tag} boxes do not intersect: ${JSON.stringify(marks)}`);
    }
    const overMark = marks.find((mark) => mark.tag === "EM");
    assert.equal(overMark.color, "rgb(255, 255, 255)", `${viewport.width}px over mark uses contrast-safe white text`);
    assert.equal(overMark.backgroundColor, "rgb(180, 35, 24)", `${viewport.width}px over mark uses contrast-safe red badge`);
    const chipBoxes = await strip.locator('.hmc-pallet-chip:not(.is-unmatched)').evaluateAll((nodes) => nodes.map((node) => { const box = node.getBoundingClientRect(); return { y: box.y, height: box.height }; }));
    assert.ok(chipBoxes.every((box) => box.height >= 44), `${viewport.width}px inferred chips stay 44px high`);
    assert.ok(chipBoxes.every((box) => Math.abs(box.y - chipBoxes[0].y) < 1), `${viewport.width}px six inferred chips stay in one row`);
    assert.equal(await strip.locator('.hmc-pallet-strip-chips').evaluate((node) => node.scrollWidth <= node.clientWidth), true, `${viewport.width}px inferred chips do not overflow`);
    await strip.screenshot({ path: path.join(outDir, `B02-inferred-over-current-${viewport.width}x${viewport.height}.png`) });
    await matching.context.close();
  }

  const stale = await open(false, { card: true, strip: true, mapped: false, machineCode: "B02", rpcSequence: [b02Rpc, new Error("stale-1"), new Error("stale-2"), new Error("stale-3")], fixture: true, viewport: { width: 800, height: 1280 } });
  await stale.page.locator('[data-hmc-pallet-strip="B02"]').waitFor();
  await advanceRefresh(stale.page); await advanceRefresh(stale.page); await advanceRefresh(stale.page);
  const staleStrip = stale.page.locator('[data-hmc-pallet-strip="B02"]');
  assert.match(await staleStrip.locator('.hmc-pallet-strip-stale').textContent(), /資料可能已過期/, "third consecutive failure shows stale-data hint");
  await staleStrip.screenshot({ path: path.join(outDir, "B02-stale-hint-800x1280.png") });
  await stale.context.close();
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
console.log("PASS: HMC pallet-card and pallet-strip browser assertions");
