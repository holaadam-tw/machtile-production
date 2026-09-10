(function(root,factory){const node=typeof module==='object'&&module.exports;const api=factory(node?require('./project-target.js'):root.HmcFixedProjectTarget);if(node)module.exports=api;else root.HmcFixedStagingRest=api;}(globalThis,function(Target){
  'use strict';
  const target=Target&&Target.url;
  const names=['hmc_fixed_read','hmc_fixed_execute','hmc_fixed_outcome','hmc_fixed_approve'];
  // Inject the SAME authenticated supabaseFetch/config pair already used by the host.
  // This guard prevents accidental wrong-project routing, not a malicious host.
  function create({request,getProjectUrl,enabled=false}={}){
    if(typeof target!=='string'||!target)throw new Error('PROJECT_TARGET_REQUIRED');
    return async function rpc(name,args){
      if(enabled!==true||typeof request!=='function'||typeof getProjectUrl!=='function')return {data:{ok:false,code:'FEATURE_DISABLED'},error:null};
      try{
        if(getProjectUrl()!==target||!names.includes(name))throw Error('STAGING_TARGET_REQUIRED');
        return {data:await request('rpc/'+name,{method:'POST',body:JSON.stringify(args)}),error:null};
      }catch(_){throw Error('STAGING_RPC_UNAVAILABLE');}
    };
  }
  return Object.freeze({create});
}));
