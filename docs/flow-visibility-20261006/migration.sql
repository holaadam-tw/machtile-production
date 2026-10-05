-- Proposed for a SEPARATE mini-mes PR (NOT applied by the machtile-production PR).
-- Tenant-level display settings (jsonb bag). First key: flow_visibility = { <role>: full|adjacent|next_only|hidden }.
-- Display-only: this does NOT restrict reading work_order_processes (operators need process rows to report).
-- Missing row / missing key / invalid value => the app shows `full` (today's behaviour).

begin;

create table if not exists public.tenant_display_settings (
  tenant_id  uuid primary key references public.tenants(id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.tenant_display_settings enable row level security;

drop policy if exists tenant_display_settings_select_tenant on public.tenant_display_settings;
create policy tenant_display_settings_select_tenant
on public.tenant_display_settings for select
to authenticated
using (tenant_id = public.current_tenant_id());

-- Read-only for clients; writes only through the RPC below.
revoke all on public.tenant_display_settings from anon, authenticated;
grant select on public.tenant_display_settings to authenticated;

create or replace function public.tenant_display_settings_upsert(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_fv jsonb;
  v_key text;
  v_val jsonb;
  v_row public.tenant_display_settings;
begin
  v_tenant_id := public.current_tenant_id();
  if v_tenant_id is null then
    raise exception 'tenant_id is required';
  end if;
  if not public.is_planner_or_above() then
    raise exception 'FORBIDDEN';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_PAYLOAD';
  end if;
  v_fv := p_payload -> 'flow_visibility';
  if v_fv is null or jsonb_typeof(v_fv) <> 'object' then
    raise exception 'INVALID_FLOW_VISIBILITY';
  end if;
  for v_key, v_val in select key, value from jsonb_each(v_fv) loop
    if v_key not in ('admin','manager','planner','inspector','station','operator') then
      raise exception 'INVALID_FLOW_VISIBILITY_ROLE: %', v_key;
    end if;
    if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('full','adjacent','next_only','hidden') then
      raise exception 'INVALID_FLOW_VISIBILITY_LEVEL: %', v_key;
    end if;
  end loop;

  insert into public.tenant_display_settings (tenant_id, settings, updated_at, updated_by)
  values (v_tenant_id, jsonb_build_object('flow_visibility', v_fv), now(), auth.uid())
  on conflict (tenant_id) do update
    -- merge: keep any other settings keys, replace only flow_visibility
    set settings   = public.tenant_display_settings.settings || jsonb_build_object('flow_visibility', v_fv),
        updated_at = now(),
        updated_by = auth.uid()
  returning * into v_row;

  return jsonb_build_object('action', 'saved', 'settings', v_row.settings);
end;
$$;

comment on function public.tenant_display_settings_upsert(jsonb) is
  'Planner+ upsert of tenant display settings. Payload {flow_visibility:{role:level}}; roles admin/manager/planner/inspector/station/operator; levels full/adjacent/next_only/hidden. Display only, not a data permission.';

revoke all on function public.tenant_display_settings_upsert(jsonb) from public;
grant execute on function public.tenant_display_settings_upsert(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
