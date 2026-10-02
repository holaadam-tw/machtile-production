const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { cycleTimeToSend } = require("./reportCycleCore.js");

assert.equal(cycleTimeToSend("workStart", 550, 550), null, "unchanged prefilled first-start sample is not resent");
assert.equal(cycleTimeToSend("workStart", 551, 550), 551, "changed prefilled value is submitted");
assert.equal(cycleTimeToSend("workStart", 550, null), 550, "first value is submitted when there was no prior baseline");
assert.equal(cycleTimeToSend("workStart", 0, null), null, "blank/zero remains absent");
assert.equal(cycleTimeToSend("dailyStart", 550, 550), 550, "this helper does not suppress a non-first-start caller");
const app = readFileSync("./app.js", "utf8");
const html = readFileSync("./index.html", "utf8");
assert.match(app, /reportCycleSecondsToSend\(type\)[\s\S]*?MachTileReportCycleCore\.cycleTimeToSend/);
assert.match(app, /reportCyclePrefilledSeconds\s*=\s*Number\(profile\?\.pureCycleSec\)/);
assert.match(html, /reportCycleCore\.js\?v=20261002-first-cycle-noop[\s\S]*app\.js\?v=20261002-first-cycle-noop/);
console.log("PASS: first-start cycle submission rules and app wiring (8 assertions)");
