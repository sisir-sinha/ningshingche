-- Mekholi — full database schema.
--
-- GENERATED FILE — do not edit. Built by tools/build-schema.mjs from the
-- migrations in supabase/migrations/, which remain the source of truth.
-- Regenerate with: npm run build:schema
--
-- 24 migrations concatenated in order. Running this file on a
-- fresh Postgres 15+ database (with the Supabase roles and auth schema
-- present) produces the same schema the migrations do.

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_001_extensions.sql
-- ══════════════════════════════════════════════════════════════════════

-- 001 — Extensions and shared helpers.
--
-- pg_trgm powers fuzzy product search: "sam a15" must find "Samsung Galaxy A15"
-- (spec §55).
--
-- pgcrypto is deliberately NOT created. gen_random_uuid() has been a core
-- function since Postgres 13 and Supabase runs PG15, so the extension would
-- add nothing but a dependency.

create extension if not exists pg_trgm;

-- Every mutable table carries updated_at, maintained here rather than by
-- application code, so it cannot be forgotten on one write path.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- app.* holds the authorization helpers. A dedicated schema keeps them out of
-- the public API surface that PostgREST exposes.
create schema if not exists app;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_002_tenancy.sql
-- ══════════════════════════════════════════════════════════════════════

-- 002 — Tenancy: organization, branch, warehouse, register, register session.
--
-- Multi-branch shape from day one (spec §27). A single-branch shop gets one
-- row in each of these; the structure is identical at 1 branch and 200.

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  shop_type     text,                       -- key into the shop-category taxonomy
  currency      char(3) not null default 'BDT',
  timezone      text not null default 'Asia/Dhaka',
  locale        text not null default 'en',
  logo_url      text,
  status        text not null default 'active'
                  check (status in ('active', 'suspended', 'closed')),
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.branches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  code            text not null,
  address         text,
  phone           text,
  email           text,
  timezone        text,                     -- overrides the org default when set
  is_primary      boolean not null default false,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create trigger branches_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

create index branches_org_idx
  on public.branches(organization_id)
  where deleted_at is null;

create table public.warehouses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete set null,
  name            text not null,
  code            text not null,
  is_retail_floor boolean not null default false,  -- the shop floor itself
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create trigger warehouses_updated_at
  before update on public.warehouses
  for each row execute function public.set_updated_at();

create table public.registers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid not null references public.branches(id) on delete cascade,
  name            text not null,
  code            text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create trigger registers_updated_at
  before update on public.registers
  for each row execute function public.set_updated_at();

create table public.register_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  register_id     uuid not null references public.registers(id),
  branch_id       uuid not null references public.branches(id),
  opened_by       uuid not null references auth.users(id),
  closed_by       uuid references auth.users(id),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  opening_cash    numeric(14,2) not null default 0,
  closing_cash    numeric(14,2),
  expected_cash   numeric(14,2),
  variance        numeric(14,2),
  cash_in         numeric(14,2) not null default 0,
  cash_out        numeric(14,2) not null default 0,
  sales_cash      numeric(14,2) not null default 0,
  refund_cash     numeric(14,2) not null default 0,
  expense_cash    numeric(14,2) not null default 0,
  note            text,
  check (closing_cash is null or closed_at is not null)
);

-- The whole of §25's concurrency story: two cashiers cannot open the same
-- drawer, and the database — not application code — is what enforces it.
create unique index one_open_session_per_register
  on public.register_sessions(register_id)
  where closed_at is null;

create index register_sessions_org_time_idx
  on public.register_sessions(organization_id, opened_at desc);

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_003_rbac.sql
-- ══════════════════════════════════════════════════════════════════════

-- 003 — RBAC: permission catalogue, roles, memberships, assignments.
--
-- Four rules (docs/07 §1):
--   1. permissions is a global catalogue, shared across organizations
--   2. roles are per-organization
--   3. assignment is scoped per organization AND per branch
--   4. evaluation happens in Postgres, never in the client

create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,     -- 'sales.refund', 'repair.orders.create'
  label       text not null,
  category    text not null,            -- 'sales','inventory','plugins', …
  plugin_key  text,                     -- null for core permissions
  description text
);

create index permissions_plugin_idx
  on public.permissions(plugin_key)
  where plugin_key is not null;

create table public.roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key             text not null,        -- 'owner','admin','cashier', …
  name            text not null,
  is_system       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, key)
);

create trigger roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

create table public.role_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  granted_at    timestamptz not null default now(),
  primary key (role_id, permission_id)
);

-- The RLS root. Deliberately a flat junction table with no further joins, so
-- authorization helpers never recurse into policy-protected tables
-- (docs/09 #3 — the previous codebase shipped a fix_rls_recursion.sql).
create table public.user_organizations (
  user_id         uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create index user_organizations_org_idx
  on public.user_organizations(organization_id);

-- branch_id null = the role applies to every branch (owner, admin).
create table public.user_roles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete cascade,
  role_id         uuid not null references public.roles(id) on delete cascade,
  granted_by      uuid references auth.users(id),
  granted_at      timestamptz not null default now(),
  unique (user_id, organization_id, branch_id, role_id)
);

create index user_roles_lookup_idx
  on public.user_roles(user_id, organization_id);

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_004_app_helpers.sql
-- ══════════════════════════════════════════════════════════════════════

-- 004 — Authorization helpers.
--
-- Every one of these is SECURITY DEFINER with a pinned search_path so it can
-- read the underlying tables WITHOUT re-entering row level security. That is
-- what stops policy recursion (docs/09 #3).
--
-- The rule to hold: no RLS policy may reference a table that itself has a
-- policy referencing another table. These helpers break that chain.

-- Which organizations can the caller see?
create or replace function app.current_org_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(organization_id), '{}')
    from public.user_organizations
   where user_id = auth.uid()
     and is_active
$$;

create or replace function app.in_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is not null
     and p_org = any(app.current_org_ids())
$$;

-- The branch the caller is currently operating in. Sourced from a JWT claim
-- so an Android client gets identical semantics with no policy changes
-- (docs/07 §8).
create or replace function app.current_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
           coalesce(auth.jwt() -> 'app_metadata' ->> 'active_branch_id', ''),
           ''
         )::uuid
$$;

-- Does the caller hold this permission in the current org and branch?
-- Wildcards are evaluated here, never expanded into stored rows (docs/07 §4).
create or replace function app.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions p       on p.id = rp.permission_id
     where ur.user_id = auth.uid()
       and ur.organization_id = any(app.current_org_ids())
       and (ur.branch_id is null or ur.branch_id = app.current_branch_id())
       and (p.key = p_key
            or p.key = '*'
            or p.key = split_part(p_key, '.', 1) || '.*')
  )
$$;

-- Branches whose operational data the caller may read. A null branch_id on
-- any assignment means "all branches in this organization".
create or replace function app.visible_branch_ids(p_org uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.user_roles
       where user_id = auth.uid()
         and organization_id = p_org
         and branch_id is null
    ) then (
      select coalesce(array_agg(id), '{}')
        from public.branches
       where organization_id = p_org
         and deleted_at is null
    )
    else (
      select coalesce(array_agg(branch_id), '{}')
        from public.user_roles
       where user_id = auth.uid()
         and organization_id = p_org
         and branch_id is not null
    )
  end
$$;

create or replace function app.in_visible_branch(p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_branch = any(app.visible_branch_ids(
    (select organization_id from public.branches where id = p_branch)
  ))
$$;

-- Imperative guard for RPCs. Raising inside a function is clearer than making
-- every caller branch on a boolean.
create or replace function app.require_permission(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.has_permission(p_key) then
    raise exception 'permission_denied: %', p_key using errcode = '42501';
  end if;
end;
$$;

create or replace function app.require_org(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.in_org(p_org) then
    raise exception 'forbidden: organization %', p_org using errcode = '42501';
  end if;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_005_catalogue.sql
-- ══════════════════════════════════════════════════════════════════════

-- 005 — Catalogue: categories, brands, units, products, variants, barcodes.
--
-- The default-variant rule (docs/04 §2): every product has at least one
-- variant row. Products without options get a single anonymous variant with
-- is_default = true. That keeps variant_id NOT NULL everywhere downstream and
-- removes null-handling from the entire inventory engine.

create table public.product_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id       uuid references public.product_categories(id) on delete set null,
  name            text not null,
  slug            text not null,
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, parent_id, slug),
  constraint categories_no_self_parent check (parent_id is distinct from id)
);

create trigger product_categories_updated_at
  before update on public.product_categories
  for each row execute function public.set_updated_at();

create index product_categories_org_idx
  on public.product_categories(organization_id, parent_id)
  where deleted_at is null;

create table public.product_brands (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create trigger product_brands_updated_at
  before update on public.product_brands
  for each row execute function public.set_updated_at();

create table public.product_units (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,          -- 'Each','kg','Litre','Dozen','Metre'
  symbol          text not null,          -- 'ea','kg','L','dz','m'
  is_decimal      boolean not null default false,  -- weight/volume-sold?
  sort_order      integer not null default 0,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.taxes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  rate            numeric(6,4) not null check (rate >= 0 and rate <= 100),
  is_inclusive    boolean not null default false,
  applies_to      text not null default 'products'
                    check (applies_to in ('products', 'services', 'both')),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create trigger taxes_updated_at
  before update on public.taxes
  for each row execute function public.set_updated_at();

create table public.products (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  category_id       uuid references public.product_categories(id),
  brand_id          uuid references public.product_brands(id),
  unit_id           uuid references public.product_units(id),
  tax_id            uuid references public.taxes(id),
  name              text not null,
  sku               text,
  description       text,
  selling_price     numeric(14,2) not null default 0 check (selling_price >= 0),
  cost_price        numeric(14,4) not null default 0 check (cost_price >= 0),
  wholesale_price   numeric(14,2),
  tax_inclusive     boolean not null default false,
  reorder_point     numeric(14,3) not null default 0,
  allow_negative    boolean not null default false,
  track_stock       boolean not null default true,
  is_active         boolean not null default true,
  image_url         text,
  -- Plugin-owned sparse attributes, typed by field descriptors (docs/05 §5).
  metadata          jsonb not null default '{}'::jsonb,
  -- Maintained by trigger; see the search index below.
  search_text       text,
  deleted_at        timestamptz,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create index products_org_active_idx
  on public.products(organization_id, is_active)
  where deleted_at is null;
create index products_category_idx on public.products(category_id);
create index products_brand_idx on public.products(brand_id);

create table public.product_variants (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  is_default      boolean not null default false,
  sku             text,
  name_suffix     text,                   -- 'Red / M'
  option_values   jsonb not null default '{}'::jsonb,
  price_override  numeric(14,2),          -- null = inherit products.selling_price
  cost_override   numeric(14,4),          -- null = inherit products.cost_price
  image_url       text,
  is_active       boolean not null default true,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger product_variants_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

create unique index one_default_variant_per_product
  on public.product_variants(product_id)
  where is_default;

create index product_variants_product_idx
  on public.product_variants(product_id)
  where deleted_at is null;

create table public.product_barcodes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant_id      uuid not null references public.product_variants(id) on delete cascade,
  code            text not null,
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  -- A barcode resolves to exactly one thing within an organization.
  unique (organization_id, code)
);

create index product_barcodes_variant_idx on public.product_barcodes(variant_id);

create table public.product_option_types (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,          -- 'Size','Colour'
  sort_order      integer not null default 0,
  unique (organization_id, name)
);

create table public.product_option_values (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  option_type_id  uuid not null references public.product_option_types(id) on delete cascade,
  value           text not null,
  sort_order      integer not null default 0,
  unique (option_type_id, value)
);

create table public.product_images (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant_id      uuid not null references public.product_variants(id) on delete cascade,
  url             text not null,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);

create index product_images_variant_idx on public.product_images(variant_id);

-- Search (spec §55). Maintained by trigger rather than a generated column so
-- it can join brand and variant barcodes, which a generated column cannot.
create or replace function public.refresh_product_search_text()
returns trigger
language plpgsql
as $$
declare
  v_brand text;
  v_extra text;
begin
  select b.name into v_brand
    from public.product_brands b
   where b.id = new.brand_id;

  select string_agg(
           concat_ws(' ', v.sku, coalesce(bc.codes, '')),
           ' '
         )
    into v_extra
    from public.product_variants v
    left join lateral (
      select string_agg(pb.code, ' ') as codes
        from public.product_barcodes pb
       where pb.variant_id = v.id
    ) bc on true
   where v.product_id = new.id
     and v.deleted_at is null;

  new.search_text := lower(
    concat_ws(' ', new.name, new.sku, v_brand, v_extra)
  );
  return new;
end;
$$;

create trigger products_search_text_tgr
  before insert or update on public.products
  for each row
  execute function public.refresh_product_search_text();

-- Trigram similarity handles partial, typo-tolerant input: "sam a15" matches
-- "samsung galaxy a15". Both indexes are what make POS search feel instant.
create index products_trgm_idx
  on public.products using gin (search_text gin_trgm_ops);

create index product_barcodes_trgm_idx
  on public.product_barcodes using gin (code gin_trgm_ops);

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_006_stock.sql
-- ══════════════════════════════════════════════════════════════════════

-- 006 — Stock: the append-only ledger, materialised balances, transfers.
--
-- Two tables answer different questions. stock_movements answers "why is this
-- 37 units?" (spec §12). stock_balances answers "how many right now?" fast.
-- The ledger is the truth; the balance is derived and reconcilable.

-- Guarded deliberately: `create type` has no `if not exists`, and dropping
-- tables (the dashboard's delete, or a partial manual reset) does NOT drop
-- enum types. A bare re-run of this file therefore dies with 42710
-- "type already exists" even on a database whose tables are gone.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'stock_movement_type'
  ) then
    create type public.stock_movement_type as enum (
      'OPENING_STOCK',
      'PURCHASE',
      'SALE',
      'RETURN_IN',
      'RETURN_OUT',
      'ADJUSTMENT_IN',
      'ADJUSTMENT_OUT',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'DAMAGE',
      'LOSS',
      'EXPIRED',
      'COUNT',
      'PRODUCTION_IN',
      'PRODUCTION_OUT'
    );
  end if;
end
$$;


create table public.stock_balances (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id) on delete cascade,
  variant_id      uuid not null references public.product_variants(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  quantity        numeric(14,3) not null default 0,
  -- Weighted-average cost (docs/09 #5, decision 2026-09-23).
  avg_unit_cost   numeric(14,4) not null default 0,
  reserved_qty    numeric(14,3) not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (warehouse_id, variant_id)
);

create trigger stock_balances_updated_at
  before update on public.stock_balances
  for each row execute function public.set_updated_at();

create index stock_balances_org_idx
  on public.stock_balances(organization_id, quantity);
create index stock_balances_product_idx
  on public.stock_balances(product_id);

create table public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id),
  variant_id      uuid not null references public.product_variants(id),
  product_id      uuid not null references public.products(id),
  type            public.stock_movement_type not null,
  -- Quantity is always positive; the sign lives in `direction`. That keeps
  -- reports simple and makes the CHECK below readable.
  quantity        numeric(14,3) not null check (quantity > 0),
  direction       smallint not null check (direction in (1, -1)),
  before_quantity numeric(14,3) not null,
  after_quantity  numeric(14,3) not null,
  unit_cost       numeric(14,4) not null default 0,
  reference_type  text,
  reference_id    uuid,
  user_id         uuid references auth.users(id),
  note            text,
  created_at      timestamptz not null default now(),
  constraint movements_arithmetic
    check (after_quantity = before_quantity + (quantity * direction))
);

create index movements_variant_time_idx
  on public.stock_movements(variant_id, created_at desc);
create index movements_reference_idx
  on public.stock_movements(reference_type, reference_id);
create index movements_org_time_idx
  on public.stock_movements(organization_id, created_at desc);
create index movements_type_idx
  on public.stock_movements(organization_id, type, created_at desc);

-- Append-only, enforced by the database rather than by reviewer discipline.
create or replace function public.prevent_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'stock_movements is append-only: % not permitted', tg_op;
end;
$$;

create trigger movements_immutable
  before update or delete on public.stock_movements
  for each row execute function public.prevent_movement_mutation();

create table public.stock_transfers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  from_warehouse_id uuid not null references public.warehouses(id),
  to_warehouse_id   uuid not null references public.warehouses(id),
  status            text not null default 'pending'
                      check (status in ('pending', 'in_transit', 'received', 'cancelled')),
  note              text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  received_at       timestamptz,
  updated_at        timestamptz not null default now(),
  constraint transfers_distinct_warehouses
    check (from_warehouse_id <> to_warehouse_id)
);

create trigger stock_transfers_updated_at
  before update on public.stock_transfers
  for each row execute function public.set_updated_at();

create table public.stock_transfer_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transfer_id     uuid not null references public.stock_transfers(id) on delete cascade,
  variant_id  uuid not null references public.product_variants(id),
  product_id  uuid not null references public.products(id),
  quantity    numeric(14,3) not null check (quantity > 0),
  unit_cost   numeric(14,4) not null default 0
);

create index stock_transfer_items_transfer_idx
  on public.stock_transfer_items(transfer_id);

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_007_parties.sql
-- ══════════════════════════════════════════════════════════════════════

-- 007 — Parties: customers and suppliers.
--
-- Minimal input by design (spec §19): only `name` is required. Everything
-- else is optional, because a corner shop should be able to add a regular in
-- two keystrokes.

create table public.customers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  phone           text,
  email           text,
  address         text,
  date_of_birth   date,
  tax_id          text,
  credit_limit    numeric(14,2) not null default 0 check (credit_limit >= 0),
  -- Maintained by RPCs, never by direct client writes.
  balance         numeric(14,2) not null default 0,
  store_credit    numeric(14,2) not null default 0 check (store_credit >= 0),
  note            text,
  metadata        jsonb not null default '{}'::jsonb,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create index customers_org_phone_idx
  on public.customers(organization_id, phone)
  where deleted_at is null;
create index customers_org_name_idx
  on public.customers(organization_id, name)
  where deleted_at is null;
create index customers_trgm_idx
  on public.customers using gin (name gin_trgm_ops);

create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  phone           text,
  email           text,
  address         text,
  balance         numeric(14,2) not null default 0,
  note            text,
  metadata        jsonb not null default '{}'::jsonb,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

create index suppliers_org_idx
  on public.suppliers(organization_id)
  where deleted_at is null;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_008_money.sql
-- ══════════════════════════════════════════════════════════════════════

-- 008 — Money: payment methods and expenses.
--
-- No payment method is hardcoded (spec §15). bKash/Nagad and Visa/PayPal are
-- both seed data, and a shop with neither simply has different rows.

create table public.payment_methods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key             text not null,          -- 'cash','bkash','visa','paypal'
  name            text not null,
  type            text not null
                    check (type in ('cash', 'mobile', 'card', 'bank', 'credit', 'other')),
  -- Drives register expected-cash math, so it is a property of the method,
  -- not something each report has to guess from the key.
  is_cash         boolean not null default false,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  icon            text,
  config          jsonb not null default '{}'::jsonb,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, key)
);

create trigger payment_methods_updated_at
  before update on public.payment_methods
  for each row execute function public.set_updated_at();

create table public.expense_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  is_system       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid not null references public.branches(id),
  category_id     uuid references public.expense_categories(id),
  session_id      uuid references public.register_sessions(id),
  amount          numeric(14,2) not null check (amount > 0),
  method_id       uuid references public.payment_methods(id),
  description     text,
  attachment_url  text,
  expense_date    date not null default current_date,
  deleted_at      timestamptz,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

create index expenses_org_date_idx
  on public.expenses(organization_id, expense_date desc)
  where deleted_at is null;
create index expenses_branch_idx
  on public.expenses(branch_id, expense_date desc);
create index expenses_category_idx
  on public.expenses(category_id);

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_009_sales.sql
-- ══════════════════════════════════════════════════════════════════════

-- 009 — Sales: sales, items, payments, returns.
--
-- Snapshotting (docs/09 #4): unit_price, unit_cost, product_name, sku and
-- tax_rate are copied onto sale_items at sale time. Editing a price or cost
-- next month must not rewrite last month's profit.

-- Guarded deliberately: `create type` has no `if not exists`, and dropping
-- tables (the dashboard's delete, or a partial manual reset) does NOT drop
-- enum types. A bare re-run of this file therefore dies with 42710
-- "type already exists" even on a database whose tables are gone.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'sale_status'
  ) then
    create type public.sale_status as enum (
      'DRAFT',
      'HELD',
      'COMPLETED',
      'PARTIALLY_PAID',
      'CANCELLED',
      'REFUNDED',
      'PARTIALLY_REFUNDED'
    );
  end if;
end
$$;


create table public.sales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid not null references public.branches(id),
  register_id     uuid references public.registers(id),
  session_id      uuid references public.register_sessions(id),
  invoice_no      text not null,
  customer_id     uuid references public.customers(id),
  status          public.sale_status not null default 'DRAFT',
  currency        char(3) not null,
  subtotal        numeric(14,2) not null default 0,
  discount_total  numeric(14,2) not null default 0,
  discount_type   text check (discount_type in ('FLAT', 'PERCENT')),
  discount_value  numeric(14,4),
  tax_total       numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  paid_total      numeric(14,2) not null default 0,
  change_due      numeric(14,2) not null default 0,
  cogs            numeric(14,2) not null default 0,
  profit          numeric(14,2) generated always as (total - tax_total - cogs) stored,
  note            text,
  metadata        jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz,
  unique (organization_id, invoice_no),
  constraint sales_completed_has_timestamp
    check (status <> 'COMPLETED' or completed_at is not null),
  constraint sales_paid_within_total
    check (paid_total <= total or status in ('CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'))
);

create trigger sales_updated_at
  before update on public.sales
  for each row execute function public.set_updated_at();

create index sales_org_time_idx
  on public.sales(organization_id, created_at desc);
create index sales_branch_time_idx
  on public.sales(branch_id, created_at desc);
create index sales_customer_idx
  on public.sales(customer_id);
create index sales_status_idx
  on public.sales(organization_id, status);
create index sales_session_idx
  on public.sales(session_id);

create table public.sale_items (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references public.sales(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant_id      uuid not null references public.product_variants(id),
  product_id      uuid not null references public.products(id),
  product_name    text not null,
  variant_name    text,
  sku             text,
  unit_label      text,
  quantity        numeric(14,3) not null check (quantity > 0),
  unit_price      numeric(14,2) not null,
  unit_cost       numeric(14,4) not null default 0,
  discount_type   text check (discount_type in ('FLAT', 'PERCENT')),
  discount_value  numeric(14,4),
  discount_total  numeric(14,2) not null default 0,
  tax_rate        numeric(6,4) not null default 0,
  tax_total       numeric(14,2) not null default 0,
  line_total      numeric(14,2) not null,
  line_cogs       numeric(14,2) not null default 0,
  returned_qty    numeric(14,3) not null default 0,
  note            text
);

create index sale_items_sale_idx on public.sale_items(sale_id);
create index sale_items_product_idx on public.sale_items(product_id, sale_id);
create index sale_items_org_idx on public.sale_items(organization_id);

create table public.sale_payments (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references public.sales(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  method_id       uuid not null references public.payment_methods(id),
  amount          numeric(14,2) not null,
  reference       text,
  received_at     timestamptz not null default now(),
  received_by     uuid references auth.users(id)
);

create index sale_payments_sale_idx on public.sale_payments(sale_id);
create index sale_payments_method_idx
  on public.sale_payments(organization_id, method_id);

create table public.sale_returns (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references public.sales(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid not null references public.branches(id),
  return_no       text not null,
  reason          text,
  restock         boolean not null default true,
  refund_total    numeric(14,2) not null default 0 check (refund_total >= 0),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  unique (organization_id, return_no)
);

create index sale_returns_sale_idx on public.sale_returns(sale_id);

create table public.sale_return_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  return_id       uuid not null references public.sale_returns(id) on delete cascade,
  sale_item_id  uuid not null references public.sale_items(id),
  quantity      numeric(14,3) not null check (quantity > 0),
  refund_amount numeric(14,2) not null check (refund_amount >= 0)
);

create index sale_return_items_return_idx
  on public.sale_return_items(return_id);

create table public.sale_return_payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  return_id       uuid not null references public.sale_returns(id) on delete cascade,
  method_id       uuid not null references public.payment_methods(id),
  amount          numeric(14,2) not null check (amount < 0),
  reference       text,
  paid_at         timestamptz not null default now()
);

create index sale_return_payments_return_idx
  on public.sale_return_payments(return_id);

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_010_purchases.sql
-- ══════════════════════════════════════════════════════════════════════

-- 010 — Purchases: orders, items, payments.

-- Guarded deliberately: `create type` has no `if not exists`, and dropping
-- tables (the dashboard's delete, or a partial manual reset) does NOT drop
-- enum types. A bare re-run of this file therefore dies with 42710
-- "type already exists" even on a database whose tables are gone.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'purchase_status'
  ) then
    create type public.purchase_status as enum (
      'DRAFT',
      'ORDERED',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'CANCELLED'
    );
  end if;
end
$$;


create table public.purchases (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid not null references public.branches(id),
  warehouse_id    uuid not null references public.warehouses(id),
  supplier_id     uuid references public.suppliers(id),
  reference_no    text,
  invoice_no      text not null,
  status          public.purchase_status not null default 'DRAFT',
  subtotal        numeric(14,2) not null default 0,
  discount_total  numeric(14,2) not null default 0,
  tax_total       numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  paid_total      numeric(14,2) not null default 0,
  expected_at     date,
  note            text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  received_at     timestamptz,
  unique (organization_id, invoice_no)
);

create trigger purchases_updated_at
  before update on public.purchases
  for each row execute function public.set_updated_at();

create index purchases_org_time_idx
  on public.purchases(organization_id, created_at desc);
create index purchases_supplier_idx
  on public.purchases(supplier_id);
create index purchases_status_idx
  on public.purchases(organization_id, status);

create table public.purchase_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id     uuid not null references public.purchases(id) on delete cascade,
  variant_id    uuid not null references public.product_variants(id),
  product_id    uuid not null references public.products(id),
  product_name  text not null,
  quantity      numeric(14,3) not null check (quantity > 0),
  received_qty  numeric(14,3) not null default 0 check (received_qty >= 0),
  unit_cost     numeric(14,4) not null check (unit_cost >= 0),
  tax_rate      numeric(6,4) not null default 0,
  line_total    numeric(14,2) not null,
  constraint purchase_items_not_over_received
    check (received_qty <= quantity)
);

create index purchase_items_purchase_idx
  on public.purchase_items(purchase_id);
create index purchase_items_variant_idx
  on public.purchase_items(variant_id);

create table public.purchase_payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id     uuid not null references public.purchases(id) on delete cascade,
  method_id       uuid not null references public.payment_methods(id),
  amount          numeric(14,2) not null,
  reference       text,
  paid_at         timestamptz not null default now()
);

create index purchase_payments_purchase_idx
  on public.purchase_payments(purchase_id);

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_011_platform.sql
-- ══════════════════════════════════════════════════════════════════════

-- 011 — Platform: plugin registry, transactional outbox, audit log, sequences.

create table public.plugins (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plugin_key      text not null,          -- 'pharmacy','loyalty','repair'
  version         text not null,
  enabled         boolean not null default false,
  config          jsonb not null default '{}'::jsonb,
  status          text not null default 'ok'
                    check (status in ('ok', 'error', 'incompatible')),
  last_error      text,
  enabled_at      timestamptz,
  enabled_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, plugin_key)
);

create trigger plugins_updated_at
  before update on public.plugins
  for each row execute function public.set_updated_at();

-- Plugin SQL is applied once per organization, verified by checksum so a
-- tampered or stale bundle cannot silently re-run (docs/05 §8).
create table public.plugin_migrations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plugin_key      text not null,
  version         text not null,
  filename        text not null,
  checksum        text not null,
  applied_at      timestamptz not null default now(),
  primary key (organization_id, plugin_key, filename)
);

-- Transactional outbox (docs/02 §3). Written inside the same transaction as
-- the business change, so the event exists if and only if the change does.
create table public.outbox (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type      text not null,
  aggregate_type  text not null,
  aggregate_id    uuid,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);

create index outbox_unprocessed_idx
  on public.outbox(created_at)
  where processed_at is null;
create index outbox_org_type_idx
  on public.outbox(organization_id, event_type, created_at desc);

-- Audit log (spec §31). bigint identity rather than uuid because this table
-- grows fast and is almost always scanned in insertion order.
create table public.audit_logs (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id        uuid references auth.users(id),
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  ip              inet,
  user_agent      text,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create index audit_org_time_idx
  on public.audit_logs(organization_id, created_at desc);
create index audit_entity_idx
  on public.audit_logs(entity_type, entity_id);

-- Per-organization monotonic counters for invoice/return numbers.
-- UPDATE ... RETURNING takes a row lock, so concurrent cashiers get distinct
-- gap-free numbers (docs/04 §8).
create table public.sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope           text not null,          -- 'invoice:2026','return:2026'
  last_value      bigint not null default 0,
  primary key (organization_id, scope)
);

create or replace function public.next_sequence(p_org uuid, p_scope text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
begin
  -- Ensure the counter row exists. The ON CONFLICT is a no-op once it does,
  -- so this costs one index probe per call and never races.
  insert into public.sequences (organization_id, scope, last_value)
  values (p_org, p_scope, 0)
  on conflict (organization_id, scope) do nothing;

  -- UPDATE ... RETURNING takes the row lock, so concurrent callers are
  -- serialized here and receive distinct, gap-free numbers.
  update public.sequences
     set last_value = last_value + 1
   where organization_id = p_org
     and scope = p_scope
  returning last_value into v_next;

  return v_next;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_012_rpc_sale.sql
-- ══════════════════════════════════════════════════════════════════════

-- 012 — Sale RPCs.
--
-- This is the write path from docs/02 §2. One atomic call replaces seven
-- client-side inserts, which means:
--   * overselling is impossible (row locks serialize concurrent cashiers)
--   * partial failure is impossible (it commits whole or rolls back whole)
--   * an Android client gets identical behaviour by calling the same function
--   * an offline queue can replay it as a single idempotent-ish operation
--
-- The client sends intent (what was sold, for how much); the server computes
-- the truth. Prices, taxes and costs are never trusted from the client.

create or replace function public.complete_sale(
  p_branch_id      uuid,
  p_items          jsonb,
  p_payments       jsonb,
  p_register_id    uuid     default null,
  p_customer_id    uuid     default null,
  p_warehouse_id   uuid     default null,
  p_discount_type  text     default null,
  p_discount_value numeric  default null,
  p_note           text     default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org            uuid;
  v_warehouse      uuid;
  v_session        uuid;
  v_currency       char(3);
  v_sale_id        uuid := gen_random_uuid();
  v_invoice_no     text;
  v_seq            bigint;
  v_item           jsonb;
  v_variant        uuid;
  v_product        uuid;
  v_qty            numeric(14,3);
  v_unit_price     numeric(14,2);
  v_unit_cost      numeric(14,4);
  v_balance        numeric(14,3);
  v_allow_negative boolean;
  v_track_stock    boolean;
  v_tax_rate       numeric(6,4);
  v_tax_inclusive  boolean;
  v_disc_type      text;
  v_disc_value     numeric(14,4);
  v_line_disc      numeric(14,2);
  v_taxable        numeric(14,2);
  v_tax            numeric(14,2);
  v_line_total     numeric(14,2);
  v_subtotal       numeric(14,2) := 0;
  v_tax_total      numeric(14,2) := 0;
  v_discount_total numeric(14,2) := 0;
  v_cogs           numeric(14,2) := 0;
  v_total          numeric(14,2);
  v_paid           numeric(14,2) := 0;
  v_change         numeric(14,2) := 0;
  v_status         public.sale_status;
  v_pay            jsonb;
  v_cash_amount    numeric(14,2) := 0;
  v_name           text;
  v_suffix         text;
  v_sku            text;
  v_unit_label     text;
begin
  -- ── Authorization ───────────────────────────────────────────────────────
  select organization_id into v_org from public.branches
   where id = p_branch_id and deleted_at is null;
  if v_org is null then
    raise exception 'branch_not_found: %', p_branch_id using errcode = 'P0002';
  end if;
  perform app.require_org(v_org);
  perform app.require_permission('sales.create');

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  select currency into v_currency from public.organizations where id = v_org;

  -- Default to the branch's retail floor, else its first warehouse.
  v_warehouse := coalesce(
    p_warehouse_id,
    (select id from public.warehouses
      where organization_id = v_org and branch_id = p_branch_id
        and is_retail_floor and deleted_at is null
      order by created_at limit 1),
    (select id from public.warehouses
      where organization_id = v_org and branch_id = p_branch_id
        and deleted_at is null
      order by created_at limit 1)
  );
  if v_warehouse is null then
    raise exception 'no_warehouse_for_branch: %', p_branch_id using errcode = 'P0002';
  end if;

  -- The register session the sale belongs to, if one is open.
  select rs.id into v_session
    from public.register_sessions rs
   where rs.register_id = p_register_id and rs.closed_at is null
   limit 1;

  -- ── Invoice number and sale shell ───────────────────────────────────────
  -- Created before the line items, because sale_items and sale_payments carry
  -- a foreign key to it. Totals start at zero and are finalised below.
  v_seq := public.next_sequence(v_org, 'invoice:' || to_char(now(), 'YYYY'));
  v_invoice_no := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 6, '0');

  insert into public.sales (
    id, organization_id, branch_id, register_id, session_id, invoice_no,
    customer_id, status, currency, note, created_by
  ) values (
    v_sale_id, v_org, p_branch_id, p_register_id, v_session, v_invoice_no,
    p_customer_id, 'DRAFT', v_currency, p_note, auth.uid()
  );

  -- ── Line items ──────────────────────────────────────────────────────────
  -- Balance rows must exist before FOR UPDATE has anything to lock.
  insert into public.stock_balances
        (organization_id, warehouse_id, variant_id, product_id)
  select v_org, v_warehouse, v.id, v.product_id
    from jsonb_array_elements(p_items) as i
    join public.product_variants v on v.id = (i ->> 'variant_id')::uuid
  on conflict (warehouse_id, variant_id) do nothing;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant := (v_item ->> 'variant_id')::uuid;
    v_qty     := (v_item ->> 'qty')::numeric(14,3);

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity: %', v_item::text using errcode = '22023';
    end if;

    select p.id, p.name, p.sku, p.track_stock, p.allow_negative, p.tax_inclusive,
           coalesce(v.price_override, p.selling_price),
           coalesce(v.cost_override, p.cost_price),
           coalesce(t.rate, 0),
           u.symbol
      into v_product, v_name, v_sku, v_track_stock, v_allow_negative,
           v_tax_inclusive, v_unit_price, v_unit_cost, v_tax_rate, v_unit_label
      from public.product_variants v
      join public.products p on p.id = v.product_id
      left join public.taxes t on t.id = p.tax_id and t.is_active
      left join public.product_units u on u.id = p.unit_id
     where v.id = v_variant and v.deleted_at is null;

    if v_product is null then
      raise exception 'variant_not_found: %', v_variant using errcode = 'P0002';
    end if;

    select name_suffix into v_suffix
      from public.product_variants where id = v_variant;

    -- Lock the balance row. This is what makes concurrent sales safe.
    select quantity into v_balance
      from public.stock_balances
     where warehouse_id = v_warehouse and variant_id = v_variant
     for update;

    if v_track_stock and not v_allow_negative and v_balance < v_qty then
      raise exception 'insufficient_stock: % has %, needs %',
        v_name, v_balance, v_qty
        using errcode = 'P0003';
    end if;

    -- Per-line discount.
    v_disc_type  := v_item ->> 'discount_type';
    v_disc_value := coalesce((v_item ->> 'discount_value')::numeric(14,4), 0);
    v_line_disc := case
      when v_disc_type = 'PERCENT'
        then round(v_qty * v_unit_price * v_disc_value / 100.0, 2)
      when v_disc_type = 'FLAT'
        then least(round(v_disc_value, 2), v_qty * v_unit_price)
      else 0
    end;

    v_taxable := v_qty * v_unit_price - v_line_disc;

    if v_tax_inclusive then
      v_tax        := round(v_taxable * v_tax_rate / (100 + v_tax_rate), 2);
      v_line_total := v_taxable;
    else
      v_tax        := round(v_taxable * v_tax_rate / 100.0, 2);
      v_line_total := v_taxable + v_tax;
    end if;

    insert into public.sale_items (
      sale_id, organization_id, variant_id, product_id, product_name,
      variant_name, sku, unit_label, quantity, unit_price, unit_cost,
      discount_type, discount_value, discount_total, tax_rate, tax_total,
      line_total, line_cogs
    ) values (
      v_sale_id, v_org, v_variant, v_product, v_name,
      v_suffix, v_sku, v_unit_label, v_qty, v_unit_price, v_unit_cost,
      v_disc_type, nullif(v_disc_value, 0), v_line_disc, v_tax_rate, v_tax,
      v_line_total, round(v_qty * v_unit_cost, 2)
    );

    -- Ledger + balance, in the same transaction, under the same lock.
    if v_track_stock then
      insert into public.stock_movements (
        organization_id, warehouse_id, variant_id, product_id, type,
        quantity, direction, before_quantity, after_quantity, unit_cost,
        reference_type, reference_id, user_id
      ) values (
        v_org, v_warehouse, v_variant, v_product, 'SALE',
        v_qty, -1, v_balance, v_balance - v_qty, v_unit_cost,
        'sale', v_sale_id, auth.uid()
      );

      update public.stock_balances
         set quantity = quantity - v_qty
       where warehouse_id = v_warehouse and variant_id = v_variant;
    end if;

    v_subtotal       := v_subtotal + (v_qty * v_unit_price);
    v_discount_total := v_discount_total + v_line_disc;
    v_tax_total      := v_tax_total + v_tax;
    v_cogs           := v_cogs + round(v_qty * v_unit_cost, 2);
  end loop;

  -- ── Order-level discount ────────────────────────────────────────────────
  v_total := v_subtotal - v_discount_total + v_tax_total;

  if p_discount_type = 'PERCENT' and coalesce(p_discount_value, 0) > 0 then
    v_discount_total := v_discount_total
      + round((v_subtotal - v_discount_total) * p_discount_value / 100.0, 2);
  elsif p_discount_type = 'FLAT' and coalesce(p_discount_value, 0) > 0 then
    v_discount_total := v_discount_total
      + least(round(p_discount_value, 2), v_subtotal - v_discount_total);
  end if;

  v_total := v_subtotal - v_discount_total + v_tax_total;
  if v_total < 0 then
    raise exception 'negative_total' using errcode = '22023';
  end if;

  -- ── Payments ────────────────────────────────────────────────────────────
  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    insert into public.sale_payments
          (sale_id, organization_id, method_id, amount, reference, received_by)
    values (v_sale_id, v_org,
            (v_pay ->> 'method_id')::uuid,
            (v_pay ->> 'amount')::numeric(14,2),
            v_pay ->> 'reference',
            auth.uid());

    v_paid := v_paid + (v_pay ->> 'amount')::numeric(14,2);

    if exists (select 1 from public.payment_methods
                where id = (v_pay ->> 'method_id')::uuid and is_cash) then
      v_cash_amount := v_cash_amount + (v_pay ->> 'amount')::numeric(14,2);
    end if;
  end loop;

  if v_paid < v_total then
    v_status := 'PARTIALLY_PAID';
  else
    v_status := 'COMPLETED';
    v_change := v_paid - v_total;
  end if;

  -- ── Finalise the sale ───────────────────────────────────────────────────
  -- The row was created up front (see above) so that sale_items and
  -- sale_payments had a parent to reference. Totals are only known now.
  update public.sales
     set status         = v_status,
         subtotal       = v_subtotal,
         discount_total = v_discount_total,
         discount_type  = p_discount_type,
         discount_value = p_discount_value,
         tax_total      = v_tax_total,
         total          = v_total,
         paid_total     = v_paid,
         change_due     = v_change,
         cogs           = v_cogs,
         completed_at   = case when v_status = 'COMPLETED' then now() end
   where id = v_sale_id;

  -- ── Register cash ───────────────────────────────────────────────────────
  if v_session is not null then
    update public.register_sessions
       set sales_cash = sales_cash + v_cash_amount
     where id = v_session;
  end if;

  -- ── Outbox: the authoritative event chain (docs/02 §3) ──────────────────
  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'sale.completed', 'sale', v_sale_id, jsonb_build_object(
    'sale_id',    v_sale_id,
    'invoice_no', v_invoice_no,
    'branch_id',  p_branch_id,
    'total',      v_total,
    'paid',       v_paid,
    'cogs',       v_cogs,
    'customer_id', p_customer_id
  ));

  return jsonb_build_object(
    'sale_id',    v_sale_id,
    'invoice_no', v_invoice_no,
    'status',     v_status,
    'subtotal',   v_subtotal,
    'discount',   v_discount_total,
    'tax',        v_tax_total,
    'total',      v_total,
    'paid',       v_paid,
    'change_due', v_change
  );
end;
$fn$;

-- Held sales are rows, not a second source of truth (docs/09 #11).
create or replace function public.hold_sale(
  p_branch_id   uuid,
  p_items       jsonb,
  p_customer_id uuid default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org   uuid;
  v_id    uuid := gen_random_uuid();
  v_seq   bigint;
  v_total numeric(14,2) := 0;
  v_item  jsonb;
  v_price numeric(14,2);
  v_qty   numeric(14,3);
  v_variant uuid;
  v_product uuid;
  v_name  text;
begin
  select organization_id into v_org from public.branches where id = p_branch_id;
  perform app.require_org(v_org);
  perform app.require_permission('sales.hold');

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  v_seq := public.next_sequence(v_org, 'held');

  insert into public.sales (
    id, organization_id, branch_id, invoice_no, customer_id, status,
    currency, total, note, created_by
  )
  select v_id, v_org, p_branch_id,
         'HELD-' || lpad(v_seq::text, 6, '0'),
         p_customer_id, 'HELD',
         o.currency, 0, p_note, auth.uid()
    from public.organizations o where o.id = v_org;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant := (v_item ->> 'variant_id')::uuid;
    v_qty     := (v_item ->> 'qty')::numeric(14,3);

    select p.id, p.name, coalesce(v.price_override, p.selling_price)
      into v_product, v_name, v_price
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.id = v_variant;

    insert into public.sale_items (
      sale_id, organization_id, variant_id, product_id, product_name,
      quantity, unit_price, line_total
    ) values (
      v_id, v_org, v_variant, v_product, v_name,
      v_qty, v_price, v_qty * v_price
    );

    v_total := v_total + (v_qty * v_price);
  end loop;

  update public.sales set total = v_total, subtotal = v_total where id = v_id;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'sale.held', 'sale', v_id,
          jsonb_build_object('sale_id', v_id, 'total', v_total));

  return v_id;
end;
$fn$;

create or replace function public.resume_sale(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_row public.sales;
begin
  select organization_id into v_org from public.sales where id = p_sale_id;
  perform app.require_org(v_org);
  perform app.require_permission('sales.resume');

  select * into v_row from public.sales where id = p_sale_id;
  if v_row.status <> 'HELD' then
    raise exception 'sale_not_held: status is %', v_row.status using errcode = '22023';
  end if;

  -- Resuming returns the cart to DRAFT; completing it re-runs the full
  -- complete_sale path so stock is decremented exactly once.
  update public.sales set status = 'DRAFT' where id = p_sale_id;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'sale.resumed', 'sale', p_sale_id,
          jsonb_build_object('sale_id', p_sale_id));

  return jsonb_build_object(
    'sale_id',     p_sale_id,
    'customer_id', v_row.customer_id,
    'total',       v_row.total
  );
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_013_rpc_stock.sql
-- ══════════════════════════════════════════════════════════════════════

-- 013 — Stock and purchase RPCs: adjust, transfer, receive, refund.

-- Weighted-average costing (docs/09 #5, decision 2026-09-23):
--   in  → new_avg = (qty*avg + in_qty*in_cost) / (qty + in_qty)
--   out → cost is the current average; the average does not change
create or replace function public.apply_stock_movement(
  p_warehouse_id   uuid,
  p_variant_id     uuid,
  p_type           public.stock_movement_type,
  p_quantity       numeric(14,3),
  p_unit_cost      numeric(14,4) default 0,
  p_reference_type text default null,
  p_reference_id   uuid default null,
  p_note           text default null
)
returns numeric(14,3)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org       uuid;
  v_product   uuid;
  v_dir       smallint;
  v_before    numeric(14,3);
  v_after     numeric(14,3);
  v_avg       numeric(14,4);
  v_track     boolean;
  v_allow_neg boolean;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive' using errcode = '22023';
  end if;

  select organization_id, product_id into v_org, v_product
    from public.product_variants where id = p_variant_id;
  if v_product is null then
    raise exception 'variant_not_found: %', p_variant_id using errcode = 'P0002';
  end if;

  select track_stock, allow_negative into v_track, v_allow_neg
    from public.products where id = v_product;

  if not v_track then
    return 0;
  end if;

  v_dir := case
    when p_type in ('PURCHASE','RETURN_IN','ADJUSTMENT_IN','TRANSFER_IN',
                    'OPENING_STOCK','COUNT','PRODUCTION_IN') then 1
    else -1
  end;

  insert into public.stock_balances
        (organization_id, warehouse_id, variant_id, product_id)
  values (v_org, p_warehouse_id, p_variant_id, v_product)
  on conflict (warehouse_id, variant_id) do nothing;

  select quantity, avg_unit_cost into v_before, v_avg
    from public.stock_balances
   where warehouse_id = p_warehouse_id and variant_id = p_variant_id
   for update;

  v_after := v_before + (p_quantity * v_dir);

  if v_after < 0 and not v_allow_neg then
    raise exception 'insufficient_stock: has %, needs %', v_before, p_quantity
      using errcode = 'P0003';
  end if;

  -- Weighted average only moves on stock-in.
  if v_dir = 1 then
    if v_after = 0 then
      v_avg := p_unit_cost;
    else
      v_avg := round(
        (v_before * v_avg + p_quantity * p_unit_cost) / v_after, 4
      );
    end if;
  end if;

  insert into public.stock_movements (
    organization_id, warehouse_id, variant_id, product_id, type, quantity,
    direction, before_quantity, after_quantity, unit_cost,
    reference_type, reference_id, user_id, note
  ) values (
    v_org, p_warehouse_id, p_variant_id, v_product, p_type, p_quantity,
    v_dir, v_before, v_after,
    case when v_dir = 1 then p_unit_cost else v_avg end,
    p_reference_type, p_reference_id, auth.uid(), p_note
  );

  update public.stock_balances
     set quantity = v_after, avg_unit_cost = v_avg
   where warehouse_id = p_warehouse_id and variant_id = p_variant_id;

  return v_after;
end;
$fn$;

create or replace function public.adjust_stock(
  p_warehouse_id uuid,
  p_variant_id   uuid,
  p_quantity     numeric(14,3),
  p_reason       text,
  p_direction    smallint default 1,
  p_note         text default null
)
returns numeric(14,3)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org  uuid;
  v_type public.stock_movement_type;
begin
  select organization_id into v_org from public.warehouses where id = p_warehouse_id;
  if v_org is null then
    raise exception 'warehouse_not_found: %', p_warehouse_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('inventory.adjust');

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  v_type := case
    when p_direction = 1 then 'ADJUSTMENT_IN'::public.stock_movement_type
    else case lower(p_reason)
           when 'damage'  then 'DAMAGE'::public.stock_movement_type
           when 'loss'    then 'LOSS'::public.stock_movement_type
           when 'expired' then 'EXPIRED'::public.stock_movement_type
           else 'ADJUSTMENT_OUT'::public.stock_movement_type
         end
  end;

  return public.apply_stock_movement(
    p_warehouse_id, p_variant_id, v_type, p_quantity, 0,
    'adjustment', null, coalesce(p_note, p_reason)
  );
end;
$fn$;

create or replace function public.receive_purchase(
  p_purchase_id uuid,
  p_items       jsonb,            -- [{purchase_item_id, qty, unit_cost?}]
  p_paid        jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_po      public.purchases;
  v_item    jsonb;
  v_pi      public.purchase_items;
  v_qty     numeric(14,3);
  v_cost    numeric(14,4);
  v_added   numeric(14,2) := 0;
  v_pay     jsonb;
  v_paid    numeric(14,2) := 0;
  v_all_in  boolean;
begin
  select * into v_po from public.purchases where id = p_purchase_id;
  if v_po.id is null then
    raise exception 'purchase_not_found: %', p_purchase_id using errcode = 'P0002';
  end if;
  perform app.require_org(v_po.organization_id);
  perform app.require_permission('purchases.receive');

  if v_po.status in ('RECEIVED', 'CANCELLED') then
    raise exception 'purchase_not_receivable: %', v_po.status using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_pi from public.purchase_items
     where id = (v_item ->> 'purchase_item_id')::uuid
       and purchase_id = p_purchase_id;
    if v_pi.id is null then
      raise exception 'purchase_item_not_found' using errcode = 'P0002';
    end if;

    v_qty  := (v_item ->> 'qty')::numeric(14,3);
    v_cost := coalesce((v_item ->> 'unit_cost')::numeric(14,4), v_pi.unit_cost);

    if v_qty <= 0 or v_pi.received_qty + v_qty > v_pi.quantity then
      raise exception 'over_receipt: item % (% received, requesting %)',
        v_pi.id, v_pi.received_qty, v_qty using errcode = '22023';
    end if;

    perform public.apply_stock_movement(
      v_po.warehouse_id, v_pi.variant_id, 'PURCHASE', v_qty, v_cost,
      'purchase', p_purchase_id
    );

    update public.purchase_items
       set received_qty = received_qty + v_qty
     where id = v_pi.id;

    v_added := v_added + (v_qty * v_cost);
  end loop;

  for v_pay in select * from jsonb_array_elements(p_paid)
  loop
    insert into public.purchase_payments
          (organization_id, purchase_id, method_id, amount, reference)
    values (v_po.organization_id, p_purchase_id,
            (v_pay ->> 'method_id')::uuid,
            (v_pay ->> 'amount')::numeric(14,2), v_pay ->> 'reference');
    v_paid := v_paid + (v_pay ->> 'amount')::numeric(14,2);
  end loop;

  update public.purchases
     set paid_total = paid_total + v_paid
   where id = p_purchase_id;

  if v_po.supplier_id is not null and v_paid > 0 then
    update public.suppliers
       set balance = balance - v_paid
     where id = v_po.supplier_id;
  end if;

  select bool_and(received_qty >= quantity) into v_all_in
    from public.purchase_items where purchase_id = p_purchase_id;

  update public.purchases
     set status = case
           when v_all_in then 'RECEIVED'::public.purchase_status
           else 'PARTIALLY_RECEIVED'::public.purchase_status
         end,
         received_at = case when v_all_in then now() else received_at end
   where id = p_purchase_id;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_po.organization_id, 'purchase.received', 'purchase', p_purchase_id,
          jsonb_build_object('purchase_id', p_purchase_id, 'value', v_added));

  return jsonb_build_object(
    'purchase_id', p_purchase_id,
    'received_value', v_added,
    'paid', v_paid,
    'status', (select status from public.purchases where id = p_purchase_id)
  );
end;
$fn$;

-- Refund: item-level and quantity-level, restocking where appropriate
-- (spec §18). Guarded by the database, not the UI — refunding more than was
-- sold is impossible here even with a hand-crafted request.
create or replace function public.refund_sale(
  p_sale_id uuid,
  p_items   jsonb,               -- [{sale_item_id, qty}]
  p_payments jsonb,              -- [{method_id, amount}] (amounts negative)
  p_reason  text default null,
  p_restock boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale    public.sales;
  v_return_id uuid := gen_random_uuid();
  v_seq     bigint;
  v_item    jsonb;
  v_si      public.sale_items;
  v_qty     numeric(14,3);
  v_refund  numeric(14,2);
  v_total   numeric(14,2) := 0;
  v_pay     jsonb;
  v_paid    numeric(14,2) := 0;
  v_wh      uuid;
  v_new_status public.sale_status;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null then
    raise exception 'sale_not_found: %', p_sale_id using errcode = 'P0002';
  end if;
  perform app.require_org(v_sale.organization_id);
  perform app.require_permission('sales.refund');

  if v_sale.status in ('DRAFT', 'HELD', 'CANCELLED') then
    raise exception 'sale_not_refundable: %', v_sale.status using errcode = '22023';
  end if;

  select warehouse_id into v_wh from public.stock_movements
   where reference_type = 'sale' and reference_id = p_sale_id
   order by created_at limit 1;

  v_seq := public.next_sequence(v_sale.organization_id,
                                'return:' || to_char(now(), 'YYYY'));

  insert into public.sale_returns (
    id, sale_id, organization_id, branch_id, return_no, reason, restock, created_by
  ) values (
    v_return_id, p_sale_id, v_sale.organization_id, v_sale.branch_id,
    'RET-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 6, '0'),
    p_reason, p_restock, auth.uid()
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_si from public.sale_items
     where id = (v_item ->> 'sale_item_id')::uuid and sale_id = p_sale_id;
    if v_si.id is null then
      raise exception 'sale_item_not_found' using errcode = 'P0002';
    end if;

    v_qty := (v_item ->> 'qty')::numeric(14,3);

    if v_qty <= 0 or v_si.returned_qty + v_qty > v_si.quantity then
      raise exception 'over_refund: item % (% of % already returned)',
        v_si.id, v_si.returned_qty, v_si.quantity using errcode = '22023';
    end if;

    v_refund := round(v_si.line_total * (v_qty / v_si.quantity), 2);

    insert into public.sale_return_items
          (organization_id, return_id, sale_item_id, quantity, refund_amount)
    values (v_sale.organization_id, v_return_id, v_si.id, v_qty, v_refund);

    update public.sale_items
       set returned_qty = returned_qty + v_qty
     where id = v_si.id;

    if p_restock and v_wh is not null then
      perform public.apply_stock_movement(
        v_wh, v_si.variant_id, 'RETURN_IN', v_qty, v_si.unit_cost,
        'return', v_return_id
      );
    end if;

    v_total := v_total + v_refund;
  end loop;

  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    insert into public.sale_return_payments
          (organization_id, return_id, method_id, amount, reference)
    values (v_sale.organization_id, v_return_id,
            (v_pay ->> 'method_id')::uuid,
            -abs((v_pay ->> 'amount')::numeric(14,2)),
            v_pay ->> 'reference');
    v_paid := v_paid + abs((v_pay ->> 'amount')::numeric(14,2));
  end loop;

  update public.sale_returns set refund_total = v_total where id = v_return_id;

  select case
           when coalesce(sum(returned_qty), 0) >= (select sum(quantity) from public.sale_items where sale_id = p_sale_id)
             then 'REFUNDED'::public.sale_status
           else 'PARTIALLY_REFUNDED'::public.sale_status
         end
    into v_new_status
    from public.sale_items where sale_id = p_sale_id and returned_qty > 0;

  update public.sales set status = v_new_status where id = p_sale_id;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_sale.organization_id, 'sale.refunded', 'sale', p_sale_id,
          jsonb_build_object('sale_id', p_sale_id, 'return_id', v_return_id,
                             'refund_total', v_total, 'restocked', p_restock));

  return jsonb_build_object(
    'return_id', v_return_id,
    'refund_total', v_total,
    'refunded_to_methods', v_paid,
    'sale_status', v_new_status
  );
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_014_rpc_register.sql
-- ══════════════════════════════════════════════════════════════════════

-- 014 — Register session and expense RPCs (spec §24, §25).

create or replace function public.open_register(
  p_register_id  uuid,
  p_opening_cash numeric(14,2) default 0,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org     uuid;
  v_branch  uuid;
  v_id      uuid := gen_random_uuid();
begin
  select organization_id, branch_id into v_org, v_branch
    from public.registers where id = p_register_id and is_active;
  if v_org is null then
    raise exception 'register_not_found: %', p_register_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('register.open');

  if p_opening_cash < 0 then
    raise exception 'opening_cash_negative' using errcode = '22023';
  end if;

  -- The partial unique index one_open_session_per_register is what actually
  -- prevents a second open; this check only exists to produce a friendlier
  -- message. The race is closed by the index, not by this SELECT.
  if exists (select 1 from public.register_sessions
              where register_id = p_register_id and closed_at is null) then
    raise exception 'register_already_open: %', p_register_id using errcode = '23505';
  end if;

  insert into public.register_sessions
        (id, organization_id, register_id, branch_id, opened_by, opening_cash, note)
  values (v_id, v_org, p_register_id, v_branch, auth.uid(), p_opening_cash, p_note);

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'register.opened', 'register_session', v_id,
          jsonb_build_object('session_id', v_id, 'register_id', p_register_id,
                             'opening_cash', p_opening_cash));

  return v_id;
end;
$fn$;

create or replace function public.close_register(
  p_session_id   uuid,
  p_closing_cash numeric(14,2),
  p_note         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_session  public.register_sessions;
  v_expected numeric(14,2);
  v_variance numeric(14,2);
begin
  select * into v_session from public.register_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'session_not_found: %', p_session_id using errcode = 'P0002';
  end if;
  if v_session.closed_at is not null then
    raise exception 'session_already_closed' using errcode = '22023';
  end if;

  perform app.require_org(v_session.organization_id);
  perform app.require_permission('register.close');

  if p_closing_cash < 0 then
    raise exception 'closing_cash_negative' using errcode = '22023';
  end if;

  v_expected := v_session.opening_cash
              + v_session.cash_in
              - v_session.cash_out
              + v_session.sales_cash
              - v_session.refund_cash
              - v_session.expense_cash;

  v_variance := p_closing_cash - v_expected;

  update public.register_sessions
     set closed_at     = now(),
         closed_by     = auth.uid(),
         closing_cash  = p_closing_cash,
         expected_cash = v_expected,
         variance      = v_variance,
         note          = coalesce(p_note, note)
   where id = p_session_id;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_session.organization_id, 'register.closed', 'register_session',
          p_session_id,
          jsonb_build_object('session_id', p_session_id,
                             'expected_cash', v_expected,
                             'closing_cash', p_closing_cash,
                             'variance', v_variance));

  return jsonb_build_object(
    'session_id',    p_session_id,
    'expected_cash', v_expected,
    'closing_cash',  p_closing_cash,
    'variance',      v_variance
  );
end;
$fn$;

-- Cash in / cash out against an open session (manual drawer movements).
create or replace function public.register_cash_movement(
  p_session_id uuid,
  p_amount     numeric(14,2),
  p_direction  smallint,             -- 1 = cash in, -1 = cash out
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_session public.register_sessions;
begin
  select * into v_session from public.register_sessions where id = p_session_id;
  if v_session.id is null or v_session.closed_at is not null then
    raise exception 'session_not_open: %', p_session_id using errcode = '22023';
  end if;

  perform app.require_org(v_session.organization_id);
  perform app.require_permission('register.adjust_cash');

  if p_amount <= 0 or p_direction not in (1, -1) then
    raise exception 'invalid_cash_movement' using errcode = '22023';
  end if;

  update public.register_sessions
     set cash_in  = cash_in + case when p_direction = 1 then p_amount else 0 end,
         cash_out = cash_out + case when p_direction = -1 then p_amount else 0 end
   where id = p_session_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'cash_in',  (select cash_in  from public.register_sessions where id = p_session_id),
    'cash_out', (select cash_out from public.register_sessions where id = p_session_id),
    'note',     p_note
  );
end;
$fn$;

create or replace function public.record_expense(
  p_branch_id   uuid,
  p_amount      numeric(14,2),
  p_category_id uuid default null,
  p_method_id   uuid default null,
  p_description text default null,
  p_session_id  uuid default null,
  p_expense_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_id  uuid := gen_random_uuid();
  v_is_cash boolean := false;
begin
  select organization_id into v_org from public.branches where id = p_branch_id;
  if v_org is null then
    raise exception 'branch_not_found: %', p_branch_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('expenses.create');

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;

  insert into public.expenses (
    id, organization_id, branch_id, category_id, session_id, amount,
    method_id, description, expense_date, created_by
  ) values (
    v_id, v_org, p_branch_id, p_category_id, p_session_id, p_amount,
    p_method_id, p_description, p_expense_date, auth.uid()
  );

  select is_cash into v_is_cash from public.payment_methods where id = p_method_id;

  if v_session_id is not null and coalesce(v_is_cash, false) then
    update public.register_sessions
       set expense_cash = expense_cash + p_amount
     where id = v_session_id and closed_at is null;
  end if;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'expense.recorded', 'expense', v_id,
          jsonb_build_object('expense_id', v_id, 'amount', p_amount,
                             'branch_id', p_branch_id));

  return v_id;
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_015_rls.sql
-- ══════════════════════════════════════════════════════════════════════

-- 015 — Row Level Security.
--
-- Design rules (docs/04 §9, docs/07 §6):
--
--  1. Every table gets RLS. Supabase defaults to deny only once RLS is
--     enabled, so an omitted ENABLE is an open table.
--  2. Policies call only app.* helpers. No policy may reference a table that
--     itself has a policy referencing another table — that is the recursion
--     trap, and it is why every child table carries its own organization_id.
--  3. Tables written exclusively through SECURITY DEFINER RPCs get SELECT
--     policies only. The client cannot forge a sale, a stock movement or a
--     register session, no matter what it sends.
--  4. Frontend permission checks hide buttons. They never authorise.

-- ── Standard org-scoped tables ────────────────────────────────────────────
-- (table, permission prefix, client may write?)
do $$
declare
  r record;
  t text;
begin
  for r in
    select * from (values
      -- tenancy
      ('branches',              'settings',  true),
      ('warehouses',            'settings',  true),
      ('registers',             'settings',  true),
      -- rbac
      ('roles',                 'roles',     true),
      ('role_permissions',      'roles',     true),
      ('user_roles',            'users',     true),
      -- catalogue
      ('product_categories',    'products',  true),
      ('product_brands',        'products',  true),
      ('product_units',         'settings',  true),
      ('taxes',                 'settings',  true),
      ('products',              'products',  true),
      ('product_variants',      'products',  true),
      ('product_barcodes',      'products',  true),
      ('product_option_types',  'products',  true),
      ('product_option_values', 'products',  true),
      ('product_images',        'products',  true),
      -- parties
      ('customers',             'customers', true),
      ('suppliers',             'suppliers', true),
      -- money
      ('payment_methods',       'settings',  true),
      ('expense_categories',    'expenses',  true),
      ('plugins',               'plugins',   true),
      -- RPC-written: SELECT only
      ('register_sessions',     'register',      false),
      ('stock_balances',        'inventory',     false),
      ('stock_movements',       'inventory',     false),
      ('stock_transfers',       'inventory',     false),
      ('stock_transfer_items',  'inventory',     false),
      ('expenses',              'expenses',      false),
      ('sales',                 'sales',         false),
      ('sale_items',            'sales',         false),
      ('sale_payments',         'sales',         false),
      ('sale_returns',          'sales',         false),
      ('sale_return_items',     'sales',         false),
      ('sale_return_payments',  'sales',         false),
      ('purchases',             'purchases',     false),
      ('purchase_items',        'purchases',     false),
      ('purchase_payments',     'purchases',     false),
      ('plugin_migrations',     'plugins',       false),
      ('sequences',             'settings',      false)
    ) as v(tbl, perm, writable)
  loop
    t := r.tbl;

    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format(
      'create policy %I on public.%I for select using (app.in_org(organization_id))',
      t || '_select', t
    );

    if r.writable then
      execute format(
        'create policy %I on public.%I for insert with check (
           app.in_org(organization_id)
           and app.has_permission(%L)
         )',
        t || '_insert', t, r.perm || '.create'
      );

      execute format(
        'create policy %I on public.%I for update using (
           app.in_org(organization_id)
           and app.has_permission(%L)
         ) with check (app.in_org(organization_id))',
        t || '_update', t, r.perm || '.edit'
      );

      execute format(
        'create policy %I on public.%I for delete using (
           app.in_org(organization_id)
           and app.has_permission(%L)
         )',
        t || '_delete', t, r.perm || '.delete'
      );
    end if;
  end loop;
end;
$$;

-- ── organizations ─────────────────────────────────────────────────────────
-- A user may read the organizations they belong to, and edit those they
-- administer. There is no organizations.organization_id — the row *is* the
-- organization.
alter table public.organizations enable row level security;
alter table public.organizations force row level security;

create policy organizations_select on public.organizations for select
  using (app.in_org(id));

create policy organizations_update on public.organizations for update
  using (app.in_org(id) and app.has_permission('settings.business'))
  with check (app.in_org(id));

-- ── permissions: a global catalogue ───────────────────────────────────────
-- Readable by any signed-in user (the UI needs it to build role editors and
-- gate navigation). Written only by service-role code in Edge Functions,
-- which bypasses RLS by design.
alter table public.permissions enable row level security;
alter table public.permissions force row level security;

create policy permissions_select on public.permissions for select
  using (auth.uid() is not null);

-- ── user_organizations: the RLS root ──────────────────────────────────────
-- Deliberately permissive for one's own row and nothing else. app.* helpers
-- read this table SECURITY DEFINER, so this policy does not recurse.
alter table public.user_organizations enable row level security;
alter table public.user_organizations force row level security;

create policy user_organizations_select_own on public.user_organizations for select
  using (user_id = auth.uid());

-- ── outbox ────────────────────────────────────────────────────────────────
-- Clients read it for the Realtime bridge (docs/02 §3) but never write it;
-- only the transactional RPCs insert events.
alter table public.outbox enable row level security;
alter table public.outbox force row level security;

create policy outbox_select on public.outbox for select
  using (app.in_org(organization_id));

-- ── audit_logs ────────────────────────────────────────────────────────────
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

create policy audit_logs_select on public.audit_logs for select
  using (app.in_org(organization_id) and app.has_permission('audit.view'));

-- ── Branch isolation on operational tables ────────────────────────────────
-- A branch manager must not read another branch's trades (docs/07 §7).
-- These are additional restrictive policies, so they AND with the org
-- policies above.
create policy sales_branch_scope on public.sales for select
  using (branch_id = any(app.visible_branch_ids(organization_id)));

create policy register_sessions_branch_scope on public.register_sessions for select
  using (branch_id = any(app.visible_branch_ids(organization_id)));

create policy expenses_branch_scope on public.expenses for select
  using (branch_id = any(app.visible_branch_ids(organization_id)));

create policy purchases_branch_scope on public.purchases for select
  using (branch_id = any(app.visible_branch_ids(organization_id)));

-- ── Verification helper ───────────────────────────────────────────────────
-- Returns every public table missing RLS. CI fails if this is non-empty, so
-- a newly added table cannot quietly ship unprotected.
create or replace function app.tables_missing_rls()
returns table(table_name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
   order by 1
$$;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_016_reporting.sql
-- ══════════════════════════════════════════════════════════════════════

-- 016 — Reporting: the dashboard aggregate and supporting views.
--
-- One function, one round trip (docs/09 #10). Eight widgets as eight queries
-- means eight scans of `sales` every morning; this computes them together.
-- The Android dashboard calls the same function, so "today's numbers" has
-- exactly one implementation.

create or replace function public.dashboard_summary(
  p_branch_id uuid,
  p_day       date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org  uuid;
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
  v_out  jsonb;
begin
  select b.organization_id, coalesce(b.timezone, o.timezone)
    into v_org, v_tz
    from public.branches b
    join public.organizations o on o.id = b.organization_id
   where b.id = p_branch_id;

  if v_org is null then
    raise exception 'branch_not_found: %', p_branch_id using errcode = 'P0002';
  end if;
  perform app.require_org(v_org);
  perform app.require_permission('dashboard.view');

  -- Day boundaries in the branch's timezone, never server-local (docs/09 #14).
  v_from := (p_day::timestamp AT TIME ZONE v_tz);
  v_to   := ((p_day + 1)::timestamp AT TIME ZONE v_tz);

  select jsonb_build_object(
    'date', p_day,
    'timezone', v_tz,
    'currency', (select currency from public.organizations where id = v_org),

    'today_sales', coalesce((
      select sum(total) from public.sales
       where branch_id = p_branch_id
         and status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
         and created_at >= v_from and created_at < v_to), 0),

    'order_count', coalesce((
      select count(*) from public.sales
       where branch_id = p_branch_id
         and status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
         and created_at >= v_from and created_at < v_to), 0),

    'gross_profit', coalesce((
      select sum(profit) from public.sales
       where branch_id = p_branch_id
         and status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
         and created_at >= v_from and created_at < v_to), 0),

    'items_sold', coalesce((
      select sum(si.quantity)
        from public.sale_items si
        join public.sales s on s.id = si.sale_id
       where s.branch_id = p_branch_id
         and s.status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
         and s.created_at >= v_from and s.created_at < v_to), 0),

    'discount_given', coalesce((
      select sum(discount_total) from public.sales
       where branch_id = p_branch_id
         and created_at >= v_from and created_at < v_to), 0),

    'tax_collected', coalesce((
      select sum(tax_total) from public.sales
       where branch_id = p_branch_id
         and created_at >= v_from and created_at < v_to), 0),

    'today_expenses', coalesce((
      select sum(amount) from public.expenses
       where branch_id = p_branch_id and expense_date = p_day
         and deleted_at is null), 0),

    'refunds_today', coalesce((
      select sum(refund_total) from public.sale_returns sr
       where sr.branch_id = p_branch_id
         and sr.created_at >= v_from and sr.created_at < v_to), 0),

    'held_sales', coalesce((
      select count(*) from public.sales
       where branch_id = p_branch_id and status = 'HELD'), 0),

    'pending_payments', coalesce((
      select sum(total - paid_total) from public.sales
       where branch_id = p_branch_id and status = 'PARTIALLY_PAID'), 0),

    'customer_count', (
      select count(*) from public.customers
       where organization_id = v_org and deleted_at is null),

    'out_of_stock', coalesce((
      select count(distinct sb.product_id)
        from public.stock_balances sb
        join public.products p on p.id = sb.product_id
       where sb.organization_id = v_org
         and p.track_stock and p.is_active and p.deleted_at is null
         and sb.quantity <= 0), 0),

    'low_stock', coalesce((
      select count(distinct sb.product_id)
        from public.stock_balances sb
        join public.products p on p.id = sb.product_id
       where sb.organization_id = v_org
         and p.track_stock and p.is_active and p.deleted_at is null
         and sb.quantity > 0
         and sb.quantity <= p.reorder_point), 0),

    'stock_value', coalesce((
      select sum(sb.quantity * sb.avg_unit_cost)
        from public.stock_balances sb
       where sb.organization_id = v_org), 0),

    'expected_cash', (
      select sum(opening_cash + cash_in - cash_out
                 + sales_cash - refund_cash - expense_cash)
        from public.register_sessions
       where branch_id = p_branch_id and closed_at is null),

    'sales_by_hour', coalesce((
      select jsonb_agg(jsonb_build_object(
               'hour', h, 'total', t) order by h)
        from (
          select extract(hour from s.created_at at time zone v_tz)::int as h,
                 sum(s.total) as t
            from public.sales s
           where s.branch_id = p_branch_id
             and s.status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
             and s.created_at >= v_from and s.created_at < v_to
           group by 1
        ) x), '[]'::jsonb),

    'payment_mix', coalesce((
      select jsonb_agg(jsonb_build_object(
               'method', m.name, 'total', t) order by t desc)
        from (
          select sp.method_id, sum(sp.amount) as t
            from public.sale_payments sp
            join public.sales s on s.id = sp.sale_id
           where s.branch_id = p_branch_id
             and s.created_at >= v_from and s.created_at < v_to
           group by 1
        ) y
        join public.payment_methods m on m.id = y.method_id), '[]'::jsonb),

    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', product_name, 'qty', q, 'revenue', rev) order by rev desc)
        from (
          select si.product_name,
                 sum(si.quantity) as q,
                 sum(si.line_total) as rev
            from public.sale_items si
            join public.sales s on s.id = si.sale_id
           where s.branch_id = p_branch_id
             and s.status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
             and s.created_at >= v_from and s.created_at < v_to
           group by 1
           order by rev desc
           limit 10
        ) z), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$fn$;

-- Stock ledger with product context — the answer to "why 37 units?" (§12).
create or replace view public.stock_history as
  select sm.id,
         sm.organization_id,
         sm.warehouse_id,
         w.name          as warehouse_name,
         sm.variant_id,
         sm.product_id,
         p.name          as product_name,
         v.name_suffix   as variant_name,
         sm.type,
         sm.quantity,
         sm.direction,
         sm.quantity * sm.direction as delta,
         sm.before_quantity,
         sm.after_quantity,
         sm.unit_cost,
         sm.reference_type,
         sm.reference_id,
         sm.user_id,
         sm.note,
         sm.created_at
    from public.stock_movements sm
    join public.products p         on p.id = sm.product_id
    join public.product_variants v on v.id = sm.variant_id
    join public.warehouses w       on w.id = sm.warehouse_id;

-- Sales with profit and cashier, for report tables and CSV export.
create or replace view public.sales_detail as
  select s.id,
         s.organization_id,
         s.branch_id,
         b.name       as branch_name,
         s.invoice_no,
         s.status,
         s.customer_id,
         c.name       as customer_name,
         s.subtotal,
         s.discount_total,
         s.tax_total,
         s.total,
         s.paid_total,
         s.cogs,
         s.profit,
         s.created_by,
         s.created_at,
         s.completed_at
    from public.sales s
    join public.branches b    on b.id = s.branch_id
    left join public.customers c on c.id = s.customer_id;

-- Low stock across an organization, for the reorder screen and badge.
create or replace view public.low_stock as
  select p.id            as product_id,
         p.organization_id,
         p.name,
         p.sku,
         v.id            as variant_id,
         v.name_suffix,
         sb.warehouse_id,
         w.name          as warehouse_name,
         sb.quantity,
         p.reorder_point,
         sb.avg_unit_cost,
         (sb.quantity * sb.avg_unit_cost) as stock_value
    from public.stock_balances sb
    join public.products p         on p.id = sb.product_id
    join public.product_variants v on v.id = sb.variant_id
    join public.warehouses w       on w.id = sb.warehouse_id
   where p.track_stock
     and p.is_active
     and p.deleted_at is null
     and sb.quantity <= p.reorder_point;

-- Realtime: clients subscribe to outbox filtered by organization so the JS
-- EventBus can mirror authoritative events (docs/02 §3).
alter publication supabase_realtime add table public.outbox;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_017_provisioning.sql
-- ══════════════════════════════════════════════════════════════════════

-- 017 — Organization provisioning.
--
-- This is a production API function, not seed data: the signup flow calls it
-- to turn a new auth user into a fully configured organization (spec §60).
-- It lives here rather than in supabase/seed/ so that the grants migration
-- can reference it and so it ships with the schema.
--
-- Roles, units, payment methods and categories are per-organization, so they
-- cannot be seeded globally. This function creates them for one organization
-- in a single call.

create or replace function public.provision_organization(
  p_owner_user_id uuid,
  p_org_name      text,
  p_slug          text,
  p_shop_type     text,
  p_currency      char(3)   default 'BDT',
  p_timezone      text      default 'Asia/Dhaka',
  p_branch_name   text      default 'Main Store',
  p_categories    text[]    default '{}',
  p_payment_keys  text[]    default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org       uuid := gen_random_uuid();
  v_branch    uuid := gen_random_uuid();
  v_warehouse uuid := gen_random_uuid();
  v_register  uuid := gen_random_uuid();
  v_role      uuid;
  v_unit      text;
  v_key       text;
  v_name      text;
  v_symbol    text;
  v_decimal   boolean;
  v_sort      int := 0;
begin
  if not exists (select 1 from auth.users where id = p_owner_user_id) then
    raise exception 'owner_user_not_found: %', p_owner_user_id
      using errcode = 'P0002';
  end if;

  -- A caller may provision an organization for themselves and nobody else.
  -- The service role (auth.uid() is null) acts on a user's behalf during
  -- signup and is exempt.
  if auth.uid() is not null and p_owner_user_id <> auth.uid() then
    raise exception 'cannot provision an organization for another user'
      using errcode = '42501';
  end if;

  -- ── Organization ────────────────────────────────────────────────────────
  insert into public.organizations
        (id, name, slug, shop_type, currency, timezone)
  values (v_org, p_org_name, p_slug, p_shop_type, p_currency, p_timezone);

  insert into public.user_organizations (user_id, organization_id)
  values (p_owner_user_id, v_org);

  insert into public.branches
        (id, organization_id, name, code, is_primary)
  values (v_branch, v_org, p_branch_name, 'MAIN', true);

  insert into public.warehouses
        (id, organization_id, branch_id, name, code, is_retail_floor)
  values (v_warehouse, v_org, v_branch, p_branch_name || ' Floor', 'FLOOR', true);

  insert into public.registers
        (id, organization_id, branch_id, name, code)
  values (v_register, v_org, v_branch, 'Counter 1', 'C1');

  -- ── Roles ───────────────────────────────────────────────────────────────
  insert into public.roles (id, organization_id, key, name, is_system)
  values
    (gen_random_uuid(), v_org, 'owner',             'Owner',             true),
    (gen_random_uuid(), v_org, 'admin',             'Admin',             true),
    (gen_random_uuid(), v_org, 'manager',           'Manager',           true),
    (gen_random_uuid(), v_org, 'cashier',           'Cashier',           true),
    (gen_random_uuid(), v_org, 'inventory_manager', 'Inventory Manager', true),
    (gen_random_uuid(), v_org, 'accountant',        'Accountant',        true);

  -- Owner: the '*' wildcard, which app.has_permission() matches against every
  -- key — including permissions plugins add later. That is intended for the
  -- owner role and for nothing else.
  insert into public.permissions (key, label, category, description)
  values ('*', 'All permissions', 'system',
          'Wildcard grant. Matched at check time, so it covers permissions added later.')
  on conflict (key) do nothing;

  select id into v_role from public.roles
   where organization_id = v_org and key = 'owner';
  insert into public.role_permissions (organization_id, role_id, permission_id)
  select v_org, v_role, id from public.permissions where key = '*';

  -- Admin: explicit grants of everything that exists today. Deliberately not
  -- a wildcard, so enabling a plugin later does not silently widen admin
  -- rights without the Plugins screen showing the impact (docs/07 §4).
  select id into v_role from public.roles
   where organization_id = v_org and key = 'admin';
  insert into public.role_permissions (organization_id, role_id, permission_id)
  select v_org, v_role, id from public.permissions
   where key <> '*' and key <> 'users.delete';

  -- Manager: runs the shop, cannot manage users or plugins.
  select id into v_role from public.roles
   where organization_id = v_org and key = 'manager';
  insert into public.role_permissions (organization_id, role_id, permission_id)
  select v_org, v_role, id from public.permissions
   where key = 'dashboard.view'
      or key like 'sales.%'      and key <> 'sales.view_all_branches'
      or key like 'products.%'   and key not in ('products.delete','products.import','products.export')
      or key like 'inventory.%'
      or key like 'purchases.%'  and key <> 'purchases.approve'
      or key like 'customers.%'  and key <> 'customers.delete'
      or key like 'suppliers.%'
      or key like 'expenses.%'   and key <> 'expenses.delete'
      or key in ('reports.view','analytics.view','register.open','register.close',
                 'register.adjust_cash');

  -- Cashier: sells. Note sales.discount is NOT granted by default — whether a
  -- cashier may discount is a policy decision each shop makes differently,
  -- so it is a permission rather than a setting (docs/07 §5).
  select id into v_role from public.roles
   where organization_id = v_org and key = 'cashier';
  insert into public.role_permissions (organization_id, role_id, permission_id)
  select v_org, v_role, id from public.permissions
   where key in ('dashboard.view','sales.view','sales.create','sales.hold',
                 'sales.resume','products.view','customers.view','customers.create',
                 'inventory.view','register.open','register.close');

  select id into v_role from public.roles
   where organization_id = v_org and key = 'inventory_manager';
  insert into public.role_permissions (organization_id, role_id, permission_id)
  select v_org, v_role, id from public.permissions
   where key = 'dashboard.view'
      or key like 'products.%'
      or key like 'inventory.%'
      or key like 'purchases.%'
      or key like 'suppliers.%'
      or key = 'reports.view';

  select id into v_role from public.roles
   where organization_id = v_org and key = 'accountant';
  insert into public.role_permissions (organization_id, role_id, permission_id)
  select v_org, v_role, id from public.permissions
   where key = 'dashboard.view'
      or key like 'reports.%'
      or key = 'analytics.view'
      or key like 'expenses.%'
      or key = 'purchases.view'
      or key = 'sales.view_all_branches';

  -- ── Owner membership ────────────────────────────────────────────────────
  insert into public.user_roles (user_id, organization_id, branch_id, role_id, granted_by)
  select p_owner_user_id, v_org, null, id, p_owner_user_id
    from public.roles where organization_id = v_org and key = 'owner';

  -- ── Units ───────────────────────────────────────────────────────────────
  foreach v_unit in array array[
    'Each|ea|false', 'Kilogram|kg|true', 'Gram|g|true', 'Litre|L|true',
    'Millilitre|mL|true', 'Metre|m|true', 'Feet|ft|true', 'Dozen|dz|false',
    'Pack|pk|false', 'Box|bx|false', 'Pair|pr|false', 'Set|set|false',
    'Hour|hr|false'
  ]
  loop
    v_name    := split_part(v_unit, '|', 1);
    v_symbol  := split_part(v_unit, '|', 2);
    v_decimal := split_part(v_unit, '|', 3) = 'true';
    v_sort    := v_sort + 10;
    insert into public.product_units
          (organization_id, name, symbol, is_decimal, sort_order)
    values (v_org, v_name, v_symbol, v_decimal, v_sort)
    on conflict (organization_id, name) do nothing;
  end loop;

  -- ── Payment methods ─────────────────────────────────────────────────────
  -- Generic defaults. Country-specific methods (bKash, Nagad, PayPal, …) are
  -- added by the setup wizard from the shop-type profile, never hardcoded
  -- here (spec §15).
  if cardinality(p_payment_keys) = 0 then
    insert into public.payment_methods
          (organization_id, key, name, type, is_cash, sort_order)
    values
      (v_org, 'cash',    'Cash',           'cash',   true,  10),
      (v_org, 'mobile',  'Mobile Banking', 'mobile', false, 20),
      (v_org, 'card',    'Card',           'card',   false, 30),
      (v_org, 'bank',    'Bank Transfer',  'bank',   false, 40),
      (v_org, 'credit',  'Credit',         'credit', false, 50),
      (v_org, 'other',   'Other',          'other',  false, 60);
  else
    v_sort := 0;
    foreach v_key in array p_payment_keys loop
      v_sort := v_sort + 10;
      insert into public.payment_methods
            (organization_id, key, name, type, is_cash, sort_order)
      values (v_org, lower(v_key), initcap(v_key),
              case when lower(v_key) = 'cash' then 'cash' else 'other' end,
              lower(v_key) = 'cash',
              v_sort)
      on conflict (organization_id, key) do nothing;
    end loop;
  end if;

  -- ── Categories ──────────────────────────────────────────────────────────
  v_sort := 0;
  foreach v_name in array p_categories loop
    v_sort := v_sort + 10;
    insert into public.product_categories
          (organization_id, name, slug, sort_order)
    values (v_org, v_name, lower(replace(v_name, ' ', '-')), v_sort)
    on conflict do nothing;
  end loop;

  -- ── Opening the audit trail ─────────────────────────────────────────────
  insert into public.audit_logs
        (organization_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, p_owner_user_id, 'organization.provisioned', 'organization',
          v_org,
          jsonb_build_object('name', p_org_name, 'shop_type', p_shop_type,
                             'currency', p_currency));

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'organization.provisioned', 'organization', v_org,
          jsonb_build_object('organization_id', v_org, 'shop_type', p_shop_type));

  return v_org;
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_018_grants.sql
-- ══════════════════════════════════════════════════════════════════════

-- 018 — Function privileges.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default. Every
-- function above is therefore callable by any signed-in client unless that
-- is taken away. Several are internal building blocks with no permission
-- check of their own — apply_stock_movement in particular would let a client
-- write the stock ledger directly.
--
-- So: revoke everything, then grant back only the intended API surface.

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from authenticated;
revoke execute on all functions in schema app from public;
revoke execute on all functions in schema app from anon;
revoke execute on all functions in schema app from authenticated;

-- ── The client-facing API ─────────────────────────────────────────────────
-- Each of these performs its own app.require_permission() check, so granting
-- EXECUTE is not the authorization — it only makes the call reachable.

grant execute on function public.complete_sale(
  uuid, jsonb, jsonb, uuid, uuid, uuid, text, numeric, text
) to authenticated;

grant execute on function public.hold_sale(uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.resume_sale(uuid) to authenticated;

grant execute on function public.refund_sale(uuid, jsonb, jsonb, text, boolean)
  to authenticated;

grant execute on function public.adjust_stock(uuid, uuid, numeric, text, smallint, text)
  to authenticated;

grant execute on function public.receive_purchase(uuid, jsonb, jsonb) to authenticated;

grant execute on function public.open_register(uuid, numeric, text) to authenticated;
grant execute on function public.close_register(uuid, numeric, text) to authenticated;
grant execute on function public.register_cash_movement(uuid, numeric, smallint, text)
  to authenticated;
grant execute on function public.record_expense(
  uuid, numeric, uuid, uuid, text, uuid, date
) to authenticated;

grant execute on function public.dashboard_summary(uuid, date) to authenticated;

-- Signup path: any authenticated user may provision their own organization.
-- The function itself enforces that the owner must be the caller.
grant execute on function public.provision_organization(
  uuid, text, text, text, char, text, text, text[], text[]
) to authenticated;

-- Read-only helpers used to build the UI.
grant execute on function app.current_org_ids() to authenticated;
grant execute on function app.current_branch_id() to authenticated;
grant execute on function app.has_permission(text) to authenticated;
grant execute on function app.visible_branch_ids(uuid) to authenticated;
grant execute on function app.in_org(uuid) to authenticated;

-- ── Deliberately NOT granted ──────────────────────────────────────────────
--   apply_stock_movement   internal ledger primitive; only callable from
--                          SECURITY DEFINER functions owned by postgres
--   next_sequence          internal counter
--   app.require_permission / app.require_org / app.in_visible_branch
--                          internal guards
--   app.tables_missing_rls CI-only introspection
--   set_updated_at, refresh_product_search_text, prevent_movement_mutation
--                          trigger functions
--
-- These stay reachable only to the function owner, which is what makes the
-- RPC layer the single write path.

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_019_session_payload.sql
-- ══════════════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_020_rls_helper_grants.sql
-- ══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- Mekholi — 020: RLS helper grants for the anon role
--
-- WHY THIS EXISTS
--
-- Migration 018 revoked EXECUTE on every function from `anon` and
-- `authenticated`, then granted back only the intended API surface. That was
-- right for the RPCs and right for the internal helpers — but it also
-- removed `anon`'s ability to call the three `app.*` helpers that RLS policy
-- expressions invoke:
--
--     app.in_org(uuid)              127 policy references
--     app.has_permission(text)       65 policy references
--     app.visible_branch_ids(uuid)    4 policy references
--
-- A policy expression runs as the *querying* role, not the table owner, so
-- `anon` needs EXECUTE to evaluate it. Without it, every anonymous read of a
-- protected table failed with:
--
--     42501 permission denied for function in_org
--
-- instead of simply returning no rows.
--
-- WHY THIS IS SAFE
--
-- All three are keyed on `auth.uid()`, which is NULL for an anonymous
-- caller:
--
--     app.current_org_ids()      → '{}'      (where user_id = NULL matches nothing)
--     app.in_org(x)              → false     (x = any('{}'))
--     app.has_permission(k)      → false     (where user_id = NULL)
--     app.visible_branch_ids(o)  → '{}'
--
-- They are SECURITY DEFINER with a pinned search_path, so the caller gains no
-- access to the underlying tables — only the boolean/array answer, which for
-- an anonymous caller is always empty. RLS then filters to zero rows, which
-- is the correct answer.
--
-- The internal helpers (`apply_stock_movement`, `next_sequence`,
-- `app.require_*`) stay revoked from both roles. Those are not referenced by
-- any policy and must remain unreachable.
--
-- Found by applying the schema to a live Supabase project: PGlite runs as a
-- superuser, so GRANT/REVOKE are not enforced during local validation and
-- this class of bug is invisible there. tools/validate-migrations.mjs now
-- checks it statically instead.
-- ═══════════════════════════════════════════════════════════════════════

grant execute on function app.in_org(uuid)              to anon;
grant execute on function app.has_permission(text)      to anon;
grant execute on function app.visible_branch_ids(uuid)  to anon;

comment on function app.in_org(uuid) is
  'Safe for anon: returns false when auth.uid() is null. RLS policies call it, so both roles need EXECUTE.';

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_021_sale_totals_and_hold.sql
-- ══════════════════════════════════════════════════════════════════════

-- 021 — Correct sale totals for tax-inclusive pricing; close the hold loop.
--
-- Two defects, both found by writing the client-side cart arithmetic in
-- src/shared/domain/cart.ts and checking it against the database.
--
-- 1. TAX-INCLUSIVE PRODUCTS WERE OVERCHARGED.
--    complete_sale computed v_line_total correctly for an inclusive line
--    (v_taxable, tax already inside) and then never used it, summing
--    `v_subtotal - v_discount_total + v_tax_total` instead. v_subtotal
--    already contains the VAT for an inclusive product, so the VAT was added
--    a second time. Proven against live Postgres: a ৳115 VAT-inclusive soap
--    with a 15% rate charged ৳130. Every shop using inclusive pricing —
--    the normal case for Bangladeshi retail — was overcharging by the tax.
--
--    Fixed by summing v_line_total into v_line_sum and using that. For an
--    all-tax-exclusive cart the old and new expressions are identical, so
--    existing behaviour is preserved where it was already correct.
--
-- 2. A RESUMED SALE COULD NEVER BE COMPLETED.
--    resume_sale flipped HELD → DRAFT, but complete_sale always inserts a
--    new row, so the DRAFT was orphaned and the hold list kept showing a
--    cart that had already been served. resume_sale now returns the stored
--    lines so the client can rebuild the cart, and leaves the row HELD;
--    complete_sale takes p_held_sale_id and cancels it atomically.
--
--    hold_sale also now persists per-line discounts, which it previously
--    discarded — resuming a discounted cart silently lost the discount.

-- The old 9-parameter signature must be dropped explicitly. `create or
-- replace` only replaces a function whose signature matches exactly, so
-- adding p_held_sale_id would otherwise leave two overloads behind — and
-- every existing 9-argument call would then fail with
-- "function public.complete_sale(...) is not unique" (SQLSTATE 42725).
-- The migration validator caught this; a call site that had not been
-- exercised yet would have found it in production instead.
drop function if exists public.complete_sale(
  uuid, jsonb, jsonb, uuid, uuid, uuid, text, numeric, text
);

create or replace function public.complete_sale(
  p_branch_id      uuid,
  p_items          jsonb,
  p_payments       jsonb,
  p_register_id    uuid     default null,
  p_customer_id    uuid     default null,
  p_warehouse_id   uuid     default null,
  p_discount_type  text     default null,
  p_discount_value numeric  default null,
  p_note           text     default null,
  -- The HELD row this cart was resumed from, if any. Cancelled in the same
  -- transaction so a crash cannot leave a stale hold on the sidebar.
  p_held_sale_id   uuid     default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org            uuid;
  v_warehouse      uuid;
  v_session        uuid;
  v_currency       char(3);
  v_sale_id        uuid := gen_random_uuid();
  v_invoice_no     text;
  v_seq            bigint;
  v_item           jsonb;
  v_variant        uuid;
  v_product        uuid;
  v_qty            numeric(14,3);
  v_unit_price     numeric(14,2);
  v_unit_cost      numeric(14,4);
  v_balance        numeric(14,3);
  v_allow_negative boolean;
  v_track_stock    boolean;
  v_tax_rate       numeric(6,4);
  v_tax_inclusive  boolean;
  v_disc_type      text;
  v_disc_value     numeric(14,4);
  v_line_disc      numeric(14,2);
  v_taxable        numeric(14,2);
  v_tax            numeric(14,2);
  v_line_total     numeric(14,2);
  v_subtotal       numeric(14,2) := 0;
  v_tax_total      numeric(14,2) := 0;
  v_discount_total numeric(14,2) := 0;
  v_line_sum       numeric(14,2) := 0;
  v_order_disc     numeric(14,2) := 0;
  v_held_org       uuid;
  v_cogs           numeric(14,2) := 0;
  v_total          numeric(14,2);
  v_paid           numeric(14,2) := 0;
  v_change         numeric(14,2) := 0;
  v_status         public.sale_status;
  v_pay            jsonb;
  v_cash_amount    numeric(14,2) := 0;
  v_name           text;
  v_suffix         text;
  v_sku            text;
  v_unit_label     text;
begin
  -- ── Authorization ───────────────────────────────────────────────────────
  select organization_id into v_org from public.branches
   where id = p_branch_id and deleted_at is null;
  if v_org is null then
    raise exception 'branch_not_found: %', p_branch_id using errcode = 'P0002';
  end if;
  perform app.require_org(v_org);
  perform app.require_permission('sales.create');

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  select currency into v_currency from public.organizations where id = v_org;

  -- Default to the branch's retail floor, else its first warehouse.
  v_warehouse := coalesce(
    p_warehouse_id,
    (select id from public.warehouses
      where organization_id = v_org and branch_id = p_branch_id
        and is_retail_floor and deleted_at is null
      order by created_at limit 1),
    (select id from public.warehouses
      where organization_id = v_org and branch_id = p_branch_id
        and deleted_at is null
      order by created_at limit 1)
  );
  if v_warehouse is null then
    raise exception 'no_warehouse_for_branch: %', p_branch_id using errcode = 'P0002';
  end if;

  -- The register session the sale belongs to, if one is open.
  select rs.id into v_session
    from public.register_sessions rs
   where rs.register_id = p_register_id and rs.closed_at is null
   limit 1;

  -- ── Invoice number and sale shell ───────────────────────────────────────
  -- Created before the line items, because sale_items and sale_payments carry
  -- a foreign key to it. Totals start at zero and are finalised below.
  v_seq := public.next_sequence(v_org, 'invoice:' || to_char(now(), 'YYYY'));
  v_invoice_no := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 6, '0');

  insert into public.sales (
    id, organization_id, branch_id, register_id, session_id, invoice_no,
    customer_id, status, currency, note, created_by
  ) values (
    v_sale_id, v_org, p_branch_id, p_register_id, v_session, v_invoice_no,
    p_customer_id, 'DRAFT', v_currency, p_note, auth.uid()
  );

  -- ── Line items ──────────────────────────────────────────────────────────
  -- Balance rows must exist before FOR UPDATE has anything to lock.
  insert into public.stock_balances
        (organization_id, warehouse_id, variant_id, product_id)
  select v_org, v_warehouse, v.id, v.product_id
    from jsonb_array_elements(p_items) as i
    join public.product_variants v on v.id = (i ->> 'variant_id')::uuid
  on conflict (warehouse_id, variant_id) do nothing;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant := (v_item ->> 'variant_id')::uuid;
    v_qty     := (v_item ->> 'qty')::numeric(14,3);

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity: %', v_item::text using errcode = '22023';
    end if;

    select p.id, p.name, p.sku, p.track_stock, p.allow_negative, p.tax_inclusive,
           coalesce(v.price_override, p.selling_price),
           coalesce(v.cost_override, p.cost_price),
           coalesce(t.rate, 0),
           u.symbol
      into v_product, v_name, v_sku, v_track_stock, v_allow_negative,
           v_tax_inclusive, v_unit_price, v_unit_cost, v_tax_rate, v_unit_label
      from public.product_variants v
      join public.products p on p.id = v.product_id
      left join public.taxes t on t.id = p.tax_id and t.is_active
      left join public.product_units u on u.id = p.unit_id
     where v.id = v_variant and v.deleted_at is null;

    if v_product is null then
      raise exception 'variant_not_found: %', v_variant using errcode = 'P0002';
    end if;

    select name_suffix into v_suffix
      from public.product_variants where id = v_variant;

    -- Lock the balance row. This is what makes concurrent sales safe.
    select quantity into v_balance
      from public.stock_balances
     where warehouse_id = v_warehouse and variant_id = v_variant
     for update;

    if v_track_stock and not v_allow_negative and v_balance < v_qty then
      raise exception 'insufficient_stock: % has %, needs %',
        v_name, v_balance, v_qty
        using errcode = 'P0003';
    end if;

    -- Per-line discount.
    v_disc_type  := v_item ->> 'discount_type';
    v_disc_value := coalesce((v_item ->> 'discount_value')::numeric(14,4), 0);
    v_line_disc := case
      when v_disc_type = 'PERCENT'
        then round(v_qty * v_unit_price * v_disc_value / 100.0, 2)
      when v_disc_type = 'FLAT'
        then least(round(v_disc_value, 2), v_qty * v_unit_price)
      else 0
    end;

    v_taxable := v_qty * v_unit_price - v_line_disc;

    if v_tax_inclusive then
      v_tax        := round(v_taxable * v_tax_rate / (100 + v_tax_rate), 2);
      v_line_total := v_taxable;
    else
      v_tax        := round(v_taxable * v_tax_rate / 100.0, 2);
      v_line_total := v_taxable + v_tax;
    end if;

    insert into public.sale_items (
      sale_id, organization_id, variant_id, product_id, product_name,
      variant_name, sku, unit_label, quantity, unit_price, unit_cost,
      discount_type, discount_value, discount_total, tax_rate, tax_total,
      line_total, line_cogs
    ) values (
      v_sale_id, v_org, v_variant, v_product, v_name,
      v_suffix, v_sku, v_unit_label, v_qty, v_unit_price, v_unit_cost,
      v_disc_type, nullif(v_disc_value, 0), v_line_disc, v_tax_rate, v_tax,
      v_line_total, round(v_qty * v_unit_cost, 2)
    );

    -- Ledger + balance, in the same transaction, under the same lock.
    if v_track_stock then
      insert into public.stock_movements (
        organization_id, warehouse_id, variant_id, product_id, type,
        quantity, direction, before_quantity, after_quantity, unit_cost,
        reference_type, reference_id, user_id
      ) values (
        v_org, v_warehouse, v_variant, v_product, 'SALE',
        v_qty, -1, v_balance, v_balance - v_qty, v_unit_cost,
        'sale', v_sale_id, auth.uid()
      );

      update public.stock_balances
         set quantity = quantity - v_qty
       where warehouse_id = v_warehouse and variant_id = v_variant;
    end if;

    v_subtotal       := v_subtotal + (v_qty * v_unit_price);
    v_discount_total := v_discount_total + v_line_disc;
    v_tax_total      := v_tax_total + v_tax;
    v_cogs           := v_cogs + round(v_qty * v_unit_cost, 2);
    v_line_sum       := v_line_sum + v_line_total;
  end loop;

  -- ── Order-level discount ────────────────────────────────────────────────
  --
  -- The total is the sum of the per-line totals, NOT
  -- `subtotal - discount + tax`. For a tax-INCLUSIVE line the selling price
  -- already contains the VAT, so adding v_tax_total on top charged the
  -- customer twice: a ৳115 VAT-inclusive soap was being sold for ৳130.
  -- Summing v_line_total handles both tax conventions with one formula, and
  -- for an all-exclusive cart the two expressions are algebraically
  -- identical, so shops that do not use inclusive pricing see no change.
  if p_discount_type = 'PERCENT' and coalesce(p_discount_value, 0) > 0 then
    v_order_disc := round((v_subtotal - v_discount_total) * p_discount_value / 100.0, 2);
  elsif p_discount_type = 'FLAT' and coalesce(p_discount_value, 0) > 0 then
    v_order_disc := least(round(p_discount_value, 2), v_subtotal - v_discount_total);
  end if;

  v_discount_total := v_discount_total + v_order_disc;
  v_total := v_line_sum - v_order_disc;
  if v_total < 0 then
    raise exception 'negative_total' using errcode = '22023';
  end if;

  -- ── Payments ────────────────────────────────────────────────────────────
  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    insert into public.sale_payments
          (sale_id, organization_id, method_id, amount, reference, received_by)
    values (v_sale_id, v_org,
            (v_pay ->> 'method_id')::uuid,
            (v_pay ->> 'amount')::numeric(14,2),
            v_pay ->> 'reference',
            auth.uid());

    v_paid := v_paid + (v_pay ->> 'amount')::numeric(14,2);

    if exists (select 1 from public.payment_methods
                where id = (v_pay ->> 'method_id')::uuid and is_cash) then
      v_cash_amount := v_cash_amount + (v_pay ->> 'amount')::numeric(14,2);
    end if;
  end loop;

  if v_paid < v_total then
    v_status := 'PARTIALLY_PAID';
  else
    v_status := 'COMPLETED';
    v_change := v_paid - v_total;
  end if;

  -- ── Finalise the sale ───────────────────────────────────────────────────
  -- The row was created up front (see above) so that sale_items and
  -- sale_payments had a parent to reference. Totals are only known now.
  update public.sales
     set status         = v_status,
         subtotal       = v_subtotal,
         discount_total = v_discount_total,
         discount_type  = p_discount_type,
         discount_value = p_discount_value,
         tax_total      = v_tax_total,
         total          = v_total,
         paid_total     = v_paid,
         change_due     = v_change,
         cogs           = v_cogs,
         completed_at   = case when v_status = 'COMPLETED' then now() end
   where id = v_sale_id;

  -- ── Close out the held cart this sale came from ─────────────────────────
  -- Held rows are cart bookmarks, not financial documents. Cancelling inside
  -- the same transaction means a crash can neither leave a stale hold on the
  -- sidebar nor cancel a hold whose sale never landed.
  if p_held_sale_id is not null then
    select organization_id into v_held_org
      from public.sales where id = p_held_sale_id;
    if v_held_org is distinct from v_org then
      raise exception 'held_sale_not_found: %', p_held_sale_id using errcode = 'P0002';
    end if;
    update public.sales
       set status = 'CANCELLED'
     where id = p_held_sale_id and status in ('HELD', 'DRAFT');
  end if;

  -- ── Register cash ───────────────────────────────────────────────────────
  if v_session is not null then
    update public.register_sessions
       set sales_cash = sales_cash + v_cash_amount
     where id = v_session;
  end if;

  -- ── Outbox: the authoritative event chain (docs/02 §3) ──────────────────
  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'sale.completed', 'sale', v_sale_id, jsonb_build_object(
    'sale_id',    v_sale_id,
    'invoice_no', v_invoice_no,
    'branch_id',  p_branch_id,
    'total',      v_total,
    'paid',       v_paid,
    'cogs',       v_cogs,
    'customer_id', p_customer_id
  ));

  return jsonb_build_object(
    'sale_id',    v_sale_id,
    'invoice_no', v_invoice_no,
    'status',     v_status,
    'subtotal',   v_subtotal,
    'discount',   v_discount_total,
    'tax',        v_tax_total,
    'total',      v_total,
    'paid',       v_paid,
    'change_due', v_change
  );
end;
$fn$;

-- Held sales are rows, not a second source of truth (docs/09 #11).

-- ── Hold / resume ─────────────────────────────────────────────────────────
-- A held sale is a cart bookmark, not a financial document: reports count
-- only COMPLETED, PARTIALLY_PAID and PARTIALLY_REFUNDED, so these rows are
-- invisible to the numbers either way.

create or replace function public.hold_sale(
  p_branch_id   uuid,
  p_items       jsonb,
  p_customer_id uuid default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid;
  v_id       uuid := gen_random_uuid();
  v_seq      bigint;
  v_total    numeric(14,2) := 0;
  v_item     jsonb;
  v_price    numeric(14,2);
  v_qty      numeric(14,3);
  v_variant  uuid;
  v_product  uuid;
  v_name     text;
  v_d_type   text;
  v_d_value  numeric(14,4);
  v_d_total  numeric(14,2);
begin
  select organization_id into v_org from public.branches where id = p_branch_id;
  perform app.require_org(v_org);
  perform app.require_permission('sales.hold');

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  v_seq := public.next_sequence(v_org, 'held');

  insert into public.sales (
    id, organization_id, branch_id, invoice_no, customer_id, status,
    currency, total, note, created_by
  )
  select v_id, v_org, p_branch_id,
         'HELD-' || lpad(v_seq::text, 6, '0'),
         p_customer_id, 'HELD',
         o.currency, 0, p_note, auth.uid()
    from public.organizations o where o.id = v_org;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant := (v_item ->> 'variant_id')::uuid;
    v_qty     := (v_item ->> 'qty')::numeric(14,3);
    v_d_type  := v_item ->> 'discount_type';
    v_d_value := coalesce((v_item ->> 'discount_value')::numeric(14,4), 0);

    select p.id, p.name, coalesce(v.price_override, p.selling_price)
      into v_product, v_name, v_price
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.id = v_variant;

    -- Same discount maths as complete_sale, so the held cart shows the
    -- figure the cashier will actually be asked to pay on resume.
    v_d_total := case
      when v_d_type = 'PERCENT'
        then round(v_qty * v_price * v_d_value / 100.0, 2)
      when v_d_type = 'FLAT'
        then least(round(v_d_value, 2), v_qty * v_price)
      else 0
    end;

    insert into public.sale_items (
      sale_id, organization_id, variant_id, product_id, product_name,
      quantity, unit_price, discount_type, discount_value, discount_total,
      line_total
    ) values (
      v_id, v_org, v_variant, v_product, v_name,
      v_qty, v_price, v_d_type, nullif(v_d_value, 0), v_d_total,
      v_qty * v_price - v_d_total
    );

    v_total := v_total + (v_qty * v_price);
  end loop;

  update public.sales set total = v_total, subtotal = v_total where id = v_id;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'sale.held', 'sale', v_id,
          jsonb_build_object('sale_id', v_id, 'total', v_total));

  return v_id;
end;
$fn$;

create or replace function public.resume_sale(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org    uuid;
  v_status public.sale_status;
  v_row    public.sales;
begin
  select organization_id, status into v_org, v_status
    from public.sales where id = p_sale_id;

  if v_org is null then
    raise exception 'sale_not_found: %', p_sale_id using errcode = 'P0001';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('sales.resume');

  if v_status <> 'HELD' then
    raise exception 'sale_not_held: status is %', v_status using errcode = '22023';
  end if;

  select * into v_row from public.sales where id = p_sale_id;

  -- Deliberately NOT flipping the row to DRAFT. The caller rebuilds its cart
  -- from the returned lines and then calls complete_sale(p_held_sale_id =>
  -- p_sale_id), which cancels this row in the same transaction as the sale.
  -- Leaving it HELD means a cashier who resumes and then walks away has not
  -- destroyed the only copy of that cart.
  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'sale.resumed', 'sale', p_sale_id,
          jsonb_build_object('sale_id', p_sale_id));

  return jsonb_build_object(
    'sale_id',     p_sale_id,
    'customer_id', v_row.customer_id,
    'note',        v_row.note,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'variant_id',     i.variant_id,
               'qty',            i.quantity,
               'discount_type',  i.discount_type,
               'discount_value', i.discount_value))
        from public.sale_items i
       where i.sale_id = p_sale_id
    ), '[]'::jsonb)
  );
end;
$fn$;

-- ── Grants ────────────────────────────────────────────────────────────────
-- Dropping the old signature dropped its grant with it, so the new one has to
-- be granted again or every authenticated call fails with 42501. EXECUTE here
-- is reachability, not authorization: each function still calls
-- app.require_permission() itself.

revoke execute on function public.complete_sale(
  uuid, jsonb, jsonb, uuid, uuid, uuid, text, numeric, text, uuid
) from anon, public;

grant execute on function public.complete_sale(
  uuid, jsonb, jsonb, uuid, uuid, uuid, text, numeric, text, uuid
) to authenticated;

-- hold_sale and resume_sale kept their signatures, so their grants from
-- migration 018 survive the `create or replace`. Re-asserting them anyway so
-- this file is self-contained if the migration order is ever replayed.
grant execute on function public.hold_sale(uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.resume_sale(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_022_pos_catalog_view.sql
-- ══════════════════════════════════════════════════════════════════════

-- 022 — The POS catalogue read path.
--
-- The point-of-sale screen needs one thing: "given what the cashier typed,
-- give me sellable products with their price, tax and stock." Assembled from
-- PostgREST that is five embedded resources plus two coalesces that the client
-- would have to redo on every keystroke — and every client (web, Android)
-- would have to agree on.
--
-- A view puts the coalescing where the columns are defined, so the rule
-- "a variant's price falls back to its product's price" exists once. The
-- client asks for rows; it never re-derives pricing.
--
-- `security_invoker = on` is the important line. Without it the view runs as
-- its owner and bypasses the row-level security on every table underneath,
-- which would hand any signed-in user every organization's catalogue. With it
-- the view is merely a saved query and the underlying policies still apply.

create or replace view public.pos_catalog
with (security_invoker = on)
as
select
  p.organization_id,
  p.id                                        as product_id,
  p.name,
  p.sku,
  p.description,
  p.image_url,
  p.track_stock,
  p.allow_negative,
  p.tax_inclusive,
  p.category_id,
  p.brand_id,
  p.reorder_point,
  p.search_text,
  p.metadata,
  v.id                                        as variant_id,
  v.name_suffix                               as variant_name,
  coalesce(v.sku, p.sku)                      as effective_sku,
  -- Price and cost resolution lives here and nowhere else. A variant may
  -- override either; when it does not, it inherits the product's.
  coalesce(v.price_override, p.selling_price) as price,
  coalesce(v.cost_override,  p.cost_price)    as cost,
  v.is_default,
  u.symbol                                    as unit_label,
  coalesce(u.is_decimal, false)               as decimal_quantity,
  coalesce(t.rate, 0)                         as tax_rate,
  c.name                                      as category_name,
  sb.warehouse_id,
  coalesce(sb.quantity, 0)                    as available
from public.products p
join public.product_variants v
  on v.product_id = p.id
 and v.deleted_at is null
 and v.is_active
left join public.product_units u on u.id = p.unit_id
left join public.taxes t         on t.id = p.tax_id and t.is_active
left join public.product_categories c on c.id = p.category_id
left join public.stock_balances sb    on sb.variant_id = v.id
where p.deleted_at is null
  and p.is_active;

comment on view public.pos_catalog is
  'One row per sellable variant per warehouse, with pricing already resolved. '
  'Read-only; security_invoker so the underlying RLS policies still apply.';

-- Barcode lookup needs no new index: `product_barcodes` already carries a
-- unique constraint on (organization_id, code), and a unique constraint is an
-- index. The POS resolves a scan by querying that table for the variant id
-- and then reading pos_catalog, so both steps are index-backed.

-- The sale list is always "this branch, newest first, one page". Without this
-- index the sales screen sorts the whole table on every navigation.
create index if not exists sales_branch_recent_idx
  on public.sales(branch_id, created_at desc, id desc)
  where status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED');

-- Held sales are polled for the sidebar badge; they are few and short-lived.
create index if not exists sales_held_idx
  on public.sales(organization_id, created_at desc)
  where status = 'HELD';

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_023_org_slug_uniqueness.sql
-- ══════════════════════════════════════════════════════════════════════

-- 023 — Organization slugs must survive a name collision.
--
-- `organizations.slug` is unique, and `provision_organization` inserted the
-- caller's slug verbatim. Two shopkeepers calling their shop "Rahim Store" —
-- which in Bangladesh is not an edge case, it is Tuesday — meant the second
-- signup died on `organizations_slug_key` with a raw Postgres error and no
-- shop. The slug is a machine handle; the name is what the shopkeeper typed.
-- The handle has to give way.
--
-- Fixed with a BEFORE INSERT trigger rather than inside the RPC, so every
-- caller gets it: the web signup path, the onboarding form, the service role,
-- a future Android client, a manual insert. Same reasoning as §51 — a
-- universal rule lives in the platform, not in one screen's copy of it.
--
-- Normalising and de-conflicting happen in ONE function on purpose. Postgres
-- fires same-timing triggers in name order, so two triggers would have to be
-- named to sort correctly; one function cannot be ordered wrong.

create or replace function public.derive_organization_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_slug text;
  v_n    int := 1;
begin
  -- Lowercase, non-alphanumerics collapsed to '-', trimmed. Bengali shop
  -- names reduce to nothing, which is why the name is only a fallback and
  -- 'shop' is the last resort — a slug nobody typed still beats a failed
  -- signup.
  v_base := btrim(regexp_replace(lower(coalesce(new.slug, '')), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then
    v_base := btrim(regexp_replace(lower(coalesce(new.name, '')), '[^a-z0-9]+', '-', 'g'), '-');
  end if;
  if v_base = '' then
    v_base := 'shop';
  end if;

  -- Serialise same-slug inserts. Without this the existence check below is a
  -- race: two concurrent signups for "Rahim Store" would both see the slug
  -- free and one would still fail the unique constraint. The lock is held
  -- until this transaction ends — exactly as long as it takes for the row to
  -- become visible to the other transaction.
  perform pg_advisory_xact_lock(hashtext('mekholi.organization_slug.' || v_base));

  v_slug := v_base;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  -- `security definer` matters here: the existence check must see *every*
  -- organization, and under RLS a plain authenticated caller would only see
  -- their own — which would let the trigger pick a slug another shop already
  -- holds, and the signup would fail anyway.
  new.slug := v_slug;
  return new;
end
$fn$;

drop trigger if exists organizations_derive_slug on public.organizations;
create trigger organizations_derive_slug
  before insert on public.organizations
  for each row execute function public.derive_organization_slug();

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_024_stock_operations.sql
-- ══════════════════════════════════════════════════════════════════════

-- 024 — Stock operations: receive, issue, transfer, and the overview numbers.
--
-- Migration 006 created the ledger, 013 the costing primitive, and 016 the
-- reporting views. What was missing was the middle: the operations a
-- shopkeeper actually performs. Three of them had no reachable path at all:
--
--   * Stock In could not carry a cost. `adjust_stock` passes 0 as the unit
--     cost, so receiving 20 units at ৳85 through it would have blended the
--     weighted average toward zero — silently corrupting the stock valuation
--     that the dashboard reports.
--   * Stock Out required `inventory.adjust`, which is the wrong permission
--     for "40 bottles broke": a cashier who may write off damage should not
--     thereby be able to post arbitrary corrections.
--   * Transfers had tables (`stock_transfers`, `stock_transfer_items`) and no
--     function. The tables could only be filled by hand.
--
-- Every function here delegates to `apply_stock_movement`, so the ledger
-- invariant (before + delta = after, and the balance equalling the sum of its
-- movements) holds for operations written years from now too. Nothing writes
-- `stock_balances` directly.

-- ── Stock in ─────────────────────────────────────────────────────────────
--
-- The receiving desk. Scan or pick the product, type the quantity and what it
-- cost, optionally name the supplier. Cost defaults to the variant's last
-- known cost so the common case is two fields.
create or replace function public.stock_in(
  p_warehouse_id uuid,
  p_items        jsonb,              -- [{variant_id, qty, unit_cost?}]
  p_supplier_id  uuid    default null,
  p_reference    text    default null,
  p_note         text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid;
  v_supplier uuid;
  v_item     jsonb;
  v_variant  uuid;
  v_qty      numeric(14,3);
  v_cost     numeric(14,4);
  v_after    numeric(14,3);
  v_before   numeric(14,3);
  v_lines    jsonb := '[]'::jsonb;
  v_qty_sum  numeric(14,3) := 0;
  v_cost_sum numeric(14,2) := 0;
  v_count    int := 0;
begin
  select organization_id into v_org from public.warehouses where id = p_warehouse_id;
  if v_org is null then
    raise exception 'warehouse_not_found: %', p_warehouse_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('inventory.stock_in');

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  -- A supplier named on a receipt must belong to the same shop, or the
  -- ledger row would point across tenants.
  if p_supplier_id is not null then
    select id into v_supplier
      from public.suppliers
     where id = p_supplier_id and organization_id = v_org and deleted_at is null;
    if v_supplier is null then
      raise exception 'supplier_not_found: %', p_supplier_id using errcode = 'P0002';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant := (v_item->>'variant_id')::uuid;
    v_qty     := (v_item->>'qty')::numeric(14,3);

    if v_variant is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item: %', v_item using errcode = '22023';
    end if;

    -- Falls back to the variant's last cost, then the product's, so a
    -- shopkeeper who does not remember the price is not forced to invent one.
    v_cost := coalesce(
      nullif(v_item->>'unit_cost', '')::numeric(14,4),
      (select cost_override from public.product_variants where id = v_variant),
      (select cost_price from public.products
        where id = (select product_id from public.product_variants where id = v_variant)),
      0
    );

    v_after := public.apply_stock_movement(
      p_warehouse_id, v_variant, 'PURCHASE', v_qty, v_cost,
      'stock_in', p_supplier_id, p_note
    );

    -- `after` minus the quantity received is `before`, exactly: the movement
    -- just written moved the balance by +qty. Reading it back from the ledger
    -- would be a second query for a number already known.
    v_before := v_after - v_qty;

    v_lines := v_lines || jsonb_build_object(
      'variant_id', v_variant, 'qty', v_qty, 'unit_cost', v_cost,
      'before', v_before, 'after', v_after
    );
    v_qty_sum  := v_qty_sum + v_qty;
    v_cost_sum := v_cost_sum + round(v_qty * v_cost, 2);
    v_count    := v_count + 1;
  end loop;

  return jsonb_build_object(
    'warehouse_id', p_warehouse_id,
    'supplier_id',  p_supplier_id,
    'reference',    p_reference,
    'lines',        v_lines,
    'line_count',   v_count,
    'total_qty',    v_qty_sum,
    'total_cost',   v_cost_sum
  );
end
$fn$;

-- ── Stock out ────────────────────────────────────────────────────────────
--
-- Damage, loss, expiry, theft: stock that left without being sold. The reason
-- picks the movement type, because "why did 37 become 33?" is the whole point
-- of the ledger and 'ADJUSTMENT_OUT' for a broken bottle answers nothing.
create or replace function public.stock_out(
  p_warehouse_id uuid,
  p_items        jsonb,              -- [{variant_id, qty}]
  p_reason       text,
  p_note         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org     uuid;
  v_reason  text := lower(btrim(coalesce(p_reason, '')));
  v_type    public.stock_movement_type;
  v_item    jsonb;
  v_variant uuid;
  v_qty     numeric(14,3);
  v_after   numeric(14,3);
  v_lines   jsonb := '[]'::jsonb;
  v_qty_sum numeric(14,3) := 0;
  v_count   int := 0;
begin
  select organization_id into v_org from public.warehouses where id = p_warehouse_id;
  if v_org is null then
    raise exception 'warehouse_not_found: %', p_warehouse_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('inventory.stock_out');

  if v_reason = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  -- An allow-list rather than a free string: the reason reaches the ledger as
  -- an enum, and an unknown one would silently become a generic adjustment.
  v_type := case v_reason
    when 'damage'  then 'DAMAGE'::public.stock_movement_type
    when 'damaged' then 'DAMAGE'::public.stock_movement_type
    when 'loss'    then 'LOSS'::public.stock_movement_type
    when 'lost'    then 'LOSS'::public.stock_movement_type
    when 'theft'   then 'LOSS'::public.stock_movement_type
    when 'expired' then 'EXPIRED'::public.stock_movement_type
    when 'expiry'  then 'EXPIRED'::public.stock_movement_type
    when 'other'   then 'ADJUSTMENT_OUT'::public.stock_movement_type
    else null
  end;
  if v_type is null then
    raise exception 'unknown_reason: %', p_reason
      using errcode = '22023',
            hint = 'damage, loss, theft, expired or other';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant := (v_item->>'variant_id')::uuid;
    v_qty     := (v_item->>'qty')::numeric(14,3);

    if v_variant is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item: %', v_item using errcode = '22023';
    end if;

    v_after := public.apply_stock_movement(
      p_warehouse_id, v_variant, v_type, v_qty, 0,
      'stock_out', null, coalesce(nullif(btrim(coalesce(p_note, '')), ''), v_reason)
    );

    v_lines := v_lines || jsonb_build_object(
      'variant_id', v_variant, 'qty', v_qty,
      'before', v_after + v_qty, 'after', v_after, 'reason', v_reason
    );
    v_qty_sum := v_qty_sum + v_qty;
    v_count   := v_count + 1;
  end loop;

  return jsonb_build_object(
    'warehouse_id', p_warehouse_id,
    'reason',       v_reason,
    'type',         v_type,
    'lines',        v_lines,
    'line_count',   v_count,
    'total_qty',    v_qty_sum
  );
end
$fn$;

-- ── Transfer between warehouses ──────────────────────────────────────────
--
-- One call, two movements per line, one shared cost. The cost matters: the
-- receiving warehouse must inherit the *sending* warehouse's average, or a
-- transfer would change what the shop's stock is worth — value is conserved
-- across a move, and any other behaviour is a bug the accounts would find
-- later and blame on the ledger.
create or replace function public.transfer_stock(
  p_from_warehouse_id uuid,
  p_to_warehouse_id   uuid,
  p_items             jsonb,          -- [{variant_id, qty}]
  p_note              text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org_from uuid;
  v_org_to   uuid;
  v_transfer uuid := gen_random_uuid();
  v_item     jsonb;
  v_variant  uuid;
  v_product  uuid;
  v_qty      numeric(14,3);
  v_avg      numeric(14,4);
begin
  select organization_id into v_org_from from public.warehouses where id = p_from_warehouse_id;
  select organization_id into v_org_to   from public.warehouses where id = p_to_warehouse_id;

  if v_org_from is null then
    raise exception 'warehouse_not_found: %', p_from_warehouse_id using errcode = 'P0002';
  end if;
  if v_org_to is null then
    raise exception 'warehouse_not_found: %', p_to_warehouse_id using errcode = 'P0002';
  end if;
  if v_org_from <> v_org_to then
    raise exception 'cannot transfer between organizations' using errcode = '42501';
  end if;
  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'transfer_to_same_warehouse' using errcode = '22023';
  end if;

  perform app.require_org(v_org_from);
  perform app.require_permission('inventory.transfer');

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  insert into public.stock_transfers
        (id, organization_id, from_warehouse_id, to_warehouse_id, status, note, created_by)
  values (v_transfer, v_org_from, p_from_warehouse_id, p_to_warehouse_id,
          'received', p_note, auth.uid());

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant := (v_item->>'variant_id')::uuid;
    v_qty     := (v_item->>'qty')::numeric(14,3);

    if v_variant is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item: %', v_item using errcode = '22023';
    end if;

    select product_id into v_product from public.product_variants where id = v_variant;
    if v_product is null then
      raise exception 'variant_not_found: %', v_variant using errcode = 'P0002';
    end if;

    -- Captured before the outbound movement, so both legs carry the same cost
    -- even though the outbound write is what settles the average.
    select avg_unit_cost into v_avg
      from public.stock_balances
     where warehouse_id = p_from_warehouse_id and variant_id = v_variant;
    v_avg := coalesce(v_avg, 0);

    insert into public.stock_transfer_items
          (organization_id, transfer_id, variant_id, product_id, quantity, unit_cost)
    values (v_org_from, v_transfer, v_variant, v_product, v_qty, v_avg);

    perform public.apply_stock_movement(
      p_from_warehouse_id, v_variant, 'TRANSFER_OUT', v_qty, v_avg,
      'stock_transfer', v_transfer, p_note
    );
    perform public.apply_stock_movement(
      p_to_warehouse_id, v_variant, 'TRANSFER_IN', v_qty, v_avg,
      'stock_transfer', v_transfer, p_note
    );
  end loop;

  return v_transfer;
end
$fn$;

-- ── The overview numbers ─────────────────────────────────────────────────
--
-- One call for the stock screen's header and the dashboard's stock card, so
-- the two can never disagree. `value` is the same expression the dashboard
-- summary uses (Σ quantity × avg_unit_cost) — the acceptance test for Phase 3
-- compares them for exact equality, so they must be computed the same way
-- rather than merely consistently.
create or replace function public.stock_summary(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid := p_organization_id;
begin
  -- The organization is passed explicitly rather than inferred: a user can
  -- belong to several shops, and the "active" one is a client-side choice.
  -- require_org rejects an id the caller is not a member of, so passing it is
  -- not a widening of access.
  perform app.require_org(v_org);
  perform app.require_permission('inventory.view');

  return jsonb_build_object(
    'stock_value', coalesce((
      select sum(sb.quantity * sb.avg_unit_cost)
        from public.stock_balances sb
       where sb.organization_id = v_org), 0),
    'variants_in_stock', coalesce((
      select count(*)
        from public.stock_balances sb
       where sb.organization_id = v_org and sb.quantity > 0), 0),
    'low_stock', coalesce((
      select count(*) from public.low_stock l where l.organization_id = v_org), 0),
    -- Out of stock is not the same as low: a shop reorders the two
    -- differently, so the screen reports them separately.
    'out_of_stock', coalesce((
      select count(*)
        from public.stock_balances sb
        join public.products p on p.id = sb.product_id
       where sb.organization_id = v_org
         and p.track_stock and p.is_active and p.deleted_at is null
         and sb.quantity <= 0), 0),
    'warehouses', coalesce((
      select count(*) from public.warehouses w
       where w.organization_id = v_org and w.deleted_at is null), 0),
    'movements_today', coalesce((
      select count(*) from public.stock_movements sm
       where sm.organization_id = v_org
         and sm.created_at >= date_trunc('day', now())), 0)
  );
end
$fn$;

-- ── Grants ───────────────────────────────────────────────────────────────
-- Same rule as 018: the client gets the operation, never the ledger
-- primitive. `apply_stock_movement` stays revoked from `authenticated`.
grant execute on function public.stock_in(uuid, jsonb, uuid, text, text) to authenticated;
grant execute on function public.stock_out(uuid, jsonb, text, text) to authenticated;
grant execute on function public.transfer_stock(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.stock_summary(uuid) to authenticated;

-- ── Realtime for the low-stock badge ─────────────────────────────────────
-- 016 added only `outbox`. A balance change is what makes a badge stale, and
-- RLS is applied to realtime rows, so a client receives only its own shop's
-- balances. Guarded: the publication may not exist outside Supabase.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.stock_balances;
    exception
      when duplicate_object then null;
    end;
  end if;
end
$$;
