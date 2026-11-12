// 機台卡片「接錯了，退回」（return_claim，CONTRACT-P2 r1）瀏覽器端到端：真的 index.html／app.js，假資料 TEST-*，
// 所有後端請求都由這支腳本攔截（假網域），不會碰任何真的後端。
// MACHTILE_PLAYWRIGHT_MODULE=<playwright/index.mjs> node returnClaim.browser.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const imported = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = imported.default || imported;
const fake = 'https://return-claim-fixture.test', id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1), auth = id(901), actor = id(902);
const POOL_KEY = '01|TESTNEED0001|TEST-SIM-1';
const CONTRACT_SELECT = 'command_uuid,command_type,machine_code,pool_item_id,expected_order_no,expected_index_sn,status,requested_at,claimed_at,applied_at,reject_code,reject_message,legacy_snapshot';
const machineRows = [
  { id: id(101), machine_code: 'A01', name: 'A01', department_name: '車床課', status: 'idle', machine_type: 'lathe', display_order: 1 },
  { id: id(102), machine_code: 'A02', name: 'A02', department_name: '車床課', status: 'idle', machine_type: 'lathe', display_order: 2 },
];
const order = { id: id(201), work_order_no: 'TEST-ON-A01', part_no: 'TEST-PART', part_name: '測試零件', quantity: 50, due_date: '2026-12-20', status: 'in_progress', source_system: 'app_manual', created_by: actor, legacy_mes_source: 'dispatch_pool', external_ref: POOL_KEY };
const proc = { id: id(301), tenant_id: tenant, work_order_id: id(201), process_order: 1, process_name: '車削', process_type: 'cnc', machine_id: id(101), status: 'pending', qty_completed: 0, qty_defect: 0 };

// 每個情境重設的假後端狀態
let fx;
const reset = (extra = {}) => { fx = { flag: undefined, role: 'operator', assigned: true, procStatus: 'pending', poolStatus: 'claimed', submitMode: 'accept', submits: [], polls: [], command: null, afterPolls: null, storedPending: null,
  // externalRef＝work_orders.external_ref（雲端停在這張工單第一次被接的那一道）；step＝機台上掛的道次；
  // heldRows＝待做池裡 claimed 的列（null＝照 poolStatus：claimed 就是「這一道、鍵 POOL_KEY」一列）；heldQueries＝App 查了幾次、怎麼查
  externalRef: POOL_KEY, step: 1, heldRows: null, heldQueries: [], ...extra }; };
const HELD_SELECT = 'source_key,work_order_no,process_order,status';
let checks = 0;
const blocked = [], errors = [], writes = [];
const ok = (value, label) => { assert(value, label); checks++; console.log('PASS ' + label); };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => { if (req.method !== 'GET') { res.writeHead(405); res.end(); return; } const u = new URL(req.url, 'http://localhost'); const file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname))); if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; } try { res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); } catch { res.writeHead(404); res.end(); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

async function openApp(language = 'zh-Hant') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  const token = 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ sub: auth, exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: { tenant_id: tenant, role: fx.role }, role: 'authenticated' })).toString('base64url') + '.test';
  await ctx.addInitScript(([token, language, storedPending]) => {
    if (storedPending && localStorage.getItem('machtile.returnClaimPending.v1') === null) localStorage.setItem('machtile.returnClaimPending.v1', storedPending);
    sessionStorage.setItem('machtileAuthSession', JSON.stringify({ version: 1, accessToken: token, refreshToken: '', email: 'user@test.invalid', authMethod: 'password', mode: 'session', createdAt: Date.now(), rememberUntil: 0 }));
    if (language !== 'zh-Hant') localStorage.setItem('machtile.language', language);
  }, [token, language, fx.storedPending]);
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.url().startsWith(base)) {
      if (u.pathname === '/config.js') return route.fulfill({ contentType: 'text/javascript', body: `window.MACHTILE_CONFIG={useSupabase:true,authMode:'strict',tenantId:'${tenant}',useTenantHeaderAuth:true,supabaseUrl:'${fake}',supabaseAnonKey:'fixture-public',oauthEnabled:false,disableServiceWorker:true,enableOutboxSubmit:false,enableProgramUpload:false,enableScheduleContracts:false,enableAccountDelete:false,enableJevTriage:false,enableFaceStatus:false,useHmcWorklistSupabase:false,hmcFixedStagingEnabled:false,dispatchPoolMachines:['A01','A02'],multiStationMachines:[],stationCommandMachines:['A01','A02']${fx.flag === undefined ? '' : `,enableReturnClaim:${JSON.stringify(fx.flag)}`}};` });
      if (req.method() !== 'GET') { blocked.push(req.url()); return route.abort(); }
      return route.continue();
    }
    if (u.origin !== fake) { blocked.push(req.url()); return route.abort(); }
    const p = u.pathname;
    if (p === '/rest/v1/rpc/machtile_submit_return_claim_command' && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}'); fx.submits.push(body); writes.push(p);
      if (fx.submitMode === 'network') return route.abort('failed');
      if (fx.submitMode !== 'accept') return json(400, { code: 'P0001', message: fx.submitMode, details: null, hint: null });
      fx.command = { command_uuid: body.p_command_uuid, command_type: 'return_claim', machine_code: body.p_machine_code, pool_item_id: body.p_pool_item_id,
        expected_order_no: body.p_expected_order_no, expected_index_sn: body.p_expected_index_sn, status: 'pending', requested_at: new Date().toISOString(),
        claimed_at: null, applied_at: null, reject_code: null, reject_message: null, legacy_snapshot: null };
      return json(200, fx.command);
    }
    if (p === '/rest/v1/station_commands' && req.method() === 'GET') {
      const uuid = u.searchParams.get('command_uuid');
      if (!uuid || !u.searchParams.get('select')?.includes('pool_item_id')) return json(200, []);
      fx.polls.push({ select: u.searchParams.get('select'), uuid });
      if (fx.command && fx.afterPolls && fx.polls.length >= fx.afterPolls.count) fx.afterPolls.apply();
      return json(200, fx.command && `eq.${fx.command.command_uuid}` === uuid ? [fx.command] : []);
    }
    if (req.method() !== 'GET' && !['/rest/v1/rpc/batch_report_progress', '/rest/v1/rpc/machine_department_context'].includes(p) && !/_snapshot$|_list$/.test(p)) writes.push(p);
    if (p === '/auth/v1/user') return json(200, { id: auth, email: 'user@test.invalid' });
    if (p === '/rest/v1/app_users') return json(200, [{ id: actor, auth_user_id: auth, name: '測試使用者', legacy_user_id: 'TEST-001', role: fx.role, is_active: true }]);
    if (p === '/rest/v1/rpc/machine_department_context') return json(200, { tenant_id: tenant, role: fx.role, all_departments: true, is_bridge: false, department_codes: ['LATHE', 'MILL'] });
    if (p === '/rest/v1/machines' || p === '/rest/v1/v_machine_management_cards') {
      return json(200, p.endsWith('/v_machine_management_cards') ? machineRows.map(({ id, name, ...row }) => ({ ...row, machine_id: id, machine_name: name })) : machineRows);
    }
    const liveProc = { ...proc, status: fx.procStatus, process_order: fx.step };
    const liveOrder = { ...order, external_ref: fx.externalRef };
    if (p === '/rest/v1/dispatch_pool_items') {
      const select = u.searchParams.get('select') || '';
      if (select === 'source_key,status') return json(200, fx.poolStatus ? [{ source_key: fx.externalRef, status: fx.poolStatus }] : []);
      if (select === HELD_SELECT) {
        // 機台上這一道是池裡哪一列：只回 claimed、而且工單號在 in 清單裡的列（跟 PostgREST 的篩選一樣）
        const query = { status: u.searchParams.get('status'), limit: u.searchParams.get('limit'), orders: u.searchParams.get('work_order_no') };
        fx.heldQueries.push(query);
        const rows = fx.heldRows || (fx.poolStatus === 'claimed' ? [{ source_key: POOL_KEY, work_order_no: order.work_order_no, process_order: fx.step, status: 'claimed' }] : []);
        return json(200, rows.filter(row => query.status === `eq.${row.status}` && (query.orders || '').includes(`"${row.work_order_no}"`)));
      }
      return json(200, []);
    }
    if (p === '/rest/v1/work_orders') return json(200, fx.assigned ? [{ ...liveOrder, work_order_processes: [liveProc] }] : []);
    if (p === '/rest/v1/work_order_processes') {
      if (!fx.assigned) return json(200, []);
      if ((u.searchParams.get('select') || '').includes('work_orders!inner')) return json(200, [{ ...liveProc, off_station_at: null, work_orders: liveOrder, machines: machineRows[0] }]);
      return json(200, [liveProc]);
    }
    if (p === '/rest/v1/v_work_order_cards') return json(200, fx.assigned ? [{ id: order.id, tenant_id: tenant, work_order_no: order.work_order_no, part_name: order.part_name, quantity: order.quantity, due_date: order.due_date, work_order_status: order.status, current_process_id: proc.id, current_process_name: proc.process_name, current_process_status: fx.procStatus, machine_name: 'A01', qty_completed: 0, qty_defect: 0, current_process_off_station: false }] : []);
    return json(200, []);
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('dataSourceLabel')?.textContent.includes('Supabase'));
  await page.waitForFunction(() => typeof machtileDeferredLoadState !== 'undefined' && machtileDeferredLoadState.get('card-details')?.status === 'ready'
    && typeof machtileStationCmd !== 'undefined' && ['ready', 'missing', 'off'].includes(machtileStationCmd.availability)
    && typeof machtileBackgroundLoadPromise !== 'undefined');
  await page.evaluate(() => machtileBackgroundLoadPromise);
  await page.waitForTimeout(150);
  return { ctx, page };
}
const cardHtml = (page, code = 'A01') => page.evaluate(code => [...document.querySelectorAll('#workOrderGrid .machine-tile-card')].find(card => card.querySelector('h2')?.textContent.trim().startsWith(code))?.outerHTML || '', code);
const sheet = page => page.locator('#machtileReturnClaimSheet');
const BUTTON = '<button type="button" class="card-select-entry pool-return-action" data-no-detail="" data-return-claim-open="A01">接錯了，退回</button>';

try {
  // ---- 旗標關（沒設、false）＝卡片 HTML 逐字相同；旗標開＝只多那一顆按鈕
  reset(); const absent = await openApp(); const htmlAbsent = await cardHtml(absent.page); await absent.ctx.close();
  reset({ flag: false }); const off = await openApp(); const htmlOff = await cardHtml(off.page);
  ok(htmlAbsent.includes('TEST-ON-A01') && htmlAbsent.includes('data-station-cmd="start"'), 'flag off: A01 card shows the claimed order with its start button');
  ok(htmlOff === htmlAbsent, 'flag off: card HTML is byte-identical whether the flag is missing or false');
  ok(await off.page.locator('[data-return-claim-open], [data-return-claim-status], #machtileReturnClaimSheet').count() === 0, 'flag off: no return-claim element anywhere');
  ok(fx.heldQueries.length === 0, 'flag off: the held-step pool lookup is never requested');
  ok(await off.page.evaluate(() => { machtileReturnClaimOpen('A01', null); return document.getElementById('machtileReturnClaimSheet') === null && localStorage.getItem('machtile.returnClaimPending.v1') === null; }), 'flag off: calling the open handler directly does nothing');
  await off.ctx.close();

  reset({ flag: true });
  {
    const { ctx, page } = await openApp();
    const htmlOn = await cardHtml(page);
    ok(htmlOn.split(BUTTON).length === 2, 'flag on: the claimed, not-started card shows 「接錯了，退回」 once');
    ok(fx.heldQueries.length >= 1 && fx.heldQueries.every(q => q.status === 'eq.claimed' && q.limit === '1000' && q.orders === 'in.("TEST-ON-A01")'),
      'flag on: the held step is looked up in the pool (claimed rows of the orders on the cards): ' + JSON.stringify(fx.heldQueries[0]));
    ok(htmlOn.replace(BUTTON, '') === htmlAbsent, 'flag on: apart from that one button the card HTML is byte-identical to flag off');
    ok(await page.locator('.machine-tile-card [data-return-claim-open]').count() === 1, 'flag on: only the claimed card has the button (empty A02 has none)');

    // ---- 確認卡：白話三句；取消＝什麼都不送
    await page.locator('[data-return-claim-open="A01"]').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-confirm]:not([disabled])'));
    const text = await sheet(page).innerText();
    ok(text.includes('確認退回這張單') && text.includes('這張單會回到待做池，別人可以再接。') && text.includes('這台機台會變成沒有工單。') && text.includes('不會報工，也不會記任何數量。'), 'confirm sheet: plain-language explanation (back to pool, machine empty, nothing reported)');
    ok(text.includes('A01') && text.includes('TEST-ON-A01') && text.includes('第 1 道'), 'confirm sheet: machine, order and step are shown');
    ok(await sheet(page).locator('[data-return-claim-reason]').count() === 0, 'operator: no reason field');
    await sheet(page).locator('[data-return-claim-close]').click();
    ok(await sheet(page).count() === 0 && fx.submits.length === 0, 'cancel: sheet closes and nothing is sent');

    // ---- 送出 → 輪詢 → applied → 卡片變空
    fx.afterPolls = { count: 2, apply: () => { fx.assigned = false; fx.poolStatus = 'waiting'; fx.command = { ...fx.command, status: 'applied', claimed_at: new Date().toISOString(), applied_at: new Date().toISOString(), legacy_snapshot: { return_claim: { mode: 'unassigned', pool_status: 'returned', station_cleared: true }, cloud_finalize: { claim_returned: true, process_detached: true, item_reopened: true } } }; } };
    await page.locator('[data-return-claim-open="A01"]').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-confirm]:not([disabled])'));
    await sheet(page).locator('[data-return-claim-confirm]').click();
    await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-return-claim-status="pending"]'));
    ok(fx.submits.length === 1, 'one submit');
    const sent = fx.submits[0];
    ok(JSON.stringify(Object.keys(sent)) === JSON.stringify(['p_command_uuid', 'p_machine_code', 'p_pool_item_id', 'p_expected_order_no', 'p_expected_index_sn', 'p_expected_part_no', 'p_reason']), 'submit body has exactly the seven contract parameters');
    ok(/^[0-9a-f-]{36}$/.test(sent.p_command_uuid) && sent.p_machine_code === 'A01' && sent.p_pool_item_id === POOL_KEY && sent.p_expected_order_no === 'TEST-ON-A01' && sent.p_expected_index_sn === 1 && sent.p_expected_part_no === 'TEST-PART' && sent.p_reason === null, 'submit body values: machine, pool item, order, step, part no, operator reason = null');
    ok(await page.locator('#workOrderGrid [data-station-cmd="start"][data-station-cmd-machine="A01"]').isDisabled(), 'while the return is pending the start button is locked');
    ok(await page.locator('#workOrderGrid [data-return-claim-open]').count() === 0, 'while pending there is no second return button');
    ok((await sheet(page).innerText()).includes('已送出，等工廠處理。請稍等，不要重按。'), 'sheet shows the waiting state');
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-result="applied"]'), null, { timeout: 15000 });
    ok(fx.polls.length >= 2 && fx.polls.every(poll => poll.select === CONTRACT_SELECT && poll.uuid === `eq.${sent.p_command_uuid}`), 'every poll uses the contract select and the submitted command_uuid');
    ok((await sheet(page).innerText()).includes('已退回待做池，這台現在沒有工單。'), 'applied: plain result sentence');
    await page.waitForFunction(() => { const card = [...document.querySelectorAll('#workOrderGrid .machine-tile-card')].find(c => c.querySelector('h2')?.textContent.trim().startsWith('A01')); return card && !card.innerHTML.includes('TEST-ON-A01'); }, null, { timeout: 15000 });
    ok(!(await cardHtml(page)).includes('data-return-claim-open'), 'applied: after the reload the A01 card is empty and has no return button');
    ok(await page.evaluate(() => localStorage.getItem('machtile.returnClaimPending.v1')) === '{}', 'applied: nothing left pending in storage');
    const pollsAtEnd = fx.polls.length;
    await page.waitForTimeout(2500);
    ok(fx.polls.length === pollsAtEnd && fx.submits.length === 1, 'after the terminal status: no more polls, no resubmit');
    await ctx.close();
  }

  // ---- 伺服器拒絕：一句白話、不顯示代碼、沒有重送鈕
  for (const [code, sentence] of [['NOT_CLAIM_OWNER', '這張單不是你接的，你不能退回。請找接單的人或生管。'], ['BRAND_NEW_UNKNOWN_CODE', '沒有退回成功。請重新整理畫面確認這台的工單；還是不對請找生管。']]) {
    reset({ flag: true, submitMode: code });
    const { ctx, page } = await openApp();
    await page.locator('[data-return-claim-open="A01"]').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-confirm]:not([disabled])'));
    await sheet(page).locator('[data-return-claim-confirm]').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-result="failed"]'));
    const text = await sheet(page).innerText();
    ok(text.includes(sentence) && !text.includes(code), `${code}: one plain sentence, raw code not shown`);
    ok(await sheet(page).locator('[data-return-claim-confirm]').count() === 0 && fx.polls.length === 0, `${code}: no resend button, no polling`);
    await sheet(page).locator('[data-return-claim-close]').click();
    ok(await page.locator('#workOrderGrid [data-station-cmd="start"][data-station-cmd-machine="A01"]').isEnabled(), `${code}: start button is not left locked`);
    await ctx.close();
  }

  // ---- 送出時斷線：不自動重送；「用同一筆重送」＝同一個 uuid、同樣內容
  reset({ flag: true, submitMode: 'network' });
  {
    const { ctx, page } = await openApp();
    await page.locator('[data-return-claim-open="A01"]').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-confirm]:not([disabled])'));
    await sheet(page).locator('[data-return-claim-confirm]').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-result="uncertain"]'));
    ok((await sheet(page).innerText()).includes('網路不穩，還不知道有沒有送到。'), 'network cut: uncertain message');
    await page.waitForTimeout(4500);
    ok(fx.submits.length === 1 && fx.polls.length >= 1, 'network cut: the app only polls, it does not resubmit by itself');
    fx.submitMode = 'accept';
    await sheet(page).locator('[data-return-claim-confirm]').click();
    await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-return-claim-status="pending"]'));
    ok(fx.submits.length === 2 && JSON.stringify(fx.submits[1]) === JSON.stringify(fx.submits[0]), 'resend: same command_uuid and identical body');
    await ctx.close();
  }

  // ---- 管理員／生管：原因必填
  reset({ flag: true, role: 'planner' });
  {
    const { ctx, page } = await openApp();
    await page.locator('[data-return-claim-open="A01"]').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-confirm]:not([disabled])'));
    ok(await sheet(page).locator('[data-return-claim-reason]').count() === 1 && (await sheet(page).innerText()).includes('退回原因（必填）'), 'planner: reason field is shown');
    await sheet(page).locator('[data-return-claim-confirm]').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-reason-error]'));
    ok(fx.submits.length === 0 && (await sheet(page).innerText()).includes('代退要寫原因，請填一句話。'), 'planner: empty reason is not sent');
    await sheet(page).locator('[data-return-claim-reason]').fill('  代退：接錯機台  ');
    await sheet(page).locator('[data-return-claim-confirm]').click();
    await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-return-claim-status="pending"]'));
    ok(fx.submits.length === 1 && fx.submits[0].p_reason === '代退：接錯機台', 'planner: typed reason is sent trimmed as p_reason');
    await ctx.close();
  }

  // ---- 不該出現的情況
  for (const [label, extra] of [['process already running', { procStatus: 'running' }], ['pool row not claimed (gone)', { poolStatus: 'gone' }], ['pool status unknown', { poolStatus: '' }], ['manager role', { role: 'manager' }]]) {
    reset({ flag: true, ...extra });
    const { ctx, page } = await openApp();
    ok((await cardHtml(page)).includes('TEST-ON-A01') && await page.locator('[data-return-claim-open]').count() === 0, `button hidden: ${label}`);
    await ctx.close();
  }

  // ---- MAJOR 2：舊的「退回池子」（dispatch_pool_return，只動雲端）不跟新按鈕並存
  const OLD_BUTTON = `<button type="button" class="card-select-entry pool-return-action" data-no-detail="" data-pool-return="${POOL_KEY}" data-pool-return-machine="A01">退回池子</button>`;
  const BUSY = '這台有一筆「退回接單」還在等工廠處理，等它有結果再操作。';
  const toastText = page => page.evaluate(() => document.getElementById('toast')?.textContent || '');
  const submitReturn = async (page, reason) => {
    await page.locator('[data-return-claim-open="A01"]').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-confirm]:not([disabled])'));
    if (reason) await sheet(page).locator('[data-return-claim-reason]').fill(reason);
    await sheet(page).locator('[data-return-claim-confirm]').click();
    await page.waitForFunction(() => document.querySelector('#workOrderGrid [data-return-claim-status="pending"]'));
    await sheet(page).locator('[data-return-claim-close]').click();
  };
  reset({ role: 'planner' }); const plannerAbsent = await openApp(); const htmlPlannerAbsent = await cardHtml(plannerAbsent.page); await plannerAbsent.ctx.close();
  reset({ flag: false, role: 'planner' });
  {
    const { ctx, page } = await openApp();
    const htmlPlannerOff = await cardHtml(page);
    ok(htmlPlannerOff.split(OLD_BUTTON).length === 2 && htmlPlannerOff === htmlPlannerAbsent, 'flag off (planner): the old 「退回池子」 button is on the card exactly as today (byte-identical, flag missing or false)');
    ok(await page.locator('[data-return-claim-open]').count() === 0, 'flag off (planner): no new button');
    await page.locator('[data-card-select-open="A01"]').click();
    ok(await page.locator('#machtileCardSelection').count() === 1, 'flag off (planner): 選工單 opens the selection panel as today');
    await ctx.close();
    reset({ flag: true, role: 'planner' });
    const on = await openApp();
    const htmlPlannerOn = await cardHtml(on.page);
    ok(!htmlPlannerOn.includes('data-pool-return=') && htmlPlannerOn.split(BUTTON).length === 2, 'flag on (planner): the old cloud-only button is hidden; only 「接錯了，退回」 is offered');
    ok(htmlPlannerOn.replace(BUTTON, '') === htmlPlannerOff.replace(OLD_BUTTON, ''), 'flag on (planner): the card differs from flag off only by old button → new button');
    const oldHandler = await on.page.evaluate(async key => { let prompts = 0; window.prompt = () => { prompts += 1; return 'x'; }; await machtileReturnDispatchPool(key); return prompts; }, POOL_KEY);
    ok(oldHandler === 0 && !writes.includes('/rest/v1/rpc/dispatch_pool_return'), 'flag on: the old handler does nothing even when called directly (no prompt, no dispatch_pool_return)');
    await on.page.locator('[data-card-select-open="A01"]').click();
    await on.page.waitForSelector('#machtileCardSelection');
    ok(await on.page.locator('#machtileCardSelection [data-pool-return]').count() === 0, 'flag on: the selection panel does not offer the old button either');
    await on.page.locator('#machtileCardSelection [data-close-card-selection]').click();
    // MAJOR 4（選工單入口）：退回等待中 → 選工單被擋，說的是「退回」
    await submitReturn(on.page, '代退：接錯機台');
    ok(await on.page.locator('#workOrderGrid [data-pool-return]').count() === 0, 'pending return: the old button is not on the card');
    await on.page.locator('[data-card-select-open="A01"]').click();
    await on.page.waitForTimeout(200);
    ok(await on.page.locator('#machtileCardSelection').count() === 0 && await toastText(on.page) === BUSY, 'pending return: 選工單 does not open; the toast says a return is being processed');
    ok(!BUSY.includes('開工') && !BUSY.includes('停工') && BUSY.includes('退回'), 'the blocking sentence is about the return, not start/stop');
    await on.page.locator('[data-card-select-open="A02"]').click();
    ok(await on.page.locator('#machtileCardSelection').count() === 1, 'pending return on A01: 選工單 on another machine (A02) still opens');
    await on.ctx.close();
  }

  // ---- MAJOR 4：退回等待中，其他入口（待做池入口、接單、批次開工／停工、批次報工、智慧報工）都被擋下來
  reset({ flag: false });
  const batchChoice = page => page.evaluate(() => JSON.stringify(['start', 'stop'].map(type => machtileBatchCommandChoice('A01', type))));
  const openBatch = async page => {
    await page.evaluate(() => switchView('batchLathe'));
    await page.waitForFunction(() => document.querySelector('[data-batch-root="lathe"] [data-batch-row="A01"]') && typeof machtileBatchState !== 'undefined' && machtileBatchState.loading === false);
  };
  let batchOff;
  {
    const { ctx, page } = await openApp();
    await page.locator('[data-card-pool-open="A01"]').click();
    ok(await page.locator('#machtileCardSelection').count() === 1, 'flag off (operator): the pool entry on the card opens as today');
    await page.locator('#machtileCardSelection [data-close-card-selection]').click();
    await openBatch(page);
    batchOff = { choice: await batchChoice(page), panel: await page.locator('[data-batch-command-panel] .batch-command-machine').first().innerHTML() };
    await ctx.close();
  }
  reset({ flag: true });
  {
    const { ctx, page } = await openApp();
    await openBatch(page);
    ok(await batchChoice(page) === batchOff.choice && await page.locator('[data-batch-command-panel] .batch-command-machine').first().innerHTML() === batchOff.panel, 'flag on, nothing pending: batch start/stop row for A01 is identical to flag off: ' + batchOff.choice);
    ok(JSON.parse(batchOff.choice)[0].eligible === true, 'fixture: A01 is eligible for batch start before the return');
    await page.evaluate(() => switchView('dashboard'));
    await submitReturn(page);
    // 卡片上的待做池入口、接單
    await page.locator('[data-card-pool-open="A01"]').click();
    await page.waitForTimeout(200);
    ok(await page.locator('#machtileCardSelection').count() === 0 && await toastText(page) === BUSY, 'pending return: the pool entry (接單) on the card does not open; the toast says a return is being processed');
    await page.evaluate(key => machtileClaimDispatchPool(key, 'A01'), POOL_KEY);
    ok(!writes.includes('/rest/v1/rpc/dispatch_pool_claim'), 'pending return: a direct claim call sends nothing');
    // 批次頁：開工／停工
    await openBatch(page);
    const choices = JSON.parse(await batchChoice(page));
    ok(choices.every(choice => choice.eligible === false && choice.checked === false) && choices[0].reason === BUSY, 'pending return: neither batch start nor batch stop is eligible for A01; batch start (eligible before) now gives the return sentence as its reason; stop: ' + choices[1].reason);
    const row = page.locator('[data-batch-command-panel] .batch-command-machine').first();
    ok((await row.innerText()).includes('A01') && (await row.innerText()).includes(BUSY) && await row.locator('[data-batch-command-select="A01"]').isDisabled(), 'pending return: the batch start/stop row shows the return sentence and its checkbox is disabled');
    ok(await page.locator('[data-batch-command-submit]').isDisabled(), 'pending return: the batch start/stop button has nothing to send');
    // 批次報工（直送 field_report_upsert 那條）與智慧報工
    const blockedBatch = await page.evaluate(() => { const hit = machtileReturnClaimBatchBlock(['A02', 'A01']); return { hit, formError: machtileBatchState.formError, shown: document.querySelector('[data-batch-root="lathe"] .batch-notice.is-error')?.textContent || '' }; });
    ok(blockedBatch.hit === true && blockedBatch.formError === `A01：${BUSY}` && blockedBatch.shown === `A01：${BUSY}`, 'pending return: a batch report that contains A01 is stopped as a whole with the return sentence in red');
    const smart = await page.evaluate(async () => { await machtileStationReportSubmitPreview('A01', { batch: true }); return machtileStationReportState(machtileBatchRow('A01')).error; });
    ok(smart === BUSY, 'pending return: the smart-report preview (station report panel / batch smart report) is blocked with the return sentence');
    ok(fx.submits.length === 1 && writes.filter(p => p !== '/rest/v1/rpc/machtile_submit_return_claim_command').length === 0, 'pending return: none of the blocked entry points sent a write');
    // 工廠回覆結果不確定 → 不說沒有退回；鎖解除
    fx.command = { ...fx.command, status: 'rejected', reject_code: 'OUTCOME_UNKNOWN', reject_message: 'raw factory text' };
    await page.waitForFunction(() => machtileReturnClaimBlockMessage('A01') === '', null, { timeout: 15000 });
    const uncertainToast = await toastText(page);
    ok(uncertainToast.includes('不確定') && uncertainToast.includes('重新整理') && uncertainToast.includes('生管') && !uncertainToast.includes('沒有退回') && !uncertainToast.includes('OUTCOME_UNKNOWN') && !uncertainToast.includes('raw factory text'), 'factory OUTCOME_UNKNOWN: the result is shown as uncertain (refresh / ask planner), never as "did not return": ' + uncertainToast);
    ok(JSON.parse(await batchChoice(page))[0].reason !== BUSY, 'after the result the batch page is no longer blocked by the return');
    await ctx.close();
  }

  // ---- MINOR 8／7：別人的等待紀錄不還原；自己的還原；卡片換單後不再顯示
  {
    const stored = who => JSON.stringify({ A01: { commandUuid: '3f0c1a52-7c1e-4b7e-9d43-2f6a8f1f0a11', machineCode: 'A01', orderNo: who.orderNo || 'TEST-ON-A01', step: 1, processId: id(301), tenantId: who.tenantId, appUserId: who.appUserId,
      args: { p_command_uuid: '3f0c1a52-7c1e-4b7e-9d43-2f6a8f1f0a11', p_machine_code: 'A01', p_pool_item_id: POOL_KEY, p_expected_order_no: who.orderNo || 'TEST-ON-A01', p_expected_index_sn: 1, p_expected_part_no: 'TEST-PART', p_reason: null },
      startedAt: Date.now(), unconfirmed: who.unconfirmed === true, notFound: who.notFound === true, lastStatus: who.unconfirmed ? null : 'pending' } });
    for (const [label, who, locked] of [['another user of the same tenant', { tenantId: tenant, appUserId: id(903) }, false], ['another tenant', { tenantId: id(2), appUserId: actor }, false],
      ['a record without tenant/user', { tenantId: '', appUserId: '' }, false], ['the same tenant and user', { tenantId: tenant, appUserId: actor }, true]]) {
      reset({ flag: true, storedPending: stored(who) });
      const { ctx, page } = await openApp();
      const state = await page.evaluate(() => ({ locked: machtileReturnClaimLocks('A01'), kept: localStorage.getItem('machtile.returnClaimPending.v1') }));
      ok(state.locked === locked && await page.locator('#workOrderGrid [data-return-claim-status="pending"]').count() === (locked ? 1 : 0) && await page.locator('#workOrderGrid [data-return-claim-open="A01"]').count() === (locked ? 0 : 1),
        `stored pending record of ${label}: ${locked ? 'restored, card locked and polled' : 'not restored, card not locked'}`);
      if (locked) await page.waitForTimeout(3500);
      ok(locked ? (fx.polls.length >= 1 && fx.polls.every(poll => poll.uuid === 'eq.3f0c1a52-7c1e-4b7e-9d43-2f6a8f1f0a11' && poll.select === CONTRACT_SELECT)) : (fx.polls.length === 0 && state.kept === fx.storedPending), `stored pending record of ${label}: ${locked ? 'same uuid is polled, nothing resubmitted' : 'left untouched in storage, never polled'}`);
      ok(fx.submits.length === 0, `stored pending record of ${label}: nothing is submitted on load`);
      await ctx.close();
    }
    // 自己的 notFound 紀錄，但卡片已經是別張單 → 不顯示「這張單還在這台」，沒有重送／不退了
    reset({ flag: true, storedPending: stored({ tenantId: tenant, appUserId: actor, orderNo: 'TEST-OLD-ORDER', unconfirmed: true, notFound: true }) });
    const { ctx, page } = await openApp();
    ok(await page.evaluate(() => Boolean(machtileReturnClaim.pending.A01?.notFound)) && await page.locator('#workOrderGrid [data-return-claim-status], #workOrderGrid [data-return-claim-retry], #workOrderGrid [data-return-claim-dismiss]').count() === 0
      && await page.locator('#workOrderGrid [data-return-claim-open="A01"]').count() === 1, 'own not-found record for an order that is no longer on the card: not rendered; the card shows the plain button for the current order');
    // session 過期 → 重新登入（同一個人）：自己的紀錄還在；換成別人 → 放掉
    reset({ flag: true, storedPending: stored({ tenantId: tenant, appUserId: actor }) });
    const again = await openApp();
    const relogin = await again.page.evaluate(async other => {
      const before = machtileReturnClaimLocks('A01');
      machtileAuthState.appUserId = other;            // 換人登入後 app_users 查到的是另一個人
      machtileStationCmdRestorePendingEarly();        // 登入後 machtileResumeInit → loadFromSupabase({ deferSecondary: true }) 會叫的同一個掛點
      const asOther = machtileReturnClaimLocks('A01');
      const kept = Boolean(JSON.parse(localStorage.getItem('machtile.returnClaimPending.v1') || '{}').A01);
      machtileAuthState.appUserId = '';
      await machtileResumeInit();                      // 真的走一次登入後的重新載入（重查 app_users）
      return { before, asOther, kept, after: machtileReturnClaimLocks('A01'), user: machtileAuthState.appUserId };
    }, id(903));
    ok(relogin.before === true && relogin.asOther === false && relogin.kept === true, 're-login as another user without a page reload: the previous user\'s pending return no longer locks the card (record stays in storage)');
    ok(relogin.after === true && relogin.user === actor, 're-login as the same user (post-login resume path): the pending return is restored again');
    await again.ctx.close();
    await ctx.close();
  }

  // ---- 機台上掛的不是這張工單第一次被接的那一道（work_orders.external_ref 停在第一次那一道，雲端 on conflict 不更新它）
  const FIRST_KEY = '01|TESTNEED0001|TEST-SIM-FIRST', HELD_KEY = '01|TESTNEED0001|TEST-SIM-STEP2';
  const heldRow = (extra = {}) => ({ source_key: HELD_KEY, work_order_no: order.work_order_no, process_order: 2, status: 'claimed', ...extra });
  // external_ref 那一列（第 1 道）已經退回池子＝waiting；機台上是第 2 道，池裡第 2 道 claimed
  reset({ flag: true, externalRef: FIRST_KEY, step: 2, poolStatus: 'waiting', heldRows: [heldRow(), heldRow({ source_key: '01|TESTNEED0009|OTHER', work_order_no: 'TEST-OTHER-ORDER' })] });
  {
    const { ctx, page } = await openApp();
    ok(await page.locator('.machine-tile-card [data-return-claim-open="A01"]').count() === 1, 'held step ≠ first-claimed step: 「接錯了，退回」 shows (it was hidden when the key came from external_ref)');
    await page.locator('[data-return-claim-open="A01"]').click();
    await page.waitForFunction(() => document.querySelector('#machtileReturnClaimSheet [data-return-claim-confirm]:not([disabled])'));
    ok((await sheet(page).innerText()).includes('第 2 道'), 'held step ≠ first-claimed step: the sheet names the held step');
    await sheet(page).locator('[data-return-claim-confirm]').click();
    await page.waitForFunction(() => document.querySelector('[data-return-claim-status="pending"]'));
    const sent = fx.submits.at(-1);
    ok(fx.submits.length === 1 && sent.p_pool_item_id === HELD_KEY && sent.p_expected_index_sn === 2 && sent.p_expected_order_no === 'TEST-ON-A01',
      'held step ≠ first-claimed step: the return carries the pool row of the held step (' + sent.p_pool_item_id + '), not external_ref');
    ok(sent.p_pool_item_id !== FIRST_KEY, 'held step ≠ first-claimed step: external_ref is not sent');
    await ctx.close();
  }
  // ---- 查不到唯一的一列＝不猜、不出按鈕
  for (const [label, extra] of [
    ['two claimed pool rows for the held step', { heldRows: [heldRow(), heldRow({ source_key: '01|TESTNEED0001|TEST-SIM-DUP' })] }],
    ['no claimed pool row for the held step (only another step of this order is claimed)', { heldRows: [heldRow({ process_order: 3 })] }],
    ['no claimed pool row at all, although the external_ref row itself says claimed', { heldRows: [], poolStatus: 'claimed' }],
  ]) {
    reset({ flag: true, externalRef: FIRST_KEY, step: 2, poolStatus: 'waiting', ...extra });
    const { ctx, page } = await openApp();
    ok(fx.heldQueries.length >= 1 && await page.locator('[data-return-claim-open], #machtileReturnClaimSheet').count() === 0, `ambiguous lookup hides the button: ${label}`);
    ok(await page.evaluate(async () => { await machtileReturnClaimOpen('A01', null); return document.getElementById('machtileReturnClaimSheet') === null; }) && fx.submits.length === 0, `ambiguous lookup: the open handler does nothing either: ${label}`);
    await ctx.close();
  }

  // ---- 越南文
  reset({ flag: true });
  {
    const { ctx, page } = await openApp('vi');
    ok((await page.locator('[data-return-claim-open="A01"]').innerText()).includes('Nhận nhầm, trả lại'), 'vi: button text is Vietnamese');
    await ctx.close();
  }

  ok(writes.every(p => p === '/rest/v1/rpc/machtile_submit_return_claim_command'), 'the only write sent in every scenario is the return-claim RPC: ' + [...new Set(writes)].join(','));
  ok(blocked.length === 0, 'no real backend or non-GET local request: ' + blocked.join(','));
  ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
  console.log(`${checks}/${checks} return-claim browser checks passed`);
} finally {
  await browser.close(); server.close();
}
