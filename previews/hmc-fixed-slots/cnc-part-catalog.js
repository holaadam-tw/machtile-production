(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HmcCncPartCatalog=api;
}(globalThis,function(){
  'use strict';
  const CONTRACT='machtile-cnc-part-catalog.v1';
  const SOURCE='SoftNetERP.Material+BOM';
  const FUNCTION_PATH='/functions/v1/hmc-cnc-catalog-refresh';
  // Only public, fixed Edge Function codes may reach the UI. Never echo error
  // bodies, URLs, tokens, or arbitrary exception messages from remote services.
  const REFRESH_FAILURE_STATUS=Object.freeze({
    REFRESH_NOT_CONFIGURED:503,AUTH_UNAVAILABLE:503,TENANT_LOOKUP_UNAVAILABLE:503,
    CATALOG_SOURCE_UNAVAILABLE:502,CATALOG_SOURCE_INVALID:502,
    CATALOG_WRITE_REJECTED:503,REFRESH_UNAVAILABLE:503,
    CATALOG_FACTORY_AUTH_UNAVAILABLE:502,CATALOG_FACTORY_DB_UNAVAILABLE:502,
    CATALOG_FACTORY_DATA_INVALID:502,CATALOG_FACTORY_PROVIDER_UNAVAILABLE:502,
    CATALOG_FACTORY_HTTP_UNAVAILABLE:502,CATALOG_FACTORY_TRANSPORT_UNAVAILABLE:502,
    CATALOG_FACTORY_ACCESS_REDIRECT:502
  });
  const diagnosticCode=x=>typeof x==='string'&&(
    Object.hasOwn(REFRESH_FAILURE_STATUS,x.replace(/^CATALOG_REFRESH_/,''))&&x.startsWith('CATALOG_REFRESH_')||
    ['CATALOG_HTTP_502','CATALOG_HTTP_503','CATALOG_HTTP_504'].includes(x)
  );
  const machine=x=>x==='B01'||x==='B02';
  const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
  const text=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max&&x===x.trim();
  function utcStamp(value){
    if(!text(value,64))return false;
    const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(?:Z|\+00:00)$/.exec(value);
    if(!match)return false;
    const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number);
    if(year<2000||month<1||month>12||day<1||hour>23||minute>59||second>59)return false;
    const date=new Date(Date.UTC(year,month-1,day,hour,minute,second));
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day&&
      date.getUTCHours()===hour&&date.getUTCMinutes()===minute&&date.getUTCSeconds()===second;
  }
  function normalize(payload,expectedMachine){
    if(!exact(payload,['ok','contractVersion','sourceSystem','retrievedAtUtc','machineCode','items'])||
      payload.ok!==true||payload.contractVersion!==CONTRACT||payload.sourceSystem!==SOURCE||
      payload.machineCode!==expectedMachine||!utcStamp(payload.retrievedAtUtc)||
      !Array.isArray(payload.items)||payload.items.length>500)throw Error('CATALOG_INVALID');
    const seen=new Set(),items=[];
    for(const item of payload.items){
      if(!exact(item,['partNo','name'])||!text(item.partNo,60)||!text(item.name,200)||seen.has(item.partNo))throw Error('CATALOG_INVALID');
      seen.add(item.partNo);items.push({partNo:item.partNo,name:item.name});
    }
    return Object.freeze({
      items:Object.freeze(items),
      source:Object.freeze({contractVersion:CONTRACT,sourceSystem:SOURCE,retrievedAtUtc:payload.retrievedAtUtc,machineCode:expectedMachine})
    });
  }
  function create({fetch:fetcher=globalThis.fetch,getAccessToken,projectUrl,publishableKey,timeoutMs=25000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
    let target;
    try{target=new URL(FUNCTION_PATH,String(projectUrl||'').replace(/\/$/,'')+'/');}catch(_){throw Error('CATALOG_ENDPOINT_INVALID');}
    if(target.protocol!=='https:'||!/^[a-z0-9]{20}\.supabase\.co$/.test(target.hostname)||target.pathname!==FUNCTION_PATH||target.search||target.hash)throw Error('CATALOG_ENDPOINT_INVALID');
    if(typeof fetcher!=='function'||typeof getAccessToken!=='function'||typeof publishableKey!=='string'||publishableKey.length<20||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)throw Error('CATALOG_CONFIG_INVALID');
    async function load(machineCode){
      if(!machine(machineCode))throw Error('CATALOG_SCOPE_INVALID');
      const token=String(getAccessToken()||'').trim();
      if(token.length<32||token.length>32768)throw Error('CATALOG_AUTH_REQUIRED');
      const abort=new AbortController();const timer=setTimer(()=>abort.abort(),timeoutMs);
      try{
        const response=await fetcher(target.href,{method:'POST',headers:{Authorization:'Bearer '+token,apikey:publishableKey,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({machineCode}),cache:'no-store',credentials:'omit',signal:abort.signal});
        if(!response||response.ok!==true){
          if(response&&[401,403].includes(response.status))throw Error('CATALOG_ACCESS_DENIED');
          let failure;
          try{failure=await response.json();}catch(_){/* Gateway failures may not be JSON. */}
          if(exact(failure,['ok','code'])&&failure.ok===false&&typeof failure.code==='string'&&
            REFRESH_FAILURE_STATUS[failure.code]===response.status)throw Error('CATALOG_REFRESH_'+failure.code);
          if(response&&[502,503,504].includes(response.status))throw Error('CATALOG_HTTP_'+response.status);
          throw Error('CATALOG_UNAVAILABLE');
        }
        let payload;try{payload=await response.json();}catch(_){throw Error('CATALOG_INVALID');}
        if(!exact(payload,['ok','status','itemCount','retrievedAtUtc','catalog'])||payload.ok!==true||!['REPLACED','UNCHANGED'].includes(payload.status)||!Number.isInteger(payload.itemCount)||payload.itemCount<0||payload.itemCount>500||!utcStamp(payload.retrievedAtUtc))throw Error('CATALOG_INVALID');
        const result=normalize(payload.catalog,machineCode);
        if(payload.itemCount!==result.items.length||payload.retrievedAtUtc!==result.source.retrievedAtUtc)throw Error('CATALOG_INVALID');
        return result;
      }catch(error){
        if(error&&(['CATALOG_ACCESS_DENIED','CATALOG_INVALID'].includes(error.message)||diagnosticCode(error.message)))throw error;
        throw Error('CATALOG_UNAVAILABLE');
      }finally{clearTimer(timer);}
    }
    return Object.freeze({load});
  }
  return Object.freeze({create,normalize,utcStamp,CONTRACT,SOURCE,FUNCTION_PATH});
}));
