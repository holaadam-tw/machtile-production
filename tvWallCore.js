// tvWallCore.js — 現場大螢幕電視頁（?view=tv，owner 2026-10-03 拍板）的純邏輯。
//
// 畫面：上方一列＝台灣時間＋今日未開工／今日未報工／未收工（可能加班）三格（todayReportStatusCore 的口徑，跟 Monitor 總覽同一份結果）；
// 下方 11 台機台格（車床 A01–A05 一排、銑床 B01–B06 一排）。每台：代號、目前工單品名、已報／訂單＋進度條、今日狀態、異常標籤。
//   目前工單＝卡片同一張（cardActiveOrderCore 挑單）；已報＝卡片同一個數字（batchReportCore.cardProgress：舊 MES＋待回寫）。
//   今日狀態＝這台卡片上所有工單（目前＋還掛的）的工序今天最新一筆開工／收工（跟三格同一個「整台」口徑）。
//   超量＝cardActiveOrderCore.overQtyInfo（百分比無條件捨去，跟卡片一樣）。逾期＝交期早於台灣今天。
// 配色規則（ISA-101）：正常一律低彩度；只有異常上色——逾期、超量、今日未開工、未報工、未收工。
//
// 只讀：這支檔案沒有任何 I/O；DOM 與 fetch 在 app.js。
(function attachMachTileTvWallCore(root, factory) {
  const deps = typeof module === "object" && module.exports
    ? { activeCore: require("./cardActiveOrderCore.js") }
    : { activeCore: root.MachTileCardActiveOrderCore };
  const api = factory(deps);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileTvWallCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileTvWallCore(deps) {
  "use strict";

  const TZ_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Taipei，無日光節約
  const REFRESH_MS = 60 * 1000;
  const LINES = Object.freeze([
    Object.freeze({ key: "lathe", title: "車床", codes: Object.freeze(["A01", "A02", "A03", "A04", "A05"]) }),
    Object.freeze({ key: "mill", title: "銑床", codes: Object.freeze(["B01", "B02", "B03", "B04", "B05", "B06"]) }),
  ]);
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  const TILE_KINDS = Object.freeze(["notStarted", "unreported", "overtime"]);
  const TILE_LABEL = Object.freeze({ notStarted: "今日未開工", unreported: "今日未報工", overtime: "未收工（可能加班）" });
  // 嚴重度：決定機台格左側色條（只取最嚴重的一個）
  const SEVERITY = Object.freeze({ unreported: 3, over: 3, overdue: 2, notStarted: 2, overtime: 1 });

  const pad2 = (n) => String(n).padStart(2, "0");

  function taipeiDate(ms) {
    if (!Number.isFinite(ms)) return null;
    return new Date(ms + TZ_OFFSET_MS);
  }

  // 台灣時間的「10/03 週五」「14:05」
  function clockParts(nowMs) {
    const d = taipeiDate(nowMs);
    if (!d) return { date: "", weekday: "", time: "--:--", ymd: "" };
    return {
      ymd: d.toISOString().slice(0, 10),
      date: `${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`,
      weekday: `週${WEEKDAYS[d.getUTCDay()]}`,
      time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
    };
  }

  function hhmm(ms) {
    return Number.isFinite(ms) && ms > 0 ? clockParts(ms).time : "";
  }

  // 讀取失敗的角落提示：有上一次成功就寫「最後更新 HH:MM」，從來沒成功過就說還沒有資料
  function failureText(lastOkMs) {
    const t = hhmm(lastOkMs);
    return t ? `資料更新失敗，最後更新 ${t}` : "資料讀取失敗，尚未取得資料";
  }

  // 交期（YYYY-MM-DD）比台灣今天早幾天；交期壞值／沒有 → null
  function overdueDays(dueDate, nowMs) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dueDate || ""));
    const today = clockParts(nowMs).ymd;
    if (!m || !today) return null;
    const due = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const [y, mo, d] = today.split("-").map(Number);
    const diff = Math.round((Date.UTC(y, mo - 1, d) - due) / 86400000);
    return diff > 0 ? diff : 0;
  }

  // todayMap：cardEstimateCore.todayStatusByProcess 的結果（工序 id → 今天最新一筆 dailyStart／finish）。
  // 一台機台＝它所有工序裡最新的那一筆（同時間以收工為準）。
  function latestTodayEntry(todayMap, processIds) {
    if (!todayMap || typeof todayMap.get !== "function") return null;
    let best = null;
    (Array.isArray(processIds) ? processIds : []).forEach((pid) => {
      const e = todayMap.get(String(pid));
      if (!e) return;
      const atMs = Number.isFinite(e.atMs) ? e.atMs : Date.parse(e.at);
      if (!best || atMs > best.atMs || (atMs === best.atMs && e.type === "finish")) best = { ...e, atMs };
    });
    return best;
  }

  function overQty(order) {
    const core = deps && deps.activeCore;
    if (core && typeof core.overQtyInfo === "function") return core.overQtyInfo(order);
    const total = Math.max(0, Number(order?.total) || 0);
    const done = Math.max(0, Number(order?.done) || 0);
    if (!total) return { total, done, full: false, over: 0, percent: 0, bar: 0 };
    const percent = Math.floor((done / total) * 100);
    return { total, done, full: done >= total, over: Math.max(0, done - total), percent, bar: Math.min(100, percent) };
  }

  const keySet = (tile) => new Set(tile && tile.active && Array.isArray(tile.keys) ? tile.keys.map(String) : []);

  // 一台機台格。input：{ code, key, alias, found, order: { id, part, process, done, total, dueDate } | null, processIds }
  function machineCell(input, { summary, todayMap, nowMs } = {}) {
    const code = String(input?.code || "").toUpperCase();
    const key = String(input?.key || code);
    const order = input?.order || null;
    const sets = {
      notStarted: keySet(summary?.notStarted),
      unreported: keySet(summary?.unreported),
      overtime: keySet(summary?.overtime),
    };
    const cell = {
      code,
      alias: String(input?.alias || "").trim(),
      found: input?.found !== false,
      hasOrder: Boolean(order),
      orderNo: order ? String(order.id || "") : "",
      part: order ? String(order.part || "") : "",
      process: order ? String(order.process || "") : "",
      done: null,
      total: null,
      percent: null,
      bar: 0,
      over: 0,
      full: false,
      today: { tone: "none", text: "" },
      tags: [],
      severity: "",
    };
    if (order) {
      const info = overQty(order);
      cell.done = info.done;
      cell.total = info.total;
      cell.percent = info.total ? info.percent : null;
      cell.bar = info.full ? 100 : info.bar;
      cell.over = info.over;
      cell.full = info.full;
    }

    // 今日狀態
    const entry = latestTodayEntry(todayMap, input?.processIds);
    if (entry && entry.type === "finish") cell.today = { tone: "finished", text: `已收工 ${entry.time}` };
    else if (entry) cell.today = { tone: "started", text: `${entry.time} 開工` };
    else if (sets.notStarted.has(key)) cell.today = { tone: "notStarted", text: "今日未開工" };
    else if (order) cell.today = { tone: "none", text: "尚未開工" };
    else cell.today = { tone: "idle", text: "無工單" };

    // 異常標籤（順序＝嚴重度）
    const tags = [];
    if (sets.unreported.has(key)) {
      const reasons = summary?.unreported?.reasons?.[key] || [];
      const what = reasons.includes("noon") && reasons.includes("finish") ? "缺中午、收工" : reasons.includes("finish") ? "缺收工" : reasons.includes("noon") ? "缺中午" : "";
      tags.push({ kind: "unreported", label: what ? `未報工・${what}` : "未報工" });
    }
    if (order && cell.full && cell.over > 0) tags.push({ kind: "over", label: `超量 +${cell.over}` });
    const late = order ? overdueDays(order.dueDate, nowMs) : null;
    if (late) tags.push({ kind: "overdue", label: `逾期 ${late} 天` });
    if (sets.overtime.has(key)) tags.push({ kind: "overtime", label: "未收工・可能加班" });
    cell.tags = tags;
    if (order && cell.full && cell.over === 0) cell.fullNote = "已報滿";

    const kinds = tags.map((t) => t.kind).concat(cell.today.tone === "notStarted" ? ["notStarted"] : []);
    let top = "";
    kinds.forEach((k) => { if (!top || (SEVERITY[k] || 0) > (SEVERITY[top] || 0)) top = k; });
    cell.severity = top;
    return cell;
  }

  // 上方三格：數字＞0 才上色；0 台＝中性；這個時段不計算＝「—」＋說明
  function headerTiles(summary) {
    return TILE_KINDS.map((kind) => {
      const tile = summary ? summary[kind] : null;
      const active = Boolean(tile && tile.active);
      const count = active ? Number(tile.count) || 0 : null;
      return {
        kind,
        label: TILE_LABEL[kind],
        active,
        count,
        value: active ? String(count) : "—",
        tone: !active ? "na" : count > 0 ? kind : "zero",
        hint: tile ? String(tile.hint || "") : "讀不到今日報工",
        keys: active ? tile.keys.slice() : [],
      };
    });
  }

  // machinesByCode：Map(代號大寫 → machineCell 的 input)。代號不在 LINES 的機台不上電視。
  function buildModel({ machinesByCode, summary, todayMap, nowMs } = {}) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const byCode = machinesByCode instanceof Map ? machinesByCode : new Map();
    const lines = LINES.map((line) => ({
      key: line.key,
      title: line.title,
      machines: line.codes.map((code) => machineCell(byCode.get(code) || { code, found: false, order: null, processIds: [] }, { summary, todayMap, nowMs: now })),
    }));
    return { nowMs: now, clock: clockParts(now), tiles: headerTiles(summary), lines };
  }

  return Object.freeze({
    REFRESH_MS, LINES, TILE_KINDS, TILE_LABEL,
    clockParts, hhmm, failureText, overdueDays, latestTodayEntry, machineCell, headerTiles, buildModel,
  });
});
