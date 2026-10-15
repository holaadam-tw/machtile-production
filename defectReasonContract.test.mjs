import assert from "node:assert/strict";
import fs from "node:fs";
import stationCore from "./stationReportCore.js";

const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const zh = JSON.parse(fs.readFileSync(new URL("./locales/zh-Hant.json", import.meta.url), "utf8"));
const vi = JSON.parse(fs.readFileSync(new URL("./locales/vi.json", import.meta.url), "utf8"));

assert.deepEqual(stationCore.FAIL_REASON_DEFAULTS, ["尺寸不良", "外觀", "刀具崩", "試刀", "材料不良", "其他"]);
assert.match(html, /id="reportFailReasonField"[^>]*hidden/);
assert.match(app, /visible = Number\(\$\("#defectQty"\)\?\.value \|\| 0\) > 0/);
assert.match(app, /if \(!reason\) return machtileTranslate\("report_fail_reason_required"\)/);
assert.match(app, /reason === "其他"/);
assert.match(app, /fail_reason_code: Number\(\$\("#defectQty"\)/);
assert.match(app, /fail_reason_code: args\.p_fail_reason_code \|\| null/);
assert.match(app, /data-batch-reason=/);
assert.match(app, /data-batch-note=/);
assert.match(app, /fail_reason_code:defectQty>0\?reason:null/);
assert.match(app, /machtileGeneralFailReasonApplies\(\)[\s\S]*!machtileSingleStationReportActive\(\)/);
for (const key of ["report_fail_reason_label", "report_fail_reason_placeholder", "report_fail_reason_required", "report_fail_reason_other_note_required", "report_fail_reason_note_label"]) {
  assert.equal(typeof zh[key], "string", `${key} zh-Hant`);
  assert.equal(typeof vi[key]?.value, "string", `${key} vi`);
  assert.equal(vi[key]?._draft, true, `${key} vi draft marker`);
}
console.log("PASS defect reason contract: centralized six reasons, conditional field, required Other note, general/A04 payload, zh-Hant/vi");
