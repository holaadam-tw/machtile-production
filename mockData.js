(function () {
  "use strict";

  // Demo-only mock data. StationId is the primary identity.
  // currentIp/sourceIp are diagnostic only. SoftNet integration is future planning only.
  var stations = [
    {
      stationId: "st-cnc-03",
      stationCode: "CNC-03",
      stationName: "CNC Station 03",
      stationType: "CNC",
      isActive: true,
      displayOrder: 30
    },
    {
      stationId: "st-cnc-02",
      stationCode: "CNC-02",
      stationName: "CNC Station 02",
      stationType: "CNC",
      isActive: true,
      displayOrder: 20
    },
    {
      stationId: "st-inspect-01",
      stationCode: "INSPECT-01",
      stationName: "Inspection Station 01",
      stationType: "INSPECTION",
      isActive: true,
      displayOrder: 60
    }
  ];

  var machines = [
    {
      machineId: "mc-cnc-03",
      machineCode: "CNC-03-M",
      machineName: "CNC-03 machine",
      stationId: "st-cnc-03",
      machineType: "CNC_MACHINING_CENTER",
      activeStatus: "active"
    },
    {
      machineId: "mc-cnc-02",
      machineCode: "CNC-02-M",
      machineName: "CNC-02 machine",
      stationId: "st-cnc-02",
      machineType: "CNC_MACHINING_CENTER",
      activeStatus: "active"
    },
    {
      machineId: "mc-inspect-01",
      machineCode: "INSPECT-BENCH-01",
      machineName: "Inspection bench",
      stationId: "st-inspect-01",
      machineType: "INSPECTION_BENCH",
      activeStatus: "active"
    }
  ];

  var tabletDevices = [
    {
      tabletId: "tb-cnc-03-a",
      tabletCode: "TAB-CNC-03-A",
      stationId: "st-cnc-03",
      deviceName: "CNC-03 tablet A",
      currentIp: "10.201.134.202",
      lastSeenAt: "2026-05-14T08:10:00+08:00",
      deviceStatus: "active"
    },
    {
      tabletId: "tb-cnc-02-a",
      tabletCode: "TAB-CNC-02-A",
      stationId: "st-cnc-02",
      deviceName: "CNC-02 tablet A",
      currentIp: "10.201.134.203",
      lastSeenAt: "2026-05-14T08:05:00+08:00",
      deviceStatus: "active"
    }
  ];

  var operators = [
    {
      operatorId: "op-cnc-01",
      operatorCode: "OP-CNC-01",
      operatorName: "CNC Operator 01",
      role: "operator",
      isActive: true
    },
    {
      operatorId: "op-qc-01",
      operatorCode: "OP-QC-01",
      operatorName: "QC Inspector 01",
      role: "inspector",
      isActive: true
    },
    {
      operatorId: "op-sup-01",
      operatorCode: "SUP-01",
      operatorName: "Shop Supervisor 01",
      role: "supervisor",
      isActive: true
    }
  ];

  var workOrders = [
    {
      workOrderId: "wo-1001",
      workOrderNo: "MO-MOCK-1001",
      customerName: "Demo Customer A",
      partNo: "PT-CNC-AXLE-01",
      partName: "Demo shaft part",
      plannedQty: 120,
      dueDate: "2026-05-14",
      status: "active",
      sourceType: "Mock"
    },
    {
      workOrderId: "wo-1003",
      workOrderNo: "MO-MOCK-1003",
      customerName: "Demo Customer C",
      partNo: "PT-CNC-PLATE-03",
      partName: "Demo delayed plate",
      plannedQty: 60,
      dueDate: "2026-05-13",
      status: "delayed",
      sourceType: "Mock"
    },
    {
      workOrderId: "wo-1005",
      workOrderNo: "MO-MOCK-1005",
      customerName: "Demo Customer E",
      partNo: "PT-CNC-HOUSING-05",
      partName: "Demo inspection housing",
      plannedQty: 40,
      dueDate: "2026-05-14",
      status: "waiting_inspection",
      sourceType: "Mock"
    }
  ];

  var operations = [
    {
      operationId: "opn-1001-20",
      workOrderId: "wo-1001",
      operationNo: "20",
      operationName: "CNC finishing",
      stationId: "st-cnc-03",
      sequence: 20,
      plannedQty: 120,
      status: "in_progress"
    },
    {
      operationId: "opn-1003-10",
      workOrderId: "wo-1003",
      operationNo: "10",
      operationName: "CNC roughing",
      stationId: "st-cnc-02",
      sequence: 10,
      plannedQty: 60,
      status: "abnormal"
    },
    {
      operationId: "opn-1005-30",
      workOrderId: "wo-1005",
      operationNo: "30",
      operationName: "Inspection",
      stationId: "st-inspect-01",
      sequence: 30,
      plannedQty: 40,
      status: "waiting_inspection"
    }
  ];

  var workSessions = [
    {
      sessionId: "sess-cnc-03-active",
      workOrderId: "wo-1001",
      operationId: "opn-1001-20",
      stationId: "st-cnc-03",
      machineId: "mc-cnc-03",
      operatorId: "op-cnc-01",
      startTime: "2026-05-14T08:00:00+08:00",
      endTime: null,
      status: "IN_PROGRESS"
    },
    {
      sessionId: "sess-cnc-02-abnormal",
      workOrderId: "wo-1003",
      operationId: "opn-1003-10",
      stationId: "st-cnc-02",
      machineId: "mc-cnc-02",
      operatorId: "op-cnc-01",
      startTime: "2026-05-14T08:20:00+08:00",
      endTime: null,
      status: "ABNORMAL"
    }
  ];

  var reportRecords = [
    {
      reportId: "rpt-1001-good",
      sessionId: "sess-cnc-03-active",
      workOrderId: "wo-1001",
      operationId: "opn-1001-20",
      stationId: "st-cnc-03",
      operatorId: "op-cnc-01",
      reportTime: "2026-05-14T09:00:00+08:00",
      goodQty: 40,
      defectQty: 0,
      totalQty: 40,
      reportType: "partial",
      note: "First morning report",
      sourceDeviceId: "tb-cnc-03-a",
      sourceIp: "10.201.134.202",
      status: "submitted"
    },
    {
      reportId: "rpt-1001-defect",
      sessionId: "sess-cnc-03-active",
      workOrderId: "wo-1001",
      operationId: "opn-1001-20",
      stationId: "st-cnc-03",
      operatorId: "op-cnc-01",
      reportTime: "2026-05-14T10:20:00+08:00",
      goodQty: 15,
      defectQty: 2,
      totalQty: 17,
      reportType: "partial",
      note: "Two pieces need dimension review",
      sourceDeviceId: "tb-cnc-03-a",
      sourceIp: "10.201.134.202",
      status: "submitted"
    }
  ];

  var defectRecords = [
    {
      defectId: "def-dim-ng-01",
      reportId: "rpt-1001-defect",
      defectReason: "dimension NG",
      defectQty: 1,
      severity: "high",
      note: "Outer diameter above upper tolerance"
    },
    {
      defectId: "def-tool-mark-01",
      reportId: "rpt-1001-defect",
      defectReason: "tool mark",
      defectQty: 1,
      severity: "medium",
      note: "Visible tool mark on side face"
    }
  ];

  var inspectionBatches = [
    {
      inspectionBatchId: "ib-1005-pass",
      workOrderId: "wo-1005",
      operationId: "opn-1005-30",
      stationId: "st-inspect-01",
      inspectorId: "op-qc-01",
      batchNo: "QC-MOCK-1005-A",
      inspectionTime: "2026-05-14T10:30:00+08:00",
      status: "submitted",
      summaryResult: "PASS"
    },
    {
      inspectionBatchId: "ib-1005-fail",
      workOrderId: "wo-1005",
      operationId: "opn-1005-30",
      stationId: "st-inspect-01",
      inspectorId: "op-qc-01",
      batchNo: "QC-MOCK-1005-B",
      inspectionTime: "2026-05-14T11:00:00+08:00",
      status: "submitted",
      summaryResult: "FAIL"
    }
  ];

  var inspectionItems = [
    {
      inspectionItemId: "ii-od",
      itemName: "outer diameter",
      standardValue: "25.00",
      toleranceUpper: "25.03",
      toleranceLower: "24.97",
      unit: "mm",
      requiredFlag: true,
      displayOrder: 10
    },
    {
      inspectionItemId: "ii-id",
      itemName: "inner diameter",
      standardValue: "12.00",
      toleranceUpper: "12.02",
      toleranceLower: "11.98",
      unit: "mm",
      requiredFlag: true,
      displayOrder: 20
    }
  ];

  var inspectionResults = [
    {
      inspectionResultId: "ir-pass-od",
      inspectionBatchId: "ib-1005-pass",
      inspectionItemId: "ii-od",
      measuredValue: "25.01",
      result: "within tolerance",
      okNg: "OK",
      note: "OK measured value",
      photoAttachmentId: null,
      inspectedAt: "2026-05-14T10:35:00+08:00",
      inspectorId: "op-qc-01"
    },
    {
      inspectionResultId: "ir-fail-id",
      inspectionBatchId: "ib-1005-fail",
      inspectionItemId: "ii-id",
      measuredValue: "12.05",
      result: "over upper tolerance",
      okNg: "NG",
      note: "NG measured value; rework required",
      photoAttachmentId: "att-photo-placeholder-01",
      inspectedAt: "2026-05-14T11:03:00+08:00",
      inspectorId: "op-qc-01"
    }
  ];

  var dashboardSnapshots = [
    {
      snapshotId: "dash-current-all",
      snapshotTime: "2026-05-14T11:30:00+08:00",
      stationId: null,
      activeWorkCount: 2,
      completedQty: 55,
      defectQty: 2,
      abnormalCount: 1,
      waitingInspection: 1,
      delayedCount: 1
    },
    {
      snapshotId: "dash-cnc-03",
      snapshotTime: "2026-05-14T11:30:00+08:00",
      stationId: "st-cnc-03",
      activeWorkCount: 1,
      completedQty: 55,
      defectQty: 2,
      abnormalCount: 0,
      waitingInspection: 1,
      delayedCount: 0
    }
  ];

  var auditEvents = [
    {
      auditId: "aud-station-selected",
      actionType: "STATION_SELECTED",
      actorId: "op-cnc-01",
      entityType: "Station",
      entityId: "st-cnc-03",
      timestamp: "2026-05-14T07:55:00+08:00",
      beforeState: null,
      afterState: "selected",
      sourceDeviceId: "tb-cnc-03-a",
      sourceIp: "10.201.134.202"
    },
    {
      auditId: "aud-work-started",
      actionType: "OPEN_WORK",
      actorId: "op-cnc-01",
      entityType: "WorkSession",
      entityId: "sess-cnc-03-active",
      timestamp: "2026-05-14T08:00:00+08:00",
      beforeState: "NOT_STARTED",
      afterState: "IN_PROGRESS",
      sourceDeviceId: "tb-cnc-03-a",
      sourceIp: "10.201.134.202"
    },
    {
      auditId: "aud-report-submitted",
      actionType: "REPORT_WORK",
      actorId: "op-cnc-01",
      entityType: "ReportRecord",
      entityId: "rpt-1001-good",
      timestamp: "2026-05-14T09:00:00+08:00",
      beforeState: "IN_PROGRESS",
      afterState: "REPORTED",
      sourceDeviceId: "tb-cnc-03-a",
      sourceIp: "10.201.134.202"
    },
    {
      auditId: "aud-abnormal-recorded",
      actionType: "REPORT_ABNORMAL",
      actorId: "op-cnc-01",
      entityType: "WorkSession",
      entityId: "sess-cnc-02-abnormal",
      timestamp: "2026-05-14T08:45:00+08:00",
      beforeState: "IN_PROGRESS",
      afterState: "ABNORMAL",
      sourceDeviceId: "tb-cnc-02-a",
      sourceIp: "10.201.134.203"
    },
    {
      auditId: "aud-inspection-completed",
      actionType: "INSPECTION_SUBMIT",
      actorId: "op-qc-01",
      entityType: "InspectionBatch",
      entityId: "ib-1005-fail",
      timestamp: "2026-05-14T11:00:00+08:00",
      beforeState: "pending",
      afterState: "INSPECTION_FAIL",
      sourceDeviceId: null,
      sourceIp: null
    },
    {
      auditId: "aud-export-generated",
      actionType: "EXPORT_GENERATED",
      actorId: "op-sup-01",
      entityType: "ExportRecord",
      entityId: "exp-daily-20260514",
      timestamp: "2026-05-14T17:00:00+08:00",
      beforeState: null,
      afterState: "generated",
      sourceDeviceId: null,
      sourceIp: null
    }
  ];

  window.MachTileMockData = Object.freeze({
    stations: stations,
    machines: machines,
    tabletDevices: tabletDevices,
    operators: operators,
    workOrders: workOrders,
    operations: operations,
    workSessions: workSessions,
    reportRecords: reportRecords,
    defectRecords: defectRecords,
    inspectionBatches: inspectionBatches,
    inspectionItems: inspectionItems,
    inspectionResults: inspectionResults,
    dashboardSnapshots: dashboardSnapshots,
    auditEvents: auditEvents
  });
})();
