(function attachMachTileCncProgramUploadCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileCncProgramUploadCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileCncProgramUploadCore() {
  "use strict";

  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const UPLOAD_ROLES = Object.freeze(["admin", "planner"]);
  const text = (value) => String(value ?? "").trim();

  function canUpload(role) {
    return UPLOAD_ROLES.includes(text(role).toLowerCase());
  }

  function validateFile(file) {
    if (!file) return { ok: false, code: "FILE_REQUIRED", message: "請先選擇 CNC 程式檔。" };
    const size = Number(file.size);
    if (!Number.isFinite(size) || size < 1) return { ok: false, code: "FILE_EMPTY", message: "檔案是空的，請重新選擇。" };
    if (size > MAX_FILE_BYTES) return { ok: false, code: "FILE_TOO_LARGE", message: "檔案超過 20MB 上限。" };
    return { ok: true, code: "OK", message: "" };
  }

  function sanitizeSegment(value, fallback = "file") {
    return text(value).normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || fallback;
  }

  function storagePath({ tenantId, workOrderNo, sha256, fileName }) {
    const tenant = text(tenantId);
    const hash = text(sha256).toLowerCase();
    if (!tenant || !/^[0-9a-f]{64}$/.test(hash)) return "";
    return `${tenant}/cnc-programs/${sanitizeSegment(workOrderNo, "work-order")}/${hash.slice(0, 16)}-${sanitizeSegment(fileName)}`;
  }

  function flattenVersions(programs) {
    return (Array.isArray(programs) ? programs : []).flatMap((program) => (
      Array.isArray(program?.cnc_program_versions) ? program.cnc_program_versions : []
    ).map((version) => ({ ...version, program_id: program.id, same_as_previous: Boolean(program.same_as_previous) })))
      .sort((left, right) => String(right.uploaded_at || "").localeCompare(String(left.uploaded_at || "")));
  }

  function latestProgram(programs) {
    return [...(Array.isArray(programs) ? programs : [])]
      .sort((left, right) => String(right.uploaded_at || right.updated_at || "").localeCompare(String(left.uploaded_at || left.updated_at || "")))[0] || null;
  }

  function cardMetadata(program) {
    const version = Number(program?.version || 0);
    const pathParts = text(program?.file_path).split("/");
    let fileName = pathParts[pathParts.length - 1] || "";
    try { fileName = decodeURIComponent(fileName); } catch {}
    fileName = fileName.replace(/^[0-9a-f]{16}-/i, "");
    return Object.freeze({
      fileName: fileName || "—",
      version: version > 0 ? `V${version}` : "—",
      previousVersion: program?.same_as_previous === true ? (version > 0 ? `V${version}` : "—") : (version > 1 ? `V${version - 1}` : "—"),
      sha256: text(program?.sha256),
      uploadedBy: text(program?.uploaded_by) || "—",
      uploadedAt: text(program?.uploaded_at) || "",
      sameAsPrevious: program?.same_as_previous === true,
    });
  }

  return Object.freeze({ MAX_FILE_BYTES, UPLOAD_ROLES, canUpload, validateFile, sanitizeSegment, storagePath, flattenVersions, latestProgram, cardMetadata });
});
