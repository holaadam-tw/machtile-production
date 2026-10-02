// cardEstimateCore.js — Monitor 機台卡片的「每日估算」「上下料時間」「今日開工狀態」純邏輯（owner 2026-10-02）。
//
// 為什麼存在：卡片的每日估算原本＝480 分 ÷ 機台加工時間，沒算上下料；報工畫面用 430 分，兩邊數字對不起來。
// owner 定的規則：
//   每日估算 ＝ 一天可加工時間（430 分）÷（機台加工時間 ＋ 上下料時間）
//   上下料時間：預設 車床 60 秒、銑床 180 秒（臥式多盤 B01/B02 暫時跟銑床一樣 180，待 owner 拍板）
//   用實際報工校正：每筆有數量、有開始／結束時間的報工 → 實際每件時間 ＝（ended − started）÷（良品＋不良）；
//     推算上下料 ＝ 實際每件時間 − 當時這道工序的機台加工時間（有填才算）；
//     依「同一個產品＋工序」（圖號 → 品號 → 品名，加工序名稱）跨工單累積，取中位數（不用平均：跨午休、跨夜
//     的報工會把時間拉長）；排除推算 < 0、每件超過 1 小時；至少 3 筆有效樣本才採用，不夠就用預設。
//
// DOM 與 fetch 留在 app.js；這裡只做可測的決策。卡片和報工畫面都呼叫這裡，數字才會一致。
(function attachMachTileCardEstimateCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileCardEstimateCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileCardEstimateCore() {
  "use strict";

  // ---- 集中常數（以後要改只改這裡）----
  // 一天可加工時間（分）。報工畫面原本的 reportDailyCapacity 也是 430。
  const WORK_MINUTES_PER_DAY = 430;
  // 中午前可加工時間（分），報工畫面「中午應完成約 N 件」用（原本的 210 不變）。
  const NOON_MINUTES = 210;
  // 上下料時間預設（秒／件），粗估值。hmc＝臥式多盤（B01/B02），一盤加工時另一盤可以同時上下料，
  // 實際可能接近 0；owner 還沒拍板，先跟銑床一樣 180。unknown＝分不出車床／銑床，保守用銑床的值。
  const DEFAULT_LOAD_UNLOAD_SECONDS = Object.freeze({ lathe: 60, mill: 180, hmc: 180, unknown: 180 });
  const KIND_LABEL = Object.freeze({ lathe: "車床", mill: "銑床", hmc: "臥式多盤", unknown: "未分類" });
  // 至少幾筆有效樣本才採用實績值
  const MIN_SAMPLES = 3;
  // 實際每件時間超過這個值的報工不採用（跨夜、忘記報工）
  const MAX_PER_PIECE_SECONDS = 3600;
  // 今日狀態看的報工類型
  const TODAY_TYPES = Object.freeze(["dailyStart", "finish"]);

  function text(value) {
    return String(value ?? "").trim();
  }

  // ---- 車床／銑床判斷 ----
  // 依序看：機型（machines.machine_type，正式庫是「車床」「加工中心」「臥式加工中心」）→ 課別（車床課／銑床課）。
  // 臥式的標記方式跟 app.js isHmcMachine 一樣（臥式／卧式／臥加／hmc／horizontal）。
  // 「車銑複合」算車床（主體是車床、上下料跟車床一樣）。
  function machineKind(machine) {
    const type = text(machine?.type ?? machine?.machine_type);
    const dept = text(machine?.department ?? machine?.department_name);
    const name = text(machine?.name ?? machine?.machine_name);
    const hmcText = `${type} ${name} ${text(machine?.note)}`.toLowerCase();
    if (/臥式|卧式|臥加|hmc|horizontal/.test(hmcText)) return "hmc";
    const t = type.toLowerCase();
    if (/車|lathe|turn/.test(t)) return "lathe";
    if (/銑|加工中心|五軸|mill|machining/.test(t)) return "mill";
    const d = dept.toLowerCase();
    if (/車|lathe/.test(d)) return "lathe";
    if (/銑|五軸|mill/.test(d)) return "mill";
    return "unknown";
  }

  function defaultLoadUnloadSeconds(kind) {
    return DEFAULT_LOAD_UNLOAD_SECONDS[kind] ?? DEFAULT_LOAD_UNLOAD_SECONDS.unknown;
  }

  // ---- 同一個產品＋工序 ----
  // 圖號 → 品號 → 品名（第一個有值的，「-」當沒有），加工序名稱。任一邊沒有就不算（回 null）。
  function productKey({ drawingNo, partNo, partName, processName } = {}) {
    const pick = [drawingNo, partNo, partName].map(text).find((v) => v && v !== "-");
    const proc = text(processName);
    if (!pick || !proc) return null;
    return `${pick.toUpperCase()}|${proc}`;
  }

  function median(values) {
    const list = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!list.length) return null;
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  }

  // 一筆報工 → 實際每件時間（秒）。不合格（沒數量、沒時間、時間倒退、每件超過 1 小時）回 null。
  function perPieceSeconds(report) {
    const qty = (Number(report?.completed_qty) || 0) + (Number(report?.defect_qty) || 0);
    if (!(qty > 0)) return null;
    const s = Date.parse(report?.started_at || "");
    const e = Date.parse(report?.ended_at || "");
    if (!Number.isFinite(s) || !Number.isFinite(e) || !(e > s)) return null;
    const per = (e - s) / 1000 / qty;
    if (!(per > 0) || per > MAX_PER_PIECE_SECONDS) return null;
    return per;
  }

  // 報工（production_reports）→ 每個「產品＋工序」的樣本。
  //   reports：{ process_id, started_at, ended_at, completed_qty, defect_qty, cycle_time_seconds, created_at }
  //   keyOfProcess：process_id → productKey（Map、物件或函式）
  // 「當時的機台加工時間」＝同一道工序在這筆報工以前（含這一筆）最新一次填的 cycle_time_seconds。
  function buildLoadUnloadStats(reports, keyOfProcess) {
    const keyFn = typeof keyOfProcess === "function"
      ? keyOfProcess
      : keyOfProcess instanceof Map
        ? (pid) => keyOfProcess.get(String(pid)) || null
        : (pid) => (keyOfProcess && keyOfProcess[String(pid)]) || null;
    const byProcess = new Map();
    (Array.isArray(reports) ? reports : []).forEach((r) => {
      if (!r?.process_id) return;
      const pid = String(r.process_id);
      if (!byProcess.has(pid)) byProcess.set(pid, []);
      byProcess.get(pid).push(r);
    });
    const stats = new Map();
    byProcess.forEach((rows, pid) => {
      const key = keyFn(pid);
      if (!key) return;
      const entry = stats.get(key) || { loadUnloadSamples: [], perPieceSamples: [], excluded: 0 };
      rows.slice().sort((a, b) => {
        const ta = String(a.created_at || a.ended_at || "");
        const tb = String(b.created_at || b.ended_at || "");
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      }).reduce((machineSec, r) => {
        const ct = Number(r.cycle_time_seconds);
        const current = Number.isFinite(ct) && ct > 0 ? ct : machineSec;
        const qty = (Number(r.completed_qty) || 0) + (Number(r.defect_qty) || 0);
        if (qty > 0) {
          const per = perPieceSeconds(r);
          if (per === null) {
            if (r.started_at && r.ended_at) entry.excluded += 1;
          } else if (current > 0 && per - current < 0) {
            // 比機台加工時間還快＝數量或時間填錯，整筆不採用（上下料、實際每件時間都不算）
            entry.excluded += 1;
          } else {
            entry.perPieceSamples.push(per);
            if (current > 0) entry.loadUnloadSamples.push(per - current);
          }
        }
        return current;
      }, 0);
      stats.set(key, entry);
    });
    return stats;
  }

  // 這張單（產品＋工序、機台類型）用的上下料時間。
  //   source: "actual"（實績 ≥ 3 筆，取中位數）／"default"（預設）
  //   actualPerPieceSec：實際每件時間的中位數（實績 ≥ 3 筆才給，卡片才顯示「實際約 N 個／天」；owner 2026-10-02）
  function resolveLoadUnload({ kind = "unknown", stats = null } = {}) {
    const k = DEFAULT_LOAD_UNLOAD_SECONDS[kind] !== undefined ? kind : "unknown";
    const def = defaultLoadUnloadSeconds(k);
    const luSamples = stats?.loadUnloadSamples || [];
    const perSamples = stats?.perPieceSamples || [];
    const perMedian = median(perSamples);
    const base = {
      kind: k,
      defaultSeconds: def,
      actualPerPieceSec: perMedian === null || perSamples.length < MIN_SAMPLES ? null : Math.round(perMedian),
      actualSamples: perSamples.length,
    };
    if (luSamples.length >= MIN_SAMPLES) {
      return { ...base, seconds: Math.round(median(luSamples)), source: "actual", samples: luSamples.length };
    }
    return { ...base, seconds: def, source: "default", samples: luSamples.length };
  }

  // 每日估算（件）＝ 一天可加工時間 ÷（機台加工時間＋上下料）。沒有機台加工時間 → null。
  function dailyEstimate(machineSeconds, loadUnloadSeconds = 0, minutesPerDay = WORK_MINUTES_PER_DAY) {
    const m = Number(machineSeconds);
    if (!Number.isFinite(m) || m <= 0) return null;
    const lu = Math.max(0, Number(loadUnloadSeconds) || 0);
    return Math.max(1, Math.floor((Number(minutesPerDay) * 60) / (m + lu)));
  }

  // 實際約 N 個／天：用實際每件時間的中位數算（已經含上下料，不再加）。
  function actualDailyEstimate(perPieceSec, minutesPerDay = WORK_MINUTES_PER_DAY) {
    return dailyEstimate(perPieceSec, 0, minutesPerDay);
  }

  // 「1分20秒」「1分」「45秒」
  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined || seconds === "") return "-";
    const n = Math.round(Number(seconds));
    if (!Number.isFinite(n) || n < 0) return "-";
    const m = Math.floor(n / 60);
    const s = n % 60;
    if (!m) return `${s}秒`;
    return s ? `${m}分${s}秒` : `${m}分`;
  }

  function loadUnloadLabel(info) {
    if (!info) return "";
    const tail = info.source === "actual" ? `實績 ${info.samples} 次` : "預設";
    return `上下料 ${formatDuration(info.seconds)}（${tail}）`;
  }

  // ---- 今日開工狀態 ----
  function localParts(iso, timeZone = "Asia/Taipei") {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(d);
      const p = (t) => parts.find((x) => x.type === t)?.value || "";
      return { date: `${p("year")}-${p("month")}-${p("day")}`, time: `${p("hour")}:${p("minute")}` };
    } catch {
      return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
    }
  }

  // 台灣時區「今天」00:00 的 ISO（查詢用的下限）。台灣沒有日光節約，固定 +08:00。
  function todayStartIso(nowMs = Date.now()) {
    const p = localParts(new Date(nowMs).toISOString());
    return new Date(`${p.date}T00:00:00+08:00`).toISOString();
  }

  // production_reports（今天的 dailyStart／finish）→ 每道工序最新一筆。
  // 報工時間＝ended_at（現場按送出的時間；離線補送時 created_at 會比較晚），沒有才用 created_at。
  function todayStatusByProcess(reports, nowMs = Date.now()) {
    const today = localParts(new Date(nowMs).toISOString())?.date;
    const map = new Map();
    (Array.isArray(reports) ? reports : []).forEach((r) => {
      if (!r?.process_id || !TODAY_TYPES.includes(r.report_type)) return;
      const at = r.ended_at || r.created_at;
      const local = at ? localParts(at) : null;
      if (!local || local.date !== today) return;
      const key = String(r.process_id);
      const prev = map.get(key);
      const atMs = Date.parse(at);
      const tie = String(r.created_at || "");
      if (prev && (prev.atMs > atMs || (prev.atMs === atMs && prev.createdAt >= tie))) return;
      const operatorId = Array.isArray(r.operator_ids) && r.operator_ids.length ? String(r.operator_ids[0]) : (r.user_id ? String(r.user_id) : "");
      map.set(key, { type: r.report_type, at, atMs, createdAt: tie, time: local.time, operatorId });
    });
    return map;
  }

  // 卡片底部要顯示的字。nameOf(id) → 姓名（照 App 顯示報工人的方式：operator_ids 第一位，沒有就 user_id）。
  function todayStatusLabel(entry, nameOf = () => "") {
    if (!entry) return { tone: "none", text: "今日尚未開工" };
    if (entry.type === "finish") return { tone: "finished", text: `今日已收工 ${entry.time}` };
    const name = entry.operatorId ? text(nameOf(entry.operatorId)) : "";
    return { tone: "started", text: `今日已開工 ${entry.time}${name ? `・${name}` : ""}` };
  }

  return {
    WORK_MINUTES_PER_DAY, NOON_MINUTES, DEFAULT_LOAD_UNLOAD_SECONDS, KIND_LABEL, MIN_SAMPLES, MAX_PER_PIECE_SECONDS, TODAY_TYPES,
    machineKind, defaultLoadUnloadSeconds, productKey, median, perPieceSeconds, buildLoadUnloadStats, resolveLoadUnload,
    dailyEstimate, actualDailyEstimate, formatDuration, loadUnloadLabel,
    localParts, todayStartIso, todayStatusByProcess, todayStatusLabel,
  };
});
