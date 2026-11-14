// 機台卡片「換道次（數量一起搬）」第 3 階段（已報過工；config.enableSwitchStepMove）瀏覽器端到端：真的 index.html／app.js，假資料 TEST-*，
// 所有後端請求都由這支腳本攔截（假網域），不會碰任何真的後端。fixture 來自 shadow-r2 工廠實跑；harness 只改身分／數量配合 TEST-WO-1。
// MACHTILE_PLAYWRIGHT_MODULE=<playwright/index.mjs> node switchStepMove.browser.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const imported = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = imported.default || imported;
const FACTORY_SAMPLES = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'switch_step_move_r3_samples.json'), 'utf8'));
const factorySample = (name) => JSON.parse(JSON.stringify(FACTORY_SAMPLES[name].payload));
const SAMPLES = (() => {
  const next = factorySample('preview_p17');
  Object.assign(next.switch_step_preview, { station: 'A05', order_no: 'TEST-WO-1', movable_good: 5, movable_fail: 1, report_count: 2 });
  Object.assign(next.switch_step_preview.target, { reported_good_before: 0, reported_good_after: 5, available: 8, order_qty: 120 });
  next.switch_step_preview.reports = next.switch_step_preview.reports.slice(0, 2);
  next.switch_step_preview.plan_text = next.switch_step_preview.plan_text.slice(0, 3);
  const first = factorySample('preview_p17b'); first.switch_step_preview.order_no = 'TEST-WO-1';
  Object.assign(first.switch_step_preview.target, { reported_good_before: 118, reported_good_after: 123, order_qty: 120, exceeds_order_qty: true, needs_overrun_ack: true });
  const blocked = JSON.parse(JSON.stringify(first)); Object.assign(blocked.switch_step_preview, { ok: false, block_code: 'SWITCH_MOVE_AC01' });
  const applied = factorySample('applied_p2_a05'); Object.assign(applied.switch_step, { order_no: 'TEST-WO-1', to_index_sn: 2, moved_good: 5, moved_fail: 1, moved_qty: 6 });
  return { preview_ok_next_step: next, preview_ok_first_step_overrun: first, preview_blocked_ac01: blocked, applied_moved: applied };
})();
const fake = 'https://switch-move-fixture.test', id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1), auth = id(901), actor = id(902);
const ORDER_NO = 'TEST-WO-1';   // 樣本裡的工單號
const keyOf = step => `01|TESTNEED000${step}|TEST-SIM-${step}`;
const STEP_NAME = { 1: '粗車', 2: '車牙', 3: '精車', 4: '研磨' };
const POLL_SELECT = 'command_uuid,command_type,machine_code,pool_item_id,expected_order_no,expected_index_sn,status,requested_at,claimed_at,applied_at,reject_code,reject_message,legacy_snapshot';
const PREVIEW_SELECT = 'command_uuid,command_type,machine_code,expected_order_no,expected_index_sn,status,requested_at,claimed_at,applied_at,reject_code,reject_message,preview_result';
const POOL_SELECT = 'source_key,work_order_no,process_order,operation_name,part_no,part_name,quantity,due_date,planned_start,urgency,department_code,eligible_machine_codes,source_status,synced_at';
const ARG_KEYS = ['p_command_uuid', 'p_machine_code', 'p_pool_item_id', 'p_expected_order_no', 'p_expected_index_sn', 'p_target_index_sn', 'p_target_pool_item_id', 'p_expected_part_no', 'p_reason',
  'p_expected_moved_good', 'p_expected_moved_fail', 'p_acks', 'p_preview'];
const machineRows = [
  { id: id(103), machine_code: 'A03', name: 'A03', department_name: '車床課', status: 'idle', machine_type: 'lathe', display_order: 1 },
  { id: id(105), machine_code: 'A05', name: 'A05', department_name: '車床課', status: 'running', machine_type: 'lathe', display_order: 2 },
];
const WO_ID = id(201);
const order = { id: WO_ID, work_order_no: ORDER_NO, part_no: 'TEST-PART', part_name: '測試零件', quantity: 120, due_date: '2026-12-20', status: 'in_progress', source_system: 'app_manual', created_by: actor, legacy_mes_source: 'dispatch_pool', external_ref: keyOf(3) };
const procOf = (step, status, machineId = id(105), extra = {}) => ({ id: id(300 + step), tenant_id: tenant, work_order_id: WO_ID, process_order: step, process_name: STEP_NAME[step], process_type: 'cnc', machine_id: machineId, status, qty_completed: 0, qty_defect: 0, off_station_at: null, ...extra });
const poolRow = step => ({ source_key: keyOf(step), work_order_no: ORDER_NO, process_order: step, operation_name: STEP_NAME[step], part_no: 'TEST-PART', part_name: '測試零件', quantity: 120, due_date: '2026-12-20', planned_start: null, urgency: 2, department_code: 'LATHE', eligible_machine_codes: ['A03', 'A05'], source_status: 'pending', synced_at: new Date().toISOString() });
const todayRow = (extra = {}) => ({ process_id: id(303), report_type: 'dailyStart', created_at: new Date().toISOString(), started_at: null, ended_at: new Date().toISOString(), completed_qty: 0, defect_qty: 0, cycle_time_seconds: null, user_id: actor, operator_ids: [actor], ...extra });
const claimNextRow = () => ({ command_uuid: id(777), command_type: 'claim_next', machine_code: 'A05', pool_item_id: keyOf(3), expected_order_no: ORDER_NO, expected_index_sn: 3, status: 'applied', requested_at: '2026-11-14T00:00:00Z', legacy_snapshot: null });

let fx;
const reset = (extra = {}) => { fx = { machines: ['A05'], done: 6, today: [todayRow(), todayRow({ report_type: 'noon', completed_qty: 5, defect_qty: 1 })], waiting: [1, 2], previewSample: 'preview_ok_next_step',
  submitMode: 'accept', submits: [], previews: [], polls: 0, previewPolls: 0, command: null, preview: null, onPoll: null, ...extra }; };
let checks = 0;
const blocked = [], errors = [];
const ok = (value, label) => { assert(value, label); checks++; console.log('PASS ' + label); };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => { if (req.method !== 'GET') { res.writeHead(405); res.end(); return; } const u = new URL(req.url, 'http://localhost'); const file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname))); if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; } try { res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); } catch { res.writeHead(404); res.end(); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

const ready = async page => {
  await page.waitForFunction(() => document.getElementById('dataSourceLabel')?.textContent.includes('Supabase'));
  await page.waitForFunction(() => typeof machtileDeferredLoadState !== 'undefined' && machtileDeferredLoadState.get('card-details')?.status === 'ready'
    && typeof machtileBackgroundLoadPromise !== 'undefined' && typeof machtileDispatchPoolState !== 'undefined' && machtileCardState.todayStatus === 'ok');
  await page.evaluate(() => machtileBackgroundLoadPromise);
  await page.waitForTimeout(200);
};
async function openApp() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  const token = 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ sub: auth, exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: { tenant_id: tenant, role: 'operator' }, role: 'authenticated' })).toString('base64url') + '.test';
  await ctx.addInitScript((token) => {
    sessionStorage.setItem('machtileAuthSession', JSON.stringify({ version: 1, accessToken: token, refreshToken: '', email: 'user@test.invalid', authMethod: 'password', mode: 'session', createdAt: Date.now(), rememberUntil: 0 }));
  }, token);
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.url().startsWith(base)) {
      if (u.pathname === '/config.js') {
        return route.fulfill({ contentType: 'text/javascript', body: `window.MACHTILE_CONFIG={useSupabase:true,authMode:'strict',tenantId:'${tenant}',useTenantHeaderAuth:true,supabaseUrl:'${fake}',supabaseAnonKey:'fixture-public',oauthEnabled:false,disableServiceWorker:true,enableOutboxSubmit:false,enableProgramUpload:false,enableScheduleContracts:false,enableAccountDelete:false,enableJevTriage:false,enableFaceStatus:false,useHmcWorklistSupabase:false,hmcFixedStagingEnabled:false,dispatchPoolMachines:['A03','A05'],multiStationMachines:[],stationCommandMachines:['A03','A05'],enableSwitchStepStarted:true,switchStepStartedMachines:['A05'],enableSwitchStepMove:true,switchStepMoveMachines:${JSON.stringify(fx.machines)}};` });
      }
      if (req.method() !== 'GET') { blocked.push(req.url()); return route.abort(); }
      return route.continue();
    }
    if (u.origin !== fake) { blocked.push(req.url()); return route.abort(); }
    const p = u.pathname, select = u.searchParams.get('select') || '';
    if (p === '/rest/v1/rpc/machtile_submit_switch_step_command' && req.method() === 'POST') {
      const raw = req.postData() || '{}'; const body = JSON.parse(raw);
      if (body.p_preview === true) {
        fx.previews.push({ body, raw });
        fx.preview = { command_uuid: body.p_command_uuid, command_type: 'switch_step_preview', machine_code: body.p_machine_code, expected_order_no: body.p_expected_order_no,
          expected_index_sn: body.p_expected_index_sn, status: 'pending', requested_at: new Date().toISOString(), claimed_at: null, applied_at: null, reject_code: null, reject_message: null, preview_result: null };
        return json(200, fx.preview);
      }
      fx.submits.push({ body, raw });
      if (fx.submitMode === 'network') return route.abort('failed');
      if (fx.submitMode !== 'accept') return json(400, { code: 'P0001', message: fx.submitMode, details: null, hint: null });
      fx.command = fx.command && fx.command.command_uuid === body.p_command_uuid ? fx.command : { command_uuid: body.p_command_uuid, command_type: 'switch_step', machine_code: body.p_machine_code, pool_item_id: body.p_pool_item_id,
        expected_order_no: body.p_expected_order_no, expected_index_sn: body.p_expected_index_sn, status: 'pending', requested_at: new Date().toISOString(),
        claimed_at: null, applied_at: null, reject_code: null, reject_message: null, legacy_snapshot: null };
      return json(200, fx.command);
    }
    if (p === '/rest/v1/station_commands' && req.method() === 'GET') {
      const uuid = u.searchParams.get('command_uuid');
      if (uuid && select === PREVIEW_SELECT) {
        fx.previewPolls += 1;
        // 第一次輪詢就算完（工廠一定回滾，所以只有 preview_result）
        if (fx.preview && fx.preview.status === 'pending') fx.preview = { ...fx.preview, status: 'previewed', claimed_at: new Date().toISOString(), preview_result: SAMPLES[fx.previewSample] };
        return json(200, fx.preview && `eq.${fx.preview.command_uuid}` === uuid ? [fx.preview] : []);
      }
      if (uuid && select === POLL_SELECT) {
        fx.polls += 1;
        if (fx.command && fx.onPoll) { const apply = fx.onPoll; fx.onPoll = null; apply(); }
        return json(200, fx.command && `eq.${fx.command.command_uuid}` === uuid ? [fx.command] : []);
      }
      if (u.searchParams.get('command_type') === 'in.(claim_next,return_claim,switch_step)') return json(200, [claimNextRow()]);
      if (u.searchParams.get('command_type') === 'eq.switch_step') return json(200, []);
      return json(200, []);
    }
    if (p === '/rest/v1/rpc/machtile_held_pool_claims') return json(200, []);
    if (p === '/auth/v1/user') return json(200, { id: auth, email: 'user@test.invalid' });
    if (p === '/rest/v1/app_users') return json(200, [{ id: actor, auth_user_id: auth, name: '測試使用者', legacy_user_id: 'TEST-001', role: 'operator', is_active: true }]);
    if (p === '/rest/v1/rpc/machine_department_context') return json(200, { tenant_id: tenant, role: 'operator', all_departments: true, is_bridge: false, department_codes: ['LATHE', 'MILL'] });
    if (p === '/rest/v1/machines' || p === '/rest/v1/v_machine_management_cards') {
      return json(200, p.endsWith('/v_machine_management_cards') ? machineRows.map(({ id, name, ...row }) => ({ ...row, machine_id: id, machine_name: name })) : machineRows);
    }
    const liveProc = procOf(3, 'running', id(105), { qty_completed: fx.done, qty_defect: fx.done ? 1 : 0 });
    if (p === '/rest/v1/production_reports') {
      if ((u.searchParams.get('report_type') || '') === 'in.(dailyStart,noon,finish)') return json(200, fx.today);
      return json(200, []);
    }
    if (p === '/rest/v1/dispatch_pool_items') {
      if (select === 'source_key,status') return json(200, []);
      if (select !== POOL_SELECT || u.searchParams.get('status') !== 'eq.waiting') { blocked.push('unexpected pool select: ' + u.search); return json(400, {}); }
      return json(200, fx.waiting.map(poolRow));
    }
    if (p === '/rest/v1/work_orders') return json(200, [{ ...order, work_order_processes: [liveProc] }]);
    if (p === '/rest/v1/work_order_processes') {
      if (select.includes('work_orders!inner')) return json(200, [null, `eq.${liveProc.id}`].includes(u.searchParams.get('id')) ? [{ ...liveProc, work_orders: order, machines: machineRows[1] }] : []);
      if (u.searchParams.get('work_order_id') === `eq.${WO_ID}`) return json(200, [procOf(1, 'pending', null), procOf(2, 'pending', null), { ...liveProc, machines: { machine_code: 'A05' } }, procOf(4, 'pending', null)].map(row => ({ ...row, machines: row.machines || null })));
      return json(200, [liveProc]);
    }
    if (p === '/rest/v1/v_work_order_cards') return json(200, [{ id: order.id, tenant_id: tenant, work_order_no: ORDER_NO, part_name: order.part_name, quantity: order.quantity, due_date: order.due_date, work_order_status: order.status, current_process_id: liveProc.id, current_process_name: liveProc.process_name, current_process_status: 'running', machine_name: 'A05', qty_completed: fx.done, qty_defect: fx.done ? 1 : 0, current_process_off_station: false }]);
    return json(200, []);
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await ready(page);
  return { ctx, page };
}
const cardHtml = (page, code = 'A05') => page.evaluate(code => [...document.querySelectorAll('#workOrderGrid .machine-tile-card')].find(card => card.querySelector('h2')?.textContent.trim().startsWith(code))?.outerHTML || '', code);
const sheet = page => page.locator('#machtileSwitchMoveSheet');
const OPEN = '[data-switch-step-move-open="A05"]';
const openSheet = async page => {
  await page.locator(OPEN).click();
  await page.waitForFunction(() => { const s = machtileSwitchMove.sheet; return s && !s.loading; }, null, { timeout: 20000 });
};
const pick = async (page, step) => { await sheet(page).locator(`[data-switch-step-move-choice="${keyOf(step)}"]`).click(); };
const previewTo = async (page, step, phase = 'confirming') => {
  await pick(page, step);
  await sheet(page).locator('[data-switch-step-move-preview]:not([disabled])').click();
  await page.waitForFunction(phase => machtileSwitchMove.sheet?.phase === phase, phase, { timeout: 30000 });
};
const TAIL = '沒有換，這台還是第 3 道，數字沒有變；';
const appliedMoved = () => { const snap = JSON.parse(JSON.stringify(SAMPLES.applied_moved));
  fx.command = { ...fx.command, status: 'applied', claimed_at: new Date().toISOString(), applied_at: new Date().toISOString(), legacy_snapshot: { ...snap, cloud_finalize: { moved_qty: 6 } } }; };

try {
  // ---- 名單：機台不在 switchStepMoveMachines → 不出
  reset({ machines: [] });
  {
    const { ctx, page } = await openApp();
    ok(await page.locator(OPEN).count() === 0, 'A05 not in switchStepMoveMachines: no button');
    await ctx.close();
  }
  // ---- 0 件（只有今日開工 0／0）→ 第 2 階段的按鈕，這一顆不出
  reset({ done: 0, today: [todayRow()] });
  {
    const { ctx, page } = await openApp();
    const card = await cardHtml(page);
    ok(card.includes('data-switch-step-started-open="A05"') && !card.includes('data-switch-step-move-open'), 'zero quantity: phase 2 「換道次」 only');
    await ctx.close();
  }

  // ---- 主流程：已報 → 按鈕 → 預覽（NULL expected）→ 確認卡 → 送出（5／1）→ 鎖住 → applied
  reset();
  {
    const { ctx, page } = await openApp();
    const card = await cardHtml(page);
    ok(card.includes('data-switch-step-move-open="A05"') && !card.includes('data-switch-step-started-open'), 'reported card: 「換道次（數量一起搬）」 only');
    await openSheet(page);
    const text = await sheet(page).innerText();
    ok(text.includes(`換道次（數量一起搬）：${ORDER_NO}`) && text.includes('現在掛的：第 3 道 · 精車（已經報過工）'), 'sheet: title and the reported step');
    ok(text.includes('第 1 道 · 粗車 · 120 件 · 待做池') && text.includes('第 2 道 · 車牙 · 120 件 · 待做池'), 'sheet: pooled targets');
    ok(await sheet(page).locator('[data-switch-step-move-submit]').count() === 0, 'no send button before a preview');
    await previewTo(page, 2);
    ok(fx.previews.length === 1 && JSON.stringify(Object.keys(fx.previews[0].body)) === JSON.stringify(ARG_KEYS), 'preview: the thirteen parameter names in order');
    const pb = fx.previews[0].body;
    ok(pb.p_preview === true && pb.p_expected_moved_good === null && pb.p_expected_moved_fail === null && pb.p_acks === null && pb.p_target_index_sn === 2 && pb.p_pool_item_id === keyOf(3), 'preview: only compute (expected NULL)');
    ok(!(await page.evaluate(() => Boolean(machtileSwitchMove.pending.A05))), 'preview: the machine is not locked');
    const confirmText = await sheet(page).innerText();
    ok(confirmText.includes(`這台目前是 ${ORDER_NO} 第 3 道，已報 良品 5／不良 1（2 筆）。要換成第 2 道，數量一起搬過去嗎？`), 'confirm: good / bad / count / target');
    ok(confirmText.includes('第 2 道換好後：已報 0 → 5（上一道可用 8）') && confirmText.includes('數量規則：第 2 道補報後不能超過上一道良品'), 'confirm: target numbers and the step-2+ rule');
    await sheet(page).locator('[data-switch-step-move-submit]:not([disabled])').click();
    await page.waitForFunction(() => Boolean(machtileSwitchMove.pending.A05), null, { timeout: 10000 });
    const b = fx.submits[0].body;
    ok(fx.submits.length === 1 && JSON.stringify(Object.keys(b)) === JSON.stringify(ARG_KEYS) && b.p_preview === false && b.p_expected_moved_good === 5 && b.p_expected_moved_fail === 1 && b.p_acks === null
      && b.p_command_uuid !== pb.p_command_uuid, 'submit: expected 5 / 1 from the preview, a different uuid than the preview');
    await page.locator('#machtileSwitchMoveSheet [data-switch-step-move-close]').click();
    const pendingCard = await cardHtml(page);
    ok(pendingCard.includes('data-switch-step-move-status="pending"') && !pendingCard.includes('data-switch-step-move-open'), 'pending: the card says it is processing');
    ok(await page.locator('#workOrderGrid .machine-report-button:not([disabled])').count() === 0, 'pending: 報工 is locked');
    ok(await page.evaluate(() => machtileReturnClaimBlockMessage('A05')) === '這台正在「換道次（數量一起搬）」，等它有結果再操作。', 'pending: other entry points get the move sentence');
    fx.onPoll = appliedMoved;
    await page.waitForFunction(() => !machtileSwitchMove.pending.A05, null, { timeout: 30000 });
    await page.waitForTimeout(300);
    const toast = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
    ok(toast.includes('已換成第 2 道，搬了 良品 5／不良 1。第 3 道已改成 0、退回待做池。請按「開工」。'), 'applied: the done sentence with the moved numbers');
    ok(fx.submits.length === 1, 'never resubmitted');
    await ctx.close();
  }

  // ---- 預覽說會被擋（AC01）→ 理由＋「這台還是第 3 道，數字沒有變；請找生管」，沒有送出鍵
  reset({ previewSample: 'preview_blocked_ac01' });
  {
    const { ctx, page } = await openApp();
    await openSheet(page);
    await previewTo(page, 1, 'preview_blocked');
    const text = await sheet(page).innerText();
    ok(text.includes('這幾筆報工從上一道關站餘料領了料（入庫後再領出），系統還不能自動退回。') && text.includes(`${TAIL}請找生管。`), 'blocked preview: reason + unchanged tail');
    ok(await sheet(page).locator('[data-switch-step-move-submit]').count() === 0 && fx.submits.length === 0, 'blocked preview: nothing can be sent');
    await ctx.close();
  }

  // ---- 第一道超過工單量：要勾才可以送，送 acks
  reset({ previewSample: 'preview_ok_first_step_overrun' });
  {
    const { ctx, page } = await openApp();
    await openSheet(page);
    await previewTo(page, 1);
    ok(await sheet(page).locator('[data-switch-step-move-submit][disabled]').count() === 1, 'overrun: send disabled until ticked');
    await sheet(page).locator('[data-switch-step-move-overrun]').check();
    await page.waitForFunction(() => machtileSwitchMove.sheet?.overrunChecked === true);
    await sheet(page).locator('[data-switch-step-move-submit]:not([disabled])').click();
    await page.waitForFunction(() => Boolean(machtileSwitchMove.pending.A05), null, { timeout: 10000 });
    ok(JSON.stringify(fx.submits[0].body.p_acks) === '["EXCEEDS_ORDER_QTY"]' && fx.submits[0].body.p_expected_moved_good === 5, 'overrun: acks sent with the move');
    // 工廠回 OUTCOME_UNKNOWN：只說不確定、這一道不再出按鈕
    fx.onPoll = () => { fx.command = { ...fx.command, status: 'rejected', claimed_at: new Date().toISOString(), reject_code: 'OUTCOME_UNKNOWN', reject_message: 'fixture' }; };
    await page.waitForFunction(() => !machtileSwitchMove.pending.A05, null, { timeout: 30000 });
    await page.locator('#machtileSwitchMoveSheet [data-switch-step-move-close]').click();
    const card = await cardHtml(page);
    ok(card.includes('結果不確定，請重新整理看這台掛第幾道、數字是多少；不要重按。') && !card.includes('data-switch-step-move-open') && !card.includes('沒有換'), 'OUTCOME_UNKNOWN: unsure, no button, never "not switched"');
    ok(fx.submits.length === 1, 'OUTCOME_UNKNOWN: no new command');
    await ctx.close();
  }

  // ---- 工廠擋（數量剛剛變了）→ 重新看一次
  reset();
  {
    const { ctx, page } = await openApp();
    await openSheet(page);
    await previewTo(page, 2);
    await sheet(page).locator('[data-switch-step-move-submit]:not([disabled])').click();
    await page.waitForFunction(() => Boolean(machtileSwitchMove.pending.A05), null, { timeout: 10000 });
    fx.onPoll = () => { fx.command = { ...fx.command, status: 'rejected', claimed_at: new Date().toISOString(), reject_code: 'SWITCH_MOVE_QTY_CHANGED', reject_message: 'fixture' }; };
    await page.waitForFunction(() => machtileSwitchMove.sheet?.phase === 'rejected', null, { timeout: 30000 });
    const text = await sheet(page).innerText();
    ok(text.includes('第 3 道的數量剛剛變了（有人報工或修正），跟剛剛看到的不一樣。') && text.includes(`${TAIL}請重新打開「換道次（數量一起搬）」再看一次會怎麼搬。`), 'QTY_CHANGED: look again, unchanged tail');
    ok(!(await page.evaluate(() => Boolean(machtileSwitchMove.pending.A05))), 'QTY_CHANGED: nothing left locked');
    await ctx.close();
  }

  ok(blocked.length === 0, 'no real backend, no unexpected select, no non-GET local request: ' + blocked.join(','));
  ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
  console.log(`${checks}/${checks} move switch-step browser checks passed`);
} finally {
  await browser.close(); server.close();
}
