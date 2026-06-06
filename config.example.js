// Copy this file to config.js and fill values for Supabase Cloud.
// Do not commit real service role keys into frontend code.
window.MACHTILE_CONFIG = {
  // "dev-nologin" (default when omitted) = public demo, fully anonymous.
  // "strict" = production: app-level login gate, all reads/writes use the
  // signed-in session. See config.production.example.js.
  authMode: "dev-nologin",
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  tenantId: "00000000-0000-0000-0000-000000000001",
  reportAttachmentBucket: "machtile-report-files",
  enableFileUpload: true,
  // Optional. Set this to a phone-reachable URL for machine QR codes.
  // Examples:
  //   http://192.168.1.23:4173/
  //   https://dev.machtile.com/
  //   https://holaadam-tw.github.io/machtile-mini-mes/
  fieldReportBaseUrl: "",
  // Keep true for static hosts without SPA route fallback.
  // QR will use /?route=/m/report&machine=CNC-01 instead of /m/report?machine=CNC-01.
  useQueryRoutesForFieldReports: true,
  useSupabase: false
};
