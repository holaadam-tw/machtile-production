const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const core = require("./stationReportCore.js");

const source = fs.readFileSync("app.js", "utf8");
const start = source.indexOf("function machtileRenderStationReportPanel(");
const end = source.indexOf("async function machtileStationReportWait(", start);
assert(start >= 0 && end > start, "station report panel source exists");
const panelSource = source.slice(start, end);
const order = { id: "XX01202601010001", partNo: "P-1", partName: "零件", process: "加工", processId: "process-2" };
const route = { quantity: 10, processes: [{ id: "process-1" }, { id: "process-2" }, { id: "process-3" }] };
const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const context = {
  machtileStationReportCore: () => ({ ...core, buildClientGuardSnapshot: () => ({}) }),
  machtileBatchState: { stationReportSettings: { status: "loaded", machines: { A04: true }, failReasonCodesByMachine: { A04: [] } }, users: [{ id: "u1", name: "操作員" }] },
  machtileStationReportState: (row) => row.stationReport,
  machtileStationReportContext: () => ({ expectedIndexSn: 2, expectedPartNo: "P-1" }),
  machtileStationReportMissingContext: () => [],
  machtileProcessFlows: new Map([[order.id, route]]),
  machtileFlowVisibilityLevel: () => "full",
  machtileProcessFlowMarkup: () => '<div class="route-marker">流程條</div>',
  window: { MachTileProcessFlow: { steps: () => [
    { id: "process-1", done: 10, current: false },
    { id: "process-2", done: 4, current: true },
    { id: "process-3", done: 0, current: false },
  ] } },
  machtileBatchMachineLabel: () => "A04",
  escapeHtml: htmlEscape,
  workOrderDetailUrl: (id) => `/orders/${id}`,
};
const render = vm.runInNewContext(`${panelSource}\n machtileRenderStationReportPanel`, context);
const row = (result, note = "") => ({ operatorId: "u1", good: 1, bad: 0, reportNote: note, stationReport: { phase: "finished", result, preview: result, args: {} } });
const preview = (code, message, hard, previousIndex = 0) => ({
  command_type: "report_preview", status: "previewed",
  preview_result: { allowed: false, hard, guard_code: code, message, available: 0,
    legacy_snapshot: { report: { guard: { code, hard, prev_index_sn: previousIndex } } } },
});

let html = render("A04", order, row(preview("QTY_EXCEEDS_AVAILABLE", "請先報前一道", true, 1)), false);
const panels = [`<h2>超量阻擋</h2>${html}`];
assert.match(html, /查看製程路線，先報第 1 道/);
assert.match(html, /第 2／共 3 道・本道累計已報 4／10 件/);
assert.match(html, /route-marker/);
assert.doesNotMatch(html, /QTY_EXCEEDS_AVAILABLE/);

html = render("A04", order, row(preview("OLD_ORDER_NEWER_OPEN", "同料號已有較新工單", false)), false);
panels.push(`<h2>舊單確認</h2>${html}`);
assert.match(html, /data-station-report-note="A04"/);
assert.doesNotMatch(html.match(/<textarea[^>]*data-station-report-note[^>]*>/)?.[0] || "", /disabled/);
assert.match(html, /同料號已有較新工單/);
assert.doesNotMatch(html, /OLD_ORDER_NEWER_OPEN/);

html = render("A04", order, row(preview("PREV_OUTSOURCE_UNCONFIRMED", "未結 4 件，可能使用倉別 a2", false)), false);
panels.push(`<h2>委外確認</h2>${html}`);
assert.match(html, /未結 4 件，可能使用倉別 a2/);
assert.doesNotMatch(html, /PREV_OUTSOURCE_UNCONFIRMED/);

if (process.env.PANEL_HTML_OUT) fs.writeFileSync(process.env.PANEL_HTML_OUT,
  `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${pathToFileURL(require("node:path").resolve("styles.css"))}"><body style="max-width:680px;margin:24px auto">${panels.join("<hr>")}</body></html>`, "utf8");

console.log("STATION_REPORT_PANEL PASS");
