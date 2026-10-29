import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const moduleSpec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const imported = await import(moduleSpec);
const { chromium } = imported.default || imported;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.resolve(root, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 900, height: 900 }, serviceWorkers: "block" });
await context.route("**/config.js*", route => route.fulfill({ contentType: "text/javascript", body: "window.MACHTILE_CONFIG={useSupabase:false,disableServiceWorker:true,reportQtyJumpWarnEnabled:false,homeOvertimeCardEnabled:false};" }));
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid article").length > 0);
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; console.log(`PASS ${label}`); }

const flagOff = await page.evaluate(() => {
  activeReportType = "noon";
  const order = state.workOrders[0];
  selectedOrder = order;
  reportTotalState = { status: "ready", reported: 10, start: 0, processId: String(order.processId || "") };
  order.total = 20;
  order.pureCycleSec = 60;
  document.getElementById("cycleMinutes").value = "1";
  document.getElementById("cycleSeconds").value = "0";
  machtileCardPickState.activityByKey.set(MachTileCardActiveOrderCore.orderKey(order), { actualStartAt: "2026-10-29T09:50:00+08:00" });
  const warning = machtileReportQtyJumpWarning({ valid: true, delta: 50 }, order, new Date("2026-10-29T10:00:00+08:00"));
  machtileRenderHomeOvertimeCard(new Date("2026-10-29T18:00:00+08:00"));
  return { warning, hidden: document.getElementById("homeOvertimeCard").hidden, overtimeDom: document.querySelectorAll("[data-overtime-start-card]").length };
});
check(flagOff.warning === null && flagOff.hidden && flagOff.overtimeDom === 0, "flags off preserve base behavior and add no overtime-start DOM");

const qty = await page.evaluate(() => {
  config.reportQtyJumpWarnEnabled = true;
  const order = selectedOrder;
  const over = machtileReportQtyJumpWarning({ valid: true, delta: 11 }, order, new Date("2026-10-29T10:00:00+08:00"));
  const normal = machtileReportQtyJumpWarning({ valid: true, delta: 1 }, order, new Date("2026-10-29T10:00:00+08:00"));
  reportTotalState.status = "error";
  const unreadable = machtileReportQtyJumpWarning({ valid: true, delta: 50 }, order, new Date("2026-10-29T10:00:00+08:00"));
  reportTotalState.status = "ready";
  let prompts = 0;
  window.confirm = () => { prompts++; return false; };
  const cancelled = machtileConfirmReportQtyJump({ valid: true, delta: 11 });
  window.confirm = () => { prompts++; return true; };
  const accepted = machtileConfirmReportQtyJump({ valid: true, delta: 11 });
  return { over, normal, unreadable, cancelled, accepted, prompts, zh: machtileTranslate("report_qty_jump_confirm", { quantity: 11 }) };
});
check(qty.over?.quantity === 11 && qty.normal === null, "quantity jump warns above remaining or 1.5x estimate only");
check(qty.unreadable === null && qty.zh.includes("這次加 11 件"), "unreadable estimate stays silent and Chinese copy is available");
check(qty.cancelled === false && qty.accepted === true && qty.prompts === 2, "quantity jump confirmation can cancel or continue submission");

const overtime = await page.evaluate(() => {
  config.homeOvertimeCardEnabled = true;
  config.overtimeStartCardEnabled = true;
  const machines = state.machines.filter(item => item.order).slice(0, 3);
  const [dayMachine, eveningMachine, unreadableMachine] = machines;
  state.overtimeStartSegments = new Map([[String(eveningMachine.code || eveningMachine.name).toUpperCase(), { startHm: "17:40" }]]);
  machtileCardPickState.activityByKey.set(MachTileCardActiveOrderCore.orderKey(dayMachine.order), { lastReportAt: "2026-10-29T08:10:00Z" });
  machtileCardPickState.activityByKey.set(MachTileCardActiveOrderCore.orderKey(eveningMachine.order), { lastReportAt: "2026-10-29T10:10:00Z" });
  machtileCardPickState.activityByKey.set(MachTileCardActiveOrderCore.orderKey(unreadableMachine.order), { actualStartAt: "not-a-time" });
  machtileRenderHomeOvertimeCard(new Date("2026-10-29T17:29:00+08:00"));
  const before = document.getElementById("homeOvertimeCard").hidden;
  machtileRenderHomeOvertimeCard(new Date("2026-10-29T17:30:00+08:00"));
  const card = document.getElementById("homeOvertimeCard");
  const after = !card.hidden
    && !card.textContent.includes(dayMachine.name)
    && card.textContent.includes(eveningMachine.name)
    && card.textContent.includes(eveningMachine.order.id)
    && !card.textContent.includes(unreadableMachine.name)
    && card.textContent.includes("今晚已有動作的機台")
    && card.textContent.includes("加班不需開工，報工後才會出現");
  MachTileI18n.setLanguage("vi");
  machtileRenderHomeOvertimeCard(new Date("2026-10-29T18:00:00+08:00"));
  const vi = card.textContent.includes("Máy đã có thao tác tối nay");
  renderWorkOrders();
  const machineBadge = [...document.querySelectorAll("[data-overtime-start-card]")].some((node) => node.textContent.includes("17:40"));
  return { before, after, vi, machineBadge, homeStart: card.textContent.includes("17:40") };
});
check(overtime.before && overtime.after, "overtime card excludes daytime/unreadable activity and lists an 18:10 report after 17:30");
check(overtime.vi, "overtime card Vietnamese copy is available");
check(overtime.machineBadge && overtime.homeStart, "applied overtime start appears on machine card and home overtime card");

await page.locator('[data-view="reports"].nav-item').click();
const nav = await page.evaluate(() => [...document.querySelectorAll(".desktop-nav .nav-item")].map(item => ({ active: item.classList.contains("active"), border: getComputedStyle(item).borderBottomColor })));
check(nav.filter(item => item.active).length === 1 && nav[3].active && nav[0].border !== nav[3].border, "only current nav page has active underline");
check(errors.length === 0, `no browser errors: ${errors.join(" | ")}`);
console.log(`C3_BROWSER_PASS checks=${checks}`);
await context.close();
await browser.close();
await new Promise(resolve => server.close(resolve));
