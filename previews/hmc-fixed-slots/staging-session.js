(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./staging-controller.js'),require('./durable-transport.js'),require('./staging-rest.js'),require('./staging-view.js')):factory(root.HmcFixedStagingController,root.HmcFixedDurableTransport,root.HmcFixedStagingRest,root.HmcFixedStagingView);if(typeof module==='object'&&module.exports)module.exports=api;else root.HmcFixedStagingSession=api;}(globalThis,function(Controller,Durable,Rest,View){
  'use strict';
  // Host sends only non-secret identity; no independent auth SDK or polling.
  function mount(root,{enabled=false,allowWrites=false,getContext,subscribe,request,getProjectUrl,requireExternalCatalog=false,loadCatalog,storage,locks,requestId,controllerFactory=Controller.create,viewFactory=View.mount}={}){
    if(enabled!==true){const controller=controllerFactory();return {controller,...viewFactory(root,controller)};}
    let stopped=false,ready=false,view,unsubscribe;
    function context(){try{return !stopped?getContext():null;}catch(_){return null;}}
    const first=context(),identity=JSON.stringify(first);
    const owner={authUserId:first?.authUserId,tenantId:first?.tenantId};
    const current=()=>ready&&!stopped&&JSON.stringify(context())===identity;
    const rpc=Rest.create({enabled:true,request,getProjectUrl});
    const controller=controllerFactory({enabled:true,allowWrites,getContext:context,requestId,requireExternalCatalog,loadCatalog,
      rpc:async(...args)=>{if(!current())throw Error('CONTEXT_CHANGED');return rpc(...args);},
      transportFactory:port=>Durable.create(port,{storage,locks,owner,isCurrent:current})
    });
    function changed(){controller.refreshContext();view?.render();}
    try{
      if(typeof subscribe!=='function')throw Error('LIFECYCLE_REQUIRED');
      unsubscribe=subscribe(changed);
      if(typeof unsubscribe!=='function')throw Error('LIFECYCLE_REQUIRED');
      ready=true;
    }catch(_){stopped=true;controller.refreshContext();}
    view=viewFactory(root,controller);
    return Object.freeze({controller,render:()=>view.render(),dispose(){
      stopped=true;ready=false;controller.refreshContext();view.dispose();
      try{unsubscribe?.();}catch(_){}
      // Never delete another session's unresolved write-ahead record on logout.
    }});
  }
  return Object.freeze({mount});
}));
