// Shared, read-only process strip. Never synthesizes missing routing steps or quantities.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileProcessFlow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const text = v => v == null ? "" : String(v).trim();
  const escape = v => text(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const numeric = v => v != null && text(v) !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
  function department(value) {
    const s=text(value).toLowerCase();
    return /車|lathe/.test(s)?'lathe':/銑|五軸|mill|加工中心|machining/.test(s)?'mill':null;
  }
  function preplanTarget(rows,currentId) {
    const list=steps(rows,currentId),index=list.findIndex(p=>p.current);
    if(index<0||list.slice(0,index).some(p=>p.status!=='completed'))return null;
    const target=list[index+1];
    return target&&!target.outsourced&&['pending','paused'].includes(target.status)
      &&target.done!==null&&!target.hasReports&&department(target.name)?target:null;
  }
  function candidateMachines(target,machines) {
    const dept=department(target?.name);
    return dept?(machines||[]).filter(m=>m.id&&!['maintenance','offline'].includes(m.status||m.rawStatus)
      &&(department(m.department)||department(m.type||m.machine_type))===dept):[];
  }
  function steps(rows, currentId) {
    if (!currentId) {
      const active = (Array.isArray(rows) ? rows : []).filter(p => ["running", "in_progress"].includes(p.status));
      if (active.length === 1) currentId = active[0].id;
    }
    return (Array.isArray(rows) ? rows : []).slice().sort((a,b) => Number(a.process_order)-Number(b.process_order)).map(p => {
      const outsourced = ["outsource", "outsourced"].includes(p.process_type);
      const state = text(p.status);
      const label = state === "completed" ? "已完成"
        : outsourced ? (["running", "in_progress"].includes(state) ? "委外中" : state === "pending" ? "待發包" : "狀態待確認")
        : ["running", "in_progress"].includes(state) ? "進行中"
        : state === "pending" ? "未開始" : "狀態待確認";
      return {...p, label, outsourced, current: Boolean(currentId && String(p.id) === String(currentId)),
        number: Number.isInteger(Number(p.process_order)) && Number(p.process_order)>0 ? `N${p.process_order}` : "步序無資料",
        name: text(p.process_name) || text(p.PP_Name) || "工序名無資料",
        resource: outsourced ? text(p.supplier_code) || "委外廠商無資料" : text(p.machine_code) || "未排機",
        done: numeric(p.reported)};
    });
  }
  function render(rows, {currentId = null, quantity = null, label = "製程流程",canPreplan=false,machines=[],orderNo='',auditAvailable=false} = {}) {
    const list = steps(rows, currentId), qty = numeric(quantity);
    currentId=currentId||list.find(p=>p.current)?.id||null;
    const target=canPreplan&&auditAvailable?preplanTarget(rows,currentId):null;
    const choices=target?candidateMachines(target,machines):[];
    const controls=p=>target?.id===p.id&&choices.length?`<div class="process-flow-preplan" data-no-detail>
      <label>預排下一站<select data-flow-machine aria-label="${escape(p.number)} 預排機台"><option value="">選同課機台</option>${choices.map(m=>`<option value="${escape(m.id)}">${escape(m.code||m.machine_code||m.name)}</option>`).join('')}</select></label>
      <button type="button" data-flow-append="${escape(p.id)}" data-flow-current="${escape(currentId)}" data-flow-order="${escape(orderNo)}">預排到佇列末端</button>
      <small role="status" data-flow-result>只預排 MachTile；舊 MES 派工為準。</small></div>`:'';
    if (!list.length) return '<p class="process-flow-empty">製程路線無資料</p>';
    if (typeof document !== "undefined") requestAnimationFrame(() => {
      document.querySelectorAll('.process-flow:not([data-flow-aligned])').forEach(el => {
        el.dataset.flowAligned = "true";
        const current = el.querySelector('[aria-current="step"]');
        if (current) el.scrollLeft += current.getBoundingClientRect().left - el.getBoundingClientRect().left - 8;
      });
    });
    return `<div class="process-flow" data-no-detail tabindex="0" role="region" aria-label="${escape(label)}（可橫向捲動）"><ol>${list.map(p =>
      `<li class="process-flow-step wo-step-row${p.current ? " is-current" : ""}"${p.current ? ' aria-current="step"' : ""} data-flow-process="${escape(p.id)}"><div class="process-flow-head"><strong>${escape(p.number)}</strong><span class="process-flow-status"><i aria-hidden="true"></i>${escape(p.label)}</span></div><b class="process-flow-name">${escape(p.name)}</b><span>${escape(p.resource)}</span><span class="process-flow-quantity">${p.done === null ? "已報無資料" : `已報 ${escape(p.done)}`} / ${qty === null ? "工單量無資料" : escape(qty)}${p.hasReports ? ' <small>已鎖定</small>' : ""}</span>${p.assignmentEvent?.kind==='legacy_reassigned'?'<small class="process-flow-reassigned">已依舊 MES 改派</small>':p.assignmentEvent?.kind==='preplan'?'<small>已預排，等待舊 MES 派工確認</small>':p.assignmentEvent?.kind==='legacy_confirmed'?'<small>舊 MES 已確認同台</small>':''}${controls(p)}</li>`).join("")}</ol></div>`;
  }
  return {steps, render,department,preplanTarget,candidateMachines};
});
