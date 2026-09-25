-- 047 — The shop type travels with the session.
--
-- `organizations.shop_type` has been recorded since provisioning (002, 017): the
-- wizard asks "what do you sell?" and stores the key. Nothing could read it.
--
-- The taxonomy in `data/shop_categories.json` already maps every business type
-- onto what a shop sees first — `promotedProductFields` is the list of product
-- fields that come *out* of "+ Advanced Options" and into the basic form
-- (docs/08 §2), which is how a pharmacy sees `expiry_date` immediately while a
-- bookstore never sees it at all (spec §8, §57). The client could not act on
-- any of it, because the one round trip the app already makes — the session
-- payload — carried everything about the shop except what kind of shop it is.
--
-- So this migration adds one key. It is a `create or replace` of the whole
-- function because that is the only way to change it, and the body is otherwise
-- byte-identical to 019: the risk of rewriting a payload three clients decode
-- is drift, so the diff is exactly one line, and the Android mirror in
-- `android/core/.../Wire.kt` carries the same field.
--
-- Verified by `tools/validate-migrations.mjs`, which signs in as the seeded
-- owner and asserts the payload's shape — including this key.

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
          -- The shop's business type, as a key into `data/shop_categories.json`.
          -- It travels with the session because the client needs it to decide what
          -- to put in front of the shopkeeper: a pharmacy's product form starts with
          -- an expiry date, a mobile shop's with serial tracking, and neither of them
          -- edits `src/features/` to get it (docs/08 §2).
          'shop_type',       o.shop_type,
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
