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
// app.js: the pool list and the assigned-status read (both already in production). The held-step lookup no longer reads this
// table (a claim Factory has acknowledged is 'gone' and RLS hides it): it calls the read-only RPC checked further down.
assert.deepEqual(poolSelects.map((entry) => entry.name).sort(), ["app.js", "app.js"], "every dispatch_pool_items select is one of the two known literals");
let poolChecked = 0;
for (const { name, list } of poolSelects) {
  assert.ok(list.length > 0, `${name}: dispatch_pool_items select must be a literal column list`);
  for (const column of list.split(",")) {
    assert.ok(POOL_COLUMNS.has(column), `${name}: dispatch_pool_items has no column "${column}" (select=${list})`);
    poolChecked += 1;
  }
}
// Held-step lookup: one RPC, no select. Its name and the row fields the core reads must be what the cloud migration
// (machtile-mini-mes 20261113100000_held_pool_claims_rpc.sql) declares: returns table(machine_code, work_order_no,
// process_order, source_key, claimed_at). The list is vendored here; when the cloud worktree is on this machine the
// migration itself is read (git show origin/main) and must agree.
const HELD_RPC_COLUMNS = ["machine_code", "work_order_no", "process_order", "source_key", "claimed_at"];
const returnClaimCore = require("./returnClaimCore.js");
assert.equal(returnClaimCore.HELD_CLAIMS_RPC, "machtile_held_pool_claims", "held-step lookup RPC name");
assert.equal(returnClaimCore.HELD_POOL_PATH_PREFIX, undefined, "the dispatch_pool_items claimed-row lookup is gone");
assert.equal(returnClaimCore.heldPoolPath, undefined, "the dispatch_pool_items claimed-row lookup is gone");
const returnClaimSource = fs.readFileSync(path.join(__dirname, "returnClaimCore.js"), "utf8");
const heldFn = returnClaimSource.slice(returnClaimSource.indexOf("function heldPoolKey("), returnClaimSource.indexOf("// ---------------------------------------------------------------- 卡片要不要出現"));
const heldFields = [...new Set([...heldFn.matchAll(/\b(?:row|hits\[0\])\.([a-z_]+)/g)].map((m) => m[1]))].sort();
assert.deepEqual(heldFields, ["machine_code", "process_order", "source_key", "work_order_no"], "row fields the held-step resolver reads");
for (const field of heldFields) assert.ok(HELD_RPC_COLUMNS.includes(field), `machtile_held_pool_claims() returns no column "${field}"`);
const appSourceForRpc = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
// Two call sites, both by the core's constant: the card-details loader (return claim / switch step phase 1) and the started
// switch-step sheet (phase 2, enableSwitchStepStarted), which reads the same row fields through returnClaimCore.heldPoolKey.
assert.equal([...appSourceForRpc.matchAll(/machtileReturnClaimCore\.HELD_CLAIMS_RPC/g)].length, 2, "app.js calls the held-step RPC in exactly two places, by the core's constant");
assert.equal([...appSourceForRpc.matchAll(/machtileReturnClaimCore\.heldPoolKey\(/g)].length, 2, "both read the RPC rows through the same resolver");
// switch_step phase 2 (started): the result is polled through returnClaimCore.pollPath (the same literal select as return_claim).
// The new columns station_commands.target_index_sn / target_pool_item_id (cloud 20261114090000) are never selected: they are not in
// the production column list above until that migration is applied, and selecting them would 400 every poll (the #176 incident).
const startedSection = appSourceForRpc.slice(appSourceForRpc.indexOf("// ==== 換道次（已開工、還沒報工；第 2 階段）"), appSourceForRpc.indexOf("// ==== 換道次（已開工）到此 ===="));
assert.ok(startedSection.length > 1000, "app.js has the started switch-step section");
assert.equal([...startedSection.matchAll(/machtileReturnClaimCore\.pollPath\(/g)].length, 1, "the started switch-step poll uses returnClaimCore.pollPath");
assert.ok(!COLUMNS.has("target_index_sn") && !COLUMNS.has("target_pool_item_id"), "the switch_step columns are not in the production list yet");
for (const { name, list } of selects) {
  assert.doesNotMatch(list, /(?:^|,)target_(?:index_sn|pool_item_id)(?:,|$)/, `${name}: no select reads the switch_step-only columns`);
}
const startedStationSelects = [...startedSection.matchAll(/station_commands\?select=([A-Za-z0-9_,:]+)/g)].map((m) => m[1]);
assert.equal(startedStationSelects.length, 2, "the started section reads station_commands twice (command history for the pool key, unpooled notices)");
assert.doesNotMatch(appSourceForRpc, /machtile_held_pool_claims\?|HELD_CLAIMS_RPC\}\?/, "the RPC is called without a query string (no select to cover)");
const cloudRepo = process.env.HELD_POOL_CLAIMS_CLOUD_REPO || "D:/04_SoftNet/wt-mini-return";
let cloudSql = "";
try {
  cloudSql = require("node:child_process").execFileSync("git", ["-C", cloudRepo, "show", "origin/main:supabase/migrations/20261113100000_held_pool_claims_rpc.sql"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch { /* cloud worktree not on this machine */ }
if (cloudSql) {
  const declared = /create function public\.machtile_held_pool_claims\(\)\s+returns table\(([^)]*)\)/.exec(cloudSql);
  assert.ok(declared, "cloud migration declares public.machtile_held_pool_claims() returns table(...)");
  assert.deepEqual(declared[1].split(",").map((part) => part.trim().split(/\s+/)[0]), HELD_RPC_COLUMNS, "vendored RPC column list == cloud migration");
  console.log(`PASS held-step RPC columns match the cloud migration: ${HELD_RPC_COLUMNS.length} columns`);
} else {
  console.log(`  (cloud repo not on this machine: ${cloudRepo}; held-step RPC columns compared with the vendored list)`);
}
// No dispatch_pool_items read may be assembled without a literal select (it would escape the scan above).
for (const name of fs.readdirSync(__dirname).filter((file) => file.endsWith(".js") && !file.endsWith(".test.js"))) {
  const source = fs.readFileSync(path.join(__dirname, name), "utf8");
  assert.equal([...source.matchAll(/dispatch_pool_items\?/g)].length, [...source.matchAll(/dispatch_pool_items\?select=[a-z]/g)].length, `${name}: every dispatch_pool_items query starts with a literal select`);
}
console.log(`PASS dispatch_pool_items select columns exist: ${poolSelects.length} selects, ${poolChecked} columns`);
