import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON
  ? pathToFileURL(process.env.PLAYWRIGHT_PACKAGE_JSON)
  : import.meta.url);
const { chromium } = require("playwright");
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 800, height: 900 } });
  const page = await context.newPage();
  await page.setContent('<style>body{margin:0;padding:24px;background:#f3f6fb;font:16px system-ui}.card{width:420px;padding:20px;border-radius:18px;background:#fff;box-shadow:0 8px 24px #18315322}.actions{display:flex;justify-content:flex-end}.link{border:1px solid #0671e8;border-radius:999px;padding:9px 14px;color:#0671e8;font-weight:800;text-decoration:none}</style><article class="card"><h2>A04 小瀧澤</h2><p>WO 100/甲 · 精銑 &amp; 去毛邊</p><div class="actions"><a id="inspection" class="link" target="_blank" rel="noopener">品檢／製程紀錄</a></div></article>');
  await page.addScriptTag({ content: await readFile(resolve("inspectionLinkCore.js"), "utf8") });
  await page.evaluate(() => {
    const href = MachTileInspectionLinkCore.buildUrl("https://holaadam-tw.github.io/I-Reporter/", { wo_id: "11111111-1111-4111-8111-111111111111", wo: "WO 100/甲", process_id: "22222222-2222-4222-8222-222222222222", process: "精銑 & 去毛邊", machine_id: "33333333-3333-4333-8333-333333333333", machine: "A04 小瀧澤", operator_id: "44444444-4444-4444-8444-444444444444", operator: "王小明", return_url: "https://app.machtile.com/" });
    document.querySelector("#inspection").href = href;
  });
  await mkdir("D:/04_SoftNet/ops/codex-inbox/shots", { recursive: true });
  await page.screenshot({ path: "D:/04_SoftNet/ops/codex-inbox/shots/20261013-ireporter-machine-card-p3-800px.png", fullPage: true });
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "品檢／製程紀錄" }).click();
  const popup = await popupPromise;
  assert.equal(new URL(popup.url()).searchParams.get("wo"), "WO 100/甲");
  assert.equal(new URL(popup.url()).searchParams.get("operator"), "王小明");
  console.log("PASS browser opens encoded I-Reporter link in a new tab at 800px");
} finally { await browser.close(); }
