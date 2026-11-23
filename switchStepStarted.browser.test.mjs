// 機台卡片「換道次」第 2 階段（已開工、還沒報工；config.enableSwitchStepStarted）瀏覽器端到端：真的 index.html／app.js，假資料 TEST-*，
// 所有後端請求都由這支腳本攔截（假網域），不會碰任何真的後端。快照用三方共用的合約樣本（fixtures/switch_step_applied_snapshot_samples.json）。
// MACHTILE_PLAYWRIGHT_MODULE=<playwright/index.mjs> node switchStepStarted.browser.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const imported = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = imported.default || imported;
const SAMPLES = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'switch_step_applied_snapshot_samples.json'), 'utf8'));
const fake = 'https://switch-started-fixture.test', id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1), auth = id(901), actor = id(902);
const ORDER_NO = 'TEST-WO-SS';
const keyOf = step => `01|TESTNEED000${step}|TEST-SIM-${step}`;
const STEP_NAME = { 1: '粗車', 2: '車牙', 3: '精車', 4: '研磨' };
const POLL_SELECT = 'command_uuid,command_type,machine_code,pool_item_id,expected_order_no,expected_index_sn,status,requested_at,claimed_at,applied_at,reject_code,reject_message,legacy_snapshot';
const POOL_SELECT = 'source_key,work_order_no,process_order,operation_name,part_no,part_name,quantity,due_date,planned_start,urgency,department_code,eligible_machine_codes,source_status,synced_at';
const ARG_KEYS = ['p_command_uuid', 'p_machine_code', 'p_pool_item_id', 'p_expected_order_no', 'p_expected_index_sn', 'p_target_index_sn', 'p_target_pool_item_id', 'p_expected_part_no', 'p_reason'];
const machineRows = [
  { id: id(103), machine_code: 'A03', name: 'A03', department_name: '車床課', status: 'idle', machine_type: 'lathe', display_order: 1 },
  { id: id(105), machine_code: 'A05', name: 'A05', department_name: '車床課', status: 'running', machine_type: 'lathe', display_order: 2 },
];
const WO_ID = id(201);
const order = { id: WO_ID, work_order_no: ORDER_NO, part_no: 'TEST-PART', part_name: '測試零件', quantity: 50, due_date: '2026-12-20', status: 'in_progress', source_system: 'app_manual', created_by: actor, legacy_mes_source: 'dispatch_pool', external_ref: keyOf(3) };
const procOf = (step, status, machineId = id(105), extra = {}) => ({ id: id(300 + step), tenant_id: tenant, work_order_id: WO_ID, process_order: step, process_name: STEP_NAME[step], process_type: 'cnc', machine_id: machineId, status, qty_completed: 0, qty_defect: 0, off_station_at: null, ...extra });
const poolRow = step => ({ source_key: keyOf(step), work_order_no: ORDER_NO, process_order: step, operation_name: STEP_NAME[step], part_no: 'TEST-PART', part_name: '測試零件', quantity: 50, due_date: '2026-12-20', planned_start: null, urgency: 2, department_code: 'LATHE', eligible_machine_codes: ['A03', 'A05'], source_status: 'pending', synced_at: new Date().toISOString() });
const todayRow = (extra = {}) => ({ process_id: id(303), report_type: 'dailyStart', created_at: new Date().toISOString(), started_at: null, ended_at: new Date().toISOString(), completed_qty: 0, defect_qty: 0, cycle_time_seconds: null, user_id: actor, operator_ids: [actor], ...extra });
const claimNextRow = () => ({ command_uuid: id(777), command_type: 'claim_next', machine_code: 'A05', pool_item_id: keyOf(3), expected_order_no: ORDER_NO, expected_index_sn: 3, status: 'applied', requested_at: '2026-11-14T00:00:00Z', legacy_snapshot: null });

let fx;
const reset = (extra = {}) => { fx = { machines: ['A05'], today: [todayRow()], waiting: [1, 2], history: () => [claimNextRow()], historyMode: 'ok', submitMode: 'accept', submits: [], polls: 0, command: null, onPoll: null, noticeRows: [], ...extra }; };
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
        return route.fulfill({ contentType: 'text/javascript', body: `window.MACHTILE_CONFIG={useSupabase:true,authMode:'strict',tenantId:'${tenant}',useTenantHeaderAuth:true,supabaseUrl:'${fake}',supabaseAnonKey:'fixture-public',oauthEnabled:false,disableServiceWorker:true,enableOutboxSubmit:false,enableProgramUpload:false,enableScheduleContracts:false,enableAccountDelete:false,enableJevTriage:false,enableFaceStatus:false,useHmcWorklistSupabase:false,hmcFixedStagingEnabled:false,dispatchPoolMachines:['A03','A05'],multiStationMachines:[],stationCommandMachines:['A03','A05'],enableSwitchStepStarted:true,switchStepStartedMachines:${JSON.stringify(fx.machines)}};` });
      }
      if (req.method() !== 'GET') { blocked.push(req.url()); return route.abort(); }
      return route.continue();
    }
    if (u.origin !== fake) { blocked.push(req.url()); return route.abort(); }
    const p = u.pathname, select = u.searchParams.get('select') || '';
    if (p === '/rest/v1/rpc/machtile_submit_switch_step_command' && req.method() === 'POST') {
      const raw = req.postData() || '{}'; const body = JSON.parse(raw); fx.submits.push({ body, raw });
      if (fx.submitMode === 'network') return route.abort('failed');
      if (fx.submitMode !== 'accept') return json(400, { code: 'P0001', message: fx.submitMode, details: null, hint: null });
      fx.command = fx.command && fx.command.command_uuid === body.p_command_uuid ? fx.command : { command_uuid: body.p_command_uuid, command_type: 'switch_step', machine_code: body.p_machine_code, pool_item_id: body.p_pool_item_id,
        expected_order_no: body.p_expected_order_no, expected_index_sn: body.p_expected_index_sn, status: 'pending', requested_at: new Date().toISOString(),
        claimed_at: null, applied_at: null, reject_code: null, reject_message: null, legacy_snapshot: null };
      return json(200, fx.command);
    }
    if (p === '/rest/v1/station_commands' && req.method() === 'GET') {
      const uuid = u.searchParams.get('command_uuid');
      if (uuid && select === POLL_SELECT) {
        fx.polls += 1;
        if (fx.command && fx.onPoll) { const apply = fx.onPoll; fx.onPoll = null; apply(); }
        return json(200, fx.command && `eq.${fx.command.command_uuid}` === uuid ? [fx.command] : []);
      }
      if (u.searchParams.get('command_type') === 'in.(claim_next,return_claim,switch_step)') {
        if (fx.historyMode === 'error') return json(500, { code: 'XX000', message: 'fixture: history read failed' });
        return json(200, fx.history());
      }
      if (u.searchParams.get('command_type') === 'eq.switch_step') return json(200, fx.noticeRows);
      return json(200, []);
    }
    if (p === '/rest/v1/rpc/machtile_held_pool_claims') return json(200, []);   // 已開工：雲端 process 是 running → RPC 不回它（真實行為）
    if (p === '/auth/v1/user') return json(200, { id: auth, email: 'user@test.invalid' });
    if (p === '/rest/v1/app_users') return json(200, [{ id: actor, auth_user_id: auth, name: '測試使用者', legacy_user_id: 'TEST-001', role: 'operator', is_active: true }]);
    if (p === '/rest/v1/rpc/machine_department_context') return json(200, { tenant_id: tenant, role: 'operator', all_departments: true, is_bridge: false, department_codes: ['LATHE', 'MILL'] });
    if (p === '/rest/v1/machines' || p === '/rest/v1/v_machine_management_cards') {
      return json(200, p.endsWith('/v_machine_management_cards') ? machineRows.map(({ id, name, ...row }) => ({ ...row, machine_id: id, machine_name: name })) : machineRows);
    }
    const liveProc = procOf(3, 'running');
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
    if (p === '/rest/v1/v_work_order_cards') return json(200, [{ id: order.id, tenant_id: tenant, work_order_no: ORDER_NO, part_name: order.part_name, quantity: order.quantity, due_date: order.due_date, work_order_status: order.status, current_process_id: liveProc.id, current_process_name: liveProc.process_name, current_process_status: 'running', machine_name: 'A05', qty_completed: 0, qty_defect: 0, current_process_off_station: false }]);
    return json(200, []);
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await ready(page);
  return { ctx, page };
}
const cardHtml = (page, code = 'A05') => page.evaluate(code => [...document.querySelectorAll('#workOrderGrid .machine-tile-card')].find(card => card.querySelector('h2')?.textContent.trim().startsWith(code))?.outerHTML || '', code);
const sheet = page => page.locator('#machtileSwitchStartedSheet');
const OPEN = '[data-switch-step-started-open="A05"]';
const openSheet = async page => {
  await page.locator(OPEN).click();
  await page.waitForFunction(() => { const s = machtileSwitchStarted.sheet; return s && !s.loading; }, null, { timeout: 20000 });
};
const pick = async (page, step) => { await sheet(page).locator(`[data-switch-step-started-choice="${keyOf(step)}"]`).click(); };
const confirm = async page => { await sheet(page).locator('[data-switch-step-started-confirm]:not([disabled])').click(); };
const appliedUnpooled = () => { const snap = JSON.parse(JSON.stringify(SAMPLES.planner_source_unpooled_to_pooled)); snap.switch_step.order_no = ORDER_NO;
  fx.command = { ...fx.command, status: 'applied', claimed_at: new Date().toISOString(), applied_at: new Date().toISOString(), legacy_snapshot: { ...snap, cloud_finalize: { old_claim_returned: false, old_process_reset: true, old_item_reopened: false, target_attached: true, target_item_claimed: true, moved_qty: 0 } } }; };

try {
  // ---- 名單：機台不在 switchStepStartedMachines → 不出
  reset({ machines: [] });
  {
    const { ctx, page } = await openApp();
    ok(await page.locator(OPEN).count() === 0, 'A05 not in switchStepStartedMachines: no button');
    await ctx.close();
  }
  // ---- 開工後那筆 0／0 今日開工不算報工 → 按鈕在；有中午報工 → 不出
  reset();
  {
    const { ctx, page } = await openApp();
    ok((await cardHtml(page)).includes('data-switch-step-started-open="A05"'), 'started card with a 0/0 dailyStart row today: 「換道次」 is visible');
    ok(await page.evaluate(() => machtileCardState.todayRows.some(r => r.report_type === 'dailyStart')), 'the dailyStart row really is in the card\'s today rows');
    await ctx.close();
  }
  reset({ today: [todayRow(), todayRow({ report_type: 'noon', completed_qty: 5 })] });
  {
    const { ctx, page } = await openApp();
    ok(await page.locator(OPEN).count() === 0, 'a noon report today (5 pcs): no button');
    await ctx.close();
  }

  // ---- 主流程：開卡（待做池目標）→ 九個參數 → 等結果中其他按鈕鎖住 → applied（source_unpooled）→ 提醒
  reset();
  {
    const { ctx, page } = await openApp();
    ok(await page.locator('#workOrderGrid .machine-report-button:not([disabled])').count() >= 1, 'before the switch: 報工 is enabled on the card');
    await openSheet(page);
    const text = await sheet(page).innerText();
    ok(text.includes(`換道次：${ORDER_NO}`) && text.includes('現在掛的：第 3 道 · 精車（已開工、還沒報工）'), 'sheet: title and the started step');
    ok(text.includes('第 1 道 · 粗車 · 50 件 · 待做池') && text.includes('第 2 道 · 車牙 · 50 件 · 待做池'), 'sheet: pooled targets labeled 待做池');
    ok(!text.includes('研磨'), 'sheet: the unpooled step 4 is not listed (switchStepStartedAllowUnpooled off)');
    ok(await sheet(page).locator('[data-switch-step-started-confirm][disabled]').count() === 1, 'two choices: confirm disabled until one is picked');
    await pick(page, 1);
    ok((await sheet(page).innerText()).includes(`這台現在做的是 ${ORDER_NO} 第 3 道（已開工、還沒報工）。要換成第 1 道嗎？`), 'sheet: the confirm sentence names from / to');
    await confirm(page);
    await page.waitForFunction(() => Boolean(machtileSwitchStarted.pending.A05), null, { timeout: 10000 });
    ok(fx.submits.length === 1 && JSON.stringify(Object.keys(fx.submits[0].body)) === JSON.stringify(ARG_KEYS), 'submit: exactly the nine RPC parameter names, in order');
    const b = fx.submits[0].body;
    ok(b.p_machine_code === 'A05' && b.p_pool_item_id === keyOf(3) && b.p_expected_order_no === ORDER_NO && b.p_expected_index_sn === 3 && b.p_target_index_sn === 1
      && b.p_target_pool_item_id === keyOf(1) && b.p_expected_part_no === 'TEST-PART' && b.p_reason === null, 'submit: values (source key from the claim_next history, since the held RPC skips a running step)');
    await page.locator('#machtileSwitchStartedSheet [data-switch-step-started-close]').click();
    const pendingCard = await cardHtml(page);
    ok(pendingCard.includes('data-switch-step-started-status="pending"') && !pendingCard.includes('data-switch-step-started-open'), 'pending: the card says it is processing, no second button');
    ok(await page.locator('#workOrderGrid .machine-report-button:not([disabled])').count() === 0, 'pending: 報工 is locked');
    ok(await page.evaluate(() => machtileReturnClaimBlockMessage('A05')) === '這台正在「換道次」，等它有結果再操作。', 'pending: other entry points get the switch-step sentence');
    fx.onPoll = appliedUnpooled;
    fx.noticeRows = [];
    await page.waitForFunction(() => !machtileSwitchStarted.pending.A05, null, { timeout: 30000 });
    await page.waitForTimeout(300);
    ok(fx.submits.length === 1, 'never resubmitted');
    const card = await cardHtml(page);
    ok(card.includes('待安排：' + ORDER_NO + ' 第 3 道現在不在任何機台、也不在待做池（A05 換成第 1 道時撤下）。請生管用「設定到這台」重新安排。'), 'applied with source_unpooled=true: the notice is on the card');
    ok(await page.locator('#workOrderGrid .machine-report-button:not([disabled])').count() >= 1, 'after the result: 報工 unlocked');
    // 確認卡重開看結果（在面板關掉後結果仍顯示在卡片；再打開一次 sheet 不會有，這裡直接看提示）
    const toasts = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
    ok(toasts.includes('第 3 道現在不在任何機台、也不在待做池'), 'applied with source_unpooled=true: the toast carries the notice');
    await ctx.close();
  }

  // ---- 送出時斷線 → 不確定 → 用同一筆重送（同一個 uuid、同樣九個參數）
  reset({ submitMode: 'network' });
  {
    const { ctx, page } = await openApp();
    await openSheet(page); await pick(page, 2); await confirm(page);
    await page.waitForFunction(() => machtileSwitchStarted.pending.A05?.unconfirmed === true, null, { timeout: 30000 });
    ok((await sheet(page).innerText()).includes('換道次不確定有沒有送到'), 'network cut: the sheet says it is not sure it was sent');
    fx.submitMode = 'accept';
    await sheet(page).locator('[data-switch-step-started-confirm]').click();   // 「用同一筆重送」
    await page.waitForFunction(() => machtileSwitchStarted.pending.A05?.unconfirmed === false, null, { timeout: 20000 });
    ok(fx.submits.length === 2 && fx.submits[1].raw === fx.submits[0].raw, 'resend: same command_uuid and byte-identical args');
    // 工廠回 OUTCOME_UNKNOWN：說「不確定」、不出按鈕、不送第二筆
    fx.onPoll = () => { fx.command = { ...fx.command, status: 'rejected', claimed_at: new Date().toISOString(), reject_code: 'OUTCOME_UNKNOWN', reject_message: 'fixture' }; };
    await page.waitForFunction(() => !machtileSwitchStarted.pending.A05, null, { timeout: 30000 });
    const card = await cardHtml(page);
    ok(card.includes('換道次結果還不確定。請重新整理，看這台現在掛第幾道；不要重按。') && !card.includes('data-switch-step-started-open'), 'OUTCOME_UNKNOWN: unsure sentence, no button for this step');
    ok(fx.submits.length === 2, 'OUTCOME_UNKNOWN: no new command');
    await ctx.close();
  }

  // ---- 池列鍵的讀取失敗（指令歷史 500）→ 讀取失敗、不能按、不送
  reset({ historyMode: 'error' });
  {
    const { ctx, page } = await openApp();
    await openSheet(page); await pick(page, 1);
    ok((await sheet(page).innerText()).includes('讀取失敗，請再試一次。'), 'history read failed: 讀取失敗，請再試一次');
    ok(await sheet(page).locator('[data-switch-step-started-confirm][disabled]').count() === 1, 'history read failed: confirm disabled');
    ok(fx.submits.length === 0, 'history read failed: nothing sent');
    await ctx.close();
  }

  ok(blocked.length === 0, 'no real backend, no unexpected select, no non-GET local request: ' + blocked.join(','));
  ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
  console.log(`${checks}/${checks} started switch-step browser checks passed`);
} finally {
  await browser.close(); server.close();
}
