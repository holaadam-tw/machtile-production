const config = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  // "dev-nologin" (default) = Dev/Pages public demo, fully anonymous.
  // "strict" = production UI track (Gate P / P2): app-level login gate +
  // session Bearer on every read/write (production DB has zero anon access).
  authMode: "dev-nologin",
  tenantId: "00000000-0000-0000-0000-000000000001",
  reportAttachmentBucket: "machtile-report-files",
  enableFileUpload: true,
  fieldReportBaseUrl: "",
  useQueryRoutesForFieldReports: true,
  useSupabase: false,
  // CNC field-report offline outbox (2026-07-11 wiring plan). false = the
  // direct production_reports POST stays byte-identical; true routes
  // submitReport through the offline-first idempotent outbox seam.
  enableOutboxSubmit: false,
  ...window.MACHTILE_CONFIG,
};

const statusMeta = {
  aiRisk: { label: "可能延誤", className: "risk-purple", group: "可能延誤" },
  overdue: { label: "已延誤", className: "risk-red", group: "已延誤" },
  abnormal: { label: "異常", className: "risk-red", group: "異常" },
  inspection: { label: "待品檢", className: "risk-amber", group: "待品檢" },
  running: { label: "加工中", className: "risk-blue", group: "加工中" },
  normal: { label: "正常", className: "risk-green", group: "正常" },
  idle: { label: "空閒", className: "risk-gray", group: "未回報" },
  stale: { label: "未回報", className: "risk-gray", group: "未回報" },
  unassigned: { label: "未排機", className: "risk-gray", group: "未排機" },
  maintenance: { label: "維修", className: "risk-red", group: "異常" },
  paused: { label: "暫停", className: "risk-amber", group: "異常" },
};

const departmentFilters = ["全部", "車床課", "銑床課"];
const millingModeFilters = ["全部銑床", "單盤單工件", "多盤多工件"];
const statusFilters = ["全部狀態", "可能延誤", "已延誤", "異常", "待品檢", "今日到期", "未排機", "未回報"];
const alertFilters = ["全部", "已延誤", "可能延誤", "異常", "待品檢", "今日到期", "未回報"];

const reportTypeMeta = {
  workStart: {
    label: "首次開工",
    needsQty: false,
    submitLabel: "建立首次開工基準",
    quantityMode: "none",
  },
  dailyStart: {
    label: "今日開工",
    needsQty: true,
    submitLabel: "送出今日開工",
    quantityMode: "cumulative",
  },
  noon: {
    label: "中午報工",
    needsQty: true,
    submitLabel: "送出中午報工",
    quantityMode: "cumulative",
  },
  afternoonCheck: {
    label: "下午 4:30 檢查",
    needsQty: false,
    submitLabel: "送出下午檢查",
    quantityMode: "none",
  },
  finish: {
    label: "收工 / 完工",
    needsQty: true,
    submitLabel: "送出收工回報",
    quantityMode: "cumulative",
  },
  abnormal: {
    label: "異常回報",
    needsQty: false,
    submitLabel: "送出異常通報",
    quantityMode: "none",
  },
};

let activeDepartmentFilter = "全部";
let activeMillingModeFilter = "全部銑床";
let activeStatusFilter = "全部狀態";
let activeAlertFilter = "全部";
let activeReportType = "workStart";
let selectedOrder = null;
let demoState = null;
let useStructuredReportColumns = true;
let useExtendedAttachmentMetadata = true;
let activeCameraInputId = "";
let activeCameraLabel = "";
let activeCameraStream = null;
let activeCameraReady = false;
const capturedCameraFiles = new Map();
let activeReportReturnDetailOrderId = "";
let selectedStationId = "";

const UNASSIGNED_MACHINE = "未排機";

const state = {
  workOrders: [],
  machines: [],
  machineMasters: [],
  source: "mock",
};

const mockOrders = [
  {
    id: "WO-20260428-011",
    workOrderId: "mock-011",
    processId: "mock-011-p1",
    tenantId: config.tenantId,
    customer: "佳明科技",
    part: "治具底板",
    drawing: "JIG-PLT-332",
    dueDate: "2026-04-30",
    process: "CNC 銑削",
    machine: "CNC-05",
    done: 8,
    total: 20,
    lastReport: "2 小時前",
    priority: "urgent",
    workStatus: "abnormal",
    processStatus: "abnormal",
    risk: "critical",
  },
  {
    id: "WO-20260429-006",
    workOrderId: "mock-006",
    processId: "mock-006-p1",
    tenantId: config.tenantId,
    customer: "宏泰機械",
    part: "不鏽鋼軸套",
    drawing: "SS-BUSH-118",
    dueDate: "2026-05-01",
    process: "CNC 車削",
    machine: "CNC-01",
    done: 60,
    total: 60,
    lastReport: "昨日 17:40",
    priority: "high",
    workStatus: "waiting_inspection",
    processStatus: "waiting_inspection",
    risk: "medium",
  },
  {
    id: "WO-20260429-003",
    workOrderId: "mock-003",
    processId: "mock-003-p3",
    tenantId: config.tenantId,
    customer: "永承精密",
    part: "鋁合金支架",
    drawing: "AL-BKT-204",
    dueDate: "2026-05-02",
    process: "CNC 銑削",
    machine: "CNC-03",
    done: 40,
    total: 100,
    lastReport: "5 小時前",
    priority: "urgent",
    workStatus: "in_progress",
    processStatus: "running",
    risk: "high",
  },
  {
    id: "WO-20260429-014",
    workOrderId: "mock-014",
    processId: "mock-014-p1",
    tenantId: config.tenantId,
    customer: "聯亞工業",
    part: "銅套",
    drawing: "CU-RING-090",
    dueDate: "2026-05-06",
    process: "CNC 車削",
    machine: "CNC-02",
    done: 120,
    total: 200,
    lastReport: "30 分鐘前",
    priority: "normal",
    workStatus: "in_progress",
    processStatus: "running",
    risk: null,
  },
  {
    id: "WO-20260429-018",
    workOrderId: "mock-018",
    processId: "mock-018-p1",
    tenantId: config.tenantId,
    customer: "禾鋐工業",
    part: "齒輪坯件",
    drawing: "GEAR-BLK-077",
    dueDate: "2026-05-08",
    process: "鋸料",
    machine: "",
    done: 0,
    total: 80,
    lastReport: "尚未回報",
    priority: "normal",
    workStatus: "not_started",
    processStatus: "pending",
    risk: null,
  },
];

const baseMachines = [
  { name: "CNC-01", type: "車床", rawStatus: "running" },
  { name: "CNC-02", type: "車床", rawStatus: "running" },
  { name: "CNC-03", type: "銑床", rawStatus: "running" },
  { name: "CNC-04", type: "銑床", rawStatus: "idle" },
  { name: "CNC-05", type: "銑床", rawStatus: "running" },
  { name: "CNC-06", type: "五軸", rawStatus: "idle" },
  { name: "CNC-07", type: "車床", rawStatus: "paused", note: "換刀中，預計 11:00 恢復" },
  { name: "CNC-08", type: "銑床", rawStatus: "maintenance", note: "主軸異音，預計 04/30 恢復" },
  { name: "HMC-01", type: "臥式加工中心", rawStatus: "running", department: "銑床課", note: "多盤多工件報工" },
  { name: "HMC-02", type: "臥式加工中心", rawStatus: "idle", department: "銑床課", note: "多盤多工件報工" },
];

const programProfiles = {
  "AL-BKT-204": {
    programName: "O1234_AL-BKT-204.NC",
    programVersion: "V4",
    previousVersion: "V3",
    programHash: "9f4a21c8",
    previousHash: "71b83ad2",
    changedLines: 18,
    toolChanges: "T03 進給調整，T06 刀補更新",
    pureCycleSec: 550,
    baselineCycleSec: 500,
    loadUnloadSec: 95,
    historyRuns: 12,
    historyYears: 3,
    lastRunDate: "2026-02-18",
  },
  "JIG-PLT-332": {
    programName: "O332_JIG-PLT-FIXTURE.NC",
    programVersion: "V2",
    previousVersion: "V2",
    programHash: "20ad88f1",
    previousHash: "20ad88f1",
    changedLines: 0,
    toolChanges: "程式相同，疑似材料或刀具造成時間增加",
    pureCycleSec: 1250,
    baselineCycleSec: 1080,
    loadUnloadSec: 180,
    historyRuns: 7,
    historyYears: 2,
    lastRunDate: "2025-12-09",
  },
  "SS-BUSH-118": {
    programName: "O118_SS-BUSH_LATHE.NC",
    programVersion: "V6",
    previousVersion: "V5",
    programHash: "ab54d733",
    previousHash: "8421ef60",
    changedLines: 9,
    toolChanges: "倒角段落新增檢查停留",
    pureCycleSec: 210,
    baselineCycleSec: 205,
    loadUnloadSec: 45,
    historyRuns: 18,
    historyYears: 4,
    lastRunDate: "2026-03-22",
  },
  "CU-RING-090": {
    programName: "O090_CU-RING_LATHE.NC",
    programVersion: "V3",
    previousVersion: "V3",
    programHash: "a811c902",
    previousHash: "a811c902",
    changedLines: 0,
    toolChanges: "程式未變更",
    pureCycleSec: 155,
    baselineCycleSec: 160,
    loadUnloadSec: 35,
    historyRuns: 26,
    historyYears: 5,
    lastRunDate: "2026-04-02",
  },
  "GEAR-BLK-077": {
    programName: "待上傳",
    programVersion: "-",
    previousVersion: "-",
    programHash: "",
    previousHash: "",
    changedLines: null,
    toolChanges: "尚未建立程式基準",
    pureCycleSec: null,
    baselineCycleSec: null,
    loadUnloadSec: 60,
    historyRuns: 0,
    historyYears: 0,
    lastRunDate: "",
  },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function appBasePath() {
  const path = window.location.pathname;
  const repoBase = "/machtile-mini-mes/";
  if (path.startsWith(repoBase)) return repoBase;
  if (path.includes("/prototype/machtile-v0/")) {
    return path.slice(0, path.indexOf("/prototype/machtile-v0/")) + "/prototype/machtile-v0/";
  }
  if (path.includes("/work-orders/")) return path.slice(0, path.indexOf("/work-orders/") + 1);
  if (path.includes("/m/")) return path.slice(0, path.indexOf("/m/") + 1);
  return path.endsWith("/") ? path : path.replace(/[^/]*$/, "");
}

function appRouteUrl(path, params = {}) {
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const url = new URL(`${appBasePath()}${normalizedPath}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  return url.toString();
}
function publicReportUrlOnLocalhost(value) {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(window.location.hostname)) return value;
  let url;
  try {
    url = new URL(value, window.location.href);
  } catch {
    return value;
  }
  if (url.origin !== window.location.origin) return value;
  return `https://holaadam-tw.github.io/machtile-mini-mes/${url.search}${url.hash}`;
}

function configuredRouteUrl(baseUrl, path, params = {}) {
  const base = String(baseUrl || "").trim();
  if (!base) return appRouteUrl(path, params);
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const url = new URL(normalizedPath, normalizedBase);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  return url.toString();
}

function fieldReportRouteUrl(path, params = {}) {
  if (config.useQueryRoutesForFieldReports !== false) {
    const route = `/${String(path || "").replace(/^\/+/, "")}`;
    return configuredRouteUrl(config.fieldReportBaseUrl, "", { route, ...params });
  }
  return configuredRouteUrl(config.fieldReportBaseUrl, path, params);
}

function workOrderDetailUrl(orderId) {
  return appRouteUrl("", { route: `/work-orders/${encodeURIComponent(orderId)}` });
}

function isReportableMachineName(machineName) {
  const normalized = String(machineName || "").trim();
  return Boolean(normalized) && normalized !== UNASSIGNED_MACHINE;
}

function isOrderReportable(order) {
  return isReportableMachineName(order?.machine);
}

function isHmcMachine(machine) {
  const text = [
    machine?.name,
    machine?.code,
    machine?.type,
    machine?.department,
    machine?.processName,
    machine?.order?.process,
    machine?.note,
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes("hmc") || text.includes("horizontal") || text.includes("臥式") || text.includes("卧式") || text.includes("臥加");
}

function hmcReportRouteUrl(machineOrName) {
  const machineName = typeof machineOrName === "object" ? machineOrName?.name : machineOrName;
  const devReadParams = config.useHmcWorklistSupabase
    ? { worklistSource: "db", quantitySource: "db" }
    : {};
  return appRouteUrl("", { route: hmcReportRoutePath(), machine: machineName || "HMC-01", ...devReadParams });
}

function sameTabReportUrlFromLink(value) {
  try {
    const url = new URL(value, window.location.href);
    const route = url.searchParams.get("route") || "";
    if (route !== hmcReportRoutePath() && route !== reportWorkRoutePath()) return "";
    const params = { route };
    url.searchParams.forEach((paramValue, key) => {
      if (key !== "route") params[key] = paramValue;
    });
    if (route === hmcReportRoutePath() && !params.machine) params.machine = "HMC-01";
    return appRouteUrl("", {
      ...params,
    });
  } catch {
    return "";
  }
}

function hmcWorklistSetupRouteUrl(machineOrName, shift = "day") {
  const machineName = typeof machineOrName === "object" ? machineOrName?.name : machineOrName;
  return appRouteUrl("", { route: hmcWorklistSetupRoutePath(), machine: machineName || "HMC-01", shift: shift || "day" });
}

function hmcDashboardCardsUrl() {
  return appRouteUrl("", { view: "dashboard", department: "銑床課", millingMode: "多盤多工件" });
}

function hmcReportDashboardBackUrl() {
  return hmcDashboardCardsUrl();
}

function hmcSetupBackToReportUrl(machineOrName = hmcRouteMachineLabel(), shift = hmcReportState.shift) {
  const machineName = typeof machineOrName === "object" ? machineOrName?.name : machineOrName;
  return appRouteUrl("", { route: hmcReportRoutePath(), machine: machineName || "HMC-01", shift: shift || "day" });
}

function machineReportUrl(machineOrName) {
  if (typeof machineOrName === "object" && isHmcMachine(machineOrName)) {
    return hmcReportRouteUrl(machineOrName);
  }
  if (typeof machineOrName === "object" && machineOrName?.order && isOrderReportable(machineOrName.order)) {
    return detailReportRouteUrl(machineOrName.order, "dailyStart");
  }
  if (typeof machineOrName === "object" && machineOrName?.qrPath) {
    const [path, query = ""] = String(machineOrName.qrPath).split("?");
    const params = Object.fromEntries(new URLSearchParams(query));
    if (!isReportableMachineName(params.machine || machineOrName.name)) return "";
    return fieldReportRouteUrl(path || "m/report", params);
  }
  const machineName = typeof machineOrName === "object" ? machineOrName?.name : machineOrName;
  if (!isReportableMachineName(machineName)) return "";
  return fieldReportRouteUrl("m/report", { machine: machineName, type: "dailyStart" });
}

function detailReportRouteUrl(order, reportType = "dailyStart") {
  const params = new URLSearchParams();
  params.set("route", "/m/report");
  const station = mockStations().find((item) => (
    item.stationId === order?.stationId ||
    item.stationCode === order?.machine ||
    item.stationName === order?.machine
  ));
  const stationItems = station ? workListItemsForStation(station) : [];
  const workItem = stationItems.find((item) => (
    item.workOrder?.workOrderNo === order?.id ||
    item.workOrder?.workOrderId === order?.workOrderId
  )) || stationItems[0] || null;

  if (workItem) {
    if (workItem.station?.stationId) params.set("station", workItem.station.stationId);
    if (workItem.workOrder?.workOrderId) params.set("workOrderId", workItem.workOrder.workOrderId);
    if (workItem.workOrder?.workOrderNo) params.set("wo", workItem.workOrder.workOrderNo);
    if (workItem.operation?.operationId) params.set("operationId", workItem.operation.operationId);
  } else if (order?.machine) {
    params.set("machine", order.machine);
  }
  if (reportType) params.set("type", reportType);
  if (order?.id) params.set("returnRoute", `/work-orders/${encodeURIComponent(order.id)}`);
  if (new URLSearchParams(window.location.search).get("safeMode") === "1") params.set("safeMode", "1");
  return appRouteUrl("", Object.fromEntries(params));
}

function qrCodeUrl(value, size = 112) {
  const data = encodeURIComponent(value);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${data}`;
}

function currentRoutePath() {
  const params = new URLSearchParams(window.location.search);
  const routedPath = params.get("route");
  if (routedPath) return routedPath.startsWith("/") ? routedPath : `/${routedPath}`;
  const base = appBasePath();
  let path = decodeURIComponent(window.location.pathname);
  if (path.startsWith(base)) path = path.slice(base.length);
  path = path.replace(/^\/+/, "");
  return `/${path}`;
}

function isP0RoutePath(routePath = currentRoutePath()) {
  return String(routePath || "").startsWith("/m/");
}

function isWorkOrderDetailRoutePath(routePath = currentRoutePath()) {
  return String(routePath || "").startsWith("/work-orders/");
}

function isP0SafeMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("safeMode") === "1" && isP0RoutePath();
}

function ensureP0SafeModeBanner() {
  const bannerId = "p0SafeModeBanner";
  let banner = document.getElementById(bannerId);

  if (!isP0SafeMode()) {
    document.body.classList.remove("p0-safe-mode");
    if (banner) banner.remove();
    return;
  }

  document.body.classList.add("p0-safe-mode");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = bannerId;
    banner.className = "p0-safe-mode-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    document.body.prepend(banner);
  }

  banner.innerHTML = `
    <strong>安全測試模式</strong>
    <span>不呼叫端點</span>
    <span>不讀寫資料庫</span>
    <span>不連雲端資料庫</span>
    <span>不啟用外部入口</span>
    <span>不呼叫外部 QR</span>
    <span>送出停用</span>
    <span class="report-work-hidden-marker">P0 SAFE MOCK MODE No endpoint No DB No Supabase No LIFF No external QR Submit disabled</span>
  `;
}
function stationSelectRoutePath() {
  return window.MachTileRoutes?.STATION_SELECT || "/m/station-select";
}

function mockStations() {
  const stations = window.MachTileMockData?.stations;
  if (!Array.isArray(stations)) return [];
  return stations
    .map((station) => ({ ...station }))
    .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
}

function stationMetrics(stationId) {
  const sessions = Array.isArray(window.MachTileMockData?.workSessions) ? window.MachTileMockData.workSessions : [];
  const operations = Array.isArray(window.MachTileMockData?.operations) ? window.MachTileMockData.operations : [];
  return {
    active: sessions.filter((session) => session.stationId === stationId && session.status === "IN_PROGRESS").length,
    waiting: operations.filter((operation) => operation.stationId === stationId && ["pending", "waiting_inspection"].includes(operation.status)).length,
  };
}

function stationTypeText(value) {
  const text = String(value || "工站").trim();
  const labels = {
    CNC: "CNC 加工站",
    INSPECTION: "檢驗站",
    Station: "工站",
  };
  return labels[text] || text;
}

function stationSelectCard(station) {
  const metrics = stationMetrics(station.stationId);
  const isSelected = selectedStationId === station.stationId;
  const isDemo = station.stationCode === "CNC-03";
  const isActive = station.isActive !== false;
  return `
    <article class="station-select-card ${isSelected ? "is-selected" : ""} ${isDemo ? "is-demo" : ""} ${isActive ? "" : "is-disabled"}">
      <div class="station-select-card-head">
        <span class="station-select-code">${escapeHtml(station.stationCode)}</span>
        <span class="station-select-status">${isActive ? "可使用" : "未啟用"}</span>
      </div>
      <h2>${escapeHtml(reportWorkDisplayText(station.stationName || station.stationCode))}</h2>
      <p>${escapeHtml(stationTypeText(station.stationType))}</p>
      <div class="station-select-metrics" aria-label="Station mock counts">
        <span><strong>${metrics.active}</strong><small>加工中</small></span>
        <span><strong>${metrics.waiting}</strong><small>待處理</small></span>
      </div>
      <button type="button" data-select-station="${escapeHtml(station.stationId)}" ${isActive ? "" : "disabled"}>
        ${isSelected ? "已選擇" : "選擇工站"}
      </button>
      ${isDemo ? `<em>目前測試用 CNC 工站</em>` : ""}
    </article>
  `;
}
function renderStationSelectRoute() {
  document.body.classList.remove("work-list-route-mode");
  document.body.classList.remove("work-detail-route-mode");
  document.body.classList.remove("report-work-route-mode");
  document.body.classList.remove("hmc-report-route-mode");
  document.body.classList.add("station-select-route-mode");
  const params = new URLSearchParams(window.location.search);
  selectedStationId = selectedStationId || params.get("station") || params.get("stationId") || "";

  const workListRoot = $("#workListRoute");
  if (workListRoot) workListRoot.hidden = true;
  const workDetailRoot = $("#workDetailRoute");
  if (workDetailRoot) workDetailRoot.hidden = true;
  const reportWorkRoot = $("#reportWorkRoute");
  if (reportWorkRoot) reportWorkRoot.hidden = true;
  const hmcReportRoot = $("#hmcReportRoute");
  if (hmcReportRoot) hmcReportRoot.hidden = true;

  let routeRoot = $("#stationSelectRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "stationSelectRoute";
    routeRoot.className = "station-select-route";
    routeRoot.setAttribute("role", "main");
    routeRoot.setAttribute("aria-labelledby", "stationSelectTitle");
    document.body.appendChild(routeRoot);
  }
  routeRoot.hidden = false;

  const stations = mockStations();
  routeRoot.innerHTML = `
    <section class="station-select-shell">
      <header class="station-select-hero">
        <div>
          <p class="eyebrow">現場工站</p>
          <h1 id="stationSelectTitle">工站選擇</h1>
          <p>請先選擇要操作的工站，再進入工單清單。</p>
        </div>
        <span>${stations.length} 個工站</span>
      </header>
      <div class="station-select-grid">
        ${stations.length ? stations.map(stationSelectCard).join("") : `<p class="station-select-empty">目前沒有可用的示範工站。</p>`}
      </div>
    </section>
  `;
}
function selectStation(stationId) {
  const station = mockStations().find((item) => item.stationId === stationId);
  if (!station || station.isActive === false) return;
  selectedStationId = station.stationId;
  const params = new URLSearchParams(window.location.search);
  params.set("route", workListRoutePath());
  params.set("station", station.stationId);
  if (window.history?.pushState) {
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }
  renderWorkListRoute();
  showToast(`已選擇工站：${station.stationCode}`);
}
function workListRoutePath() {
  return window.MachTileRoutes?.WORK_LIST || "/m/work-list";
}

function workDetailRoutePath() {
  return window.MachTileRoutes?.SESSION || "/m/session";
}

function reportWorkRoutePath() {
  return window.MachTileRoutes?.REPORT || "/m/report";
}

const reportWorkDefectReasons = ["尺寸異常", "表面刮傷", "刀痕", "材料問題", "其他"];

function hmcReportRoutePath() {
  return "/m/hmc-report";
}

function hmcWorklistSetupRoutePath() {
  return "/m/hmc-worklist-setup";
}

function hmcDailyCheckReviewRoutePath() {
  return "/m/hmc-daily-check-review";
}

function hmcGuideRoutePath() {
  return "/m/hmc-guide";
}

function hmcGuideRouteUrl(machineOrName, shift = "day") {
  const machineName = typeof machineOrName === "object" ? machineOrName?.name : machineOrName;
  return appRouteUrl("", { route: hmcGuideRoutePath(), machine: machineName || "HMC-01", shift: shift || "day" });
}

function hmcFormalReportDraftsRoutePath() {
  return "/m/hmc-formal-report-drafts";
}

function hmcFormalReportsRoutePath() {
  return "/m/hmc-formal-reports";
}

function mockDataList(key) {
  const value = window.MachTileMockData?.[key];
  return Array.isArray(value) ? value : [];
}

function selectedRouteStationId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("station") || params.get("stationId") || selectedStationId || "";
}

function statusText(value) {
  const key = String(value || "unknown").trim().toLowerCase();
  const labels = {
    running: "加工中",
    in_progress: "加工中",
    "in progress": "加工中",
    pending: "待開工",
    queued: "待排程",
    paused: "暫停中",
    waiting_inspection: "待檢驗",
    "waiting inspection": "待檢驗",
    abnormal: "異常",
    completed: "已完成",
    done: "已完成",
    shipped: "已出貨",
    cancelled: "已取消",
    unknown: "未確認",
  };
  return labels[key] || String(value || "未確認").replace(/_/g, " ");
}
function safeReturnRoutePath(value) {
  const rawRoute = String(value || "").trim();
  if (!rawRoute) return "";
  const route = rawRoute.startsWith("/") ? rawRoute : `/${rawRoute}`;
  if (route.startsWith("/work-orders/")) return route;
  if ([workDetailRoutePath(), workListRoutePath(), stationSelectRoutePath()].includes(route)) return route;
  return "";
}

function currentReturnRoutePath() {
  const params = new URLSearchParams(window.location.search);
  return safeReturnRoutePath(params.get("returnRoute"));
}

function routeQuery(params) {
  const nextParams = new URLSearchParams(params);
  const currentParams = new URLSearchParams(window.location.search);
  const routePath = nextParams.get("route") || "";
  if (currentParams.get("safeMode") === "1" && !nextParams.has("safeMode") && isP0RoutePath(routePath)) {
    nextParams.set("safeMode", "1");
  }
  const returnRoute = currentReturnRoutePath();
  if (returnRoute && !nextParams.has("returnRoute") && isP0RoutePath(routePath)) {
    nextParams.set("returnRoute", returnRoute);
  }
  return `?${nextParams.toString()}`;
}

function workListRouteUrl(stationId = selectedRouteStationId()) {
  const params = new URLSearchParams();
  params.set("route", workListRoutePath());
  if (stationId) params.set("station", stationId);
  return routeQuery(params);
}

function workDetailRouteUrl(item) {
  const params = new URLSearchParams();
  params.set("route", workDetailRoutePath());
  if (item?.station?.stationId) params.set("station", item.station.stationId);
  if (item?.workOrder?.workOrderId) params.set("workOrderId", item.workOrder.workOrderId);
  if (item?.workOrder?.workOrderNo) params.set("wo", item.workOrder.workOrderNo);
  if (item?.operation?.operationId) params.set("operationId", item.operation.operationId);
  return routeQuery(params);
}

function reportWorkRouteUrlFromContext(context) {
  const params = new URLSearchParams();
  params.set("route", reportWorkRoutePath());
  const stationId = context?.stationId || context?.station?.stationId || "";
  if (stationId) params.set("station", stationId);
  if (context?.workOrder?.workOrderId) params.set("workOrderId", context.workOrder.workOrderId);
  if (context?.workOrder?.workOrderNo) params.set("wo", context.workOrder.workOrderNo);
  if (context?.operation?.operationId) params.set("operationId", context.operation.operationId);
  return routeQuery(params);
}

function workListItemsForStation(station) {
  if (!station) return [];
  const workOrders = mockDataList("workOrders");
  const operations = mockDataList("operations").filter((operation) => operation.stationId === station.stationId);
  const sessions = mockDataList("workSessions");
  const reports = mockDataList("reportRecords");

  return operations.map((operation) => {
    const workOrder = workOrders.find((order) => order.workOrderId === operation.workOrderId);
    const session = sessions.find((item) => item.operationId === operation.operationId && item.stationId === station.stationId);
    const reportRows = reports.filter((report) => report.operationId === operation.operationId && report.stationId === station.stationId);
    const completedQty = reportRows.reduce((sum, report) => sum + Number(report.goodQty || 0), 0);
    const defectQty = reportRows.reduce((sum, report) => sum + Number(report.defectQty || 0), 0);
    const plannedQty = Number(operation.plannedQty || workOrder?.plannedQty || 0);
    return {
      operation,
      workOrder,
      session,
      station,
      completedQty,
      defectQty,
      plannedQty,
      remainingQty: Math.max(0, plannedQty - completedQty),
      status: operation.status || workOrder?.status || "unknown",
    };
  }).filter((item) => item.workOrder);
}

function workListEmptyState(title, body) {
  return `
    <section class="work-list-empty">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
      <a href="?route=%2Fm%2Fstation-select">回到工站選擇</a>
    </section>
  `;
}

function renderWorkListCard(item) {
  const status = statusText(item.status);
  const rawStatus = String(item.status || "").toLowerCase();
  const active = item.session && ["IN_PROGRESS", "ABNORMAL", "PAUSED"].includes(item.session.status);
  const alertClass = /abnormal|delayed/.test(rawStatus) ? "is-alert" : rawStatus.includes("waiting") ? "is-waiting" : "";
  return `
    <article class="work-list-card ${alertClass}">
      <header>
        <div>
          <span>${escapeHtml(item.station.stationCode)} · ${escapeHtml(reportWorkDisplayText(item.station.stationName || item.station.stationCode))}</span>
          <h2>${escapeHtml(item.workOrder.workOrderNo || item.workOrder.workOrderId)}</h2>
        </div>
        <em>${escapeHtml(status)}</em>
      </header>
      <div class="work-list-part">
        <strong>${escapeHtml(reportWorkDisplayText(item.workOrder.partName || "-"))}</strong>
        <small>${escapeHtml(item.workOrder.partNo || "-")} · ${escapeHtml(reportWorkDisplayText(item.operation.operationName || "-"))}</small>
      </div>
      <div class="work-list-metrics">
        <span><strong>${item.plannedQty || "-"}</strong><small>計畫數</small></span>
        <span><strong>${item.completedQty}</strong><small>已完成</small></span>
        <span><strong>${item.remainingQty}</strong><small>剩餘</small></span>
        <span><strong>${item.defectQty}</strong><small>不良</small></span>
      </div>
      <footer>
        <span>交期 ${escapeHtml(item.workOrder.dueDate || "-")}</span>
        ${active ? `<b>加工中</b>` : `<b class="is-muted">未開工</b>`}
      </footer>
      <a class="work-list-card-link" href="${escapeHtml(workDetailRouteUrl(item))}">查看工單明細</a>
    </article>
  `;
}
function renderWorkListRoute() {
  document.body.classList.remove("station-select-route-mode");
  document.body.classList.remove("work-detail-route-mode");
  document.body.classList.remove("report-work-route-mode");
  document.body.classList.remove("hmc-report-route-mode");
  document.body.classList.add("work-list-route-mode");

  const stationSelectRoot = $("#stationSelectRoute");
  if (stationSelectRoot) stationSelectRoot.hidden = true;
  const workDetailRoot = $("#workDetailRoute");
  if (workDetailRoot) workDetailRoot.hidden = true;
  const reportWorkRoot = $("#reportWorkRoute");
  if (reportWorkRoot) reportWorkRoot.hidden = true;
  const hmcReportRoot = $("#hmcReportRoute");
  if (hmcReportRoot) hmcReportRoot.hidden = true;

  let routeRoot = $("#workListRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "workListRoute";
    routeRoot.className = "work-list-route";
    routeRoot.setAttribute("role", "main");
    routeRoot.setAttribute("aria-labelledby", "workListTitle");
    document.body.appendChild(routeRoot);
  }
  routeRoot.hidden = false;

  const stations = mockStations();
  const stationId = selectedRouteStationId();
  selectedStationId = stationId || selectedStationId;
  const station = stations.find((item) => item.stationId === stationId);
  const dataMissing = !Array.isArray(window.MachTileMockData?.stations);
  const items = station ? workListItemsForStation(station) : [];

  let content = "";
  if (dataMissing) {
    content = workListEmptyState("Mock data missing", "本機 mock data 尚未載入，請確認 mockData.js。");
  } else if (!stationId) {
    content = workListEmptyState("請先選擇工站", "請先從工站選擇畫面指定工站，再查看工單列表。");
  } else if (!station) {
    content = workListEmptyState("找不到工站", "目前 mock data 沒有這個工站，請回到工站選擇。");
  } else if (station.isActive === false) {
    content = workListEmptyState("工站未啟用", `${station.stationCode} 目前未啟用，不能查看作業清單。`);
  } else if (!items.length) {
    content = workListEmptyState("目前沒有指派工單", `${station.stationCode} 目前沒有對應的 mock 工單。`);
  } else {
    content = `<div class="work-list-grid">${items.map(renderWorkListCard).join("")}</div>`;
  }
  const stationSelectLink = (!stationId || !station)
    ? `<a href="?route=%2Fm%2Fstation-select${stationId ? `&station=${encodeURIComponent(stationId)}` : ""}">選擇工站</a>`
    : "";

  routeRoot.innerHTML = `
    <section class="work-list-shell">
      <header class="work-list-hero">
        <div>
          <p class="eyebrow">現場工單</p>
          <h1 id="workListTitle">工單清單</h1>
          <p>${station ? `${escapeHtml(station.stationCode)} · ${escapeHtml(reportWorkDisplayText(station.stationName || station.stationCode))}` : "請先選擇工站"}</p>
        </div>
        ${stationSelectLink}
      </header>
      ${content}
    </section>
  `;
}
function latestByTime(rows, key) {
  return rows
    .slice()
    .sort((a, b) => String(b?.[key] || "").localeCompare(String(a?.[key] || "")))[0] || null;
}

function findWorkDetailContext() {
  const params = new URLSearchParams(window.location.search);
  const stations = mockStations();
  const workOrders = mockDataList("workOrders");
  const operations = mockDataList("operations");
  const sessions = mockDataList("workSessions");
  const reports = mockDataList("reportRecords");
  const defects = mockDataList("defectRecords");
  const inspections = mockDataList("inspectionBatches");
  const machines = mockDataList("machines");
  const operators = mockDataList("operators");
  const dataMissing = !Array.isArray(window.MachTileMockData?.workOrders) || !Array.isArray(window.MachTileMockData?.operations);

  const machineKey = params.get("machine") || "";
  const queryMachine = machineKey
    ? machines.find((machine) => [machine.machineId, machine.machineCode, machine.machineName].includes(machineKey))
    : null;
  const sessionKey = params.get("sessionId") || params.get("session") || "";
  const querySession = sessionKey ? sessions.find((session) => session.sessionId === sessionKey) : null;
  const operationKey = params.get("operationId") || params.get("operation") || "";
  const workOrderKey = params.get("workOrderId") || params.get("workOrderNo") || params.get("workOrder") || params.get("wo") || "";

  let stationId = params.get("station") || params.get("stationId") || selectedStationId || querySession?.stationId || queryMachine?.stationId || "";
  let operation = operationKey ? operations.find((item) => item.operationId === operationKey || item.operationNo === operationKey) : null;
  let workOrder = null;

  if (querySession && !operation) operation = operations.find((item) => item.operationId === querySession.operationId) || null;
  if (querySession) workOrder = workOrders.find((item) => item.workOrderId === querySession.workOrderId) || null;
  if (!workOrder && workOrderKey) {
    workOrder = workOrders.find((item) => [item.workOrderId, item.workOrderNo].includes(workOrderKey)) || null;
  }
  if (!workOrder && operation) workOrder = workOrders.find((item) => item.workOrderId === operation.workOrderId) || null;
  if (!operation && workOrder && stationId) {
    operation = operations.find((item) => item.workOrderId === workOrder.workOrderId && item.stationId === stationId) || null;
  }
  if (!operation && workOrder) {
    operation = operations.find((item) => item.workOrderId === workOrder.workOrderId) || null;
  }
  if (!stationId && operation) stationId = operation.stationId;

  const station = stations.find((item) => item.stationId === stationId || item.stationCode === stationId) || null;
  const selectedSession = querySession || sessions.find((item) => item.operationId === operation?.operationId && item.stationId === station?.stationId) || null;
  const machine = queryMachine || machines.find((item) => item.machineId === selectedSession?.machineId) || machines.find((item) => item.stationId === station?.stationId) || null;
  const operator = operators.find((item) => item.operatorId === selectedSession?.operatorId) || null;
  const reportRows = reports.filter((report) => {
    if (workOrder && report.workOrderId !== workOrder.workOrderId) return false;
    if (operation && report.operationId !== operation.operationId) return false;
    if (station && report.stationId !== station.stationId) return false;
    return true;
  });
  const reportIds = new Set(reportRows.map((report) => report.reportId));
  const defectRows = defects.filter((defect) => reportIds.has(defect.reportId));
  const inspection = inspections.find((item) => {
    if (workOrder && item.workOrderId !== workOrder.workOrderId) return false;
    if (operation && item.operationId !== operation.operationId) return false;
    if (station && item.stationId !== station.stationId) return false;
    return true;
  }) || null;
  const completedQty = reportRows.reduce((sum, report) => sum + Number(report.goodQty || 0), 0);
  const defectQty = reportRows.reduce((sum, report) => sum + Number(report.defectQty || 0), 0);
  const plannedQty = Number(operation?.plannedQty || workOrder?.plannedQty || 0);
  const hasSelection = Boolean(sessionKey || operationKey || workOrderKey);

  if (dataMissing) return { state: "dataMissing", stationId };
  if (!hasSelection) return { state: "noSelection", stationId, station };
  if (stationId && !station) return { state: "unknownStation", stationId };
  if (station?.isActive === false) return { state: "inactiveStation", stationId, station };
  if (operationKey && !operation) return { state: "unknownOperation", stationId, station };
  if (!workOrder) return { state: "unknownWorkOrder", stationId, station };
  if (station && operation && operation.stationId !== station.stationId) return { state: "stationMismatch", stationId, station };

  return {
    state: "ready",
    stationId,
    station,
    workOrder,
    operation,
    session: selectedSession,
    machine,
    operator,
    reports: reportRows,
    defects: defectRows,
    inspection,
    completedQty,
    defectQty,
    plannedQty,
    remainingQty: Math.max(0, plannedQty - completedQty),
    lastReport: latestByTime(reportRows, "reportTime"),
    status: operation?.status || workOrder?.status || selectedSession?.status || "unknown",
  };
}

function workDetailEmptyState(title, body, stationId = selectedRouteStationId()) {
  return `
    <section class="work-detail-empty">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
      <a href="${escapeHtml(workListRouteUrl(stationId))}">回到工單清單</a>
    </section>
  `;
}

function detailField(label, value) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? "-")}</strong>
    </div>
  `;
}

function renderWorkDetailContent(context) {
  if (context.state === "dataMissing") return workDetailEmptyState("示範資料缺失", "本機示範資料尚未載入，請確認 mockData.js。", context.stationId);
  if (context.state === "noSelection") return workDetailEmptyState("請先從工單清單選擇工單", "先回到工單清單，選擇要確認的工單明細。", context.stationId);
  if (context.state === "unknownStation") return workDetailEmptyState("找不到工站", "目前 mock data 沒有這個工站，請回到工單清單重新選擇。", context.stationId);
  if (context.state === "inactiveStation") return workDetailEmptyState("工站未啟用", `${context.station?.stationCode || context.stationId} 目前未啟用。`, context.stationId);
  if (context.state === "unknownOperation") return workDetailEmptyState("找不到製程", "目前 mock data 沒有這個製程，請回到工單清單重新選擇。", context.stationId);
  if (context.state === "unknownWorkOrder") return workDetailEmptyState("找不到工單", "目前 mock data 沒有這張工單，請回到工單清單重新選擇。", context.stationId);
  if (context.state === "stationMismatch") return workDetailEmptyState("工站與工單不一致", "這張工單製程不屬於目前選擇的工站。", context.stationId);

  const { workOrder, operation, station, session, machine, operator, inspection, lastReport } = context;
  const inspectionStatus = inspection?.summaryResult || inspection?.status ? statusText(inspection?.summaryResult || inspection?.status) : "無紀錄";
  const lastReportText = lastReport
    ? `${Number(lastReport.goodQty || 0)} 良品 / ${Number(lastReport.defectQty || 0)} 不良 · ${lastReport.reportTime || "-"}`
    : "尚無報工紀錄";
  const reportWorkUrl = reportWorkRouteUrlFromContext(context);
  return `
    <div class="work-detail-actions" aria-label="Next actions">
      <a href="${escapeHtml(reportWorkUrl)}">進入現場報工</a>
      <button type="button" disabled>首次開工（未啟用）</button>
      <button type="button" disabled>今日開工（未啟用）</button>
      <button type="button" disabled>收工 / 完工（未啟用）</button>
    </div>
    <section class="work-detail-grid">
      <article class="work-detail-card work-detail-card-main">
        <p class="eyebrow">工單資訊</p>
        <h2>${escapeHtml(workOrder.workOrderNo || workOrder.workOrderId)}</h2>
        <p>${escapeHtml(reportWorkDisplayText(workOrder.partName || "-"))}</p>
        <div class="work-detail-fields">
          ${detailField("料號", workOrder.partNo)}
          ${detailField("客戶", reportWorkDisplayText(workOrder.customerName || "示範客戶"))}
          ${detailField("製程", reportWorkDisplayText(operation?.operationName))}
          ${detailField("製程 ID", operation?.operationId)}
          <span class="report-work-hidden-marker">Operation ID</span>
          ${detailField("工站", station ? `${station.stationCode} · ${reportWorkDisplayText(station.stationName || station.stationCode)}` : "-")}
          ${detailField("交期", workOrder.dueDate)}
          ${detailField("狀態", statusText(context.status))}
        </div>
      </article>
      <article class="work-detail-card">
        <p class="eyebrow">數量狀態</p>
        <div class="work-detail-metrics">
          <span><strong>${context.plannedQty || "-"}</strong><small>計畫數</small></span>
          <span><strong>${context.completedQty}</strong><small>已完成</small></span>
          <span><strong>${context.remainingQty}</strong><small>剩餘</small></span>
          <span><strong>${context.defectQty}</strong><small>不良</small></span>
        </div>
      </article>
      <article class="work-detail-card">
        <p class="eyebrow">加工狀態</p>
        <div class="work-detail-fields">
          ${detailField("目前狀態", session?.status ? statusText(session.status) : "尚未開工")}
          ${detailField("機台", reportWorkDisplayText(machine?.machineName || machine?.machineCode || "-"))}
          ${detailField("操作員", reportWorkDisplayText(operator?.operatorName || operator?.operatorCode || "-"))}
          ${detailField("開始時間", session?.startTime || "-")}
        </div>
      </article>
      <article class="work-detail-card">
        <p class="eyebrow">現場紀錄</p>
        <div class="work-detail-fields">
          ${detailField("最近報工", lastReportText)}
          ${detailField("檢驗", inspectionStatus)}
          ${detailField("不良紀錄", context.defects.length)}
          ${detailField("測試模式", "只讀，不會送出")}
        </div>
      </article>
    </section>
  `;
}
function renderWorkDetailRoute() {
  document.body.classList.remove("station-select-route-mode");
  document.body.classList.remove("work-list-route-mode");
  document.body.classList.remove("report-work-route-mode");
  document.body.classList.remove("hmc-report-route-mode");
  document.body.classList.add("work-detail-route-mode");

  const stationSelectRoot = $("#stationSelectRoute");
  if (stationSelectRoot) stationSelectRoot.hidden = true;
  const workListRoot = $("#workListRoute");
  if (workListRoot) workListRoot.hidden = true;
  const reportWorkRoot = $("#reportWorkRoute");
  if (reportWorkRoot) reportWorkRoot.hidden = true;
  const hmcReportRoot = $("#hmcReportRoute");
  if (hmcReportRoot) hmcReportRoot.hidden = true;

  let routeRoot = $("#workDetailRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "workDetailRoute";
    routeRoot.className = "work-detail-route";
    routeRoot.setAttribute("role", "main");
    routeRoot.setAttribute("aria-labelledby", "workDetailTitle");
    document.body.appendChild(routeRoot);
  }
  routeRoot.hidden = false;

  const context = findWorkDetailContext();
  selectedStationId = context.stationId || selectedStationId;
  routeRoot.innerHTML = `
    <section class="work-detail-shell">
      <header class="work-detail-hero">
        <div>
          <p class="eyebrow">現場工單</p>
          <h1 id="workDetailTitle">工單明細</h1>
          <p>${context.station ? `${escapeHtml(context.station.stationCode)} · ${escapeHtml(reportWorkDisplayText(context.station.stationName || context.station.stationCode))}` : "只讀示範明細"}</p>
        </div>
        <a href="${escapeHtml(workListRouteUrl(context.stationId))}">回到工單清單</a>
      </header>
      ${renderWorkDetailContent(context)}
    </section>
  `;
}
function reportWorkContextFromItem(item, autoSelected = false) {
  const reports = mockDataList("reportRecords").filter((report) => (
    report.workOrderId === item.workOrder?.workOrderId &&
    report.operationId === item.operation?.operationId &&
    report.stationId === item.station?.stationId
  ));
  const defects = mockDataList("defectRecords").filter((defect) => reports.some((report) => report.reportId === defect.reportId));
  return {
    state: "ready",
    stationId: item.station?.stationId || "",
    station: item.station,
    workOrder: item.workOrder,
    operation: item.operation,
    session: item.session,
    machine: mockDataList("machines").find((machine) => machine.machineId === item.session?.machineId || machine.stationId === item.station?.stationId) || null,
    operator: mockDataList("operators").find((operator) => operator.operatorId === item.session?.operatorId) || null,
    reports,
    defects,
    inspection: null,
    completedQty: item.completedQty,
    defectQty: item.defectQty,
    plannedQty: item.plannedQty,
    remainingQty: item.remainingQty,
    lastReport: latestByTime(reports, "reportTime"),
    status: item.status,
    autoSelected,
  };
}

function safeModeCncDemoReportContext() {
  const params = new URLSearchParams(window.location.search);
  const routePath = currentRoutePath();
  const hasExplicitWork = Boolean(
    params.get("workOrderId") ||
    params.get("workOrderNo") ||
    params.get("workOrder") ||
    params.get("wo") ||
    params.get("operationId") ||
    params.get("operation") ||
    params.get("sessionId") ||
    params.get("session")
  );
  const machineKey = (params.get("machine") || "").trim();

  if (!isP0SafeMode()) return null;
  if (routePath !== reportWorkRoutePath() && !routePath.startsWith(`${reportWorkRoutePath()}/`)) return null;
  if (hasExplicitWork || machineKey !== "CNC-03" || params.get("type") !== "dailyStart") return null;

  const stations = mockStations();
  const machines = mockDataList("machines");
  const matchedMachine = machines.find((machine) => (
    [machine.machineId, machine.machineCode, machine.machineName].includes(machineKey) ||
    String(machine.machineName || "").startsWith(machineKey)
  ));
  const station = stations.find((item) => (
    [item.stationId, item.stationCode, item.stationName].includes(machineKey) ||
    item.stationId === matchedMachine?.stationId
  ));
  if (!station) return null;

  const items = workListItemsForStation(station);
  const preferredItem = items.find((item) => (
    item.workOrder?.workOrderNo === "MO-MOCK-1001" &&
    item.operation?.operationId === "opn-1001-20"
  ));
  const item = preferredItem || items[0];
  return item ? reportWorkContextFromItem(item, true) : null;
}

function findReportWorkContext() {
  const detailContext = findWorkDetailContext();
  if (detailContext.state === "ready") return detailContext;
  const safeModeDemoContext = safeModeCncDemoReportContext();
  if (safeModeDemoContext) return safeModeDemoContext;
  if (detailContext.state !== "noSelection" || !detailContext.station) return detailContext;

  const items = workListItemsForStation(detailContext.station);
  if (!items.length) {
    return { ...detailContext, state: "noAssigned" };
  }
  return reportWorkContextFromItem(items[0], true);
}

function reportWorkReturnRoutePath() {
  return currentReturnRoutePath();
}

function reportWorkBackLabel() {
  return reportWorkReturnRoutePath().startsWith("/work-orders/") ? "返回卡片工單明細" : "返回工單明細";
}

function reportWorkBackUrl(context) {
  const returnRoute = reportWorkReturnRoutePath();
  if (returnRoute) {
    const params = new URLSearchParams();
    params.set("route", returnRoute);
    return routeQuery(params);
  }

  if (context?.state === "ready" && context.workOrder && context.operation) {
    const params = new URLSearchParams();
    params.set("route", workDetailRoutePath());
    if (context.stationId) params.set("station", context.stationId);
    params.set("workOrderId", context.workOrder.workOrderId);
    params.set("wo", context.workOrder.workOrderNo);
    params.set("operationId", context.operation.operationId);
    return routeQuery(params);
  }
  return workListRouteUrl(context?.stationId || selectedRouteStationId());
}

function reportWorkEmptyState(title, body, context = {}) {
  return `
    <section class="report-work-empty">
      ${renderReportWorkStateShell(context, null)}
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
      <a href="${escapeHtml(workListRouteUrl(context.stationId))}">Back to work list</a>
    </section>
  `;
}

function reportWorkFieldValue(selector) {
  return ($(selector)?.value || "").trim();
}

function reportWorkNumberValue(selector) {
  const rawValue = reportWorkFieldValue(selector);
  if (!rawValue) return { rawValue, value: 0, hasInput: false, isNumber: true };

  const value = Number(rawValue);
  return {
    rawValue,
    value: Number.isFinite(value) ? value : 0,
    hasInput: true,
    isNumber: Number.isFinite(value),
  };
}

function reportWorkPreviewField(label, value) {
  const labelMap = {
    workOrderNo: "工單號碼",
    operationName: "製程",
    stationCode: "工站代碼",
    stationName: "工站",
    goodQty: "良品數",
    defectQty: "不良數",
    totalReportQty: "本次合計",
    remainingQtyBefore: "報工前剩餘",
    remainingQtyAfterPreview: "預覽後剩餘",
    defectReason: "不良原因",
    operatorNote: "備註",
    operator: "操作員",
    timestamp: "預覽時間",
  };

  return `
    <span class="report-work-preview-field">
      <b>${escapeHtml(labelMap[label] || label)}</b>
      <em>${escapeHtml(value ?? "-")}</em>
      <small class="report-work-hidden-marker">${escapeHtml(label)}</small>
    </span>
  `;
}
function buildReportWorkPreview(context) {
  const goodQty = reportWorkNumberValue("#reportWorkGoodQty");
  const defectQty = reportWorkNumberValue("#reportWorkDefectQty");
  const defectReason = reportWorkFieldValue("#reportWorkDefectReason") || "-";
  const operatorNote = reportWorkFieldValue("#reportWorkOperatorNote") || "-";
  const remainingQtyBefore = Number(context.remainingQty || 0);
  const totalReportQty = goodQty.value + defectQty.value;
  const remainingQtyAfterPreview = remainingQtyBefore - totalReportQty;
  const warnings = [];

  if (!goodQty.isNumber || !defectQty.isNumber) warnings.push("數量欄位需輸入數字。");
  if (goodQty.value < 0) warnings.push("良品數不可為負數。");
  if (defectQty.value < 0) warnings.push("不良數不可為負數。");
  if (totalReportQty === 0) warnings.push("請先輸入良品數或不良數。");
  if (totalReportQty > remainingQtyBefore) warnings.push("本次合計已超過目前剩餘數量。");
  if (defectQty.value > 0 && defectReason === "-") warnings.push("有不良數時，需選擇不良原因。");

  return {
    workOrderNo: context.workOrder?.workOrderNo || context.workOrder?.workOrderId || "-",
    operationName: context.operation?.operationName || "-",
    stationCode: context.station?.stationCode || "-",
    stationName: context.station?.stationName || context.station?.stationCode || "-",
    goodQty: goodQty.value,
    defectQty: defectQty.value,
    goodQtyHasInput: goodQty.hasInput,
    defectQtyHasInput: defectQty.hasInput,
    totalReportQty,
    remainingQtyBefore,
    remainingQtyAfterPreview,
    defectReason,
    operatorNote,
    operatorLabel: context.operator?.operatorName || context.operator?.operatorCode || "Operator placeholder",
    timestampPlaceholder: "Preview timestamp placeholder",
    warnings,
  };
}
function reportWorkStateValidationMessages(context, preview) {
  const messages = [];

  if (context.state !== "ready") messages.push("缺少工單：請先從工單清單選擇工單。");
  if (!context.station) messages.push("缺少工站：請先確認目前工站。");
  if (!preview) {
    messages.push("目前無法產生預覽；送出仍維持停用。");
    return messages;
  }
  if (preview.goodQty < 0) messages.push("良品數不可為負數。");
  if (preview.defectQty < 0) messages.push("不良數不可為負數。");
  if (preview.totalReportQty === 0) messages.push("請先輸入良品數或不良數。");
  if (preview.defectQty > 0 && preview.defectReason === "-") messages.push("有不良數時，需選擇不良原因。");

  if (!messages.length) messages.push("目前輸入格式正常；請確認預覽結果。");
  return messages;
}
function reportWorkStateWarnings(context, preview, validationMessages) {
  const warnings = [];

  if (preview && preview.totalReportQty > preview.remainingQtyBefore) warnings.push("本次合計已超過剩餘數量，請重新確認。");
  if (preview && preview.totalReportQty > 0 && preview.remainingQtyBefore > 0 && preview.totalReportQty >= preview.remainingQtyBefore * 0.9) {
    warnings.push("本次報工量接近剩餘數量，請現場再確認。");
  }
  if (validationMessages.some((message) => message.includes("缺少工單") || message.includes("缺少工站"))) {
    warnings.push("缺少工單或工站時，只能查看提示，不能進行報工。");
  }

  return warnings;
}
function deriveReportWorkDisplayState(context, preview, validationMessages, warnings) {
  if (context.state !== "ready" || !context.station || !preview) return "InvalidInput";
  if (!preview.goodQtyHasInput && !preview.defectQtyHasInput && preview.defectReason === "-" && preview.operatorNote === "-") return "Draft";
  if (validationMessages.some((message) => !message.includes("目前輸入格式正常"))) return "InvalidInput";
  if (warnings.some((warning) => warning.includes("over-report") || warning.includes("unusual quantity"))) return "WarningRequired";
  if (preview.totalReportQty > 0) return "PreviewReady";
  return "SubmitDisabled";
}
function reportWorkStateDescription(state) {
  const descriptions = {
    Draft: "草稿輸入中；送出停用。",
    InvalidInput: "資料尚未通過畫面驗證；送出停用。",
    PreviewReady: "預覽已更新；只顯示計算結果，不會送出。",
    WarningRequired: "有警示需要現場確認；仍只預覽。",
    ConfirmationReady: "確認狀態只作為未來概念，P0 不可執行。",
    SubmitDisabled: "目前所有送出能力都被停用。",
    ReadyToSubmitFutureOnly: "ReadyToSubmitFutureOnly 需未來 owner 核准才可能啟用。",
  };
  return descriptions[state] || descriptions.SubmitDisabled;
}
function reportWorkStateLabel(state) {
  const labels = {
    Draft: "草稿",
    InvalidInput: "需修正",
    PreviewReady: "預覽完成",
    WarningRequired: "需確認警示",
    ConfirmationReady: "確認預備",
    SubmitDisabled: "送出停用",
    ReadyToSubmitFutureOnly: "未來才可送出",
  };
  return labels[state] || labels.SubmitDisabled;
}

function reportWorkHiddenMarkers() {
  return `
    <span class="report-work-hidden-marker">
      StateBadge ValidationSummary WarningPanel NoSubmitBanner SubmitDisabled ReadyToSubmitFutureOnly
      totalReportQty remainingQtyBefore remainingQtyAfterPreview
      P0-009 state machine UI shell does not submit or persist report data
      SOFTNET_INTEGRATION FuturePlanningOnly no persistence no SoftNet sync future-only submit disabled submit
    </span>
  `;
}

function reportWorkDisplayText(value) {
  const text = String(value ?? "-");
  const displayMap = {
    "Demo shaft part": "示範軸件",
    "Demo Customer A": "示範客戶 A",
    "CNC finishing": "CNC 精加工",
    "CNC Station 01": "CNC 01 工站",
    "CNC Station 02": "CNC 02 工站",
    "CNC Station 03": "CNC 03 工站",
    "CNC Station 05": "CNC 05 工站",
    "Inspection Station 01": "檢驗 01 工站",
    "CNC-03 machine": "CNC-03 機台",
    "CNC 03 machine": "CNC 03 機台",
    "CNC Operator 01": "CNC 操作員 01",
    IN_PROGRESS: "加工中",
  };
  return displayMap[text] || text;
}

function renderReportWorkStateShell(context, preview) {
  const validationMessages = reportWorkStateValidationMessages(context, preview);
  const warnings = reportWorkStateWarnings(context, preview, validationMessages);
  const state = deriveReportWorkDisplayState(context, preview, validationMessages, warnings);
  const validationItems = validationMessages.map((message) => `<li>${escapeHtml(message)}</li>`).join("");
  const warningItems = warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  const statusTone = state === "PreviewReady" ? "ok" : state === "Draft" ? "draft" : "warning";

  return `
    <section id="reportWorkStateShell" class="report-work-state-shell" data-state="${escapeHtml(state)}" aria-label="P0-009 display-only disabled submit state shell">
      ${reportWorkHiddenMarkers()}
      <div id="reportWorkStateBadge" class="report-work-state-badge report-work-state-${escapeHtml(state.toLowerCase())}" data-tone="${escapeHtml(statusTone)}">
        <span>目前狀態</span>
        <strong>${escapeHtml(reportWorkStateLabel(state))}</strong>
        <em>${escapeHtml(reportWorkStateDescription(state))}</em>
      </div>
      <div id="reportWorkValidationSummary" class="report-work-validation-summary">
        <strong>輸入檢查</strong>
        <ul>${validationItems}</ul>
      </div>
      <div id="reportWorkWarningPanel" class="report-work-warning-panel" ${warnings.length ? "" : "hidden"}>
        <strong>需要注意</strong>
        <ul>${warningItems}</ul>
      </div>
      <p class="report-work-no-submit-banner"><b>尚未啟用送出</b> 目前只做預覽，不會寫入資料庫，也不會同步 SoftNet。</p>
    </section>
  `;
}
function renderReportWorkPreviewPanel(context, preview = buildReportWorkPreview(context)) {
  const warningItems = preview.warnings.length
    ? preview.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")
    : "<li>目前沒有預覽警示；送出與確認仍維持停用。</li>";

  return `
    <div id="reportWorkPreviewPanel" class="report-work-preview" aria-label="Calculated report preview summary">
      <div class="report-work-section-title">
        <strong>預覽結果</strong>
        <span>輸入數量後即時更新</span>
      </div>
      <div class="report-work-preview-grid report-work-preview-grid-primary">
        ${reportWorkPreviewField("totalReportQty", preview.totalReportQty)}
        ${reportWorkPreviewField("remainingQtyBefore", preview.remainingQtyBefore)}
        ${reportWorkPreviewField("remainingQtyAfterPreview", preview.remainingQtyAfterPreview)}
      </div>
      <div class="report-work-preview-grid">
        ${reportWorkPreviewField("goodQty", preview.goodQty)}
        ${reportWorkPreviewField("defectQty", preview.defectQty)}
        ${reportWorkPreviewField("defectReason", preview.defectReason)}
        ${reportWorkPreviewField("operatorNote", preview.operatorNote)}
      </div>
      <div class="report-work-warning-block">
        <span>預覽警示</span>
        <ul>${warningItems}</ul>
      </div>
    </div>
  `;
}
function renderReportWorkConfirmationPanel(context, preview = buildReportWorkPreview(context)) {
  return `
    <section id="reportWorkConfirmationPanel" class="report-work-confirmation" aria-label="Disabled report confirmation summary">
      <strong>送出狀態</strong>
      <p>目前只做畫面預覽，不會送出或儲存。</p>
      <div class="report-work-confirmation-grid">
        ${reportWorkPreviewField("totalReportQty", preview.totalReportQty)}
        ${reportWorkPreviewField("remainingQtyAfterPreview", preview.remainingQtyAfterPreview)}
        ${reportWorkPreviewField("defectReason", preview.defectReason)}
      </div>
      <button type="button" disabled aria-disabled="true">尚未啟用送出</button>
    </section>
  `;
}
function updateReportWorkPreview(context) {
  const preview = buildReportWorkPreview(context);
  const previewRoot = $("#reportWorkPreviewPanel");
  const confirmationRoot = $("#reportWorkConfirmationPanel");
  const stateShellRoot = $("#reportWorkStateShell");

  if (stateShellRoot) stateShellRoot.outerHTML = renderReportWorkStateShell(context, preview);
  if (previewRoot) previewRoot.outerHTML = renderReportWorkPreviewPanel(context, preview);
  if (confirmationRoot) confirmationRoot.outerHTML = renderReportWorkConfirmationPanel(context, preview);
}

function bindReportWorkPreviewEvents(context) {
  ["#reportWorkGoodQty", "#reportWorkDefectQty", "#reportWorkDefectReason", "#reportWorkOperatorNote"].forEach((selector) => {
    const field = $(selector);
    if (!field) return;
    field.addEventListener("input", () => updateReportWorkPreview(context));
    field.addEventListener("change", () => updateReportWorkPreview(context));
  });
}

function renderReportWorkFormContent(context) {
  if (context.state === "dataMissing") return reportWorkEmptyState("Mock data missing", "本機 mock data 尚未載入，請確認 mockData.js。", context);
  if (context.state === "noSelection") return reportWorkEmptyState("請先從工單清單選擇工單", "P0-005 需要先有工單情境，才能顯示報工表單。", context);
  if (context.state === "noAssigned") return reportWorkEmptyState("目前沒有指派工單", "目前工站沒有可顯示的 mock 工單。", context);
  if (context.state !== "ready") return reportWorkEmptyState("找不到工單情境", "請回到工單清單重新選擇。", context);

  const { workOrder, operation, station, operator } = context;
  const reasonOptions = reportWorkDefectReasons
    .map((reason) => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`)
    .join("");
  const autoNote = context.autoSelected ? `<p class="report-work-note">CNC-03 demo route auto-selected the first mock work item for this station.</p>` : "";
  const preview = buildReportWorkPreview(context);

  return `
    <section class="report-work-grid">
      <article class="report-work-card report-work-summary">
        <p class="eyebrow">報工工單資訊</p>
        <h2>${escapeHtml(workOrder.workOrderNo || workOrder.workOrderId)}</h2>
        <p class="report-work-part-name">${escapeHtml(reportWorkDisplayText(workOrder.partName))}</p>
        ${autoNote}
        <div class="work-detail-fields">
          ${detailField("料號", workOrder.partNo)}
          ${detailField("製程", reportWorkDisplayText(operation?.operationName))}
          ${detailField("製程 ID", operation?.operationId)}
          <span class="report-work-hidden-marker">Operation ID</span>
          ${detailField("工站", station ? `${station.stationCode} · ${reportWorkDisplayText(station.stationName || station.stationCode)}` : "-")}
          ${detailField("操作員", reportWorkDisplayText(operator?.operatorName || operator?.operatorCode || "待指定"))}
          ${detailField("狀態", statusText(context.status))}
          ${detailField("交期", workOrder.dueDate)}
        </div>
      </article>
      <section class="report-work-card report-work-form" role="form" aria-label="P0-006 report-work preview shell">
        <div class="report-work-section-title">
          <p class="eyebrow">本次報工輸入</p>
          <span>填完後下方會自動預覽，目前不會送出</span>
        </div>
        <p class="report-work-form-help">請填「本次」完成數量，不是累計數量。不良數為 0 時，不良原因可以不選。</p>
        <div class="report-work-quantity-row">
          <label for="reportWorkGoodQty">
            <span>本次良品數</span>
            <input id="reportWorkGoodQty" name="goodQty" type="number" min="0" inputmode="numeric" placeholder="例如 33" autocomplete="off">
            <small class="report-work-field-hint">這次實際完成的良品件數。</small>
          </label>
          <label for="reportWorkDefectQty">
            <span>本次不良數</span>
            <input id="reportWorkDefectQty" name="defectQty" type="number" min="0" inputmode="numeric" placeholder="沒有不良填 0" autocomplete="off">
            <small class="report-work-field-hint">這次發現的不良件數；沒有就填 0。</small>
          </label>
        </div>
        <label for="reportWorkDefectReason">
          <span>不良原因</span>
          <select id="reportWorkDefectReason" name="defectReason">
            <option value="">請選擇不良原因</option>
            ${reasonOptions}
          </select>
          <small class="report-work-field-hint">只有不良數大於 0 時需要選。</small>
        </label>
        <label for="reportWorkOperatorNote">
          <span>現場備註</span>
          <textarea id="reportWorkOperatorNote" name="operatorNote" rows="3" placeholder="可留空；例如尺寸偏差、刀具狀況或待主管確認事項"></textarea>
          <small class="report-work-field-hint">選填，用來補充現場狀況。</small>
        </label>
        ${renderReportWorkStateShell(context, preview)}
        ${renderReportWorkPreviewPanel(context, preview)}
        ${renderReportWorkConfirmationPanel(context, preview)}
        <p class="report-work-safety">安全提示：目前只做預覽，不會送出、不會寫入資料庫。</p>
        <button type="button" disabled aria-disabled="true">尚未啟用送出</button>
      </section>
    </section>
  `;
}
function renderReportWorkRoute() {
  document.body.classList.remove("station-select-route-mode");
  document.body.classList.remove("work-list-route-mode");
  document.body.classList.remove("work-detail-route-mode");
  document.body.classList.remove("hmc-report-route-mode");
  document.body.classList.add("report-work-route-mode");

  const stationSelectRoot = $("#stationSelectRoute");
  if (stationSelectRoot) stationSelectRoot.hidden = true;
  const workListRoot = $("#workListRoute");
  if (workListRoot) workListRoot.hidden = true;
  const workDetailRoot = $("#workDetailRoute");
  if (workDetailRoot) workDetailRoot.hidden = true;
  const hmcReportRoot = $("#hmcReportRoute");
  if (hmcReportRoot) hmcReportRoot.hidden = true;

  let routeRoot = $("#reportWorkRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "reportWorkRoute";
    routeRoot.className = "report-work-route";
    routeRoot.setAttribute("role", "main");
    routeRoot.setAttribute("aria-labelledby", "reportWorkTitle");
    document.body.appendChild(routeRoot);
  }
  routeRoot.hidden = false;

  const context = findReportWorkContext();
  selectedStationId = context.stationId || selectedStationId;
  routeRoot.innerHTML = `
    <section class="report-work-shell">
      <header class="report-work-hero">
        <div>
          <p class="eyebrow">手機報工</p>
          <h1 id="reportWorkTitle">現場報工表單</h1>
          <p>預覽模式：目前不會送出、不會儲存、不會呼叫端點。</p>
        </div>
        <div class="report-work-hero-actions">
          <a href="${escapeHtml(reportWorkBackUrl(context))}">${escapeHtml(reportWorkBackLabel())}</a>
          <a class="report-work-secondary-link" href="${escapeHtml(workListRouteUrl(context.stationId || selectedRouteStationId()))}">切換工單</a>
        </div>
      </header>
      ${renderReportWorkFormContent(context)}
    </section>
  `;
  if (context.state === "ready") {
    bindReportWorkPreviewEvents(context);
    updateReportWorkPreview(context);
  }
}

const hmcReportPallets = [
  {
    palletId: "P1",
    palletName: "1 號交換盤",
    setupName: "油壓閥座混合治具",
    works: [
      { workNo: "HMC-MOCK-3001", partName: "油壓閥座 A", operationName: "臥加四面加工", operationId: "hmc-op-3001-10", plannedQty: 24, completedQty: 10, remainingQty: 14 },
      { workNo: "HMC-MOCK-3002", partName: "油壓閥座 B", operationName: "臥加鑽孔攻牙", operationId: "hmc-op-3002-20", plannedQty: 18, completedQty: 6, remainingQty: 12 },
      { workNo: "HMC-MOCK-3003", partName: "歧管底板", operationName: "臥加精修面", operationId: "hmc-op-3003-30", plannedQty: 12, completedQty: 4, remainingQty: 8 },
    ],
  },
  {
    palletId: "P2",
    palletName: "2 號交換盤",
    setupName: "鋁件多工位治具",
    works: [
      { workNo: "HMC-MOCK-3011", partName: "鋁合金底座", operationName: "臥加粗加工", operationId: "hmc-op-3011-10", plannedQty: 30, completedQty: 12, remainingQty: 18 },
      { workNo: "HMC-MOCK-3012", partName: "支撐座右件", operationName: "臥加精加工", operationId: "hmc-op-3012-20", plannedQty: 20, completedQty: 9, remainingQty: 11 },
    ],
  },
  {
    palletId: "P3",
    palletName: "3 號交換盤",
    setupName: "鑄件共用治具",
    works: [
      { workNo: "HMC-MOCK-3021", partName: "泵浦外殼", operationName: "臥加基準面", operationId: "hmc-op-3021-10", plannedQty: 16, completedQty: 3, remainingQty: 13 },
      { workNo: "HMC-MOCK-3022", partName: "泵浦側蓋", operationName: "臥加孔系加工", operationId: "hmc-op-3022-20", plannedQty: 22, completedQty: 8, remainingQty: 14 },
    ],
  },
  {
    palletId: "P4",
    palletName: "4 號交換盤",
    setupName: "急件插單治具",
    works: [
      { workNo: "HMC-MOCK-3031", partName: "急件轉接板", operationName: "臥加快速加工", operationId: "hmc-op-3031-10", plannedQty: 8, completedQty: 0, remainingQty: 8 },
      { workNo: "HMC-MOCK-3032", partName: "小批量支架", operationName: "臥加修邊", operationId: "hmc-op-3032-20", plannedQty: 10, completedQty: 2, remainingQty: 8 },
    ],
  },
  {
    palletId: "P5",
    palletName: "5 號交換盤",
    setupName: "夜班批次治具",
    works: [
      { workNo: "HMC-MOCK-3041", partName: "連桿座", operationName: "臥加夜班批次", operationId: "hmc-op-3041-10", plannedQty: 40, completedQty: 20, remainingQty: 20 },
      { workNo: "HMC-MOCK-3042", partName: "固定板", operationName: "臥加夜班批次", operationId: "hmc-op-3042-20", plannedQty: 36, completedQty: 18, remainingQty: 18 },
      { workNo: "HMC-MOCK-3043", partName: "定位塊", operationName: "臥加夜班批次", operationId: "hmc-op-3043-30", plannedQty: 28, completedQty: 10, remainingQty: 18 },
    ],
  },
  {
    palletId: "P6",
    palletName: "6 號交換盤",
    setupName: "備用 / 缺料待確認",
    works: [
      { workNo: "HMC-MOCK-3051", partName: "備用治具件", operationName: "臥加待排", operationId: "hmc-op-3051-10", plannedQty: 12, completedQty: 0, remainingQty: 12 },
    ],
  },
];

function createDefaultHmcShiftPlans() {
  return {
    day: {
      activePalletId: "P1",
      workNo: "HMC-MOCK-3001",
      selectedWorkKeys: new Set([
        "P1:HMC-MOCK-3001",
        "P1:HMC-MOCK-3002",
        "P1:HMC-MOCK-3003",
        "P2:HMC-MOCK-3011",
        "P2:HMC-MOCK-3012",
      ]),
      quantities: {
        "P1:HMC-MOCK-3001": "1",
        "P1:HMC-MOCK-3002": "2",
        "P1:HMC-MOCK-3003": "4",
        "P2:HMC-MOCK-3011": "5",
        "P2:HMC-MOCK-3012": "4",
      },
      skipped: {},
    },
    night: {
      activePalletId: "P5",
      workNo: "HMC-MOCK-3041",
      selectedWorkKeys: new Set([
        "P1:HMC-MOCK-3001",
        "P1:HMC-MOCK-3002",
        "P1:HMC-MOCK-3003",
        "P5:HMC-MOCK-3041",
        "P5:HMC-MOCK-3042",
        "P5:HMC-MOCK-3043",
      ]),
      quantities: {
        "P1:HMC-MOCK-3001": "3",
        "P1:HMC-MOCK-3002": "3",
        "P1:HMC-MOCK-3003": "3",
        "P5:HMC-MOCK-3041": "6",
        "P5:HMC-MOCK-3042": "6",
        "P5:HMC-MOCK-3043": "6",
      },
      skipped: {},
    },
  };
}

const hmcReportState = {
  shift: "day",
  machinePlans: {},
  worklistReadCache: {},
  setupOpen: false,
};

const hmcSetupWriteState = {
  status: "idle",
  worklistId: "",
  worklistStatus: "",
  palletCount: 0,
  itemCount: 0,
  code: "",
  message: "",
};

const hmcSetupReplaceState = {
  open: false,
  confirmed: false,
  status: "idle",
  code: "",
  message: "",
  oldWorklistId: "",
  newWorklistId: "",
};

const hmcDailyCheckSaveState = {
  status: "idle",
  code: "",
  message: "",
  rowCount: 0,
  completedQty: 0,
  defectQty: 0,
  shortageOrSkippedCount: 0,
  dailyCheckStatus: "",
  savedAt: "",
};

const hmcDailyCheckReviewState = {
  cache: {},
  reviewNote: "",
  action: {
    status: "idle",
    action: "",
    code: "",
    message: "",
    requestedCount: 0,
    updatedCount: 0,
  },
  conversion: {
    status: "idle",
    confirming: false,
    code: "",
    message: "",
    draftNo: "",
    draftId: "",
    itemCount: 0,
  },
};

function resetHmcSetupReplaceState(nextStatus = "idle") {
  hmcSetupReplaceState.open = false;
  hmcSetupReplaceState.confirmed = false;
  hmcSetupReplaceState.status = nextStatus;
  hmcSetupReplaceState.code = "";
  hmcSetupReplaceState.message = "";
  hmcSetupReplaceState.oldWorklistId = "";
  hmcSetupReplaceState.newWorklistId = "";
}

function hmcRouteMachineKey() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("machine") || "HMC-01").trim() || "HMC-01";
}

function hmcRouteMachineLabel() {
  const machineKey = hmcRouteMachineKey();
  const machine = state.machines.find((item) => [item.name, item.code].includes(machineKey));
  return machine?.name || machineKey;
}

function hmcMachinePlan() {
  const machineKey = hmcRouteMachineKey();
  if (!hmcReportState.machinePlans[machineKey]) {
    hmcReportState.machinePlans[machineKey] = {
      machineKey,
      shiftPlans: createDefaultHmcShiftPlans(),
    };
  }
  return hmcReportState.machinePlans[machineKey];
}

function hmcWorkKey(palletId, workNo) {
  return `${palletId}:${workNo}`;
}

function hmcDbWorklistReadEnabled() {
  const params = new URLSearchParams(window.location.search);
  const source = params.get("worklistSource");
  if (source === "preview" || params.get("hmcDbRead") === "0") return false;
  return source === "db" || params.get("hmcDbRead") === "1" || canReadHmcWorklistFromSupabase();
}

function hmcWorklistReadCacheKey(machineCode = hmcRouteMachineKey(), shift = hmcReportState.shift) {
  return `${machineCode || "HMC-01"}:${shift || "day"}`;
}

function canReadHmcWorklistFromSupabase() {
  return Boolean((config.useSupabase || config.useHmcWorklistSupabase) && config.supabaseUrl && config.supabaseAnonKey);
}

function hmcCurrentWorklistReadState() {
  if (!hmcDbWorklistReadEnabled()) {
    return { status: "preview", source: "mock-preview", message: "HMC preview list is active." };
  }
  const key = hmcWorklistReadCacheKey();
  return hmcReportState.worklistReadCache[key] || { status: "idle", source: "db" };
}

function hmcRestEq(field, value) {
  return `${field}=eq.${encodeURIComponent(value || "")}`;
}

function normalizeHmcWorklistRows(worklistRow, palletRows, itemRows) {
  const pallets = (Array.isArray(palletRows) ? palletRows : []).map((pallet) => {
    const palletNo = Number(pallet.pallet_no || 0);
    const palletId = pallet.id || `P${palletNo || 0}`;
    return {
      palletId,
      palletNo,
      palletName: palletNo ? `${palletNo} 號交換盤` : "未編號交換盤",
      setupName: pallet.fixture_name || pallet.fixture_code || "未設定治具",
      dbRowId: pallet.id,
      works: (Array.isArray(itemRows) ? itemRows : [])
        .filter((item) => String(item.pallet_id || "") === String(pallet.id || ""))
        .map((item) => ({
          workNo: item.work_order_no || item.id || "未命名工單",
          partName: item.workpiece_name || item.part_no || "未命名工件",
          operationName: item.operation_name || "-",
          operationId: item.operation_id || "-",
          plannedQty: Number(item.planned_qty || 0),
          completedQty: Number(item.completed_qty_before || 0),
          remainingQty: Number(item.remaining_qty_snapshot ?? item.planned_qty ?? 0),
          materialStatus: item.material_status || "unknown",
          positionCode: item.position_code || "",
          dbRowId: item.id,
        })),
    };
  });

  return {
    status: "ok",
    source: "db",
    worklist: {
      id: worklistRow.id,
      machineCode: worklistRow.machine_code,
      shiftScope: worklistRow.shift_scope,
      status: worklistRow.status,
      workDateStart: worklistRow.work_date_start || "",
      workDateEnd: worklistRow.work_date_end || "",
      versionNo: Number(worklistRow.version_no || 1),
      note: worklistRow.note || "",
    },
    pallets,
    items: Array.isArray(itemRows) ? itemRows : [],
    message: "Active HMC worklist loaded.",
  };
}

async function loadActiveHmcWorklist(machineCode, shift) {
  if (!machineCode || !["day", "night"].includes(shift)) {
    return {
      status: "invalid_request",
      source: "db",
      message: "machine and shift are required",
      worklist: null,
      pallets: [],
      items: [],
    };
  }

  const tenantFilter = config.tenantId ? `&${hmcRestEq("tenant_id", config.tenantId)}` : "";
  const worklistPath = [
    "hmc_shift_worklists?select=*",
    hmcRestEq("machine_code", machineCode),
    hmcRestEq("shift_scope", shift),
    hmcRestEq("status", "active"),
    "order=updated_at.desc,created_at.desc",
    "limit=2",
  ].join("&") + tenantFilter;
  const worklists = await supabaseFetch(worklistPath);

  if (!Array.isArray(worklists) || worklists.length === 0) {
    return {
      status: "not_found",
      source: "db",
      message: "尚未建立本班加工清單",
      worklist: null,
      pallets: [],
      items: [],
    };
  }

  if (worklists.length > 1) {
    return {
      status: "conflict",
      source: "db",
      message: "偵測到多筆啟用中的 HMC 加工清單，請由主管或排程人員確認。",
      worklist: null,
      pallets: [],
      items: [],
    };
  }

  const worklist = worklists[0];
  const worklistFilter = hmcRestEq("worklist_id", worklist.id);
  const [pallets, items] = await Promise.all([
    supabaseFetch(`hmc_worklist_pallets?select=*&${worklistFilter}&order=sort_order.asc,pallet_no.asc${tenantFilter}`),
    supabaseFetch(`hmc_worklist_items?select=*&${worklistFilter}&order=pallet_no.asc,sort_order.asc,position_code.asc${tenantFilter}`),
  ]);

  return normalizeHmcWorklistRows(worklist, pallets, items);
}

function requestHmcActiveWorklistRead() {
  if (!hmcDbWorklistReadEnabled()) return;
  const machineCode = hmcRouteMachineKey();
  const shift = hmcReportState.shift;
  const key = hmcWorklistReadCacheKey(machineCode, shift);
  const current = hmcReportState.worklistReadCache[key];
  if (current && ["loading", "ok", "not_found", "invalid_request", "conflict", "error"].includes(current.status)) return;

  if (!canReadHmcWorklistFromSupabase()) {
    hmcReportState.worklistReadCache[key] = {
      status: "error",
      source: "db",
      message: "尚未設定非 production Supabase 讀取來源。",
      worklist: null,
      pallets: [],
      items: [],
    };
    return;
  }

  hmcReportState.worklistReadCache[key] = {
    status: "loading",
    source: "db",
    message: "正在讀取 HMC 本班加工清單...",
    worklist: null,
    pallets: [],
    items: [],
  };

  loadActiveHmcWorklist(machineCode, shift)
    .then((result) => {
      hmcReportState.worklistReadCache[key] = result;
      const routePath = currentRoutePath();
      if ((routePath === hmcReportRoutePath() || routePath.startsWith(`${hmcReportRoutePath()}/`)) && hmcWorklistReadCacheKey() === key) {
        renderHmcReportRoute();
      }
    })
    .catch((error) => {
      hmcReportState.worklistReadCache[key] = {
        status: "error",
        source: "db",
        message: error?.message || "HMC 本班加工清單讀取失敗。",
        worklist: null,
        pallets: [],
        items: [],
      };
      const routePath = currentRoutePath();
      if ((routePath === hmcReportRoutePath() || routePath.startsWith(`${hmcReportRoutePath()}/`)) && hmcWorklistReadCacheKey() === key) {
        renderHmcReportRoute();
      }
    });
}

function hmcSetupActiveWorklistReadState() {
  if (!canReadHmcWorklistFromSupabase()) {
    return {
      status: "not_configured",
      source: "db",
      message: "連線設定未完成，無法讀取清單。",
      worklist: null,
      pallets: [],
      items: [],
    };
  }
  const key = hmcWorklistReadCacheKey(hmcRouteMachineKey(), hmcReportState.shift);
  return hmcReportState.worklistReadCache[key] || {
    status: "idle",
    source: "db",
    message: "Active worklist status has not been checked.",
    worklist: null,
    pallets: [],
    items: [],
  };
}

function hmcSetupActiveWorklistBlocksActivation() {
  const readState = hmcSetupActiveWorklistReadState();
  return ["ok", "conflict"].includes(readState.status);
}

function hmcClearSetupActiveWorklistReadCache() {
  const key = hmcWorklistReadCacheKey(hmcRouteMachineKey(), hmcReportState.shift);
  delete hmcReportState.worklistReadCache[key];
}

function requestHmcSetupActiveWorklistRead() {
  const machineCode = hmcRouteMachineKey();
  const shift = hmcReportState.shift;
  const key = hmcWorklistReadCacheKey(machineCode, shift);
  const current = hmcReportState.worklistReadCache[key];
  if (current && ["loading", "ok", "not_found", "invalid_request", "conflict", "error"].includes(current.status)) return;

  if (!canReadHmcWorklistFromSupabase()) {
    hmcReportState.worklistReadCache[key] = {
      status: "not_configured",
      source: "db",
      message: "連線設定未完成，無法讀取清單。",
      worklist: null,
      pallets: [],
      items: [],
    };
    return;
  }

  hmcReportState.worklistReadCache[key] = {
    status: "loading",
    source: "db",
    message: "Checking whether an active HMC worklist already exists...",
    worklist: null,
    pallets: [],
    items: [],
  };

  loadActiveHmcWorklist(machineCode, shift)
    .then((result) => {
      hmcReportState.worklistReadCache[key] = result;
      if (currentRoutePath() === hmcWorklistSetupRoutePath() && hmcWorklistReadCacheKey() === key) {
        renderHmcWorklistSetupRoute();
      }
    })
    .catch((error) => {
      hmcReportState.worklistReadCache[key] = {
        status: "error",
        source: "db",
        message: error?.message || "Failed to check active HMC worklist status.",
        worklist: null,
        pallets: [],
        items: [],
      };
      if (currentRoutePath() === hmcWorklistSetupRoutePath() && hmcWorklistReadCacheKey() === key) {
        renderHmcWorklistSetupRoute();
      }
    });
}

function activeHmcReportPallets() {
  const readState = hmcCurrentWorklistReadState();
  if (readState.status === "ok" && Array.isArray(readState.pallets) && readState.pallets.length) {
    return readState.pallets;
  }
  return hmcReportPallets;
}

function hmcWorklistReadStatusPanel() {
  const readState = hmcCurrentWorklistReadState();
  if (readState.status === "preview") {
    return `
      <section class="hmc-safe-banner" aria-label="HMC worklist preview source">
        <strong>畫面預覽清單</strong>
        <span>尚未讀取 DB</span>
        <span>可用 worklistSource=db 測試非 production 讀取</span>
        <span>送出停用</span>
      </section>
    `;
  }

  if (readState.status === "ok") {
    return `
      <section class="hmc-safe-banner" aria-label="HMC active DB worklist source">
        <strong>已讀取 DB 本班加工清單</strong>
        <span>${escapeHtml(readState.worklist?.machineCode || hmcRouteMachineKey())}</span>
        <span>${escapeHtml(hmcShiftLabel(readState.worklist?.shiftScope || hmcReportState.shift))}</span>
        <span>${escapeHtml(readState.pallets.length)} 盤</span>
        <span>${escapeHtml(readState.items.length)} 工件</span>
        <span>送出停用</span>
      </section>
    `;
  }

  const labelMap = {
    idle: "尚未開始讀取",
    loading: "正在讀取",
    not_found: "尚未建立本班加工清單",
    invalid_request: "讀取參數不完整",
    conflict: "啟用清單衝突",
    error: "讀取失敗",
  };
  return `
    <section class="hmc-safe-banner" aria-label="HMC worklist read status">
      <strong>${escapeHtml(labelMap[readState.status] || "讀取狀態")}</strong>
      <span>${escapeHtml(readState.message || "請確認本班加工清單狀態。")}</span>
      <span>不會寫入 DB</span>
      <span>送出停用</span>
    </section>
  `;
}

function hmcActivePlan() {
  const shiftPlans = hmcMachinePlan().shiftPlans;
  return shiftPlans[hmcReportState.shift] || shiftPlans.day;
}

function hmcSelectedWorkKeys() {
  return hmcActivePlan().selectedWorkKeys;
}

function hmcQuantities() {
  return hmcActivePlan().quantities;
}

function hmcSkipped() {
  return hmcActivePlan().skipped;
}

function hmcAllWorkItems() {
  return activeHmcReportPallets().flatMap((pallet) => (
    pallet.works.map((work) => ({ pallet, work, key: hmcWorkKey(pallet.palletId, work.workNo) }))
  ));
}

function hmcSelectedItems() {
  return hmcAllWorkItems().filter((item) => hmcSelectedWorkKeys().has(item.key));
}

function hmcEnsureSelectedWork() {
  const selected = hmcSelectedItems();
  if (selected.length) return;
  const pallet = selectedHmcPallet();
  const work = pallet.works[0];
  if (work) hmcSelectedWorkKeys().add(hmcWorkKey(pallet.palletId, work.workNo));
}

function selectedHmcPallet() {
  const pallets = activeHmcReportPallets();
  return pallets.find((pallet) => pallet.palletId === hmcActivePlan().activePalletId) || pallets[0] || hmcReportPallets[0];
}

function selectedHmcWork() {
  const pallet = selectedHmcPallet();
  const activeSelected = pallet.works.find((work) => hmcSelectedWorkKeys().has(hmcWorkKey(pallet.palletId, work.workNo)));
  return pallet.works.find((work) => work.workNo === hmcActivePlan().workNo) || activeSelected || pallet.works[0];
}

function hmcShiftLabel(shift) {
  return shift === "night" ? "晚班：批次工件" : "白班：自選工件";
}

function hmcShiftDescription(shift) {
  return shift === "night"
    ? "夜班模式：依交接清單批次巡盤，適合多盤、多工件一起填數量。"
    : "白班模式：依班前清單自選本班要做的交換盤與工件。";
}

function machtileSetRouteParam(key, value) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.history.replaceState(null, "", url.toString());
  } catch {
    // URL 更新失敗不阻擋畫面切換
  }
}

function initializeHmcReportState() {
  const params = new URLSearchParams(window.location.search);
  const shift = params.get("shift");
  const palletId = params.get("pallet");
  const workNo = params.get("work");
  if (shift === "night" || shift === "day") hmcReportState.shift = shift;
  const plan = hmcActivePlan();
  const pallets = activeHmcReportPallets();
  if (pallets.some((pallet) => pallet.palletId === palletId)) plan.activePalletId = palletId;
  const pallet = selectedHmcPallet();
  if (pallet.works.some((work) => work.workNo === workNo)) {
    plan.workNo = workNo;
    hmcSelectedWorkKeys().add(hmcWorkKey(pallet.palletId, workNo));
  }
  if (!pallet.works.some((work) => work.workNo === plan.workNo)) {
    plan.workNo = pallet.works[0]?.workNo || "";
  }
  hmcEnsureSelectedWork();
}

function hmcPalletButtons() {
  return activeHmcReportPallets().map((pallet) => `
    <button type="button" class="${pallet.palletId === hmcActivePlan().activePalletId ? "is-active" : ""} ${pallet.works.some((work) => hmcSelectedWorkKeys().has(hmcWorkKey(pallet.palletId, work.workNo))) ? "has-selected" : ""}" data-hmc-pallet="${escapeHtml(pallet.palletId)}">
      <span>${escapeHtml(pallet.palletName)}</span>
      <strong>${escapeHtml(pallet.setupName)}</strong>
      <small>${pallet.works.filter((work) => hmcSelectedWorkKeys().has(hmcWorkKey(pallet.palletId, work.workNo))).length}/${pallet.works.length} 已選</small>
    </button>
  `).join("");
}

function hmcWorkOptions() {
  return selectedHmcPallet().works.map((work) => `
    <option value="${escapeHtml(work.workNo)}" ${work.workNo === selectedHmcWork().workNo ? "selected" : ""}>
      ${escapeHtml(work.workNo)} / ${escapeHtml(work.partName)}
    </option>
  `).join("");
}

function hmcSelectedPalletWorkCards() {
  const works = selectedHmcPallet().works;
  const pallet = selectedHmcPallet();
  return `
    <section class="hmc-work-list" aria-label="Selected pallet work orders">
      <div class="hmc-work-list-head">
        <strong>${escapeHtml(pallet.palletName)} 工單清單</strong>
        <span>${works.filter((work) => hmcSelectedWorkKeys().has(hmcWorkKey(pallet.palletId, work.workNo))).length}/${works.length} 已選</span>
      </div>
      <div class="hmc-work-card-grid">
        ${works.map((work) => `
          <button type="button" class="${hmcSelectedWorkKeys().has(hmcWorkKey(pallet.palletId, work.workNo)) ? "is-selected" : ""} ${work.workNo === hmcActivePlan().workNo ? "is-active" : ""}" data-hmc-work-card="${escapeHtml(work.workNo)}">
            <span>${hmcSelectedWorkKeys().has(hmcWorkKey(pallet.palletId, work.workNo)) ? "已選" : "未選"} · ${escapeHtml(work.workNo)}</span>
            <strong>${escapeHtml(work.partName)}</strong>
            <em>${escapeHtml(work.operationName)}</em>
            <small>剩餘 ${escapeHtml(work.remainingQty)} / 製程 ID ${escapeHtml(work.operationId)}</small>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function hmcWorkLetter(index) {
  return String.fromCharCode(65 + index);
}

function hmcPalletMatrix() {
  return `
    <section class="hmc-pallet-matrix" aria-label="HMC pallet work matrix">
      <div class="hmc-pallet-matrix-head">
        <span>盤號</span>
        <strong>${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong>
        <em>已選工件會變藍；產品名稱後方直接填本次完成數。</em>
      </div>
      ${activeHmcReportPallets().map((pallet, palletIndex) => `
        <div class="hmc-pallet-row ${pallet.palletId === hmcActivePlan().activePalletId ? "is-active" : ""}">
          <button type="button" class="hmc-pallet-row-title" data-hmc-pallet="${escapeHtml(pallet.palletId)}">
            <span>第 ${escapeHtml(palletIndex + 1)} 盤</span>
            <strong>${escapeHtml(pallet.setupName)}</strong>
            <em>${pallet.works.filter((work) => hmcSelectedWorkKeys().has(hmcWorkKey(pallet.palletId, work.workNo))).length}/${pallet.works.length} 已選</em>
          </button>
          <div class="hmc-pallet-row-works">
            ${pallet.works.map((work, workIndex) => {
              const key = hmcWorkKey(pallet.palletId, work.workNo);
              const isSelected = hmcSelectedWorkKeys().has(key);
              const qtyValue = isSelected ? (hmcQuantities()[key] ?? "") : "";
              return `
                <div class="hmc-matrix-work ${isSelected ? "is-selected" : ""} ${work.workNo === hmcActivePlan().workNo ? "is-active" : ""}">
                  <button type="button" data-hmc-work-card="${escapeHtml(work.workNo)}" data-hmc-pallet-work="${escapeHtml(pallet.palletId)}" aria-pressed="${isSelected ? "true" : "false"}">
                    <span>${escapeHtml(hmcWorkLetter(workIndex))}</span>
                    <strong>${escapeHtml(work.partName)}</strong>
                    <em>${escapeHtml(work.workNo)}</em>
                  </button>
                  <label>
                    <span>數量</span>
                    <input class="hmc-selected-qty" type="number" min="0" inputmode="numeric" value="${escapeHtml(qtyValue)}" data-hmc-work-key="${escapeHtml(key)}" ${isSelected ? "" : "disabled"}>
                  </label>
                  <label class="hmc-matrix-skip">
                    <input class="hmc-selected-skip" type="checkbox" data-hmc-work-key="${escapeHtml(key)}" ${hmcSkipped()[key] ? "checked" : ""} ${isSelected ? "" : "disabled"}>
                    <span>缺料</span>
                  </label>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `).join("")}
    </section>
  `;
}

function hmcSelectedSummary() {
  const selected = hmcSelectedItems();
  const grouped = activeHmcReportPallets()
    .map((pallet) => ({
      pallet,
      items: selected.filter((item) => item.pallet.palletId === pallet.palletId),
    }))
    .filter((group) => group.items.length);
  const selectedPalletCount = grouped.length;

  return `
    <section class="hmc-selected-summary" aria-label="HMC selected work summary">
      <div class="hmc-selected-summary-head">
        <div>
          <span>班前已建立加工清單</span>
          <strong>${selected.length} 件 / ${selectedPalletCount} 盤</strong>
        </div>
        <button type="button" class="hmc-setup-toggle" data-hmc-toggle-setup>
          ${hmcReportState.setupOpen ? "收起本班加工清單設定" : "設定本班加工清單"}
        </button>
        <em>現場只需填完成數、缺料、備註；目前仍是畫面內記憶，尚未寫入資料庫。</em>
      </div>
      ${grouped.length ? grouped.map((group) => `
        <div class="hmc-selected-group">
          <strong>${escapeHtml(group.pallet.palletName)}</strong>
          <div>
            ${group.items.map((item) => `<span>${escapeHtml(item.work.workNo)} · ${escapeHtml(item.work.partName)}</span>`).join("")}
          </div>
        </div>
      `).join("") : `<p>尚未建立加工清單，請先從下方清單調整區選取交換盤與工件。</p>`}
    </section>
  `;
}

function hmcWorkSummary(work) {
  return `
    <div class="hmc-work-summary">
      <span>工單</span><strong>${escapeHtml(work.workNo)}</strong>
      <span>工件</span><strong>${escapeHtml(work.partName)}</strong>
      <span>製程</span><strong>${escapeHtml(work.operationName)}</strong>
      <span>製程 ID</span><strong>${escapeHtml(work.operationId)}</strong>
      <span>剩餘</span><strong>${escapeHtml(work.remainingQty)}</strong>
    </div>
  `;
}

function hmcNightChecklist() {
  const selected = hmcSelectedItems();
  const items = selected.length ? selected : selectedHmcPallet().works.map((work) => ({ pallet: selectedHmcPallet(), work, key: hmcWorkKey(selectedHmcPallet().palletId, work.workNo) }));
  return items.map(({ pallet, work, key }, index) => `
    <article class="hmc-night-row">
      <div>
        <strong>${escapeHtml(work.partName)}</strong>
        <span>${escapeHtml(pallet.palletName)} / ${escapeHtml(work.workNo)} / ${escapeHtml(work.operationId)}</span>
      </div>
      <label>
        <span>完成數</span>
        <input class="hmc-selected-qty" type="number" min="0" inputmode="numeric" value="${escapeHtml(hmcQuantities()[key] ?? (index === 0 ? "0" : ""))}" data-hmc-work-key="${escapeHtml(key)}">
      </label>
      <label class="hmc-check">
        <input class="hmc-selected-skip" type="checkbox" data-hmc-work-key="${escapeHtml(key)}" ${hmcSkipped()[key] ? "checked" : ""}>
        <span>缺料 / 跳過</span>
      </label>
    </article>
  `).join("");
}

function hmcNumberValue(selector) {
  const rawValue = ($(selector)?.value || "").trim();
  if (!rawValue) return 0;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : 0;
}

function updateHmcReportPreview() {
  const selected = hmcSelectedItems();
  const selectedPalletCount = new Set(selected.map((item) => item.pallet.palletId)).size;
  const totalQty = $$(".hmc-selected-qty").reduce((total, input) => total + (Number(input.value) || 0), 0);
  const skippedCount = $$(".hmc-selected-skip").filter((input) => input.checked).length;
  const preview = $("#hmcReportPreview");
  if (!preview) return;

  preview.innerHTML = `
    <div class="hmc-preview-grid">
      <span><b>模式</b><strong>${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong></span>
      <span><b>交換盤</b><strong>${escapeHtml(selectedPalletCount)}</strong></span>
      <span><b>已選工件</b><strong>${escapeHtml(selected.length)}</strong></span>
      <span><b>本次合計</b><strong>${escapeHtml(totalQty)}</strong></span>
      <span><b>缺料 / 跳過</b><strong>${escapeHtml(skippedCount)}</strong></span>
    </div>
    <p class="hmc-preview-warning">${totalQty > 0 ? "預覽已更新；目前只是畫面計算，不會送出。" : "請先輸入完成數量，預覽才會更新。"}</p>
    <p class="hmc-disabled-submit">尚未啟用送出</p>
  `;
}

function bindHmcReportEvents() {
  $("[data-hmc-back]")?.addEventListener("click", (event) => {
    event.preventDefault();
    const target = event.currentTarget?.getAttribute("href") || hmcReportDashboardBackUrl();
    window.location.href = target;
  });
  $("[data-hmc-toggle-setup]")?.addEventListener("click", () => {
    hmcReportState.setupOpen = !hmcReportState.setupOpen;
    renderHmcReportRoute();
  });
  $$("[data-hmc-shift]").forEach((button) => {
    button.addEventListener("click", () => {
      hmcReportState.shift = button.dataset.hmcShift === "night" ? "night" : "day";
      renderHmcReportRoute();
    });
  });
  $$("[data-hmc-pallet]").forEach((button) => {
    button.addEventListener("click", () => {
      const plan = hmcActivePlan();
      plan.activePalletId = button.dataset.hmcPallet || "P1";
      plan.workNo = selectedHmcPallet().works[0]?.workNo || "";
      renderHmcReportRoute();
    });
  });
  $("#hmcWorkSelect")?.addEventListener("change", (event) => {
    hmcActivePlan().workNo = event.target.value;
    hmcSelectedWorkKeys().add(hmcWorkKey(selectedHmcPallet().palletId, event.target.value));
    renderHmcReportRoute();
  });
  $$("[data-hmc-work-card]").forEach((button) => {
    button.addEventListener("click", () => {
      const plan = hmcActivePlan();
      const palletId = button.dataset.hmcPalletWork || plan.activePalletId || "P1";
      const pallet = activeHmcReportPallets().find((item) => item.palletId === palletId) || selectedHmcPallet();
      const workNo = button.dataset.hmcWorkCard || pallet.works[0]?.workNo || "";
      const key = hmcWorkKey(pallet.palletId, workNo);
      plan.activePalletId = pallet.palletId;
      plan.workNo = workNo;
      if (hmcSelectedWorkKeys().has(key)) {
        hmcSelectedWorkKeys().delete(key);
        delete hmcQuantities()[key];
        delete hmcSkipped()[key];
      } else {
        hmcSelectedWorkKeys().add(key);
      }
      hmcEnsureSelectedWork();
      renderHmcReportRoute();
    });
  });
  ["#hmcDayQty", "#hmcHandoverNote"].forEach((selector) => {
    $(selector)?.addEventListener("input", updateHmcReportPreview);
  });
  $$(".hmc-selected-qty").forEach((field) => {
    field.addEventListener("input", () => {
      hmcQuantities()[field.dataset.hmcWorkKey] = field.value;
      updateHmcReportPreview();
    });
  });
  $$(".hmc-selected-skip").forEach((field) => {
    field.addEventListener("change", () => {
      hmcSkipped()[field.dataset.hmcWorkKey] = field.checked;
      updateHmcReportPreview();
    });
  });
}

function hmcWorklistSetupGroups() {
  const selected = hmcSelectedItems();
  return activeHmcReportPallets()
    .map((pallet) => ({
      pallet,
      items: selected.filter((item) => item.pallet.palletId === pallet.palletId),
    }))
    .filter((group) => group.items.length);
}

// ---- Setup editor v2 draft (2026-07-12): the setup page edits its OWN deep
// copy of the current worklist so pallets/works can be added/edited/removed
// without polluting the DB read cache or the report page's shared plan. ----

const hmcSetupDraftState = {
  key: "",
  workDate: "",
  pallets: [],
  editTarget: null,
  deleteConfirmPalletId: "",
  message: "",
  dirty: false,
  seedStatus: "",
};

function hmcSetupDraftMarkDirty() {
  hmcSetupDraftState.dirty = true;
}

function hmcSetupDraft() {
  const key = `${hmcRouteMachineKey()}|${hmcReportState.shift}`;
  const readStatus = hmcCurrentWorklistReadState().status;
  // Re-seed on machine/shift change, or when the DB worklist arrives after we
  // seeded from the fallback template and the user hasn't edited anything yet.
  const needReseed = hmcSetupDraftState.key !== key
    || (!hmcSetupDraftState.dirty && readStatus === "ok" && hmcSetupDraftState.seedStatus !== "ok");
  if (needReseed) {
    hmcSetupDraftState.key = key;
    hmcSetupDraftState.dirty = false;
    hmcSetupDraftState.seedStatus = readStatus;
    hmcSetupDraftState.workDate = hmcTodayDateIso();
    hmcSetupDraftState.editTarget = null;
    hmcSetupDraftState.deleteConfirmPalletId = "";
    hmcSetupDraftState.message = "";
    hmcSetupDraftState.pallets = activeHmcReportPallets().map((pallet, index) => ({
      palletId: pallet.palletId || `P${index + 1}`,
      palletNo: Number(pallet.palletNo) || index + 1,
      setupName: pallet.setupName || pallet.fixtureName || "未設定治具",
      works: (Array.isArray(pallet.works) ? pallet.works : []).map((work) => ({
        workNo: work.workNo || "",
        partName: work.partName || "",
        plannedQty: hmcNonNegativeInteger(work.plannedQty, 0),
        completedQty: hmcNonNegativeInteger(work.completedQty, 0),
        remainingQty: hmcNonNegativeInteger(work.remainingQty, Math.max(0, hmcNonNegativeInteger(work.plannedQty, 0) - hmcNonNegativeInteger(work.completedQty, 0))),
        operationId: work.operationId || "",
        operationName: work.operationName || "",
        materialStatus: ["ready", "missing", "unknown"].includes(work.materialStatus) ? work.materialStatus : "ready",
        included: true,
      })),
    }));
  }
  return hmcSetupDraftState;
}

function hmcSetupDraftPallet(palletId) {
  return hmcSetupDraft().pallets.find((pallet) => pallet.palletId === palletId) || null;
}

// 工單選擇器（2026-07-12）：班前清單的工單號欄輸入時，從工單管理（work_orders）
// 帶出建議，點選自動填工單號＋品名＋預計數量；查無工單仍可手動輸入。
const hmcWorkOrderPickerState = { status: "idle", rows: [] };

async function hmcLoadWorkOrderSuggestions() {
  if (hmcWorkOrderPickerState.status === "loading" || hmcWorkOrderPickerState.status === "ok") return;
  if (!canReadHmcWorklistFromSupabase()) {
    hmcWorkOrderPickerState.status = "unavailable";
    return;
  }
  hmcWorkOrderPickerState.status = "loading";
  try {
    const rows = await supabaseFetch("work_orders?select=work_order_no,part_no,part_name,quantity&order=created_at.desc&limit=100");
    hmcWorkOrderPickerState.rows = Array.isArray(rows) ? rows : [];
    hmcWorkOrderPickerState.status = "ok";
  } catch (error) {
    hmcWorkOrderPickerState.status = "error";
    hmcWorkOrderPickerState.rows = [];
  }
}

function hmcRenderWorkOrderSuggestions(palletId, query) {
  const box = $(`[data-hmc-wo-suggest="${palletId}"]`);
  if (!box) return;
  const term = (query || "").trim().toLowerCase();
  if (hmcWorkOrderPickerState.status === "loading") {
    box.innerHTML = '<p class="hmc-wo-suggest-note">正在載入工單清單...</p>';
    return;
  }
  if (hmcWorkOrderPickerState.status === "error") {
    box.innerHTML = '<p class="hmc-wo-suggest-note">工單清單載入失敗；仍可手動輸入，或重新整理再試。</p>';
    return;
  }
  if (hmcWorkOrderPickerState.status !== "ok") {
    box.innerHTML = "";
    return;
  }
  if (hmcWorkOrderPickerState.status === "ok" && !hmcWorkOrderPickerState.rows.length) {
    box.innerHTML = '<p class="hmc-wo-suggest-note">工單管理（管理 → 建單／指派機台）還沒有工單；可先手動輸入。</p>';
    return;
  }
  const matches = (term
    ? hmcWorkOrderPickerState.rows.filter((row) => `${row.work_order_no || ""} ${row.part_name || ""} ${row.part_no || ""}`.toLowerCase().includes(term))
    : hmcWorkOrderPickerState.rows
  ).slice(0, 8);
  box.innerHTML = matches.length
    ? `${term ? "" : '<p class="hmc-wo-suggest-note">最近的工單（輸入可搜尋）：</p>'}` + matches.map((row) => `
        <button type="button" class="hmc-wo-suggest-item" data-hmc-wo-pick="${escapeHtml(palletId)}" data-wo-no="${escapeHtml(row.work_order_no || "")}" data-wo-part="${escapeHtml(row.part_name || row.part_no || "")}" data-wo-qty="${escapeHtml(row.quantity ?? "")}">
          <strong>${escapeHtml(row.work_order_no || "")}</strong>
          <span>${escapeHtml(row.part_name || row.part_no || "-")}</span>
          <em>${row.quantity != null ? `${escapeHtml(row.quantity)} 件` : ""}</em>
        </button>
      `).join("")
    : '<p class="hmc-wo-suggest-note">工單管理裡找不到；可直接手動輸入。</p>';
}

function hmcSetupDraftSelectedGroups() {
  return hmcSetupDraft().pallets
    .map((pallet) => ({ pallet, works: pallet.works.filter((work) => work.included) }))
    .filter((group) => group.works.length);
}

function hmcWorklistSetupSummary() {
  const groups = hmcSetupDraftSelectedGroups();
  const selectedCount = groups.reduce((total, group) => total + group.works.length, 0);
  return `
    <section class="hmc-report-card hmc-setup-summary-card" aria-label="HMC setup selected worklist">
      <div class="hmc-selected-summary-head">
        <div>
          <span>本班加工清單草稿</span>
          <strong>${selectedCount} 件 / ${groups.length} 盤</strong>
        </div>
        <em>畫面內暫存；按「儲存草稿」後才會寫入資料庫。</em>
      </div>
      ${groups.length ? groups.map((group, index) => `
        <div class="hmc-selected-group">
          <strong>第 ${escapeHtml(index + 1)} 盤 · ${escapeHtml(group.pallet.setupName)}</strong>
          <div>
            ${group.works.map((work) => `<span>${escapeHtml(work.workNo)} · ${escapeHtml(work.partName)}</span>`).join("")}
          </div>
        </div>
      `).join("") : `<p>尚未有納入的工件；在下方新增或勾選工件後再儲存。</p>`}
    </section>
  `;
}

function hmcWorklistSetupPalletEditor() {
  const draft = hmcSetupDraft();
  const editTarget = draft.editTarget;
  return `
    <section class="hmc-report-card hmc-setup-editor-card" aria-label="HMC setup pallet editor">
      <div class="hmc-night-head">
        <div>
          <strong>交換盤與工件清單</strong>
          <span>點工件卡＝納入／排除本班清單；✎ 編輯、✕ 移除；下方可手動新增工件。</span>
        </div>
      </div>
      ${draft.message ? `<p class="hmc-draft-cancel-error">${escapeHtml(draft.message)}</p>` : ""}
      <div class="hmc-setup-pallet-editor">
        ${draft.pallets.map((pallet, palletIndex) => {
          const editing = editTarget && editTarget.palletId === pallet.palletId
            ? pallet.works.find((work) => work.workNo === editTarget.workNo)
            : null;
          return `
          <article class="hmc-setup-pallet-row">
            <div class="hmc-setup-pallet-head">
              <span>第 ${escapeHtml(palletIndex + 1)} 盤</span>
              <input type="text" class="hmc-pallet-name-input" value="${escapeHtml(pallet.setupName)}" maxlength="60" aria-label="治具名稱" data-hmc-pallet-name="${escapeHtml(pallet.palletId)}">
              <button type="button" class="hmc-link-button is-danger" data-hmc-del-pallet="${escapeHtml(pallet.palletId)}">${draft.deleteConfirmPalletId === pallet.palletId ? "確認刪除此盤？" : "刪除盤"}</button>
            </div>
            <div class="hmc-setup-work-list">
              ${pallet.works.map((work, workIndex) => `
                <button type="button" class="hmc-setup-work-chip ${work.included ? "is-selected" : ""}" data-hmc-chip="${escapeHtml(pallet.palletId)}::${escapeHtml(work.workNo)}" aria-pressed="${work.included ? "true" : "false"}">
                  <span>${escapeHtml(hmcWorkLetter(workIndex))}</span>
                  <strong>${escapeHtml(work.partName)}</strong>
                  <em>${escapeHtml(work.workNo)}</em>
                  <small>預計 ${escapeHtml(work.plannedQty)} · 已完成 ${escapeHtml(work.completedQty)}</small>
                  <span class="hmc-chip-tools">
                    <span data-chip-edit role="button" aria-label="編輯工件">✎</span>
                    <span data-chip-del role="button" aria-label="移除工件">✕</span>
                  </span>
                </button>
              `).join("") || '<p class="empty-note">此盤還沒有工件，用下方表單新增。</p>'}
            </div>
            <div class="hmc-setup-add-form">
              <input type="text" placeholder="工單號（點選可挑工單）" maxlength="60" value="${editing ? escapeHtml(editing.workNo) : ""}" data-hmc-form-workno="${escapeHtml(pallet.palletId)}">
              <input type="text" placeholder="工件名" maxlength="60" value="${editing ? escapeHtml(editing.partName) : ""}" data-hmc-form-partname="${escapeHtml(pallet.palletId)}">
              <input type="number" min="0" inputmode="numeric" placeholder="預計數量" value="${editing ? escapeHtml(editing.plannedQty) : ""}" data-hmc-form-qty="${escapeHtml(pallet.palletId)}">
              <button type="button" data-hmc-form-submit="${escapeHtml(pallet.palletId)}">${editing ? "更新工件" : "＋ 加入工件"}</button>
              ${editing ? `<button type="button" class="hmc-link-button" data-hmc-form-cancel="1">取消編輯</button>` : ""}
            </div>
            <div class="hmc-wo-suggest" data-hmc-wo-suggest="${escapeHtml(pallet.palletId)}"></div>
          </article>
        `;
        }).join("")}
      </div>
      <button type="button" class="hmc-secondary-action hmc-setup-add-pallet" data-hmc-add-pallet>＋ 新增交換盤</button>
    </section>
  `;
}

// In dev-nologin mode this is the anon write path (Dev `*_no_login_dev` RPC
// variants). In strict mode supabaseHeaders() swaps the Bearer to the signed-in
// session, so the same call sites hit the strict production bodies with a real
// actor — no per-surface fetcher needed (Gate P / P2 GlobalLoginGate).
async function hmcDevAnonRpcFetch(functionName, body) {
  if (!canReadHmcWorklistFromSupabase()) {
    throw new Error("尚未完成連線設定，無法儲存。");
  }
  const baseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "return=representation",
    },
    body: JSON.stringify(body || {}),
  });

  const responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    payload = { message: responseText };
  }

  if (!response.ok) {
    if (response.status === 401) machtileHandleUnauthorized();
    const mapped = machtileStrictErrorMessage(payload.code);
    if (mapped) {
      const error = new Error(mapped);
      error.code = payload.code;
      throw error;
    }
    throw new Error(payload.message || `${response.status} ${responseText}`);
  }

  if (payload?.status === "error") {
    const error = new Error(machtileStrictErrorMessage(payload.code) || payload.message || "伺服器回傳錯誤。");
    error.code = payload.code || "";
    throw error;
  }

  return payload;
}

function hmcTodayDateIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function hmcNonNegativeInteger(value, fallback = 0) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return fallback;
  return Math.floor(numberValue);
}

function hmcBuildSetupWorklistPayload() {
  const groups = hmcSetupDraftSelectedGroups();
  if (!groups.length) {
    throw new Error("請至少納入一件工件再儲存。");
  }

  const pallets = groups.map((group, index) => ({
    clientId: group.pallet.palletId || `P${index + 1}`,
    palletNo: index + 1,
    fixtureCode: group.pallet.palletId || `P${index + 1}`,
    fixtureName: group.pallet.setupName || "",
    status: "active",
    sortOrder: index + 1,
    note: "",
  }));

  const items = groups.flatMap((group, groupIndex) => {
    const palletNo = groupIndex + 1;
    return group.works.map((work, workIndex) => ({
      clientId: `${group.pallet.palletId}::${work.workNo}`,
      palletClientId: group.pallet.palletId || `P${palletNo}`,
      palletNo,
      positionCode: hmcWorkLetter(workIndex),
      workpieceName: work.partName || work.workNo,
      workOrderId: work.workNo,
      workOrderNo: work.workNo,
      operationId: work.operationId || "",
      operationName: work.operationName || "",
      partNo: work.partName || "",
      plannedQty: hmcNonNegativeInteger(work.plannedQty, 0),
      completedQtyBefore: hmcNonNegativeInteger(work.completedQty, 0),
      remainingQtySnapshot: hmcNonNegativeInteger(work.remainingQty, 0),
      materialStatus: work.materialStatus || "ready",
      status: "active",
      sortOrder: workIndex + 1,
      note: "",
    }));
  });

  return {
    worklist: {
      machineId: hmcRouteMachineKey(),
      machineCode: hmcRouteMachineKey(),
      shiftScope: hmcReportState.shift === "night" ? "night" : "day",
      workDateStart: hmcSetupDraft().workDate || hmcTodayDateIso(),
      workDateEnd: null,
      sourceType: "planner_setup_ui",
      note: "由 MachTile 班前設定頁建立",
    },
    pallets,
    items,
  };
}

async function hmcSaveWorklistDraft() {
  const payload = hmcBuildSetupWorklistPayload();
  return hmcDevAnonRpcFetch("save_hmc_worklist_draft", { payload });
}

async function hmcActivateWorklist(worklistId) {
  if (!worklistId) throw new Error("請先儲存草稿，再啟用清單。");
  return hmcDevAnonRpcFetch("activate_hmc_worklist", { p_worklist_id: worklistId });
}

async function hmcReplaceActiveWorklist(worklistId, confirmReplace) {
  if (!worklistId) throw new Error("請先儲存草稿，再取代啟用清單。");
  return hmcDevAnonRpcFetch("replace_active_hmc_worklist", {
    p_worklist_id: worklistId,
    p_confirm_replace: Boolean(confirmReplace),
  });
}

function hmcRenderSetupDevNoLoginNotice() {
  if (!canReadHmcWorklistFromSupabase()) {
    return `
      <section class="hmc-report-card hmc-setup-nologin-notice" aria-label="HMC setup Dev config unavailable">
        <strong>連線設定未完成</strong>
        <p>需要完成資料庫連線設定，才能儲存或啟用班前清單。</p>
      </section>
    `;
  }
  if (machtileStrictMode()) {
    return `
      <section class="hmc-safe-banner is-quiet" aria-label="HMC setup strict auth boundary">
        <span>已以 ${escapeHtml(machtileAccountDisplay(machtileAuthState.email) || "登入帳號")} 登入 · 儲存 / 啟用 / 取代需要排程或主管權限，寫入會記錄操作人</span>
      </section>
    `;
  }
  return `
    <section class="hmc-safe-banner is-quiet" aria-label="HMC setup Dev no-login boundary">
      <span>Dev 免登入 · 以匿名身分寫入 Dev DB（正式環境需 planner 登入與審計）</span>
    </section>
  `;
}

function hmcRenderSetupActiveWorklistNotice() {
  const readState = hmcSetupActiveWorklistReadState();
  const shiftLabel = hmcShiftLabel(hmcReportState.shift);

  if (readState.status === "ok") {
    return `
      <section class="hmc-report-card hmc-setup-active-warning" aria-label="Existing active HMC worklist">
        <div>
          <span>已有啟用清單</span>
          <strong>目前 ${escapeHtml(shiftLabel)} 已有啟用中的加工清單</strong>
          <p>不可重複啟用同機台、同班別的加工清單。如需更換清單，請用下方「取代目前啟用清單」。</p>
        </div>
        <dl>
          <div><dt>清單編號</dt><dd>${escapeHtml(readState.worklist?.id || "-")}</dd></div>
          <div><dt>交換盤</dt><dd>${escapeHtml(readState.pallets?.length || 0)}</dd></div>
          <div><dt>工件</dt><dd>${escapeHtml(readState.items?.length || 0)}</dd></div>
        </dl>
      </section>
    `;
  }

  if (readState.status === "conflict") {
    return `
      <section class="hmc-report-card hmc-setup-active-warning is-conflict" aria-label="Conflicting active HMC worklists">
        <div>
          <span>清單狀態衝突</span>
          <strong>偵測到多筆啟用中的 ${escapeHtml(shiftLabel)} 加工清單</strong>
          <p>${escapeHtml(readState.message || "請先處理重複的啟用清單，再啟用新的加工清單。")}</p>
        </div>
      </section>
    `;
  }

  if (readState.status === "loading") {
    return `
      <section class="hmc-report-card hmc-setup-active-status" aria-label="Checking active HMC worklist">
        <strong>正在確認是否已有啟用清單...</strong>
        <p>啟用前會檢查同機台、同班別是否已有啟用中的清單。</p>
      </section>
    `;
  }

  if (readState.status === "not_found") {
    return `
      <section class="hmc-report-card hmc-setup-active-status is-clear" aria-label="No active HMC worklist">
        <strong>目前 ${escapeHtml(shiftLabel)} 沒有啟用中的加工清單</strong>
        <p>可先儲存草稿，再啟用為本班加工清單。</p>
      </section>
    `;
  }

  return "";
}

function hmcRenderSetupWriteStatus() {
  if (hmcSetupWriteState.status === "idle") {
    return `<p>儲存草稿後即可啟用為本班加工清單；此頁只管理班前清單，不會產生報工、不同步 SoftNet。</p>`;
  }
  const statusLabel = {
    saving: "儲存草稿中...",
    activating: "啟用清單中...",
    saved: "草稿已儲存",
    active: "本班清單已啟用",
    error: "操作失敗",
  }[hmcSetupWriteState.status] || hmcSetupWriteState.status;
  return `
    <div class="hmc-setup-write-status ${hmcSetupWriteState.status === "error" ? "is-error" : "is-ok"}">
      <strong>${escapeHtml(statusLabel)}</strong>
      <span>${escapeHtml(hmcSetupWriteState.message || hmcSetupWriteState.code || "-")}</span>
      ${hmcSetupWriteState.worklistId ? `<small>清單編號：${escapeHtml(hmcSetupWriteState.worklistId)}</small>` : ""}
      ${hmcSetupWriteState.palletCount || hmcSetupWriteState.itemCount ? `<small>${escapeHtml(hmcSetupWriteState.palletCount)} 盤 / ${escapeHtml(hmcSetupWriteState.itemCount)} 件工件</small>` : ""}
    </div>
  `;
}

function hmcRenderSetupReplaceStatus() {
  if (hmcSetupReplaceState.status === "idle") return "";
  const isError = hmcSetupReplaceState.status === "error";
  const statusLabel = {
    replacing: "正在取代啟用清單...",
    success: "已取代啟用清單",
    error: "取代失敗",
  }[hmcSetupReplaceState.status] || hmcSetupReplaceState.status;
  return `
    <div class="hmc-setup-replace-status ${isError ? "is-error" : "is-ok"}">
      <strong>${escapeHtml(statusLabel)}</strong>
      <span>${escapeHtml(hmcSetupReplaceState.message || hmcSetupReplaceState.code || "-")}</span>
      ${hmcSetupReplaceState.oldWorklistId ? `<small>原啟用清單：${escapeHtml(hmcSetupReplaceState.oldWorklistId)}</small>` : ""}
      ${hmcSetupReplaceState.newWorklistId ? `<small>新啟用清單：${escapeHtml(hmcSetupReplaceState.newWorklistId)}</small>` : ""}
    </div>
  `;
}

function hmcRenderReplaceActiveWorklistPanel() {
  const readState = hmcSetupActiveWorklistReadState();
  const hasDraft = Boolean(hmcSetupWriteState.worklistId);
  const busy = ["saving", "activating"].includes(hmcSetupWriteState.status) || hmcSetupReplaceState.status === "replacing";
  const activeWorklistId = readState.worklist?.id || "";
  const isDifferentDraft = hasDraft && (!activeWorklistId || activeWorklistId !== hmcSetupWriteState.worklistId);
  const canShowReplace = isDifferentDraft && readState.status === "ok";

  if (!canShowReplace && hmcSetupReplaceState.status === "idle") return "";

  const finalEnabled = canShowReplace && hmcSetupReplaceState.open && hmcSetupReplaceState.confirmed && !busy;
  const openEnabled = canShowReplace && !busy;

  return `
    <section class="hmc-setup-replace-panel ${hmcSetupReplaceState.open ? "is-open" : ""}" aria-label="Replace active HMC worklist">
      <div class="hmc-setup-replace-copy">
        <span>需要更換本班清單</span>
        <strong>取代目前啟用清單</strong>
        <p>這是主管/排程人員的${machtileStrictMode() ? "" : " Dev-only"} 動作。舊清單會標記為已取代，新草稿會成為啟用清單；現場報工仍不會送出。</p>
        ${activeWorklistId ? `<small>目前啟用清單：${escapeHtml(activeWorklistId)}</small>` : ""}
        ${hmcSetupWriteState.worklistId ? `<small>準備啟用草稿：${escapeHtml(hmcSetupWriteState.worklistId)}</small>` : ""}
      </div>
      ${hmcRenderSetupReplaceStatus()}
      ${!hmcSetupReplaceState.open ? `
        <button type="button" class="hmc-setup-replace-open" data-hmc-open-replace-active ${openEnabled ? "" : "disabled aria-disabled=\"true\""}>取代目前啟用清單</button>
      ` : `
        <div class="hmc-setup-replace-confirm">
          <strong>確認取代啟用清單</strong>
          <p>這會把目前同機台、同班別的啟用清單標記為已取代，並把這份草稿設為新的啟用清單。舊清單不會刪除，但現場會改讀新的啟用清單。</p>
          <label>
            <input type="checkbox" data-hmc-confirm-replace-active ${hmcSetupReplaceState.confirmed ? "checked" : ""}>
            <span>我了解：舊清單會標記為已取代，新清單會成為啟用清單。</span>
          </label>
          <div class="hmc-setup-replace-actions">
            <button type="button" data-hmc-cancel-replace-active>取消</button>
            <button type="button" class="hmc-setup-replace-danger" data-hmc-replace-active-worklist ${finalEnabled ? "" : "disabled aria-disabled=\"true\""}>${hmcSetupReplaceState.status === "replacing" ? "正在取代..." : "確認取代"}</button>
          </div>
        </div>
      `}
    </section>
  `;
}

function hmcRenderSetupWriteControls() {
  const busy = ["saving", "activating"].includes(hmcSetupWriteState.status) || hmcSetupReplaceState.status === "replacing";
  const activateBlocked = hmcSetupActiveWorklistBlocksActivation();
  const canActivate = hmcSetupWriteState.worklistId && !busy && !activateBlocked;
  return `
    <section class="hmc-submit-panel hmc-setup-action-panel">
      <strong>儲存與啟用</strong>
      ${hmcRenderSetupWriteStatus()}
      ${activateBlocked ? `<p class="hmc-setup-active-block-note">目前同機台、同班別已有啟用清單；如需更換，請用下方「取代目前啟用清單」。</p>` : ""}
      <div class="hmc-setup-disabled-actions">
        <button type="button" data-hmc-save-draft ${!busy ? "" : "disabled aria-disabled=\"true\""}>${busy && hmcSetupWriteState.status === "saving" ? "儲存中..." : "儲存草稿"}</button>
        <button type="button" data-hmc-activate-worklist ${canActivate ? "" : "disabled aria-disabled=\"true\""}>${busy && hmcSetupWriteState.status === "activating" ? "啟用中..." : "啟用本班清單"}</button>
      </div>
      ${hmcRenderReplaceActiveWorklistPanel()}
    </section>
  `;
}

function renderHmcGuideRoute() {
  document.body.classList.remove("station-select-route-mode");
  document.body.classList.remove("work-list-route-mode");
  document.body.classList.remove("work-detail-route-mode");
  document.body.classList.remove("report-work-route-mode");
  document.body.classList.add("hmc-report-route-mode");

  const stationSelectRoot = $("#stationSelectRoute");
  if (stationSelectRoot) stationSelectRoot.hidden = true;
  const workListRoot = $("#workListRoute");
  if (workListRoot) workListRoot.hidden = true;
  const workDetailRoot = $("#workDetailRoute");
  if (workDetailRoot) workDetailRoot.hidden = true;
  const reportWorkRoot = $("#reportWorkRoute");
  if (reportWorkRoot) reportWorkRoot.hidden = true;
  const reviewRoot = $("#hmcDailyCheckReviewRoute");
  if (reviewRoot) reviewRoot.hidden = true;

  let routeRoot = $("#hmcReportRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "hmcReportRoute";
    routeRoot.setAttribute("role", "main");
    document.body.appendChild(routeRoot);
  }
  routeRoot.className = "hmc-report-route hmc-guide-route";
  routeRoot.setAttribute("aria-labelledby", "hmcGuideTitle");
  routeRoot.hidden = false;

  initializeHmcReportState();
  const machineLabel = hmcRouteMachineLabel();
  const shift = hmcReportState.shift;
  const steps = [
    {
      no: 1,
      title: "班前清單設定",
      who: "排程 / 主管",
      url: hmcWorklistSetupRouteUrl(machineLabel, shift),
      linkText: "前往班前清單設定",
      what: "建立本班的交換盤與工件清單：儲存草稿，再啟用為本班清單。",
      then: "沒有啟用清單，現場就沒有東西可填。每班開工前要建立或取代當班清單——盤點的日期跟著清單走，沿用舊清單會把數字記到舊日期。",
    },
    {
      no: 2,
      title: "每日盤點",
      who: "作業員（站別帳號）",
      url: hmcReportRouteUrl(machineLabel),
      linkText: "前往每日盤點",
      what: "選班別，對每個工件填「本日完成、本日不良」，缺料或跳過就勾選，然後儲存。",
      then: "儲存後為待複核；主管確認前不是正式報工。",
    },
    {
      no: 3,
      title: "主管複核",
      who: "主管以上",
      url: hmcDailyCheckReviewUrl({ status: "pending_review" }),
      linkText: "前往每日盤點複核",
      what: "逐筆確認或退回作業員送出的盤點；退回需填原因。",
      then: "退回的項目回到作業員，修正後重新送審；確認的項目才能進下一步。確認後才發現錯的，也可以按「退回修正」退回去改（已轉入報表的要先修訂重發）。數字都沒問題時，可用「一鍵確認並發行」直接完成步驟 3～5。",
    },
    {
      no: 4,
      title: "轉正式報表草稿",
      who: "主管以上",
      url: hmcFormalReportDraftsUrl(),
      linkText: "前往草稿清單",
      what: "把已確認的每日盤點建立成正式報表草稿；草稿唯讀。",
      then: "草稿可取消（填原因、留痕）；來源盤點會釋回可重新建立。",
    },
    {
      no: 5,
      title: "確認發行",
      who: "主管以上",
      url: hmcFormalReportsUrl(),
      linkText: "前往正式報表",
      what: "草稿檢查無誤後按「確認發行」，成為正式報表。",
      then: "發行後不可修改、僅供查閱。發現錯誤可用正式報表頁的「修訂重發」：舊版作廢留痕，新版自動編下一號。",
    },
  ];

  routeRoot.innerHTML = `
    <section class="hmc-report-shell">
      <header class="hmc-report-hero">
        <div>
          <p class="eyebrow">臥式加工中心 · ${escapeHtml(machineLabel)}</p>
          <h1 id="hmcGuideTitle">使用說明 · 多盤多工件報工</h1>
          <p>五個步驟：填 → 送審 → 主管確認 → 轉草稿 → 發行。主管確認前都不是正式數字。</p>
        </div>
        <div class="hmc-report-hero-actions">
          <a href="${escapeHtml(hmcReportRouteUrl(machineLabel))}" data-hmc-guide-back>返回上一頁</a>
        </div>
      </header>

      ${steps.map((step) => `
        <section class="hmc-report-card hmc-guide-step" aria-label="步驟 ${step.no}">
          <strong>步驟 ${step.no}｜${escapeHtml(step.title)} <small>（${escapeHtml(step.who)}）</small></strong>
          <p>${escapeHtml(step.what)}</p>
          <p><b>做完會怎樣：</b>${escapeHtml(step.then)}</p>
          <p><a class="hmc-secondary-action" href="${escapeHtml(step.url)}">${escapeHtml(step.linkText)}</a></p>
        </section>
      `).join("")}

      <section class="hmc-report-card" aria-label="角色權限對照">
        <strong>誰可以做什麼</strong>
        <p>作業員（站別帳號）：填每日盤點、修正退回項目。</p>
        <p>排程 / 主管：班前清單的儲存、啟用、取代。</p>
        <p>主管以上：複核確認 / 退回、轉草稿、發行、作廢。</p>
      </section>

      <section class="hmc-report-card" aria-label="基本原則">
        <strong>基本原則</strong>
        <p>主管確認前不是正式報工；發行後才是正式報表。每一層都有退路：送審前直接改、送審後駁回、確認後退回修正、發行後修訂重發——所有取消、退回、作廢都要填原因並留痕，舊版本永遠查得到。此流程不同步 SoftNet。</p>
      </section>
    </section>
  `;

  $("[data-hmc-guide-back]")?.addEventListener("click", (event) => {
    if (window.history.length > 1) {
      event.preventDefault();
      window.history.back();
    }
  });
}

function renderHmcWorklistSetupRoute() {
  document.body.classList.remove("station-select-route-mode");
  document.body.classList.remove("work-list-route-mode");
  document.body.classList.remove("work-detail-route-mode");
  document.body.classList.remove("report-work-route-mode");
  document.body.classList.add("hmc-report-route-mode");

  const stationSelectRoot = $("#stationSelectRoute");
  if (stationSelectRoot) stationSelectRoot.hidden = true;
  const workListRoot = $("#workListRoute");
  if (workListRoot) workListRoot.hidden = true;
  const workDetailRoot = $("#workDetailRoute");
  if (workDetailRoot) workDetailRoot.hidden = true;
  const reportWorkRoot = $("#reportWorkRoute");
  if (reportWorkRoot) reportWorkRoot.hidden = true;
  const reviewRoot = $("#hmcDailyCheckReviewRoute");
  if (reviewRoot) reviewRoot.hidden = true;

  let routeRoot = $("#hmcReportRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "hmcReportRoute";
    routeRoot.setAttribute("role", "main");
    document.body.appendChild(routeRoot);
  }
  routeRoot.className = "hmc-report-route hmc-setup-route";
  routeRoot.setAttribute("aria-labelledby", "hmcSetupTitle");
  routeRoot.hidden = false;

  initializeHmcReportState();
  requestHmcSetupActiveWorklistRead();
  const isNight = hmcReportState.shift === "night";
  const machineLabel = hmcRouteMachineLabel();
  const reportBackUrl = hmcSetupBackToReportUrl(machineLabel, hmcReportState.shift);

  routeRoot.innerHTML = `
    <section class="hmc-report-shell">
      <header class="hmc-report-hero">
        <div>
          <p class="eyebrow">臥式加工中心 · ${escapeHtml(machineLabel)}</p>
          <h1 id="hmcSetupTitle">HMC 班前加工清單設定</h1>
          <p>主管或排程人員在班前建立本班交換盤與工件清單；儲存草稿並啟用後，現場才能填每日盤點。</p>
        </div>
        <div class="hmc-report-hero-actions">
          <a class="hmc-secondary-action" href="${escapeHtml(hmcGuideRouteUrl(machineLabel, hmcReportState.shift))}">使用說明</a>
          <a class="hmc-secondary-action" href="${escapeHtml(reportBackUrl)}">查看現場報工</a>
          <a href="${escapeHtml(reportBackUrl)}" data-hmc-setup-back>返回上一頁</a>
        </div>
      </header>

      <section class="hmc-safe-banner is-quiet" aria-label="HMC setup write boundary">
        <span>${machtileStrictMode() ? "班前清單設定（正式環境）· 需登入（排程 / 主管）" : "班前清單設定（Dev）· 免登入"} · 只寫班前清單，不會產生報工</span>
      </section>

      <section class="hmc-report-card hmc-setup-control-card" aria-label="HMC setup controls">
        <div class="hmc-setup-control-grid">
          <label class="hmc-field">
            <span>機台</span>
            <select data-hmc-setup-machine>
              ${baseMachines.filter((machine) => isHmcMachine(machine)).map((machine) => `<option value="${escapeHtml(machine.name)}" ${machine.name === machineLabel ? "selected" : ""}>${escapeHtml(machine.name)}</option>`).join("")}
            </select>
          </label>
          <label class="hmc-field">
            <span>清單日期</span>
            <input type="date" value="${escapeHtml(hmcSetupDraft().workDate || hmcTodayDateIso())}" data-hmc-setup-date>
          </label>
          <div class="hmc-field">
            <span>班別</span>
            <div class="hmc-shift-tabs hmc-shift-tabs-inline" role="tablist" aria-label="HMC setup shift mode">
              <button type="button" class="hmc-shift-day ${!isNight ? "is-active" : ""}" data-hmc-setup-shift="day">
                <strong>白班</strong>
                <span>自選工件</span>
              </button>
              <button type="button" class="hmc-shift-night ${isNight ? "is-active" : ""}" data-hmc-setup-shift="night">
                <strong>夜班</strong>
                <span>批次工件</span>
              </button>
            </div>
          </div>
        </div>
        <p>白班與夜班各自保留畫面草稿；尚未儲存的內容重新整理後不會保留，請記得儲存草稿。</p>
      </section>

      <div class="hmc-setup-split">
        <div class="hmc-setup-split-side">${hmcWorklistSetupSummary()}</div>
        <div class="hmc-setup-split-main">${hmcWorklistSetupPalletEditor()}</div>
      </div>

      ${hmcRenderSetupActiveWorklistNotice()}
      ${hmcRenderSetupDevNoLoginNotice()}
      ${hmcRenderSetupWriteControls()}
    </section>
  `;

  bindHmcWorklistSetupEvents();
}

function bindHmcWorklistSetupEvents() {
  $("[data-hmc-setup-back]")?.addEventListener("click", (event) => {
    event.preventDefault();
    const target = event.currentTarget?.getAttribute("href") || hmcSetupBackToReportUrl();
    window.location.href = target;
  });
  $("[data-hmc-save-draft]")?.addEventListener("click", async () => {
    hmcSetupWriteState.status = "saving";
    hmcSetupWriteState.code = "";
    hmcSetupWriteState.message = "";
    resetHmcSetupReplaceState();
    renderHmcWorklistSetupRoute();
    try {
      const result = await hmcSaveWorklistDraft();
      hmcSetupWriteState.status = "saved";
      hmcSetupWriteState.worklistId = result.worklistId || "";
      hmcSetupWriteState.worklistStatus = result.worklistStatus || "draft";
      hmcSetupWriteState.palletCount = Number(result.palletCount || 0);
      hmcSetupWriteState.itemCount = Number(result.itemCount || 0);
      hmcSetupWriteState.message = result.message || "HMC worklist draft saved.";
      showToast("HMC worklist draft saved");
    } catch (error) {
      hmcSetupWriteState.status = "error";
      hmcSetupWriteState.code = error?.code || "";
      hmcSetupWriteState.message = error?.message || "草稿儲存失敗。";
    }
    renderHmcWorklistSetupRoute();
  });
  $("[data-hmc-activate-worklist]")?.addEventListener("click", async () => {
    const worklistId = hmcSetupWriteState.worklistId;
    hmcSetupWriteState.status = "activating";
    hmcSetupWriteState.code = "";
    hmcSetupWriteState.message = "";
    renderHmcWorklistSetupRoute();
    try {
      const result = await hmcActivateWorklist(worklistId);
      hmcSetupWriteState.status = "active";
      hmcSetupWriteState.worklistStatus = result.worklistStatus || "active";
      hmcSetupWriteState.palletCount = Number(result.palletCount || hmcSetupWriteState.palletCount || 0);
      hmcSetupWriteState.itemCount = Number(result.itemCount || hmcSetupWriteState.itemCount || 0);
      hmcSetupWriteState.message = result.message || "HMC worklist activated.";
      showToast("HMC worklist activated");
    } catch (error) {
      hmcSetupWriteState.status = "error";
      hmcSetupWriteState.code = error?.code || "";
      hmcSetupWriteState.message = error?.message || "清單啟用失敗。";
    }
    renderHmcWorklistSetupRoute();
  });
  $("[data-hmc-open-replace-active]")?.addEventListener("click", () => {
    hmcSetupReplaceState.open = true;
    hmcSetupReplaceState.confirmed = false;
    hmcSetupReplaceState.status = "idle";
    hmcSetupReplaceState.code = "";
    hmcSetupReplaceState.message = "";
    renderHmcWorklistSetupRoute();
  });
  $("[data-hmc-cancel-replace-active]")?.addEventListener("click", () => {
    resetHmcSetupReplaceState();
    renderHmcWorklistSetupRoute();
  });
  $("[data-hmc-confirm-replace-active]")?.addEventListener("change", (event) => {
    hmcSetupReplaceState.confirmed = Boolean(event.currentTarget?.checked);
    renderHmcWorklistSetupRoute();
  });
  $("[data-hmc-replace-active-worklist]")?.addEventListener("click", async () => {
    const worklistId = hmcSetupWriteState.worklistId;
    hmcSetupReplaceState.status = "replacing";
    hmcSetupReplaceState.code = "";
    hmcSetupReplaceState.message = "";
    renderHmcWorklistSetupRoute();
    try {
      const result = await hmcReplaceActiveWorklist(worklistId, true);
      hmcSetupReplaceState.status = "success";
      hmcSetupReplaceState.open = false;
      hmcSetupReplaceState.confirmed = false;
      hmcSetupReplaceState.code = result.code || "WORKLIST_REPLACED";
      hmcSetupReplaceState.message = result.message || "已取代啟用清單。舊清單已標記為已取代並保留，新清單已啟用。";
      hmcSetupReplaceState.oldWorklistId = result.oldWorklistId || "";
      hmcSetupReplaceState.newWorklistId = result.worklistId || worklistId || "";
      hmcSetupWriteState.status = "active";
      hmcSetupWriteState.worklistStatus = result.worklistStatus || "active";
      hmcSetupWriteState.message = hmcSetupReplaceState.message;
      hmcSetupWriteState.palletCount = Number(result.palletCount || hmcSetupWriteState.palletCount || 0);
      hmcSetupWriteState.itemCount = Number(result.itemCount || hmcSetupWriteState.itemCount || 0);
      hmcClearSetupActiveWorklistReadCache();
      showToast("已取代 HMC 啟用清單");
    } catch (error) {
      hmcSetupReplaceState.status = "error";
      hmcSetupReplaceState.code = error?.code || "";
      hmcSetupReplaceState.message = error?.message || "取代失敗，請確認草稿清單與目前 active 清單狀態。";
    }
    renderHmcWorklistSetupRoute();
  });
  $$("[data-hmc-setup-shift]").forEach((button) => {
    button.addEventListener("click", () => {
      hmcReportState.shift = button.dataset.hmcSetupShift === "night" ? "night" : "day";
      machtileSetRouteParam("shift", hmcReportState.shift);
      hmcSetupWriteState.status = "idle";
      hmcSetupWriteState.worklistId = "";
      hmcSetupWriteState.worklistStatus = "";
      hmcSetupWriteState.palletCount = 0;
      hmcSetupWriteState.itemCount = 0;
      hmcSetupWriteState.code = "";
      hmcSetupWriteState.message = "";
      resetHmcSetupReplaceState();
      renderHmcWorklistSetupRoute();
    });
  });
  $("[data-hmc-setup-machine]")?.addEventListener("change", (event) => {
    const machineName = event.currentTarget.value || "HMC-01";
    window.location.href = hmcWorklistSetupRouteUrl(machineName, hmcReportState.shift);
  });

  $("[data-hmc-setup-date]")?.addEventListener("change", (event) => {
    const value = (event.currentTarget.value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      hmcSetupDraft().workDate = value;
    }
  });

  $$("[data-hmc-form-workno]").forEach((input) => {
    const palletId = input.dataset.hmcFormWorkno;
    input.addEventListener("focus", async () => {
      await hmcLoadWorkOrderSuggestions();
      hmcRenderWorkOrderSuggestions(palletId, input.value);
    });
    input.addEventListener("input", async () => {
      await hmcLoadWorkOrderSuggestions();
      hmcRenderWorkOrderSuggestions(palletId, input.value);
    });
  });

  $$("[data-hmc-wo-suggest]").forEach((box) => {
    box.addEventListener("click", (event) => {
      const pick = event.target.closest("[data-hmc-wo-pick]");
      if (!pick) return;
      const palletId = pick.dataset.hmcWoPick;
      const wonoInput = $(`[data-hmc-form-workno="${palletId}"]`);
      const partInput = $(`[data-hmc-form-partname="${palletId}"]`);
      const qtyInput = $(`[data-hmc-form-qty="${palletId}"]`);
      if (wonoInput) wonoInput.value = pick.dataset.woNo || "";
      if (partInput) partInput.value = pick.dataset.woPart || "";
      if (qtyInput && pick.dataset.woQty !== "") qtyInput.value = pick.dataset.woQty;
      box.innerHTML = "";
    });
  });

  $$("[data-hmc-pallet-name]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const pallet = hmcSetupDraftPallet(event.currentTarget.dataset.hmcPalletName);
      if (pallet) {
        pallet.setupName = event.currentTarget.value.trim() || "未設定治具";
        hmcSetupDraftMarkDirty();
      }
    });
  });

  $$("[data-hmc-chip]").forEach((chip) => {
    chip.addEventListener("click", (event) => {
      const [palletId, workNo] = String(chip.dataset.hmcChip || "").split("::");
      const draft = hmcSetupDraft();
      const pallet = hmcSetupDraftPallet(palletId);
      if (!pallet) return;
      const workIndex = pallet.works.findIndex((work) => work.workNo === workNo);
      if (workIndex < 0) return;
      draft.message = "";
      hmcSetupDraftMarkDirty();
      if (event.target.closest("[data-chip-del]")) {
        pallet.works.splice(workIndex, 1);
        if (draft.editTarget && draft.editTarget.palletId === palletId && draft.editTarget.workNo === workNo) draft.editTarget = null;
      } else if (event.target.closest("[data-chip-edit]")) {
        draft.editTarget = { palletId, workNo };
      } else {
        pallet.works[workIndex].included = !pallet.works[workIndex].included;
      }
      renderHmcWorklistSetupRoute();
    });
  });

  $$("[data-hmc-form-submit]").forEach((button) => {
    button.addEventListener("click", () => {
      const palletId = button.dataset.hmcFormSubmit;
      const draft = hmcSetupDraft();
      const pallet = hmcSetupDraftPallet(palletId);
      if (!pallet) return;
      const workNo = ($(`[data-hmc-form-workno="${palletId}"]`)?.value || "").trim();
      const partName = ($(`[data-hmc-form-partname="${palletId}"]`)?.value || "").trim();
      const plannedQty = hmcNonNegativeInteger($(`[data-hmc-form-qty="${palletId}"]`)?.value, 0);
      if (!workNo || !partName) {
        draft.message = "請填工單號與工件名。";
        renderHmcWorklistSetupRoute();
        return;
      }
      const editing = draft.editTarget && draft.editTarget.palletId === palletId
        ? pallet.works.find((work) => work.workNo === draft.editTarget.workNo)
        : null;
      const duplicate = pallet.works.some((work) => work.workNo === workNo && work !== editing);
      if (duplicate) {
        draft.message = `此盤已有工單號 ${workNo}。`;
        renderHmcWorklistSetupRoute();
        return;
      }
      draft.message = "";
      hmcSetupDraftMarkDirty();
      if (editing) {
        editing.workNo = workNo;
        editing.partName = partName;
        editing.plannedQty = plannedQty;
        editing.remainingQty = Math.max(0, plannedQty - editing.completedQty);
        draft.editTarget = null;
      } else {
        pallet.works.push({
          workNo,
          partName,
          plannedQty,
          completedQty: 0,
          remainingQty: plannedQty,
          operationId: "",
          operationName: "",
          materialStatus: "ready",
          included: true,
        });
      }
      renderHmcWorklistSetupRoute();
    });
  });

  $("[data-hmc-form-cancel]")?.addEventListener("click", () => {
    hmcSetupDraft().editTarget = null;
    renderHmcWorklistSetupRoute();
  });

  $("[data-hmc-add-pallet]")?.addEventListener("click", () => {
    const draft = hmcSetupDraft();
    const nextNo = draft.pallets.reduce((max, pallet) => Math.max(max, Number(pallet.palletNo) || 0), 0) + 1;
    draft.pallets.push({ palletId: `P${nextNo}`, palletNo: nextNo, setupName: "未設定治具", works: [] });
    hmcSetupDraftMarkDirty();
    draft.message = "";
    renderHmcWorklistSetupRoute();
  });

  $$("[data-hmc-del-pallet]").forEach((button) => {
    button.addEventListener("click", () => {
      const palletId = button.dataset.hmcDelPallet;
      const draft = hmcSetupDraft();
      if (draft.deleteConfirmPalletId !== palletId) {
        draft.deleteConfirmPalletId = palletId;
        renderHmcWorklistSetupRoute();
        return;
      }
      draft.pallets = draft.pallets.filter((pallet) => pallet.palletId !== palletId);
      hmcSetupDraftMarkDirty();
      draft.deleteConfirmPalletId = "";
      if (draft.editTarget && draft.editTarget.palletId === palletId) draft.editTarget = null;
      renderHmcWorklistSetupRoute();
    });
  });
}

function renderHmcReportRoute() {
  document.body.classList.remove("station-select-route-mode");
  document.body.classList.remove("work-list-route-mode");
  document.body.classList.remove("work-detail-route-mode");
  document.body.classList.remove("report-work-route-mode");
  document.body.classList.add("hmc-report-route-mode");

  const stationSelectRoot = $("#stationSelectRoute");
  if (stationSelectRoot) stationSelectRoot.hidden = true;
  const workListRoot = $("#workListRoute");
  if (workListRoot) workListRoot.hidden = true;
  const workDetailRoot = $("#workDetailRoute");
  if (workDetailRoot) workDetailRoot.hidden = true;
  const reportWorkRoot = $("#reportWorkRoute");
  if (reportWorkRoot) reportWorkRoot.hidden = true;
  const reviewRoot = $("#hmcDailyCheckReviewRoute");
  if (reviewRoot) reviewRoot.hidden = true;

  let routeRoot = $("#hmcReportRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "hmcReportRoute";
    routeRoot.className = "hmc-report-route";
    routeRoot.setAttribute("role", "main");
    routeRoot.setAttribute("aria-labelledby", "hmcReportTitle");
    document.body.appendChild(routeRoot);
  }
  routeRoot.className = "hmc-report-route";
  routeRoot.hidden = false;

  initializeHmcReportState();
  requestHmcActiveWorklistRead();
  const pallet = selectedHmcPallet();
  const work = selectedHmcWork();
  const isNight = hmcReportState.shift === "night";
  const machineLabel = hmcRouteMachineLabel();

  routeRoot.innerHTML = `
    <section class="hmc-report-shell">
      <header class="hmc-report-hero">
        <div>
          <p class="eyebrow">臥式加工中心 · ${escapeHtml(machineLabel)}</p>
          <h1 id="hmcReportTitle">多盤多工件報工</h1>
          <p>第一版只做畫面預覽：班前先建立加工清單，現場報工只填完成數、缺料與備註；不會送出、不會儲存、不會呼叫端點。</p>
        </div>
        <div class="hmc-report-hero-actions">
          <a class="hmc-secondary-action" href="${escapeHtml(hmcWorklistSetupRouteUrl(machineLabel, hmcReportState.shift))}">班前清單設定</a>
          <a href="${escapeHtml(hmcReportDashboardBackUrl())}" data-hmc-back>返回上一頁</a>
        </div>
      </header>

      <section class="hmc-safe-banner" aria-label="HMC disabled submit boundary">
        <strong>臥加畫面預覽模式</strong>
        <span>6 塊交換盤</span>
        <span>白班可多盤多工件</span>
        <span>晚班可多盤多工件</span>
        <span>尚未啟用送出</span>
        <span>不寫資料庫 / 不呼叫端點 / 不同步 SoftNet</span>
      </section>

      ${hmcWorklistReadStatusPanel()}

      ${hmcSelectedSummary()}

      <section class="hmc-report-card hmc-pallet-selector-card">
        <div class="hmc-night-head hmc-pallet-selector-head">
          <div>
            <strong>交換盤與工件選擇</strong>
            <span>${escapeHtml(hmcShiftDescription(hmcReportState.shift))} 目前只做畫面內選取，不會儲存。</span>
          </div>
          <div class="hmc-shift-tabs hmc-shift-tabs-inline" role="tablist" aria-label="HMC shift mode">
            <button type="button" class="hmc-shift-day ${!isNight ? "is-active" : ""}" data-hmc-shift="day">
              <strong>白班</strong>
              <span>自選本班工件</span>
            </button>
            <button type="button" class="hmc-shift-night ${isNight ? "is-active" : ""}" data-hmc-shift="night">
              <strong>夜班</strong>
              <span>交接批次工件</span>
            </button>
          </div>
        </div>
        ${hmcPalletMatrix()}
      </section>

      <div class="hmc-report-grid ${hmcReportState.setupOpen ? "is-setup-open" : "is-setup-closed"}">
        <aside class="hmc-report-card hmc-report-card-sticky ${hmcReportState.setupOpen ? "" : "is-hidden"}">
          <h2>清單調整</h2>
          <p>早上先建立本班加工清單；現場正常只需要填數量。臨時插單或換盤時，才在這裡調整。</p>
          <div class="hmc-setup-disabled">
            <strong>第一版暫不提供清單編輯</strong>
            <ul>
              <li>清單應由主管或排程人員在班前建立。</li>
              <li>此頁只填完成數量、缺料/跳過與備註。</li>
              <li>不新增交換盤、不變更工件清單。</li>
              <li>不儲存班別記憶、不寫入資料庫、不呼叫端點。</li>
            </ul>
          </div>
        </aside>

        <section class="hmc-report-card">
          <div class="hmc-context-panel">
            <div>
              <span>目前盤號</span>
              <strong>${escapeHtml(pallet.palletName)}</strong>
              <em>${escapeHtml(pallet.setupName)}</em>
            </div>
            <div>
              <span>班別模式</span>
              <strong>${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong>
              <em>${isNight ? "依晚班交接清單報工，可多盤、多工件。" : "依早上建立的加工清單報工，可多盤、多工件。"}</em>
            </div>
          </div>

          <div class="hmc-mode-panel">
            <div class="hmc-night-head">
              <strong>報工輸入方式</strong>
              <span>請直接在上方交換盤矩陣填數量；沒有原料就勾缺料。</span>
            </div>
            <p class="hmc-matrix-helper">白班與晚班都支援多盤、多工件。這一版只做畫面預覽，數量只留在目前畫面，不會儲存。</p>
          </div>

          <div class="hmc-mode-panel hmc-adjust-panel ${hmcReportState.setupOpen ? "" : "is-hidden"}">
            <div class="hmc-night-head">
              <strong>清單調整區</strong>
              <span>臨時插單、換盤、缺料改排時才使用。</span>
            </div>
            <div class="hmc-field hmc-setup-boundary">
              <span>目前查看工件</span>
              <div class="hmc-setup-disabled">
                <strong>本班加工清單設定尚未啟用</strong>
                <ul>
                  <li>未來可在這裡設定班別、交換盤與工件。</li>
                  <li>目前先以班前已建立的清單作為報工依據。</li>
                  <li>這一版不會保存清單調整，也不會同步 SoftNet。</li>
                </ul>
              </div>
            </div>
          </div>

          <label class="hmc-field">
            <span>交接備註</span>
            <textarea id="hmcHandoverNote" rows="3" placeholder="可記錄缺料、刀具、治具、下一班注意事項"></textarea>
          </label>

          <section id="hmcReportPreview" class="hmc-preview" aria-live="polite"></section>

          <section class="hmc-submit-panel">
            <strong>送出仍停用</strong>
            <p>這一包只建立臥式加工中心報工畫面外殼，不會建立報工紀錄、不會寫入資料庫、不會同步 SoftNet。</p>
            <button type="button" disabled aria-disabled="true">尚未啟用送出</button>
          </section>
        </section>
      </div>
    </section>
  `;

  bindHmcReportEvents();
  updateHmcReportPreview();
}

// HMC field-facing route: keep the shop-floor page quantity-first and login-free.
function hmcDailyQuantityStats() {
  const selected = hmcSelectedItems();
  const selectedPalletCount = new Set(selected.map((item) => item.pallet.palletId)).size;
  const completedQty = selected.reduce((total, item) => total + (Number(hmcQuantities()[item.key]) || 0), 0);
  const skippedCount = selected.filter((item) => hmcSkipped()[item.key]).length;
  const plannedQty = selected.reduce((total, item) => total + (Number(item.work.plannedQty) || 0), 0);
  const beforeRemainingQty = selected.reduce((total, item) => total + (Number(item.work.remainingQty) || 0), 0);
  const previewRemainingQty = Math.max(0, beforeRemainingQty - completedQty);
  return {
    selected,
    selectedPalletCount,
    itemCount: selected.length,
    completedQty,
    defectQty: 0,
    skippedCount,
    plannedQty,
    beforeRemainingQty,
    previewRemainingQty,
  };
}

function hmcDailyQuantitySummary() {
  const stats = hmcDailyQuantityStats();
  return `
    <section class="hmc-daily-summary" aria-label="HMC daily quantity summary">
      <div class="hmc-daily-summary-head">
        <div>
          <span>每日數量檢視</span>
          <strong>${escapeHtml(hmcRouteMachineKey())} · ${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong>
        </div>
        <em>目前只看數量與畫面預覽，不會送出、不會寫入資料庫。</em>
      </div>
      <div class="hmc-daily-summary-grid">
        <span><b>本班交換盤</b><strong>${escapeHtml(stats.selectedPalletCount)}</strong></span>
        <span><b>本班工件</b><strong>${escapeHtml(stats.itemCount)}</strong></span>
        <span><b>今日完成</b><strong>${escapeHtml(stats.completedQty)}</strong></span>
        <span><b>今日不良</b><strong>${escapeHtml(stats.defectQty)}</strong></span>
        <span><b>缺料 / 跳過</b><strong>${escapeHtml(stats.skippedCount)}</strong></span>
        <span><b>預覽後剩餘</b><strong>${escapeHtml(stats.previewRemainingQty)}</strong></span>
      </div>
    </section>
  `;
}

function hmcWorklistReadStatusPanel() {
  const readState = hmcCurrentWorklistReadState();
  if (readState.status === "preview") {
    return `
      <section class="hmc-safe-banner" aria-label="HMC worklist preview source">
        <strong>預覽清單</strong>
        <span>示範資料</span>
        <span>未連資料庫</span>
        <span>現場頁不寫資料庫</span>
      </section>
    `;
  }

  if (readState.status === "ok") {
    return `
      <section class="hmc-safe-banner is-quiet" aria-label="HMC active DB worklist source">
        <span>已讀取本班加工清單 · ${escapeHtml(readState.worklist?.machineCode || hmcRouteMachineKey())} · ${escapeHtml(hmcShiftLabel(readState.worklist?.shiftScope || hmcReportState.shift))} · ${escapeHtml(readState.pallets.length)} 盤 ${escapeHtml(readState.items.length)} 件</span>
      </section>
    `;
  }

  const labelMap = {
    idle: "尚未讀取清單",
    loading: "正在讀取清單",
    not_found: "沒有啟用中的清單",
    invalid_request: "讀取條件不完整",
    conflict: "啟用清單衝突",
    error: "清單讀取失敗",
    not_configured: "連線設定未完成",
  };
  return `
    <section class="hmc-safe-banner" aria-label="HMC worklist read status">
      <strong>${escapeHtml(labelMap[readState.status] || "清單狀態")}</strong>
      <span>${escapeHtml(readState.message || "目前改用畫面預覽清單。")}</span>
    </section>
  `;
}

function hmcShiftLabel(shift) {
  return shift === "night" ? "夜班：批次工件" : "白班：自選工件";
}

function hmcShiftDescription(shift) {
  return shift === "night"
    ? "依夜班交接清單查看多盤、多工件；目前只做每日數量檢視。"
    : "依白班本班清單查看多盤、多工件；目前只做每日數量檢視。";
}

function hmcPalletMatrix() {
  return `
    <section class="hmc-pallet-matrix" aria-label="HMC pallet work matrix">
      <div class="hmc-pallet-matrix-head">
        <span>盤號</span>
        <strong>${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong>
        <em>已選工件會變藍；產品名稱後方直接填本次完成數。</em>
      </div>
      ${activeHmcReportPallets().map((pallet, palletIndex) => {
        const selectedCount = pallet.works.filter((work) => hmcSelectedWorkKeys().has(hmcWorkKey(pallet.palletId, work.workNo))).length;
        return `
          <div class="hmc-pallet-row ${pallet.palletId === hmcActivePlan().activePalletId ? "is-active" : ""}">
            <button type="button" class="hmc-pallet-row-title" data-hmc-pallet="${escapeHtml(pallet.palletId)}">
              <span>第 ${escapeHtml(palletIndex + 1)} 盤</span>
              <strong>${escapeHtml(pallet.setupName)}</strong>
              <em>${escapeHtml(selectedCount)}/${escapeHtml(pallet.works.length)} 已選</em>
            </button>
            <div class="hmc-pallet-row-works">
              ${pallet.works.map((work, workIndex) => {
                const key = hmcWorkKey(pallet.palletId, work.workNo);
                const isSelected = hmcSelectedWorkKeys().has(key);
                const qtyValue = isSelected ? (hmcQuantities()[key] ?? "") : "";
                return `
                  <div class="hmc-matrix-work ${isSelected ? "is-selected" : ""} ${work.workNo === hmcActivePlan().workNo ? "is-active" : ""}">
                    <button type="button" data-hmc-work-card="${escapeHtml(work.workNo)}" data-hmc-pallet-work="${escapeHtml(pallet.palletId)}" aria-pressed="${isSelected ? "true" : "false"}">
                      <span>${escapeHtml(hmcWorkLetter(workIndex))}</span>
                      <strong>${escapeHtml(work.partName)}</strong>
                      <em>${escapeHtml(work.workNo)} · 剩餘 ${escapeHtml(work.remainingQty)}</em>
                    </button>
                    <label>
                      <span>今日完成</span>
                      <input class="hmc-selected-qty" type="number" min="0" inputmode="numeric" value="${escapeHtml(qtyValue)}" data-hmc-work-key="${escapeHtml(key)}" ${isSelected ? "" : "disabled"}>
                    </label>
                    <label class="hmc-matrix-skip">
                      <input class="hmc-selected-skip" type="checkbox" data-hmc-work-key="${escapeHtml(key)}" ${hmcSkipped()[key] ? "checked" : ""} ${isSelected ? "" : "disabled"}>
                      <span>缺料</span>
                    </label>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function hmcSelectedSummary() {
  const selected = hmcSelectedItems();
  const grouped = activeHmcReportPallets()
    .map((pallet) => ({
      pallet,
      items: selected.filter((item) => item.pallet.palletId === pallet.palletId),
    }))
    .filter((group) => group.items.length);

  return `
    <section class="hmc-selected-summary" aria-label="HMC selected work summary">
      <div class="hmc-selected-summary-head">
        <div>
          <span>本班加工清單</span>
          <strong>${selected.length} 件 / ${grouped.length} 盤</strong>
        </div>
        <button type="button" class="hmc-setup-toggle" data-hmc-toggle-setup>
          ${hmcReportState.setupOpen ? "收起清單調整說明" : "清單調整說明"}
        </button>
        <em>現場只看每日數量；輸入後只更新本頁預覽，不會送出。</em>
      </div>
      ${grouped.length ? grouped.map((group) => `
        <div class="hmc-selected-group">
          <strong>${escapeHtml(group.pallet.palletName)} · ${escapeHtml(group.pallet.setupName)}</strong>
          <div>
            ${group.items.map((item) => `<span>${escapeHtml(item.work.workNo)} · ${escapeHtml(item.work.partName)} · 剩餘 ${escapeHtml(item.work.remainingQty)}</span>`).join("")}
          </div>
        </div>
      `).join("") : `<p>目前沒有選到工件；請在下方交換盤與工件區選擇本班要看的項目。</p>`}
    </section>
  `;
}

function hmcWorkSummary(work) {
  return `
    <div class="hmc-work-summary">
      <span>工單</span><strong>${escapeHtml(work.workNo)}</strong>
      <span>工件</span><strong>${escapeHtml(work.partName)}</strong>
      <span>製程</span><strong>${escapeHtml(work.operationName)}</strong>
      <span>製程 ID</span><strong>${escapeHtml(work.operationId)}</strong>
      <span>剩餘</span><strong>${escapeHtml(work.remainingQty)}</strong>
    </div>
  `;
}

function hmcNightChecklist() {
  const selected = hmcSelectedItems();
  const fallbackPallet = selectedHmcPallet();
  const items = selected.length ? selected : fallbackPallet.works.map((work) => ({ pallet: fallbackPallet, work, key: hmcWorkKey(fallbackPallet.palletId, work.workNo) }));
  return items.map(({ pallet, work, key }, index) => `
    <article class="hmc-night-row">
      <div>
        <strong>${escapeHtml(work.partName)}</strong>
        <span>${escapeHtml(pallet.palletName)} / ${escapeHtml(work.workNo)} / ${escapeHtml(work.operationId)}</span>
      </div>
      <label>
        <span>今日完成</span>
        <input class="hmc-selected-qty" type="number" min="0" inputmode="numeric" value="${escapeHtml(hmcQuantities()[key] ?? (index === 0 ? "0" : ""))}" data-hmc-work-key="${escapeHtml(key)}">
      </label>
      <label class="hmc-check">
        <input class="hmc-selected-skip" type="checkbox" data-hmc-work-key="${escapeHtml(key)}" ${hmcSkipped()[key] ? "checked" : ""}>
        <span>缺料 / 跳過</span>
      </label>
    </article>
  `).join("");
}

function updateHmcReportPreview() {
  const stats = hmcDailyQuantityStats();
  const totalQty = $$(".hmc-selected-qty").reduce((total, input) => total + (Number(input.value) || 0), 0);
  const skippedCount = $$(".hmc-selected-skip").filter((input) => input.checked).length;
  const preview = $("#hmcReportPreview");
  if (!preview) return;
  const previewRemainingQty = Math.max(0, stats.beforeRemainingQty - totalQty);

  preview.innerHTML = `
    <div class="hmc-preview-grid">
      <span><b>班別</b><strong>${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong></span>
      <span><b>本班交換盤</b><strong>${escapeHtml(stats.selectedPalletCount)}</strong></span>
      <span><b>本班工件</b><strong>${escapeHtml(stats.itemCount)}</strong></span>
      <span><b>今日完成</b><strong>${escapeHtml(totalQty)}</strong></span>
      <span><b>今日不良</b><strong>0</strong></span>
      <span><b>缺料 / 跳過</b><strong>${escapeHtml(skippedCount)}</strong></span>
      <span><b>預覽前剩餘</b><strong>${escapeHtml(stats.beforeRemainingQty)}</strong></span>
      <span><b>預覽後剩餘</b><strong>${escapeHtml(previewRemainingQty)}</strong></span>
    </div>
    <p class="hmc-preview-warning">${totalQty > 0 ? "預覽已更新；目前只是畫面計算，不會送出。" : "請先輸入完成數量，預覽才會更新。"}</p>
    <p class="hmc-disabled-submit">尚未啟用送出</p>
  `;
}

function renderHmcReportRoute() {
  document.body.classList.remove("station-select-route-mode");
  document.body.classList.remove("work-list-route-mode");
  document.body.classList.remove("work-detail-route-mode");
  document.body.classList.remove("report-work-route-mode");
  document.body.classList.add("hmc-report-route-mode");

  const stationSelectRoot = $("#stationSelectRoute");
  if (stationSelectRoot) stationSelectRoot.hidden = true;
  const workListRoot = $("#workListRoute");
  if (workListRoot) workListRoot.hidden = true;
  const workDetailRoot = $("#workDetailRoute");
  if (workDetailRoot) workDetailRoot.hidden = true;
  const reportWorkRoot = $("#reportWorkRoute");
  if (reportWorkRoot) reportWorkRoot.hidden = true;
  const reviewRoot = $("#hmcDailyCheckReviewRoute");
  if (reviewRoot) reviewRoot.hidden = true;

  let routeRoot = $("#hmcReportRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "hmcReportRoute";
    routeRoot.className = "hmc-report-route";
    routeRoot.setAttribute("role", "main");
    routeRoot.setAttribute("aria-labelledby", "hmcReportTitle");
    document.body.appendChild(routeRoot);
  }
  routeRoot.className = "hmc-report-route";
  routeRoot.hidden = false;

  initializeHmcReportState();
  requestHmcActiveWorklistRead();
  const pallet = selectedHmcPallet();
  const isNight = hmcReportState.shift === "night";
  const machineLabel = hmcRouteMachineLabel();

  routeRoot.innerHTML = `
    <section class="hmc-report-shell">
      <header class="hmc-report-hero">
        <div>
          <p class="eyebrow">臥式加工中心 · ${escapeHtml(machineLabel)}</p>
          <h1 id="hmcReportTitle">多盤多工件每日數量</h1>
          <p>第一版只看數量與預覽；不會送出、不會儲存、不會呼叫端點。</p>
        </div>
        <div class="hmc-report-hero-actions">
          <a class="hmc-secondary-action" href="${escapeHtml(hmcWorklistSetupRouteUrl(machineLabel, hmcReportState.shift))}">主管設定班前清單</a>
          <a href="${escapeHtml(hmcReportDashboardBackUrl())}" data-hmc-back>返回上一頁</a>
        </div>
      </header>

      <section class="hmc-safe-banner" aria-label="HMC disabled submit boundary">
        <strong>每日數量檢視</strong>
        <span>不需要登入</span>
        <span>不寫資料庫</span>
        <span>不啟用送出</span>
        <span>不呼叫 SoftNet</span>
      </section>

      ${hmcWorklistReadStatusPanel()}
      ${hmcDailyQuantitySummary()}
      ${hmcSelectedSummary()}

      <section class="hmc-report-card hmc-pallet-selector-card">
        <div class="hmc-night-head hmc-pallet-selector-head">
          <div>
            <strong>交換盤與工件</strong>
            <span>${escapeHtml(hmcShiftDescription(hmcReportState.shift))}</span>
          </div>
          <div class="hmc-shift-tabs hmc-shift-tabs-inline" role="tablist" aria-label="HMC shift mode">
            <button type="button" class="hmc-shift-day ${!isNight ? "is-active" : ""}" data-hmc-shift="day">
              <strong>白班</strong>
              <span>自選工件</span>
            </button>
            <button type="button" class="hmc-shift-night ${isNight ? "is-active" : ""}" data-hmc-shift="night">
              <strong>夜班</strong>
              <span>批次工件</span>
            </button>
          </div>
        </div>
        ${hmcPalletMatrix()}
      </section>

      <div class="hmc-report-grid ${hmcReportState.setupOpen ? "is-setup-open" : "is-setup-closed"}">
        <aside class="hmc-report-card hmc-report-card-sticky ${hmcReportState.setupOpen ? "" : "is-hidden"}">
          <h2>清單調整說明</h2>
          <p>早上先建立本班加工清單；現場正常只需要填數量。臨時插單或換盤時，才回到主管設定路線處理。</p>
          <div class="hmc-setup-disabled">
            <strong>現場頁第一版不提供清單編輯</strong>
            <ul>
              <li>清單應由主管或排程人員在班前建立。</li>
              <li>此頁只看完成數、缺料/跳過與備註。</li>
              <li>不新增交換盤、不變更工件清單。</li>
              <li>不儲存班別記憶、不寫入資料庫、不呼叫端點。</li>
            </ul>
          </div>
        </aside>

        <section class="hmc-report-card">
          <div class="hmc-context-panel">
            <div>
              <span>目前盤號</span>
              <strong>${escapeHtml(pallet.palletName)}</strong>
              <em>${escapeHtml(pallet.setupName)}</em>
            </div>
            <div>
              <span>目前班別</span>
              <strong>${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong>
              <em>${isNight ? "夜班可多盤、多工件批次檢視。" : "白班也可多盤、多工件檢視。"}</em>
            </div>
          </div>

          <div class="hmc-mode-panel">
            <div class="hmc-night-head">
              <strong>畫面數量輸入</strong>
              <span>輸入後只更新本頁預覽，目前不會送出。</span>
            </div>
            <p class="hmc-matrix-helper">請在上方工件卡直接填今日完成數；缺料或暫不加工時勾選缺料 / 跳過。</p>
          </div>

          <label class="hmc-field">
            <span>備註</span>
            <textarea id="hmcHandoverNote" rows="3" placeholder="可記錄缺料、刀具、治具、下一班注意事項"></textarea>
          </label>

          <section id="hmcReportPreview" class="hmc-preview" aria-live="polite"></section>

          <section class="hmc-submit-panel">
            <strong>尚未啟用送出</strong>
            <p>目前只做每日數量檢視與畫面預覽，不會寫入資料庫，也不會同步 SoftNet。</p>
            <button type="button" disabled aria-disabled="true">尚未啟用送出</button>
          </section>
        </section>
      </div>
    </section>
  `;

  bindHmcReportEvents();
  updateHmcReportPreview();
}

// HMC daily quantity DB-read layer. This is read-only field UI: GET rows from
// v_hmc_daily_quantity_field_rows, merge them into the active worklist, and keep
// submit/DB writes out of the field route.
function hmcDailyQuantityReadCache() {
  if (!hmcReportState.dailyQuantityReadCache) hmcReportState.dailyQuantityReadCache = {};
  return hmcReportState.dailyQuantityReadCache;
}

function hmcDailyQuantityReadEnabled() {
  const params = new URLSearchParams(window.location.search);
  const quantitySource = params.get("quantitySource");
  return hmcDbWorklistReadEnabled()
    && quantitySource !== "preview"
    && canReadHmcWorklistFromSupabase()
    && (quantitySource === "db" || params.get("hmcDailyQtyRead") === "1" || !quantitySource);
}

function hmcDailyQuantityWorkDate() {
  const params = new URLSearchParams(window.location.search);
  const value = (params.get("workDate") || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const worklistDate = hmcCurrentWorklistReadState().worklist?.workDateStart || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(worklistDate)) return worklistDate;
  return hmcTodayDateIso();
}

function hmcDailyQuantityReadCacheKey(
  machineCode = hmcRouteMachineKey(),
  shift = hmcReportState.shift,
  workDate = hmcDailyQuantityWorkDate(),
  worklistId = hmcCurrentWorklistReadState().worklist?.id || ""
) {
  return `${machineCode || "HMC-01"}:${shift || "day"}:${workDate || "-"}:${worklistId || "no-worklist"}`;
}

function hmcCurrentDailyQuantityReadState() {
  if (!hmcDailyQuantityReadEnabled()) {
    return { status: "preview", source: "preview", message: "目前使用畫面預覽數量。", rows: [], byItemId: {}, byWorkOrderOperation: {} };
  }

  const worklistState = hmcCurrentWorklistReadState();
  if (worklistState.status !== "ok" || !worklistState.worklist?.id) {
    return {
      status: "waiting_worklist",
      source: "db",
      message: "先讀取 active HMC 加工清單後，才會讀每日數量。",
      rows: [],
      byItemId: {},
      byWorkOrderOperation: {},
    };
  }

  const key = hmcDailyQuantityReadCacheKey(
    worklistState.worklist.machineCode || hmcRouteMachineKey(),
    worklistState.worklist.shiftScope || hmcReportState.shift,
    hmcDailyQuantityWorkDate(),
    worklistState.worklist.id
  );

  return hmcDailyQuantityReadCache()[key] || {
    status: "idle",
    source: "db",
    message: "尚未讀取每日數量。",
    rows: [],
    byItemId: {},
    byWorkOrderOperation: {},
  };
}

function normalizeHmcDailyQuantityFieldRows(rows) {
  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row) => {
    const workNo = row.work_order_no || "";
    const operationId = row.operation_id || "";
    return {
      workDate: row.work_date || hmcDailyQuantityWorkDate(),
      machineCode: row.machine_code || hmcRouteMachineKey(),
      shiftScope: row.shift_scope || hmcReportState.shift,
      worklistId: row.worklist_id || "",
      worklistItemId: row.worklist_item_id || "",
      palletId: row.pallet_id || "",
      palletNo: Number(row.pallet_no || 0),
      positionCode: row.position_code || "",
      workNo,
      operationId,
      todayCompletedQty: Number(row.today_completed_qty || 0),
      todayDefectQty: Number(row.today_defect_qty || 0),
      remainingQtyBeforeToday: Number(row.remaining_qty_before_today || 0),
      remainingQty: Number(row.remaining_qty || 0),
      shortageOrSkipped: Boolean(row.shortage_or_skipped),
      quantityNote: row.quantity_note || "",
      sourceType: row.source_type || "no_summary",
      dailyCheckStatus: row.daily_check_status || "not_started",
      reviewedAt: row.reviewed_at || "",
      reviewedBy: row.reviewed_by || "",
      reviewNote: row.review_note || "",
      lastReportedAt: row.last_reported_at || "",
      quantityUpdatedAt: row.quantity_updated_at || "",
      workpieceName: row.workpiece_name || "",
    };
  });

  const byItemId = {};
  const byWorkOrderOperation = {};
  normalizedRows.forEach((row) => {
    if (row.worklistItemId) byItemId[row.worklistItemId] = row;
    if (row.workNo || row.operationId) byWorkOrderOperation[`${row.workNo}:${row.operationId}`] = row;
  });

  return { rows: normalizedRows, byItemId, byWorkOrderOperation };
}

async function loadHmcDailyQuantityFieldRows(machineCode, shift, workDate, worklistId) {
  if (!machineCode || !["day", "night"].includes(shift) || !workDate || !worklistId) {
    return {
      status: "invalid_request",
      source: "db",
      message: "machine, shift, workDate, and worklistId are required.",
      rows: [],
      byItemId: {},
      byWorkOrderOperation: {},
    };
  }

  const tenantFilter = config.tenantId ? `&${hmcRestEq("tenant_id", config.tenantId)}` : "";
  const path = [
    "v_hmc_daily_quantity_field_rows?select=*",
    hmcRestEq("machine_code", machineCode),
    hmcRestEq("shift_scope", shift),
    hmcRestEq("work_date", workDate),
    hmcRestEq("worklist_id", worklistId),
    "order=pallet_no.asc,item_sort_order.asc,position_code.asc",
  ].join("&") + tenantFilter;
  const rows = await supabaseFetch(path);
  const normalized = normalizeHmcDailyQuantityFieldRows(rows);

  return {
    status: normalized.rows.length ? "ok" : "empty",
    source: "db",
    message: normalized.rows.length ? "已讀取每日數量。" : "沒有讀到每日數量資料。",
    workDate,
    rows: normalized.rows,
    byItemId: normalized.byItemId,
    byWorkOrderOperation: normalized.byWorkOrderOperation,
  };
}

function requestHmcDailyQuantityRead() {
  if (!hmcDailyQuantityReadEnabled()) return;

  const worklistState = hmcCurrentWorklistReadState();
  if (worklistState.status !== "ok" || !worklistState.worklist?.id) return;
  if (!canReadHmcWorklistFromSupabase()) return;

  const machineCode = worklistState.worklist.machineCode || hmcRouteMachineKey();
  const shift = worklistState.worklist.shiftScope || hmcReportState.shift;
  const workDate = hmcDailyQuantityWorkDate();
  const worklistId = worklistState.worklist.id;
  const key = hmcDailyQuantityReadCacheKey(machineCode, shift, workDate, worklistId);
  const cache = hmcDailyQuantityReadCache();
  const current = cache[key];
  if (current && ["loading", "ok", "empty", "invalid_request", "error"].includes(current.status)) return;

  cache[key] = {
    status: "loading",
    source: "db",
    message: "正在讀取每日數量...",
    workDate,
    rows: [],
    byItemId: {},
    byWorkOrderOperation: {},
  };

  loadHmcDailyQuantityFieldRows(machineCode, shift, workDate, worklistId)
    .then((result) => {
      cache[key] = result;
      const routePath = currentRoutePath();
      const stillSameKey = hmcDailyQuantityReadCacheKey(machineCode, shift, workDate, worklistId) === key;
      if ((routePath === hmcReportRoutePath() || routePath.startsWith(`${hmcReportRoutePath()}/`)) && stillSameKey) {
        renderHmcReportRoute();
      }
    })
    .catch((error) => {
      cache[key] = {
        status: "error",
        source: "db",
        message: error?.message || "每日數量讀取失敗。",
        workDate,
        rows: [],
        byItemId: {},
        byWorkOrderOperation: {},
      };
      const routePath = currentRoutePath();
      if (routePath === hmcReportRoutePath() || routePath.startsWith(`${hmcReportRoutePath()}/`)) {
        renderHmcReportRoute();
      }
    });
}

function mergeHmcDailyQuantityRowsIntoPallets(pallets, dailyState = hmcCurrentDailyQuantityReadState()) {
  if (!["ok", "empty"].includes(dailyState.status)) {
    return pallets;
  }

  return (Array.isArray(pallets) ? pallets : []).map((pallet) => ({
    ...pallet,
    works: (Array.isArray(pallet.works) ? pallet.works : []).map((work) => {
      const itemId = work.worklistItemId || work.dbRowId || "";
      const row = dailyState.byItemId?.[itemId]
        || dailyState.byWorkOrderOperation?.[`${work.workNo || ""}:${work.operationId || ""}`]
        || null;
      if (!row) {
        return {
          ...work,
          dailyQuantityReadStatus: dailyState.status,
          dailyQuantitySource: "no_summary",
          dbTodayCompletedQty: 0,
          dbTodayDefectQty: 0,
          dbRemainingQty: Number(work.remainingQty || 0),
          dbRemainingQtyBeforeToday: Number(work.remainingQty || 0),
          dbShortageOrSkipped: false,
          dailyCheckStatus: "not_started",
          dailyReviewNote: "",
          dailyReviewedAt: "",
          dailyReviewedBy: "",
          dailyQuantityNote: "",
        };
      }
      return {
        ...work,
        dailyQuantityReadStatus: dailyState.status,
        dailyQuantitySource: row.sourceType,
        dailyQuantityWorkDate: row.workDate,
        dbTodayCompletedQty: row.todayCompletedQty,
        dbTodayDefectQty: row.todayDefectQty,
        dbRemainingQty: row.remainingQty,
        dbRemainingQtyBeforeToday: row.remainingQtyBeforeToday,
        dbShortageOrSkipped: row.shortageOrSkipped,
        dailyCheckStatus: row.dailyCheckStatus,
        dailyReviewNote: row.reviewNote || "",
        dailyReviewedAt: row.reviewedAt || "",
        dailyReviewedBy: row.reviewedBy || "",
        dailyQuantityNote: row.quantityNote,
        dailyQuantityUpdatedAt: row.quantityUpdatedAt || row.lastReportedAt || "",
      };
    }),
  }));
}

function activeHmcReportPallets() {
  const readState = hmcCurrentWorklistReadState();
  const pallets = readState.status === "ok" && Array.isArray(readState.pallets) && readState.pallets.length
    ? readState.pallets
    : hmcReportPallets;
  return mergeHmcDailyQuantityRowsIntoPallets(pallets);
}

function hmcDailyQuantityStats() {
  const selected = hmcSelectedItems();
  const selectedPalletCount = new Set(selected.map((item) => item.pallet.palletId)).size;
  const enteredCompletedQty = selected.reduce((total, item) => total + (Number(hmcQuantities()[item.key]) || 0), 0);
  const enteredSkippedCount = selected.filter((item) => hmcSkipped()[item.key]).length;
  const plannedQty = selected.reduce((total, item) => total + (Number(item.work.plannedQty) || 0), 0);
  const beforeRemainingQty = selected.reduce((total, item) => total + (Number(item.work.dbRemainingQtyBeforeToday ?? item.work.remainingQty) || 0), 0);
  const dbCompletedQty = selected.reduce((total, item) => total + (Number(item.work.dbTodayCompletedQty) || 0), 0);
  const dbDefectQty = selected.reduce((total, item) => total + (Number(item.work.dbTodayDefectQty) || 0), 0);
  const dbRemainingQty = selected.reduce((total, item) => total + (Number(item.work.dbRemainingQty ?? item.work.remainingQty) || 0), 0);
  const dbSkippedCount = selected.filter((item) => item.work.dbShortageOrSkipped).length;
  const dailyState = hmcCurrentDailyQuantityReadState();
  const hasDbDailyQuantity = dailyState.status === "ok";
  const readRows = hasDbDailyQuantity && Array.isArray(dailyState.rows) ? dailyState.rows : [];
  const readListCompletedQty = readRows.reduce((total, row) => total + (Number(row.todayCompletedQty) || 0), 0);
  const readListDefectQty = readRows.reduce((total, row) => total + (Number(row.todayDefectQty) || 0), 0);
  const readListRemainingQty = readRows.reduce((total, row) => total + (Number(row.remainingQty) || 0), 0);
  const readListSkippedCount = readRows.filter((row) => row.shortageOrSkipped).length;
  const readListPendingCount = readRows.filter((row) => row.dailyCheckStatus === "pending_review").length;
  const readListConfirmedCount = readRows.filter((row) => row.dailyCheckStatus === "confirmed").length;
  const readListRejectedCount = readRows.filter((row) => row.dailyCheckStatus === "rejected").length;
  const readListPalletCount = new Set(readRows.map((row) => row.palletId || row.palletNo).filter(Boolean)).size;
  const previewBaseRemainingQty = hasDbDailyQuantity ? dbRemainingQty : beforeRemainingQty;
  const previewRemainingQty = Math.max(0, previewBaseRemainingQty - enteredCompletedQty);

  return {
    selected,
    selectedPalletCount,
    itemCount: selected.length,
    completedQty: enteredCompletedQty,
    defectQty: dbDefectQty,
    skippedCount: Math.max(enteredSkippedCount, dbSkippedCount),
    plannedQty,
    beforeRemainingQty,
    dbCompletedQty,
    dbDefectQty,
    dbRemainingQty,
    dbSkippedCount,
    hasDbDailyQuantity,
    readListCompletedQty,
    readListDefectQty,
    readListRemainingQty,
    readListSkippedCount,
    readListPendingCount,
    readListConfirmedCount,
    readListRejectedCount,
    readListItemCount: readRows.length,
    readListPalletCount,
    previewRemainingQty,
  };
}

function hmcDailyQuantitySummary() {
  const stats = hmcDailyQuantityStats();
  const dailyState = hmcCurrentDailyQuantityReadState();
  const sourceLabel = dailyState.status === "ok"
    ? `Dev DB · ${dailyState.workDate || hmcDailyQuantityWorkDate()}`
    : "畫面預覽";
  return `
    <section class="hmc-daily-summary" aria-label="HMC daily quantity summary">
      <div class="hmc-daily-summary-head">
        <div>
          <span>每日數量檢視</span>
          <strong>${escapeHtml(hmcRouteMachineKey())} · ${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong>
        </div>
        <em>${escapeHtml(sourceLabel)}；現場頁只讀/預覽，不會送出、不會寫入資料庫。</em>
      </div>
      <div class="hmc-daily-summary-grid">
        <span><b>本班交換盤</b><strong>${escapeHtml(stats.selectedPalletCount)}</strong></span>
        <span><b>本班工件</b><strong>${escapeHtml(stats.itemCount)}</strong></span>
        <span><b>已讀今日完成</b><strong>${escapeHtml(stats.dbCompletedQty)}</strong></span>
        <span><b>已讀今日不良</b><strong>${escapeHtml(stats.dbDefectQty)}</strong></span>
        <span><b>缺料 / 跳過</b><strong>${escapeHtml(stats.skippedCount)}</strong></span>
        <span><b>目前剩餘</b><strong>${escapeHtml(stats.hasDbDailyQuantity ? stats.dbRemainingQty : stats.beforeRemainingQty)}</strong></span>
        <span><b>畫面輸入</b><strong>${escapeHtml(stats.completedQty)}</strong></span>
        <span><b>預覽後剩餘</b><strong>${escapeHtml(stats.previewRemainingQty)}</strong></span>
      </div>
    </section>
  `;
}

function hmcWorklistReadStatusPanel() {
  const readState = hmcCurrentWorklistReadState();
  if (readState.status === "preview") {
    return `
      <section class="hmc-safe-banner" aria-label="HMC worklist preview source">
        <strong>預覽清單</strong>
        <span>示範資料</span>
        <span>未連資料庫</span>
        <span>現場頁不寫資料庫</span>
      </section>
    `;
  }

  if (readState.status === "ok") {
    return `
      <section class="hmc-safe-banner is-quiet" aria-label="HMC active DB worklist source">
        <span>已讀取本班加工清單 · ${escapeHtml(readState.worklist?.machineCode || hmcRouteMachineKey())} · ${escapeHtml(hmcShiftLabel(readState.worklist?.shiftScope || hmcReportState.shift))} · ${escapeHtml(readState.pallets.length)} 盤 ${escapeHtml(readState.items.length)} 件</span>
      </section>
    `;
  }

  const labelMap = {
    idle: "尚未讀取清單",
    loading: "正在讀取清單",
    not_found: "沒有啟用中的清單",
    invalid_request: "讀取條件不完整",
    conflict: "啟用清單衝突",
    error: "清單讀取失敗",
    not_configured: "連線設定未完成",
  };
  return `
    <section class="hmc-safe-banner" aria-label="HMC worklist read status">
      <strong>${escapeHtml(labelMap[readState.status] || "清單狀態")}</strong>
      <span>${escapeHtml(readState.message || "目前改用畫面預覽清單。")}</span>
    </section>
  `;
}

function hmcDailyCheckReviewResultPanel() {
  const dailyState = hmcCurrentDailyQuantityReadState();
  if (dailyState.status !== "ok" || !Array.isArray(dailyState.rows) || !dailyState.rows.length) return "";

  const stats = hmcDailyQuantityStats();
  const visibleRows = dailyState.rows.filter((row) => ["pending_review", "confirmed", "rejected"].includes(row.dailyCheckStatus));
  const attentionRows = visibleRows.filter((row) => row.dailyCheckStatus === "rejected" || row.dailyCheckStatus === "confirmed").slice(0, 6);
  if (!attentionRows.length) return "";
  return `
    <section class="hmc-review-result-panel" aria-label="HMC daily check review result visibility">
      <div class="hmc-review-result-head">
        <div>
          <span>主管確認結果</span>
          <strong>有確認 / 退回的工件</strong>
        </div>
        <em>退回項目會在下方工件卡標橘色，可修正後重新送審。</em>
      </div>
      <div class="hmc-review-result-grid">
        <span><b>待確認</b><strong>${escapeHtml(stats.readListPendingCount)}</strong></span>
        <span><b>已確認</b><strong>${escapeHtml(stats.readListConfirmedCount)}</strong></span>
        <span><b>已退回</b><strong>${escapeHtml(stats.readListRejectedCount)}</strong></span>
      </div>
      <div class="hmc-review-result-list">
        ${attentionRows.map((row) => `
          <article class="hmc-review-result-row ${hmcReviewStatusClass(row.dailyCheckStatus)}">
            <div>
              <strong>${escapeHtml(row.workpieceName || row.workNo || "-")}</strong>
              <span>${escapeHtml(row.workNo || "-")} / ${escapeHtml(row.operationId || "-")}</span>
            </div>
            <b class="hmc-review-status ${hmcReviewStatusClass(row.dailyCheckStatus)}">${escapeHtml(hmcReviewStatusLabel(row.dailyCheckStatus))}</b>
            <p>${escapeHtml(row.reviewNote || hmcDailyCheckStatusDescription(row.dailyCheckStatus))}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function hmcRenderReviewNoteCell(row) {
  const quantityNote = row.quantityNote || "-";
  const reviewNote = row.reviewNote || "";
  const reviewedAt = row.reviewedAt || "";
  return `
    <span class="hmc-review-note-stack">
      <b>作業員：${escapeHtml(quantityNote)}</b>
      ${reviewNote ? `<em>主管：${escapeHtml(reviewNote)}</em>` : ""}
      ${reviewedAt ? `<small>${escapeHtml(machtileFormatAuditTime(reviewedAt))}</small>` : ""}
    </span>
  `;
}

function hmcWorkDailyCheckStatus(work) {
  return work?.dailyCheckStatus || "not_started";
}

function hmcWorkDailyCheckEditable(work) {
  const status = hmcWorkDailyCheckStatus(work);
  if (!hmcDailyCheckItemId(work)) return true;
  return status === "not_started" || status === "rejected";
}

function hmcWorkDailyCheckLockedReason(work) {
  const status = hmcWorkDailyCheckStatus(work);
  if (status === "pending_review") return "已送審，等待主管確認，第一版不可修改。";
  if (status === "confirmed") return "主管已確認，第一版不可修改。";
  if (status === "converted") return "已轉正式報工，不可在此修改。";
  return "";
}

function hmcWorkDailyCheckInputValue(work, key, values, dbValue) {
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
  if (hmcDailyCheckItemId(work) && hmcWorkDailyCheckStatus(work) !== "not_started") return String(Number(dbValue || 0));
  return "";
}

function hmcDailyCheckEditableSelectedItems() {
  return hmcSelectedItems().filter((item) => hmcDailyCheckItemId(item.work) && hmcWorkDailyCheckEditable(item.work));
}

function hmcDailyCheckRejectedSelectedCount() {
  return hmcDailyCheckEditableSelectedItems().filter((item) => hmcWorkDailyCheckStatus(item.work) === "rejected").length;
}
function hmcDailyQuantityReadStatusPanel() {
  const dailyState = hmcCurrentDailyQuantityReadState();
  if (dailyState.status === "preview") {
    return `
      <section class="hmc-safe-banner" aria-label="HMC daily quantity preview source">
        <strong>每日數量來源</strong>
        <span>畫面預覽</span>
        <span>不需要登入</span>
        <span>不寫資料庫</span>
      </section>
    `;
  }

  if (dailyState.status === "ok") {
    return `
      <section class="hmc-safe-banner" aria-label="HMC daily quantity DB source">
        <strong>已讀取每日數量</strong>
        <span>${escapeHtml(dailyState.workDate || hmcDailyQuantityWorkDate())}</span>
        <span>${escapeHtml(dailyState.rows.length)} 筆</span>
        <span>來源：v_hmc_daily_quantity_field_rows</span>
        <span>只讀，不送出</span>
      </section>
    `;
  }

  const labelMap = {
    idle: "尚未讀取每日數量",
    loading: "正在讀取每日數量",
    empty: "沒有每日數量資料",
    waiting_worklist: "等待啟用清單",
    invalid_request: "每日數量讀取條件不完整",
    error: "每日數量讀取失敗",
  };
  return `
    <section class="hmc-safe-banner" aria-label="HMC daily quantity read status">
      <strong>${escapeHtml(labelMap[dailyState.status] || "每日數量狀態")}</strong>
      <span>${escapeHtml(dailyState.message || "目前改用畫面預覽數量。")}</span>
      <span>不需要登入</span>
      <span>不寫資料庫</span>
    </section>
  `;
}

function hmcShiftLabel(shift) {
  return shift === "night" ? "夜班：批次工件" : "白班：自選工件";
}

function hmcShiftDescription(shift) {
  return shift === "night"
    ? "依夜班交接清單查看多盤、多工件；目前只做每日數量檢視。"
    : "依白班本班清單查看多盤、多工件；目前只做每日數量檢視。";
}

function hmcWorkDailyQuantityLine(work) {
  const source = work.dailyQuantitySource || "preview";
  if (source === "preview" || work.dailyQuantityReadStatus === "preview") {
    return `剩餘 ${work.remainingQty}`;
  }
  const shortage = work.dbShortageOrSkipped ? " / 缺料" : "";
  return `完成 ${Number(work.dbTodayCompletedQty || 0)} / 不良 ${Number(work.dbTodayDefectQty || 0)} / 剩餘 ${Number((work.dbRemainingQty ?? work.remainingQty) || 0)}${shortage}`;
}

function hmcPalletMatrix() {
  return `
    <section class="hmc-pallet-matrix" aria-label="HMC pallet work matrix">
      <div class="hmc-pallet-matrix-head">
        <span>盤號</span>
        <strong>${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong>
        <em>已選工件會變藍；產品名稱後方顯示每日數量，右側可填本頁預覽完成數。</em>
      </div>
      ${activeHmcReportPallets().map((pallet, palletIndex) => {
        const selectedCount = pallet.works.filter((work) => hmcSelectedWorkKeys().has(hmcWorkKey(pallet.palletId, work.workNo))).length;
        return `
          <div class="hmc-pallet-row ${pallet.palletId === hmcActivePlan().activePalletId ? "is-active" : ""}">
            <button type="button" class="hmc-pallet-row-title" data-hmc-pallet="${escapeHtml(pallet.palletId)}">
              <span>第 ${escapeHtml(palletIndex + 1)} 盤</span>
              <strong>${escapeHtml(pallet.setupName)}</strong>
              <em>${escapeHtml(selectedCount)}/${escapeHtml(pallet.works.length)} 已選</em>
            </button>
            <div class="hmc-pallet-row-works">
              ${pallet.works.map((work, workIndex) => {
                const key = hmcWorkKey(pallet.palletId, work.workNo);
                const isSelected = hmcSelectedWorkKeys().has(key);
                const qtyValue = isSelected ? (hmcQuantities()[key] ?? "") : "";
                return `
                  <div class="hmc-matrix-work ${isSelected ? "is-selected" : ""} ${work.workNo === hmcActivePlan().workNo ? "is-active" : ""}">
                    <button type="button" data-hmc-work-card="${escapeHtml(work.workNo)}" data-hmc-pallet-work="${escapeHtml(pallet.palletId)}" aria-pressed="${isSelected ? "true" : "false"}">
                      <span>${escapeHtml(hmcWorkLetter(workIndex))}</span>
                      <strong>${escapeHtml(work.partName)}</strong>
                      <em>${escapeHtml(work.workNo)} · ${escapeHtml(hmcWorkDailyQuantityLine(work))}</em>
                    </button>
                    <label>
                      <span>畫面輸入</span>
                      <input class="hmc-selected-qty" type="number" min="0" inputmode="numeric" value="${escapeHtml(qtyValue)}" data-hmc-work-key="${escapeHtml(key)}" ${isSelected ? "" : "disabled"}>
                    </label>
                    <label class="hmc-matrix-skip">
                      <input class="hmc-selected-skip" type="checkbox" data-hmc-work-key="${escapeHtml(key)}" ${hmcSkipped()[key] || work.dbShortageOrSkipped ? "checked" : ""} ${isSelected ? "" : "disabled"}>
                      <span>缺料</span>
                    </label>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function hmcSelectedSummary() {
  const selected = hmcSelectedItems();
  const grouped = activeHmcReportPallets()
    .map((pallet) => ({
      pallet,
      items: selected.filter((item) => item.pallet.palletId === pallet.palletId),
    }))
    .filter((group) => group.items.length);

  return `
    <section class="hmc-selected-summary" aria-label="HMC selected work summary">
      <div class="hmc-selected-summary-head">
        <div>
          <span>本班加工清單</span>
          <strong>${selected.length} 件 / ${grouped.length} 盤</strong>
        </div>
        <button type="button" class="hmc-setup-toggle" data-hmc-toggle-setup>
          ${hmcReportState.setupOpen ? "收起清單調整說明" : "清單調整說明"}
        </button>
        <em>現場只看每日數量；輸入後只更新本頁預覽，不會送出。</em>
      </div>
      ${grouped.length ? grouped.map((group) => `
        <div class="hmc-selected-group">
          <strong>${escapeHtml(group.pallet.palletName)} · ${escapeHtml(group.pallet.setupName)}</strong>
          <div>
            ${group.items.map((item) => `<span>${escapeHtml(item.work.workNo)} · ${escapeHtml(item.work.partName)} · ${escapeHtml(hmcWorkDailyQuantityLine(item.work))}</span>`).join("")}
          </div>
        </div>
      `).join("") : `<p>目前沒有選到工件；請在下方交換盤與工件區選擇本班要看的項目。</p>`}
    </section>
  `;
}

function updateHmcReportPreview() {
  const stats = hmcDailyQuantityStats();
  const totalQty = $$(".hmc-selected-qty").reduce((total, input) => total + (Number(input.value) || 0), 0);
  const skippedCount = $$(".hmc-selected-skip").filter((input) => input.checked).length;
  const preview = $("#hmcReportPreview");
  if (!preview) return;
  const baseRemainingQty = stats.hasDbDailyQuantity ? stats.dbRemainingQty : stats.beforeRemainingQty;
  const previewRemainingQty = Math.max(0, baseRemainingQty - totalQty);

  preview.innerHTML = `
    <div class="hmc-preview-grid">
      <span><b>班別</b><strong>${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong></span>
      <span><b>本班交換盤</b><strong>${escapeHtml(stats.selectedPalletCount)}</strong></span>
      <span><b>本班工件</b><strong>${escapeHtml(stats.itemCount)}</strong></span>
      <span><b>已讀今日完成</b><strong>${escapeHtml(stats.dbCompletedQty)}</strong></span>
      <span><b>已讀今日不良</b><strong>${escapeHtml(stats.dbDefectQty)}</strong></span>
      <span><b>畫面輸入完成</b><strong>${escapeHtml(totalQty)}</strong></span>
      <span><b>缺料 / 跳過</b><strong>${escapeHtml(Math.max(skippedCount, stats.dbSkippedCount))}</strong></span>
      <span><b>預覽後剩餘</b><strong>${escapeHtml(previewRemainingQty)}</strong></span>
    </div>
    <p class="hmc-preview-warning">${totalQty > 0 ? "預覽已更新；目前只是畫面計算，不會送出。" : "可先查看已讀數量；需要模擬時再輸入完成數。"}</p>
    <p class="hmc-disabled-submit">尚未啟用送出</p>
  `;
}

function renderHmcReportRoute() {
  document.body.classList.remove("station-select-route-mode");
  document.body.classList.remove("work-list-route-mode");
  document.body.classList.remove("work-detail-route-mode");
  document.body.classList.remove("report-work-route-mode");
  document.body.classList.add("hmc-report-route-mode");

  const stationSelectRoot = $("#stationSelectRoute");
  if (stationSelectRoot) stationSelectRoot.hidden = true;
  const workListRoot = $("#workListRoute");
  if (workListRoot) workListRoot.hidden = true;
  const workDetailRoot = $("#workDetailRoute");
  if (workDetailRoot) workDetailRoot.hidden = true;
  const reportWorkRoot = $("#reportWorkRoute");
  if (reportWorkRoot) reportWorkRoot.hidden = true;
  const reviewRoot = $("#hmcDailyCheckReviewRoute");
  if (reviewRoot) reviewRoot.hidden = true;

  let routeRoot = $("#hmcReportRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "hmcReportRoute";
    routeRoot.className = "hmc-report-route";
    routeRoot.setAttribute("role", "main");
    routeRoot.setAttribute("aria-labelledby", "hmcReportTitle");
    document.body.appendChild(routeRoot);
  }
  routeRoot.className = "hmc-report-route";
  routeRoot.hidden = false;

  initializeHmcReportState();
  requestHmcActiveWorklistRead();
  requestHmcDailyQuantityRead();
  const pallet = selectedHmcPallet();
  const isNight = hmcReportState.shift === "night";
  const machineLabel = hmcRouteMachineLabel();

  routeRoot.innerHTML = `
    <section class="hmc-report-shell">
      <header class="hmc-report-hero">
        <div>
          <p class="eyebrow">臥式加工中心 · ${escapeHtml(machineLabel)}</p>
          <h1 id="hmcReportTitle">多盤多工件每日數量</h1>
          <p>第一版只看數量與預覽；不會送出、不會儲存、不會呼叫端點。</p>
        </div>
        <div class="hmc-report-hero-actions">
          <a class="hmc-secondary-action" href="${escapeHtml(hmcWorklistSetupRouteUrl(machineLabel, hmcReportState.shift))}">主管設定班前清單</a>
          <a href="${escapeHtml(hmcReportDashboardBackUrl())}" data-hmc-back>返回上一頁</a>
        </div>
      </header>

      <section class="hmc-safe-banner" aria-label="HMC disabled submit boundary">
        <strong>每日數量檢視</strong>
        <span>不需要登入</span>
        <span>不寫資料庫</span>
        <span>不啟用送出</span>
        <span>不呼叫 SoftNet</span>
      </section>

      ${hmcWorklistReadStatusPanel()}
      ${hmcDailyQuantityReadStatusPanel()}
      ${hmcDailyQuantitySummary()}
      ${hmcDailyCheckReviewResultPanel()}
      ${hmcSelectedSummary()}

      <section class="hmc-report-card hmc-pallet-selector-card">
        <div class="hmc-night-head hmc-pallet-selector-head">
          <div>
            <strong>交換盤與工件</strong>
            <span>${escapeHtml(hmcShiftDescription(hmcReportState.shift))}</span>
          </div>
          <div class="hmc-shift-tabs hmc-shift-tabs-inline" role="tablist" aria-label="HMC shift mode">
            <button type="button" class="hmc-shift-day ${!isNight ? "is-active" : ""}" data-hmc-shift="day">
              <strong>白班</strong>
              <span>自選工件</span>
            </button>
            <button type="button" class="hmc-shift-night ${isNight ? "is-active" : ""}" data-hmc-shift="night">
              <strong>夜班</strong>
              <span>批次工件</span>
            </button>
          </div>
        </div>
        ${hmcPalletMatrix()}
      </section>

      <div class="hmc-report-grid ${hmcReportState.setupOpen ? "is-setup-open" : "is-setup-closed"}">
        <aside class="hmc-report-card hmc-report-card-sticky ${hmcReportState.setupOpen ? "" : "is-hidden"}">
          <h2>清單調整說明</h2>
          <p>早上先建立本班加工清單；現場正常只需要查看數量或做畫面預覽。臨時插單或換盤時，才回到主管設定路線處理。</p>
          <div class="hmc-setup-disabled">
            <strong>現場頁第一版不提供清單編輯</strong>
            <ul>
              <li>清單應由主管或排程人員在班前建立。</li>
              <li>此頁只看完成數、不良數、缺料/跳過與備註。</li>
              <li>不新增交換盤、不變更工件清單。</li>
              <li>不儲存班別記憶、不寫入資料庫、不呼叫端點。</li>
            </ul>
          </div>
        </aside>

        <section class="hmc-report-card">
          <div class="hmc-context-panel">
            <div>
              <span>目前盤號</span>
              <strong>${escapeHtml(pallet.palletName)}</strong>
              <em>${escapeHtml(pallet.setupName)}</em>
            </div>
            <div>
              <span>目前班別</span>
              <strong>${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong>
              <em>${isNight ? "夜班可多盤、多工件批次檢視。" : "白班也可多盤、多工件檢視。"}</em>
            </div>
          </div>

          <div class="hmc-mode-panel">
            <div class="hmc-night-head">
              <strong>畫面數量預覽</strong>
              <span>輸入後只更新本頁預覽，目前不會送出。</span>
            </div>
            <p class="hmc-matrix-helper">已讀數量來自 Dev read-only view；右側輸入只是本頁預覽，不會儲存。</p>
          </div>

          <label class="hmc-field">
            <span>備註</span>
            <textarea id="hmcHandoverNote" rows="3" placeholder="可記錄缺料、刀具、治具、下一班注意事項"></textarea>
          </label>

          <section id="hmcReportPreview" class="hmc-preview" aria-live="polite"></section>

          <section class="hmc-submit-panel">
            <strong>尚未啟用送出</strong>
            <p>目前只做每日數量檢視與畫面預覽，不會寫入資料庫，也不會同步 SoftNet。</p>
            <button type="button" disabled aria-disabled="true">尚未啟用送出</button>
          </section>
        </section>
      </div>
    </section>
  `;

  bindHmcReportEvents();
  updateHmcReportPreview();
}

// Override the earlier summary renderer so the top block distinguishes the
// whole DB-read worklist from the currently selected work item.
function hmcDailyQuantitySummary() {
  const stats = hmcDailyQuantityStats();
  const dailyState = hmcCurrentDailyQuantityReadState();
  const sourceLabel = dailyState.status === "ok"
    ? `Dev DB · ${dailyState.workDate || hmcDailyQuantityWorkDate()}`
    : "畫面預覽";

  return `
    <section class="hmc-daily-summary" aria-label="HMC daily quantity summary">
      <div class="hmc-daily-summary-head">
        <div>
          <span>每日數量檢視</span>
          <strong>${escapeHtml(hmcRouteMachineKey())} · ${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong>
        </div>
        <em>${escapeHtml(sourceLabel)}；先看已讀清單合計，再看已選工件合計。現場頁不會送出、不會寫入資料庫。</em>
      </div>
      <div class="hmc-daily-summary-grid">
        ${stats.hasDbDailyQuantity ? `
          <span><b>已讀清單交換盤</b><strong>${escapeHtml(stats.readListPalletCount)}</strong></span>
          <span><b>已讀清單工件</b><strong>${escapeHtml(stats.readListItemCount)}</strong></span>
          <span><b>已讀清單完成</b><strong>${escapeHtml(stats.readListCompletedQty)}</strong></span>
          <span><b>已讀清單不良</b><strong>${escapeHtml(stats.readListDefectQty)}</strong></span>
          <span><b>已讀清單缺料</b><strong>${escapeHtml(stats.readListSkippedCount)}</strong></span>
          <span><b>已讀清單剩餘</b><strong>${escapeHtml(stats.readListRemainingQty)}</strong></span>
        ` : ""}
        <span><b>已選交換盤</b><strong>${escapeHtml(stats.selectedPalletCount)}</strong></span>
        <span><b>已選工件</b><strong>${escapeHtml(stats.itemCount)}</strong></span>
        <span><b>已選今日完成</b><strong>${escapeHtml(stats.dbCompletedQty)}</strong></span>
        <span><b>已選今日不良</b><strong>${escapeHtml(stats.dbDefectQty)}</strong></span>
        <span><b>已選缺料 / 跳過</b><strong>${escapeHtml(stats.skippedCount)}</strong></span>
        <span><b>已選目前剩餘</b><strong>${escapeHtml(stats.hasDbDailyQuantity ? stats.dbRemainingQty : stats.beforeRemainingQty)}</strong></span>
        <span><b>畫面輸入</b><strong>${escapeHtml(stats.completedQty)}</strong></span>
        <span><b>預覽後剩餘</b><strong>${escapeHtml(stats.previewRemainingQty)}</strong></span>
      </div>
    </section>
  `;
}

function hmcDefects() {
  const plan = hmcActivePlan();
  if (!plan.defects) plan.defects = {};
  return plan.defects;
}

function resetHmcDailyCheckSaveState(status = "idle") {
  hmcDailyCheckSaveState.status = status;
  hmcDailyCheckSaveState.code = "";
  hmcDailyCheckSaveState.message = "";
  hmcDailyCheckSaveState.rowCount = 0;
  hmcDailyCheckSaveState.completedQty = 0;
  hmcDailyCheckSaveState.defectQty = 0;
  hmcDailyCheckSaveState.shortageOrSkippedCount = 0;
  hmcDailyCheckSaveState.dailyCheckStatus = "";
  hmcDailyCheckSaveState.savedAt = "";
}

function hmcDailyCheckItemId(work) {
  return work.worklistItemId || work.dbRowId || "";
}

// Validation variant for daily-check inputs. Must NOT reuse the
// hmcNonNegativeInteger name: that number-returning helper feeds the setup
// payload builder, and a duplicate declaration would shadow it (S6 live-gate
// regression: palletNo became {ok,value} and the save RPC rejected it).
function hmcParseNonNegativeIntegerField(value, fieldLabel) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return { ok: true, value: 0 };
  if (!/^\d+$/.test(rawValue)) {
    return { ok: false, message: `${fieldLabel} 必須是 0 或正整數。` };
  }
  return { ok: true, value: Number(rawValue) };
}

function hmcDailyCheckRpcConfigured() {
  return canReadHmcWorklistFromSupabase();
}

function hmcClearDailyQuantityReadCache() {
  hmcReportState.dailyQuantityReadCache = {};
}

async function hmcDailyCheckRpcFetch(payload) {
  const result = await supabaseFetch("rpc/save_hmc_daily_quantity_check", {
    method: "POST",
    body: JSON.stringify({ payload }),
    prefer: "return=representation",
  });
  if (result?.status === "error") {
    const error = new Error(machtileStrictErrorMessage(result.code) || result.message || "每日盤點 RPC 回傳錯誤。");
    error.code = result.code || "";
    throw error;
  }
  return result;
}

function buildHmcDailyCheckPayload() {
  const readState = hmcCurrentWorklistReadState();
  const selected = hmcDailyCheckEditableSelectedItems();
  const note = ($("#hmcHandoverNote")?.value || "").trim();
  const items = [];

  if (readState.status !== "ok" || !readState.worklist?.id) {
    return { ok: false, message: "請先讀取本班加工清單，才能儲存每日盤點。" };
  }

  if (note.length > 1000) {
    return { ok: false, message: "備註不可超過 1000 字。" };
  }

  for (const item of selected) {
    const worklistItemId = hmcDailyCheckItemId(item.work);
    if (!worklistItemId) continue;

    const completed = hmcParseNonNegativeIntegerField(hmcQuantities()[item.key], "今日完成");
    if (!completed.ok) return completed;

    const defect = hmcParseNonNegativeIntegerField(hmcDefects()[item.key], "今日不良");
    if (!defect.ok) return defect;

    items.push({
      worklistItemId,
      completedQty: completed.value,
      defectQty: defect.value,
      shortageOrSkipped: Boolean(hmcSkipped()[item.key]),
      quantityNote: note,
    });
  }

  if (!items.length) {
    return { ok: false, message: "目前沒有可儲存的項目；只有未送審或退回項目可以送出每日盤點。" };
  }

  return {
    ok: true,
    payload: {
      machineCode: readState.worklist.machineCode || hmcRouteMachineKey(),
      shiftScope: readState.worklist.shiftScope || hmcReportState.shift,
      workDate: hmcDailyQuantityWorkDate(),
      items,
    },
  };
}

function hmcCanSaveDailyCheck() {
  return hmcDailyCheckRpcConfigured()
    && hmcCurrentWorklistReadState().status === "ok"
    && hmcDailyCheckEditableSelectedItems().length > 0
    && hmcDailyCheckSaveState.status !== "saving";
}

function hmcDailyCheckStatusPanel() {
  const state = hmcDailyCheckSaveState;
  if (state.status === "idle") {
    return `<p>每日盤點送出後為待複核；主管確認前不是正式報工。</p>`;
  }

  const isError = state.status === "error";
  const titleMap = {
    saving: "正在送出每日盤點...",
    success: "每日盤點已送出",
    error: "每日盤點送出失敗",
  };

  return `
    <div class="hmc-daily-check-status ${isError ? "is-error" : "is-ok"}">
      <strong>${escapeHtml(titleMap[state.status] || "每日盤點狀態")}</strong>
      <span>${escapeHtml(state.message || state.code || "-")}</span>
      ${state.dailyCheckStatus ? `<small>狀態：${escapeHtml(state.dailyCheckStatus)}</small>` : ""}
      ${state.rowCount ? `<small>筆數：${escapeHtml(state.rowCount)}，完成 ${escapeHtml(state.completedQty)}，不良 ${escapeHtml(state.defectQty)}</small>` : ""}
      ${state.correctedRowCount ? `<small>退回修正：${escapeHtml(state.correctedRowCount)} 筆</small>` : ""}
      ${state.newRowCount ? `<small>新增送審：${escapeHtml(state.newRowCount)} 筆</small>` : ""}
    </div>
  `;
}

function hmcDailyCheckSavePanel() {
  const canSave = hmcCanSaveDailyCheck();
  const saving = hmcDailyCheckSaveState.status === "saving";
  const rejectedCount = hmcDailyCheckRejectedSelectedCount();
  const editableCount = hmcDailyCheckEditableSelectedItems().length;
  const actionLabel = rejectedCount ? "修正後重新送審" : "儲存每日盤點";
  const helperText = rejectedCount
    ? `已選 ${rejectedCount} 筆退回項目；修正數量後會重新送審為待複核。`
    : `可送出 ${editableCount} 筆每日盤點；主管確認前不是正式報工。`;

  return `
    <section class="hmc-daily-check-panel" aria-label="HMC daily quantity check save">
      <div>
        <span>每日數量盤點</span>
        <strong>${escapeHtml(actionLabel)}</strong>
        <p>${escapeHtml(helperText)}</p>
      </div>
      ${hmcDailyCheckStatusPanel()}
      <button type="button" data-hmc-save-daily-check ${canSave ? "" : "disabled aria-disabled=\"true\""}>
        ${saving ? "處理中..." : escapeHtml(actionLabel)}
      </button>
      <em>送出後由主管複核，確認前不是正式報工；不同步 SoftNet。</em>
    </section>
  `;
}

function hmcDailyCheckReviewStatusFilter() {
  const params = new URLSearchParams(window.location.search);
  const status = (params.get("status") || "pending_review").trim();
  return ["pending_review", "confirmed", "rejected", "all"].includes(status) ? status : "pending_review";
}

function hmcDailyCheckReviewCacheKey(
  machineCode = hmcRouteMachineKey(),
  shift = hmcReportState.shift,
  workDate = hmcDailyQuantityWorkDate(),
  status = hmcDailyCheckReviewStatusFilter()
) {
  return `${machineCode || "HMC-01"}:${shift || "day"}:${workDate || "-"}:${status || "pending_review"}`;
}

function hmcDailyCheckReviewReadState() {
  if (!canReadHmcWorklistFromSupabase()) {
    return { status: "not_configured", message: "連線設定未完成，無法讀取。", rows: [] };
  }
  const key = hmcDailyCheckReviewCacheKey();
  return hmcDailyCheckReviewState.cache[key] || { status: "idle", message: "Review rows have not been loaded.", rows: [] };
}

function resetHmcDailyCheckReviewAction(status = "idle") {
  hmcDailyCheckReviewState.action = {
    status,
    action: "",
    code: "",
    message: "",
    requestedCount: 0,
    updatedCount: 0,
  };
}

function hmcDailyCheckReviewPendingRows() {
  const rows = hmcDailyCheckReviewReadState().rows;
  return (Array.isArray(rows) ? rows : []).filter((row) => row.dailyCheckStatus === "pending_review" && row.quantityId);
}

async function hmcDailyCheckReviewRpcFetch(quantityIds, reviewAction, reviewNote) {
  return hmcDevAnonRpcFetch("review_hmc_daily_quantity_check", {
    p_quantity_ids: Array.isArray(quantityIds) ? quantityIds : [],
    p_review_action: reviewAction,
    p_review_note: reviewNote || null,
    p_confirm_review: true,
  });
}

function hmcReviewStatusLabel(status) {
  const labels = {
    pending_review: "待主管確認",
    confirmed: "已確認",
    rejected: "已退回",
    all: "全部",
    not_started: "尚未送審",
  };
  return labels[status] || status || "-";
}

function hmcDailyCheckStatusDescription(status) {
  const descriptions = {
    pending_review: "作業員已送出每日盤點，等待主管確認。",
    confirmed: "主管已確認，可作為當日盤點結果；尚未轉正式報工。",
    rejected: "主管已退回，後續需要修正再送審。",
    not_started: "尚未送出每日盤點。",
  };
  return descriptions[status] || "每日盤點狀態待確認。";
}

function hmcReviewStatusClass(status) {
  if (status === "confirmed") return "is-confirmed";
  if (status === "rejected") return "is-rejected";
  if (status === "pending_review") return "is-pending";
  return "is-muted";
}

function normalizeHmcDailyCheckReviewRows(rows, quantityRows = []) {
  const quantityIdByItemId = new Map(
    (Array.isArray(quantityRows) ? quantityRows : [])
      .filter((row) => row?.worklist_item_id && row?.id)
      .map((row) => [row.worklist_item_id, row.id])
  );
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    quantityId: row.quantity_id || quantityIdByItemId.get(row.worklist_item_id) || "",
    workDate: row.work_date || hmcDailyQuantityWorkDate(),
    machineCode: row.machine_code || hmcRouteMachineKey(),
    shiftScope: row.shift_scope || hmcReportState.shift,
    worklistId: row.worklist_id || "",
    palletId: row.pallet_id || "",
    palletNo: Number(row.pallet_no || 0),
    fixtureCode: row.fixture_code || "",
    fixtureName: row.fixture_name || "",
    positionCode: row.position_code || "",
    workpieceName: row.workpiece_name || row.part_no || "-",
    workNo: row.work_order_no || row.work_order_id || "-",
    operationId: row.operation_id || "-",
    operationName: row.operation_name || "-",
    partNo: row.part_no || "-",
    plannedQty: Number(row.planned_qty || 0),
    completedQtyBefore: Number(row.completed_qty_before || 0),
    remainingQtyBeforeToday: Number(row.remaining_qty_before_today || 0),
    todayCompletedQty: Number(row.today_completed_qty || 0),
    todayDefectQty: Number(row.today_defect_qty || 0),
    remainingQty: Number(row.remaining_qty || 0),
    shortageOrSkipped: Boolean(row.shortage_or_skipped),
    quantityNote: row.quantity_note || "",
    sourceType: row.source_type || "no_summary",
    dailyCheckStatus: row.daily_check_status || "not_started",
    reviewedAt: row.reviewed_at || "",
    reviewedBy: row.reviewed_by || "",
    reviewNote: row.review_note || "",
    conversionStatus: row.conversion_status || "not_converted",
    formalReportDraftId: row.formal_report_draft_id || "",
    lastReportedAt: row.last_reported_at || "",
    quantityUpdatedAt: row.quantity_updated_at || "",
    palletSortOrder: Number(row.pallet_sort_order || row.pallet_no || 0),
    itemSortOrder: Number(row.item_sort_order || 0),
  }));
}

async function loadHmcDailyCheckReviewRows(machineCode, shift, workDate, statusFilter) {
  if (!machineCode || !["day", "night"].includes(shift) || !workDate) {
    return { status: "invalid_request", message: "machine, shift, and workDate are required.", rows: [] };
  }
  const tenantFilter = config.tenantId ? `&${hmcRestEq("tenant_id", config.tenantId)}` : "";
  const statusFilterQuery = statusFilter && statusFilter !== "all" ? hmcRestEq("daily_check_status", statusFilter) : "";
  const path = [
    "v_hmc_daily_quantity_field_rows?select=*",
    hmcRestEq("machine_code", machineCode),
    hmcRestEq("shift_scope", shift),
    hmcRestEq("work_date", workDate),
    statusFilterQuery,
    "order=pallet_no.asc,item_sort_order.asc,position_code.asc",
  ].filter(Boolean).join("&") + tenantFilter;
  const quantityPath = [
    "hmc_daily_worklist_item_quantities?select=id,worklist_item_id",
    hmcRestEq("machine_code", machineCode),
    hmcRestEq("shift_scope", shift),
    hmcRestEq("work_date", workDate),
    statusFilterQuery,
  ].filter(Boolean).join("&") + tenantFilter;
  const [rows, quantityRows] = await Promise.all([
    supabaseFetch(path),
    supabaseFetch(quantityPath),
  ]);
  const normalizedRows = normalizeHmcDailyCheckReviewRows(rows, quantityRows);
  return {
    status: normalizedRows.length ? "ok" : "empty",
    message: normalizedRows.length ? "Review rows loaded." : "No rows match the review filters.",
    rows: normalizedRows,
  };
}

function requestHmcDailyCheckReviewRead() {
  const machineCode = hmcRouteMachineKey();
  const shift = hmcReportState.shift;
  const workDate = hmcDailyQuantityWorkDate();
  const statusFilter = hmcDailyCheckReviewStatusFilter();
  const key = hmcDailyCheckReviewCacheKey(machineCode, shift, workDate, statusFilter);
  const current = hmcDailyCheckReviewState.cache[key];
  if (current && ["loading", "ok", "empty", "invalid_request", "error", "not_configured"].includes(current.status)) return;

  if (!canReadHmcWorklistFromSupabase()) {
    hmcDailyCheckReviewState.cache[key] = { status: "not_configured", message: "連線設定未完成，無法讀取。", rows: [] };
    return;
  }

  hmcDailyCheckReviewState.cache[key] = { status: "loading", message: "Loading daily check review rows...", rows: [] };
  loadHmcDailyCheckReviewRows(machineCode, shift, workDate, statusFilter)
    .then((result) => {
      hmcDailyCheckReviewState.cache[key] = result;
      if (currentRoutePath() === hmcDailyCheckReviewRoutePath() && hmcDailyCheckReviewCacheKey() === key) {
        renderHmcDailyCheckReviewRoute();
      }
    })
    .catch((error) => {
      hmcDailyCheckReviewState.cache[key] = {
        status: "error",
        message: error?.message || "Failed to load daily check review rows.",
        rows: [],
      };
      if (currentRoutePath() === hmcDailyCheckReviewRoutePath()) renderHmcDailyCheckReviewRoute();
    });
}

function hmcDailyCheckReviewStats(rows = hmcDailyCheckReviewReadState().rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    rowCount: safeRows.length,
    palletCount: new Set(safeRows.map((row) => row.palletId || row.palletNo).filter(Boolean)).size,
    pendingCount: safeRows.filter((row) => row.dailyCheckStatus === "pending_review").length,
    confirmedCount: safeRows.filter((row) => row.dailyCheckStatus === "confirmed").length,
    rejectedCount: safeRows.filter((row) => row.dailyCheckStatus === "rejected").length,
    convertibleCount: safeRows.filter((row) => row.dailyCheckStatus === "confirmed" && row.conversionStatus === "not_converted").length,
    convertedCount: safeRows.filter((row) => row.conversionStatus === "draft_created").length,
    completedQty: safeRows.reduce((total, row) => total + (Number(row.todayCompletedQty) || 0), 0),
    defectQty: safeRows.reduce((total, row) => total + (Number(row.todayDefectQty) || 0), 0),
    shortageCount: safeRows.filter((row) => row.shortageOrSkipped).length,
    remainingQty: safeRows.reduce((total, row) => total + (Number(row.remainingQty) || 0), 0),
  };
}

function hmcDailyCheckReviewGroups(rows = hmcDailyCheckReviewReadState().rows) {
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = row.palletId || `pallet-${row.palletNo || 0}`;
    if (!groups.has(key)) groups.set(key, { palletNo: row.palletNo, fixtureName: row.fixtureName, rows: [] });
    groups.get(key).rows.push(row);
  });
  return Array.from(groups.values()).sort((a, b) => Number(a.palletNo || 0) - Number(b.palletNo || 0));
}

function hmcDailyCheckReviewUrl(overrides = {}) {
  const params = new URLSearchParams(window.location.search);
  return appRouteUrl("", {
    route: hmcDailyCheckReviewRoutePath(),
    machine: overrides.machine || hmcRouteMachineKey(),
    shift: overrides.shift || hmcReportState.shift,
    workDate: overrides.workDate || hmcDailyQuantityWorkDate(),
    status: overrides.status || hmcDailyCheckReviewStatusFilter(),
    worklistSource: params.get("worklistSource") || "db",
    quantitySource: params.get("quantitySource") || "db",
  });
}

function hmcRenderReviewFilterTabs() {
  const statuses = ["pending_review", "confirmed", "rejected", "all"];
  const shifts = ["day", "night"];
  const activeStatus = hmcDailyCheckReviewStatusFilter();
  const activeShift = hmcReportState.shift;
  return `
    <section class="hmc-review-filters" aria-label="HMC daily check review filters">
      <div>
        <strong>班別</strong>
        <span>${shifts.map((shift) => `<a class="${shift === activeShift ? "is-active" : ""}" href="${escapeHtml(hmcDailyCheckReviewUrl({ shift }))}">${escapeHtml(hmcShiftLabel(shift))}</a>`).join("")}</span>
      </div>
      <div>
        <strong>狀態</strong>
        <span>${statuses.map((status) => `<a class="${status === activeStatus ? "is-active" : ""}" href="${escapeHtml(hmcDailyCheckReviewUrl({ status }))}">${escapeHtml(hmcReviewStatusLabel(status))}</a>`).join("")}</span>
      </div>
    </section>
  `;
}

function hmcRenderReviewLegend() {
  return `
    <section class="hmc-review-legend" aria-label="HMC daily check review status legend">
      <span class="is-rejected">退回</span>
      <span class="is-pending">待確認</span>
      <span class="is-confirmed">已確認</span>
      <span class="is-selected">目前選取</span>
    </section>
  `;
}

function hmcRenderReviewReadStatus() {
  const state = hmcDailyCheckReviewReadState();
  if (state.status === "ok" || state.status === "empty") return "";
  const labelMap = {
    idle: "尚未讀取",
    loading: "正在讀取",
    ok: "已讀取每日盤點",
    empty: "沒有符合條件的盤點",
    invalid_request: "讀取條件不完整",
    not_configured: "複核資料尚未連線",
    error: "讀取失敗",
  };
  return `
    <section class="hmc-safe-banner hmc-review-read-status" aria-label="HMC daily check review read status">
      <strong>${escapeHtml(labelMap[state.status] || "讀取狀態")}</strong>
      <span>${escapeHtml(state.message || "-")}</span>
      <span>請確認日期、班別與狀態</span>
      <span>不轉正式報工</span>
    </section>
  `;
}

function hmcRenderReviewSummary() {
  const stats = hmcDailyCheckReviewStats();
  return `
    <section class="hmc-review-summary" aria-label="HMC daily check review summary">
      <div class="hmc-daily-summary-head">
        <div>
          <span>主管複核</span>
          <strong>${escapeHtml(hmcRouteMachineKey())} · ${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong>
        </div>
        <em>${escapeHtml(hmcDailyQuantityWorkDate())} / ${escapeHtml(hmcReviewStatusLabel(hmcDailyCheckReviewStatusFilter()))}</em>
      </div>
      <div class="hmc-daily-summary-grid">
        <span><b>待確認</b><strong>${escapeHtml(stats.pendingCount)}</strong></span>
        <span><b>已確認</b><strong>${escapeHtml(stats.confirmedCount)}</strong></span>
        <span><b>已退回</b><strong>${escapeHtml(stats.rejectedCount)}</strong></span>
        <span><b>今日完成</b><strong>${escapeHtml(stats.completedQty)}</strong></span>
      </div>
    </section>
  `;
}

function hmcRenderReviewAuthPanel() {
  if (!canReadHmcWorklistFromSupabase()) {
    return `
      <section class="hmc-report-card hmc-review-auth-panel" aria-label="HMC supervisor review auth">
        <strong>複核資料尚未連線</strong>
        <p>目前只能查看畫面資料，尚不能確認或退回。</p>
      </section>
    `;
  }

  if (machtileStrictMode()) {
    return `
      <section class="hmc-safe-banner is-quiet" aria-label="HMC supervisor review auth">
        <span>已以 ${escapeHtml(machtileAccountDisplay(machtileAuthState.email) || "登入帳號")} 登入 · 確認 / 退回需要主管以上權限</span>
      </section>
    `;
  }
  return `
    <section class="hmc-report-card hmc-review-auth-panel is-signed-in" aria-label="HMC supervisor review auth">
      <div>
        <span>免登入複核</span>
        <strong>可直接確認或退回</strong>
        <small>此頁只更新每日盤點狀態，不轉正式報工。</small>
      </div>
    </section>
  `;
}

function hmcRenderReviewActionStatus() {
  const actionState = hmcDailyCheckReviewState.action;
  if (!actionState || actionState.status === "idle") return "";
  const isError = actionState.status === "error";
  const labelMap = {
    reviewing: "正在送出主管確認...",
    success: "主管確認已更新",
    error: "主管確認失敗",
  };
  return `
    <div class="hmc-review-action-status ${isError ? "is-error" : "is-ok"}">
      <strong>${escapeHtml(labelMap[actionState.status] || actionState.status)}</strong>
      <span>${escapeHtml(actionState.message || actionState.code || "-")}</span>
      ${actionState.updatedCount ? `<small>已更新 ${escapeHtml(actionState.updatedCount)} 筆</small>` : ""}
    </div>
  `;
}

function hmcRenderReviewActionPanel() {
  return `
    <section class="hmc-report-card hmc-review-action-panel" aria-label="HMC supervisor review actions">
      <div class="hmc-review-action-copy">
        <span>主管複核</span>
        <strong>單筆駁回原因</strong>
        <p>下方每筆資料都有自己的確認 / 駁回按鈕；駁回前先在這裡填原因。</p>
      </div>
      ${hmcRenderReviewActionStatus()}
      <label class="hmc-review-note">
        <span>駁回原因</span>
        <textarea id="hmcReviewNote" rows="3" maxlength="1000" placeholder="駁回時必填；確認時可留空">${escapeHtml(hmcDailyCheckReviewState.reviewNote || "")}</textarea>
      </label>
    </section>
  `;
}

function hmcRenderReviewEmptyState() {
  const activeShift = hmcReportState.shift;
  const otherShift = activeShift === "night" ? "day" : "night";
  const activeStatus = hmcDailyCheckReviewStatusFilter();
  const currentDate = hmcDailyQuantityWorkDate();
  const reportUrl = hmcSetupBackToReportUrl(hmcRouteMachineKey(), activeShift);
  const showAllLink = activeStatus !== "all";
  return `
    <section class="hmc-report-card hmc-review-empty hmc-review-empty-action">
      <div>
        <span>目前沒有可複核資料</span>
        <strong>${escapeHtml(hmcShiftLabel(activeShift))} / ${escapeHtml(currentDate)} / ${escapeHtml(hmcReviewStatusLabel(activeStatus))} = 0 筆</strong>
        <p>這個班別與日期沒有資料。可切換班別，或回每日盤點新增資料。</p>
      </div>
      <div class="hmc-review-empty-actions">
        ${showAllLink ? `<a href="${escapeHtml(hmcDailyCheckReviewUrl({ status: "all" }))}">查看全部</a>` : ""}
        <a href="${escapeHtml(hmcDailyCheckReviewUrl({ shift: otherShift, status: "all" }))}">切換班別</a>
        <a href="${escapeHtml(reportUrl)}">回每日盤點</a>
      </div>
    </section>
  `;
}

function hmcShouldShowReviewEmptyState() {
  const readState = hmcDailyCheckReviewReadState();
  return ["ok", "empty"].includes(readState.status) && (!Array.isArray(readState.rows) || !readState.rows.length);
}

function hmcRenderReviewGroups() {
  const readState = hmcDailyCheckReviewReadState();
  if (["idle", "loading"].includes(readState.status)) {
    return `<section class="hmc-report-card hmc-review-empty"><strong>正在準備複核資料...</strong><p>讀取完成後會依交換盤分組顯示。</p></section>`;
  }
  if (!Array.isArray(readState.rows) || !readState.rows.length) {
    return "";
  }

  return hmcDailyCheckReviewGroups(readState.rows).map((group) => `
    <section class="hmc-report-card hmc-review-pallet-group">
      <header>
        <div>
          <span>第 ${escapeHtml(group.palletNo || "-")} 盤</span>
          <strong>${escapeHtml(group.fixtureName || "未命名交換盤")}</strong>
        </div>
        <em>${escapeHtml(group.rows.length)} 件工件</em>
      </header>
      <div class="hmc-review-table" role="table" aria-label="HMC daily check review rows">
        <div class="hmc-review-table-head" role="row">
          <span>工件</span>
          <span>今日完成</span>
          <span>不良</span>
          <span>剩餘</span>
          <span>狀態</span>
          <span>備註</span>
          <span>主管動作</span>
        </div>
        ${group.rows.map((row) => `
          <article class="hmc-review-row ${hmcReviewStatusClass(row.dailyCheckStatus)}" role="row">
            <div>
              <strong>${escapeHtml(row.workpieceName)}</strong>
              <small>${escapeHtml(row.workNo)} / ${escapeHtml(row.operationId)} / ${escapeHtml(row.positionCode || "-")}</small>
            </div>
            <span>${escapeHtml(row.todayCompletedQty)}</span>
            <span>${escapeHtml(row.todayDefectQty)}</span>
            <span>${escapeHtml(row.remainingQty)}</span>
            <span><b class="hmc-review-status ${hmcReviewStatusClass(row.dailyCheckStatus)}">${escapeHtml(hmcReviewStatusLabel(row.dailyCheckStatus))}</b></span>
            <span>${hmcRenderReviewNoteCell(row)}</span>
            <span class="hmc-review-row-actions">
              ${row.dailyCheckStatus === "pending_review" && row.quantityId ? `
                <button type="button" data-hmc-review-row-action="confirm" data-hmc-review-id="${escapeHtml(row.quantityId)}">確認</button>
                <button type="button" class="is-danger" data-hmc-review-row-action="reject" data-hmc-review-id="${escapeHtml(row.quantityId)}">駁回</button>
              ` : row.dailyCheckStatus === "confirmed" && row.conversionStatus === "not_converted" && row.quantityId ? `
                <button type="button" class="is-danger" data-hmc-review-row-action="reject" data-hmc-review-id="${escapeHtml(row.quantityId)}">退回修正</button>
                ${row.reviewedAt ? `<small>已確認 ${escapeHtml(machtileFormatAuditTime(row.reviewedAt))}</small>` : ""}
              ` : row.dailyCheckStatus === "confirmed" ? `
                <small>已轉入報表；要改請先修訂重發</small>
              ` : `
                <small>${row.reviewedAt ? `已處理 ${escapeHtml(machtileFormatAuditTime(row.reviewedAt))}` : "無可執行動作"}</small>
              `}
            </span>
          </article>
        `).join("")}
      </div>
    </section>
  `).join("");
}

function renderHmcDailyCheckReviewRoute() {
  document.body.classList.remove("station-select-route-mode");
  document.body.classList.remove("work-list-route-mode");
  document.body.classList.remove("work-detail-route-mode");
  document.body.classList.remove("report-work-route-mode");
  document.body.classList.add("hmc-report-route-mode");

  const stationSelectRoot = $("#stationSelectRoute");
  if (stationSelectRoot) stationSelectRoot.hidden = true;
  const workListRoot = $("#workListRoute");
  if (workListRoot) workListRoot.hidden = true;
  const workDetailRoot = $("#workDetailRoute");
  if (workDetailRoot) workDetailRoot.hidden = true;
  const reportWorkRoot = $("#reportWorkRoute");
  if (reportWorkRoot) reportWorkRoot.hidden = true;
  const hmcReportRoot = $("#hmcReportRoute");
  if (hmcReportRoot) hmcReportRoot.hidden = true;
  const hmcDraftsRoot = $("#hmcFormalReportDraftsRoute");
  if (hmcDraftsRoot) hmcDraftsRoot.hidden = true;
  const hmcFormalReportsRoot = $("#hmcFormalReportsRoute");
  if (hmcFormalReportsRoot) hmcFormalReportsRoot.hidden = true;

  let routeRoot = $("#hmcDailyCheckReviewRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "hmcDailyCheckReviewRoute";
    routeRoot.className = "hmc-report-route hmc-review-route";
    routeRoot.setAttribute("role", "main");
    routeRoot.setAttribute("aria-labelledby", "hmcReviewTitle");
    document.body.appendChild(routeRoot);
  }
  routeRoot.className = "hmc-report-route hmc-review-route";
  routeRoot.hidden = false;

  hmcReportState.shift = new URLSearchParams(window.location.search).get("shift") === "night" ? "night" : "day";
  requestHmcDailyCheckReviewRead();

  routeRoot.innerHTML = `
    <section class="hmc-report-shell">
      <header class="hmc-report-hero">
        <div>
          <p class="eyebrow">HMC 每日盤點 / 主管複核</p>
          <h1 id="hmcReviewTitle">每日盤點複核清單</h1>
          <p>確認或退回作業員每日盤點；此頁不轉正式報工。</p>
        </div>
        <div class="hmc-report-hero-actions">
          <a class="hmc-secondary-action" href="${escapeHtml(hmcGuideRouteUrl(hmcRouteMachineLabel(), hmcReportState.shift))}">使用說明</a>
          <a class="hmc-secondary-action" href="${escapeHtml(hmcDailyCheckReviewUrl({ status: "pending_review" }))}">待確認</a>
          <a href="${escapeHtml(hmcReportDashboardBackUrl())}">返回機台卡片</a>
        </div>
      </header>

      <section class="hmc-safe-banner is-quiet" aria-label="HMC review safety boundary">
        <span>複核模式 · 退回需填原因 · 不轉正式報工</span>
      </section>

      ${hmcRenderReviewFilterTabs()}
      ${hmcRenderReviewLegend()}
      ${hmcRenderReviewReadStatus()}
      ${hmcShouldShowReviewEmptyState() ? hmcRenderReviewEmptyState() : ""}
      ${hmcRenderReviewSummary()}
      ${hmcRenderReviewAuthPanel()}
      ${hmcRenderReviewActionPanel()}
      ${hmcRenderReviewOneClickPanel()}
      ${hmcRenderReviewConversionPanel()}
      ${hmcRenderReviewGroups()}

    </section>
  `;

  bindHmcDailyCheckReviewEvents();
}

let hmcOneClickState = {
  status: "idle",
  confirming: false,
  step: "",
  message: "",
  reportNo: "",
  reportId: "",
};

function hmcRenderReviewOneClickPanel() {
  const stats = hmcDailyCheckReviewStats();
  const actionable = stats.pendingCount + stats.convertibleCount;
  if (!actionable || !canReadHmcWorklistFromSupabase()) return "";

  const state = hmcOneClickState;
  if (state.status === "success") {
    return `
      <section class="hmc-report-card hmc-review-conversion-panel is-active" aria-label="HMC one-click confirm and issue">
        <div class="hmc-review-conversion-copy">
          <span>一鍵確認並發行</span>
          <strong>已發行正式報表 ${escapeHtml(state.reportNo || "")}</strong>
          ${state.reportId ? `<a class="hmc-draft-inline-link" href="${escapeHtml(hmcFormalReportDetailUrl(state.reportId))}">查看正式報表</a>` : ""}
        </div>
      </section>
    `;
  }
  if (state.status === "running") {
    return `
      <section class="hmc-report-card hmc-review-conversion-panel is-active" aria-label="HMC one-click confirm and issue">
        <div class="hmc-review-conversion-copy">
          <span>一鍵確認並發行</span>
          <strong>${escapeHtml(state.message || "處理中...")}</strong>
        </div>
      </section>
    `;
  }

  const summaryParts = [];
  if (stats.pendingCount) summaryParts.push(`確認 ${stats.pendingCount} 筆待確認`);
  summaryParts.push("建立草稿並直接發行正式報表");
  const controls = state.confirming
    ? `
      <div class="hmc-review-conversion-confirm">
        <p>將一次完成：${escapeHtml(summaryParts.join("、"))}。發行後不可修改，只能修訂重發。</p>
        <div class="hmc-review-conversion-confirm-actions">
          <button type="button" data-hmc-oneclick-confirm>確定執行</button>
          <button type="button" class="hmc-link-button" data-hmc-oneclick-cancel>取消</button>
        </div>
      </div>
    `
    : `
      <button type="button" class="hmc-review-conversion-button" data-hmc-oneclick>
        一鍵確認並發行${stats.pendingCount ? `（含 ${escapeHtml(stats.pendingCount)} 筆待確認）` : ""}
      </button>
    `;

  return `
    <section class="hmc-report-card hmc-review-conversion-panel is-active" aria-label="HMC one-click confirm and issue">
      <div class="hmc-review-conversion-copy">
        <span>一鍵確認並發行</span>
        <strong>數字都沒問題時，一步完成確認 → 草稿 → 發行</strong>
        <small>有要退回的請先用下方單筆駁回，再回來按這裡。</small>
      </div>
      ${state.status === "error" ? `<p class="hmc-draft-cancel-error">${escapeHtml(state.message)}</p>` : ""}
      ${controls}
    </section>
  `;
}

async function hmcRunOneClickConfirmAndFinalize() {
  const machineCode = hmcRouteMachineKey();
  const workDate = hmcDailyQuantityWorkDate();
  const shiftScope = hmcReportState.shift;
  const pending = hmcDailyCheckReviewPendingRows();

  hmcOneClickState = { status: "running", confirming: false, step: "confirm", message: pending.length ? `正在確認 ${pending.length} 筆...` : "正在建立正式報表草稿...", reportNo: "", reportId: "" };
  renderHmcDailyCheckReviewRoute();

  try {
    if (pending.length) {
      await hmcDailyCheckReviewRpcFetch(pending.map((row) => row.quantityId), "confirm", null);
      hmcDailyCheckReviewState.cache = {};
      hmcClearDailyQuantityReadCache();
    }
    hmcOneClickState.step = "convert";
    hmcOneClickState.message = "正在建立正式報表草稿...";
    renderHmcDailyCheckReviewRoute();
    const conv = await hmcDevAnonRpcFetch("convert_hmc_daily_checks_to_formal_draft", {
      p_machine_code: machineCode,
      p_work_date: workDate,
      p_shift_scope: shiftScope,
      p_confirm: true,
      p_note: "一鍵確認並發行",
    });
    hmcOneClickState.step = "finalize";
    hmcOneClickState.message = `草稿 ${conv.draftNo || ""} 已建立，正在發行...`;
    renderHmcDailyCheckReviewRoute();
    const fin = await hmcDevAnonRpcFetch("finalize_hmc_formal_report_draft", {
      p_draft_id: conv.draftId,
      p_confirm: true,
      p_note: "一鍵確認並發行",
    });
    hmcOneClickState = { status: "success", confirming: false, step: "done", message: "", reportNo: fin.reportNo || "", reportId: fin.reportId || "" };
    hmcDailyCheckReviewState.cache = {};
    hmcClearDailyQuantityReadCache();
    hmcFormalReportDraftsState.list = { status: "idle", message: "", rows: [] };
    hmcFormalReportsState.list = { status: "idle", message: "", rows: [] };
    showToast(`已發行正式報表 ${fin.reportNo || ""}`.trim());
  } catch (error) {
    const stepLabel = { confirm: "批次確認", convert: "建立草稿", finalize: "發行" }[hmcOneClickState.step] || "執行";
    const hint = error?.code === "OPEN_DRAFT_EXISTS" ? "；已有開啟中的草稿，請到草稿清單手動發行。" : "";
    hmcOneClickState = { ...hmcOneClickState, status: "error", confirming: false, message: `${stepLabel}失敗：${error?.message || "未知錯誤"}${hint}` };
    hmcDailyCheckReviewState.cache = {};
    hmcClearDailyQuantityReadCache();
  }
  renderHmcDailyCheckReviewRoute();
}

async function hmcRunDailyCheckReview(quantityIds, reviewAction) {
  const ids = Array.from(new Set((Array.isArray(quantityIds) ? quantityIds : []).filter(Boolean)));
  const note = ($("#hmcReviewNote")?.value || hmcDailyCheckReviewState.reviewNote || "").trim();
  hmcDailyCheckReviewState.reviewNote = note;

  if (!ids.length) {
    hmcDailyCheckReviewState.action = {
      status: "error",
      action: reviewAction,
      code: "NO_QUANTITY_IDS",
      message: "沒有可確認 / 駁回的每日盤點資料。",
      requestedCount: 0,
      updatedCount: 0,
    };
    renderHmcDailyCheckReviewRoute();
    return;
  }

  if (reviewAction === "reject" && !note) {
    hmcDailyCheckReviewState.action = {
      status: "error",
      action: reviewAction,
      code: "REJECT_NOTE_REQUIRED",
      message: "駁回前請先填寫駁回原因。",
      requestedCount: ids.length,
      updatedCount: 0,
    };
    renderHmcDailyCheckReviewRoute();
    return;
  }

  hmcDailyCheckReviewState.action = {
    status: "reviewing",
    action: reviewAction,
    code: "",
    message: reviewAction === "confirm" ? "正在確認每日盤點..." : "正在駁回每日盤點...",
    requestedCount: ids.length,
    updatedCount: 0,
  };
  renderHmcDailyCheckReviewRoute();

  try {
    const result = await hmcDailyCheckReviewRpcFetch(ids, reviewAction, note);
    hmcDailyCheckReviewState.action = {
      status: "success",
      action: reviewAction,
      code: result.code || "DAILY_CHECK_REVIEWED",
      message: result.message || (reviewAction === "confirm" ? "每日盤點已確認。" : "每日盤點已駁回。"),
      requestedCount: Number(result.requestedCount || ids.length),
      updatedCount: Number(result.updatedCount || 0),
    };
    hmcDailyCheckReviewState.cache = {};
    hmcClearDailyQuantityReadCache();
    showToast(reviewAction === "confirm" ? "每日盤點已確認" : "每日盤點已駁回");
  } catch (error) {
    hmcDailyCheckReviewState.action = {
      status: "error",
      action: reviewAction,
      code: error?.code || "DAILY_CHECK_REVIEW_FAILED",
      message: error?.message || "主管確認 / 駁回失敗。",
      requestedCount: ids.length,
      updatedCount: 0,
    };
  }

  renderHmcDailyCheckReviewRoute();
}

function resetHmcDailyCheckReviewConversion(status = "idle") {
  hmcDailyCheckReviewState.conversion = {
    status,
    confirming: false,
    code: "",
    message: "",
    draftNo: "",
    draftId: "",
    itemCount: 0,
  };
}

function hmcConversionErrorMessage(conv) {
  const codeMap = {
    OPEN_DRAFT_EXISTS: "此機台 / 日期 / 班別已有開啟中的草稿，不可重複建立。",
    NO_CONVERTIBLE_ROWS: "沒有可轉換的已確認資料。",
    FORBIDDEN: "需要主管 / 排程權限才能建立草稿。",
    AUTH_REQUIRED: "請先以主管 / 排程帳號登入。",
    CONFIRM_REQUIRED: "請先確認再建立草稿。",
    INVALID_SHIFT_SCOPE: "班別資料不正確。",
    TENANT_REQUIRED: "租戶資料不完整。",
  };
  return codeMap[conv.code] || conv.message || "建立正式報表草稿失敗。";
}

function hmcRenderReviewConversionActionStatus() {
  const conv = hmcDailyCheckReviewState.conversion;
  if (!conv || conv.status === "idle") return "";
  const isError = conv.status === "error";
  const labelMap = {
    converting: "正在建立正式報表草稿...",
    success: "已建立正式報表草稿",
    error: "建立正式報表草稿失敗",
  };
  const detail = isError
    ? hmcConversionErrorMessage(conv)
    : (conv.status === "success"
      ? `草稿 ${conv.draftNo || "-"} / ${conv.itemCount || 0} 筆`
      : (conv.message || "-"));
  return `
    <div class="hmc-review-action-status ${isError ? "is-error" : "is-ok"}">
      <strong>${escapeHtml(labelMap[conv.status] || conv.status)}</strong>
      <span>${escapeHtml(detail)}</span>
      ${conv.status === "success" && conv.draftId ? `<a class="hmc-draft-inline-link" href="${escapeHtml(hmcFormalReportDraftDetailUrl(conv.draftId))}">查看此草稿</a>` : ""}
    </div>
  `;
}

function hmcRenderReviewConversionPanel() {
  const stats = hmcDailyCheckReviewStats();
  if (!stats.confirmedCount) return "";

  const conv = hmcDailyCheckReviewState.conversion;
  const machineLabel = hmcRouteMachineKey();
  const shiftLabel = hmcShiftLabel(hmcReportState.shift);
  const workDate = hmcDailyQuantityWorkDate();
  const head = `
    <div class="hmc-review-conversion-copy">
      <span>正式報表草稿</span>
      <strong>把已確認的每日盤點轉成正式報表草稿</strong>
      <small>${escapeHtml(machineLabel)} · ${escapeHtml(shiftLabel)} · ${escapeHtml(workDate)}｜僅建立草稿，不送正式報工。</small>
      <a class="hmc-draft-inline-link" href="${escapeHtml(hmcFormalReportDraftsUrl())}">查看正式報表草稿清單</a>
    </div>
    ${hmcRenderReviewConversionActionStatus()}
  `;

  if (stats.convertibleCount === 0) {
    const note = stats.convertedCount
      ? `已有 ${stats.convertedCount} 筆建立草稿；同機台 / 日期 / 班別不可重複建立。`
      : "目前沒有可轉換的已確認資料。";
    return `
      <section class="hmc-report-card hmc-review-conversion-panel" aria-label="HMC formal report draft conversion">
        ${head}
        <p class="hmc-review-conversion-note">${escapeHtml(note)}</p>
      </section>
    `;
  }

  if (!canReadHmcWorklistFromSupabase()) {
    return `
      <section class="hmc-report-card hmc-review-conversion-panel" aria-label="HMC formal report draft conversion">
        ${head}
        <p class="hmc-review-conversion-note">尚未連線資料庫，無法建立草稿。</p>
      </section>
    `;
  }

  const controls = conv.confirming
    ? `
      <div class="hmc-review-conversion-confirm">
        <p>確定把 ${escapeHtml(stats.convertibleCount)} 筆已確認資料建立為正式報表草稿？</p>
        <div class="hmc-review-conversion-confirm-actions">
          <button type="button" data-hmc-review-convert-confirm>確定建立</button>
          <button type="button" class="hmc-link-button" data-hmc-review-convert-cancel>取消</button>
        </div>
      </div>
    `
    : `
      <button type="button" class="hmc-review-conversion-button" data-hmc-review-convert ${conv.status === "converting" ? "disabled" : ""}>
        建立正式報表草稿（${escapeHtml(stats.convertibleCount)} 筆已確認）
      </button>
    `;

  return `
    <section class="hmc-report-card hmc-review-conversion-panel is-active" aria-label="HMC formal report draft conversion">
      ${head}
      <p class="hmc-review-conversion-note">${machtileStrictMode() ? "建立草稿需要排程 / 主管權限；" : "免登入即可建立草稿（Dev）；"}僅建立草稿，不送正式報工。</p>
      ${controls}
    </section>
  `;
}

async function hmcRunDailyCheckConversion() {
  const machineCode = hmcRouteMachineKey();
  const workDate = hmcDailyQuantityWorkDate();
  const shiftScope = hmcReportState.shift;

  hmcDailyCheckReviewState.conversion = {
    status: "converting",
    confirming: false,
    code: "",
    message: "正在建立正式報表草稿...",
    draftNo: "",
    itemCount: 0,
  };
  renderHmcDailyCheckReviewRoute();

  try {
    const result = await hmcDevAnonRpcFetch("convert_hmc_daily_checks_to_formal_draft", {
      p_machine_code: machineCode,
      p_work_date: workDate,
      p_shift_scope: shiftScope,
      p_confirm: true,
      p_note: null,
    });
    hmcDailyCheckReviewState.conversion = {
      status: "success",
      confirming: false,
      code: result.code || "DRAFT_CREATED",
      message: result.message || "已建立正式報表草稿。",
      draftNo: result.draftNo || "",
      draftId: result.draftId || "",
      itemCount: Number(result.itemCount || 0),
    };
    hmcDailyCheckReviewState.cache = {};
    hmcClearDailyQuantityReadCache();
    showToast(`已建立草稿 ${result.draftNo || ""}`.trim());
  } catch (error) {
    hmcDailyCheckReviewState.conversion = {
      status: "error",
      confirming: false,
      code: error?.code || "DRAFT_CONVERSION_FAILED",
      message: error?.message || "建立正式報表草稿失敗。",
      draftNo: "",
      itemCount: 0,
    };
  }

  renderHmcDailyCheckReviewRoute();
}

function bindHmcDailyCheckReviewEvents() {
  $("#hmcReviewNote")?.addEventListener("input", (event) => {
    hmcDailyCheckReviewState.reviewNote = event.currentTarget?.value || "";
  });

  $("[data-hmc-oneclick]")?.addEventListener("click", () => {
    hmcOneClickState = { ...hmcOneClickState, status: "idle", confirming: true, message: "" };
    renderHmcDailyCheckReviewRoute();
  });
  $("[data-hmc-oneclick-cancel]")?.addEventListener("click", () => {
    hmcOneClickState = { ...hmcOneClickState, status: "idle", confirming: false, message: "" };
    renderHmcDailyCheckReviewRoute();
  });
  $("[data-hmc-oneclick-confirm]")?.addEventListener("click", () => {
    hmcRunOneClickConfirmAndFinalize();
  });

  $$("[data-hmc-review-row-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.hmcReviewRowAction === "reject" ? "reject" : "confirm";
      hmcRunDailyCheckReview([button.dataset.hmcReviewId], action);
    });
  });

  $("[data-hmc-review-convert]")?.addEventListener("click", () => {
    hmcDailyCheckReviewState.conversion = {
      ...hmcDailyCheckReviewState.conversion,
      status: hmcDailyCheckReviewState.conversion.status === "converting" ? "converting" : "idle",
      confirming: true,
      code: "",
      message: "",
    };
    renderHmcDailyCheckReviewRoute();
  });

  $("[data-hmc-review-convert-cancel]")?.addEventListener("click", () => {
    hmcDailyCheckReviewState.conversion = {
      ...hmcDailyCheckReviewState.conversion,
      confirming: false,
    };
    renderHmcDailyCheckReviewRoute();
  });

  $("[data-hmc-review-convert-confirm]")?.addEventListener("click", () => {
    hmcRunDailyCheckConversion();
  });
}

// ---- HMC formal report draft read-only UI (Sprint 4) ----

const hmcFormalReportDraftsState = {
  list: { status: "idle", message: "", rows: [] },
  detail: {},
  cancel: { confirming: false, status: "idle", code: "", message: "", reason: "", draftId: "" },
  finalize: { confirming: false, status: "idle", code: "", message: "", note: "", draftId: "" },
};

function hmcResetFormalReportDraftCancelState() {
  hmcFormalReportDraftsState.cancel = { confirming: false, status: "idle", code: "", message: "", reason: "", draftId: "" };
}

function hmcResetFormalReportDraftFinalizeState() {
  hmcFormalReportDraftsState.finalize = { confirming: false, status: "idle", code: "", message: "", note: "", draftId: "" };
}

function hmcFormalReportDraftsUrl(overrides = {}) {
  return appRouteUrl("", { route: hmcFormalReportDraftsRoutePath(), ...overrides });
}

function hmcFormalReportDraftDetailUrl(draftId) {
  return appRouteUrl("", { route: hmcFormalReportDraftsRoutePath(), draftId });
}

function hmcFormalReportDraftIdParam() {
  return (new URLSearchParams(window.location.search).get("draftId") || "").trim();
}

function hmcFormalReportDraftStatusLabel(status) {
  return { draft: "草稿", cancelled: "已取消", finalized: "已定稿" }[status] || status || "-";
}

function hmcFormalReportDraftShortId(value) {
  const text = String(value || "");
  return text ? `${text.slice(0, 8)}…` : "-";
}

function normalizeHmcFormalReportDraft(row) {
  return {
    id: row.id || "",
    draftNo: row.draft_no || "-",
    machineCode: row.machine_code || "-",
    machineId: row.machine_id || "",
    workDate: row.work_date || "-",
    shiftScope: row.shift_scope || "-",
    status: row.status || "draft",
    itemCount: Number(row.item_count || 0),
    completedQtyTotal: Number(row.completed_qty_total || 0),
    defectQtyTotal: Number(row.defect_qty_total || 0),
    shortageOrSkippedCount: Number(row.shortage_or_skipped_count || 0),
    note: row.note || "",
    cancelNote: row.cancel_note || "",
    cancelledAt: row.cancelled_at || "",
    formalReportId: row.formal_report_id || "",
    finalizedAt: row.finalized_at || "",
    createdAt: row.created_at || "",
  };
}

function normalizeHmcFormalReportDraftItem(row) {
  return {
    id: row.id || "",
    palletNo: Number(row.pallet_no || 0),
    positionCode: row.position_code || "-",
    workpieceName: row.workpiece_name || row.part_no || "-",
    workOrderNo: row.work_order_no || "-",
    operationId: row.operation_id || "-",
    operationName: row.operation_name || "-",
    partNo: row.part_no || "-",
    completedQty: Number(row.completed_qty || 0),
    defectQty: Number(row.defect_qty || 0),
    shortageOrSkipped: Boolean(row.shortage_or_skipped),
    quantityNote: row.quantity_note || "",
    sourceDailyQuantityId: row.source_daily_quantity_id || "",
    sourceReviewedAt: row.source_reviewed_at || "",
    status: row.status || "draft",
  };
}

async function loadHmcFormalReportDraftsList() {
  const tenantFilter = config.tenantId ? `&${hmcRestEq("tenant_id", config.tenantId)}` : "";
  const rows = await supabaseFetch(`hmc_formal_report_drafts?select=*&order=created_at.desc${tenantFilter}`);
  const normalized = (Array.isArray(rows) ? rows : []).map(normalizeHmcFormalReportDraft);
  return {
    status: normalized.length ? "ok" : "empty",
    message: normalized.length ? "" : "尚無正式報表草稿。",
    rows: normalized,
  };
}

async function loadHmcFormalReportDraftDetail(draftId) {
  const tenantFilter = config.tenantId ? `&${hmcRestEq("tenant_id", config.tenantId)}` : "";
  const [drafts, items] = await Promise.all([
    supabaseFetch(`hmc_formal_report_drafts?select=*&${hmcRestEq("id", draftId)}${tenantFilter}`),
    supabaseFetch(`hmc_formal_report_draft_items?select=*&${hmcRestEq("draft_id", draftId)}&order=pallet_no.asc,position_code.asc${tenantFilter}`),
  ]);
  const draft = Array.isArray(drafts) && drafts.length ? normalizeHmcFormalReportDraft(drafts[0]) : null;
  if (!draft) return { status: "not_found", message: "找不到這筆草稿。", draft: null, items: [] };
  return {
    status: "ok",
    message: "",
    draft,
    items: (Array.isArray(items) ? items : []).map(normalizeHmcFormalReportDraftItem),
  };
}

function requestHmcFormalReportDraftsList() {
  if (!canReadHmcWorklistFromSupabase()) {
    hmcFormalReportDraftsState.list = { status: "not_configured", message: "尚未連線資料庫。", rows: [] };
    return;
  }
  if (["loading", "ok", "empty"].includes(hmcFormalReportDraftsState.list.status)) return;
  hmcFormalReportDraftsState.list = { status: "loading", message: "讀取草稿中...", rows: [] };
  loadHmcFormalReportDraftsList()
    .then((result) => {
      hmcFormalReportDraftsState.list = result;
      if (currentRoutePath() === hmcFormalReportDraftsRoutePath() && !hmcFormalReportDraftIdParam()) {
        renderHmcFormalReportDraftsRoute();
      }
    })
    .catch((error) => {
      hmcFormalReportDraftsState.list = { status: "error", message: error?.message || "讀取草稿失敗。", rows: [] };
      if (currentRoutePath() === hmcFormalReportDraftsRoutePath()) renderHmcFormalReportDraftsRoute();
    });
}

function requestHmcFormalReportDraftDetail(draftId) {
  if (!draftId) return;
  if (!canReadHmcWorklistFromSupabase()) {
    hmcFormalReportDraftsState.detail[draftId] = { status: "not_configured", message: "尚未連線資料庫。", draft: null, items: [] };
    return;
  }
  const current = hmcFormalReportDraftsState.detail[draftId];
  if (current && ["loading", "ok", "not_found"].includes(current.status)) return;
  hmcFormalReportDraftsState.detail[draftId] = { status: "loading", message: "讀取草稿明細中...", draft: null, items: [] };
  loadHmcFormalReportDraftDetail(draftId)
    .then((result) => {
      hmcFormalReportDraftsState.detail[draftId] = result;
      if (currentRoutePath() === hmcFormalReportDraftsRoutePath() && hmcFormalReportDraftIdParam() === draftId) {
        renderHmcFormalReportDraftsRoute();
      }
    })
    .catch((error) => {
      hmcFormalReportDraftsState.detail[draftId] = { status: "error", message: error?.message || "讀取草稿明細失敗。", draft: null, items: [] };
      if (currentRoutePath() === hmcFormalReportDraftsRoutePath()) renderHmcFormalReportDraftsRoute();
    });
}

function hmcRenderFormalReportDraftSafeBanner() {
  return `
    <section class="hmc-safe-banner" aria-label="HMC formal report draft read-only boundary">
      <strong>唯讀</strong>
      <span>正式報表草稿</span>
      <span>不送正式報工</span>
      <span>不可在此定稿</span>
    </section>
  `;
}

function hmcRenderFormalReportDraftsList() {
  const state = hmcFormalReportDraftsState.list;
  if (["idle", "loading"].includes(state.status)) {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>正在讀取正式報表草稿...</strong></section>`;
  }
  if (state.status === "not_configured" || state.status === "error") {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>${escapeHtml(state.status === "error" ? "讀取失敗" : "尚未連線")}</strong><p>${escapeHtml(state.message || "-")}</p></section>`;
  }
  if (!Array.isArray(state.rows) || !state.rows.length) {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>尚無正式報表草稿</strong><p>在每日盤點複核頁把已確認資料建立草稿後，會出現在這裡。</p></section>`;
  }
  return `
    <section class="hmc-draft-list" aria-label="HMC formal report draft list">
      ${state.rows.map((draft) => `
        <a class="hmc-report-card hmc-draft-card" href="${escapeHtml(hmcFormalReportDraftDetailUrl(draft.id))}">
          <div class="hmc-draft-card-head">
            <strong>${escapeHtml(draft.draftNo)}</strong>
            <span class="hmc-draft-status is-${escapeHtml(draft.status)}">${escapeHtml(hmcFormalReportDraftStatusLabel(draft.status))}</span>
          </div>
          <small>${escapeHtml(draft.machineCode)} · ${escapeHtml(hmcShiftLabel(draft.shiftScope))} · ${escapeHtml(draft.workDate)}</small>
          <div class="hmc-draft-card-grid">
            <span><b>工件列</b>${escapeHtml(draft.itemCount)}</span>
            <span><b>完成</b>${escapeHtml(draft.completedQtyTotal)}</span>
            <span><b>不良</b>${escapeHtml(draft.defectQtyTotal)}</span>
            <span><b>缺料/跳過</b>${escapeHtml(draft.shortageOrSkippedCount)}</span>
          </div>
          <small class="hmc-draft-created">建立於 ${escapeHtml(machtileFormatAuditTime(draft.createdAt))}</small>
        </a>
      `).join("")}
    </section>
  `;
}

function hmcRenderFormalReportDraftCancelPanel(draft) {
  if (draft.status === "cancelled") {
    return `
      <div class="hmc-draft-cancel-info" aria-label="HMC formal report draft cancelled">
        <strong>此草稿已取消</strong>
        ${draft.cancelledAt ? `<small>取消於 ${escapeHtml(machtileFormatAuditTime(draft.cancelledAt))}</small>` : ""}
        ${draft.cancelNote ? `<p class="hmc-draft-note">取消原因：${escapeHtml(draft.cancelNote)}</p>` : ""}
      </div>
    `;
  }
  if (draft.status !== "draft") return "";

  const cancel = hmcFormalReportDraftsState.cancel;
  const isThis = cancel.draftId === draft.id;
  const status = isThis ? cancel.status : "idle";
  const confirming = isThis && cancel.confirming;
  const message = isThis ? cancel.message : "";

  if (status === "cancelling") {
    return `<div class="hmc-draft-cancel-panel"><p class="hmc-draft-cancel-progress">正在取消草稿...</p></div>`;
  }
  if (!confirming) {
    return `
      <div class="hmc-draft-cancel-panel">
        ${message ? `<p class="hmc-draft-cancel-error">${escapeHtml(message)}</p>` : ""}
        <button type="button" class="hmc-danger-action" data-hmc-draft-cancel="${escapeHtml(draft.id)}">取消草稿</button>
      </div>
    `;
  }
  return `
    <div class="hmc-draft-cancel-panel is-confirming">
      <p class="hmc-draft-cancel-warn">取消後此草稿不可復原；來源每日盤點將釋回可重新建立草稿。</p>
      <label class="hmc-draft-cancel-label" for="hmcDraftCancelReason">取消原因（必填）</label>
      <textarea id="hmcDraftCancelReason" class="hmc-draft-cancel-reason" rows="2" maxlength="1000" placeholder="請說明取消原因">${escapeHtml(cancel.reason || "")}</textarea>
      ${message ? `<p class="hmc-draft-cancel-error">${escapeHtml(message)}</p>` : ""}
      <div class="hmc-draft-cancel-actions">
        <button type="button" class="hmc-secondary-action" data-hmc-draft-cancel-abort="1">返回</button>
        <button type="button" class="hmc-danger-action" data-hmc-draft-cancel-confirm="${escapeHtml(draft.id)}">確認取消</button>
      </div>
    </div>
  `;
}

// ---- HMC formal report draft finalize UI (Final Submit S4: Dev no-login) ----
// Calls the no-login Dev finalize variant (202606050003) via the anon path,
// like the cancel panel. AUTH_REQUIRED / FORBIDDEN / ACTOR_NOT_FOUND entries are
// kept harmlessly for the strict production body (hardening H5).

const hmcFinalizeErrorMessages = {
  TENANT_REQUIRED: "缺少租戶設定，無法發行。請確認連線設定。",
  AUTH_REQUIRED: "請先以主管或排程人員帳號登入，才能發行正式報表。",
  FORBIDDEN: "此帳號沒有發行權限（需要主管或排程人員）。",
  CONFIRM_REQUIRED: "需要確認後才能發行。",
  DRAFT_ID_REQUIRED: "缺少草稿編號，無法發行。",
  NOTE_TOO_LONG: "發行備註不可超過 1000 字。",
  DRAFT_NOT_FOUND: "找不到這筆草稿，可能已被移除或不屬於此租戶。",
  DRAFT_NOT_FINALIZABLE: "只有開啟中的草稿可以發行；此草稿已定稿或已取消。",
  ALREADY_FINALIZED: "此草稿已發行過正式報表，不可重複發行。",
  NO_ITEMS: "草稿沒有有效工件列，不能發行空白的正式報表。",
  ACTOR_NOT_FOUND: "登入帳號未對應到啟用中的使用者，無法記錄發行人。",
};

function hmcFinalizeErrorMessage(code, fallback) {
  return hmcFinalizeErrorMessages[code] || fallback || "發行正式報表失敗。";
}

function hmcRenderFormalReportDraftFinalizePanel(draft) {
  if (draft.status === "finalized") {
    return `
      <div class="hmc-draft-finalize-info" aria-label="HMC formal report draft finalized">
        <strong>此草稿已定稿並發行正式報表</strong>
        ${draft.finalizedAt ? `<small>發行於 ${escapeHtml(machtileFormatAuditTime(draft.finalizedAt))}</small>` : ""}
        ${draft.formalReportId ? `<a class="hmc-draft-inline-link" href="${escapeHtml(hmcFormalReportDetailUrl(draft.formalReportId))}">查看正式報表</a>` : ""}
      </div>
    `;
  }
  if (draft.status !== "draft") return "";

  const finalize = hmcFormalReportDraftsState.finalize;
  const isThis = finalize.draftId === draft.id;
  const status = isThis ? finalize.status : "idle";
  const confirming = isThis && finalize.confirming;
  const message = isThis ? finalize.message : "";

  if (status === "finalizing") {
    return `<div class="hmc-draft-finalize-panel"><p class="hmc-draft-cancel-progress">正在發行正式報表...</p></div>`;
  }
  if (!confirming) {
    return `
      <div class="hmc-draft-finalize-panel">
        ${message ? `<p class="hmc-draft-cancel-error">${escapeHtml(message)}</p>` : ""}
        <button type="button" class="hmc-finalize-action" data-hmc-draft-finalize="${escapeHtml(draft.id)}">正式發行此報表…</button>
      </div>
    `;
  }
  return `
    <div class="hmc-draft-finalize-panel is-confirming">
      <p class="hmc-draft-finalize-warn">發行後即為正式報表：不可取消、不可再編輯，僅供查閱。此動作不可復原。</p>
      <label class="hmc-draft-cancel-label" for="hmcDraftFinalizeNote">發行備註（選填，最多 1000 字）</label>
      <textarea id="hmcDraftFinalizeNote" class="hmc-draft-cancel-reason" rows="2" maxlength="1000" placeholder="可補充發行說明">${escapeHtml(finalize.note || "")}</textarea>
      ${message ? `<p class="hmc-draft-cancel-error">${escapeHtml(message)}</p>` : ""}
      <div class="hmc-draft-cancel-actions">
        <button type="button" class="hmc-secondary-action" data-hmc-draft-finalize-abort="1">返回</button>
        <button type="button" class="hmc-finalize-action" data-hmc-draft-finalize-confirm="${escapeHtml(draft.id)}">確認發行</button>
      </div>
    </div>
  `;
}

async function hmcRunFormalReportDraftFinalize(draftId, note) {
  hmcFormalReportDraftsState.finalize = {
    confirming: true,
    status: "finalizing",
    code: "",
    message: "",
    note,
    draftId,
  };
  renderHmcFormalReportDraftsRoute();

  try {
    const result = await hmcDevAnonRpcFetch("finalize_hmc_formal_report_draft", {
      p_draft_id: draftId,
      p_confirm: true,
      p_note: note || null,
    });
    hmcResetFormalReportDraftFinalizeState();
    // Refresh caches so the finalized badge + official report link show.
    delete hmcFormalReportDraftsState.detail[draftId];
    hmcFormalReportDraftsState.list = { status: "idle", message: "", rows: [] };
    hmcFormalReportsState.list = { status: "idle", message: "", rows: [] };
    showToast(`已發行正式報表 ${result.reportNo || ""}`.trim());
    renderHmcFormalReportDraftsRoute();
  } catch (error) {
    hmcFormalReportDraftsState.finalize = {
      confirming: true,
      status: "idle",
      code: error?.code || "FINALIZE_FAILED",
      message: hmcFinalizeErrorMessage(error?.code, error?.message),
      note,
      draftId,
    };
    renderHmcFormalReportDraftsRoute();
  }
}

function bindHmcFormalReportDraftFinalizeEvents() {
  $("[data-hmc-draft-finalize]")?.addEventListener("click", (event) => {
    hmcFormalReportDraftsState.finalize = {
      confirming: true,
      status: "idle",
      code: "",
      message: "",
      note: "",
      draftId: event.currentTarget.dataset.hmcDraftFinalize || "",
    };
    renderHmcFormalReportDraftsRoute();
  });

  $("[data-hmc-draft-finalize-abort]")?.addEventListener("click", () => {
    hmcResetFormalReportDraftFinalizeState();
    renderHmcFormalReportDraftsRoute();
  });

  $("#hmcDraftFinalizeNote")?.addEventListener("input", (event) => {
    hmcFormalReportDraftsState.finalize.note = event.currentTarget.value || "";
  });

  $("[data-hmc-draft-finalize-confirm]")?.addEventListener("click", (event) => {
    const id = event.currentTarget.dataset.hmcDraftFinalizeConfirm || "";
    const note = (hmcFormalReportDraftsState.finalize.note || "").trim();
    if (note.length > 1000) {
      hmcFormalReportDraftsState.finalize = {
        ...hmcFormalReportDraftsState.finalize,
        confirming: true,
        message: hmcFinalizeErrorMessage("NOTE_TOO_LONG"),
        draftId: id,
      };
      renderHmcFormalReportDraftsRoute();
      return;
    }
    hmcRunFormalReportDraftFinalize(id, note);
  });
}

async function hmcRunFormalReportDraftCancel(draftId, reason) {
  hmcFormalReportDraftsState.cancel = {
    confirming: true,
    status: "cancelling",
    code: "",
    message: "",
    reason,
    draftId,
  };
  renderHmcFormalReportDraftsRoute();

  try {
    const result = await hmcDevAnonRpcFetch("cancel_hmc_formal_report_draft", {
      p_draft_id: draftId,
      p_reason: reason,
      p_confirm: true,
    });
    hmcResetFormalReportDraftCancelState();
    // Refresh caches so the cancelled header + freed (reconvertable) scope show.
    delete hmcFormalReportDraftsState.detail[draftId];
    hmcFormalReportDraftsState.list = { status: "idle", message: "", rows: [] };
    hmcClearDailyQuantityReadCache();
    showToast(`已取消草稿 ${result.draftNo || ""}`.trim());
    renderHmcFormalReportDraftsRoute();
  } catch (error) {
    hmcFormalReportDraftsState.cancel = {
      confirming: true,
      status: "idle",
      code: error?.code || "DRAFT_CANCEL_FAILED",
      message: error?.message || "取消草稿失敗。",
      reason,
      draftId,
    };
    renderHmcFormalReportDraftsRoute();
  }
}

function bindHmcFormalReportDraftDetailEvents() {
  $("[data-hmc-draft-cancel]")?.addEventListener("click", (event) => {
    hmcFormalReportDraftsState.cancel = {
      confirming: true,
      status: "idle",
      code: "",
      message: "",
      reason: "",
      draftId: event.currentTarget.dataset.hmcDraftCancel || "",
    };
    renderHmcFormalReportDraftsRoute();
  });

  $("[data-hmc-draft-cancel-abort]")?.addEventListener("click", () => {
    hmcResetFormalReportDraftCancelState();
    renderHmcFormalReportDraftsRoute();
  });

  $("#hmcDraftCancelReason")?.addEventListener("input", (event) => {
    hmcFormalReportDraftsState.cancel.reason = event.currentTarget.value || "";
  });

  $("[data-hmc-draft-cancel-confirm]")?.addEventListener("click", (event) => {
    const id = event.currentTarget.dataset.hmcDraftCancelConfirm || "";
    const reason = (hmcFormalReportDraftsState.cancel.reason || "").trim();
    if (!reason) {
      hmcFormalReportDraftsState.cancel = {
        ...hmcFormalReportDraftsState.cancel,
        confirming: true,
        message: "請填寫取消原因。",
        draftId: id,
      };
      renderHmcFormalReportDraftsRoute();
      return;
    }
    hmcRunFormalReportDraftCancel(id, reason);
  });

  bindHmcFormalReportDraftFinalizeEvents();
}

function hmcRenderFormalReportDraftDetail(draftId) {
  const state = hmcFormalReportDraftsState.detail[draftId];
  if (!state || ["idle", "loading"].includes(state?.status)) {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>正在讀取草稿明細...</strong></section>`;
  }
  if (state.status === "not_found") {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>找不到這筆草稿</strong><p>可能已被移除或不屬於此租戶。</p></section>`;
  }
  if (state.status !== "ok" || !state.draft) {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>讀取失敗</strong><p>${escapeHtml(state.message || "-")}</p></section>`;
  }
  const draft = state.draft;
  const pallets = new Map();
  (state.items || []).forEach((item) => {
    const key = item.palletNo || 0;
    if (!pallets.has(key)) pallets.set(key, []);
    pallets.get(key).push(item);
  });
  const palletGroups = Array.from(pallets.entries()).sort((a, b) => Number(a[0]) - Number(b[0]));
  return `
    <section class="hmc-report-card hmc-draft-detail-head" aria-label="HMC formal report draft header">
      <div class="hmc-draft-detail-title">
        <strong>${escapeHtml(draft.draftNo)}</strong>
        <span class="hmc-draft-status is-${escapeHtml(draft.status)}">${escapeHtml(hmcFormalReportDraftStatusLabel(draft.status))}</span>
      </div>
      <small>${escapeHtml(draft.machineCode)} · ${escapeHtml(hmcShiftLabel(draft.shiftScope))} · ${escapeHtml(draft.workDate)}｜建立於 ${escapeHtml(machtileFormatAuditTime(draft.createdAt))}</small>
      <div class="hmc-draft-detail-grid">
        <span><b>工件列</b><strong>${escapeHtml(draft.itemCount)}</strong></span>
        <span><b>完成</b><strong>${escapeHtml(draft.completedQtyTotal)}</strong></span>
        <span><b>不良</b><strong>${escapeHtml(draft.defectQtyTotal)}</strong></span>
        <span><b>缺料/跳過</b><strong>${escapeHtml(draft.shortageOrSkippedCount)}</strong></span>
      </div>
      ${draft.note ? `<p class="hmc-draft-note">備註：${escapeHtml(draft.note)}</p>` : ""}
      ${hmcRenderFormalReportDraftFinalizePanel(draft)}
      ${hmcRenderFormalReportDraftCancelPanel(draft)}
    </section>
    ${palletGroups.map(([palletNo, items]) => `
      <section class="hmc-report-card hmc-draft-pallet-group">
        <header><strong>第 ${escapeHtml(palletNo || "-")} 盤</strong><em>${escapeHtml(items.length)} 件工件</em></header>
        <div class="hmc-draft-items">
          ${items.map((item) => `
            <article class="hmc-draft-item${item.shortageOrSkipped ? " is-shortage" : ""}">
              <div>
                <strong>${escapeHtml(item.workpieceName)}</strong>
                <small>${escapeHtml(item.workOrderNo)} / ${escapeHtml(item.operationId)} / ${escapeHtml(item.positionCode)}</small>
              </div>
              <span><b>完成</b>${escapeHtml(item.completedQty)}</span>
              <span><b>不良</b>${escapeHtml(item.defectQty)}</span>
              <span><b>缺料/跳過</b>${item.shortageOrSkipped ? "是" : "否"}</span>
              <small class="hmc-draft-trace">來源盤點 ${escapeHtml(hmcFormalReportDraftShortId(item.sourceDailyQuantityId))}${item.sourceReviewedAt ? `｜覆核於 ${escapeHtml(machtileFormatAuditTime(item.sourceReviewedAt))}` : ""}</small>
            </article>
          `).join("")}
        </div>
      </section>
    `).join("")}
  `;
}

function renderHmcFormalReportDraftsRoute() {
  document.body.classList.remove("station-select-route-mode");
  document.body.classList.remove("work-list-route-mode");
  document.body.classList.remove("work-detail-route-mode");
  document.body.classList.remove("report-work-route-mode");
  document.body.classList.add("hmc-report-route-mode");

  ["#stationSelectRoute", "#workListRoute", "#workDetailRoute", "#reportWorkRoute", "#hmcReportRoute", "#hmcDailyCheckReviewRoute", "#hmcFormalReportsRoute"].forEach((selector) => {
    const node = $(selector);
    if (node) node.hidden = true;
  });

  let routeRoot = $("#hmcFormalReportDraftsRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "hmcFormalReportDraftsRoute";
    routeRoot.className = "hmc-report-route hmc-draft-route";
    routeRoot.setAttribute("role", "main");
    routeRoot.setAttribute("aria-labelledby", "hmcDraftTitle");
    document.body.appendChild(routeRoot);
  }
  routeRoot.className = "hmc-report-route hmc-draft-route";
  routeRoot.hidden = false;

  const draftId = hmcFormalReportDraftIdParam();
  if (draftId) {
    requestHmcFormalReportDraftDetail(draftId);
  } else {
    requestHmcFormalReportDraftsList();
  }

  const backLink = draftId
    ? `<a class="hmc-secondary-action" href="${escapeHtml(hmcFormalReportDraftsUrl())}">返回草稿清單</a>`
    : `<a href="${escapeHtml(hmcDailyCheckReviewUrl({ status: "confirmed" }))}">返回複核</a>`;
  const formalReportsLink = `<a class="hmc-secondary-action" href="${escapeHtml(hmcFormalReportsUrl())}">正式報表</a>`;

  routeRoot.innerHTML = `
    <section class="hmc-report-shell">
      <header class="hmc-report-hero">
        <div>
          <p class="eyebrow">HMC 每日盤點 / 正式報表草稿</p>
          <h1 id="hmcDraftTitle">${draftId ? "正式報表草稿明細" : "正式報表草稿清單"}</h1>
          <p>由已確認的每日盤點建立的草稿；唯讀，不送正式報工。</p>
        </div>
        <div class="hmc-report-hero-actions">${formalReportsLink}${backLink}</div>
      </header>
      ${hmcRenderFormalReportDraftSafeBanner()}
      ${draftId ? hmcRenderFormalReportDraftDetail(draftId) : hmcRenderFormalReportDraftsList()}
    </section>
  `;

  if (draftId) bindHmcFormalReportDraftDetailEvents();
}

// ---- HMC official report read-only UI (Final Submit S4: Dev no-login) ----
// Anon read (S4B AnonReadDev): the ledger tables carry a Dev anon select grant
// (202606050003, hardening H6), so list/detail load via anon supabaseFetch like
// the drafts route. RLS tenant policies still scope rows.

const hmcFormalReportsState = {
  list: { status: "idle", message: "", rows: [] },
  detail: {},
  void: { confirming: false, status: "idle", code: "", message: "", reason: "", reportId: "" },
};

function hmcResetFormalReportVoidState() {
  hmcFormalReportsState.void = { confirming: false, status: "idle", code: "", message: "", reason: "", reportId: "" };
}

function hmcFormalReportsUrl(overrides = {}) {
  return appRouteUrl("", { route: hmcFormalReportsRoutePath(), ...overrides });
}

function hmcFormalReportDetailUrl(reportId) {
  return appRouteUrl("", { route: hmcFormalReportsRoutePath(), reportId });
}

function hmcFormalReportIdParam() {
  return (new URLSearchParams(window.location.search).get("reportId") || "").trim();
}

function hmcFormalReportStatusLabel(status) {
  return { issued: "已發行", voided: "已作廢" }[status] || status || "-";
}

function normalizeHmcFormalReport(row) {
  return {
    id: row.id || "",
    reportNo: row.report_no || "-",
    sourceDraftId: row.source_draft_id || "",
    machineCode: row.machine_code || "-",
    machineId: row.machine_id || "",
    workDate: row.work_date || "-",
    shiftScope: row.shift_scope || "-",
    status: row.status || "issued",
    itemCount: Number(row.item_count || 0),
    completedQtyTotal: Number(row.completed_qty_total || 0),
    defectQtyTotal: Number(row.defect_qty_total || 0),
    shortageOrSkippedCount: Number(row.shortage_or_skipped_count || 0),
    finalizedBy: row.finalized_by || "",
    finalizedAt: row.finalized_at || "",
    note: row.note || "",
    voidReason: row.void_reason || "",
    voidedAt: row.voided_at || "",
    voidedBy: row.voided_by || "",
    createdAt: row.created_at || "",
  };
}

function normalizeHmcFormalReportItem(row) {
  return {
    id: row.id || "",
    palletNo: Number(row.pallet_no || 0),
    positionCode: row.position_code || "-",
    workpieceName: row.workpiece_name || row.part_no || "-",
    workOrderNo: row.work_order_no || "-",
    operationId: row.operation_id || "-",
    operationName: row.operation_name || "-",
    partNo: row.part_no || "-",
    completedQty: Number(row.completed_qty || 0),
    defectQty: Number(row.defect_qty || 0),
    shortageOrSkipped: Boolean(row.shortage_or_skipped),
    quantityNote: row.quantity_note || "",
    reviewNote: row.review_note || "",
    sourceDraftItemId: row.source_draft_item_id || "",
    sourceDailyQuantityId: row.source_daily_quantity_id || "",
    sourceReviewedAt: row.source_reviewed_at || "",
  };
}

async function loadHmcFormalReportsList() {
  const tenantFilter = config.tenantId ? `&${hmcRestEq("tenant_id", config.tenantId)}` : "";
  const rows = await supabaseFetch(`hmc_formal_reports?select=*&order=finalized_at.desc${tenantFilter}`);
  const normalized = (Array.isArray(rows) ? rows : []).map(normalizeHmcFormalReport);
  return {
    status: normalized.length ? "ok" : "empty",
    message: normalized.length ? "" : "尚無正式報表。",
    rows: normalized,
  };
}

async function loadHmcFormalReportDetail(reportId) {
  const tenantFilter = config.tenantId ? `&${hmcRestEq("tenant_id", config.tenantId)}` : "";
  const [reports, items] = await Promise.all([
    supabaseFetch(`hmc_formal_reports?select=*&${hmcRestEq("id", reportId)}${tenantFilter}`),
    supabaseFetch(`hmc_formal_report_items?select=*&${hmcRestEq("report_id", reportId)}&order=pallet_no.asc,position_code.asc${tenantFilter}`),
  ]);
  const report = Array.isArray(reports) && reports.length ? normalizeHmcFormalReport(reports[0]) : null;
  if (!report) return { status: "not_found", message: "找不到這筆正式報表。", report: null, items: [] };
  return {
    status: "ok",
    message: "",
    report,
    items: (Array.isArray(items) ? items : []).map(normalizeHmcFormalReportItem),
  };
}

function requestHmcFormalReportsList() {
  if (!canReadHmcWorklistFromSupabase()) {
    hmcFormalReportsState.list = { status: "not_configured", message: "尚未連線資料庫。", rows: [] };
    return;
  }
  if (["loading", "ok", "empty"].includes(hmcFormalReportsState.list.status)) return;
  hmcFormalReportsState.list = { status: "loading", message: "讀取正式報表中...", rows: [] };
  loadHmcFormalReportsList()
    .then((result) => {
      hmcFormalReportsState.list = result;
      if (currentRoutePath() === hmcFormalReportsRoutePath() && !hmcFormalReportIdParam()) {
        renderHmcFormalReportsRoute();
      }
    })
    .catch((error) => {
      hmcFormalReportsState.list = { status: "error", message: error?.message || "讀取正式報表失敗。", rows: [] };
      if (currentRoutePath() === hmcFormalReportsRoutePath()) renderHmcFormalReportsRoute();
    });
}

function requestHmcFormalReportDetail(reportId) {
  if (!reportId) return;
  if (!canReadHmcWorklistFromSupabase()) {
    hmcFormalReportsState.detail[reportId] = { status: "not_configured", message: "尚未連線資料庫。", report: null, items: [] };
    return;
  }
  const current = hmcFormalReportsState.detail[reportId];
  if (current && ["loading", "ok", "not_found"].includes(current.status)) return;
  hmcFormalReportsState.detail[reportId] = { status: "loading", message: "讀取正式報表明細中...", report: null, items: [] };
  loadHmcFormalReportDetail(reportId)
    .then((result) => {
      hmcFormalReportsState.detail[reportId] = result;
      if (currentRoutePath() === hmcFormalReportsRoutePath() && hmcFormalReportIdParam() === reportId) {
        renderHmcFormalReportsRoute();
      }
    })
    .catch((error) => {
      hmcFormalReportsState.detail[reportId] = { status: "error", message: error?.message || "讀取正式報表明細失敗。", report: null, items: [] };
      if (currentRoutePath() === hmcFormalReportsRoutePath()) renderHmcFormalReportsRoute();
    });
}

function hmcRenderFormalReportSafeBanner() {
  return `
    <section class="hmc-safe-banner" aria-label="HMC official report immutable boundary">
      <strong>正式報表</strong>
      <span>不可變</span>
      <span>僅供查閱</span>
      <span>無編輯操作</span>
      <span>可作廢（留痕）</span>
    </section>
  `;
}

// ---- HMC official report void + amend loop (Final Submit S5: Dev no-login) ----
// Calls the no-login Dev void RPC (202606050004) via the anon path, like the
// cancel/finalize panels. Voiding marks the report 已作廢 (permanently readable)
// and releases its inventory scope for re-conversion (void -> reconvert ->
// refinalize, V4). AUTH_REQUIRED / FORBIDDEN entries are kept harmlessly for
// the strict production body (hardening H7).

const hmcVoidErrorMessages = {
  TENANT_REQUIRED: "缺少租戶設定，無法作廢。請確認連線設定。",
  AUTH_REQUIRED: "請先以主管或排程人員帳號登入，才能作廢正式報表。",
  FORBIDDEN: "此帳號沒有作廢權限（需要主管或排程人員）。",
  CONFIRM_REQUIRED: "需要確認後才能作廢。",
  REPORT_ID_REQUIRED: "缺少報表編號，無法作廢。",
  REASON_REQUIRED: "請填寫作廢原因。",
  REASON_TOO_LONG: "作廢原因不可超過 1000 字。",
  REPORT_NOT_FOUND: "找不到這筆正式報表，可能不屬於此租戶。",
  REPORT_NOT_VOIDABLE: "只有已發行的正式報表可以作廢；此報表已作廢。",
};

function hmcVoidErrorMessage(code, fallback) {
  return hmcVoidErrorMessages[code] || fallback || "作廢正式報表失敗。";
}

let hmcReissueState = {
  status: "idle",
  confirming: false,
  reportId: "",
  reason: "",
  step: "",
  message: "",
};

function hmcRenderFormalReportReissuePanel(report) {
  if (report.status !== "issued") return "";
  const state = hmcReissueState;
  const isThis = state.reportId === report.id;

  if (isThis && state.status === "running") {
    return `<div class="hmc-draft-cancel-panel"><p class="hmc-draft-cancel-progress">${escapeHtml(state.message || "正在修訂重發...")}</p></div>`;
  }
  if (!isThis || !state.confirming) {
    return `
      <div class="hmc-draft-cancel-panel">
        ${isThis && state.status === "error" ? `<p class="hmc-draft-cancel-error">${escapeHtml(state.message)}</p>` : ""}
        <button type="button" class="hmc-secondary-action" data-hmc-report-reissue="${escapeHtml(report.id)}">修訂重發…</button>
      </div>
    `;
  }
  return `
    <div class="hmc-draft-cancel-panel is-confirming">
      <p class="hmc-draft-cancel-warn">修訂重發＝舊報表作廢留痕，並以目前已確認的盤點重新發行新報表（自動編下一號）。此動作不改已確認的數字；要改數字請先在複核頁處理。</p>
      <label class="hmc-draft-cancel-label" for="hmcReportReissueReason">修訂原因（必填，最多 1000 字）</label>
      <textarea id="hmcReportReissueReason" class="hmc-draft-cancel-reason" rows="2" maxlength="1000" placeholder="請說明修訂原因">${escapeHtml(state.reason || "")}</textarea>
      ${state.status === "error" ? `<p class="hmc-draft-cancel-error">${escapeHtml(state.message)}</p>` : ""}
      <div class="hmc-draft-cancel-actions">
        <button type="button" class="hmc-secondary-action" data-hmc-report-reissue-abort="1">返回</button>
        <button type="button" class="hmc-finalize-action" data-hmc-report-reissue-confirm="${escapeHtml(report.id)}">確認修訂重發</button>
      </div>
    </div>
  `;
}

async function hmcRunFormalReportReissue(report, reason) {
  hmcReissueState = { status: "running", confirming: true, reportId: report.id, reason, step: "void", message: "正在作廢舊報表..." };
  renderHmcFormalReportsRoute();

  try {
    await hmcDevAnonRpcFetch("void_hmc_formal_report", {
      p_report_id: report.id,
      p_reason: `修訂重發：${reason}`,
      p_confirm: true,
    });
    hmcReissueState.step = "convert";
    hmcReissueState.message = "正在重建草稿...";
    renderHmcFormalReportsRoute();
    const conv = await hmcDevAnonRpcFetch("convert_hmc_daily_checks_to_formal_draft", {
      p_machine_code: report.machineCode,
      p_work_date: report.workDate,
      p_shift_scope: report.shiftScope,
      p_confirm: true,
      p_note: `修訂重發：${reason}`,
    });
    hmcReissueState.step = "finalize";
    hmcReissueState.message = `草稿 ${conv.draftNo || ""} 已重建，正在發行新報表...`;
    renderHmcFormalReportsRoute();
    const fin = await hmcDevAnonRpcFetch("finalize_hmc_formal_report_draft", {
      p_draft_id: conv.draftId,
      p_confirm: true,
      p_note: `修訂重發：${reason}`,
    });
    hmcReissueState = { status: "idle", confirming: false, reportId: "", reason: "", step: "", message: "" };
    hmcFormalReportsState.detail = {};
    hmcFormalReportsState.list = { status: "idle", message: "", rows: [] };
    hmcFormalReportDraftsState.list = { status: "idle", message: "", rows: [] };
    hmcClearDailyQuantityReadCache();
    showToast(`已修訂重發 ${fin.reportNo || ""}`.trim());
    if (fin.reportId) {
      window.location.href = hmcFormalReportDetailUrl(fin.reportId);
      return;
    }
    renderHmcFormalReportsRoute();
  } catch (error) {
    const stepLabel = { void: "作廢舊報表", convert: "重建草稿", finalize: "發行新報表" }[hmcReissueState.step] || "修訂重發";
    hmcReissueState = { ...hmcReissueState, status: "error", message: `${stepLabel}失敗：${error?.message || "未知錯誤"}${hmcReissueState.step !== "void" ? "；舊報表已作廢，可到複核頁／草稿清單手動完成重發。" : ""}` };
    hmcFormalReportsState.detail = {};
    hmcFormalReportsState.list = { status: "idle", message: "", rows: [] };
    renderHmcFormalReportsRoute();
  }
}

function hmcRenderFormalReportVoidPanel(report) {
  if (report.status === "voided") {
    return `
      <div class="hmc-draft-cancel-info" aria-label="HMC official report voided">
        <strong>此正式報表已作廢</strong>
        ${report.voidedAt ? `<small>作廢於 ${escapeHtml(machtileFormatAuditTime(report.voidedAt))}</small>` : ""}
        ${report.voidReason ? `<p class="hmc-draft-note">作廢原因：${escapeHtml(report.voidReason)}</p>` : ""}
        <small>作廢記錄永久保留可查；來源盤點範圍已釋回，可重新建立草稿並發行新報表。</small>
      </div>
    `;
  }
  if (report.status !== "issued") return "";

  const voidState = hmcFormalReportsState.void;
  const isThis = voidState.reportId === report.id;
  const status = isThis ? voidState.status : "idle";
  const confirming = isThis && voidState.confirming;
  const message = isThis ? voidState.message : "";

  if (status === "voiding") {
    return `<div class="hmc-draft-cancel-panel"><p class="hmc-draft-cancel-progress">正在作廢正式報表...</p></div>`;
  }
  if (!confirming) {
    return `
      <div class="hmc-draft-cancel-panel">
        ${message ? `<p class="hmc-draft-cancel-error">${escapeHtml(message)}</p>` : ""}
        <button type="button" class="hmc-danger-action" data-hmc-report-void="${escapeHtml(report.id)}">作廢此正式報表…</button>
      </div>
    `;
  }
  return `
    <div class="hmc-draft-cancel-panel is-confirming">
      <p class="hmc-draft-cancel-warn">報表將標記作廢：永久保留可查、不可復原；來源盤點範圍將釋回，可重新建立草稿並發行新報表。</p>
      <label class="hmc-draft-cancel-label" for="hmcReportVoidReason">作廢原因（必填，最多 1000 字）</label>
      <textarea id="hmcReportVoidReason" class="hmc-draft-cancel-reason" rows="2" maxlength="1000" placeholder="請說明作廢原因">${escapeHtml(voidState.reason || "")}</textarea>
      ${message ? `<p class="hmc-draft-cancel-error">${escapeHtml(message)}</p>` : ""}
      <div class="hmc-draft-cancel-actions">
        <button type="button" class="hmc-secondary-action" data-hmc-report-void-abort="1">返回</button>
        <button type="button" class="hmc-danger-action" data-hmc-report-void-confirm="${escapeHtml(report.id)}">確認作廢</button>
      </div>
    </div>
  `;
}

async function hmcRunFormalReportVoid(reportId, reason) {
  hmcFormalReportsState.void = {
    confirming: true,
    status: "voiding",
    code: "",
    message: "",
    reason,
    reportId,
  };
  renderHmcFormalReportsRoute();

  try {
    const result = await hmcDevAnonRpcFetch("void_hmc_formal_report", {
      p_report_id: reportId,
      p_reason: reason,
      p_confirm: true,
    });
    hmcResetFormalReportVoidState();
    // Refresh caches: the report flips to voided, the source draft's items are
    // removed, and the freed (reconvertable) scope shows on the review page.
    delete hmcFormalReportsState.detail[reportId];
    hmcFormalReportsState.list = { status: "idle", message: "", rows: [] };
    if (result.draftId) delete hmcFormalReportDraftsState.detail[result.draftId];
    hmcFormalReportDraftsState.list = { status: "idle", message: "", rows: [] };
    hmcClearDailyQuantityReadCache();
    showToast(`已作廢正式報表 ${result.reportNo || ""}`.trim());
    renderHmcFormalReportsRoute();
  } catch (error) {
    hmcFormalReportsState.void = {
      confirming: true,
      status: "idle",
      code: error?.code || "VOID_FAILED",
      message: hmcVoidErrorMessage(error?.code, error?.message),
      reason,
      reportId,
    };
    renderHmcFormalReportsRoute();
  }
}

function bindHmcFormalReportDetailEvents() {
  $("[data-hmc-report-reissue]")?.addEventListener("click", (event) => {
    hmcReissueState = { status: "idle", confirming: true, reportId: event.currentTarget.dataset.hmcReportReissue || "", reason: "", step: "", message: "" };
    renderHmcFormalReportsRoute();
  });
  $("[data-hmc-report-reissue-abort]")?.addEventListener("click", () => {
    hmcReissueState = { status: "idle", confirming: false, reportId: "", reason: "", step: "", message: "" };
    renderHmcFormalReportsRoute();
  });
  $("#hmcReportReissueReason")?.addEventListener("input", (event) => {
    hmcReissueState.reason = event.currentTarget.value || "";
  });
  $("[data-hmc-report-reissue-confirm]")?.addEventListener("click", (event) => {
    const reportId = event.currentTarget.dataset.hmcReportReissueConfirm || "";
    const reason = ($("#hmcReportReissueReason")?.value || "").trim();
    const report = hmcFormalReportsState.detail[reportId]?.report;
    if (!report) return;
    if (!reason) {
      hmcReissueState = { ...hmcReissueState, status: "error", message: "修訂前請先填寫修訂原因。" };
      renderHmcFormalReportsRoute();
      return;
    }
    hmcReissueState.reason = reason;
    hmcRunFormalReportReissue(report, reason);
  });

  $("[data-hmc-report-void]")?.addEventListener("click", (event) => {
    hmcFormalReportsState.void = {
      confirming: true,
      status: "idle",
      code: "",
      message: "",
      reason: "",
      reportId: event.currentTarget.dataset.hmcReportVoid || "",
    };
    renderHmcFormalReportsRoute();
  });

  $("[data-hmc-report-void-abort]")?.addEventListener("click", () => {
    hmcResetFormalReportVoidState();
    renderHmcFormalReportsRoute();
  });

  $("#hmcReportVoidReason")?.addEventListener("input", (event) => {
    hmcFormalReportsState.void.reason = event.currentTarget.value || "";
  });

  $("[data-hmc-report-void-confirm]")?.addEventListener("click", (event) => {
    const id = event.currentTarget.dataset.hmcReportVoidConfirm || "";
    const reason = (hmcFormalReportsState.void.reason || "").trim();
    if (!reason) {
      hmcFormalReportsState.void = {
        ...hmcFormalReportsState.void,
        confirming: true,
        message: hmcVoidErrorMessage("REASON_REQUIRED"),
        reportId: id,
      };
      renderHmcFormalReportsRoute();
      return;
    }
    if (reason.length > 1000) {
      hmcFormalReportsState.void = {
        ...hmcFormalReportsState.void,
        confirming: true,
        message: hmcVoidErrorMessage("REASON_TOO_LONG"),
        reportId: id,
      };
      renderHmcFormalReportsRoute();
      return;
    }
    hmcRunFormalReportVoid(id, reason);
  });
}

function hmcRenderFormalReportsList() {
  const state = hmcFormalReportsState.list;
  if (["idle", "loading"].includes(state.status)) {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>正在讀取正式報表...</strong></section>`;
  }
  if (state.status === "not_configured" || state.status === "error") {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>${escapeHtml(state.status === "error" ? "讀取失敗" : "尚未連線")}</strong><p>${escapeHtml(state.message || "-")}</p></section>`;
  }
  if (!Array.isArray(state.rows) || !state.rows.length) {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>尚無正式報表</strong><p>在草稿明細頁正式發行後，會出現在這裡。</p></section>`;
  }
  return `
    <section class="hmc-draft-list" aria-label="HMC official report list">
      ${state.rows.map((report) => `
        <a class="hmc-report-card hmc-draft-card" href="${escapeHtml(hmcFormalReportDetailUrl(report.id))}">
          <div class="hmc-draft-card-head">
            <strong>${escapeHtml(report.reportNo)}</strong>
            <span class="hmc-draft-status is-${escapeHtml(report.status)}">${escapeHtml(hmcFormalReportStatusLabel(report.status))}</span>
          </div>
          <small>${escapeHtml(report.machineCode)} · ${escapeHtml(hmcShiftLabel(report.shiftScope))} · ${escapeHtml(report.workDate)}</small>
          <div class="hmc-draft-card-grid">
            <span><b>工件列</b>${escapeHtml(report.itemCount)}</span>
            <span><b>完成</b>${escapeHtml(report.completedQtyTotal)}</span>
            <span><b>不良</b>${escapeHtml(report.defectQtyTotal)}</span>
            <span><b>缺料/跳過</b>${escapeHtml(report.shortageOrSkippedCount)}</span>
          </div>
          <small class="hmc-draft-created">發行於 ${escapeHtml(machtileFormatAuditTime(report.finalizedAt))}</small>
        </a>
      `).join("")}
    </section>
  `;
}

function hmcRenderFormalReportDetail(reportId) {
  const state = hmcFormalReportsState.detail[reportId];
  if (!state || ["idle", "loading"].includes(state.status)) {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>正在讀取正式報表明細...</strong></section>`;
  }
  if (state.status === "not_configured") {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>尚未連線</strong><p>${escapeHtml(state.message || "-")}</p></section>`;
  }
  if (state.status === "not_found") {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>找不到這筆正式報表</strong><p>可能不屬於此租戶。</p></section>`;
  }
  if (state.status !== "ok" || !state.report) {
    return `<section class="hmc-report-card hmc-draft-empty"><strong>讀取失敗</strong><p>${escapeHtml(state.message || "-")}</p></section>`;
  }
  const report = state.report;
  const pallets = new Map();
  (state.items || []).forEach((item) => {
    const key = item.palletNo || 0;
    if (!pallets.has(key)) pallets.set(key, []);
    pallets.get(key).push(item);
  });
  const palletGroups = Array.from(pallets.entries()).sort((a, b) => Number(a[0]) - Number(b[0]));
  return `
    <section class="hmc-report-card hmc-draft-detail-head" aria-label="HMC official report header">
      <div class="hmc-draft-detail-title">
        <strong>${escapeHtml(report.reportNo)}</strong>
        <span class="hmc-draft-status is-${escapeHtml(report.status)}">${escapeHtml(hmcFormalReportStatusLabel(report.status))}</span>
      </div>
      <small>${escapeHtml(report.machineCode)} · ${escapeHtml(hmcShiftLabel(report.shiftScope))} · ${escapeHtml(report.workDate)}｜發行於 ${escapeHtml(machtileFormatAuditTime(report.finalizedAt))}</small>
      <div class="hmc-draft-detail-grid">
        <span><b>工件列</b><strong>${escapeHtml(report.itemCount)}</strong></span>
        <span><b>完成</b><strong>${escapeHtml(report.completedQtyTotal)}</strong></span>
        <span><b>不良</b><strong>${escapeHtml(report.defectQtyTotal)}</strong></span>
        <span><b>缺料/跳過</b><strong>${escapeHtml(report.shortageOrSkippedCount)}</strong></span>
      </div>
      ${report.note ? `<p class="hmc-draft-note">發行備註：${escapeHtml(report.note)}</p>` : ""}
      <div class="hmc-draft-finalize-info">
        <strong>不可變快照</strong>
        <small>此正式報表為定稿時的快照，後續來源資料變動不影響此記錄。</small>
        ${report.sourceDraftId ? `<a class="hmc-draft-inline-link" href="${escapeHtml(hmcFormalReportDraftDetailUrl(report.sourceDraftId))}">查看來源草稿</a>` : ""}
      </div>
      ${hmcRenderFormalReportReissuePanel(report)}
      ${hmcRenderFormalReportVoidPanel(report)}
    </section>
    ${palletGroups.map(([palletNo, items]) => `
      <section class="hmc-report-card hmc-draft-pallet-group">
        <header><strong>第 ${escapeHtml(palletNo || "-")} 盤</strong><em>${escapeHtml(items.length)} 件工件</em></header>
        <div class="hmc-draft-items">
          ${items.map((item) => `
            <article class="hmc-draft-item${item.shortageOrSkipped ? " is-shortage" : ""}">
              <div>
                <strong>${escapeHtml(item.workpieceName)}</strong>
                <small>${escapeHtml(item.workOrderNo)} / ${escapeHtml(item.operationId)} / ${escapeHtml(item.positionCode)}</small>
              </div>
              <span><b>完成</b>${escapeHtml(item.completedQty)}</span>
              <span><b>不良</b>${escapeHtml(item.defectQty)}</span>
              <span><b>缺料/跳過</b>${item.shortageOrSkipped ? "是" : "否"}</span>
              <small class="hmc-draft-trace">來源盤點 ${escapeHtml(hmcFormalReportDraftShortId(item.sourceDailyQuantityId))}${item.sourceReviewedAt ? `｜覆核於 ${escapeHtml(machtileFormatAuditTime(item.sourceReviewedAt))}` : ""}</small>
            </article>
          `).join("")}
        </div>
      </section>
    `).join("")}
  `;
}

function renderHmcFormalReportsRoute() {
  document.body.classList.remove("station-select-route-mode");
  document.body.classList.remove("work-list-route-mode");
  document.body.classList.remove("work-detail-route-mode");
  document.body.classList.remove("report-work-route-mode");
  document.body.classList.add("hmc-report-route-mode");

  ["#stationSelectRoute", "#workListRoute", "#workDetailRoute", "#reportWorkRoute", "#hmcReportRoute", "#hmcDailyCheckReviewRoute", "#hmcFormalReportDraftsRoute"].forEach((selector) => {
    const node = $(selector);
    if (node) node.hidden = true;
  });

  let routeRoot = $("#hmcFormalReportsRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "hmcFormalReportsRoute";
    routeRoot.className = "hmc-report-route hmc-draft-route";
    routeRoot.setAttribute("role", "main");
    routeRoot.setAttribute("aria-labelledby", "hmcFormalReportTitle");
    document.body.appendChild(routeRoot);
  }
  routeRoot.className = "hmc-report-route hmc-draft-route";
  routeRoot.hidden = false;

  const reportId = hmcFormalReportIdParam();
  if (reportId) {
    requestHmcFormalReportDetail(reportId);
  } else {
    requestHmcFormalReportsList();
  }

  const backLink = reportId
    ? `<a class="hmc-secondary-action" href="${escapeHtml(hmcFormalReportsUrl())}">返回正式報表清單</a>`
    : `<a class="hmc-secondary-action" href="${escapeHtml(hmcFormalReportDraftsUrl())}">返回草稿清單</a>`;

  routeRoot.innerHTML = `
    <section class="hmc-report-shell">
      <header class="hmc-report-hero">
        <div>
          <p class="eyebrow">HMC 每日盤點 / 正式報表</p>
          <h1 id="hmcFormalReportTitle">${reportId ? "正式報表明細" : "正式報表清單"}</h1>
          <p>由草稿定稿發行的正式報表；不可變快照，僅供查閱。</p>
        </div>
        <div class="hmc-report-hero-actions">${backLink}</div>
      </header>
      ${hmcRenderFormalReportSafeBanner()}
      ${reportId ? hmcRenderFormalReportDetail(reportId) : hmcRenderFormalReportsList()}
    </section>
  `;

  if (reportId) bindHmcFormalReportDetailEvents();
}

function hmcDailyQuantityStats() {
  const selected = hmcSelectedItems();
  const selectedPalletCount = new Set(selected.map((item) => item.pallet.palletId)).size;
  const enteredCompletedQty = selected.reduce((total, item) => total + (Number(hmcQuantities()[item.key]) || 0), 0);
  const enteredDefectQty = selected.reduce((total, item) => total + (Number(hmcDefects()[item.key]) || 0), 0);
  const enteredSkippedCount = selected.filter((item) => hmcSkipped()[item.key]).length;
  const plannedQty = selected.reduce((total, item) => total + (Number(item.work.plannedQty) || 0), 0);
  const beforeRemainingQty = selected.reduce((total, item) => total + (Number(item.work.dbRemainingQtyBeforeToday ?? item.work.remainingQty) || 0), 0);
  const dbCompletedQty = selected.reduce((total, item) => total + (Number(item.work.dbTodayCompletedQty) || 0), 0);
  const dbDefectQty = selected.reduce((total, item) => total + (Number(item.work.dbTodayDefectQty) || 0), 0);
  const dbRemainingQty = selected.reduce((total, item) => total + (Number(item.work.dbRemainingQty ?? item.work.remainingQty) || 0), 0);
  const dbSkippedCount = selected.filter((item) => item.work.dbShortageOrSkipped).length;
  const dailyState = hmcCurrentDailyQuantityReadState();
  const hasDbDailyQuantity = dailyState.status === "ok";
  const readRows = hasDbDailyQuantity && Array.isArray(dailyState.rows) ? dailyState.rows : [];
  const readListCompletedQty = readRows.reduce((total, row) => total + (Number(row.todayCompletedQty) || 0), 0);
  const readListDefectQty = readRows.reduce((total, row) => total + (Number(row.todayDefectQty) || 0), 0);
  const readListRemainingQty = readRows.reduce((total, row) => total + (Number(row.remainingQty) || 0), 0);
  const readListSkippedCount = readRows.filter((row) => row.shortageOrSkipped).length;
  const readListPendingCount = readRows.filter((row) => row.dailyCheckStatus === "pending_review").length;
  const readListConfirmedCount = readRows.filter((row) => row.dailyCheckStatus === "confirmed").length;
  const readListRejectedCount = readRows.filter((row) => row.dailyCheckStatus === "rejected").length;
  const readListPalletCount = new Set(readRows.map((row) => row.palletId || row.palletNo).filter(Boolean)).size;
  const previewBaseRemainingQty = hasDbDailyQuantity ? dbRemainingQty : beforeRemainingQty;
  const previewRemainingQty = Math.max(0, previewBaseRemainingQty - enteredCompletedQty);

  return {
    selected,
    selectedPalletCount,
    itemCount: selected.length,
    completedQty: enteredCompletedQty,
    enteredDefectQty,
    defectQty: dbDefectQty,
    skippedCount: Math.max(enteredSkippedCount, dbSkippedCount),
    plannedQty,
    beforeRemainingQty,
    dbCompletedQty,
    dbDefectQty,
    dbRemainingQty,
    dbSkippedCount,
    hasDbDailyQuantity,
    readListCompletedQty,
    readListDefectQty,
    readListRemainingQty,
    readListSkippedCount,
    readListPendingCount,
    readListConfirmedCount,
    readListRejectedCount,
    readListItemCount: readRows.length,
    readListPalletCount,
    previewRemainingQty,
  };
}

function hmcShiftLabel(shift) {
  return shift === "night" ? "夜班：批次工件" : "白班：自選工件";
}

function hmcShiftDescription(shift) {
  return shift === "night"
    ? "依夜班交接清單查看多盤、多工件；每日盤點儲存後為待複核。"
    : "依白班本班清單查看多盤、多工件；每日盤點儲存後為待複核。";
}

function hmcWorkDailyQuantityLine(work) {
  const source = work.dailyQuantitySource || "preview";
  if (source === "preview" || work.dailyQuantityReadStatus === "preview") {
    return `剩餘 ${work.remainingQty}`;
  }
  const shortage = work.dbShortageOrSkipped ? " / 缺料" : "";
  return `已存完成 ${Number(work.dbTodayCompletedQty || 0)} / 不良 ${Number(work.dbTodayDefectQty || 0)} / 剩餘 ${Number((work.dbRemainingQty ?? work.remainingQty) || 0)}${shortage}`;
}

function hmcDailyQuantityReadStatusPanel() {
  const dailyState = hmcCurrentDailyQuantityReadState();
  if (dailyState.status === "preview") {
    return `
      <section class="hmc-safe-banner" aria-label="HMC daily quantity preview source">
        <strong>每日數量預覽</strong>
        <span>未連資料庫</span>
        <span>可畫面輸入</span>
        <span>不會正式報工</span>
      </section>
    `;
  }

  if (dailyState.status === "ok") {
    return `
      <section class="hmc-safe-banner is-quiet" aria-label="HMC daily quantity DB source">
        <span>已讀取每日數量 · ${escapeHtml(dailyState.workDate || hmcDailyQuantityWorkDate())} · ${escapeHtml(dailyState.rows.length)} 筆 · 可儲存為待複核</span>
      </section>
    `;
  }

  const labelMap = {
    idle: "尚未讀取每日數量",
    loading: "正在讀取每日數量",
    empty: "沒有每日數量資料",
    waiting_worklist: "等待啟用清單",
    invalid_request: "每日數量讀取條件不完整",
    error: "每日數量讀取失敗",
  };
  return `
    <section class="hmc-safe-banner" aria-label="HMC daily quantity read status">
      <strong>${escapeHtml(labelMap[dailyState.status] || "每日數量狀態")}</strong>
      <span>${escapeHtml(dailyState.message || "目前可先使用畫面輸入。")}</span>
      <span>不會正式報工</span>
      <span>不會同步 SoftNet</span>
    </section>
  `;
}

function hmcDailyQuantitySummary() {
  const stats = hmcDailyQuantityStats();
  const dailyState = hmcCurrentDailyQuantityReadState();
  const sourceLabel = dailyState.status === "ok"
    ? `讀取日期 ${dailyState.workDate || hmcDailyQuantityWorkDate()}`
    : `預覽日期 ${hmcDailyQuantityWorkDate()}`;

  return `
    <section class="hmc-daily-summary" aria-label="HMC daily quantity summary">
      <div class="hmc-daily-summary-head">
        <div>
          <span>${escapeHtml(sourceLabel)}</span>
          <strong>${escapeHtml(hmcRouteMachineKey())} · ${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong>
        </div>
        <em>先看退回與待確認，再填本日完成 / 不良。</em>
      </div>
      <div class="hmc-daily-summary-grid">
        <span><b>已退回</b><strong>${escapeHtml(stats.readListRejectedCount || 0)}</strong></span>
        <span><b>本日完成</b><strong>${escapeHtml(stats.hasDbDailyQuantity ? stats.readListCompletedQty : stats.completedQty)}</strong></span>
        <span><b>剩餘</b><strong>${escapeHtml(stats.hasDbDailyQuantity ? stats.readListRemainingQty : stats.previewRemainingQty)}</strong></span>
      </div>
    </section>
  `;
}

function hmcDailyWorkFocusPanel() {
  const allItems = hmcAllWorkItems();
  if (!allItems.length) return "";
  const selectedKeys = hmcSelectedWorkKeys();
  const rank = {
    rejected: 0,
    pending_review: 1,
    not_started: 2,
    confirmed: 3,
    converted: 4,
  };
  const focusItems = allItems
    .map((item) => ({
      ...item,
      selected: selectedKeys.has(item.key),
      status: hmcWorkDailyCheckStatus(item.work),
    }))
    .sort((a, b) => {
      const rankDiff = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      if (rankDiff) return rankDiff;
      if (a.selected !== b.selected) return a.selected ? -1 : 1;
      return Number(a.pallet.palletNo || 0) - Number(b.pallet.palletNo || 0);
    })
    .slice(0, 10);

  return `
    <section class="hmc-focus-panel" aria-label="HMC focus work list">
      <div class="hmc-focus-head">
        <div>
          <span>待處理工件</span>
          <strong>先找退回 / 待確認項目</strong>
        </div>
        <em>點下方交換盤卡片可選取或取消工件；退回項目會標橘色。</em>
      </div>
      <div class="hmc-focus-legend" aria-label="HMC status color legend">
        <span class="is-rejected">退回</span>
        <span class="is-pending">待確認</span>
        <span class="is-confirmed">已確認</span>
        <span class="is-selected">目前選取</span>
      </div>
      <div class="hmc-focus-list">
        ${focusItems.map(({ pallet, work, status, selected }) => `
          <article class="hmc-focus-item ${selected ? "is-selected" : ""} ${hmcReviewStatusClass(status)}">
            <div>
              <span>${escapeHtml(pallet.palletName)} · ${escapeHtml(work.positionCode || "-")}</span>
              <strong>${escapeHtml(work.partName)}</strong>
              <small>${escapeHtml(work.workNo)} · ${escapeHtml(hmcWorkDailyQuantityLine(work))}</small>
            </div>
            <b class="hmc-review-status ${hmcReviewStatusClass(status)}">${escapeHtml(hmcReviewStatusLabel(status))}</b>
            ${work.dailyReviewNote ? `<p>退回原因：${escapeHtml(work.dailyReviewNote)}</p>` : ""}
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function hmcPalletMatrix() {
  return `
    <section class="hmc-pallet-matrix" aria-label="HMC pallet work matrix">
      <div class="hmc-pallet-matrix-head">
        <span>盤號</span>
        <strong>${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong>
        <em>已選工件會變藍；在工件後方填本日完成與本日不良。</em>
      </div>
      ${activeHmcReportPallets().map((pallet, palletIndex) => {
        const selectedCount = pallet.works.filter((work) => hmcSelectedWorkKeys().has(hmcWorkKey(pallet.palletId, work.workNo))).length;
        return `
          <div class="hmc-pallet-row ${pallet.palletId === hmcActivePlan().activePalletId ? "is-active" : ""}">
            <button type="button" class="hmc-pallet-row-title" data-hmc-pallet="${escapeHtml(pallet.palletId)}">
              <span>第 ${escapeHtml(palletIndex + 1)} 盤</span>
              <strong>${escapeHtml(pallet.setupName)}</strong>
              <em>${escapeHtml(selectedCount)}/${escapeHtml(pallet.works.length)} 已選</em>
            </button>
            <div class="hmc-pallet-row-works">
              ${pallet.works.map((work, workIndex) => {
                const key = hmcWorkKey(pallet.palletId, work.workNo);
                const isSelected = hmcSelectedWorkKeys().has(key);
                const dbBacked = Boolean(hmcDailyCheckItemId(work));
                const dailyStatus = hmcWorkDailyCheckStatus(work);
                const canEditDailyCheck = isSelected && hmcWorkDailyCheckEditable(work);
                const qtyValue = isSelected ? hmcWorkDailyCheckInputValue(work, key, hmcQuantities(), work.dbTodayCompletedQty) : "";
                const defectValue = isSelected ? hmcWorkDailyCheckInputValue(work, key, hmcDefects(), work.dbTodayDefectQty) : "";
                const skipChecked = Object.prototype.hasOwnProperty.call(hmcSkipped(), key) ? hmcSkipped()[key] : work.dbShortageOrSkipped;
                const lockedReason = hmcWorkDailyCheckLockedReason(work);
                return `
                  <div class="hmc-matrix-work ${isSelected ? "is-selected" : ""} ${work.workNo === hmcActivePlan().workNo ? "is-active" : ""} ${dbBacked ? "" : "is-preview-only"} ${hmcReviewStatusClass(dailyStatus)} ${lockedReason ? "is-locked" : ""}">
                    <button type="button" data-hmc-work-card="${escapeHtml(work.workNo)}" data-hmc-pallet-work="${escapeHtml(pallet.palletId)}" aria-pressed="${isSelected ? "true" : "false"}">
                      <span>${escapeHtml(hmcWorkLetter(workIndex))}</span>
                      <strong>${escapeHtml(work.partName)}</strong>
                      <em>${escapeHtml(work.workNo)} · ${escapeHtml(hmcWorkDailyQuantityLine(work))}</em>
                    </button>
                    ${dailyStatus !== "not_started" ? `
                      <div class="hmc-matrix-review-state">
                        <b class="hmc-review-status ${hmcReviewStatusClass(dailyStatus)}">${escapeHtml(hmcReviewStatusLabel(dailyStatus))}</b>
                        ${work.dailyReviewNote ? `<span>主管退回原因：${escapeHtml(work.dailyReviewNote)}</span>` : ""}
                        ${lockedReason ? `<small>${escapeHtml(lockedReason)}</small>` : ""}
                        ${dailyStatus === "rejected" ? `<small>可修正後重新送審。</small>` : ""}
                      </div>
                    ` : ""}
                    <label>
                      <span>本日完成</span>
                      <input class="hmc-selected-qty" type="number" min="0" inputmode="numeric" value="${escapeHtml(qtyValue)}" data-hmc-work-key="${escapeHtml(key)}" ${canEditDailyCheck ? "" : "disabled"}>
                    </label>
                    <label>
                      <span>本日不良</span>
                      <input class="hmc-selected-defect-qty" type="number" min="0" inputmode="numeric" value="${escapeHtml(defectValue)}" data-hmc-work-key="${escapeHtml(key)}" ${canEditDailyCheck ? "" : "disabled"}>
                    </label>
                    <label class="hmc-matrix-skip">
                      <input class="hmc-selected-skip" type="checkbox" data-hmc-work-key="${escapeHtml(key)}" ${skipChecked ? "checked" : ""} ${canEditDailyCheck ? "" : "disabled"}>
                      <span>缺料 / 跳過</span>
                    </label>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function hmcSelectedSummary() {
  const selected = hmcSelectedItems();
  const grouped = activeHmcReportPallets()
    .map((pallet) => ({
      pallet,
      items: selected.filter((item) => item.pallet.palletId === pallet.palletId),
    }))
    .filter((group) => group.items.length);

  return `
    <section class="hmc-selected-summary" aria-label="HMC selected work summary">
      <div class="hmc-selected-summary-head">
        <div>
          <span>本班加工清單</span>
          <strong>${selected.length} 件 / ${grouped.length} 盤</strong>
        </div>
        <button type="button" class="hmc-setup-toggle" data-hmc-toggle-setup>
          ${hmcReportState.setupOpen ? "收起清單說明" : "清單調整說明"}
        </button>
        <em>現場只做每日數量盤點；儲存後等待主管確認，不會正式報工。</em>
      </div>
      ${grouped.length ? grouped.map((group) => `
        <div class="hmc-selected-group">
          <strong>${escapeHtml(group.pallet.palletName)} · ${escapeHtml(group.pallet.setupName)}</strong>
          <div>
            ${group.items.map((item) => `<span>${escapeHtml(item.work.workNo)} · ${escapeHtml(item.work.partName)} · ${escapeHtml(hmcWorkDailyQuantityLine(item.work))}</span>`).join("")}
          </div>
        </div>
      `).join("") : `<p>目前沒有選到工件；請在下方交換盤與工件區選擇本班要盤點的項目。</p>`}
    </section>
  `;
}

function updateHmcReportPreview() {
  const stats = hmcDailyQuantityStats();
  const totalQty = $$(".hmc-selected-qty").reduce((total, input) => total + (Number(input.value) || 0), 0);
  const defectQty = $$(".hmc-selected-defect-qty").reduce((total, input) => total + (Number(input.value) || 0), 0);
  const skippedCount = $$(".hmc-selected-skip").filter((input) => input.checked).length;
  const preview = $("#hmcReportPreview");
  if (!preview) return;
  const baseRemainingQty = stats.hasDbDailyQuantity ? stats.dbRemainingQty : stats.beforeRemainingQty;
  const previewRemainingQty = Math.max(0, baseRemainingQty - totalQty);

  preview.innerHTML = `
    <div class="hmc-preview-grid">
      <span><b>班別</b><strong>${escapeHtml(hmcShiftLabel(hmcReportState.shift))}</strong></span>
      <span><b>選取交換盤</b><strong>${escapeHtml(stats.selectedPalletCount)}</strong></span>
      <span><b>選取工件</b><strong>${escapeHtml(stats.itemCount)}</strong></span>
      <span><b>已存完成</b><strong>${escapeHtml(stats.dbCompletedQty)}</strong></span>
      <span><b>已存不良</b><strong>${escapeHtml(stats.dbDefectQty)}</strong></span>
      <span><b>本次完成</b><strong>${escapeHtml(totalQty)}</strong></span>
      <span><b>本次不良</b><strong>${escapeHtml(defectQty)}</strong></span>
      <span><b>缺料 / 跳過</b><strong>${escapeHtml(Math.max(skippedCount, stats.dbSkippedCount))}</strong></span>
      <span><b>預覽後剩餘</b><strong>${escapeHtml(previewRemainingQty)}</strong></span>
    </div>
    <p class="hmc-preview-warning">${totalQty > 0 || defectQty > 0 || skippedCount > 0 ? "預覽已更新；可儲存為待複核，每日盤點仍不是正式報工。" : "請輸入本日完成、本日不良，或勾選缺料 / 跳過。"}</p>
  `;
}

function renderHmcReportRoute() {
  document.body.classList.remove("station-select-route-mode");
  document.body.classList.remove("work-list-route-mode");
  document.body.classList.remove("work-detail-route-mode");
  document.body.classList.remove("report-work-route-mode");
  document.body.classList.add("hmc-report-route-mode");

  const stationSelectRoot = $("#stationSelectRoute");
  if (stationSelectRoot) stationSelectRoot.hidden = true;
  const workListRoot = $("#workListRoute");
  if (workListRoot) workListRoot.hidden = true;
  const workDetailRoot = $("#workDetailRoute");
  if (workDetailRoot) workDetailRoot.hidden = true;
  const reportWorkRoot = $("#reportWorkRoute");
  if (reportWorkRoot) reportWorkRoot.hidden = true;
  const reviewRoot = $("#hmcDailyCheckReviewRoute");
  if (reviewRoot) reviewRoot.hidden = true;

  let routeRoot = $("#hmcReportRoute");
  if (!routeRoot) {
    routeRoot = document.createElement("div");
    routeRoot.id = "hmcReportRoute";
    routeRoot.className = "hmc-report-route";
    routeRoot.setAttribute("role", "main");
    routeRoot.setAttribute("aria-labelledby", "hmcReportTitle");
    document.body.appendChild(routeRoot);
  }
  routeRoot.className = "hmc-report-route";
  routeRoot.hidden = false;

  initializeHmcReportState();
  requestHmcActiveWorklistRead();
  requestHmcDailyQuantityRead();
  const pallet = selectedHmcPallet();
  const isNight = hmcReportState.shift === "night";
  const machineLabel = hmcRouteMachineLabel();

  routeRoot.innerHTML = `
    <section class="hmc-report-shell">
      <header class="hmc-report-hero">
        <div>
          <p class="eyebrow">臥式加工中心 · ${escapeHtml(machineLabel)}</p>
          <h1 id="hmcReportTitle">多盤多工件每日盤點</h1>
          <p>先看本班工件和主管退回項目，再填本日完成、不良、缺料與備註。</p>
        </div>
        <div class="hmc-report-hero-actions">
          <a class="hmc-secondary-action" href="${escapeHtml(hmcGuideRouteUrl(machineLabel, hmcReportState.shift))}">使用說明</a>
          <a class="hmc-secondary-action" href="${escapeHtml(hmcDailyCheckReviewUrl({ status: "pending_review" }))}">每日盤點複核</a>
          <a class="hmc-secondary-action" href="${escapeHtml(hmcWorklistSetupRouteUrl(machineLabel, hmcReportState.shift))}">班前清單設定</a>
          <a href="${escapeHtml(hmcReportDashboardBackUrl())}" data-hmc-back>返回上一頁</a>
        </div>
      </header>

      ${hmcDailyQuantitySummary()}
      ${hmcDailyCheckReviewResultPanel()}
      ${hmcDailyWorkFocusPanel()}

      <section class="hmc-report-card hmc-pallet-selector-card">
        <div class="hmc-night-head hmc-pallet-selector-head">
          <div>
            <strong>交換盤與工件輸入</strong>
            <span>依盤號往下填本日完成與本日不良；退回項目可修正後重新送審。</span>
          </div>
          <div class="hmc-shift-tabs hmc-shift-tabs-inline" role="tablist" aria-label="HMC shift mode">
            <button type="button" class="hmc-shift-day ${!isNight ? "is-active" : ""}" data-hmc-shift="day">
              <strong>白班</strong>
              <span>自選工件</span>
            </button>
            <button type="button" class="hmc-shift-night ${isNight ? "is-active" : ""}" data-hmc-shift="night">
              <strong>夜班</strong>
              <span>批次工件</span>
            </button>
          </div>
        </div>
        ${hmcPalletMatrix()}
      </section>

      <div class="hmc-report-grid ${hmcReportState.setupOpen ? "is-setup-open" : "is-setup-closed"}">
        <aside class="hmc-report-card hmc-report-card-sticky ${hmcReportState.setupOpen ? "" : "is-hidden"}">
          <h2>清單調整說明</h2>
          <p>班前清單由主管或排程人員建立。現場頁只做每日數量盤點，臨時插單或換盤仍需回設定流程處理。</p>
          <div class="hmc-setup-disabled">
            <strong>現場頁不編輯班前清單</strong>
            <ul>
              <li>不新增交換盤、不變更工件清單。</li>
              <li>只儲存本日完成、不良、缺料/跳過與備註。</li>
              <li>儲存後為待複核，等待主管確認。</li>
              <li>不轉正式報工、不寫 production DB、不同步 SoftNet。</li>
            </ul>
          </div>
        </aside>

        <section class="hmc-report-card">
          <div class="hmc-mode-panel hmc-entry-panel">
            <div class="hmc-night-head">
              <strong>備註與送審</strong>
              <span>儲存後等待主管確認；仍不是正式報工。</span>
            </div>
          </div>

          <label class="hmc-field">
            <span>備註</span>
            <textarea id="hmcHandoverNote" rows="3" maxlength="1000" placeholder="可記錄缺料、刀具、治具、下一班注意事項"></textarea>
          </label>

          <section id="hmcReportPreview" class="hmc-preview" aria-live="polite"></section>
          ${hmcDailyCheckSavePanel()}
        </section>
      </div>
    </section>
  `;

  bindHmcReportEvents();
  updateHmcReportPreview();
}

function bindHmcReportEvents() {
  $("[data-hmc-back]")?.addEventListener("click", (event) => {
    event.preventDefault();
    const target = event.currentTarget?.getAttribute("href") || hmcReportDashboardBackUrl();
    window.location.href = target;
  });
  $("[data-hmc-toggle-setup]")?.addEventListener("click", () => {
    hmcReportState.setupOpen = !hmcReportState.setupOpen;
    renderHmcReportRoute();
  });
  $$("[data-hmc-shift]").forEach((button) => {
    button.addEventListener("click", () => {
      hmcReportState.shift = button.dataset.hmcShift === "night" ? "night" : "day";
      machtileSetRouteParam("shift", hmcReportState.shift);
      resetHmcDailyCheckSaveState();
      renderHmcReportRoute();
    });
  });
  $$("[data-hmc-pallet]").forEach((button) => {
    button.addEventListener("click", () => {
      const plan = hmcActivePlan();
      plan.activePalletId = button.dataset.hmcPallet || "P1";
      plan.workNo = selectedHmcPallet().works[0]?.workNo || "";
      renderHmcReportRoute();
    });
  });
  $("#hmcWorkSelect")?.addEventListener("change", (event) => {
    hmcActivePlan().workNo = event.target.value;
    hmcSelectedWorkKeys().add(hmcWorkKey(selectedHmcPallet().palletId, event.target.value));
    renderHmcReportRoute();
  });
  $$("[data-hmc-work-card]").forEach((button) => {
    button.addEventListener("click", () => {
      const plan = hmcActivePlan();
      const palletId = button.dataset.hmcPalletWork || plan.activePalletId || "P1";
      const pallet = activeHmcReportPallets().find((item) => item.palletId === palletId) || selectedHmcPallet();
      const workNo = button.dataset.hmcWorkCard || pallet.works[0]?.workNo || "";
      const key = hmcWorkKey(pallet.palletId, workNo);
      plan.activePalletId = pallet.palletId;
      plan.workNo = workNo;
      if (hmcSelectedWorkKeys().has(key)) {
        hmcSelectedWorkKeys().delete(key);
        delete hmcQuantities()[key];
        delete hmcDefects()[key];
        delete hmcSkipped()[key];
      } else {
        hmcSelectedWorkKeys().add(key);
      }
      hmcEnsureSelectedWork();
      resetHmcDailyCheckSaveState();
      renderHmcReportRoute();
    });
  });
  $("#hmcHandoverNote")?.addEventListener("input", updateHmcReportPreview);
  $$(".hmc-selected-qty").forEach((field) => {
    field.addEventListener("input", () => {
      hmcQuantities()[field.dataset.hmcWorkKey] = field.value;
      resetHmcDailyCheckSaveState();
      updateHmcReportPreview();
    });
  });
  $$(".hmc-selected-defect-qty").forEach((field) => {
    field.addEventListener("input", () => {
      hmcDefects()[field.dataset.hmcWorkKey] = field.value;
      resetHmcDailyCheckSaveState();
      updateHmcReportPreview();
    });
  });
  $$(".hmc-selected-skip").forEach((field) => {
    field.addEventListener("change", () => {
      hmcSkipped()[field.dataset.hmcWorkKey] = field.checked;
      resetHmcDailyCheckSaveState();
      updateHmcReportPreview();
    });
  });
  $("[data-hmc-save-daily-check]")?.addEventListener("click", async () => {
    const build = buildHmcDailyCheckPayload();
    if (!build.ok) {
      hmcDailyCheckSaveState.status = "error";
      hmcDailyCheckSaveState.code = "CLIENT_VALIDATION";
      hmcDailyCheckSaveState.message = build.message || "每日盤點資料不完整。";
      renderHmcReportRoute();
      return;
    }

    hmcDailyCheckSaveState.status = "saving";
    hmcDailyCheckSaveState.message = "";
    renderHmcReportRoute();

    try {
      const result = await hmcDailyCheckRpcFetch(build.payload);
      hmcDailyCheckSaveState.status = "success";
      hmcDailyCheckSaveState.code = result.code || "DAILY_CHECK_SAVED";
      hmcDailyCheckSaveState.message = result.message || "每日盤點已儲存，等待主管確認。";
      hmcDailyCheckSaveState.rowCount = Number(result.rowCount || build.payload.items.length || 0);
      hmcDailyCheckSaveState.completedQty = Number(result.completedQty || 0);
      hmcDailyCheckSaveState.defectQty = Number(result.defectQty || 0);
      hmcDailyCheckSaveState.shortageOrSkippedCount = Number(result.shortageOrSkippedCount || 0);
      hmcDailyCheckSaveState.newRowCount = Number(result.newRowCount || 0);
      hmcDailyCheckSaveState.correctedRowCount = Number(result.correctedRowCount || 0);
      hmcDailyCheckSaveState.dailyCheckStatus = result.dailyCheckStatus || "pending_review";
      hmcDailyCheckSaveState.savedAt = new Date().toISOString();
      hmcClearDailyQuantityReadCache();
      requestHmcDailyQuantityRead();
      showToast("每日盤點已儲存");
    } catch (error) {
      hmcDailyCheckSaveState.status = "error";
      hmcDailyCheckSaveState.code = error?.code || "DAILY_CHECK_SAVE_FAILED";
      hmcDailyCheckSaveState.message = error?.message || "每日盤點儲存失敗。";
    }

    renderHmcReportRoute();
  });
}

function pct(order) {
  if (!Number(order?.total)) return 0;
  return Math.min(100, Math.round((Number(order.done || 0) / Number(order.total || 0)) * 100));
}

function parseDateOnly(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function dueInfo(order) {
  const due = parseDateOnly(order?.dueDate);
  if (!due) return { label: "-", date: "-", diffDays: 999 };
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((due - todayOnly) / 86400000);
  const label = diffDays < 0 ? `逾期 +${Math.abs(diffDays)}` : diffDays === 0 ? "今日" : `D-${diffDays}`;
  return {
    label,
    date: `${String(due.getMonth() + 1).padStart(2, "0")}/${String(due.getDate()).padStart(2, "0")}`,
    diffDays,
  };
}

function getProgramProfile(order) {
  const fallbackKey = order?.drawing || order?.part || order?.id;
  const base = programProfiles[fallbackKey] || {
    programName: order?.programName || "待上傳",
    programVersion: order?.programVersion || "-",
    previousVersion: order?.previousProgramVersion || "-",
    programHash: order?.programHash || "",
    previousHash: order?.previousProgramHash || "",
    changedLines: order?.changedLines ?? null,
    toolChanges: order?.toolChanges || "尚未建立程式基準",
    pureCycleSec: order?.pureCycleSec ?? null,
    baselineCycleSec: order?.baselineCycleSec ?? null,
    loadUnloadSec: order?.loadUnloadSec ?? null,
    historyRuns: order?.historyRuns ?? 0,
    historyYears: order?.historyYears ?? 0,
    lastRunDate: order?.lastRunDate || "",
  };

  return {
    ...base,
    programName: order?.programName || base.programName,
    programVersion: order?.programVersion || base.programVersion,
    previousVersion: order?.previousProgramVersion || base.previousVersion,
    programHash: order?.programHash || base.programHash,
    previousHash: order?.previousProgramHash || base.previousHash,
    changedLines: order?.changedLines ?? base.changedLines,
    toolChanges: order?.toolChanges || base.toolChanges,
    pureCycleSec: order?.pureCycleSec ?? base.pureCycleSec,
    baselineCycleSec: order?.baselineCycleSec ?? base.baselineCycleSec,
    loadUnloadSec: order?.loadUnloadSec ?? base.loadUnloadSec,
    historyRuns: order?.historyRuns ?? base.historyRuns,
    historyYears: order?.historyYears ?? base.historyYears,
    lastRunDate: order?.lastRunDate || base.lastRunDate,
  };
}

function formatSeconds(seconds) {
  if (!Number(seconds)) return "-";
  const total = Number(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.round(total % 60);
  if (hours > 0) return `${hours}時${String(minutes).padStart(2, "0")}分`;
  return `${minutes}分${String(secs).padStart(2, "0")}秒`;
}

function cycleDelta(profile) {
  if (!Number(profile?.pureCycleSec) || !Number(profile?.baselineCycleSec)) return null;
  return Math.round(((profile.pureCycleSec - profile.baselineCycleSec) / profile.baselineCycleSec) * 100);
}

function dailyPureCapacity(profile, minutesPerDay = 480) {
  if (!Number(profile?.pureCycleSec)) return null;
  return Math.floor((minutesPerDay * 60) / profile.pureCycleSec);
}

function estimatedWorkDays(order, profile) {
  const dailyQty = dailyPureCapacity(profile);
  if (!dailyQty || !Number(order?.total)) return null;
  return Math.max(1, Math.ceil(Number(order.total) / dailyQty));
}

function getReportCycleSeconds() {
  const minutes = Number($("#cycleMinutes")?.value || 0);
  const seconds = Number($("#cycleSeconds")?.value || 0);
  return (minutes * 60) + seconds;
}

function setReportCycleSeconds(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const minuteInput = $("#cycleMinutes");
  const secondInput = $("#cycleSeconds");
  if (!minuteInput || !secondInput) return;
  minuteInput.value = Math.floor(total / 60);
  secondInput.value = total % 60;
}

function reportDailyCapacity(cycleSeconds, minutesPerDay = 430) {
  if (!Number(cycleSeconds)) return null;
  return Math.max(1, Math.floor((minutesPerDay * 60) / Number(cycleSeconds)));
}

function updateReportEstimate() {
  const estimate = $("#reportEstimate");
  if (!estimate) return;
  const totalQty = Number($("#workTotalQty")?.value || 0);
  const cycleSeconds = getReportCycleSeconds();
  const profile = selectedOrder ? getProgramProfile(selectedOrder) : null;
  const dailyQty = reportDailyCapacity(cycleSeconds);
  const noonTarget = reportDailyCapacity(cycleSeconds, 210);
  if (!totalQty || !cycleSeconds || !dailyQty) {
    estimate.textContent = "輸入工件總數與 cycle time 後，系統會估算每日產能與完工天數。";
    return;
  }
  const workDays = Math.max(1, Math.ceil(totalQty / dailyQty));
  const baseline = Number(profile?.baselineCycleSec) ? `歷史基準 ${formatSeconds(profile.baselineCycleSec)} / 件。` : "尚未建立歷史基準。";
  estimate.innerHTML = `
    <strong>預估 ${workDays} 個工作天完成</strong>
    <span>純加工 ${formatSeconds(cycleSeconds)} / 件，每日約 ${dailyQty} 件，中午應完成約 ${noonTarget || "-"} 件。${baseline}</span>
  `;
}

function updateNoonAdvice() {
  const advice = $("#noonAdvice");
  if (!advice || !selectedOrder) return;
  const completed = Number($("#completedQty")?.value || 0);
  const profile = getProgramProfile(selectedOrder);
  const noonTarget = reportDailyCapacity(profile?.pureCycleSec, 210);
  if (!noonTarget) {
    advice.textContent = "尚未建立 cycle time 基準，主管需用人工判斷是否加班。";
    return;
  }
  const delta = completed - noonTarget;
  advice.textContent = delta >= 0
    ? `中午累計 ${completed} 件，高於目標 ${noonTarget} 件，暫不需要加班。`
    : `中午累計 ${completed} 件，低於目標 ${noonTarget} 件，建議下午確認是否加班或拆單。`;
}

function setReportDefaults(order) {
  const profile = order ? getProgramProfile(order) : null;
  const totalQty = Number(order?.total || 0);
  const doneQty = Number(order?.done || 0);
  const workTotalInput = $("#workTotalQty");
  const machineQtyInput = $("#machineQty");
  const completedInput = $("#completedQty");
  const defectInput = $("#defectQty");
  if (workTotalInput) workTotalInput.value = totalQty || 0;
  if (machineQtyInput) machineQtyInput.value = doneQty || 0;
  if (completedInput) completedInput.value = doneQty || 0;
  if (defectInput) defectInput.value = 0;
  if (profile?.pureCycleSec) setReportCycleSeconds(profile.pureCycleSec);
  updateReportEstimate();
  updateNoonAdvice();
}

function setReportType(type) {
  activeReportType = reportTypeMeta[type] ? type : "workStart";
  const meta = reportTypeMeta[activeReportType];
  $$(".report-type-tab[data-report-type]").forEach((button) => {
    button.classList.toggle("active", button.dataset.reportType === activeReportType);
  });
  $$("[data-report-section]").forEach((section) => {
    section.classList.toggle("is-hidden", section.dataset.reportSection !== activeReportType);
  });
  $("#quantitySection")?.classList.toggle("is-hidden", !meta.needsQty);
  const submitButton = $(".submit-report");
  if (submitButton) submitButton.textContent = meta.submitLabel;
  if (activeReportType === "noon") updateNoonAdvice();
}

function fileForInput(inputId) {
  const capturedFile = capturedCameraFiles.get(inputId);
  if (capturedFile) return capturedFile;
  const input = $(`#${inputId}`);
  return input?.files?.[0] || null;
}

function hasFile(inputId) {
  return Boolean(fileForInput(inputId));
}

function checkedAll(ids) {
  return ids.every((id) => $(`#${id}`)?.checked);
}

function checkedRadio(name) {
  return Boolean(document.querySelector(`input[name="${name}"]:checked`));
}

function selectedRadioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function validateReportForm(type) {
  const completed = Number($("#completedQty")?.value || 0);
  const defects = Number($("#defectQty")?.value || 0);
  if (type === "workStart") {
    if (!Number($("#workTotalQty")?.value || 0)) return "請填寫工件總數。";
    if (!getReportCycleSeconds()) return "請填寫 cycle time。";
    if (!hasFile("startPhoto")) return "首次開工必須拍照。";
  }
  if (type === "dailyStart") {
    if (($("#machineQty")?.value ?? "") === "") return "請填寫目前機台已加工數量。";
    if (!hasFile("machinePhoto")) return "今日開工必須拍攝機台照片。";
    if (!checkedAll(["firstArticleSize", "firstArticleSurface", "firstArticleTool"])) return "請完成當日首件檢查表。";
  }
  if (["dailyStart", "noon", "finish"].includes(type)) {
    if (completed < 0 || defects < 0) return "良品累計與不良數不可小於 0。";
  }
  if (type === "afternoonCheck") {
    if (!checkedAll(["pmToolCheck", "pmDimensionCheck", "pmScheduleCheck"])) return "請完成下午檢查表。";
    if (!checkedRadio("pmAbnormal")) return "請確認是否異常。";
    if (selectedRadioValue("pmAbnormal") === "yes" && !$("#pmAbnormalNote")?.value.trim()) return "有異常時請填寫異常備註。";
  }
  if (type === "finish") {
    if (!hasFile("finishPhoto")) return "收工 / 完工必須拍照。";
    if (!checkedRadio("finishOvertime")) return "請確認是否加班。";
  }
  if (type === "abnormal") {
    if (!$("#abnormalType")?.value) return "請選擇異常類型。";
    if (!hasFile("abnormalPhoto")) return "異常回報必須拍照。";
  }
  return "";
}

function buildReportRemark(type, remark) {
  const meta = reportTypeMeta[type] || reportTypeMeta.workStart;
  const parts = [`[${meta.label}]`];
  if (type === "workStart") {
    parts.push(`總數 ${$("#workTotalQty")?.value || 0}`);
    parts.push(`cycle ${formatSeconds(getReportCycleSeconds())}`);
    parts.push(hasFile("programUpload") ? "程式已附檔" : "程式未上傳");
  }
  if (type === "dailyStart") {
    parts.push(`機台已加工數量 ${$("#machineQty")?.value || 0}`);
    parts.push("首件檢查完成");
  }
  if (type === "afternoonCheck") {
    parts.push(selectedRadioValue("pmAbnormal") === "yes" ? "下午檢查有異常" : "下午檢查正常");
    const plan = $("#overtimePlan")?.value;
    if (plan) parts.push(`加班安排 ${plan}`);
  }
  if (type === "finish") {
    parts.push(selectedRadioValue("finishOvertime") === "2030" ? "加班收工 20:30" : "一般下班 17:00");
  }
  if (type === "abnormal") {
    parts.push(`異常類型 ${$("#abnormalType")?.value || "-"}`);
  }
  if (remark) parts.push(remark);
  return parts.join("；");
}

function buildReportPayload(type) {
  return {
    report_type: type,
    work_total_qty: Number($("#workTotalQty")?.value || 0) || null,
    cycle_time_seconds: getReportCycleSeconds() || null,
    machine_qty: Number($("#machineQty")?.value || 0),
    completed_qty: Number($("#completedQty")?.value || 0),
    defect_qty: Number($("#defectQty")?.value || 0),
    has_program_upload: hasFile("programUpload"),
    overtime_plan: $("#overtimePlan")?.value || selectedRadioValue("finishOvertime") || "",
    pm_abnormal: selectedRadioValue("pmAbnormal") || "",
    abnormal_type: $("#abnormalType")?.value || "",
  };
}

function reportFilesForType(type) {
  const files = [];
  const pushFile = (inputId, kind, label) => {
    const file = fileForInput(inputId);
    if (file) files.push({ file, kind, label });
  };
  if (type === "workStart") {
    pushFile("startPhoto", "start_photo", "開工照片");
    pushFile("programUpload", "cnc_program", "CNC 程式");
  }
  if (type === "dailyStart") pushFile("machinePhoto", "machine_photo", "今日開工機台照片");
  if (type === "finish") pushFile("finishPhoto", "finish_photo", "完工照片");
  if (type === "abnormal") pushFile("abnormalPhoto", "abnormal_photo", "異常照片");
  return files;
}

function resetReportFileInputs() {
  ["programUpload", "startPhoto", "machinePhoto", "finishPhoto", "abnormalPhoto"].forEach((id) => {
    const input = $(`#${id}`);
    if (input) input.value = "";
    capturedCameraFiles.delete(id);
    updateCameraStatus(id);
  });
}

function updateCameraStatus(inputId) {
  const status = document.querySelector(`[data-camera-status-for="${inputId}"]`);
  if (!status) return;
  const file = fileForInput(inputId);
  status.textContent = file ? `已拍照：${file.name}` : "尚未拍照";
}

function setCameraCaptureReady(isReady) {
  activeCameraReady = isReady;
  const button = document.querySelector("[data-camera-capture]");
  if (!button) return;
  button.disabled = !isReady;
  button.textContent = isReady ? "拍照使用" : "相機啟動中";
}

function stopCameraStream() {
  if (!activeCameraStream) return;
  activeCameraStream.getTracks().forEach((track) => track.stop());
  activeCameraStream = null;
}

function closeCamera() {
  stopCameraStream();
  $("#cameraSheet")?.classList.remove("is-open");
  $("#cameraSheet")?.setAttribute("aria-hidden", "true");
  setCameraCaptureReady(false);
  activeCameraInputId = "";
  activeCameraLabel = "";
}

function waitForVideoMetadata(video) {
  if (!video) return Promise.resolve();
  if (video.readyState >= 1 && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      video.removeEventListener("loadedmetadata", finish);
      video.removeEventListener("canplay", finish);
      window.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = window.setTimeout(finish, 2500);
    video.addEventListener("loadedmetadata", finish, { once: true });
    video.addEventListener("canplay", finish, { once: true });
  });
}

function isProbablyInAppBrowser() {
  return /FBAN|FBAV|Instagram|Line|MicroMessenger|wv\)/i.test(navigator.userAgent || "");
}

function isLineInAppBrowser() {
  return /\bLine\//i.test(navigator.userAgent || "");
}

function isLineLiffClient() {
  try {
    return Boolean(window.liff?.isInClient?.());
  } catch {
    return false;
  }
}

function cameraFallbackMessage(error) {
  if (!window.isSecureContext) return "目前不是 HTTPS 安全連線，瀏覽器已封鎖即時相機。";
  if (isLineInAppBrowser() && !isLineLiffClient()) {
    return "目前是 LINE 內建瀏覽器，但尚未進入 LIFF，請改用 LIFF QR 開啟。";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return isProbablyInAppBrowser()
      ? "目前內建瀏覽器不支援即時相機，請改用 Chrome / Edge / Safari 開啟。"
      : "此瀏覽器沒有提供即時相機 API，已改用系統拍照/相簿。";
  }
  if (error?.name === "NotAllowedError") return "相機權限被拒絕，請在瀏覽器網站設定允許相機。";
  if (error?.name === "NotFoundError") return "找不到可用相機，已改用系統拍照/相簿。";
  return `即時相機無法啟動${error?.name ? ` (${error.name})` : ""}，已改用系統拍照/相簿。`;
}

function openCameraFileFallback(input, inputId, error) {
  const message = cameraFallbackMessage(error);
  const status = document.querySelector(`[data-camera-status-for="${inputId}"]`);
  if (status) status.textContent = message;
  input.setAttribute("accept", "image/*");
  input.setAttribute("capture", "environment");
  showToast(message);
  input.click();
}

async function openCamera(inputId, label) {
  const input = $(`#${inputId}`);
  if (!input) return;
  activeCameraInputId = inputId;
  activeCameraLabel = label || "照片";
  const title = $("#cameraTitle");
  if (title) title.textContent = `拍攝${activeCameraLabel}`;

  if (!navigator.mediaDevices?.getUserMedia) {
    openCameraFileFallback(input, inputId);
    return;
  }

  try {
    stopCameraStream();
    setCameraCaptureReady(false);
    activeCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    const preview = $("#cameraPreview");
    preview.srcObject = activeCameraStream;
    $("#cameraSheet").classList.add("is-open");
    $("#cameraSheet").setAttribute("aria-hidden", "false");
    await preview.play().catch(() => {});
    await waitForVideoMetadata(preview);
    setCameraCaptureReady(Boolean(preview.videoWidth && preview.videoHeight));
  } catch (error) {
    console.warn("Camera API failed, fallback to file input:", error);
    setCameraCaptureReady(false);
    openCameraFileFallback(input, inputId, error);
    return;
    showToast("無法直接開啟相機，改用手機內建拍照");
    input.click();
  }
}

function captureCameraPhoto() {
  const input = $(`#${activeCameraInputId}`);
  const preview = $("#cameraPreview");
  const canvas = $("#cameraCanvas");
  if (!input || !preview || !canvas) return;
  if (!activeCameraReady || !preview.videoWidth || !preview.videoHeight) {
    showToast("相機尚未準備好，請等畫面出現後再拍照");
    return;
  }
  const width = preview.videoWidth || 1280;
  const height = preview.videoHeight || 960;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(preview, 0, 0, width, height);
  canvas.toBlob((blob) => {
    if (!blob) {
      showToast("拍照失敗，請再試一次");
      return;
    }
    const fileName = `${activeCameraInputId}-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
    const file = new File([blob], fileName, { type: "image/jpeg" });
    capturedCameraFiles.set(activeCameraInputId, file);
    try {
      if (window.DataTransfer) {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
      }
    } catch (error) {
      console.warn("Programmatic file assignment is not supported; keeping captured file in memory.", error);
    }
    updateCameraStatus(activeCameraInputId);
    closeCamera();
    showToast(`${activeCameraLabel || "照片"}已拍攝`);
  }, "image/jpeg", 0.86);
}

function sanitizeStorageName(name) {
  return String(name || "file")
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "file";
}

function storageObjectUrl(bucket, path) {
  const baseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  const encodedPath = String(path).split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}

async function hashFile(file) {
  if (!window.crypto?.subtle) return "";
  const buffer = await file.arrayBuffer();
  const digest = await window.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function insertAttachmentMetadata(basePayload, extendedPayload) {
  if (useExtendedAttachmentMetadata) {
    try {
      await supabaseFetch("attachments", {
        method: "POST",
        body: JSON.stringify({ ...basePayload, ...extendedPayload }),
      });
      return;
    } catch (error) {
      const message = String(error.message || "");
      if (!message.includes("attachment_kind") && !message.includes("bucket_name") && !message.includes("storage_path")) {
        throw error;
      }
      useExtendedAttachmentMetadata = false;
    }
  }
  await supabaseFetch("attachments", {
    method: "POST",
    body: JSON.stringify(basePayload),
  });
}

async function uploadReportFile(reportId, entry) {
  const bucket = config.reportAttachmentBucket || "machtile-report-files";
  const tenantId = selectedOrder?.tenantId || config.tenantId;
  const safeName = sanitizeStorageName(entry.file.name);
  const storagePath = `${tenantId}/production_reports/${reportId}/${Date.now()}-${entry.kind}-${safeName}`;
  const uploadResponse = await fetch(storageObjectUrl(bucket, storagePath), {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${machtileSupabaseBearerToken()}`,
      "Content-Type": entry.file.type || "application/octet-stream",
      "x-upsert": "false",
    },
    body: entry.file,
  });
  if (!uploadResponse.ok) {
    const message = await uploadResponse.text();
    throw new Error(`${entry.label} 上傳失敗：${uploadResponse.status} ${message}`);
  }

  const fileHash = await hashFile(entry.file);
  const attachmentBasePayload = {
    tenant_id: tenantId,
    entity_type: "production_report",
    entity_id: reportId,
    file_name: entry.file.name,
    file_url: `${bucket}/${storagePath}`,
    file_type: [entry.kind, entry.file.type || "application/octet-stream", fileHash ? `sha256:${fileHash}` : ""].filter(Boolean).join("|"),
  };
  // polish-1 PL2: uploaded_by is a core-schema column, safe in the base
  // payload (the extended/fallback split only concerns the newer columns).
  const actorAppUserId = await machtileResolveAppUserId();
  if (actorAppUserId) attachmentBasePayload.uploaded_by = actorAppUserId;
  await insertAttachmentMetadata(attachmentBasePayload, {
    bucket_name: bucket,
    storage_path: storagePath,
    attachment_kind: entry.kind,
    mime_type: entry.file.type || "application/octet-stream",
    file_size_bytes: entry.file.size,
    file_hash: fileHash,
  });
}

async function uploadReportFiles(reportId, reportType) {
  if (!config.enableFileUpload || state.source !== "supabase" || !reportId || !config.supabaseUrl || !config.supabaseAnonKey) {
    return { uploaded: 0, failed: 0 };
  }
  const files = reportFilesForType(reportType);
  let uploaded = 0;
  let failed = 0;
  for (const entry of files) {
    try {
      await uploadReportFile(reportId, entry);
      uploaded += 1;
    } catch (error) {
      failed += 1;
      console.warn(error);
    }
  }
  return { uploaded, failed };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

// ---- MachTile auth mode + strict session (Gate P / P2) ----
// authMode "dev-nologin" (default) keeps the Dev/Pages demo fully anonymous —
// behavior identical to before P2. authMode "strict" is the production UI
// track: an app-level login gate runs before any route (GlobalLoginGate,
// locked 2026-06-06) and machtileSupabaseBearerToken() switches every
// read/write (REST, RPC, storage) to the signed-in session Bearer, because
// the P1 production bundle revokes ALL anon access. Session helpers restored
// from the pre-S6 planner auth module (7b9309b~1) and generalized: planner,
// supervisor, and per-station operator accounts all use the same gate
// (P_AUTH_MODEL=AllAuthenticated); per-role write permissions are enforced
// server-side and surface as mapped error codes.

function machtileAuthMode() {
  return config.authMode === "strict" ? "strict" : "dev-nologin";
}

function machtileStrictMode() {
  return machtileAuthMode() === "strict";
}

const machtileAuthState = {
  status: "signedOut",
  accessToken: "",
  email: "",
  userId: "",
  tenantId: "",
  role: "",
  // Platform tier (AM4): app_metadata.platform_role === 'super_admin' on the
  // auth account; orthogonal to tenant role — only gates the 平台管理 card
  // (the Edge Functions stay authoritative server-side).
  platformRole: "",
  // polish-1: app_users.id for the signed-in account, lazily resolved by
  // machtileResolveAppUserId() so legacy REST writes can carry the actor.
  appUserId: "",
  // polish-3 (PC2=NameWithEmailFallback): app_users.name from the same
  // lookup, cached for the header user chip.
  appUserName: "",
  // polish-2 (PB1=TimerPlusRestore): rotated GoTrue refresh token so the 1h
  // access token renews silently instead of re-gating mid-shift.
  refreshToken: "",
  expiresAt: 0,
  error: "",
};

function machtileAuthConfigured() {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

function hmcBase64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

function hmcDecodeJwtPayload(token) {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return {};
    return JSON.parse(hmcBase64UrlDecode(payload));
  } catch (error) {
    return {};
  }
}

// Route changes in this app are full page loads, so the strict session is
// persisted in sessionStorage (per-tab, gone when the tab closes); the gate
// stays the only way to create one.
const MACHTILE_SESSION_STORAGE_KEY = "machtileAuthSession";

function machtilePersistSession() {
  try {
    sessionStorage.setItem(MACHTILE_SESSION_STORAGE_KEY, JSON.stringify({
      accessToken: machtileAuthState.accessToken,
      refreshToken: machtileAuthState.refreshToken,
      email: machtileAuthState.email,
    }));
  } catch (error) {
    // Storage unavailable (private mode etc.) — session stays memory-only.
  }
}

function machtileDropPersistedSession() {
  try {
    sessionStorage.removeItem(MACHTILE_SESSION_STORAGE_KEY);
  } catch (error) {
    // ignore
  }
}

async function machtileRestoreSession() {
  if (!machtileStrictMode()) return false;
  let stored = null;
  try {
    stored = JSON.parse(sessionStorage.getItem(MACHTILE_SESSION_STORAGE_KEY) || "null");
  } catch (error) {
    stored = null;
  }
  if (!stored?.accessToken) return false;
  const claims = hmcDecodeJwtPayload(stored.accessToken);
  if (claims.exp && Number(claims.exp) * 1000 > Date.now()) {
    machtileSetSession({ access_token: stored.accessToken, refresh_token: stored.refreshToken || "" }, stored.email || "");
    return machtileSessionActive();
  }
  // polish-2 (PB1=TimerPlusRestore): expired access token but a stored
  // refresh token → renew silently instead of gating.
  if (stored.refreshToken) {
    machtileAuthState.refreshToken = stored.refreshToken;
    machtileAuthState.email = stored.email || "";
    const outcome = await machtileRefreshSession();
    if (outcome === "ok" && machtileSessionActive()) return true;
    if (outcome === "retry") {
      // Network hiccup — keep the stored pair so a later reload can retry;
      // this load falls back to the gate.
      machtileAuthState.refreshToken = "";
      machtileAuthState.email = "";
      return false;
    }
  }
  machtileClearSession();
  return false;
}

function machtileSetSession(authResponse, email) {
  const accessToken = authResponse?.access_token || "";
  const jwtPayload = hmcDecodeJwtPayload(accessToken);
  const appMetadata = jwtPayload.app_metadata || {};
  machtileAuthState.status = "signedIn";
  machtileAuthState.accessToken = accessToken;
  machtileAuthState.email = email || authResponse?.user?.email || jwtPayload.email || "";
  machtileAuthState.userId = authResponse?.user?.id || jwtPayload.sub || "";
  machtileAuthState.tenantId = appMetadata.tenant_id || appMetadata.tenantId || jwtPayload.tenant_id || config.tenantId || "";
  machtileAuthState.role = appMetadata.role || jwtPayload.role || "";
  machtileAuthState.platformRole = appMetadata.platform_role || "";
  machtileAuthState.appUserId = "";
  machtileAuthState.appUserName = "";
  machtileAuthState.refreshToken = authResponse?.refresh_token || "";
  machtileAuthState.expiresAt = jwtPayload.exp ? Number(jwtPayload.exp) * 1000 : Date.now() + Number(authResponse?.expires_in || 0) * 1000;
  machtileAuthState.error = "";
  machtilePersistSession();
}

function machtileClearSession(message = "") {
  machtileAuthState.status = "signedOut";
  machtileAuthState.accessToken = "";
  machtileAuthState.email = "";
  machtileAuthState.userId = "";
  machtileAuthState.tenantId = "";
  machtileAuthState.role = "";
  machtileAuthState.platformRole = "";
  machtileAuthState.appUserId = "";
  machtileAuthState.appUserName = "";
  machtileAuthState.refreshToken = "";
  machtileAuthState.expiresAt = 0;
  machtileAuthState.error = message;
  machtileDropPersistedSession();
}

function machtileSessionActive() {
  return Boolean(machtileAuthState.accessToken && machtileAuthState.status === "signedIn" && (!machtileAuthState.expiresAt || machtileAuthState.expiresAt > Date.now()));
}

// Internal login suffix for username-style accounts (AM6). PERMANENT — changing
// it would orphan every short-account login (auth stores the full form).
const machtileLoginSuffix = "@machtile.local";

function machtileAccountToEmail(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.includes("@") ? raw.toLowerCase() : `${raw.toLowerCase()}${machtileLoginSuffix}`;
}

function machtileAccountDisplay(value) {
  const raw = String(value || "");
  return raw.toLowerCase().endsWith(machtileLoginSuffix) ? raw.slice(0, raw.length - machtileLoginSuffix.length) : raw;
}

// Password show/hide toggle (AM7). Delegated listener survives re-renders.
const machtilePwEyeSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const machtilePwEyeOffSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.77 21.77 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a21.8 21.8 0 0 1-3.22 4.31M1 1l22 22"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/></svg>';

function machtilePasswordField(inputHtml) {
  return `<span class="pw-field">${inputHtml}<button type="button" class="pw-toggle" data-pw-toggle aria-label="顯示密碼">${machtilePwEyeSvg}</button></span>`;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-pw-toggle]");
  if (!button) return;
  const input = button.closest(".pw-field")?.querySelector("input");
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  button.innerHTML = show ? machtilePwEyeOffSvg : machtilePwEyeSvg;
  button.setAttribute("aria-label", show ? "隱藏密碼" : "顯示密碼");
});

async function machtileLogin(email, password) {
  if (!machtileAuthConfigured()) {
    throw new Error("尚未設定 Supabase 連線參數，無法登入。");
  }
  if (!email || !password) {
    throw new Error("請輸入帳號與密碼。");
  }

  const baseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    payload = { message: responseText };
  }

  if (!response.ok) {
    throw new Error(payload.error_description || payload.msg || payload.message || `${response.status} 登入失敗`);
  }

  machtileSetSession(payload, email);
  return payload;
}

// polish-2 (PB1=TimerPlusRestore): single-flight refresh of the 1h access
// token. GoTrue ROTATES the refresh token on every call, so the new pair must
// overwrite state + sessionStorage atomically (machtileSetSession does both)
// and concurrent callers must share one in-flight request.
// Returns "ok" (rotated), "retry" (network hiccup — token may still be valid,
// keep the session and let the next tick retry) or "dead" (definitive auth
// failure — caller gates).
let machtileRefreshPromise = null;

function machtileRefreshSession() {
  if (machtileRefreshPromise) return machtileRefreshPromise;
  machtileRefreshPromise = (async () => {
    if (!machtileAuthConfigured() || !machtileAuthState.refreshToken) return "dead";
    const baseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
    let response;
    try {
      response = await fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: {
          apikey: config.supabaseAnonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: machtileAuthState.refreshToken }),
      });
    } catch (error) {
      console.warn("MachTile session refresh network error; will retry", error);
      return "retry";
    }
    let payload = {};
    try {
      payload = await response.json();
    } catch (error) {
      payload = {};
    }
    if (!response.ok || !payload.access_token) {
      console.warn("MachTile session refresh rejected", response.status, payload.error_description || payload.msg || "");
      return response.status >= 500 ? "retry" : "dead";
    }
    machtileSetSession(payload, machtileAuthState.email || "");
    return "ok";
  })().finally(() => {
    machtileRefreshPromise = null;
  });
  return machtileRefreshPromise;
}

// Renewal timer: refresh when less than 5 minutes of token life remain. The
// visibility/focus checks cover device sleep (suspended timers): on wake the
// tick fires immediately and the refresh token — which does not expire by
// time — resumes the session even if the access token already lapsed.
const MACHTILE_REFRESH_SKEW_MS = 5 * 60 * 1000;
let machtileRefreshTimerStarted = false;

function machtileEnsureRefreshTimer() {
  if (!machtileStrictMode() || machtileRefreshTimerStarted) return;
  machtileRefreshTimerStarted = true;
  setInterval(machtileRefreshTick, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) machtileRefreshTick();
  });
  window.addEventListener("focus", () => machtileRefreshTick());
}

async function machtileRefreshTick() {
  if (!machtileStrictMode()) return;
  if (machtileAuthState.status !== "signedIn" || !machtileAuthState.refreshToken) return;
  if (machtileAuthState.expiresAt && machtileAuthState.expiresAt - Date.now() > MACHTILE_REFRESH_SKEW_MS) return;
  const outcome = await machtileRefreshSession();
  if (outcome === "dead") machtileHandleUnauthorized();
}

// polish-2 (PB2=RevokeOnLogout): explicit sign-out also kills the refresh
// chain server-side. Fire-and-forget — the local clear + reload must never
// wait on (or fail because of) this call.
function machtileServerSignOut() {
  if (!machtileAuthConfigured() || !machtileAuthState.accessToken) return;
  const baseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  try {
    fetch(`${baseUrl}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${machtileAuthState.accessToken}`,
      },
      keepalive: true,
    }).catch(() => {});
  } catch (error) {
    // ignore — local clear proceeds regardless
  }
}

function machtileSupabaseBearerToken() {
  if (machtileStrictMode() && machtileSessionActive()) {
    return machtileAuthState.accessToken;
  }
  return config.supabaseAnonKey;
}

// polish-1 (PL1=ClientLookupPayload): the legacy field-report path writes
// production_reports / attachments via direct REST insert, so the actor has
// to be resolved client-side (strict RPC bodies do
// app_users.auth_user_id = auth.uid() server-side; REST has no server side).
// Resolved once per page load and cached on machtileAuthState. Soft fallback:
// a lookup hiccup must never block a report — the row just keeps a NULL
// actor, same as before polish-1. dev-nologin always returns "" (no session).
async function machtileResolveAppUserId() {
  if (!machtileStrictMode() || !machtileSessionActive() || !machtileAuthState.userId) return "";
  if (machtileAuthState.appUserId) return machtileAuthState.appUserId;
  try {
    // polish-3: select extended id → id,name so the header user chip gets the
    // display name from the same single cached lookup (PC2).
    const rows = await supabaseFetch(
      `app_users?select=id,name&auth_user_id=eq.${encodeURIComponent(machtileAuthState.userId)}&is_active=eq.true&limit=1`
    );
    machtileAuthState.appUserId = (Array.isArray(rows) && rows[0]?.id) || "";
    machtileAuthState.appUserName = (Array.isArray(rows) && rows[0]?.name) || "";
  } catch (error) {
    console.warn("app_users actor lookup failed; write will carry no user_id", error);
    machtileAuthState.appUserId = "";
    machtileAuthState.appUserName = "";
  }
  return machtileAuthState.appUserId;
}

// Strict-only server error codes shared by every write surface; used as a
// fallback where a panel has no dedicated per-RPC code map.
const machtileStrictErrorMessages = {
  AUTH_REQUIRED: "請先登入正式環境帳號。",
  FORBIDDEN: "此帳號沒有執行這項操作的權限。",
  ACTOR_NOT_FOUND: "登入帳號未對應到啟用中的使用者，請聯絡管理員。",
  CONFIRMED_ALREADY_CONVERTED: "這筆已轉入草稿／報表，不能直接退回；請先在正式報表頁修訂重發或作廢，釋回後再退。",
  ONLY_PENDING_REVIEW_CAN_BE_REVIEWED: "只有待確認（或未轉換的已確認）項目可以退回。",
  QUANTITY_NOT_PENDING_REVIEW: "只有待確認（或未轉換的已確認）項目可以退回。",
};

function machtileStrictErrorMessage(code) {
  return machtileStrictErrorMessages[code] || "";
}

// 401 from REST/RPC in strict mode means the session expired or was revoked:
// drop the session and put the login gate back up.
function machtileHandleUnauthorized() {
  if (!machtileStrictMode()) return;
  machtileClearSession("登入已過期，請重新登入。");
  const badge = document.getElementById("machtileSessionBadge");
  if (badge) badge.remove();
  machtileRenderLoginGate();
}

function machtileRemoveLoginGate() {
  const overlay = document.getElementById("machtileLoginGate");
  if (overlay) overlay.remove();
}

function machtileRenderLoginGate() {
  let overlay = document.getElementById("machtileLoginGate");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "machtileLoginGate";
    overlay.className = "machtile-login-gate";
    document.body.appendChild(overlay);
  }

  if (!machtileAuthConfigured()) {
    overlay.innerHTML = `
      <section class="machtile-login-card" aria-label="MachTile login unavailable">
        <p class="eyebrow">MachTile 正式環境</p>
        <strong>尚未設定連線參數</strong>
        <p>strict 模式需要 Supabase URL 與 anon key 才能登入。請確認 config.js。</p>
      </section>
    `;
    return;
  }

  const busy = machtileAuthState.status === "signingIn";
  overlay.innerHTML = `
    <section class="machtile-login-card" aria-label="MachTile login">
      <p class="eyebrow">MachTile 正式環境</p>
      <strong>請先登入</strong>
      <p>此環境所有讀寫都需要帳號（排程 / 主管 / 站別共用帳號）。</p>
      ${machtileAuthState.error ? `<p class="machtile-login-error">${escapeHtml(machtileAuthState.error)}</p>` : ""}
      <form class="machtile-login-form" data-machtile-login-form>
        <label>
          <span>帳號（工號或 Email）</span>
          <input type="text" name="email" autocomplete="username" required ${busy ? "disabled" : ""}>
        </label>
        <label>
          <span>密碼</span>
          ${machtilePasswordField(`<input type="password" name="password" autocomplete="current-password" required ${busy ? "disabled" : ""}>`)}
        </label>
        <button type="submit" ${busy ? "disabled" : ""}>${busy ? "登入中..." : "登入"}</button>
      </form>
    </section>
  `;

  overlay.querySelector("[data-machtile-login-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = machtileAccountToEmail(formData.get("email"));
    const password = String(formData.get("password") || "");
    machtileAuthState.status = "signingIn";
    machtileAuthState.error = "";
    machtileRenderLoginGate();
    try {
      await machtileLogin(email, password);
      machtileRemoveLoginGate();
      machtileEnsureSessionBadge();
      machtileApplyBranding();
      machtileEnsureRefreshTimer();
      showToast("登入成功");
      await machtileResumeInit();
    } catch (error) {
      machtileClearSession(error?.message || "登入失敗，請再試一次。");
      machtileRenderLoginGate();
    }
  });
}

function machtileEnsureSessionBadge() {
  if (!machtileStrictMode() || !machtileSessionActive()) return;
  let badge = document.getElementById("machtileSessionBadge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "machtileSessionBadge";
    badge.className = "machtile-session-badge";
    document.body.appendChild(badge);
  }
  badge.innerHTML = `
    <span>${escapeHtml(machtileAuthState.email || "已登入")}</span>
    <small>${escapeHtml(machtileAuthState.role || "member")}</small>
    <button type="button" data-machtile-logout>登出</button>
  `;
  badge.querySelector("[data-machtile-logout]")?.addEventListener("click", () => {
    machtileServerSignOut();
    machtileClearSession();
    // Local session (incl. per-tab storage) is gone — the reload lands back
    // on the login gate.
    window.location.reload();
  });
}

// polish-3 (PC1=FactoryName / PC2=NameWithEmailFallback / PC3=BlankNeverWrong):
// the topbar carried hardcoded prototype branding (永承一廠 / 張家維) — a
// factual error once production gained a second tenant. Strict mode replaces
// the plant name with the tenant's factories.name (tenants itself has no
// authenticated select policy under P01) and the user chip with the signed-in
// account. dev-nologin never reaches this call, so the Dev demo header stays
// byte-identical mock.
function machtileSetUserChip(label) {
  const chip = document.querySelector(".user-chip");
  if (!chip) return;
  const text = String(label || "");
  chip.innerHTML = `<span>${escapeHtml(text.charAt(0).toUpperCase())}</span>${escapeHtml(text)}`;
}

async function machtileApplyBranding() {
  if (!machtileStrictMode() || !machtileSessionActive()) return;
  // BlankNeverWrong: kill the placeholders synchronously — a blank header
  // beats showing another factory's name while lookups are in flight.
  const plantNameEl = document.getElementById("plantName");
  if (plantNameEl) plantNameEl.textContent = "";
  machtileSetUserChip(machtileAccountDisplay(machtileAuthState.email));
  // Display name rides the polish-1 actor lookup (cached, soft-fallback);
  // chip upgrades from email to app_users.name when it resolves.
  machtileResolveAppUserId().then(() => {
    if (machtileAuthState.appUserName) machtileSetUserChip(machtileAuthState.appUserName);
  });
  try {
    const rows = await supabaseFetch("factories?select=name&is_active=eq.true&order=factory_code&limit=1");
    const factoryName = (Array.isArray(rows) && rows[0]?.name) || "";
    if (factoryName && plantNameEl) plantNameEl.textContent = factoryName;
  } catch (error) {
    console.warn("factory name lookup failed; plant name stays blank", error);
  }
}

function supabaseHeaders() {
  const headers = {
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${machtileSupabaseBearerToken()}`,
    "Content-Type": "application/json",
  };
  if (config.tenantId) headers["x-machtile-tenant-id"] = config.tenantId;
  return headers;
}

async function supabaseFetch(path, options = {}) {
  const baseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...supabaseHeaders(),
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    if (response.status === 401) machtileHandleUnauthorized();
    const message = await response.text();
    throw new Error(`${response.status} ${message}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function normalizeOrder(row) {
  return {
    id: row.work_order_no,
    workOrderId: row.id || row.work_order_id || row.work_order_no,
    processId: row.current_process_id || null,
    tenantId: row.tenant_id || config.tenantId,
    customer: row.customer_name || row.customer_name_snapshot || "未指定客戶",
    part: row.part_name || "未命名零件",
    drawing: row.drawing_no || row.part_no || "-",
    dueDate: row.due_date,
    process: row.current_process_name || "未指定製程",
    machine: row.machine_name || "",
    done: Number(row.qty_completed || 0),
    total: Number(row.quantity || 0),
    lastReport: row.last_report_at ? formatRelativeTime(row.last_report_at) : "尚未回報",
    priority: row.priority || "normal",
    workStatus: row.work_order_status || "not_started",
    processStatus: row.current_process_status || "pending",
    risk: row.open_risk_level || null,
    programName: row.program_name,
    programVersion: row.program_version,
    previousProgramVersion: row.previous_program_version,
    programHash: row.program_hash,
    previousProgramHash: row.previous_program_hash,
    pureCycleSec: row.pure_cycle_seconds ? Number(row.pure_cycle_seconds) : null,
    baselineCycleSec: row.baseline_cycle_seconds ? Number(row.baseline_cycle_seconds) : null,
    loadUnloadSec: row.load_unload_seconds ? Number(row.load_unload_seconds) : null,
    historyRuns: row.history_runs ? Number(row.history_runs) : null,
    historyYears: row.history_years ? Number(row.history_years) : null,
    lastRunDate: row.last_run_date,
  };
}

function normalizeMachineMaster(row) {
  return {
    name: row.machine_name || row.machine_code,
    code: row.machine_code || row.machine_name,
    type: row.machine_type || "other",
    rawStatus: row.status || "idle",
    assetNo: row.asset_no,
    displayOrder: Number(row.display_order || 0),
    department: row.department_name,
    qrPath: row.qr_path,
    vendorName: row.vendor_name,
    coolantType: row.coolant_type,
    coolantCapacityLiters: row.coolant_capacity_liters ? Number(row.coolant_capacity_liters) : null,
    targetConcentrationPercent: row.target_concentration_percent ? Number(row.target_concentration_percent) : null,
    inspectionFrequencyDays: row.inspection_frequency_days ? Number(row.inspection_frequency_days) : null,
    reportRuleName: row.report_rule_name,
    reportsPerDay: row.reports_per_day ? Number(row.reports_per_day) : null,
    staleMinutes: row.stale_minutes ? Number(row.stale_minutes) : null,
    programCount: Number(row.program_count || 0),
  };
}

async function loadFromSupabase() {
  const rows = await supabaseFetch("v_work_order_cards?select=*&order=due_date.asc,work_order_no.asc");
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("v_work_order_cards has no rows");
  state.workOrders = rows.map(normalizeOrder);
  try {
    const machineRows = await supabaseFetch("v_machine_management_cards?select=*&order=display_order.asc,machine_code.asc");
    state.machineMasters = Array.isArray(machineRows) ? machineRows.map(normalizeMachineMaster) : [];
  } catch (error) {
    console.warn("v_machine_management_cards is not ready yet; using local machine defaults.", error);
    state.machineMasters = [];
  }
  state.source = "supabase";
}

function loadMockData() {
  state.workOrders = mockOrders.map((order) => ({ ...order }));
  state.machineMasters = [];
  state.source = "mock";
}

function deriveOrderStatus(order) {
  const due = dueInfo(order);
  const isAbnormal = order.workStatus === "abnormal" || order.processStatus === "abnormal";
  if (order.risk === "critical" || due.diffDays < 0) return "overdue";
  if (isAbnormal) return "abnormal";
  if (order.risk === "high") return "aiRisk";
  if (order.risk === "medium" || order.workStatus === "waiting_inspection" || order.processStatus === "waiting_inspection") return "inspection";
  if (order.workStatus === "not_started" || order.processStatus === "pending" || order.lastReport === "尚未回報") return "stale";
  if (order.workStatus === "in_progress" || order.processStatus === "running") return "running";
  return "normal";
}

function alertCategories(order) {
  const status = deriveOrderStatus(order);
  const categories = new Set();
  if (status === "overdue") categories.add("已延誤");
  if (status === "aiRisk") categories.add("可能延誤");
  if (status === "abnormal" || order.workStatus === "abnormal" || order.processStatus === "abnormal") categories.add("異常");
  if (status === "inspection" || order.workStatus === "waiting_inspection" || order.processStatus === "waiting_inspection") categories.add("待品檢");
  if (dueInfo(order).diffDays === 0) categories.add("今日到期");
  if (status === "stale" || String(order.lastReport || "").includes("尚未")) categories.add("未回報");
  return categories;
}

function primaryAlertStatus(order) {
  const categories = alertCategories(order);
  if (categories.has("已延誤")) return "overdue";
  if (categories.has("可能延誤")) return "aiRisk";
  if (categories.has("異常")) return "abnormal";
  if (categories.has("待品檢")) return "inspection";
  if (categories.has("今日到期")) return "inspection";
  if (categories.has("未回報")) return "stale";
  return deriveOrderStatus(order);
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未回報";
  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 60) return `${diffMinutes} 分鐘前`;
  if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)} 小時前`;
  return `${Math.round(diffMinutes / 1440)} 天前`;
}

function machtileFormatAuditTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function departmentForMachine(machine) {
  if (isHmcMachine(machine)) return "銑床課";
  const text = `${machine.type || ""} ${machine.processName || ""} ${machine.order?.process || ""}`.toLowerCase();
  if (text.includes("車")) return "車床課";
  if (text.includes("lathe")) return "車床課";
  if (text.includes("銑") || text.includes("五軸") || text.includes("mill") || text.includes("milling")) return "銑床課";
  return "其他";
}

function normalizedMachineDepartment(machine) {
  const raw = String(machine?.department || "").trim();
  const rawLower = raw.toLowerCase();
  if (raw === "車床課" || raw.includes("車") || rawLower.includes("lathe")) return "車床課";
  if (raw === "銑床課" || raw.includes("銑") || raw.includes("五軸") || rawLower.includes("mill") || rawLower.includes("milling")) return "銑床課";
  return departmentForMachine(machine);
}

function machineTypeLabel(type) {
  const text = String(type || "");
  if (text.includes("lathe")) return "車床";
  if (text.includes("mill")) return "銑床";
  if (text.includes("車")) return "車床";
  if (text.includes("銑")) return "銑床";
  if (text.includes("五軸")) return "五軸";
  if (text.includes("鋸")) return "鋸料";
  return text || "機台";
}

function machineStatus(machine) {
  if (machine.isUnassignedBucket) return "unassigned";
  if (machine.rawStatus === "maintenance") return "maintenance";
  if (machine.rawStatus === "paused") return "paused";
  if (!machine.order) return "idle";
  return deriveOrderStatus(machine.order);
}

function deriveMachines() {
  const machines = new Map();
  const masterMachines = state.machineMasters.length ? [...state.machineMasters] : [...baseMachines];
  if (state.machineMasters.length) {
    const knownMachineKeys = new Set(masterMachines.flatMap((machine) => [machine.name, machine.code].filter(Boolean)));
    baseMachines.filter(isHmcMachine).forEach((machine) => {
      if (!knownMachineKeys.has(machine.name) && !knownMachineKeys.has(machine.code)) {
        masterMachines.push({ ...machine, displayOrder: machine.displayOrder || 900 });
      }
    });
  }

  masterMachines.forEach((machine) => {
    machines.set(machine.name, {
      ...machine,
      order: null,
      workOrderNo: null,
      processName: null,
      done: 0,
      total: 0,
      lastReport: "",
    });
  });

  state.workOrders.forEach((order) => {
    const hasAssignedMachine = isReportableMachineName(order.machine);
    const name = hasAssignedMachine ? order.machine : UNASSIGNED_MACHINE;
    const base = machines.get(name) || {
      name,
      type: hasAssignedMachine ? machineTypeLabel(order.process) : order.process || "未指派",
      department: hasAssignedMachine ? undefined : UNASSIGNED_MACHINE,
      rawStatus: hasAssignedMachine && order.processStatus === "pending" ? "idle" : "running",
      displayOrder: hasAssignedMachine ? undefined : 9999,
      isUnassignedBucket: !hasAssignedMachine,
      order: null,
    };

    machines.set(name, {
      ...base,
      type: base.type || machineTypeLabel(order.process),
      rawStatus: hasAssignedMachine && order.processStatus === "paused" ? "paused" : base.rawStatus || "running",
      isUnassignedBucket: !hasAssignedMachine,
      order,
      workOrderNo: order.id,
      part: order.part,
      customer: order.customer,
      dueDate: order.dueDate,
      processName: order.process,
      done: order.done,
      total: order.total,
      lastReport: order.lastReport,
    });
  });

  state.machines = Array.from(machines.values())
    .map((machine) => ({ ...machine, status: machineStatus(machine), department: normalizedMachineDepartment(machine) }))
    .sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999) || a.name.localeCompare(b.name, "zh-Hant"));
}

function riskSuggestion(order) {
  const status = deriveOrderStatus(order);
  if (status === "overdue") {
    return "已進入交期風險。建議安排夜間或假日趕工，並提前通知客戶可能延後 1 天。";
  }
  if (status === "abnormal") {
    return "製程發生異常。建議先確認不良原因與可重工數量，再決定是否拆單到其他機台。";
  }
  if (status === "aiRisk") {
    return `目前完成 ${order.done}/${order.total}，進度低於交期節奏。建議今日加班 2 小時，或拆 30 件轉到可用機台。`;
  }
  if (status === "inspection") {
    return "加工已完成或接近完成，但卡在品檢。建議今日上午優先安排品檢，避免出貨延誤。";
  }
  if (status === "stale") {
    return "目前缺少現場回報。建議通知師傅更新狀態，避免主管用舊資料判斷交期。";
  }
  return "進度符合排程。維持正常回報節奏即可。";
}

function alertReason(order) {
  const status = primaryAlertStatus(order);
  if (status === "overdue") return order.workStatus === "abnormal" ? "尺寸超差需重做" : "剩餘製程不足以準時完成";
  if (status === "abnormal") return "製程異常待主管確認";
  if (status === "aiRisk") return `${order.machine || "機台"} 進度落後`;
  if (status === "inspection") return "品檢未排程或等待處理";
  if (status === "stale") return "現場未回報最新狀態";
  return "今日需完成";
}

function remainingProcesses(order) {
  const status = deriveOrderStatus(order);
  if (status === "inspection") return "品檢 · 包裝 · 出貨";
  if (status === "stale") return `${order.process || "首道製程"} · 待開工`;
  return `${order.process || "CNC 加工"} · 去毛邊 · 品檢`;
}

function alertActions(order) {
  const status = primaryAlertStatus(order);
  if (status === "overdue") return ["安排夜班", "拆單到 CNC-04", "通知客戶", "標記已處理", "忽略提醒"];
  if (status === "aiRisk") return ["安排加班", "拆單到 CNC-05", "通知客戶", "標記已處理", "忽略提醒"];
  if (status === "abnormal") return ["處理異常", "建立重工", "通知主管", "標記已處理"];
  if (status === "inspection") return ["指派品檢", "標記已處理", "忽略提醒"];
  if (status === "stale") return ["通知師傅", "查看機台", "忽略提醒"];
  return ["查看工單", "標記已處理"];
}

function renderStats() {
  const abnormalCount = state.workOrders.filter((order) => order.workStatus === "abnormal" || order.processStatus === "abnormal").length;
  const actualMachines = managedMachineList();
  const unassignedOrders = state.workOrders.filter((order) => !isOrderReportable(order)).length;
  const stats = [
    ["總機台", actualMachines.length, "risk-blue", "全部狀態"],
    ["加工中", actualMachines.filter((machine) => machine.order && !["idle", "maintenance"].includes(machine.status)).length, "risk-blue", "加工中"],
    ["可能延誤", state.workOrders.filter((order) => deriveOrderStatus(order) === "aiRisk").length, "risk-purple", "可能延誤"],
    ["已延誤", state.workOrders.filter((order) => deriveOrderStatus(order) === "overdue").length, "risk-red", "已延誤"],
    ["異常", abnormalCount + actualMachines.filter((machine) => ["maintenance", "paused"].includes(machine.status)).length, "risk-red", "異常"],
    ["待品檢", state.workOrders.filter((order) => alertCategories(order).has("待品檢")).length, "risk-amber", "待品檢"],
    ["未排機", unassignedOrders, "risk-gray", "未排機"],
    ["未回報", state.workOrders.filter((order) => alertCategories(order).has("未回報")).length, "risk-gray", "未回報"],
  ];

  $("#statsGrid").innerHTML = stats.map(([label, value, riskClass, filter]) => `
    <button class="stat-card stat-button ${riskClass} ${activeStatusFilter === filter ? "active" : ""}" data-stat-filter="${escapeHtml(filter)}" type="button">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${value}</strong>
    </button>
  `).join("");
}

function renderFilters() {
  $("#departmentChips").innerHTML = departmentFilters.map((filter) => `
    <span class="department-filter-group ${activeDepartmentFilter === filter ? "is-active" : ""}">
      <button class="filter-chip department-chip ${activeDepartmentFilter === filter ? "active" : ""}" data-department="${escapeHtml(filter)}" type="button">
        ${escapeHtml(filter)}
      </button>
      ${filter === "銑床課" && activeDepartmentFilter === "銑床課" ? `
        <span class="milling-mode-chips" aria-label="銑床課報工模式">
          ${millingModeFilters.map((mode) => `
            <button class="filter-chip milling-mode-chip ${activeMillingModeFilter === mode ? "active" : ""}" data-milling-mode="${escapeHtml(mode)}" type="button">
              ${escapeHtml(mode)}
            </button>
          `).join("")}
        </span>
      ` : ""}
    </span>
  `).join("");

  $("#statusChips").innerHTML = statusFilters.map((filter) => `
    <button class="filter-chip status-chip ${activeStatusFilter === filter ? "active" : ""}" data-status="${escapeHtml(filter)}" type="button">
      ${escapeHtml(filter)}
    </button>
  `).join("");
}

function matchesMillingModeFilter(machine) {
  if (activeDepartmentFilter !== "銑床課" || activeMillingModeFilter === "全部銑床") return true;
  const isHmc = isHmcMachine(machine);
  if (activeMillingModeFilter === "多盤多工件") return isHmc;
  if (activeMillingModeFilter === "單盤單工件") return !isHmc;
  return true;
}

function matchesStatusFilter(machine) {
  if (activeStatusFilter === "全部狀態") return true;
  if (activeStatusFilter === "加工中") return Boolean(machine.order) && !["idle", "maintenance"].includes(machine.status);
  const order = machine.order;
  if (activeStatusFilter === "可能延誤") return order && alertCategories(order).has("可能延誤");
  if (activeStatusFilter === "已延誤") return order && alertCategories(order).has("已延誤");
  if (activeStatusFilter === "異常") return machine.status === "maintenance" || machine.status === "paused" || (order && alertCategories(order).has("異常"));
  if (activeStatusFilter === "待品檢") return order && alertCategories(order).has("待品檢");
  if (activeStatusFilter === "今日到期") return order && alertCategories(order).has("今日到期");
  if (activeStatusFilter === "未排機") return Boolean(machine.isUnassignedBucket);
  if (activeStatusFilter === "未回報") return order ? alertCategories(order).has("未回報") : machine.status === "idle";
  return true;
}

function visibleMachines() {
  return state.machines
    .filter((machine) => activeDepartmentFilter === "全部" || machine.department === activeDepartmentFilter)
    .filter(matchesMillingModeFilter)
    .filter(matchesStatusFilter);
}

function renderWorkOrders() {
  const machines = visibleMachines();
  $("#workOrderGrid").innerHTML = machines.length
    ? machines.map(renderMachineCard).join("")
    : `<article class="empty-card"><strong>沒有符合條件的機台</strong><span>請調整課別或狀態篩選。</span></article>`;
}

function ensureHmcDashboardEntry() {
  const entry = $("#dashboardView [data-hmc-report-entry]");
  if (entry) entry.remove();
}

function renderMachineCard(machine) {
  const order = machine.order;
  const status = statusMeta[machine.status] || statusMeta.idle;
  const due = order ? dueInfo(order) : { label: machine.status === "maintenance" ? "維修中" : "空閒", date: "-", diffDays: 999 };
  const percent = order ? pct(order) : 0;
  const profile = order ? getProgramProfile(order) : null;
  const delta = profile ? cycleDelta(profile) : null;
  const dailyQty = profile ? dailyPureCapacity(profile) : null;
  const detailAttr = order ? `data-detail="${escapeHtml(order.id)}"` : "";
  const isHmc = isHmcMachine(machine);
  const hmcUrl = isHmc ? hmcReportRouteUrl(machine) : "";
  const canReport = isReportableMachineName(machine.name) && (!order || isOrderReportable(order));
  const reportAttr = order && canReport ? `data-report="${escapeHtml(order.id)}"` : "";
  const reportUrl = canReport ? machineReportUrl(machine) : "";
  const qrReportUrl = reportUrl ? publicReportUrlOnLocalhost(reportUrl) : "";
  const reportLinkText = isHmc
    ? `${machine.code || machine.name} · 多盤多工件每日盤點`
    : order
    ? `${machine.code || machine.name} · 已帶 ${order.id} 報工連結`
    : `${machine.code || machine.name} · ${qrReportUrl}`;
  const detailUrl = order ? workOrderDetailUrl(order.id) : "";
  const qrUrl = qrReportUrl ? qrCodeUrl(qrReportUrl) : "";

  return `
    <article class="machine-tile-card ${status.className}" ${detailAttr}>
      <header class="machine-tile-header">
        <div>
          <div class="machine-title-line">
            <span class="machine-symbol" aria-hidden="true"></span>
            <h2>${escapeHtml(machine.name)}</h2>
          </div>
          <span class="machine-type-pill">${escapeHtml(machineTypeLabel(machine.type))}</span>
        </div>
        <div class="machine-header-actions">
          <span class="status-pill">${escapeHtml(status.label)}</span>
          ${order ? `<a class="machine-open-link" data-no-detail href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener">完整單</a>` : ""}
        </div>
      </header>

      ${canReport ? `
        <a class="machine-qr-card" data-no-detail href="${escapeHtml(qrReportUrl)}" target="_blank" rel="noopener" aria-label="${escapeHtml(machine.name)} 掃碼現場回報">
          <img src="${escapeHtml(qrUrl)}" alt="${escapeHtml(machine.name)} 現場回報 QR Code">
          <span>
            <strong>${isHmc ? "多盤多工件每日盤點" : "掃碼報工"}</strong>
            <small>${escapeHtml(reportLinkText)}</small>
          </span>
        </a>
      ` : `
        <div class="machine-qr-card machine-qr-card-disabled" aria-label="未排機不產生 QR">
          <span class="qr-placeholder">--</span>
          <span>
            <strong>未排機</strong>
            <small>請先指派實際機台，指派後才會產生報工 QR</small>
          </span>
        </div>
      `}

      <div class="machine-job-strip">
        <span>目前工單</span>
        ${order ? `
          <strong class="job-order-highlight">${escapeHtml(order.id)} · ${escapeHtml(order.part)}</strong>
          <small class="job-order-subline">${escapeHtml(order.customer)} · ${escapeHtml(order.process)}</small>
        ` : `
          <strong>${escapeHtml(machine.note || "無工單指派中")}</strong>
          <small>${machine.status === "idle" ? "可安排新工單" : "請確認機台狀態"}</small>
        `}
      </div>

      ${order ? `
        <div class="program-strip">
          <span>CNC 程式</span>
          <strong>${escapeHtml(profile.programName)}</strong>
          <small>
            ${escapeHtml(profile.programVersion)}
            ${profile.previousVersion && profile.previousVersion !== profile.programVersion ? ` · 較 ${escapeHtml(profile.previousVersion)} 有差異` : " · 與上版相同"}
          </small>
        </div>
      ` : ""}

      <div class="machine-metrics">
        <div>
          <span>完成進度</span>
          <strong>${order ? `${order.done}/${order.total}` : "-"}</strong>
          <small>${order ? `${percent}%` : "未派工"}</small>
        </div>
        <div>
          <span>交期</span>
          <strong>${escapeHtml(due.label)}</strong>
          <small>${escapeHtml(due.date)}</small>
        </div>
      </div>

      ${order ? `
        <div class="cycle-mini-grid">
          <div>
            <span>純加工</span>
            <strong>${escapeHtml(formatSeconds(profile.pureCycleSec))}</strong>
          </div>
          <div>
            <span>基準差異</span>
            <strong class="${delta !== null && delta > 8 ? "cycle-warn" : ""}">${delta === null ? "-" : `${delta > 0 ? "+" : ""}${delta}%`}</strong>
          </div>
          <div>
            <span>每日估算</span>
            <strong>${dailyQty ? `${dailyQty} 件` : "-"}</strong>
          </div>
        </div>
      ` : ""}

      ${order ? `
        <div class="progress-track" aria-label="完成進度 ${percent}%">
          <div class="progress-fill" style="width:${percent}%"></div>
        </div>
      ` : ""}

      <section class="machine-advice">
        <div class="advice-title"><span></span>AI 建議</div>
        <p>${escapeHtml(order ? riskSuggestion(order) : machine.status === "idle" ? "目前空閒，可優先安排小批量急件或等待插單。" : "建議確認維修或暫停原因，避免排程仍把此機台視為可用。")}</p>
      </section>

      <footer class="machine-tile-footer">
        <span>${escapeHtml(order?.lastReport || machine.note || "尚未回報")}</span>
        <div class="machine-tile-actions">
          ${order ? `<button class="machine-detail-button" type="button" data-detail="${escapeHtml(order.id)}">明細</button>` : ""}
          ${isHmc
            ? `<a class="machine-hmc-report-link" data-no-detail href="${escapeHtml(hmcUrl)}">多盤多工件每日盤點</a>`
            : `<button type="button" ${order && canReport ? 'class="machine-report-button"' : ""} ${reportAttr} ${canReport ? "" : "disabled"}>${order ? (canReport ? "回報" : "待指派") : "指派"}</button>`}
        </div>
      </footer>
    </article>
  `;
}

function alertOrders() {
  return state.workOrders
    .filter((order) => {
      const categories = alertCategories(order);
      if (activeAlertFilter === "全部") return categories.size > 0 && deriveOrderStatus(order) !== "normal";
      return categories.has(activeAlertFilter);
    })
    .sort((a, b) => {
      const rank = { overdue: 0, abnormal: 1, aiRisk: 2, inspection: 3, stale: 4, running: 5, normal: 6 };
      return (rank[primaryAlertStatus(a)] ?? 9) - (rank[primaryAlertStatus(b)] ?? 9);
    });
}

function renderAlerts() {
  const counts = Object.fromEntries(alertFilters.map((filter) => [filter, 0]));
  state.workOrders.forEach((order) => {
    const categories = alertCategories(order);
    if (categories.size > 0 && deriveOrderStatus(order) !== "normal") counts["全部"] += 1;
    categories.forEach((category) => {
      if (category in counts) counts[category] += 1;
    });
  });

  $("#alertChips").innerHTML = alertFilters.map((filter) => `
    <button class="filter-chip alert-chip ${activeAlertFilter === filter ? "active" : ""}" data-alert-filter="${escapeHtml(filter)}" type="button">
      ${escapeHtml(filter)} <span>${counts[filter] || 0}</span>
    </button>
  `).join("");

  const alerts = alertOrders();
  $("#alertList").innerHTML = alerts.length
    ? alerts.map(renderAlertCard).join("")
    : `<article class="empty-card"><strong>目前沒有待處理警報</strong><span>所有工單都在可控範圍內。</span></article>`;
}

function renderAlertCard(order) {
  const status = statusMeta[primaryAlertStatus(order)] || statusMeta.normal;
  const due = dueInfo(order);
  const percent = pct(order);
  const categories = Array.from(alertCategories(order));

  return `
    <article class="alert-card ${status.className}">
      <header class="alert-card-header">
        <div class="alert-title-group">
          <span class="status-pill">${escapeHtml(status.label)}</span>
          <code>${escapeHtml(order.id)}</code>
          <strong>${escapeHtml(order.part)}</strong>
          <span>${escapeHtml(order.customer)}</span>
          ${order.priority === "urgent" ? '<b class="urgent-mark">急</b>' : ""}
        </div>
        <div class="alert-score">
          <span>交期</span>
          <strong>${escapeHtml(due.label)}</strong>
          <small>${escapeHtml(due.date)}</small>
        </div>
      </header>

      <div class="alert-meta-grid">
        <div>
          <span>剩餘製程</span>
          <strong>${escapeHtml(remainingProcesses(order))}</strong>
        </div>
        <div>
          <span>最近回報</span>
          <strong>${escapeHtml(order.lastReport)} · ${order.done}/${order.total}</strong>
        </div>
        <div>
          <span>風險原因</span>
          <strong>${escapeHtml(alertReason(order))}</strong>
        </div>
        <div>
          <span>分類</span>
          <strong>${escapeHtml(categories.join(" / "))}</strong>
        </div>
      </div>

      <div class="alert-progress">
        <div class="progress-track" aria-label="完成進度 ${percent}%">
          <div class="progress-fill" style="width:${percent}%"></div>
        </div>
        <span>${percent}%</span>
      </div>

      <section class="alert-ai-box">
        <strong>AI 建議：</strong>${escapeHtml(riskSuggestion(order))}
      </section>

      <div class="alert-actions">
        ${alertActions(order).map((action) => `
          <button type="button" data-alert-action="${escapeHtml(action)}" data-alert-order="${escapeHtml(order.id)}">${escapeHtml(action)}</button>
        `).join("")}
        <button type="button" data-detail="${escapeHtml(order.id)}">查看明細</button>
      </div>
    </article>
  `;
}

function inspectionItems() {
  const mapped = state.workOrders
    .filter((order) => alertCategories(order).has("待品檢") || order.done >= order.total)
    .map((order) => ({
      id: order.id,
      part: order.part,
      drawing: order.drawing,
      customer: order.customer,
      quantity: order.total,
      dueDate: order.dueDate,
      priority: priorityLabel(order.priority),
      status: alertCategories(order).has("今日到期") ? "今日交期" : alertCategories(order).has("待品檢") ? "卡關" : "待檢",
      wait: alertCategories(order).has("待品檢") ? "16h" : "2h",
      real: true,
    }));

  const demos = [
    { id: "WO-20260429-019", part: "滾珠螺桿支座", drawing: "BS-MNT-447", customer: "永承精密", quantity: 25, dueDate: new Date().toISOString().slice(0, 10), priority: "最高", status: "今日交期", wait: "急" },
    { id: "WO-20260427-009", part: "法蘭盤", drawing: "FL-DSK-201", customer: "三達精密", quantity: 30, dueDate: "2026-05-03", priority: "中", status: "已", wait: "2h" },
    { id: "WO-20260428-013", part: "軸承擋圈", drawing: "BR-RING-088", customer: "大同重工", quantity: 120, dueDate: "2026-05-05", priority: "中", status: "已", wait: "1h" },
  ];

  const existingIds = new Set(mapped.map((item) => item.id));
  return [...mapped, ...demos.filter((item) => !existingIds.has(item.id))].slice(0, 4);
}

function renderInspectionQueue() {
  const items = inspectionItems();
  $("#inspectionQueue").innerHTML = items.map((item) => {
    const due = dueInfo({ dueDate: item.dueDate });
    const isUrgent = item.status === "今日交期" || due.diffDays <= 0;
    const riskClass = isUrgent ? "risk-red" : item.status === "卡關" ? "risk-amber" : "risk-gray";
    return `
      <article class="inspection-card ${riskClass}">
        <header>
          <code>${escapeHtml(item.id)}</code>
          <span class="status-pill">${escapeHtml(item.status)} ${escapeHtml(item.wait)}</span>
        </header>
        <h3>${escapeHtml(item.part)}</h3>
        <p>${escapeHtml(item.drawing)} · ${escapeHtml(item.customer)}</p>
        <div class="inspection-info">
          <div><span>數量</span><strong>${Number(item.quantity || 0)}</strong></div>
          <div><span>交期</span><strong>${escapeHtml(due.label)}</strong></div>
          <div><span>優先</span><strong>${escapeHtml(item.priority)}</strong></div>
        </div>
        <div class="inspection-actions">
          <button type="button" data-alert-action="開始品檢" ${item.real ? `data-alert-order="${escapeHtml(item.id)}"` : ""}>開始品檢</button>
          <button type="button" data-alert-action="品檢通過" ${item.real ? `data-alert-order="${escapeHtml(item.id)}"` : ""}>通過</button>
          <button type="button" data-alert-action="品檢異常" ${item.real ? `data-alert-order="${escapeHtml(item.id)}"` : ""}>異常</button>
        </div>
      </article>
    `;
  }).join("");
}

function notificationItems() {
  const riskyOrders = state.workOrders.filter((order) => alertCategories(order).size > 0);
  const items = riskyOrders.map((order) => {
    const status = primaryAlertStatus(order);
    const meta = statusMeta[status] || statusMeta.normal;
    return {
      id: order.id,
      status,
      title: meta.label,
      time: order.lastReport || "剛剛",
      body: status === "stale"
        ? `${order.machine || order.id} 尚未更新回報，目前進度不明。`
        : `${order.id} ${order.part} ${alertReason(order)}。${riskSuggestion(order)}`,
      actions: alertActions(order).slice(0, 3),
    };
  });

  items.push({
    id: "WO-20260427-009",
    status: "normal",
    title: "已處理",
    time: "昨日",
    body: "WO-20260427-009 法蘭盤已通過品檢並出貨。",
    actions: [],
  });

  return items.slice(0, 5);
}

function renderNotificationCenter() {
  const items = notificationItems();
  const unresolvedCount = items.filter((item) => item.status !== "normal").length;
  $("#notificationCount").textContent = unresolvedCount;
  $("#notificationCenter").innerHTML = items.map((item) => {
    const status = statusMeta[item.status] || statusMeta.normal;
    return `
      <article class="notification-row ${status.className}">
        <span class="notification-dot"></span>
        <div class="notification-icon">${item.status === "aiRisk" ? "AI" : item.status === "normal" ? "✓" : "!"}</div>
        <div>
          <div class="notification-head">
            <strong>${escapeHtml(item.title)}</strong>
            <time>${escapeHtml(item.time)}</time>
          </div>
          <p>${escapeHtml(item.body)}</p>
          ${item.actions.length ? `
            <div class="notification-actions">
              ${item.actions.map((action) => `<button type="button" data-alert-action="${escapeHtml(action)}" data-alert-order="${escapeHtml(item.id)}">${escapeHtml(action)}</button>`).join("")}
            </div>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function renderHistory() {
  const orders = state.workOrders.slice(0, 6);
  const abnormalOrders = state.workOrders.filter((order) => alertCategories(order).has("異常") || alertCategories(order).has("已延誤"));
  const reportOrders = state.workOrders.filter((order) => order.done > 0).slice(0, 5);
  const programOrders = state.workOrders
    .filter((order) => getProgramProfile(order).programName !== "待上傳")
    .slice(0, 5);

  $("#historyContent").innerHTML = `
    <section class="history-panel">
      <div class="panel-title">
        <h2>工單歷程</h2>
        <span>${orders.length} 筆</span>
      </div>
      ${orders.map((order) => {
        const status = statusMeta[deriveOrderStatus(order)] || statusMeta.normal;
        return `
          <button class="history-row ${status.className}" type="button" data-detail="${escapeHtml(order.id)}">
            <span class="timeline-dot"></span>
            <div>
              <strong>${escapeHtml(order.id)} · ${escapeHtml(order.part)}</strong>
              <small>${escapeHtml(order.customer)} · ${escapeHtml(order.process)} · ${escapeHtml(status.label)}</small>
            </div>
            <time>${escapeHtml(order.dueDate || "-")}</time>
          </button>
        `;
      }).join("")}
    </section>

    <section class="history-panel">
      <div class="panel-title">
        <h2>報工紀錄</h2>
        <span>${reportOrders.length} 筆</span>
      </div>
      ${reportOrders.map((order) => `
        <button class="history-row risk-blue" type="button" data-detail="${escapeHtml(order.id)}">
          <span class="timeline-dot"></span>
          <div>
            <strong>${escapeHtml(order.machine || "未排機")} 回報 ${order.done}/${order.total}</strong>
            <small>${escapeHtml(order.id)} · ${escapeHtml(order.lastReport)}</small>
          </div>
          <time>${pct(order)}%</time>
        </button>
      `).join("")}
    </section>

    <section class="history-panel">
      <div class="panel-title">
        <h2>異常紀錄</h2>
        <span>${abnormalOrders.length} 筆</span>
      </div>
      ${abnormalOrders.length ? abnormalOrders.map((order) => `
        <button class="history-row risk-red" type="button" data-detail="${escapeHtml(order.id)}">
          <span class="timeline-dot"></span>
          <div>
            <strong>${escapeHtml(alertReason(order))}</strong>
            <small>${escapeHtml(order.id)} · ${escapeHtml(order.part)}</small>
          </div>
          <time>${escapeHtml(order.lastReport)}</time>
        </button>
      `).join("") : '<p class="empty-note">目前沒有異常紀錄。</p>'}
    </section>

    <section class="history-panel">
      <div class="panel-title">
        <h2>程式與加工履歷</h2>
        <span>${programOrders.length} 筆</span>
      </div>
      ${programOrders.map((order) => {
        const profile = getProgramProfile(order);
        const delta = cycleDelta(profile);
        return `
          <button class="history-row ${delta !== null && delta > 8 ? "risk-amber" : "risk-blue"}" type="button" data-detail="${escapeHtml(order.id)}">
            <span class="timeline-dot"></span>
            <div>
              <strong>${escapeHtml(order.drawing)} · ${escapeHtml(profile.programName)}</strong>
              <small>做過 ${Number(profile.historyRuns || 0)} 次 · 純加工 ${escapeHtml(formatSeconds(profile.pureCycleSec))} · ${delta === null ? "無基準" : `較基準 ${delta > 0 ? "+" : ""}${delta}%`}</small>
            </div>
            <time>${escapeHtml(profile.lastRunDate || "-")}</time>
          </button>
        `;
      }).join("")}
    </section>
  `;
}

function renderReports() {
  const total = state.workOrders.length || 1;
  const overdue = state.workOrders.filter((order) => alertCategories(order).has("已延誤")).length;
  const abnormal = state.workOrders.filter((order) => alertCategories(order).has("異常")).length;
  const completedQty = state.workOrders.reduce((sum, order) => sum + Number(order.done || 0), 0);
  const totalQty = state.workOrders.reduce((sum, order) => sum + Number(order.total || 0), 0) || 1;
  const loadPercent = Math.round((state.machines.filter((machine) => machine.order).length / Math.max(1, state.machines.length)) * 100);
  const onTimeRate = Math.max(0, Math.round(((total - overdue) / total) * 100));
  const defectRate = Math.round(((abnormal + state.workOrders.filter((order) => order.risk).length) / Math.max(1, totalQty)) * 1000) / 10;
  const programOrders = state.workOrders.filter((order) => getProgramProfile(order).programName !== "待上傳");
  const deltas = programOrders.map((order) => cycleDelta(getProgramProfile(order))).filter((value) => value !== null);
  const avgDelta = deltas.length ? Math.round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length) : 0;
  const historyRuns = programOrders.reduce((sum, order) => sum + Number(getProgramProfile(order).historyRuns || 0), 0);

  const reportCards = [
    { title: "準交率", value: `${onTimeRate}%`, meta: `已延誤 ${overdue} 張`, status: onTimeRate >= 90 ? "risk-green" : "risk-amber" },
    { title: "延誤統計", value: overdue, meta: "需主管追蹤", status: overdue ? "risk-red" : "risk-green" },
    { title: "機台負載", value: `${loadPercent}%`, meta: `${state.machines.filter((machine) => machine.order).length}/${state.machines.length} 台有工單`, status: "risk-blue" },
    { title: "不良統計", value: `${defectRate}%`, meta: "以異常與風險估算", status: abnormal ? "risk-amber" : "risk-green" },
    { title: "加工時間偏差", value: `${avgDelta > 0 ? "+" : ""}${avgDelta}%`, meta: "與標準純加工時間比", status: avgDelta > 8 ? "risk-amber" : "risk-green" },
    { title: "歷史加工次數", value: historyRuns, meta: `${programOrders.length} 個工件已有程式履歷`, status: "risk-purple" },
  ];

  $("#reportsContent").innerHTML = `
    <div class="report-card-grid">
      ${reportCards.map((card) => `
        <article class="report-card ${card.status}">
          <span>${escapeHtml(card.title)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          <small>${escapeHtml(card.meta)}</small>
        </article>
      `).join("")}
    </div>

    <section class="report-panel">
      <div class="panel-title">
        <h2>機台負載</h2>
        <span>依目前工單</span>
      </div>
      <div class="load-list">
        ${state.machines.map((machine) => {
          const value = machine.order ? Math.max(12, pct(machine.order)) : 0;
          return `
            <div class="load-row">
              <span>${escapeHtml(machine.name)}</span>
              <div class="load-track"><i style="width:${value}%"></i></div>
              <strong>${machine.order ? `${value}%` : "空閒"}</strong>
            </div>
          `;
        }).join("")}
      </div>
    </section>

    <section class="report-panel">
      <div class="panel-title">
        <h2>今日摘要</h2>
        <span>${completedQty}/${totalQty} 件</span>
      </div>
      <p class="report-copy">今天最需要注意的是已延誤、可能延誤與待品檢卡關。報表先做輕量統計，後續可接正式 MES 工時、不良、出貨資料。</p>
    </section>

    <section class="report-panel">
      <div class="panel-title">
        <h2>加工時間履歷</h2>
        <span>不含上下料</span>
      </div>
      <div class="program-history-table">
        ${programOrders.map((order) => {
          const profile = getProgramProfile(order);
          const delta = cycleDelta(profile);
          return `
            <button type="button" data-detail="${escapeHtml(order.id)}">
              <span>${escapeHtml(order.drawing)}</span>
              <strong>${escapeHtml(formatSeconds(profile.pureCycleSec))}</strong>
              <small>${delta === null ? "無基準" : `${delta > 0 ? "+" : ""}${delta}%`} · ${profile.historyRuns} 次</small>
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

// 平台管理 (AM4): rendered ONLY in strict mode for a live super-admin
// session — every other session (incl. dev-nologin demo) sees a
// byte-identical 管理 tab. The Edge Functions stay authoritative.
function renderPlatformAdminSection() {
  if (!machtileStrictMode() || !machtileSessionActive() || machtileAuthState.platformRole !== "super_admin") {
    return "";
  }
  return `
    <section class="admin-section">
      <div class="panel-title">
        <div>
          <h2>平台管理</h2>
        </div>
        <span>租戶、廠內管理者、平台管理員</span>
      </div>
      <div class="admin-action-grid admin-action-grid-compact" aria-label="平台管理">
        ${renderAdminActionCard("company", "平台管理", "建立租戶、管理各廠管理者與平台管理員", "purple", "platform")}
      </div>
    </section>
  `;
}

// 工單管理 (work-order upsert, 2026-07-11; locks X1=planner-or-above,
// X2=no format enforcement, X3=full-field update): rendered ONLY in strict
// mode for planner/manager/admin — dev-nologin demo keeps a byte-identical
// 管理 tab. The RPC re-checks the role server-side.
function machtileCanManageWorkOrders() {
  return machtileStrictMode() && machtileSessionActive()
    && ["admin", "manager", "planner"].includes(machtileAuthState.role);
}

function renderWorkOrderAdminSection() {
  if (!machtileCanManageWorkOrders()) return "";
  return `
    <section class="admin-section">
      <div class="panel-title">
        <div>
          <h2>工單管理</h2>
        </div>
        <span>建單、指派機台（同單號重送＝更新/改派）</span>
      </div>
      <div class="admin-action-grid admin-action-grid-compact" aria-label="工單管理">
        ${renderAdminActionCard("list", "工單管理（建單／指派）", "輸入 ERP/MES 派工單號，指派後機台即可報工；班前清單可直接挑選", "blue", "workOrders")}
      </div>
    </section>
  `;
}

function renderWorkOrderModule() {
  if (!machtileCanManageWorkOrders()) {
    return `<p class="admin-module-note">此功能需要排程以上權限的正式環境帳號。</p>`;
  }
  return `
    <form id="machtileWoForm" class="admin-module-form">
      <label class="admin-field"><span>派工單號 *（請照抄 ERP/MES 派工單號）</span>
        <input id="machtileWoNo" type="text" required placeholder="例：XX01202607100012"></label>
      <label class="admin-field"><span>品號</span>
        <input id="machtileWoPartNo" type="text" placeholder="例：DSHG-04-01"></label>
      <label class="admin-field"><span>品名 *</span>
        <input id="machtileWoPartName" type="text" required></label>
      <label class="admin-field"><span>數量 *</span>
        <input id="machtileWoQty" type="number" min="1" required></label>
      <label class="admin-field"><span>交期 *</span>
        <input id="machtileWoDue" type="date" required></label>
      <label class="admin-field"><span>指派機台</span>
        <select id="machtileWoMachine"><option value="">暫不指派</option></select></label>
      <label class="admin-field"><span>製程名稱</span>
        <input id="machtileWoProcess" type="text" placeholder="CNC 加工"></label>
      <button class="admin-save-button" type="submit">建立／更新工單</button>
      <p class="admin-module-note">同單號再次送出＝更新內容或改派機台；選「暫不指派」＝取消指派。</p>
    </form>
    <div id="machtileWoList"><p class="admin-module-note">載入工單中…</p></div>
  `;
}

let machtileWoMachinesCache = null;

async function machtileWoMachines() {
  if (machtileWoMachinesCache) return machtileWoMachinesCache;
  try {
    machtileWoMachinesCache = await supabaseFetch("machines?select=id,machine_code&order=machine_code");
  } catch (error) {
    console.warn("machines lookup failed", error);
    machtileWoMachinesCache = [];
  }
  return machtileWoMachinesCache;
}

async function machtileRefreshWorkOrderList() {
  const holder = document.getElementById("machtileWoList");
  if (!holder) return;
  try {
    const [orders, machines] = await Promise.all([
      supabaseFetch("work_orders?select=work_order_no,part_no,part_name,quantity,due_date,work_order_processes(machine_id)&order=created_at.desc&limit=10"),
      machtileWoMachines(),
    ]);
    const codeById = new Map(machines.map((m) => [m.id, m.machine_code]));
    const rows = (orders || []).map((o) => {
      const machineId = o.work_order_processes?.[0]?.machine_id;
      const machine = machineId ? (codeById.get(machineId) || "?") : "未指派";
      return `<tr><td>${escapeHtml(o.work_order_no)}</td><td>${escapeHtml(o.part_no || "-")}</td><td>${escapeHtml(String(o.quantity))}</td><td>${escapeHtml(o.due_date || "-")}</td><td>${escapeHtml(machine)}</td></tr>`;
    }).join("");
    holder.innerHTML = `
      <table class="admin-module-table" style="width:100%;font-size:13px;border-collapse:collapse;">
        <thead><tr><th style="text-align:left;">單號</th><th style="text-align:left;">品號</th><th style="text-align:left;">數量</th><th style="text-align:left;">交期</th><th style="text-align:left;">機台</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5">尚無工單</td></tr>`}</tbody>
      </table>`;
  } catch (error) {
    holder.innerHTML = `<p class="admin-module-note">工單清單載入失敗：${escapeHtml(error.message || "")}</p>`;
  }
}

function machtileWoErrorText(error) {
  const msg = String(error?.message || error || "");
  if (msg.includes("FORBIDDEN")) return "此帳號沒有建單權限（需排程以上）。";
  if (msg.includes("machine_code not found")) return "找不到這台機台，請重新選擇。";
  if (msg.includes("quantity must be")) return "數量必須大於 0。";
  return msg;
}

async function machtileInitWorkOrderModule() {
  const form = document.getElementById("machtileWoForm");
  if (!form) return;
  const machines = await machtileWoMachines();
  const select = document.getElementById("machtileWoMachine");
  if (select) {
    select.innerHTML = `<option value="">暫不指派</option>` +
      machines.map((m) => `<option value="${escapeHtml(m.machine_code)}">${escapeHtml(m.machine_code)}</option>`).join("");
  }
  machtileRefreshWorkOrderList();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const payload = {
        work_order_no: document.getElementById("machtileWoNo").value.trim(),
        part_no: document.getElementById("machtileWoPartNo").value.trim(),
        part_name: document.getElementById("machtileWoPartName").value.trim(),
        quantity: Number(document.getElementById("machtileWoQty").value),
        due_date: document.getElementById("machtileWoDue").value,
        machine_code: document.getElementById("machtileWoMachine").value || null,
        process_name: document.getElementById("machtileWoProcess").value.trim() || null,
      };
      const result = await supabaseFetch("rpc/work_order_upsert", {
        method: "POST",
        body: JSON.stringify({ p_payload: payload }),
      });
      const machineText = result?.machine_code ? `，指派 ${result.machine_code}` : "（未指派）";
      showToast(`${result?.action === "created" ? "已建立" : "已更新"}工單 ${payload.work_order_no}${machineText}`);
      machtileRefreshWorkOrderList();
      // card wall picks up the new/assigned order on next data load
      loadFromSupabase().then(renderAll).catch(() => {});
    } catch (error) {
      showToast(`工單儲存失敗：${machtileWoErrorText(error)}`);
    } finally {
      button.disabled = false;
    }
  });
}

function renderSettings() {
  const managedMachines = managedMachineList();
  $("#settingsContent").innerHTML = `
    ${renderWorkOrderAdminSection()}
    ${renderPlatformAdminSection()}
    <section class="admin-section">
      <div class="panel-title">
        <div>
          <h2>主檔與規則設定</h2>
        </div>
        <span>機台、帳號、製程、報工、警報</span>
      </div>
      <div class="admin-action-grid" aria-label="主檔與規則設定">
        ${renderAdminActionCard("add", `新增機台 (${managedMachines.length} / 50)`, "新增 CNC、車銑複合、五軸或外包站點", "blue", "add")}
        ${renderAdminActionCard("list", "機台列表管理", "批次編輯課別、狀態與 QR Code", "blue", "list")}
        ${renderAdminActionCard("alarm", "警報參數設定", "交期、未回報、異常與待品檢規則", "blue", "alarm")}
        ${renderAdminActionCard("users", "員工帳號管理", "主管、排程、師傅、品檢角色權限", "green", "users")}
        ${renderAdminActionCard("invite", "生成邀請碼", "快速邀請現場人員加入工廠", "green", "invite")}
        ${renderAdminActionCard("vendor", "供應商授權管理", "外包商、客戶或油商的有限權限", "green", "vendor")}
        ${renderAdminActionCard("company", "公司資料", "公司、廠區、班別與部署模式", "amber", "company")}
        ${renderAdminActionCard("template", "製程模板管理", "鋸料、車削、銑削、去毛邊、品檢、包裝", "amber", "template")}
        ${renderAdminActionCard("reportRule", "報工規則管理", "每日回報次數、未回報提醒、補登限制", "amber", "reportRule")}
        ${renderAdminActionCard("program", "CNC 程式管理", "上傳程式、版本 hash、差異比對與附件", "purple", "program")}
        ${renderAdminActionCard("time", "加工時間管理", "純加工時間、上下料時間、歷史平均、日產能", "purple", "time")}
      </div>
    </section>

    <section class="admin-section">
      <div class="panel-title">
        <div>
          <h2>同步設定</h2>
        </div>
        <span>通知、串接、部署、資料匯出</span>
      </div>
      <div class="admin-action-grid admin-action-grid-compact" aria-label="同步設定">
        ${renderAdminActionCard("notify", "通知規則管理", "LINE、Email、Web Push 與警報對象", "blue", "notify")}
        ${renderAdminActionCard("integration", "串接設定", "SoftNet MES、I-Reporter、Supabase、地端部署", "blue", "integration")}
        ${renderAdminActionCard("export", "資料匯出", "機台、工單、報工、警報、程式履歷、操作紀錄", "purple", "export")}
      </div>
    </section>

    <section class="admin-export-panel">
      <div class="admin-export-icon">${adminIcon("export")}</div>
      <div>
        <h2>資料匯出</h2>
        <p>下載您公司的所有資料（CSV 格式 ZIP 壓縮）</p>
        <p>包含：機台、工單、報工紀錄、警報、異常、CNC 程式履歷、AI 對話、操作紀錄</p>
      </div>
      <button type="button" data-admin-module="export">匯出全部資料</button>
      <small>依據個人資料保護法，您可隨時下載您公司在本系統中的所有資料。</small>
    </section>

    <section class="machine-quick-edit-section">
      <div class="panel-title">
        <div>
          <p class="eyebrow">Machine Quick Edit</p>
          <h2>機台快速編輯</h2>
        </div>
        <span>${managedMachines.length} 台機台</span>
      </div>
      <div class="machine-edit-grid">
        ${managedMachines.map(renderMachineEditCard).join("")}
      </div>
    </section>
  `;
}

function renderAdminActionCard(icon, title, body, color, moduleKey) {
  return `
    <button class="admin-action-card admin-${escapeHtml(color)}" type="button" data-admin-module="${escapeHtml(moduleKey)}">
      <span class="admin-action-icon">${adminIcon(icon)}</span>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(body)}</small>
    </button>
  `;
}

function adminModuleMeta(moduleKey) {
  const modules = {
    add: ["Machine Create", "新增機台"],
    list: ["Machine List", "機台列表管理"],
    alarm: ["Alarm Rules", "警報參數設定"],
    users: ["User Accounts", "員工帳號管理"],
    platform: ["Platform Admin", "平台管理"],
    workOrders: ["Work Orders", "工單管理"],
    invite: ["Invite Codes", "生成邀請碼"],
    vendor: ["Partner Access", "供應商授權管理"],
    company: ["Company Profile", "公司資料"],
    template: ["Process Templates", "製程模板管理"],
    reportRule: ["Report Rules", "報工規則管理"],
    program: ["CNC Programs", "CNC 程式管理"],
    time: ["Machining Time", "加工時間管理"],
    notify: ["Notification Rules", "通知規則管理"],
    integration: ["Integrations", "串接設定"],
    export: ["Data Export", "資料匯出"],
  };
  const [eyebrow, title] = modules[moduleKey] || ["Management", "管理功能"];
  return { eyebrow, title };
}

function adminField(label, value = "", type = "text") {
  return `
    <label class="admin-field">
      <span>${escapeHtml(label)}</span>
      <input type="${escapeHtml(type)}" value="${escapeHtml(value)}">
    </label>
  `;
}

function adminSelect(label, values, selected) {
  return `
    <label class="admin-field">
      <span>${escapeHtml(label)}</span>
      <select>
        ${values.map((value) => `<option ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
      </select>
    </label>
  `;
}

function adminSaveButton(label = "儲存草稿") {
  return `<button class="admin-save-button" type="button" data-admin-save="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
}

function renderAdminModuleContent(moduleKey) {
  switch (moduleKey) {
    case "add":
      return renderAddMachineModule();
    case "list":
      return renderMachineListModule();
    case "alarm":
      return renderAlarmRulesModule();
    case "users":
      return renderUsersModule();
    case "workOrders":
      return renderWorkOrderModule();
    case "platform":
      return renderPlatformModule();
    case "invite":
      return renderInviteModule();
    case "vendor":
      return renderVendorModule();
    case "company":
      return renderCompanyModule();
    case "template":
      return renderTemplateModule();
    case "reportRule":
      return renderReportRulesModule();
    case "program":
      return renderProgramModule();
    case "time":
      return renderTimeModule();
    case "notify":
      return renderNotifyModule();
    case "integration":
      return renderIntegrationModule();
    case "export":
      return renderExportModule();
    default:
      return '<p class="empty-note">這個管理功能尚未設定內容。</p>';
  }
}

function renderAddMachineModule() {
  return `
    <div class="admin-module-grid">
      <section class="admin-form-card">
        <h3>新增機台基本資料</h3>
        <div class="admin-form-grid">
          ${adminField("機台名稱", "CNC-09")}
          ${adminField("機台 ID", "M2025-009")}
          ${adminSelect("機型", ["車床", "銑床", "五軸", "車銑複合", "外包站"], "銑床")}
          ${adminSelect("部門", ["車床課", "銑床課", "其他"], "銑床課")}
          ${adminSelect("報工規則", ["每日 3 次回報", "開工完工回報", "品檢節點回報"], "每日 3 次回報")}
          ${adminSelect("狀態", ["空閒", "加工中", "暫停", "維修"], "空閒")}
        </div>
        ${adminSaveButton("建立機台草稿")}
      </section>
      <section class="admin-side-note">
        <strong>QR 原則</strong>
        <p>只有實際機台會產生 QR。未排機只代表工單尚未指派，不會建立報工入口。</p>
      </section>
    </div>
  `;
}

function renderMachineListModule() {
  const machines = managedMachineList();
  return `
    <section class="admin-table-card">
      <div class="admin-table-head">
        <strong>機台清單</strong>
        <span>${machines.length} / 50 台</span>
      </div>
      <div class="admin-data-table">
        ${machines.map((machine) => {
          const meta = machineAdminMeta(machine);
          const reportUrl = machineReportUrl(machine);
          return `
            <div class="admin-data-row">
              <strong>${escapeHtml(machine.name)}</strong>
              <span>${escapeHtml(meta.code)}</span>
              <span>${escapeHtml(meta.department)}</span>
              <span>${escapeHtml(machineTypeLabel(machine.type))}</span>
              <a data-no-detail href="${escapeHtml(reportUrl)}" target="_blank" rel="noopener">QR</a>
              <button type="button" data-machine-admin="${escapeHtml(machine.name)}">編輯</button>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderAlarmRulesModule() {
  const rules = [
    ["可能延誤提醒", "交期前 24 小時", "主管 / 生管", "LINE + Web"],
    ["已延誤提醒", "逾期立即", "主管 / 生管", "LINE + Web"],
    ["未回報提醒", "4 小時未回報", "主管 / 班長", "Web"],
    ["待品檢卡關", "16 小時未品檢", "主管 / 品檢", "LINE + Web"],
    ["加工時間增加", "純加工時間 +10%", "主管 / 生管", "Web"],
  ];
  return renderRuleTable("警報規則", rules, "儲存警報規則");
}

function renderReportRulesModule() {
  const rules = [
    ["首次開工", "工件總數、cycle time 必填", "程式選填、開工照片必填", "產生預估完工與中午目標"],
    ["今日開工", "當日第一筆", "機台已加工數量、相機照片與首件檢查必填", "建立當日加工基準"],
    ["中午報工", "中午休息前", "良品累計 / 不良數必填", "判斷是否加班或拆單"],
    ["下午 4:30 檢查", "固定提醒", "下午檢查表必填、不填數量", "主管下班前確認風險"],
    ["收工 / 完工", "17:00 或 20:30", "良品累計 / 不良數 / 完工照片必填", "結算當日進度"],
    ["異常回報", "事件式", "異常類型與照片必填", "異常備註與主管處理"],
  ];
  return renderRuleTable("報工規則", rules, "儲存報工規則");
}

function renderRuleTable(title, rows, buttonLabel) {
  return `
    <section class="admin-table-card">
      <div class="admin-table-head">
        <strong>${escapeHtml(title)}</strong>
        <span>可編輯規則</span>
      </div>
      <div class="admin-data-table admin-data-table-wide">
        ${rows.map((row) => `
          <div class="admin-data-row">
            ${row.map((cell) => `<span>${escapeHtml(cell)}</span>`).join("")}
            <button type="button" data-admin-save="編輯 ${escapeHtml(row[0])}">編輯</button>
          </div>
        `).join("")}
      </div>
      ${adminSaveButton(buttonLabel)}
    </section>
  `;
}

function renderUsersModule() {
  // Strict mode (production): real tenant account management backed by the
  // AM2 Edge Functions. Dev/Pages demo keeps the mock (AM1 lock: the
  // public no-login demo never gets account mutation surfaces).
  if (machtileStrictMode()) {
    setTimeout(amInitUsersModule, 0);
    return `<div data-am-users-root><p class="empty-note">載入員工帳號中…</p></div>`;
  }
  const users = [
    ["張家維", "manager", "主管", "全部"],
    ["陳師傅", "operator", "現場報工", "銑床課"],
    ["林師傅", "operator", "現場報工", "車床課"],
    ["品檢 A", "inspector", "品檢", "品檢區"],
  ];
  return renderSimpleAdminList("員工帳號", users, "新增員工");
}

// ---- Strict account management module (AM3; Edge Functions from AM2) ----

const amRoleLabels = {
  admin: "管理者",
  manager: "主管",
  planner: "排程",
  operator: "作業員",
  inspector: "品檢",
};

const amCreatableRoles = ["manager", "planner", "operator", "inspector"];

const amErrorMessages = {
  AUTH_REQUIRED: "請先登入正式環境帳號。",
  FORBIDDEN: "此帳號沒有執行這項操作的權限。",
  INVALID_PAYLOAD: "輸入內容不完整或格式錯誤（密碼至少 8 碼）。",
  ROLE_NOT_ALLOWED: "不能建立管理者帳號（管理者由平台管理）。",
  EMAIL_EXISTS: "這個 Email 已經有帳號了。",
  USER_NOT_FOUND: "找不到這個使用者。",
  SELF_TARGET: "不能對自己的帳號執行這項操作。",
  TENANT_EXISTS: "已經有同名的租戶了。",
  INTERNAL: "伺服器處理失敗，請稍後再試。",
};

const amUsersState = {
  status: "idle",
  users: [],
  message: "",
  messageKind: "",
  expandedResetId: "",
  expandedEditId: "",
  confirmStateId: "",
};

function amErrorText(code, fallback) {
  return amErrorMessages[code] || fallback || "操作失敗，請稍後再試。";
}

async function amCallFunction(fnName, payload) {
  const baseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${machtileSupabaseBearerToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (response.status === 401) machtileHandleUnauthorized();
  let body = {};
  try {
    body = await response.json();
  } catch (error) {
    body = {};
  }
  return { ok: response.ok && body.status === "ok", code: body.code || "", body };
}

async function amFetchUsers() {
  const rows = await supabaseFetch("app_users?select=id,name,account,role,is_active&order=created_at.asc");
  const users = Array.isArray(rows) ? rows : [];
  // Admins pinned to the top; everyone else keeps created_at order.
  return [...users.filter((user) => user.role === "admin"), ...users.filter((user) => user.role !== "admin")];
}

async function amInitUsersModule() {
  const root = document.querySelector("[data-am-users-root]");
  if (!root) return;
  if (machtileAuthState.role !== "admin") {
    root.innerHTML = `
      <section class="admin-side-note">
        <strong>需要管理者帳號</strong>
        <p>員工帳號管理只開放給廠內管理者（admin）。請改用管理者帳號登入。</p>
      </section>
    `;
    return;
  }
  amUsersState.status = "loading";
  try {
    amUsersState.users = await amFetchUsers();
    amUsersState.status = "ready";
  } catch (error) {
    amUsersState.status = "error";
    amUsersState.message = `載入員工清單失敗：${error.message}`;
    amUsersState.messageKind = "error";
  }
  amRenderUsersModule();
}

function amStatusLine() {
  if (!amUsersState.message) return "";
  const tone = amUsersState.messageKind === "error" ? "color:#b42318" : "color:#067647";
  return `<p class="empty-note" style="${tone}" data-am-status>${escapeHtml(amUsersState.message)}</p>`;
}

function amRenderUsersModule() {
  const root = document.querySelector("[data-am-users-root]");
  if (!root) return;
  const selfId = amSelfAppUserId();
  const rows = amUsersState.users.map((user) => {
    const isSelf = user.id === selfId;
    const isAdmin = user.role === "admin";
    const resetOpen = amUsersState.expandedResetId === user.id;
    const editOpen = amUsersState.expandedEditId === user.id;
    const confirmOpen = amUsersState.confirmStateId === user.id;
    const canReset = !isAdmin || isSelf;
    const canEdit = !isAdmin;
    const canToggle = !isAdmin && !isSelf;
    return `
      <div class="admin-data-row" data-am-row="${escapeHtml(user.id)}">
        <strong>${escapeHtml(user.name || "-")}</strong>
        <span>${escapeHtml(machtileAccountDisplay(user.account) || "-")}</span>
        <span>${escapeHtml(amRoleLabels[user.role] || user.role)}${isSelf ? "（自己）" : ""}</span>
        <span>${user.is_active ? "啟用中" : "已停用"}</span>
        <span>
          ${canEdit ? `<button type="button" data-am-edit-open="${escapeHtml(user.id)}">${editOpen ? "收合" : "編輯"}</button>` : ""}
          ${canReset ? `<button type="button" data-am-reset-open="${escapeHtml(user.id)}">${resetOpen ? "收合" : "重設密碼"}</button>` : ""}
          ${canToggle ? `<button type="button" data-am-toggle="${escapeHtml(user.id)}" data-am-next="${user.is_active ? "false" : "true"}">${confirmOpen ? (user.is_active ? "確認停用？" : "確認啟用？") : (user.is_active ? "停用" : "啟用")}</button>` : ""}
          ${isAdmin && !isSelf ? `<span class="empty-note">平台管理</span>` : ""}
        </span>
      </div>
      ${editOpen ? `
        <div class="admin-data-row" data-am-edit-row="${escapeHtml(user.id)}">
          <label class="admin-field">
            <span>姓名</span>
            <input type="text" value="${escapeHtml(user.name || "")}" data-am-edit-name="${escapeHtml(user.id)}">
          </label>
          <label class="admin-field" style="grid-column: 2 / -2;">
            <span>登入帳號（工號或 Email）</span>
            <input type="text" value="${escapeHtml(machtileAccountDisplay(user.account))}" data-am-edit-email="${escapeHtml(user.id)}">
          </label>
          <button type="button" data-am-edit-confirm="${escapeHtml(user.id)}">確認修改</button>
        </div>
      ` : ""}
      ${resetOpen ? `
        <div class="admin-data-row" data-am-reset-row="${escapeHtml(user.id)}">
          <label class="admin-field" style="grid-column: 1 / -2;">
            <span>新密碼（至少 8 碼）</span>
            ${machtilePasswordField(`<input type="password" autocomplete="new-password" data-am-reset-input="${escapeHtml(user.id)}">`)}
          </label>
          <button type="button" data-am-reset-confirm="${escapeHtml(user.id)}">確認重設</button>
        </div>
      ` : ""}
    `;
  }).join("");

  root.innerHTML = `
    <section class="admin-table-card">
      <div class="admin-table-head">
        <strong>員工帳號</strong>
        <span>${amUsersState.users.length} 個帳號</span>
      </div>
      ${amStatusLine()}
      <div class="admin-data-table">
        ${rows || '<p class="empty-note">尚無帳號。</p>'}
      </div>
    </section>
    <section class="admin-form-card">
      <h3>新增員工帳號</h3>
      <div class="admin-form-grid">
        <label class="admin-field"><span>姓名</span><input type="text" data-am-new-name></label>
        <label class="admin-field"><span>登入帳號（工號或 Email）</span><input type="text" data-am-new-email></label>
        <label class="admin-field"><span>初始密碼（至少 8 碼）</span>${machtilePasswordField('<input type="password" autocomplete="new-password" data-am-new-password>')}</label>
        <label class="admin-field"><span>角色</span>
          <select data-am-new-role>
            ${amCreatableRoles.map((role) => `<option value="${role}">${escapeHtml(amRoleLabels[role])}</option>`).join("")}
          </select>
        </label>
      </div>
      <button class="admin-save-button" type="button" data-am-create>建立帳號</button>
      <p class="empty-note">管理者帳號由平台（super admin）建立，不能在此新增。</p>
    </section>
  `;
  amBindUsersModuleEvents();
}

function amSelfAppUserId() {
  const self = amUsersState.users.find((user) => (user.account || "").toLowerCase() === (machtileAuthState.email || "").toLowerCase());
  return self ? self.id : "";
}

function amSetMessage(message, kind) {
  amUsersState.message = message;
  amUsersState.messageKind = kind;
}

async function amReloadUsers() {
  try {
    amUsersState.users = await amFetchUsers();
  } catch (error) {
    amSetMessage(`重新載入失敗：${error.message}`, "error");
  }
  amRenderUsersModule();
}

function amBindUsersModuleEvents() {
  const root = document.querySelector("[data-am-users-root]");
  if (!root) return;

  root.querySelector("[data-am-create]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const name = root.querySelector("[data-am-new-name]")?.value.trim() || "";
    const email = machtileAccountToEmail(root.querySelector("[data-am-new-email]")?.value);
    const passwordInput = root.querySelector("[data-am-new-password]");
    const password = passwordInput?.value || "";
    const role = root.querySelector("[data-am-new-role]")?.value || "";
    if (!name || !email) {
      amSetMessage("請填姓名與登入帳號。", "error");
      amRenderUsersModule();
      return;
    }
    if (password.length < 8) {
      amSetMessage("初始密碼至少 8 碼。", "error");
      amRenderUsersModule();
      return;
    }
    button.disabled = true;
    button.textContent = "建立中…";
    const result = await amCallFunction("am-create-user", { email, password, name, role });
    if (passwordInput) passwordInput.value = "";
    if (result.ok) {
      amSetMessage(`已建立帳號 ${machtileAccountDisplay(email)}（${amRoleLabels[role] || role}）。`, "ok");
      amUsersState.expandedResetId = "";
      amUsersState.confirmStateId = "";
      await amReloadUsers();
    } else {
      amSetMessage(amErrorText(result.code, result.body?.message), "error");
      amRenderUsersModule();
    }
  });

  root.querySelectorAll("[data-am-reset-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-am-reset-open");
      amUsersState.expandedResetId = amUsersState.expandedResetId === id ? "" : id;
      amUsersState.expandedEditId = "";
      amUsersState.confirmStateId = "";
      amSetMessage("", "");
      amRenderUsersModule();
    });
  });

  root.querySelectorAll("[data-am-edit-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-am-edit-open");
      amUsersState.expandedEditId = amUsersState.expandedEditId === id ? "" : id;
      amUsersState.expandedResetId = "";
      amUsersState.confirmStateId = "";
      amSetMessage("", "");
      amRenderUsersModule();
    });
  });

  root.querySelectorAll("[data-am-edit-confirm]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-am-edit-confirm");
      const user = amUsersState.users.find((row) => row.id === id);
      const newName = root.querySelector(`[data-am-edit-name="${id}"]`)?.value.trim() || "";
      const newEmail = machtileAccountToEmail(root.querySelector(`[data-am-edit-email="${id}"]`)?.value);
      if (!newName || !newEmail) {
        amSetMessage("請填姓名與登入帳號。", "error");
        amRenderUsersModule();
        return;
      }
      if (user && newName === (user.name || "") && newEmail === (user.account || "").toLowerCase()) {
        amSetMessage("沒有變更任何內容。", "error");
        amRenderUsersModule();
        return;
      }
      button.disabled = true;
      button.textContent = "修改中…";
      const result = await amCallFunction("am-update-user", { appUserId: id, newEmail, newName });
      if (result.ok) {
        amSetMessage(`已更新帳號資料${result.body?.emailChanged ? "；下次請用新 Email 登入" : ""}。`, "ok");
        amUsersState.expandedEditId = "";
        await amReloadUsers();
      } else {
        amSetMessage(amErrorText(result.code, result.body?.message), "error");
        amRenderUsersModule();
      }
    });
  });

  root.querySelectorAll("[data-am-reset-confirm]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-am-reset-confirm");
      const input = root.querySelector(`[data-am-reset-input="${id}"]`);
      const newPassword = input?.value || "";
      if (newPassword.length < 8) {
        amSetMessage(amErrorText("INVALID_PAYLOAD"), "error");
        amRenderUsersModule();
        return;
      }
      button.disabled = true;
      button.textContent = "重設中…";
      const result = await amCallFunction("am-reset-password", { appUserId: id, newPassword });
      if (input) input.value = "";
      if (result.ok) {
        amSetMessage("密碼已重設。", "ok");
        amUsersState.expandedResetId = "";
      } else {
        amSetMessage(amErrorText(result.code, result.body?.message), "error");
      }
      amRenderUsersModule();
    });
  });

  root.querySelectorAll("[data-am-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-am-toggle");
      const nextActive = button.getAttribute("data-am-next") === "true";
      if (amUsersState.confirmStateId !== id) {
        amUsersState.confirmStateId = id;
        amSetMessage("", "");
        amRenderUsersModule();
        return;
      }
      button.disabled = true;
      const result = await amCallFunction("am-set-user-state", { appUserId: id, active: nextActive });
      amUsersState.confirmStateId = "";
      if (result.ok) {
        amSetMessage(nextActive ? "帳號已重新啟用。" : "帳號已停用（無法再登入）。", "ok");
        await amReloadUsers();
      } else {
        amSetMessage(amErrorText(result.code, result.body?.message), "error");
        amRenderUsersModule();
      }
    });
  });
}

// ---- Platform admin module (AM4; super-admin Edge Functions) ----
//
// Strict mode + platform_role='super_admin' only. Backed by am-list-tenants /
// am-create-tenant / am-reset-tenant-admin / am-set-platform-role; the same
// amCallFunction chokepoint (session Bearer) and error map are reused.

const amPlatformState = {
  status: "idle",
  tenants: [],
  message: "",
  messageKind: "",
  expandedResetId: "",
  confirmStateId: "",
  confirmRoleAction: "",
};

function renderPlatformModule() {
  if (!machtileStrictMode() || machtileAuthState.platformRole !== "super_admin") {
    return `
      <section class="admin-side-note">
        <strong>需要平台管理員</strong>
        <p>平台管理只開放給 MachTile 平台管理員（super admin）。</p>
      </section>
    `;
  }
  setTimeout(amInitPlatformModule, 0);
  return `<div data-am-platform-root><p class="empty-note">載入租戶清單中…</p></div>`;
}

function amPlatformSetMessage(message, kind) {
  amPlatformState.message = message;
  amPlatformState.messageKind = kind;
}

function amPlatformStatusLine() {
  if (!amPlatformState.message) return "";
  const tone = amPlatformState.messageKind === "error" ? "color:#b42318" : "color:#067647";
  return `<p class="empty-note" style="${tone}" data-am-platform-status>${escapeHtml(amPlatformState.message)}</p>`;
}

async function amInitPlatformModule() {
  const root = document.querySelector("[data-am-platform-root]");
  if (!root) return;
  amPlatformState.status = "loading";
  const result = await amCallFunction("am-list-tenants", {});
  if (result.ok) {
    amPlatformState.tenants = Array.isArray(result.body?.tenants) ? result.body.tenants : [];
    amPlatformState.status = "ready";
  } else {
    amPlatformState.status = "error";
    amPlatformSetMessage(amErrorText(result.code, result.body?.message), "error");
  }
  amRenderPlatformModule();
}

async function amReloadPlatformTenants() {
  const result = await amCallFunction("am-list-tenants", {});
  if (result.ok) {
    amPlatformState.tenants = Array.isArray(result.body?.tenants) ? result.body.tenants : [];
  } else {
    amPlatformSetMessage(amErrorText(result.code, result.body?.message), "error");
  }
  amRenderPlatformModule();
}

function amRenderPlatformModule() {
  const root = document.querySelector("[data-am-platform-root]");
  if (!root) return;
  const selfEmail = (machtileAuthState.email || "").toLowerCase();
  const tenantRows = amPlatformState.tenants.map((tenant) => {
    const admins = Array.isArray(tenant.admins) ? tenant.admins : [];
    const adminRows = admins.map((admin) => {
      const isSelf = (admin.account || "").toLowerCase() === selfEmail;
      const resetOpen = amPlatformState.expandedResetId === admin.id;
      const confirmOpen = amPlatformState.confirmStateId === admin.id;
      return `
        <div class="admin-data-row" data-am-platform-admin-row="${escapeHtml(admin.id)}">
          <strong>${escapeHtml(admin.name || "-")}</strong>
          <span>${escapeHtml(admin.account || "-")}</span>
          <span>管理者${isSelf ? "（自己）" : ""}</span>
          <span>${admin.isActive ? "啟用中" : "已停用"}</span>
          <span>
            <button type="button" data-am-platform-reset-open="${escapeHtml(admin.id)}">${resetOpen ? "收合" : "重設密碼"}</button>
            ${isSelf ? "" : `<button type="button" data-am-platform-toggle="${escapeHtml(admin.id)}" data-am-next="${admin.isActive ? "false" : "true"}">${confirmOpen ? (admin.isActive ? "確認停用？" : "確認啟用？") : (admin.isActive ? "停用" : "啟用")}</button>`}
          </span>
        </div>
        ${resetOpen ? `
          <div class="admin-data-row" data-am-platform-reset-row="${escapeHtml(admin.id)}">
            <label class="admin-field" style="grid-column: 1 / -2;">
              <span>新密碼（至少 8 碼）</span>
              <input type="password" autocomplete="new-password" data-am-platform-reset-input="${escapeHtml(admin.id)}">
            </label>
            <button type="button" data-am-platform-reset-confirm="${escapeHtml(admin.id)}">確認重設</button>
          </div>
        ` : ""}
      `;
    }).join("");
    return `
      <div class="admin-data-row">
        <strong>${escapeHtml(tenant.name || "-")}</strong>
        <span>${tenant.isActive ? "啟用中" : "已停用"}</span>
        <span>${Number(tenant.userCount) || 0} 個帳號</span>
        <span>${admins.length} 位管理者</span>
      </div>
      ${adminRows}
    `;
  }).join("");

  root.innerHTML = `
    <section class="admin-table-card">
      <div class="admin-table-head">
        <strong>租戶清單</strong>
        <span>${amPlatformState.tenants.length} 個租戶</span>
      </div>
      ${amPlatformStatusLine()}
      <div class="admin-data-table">
        ${tenantRows || '<p class="empty-note">尚無租戶。</p>'}
      </div>
    </section>
    <section class="admin-form-card">
      <h3>建立新租戶</h3>
      <div class="admin-form-grid">
        <label class="admin-field"><span>租戶名稱（工廠）</span><input type="text" data-am-tenant-name></label>
        <label class="admin-field"><span>廠區代碼（預設 F1）</span><input type="text" data-am-factory-code placeholder="F1"></label>
        <label class="admin-field"><span>廠區名稱（預設同租戶名）</span><input type="text" data-am-factory-name></label>
        <label class="admin-field"><span>管理者姓名</span><input type="text" data-am-tenant-admin-name></label>
        <label class="admin-field"><span>管理者 Email（登入帳號）</span><input type="email" data-am-tenant-admin-email></label>
        <label class="admin-field"><span>管理者初始密碼（至少 8 碼）</span><input type="password" autocomplete="new-password" data-am-tenant-admin-password></label>
      </div>
      <button class="admin-save-button" type="button" data-am-tenant-create>建立租戶</button>
      <p class="empty-note">會同時建立租戶、預設廠區與該廠的第一位管理者帳號。</p>
    </section>
    <section class="admin-form-card">
      <h3>平台管理員（super admin）</h3>
      <div class="admin-form-grid">
        <label class="admin-field"><span>帳號 Email</span><input type="email" data-am-platform-role-email></label>
      </div>
      <button class="admin-save-button" type="button" data-am-platform-role-set data-am-grant="true">${amPlatformState.confirmRoleAction === "grant" ? "確認授予？" : "授予平台管理員"}</button>
      <button class="admin-save-button" type="button" data-am-platform-role-set data-am-grant="false">${amPlatformState.confirmRoleAction === "revoke" ? "確認撤銷？" : "撤銷平台管理員"}</button>
      <p class="empty-note">平台管理員可建立租戶與管理各廠管理者；不能變更自己的平台角色。</p>
    </section>
  `;
  amBindPlatformModuleEvents();
}

function amBindPlatformModuleEvents() {
  const root = document.querySelector("[data-am-platform-root]");
  if (!root) return;

  root.querySelector("[data-am-tenant-create]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const tenantName = root.querySelector("[data-am-tenant-name]")?.value.trim() || "";
    const factoryCode = root.querySelector("[data-am-factory-code]")?.value.trim() || "";
    const factoryName = root.querySelector("[data-am-factory-name]")?.value.trim() || "";
    const adminName = root.querySelector("[data-am-tenant-admin-name]")?.value.trim() || "";
    const adminEmail = root.querySelector("[data-am-tenant-admin-email]")?.value.trim() || "";
    const passwordInput = root.querySelector("[data-am-tenant-admin-password]");
    const adminPassword = passwordInput?.value || "";
    if (!tenantName || !adminName || !adminEmail || adminPassword.length < 8) {
      amPlatformSetMessage(amErrorText("INVALID_PAYLOAD"), "error");
      amRenderPlatformModule();
      return;
    }
    button.disabled = true;
    button.textContent = "建立中…";
    const result = await amCallFunction("am-create-tenant", {
      tenantName,
      factoryCode,
      factoryName,
      adminName,
      adminEmail,
      adminPassword,
    });
    if (passwordInput) passwordInput.value = "";
    if (result.ok) {
      amPlatformSetMessage(`已建立租戶 ${tenantName}，管理者 ${adminEmail}。`, "ok");
      amPlatformState.expandedResetId = "";
      amPlatformState.confirmStateId = "";
      await amReloadPlatformTenants();
    } else {
      amPlatformSetMessage(amErrorText(result.code, result.body?.message), "error");
      amRenderPlatformModule();
    }
  });

  root.querySelectorAll("[data-am-platform-reset-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-am-platform-reset-open");
      amPlatformState.expandedResetId = amPlatformState.expandedResetId === id ? "" : id;
      amPlatformState.confirmStateId = "";
      amPlatformSetMessage("", "");
      amRenderPlatformModule();
    });
  });

  root.querySelectorAll("[data-am-platform-reset-confirm]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-am-platform-reset-confirm");
      const input = root.querySelector(`[data-am-platform-reset-input="${id}"]`);
      const newPassword = input?.value || "";
      if (newPassword.length < 8) {
        amPlatformSetMessage(amErrorText("INVALID_PAYLOAD"), "error");
        amRenderPlatformModule();
        return;
      }
      button.disabled = true;
      button.textContent = "重設中…";
      const result = await amCallFunction("am-reset-tenant-admin", { appUserId: id, action: "reset_password", newPassword });
      if (input) input.value = "";
      if (result.ok) {
        amPlatformSetMessage("管理者密碼已重設。", "ok");
        amPlatformState.expandedResetId = "";
      } else {
        amPlatformSetMessage(amErrorText(result.code, result.body?.message), "error");
      }
      amRenderPlatformModule();
    });
  });

  root.querySelectorAll("[data-am-platform-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-am-platform-toggle");
      const nextActive = button.getAttribute("data-am-next") === "true";
      if (amPlatformState.confirmStateId !== id) {
        amPlatformState.confirmStateId = id;
        amPlatformSetMessage("", "");
        amRenderPlatformModule();
        return;
      }
      button.disabled = true;
      const result = await amCallFunction("am-reset-tenant-admin", { appUserId: id, action: "set_state", active: nextActive });
      amPlatformState.confirmStateId = "";
      if (result.ok) {
        amPlatformSetMessage(nextActive ? "管理者帳號已重新啟用。" : "管理者帳號已停用（無法再登入）。", "ok");
        await amReloadPlatformTenants();
      } else {
        amPlatformSetMessage(amErrorText(result.code, result.body?.message), "error");
        amRenderPlatformModule();
      }
    });
  });

  root.querySelectorAll("[data-am-platform-role-set]").forEach((button) => {
    button.addEventListener("click", async () => {
      const grant = button.getAttribute("data-am-grant") === "true";
      const action = grant ? "grant" : "revoke";
      const email = root.querySelector("[data-am-platform-role-email]")?.value.trim() || "";
      if (!email) {
        amPlatformSetMessage(amErrorText("INVALID_PAYLOAD"), "error");
        amRenderPlatformModule();
        return;
      }
      if (amPlatformState.confirmRoleAction !== action) {
        amPlatformState.confirmRoleAction = action;
        amPlatformSetMessage("", "");
        const emailInput = root.querySelector("[data-am-platform-role-email]");
        const typed = emailInput ? emailInput.value : "";
        amRenderPlatformModule();
        const rerendered = document.querySelector("[data-am-platform-role-email]");
        if (rerendered) rerendered.value = typed;
        return;
      }
      button.disabled = true;
      const result = await amCallFunction("am-set-platform-role", { email, grant });
      amPlatformState.confirmRoleAction = "";
      if (result.ok) {
        amPlatformSetMessage(grant ? `已授予 ${email} 平台管理員。` : `已撤銷 ${email} 的平台管理員。`, "ok");
      } else {
        amPlatformSetMessage(amErrorText(result.code, result.body?.message), "error");
      }
      amRenderPlatformModule();
    });
  });
}

function renderInviteModule() {
  const invites = [
    ["MT-OP-LATHE", "operator", "車床課", "30 天"],
    ["MT-OP-MILL", "operator", "銑床課", "30 天"],
    ["MT-QA-DEMO", "inspector", "品檢", "30 天"],
    ["MT-MGR-DEMO", "manager", "主管", "30 天"],
  ];
  return renderSimpleAdminList("邀請碼", invites, "生成新邀請碼");
}

function renderVendorModule() {
  const vendors = [
    ["外包熱處理", "外包商", "只能看指派工單", "待啟用"],
    ["I-Reporter", "品檢系統", "品檢與追溯資料", "已規劃"],
    ["油品供應商", "保養協作", "機台保養資訊", "選配"],
  ];
  return renderSimpleAdminList("外部授權", vendors, "新增授權對象");
}

function renderCompanyModule() {
  return `
    <section class="admin-form-card">
      <h3>公司與部署設定</h3>
      <div class="admin-form-grid">
        ${adminField("公司名稱", "MachTile Demo Factory")}
        ${adminField("聯絡人", "張家維")}
        ${adminField("電話", "02-0000-0000")}
        ${adminSelect("部署模式", ["cloud_saas", "dedicated_cloud", "on_premise"], "cloud_saas")}
        ${adminField("資料保留天數", "1095", "number")}
        ${adminField("時區", "Asia/Taipei")}
      </div>
      ${adminSaveButton("儲存公司資料")}
    </section>
  `;
}

function renderTemplateModule() {
  const templates = [
    ["鋸料", "material_prep", "可選機台", "非必要品檢"],
    ["CNC 車削", "cnc_lathe", "車床課", "可要求首件"],
    ["CNC 銑削", "cnc_mill", "銑床課", "可要求首件"],
    ["去毛邊", "manual", "人工站", "完成回報"],
    ["品檢", "inspection", "品檢區", "必填結果"],
    ["包裝", "packing", "出貨前", "完成結案"],
  ];
  return renderSimpleAdminList("製程模板", templates, "新增製程模板");
}

function renderProgramModule() {
  const orders = state.workOrders.filter((order) => getProgramProfile(order).programName !== "待上傳");
  const rows = orders.map((order) => {
    const profile = getProgramProfile(order);
    return [order.drawing, profile.programName, profile.programVersion, `${profile.changedLines ?? 0} 行差異`];
  });
  return renderSimpleAdminList("CNC 程式版本", rows, "上傳程式");
}

function renderTimeModule() {
  const rows = state.workOrders.map((order) => {
    const profile = getProgramProfile(order);
    const dailyQty = dailyPureCapacity(profile);
    return [order.drawing, formatSeconds(profile.pureCycleSec), formatSeconds(profile.baselineCycleSec), dailyQty ? `${dailyQty} 件/日` : "待建立"];
  });
  return renderSimpleAdminList("加工時間基準", rows, "更新時間基準");
}

function renderNotifyModule() {
  const rows = [
    ["LINE", "交期風險 / 已延誤", "主管、生管", "待串接"],
    ["Email", "每日摘要", "主管", "選配"],
    ["Web Push", "未回報 / 待品檢", "現場主管", "待串接"],
  ];
  return renderSimpleAdminList("通知規則", rows, "儲存通知規則");
}

function renderIntegrationModule() {
  const rows = [
    ["SoftNet MES", "工單 / 製程 / 完工回寫", "先讀取、後雙向", "規劃中"],
    ["I-Reporter", "品檢 / 追溯 / 報告", "v3 串接", "規劃中"],
    ["Supabase", "Cloud SaaS DB", "目前 dev 使用", "已連線"],
    ["On-premise", "Postgres + MinIO", "成品廠選配", "規劃中"],
  ];
  return renderSimpleAdminList("同步與串接", rows, "測試連線");
}

function renderExportModule() {
  const rows = [
    ["機台", managedMachineList().length, "CSV"],
    ["工單", state.workOrders.length, "CSV"],
    ["報工紀錄", "依日期", "CSV"],
    ["警報與異常", alertOrders().length, "CSV"],
    ["CNC 程式履歷", state.workOrders.filter((order) => getProgramProfile(order).programName !== "待上傳").length, "CSV"],
    ["操作紀錄", "依使用者", "CSV"],
  ];
  return `
    ${renderSimpleAdminList("匯出資料範圍", rows, "建立匯出 ZIP")}
    <p class="admin-export-note">正式版會建立 data_export_jobs，完成後提供 ZIP 下載連結。</p>
  `;
}

function renderSimpleAdminList(title, rows, buttonLabel) {
  return `
    <section class="admin-table-card">
      <div class="admin-table-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${rows.length} 筆</span>
      </div>
      <div class="admin-data-table admin-data-table-wide">
        ${rows.map((row) => `
          <div class="admin-data-row">
            ${row.map((cell, index) => index === 0 ? `<strong>${escapeHtml(cell)}</strong>` : `<span>${escapeHtml(cell)}</span>`).join("")}
            <button type="button" data-admin-save="編輯 ${escapeHtml(row[0])}">編輯</button>
          </div>
        `).join("")}
      </div>
      ${adminSaveButton(buttonLabel)}
    </section>
  `;
}

function adminIcon(type) {
  const icons = {
    add: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    alarm: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    users: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    invite: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h7v7h-7z"/><path d="M17.5 14v7M14 17.5h7"/></svg>',
    vendor: '<svg viewBox="0 0 24 24"><path d="M7 11v8a2 2 0 0 0 2 2h8"/><path d="M7 11 3 7l4-4 4 4"/><path d="M17 13V5a2 2 0 0 0-2-2H7"/><path d="m17 13 4 4-4 4-4-4"/></svg>',
    company: '<svg viewBox="0 0 24 24"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9h.01M9 13h.01M9 17h.01M17 15h.01M17 18h.01"/></svg>',
    template: '<svg viewBox="0 0 24 24"><path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/><path d="M8 5v14"/><path d="M16 5v14"/></svg>',
    reportRule: '<svg viewBox="0 0 24 24"><path d="M9 11h6"/><path d="M9 15h6"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/><path d="M12 3v5h5"/></svg>',
    program: '<svg viewBox="0 0 24 24"><path d="m8 9-4 3 4 3"/><path d="m16 9 4 3-4 3"/><path d="m14 5-4 14"/></svg>',
    time: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M4 4l3 3"/><path d="m20 4-3 3"/></svg>',
    notify: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    integration: '<svg viewBox="0 0 24 24"><path d="M9 7V3"/><path d="M15 7V3"/><path d="M7 11h10"/><path d="M8 7h8v5a4 4 0 0 1-8 0z"/><path d="M12 16v5"/><path d="M8 21h8"/></svg>',
    export: '<svg viewBox="0 0 24 24"><path d="M14 3v4a2 2 0 0 0 2 2h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><path d="M12 12v6"/><path d="m9 15 3 3 3-3"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    qr: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h2v2h-2zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  };
  return icons[type] || icons.list;
}

function managedMachineList() {
  return state.machines.filter((machine) => isReportableMachineName(machine.name));
}

function machineAdminMeta(machine) {
  const order = machine.order;
  const match = String(machine.name).match(/(\d+)/);
  const number = match ? Number(match[1]) : state.machines.indexOf(machine) + 1;
  const department = machine.department || departmentForMachine(machine);
  const code = machine.assetNo || `M2025-${String(number).padStart(3, "0")}`;
  const status = statusMeta[machine.status] || statusMeta.idle;
  return {
    code,
    department,
    company: machine.vendorName || "大正科技",
    coolant: machine.coolantType || "半合成",
    capacity: machine.coolantCapacityLiters ? `${machine.coolantCapacityLiters} L` : machine.type === "五軸" ? "300 L" : "200 L",
    reportRule: machine.reportRuleName || (machine.reportsPerDay ? `每日 ${machine.reportsPerDay} 次` : "每班 3 次"),
    alertRule: machine.staleMinutes ? `未回報 ${Math.round(machine.staleMinutes / 60)} 小時提醒` : "未回報 4 小時提醒",
    targetConcentration: machine.targetConcentrationPercent ? `${machine.targetConcentrationPercent}%` : "6%",
    inspectionFrequency: machine.inspectionFrequencyDays ? `每 ${machine.inspectionFrequencyDays} 天` : "每 30 天",
    programCount: machine.programCount ?? 0,
    status,
    order,
    health: machine.status === "maintenance" ? 42 : machine.status === "paused" ? 66 : order?.risk ? 72 : 88,
  };
}

function renderMachineEditCard(machine) {
  const meta = machineAdminMeta(machine);
  const reportUrl = machineReportUrl(machine);
  const tone = meta.department === "車床課" ? "lathe" : "mill";
  return `
    <article class="machine-edit-card machine-${tone}">
      <header>
        <div>
          <h3>${escapeHtml(machine.name)}</h3>
          <span>${escapeHtml(meta.code)}</span>
        </div>
        <button class="machine-mini-status ${meta.status.className}" type="button" data-machine-admin="${escapeHtml(machine.name)}">${escapeHtml(meta.status.label)}</button>
      </header>
      <div class="machine-edit-pill">${escapeHtml(meta.department)}</div>
      <p>🏢 ${escapeHtml(meta.company)}</p>
      <p>🛢️ ${escapeHtml(meta.coolant)}</p>
      <p>📦 ${escapeHtml(machineTypeLabel(machine.type))} · ${escapeHtml(meta.reportRule)} · 程式 ${meta.programCount}</p>
      <footer>
        <button type="button" data-machine-admin="${escapeHtml(machine.name)}" aria-label="編輯 ${escapeHtml(machine.name)}">${adminIcon("edit")}</button>
        <a data-no-detail href="${escapeHtml(reportUrl)}" target="_blank" rel="noopener" aria-label="${escapeHtml(machine.name)} QR 連結">${adminIcon("qr")}</a>
        <button class="danger-icon" type="button" data-alert-action="刪除 ${escapeHtml(machine.name)}" aria-label="刪除 ${escapeHtml(machine.name)}">${adminIcon("trash")}</button>
      </footer>
    </article>
  `;
}

function openMachineAdmin(machineName) {
  closeAdminModule();
  const machine = state.machines.find((item) => item.name === machineName);
  if (!machine) return;
  $("#machineAdminContent").innerHTML = renderMachineAdminDetail(machine);
  $("#machineAdminSheet").classList.add("is-open");
  $("#machineAdminSheet").setAttribute("aria-hidden", "false");
}

function openAdminModule(moduleKey) {
  const meta = adminModuleMeta(moduleKey);
  $("#adminModuleEyebrow").textContent = meta.eyebrow;
  $("#adminModuleTitle").textContent = meta.title;
  $("#adminModuleContent").innerHTML = renderAdminModuleContent(moduleKey);
  if (moduleKey === "workOrders") machtileInitWorkOrderModule().catch(() => {});
  $("#adminModuleSheet").classList.add("is-open");
  $("#adminModuleSheet").setAttribute("aria-hidden", "false");
}

function closeAdminModule() {
  $("#adminModuleSheet").classList.remove("is-open");
  $("#adminModuleSheet").setAttribute("aria-hidden", "true");
}

function closeMachineAdmin() {
  $("#machineAdminSheet").classList.remove("is-open");
  $("#machineAdminSheet").setAttribute("aria-hidden", "true");
}

function renderMachineAdminDetail(machine) {
  const meta = machineAdminMeta(machine);
  const reportUrl = machineReportUrl(machine);
  const order = meta.order;
  return `
    <section class="machine-admin-hero ${meta.status.className}">
      <div>
        <span class="machine-type-pill">${escapeHtml(machineTypeLabel(machine.type))}</span>
        <h3>${escapeHtml(machine.name)}</h3>
        <p>${escapeHtml(meta.code)} · ${escapeHtml(meta.department)}</p>
      </div>
      <span class="status-pill">${escapeHtml(meta.status.label)}</span>
    </section>

    <section class="machine-admin-detail-grid">
      <div class="machine-admin-block">
        <h4>基本資訊</h4>
        <dl>
          <div><dt>機台名稱</dt><dd>${escapeHtml(machine.name)}</dd></div>
          <div><dt>機台 ID</dt><dd>${escapeHtml(meta.code)}</dd></div>
          <div><dt>部門</dt><dd>${escapeHtml(meta.department)}</dd></div>
          <div><dt>狀態</dt><dd class="state-dot">${escapeHtml(meta.status.label)}</dd></div>
        </dl>
      </div>

      <div class="machine-admin-block">
        <h4>生產設定</h4>
        <dl>
          <div><dt>機型</dt><dd>${escapeHtml(machineTypeLabel(machine.type))}</dd></div>
          <div><dt>負責公司</dt><dd>${escapeHtml(meta.company)}</dd></div>
          <div><dt>報工規則</dt><dd>${escapeHtml(meta.reportRule)}</dd></div>
          <div><dt>警報規則</dt><dd>${escapeHtml(meta.alertRule)}</dd></div>
        </dl>
      </div>

      <div class="machine-admin-block">
        <h4>切削液 / 保養</h4>
        <dl>
          <div><dt>油品類型</dt><dd>${escapeHtml(meta.coolant)}</dd></div>
          <div><dt>槽體容量</dt><dd>${escapeHtml(meta.capacity)}</dd></div>
          <div><dt>目標濃度</dt><dd>${escapeHtml(meta.targetConcentration)}</dd></div>
          <div><dt>檢測頻率</dt><dd>${escapeHtml(meta.inspectionFrequency)}</dd></div>
        </dl>
      </div>

      <div class="machine-admin-block">
        <h4>最新狀態</h4>
        <dl>
          <div><dt>健康分數</dt><dd>${meta.health} 分</dd></div>
          <div><dt>目前工單</dt><dd>${escapeHtml(order?.id || "無")}</dd></div>
          <div><dt>完成數</dt><dd>${order ? `${order.done}/${order.total}` : "-"}</dd></div>
          <div><dt>最後回報</dt><dd>${escapeHtml(order?.lastReport || machine.note || "尚未回報")}</dd></div>
        </dl>
      </div>
    </section>

    <section class="machine-admin-qr-block">
      <img src="${escapeHtml(qrCodeUrl(reportUrl, 180))}" alt="${escapeHtml(machine.name)} 報工 QR Code">
      <div>
        <h4>本機台報工 QR Code</h4>
        <p>貼在機台旁，師傅掃碼後直接進入 ${escapeHtml(machine.name)} 的手機回報頁。</p>
        <code>${escapeHtml(reportUrl)}</code>
        <div class="machine-admin-actions">
          <a data-no-detail href="${escapeHtml(reportUrl)}" target="_blank" rel="noopener">開啟報工頁</a>
          ${order ? `<a data-no-detail href="${escapeHtml(workOrderDetailUrl(order.id))}" target="_blank" rel="noopener">開啟目前工單</a>` : ""}
          <button type="button" data-alert-action="編輯 ${escapeHtml(machine.name)}">編輯機台</button>
        </div>
      </div>
    </section>
  `;
}

function renderAll() {
  deriveMachines();
  applyDashboardFilterParams();
  selectedOrder = state.workOrders.find((order) => order.id === selectedOrder?.id) || state.workOrders[0] || null;
  if (selectedOrder) setSelectedOrder(selectedOrder);
  $("#dataSourceLabel").textContent = state.source === "supabase" ? "Supabase 已連線" : "Mock data";
  ensureHmcDashboardEntry();
  renderStats();
  renderFilters();
  renderWorkOrders();
  renderAlerts();
  renderInspectionQueue();
  renderNotificationCenter();
  renderHistory();
  renderReports();
  renderSettings();
}

function applyDashboardFilterParams() {
  const params = new URLSearchParams(window.location.search);
  const department = params.get("department");
  const millingMode = params.get("millingMode");
  if (departmentFilters.includes(department)) activeDepartmentFilter = department;
  if (millingModeFilters.includes(millingMode)) activeMillingModeFilter = millingMode;
}

function switchView(view) {
  const panel = $(`#${view}View`);
  if (!panel) return;
  $$(".view").forEach((item) => item.classList.remove("is-active"));
  panel.classList.add("is-active");
  $$(".nav-item, .mobile-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
}

function setSelectedOrder(order) {
  selectedOrder = order;
  $("#reportMachine").textContent = order.machine || UNASSIGNED_MACHINE;
  $("#reportPart").textContent = order.part;
  $("#reportWorkNo").textContent = order.id;
  setReportDefaults(order);
}

function openReport(orderId, options = {}) {
  resetReportFileInputs();
  const machineName = options.machine || "";
  activeReportReturnDetailOrderId = options.returnDetailOrderId || "";
  if (machineName && !isReportableMachineName(machineName)) {
    showToast("未排機不產生報工入口，請先指派實際機台");
    return;
  }
  const orderById = state.workOrders.find((item) => item.id === orderId);
  const orderByMachine = machineName ? state.workOrders.find((item) => item.machine === machineName) : null;
  const order = orderById || orderByMachine || (!machineName ? selectedOrder || state.workOrders[0] : null);
  if (order && !isOrderReportable(order)) {
    showToast("這張工單尚未指派機台，不能開啟報工入口");
    return;
  }
  if (order) {
    setSelectedOrder(order);
  } else if (machineName) {
    selectedOrder = null;
    $("#reportMachine").textContent = machineName;
    $("#reportPart").textContent = "尚未指派工單";
    $("#reportWorkNo").textContent = "待指派";
  }
  setReportType(options.reportType || "workStart");
  if (!order) setReportDefaults(null);
  $("#reportSheet").classList.toggle("route-sheet", Boolean(options.routeMode));
  document.body.classList.toggle("route-mode", Boolean(options.routeMode));
  $("#reportSheet").classList.add("is-open");
  $("#reportSheet").setAttribute("aria-hidden", "false");
  machtileRenderOperatorSection().catch(() => {});   // strict+flag only; no-op otherwise
  ($("#workTotalQty") || $("#completedQty")).focus();
}

function closeReport() {
  const returnDetailOrderId = activeReportReturnDetailOrderId;
  $("#reportSheet").classList.remove("is-open");
  $("#reportSheet").classList.remove("route-sheet");
  document.body.classList.remove("route-mode");
  $("#reportSheet").setAttribute("aria-hidden", "true");
  activeReportReturnDetailOrderId = "";
  if (returnDetailOrderId) openDetail(returnDetailOrderId);
}

function openDetail(orderId, options = {}) {
  const order = state.workOrders.find((item) => item.id === orderId);
  if (!order) return;
  setSelectedOrder(order);
  $("#detailSheet").classList.toggle("route-sheet", Boolean(options.routeMode));
  document.body.classList.toggle("route-mode", Boolean(options.routeMode));
  $("#detailSheet").classList.add("is-open");
  $("#detailSheet").setAttribute("aria-hidden", "false");
  $("#detailContent").innerHTML = '<p class="empty-note">載入工單明細中...</p>';
  hydrateDetail(order);
}

function closeDetail() {
  $("#detailSheet").classList.remove("is-open");
  $("#detailSheet").classList.remove("route-sheet");
  document.body.classList.remove("route-mode");
  $("#detailSheet").setAttribute("aria-hidden", "true");
}

function openNotificationDrawer() {
  $("#notificationDrawer").classList.add("is-open");
  $("#notificationDrawer").setAttribute("aria-hidden", "false");
  $("#openNotificationsBtn").setAttribute("aria-expanded", "true");
}

function closeNotificationDrawer() {
  $("#notificationDrawer").classList.remove("is-open");
  $("#notificationDrawer").setAttribute("aria-hidden", "true");
  $("#openNotificationsBtn").setAttribute("aria-expanded", "false");
}

async function hydrateDetail(order) {
  let processes = [];
  let reports = [];
  let abnormalities = [];

  if (state.source === "supabase" && isUuid(order.workOrderId)) {
    try {
      processes = await supabaseFetch(
        `work_order_processes?select=process_order,process_code,process_name,process_type,status,qty_planned,qty_completed,qty_defect,inspection_required,inspection_status,planned_start_at,planned_end_at,actual_start_at,actual_end_at,remark&work_order_id=eq.${encodeURIComponent(order.workOrderId)}&order=process_order.asc`
      );
      reports = await supabaseFetch(
        `production_reports?select=completed_qty,defect_qty,status_after_report,remark,created_at&work_order_id=eq.${encodeURIComponent(order.workOrderId)}&order=created_at.desc&limit=8`
      );
      abnormalities = await supabaseFetch(
        `abnormal_events?select=event_type,severity,description,status,reported_at,resolution&work_order_id=eq.${encodeURIComponent(order.workOrderId)}&order=reported_at.desc&limit=6`
      );
    } catch (error) {
      console.warn("Detail load failed, using fallback:", error);
    }
  }

  renderDetail(order, {
    processes: processes.length ? processes : fallbackProcesses(order),
    reports: reports.length ? reports : fallbackReports(order),
    abnormalities: abnormalities.length ? abnormalities : fallbackAbnormalities(order),
  });
}

function fallbackProcesses(order) {
  const currentStatus = order.processStatus || "pending";
  const done = Number(order.done || 0);
  const total = Number(order.total || 0);
  return [
    {
      process_order: 1,
      process_name: order.process?.includes("車") ? "鋸料" : "備料",
      process_type: "preparation",
      status: done > 0 ? "completed" : "pending",
      qty_planned: total,
      qty_completed: done > 0 ? total : 0,
      qty_defect: 0,
      inspection_required: false,
      inspection_status: "none",
      planned_end_at: `${order.dueDate} 09:00+08`,
      remark: done > 0 ? "前段已完成" : "待開工",
    },
    {
      process_order: 2,
      process_name: order.process || "CNC 加工",
      process_type: order.process,
      status: currentStatus,
      qty_planned: total,
      qty_completed: done,
      qty_defect: order.risk ? 1 : 0,
      inspection_required: false,
      inspection_status: "none",
      planned_end_at: `${order.dueDate} 15:00+08`,
      remark: riskSuggestion(order),
    },
    {
      process_order: 3,
      process_name: "品檢",
      process_type: "inspection",
      status: currentStatus === "waiting_inspection" ? "waiting_inspection" : done >= total && total > 0 ? "pending" : "pending",
      qty_planned: total,
      qty_completed: 0,
      qty_defect: 0,
      inspection_required: true,
      inspection_status: currentStatus === "waiting_inspection" ? "pending" : "none",
      planned_end_at: `${order.dueDate} 17:00+08`,
      remark: "加工完成後進入品檢",
    },
  ];
}

function fallbackReports(order) {
  if (!order.done) return [];
  const firstQty = Math.max(1, Math.round(order.done / 2));
  return [
    {
      completed_qty: Math.max(0, order.done - firstQty),
      defect_qty: order.risk ? 1 : 0,
      status_after_report: order.processStatus || "running",
      remark: order.risk ? "現場回報進度落後，需主管確認。" : "正常回報。",
      created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    },
    {
      completed_qty: firstQty,
      defect_qty: 0,
      status_after_report: "running",
      remark: "開始加工後回報。",
      created_at: new Date(Date.now() - 5 * 3600000).toISOString(),
    },
  ];
}

function fallbackAbnormalities(order) {
  if (!alertCategories(order).has("異常") && !alertCategories(order).has("已延誤") && !alertCategories(order).has("可能延誤")) return [];
  return [{
    event_type: alertReason(order),
    severity: primaryAlertStatus(order) === "overdue" ? "critical" : order.risk || "medium",
    description: riskSuggestion(order),
    status: "open",
    reported_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    resolution: "",
  }];
}

function processLabel(status) {
  const labels = {
    pending: "待開工",
    running: "加工中",
    waiting_inspection: "待品檢",
    completed: "已完成",
    skipped: "略過",
    paused: "暫停",
    abnormal: "異常",
  };
  return labels[status] || status || "-";
}

function processClass(status) {
  if (status === "completed") return "risk-green";
  if (status === "running") return "risk-blue";
  if (status === "waiting_inspection" || status === "paused") return "risk-amber";
  if (status === "abnormal") return "risk-red";
  return "risk-gray";
}

function priorityLabel(priority) {
  const labels = { urgent: "急件", high: "高", normal: "一般", low: "低" };
  return labels[priority] || priority || "-";
}

function inspectionLabel(value) {
  const labels = { none: "無", pending: "待檢", pass: "通過", fail: "不通過", skipped: "略過" };
  return labels[value] || value || "-";
}

function renderDetail(order, detail) {
  const statusKey = deriveOrderStatus(order);
  const status = statusMeta[statusKey] || statusMeta.normal;
  const due = dueInfo(order);
  const percent = pct(order);
  const processes = detail.processes || [];
  const reports = detail.reports || [];
  const abnormalities = detail.abnormalities || [];
  const currentProcess = processes.find((process) => ["running", "waiting_inspection", "abnormal", "paused"].includes(process.status)) || processes[0];
  const profile = getProgramProfile(order);
  const delta = cycleDelta(profile);
  const dailyQty = dailyPureCapacity(profile);
  const workDays = estimatedWorkDays(order, profile);
  const fullOrderUrl = workOrderDetailUrl(order.id);
  const reportable = isOrderReportable(order);
  const mobileReportUrl = reportable ? detailReportRouteUrl(order, "dailyStart") : "";

  $("#detailContent").innerHTML = `
    <section class="detail-machine-top ${status.className}">
      <div>
        <span class="machine-type-pill">${escapeHtml(machineTypeLabel(order.process))}</span>
        <h3>${escapeHtml(order.machine || "未排機")}</h3>
        <p>${escapeHtml(order.process)} · ${escapeHtml(order.lastReport || "尚未回報")}</p>
      </div>
      <div class="detail-machine-score">
        <span>完成率</span>
        <strong>${percent}%</strong>
      </div>
    </section>

    <section class="detail-hero ${status.className}">
      <div>
        <div class="detail-work-no">${escapeHtml(order.id)}</div>
        <h3>${escapeHtml(order.part)}</h3>
        <p>${escapeHtml(order.customer)} · 圖號 ${escapeHtml(order.drawing)}</p>
      </div>
      <div class="detail-hero-actions">
        <span class="status-pill">${escapeHtml(status.label)}</span>
        <a class="detail-link-button" data-no-detail href="${escapeHtml(fullOrderUrl)}" target="_blank" rel="noopener">查看完整工單</a>
      </div>
    </section>

    <div class="detail-summary-grid detail-summary-grid-wide">
      <div><span>交期</span><strong>${escapeHtml(due.label)}</strong><small>${escapeHtml(order.dueDate)}</small></div>
      <div><span>目前製程</span><strong>${escapeHtml(order.process)}</strong><small>${escapeHtml(order.machine || "未排機")}</small></div>
      <div><span>完成數</span><strong>${order.done}/${order.total}</strong><small>${percent}%</small></div>
      <div><span>優先級</span><strong>${escapeHtml(priorityLabel(order.priority))}</strong><small>${escapeHtml(order.lastReport)}</small></div>
      <div><span>品檢</span><strong>${escapeHtml(inspectionLabel(currentProcess?.inspection_status))}</strong><small>${currentProcess?.inspection_required ? "需要品檢" : "未要求"}</small></div>
    </div>

    <div class="detail-progress">
      <div class="progress-track" aria-label="工單完成進度 ${percent}%">
        <div class="progress-fill" style="width:${percent}%"></div>
      </div>
    </div>

    <section class="detail-ai ${status.className}">
      <div class="advice-title"><span></span>MachTile AI 建議</div>
      <p>${escapeHtml(riskSuggestion(order))}</p>
      <div class="detail-action-row">
        ${reportable
          ? `<button type="button" data-open-report="${escapeHtml(order.id)}" data-open-report-type="workStart">首次開工</button>
             <button type="button" data-open-report="${escapeHtml(order.id)}" data-open-report-type="dailyStart">今日開工</button>
             <a class="detail-link-button" data-no-detail href="${escapeHtml(mobileReportUrl)}" target="_blank" rel="noopener">開啟手機報工</a>
             <a class="detail-link-button" data-no-detail href="${escapeHtml(fullOrderUrl)}" target="_blank" rel="noopener">查看完整工單</a>`
          : `<button type="button" class="disabled-action" disabled>未指派機台</button>
             <span class="detail-link-button disabled-action">無報工 QR</span>`}
        <button type="button" data-alert-action="安排加班">安排加班</button>
        <button type="button" data-alert-action="通知客戶">通知客戶</button>
      </div>
    </section>

    <section class="detail-section program-section">
      <div class="detail-section-title">
        <h3>程式與加工基準</h3>
        <span>${profile.historyYears ? `近 ${profile.historyYears} 年 ${profile.historyRuns} 次` : "尚未建立履歷"}</span>
      </div>
      <div class="program-grid">
        <div class="program-main-card">
          <span>目前 CNC 程式</span>
          <strong>${escapeHtml(profile.programName)}</strong>
          <small>${escapeHtml(profile.programVersion)} · Hash ${escapeHtml(profile.programHash || "-")}</small>
        </div>
        <div>
          <span>上次版本</span>
          <strong>${escapeHtml(profile.previousVersion || "-")}</strong>
          <small>${profile.changedLines === null ? "無歷史版本" : `${profile.changedLines} 行差異`}</small>
        </div>
        <div>
          <span>純加工時間</span>
          <strong>${escapeHtml(formatSeconds(profile.pureCycleSec))}</strong>
          <small>不含上下料</small>
        </div>
        <div>
          <span>標準基準</span>
          <strong>${escapeHtml(formatSeconds(profile.baselineCycleSec))}</strong>
          <small class="${delta !== null && delta > 8 ? "cycle-warn" : ""}">${delta === null ? "待建立" : `${delta > 0 ? "+" : ""}${delta}%`}</small>
        </div>
        <div>
          <span>每日可加工</span>
          <strong>${dailyQty ? `${dailyQty} 件` : "-"}</strong>
          <small>以 8 小時純加工估算</small>
        </div>
        <div>
          <span>預估工期</span>
          <strong>${workDays ? `${workDays} 天` : "-"}</strong>
          <small>未含上下料與等待</small>
        </div>
      </div>
      <p class="program-note">${escapeHtml(profile.toolChanges)}</p>
    </section>

    <section class="detail-section">
      <div class="detail-section-title">
        <h3>製程進度</h3>
        <span>${processes.length} 道製程</span>
      </div>
      <div class="process-timeline">
        ${processes.map((process) => `
          <article class="process-row ${processClass(process.status)}">
            <div class="process-index">${escapeHtml(process.process_order || "-")}</div>
            <div>
              <div class="process-row-head">
                <strong>${escapeHtml(process.process_name)}</strong>
                <span class="status-pill">${escapeHtml(processLabel(process.status))}</span>
              </div>
              <div class="process-meta-grid">
                <span>預計 ${escapeHtml(formatDateTime(process.planned_end_at))}</span>
                <span>完成 ${Number(process.qty_completed || 0)} / ${Number(process.qty_planned || order.total || 0)}</span>
                <span>不良 ${Number(process.qty_defect || 0)}</span>
                <span>${process.inspection_required ? `品檢 ${inspectionLabel(process.inspection_status)}` : "免品檢"}</span>
              </div>
              ${process.remark ? `<small>${escapeHtml(process.remark)}</small>` : ""}
            </div>
          </article>
        `).join("")}
      </div>
    </section>

    <div class="detail-two-column">
      <section class="detail-section">
        <div class="detail-section-title">
          <h3>生產回報紀錄</h3>
          <span>${reports.length} 筆</span>
        </div>
        <div class="report-list">
          ${reports.length ? reports.map((report) => `
            <article class="report-row">
              <div>
                <strong>完成 +${Number(report.completed_qty || 0)} · 不良 ${Number(report.defect_qty || 0)}</strong>
                <p>${escapeHtml(report.remark || "無備註")}</p>
              </div>
              <time>${escapeHtml(formatRelativeTime(report.created_at))}</time>
            </article>
          `).join("") : '<p class="empty-note">尚無生產回報紀錄。</p>'}
        </div>
      </section>

      <section class="detail-section">
        <div class="detail-section-title">
          <h3>異常紀錄</h3>
          <span>${abnormalities.length} 筆</span>
        </div>
        <div class="abnormal-list">
          ${abnormalities.length ? abnormalities.map((event) => `
            <article class="abnormal-row ${processClass(event.severity === "critical" ? "abnormal" : "paused")}">
              <div>
                <strong>${escapeHtml(event.event_type || "異常")}</strong>
                <span class="status-pill">${escapeHtml(event.severity || "medium")}</span>
              </div>
              <p>${escapeHtml(event.description || "-")}</p>
              <small>${escapeHtml(formatDateTime(event.reported_at))} · ${escapeHtml(event.status || "open")}</small>
            </article>
          `).join("") : '<p class="empty-note">目前沒有異常紀錄。</p>'}
        </div>
      </section>
    </div>
  `;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function openAiSupport() {
  $("#aiSupportPanel")?.classList.add("is-open");
  $("#aiSupportPanel")?.setAttribute("aria-hidden", "false");
  $("#aiSupportFab")?.setAttribute("aria-expanded", "true");
  window.setTimeout(() => $("#aiSupportInput")?.focus(), 50);
}

function closeAiSupport() {
  $("#aiSupportPanel")?.classList.remove("is-open");
  $("#aiSupportPanel")?.setAttribute("aria-hidden", "true");
  $("#aiSupportFab")?.setAttribute("aria-expanded", "false");
}

function appendAiSupportMessage(role, text) {
  const messages = $("#aiSupportMessages");
  if (!messages) return;
  const item = document.createElement("div");
  item.className = `ai-message ai-message-${role}`;
  item.innerHTML = `
    <strong>${role === "user" ? "你" : "MachTile AI 客服"}</strong>
    <p>${escapeHtml(text)}</p>
  `;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function aiSupportAnswer(question) {
  const q = String(question || "").toLowerCase();
  if (q.includes("相機") || q.includes("拍照") || q.includes("照片")) {
    return "拍照欄位要點「開啟相機拍照」。手機會優先開後鏡頭，拍完按「拍照使用」。如果瀏覽器沒有相機權限，才會退回手機內建拍照/選檔。\n\n首次開工、今日開工、收工/完工、異常回報的照片是必填；CNC 程式檔是選填。";
  }
  if (q.includes("暫停") || q.includes("pause") || q.includes("停工")) {
    return "「暫停加工」用在加工真的中斷時，例如換刀、待料、量測、機台異音、等主管確認。\n\n點下去後輸入原因，系統會把製程狀態標成 paused，並寫一筆暫停回報。正常中午休息不要用暫停，請用「中午報工」。";
  }
  if (q.includes("報工") || q.includes("一天") || q.includes("中午") || q.includes("4:30") || q.includes("下午")) {
    return "建議報工節點是：\n1. 首次開工：工件總數、cycle time、開工照片。\n2. 今日開工：目前機台已加工數量、機台照片、首件檢查。\n3. 中午報工：良品累計 / 不良數，這筆用來判斷是否加班。\n4. 下午 4:30 檢查：只填檢查表與是否異常，不填數量。\n5. 收工/完工：良品累計 / 不良數、完工照片、是否加班。";
  }
  if (q.includes("qr") || q.includes("掃碼") || q.includes("未排機")) {
    return "QR Code 只給實際機台使用，例如 CNC-01 到 CNC-08。師傅掃機台 QR 會直接進該機台報工頁。\n\n「未排機」只代表工單尚未指派機台，不應該產生 QR，也不能報工。";
  }
  if (q.includes("警報") || q.includes("延誤") || q.includes("加班") || q.includes("風險")) {
    return "警報頁是風險處理中心。可能延誤、已延誤、異常、待品檢、未回報都集中在那裡。\n\n中午報工是判斷要不要加班的關鍵；下午 4:30 檢查是讓主管下班前確認是否要處理。";
  }
  if (q.includes("管理") || q.includes("設定") || q.includes("員工") || q.includes("程式") || q.includes("加工時間")) {
    return "管理頁目前包含機台、員工、邀請碼、供應商授權、公司資料、製程模板、報工規則、CNC 程式管理、加工時間管理、通知規則、串接設定與資料匯出。\n\nCNC 程式管理用來保存程式版次與 hash；加工時間管理用來保存純加工時間、歷史平均與日產能。";
  }
  if (q.includes("supabase") || q.includes("雲") || q.includes("地端") || q.includes("部署")) {
    return "目前 prototype 已支援 Supabase Cloud。正式版可以分成兩種部署：一般 CNC 加工廠走雲端；成品廠或資安要求高的客戶可用 dedicated cloud 或地端 Supabase/Postgres。\n\n同一套前端可以切換資料來源，不會跟未來 SoftNet MES 衝突。";
  }
  if (q.includes("客服") || q.includes("ai") || q.includes("幫助")) {
    return "我是 MachTile 的內建 AI 客服，先用產品規則回答常見問題。下一步可以接 OpenAI API 或 LINE Messaging API，讓我回答廠內 SOP、報工規則、警報處理與客戶導入問題。";
  }
  return "我先用 MachTile 的規則回答：這個問題可能跟報工、機台、警報、管理或部署有關。你可以問得更具體一點，例如「中午報工要填什麼」、「暫停加工怎麼用」、「QR 可以給未排機嗎」或「Supabase 地端怎麼部署」。";
}

function submitAiSupportQuestion(question) {
  const text = String(question || "").trim();
  if (!text) return;
  appendAiSupportMessage("user", text);
  const input = $("#aiSupportInput");
  if (input) input.value = "";
  window.setTimeout(() => appendAiSupportMessage("assistant", aiSupportAnswer(text)), 180);
}

// ---- CNC field-report offline outbox wiring (2026-07-11) ----
// Plan + locks: docs/MACHTILE_CNC_OUTBOX_APPJS_WIRING_PLAN_2026-07-11.md
// (W1=LocalDevGate, W2=EndedAtOnly, W3=SimulatedOffline, W4=MinimalBadge).
// Gated on config.enableOutboxSubmit (default false): flag off = no module
// import, no listeners, submitReport keeps the direct POST byte-path.
let machtileOutboxInstance = null;
let machtileOutboxLoadPromise = null;
let machtileOutboxDriverStarted = false;
// Attachment entries are captured at submit time (the DOM inputs are cleared
// right after submit) and persisted to an IndexedDB file store keyed by
// report_uuid — so an offline report's photos survive an app restart and get
// uploaded when the report finally sends (backlog A, 2026-07-11). Upload is
// best-effort once, then the entry is deleted (T3) — same tolerance as the
// legacy online path.
const machtileOutboxUploadResults = new Map();

function machtileOutboxEnabled() {
  return Boolean(config.enableOutboxSubmit);
}

async function machtileOutboxHandleSent({ report_uuid, report_id }) {
  const fileStore = machtileOutboxInstance?.fileStore;
  let entries = [];
  if (fileStore) {
    try { entries = (await fileStore.get(report_uuid))?.entries || []; } catch { entries = []; }
  }
  let uploaded = 0;
  let failed = 0;
  if (report_id) {
    for (const entry of entries) {
      try {
        await uploadReportFile(report_id, entry);
        uploaded += 1;
      } catch (error) {
        failed += 1;
        console.warn(error);
      }
    }
  }
  if (fileStore && entries.length) {
    try { await fileStore.delete(report_uuid); } catch { /* best-effort */ }
  }
  if (machtileOutboxUploadResults.size < 50) {
    machtileOutboxUploadResults.set(report_uuid, { uploaded, failed });
  }
  machtileUpdateOutboxBadge();
}

async function machtileGetOutbox() {
  if (!machtileOutboxEnabled()) return null;
  if (machtileOutboxInstance) return machtileOutboxInstance;
  if (!machtileOutboxLoadPromise) {
    machtileOutboxLoadPromise = (async () => {
      // ?v= on module URLs: dynamic import obeys the HTTP cache (Pages
      // max-age=600) — without a bust, a tab that loaded an older module
      // earlier keeps composing against it after a deploy. Bump alongside
      // the index.html app.js ?v= stamp on every outbox change.
      const v = "20260711-outbox-trio2";
      const [outboxMod, storeMod, fileStoreMod, senderMod, submitMod] = await Promise.all([
        import(`./outbox/outbox.mjs?v=${v}`),
        import(`./outbox/outbox-store-idb.mjs?v=${v}`),
        import(`./outbox/outbox-file-store-idb.mjs?v=${v}`),
        import(`./outbox/sender-supabase.mjs?v=${v}`),
        import(`./outbox/field-report-submit.mjs?v=${v}`),
      ]);
      const fileStore = fileStoreMod.createIdbFileStore();
      const outbox = outboxMod.createOutbox({
        store: storeMod.createIdbStore(),
        sender: senderMod.createSupabaseFieldReportSender({
          callRpc: senderMod.createPostgrestRpcCall({
            baseUrl: config.supabaseUrl,
            getHeaders: () => supabaseHeaders(),
          }),
        }),
        online: () => navigator.onLine,
        onSent: machtileOutboxHandleSent,
      });
      const submitter = submitMod.createFieldReportSubmitter({ outbox, fileStore });
      machtileOutboxInstance = { outbox, submitter, fileStore };
      machtileOutboxStartDriver(outbox);
      return machtileOutboxInstance;
    })().catch((error) => {
      machtileOutboxLoadPromise = null;
      console.warn("outbox unavailable, falling back to direct submit", error);
      return null;
    });
  }
  return machtileOutboxLoadPromise;
}

function machtileOutboxStartDriver(outbox) {
  if (machtileOutboxDriverStarted) return;
  machtileOutboxDriverStarted = true;
  const flush = () => outbox.flush().then(() => machtileUpdateOutboxBadge()).catch(() => {});
  window.addEventListener("online", flush);
  window.setInterval(() => { if (navigator.onLine) flush(); }, 30000);
  flush(); // startup: resend leftovers from previous sessions (online() guards offline)
}

async function machtileUpdateOutboxBadge() {
  if (!machtileOutboxInstance) return;
  const { outbox } = machtileOutboxInstance;
  let pendingCount = 0;
  let failedCount = 0;
  try {
    pendingCount = (await outbox.pending()).length;
    failedCount = (await outbox.deadLetters()).length;
  } catch {
    return;
  }
  let badge = document.getElementById("machtileOutboxBadge");
  if (pendingCount === 0 && failedCount === 0) {
    if (badge) badge.hidden = true;
    return;
  }
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "machtileOutboxBadge";
    badge.style.cssText =
      "position:fixed;left:16px;bottom:16px;z-index:60;display:flex;gap:8px;align-items:center;" +
      "padding:8px 12px;border-radius:10px;background:#1f2937;color:#f9fafb;font-size:13px;" +
      "box-shadow:0 4px 12px rgba(0,0,0,.25);";
    document.body.appendChild(badge);
  }
  badge.hidden = false;
  const failedText = failedCount
    ? `<button type="button" data-outbox-retry style="border:0;border-radius:8px;padding:4px 8px;background:#dc2626;color:#fff;cursor:pointer;">送失敗 ${failedCount} 筆，點擊重試</button>`
    : "";
  badge.innerHTML = `${pendingCount ? `<span>報工待送 ${pendingCount} 筆</span>` : ""}${failedText}`;
  badge.querySelector("[data-outbox-retry]")?.addEventListener("click", async () => {
    const dead = await outbox.deadLetters();
    for (const item of dead) await outbox.requeue(item.report_uuid);
    outbox.flush().then(() => machtileUpdateOutboxBadge()).catch(() => {});
    machtileUpdateOutboxBadge();
  });
}

async function machtileSubmitReportViaOutbox(box, basePayload, structuredPayload, reportType, operators) {
  // ended_at = capture time fixed at enqueue (accurate even if the report is
  // sent hours later); started_at from the rolling ledger (W2=EndedAtOnly
  // superseded 2026-07-11 — the writeback bridge requires both).
  const endedAt = new Date().toISOString();
  const startedAt = machtileTakeStartedAt(basePayload.process_id, endedAt);
  const payload = {
    ...basePayload,
    ...structuredPayload,
    ended_at: endedAt,
  };
  if (startedAt) payload.started_at = startedAt;
  const files = config.enableFileUpload ? reportFilesForType(reportType) : [];
  const { report_uuid } = await box.submitter.submit(payload, {
    operators: operators && operators.length ? operators : (basePayload.user_id ? [basePayload.user_id] : []),
    files,
  });
  // submit() already fire-and-forgets a flush; await one more (it joins the
  // in-flight scan) so the toast can tell "written now" from "queued offline".
  await box.outbox.flush().catch(() => {});
  const record = await box.outbox.get(report_uuid).catch(() => null);
  const sentNow = record?.status === "sent";
  const uploadResult = machtileOutboxUploadResults.get(report_uuid) || { uploaded: 0, failed: 0 };
  machtileOutboxUploadResults.delete(report_uuid);
  machtileUpdateOutboxBadge();
  return {
    wroteCloud: true,
    queuedOffline: !sentNow,
    uploaded: uploadResult.uploaded,
    uploadFailed: uploadResult.failed,
  };
}

// ---- started_at rolling ledger (2026-07-11, TODO_APPJS_STARTED_AT_FOR_CNC_WRITEBACK) ----
// The SoftNet writeback bridge REQUIRES started_at (contract §3: 工時 = out−in;
// rows without it are rejected). Lock=RollingLedger: each report's started_at
// = the previous report/開工 timestamp for the same process (kept per-device in
// localStorage), then the ledger rolls forward to this report's ended_at — so
// periods tile without overlap and their sum equals real elapsed time. Ledger
// miss (first-ever report on this device) → started_at stays null: visible
// bridge reject instead of fabricated hours.
const MACHTILE_STARTED_AT_LEDGER_KEY = "machtile-outbox-started-at";

function machtileTakeStartedAt(processId, endedAtIso) {
  if (!processId) return null;
  let startedAt = null;
  try {
    let ledger;
    try { ledger = JSON.parse(localStorage.getItem(MACHTILE_STARTED_AT_LEDGER_KEY) || "{}") || {}; }
    catch { ledger = {}; }
    const prev = ledger[processId];
    // ISO-8601 UTC strings compare lexicographically; guard ended>=started
    // (the RPC raises otherwise, e.g. after a device clock change).
    if (typeof prev === "string" && prev && prev <= endedAtIso) startedAt = prev;
    ledger[processId] = endedAtIso;   // roll forward
    localStorage.setItem(MACHTILE_STARTED_AT_LEDGER_KEY, JSON.stringify(ledger));
  } catch { /* storage unavailable → started_at stays null */ }
  return startedAt;
}

// ---- operator multi-select (backlog C, 2026-07-11; T2=all active users) ----
// Strict-only + flag-on: the report sheet gains an 操作人員 checklist so one
// station account can credit several people's 每人產值 (operators -> RPC
// operator_ids). dev-nologin never renders it (no session, byte-identical).
let machtileOperatorListCache = null;

async function machtileFetchOperatorList() {
  if (!machtileStrictMode() || !machtileSessionActive()) return [];
  if (machtileOperatorListCache) return machtileOperatorListCache;
  try {
    const rows = await supabaseFetch("app_users?select=id,name&is_active=eq.true&order=name");
    machtileOperatorListCache = Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.warn("operator list lookup failed; falling back to single actor", error);
    machtileOperatorListCache = [];
  }
  return machtileOperatorListCache;
}

// Injected before the 備註 field each time the report sheet opens; default =
// current actor checked. Reuses the existing .checklist-card styling (zero
// styles.css change).
async function machtileRenderOperatorSection() {
  if (!machtileOutboxEnabled() || !machtileStrictMode() || !machtileSessionActive()) return;
  const form = document.getElementById("reportForm");
  const anchor = form?.querySelector('label[for="reportNote"]');
  if (!form || !anchor) return;
  const actorId = await machtileResolveAppUserId();
  const users = await machtileFetchOperatorList();
  if (!users.length) return;
  let section = document.getElementById("machtileOperatorSection");
  if (!section) {
    section = document.createElement("section");
    section.id = "machtileOperatorSection";
    section.className = "report-section";
    form.insertBefore(section, anchor);
  }
  section.innerHTML = `
    <div class="report-section-head"><strong>操作人員</strong></div>
    <div class="checklist-card" id="machtileOperatorList"></div>
  `;
  const list = section.querySelector("#machtileOperatorList");
  users.forEach((u) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = u.id;
    input.checked = u.id === actorId;
    label.appendChild(input);
    label.appendChild(document.createTextNode(` ${u.name || u.id}`));
    list.appendChild(label);
  });
}

// Checked operators from the section; falls back to the single actor when the
// section is absent (dev-nologin, lookup failure) or nothing is checked.
function machtileSelectedOperators(actorAppUserId) {
  const list = document.getElementById("machtileOperatorList");
  if (list) {
    const checked = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map((i) => i.value);
    if (checked.length) return checked;
  }
  return actorAppUserId ? [actorAppUserId] : [];
}

// Eager driver start (flag on only): resend leftovers from a previous
// session without waiting for the first new submit of this one.
if (machtileOutboxEnabled()) {
  if (document.readyState === "complete") {
    window.setTimeout(() => { machtileGetOutbox(); }, 0);
  } else {
    window.addEventListener("load", () => { machtileGetOutbox(); });
  }
}

async function submitReport(completed, defects, remark, reportType) {
  if (state.source !== "supabase" || !selectedOrder?.processId || !isUuid(selectedOrder.workOrderId)) {
    return { wroteCloud: false, uploaded: 0, uploadFailed: 0 };
  }

  const reportPayload = buildReportPayload(reportType);
  const basePayload = {
    tenant_id: selectedOrder.tenantId,
    work_order_id: selectedOrder.workOrderId,
    process_id: selectedOrder.processId,
    report_date: new Date().toISOString().slice(0, 10),
    completed_qty: completed,
    defect_qty: defects,
    status_after_report: selectedOrder.processStatus || "running",
    remark,
  };
  const actorAppUserId = await machtileResolveAppUserId();
  if (actorAppUserId) basePayload.user_id = actorAppUserId;
  const structuredPayload = {
    report_type: reportType,
    report_payload: reportPayload,
    work_total_qty: reportPayload.work_total_qty,
    cycle_time_seconds: reportPayload.cycle_time_seconds,
  };
  if (machtileOutboxEnabled()) {
    const box = await machtileGetOutbox();
    // Any outbox init failure falls through to the direct POST — a report
    // must always have a way out.
    if (box) {
      return machtileSubmitReportViaOutbox(
        box, basePayload, structuredPayload, reportType,
        machtileSelectedOperators(actorAppUserId)
      );
    }
  }
  // seam 待辦 B(a) (2026-07-11): fallback rows carry a report_uuid too, so
  // they still reach the writeback feed (it filters report_uuid IS NOT NULL).
  if (!basePayload.report_uuid && globalThis.crypto?.randomUUID) {
    basePayload.report_uuid = crypto.randomUUID();
  }
  let rows;
  if (useStructuredReportColumns) {
    try {
      rows = await supabaseFetch("production_reports", {
        method: "POST",
        body: JSON.stringify({ ...basePayload, ...structuredPayload }),
      });
    } catch (error) {
      const message = String(error.message || "");
      if (!message.includes("report_type") && !message.includes("report_payload") && !message.includes("cycle_time_seconds")) {
        throw error;
      }
      useStructuredReportColumns = false;
    }
  }
  if (!rows) {
    rows = await supabaseFetch("production_reports", {
      method: "POST",
      body: JSON.stringify(basePayload),
    });
  }
  const reportId = Array.isArray(rows) ? rows[0]?.id : rows?.id;
  const uploadResult = await uploadReportFiles(reportId, reportType);
  return {
    wroteCloud: true,
    uploaded: uploadResult.uploaded,
    uploadFailed: uploadResult.failed,
  };
}

async function submitPauseReport(reason) {
  if (state.source !== "supabase" || !selectedOrder?.processId || !isUuid(selectedOrder.workOrderId)) {
    return { wroteCloud: false, queuedOffline: false };
  }
  const pausePayload = {
    tenant_id: selectedOrder.tenantId,
    work_order_id: selectedOrder.workOrderId,
    process_id: selectedOrder.processId,
    report_date: new Date().toISOString().slice(0, 10),
    completed_qty: 0,
    defect_qty: 0,
    status_after_report: "paused",
    remark: `[暫停加工] ${reason}`,
  };
  const actorAppUserId = await machtileResolveAppUserId();
  if (actorAppUserId) pausePayload.user_id = actorAppUserId;
  // backlog B (2026-07-11): pause goes through the outbox too — RPC accepts
  // status_after_report ('paused' whitelist, migration 202607110005). Pause
  // stays single-actor (whoever pressed it), no operator multi-select.
  if (machtileOutboxEnabled()) {
    const box = await machtileGetOutbox();
    if (box) {
      const pauseEndedAt = new Date().toISOString();
      const pauseStartedAt = machtileTakeStartedAt(selectedOrder.processId, pauseEndedAt);
      const outboxPausePayload = { ...pausePayload, ended_at: pauseEndedAt };
      if (pauseStartedAt) outboxPausePayload.started_at = pauseStartedAt;
      const { report_uuid } = await box.submitter.submit(
        outboxPausePayload,
        { operators: actorAppUserId ? [actorAppUserId] : [] }
      );
      await box.outbox.flush().catch(() => {});
      const record = await box.outbox.get(report_uuid).catch(() => null);
      machtileUpdateOutboxBadge();
      return { wroteCloud: true, queuedOffline: record?.status !== "sent" };
    }
  }
  // seam 待辦 B(a): same report_uuid treatment for the pause fallback
  if (!pausePayload.report_uuid && globalThis.crypto?.randomUUID) {
    pausePayload.report_uuid = crypto.randomUUID();
  }
  await supabaseFetch("production_reports", {
    method: "POST",
    body: JSON.stringify(pausePayload),
  });
  return { wroteCloud: true, queuedOffline: false };
}

async function handlePauseReport() {
  if (!selectedOrder) {
    showToast("此機台尚未指派工單，無法暫停加工。");
    return;
  }
  const reason = window.prompt("請輸入暫停原因，例如：換刀、待料、量測、機台異音");
  if (!reason?.trim()) return;
  try {
    const pauseResult = await submitPauseReport(reason.trim());
    selectedOrder.processStatus = "paused";
    selectedOrder.workStatus = "paused";
    selectedOrder.lastReport = "剛剛";
    closeReport();
    renderAll();
    showToast(
      !pauseResult.wroteCloud ? "已標記暫停加工"
        : pauseResult.queuedOffline ? "已排入待送：暫停加工，連線後自動送出"
        : "已寫入 Supabase：暫停加工"
    );
  } catch (error) {
    showToast(`暫停失敗：${error.message}`);
  }
}

function handleLocalReport(completed, defects, options = {}) {
  if (!selectedOrder) return;
  if (options.quantityMode === "cumulative") {
    selectedOrder.done = Math.min(Number(selectedOrder.total || 0), Number(completed || 0));
  } else if (Number(completed || 0) > 0) {
    selectedOrder.done = Math.min(Number(selectedOrder.total || 0), Number(selectedOrder.done || 0) + completed);
  }
  selectedOrder.lastReport = "剛剛";
  if (defects > 0) {
    selectedOrder.workStatus = "abnormal";
    selectedOrder.processStatus = "abnormal";
    selectedOrder.risk = selectedOrder.risk || "medium";
  }
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      switchView(viewButton.dataset.view);
      return;
    }

    const stationSelectButton = event.target.closest("[data-select-station]");
    if (stationSelectButton) {
      selectStation(stationSelectButton.dataset.selectStation);
      return;
    }

    const departmentButton = event.target.closest("[data-department]");
    if (departmentButton) {
      activeDepartmentFilter = departmentButton.dataset.department;
      renderFilters();
      renderWorkOrders();
      return;
    }

    const millingModeButton = event.target.closest("[data-milling-mode]");
    if (millingModeButton) {
      activeMillingModeFilter = millingModeButton.dataset.millingMode;
      renderFilters();
      renderWorkOrders();
      return;
    }

    const statusButton = event.target.closest("[data-status]");
    if (statusButton) {
      activeStatusFilter = statusButton.dataset.status;
      renderFilters();
      renderStats();
      renderWorkOrders();
      return;
    }

    const statButton = event.target.closest("[data-stat-filter]");
    if (statButton) {
      activeStatusFilter = statButton.dataset.statFilter;
      renderStats();
      renderFilters();
      renderWorkOrders();
      showToast(`已篩選：${activeStatusFilter === "全部狀態" ? "總機台" : activeStatusFilter}`);
      return;
    }

    const alertButton = event.target.closest("[data-alert-filter]");
    if (alertButton) {
      activeAlertFilter = alertButton.dataset.alertFilter;
      renderAlerts();
      return;
    }

    if (event.target.closest("#aiSupportFab")) {
      openAiSupport();
      return;
    }

    if (event.target.closest("[data-close-ai-support]")) {
      closeAiSupport();
      return;
    }

    const aiQuestionButton = event.target.closest("[data-ai-question]");
    if (aiQuestionButton) {
      submitAiSupportQuestion(aiQuestionButton.dataset.aiQuestion);
      return;
    }

    const cameraButton = event.target.closest("[data-camera-for]");
    if (cameraButton) {
      openCamera(cameraButton.dataset.cameraFor, cameraButton.dataset.cameraLabel);
      return;
    }

    if (event.target.closest("[data-camera-capture]")) {
      captureCameraPhoto();
      return;
    }

    if (event.target.closest("[data-close-camera]")) {
      closeCamera();
      return;
    }

    if (event.target.closest("[data-pause-report]")) {
      handlePauseReport();
      return;
    }

    const reportTypeButton = event.target.closest("[data-report-type]");
    if (reportTypeButton) {
      setReportType(reportTypeButton.dataset.reportType);
      return;
    }

    const reportButton = event.target.closest("[data-report], [data-open-report]");
    if (reportButton) {
      const reportOrderId = reportButton.dataset.report || reportButton.dataset.openReport || "";
      const reportType = reportButton.dataset.reportType || reportButton.dataset.openReportType || "workStart";
      const fromDetailSheet = Boolean(reportButton.closest("#detailSheet"));
      if (fromDetailSheet) closeDetail();
      openReport(reportOrderId, { reportType, returnDetailOrderId: fromDetailSheet ? reportOrderId : "" });
      return;
    }

    const machineAdminButton = event.target.closest("[data-machine-admin]");
    if (machineAdminButton) {
      openMachineAdmin(machineAdminButton.dataset.machineAdmin);
      return;
    }

    const adminModuleButton = event.target.closest("[data-admin-module]");
    if (adminModuleButton) {
      openAdminModule(adminModuleButton.dataset.adminModule);
      return;
    }

    const hmcQrCardLink = event.target.closest(".machine-qr-card");
    if (hmcQrCardLink) {
      const sameTabReportUrl = sameTabReportUrlFromLink(hmcQrCardLink.href);
      if (sameTabReportUrl) {
        event.preventDefault();
        window.location.href = sameTabReportUrl;
        return;
      }
    }

    if (event.target.closest("[data-no-detail]")) {
      return;
    }

    const detailButton = event.target.closest("[data-detail]");
    if (detailButton) {
      openDetail(detailButton.dataset.detail);
      return;
    }

    if (event.target.closest("[data-close-report]")) {
      closeReport();
      return;
    }

    if (event.target.closest("[data-close-detail]")) {
      closeDetail();
      return;
    }

    if (event.target.closest("[data-close-machine-admin]")) {
      closeMachineAdmin();
      return;
    }

    if (event.target.closest("[data-close-admin-module]")) {
      closeAdminModule();
      return;
    }

    if (event.target.closest("#openNotificationsBtn")) {
      openNotificationDrawer();
      return;
    }

    if (event.target.closest("#closeNotificationsBtn")) {
      closeNotificationDrawer();
      return;
    }

    if (event.target.id === "notificationDrawer") {
      closeNotificationDrawer();
      return;
    }

    const actionButton = event.target.closest("[data-alert-action]");
    if (actionButton) {
      const orderText = actionButton.dataset.alertOrder ? `：${actionButton.dataset.alertOrder}` : "";
      showToast(`${actionButton.dataset.alertAction}${orderText}`);
      return;
    }

    const adminSaveButton = event.target.closest("[data-admin-save]");
    if (adminSaveButton) {
      showToast(`${adminSaveButton.dataset.adminSave}已建立草稿`);
    }
  });

  $$(".stepper button").forEach((button) => {
    button.addEventListener("click", () => {
      const input = $(`#${button.dataset.step}`);
      const value = Math.max(0, Number(input.value || 0) + Number(button.dataset.delta));
      input.value = value;
      updateNoonAdvice();
    });
  });

  ["workTotalQty", "cycleMinutes", "cycleSeconds", "completedQty"].forEach((id) => {
    const input = $(`#${id}`);
    if (!input) return;
    input.addEventListener("input", () => {
      updateReportEstimate();
      updateNoonAdvice();
    });
  });

  ["startPhoto", "machinePhoto", "finishPhoto", "abnormalPhoto"].forEach((id) => {
    const input = $(`#${id}`);
    if (!input) return;
    input.addEventListener("change", () => {
      if (input.files?.length) capturedCameraFiles.delete(id);
      updateCameraStatus(id);
    });
  });

  $("#aiSupportForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitAiSupportQuestion($("#aiSupportInput")?.value);
  });

  $("#reportForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedOrder) {
      showToast("此機台尚未指派工單，請先由主管排入工單。");
      return;
    }
    const validationMessage = validateReportForm(activeReportType);
    if (validationMessage) {
      showToast(validationMessage);
      return;
    }
    const meta = reportTypeMeta[activeReportType] || reportTypeMeta.workStart;
    const completed = Number($("#completedQty").value || 0);
    const defects = Number($("#defectQty").value || 0);
    const remark = buildReportRemark(activeReportType, $("#reportNote").value.trim());
    try {
      const result = await submitReport(completed, defects, remark, activeReportType);
      if (!result.wroteCloud) handleLocalReport(meta.needsQty ? completed : 0, defects, meta);
      closeReport();
      renderAll();
      const qtyText = meta.needsQty ? `：良品 ${completed} 件，不良 ${defects} 件` : "";
      const fileText = result.uploaded ? `，附件 ${result.uploaded} 個` : result.uploadFailed ? "，附件待補" : "";
      showToast(
        !result.wroteCloud ? `已送出示範${meta.label}${qtyText}`
          : result.queuedOffline ? `已排入待送${meta.label}${qtyText}，連線後自動送出`
          : `已寫入 Supabase ${meta.label}${qtyText}${fileText}`
      );
    } catch (error) {
      showToast(`回報失敗：${error.message}`);
    }
  });
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function startDemo() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("demo") !== "1") return;

  const durationMinutes = Number(params.get("duration") || 180);
  const durationMs = Math.max(1, durationMinutes) * 60 * 1000;
  const startedAt = Date.now();
  const views = ["dashboard", "alerts", "history", "reports", "settings"];
  let viewIndex = 0;
  let statusFilterIndex = 0;

  demoState = { timers: [], timeouts: [], startedAt, durationMs };
  $("#demoBanner").hidden = false;

  const updateTimer = () => {
    const remaining = durationMs - (Date.now() - startedAt);
    $("#demoTimer").textContent = formatDuration(remaining);
    if (remaining <= 0) stopDemo("自動展示已結束");
  };

  const cycleView = () => {
    viewIndex = (viewIndex + 1) % views.length;
    switchView(views[viewIndex]);
  };

  const cycleFilter = () => {
    statusFilterIndex = (statusFilterIndex + 1) % statusFilters.length;
    switchView("dashboard");
    activeStatusFilter = statusFilters[statusFilterIndex];
    renderStats();
    renderFilters();
    renderWorkOrders();
  };

  updateTimer();
  demoState.timers.push(window.setInterval(updateTimer, 1000));
  demoState.timers.push(window.setInterval(cycleView, 15000));
  demoState.timers.push(window.setInterval(cycleFilter, 22000));
  const pulseReportSheet = () => {
    openReport();
    const timeout = window.setTimeout(closeReport, 5500);
    demoState?.timeouts.push(timeout);
  };

  demoState.timers.push(window.setInterval(pulseReportSheet, 60000));

  $("#stopDemoBtn").addEventListener("click", () => stopDemo("自動展示已停止"), { once: true });
  showToast("自動展示已開始");
}

function stopDemo(reason = "自動展示已停止") {
  if (!demoState) return;
  demoState.timers.forEach((timer) => window.clearInterval(timer));
  demoState.timeouts.forEach((timer) => window.clearTimeout(timer));
  demoState = null;
  $("#demoBanner").hidden = true;
  closeReport();
  showToast(reason);
}

function updateTodayLabel() {
  const now = new Date();
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  $("#todayLabel").textContent = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} 週${weekday}`;
}

// 每個 route 頁左上角固定品牌列（點擊回首頁）；CSS 只在 *-route-mode 顯示。
function machtileEnsureRouteBrand() {
  if (document.getElementById("machtileRouteBrand")) return;
  const bar = document.createElement("div");
  bar.id = "machtileRouteBrand";
  bar.className = "machtile-route-brand-bar";
  bar.innerHTML = `
    <a class="brand" href="./" aria-label="回首頁">
      <div class="brand-mark" aria-hidden="true"><span></span></div>
      <div>
        <div class="brand-name">MachTile</div>
        <div class="brand-subtitle">製程方塊</div>
      </div>
    </a>
  `;
  document.body.prepend(bar);
}

function applyInitialRoute() {
  ensureP0SafeModeBanner();
  machtileEnsureRouteBrand();
  const params = new URLSearchParams(window.location.search);
  const routePath = currentRoutePath();
  const routeView = params.get("view");

  if (routePath === stationSelectRoutePath()) {
    renderStationSelectRoute();
    return;
  }

  if (routePath === workListRoutePath()) {
    renderWorkListRoute();
    return;
  }

  if (routePath === workDetailRoutePath()) {
    renderWorkDetailRoute();
    return;
  }

  if (routePath === reportWorkRoutePath() || routePath.startsWith(`${reportWorkRoutePath()}/`)) {
    renderReportWorkRoute();
    return;
  }

  if (routePath === hmcWorklistSetupRoutePath() || routePath.startsWith(`${hmcWorklistSetupRoutePath()}/`)) {
    renderHmcWorklistSetupRoute();
    return;
  }

  if (routePath === hmcDailyCheckReviewRoutePath() || routePath.startsWith(`${hmcDailyCheckReviewRoutePath()}/`)) {
    renderHmcDailyCheckReviewRoute();
    return;
  }

  if (routePath === hmcFormalReportsRoutePath() || routePath.startsWith(`${hmcFormalReportsRoutePath()}/`)) {
    renderHmcFormalReportsRoute();
    return;
  }

  if (routePath === hmcFormalReportDraftsRoutePath() || routePath.startsWith(`${hmcFormalReportDraftsRoutePath()}/`)) {
    renderHmcFormalReportDraftsRoute();
    return;
  }

  if (routePath === hmcGuideRoutePath() || routePath.startsWith(`${hmcGuideRoutePath()}/`)) {
    renderHmcGuideRoute();
    return;
  }

  if (routePath === hmcReportRoutePath() || routePath.startsWith(`${hmcReportRoutePath()}/`)) {
    renderHmcReportRoute();
    return;
  }

  if (isWorkOrderDetailRoutePath(routePath)) {
    const orderId = decodeURIComponent(routePath.replace("/work-orders/", ""));
    switchView("dashboard");
    openDetail(orderId, { routeMode: true });
    return;
  }

  if (routePath === "/m/report" || routePath.startsWith("/m/report/")) {
    const machineName = params.get("machine") || "";
    const orderNo = params.get("wo") || "";
    switchView("dashboard");
    if (!isReportableMachineName(machineName)) {
      showToast("未排機沒有報工 QR，請先在工單指派實際機台");
      return;
    }
    openReport(orderNo, { routeMode: true, machine: machineName, reportType: params.get("type") || "dailyStart" });
    return;
  }

  if (routeView) switchView(routeView);
}

async function init() {
  updateTodayLabel();
  loadMockData();
  bindEvents();

  // Gate P / P2 GlobalLoginGate: in strict mode nothing renders (and no data
  // call fires) before a successful login; the gate resumes init afterwards.
  // Route changes are full page loads, so first try the per-tab persisted
  // session before showing the gate.
  if (machtileStrictMode() && !machtileSessionActive()) {
    await machtileRestoreSession();
  }
  if (machtileStrictMode() && !machtileSessionActive()) {
    machtileRenderLoginGate();
    return;
  }

  machtileEnsureSessionBadge();
  machtileApplyBranding();
  machtileEnsureRefreshTimer();
  await machtileResumeInit();
}

async function machtileResumeInit() {
  if (isP0SafeMode()) {
    ensureP0SafeModeBanner();
    applyInitialRoute();
    return;
  }

  if (isP0RoutePath()) {
    applyInitialRoute();
    return;
  }

  if (isWorkOrderDetailRoutePath()) {
    renderAll();
    applyInitialRoute();
    return;
  }

  if (config.useSupabase && config.supabaseUrl && config.supabaseAnonKey) {
    try {
      await loadFromSupabase();
    } catch (error) {
      console.warn("Supabase load failed, fallback to mock data:", error);
      loadMockData();
      showToast("Supabase 讀取失敗，已切回示範資料");
    }
  }

  renderAll();
  applyInitialRoute();
  startDemo();
}

init();
