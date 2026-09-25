-- 030 — loyalty-lite's second migration file: the plugin's own functions.
--
-- A plugin's SQL is not limited to tables. These two functions are what
-- `public.plugin_rpc` reaches — the plugin's own namespace, its own permission
-- checks, its own rules. Two files also prove the runner applies a package in
-- order and records each file separately, which is what makes the checksum
-- check meaningful.

do $seed$
declare
  v_sql text := $plg$
create or replace function public.loyalty_lite_award(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $lfn$
declare
  v_customer uuid := nullif(p_args ->> 'customer_id', '')::uuid;
  v_points integer := coalesce((p_args ->> 'points')::integer, 0);
  v_row public.plg_loyalty_lite_accounts;
begin
  if not (app.in_org(p_organization_id) and app.has_permission('loyalty-lite.manage')) then
    raise exception 'permission_denied: loyalty-lite.manage' using errcode = '42501';
  end if;

  if v_customer is null or v_points = 0 then
    raise exception 'loyalty_lite_invalid_args: customer_id and a non-zero points value are required'
      using errcode = 'P0001';
  end if;

  insert into public.plg_loyalty_lite_accounts
        (organization_id, customer_id, points, lifetime_points)
  values (p_organization_id, v_customer, greatest(v_points, 0), greatest(v_points, 0))
  on conflict (organization_id, customer_id) do update
     set points          = public.plg_loyalty_lite_accounts.points + v_points,
         lifetime_points = public.plg_loyalty_lite_accounts.lifetime_points + greatest(v_points, 0),
         updated_at      = now()
  returning * into v_row;

  return jsonb_build_object(
    'customer_id', v_customer,
    'points', v_row.points,
    'lifetime_points', v_row.lifetime_points
  );
end
$lfn$;

create or replace function public.loyalty_lite_top(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $lfn$
declare
  v_limit integer := least(greatest(coalesce((p_args ->> 'limit')::integer, 10), 1), 100);
begin
  if not (app.in_org(p_organization_id) and app.has_permission('loyalty-lite.view')) then
    raise exception 'permission_denied: loyalty-lite.view' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'customer_id', a.customer_id,
             'customer', c.name,
             'points', a.points,
             'lifetime_points', a.lifetime_points) order by a.points desc, c.name)
      from public.plg_loyalty_lite_accounts a
      join public.customers c on c.id = a.customer_id
     where a.organization_id = p_organization_id
     limit v_limit
  ), '[]'::jsonb);
end
$lfn$;

grant execute on function public.loyalty_lite_award(uuid, jsonb) to authenticated;
grant execute on function public.loyalty_lite_top(uuid, jsonb) to authenticated;
$plg$;
begin
  insert into public.plugin_package_migrations
        (plugin_key, filename, version, ordinal, checksum, sql)
  values ('loyalty-lite', '002_functions.sql', '1.0.0', 2, md5(v_sql), v_sql)
  on conflict (plugin_key, filename) do update
     set version = excluded.version,
         ordinal = excluded.ordinal,
         checksum = excluded.checksum,
         sql = excluded.sql;
end
$seed$;
