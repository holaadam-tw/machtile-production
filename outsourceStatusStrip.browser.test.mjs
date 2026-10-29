import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root=path.dirname(fileURLToPath(import.meta.url));
const baseRef="55ed08ba945d6af2d48bf51e4266368b1c86a0ed"; // pinned pre-PR main so the flag-off comparison stays meaningful after merge
childProcess.execFileSync("git",["rev-parse","--verify",baseRef],{stdio:"pipe"});
const files=["index.html","app.js","config.js","i18n.js","processFlowCore.js","styles.css","mockData.js"];
const baseFiles=new Map(files.map(file=>[file,childProcess.execFileSync("git",["show",`${baseRef}:${file}`],{maxBuffer:16*1024*1024})]));
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
const server=createServer(async(req,res)=>{const url=new URL(req.url,"http://localhost"),base=url.pathname.startsWith("/base/");
  const relative=decodeURIComponent(url.pathname.replace(/^\/(?:base\/)?/,"")||"index.html");
  try{const body=base&&baseFiles.has(relative)?baseFiles.get(relative):await readFile(path.join(root,relative));res.writeHead(200,{"Content-Type":mime[path.extname(relative)]||"application/octet-stream"});res.end(body)}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const imported=await import(process.env.MACHTILE_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href:"playwright");
const {chromium}=imported.default||imported,browser=await chromium.launch();let checks=0;
const ok=(value,label)=>{assert.ok(value,label);checks++;console.log(`PASS ${label}`)};
const config=`window.MACHTILE_CONFIG={useSupabase:false,disableServiceWorker:true,orderDetailSimplifyEnabled:true,enableOutsourceStatusStrip:false};`;
async function open(base=false){const context=await browser.newContext({serviceWorkers:"block",viewport:{width:1280,height:900}});
  if(base)await context.route("**/*",async route=>{const relative=new URL(route.request().url()).pathname.replace(/^\//,"")||"index.html";
    if(relative!=="config.js"&&baseFiles.has(relative))await route.fulfill({contentType:mime[path.extname(relative)]||"application/octet-stream",body:baseFiles.get(relative)});else await route.fallback()});
  await context.route("**/config.js*",route=>route.fulfill({contentType:"text/javascript",body:config}));
  const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>document.querySelectorAll("#workOrderGrid article").length>0);return{context,page}}
try{
  const current=await open(false),base=await open(true);
  const visibleDom=page=>page.evaluate(()=>{const body=document.body.cloneNode(true);body.querySelectorAll("script").forEach(node=>node.remove());return body.innerHTML});
  const currentDom=await visibleDom(current.page),baseDom=await visibleDom(base.page);
  const compared=process.env.MACHTILE_OUTSOURCE_DOM_NEGATIVE_SELFTEST==="1"?currentDom+"<!-- deliberate difference -->":currentDom;
  if(compared!==baseDom){const at=[...compared].findIndex((char,index)=>char!==baseDom[index]);console.log("DOM_DIFF",at,JSON.stringify(compared.slice(Math.max(0,at-80),at+160)),JSON.stringify(baseDom.slice(Math.max(0,at-80),at+160)))}
  ok(compared===baseDom,"flag off body DOM is byte-for-byte origin/main");
  await current.context.close();await base.context.close();

  const source=await readFile(path.join(root,"app.js"),"utf8"),baseSource=baseFiles.get("app.js").toString("utf8");
  const oldQuery=baseSource.match(/work_order_route_steps\?select=[^`]+/)[0];
  ok(source.includes(`: \`${oldQuery}\``),"flag-off route select literal is byte-for-byte origin/main");
  ok(source.includes("outsource_vendor_name,outsource_sent_qty,outsource_returned_qty,outsource_unconfirmed_qty,outsource_closed_without_receipt_qty,outsource_oldest_open_sent_at,outsource_synced_at"),"flag-on route select contains all seven contract columns");

  const enabled=await open(false);await enabled.page.addStyleTag({content:"body{padding:20px;background:#eef2f5}#fixture{background:white;padding:16px}.fixture-title{font:700 18px sans-serif}"});
  const result=await enabled.page.evaluate(()=>{const base={step_no:1,operation_name:"表面處理",station_no:"OUT",station_codes:"OUT",is_outsourced:true,is_confirmed:true,supplier_no:"V",supplier_name:"舊廠商",outsource_vendor_name:"廠商甲／廠商乙",outsource_sent_qty:12,outsource_returned_qty:4,outsource_unconfirmed_qty:8,outsource_closed_without_receipt_qty:2,outsource_oldest_open_sent_at:"2026-10-20T08:00:00+08:00",outsource_synced_at:"2026-10-29T15:00:00+08:00"};
    const next={step_no:2,operation_name:"精加工",station_no:"A01",station_codes:"A01",is_outsourced:false,is_confirmed:true,supplier_no:"",supplier_name:""};
    const complete=MachTileProcessFlow.mergeRoute([base,next],[{id:"next",process_order:2,status:"running",reported:1,hasReports:true}],"TEST");
    const unknown=MachTileProcessFlow.mergeRoute([{...base,outsource_sent_qty:null}],[],"UNKNOWN");
    const yellow=MachTileProcessFlow.mergeRoute([base],[],"YELLOW");
    const labels={summary:"委外：{{vendor}} 送 {{sent}}／回 {{returned}}（未回 {{unconfirmed}}）",vendorMissing:"廠商無資料",closedWithoutReceipt:"已關閉未收貨 {{quantity}}",sentDate:"送出日 {{date}}",stockDeduction:"會自動扣倉庫料"};
    const options={outsourceStatusEnabled:true,outsourceLabels:labels,now:new Date("2026-10-30T09:00:00+08:00").getTime(),quantity:20};
    document.body.innerHTML=`<main id="fixture"><div class="fixture-title">機台卡片路線條</div>${MachTileProcessFlow.render(complete,{...options,currentId:"next",compact:true,orderNo:"TEST"})}<div class="fixture-title">這張單的流程</div>${MachTileProcessFlow.render(complete,options)}<div class="fixture-title">舊橋 null</div>${MachTileProcessFlow.render(unknown,options)}<div class="fixture-title">逾期未回</div>${MachTileProcessFlow.render(yellow,options)}</main>`;
    const text=document.body.innerText,red=document.querySelectorAll(".is-danger").length,yellowCount=document.querySelectorAll(".is-warning").length;
    const vi=MachTileProcessFlow.render(yellow,{...options,outsourceLabels:{summary:"Gia công ngoài: {{vendor}} gửi {{sent}} / nhận {{returned}} (chưa nhận {{unconfirmed}})",closedWithoutReceipt:"Đã đóng, chưa nhận {{quantity}}",sentDate:"Ngày gửi {{date}}",stockDeduction:"Sẽ tự động trừ vật liệu trong kho"}});
    return{text,red,yellowCount,vi,unknownText:[...document.querySelectorAll(".fixture-title")].find(x=>x.textContent==="舊橋 null").nextElementSibling.innerText}});
  ok(result.text.includes("委外：廠商甲／廠商乙 送 12／回 4（未回 8）"),"complete and multi-vendor status appears in card strip and detail flow");
  ok(result.text.includes("已關閉未收貨 2")&&result.text.includes("送出日 2026-10-20"),"closed-without-receipt and sent date appear");
  ok(result.red>=2&&result.text.includes("會自動扣倉庫料"),"prior open outsource with next-step report is red");
  ok(result.yellowCount===1,"older-than-seven-days open outsource is yellow");
  ok(result.unknownText.includes("委外狀態無資料")&&!result.unknownText.includes("送 0"),"null legacy snapshot stays unknown and never becomes zero");
  ok(result.vi.includes("Gia công ngoài:")&&result.vi.includes("Ngày gửi 2026-10-20"),"Vietnamese outsource copy renders from i18n labels");
  if(process.env.MACHTILE_OUTSOURCE_SCREENSHOT)await enabled.page.locator("#fixture").screenshot({path:process.env.MACHTILE_OUTSOURCE_SCREENSHOT});
  await enabled.context.close();console.log(`${checks}/${checks} PASS; fixed base=${baseRef}`);
}finally{await browser.close();server.close()}
