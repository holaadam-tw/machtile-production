// MachTile PRODUCTION config (Gate P / P3, 2026-06-06).
// Committed by design: the anon key is the public API key only — production
// grants it ZERO table/RPC access (P1 strict bundle); every read/write goes
// through the signed-in session Bearer + RLS. Never put service-role or
// other privileged keys here.
window.MACHTILE_CONFIG = {
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
  useTenantHeaderAuth: true,
  useSupabase: true,
  useHmcWorklistSupabase: true,
  // CNC 現場報工 offline outbox (2026-07-11 flag-on gate): submitReport goes
  // through the offline-first idempotent outbox seam (DB side = migrations
  // 202607110001–0003, applied). Rollback = set false (direct POST path).
  enableOutboxSubmit: true,
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
  stationCommandMachines: ["A04"],
  // Stage-2 智慧報工獨立開關；預設關，關時批次報工沿用既有流程且不讀雲端防呆設定。
  enableStationReport: false,
  stationReportMachines: ["A04"],
};
