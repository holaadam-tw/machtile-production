// MachTile PRODUCTION config (Gate P / P3, 2026-06-06).
// Committed by design: the anon key is the public API key only — production
// grants it ZERO table/RPC access (P1 strict bundle); every read/write goes
// through the signed-in session Bearer + RLS. Never put service-role or
// other privileged keys here.
window.MACHTILE_CONFIG = {
  cardQtyInstantEnabled: true,
  enableOutsourceStatusStrip: false,
  orderDetailSimplifyEnabled: true,
  cardCycleTimeWithoutStartEnabled: true,
  dailyStartWhenRunningEnabled: true,
  dailyStartButtonInstantHideEnabled: true,
  overtimeStartButtonEnabled: true,
  overtimePromptEnabled: false,
  overtimeNoStartEnabled: false,
  shiftEndTime: "17:00",
  overtimeStartTime: "17:30", // Must stay aligned with Factory appsettings.FactoryPilot.json OvertimeStartTime.
  // Strict mode: app-level login gate before any route; planner/supervisor/
  // station accounts per Gate P P_AUTH_MODEL=AllAuthenticated.
  authMode: "strict",
  supabaseUrl: "https://muditjubqflrqofbkmav.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11ZGl0anVicWZscnFvZmJrbWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NDY1MTMsImV4cCI6MjA5NjMyMjUxM30.IDu3invnMuWKZzzplI1Kd03HsC4Be6EAxS6D_xmezGI",
  tenantId: "a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f",
  reportAttachmentBucket: "machtile-report-files",
  enableFileUpload: true,
  fieldReportBaseUrl: "https://app.machtile.com/",
  useQueryRoutesForFieldReports: true,
  enableMachineCapabilityDualRead: false,
  useTenantHeaderAuth: true,
  useSupabase: true,
  useHmcWorklistSupabase: true,
  // CNC 現場報工 offline outbox (2026-07-11 flag-on gate): submitReport goes
  // through the offline-first idempotent outbox seam (DB side = migrations
  // 202607110001–0003, applied). Rollback = set false (direct POST path).
  enableOutboxSubmit: true,
  // 查證並以同一 command_uuid 安全補送不確定報工；驗證後再由 owner 開啟。
  enableReportUncertainRecover: false,
  reportAutoCloseOnSuccess: true,
  // Schedule foundation and capacity calendar are present and verified in Production.
  enableScheduleContracts: true,
  // 202607160005 is present and passed the Production rollback smoke.
  enableCalibrationGovernance: true,
  // 202607160006 is present and passed the Production rollback smoke.
  enableManufacturingQuoteTracking: true,
  // Unified login (Login Center SSO). Phase A ships the code dormant:
  // password login stays the only path until oauthEnabled flips to true
  // with the registered production public client id (Phase C).
  // Break-glass for users after the flip: https://app.machtile.com/?legacyLogin=1
  oauthEnabled: true,
  oauthClientId: "365b1a41-08b4-43bb-9500-5f0f115f5580",
  oauthAuthorizationEndpoint: "https://muditjubqflrqofbkmav.supabase.co/auth/v1/oauth/authorize",
  oauthTokenEndpoint: "https://muditjubqflrqofbkmav.supabase.co/auth/v1/oauth/token",
  oauthRedirectUri: "https://app.machtile.com/",
  oauthScope: "openid email profile",
  // Stage 2 central-access gate: this deployment's tag in the per-account
  // app_metadata.systems list managed at login.machtile.com/admin/users.
  // Accounts whose list exists but excludes "cloud" are refused here.
  oauthSystemTag: "cloud",
  // Jev triage (2026-09-24): after an 異常 report the tablet asks the jev-triage Edge Function
  // for a SUGGESTION (who should look, how urgent) and shows it as a chip on the 紀錄 page.
  // Never notifies or assigns. Turn on only after `supabase functions deploy jev-triage`,
  // the AI_GATEWAY_API_KEY secret and migration 20260924143000 are in place.
  enableJevTriage: false,
  // 員工帳號管理 (2026-09-29): true = ask the am-list-user-usage Edge Function which accounts
  // may be deleted (never signed in + no records; the server re-checks in am-delete-user) and
  // show the face-enrolment counts. Turn on only after machtile-mini-mes migration
  // 20260929120000_account_usage_and_delete is applied and am-list-user-usage + am-delete-user
  // are deployed. false = no delete button and no counts (sorting/colours still apply).
  enableAccountDelete: false,
  // 📷 人臉登記 button on active operator rows → the Login Center enrolment page (live since
  // 2026-09-16; ?account= highlights the person once login-center carries that change).
  // Empty string hides the button.
  faceAdminUrl: "https://login.machtile.com/admin/face",
  // 人臉「已登記 N 張／未登記」(owner 2026-09-30): its own switch, independent of
  // enableAccountDelete. true = ask the read-only am-list-user-usage Edge Function for the counts.
  // Not deployed / fails → the badge shows 「—」 (tooltip: 狀態暫時讀不到); nothing else changes.
  enableFaceStatus: true,
  // 機台卡片「開工／停工」回寫舊 MES（2026-10-07 第 1 階段）。機台代號陣列，例 ["A04"]；["*"]＝全部。
  // 空＝全部機台關。開之前要先有：machtile-mini-mes 的 station_commands migration 已套正式庫、
  // 工廠套用端（Factory 背景服務）已部署且開關打開。表或 RPC 不存在時按鈕會自動藏起來。
  stationCommandMachines: ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"],
  // station_commands Realtime publication 尚未在正式庫啟用；開啟後仍保留輪詢備援。
  enableStationCommandRealtime: false,
  // 派工池接單：全部車床 A01–A05＋全部加工中心 B01–B06（2026-10-14 owner「池開加工中心」）。
  dispatchPoolMachines: ["A01", "A02", "A03", "A04", "A05", "B01", "B02", "B03", "B04", "B05", "B06"],
  // machines / v_machine_management_cards 尚未同步舊 MES Station_Type；machine_type 不是多工能力。
  // 因此明列已由 Factory MachTileDispatchAssign 證實可多工的 B01–B06，其餘一律 single（fail closed）。
  multiStationMachines: ["B01", "B02", "B03", "B04", "B05", "B06"],
  // I-Reporter process-record entry on machine cards. Empty is the safe default.
  inspectionLinkMachines: [],
  // 2026-10-15 owner：機台卡「完工」鍵（完工＝收工；PR #103）。
  enableFinishButton: true,
  // 完工報工 applied 後自動派關站；本包只佈建，不開正式旗標。
  enableFinishClose: true,
  // 關站送出後擋住全畫面，避免等待 Factory 時再按完工或停工。
  enableFinishOverlay: true,
  finishCloseMachines: ["A01", "A02", "A03", "A04", "A05", "B03", "B04", "B05", "B06"],
  // 短交完工：cloud 與 Factory 皆驗證；預設關，僅明列機台可顯示與送出。
  enableShortCompletion: true,
  shortCompletionMachines: ["A01", "A02", "A03", "A04", "A05", "B03", "B04", "B05", "B06", "F01", "G01"],
  // 標準完工下一步流程：預設關；待 cloud + Factory flags 都驗證後另行開啟。
  enableStandardFinishFlow: true,
  standardFinishFlowMachines: ["A01", "A02", "A03", "A04", "A05", "B03", "B04", "B05", "B06"],
  // 完工後「接並開工」一顆鈕：owner 2026-10-26 拍板拿掉（選工單≠開工），改兩下：先接、再按開工。
  enableFinishClaimStartCombo: false,
  finishClaimStartComboMachines: [],
  // 換機台第一版先保持關閉；雲端 RPC 與 Factory 同步開通後再指定機台。
  enableTakeover: true,
  takeoverMachines: ["A01", "A02", "A03", "A04", "A05"],
  // 選工單／開工分開（owner 2026-10-26）：沒掛單只出「選工單」、掛了單未開工只出「開工」、已開工出「報工／停工／完工」、
  // 停工中（雲端 status=paused）只出「開工」接回＋「完工」。
  // ⚠️ enableTakeover 與 enablePickStartFlow 必須一起開（機台名單也要一致）：空機台接手只剩「選工單→舊工單」這個入口；
  // ⚠️ 而且要等雲端「開工 applied 把工序 status 改 running、寫 actual_start_at」那包上線後才能開，
  //    否則重新整理後已開工的單會被當成未開工（卡片只剩「開工」、不能報工）。
  enablePickStartFlow: true,
  // 開工計數高於系統已報時，開工 applied 後沿用卡片報工路徑補報差額。
  startBackfillEnabled: true,
  reportTotalSemanticsEnabled: true,
  reportBackgroundPreviewEnabled: true,
  reportCounterMetaRpcEnabled: false,
  reportQtyJumpWarnEnabled: true,
  homeOvertimeCardEnabled: true,
  overtimeStartCardEnabled: false,
  pickStartFlowMachines: ["A01", "A02", "A03", "A04", "A05"],
  inspectionLinkBaseUrl: "https://holaadam-tw.github.io/I-Reporter/",
  // Stage-2 智慧報工獨立開關；預設關，關時批次報工沿用既有流程且不讀雲端防呆設定。
  enableStationReport: true,
  // G01 比上一站多報時要求選理由；先保持關閉，開啟前須確認 Factory 合約已上線。
  enableOverPreviousReasonPrompt: false,
  outsourceReceiptDialogEnabled: true,
  // 缺委外單先報工確認：APP/Factory 兩端皆驗證後才開；關閉時不增加任何確認 UI。
  enableMissingDoc4DeferAck: false,
  stationReportMachines: ["A01", "A02", "A03", "A04", "A05", "B03", "B04", "B05", "B06"],
  // 組裝站平板報工（owner 2026-10-31）：依客戶開。旗標仍關；開的時候只有這些租戶（大正正式）看得到。
  assemblyReportEnabled: true,
  assemblyReportTenants: ["a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f"],
  // 組裝站多人報工送雲端（p_operator_app_user_ids）。雲端 migration 20261101090000 套到正式庫之前必須保持 false，
  // 否則報工會找不到函式（送不出去）。false＝送出內容跟今天一模一樣。
  assemblyMultiOperatorCommandEnabled: false,
  assemblyStations: ["F01", "G01", "H01"],
  // 完工關站另行控管；H01 是最後一道，仍由生管在舊 MES 關站。
  assemblyCloseStations: ["F01", "G01"],
  assemblyDefectStations: ["G01"],
  assemblyDefectReasons: [],
  // 機台卡片「接錯了，退回」（作業員退回自己接、還沒開工的單；CONTRACT-P2）。預設關。
  // 開之前要先有：雲端 migration 20261112200000 已套、Factory 套用端支援 return_claim、雲端 return_claim_enabled=true。
  enableReturnClaim: false,
  // 機台卡片「換道次」（同一張工單換成待做池裡另一道：先退回現在這一道，再接選的那一道）。預設關。
  // enableReturnClaim 也要開才有效；開之前還要先有：工廠把同一張工單沒做完的道次都放進待做池。
  enableSwitchStep: false,
  // 換道次（已開工、還沒報工；第 2 階段 switch_step 指令，工廠一個交易做完）。預設關；跟上面的 enableSwitchStep 分開，也不需要 enableReturnClaim。
  // 換道次 第 2 階段開之前要先有：雲端 migration 20261114090000 已套＋switch_step_enabled=true、工廠 SwitchStepApplierEnabled＋機台名單。
  enableSwitchStepStarted: true,
  // B01/B02 卡片六盤料號推算；預設關閉，僅讀既有 hmc_fixed_read。
  enableHmcPalletCard: true,
  enableHmcPalletStrip: true,
  hmcPalletCardMachines: ["B01", "B02"],
  // B01/B02 盤號條「現在在做」（第 2 包）：預設關；關＝不產生新畫面、不呼叫新 RPC。開之前雲端 migration 20261126090000 要先套。
  enableHmcPalletDoing: false,
  hmcPalletDoingMachines: ["B01", "B02"],
  // 生管把「無單在做」總數歸入工單；雲端合約上線前保持 false。
  enableHmcNoOrderMerge: false,
  hmcNoOrderMergeMachines: ["B01", "B02"],
  hmcPalletMap: {
    B01: {
      1: [
        { partNos: ["BG-03-01"], label: "BG-03本體" },
        { partNos: ["SF-03-01"], label: "SF-03本體" },
        { partNos: ["SKF-03-01"], label: "SKF-03本體" },
      ],
      2: [
        { partNos: ["A37-R01-04"], label: "A37搖籃" },
        { partNos: ["A56-R01-03"], label: "A56搖籃" },
        { partNos: ["A16-R01-04"], label: "A16／A22搖籃" },
        { partNos: ["CPDG-06-01", "CPDG-06-01(新型)"], label: "CPDG-06", default: true },
        { partNos: ["HG-06-01"], label: "HG-06", default: false },
        { partNos: ["MPW-01-01"], label: "MPW-01", dual: true, sharedWith: 5 },
        { partNos: ["MSW-01-01", "MSW-01Y-01"], label: "MSW-01／MSW-01-Y", dual: true, sharedWith: 5 },
      ],
      3: [{ partNos: ["DSHG-04-01"], label: "DSHG-04中座體(小流量)" }],
      4: [
        { partNos: ["CPDG-03-01"], label: "CPDG-03" },
        { partNos: ["CPDG-06-01", "CPDG-06-01(新型)"], label: "CPDG-06", default: false },
        { partNos: ["HCG-06-01"], label: "HCG-06" },
        { partNos: ["HG-06-01"], label: "HG-06", default: true },
      ],
      5: [
        { partNos: ["A16-R01-01"], label: "A16本體" },
        { partNos: ["AR16-R01-01"], label: "AR16/AR22泵浦本體" },
        { partNos: ["MPW-01-01"], label: "MPW-01", dual: true, sharedWith: 2 },
        { partNos: ["MSW-01-01", "MSW-01Y-01"], label: "MSW-01／MSW-01-Y", dual: true, sharedWith: 2 },
        { partNos: ["SF-06-01", "SF-06(內內)-01", "SF-06(外外)-01"], label: "SF-06本體(內外／內內／外外)" },
        { partNos: ["SF-06T-01"], label: "SF-06T本體" },
        { partNos: ["THF-06-01"], label: "THF-06本體" },
      ],
      6: [
        { partNos: ["BG-06-01"], label: "BG-06本體" },
        { partNos: ["DSHG-04-02"], label: "DSHG-04中座平蓋" },
        { partNos: ["MCA-06-01"], label: "MCA-06本體" },
      ],
    },
    B02: {
      1: [
        { partNos: ["EDG-01-01"], label: "EDG-01本體" },
        { partNos: ["SBG-03(06)-02-L"], label: "SBG-03(06)側蓋-L", dual: true, sharedWith: 5 },
        { partNos: ["SBG-03(06)-02-R"], label: "SBG-03(06)側蓋-R", dual: true, sharedWith: 5 },
        { partNos: ["SBP-03(06)-02"], label: "SBP-03(06)側蓋" },
        { partNos: ["SBSG-03(06)-01-L"], label: "SBSG-03(06)長蓋-L(比例)" },
        { partNos: ["SBSG-03(06)-01-PT-1"], label: "SBSG-03(06)長蓋-L(PT)" },
        { partNos: ["SBSG-03(06)-01-2B2"], label: "SBSG-03(06)長蓋-R(2B2)", dual: true, sharedWith: 5 },
        { partNos: ["SBSG-03(06)-01-R"], label: "SBSG-03(06)長蓋-R(比例)", dual: true, sharedWith: 5 },
        { partNos: ["SBSG-03(06)-01-PT"], label: "SBSG-03(06)長蓋-R(PT)", dual: true, sharedWith: 5 },
      ],
      2: [
        { partNos: ["DG-01-01"], label: "DG-01本體", dual: true, sharedWith: 6 },
        { partNos: ["DT-02-01"], label: "DT-02本體", dual: true, sharedWith: 6 },
        { partNos: ["EFBG-03-01"], label: "EFBG-03本體" },
        { partNos: ["MPW-01-01"], label: "MPW-01本體" },
      ],
      3: [
        { partNos: ["SBG-03-01"], label: "SBG-03本體" },
        { partNos: ["AR16-R01-04"], label: "AR16九孔座" },
        { partNos: ["AR22-R01-01"], label: "AR22九孔座", dual: true, sharedWith: 6 },
        { partNos: ["CPDG-03-02"], label: "CPDG-03平蓋(小孔)" },
        { partNos: ["CPDG-03-03"], label: "CPDG-03平蓋(大孔)" },
        { partNos: ["HCG-03-03-01"], label: "HCG-03平蓋(大孔Φ8)" },
        { partNos: ["HCG-03-03"], label: "HCG(HG)-03平蓋(小孔Φ6)" },
      ],
      4: [
        { partNos: ["CPDG-06-02", "CPDG-06-03"], label: "CPDG-06平蓋(小孔/大孔)" },
        { partNos: ["HCG-03-01"], label: "HCG-03本體", dual: true, sharedWith: 5 },
        { partNos: ["HCG-06-03-1"], label: "HCG(HG)-06平蓋(大孔Φ8)" },
        { partNos: ["HG-03-01"], label: "HG-03本體", dual: true, sharedWith: 5 },
        { partNos: ["P16-R01-04A"], label: "P16九孔座-AR齒" },
        { partNos: ["P22-R01-01A"], label: "P22九孔座-AR齒" },
      ],
      5: [
        { partNos: ["HCG-03-01"], label: "HCG-03本體", dual: true, sharedWith: 4 },
        { partNos: ["HG-03-01"], label: "HG-03本體", dual: true, sharedWith: 4 },
        { partNos: ["SBG-03(06)-02-L"], label: "SBG-03(06)側蓋-L", dual: true, sharedWith: 1 },
        { partNos: ["SBG-03(06)-02-R"], label: "SBG-03(06)側蓋-R", dual: true, sharedWith: 1 },
        { partNos: ["SBSG-03(06)-01-2B2"], label: "SBSG-03(06)長蓋-R(2B2)", dual: true, sharedWith: 1 },
        { partNos: ["SBSG-03(06)-01-R"], label: "SBSG-03(06)長蓋-R(比例)", dual: true, sharedWith: 1 },
        { partNos: ["SBSG-03(06)-01-PT"], label: "SBSG-03(06)長蓋-R(PT)", dual: true, sharedWith: 1 },
      ],
      6: [
        { partNos: ["DG-01-01"], label: "DG-01本體", dual: true, sharedWith: 2 },
        { partNos: ["DG-02-01"], label: "DG-02遙控體" },
        { partNos: ["DT-01-01"], label: "DT-01遙控體" },
        { partNos: ["DT-02-01"], label: "DT-02本體", dual: true, sharedWith: 2 },
        { partNos: ["SBG-06-01"], label: "SBG-06本體" },
        { partNos: ["AR22-R01-01"], label: "AR22九孔座", dual: true, sharedWith: 3 },
      ],
    },
  },
  // 換道次（已開工）開放的機台（預設 []＝一台都沒有）；enableSwitchStepStarted 也要開，而且機台代號要在這裡才出按鈕。
  switchStepStartedMachines: ["A05"],
  // 換道次（已開工）：不在待做池的道次也列出來（標「不在待做池」）。預設關；要跟工廠 SwitchStepAllowUnpooledTarget 一起開。
  switchStepStartedAllowUnpooled: false,
  // 上一道擋住（owner 2026-11-14「照建議」；prevStepNotifyCore.js）。程式預設關；2026-11-15 起 hint／notify 兩個開（owner pack 20261115-prevstep-enable，雲端 migration 20261114170000 已套），hideLegacyReportForStationMachines 仍關。
  // enablePrevStepBlockHint：報工／關站被上一道擋時，多一句「卡在 A05（第 2 道）、請找 A05 或生管」。
  // enablePrevStepNotify：再加「通知生管」鍵＋提醒中心看板（生管以上）；開之前要先套雲端 migration 20261114170000。
  enablePrevStepBlockHint: true,
  enablePrevStepNotify: true,
  // A/B 機台已開智慧報工時，午報／完工不再退回直接寫 production_reports（只進雲端、不進舊 MES；REPORT #9）。預設關。
  hideLegacyReportForStationMachines: false,
  // 換道次（數量一起搬；第 3 階段 switch_step_preview＋switch_step 帶 expected_moved_*）：已經報過工的道次換成同一張單的另一道、已報數量一起搬過去。預設關；跟上面兩個換道次旗標分開。
  // 換道次（數量一起搬）開之前要先有：雲端 r3 migration 已套＋switch_step_move_enabled=true、工廠 SwitchStepMoveReportedEnabled＋SwitchStepMoveStations 機台名單。
  enableSwitchStepMove: false,
  // 換道次（數量一起搬）開放的機台（預設 []＝一台都沒有）；enableSwitchStepMove 也要開，而且機台代號要在這裡才出按鈕。
  switchStepMoveMachines: [],
};
