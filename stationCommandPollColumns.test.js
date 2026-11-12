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

const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const selects = [...source.matchAll(/station_commands\?select=([A-Za-z0-9_,:]+)/g)].map((m) => m[1]);
assert.ok(selects.length >= 5, `expected at least 5 station_commands selects, found ${selects.length}`);
let checked = 0;
for (const list of selects) {
  for (const item of list.split(",")) {
    const column = item.includes(":") ? item.split(":")[1] : item; // PostgREST alias:column
    assert.ok(COLUMNS.has(column), `station_commands has no column "${column}" (select=${list})`);
    checked += 1;
  }
}
console.log(`PASS station_commands select columns exist: ${selects.length} selects, ${checked} columns`);
