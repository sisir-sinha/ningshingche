-- 026 — Plugin hardening: packaged migrations, enable/disable, org-scoped data.
--
-- docs/05 §8 planned an Edge Function holding the service role to apply plugin
-- DDL. That plan is superseded here, deliberately, for three reasons:
--
--   1. §44 forbids the service role reaching the client, and an Edge Function
--      needs that key to exist somewhere in the platform's deploy pipeline.
--   2. The function would run outside the database transaction that records
--      the enablement, so a plugin could be marked enabled while its tables
--      failed to create — or the reverse. Here the DDL, the plugin row, the
--      permission rows and the audit entry commit together or not at all.
--   3. Android (Phase 8) calls the same RPC with no platform-specific piece.
--
-- Safety does not depend on who runs the DDL, it depends on *what* runs:
-- plugin SQL is not sent by the client. It is seeded into
-- `plugin_package_migrations` by this migration — reviewed, versioned, with a
-- checksum recorded on first apply — and the RPC only names a plugin and a
-- version. A client can no more inject SQL here than it can edit this file.
--
-- What the runner guarantees, and the validator proves:
--   * a plugin's SQL runs once per organization, in filename order, inside the
--     enabling transaction;
--   * re-enabling a plugin whose file changed *after* it was applied fails
--     loudly (`plugin_migration_changed`) instead of half-applying;
--   * every table a plugin creates must be named `plg_<plugin>_*`, carry
--     `organization_id`, have RLS enabled and at least one policy. A plugin
--     cannot ship a world-readable table, because the enable is rolled back if
--     it tries (docs/05 §8);
--   * plugin permissions are written to the global catalogue namespaced to the
--     plugin, so a plugin can never mint a core key (docs/07 §3);
--   * disabling keeps the rows: migrations stay recorded and grants stay in
--     place, so re-enabling restores the shop's configuration exactly
--     (docs/07 §10). Nothing is silently lost.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. What a plugin ships
-- ══════════════════════════════════════════════════════════════════════════

-- The platform's side of the manifest: what is installed on this server, which
-- migrations it carries and which permissions it contributes. `src/plugins/`
-- carries the same facts as TypeScript; the validator asserts the two agree,
-- so a version bump cannot land on one side only.
create table public.plugin_packages (
  plugin_key       text primary key,
  name             text not null,
  category         text not null check (category in ('core', 'optional', 'industry')),
  version          text not null,
  core_api_version text not null,
  description      text,
  dependencies     text[] not null default '{}',
  conflicts        text[] not null default '{}',
  created_at       timestamptz not null default now()
);

-- Plugin SQL, one row per file. `ordinal` is the run order (filename order in
-- the package); `checksum` is recorded in `plugin_migrations` on application
-- so a changed file for an already-applied migration is detected rather than
-- silently skipping its new statements.
create table public.plugin_package_migrations (
  plugin_key text not null references public.plugin_packages(plugin_key) on delete cascade,
  filename   text not null,
  version    text not null,
  ordinal    integer not null,
  checksum   text not null,
  sql        text not null,
  primary key (plugin_key, filename)
);

-- Permissions live in the catalogue from the moment the package is known, with
-- `plugin_key` set — so the role editor can grant them, and enabling the plugin
-- only has to make sure they still exist. Grants therefore survive a disable,
-- which is the behaviour docs/07 §10 argues for.
create table public.plugin_package_permissions (
  plugin_key  text not null references public.plugin_packages(plugin_key) on delete cascade,
  key         text not null,
  label       text not null,
  category    text not null,
  description text,
  primary key (plugin_key, key)
);

-- Plugin key/value data, scoped to one organization (Phase 1 backed plugin
-- storage with localStorage; the interface was written so this swap changes
-- nothing for plugin authors). Reached only through the RPCs below: the table
-- has RLS on, no policies, and no grants, so a plugin's data is exactly as
-- reachable as the RPC guards make it.
create table public.plugin_data (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plugin_key      text not null,
  key             text not null,
  value           jsonb not null default 'null'::jsonb,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  primary key (organization_id, plugin_key, key)
);

create trigger plugin_data_updated_at
  before update on public.plugin_data
  for each row execute function public.set_updated_at();

alter table public.plugin_packages            enable row level security;
alter table public.plugin_package_migrations  enable row level security;
alter table public.plugin_package_permissions enable row level security;
alter table public.plugin_data                enable row level security;

-- The enable/disable of a plugin is configuration, and configuration is what
-- the audit trail is for (025). `plugins` was missing from that list.
create trigger audit_plugins
  after insert or update or delete on public.plugins
  for each row execute function app.record_audit();

-- ══════════════════════════════════════════════════════════════════════════
-- 2. The runner
-- ══════════════════════════════════════════════════════════════════════════

/** The version this server ships for a plugin, or null if unknown. */
create or replace function app.plugin_package_version(p_plugin_key text)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select pk.version from public.plugin_packages pk where pk.plugin_key = p_plugin_key
$fn$;

/**
 * Apply every migration this package ships that the organization has not
 * applied yet, in `ordinal` order. Returns how many ran.
 *
 * Called inside the enabling transaction, so a failure in file three of five
 * leaves the organization with none of them.
 */
create or replace function app.plugin_apply_migrations(
  p_org uuid,
  p_plugin_key text
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_file record;
  v_applied integer := 0;
  v_seen text;
begin
  for v_file in
    select m.filename, m.version, m.checksum, m.sql
      from public.plugin_package_migrations m
     where m.plugin_key = p_plugin_key
     order by m.ordinal, m.filename
  loop
    select pm.checksum into v_seen
      from public.plugin_migrations pm
     where pm.organization_id = p_org
       and pm.plugin_key = p_plugin_key
       and pm.filename = v_file.filename;

    if found then
      if v_seen <> v_file.checksum then
        raise exception 'plugin_migration_changed: %.% changed after it was applied',
          p_plugin_key, v_file.filename using errcode = 'P0001';
      end if;
      continue;
    end if;

    execute v_file.sql;

    insert into public.plugin_migrations
          (organization_id, plugin_key, version, filename, checksum)
    values (p_org, p_plugin_key, v_file.version, v_file.filename, v_file.checksum);

    v_applied := v_applied + 1;
  end loop;

  return v_applied;
end
$fn$;

/**
 * Every table a plugin created must be tenant-safe. Checked *after* the DDL
 * runs and before the enable commits: a violation rolls the whole thing back,
 * so a plugin that forgets RLS cannot be enabled at all — the failure is at
 * install time, in front of the person who can fix it, not in a security
 * review six months later.
 */
create or replace function app.plugin_assert_plugin_schema(p_plugin_key text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_prefix text := 'plg_' || replace(p_plugin_key, '-', '_') || '_';
  v_table text;
  v_problems text[] := '{}';
begin
  for v_table in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname like v_prefix || '%'
     order by c.relname
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_table
         and column_name = 'organization_id'
    ) then
      v_problems := v_problems || format('%s has no organization_id', v_table);
    end if;

    if not exists (
      select 1 from pg_class c
       where c.relname = v_table
         and c.relnamespace = 'public'::regnamespace
         and c.relrowsecurity
    ) then
      v_problems := v_problems || format('%s has RLS disabled', v_table);
    end if;

    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = v_table
    ) then
      v_problems := v_problems || format('%s has no policy', v_table);
    end if;
  end loop;

  if array_length(v_problems, 1) is not null then
    raise exception 'plugin_schema_violation: %', array_to_string(v_problems, '; ')
      using errcode = 'P0001';
  end if;
end
$fn$;

/**
 * Put the package's permissions into the global catalogue, namespaced to the
 * plugin. Idempotent: enabling a plugin twice, or re-enabling it, restores any
 * row that went missing and leaves the rest alone.
 */
create or replace function app.plugin_ensure_permissions(p_plugin_key text)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select pp.key, pp.label, pp.category, pp.description
      from public.plugin_package_permissions pp
     where pp.plugin_key = p_plugin_key
  loop
    if v_row.key not like p_plugin_key || '.%' then
      raise exception 'plugin_permission_namespace: "%" must be namespaced as "%…"',
        v_row.key, p_plugin_key || '.' using errcode = 'P0001';
    end if;

    insert into public.permissions (key, label, category, plugin_key, description)
    values (v_row.key, v_row.label, v_row.category, p_plugin_key, v_row.description)
    on conflict (key) do update
       set label = excluded.label,
           category = excluded.category,
           plugin_key = excluded.plugin_key,
           description = excluded.description;

    v_count := v_count + 1;
  end loop;

  return v_count;
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. The RPCs a client calls
-- ══════════════════════════════════════════════════════════════════════════

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
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('plugins.manage');

  v_shipped := app.plugin_package_version(p_plugin_key);
  if v_shipped is null then
    raise exception 'unknown_plugin: %', p_plugin_key using errcode = 'P0001';
  end if;

  -- The client declares which version it is enabling because the *code* it
  -- loads comes from that bundle. A bundle older or newer than the SQL on this
  -- server is refused rather than half-deployed.
  if p_version is not null and p_version <> v_shipped then
    raise exception 'plugin_version_mismatch: server has %, client offered %',
      v_shipped, p_version using errcode = 'P0001';
  end if;

  if p_config is not null and jsonb_typeof(p_config) <> 'object' then
    raise exception 'plugin_config_invalid: expected an object' using errcode = 'P0001';
  end if;

  v_applied := app.plugin_apply_migrations(p_organization_id, p_plugin_key);
  perform app.plugin_assert_plugin_schema(p_plugin_key);
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
         -- An empty object from the client means "no opinion", not "erase the
         -- shop's settings".
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

create or replace function public.plugin_disable(
  p_organization_id uuid,
  p_plugin_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row record;
  v_dependent text;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('plugins.manage');

  -- A plugin another *enabled* plugin depends on cannot be turned off: the
  -- loader would skip the dependent plugin on the next boot, which reads as a
  -- bug in the shop rather than a dependency the owner forgot about.
  select pk.plugin_key into v_dependent
    from public.plugins p
    join public.plugin_packages pk on pk.plugin_key = p.plugin_key
   where p.organization_id = p_organization_id
     and p.enabled
     and p.plugin_key <> p_plugin_key
     and p_plugin_key = any(pk.dependencies)
   limit 1;

  if v_dependent is not null then
    raise exception 'plugin_dependency: % is enabled and requires %',
      v_dependent, p_plugin_key using errcode = 'P0001';
  end if;

  update public.plugins
     set enabled = false, status = 'ok', last_error = null
   where organization_id = p_organization_id
     and plugin_key = p_plugin_key
  returning * into v_row;

  if not found then
    raise exception 'plugin_not_installed: %', p_plugin_key using errcode = 'P0001';
  end if;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (p_organization_id, 'plugin.disabled', 'plugin', v_row.id,
          jsonb_build_object('plugin_key', p_plugin_key));

  return jsonb_build_object('plugin_key', p_plugin_key, 'enabled', false);
end
$fn$;

create or replace function public.plugin_set_config(
  p_organization_id uuid,
  p_plugin_key text,
  p_config jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row record;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('plugins.manage');

  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'plugin_config_invalid: expected an object' using errcode = 'P0001';
  end if;

  if pg_column_size(p_config) > 32768 then
    raise exception 'plugin_config_invalid: larger than 32 KB' using errcode = 'P0001';
  end if;

  update public.plugins
     set config = p_config
   where organization_id = p_organization_id
     and plugin_key = p_plugin_key
  returning * into v_row;

  if not found then
    raise exception 'plugin_not_installed: %', p_plugin_key using errcode = 'P0001';
  end if;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (p_organization_id, 'plugin.configured', 'plugin', v_row.id,
          jsonb_build_object('plugin_key', p_plugin_key));

  return jsonb_build_object('plugin_key', p_plugin_key, 'config', v_row.config);
end
$fn$;

/**
 * Everything the Plugins screen needs in one call: the packages this server
 * ships (even the ones this shop has never installed) joined with this shop's
 * state. `migrations_pending` is what the enable button will actually apply.
 */
create or replace function public.plugin_catalog(p_organization_id uuid)
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
  perform app.require_permission('plugins.view');

  return coalesce((
    select jsonb_agg(entry order by entry ->> 'name')
      from (
        select jsonb_build_object(
          'key', pk.plugin_key,
          'name', pk.name,
          'category', pk.category,
          'version', pk.version,
          'core_api_version', pk.core_api_version,
          'description', pk.description,
          'dependencies', to_jsonb(pk.dependencies),
          'conflicts', to_jsonb(pk.conflicts),
          'installed', pl.id is not null,
          'enabled', coalesce(pl.enabled, false),
          'status', coalesce(pl.status, 'ok'),
          'last_error', pl.last_error,
          'config', coalesce(pl.config, '{}'::jsonb),
          'enabled_at', pl.enabled_at,
          'permissions', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'key', pp.key, 'label', pp.label, 'category', pp.category,
                     'description', pp.description) order by pp.key), '[]'::jsonb)
              from public.plugin_package_permissions pp
             where pp.plugin_key = pk.plugin_key),
          'migrations_total', (
            select count(*) from public.plugin_package_migrations m
             where m.plugin_key = pk.plugin_key),
          'migrations_pending', (
            select count(*) from public.plugin_package_migrations m
             where m.plugin_key = pk.plugin_key
               and not exists (
                 select 1 from public.plugin_migrations pm
                  where pm.organization_id = v_org
                    and pm.plugin_key = m.plugin_key
                    and pm.filename = m.filename))
        ) as entry
          from public.plugin_packages pk
          left join public.plugins pl
                 on pl.plugin_key = pk.plugin_key
                and pl.organization_id = v_org
      ) entries
  ), '[]'::jsonb);
end
$fn$;

/**
 * The §4 question from docs/07 asked before enabling: which roles would gain
 * this plugin's permissions *by wildcard*, without anyone granting anything?
 *
 * A role holding `*` or `<plugin>.*` silently gains every permission a plugin
 * adds. That is correct for an owner and worth a confirmation for anyone else,
 * so the screen shows it and the admin says yes.
 */
create or replace function public.plugin_impact(
  p_organization_id uuid,
  p_plugin_key text
)
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
  perform app.require_permission('plugins.view');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'role_id', r.id,
             'role_key', r.key,
             'role_name', r.name,
             'wildcard', wild.card,
             'permissions', wild.keys) order by r.name)
      from public.roles r
      cross join lateral (
        select min(p.key) filter (where p.key in ('*', split_part(pp.key, '.', 1) || '.*')) as card,
               coalesce(jsonb_agg(pp.key order by pp.key) filter (
                 where exists (
                   select 1 from public.role_permissions rp2
                    join public.permissions p2 on p2.id = rp2.permission_id
                   where rp2.role_id = r.id
                     and p2.key in ('*', split_part(pp.key, '.', 1) || '.*')
                 )), '[]'::jsonb) as keys
          from public.plugin_package_permissions pp
         where pp.plugin_key = p_plugin_key
      ) wild
     where r.organization_id = v_org
       and jsonb_array_length(wild.keys) > 0
  ), '[]'::jsonb);
end
$fn$;

-- ── Plugin data, reached only through these three ─────────────────────────

create or replace function public.plugin_data_set(
  p_organization_id uuid,
  p_plugin_key text,
  p_key text,
  p_value jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row record;
begin
  perform app.require_org(p_organization_id);

  if not exists (
    select 1 from public.plugins p
     where p.organization_id = p_organization_id
       and p.plugin_key = p_plugin_key
       and p.enabled
  ) then
    raise exception 'plugin_not_enabled: %', p_plugin_key using errcode = 'P0001';
  end if;

  if pg_column_size(p_value) > 65536 then
    raise exception 'plugin_data_too_large: %', p_key using errcode = 'P0001';
  end if;

  insert into public.plugin_data
        (organization_id, plugin_key, key, value, updated_by)
  values (p_organization_id, p_plugin_key, p_key, p_value, auth.uid())
  on conflict (organization_id, plugin_key, key) do update
     set value = excluded.value,
         updated_by = excluded.updated_by
  returning * into v_row;

  return jsonb_build_object('key', v_row.key, 'value', v_row.value);
end
$fn$;

create or replace function public.plugin_data_get(
  p_organization_id uuid,
  p_plugin_key text,
  p_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_value jsonb;
begin
  perform app.require_org(p_organization_id);

  select d.value into v_value
    from public.plugin_data d
   where d.organization_id = p_organization_id
     and d.plugin_key = p_plugin_key
     and d.key = p_key;

  return coalesce(v_value, 'null'::jsonb);
end
$fn$;

create or replace function public.plugin_data_delete(
  p_organization_id uuid,
  p_plugin_key text,
  p_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform app.require_org(p_organization_id);

  delete from public.plugin_data d
   where d.organization_id = p_organization_id
     and d.plugin_key = p_plugin_key
     and d.key = p_key;

  return found;
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. Grants
-- ══════════════════════════════════════════════════════════════════════════

grant execute on function public.plugin_enable(uuid, text, text, jsonb)
  to authenticated;
grant execute on function public.plugin_disable(uuid, text) to authenticated;
grant execute on function public.plugin_set_config(uuid, text, jsonb) to authenticated;
grant execute on function public.plugin_catalog(uuid) to authenticated;
grant execute on function public.plugin_impact(uuid, text) to authenticated;
grant execute on function public.plugin_data_set(uuid, text, text, jsonb) to authenticated;
grant execute on function public.plugin_data_get(uuid, text, text) to authenticated;
grant execute on function public.plugin_data_delete(uuid, text, text) to authenticated;
grant execute on function app.plugin_package_version(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. The two plugins this server ships
-- ══════════════════════════════════════════════════════════════════════════
--
-- batch-expiry: the architecture's acceptance test (src/plugins/batch-expiry).
-- It stores its fields in `products.metadata`, so it ships *no* DDL — the
-- common case, and the reason the runner must work with zero files.
--
-- loyalty-lite: the SDK's worked example (src/plugins/loyalty-lite). It does
-- ship DDL, which is what makes the schema audit and the checksum real.

insert into public.plugin_packages
      (plugin_key, name, category, version, core_api_version, description, dependencies)
values
  ('batch-expiry', 'Batch & Expiry', 'optional', '1.0.0', '^1.0.0',
   'Track batch numbers and expiry dates. Warns before stock expires.', '{}'),
  ('loyalty-lite', 'Loyalty (lite)', 'optional', '1.0.0', '^1.0.0',
   'Points per customer, earned on completed sales.', '{batch-expiry}')
on conflict (plugin_key) do update
   set name = excluded.name,
       category = excluded.category,
       version = excluded.version,
       core_api_version = excluded.core_api_version,
       description = excluded.description,
       dependencies = excluded.dependencies;

insert into public.plugin_package_permissions
      (plugin_key, key, label, category, description)
values
  ('batch-expiry', 'batch-expiry.adjust', 'Edit batch and expiry details',
   'inventory', 'Allows editing batch numbers and expiry dates on products.'),
  ('loyalty-lite', 'loyalty-lite.view', 'View loyalty accounts',
   'customers', 'See points balances and the loyalty screen.'),
  ('loyalty-lite', 'loyalty-lite.manage', 'Manage loyalty points',
   'customers', 'Adjust points, including manual corrections.')
on conflict (plugin_key, key) do update
   set label = excluded.label,
       category = excluded.category,
       description = excluded.description;

-- ── loyalty-lite's SQL ────────────────────────────────────────────────────
--
-- Stored as text and executed by `app.plugin_apply_migrations` on first
-- enable, per organization. It creates one table, and the enable transaction
-- refuses to commit unless that table carries organization_id, has RLS on and
-- has policies — the three properties below.

do $seed$
declare
  v_sql text := $plg$
create table if not exists public.plg_loyalty_lite_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  points          integer not null default 0 check (points >= 0),
  lifetime_points integer not null default 0,
  updated_at      timestamptz not null default now(),
  unique (organization_id, customer_id)
);

create index if not exists plg_loyalty_lite_accounts_org_idx
  on public.plg_loyalty_lite_accounts(organization_id, points desc);

alter table public.plg_loyalty_lite_accounts enable row level security;

drop policy if exists plg_loyalty_lite_accounts_select on public.plg_loyalty_lite_accounts;
create policy plg_loyalty_lite_accounts_select on public.plg_loyalty_lite_accounts
  for select using (
    app.in_org(organization_id) and app.has_permission('loyalty-lite.view')
  );

drop policy if exists plg_loyalty_lite_accounts_write on public.plg_loyalty_lite_accounts;
create policy plg_loyalty_lite_accounts_write on public.plg_loyalty_lite_accounts
  for all using (
    app.in_org(organization_id) and app.has_permission('loyalty-lite.manage')
  )
  with check (
    app.in_org(organization_id) and app.has_permission('loyalty-lite.manage')
  );

grant select, insert, update, delete on public.plg_loyalty_lite_accounts to authenticated;
$plg$;
begin
  insert into public.plugin_package_migrations
        (plugin_key, filename, version, ordinal, checksum, sql)
  values ('loyalty-lite', '001_accounts.sql', '1.0.0', 1, md5(v_sql), v_sql)
  on conflict (plugin_key, filename) do update
     set version = excluded.version,
         ordinal = excluded.ordinal,
         checksum = excluded.checksum,
         sql = excluded.sql;
end
$seed$;
