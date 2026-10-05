import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const start=source.indexOf('function machtileAssignedCardProcess(');
const end=source.indexOf('async function machtileLoadCardLegacyProgress()',start);
const calls=[],warnings=[];
let response=[],failure=null,timerMs=0;
const state={source:'supabase',workOrders:[]};
const context=vm.createContext({state,Map,AbortController,
  console:{warn:(...x)=>warnings.push(x)},
  setTimeout:(f,ms)=>{timerMs=ms;return 1},clearTimeout:()=>{},
  normalizeOrder:r=>({id:r.work_order_no,processId:r.current_process_id,machine:r.machine_name,workStatus:r.work_order_status,processStatus:r.current_process_status,done:r.qty_completed}),
  machtileScheduleState:{queueOrderByProcess:new Map()},
  supabaseFetch:async(path,options)=>{calls.push({path,options});if(failure)throw failure;const offset=Number(new URL('http://fixture/'+path).searchParams.get('offset'));return response.slice(offset,offset+200);},
});
vm.runInContext(source.slice(start,end),context);
const call=()=>vm.runInContext('machtileLoadAssignedCardProcesses()',context);
let checks=0;const check=(ok,msg)=>{assert(ok,msg);checks++;console.log('PASS '+msg)};
const row=(id,status='pending',parent='in_progress')=>({id,tenant_id:'TEST',process_order:4,process_name:'車削二',status,qty_completed:12,off_station_at:null,machines:{id:'M3',machine_code:'A03'},work_orders:{id:'WO',work_order_no:'TEST-MULTI',status:parent}});
await call();check(state.assignedCardOrders.length===0&&!state.cardProcessError,'valid empty response is not an error');
check(timerMs===20000&&calls[0].options.signal instanceof AbortSignal,'entire bounded read has an abort signal and 20-second deadline');
check(calls[0].path.includes('machines!work_order_processes_machine_id_fkey!inner'),'assigned-machine FK disambiguated from actual_machine_id');
check(calls[0].path.includes('off_station_at=is.null')&&calls[0].path.includes('work_orders.status=not.in.(completed,shipped,cancelled)'),'server query filters off-station and closed parents');
response=Array.from({length:201},(_,n)=>row('PID-'+n));calls.length=0;
await call();check(state.assignedCardOrders.length===201&&calls.length===2,'paginated 201 processes, no truncation at first 200');
check(calls[1].path.endsWith('offset=200'),'stable ID order / correct second page offset');
response=[row('P1','pending'),row('P2','running'),row('P3','abnormal'),row('P4','waiting_inspection'),row('P5','completed'),row('P6','pending','completed'),row('P7','pending','shipped'),row('P8','pending','cancelled'),{...row('P9'),off_station_at:'2026-10-01'}];
await call();check(state.assignedCardOrders.length===4,'only four allowed statuses and unclosed/unoffstation rows');
check(state.assignedCardOrders[0].stationStep===4&&state.assignedCardOrders[0].done===12,'actual process order and quantities preserved');
state.workOrders=[{id:'CURRENT-VIEW',processId:'CURRENT-PROCESS',machine:'A01'}];
const fallsBack=()=>state.assignedCardOrders===null&&state.cardProcessError==='工序清單讀取失敗，暫以工單目前道顯示'
  &&vm.runInContext('machtileMachineCardOrders()',context)===state.workOrders;
failure=Error('403 forbidden');await call();check(fallsBack(),'authorization failure falls back to original view, not silently empty');
failure=Error('network unavailable');await call();check(fallsBack(),'network failure clears stale pool and falls back');
failure=Error('AbortError');await call();check(fallsBack(),'timeout clears stale pool and falls back');
failure=null;response=[{...row('BAD'),machines:null}];await call();check(fallsBack(),'missing embedded machine falls back without publishing invalid rows');
response=Array.from({length:10000},(_,n)=>row('LIMIT-'+n));calls.length=0;
await call();check(fallsBack()&&calls.length===50,'10,000-row cap discards partial pages and falls back');
response=[];await call();check(!state.cardProcessError,'successful reload clears old read error');
check(!source.slice(start,end).includes('method: "POST"'),'new REST read adds no mutation');
console.log(`${checks} passed`);
