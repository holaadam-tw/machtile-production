const assert = require("node:assert/strict");
const core = require("./stationReportCore.js");

const UUID_PREVIEW = "11111111-1111-4111-8111-111111111111";
const UUID_REPORT = "22222222-2222-4222-8222-222222222222";
const UUID_RETRY = "33333333-3333-4333-8333-333333333333";
const COMPLETE_PREVIEW = {
  command_uuid: UUID_PREVIEW,
  status: "previewed",
  allowed: true,
  guard_code: null,
  hard: false,
  message: "可送出",
  available: 208,
  supply: 260,
  done_c: 52,
  prev_index_sn: 1,
  prev_kind: "INHOUSE",
  predicted_ac03_qty: 12,
  order_qty: 500,
  order_start: "2026-10-01",
  shown_at: "2026-10-07T10:00:00.000Z",
  legacy_snapshot: {
    report: {
      guard: {
        code: "",
        hard: false,
        message: "可送出",
        Details: { available: 208, supply: 260, done_c: 52, prev_index_sn: 1, prev_kind: "INHOUSE", predicted_ac03_qty: 12, order_start: "2026-10-01", effective_need: 500 },
      },
    },
  },
};

function validInput(overrides = {}) {
  return {
    machineCode: "a04",
    expectedOrderNo: "XX01202604140011",
    expectedIndexSn: 2,
    expectedPartNo: "GQ7Q",
    manufactureIiId: "MII-00042",
    expectedSimulationId: "Y011BG35APT0",
    goodQty: 90,
    failQty: 10,
    failReasonCode: "尺寸不良",
    reportNote: "",
    acks: [],
    clientGuardSnapshot: null,
    ...overrides,
  };
}

function check(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

check("report_enabled_machines is exact machine-code boolean map and fails closed", () => {
  assert.equal(core.reportMachineEnabled({ A04: true }, "a04"), true);
  assert.equal(core.reportMachineEnabled({ A04: 1 }, "A04"), false);
  assert.equal(core.reportMachineEnabled(["A04"], "A04"), false);
  assert.equal(core.reportMachineEnabled({}, "A04"), false);
  assert.equal(core.reportMachineEnabled(null, "A04"), false);
});

check("guard config must match the requested machine and exact enabled map", () => {
  const config = { machine_code: "A04", report_enabled: true, report_enabled_machines: { A04: true }, fail_reason_codes: ["尺寸不良"] };
  assert.equal(core.isGuardConfig(config, "A04"), true);
  assert.equal(core.isGuardConfig({ ...config, report_enabled: false }, "A04"), false);
  assert.equal(core.isGuardConfig({ ...config, machine_code: "A05" }, "A04"), false);
  assert.equal(core.isGuardConfig({ ...config, report_enabled_machines: { A04: 1 } }, "A04"), false);
});

check("legacy report identity maps only explicit bridge projection fields", () => {
  const projected = { legacy_index_sn: 2, manufacture_ii_id: "MII-00042", simulation_id: "Y011BG35APT0", process_order: 99 };
  assert.deepEqual(core.legacyIdentityFromProjection(projected), {
    expectedIndexSn: 2, manufactureIiId: "MII-00042", expectedSimulationId: "Y011BG35APT0",
  });
  for (const key of ["legacy_index_sn", "manufacture_ii_id", "simulation_id"]) {
    const missing = { ...projected };
    delete missing[key];
    assert.throws(() => core.legacyIdentityFromProjection(missing), { code: "REPORT_CONTEXT_REQUIRED" }, `missing ${key}`);
  }
});

check("submit payload follows the named report RPC contract exactly", () => {
  const args = core.buildSubmitArgs(validInput(), UUID_PREVIEW, true);
  assert.deepEqual(args, {
    p_command_uuid: UUID_PREVIEW,
    p_preview: true,
    p_machine_code: "A04",
    p_expected_order_no: "XX01202604140011",
    p_expected_index_sn: 2,
    p_expected_part_no: "GQ7Q",
    p_manufacture_ii_id: "MII-00042",
    p_expected_simulation_id: "Y011BG35APT0",
    p_good_qty: 90,
    p_fail_qty: 10,
    p_fail_reason_code: "尺寸不良",
    p_report_note: null,
    p_acks: null,
    p_client_guard_snapshot: null,
  });
  assert.deepEqual(Object.keys(args), [
    "p_command_uuid", "p_preview", "p_machine_code", "p_expected_order_no", "p_expected_index_sn",
    "p_expected_part_no", "p_manufacture_ii_id", "p_expected_simulation_id", "p_good_qty", "p_fail_qty",
    "p_fail_reason_code", "p_report_note", "p_acks", "p_client_guard_snapshot",
  ]);
});

check("invalid quantities, unknown reason, invalid ack and missing G4 note fail before RPC", () => {
  assert.throws(() => core.buildSubmitArgs(validInput({ goodQty: 0, failQty: 0 }), UUID_PREVIEW, true), { code: "INVALID_REPORT_QTY" });
  assert.throws(() => core.buildSubmitArgs(validInput({ goodQty: -1 }), UUID_PREVIEW, true), { code: "INVALID_REPORT_QTY" });
  assert.throws(() => core.buildSubmitArgs(validInput({ failReasonCode: "invented" }), UUID_PREVIEW, true), { code: "INVALID_FAIL_REASON" });
  assert.throws(() => core.buildSubmitArgs(validInput({ acks: ["NOT_ALLOWED"] }), UUID_PREVIEW), { code: "INVALID_ACK" });
  assert.throws(() => core.buildSubmitArgs(validInput({ acks: ["OLD_ORDER_NEWER_OPEN"] }), UUID_PREVIEW), { code: "REPORT_NOTE_REQUIRED" });
});

check("missing legacy identity fields block submit rather than guessing mappings", () => {
  assert.throws(() => core.buildSubmitArgs(validInput({ expectedIndexSn: null }), UUID_PREVIEW), { code: "REPORT_CONTEXT_REQUIRED" });
  assert.throws(() => core.buildSubmitArgs(validInput({ expectedOrderNo: "" }), UUID_PREVIEW), { code: "REPORT_CONTEXT_REQUIRED" });
  assert.throws(() => core.buildSubmitArgs(validInput({ manufactureIiId: null }), UUID_PREVIEW), { code: "REPORT_CONTEXT_REQUIRED" });
  assert.throws(() => core.buildSubmitArgs(validInput({ manufactureIiId: "" }), UUID_PREVIEW), { code: "REPORT_CONTEXT_REQUIRED" });
  assert.throws(() => core.buildSubmitArgs(validInput({ expectedSimulationId: null }), UUID_PREVIEW), { code: "REPORT_CONTEXT_REQUIRED" });
  assert.throws(() => core.buildSubmitArgs(validInput({ expectedSimulationId: "" }), UUID_PREVIEW), { code: "REPORT_CONTEXT_REQUIRED" });
  assert.throws(() => core.buildSubmitArgs(validInput({ expectedSimulationId: "X".repeat(21) }), UUID_PREVIEW), { code: "REPORT_CONTEXT_REQUIRED" });
  assert.throws(() => core.buildSubmitArgs(validInput(), "not-a-uuid"), { code: "COMMAND_UUID_REQUIRED" });
});

check("guard snapshot must be an object and stay within 16 KB", () => {
  assert.throws(() => core.buildSubmitArgs(validInput({ clientGuardSnapshot: [] }), UUID_PREVIEW), { code: "INVALID_GUARD_SNAPSHOT" });
  assert.throws(() => core.buildSubmitArgs(validInput({ clientGuardSnapshot: { note: "x".repeat(17000) } }), UUID_PREVIEW), { code: "INVALID_GUARD_SNAPSHOT" });
  const snapshot = { source: "preview", preview_command_uuid: UUID_PREVIEW, available: 208 };
  assert.deepEqual(core.buildSubmitArgs(validInput({ clientGuardSnapshot: snapshot }), UUID_REPORT).p_client_guard_snapshot, snapshot);
});

check("soft-guard retry uses a new UUID and adds only a contract ack", () => {
  const previous = core.buildSubmitArgs(validInput(), UUID_PREVIEW, false);
  const retried = core.retryWithAck(previous, "PREV_OUTSOURCE_UNCONFIRMED", UUID_RETRY);
  assert.equal(retried.p_command_uuid, UUID_RETRY);
  assert.equal(retried.p_preview, false);
  assert.deepEqual(retried.p_acks, ["PREV_OUTSOURCE_UNCONFIRMED"]);
  assert.throws(() => core.retryWithAck(previous, "PREV_OUTSOURCE_UNCONFIRMED", UUID_PREVIEW), { code: "COMMAND_UUID_REQUIRED" });
  assert.throws(() => core.retryWithAck(previous, "QTY_EXCEEDS_AVAILABLE", UUID_RETRY), { code: "INVALID_ACK" });
});

check("previewed is terminal only for report_preview and never displays applied", () => {
  const row = { command_uuid: UUID_PREVIEW, command_type: "report_preview", status: "previewed", preview_result: COMPLETE_PREVIEW };
  assert.equal(core.isTerminal(row), true);
  assert.equal(core.resultCard(row).kind, "previewed");
  assert.match(core.resultCard(row).message, /尚未寫入/);
  assert.equal(core.resultCard(row).values.available, 208);
  assert.equal(core.isTerminal({ command_type: "report", status: "previewed" }), false);
  assert.equal(core.resultCard({ command_type: "report", status: "applied", good_qty: 90 }).kind, "applied");
});

check("exact SoftNet preview serializer maps top-level fields and cross-checks nested details", () => {
  const complete = core.buildClientGuardSnapshot({ command_uuid: UUID_PREVIEW, command_type: "report_preview", status: "previewed", preview_result: COMPLETE_PREVIEW });
  assert.deepEqual(complete, {
    source: "preview", preview_command_uuid: UUID_PREVIEW, available: 208, supply: 260, done_c: 52,
    prev_index_sn: 1, prev_kind: "INHOUSE", predicted_ac03_qty: 12, order_qty: 500,
    order_start: "2026-10-01", shown_at: "2026-10-07T10:00:00.000Z",
  });
  const withoutAvailability = structuredClone(COMPLETE_PREVIEW);
  delete withoutAvailability.available;
  delete withoutAvailability.legacy_snapshot.report.guard.Details.available;
  assert.throws(() => core.buildClientGuardSnapshot({ command_uuid: UUID_PREVIEW, command_type: "report_preview", status: "previewed", preview_result: withoutAvailability }), { code: "PREVIEW_RESULT_INCOMPLETE" });
  assert.throws(() => core.buildClientGuardSnapshot({ command_uuid: UUID_PREVIEW, command_type: "report", status: "previewed", preview_result: COMPLETE_PREVIEW }), { code: "PREVIEW_RESULT_INCOMPLETE" });
  const mismatch = structuredClone(COMPLETE_PREVIEW);
  mismatch.available = 209;
  assert.throws(() => core.buildClientGuardSnapshot({ command_uuid: UUID_PREVIEW, command_type: "report_preview", status: "previewed", preview_result: mismatch }), { code: "PREVIEW_RESULT_MISMATCH" });
});

check("preview soft guard requires explicit ack and creates a new report UUID with snapshot", () => {
  const soft = structuredClone(COMPLETE_PREVIEW);
  soft.allowed = false;
  soft.guard_code = "PREV_OUTSOURCE_UNCONFIRMED";
  soft.hard = false;
  soft.message = "前一道委外狀態待確認";
  soft.legacy_snapshot.report.guard.code = soft.guard_code;
  soft.legacy_snapshot.report.guard.message = soft.message;
  const previewCommand = { command_uuid: UUID_PREVIEW, command_type: "report_preview", status: "previewed", preview_result: soft };
  const card = core.resultCard(previewCommand);
  assert.equal(card.kind, "preview-soft");
  assert.equal(card.guardCode, "PREV_OUTSOURCE_UNCONFIRMED");
  const previewArgs = core.buildSubmitArgs(validInput(), UUID_PREVIEW, true);
  const retry = core.retryPreviewWithAck(previewArgs, previewCommand, card.guardCode, UUID_RETRY);
  assert.notEqual(retry.p_command_uuid, previewArgs.p_command_uuid);
  assert.equal(retry.p_preview, false);
  assert.deepEqual(retry.p_acks, ["PREV_OUTSOURCE_UNCONFIRMED"]);
  assert.equal(retry.p_client_guard_snapshot.preview_command_uuid, UUID_PREVIEW);
  assert.equal(retry.p_client_guard_snapshot.available, 208);
  assert.throws(() => core.retryPreviewWithAck(previewArgs, previewCommand, card.guardCode, UUID_PREVIEW), { code: "COMMAND_UUID_REQUIRED" });
});

check("preview hard deny and unknown deny remain blocked with no ack path", () => {
  const previewCommand = { command_uuid: UUID_PREVIEW, command_type: "report_preview", status: "previewed", preview_result: COMPLETE_PREVIEW };
  for (const [guardCode, hard] of [["QTY_EXCEEDS_AVAILABLE", true], ["UNRECOGNIZED_GUARD", false]]) {
    const denied = structuredClone(COMPLETE_PREVIEW);
    denied.allowed = false;
    denied.guard_code = guardCode;
    denied.hard = hard;
    denied.legacy_snapshot.report.guard.code = guardCode;
    denied.legacy_snapshot.report.guard.hard = hard;
    const row = { ...previewCommand, preview_result: denied };
    assert.equal(core.resultCard(row).kind, "preview-blocked");
    assert.throws(() => core.buildClientGuardSnapshot(row), { code: guardCode });
    assert.throws(() => core.retryPreviewWithAck(core.buildSubmitArgs(validInput(), UUID_PREVIEW, true), row, guardCode, UUID_RETRY), { code: "INVALID_ACK" });
  }
});

check("hard, soft, late-applied, and pending outcomes remain distinct", () => {
  assert.equal(core.resultCard({ command_type: "report", status: "rejected", reject_code: "QTY_EXCEEDS_AVAILABLE", reject_message: "先報前道" }).kind, "hard");
  assert.equal(core.resultCard({ command_type: "report", status: "rejected", reject_code: "PREV_OUTSOURCE_UNCONFIRMED" }).kind, "soft");
  assert.equal(core.resultCard({ command_type: "report", status: "rejected", reject_code: "LEGACY_APPLIED_LATE" }).kind, "applied-late");
  assert.equal(core.resultCard({ command_type: "report", status: "claimed" }).kind, "pending");
});

check("client calls only specified RPC args and reads command status by UUID", async () => {
  const calls = [];
  const client = core.createClient({ request: async (path, options) => {
    calls.push({ path, options });
    if (path.startsWith("rpc/")) return { command_uuid: UUID_PREVIEW, status: "pending" };
    return [{ command_uuid: UUID_PREVIEW, command_type: "report_preview", status: "previewed", preview_result: COMPLETE_PREVIEW }];
  } });
  await client.submit(core.buildSubmitArgs(validInput(), UUID_PREVIEW, true));
  const command = await client.read(UUID_PREVIEW);
  assert.equal(calls[0].path, "rpc/machtile_submit_station_report");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body).p_preview, true);
  assert.equal(calls[1].path, core.commandReadPath(UUID_PREVIEW));
  assert.equal(command.status, "previewed");
});

check("poll waits two seconds between pending states and returns previewed", async () => {
  let reads = 0;
  const delays = [];
  const client = core.createClient({
    request: async () => [{ command_uuid: UUID_PREVIEW, command_type: "report_preview", status: ++reads === 1 ? "claimed" : "previewed", preview_result: { available: 208 } }],
    delay: async (ms) => delays.push(ms),
  });
  const row = await client.waitForTerminal(UUID_PREVIEW, { maxAttempts: 3 });
  assert.equal(row.status, "previewed");
  assert.deepEqual(delays, [2000]);
});

check("missing RPC fails closed and never falls back to production_reports", async () => {
  const calls = [];
  const client = core.createClient({ request: async (path) => { calls.push(path); throw new Error("404 PGRST202 function not found"); } });
  await assert.rejects(client.submit(core.buildSubmitArgs(validInput(), UUID_REPORT)), { code: "STATION_REPORT_BACKEND_UNAVAILABLE" });
  assert.deepEqual(calls, ["rpc/machtile_submit_station_report"]);
});

check("config client calls the confirmed config RPC only", async () => {
  let call;
  const client = core.createClient({ request: async (path, options) => { call = { path, options }; return {}; } });
  await client.getGuardConfig("a04");
  assert.equal(call.path, "rpc/machtile_get_station_report_guard_config");
  assert.equal(call.options.method, "POST");
  assert.deepEqual(JSON.parse(call.options.body), { p_machine_code: "A04" });
});

console.log("STATION_REPORT_CONTRACT PASS");
