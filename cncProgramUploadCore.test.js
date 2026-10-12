const core = require("./cncProgramUploadCore.js");
const assert = require("node:assert/strict");

assert.equal(core.MAX_FILE_BYTES, 20971520);
assert.equal(core.canUpload("planner"), true);
assert.equal(core.canUpload("admin"), true);
assert.equal(core.canUpload("operator"), false);
assert.equal(core.canUpload("manager"), false);
assert.equal(core.validateFile({ size: 20971520 }).ok, true);
assert.deepEqual(core.validateFile({ size: 20971521 }), { ok: false, code: "FILE_TOO_LARGE", message: "檔案超過 20MB 上限。" });
assert.equal(core.storagePath({
  tenantId: "11111111-1111-4111-8111-111111111111", workOrderNo: "WO 100/甲", sha256: "a".repeat(64), fileName: "O100 測試.NC",
}), "11111111-1111-4111-8111-111111111111/cnc-programs/WO_100/aaaaaaaaaaaaaaaa-O100_.NC");
const versions = core.flattenVersions([{ id: "p1", same_as_previous: true, cnc_program_versions: [
  { id: "v1", version_no: "V1", uploaded_at: "2026-10-11T00:00:00Z" },
  { id: "v2", version_no: "V2", uploaded_at: "2026-10-12T00:00:00Z" },
] }]);
assert.deepEqual(versions.map((item) => [item.id, item.program_id, item.same_as_previous]), [["v2", "p1", true], ["v1", "p1", true]]);
console.log("9/9 PASS; CNC upload core positive/negative checks");
