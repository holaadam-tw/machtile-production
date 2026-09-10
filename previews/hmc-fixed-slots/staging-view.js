(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HmcFixedStagingView=api;}(globalThis,function(){
  'use strict';
  // Inert until mounted by an approved host; no automatic connection or global config.
  function mount(root,controller){
    const doc=root.ownerDocument;
    const el=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
    let disposed=false;
    async function action(fn){const promise=fn();render();await promise;if(!disposed)render();}
    const button=(text,fn,disabled=false)=>{const b=el('button',text);b.type='button';b.disabled=disabled;b.addEventListener('click',()=>action(fn));return b;};
    function select(options,value){const s=el('select');for(const [id,label] of options){const o=el('option',label);o.value=id;s.append(o);}if(value!==undefined)s.value=value;return s;}
    function render(){
      if(disposed)return;
      const v=controller.snapshot();
      root.replaceChildren();
      root.append(el('h2','六盤常駐工件與本次工單 · Staging'));
      root.append(el('p','先設定各位置常用工件與模具，有工單才載入；解除工單後固定配置仍保留。載入不是開工，也不增加產量。'));
      root.append(el('p','目前沒有 IoT 即時盤況。請現場確認後再修改；畫面重新讀取不代表機台已停止。既有伺服器權限、版本與盤況鎖仍須通過。'));
      const message={DISABLED:'功能尚未啟用；未連線。',SIGNED_OUT:'請先登入。',CONTEXT_CHANGED:'登入或租戶已變更；畫面已清除。若有未明結果，須先核對原請求，不能重送。',NOT_LOADED:'請選機台與盤號。',LOADING:'讀取中…',READ_UNAVAILABLE:'無法讀取，不能判定為空盤。',READY:'資料已讀取。',SAVING:'保存中，請勿重複送出。',RECONCILING:'查核原請求中…',OUTCOME_UNKNOWN:'原請求結果不明；禁止重送，請查核原請求。',STALE:'未套用變更；請重新讀取後核對。'};
      const status=el('p',v.code==='SAVED'?'已確認保存成功。':v.code==='RECOVERED_RELOAD_REQUIRED'?'已查核原請求成功；請重新讀取最新盤位。':message[v.phase]||'目前不可操作。');status.setAttribute('role','status');root.append(status);
      const nav=el('nav');nav.setAttribute('aria-label','機台與六盤');
      const blocked=v.busy||v.unresolved||['DISABLED','SIGNED_OUT','CONTEXT_CHANGED'].includes(v.phase);
      for(const m of ['B01','B02'])for(let p=1;p<=6;p++){
        const b=button(m+' · 盤 '+p,()=>controller.select({machineCode:m,palletNo:p}),blocked);
        b.setAttribute('aria-pressed',String(v.scope?.machineCode===m&&v.scope?.palletNo===p));nav.append(b);
      }
      root.append(nav);
      if(v.scope)root.append(button('重新讀取',()=>controller.select(v.scope),blocked));
      if(v.unresolved)root.append(button('查核原請求（不重送）',()=>controller.reconcile(),v.busy||v.phase==='CONTEXT_CHANGED'));
      if(v.unresolved)root.append(el('p','網路可能中斷，但剛才的操作可能已保存。先查原結果，不要再按一次或清除瀏覽器資料；不會保存你的密碼。'));
      if(!v.state)return;
      root.append(el('h3',v.scope.machineCode+' · 盤 '+v.scope.palletNo));
      root.append(el('p',v.state.slots.length+' 個固定位置 · 版本 '+v.state.revision));
      if(!v.state.slots.length)root.append(el('p','已確認此盤尚無固定配置。'));
      for(const slot of v.state.slots){
        const row=el('section');row.dataset.slot=slot.slotId;
        row.append(el('h4',slot.part.partNo+' · '+slot.part.name),el('p','常駐製程／模具：'+(slot.part.operationName||'未指定製程')+' · '+(slot.fixtureName||'（未填模具）')),el('p',slot.order?.orderNo||'尚未載入工單（固定工件與模具保留）'));
        row.append(button(slot.order?'解除本次工單':'載入本次工單',()=>controller.beginEdit(slot.order?'unbind':'bind',slot.slotId),!v.canWrite));
        row.append(button('修改固定配置',()=>controller.beginEdit('configure',slot.slotId),!v.canWrite||!!slot.order));root.append(row);
      }
      root.append(button('新增固定位置',()=>controller.beginEdit('add'),!v.canWrite));
      if(!v.edit)return;
      const e=v.edit,slot=v.state.slots.find(s=>s.slotId===e.slotId),form=el('section');form.dataset.editor=String(e.key);
      form.append(el('h3',{add:'新增固定配置',configure:'修改固定配置',bind:'選擇本次工單',unbind:'解除工單，保留固定工件與模具'}[e.type]));
      const label=(text,input)=>{const l=el('label',text);l.append(input);form.append(l);};
      let part,operation,fixture,order;
      if(['add','configure'].includes(e.type)){
        // 2026-09-10 owner decision: part number is chosen from the tenant's work orders; process name and fixture are optional.
        const available=Array.isArray(v.catalog.availableParts)?v.catalog.availableParts:[];
        part=select([['','請選工件品號'],...available.map(a=>[a.partNo,a.partNo+' · '+a.name])],slot?.part.partNo);part.required=true;label('工件品號',part);
        operation=el('input');operation.value=slot?.part.operationName||'';operation.maxLength=60;label('製程（選填，例 N1／N2）',operation);
        fixture=el('input');fixture.value=slot?.fixtureName||'';fixture.maxLength=120;label('模具／夾具（選填）',fixture);
        if(!available.length)form.append(el('p','目前沒有可選的工件品號；請先確認本租戶的工單。'));
      }
      if(e.type==='bind'){
        const candidates=v.catalog.orders.filter(o=>o.machineCode===v.scope.machineCode&&o.partNo===slot.part.partNo&&o.status==='open');
        order=select([['','請選工單'],...candidates.map(o=>[o.id,o.orderNo])]);label('本次工單',order);
        if(!candidates.length)form.append(el('p','目前沒有本機台同品號的可掛工單。'));
      }
      const confirmed=el('input');confirmed.type='checkbox';label('我已核對機台、盤號、位置及本次內容',confirmed);
      const palletConfirmed=el('input');palletConfirmed.type='checkbox';label('我已在現場確認此盤未加工，現在可進行本次配置或掛單變更',palletConfirmed);
      form.append(el('p','此確認只適用本次操作，不是機台自動偵測，也不取代現場安全程序。'));
      for(const input of [part,operation,fixture,order,confirmed,palletConfirmed].filter(Boolean))input.disabled=!v.canWrite;
      form.append(button('取消',()=>controller.cancel(),v.busy||v.unresolved));
      form.append(button('確認保存',()=>controller.save(e.key,{confirmed:confirmed.checked,palletConfirmed:palletConfirmed.checked,...(part?{partNo:part.value,operationName:operation.value,fixtureName:fixture.value}:{}),...(order?{orderId:order.value}:{})}),!v.canWrite));
      if(v.code==='CONFIRMATION_REQUIRED')form.append(el('p','請完整核對並勾選確認。'));
      if(v.code==='PART_UNKNOWN'||v.code==='INVALID_COMMAND')form.append(el('p','請選擇工件品號；製程與模具為選填。'));
      if(v.code==='MANUAL_PALLET_CONFIRMATION_REQUIRED')form.append(el('p','請先到現場確認此盤未加工，並勾選本次盤況確認。'));
      root.append(form);
    }
    render();
    return Object.freeze({render,dispose(){disposed=true;root.replaceChildren();}});
  }
  return Object.freeze({mount});
}));
