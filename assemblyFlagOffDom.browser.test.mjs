// 組裝站報工「關」的時候，CNC 畫面 DOM 要跟 origin/main（f9ac7669，#159 之後）逐字相同。
// 「關」包含：旗標關；旗標開但租戶不明（示範模式沒有登入者）。依 outsourceStatusStrip 的做法：同一個靜態
// 伺服器，base 那一頁的 index.html／app.js／i18n.js／styles.css 換成 git show 的舊版，比對 body（去掉 script）。
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const baseRef = process.env.ASSEMBLY_DOM_BASE || "f9ac7669";
childProcess.execFileSync("git", ["rev-parse", "--verify", `${baseRef}^{commit}`], { cwd: root, stdio: "pipe" });
const files = ["index.html", "app.js", "i18n.js", "styles.css"];
const baseFiles = new Map(files.map((file) => [file, childProcess.execFileSync("git", ["show", `${baseRef}:${file}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 })]));
const mod = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright");
const { chromium } = mod.default || mod;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
let checks = 0;
const ok = (value, label) => { assert.ok(value, label); checks += 1; console.log(`PASS ${label}`); };
const server = createServer(async (req, res) => {
  const relative = new URL(req.url, "http://localhost").pathname.replace(/^\//, "") || "index.html";
  const file = path.join(root, decodeURIComponent(relative));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { const body = await readFile(file); res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
const blocked = [];
async function open(config, base = false) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") { blocked.push(url.href); return route.abort(); }
    const relative = url.pathname.replace(/^\//, "") || "index.html";
    if (relative === "config.js") return route.fulfill({ contentType: "text/javascript", body: `window.MACHTILE_CONFIG=${config};` });
    if (base && baseFiles.has(relative)) return route.fulfill({ contentType: mime[path.extname(relative)] || "application/octet-stream", body: baseFiles.get(relative) });
    return route.fallback();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid article").length > 0);
  await page.waitForTimeout(300);
  return { context, page, errors };
}
const bodyDom = (page) => page.evaluate(() => { const body = document.body.cloneNode(true); body.querySelectorAll("script").forEach((n) => n.remove()); return body.innerHTML.trimEnd(); }); // 多兩個 script 標籤拿掉後只在 body 尾端留下空白，不算畫面差異
const diffAt = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i += 1; if (i === a.length && a.length === b.length) i = -1; return i < 0 ? "" : `${JSON.stringify(a.slice(Math.max(0, i - 80), i + 120))} vs ${JSON.stringify(b.slice(Math.max(0, i - 80), i + 120))}`; };

try {
  const demo = "{useSupabase:false,disableServiceWorker:true}";
  const base = await open(demo, true);
  const baseDom = await bodyDom(base.page);
  for (const [label, cfg] of [
    ["旗標關", demo],
    ["旗標開但租戶不明（示範模式沒有登入者）", "{useSupabase:false,disableServiceWorker:true,assemblyReportEnabled:true,assemblyReportTenants:[\"a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f\"],assemblyStations:[\"F01\",\"G01\"]}"],
  ]) {
    const cur = await open(cfg);
    const dom = await bodyDom(cur.page);
    if (dom !== baseDom) console.log("DOM_DIFF", diffAt(dom, baseDom));
    ok(dom === baseDom, `${label}：CNC 畫面 body DOM 與 origin/main ${baseRef} 逐字相同`);
    ok(await cur.page.locator("[data-assembly-entry], #assemblyView").count() === 0, `${label}：沒有組裝入口與畫面`);
    ok(cur.errors.length === 0, `${label}：沒有頁面錯誤`);
    await cur.context.close();
  }
  await base.context.close();
  ok(blocked.length === 0, "沒有任何外部連線");
} finally {
  await browser.close();
  server.close();
}
console.log(`PASS: ${checks} assembly flag-off DOM assertions`);
