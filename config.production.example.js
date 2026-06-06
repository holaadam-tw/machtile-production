// Production config template for the MachTile strict UI track (Gate P / P2).
// Copy to config.js on the production host and fill the production project
// values (the project itself is created in Gate P / P3). The anon key is the
// public API key only — production grants it ZERO table/RPC access (P1 strict
// bundle); every read/write goes through the signed-in session Bearer.
// Never put service-role or other privileged keys here.
window.MACHTILE_CONFIG = {
  // Strict mode: app-level login gate before any route; planner/supervisor/
  // station accounts per Gate P P_AUTH_MODEL=AllAuthenticated.
  authMode: "strict",
  supabaseUrl: "https://YOUR_PRODUCTION_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_PRODUCTION_SUPABASE_ANON_KEY",
  tenantId: "YOUR_PRODUCTION_TENANT_ID",
  reportAttachmentBucket: "machtile-report-files",
  enableFileUpload: true,
  fieldReportBaseUrl: "https://your-production-host.example.com/",
  useQueryRoutesForFieldReports: true,
  useTenantHeaderAuth: true,
  useSupabase: false,
  useHmcWorklistSupabase: true
};
