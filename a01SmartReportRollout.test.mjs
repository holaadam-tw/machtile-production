import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL("./config.js", import.meta.url), "utf8"), sandbox);
const config = sandbox.window.MACHTILE_CONFIG;

for (const key of [
  "finishCloseMachines",
  "standardFinishFlowMachines",
  "finishClaimStartComboMachines",
  "stationReportMachines",
]) {
  assert.deepEqual(Array.from(config[key]), ["A01", "A04"], `${key} rolls out only A01 after A04`);
}

assert.equal(config.stationReportMachines.includes("A01"), true, "A01 uses smart report");
for (const station of ["A02", "A03", "A05"]) {
  assert.equal(config.stationReportMachines.includes(station), false, `${station} keeps general report`);
}

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
assert.match(html, /config\.js\?v=20261023-a01-smart-report-r1/, "config cache key is bumped");
console.log("A01_SMART_REPORT_ROLLOUT PASS");
