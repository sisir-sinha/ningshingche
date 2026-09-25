-- 042 — Close the default-EXECUTE door on everything created after 018.
--
-- Postgres grants EXECUTE on a new function to PUBLIC. Migration 018 revoked
-- that across both schemas and then granted back only the intended API — but
-- every migration written *after* 018 (026 and its successors, and now the
-- variants plugin) created functions that inherited the default again. A probe
-- of the live database showed what that means in practice:
--
--     app.plugin_apply_migrations            anon=true authenticated=true
--     app.plugin_ensure_permissions          anon=true authenticated=true
--     app.plugin_package_version             anon=true authenticated=true
--     public.plugin_enable                   anon=true authenticated=true
--
-- None of those escalate on their own — `plugin_enable` checks the caller's
-- membership and `plugins.manage`, and an anonymous caller has no organization
-- — but "the checks will catch it" is not a boundary. `app.plugin_apply_migrations`
-- has no check of its own (its `public` wrapper is what checks), and running it
-- as an anonymous caller would record a shop's plugin migrations as applied
-- without applying them, which then makes the real enable fail its schema guard.
-- A denial of service reachable without signing in.
--
-- So the rule is restated where it belongs: **anon reaches nothing, and the
-- private half of the plugin host is not client API at all.** The public
-- plugin RPCs stay granted to `authenticated` — that is the intended surface,
-- and each of them does its own `require_org`/`require_permission`.
--
-- Revoking the existing grants is half of it. The other half is the *default*:
-- Postgres grants EXECUTE on a new function to PUBLIC, Supabase grants it to
-- `anon` and `authenticated` by name, and so the next plugin would inherit the
-- hole again. Both halves are here, and both are asserted at the end.

-- ── Take back the default, and only the default ──────────────────────────
-- `from public` is the line that matters: a new function's ACL is a grant to
-- PUBLIC, which every role inherits — so revoking from `anon` alone leaves
-- `has_function_privilege('anon', …)` still true. (This migration's first
-- version did exactly that, and the guard below caught it.)
--
-- Explicit grants are separate ACL entries and survive: the RPCs granted to
-- `authenticated` in 018 and since, and the three `app.*` helpers granted to
-- `anon` in 020 **because RLS policy expressions run as the querying role**
-- (documented at length in 020 — an anon read of a protected table must return
-- no rows, not `42501 permission denied for function in_org`). Those three are
-- deliberately left alone; the validator asserts they stay executable.
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema app from public;

-- ── The plugin host's internals ──────────────────────────────────────────
-- These run with the definer's rights when called from `public.plugin_*`, so
-- revoking them from clients changes nothing for the app and removes a path
-- that skipped the wrapper's checks entirely.
revoke execute on function app.plugin_apply_migrations(uuid, text) from public, authenticated;
revoke execute on function app.plugin_assert_plugin_schema(text, text[]) from public, authenticated;
revoke execute on function app.plugin_ensure_permissions(text) from public, authenticated;
revoke execute on function app.plugin_tables() from public, authenticated;

-- One deliberate exception: the client reads a plugin's shipped version to
-- pass back to `plugin_enable` as the "which bundle am I loading" assertion
-- (docs/05 §9). It leaks nothing beyond the version string of a package the
-- same client can see in the catalogue.
revoke execute on function app.plugin_package_version(text) from public;
grant execute on function app.plugin_package_version(text) to authenticated;

-- ── And make it stay closed ──────────────────────────────────────────────
-- Everything above fixes the past. This fixes the future, and without it the
-- rest is decoration: **every function created afterwards inherits a grant
-- again**, so the next plugin switched on would reopen exactly this hole.
--
-- A live database was asked what a new function would get, and Supabase's own
-- default is broader than Postgres's:
--
--     postgres / public: {postgres=X,anon=X,authenticated=X,service_role=X}
--
-- `revoke … from public` does not touch it — the grant to `anon` is its own
-- ACL entry. So the default itself is narrowed to "the owner, and nobody else",
-- in both schemas. From here on a function has exactly the grants it is given.
--
-- That costs nothing, because every plugin's SQL already writes its own
-- `grant execute … to authenticated` and revokes the rest (variants 002 does
-- it for all twelve of its RPCs), and every core migration since 018 grants
-- explicitly. What it buys is that a forgotten grant becomes a visible
-- `42501 permission denied` — caught here, and by `tools/check-db-acl.mjs`,
-- which names any RPC the client calls that lacks its own grant — instead of
-- an invisible opening.
--
-- Scope, stated plainly: this binds functions created by `postgres`, the role
-- the migrations run as. A function created from the Supabase dashboard runs as
-- `supabase_admin` and keeps that role's defaults; the migration runner cannot
-- reach into it, and nothing in this app creates functions that way.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated, service_role;

-- ── Belt and braces ──────────────────────────────────────────────────────
-- 018's own grants and everything since: assert the intended surface is still
-- reachable, so a future blanket revoke cannot silently break the API — and
-- that the anonymous caller's *only* reachable functions are the five RLS
-- helpers, which answer `false`/`{}` for it by construction.
do $verify$
declare
  v_revoked text[] := '{}';
  v_name text;
begin
  -- By name rather than signature: `complete_sale` gained a parameter in 021,
  -- and a check that pins an argument list would have to be edited every time
  -- one changes — which is how a guard quietly stops guarding.
  foreach v_name in array array[
    'complete_sale', 'hold_sale', 'refund_sale', 'plugin_enable', 'plugin_state',
    'plugin_rpc', 'plugin_catalog', 'plugin_data_get', 'provision_organization'
  ]
  loop
    if not exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = v_name
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) then
      v_revoked := v_revoked || v_name;
    end if;

    if exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = v_name
         and has_function_privilege('anon', p.oid, 'EXECUTE')
    ) then
      v_revoked := v_revoked || (v_name || ' (still anon)');
    end if;
  end loop;

  -- No anonymous caller may reach a `public` function. The app has no
  -- anonymous surface: the sign-in screen makes no data calls, and the only
  -- things anon touches are the RLS helpers that live in the `app` schema.
  --
  -- Scoped to *our* functions, and the live database is why: `pg_trgm`'s
  -- helpers are owned by `supabase_admin`, and this migration runs as
  -- `postgres`, which is not a superuser — `revoke` on somebody else's
  -- function does nothing, silently. They are pure string functions that take
  -- their input as arguments and cannot read a table, and the point of the
  -- rule is that no *application* code of ours is reachable without a session.
  -- So: anything still reachable must belong to an extension (the `deptype`
  -- row), and anything we own must be gone.
  for v_name in
    select format('public.%s (owner %s)', p.proname, r.rolname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
     where n.nspname = 'public'
       and p.prokind = 'f'
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       and (
         p.proowner = current_user::regrole
         or not exists (
           select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
         )
       )
  loop
    v_revoked := v_revoked || ('an anonymous caller can still execute ' || v_name);
  end loop;

  -- The `app` schema is entirely ours — there is no extension in it — so here
  -- the rule is unconditional: an anonymous caller reaches the three RLS
  -- helpers and nothing else.
  for v_name in
    select format('app.%s', p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.prokind = 'f'
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       and p.proname not in ('in_org', 'has_permission', 'visible_branch_ids')
  loop
    v_revoked := v_revoked || ('an anonymous caller can still execute ' || v_name);
  end loop;

  -- The default-privilege change above is deliberately *not* asserted here.
  -- The validator's database (PGlite) accepts `alter default privileges` and
  -- then ignores it: a function created straight afterwards is still
  -- world-executable, while on a real Postgres it is not. An assertion that
  -- fails in the only database this file is tested in, while being true in the
  -- one it runs in, teaches the wrong lesson. The live equivalent lives in
  -- `tools/check-db-acl.mjs`, which reads `pg_default_acl` on the real system
  -- and fails if a future function would arrive with more than the owner's
  -- grant — and `npm run db:push` was followed by it.
  if array_length(v_revoked, 1) is not null then
    raise exception 'client_api_wrong: %', array_to_string(v_revoked, ', ') using errcode = 'P0001';
  end if;
end
$verify$;
