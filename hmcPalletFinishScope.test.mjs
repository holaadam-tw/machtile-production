import assert from "node:assert/strict";
import fs from "node:fs";

const app=fs.readFileSync(new URL("./app.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("./index.html",import.meta.url),"utf8");
const zh=JSON.parse(fs.readFileSync(new URL("./locales/zh-Hant.json",import.meta.url),"utf8"));
const vi=JSON.parse(fs.readFileSync(new URL("./locales/vi.json",import.meta.url),"utf8"));

assert.match(app,/value="finish-all"/);
assert.match(app,/value="finish-partial"/);
assert.match(app,/p_report_type:finish\?"finish":"noon"/);
assert.match(app,/p_finish_scope:finish\?action\.slice\(7\):null/);
assert.match(app,/defectQty=Number\(hmcDefects\(\)\[key\]\|\|0\)/,"defect quantity remains this submission's increment");
assert.match(app,/\["B01","B02"\]\.includes\(hmcRouteMachineKey\(\)\)/,"HMC finish UI remains B-machine only");
const finishBlock=app.slice(app.indexOf("function hmcPalletReportEnabled"),app.indexOf("function hmcDailyQuantityStats"));
assert.doesNotMatch(finishBlock,/A0[1-9]/,"finish-scope block must not add A-machine allowlisting");
for(const key of ["hmc_pallet_report_noon_draft","hmc_pallet_report_finish_all_draft","hmc_pallet_report_finish_partial_draft"]){
  assert.equal(typeof zh[key],"string");
  assert.equal(vi[key]._draft,true);
}
assert.match(html,/app\.js\?v=20261015-hmc-finish-scope-r1/);
console.log("PASS HMC finish-scope UI contract: all/partial payload, increment defect, B-only boundary, i18n, cache bump");
