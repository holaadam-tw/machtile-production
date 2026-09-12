(function(root,factory){
  const api=typeof module==='object'&&module.exports?factory(require('./transport.js'),require('./rpc-port.js')):factory(root.HmcFixedSlotsTransport,root.HmcFixedRpcPort);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.HmcFixedStagingController=api;
}(globalThis,function(Transport,RpcPort){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
  const shape=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
  const validScope=s=>shape(s,['machineCode','palletNo'])&&['B01','B02'].includes(s.machineCode)&&Number.isInteger(s.palletNo)&&s.palletNo>=1&&s.palletNo<=6;
  const sameCatalog=(server,external,machineCode)=>{
    if(!server||!Array.isArray(server.availableParts)||!server.catalogSource||!external||!Array.isArray(external.items)||!external.source)return false;
    const source=server.catalogSource,remote=external.source;
    if(!shape(remote,['contractVersion','sourceSystem','retrievedAtUtc','machineCode']))return false;
    if(!external.items.every(item=>shape(item,['partNo','name'])&&typeof item.partNo==='string'&&typeof item.name==='string'))return false;
    if(source.contractVersion!==remote.contractVersion||source.sourceSystem!==remote.sourceSystem||source.machineCode!==machineCode||remote.machineCode!==machineCode||source.itemCount!==server.availableParts.length||source.itemCount!==external.items.length)return false;
    // Factory's retrievedAtUtc is the time of each GET, so a later verification
    // request is expected to differ. It must not predate the admitted mirror.
    if(!Number.isFinite(Date.parse(remote.retrievedAtUtc))||Date.parse(remote.retrievedAtUtc)<Date.parse(source.retrievedAtUtc))return false;
    const admitted=new Map(server.availableParts.map(item=>[item.partNo,item.name]));
    const observed=new Map(external.items.map(item=>[item.partNo,item.name]));
    if(admitted.size!==server.availableParts.length||observed.size!==external.items.length||admitted.size!==observed.size)return false;
    return [...admitted].every(([partNo,name])=>observed.get(partNo)===name);
  };
  // getContext supplies non-secret host identity only, never authority in RPC payloads.
  // Host must notify refreshContext on auth/tenant changes. Server remains authoritative.
  function create({rpc,getContext,enabled=false,allowWrites=false,requireExternalCatalog=false,loadCatalog,requestId=()=>globalThis.crypto.randomUUID(),transportFactory=Transport.create}={}){
    const transport=transportFactory(RpcPort.create({rpc,enabled}));
    let identity=null,closed=false,busy=false,scope=null,state=null,catalog=null,edit=null,serial=0;
    let phase=enabled===true?'NOT_LOADED':'DISABLED',code=phase;
    function context(){
      try{
        const c=getContext?.();
        if(!shape(c,['authUserId','tenantId','sessionGeneration'])||!uuid(c.authUserId)||!uuid(c.tenantId)||!Number.isSafeInteger(c.sessionGeneration)||c.sessionGeneration<0)return null;
        return JSON.stringify([c.authUserId,c.tenantId,c.sessionGeneration]);
      }catch(_){return null;}
    }
    function sync(){
      if(enabled!==true){phase=code='DISABLED';return false;}
      if(closed)return false;
      const now=context();
      if(identity!==null&&identity!==now){closed=true;phase=code='CONTEXT_CHANGED';state=catalog=edit=null;return false;}
      if(!now){phase=code='SIGNED_OUT';state=catalog=edit=null;return false;}
      if(identity===null){identity=now;if(phase==='SIGNED_OUT')phase=code='NOT_LOADED';}
      return true;
    }
    function snapshot(){
      if(sync()&&!busy&&transport.unresolved()){
        phase=code='OUTCOME_UNKNOWN';scope=scope||transport.pendingScope?.()||null;
        if(transport.pendingScope){scope=transport.pendingScope();state=catalog=edit=null;}
      }
      return clone({phase,code,scope,state,catalog,edit,busy,unresolved:transport.unresolved(),canWrite:!closed&&allowWrites===true&&phase==='READY'&&!busy&&!transport.unresolved()});
    }
    function fail(value){code=value;return snapshot();}
    async function select(next){
      if(!sync())return snapshot();
      if(busy)return fail('REQUEST_IN_FLIGHT');
      if(transport.unresolved())return fail('OUTCOME_UNKNOWN');
      if(!validScope(next))return fail('INVALID_SCOPE');
      scope=clone(next);state=catalog=edit=null;phase=code='LOADING';busy=true;
      let result,externalCatalog;
      try{
        // Refresh the private mirror before reading it. The refresh service derives
        // tenant scope from the signed user and admits only the exact Factory data.
        externalCatalog=requireExternalCatalog===true
          ? await (typeof loadCatalog==='function'?loadCatalog(scope.machineCode):Promise.reject(Error('CATALOG_UNAVAILABLE')))
          : null;
        result=await transport.read(scope);
      }catch(_){busy=false;if(!sync())return snapshot();phase=code='CATALOG_UNAVAILABLE';return snapshot();}
      busy=false;
      if(!sync())return snapshot();
      if(!result.ok){phase=code='READ_UNAVAILABLE';return snapshot();}
      const expected=JSON.parse(identity)[1];
      if((Object.hasOwn(result.catalog,'tenantId')&&result.catalog.tenantId!==expected)||result.state.audit.some(e=>e.tenantId!==expected)){
        phase=code='READ_UNAVAILABLE';return snapshot();
      }
      if(requireExternalCatalog===true){
        // The tenant-scoped server mirror is the sole admission and display authority.
        // The direct Factory read is only an exact freshness/provenance check and may
        // never replace a list that the server would reject at save time.
        if(!sameCatalog(result.catalog,externalCatalog,scope.machineCode)){phase=code='CATALOG_UNAVAILABLE';return snapshot();}
        result.catalog={...result.catalog,partCatalogSource:clone(result.catalog.catalogSource)};
      }
      state=result.state;catalog=result.catalog;phase=code='READY';return snapshot();
    }
    function beginEdit(type,slotId){
      if(!snapshot().canWrite)return fail('EDIT_NOT_AVAILABLE');
      if(!['add','configure','bind','unbind'].includes(type))return fail('INVALID_COMMAND');
      const slot=state.slots.find(s=>s.slotId===slotId);
      if(type==='add'&&slotId!==undefined||type!=='add'&&!slot)return fail('INVALID_COMMAND');
      if(slot&&(['configure','bind'].includes(type)&&slot.order!==null||type==='unbind'&&slot.order===null))return fail('EDIT_NOT_AVAILABLE');
      edit={key:++serial,type,slotId:slot?.slotId||null,expectedRevision:state.revision};code='EDITING';return snapshot();
    }
    function cancel(){if(!busy&&!transport.unresolved()){edit=null;code=phase;}return snapshot();}
    function tenantResult(result){
      return !result.ok||result.state.audit.every(e=>e.tenantId===JSON.parse(identity)[1]);
    }
    function settle(result){
      // A malformed cross-tenant success cannot be treated as a safe rejection/retry.
      if(!tenantResult(result)){closed=true;phase=code='CONTEXT_CHANGED';state=catalog=edit=null;return snapshot();}
      if(result.ok){
        edit=null;
        if(catalog){state=result.state;phase='READY';code='SAVED';}
        // Show the verified receipt immediately, but never call read() automatically: the
        // server read may release completed bindings. A fresh catalog is still required to edit.
        else{state=result.state;scope={machineCode:result.state.machineCode,palletNo:result.state.palletNo};phase='STALE';code='RECOVERED_RELOAD_REQUIRED';}
      }
      else if(transport.unresolved()){phase=code='OUTCOME_UNKNOWN';}
      else {phase='STALE';code=result.code;state=catalog=edit=null;}
      return snapshot();
    }
    async function save(key,values){
      if(!snapshot().canWrite)return fail(transport.unresolved()?'OUTCOME_UNKNOWN':'EDIT_NOT_AVAILABLE');
      if(!edit||key!==edit.key)return fail('STALE_EDITOR');
      // 2026-09-10 owner decision: part number (from catalog.availableParts) is required; process name and fixture are optional.
      const keys=edit.type==='add'||edit.type==='configure'?['partNo','operationName','fixtureName','confirmed','palletConfirmed']:edit.type==='bind'?['orderId','confirmed','palletConfirmed']:['confirmed','palletConfirmed'];
      if(!shape(values,keys)||values.confirmed!==true)return fail('CONFIRMATION_REQUIRED');
      // Per-edit human acknowledgement, not an IoT observation or server permission.
      // Never cache it across edits, send a fabricated timestamp, or bypass runtime locks.
      if(values.palletConfirmed!==true)return fail('MANUAL_PALLET_CONFIRMATION_REQUIRED');
      if(['add','configure'].includes(edit.type)){
        const str=(v,max)=>typeof v==='string'&&v.trim().length<=max;
        if(!str(values.partNo,60)||!values.partNo.trim()||!str(values.operationName,60)||!str(values.fixtureName,120))return fail('INVALID_COMMAND');
        if(!Array.isArray(catalog.availableParts)||!catalog.availableParts.some(a=>a&&a.partNo===values.partNo.trim()))return fail('PART_UNKNOWN');
        values={...values,partNo:values.partNo.trim(),operationName:values.operationName.trim(),fixtureName:values.fixtureName.trim()};
      }
      if(edit.type==='bind'){
        const slot=state.slots.find(s=>s.slotId===edit.slotId);
        if(!catalog.orders.some(o=>o.id===values.orderId&&o.partNo===slot.part.partNo&&o.machineCode===scope.machineCode&&o.status==='open'))return fail('ORDER_NOT_ELIGIBLE');
      }
      let rid;
      try{rid=requestId();}catch(_){return fail('INVALID_REQUEST_ID');}
      if(!uuid(rid))return fail('INVALID_REQUEST_ID');
      const {palletConfirmed,...payload}=values;
      const command={type:edit.type,expectedRevision:edit.expectedRevision,requestId:rid,...clone(payload)};
      if(edit.slotId!==null)command.slotId=edit.slotId;
      busy=true;phase=code='SAVING';
      const result=await transport.submit(scope,command);busy=false;
      if(!sync())return snapshot();
      return settle(result);
    }
    async function reconcile(){
      if(!sync())return snapshot();
      if(busy)return fail('REQUEST_IN_FLIGHT');
      if(!transport.unresolved())return fail('NO_PENDING_REQUEST');
      busy=true;phase=code='RECONCILING';
      const result=await transport.reconcile();busy=false;
      if(!sync())return snapshot();
      if(result.ok&&!result.state){state=catalog=edit=scope=null;phase='NOT_LOADED';code='MAPPING_RECOVERED';return snapshot();}
      if(result.ok&&transport.pendingScope)catalog=null;
      return settle(result);
    }
    return Object.freeze({snapshot,select,beginEdit,cancel,save,reconcile,refreshContext:snapshot});
  }
  return Object.freeze({create});
}));
