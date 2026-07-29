// Copy this file to config.js and fill values for Supabase Cloud.
// Do not commit real service role keys into frontend code.
window.MACHTILE_CONFIG = {
  // "dev-nologin" (default when omitted) = public demo, fully anonymous.
  // "strict" = production: app-level login gate, all reads/writes use the
  // signed-in session. See config.production.example.js.
  authMode: "dev-nologin",
  // Enable only after registering this exact staging URL as a public OAuth
  // client redirect URI in Supabase. Never add a client secret here.
  oauthEnabled: false,
  oauthClientId: "YOUR_STAGING_PUBLIC_CLIENT_ID",
  oauthAuthorizationEndpoint: "https://YOUR_PROJECT_REF.supabase.co/auth/v1/oauth/authorize",
  oauthTokenEndpoint: "https://YOUR_PROJECT_REF.supabase.co/auth/v1/oauth/token",
  oauthRedirectUri: "https://staging.machtile.com/",
  oauthScope: "openid email profile",
  // Stage 2 central-access gate tag matched against app_metadata.systems
  // ("cloud" in production, "staging" on Cloud Staging).
  oauthSystemTag: "staging",
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
  useSupabase: false,
  // CNC field-report offline outbox (default false). true routes 現場報工
  // submit through the offline-first idempotent outbox seam (needs
  // migrations 202607110001–0003 on the target DB).
  enableOutboxSubmit: false,
  // Formal capacity calendar. Overtime and Saturday work must be appended as
  // approved `exceptions` entries; do not add a daily overtime shift.
  scheduleCalendar: {
    workdays: [1, 2, 3, 4, 5],
    holidays: [],
    shifts: [{
      label: "日班",
      startMinutes: 480,
      endMinutes: 1020,
      breakRanges: [{ startMinutes: 720, endMinutes: 780 }]
    }],
    exceptions: [],
    overtimeTemplate: { startMinutes: 1050, endMinutes: 1230 },
    sourceLabel: "正式班表：週一至週五 08:00–17:00；午休 12:00–13:00；加班需主管核准"
  },
  hmcScheduleProfiles: {
    B01: { palletCount: 6, spindleCapacity: 1, externalPrepAllowed: true },
    B02: { palletCount: 6, spindleCapacity: 1, externalPrepAllowed: true }
  },
  // Conservative estimator caps based on the YCM TCV2000A published feed
  // specification. A slower machine profile remains slower than these caps.
  gcodeEstimatorLimits: {
    rapidRateMmMin: 40000,
    maxFeedRateMmMin: 10000,
    reference: "YCM TCV2000A"
  },
  // Five valid same-program + same-machine estimated/actual pairs mark the
  // historical suggestion ready; the raw G-code estimate is still retained.
  gcodeCalibration: {
    minimumSamples: 5
  },
  // Optional G-code estimator v2 machine motion profiles. Keep this in
  // deployment config until the machine master schema owns these values.
  // Missing acceleration deliberately falls back to the v1 constant-speed model.
  gcodeMachineProfiles: {
    // "B01": {
    //   accelerationMmSec2: 1000,
    //   maxFeedRateMmMin: 10000,
    //   axes: {
    //     x: { maxRateMmMin: 30000, accelerationMmSec2: 900 },
    //     y: { maxRateMmMin: 30000, accelerationMmSec2: 900 },
    //     z: { maxRateMmMin: 24000, accelerationMmSec2: 700 }
    //   }
    // }
  }
};
