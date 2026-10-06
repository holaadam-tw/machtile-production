// Actual index/app; fake identities/accounts; every backend request intercepted (no network).
// 員工帳號管理 → 所屬課別（車床課／銑床課）: badge, edit-form checkboxes, 儲存課別, 404 fallback,
// bridge lock, manager scope, non-manager gate.
// node accountDepartments.browser.test.mjs (set MACHTILE_PLAYWRIGHT_MODULE if needed)
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
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
const base=`http://127.0.0.1:${server.address().port}`,fake='https://account-department-fixture.test';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,tenant=id(1);
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const token=(sub,email,role)=>`${encode({alg:'HS256'})}.${encode({sub,email,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',app_metadata:{tenant_id:tenant,role}})}.synthetic`;
// accounts (synthetic): app_users id = id(100+n), auth id = id(200+n)
const A=n=>id(100+n),U=n=>id(200+n);
const appUsers=[
  {id:A(1),name:'測試管理者',account:'admin@test.invalid',role:'admin',is_active:true,auth_user_id:U(1)},
  {id:A(2),name:'測試主管',account:'manager@test.invalid',role:'manager',is_active:true,auth_user_id:U(2)},
  {id:A(3),name:'車床師傅',account:'op-lathe@machtile.local',role:'operator',is_active:true,auth_user_id:U(3)},
  {id:A(4),name:'新師傅',account:'op-new@machtile.local',role:'operator',is_active:true,auth_user_id:U(4)},
  {id:A(5),name:'空課師傅',account:'op-none@machtile.local',role:'operator',is_active:true,auth_user_id:U(5)},
  {id:A(6),name:'CNC 回寫（系統帳號）',account:'cncwb@machtile.local',role:'operator',is_active:true,auth_user_id:U(6)},
  {id:A(7),name:'排程員',account:'planner@test.invalid',role:'planner',is_active:true,auth_user_id:U(7)},
  {id:A(8),name:'沒登入身分',account:'nologin@machtile.local',role:'operator',is_active:true,auth_user_id:null},
];
const initialDept=()=>({
  [U(1)]:{auth_user_id:U(1),department_codes:['LATHE','MILL'],configured:true,is_bridge:false},
  [U(2)]:{auth_user_id:U(2),department_codes:['LATHE','MILL'],configured:true,is_bridge:false},
  [U(3)]:{auth_user_id:U(3),department_codes:['LATHE'],configured:true,is_bridge:false},
  [U(4)]:{auth_user_id:U(4),department_codes:null,configured:false,is_bridge:false},
  [U(5)]:{auth_user_id:U(5),department_codes:[],configured:true,is_bridge:false},
  [U(6)]:{auth_user_id:U(6),department_codes:['LATHE','MILL'],configured:true,is_bridge:true},
  [U(7)]:{auth_user_id:U(7),department_codes:['MILL'],configured:true,is_bridge:false},
});
let checks=0;const errors=[],blocked=[];
const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log(`PASS ${label}`)};
const browser=await chromium.launch();

async function session({role,self,width=1440,listMode='ok',setMode='ok'}){
  const st={dept:initialDept(),listCalls:[],setCalls:[],setMode,listMode};
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  const me=appUsers.find(u=>u.id===self);
  const jwt=token(me.auth_user_id,me.account,role);
  await context.addInitScript(([t,email])=>sessionStorage.setItem('machtileAuthSession',JSON.stringify({version:1,accessToken:t,refreshToken:'',email,authMethod:'password',mode:'session',createdAt:Date.now(),rememberUntil:0})),[jwt,me.account]);
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),json=(x,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(x)});
    if(url.origin===fake){
      const p=url.pathname;
      if(p==='/auth/v1/user')return json({id:me.auth_user_id,email:me.account,app_metadata:{tenant_id:tenant,role}});
      if(p==='/rest/v1/rpc/machine_department_context')return json({tenant_id:tenant,role,is_bridge:false,all_departments:true,department_codes:['LATHE','MILL']});
      if(p==='/rest/v1/app_users'){
        if((url.searchParams.get('select')||'').includes('auth_user_id'))return json(appUsers);
        return json(appUsers.filter(u=>u.id===self));
      }
      if(p==='/rest/v1/rpc/machine_departments_admin_list'){
        const body=JSON.parse(req.postData());st.listCalls.push(body);
        if(st.listMode==='missing')return json({code:'PGRST202',message:'Could not find the function public.machine_departments_admin_list'},404);
        if(st.listMode==='error')return json({message:'boom'},503);
        return json(body.p_auth_user_ids.filter(x=>st.dept[x]).map(x=>st.dept[x]));
      }
      if(p==='/rest/v1/rpc/machine_departments_admin_set'){
        const body=JSON.parse(req.postData());st.setCalls.push(body);
        if(st.setMode==='missing')return json({code:'PGRST202',message:'Could not find the function'},404);
        if(st.setMode==='forbidden')return json({code:'P0001',message:'FORBIDDEN'},400);
        const prev=st.dept[body.p_auth_user_id];
        const codes=['LATHE','MILL'].filter(c=>body.p_department_codes.includes(c));
        st.dept[body.p_auth_user_id]={...prev,department_codes:codes,configured:true};
        return json({auth_user_id:body.p_auth_user_id,department_codes:codes,previous_department_codes:prev?.department_codes??null,changed:JSON.stringify(prev?.department_codes)!==JSON.stringify(codes)});
      }
      if(p.startsWith('/functions/v1/'))return json({status:'ok',entries:[],users:[]});
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
  await page.evaluate(()=>openAdminModule('users'));
  return {page,context,st};
}
const row=(page,appId)=>page.locator(`[data-am-row="${appId}"]`);
const badge=async(page,appId)=>{const b=page.locator(`[data-am-dept-badge="${appId}"]`);return (await b.count())?(await b.textContent()).trim():null;};
const noOverflow=async page=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);

try{
  // ---- admin, desktop and phone width -----------------------------------------------------
  for(const width of [1440,390]){
    const {page,context,st}=await session({role:'admin',self:A(1),width});
    await page.locator(`[data-am-row="${A(3)}"]`).waitFor();
    await page.waitForFunction(()=>document.querySelector('[data-am-dept-badge]'));
    check(st.listCalls.length===1,`${width}: departments read once (batched)`);
    check(JSON.stringify([...st.listCalls[0].p_auth_user_ids].sort())===JSON.stringify([U(1),U(2),U(3),U(4),U(5),U(6),U(7)].sort()),`${width}: batched read carries every linked auth id, none for unlinked row`);
    check(await badge(page,A(3))==='車床',`${width}: LATHE-only badge 車床`);
    check(await badge(page,A(4))==='兩課',`${width}: missing row badge 兩課 (server default)`);
    check(await badge(page,A(5))==='無課別⚠',`${width}: explicit empty badge 無課別⚠`);
    check(await badge(page,A(7))==='銑床',`${width}: planner MILL badge 銑床`);
    check(await badge(page,A(8))===null,`${width}: account without login identity has no badge`);
    check(await noOverflow(page),`${width}: no horizontal overflow with badges`);

    // edit operator A3: LATHE → MILL, keep the typed name draft
    await row(page,A(3)).getByRole('button',{name:'編輯'}).click();
    const lathe=page.locator(`[data-am-dept-check="${A(3)}"][value="LATHE"]`),mill=page.locator(`[data-am-dept-check="${A(3)}"][value="MILL"]`);
    check(await lathe.isChecked()&&!(await mill.isChecked()),`${width}: edit form checkboxes reflect LATHE`);
    check(await page.locator(`[data-am-edit-name="${A(3)}"]`).count()===1,`${width}: name/account fields still in edit form`);
    check(await noOverflow(page),`${width}: no horizontal overflow with edit form open`);
    await page.locator(`[data-am-edit-name="${A(3)}"]`).fill('車床師傅（草稿）');
    await lathe.uncheck();await mill.check();
    await page.locator(`[data-am-dept-save="${A(3)}"]`).click();
    await page.waitForFunction(id=>document.querySelector(`[data-am-dept-badge="${id}"]`)?.textContent.trim()==='銑床',A(3));
    check(st.setCalls.length===1&&st.setCalls[0].p_auth_user_id===U(3)&&JSON.stringify(st.setCalls[0].p_department_codes)==='["MILL"]',`${width}: 儲存課別 calls RPC with auth id + ["MILL"] only`);
    check(Object.keys(st.setCalls[0]).sort().join()==='p_auth_user_id,p_department_codes',`${width}: no tenant or role sent from the browser`);
    check((await page.locator('[data-am-status]').textContent()).includes('已儲存「車床師傅」的課別：銑床課'),`${width}: success message names person and department`);
    check(await page.locator(`[data-am-edit-name="${A(3)}"]`).inputValue()==='車床師傅（草稿）',`${width}: unsaved name draft kept after saving departments`);
    check(await page.locator(`[data-am-dept-check="${A(3)}"][value="MILL"]`).isChecked(),`${width}: checkbox state re-rendered from saved value`);

    // edit A4 (no row yet → both pre-checked), save nothing checked → explicit empty
    await row(page,A(4)).getByRole('button',{name:'編輯'}).click();
    check(await page.locator(`[data-am-dept-check="${A(4)}"]:checked`).count()===2,`${width}: missing row pre-checks both`);
    check((await page.locator(`[data-am-dept-row="${A(4)}"]`).textContent()).includes('目前尚未設定（預設兩課）'),`${width}: missing row explained`);
    for(const box of await page.locator(`[data-am-dept-check="${A(4)}"]`).all())await box.uncheck();
    await page.locator(`[data-am-dept-save="${A(4)}"]`).click();
    await page.waitForFunction(id=>document.querySelector(`[data-am-dept-badge="${id}"]`)?.textContent.trim()==='無課別⚠',A(4));
    check(JSON.stringify(st.setCalls.at(-1).p_department_codes)==='[]',`${width}: nothing checked sends explicit []`);

    // server refusal: message, badge unchanged
    st.setMode='forbidden';
    await row(page,A(5)).getByRole('button',{name:'編輯'}).click();
    await page.locator(`[data-am-dept-check="${A(5)}"][value="LATHE"]`).check();
    await page.locator(`[data-am-dept-save="${A(5)}"]`).click();
    await page.waitForFunction(()=>document.querySelector('[data-am-status]')?.textContent.includes('沒有權限'));
    check(await badge(page,A(5))==='無課別⚠',`${width}: refused save leaves badge unchanged`);
    st.setMode='ok';

    // bridge account (special section): locked, no checkboxes, no save
    await page.locator('[data-am-special-toggle]').click();
    check(await badge(page,A(6))==='🔒 兩課（橋接）',`${width}: bridge badge locked`);
    await row(page,A(6)).getByRole('button',{name:'編輯'}).click();
    check(await page.locator(`[data-am-dept-locked="${A(6)}"]`).count()===1
      &&await page.locator(`[data-am-dept-check="${A(6)}"]`).count()===0
      &&await page.locator(`[data-am-dept-save="${A(6)}"]`).count()===0,`${width}: bridge edit shows lock, no controls`);

    // planner row: controls present with role hint
    await row(page,A(7)).getByRole('button',{name:'編輯'}).click();
    check((await page.locator(`[data-am-dept-row="${A(7)}"]`).textContent()).includes('只在作業員身上生效'),`${width}: planner row explains all-department role`);
    // account without login identity
    await row(page,A(8)).getByRole('button',{name:'編輯'}).click();
    check(await page.locator(`[data-am-dept-nologin="${A(8)}"]`).count()===1&&await page.locator(`[data-am-dept-check="${A(8)}"]`).count()===0,`${width}: unlinked account cannot set departments`);
    check(await noOverflow(page),`${width}: no horizontal overflow at the end`);
    await context.close();
  }

  // ---- RPC not deployed (404) on read: section hidden with a note, modal still works ---------
  {
    const {page,context,st}=await session({role:'admin',self:A(1),listMode:'missing'});
    await page.locator(`[data-am-row="${A(3)}"]`).waitFor();
    await page.waitForTimeout(200);
    check(st.listCalls.length===1&&await page.locator('[data-am-dept-badge]').count()===0,'404 read: no badges');
    await row(page,A(3)).getByRole('button',{name:'編輯'}).click();
    check(await page.locator('[data-am-dept-unavailable]').count()===1&&(await page.locator('[data-am-dept-unavailable]').textContent()).includes('尚未開通'),'404 read: edit form shows short not-yet-available note');
    check(await page.locator('[data-am-dept-check]').count()===0&&await page.locator('[data-am-dept-save]').count()===0,'404 read: no department controls');
    check(await page.locator(`[data-am-edit-name="${A(3)}"]`).count()===1&&await page.locator(`[data-am-edit-confirm="${A(3)}"]`).count()===1,'404 read: name/account edit still available');
    check(await row(page,A(3)).getByRole('button',{name:'重設密碼'}).count()===1,'404 read: other row actions intact');
    await context.close();
  }
  // ---- other read failure: same graceful note ---------------------------------------------
  {
    const {page,context}=await session({role:'admin',self:A(1),listMode:'error'});
    await page.locator(`[data-am-row="${A(3)}"]`).waitFor();
    await row(page,A(3)).getByRole('button',{name:'編輯'}).click();
    check((await page.locator('[data-am-dept-unavailable]').textContent()).includes('暫時讀不到'),'503 read: edit form shows temporary-failure note');
    await context.close();
  }
  // ---- read OK but set RPC 404 (partial deploy): switches to not-available ------------------
  {
    const {page,context,st}=await session({role:'admin',self:A(1),setMode:'missing'});
    await page.waitForFunction(()=>document.querySelector('[data-am-dept-badge]'));
    await row(page,A(3)).getByRole('button',{name:'編輯'}).click();
    await page.locator(`[data-am-dept-save="${A(3)}"]`).click();
    await page.waitForFunction(()=>document.querySelector('[data-am-dept-unavailable]'));
    check(st.setCalls.length===1&&(await page.locator('[data-am-status]').textContent()).includes('尚未開通'),'404 save: message and section hidden');
    await context.close();
  }

  // ---- manager: operators only ------------------------------------------------------------
  {
    const {page,context,st}=await session({role:'manager',self:A(2)});
    await page.waitForFunction(()=>document.querySelector('[data-am-dept-badge]'));
    check(st.listCalls.length===1,'manager: departments read once');
    check(await badge(page,A(3))==='車床','manager: sees badges');
    check(await row(page,A(1)).getByRole('button',{name:'編輯'}).count()===0&&await row(page,A(7)).getByRole('button',{name:'編輯'}).count()===0,'manager: no edit (so no department controls) on admin/planner rows');
    await row(page,A(3)).getByRole('button',{name:'編輯'}).click();
    await page.locator(`[data-am-dept-check="${A(3)}"][value="MILL"]`).check();
    await page.locator(`[data-am-dept-save="${A(3)}"]`).click();
    await page.waitForFunction(id=>document.querySelector(`[data-am-dept-badge="${id}"]`)?.textContent.trim()==='兩課',A(3));
    check(JSON.stringify(st.setCalls.at(-1))===JSON.stringify({p_auth_user_id:U(3),p_department_codes:['LATHE','MILL']}),'manager: saves operator departments via RPC');
    await context.close();
  }

  // ---- non-managers never see or call it ------------------------------------------------------
  for(const [role,self] of [['planner',A(7)],['operator',A(3)]]){
    const {page,context,st}=await session({role,self});
    await page.waitForFunction(()=>document.querySelector('[data-am-users-root]')?.textContent.includes('需要管理者或主管帳號'));
    await page.waitForTimeout(150);
    check(st.listCalls.length===0&&st.setCalls.length===0&&await page.locator('[data-am-dept-badge],[data-am-dept-row]').count()===0,`${role}: no department read/controls`);
    await context.close();
  }

  check(errors.length===0,`no page errors (${errors.join(' | ')})`);
  check(blocked.length===0,`no request left the fixture (${JSON.stringify(blocked.slice(0,3))})`);
}finally{await browser.close();server.close();}
console.log(`${checks}/${checks} PASS accountDepartments.browser.test.mjs`);
