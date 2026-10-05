-- SELECT-only preflight. Run before migration.sql; expected results in comments.
-- 1) Target objects must not exist yet (expect 0 rows each).
select table_name from information_schema.tables
where table_schema = 'public' and table_name = 'tenant_display_settings';
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'tenant_display_settings_upsert';

-- 2) Required helpers must exist (expect exactly 2 rows: current_tenant_id, is_planner_or_above).
select p.proname, pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('current_tenant_id', 'is_planner_or_above')
order by 1;

-- 3) No other jsonb settings bag already serves this purpose (2026-10-06 prod check: 0 rows).
select table_name, column_name from information_schema.columns
where table_schema = 'public' and data_type = 'jsonb'
  and (column_name ilike '%setting%' or column_name ilike '%config%' or column_name ilike '%option%' or column_name ilike '%pref%');

-- 4) Tenants referenced by the FK (expect >= 1).
select count(*) as tenant_count from public.tenants;
