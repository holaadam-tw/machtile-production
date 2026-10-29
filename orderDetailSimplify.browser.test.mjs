import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const baseFiles = new Map();
for (const file of ["index.html", "app.js", "config.js", "i18n.js", "styles.css"]) {
  baseFiles.set(file, childProcess.execFileSync("git", ["show", `HEAD:${file}`], { maxBuffer: 8 * 1024 * 1024 }));
}
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const base = url.pathname.startsWith("/base/");
  const relative = decodeURIComponent(url.pathname.replace(/^\/(?:base\/)?/, "") || "index.html");
  try {
    const body = base && baseFiles.has(relative) ? baseFiles.get(relative) : await readFile(path.join(root, relative));
    res.writeHead(200, { "Content-Type": mime[path.extname(relative)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const moduleSpec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const imported = await import(moduleSpec);
const { chromium } = imported.default || imported;
const browser = await chromium.launch();
let checks = 0;
const ok = (value, label) => { assert.ok(value, label); checks++; console.log(`PASS ${label}`); };
const configBody = (enabled) => `window.MACHTILE_CONFIG={useSupabase:false,disableServiceWorker:true,orderDetailSimplifyEnabled:${enabled}};`;

async function pageAt(useBase, enabled) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  if (useBase) await context.route("**/*", async (route) => {
    const relative = new URL(route.request().url()).pathname.replace(/^\//, "") || "index.html";
    if (relative !== "config.js" && baseFiles.has(relative)) {
      await route.fulfill({ contentType: mime[path.extname(relative)] || "application/octet-stream", body: baseFiles.get(relative) });
    } else await route.fallback();
  });
  await context.route("**/config.js*", (route) => route.fulfill({ contentType: "text/javascript", body: configBody(enabled) }));
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid article").length > 0);
  return { context, page };
}

try {
  const current = await pageAt(false, false);
  const base = await pageAt(true, false);
  for (const candidate of [current.page, base.page]) {
    await candidate.evaluate(() => openDetail(state.workOrders[0].id));
    await candidate.waitForFunction(() => !document.querySelector("#detailContent")?.textContent.includes("載入工單明細中"));
  }
  const currentDom = await current.page.locator("#detailContent").innerHTML();
  const baseDom = await base.page.locator("#detailContent").innerHTML();
  if (currentDom !== baseDom) {
    const at = [...currentDom].findIndex((char, index) => char !== baseDom[index]);
    console.log("DOM_DIFF", at, JSON.stringify(currentDom.slice(Math.max(0, at - 120), at + 240)), JSON.stringify(baseDom.slice(Math.max(0, at - 120), at + 240)));
  }
  ok(currentDom === baseDom, "旗標關閉時工單明細 DOM 與 base 逐字相同");
  await current.context.close(); await base.context.close();

  const enabled = await pageAt(false, true);
  await enabled.page.evaluate(() => {
    const order = state.workOrders[0];
    order.processId = "process-current";
    machtileProcessFlows.set(order.id, { quantity: 40, auditAvailable: false, processes: [
      { id: "process-done", process_order: 1, process_name: "備料", status: "completed", reported: 40, machine_code: "A01" },
      { id: "process-current", process_order: 2, process_name: "CNC 加工", status: "running", reported: 12, machine_code: "A02" },
      { id: "route-vendor", process_order: 3, process_name: "熱處理", process_type: "outsourced", status: "pending", reported: null, supplier_name: "測試委外廠" },
    ] });
    renderSimplifiedDetail(order, { processes: [{ status: "running", inspection_required: true, inspection_status: "pending" }], reports: [
      { created_at: "2026-10-29T02:00:00Z", completed_qty: 12, defect_qty: 1, machine_id: null, operator_names: ["測試人員"] },
    ], cncPrograms: [] });
  });
  const detail = enabled.page.locator("#detailContent");
  const text = await detail.innerText();
  ok(text.includes("這張單的流程") && text.includes("共 3 道") && text.includes("完成 12 / 計畫 40") && text.includes("測試委外廠") && await detail.locator('[aria-current="step"]').count() === 1, "旗標開啟顯示完整流程、完成／計畫、目前道與委外廠商");
  ok(text.includes("這張單的報工紀錄") && text.includes("測試人員") && text.includes("良品 12 · 不良 1") && text.includes("平板"), "報工紀錄顯示時間、機台、人、件數與來源");
  ok(!text.includes("首次開工") && !text.includes("今日開工") && !text.includes("查看完整工單") && !text.includes("MachTile AI 建議"), "精簡版隱藏兩個開工鍵、完整工單連結與 AI 建議");

  await enabled.page.evaluate(() => {
    const order = { ...state.workOrders[0], id: "EMPTY-ORDER", drawing: "EMPTY-DRAWING", part: "空資料", programName: "", programVersion: "", programHash: "", pureCycleSec: null, baselineCycleSec: null, historyRuns: 0, historyYears: 0 };
    machtileProcessFlows.delete(order.id);
    renderSimplifiedDetail(order, { processes: [], reports: [], cncPrograms: [] });
  });
  ok(await detail.locator("[data-order-detail-route-empty]").count() === 1 && await detail.locator("[data-order-detail-reports-empty]").count() === 1, "路線或報工讀不到時顯示無資料");
  ok(await detail.locator("[data-order-detail-program]").count() === 0 && await detail.locator("[data-cnc-work-order]").count() === 0, "程式與 CNC 版本全空時整區隱藏");

  await enabled.page.evaluate(() => {
    const order = { ...state.workOrders[0], id: "PROGRAM-ORDER", drawing: "PROGRAM-DRAWING", part: "有程式", programName: "O9000.NC", programVersion: "V1", programHash: "abc123" };
    renderSimplifiedDetail(order, { processes: [], reports: [], cncPrograms: [{ id: "program-1", cnc_program_versions: [{ id: "version-1", version_no: "V1", file_name: "O9000.NC", file_hash: "abc123", uploaded_at: "2026-10-29T02:00:00Z" }] }] });
  });
  ok(await detail.locator("[data-order-detail-program]").count() === 1 && await detail.locator("[data-cnc-work-order]").count() === 1, "程式或 CNC 版本有資料時顯示區塊");
  await enabled.context.close();
  console.log(`RESULT ${checks} PASS, 0 FAIL`);
} finally {
  await browser.close();
  server.close();
}
