// Actual index/app; fake identities/machines; all backend requests intercepted.
// node machineDepartments.browser.test.mjs (set MACHTILE_PLAYWRIGHT_MODULE if needed)
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const {chromium}=await import(process.env.MACHTILE_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href:'playwright');
const server=createServer(async(req,res)=>{
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  const uri=new URL(req.url,'http://localhost');
  const file=path.resolve(root,'.'+(uri.pathname==='/'?'/index.html':decodeURIComponent(uri.pathname)));
  if(!file.startsWith(root+path.sep)||file.includes(`${path.sep}.git${path.sep}`)){res.writeHead(403);res.end();return;}
  try{const body=await readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,fake='https://department-fixture.test';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,tenant=id(1);
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const metadata={tenant_id:tenant,role:'admin'};
const token=`${encode({alg:'HS256'})}.${encode({sub:id(10),email:'admin@test.invalid',exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',app_metadata:metadata})}.synthetic`;
const departments=[{id:id(30),name:'車床課',department_code:'LATHE'},{id:id(31),name:'銑床課',department_code:'MILL'}];
const machines=[{machine_id:id(20),machine_code:'A01',machine_name:'A01',machine_type:'加工中心',department_name:'車床課',status:'idle',display_order:1},
  {machine_id:id(21),machine_code:'A99',machine_name:'A99',machine_type:'車床',department_name:null,status:'idle',display_order:2}];
const cards=[{work_order_id:id(40),work_order_no:'TEST-ORDER',part_name:'TEST PART',quantity:10,due_date:'2026-12-01',status:'not_started',
  current_process_id:id(41),current_process_order:1,current_process_name:'TEST PROCESS',machine_code:'A01',machine_name:'A01',process_status:'pending',qty_completed:0}];
let checks=0,departmentFail=false,machinesFail=false;
let access={tenant_id:tenant,role:'admin',is_bridge:false,all_departments:true,department_codes:['LATHE','MILL']},accessFail=false;
const posts=[],blocked=[],errors=[];
const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log(`PASS ${label}`)};
const browser=await chromium.launch();
try{
  for(const width of [1440,390]){
    departmentFail=false;machinesFail=false;
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    await context.addInitScript(token=>sessionStorage.setItem('machtileAuthSession',JSON.stringify({version:1,accessToken:token,refreshToken:'',email:'admin@test.invalid',authMethod:'password',mode:'session',createdAt:Date.now(),rememberUntil:0})),token);
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url()),json=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
      if(url.origin===fake){
        const p=url.pathname;
        if(p==='/auth/v1/user')return json({id:id(10),email:'admin@test.invalid',app_metadata:metadata});
        if(p==='/rest/v1/rpc/machine_department_context')return accessFail?route.fulfill({status:503,body:'unavailable'}):json(access);
        if(p==='/rest/v1/app_users')return json([{id:id(11),name:'TEST ADMIN',account:'admin@test.invalid',role:'admin',is_active:true}]);
        if(p==='/rest/v1/v_work_order_cards')return json(cards);
        if(p==='/rest/v1/v_machine_management_cards')return machinesFail?route.fulfill({status:503,body:'unavailable'}):json(machines);
        if(p==='/rest/v1/machine_departments')return departmentFail?route.fulfill({status:503,body:'unavailable'}):json(departments);
        if(p==='/rest/v1/machines')return json([{machine_code:'A01',name:'TEST MACHINE',machine_type:'加工中心',department_id:id(30),status:'idle',display_order:1}]);
        if(p==='/rest/v1/rpc/machine_upsert'){posts.push(JSON.parse(req.postData()).p_payload);return json({action:'created',machine_id:id(22)});}
        if(p==='/rest/v1/rpc/batch_report_progress')return json([]);
        if(p.startsWith('/rest/v1/rpc/'))return json(null);
        if(req.method()==='GET')return json([]);
        throw new Error(`Unexpected fake write ${req.method()} ${p}`);
      }
      if(url.origin===base&&req.method()==='GET'){
        if(url.pathname==='/config.js')return route.fulfill({contentType:'text/javascript',body:`window.MACHTILE_CONFIG=${JSON.stringify({authMode:'strict',supabaseUrl:fake,supabaseAnonKey:'synthetic-public-key',tenantId:tenant,useSupabase:true,useTenantHeaderAuth:false,enableScheduleContracts:false,enableCalibrationGovernance:false,enableManufacturingQuoteTracking:false,useHmcWorklistSupabase:false,oauthEnabled:false,enableJevTriage:false,disableServiceWorker:true,hmcFixedStagingEnabled:false})};`});
        return route.continue();
      }
      blocked.push({host:url.host,method:req.method()});return route.abort();
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('dataSourceLabel')?.textContent.includes('Supabase'));
    check(await page.locator('.machine-tile-card').filter({hasText:'A99'}).getByText('未設定課別',{exact:true}).count()===1,`${width}: NULL department visibly labeled, no type fallback`);
    check(await page.evaluate(()=>normalizedMachineDepartment(normalizeMachineMaster({machine_type:'車床',department_name:null})))==='未設定課別',`${width}: actual normalizer ignores type as authority`);
    await page.evaluate(()=>openAdminModule('add'));
    await page.locator('#machtileMcDepartment:not([disabled])').waitFor();
    await page.locator('#machtileMcCode').fill('A06');await page.locator('#machtileMcName').fill('TEST NEW');
    const before=posts.length;await page.locator('#machtileMachineForm button[type=submit]').click();
    check(posts.length===before,`${width}: empty required department blocked before RPC`);
    await page.locator('#machtileMcDepartment').selectOption(id(31));
    await page.locator('#machtileMachineForm button[type=submit]').click();
    await page.waitForFunction(()=>!document.getElementById('machtileMachineForm'));
    check(posts.length===before+1&&posts.at(-1).department_id===id(31),`${width}: explicit selected department in RPC payload`);
    await page.evaluate(()=>machtileOpenMachineEdit('A01'));
    await page.locator('#machtileMcDepartment:not([disabled])').waitFor();
    check(await page.locator('#machtileMcDepartment').inputValue()===id(30),`${width}: editing preserves explicit lathe despite milling type`);
    await mkdir(path.join(root,'output/playwright/machine-departments'),{recursive:true});
    await page.screenshot({path:path.join(root,`output/playwright/machine-departments/machine-form-${width}.png`)});
    departmentFail=true;await page.evaluate(()=>openAdminModule('add'));
    await page.waitForFunction(()=>document.getElementById('machtileMcDepartment')?.textContent.includes('讀取失敗'));
    check(await page.locator('#machtileMachineForm button[type=submit]').isDisabled(),`${width}: department lookup failure disables saving`);
    const beforeFailure=posts.length;await page.locator('#machtileMachineForm').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    check(posts.length===beforeFailure,`${width}: unavailable department cannot issue RPC`);
    machinesFail=true;
    const failure=await page.evaluate(async()=>{try{await loadFromSupabase();return '';}catch(e){return e.message;}});
    check(failure.includes('機台清單讀取失敗')&&await page.evaluate(()=>state.machines.length===0&&state.workOrders.length===0),`${width}: failed machine read clears stale state without local defaults`);
    machinesFail=false;departmentFail=false;
    await page.evaluate(()=>closeAdminModule());
    for(const codes of [['LATHE'],['MILL'],['LATHE','MILL'],[]]){
      access={...access,role:'operator',all_departments:false,department_codes:codes};
      await page.evaluate(async()=>{await loadFromSupabase();renderAll();});
      const labels=codes.map(x=>x==='LATHE'?'車床課':'銑床課');
      check(JSON.stringify(await page.locator('#departmentChips [data-department]').evaluateAll(nodes=>nodes.map(n=>n.dataset.department)))===JSON.stringify(labels),`${width}: staff course controls exactly ${codes.join('+')||'empty'}`);
      check(await page.evaluate(()=>machtileAvailableDepartments().includes(activeDepartmentFilter)||(activeDepartmentFilter===''&&machtileAvailableDepartments().length===0)),`${width}: selection remains inside permitted courses`);
      const tvCodes=await page.evaluate(()=>machtileTvBuildModel().lines.flatMap(line=>line.machines.map(cell=>cell.code)));
      check(tvCodes.every(code=>codes.includes('LATHE')&&code==='A01'),`${width}: TV cannot recreate unauthorized fixed machine tiles`);
      await page.evaluate(()=>{const b=document.createElement('button');b.dataset.department='全部';document.body.append(b);b.click();b.remove();});
      check(await page.evaluate(()=>activeDepartmentFilter!=='全部'),`${width}: forged all-course DOM click ignored`);
      if(codes.length===2){
        await page.locator('#departmentChips [data-department="銑床課"]').click();
        check(await page.evaluate(()=>activeDepartmentFilter==='銑床課'),`${width}: two-course member can actually switch to mill`);
        await page.screenshot({path:path.join(root,`output/playwright/machine-departments/course-switch-${width}.png`)});
      }
      if(codes.length===0){
        check(await page.locator('#departmentChips').textContent().then(x=>x.includes('此帳號沒有任何課別，請管理員設定')),`${width}: intentional empty has administrator prompt`);
        check(await page.evaluate(()=>state.machines.length===0&&state.machineMasters.length===0),`${width}: revoked courses clear prior machine state`);
        const stopped=await page.evaluate(async()=>{try{await supabaseFetch('rpc/machine_upsert',{method:'POST',body:'{}'});return false;}catch(e){return e.message.includes('沒有任何課別');}});
        check(stopped,`${width}: empty membership prevents RPC submission`);
      }
    }
    access={...access,role:'planner',all_departments:true,department_codes:['LATHE','MILL']};
    await page.evaluate(async()=>{await loadFromSupabase();renderAll();});
    check(await page.locator('#departmentChips [data-department="全部"]').count()===1,`${width}: planner retains all-course selector`);
    machinesFail=true;
    const tvDenied=await page.evaluate(async()=>{machtileTvState.model={fixture:true};try{await machtileTvFetchAll();return false;}catch(e){return e.message.includes('機台清單讀取失敗')&&machtileTvState.model===null&&state.machineMasters.length===0;}});
    check(tvDenied,`${width}: TV failed machine read clears previous privileged model`);
    machinesFail=false;
    accessFail=true;
    const denied=await page.evaluate(async()=>{try{await loadFromSupabase();return false;}catch(e){renderAll();return state.machines.length===0&&state.workOrders.length===0;}});
    check(denied&&await page.locator('#departmentChips [data-department]').count()===0,`${width}: context outage fails closed, no cached cards/chips`);
    accessFail=false;access={...access,role:'admin',all_departments:true};
    const logoutRace=await page.evaluate(async()=>{
      const oldFetch=window.fetch;let release;
      window.fetch=(...args)=>String(args[0]).includes('race-test')?new Promise(resolve=>{release=()=>resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));}):oldFetch(...args);
      const pending=supabaseFetch('race-test').then(()=>false,error=>error.message==='STALE_DEPARTMENT_RESPONSE');
      machtileClearSession();release();
      const rejected=await pending;window.fetch=oldFetch;
      return rejected&&machtileDepartmentAccess===null&&state.machines.length===0;
    });
    check(logoutRace,`${width}: delayed pre-logout response cannot repopulate signed-out state`);
    await context.close();
  }
  check(blocked.length===0,'no real backend or non-GET local request');check(errors.length===0,`no JS errors: ${errors.join(';')}`);
  console.log(`${checks}/${checks} browser department controls/machine form checks passed`);
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
