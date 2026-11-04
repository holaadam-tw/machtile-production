import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const moduleUrl = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const imported = await import(moduleUrl);
const { chromium } = imported.default || imported;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json" };
const UUID = "11111111-1111-4111-8111-111111111111";

test("uncertain report recovery runs through the real APP", async (t) => {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (pathname === "/config.js") {
        res.writeHead(200, { "content-type": types[".js"] });
        res.end('window.MACHTILE_CONFIG={authMode:"dev",useSupabase:false,disableServiceWorker:true,oauthEnabled:false,enableStationReport:true,enableReportUncertainRecover:true};');
        return;
      }
      const rel = pathname === "/" ? "index.html" : pathname.slice(1);
      const body = await readFile(path.join(root, rel));
      res.writeHead(200, { "content-type": types[path.extname(rel)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof machtileRecoverUncertainReport === "function");

  const run = (fixture) => page.evaluate(async ({ fixture, uuid }) => {
    window.MACHTILE_CONFIG.enableReportUncertainRecover = fixture.enabled !== false;
    const args = fixture.args || {
      p_command_uuid: uuid, p_preview: false, p_machine_code: "A01", p_good_qty: 3,
      p_fail_qty: 1, p_fail_reason_code: "刮傷", p_report_note: "note", p_acks: ["OLD_ORDER_NEWER_OPEN"],
      p_previous_outsource_receipt_qty: 2, p_expected_doc4_fingerprint: "doc4-fp",
      p_operator_ids: ["op-1", "op-2"], p_client_guard_snapshot: { index: 7 },
    };
    const flow = { args: structuredClone(args), phase: "blocked", error: "uncertain", singleReport: { overlayTotal: 9 } };
    const row = { stationReport: flow };
    const calls = { reads: [], submits: [], recorded: 0, closed: 0, waits: 0, overlay: 0 };
    let submitIndex = 0;
    window.MachTileStationReportCore = {
      commandReadPath: (id) => `station_commands?command_uuid=eq.${id}`,
      isTerminal: (item) => ["applied", "rejected", "expired"].includes(item?.status),
      resultCard: (item) => ({ kind: item?.status === "applied" ? "applied" : "rejected" }),
      createClient: () => ({ submit: async (sent) => {
        calls.submits.push(structuredClone(sent));
        if (fixture.submitGate) await new Promise((resolve) => setTimeout(resolve, 25));
        const answer = (fixture.submits || [])[submitIndex++];
        if (answer?.error) throw new Error(answer.error);
        return answer;
      } }),
    };
    machtileBatchRow = () => row;
    machtileRenderStationReportSurfaces = () => {};
    supabaseFetch = async (requestPath) => { calls.reads.push(requestPath); if (fixture.readError) throw new Error(fixture.readError); return fixture.rows || []; };
    machtileStationReportWait = async () => { calls.waits += 1; if (fixture.waitError) throw new Error(fixture.waitError); };
    machtileHandleOutsourceReceiptResult = async () => {};
    machtileRecordSingleStationProductionReport = async () => { calls.recorded += 1; };
    machtileFinishCloseAfterAppliedReport = async () => { calls.closed += 1; };
    machtileCardQtyOverlayRecord = () => { calls.overlay += 1; };
    const beforeHtml = document.body.innerHTML;
    const beforeStorage = localStorage.getItem("machtile.reportRecoveryDiagnostics.v1");
    const promises = Array.from({ length: fixture.concurrent || 1 }, () => machtileRecoverUncertainReport(fixture.code || "A01"));
    const results = await Promise.all(promises);
    const manualResult = fixture.manualResend ? await machtileResendUncertainReport(fixture.code || "A01") : null;
    const background = document.querySelector("[data-station-report-background-message]");
    return { results, manualResult, flow, calls, args, beforeHtml, afterHtml: document.body.innerHTML,
      beforeStorage, afterStorage: localStorage.getItem("machtile.reportRecoveryDiagnostics.v1"),
      background: background?.textContent || "" };
  }, { fixture, uuid: UUID });

  const applied = { command_uuid: UUID, command_type: "report", status: "applied" };
  const resend = await run({ rows: [], submits: [applied], manualResend: true });
  assert.equal(resend.manualResult, true, JSON.stringify(resend.flow));
  assert.deepEqual(resend.calls.submits, [resend.args], "receipt/doc4/acks/operators/snapshot and all other final args are preserved");
  assert.equal(resend.calls.recorded, 1);
  assert.equal(resend.calls.closed, 1, "recovery performs finish-close exactly once");
  assert.equal(resend.calls.overlay, 1);
  assert.match(resend.background, /工廠已完成寫入/, "a previous background failure is replaced by success");

  const noAutomatic = await run({ code: "A06", rows: [], submits: [applied] });
  assert.equal(noAutomatic.flow.phase, "recovery-ready");
  assert.equal(noAutomatic.calls.submits.length, 0, "absent UUID never auto-resends");
  assert.equal(noAutomatic.calls.closed, 0);

  const concurrent = await run({ code: "A02", rows: [], concurrent: 2 });
  assert.equal(concurrent.calls.reads.length, 1, "two simultaneous checks share one read");
  assert.equal(concurrent.calls.submits.length, 0);

  const pendingFailure = await run({ code: "A03", rows: [{ command_uuid: UUID, status: "pending" }], waitError: "poll failed" });
  assert.equal(pendingFailure.flow.phase, "blocked");
  assert.match(pendingFailure.flow.error, /poll failed/);

  const falseRecovery = await run({ code: "A04", args: { p_command_uuid: UUID, p_preview: true } });
  assert.equal(falseRecovery.results[0], false);
  assert.equal(falseRecovery.calls.submits.length, 0);

  const flagOff = await run({ code: "A05", enabled: false });
  assert.equal(flagOff.results[0], false);
  assert.equal(flagOff.beforeStorage, flagOff.afterStorage, "flag off writes no recovery diagnostics");
  assert.equal(flagOff.beforeHtml, flagOff.afterHtml, "flag off leaves the real APP DOM unchanged");

  const busy = await page.evaluate(() => ["recovering-report", "recovery-ready"].every((phase) => machtileStationReportFlowBusy({ phase })));
  assert.equal(busy, true, "both recovery phases lock the station");
  const classifications = await page.evaluate(() => ({
    backend: machtileReportErrorMayBeUncertain({ code: "STATION_REPORT_BACKEND_UNAVAILABLE" }),
    operator: machtileReportErrorMayBeUncertain({ code: "OPERATOR_REQUIRED" }),
    invalid: machtileReportErrorMayBeUncertain({ code: "INVALID_REPORT_QTY" }),
    conflict: machtileReportErrorMayBeUncertain({ code: "COMMAND_UUID_CONFLICT" }),
    reject: machtileReportErrorMayBeUncertain({ code: "ITEM_CLOSED" }),
    network: machtileReportErrorMayBeUncertain(new TypeError("Failed to fetch")),
    timeout: machtileReportErrorMayBeUncertain({ code: "ETIMEDOUT" }),
    server: machtileReportErrorMayBeUncertain({ status: 503, code: "ETIMEDOUT" }),
  }));
  assert.deepEqual(classifications, { backend: false, operator: false, invalid: false, conflict: false, reject: false, network: true, timeout: true, server: false });

  const sendCase = (mode) => page.evaluate(async ({ mode, uuid }) => {
    window.MACHTILE_CONFIG.enableReportUncertainRecover = true;
    const args = { p_command_uuid: uuid, p_preview: false, p_machine_code: "A01", p_good_qty: 3, p_fail_qty: 0 };
    const flow = { args: structuredClone(args), phase: "previewed", finalOrder: { id: "MO-1" } };
    const row = { stationReport: flow };
    const receiptUuid = "22222222-2222-4222-8222-222222222222";
    window.MachTileStationReportCore = {
      commandReadPath: (id) => `station_commands?command_uuid=eq.${id}`,
      isTerminal: () => false,
      resultCard: () => ({ kind: "blocked" }),
      createClient: () => ({ submit: async () => {
        if (mode === "receipt-network") flow.args = { ...args, p_command_uuid: receiptUuid };
        if (mode === "http-400") { const error = new Error("OPERATOR_REQUIRED"); error.status = 400; error.code = "OPERATOR_REQUIRED"; throw error; }
        throw new TypeError("Failed to fetch");
      } }),
    };
    machtileBatchRow = () => row;
    supabaseFetch = async () => [];
    machtileRenderStationReportSurfaces = () => {};
    await machtileStationReportSendFinal("A01", args, { order: flow.finalOrder });
    return { phase: flow.phase, error: flow.error || "", recoveryMessage: flow.recoveryMessage || "", argsUuid: flow.args.p_command_uuid };
  }, { mode, uuid: UUID });

  const network = await sendCase("network");
  assert.equal(network.phase, "recovery-ready", "real TypeError with no HTTP response enters manual recovery");
  const http400 = await sendCase("http-400");
  assert.equal(http400.phase, "blocked", "HTTP 400 keeps legacy blocked behavior");
  assert.match(http400.error, /OPERATOR_REQUIRED/);
  const receiptNetwork = await sendCase("receipt-network");
  assert.equal(receiptNetwork.phase, "blocked", "a receipt-generated UUID is excluded from recovery");
  assert.equal(receiptNetwork.argsUuid, "22222222-2222-4222-8222-222222222222");
});
