// Actual local index/app, synthetic process-level fixtures, no real backend/network.
// MACHTILE_PLAYWRIGHT_MODULE=<playwright/index.mjs> node workOrderProcess.browser.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const imported = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = imported.default || imported;
const fake = 'https://process-fixture.test', id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant = id(1), auth = id(901), actor = id(902);
const machineRows = [1,3,4,5].map(n=>({id:id(100+n),machine_code:`A0${n}`,name:`A0${n}`,status:n===4?'maintenance':n===5?'offline':'idle',machine_type:'lathe',display_order:n}));
machineRows[0].department_name='車床課'; machineRows[0].machine_type='mill';
machineRows.push({id:id(123),machine_code:'B03',name:'B03',status:'idle',machine_type:'lathe',department_name:'銑床課',display_order:23});
const orders = [{id:id(201),work_order_no:'TEST-MULTI',part_no:'TEST-PART',part_name:'測試零件',quantity:5000,due_date:'2026-10-20',status:'in_progress',source_system:'app_manual',created_by:actor},
  {id:id(202),work_order_no:'TEST-OTHER',part_no:'TEST-OTHER-PART',part_name:'另一個測試零件',quantity:100,due_date:'2026-10-21',status:'not_started',source_system:'app_manual',created_by:actor}];
const operationName = 'CNC車床加工-1/2';
const procs = [{id:id(303),work_order_id:id(201),process_order:3,process_name:operationName,process_type:'cnc',machine_id:id(101),status:'running',qty_completed:10,qty_defect:0},
  {id:id(304),work_order_id:id(201),process_order:4,process_name:'第二次車削',process_type:'cnc',machine_id:id(103),status:'pending',qty_completed:0,qty_defect:0},
  {id:id(305),work_order_id:id(201),process_order:5,process_name:'測試委外',process_type:'outsourced',machine_id:null,status:'pending',qty_completed:0,qty_defect:0},
  {id:id(309),work_order_id:id(202),process_order:2,process_name:'車削',process_type:'cnc',machine_id:id(101),status:'pending',qty_completed:0,qty_defect:0}];
procs.push(...[
  [310,'車削','cnc','pending',0], [311,'銑削','cnc','pending',0],
  [312,'CNC 加工','cnc','pending',0], [313,'車削委外','outsourced','pending',0],
  [314,'車削','cnc','completed',0], [315,'車削','cnc','pending',100],
].map(([n,name,type,status,qty])=>({id:id(n),work_order_id:id(202),process_order:n-300,process_name:name,process_type:type,machine_id:null,status,qty_completed:qty,qty_defect:0})));
const progress = p => ({process_id:p.id,process_order:p.process_order,legacy_output:p.id===id(303)?3440:null,legacy_input:5000,legacy_fail:0,pending_output:p.id===id(303)?20:0,pending_fail:0,pending_count:0,
  last_report_at:p.id===id(303)?'2026-10-01T00:00:00Z':p.id===id(309)?'2026-10-04T00:00:00Z':null,legacy_updated_at:null});
let checks=0, rejectProgress=false, rejectMachines=false, rejectMetadata=false, rejectQueue=false,rejectPreplan=false,rejectAudit=false;
const preplans=[],assignmentEvents=[];
let badParents=false, offStationFixture=false;
const upserts=[], queues=[], blocked=[], errors=[], rpcCalls=[];
const ok=(value,label)=>{assert(value,label); checks++; console.log('PASS '+label);};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405);res.end();return}const u=new URL(req.url,'http://localhost');const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}try{res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(await readFile(file))}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await ctx.addInitScript(token=>sessionStorage.setItem('machtileAuthSession',JSON.stringify({version:1,accessToken:token,refreshToken:'',email:'planner@test.invalid',authMethod:'password',mode:'session',createdAt:Date.now(),rememberUntil:0})),
  'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({sub:auth,exp:Math.floor(Date.now()/1000)+3600,app_metadata:{tenant_id:tenant,role:'planner'},role:'authenticated'})).toString('base64url')+'.test');
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
  if(p==='/auth/v1/user')return json(200,{id:auth,email:'planner@test.invalid'});
  if(p==='/rest/v1/app_users')return json(200,[{id:actor,auth_user_id:auth,name:'測試生管',legacy_user_id:'TEST-001'}]);
  if(p==='/rest/v1/machines'||p==='/rest/v1/v_machine_management_cards')return rejectMachines?json(503,{message:'fixture machines unavailable'}):json(200,machineRows);
  if(p==='/rest/v1/work_orders'){
    const eq=u.searchParams.get('work_order_no');
    return json(200,orders.filter(o=>!eq||eq.startsWith('in.')||o.work_order_no===eq.slice(3)).map(o=>({...o,work_order_processes:procs.filter(p=>p.work_order_id===o.id)})));
  }
  if(p==='/rest/v1/process_assignment_events')return rejectAudit?json(404,{message:'fixture audit migration missing'}):json(200,[...assignmentEvents].reverse());
  if(p==='/rest/v1/rpc/machine_queue_append') {
    preplans.push(body.p_payload);
    if(rejectPreplan)return json(400,{code:'P0001',message:'PROCESS_HAS_REPORTS'});
    const x=body.p_payload,target=procs.find(p=>p.id===x.process_id);
    const rank=Math.max(0,...procs.filter(p=>p.machine_id===x.machine_id).map(p=>p.queue_order||0))+1;
    target.machine_id=x.machine_id;target.queue_order=rank;
    assignmentEvents.push({id:assignmentEvents.length+1,process_id:target.id,kind:'preplan',machine_code:machineRows.find(m=>m.id===x.machine_id).machine_code});
    return json(200,{event_id:assignmentEvents.length,queue_order:rank,replayed:false});
  }
  if(p==='/rest/v1/work_order_processes') {
    if(rejectMetadata)return json(503,{message:'fixture process metadata unavailable'});
    if((u.searchParams.get('select')||'').includes('work_orders!inner'))return json(200,procs.filter(p=>p.machine_id).map(p=>({...p,off_station_at:offStationFixture&&p.id===id(304)?'2026-10-01T00:00:00Z':null,work_orders:{...orders.find(o=>o.id===p.work_order_id),...(badParents?{status:'completed'}:{})},machines:machineRows.find(m=>m.id===p.machine_id)})));
    return json(200,procs);
  }
  // Production view is ONE current step per work order, not every step.
  // Keep unassigned fixture rows for the existing schedule-board pool.
  if(p==='/rest/v1/v_work_order_cards')return json(200,procs.filter(p=>!p.machine_id||p.id===id(303)||p.id===id(309)).map(p=>{const o=orders.find(o=>o.id===p.work_order_id);return {id:o.id,tenant_id:tenant,work_order_no:o.work_order_no,part_name:o.part_name,quantity:o.quantity,due_date:o.due_date,work_order_status:o.status,current_process_id:p.id,current_process_name:p.process_name,current_process_status:p.status,machine_name:machineRows.find(m=>m.id===p.machine_id)?.machine_code||null,qty_completed:p.qty_completed,qty_defect:0,current_process_off_station:false}}));
  if(p==='/rest/v1/rpc/batch_report_progress')return rejectProgress?json(503,{message:'fixture progress unavailable'}):json(200,procs.filter(p=>(body.p_process_ids||[]).includes(p.id)).map(progress));
  if(p==='/rest/v1/rpc/work_order_upsert'){
    upserts.push(body.p_payload);const x=body.p_payload,target=procs.find(p=>p.id===x.process_id);
    if(!x.process_order)return json(400,{code:'P0001',message:'PROCESS_ORDER_REQUIRED'});
    if(target&&target.id===id(303)&&x.machine_code!=='A01')return json(400,{code:'P0001',message:'PROCESS_HAS_REPORTS: N3 已報工'});
    return json(200,{action:'updated',work_order_id:id(201),process_id:target?.id,machine_code:x.machine_code});
  }
  if(p==='/rest/v1/rpc/machine_queue_reorder'){
    if(rejectQueue)return json(400,{code:'P0001',message:'PROCESS_HAS_REPORTS'});
    queues.push(body.p_payload);const m=machineRows.find(m=>m.machine_code===body.p_payload.machine_code);
    for(const [index,pid] of body.p_payload.process_ids.entries()){const p=procs.find(p=>p.id===pid);p.machine_id=m.id;p.queue_order=index+1;}
    return json(200,{count:body.p_payload.process_ids.length,machine_code:m.machine_code});
  }
  if(req.method()!=='GET'&&p!=='/rest/v1/rpc/batch_report_progress'&&!p.startsWith('/rest/v1/rpc/'))throw new Error('unexpected mutation '+p);
  return json(200,[]);
});
const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
const out=process.env.MACHTILE_SCREENSHOT_DIR || path.join(root,'output/playwright/process-identity');await mkdir(out,{recursive:true});
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('dataSourceLabel')?.textContent.includes('Supabase'));
  console.log('acceptance replica: planner, local app, TEST-MULTI N3 A01/N4 A03; GET fixture 200; base 79961f81');
  await page.locator('[data-card-select-open="A03"]').click();
  ok(await page.locator(`#machtileCardSelection [data-card-selection-assigned] [data-card-select-process="${id(304)}"]`).count()===1,'A03 sees N4 while one-row view only exposes A01 N3');
  ok((await page.locator('[data-card-selection-assigned]').innerText()).includes('N4 第二次車削'),'A03 row shows its exact operation');
  ok((await page.evaluate(()=>machtileCardOrderForMachine('A03')))?.processId===id(304),'A03 main machine card also uses N4, not empty or N3');
  await page.locator('[data-close-card-selection]').click();
  await page.locator('.machine-tile-card').filter({has:page.locator('[data-card-select-open="A03"]')}).locator('[data-report]').click();
  ok(await page.evaluate(()=>selectedOrder?.processId)===(id(304)),'A03 report entry resolves the exact machine step, never same-work-order A01 N3');
  await page.evaluate(()=>closeReport());
  await page.evaluate(pid=>openReport('TEST-MULTI',{machine:'A03',processId:pid}),id(303));
  ok(!(await page.locator('#reportSheet').getAttribute('class')).includes('is-open')&&(await page.locator('#toast').innerText()).includes('已不在此機台'),'stale/foreign machine process ID cannot silently open a different step');
  await page.locator('[data-card-select-open="A03"]').click();
  offStationFixture=true;
  await page.evaluate(async()=>{await loadFromSupabase();deriveMachines();renderAll();});
  ok(await page.evaluate(()=>machtileCardSelectionCandidates(machtileScheduleMachine('A03')).assigned.length)===0,'off-station N4 excluded even if returned by a stale source');
  offStationFixture=false;badParents=true;
  await page.evaluate(async()=>{await loadFromSupabase();deriveMachines();renderAll();});
  ok(await page.evaluate(()=>machtileCardSelectionCandidates(machtileScheduleMachine('A03')).assigned.length)===0,'completed parent excluded');
  badParents=false;
  procs.find(p=>p.id===id(304)).status='waiting_inspection';
  await page.evaluate(async()=>{await loadFromSupabase();deriveMachines();renderAll();});
  ok(await page.evaluate(()=>machtileCardSelectionCandidates(machtileScheduleMachine('A03')).assigned.length)===1,'waiting_inspection remains an assigned selection candidate');
  procs.find(p=>p.id===id(304)).status='pending';
  await page.evaluate(async()=>{await loadFromSupabase();deriveMachines();renderAll();});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(out,'a03-n4-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(out,'a03-n4-desktop.png')});
  await page.locator('[data-close-card-selection]').click();
  await page.evaluate(()=>openAdminModule('workOrders'));
  await page.locator('[data-wo-edit="TEST-MULTI"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#machtileWoSteps .wo-step-row').length===3);
  ok((await page.locator('#machtileWoSteps').innerText()).includes('N3')&&(await page.locator('#machtileWoSteps').innerText()).includes('N4'),'all existing steps N3/N4/N5 shown, no invented N1');
  ok((await page.locator('#machtileWoStep option').allTextContents()).includes(`N3 ${operationName}`),'step selector displays N3 plus operation name, not route name');
  ok((await page.locator('#machtileWoSteps .wo-step-row').first().innerText()).includes('N3')&&(await page.locator('#machtileWoSteps .wo-step-row').first().innerText()).includes(operationName),'management process list displays step and operation name');
  ok(await page.evaluate(()=>machtileOperationLabel({process:'原製程'})==='原製程'),'missing step is not guessed as N1');
  ok(await page.evaluate(()=>machtileOperationLabel({stationStep:3,process:'工'.repeat(255)}).length===258),'255-character source name is not truncated');
  ok((await page.locator('#machtileWoSteps').innerText()).includes('3460'),'reported quantity=legacy 3440+pending 20, not App 10 again');
  ok((await page.locator('#machtileWoSteps').innerText()).includes('委外'),'outsource step is explicit');
  await page.locator('#machtileWoForm button[type=submit]').click();
  ok(upserts.length===0,'no selected step => no upsert');
  await page.locator('#machtileWoStep').selectOption(id(303));
  ok(await page.locator('#machtileWoMachine').isDisabled(),'reported N3 locks machine selector');
  await page.locator('#machtileWoProcess').fill('   ');
  await page.locator('#machtileWoForm button[type=submit]').click();
  await page.waitForFunction(()=>document.getElementById('toast')?.textContent.includes('已更新工單'));
  ok(upserts.at(-1).process_order===3&&upserts.at(-1).process_id===id(303)&&upserts.at(-1).machine_code==='A01','same reported step update carries explicit identity');
  ok(upserts.at(-1).process_name===operationName,'blank process name preserves existing reported step name without N prefix');
  await page.locator('#machtileWoStep').selectOption(id(304));
  ok(await page.locator('#machtileWoMachine').isEnabled(),'unreported N4 may change machine');
  await page.locator('#machtileWoMachine').selectOption('A01');
  await page.locator('#machtileWoForm button[type=submit]').click();
  await page.waitForTimeout(200);
  ok(upserts.at(-1).process_order===4&&upserts.at(-1).process_id===id(304),'N4 reassignment does not send default N1');
  // Simulate a forged/stale DOM. Real SQL refusal is independently executed in PGlite.
  await page.locator('#machtileWoStep').selectOption(id(303));
  await page.locator('#machtileWoMachine').evaluate(el=>{el.disabled=false;el.value='A03'});
  await page.locator('#machtileWoForm button[type=submit]').click();
  await page.waitForFunction(()=>document.getElementById('toast')?.textContent.includes('不能改機台或步序'));
  ok((await page.locator('#toast').innerText()).includes('已保留'),'RPC refusal reason reaches user');
  await page.screenshot({path:path.join(out,'steps-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#machtileWoSteps').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'steps-mobile.png')});
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px no horizontal overflow');
  rejectProgress=true;
  await page.locator('#machtileWoNo').fill('TEST-OTHER');
  await page.locator('#machtileWoNo').dispatchEvent('change');
  await page.waitForFunction(()=>document.getElementById('machtileWoPrefillNote')?.textContent.includes('帶入失敗'));
  const before=upserts.length;
  ok(await page.locator('#machtileWoForm button[type=submit]').isDisabled(),'failed lookup disables submit');
  await page.locator('#machtileWoForm').dispatchEvent('submit');
  await page.waitForTimeout(500);
  ok(upserts.length===before,'failed progress read cannot become editable zero');
  rejectProgress=false;
  await page.evaluate(()=>closeAdminModule());
  rejectMachines=true;
  await page.evaluate(()=>{machtileWoMachinesCache=null;openAdminModule('workOrders');});
  await page.waitForFunction(()=>document.getElementById('machtileWoSteps')?.textContent.includes('機台清單讀取失敗'),null,{timeout:5000}).catch(async e=>{console.log('machine-failure diagnostic',await page.evaluate(()=>({cache:machtileWoMachinesCache,steps:document.getElementById('machtileWoSteps')?.textContent})),errors);throw e});
  ok(await page.locator('#machtileWoForm button[type=submit]').isDisabled(),'initial machine list failure visibly blocks form submission');
  ok(!(await page.locator('#machtileWoSteps').innerText()).includes('未排機')&&upserts.length===before,'machine lookup error is not misrepresented as unassigned and sends no upsert');
  rejectMachines=false;
  await page.evaluate(()=>{closeAdminModule();openAdminModule('workOrders');});
  await page.locator('[data-wo-edit="TEST-MULTI"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#machtileWoSteps .wo-step-row').length===3);
  const priorMachine=procs.find(p=>p.id===id(304)).machine_id;
  procs.find(p=>p.id===id(304)).machine_id=id(999);
  await page.locator('[data-wo-edit="TEST-MULTI"]').click();
  await page.waitForFunction(()=>document.getElementById('machtileWoSteps')?.textContent.includes('原機台不在清單'));
  ok(await page.locator('#machtileWoForm button[type=submit]').isDisabled()&&upserts.length===before,'assigned step absent from machine list fails closed instead of clearing assignment');
  procs.find(p=>p.id===id(304)).machine_id=priorMachine;
  await page.evaluate(()=>closeAdminModule());
  await page.setViewportSize({width:1440,height:1000});
  ok(await page.locator('[data-card-select-open="A04"], [data-card-select-open="A05"]').count()===0,'maintenance/offline cards have no selection entry');
  await page.locator('[data-card-select-open="A01"]').click();
  ok(await page.locator('#machtileCardSelection [data-card-selection-assigned] [data-card-select-process]').count()===2,'assigned unfinished candidates retain process identity');
  ok(await page.locator('#machtileCardSelection [data-card-selection-unassigned] [data-card-select-process]').count()===1&&await page.locator(`#machtileCardSelection [data-card-select-process="${id(310)}"]`).count()===1,'lathe card offers only same-department unassigned step');
  ok((await page.locator('#machtileCardSelection').innerText()).includes('這台身上的工序')&&(await page.locator('#machtileCardSelection').innerText()).includes('未排機（同課）'),'selection has two named sections');
  ok(await page.locator(`#machtileCardSelection [data-card-select-process="${id(305)}"]`).count()===0,'outsourced process is not offered as machine work');
  await page.screenshot({path:path.join(out,'card-selection-desktop.png')});
  await page.locator(`#machtileCardSelection [data-card-select-process="${id(303)}"]`).click();
  await page.waitForFunction(()=>!document.getElementById('machtileCardSelection'));
  ok(queues.at(-1)?.process_ids[0]===id(303)&&queues.at(-1)?.process_ids[1]===id(309),'selecting reported N3 saves it as queue first without moving other work');
  await page.evaluate(async()=>{await loadFromSupabase(); deriveMachines(); renderAll();});
  const chosen=await page.evaluate(()=>machtileCardOrderForMachine('A01'));
  ok((await page.locator('.machine-tile-card').filter({has:page.locator('[data-card-select-open="A01"]')}).locator('.job-order-subline').innerText()).includes(`N3 ${operationName}`),'machine card displays N3 actual operation name');
  ok(chosen?.order?.processId===id(303)||chosen?.processId===id(303),'selected current process persists after refreshed data');
  ok(procs.find(p=>p.id===id(303)).qty_completed===10&&progress(procs.find(p=>p.id===id(303))).legacy_output===3440,'queue selection does not reset reported quantities');
  await page.locator('[data-card-select-open="A01"]').click();
  const queueBefore=queues.length;
  procs.find(p=>p.id===id(309)).machine_id=id(103);
  await page.locator(`#machtileCardSelection [data-card-select-process="${id(309)}"]`).click();
  await page.waitForFunction(()=>document.querySelector('[data-card-selection-error]')?.textContent.length>0);
  ok(queues.length===queueBefore,'stale candidate moved to another machine cannot be pulled back');
  await page.locator('[data-close-card-selection]').click();
  await page.locator('[data-card-select-open="A01"]').click();
  rejectMachines=true;
  await page.locator(`#machtileCardSelection [data-card-select-process="${id(303)}"]`).click();
  await page.waitForFunction(()=>document.querySelector('[data-card-selection-error]')?.textContent.includes('機台資料讀取失敗'));
  ok(queues.length===queueBefore,'failed machine metadata cannot use local demo fallback to assign');
  rejectMachines=false;
  await page.locator('[data-close-card-selection]').click();
  await page.evaluate(async()=>{await loadFromSupabase();deriveMachines();renderAll();});
  rejectMetadata=true;
  await page.evaluate(async()=>{await loadFromSupabase();deriveMachines();renderAll();});
  await page.locator('[data-card-select-open="A01"]').click();
  ok(await page.locator('[data-card-selection-unassigned] [data-card-select-process]').count()===0,'unknown process metadata excludes unassigned candidates');
  ok((await page.locator('[data-card-selection-error]').innerText()).includes('資料讀取失敗'),'failed per-process read is visibly distinct from an empty candidate result');
  rejectMetadata=false;
  await page.locator('[data-close-card-selection]').click();
  await page.evaluate(async()=>{await loadFromSupabase();deriveMachines();renderAll();});
  await page.locator('[data-card-select-open="A01"]').click();
  rejectQueue=true;
  await page.locator(`#machtileCardSelection [data-card-select-process="${id(310)}"]`).click();
  await page.waitForFunction(()=>document.querySelector('[data-card-selection-error]')?.textContent.includes('已有報工'));
  ok(procs.find(p=>p.id===id(310)).machine_id===null&&queues.length===queueBefore,'server reported-step refusal preserves assignment and shows reason');
  rejectQueue=false;
  await page.locator('[data-close-card-selection]').click();
  await page.locator('[data-card-select-open="B03"]').click();
  ok(await page.locator(`#machtileCardSelection [data-card-select-process="${id(311)}"]`).count()===1&&await page.locator(`#machtileCardSelection [data-card-select-process="${id(310)}"]`).count()===0,'milling machine uses its own department, not lathe work');
  await page.locator('[data-close-card-selection]').click();
  await page.locator('[data-card-select-open="A01"]').click();
  await page.locator(`#machtileCardSelection [data-card-select-process="${id(310)}"]`).click();
  await page.waitForFunction(()=>!document.getElementById('machtileCardSelection'));
  ok(queues.at(-1).process_ids.length===2&&queues.at(-1).process_ids[0]===id(310)&&queues.at(-1).process_ids[1]===id(303),'unassigned selection assigns only chosen step plus existing machine queue');
  ok(procs.find(p=>p.id===id(310)).machine_id===id(101)&&procs.find(p=>p.id===id(311)).machine_id===null,'other unassigned steps are not accidentally assigned');
  await page.evaluate(async()=>{await loadFromSupabase(); deriveMachines(); renderAll();});
  ok((await page.evaluate(()=>machtileCardOrderForMachine('A01')))?.processId===id(310),'newly assigned step persists as current work');
  await page.locator('[data-card-select-open="A01"]').click();
  await page.setViewportSize({width:390,height:844});
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile selection has no horizontal overflow');
  await page.screenshot({path:path.join(out,'card-selection.png')});
  await page.locator('[data-close-card-selection]').click();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('dataSourceLabel')?.textContent.includes('Supabase'));
  ok((await page.evaluate(()=>machtileCardOrderForMachine('A01')))?.processId===id(310),'current work survives a full page reload');
  await page.locator('[data-card-select-open="A01"]').click();
  const beforeDouble=queues.length;
  await page.evaluate(async pid=>{await Promise.all([machtileCommitCardSelection('A01',pid),machtileCommitCardSelection('A01',pid)]);},id(303));
  ok(queues.length===beforeDouble+1,'double submission writes the queue only once');
  await page.evaluate(async()=>{await loadFromSupabase();deriveMachines();renderAll();});
  let appendButton=page.locator(`[data-flow-append="${id(304)}"]`).first();
  await appendButton.scrollIntoViewIfNeeded();
  let picker=appendButton.locator('..').locator('[data-flow-machine]');
  ok(await picker.locator('option').count()===3,'preplan offers only available same-department machines');
  await picker.selectOption(id(101));rejectPreplan=true;
  const beforePreplan=procs.find(p=>p.id===id(304)).machine_id;
  await appendButton.click();
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-flow-result]')].some(el=>el.textContent.includes('PROCESS_HAS_REPORTS')));
  ok(procs.find(p=>p.id===id(304)).machine_id===beforePreplan,'rejected preplan shows server reason and leaves assignment unchanged');
  const retryId=preplans.at(-1).request_id;rejectPreplan=false;
  const beforeAppendCalls=preplans.length;
  await appendButton.evaluate(el=>{el.click();el.click();});
  await page.waitForFunction(pid=>machtilePreplanBusy.size===0&&machtileProcessFlows.get('TEST-MULTI')?.processes.find(p=>p.id===pid)?.assignmentEvent?.kind==='preplan',id(304));
  ok(preplans.length===beforeAppendCalls+1,'double click sends a single atomic append request');
  ok(preplans.at(-1).request_id===retryId,'failed/uncertain request retry keeps idempotency key');
  ok(preplans.at(-1).process_id===id(304)&&preplans.at(-1).current_process_id===id(303),'preplan sends exact current and next identities');
  ok(procs.find(p=>p.id===id(304)).machine_id===id(101)&&procs.find(p=>p.id===id(304)).queue_order>procs.find(p=>p.id===id(303)).queue_order,'preplan appends after current without resetting its progress');
  ok((await page.locator('body').innerText()).includes('已預排，等待舊 MES 派工確認'),'unconfirmed plan is not presented as legacy assignment');
  procs.find(p=>p.id===id(304)).machine_id=id(103);
  assignmentEvents.push({id:2,process_id:id(304),kind:'legacy_reassigned',machine_code:'A03'});
  await page.evaluate(async()=>{await loadFromSupabase();deriveMachines();renderAll();});
  ok((await page.locator('body').innerText()).includes('已依舊 MES 改派'),'recorded legacy override is visible after refresh');
  rejectAudit=true;await page.evaluate(async()=>{await loadFromSupabase();deriveMachines();renderAll();});
  ok(await page.locator('[data-flow-append]').count()===0,'missing audit migration disables all preplan controls');
  rejectAudit=false;
  // Synthetic long route; actual app card and scheduling renderers share the same strip.
  await page.evaluate(()=>{
    machtileCloseCardSelection();
    const order=state.workOrders.find(o=>o.processId);
    const route=Array.from({length:8},(_,i)=>({id:i===2?order.processId:`fixture-route-${i}`,process_order:i+1,
      process_name:`測試工序${i+1}`,process_type:i===4?'outsourced':'cnc',supplier_code:i===4?'TEST-VENDOR':null,
      machine_code:'A01',status:i<2?'completed':i===2?'running':'pending',reported:i<2?order.total:i===2?order.done:0}));
    machtileProcessFlows.set(order.id,{quantity:order.total,processes:route});
    const preview=document.createElement('section');preview.id='processFlowPreview';preview.style.cssText='width:100%;max-width:700px;margin:auto';
    preview.innerHTML=renderMachineCard({name:'A01',code:'A01',type:'lathe',department:'車床課',status:'running',order})
      +machtileScheduleCard(order,0,1,'A01',false,null);
    document.body.replaceChildren(preview);
  });
  ok(await page.locator('#processFlowPreview .process-flow').count()===2,'machine and schedule cards use common flow component');
  ok(await page.locator('#processFlowPreview .process-flow-step').count()===16,'both cards retain all eight real steps');
  ok(await page.locator('#processFlowPreview [aria-current=step]').count()===2,'current process highlighted on each card');
  ok((await page.locator('#processFlowPreview').innerText()).includes('TEST-VENDOR')&&(await page.locator('#processFlowPreview').innerText()).includes('已完成'),'outsourced vendor and completed states retained');
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px page has no horizontal overflow`);
    const flowGeometry=await page.locator('.process-flow').first().evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth,overflow:getComputedStyle(el).overflowX,display:getComputedStyle(el.querySelector('ol')).display}));
    ok(flowGeometry.scroll>flowGeometry.client,`long route contained in scroll region ${JSON.stringify(flowGeometry)}`);
    await page.locator('.process-flow').first().evaluate(el=>el.scrollLeft=el.scrollWidth);
    ok(await page.locator('.process-flow').first().evaluate(el=>el.scrollLeft>0),'flow can scroll to downstream steps');
    await page.locator('.process-flow').evaluateAll(els=>els.forEach(el=>{const current=el.querySelector('[aria-current=step]');if(current)el.scrollLeft+=current.getBoundingClientRect().left-el.getBoundingClientRect().left-8;}));
    await page.screenshot({path:path.join(out,`process-flow-${width}.png`),fullPage:true});
  }
  const flowWrites=queues.length+upserts.length;
  await page.locator('.process-flow').first().focus();
  await page.keyboard.press('ArrowRight');
  ok(queues.length+upserts.length===flowWrites,'viewing and scrolling flow creates no writes');
  ok(errors.filter(e=>!e.includes('CATALOG_ENDPOINT_INVALID')).length===0,'no app JS errors');
  ok(!blocked.some(u=>/machtile\.com|muditjubqflrqofbkmav/.test(u)),'no production-domain requests');
  const allowed=new Set(['batch_report_progress','work_order_upsert','machine_queue_reorder','machine_queue_append','schedule_calendar_snapshot','attention_case_snapshot','hmc_runtime_snapshot','unified_event_list']);
  ok(rpcCalls.every(p=>allowed.has(p.replace('/rest/v1/rpc/',''))),'no unrelated mutation or auth endpoints called');
  console.log(`${checks} passed; screenshots=${out}`);
}finally{await ctx.close();await browser.close();await new Promise(resolve=>server.close(resolve))}
