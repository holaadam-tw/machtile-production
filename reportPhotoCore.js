(function attachMachTileReportPhotoCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileReportPhotoCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileReportPhotoCore() {
  "use strict";

  const PHOTO_BY_TYPE = Object.freeze({
    workStart: Object.freeze({ inputId: "startPhoto", kind: "start_photo", label: "開工照片", required: true }),
    dailyStart: Object.freeze({ inputId: "machinePhoto", kind: "machine_photo", label: "機台照片", required: false }),
    finish: Object.freeze({ inputId: "finishPhoto", kind: "finish_photo", label: "完工照片", required: false }),
    abnormal: Object.freeze({ inputId: "abnormalPhoto", kind: "abnormal_photo", label: "異常照片", required: false }),
  });

  function validationError(type, hasPhoto) {
    return PHOTO_BY_TYPE[type]?.required && !hasPhoto ? "首次開工必須拍照。" : "";
  }

  function selectedPhoto(type, file) {
    const spec = PHOTO_BY_TYPE[type];
    return spec && file ? { file, kind: spec.kind, label: spec.label } : null;
  }

  return Object.freeze({ PHOTO_BY_TYPE, validationError, selectedPhoto });
});
