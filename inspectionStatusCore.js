(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MachTileInspectionStatusCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const TIME_ZONE = "Asia/Taipei";
  const AFTERNOON_CUTOFF_MINUTES = 16 * 60 + 30;
  function parts(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  }
  function taipeiDate(value = new Date()) { const p = parts(value); return p ? `${p.year}-${p.month}-${p.day}` : ""; }
  function taipeiTime(value) { const p = parts(value); return p ? `${p.hour}:${p.minute}` : ""; }
  function isAfterCutoff(value = new Date()) { const p = parts(value); return p ? Number(p.hour) * 60 + Number(p.minute) >= AFTERNOON_CUTOFF_MINUTES : false; }
  function tupleKey(value) { return [value?.workOrderId, value?.processId, value?.machineId].map((item) => String(item || "").trim()).join(":"); }
  function uniqueTuples(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).filter((value) => {
      const key = tupleKey(value);
      if (key.split(":").some((item) => !item) || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function queryPaths(values, date = taipeiDate(), chunkSize = 40) {
    const tuples = uniqueTuples(values), paths = [];
    for (let index = 0; index < tuples.length; index += chunkSize) {
      const or = tuples.slice(index, index + chunkSize).map((value) => `and(work_order_id.eq.${encodeURIComponent(value.workOrderId)},process_id.eq.${encodeURIComponent(value.processId)},machine_id.eq.${encodeURIComponent(value.machineId)})`).join(",");
      paths.push(`process_inspections?select=work_order_id,process_id,machine_id,inspected_at,result,source_url&inspection_date=eq.${encodeURIComponent(date)}&or=(${or})&order=inspected_at.desc`);
    }
    return paths;
  }
  function latestByTuple(rows) {
    const result = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const key = tupleKey({ workOrderId: row.work_order_id, processId: row.process_id, machineId: row.machine_id });
      const previous = result.get(key);
      if (!previous || new Date(row.inspected_at).getTime() > new Date(previous.inspected_at).getTime()) result.set(key, row);
    });
    return result;
  }
  function cardStatus(input) {
    if (!input?.enabled) return { kind: "hidden", label: "", attention: false };
    if (input.loadState === "loading") return { kind: "loading", label: "檢驗狀態讀取中", attention: false };
    if (input.loadState === "error") return { kind: "error", label: "檢驗狀態讀取失敗", attention: false };
    const row = input.latest || null;
    if (!row) { const attention = isAfterCutoff(input.now); return { kind: attention ? "missing-attention" : "missing", label: "今日未檢驗", attention }; }
    if (row.result === "skipped") return { kind: "skipped", label: "今日免檢", attention: false };
    const time = taipeiTime(row.inspected_at);
    if (row.result === "fail") return { kind: "fail", label: `今日檢驗異常 ${time}`, attention: true };
    return { kind: "pass", label: `今日已檢驗 ${time}`, attention: false };
  }
  return Object.freeze({ TIME_ZONE, AFTERNOON_CUTOFF_MINUTES, taipeiDate, taipeiTime, isAfterCutoff, tupleKey, uniqueTuples, queryPaths, latestByTuple, cardStatus });
});
