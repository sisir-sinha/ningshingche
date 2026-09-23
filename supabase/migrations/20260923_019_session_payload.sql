-- ═══════════════════════════════════════════════════════════════════════
-- Mekholi — 019: session payload
--
-- One call returns everything the client needs to render the shell: the
-- organizations this user belongs to, their role names, and the permission
-- keys those roles grant.
--
-- Why a function and not PostgREST nested selects: the permission expansion
-- (role → role_permissions → permissions) is a four-table walk that the
-- client would otherwise assemble in JavaScript. Keeping it here means an
-- Android client gets identical semantics, and `app.has_permission` remains
-- the single definition of what a wildcard means (spec §43).
--
-- Lives in `public`, alongside complete_sale and the other client-facing
-- RPCs: PostgREST exposes only the schemas listed in db-schemas, which is
-- `public` by default. The `app.*` helpers stay internal and unexposed.
--
-- SECURITY DEFINER because `user_roles`, `roles` and `role_permissions` are
-- RLS-protected against arbitrary reads; the function is the sanctioned path.
-- It only ever returns rows for `auth.uid()`, so there is no cross-tenant
-- leak. `security_invoker` is unavailable on SQL functions in PG15.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.session_payload()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'organizations', coalesce((
      select jsonb_agg(org order by org->>'name')
      from (
        select jsonb_build_object(
          'organization_id', uo.organization_id,
          'name',            o.name,
          'slug',            o.slug,
          'currency',        o.currency,
          'timezone',        o.timezone,
          'role_names', coalesce((
            select jsonb_agg(r.name order by r.name)
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id
            where ur.user_id = uo.user_id
              and ur.organization_id = uo.organization_id
          ), '[]'::jsonb),
          -- Wildcards are expanded here rather than sent to the client. The
          -- matching is written to mirror app.has_permission exactly:
          --   exact key, or '*', or '<resource>.*'.
          -- Expanding server-side means there is one implementation of the
          -- rule instead of two that can drift.
          'permissions', coalesce((
            select jsonb_agg(distinct p.key order by p.key)
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id
            join public.role_permissions rp on rp.role_id = r.id
            join public.permissions granted on granted.id = rp.permission_id
            join public.permissions p on (
              p.key = granted.key
              or granted.key = '*'
              or (
                right(granted.key, 2) = '.*'
                and split_part(p.key, '.', 1) = split_part(granted.key, '.', 1)
              )
            )
            where ur.user_id = uo.user_id
              and ur.organization_id = uo.organization_id
              -- '*' is a wildcard marker in role_permissions, not a real
              -- capability. Sending it to the client would mean shipping two
              -- implementations of the matching rule.
              and p.key <> '*'
          ), '[]'::jsonb),
          -- Matched on the stable `key`, not `name`: names are display
          -- strings an admin can retitle, keys are the contract.
          'is_owner', exists (
            select 1
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id
            where ur.user_id = uo.user_id
              and ur.organization_id = uo.organization_id
              and r.key = 'owner'
          ),
          'role_keys', coalesce((
            select jsonb_agg(r.key order by r.key)
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id
            where ur.user_id = uo.user_id
              and ur.organization_id = uo.organization_id
          ), '[]'::jsonb)
        ) as org
        from public.user_organizations uo
        join public.organizations o on o.id = uo.organization_id
        where uo.user_id = auth.uid()
      ) as rows_
    ), '[]'::jsonb)
  );
$$;

comment on function public.session_payload() is
  'Organizations, role names and expanded permission keys for the signed-in user. One round trip.';

revoke all on function public.session_payload() from public, anon, authenticated, service_role;
grant execute on function public.session_payload() to authenticated;

-- Behavioural verification of this function lives in tools/validate-migrations.mjs,
-- which runs it against the seeded demo organization. A migration cannot assert
-- against seed data: seeds are applied after migrations.
