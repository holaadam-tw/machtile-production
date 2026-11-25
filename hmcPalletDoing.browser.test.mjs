// B01/B02 盤號條「現在在做」第 2 包：旗標關 DOM 逐字相同＋0 新 RPC；旗標開三狀態、送出 payload、模具互斥 toast、離線擋下。
// 全程假 Supabase（本機 127.0.0.1 靜態伺服器上的假 RPC），不碰任何真實環境。
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
let baselineRef;
try { baselineRef = childProcess.execFileSync("git", ["rev-parse", "--verify", "origin/main^{commit}"], { cwd: root, encoding: "utf8" }).trim(); }
catch { baselineRef = process.env.MACHTILE_FLAG_OFF_BASE; if (!baselineRef) throw new Error("origin/main is unavailable; set MACHTILE_FLAG_OFF_BASE"); }
const baseFiles = new Map(["index.html", "app.js", "i18n.js", "styles.css"].map((file) => [file, childProcess.execFileSync("git", ["show", `${baselineRef}:${file}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 })]));
const mod = await import(pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE || "D:/04_SoftNet/temp-playwright-deps-20261008/node_modules/playwright/index.mjs").href);
const { chromium } = mod.default || mod;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
let checks = 0;
const ok = (value, label) => { assert.ok(value, label); checks += 1; console.log(`PASS ${label}`); };
const eq = (a, b, label) => { assert.equal(a, b, label); checks += 1; console.log(`PASS ${label}`); };
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
  { id:"BG-1", processId:"fixture-bg", part:"BG-03本體", drawing:"BG-03-01", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:10, total:50 },
  { id:"CP-1", processId:"fixture-cp", part:"CPDG-06", drawing:"CPDG-06-01", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:87, total:159 },
  { id:"DS-1", processId:"fixture-ds", part:"DSHG-04", drawing:"DSHG-04-01", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:2, total:3 },
  { id:"HG-1", processId:"fixture-hg", part:"HG-06本體", drawing:"HG-06-01", machine:"B01", process:"CNC 銑削", processStatus:"pending", workStatus:"in_progress", done:121, total:215 }
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
const row = (extra) => ({ part_no: null, reason_code: null, reason_text: null, mold_group_code: null, actor_role: "operator", ...extra });
const initialRead = () => ({
  machine_code: "B01", require_planner_confirm: true, pending_unmerged_count: 0, pending_no_order: [], worklists: [],
  pallets: [
    { pallet_no: 1, workpieces: [
      row({ workpiece_key: "1-1", part_no: "SF-03-01", status: "doing" }),
      row({ workpiece_key: "1-2", part_no: "BG-03-01", status: "idle_reason", reason_code: "waiting_material" }),
    ] },
    { pallet_no: 2, workpieces: [row({ workpiece_key: "stale-key", part_no: "  cpdg-06-01 ", status: "doing" })] },
    { pallet_no: 3, workpieces: [row({ workpiece_key: "3-1", part_no: "DSHG-04-01", status: "doing_no_order" })] },
  ],
});

async function open({ base = false, doing = null, machines = '["B01","B02"]', readResponse = initialRead(), setResponse = null, holdLaterReads = false } = {}) {
  let releaseRead = null;
  const calls = { read: 0, set: [] };
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 380, height: 900 } });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    const relative = url.pathname.replace(/^\//, "") || "index.html";
    if (relative === "config.js") {
      const flags = doing === null ? "" : `enableHmcPalletDoing:${doing},hmcPalletDoingMachines:${machines},`;
      return route.fulfill({ contentType: mime[".js"], body: `window.MACHTILE_CONFIG={useSupabase:false,disableServiceWorker:true,enableHmcPalletCard:true,enableHmcPalletStrip:true,hmcPalletCardMachines:["B01"],${flags}hmcPalletMap:${JSON.stringify({ B01: b01Map })},supabaseUrl:"http://127.0.0.1:${server.address().port}",supabaseAnonKey:"fake"};` });
    }
    if (url.pathname.endsWith("/rest/v1/rpc/hmc_pallet_doing_read")) { calls.read += 1; if (holdLaterReads && calls.read > 1) await new Promise((resolve) => { releaseRead = resolve; }); return route.fulfill({ contentType: mime[".json"], body: JSON.stringify(readResponse) }); }
    if (url.pathname.endsWith("/rest/v1/rpc/hmc_pallet_doing_set")) {
      const body = JSON.parse(route.request().postData() || "{}");
      calls.set.push(body.p_payload);
      if (setResponse?.status) return route.fulfill({ status: setResponse.status, contentType: mime[".json"], body: JSON.stringify(setResponse.body) });
      return route.fulfill({ contentType: mime[".json"], body: JSON.stringify({ result: "set", command_uuid: body.p_payload.command_uuid, status: body.p_payload.status }) });
    }
    if (base && baseFiles.has(relative)) return route.fulfill({ contentType: mime[path.extname(relative)], body: relative === "app.js" ? Buffer.from(fixtureApp(baseFiles.get(relative).toString("utf8")), "utf8") : baseFiles.get(relative) });
    if (relative === "app.js") return route.fulfill({ contentType: mime[".js"], body: fixtureApp(await readFile(path.join(root, relative), "utf8")) });
    return route.fallback();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
  try { await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid article").length > 0, null, { timeout: 5000 }); }
  catch (error) { throw new Error(`fixture did not render: ${errors.join(" | ") || error.message}`); }
  return { context, page, errors, calls, release: () => releaseRead && releaseRead() };
}
const dom = (page) => page.evaluate(() => { const body = document.body.cloneNode(true); body.querySelectorAll("script, #appUpdateCard, .job-part-number, .report-part-number, .finish-part-number").forEach((node) => node.remove()); return body.innerHTML.replace(/\n\s*\n/g, "\n").trimEnd(); });
const toastText = (page) => page.evaluate(() => document.querySelector("#toast")?.textContent || "");

try {
  // 1) flag off: DOM byte-identical to origin/main and zero new RPCs (flag absent, false, and true-but-machine-not-listed variants).
  const baseline = await open({ base: true });
  const baselineDom = await dom(baseline.page);
  ok(baselineDom.includes("data-hmc-pallet-strip"), "baseline renders the pallet strip fixture");
  for (const [label, doing, machines] of [["旗標未設", null], ["旗標 false", "false"], ["旗標 true 但 B01 不在清單", "true", '["B02"]']]) {
    const off = await open({ doing, machines });
    await off.page.waitForTimeout(250);
    eq(await dom(off.page), baselineDom, `${label}：盤號條 DOM 與 origin/main 逐字相同`);
    eq(off.calls.read, 0, `${label}：0 次 hmc_pallet_doing_read`);
    eq(off.calls.set.length, 0, `${label}：0 次 hmc_pallet_doing_set`);
    eq(await off.page.locator(".doing-pill, .doing-dot, .doing-actions, .hmc-doing-legend").count(), 0, `${label}：沒有任何新 DOM`);
    eq(off.errors.length, 0, `${label}：沒有頁面錯誤`);
    await off.context.close();
  }
  await baseline.context.close();

  // 2) flag on: three states.
  const on = await open({ doing: "true" });
  const card = on.page.locator('[data-hmc-pallet-strip="B01"]');
  await card.locator("[data-hmc-doing-legend]").waitFor();
  ok(on.calls.read >= 1, "旗標開：讀了 hmc_pallet_doing_read");
  {
    // 重讀進行中（loading）：上一次的「在做」不可先閃掉。
    const hold = await open({ doing: "true", holdLaterReads: true });
    const holdCard = hold.page.locator('[data-hmc-pallet-strip="B01"]');
    await holdCard.locator("[data-hmc-doing-legend]").waitFor();
    await hold.page.evaluate(() => { machtileLoadHmcPalletDoing(state.machines.find((m) => (m.code || m.name) === "B01"), true); renderWorkOrders(); });
    await hold.page.waitForFunction(() => machtileHmcPalletDoingState.get("B01")?.status === "loading");
    await hold.page.evaluate(() => renderWorkOrders());
    eq(await hold.page.locator('[data-hmc-pallet-strip="B01"] .doing-dot').count() > 0, true, "重讀中：仍顯示上一次的在做綠點");
    eq(await hold.page.locator('[data-hmc-pallet-strip="B01"] [data-hmc-doing-legend]').count(), 1, "重讀中：圖例不消失");
    hold.release();
    await hold.context.close();
  }
  const chip = (n) => card.locator(`[data-hmc-strip-chip="${n}"]`);
  ok((await chip(1).getAttribute("class")).includes("is-doing") && !(await chip(1).getAttribute("class")).includes("is-doing-no-order"), "盤 1 在做：is-doing");
  eq(await chip(1).locator(".doing-dot").count(), 1, "盤 1 在做：有綠點");
  eq((await chip(1).locator("span").textContent()).trim(), "在做", "盤 1 文字「在做」");
  ok((await chip(2).getAttribute("class")).includes("is-doing"), "盤 2：part_no 前後空白＋小寫仍比對成功（不分大小寫）");
  ok((await chip(3).getAttribute("class")).includes("is-doing-no-order"), "盤 3 無單在做：橘底類別");
  eq(await chip(3).locator(".doing-dot").count(), 0, "盤 3 無單在做：不畫綠點");
  eq((await chip(3).locator("span").textContent()).trim(), "無單在做", "盤 3 文字「無單在做」");
  eq((await chip(4).locator("span").textContent()).trim(), "有工單", "盤 4 無狀態：維持原文字");
  ok(!(await chip(4).getAttribute("class")).includes("is-doing"), "盤 4 無狀態：沒有 is-doing");
  ok((await chip(1).getAttribute("class")).includes("is-open"), "原本的 is-open 判定不變");
  const panel1 = card.locator('[data-hmc-strip-panel="1"]');
  eq(await panel1.locator(".doing-pill.on").count(), 1, "第一層：在做 pill");
  ok((await panel1.locator(".doing-pill.idle").textContent()).includes("沒在做：等料"), "第一層：沒在做 pill 帶原因");
  eq(await panel1.locator(".hmc-pallet-workpiece").nth(0).locator("[data-hmc-doing-pick]").count(), 1, "在做的工件列：有「改成沒在做」");
  eq(await panel1.locator('[data-hmc-doing-start]').count(), 2, "沒在做／沒狀態的工件列：有「在做」鈕");
  const narrow = await chip(3).locator("span").evaluate((node) => node.scrollWidth <= node.clientWidth);
  ok(narrow, "盤 3「無單在做」在 380px 寬不被截斷");

  // 3) press 在做 on 1-2: payload.
  await panel1.locator('[data-hmc-doing-key="1:1-2"][data-hmc-doing-start]').click();
  await on.page.waitForTimeout(200);
  eq(on.calls.set.length, 1, "點在做：恰好 1 次 hmc_pallet_doing_set");
  const payload = on.calls.set[0];
  assert.deepEqual(Object.keys(payload).sort(), ["command_uuid", "machine_code", "pallet_no", "part_no", "reason_code", "reason_text", "status", "switch_mold", "workpiece_key"]);
  ok(true, "payload 欄位恰為合約 9 欄");
  ok(payload.machine_code === "B01" && payload.pallet_no === 1 && typeof payload.pallet_no === "number" && payload.workpiece_key === "1-2" && payload.part_no === "BG-03-01" && payload.status === "doing" && payload.reason_code === null && payload.reason_text === null && payload.switch_mold === false, "payload 內容正確（pallet_no 為 number、part_no 大寫）");
  ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payload.command_uuid), "command_uuid 是 UUID");
  ok((await toastText(on.page)).includes("已更新"), "成功後 toast「已更新」");

  // 3b) no-order workpiece starts as doing_no_order.
  await card.locator('[data-hmc-strip-chip="1"]').click(); // collapse
  await card.locator('[data-hmc-strip-chip="1"]').click(); // reopen
  await card.locator('[data-hmc-doing-key="1:1-3"][data-hmc-doing-start]').click();
  await on.page.waitForTimeout(200);
  eq(on.calls.set[1].status, "doing_no_order", "沒工單的工件按在做：送 doing_no_order");
  eq(on.calls.set[1].part_no, "EMPTY", "沒工單的工件：part_no 取對照表第一個");

  // 3c) 沒在做 needs a reason.
  await card.locator('[data-hmc-doing-key="1:1-1"][data-hmc-doing-pick]').click();
  eq(await card.locator("[data-hmc-doing-picker]").count(), 1, "按改成沒在做：出現原因選單");
  await card.locator("[data-hmc-doing-confirm]").click();
  await on.page.waitForTimeout(100);
  eq(on.calls.set.length, 2, "沒選原因：不送出");
  ok((await toastText(on.page)).includes("原因"), "沒選原因：toast 提示");
  await card.locator("[data-hmc-doing-reason]").selectOption("other");
  await card.locator("[data-hmc-doing-confirm]").click();
  await on.page.waitForTimeout(100);
  eq(on.calls.set.length, 2, "選其他沒寫說明：不送出");
  await card.locator("[data-hmc-doing-reason-text]").fill("換刀");
  await card.locator("[data-hmc-doing-confirm]").click();
  await on.page.waitForTimeout(200);
  eq(on.calls.set.length, 3, "選其他並寫說明：送出");
  ok(on.calls.set[2].status === "idle_reason" && on.calls.set[2].reason_code === "other" && on.calls.set[2].reason_text === "換刀" && on.calls.set[2].part_no === "SF-03-01", "idle_reason payload 帶原因碼與說明");
  eq(on.errors.length, 0, "旗標開：沒有頁面錯誤");

  // 5) offline: blocked, zero RPC.
  await on.page.evaluate(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }));
  const before = on.calls.set.length;
  await card.locator('[data-hmc-doing-key="1:1-2"][data-hmc-doing-start]').click();
  await on.page.waitForTimeout(150);
  eq(on.calls.set.length, before, "離線：0 次 RPC");
  ok((await toastText(on.page)).includes("連不上，沒改成"), "離線：toast 連不上，沒改成");
  await on.context.close();

  // 4) server rejects with the shared-mold error: Chinese toast.
  const busy = await open({ doing: "true", setResponse: { status: 400, body: { code: "P0001", message: "SHARED_MOLD_BUSY", details: null, hint: null } } });
  const busyCard = busy.page.locator('[data-hmc-pallet-strip="B01"]');
  await busyCard.locator("[data-hmc-doing-legend]").waitFor();
  await busyCard.locator('[data-hmc-doing-key="1:1-2"][data-hmc-doing-start]').click();
  await busy.page.waitForTimeout(250);
  eq(busy.calls.set.length, 1, "模具互斥：送出 1 次");
  ok((await toastText(busy.page)).includes("共用模具"), `模具互斥：toast 顯示中文白話（${await toastText(busy.page)}）`);
  eq(await busyCard.locator('[data-hmc-doing-key="1:1-2"][data-hmc-doing-start]').isDisabled(), false, "失敗後按鈕可再按");
  await busy.context.close();

  // 6) read failure: strip unaffected, nothing new shown.
  const bad = await open({ doing: "true", readResponse: { not: "the contract" } });
  await bad.page.waitForTimeout(300);
  eq(await bad.page.locator('[data-hmc-pallet-strip="B01"]').count(), 1, "讀 doing 失敗：盤號條照常顯示");
  eq(await bad.page.locator(".doing-pill, .doing-dot, .doing-actions, .hmc-doing-legend").count(), 0, "讀 doing 失敗：不顯示任何新東西");
  eq(bad.errors.length, 0, "讀 doing 失敗：沒有頁面錯誤");
  await bad.context.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`PASS: ${checks} HMC pallet doing browser assertions`);
