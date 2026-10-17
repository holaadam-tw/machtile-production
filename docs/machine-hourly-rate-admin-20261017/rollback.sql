-- Owner-run rollback. This removes only the two public RPCs and private caller.
begin;
drop function if exists public.machine_hourly_rate_admin_set(uuid,numeric);
drop function if exists public.machine_hourly_rate_admin_snapshot();
drop function if exists public.machine_hourly_rate_admin_caller();
commit;
notify pgrst,'reload schema';
