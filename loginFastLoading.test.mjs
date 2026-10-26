import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const currentSource = await readFile(new URL("./app.js", import.meta.url), "utf8");
const baselineSource = execFileSync("git", ["show", "2ef94919fc0346ccf5c482f3bedbc34add7a4b83:app.js"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
const sliceBetween = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const baselineLoader = sliceBetween(baselineSource, "async function loadFromSupabase", "// Full routing is independent");
const currentLoader = sliceBetween(currentSource, "async function machtileLoadMachineMasters", "// Full routing is independent");

const DELAY_MS = 400;
const orderRows = Array.from({ length: 200 }, (_, index) => ({ work_order_no: `WO-${String(index + 1).padStart(3, "0")}` }));
const machineRows = [{ machine_code: "A01" }];
const delay = (effect) => new Promise((resolve) => setTimeout(() => { effect?.(); resolve(); }, DELAY_MS));

function makeContext({ baseline = false, failJob = "" } = {}) {
  const calls = [];
  const renderTimes = [];
  const state = { workOrders: [], machineMasters: [], source: "" };
  const startedAt = performance.now();
  const loader = (name, effect) => async () => {
    calls.push(name);
    await delay(effect);
    if (name === failJob) throw new Error(`${name} fixture failure`);
  };
  const context = vm.createContext({
    console: { warn() {} }, Map, Promise, Array, Math, URL, performance,
    requestAnimationFrame: (callback) => callback(),
    document: { getElementById: () => null },
    state,
    escapeHtml: String,
    normalizeOrder: (row) => ({ id: row.work_order_no }),
    normalizeMachineMaster: (row) => ({ code: row.machine_code }),
    machtileStrictMode: () => false,
    machtileDepartmentAccess: null,
    machtileDepartmentAccessError: "",
    machtileDepartmentUnrestricted: () => true,
    machtileAvailableDepartments: () => [],
    normalizedMachineDepartment: () => "",
    supabaseFetch: async (path) => {
      calls.push(path.startsWith("v_work_order_cards") ? "work-orders" : path.startsWith("v_machine_management_cards") ? "machines" : path);
      await delay();
      if (path.startsWith("v_work_order_cards")) return orderRows;
      if (path.startsWith("v_machine_management_cards")) return machineRows;
      return [];
    },
    machtileResolveAppUserId: loader("app-user"),
    machtileLoadDepartmentAccess: loader("department"),
    machtileLoadCncProgramsForCards: loader("cnc"),
    machtileLoadScheduleQueue: loader("schedule-queue"),
    machtileLoadAssignedCardProcesses: loader("assigned", () => { state.assignedCardOrders = orderRows; }),
    machtileLoadAssignedDispatchPoolStatuses: loader("assigned-pool"),
    machtileLoadInspectionStatuses: loader("inspection"),
    machtileLoadCardLegacyProgress: loader("legacy-progress"),
    machtileLoadCardMachineTimes: loader("machine-times"),
    machtileLoadScheduleContracts: loader("schedule-contracts"),
    machtileLoadCapacityCalendar: loader("capacity"),
    machtileLoadAttentionCenter: loader("attention"),
    machtileLoadHmcRuntime: loader("hmc"),
    machtileLoadCardActivity: loader("card-activity"),
    machtileLoadFlowVisibility: loader("flow-visibility"),
    machtileLoadStationCommandAvailability: loader("station-command"),
    machtileLoadDispatchPool: loader("dispatch-pool"),
    machtileLoadProcessFlows: loader("process-flows"),
    deriveMachines() {}, renderStats() {}, renderFilters() {}, renderWorkOrders() {}, renderAlerts() {},
    renderInspectionQueue() {}, renderSchedule() {}, renderNotificationCenter() {}, renderHistory() {}, renderReports() {}, renderSettings() {}, ensureHmcDashboardEntry() {},
    renderAll: () => renderTimes.push(performance.now() - startedAt),
  });
  vm.runInContext(baseline ? baselineLoader : currentLoader, context);
  return { context, calls, renderTimes, state };
}

const before = makeContext({ baseline: true });
const beforeStart = performance.now();
await vm.runInContext("loadFromSupabase()", before.context);
vm.runInContext("renderAll()", before.context);
const beforeFirstCardMs = performance.now() - beforeStart;

const after = makeContext();
const afterStart = performance.now();
await vm.runInContext("loadFromSupabase({ deferSecondary: true })", after.context);
const afterFirstCardMs = performance.now() - afterStart;
await vm.runInContext("machtileBackgroundLoadPromise", after.context);

assert.equal(before.state.workOrders.length, 200, "baseline fixture has the real-scale 200 orders");
assert.equal(after.state.workOrders.length, 200, "optimized fixture has the real-scale 200 orders");
assert.ok(afterFirstCardMs <= beforeFirstCardMs * 0.4,
  `first card ${Math.round(afterFirstCardMs)}ms must be <= 40% of baseline ${Math.round(beforeFirstCardMs)}ms`);
for (const name of ["cnc", "schedule-queue", "assigned-pool", "inspection", "legacy-progress", "machine-times", "schedule-contracts", "capacity", "attention", "hmc", "card-activity", "flow-visibility", "station-command", "dispatch-pool", "process-flows"]) {
  assert.ok(after.calls.includes(name), `deferred loader still runs: ${name}`);
}

const failed = makeContext({ failJob: "attention" });
await vm.runInContext("loadFromSupabase({ deferSecondary: true })", failed.context);
await vm.runInContext("machtileBackgroundLoadPromise", failed.context);
assert.equal(failed.state.workOrders.length, 200, "a deferred loader failure does not remove machine-card data");
assert.equal(vm.runInContext("machtileDeferredLoadState.get('attention').status", failed.context), "error", "failed section exposes retry state");

// Exercise the production process-flow worker pool separately: 200 orders are
// four 50-order chunks, all may overlap, and the cap must never exceed four.
const processLoader = sliceBetween(currentSource, "async function machtileLoadProcessFlows", "// 製程路線顯示層級");
let active = 0, maxActive = 0, workOrderCalls = 0;
const flowContext = vm.createContext({
  console: { warn() {} }, Map, Promise, Array, Math, encodeURIComponent,
  state: { workOrders: orderRows.map((row) => ({ id: row.work_order_no })), machineMasters: [] },
  machtileProcessFlows: new Map(), machtileCardPickState: { progressByProcess: new Map() },
  machtileReadRouteSteps: async () => [], machtileWoFetchProgress: async () => new Map(),
  machtileBatchCore: () => ({ cardProgress: () => ({ done: 0 }) }),
  machtileRefreshOpenProcessFlow() {}, window: { MachTileProcessFlow: { mergeRoute: (_routes, processes) => processes } },
  supabaseFetch: async (path) => {
    if (!path.startsWith("work_orders?")) return [];
    workOrderCalls++; active++; maxActive = Math.max(maxActive, active);
    await delay(); active--;
    return [];
  },
});
vm.runInContext(processLoader, flowContext);
await vm.runInContext("machtileLoadProcessFlows()", flowContext);
assert.equal(workOrderCalls, 4, "200 orders use four 50-order process-flow chunks");
assert.equal(maxActive, 4, "process-flow chunk concurrency reaches and stays capped at four");

console.log(JSON.stringify({ beforeFirstCardMs: Math.round(beforeFirstCardMs), afterFirstCardMs: Math.round(afterFirstCardMs), ratio: Number((afterFirstCardMs / beforeFirstCardMs).toFixed(3)), orders: 200, delayPerRequestMs: DELAY_MS, processFlowChunks: workOrderCalls, maxProcessFlowConcurrency: maxActive }));
console.log("PASS login-first-card A+B loading contract");
