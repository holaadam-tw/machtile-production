// analyticsCore.js — 「營運分析」頁上方三個區塊的純邏輯（owner 2026-10-02「分析頁改成有意義的分析，第一批 3 項」）。
//
//   1. 每台機台稼動率（今天／近 7 天）
//      在班時間 ＝ 當天第一筆「今日開工」到最後一筆「收工」；還沒收工：今天＝算到現在，但不超過下班時間
//                   （17:00；當天報工選了加班 17:30／20:30 就用那個時間）；以前的日子沒收工＝算到下班時間並標示。
//      純加工時間 ＝ Σ（良品＋不良）×「當時的機台加工時間」（同一道工序在這筆報工以前最新一次填的 cycle_time_seconds；
//                   沒有就用卡片上最新填的值）。
//      稼動率 ＝ 純加工時間 ÷ 在班時間；報工覆蓋 ＝ 有報工的時段（started_at～ended_at 的聯集，裁在在班時間內）÷ 在班時間。
//      沒開工、沒數量、沒填機台加工時間 → 不給數字，給原因（絕不顯示 0%）。
//   2. 每日產量：實際（App 報工良品合計）vs 估算（卡片每日估算 ＝ 430 分 ÷（機台時間＋上下料），照目前工單）。
//   3. 交期風險：剩餘 ＝ 訂單數量 − 已報（batchReportCore.cardProgress 口徑），每日速度＝近 7 天實際日產，
//      沒有就用估算（標「估算」）；預計完成日以工作天計（預設週一～週五，週六日不算）。
//
// 時間一律台灣時間（固定 +08:00，台灣沒有日光節約），不看瀏覽器時區。
// DOM 與 fetch 留在 app.js；這裡只做可測的決策。
(function attachMachTileAnalyticsCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileAnalyticsCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileAnalyticsCore() {
  "use strict";

  const TZ_MS = 8 * 3600 * 1000;
  const DAY_MS = 24 * 3600 * 1000;
  const WINDOW_DAYS = 7;
  // 沒收工時的下班時間（分）：一般 17:00；報工選了加班 17:30／20:30 就用那個時間
  const SHIFT_END_MINUTES = Object.freeze({ none: 17 * 60, "1730": 17 * 60 + 30, "2030": 20 * 60 + 30 });
  // 預設工作天：週一～週五（週六、週日不算；owner 2026-10-02「週六沒上班」）
  const DEFAULT_WORKDAYS = Object.freeze([1, 2, 3, 4, 5]);
  const TIGHT_DAYS = 3;
  const LOWEST_COUNT = 3;

  // ---- 時間 ----
  function toMs(value) {
    if (value === null || value === undefined || value === "") return NaN;
    if (typeof value === "number") return value;
    return Date.parse(value);
  }

  function taipeiDate(ms) {
    if (!Number.isFinite(ms)) return "";
    return new Date(ms + TZ_MS).toISOString().slice(0, 10);
  }

  function taipeiMinute(ms) {
    const d = new Date(ms + TZ_MS);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }

  function hhmm(ms) {
    const m = taipeiMinute(ms);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  // 台灣日期 YYYY-MM-DD 的 00:00 → epoch ms
  function dayStartMs(date) {
    return Date.parse(`${date}T00:00:00+08:00`);
  }

  function addDays(date, n) {
    return new Date(dayStartMs(date) + n * DAY_MS + TZ_MS).toISOString().slice(0, 10);
  }

  // 0＝週日 … 6＝週六
  function weekday(date) {
    return new Date(`${date}T00:00:00Z`).getUTCDay();
  }

  function daysBetween(fromDate, toDate) {
    return Math.round((dayStartMs(toDate) - dayStartMs(fromDate)) / DAY_MS);
  }

  // 近 N 天（含今天）的台灣日期，舊到新
  function windowDates(nowMs, days = WINDOW_DAYS) {
    const today = taipeiDate(nowMs);
    const list = [];
    for (let i = days - 1; i >= 0; i--) list.push(addDays(today, -i));
    return list;
  }

  // 查詢下限：近 N 天第一天的台灣 00:00（ISO）
  function windowStartIso(nowMs, days = WINDOW_DAYS) {
    return new Date(dayStartMs(windowDates(nowMs, days)[0])).toISOString();
  }

  function rangeDates(range, nowMs) {
    return range === "7d" ? windowDates(nowMs, WINDOW_DAYS) : [taipeiDate(nowMs)];
  }

  // 一筆報工的時間點：ended_at（現場按送出的時間），沒有才用 created_at（跟卡片底部同一套）
  function reportAtMs(r) {
    const e = toMs(r?.ended_at);
    return Number.isFinite(e) ? e : toMs(r?.created_at);
  }

  function qtyOf(r) {
    return Math.max(0, Number(r?.completed_qty) || 0) + Math.max(0, Number(r?.defect_qty) || 0);
  }

  function goodOf(r) {
    return Math.max(0, Number(r?.completed_qty) || 0);
  }

  function normCode(v) {
    return String(v ?? "").trim().toUpperCase();
  }

  // ---- 報工 → 機台 ----
  // 依序：報工自己的 machine_id → 工序的 machine_id（embed work_order_processes）→ 畫面上工序 id 對到的機台。
  function attachMachineCodes(reports, { codeByMachineId, codeByProcessId } = {}) {
    const byId = codeByMachineId instanceof Map ? codeByMachineId : new Map(Object.entries(codeByMachineId || {}));
    const byProc = codeByProcessId instanceof Map ? codeByProcessId : new Map(Object.entries(codeByProcessId || {}));
    let unknown = 0;
    const rows = (Array.isArray(reports) ? reports : []).map((r) => {
      const procMachine = r?.work_order_processes?.machine_id;
      const code = normCode(r?.machine_code)
        || normCode(byId.get(String(r?.machine_id || "")))
        || normCode(byId.get(String(procMachine || "")))
        || normCode(byProc.get(String(r?.process_id || "")));
      if (!code) unknown += 1;
      return { ...r, machine_code: code || "" };
    });
    return { rows, unknown };
  }

  // ---- 當時的機台加工時間 ----
  // rows：production_reports（cycle_time_seconds 不是 null）→ 每道工序依時間排好的 [{ atMs, seconds }]
  function buildCycleTimeIndex(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      const sec = Number(r?.cycle_time_seconds);
      if (!r?.process_id || !Number.isFinite(sec) || sec <= 0) return;
      const at = toMs(r.created_at);
      const key = String(r.process_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ atMs: Number.isFinite(at) ? at : -Infinity, seconds: Math.round(sec) });
    });
    map.forEach((list) => list.sort((a, b) => a.atMs - b.atMs));
    return map;
  }

  // 這筆報工（時間 atMs）當時的機台加工時間：這道工序在 atMs 以前（含）最新一次填的值 → 卡片上最新的值 → null
  function cycleTimeAt(index, processId, atMs, cardSeconds) {
    const list = index instanceof Map ? index.get(String(processId || "")) : null;
    if (list && list.length) {
      let found = null;
      for (const item of list) {
        if (item.atMs <= atMs) found = item;
        else break;
      }
      if (found) return { seconds: found.seconds, source: "history" };
    }
    const card = Number(cardSeconds);
    if (Number.isFinite(card) && card > 0) return { seconds: Math.round(card), source: "card" };
    return { seconds: null, source: null };
  }

  // ---- 區間聯集（ms）----
  function unionLength(intervals, lo, hi) {
    const list = intervals
      .map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
      .sort((x, y) => x[0] - y[0]);
    let total = 0;
    let cur = null;
    list.forEach(([a, b]) => {
      if (!cur) { cur = [a, b]; return; }
      if (a <= cur[1]) cur[1] = Math.max(cur[1], b);
      else { total += cur[1] - cur[0]; cur = [a, b]; }
    });
    if (cur) total += cur[1] - cur[0];
    return total;
  }

  // ---- 一台機台一天 ----
  // reps：這台這天（台灣日期）的報工。回傳在班時間、純加工、覆蓋。
  function machineDay({ reps, date, nowMs, cycleIndex, cardSecondsByProcess }) {
    const list = Array.isArray(reps) ? reps : [];
    const cardOf = (pid) => (cardSecondsByProcess instanceof Map ? cardSecondsByProcess.get(String(pid)) : cardSecondsByProcess?.[String(pid)]);
    const qty = list.reduce((s, r) => s + qtyOf(r), 0);
    const good = list.reduce((s, r) => s + goodOf(r), 0);
    const starts = list.filter((r) => r.report_type === "dailyStart").map(reportAtMs).filter(Number.isFinite);
    const finishes = list.filter((r) => r.report_type === "finish").map(reportAtMs).filter(Number.isFinite);
    const base = { date, qty, good, reportCount: list.length };
    if (!starts.length) {
      return { ...base, status: list.length ? (qty > 0 ? "noStart" : "noStartNoQty") : "notOpened" };
    }
    const start = Math.min(...starts);
    // 加班選項：這天報工裡最新一筆有填的 overtime_plan
    const plans = list
      .filter((r) => ["none", "1730", "2030"].includes(String(r.overtime_plan ?? "")))
      .sort((a, b) => reportAtMs(a) - reportAtMs(b));
    const plan = plans.length ? String(plans[plans.length - 1].overtime_plan) : "none";
    const capEnd = dayStartMs(date) + SHIFT_END_MINUTES[plan] * 60000;
    let end;
    let endKind;
    const lastFinish = finishes.length ? Math.max(...finishes) : NaN;
    if (Number.isFinite(lastFinish) && lastFinish > start) {
      end = lastFinish;
      endKind = "finish";
    } else if (date === taipeiDate(nowMs) && nowMs < capEnd) {
      end = nowMs;
      endKind = "now";
    } else {
      end = capEnd;
      endKind = "cap";   // 沒收工：算到下班時間
    }
    if (!(end > start)) return { ...base, status: "noShift", startMs: start, endMs: end, endKind, plan };
    const shiftSec = (end - start) / 1000;
    let pureSec = 0;
    let missingQty = 0;
    let cardFallbackQty = 0;
    list.forEach((r) => {
      const q = qtyOf(r);
      if (!(q > 0)) return;
      const ct = cycleTimeAt(cycleIndex, r.process_id, toMs(r.created_at) || reportAtMs(r), cardOf(r.process_id));
      if (ct.seconds === null) { missingQty += q; return; }
      if (ct.source === "card") cardFallbackQty += q;
      pureSec += q * ct.seconds;
    });
    const intervals = list
      .map((r) => [toMs(r.started_at), toMs(r.ended_at)])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);
    const coveredSec = unionLength(intervals, start, end) / 1000;
    return { ...base, status: "shift", startMs: start, endMs: end, endKind, plan, shiftSec, pureSec, missingQty, cardFallbackQty, coveredSec };
  }

  function groupByMachineDate(reports) {
    const map = new Map();
    (Array.isArray(reports) ? reports : []).forEach((r) => {
      const code = normCode(r?.machine_code);
      const at = reportAtMs(r);
      if (!code || !Number.isFinite(at)) return;
      const key = `${code}|${taipeiDate(at)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return map;
  }

  // ---- 1. 稼動率 ----
  // machines：[{ code, label? }]；reports 要先 attachMachineCodes；range："today"｜"7d"
  function machineUtilization({ machines, reports, cycleRows, cycleIndex, cardSecondsByProcess, nowMs, range = "today" } = {}) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    // 報工本身有填 cycle_time_seconds 的也算進去（跟另外查的歷史重複無妨）
    const index = cycleIndex instanceof Map ? cycleIndex : buildCycleTimeIndex([...(Array.isArray(cycleRows) ? cycleRows : []), ...(Array.isArray(reports) ? reports : [])]);
    const dates = rangeDates(range, now);
    const grouped = groupByMachineDate(reports);
    const isToday = range !== "7d";
    const rows = (Array.isArray(machines) ? machines : []).map((m) => {
      const code = normCode(m?.code);
      const days = dates.map((date) => machineDay({ reps: grouped.get(`${code}|${date}`) || [], date, nowMs: now, cycleIndex: index, cardSecondsByProcess }));
      const shiftDays = days.filter((d) => d.status === "shift");
      const noStartDays = days.filter((d) => d.status === "noStart");
      const sum = (k) => shiftDays.reduce((s, d) => s + (d[k] || 0), 0);
      const shiftSec = sum("shiftSec");
      const pureSec = sum("pureSec");
      const coveredSec = sum("coveredSec");
      const qty = sum("qty");
      const missingQty = sum("missingQty");
      const cardFallbackQty = sum("cardFallbackQty");
      const notes = [];
      if (noStartDays.length) notes.push(`${isToday ? "今天" : `${noStartDays.length} 天`}有數量報工但沒有「今日開工」，算不出在班時間（${noStartDays.reduce((s, d) => s + d.qty, 0)} 件未計）`);
      const capDays = shiftDays.filter((d) => d.endKind === "cap");
      if (capDays.length) notes.push(isToday ? `尚未收工，在班時間算到 ${hhmm(capDays[0].endMs)}` : `${capDays.length} 天沒有收工紀錄，在班時間算到下班時間`);
      if (shiftDays.some((d) => d.endKind === "now")) notes.push("還沒收工，在班時間算到現在");
      if (cardFallbackQty > 0) notes.push(`${cardFallbackQty} 件用卡片上最新的機台加工時間換算（報工當時沒有填）`);
      const out = {
        code, label: m?.label || code, days: shiftDays.length, shiftSec, pureSec, coveredSec, qty, missingQty, cardFallbackQty,
        coverage: shiftSec > 0 ? coveredSec / shiftSec : null, utilization: null, status: "", reason: "", notes, lowest: false,
        startMs: isToday && shiftDays[0] ? shiftDays[0].startMs : null, endMs: isToday && shiftDays[0] ? shiftDays[0].endMs : null,
      };
      if (!shiftDays.length) {
        if (noStartDays.length) { out.status = "noStart"; out.reason = "有報工但沒有「今日開工」紀錄，算不出在班時間"; }
        else if (days.some((d) => d.status === "noShift")) { out.status = "noShift"; out.reason = "開工時間晚於下班時間，算不出在班時間"; }
        else { out.status = "notOpened"; out.reason = isToday ? "今日未開工" : "近 7 天沒有開工紀錄"; }
        out.coverage = null;
        return out;
      }
      if (qty <= 0) { out.status = "noQty"; out.reason = isToday ? "已開工，還沒有數量報工" : "有開工，但近 7 天沒有數量報工"; return out; }
      if (pureSec <= 0) { out.status = "noCycle"; out.reason = `未填機台加工時間（${missingQty} 件無法換算）`; return out; }
      out.utilization = pureSec / shiftSec;
      if (missingQty > 0) {
        out.status = "partial";
        out.reason = `${missingQty} 件沒有機台加工時間，未計入（實際只會更高）`;
      } else {
        out.status = "ok";
      }
      if (out.utilization > 1) notes.push("超過 100%：機台加工時間或數量可能填錯，或加班沒有標示");
      return out;
    });
    const valued = rows.filter((r) => r.utilization !== null).sort((a, b) => a.utilization - b.utilization || a.code.localeCompare(b.code));
    if (valued.length >= 2) valued.slice(0, Math.min(LOWEST_COUNT, valued.length - 1)).forEach((r) => { r.lowest = true; });
    const rest = rows.filter((r) => r.utilization === null).sort((a, b) => a.code.localeCompare(b.code));
    return { range: isToday ? "today" : "7d", dates, rows: [...valued, ...rest], valuedCount: valued.length };
  }

  // ---- 2. 每日產量：實際 vs 估算 ----
  // machines：[{ code, label?, estimate（件／天｜null）, estimateReason? }]
  function dailyOutput({ machines, reports, nowMs, range = "today" } = {}) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const dates = rangeDates(range, now);
    const isToday = range !== "7d";
    const dateSet = new Set(dates);
    const grouped = groupByMachineDate(reports);
    const totals = new Map(dates.map((d) => [d, { date: d, good: 0, bad: 0, machines: new Set() }]));
    const rows = (Array.isArray(machines) ? machines : []).map((m) => {
      const code = normCode(m?.code);
      let good = 0;
      let bad = 0;
      let openedDays = 0;
      dates.forEach((date) => {
        const reps = grouped.get(`${code}|${date}`) || [];
        if (!reps.length) return;
        const g = reps.reduce((s, r) => s + goodOf(r), 0);
        const b = reps.reduce((s, r) => s + Math.max(0, Number(r.defect_qty) || 0), 0);
        const opened = reps.some((r) => r.report_type === "dailyStart" || qtyOf(r) > 0);
        if (opened) openedDays += 1;
        good += g;
        bad += b;
        const t = totals.get(date);
        if (t && dateSet.has(date)) { t.good += g; t.bad += b; if (g + b > 0) t.machines.add(code); }
      });
      const est = Number(m?.estimate);
      const hasEst = Number.isFinite(est) && est > 0;
      const out = {
        code, label: m?.label || code, actual: openedDays ? good : null, defect: openedDays ? bad : null, openedDays,
        estimatePerDay: hasEst ? est : null, estimate: null, diff: null, rate: null, status: "", reason: "",
        estimateReason: hasEst ? "" : (m?.estimateReason || "估算缺值"),
      };
      if (!openedDays) {
        out.status = "notOpened";
        out.reason = isToday ? "今日未開工" : "近 7 天沒有開工紀錄";
        return out;
      }
      if (!hasEst) { out.status = "noEstimate"; out.reason = out.estimateReason; return out; }
      out.estimate = est * (isToday ? 1 : openedDays);
      out.diff = good - out.estimate;
      out.rate = good / out.estimate;
      out.status = "ok";
      return out;
    });
    const compared = rows.filter((r) => r.status === "ok").sort((a, b) => a.diff - b.diff || a.code.localeCompare(b.code));
    const rest = rows.filter((r) => r.status !== "ok").sort((a, b) => (a.status === "noEstimate" ? 0 : 1) - (b.status === "noEstimate" ? 0 : 1) || a.code.localeCompare(b.code));
    return {
      range: isToday ? "today" : "7d",
      dates,
      rows: [...compared, ...rest],
      dailyTotals: dates.map((d) => {
        const t = totals.get(d);
        return { date: d, good: t.good, bad: t.bad, machineCount: t.machines.size };
      }),
    };
  }

  // ---- 3. 交期風險 ----
  function isWorkday(date, workdays = DEFAULT_WORKDAYS, holidays = []) {
    return workdays.includes(weekday(date)) && !(Array.isArray(holidays) && holidays.includes(date));
  }

  // 第 n 個工作天（從 fromDate 起算、含 fromDate 當天）
  function nthWorkday(fromDate, n, workdays = DEFAULT_WORKDAYS, holidays = []) {
    if (!(n >= 1)) return fromDate;
    if (!Array.isArray(workdays) || !workdays.length) return null;
    let date = fromDate;
    let count = 0;
    for (let guard = 0; guard < 3660; guard++) {
      if (isWorkday(date, workdays, holidays)) {
        count += 1;
        if (count >= n) return date;
      }
      date = addDays(date, 1);
    }
    return null;
  }

  // 近 7 天每道工序的實際日產：良品合計 ÷ 有報工的天數（含只有開工的天）
  function actualDailyRateByProcess(reports, nowMs, days = WINDOW_DAYS) {
    const dates = new Set(windowDates(nowMs, days));
    const map = new Map();
    (Array.isArray(reports) ? reports : []).forEach((r) => {
      if (!r?.process_id) return;
      const date = taipeiDate(reportAtMs(r));
      if (!dates.has(date)) return;
      const key = String(r.process_id);
      const slot = map.get(key) || { good: 0, dates: new Set() };
      slot.good += goodOf(r);
      slot.dates.add(date);
      map.set(key, slot);
    });
    const out = new Map();
    map.forEach((slot, key) => {
      out.set(key, { good: slot.good, days: slot.dates.size, rate: slot.good > 0 ? slot.good / slot.dates.size : null });
    });
    return out;
  }

  // orders：[{ key, workOrderNo, workOrderKey?, machine, part, process, step?, total, done, doneLabel?, dueDate, processId, estimateDaily }]
  // 逐工序卡片（#45）：同一張單同時在兩台機台（例 A02 第 2 道、B01 第 3 道）時，每一道各自算一次，
  // 再依 workOrderKey 合成「一張單一筆」——取最差的那一道（逾期 > 會延誤 > 緊 > 資料不足 > OK > 已報滿），
  // 其他道放在 otherSteps。張數（risks／okCount／excludedOver／insufficient／orderCount）都以工單算，不會因為兩台而算兩次。
  // 沒給 workOrderKey＝一道工序一筆（原本的行為）。
  function dueRisk({ orders, reports, nowMs, workdays = DEFAULT_WORKDAYS, holidays = [] } = {}) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const today = taipeiDate(now);
    const rates = actualDailyRateByProcess(reports, now);
    const seen = new Set();
    const groups = new Map();
    (Array.isArray(orders) ? orders : []).forEach((o) => {
      const key = String(o?.processId || o?.key || o?.workOrderNo || "");
      if (!key || seen.has(key)) return;
      seen.add(key);
      const group = String(o.workOrderKey || "") || `step:${key}`;
      const outcome = evaluateDueStep(o, key, today, rates, workdays, holidays);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(outcome);
    });
    const risks = [];
    const insufficient = [];
    let excludedOver = 0;
    let okCount = 0;
    groups.forEach((outcomes) => {
      const ranked = outcomes.slice().sort(compareDueOutcome);
      const worst = ranked[0];
      const otherSteps = ranked.slice(1).map((x) => ({
        key: x.row.key, machine: x.row.machine, process: x.row.process, step: x.row.step, kind: x.kind,
        level: x.row.level || "", label: x.kind === "risk" ? riskLabel(x.row) : DUE_KIND_LABEL[x.kind] || "",
      }));
      const row = otherSteps.length ? { ...worst.row, otherSteps } : worst.row;
      if (worst.kind === "risk") risks.push(row);
      else if (worst.kind === "insufficient") insufficient.push(row);
      else if (worst.kind === "ok") okCount += 1;
      else excludedOver += 1;
    });
    risks.sort(compareRiskRows);
    return { today, risks, insufficient, excludedOver, okCount, orderCount: groups.size };
  }

  const DUE_KIND_RANK = Object.freeze({ risk: 0, insufficient: 1, ok: 2, over: 3 });
  const DUE_KIND_LABEL = Object.freeze({ insufficient: "資料不足", ok: "OK", over: "已報滿" });
  const DUE_LEVEL_RANK = Object.freeze({ overdue: 0, late: 1, tight: 2 });

  function compareRiskRows(a, b) {
    return DUE_LEVEL_RANK[a.level] - DUE_LEVEL_RANK[b.level]
      || (a.level === "overdue" ? b.overdueDays - a.overdueDays : 0)
      || (a.level === "late" ? b.delayDays - a.delayDays : 0)
      || (a.level === "tight" ? a.slackDays - b.slackDays : 0)
      || String(a.dueDate).localeCompare(String(b.dueDate))
      || String(a.workOrderNo).localeCompare(String(b.workOrderNo));
  }

  // 同一張單的各道：最差的排第一（同一級風險再比延誤天數；同一級非風險照原本順序）
  function compareDueOutcome(a, b) {
    const k = DUE_KIND_RANK[a.kind] - DUE_KIND_RANK[b.kind];
    if (k) return k;
    if (a.kind === "risk") {
      // 同一張單、都已逾期（逾期天數一樣）→ 預計完成比較晚的那一道比較嚴重；都會延誤／緊 → compareRiskRows
      const r = compareRiskRows(a.row, b.row);
      if (a.row.level === "overdue" && b.row.level === "overdue" && a.row.overdueDays === b.row.overdueDays) {
        const p = String(b.row.projected || "9999").localeCompare(String(a.row.projected || "9999"));
        if (p) return p;
      }
      return r || a.index - b.index;
    }
    return a.index - b.index;
  }

  let dueStepIndex = 0;
  function evaluateDueStep(o, key, today, rates, workdays, holidays) {
    const index = dueStepIndex++;
    const total = Number(o.total);
    const done = Math.max(0, Number(o.done) || 0);
    const base = { key, workOrderNo: o.workOrderNo || "", machine: o.machine || "", part: o.part || "", process: o.process || "", step: o.step ?? null, total, done, doneLabel: o.doneLabel || "", dueDate: o.dueDate || "" };
    if (!(total > 0)) return { kind: "insufficient", index, row: { ...base, reason: "訂單數量未填" } };
    const remaining = total - done;
    if (remaining <= 0) return { kind: "over", index, row: { ...base, remaining } };
    const due = /^\d{4}-\d{2}-\d{2}/.test(String(o.dueDate || "")) ? String(o.dueDate).slice(0, 10) : "";
    if (!due) return { kind: "insufficient", index, row: { ...base, remaining, reason: "沒有交期" } };
    const actual = rates.get(String(o.processId || ""));
    let speed = null;
    let basis = "";
    let speedNote = "";
    if (actual && actual.rate > 0) {
      speed = actual.rate;
      basis = "actual";
      speedNote = `近 7 天 ${actual.days} 天報工 ${actual.good} 件`;
    } else if (Number(o.estimateDaily) > 0) {
      speed = Number(o.estimateDaily);
      basis = "estimate";
      speedNote = "卡片每日估算";
    }
    if (overdueCheck(today, due)) {
      // 交期已過、還沒做完：不管速度，一律「已逾期」
      const projected = speed ? nthWorkday(today, Math.ceil(remaining / speed), workdays, holidays) : null;
      return { kind: "risk", index, row: { ...base, remaining, level: "overdue", overdueDays: daysBetween(due, today), speed, basis, speedNote, daysNeeded: speed ? Math.ceil(remaining / speed) : null, projected, delayDays: projected ? daysBetween(due, projected) : null } };
    }
    if (!speed) return { kind: "insufficient", index, row: { ...base, remaining, reason: "沒有近 7 天實際日產，也沒有機台加工時間可估算" } };
    const daysNeeded = Math.ceil(remaining / speed);
    const projected = nthWorkday(today, daysNeeded, workdays, holidays);
    if (!projected) return { kind: "insufficient", index, row: { ...base, remaining, reason: "沒有工作天設定" } };
    const delayDays = daysBetween(due, projected);
    const row = { ...base, remaining, speed, basis, speedNote, daysNeeded, projected, delayDays };
    if (delayDays > 0) return { kind: "risk", index, row: { ...row, level: "late" } };
    if (-delayDays <= TIGHT_DAYS) return { kind: "risk", index, row: { ...row, level: "tight", slackDays: -delayDays } };
    return { kind: "ok", index, row };
  }

  function overdueCheck(today, due) {
    return daysBetween(due, today) > 0;
  }

  function riskLabel(row) {
    if (!row) return "";
    if (row.level === "overdue") return `已逾期 ${row.overdueDays} 天`;
    if (row.level === "late") return `會延誤 ${row.delayDays} 天`;
    if (row.level === "tight") return row.slackDays === 0 ? "緊（剛好趕上）" : `緊（只剩 ${row.slackDays} 天餘裕）`;
    return "OK";
  }

  // 「3時12分」「45分」
  function formatHours(seconds) {
    const n = Math.round(Number(seconds) / 60);
    if (!Number.isFinite(n) || n < 0) return "—";
    const h = Math.floor(n / 60);
    const m = n % 60;
    if (!h) return `${m}分`;
    return m ? `${h}時${String(m).padStart(2, "0")}分` : `${h}時`;
  }

  function formatPercent(ratio) {
    if (ratio === null || ratio === undefined || !Number.isFinite(Number(ratio))) return "—";
    return `${Math.round(Number(ratio) * 100)}%`;
  }

  return {
    WINDOW_DAYS, SHIFT_END_MINUTES, DEFAULT_WORKDAYS, TIGHT_DAYS, LOWEST_COUNT,
    taipeiDate, taipeiMinute, hhmm, dayStartMs, addDays, weekday, daysBetween, windowDates, windowStartIso,
    reportAtMs, attachMachineCodes, buildCycleTimeIndex, cycleTimeAt, unionLength, machineDay,
    machineUtilization, dailyOutput, isWorkday, nthWorkday, actualDailyRateByProcess, dueRisk, riskLabel,
    formatHours, formatPercent,
  };
});
