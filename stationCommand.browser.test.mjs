// 機台卡片「開工／停工」回寫舊 MES（2026-10-07 第 1 階段）——瀏覽器端到端測試（Playwright，1440 桌機＋390 手機）。
//   1. 旗標關（預設）：沒有按鈕、完全不讀 station_commands；Monitor 卡片 HTML 跟 origin/main 的程式一字不差。
//   2. 旗標開但 station_commands 表不存在 → 整個藏起來（卡片 HTML 一樣跟 origin/main 相同）。
//   3. 旗標只開 A04：只有 A04 出按鈕；按「開工」→ 確認卡大字列出 機台／工單號／料號＋品名／第幾道＋工序名／舊 MES 現況。
//   4. 「不是這張單」→ 只叫他找生管，不送、不給換單。
//   5. 確認 → 呼叫 machtile_submit_station_command（App 產生的 command_uuid、合約欄位）；等待中按鈕鎖住、連按只送一次；
//      pending → claimed → applied；rejected（白話原因＋工廠說明）；expired。
//   6. 送出時 RPC 不存在 → 功能藏起來；送出時網路斷 → 「重送」用同一個 command_uuid。
//   7. 管理員（owner 2026-10-08 方案 C）：旗標含 A04 → 管理員也看到按鈕，確認卡多兩行「你是管理員…」「你不在機台旁…」；
//      旗標關 → 卡片 HTML 跟 origin/main 一字不差；manager 不出按鈕；ADMIN_* 錯誤碼白話。
//   8. 開工時一起填今日開工數量（owner 2026-10-08）：作業員＋今天這道還沒今日開工 → 確認卡多一格必填數量，
//      確認後開工指令與今日開工（field_report_upsert）各送一次；已有今日開工／管理員 → 沒有這格；
//      今日開工沒存到 → 提示到報工補填，開工指令照樣只送一次。
//      L3 修正：開工指令被伺服器接受後才寫今日開工（送出被拒／沒收到回覆 → 不寫、數量留著）；
//      直接 POST 回退一定帶計數器，沒回列 id 就當沒存到。
//      owner「先修」：送出時網路斷 → 數量跟著等確認的指令存，關掉／重新整理後查到被接受才寫一次、被拒就丟；
//      離線排入待送 → 說「已排入待送」、報工→今日開工擋第二筆、連線後只有一筆；今天已有的今日開工任何路徑都不重複。
//      L3 複審：201 沒回列＝結果不確定（不叫補填，查回來：有→不重複；沒有→重送鈕用同一個 report_uuid）；
//      報工→今日開工送出前重讀伺服器；RPC 回應不是同一個 command_uuid → 不寫今日開工。
//      L3 複審 fa1db2fb：等送達的數量存到伺服器看到那一列才刪（送不到、重新整理都還在）；重讀讀不到（5xx）→ 不寫、留著、之後再試。
//      假後端預設「A04 今天已經有今日開工」（1–7 項的確認卡因此跟以前一樣）；第 8 項才用「今天還沒有」。
// 不會碰任何真的後端：config.js 換成指向假專案網域的測試設定，Supabase 請求全部由這支腳本用假資料回應；
// 其他對外請求一律擋掉（最後斷言沒有打到正式專案）。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium
//   node stationCommand.browser.test.mjs           （截圖寫到 ./.e2e-out/station-command/，不進版控）
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node stationCommand.browser.test.mjs
//   對照基準預設 origin/main（STATION_CMD_BASELINE_REF 可換）；讀不到 git 就跳過「跟 main 一字不差」那幾項並標 SKIP。
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url));
const stationCore = createRequire(import.meta.url)("./stationCommandCore.js");
const outDir = process.env.STATION_CMD_E2E_OUT || path.join(root, ".e2e-out", "station-command");
const finishCloseShot = "D:\\04_SoftNet\\ops\\codex-inbox\\20261015-app-finish-dialog-shots\\close-result-mobile.png";
const baselineRef = process.env.STATION_CMD_BASELINE_REF || "origin/main";
const modSpec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const pw = await import(modSpec);
const { chromium } = pw.default || pw;

let pass = 0, fail = 0, skip = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "\n        " + extra : "")); }
}

// ---------- static server：/ ＝這份程式；/__baseline/ ＝ origin/main 的同一批檔案（git show） ----------
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const baselineCache = new Map();
let baselineAvailable = true;
try { execFileSync("git", ["-C", root, "rev-parse", "--verify", `${baselineRef}^{commit}`], { stdio: "pipe" }); }
catch { baselineAvailable = false; }
function baselineFile(rel) {
  if (!baselineCache.has(rel)) {
    try { baselineCache.set(rel, execFileSync("git", ["-C", root, "show", `${baselineRef}:${rel}`], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 })); }
    catch { baselineCache.set(rel, null); }
  }
  return baselineCache.get(rel);
}
if (baselineAvailable && ["index.html", "app.js", "styles.css", "stationCommandCore.js", "config.js"].some((file) => !baselineFile(file))) {
  baselineAvailable = false;
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let p = decodeURIComponent(url.pathname);
  const isBaseline = p.startsWith("/__baseline/");
  if (isBaseline) p = p.slice("/__baseline".length);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  const type = types[path.extname(file)] || "application/octet-stream";
  if (isBaseline) {
    const body = baselineFile(p.replace(/^\//, ""));
    if (!body) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": type }); res.end(body); return;
  }
  try { const body = await readFile(file); res.writeHead(200, { "Content-Type": type }); res.end(body); }
  catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---------- fixtures ----------
const FAKE = "https://e2estationcmdzzzzzzzzzz.supabase.co";
const T = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const users = [{ id: id(901), name: "王小明", legacy_user_id: "1080301", auth: id(801) }];
const procs = [
  { n: 1, wo: "XX01202609020008", part: "MPW-01止油閥座", partNo: "MPW-01", machine: "A01", step: 2, proc: "車床加工", qty: 5000 },
  { n: 4, wo: "XX01202502050012", part: "HCG-06本體", partNo: "HCG-06-01", machine: "A04", step: 5, proc: "CNC車床二序", qty: 600 },
  { n: 33, wo: "XX01202606300001", part: "A37軸蓋", partNo: "A37-02", machine: "B03", step: 3, proc: "銑床加工", qty: 196, manufactureIiId: "C011E0ZE2YZJ" },
  { n: 34, wo: "XX01202604140005#7", part: "B04安全測試", partNo: "B04-NULL", machine: "B04", step: 7, proc: "銑床加工", qty: 50, manufactureIiId: null },
];
const machines = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"].map((code, i) => ({
  id: id(200 + i), machine_code: code, machine_name: code, machine_type: code.startsWith("A") ? "車床" : (code === "B01" || code === "B02" ? "臥式加工中心" : "加工中心"),
  location: "", status: "idle", display_order: i,
}));
const cards = procs.map((p) => ({
  id: id(100 + p.n), tenant_id: T, work_order_no: p.wo, customer_name: "測試客戶", part_name: p.part, drawing_no: `DRW-${p.n}`,   // 圖號故意跟料號不同：確認卡只能顯示 part_no
  quantity: p.qty, due_date: "2026-10-30", priority: "normal", work_order_status: "in_progress",
  current_process_id: id(300 + p.n), current_process_name: p.proc, current_process_status: "pending",
  machine_name: p.machine, qty_completed: 0, qty_defect: 0, progress_percent: 0,
  last_report_at: null, open_risk_level: null, current_process_off_station: false,
}));
const legacyRows = [
  { work_order_no: "XX01202502050012", machine_code: "A04", process_order: 5, legacy_input: 210, legacy_output: 208, legacy_fail: 2, legacy_updated_at: "2026-10-07T01:30:00Z", legacy_snapshot_at: "2026-10-07T01:35:00Z", legacy_synced_at: "2026-10-07T01:35:10Z" },
  { work_order_no: "XX01202502050012", machine_code: "A04", process_order: 4, legacy_input: 600, legacy_output: 598, legacy_fail: 2, legacy_updated_at: "2026-10-01T01:30:00Z", legacy_snapshot_at: "2026-10-07T01:35:00Z", legacy_synced_at: "2026-10-07T01:35:10Z" },
];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwtFor = (role) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: users[0].auth, email: "op@test.invalid", exp: Math.floor(now / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role } })}.sig`;
const testConfig = (extra) => `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE}", supabaseAnonKey: "anon-test-key-for-e2e-only", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: true, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, oauthEnabled: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
  ${extra || ""}
};`;

// ---------- fake backend（每個情境一份） ----------
function makeBackend({ tableMissing = false, rpcMissing = false, role = "operator", submitError = null, appUserName = null, dailyStartDone = true, dailyStartFail = false, directMode = "ok", takeoverCandidates = [], poolItems = [], withDepartments = false, procStatus = {}, extraCards = [] } = {}) {
  const be = {
    tableMissing, rpcMissing, role, submitError, appUserName, dailyStartDone, dailyStartFail,
    reportUpserts: [],        // field_report_upsert 的 body（今日開工等報工）
    directMode,               // outbox 關掉時直接 POST production_reports：ok（回列）／noRow（201 但沒列）／structRejected（結構化欄位被拒）
    directPosts: [],          // 直接 POST production_reports 的 body
    // This fixture means "recorded today" even when the sweep starts shortly after midnight.
    todayRows: dailyStartDone ? [{ process_id: id(304), report_type: "dailyStart", created_at: new Date(now).toISOString(), started_at: null, ended_at: new Date(now).toISOString(), completed_qty: 0, defect_qty: 0, user_id: users[0].id, operator_ids: [users[0].id] }] : [],
    stationReads: 0,          // 任何對 station_commands 的請求
    submits: [],              // RPC body
    commands: new Map(),      // uuid → row
    mode: "hold",             // 輪詢回覆：hold（pending→claimed）／applied／rejected／expired
    reject: { code: "ORDER_MISMATCH", message: "Manufacture.OrderNO=XX01202509300001 IndexSN=2" },
    abortNextSubmit: false,
    hangSubmit: false,        // 送出的 RPC 不回（測逾時）
    serverSkewMs: 0,          // 伺服器時間＝真實時間－這個值（模擬平板時鐘快）
    procOverride: {},         // 開卡重讀工序時改寫某台的列（例：已離站、沒有料號）
    progressRows: [], progressReadFail: false, takeoverCandidates, takeoverSubmits: [],
    takeoverMoveTo: null,     // 接手 applied 時把那張單的工序搬到這台（模擬雲端同交易移機台）；null＝雲端還沒同步
    procMachine: {},          // 工單號 → 目前機台（覆蓋 fixture）
    listReads: 0,             // 工序清單（work_orders!inner）讀取次數＝重載次數
    otherWrites: [],
    // 選工單／開工分開（2026-10-26）用：派工池列、接單請求、機台課別、工序 status（工單號 → status；預設 pending）
    poolItems, poolClaims: [], withDepartments, procStatus: { ...procStatus }, extraCards,
    // 停工對話框（報工＋停工一次）：machtile_submit_stop_report 的 body；procExtra＝工單號 → 工序列額外欄位（simulation_id、qty_completed）
    stopReportSubmits: [], stopReportAckMissing: false, procExtra: {},
    // 停工對話框開啟前會擋住尚未 applied 的 report；recentReports 可模擬同一道的 station_commands。
    recentReports: [], recentQueries: [], recentReadFail: false,
    stationReportSubmits: [], stationReportCommands: new Map(),
  };
  be.handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const q = decodeURIComponent(url.search);
    const method = req.method();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/rest/v1/rpc/machine_department_context") return json(200, { tenant_id: T, role: be.role, is_bridge: false, all_departments: true, department_codes: ["LATHE", "MILL"] });
    if (p.startsWith("/auth/v1/user")) return json(200, { id: users[0].auth, email: "op@test.invalid" });
    if (p === "/rest/v1/station_commands") {
      be.stationReads++;
      if (be.tableMissing) return json(404, { code: "PGRST205", message: "Could not find the table 'public.station_commands' in the schema cache" });
      const m = q.match(/command_uuid=eq\.([0-9a-f-]+)/);
      if (m && be.failCommandPolls) return route.abort("failed");
      if (!m && q.includes("command_type=eq.report") && q.includes("status=in.(pending,claimed)")) {
        be.recentQueries.push(q);
        if (be.recentReadFail) return json(503, { message: "e2e: station_commands unavailable" });
        const f = (re) => (q.match(re) || [])[1];
        const mc = f(/machine_code=eq\.([^&]+)/), wo = f(/expected_order_no=eq\.([^&]+)/), sn = Number(f(/expected_index_sn=eq\.([^&]+)/));
        return json(200, be.recentReports.filter((r) => r.machine_code === mc && r.expected_order_no === wo && r.expected_index_sn === sn && ["pending", "claimed"].includes(r.status)));
      }
      if (!m) return json(200, []);
      const row = be.commands.get(m[1]);
      if (!row) return json(200, []);
      if (be.mode === "hold") { if (row.status === "pending") { row.status = "claimed"; row.claimed_at = new Date().toISOString(); } }
      else if (be.mode === "applied") {
        row.status = "applied"; row.applied_at = new Date().toISOString();
        if (row.command_type === "takeover" && be.takeoverMoveTo && row.takeover_order_no) be.procMachine[row.takeover_order_no] = be.takeoverMoveTo;
        if (row.command_type === "claim_next") row.legacy_snapshot = { claim_next: { pool_item_id: row.pool_item_id || "pool-next-1", machine_code: row.machine_code, order_no: row.expected_order_no, index_sn: row.expected_index_sn, claimed: true, can_start: true, manufacture_ii_id: null } };
      }
      else if (be.mode === "rejected") { row.status = "rejected"; row.reject_code = be.reject.code; row.reject_message = be.reject.message; }
      else if (be.mode === "expired") { row.status = "expired"; row.reject_code = "EXPIRED"; }
      else if (be.mode === "stale") { row.status = "pending"; row.requested_at = new Date(Date.now() - be.serverSkewMs - 4 * 60000).toISOString(); }   // 已 4 分鐘還沒人領（伺服器 10 分鐘才落地 expired）
      else if (be.mode === "lease") { row.status = "claimed"; row.claimed_at = new Date(Date.now() - be.serverSkewMs - 10000).toISOString(); row.requested_at = new Date(Date.now() - be.serverSkewMs - 5 * 60000).toISOString(); }   // 合約 r2：租約過了被重領，仍 claimed、claimed_at 更新
      else if (be.mode === "staleReject") { row.status = "rejected"; row.claimed_at = row.claimed_at || new Date().toISOString(); row.reject_code = "STALE_COMMAND"; row.reject_message = "not applied within 180s"; }
      else if (be.mode === "released") { row.status = "rejected"; row.claimed_at = row.claimed_at || new Date().toISOString(); row.reject_code = "MANUAL_RELEASED"; row.reject_message = "舊 MES 狀態未知，請人工核對"; }
      else if (be.mode.startsWith("code:")) { row.status = "rejected"; row.claimed_at = row.claimed_at || new Date().toISOString(); row.reject_code = be.mode.slice(5); row.reject_message = "applier detail"; }   // #785 代碼
      else if (be.mode === "lateApplied") { row.status = "rejected"; row.claimed_at = row.claimed_at || new Date().toISOString(); row.reject_code = "LEGACY_APPLIED_LATE"; row.reject_message = "ChangeStatus ok, finish(applied) got STALE_COMMAND"; }
      return json(200, [row]);
    }
    if (p === "/rest/v1/rpc/machtile_submit_station_command") {
      be.stationReads++;
      const body = JSON.parse(req.postData() || "{}");
      be.submits.push(body);
      if (be.rpcMissing) return json(404, { code: "PGRST202", message: "Could not find the function public.machtile_submit_station_command" });
      if (be.abortNextSubmit) { be.abortNextSubmit = false; return route.abort("failed"); }
      if (be.submitError) return json(400, { code: "P0001", message: be.submitError, details: null, hint: null });
      if (be.hangSubmit) { be.hangSubmit = false; await new Promise((r) => setTimeout(r, 4000)); return route.abort("failed").catch(() => {}); }
      let row = be.commands.get(body.p_command_uuid);
      if (!row) {
        row = { id: id(9000 + be.commands.size), command_uuid: body.p_command_uuid, command_type: body.p_command_type, machine_code: body.p_machine_code, pool_item_id: body.p_pool_item_id || null,
          expected_order_no: body.p_expected_order_no, expected_index_sn: body.p_expected_index_sn, requested_at: new Date(Date.now() - be.serverSkewMs).toISOString(), status: "pending", reject_code: null, reject_message: null, applied_at: null };
        be.commands.set(body.p_command_uuid, row);
      }
      if (be.ackLostNextSubmit) { be.ackLostNextSubmit = false; return route.abort("failed"); }   // 伺服器建好了，回覆在路上掉了
      if (be.submitRowMode === "noUuid") { const { command_uuid, ...rest } = row; return json(200, rest); }
      if (be.submitRowMode === "wrongUuid") return json(200, { ...row, command_uuid: "99999999-9999-4999-8999-999999999999" });
      return json(200, row);
    }
    if (p === "/rest/v1/rpc/machtile_get_station_report_guard_config") {
      const requested = JSON.parse(req.postData() || "{}").p_machine_code || "A04";
      return json(200, { factory_synced: true, machine_code: requested, report_enabled_machines: { A04: true, B03: true }, report_enabled: true, fail_reason_codes: ["其他"] });
    }
    if (p === "/rest/v1/rpc/machtile_submit_station_report") {
      const body = JSON.parse(req.postData() || "{}");
      be.stationReportSubmits.push(body);
      if (be.stationReportFailCount > 0) { be.stationReportFailCount -= 1; return json(503, { message: "e2e: station report unavailable" }); }
      let row = be.stationReportCommands.get(body.p_command_uuid);
      if (!row) {
        row = body.p_preview ? { command_uuid: body.p_command_uuid, command_type: "report_preview", status: "previewed", requested_at: new Date().toISOString(), preview_result: {
          status: "previewed", allowed: true, hard: false, available: 9999, shown_at: new Date().toISOString(),
          legacy_snapshot: { report: { guard: { code: "", hard: false, message: "", Details: { available: 9999 } } } },
        } } : { command_uuid: body.p_command_uuid, command_type: "report", status: "applied", requested_at: new Date().toISOString(), applied_at: new Date().toISOString() };
        be.stationReportCommands.set(body.p_command_uuid, row);
      }
      return json(200, row);
    }
    if (p === "/rest/v1/rpc/machtile_submit_stop_report") {
      const body = JSON.parse(req.postData() || "{}");
      be.stopReportSubmits.push(body);
      // 模擬雲端函式還沒有 p_acks 參數：PostgREST 找不到符合的函式簽章
      if (be.stopReportAckMissing && "p_acks" in body) return json(404, { code: "PGRST202", message: "Could not find the function public.machtile_submit_stop_report(p_acks, ...) in the schema cache" });
      let row = be.commands.get(body.p_command_uuid);
      if (!row) {
        row = { id: id(9700 + be.stopReportSubmits.length), command_uuid: body.p_command_uuid, command_type: "stop_report", machine_code: body.p_machine_code,
          expected_order_no: body.p_order_no, expected_index_sn: body.p_index_sn, requested_at: new Date().toISOString(), status: "pending", reject_code: null, reject_message: null, applied_at: null };
        be.commands.set(body.p_command_uuid, row);
      }
      return json(200, row);
    }
    if (p === "/rest/v1/rpc/takeover_candidates") return json(200, be.takeoverCandidates);
    if (p === "/rest/v1/dispatch_pool_items") {
      if (!q.includes("status=eq.waiting")) return json(200, []);
      return json(200, be.poolItems.filter((item) => !be.poolClaims.some((c) => c.p_source_key === item.source_key)));
    }
    if (p === "/rest/v1/rpc/dispatch_pool_claim") {
      const body = JSON.parse(req.postData() || "{}");
      be.poolClaims.push(body);
      const item = be.poolItems.find((x) => x.source_key === body.p_source_key);
      if (item) be.procMachine[item.work_order_no] = body.p_machine_code;   // 模擬雲端：工序掛到這台、status 維持 pending
      return json(200, { action: "claimed", source_key: body.p_source_key, machine_code: body.p_machine_code });
    }
    if (p === "/rest/v1/rpc/machtile_submit_takeover") {
      const body = JSON.parse(req.postData() || "{}");
      be.takeoverSubmits.push(body);
      const cand = be.takeoverCandidates.find((c) => c.id === body.p_stop_note_id);
      const row = { id: id(9500 + be.takeoverSubmits.length), command_uuid: body.p_command_uuid, command_type: "takeover", takeover_order_no: cand?.order_no || null,
        machine_code: body.p_machine_code, requested_at: new Date().toISOString(), status: "pending", reject_code: null, reject_message: null };
      be.commands.set(body.p_command_uuid, row);
      return json(200, row);
    }
    // 開卡時重讀單一工序（id=eq.）
    if (p === "/rest/v1/work_order_processes" && /(^|[?&])id=eq\./.test(q)) {
      be.freshReads = (be.freshReads || 0) + 1;
      const pid = (q.match(/id=eq\.([0-9a-f-]+)/) || [])[1];
      const x = procs.find((k) => id(300 + k.n) === pid);
      if (!x) return json(200, []);
      const o = be.procOverride[x.machine] || {};
      const extra = be.procExtra[x.wo] || {};
      return json(200, [{ id: pid, qty_completed: extra.qty_completed ?? 0, qty_defect: extra.qty_defect ?? 0, process_order: o.step ?? x.step, process_name: x.proc, status: o.status || be.procStatus[x.wo] || "pending", off_station_at: o.off_station_at ?? null,
        work_orders: { work_order_no: x.wo, part_no: "part_no" in o ? o.part_no : x.partNo, part_name: x.part, status: "in_progress" },
        machines: { machine_code: o.machine || be.procMachine[x.wo] || x.machine } }]);
    }
    if (p === "/rest/v1/work_order_processes" && q.includes("legacy_index_sn")) {
      const m = q.match(/id=in\.\(([^)]*)\)/);
      return json(200, (m ? m[1].split(",") : []).map((pid) => {
        const proc = procs.find((item) => id(300 + item.n) === pid);
        return { id: pid, legacy_index_sn: proc?.step ?? 5, manufacture_ii_id: proc?.manufactureIiId ?? null, simulation_id: `SIM-${proc?.machine || "A04"}`, work_orders: { part_no: proc?.partNo || "HCG-06-01" } };
      }));
    }
    if (p === "/rest/v1/work_order_processes" && (url.searchParams.get("select") || "").includes("work_orders!inner")) {
      be.listReads++;
      (be.listQueries = be.listQueries || []).push(q);
      return json(200, procs.map((x) => {
        const c = cards.find((k) => k.work_order_no === x.wo);
        const machineCode = be.procMachine[x.wo] || x.machine;
        return {
          id: c.current_process_id, tenant_id: T, process_order: x.step, process_name: x.proc, process_type: "cnc", status: be.procStatus[x.wo] || "pending",
          off_station_at: null, qty_completed: 0, queue_order: null, manufacture_ii_id: x.manufactureIiId ?? null, ...(be.procExtra[x.wo] || {}),
          work_orders: { id: c.id, work_order_no: x.wo, part_no: x.partNo, part_name: x.part, quantity: x.qty, due_date: c.due_date, status: "in_progress" },
          machines: machines.find((m) => m.machine_code === machineCode),
        };
      }));
    }
    // 卡片底部「今日已開工／尚未開工」與總覽三格那一份查詢
    if (p === "/rest/v1/production_reports" && method === "GET" && q.includes("report_type=in.(dailyStart,noon,finish)")) {
      be.todayReads = (be.todayReads || 0) + 1;
      if (be.todayReadFail) return json(503, { message: "e2e: upstream unavailable" });
      return json(200, be.todayRows);
    }
    if (p === "/rest/v1/production_reports" && method === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      be.directPosts.push(body);
      if (be.directMode === "structRejected" && ("report_type" in body || "report_payload" in body)) return json(400, { code: "PGRST204", message: "Could not find the 'report_payload' column of 'production_reports' in the schema cache" });
      if (be.directMode === "noRow") return json(201, []);   // 回 201 但沒寫進去也沒回列
      be.directUuids = be.directUuids || new Set();
      if (body.report_uuid && be.directUuids.has(body.report_uuid)) return json(409, { code: "23505", message: "duplicate key value violates unique constraint \"uq_production_reports_tenant_report_uuid\"" });
      if (body.report_uuid) be.directUuids.add(body.report_uuid);
      if (be.directMode === "noRowButInserted") {   // 寫進去了，但回應沒有列
        be.todayRows = [{ process_id: body.process_id, report_type: body.report_type || null, created_at: new Date().toISOString(), started_at: null, ended_at: null,
          completed_qty: body.completed_qty, defect_qty: body.defect_qty, user_id: body.user_id || null, operator_ids: [] }, ...be.todayRows];
        return json(201, []);
      }
      be.todayRows = [{ process_id: body.process_id, report_type: body.report_type || null, created_at: new Date().toISOString(), started_at: null, ended_at: null,
        completed_qty: body.completed_qty, defect_qty: body.defect_qty, user_id: body.user_id || null, operator_ids: [] }, ...be.todayRows];
      return json(201, [{ id: id(8000 + be.directPosts.length), ...body }]);
    }
    if (p === "/rest/v1/rpc/field_report_upsert") {
      const body = JSON.parse(req.postData() || "{}");
      be.reportUpserts.push(body);
      if (be.upsertOffline) return route.abort("failed");   // 平板離線：outbox 排入待送
      if (be.dailyStartFail) return json(400, { code: "P0001", message: "e2e: field_report_upsert rejected" });
      be.insertedUuids = be.insertedUuids || new Map();
      if (be.insertedUuids.has(body.p_report_uuid)) return json(200, { inserted: false, report_id: be.insertedUuids.get(body.p_report_uuid) });   // 冪等重放
      be.insertedUuids.set(body.p_report_uuid, id(7000 + be.reportUpserts.length));
      const pl = body.p_payload || {};
      be.todayRows = [{ process_id: pl.process_id, report_type: pl.report_type, created_at: new Date().toISOString(), started_at: pl.started_at || null, ended_at: pl.ended_at || null,
        completed_qty: pl.completed_qty, defect_qty: pl.defect_qty, user_id: pl.user_id || null, operator_ids: pl.operators || [] }, ...be.todayRows];
      return json(200, { inserted: true, report_id: id(7000 + be.reportUpserts.length) });
    }
    if (p === "/rest/v1/v_work_order_cards") return json(200, [...cards.map((c) => (be.procMachine[c.work_order_no] ? { ...c, machine_name: be.procMachine[c.work_order_no] } : c)), ...be.extraCards]);
    if (p === "/rest/v1/v_machine_management_cards") return json(200, be.withDepartments ? machines.map((m) => ({ ...m, department_name: m.machine_code.startsWith("A") ? "車床課" : "銑床課" })) : machines);
    if (p === "/rest/v1/cnc_programs") return json(200, [{
      id: id(990), work_order_id: id(104), version: 3, sha256: "a".repeat(64),
      file_path: `${T}/cnc-programs/XX01202502050012/aaaaaaaaaaaaaaaa-O500%20finish.NC`,
      uploaded_by: "王小明", uploaded_at: "2026-10-13T01:02:03Z", same_as_previous: false,
    }]);
    if (p === "/rest/v1/app_users") {
      if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: be.appUserName || users[0].name }]);
      return json(200, users.map(({ auth, ...u }) => u));
    }
    if (p === "/rest/v1/legacy_station_progress") {
      const m = q.match(/work_order_no=in\.\(([^)]*)\)/);
      const wanted = m ? m[1].split(",").map((s) => s.replace(/"/g, "")) : [];
      return json(200, legacyRows.filter((r) => wanted.includes(r.work_order_no)));
    }
    if (p === "/rest/v1/station_stop_notes") return json(200, []);
    if (p === "/rest/v1/stop_reason_policy") return json(200, []);
    if (p === "/rest/v1/work_order_processes") {
      const m = q.match(/id=in\.\(([^)]*)\)/);
      if (m && q.includes("legacy_index_sn")) return json(200, m[1].split(",").map((pid) => {
        const proc = procs.find((item) => id(300 + item.n) === pid);
        return { id: pid, legacy_index_sn: proc?.step ?? 5, manufacture_ii_id: proc?.manufactureIiId ?? null, simulation_id: `SIM-${proc?.machine || "A04"}`, work_orders: { part_no: proc?.partNo || "HCG-06-01" } };
      }));
      if (m && q.includes("actual_start_at")) return json(200, m[1].split(",").map((pid) => ({ id: pid, process_order: procs.find((x) => id(300 + x.n) === pid)?.step || 1, process_type: "cnc", actual_start_at: null })));
      return json(200, []);
    }
    if (p === "/rest/v1/rpc/batch_report_progress") return be.progressReadFail ? json(503, { message: "e2e: progress unavailable" }) : json(200, be.progressRows);
    const readRpc = /^\/rest\/v1\/rpc\/(batch_report_progress|[a-z_]+_snapshot|[a-z_]+_list)$/.test(p);
    if (method !== "GET" && method !== "HEAD" && !readRpc) be.otherWrites.push(`${method} ${p}`);
    if (p.startsWith("/rest/v1/rpc/")) return json(200, null);
    if (p.startsWith("/rest/v1/")) return json(200, []);
    return json(200, {});
  };
  return be;
}

const blocked = [];
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  tablet: { viewport: { width: 800, height: 1100 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

async function newPage(browser, vp, { backend, configExtra = "", baseline = false, noRandomUuid = false, preload = null }) {
  const context = await browser.newContext({ ...VIEWPORTS[vp], serviceWorkers: "block", timezoneId: "Asia/Taipei", locale: "zh-TW" });
  const token = jwtFor(backend.role || "operator");
  await context.addInitScript(([token]) => {
    try {
      sessionStorage.setItem("machtileAuthSession", JSON.stringify({ version: 1, accessToken: token, refreshToken: "", email: "op@test.invalid", authMethod: "password", mode: "session", createdAt: Date.now(), rememberUntil: 0 }));
    } catch {}
  }, [token]);
  if (noRandomUuid) await context.addInitScript(() => { try { Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true, writable: true }); } catch {} });
  if (preload) await context.addInitScript((items) => { try { if (!sessionStorage.getItem("__preloaded")) { Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, v)); sessionStorage.setItem("__preloaded", "1"); } } catch {} }, preload);
  const appBase = baseline ? `${base}__baseline/` : base;
  await context.route("**/*", async (route) => {
    const u = route.request().url();
    if (u.startsWith(FAKE)) return backend.handle(route);
    if (u.startsWith(base)) {
      if (new URL(u).pathname.endsWith("/config.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: testConfig(configExtra) });
      return route.continue();
    }
    blocked.push(u);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(appBase, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid .machine-tile-card").length > 0, null, { timeout: 20000 });
  await page.waitForFunction(() => typeof machtileCardPickState === "undefined" || machtileCardPickState.status === "ready", null, { timeout: 20000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { deriveMachines(); renderWorkOrders(); });
  return { context, page, errors };
}

const cardOf = (page, code) => page.locator("#workOrderGrid .machine-tile-card").filter({ has: page.locator("h2", { hasText: code }) }).first();
const realErrors = (errors) => errors.filter((e) => !e.includes("CATALOG_ENDPOINT_INVALID"));
// 卡片裡的報工／完整單連結會帶頁面網址（對照組在 /__baseline/ 底下）→ 比較前把那段拿掉
const gridHtml = (page) => page.evaluate(() => {
  const grid = document.getElementById("workOrderGrid").cloneNode(true);
  grid.querySelectorAll(".program-strip, .machine-program-details, .machine-tile-actions, .machine-open-link[data-hmc-machine-detail]").forEach((el) => el.remove());
  return grid.innerHTML.replace(/\s+/g, " ").split("/__baseline/").join("/");
});
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return `@${i}: …${a.slice(Math.max(0, i - 80), i + 80)}… vs …${b.slice(Math.max(0, i - 80), i + 80)}…`; };
const sheet = (page) => page.locator("#machtileStationCmdSheet");
const fieldText = async (page, key) => (await sheet(page).locator(`[data-station-cmd-field="${key}"]`).innerText()).trim();

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

// ---------------------------------------------------------------------------------------------
if (!process.env.STANDARD_FINISH_ONLY) {
for (const vp of ["desktop", "tablet", "phone"]) {
  const W = VIEWPORTS[vp].viewport.width;
  console.log(`\n== ${W}px：旗標關（預設）＝跟現在一模一樣 ==`);
  let baselineGrid = null;
  if (baselineAvailable) {
    const be0 = makeBackend();
    const b = await newPage(browser, vp, { backend: be0, baseline: true });
    baselineGrid = await gridHtml(b.page);
    await b.context.close();
  }
  {
    const be = makeBackend();
    const { context, page, errors } = await newPage(browser, vp, { backend: be });
    ok(await page.locator(".station-cmd-row, [data-station-cmd], [data-takeover-open-idle]").count() === 0, `${W}：旗標關 → 沒有開工／停工／空機接手按鈕`);
    ok(be.stationReads === 0, `${W}：旗標關 → 完全沒讀 station_commands／沒呼叫 RPC（${be.stationReads}）`);
    if (baselineGrid !== null) { const g = await gridHtml(page); ok(g === baselineGrid, `${W}：旗標關 → Monitor 卡片 HTML 跟 ${baselineRef} 一字不差`, firstDiff(g, baselineGrid)); }
    else { skip++; console.log(`  SKIP ${W}：讀不到 ${baselineRef}，略過一字不差比對`); }
    await page.evaluate(() => openReport("", { machine: "A04" }));
    ok(await page.locator('.report-type-tab[data-report-type="dailyStart"]').count() === 0,
      `${W}：四分頁整合 → 單台報工不顯示今日開工`);
    await page.evaluate(() => closeReport());
    ok(be.otherWrites.length === 0, `${W}：旗標關 → 沒有任何寫入`, be.otherWrites.join(" "));
    ok(realErrors(errors).length === 0, `${W}：旗標關 → 沒有 JS 錯誤`, realErrors(errors).join(" | "));
    await context.close();
  }

  console.log(`== ${W}px：旗標開但 station_commands 表不存在 ==`);
  {
    const be = makeBackend({ tableMissing: true });
    const { context, page, errors } = await newPage(browser, vp, { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
    ok(await page.locator(".station-cmd-row, [data-station-cmd]").count() === 0, `${W}：表不存在 → 沒有按鈕`);
    ok(be.stationReads >= 1 && be.submits.length === 0, `${W}：只試讀一次，沒送任何指令`);
    if (baselineGrid !== null) { const g = await gridHtml(page); ok(g === baselineGrid, `${W}：表不存在 → 卡片 HTML 跟 ${baselineRef} 一字不差`, firstDiff(g, baselineGrid)); }
    else { skip++; console.log(`  SKIP ${W}：讀不到 ${baselineRef}，略過表不存在時一字不差比對`); }
    ok(realErrors(errors).length === 0, `${W}：表不存在 → 沒有 JS 錯誤`, realErrors(errors).join(" | "));
    await context.close();
  }

  console.log(`== ${W}px：旗標只開 A04 ==`);
  {
    const be = makeBackend();
    const { context, page, errors } = await newPage(browser, vp, { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
    const a04 = cardOf(page, "A04");
    ok(await a04.locator("[data-station-cmd]").count() === 2, `${W}：A04 有「開工」「停工」`);
    ok(await page.locator("#workOrderGrid [data-station-cmd]").count() === 2, `${W}：只有 A04 有（A01、B03 沒有）`);
    ok(be.submits.length === 0, `${W}：還沒按 → 沒送`);
    await a04.scrollIntoViewIfNeeded();
    await a04.screenshot({ path: path.join(outDir, `${vp}-01-a04-card.png`) });

    // 2026-10-12 owner：三種卡片統一底部列＝報工｜開工｜停工；中段「舊 MES」區塊維持移除
    ok(await a04.locator(".machine-tile-footer .machine-tile-actions [data-station-cmd]").count() === 2, `${W}：開工／停工在卡片底部按鈕列（.machine-tile-actions）`);
    ok(await a04.locator(".station-cmd-row, [data-station-cmd-row], .station-cmd-label").count() === 0, `${W}：A04 中段「舊 MES 開工 停工」區塊已拿掉`);
    const footerLabels = (await a04.locator(".machine-tile-actions > *").allInnerTexts()).map((t) => t.trim());
    ok(footerLabels.join("｜") === "報工｜開工｜停工", `${W}：底部順序＝報工｜開工｜停工`, footerLabels.join("｜"));
    const sizes = await a04.locator(".machine-tile-actions > button").evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { h: Math.round(r.height), font: cs.fontSize, bg: cs.backgroundColor }; }));
    ok(sizes.length === 3 && sizes.every((x) => x.h === sizes[0].h && x.font === sizes[0].font), `${W}：三顆按鈕同一個大小`, JSON.stringify(sizes));
    ok(sizes[1]?.bg === "rgb(21, 128, 61)", `${W}：開工仍是綠色（--green-strong）`, sizes[1]?.bg);
    ok(sizes[2]?.bg === "rgb(180, 35, 24)", `${W}：停工仍是紅色`, sizes[2]?.bg);
    const programSummary = a04.locator(".machine-program-details summary");
    ok(await programSummary.count() === 1, `${W}：CNC 程式收斂成一列可展開徽章`);
    ok(await a04.locator(".machine-program-panel").isHidden(), `${W}：程式細節預設收合`);
    await programSummary.click();
    ok(await a04.locator(".machine-program-panel").isVisible(), `${W}：點徽章列會展開程式細節`);
    const programText = (await a04.locator(".machine-program-panel").innerText()).replace(/\s+/g, " ");
    ok(programText.includes("上傳人 王小明") && programText.includes("上傳時間") && programText.includes("版本 V3") && programText.includes("檔名 O500 finish.NC"), `${W}：展開顯示上傳人／時間／版本／檔名`, programText);
    await cardOf(page, "A01").locator(".machine-program-details summary").click();
    const pendingProgramText = (await cardOf(page, "A01").locator(".machine-program-panel").innerText()).replace(/\s+/g, " ");
    ok(pendingProgramText.includes("上傳人 —") && pendingProgramText.includes("上傳時間 —"), `${W}：無 metadata 顯示 —、不報錯`, pendingProgramText);
    await programSummary.click();
    const hmcFooterLabels = (await cardOf(page, "B01").locator(".machine-tile-actions > *").allInnerTexts()).map((t) => t.trim());
    ok(hmcFooterLabels[0] === "報工" && hmcFooterLabels.at(-1) === "多盤多工件每日盤點", `${W}：B01 報工在左、多盤按鈕保留最右`, hmcFooterLabels.join("｜"));
    if (vp === "phone") {
      const overflow = await page.evaluate(() => {
        const card = [...document.querySelectorAll("#workOrderGrid .machine-tile-card")].find((c) => c.querySelector("h2")?.textContent.includes("A04"));
        const cr = card.getBoundingClientRect();
        const btns = [...card.querySelectorAll(".machine-tile-actions > *")].map((b) => b.getBoundingClientRect());
        return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, card: card.scrollWidth - card.clientWidth,
          outside: btns.filter((r) => r.left < cr.left - 0.5 || r.right > cr.right + 0.5).length };
      });
      ok(overflow.doc <= 0 && overflow.card <= 0 && overflow.outside === 0, "390：三顆按鈕不會橫向溢出", JSON.stringify(overflow));
    }
    if (vp === "tablet") {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(overflow <= 1, `800px 沒有橫向捲動（${overflow}px）`);
    }
    // 跟 main（同樣旗標只開 A04）比：A04 以外的卡片原始 HTML 逐字相同；A04 變矮
    if (baselineAvailable) {
      const bBe = makeBackend();
      const b = await newPage(browser, vp, { backend: bBe, baseline: true, configExtra: 'stationCommandMachines: ["A04"],' });
      const rawCards = (pg) => pg.evaluate(() => [...document.querySelectorAll("#workOrderGrid .machine-tile-card")]
        .map((c) => { const clone = c.cloneNode(true); clone.querySelectorAll(".program-strip, .machine-program-details, .machine-tile-actions, .machine-open-link[data-hmc-machine-detail]").forEach((el) => el.remove()); return { name: c.querySelector("h2")?.textContent.trim() || "", html: clone.outerHTML.split("/__baseline/").join("/") }; }));
      const mine = await rawCards(page);
      const theirs = await rawCards(b.page);
      const others = mine.filter((c) => !c.name.startsWith("A04"));
      const othersBase = theirs.filter((c) => !c.name.startsWith("A04"));
      ok(others.length > 0 && others.length === othersBase.length && others.every((c, i) => c.html === othersBase[i].html),
        `${W}：排除本 PR 的程式列／底部列後，A04 以外 ${others.length} 張卡片跟 ${baselineRef} 相同`,
        others.map((c, i) => c.html === othersBase[i]?.html ? "" : `${c.name} ${firstDiff(c.html, othersBase[i]?.html || "")}`).filter(Boolean).join(" | "));
      const baseA04 = cardOf(b.page, "A04");
      // #74 已合進 main 之後，基準本身就沒有中段區塊：此時「比 main 矮」不再適用，改印 SKIP（只在基準仍是舊版時斷言）
      const baseHasMiddle = (await baseA04.locator("[data-station-cmd-row]").count()) === 1;
      if (!baseHasMiddle) console.log(`  SKIP ${W}：基準 ${baselineRef} 已含 #74（無中段區塊），不比較高度`);
      await baseA04.scrollIntoViewIfNeeded();
      // 截圖時把浮在上面的東西（登入徽章、AI 客服、回報鈕、手機底部分頁、toast）暫時藏起來，才看得到卡片底部；截完拿掉
      const hideFloating = (pg) => pg.addStyleTag({ content: "#machtileSessionBadge, #aiSupportFab, .fab, .mobile-tabs, #toast { visibility: hidden !important; }" });
      const hideB = await hideFloating(b.page); const hideMine = await hideFloating(page);
      const hBefore = Math.round((await baseA04.boundingBox()).height);
      await baseA04.screenshot({ path: path.join(outDir, `${vp}-00-a04-before-main.png`) });
      await a04.scrollIntoViewIfNeeded();
      const hAfter = Math.round((await a04.boundingBox()).height);
      await a04.screenshot({ path: path.join(outDir, `${vp}-00-a04-after.png`) });
      console.log(`  INFO ${W}：A04 卡片高度 main ${hBefore}px → 現在 ${hAfter}px（矮 ${hBefore - hAfter}px）`);
      if (baseHasMiddle) ok(hAfter < hBefore, `${W}：A04 卡片比 main 矮（${hBefore} → ${hAfter}px）`);
      else ok(hAfter <= hBefore + 40, `${W}：A04 卡片沒有比已含 #74 的基準明顯變高（${hBefore} → ${hAfter}px）`);
      await hideB.evaluate((el) => el.remove()); await hideMine.evaluate((el) => el.remove());
      await b.context.close();
    } else {
      skip += 3;
      console.log(`  SKIP ${W}：讀不到 ${baselineRef}，略過 #74 非 A04 卡片逐字比對、main A04 區塊與高度比對（3 項）`);
    }

    // 確認卡內容
    await a04.locator('[data-station-cmd="start"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
    ok(!(await page.locator("#detailSheet").evaluate((el) => el.classList.contains("is-open"))), `${W}：按開工不會打開工單明細`);
    ok((await sheet(page).locator("h2").innerText()).trim() === "確認開工", `${W}：確認卡標題「確認開工」`);
    ok(await fieldText(page, "machine") === "A04", `${W}：機台 A04`);
    ok(await fieldText(page, "order") === "XX01202502050012", `${W}：工單號`);
    ok(await fieldText(page, "part") === "HCG-06-01　HCG-06本體", `${W}：料號＋品名`, await fieldText(page, "part"));
    ok(await fieldText(page, "step") === "第 5 道　CNC車床二序", `${W}：第幾道＋工序名`, await fieldText(page, "step"));
    const legacyText = (await sheet(page).locator("[data-station-cmd-legacy]").innerText()).replace(/\s+/g, " ");
    ok(/畫面資料（(10\/7 )?09:35）顯示：舊 MES 這台掛的是這張單的第 5 道，工廠套用前會再核對/.test(legacyText),`${W}：畫面資料（legacy_snapshot_at）顯示…，工廠套用前會再核對`, legacyText);
    ok(legacyText.includes("顯示：舊 MES 已報 良品 208、不良 2") && legacyText.includes("舊 MES 最後報工：2026-10-07 09:30") && !legacyText.includes("09:35:10"),
      `${W}：舊 MES 現況＝第 5 道那列（不是第 4 道）`, legacyText);
    ok(legacyText.includes("派工橋沒有同步") , `${W}：照實說開停狀態沒有同步`);
    ok(be.freshReads >= 1, `${W}：開卡時重讀這一道（work_order_processes id=eq.）`);
    // 無障礙：初始焦點在「取消」、Tab 轉不出去、Esc 關閉、焦點回到開工鈕
    ok(await page.evaluate(() => document.activeElement?.hasAttribute("data-station-cmd-close")), `${W}：初始焦點在「取消」（不是確認）`);
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    ok(await page.evaluate(() => Boolean(document.activeElement?.closest("#machtileStationCmdSheet"))), `${W}：Tab 六次焦點仍在確認卡裡（focus trap）`);
    await page.keyboard.press("Shift+Tab");
    ok(await page.evaluate(() => Boolean(document.activeElement?.closest("#machtileStationCmdSheet"))), `${W}：Shift+Tab 也轉不出去`);
    await page.keyboard.press("Escape");
    ok(await sheet(page).count() === 0 && be.submits.length === 0, `${W}：Esc 關閉、沒送`);
    ok(await page.evaluate(() => document.activeElement?.matches('[data-station-cmd="start"][data-station-cmd-machine="A04"]')), `${W}：關閉後焦點回到 A04「開工」`);
    await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
    const fontPx = await sheet(page).locator('[data-station-cmd-field="order"]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    ok(fontPx >= 22, `${W}：工單號是大字（${fontPx}px）`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, `${W}：沒有橫向捲動（${overflow}px）`);
    ok(be.submits.length === 0, `${W}：開確認卡還沒送`);
    await page.screenshot({ path: path.join(outDir, `${vp}-02-confirm-start.png`) });

    // 不是這張單 → 只叫他找生管
    await sheet(page).locator("[data-station-cmd-notthis-open]").click();
    const notThis = (await sheet(page).locator("[data-station-cmd-notthis]").innerText()).trim();
    ok(notThis.includes("請找生管") && notThis.includes("不會幫你換單"), `${W}：不是這張單 → 找生管`, notThis);
    ok(await sheet(page).locator("[data-station-cmd-confirm]").count() === 0 && await sheet(page).locator("[data-card-select-process], [data-card-pick]").count() === 0, `${W}：不給確認、也不給換單`);
    await page.screenshot({ path: path.join(outDir, `${vp}-03-not-this-order.png`) });
    await sheet(page).locator("[data-station-cmd-close]").click();
    ok(await sheet(page).count() === 0 && be.submits.length === 0, `${W}：關掉 → 沒送`);

    // 確認 → 等待中（連按只送一次、卡片按鈕鎖住）
    be.mode = "hold";
    await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
    await sheet(page).locator("[data-station-cmd-confirm]").evaluate((el) => { el.click(); el.click(); el.click(); });
    await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor({ timeout: 10000 });
    ok(be.submits.length === 1, `${W}：連按三下只送一次（${be.submits.length}）`);
    const sent = be.submits[0] || {};
    ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sent.p_command_uuid || ""), `${W}：command_uuid 由 App 產生（v4）`, sent.p_command_uuid);
    ok(sent.p_command_type === "start" && sent.p_machine_code === "A04" && sent.p_expected_order_no === "XX01202502050012" && sent.p_expected_index_sn === 5 && sent.p_expected_part_no === "HCG-06-01" && sent.p_manufacture_ii_id === null,
      `${W}：送出內容＝合約欄位`, JSON.stringify(sent));
    ok((await sheet(page).locator("[data-station-cmd-result]").innerText()).includes("不要重按"), `${W}：等待中提示不要重按`);
    await page.waitForFunction(() => document.querySelector("#machtileStationCmdSheet [data-station-cmd-result] strong")?.textContent.includes("工廠處理中"), null, { timeout: 10000 }).catch(() => {});   // 輪詢 → claimed
    ok((await sheet(page).locator("[data-station-cmd-result] strong").innerText()).trim() === "工廠處理中…", `${W}：輪詢到 claimed → 工廠處理中`);
    await page.screenshot({ path: path.join(outDir, `${vp}-04-pending.png`) });
    await sheet(page).locator("[data-station-cmd-close]").click();
    const disabled = await cardOf(page, "A04").locator("[data-station-cmd]").evaluateAll((els) => els.map((e) => e.disabled));
    ok(disabled.length === 2 && disabled.every(Boolean), `${W}：等待中 A04 兩個按鈕都鎖住`, JSON.stringify(disabled));
    ok((await cardOf(page, "A04").locator("[data-station-cmd-status]").innerText()).includes("開工：工廠處理中"), `${W}：卡片顯示等待中（開工：工廠處理中）`);
    await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click({ force: true }).catch(() => {});
    ok(await sheet(page).count() === 0 && be.submits.length === 1, `${W}：等待中按停工沒反應`);

    // applied
    be.mode = "applied";
    await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-station-cmd-status]')?.textContent.includes("已開工"), null, { timeout: 15000 });
    const enabled = await cardOf(page, "A04").locator("[data-station-cmd]").evaluateAll((els) => els.map((e) => !e.disabled));
    ok(enabled.every(Boolean), `${W}：套用完成 → 按鈕解鎖`);
    ok((await cardOf(page, "A04").locator("[data-station-cmd-status]").innerText()).trim() === "已開工", `${W}：卡片顯示「已開工」`);
    await cardOf(page, "A04").scrollIntoViewIfNeeded();
    {
      const hide = await page.addStyleTag({ content: "#machtileSessionBadge, #aiSupportFab, .fab, .mobile-tabs, #toast { visibility: hidden !important; }" });
      await cardOf(page, "A04").screenshot({ path: path.join(outDir, `${vp}-05-a04-applied.png`) });
      await hide.evaluate((el) => el.remove());
    }
    ok(await cardOf(page, "A04").locator(".station-cmd-footline + .machine-tile-footer [data-station-cmd]").count() === 2, `${W}：狀態字在卡片底部正上方一行（緊接著底部按鈕列）`);

    // 開著確認卡看到 applied
    be.mode = "hold";
    await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
    ok((await sheet(page).locator("h2").innerText()).trim() === "確認停工", `${W}：停工確認卡`);
    await sheet(page).locator("[data-station-cmd-confirm]").click();
    await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor();
    ok(be.submits.length === 2 && be.submits[1].p_command_type === "stop" && be.submits[1].p_command_uuid !== be.submits[0].p_command_uuid, `${W}：停工是新的一筆指令（新 uuid）`);
    be.mode = "applied";
    await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
    ok((await sheet(page).locator("[data-station-cmd-result] strong").innerText()).trim() === "已停工", `${W}：確認卡顯示「已停工」`);
    await page.screenshot({ path: path.join(outDir, `${vp}-06-applied-stop.png`) });
    await sheet(page).locator("[data-station-cmd-close]").click();

    // rejected
    be.mode = "hold";
    await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
    await sheet(page).locator("[data-station-cmd-confirm]").click();
    await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor();
    be.mode = "rejected";
    await sheet(page).locator('[data-station-cmd-result="rejected"]').waitFor({ timeout: 15000 });
    const rej = (await sheet(page).locator("[data-station-cmd-result]").innerText()).replace(/\s+/g, " ");
    ok(rej.includes("沒有開工") && rej.includes("舊 MES 這台現在不是這張工單") && rej.includes("請找生管") && rej.includes("Manufacture.OrderNO=XX01202509300001") && rej.includes("ORDER_MISMATCH"),
      `${W}：被拒 → 白話原因＋工廠說明＋代碼`, rej);
    await page.screenshot({ path: path.join(outDir, `${vp}-07-rejected.png`) });
    await sheet(page).locator("[data-station-cmd-close]").click();
    ok((await cardOf(page, "A04").locator("[data-station-cmd-status]").innerText()).includes("沒有開工"), `${W}：卡片顯示被拒`);
    ok(await cardOf(page, "A04").locator('[data-station-cmd="start"]').isEnabled(), `${W}：被拒後可以再按`);

    // expired
    be.mode = "hold";
    await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
    await sheet(page).locator("[data-station-cmd-confirm]").click();
    await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor();
    be.mode = "expired";
    await sheet(page).locator('[data-station-cmd-result="expired"]').waitFor({ timeout: 15000 });
    const exp = (await sheet(page).locator("[data-station-cmd-result]").innerText()).replace(/\s+/g, " ");
    ok(exp.includes("已過期") && exp.includes("超過 10 分鐘工廠都沒有接手") && exp.includes("沒有生效"), `${W}：伺服器 expired → 白話`, exp);
    await page.screenshot({ path: path.join(outDir, `${vp}-08-expired.png`) });
    await sheet(page).locator("[data-station-cmd-close]").click();

    // 單台報工：A04 在開工／停工名單內，隱藏重複的「今日開工」；既有 dailyStart flow 往下一頁 noon。
    const compareShots = process.env.STATION_CMD_COMPARE_SHOTS;
    if (W === 800 && compareShots && baselineAvailable) {
      await mkdir(compareShots, { recursive: true });
      const before = await newPage(browser, vp, { backend: makeBackend(), baseline: true, configExtra: 'stationCommandMachines: ["A04"],' });
      await before.page.evaluate(() => openReport("", { machine: "A04", reportType: "dailyStart" }));
      await before.page.screenshot({ path: path.join(compareShots, "800-before-daily-start-visible.png"), fullPage: true });
      await before.context.close();
    }
    await page.evaluate(() => openReport("", { machine: "A04", reportType: "dailyStart" }));
    ok(!(await page.locator('.report-type-tab[data-report-type="dailyStart"]').isVisible()), `${W}：A04 報工隱藏「今日開工」分頁`);
    ok(await page.locator('.report-type-tab[data-report-type="noon"]').getAttribute("class").then((value) => value.includes("active")), `${W}：A04 dailyStart flow 預設改到下一個可用分頁「中午報工」`);
    ok(!(await page.locator('[data-report-section="dailyStart"]').isVisible()), `${W}：A04 今日開工表單內容一併隱藏`);
    ok(await page.locator('[data-station-cmd-recordonly]').count() === 0, `${W}：A04 不再顯示「只記錄（不改舊 MES）」註記`);
    if (W === 800 && compareShots) await page.screenshot({ path: path.join(compareShots, "800-after-daily-start-hidden.png"), fullPage: true });
    await page.evaluate(() => closeReport());
    await page.evaluate(() => openReport("", { machine: "A01", reportType: "dailyStart" }));
    ok(await page.locator('.report-type-tab[data-report-type="dailyStart"]').count() === 0, `${W}：A01 也維持四分頁，沒有已移除的今日開工入口`);
    await page.evaluate(() => closeReport());

    ok(be.otherWrites.length === 0, `${W}：除了指令 RPC 沒有任何其他寫入`, be.otherWrites.join(" "));
    ok(realErrors(errors).length === 0, `${W}：沒有 JS 錯誤`, realErrors(errors).join(" | "));
    await context.close();
  }

  console.log(`== ${W}px：11 台 CNC 名單開啟 ==`);
  {
    const be = makeBackend();
    const allCnc = ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"];
    const { context, page, errors } = await newPage(browser, vp, { backend: be, configExtra: `stationCommandMachines: ${JSON.stringify(allCnc)},` });
    ok(await page.evaluate((want) => JSON.stringify(config.stationCommandMachines) === JSON.stringify(want), allCnc), `${W}：頁面收到完整 11 台 CNC 名單`);
    const eligibleFixtureMachines = ["A01", "A04", "B03"];
    for (const machine of eligibleFixtureMachines) {
      ok(await cardOf(page, machine).locator("[data-station-cmd]").count() === 2, `${W}：${machine} 有「開工」「停工」`);
    }
    for (const machine of ["B01", "B04"]) {
      ok(await cardOf(page, machine).locator("[data-station-cmd]").count() === 0, `${W}：${machine} fixture 缺 ManufactureII Id 仍被安全擋下`);
    }
    await cardOf(page, "B03").locator('[data-station-cmd="stop"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
    await sheet(page).locator("[data-station-cmd-confirm]").click();
    for (let i = 0; i < 20 && be.submits.length === 0; i++) await page.waitForTimeout(50);
    ok(be.submits.at(-1)?.p_manufacture_ii_id === "C011E0ZE2YZJ", `${W}：B03 停工送出卡片的 ManufactureII Id`);
    await sheet(page).locator("[data-station-cmd-close]").click();
    ok(await page.locator("#workOrderGrid [data-station-cmd]").count() === eligibleFixtureMachines.length * 2, `${W}：只有具備完整工序資料的 fixture 出現按鈕`);
    ok(be.submits.length === 1, `${W}：只由測試點擊送出一筆 B03 指令`);
    ok(realErrors(errors).length === 0, `${W}：11 台名單沒有 JS 錯誤`, realErrors(errors).join(" | "));
    await context.close();
  }
}

console.log("\n== 390px：空機台「選工單」→舊工單 可接手停工單；有單機台開工不再有分頁 ==");
{
  const candidate = { id: id(880), source_machine: "A04", order_no: "XX01202502050012", index_sn: 5,
    stopped_by_name: "王小明", stopped_at: new Date().toISOString(), reason_code: "RUSH_ORDER", note: null,
    good_qty: 20, fail_qty: 0 };
  const be = makeBackend({ takeoverCandidates: [candidate] });
  const cfg = 'stationCommandMachines: ["A02", "A04"], enableTakeover: true, takeoverMachines: ["A02", "A04"], enablePickStartFlow: true, pickStartFlowMachines: ["A02", "A04"],';
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: cfg });
  const idle = cardOf(page, "A02");
  const pickButton = idle.locator("[data-pick-order-open]");
  ok(await pickButton.count() === 1 && (await pickButton.innerText()).trim() === "選工單", "空機台 A02 只顯示「選工單」");
  ok(await idle.locator("[data-takeover-open-idle]").count() === 0, "空機台不再有「接手停工單」按鈕（併入選工單→舊工單）");
  ok(await idle.locator("[data-station-cmd]").count() === 0, "空機台不新增一般開工／停工入口");
  ok(await idle.locator(".machine-report-button, .machine-finish-button").count() === 0, "空機台沒有報工／完工按鈕");
  await pickButton.click();
  await page.locator('#machtileCardSelection [data-pick-tab="old"]').click();
  await page.locator(`#machtileCardSelection [data-takeover-candidate="${candidate.id}"]`).waitFor();
  await page.screenshot({ path: path.join(outDir, "phone-pick-old-order.png") });
  await page.locator(`#machtileCardSelection [data-takeover-candidate="${candidate.id}"]`).click();
  await page.waitForFunction(() => document.querySelector("#machtileCardSelection") === null);
  ok(be.takeoverSubmits.length === 1, "空機台候選確認後只送出一筆 machtile_submit_takeover");
  const sent = be.takeoverSubmits[0] || {};
  ok(JSON.stringify(Object.keys(sent).sort()) === JSON.stringify(["p_command_uuid", "p_machine_code", "p_stop_note_id"])
      && sent.p_machine_code === "A02" && sent.p_stop_note_id === candidate.id && !("p_part_no" in sent),
    "接手 payload 正確；p_part_no 不混入品名或其他欄位", JSON.stringify(sent));
  ok(await idle.locator("[data-pick-order-open]").isDisabled(), "有未確認 pending 指令時「選工單」按鈕停用");
  const activeStart = cardOf(page, "A04").locator('[data-station-cmd="start"]');
  ok(await activeStart.count() === 1, "有工單（未開工）機台保留開工入口");
  ok(await cardOf(page, "A04").locator('[data-station-cmd="stop"], [data-pick-order-open]').count() === 0, "有工單未開工機台只有「開工」（沒有停工、選工單）");
  await activeStart.click();
  await sheet(page).locator("[data-station-cmd-confirm]").waitFor();
  ok(await page.locator("#machtileTakeoverSheet, [data-takeover-tab], [data-pick-tab]").count() === 0,
    "開工畫面不再有新單／舊單分頁（直接是原本的開工確認卡）");
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(realErrors(errors).length === 0, "空機接手沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：空機台沒有候選時顯示明確訊息 ==");
{
  const be = makeBackend({ takeoverCandidates: [] });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be,
    configExtra: 'stationCommandMachines: ["A02"], enableTakeover: true, takeoverMachines: ["A02"], enablePickStartFlow: true, pickStartFlowMachines: ["A02"],' });
  await cardOf(page, "A02").locator("[data-pick-order-open]").click();
  await page.locator('#machtileCardSelection [data-pick-tab="old"]').click();
  await page.waitForFunction(() => { const pane = document.querySelector('#machtileCardSelection [data-takeover-pane="takeover"]'); return pane && !pane.textContent.includes("讀取中"); }, null, { timeout: 10000 }).catch(() => {});   // 等候選讀完再讀字（原本點完立刻讀＝讀到「讀取中…」）
  const text = (await page.locator('#machtileCardSelection [data-takeover-pane="takeover"]').innerText()).trim();
  ok(text === "目前沒有可接手的停工單", "沒有候選顯示「目前沒有可接手的停工單」", text);
  ok(be.takeoverSubmits.length === 0 && realErrors(errors).length === 0, "沒有候選不送出且沒有 JS 錯誤");
  await context.close();
}

// 停工對話框＝報工＋停工一次（owner 10/25）：數量＝上次報工之後、停工前還沒報的件數；已報累計顯示在題目上。
// r3d 串接測試：先報工 4 已 applied，停工又填 4 → 工廠 DUPLICATE_SUSPECTED → 以前自動退一般停工、停工單沒建立。
const STOP_WO = "XX01202502050012";
async function stopDialogPage(be, { qtyCompleted = 4 } = {}) {
  be.procExtra[STOP_WO] = { simulation_id: "Y011EBNTBCW4", qty_completed: qtyCompleted };
  if (!be.progressRows.length) be.progressRows = [{ process_id: id(304), legacy_output: qtyCompleted, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0 }];
  const { context, page, errors } = await newPage(browser, "phone", { backend: be,
    configExtra: 'stationCommandMachines: ["A04"], enableTakeover: true, takeoverMachines: ["A04"],' });
  await page.waitForFunction(() => machtileTakeover.availability === "ready", null, { timeout: 10000 });
  await page.evaluate(() => {
    window.__toasts = [];
    const original = window.showToast;
    window.showToast = (message) => { window.__toasts.push(String(message)); return original(message); };
  });
  return { context, page, errors };
}
const takeoverSheet = (page) => page.locator("#machtileTakeoverSheet");
async function openStopDialog(page) {
  await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click();
  await takeoverSheet(page).locator("[data-takeover-good]").waitFor();
}
async function fillStopDialog(page, good, fail) {
  const ts = takeoverSheet(page);
  await ts.locator("[data-takeover-good]").fill(String(good));
  await ts.locator("[data-takeover-fail]").fill(String(fail));
  await ts.locator('[data-takeover-reason="RUSH_ORDER"]').click();
  await ts.locator('[data-takeover-allow="yes"]').click();
}
const legacyStopSubmits = (be) => be.submits.filter((b) => b.p_command_type === "stop");

console.log("\n== 390px：停工對話框——總數 140／已報 94 → 送出 good=46 ==");
{
  const be = makeBackend();
  be.mode = "applied";
  const { context, page, errors } = await stopDialogPage(be, { qtyCompleted: 94 });
  const done = await page.evaluate(() => machtileStationCmdMachineByCode("A04")?.order?.done);
  ok(done === 94, "卡片 A04 這一道已報累計＝94（現有 order.done）", String(done));
  await openStopDialog(page);
  const ts = takeoverSheet(page);
  const question = (await ts.locator("[data-takeover-qty-question]").innerText()).trim();
  ok(question === "這一道目前良品總數（含已報 94 件）", "題目要求填目前良品總數，並顯示已報 94 件", question);
  ok(await ts.locator("[data-takeover-good]").inputValue() === "" && await ts.locator("[data-takeover-fail]").inputValue() === "", "良品／不良都不預設（空白）");
  await ts.locator('[data-takeover-reason="RUSH_ORDER"]').click();
  await ts.locator('[data-takeover-allow="yes"]').click();
  ok(await ts.locator("[data-takeover-stop-confirm]").isDisabled(), "沒填數量 → 確認停工不能按（0 也要親手填）");
  await ts.locator("[data-takeover-good]").fill("140");
  ok(await ts.locator("[data-takeover-stop-confirm]").isDisabled(), "只填良品、不良空白 → 仍不能按");
  await ts.locator("[data-takeover-fail]").fill("0");
  ok(!(await ts.locator("[data-takeover-stop-confirm]").isDisabled()), "良品總數 140、不良總數 0 都填了 → 可以按");
  ok((await ts.locator("[data-takeover-add-qty]").innerText()).includes("良品 46 件"), "對話框顯示這次會新增良品 46 件");
  await page.screenshot({ path: path.join(outDir, "phone-stop-dialog-done4-fill0.png") });
  await ts.locator("[data-takeover-stop-confirm]").click();
  await page.waitForFunction(() => !document.getElementById("machtileTakeoverSheet") && !machtileStationCmd.pending.A04, null, { timeout: 15000 }).catch(() => {});
  const sent = be.stopReportSubmits[0] || {};
  ok(be.stopReportSubmits.length === 1 && sent.p_good_qty === 46 && sent.p_fail_qty === 0 && sent.p_fail_reason_code === null,
    "送出一筆 machtile_submit_stop_report：總數 140－已報 94＝good 46", JSON.stringify(be.stopReportSubmits));
  ok(!("p_acks" in sent) && sent.p_machine_code === "A04" && sent.p_order_no === STOP_WO && sent.p_index_sn === 5 && sent.p_expected_simulation_id === "Y011EBNTBCW4",
    "第一次送出不帶 p_acks；機台／工單／道次／SimulationId 正確", JSON.stringify(sent));
  ok(legacyStopSubmits(be).length === 0 && await page.locator("#machtileStationCmdSheet").count() === 0, "沒有另外送一般停工");
  ok(realErrors(errors).length === 0, "停工填 0 沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：停工回報被拒 DUPLICATE_SUSPECTED → 停工對話框再次確認（不退一般停工）；改數量／確定送出帶 ack ==");
{
  const be = makeBackend();
  be.mode = "code:DUPLICATE_SUSPECTED";
  const { context, page, errors } = await stopDialogPage(be);
  await openStopDialog(page);
  await fillStopDialog(page, 4, 0);
  await takeoverSheet(page).locator("[data-takeover-stop-confirm]").click();
  await takeoverSheet(page).locator("[data-takeover-dup]").waitFor({ timeout: 15000 });
  const ts = takeoverSheet(page);
  const dupText = (await ts.locator("[data-takeover-dup]").innerText()).trim();
  ok(dupText === "這個數量跟剛才報的很像，確定是另外做的嗎？", "出現「這個數量跟剛才報的很像，確定是另外做的嗎？」", dupText);
  ok(await ts.locator("[data-takeover-dup-confirm]").count() === 1 && await ts.locator("[data-takeover-dup-edit]").count() === 1 && await ts.locator("[data-takeover-stop-confirm]").count() === 0,
    "按鈕＝「確定送出」＋「改數量」（原本的確認停工收起來）");
  ok((await ts.locator("[data-takeover-dup-confirm]").innerText()).trim() === "確定送出" && (await ts.locator("[data-takeover-dup-edit]").innerText()).trim() === "改數量", "按鈕文字＝確定送出／改數量");
  ok(await ts.locator("[data-takeover-good]").inputValue() === "4" && await ts.locator("[data-takeover-fail]").inputValue() === "0" &&
    await ts.locator("[data-takeover-good]").getAttribute("readonly") !== null, "同一份表單帶回（良品 4／不良 0），數量先鎖住");
  ok(await page.locator("#machtileStationCmdSheet").count() === 0 && legacyStopSubmits(be).length === 0, "沒有退回一般停工（沒開一般停工確認卡、沒送 stop）");
  const toasts = await page.evaluate(() => window.__toasts);
  ok(!toasts.some((t) => t.includes("請改用一般停工")), "沒有顯示「請改用一般停工」通用提示", JSON.stringify(toasts));
  await page.screenshot({ path: path.join(outDir, "phone-stop-dialog-duplicate-confirm.png") });

  // 改數量 → 回到可編輯、不送；照樣按確認停工（不帶 ack）→ 工廠再問一次
  await ts.locator("[data-takeover-dup-edit]").click();
  ok(await ts.locator("[data-takeover-dup]").count() === 0 && await ts.locator("[data-takeover-stop-confirm]").count() === 1 &&
    await ts.locator("[data-takeover-good]").getAttribute("readonly") === null, "改數量 → 提醒收起、數量可改、回到「確認停工」");
  ok(be.stopReportSubmits.length === 1, "改數量本身不送出", String(be.stopReportSubmits.length));
  await ts.locator("[data-takeover-stop-confirm]").click();
  await takeoverSheet(page).locator("[data-takeover-dup]").waitFor({ timeout: 15000 });
  ok(be.stopReportSubmits.length === 2 && !("p_acks" in be.stopReportSubmits[1]), "改數量後按確認停工＝一般送出（不帶 ack）→ 工廠再問一次", JSON.stringify(be.stopReportSubmits[1] || {}));

  // 確定送出 → 照報工再次確認慣例：新的 command_uuid＋p_acks=["DUPLICATE_SUSPECTED"]，其他欄位同一份
  be.mode = "applied";
  await takeoverSheet(page).locator("[data-takeover-dup-confirm]").click();
  await page.waitForFunction(() => !document.getElementById("machtileTakeoverSheet") && !machtileStationCmd.pending.A04, null, { timeout: 15000 }).catch(() => {});
  const [first, second, acked] = be.stopReportSubmits;
  ok(be.stopReportSubmits.length === 3 && JSON.stringify(acked?.p_acks) === JSON.stringify(["DUPLICATE_SUSPECTED"]), "確定送出帶 p_acks=[DUPLICATE_SUSPECTED]", JSON.stringify(acked || {}));
  ok(Boolean(acked) && acked.p_command_uuid !== first.p_command_uuid && acked.p_command_uuid !== second.p_command_uuid, "確定送出用新的 command_uuid（同一筆 uuid 重送只會拿回被拒那列）");
  const strip = (b) => { const { p_command_uuid, p_acks, ...rest } = b || {}; return JSON.stringify(rest); };
  ok(Boolean(acked) && strip(acked) === strip(first), "除了 uuid／acks，內容跟原本那筆一模一樣（良品 4／不良 0／原因／允許接手）", `${strip(first)} vs ${strip(acked)}`);
  ok(await page.locator("#machtileTakeoverSheet, #machtileStationCmdSheet").count() === 0 && legacyStopSubmits(be).length === 0, "applied 後對話框關閉，全程沒有送一般停工");
  ok(await page.evaluate(() => machtileTakeoverStopDrafts.size) === 0, "暫存的停工表單已清掉");
  ok(realErrors(errors).length === 0, "DUPLICATE_SUSPECTED 再次確認沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：確定送出時雲端函式還不認得 p_acks（PGRST202）→ 對話框說明，不把站別指令標成未啟用 ==");
{
  const be = makeBackend();
  be.mode = "code:DUPLICATE_SUSPECTED";
  be.stopReportAckMissing = true;
  const { context, page, errors } = await stopDialogPage(be);
  await openStopDialog(page);
  await fillStopDialog(page, 4, 0);
  await takeoverSheet(page).locator("[data-takeover-stop-confirm]").click();
  await takeoverSheet(page).locator("[data-takeover-dup-confirm]").waitFor({ timeout: 15000 });
  await takeoverSheet(page).locator("[data-takeover-dup-confirm]").click();
  await takeoverSheet(page).locator("[data-takeover-error]:not([hidden])").waitFor({ timeout: 10000 });
  const err = (await takeoverSheet(page).locator("[data-takeover-error]").innerText()).trim();
  ok(err.includes("改數量"), "顯示「伺服器還不能接受確定送出，請按改數量…」", err);
  ok(await page.evaluate(() => machtileStationCmd.availability) !== "missing", "站別指令功能沒有被標成 missing");
  ok(await cardOf(page, "A04").locator('[data-station-cmd="stop"]').count() === 1, "A04 停工按鈕還在");
  ok(legacyStopSubmits(be).length === 0 && await page.locator("#machtileStationCmdSheet").count() === 0, "沒有自動退一般停工");
  ok(realErrors(errors).length === 0, "PGRST202 情境沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：停工回報被拒其他代碼（QTY_EXCEEDS_AVAILABLE）→ 重開同一份表單，不引導一般停工 ==");
{
  const be = makeBackend();
  be.mode = "code:QTY_EXCEEDS_AVAILABLE";
  const { context, page, errors } = await stopDialogPage(be);
  await openStopDialog(page);
  await fillStopDialog(page, 7, 0);
  await takeoverSheet(page).locator("[data-takeover-stop-confirm]").click();
  await page.waitForSelector('#machtileTakeoverSheet[data-takeover-rejected="QTY_EXCEEDS_AVAILABLE"]', { timeout: 15000 });
  await page.waitForTimeout(500);   // 確認沒有接著自動開一般停工
  const toasts = await page.evaluate(() => window.__toasts);
  ok(toasts.includes("這次停工沒有成功，件數沒有送出，請重新整理後再試，仍不行請找生管"), "顯示舊 MES 已停工且件數未送出的正確提示", JSON.stringify(toasts));
  const ts = takeoverSheet(page);
  ok(await page.locator("#machtileStationCmdSheet").count() === 0 && legacyStopSubmits(be).length === 0, "沒有自動退回一般停工（沒開一般停工確認卡、沒送 stop）");
  ok(await ts.count() === 1 && await ts.locator("[data-takeover-dup]").count() === 0, "重開停工對話框（不是重複確認）");
  ok(await ts.locator("[data-takeover-good]").inputValue() === "7" && await ts.locator("[data-takeover-fail]").inputValue() === "0" &&
    await ts.locator("[data-takeover-good]").getAttribute("readonly") === null, "同一份表單帶回（良品總數 7／不良總數 0），數量可改");
  ok(await ts.locator('[data-takeover-reason="RUSH_ORDER"]').getAttribute("class") === "is-selected" && await ts.locator('[data-takeover-allow="yes"]').getAttribute("class") === "is-selected",
    "停工原因／允許接手也保留");
  const err = (await ts.locator("[data-takeover-error]").innerText()).trim();
  ok(await ts.locator("[data-takeover-error]").isVisible() && err.includes("本次數量超過可報數") && err.includes("QTY_EXCEEDS_AVAILABLE"), "表單上顯示白話拒絕原因（本次數量超過可報數）＋代碼", err);
  ok(await ts.locator("[data-takeover-legacy-stop]").count() === 0 && await ts.locator("[data-takeover-stop-confirm]").count() === 1, "不出現「改用一般停工」，仍可重新整理後重填");
  ok(be.stopReportSubmits.length === 1, "停工回報只送一次", String(be.stopReportSubmits.length));
  await page.screenshot({ path: path.join(outDir, "phone-stop-dialog-other-reject-kept.png") });
  ok(await page.locator("#machtileStationCmdSheet").count() === 0 && legacyStopSubmits(be).length === 0, "拒絕後沒有一般停工入口或送出");
  ok(realErrors(errors).length === 0, "其他拒絕碼沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：停工回報被拒 TAKEOVER_DISABLED → 仍自動退一般停工（工廠沒開＝功能不存在） ==");
{
  const be = makeBackend();
  be.mode = "code:TAKEOVER_DISABLED";
  const { context, page, errors } = await stopDialogPage(be);
  await openStopDialog(page);
  await fillStopDialog(page, 7, 0);
  await takeoverSheet(page).locator("[data-takeover-stop-confirm]").click();
  await page.locator("#machtileStationCmdSheet").waitFor({ timeout: 15000 });
  const toasts = await page.evaluate(() => window.__toasts);
  ok(toasts.includes("工廠未啟用，請用一般停工"), "顯示「工廠未啟用，請用一般停工」", JSON.stringify(toasts));
  ok(await page.locator("#machtileTakeoverSheet").count() === 0 && await page.locator("#machtileStationCmdSheet").count() === 1, "停工對話框關閉、自動退回一般停工確認卡");
  ok(await page.evaluate(() => machtileTakeover.availability) === "off", "換機台功能標成關閉");
  ok(be.stopReportSubmits.length === 1, "停工回報只送一次", String(be.stopReportSubmits.length));
  ok(realErrors(errors).length === 0, "TAKEOVER_DISABLED 沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：報工已 applied、進度快照仍為 0 → 以新快照顯示總數，不把指令數量硬加進去 ==");
{
  const be = makeBackend();
  be.mode = "applied";
  // 卡片進度：舊 MES 結算列 0 件、快照 10 分鐘前；station_commands 有 1 分鐘前 applied 的報工 4（以前會被加進「已報」）
  be.progressRows = [{ process_id: id(304), legacy_input: 0, legacy_output: 0, legacy_fail: 0, legacy_snapshot_at: ago(10), legacy_synced_at: ago(10),
    pending_output: 0, pending_fail: 0, pending_count: 0, last_report_at: null, actual_start_at: ago(60) }];
  be.recentReports = [
    { command_uuid: id(9801), machine_code: "A04", expected_order_no: STOP_WO, expected_index_sn: 5, good_qty: 4, fail_qty: 0, applied_at: ago(1) },
  ];
  const { context, page, errors } = await stopDialogPage(be, { qtyCompleted: 0 });
  // 本平板的舊版補量紀錄（1de09c4a 會讀）：現在不能被加進來
  await page.evaluate((wo) => {
    const nowMs = Date.now();
    localStorage.setItem("machtile.stopRecentReports.v1", JSON.stringify([
      { commandUuid: "local-1", machineCode: "A04", orderNo: wo, indexSn: 5, good: 2, fail: 0, appliedAt: nowMs - 60000, savedAt: nowMs - 60000 },
    ]));
  }, STOP_WO);
  const done = await page.evaluate(() => machtileStationCmdMachineByCode("A04")?.order?.done);
  ok(done === 0, "卡片 A04 這一道雲端進度＝0（派工橋還沒同步）", String(done));
  await openStopDialog(page);
  await page.waitForTimeout(800);   // 給任何（不該有的）補讀時間
  const ts = takeoverSheet(page);
  const question = (await ts.locator("[data-takeover-qty-question]").innerText()).trim();
  ok(question === "這一道目前良品總數（含已報 0 件）", "題目顯示重新讀到的總數基準 0（不把 applied 指令或本機紀錄硬加進去）", question);
  ok(!question.includes("含剛報的"), "題目沒有「含剛報的」字樣", question);
  ok(be.recentQueries.length === 1 && be.recentQueries[0].includes("status=in.(pending,claimed)"), "只查 station_commands 尚未完成的 report，不讀 applied 數量來補量", JSON.stringify(be.recentQueries));
  ok(await page.evaluate(() => document.getElementById("machtileTakeoverSheet")?.dataset.takeoverRecentLoaded) === undefined, "沒有補讀流程（沒有 data-takeover-recent-loaded）");
  ok(await ts.locator("[data-takeover-good]").inputValue() === "" && await ts.locator("[data-takeover-fail]").inputValue() === "", "數量欄仍不預設");
  await page.screenshot({ path: path.join(outDir, "phone-stop-dialog-unsynced-hint.png") });
  ok(realErrors(errors).length === 0, "剛報 4 立刻停工沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：本道 report 尚未 applied → 擋下停工 ==");
{
  const be = makeBackend();
  be.recentReports = [{ command_uuid: id(9802), machine_code: "A04", expected_order_no: STOP_WO, expected_index_sn: 5, status: "pending" }];
  const { context, page, errors } = await stopDialogPage(be);
  await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click();
  await page.waitForTimeout(500);
  ok(await takeoverSheet(page).count() === 0, "有 pending report 時不開停工表單");
  const toasts = await page.evaluate(() => window.__toasts);
  ok(toasts.includes("剛報的還在處理，請稍後再停工"), "提示剛報的仍在處理", JSON.stringify(toasts));
  ok(be.stopReportSubmits.length === 0, "沒有送出 stop_report");
  ok(realErrors(errors).length === 0, "pending report 擋下沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// stop_report 被拒、頁面重整過且卡片上找不到那張單：只提示，不引導重複停工。
console.log("\n== 390px：停工回報被拒、沒有暫存表單也沒有工單 → 只提示、不開一般停工 ==");
{
  const be = makeBackend();
  be.mode = "hold";
  const { context, page, errors } = await stopDialogPage(be);
  await openStopDialog(page);
  await fillStopDialog(page, 7, 0);
  await takeoverSheet(page).locator("[data-takeover-stop-confirm]").click();
  await page.waitForFunction(() => machtileTakeoverStopDrafts.size === 1, null, { timeout: 10000 });
  ok(be.stopReportSubmits.length === 1, "停工回報已送出（工廠還沒回）", String(be.stopReportSubmits.length));
  // 模擬頁面重整：暫存表單清空；拒絕回來時重開表單那一步查不到工單（卡片還沒載好／單已不在這台）
  await page.evaluate(() => {
    machtileTakeoverStopDrafts.clear();
    const original = window.machtileStationCmdMachineByCode;
    window.machtileStationCmdMachineByCode = (code) => {
      const machine = original(code);
      const caller = (new Error().stack || "").split("\n")[2] || "";
      return caller.includes("machtileTakeoverReopenStopRejected") && machine ? { ...machine, order: null } : machine;
    };
  });
  be.mode = "code:QTY_EXCEEDS_AVAILABLE";
  await page.waitForFunction(() => window.__toasts.some((text) => text.includes("件數沒有送出")), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  ok(await page.locator("#machtileStationCmdSheet").count() === 0 && await page.locator("#machtileTakeoverSheet").count() === 0, "沒有工單可重開時只提示，不開一般停工確認卡");
  ok(legacyStopSubmits(be).length === 0, "沒有送出一般停工", String(legacyStopSubmits(be).length));
  ok(be.stopReportSubmits.length === 1, "停工回報沒有重送", String(be.stopReportSubmits.length));
  const toasts = await page.evaluate(() => window.__toasts);
  ok(toasts.includes("這次停工沒有成功，件數沒有送出，請重新整理後再試，仍不行請找生管"), "仍顯示舊 MES 已停工且件數未送出的正確提示", JSON.stringify(toasts));
  ok(realErrors(errors).length === 0, "無表單無工單被拒沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// 接手 applied 後要重載：目標機台卡片出現那張單（報工／完工入口）；雲端還沒同步 → 同步中提示＋10 秒重載、最多 3 次
async function takeoverAppliedScenario({ moveTo }) {
  const candidate = { id: id(881), source_machine: "A04", order_no: "XX01202502050012", index_sn: 5,
    stopped_by_name: "王小明", stopped_at: new Date().toISOString(), reason_code: "RUSH_ORDER", note: null, good_qty: 20, fail_qty: 0 };
  const be = makeBackend({ takeoverCandidates: [candidate] });
  be.takeoverMoveTo = moveTo;
  const cfg = 'stationCommandMachines: ["A04", "A05"], enableTakeover: true, takeoverMachines: ["A04", "A05"], enableFinishButton: true, enablePickStartFlow: true, pickStartFlowMachines: ["A04", "A05"],';
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: cfg });
  await page.evaluate(() => {
    window.__toasts = [];
    const original = window.showToast;
    window.showToast = (message) => { window.__toasts.push(String(message)); return original(message); };
    machtileTakeoverSync.retryMs = 400;   // 正式 10 秒；測試縮短，次數上限照正式
  });
  const target = cardOf(page, "A05");
  ok(await target.locator(`.machine-report-button[data-report="${candidate.order_no}"]`).count() === 0, `接手前 A05 沒有 ${candidate.order_no} 的報工入口`);
  be.mode = "applied";
  const readsBefore = be.listReads;
  await target.locator("[data-pick-order-open]").click();
  await page.locator('#machtileCardSelection [data-pick-tab="old"]').click();
  await page.locator(`#machtileCardSelection [data-takeover-candidate="${candidate.id}"]`).click();
  await page.waitForFunction(() => document.querySelector("#machtileCardSelection") === null);
  ok(be.takeoverSubmits.length === 1 && be.takeoverSubmits[0].p_machine_code === "A05", "A05 送出一筆 machtile_submit_takeover");
  return { context, page, errors, be, candidate, target, readsBefore };
}

console.log("\n== 390px：接手 applied → 重載，A05 卡片只剩「開工」；按開工後出現報工／停工／完工入口 ==");
{
  const { context, page, errors, be, candidate, target, readsBefore } = await takeoverAppliedScenario({ moveTo: "A05" });
  await page.waitForFunction(() => (machtileTakeoverSync.reloads.A05 || 0) >= 1 && !machtileStationCmd.pending.A05, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // 選舊單接手後＝只掛單：卡片只剩「開工」
  ok(await target.locator('[data-station-cmd="start"]').count() === 1 && !(await target.locator('[data-station-cmd="start"]').isDisabled()), "接手後 A05 有「開工」（可按）");
  ok(await target.locator('[data-station-cmd="stop"], [data-pick-order-open], .machine-report-button, .machine-finish-button').count() === 0, "接手後 A05 只剩「開工」（沒有停工／報工／完工／選工單）");
  await page.screenshot({ path: path.join(outDir, "phone-pick-after-takeover-start-only.png") });
  // 新增步驟：按開工（原本的開工確認卡）→ applied 之後才是已開工
  await target.locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  const startSent = be.submits.at(-1) || {};
  ok(startSent.p_command_type === "start" && startSent.p_machine_code === "A05" && startSent.p_expected_order_no === candidate.order_no && startSent.p_expected_index_sn === candidate.index_sn,
    "開工送的是原本 start 指令（A05、接手那張單＋道次）", JSON.stringify(startSent));
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(await target.locator('[data-station-cmd="start"], [data-pick-order-open]').count() === 0 && await target.locator('[data-station-cmd="stop"]').count() === 1,
    "開工後 A05 只剩報工／停工／完工（沒有開工、選工單）");
  await page.screenshot({ path: path.join(outDir, "phone-pick-after-start-running.png") });
  const report = target.locator(`.machine-report-button[data-report="${candidate.order_no}"]`);
  const finish = target.locator(`.machine-finish-button[data-report="${candidate.order_no}"]`);
  ok(await report.count() === 1 && !(await report.isDisabled()), "A05 卡片出現該單的報工入口（可按）");
  ok(await finish.count() === 1 && !(await finish.isDisabled()), "A05 卡片出現該單的完工入口（可按）");
  const order = await page.evaluate(() => { const o = machtileCardOrderForMachine("A05"); return o ? { id: o.id, step: o.stationStep } : null; });
  ok(order?.id === candidate.order_no && Number(order?.step) === candidate.index_sn, "A05 卡片目前的單＝接手的單號＋道次", JSON.stringify(order));
  ok(be.listReads > readsBefore, "applied 後確實重載工序資料", `${readsBefore} → ${be.listReads}`);
  const sync = await page.evaluate(() => ({ toasts: window.__toasts, reloads: machtileTakeoverSync.reloads.A05, retries: machtileTakeoverSync.retries.A05, timer: machtileTakeoverSync.timers.A05 ?? null }));
  ok(sync.reloads === 1 && sync.retries === 0 && sync.timer === null, "看得到單 → 只重載一次、不排延後重載", JSON.stringify(sync));
  ok(!sync.toasts.some((t) => t.includes("資料同步中")), "看得到單 → 不顯示同步中提示", JSON.stringify(sync.toasts));
  ok(realErrors(errors).length === 0, "接手 applied 重載沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：接手 applied 但雲端還沒搬機台 → 同步中提示、延後重載最多 3 次 ==");
{
  const { context, page, errors, be, candidate, target, readsBefore } = await takeoverAppliedScenario({ moveTo: null });
  await page.waitForFunction(() => (machtileTakeoverSync.reloads.A05 || 0) >= 4, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);   // 超過再一次重載的間隔，確認停了
  const sync = await page.evaluate(() => ({ toasts: window.__toasts, reloads: machtileTakeoverSync.reloads.A05, retries: machtileTakeoverSync.retries.A05, timer: machtileTakeoverSync.timers.A05 ?? null }));
  const pendingToasts = sync.toasts.filter((t) => t === "已接手，資料同步中，請稍候幾秒再看");
  ok(pendingToasts.length >= 1, "看不到單 → 顯示「已接手，資料同步中，請稍候幾秒再看」", JSON.stringify(sync.toasts));
  ok(sync.reloads === 4 && sync.retries === 3 && sync.timer === null, "重載＝applied 當下 1 次＋延後最多 3 次，之後停", JSON.stringify(sync));
  const reads = be.listReads;
  await page.waitForTimeout(1200);
  ok(be.listReads === reads && (await page.evaluate(() => machtileTakeoverSync.reloads.A05)) === 4, "上限到了不再重載", `${reads} → ${be.listReads}`);
  ok(be.listReads - readsBefore >= 4, "後端確實收到每次重載的工序讀取", `${readsBefore} → ${be.listReads}`);
  ok(await target.locator(`.machine-report-button[data-report="${candidate.order_no}"]`).count() === 0, "雲端沒搬 → A05 不假造該單入口");
  ok(realErrors(errors).length === 0, "同步中案例沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：空機接手也要過站別指令閘門（不在 stationCommandMachines 不出現）==");
{
  const be = makeBackend({ takeoverCandidates: [] });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be,
    configExtra: 'stationCommandMachines: ["A04"], enableTakeover: true, takeoverMachines: ["A02", "A04"],' });
  ok(await cardOf(page, "A02").locator("[data-takeover-open-idle]").count() === 0, "A02 不在站別指令名單 → 不出現空機接手按鈕");
  ok(realErrors(errors).length === 0, "閘門案例沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：選工單／開工分開 — 空機台「選工單」兩頁、選新單後只剩開工 ==");
{
  const poolItem = { source_key: "01|TESTPICK0001|SIM-1", work_order_no: "XX01202609020008", process_order: 2, operation_name: "車床加工", part_no: "MPW-01", part_name: "MPW-01止油閥座",
    quantity: 5000, due_date: "2026-10-30", planned_start: null, urgency: 2, department_code: "LATHE", eligible_machine_codes: ["A02"], source_status: "pending", synced_at: new Date().toISOString() };
  const candidate = { id: id(882), source_machine: "A04", order_no: "XX01202502050012", index_sn: 5,
    stopped_by_name: "王小明", stopped_at: new Date().toISOString(), reason_code: "RUSH_ORDER", note: null, good_qty: 20, fail_qty: 0 };
  const be = makeBackend({ takeoverCandidates: [candidate], poolItems: [poolItem], withDepartments: true });
  const cfg = 'stationCommandMachines: ["A01", "A02", "A04"], dispatchPoolMachines: ["A02"], enableTakeover: true, takeoverMachines: ["A02"], enablePickStartFlow: true, pickStartFlowMachines: ["A01", "A02", "A04"],';
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: cfg });
  const a02 = cardOf(page, "A02");
  ok(await a02.locator("[data-pick-order-open]").count() === 1 && await a02.locator("[data-station-cmd], .machine-report-button, .machine-finish-button, [data-card-pool-open], [data-card-select-open]").count() === 0,
    "空機台 A02 只有「選工單」（沒有開工／停工／報工／完工／待做池入口）");
  await a02.locator("[data-pick-order-open]").click();
  const panel = page.locator("#machtileCardSelection");
  ok(await panel.locator('[data-pick-tab="new"]').count() === 1 && await panel.locator('[data-pick-tab="old"]').count() === 1, "選工單面板有「新工單」「舊工單」兩頁");
  ok((await panel.locator('[data-pick-tab="new"]').innerText()).trim() === "新工單" && (await panel.locator('[data-pick-tab="old"]').innerText()).trim() === "舊工單", "分頁名稱＝新工單／舊工單");
  await panel.locator(`[data-pool-claim="${poolItem.source_key}"]:not([disabled])`).waitFor({ timeout: 10000 });
  ok(await panel.locator('[data-pick-pane="new"]').isVisible() && !(await panel.locator('[data-pick-pane="old"]').isVisible()), "預設在新工單頁，派工池可接的單在這頁");
  await panel.locator('[data-pick-tab="old"]').click();
  await panel.locator(`[data-takeover-candidate="${candidate.id}"]`).waitFor();
  ok(!(await panel.locator('[data-pick-pane="new"]').isVisible()), "切到舊工單頁 → 新工單頁收起、列出可接手的停工單");
  ok(!(await panel.locator("[data-pick-order-empty]").isVisible()), "兩頁都有單 → 不顯示「目前沒有可做的工單」");
  await panel.locator('[data-pick-tab="new"]').click();
  await page.screenshot({ path: path.join(outDir, "phone-pick-new-order.png") });
  // 接單前確認框：取消 → 零送出
  const dialogs = [];
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => { dialogs.push(d.message()); return dialogs.length === 1 ? d.dismiss() : d.accept(); });
  await panel.locator(`[data-pool-claim="${poolItem.source_key}"]`).click();
  await page.waitForTimeout(300);
  ok(dialogs[0] === "把 XX01202609020008 第 2 道掛到 A02？（掛上後要再按開工才算開始）", "接單前跳確認框（單號／道次／機台＋要再按開工）", dialogs[0]);
  ok(be.poolClaims.length === 0 && await panel.isVisible(), "確認框按取消 → 沒送 dispatch_pool_claim、面板還在");
  await panel.locator(`[data-pool-claim="${poolItem.source_key}"]`).click();
  await page.waitForFunction(() => document.querySelector("#machtileCardSelection") === null, null, { timeout: 10000 });
  ok(be.poolClaims.length === 1 && JSON.stringify(be.poolClaims[0]) === JSON.stringify({ p_source_key: poolItem.source_key, p_machine_code: "A02" }),
    "確認後 → 新工單走原本 dispatch_pool_claim（payload 不變）", JSON.stringify(be.poolClaims));
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => d.accept());
  ok(be.submits.length === 0 && be.takeoverSubmits.length === 0, "選新單只掛單：沒有送開工或接手指令");
  await page.waitForFunction(() => machtileCardOrderForMachine("A02")?.id === "XX01202609020008", null, { timeout: 10000 }).catch(() => {});
  ok(await a02.locator('[data-station-cmd="start"]').count() === 1, "選新單後 A02 出現「開工」");
  ok(await a02.locator('[data-station-cmd="stop"], [data-pick-order-open], .machine-report-button, .machine-finish-button').count() === 0, "選新單後 A02 只剩「開工」");
  await page.screenshot({ path: path.join(outDir, "phone-pick-after-new-start-only.png") });
  // 開工送出等待中 → 開工鍵停用（pending 停用）
  await a02.locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  if (await sheet(page).locator("[data-station-cmd-daily-qty]").count()) await sheet(page).locator("[data-station-cmd-daily-qty]").fill("1");
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor({ timeout: 10000 });
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(await a02.locator('[data-station-cmd="start"]').isDisabled(), "開工指令等待工廠結果時「開工」停用");
  ok(be.submits.length === 1 && be.submits[0].p_command_type === "start" && be.submits[0].p_expected_order_no === "XX01202609020008" && be.submits[0].p_expected_part_no === "MPW-01",
    "開工送原本 start 指令（p_part_no 只料號）", JSON.stringify(be.submits[0] || {}));
  ok(realErrors(errors).length === 0, "選新單沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：管理員選工單→新工單「設為目前工單」前確認：取消零送出、確認送原本 machine_queue_reorder ==");
{
  const be = makeBackend({ role: "admin", withDepartments: true, extraCards: [{ id: id(150), tenant_id: T, work_order_no: "XX01202610010001", customer_name: "測試客戶", part_name: "測試軸", drawing_no: "DRW-150",
    quantity: 10, due_date: "2026-10-30", priority: "normal", work_order_status: "in_progress", current_process_id: id(350), current_process_name: "車床加工", current_process_status: "pending",
    machine_name: null, qty_completed: 0, qty_defect: 0, progress_percent: 0, last_report_at: null, open_risk_level: null, current_process_off_station: false }] });
  const cfg = 'stationCommandMachines: ["A02"], enablePickStartFlow: true, pickStartFlowMachines: ["A02"],';
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: cfg });
  await page.evaluate(() => { window.__queueWrites = []; });
  const pickOpen = cardOf(page, "A02").locator("[data-pick-order-open]");
  if (await pickOpen.count() === 1) {
    await pickOpen.click();
    const select = page.locator("#machtileCardSelection [data-card-select-process]").first();
    if (await select.count() === 1) {
      const dialogs = [];
      page.removeAllListeners("dialog");
      page.on("dialog", (d) => { dialogs.push(d.message()); return dialogs.length === 1 ? d.dismiss() : d.accept(); });
      const writesBefore = be.otherWrites.length;
      await select.click();
      await page.waitForTimeout(300);
      ok(/^把 .+ 第 .+ 道掛到 A02？（掛上後要再按開工才算開始）$/.test(dialogs[0] || ""), "設為目前工單前跳確認框", dialogs[0]);
      ok(be.otherWrites.length === writesBefore && await page.locator("#machtileCardSelection").isVisible(), "取消 → 沒有任何寫入、面板還在", be.otherWrites.join(" "));
      await select.click();
      await page.waitForTimeout(1500);
      ok(dialogs.length === 2 && be.otherWrites.length > writesBefore, "確認 → 才走原本的設為目前工單寫入", be.otherWrites.join(" "));
      ok(be.submits.length === 0, "設為目前工單只掛單：沒有送開工");
    } else { skip++; console.log("  SKIP 管理員面板沒有可設為目前工單的工序（fixture）"); }
  } else { skip++; console.log("  SKIP 管理員看不到選工單入口（fixture 角色）"); }
  ok(realErrors(errors).length === 0, "設為目前工單確認沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：選工單兩頁都空 → 「目前沒有可做的工單」；接手旗標關 → 沒有舊工單頁 ==");
for (const takeoverOn of [true, false]) {
  const be = makeBackend({ takeoverCandidates: [] });
  const cfg = `stationCommandMachines: ["A02"], enableTakeover: ${takeoverOn}, takeoverMachines: ${takeoverOn ? '["A02"]' : "[]"}, enablePickStartFlow: true, pickStartFlowMachines: ["A02"],`;
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: cfg });
  await cardOf(page, "A02").locator("[data-pick-order-open]").click();
  const panel = page.locator("#machtileCardSelection");
  ok(await panel.locator('[data-pick-tab="old"]').count() === (takeoverOn ? 1 : 0), takeoverOn ? "接手旗標開 → 有舊工單頁" : "接手旗標關 → 沒有舊工單頁（只有新工單）");
  await panel.locator("[data-pick-order-empty]:not([hidden])").waitFor({ timeout: 10000 }).catch(() => {});
  ok(await panel.locator("[data-pick-order-empty]").isVisible() && (await panel.locator("[data-pick-order-empty]").innerText()).trim() === "目前沒有可做的工單",
    `${takeoverOn ? "兩頁" : "新工單頁"}都空 → 顯示「目前沒有可做的工單」`);
  if (!takeoverOn) await page.screenshot({ path: path.join(outDir, "phone-pick-empty.png") });
  ok(realErrors(errors).length === 0, "選工單空狀態沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：已開工（雲端 status=running）→ 只剩報工／停工／完工；停工後（status=paused）卡片仍在、只剩開工 ==");
{
  const be = makeBackend({ procStatus: { XX01202502050012: "running", XX01202609020008: "paused" } });
  const cfg = 'stationCommandMachines: ["A01", "A04"], enableFinishButton: true, enablePickStartFlow: true, pickStartFlowMachines: ["A01", "A04"],';
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: cfg });
  const a04 = cardOf(page, "A04");
  ok(await a04.locator('[data-station-cmd="stop"]').count() === 1 && await a04.locator(".machine-report-button:not([disabled])").count() === 1 && await a04.locator(".machine-finish-button").count() === 1,
    "running → 有報工、停工、完工");
  ok(await a04.locator('[data-station-cmd="start"], [data-pick-order-open]').count() === 0, "running → 沒有開工、選工單");
  const a01 = cardOf(page, "A01");
  ok(await page.evaluate(() => machtileCardOrderForMachine("A01")?.id) === "XX01202609020008", "status=paused 的工序仍在 A01 卡片上（沒有從平板消失）");
  ok(await a01.locator('[data-station-cmd="start"]').count() === 1 && !(await a01.locator('[data-station-cmd="start"]').isDisabled()), "自己停工中（paused）→ 有「開工」（接回）");
  ok(await a01.locator('[data-station-cmd="stop"], [data-pick-order-open], .machine-report-button, [data-card-select-open], [data-card-pool-open], .pool-replace-stopped-action').count() === 0, "自己停工中（paused）→ 沒有報工、停工、選工單、改掛");
  const pausedFinish = a01.locator(`.machine-finish-button[data-report="XX01202609020008"]`);
  ok(await pausedFinish.count() === 1 && !(await pausedFinish.isDisabled()), "自己停工中（paused）→ 只有「開工」＋「完工」");
  ok(await pausedFinish.getAttribute("data-open-report-type") === "finish" && await pausedFinish.getAttribute("data-report-process") === id(301) && await pausedFinish.getAttribute("data-report-machine") === "A01",
    "停工卡的完工鍵＝原本的完工入口（同一組 data-open-report-type／工序／機台）");
  await pausedFinish.click();
  await page.locator("#finishSheet").waitFor({ state: "visible", timeout: 10000 });
  ok(await page.locator("#finishSheet").isVisible() && be.submits.length === 0, "按完工 → 打開原本的完工畫面（還沒送任何指令）");
  await page.evaluate(() => closeReport());
  await page.screenshot({ path: path.join(outDir, "phone-pick-paused-start-only.png") });
  be.mode = "applied";
  await a01.locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  if (await sheet(page).locator("[data-station-cmd-daily-qty]").count()) await sheet(page).locator("[data-station-cmd-daily-qty]").fill("1");
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  await sheet(page).locator("[data-station-cmd-close]").click();
  const resume = { ...(be.submits.at(-1) || {}) };
  const resumeUuidOk = stationCore.isUuid(resume.p_command_uuid);
  delete resume.p_command_uuid;
  const expectedResume = { p_command_type: "start", p_machine_code: "A01", p_expected_order_no: "XX01202609020008", p_expected_index_sn: 2, p_expected_part_no: "MPW-01", p_manufacture_ii_id: null };
  ok(resumeUuidOk && JSON.stringify(resume) === JSON.stringify(expectedResume), "停工中按開工 → payload 跟一般開工相同（start、只料號、無多餘欄位）", JSON.stringify(be.submits.at(-1) || {}));
  ok(await a01.locator('[data-station-cmd="stop"]').count() === 1 && await a01.locator('[data-station-cmd="start"]').count() === 0, "接回開工 applied → A01 換成已開工（停工鍵出現、開工鍵收起）");
  ok((be.listQueries || []).some((query) => query.includes("status=in.(pending,running,abnormal,waiting_inspection,paused)")), "開關開 → 卡片工序查詢含 paused");
  // 本機記開工，但之後重讀雲端仍是 paused（矛盾）→ 清掉本機紀錄、以雲端為準
  await page.evaluate(async () => { await loadFromSupabase({ preserveDepartmentOnFailure: true }); deriveMachines(); renderAll(); });
  ok(await page.evaluate(() => !machtilePickStartLocal.A01), "重讀雲端仍是 paused → 本機「已開工」紀錄清掉");
  ok(await a01.locator('[data-station-cmd="start"]').count() === 1 && await a01.locator('[data-station-cmd="stop"]').count() === 0, "本機與雲端矛盾 → 卡片照雲端（paused＝只剩開工）");
  // 停工 applied → 卡片換成停工中（只剩開工接回）
  await a04.locator('[data-station-cmd="stop"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(be.submits.at(-1)?.p_command_type === "stop", "停工送原本 stop 指令");
  ok(await a04.locator('[data-station-cmd="start"]').count() === 1 && await a04.locator('[data-station-cmd="stop"]').count() === 0, "停工 applied → A04 換成「開工」（接回）");
  ok(await a04.locator(".machine-report-button").count() === 0 && await a04.locator(".machine-finish-button").count() === 1, "停工 applied → A04 只剩「開工」＋「完工」（報工收起）");
  ok(realErrors(errors).length === 0, "已開工／停工中沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 1440px：選工單開關關＋雲端工序 paused → 查詢與卡片跟 origin/main 一字不差 ==");
{
  const cfg = 'stationCommandMachines: ["A01", "A04"], enablePickStartFlow: false, pickStartFlowMachines: ["A01", "A04"],';
  const procStatus = { XX01202609020008: "paused" };
  let baseline = null;
  if (baselineAvailable) {
    const bbe = makeBackend({ procStatus });
    const b = await newPage(browser, "desktop", { backend: bbe, baseline: true, configExtra: cfg });
    baseline = { grid: await gridHtml(b.page), actions: await b.page.locator("#workOrderGrid .machine-tile-actions").evaluateAll((xs) => xs.map((x) => x.innerHTML.replace(/\s+/g, " ").split("/__baseline/").join("/"))), queries: bbe.listQueries || [] };
    await b.context.close();
  }
  const be = makeBackend({ procStatus });
  const { context, page, errors } = await newPage(browser, "desktop", { backend: be, configExtra: cfg });
  ok((be.listQueries || []).length > 0 && be.listQueries.every((query) => query.includes("status=in.(pending,running,abnormal,waiting_inspection)&")), "開關關 → 卡片工序查詢不含 paused（跟以前同一串）", (be.listQueries || [])[0]);
  if (baseline) {
    const g = await gridHtml(page);
    ok(g === baseline.grid, "開關關＋paused → 卡片 HTML 跟 origin/main 一字不差", firstDiff(g, baseline.grid));
    const actions = await page.locator("#workOrderGrid .machine-tile-actions").evaluateAll((xs) => xs.map((x) => x.innerHTML.replace(/\s+/g, " ")));
    ok(JSON.stringify(actions) === JSON.stringify(baseline.actions), "開關關＋paused → 底部按鈕列跟 origin/main 一字不差", firstDiff(JSON.stringify(actions), JSON.stringify(baseline.actions)));
  } else { skip += 2; console.log("  SKIP 讀不到 origin/main，略過一字不差比對"); }
  ok(realErrors(errors).length === 0, "開關關＋paused 沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 1440px：選工單旗標關（站別指令開著）→ 卡片跟 origin/main 一字不差、按鈕照舊 ==");
{
  const cfg = 'stationCommandMachines: ["A01", "A02", "A04"], enablePickStartFlow: false, pickStartFlowMachines: ["A01", "A02", "A04"],';
  let baseline = null;
  if (baselineAvailable) { const b = await newPage(browser, "desktop", { backend: makeBackend(), baseline: true, configExtra: cfg }); baseline = { grid: await gridHtml(b.page), actions: await b.page.locator("#workOrderGrid .machine-tile-actions").evaluateAll((xs) => xs.map((x) => x.innerHTML.replace(/\s+/g, " ").split("/__baseline/").join("/"))) }; await b.context.close(); }
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, "desktop", { backend: be, configExtra: cfg });
  ok(await page.locator("[data-pick-order-open], [data-pick-tab]").count() === 0, "旗標關 → 沒有選工單入口");
  ok(await cardOf(page, "A04").locator("[data-station-cmd]").count() === 2, "旗標關 → 有單機台照舊「開工」「停工」");
  if (baseline) {
    const g = await gridHtml(page);
    ok(g === baseline.grid, "旗標關 → 卡片 HTML 跟 origin/main 一字不差", firstDiff(g, baseline.grid));
    const actions = await page.locator("#workOrderGrid .machine-tile-actions").evaluateAll((xs) => xs.map((x) => x.innerHTML.replace(/\s+/g, " ")));
    ok(JSON.stringify(actions) === JSON.stringify(baseline.actions), "旗標關 → 卡片底部按鈕列跟 origin/main 一字不差", firstDiff(JSON.stringify(actions), JSON.stringify(baseline.actions)));
  } else { skip += 2; console.log("  SKIP 讀不到 origin/main，略過一字不差比對"); }
  ok(be.otherWrites.length === 0 && be.submits.length === 0 && realErrors(errors).length === 0, "旗標關 → 沒有寫入、沒有 JS 錯誤");
  await context.close();
}

console.log("\n== 390px：送出時 RPC 不存在 → 功能藏起來 ==");
{
  const be = makeBackend({ rpcMissing: true });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 10000 });
  ok((await sheet(page).locator("[data-station-cmd-error]").innerText()).includes("還沒在伺服器啟用"), "RPC 不存在 → 白話「還沒啟用」");
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(await page.locator("#workOrderGrid [data-station-cmd]").count() === 0, "RPC 不存在 → 卡片按鈕全部藏起來");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：送出時網路斷 → 重送用同一個 command_uuid ==");
{
  const be = makeBackend();
  be.abortNextSubmit = true;
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 10000 });
  ok((await sheet(page).locator("[data-station-cmd-error]").innerText()).includes("不會重複"), "網路斷 → 說明重送不會重複");
  ok((await sheet(page).locator("[data-station-cmd-confirm]").innerText()).trim() === "重送", "按鈕變「重送」");
  ok(await page.locator('#workOrderGrid [data-station-cmd="start"]').isDisabled(), "不確定有沒有送到 → 卡片先鎖住");
  be.mode = "applied";
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  ok(be.submits.length === 2 && be.submits[0].p_command_uuid === be.submits[1].p_command_uuid, "重送用同一個 command_uuid", JSON.stringify(be.submits.map((s) => s.p_command_uuid)));
  ok(be.commands.size === 1, "伺服器只有一筆指令");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 1440px：旗標開但登入的是生管（planner）→ 不出按鈕、不讀 ==");
{
  const be = makeBackend({ role: "planner" });
  const { context, page, errors } = await newPage(browser, "desktop", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  ok(await page.locator("#workOrderGrid [data-station-cmd]").count() === 0, "planner → 沒有開工／停工按鈕（RPC 只收作業員）");
  ok(be.stationReads === 0, `planner → 沒讀 station_commands（${be.stationReads}）`);
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：合約 r3 時間規則（App 不自己判結果）==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  const openAndSend = async (type) => {
    await cardOf(page, "A04").locator(`[data-station-cmd="${type}"]`).click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
    await sheet(page).locator("[data-station-cmd-confirm]").click();
    await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor();
  };

  // pending 已 4 分鐘（伺服器時間）→ 只加提示，仍是等待中、按鈕仍鎖、繼續輪詢
  be.mode = "hold";
  await openAndSend("start");
  be.mode = "stale";
  await sheet(page).locator("[data-station-cmd-late]").waitFor({ timeout: 15000 });
  const lateText = (await sheet(page).locator("[data-station-cmd-result]").innerText()).replace(/\s+/g, " ");
  ok(lateText.includes("工廠還沒處理，這筆應該不會生效；請等最終結果或問生管") && await sheet(page).locator('[data-station-cmd-result="pending"]').count() === 1,
    "pending 超過 3 分鐘 → 提示「應該不會生效」，但仍是等待中（不是結果）", lateText);
  ok(!/已過期|沒有生效|已作廢/.test((await sheet(page).locator("[data-station-cmd-result] strong").innerText())), "伺服器還是 pending → 標題不出現最終結果");
  ok(await cardOf(page, "A04").locator('[data-station-cmd="start"]').isDisabled(), "伺服器還是 pending → 按鈕仍鎖住");
  await page.screenshot({ path: path.join(outDir, "phone-09-late-pending.png") });
  const pollsBefore = be.stationReads;
  await page.waitForTimeout(5500);
  ok(be.stationReads > pollsBefore, "超過 3 分鐘仍持續輪詢等伺服器結果");
  // 租約過了被重領：仍 claimed → 工廠處理中＋提示
  be.mode = "lease";
  await page.waitForFunction(() => document.querySelector("#machtileStationCmdSheet [data-station-cmd-result] strong")?.textContent.includes("工廠處理中"), null, { timeout: 15000 });
  ok(await sheet(page).locator("[data-station-cmd-late]").count() === 1 && await sheet(page).locator('[data-station-cmd-result="pending"]').count() === 1, "租約過了被重領（仍 claimed）→ 工廠處理中＋提示，不是結果");
  const claimedLate = (await sheet(page).locator("[data-station-cmd-result]").innerText()).replace(/\s+/g, " ");
  ok(claimedLate.includes("工廠正在處理，結果還沒回來；請等最終結果或問生管") && !claimedLate.includes("不會生效"), "claimed 超過 3 分鐘 → 「工廠正在處理，結果還沒回來…」，不說不會生效", claimedLate);
  // 伺服器給最終結果 STALE_COMMAND
  be.mode = "staleReject";
  await sheet(page).locator('[data-station-cmd-result="rejected"]').waitFor({ timeout: 15000 });
  const st = (await sheet(page).locator("[data-station-cmd-result]").innerText()).replace(/\s+/g, " ");
  ok(st.includes("已作廢") && st.includes("太久沒套用，舊 MES 沒動，請重按"), "rejected/STALE_COMMAND → 「太久沒套用，舊 MES 沒動，請重按」", st);
  await page.screenshot({ path: path.join(outDir, "phone-10-stale-command.png") });
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(await cardOf(page, "A04").locator('[data-station-cmd="start"]').isEnabled(), "伺服器給結果後才解鎖");

  // LEGACY_APPLIED_LATE：舊 MES 其實改了，不能說沒生效
  be.mode = "hold";
  await openAndSend("stop");
  be.mode = "lateApplied";
  await sheet(page).locator('[data-station-cmd-result="rejected"]').waitFor({ timeout: 15000 });
  const la = (await sheet(page).locator("[data-station-cmd-result]").innerText()).replace(/\s+/g, " ");
  ok(la.includes("舊 MES 已改（回報太晚）") && la.includes("舊 MES 已經改了，但回報太晚；不要再按，請看機台電子紙或問生管核對"), "LEGACY_APPLIED_LATE → 「舊 MES 已經改了，但回報太晚…」", la);
  ok(!/沒有生效|沒生效|沒有停工/.test(la), "LEGACY_APPLIED_LATE 沒有說「沒生效」", la);
  await page.screenshot({ path: path.join(outDir, "phone-11-legacy-applied-late.png") });
  await sheet(page).locator("[data-station-cmd-close]").click();

  // 套用端 #785 的代碼：LEGACY_PARTIAL_WRITE（舊 MES 已改）、NEED_PAUSED（沒動）
  be.mode = "hold";
  await openAndSend("start");
  be.mode = "code:LEGACY_PARTIAL_WRITE";
  await sheet(page).locator('[data-station-cmd-result="rejected"]').waitFor({ timeout: 15000 });
  const pw = (await sheet(page).locator("[data-station-cmd-result]").innerText()).replace(/\s+/g, " ");
  ok(pw.includes("舊 MES 已改一部分") && pw.includes("舊 MES 已經改了一部分，請看機台電子紙或問生管核對") && !/沒有生效|沒生效|沒有開工/.test(pw), "LEGACY_PARTIAL_WRITE → 「舊 MES 已經改了一部分…」，不說沒生效", pw);
  await page.screenshot({ path: path.join(outDir, "phone-16-legacy-partial-write.png") });
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok((await cardOf(page, "A04").locator("[data-station-cmd-status]").innerText()).includes("舊 MES 已改一部分"), "卡片也顯示舊 MES 已改一部分");
  be.mode = "hold";
  await openAndSend("start");
  be.mode = "code:NEED_PAUSED";
  await sheet(page).locator('[data-station-cmd-result="rejected"]').waitFor({ timeout: 15000 });
  const np = (await sheet(page).locator("[data-station-cmd-result]").innerText()).replace(/\s+/g, " ");
  ok(np.includes("沒有開工") && np.includes("這張單暫停中，請問生管"), "NEED_PAUSED → 沒有開工＋「這張單暫停中，請問生管」", np);
  await sheet(page).locator("[data-station-cmd-close]").click();

  // MANUAL_RELEASED（status=rejected）
  be.mode = "hold";
  await openAndSend("start");
  be.mode = "released";
  await sheet(page).locator('[data-station-cmd-result="rejected"]').waitFor({ timeout: 15000 });
  const rl = (await sheet(page).locator("[data-station-cmd-result]").innerText()).replace(/\s+/g, " ");
  ok(rl.includes("主管已取消") && rl.includes("主管已取消這筆；舊 MES 是否已改變不確定，請先看機台電子紙或問生管，再決定要不要重按") && rl.includes("舊 MES 狀態未知，請人工核對"),
    "rejected/MANUAL_RELEASED → 新文案＋伺服器說明", rl);
  await page.screenshot({ path: path.join(outDir, "phone-12-manual-released.png") });
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok((await cardOf(page, "A04").locator("[data-station-cmd-status]").innerText()).includes("主管已取消"), "卡片也顯示主管已取消");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：平板時鐘快 5 分鐘 → 用伺服器時鐘差，不誤判超過 3 分鐘 ==");
{
  const be = makeBackend();
  be.serverSkewMs = 5 * 60000;     // 伺服器時間比平板慢 5 分鐘
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  be.mode = "hold";
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor();
  await page.waitForTimeout(4500);
  ok(await sheet(page).locator("[data-station-cmd-late]").count() === 0 && (await sheet(page).locator("[data-station-cmd-result] strong").innerText()).trim() === "工廠處理中…",
    "剛送出 4 秒 → 沒有「應該不會生效」提示（平板快 5 分鐘也不誤判）");
  be.mode = "applied";
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  ok(true, "伺服器 applied → 已開工");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：開卡重讀 → 這一道已不在這台 → 不給送 ==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  be.procOverride.A04 = { off_station_at: new Date().toISOString() };
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-stale]").waitFor({ timeout: 10000 });
  ok((await sheet(page).locator("[data-station-cmd-stale]").innerText()).includes("請重新整理畫面"), "已離站 → 提示重新整理");
  ok(await sheet(page).locator("[data-station-cmd-confirm]").isDisabled(), "已離站 → 確認鈕不能按");
  await sheet(page).locator("[data-station-cmd-close]").click();
  be.procOverride.A04 = { step: 6 };
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-stale]").waitFor({ timeout: 10000 });
  ok(await sheet(page).locator("[data-station-cmd-confirm]").isDisabled(), "道次變了 → 確認鈕不能按");
  await page.screenshot({ path: path.join(outDir, "phone-13-stale-card-data.png") });
  await sheet(page).locator("[data-station-cmd-close]").click();
  // 料號沒有 → 顯示「未提供」、送 null（不拿圖號）
  be.procOverride.A04 = { part_no: null };
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  ok(await fieldText(page, "part") === "未提供　HCG-06本體", "沒有料號 → 「未提供」（不顯示圖號 DRW-4）", await fieldText(page, "part"));
  be.mode = "applied";
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  ok(be.submits.length === 1 && be.submits[0].p_expected_part_no === null, "沒有料號 → 送 null", JSON.stringify(be.submits[0]));
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：送出時網路斷 → 重新整理後還記得，立刻可用同一個 uuid 重送 ==");
{
  const be = makeBackend();
  be.abortNextSubmit = true;
  be.failCommandPolls = true;     // 查結果也一直失敗（網路差）→ 紀錄保持「不確定」
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 10000 });
  const firstUuid = be.submits[0].p_command_uuid;
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("machtile.stationCmdPending.v1") || "{}"));
  ok(stored.A04 && stored.A04.unconfirmed === true && stored.A04.commandUuid === firstUuid, "unconfirmed 有存進 localStorage", JSON.stringify(stored));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid .machine-tile-card").length > 0, null, { timeout: 20000 });
  await page.waitForFunction(() => machtileStationCmd.pending.A04?.unconfirmed === true, null, { timeout: 20000 });
  await page.locator("#workOrderGrid [data-station-cmd-retry]").waitFor({ timeout: 15000 });
  ok((await cardOf(page, "A04").locator("[data-station-cmd-status]").innerText()).includes("網路斷了"), "重新整理後卡片顯示「上次送出時網路斷了」");
  ok(await cardOf(page, "A04").locator('[data-station-cmd="start"]').isDisabled(), "重新整理後先鎖開工／停工（只能用同一筆重送）");
  await page.screenshot({ path: path.join(outDir, "phone-14-unconfirmed-after-reload.png") });
  be.mode = "applied";
  be.failCommandPolls = false;
  await cardOf(page, "A04").locator("[data-station-cmd-retry]").click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  ok((await sheet(page).locator("[data-station-cmd-confirm]").innerText()).trim() === "重送", "從卡片立刻可以重送（不用等 12 分鐘）");
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  ok(be.submits.length === 2 && be.submits[1].p_command_uuid === firstUuid && be.commands.size === 1, "重新整理後重送用同一個 uuid、伺服器只有一筆", JSON.stringify(be.submits.map((s) => s.p_command_uuid)));
  ok(be.submits[1].p_expected_part_no === "HCG-06-01" && be.submits[1].p_expected_index_sn === 5, "重送內容跟第一次一樣（料號、道次）");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：送出時網路斷、一直查不到 → 至少 30 秒＋3 次查不到才解鎖 ==");
{
  const be = makeBackend();
  be.abortNextSubmit = true;
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 10000 });
  const t0 = Date.now();
  await page.waitForTimeout(12000);
  ok(!(await sheet(page).locator("[data-station-cmd-error]").innerText()).includes("目前查不到") && await page.locator('#workOrderGrid [data-station-cmd="stop"]').isDisabled(), "12 秒（已查不到多次）→ 還不解鎖");
  await page.waitForFunction(() => document.querySelector("#machtileStationCmdSheet [data-station-cmd-error]")?.textContent.includes("目前查不到"), null, { timeout: 45000 });
  const waited = Date.now() - t0 + 1000;
  const unlockText = await sheet(page).locator("[data-station-cmd-error]").innerText();
  ok(waited >= 29000 && !unlockText.includes("沒有收到"), `至少 30 秒才出現「目前查不到」（${Math.round(waited / 1000)} 秒），不宣稱伺服器沒收到`, unlockText);
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(await cardOf(page, "A04").locator('[data-station-cmd="stop"]').isEnabled() && await cardOf(page, "A04").locator("[data-station-cmd-retry]").count() === 0, "解鎖、沒有殘留的重送鈕");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：送出逾時 → 走「不知道有沒有送到」、可重送 ==");
{
  const be = makeBackend();
  be.hangSubmit = true;
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await page.evaluate(() => { window.MachTileStationCommandCore.SUBMIT_TIMEOUT_MS = 1500; });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  ok((await sheet(page).locator("[data-station-cmd-confirm]").innerText()).trim() === "送出中…", "送出中…");
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 4000 });
  ok((await sheet(page).locator("[data-station-cmd-error]").innerText()).includes("不會重複"), "逾時 → 「還不知道有沒有送到…不會重複」（沒卡在送出中）");
  ok(await sheet(page).locator("[data-station-cmd-confirm]").isEnabled(), "逾時後馬上可以重送");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：舊 WebView 沒有 crypto.randomUUID → 用 getRandomValues ==");
{
  const be = makeBackend();
  const r = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],', noRandomUuid: true });
  ok((await r.page.evaluate(() => typeof crypto.randomUUID)) === "undefined", "（前提）頁面上沒有 crypto.randomUUID");
  be.mode = "applied";
  await cardOf(r.page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(r.page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(r.page).locator("[data-station-cmd-confirm]").click();
  await sheet(r.page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(be.submits[0]?.p_command_uuid || ""), "fallback 產生合法 v4 uuid", be.submits[0]?.p_command_uuid);
  ok(realErrors(r.errors).length === 0, "沒有 JS 錯誤", realErrors(r.errors).join(" | "));
  await r.context.close();
}

console.log("\n== 390px：本機 11 分鐘解鎖後的說明依最後狀態（pending 可再按／claimed 繼續鎖）==");
for (const last of ["pending", "claimed"]) {
  const be = makeBackend();
  be.mode = "frozen";       // 伺服器狀態不變
  const uuid = "5b1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5" + (last === "pending" ? "1" : "2");
  const requested = new Date(Date.now() - 12 * 60000).toISOString();
  be.commands.set(uuid, { id: id(9500), command_uuid: uuid, command_type: "start", machine_code: "A04", status: last, requested_at: requested,
    claimed_at: last === "claimed" ? new Date(Date.now() - 30000).toISOString() : null, reject_code: null, reject_message: null, applied_at: null });
  const rec = { commandUuid: uuid, commandType: "start", machineCode: "A04", orderNo: "XX01202502050012", step: 5, partNo: "HCG-06-01",
    startedAt: Date.now() - 12 * 60000, unconfirmed: false, serverOffset: 0, lastStatus: last };
  const r = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],', preload: { "machtile.stationCmdPending.v1": JSON.stringify({ A04: rec }) } });
  await r.page.waitForFunction(() => document.querySelector('#workOrderGrid [data-station-cmd-status]'), null, { timeout: 15000 });
  await r.page.evaluate(() => { deriveMachines(); renderWorkOrders(); });
  const txt = await cardOf(r.page, "A04").locator("[data-station-cmd-status]").innerText();
  const startEnabled = await cardOf(r.page, "A04").locator('[data-station-cmd="start"]').isEnabled();
  if (last === "pending") ok(txt.includes("可以再按") && startEnabled, "最後狀態 pending → 「可以再按」、按鈕解鎖", txt);
  else ok(txt.includes("工廠還在處理上一筆，請等結果或問生管") && !txt.includes("可以再按") && !startEnabled, "最後狀態 claimed → 「工廠還在處理上一筆…」、按鈕仍鎖", txt);
  if (last === "claimed") await cardOf(r.page, "A04").screenshot({ path: path.join(outDir, "phone-15-released-claimed.png") });
  ok(realErrors(r.errors).length === 0, "沒有 JS 錯誤", realErrors(r.errors).join(" | "));
  await r.context.close();
}

console.log("\n== 390px：同一台已有指令在途（別台平板按的）→ 白話、不鎖 ==");
{
  const be = makeBackend({ submitError: "MACHINE_COMMAND_IN_FLIGHT: A04 already has a pending command" });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 10000 });
  const t = (await sheet(page).locator("[data-station-cmd-error]").innerText()).trim();
  ok(t.includes("已經有一筆開工／停工在等工廠處理"), "在途 → 白話", t);
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(await cardOf(page, "A04").locator('[data-station-cmd="stop"]').isEnabled(), "伺服器明確拒絕 → 不鎖卡片");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ---------------------------------------------------------------------------------------------
// 管理員（owner 2026-10-08 方案 C，D1–D4）
for (const vp of ["desktop", "phone"]) {
  const W = VIEWPORTS[vp].viewport.width;
  console.log(`\n== ${W}px：管理員＋旗標關 → 跟現在一模一樣 ==`);
  {
    let baselineGrid = null;
    if (baselineAvailable) {
      const b = await newPage(browser, vp, { backend: makeBackend({ role: "admin", appUserName: "Adam" }), baseline: true });
      baselineGrid = await gridHtml(b.page);
      await b.context.close();
    }
    const be = makeBackend({ role: "admin", appUserName: "Adam" });
    const { context, page, errors } = await newPage(browser, vp, { backend: be });
    ok(await page.locator(".station-cmd-row, [data-station-cmd]").count() === 0, `${W}：管理員＋旗標關 → 沒有按鈕`);
    ok(be.stationReads === 0, `${W}：管理員＋旗標關 → 沒讀 station_commands（${be.stationReads}）`);
    if (baselineGrid !== null) { const g = await gridHtml(page); ok(g === baselineGrid, `${W}：管理員＋旗標關 → 卡片 HTML 跟 ${baselineRef} 一字不差`, firstDiff(g, baselineGrid)); }
    else { skip++; console.log(`  SKIP ${W}：讀不到 ${baselineRef}，略過一字不差比對`); }
    ok(realErrors(errors).length === 0, `${W}：沒有 JS 錯誤`, realErrors(errors).join(" | "));
    await context.close();
  }

  console.log(`== ${W}px：管理員＋旗標含 A04 → 看得到按鈕、確認卡寫明是管理員 ==`);
  {
    const be = makeBackend({ role: "admin", appUserName: "Adam" });
    const { context, page, errors } = await newPage(browser, vp, { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
    ok(be.stationReads >= 1, `${W}：管理員也會探測 station_commands（${be.stationReads}）`);
    const a04 = cardOf(page, "A04");
    ok(await a04.locator("[data-station-cmd]").count() === 2, `${W}：管理員在 A04 看到「開工」「停工」`);
    ok(await page.locator("#workOrderGrid [data-station-cmd]").count() === 2, `${W}：只有 A04 有（A01、B03 沒有）`);
    await a04.locator('[data-station-cmd="start"]').click();
    await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
    ok(await sheet(page).locator("[data-station-cmd-admin]").count() === 1, `${W}：確認卡有管理員提示`);
    const l0 = (await sheet(page).locator('[data-station-cmd-admin-line="0"]').innerText()).trim();
    const l1 = (await sheet(page).locator('[data-station-cmd-admin-line="1"]').innerText()).trim();
    ok(l0 === "你是管理員 Adam，這筆會記成你按的", `${W}：第一行「你是管理員 Adam，這筆會記成你按的」`, l0);
    ok(l1 === "你不在機台旁，請先確認現場狀況", `${W}：第二行「你不在機台旁，請先確認現場狀況」`, l1);
    ok(await fieldText(page, "machine") === "A04" && await fieldText(page, "order") === "XX01202502050012" && await fieldText(page, "part") === "HCG-06-01　HCG-06本體",
      `${W}：機台／工單號／料號跟作業員一樣`);
    ok(await page.evaluate(() => document.activeElement?.hasAttribute("data-station-cmd-close")), `${W}：初始焦點仍在「取消」`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, `${W}：沒有橫向捲動（${overflow}px）`);
    await page.screenshot({ path: path.join(outDir, `${vp}-20-admin-confirm.png`) });
    be.mode = "applied";
    await sheet(page).locator("[data-station-cmd-confirm]").click();
    await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
    const sent = be.submits[0] || {};
    ok(be.submits.length === 1 && sent.p_command_type === "start" && sent.p_machine_code === "A04" && sent.p_expected_order_no === "XX01202502050012" && sent.p_expected_index_sn === 5
      && Object.keys(sent).sort().join(",") === "p_command_type,p_command_uuid,p_expected_index_sn,p_expected_order_no,p_expected_part_no,p_machine_code,p_manufacture_ii_id",
      `${W}：管理員送出的欄位跟作業員完全一樣（身分由伺服器判斷）`, JSON.stringify(sent));
    await sheet(page).locator("[data-station-cmd-close]").click();
    ok(be.otherWrites.length === 0, `${W}：除了指令 RPC 沒有任何其他寫入`, be.otherWrites.join(" "));
    ok(realErrors(errors).length === 0, `${W}：沒有 JS 錯誤`, realErrors(errors).join(" | "));
    await context.close();
  }
}

console.log("\n== 1440px：作業員的確認卡沒有管理員字樣 ==");
{
  const be = makeBackend();
  const { context, page, errors } = await newPage(browser, "desktop", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  ok(await sheet(page).locator("[data-station-cmd-admin]").count() === 0 && !(await sheet(page).innerText()).includes("管理員"), "作業員 → 沒有「你是管理員」");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 1440px：旗標開但登入的是 manager → 不出按鈕、不讀 ==");
{
  const be = makeBackend({ role: "manager" });
  const { context, page, errors } = await newPage(browser, "desktop", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  ok(await page.locator("#workOrderGrid [data-station-cmd]").count() === 0, "manager → 沒有開工／停工按鈕");
  ok(be.stationReads === 0, `manager → 沒讀 station_commands（${be.stationReads}）`);
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

for (const [code, want] of [["ADMIN_LEGACY_ID_MISSING", "管理員帳號還沒對應舊 MES 工號，請找 Claude 設定"], ["ADMIN_SUBMIT_DISABLED", "管理員開工／停工尚未開放"]]) {
  console.log(`\n== 390px：管理員送出被拒 ${code} → 白話、不鎖 ==`);
  const be = makeBackend({ role: "admin", appUserName: "Adam", submitError: `${code}: detail` });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor();
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 10000 });
  const t = (await sheet(page).locator("[data-station-cmd-error]").innerText()).trim();
  ok(t === want, `${code} → 「${want}」`, t);
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(await cardOf(page, "A04").locator('[data-station-cmd="stop"]').isEnabled(), `${code} → 不鎖卡片`);
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ---------------------------------------------------------------------------------------------
// 8. 開工時一起填今日開工數量（owner 2026-10-08「按開工時，順便請他填計數器數字，一次做完」）
const shotsDir = process.env.STATION_CMD_SHOTS || outDir;
await mkdir(shotsDir, { recursive: true });
const dailyField = (page) => sheet(page).locator("[data-station-cmd-daily-qty]");
const footerToday = async (page, code) => ((await cardOf(page, code).locator("[data-today-status]").first().innerText().catch(() => "")) || "").trim();
const hideFloatingCss = "#machtileSessionBadge, #aiSupportFab, .fab, .mobile-tabs { visibility: hidden !important; }";

for (const vp of ["phone", "desktop"]) {
  const W = VIEWPORTS[vp].viewport.width;
  console.log(`\n== ${W}px：作業員、今天還沒今日開工 → 確認卡多一格必填數量，兩件事各送一次 ==`);
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, vp, { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  ok(await footerToday(page, "A04") === "今日尚未開工", `${W}：開工前 A04 卡片底部「今日尚未開工」`, await footerToday(page, "A04"));
  // 停工確認卡：不問
  await cardOf(page, "A04").locator('[data-station-cmd="stop"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  ok(await dailyField(page).count() === 0, `${W}：停工確認卡沒有今日開工數量`);
  await sheet(page).locator("[data-station-cmd-close]").click();

  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  ok(await dailyField(page).count() === 1, `${W}：開工確認卡出現今日開工數量欄位`);
  ok(!(await sheet(page).innerText()).includes("今天這台還沒記今日開工") && !(await sheet(page).innerText()).includes("只記錄（不改舊 MES）"),
    `${W}：名單內機台不再顯示重複的今日開工／只記錄提示`);
  const label = (await sheet(page).locator("[data-station-cmd-daily] label").innerText()).replace(/\s+/g, " ").trim();
  ok(label === "機台目前加工數量（今日開工） 必填", `${W}：欄位名稱＋必填`, label);
  const attrs = await dailyField(page).evaluate((el) => ({ type: el.type, min: el.min, step: el.step, required: el.required, value: el.value, max: el.max }));
  ok(attrs.type === "number" && attrs.min === "0" && attrs.step === "1" && attrs.required && attrs.value === "" && attrs.max === "",
    `${W}：數字欄、min 0、整數、必填、預設空白、沒有上限（跟報工今日開工同一套）`, JSON.stringify(attrs));
  ok(await sheet(page).locator('input[type="file"], [data-camera-for]').count() === 0, `${W}：確認卡沒有照片欄`);
  ok(await page.evaluate(() => document.activeElement?.hasAttribute("data-station-cmd-close")), `${W}：初始焦點仍在「取消」`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `${W}：多了欄位也沒有橫向捲動（${overflow}px）`);
  if (vp === "phone") {
    const hide = await page.addStyleTag({ content: hideFloatingCss });
    await page.screenshot({ path: path.join(shotsDir, "390-start-counter-empty-top.png") });
    await sheet(page).locator("[data-station-cmd-daily]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shotsDir, "390-start-counter-empty.png") });
    await hide.evaluate((el) => el.remove());
  }

  // 空白 → 擋下（同一句提示），什麼都沒送
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator("[data-station-cmd-daily-error]").waitFor({ timeout: 5000 });
  ok((await sheet(page).locator("[data-station-cmd-daily-error]").innerText()).trim() === "請填寫目前機台已加工數量。", `${W}：空白 → 「請填寫目前機台已加工數量。」`);
  ok(be.submits.length === 0 && be.reportUpserts.length === 0, `${W}：空白 → 開工指令、今日開工都沒送`);
  ok(await page.evaluate(() => document.activeElement?.hasAttribute("data-station-cmd-daily-qty")), `${W}：空白 → 焦點移到數量欄`);
  for (const bad of ["-3", "12.5"]) {
    await dailyField(page).fill(bad);
    await sheet(page).locator("[data-station-cmd-confirm]").click();
    await page.waitForTimeout(150);
    const msg = (await sheet(page).locator("[data-station-cmd-daily-error]").innerText()).trim();
    ok(msg === "機台目前加工數量要填 0 或正整數。" && be.submits.length === 0 && be.reportUpserts.length === 0, `${W}：「${bad}」→ 擋下、什麼都沒送`, msg);
  }
  await dailyField(page).fill("208");
  ok(await sheet(page).locator("[data-station-cmd-daily-error]").count() === 0 && await dailyField(page).getAttribute("aria-invalid") === null, `${W}：改了數字 → 上一次的提示收起來`);
  ok(await page.evaluate(() => document.activeElement?.hasAttribute("data-station-cmd-daily-qty")), `${W}：打字時焦點留在數量欄`);
  if (vp === "phone") {
    const hide = await page.addStyleTag({ content: hideFloatingCss });
    await sheet(page).locator("[data-station-cmd-daily]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shotsDir, "390-start-counter-filled.png") });
    await hide.evaluate((el) => el.remove());
  }
  // 連按三下
  be.mode = "hold";
  await sheet(page).locator("[data-station-cmd-confirm]").evaluate((el) => { el.click(); el.click(); el.click(); });
  await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor({ timeout: 10000 });
  await sheet(page).locator('[data-station-cmd-daily-state="saved"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  ok(be.submits.length === 1, `${W}：連按三下 → 開工指令只送一次（${be.submits.length}）`);
  ok(be.reportUpserts.length === 1, `${W}：連按三下 → 今日開工只送一次（${be.reportUpserts.length}）`);
  const sent = be.submits[0] || {};
  ok(JSON.stringify(Object.keys(sent).sort()) === JSON.stringify(["p_command_type", "p_command_uuid", "p_expected_index_sn", "p_expected_order_no", "p_expected_part_no", "p_machine_code", "p_manufacture_ii_id"])
    && sent.p_command_type === "start" && sent.p_machine_code === "A04" && sent.p_expected_order_no === "XX01202502050012" && sent.p_expected_index_sn === 5 && sent.p_expected_part_no === "HCG-06-01" && sent.p_manufacture_ii_id === null,
    `${W}：開工指令內容跟以前一樣（沒有夾帶數量）`, JSON.stringify(sent));
  const up = be.reportUpserts[0] || {};
  const pl = up.p_payload || {};
  ok(/^[0-9a-f-]{36}$/.test(up.p_report_uuid || "") && pl.report_type === "dailyStart" && pl.process_id === id(304) && pl.work_order_id === id(104) && pl.tenant_id === T
    && pl.completed_qty === 0 && pl.defect_qty === 0 && pl.user_id === users[0].id && JSON.stringify(pl.operators) === JSON.stringify([users[0].id]) && typeof pl.ended_at === "string",
    `${W}：今日開工走 field_report_upsert（同一條報工路）：這道工序、0／0、報工人＝登入者`, JSON.stringify(up));
  ok(JSON.stringify(pl.report_payload) === JSON.stringify({ report_type: "dailyStart", work_total_qty: null, cycle_time_seconds: null, machine_qty: 208, completed_qty: 0, defect_qty: 0, has_program_upload: false, overtime_plan: "", pm_abnormal: "", abnormal_type: "" })
    && pl.work_total_qty === null && pl.cycle_time_seconds === null,
    `${W}：report_payload＝報工今日開工同一個形狀，machine_qty 208`, JSON.stringify(pl.report_payload));
  ok(pl.remark === "[今日開工]；機台已加工數量 208；開工確認卡一起填", `${W}：備註`, pl.remark);
  ok((await sheet(page).locator('[data-station-cmd-daily-state="saved"]').innerText()).trim() === "今日開工數量 208：已記錄", `${W}：確認卡顯示「今日開工數量 208：已記錄」`);
  ok(await dailyField(page).count() === 0, `${W}：送出後數量欄不再出現`);
  // 卡片底部馬上變「今日已開工」（同一份今天紀錄重讀）
  await page.waitForFunction(() => {
    const card = [...document.querySelectorAll("#workOrderGrid .machine-tile-card")].find((c) => c.querySelector("h2")?.textContent.includes("A04"));
    return card?.querySelector("[data-today-status]")?.textContent.includes("今日已開工");
  }, null, { timeout: 8000 }).catch(() => {});
  const ft = await footerToday(page, "A04");
  ok(/^今日已開工 \d{2}:\d{2}・王小明$/.test(ft), `${W}：卡片底部改成「今日已開工 hh:mm・王小明」`, ft);
  if (vp === "phone") await page.screenshot({ path: path.join(shotsDir, "390-start-counter-sent.png") });
  be.mode = "applied";
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  ok(be.submits.length === 1 && be.reportUpserts.length === 1, `${W}：開工套用完成後仍各只有一次`);
  await sheet(page).locator("[data-station-cmd-close]").click();
  // 再開一次開工：今天已記 → 沒有欄位
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  ok(await dailyField(page).count() === 0, `${W}：今日開工已記 → 再按開工沒有數量欄`);
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(realErrors(errors).length === 0, `${W}：沒有 JS 錯誤`, realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：作業員、今天已經有今日開工 → 沒有數量欄，確認卡跟以前一樣 ==");

console.log("\n== 390px：連打三位數只局部更新，input identity 與完整值都保留 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  be.procExtra["XX01202502050012"] = { qty_completed: 0 };
  be.progressRows = [{ process_id: id(304), legacy_output: 140, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0 }];
  const { context, page } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"], startBackfillEnabled: true,' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await dailyField(page).waitFor();
  await page.evaluate(() => { window.__dailyInputIdentity = document.querySelector("[data-station-cmd-daily-qty]"); });
  await dailyField(page).pressSequentially("159");
  ok(await page.evaluate(() => window.__dailyInputIdentity === document.querySelector("[data-station-cmd-daily-qty]")), "連打三位數後 input 元素 identity 不變");
  const typed = await dailyField(page).inputValue();
  ok(typed === "159", "連打三位數後值完整保留為 159", typed);
  await context.close();
}

console.log("\n== 390px：B03 卡片已報 156，開工 159 → 顯示並只補報 3 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  be.procExtra["XX01202606300001"] = { qty_completed: 0 };
  be.progressRows = [{ process_id: id(333), legacy_output: 156, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0 }];
  const cfg = 'stationCommandMachines: ["B03"], startBackfillEnabled: true, enableStationReport: true, stationReportMachines: ["B03"],';
  const { context, page } = await newPage(browser, "phone", { backend: be, configExtra: cfg });
  await cardOf(page, "B03").locator('[data-station-cmd="start"]').click();
  await dailyField(page).fill("159");
  await sheet(page).getByText("機台顯示 159 件、系統只記 156 件。按確認開工會同時補報 3 件（算前一班未報）").waitFor();
  ok((await sheet(page).locator("[data-station-cmd-confirm]").innerText()).trim() === "確認開工並補報 3 件", "B03 確認鈕顯示補報 3");
  be.mode = "applied";
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const backfill = be.reportUpserts.map((x) => x.p_payload).find((x) => x?.report_payload?.start_backfill === true);
  ok(backfill?.completed_qty === 3, "B03 送出的補報 good 也是 3", JSON.stringify(backfill));
  await context.close();
}

console.log("\n== 390px：本道累計已報讀不到 → fail closed、不送補報 ==");
{
  const be = makeBackend({ dailyStartDone: false }); be.progressReadFail = true;
  const cfg = 'stationCommandMachines: ["A04"], startBackfillEnabled: true, enableStationReport: true, stationReportMachines: ["A04"],';
  const { context, page } = await newPage(browser, "phone", { backend: be, configExtra: cfg });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await dailyField(page).fill("159");
  await sheet(page).locator("[data-station-cmd-start-unavailable]").waitFor();
  be.mode = "applied";
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
  ok(be.stationReportSubmits.length === 0 && !be.reportUpserts.some((x) => x.p_payload?.report_payload?.start_backfill), "讀不到本道已報數量時不送補報");
  await context.close();
}

console.log("\n== 390px：開工補報——必答確認、applied 後 fresh totals 只送一次 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  be.procExtra["XX01202502050012"] = { qty_completed: 140, qty_defect: 0 };
  be.progressRows = [{ process_id: id(304), legacy_output: 140, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0 }];
  const cfg = 'stationCommandMachines: ["A04"], startBackfillEnabled: true, enableStationReport: true, stationReportMachines: ["A04"], enableOutboxSubmit: true,';
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: cfg });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await dailyField(page).fill("208");
  await sheet(page).getByText("機台顯示 208 件、系統只記 140 件。按確認開工會同時補報 68 件（算前一班未報）").waitFor();
  ok(await sheet(page).locator(".station-cmd-actions button").count() === 2, "差額確認區塊只有確認補報與回去改數字兩個按鈕");
  ok((await sheet(page).locator("[data-station-cmd-confirm]").innerText()).trim() === "確認開工並補報 68 件", "確認鈕明列補報差額");
  be.mode = "hold";
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor();
  ok(be.stationReportSubmits.length === 0, "start 尚未 applied 不送補報");
  be.mode = "applied";
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => window.MACHTILE_CONFIG && JSON.parse(localStorage.getItem("machtile.stationCmdStartBackfill.v1") || "{}").constructor === Object);
  await page.waitForTimeout(1500);
  ok(be.stationReportSubmits.length === 2 && be.stationReportSubmits[0].p_preview === true && be.stationReportSubmits[1].p_preview === false,
    "applied 後沿用同一智慧報工 RPC：預覽一次、正式一次", JSON.stringify(be.stationReportSubmits));
  const backfill = be.reportUpserts.map((x) => x.p_payload).find((x) => x?.report_payload?.start_backfill === true);
  ok(backfill?.completed_qty === 68 && backfill?.defect_qty === 0 && backfill.report_payload.start_command_uuid === be.submits[0].p_command_uuid,
    "fresh totals 140 → 補報 68，payload 標記 start_backfill 與 start command", JSON.stringify(backfill));
  ok((backfill?.remark || "").startsWith("開工補報（前一班未報）"), "補報 remark 使用指定前綴", backfill?.remark);
  ok(new Set(be.reportUpserts.map((x) => x.p_report_uuid)).size === be.reportUpserts.length, "補報 report_uuid 不重複");
  ok(realErrors(errors).length === 0, "開工補報沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：補報送出前別台已報到同數 → 不送 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  be.procExtra["XX01202502050012"] = { qty_completed: 140 };
  be.progressRows = [{ process_id: id(304), legacy_output: 208, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0 }];
  const { context, page } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"], startBackfillEnabled: true, enableStationReport: true, stationReportMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click(); await dailyField(page).fill("208"); await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor(); be.mode = "applied"; await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 }); await page.waitForTimeout(800);
  ok(be.stationReportSubmits.length === 0 && !be.reportUpserts.some((x) => x.p_payload?.report_payload?.start_backfill), "fresh totals 已到 208：差額 0，不送補報");
  await context.close();
}

console.log("\n== 390px：開工斷線 → 重新整理後從卡片重送 → applied 仍只補報一次 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  be.procExtra["XX01202502050012"] = { qty_completed: 0 };
  be.progressRows = [{ process_id: id(304), legacy_output: 140, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0 }];
  be.abortNextSubmit = true;
  const cfg = 'stationCommandMachines: ["A04"], startBackfillEnabled: true, enableStationReport: true, stationReportMachines: ["A04"],';
  const { context, page } = await newPage(browser, "phone", { backend: be, configExtra: cfg });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click(); await dailyField(page).fill("208");
  await sheet(page).locator("[data-station-cmd-confirm]").click(); await sheet(page).locator("[data-station-cmd-error]").waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await cardOf(page, "A04").locator("[data-station-cmd-retry]").click();
  be.mode = "applied";
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 }); await page.waitForTimeout(1200);
  ok(be.reportUpserts.filter((x) => x.p_payload?.report_payload?.start_backfill).length === 1, "卡片重送 applied 後補報恰好一次");
  await context.close();
}

console.log("\n== 390px：等於／小於／旗標 false／rejected 都不補報 ==");
for (const [label, qty, enabled, mode] of [["等於", 140, true, "applied"], ["小於", 139, true, "applied"], ["旗標 false", 208, false, "applied"], ["rejected", 208, true, "rejected"]]) {
  const be = makeBackend({ dailyStartDone: false }); be.procExtra["XX01202502050012"] = { qty_completed: 140 }; be.progressRows = [{ process_id: id(304), legacy_output: 140, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0 }];
  const { context, page } = await newPage(browser, "phone", { backend: be, configExtra: `stationCommandMachines: ["A04"], startBackfillEnabled: ${enabled}, enableStationReport: true, stationReportMachines: ["A04"],` });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click(); await dailyField(page).fill(String(qty));
  if (label === "小於") ok(await sheet(page).getByText("機台數字比系統少，請確認機台上是這張單的數字").isVisible(), "小於顯示指定警告且仍可開工");
  await sheet(page).locator("[data-station-cmd-confirm]").click(); await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor(); be.mode = mode;
  await sheet(page).locator(`[data-station-cmd-result="${mode}"]`).waitFor({ timeout: 15000 }); await page.waitForTimeout(500);
  ok(be.stationReportSubmits.length === 0, `${label}：不送補報`); await context.close();
}

console.log("\n== 390px：applied 後斷線／關頁，恢復後補送一次 ==");
{
  const commandUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const queued = { [commandUuid]: { machineCode: "A04", snap: { qty: 208, processId: id(304), workOrderId: id(104), orderNo: "XX01202502050012", tenantId: T, processStatus: "running" } } };
  const be = makeBackend({ dailyStartDone: true }); be.procExtra["XX01202502050012"] = { qty_completed: 140 }; be.progressRows = [{ process_id: id(304), legacy_output: 140, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0 }];
  const cfg = 'stationCommandMachines: ["A04"], startBackfillEnabled: true, enableStationReport: true, stationReportMachines: ["A04"],';
  let opened = await newPage(browser, "phone", { backend: be, configExtra: cfg, preload: { "machtile.stationCmdStartBackfill.v1": JSON.stringify(queued) } });
  await opened.page.waitForFunction(() => JSON.parse(localStorage.getItem("machtile.stationCmdStartBackfill.v1") || "{}")["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] == null, null, { timeout: 15000 });
  ok(be.stationReportSubmits.length === 2 && be.reportUpserts.filter((x) => x.p_payload?.report_payload?.start_backfill).length === 1, "恢復後預覽＋正式送出，正式補報只有一次");
  await opened.page.reload({ waitUntil: "domcontentloaded" }); await opened.page.waitForTimeout(1000);
  ok(be.stationReportSubmits.length === 2 && be.reportUpserts.filter((x) => x.p_payload?.report_payload?.start_backfill).length === 1, "再次恢復不會重複補報");
  await opened.context.close();
}

console.log("\n== 390px：補報第一次算出的 good 固定，重試不因最新已報較小而改量 ==");
{
  const commandUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const queued = { [commandUuid]: { machineCode: "A04", snap: { qty: 208, processId: id(304), workOrderId: id(104), orderNo: "XX01202502050012", tenantId: T, processStatus: "running" } } };
  const be = makeBackend({ dailyStartDone: true });
  be.procExtra["XX01202502050012"] = { qty_completed: 0 };
  be.progressRows = [{ process_id: id(304), legacy_output: 140, legacy_fail: 0, pending_output: 0, pending_fail: 0, pending_count: 0 }];
  be.stationReportFailCount = 1;
  const cfg = 'stationCommandMachines: ["A04"], startBackfillEnabled: true, enableStationReport: true, stationReportMachines: ["A04"],';
  const { context, page } = await newPage(browser, "phone", { backend: be, configExtra: cfg, preload: { "machtile.stationCmdStartBackfill.v1": JSON.stringify(queued) } });
  await page.waitForFunction((uuid) => JSON.parse(localStorage.getItem("machtile.stationCmdStartBackfill.v1") || "{}")[uuid]?.good === 68, commandUuid);
  be.progressRows[0].legacy_output = 100;
  await page.waitForFunction((uuid) => JSON.parse(localStorage.getItem("machtile.stationCmdStartBackfill.v1") || "{}")[uuid] == null, commandUuid, { timeout: 15000 });
  const backfill = be.reportUpserts.map((x) => x.p_payload).find((x) => x?.report_payload?.start_backfill === true);
  ok(backfill?.completed_qty === 68, "同一 report_uuid 重試仍送第一次固定的 good=68，不改成 108", JSON.stringify(backfill));
  await context.close();
}

{
  const be = makeBackend({ dailyStartDone: true });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  ok(/^今日已開工/.test(await footerToday(page, "A04")), "卡片底部「今日已開工…」", await footerToday(page, "A04"));
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  ok(await dailyField(page).count() === 0 && await sheet(page).locator("[data-station-cmd-daily]").count() === 0, "已有今日開工 → 沒有數量欄");
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor({ timeout: 10000 });
  be.mode = "applied";
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  ok(be.submits.length === 1 && be.reportUpserts.length === 0 && be.directPosts.length === 0,
    `名單內機台已有今日開工 → 再按開工只送一筆指令、不生第二筆 dailyStart（指令 ${be.submits.length}／RPC 報工 ${be.reportUpserts.length}／direct 報工 ${be.directPosts.length}）`);
  ok(await sheet(page).locator("[data-station-cmd-daily-state]").count() === 0, "結果畫面也沒有今日開工字樣");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：別台平板剛記過今日開工（卡片還沒重讀）→ 開卡重讀後不問 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  be.todayRows = [{ process_id: id(304), report_type: "dailyStart", created_at: ago(1), started_at: null, ended_at: ago(1), completed_qty: 0, defect_qty: 0, user_id: users[0].id, operator_ids: [users[0].id] }];
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  ok(await dailyField(page).count() === 0, "開卡重讀到今天已有今日開工 → 數量欄收起來");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：管理員、今天還沒今日開工 → 不問、不建今日開工 ==");
{
  const be = makeBackend({ role: "admin", appUserName: "Adam", dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  ok(await sheet(page).locator("[data-station-cmd-admin]").count() === 1, "管理員確認卡（有「你是管理員」那兩行）");
  ok(await dailyField(page).count() === 0, "管理員 → 沒有今日開工數量欄");
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  ok(be.submits.length === 1 && be.reportUpserts.length === 0, `管理員 → 只送開工指令，沒建今日開工（${be.submits.length}／${be.reportUpserts.length}）`);
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：今日開工沒存到 → 提示到報工補填，開工指令照樣只送一次 ==");
{
  const be = makeBackend({ dailyStartDone: false, dailyStartFail: true });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  await dailyField(page).fill("150");
  await sheet(page).locator("[data-station-cmd-confirm]").evaluate((el) => { el.click(); el.click(); el.click(); });
  await sheet(page).locator('[data-station-cmd-daily-state="failed"]').waitFor({ timeout: 10000 });
  const failMsg = (await sheet(page).locator('[data-station-cmd-daily-state="failed"]').innerText()).trim();
  ok(failMsg === "今日開工數量沒存到，請到報工→今日開工補填", "確認卡顯示「今日開工數量沒存到，請到報工→今日開工補填」", failMsg);
  ok((await page.locator("#toast").innerText().catch(() => "")).includes("今日開工數量沒存到"), "也跳提示（toast）");
  await sheet(page).locator('[data-station-cmd-result]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(2500);
  ok(be.submits.length === 1, `開工指令只送一次、沒被擋（${be.submits.length}）`);
  ok(be.reportUpserts.length === 1, `今日開工只試一次（伺服器拒絕不重試；${be.reportUpserts.length}）`);
  ok(await sheet(page).locator('[data-station-cmd-result="pending"]').count() === 1, "開工指令照常等待工廠結果");
  ok(await footerToday(page, "A04") === "今日尚未開工", "卡片底部仍是「今日尚未開工」（沒存到就不假裝）", await footerToday(page, "A04"));
  if (true) await page.screenshot({ path: path.join(shotsDir, "390-start-counter-save-failed.png") });
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：開工送出被拒（FORBIDDEN）→ 不寫今日開工，數量留在欄位上 ==");
{
  const be = makeBackend({ dailyStartDone: false, submitError: "FORBIDDEN: not allowed" });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  await dailyField(page).fill("208");
  await sheet(page).locator("[data-station-cmd-confirm]").evaluate((el) => { el.click(); el.click(); el.click(); });
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  ok(be.submits.length === 1, `開工 RPC 只試一次（${be.submits.length}）`);
  ok(be.commands.size === 0, "伺服器沒有建立指令列");
  ok(be.reportUpserts.length === 0 && be.directPosts.length === 0, `開工被拒 → 沒寫今日開工（${be.reportUpserts.length}／${be.directPosts.length}）`);
  ok((await sheet(page).locator("[data-station-cmd-error]").innerText()).trim().length > 0, "確認卡照舊顯示開工被拒", await sheet(page).locator("[data-station-cmd-error]").innerText());
  ok(await dailyField(page).count() === 1 && await dailyField(page).inputValue() === "208", "數量欄還在、208 留著");
  ok(await sheet(page).locator("[data-station-cmd-daily-state]").count() === 0, "沒有「已記錄／儲存中」字樣");
  ok(await footerToday(page, "A04") === "今日尚未開工", "卡片底部仍是「今日尚未開工」", await footerToday(page, "A04"));
  await page.screenshot({ path: path.join(shotsDir, "390-start-counter-start-refused.png") });
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：開工送出時網路斷（沒收到回覆）→ 不寫；按重送被接受後才寫，之後工廠拒絕也不撤 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  await dailyField(page).fill("150");
  be.abortNextSubmit = true;
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  ok(be.submits.length === 1 && be.reportUpserts.length === 0, `沒收到回覆 → 今日開工沒寫（${be.submits.length}／${be.reportUpserts.length}）`);
  ok(await dailyField(page).count() === 1 && await dailyField(page).inputValue() === "150", "數量欄還在、150 留著");
  ok((await sheet(page).locator("[data-station-cmd-confirm]").innerText()).trim() === "重送", "按鈕變「重送」");
  be.mode = "hold";
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-daily-state="saved"]').waitFor({ timeout: 10000 });
  ok(be.submits.length === 2 && be.submits[1].p_command_uuid === be.submits[0].p_command_uuid, "重送用同一個 command_uuid");
  ok(be.reportUpserts.length === 1 && be.reportUpserts[0].p_payload?.report_payload?.machine_qty === 150, `重送被接受 → 今日開工寫一次、數量 150（${be.reportUpserts.length}）`);
  be.mode = "rejected";
  await sheet(page).locator('[data-station-cmd-result="rejected"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  ok(be.reportUpserts.length === 1 && (await sheet(page).locator('[data-station-cmd-daily-state="saved"]').count()) === 1, "工廠之後拒絕套用 → 今日開工不撤、不重送");
  await page.waitForFunction(() => {
    const card = [...document.querySelectorAll("#workOrderGrid .machine-tile-card")].find((c) => c.querySelector("h2")?.textContent.includes("A04"));
    return card?.querySelector("[data-today-status]")?.textContent.includes("今日已開工");
  }, null, { timeout: 8000 }).catch(() => {});
  ok(/^今日已開工/.test(await footerToday(page, "A04")), "卡片底部「今日已開工…」（計數器是事實）", await footerToday(page, "A04"));
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

for (const [mode, label] of [["ok", "回了列"], ["structRejected", "結構化欄位被拒"]]) {
  console.log(`\n== 390px：outbox 關掉、直接 POST production_reports（${label}）==`);
  const be = makeBackend({ dailyStartDone: false, directMode: mode });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"], enableOutboxSubmit: false,' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  await dailyField(page).fill("208");
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator(mode === "ok" ? '[data-station-cmd-daily-state="saved"]' : '[data-station-cmd-daily-state="failed"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  ok(be.submits.length === 1, `${label}：開工指令一次`);
  ok(be.reportUpserts.length === 0 && be.directPosts.length === 1, `${label}：直接 POST 只一次、沒有退回只送基本欄位（${be.directPosts.length}）`);
  const body = be.directPosts[0] || {};
  ok(body.report_type === "dailyStart" && body.report_payload?.machine_qty === 208 && body.process_id === id(304), `${label}：POST 帶 report_type＋report_payload.machine_qty 208`, JSON.stringify(body));
  if (mode === "ok") {
    ok((await sheet(page).locator('[data-station-cmd-daily-state="saved"]').innerText()).trim() === "今日開工數量 208：已記錄", "回了列 → 已記錄");
    await page.waitForFunction(() => {
      const card = [...document.querySelectorAll("#workOrderGrid .machine-tile-card")].find((c) => c.querySelector("h2")?.textContent.includes("A04"));
      return card?.querySelector("[data-today-status]")?.textContent.includes("今日已開工");
    }, null, { timeout: 8000 }).catch(() => {});
    ok(/^今日已開工/.test(await footerToday(page, "A04")), "重讀找到那一列 → 卡片底部「今日已開工」", await footerToday(page, "A04"));
  } else {
    ok((await sheet(page).locator('[data-station-cmd-daily-state="failed"]').innerText()).trim() === "今日開工數量沒存到，請到報工→今日開工補填", `${label} → 「今日開工數量沒存到，請到報工→今日開工補填」`);
    ok(await footerToday(page, "A04") === "今日尚未開工", `${label} → 卡片底部仍「今日尚未開工」`, await footerToday(page, "A04"));
  }
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ---------------------------------------------------------------------------------------------
// owner 2026-10-08「先修」：(a) 開工送出時網路斷、作業員沒按重送就關掉 (b) 離線排入待送
const until = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 200)); } return fn(); };
const readPending = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("machtile.stationCmdPending.v1") || "{}"); } catch { return {}; } });
const dailyStartRows = (be, pid) => be.todayRows.filter((r) => r.report_type === "dailyStart" && r.process_id === pid);
async function waitReady(page) {
  await page.waitForFunction(() => document.getElementById("dataSourceLabel")?.textContent.includes("Supabase"), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid .machine-tile-card").length > 0, null, { timeout: 20000 });
  await page.waitForFunction(() => typeof machtileCardPickState === "undefined" || machtileCardPickState.status === "ready", null, { timeout: 20000 });
  await page.waitForTimeout(300);
}
async function startWithLostAck(page, be, qty) {
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  await dailyField(page).fill(String(qty));
  be.failCommandPolls = true;     // 網路還沒好：查指令也查不到
  be.ackLostNextSubmit = true;    // 伺服器其實建好了指令，回覆掉了
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator("[data-station-cmd-error]").waitFor({ timeout: 10000 });
}

console.log("\n== 390px：(a) 開工送出時網路斷 → 沒按重送就關掉 → 重新整理 → 查到指令被接受 → 只寫一次今日開工（存的數量）==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await startWithLostAck(page, be, 208);
  ok(be.submits.length === 1 && be.commands.size === 1 && be.reportUpserts.length === 0, `網路斷 → 伺服器有指令，但今日開工還沒寫（${be.commands.size}／${be.reportUpserts.length}）`);
  await sheet(page).locator("[data-station-cmd-close]").click();
  const stored = (await readPending(page)).A04 || {};
  ok(stored.commandUuid === be.submits[0].p_command_uuid && stored.dailyStart?.qty === 208 && stored.dailyStart?.processId === id(304),
    "數量 208 跟著等確認的指令存在 localStorage（用 command_uuid 對得上）", JSON.stringify(stored));
  be.failCommandPolls = false;    // 網路恢復
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady(page);
  ok(await until(() => be.reportUpserts.length >= 1), "重新整理後查到指令被接受 → 寫今日開工");
  await page.waitForTimeout(2500);
  ok(be.reportUpserts.length === 1 && dailyStartRows(be, id(304)).length === 1, `今日開工剛好一筆（${be.reportUpserts.length}）`);
  const pl = be.reportUpserts[0]?.p_payload || {};
  ok(pl.report_type === "dailyStart" && pl.process_id === id(304) && pl.work_order_id === id(104) && pl.report_payload?.machine_qty === 208, "寫的是存著的數量 208、A04 那道", JSON.stringify(pl.report_payload));
  ok(be.reportUpserts[0]?.p_report_uuid === stationCore.dailyStartReportUuid({ tenantId: T, machineCode: "A04", processId: id(304), commandUuid: be.submits[0].p_command_uuid, day: stationCore.taiwanDay(Date.now()) }),
    "補寫用的 report_uuid＝(租戶, 機台, 工序, 今天, 指令 uuid) 的固定值", be.reportUpserts[0]?.p_report_uuid);
  ok(be.submits.length === 1, "沒有重送開工指令");
  ok(((await readPending(page)).A04 || {}).dailyStart == null, "寫完 → localStorage 裡的數量清掉");
  await page.waitForFunction(() => {
    const card = [...document.querySelectorAll("#workOrderGrid .machine-tile-card")].find((c) => c.querySelector("h2")?.textContent.includes("A04"));
    return card?.querySelector("[data-today-status]")?.textContent.includes("今日已開工");
  }, null, { timeout: 8000 }).catch(() => {});
  ok(/^今日已開工/.test(await footerToday(page, "A04")), "卡片底部「今日已開工…」", await footerToday(page, "A04"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady(page);
  await page.waitForTimeout(2500);
  ok(be.reportUpserts.length === 1, "再重新整理一次也不會再寫");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：(a) 開工送出時網路斷 → 關掉 → 查到指令被拒 → 不寫今日開工、存的數量清掉 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await startWithLostAck(page, be, 150);
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(((await readPending(page)).A04 || {}).dailyStart?.qty === 150, "數量 150 先存著");
  be.mode = "rejected";
  be.failCommandPolls = false;
  await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-station-cmd-status]')?.textContent.includes("沒有開工"), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  ok((await cardOf(page, "A04").locator("[data-station-cmd-status]").innerText().catch(() => "")).includes("沒有開工"), "卡片照舊顯示開工被拒");
  ok(be.reportUpserts.length === 0 && dailyStartRows(be, id(304)).length === 0, `被拒 → 今日開工 0 筆（${be.reportUpserts.length}）`);
  const p2 = (await readPending(page)).A04;
  ok(!p2 || p2.dailyStart == null, "存的數量清掉", JSON.stringify(p2));
  ok(await footerToday(page, "A04") === "今日尚未開工", "卡片底部仍「今日尚未開工」", await footerToday(page, "A04"));
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：(a) 網路斷、關掉，這時別台平板記了今日開工 → 查到指令被接受也不重複寫 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await startWithLostAck(page, be, 208);
  await sheet(page).locator("[data-station-cmd-close]").click();
  be.todayRows = [{ process_id: id(304), report_type: "dailyStart", created_at: new Date().toISOString(), started_at: null, ended_at: new Date().toISOString(), completed_qty: 0, defect_qty: 0, user_id: users[0].id, operator_ids: [users[0].id] }, ...be.todayRows];
  be.failCommandPolls = false;
  await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-station-cmd-status]')?.textContent.includes("工廠處理中"), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  ok(be.reportUpserts.length === 0 && dailyStartRows(be, id(304)).length === 1, `今天已有 → 不再寫（今日開工仍 1 筆；寫入 ${be.reportUpserts.length}）`);
  ok(((await readPending(page)).A04 || {}).dailyStart == null, "存的數量清掉");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：確認卡開著時別台平板記了今日開工 → 開工被接受也不重複寫 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  await dailyField(page).fill("208");
  be.todayRows = [{ process_id: id(304), report_type: "dailyStart", created_at: new Date().toISOString(), started_at: null, ended_at: new Date().toISOString(), completed_qty: 0, defect_qty: 0, user_id: users[0].id, operator_ids: [users[0].id] }];
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-daily-state="exists"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  ok(be.submits.length === 1 && be.reportUpserts.length === 0 && dailyStartRows(be, id(304)).length === 1, `開工送出、今日開工沒重複（${be.submits.length}／${be.reportUpserts.length}）`);
  ok((await sheet(page).locator('[data-station-cmd-daily-state="exists"]').innerText()).trim() === "今天這道已經有今日開工紀錄，這次的數量沒有再記", "確認卡說明已有紀錄");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：(b) 平板離線 → 今日開工排入待送：說「已排入待送」、不收數量欄、報工擋第二筆、連線後只有一筆 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  be.upsertOffline = true;
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  await dailyField(page).fill("208");
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-daily-state="queued"]').waitFor({ timeout: 15000 });
  const qText = (await sheet(page).locator('[data-station-cmd-daily-state="queued"]').innerText()).trim();
  ok(qText === "今日開工數量已排入待送，連線後會自動送出，請不要再補填", "確認卡：已排入待送、請不要再補填", qText);
  ok(await sheet(page).locator('[data-station-cmd-daily-state="failed"]').count() === 0 && !(await page.locator("#toast").innerText()).includes("沒存到"), "不說「沒存到」");
  ok(be.submits.length === 1 && dailyStartRows(be, id(304)).length === 0, "開工指令送出；伺服器還沒有今日開工");
  ok(await footerToday(page, "A04") === "今日尚未開工", "伺服器還沒有 → 卡片底部不翻成「今日已開工」", await footerToday(page, "A04"));
  if (true) await page.screenshot({ path: path.join(shotsDir, "390-start-counter-queued.png") });
  be.mode = "applied";
  await sheet(page).locator('[data-station-cmd-result="applied"]').waitFor({ timeout: 15000 });
  await sheet(page).locator("[data-station-cmd-close]").click();
  // 再按開工：outbox 已有待送的今日開工 → 不再問數量
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  ok(await dailyField(page).count() === 0, "待送中再按開工 → 沒有數量欄");
  await sheet(page).locator("[data-station-cmd-close]").click();
  ok(await footerToday(page, "A04") === "今日尚未開工", "卡片底部仍「今日尚未開工」（等伺服器有那一列）");
  ok(await page.locator('.report-type-tab[data-report-type="dailyStart"]').count() === 0, "單台報工已無今日開工入口，不會重複送待送中的數量");
  // 連線恢復 → outbox 自動送出
  be.upsertOffline = false;
  for (let i = 0; i < 30 && dailyStartRows(be, id(304)).length === 0; i++) {
    await page.evaluate(() => machtileGetOutbox().then((b) => b && b.outbox.flush())).catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  const rows = dailyStartRows(be, id(304));
  ok(rows.length === 1, `連線後伺服器剛好一筆今日開工（${rows.length}）`);
  ok(new Set(be.reportUpserts.map((b) => b.p_report_uuid)).size === 1, "所有重送都是同一個 report_uuid（冪等）");
  await page.evaluate(() => machtileStationCmdRefreshToday());
  ok(/^今日已開工/.test(await footerToday(page, "A04")), "伺服器有了 → 卡片底部「今日已開工…」", await footerToday(page, "A04"));
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ---------------------------------------------------------------------------------------------
// L3 複審（e96fc998）：結果不確定不叫補填、固定 report_uuid、報工重讀伺服器、P3
const expectedReportUuid = (be) => stationCore.dailyStartReportUuid({ tenantId: T, machineCode: "A04", processId: id(304), commandUuid: be.submits[0]?.p_command_uuid, day: stationCore.taiwanDay(Date.now()) });
const directCfg = 'stationCommandMachines: ["A04"], enableOutboxSubmit: false, stationCmdDailyStartVerifyMs: 300,';
async function confirmStartWith(page, qty) {
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  await dailyField(page).fill(String(qty));
  await sheet(page).locator("[data-station-cmd-confirm]").click();
}

console.log("\n== 390px：直接 POST 回 201 沒回列、其實已寫進去 → 不叫補填、查回來確認有 → 不重複 ==");
{
  const be = makeBackend({ dailyStartDone: false, directMode: "noRowButInserted" });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: directCfg });
  await confirmStartWith(page, 208);
  await sheet(page).locator('[data-station-cmd-daily-state="unconfirmed"]').waitFor({ timeout: 10000 });
  ok((await sheet(page).locator('[data-station-cmd-daily-state="unconfirmed"]').innerText()).trim() === "今日開工可能已送出，請稍等卡片底部更新；若 2 分鐘後仍顯示未開工再補填", "結果不確定 → 「今日開工可能已送出…若 2 分鐘後仍顯示未開工再補填」");
  ok(!(await page.locator("#toast").innerText()).includes("沒存到"), "不叫作業員補填");
  await page.screenshot({ path: path.join(shotsDir, "390-start-counter-unconfirmed.png") });
  await sheet(page).locator('[data-station-cmd-daily-state="saved"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  ok(be.directPosts.length === 1 && dailyStartRows(be, id(304)).length === 1, `查回來有 → 不再送（POST ${be.directPosts.length}、伺服器 ${dailyStartRows(be, id(304)).length} 筆）`);
  ok(be.directPosts[0]?.report_uuid === expectedReportUuid(be), "report_uuid＝(租戶, 機台, 工序, 今天, 指令 uuid) 算出的固定值", be.directPosts[0]?.report_uuid);
  await page.waitForFunction(() => {
    const card = [...document.querySelectorAll("#workOrderGrid .machine-tile-card")].find((c) => c.querySelector("h2")?.textContent.includes("A04"));
    return card?.querySelector("[data-today-status]")?.textContent.includes("今日已開工");
  }, null, { timeout: 8000 }).catch(() => {});
  ok(/^今日已開工/.test(await footerToday(page, "A04")), "卡片底部「今日已開工…」", await footerToday(page, "A04"));
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：直接 POST 回 201 沒回列、伺服器確實沒有 → 重送鈕用同一個 report_uuid → 剛好一筆 ==");
{
  const be = makeBackend({ dailyStartDone: false, directMode: "noRow" });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: directCfg });
  await confirmStartWith(page, 208);
  await sheet(page).locator('[data-station-cmd-daily-state="absent"]').waitFor({ timeout: 15000 });
  const absentText = (await sheet(page).locator('[data-station-cmd-daily-state="absent"]').innerText()).replace(/\s+/g, " ");
  ok(absentText.includes("伺服器沒有這筆今日開工") && absentText.includes("重送今日開工（數量 208）"), "查過確定沒有 → 出「重送今日開工」鈕", absentText);
  ok(be.directPosts.length === 1 && dailyStartRows(be, id(304)).length === 0, "到這裡只送過一次、伺服器 0 筆");
  await page.screenshot({ path: path.join(shotsDir, "390-start-counter-absent-resend.png") });
  be.directMode = "ok";
  await sheet(page).locator("[data-station-cmd-daily-resend]").evaluate((el) => { el.click(); el.click(); el.click(); });
  await sheet(page).locator('[data-station-cmd-daily-state="saved"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  ok(be.directPosts.length === 2, `連按三下重送只送一次（共 ${be.directPosts.length} 次 POST）`);
  ok(be.directPosts[0].report_uuid === be.directPosts[1].report_uuid && be.directPosts[1].report_uuid === expectedReportUuid(be), "重送用同一個 report_uuid", be.directPosts.map((b) => b.report_uuid).join(" "));
  ok(dailyStartRows(be, id(304)).length === 1, "伺服器剛好一筆今日開工");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

for (const [mode, label] of [["noUuid", "沒有 command_uuid"], ["wrongUuid", "command_uuid 不一樣"]]) {
  console.log(`\n== 390px：P3 開工 RPC 回應${label} → 不算這筆被接受、不寫今日開工 ==`);
  const be = makeBackend({ dailyStartDone: false });
  be.submitRowMode = mode;
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await confirmStartWith(page, 208);
  await sheet(page).locator('[data-station-cmd-daily-state="failed"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(2000);
  ok(be.submits.length === 1 && be.reportUpserts.length === 0 && be.directPosts.length === 0 && dailyStartRows(be, id(304)).length === 0, `${label} → 今日開工 0 筆（${be.reportUpserts.length}）`);
  ok(await footerToday(page, "A04") === "今日尚未開工", `${label} → 卡片底部仍「今日尚未開工」`);
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

// ---------------------------------------------------------------------------------------------
// L3 複審 fa1db2fb：等送達的今日開工持久保存；重讀讀不到不寫
const readDsQueue = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("machtile.stationCmdDailyStart.v1") || "{}"); } catch { return {}; } });
const fastCfg = 'stationCommandMachines: ["A04"], stationCmdDailyStartVerifyMs: 300,';
const otherTabletRow = () => ({ process_id: id(304), report_type: "dailyStart", created_at: new Date().toISOString(), started_at: null, ended_at: new Date().toISOString(), completed_qty: 0, defect_qty: 0, user_id: users[0].id, operator_ids: [users[0].id] });

console.log("\n== 390px：網路斷 → 關掉 → 重新整理後補寫但送不到（離線）→ 數量仍在 localStorage → 再開一次 → 剛好一筆 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: fastCfg });
  await startWithLostAck(page, be, 208);
  await sheet(page).locator("[data-station-cmd-close]").click();
  be.failCommandPolls = false;
  be.upsertOffline = true;           // 補寫時平板離線：報工送不到
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady(page);
  ok(await until(() => be.reportUpserts.length >= 1), "重新整理後查到指令被接受 → 試著補寫");
  await page.waitForTimeout(1500);
  const q1 = Object.values(await readDsQueue(page));
  ok(q1.length === 1 && q1[0].snap?.qty === 208 && q1[0].snap?.reportUuid === stationCore.dailyStartReportUuid({ tenantId: T, machineCode: "A04", processId: id(304), commandUuid: be.submits[0].p_command_uuid, day: stationCore.taiwanDay(Date.now()) }),
    "送不到 → 數量 208（連同固定 report_uuid）還在 localStorage", JSON.stringify(q1));
  ok(((await readPending(page)).A04 || {}).dailyStart == null, "指令紀錄裡的數量已搬到「等送達」（不會兩邊各寫一次）");
  ok(dailyStartRows(be, id(304)).length === 0, "伺服器還沒有今日開工");
  // 關頁、連線恢復後再開
  be.upsertOffline = false;
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady(page);
  ok(await until(() => dailyStartRows(be, id(304)).length >= 1 && (be.insertedUuids?.size || 0) >= 1), "再開一次 → 送達");
  await page.waitForTimeout(2500);
  await page.waitForFunction(() => { try { return Object.keys(JSON.parse(localStorage.getItem("machtile.stationCmdDailyStart.v1") || "{}")).length === 0; } catch { return false; } }, null, { timeout: 10000 }).catch(() => {});
  ok(dailyStartRows(be, id(304)).length === 1 && be.insertedUuids.size === 1, `伺服器剛好一筆今日開工（${dailyStartRows(be, id(304)).length}）`);
  ok(new Set(be.reportUpserts.map((b) => b.p_report_uuid)).size === 1, "每次送都是同一個 report_uuid");
  ok(Object.keys(await readDsQueue(page)).length === 0, "伺服器看到那一列 → localStorage 的數量才清掉");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：開工被接受後重讀伺服器回 5xx → 不寫、數量留著 → 讀得到後剛好一筆 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: fastCfg });
  be.todayReadFail = true;
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  ok(await dailyField(page).count() === 1, "讀不到伺服器 → 照卡片資料還是問數量");
  await dailyField(page).fill("208");
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-daily-state="retrying"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  ok((await sheet(page).locator('[data-station-cmd-daily-state="retrying"]').innerText()).trim() === "暫時查不到伺服器，今日開工數量先存在這台平板，會自動再試；請不要補填", "確認卡：暫時查不到、先存著、請不要補填");
  ok(be.submits.length === 1 && be.reportUpserts.length === 0, `5xx → 今日開工 0 筆寫入（${be.reportUpserts.length}）`);
  ok(Object.values(await readDsQueue(page))[0]?.snap?.qty === 208, "數量 208 留在 localStorage");
  ok(be.todayReads >= 3, `有在退避重試（重讀 ${be.todayReads} 次）`);
  be.todayReadFail = false;
  await sheet(page).locator('[data-station-cmd-daily-state="saved"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  ok(be.reportUpserts.length === 1 && dailyStartRows(be, id(304)).length === 1, `讀得到後 → 剛好一筆（${be.reportUpserts.length}）`);
  ok(Object.keys(await readDsQueue(page)).length === 0, "確認有了 → 數量清掉");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：重讀 5xx 期間別台平板記了今日開工 → 讀得到後看到已有 → 0 筆寫入 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: fastCfg });
  be.todayReadFail = true;
  await confirmStartWith(page, 208);
  await sheet(page).locator('[data-station-cmd-daily-state="retrying"]').waitFor({ timeout: 10000 });
  be.todayRows = [otherTabletRow(), ...be.todayRows];   // 別台平板（不同 report_uuid）
  await page.waitForTimeout(800);
  be.todayReadFail = false;
  await sheet(page).locator('[data-station-cmd-daily-state="exists"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  ok(be.reportUpserts.length === 0 && be.directPosts.length === 0 && dailyStartRows(be, id(304)).length === 1, `多平板＋重讀失敗 → 沒有第二筆（寫入 ${be.reportUpserts.length}）`);
  ok(Object.keys(await readDsQueue(page)).length === 0, "數量清掉");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：完工畫面顯示 #892 r3 關站結果 ==");
{
  const be = makeBackend();
  be.progressRows = [{ process_id: id(304), legacy_output: 208, legacy_fail: 2, pending_output: 0, pending_fail: 0, pending_count: 0, last_report_at: new Date(now).toISOString(), actual_start_at: new Date(now - 3600000).toISOString() }];
  const { context, page, errors } = await newPage(browser, "phone", { backend: be,
    configExtra: 'enableFinishButton: true, enableFinishClose: true, finishCloseMachines: ["A04"], stationCommandMachines: ["A04"], enableStationReport: true, stationReportMachines: ["A04"],' });
  await page.evaluate(({ orderId, processId }) => openFinishReport(orderId, { machine: "A04", processId }), { orderId: procs[1].wo, processId: id(304) });
  await page.waitForTimeout(500);
  const cases = [
    ["ZERO_REPORTED", { status: "rejected", reject_code: "ZERO_REPORTED" }, "這一道還沒有報工數量，不能完工關站；請先報工"],
    ["LOCK_TIMEOUT", { status: "rejected", reject_code: "LOCK_TIMEOUT" }, "這次沒有關成（系統忙），可以再按一次"],
    ["STILL_RUNNING", { status: "rejected", reject_code: "STILL_RUNNING" }, "這筆仍在生產中，沒有關站；請先停工再試。"],
    ["applied ShortQty > 0", { status: "applied", legacy_snapshot: { ShortQty: 7 } }, "少 7 件，已關站並依實做數入庫"],
    ["applied ShortQty = 0", { status: "applied", legacy_snapshot: { ShortQty: 0 } }, "已關站"],
  ];
  for (const [label, outcome, expected] of cases) {
    await page.evaluate((row) => {
      machtileSingleStationReportState.loading = false;
      machtileBatchState.stationReportSettings = { status: "loaded", machines: { A04: true }, failReasonCodesByMachine: { A04: [] }, error: "" };
      const view = MachTileStationCommandCore.statusView(row, "close", 0);
      machtileFinishCloseSetResult("A04", view);
      machtileRenderStationReportSurfaces();
    }, outcome);
    const result = page.locator("#finishSheet .finish-close-result");
    await result.waitFor({ timeout: 10000 });
    const shown = (await result.innerText()).replace(/\s+/g, " ").trim();
    ok(shown.includes(expected), `${label} → 完工畫面顯示「${expected}」`, shown);
  }
  await page.evaluate(() => {
    const view = MachTileStationCommandCore.statusView({ status: "applied", legacy_snapshot: { ShortQty: 7 } }, "close", 0);
    machtileFinishCloseSetResult("A04", view);
    machtileRenderStationReportSurfaces();
  });
  await mkdir(path.dirname(finishCloseShot), { recursive: true });
  await page.locator("#finishSheet .finish-close-result").scrollIntoViewIfNeeded();
  await page.screenshot({ path: finishCloseShot });
  ok(realErrors(errors).length === 0, "完工結果畫面沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}
}

console.log("\n== 390px：標準完工四情境、claim 成功／失敗／斷網 ==");
{
  const be = makeBackend();
  be.progressRows = [{ process_id: id(304), legacy_output: 208, legacy_fail: 2, pending_output: 0, pending_fail: 0, pending_count: 0, last_report_at: new Date(now).toISOString(), actual_start_at: new Date(now - 3600000).toISOString() }];
  const { context, page, errors } = await newPage(browser, "phone", { backend: be,
    configExtra: 'enableFinishButton: true, enableFinishClose: true, finishCloseMachines: ["A04"], enableStandardFinishFlow: true, standardFinishFlowMachines: ["A04"], stationCommandMachines: ["A04"], enableStationReport: true, stationReportMachines: ["A04"],' });
  await page.evaluate(({ orderId, processId }) => openFinishReport(orderId, { machine: "A04", processId }), { orderId: procs[1].wo, processId: id(304) });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    machtileStationReportState(machtileBatchRow("A04")).close = {
      identity: { orderNo: "XX01202502050012", partNo: "HCG-06-01", indexSn: 5 },
    };
  });
  const scenarios = [
    ["same_class_here", { next_index_sn: 6, next_name: "N6 精銑", class_name: "LATHE", can_claim_here: true, pool_item_id: "pool-next-1", available_qty: 40, plan_qty: 100 }],
    ["other_class", { next_index_sn: 6, next_name: "N6 精銑", class_name: "MILL", can_claim_here: false, pool_item_id: "pool-next-1", available_qty: 40, plan_qty: 100 }],
    ["outsource", { next_index_sn: 6, next_name: "熱處理", class_name: "OUTSOURCE", can_claim_here: false, pool_item_id: null, available_qty: null, plan_qty: null }],
    ["last_step", { next_index_sn: null, next_name: null, class_name: null, can_claim_here: false, pool_item_id: null, available_qty: null, plan_qty: null }],
  ];
  for (const [kind, fields] of scenarios) {
    await page.evaluate(({ kind, fields }) => {
      machtileSingleStationReportState.loading = false;
      machtileBatchState.stationReportSettings = { status: "loaded", machines: { A04: true }, failReasonCodesByMachine: { A04: [] }, error: "" };
      machtileFinishCloseSetResult("A04", MachTileStationCommandCore.statusView({ status: "applied", legacy_snapshot: { next_step: { case: kind, ...fields } } }, "close", 0));
      machtileRenderStationReportSurfaces();
    }, { kind, fields });
    const card = page.locator(`#finishSheet [data-standard-finish-case="${kind}"]`);
    await card.waitFor();
    ok(await card.locator("[data-standard-finish-other]").isVisible(), `${kind} 有「選其他工單」`);
    ok(kind !== "same_class_here" || await card.locator("[data-standard-finish-claim]").isVisible(), `${kind} 主動作正確`);
    ok(fields.available_qty != null || !(await card.innerText()).includes("可做"), `${kind} 沒有數量時不顯示可做／計畫`);
    await card.evaluate((el) => {
      const panel = el.closest(".finish-panel");
      if (panel) panel.scrollTop += el.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16;
    });
    await page.waitForTimeout(50);
    const box = await card.boundingBox();
    ok(Boolean(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844), `${kind} 下一步卡完整位於 390px viewport`, JSON.stringify(box));
    const titleBox = await card.locator("strong").boundingBox();
    const otherBox = await card.locator("[data-standard-finish-other]").boundingBox();
    ok(Boolean(titleBox && otherBox && titleBox.y >= 0 && otherBox.y + otherBox.height <= 844), `${kind} 標題與「選其他工單」都未被 scroll container 裁切`, JSON.stringify({ titleBox, otherBox }));
    const insideClip = (child, clip) => Boolean(child && clip && child.x >= clip.x && child.y >= clip.y
      && child.x + child.width <= clip.x + clip.width && child.y + child.height <= clip.y + clip.height);
    ok(insideClip(titleBox, box) && insideClip(otherBox, box), `${kind} screenshot clip 完整包含標題與「選其他工單」`, JSON.stringify({ clip: box, titleBox, otherBox }));
    await page.screenshot({ path: path.join(outDir, `standard-finish-${kind}-390-r2.png`), clip: box });
    if (kind === "last_step") {
      await page.screenshot({ path: path.join(outDir, "standard-finish-last_step-390-full.png") });
    }
  }

  await page.evaluate(() => {
    config.enableFinishClaimStartCombo = true;
    config.finishClaimStartComboMachines = ["A04"];
    machtileFinishCloseSetResult("A04", MachTileStationCommandCore.statusView({ status: "applied", legacy_snapshot: { next_step: { case: "same_class_here", next_index_sn: 6, next_name: "N6", class_name: "LATHE", can_claim_here: true, pool_item_id: "pool-next-1", available_qty: 40, total_steps: 8 } } }, "close", 0));
    machtileRenderStationReportSurfaces();
  });
  ok(await page.locator("#finishSheet [data-standard-finish-claim-start]").isVisible(), "組合旗標開：顯示【接並開工】");
  ok(await page.locator("#finishSheet [data-standard-finish-claim]").isVisible() && await page.locator("#finishSheet [data-standard-finish-decline]").isVisible(), "組合對話框有【只接，稍後開工】與【不接】");
  ok((await page.locator("#finishSheet .standard-finish-combo").innerText()).includes("共 8 道"), "組合對話框顯示總道數");
  await page.evaluate(() => {
    machtileFinishCloseSetResult("A04", MachTileStationCommandCore.statusView({ status: "applied", legacy_snapshot: { next_step: { case: "same_class_here", next_index_sn: 6, next_name: "N6", class_name: "LATHE", can_claim_here: true, pool_item_id: "pool-next-1", available_qty: 0, total_steps: 8 } } }, "close", 0));
    machtileRenderStationReportSurfaces();
  });
  ok(await page.locator("#finishSheet [data-standard-finish-claim-start]").count() === 0, "X=0：不提供【接並開工】");
  ok((await page.locator("#finishSheet .standard-finish-combo").innerText()).includes("上一道良品數為 0，可接不可報"), "X=0：顯示可接不可報說明");

  await page.evaluate(() => {
    machtileFinishCloseSetResult("A04", MachTileStationCommandCore.statusView({ status: "applied", legacy_snapshot: { next_step: { case: "other_class", next_index_sn: 6, next_name: "N6 精銑", class_name: "MILL", can_claim_here: false, pool_item_id: "pool-next-1", available_qty: 40, plan_qty: 100 } } }, "close", 0));
    machtileRenderStationReportSurfaces();
  });
  await page.locator("#finishSheet [data-standard-finish-other]").click();
  await page.locator("#machtileCardSelection").waitFor();
  ok((await page.locator("#machtileCardSelection").innerText()).includes("待做池"), "作業員『選其他工單』可開啟 pool-only picker");
  ok(await page.locator("#machtileCardSelection [data-card-selection-assigned]").count() === 0, "作業員 picker 不暴露排程編輯清單");
  await page.evaluate(() => machtileCloseCardSelection());
  await page.evaluate(({ orderId, processId }) => openFinishReport(orderId, { machine: "A04", processId }), { orderId: procs[1].wo, processId: id(304) });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    machtileSingleStationReportState.loading = false;
    machtileBatchState.stationReportSettings = { status: "loaded", machines: { A04: true }, failReasonCodesByMachine: { A04: [] }, error: "" };
    machtileStationReportState(machtileBatchRow("A04")).close = { identity: { orderNo: "XX01202502050012", partNo: "HCG-06-01", indexSn: 5 } };
  });

  await page.evaluate(() => {
    machtileFinishCloseSetResult("A04", MachTileStationCommandCore.statusView({ status: "applied", legacy_snapshot: { next_step: { case: "same_class_here", next_index_sn: 6, next_name: "N6 精銑", class_name: "LATHE", can_claim_here: true, pool_item_id: "pool-next-1", available_qty: 40, plan_qty: 100 } } }, "close", 0));
    machtileRenderStationReportSurfaces();
  });
  be.mode = "applied";
  await page.evaluate(() => { selectedOrder = { ...selectedOrder, id: "WRONG-SELECTED-ORDER", drawing: "WRONG-DRAWING" }; });
  await page.locator("#finishSheet [data-standard-finish-claim]").click();
  await page.locator("#finishSheet [data-standard-finish-start]").waitFor({ timeout: 10000 });
  ok(be.submits.at(-1)?.p_command_type === "claim_next" && be.submits.at(-1)?.p_pool_item_id === "pool-next-1"
    && be.submits.at(-1)?.p_expected_order_no === "XX01202502050012" && be.submits.at(-1)?.p_expected_part_no === "HCG-06-01",
  "claim_next payload 使用 close 保存的真實工單與料號，不受 selectedOrder 漂移影響", JSON.stringify(be.submits.at(-1)));
  ok(await page.locator("#finishSheet [data-standard-finish-start]").isVisible(), "claim 成功且 can_start=true 直接顯示開工");

  await page.evaluate(() => {
    window.__standardFinishOriginalLoad = loadFromSupabase;
    window.__standardFinishOriginalCard = machtileCardOrderForMachine;
    window.__standardFinishOriginalDerive = deriveMachines;
    window.__standardFinishOriginalRender = renderAll;
    loadFromSupabase = async () => {};
    machtileCardOrderForMachine = () => ({ id: "OLD-WO", stationStep: 5 });
    deriveMachines = () => {};
    renderAll = () => {};
  });
  await page.locator("#finishSheet [data-standard-finish-start]").click();
  await page.getByText("同步中，請稍後", { exact: true }).waitFor();
  ok(await page.locator("#finishSheet [data-standard-finish-start]").isVisible(), "F3 工單或步序未同步時不開到舊步");
  await page.evaluate(() => {
    loadFromSupabase = window.__standardFinishOriginalLoad;
    machtileCardOrderForMachine = window.__standardFinishOriginalCard;
    deriveMachines = window.__standardFinishOriginalDerive;
    renderAll = window.__standardFinishOriginalRender;
  });

  const failureCases = [
    ["ALREADY_CLAIMED", "ALREADY_CLAIMED DETAIL: {\"claimed_machine_code\":\"A05\"}", "下一道已由 A05 接走，請選其他工單。"],
    ["NOT_ELIGIBLE", "NOT_ELIGIBLE", "這台機不能接這一道，請選其他工單。"],
    ["STALE", "STALE", "下一道資料已更新，請重新完工或選其他工單。"],
    ["CLAIM_NEXT_DISABLED", "CLAIM_NEXT_DISABLED", "接下一道功能尚未開放，請選其他工單。"],
  ];
  for (const [label, serverError, expected] of failureCases) {
    be.submitError = serverError;
    await page.evaluate(() => {
      machtileFinishCloseSetResult("A04", MachTileStationCommandCore.statusView({ status: "applied", legacy_snapshot: { next_step: { case: "same_class_here", next_index_sn: 6, next_name: "N6 精銑", class_name: "LATHE", can_claim_here: true, pool_item_id: "pool-next-1", available_qty: 40, plan_qty: 100 } } }, "close", 0));
      machtileRenderStationReportSurfaces();
    });
    await page.locator("#finishSheet [data-standard-finish-claim]").click();
    await page.locator("#finishSheet .standard-finish-claim-status", { hasText: expected }).waitFor();
    ok((await page.locator("#finishSheet .standard-finish-claim-status").innerText()).trim() === expected, `${label} 白話`, await page.locator("#finishSheet .standard-finish-claim-status").innerText());
    ok(await page.locator("#finishSheet [data-standard-finish-claim]").count() === 0, `${label} 後隱藏接下一道主按鈕`);
  }
  be.submitError = null;
  be.submitRowMode = "wrongUuid";
  await page.evaluate(() => {
    machtileFinishCloseSetResult("A04", MachTileStationCommandCore.statusView({ status: "applied", legacy_snapshot: { next_step: { case: "same_class_here", next_index_sn: 6, next_name: "N6 精銑", class_name: "LATHE", can_claim_here: true, pool_item_id: "pool-next-1", available_qty: 40, plan_qty: 100 } } }, "close", 0));
    machtileRenderStationReportSurfaces();
  });
  await page.locator("#finishSheet [data-standard-finish-claim]").click();
  await page.locator("#finishSheet").getByText("連線中斷，尚未確認是否接單；請重試。").waitFor();
  ok(await page.evaluate(() => machtileStationReportState(machtileBatchRow("A04")).close?.claim?.phase) === "error", "回應驗證失敗不會卡在 pending");
  ok(await page.evaluate(() => machtileStationCmd.pending.A04?.poolItemId) === "pool-next-1", "回應驗證失敗保存 poolItemId 供冪等重試");
  be.submitRowMode = null;
  await page.locator("#finishSheet [data-standard-finish-claim]").click();
  await page.locator("#finishSheet [data-standard-finish-start]").waitFor({ timeout: 10000 });

  be.abortNextSubmit = true;
  await page.evaluate(() => {
    machtileFinishCloseSetResult("A04", MachTileStationCommandCore.statusView({ status: "applied", legacy_snapshot: { next_step: { case: "same_class_here", next_index_sn: 6, next_name: "N6 精銑", class_name: "LATHE", can_claim_here: true, pool_item_id: "pool-next-1", available_qty: 40, plan_qty: 100 } } }, "close", 0));
    machtileRenderStationReportSurfaces();
  });
  await page.locator("#finishSheet [data-standard-finish-claim]").click();
  await page.locator("#finishSheet").getByText("連線中斷，尚未確認是否接單；請重試。").waitFor();
  const firstUuid = be.submits.at(-1).p_command_uuid;
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem("machtile.stationCmdPending.v1"))?.A04?.poolItemId) === "pool-next-1", "refresh 前 pending claim 已保存 poolItemId");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#workOrderGrid .machine-tile-card").length > 0, null, { timeout: 20000 });
  await page.waitForFunction(() => machtileStationCmd.pending.A04?.poolItemId === "pool-next-1", null, { timeout: 20000 });
  ok(await page.evaluate(() => machtileStationCmd.pending.A04?.poolItemId) === "pool-next-1", "refresh 後還原 pending claim 的 poolItemId");
  await page.evaluate(() => machtileStationCmdOpenRetry("A04"));
  await page.locator("#machtileStationCmdSheet [data-station-cmd-confirm]").click();
  await page.waitForTimeout(300);
  ok(be.submits.at(-1).p_command_uuid === firstUuid && be.submits.at(-1).p_pool_item_id === "pool-next-1", "refresh 重試沿用 command_uuid 並保留 poolItemId", JSON.stringify(be.submits.at(-1)));
  const comboAuto = await page.evaluate(async () => {
    const saved = { loadFromSupabase, deriveMachines, renderAll, machtileCardOrderForMachine, machtileStationCmdOpen, machtileStationCmdCanSubmit, machtileStationCmdSubmit };
    loadFromSupabase = async () => {};
    deriveMachines = () => {};
    renderAll = () => {};
    machtileCardOrderForMachine = () => ({ id: "XX01202502050012", stationStep: 6 });
    machtileStationCmdOpen = async () => { machtileStationCmd.sheet = { code: "A04", type: "start", fields: {}, model: {}, dailyStart: { state: "ask" } }; };
    machtileStationCmdCanSubmit = () => true;
    let submitted = 0;
    machtileStationCmdSubmit = async () => { submitted += 1; };
    machtileFinishComboWrite("A04", { intent: "claim-start", stage: "start", orderNo: "XX01202502050012", indexSn: 6 });
    await machtileStandardFinishAutoStart("A04", { orderNo: "XX01202502050012", indexSn: 6 });
    const success = { submitted, dailyStartCleared: machtileStationCmd.sheet.dailyStart === null, state: machtileFinishComboRead().A04?.stage };
    submitted = 0;
    machtileStationReportState(machtileBatchRow("A04")).close = null;
    machtileFinishComboWrite("A04", { intent: "claim-start", stage: "claim", orderNo: "XX01202502050012", indexSn: 6 });
    machtileStandardFinishSetClaimResult("A04", { phase: "applied", claimNext: { orderNo: "XX01202502050012", indexSn: 6, canStart: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const refresh = { submitted, state: machtileFinishComboRead().A04?.stage };
    machtileStationCmdOpen = async () => { throw new Error("START_TEST_FAIL"); };
    machtileFinishComboWrite("A04", { intent: "claim-start", stage: "start", orderNo: "XX01202502050012", indexSn: 6 });
    await machtileStandardFinishAutoStart("A04", { orderNo: "XX01202502050012", indexSn: 6 });
    const failure = machtileFinishComboRead().A04;
    Object.assign(window, saved);
    return { success, refresh, failure };
  });
  ok(comboAuto.success.submitted === 1 && comboAuto.success.dailyStartCleared && comboAuto.success.state === "starting", "接並開工成功路徑：claim applied 後沿用既有 start 提交且只送一次", JSON.stringify(comboAuto));
  ok(comboAuto.refresh.submitted === 1 && comboAuto.refresh.state === "starting", "重新整理後 claim 才 applied：從保存狀態接續 start 且只送一次", JSON.stringify(comboAuto));
  ok(comboAuto.failure.stage === "start-error", "start 失敗：停在 start-error，不自動重送", JSON.stringify(comboAuto));

  const submitsBeforeFlagOff = be.submits.length;
  await page.evaluate(() => {
    config.enableStandardFinishFlow = false;
    machtileFinishCloseSetResult("A04", MachTileStationCommandCore.statusView({ status: "applied", legacy_snapshot: { next_step: { case: "same_class_here", next_index_sn: 6, next_name: "N6 精銑", class_name: "LATHE", can_claim_here: true, pool_item_id: "pool-next-1", available_qty: 40, plan_qty: 100 } } }, "close", 0));
    machtileRenderStationReportSurfaces();
  });
  ok(await page.locator("#finishSheet [data-standard-finish-case]").count() === 0, "旗標關：next_step 不改變既有完工 DOM");
  ok(be.submits.length === submitsBeforeFlagOff, "旗標關：不送 claim_next request");
  ok(realErrors(errors).length === 0, "標準完工畫面沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

await browser.close();
server.close();

const prodHits = blocked.filter((u) => u.includes("muditjubqflrqofbkmav") || u.includes("machtile.com"));
ok(prodHits.length === 0, "沒有任何請求打到正式後端／正式網域", prodHits.join(" "));
console.log(`  (blocked external requests: ${blocked.length}${blocked.length ? " e.g. " + [...new Set(blocked.map((u) => new URL(u).host))].join(",") : ""})`);
console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ""}  (screenshots: ${outDir})`);
process.exit(fail ? 1 : 0);
