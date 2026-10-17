-- PENDING / SOURCE ONLY. Owner applies to the formal MachTile Supabase project.
-- Do not run from the website deployment. Rollback: rollback.sql in this folder.
begin;

do $gate$
begin
  if to_regclass('public.machines') is null
     or to_regclass('public.app_users') is null
     or to_regclass('public.audit_logs') is null
     or to_regprocedure('public.current_tenant_id()') is null
     or to_regprocedure('public.current_app_role()') is null then
    raise exception 'MACHINE_HOURLY_RATE_DEPENDENCY_MISSING';
  end if;
  if to_regprocedure('public.machine_hourly_rate_admin_snapshot()') is not null
     or to_regprocedure('public.machine_hourly_rate_admin_set(uuid,numeric)') is not null then
    raise exception 'MACHINE_HOURLY_RATE_RPC_ALREADY_EXISTS';
  end if;
end
$gate$;

create function public.machine_hourly_rate_admin_caller()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_role text := public.current_app_role();
  v_actor record;
  v_actor_count integer;
begin
  if v_uid is null or v_tenant is null or v_role is distinct from 'admin' then raise exception 'FORBIDDEN'; end if;
  select count(*) into v_actor_count from public.app_users a
  where a.auth_user_id=v_uid and a.tenant_id=v_tenant and a.is_active=true and a.role::text='admin';
  if v_actor_count<>1 then raise exception 'FORBIDDEN'; end if;
  select a.id,a.name,a.account into v_actor
  from public.app_users a
  where a.auth_user_id=v_uid and a.tenant_id=v_tenant and a.is_active=true and a.role::text='admin';
  if not found then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('tenant_id',v_tenant,'app_user_id',v_actor.id,'name',v_actor.name,'account',v_actor.account);
end
$function$;
revoke all on function public.machine_hourly_rate_admin_caller() from public,anon,authenticated,service_role;

create function public.machine_hourly_rate_admin_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_caller jsonb := public.machine_hourly_rate_admin_caller();
  v_tenant uuid := (v_caller->>'tenant_id')::uuid;
  v_machines jsonb;
  v_history jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'machine_code',m.machine_code,'name',m.name,'hourly_rate',m.hourly_rate)
    order by m.display_order,m.machine_code),'[]'::jsonb)
  into v_machines from public.machines m where m.tenant_id=v_tenant;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',x.id,'machine_code',x.after_data->>'machine_code','old_rate',x.before_data->'hourly_rate',
      'new_rate',x.after_data->'hourly_rate','actor_name',coalesce(a.name,a.account),'actor_account',a.account,'changed_at',x.created_at)
    order by x.created_at desc),'[]'::jsonb)
  into v_history
  from (select l.* from public.audit_logs l
        where l.tenant_id=v_tenant and l.action='machine.hourly_rate' and l.entity_type='machine'
        order by l.created_at desc limit 30) x
  left join public.app_users a on a.id=x.actor_user_id and a.tenant_id=v_tenant;
  return jsonb_build_object('machines',v_machines,'history',v_history);
end
$function$;
revoke all on function public.machine_hourly_rate_admin_snapshot() from public,anon,authenticated,service_role;
grant execute on function public.machine_hourly_rate_admin_snapshot() to authenticated;

create function public.machine_hourly_rate_admin_set(p_machine_id uuid,p_hourly_rate numeric)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_caller jsonb := public.machine_hourly_rate_admin_caller();
  v_tenant uuid := (v_caller->>'tenant_id')::uuid;
  v_machine record;
  v_changed boolean;
begin
  if p_machine_id is null or p_hourly_rate is null or p_hourly_rate<=0 or p_hourly_rate>100000
     or round(p_hourly_rate,2)<>p_hourly_rate then raise exception 'INVALID_HOURLY_RATE'; end if;
  select m.id,m.machine_code,m.name,m.hourly_rate into v_machine
  from public.machines m where m.id=p_machine_id and m.tenant_id=v_tenant for update;
  if not found then raise exception 'MACHINE_NOT_FOUND'; end if;
  v_changed := v_machine.hourly_rate is distinct from p_hourly_rate;
  if v_changed then
    update public.machines set hourly_rate=p_hourly_rate,updated_at=clock_timestamp()
    where id=v_machine.id and tenant_id=v_tenant;
    insert into public.audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
    values(v_tenant,(v_caller->>'app_user_id')::uuid,'machine.hourly_rate','machine',v_machine.id,
      jsonb_build_object('machine_code',v_machine.machine_code,'hourly_rate',v_machine.hourly_rate),
      jsonb_build_object('machine_code',v_machine.machine_code,'hourly_rate',p_hourly_rate));
  end if;
  return jsonb_build_object('machine_id',v_machine.id,'machine_code',v_machine.machine_code,
    'old_rate',v_machine.hourly_rate,'new_rate',p_hourly_rate,'changed',v_changed);
end
$function$;
revoke all on function public.machine_hourly_rate_admin_set(uuid,numeric) from public,anon,authenticated,service_role;
grant execute on function public.machine_hourly_rate_admin_set(uuid,numeric) to authenticated;

commit;
notify pgrst,'reload schema';
