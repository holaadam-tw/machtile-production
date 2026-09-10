(function (root,factory) {
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HmcFixedSlotsTransport=api;
}(globalThis,function(){
  'use strict';
  // Injected transport only: no fetch, credentials, Supabase or browser storage.
  const copy=x=>JSON.parse(JSON.stringify(x));
  const rejection=code=>({ok:false,code});
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const shape=(x,required,optional=[])=>object(x)&&required.every(k=>Object.hasOwn(x,k))&&Object.keys(x).every(k=>required.includes(k)||optional.includes(k));
  const text=x=>typeof x==='string'&&x.trim().length>0;
  const id=x=>text(x)&&x===x.trim();
  const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
  const list=(x,check)=>Array.isArray(x)&&Array.from(x).every(check);
  const unique=(xs,key)=>new Set(xs.map(x=>x[key])).size===xs.length;
  const stable=x=>Array.isArray(x)?'['+x.map(stable).join(',')+']':object(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x);
  const equal=(a,b)=>stable(a)===stable(b);
  const slotId=x=>typeof x==='string'&&/^slot-[1-9][0-9]*$/.test(x)&&Number.isSafeInteger(Number(x.slice(5)));
  function timestamp(x){
    if(typeof x!=='string')return false;
    const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(x);
    if(!m||!Number.isFinite(Date.parse(x)))return false;
    const [,y,mo,d,h,mi,s,zone]=m;
    return +mo>=1&&+mo<=12&&+d>=1&&+d<=new Date(Date.UTC(+y,+mo,0)).getUTCDate()&&+h<24&&+mi<60&&+s<60&&(zone==='Z'||(+zone.slice(1,3)<24&&+zone.slice(4)<60));
  }
  // 2026-09-10: operationName (製程) and fixtureName are optional and may be ''.
  const optional=(x,max)=>typeof x==='string'&&x===x.trim()&&x.length<=max;
  const part=x=>shape(x,['id','partNo','name','operationId'],['operationName'])&&id(x.id)&&id(x.partNo)&&x.partNo.length<=60&&text(x.name)&&id(x.operationId)&&(!Object.hasOwn(x,'operationName')||optional(x.operationName,60));
  const availablePart=x=>shape(x,['partNo','name'])&&id(x.partNo)&&x.partNo.length<=60&&text(x.name);
  // Bound orders are keyed by part number only (no partId/operationId anywhere in orders).
  const binding=x=>shape(x,['id','orderNo','partNo'])&&id(x.id)&&id(x.orderNo)&&text(x.partNo);
  const slot=x=>shape(x,['slotId','fixtureName','part','order'])&&slotId(x.slotId)&&optional(x.fixtureName,120)&&part(x.part)&&(x.order===null||(binding(x.order)&&x.order.partNo===x.part.partNo));
  const slots=x=>list(x,slot)&&unique(x,'slotId');
  // SQL state joins the current order number; audit keeps its historical label.
  const sameConfiguration=(a,b)=>equal(a.map(s=>({...s,order:s.order&&{...s.order,orderNo:null}})),b.map(s=>({...s,order:s.order&&{...s.order,orderNo:null}})));
  function validCatalog(c,scope){
    // availableParts is validated when present; a read without it simply cannot configure positions (controller fails closed).
    if(!shape(c,['parts','orders'],['ok','tenantId','machineCode','version','availableParts','excluded'])||!list(c.parts,part)||!unique(c.parts,'id'))return false;
    if(Object.hasOwn(c,'ok')&&c.ok!==true||Object.hasOwn(c,'tenantId')&&!uuid(c.tenantId)||Object.hasOwn(c,'machineCode')&&c.machineCode!==scope.machineCode||Object.hasOwn(c,'version')&&!text(c.version))return false;
    if(Object.hasOwn(c,'availableParts')&&(!list(c.availableParts,availablePart)||!unique(c.availableParts,'partNo')))return false;
    if(Object.hasOwn(c,'excluded')&&!list(c.excluded,x=>shape(x,['processId','code'])&&id(x.processId)&&x.code==='ORDER_NOT_ELIGIBLE'))return false;
    return list(c.orders,x=>shape(x,['id','orderNo','partNo','machineCode','status'])&&id(x.id)&&id(x.orderNo)&&text(x.partNo)&&x.machineCode===scope.machineCode&&['open','closed'].includes(x.status))&&unique(c.orders,'id');
  }
  function validState(state,scope){
    if(!shape(state,['machineCode','palletNo','revision','slots','audit'],['nextSlot'])||!scope||!['B01','B02'].includes(scope.machineCode)||!Number.isInteger(scope.palletNo)||scope.palletNo<1||scope.palletNo>6||state.machineCode!==scope.machineCode||state.palletNo!==scope.palletNo||!Number.isSafeInteger(state.revision)||state.revision<0||!slots(state.slots)||!Array.isArray(state.audit)||state.audit.length!==state.revision)return false;
    if(Object.hasOwn(state,'nextSlot')&&state.nextSlot!==state.slots.length+1)return false;
    let tenant=null;
    const requests=new Set();
    for(let i=0;i<state.audit.length;i++){
      const e=state.audit[i];
      if(!shape(e,['revision','type','slotId','before','after','requestId','actorId','tenantId','occurredAt'],['catalogVersion'])||e.revision!==i+1||!['add','configure','bind','unbind'].includes(e.type)||!slotId(e.slotId)||!uuid(e.requestId)||!uuid(e.actorId)||!uuid(e.tenantId)||!timestamp(e.occurredAt)||Object.hasOwn(e,'catalogVersion')&&!text(e.catalogVersion))return false;
      if(tenant!==null&&tenant!==e.tenantId)return false;
      const receiptKey=e.tenantId+':'+e.actorId+':'+e.requestId;
      if(requests.has(receiptKey))return false;
      tenant=e.tenantId;requests.add(receiptKey);
      const whole=Array.isArray(e.before);
      // SQL records whole-pallet snapshots; the offline model records one slot.
      // Validate each immutable event, not equality with later joined source labels.
      if(whole?(!slots(e.before)||!slots(e.after)):(e.before!==null&&!slot(e.before)))return false;
      const before=whole?e.before.find(s=>s.slotId===e.slotId)||null:e.before;
      const after=whole?e.after.find(s=>s.slotId===e.slotId):e.after;
      if(!slot(after)||after.slotId!==e.slotId)return false;
      if(e.type==='add'){
        if(before!==null||after.order!==null)return false;
      }else{
        if(before===null||before.slotId!==e.slotId)return false;
        if(e.type==='configure'&&(before.order!==null||after.order!==null))return false;
        if(['bind','unbind'].includes(e.type)&&(!equal(before.part,after.part)||before.fixtureName!==after.fixtureName))return false;
        if(e.type==='bind'&&(before.order!==null||after.order===null)||e.type==='unbind'&&(before.order===null||after.order!==null))return false;
      }
      if(whole){
        const next=before===null?[...e.before,after]:e.before.map(s=>s.slotId===e.slotId?after:s);
        if(!equal(next,e.after))return false;
      }
      if(i===state.audit.length-1){
        const current=state.slots.find(s=>s.slotId===e.slotId);
        if(!current||!sameConfiguration([after],[current])||whole&&!sameConfiguration(e.after,state.slots))return false;
      }
    }
    return state.revision!==0||state.slots.length===0;
  }
  function validRequest(r){
    if(shape(r,['scope','command'])&&shape(r.scope,['type'])&&r.scope.type==='mapping'){
      const c=r.command;if(!object(c))return false;
      const existing=Object.hasOwn(c,'operationId');
      return shape(c,['requestId','processId','expectedProcessVersion','expectedOrderVersion','confirmed',existing?'operationId':'operationName'])&&uuid(c.requestId)&&uuid(c.processId)&&timestamp(c.expectedProcessVersion)&&timestamp(c.expectedOrderVersion)&&c.confirmed===true&&(existing?uuid(c.operationId):text(c.operationName)&&c.operationName.trim().length<=120);
    }
    if(!shape(r,['scope','command'])||!shape(r.scope,['machineCode','palletNo'])||!['B01','B02'].includes(r.scope.machineCode)||!Number.isInteger(r.scope.palletNo)||r.scope.palletNo<1||r.scope.palletNo>6)return false;
    const c=r.command,base=['type','expectedRevision','requestId','confirmed'];
    if(!object(c)||!['add','configure','bind','unbind'].includes(c.type))return false;
    const fields=[...base,...(c.type==='add'?[]:['slotId']),...(['add','configure'].includes(c.type)?['partNo','operationName','fixtureName']:c.type==='bind'?['orderId']:[])];
    return shape(c,fields)&&Number.isSafeInteger(c.expectedRevision)&&c.expectedRevision>=0&&uuid(c.requestId)&&c.confirmed===true&&(c.type==='add'||slotId(c.slotId))&&(!['add','configure'].includes(c.type)||(id(c.partNo)&&c.partNo.length<=60&&typeof c.operationName==='string'&&c.operationName.trim().length<=60&&typeof c.fixtureName==='string'&&c.fixtureName.trim().length<=120))&&(c.type!=='bind'||id(c.orderId));
  }
  function create(port) {
    let pending=null, busy=false;
    const unresolved=()=>pending!==null;
    const validApplied=(r,request)=>{
      if(request.scope.type==='mapping')return validRequest(request)&&shape(r,['ok','requestId','operationId','processId'])&&r.ok===true&&r.requestId===request.command.requestId&&r.processId===request.command.processId&&uuid(r.operationId)&&(!Object.hasOwn(request.command,'operationId')||r.operationId===request.command.operationId);
      if(!r||r.ok!==true||r.requestId!==request.command.requestId||!validState(r.state,request.scope)||r.state.revision!==request.command.expectedRevision+1)return false;
      const event=r.state.audit.at(-1);
      if(event.requestId!==request.command.requestId||event.type!==request.command.type||event.revision!==r.state.revision||request.command.type!=='add'&&event.slotId!==request.command.slotId)return false;
      const changed=r.state.slots.find(s=>s.slotId===event.slotId), c=request.command;
      if(['add','configure'].includes(c.type))return changed.part.partNo===c.partNo&&(changed.part.operationName??'')===c.operationName.trim()&&changed.fixtureName===c.fixtureName.trim();
      return c.type==='bind'?changed.order?.id===c.orderId:c.type==='unbind'&&changed.order===null;
    };
    async function submit(scope,command) {
      if(busy)return rejection('REQUEST_IN_FLIGHT');
      if(pending)return rejection('OUTCOME_UNKNOWN');
      let request;
      try{request={scope:copy(scope),command:copy(command)};}catch(_){return rejection('INVALID_COMMAND');}
      if(request.scope?.type==='mapping'&&!validRequest(request))return rejection('INVALID_COMMAND');
      busy=true;
      pending=request;
      try {
        const r=request.scope.type==='mapping'?await port.approve(copy(request.command)):await port.execute(copy(request.scope),copy(request.command));
        // Only fixed domain rejections are known not to have committed.
        const codes=['FEATURE_DISABLED','MAPPING_REQUIRED','SOURCE_CHANGED','FORBIDDEN','INVALID_SCOPE','INVALID_COMMAND','REQUEST_REUSED','VERSION_CONFLICT','PALLET_LOCKED','CATALOG_UNAVAILABLE','WRITE_REJECTED','SLOT_NOT_FOUND','UNBIND_BEFORE_CONFIGURE','UNBIND_BEFORE_REPLACE','ORDER_NOT_ELIGIBLE','PART_CHANGED','NO_BOUND_ORDER','CATALOG_INVALID','CONFIGURATION_REQUIRED','PART_UNKNOWN','SOURCE_NOT_FOUND','UNBIND_BEFORE_REMAP','PART_MISMATCH'];
        if(validApplied(r,request)){const result=copy(r);pending=null;return result;}
        if(r&&r.ok===false&&codes.includes(r.code)){pending=null;return rejection(r.code);}
        return rejection('OUTCOME_UNKNOWN');
      }catch(_){return rejection('OUTCOME_UNKNOWN');}
      finally{busy=false;}
    }
    async function reconcile() {
      if(busy)return rejection('REQUEST_IN_FLIGHT');
      if(!pending)return rejection('NO_PENDING_REQUEST');
      busy=true;
      try {
        const r=await port.outcome(copy(pending.scope),pending.command.requestId);
        if(r&&r.ok===true&&r.status==='APPLIED'&&validApplied(r.result,pending)){const result=copy(r.result);pending=null;return result;}
        // NOT_FOUND can race a still-running request; never treat it as safe to retry.
        return rejection('OUTCOME_UNKNOWN');
      }catch(_){return rejection('OUTCOME_UNKNOWN');}
      finally{busy=false;}
    }
    async function read(scope){
      try{
        const r=await port.read(copy(scope));
        if(r&&r.ok===true&&validState(r.state,scope)&&validCatalog(r.catalog,scope))return copy(r);
        return rejection('READ_UNAVAILABLE');
      }catch(_){return rejection('READ_UNAVAILABLE');}
    }
    function restore(request){
      if(busy||pending||!validRequest(request))return false;
      pending=copy(request);return true;
    }
    return Object.freeze({submit,reconcile,read,unresolved,restore});
  }
  return Object.freeze({create,validRequest,validVersion:timestamp});
}));
