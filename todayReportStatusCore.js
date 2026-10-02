// todayReportStatusCore.js — Monitor 最上方總覽格子的「今日報工狀態」（owner 2026-10-02 拍板）。
//
// 三格（時間一律台灣時間 Asia/Taipei，不看瀏覽器時區；台灣沒有日光節約，固定 +08:00）：
//   1. 今日未開工 N 台：有目前工單的機台（卡片有顯示工單；空閒、無工單不算），今天沒有 dailyStart。08:30 以前不計算（顯示「—」）。
//   2. 今日未報工 N 台（紅）：今天已開工的機台
//        13:00 以後還沒有今天的中午報工（noon）→ 計入；
//        20:45 以後還沒有今天的收工（finish）→ 計入；
//        同一台同時缺中午和收工只算 1 台。
//      13:00 以前不計算（顯示「—」）。
//   3. 未收工（可能加班）N 台（黃）：17:15～20:45（含 17:15、不含 20:45）已開工、還沒有 finish 的機台；
//      已經算進「今日未報工」（缺中午報工）的那台不重複算在這格（一台只出現在一格）。其他時段顯示「—」。
//   已經收工（finish）的機台不會因為沒有中午報工被算成未報工（提早收工＝今天結束了）。
//
// 一台機台的報工＝這台卡片上所有工單（目前工單＋「這台還掛 N 張」）的工序 id 今天的報工合起來看。
// 資料＝卡片底部「今日已開工／已收工」那一份查詢（production_reports 今天、report_type in dailyStart／noon／finish），不另外打 API。
// 報工時間＝ended_at（現場按送出的時間），沒有才用 created_at；跟卡片底部同一套。
//
// DOM 與 fetch 留在 app.js；這裡只做可測的決策。
(function attachMachTileTodayReportCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileTodayReportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileTodayReportCore() {
  "use strict";

  const TZ_OFFSET_MINUTES = 8 * 60; // Asia/Taipei，無日光節約
  const REPORT_TYPES = Object.freeze(["dailyStart", "noon", "finish"]);
  const BOUNDARY = Object.freeze({
    notStartedFrom: 8 * 60 + 30,  // 08:30
    noonFrom: 13 * 60,            // 13:00
    overtimeFrom: 17 * 60 + 15,   // 17:15
    finishDueFrom: 20 * 60 + 45,  // 20:45
  });
  const KINDS = Object.freeze(["notStarted", "unreported", "overtime"]);
  const LABEL = Object.freeze({
    notStarted: "今日未開工",
    unreported: "今日未報工",
    overtime: "未收工（可能加班）",
  });

  // 台灣時間的日期（YYYY-MM-DD）與當天第幾分鐘。不用 Intl：固定 +08:00，跟瀏覽器時區完全無關。
  function taipeiParts(value) {
    const ms = typeof value === "number" ? value : Date.parse(value);
    if (!Number.isFinite(ms)) return null;
    const shifted = new Date(ms + TZ_OFFSET_MINUTES * 60000);
    const date = shifted.toISOString().slice(0, 10);
    const minute = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
    return { date, minute };
  }

  function hhmm(minute) {
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  }

  // 現在是哪個時段：哪幾格要計算
  function phaseAt(nowMs) {
    const p = taipeiParts(nowMs);
    const m = p ? p.minute : 0;
    return {
      date: p ? p.date : "",
      minute: m,
      time: hhmm(m),
      notStartedActive: m >= BOUNDARY.notStartedFrom,
      noonDue: m >= BOUNDARY.noonFrom,
      overtimeWindow: m >= BOUNDARY.overtimeFrom && m < BOUNDARY.finishDueFrom,
      finishDue: m >= BOUNDARY.finishDueFrom,
    };
  }

  // production_reports 列 → 工序 id → 今天（台灣日期）有哪些報工類型
  function todayTypesByProcess(reports, nowMs) {
    const today = taipeiParts(nowMs)?.date;
    const map = new Map();
    (Array.isArray(reports) ? reports : []).forEach((r) => {
      if (!r || !r.process_id || !REPORT_TYPES.includes(r.report_type)) return;
      const at = taipeiParts(r.ended_at || r.created_at);
      if (!at || at.date !== today) return;
      const key = String(r.process_id);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(r.report_type);
    });
    return map;
  }

  // machines：[{ key, hasOrder, processIds: [] }]（key 通常是機台名稱；同一個 key 只算一次）
  // 回傳 { phase, notStarted, unreported, overtime }，每格 { kind, label, active, count, keys, tone, hint }；
  // active=false → 這個時段不計算（畫面顯示「—」，count=null）。
  function summarize({ machines, reports, nowMs } = {}) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const phase = phaseAt(now);
    const byProcess = todayTypesByProcess(reports, now);
    const notStarted = [];
    const unreported = [];
    const overtime = [];
    const reasons = {};
    const seen = new Set();
    (Array.isArray(machines) ? machines : []).forEach((machine) => {
      const key = String(machine?.key ?? "").trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const types = new Set();
      (Array.isArray(machine.processIds) ? machine.processIds : []).forEach((pid) => {
        const set = byProcess.get(String(pid));
        if (set) set.forEach((t) => types.add(t));
      });
      const started = types.has("dailyStart");
      const finished = types.has("finish");
      if (phase.notStartedActive && machine.hasOrder && !started) notStarted.push(key);
      if (!started) return;
      const missingNoon = phase.noonDue && !types.has("noon") && !finished;
      const missingFinishLate = phase.finishDue && !finished;
      if (missingNoon || missingFinishLate) {
        unreported.push(key);
        reasons[key] = [missingNoon ? "noon" : null, missingFinishLate ? "finish" : null].filter(Boolean);
        return;
      }
      if (phase.overtimeWindow && !finished) overtime.push(key);
    });
    const tile = (kind, active, keys, hint) => {
      const count = active ? keys.length : null;
      let tone = "na";
      if (active) tone = count === 0 ? "ok" : kind;
      return { kind, label: LABEL[kind], active, count, keys: active ? keys : [], tone, hint };
    };
    return {
      phase,
      notStarted: tile("notStarted", phase.notStartedActive, notStarted, phase.notStartedActive ? "有工單、今天沒開工" : "08:30 起計算"),
      unreported: Object.assign(
        tile("unreported", phase.noonDue, unreported, phase.noonDue ? (phase.finishDue ? "缺中午或收工報工" : "缺中午報工") : "13:00 起計算"),
        { reasons: phase.noonDue ? reasons : {} },
      ),
      overtime: tile("overtime", phase.overtimeWindow, overtime, phase.overtimeWindow ? "17:15–20:45 還沒收工" : "只在 17:15–20:45 計算"),
    };
  }

  // 這一秒到下一個切換點還有幾毫秒（給畫面排下一次重算；沒有需要也可以每分鐘重算）
  function msUntilNextBoundary(nowMs) {
    const p = taipeiParts(nowMs);
    if (!p) return 60000;
    const marks = [BOUNDARY.notStartedFrom, BOUNDARY.noonFrom, BOUNDARY.overtimeFrom, BOUNDARY.finishDueFrom, 24 * 60];
    const next = marks.find((m) => m > p.minute);
    const msIntoMinute = ((nowMs % 60000) + 60000) % 60000;
    return (next - p.minute) * 60000 - msIntoMinute;
  }

  return { TZ_OFFSET_MINUTES, REPORT_TYPES, BOUNDARY, KINDS, LABEL, taipeiParts, phaseAt, todayTypesByProcess, summarize, msUntilNextBoundary };
});
