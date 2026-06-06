(function () {
  "use strict";

  // StationId is the primary identity. IP is diagnostic only.
  // SoftNet integration is future planning only.
  var routes = {
    STATION_SELECT: "/m/station-select",
    WORK_LIST: "/m/work-list",
    REPORT: "/m/report",
    SESSION: "/m/session",
    ABNORMAL: "/m/abnormal",
    INSPECT: "/m/inspect",
    DASHBOARD: "/dashboard",
    ADMIN_STATIONS: "/admin/stations",
    ADMIN_WORK_ORDERS: "/admin/work-orders",
    REPORTS: "/reports",
    EXPORT: "/export",
    CNC03_DAILY_START_QUERY: "?route=%2Fm%2Freport&machine=CNC-03&type=dailyStart"
  };

  window.MachTileRoutes = Object.freeze(routes);
})();
