-- 031 — Correct loyalty-lite's packaged functions.
--
-- 030 seeded the plugin's second file with a function named `..._top` while
-- the plugin itself calls `totals` — the bridge derives the SQL name from the
-- plugin key, so the two have to agree. Caught by reading the pair together
-- rather than by running it; nothing had applied 030's file yet, so this only
-- rewrites the package.
--
-- The rewritten file also returns the shape the plugin's screens read in one
-- call (`accounts`, `points`, `top`), which is why the plugin needs one RPC and
-- not three.

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

create or replace function public.loyalty_lite_totals(
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
  v_limit integer := least(greatest(coalesce((p_args ->> 'limit')::integer, 10), 1), 200);
  v_accounts integer;
  v_points bigint;
  v_top jsonb;
begin
  if not (app.in_org(p_organization_id) and app.has_permission('loyalty-lite.view')) then
    raise exception 'permission_denied: loyalty-lite.view' using errcode = '42501';
  end if;

  select count(*)::integer, coalesce(sum(a.points), 0)::bigint
    into v_accounts, v_points
    from public.plg_loyalty_lite_accounts a
   where a.organization_id = p_organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'customer_id', t.customer_id,
           'customer', t.name,
           'points', t.points,
           'lifetime_points', t.lifetime_points) order by t.points desc, t.name), '[]'::jsonb)
    into v_top
    from (
      select a.customer_id, c.name, a.points, a.lifetime_points
        from public.plg_loyalty_lite_accounts a
        join public.customers c on c.id = a.customer_id
       where a.organization_id = p_organization_id
       order by a.points desc, c.name
       limit v_limit
    ) t;

  return jsonb_build_object('accounts', v_accounts, 'points', v_points, 'top', v_top);
end
$lfn$;

drop function if exists public.loyalty_lite_top(uuid, jsonb);

grant execute on function public.loyalty_lite_award(uuid, jsonb) to authenticated;
grant execute on function public.loyalty_lite_totals(uuid, jsonb) to authenticated;
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
