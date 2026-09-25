-- 032 — What the *app* needs at load time, separate from what the admin screen
-- needs.
--
-- `plugin_catalog` (026) requires `plugins.view`: it lists every package the
-- server ships, with settings and migration state, which is admin material.
-- Loading the app needs far less — which installed plugins are switched on for
-- this shop, and their configuration — and a cashier must be able to load them
-- without holding `plugins.view`. Shipping the admin shape to everyone would
-- have forced either a permission check that locks cashiers out of plugin
-- screens, or a widened permission that shows everyone the admin data.

create or replace function public.plugin_state(p_organization_id uuid)
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

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', p.plugin_key,
             'version', p.version,
             'enabled', p.enabled,
             'status', p.status,
             'last_error', p.last_error,
             'config', p.config) order by p.plugin_key)
      from public.plugins p
     where p.organization_id = v_org
       and p.enabled
  ), '[]'::jsonb);
end
$fn$;

grant execute on function public.plugin_state(uuid) to authenticated;
