# MachTile — Production Frontend

Production deploy of the MachTile mini-MES UI (Gate P / P3, 2026-06-06).

- **Mode**: `authMode: "strict"` — a global login gate fronts every route;
  nothing loads without a signed-in session.
- **Backend**: production Supabase project `muditjubqflrqofbkmav`
  (strict-by-default: zero anon grants, RLS on every table, all writes via
  security-definer RPCs requiring authenticated roles).
- **Accounts**: planner / supervisor (manager) / per-station operator
  accounts; roles ride in JWT `app_metadata`.
- **`config.js` is committed on purpose** — it contains only public-by-design
  values (project URL, anon API key with zero grants, tenant id). No
  service-role or privileged keys exist anywhere in this repo.

Source of truth for the app code is the main development repo
([machtile-mini-mes](https://github.com/holaadam-tw/machtile-mini-mes),
`prototype/machtile-v0`); this repo holds the production copy + production
config so that demo-repo pushes can never redeploy production
(P3_FRONTEND=SecondPagesRepo).

The development repo's GitHub Pages site is a **non-production public demo**
against the separate Dev project; it is intentionally no-login.
