// Actual local index/app, synthetic fixtures, no real backend/network.
// Covers: (A) flow status follows the card's reported quantity (legacy MES + App, same cardProgress snapshot);
//         (B) per-role flow visibility levels on machine cards (display only; default full).
// MACHTILE_PLAYWRIGHT_MODULE=<playwright/index.mjs> node processFlowVisibility.browser.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const imported = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = imported.default || imported;
const fake = 'https://flowvis-fixture.test', id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant = id(1), auth = id(901), actor = id(902);
const machineRows = [1,3].map(n=>({id:id(100+n),machine_code:`A0${n}`,name:`A0${n}`,department_name:'車床課',status:'idle',machine_type:'lathe',display_order:n}));
const orders = [{id:id(201),work_order_no:'TEST-SAME',part_no:'TEST-PART',part_name:'測試零件',quantity:5000,due_date:'2026-10-20',status:'in_progress',source_system:'app_manual',created_by:actor},
  {id:id(202),work_order_no:'TEST-NEXT',part_no:'TEST-NEXT-PART',part_name:'下一張零件',quantity:100,due_date:'2026-10-21',status:'not_started',source_system:'app_manual',created_by:actor}];
// Mirrors prod XX01202609020008: N3 on A01 is still `pending`, App qty_completed 0, legacy MES already reported 4690/5000.
const procs = [
  {id:id(302),work_order_id:id(201),process_order:2,process_name:'下料',process_type:'cnc',machine_id:null,status:'completed',qty_completed:5000,qty_defect:0},
  {id:id(303),work_order_id:id(201),process_order:3,process_name:'CNC車床加工-1/2',process_type:'cnc',machine_id:id(101),status:'pending',qty_completed:0,qty_defect:0,queue_order:1},
  {id:id(304),work_order_id:id(201),process_order:4,process_name:'第二次車削',process_type:'cnc',machine_id:id(103),status:'pending',qty_completed:0,qty_defect:0,queue_order:1},
  {id:id(305),work_order_id:id(201),process_order:5,process_name:'測試委外',process_type:'outsourced',machine_id:null,status:'pending',qty_completed:0,qty_defect:0},
  {id:id(306),work_order_id:id(201),process_order:6,process_name:'包裝',process_type:'cnc',machine_id:null,status:'pending',qty_completed:0,qty_defect:0},
  {id:id(309),work_order_id:id(202),process_order:2,process_name:'車削',process_type:'cnc',machine_id:id(101),status:'pending',qty_completed:0,qty_defect:0,queue_order:2}];
let n3Legacy = 4690, settingsMode = 'missing', settings = {}, role = 'operator';
const progress = p => ({process_id:p.id,process_order:p.process_order,legacy_output:p.id===id(303)?n3Legacy:p.id===id(302)?5000:null,legacy_input:5000,legacy_fail:0,pending_output:0,pending_fail:0,pending_count:0,last_report_at:null,legacy_updated_at:null});
let checks = 0;
const blocked=[], errors=[], rpcCalls=[], upserts=[];
const ok=(value,label)=>{assert(value,label); checks++; console.log('PASS '+label);};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405);res.end();return}const u=new URL(req.url,'http://localhost');const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}try{res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(await readFile(file))}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch();
async function openAs(who) {
  role = who;
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await ctx.addInitScript(token=>sessionStorage.setItem('machtileAuthSession',JSON.stringify({version:1,accessToken:token,refreshToken:'',email:'flow@test.invalid',authMethod:'password',mode:'session',createdAt:Date.now(),rememberUntil:0})),
    'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({sub:auth,exp:Math.floor(Date.now()/1000)+3600,app_metadata:{tenant_id:tenant,role:who},role:'authenticated'})).toString('base64url')+'.test');
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    const json=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(req.url().startsWith(base)){
      if(u.pathname==='/config.js')return route.fulfill({contentType:'text/javascript',body:`window.MACHTILE_CONFIG={useSupabase:true,authMode:'strict',tenantId:'${tenant}',useTenantHeaderAuth:true,supabaseUrl:'${fake}',supabaseAnonKey:'fixture-public',oauthEnabled:false,disableServiceWorker:true,enableOutboxSubmit:false,enableProgramUpload:false,enableScheduleContracts:false,enableAccountDelete:false,enableJevTriage:false,enableFaceStatus:false,useHmcWorklistSupabase:false,hmcFixedStagingEnabled:false};`});
      if(req.method()!=='GET'){blocked.push(req.url());return route.abort()}
      return route.continue();
    }
    if(u.origin!==fake){blocked.push(req.url());return route.abort()}
    const p=u.pathname,body=req.postData()?JSON.parse(req.postData()):{};
    if(req.method()!=='GET')rpcCalls.push(p);
    if(p==='/auth/v1/user')return json(200,{id:auth,email:'flow@test.invalid'});
    if(p==='/rest/v1/app_users')return json(200,[{id:actor,auth_user_id:auth,name:'測試帳號',legacy_user_id:'TEST-001'}]);
    if(p==='/rest/v1/rpc/machine_department_context')return json(200,{tenant_id:tenant,role,all_departments:true,is_bridge:false,department_codes:['LATHE','MILL']});
    if(p==='/rest/v1/machines'||p==='/rest/v1/v_machine_management_cards')return json(200,p.endsWith('/v_machine_management_cards')?machineRows.map(({id,name,...row})=>({...row,machine_id:id,machine_name:name})):machineRows);
    if(p==='/rest/v1/tenant_display_settings'){
      if(settingsMode==='missing')return json(404,{code:'PGRST205',message:"Could not find the table 'public.tenant_display_settings' in the schema cache"});
      return json(200,settingsMode==='empty'?[]:[{settings:{flow_visibility:settings}}]);
    }
    if(p==='/rest/v1/rpc/tenant_display_settings_upsert'){upserts.push(body.p_payload);settings={...body.p_payload.flow_visibility};settingsMode='row';return json(200,{settings:{flow_visibility:settings}});}
    if(p==='/rest/v1/work_orders'){
      const eq=u.searchParams.get('work_order_no');
      return json(200,orders.filter(o=>!eq||eq.startsWith('in.')||o.work_order_no===eq.slice(3)).map(o=>({...o,work_order_processes:procs.filter(p=>p.work_order_id===o.id)})));
    }
    if(p==='/rest/v1/work_order_processes'){
      if((u.searchParams.get('select')||'').includes('work_orders!inner'))return json(200,procs.filter(p=>p.machine_id&&['pending','running','abnormal','waiting_inspection'].includes(p.status)).map(p=>({...p,tenant_id:tenant,off_station_at:null,work_orders:orders.find(o=>o.id===p.work_order_id),machines:machineRows.find(m=>m.id===p.machine_id)})));
      return json(200,procs);
    }
    if(p==='/rest/v1/v_work_order_cards')return json(200,[[201,303],[202,309]].map(([o,pr])=>{const order=orders.find(x=>x.id===id(o)),proc=procs.find(x=>x.id===id(pr));return {id:order.id,tenant_id:tenant,work_order_no:order.work_order_no,part_name:order.part_name,quantity:order.quantity,due_date:order.due_date,work_order_status:order.status,current_process_id:proc.id,current_process_name:proc.process_name,current_process_status:proc.status,machine_name:machineRows.find(m=>m.id===proc.machine_id)?.machine_code||null,qty_completed:proc.qty_completed,qty_defect:0,current_process_off_station:false};}));
    if(p==='/rest/v1/rpc/batch_report_progress')return json(200,procs.filter(p=>(body.p_process_ids||[]).includes(p.id)).map(progress));
    if(req.method()!=='GET'&&!p.startsWith('/rest/v1/rpc/'))throw new Error('unexpected mutation '+p);
    return json(200,[]);
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('dataSourceLabel')?.textContent.includes('Supabase'));
  await page.waitForFunction(()=>machtileProcessFlows.get('TEST-SAME')?.processes.length===5);
  return {ctx,page};
}
const reload = page => page.evaluate(async()=>{await loadFromSupabase();deriveMachines();renderAll();});
// Real rendered machine card for a machine code (dashboard view).
const card = (page, code) => page.locator('.machine-tile-card').filter({has:page.locator('.machine-title-line',{hasText:code})}).first();
const cell = (page, code, pid) => card(page, code).locator(`.process-flow [data-flow-process="${pid}"]`);
const out=process.env.MACHTILE_SCREENSHOT_DIR || path.join(root,'output/playwright/flow-visibility');await mkdir(out,{recursive:true});
try {
  // ---------- Part A: status follows reported quantity (operator, settings table missing => full) ----------
  let {ctx,page} = await openAs('operator');
  ok(await page.evaluate(()=>machtileFlowVisibilityState.status)==='unavailable'&&await page.evaluate(()=>machtileFlowVisibilityLevel())==='full','missing settings table falls back to full (nothing changes on deploy)');
  ok(await page.evaluate(()=>machtileCardOrderForMachine('A01')?.processId)===id(303)&&await page.evaluate(()=>machtileCardOrderForMachine('A03')?.processId)===id(304),'A01 shows N3 and A03 shows N4 of the same work order');
  ok((await card(page,'A01').innerText()).includes('4690'),'A01 card completion uses legacy 4690 (App reported 0)');
  const a01n3 = await cell(page,'A01',id(303)).innerText(), a03n3 = await cell(page,'A03',id(303)).innerText();
  ok(a01n3.includes('進行中')&&!a01n3.includes('未開始')&&a01n3.includes('已報 4690 / 5000'),'A01 current N3 pending+legacy 4690/5000 => 進行中, not 未開始');
  ok(a03n3.includes('進行中')&&a03n3.includes('已報 4690 / 5000'),'A03 previous-step N3 shows the same status and the same reported number');
  ok((await cell(page,'A03',id(304)).innerText()).includes('未開始'),'A03 N4 with reported 0 => 未開始');
  ok(await page.evaluate(pid=>String(machtileProcessFlows.get('TEST-SAME').processes.find(p=>p.id===pid).reported)===String(machtileCardOrderForMachine('A01').done),id(303)),'flow reported equals the card 完成進度 number (same snapshot)');
  await page.screenshot({path:path.join(out,'a01-a03-reported-status.png')});
  n3Legacy = 5000; await reload(page);
  const reached = await cell(page,'A03',id(303)).innerText();
  ok(reached.includes('已達數')&&!reached.includes('完成'),'reported >= quantity => 已達數, never 完成');
  n3Legacy = 4690;
  // ---------- Part B: each visibility level for operator ----------
  settingsMode='row';
  settings={operator:'full'}; await reload(page);
  ok(await card(page,'A01').locator('.process-flow-step').count()===3&&await card(page,'A01').locator('[data-flow-open]').count()===2,'full: 3-cell preview with route opener and 完整單 opener');
  await card(page,'A01').locator('.process-flow-compact').click();
  ok(await page.locator('#machtileFullProcessFlow .process-flow-step').count()===5,'full: clicking preview opens all five steps');
  await page.keyboard.press('Escape');
  settings={operator:'adjacent'}; await reload(page);
  ok(await card(page,'A01').locator('.process-flow-step').count()===3,'adjacent: still shows 3 cells');
  ok(await card(page,'A01').locator('[data-flow-open]').count()===0&&!(await card(page,'A01').innerText()).includes('點開看完整路線'),'adjacent: no full-route opener on strip or 完整單 link');
  await card(page,'A01').locator('.process-flow-compact').click({force:true});
  ok(await page.locator('#machtileFullProcessFlow').count()===0,'adjacent: clicking preview does not open full route');
  await page.screenshot({path:path.join(out,'level-adjacent.png')});
  settings={operator:'next_only'}; await reload(page);
  const nextStrip = card(page,'A01').locator('[data-flow-level="next_only"]');
  ok(await nextStrip.count()===1,'next_only: dedicated strip rendered');
  ok(await nextStrip.locator(`[data-flow-process="${id(304)}"]`).count()===1&&await nextStrip.locator(`[data-flow-process="${id(302)}"],[data-flow-process="${id(303)}"],[data-flow-process="${id(305)}"],[data-flow-process="${id(306)}"]`).count()===0,'next_only: only this order next step (N4), no previous/current/later steps');
  ok((await nextStrip.innerText()).includes('本機下一張')&&(await nextStrip.innerText()).includes('TEST-NEXT'),'next_only: shows this machine next queued order from queue_order');
  ok(await card(page,'A01').locator('[data-flow-open]').count()===0,'next_only: no full-route opener');
  ok((await card(page,'A03').locator('[data-flow-level="next_only"]').innerText()).includes('本機佇列沒有下一張'),'next_only: empty machine queue stated, not invented');
  await page.screenshot({path:path.join(out,'level-next-only.png')});
  settings={operator:'hidden'}; await reload(page);
  ok(await card(page,'A01').locator('.process-flow').count()===0&&await card(page,'A01').locator('[data-flow-open]').count()===0,'hidden: no flow strip and no opener on card');
  ok(await page.evaluate(()=>machtileScheduleCard(state.workOrders.find(o=>o.id==='TEST-SAME'),0,1,'A01',false,null)).then(h=>h.includes('data-flow-open')),'schedule board (planner+ page) keeps full route even when operator is hidden');
  const detailHtml = () => page.evaluate(()=>{renderDetail(state.workOrders.find(o=>o.id==='TEST-SAME'),{processes:[{process_order:3,process_name:'CNC車床加工-1/2',status:'pending'},{process_order:4,process_name:'第二次車削',status:'pending'}],reports:[],abnormalities:[]});const h=document.getElementById('detailContent').innerHTML;document.getElementById('detailContent').innerHTML='';return h;});
  ok(await detailHtml().then(h=>h.includes('data-flow-detail-restricted')&&!h.includes('第二次車削')),'hidden: 完整單 detail sheet also withholds the full route list');
  settings={operator:'full'}; await reload(page);
  ok(await detailHtml().then(h=>!h.includes('data-flow-detail-restricted')&&h.includes('第二次車削')),'full: detail sheet keeps today full route list');
  settingsMode='empty'; await reload(page);
  ok(await page.evaluate(()=>machtileFlowVisibilityLevel())==='full','tenant without a settings row => full');
  ok(errors.length===0,'operator: no app JS errors');
  await ctx.close();
  // ---------- Planner: role-scoped, settings page writes only via RPC ----------
  settingsMode='row'; settings={operator:'hidden'};
  ({ctx,page} = await openAs('planner'));
  ok(await card(page,'A01').locator('.process-flow-step').count()===3&&await card(page,'A01').locator('[data-flow-open]').count()===2,'operator setting does not affect planner (planner default full)');
  await page.evaluate(()=>openAdminModule('flowVisibility'));
  await page.waitForFunction(()=>document.getElementById('machtileFlowVisStatus')?.textContent.includes('已讀取'));
  ok(await page.locator('[data-flow-vis-role]').count()===6&&await page.locator('[data-flow-vis-role="operator"]').inputValue()==='hidden'&&await page.locator('[data-flow-vis-role="admin"]').inputValue()==='full','settings page lists every role, prefilled, unset roles = full');
  await page.locator('[data-flow-vis-role="operator"]').selectOption('next_only');
  await page.locator('#machtileFlowVisForm button[type=submit]').click();
  await page.waitForFunction(()=>document.getElementById('machtileFlowVisStatus')?.textContent.includes('已儲存'));
  ok(upserts.length===1&&upserts[0].flow_visibility.operator==='next_only'&&upserts[0].flow_visibility.planner==='full'&&Object.keys(upserts[0].flow_visibility).length===6,'save sends one RPC with all six roles');
  await page.evaluate(()=>closeAdminModule());
  settingsMode='missing'; await page.evaluate(()=>openAdminModule('flowVisibility'));
  await page.waitForFunction(()=>document.getElementById('machtileFlowVisStatus')?.textContent.includes('尚未建立'));
  ok(await page.locator('#machtileFlowVisForm button[type=submit]').isDisabled()&&await page.locator('[data-flow-vis-role="operator"]').isDisabled(),'missing table: settings page explains default and cannot save');
  await page.evaluate(()=>closeAdminModule());
  await page.setViewportSize({width:390,height:844});
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px no horizontal overflow');
  ok(errors.length===0,'planner: no app JS errors');
  await ctx.close();
  // Operator cannot see the settings entry.
  settingsMode='row'; settings={};
  ({ctx,page} = await openAs('operator'));
  ok(await page.evaluate(()=>machtileFlowVisibilityCanEdit())===false&&await page.evaluate(()=>renderFlowVisibilityModule()).then(h=>!h.includes('machtileFlowVisForm')),'operator has no settings form');
  await ctx.close();
  ok(!blocked.some(u=>/machtile\.com|muditjubqflrqofbkmav/.test(u)),'no production-domain requests');
  const allowed=new Set(['machine_department_context','batch_report_progress','tenant_display_settings_upsert','schedule_calendar_snapshot','attention_case_snapshot','hmc_runtime_snapshot','unified_event_list']);
  ok(rpcCalls.every(p=>allowed.has(p.replace('/rest/v1/rpc/',''))),'no unrelated mutation endpoints called');
  console.log(`${checks} passed; screenshots=${out}`);
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
