// 機台卡片「換道次」瀏覽器端到端：真的 index.html／app.js，假資料 TEST-*，
// 所有後端請求都由這支腳本攔截（假網域），不會碰任何真的後端。
// MACHTILE_PLAYWRIGHT_MODULE=<playwright/index.mjs> node switchStep.browser.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const imported = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = imported.default || imported;
const fake = 'https://switch-step-fixture.test', id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1), auth = id(901), actor = id(902);
const ORDER_NO = 'TEST-WO-SW';
const keyOf = step => `01|TESTNEED000${step}|TEST-SIM-${step}`;
const STEP_NAME = { 1: '粗車', 2: '車牙', 3: '精車' };
const CONTRACT_SELECT = 'command_uuid,command_type,machine_code,pool_item_id,expected_order_no,expected_index_sn,status,requested_at,claimed_at,applied_at,reject_code,reject_message,legacy_snapshot';
const POOL_SELECT = 'source_key,work_order_no,process_order,operation_name,part_no,part_name,quantity,due_date,planned_start,urgency,department_code,eligible_machine_codes,source_status,synced_at';
const machineRows = [
  { id: id(103), machine_code: 'A03', name: 'A03', department_name: '車床課', status: 'idle', machine_type: 'lathe', display_order: 1 },
  { id: id(105), machine_code: 'A05', name: 'A05', department_name: '車床課', status: 'idle', machine_type: 'lathe', display_order: 2 },
];
// 雲端的 work_orders.external_ref＝這張工單第一次被接的那個池列（dispatch_pool_claim 的 on conflict 不更新它）：這裡＝第 3 道
const orderBase = { id: id(201), work_order_no: ORDER_NO, part_no: 'TEST-PART', part_name: '測試零件', quantity: 50, due_date: '2026-12-20', status: 'in_progress', source_system: 'app_manual', created_by: actor, legacy_mes_source: 'dispatch_pool', external_ref: keyOf(3) };
const procOf = (step, status) => ({ id: id(300 + step), tenant_id: tenant, work_order_id: id(201), process_order: step, process_name: STEP_NAME[step], process_type: 'cnc', machine_id: id(105), status, qty_completed: 0, qty_defect: 0 });
const poolRow = step => ({ source_key: keyOf(step), work_order_no: ORDER_NO, process_order: step, operation_name: STEP_NAME[step], part_no: 'TEST-PART', part_name: '測試零件', quantity: 50, due_date: '2026-12-20', planned_start: null, urgency: 2, department_code: 'LATHE', eligible_machine_codes: ['A03', 'A05'], source_status: 'pending', synced_at: new Date().toISOString() });
const otherOrderRow = { ...poolRow(1), source_key: '01|TESTNEED0009|TEST-SIM-9', work_order_no: 'TEST-WO-OTHER' };

// 每個情境重設的假後端狀態。held＝A05 上掛的是第幾道（null＝沒有）；waiting＝待做池裡這張單 waiting 的道次
let fx;
const reset = (extra = {}) => { fx = { returnFlag: true, flag: undefined, role: 'operator', held: 3, procStatus: 'pending', waiting: [1, 2], eligible: null, submitMode: 'accept', claimMode: 'accept', submits: [], claims: [], polls: [], poolReads: 0, events: [], command: null, afterPolls: null,
  // firstClaimed＝work_orders.external_ref 指的那一道（這張工單第一次被接的；雲端不會更新它）；
  // 機台上這一道的池列鍵＝唯讀 RPC machtile_held_pool_claims()（接單帳本）。heldRows＝它回的列（null＝A05 上掛的那一道一列）；
  // heldMode＝rows｜missing（正式環境還沒套 migration：404 PGRST202）｜error（500）；heldCalls＝App 叫了幾次、怎麼叫；
  // heldPoolStatus＝機台上那一道的池列狀態：gone（Factory 已確認接單，正式環境的實況；RLS 不給 App 讀）｜claimed（還沒確認）
  firstClaimed: 3, heldRows: null, heldMode: 'rows', heldCalls: [], heldPoolStatus: 'gone',
  // poolHang＝待做池清單的讀取不回應；claimMode 'hang'＝接單請求不回應；afterClaim＝接單成功之後第一次重讀畫面（v_work_order_cards）：'fail'＝500、'hang'＝不回應（都只一次）
  poolHang: false, afterClaim: null, cardReadsAfterClaim: 0, ...extra }; };
// 不回應的請求先留著，情境結束時放掉（不會真的連到任何地方）
const hung = [];
const hang = route => new Promise(resolve => { hung.push(() => { route.abort('failed').catch(() => {}); resolve(); }); });
const releaseHung = () => { while (hung.length) hung.pop()(); };
const tokenFor = (sub, role) => 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: { tenant_id: tenant, role }, role: 'authenticated' })).toString('base64url') + '.test';
const HELD_RPC = '/rest/v1/rpc/machtile_held_pool_claims';
const claimedRow = (step, extra = {}) => ({ machine_code: 'A05', work_order_no: ORDER_NO, process_order: step, source_key: keyOf(step), claimed_at: '2026-11-13T01:00:00+00:00', ...extra });
const applyReturn = () => { const returned = fx.held || 3; fx.held = null; if (!fx.waiting.includes(returned)) fx.waiting.push(returned); fx.command = { ...fx.command, status: 'applied', claimed_at: new Date().toISOString(), applied_at: new Date().toISOString(), legacy_snapshot: { return_claim: { mode: 'unassigned', pool_status: 'returned', station_cleared: true }, cloud_finalize: { claim_returned: true, process_detached: true, item_reopened: true } } }; };
let checks = 0;
const blocked = [], errors = [], writes = [], poolClaimedSelects = [];
const ok = (value, label) => { assert(value, label); checks++; console.log('PASS ' + label); };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => { if (req.method !== 'GET') { res.writeHead(405); res.end(); return; } const u = new URL(req.url, 'http://localhost'); const file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname))); if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; } try { res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); } catch { res.writeHead(404); res.end(); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

const ready = async page => {
  await page.waitForFunction(() => document.getElementById('dataSourceLabel')?.textContent.includes('Supabase'));
  await page.waitForFunction(() => typeof machtileDeferredLoadState !== 'undefined' && machtileDeferredLoadState.get('card-details')?.status === 'ready'
    && typeof machtileStationCmd !== 'undefined' && ['ready', 'missing', 'off'].includes(machtileStationCmd.availability)
    && typeof machtileBackgroundLoadPromise !== 'undefined' && typeof machtileDispatchPoolState !== 'undefined');
  await page.evaluate(() => machtileBackgroundLoadPromise);
  await page.waitForFunction(() => machtileDispatchPoolState.status === 'ready');
  await page.waitForTimeout(200);
};
async function openApp(language = 'zh-Hant') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  const token = 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ sub: auth, exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: { tenant_id: tenant, role: fx.role }, role: 'authenticated' })).toString('base64url') + '.test';
  await ctx.addInitScript(([token, language]) => {
    sessionStorage.setItem('machtileAuthSession', JSON.stringify({ version: 1, accessToken: token, refreshToken: '', email: 'user@test.invalid', authMethod: 'password', mode: 'session', createdAt: Date.now(), rememberUntil: 0 }));
    if (language !== 'zh-Hant') localStorage.setItem('machtile.language', language);
  }, [token, language]);
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.url().startsWith(base)) {
      if (u.pathname === '/config.js') {
        const flags = `${fx.returnFlag === undefined ? '' : `,enableReturnClaim:${JSON.stringify(fx.returnFlag)}`}${fx.flag === undefined ? '' : `,enableSwitchStep:${JSON.stringify(fx.flag)}`}`;
        return route.fulfill({ contentType: 'text/javascript', body: `window.MACHTILE_CONFIG={useSupabase:true,authMode:'strict',tenantId:'${tenant}',useTenantHeaderAuth:true,supabaseUrl:'${fake}',supabaseAnonKey:'fixture-public',oauthEnabled:false,disableServiceWorker:true,enableOutboxSubmit:false,enableProgramUpload:false,enableScheduleContracts:false,enableAccountDelete:false,enableJevTriage:false,enableFaceStatus:false,useHmcWorklistSupabase:false,hmcFixedStagingEnabled:false,dispatchPoolMachines:['A03','A05'],multiStationMachines:[],stationCommandMachines:['A03','A05']${flags}};` });
      }
      if (req.method() !== 'GET') { blocked.push(req.url()); return route.abort(); }
      return route.continue();
    }
    if (u.origin !== fake) { blocked.push(req.url()); return route.abort(); }
    const p = u.pathname;
    if (p === '/rest/v1/rpc/machtile_submit_return_claim_command' && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}'); fx.submits.push(body); writes.push(p); fx.events.push('return_submit');
      if (fx.submitMode === 'network') return route.abort('failed');
      if (fx.submitMode !== 'accept') return json(400, { code: 'P0001', message: fx.submitMode, details: null, hint: null });
      fx.command = { command_uuid: body.p_command_uuid, command_type: 'return_claim', machine_code: body.p_machine_code, pool_item_id: body.p_pool_item_id,
        expected_order_no: body.p_expected_order_no, expected_index_sn: body.p_expected_index_sn, status: 'pending', requested_at: new Date().toISOString(),
        claimed_at: null, applied_at: null, reject_code: null, reject_message: null, legacy_snapshot: null };
      return json(200, fx.command);
    }
    if (p === '/rest/v1/rpc/dispatch_pool_claim' && req.method() === 'POST') {
      const raw = req.postData() || ''; const body = JSON.parse(raw || '{}');
      fx.claims.push({ url: req.url(), method: req.method(), raw, contentType: req.headers()['content-type'] || '' }); writes.push(p); fx.events.push('claim');
      if (fx.claimMode === 'hang') return hang(route);
      if (fx.claimMode !== 'accept') return json(400, { code: 'P0001', message: fx.claimMode, details: null, hint: null });
      const step = [1, 2, 3].find(n => keyOf(n) === body.p_source_key);
      fx.held = step; fx.waiting = fx.waiting.filter(n => n !== step);
      return json(200, { process_id: id(300 + step) });
    }
    if (p === '/rest/v1/station_commands' && req.method() === 'GET') {
      const uuid = u.searchParams.get('command_uuid');
      if (!uuid || !u.searchParams.get('select')?.includes('pool_item_id')) return json(200, []);
      fx.polls.push({ select: u.searchParams.get('select'), uuid });
      if (fx.command && fx.afterPolls && fx.polls.length >= fx.afterPolls.count) { const apply = fx.afterPolls.apply; fx.afterPolls = null; apply(); fx.events.push('return_result'); }
      return json(200, fx.command && `eq.${fx.command.command_uuid}` === uuid ? [fx.command] : []);
    }
    if (p === HELD_RPC) {
      // 唯讀 RPC：不帶參數的 POST；不算寫入
      fx.heldCalls.push({ method: req.method(), body: req.postData(), query: u.search });
      if (fx.heldMode === 'missing') return json(404, { code: 'PGRST202', details: null, hint: null, message: 'Could not find the function public.machtile_held_pool_claims without parameters in the schema cache' });
      if (fx.heldMode === 'error') return json(500, { code: 'XX000', message: 'boom' });
      return json(200, fx.heldRows ? fx.heldRows() : (fx.held ? [claimedRow(fx.held)] : []));
    }
    if (req.method() !== 'GET' && !['/rest/v1/rpc/batch_report_progress', '/rest/v1/rpc/machine_department_context'].includes(p) && !/_snapshot$|_list$/.test(p)) writes.push(p);
    if (p === '/auth/v1/user') return json(200, { id: auth, email: 'user@test.invalid' });
    if (p === '/rest/v1/app_users') return json(200, [{ id: actor, auth_user_id: auth, name: '測試使用者', legacy_user_id: 'TEST-001', role: fx.role, is_active: true }]);
    if (p === '/rest/v1/rpc/machine_department_context') return json(200, { tenant_id: tenant, role: fx.role, all_departments: true, is_bridge: false, department_codes: ['LATHE', 'MILL'] });
    if (p === '/rest/v1/machines' || p === '/rest/v1/v_machine_management_cards') {
      return json(200, p.endsWith('/v_machine_management_cards') ? machineRows.map(({ id, name, ...row }) => ({ ...row, machine_id: id, machine_name: name })) : machineRows);
    }
    const liveProc = fx.held ? procOf(fx.held, fx.procStatus) : null;
    const order = { ...orderBase, external_ref: keyOf(fx.firstClaimed) };
    if (p === '/rest/v1/dispatch_pool_items') {
      const select = u.searchParams.get('select') || '';
      // 卡片明細：工單 external_ref 那個池列現在的狀態（退回後＝waiting；掛在機台上＝heldPoolStatus，gone 的列 RLS 不給讀＝查不到）
      if (select === 'source_key,status') {
        const status = fx.waiting.includes(fx.firstClaimed) && fx.held !== fx.firstClaimed ? 'waiting' : fx.heldPoolStatus;
        return json(200, ['waiting', 'claimed'].includes(status) ? [{ source_key: keyOf(fx.firstClaimed), status }] : []);
      }
      if ((u.searchParams.get('status') || '') === 'eq.claimed') poolClaimedSelects.push(u.search);   // 舊的 claimed 列查詢：不可以再出現（下面會被當成 unexpected pool select）
      if (select !== POOL_SELECT || u.searchParams.get('status') !== 'eq.waiting') { blocked.push('unexpected pool select: ' + u.search); return json(400, {}); }
      fx.poolReads += 1; fx.events.push('pool_read');
      if (fx.poolHang) return hang(route);
      return json(200, [...fx.waiting.map(step => ({ ...poolRow(step), ...(fx.eligible ? { eligible_machine_codes: fx.eligible } : {}) })), otherOrderRow]);
    }
    if (p === '/rest/v1/work_orders') return json(200, liveProc ? [{ ...order, work_order_processes: [liveProc] }] : []);
    if (p === '/rest/v1/work_order_processes') {
      if (!liveProc) return json(200, []);
      if ((u.searchParams.get('select') || '').includes('work_orders!inner')) return json(200, [null, `eq.${liveProc.id}`].includes(u.searchParams.get('id')) ? [{ ...liveProc, off_station_at: null, work_orders: order, machines: machineRows[1] }] : []);
      return json(200, [liveProc]);
    }
    if (p === '/rest/v1/v_work_order_cards' && fx.claims.length && fx.claimMode === 'accept') {
      fx.cardReadsAfterClaim += 1;
      const mode = fx.afterClaim; fx.afterClaim = null;
      if (mode === 'fail') return json(500, { message: 'fixture: reload failed' });
      if (mode === 'hang') return hang(route);
    }
    if (p === '/rest/v1/v_work_order_cards') return json(200, liveProc ? [{ id: order.id, tenant_id: tenant, work_order_no: order.work_order_no, part_name: order.part_name, quantity: order.quantity, due_date: order.due_date, work_order_status: order.status, current_process_id: liveProc.id, current_process_name: liveProc.process_name, current_process_status: fx.procStatus, machine_name: 'A05', qty_completed: 0, qty_defect: 0, current_process_off_station: false }] : []);
    return json(200, []);
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await ready(page);
  return { ctx, page };
}
const cardHtml = (page, code = 'A05') => page.evaluate(code => [...document.querySelectorAll('#workOrderGrid .machine-tile-card')].find(card => card.querySelector('h2')?.textContent.trim().startsWith(code))?.outerHTML || '', code);
const sheet = page => page.locator('#machtileReturnClaimSheet');
const toastText = page => page.evaluate(() => document.getElementById('toast')?.textContent || '');
const RETURN_BUTTON = '<button type="button" class="card-select-entry pool-return-action" data-no-detail="" data-return-claim-open="A05">接錯了，退回</button>';
const SWITCH_BUTTON = '<button type="button" class="card-select-entry pool-return-action" data-no-detail="" data-switch-step-open="A05">換道次</button>';
const SWITCH_BUSY = '這台正在「換道次」，等它有結果再操作。';
// 開確認卡 → 選第 step 道 → 按「換成第 step 道」
const startSwitch = async (page, step, reason) => {
  await page.locator('[data-switch-step-open="A05"]').click();
  await page.waitForSelector('#machtileReturnClaimSheet [data-switch-step-choices]');
  await sheet(page).locator(`[data-switch-step-choice-step="${step}"]`).click();
  if (reason) await sheet(page).locator('[data-return-claim-reason]').fill(reason);
  await sheet(page).locator('[data-switch-step-confirm]:not([disabled])').click();
};

try {
  // ---- 旗標：關（沒設、false、非布林，或退回功能沒開）＝卡片 HTML 逐字相同
  reset({ returnFlag: undefined }); const none = await openApp(); const htmlNone = await cardHtml(none.page); await none.ctx.close();
  ok(fx.heldCalls.length === 0, 'both flags missing: the held-claims RPC is never requested');
  reset(); const returnOnly = await openApp(); const htmlReturnOnly = await cardHtml(returnOnly.page); await returnOnly.ctx.close();
  ok(htmlNone.includes(ORDER_NO) && htmlNone.includes('N3 精車') && !htmlNone.includes('data-return-claim-open') && !htmlNone.includes('switch-step'), 'both flags missing: A05 shows the claimed step 3 and neither button');
  ok(htmlReturnOnly.replace(RETURN_BUTTON, '') === htmlNone && htmlReturnOnly.split(RETURN_BUTTON).length === 2, 'return-claim on, switch flag missing: only 「接錯了，退回」 is added (the build before this change)');
  for (const flag of [false, 'true', 1]) {
    reset({ flag });
    const { ctx, page } = await openApp();
    ok(await cardHtml(page) === htmlReturnOnly, `enableSwitchStep=${JSON.stringify(flag)}: card HTML byte-identical to the return-claim-only build`);
    ok(await page.locator('[data-switch-step-open], [data-switch-step-status]').count() === 0, `enableSwitchStep=${JSON.stringify(flag)}: no switch-step element anywhere`);
    if (flag === false) {
      ok(await page.evaluate(async () => { await machtileReturnClaimOpen('A05', null, true); return document.getElementById('machtileReturnClaimSheet') === null && machtileSwitchStepEnabled() === false && Object.keys(machtileSwitchStep.active).length === 0; }), 'flag off: asking for a switch sheet directly opens nothing');
      // 旗標關時，「接錯了，退回」的確認卡跟以前一樣（沒有任何換道次的東西）
      await page.locator('[data-return-claim-open="A05"]').click();
      await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-confirm]:not([disabled])'));
      const html = await sheet(page).innerHTML();
      ok(html.includes('確認退回這張單') && !html.includes('switch-step') && !html.includes('換道次'), 'flag off: the return sheet is the plain return sheet');
      await sheet(page).locator('[data-return-claim-close]').click();
    }
    await ctx.close();
  }
  reset({ returnFlag: false, flag: true });
  {
    const { ctx, page } = await openApp();
    ok(await cardHtml(page) === htmlNone, 'enableSwitchStep=true but enableReturnClaim off: card HTML byte-identical to both-flags-off (the flag has no effect on its own)');
    await ctx.close();
  }

  // ---- 一般接單送出的請求（比對基準）：空的 A05 從待做池接第 1 道
  let normalClaim;
  reset({ held: null, waiting: [1, 2, 3] });
  {
    const { ctx, page } = await openApp();
    await page.locator('[data-card-pool-open="A05"]').click();
    await page.waitForSelector(`#machtileCardSelection [data-pool-claim="${keyOf(1)}"]:not([disabled])`);
    await page.locator(`#machtileCardSelection [data-pool-claim="${keyOf(1)}"]`).click();
    await page.waitForFunction(order => [...document.querySelectorAll('#workOrderGrid .machine-tile-card')].some(card => card.querySelector('h2')?.textContent.trim().startsWith('A05') && card.innerHTML.includes(order)), ORDER_NO);
    normalClaim = fx.claims[0];
    ok(fx.claims.length === 1 && normalClaim.raw === JSON.stringify({ p_source_key: keyOf(1), p_machine_code: 'A05' }), 'baseline: a normal claim from the pool panel posts { p_source_key, p_machine_code }: ' + normalClaim.raw);
    await ctx.close();
  }

  // ---- 顯示條件：待做池裡要有同一張工單、這台可以接的其他道
  reset({ flag: true });
  {
    const { ctx, page } = await openApp();
    const html = await cardHtml(page);
    ok(html.split(RETURN_BUTTON + SWITCH_BUTTON).length === 2, 'flag on: 「換道次」 is right next to 「接錯了，退回」, once');
    ok(html.replace(SWITCH_BUTTON, '') === htmlReturnOnly, 'flag on: apart from that one button the card HTML is byte-identical to the return-claim-only build');
    ok(await page.locator('.machine-tile-card [data-switch-step-open]').count() === 1, 'flag on: only the card that holds a pool-claimed job has the button (empty A03 has none)');
    await ctx.close();
  }
  for (const [label, extra] of [['only the current step is in the pool', { waiting: [] }], ['the other steps are not eligible for this machine', { eligible: ['A03'] }], ['process already running', { procStatus: 'running' }], ['manager role', { role: 'manager' }]]) {
    reset({ flag: true, ...extra });
    const { ctx, page } = await openApp();
    ok((await cardHtml(page)).includes(ORDER_NO) && await page.locator('[data-switch-step-open]').count() === 0, `button hidden: ${label}`);
    await ctx.close();
  }

  // ---- 正常路徑（A05 掛第 3 道，現場要做第 1 道）
  reset({ flag: true });
  {
    const { ctx, page } = await openApp();
    await page.locator('[data-switch-step-open="A05"]').click();
    await page.waitForSelector('#machtileReturnClaimSheet [data-switch-step-choices]');
    const text = await sheet(page).innerText();
    ok(text.includes(`換道次：${ORDER_NO} · TEST-PART 測試零件`), 'sheet title: order no · part no / name');
    ok(text.includes('現在掛的：第 3 道 · 精車'), 'sheet: the step the machine holds now');
    ok(text.includes('第 1 道 · 粗車 · 50 件') && text.includes('第 2 道 · 車牙 · 50 件') && await sheet(page).locator('[data-switch-step-choice]').count() === 2 && !text.includes('TEST-WO-OTHER'), 'sheet: the other steps of this order in the pool (step · name · quantity), nothing from another order');
    ok(text.includes('現在這一道（第 3 道）會退回待做池，別人可以再接。') && text.includes('你選的那一道會掛到這台機台。') && text.includes('不會報工，也不會記任何數量。'), 'sheet: plain-language explanation');
    ok(await sheet(page).locator('[data-switch-step-confirm]').isDisabled() && await sheet(page).locator('[data-return-claim-confirm]').count() === 1 && await sheet(page).locator('[data-return-claim-reason]').count() === 0, 'sheet: one confirm button, disabled until a step is chosen; operator has no reason field');
    await sheet(page).locator('[data-switch-step-choice-step="2"]').click();
    ok((await sheet(page).locator('[data-switch-step-confirm]').innerText()).trim() === '換成第 2 道', 'choosing step 2: the button says 換成第 2 道');
    await sheet(page).locator('[data-switch-step-choice-step="1"]').click();
    ok((await sheet(page).locator('[data-switch-step-confirm]').innerText()).trim() === '換成第 1 道' && await sheet(page).locator('[data-switch-step-choice][aria-checked="true"]').count() === 1, 'choosing step 1: the button says 換成第 1 道; one choice selected');
    await sheet(page).locator('[data-return-claim-close]').click();
    ok(await sheet(page).count() === 0 && fx.submits.length === 0 && fx.claims.length === 0, 'cancel: sheet closes and nothing is sent');

    fx.afterPolls = { count: 2, apply: applyReturn };
    fx.events.length = 0;
    await startSwitch(page, 1);
    await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-return-claim-status="pending"]'));
    const sent = fx.submits[0];
    ok(fx.submits.length === 1 && JSON.stringify(Object.keys(sent)) === JSON.stringify(['p_command_uuid', 'p_machine_code', 'p_pool_item_id', 'p_expected_order_no', 'p_expected_index_sn', 'p_expected_part_no', 'p_reason']), 'step (a): one return_claim submit with exactly the seven contract parameters');
    ok(/^[0-9a-f-]{36}$/.test(sent.p_command_uuid) && sent.p_machine_code === 'A05' && sent.p_pool_item_id === keyOf(3) && sent.p_expected_order_no === ORDER_NO && sent.p_expected_index_sn === 3 && sent.p_expected_part_no === 'TEST-PART' && sent.p_reason === null, 'step (a): it returns the CURRENT step (3) of this machine');
    ok((await page.locator('#workOrderGrid [data-return-claim-status="pending"]').innerText()).trim() === '換道次處理中，等工廠處理…', 'in flight: the card says a step switch is being processed');
    ok(await page.locator('#workOrderGrid [data-station-cmd="start"][data-station-cmd-machine="A05"]').isDisabled(), 'in flight: the start button is locked');
    ok(await page.locator('#workOrderGrid [data-switch-step-open], #workOrderGrid [data-return-claim-open]').count() === 0 && await sheet(page).locator('[data-return-claim-confirm]').count() === 0, 'in flight: no second switch / return button on the card and no confirm button in the sheet');
    ok((await sheet(page).innerText()).includes('換道次處理中（1／2）：正在把第 3 道退回待做池，等工廠處理。請稍等，不要重按。'), 'in flight: the sheet shows step 1 of 2');
    ok(await page.evaluate(() => machtileReturnClaimBlockMessage('A05')) === SWITCH_BUSY && await page.evaluate(() => machtileReturnClaimBlockMessage('A03')) === '', 'in flight: other entry points for A05 get the step-switch sentence; A03 is not blocked');
    const stored = await page.evaluate(() => localStorage.getItem('machtile.returnClaimPending.v1'));
    ok(stored.includes(sent.p_command_uuid) && !stored.includes(keyOf(1)) && !/switch|target/i.test(stored) && await page.evaluate(() => Object.keys(localStorage).filter(key => /switch/i.test(key)).length) === 0, 'in flight: storage holds only the plain pending return — nothing about the step to claim');
    ok(fx.claims.length === 0, 'in flight: nothing is claimed before the factory confirms the return');
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="done"]'), null, { timeout: 20000 });
    ok(fx.polls.length >= 2 && fx.polls.every(poll => poll.select === CONTRACT_SELECT && poll.uuid === `eq.${sent.p_command_uuid}`), 'step (a): every poll uses the existing contract select and the submitted command_uuid');
    ok(fx.claims.length === 1 && fx.claims[0].raw === normalClaim.raw && fx.claims[0].url === normalClaim.url && fx.claims[0].method === normalClaim.method && fx.claims[0].contentType === normalClaim.contentType, 'step (b): the claim request is byte-identical to a normal claim (url, method, content type, body): ' + fx.claims[0].raw);
    const seq = fx.events.join(',');
    ok(/return_submit,(pool_read,)*return_result,(pool_read,)+claim/.test(seq) && seq.indexOf('claim') > seq.indexOf('return_result'), 'order of requests: return submit → return applied → pool re-read → claim: ' + seq);
    ok((await sheet(page).innerText()).includes('已換成第 1 道。原本的第 3 道已退回待做池。'), 'done: plain result sentence');
    await page.waitForFunction(() => { const card = [...document.querySelectorAll('#workOrderGrid .machine-tile-card')].find(c => c.querySelector('h2')?.textContent.trim().startsWith('A05')); return card && card.innerHTML.includes('N1 粗車'); }, null, { timeout: 15000 });
    const after = await cardHtml(page);
    ok(after.includes(ORDER_NO) && after.includes('N1 粗車') && !after.includes('N3 精車'), 'done: the A05 card now shows step 1 of the same order');
    ok(after.includes('已換成第 1 道。原本的第 3 道已退回待做池。'), 'done: the card keeps the result line');
    ok(await page.locator('#workOrderGrid [data-station-cmd="start"][data-station-cmd-machine="A05"]').isEnabled() && await page.evaluate(() => machtileReturnClaimLocks('A05')) === false, 'done: the card is not locked — start can be pressed');
    ok(await page.evaluate(() => localStorage.getItem('machtile.returnClaimPending.v1')) === '{}' && await page.evaluate(() => Object.keys(machtileSwitchStep.active).length) === 0, 'done: nothing left pending');
    const claimsAtEnd = fx.claims.length, pollsAtEnd = fx.polls.length;
    await page.waitForTimeout(2500);
    ok(fx.claims.length === claimsAtEnd && fx.submits.length === 1 && fx.polls.length === pollsAtEnd, 'afterwards: no second claim, no resubmit, no more polls');

    // ---- 換完之後（機台上是第 1 道；work_orders.external_ref 還停在第 3 道）：新的那一道卡片上兩顆按鈕都在，可以再換
    await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-switch-step-open="A05"]') && document.querySelector('#workOrderGrid [data-return-claim-open="A05"]'), null, { timeout: 15000 });
    const afterSwitch = await cardHtml(page);
    ok(afterSwitch.includes('N1 粗車') && afterSwitch.split(RETURN_BUTTON + SWITCH_BUTTON).length === 2, 'after the switch: the new step\'s card shows 「接錯了，退回」 and 「換道次」 again');
    ok(await page.evaluate(order => machtileMachineCardOrders().find(o => o.id === order && o.machine === 'A05')?.dispatchPoolSourceKey, ORDER_NO) === keyOf(3)
      && await page.evaluate(order => machtileMachineCardOrders().find(o => o.id === order && o.machine === 'A05')?.heldPoolKey, ORDER_NO) === keyOf(1),
      'after the switch: external_ref still names step 3; the key used is the pool row of step 1 (looked up in the pool)');
    fx.afterPolls = { count: fx.polls.length + 2, apply: applyReturn };
    await sheet(page).locator('[data-return-claim-close]').click();   // 第一次換道次的結果卡還開著：先關掉
    await page.locator('[data-switch-step-open="A05"]').click();
    await page.waitForSelector('#machtileReturnClaimSheet [data-switch-step-choices]');
    const text2 = await sheet(page).innerText();
    ok(text2.includes('現在掛的：第 1 道 · 粗車') && text2.includes('第 2 道 · 車牙 · 50 件') && text2.includes('第 3 道 · 精車 · 50 件') && await sheet(page).locator('[data-switch-step-choice]').count() === 2,
      'second switch: the sheet holds step 1 and offers steps 2 and 3 (3 is the one just returned)');
    await sheet(page).locator('[data-switch-step-choice-step="2"]').click();
    await sheet(page).locator('[data-switch-step-confirm]:not([disabled])').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="done"]'), null, { timeout: 20000 });
    const sent2 = fx.submits[1];
    ok(fx.submits.length === 2 && sent2.p_pool_item_id === keyOf(1) && sent2.p_expected_index_sn === 1 && sent2.p_command_uuid !== sent.p_command_uuid,
      'second switch: the return names the pool row of step 1 (the step the machine holds now), not external_ref: ' + sent2.p_pool_item_id);
    ok(fx.claims.length === 2 && fx.claims[1].raw === JSON.stringify({ p_source_key: keyOf(2), p_machine_code: 'A05' }), 'second switch: then claims step 2 with the normal claim request');
    await page.waitForFunction(() => { const card = [...document.querySelectorAll('#workOrderGrid .machine-tile-card')].find(c => c.querySelector('h2')?.textContent.trim().startsWith('A05')); return card && card.innerHTML.includes('N2 車牙'); }, null, { timeout: 15000 });
    ok((await sheet(page).innerText()).includes('已換成第 2 道。原本的第 1 道已退回待做池。'), 'second switch: done sentence names 1 → 2');
    await ctx.close();
  }

  // ---- 機台上掛的不是這張工單第一次被接的那一道（external_ref＝第 1 道、已退回池子；機台上是第 3 道）
  reset({ flag: true, firstClaimed: 1 });
  {
    const { ctx, page } = await openApp();
    const html = await cardHtml(page);
    ok(html.includes('N3 精車') && html.split(RETURN_BUTTON + SWITCH_BUTTON).length === 2, 'held step ≠ first-claimed step: both buttons show on the card');
    ok(fx.heldCalls.length >= 1 && fx.heldCalls.every(c => c.method === 'POST' && c.body === '{}' && c.query === ''), 'held step ≠ first-claimed step: the key comes from the read-only RPC machtile_held_pool_claims (POST, no arguments): ' + JSON.stringify(fx.heldCalls[0]));
    await page.locator('[data-switch-step-open="A05"]').click();
    await page.waitForSelector('#machtileReturnClaimSheet [data-switch-step-choices]');
    const text = await sheet(page).innerText();
    ok(text.includes('現在掛的：第 3 道 · 精車') && text.includes('第 1 道 · 粗車 · 50 件') && text.includes('第 2 道 · 車牙 · 50 件') && await sheet(page).locator('[data-switch-step-choice]').count() === 2,
      'held step ≠ first-claimed step: step 1 (the external_ref row, back in the pool) is offered as a choice, not treated as the held step');
    fx.afterPolls = { count: 2, apply: applyReturn };
    await sheet(page).locator('[data-switch-step-choice-step="1"]').click();
    await sheet(page).locator('[data-switch-step-confirm]:not([disabled])').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="done"]'), null, { timeout: 20000 });
    ok(fx.submits.length === 1 && fx.submits[0].p_pool_item_id === keyOf(3) && fx.submits[0].p_expected_index_sn === 3, 'held step ≠ first-claimed step: the return carries the pool row of step 3, not external_ref (step 1)');
    ok(fx.claims.length === 1 && fx.claims[0].raw === JSON.stringify({ p_source_key: keyOf(1), p_machine_code: 'A05' }), 'held step ≠ first-claimed step: then step 1 is claimed');
    await ctx.close();
  }
  // ---- 查不到唯一的一列＝兩顆按鈕都不出
  for (const [label, extra] of [
    ['two live claims for the held step on this machine', { heldRows: () => [claimedRow(3), claimedRow(3, { source_key: '01|TESTNEED0003|TEST-SIM-DUP' })] }],
    ['no live claim for the held step', { heldRows: () => [] }],
    ['only another step of the order is claimed', { heldRows: () => [claimedRow(1)] }],
    ['the claim for this order/step belongs to another machine (A04)', { heldRows: () => [claimedRow(3, { machine_code: 'A04' })] }],
    ['RPC answers with something that is not an array', { heldRows: () => ({ message: 'nope' }) }],
    ['RPC not deployed (404 PGRST202)', { heldMode: 'missing' }],
    ['RPC not deployed, pool row still readable as claimed', { heldMode: 'missing', heldPoolStatus: 'claimed' }],
    ['RPC fails (500)', { heldMode: 'error' }],
  ]) {
    reset({ flag: true, ...extra });
    const { ctx, page } = await openApp();
    ok(await page.evaluate(() => document.getElementById('toast')?.textContent || '') === '', `failed lookup shows no message to the operator: ${label}`);
    ok(fx.heldCalls.length >= 1 && (await cardHtml(page)).includes(ORDER_NO) && await page.locator('[data-switch-step-open], [data-return-claim-open], #machtileReturnClaimSheet').count() === 0, `ambiguous lookup hides both buttons: ${label}`);
    ok(await page.evaluate(async () => { await machtileReturnClaimOpen('A05', null, true); return document.getElementById('machtileReturnClaimSheet') === null; }) && fx.submits.length === 0 && fx.claims.length === 0, `ambiguous lookup: nothing can be opened or sent: ${label}`);
    await ctx.close();
  }

  // ---- 換道次處理中：選工單／待做池入口被擋，說的是換道次
  reset({ flag: true });
  {
    const { ctx, page } = await openApp();
    await startSwitch(page, 1);
    await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-return-claim-status="pending"]'));
    await sheet(page).locator('[data-return-claim-close]').click();
    await page.locator('[data-card-pool-open="A05"]').click();
    await page.waitForTimeout(200);
    ok(await page.locator('#machtileCardSelection').count() === 0 && await toastText(page) === SWITCH_BUSY, 'in flight: the pool entry on the card does not open; the toast says a step switch is being processed');
    await page.evaluate(key => machtileClaimDispatchPool(key, 'A05'), keyOf(2));
    ok(fx.claims.length === 0, 'in flight: a direct claim call for this machine sends nothing');
    ok(!SWITCH_BUSY.includes('開工') && !SWITCH_BUSY.includes('停工') && SWITCH_BUSY.includes('換道次'), 'the blocking sentence is about the step switch');
    await ctx.close();
  }

  // ---- 退回被拒絕（工廠：已開工）：什麼都沒變、既有那一句、不接
  reset({ flag: true });
  {
    const { ctx, page } = await openApp();
    fx.afterPolls = { count: 2, apply: () => { fx.command = { ...fx.command, status: 'rejected', reject_code: 'CLAIM_ALREADY_STARTED', reject_message: 'raw factory text' }; } };
    await startSwitch(page, 1);
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="return_rejected"]'), null, { timeout: 20000 });
    const text = await sheet(page).innerText();
    ok(text.includes('沒有換道次，這台還是原本的第 3 道。') && text.includes('這張單已經開工或已有報工，不能退回。要換單請找生管。') && !text.includes('CLAIM_ALREADY_STARTED') && !text.includes('raw factory text'), 'return rejected CLAIM_ALREADY_STARTED: nothing changed + the existing reject sentence, raw code not shown');
    ok(await toastText(page) === '這張單已經開工或已有報工，不能退回。要換單請找生管。', 'return rejected: the toast is the existing reject sentence');
    await page.waitForTimeout(2500);
    ok(fx.claims.length === 0 && fx.submits.length === 1, 'return rejected: no claim is attempted, nothing resubmitted');
    const html = await cardHtml(page);
    ok(html.includes('N3 精車') && await page.evaluate(() => machtileReturnClaimLocks('A05')) === false && await page.locator('#workOrderGrid [data-station-cmd="start"][data-station-cmd-machine="A05"]').isEnabled(), 'return rejected: the card still shows step 3 and is not locked');
    await ctx.close();
  }
  // 送出當場被拒絕（雲端 raise）
  reset({ flag: true, submitMode: 'CLAIM_ALREADY_STARTED' });
  {
    const { ctx, page } = await openApp();
    await startSwitch(page, 2);
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="return_rejected"]'));
    const text = await sheet(page).innerText();
    ok(text.includes('沒有換道次，這台還是原本的第 3 道。') && text.includes('這張單已經開工或已有報工，不能退回。要換單請找生管。') && !text.includes('CLAIM_ALREADY_STARTED'), 'return refused at submit: same two plain sentences');
    ok(await sheet(page).locator('[data-return-claim-confirm]').count() === 0 && fx.polls.length === 0 && fx.claims.length === 0, 'return refused at submit: no retry button, no polling, no claim');
    await sheet(page).locator('[data-return-claim-close]').click();
    ok(await page.locator('#workOrderGrid [data-switch-step-open="A05"]').count() === 1 && await page.evaluate(() => machtileReturnClaimLocks('A05')) === false, 'return refused at submit: the card is back to both buttons, not locked');
    await ctx.close();
  }
  // RPC 會列出、但伺服器不給退的另外兩種列（別人接的／工廠還沒確認）：一樣停下來、一句白話說為什麼跟怎麼辦、不重試、不接單
  for (const [code, sentence] of [['NOT_CLAIM_OWNER', '這張單不是你接的，你不能退回。請找接單的人或生管。'], ['CLAIM_NOT_APPLIED', '接單還沒被工廠確認，現在不能退回。請等一兩分鐘再試。']]) {
    reset({ flag: true, submitMode: code, ...(code === 'CLAIM_NOT_APPLIED' ? { heldPoolStatus: 'claimed' } : {}) });
    const { ctx, page } = await openApp();
    await startSwitch(page, 2);
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="return_rejected"]'));
    const text = await sheet(page).innerText();
    ok(text.includes('沒有換道次，這台還是原本的第 3 道。') && text.includes(sentence) && !text.includes(code), `${code}: 「換道次」 stops with the plain sentence, raw code not shown`);
    await page.waitForTimeout(2500);
    ok(await sheet(page).locator('[data-return-claim-confirm]').count() === 0 && fx.submits.length === 1 && fx.polls.length === 0 && fx.claims.length === 0, `${code}: sent once, no retry button, no polling, no automatic retry, no claim`);
    await sheet(page).locator('[data-return-claim-close]').click();
    ok(await page.evaluate(() => machtileReturnClaimLocks('A05')) === false, `${code}: the card is not left locked`);
    await ctx.close();
  }
  // ---- 正式環境的實況：機台上那一道的池列是 gone（App 讀不到），帳本那一筆還在 → 兩顆按鈕都出現
  reset({ flag: true });
  {
    const { ctx, page } = await openApp();
    ok(fx.heldPoolStatus === 'gone' && await page.evaluate(order => machtileMachineCardOrders().find(o => o.id === order && o.machine === 'A05')?.dispatchPoolStatus, ORDER_NO) === '', 'pool row gone: the app cannot see the pool row of the held step');
    ok((await cardHtml(page)).split(RETURN_BUTTON + SWITCH_BUTTON).length === 2, 'pool row gone but ledger claim present: both buttons show');
    await ctx.close();
  }

  // ---- 退回成功，但選的那一道接不到
  for (const [label, extra, reason, claims] of [
    ['claim refused (taken by another machine)', { claimMode: 'POOL_ITEM_NOT_WAITING' }, '已經被別台接走', 1],
    ['chosen step left the pool before the claim', { vanish: true }, '待做池裡已經沒有這一道', 0],
  ]) {
    reset({ flag: true, ...extra });
    const { ctx, page } = await openApp();
    fx.afterPolls = { count: 2, apply: () => { applyReturn(); if (fx.vanish) fx.waiting = fx.waiting.filter(step => step !== 1); } };
    await startSwitch(page, 1);
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="returned_not_claimed"]'), null, { timeout: 20000 });
    const sentence = `原本那一道已經退回待做池，這台現在沒有工單；第 1 道沒有接成功（${reason}）。請到「選工單」重新接。`;
    const text = await sheet(page).innerText();
    ok(text.includes(sentence) && !text.includes('POOL_ITEM_NOT_WAITING'), `${label}: the honest sentence — ${sentence}`);
    ok(await toastText(page) === sentence, `${label}: the toast says the same`);
    ok(await sheet(page).locator('[data-return-claim-confirm], [data-switch-step-choice]').count() === 0, `${label}: no retry button`);
    await page.waitForFunction(order => { const card = [...document.querySelectorAll('#workOrderGrid .machine-tile-card')].find(c => c.querySelector('h2')?.textContent.trim().startsWith('A05')); return card && !card.innerHTML.includes(order); }, ORDER_NO, { timeout: 15000 });
    await page.waitForTimeout(3000);
    ok(fx.claims.length === claims && fx.submits.length === 1, `${label}: ${claims} claim attempt(s) in total — never retried`);
    ok((await cardHtml(page)).includes(sentence), `${label}: the (now empty) A05 card keeps that sentence`);
    ok(await page.evaluate(() => machtileReturnClaimLocks('A05') === false && machtileReturnClaimBlockMessage('A05') === '' && Object.keys(machtileSwitchStep.active).length === 0), `${label}: the card is not left locked`);
    await sheet(page).locator('[data-return-claim-close]').click();
    await page.locator('[data-card-pool-open="A05"]').click();
    await page.waitForSelector('#machtileCardSelection [data-pool-claim]');
    ok(await page.locator(`#machtileCardSelection [data-pool-claim="${keyOf(3)}"]`).count() === 1, `${label}: 「選工單／待做池」 opens and the returned step 3 is back in the pool`);
    await ctx.close();
  }

  // ---- 中途重新整理：不會自動接
  reset({ flag: true });
  {
    const { ctx, page } = await openApp();
    await startSwitch(page, 1);
    await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-return-claim-status="pending"]'));
    ok(fx.submits.length === 1 && fx.claims.length === 0, 'reload case: the return is in flight');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page);
    ok(await page.evaluate(() => machtileReturnClaimLocks('A05') === true && Object.keys(machtileSwitchStep.active).length === 0 && document.getElementById('machtileReturnClaimSheet') === null), 'after reload: the pending return is restored (card locked); there is no switch in memory and no sheet');
    ok((await page.locator('#workOrderGrid [data-return-claim-status="pending"]').innerText()).trim() === '退回中，等工廠處理…', 'after reload: the card says a return is being processed (the real state)');
    applyReturn();
    await page.waitForFunction(() => machtileReturnClaimLocks('A05') === false, null, { timeout: 20000 });
    await page.waitForFunction(order => { const card = [...document.querySelectorAll('#workOrderGrid .machine-tile-card')].find(c => c.querySelector('h2')?.textContent.trim().startsWith('A05')); return card && !card.innerHTML.includes(order); }, ORDER_NO, { timeout: 15000 });
    await page.waitForTimeout(4000);
    ok(fx.claims.length === 0, 'after reload: the return is applied and NO claim is sent — step (b) is never continued');
    ok(fx.submits.length === 1, 'after reload: nothing is resubmitted');
    ok((await cardHtml(page)).includes('已退回待做池，這台現在沒有工單。') && await toastText(page) === '已退回待做池，這台現在沒有工單。', 'after reload: the machine shows its real state (returned, no work order)');
    ok(await page.evaluate(() => localStorage.getItem('machtile.returnClaimPending.v1')) === '{}', 'after reload: nothing left pending');
    await ctx.close();
  }

  // ---- 送出時斷線：換道次停、不接；確認卡是既有的「不確定／重送」
  reset({ flag: true, submitMode: 'network' });
  {
    const { ctx, page } = await openApp();
    await startSwitch(page, 1);
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-result="uncertain"]'));
    const text = await sheet(page).innerText();
    ok(text.includes('網路不穩，還不知道有沒有送到。') && text.includes('換道次先停下來：還不知道退回有沒有成功，所以沒有幫你接第 1 道。'), 'network cut on the return: existing uncertain message + the switch is stopped');
    ok(await page.evaluate(() => Object.keys(machtileSwitchStep.active).length) === 0, 'network cut: no switch remains in memory');
    fx.submitMode = 'accept';
    fx.afterPolls = { count: fx.polls.length + 2, apply: applyReturn };
    await page.waitForFunction(() => machtileReturnClaimLocks('A05') === false || document.querySelector('#machtileReturnClaimSheet [data-return-claim-confirm]'), null, { timeout: 20000 });
    await sheet(page).locator('[data-return-claim-confirm]').click();
    await page.waitForFunction(() => machtileReturnClaimLocks('A05') === false, null, { timeout: 20000 });
    await page.waitForTimeout(3000);
    ok(fx.submits.length === 2 && JSON.stringify(fx.submits[1]) === JSON.stringify(fx.submits[0]), 'network cut: resend is the same return (same uuid, identical body)');
    ok(fx.claims.length === 0, 'network cut: even after the return is applied later, no claim is sent');
    await ctx.close();
  }

  // ================================================================ 審查修正（opus L3 @ c0e7af04）
  const CLAIMED_STALE = '已換成第 1 道（原本的第 3 道已退回待做池），但畫面沒有更新成功。請重新整理畫面。';
  const shortLimit = page => page.evaluate(() => { window.MachTileStationCommandCore.SUBMIT_TIMEOUT_MS = 1500; });
  const cardOf = (page, text) => page.waitForFunction(text => { const card = [...document.querySelectorAll('#workOrderGrid .machine-tile-card')].find(c => c.querySelector('h2')?.textContent.trim().startsWith('A05')); return card && card.innerHTML.includes(text); }, text, { timeout: 15000 });
  const toastLog = page => page.evaluate(() => { window.__toasts = []; const el = document.getElementById('toast'); new MutationObserver(() => { const text = el.textContent; if (text && window.__toasts.at(-1) !== text) window.__toasts.push(text); }).observe(el, { childList: true, characterData: true, subtree: true }); });

  // ---- MEDIUM-1：接單 RPC 成功、之後重讀畫面失敗 → 「接到了，但畫面沒更新」，不是「沒接到」，提示只有一句
  reset({ flag: true, afterClaim: 'fail' });
  {
    const { ctx, page } = await openApp();
    await toastLog(page);
    fx.afterPolls = { count: 2, apply: applyReturn };
    await startSwitch(page, 1);
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result]:not([data-switch-step-result="returning"]):not([data-switch-step-result="claiming"])'), null, { timeout: 20000 });
    const text = await sheet(page).innerText();
    ok(await sheet(page).locator('[data-switch-step-result="claimed_refresh_failed"]').count() === 1 && text.includes(CLAIMED_STALE), 'claim ok + reload failed: the sheet says the step WAS switched but the screen could not refresh — ' + CLAIMED_STALE);
    ok(!text.includes('沒有接成功') && !text.includes('不確定有沒有接到') && !text.includes('fixture: reload failed') && await sheet(page).locator('[data-return-claim-confirm], [data-switch-step-choice]').count() === 0, 'claim ok + reload failed: not worded as a failure or as uncertain, no raw error, no retry button');
    ok(fx.claims.length === 1 && fx.claims[0].raw === normalClaim.raw && fx.claims[0].url === normalClaim.url && fx.claims[0].contentType === normalClaim.contentType && fx.cardReadsAfterClaim >= 1, 'claim ok + reload failed: one claim, byte-identical to a normal claim; the reload was attempted');
    const toasts = await page.evaluate(() => window.__toasts);
    ok(await toastText(page) === CLAIMED_STALE && toasts.filter(t => !t.includes('換道次') && !t.includes('已換成')).length === 0 && toasts.filter(t => t === CLAIMED_STALE).length === 1, 'claim ok + reload failed: a single toast for the outcome (no separate claim-failed / claim-success toast): ' + JSON.stringify(toasts));
    ok(await page.evaluate(() => machtileReturnClaimLocks('A05') === false && machtileReturnClaimBlockMessage('A05') === '' && Object.keys(machtileSwitchStep.active).length === 0 && machtileDispatchPoolState.claimBusy === '' && machtileDispatchPoolState.claimMessage === ''), 'claim ok + reload failed: nothing left locked, and no "claim failed" message is left for the pool panel');
    await cardOf(page, 'N1 粗車');
    const after = await cardHtml(page);
    ok(after.includes(ORDER_NO) && after.includes('N1 粗車') && !after.includes('N3 精車'), 'claim ok + reload failed: the background re-read then shows the real state — A05 holds step 1');
    await page.waitForTimeout(2500);
    ok(fx.claims.length === 1 && fx.submits.length === 1, 'claim ok + reload failed: never retried');
    await ctx.close();
  }

  // ---- MEDIUM-1：換成功的提示也只有一句（既有接單函式在換道次裡不另外跳「接單成功」）；一般接單照舊跳自己的那一句
  reset({ flag: true });
  {
    const { ctx, page } = await openApp();
    await toastLog(page);
    fx.afterPolls = { count: 2, apply: applyReturn };
    await startSwitch(page, 1);
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="done"]'), null, { timeout: 20000 });
    const toasts = await page.evaluate(() => window.__toasts);
    ok(toasts.at(-1) === '已換成第 1 道。原本的第 3 道已退回待做池。' && !toasts.includes('接單成功，工單已進入這台機台。'), 'switch done: one outcome toast, the plain claim-success toast is not shown on top: ' + JSON.stringify(toasts));
    await ctx.close();
  }
  reset({ held: null, waiting: [1, 2, 3], flag: true });
  {
    const { ctx, page } = await openApp();
    await page.locator('[data-card-pool-open="A05"]').click();
    await page.waitForSelector(`#machtileCardSelection [data-pool-claim="${keyOf(1)}"]:not([disabled])`);
    await page.locator(`#machtileCardSelection [data-pool-claim="${keyOf(1)}"]`).click();
    await cardOf(page, ORDER_NO);
    await page.waitForFunction(() => machtileDispatchPoolState.claimBusy === '');
    ok(await toastText(page) === '接單成功，工單已進入這台機台。' && fx.claims.length === 1 && fx.claims[0].raw === normalClaim.raw, 'normal claim from the pool panel (flags on): its own success toast and request are unchanged: ' + await toastText(page));
    await ctx.close();
  }

  // ---- LOW-2：登入的人換了／登出 → 記憶體裡的換道次丟掉，之後退回成功也不會接
  for (const how of ['another user signs in', 'logout']) {
    reset({ flag: true });
    const { ctx, page } = await openApp();
    await startSwitch(page, 1);
    await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-return-claim-status="pending"]'));
    ok(await page.evaluate(() => Object.keys(machtileSwitchStep.active).length === 1 && machtileSwitchStep.active.A05.userId === machtileAuthState.userId && machtileAuthState.userId !== ''), `${how}: a switch is in flight and remembers who pressed it`);
    if (how === 'logout') await page.evaluate(() => machtileClearSession());
    else await page.evaluate(([token, sub]) => machtileSetSession({ access_token: token, user: { id: sub, email: 'other@test.invalid' } }, 'other@test.invalid'), [tokenFor(id(903), 'operator'), id(903)]);
    ok(await page.evaluate(() => Object.keys(machtileSwitchStep.active).length === 0 && machtileSwitchStep.claimPass === '' && document.getElementById('machtileReturnClaimSheet') === null && machtileSwitchStepActive('A05') === null), `${how}: the in-memory switch is gone and its sheet is closed`);
    applyReturn();
    await page.waitForTimeout(6000);
    ok(fx.claims.length === 0 && fx.submits.length === 1, `${how}: the return is applied afterwards and NO claim goes out`);
    ok(await page.evaluate(() => Object.keys(machtileSwitchStep.active).length === 0 && machtileSwitchStepHolds('A05') === false), `${how}: nothing holds the machine for a switch`);
    await ctx.close();
  }
  // 同一個人重新拿到登入（換 token、同一個 user id）不會丟掉進行中的換道次
  reset({ flag: true });
  {
    const { ctx, page } = await openApp();
    await startSwitch(page, 1);
    await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-return-claim-status="pending"]'));
    await page.evaluate(([token, sub]) => machtileSetSession({ access_token: token, user: { id: sub, email: 'user@test.invalid' } }, 'user@test.invalid'), [tokenFor(auth, 'operator'), auth]);
    ok(await page.evaluate(() => Object.keys(machtileSwitchStep.active).length === 1 && document.getElementById('machtileReturnClaimSheet') !== null), 'same user gets a fresh session: the switch in flight is kept');
    fx.afterPolls = { count: fx.polls.length + 1, apply: applyReturn };
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="done"]'), null, { timeout: 20000 });
    ok(fx.claims.length === 1, 'same user gets a fresh session: the switch completes with one claim');
    await ctx.close();
  }

  // ---- LOW-4：每一個等待都有期限 → 鎖一定會放開（不用重新整理頁面）；逾時絕不接單
  // (a) 開確認卡時待做池讀不回來
  reset({ flag: true });
  {
    const { ctx, page } = await openApp();
    await shortLimit(page);
    fx.poolHang = true;
    await page.locator('[data-switch-step-open="A05"]').click();
    await page.waitForSelector('#machtileReturnClaimSheet [data-switch-step-pool-failed]', { timeout: 10000 });
    ok((await sheet(page).innerText()).includes('讀不到最新的待做池，現在不能換道次。請檢查網路後重新整理畫面。') && await sheet(page).locator('[data-switch-step-confirm]').isDisabled() && await sheet(page).locator('[data-switch-step-choice]').count() === 0, 'pool read hangs while opening: after the time limit the sheet says the pool cannot be read; nothing can be confirmed');
    ok(fx.submits.length === 0 && fx.claims.length === 0, 'pool read hangs while opening: nothing is sent');
    releaseHung(); await ctx.close();
  }
  // (b) 退回成功之後重讀待做池卡住
  reset({ flag: true });
  {
    const { ctx, page } = await openApp();
    await shortLimit(page);
    fx.afterPolls = { count: 2, apply: () => { applyReturn(); fx.poolHang = true; } };
    await startSwitch(page, 1);
    await page.waitForFunction(() => machtileSwitchStepHolds('A05'), null, { timeout: 20000 });
    ok(await page.evaluate(() => machtileReturnClaimLocks('A05') === true && machtileReturnClaimBlockMessage('A05') !== ''), 'pool re-read hangs after the return: the machine is held while waiting');
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="returned_not_claimed"]'), null, { timeout: 10000 });
    const sentence = '原本那一道已經退回待做池，這台現在沒有工單；第 1 道沒有接成功（讀不到最新的待做池）。請到「選工單」重新接。';
    ok((await sheet(page).innerText()).includes(sentence) && await toastText(page) === sentence, 'pool re-read hangs after the return: time limit → the existing "pool unread" outcome');
    ok(fx.claims.length === 0, 'pool re-read hangs after the return: NO claim is sent on a timeout');
    ok(await page.evaluate(() => machtileReturnClaimLocks('A05') === false && machtileReturnClaimBlockMessage('A05') === '' && Object.keys(machtileSwitchStep.active).length === 0), 'pool re-read hangs after the return: the lock is released without a page reload');
    fx.poolHang = false; releaseHung();
    await page.waitForTimeout(2500);
    ok(fx.claims.length === 0, 'pool re-read hangs after the return: still no claim once the network is back');
    await ctx.close();
  }
  // (c) 接單送出後沒有回應
  reset({ flag: true, claimMode: 'hang' });
  {
    const { ctx, page } = await openApp();
    await shortLimit(page);
    fx.afterPolls = { count: 2, apply: applyReturn };
    await startSwitch(page, 1);
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="claim_uncertain"]'), null, { timeout: 25000 });
    const sentence = '原本那一道已經退回待做池；第 1 道不確定有沒有接到（網路不穩）。請重新整理畫面看這台現在掛哪張單；沒有的話請到「選工單」重新接。';
    ok((await sheet(page).innerText()).includes(sentence) && await toastText(page) === sentence, 'claim request hangs: time limit → the existing "uncertain" outcome');
    ok(await page.evaluate(() => machtileReturnClaimLocks('A05') === false && machtileReturnClaimBlockMessage('A05') === '' && Object.keys(machtileSwitchStep.active).length === 0), 'claim request hangs: the lock is released without a page reload');
    await page.waitForTimeout(2500);
    ok(fx.claims.length === 1 && fx.submits.length === 1, 'claim request hangs: one claim in total — a timeout never resends');
    releaseHung(); await ctx.close();
  }
  // (d) 接單成功、之後重讀畫面卡住
  reset({ flag: true, afterClaim: 'hang' });
  {
    const { ctx, page } = await openApp();
    await shortLimit(page);
    fx.afterPolls = { count: 2, apply: applyReturn };
    await startSwitch(page, 1);
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="claimed_refresh_failed"]'), null, { timeout: 25000 });
    ok((await sheet(page).innerText()).includes(CLAIMED_STALE) && await toastText(page) === CLAIMED_STALE, 'reload hangs after a successful claim: time limit → "switched, but the screen could not refresh"');
    ok(await page.evaluate(() => machtileReturnClaimLocks('A05') === false && machtileReturnClaimBlockMessage('A05') === '' && Object.keys(machtileSwitchStep.active).length === 0), 'reload hangs after a successful claim: the lock is released without a page reload');
    await page.waitForFunction(() => machtileDispatchPoolState.claimBusy === '', null, { timeout: 10000 });
    ok(fx.claims.length === 1, 'reload hangs after a successful claim: the claim function is not left busy; one claim in total');
    releaseHung(); await ctx.close();
  }

  // ---- 管理員／生管：原因必填（跟退回一樣）
  reset({ flag: true, role: 'planner' });
  {
    const { ctx, page } = await openApp();
    await page.locator('[data-switch-step-open="A05"]').click();
    await page.waitForSelector('#machtileReturnClaimSheet [data-switch-step-choices]');
    ok(await sheet(page).locator('[data-return-claim-reason]').count() === 1 && (await sheet(page).innerText()).includes('退回原因（必填）'), 'planner: reason field is shown');
    await sheet(page).locator('[data-switch-step-choice-step="1"]').click();
    await sheet(page).locator('[data-switch-step-confirm]').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-reason-error]'));
    ok(fx.submits.length === 0 && (await sheet(page).innerText()).includes('代退要寫原因，請填一句話。') && await page.evaluate(() => Object.keys(machtileSwitchStep.active).length) === 0, 'planner: empty reason — nothing sent, no switch started');
    await sheet(page).locator('[data-return-claim-reason]').fill('  代換：道次接錯  ');
    ok((await sheet(page).locator('[data-switch-step-confirm]').innerText()).trim() === '換成第 1 道', 'planner: the chosen step survives typing the reason');
    fx.afterPolls = { count: 2, apply: applyReturn };
    await sheet(page).locator('[data-switch-step-confirm]').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-switch-step-result="done"]'), null, { timeout: 20000 });
    ok(fx.submits.length === 1 && fx.submits[0].p_reason === '代換：道次接錯' && fx.claims.length === 1 && fx.claims[0].raw === normalClaim.raw, 'planner: the reason travels with the return as p_reason; the claim is still the plain claim');
    await ctx.close();
  }

  // ---- 越南文
  reset({ flag: true });
  {
    const { ctx, page } = await openApp('vi');
    ok((await page.locator('[data-switch-step-open="A05"]').innerText()).includes('Đổi công đoạn'), 'vi: button text is Vietnamese');
    await page.locator('[data-switch-step-open="A05"]').click();
    await page.waitForSelector('#machtileReturnClaimSheet [data-switch-step-choices]');
    ok((await sheet(page).innerText()).includes('Đổi công đoạn: ' + ORDER_NO), 'vi: sheet title is Vietnamese');
    await ctx.close();
  }

  ok(writes.every(p => ['/rest/v1/rpc/machtile_submit_return_claim_command', '/rest/v1/rpc/dispatch_pool_claim'].includes(p)), 'the only writes in every scenario are the two existing RPCs: ' + [...new Set(writes)].join(','));
  ok(poolClaimedSelects.length === 0, 'the old dispatch_pool_items claimed-row lookup is never requested in any scenario: ' + poolClaimedSelects.join(','));
  ok(blocked.length === 0, 'no real backend, no unexpected select, no non-GET local request: ' + blocked.join(','));
  ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
  console.log(`${checks}/${checks} switch-step browser checks passed`);
} finally {
  await browser.close(); server.close();
}
