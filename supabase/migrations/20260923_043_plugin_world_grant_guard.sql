-- 043 — Close the world grant on every function a plugin creates.
--
-- 042 said it would do this with `alter default privileges … revoke execute on
-- functions from public`. That does not work, and this migration is the record
-- of finding out. Default privileges for *functions* are **additive** over the
-- built-in default, and the built-in default for a function grants EXECUTE to
-- PUBLIC — so revoking PUBLIC from the default removes nothing. Measured on the
-- live database, three ways:
--
--   stored default {postgres=X}                       → new function acl NULL
--     (NULL means the built-in default: PUBLIC=X, anon=true)
--   stored default {postgres=X,authenticated=X}       → new function
--     {=X,postgres=X,authenticated=X}    ← PUBLIC came back on its own
--   `alter default privileges … grant execute … to anon`
--                                                     → new function
--     {=X,postgres=X,anon=X}
--
-- The second line is the proof: PUBLIC was never in the stored default, and it
-- appears anyway. `acldefault('f')` was `{=X,postgres=X}` throughout. A table
-- behaves differently — `acldefault('r')` gives the world nothing, which is why
-- Supabase's table defaults do stick — and that asymmetry is what made 042's
-- reasoning look sound.
--
-- So the protection has to run when the object is created, and the one place
-- that sees every object a plugin creates is the host that runs its SQL.
-- `app.plugin_apply_migrations` now snapshots the functions this project owns
-- before applying a plugin's file and closes the world's access to whatever
-- appeared. The plugin's own SQL keeps its `grant execute … to authenticated`
-- untouched — this only takes away, and only the part nobody should have.
--
-- The belt-and-braces half is elsewhere and already existed: the validator
-- fails if any function this project owns is executable by an anonymous
-- caller, and `tools/check-db-acl.mjs` asks the live database the same
-- question. Prevention here, detection there.

-- ── Closing the world grant ───────────────────────────────────────────────
-- Takes the set of function OIDs that existed *before*, and revokes PUBLIC and
-- anon on everything that is not in it. `authenticated` and `service_role` are
-- deliberately untouched: a plugin grants those to its own RPCs by name, and a
-- revoke here would take away a grant the plugin just made.
--
-- OIDs rather than names because a name is ambiguous the moment a plugin
-- overloads a function, and `regprocedure` is the exact form `revoke` wants.
create or replace function app.plugin_close_world_grants(p_before oid[])
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_oid oid;
  v_closed integer := 0;
begin
  for v_oid in
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app')
       and p.prokind = 'f'
       and p.proowner = current_user::regrole
       and not (p.oid = any(coalesce(p_before, '{}'::oid[])))
  loop
    execute format(
      'revoke execute on function %s from public, anon',
      v_oid::regprocedure
    );
    v_closed := v_closed + 1;
  end loop;

  return v_closed;
end
$fn$;

-- Private: it takes privileges away from other people's objects by OID, so it
-- is not client API in any sense.
revoke execute on function app.plugin_close_world_grants(oid[]) from public, anon, authenticated;

-- ── The host applies it ───────────────────────────────────────────────────
-- Same function as 033, with the snapshot and the closing call added around
-- `execute v_file.sql`. Per file rather than once at the end: a file that
-- fails leaves everything before it applied, and each file's objects should be
-- closed as soon as they exist.
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
  v_checksum text;
  v_before oid[];
begin
  for v_file in
    select m.filename, m.version, m.sql
      from public.plugin_package_migrations m
     where m.plugin_key = p_plugin_key
     order by m.ordinal, m.filename
  loop
    v_checksum := md5(v_file.sql);

    select pm.checksum into v_seen
      from public.plugin_migrations pm
     where pm.organization_id = p_org
       and pm.plugin_key = p_plugin_key
       and pm.filename = v_file.filename;

    if found then
      if v_seen <> v_checksum then
        raise exception
          'plugin_migration_changed: %.% differs from the file this shop applied',
          p_plugin_key, v_file.filename using errcode = 'P0001';
      end if;
      continue;
    end if;

    select coalesce(array_agg(p.oid), '{}'::oid[])
      into v_before
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app')
       and p.prokind = 'f'
       and p.proowner = current_user::regrole;

    execute v_file.sql;

    perform app.plugin_close_world_grants(v_before);

    insert into public.plugin_migrations
          (organization_id, plugin_key, version, filename, checksum)
    values (p_org, p_plugin_key, v_file.version, v_file.filename, v_checksum);

    v_applied := v_applied + 1;
  end loop;

  return v_applied;
end
$fn$;

-- `create or replace` keeps the grants a function already had, but the warning
-- in 042 applies here too: a function whose signature changes loses them
-- silently, so the revoke is restated rather than assumed.
revoke execute on function app.plugin_apply_migrations(uuid, text) from public, anon, authenticated;

-- ── Assert it, on the mechanism rather than on a claim ────────────────────
-- The closer is called by the validator with a real function created without
-- any grant, and the plugin lifecycle in it exercises the same path through
-- `plugin_enable`. What is asserted here is the one property that must hold in
-- every database: after a plugin's file has been applied by the host, nothing
-- it created is reachable by an anonymous caller.
do $verify$
declare
  v_before oid[];
  v_probe oid;
  v_open boolean;
begin
  create function public.plugin_world_probe() returns integer language sql as 'select 1';

  -- What the host does, in the same order: snapshot, create, close.
  select p.oid into v_probe
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'plugin_world_probe';

  select coalesce(array_agg(p.oid), '{}'::oid[]) into v_before
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app') and p.prokind = 'f'
     and p.proowner = current_user::regrole and p.oid <> v_probe;

  v_open := has_function_privilege('anon', v_probe, 'EXECUTE');

  perform app.plugin_close_world_grants(v_before);

  if v_open is not true then
    raise exception
      'world_grant_untestable: a new function was already closed to anon, so the test proves nothing'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', v_probe, 'EXECUTE') then
    raise exception
      'world_grant_open: the host did not close PUBLIC/anonymous access to a function a plugin created'
      using errcode = 'P0001';
  end if;

  drop function public.plugin_world_probe();

  -- And the host really does call it, rather than this file merely defining a
  -- helper nothing uses. Read the source of the deployed function: the
  -- catalogue is the only thing that knows what will actually run.
  if position(
       'plugin_close_world_grants' in
       (select pg_get_functiondef(p.oid)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.proname = 'plugin_apply_migrations')
     ) = 0
  then
    raise exception
      'world_grant_unwired: app.plugin_apply_migrations does not call the closer, so plugins are not covered'
      using errcode = 'P0001';
  end if;
end
$verify$;
