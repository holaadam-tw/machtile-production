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
  { n: 33, wo: "XX01202606300001", part: "A37軸蓋", partNo: "A37-02", machine: "B03", step: 3, proc: "銑床加工", qty: 196 },
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
function makeBackend({ tableMissing = false, rpcMissing = false, role = "operator", submitError = null, appUserName = null, dailyStartDone = true, dailyStartFail = false, directMode = "ok" } = {}) {
  const be = {
    tableMissing, rpcMissing, role, submitError, appUserName, dailyStartDone, dailyStartFail,
    reportUpserts: [],        // field_report_upsert 的 body（今日開工等報工）
    directMode,               // outbox 關掉時直接 POST production_reports：ok（回列）／noRow（201 但沒列）／structRejected（結構化欄位被拒）
    directPosts: [],          // 直接 POST production_reports 的 body
    todayRows: dailyStartDone ? [{ process_id: id(304), report_type: "dailyStart", created_at: ago(30), started_at: null, ended_at: ago(30), completed_qty: 0, defect_qty: 0, user_id: users[0].id, operator_ids: [users[0].id] }] : [],
    stationReads: 0,          // 任何對 station_commands 的請求
    submits: [],              // RPC body
    commands: new Map(),      // uuid → row
    mode: "hold",             // 輪詢回覆：hold（pending→claimed）／applied／rejected／expired
    reject: { code: "ORDER_MISMATCH", message: "Manufacture.OrderNO=XX01202509300001 IndexSN=2" },
    abortNextSubmit: false,
    hangSubmit: false,        // 送出的 RPC 不回（測逾時）
    serverSkewMs: 0,          // 伺服器時間＝真實時間－這個值（模擬平板時鐘快）
    procOverride: {},         // 開卡重讀工序時改寫某台的列（例：已離站、沒有料號）
    otherWrites: [],
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
      if (!m) return json(200, []);
      const row = be.commands.get(m[1]);
      if (!row) return json(200, []);
      if (be.mode === "hold") { if (row.status === "pending") { row.status = "claimed"; row.claimed_at = new Date().toISOString(); } }
      else if (be.mode === "applied") { row.status = "applied"; row.applied_at = new Date().toISOString(); }
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
        row = { id: id(9000 + be.commands.size), command_uuid: body.p_command_uuid, command_type: body.p_command_type, machine_code: body.p_machine_code,
          expected_order_no: body.p_expected_order_no, expected_index_sn: body.p_expected_index_sn, requested_at: new Date(Date.now() - be.serverSkewMs).toISOString(), status: "pending", reject_code: null, reject_message: null, applied_at: null };
        be.commands.set(body.p_command_uuid, row);
      }
      if (be.ackLostNextSubmit) { be.ackLostNextSubmit = false; return route.abort("failed"); }   // 伺服器建好了，回覆在路上掉了
      if (be.submitRowMode === "noUuid") { const { command_uuid, ...rest } = row; return json(200, rest); }
      if (be.submitRowMode === "wrongUuid") return json(200, { ...row, command_uuid: "99999999-9999-4999-8999-999999999999" });
      return json(200, row);
    }
    // 開卡時重讀單一工序（id=eq.）
    if (p === "/rest/v1/work_order_processes" && /(^|[?&])id=eq\./.test(q)) {
      be.freshReads = (be.freshReads || 0) + 1;
      const pid = (q.match(/id=eq\.([0-9a-f-]+)/) || [])[1];
      const x = procs.find((k) => id(300 + k.n) === pid);
      if (!x) return json(200, []);
      const o = be.procOverride[x.machine] || {};
      return json(200, [{ id: pid, process_order: o.step ?? x.step, process_name: x.proc, status: o.status || "pending", off_station_at: o.off_station_at ?? null,
        work_orders: { work_order_no: x.wo, part_no: "part_no" in o ? o.part_no : x.partNo, part_name: x.part, status: "in_progress" },
        machines: { machine_code: o.machine || x.machine } }]);
    }
    if (p === "/rest/v1/work_order_processes" && (url.searchParams.get("select") || "").includes("work_orders!inner")) {
      return json(200, procs.map((x) => {
        const c = cards.find((k) => k.work_order_no === x.wo);
        return {
          id: c.current_process_id, tenant_id: T, process_order: x.step, process_name: x.proc, process_type: "cnc", status: "pending",
          off_station_at: null, qty_completed: 0, queue_order: null,
          work_orders: { id: c.id, work_order_no: x.wo, part_no: x.partNo, part_name: x.part, quantity: x.qty, due_date: c.due_date, status: "in_progress" },
          machines: machines.find((m) => m.machine_code === x.machine),
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
    if (p === "/rest/v1/v_work_order_cards") return json(200, cards);
    if (p === "/rest/v1/v_machine_management_cards") return json(200, machines);
    if (p === "/rest/v1/app_users") {
      if (url.searchParams.get("auth_user_id")) return json(200, [{ id: users[0].id, name: be.appUserName || users[0].name }]);
      return json(200, users.map(({ auth, ...u }) => u));
    }
    if (p === "/rest/v1/legacy_station_progress") {
      const m = q.match(/work_order_no=in\.\(([^)]*)\)/);
      const wanted = m ? m[1].split(",").map((s) => s.replace(/"/g, "")) : [];
      return json(200, legacyRows.filter((r) => wanted.includes(r.work_order_no)));
    }
    if (p === "/rest/v1/work_order_processes") {
      const m = q.match(/id=in\.\(([^)]*)\)/);
      if (m && q.includes("actual_start_at")) return json(200, m[1].split(",").map((pid) => ({ id: pid, process_order: procs.find((x) => id(300 + x.n) === pid)?.step || 1, process_type: "cnc", actual_start_at: null })));
      return json(200, []);
    }
    if (p === "/rest/v1/rpc/batch_report_progress") return json(200, []);
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
const gridHtml = (page) => page.evaluate(() => document.getElementById("workOrderGrid").innerHTML.replace(/\s+/g, " ").split("/__baseline/").join("/"));
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return `@${i}: …${a.slice(Math.max(0, i - 80), i + 80)}… vs …${b.slice(Math.max(0, i - 80), i + 80)}…`; };
const sheet = (page) => page.locator("#machtileStationCmdSheet");
const fieldText = async (page, key) => (await sheet(page).locator(`[data-station-cmd-field="${key}"]`).innerText()).trim();

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

// ---------------------------------------------------------------------------------------------
for (const vp of ["desktop", "phone"]) {
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
    ok(await page.locator(".station-cmd-row, [data-station-cmd]").count() === 0, `${W}：旗標關 → 沒有開工／停工按鈕`);
    ok(be.stationReads === 0, `${W}：旗標關 → 完全沒讀 station_commands／沒呼叫 RPC（${be.stationReads}）`);
    if (baselineGrid !== null) { const g = await gridHtml(page); ok(g === baselineGrid, `${W}：旗標關 → Monitor 卡片 HTML 跟 ${baselineRef} 一字不差`, firstDiff(g, baselineGrid)); }
    else { skip++; console.log(`  SKIP ${W}：讀不到 ${baselineRef}，略過一字不差比對`); }
    await page.evaluate(() => openReport("", { machine: "A04" }));
    ok(await page.locator('.report-type-tab[data-report-type="dailyStart"] [data-station-cmd-recordonly]').count() === 0
      && (await page.locator('.report-type-tab[data-report-type="dailyStart"]').innerText()).trim() === "今日開工", `${W}：旗標關 → 報工「今日開工」分頁字樣不變`);
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

    // 2026-10-08 owner「卡片短一點」：開工／停工併進卡片底部那排（明細｜報工｜開工｜停工），中段「舊 MES」區塊拿掉
    ok(await a04.locator(".machine-tile-footer .machine-tile-actions [data-station-cmd]").count() === 2, `${W}：開工／停工在卡片底部按鈕列（.machine-tile-actions）`);
    ok(await a04.locator(".station-cmd-row, [data-station-cmd-row], .station-cmd-label").count() === 0, `${W}：A04 中段「舊 MES 開工 停工」區塊已拿掉`);
    const footerLabels = (await a04.locator(".machine-tile-actions > *").allInnerTexts()).map((t) => t.trim());
    ok(footerLabels.join("｜") === "明細｜報工｜開工｜停工", `${W}：底部順序＝明細｜報工｜開工｜停工`, footerLabels.join("｜"));
    const sizes = await a04.locator(".machine-tile-actions > button").evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { h: Math.round(r.height), font: cs.fontSize, bg: cs.backgroundColor }; }));
    ok(sizes.length === 4 && sizes.every((x) => x.h === sizes[0].h && x.font === sizes[0].font), `${W}：四顆按鈕同一個大小（跟明細／報工一樣）`, JSON.stringify(sizes));
    ok(sizes[2]?.bg === "rgb(21, 128, 61)", `${W}：開工仍是綠色（--green-strong）`, sizes[2]?.bg);
    ok(sizes[3]?.bg === "rgb(180, 35, 24)", `${W}：停工仍是紅色`, sizes[3]?.bg);
    if (vp === "phone") {
      const overflow = await page.evaluate(() => {
        const card = [...document.querySelectorAll("#workOrderGrid .machine-tile-card")].find((c) => c.querySelector("h2")?.textContent.includes("A04"));
        const cr = card.getBoundingClientRect();
        const btns = [...card.querySelectorAll(".machine-tile-actions > *")].map((b) => b.getBoundingClientRect());
        return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, card: card.scrollWidth - card.clientWidth,
          outside: btns.filter((r) => r.left < cr.left - 0.5 || r.right > cr.right + 0.5).length };
      });
      ok(overflow.doc <= 0 && overflow.card <= 0 && overflow.outside === 0, "390：四顆按鈕不會橫向溢出（必要時換第二排）", JSON.stringify(overflow));
    }
    // 跟 main（同樣旗標只開 A04）比：A04 以外的卡片原始 HTML 逐字相同；A04 變矮
    if (baselineAvailable) {
      const bBe = makeBackend();
      const b = await newPage(browser, vp, { backend: bBe, baseline: true, configExtra: 'stationCommandMachines: ["A04"],' });
      const rawCards = (pg) => pg.evaluate(() => [...document.querySelectorAll("#workOrderGrid .machine-tile-card")]
        .map((c) => ({ name: c.querySelector("h2")?.textContent.trim() || "", html: c.outerHTML.split("/__baseline/").join("/") })));
      const mine = await rawCards(page);
      const theirs = await rawCards(b.page);
      const others = mine.filter((c) => !c.name.startsWith("A04"));
      const othersBase = theirs.filter((c) => !c.name.startsWith("A04"));
      ok(others.length > 0 && others.length === othersBase.length && others.every((c, i) => c.html === othersBase[i].html),
        `${W}：A04 以外的 ${others.length} 張卡片原始 HTML 跟 ${baselineRef} 逐字相同（不壓空白）`,
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

    // 單台報工：A04 的「今日開工」分頁標「只記錄（不改舊 MES）」，A01 沒有
    await page.evaluate(() => openReport("", { machine: "A04" }));
    const tabA04 = (await page.locator('.report-type-tab[data-report-type="dailyStart"]').innerText()).replace(/\s+/g, " ");
    ok(tabA04.includes("今日開工") && tabA04.includes("只記錄（不改舊 MES）"), `${W}：A04 報工「今日開工」標只記錄`, tabA04);
    await page.evaluate(() => closeReport());
    await page.evaluate(() => openReport("", { machine: "A01" }));
    ok(await page.locator('.report-type-tab[data-report-type="dailyStart"] [data-station-cmd-recordonly]').count() === 0, `${W}：A01（沒開）報工「今日開工」不加標示`);
    await page.evaluate(() => closeReport());

    ok(be.otherWrites.length === 0, `${W}：除了指令 RPC 沒有任何其他寫入`, be.otherWrites.join(" "));
    ok(realErrors(errors).length === 0, `${W}：沒有 JS 錯誤`, realErrors(errors).join(" | "));
    await context.close();
  }
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
{
  const be = makeBackend({ dailyStartDone: true });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  ok(/^今日已開工/.test(await footerToday(page, "A04")), "卡片底部「今日已開工…」", await footerToday(page, "A04"));
  await cardOf(page, "A04").locator('[data-station-cmd="start"]').click();
  await sheet(page).locator("[data-station-cmd-confirm]:not([disabled])").waitFor({ timeout: 10000 });
  ok(await dailyField(page).count() === 0 && await sheet(page).locator("[data-station-cmd-daily]").count() === 0, "已有今日開工 → 沒有數量欄");
  await sheet(page).locator("[data-station-cmd-confirm]").click();
  await sheet(page).locator('[data-station-cmd-result="pending"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  ok(be.submits.length === 1 && be.reportUpserts.length === 0, `已有今日開工 → 只送開工指令（${be.submits.length}／${be.reportUpserts.length}）`);
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
  // 報工→今日開工：擋第二筆
  await page.evaluate(() => openReport("", { machine: "A04" }));
  await page.locator('.report-type-tab[data-report-type="dailyStart"]').click();
  await page.locator("#machineQty").fill("300");
  await page.evaluate(() => { const box = document.getElementById("machtileOperatorList"); box?.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = i.dataset.mapped === "1"; }); });
  await page.locator("#reportForm button[type=submit].submit-report").click();
  await page.waitForFunction(() => document.getElementById("toast")?.textContent.includes("不用再填"), null, { timeout: 10000 }).catch(() => {});
  ok((await page.locator("#toast").innerText()).trim() === "今日開工已排入待送（數量 208），不用再填", "報工→今日開工：擋下並提示「今日開工已排入待送（數量 208），不用再填」", await page.locator("#toast").innerText());
  ok(!be.reportUpserts.some((b) => b.p_payload?.report_payload?.machine_qty === 300), "報工那筆 300 沒有送出");
  ok(await page.locator("#reportSheet").evaluate((el) => el.classList.contains("is-open")), "報工畫面留著（沒有當成送出成功關掉）");
  await page.evaluate(() => closeReport());
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

console.log("\n== 390px：報工→今日開工送出前重讀伺服器：今天已有 → 擋下「今天已有今日開工紀錄」==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  // 卡片讀的時候還沒有，之後別台平板記了（畫面上的資料是舊的）
  be.todayRows = [{ process_id: id(304), report_type: "dailyStart", created_at: new Date().toISOString(), started_at: null, ended_at: new Date().toISOString(), completed_qty: 0, defect_qty: 0, user_id: users[0].id, operator_ids: [users[0].id] }];
  await page.evaluate(() => openReport("", { machine: "A04" }));
  await page.locator('.report-type-tab[data-report-type="dailyStart"]').click();
  await page.locator("#machineQty").fill("300");
  await page.evaluate(() => { const box = document.getElementById("machtileOperatorList"); box?.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = i.dataset.mapped === "1"; }); });
  await page.locator("#reportForm button[type=submit].submit-report").click();
  await page.waitForFunction(() => document.getElementById("toast")?.textContent.includes("今天已有今日開工紀錄"), null, { timeout: 10000 }).catch(() => {});
  ok((await page.locator("#toast").innerText()).trim() === "今天已有今日開工紀錄", "擋下並提示「今天已有今日開工紀錄」", await page.locator("#toast").innerText());
  ok(be.reportUpserts.length === 0 && be.directPosts.length === 0 && dailyStartRows(be, id(304)).length === 1, "沒有送出第二筆");
  ok(await page.locator("#reportSheet").evaluate((el) => el.classList.contains("is-open")), "報工畫面留著");
  await page.evaluate(() => closeReport());
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

console.log("\n== 390px：報工→今日開工送出前重讀回 5xx → 不送、提示稍後再送 ==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: fastCfg });
  be.todayReadFail = true;
  await page.evaluate(() => openReport("", { machine: "A04" }));
  await page.locator('.report-type-tab[data-report-type="dailyStart"]').click();
  await page.locator("#machineQty").fill("300");
  await page.evaluate(() => { const box = document.getElementById("machtileOperatorList"); box?.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = i.dataset.mapped === "1"; }); });
  await page.locator("#reportForm button[type=submit].submit-report").click();
  await page.waitForFunction(() => document.getElementById("toast")?.textContent.includes("稍後再送"), null, { timeout: 10000 }).catch(() => {});
  ok((await page.locator("#toast").innerText()).trim() === "暫時查不到伺服器今天的紀錄，請稍後再送", "讀不到 → 「暫時查不到伺服器今天的紀錄，請稍後再送」", await page.locator("#toast").innerText());
  ok(be.reportUpserts.length === 0 && be.directPosts.length === 0, "沒有送出");
  await page.evaluate(() => closeReport());
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

console.log("\n== 390px：報工→今日開工分頁照舊自己能送（同一條路、同一個 report_payload 形狀）==");
{
  const be = makeBackend({ dailyStartDone: false });
  const { context, page, errors } = await newPage(browser, "phone", { backend: be, configExtra: 'stationCommandMachines: ["A04"],' });
  await page.evaluate(() => openReport("", { machine: "A01" }));
  await page.locator('.report-type-tab[data-report-type="dailyStart"]').click();
  await page.locator("#machineQty").fill("77");
  await page.evaluate(() => { const box = document.getElementById("machtileOperatorList"); box?.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = i.dataset.mapped === "1"; }); });
  await page.locator("#reportForm button[type=submit].submit-report").click();
  await page.waitForFunction(() => document.getElementById("toast")?.textContent.includes("今日開工"), null, { timeout: 10000 }).catch(() => {});
  ok(be.reportUpserts.length === 1, `報工今日開工送出一次（${be.reportUpserts.length}）`);
  const pl = be.reportUpserts[0]?.p_payload || {};
  ok(pl.report_type === "dailyStart" && pl.process_id === id(301) && pl.report_payload?.machine_qty === 77, "報工今日開工：A01 那道、machine_qty 77", JSON.stringify(pl));
  ok(JSON.stringify(Object.keys(pl.report_payload || {})) === JSON.stringify(["report_type", "work_total_qty", "cycle_time_seconds", "machine_qty", "completed_qty", "defect_qty", "has_program_upload", "overtime_plan", "pm_abnormal", "abnormal_type"]),
    "報工今日開工的 report_payload 欄位＝開工確認卡送的同一組", JSON.stringify(Object.keys(pl.report_payload || {})));
  ok(be.submits.length === 0, "報工今日開工不會送開工指令");
  ok(realErrors(errors).length === 0, "沒有 JS 錯誤", realErrors(errors).join(" | "));
  await context.close();
}

await browser.close();
server.close();

const prodHits = blocked.filter((u) => u.includes("muditjubqflrqofbkmav") || u.includes("machtile.com"));
ok(prodHits.length === 0, "沒有任何請求打到正式後端／正式網域", prodHits.join(" "));
console.log(`  (blocked external requests: ${blocked.length}${blocked.length ? " e.g. " + [...new Set(blocked.map((u) => new URL(u).host))].join(",") : ""})`);
console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ""}  (screenshots: ${outDir})`);
process.exit(fail ? 1 : 0);
