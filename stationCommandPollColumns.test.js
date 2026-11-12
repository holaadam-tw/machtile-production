// Guard: every station_commands column the app selects must exist in production.
// 2026-11-12 incident: #173 added a non-existent `preview` column to the status poll, so every poll
// failed with HTTP 400 and cards stayed on "waiting for factory" (no close confirmation shown).
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

// public.station_commands columns read from production on 2026-11-12 (information_schema.columns).
const COLUMNS = new Set(["id", "command_uuid", "tenant_id", "command_type", "machine_code", "expected_order_no",
  "expected_index_sn", "expected_part_no", "manufacture_ii_id", "operator_app_user_id", "operator_legacy_user_no",
  "requested_at", "status", "claimed_at", "claimed_by", "applied_at", "reject_code", "reject_message",
  "legacy_snapshot", "submitted_role", "good_qty", "fail_qty", "fail_reason_code", "report_note", "acks",
  "expected_simulation_id", "client_guard_snapshot", "preview_result", "pool_item_id", "replace_stopped",
  "stop_note_id", "stop_reason_code", "allow_takeover", "stop_note", "operator_display_name", "short_completion",
  "previous_outsource_receipt_qty", "expected_doc4_fingerprint", "operator_legacy_user_nos"]);

const selects = fs.readdirSync(__dirname).filter((name) => name.endsWith(".js")).flatMap((name) => {
  const source = fs.readFileSync(path.join(__dirname, name), "utf8");
  return [...source.matchAll(/station_commands\?select=([A-Za-z0-9_,:]+)/g)].map((m) => ({ name, list: m[1] }));
});
assert.ok(selects.length >= 5, `expected at least 5 station_commands selects, found ${selects.length}`);
let checked = 0;
for (const { name, list } of selects) {
  for (const item of list.split(",")) {
    const column = item.includes(":") ? item.split(":")[1] : item; // PostgREST alias:column
    assert.ok(COLUMNS.has(column), `${name}: station_commands has no column "${column}" (select=${list})`);
    checked += 1;
  }
}
// return_claim poll (CONTRACT-P2 §6): must be picked up by the scan above (so it is written as one literal in
// returnClaimCore.js) and must be exactly the list the cloud repo pins in return_claim_poll_select.txt.
const returnClaimSelects = selects.filter((entry) => entry.name === "returnClaimCore.js");
assert.equal(returnClaimSelects.length, 1, "returnClaimCore.js must contain exactly one literal station_commands select");
assert.equal(returnClaimSelects[0].list, "command_uuid,command_type,machine_code,pool_item_id,expected_order_no,expected_index_sn,status,requested_at,claimed_at,applied_at,reject_code,reject_message,legacy_snapshot");
// The cloud fixture itself is vendored in this repo (fixtures/return_claim_poll_select.txt, header names source file + commit),
// so this comparison does not depend on another worktree being on the machine.
const vendoredReturnClaimSelect = fs.readFileSync(path.join(__dirname, "fixtures", "return_claim_poll_select.txt"), "utf8")
  .split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
assert.deepEqual(vendoredReturnClaimSelect, [returnClaimSelects[0].list], "returnClaimCore.js select == vendored cloud fixture");
assert.equal(require("./returnClaimCore.js").POLL_SELECT, returnClaimSelects[0].list, "the path the app polls uses that same literal");
console.log(`PASS station_commands select columns exist: ${selects.length} selects, ${checked} columns`);

// dispatch_pool_items: every column the app selects must exist. The list is the table as the checked-in cloud migrations
// build it (machtile-mini-mes 20261007120000_dispatch_pool_items.sql; later migrations add no column) -- NOT read from
// production information_schema. The App can only read rows RLS allows: same tenant, own department(s),
// status waiting or claimed (20261014035353_dispatch_pool_claimed_state_upgrade.sql).
const POOL_COLUMNS = new Set(["tenant_id", "source_key", "work_order_no", "process_order", "operation_name", "part_no", "part_name",
  "quantity", "due_date", "planned_start", "urgency", "department_code", "eligible_machine_codes", "source_status", "pooled_at",
  "status", "first_seen_at", "synced_at", "gone_at"]);
const poolSelects = fs.readdirSync(__dirname).filter((name) => name.endsWith(".js") && !name.endsWith(".test.js")).flatMap((name) => {
  const source = fs.readFileSync(path.join(__dirname, name), "utf8");
  return [...source.matchAll(/dispatch_pool_items\?select=([A-Za-z0-9_,:]*)/g)].map((m) => ({ name, list: m[1] }));
});
// app.js: the pool list and the assigned-status read (both already in production); returnClaimCore.js: the held-step lookup.
assert.deepEqual(poolSelects.map((entry) => entry.name).sort(), ["app.js", "app.js", "returnClaimCore.js"], "every dispatch_pool_items select is one of the three known literals");
let poolChecked = 0;
for (const { name, list } of poolSelects) {
  assert.ok(list.length > 0, `${name}: dispatch_pool_items select must be a literal column list`);
  for (const column of list.split(",")) {
    assert.ok(POOL_COLUMNS.has(column), `${name}: dispatch_pool_items has no column "${column}" (select=${list})`);
    poolChecked += 1;
  }
}
const heldSelect = poolSelects.find((entry) => entry.name === "returnClaimCore.js");
assert.equal(heldSelect.list, "source_key,work_order_no,process_order,status", "held-step lookup select");
const heldPrefix = require("./returnClaimCore.js").HELD_POOL_PATH_PREFIX;
assert.equal(heldPrefix, `dispatch_pool_items?select=${heldSelect.list}&status=eq.claimed&limit=1000&work_order_no=in.`, "the path the app uses is that same literal, claimed rows only");
// No dispatch_pool_items read may be assembled without a literal select (it would escape the scan above).
for (const name of fs.readdirSync(__dirname).filter((file) => file.endsWith(".js") && !file.endsWith(".test.js"))) {
  const source = fs.readFileSync(path.join(__dirname, name), "utf8");
  assert.equal([...source.matchAll(/dispatch_pool_items\?/g)].length, [...source.matchAll(/dispatch_pool_items\?select=[a-z]/g)].length, `${name}: every dispatch_pool_items query starts with a literal select`);
}
console.log(`PASS dispatch_pool_items select columns exist: ${poolSelects.length} selects, ${poolChecked} columns`);
