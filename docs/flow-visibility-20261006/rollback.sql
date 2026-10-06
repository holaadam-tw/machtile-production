-- Rollback for migration.sql. After rollback the app reads 404 and falls back to `full` for every role.
begin;
drop function if exists public.tenant_display_settings_upsert(jsonb);
drop table if exists public.tenant_display_settings;
notify pgrst, 'reload schema';
commit;
