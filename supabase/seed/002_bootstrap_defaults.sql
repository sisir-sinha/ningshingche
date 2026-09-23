-- seed/002 — Provisioning smoke test.
--
-- public.provision_organization() ships in migration 017. This seed calls it
-- against a throwaway user on every `supabase db reset`, so a broken grant
-- set or a missing default is caught before it reaches a real shop, and
-- local development starts with a usable organization.



-- ── Self-verification: provision a throwaway organization ─────────────────
-- Runs on every `supabase db reset`, so a broken grant set or a missing
-- default is caught before it reaches a real shop.
do $$
declare
  v_owner uuid;
  v_org   uuid;
  v_roles int;
  v_grants int;
  v_units  int;
  v_methods int;
begin
  -- Idempotent on purpose. `db:reset` deliberately preserves auth.users so
  -- real accounts survive, which means this seed runs against a table that
  -- may already hold the row. Without the conflict clause a second reset
  -- dies on users_pkey and leaves the shop half-provisioned.
  insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-00000000dead', 'seed-owner@mekholi.test')
  on conflict (id) do nothing;
  v_owner := '00000000-0000-0000-0000-00000000dead';

  v_org := public.provision_organization(
    v_owner, 'Seed Demo Shop', 'seed-demo-shop', 'grocery', 'BDT',
    'Asia/Dhaka', 'Main Store',
    array['Rice & Grains','Oil & Ghee','Spices','Snacks','Beverages'],
    '{}'
  );

  select count(*) into v_roles  from public.roles where organization_id = v_org;
  select count(*) into v_grants from public.role_permissions where organization_id = v_org;
  select count(*) into v_units  from public.product_units where organization_id = v_org;
  select count(*) into v_methods from public.payment_methods where organization_id = v_org;

  if v_roles <> 6 then
    raise exception 'provisioning created % roles, expected 6', v_roles;
  end if;
  if v_grants < 20 then
    raise exception 'provisioning created only % role grants — grant sets are broken', v_grants;
  end if;
  if v_units <> 13 then
    raise exception 'provisioning created % units, expected 13', v_units;
  end if;
  if v_methods <> 6 then
    raise exception 'provisioning created % payment methods, expected 6', v_methods;
  end if;

  raise notice 'provision_organization verified: org %, % roles, % grants, % units, % methods',
    v_org, v_roles, v_grants, v_units, v_methods;

  -- Leave the demo organization in place so `db reset` produces a usable
  -- database for local development.
end;
$$;
