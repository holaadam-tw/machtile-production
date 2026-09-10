(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HmcFixedRpcPort=api;}(globalThis,function(){
  'use strict';
  // Source adapter only. Never instantiated by the preview/production entry point.
  // Caller must explicitly inject an authenticated SDK after separate staging approval.
  function create({rpc,enabled=false}){
    const call=async(name,args)=>{
      if(enabled!==true||typeof rpc!=='function')return {ok:false,code:'FEATURE_DISABLED'};
      let response;
      try{response=await rpc(name,args);}catch(_){throw new Error('RPC_UNAVAILABLE');}
      const {data,error}=response||{};
      if(error)throw new Error('RPC_UNAVAILABLE');
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('RPC_INVALID_RESPONSE');
      return data;
    };
    return Object.freeze({read:s=>call('hmc_fixed_read',{p_scope:s}),execute:(s,c)=>call('hmc_fixed_execute',{p_scope:s,p_command:c}),outcome:(s,id)=>call('hmc_fixed_outcome',{p_scope:s,p_request_id:id}),approve:c=>call('hmc_fixed_approve',{p_command:c})});
  }
  return Object.freeze({create});
}));
