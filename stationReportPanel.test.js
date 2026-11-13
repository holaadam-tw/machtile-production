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
  machtileTranslate: (key, params = {}) => (key === "report_first_step_overrun"
    ? `這次比開單數量多 ${params.n} 件（開單 ${params.order} 件）。第一道不限數量，可以直接送出。` : key),
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

// Owner 2026-11-13 first-step overrun (batch / non-simple panel path): allowed preview + Details keys →
// one reminder line; the confirm button is the same long-press confirm, no ack button.
const allowedPreview = (extraDetails = {}) => ({
  command_type: "report_preview", status: "previewed",
  preview_result: { allowed: true, hard: false, guard_code: null, message: "可送出", available: 161,
    legacy_snapshot: { report: { guard: { code: "", hard: false, Details: { available: 161, ...extraDetails } } } } },
});
const overrunKeys = { first_step_overrun: true, over_available_qty: 2, overrun_order_qty: 161, reported_after: 163, over_order_qty: 2 };
html = render("A04", order, row(allowedPreview(overrunKeys)), false);
panels.push(`<h2>第一道超量提醒</h2>${html}`);
assert.equal((html.match(/data-first-step-overrun-notice/g) || []).length, 1);
assert.match(html, /這次比開單數量多 2 件（開單 161 件）。第一道不限數量，可以直接送出。/);
assert.match(html, /data-station-report-confirm="A04"/);
assert.doesNotMatch(html, /data-station-report-preview-ack|FIRST_STEP_OVERRUN/);
const plainHtml = render("A04", order, row(allowedPreview()), false);
assert.doesNotMatch(plainHtml, /data-first-step-overrun-notice/);
assert.equal(html.replace(/<p class="report-limit-hint first-step-overrun-notice"[^>]*>[^<]*<\/p>/, ""), plainHtml, "only the reminder line differs");

// Coordinator 2026-11-13: non-first step with a previous station. Batch card: when the hard-quantity
// max sentence applies, the old 「目前最多可報…（上一道…）」 hint is not rendered; otherwise it stays.
const qtyStart = source.indexOf("function machtileBatchQtyLimit(");
const qtyEnd = source.indexOf("async function machtileBatchSendSmartReport(", qtyStart);
assert(qtyStart >= 0 && qtyEnd > qtyStart, "batch qty limit helper exists");
const batchContext = { ...context, machtileTranslate: (key, params = {}) => key === "report_limit_available_station"
  ? `目前最多可報 ${params.available} 件（上一道 ${params.station} 已報 ${params.reported} 件）` : key };
const renderBatch = vm.runInNewContext(`${source.slice(qtyStart, qtyEnd)}
${panelSource}
 machtileRenderStationReportPanel`, batchContext);
const prevFields = { available: 30, previous_station_code: "A01", previous_step_name: "車床", previous_reported_good: 100 };
const qtyBlocked = { command_type: "report_preview", status: "previewed",
  preview_result: { allowed: false, hard: true, guard_code: "QTY_EXCEEDS_AVAILABLE", message: "x", ...prevFields,
    legacy_snapshot: { report: { guard: { code: "QTY_EXCEEDS_AVAILABLE", hard: true, Details: { available: 30, tol: 0, requested: 38 } } } } } };
const batchRow = (result) => ({ operatorId: "u1", current: "958", good: "38", bad: "0", reportNote: "", stationReport: { phase: "previewed", result, preview: result, args: {}, error: "" } });
html = renderBatch("A04", order, batchRow(qtyBlocked), false, { batch: true });
assert.doesNotMatch(html, /data-report-limit-hint|目前最多可報/, "blocked with max sentence → old hint hidden");
const noField = batchRow(qtyBlocked); noField.current = "";
html = renderBatch("A04", order, noField, false, { batch: true });
assert.match(html, /data-report-limit-hint[^>]*>目前最多可報 30 件（上一道 A01 已報 100 件）/, "no max sentence (fallback) → old hint exactly as today");
const allowed = { command_type: "report_preview", status: "previewed",
  preview_result: { allowed: true, hard: false, guard_code: null, message: "可送出", ...prevFields,
    legacy_snapshot: { report: { guard: { code: "", hard: false, Details: { available: 30 } } } } } };
html = renderBatch("A04", order, batchRow(allowed), false, { batch: true });
assert.match(html, /data-report-limit-hint[^>]*>目前最多可報 30 件（上一道 A01 已報 100 件）/, "unblocked preview → old hint unchanged");

if (process.env.PANEL_HTML_OUT) fs.writeFileSync(process.env.PANEL_HTML_OUT,
  `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${pathToFileURL(require("node:path").resolve("styles.css"))}"><body style="max-width:680px;margin:24px auto">${panels.join("<hr>")}</body></html>`, "utf8");

console.log("STATION_REPORT_PANEL PASS");
