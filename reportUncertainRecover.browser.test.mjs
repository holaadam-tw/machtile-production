import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const moduleUrl = process.env.MACHTILE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const imported = await import(moduleUrl);
const { chromium } = imported.default || imported;
const appSource = await readFile(new URL("./app.js", import.meta.url), "utf8");
const start = appSource.indexOf("async function machtileRecoverUncertainReport");
const end = appSource.indexOf("\nwindow.addEventListener(\"online\"", start);
assert.ok(start > 0 && end > start, "recovery implementation is present");
const recoverySource = appSource.slice(start, end);
const UUID = "11111111-1111-4111-8111-111111111111";

test("uncertain report recovery works in a real browser runtime", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<main id="legacy">legacy UI</main>');
  await page.addScriptTag({ content: `
    const MACHTILE_REPORT_RECOVERY_MAX_ATTEMPTS = 3;
    var machtileReportRecoveryQueue = new Set();
    ${recoverySource}
    window.runRecoveryScenario = async function (fixture) {
      const flow = { args: { p_command_uuid: "${UUID}", p_preview: false, p_good_qty: 3, p_fail_qty: 0, p_acks: null }, phase: "blocked", error: "uncertain" };
      const calls = { reads: [], submits: [], recorded: 0, waits: 0 };
      let submitIndex = 0;
      const core = { commandReadPath: uuid => "station_commands?command_uuid=eq." + uuid, isTerminal: row => ["applied", "rejected", "expired"].includes(row && row.status) };
      window.machtileReportUncertainRecoverEnabled = () => fixture.enabled !== false;
      window.machtileStationReportCore = () => core;
      window.machtileBatchRow = () => ({});
      window.machtileStationReportState = () => flow;
      window.machtileRenderStationReportSurfaces = () => {};
      window.supabaseFetch = async path => { calls.reads.push(path); return fixture.rows || []; };
      window.machtileStationReportSubmitCommand = async args => { calls.submits.push(structuredClone(args)); const answer = (fixture.submits || [])[submitIndex++]; if (answer && answer.error) throw new Error(answer.error); return answer; };
      window.machtileStationReportWait = async () => { calls.waits += 1; };
      window.machtileHandleOutsourceReceiptResult = async () => {};
      window.machtileRecordSingleStationProductionReport = async () => { calls.recorded += 1; };
      window.machtileRecordReportRecoveryDiagnostic = (target, stage, error) => { target.recoveryDiagnostic = { stage, detail: String(error) }; };
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: fixture.online !== false });
      const before = { flow: structuredClone(flow), html: document.body.innerHTML };
      const result = await machtileRecoverUncertainReport("A01");
      return { result, flow, calls, queued: machtileReportRecoveryQueue.has("A01"), before, html: document.body.innerHTML };
    };
  ` });

  const applied = { command_uuid: UUID, command_type: "report", status: "applied" };
  const resend = await page.evaluate((row) => runRecoveryScenario({ rows: [], submits: [row] }), applied);
  assert.deepEqual(resend.calls.submits, [{ p_command_uuid: UUID, p_preview: false, p_good_qty: 3, p_fail_qty: 0, p_acks: null }], "network-uncertain recovery resends byte-equivalent arguments with the same UUID");
  assert.equal(resend.flow.phase, "finished");

  const existing = await page.evaluate((row) => runRecoveryScenario({ rows: [row], submits: [] }), applied);
  assert.equal(existing.calls.submits.length, 0, "an existing command completes without a duplicate submit");
  assert.equal(existing.flow.phase, "finished");

  const offline = await page.evaluate(() => runRecoveryScenario({ online: false, rows: [], submits: [] }));
  assert.equal(offline.flow.phase, "recovery-offline");
  assert.equal(offline.queued, true, "offline work is queued for the online handler");
  const online = await page.evaluate((row) => runRecoveryScenario({ online: true, rows: [], submits: [row] }), applied);
  assert.equal(online.flow.phase, "finished", "online retry completes the queued recovery path");

  const off = await page.evaluate(() => runRecoveryScenario({ enabled: false, rows: [], submits: [] }));
  assert.equal(off.result, false);
  assert.deepEqual(off.flow, off.before.flow, "flag off leaves application state unchanged");
  assert.equal(off.calls.reads.length + off.calls.submits.length, 0, "flag off performs no network read or write");
  assert.equal(off.html, off.before.html, "flag off leaves the legacy DOM byte-identical");
});
