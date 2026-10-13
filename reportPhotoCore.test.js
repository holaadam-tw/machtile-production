const assert = require("node:assert/strict");
const core = require("./reportPhotoCore.js");

assert.equal(core.validationError("workStart", false), "首次開工必須拍照。");
assert.equal(core.validationError("workStart", true), "");
assert.equal(core.validationError("finish", false), "");
assert.equal(core.validationError("abnormal", false), "");

const finishPhoto = { name: "finish.jpg" };
assert.equal(core.selectedPhoto("finish", null), null);
assert.deepEqual(core.selectedPhoto("finish", finishPhoto), {
  file: finishPhoto,
  kind: "finish_photo",
  label: "完工照片",
});
assert.equal(core.PHOTO_BY_TYPE.workStart.required, true);
assert.equal(core.PHOTO_BY_TYPE.finish.required, false);

console.log("REPORT_PHOTO_CORE PASS");
