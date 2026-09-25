-- 040 — the guard has to sit on the function the app actually calls.
--
-- 038 meant to replace `public.plugin_enable`, but its third statement said
-- `app.plugin_enable` — so the database ended up with a second copy of the
-- function in the private schema (unreachable, since nothing calls it) while
-- the public one kept the old, name-only tenancy check. A package could still
-- install a table called anything it liked. The validator's deliberately-bad
-- plugin is what surfaced it: it enabled successfully.
--
-- This replaces the real function with the guarded one and removes the stray
-- copy, so there is exactly one `plugin_enable` again.

drop function if exists app.plugin_enable(uuid, text, text, jsonb);

create or replace function public.plugin_enable(
  p_organization_id uuid,
  p_plugin_key text,
  p_version text,
  p_config jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_shipped text;
  v_applied integer;
  v_permissions integer;
  v_row record;
  v_before text[];
  v_after text[];
  v_created text[];
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('plugins.manage');

  v_shipped := app.plugin_package_version(p_plugin_key);
  if v_shipped is null then
    raise exception 'unknown_plugin: %', p_plugin_key using errcode = 'P0001';
  end if;

  if p_version is not null and p_version <> v_shipped then
    raise exception 'plugin_version_mismatch: server has %, client offered %',
      v_shipped, p_version using errcode = 'P0001';
  end if;

  if p_config is not null and jsonb_typeof(p_config) <> 'object' then
    raise exception 'plugin_config_invalid: expected an object' using errcode = 'P0001';
  end if;

  v_before := app.plugin_tables();
  v_applied := app.plugin_apply_migrations(p_organization_id, p_plugin_key);
  v_after := app.plugin_tables();
  v_created := array(select t from unnest(v_after) t where t <> all (v_before));

  perform app.plugin_assert_plugin_schema(p_plugin_key, v_created);
  v_permissions := app.plugin_ensure_permissions(p_plugin_key);

  insert into public.plugins
        (organization_id, plugin_key, version, enabled, config, status,
         last_error, enabled_at, enabled_by)
  values (p_organization_id, p_plugin_key, v_shipped, true,
          coalesce(p_config, '{}'::jsonb), 'ok', null, now(), auth.uid())
  on conflict (organization_id, plugin_key) do update
     set enabled    = true,
         version    = excluded.version,
         status     = 'ok',
         last_error = null,
         config     = case when excluded.config = '{}'::jsonb
                           then public.plugins.config else excluded.config end,
         enabled_at = now(),
         enabled_by = auth.uid()
  returning * into v_row;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (p_organization_id, 'plugin.enabled', 'plugin', v_row.id,
          jsonb_build_object('plugin_key', p_plugin_key,
                             'version', v_shipped,
                             'migrations_applied', v_applied));

  return jsonb_build_object(
    'plugin_key', p_plugin_key,
    'version', v_shipped,
    'enabled', true,
    'migrations_applied', v_applied,
    'permissions', v_permissions
  );
end
$fn$;
