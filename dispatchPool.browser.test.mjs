// 派工待做池第 2 步（只讀）：actual local index/app, synthetic TEST-* fixtures, every backend request intercepted.
// MACHTILE_PLAYWRIGHT_MODULE=<playwright/index.mjs> node dispatchPool.browser.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const imported = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = imported.default || imported;
const fake = 'https://pool-fixture.test', id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1), auth = id(901), actor = id(902);
const machineRows = [
  { id: id(101), machine_code: 'A01', name: 'A01', department_name: '車床課', status: 'idle', machine_type: 'lathe', display_order: 1 },
  { id: id(102), machine_code: 'A02', name: 'A02', department_name: '車床課', status: 'idle', machine_type: 'lathe', display_order: 2 },
  { id: id(103), machine_code: 'A03', name: 'A03', department_name: '車床課', status: 'idle', machine_type: 'lathe', display_order: 3 },
  { id: id(104), machine_code: 'A04', name: 'A04', department_name: '車床課', status: 'idle', machine_type: 'lathe', display_order: 4 },
  { id: id(105), machine_code: 'A05', name: 'A05', department_name: '車床課', status: 'idle', machine_type: 'lathe', display_order: 5 },
  { id: id(121), machine_code: 'B01', name: 'B01', department_name: '銑床課', status: 'idle', machine_type: 'mill', display_order: 21 },
  { id: id(122), machine_code: 'B02', name: 'B02', department_name: '銑床課', status: 'idle', machine_type: 'mill', display_order: 22 },
  { id: id(123), machine_code: 'B03', name: 'B03', department_name: '銑床課', status: 'idle', machine_type: 'mill', display_order: 23 },
  { id: id(124), machine_code: 'B04', name: 'B04', department_name: '銑床課', status: 'idle', machine_type: 'mill', display_order: 24 },
  { id: id(125), machine_code: 'B05', name: 'B05', department_name: '銑床課', status: 'idle', machine_type: 'mill', display_order: 25 },
  { id: id(126), machine_code: 'B06', name: 'B06', department_name: '銑床課', status: 'idle', machine_type: 'mill', display_order: 26 },
  { id: id(131), machine_code: 'C01', name: 'C01', department_name: '其他課', status: 'idle', machine_type: 'other', display_order: 31 },
];
const order = { id: id(201), work_order_no: 'TEST-ON-A01', part_no: 'TEST-PART', part_name: '測試零件', quantity: 50, due_date: '2026-10-20', status: 'in_progress', source_system: 'app_manual', created_by: actor, legacy_mes_source: 'dispatch_pool', external_ref: '01|TESTNEED0001|TEST-SIM-1' };
const proc = { id: id(301), work_order_id: id(201), process_order: 1, process_name: '車削', process_type: 'cnc', machine_id: id(101), status: 'pending', qty_completed: 0, qty_defect: 0 };
const poolRows = [
  { source_key: '01|TESTNEED0001|TEST-SIM-1', work_order_no: 'TEST-POOL-L2', process_order: 2, operation_name: 'CNC車床加工-1/2', part_no: 'TEST-P1', part_name: '測試軸', quantity: 120, due_date: '2026-10-20', planned_start: '2026-10-08T00:00:00Z', urgency: 2, department_code: 'LATHE', eligible_machine_codes: ['A01', 'A02', 'A03', 'A04', 'A05'], source_status: 'pending', synced_at: '2026-10-07T02:30:00Z' },
  { source_key: '01|TESTNEED0002|TEST-SIM-2', work_order_no: 'TEST-POOL-L1', process_order: 1, operation_name: '車削', part_no: 'TEST-P2', part_name: '測試套', quantity: null, due_date: '2026-10-30', planned_start: null, urgency: 1, department_code: 'LATHE', eligible_machine_codes: ['A02'], source_status: 'returned', synced_at: '2026-10-07T02:30:00Z' },
  { source_key: '01|TESTNEED0003|TEST-SIM-3', work_order_no: 'TEST-POOL-M1', process_order: 3, operation_name: 'MCV臥式加工', part_no: 'TEST-P3', part_name: '測試座', quantity: 300, due_date: '2026-10-25', planned_start: '2026-10-09T01:00:00Z', urgency: 3, department_code: 'MILL', eligible_machine_codes: ['B03'], source_status: 'pending', synced_at: '2026-10-07T02:30:00Z' },
];
let checks = 0, poolMode = 'rows', poolQueries = [], dispatchPoolMachines = [], claimWinner = '', claimRequests = [], releaseRequests = [], returnRequests = [], exposeAssignedOrder = true, assignedPoolStatus = 'claimed';
let access = { tenant_id: tenant, role: 'planner', all_departments: true, is_bridge: false, department_codes: ['LATHE', 'MILL'] };
const blocked = [], errors = [], mutations = [];
const ok = (value, label) => { assert(value, label); checks++; console.log('PASS ' + label); };
const rolloutConfig = await readFile(path.join(root, 'config.js'), 'utf8');
const rolloutIndex = await readFile(path.join(root, 'index.html'), 'utf8');
const rolloutVersions = new Map([...rolloutIndex.matchAll(/(?:src|href)=["']\.\/([^"'?]+)\?v=([^"']+)/g)].map(match => [match[1], match[2]]));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => { if (req.method !== 'GET') { res.writeHead(405); res.end(); return; } const u = new URL(req.url, 'http://localhost'); const file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname))); if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; } try { res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); } catch { res.writeHead(404); res.end(); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const out = process.env.MACHTILE_SCREENSHOT_DIR || path.join(root, 'output/playwright/dispatch-pool'); await mkdir(out, { recursive: true });

async function openApp(role, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
  const token = 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ sub: auth, exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: { tenant_id: tenant, role }, role: 'authenticated' })).toString('base64url') + '.test';
  await ctx.addInitScript(token => sessionStorage.setItem('machtileAuthSession', JSON.stringify({ version: 1, accessToken: token, refreshToken: '', email: 'user@test.invalid', authMethod: 'password', mode: 'session', createdAt: Date.now(), rememberUntil: 0 })), token);
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.url().startsWith(base)) {
      if (u.pathname === '/config.js') return route.fulfill({ contentType: 'text/javascript', body: `window.MACHTILE_CONFIG={useSupabase:true,authMode:'strict',tenantId:'${tenant}',useTenantHeaderAuth:true,supabaseUrl:'${fake}',supabaseAnonKey:'fixture-public',oauthEnabled:false,disableServiceWorker:true,enableOutboxSubmit:false,enableProgramUpload:false,enableScheduleContracts:false,enableAccountDelete:false,enableJevTriage:false,enableFaceStatus:false,useHmcWorklistSupabase:false,hmcFixedStagingEnabled:false,dispatchPoolMachines:${JSON.stringify(dispatchPoolMachines)}};` });
      if (req.method() !== 'GET') { blocked.push(req.url()); return route.abort(); }
      return route.continue();
    }
    if (u.origin !== fake) { blocked.push(req.url()); return route.abort(); }
    const p = u.pathname;
    if (p.includes('dispatch_pool')) {
      if (p === '/rest/v1/rpc/dispatch_pool_claim' && req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}'); claimRequests.push(body); mutations.push(p);
        await new Promise(resolve => setTimeout(resolve, 30));
        if (claimWinner) return json(409, { message: 'POOL_ITEM_NOT_WAITING' });
        claimWinner = body.p_machine_code;
        return json(200, { action: 'claimed', source_key: body.p_source_key, machine_code: body.p_machine_code });
      }
      if (p === '/rest/v1/rpc/dispatch_pool_claim_release' && req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}'); releaseRequests.push(body); mutations.push(p);
        if (!['admin', 'planner'].includes(access.role)) return json(403, { message: 'DISPATCH_POOL_CLAIM_RELEASE_FORBIDDEN' });
        return json(200, { action: 'released', source_key: body.p_source_key });
      }
      if (p === '/rest/v1/rpc/dispatch_pool_return' && req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}'); returnRequests.push(body); mutations.push(p);
        if (!['planner', 'admin'].includes(access.role)) return json(403, { message: 'DISPATCH_POOL_RETURN_FORBIDDEN' });
        claimWinner = '';
        return json(200, { action: 'returned', source_key: body.p_source_key, returned_by: auth, reason: body.p_reason });
      }
      if (req.method() !== 'GET') { mutations.push(p); return json(403, { message: 'fixture: unexpected pool write' }); }
      poolQueries.push(u.search);
      if ((u.searchParams.get('select') || '') === 'source_key,status') {
        return json(200, assignedPoolStatus ? [{ source_key: order.external_ref, status: assignedPoolStatus }] : []);
      }
      if (poolMode === 'missing') return json(404, { code: 'PGRST205', message: "Could not find the table 'public.dispatch_pool_items' in the schema cache" });
      if (poolMode === 'error') return json(503, { message: 'fixture pool unavailable' });
      if (poolMode === 'empty') return json(200, []);
      // Server RLS: same tenant AND the caller's departments.
      return json(200, poolRows.filter(r => !claimWinner || r.source_key !== '01|TESTNEED0001|TEST-SIM-1').filter(r => access.all_departments || access.department_codes.includes(r.department_code)));
    }
    if (req.method() !== 'GET' && !['/rest/v1/rpc/batch_report_progress', '/rest/v1/rpc/machine_department_context'].includes(p)) mutations.push(p);
    if (p === '/auth/v1/user') return json(200, { id: auth, email: 'user@test.invalid' });
    if (p === '/rest/v1/app_users') return json(200, [{ id: actor, auth_user_id: auth, name: '測試使用者', legacy_user_id: 'TEST-001', role, is_active: true }]);
    if (p === '/rest/v1/rpc/machine_department_context') return json(200, access);
    if (p === '/rest/v1/machines' || p === '/rest/v1/v_machine_management_cards') {
      const rows = machineRows.filter(m => access.all_departments || access.department_codes.includes(m.department_name === '車床課' ? 'LATHE' : 'MILL'));
      return json(200, p.endsWith('/v_machine_management_cards') ? rows.map(({ id, name, ...row }) => ({ ...row, machine_id: id, machine_name: name })) : rows);
    }
    if (p === '/rest/v1/work_orders') return json(200, exposeAssignedOrder ? [{ ...order, work_order_processes: [proc] }] : []);
    if (p === '/rest/v1/work_order_processes') {
      if (!exposeAssignedOrder) return json(200, []);
      if ((u.searchParams.get('select') || '').includes('work_orders!inner')) return json(200, [{ ...proc, off_station_at: null, work_orders: order, machines: machineRows[0] }]);
      return json(200, [proc]);
    }
    if (p === '/rest/v1/v_work_order_cards') return json(200, exposeAssignedOrder ? [{ id: order.id, tenant_id: tenant, work_order_no: order.work_order_no, part_name: order.part_name, quantity: order.quantity, due_date: order.due_date, work_order_status: order.status, current_process_id: proc.id, current_process_name: proc.process_name, current_process_status: proc.status, machine_name: 'A01', qty_completed: 0, qty_defect: 0, current_process_off_station: false }] : []);
    if (p === '/rest/v1/rpc/batch_report_progress') return json(200, []);
    return json(200, []);
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('dataSourceLabel')?.textContent.includes('Supabase'));
  await page.waitForFunction(() => typeof machtileDispatchPoolState !== 'undefined' && machtileDispatchPoolState.status !== 'idle');
  return { ctx, page };
}
const poolKeys = page => page.locator('#machtileCardSelection [data-card-selection-pool] [data-pool-key]').evaluateAll(xs => xs.map(x => x.getAttribute('data-pool-key')));

try {
  ok(/dispatchPoolMachines:\s*\["A01",\s*"A02",\s*"A03",\s*"A04",\s*"A05",\s*"B01",\s*"B02",\s*"B03",\s*"B04",\s*"B05",\s*"B06"\]/.test(rolloutConfig), 'rollout config enables all lathes A01-A05 and all machining centers B01-B06');
  const configVersion = rolloutVersions.get('config.js');
  ok(Boolean(configVersion) && rolloutIndex.includes(`config.js?v=${configVersion}`), 'rollout config cache key matches index.html');
  ok(['app.js', 'i18n.js', 'styles.css'].every(asset => new RegExp(`${asset.replace(".", "\\.")}\\?v=[^\"\\s]+`).test(rolloutIndex)), 'return-state app, translations, and styles have cache keys');
  for (const width of [1440, 390]) {
    poolMode = 'rows'; poolQueries = [];
    access = { tenant_id: tenant, role: 'planner', all_departments: true, is_bridge: false, department_codes: ['LATHE', 'MILL'] };
    const { ctx, page } = await openApp('planner', width);
    const waitingPoolQueries = poolQueries.filter(q => q.includes('status=eq.waiting'));
    ok(waitingPoolQueries.length >= 1 && waitingPoolQueries.every(q => q.includes('order=urgency.asc,due_date.asc.nullslast,planned_start.asc.nullslast')), `${width}: reads waiting pool rows in owner order`);
    ok(await page.locator('[data-card-pool-open]').count() === 0, `${width}: planner keeps 選擇工單 (no operator pool entry)`);
    await page.locator('[data-card-select-open="A01"]').click();
    ok(await page.locator('#machtileCardSelection [data-card-selection-assigned]').count() === 1 && await page.locator('#machtileCardSelection [data-card-selection-unassigned]').count() === 1, `${width}: existing assigned / unassigned sections unchanged`);
    ok((await page.locator('#machtileCardSelection h3').allInnerTexts()).includes('待做池（同課）'), `${width}: 待做池（同課） section present`);
    ok(JSON.stringify(await poolKeys(page)) === JSON.stringify(['01|TESTNEED0002|TEST-SIM-2', '01|TESTNEED0001|TEST-SIM-1']), `${width}: lathe card lists only LATHE items, urgency 1 first`);
    const first = page.locator('#machtileCardSelection [data-pool-key="01|TESTNEED0002|TEST-SIM-2"]');
    ok((await first.locator('[data-pool-urgency]').innerText()) === '緊急 1' && await first.locator('.pool-urgency.is-u1').count() === 1, `${width}: urgency badge`);
    const firstText = await first.innerText();
    ok(firstText.includes('N1 車削') && firstText.includes('測試套') && firstText.includes('退回待接'), `${width}: work order, operation, part, returned flag`);
    ok(firstText.includes('數量 未提供') && firstText.includes('交期 10/30') && firstText.includes('APS 預計開始 未提供'), `${width}: unknown qty / planned start shown as 未提供 (no guessed values)`);
    ok(firstText.includes('可做機台 A02') && firstText.includes('A01 不在清單') && await first.evaluate(x => x.classList.contains('is-not-eligible')), `${width}: eligibility of this machine shown`);
    const second = await page.locator('#machtileCardSelection [data-pool-key="01|TESTNEED0001|TEST-SIM-1"]').innerText();
    ok(second.includes('N2 CNC車床加工-1/2') && second.includes('數量 120') && second.includes('交期 10/20') && !second.includes('不在清單'), `${width}: second item details`);
    const claims = page.locator('#machtileCardSelection [data-pool-claim]');
    ok(await claims.count() === 2 && (await claims.evaluateAll(xs => xs.every(x => x.disabled && x.textContent.includes('接單')))) && (await page.locator('.pool-claim-reason').allInnerTexts()).every(x => x.includes('尚未開放')), `${width}: default-empty flag disables every claim with a reason`);
    const before = mutations.length, poolReads = poolQueries.length;
    await claims.first().click({ force: true });
    await page.waitForTimeout(300);
    ok(mutations.length === before && poolQueries.length === poolReads && await page.locator('#machtileCardSelection').count() === 1, `${width}: clicking a disabled claim sends nothing`);
    ok((await page.locator('#machtileCardSelection .pool-note').innerText()).includes('資料時間'), `${width}: shows when the bridge last synced`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${width}: no horizontal page scroll`);
    await page.screenshot({ path: path.join(out, `planner-a01-${width}.png`) });
    await page.locator('[data-close-card-selection]').click();
    await page.locator('[data-card-select-open="B03"]').click();
    ok(JSON.stringify(await poolKeys(page)) === JSON.stringify(['01|TESTNEED0003|TEST-SIM-3']), `${width}: mill card lists only MILL items`);
    await page.locator('[data-close-card-selection]').click();
    await ctx.close();
  }

  // Operator (lathe only): RLS returns only LATHE rows; card shows a view-only pool entry, never the planner selection.
  access = { tenant_id: tenant, role: 'operator', all_departments: false, is_bridge: false, department_codes: ['LATHE'] };
  poolMode = 'rows';
  {
    const { ctx, page } = await openApp('operator', 390);
    ok(await page.locator('[data-card-select-open]').count() === 0, 'operator: no 選擇工單 (cannot schedule)');
    ok(await page.locator('[data-card-pool-open="B03"]').count() === 0, 'operator: no foreign-department card/entry');
    const entryA01 = page.locator('[data-card-pool-open="A01"]');
    ok(await entryA01.count() === 1 && (await entryA01.innerText()).includes('待做池（同課）1 張'), 'operator: A01 count excludes the step A01 is not eligible for');
    await entryA01.click();
    ok(JSON.stringify(await poolKeys(page)) === JSON.stringify(['01|TESTNEED0001|TEST-SIM-1']) && await page.locator('#machtileCardSelection .is-not-eligible').count() === 0, 'operator: steps this machine cannot take are hidden (planner still sees them dimmed)');
    await page.locator('[data-close-card-selection]').click();
    const entry = page.locator('[data-card-pool-open="A02"]');
    ok(await entry.count() === 1 && (await entry.innerText()).includes('待做池（同課）2 張'), 'operator: same-department pool entry with count');
    await entry.click();
    ok((await page.locator('#cardSelectionTitle').innerText()).includes('A02 待做池'), 'operator: pool-only dialog');
    ok(await page.locator('#machtileCardSelection [data-card-selection-assigned], #machtileCardSelection [data-card-select-process]').count() === 0, 'operator: no selection buttons in pool-only dialog');
    ok(JSON.stringify(await poolKeys(page)) === JSON.stringify(['01|TESTNEED0002|TEST-SIM-2', '01|TESTNEED0001|TEST-SIM-1']), 'operator: own department items in owner order');
    ok(await page.locator('#machtileCardSelection [data-pool-claim]:not([disabled])').count() === 0, 'operator: claim disabled');
    ok(await page.locator('[data-pool-return], [data-pool-release]').count() === 0, 'operator: no return-to-pool or release-claim control anywhere');
    await page.screenshot({ path: path.join(out, 'operator-a02-390.png') });
    await ctx.close();
  }

  // Claim release is visible to admin/planner only and sends exactly the source key.
  poolMode = 'rows'; releaseRequests = [];
  for (const role of ['admin', 'planner']) {
    access = { tenant_id: tenant, role, all_departments: true, is_bridge: false, department_codes: ['LATHE', 'MILL'] };
    const { ctx, page } = await openApp(role, 1440);
    await page.locator('[data-card-select-open="A01"]').click();
    const release = page.locator('[data-pool-key="01|TESTNEED0001|TEST-SIM-1"] [data-pool-release]');
    ok(await release.count() === 1 && (await release.innerText()).includes('釋放接單'), `${role}: release-claim control is visible`);
    if (role === 'planner') {
      await release.click();
      await page.waitForFunction(() => document.body.innerText.includes('已釋放接單'));
      ok(JSON.stringify(releaseRequests.at(-1)) === JSON.stringify({ p_source_key: '01|TESTNEED0001|TEST-SIM-1' }), 'planner: release RPC sends source key only');
      ok(poolQueries.length >= 1 && await page.locator('[data-pool-key="01|TESTNEED0001|TEST-SIM-1"]').count() === 1, 'planner: successful release reloads the pool');
    }
    await ctx.close();
  }
  access = { tenant_id: tenant, role: 'manager', all_departments: true, is_bridge: false, department_codes: ['LATHE', 'MILL'] };
  {
    const { ctx, page } = await openApp('manager', 1440);
    await page.locator('[data-card-select-open="A01"]').click();
    ok(await page.locator('[data-pool-release]').count() === 0, 'manager: release-claim control is not rendered');
    await ctx.close();
  }

  // Empty pool: section says so; operator entry disappears.
  poolMode = 'empty';
  {
    const { ctx, page } = await openApp('operator', 1440);
    ok(await page.locator('[data-card-pool-open]').count() === 0, 'empty pool: no operator entry');
    await ctx.close();
  }
  // Production rollout allowlist: all lathes A01-A05 can claim; every other machine remains non-actionable.
  poolMode = 'rows'; dispatchPoolMachines = ['A01', 'A02', 'A03', 'A04', 'A05']; claimWinner = ''; exposeAssignedOrder = false;
  access = { tenant_id: tenant, role: 'operator', all_departments: false, is_bridge: false, department_codes: ['LATHE'] };
  {
    const { ctx, page } = await openApp('operator', 1440);
    for (const machine of ['A01', 'A02', 'A03', 'A04', 'A05']) {
      await page.locator(`[data-card-pool-open="${machine}"]`).click();
      const claim = page.locator('[data-pool-key="01|TESTNEED0001|TEST-SIM-1"] [data-pool-claim]');
      ok(await claim.isEnabled(), `rollout: ${machine} shows an enabled claim action`);
      await page.locator('[data-close-card-selection]').click();
    }
    ok(await page.locator('[data-card-pool-open="B01"], [data-card-pool-open="B02"], [data-card-pool-open="B03"], [data-card-pool-open="B04"], [data-card-pool-open="B05"], [data-card-pool-open="B06"], [data-card-pool-open="C01"], [data-pool-return]').count() === 0, 'rollout: B01-B06 and other machines expose no claim/return action');
    await ctx.close();
  }
  exposeAssignedOrder = true;
  // Return action is gated by the live pool projection, not merely work-order origin.
  poolMode = 'rows'; poolQueries = []; dispatchPoolMachines = ['A02']; claimWinner = 'A01'; assignedPoolStatus = 'claimed';
  access = { tenant_id: tenant, role: 'planner', all_departments: true, is_bridge: false, department_codes: ['LATHE', 'MILL'] };
  {
    const claimed = await openApp('planner', 1440);
    ok(poolQueries.some(q => /select=source_key(?:%2C|,)status/i.test(q) && q.includes('source_key=in.')), 'assigned pool status uses the existing filtered pool-item read');
    ok(await claimed.page.locator('.machine-tile-card [data-pool-return="01|TESTNEED0001|TEST-SIM-1"]').count() === 1, 'claimed + pending: return-to-pool control is shown');
    ok(await claimed.page.locator('.machine-tile-card .pool-return-factory-note').count() === 0, 'claimed + pending: factory handoff note is absent');
    await claimed.ctx.close();
  }
  assignedPoolStatus = 'gone';
  {
    const applied = await openApp('planner', 1440);
    ok(await applied.page.locator('.machine-tile-card [data-pool-return]').count() === 0, 'gone/applied: return-to-pool control is hidden');
    ok((await applied.page.locator('.machine-tile-card .pool-return-factory-note').first().innerText()).includes('已派到工廠'), 'gone/applied: factory handoff note is shown');
    await applied.ctx.close();
  }
  assignedPoolStatus = 'claimed'; proc.status = 'running';
  {
    const running = await openApp('planner', 1440);
    ok(await running.page.locator('.machine-tile-card [data-pool-return]').count() === 0, 'claimed + running process: return-to-pool control is hidden');
    ok(await running.page.locator('.machine-tile-card .pool-return-factory-note').count() >= 1, 'claimed + running process: factory handoff note is shown');
    await running.ctx.close();
  }
  proc.status = 'pending';
  assignedPoolStatus = 'claimed'; order.legacy_mes_source = 'app_manual';
  {
    const manual = await openApp('planner', 1440);
    ok(await manual.page.locator('.machine-tile-card [data-pool-return], .machine-tile-card .pool-return-factory-note').count() === 0, 'non-pool source: neither return control nor handoff note is shown');
    await manual.ctx.close();
  }
  order.legacy_mes_source = 'dispatch_pool';
  // Planner returns the claimed A01 item, then another machine reclaims it.
  poolMode = 'rows'; dispatchPoolMachines = ['A02']; claimWinner = 'A01'; returnRequests = []; claimRequests = [];
  access = { tenant_id: tenant, role: 'planner', all_departments: true, is_bridge: false, department_codes: ['LATHE', 'MILL'] };
  {
    const planner = await openApp('planner', 1440);
    const returnButton = planner.page.locator('.machine-tile-card [data-pool-return="01|TESTNEED0001|TEST-SIM-1"]').first();
    ok(await returnButton.count() === 1 && (await returnButton.innerText()).includes('退回池子'), 'planner: machine card shows return-to-pool control');
    planner.page.once('dialog', dialog => dialog.accept('排程調整'));
    await returnButton.click();
    await planner.page.waitForFunction(() => document.body.innerText.includes('已退回池子'));
    ok(returnRequests.length === 1 && returnRequests[0].p_source_key === '01|TESTNEED0001|TEST-SIM-1' && returnRequests[0].p_reason === '排程調整', 'planner: return RPC sends source key and reason');
    await planner.ctx.close();
  }
  access = { tenant_id: tenant, role: 'operator', all_departments: false, is_bridge: false, department_codes: ['LATHE'] };
  {
    const next = await openApp('operator', 390);
    await next.page.locator('[data-card-pool-open="A02"]').click();
    const reclaim = next.page.locator('[data-pool-key="01|TESTNEED0001|TEST-SIM-1"] [data-pool-claim]');
    ok(await reclaim.isEnabled(), 'after return: another eligible idle machine can reclaim');
    await reclaim.click();
    await next.page.waitForFunction(() => document.body.innerText.includes('接單成功'));
    ok(claimRequests.length === 1 && claimRequests[0].p_machine_code === 'A02', 'claim→return→another-machine reclaim browser flow completes');
    await next.ctx.close();
  }
  dispatchPoolMachines = []; claimWinner = '';
  // Two browser sessions race for the same row. The fixture serializes the claim like the RPC row lock.
  poolMode = 'rows'; dispatchPoolMachines = ['A02', 'A03']; claimWinner = ''; claimRequests = [];
  access = { tenant_id: tenant, role: 'operator', all_departments: false, is_bridge: false, department_codes: ['LATHE'] };
  {
    const left = await openApp('operator', 390), right = await openApp('operator', 390);
    await left.page.locator('[data-card-pool-open="A02"]').click();
    await right.page.locator('[data-card-pool-open="A03"]').click();
    const leftButton = left.page.locator('[data-pool-key="01|TESTNEED0001|TEST-SIM-1"] [data-pool-claim]');
    const rightButton = right.page.locator('[data-pool-key="01|TESTNEED0001|TEST-SIM-1"] [data-pool-claim]');
    ok(await leftButton.isEnabled() && await rightButton.isEnabled(), 'race: both empty eligible pilot machines can attempt the same item');
    await Promise.all([leftButton.click(), rightButton.click()]);
    await Promise.all([
      left.page.waitForFunction(() => document.body.innerText.includes('接單成功') || document.body.innerText.includes('已被別台接走')),
      right.page.waitForFunction(() => document.body.innerText.includes('接單成功') || document.body.innerText.includes('已被別台接走')),
    ]);
    const messages = [(await left.page.locator('body').innerText()), (await right.page.locator('body').innerText())];
    ok(claimRequests.length === 2 && new Set(claimRequests.map(x => x.p_machine_code)).size === 2, 'race: two distinct machines sent one atomic claim each');
    ok(messages.filter(x => x.includes('接單成功')).length === 1 && messages.filter(x => x.includes('已被別台接走')).length === 1, 'race: exactly one browser wins and loser sees the reason');
    await left.ctx.close(); await right.ctx.close();
  }
  dispatchPoolMachines = []; claimWinner = ''; poolMode = 'empty';
  access = { tenant_id: tenant, role: 'planner', all_departments: true, is_bridge: false, department_codes: ['LATHE', 'MILL'] };
  {
    const { ctx, page } = await openApp('planner', 1440);
    await page.locator('[data-card-select-open="A01"]').click();
    ok((await page.locator('#machtileCardSelection [data-card-selection-pool]').innerText()).includes('目前沒有同課待接的工序'), 'empty pool: planner sees empty message');
    await ctx.close();
  }
  // Migration not applied yet (404 PGRST205): no section at all, nothing else breaks.
  poolMode = 'missing';
  {
    const { ctx, page } = await openApp('planner', 1440);
    await page.locator('[data-card-select-open="A01"]').click();
    ok(await page.locator('#machtileCardSelection [data-card-selection-pool]').count() === 0 && await page.locator('#machtileCardSelection [data-card-selection-assigned]').count() === 1, 'table missing: pool section hidden, selection still works');
    ok(await page.evaluate(() => machtileDispatchPoolState.status) === 'missing', 'table missing: state = missing');
    await ctx.close();
  }
  // Other read failure: one visible line, no stale list.
  poolMode = 'error';
  {
    const { ctx, page } = await openApp('planner', 1440);
    await page.locator('[data-card-select-open="A01"]').click();
    ok((await page.locator('#machtileCardSelection [data-pool-error]').innerText()).includes('待做池讀取失敗') && await page.locator('#machtileCardSelection [data-pool-key]').count() === 0, 'read error: message, no items');
    await ctx.close();
  }
  console.log('non-GET calls seen (read-only RPCs of other panels): ' + [...new Set(mutations)].join(','));
  ok(mutations.filter(p => p === '/rest/v1/rpc/dispatch_pool_claim').length === 3 && mutations.filter(p => p === '/rest/v1/rpc/dispatch_pool_claim_release').length === 1 && mutations.filter(p => p === '/rest/v1/rpc/dispatch_pool_return').length === 1 && !mutations.some(p => /work_order_upsert|machine_queue/.test(p)), 'only expected atomic claim/release/return writes were sent');
  ok(blocked.length === 0, 'no real backend or non-GET local request: ' + blocked.join(','));
  ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
  console.log(`${checks}/${checks} dispatch pool view checks passed`);
} finally {
  await browser.close(); server.close();
}
