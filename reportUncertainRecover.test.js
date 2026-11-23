const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");
const start = source.indexOf("async function machtileRecoverUncertainReportRun");
const end = source.indexOf("\nwindow.addEventListener(\"online\"", start);
assert.ok(start > 0 && end > start, "minimal recovery implementation is present");

const UUID = "11111111-1111-4111-8111-111111111111";
const baseArgs = Object.freeze({ p_command_uuid: UUID, p_preview: false, p_good_qty: 3, p_fail_qty: 1,
  p_expected_order_no: "MO-1",
  p_previous_outsource_receipt_qty: 2, p_expected_doc4_fingerprint: "doc4-fp",
  p_acks: ["OLD_ORDER_NEWER_OPEN"], p_operator_ids: ["op-1"], p_client_guard_snapshot: { index: 7 } });

function harness({ rows = [], readError = null, enabled = true, waitResult = null, replacementArgs = null } = {}) {
  const flow = { args: structuredClone(baseArgs), finalOrder: { id: "MO-1" }, phase: "submitting-report", error: "" };
  const calls = { reads: [], submits: [], waits: 0, handled: 0, finalized: 0, finalizedArgs: null, rendered: 0 };
  const core = { commandReadPath: (uuid) => `station_commands?command_uuid=eq.${uuid}`,
    isTerminal: (row) => ["applied", "rejected", "expired"].includes(row?.status) };
  const context = { console, structuredClone, machtileReportRecoveryInFlight: new Map(),
    machtileReportUncertainRecoverEnabled: () => enabled, machtileStationReportCore: () => core,
    machtileBatchRow: () => ({ stationReport: flow }), machtileStationReportState: (row) => row.stationReport,
    machtileRenderStationReportSurfaces: () => { calls.rendered += 1; },
    supabaseFetch: async (path) => { calls.reads.push(path); if (readError) throw readError; return rows; },
    machtileStationReportWait: async () => { calls.waits += 1; if (waitResult) { flow.result = waitResult; flow.phase = "finished"; } },
    machtileHandleOutsourceReceiptResult: async () => { calls.handled += 1; if (replacementArgs) flow.args = structuredClone(replacementArgs); },
    machtileStationReportFinalizeApplied: async (_code, args) => { calls.finalized += 1; calls.finalizedArgs = structuredClone(args); },
    machtileRecordReportRecoveryDiagnostic: () => {},
    machtileStationReportBlockAfterUncertainFailure: (target, error) => { target.phase = "blocked"; target.error = String(error); },
    machtileStationReportOrderForCode: () => ({ id: "fallback" }),
    machtileStationReportSendFinal: async (_code, args, options) => { calls.submits.push({ args: structuredClone(args), options }); } };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.recover = machtileRecoverUncertainReport; this.resend = machtileResendUncertainReport;`, context);
  return { flow, calls, recover: context.recover, resend: context.resend };
}

test("absent UUID enters recovery-ready without any automatic resend", async () => {
  const h = harness();
  await h.recover("A01", { deferFollowUp: true });
  assert.equal(h.flow.phase, "recovery-ready");
  assert.match(h.flow.recoveryMessage, /上一筆沒有送到工廠/);
  assert.equal(h.calls.submits.length, 0);
});

test("manual resend preserves every arg and the stored final order", async () => {
  const h = harness();
  await h.recover("A01");
  const original = structuredClone(h.flow.args);
  assert.equal(await h.resend("A01"), true);
  assert.deepEqual(h.calls.submits[0].args, original);
  assert.equal(h.calls.submits[0].options.order.id, "MO-1");
  assert.equal(h.calls.submits.length, 1);
});

test("manual resend blocks when the selected order no longer matches the final args", async () => {
  const h = harness();
  await h.recover("A01");
  h.flow.finalOrder = { id: "MO-2" };
  assert.equal(await h.resend("A01"), false);
  assert.equal(h.flow.phase, "blocked");
  assert.match(h.flow.error, /工單已切換/);
  assert.equal(h.calls.submits.length, 0);
});

test("existing applied row follows ordinary result handling without resend", async () => {
  const h = harness({ rows: [{ command_uuid: UUID, command_type: "report", status: "applied" }] });
  await h.recover("A01");
  assert.equal(h.flow.phase, "finished");
  assert.equal(h.calls.handled, 1);
  assert.equal(h.calls.submits.length, 0);
  assert.equal(h.calls.finalized, 1);
});

test("existing applied row finalizes the receipt replacement UUID", async () => {
  const replacementArgs = { ...baseArgs, p_command_uuid: "22222222-2222-4222-8222-222222222222" };
  const h = harness({ rows: [{ command_uuid: UUID, command_type: "report", status: "applied" }], replacementArgs });
  await h.recover("A01");
  assert.equal(h.calls.finalizedArgs.p_command_uuid, replacementArgs.p_command_uuid);
});

test("existing pending row follows ordinary wait", async () => {
  const h = harness({ rows: [{ command_uuid: UUID, status: "pending" }], waitResult: { command_uuid: UUID, status: "applied" } });
  await h.recover("A01");
  assert.equal(h.calls.waits, 1);
  assert.equal(h.flow.phase, "finished");
});

test("status-read network failure remains manual recovery-ready", async () => {
  const h = harness({ readError: new TypeError("Failed to fetch") });
  await h.recover("A01");
  assert.equal(h.flow.phase, "recovery-ready");
  assert.match(h.flow.recoveryMessage, /網路不通/);
  assert.equal(h.calls.submits.length, 0);
});

test("flag off performs no read, write, or state change", async () => {
  const h = harness({ enabled: false });
  const before = structuredClone(h.flow);
  assert.equal(await h.recover("A01"), false);
  assert.deepEqual(h.flow, before);
  assert.equal(h.calls.reads.length + h.calls.submits.length, 0);
});
