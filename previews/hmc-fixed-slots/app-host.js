(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=node?factory(require('./staging-session.js'),require('./project-target.js'),require('./staging-rest.js')):factory(root.HmcFixedStagingSession,root.HmcFixedProjectTarget,root.HmcFixedStagingRest);
  if(node)module.exports=api;else root.HmcFixedAppHost=api;
}(globalThis,function(Session,Target,Rest){
  'use strict';
  // The process-mapping panel was cancelled by the owner on 2026-09-10: this host opens fixed slots only.
  const PROJECT=Target&&Target.url;
  const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
  const machine=x=>x==='B01'||x==='B02';
  function create({getSettings,getIdentity,request,loadCatalog,getRoot,getSheet,getStorage,getLocks,events,requestId,
    now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,mountSlots=Session.mount}={}){
    // Fail closed rather than defaulting to some project when the deploy-target guard is absent.
    if(typeof PROJECT!=='string'||!PROJECT)throw new Error('PROJECT_TARGET_REQUIRED');
    let generation=0,blocked=false,panel=null,timer=null,listening=false,subscribers=new Set();
    function settings(){try{return getSettings();}catch(_){return {};}}
    function identity(requireSource=true){try{
      const s=settings();if(blocked||s.enabled!==true||s.strict!==true||(requireSource&&s.source!=='supabase')||s.projectUrl!==PROJECT)return null;
      const c=getIdentity();
      if(!c||c.status!=='signedIn'||!uuid(c.authUserId)||!uuid(c.tenantId)||!Number.isFinite(c.expiresAt)||c.expiresAt<=now())return null;
      return {authUserId:c.authUserId,tenantId:c.tenantId,sessionGeneration:generation};
    }catch(_){return null;}}
    function lifecycle(){
      if(listening)return;
      events.addEventListener('storage',storageChanged);events.addEventListener('pagehide',invalidate);listening=true;
      // Watch the enabled signed-in host even while its panel is closed.
      // Local UI expiry only: no refresh, polling, scheduler, or network action.
      timer=setTimer(invalidate,Math.min(2147483647,Math.max(0,getIdentity().expiresAt-now())));
    }
    function available(){if(identity(false))lifecycle();return identity()!==null;}
    function context(){return available()?identity():null;}
    function close(){
      const old=panel;panel=null;old?.dispose();
      const sheet=getSheet();if(sheet){sheet.classList.remove('is-open');sheet.setAttribute('aria-hidden','true');}
    }
    function invalidate(){
      blocked=true;generation++;for(const cb of [...subscribers])cb();close();
      if(timer!==null){clearTimer(timer);timer=null;}
      if(listening){events.removeEventListener('storage',storageChanged);events.removeEventListener('pagehide',invalidate);listening=false;}
    }
    function authChanged(){invalidate();blocked=false;available();}
    function storageChanged(event){
      // Do not read either oldValue or newValue: these may contain credentials.
      if(event.key===null||['machtileAuthSession','machtileRememberedAuthSession'].includes(event.key)){invalidate();return;}
      if(typeof event.key==='string'&&event.key.startsWith('hmc-fixed:'))for(const cb of [...subscribers])cb();
    }
    async function open(kind,selection){
      if(!available())return false;
      if(kind!=='slots'||!selection||!machine(selection.machineCode)||
        !Number.isInteger(selection.palletNo)||selection.palletNo<1||selection.palletNo>6)return false;
      close();const root=getRoot(),sheet=getSheet();if(!root||!sheet)return false;
      const captured=identity();if(!captured)return false;
      let storage,locks;try{storage=getStorage();locks=getLocks();}catch(_){return false;}
      const context=()=>{const c=identity();return c&&JSON.stringify(c)===JSON.stringify(captured)?c:null;};
      const options={enabled:true,allowWrites:settings().allowWrites===true,getContext:context,
        subscribe:cb=>{subscribers.add(cb);return ()=>subscribers.delete(cb);},
        request,getProjectUrl:()=>settings().projectUrl,requireExternalCatalog:true,loadCatalog,storage,locks,requestId};
      const mounted=mountSlots(root,options);panel=mounted;
      sheet.classList.add('is-open');sheet.setAttribute('aria-hidden','false');
      try{
        const pending=mounted.controller.select(selection);
        mounted.render();await pending;if(panel===mounted)mounted.render();
      }catch(_){invalidate();return false;}
      return panel===mounted;
    }
    async function readPallets(machineCode){
      if(!available()||!machine(machineCode))return null;
      const captured=identity();if(!captured)return null;
      const rpc=Rest.create({enabled:true,request,getProjectUrl:()=>settings().projectUrl});
      const rows=await Promise.all(Array.from({length:6},async(_,index)=>{
        const scope={machineCode,palletNo:index+1};
        const response=await rpc('hmc_fixed_read',{p_scope:scope});
        if(JSON.stringify(identity())!==JSON.stringify(captured))throw Error('CONTEXT_CHANGED');
        return response?.data?.ok===true&&response.data.state?.machineCode===machineCode&&response.data.state?.palletNo===scope.palletNo?response.data.state:null;
      }));
      return rows.filter(Boolean);
    }
    return Object.freeze({available,open,readPallets,close,authChanged,invalidate,context});
  }
  return Object.freeze({create});
}));
