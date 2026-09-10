(function(root,factory){const node=typeof module==='object'&&module.exports;const api=factory(node?require('./transport.js'):root.HmcFixedSlotsTransport,node?require('./project-target.js'):root.HmcFixedProjectTarget);if(node)module.exports=api;else root.HmcFixedDurableTransport=api;}(globalThis,function(Transport,Target){
  'use strict';
  // Journal keys are namespaced by the deploy target so two projects can never share a pending request.
  const NAMESPACE=Target&&Target.ref;
  const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
  const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
  const copy=x=>JSON.parse(JSON.stringify(x));
  const reject=()=>({ok:false,code:'OUTCOME_UNKNOWN'});
  // Same-origin storage and Web Locks are injected. No tokens or automatic retries.
  // Origin storage is not trusted authorization and cannot survive deliberate deletion.
  function create(port,{storage,locks,owner,isCurrent}={}){
    if(typeof NAMESPACE!=='string'||!NAMESPACE)throw new Error('PROJECT_TARGET_REQUIRED');
    const validOwner=exact(owner,['authUserId','tenantId'])&&uuid(owner.authUserId)&&uuid(owner.tenantId);
    const who=validOwner?copy(owner):null;
    const key=validOwner?'hmc-fixed:'+NAMESPACE+':v1:'+who.tenantId+':'+who.authUserId:null;
    let poisoned=false;
    function current(){try{return validOwner&&isCurrent()===true;}catch(_){return false;}}
    function load(){
      if(poisoned||!validOwner||typeof storage?.getItem!=='function')throw Error('RECOVERY_BLOCKED');
      const raw=storage.getItem(key);if(raw===null)return null;
      if(typeof raw!=='string'||raw.length>16384)throw Error('RECOVERY_BLOCKED');
      const record=JSON.parse(raw);
      if(!exact(record,['version','owner','request'])||record.version!==1||!exact(record.owner,['authUserId','tenantId'])||record.owner.authUserId!==who.authUserId||record.owner.tenantId!==who.tenantId||!Transport.validRequest(record.request))throw Error('RECOVERY_BLOCKED');
      return record;
    }
    function unresolved(){try{return typeof locks?.request!=='function'||typeof storage?.setItem!=='function'||typeof storage?.removeItem!=='function'||load()!==null;}catch(_){return true;}}
    function pendingScope(){try{return copy(load()?.request.scope||null);}catch(_){return null;}}
    function store(record){
      const raw=JSON.stringify(record);if(raw.length>16384)throw Error('RECOVERY_BLOCKED');
      storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('RECOVERY_BLOCKED');
    }
    async function exclusive(fn){
      if(!current()||poisoned||typeof locks?.request!=='function')return reject();
      try{return await locks.request(key,{mode:'exclusive',ifAvailable:true},async lock=>{
        if(!lock||!current())return reject();return await fn();
      });}catch(_){poisoned=true;return reject();}
    }
    async function run(request,recover){
      return exclusive(async()=>{
        const record=load();if(!recover&&record)return reject();
        if(recover&&!record)return {ok:false,code:'NO_PENDING_REQUEST'};
        const original=record?.request||request;
        if(!Transport.validRequest(original))return {ok:false,code:'INVALID_COMMAND'};
        async function send(s,c,approve){
          if(!current())throw Error('CONTEXT_CHANGED');
          try{store({version:1,owner:who,request:{scope:s,command:c}});}catch(_){poisoned=true;throw Error('RECOVERY_BLOCKED');}
          if(!current())throw Error('CONTEXT_CHANGED');return approve?port.approve(c):port.execute(s,c);
        }
        const inner=Transport.create({
          read:port.read,
          outcome:async(s,id)=>{if(!current())throw Error('CONTEXT_CHANGED');return port.outcome(s,id);},
          execute:(s,c)=>send(s,c,false),
          approve:c=>send({type:'mapping'},c,true)
        });
        if(recover&&!inner.restore(original))return reject();
        const result=recover?await inner.reconcile():await inner.submit(original.scope,original.command);
        if(!current())return reject();
        if(result.ok&&original.scope.type!=='mapping'&&result.state.audit.some(e=>e.tenantId!==who.tenantId))return reject();
        if(!inner.unresolved()){
          // Only validated APPLIED or a known immediate non-commit rejection clears.
          storage.removeItem(key);if(storage.getItem(key)!==null){poisoned=true;return reject();}
        }
        return result;
      });
    }
    return Object.freeze({unresolved,pendingScope,
      submit:(scope,command)=>run({scope:copy(scope),command:copy(command)},false),
      reconcile:()=>run(null,true),
      read:async scope=>{
        if(!current()||unresolved())return {ok:false,code:'READ_UNAVAILABLE'};
        const result=await Transport.create(port).read(scope);
        return current()&&!unresolved()?result:{ok:false,code:'READ_UNAVAILABLE'};
      }
    });
  }
  return Object.freeze({create});
}));
