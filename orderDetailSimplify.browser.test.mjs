import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const baseRef = "origin/claude/finish-refresh-pick-20261029";
childProcess.execFileSync("git", ["rev-parse", "--verify", baseRef], { stdio: "pipe" });
const baseFiles = new Map();
for (const file of ["index.html", "app.js", "config.js", "i18n.js", "styles.css"]) {
  baseFiles.set(file, childProcess.execFileSync("git", ["show", `${baseRef}:${file}`], { maxBuffer: 8 * 1024 * 1024 }));
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
  let currentDom = await current.page.locator("#detailContent").innerHTML();
  const baseDom = await base.page.locator("#detailContent").innerHTML();
  if (process.env.MACHTILE_ORDER_DETAIL_NEGATIVE_SELFTEST === "1") currentDom += "<!-- deliberate DOM difference -->";
  if (currentDom !== baseDom) {
    const at = [...currentDom].findIndex((char, index) => char !== baseDom[index]);
    console.log("DOM_DIFF", at, JSON.stringify(currentDom.slice(Math.max(0, at - 120), at + 240)), JSON.stringify(baseDom.slice(Math.max(0, at - 120), at + 240)));
  }
  ok(currentDom === baseDom, "旗標關閉時工單明細 DOM 與 base 逐字相同");
  await current.context.close(); await base.context.close();

  const enabled = await pageAt(false, true);
  const overtimePickActions = await enabled.page.evaluate(() => {
    const input = { instantEnabled: true, overtimeEnabled: true, overtimeStartTime: "17:30", machineCode: "A01", orderNo: "XX01202609290009", step: 3 };
    const daytime = machtileStationCmdCore.startButtonState({ ...input, now: new Date("2026-10-30T11:02:00+08:00"), commandRows: [] });
    const overtime = machtileStationCmdCore.startButtonState({ ...input, now: new Date("2026-10-30T19:28:00+08:00"), commandRows: [{ machine_code: "A01", command_type: "start", status: "applied", expected_order_no: input.orderNo, expected_index_sn: 3, applied_at: "2026-10-30T11:02:00+08:00" }] });
    const applied = machtileStationCmdCore.startButtonState({ ...input, now: new Date("2026-10-30T19:29:00+08:00"), commandRows: [{ machine_code: "A01", command_type: "start", status: "applied", expected_order_no: input.orderNo, expected_index_sn: 3, applied_at: "2026-10-30T19:28:30+08:00" }] });
    return {
      daytime: machtileTakeoverCore.pickStartActions("running", { dailyStartWhenRunningEnabled: true, startedToday: true, overtimeStartVisible: daytime.overtime && daytime.visible }),
      overtime: machtileTakeoverCore.pickStartActions("running", { dailyStartWhenRunningEnabled: true, startedToday: true, overtimeStartVisible: overtime.overtime && overtime.visible }),
      applied: machtileTakeoverCore.pickStartActions("running", { dailyStartWhenRunningEnabled: true, startedToday: true, overtimeStartVisible: applied.overtime && applied.visible }),
    };
  });
  ok(JSON.stringify(overtimePickActions.daytime) === JSON.stringify(["report", "stop", "finish"])
    && overtimePickActions.overtime[0] === "start"
    && JSON.stringify(overtimePickActions.applied) === JSON.stringify(["report", "stop", "finish"]), "pick-start running 卡片只在加班應開工時補入 start，套用後隱藏且白天不變");
  await enabled.page.evaluate(() => {
    const order = state.workOrders[0];
    order.processId = "process-current";
    machtileProcessFlows.set(order.id, { quantity: 40, auditAvailable: false, processes: [
      { id: "process-done", process_order: 3, process_name: "車床加工-1/2", status: "completed", reported: 40, machine_code: "A01" },
      { id: "process-current", process_order: 4, process_name: "車床加工-2/2", status: "running", reported: 12, machine_code: "A04" },
      { id: "route-vendor", process_order: 3, process_name: "熱處理", process_type: "outsourced", status: "pending", reported: null, supplier_name: "測試委外廠" },
    ] });
    renderSimplifiedDetail(order, { processes: [{ status: "running", inspection_required: true, inspection_status: "pending" }], reports: [
      { process_id: "process-current", created_at: "2026-10-29T02:00:00Z", completed_qty: 12, defect_qty: 1, machine_id: null, operator_names: ["測試人員"], report_type: "noon" },
      { process_id: "process-done", created_at: "2026-10-29T01:00:00Z", completed_qty: 0, defect_qty: 0, machine_id: null, operator_names: ["測試人員"], report_type: "dailyStart" },
    ], cncPrograms: [] });
  });
  const detail = enabled.page.locator("#detailContent");
  const text = await detail.innerText();
  ok(text.includes("這張單的流程") && text.includes("共 3 道") && text.includes("完成 12 / 計畫 40") && text.includes("測試委外廠") && await detail.locator('[aria-current="step"]').count() === 1, "旗標開啟顯示完整流程、完成／計畫、目前道與委外廠商");
  ok(text.includes("這張單的報工紀錄") && text.includes("測試人員") && text.includes("良品 12 · 不良 1") && text.includes("平板"), "報工紀錄顯示時間、機台、人、件數與來源");
  ok(text.includes("製程") && text.includes("N4 車床加工-2/2")
    && await detail.locator('[data-order-detail-report-process="process-current"]').evaluate((row) => row.hidden === false)
    && await detail.locator('[data-order-detail-report-process="process-done"]').evaluate((row) => row.hidden === true), "預設只顯示卡片目前 N4 製程的報工");
  ok(await detail.locator('[data-order-detail-report-filter="all"]').count() === 1 && await detail.locator('[data-order-detail-report-filter="process-current"].active').count() === 1, "多製程報工顯示全部／N3／N4 chips，預設目前製程");
  await detail.locator('[data-order-detail-report-filter="all"]').dispatchEvent("click");
  const allReportText = await detail.innerText();
  ok(allReportText.includes("N3 車床加工-1/2") && allReportText.includes("開工") && !allReportText.includes("良品 0 · 不良 0"), "全部顯示其他製程，0／0 開工列以類型標示並保留");
  ok(!text.includes("首次開工") && !text.includes("今日開工") && !text.includes("查看完整工單") && !text.includes("MachTile AI 建議"), "精簡版隱藏兩個開工鍵、完整工單連結與 AI 建議");

  await enabled.page.evaluate(() => {
    machtileAuthState.role = "operator";
    machtileFlowVisibilityState.byRole = { operator: "adjacent" };
    const order = state.workOrders[0];
    renderSimplifiedDetail(order, { processes: [], reports: [], cncPrograms: [] });
  });
  const restrictedText = await detail.innerText();
  ok(restrictedText.includes("此角色不顯示完整製程路線") && await detail.locator(".process-flow").count() === 0 && await detail.locator("[data-process-preplan]").count() === 0, "受限角色只看提示，不顯示完整路線也不提供預排");
  await enabled.page.evaluate(() => {
    machtileAuthState.role = "admin";
    machtileFlowVisibilityState.byRole = null;
  });

  await enabled.page.evaluate(() => {
    machtileAuthState.role = "admin";
    machtileDepartmentAccess = { role: "admin", is_bridge: false };
    machtileFlowVisibilityState.byRole = { admin: "full", operator: "adjacent" };
    machtileSetOperatorPreview(true);
  });
  ok(await enabled.page.locator("#operatorPreviewBanner").isVisible(), "管理者可進入作業員畫面預覽並顯示固定提示");
  ok(await enabled.page.evaluate(() => machtileActualRole() === "admin" && machtileUiRole() === "operator" && sessionStorage.getItem("machtile.operatorPreview") === "1"), "預覽只改 UI role，實際管理者身分不變且 per-tab 保存");
  await enabled.page.locator("[data-exit-operator-preview]").click();
  ok(await enabled.page.evaluate(() => machtileActualRole() === "admin" && machtileUiRole() === "admin" && sessionStorage.getItem("machtile.operatorPreview") === "0"), "退出預覽恢復管理者 UI role");

  await enabled.page.evaluate(() => {
    const order = state.workOrders[0];
    machtileProcessFlows.delete(order.id);
    document.getElementById("detailSheet").classList.add("is-open");
    document.getElementById("detailSheet").setAttribute("aria-hidden", "false");
    renderSimplifiedDetail(order, { processes: fallbackProcesses(order), reports: fallbackReports(order), cncPrograms: [] });
  });
  const fallbackText = await detail.innerText();
  ok(await detail.locator("[data-order-detail-route-empty]").count() === 0
    && fallbackText.includes("備料")
    && fallbackText.includes("CNC 銑削"), "demo simplified route falls back to legacy process progress instead of no data");
  ok(await detail.locator("[data-order-detail-report]").count() > 0, "demo simplified reports reuse the legacy report source when available");
  await enabled.page.evaluate(async () => {
    const originalFetch = window.supabaseFetch;
    const originalSource = state.source;
    try {
      state.source = "supabase";
      window.supabaseFetch = async () => [];
      const order = state.workOrders[0];
      machtileProcessFlows.delete(order.id);
      await hydrateDetail(order);
    } finally {
      window.supabaseFetch = originalFetch;
      state.source = originalSource;
    }
  });
  const realEmptyText = await detail.innerText();
  ok(await detail.locator("[data-order-detail-route-empty]").count() > 0
    && !realEmptyText.includes("備料")
    && !realEmptyText.includes("正常回報"), "real (supabase) data empty shows no data, never demo fallback rows");
  if (process.env.MACHTILE_ORDER_DETAIL_SCREENSHOT) {
    await enabled.page.setViewportSize({ width: 1280, height: 1100 });
    await enabled.page.locator("#detailSheet").screenshot({ path: process.env.MACHTILE_ORDER_DETAIL_SCREENSHOT });
  }

  await enabled.page.evaluate(async () => {
    const originalFetch = window.supabaseFetch;
    const originalSource = state.source;
    const calls = [];
    window.__orderDetailLookupCalls = calls;
    window.supabaseFetch = async (request) => {
      calls.push(request);
      if (request.startsWith("work_order_processes?")) return [{ status: "running", inspection_required: false, inspection_status: "none" }];
      if (request.startsWith("production_reports?")) return [{ created_at: "2026-10-29T02:00:00Z", completed_qty: 3, defect_qty: 0, user_id: "user-1", operator_ids: [] }];
      if (request.startsWith("app_users?")) throw new Error("synthetic app_users failure");
      if (request.startsWith("abnormal_events?")) return [{ event_type: "test-abnormal", severity: "medium", description: "kept loading", status: "open" }];
      if (request.startsWith("cnc_programs?")) return [];
      return [];
    };
    state.source = "supabase";
    try {
      await hydrateDetail({ ...state.workOrders[0], workOrderId: "00000000-0000-4000-8000-000000000001" });
    } finally {
      window.supabaseFetch = originalFetch;
      state.source = originalSource;
    }
  });
  const lookupCalls = await enabled.page.evaluate(() => window.__orderDetailLookupCalls);
  ok(lookupCalls.some((request) => request.startsWith("abnormal_events?")) && lookupCalls.some((request) => request.startsWith("cnc_programs?")) && (await detail.innerText()).includes("無資料"), "人員查詢失敗只顯示無資料，異常與 CNC 查詢仍繼續");

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

  await enabled.page.evaluate(() => {
    window.MachTileI18n.setLanguage("vi");
    const order = { ...state.workOrders[0], id: "VI-ORDER", drawing: "VI-DRAWING", machine: "", lastReport: "", programName: "", programVersion: "", programHash: "", pureCycleSec: null, baselineCycleSec: null, historyRuns: 0 };
    machtileProcessFlows.delete(order.id);
    renderSimplifiedDetail(order, { processes: [], reports: [], cncPrograms: [] });
  });
  const viText = await detail.innerText();
  ok(viText.includes("Số bản vẽ") && viText.includes("Máy") && viText.includes("Không có dữ liệu") && !viText.includes("圖號") && !viText.includes("無資料"), "精簡版新字串可切換越南文");
  await enabled.context.close();
  console.log(`RESULT ${checks} PASS, 0 FAIL`);
} finally {
  await browser.close();
  server.close();
}
