const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");
const start = source.indexOf("async function machtileRecoverUncertainReport");
const end = source.indexOf("\nwindow.addEventListener(\"online\"", start);
assert.ok(start > 0 && end > start, "recovery implementation is present");

const UUID = "11111111-1111-4111-8111-111111111111";
const baseArgs = Object.freeze({ p_command_uuid: UUID, p_preview: false, p_good_qty: 3, p_fail_qty: 0, p_acks: null });

function harness({ rows = [], submits = [], online = true, enabled = true, waitResult = null } = {}) {
  const flow = { args: { ...baseArgs }, phase: "blocked", error: "uncertain" };
  const calls = { reads: [], submits: [], recorded: 0, waits: 0, rendered: 0, handled: 0 };
  let submitIndex = 0;
  const core = {
    commandReadPath: (uuid) => `station_commands?command_uuid=eq.${uuid}`,
    isTerminal: (row) => ["applied", "rejected", "expired"].includes(row?.status),
  };
  const context = {
    console, navigator: { onLine: online }, setTimeout: (fn) => { fn(); return 1; },
    MACHTILE_REPORT_RECOVERY_MAX_ATTEMPTS: 3,
    machtileReportRecoveryQueue: new Set(),
    machtileReportRecoveryInFlight: new Map(),
    machtileReportUncertainRecoverEnabled: () => enabled,
    machtileStationReportCore: () => core,
    machtileBatchRow: () => ({}),
    machtileStationReportState: () => flow,
    machtileRenderStationReportSurfaces: () => { calls.rendered += 1; },
    supabaseFetch: async (path) => { calls.reads.push(path); if (rows instanceof Error) throw rows; return rows; },
    machtileStationReportSubmitCommand: async (args) => {
      calls.submits.push(structuredClone(args));
      const answer = submits[submitIndex++];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    machtileStationReportWait: async () => { calls.waits += 1; if (waitResult) { flow.result = waitResult; flow.report = waitResult; flow.phase = "finished"; } },
    machtileHandleOutsourceReceiptResult: async () => { calls.handled += 1; },
    machtileRecordSingleStationProductionReport: async () => { calls.recorded += 1; },
    machtileStationReportFinalizeApplied: async () => { calls.recorded += 1; },
    machtileStationReportBlockAfterUncertainFailure: (target, error) => { target.phase = "blocked"; target.error = String(error?.message || error); },
    machtileRecordReportRecoveryDiagnostic: (target, stage, error) => { target.recoveryDiagnostic = { stage, detail: error.message }; },
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.recover = machtileRecoverUncertainReport;`, context);
  return { flow, calls, context, recover: context.recover };
}

test("network error, absent row: resends the exact same UUID and parameters", async () => {
  const applied = { command_uuid: UUID, command_type: "report", status: "applied" };
  const h = harness({ rows: [], submits: [applied] });
  const original = structuredClone(h.flow.args);
  await h.recover("A01");
  assert.deepEqual(h.calls.submits, [original]);
  assert.equal(h.flow.phase, "finished");
});

test("existing applied row completes without resend", async () => {
  const h = harness({ rows: [{ command_uuid: UUID, command_type: "report", status: "applied" }] });
  await h.recover("A01");
  assert.equal(h.calls.submits.length, 0);
  assert.equal(h.flow.phase, "finished");
});

test("existing pending row enters automatic polling", async () => {
  const h = harness({ rows: [{ command_uuid: UUID, command_type: "report", status: "pending" }], waitResult: { command_uuid: UUID, status: "applied" } });
  await h.recover("A01");
  assert.equal(h.calls.submits.length, 0);
  assert.equal(h.calls.waits, 1);
  assert.equal(h.flow.phase, "finished");
});

test("offline queues recovery; a later online retry sends it", async () => {
  const applied = { command_uuid: UUID, command_type: "report", status: "applied" };
  const h = harness({ online: false, rows: [], submits: [applied] });
  await h.recover("A01");
  assert.equal(h.flow.phase, "recovery-offline");
  assert.equal(h.context.machtileReportRecoveryQueue.has("A01"), true);
  h.context.navigator.onLine = true;
  await h.recover("A01");
  assert.equal(h.flow.phase, "finished");
});

test("resend is capped at three attempts and then asks for supervisor", async () => {
  const h = harness({ rows: new Error("HTTP 503"), submits: [new Error("down"), new Error("down"), new Error("down")] });
  await h.recover("A01");
  assert.equal(h.calls.submits.length, 3);
  assert.match(h.flow.error, /請通知主管/);
});

test("flag off makes no read, write, or state change", async () => {
  const h = harness({ enabled: false });
  const before = structuredClone(h.flow);
  assert.equal(await h.recover("A01"), false);
  assert.deepEqual(h.flow, before);
  assert.equal(h.calls.reads.length + h.calls.submits.length, 0);
});
