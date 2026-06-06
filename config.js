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
  useHmcWorklistSupabase: true
};
