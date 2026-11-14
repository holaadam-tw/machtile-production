// 上一道擋住：白話＋通知生管（prevStepNotifyCore.js）純邏輯＋ app.js / config 接線測試。不連任何後端。
// `node --test prevStepNotifyCore.test.js`
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("./prevStepNotifyCore.js");
const i18n = require("./i18n.js");

const zh = JSON.parse(fs.readFileSync(path.join(__dirname, "locales/zh-Hant.json"), "utf8"));
const vi = JSON.parse(fs.readFileSync(path.join(__dirname, "locales/vi.json"), "utf8"));
const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const previewBlocked = (details, extra = {}) => ({
  command_type: "report_preview", status: "previewed",
  preview_result: { allowed: false, hard: true, guard_code: "QTY_EXCEEDS_AVAILABLE", available: 42, requested: 60,
    previous_station_code: "A01", previous_step_name: "車床", previous_reported_good: 100,
    legacy_snapshot: { report: { guard: { code: "QTY_EXCEEDS_AVAILABLE", hard: true, Details: details } } }, ...extra },
});

test("flags default off in config.js and config.example.js", () => {
  for (const file of ["config.js", "config.example.js"]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    for (const flag of ["enablePrevStepBlockHint", "enablePrevStepNotify", "hideLegacyReportForStationMachines"]) {
      assert.match(source, new RegExp(`\\n\\s*${flag}: false,`), `${file} ${flag}`);
    }
  }
  assert.equal(core.hintEnabled({}), false);
  assert.equal(core.notifyEnabled({}), false);
  assert.equal(core.hintEnabled({ enablePrevStepNotify: true }), true, "notify implies the hint");
  assert.equal(core.boardAllowed({ enablePrevStepNotify: true }, "operator"), false);
  assert.equal(core.boardAllowed({ enablePrevStepNotify: true }, "planner"), true);
  assert.equal(core.boardAllowed({ enablePrevStepBlockHint: true }, "admin"), false, "board needs the notify flag");
});

test("report preview QTY_EXCEEDS_AVAILABLE from previous machine names machine, step and short qty", () => {
  const info = core.blockInfo(previewBlocked({ prev_index_sn: 3, prev_kind: "INHOUSE", previous_station_code: "A01", previous_step_name: "車床", blocked_short_qty: 18 }));
  assert.deepEqual(info, { code: "QTY_EXCEEDS_AVAILABLE", station: "A01", indexSn: 3, stepName: "車床", vendor: "", shortQty: 18, outsource: false });
  assert.deepEqual(core.message(info), { key: "prev_block_qty_station", params: { station: "A01", index: 3, step: "車床", vendor: "—", short: 18 } });
  assert.match(i18n.t("prev_block_qty_station", core.message(info).params), /^卡在上一道 A01（第 3 道，車床）：還差 18 件。請找 A01 先報工/);
});

test("older Factory without blocked_short_qty derives it from requested/available; missing station falls back", () => {
  const info = core.blockInfo(previewBlocked({ prev_index_sn: 3, prev_kind: "INHOUSE" }));
  assert.equal(info.shortQty, 18);
  assert.equal(info.station, "A01", "preview_result.previous_station_code (#1120)");
  const bare = core.blockInfo({ ...previewBlocked({ prev_index_sn: 2 }), preview_result: { allowed: false, guard_code: "QTY_EXCEEDS_AVAILABLE",
    legacy_snapshot: { report: { guard: { code: "QTY_EXCEEDS_AVAILABLE", Details: { prev_index_sn: 2 } } } } } });
  assert.deepEqual(core.message(bare), { key: "prev_block_qty_index", params: { station: "", index: 2, step: "—", vendor: "—", short: "?" } });
});

test("first step / order-limited QTY_EXCEEDS_AVAILABLE is not a previous-step block", () => {
  assert.equal(core.blockInfo(previewBlocked({ prev_index_sn: 0, prev_kind: "FIRST_INPUT" })), null);
  assert.equal(core.blockInfo(previewBlocked({})), null);
});

test("outsource previous step names vendor instead of a machine", () => {
  const info = core.blockInfo(previewBlocked({ prev_index_sn: 3, prev_kind: "OUTSOURCE", blocked_by_outsource: true, previous_step_name: "熱處理", previous_vendor_name: "協力廠", previous_station_code: "" }));
  assert.equal(info.outsource, true);
  assert.equal(info.station, "");
  assert.equal(core.message(info).key, "prev_block_qty_outsource");
  assert.match(i18n.t("prev_block_qty_outsource", core.message(info).params), /廠商 協力廠/);
});

test("final report reject reads legacy_snapshot.report.guard", () => {
  const row = { command_type: "report", status: "rejected", reject_code: "QTY_EXCEEDS_AVAILABLE",
    legacy_snapshot: { report: { guard: { code: "QTY_EXCEEDS_AVAILABLE", prev_index_sn: 2, details: { previous_station_code: "a05", previous_step_name: "車床", blocked_short_qty: 5 } } } } };
  assert.deepEqual(core.blockInfo(row), { code: "QTY_EXCEEDS_AVAILABLE", station: "A05", indexSn: 2, stepName: "車床", vendor: "", shortQty: 5, outsource: false });
});

test("allowed / pending / unrelated rows give null", () => {
  assert.equal(core.blockInfo({ ...previewBlocked({ prev_index_sn: 3 }), preview_result: { allowed: true } }), null);
  assert.equal(core.blockInfo({ command_type: "report", status: "pending" }), null);
  assert.equal(core.blockInfo({ command_type: "report", status: "rejected", reject_code: "LEGACY_STATE_INCONSISTENT" }), null);
  assert.equal(core.blockInfo(null), null);
  assert.equal(core.blockInfo({ command_type: "start", status: "rejected", reject_code: "PREVIOUS_STEP_OPEN" }), null);
});

test("close PREVIOUS_STEP_OPEN uses the Factory snapshot (#1149) and degrades without it", () => {
  const withStation = core.blockInfo({ command_type: "close", status: "rejected", reject_code: "PREVIOUS_STEP_OPEN",
    legacy_snapshot: { guard: { code: "PREVIOUS_STEP_OPEN", hard: false }, previous_station_code: "A05", previous_index_sn: 2 } });
  assert.deepEqual(core.message(withStation), { key: "prev_block_close_station", params: { station: "A05", index: 2, step: "—", vendor: "—", short: "?" } });
  assert.equal(i18n.t("prev_block_close_station", core.message(withStation).params), "上一道 A05（第 2 道）還沒關站。請找 A05 關站，或找生管。");
  const older = core.blockInfo({ command_type: "close", status: "rejected", reject_code: "PREVIOUS_STEP_OPEN", legacy_snapshot: {} });
  assert.equal(core.message(older).key, "prev_block_close_generic");
});

test("outsource receipt required uses the receipt snapshot", () => {
  const row = { command_type: "report_preview", status: "rejected", reject_code: "PREV_OUTSOURCE_RECEIPT_REQUIRED" };
  const info = core.blockInfo(row, { receipt: { previousStepName: "熱處理", receiptRequiredQty: 30, receiptSteps: [{ indexSn: 2, processName: "熱處理", vendorName: "協力廠" }] } });
  assert.deepEqual(info, { code: "PREV_OUTSOURCE_RECEIPT_REQUIRED", station: "", indexSn: 2, stepName: "熱處理", vendor: "協力廠", shortQty: 30, outsource: true });
  assert.equal(core.message(info).key, "prev_block_receipt");
});

test("notify payload is validated and matches the cloud RPC contract", () => {
  const info = core.blockInfo(previewBlocked({ prev_index_sn: 3, previous_station_code: "A01", previous_step_name: "車床", blocked_short_qty: 18 }));
  const payload = core.buildNotifyPayload(info, { machineCode: "a03", workOrderNo: "XX01202606120005", processOrder: 4, messageText: "m" });
  assert.deepEqual(Object.keys(payload).sort(), ["blocking_machine_code", "blocking_process_order", "blocking_step_name", "blocking_vendor_name",
    "machine_code", "message", "process_order", "reason_code", "short_qty", "work_order_no"]);
  assert.equal(payload.machine_code, "A03");
  assert.equal(payload.blocking_machine_code, "A01");
  assert.equal(payload.process_order, 4);
  assert.equal(core.buildNotifyPayload(info, { machineCode: "A03", workOrderNo: "", processOrder: 4, messageText: "m" }), null);
  assert.equal(core.buildNotifyPayload(info, { machineCode: "A03", workOrderNo: "X", processOrder: null, messageText: "m" }), null);
  assert.equal(core.buildNotifyPayload(info, { machineCode: "A03", workOrderNo: "X", processOrder: 1, messageText: "" }), null);
  assert.equal(core.buildNotifyPayload(null, { machineCode: "A03", workOrderNo: "X", processOrder: 1, messageText: "m" }), null);
  assert.equal(core.buildNotifyPayload(info, { machineCode: "A03", workOrderNo: "X", processOrder: 1, messageText: "x".repeat(900) }).message.length, 500);
});

test("notify result / error keys", () => {
  assert.equal(core.notifyResultKey({ result: "created" }), "prev_block_notify_sent");
  assert.equal(core.notifyResultKey({ result: "repeated" }), "prev_block_notify_sent");
  assert.equal(core.notifyResultKey({ result: "throttled" }), "prev_block_notify_already");
  assert.equal(core.notifyResultKey(null), "prev_block_notify_failed");
  assert.equal(core.notifyErrorKey(new Error("404 PGRST202")), "prev_block_notify_unavailable");
  assert.equal(core.notifyErrorKey(new Error("MACHINE_NOT_ALLOWED")), "prev_block_notify_not_allowed");
  assert.equal(core.notifyErrorKey(new Error("boom")), "prev_block_notify_failed");
});

test("board line", () => {
  const line = core.boardLine({ id: "n1", machine_code: "A03", work_order_no: "XX1", process_order: 3, reason_code: "PREVIOUS_STEP_OPEN",
    blocking_machine_code: "A05", blocking_process_order: 2, notify_count: 2, last_notified_at: "2026-11-14T08:00:00Z", status: "open", message: "m" });
  assert.equal(line.machine, "A03");
  assert.equal(line.count, 2);
  assert.equal(line.message.key, "prev_block_close_station");
  assert.equal(core.boardLine({ reason_code: "OTHER" }), null);
});

test("legacy direct report is blocked only for smart-report A/B machines with the flag on (REPORT #9)", () => {
  const on = { hideLegacyReportForStationMachines: true, enableStationReport: true, stationReportMachines: ["A01", "A03", "B03"] };
  assert.equal(core.legacyReportBlocked(on, "a03", "noon"), true);
  assert.equal(core.legacyReportBlocked(on, "B03", "finish"), true);
  assert.equal(core.legacyReportBlocked(on, "A03", "dailyStart"), false, "today-start is not a quantity report");
  assert.equal(core.legacyReportBlocked(on, "B01", "noon"), false, "not on the smart-report list");
  assert.equal(core.legacyReportBlocked(on, "F01", "noon"), false, "not an A/B machine");
  assert.equal(core.legacyReportBlocked({ ...on, stationReportMachines: ["*"] }, "A02", "noon"), true);
  assert.equal(core.legacyReportBlocked({ ...on, hideLegacyReportForStationMachines: false }, "A03", "noon"), false);
  assert.equal(core.legacyReportBlocked({ ...on, enableStationReport: false }, "A03", "noon"), false);
});

test("every i18n key the core can return exists in both languages", () => {
  const keys = ["prev_block_qty_station", "prev_block_qty_station_noshort", "prev_block_qty_outsource", "prev_block_qty_index",
    "prev_block_close_station", "prev_block_close_generic", "prev_block_receipt", "prev_block_notify", "prev_block_notify_sending",
    "prev_block_notify_sent", "prev_block_notify_already", "prev_block_notify_failed", "prev_block_notify_unavailable",
    "prev_block_notify_not_allowed", "prev_block_board_title", "prev_block_board_empty", "prev_block_board_unavailable",
    "prev_block_board_row", "prev_block_board_count", "prev_block_board_resolve", "legacy_report_blocked"];
  for (const key of keys) {
    assert.equal(typeof zh[key], "string", `zh ${key}`);
    assert.equal(vi[key]?._draft, true, `vi ${key}`);
    assert.notEqual(i18n.t(key), key, `i18n.js ${key}`);
    assert.match(app + fs.readFileSync(path.join(__dirname, "prevStepNotifyCore.js"), "utf8"), new RegExp(`"${key}"`), `${key} referenced`);
  }
});

test("app.js wiring: script loaded, RPC names, flag-gated", () => {
  assert.match(html, /<script src="\.\/prevStepNotifyCore\.js\?v=[^"]+"><\/script>/);
  assert.ok(html.indexOf("prevStepNotifyCore.js") < html.indexOf("./app.js?v="), "core loads before app.js");
  assert.match(html, /<section id="prevStepBoard"[^>]* hidden><\/section>/);
  assert.equal(core.NOTIFY_RPC, "machtile_notify_prev_step_block");
  assert.equal(core.LIST_RPC, "machtile_prev_step_block_notices");
  assert.equal(core.RESOLVE_RPC, "machtile_resolve_prev_step_block_notice");
  assert.match(app, /if \(!machtilePrevStepCore \|\| !machtilePrevStepCore\.hintEnabled\(config\) \|\| !row\) return "";/);
  assert.match(app, /if \(machtileLegacyReportBlocked\(selectedOrder\.machine, activeReportType\)\) return;/);
});
