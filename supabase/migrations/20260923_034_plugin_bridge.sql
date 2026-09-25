-- 029 — The two calls a plugin is allowed to make against core data.
--
-- docs/05 §4 promised plugins a narrow data surface: `ctx.db.rpc(fn, args)`,
-- scoped to the organization, with writes to stock and money going through
-- core RPCs rather than direct table access. Two functions deliver that:
--
--   * `plugin_products` — the one *read* projection. A plugin asked for an
--     expiry watch has to see products; it does not get `products.*`, it gets
--     the fields a plugin can legitimately care about, permission-checked.
--
--   * `plugin_rpc` — the one *write* path. A plugin's own SQL defines its own
--     functions; this bridge calls one of them by name, refusing anything
--     outside the plugin's namespace (`loyalty_lite_*` for `loyalty-lite`) and
--     refusing everything at all while the plugin is disabled.
--
-- Neither is `security definer` for the caller's sake: both re-check the
-- organization and the plugin's state, and the plugin function they reach does
-- its own permission check through `app.has_permission`. A plugin therefore
-- has exactly the authority its own SQL asks for and no more.

create or replace function public.plugin_products(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid := p_organization_id;
begin
  perform app.require_org(v_org);
  perform app.require_permission('products.view');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id,
             'name', p.name,
             'sku', p.sku,
             'price', p.price,
             'track_stock', p.track_stock,
             'is_active', p.is_active,
             'reorder_point', p.reorder_point,
             -- Plugin fields live in metadata (docs/05 §5), so this is the
             -- column a plugin actually reads.
             'metadata', coalesce(p.metadata, '{}'::jsonb)
           ) order by p.name)
      from public.products p
     where p.organization_id = v_org
       and p.deleted_at is null
  ), '[]'::jsonb);
end
$fn$;

/**
 * Call one of a plugin's own functions.
 *
 * `p_function` is a bare name (`award`, `top`); the namespace is derived from
 * the plugin key, so a plugin can only ever reach its own functions. Arguments
 * travel as a single jsonb object, which keeps this bridge from having to know
 * each function's signature.
 */
create or replace function public.plugin_rpc(
  p_organization_id uuid,
  p_plugin_key text,
  p_function text,
  p_args jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := p_organization_id;
  v_namespace text := replace(p_plugin_key, '-', '_');
  v_target text;
  v_result jsonb;
begin
  perform app.require_org(v_org);

  if p_function !~ '^[a-z][a-z0-9_]{0,40}$' then
    raise exception 'plugin_rpc_invalid: "%" is not a function name', p_function
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.plugins p
     where p.organization_id = v_org
       and p.plugin_key = p_plugin_key
       and p.enabled
  ) then
    raise exception 'plugin_not_enabled: %', p_plugin_key using errcode = 'P0001';
  end if;

  v_target := v_namespace || '_' || p_function;

  if not exists (
    select 1
      from pg_proc pr
      join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'public'
       and pr.proname = v_target
  ) then
    raise exception 'plugin_rpc_unknown: % does not define %', p_plugin_key, p_function
      using errcode = 'P0001';
  end if;

  execute format('select public.%I($1, $2)', v_target)
     into v_result
    using v_org, coalesce(p_args, '{}'::jsonb);

  return coalesce(v_result, 'null'::jsonb);
end
$fn$;

grant execute on function public.plugin_products(uuid) to authenticated;
grant execute on function public.plugin_rpc(uuid, text, text, jsonb) to authenticated;
