import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL("./config.js", import.meta.url), "utf8"), sandbox);
const config = sandbox.window.MACHTILE_CONFIG;
const expectedRollout = ["A01", "A04", "A05"];

for (const key of [
  "finishCloseMachines",
  "standardFinishFlowMachines",
  "finishClaimStartComboMachines",
  "stationReportMachines",
]) {
  assert.deepEqual(Array.from(config[key]), expectedRollout, `${key} matches the approved rollout set`);
}

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
assert.match(html, /config\.js\?v=20261023-a05-smart-report-r1/, "config cache key is bumped");
console.log("SMART_REPORT_ROLLOUT PASS");
