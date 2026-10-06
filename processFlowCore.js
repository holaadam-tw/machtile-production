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
  // Display metadata cannot create a dispatchable process, progress, status or assignment.
  function mergeRoute(routeRows, processes, orderNo) {
    const actual = Array.isArray(processes) ? processes : [];
    if (!Array.isArray(routeRows) || !routeRows.length) return actual.slice();
    const seen = new Set(), byStep = new Map();
    for (const p of actual) {
      const n = Number(p.process_order);
      if (byStep.has(n)) throw new Error('ambiguous actual process step');
      byStep.set(n,p);
    }
    const result = routeRows.map(r => {
      const n = Number(r.step_no);
      if (!Number.isInteger(n) || n<=0 || seen.has(n) || typeof r.is_outsourced !== 'boolean'
        || (r.work_order_no != null && text(r.work_order_no)!==text(orderNo))) throw new Error('invalid display route');
      seen.add(n);
      const p = byStep.get(n);
      if (r.is_outsourced) return {id:p?.id||`route:${orderNo}:${n}`,process_order:n,process_name:text(r.operation_name),
        process_type:'outsourced',supplier_name:text(r.supplier_name),supplier_code:text(r.supplier_no),
        status:p?.status||'',reported:p?.reported??null,routeOnly:!p,hasReports:p?.hasReports||false};
      return {...(p || {id:`route:${orderNo}:${n}`,process_order:n,status:'',reported:null,routeOnly:true}),
        process_name:text(r.operation_name)||text(p?.process_name),process_type:p?.process_type||'cnc'};
    });
    // Old dispatch records remain real data; metadata cannot delete them or hide stale assignment conflicts.
    return result.concat(actual.filter(p=>!seen.has(Number(p.process_order)))).sort((a,b)=>Number(a.process_order)-Number(b.process_order));
  }
  function department(value) {
    const s=text(value).toLowerCase();
    return /車|lathe/.test(s)?'lathe':/銑|五軸|mill|加工中心|machining/.test(s)?'mill':null;
  }
  function preplanTarget(rows,currentId) {
    const list=steps(rows,currentId),index=list.findIndex(p=>p.current);
    if(index<0||list.slice(0,index).some(p=>p.status!=='completed'))return null;
    const target=list[index+1];
    return target&&!target.outsourced&&['pending','paused'].includes(target.status)
      &&target.done!==null&&!target.hasReports&&operationDepartment(target)?target:null;
  }
  // Only the existing assignment can supply a fallback; never infer from the requested destination.
  function operationDepartment(target) {
    return department(target?.name || target?.process_name) || department(target?.machine_department);
  }
  function candidateMachines(target,machines) {
    const dept=operationDepartment(target);
    return dept?(machines||[]).filter(m=>m.id&&!['maintenance','offline'].includes(m.status||m.rawStatus)
      &&department(m.department)===dept):[];
  }
  // Flow visibility per role (display only; set by planner+ per tenant). Unknown/missing => full, so nothing changes on deploy.
  const LEVELS = Object.freeze(["full", "adjacent", "next_only", "hidden"]);
  const ROLES = Object.freeze(["admin", "manager", "planner", "inspector", "station", "operator"]);
  function visibilityLevel(settings, role) {
    const value = settings && typeof settings === "object" ? settings[text(role)] : null;
    return LEVELS.includes(value) ? value : "full";
  }
  function normalizeVisibility(settings) {
    return Object.fromEntries(ROLES.map(role => [role, visibilityLevel(settings, role)]));
  }
  // Status follows the same reported quantity the card shows (legacy MES + App, via cardProgress).
  // Explicit non-pending statuses keep their own labels; quantity never says 完成.
  function quantityLabel(done, qty) {
    if (done === null || done <= 0) return "未開始";
    return qty !== null && qty > 0 && done >= qty ? "已達數" : "進行中";
  }
  function steps(rows, currentId, quantity = null) {
    const qty = numeric(quantity);
    if (!currentId) {
      const active = (Array.isArray(rows) ? rows : []).filter(p => ["running", "in_progress"].includes(p.status));
      if (active.length === 1) currentId = active[0].id;
    }
    return (Array.isArray(rows) ? rows : []).slice().sort((a,b) => Number(a.process_order)-Number(b.process_order)).map(p => {
      const outsourced = ["outsource", "outsourced"].includes(p.process_type);
      const state = text(p.status);
      const done = numeric(p.reported);
      const label = state === "completed" ? "已完成"
        : outsourced ? (["running", "in_progress"].includes(state) ? "委外中" : state === "pending" ? "待發包" : "委外狀態無資料")
        : ["running", "in_progress"].includes(state) ? "進行中"
        : state === "pending" ? quantityLabel(done, qty) : "狀態待確認";
      return {...p, label, outsourced, current: Boolean(currentId && String(p.id) === String(currentId)),
        number: Number.isInteger(Number(p.process_order)) && Number(p.process_order)>0 ? `N${p.process_order}` : "步序無資料",
        name: text(p.process_name) || text(p.PP_Name) || "工序名無資料",
        resource: outsourced ? `委外：${text(p.supplier_name) || text(p.supplier_code) || "廠商無資料"}` : text(p.machine_code) || (p.routeOnly ? "機台無資料" : "未排機"),
        done};
    });
  }
  const stepCell = (p, qty, kind) => `<li class="process-flow-step wo-step-row" data-flow-process="${escape(p.id)}"><span class="process-flow-kind">${kind}</span><div class="process-flow-head"><strong>${escape(p.number)}</strong><span class="process-flow-status"><i aria-hidden="true"></i>${escape(p.label)}</span></div><b class="process-flow-name">${escape(p.name)}</b><span>${escape(p.resource)}</span><span class="process-flow-quantity">${p.done === null ? "已報無資料" : `已報 ${escape(p.done)}`} / ${qty === null ? "工單量無資料" : escape(qty)}</span></li>`;
  // next_only: this order's next step + this machine's next queued order. Nothing else from the route.
  function renderNextOnly(list, currentIndex, qty, nextQueued) {
    const next = currentIndex < 0 ? null : list[currentIndex + 1] || null;
    const orderCell = currentIndex < 0
      ? '<li class="process-flow-step process-flow-note"><span class="process-flow-kind">本單下一道</span><span>目前道未確認</span></li>'
      : next ? stepCell(next, qty, "本單下一道")
      : '<li class="process-flow-step process-flow-note"><span class="process-flow-kind">本單下一道</span><span>本道是最後一道</span></li>';
    const q = nextQueued && typeof nextQueued === "object" ? nextQueued : {status: "unknown"};
    const queueCell = q.status === "ok"
      ? `<li class="process-flow-step process-flow-queue" data-flow-queue="${escape(q.orderNo)}"><span class="process-flow-kind">本機下一張</span><strong>${escape(q.orderNo)}</strong><b class="process-flow-name">${escape(q.operation || "工序名無資料")}</b>${q.part ? `<span>${escape(q.part)}</span>` : ""}</li>`
      : `<li class="process-flow-step process-flow-note" data-flow-queue=""><span class="process-flow-kind">本機下一張</span><span>${q.status === "none" ? "本機佇列沒有下一張" : "佇列資料無法確認"}</span></li>`;
    return `<div class="process-flow process-flow-compact process-flow-next" data-flow-level="next_only" data-flow-aligned="true" data-no-detail role="group" aria-label="下一步"><ol>${orderCell}${queueCell}</ol></div>`;
  }
  function render(rows, {currentId = null, quantity = null, label = "製程流程",canPreplan=false,machines=[],orderNo='',auditAvailable=false,compact=false,alignCurrent=true,visibility='full',nextQueued=null} = {}) {
    const level = LEVELS.includes(visibility) ? visibility : "full";
    if (level === "hidden") return "";
    // Any level other than full never renders the complete route or its opener.
    if (level !== "full") compact = true;
    const opener = compact && level === "full";
    const list = steps(rows, currentId, quantity), qty = numeric(quantity);
    currentId=currentId||list.find(p=>p.current)?.id||null;
    const currentIndex=list.findIndex(p=>p.current);
    if (level === "next_only") return list.length ? renderNextOnly(list, currentIndex, qty, nextQueued) : '<p class="process-flow-empty">製程路線無資料</p>';
    const visible=compact?(currentIndex<0?[]:list.slice(Math.max(0,currentIndex-1),currentIndex+2)):list;
    const target=canPreplan&&auditAvailable?preplanTarget(rows,currentId):null;
    const choices=target?candidateMachines(target,machines):[];
    const controls=p=>!compact&&target?.id===p.id&&choices.length?`<div class="process-flow-preplan" data-no-detail>
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
    const countText = opener ? `共 ${list.length} 道 · 點開看完整路線${currentIndex<0?'（目前道未確認）':''}` : currentIndex<0 ? '目前道未確認' : '';
    return `<div class="process-flow${compact?' process-flow-compact':''}${compact&&!opener?' process-flow-static':''}" data-flow-level="${level}" ${opener?`data-flow-open="${escape(orderNo)}" data-flow-current="${escape(currentId)}"`:''} ${!alignCurrent||compact?'data-flow-aligned="true"':''} data-no-detail ${opener||!compact?'tabindex="0" ':''}role="${opener?'button':compact?'group':'region'}" aria-label="${escape(label)}（${opener?'點開完整路線':compact?'前後道預覽':'可橫向捲動'}）">${countText?`<span class="process-flow-count">${countText}</span>`:''}<ol>${visible.map(p =>
      `<li class="process-flow-step wo-step-row${p.current ? " is-current" : ""}"${p.current ? ' aria-current="step"' : ""} data-flow-process="${escape(p.id)}">${compact?`<span class="process-flow-kind">${p.current?'目前道':list.indexOf(p)<currentIndex?'上一道'+(p.status==='completed'?' ✓':''):'下一道'}</span>`:''}<div class="process-flow-head"><strong>${escape(p.number)}</strong><span class="process-flow-status"><i aria-hidden="true"></i>${escape(p.label)}</span></div><b class="process-flow-name">${escape(p.name)}</b><span>${escape(p.resource)}</span><span class="process-flow-quantity">${p.done === null ? "已報無資料" : `已報 ${escape(p.done)}`} / ${qty === null ? "工單量無資料" : escape(qty)}${p.hasReports ? ' <small>已鎖定</small>' : ""}</span>${p.assignmentEvent?.kind==='legacy_reassigned'?'<small class="process-flow-reassigned">已依舊 MES 改派</small>':p.assignmentEvent?.kind==='preplan'?'<small>已預排，等待舊 MES 派工確認</small>':p.assignmentEvent?.kind==='legacy_confirmed'?'<small>舊 MES 已確認同台</small>':''}${controls(p)}</li>`).join("")}</ol></div>`;
  }
  return {steps, render,mergeRoute,department,operationDepartment,preplanTarget,candidateMachines,
    LEVELS,ROLES,visibilityLevel,normalizeVisibility,quantityLabel};
});
