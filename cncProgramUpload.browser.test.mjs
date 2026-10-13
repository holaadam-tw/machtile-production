import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const modSpec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const pw = await import(modSpec);
const { chromium } = pw.default || pw;
const coreSource = await readFile(path.join(root, "cncProgramUploadCore.js"), "utf8");
const appSource = await readFile(path.join(root, "app.js"), "utf8");
const indexSource = await readFile(path.join(root, "index.html"), "utf8");

let pass = 0;
const ok = (condition, message) => { if (!condition) throw new Error(message); pass += 1; console.log(`PASS ${message}`); };
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": req.url?.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8" });
  res.end(req.url?.endsWith("cncProgramUploadCore.js") ? coreSource : `<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/cncProgramUploadCore.js"></script>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);

const result = await page.evaluate(() => {
  const core = globalThis.MachTileCncProgramUploadCore;
  const root = document.getElementById("root");
  const render = (role) => {
    root.innerHTML = core.canUpload(role) ? '<div data-drop tabindex="0"><input type="file" hidden><span>20MB</span></div>' : '<p data-readonly>版本列表</p>';
    return { drop: Boolean(root.querySelector("[data-drop]")), readonly: Boolean(root.querySelector("[data-readonly]")) };
  };
  return {
    planner: render("planner"), admin: render("admin"), operator: render("operator"), manager: render("manager"),
    exactLimit: core.validateFile({ size: 20 * 1024 * 1024 }),
    overLimit: core.validateFile({ size: 20 * 1024 * 1024 + 1 }),
    path: core.storagePath({ tenantId: "11111111-1111-4111-8111-111111111111", workOrderNo: "WO-9", sha256: "f".repeat(64), fileName: "O9.NC" }),
  };
});
ok(result.planner.drop && result.admin.drop, "planner/admin see upload entry");
ok(!result.operator.drop && result.operator.readonly, "operator is read-only");
ok(!result.manager.drop && result.manager.readonly, "manager is not an owner-approved uploader");
ok(result.exactLimit.ok === true, "20MB is accepted in browser logic");
ok(result.overLimit.code === "FILE_TOO_LARGE", ">20MB is rejected before network");
ok(result.path.includes("/cnc-programs/WO-9/ffffffffffffffff-O9.NC"), "browser builds tenant/work-order/hash storage path");
ok(appSource.includes('data-cnc-work-order-drop') && appSource.includes('rpc/cnc_program_work_order_version_register'), "actual app wires drop zone to work-order upload RPC");
ok(indexSource.includes('cncProgramUploadCore.js?v=20261013-card-program-metadata-r1') && indexSource.includes('app.js?v=20261013-hide-daily-start-r2'), "HTML preserves card metadata core and cache-busts the merged app asset");
ok(indexSource.includes('stationReportCore.js?v=20261009-station-report-r2'), "HTML preserves main station-report core");

await browser.close();
await new Promise((resolve) => server.close(resolve));
console.log(`${pass}/${pass} PASS; real Chromium; localhost only`);
