import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
const start = source.indexOf("const MACHTILE_FACTORY_TIME_ZONE");
const end = source.indexOf("function hmcNonNegativeInteger", start);
assert.ok(start >= 0 && end > start, "factory date helper must remain centralized");
const context = {};
vm.runInNewContext(`${source.slice(start, end)}; globalThis.result={ zone:MACHTILE_FACTORY_TIME_ZONE, format:machtileFactoryDateIso, hmc:hmcTodayDateIso };`, context);
assert.equal(context.result.zone, "Asia/Taipei");
assert.equal(context.result.format("2026-10-15T15:59:59.000Z"), "2026-10-15");
assert.equal(context.result.format("2026-10-15T16:00:00.000Z"), "2026-10-16");
assert.equal(context.result.format("2026-10-15T17:30:00+07:00"), "2026-10-15", "device in Asia/Ho_Chi_Minh cannot change factory date");
assert.equal(context.result.format("2026-10-15T23:30:00Z"), "2026-10-16", "UTC device crossing Taipei midnight uses Taipei date");
console.log("PASS factory YYYY-MM-DD is fixed to Asia/Taipei across UTC and Asia/Ho_Chi_Minh midnight boundaries");
