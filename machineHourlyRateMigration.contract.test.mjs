import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./docs/machine-hourly-rate-admin-20261017/migration.sql", import.meta.url), "utf8");
assert.match(sql, /v_role is distinct from 'admin'/i);
assert.match(sql, /p_hourly_rate<=0/i);
assert.match(sql, /p_hourly_rate>100000/i);
assert.match(sql, /round\(p_hourly_rate,2\)<>p_hourly_rate/i);
assert.match(sql, /for update/i);
assert.match(sql, /insert into public\.audit_logs/i);
assert.match(sql, /'machine\.hourly_rate'/i);
assert.match(sql, /revoke all on function public\.machine_hourly_rate_admin_set\(uuid,numeric\) from public,anon,authenticated,service_role/i);
assert.match(sql, /grant execute on function public\.machine_hourly_rate_admin_set\(uuid,numeric\) to authenticated/i);
assert.doesNotMatch(sql, /grant execute[^;]+to anon/i);
console.log("PASS migration contract: admin-only, bounded validation, row lock, audit, least-privilege grants");
