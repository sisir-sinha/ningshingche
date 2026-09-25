-- Mekholi — full database schema.
--
-- GENERATED FILE — do not edit. Built by tools/build-schema.mjs from the
-- migrations in supabase/migrations/, which remain the source of truth.
-- Regenerate with: npm run build:schema
--
-- 30 migrations concatenated in order. Running this file on a
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

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_025_business_management.sql
-- ══════════════════════════════════════════════════════════════════════

-- 025 — Business management: purchase orders, supplier payments, store credit,
-- register reporting, and a real audit trail.
--
-- Phase 3 gave inventory its operations. This migration gives the rest of the
-- business its paperwork, and closes a gap that had been open since 011: the
-- `audit_logs` table existed, had a read policy gated on `audit.view`, and was
-- written by exactly one caller — provisioning. Every other action a
-- shopkeeper takes left no trace, so "who changed this price?" had no answer.
--
-- What already existed and is deliberately not duplicated here:
--   * `receive_purchase` (013) — full and partial receipt, supplier balance,
--     PURCHASE ledger rows, status transitions.
--   * `refund_sale` (013) — item-level refunds, RETURN_IN restock rows
--     referencing the original sale item, over-refund refused by the database.
--   * `record_expense` (014) — expense row plus the register's cash effect.
-- What was missing: creating the purchase order in the first place, paying a
-- supplier, refunding to store credit, reporting a register session, and
-- auditing any of it.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. The audit trail
-- ══════════════════════════════════════════════════════════════════════════
--
-- One generic trigger function, attached to the tables a shopkeeper can be
-- surprised by — prices, master data, commitments, permissions. Deliberately
-- NOT attached to the operational tables:
--
--   * `sales`, `sale_items`, `purchase_items` already have their own immutable
--     records and dedicated history screens; auditing them again would double
--     the write cost of every sale for information the shop can already see.
--   * `stock_movements` IS the audit trail for stock, by construction.
--
-- So the rule is: the ledger tables explain *transactions*; this explains
-- *configuration and commitments*. The acceptance criterion for the phase —
-- "every audited action shows actor, before and after" — is met by the
-- `audit_trail` view below, which joins the actor's email.

create or replace function app.record_audit()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $fn$
declare
  v_new      jsonb;
  v_old      jsonb;
  v_org      uuid;
  v_entity   uuid;
  v_action   text;
  v_entity_t text := tg_table_name;
  v_actor    uuid := auth.uid();
begin
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;

  -- A no-op update is not an audited event. `updated_at` is excluded because
  -- the BEFORE trigger has already touched it, so every save would otherwise
  -- look like a change.
  if tg_op = 'UPDATE' and (v_new - 'updated_at') = (v_old - 'updated_at') then
    return null;
  end if;

  -- Every audited table carries organization_id; a row without one cannot be
  -- attributed to a shop, and writing it would corrupt the tenancy scope the
  -- view is filtered by.
  v_org := coalesce(v_new ->> 'organization_id', v_old ->> 'organization_id')::uuid;
  if v_org is null then
    return null;
  end if;

  v_entity := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  v_action := case tg_op
    when 'INSERT' then 'create'
    when 'UPDATE' then 'update'
    else 'delete'
  end;

  insert into public.audit_logs
        (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (v_org, v_actor, v_action, v_entity_t, v_entity, v_old, v_new);

  return null;
end
$fn$;

-- Attached in a loop so the list reads as one decision rather than thirteen.
do $$
declare
  v_table text;
  v_tables text[] := array[
    'products',            -- price, cost, reorder point, active flag
    'product_variants',
    'categories',
    'brands',
    'units',
    'taxes',
    'customers',
    'suppliers',
    'purchases',           -- ordering a supplier is a commitment
    'expenses',
    'expense_categories',
    'payment_methods',
    'warehouses',
    'branches',
    'roles',
    'role_permissions',
    'user_roles',
    'settings'
  ];
begin
  foreach v_table in array v_tables loop
    -- Skip anything this deployment does not have, so the migration stays
    -- runnable against a partial schema rather than failing on a missing table.
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = v_table) then
      execute format('drop trigger if exists audit_%s on public.%I', v_table, v_table);
      execute format(
        'create trigger audit_%s after insert or update or delete on public.%I
           for each row execute function app.record_audit()',
        v_table, v_table
      );
    end if;
  end loop;
end
$$;

/**
 * The audit trail as a screen reads it: actor, when, what, and the before and
 * after images side by side.
 *
 * `security_invoker=on` so every caller goes through `audit_logs_select` — the
 * permission check and the organization scope are the table's, not the view's,
 * which is what stops this from being a hole in the tenancy wall.
 */
create or replace view public.audit_trail as
  select a.id,
         a.organization_id,
         a.created_at,
         a.action,
         a.entity_type,
         a.entity_id,
         a.actor_id,
         u.email          as actor_email,
         a.before,
         a.after,
         a.metadata
    from public.audit_logs a
    left join auth.users u on u.id = a.actor_id;

alter view public.audit_trail set (security_invoker = on);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Purchase orders
-- ══════════════════════════════════════════════════════════════════════════
--
-- `receive_purchase` could already receive an order; nothing could create one,
-- so `purchases` could only be filled by hand. This is the missing verb.
--
-- Two states are settable here: DRAFT (being written) and ORDERED (sent to the
-- supplier). Receipt moves it on from there. Creating an order is the moment
-- the shop owes money, so that is when the supplier's balance moves — not at
-- receipt, which changes where the goods are, not what they cost.
create or replace function public.save_purchase(
  p_warehouse_id uuid,
  p_items        jsonb,               -- [{variant_id, qty, unit_cost, tax_rate?}]
  p_supplier_id  uuid      default null,
  p_purchase_id  uuid      default null,   -- null creates, set to edit
  p_status       text      default 'ORDERED',
  p_reference_no text      default null,   -- the supplier's own invoice number
  p_note         text      default null,
  p_expected_at  date      default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid;
  v_branch   uuid;
  v_id       uuid := coalesce(p_purchase_id, gen_random_uuid());
  v_status   public.purchase_status;
  v_existing public.purchases;
  v_prev_status public.purchase_status;
  v_seq      bigint;
  v_no       text;
  v_item     jsonb;
  v_variant  uuid;
  v_product  uuid;
  v_name     text;
  v_qty      numeric(14,3);
  v_cost     numeric(14,4);
  v_rate     numeric(6,4);
  v_line     numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_tax      numeric(14,2) := 0;
  v_total    numeric(14,2) := 0;
  v_old_total numeric(14,2) := 0;
begin
  select organization_id, branch_id into v_org, v_branch
    from public.warehouses where id = p_warehouse_id and deleted_at is null;
  if v_org is null then
    raise exception 'warehouse_not_found: %', p_warehouse_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('purchases.create');

  v_status := upper(coalesce(p_status, 'ORDERED'))::public.purchase_status;
  if v_status not in ('DRAFT', 'ORDERED') then
    raise exception 'purchase_status_not_settable: %', v_status
      using errcode = '22023', hint = 'DRAFT or ORDERED';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  if p_supplier_id is not null then
    if not exists (select 1 from public.suppliers
                    where id = p_supplier_id and organization_id = v_org and deleted_at is null) then
      raise exception 'supplier_not_found: %', p_supplier_id using errcode = 'P0002';
    end if;
  end if;

  if p_purchase_id is not null then
    select * into v_existing from public.purchases where id = p_purchase_id;
    if v_existing.id is null then
      raise exception 'purchase_not_found: %', p_purchase_id using errcode = 'P0002';
    end if;
    if v_existing.organization_id <> v_org then
      raise exception 'purchase_belongs_to_another_organization' using errcode = '42501';
    end if;
    v_prev_status := v_existing.status;
    v_old_total := v_existing.total;

    -- Once goods have arrived the order is a record of what happened, not a
    -- plan. Editing it would desynchronise `received_qty` from what is on the
    -- shelf, and the ledger would no longer explain the balance.
    if exists (select 1 from public.purchase_items
                where purchase_id = p_purchase_id and received_qty > 0) then
      raise exception 'purchase_already_received' using errcode = '22023';
    end if;
    if v_existing.status in ('RECEIVED', 'CANCELLED') then
      raise exception 'purchase_not_editable: %', v_existing.status using errcode = '22023';
    end if;
  end if;

  -- Line arithmetic, summed the same way every other total in this schema is:
  -- round per line, then accumulate, so the printed total matches the lines a
  -- supplier would check by hand.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant := (v_item ->> 'variant_id')::uuid;
    v_qty     := (v_item ->> 'qty')::numeric(14,3);
    v_cost    := coalesce((v_item ->> 'unit_cost')::numeric(14,4), 0);
    v_rate    := coalesce((v_item ->> 'tax_rate')::numeric(6,4), 0);

    if v_variant is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item: %', v_item using errcode = '22023';
    end if;

    select product_id into v_product
      from public.product_variants
     where id = v_variant and organization_id = v_org;
    if v_product is null then
      raise exception 'variant_not_found: %', v_variant using errcode = 'P0002';
    end if;

    v_line := round(v_qty * v_cost, 2);
    v_subtotal := v_subtotal + v_line;
    v_tax := v_tax + round(v_line * v_rate, 2);
  end loop;
  v_total := v_subtotal + v_tax;

  if p_purchase_id is null then
    v_seq := public.next_sequence(v_org, 'purchase:' || to_char(now(), 'YYYY'));
    v_no := 'PO-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 6, '0');

    insert into public.purchases (
      id, organization_id, branch_id, warehouse_id, supplier_id, reference_no,
      invoice_no, status, subtotal, tax_total, total, note, expected_at, created_by
    ) values (
      v_id, v_org, v_branch, p_warehouse_id, p_supplier_id, p_reference_no,
      v_no, v_status, v_subtotal, v_tax, v_total, p_note, p_expected_at, auth.uid()
    );
  else
    update public.purchases
       set supplier_id  = p_supplier_id,
           reference_no = p_reference_no,
           status       = v_status,
           subtotal     = v_subtotal,
           tax_total    = v_tax,
           total        = v_total,
           note         = p_note,
           expected_at  = p_expected_at
     where id = v_id;
    delete from public.purchase_items where purchase_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant := (v_item ->> 'variant_id')::uuid;
    v_qty     := (v_item ->> 'qty')::numeric(14,3);
    v_cost    := coalesce((v_item ->> 'unit_cost')::numeric(14,4), 0);
    v_rate    := coalesce((v_item ->> 'tax_rate')::numeric(6,4), 0);

    select pv.product_id, p.name into v_product, v_name
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
     where pv.id = v_variant;

    insert into public.purchase_items (
      organization_id, purchase_id, variant_id, product_id, product_name,
      quantity, unit_cost, tax_rate, line_total
    ) values (
      v_org, v_id, v_variant, v_product, v_name,
      v_qty, v_cost, v_rate, round(v_qty * v_cost * (1 + v_rate), 2)
    );
  end loop;

  -- The supplier's balance is what the shop owes. It moves when an order is
  -- placed, when an ordered total or supplier changes, and when a payment is
  -- made — never on receipt, which is about goods, not money.
  --
  -- Expressed as "release what was committed, then commit the new figure"
  -- rather than as a delta, because a delta gets the paid portion wrong: money
  -- already transferred is still money owed against the *new* total, and must
  -- not be released when the old total is withdrawn.
  if p_purchase_id is not null
     and v_prev_status = 'ORDERED'
     and v_existing.supplier_id is not null then
    update public.suppliers
       set balance = balance - (v_old_total - v_existing.paid_total)
     where id = v_existing.supplier_id;
  end if;

  if v_status = 'ORDERED' and p_supplier_id is not null then
    update public.suppliers
       set balance = balance + (v_total - coalesce(v_existing.paid_total, 0))
     where id = p_supplier_id;
  end if;

  return v_id;
end
$fn$;

create or replace function public.cancel_purchase(
  p_purchase_id uuid,
  p_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_po   public.purchases;
  v_back numeric(14,2);
begin
  select * into v_po from public.purchases where id = p_purchase_id;
  if v_po.id is null then
    raise exception 'purchase_not_found: %', p_purchase_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_po.organization_id);
  perform app.require_permission('purchases.approve');

  if v_po.status = 'CANCELLED' then
    return jsonb_build_object('purchase_id', p_purchase_id, 'status', 'CANCELLED', 'released', 0);
  end if;
  -- Cancelling after goods arrived would leave stock on the shelf that no
  -- order explains. Returns to supplier are their own operation (§18).
  if exists (select 1 from public.purchase_items
              where purchase_id = p_purchase_id and received_qty > 0) then
    raise exception 'purchase_already_received' using errcode = '22023';
  end if;

  -- Only what is still owed is released: payments already made are a real
  -- transfer of money and stay on the supplier's account as an advance.
  v_back := case when v_po.status = 'ORDERED' then v_po.total - v_po.paid_total else 0 end;

  if v_po.supplier_id is not null and v_back <> 0 then
    update public.suppliers set balance = balance - v_back where id = v_po.supplier_id;
  end if;

  update public.purchases
     set status = 'CANCELLED',
         note   = coalesce(p_reason, note)
   where id = p_purchase_id;

  return jsonb_build_object(
    'purchase_id', p_purchase_id, 'status', 'CANCELLED', 'released', v_back
  );
end
$fn$;

-- ── Paying a supplier ────────────────────────────────────────────────────
--
-- Goods arrive on credit and are paid later, partly, in cash or by transfer.
-- `receive_purchase` accepts a payment at the counter; this is the standing
-- operation for settling up afterwards.
create or replace function public.apply_payment(
  p_supplier_id uuid,
  p_amount      numeric(14,2),
  p_method_id   uuid,
  p_purchase_id uuid default null,
  p_reference   text default null,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid;
  v_supplier public.suppliers;
  v_po       public.purchases;
  v_balance  numeric(14,2);
  v_id       uuid := gen_random_uuid();
begin
  select * into v_supplier from public.suppliers where id = p_supplier_id;
  if v_supplier.id is null then
    raise exception 'supplier_not_found: %', p_supplier_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_supplier.organization_id);
  perform app.require_permission('purchases.create');

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;
  if not exists (select 1 from public.payment_methods
                  where id = p_method_id and organization_id = v_supplier.organization_id) then
    raise exception 'payment_method_not_found: %', p_method_id using errcode = 'P0002';
  end if;

  if p_purchase_id is not null then
    select * into v_po from public.purchases where id = p_purchase_id;
    if v_po.id is null then
      raise exception 'purchase_not_found: %', p_purchase_id using errcode = 'P0002';
    end if;
    if v_po.supplier_id is distinct from p_supplier_id then
      raise exception 'purchase_belongs_to_another_supplier' using errcode = '22023';
    end if;
    if p_amount > (v_po.total - v_po.paid_total) then
      raise exception 'over_payment: outstanding %', (v_po.total - v_po.paid_total)
        using errcode = '22023';
    end if;

    insert into public.purchase_payments
          (id, organization_id, purchase_id, method_id, amount, reference)
    values (v_id, v_supplier.organization_id, p_purchase_id, p_method_id, p_amount,
            coalesce(p_reference, p_note));

    update public.purchases
       set paid_total = paid_total + p_amount
     where id = p_purchase_id;
  else
    -- An unallocated payment sits on the supplier's account and pays down the
    -- balance without naming an order (a monthly settlement, typically).
    -- purchase_payments requires a purchase, so nothing is inserted here; the
    -- balance movement is the record, and it is audited.
    insert into public.outbox
          (organization_id, event_type, aggregate_type, aggregate_id, payload)
    values (v_supplier.organization_id, 'supplier.payment', 'supplier', p_supplier_id,
            jsonb_build_object('amount', p_amount, 'method_id', p_method_id,
                               'reference', coalesce(p_reference, p_note)));
  end if;

  update public.suppliers set balance = balance - p_amount where id = p_supplier_id
  returning balance into v_balance;

  return jsonb_build_object(
    'payment_id', v_id,
    'amount', p_amount,
    'supplier_balance', v_balance,
    'purchase_id', p_purchase_id
  );
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Refund to store credit
-- ══════════════════════════════════════════════════════════════════════════
--
-- The common case at a Bangladeshi counter: the customer has lost the receipt
-- and wants the value kept for them rather than cash back. Wrapping
-- `refund_sale` rather than reimplementing it means the stock movement, the
-- over-refund guard and the return-number sequence all behave identically to a
-- cash refund — there is one refund implementation, not two.
create or replace function public.refund_sale_to_credit(
  p_sale_id  uuid,
  p_items    jsonb,               -- [{sale_item_id, qty}]
  p_reason   text    default null,
  p_restock  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale     public.sales;
  v_result   jsonb;
  v_total    numeric(14,2);
  v_credit   numeric(14,2);
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null then
    raise exception 'sale_not_found: %', p_sale_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_sale.organization_id);
  perform app.require_permission('sales.refund');

  -- Store credit needs somebody to hold it. The alternative — cash back — is
  -- `refund_sale`, and the UI offers it whenever this refuses.
  if v_sale.customer_id is null then
    raise exception 'sale_has_no_customer'
      using errcode = '22023',
            hint = 'Refund to the original payment method, or serve a named customer';
  end if;

  v_result := public.refund_sale(p_sale_id, p_items, '[]'::jsonb, p_reason, p_restock);
  v_total := (v_result ->> 'refund_total')::numeric(14,2);

  update public.customers
     set store_credit = store_credit + v_total
   where id = v_sale.customer_id
  returning store_credit into v_credit;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_sale.organization_id, 'customer.credit', 'customer', v_sale.customer_id,
          jsonb_build_object('sale_id', p_sale_id,
                             'return_id', v_result ->> 'return_id',
                             'amount', v_total, 'store_credit', v_credit));

  return v_result || jsonb_build_object('store_credit', v_credit, 'customer_id', v_sale.customer_id);
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. Register session reporting
-- ══════════════════════════════════════════════════════════════════════════
--
-- `close_register` already computes the expected cash and the variance. What a
-- shopkeeper also needs is the breakdown: what was sold, by which method, and
-- what left the drawer. One call, so the screen cannot show a total that
-- disagrees with its own parts.
create or replace function public.register_session_report(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_session public.register_sessions;
begin
  select * into v_session from public.register_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'session_not_found: %', p_session_id using errcode = 'P0002';
  end if;

  -- Whoever closes the drawer has to reconcile it, so that is the permission
  -- this needs — not the reporting one, which a cashier may not hold.
  perform app.require_org(v_session.organization_id);
  perform app.require_permission('register.close');

  return jsonb_build_object(
    'session_id',    v_session.id,
    'register_id',   v_session.register_id,
    'branch_id',     v_session.branch_id,
    'opened_at',     v_session.opened_at,
    'closed_at',     v_session.closed_at,
    'is_open',       v_session.closed_at is null,
    'opening_cash',  v_session.opening_cash,
    'cash_in',       v_session.cash_in,
    'cash_out',      v_session.cash_out,
    'sales_cash',    v_session.sales_cash,
    'refund_cash',   v_session.refund_cash,
    'expense_cash',  v_session.expense_cash,
    'expected_cash', v_session.opening_cash + v_session.cash_in - v_session.cash_out
                       + v_session.sales_cash - v_session.refund_cash - v_session.expense_cash,
    'closing_cash',  v_session.closing_cash,
    'variance',      v_session.variance,
    'sale_count', coalesce((
      select count(*) from public.sales s
       where s.session_id = p_session_id
         and s.status in ('COMPLETED', 'PARTIALLY_PAID')), 0),
    'sales_total', coalesce((
      select sum(s.total) from public.sales s
       where s.session_id = p_session_id
         and s.status in ('COMPLETED', 'PARTIALLY_PAID')), 0),
    'refund_total', coalesce((
      select sum(r.refund_total)
        from public.sale_returns r
        join public.sales s on s.id = r.sale_id
       where s.session_id = p_session_id), 0),
    'expense_total', coalesce((
      select sum(e.amount) from public.expenses e
       where e.session_id = p_session_id and e.deleted_at is null), 0),
    -- Cash by method, because "where did the money come from" is the question
    -- the drawer count provokes.
    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object(
               'method_id', m.id,
               'method',    m.name,
               'is_cash',   m.is_cash,
               'amount',    agg.total,
               'count',     agg.n)
             order by m.sort_order, m.name)
        from (
          select sp.method_id, sum(sp.amount) as total, count(*) as n
            from public.sale_payments sp
            join public.sales s on s.id = sp.sale_id
           where s.session_id = p_session_id
             and s.status in ('COMPLETED', 'PARTIALLY_PAID')
           group by sp.method_id
        ) agg
        join public.payment_methods m on m.id = agg.method_id), '[]'::jsonb)
  );
end
$fn$;

/**
 * Sessions with their totals, for the register screen's history list.
 *
 * The aggregates live here rather than in three client queries so the list and
 * the closing report are computed from the same definition — a register whose
 * list says ৳12,400 and whose report says ৳12,300 is a drawer that can never be
 * reconciled.
 */
create or replace view public.register_session_summary as
  select rs.id,
         rs.organization_id,
         rs.branch_id,
         rs.register_id,
         r.name  as register_name,
         rs.opened_at,
         rs.closed_at,
         (rs.closed_at is null) as is_open,
         rs.opening_cash,
         rs.closing_cash,
         rs.variance,
         rs.cash_in,
         rs.cash_out,
         rs.sales_cash,
         rs.refund_cash,
         rs.expense_cash,
         coalesce((
           select sum(s.total) from public.sales s
            where s.session_id = rs.id
              and s.status in ('COMPLETED', 'PARTIALLY_PAID')), 0) as sales_total,
         coalesce((
           select count(*) from public.sales s
            where s.session_id = rs.id
              and s.status in ('COMPLETED', 'PARTIALLY_PAID')), 0) as sale_count,
         coalesce((
           select sum(sr.refund_total)
             from public.sale_returns sr
             join public.sales s on s.id = sr.sale_id
            where s.session_id = rs.id), 0) as refund_total,
         coalesce((
           select sum(e.amount) from public.expenses e
            where e.session_id = rs.id and e.deleted_at is null), 0) as expense_total
    from public.register_sessions rs
    left join public.registers r on r.id = rs.register_id;

alter view public.register_session_summary set (security_invoker = on);

-- ══════════════════════════════════════════════════════════════════════════
-- 5. Grants
-- ══════════════════════════════════════════════════════════════════════════
-- Same rule as every migration before this one: the client gets the operation,
-- never a table write that would let it reimplement the arithmetic.
grant execute on function public.save_purchase(uuid, jsonb, uuid, uuid, text, text, text, date) to authenticated;
grant execute on function public.cancel_purchase(uuid, text) to authenticated;
grant execute on function public.apply_payment(uuid, numeric, uuid, uuid, text, text) to authenticated;
grant execute on function public.refund_sale_to_credit(uuid, jsonb, text, boolean) to authenticated;
grant execute on function public.register_session_report(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_026_audit_actor_email.sql
-- ══════════════════════════════════════════════════════════════════════

-- 026 — The audit trail must be readable by the people allowed to read it.
--
-- 025 defined `audit_trail` with `security_invoker = on` and joined
-- `auth.users` to show the actor's email. That join is the hole: with invoker
-- rights the *caller* — not the view's owner — needs SELECT on `auth.users`,
-- which `authenticated` does not have and should never be given.
--
-- The symptom on the deployed project was exact and unpleasant: a signed-in
-- owner, holding `audit.view`, opened the audit screen and was told
--
--     You do not have permission to do that.   (SQLSTATE 42501)
--
-- `register_session_summary` was readable because it only touches `public`
-- tables; only the view that reached into `auth` failed. The migration
-- validator could not see it, because the validator applies migrations as the
-- owner and the owner can read everything — which is why this file also adds
-- the check that would have caught it (see tools/validate-migrations.mjs).
--
-- The fix keeps the email without handing out `auth.users`: a SECURITY DEFINER
-- function resolves one email for one uuid, and the view calls it. The view
-- itself stays `security_invoker`, so `audit_logs_select` still decides which
-- rows a caller may see — the tenancy wall is unchanged.

create or replace function app.actor_email(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.email from auth.users u where u.id = p_user_id
$$;

comment on function app.actor_email(uuid) is
  'One email address for one user id. SECURITY DEFINER because authenticated must not read auth.users, and the audit trail has to name the actor.';

-- 018 revoked EXECUTE on everything in `app` from the client roles, so the
-- grant has to be explicit here too.
revoke execute on function app.actor_email(uuid) from public, anon;
grant execute on function app.actor_email(uuid) to authenticated;

-- Dropped and recreated rather than replaced: the old definition took
-- `actor_email` straight from `auth.users.email` (`varchar(255)`) and the
-- helper returns `text`, and Postgres refuses to change a view column's type
-- in place. Nothing depends on the view, so the brief drop is free.
drop view if exists public.audit_trail;

create view public.audit_trail as
  select a.id,
         a.organization_id,
         a.created_at,
         a.action,
         a.entity_type,
         a.entity_id,
         a.actor_id,
         app.actor_email(a.actor_id) as actor_email,
         a.before,
         a.after,
         a.metadata
    from public.audit_logs a;

alter view public.audit_trail set (security_invoker = on);

-- Explicit rather than inherited from Supabase's default privileges: a view's
-- readability should not depend on which role happened to create it, and an
-- invoker-rights view is only as readable as the table underneath it.
-- RLS — not the grant — is what decides which rows come back.
grant select on public.audit_logs to authenticated;
grant select on public.audit_trail to authenticated;
grant select on public.register_session_summary to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_027_expense_session_and_audit_teardown.sql
-- ══════════════════════════════════════════════════════════════════════

-- 027 — Two faults found by driving the deployed app, not by reading it.
--
-- Both were invisible to the migration validator because of *how* it tested:
-- it applies migrations as the owner (so privileges never bound) and it
-- asserted the register's expense figure from rows it had inserted itself
-- rather than through the RPC a shopkeeper actually calls. A function that
-- exists but is never executed has never been tested.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. `record_expense` could never record an expense
-- ══════════════════════════════════════════════════════════════════════════
--
-- The body tested `if v_session_id is not null` and updated
-- `where id = v_session_id`, but no such variable was ever declared — the
-- parameter is `p_session_id`. PL/pgSQL resolves identifiers at execution, so
-- the function compiled cleanly, was granted, shipped, and then answered every
-- call with
--
--     column "v_session_id" does not exist   (SQLSTATE 42703)
--
-- That is not an edge case: it is rent, electricity, transport and tea, which
-- is the whole of §24. The fix is the parameter's own name, and the drawer
-- effect is what the register's expected-cash figure depends on.

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

  -- A session that is already closed cannot take an expense: the drawer has
  -- been counted, and adding to it afterwards would make the closing figure
  -- unreconcilable.
  if p_session_id is not null then
    if not exists (select 1 from public.register_sessions
                    where id = p_session_id and closed_at is null) then
      raise exception 'session_not_open: %', p_session_id using errcode = 'P0001';
    end if;
  end if;

  insert into public.expenses (
    id, organization_id, branch_id, category_id, session_id, amount,
    method_id, description, expense_date, created_by
  ) values (
    v_id, v_org, p_branch_id, p_category_id, p_session_id, p_amount,
    p_method_id, p_description, p_expense_date, auth.uid()
  );

  select is_cash into v_is_cash from public.payment_methods where id = p_method_id;

  if p_session_id is not null and coalesce(v_is_cash, false) then
    update public.register_sessions
       set expense_cash = expense_cash + p_amount
     where id = p_session_id and closed_at is null;
  end if;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'expense.recorded', 'expense', v_id,
          jsonb_build_object('expense_id', v_id, 'amount', p_amount,
                             'branch_id', p_branch_id));

  return v_id;
end
$fn$;

grant execute on function public.record_expense(uuid, numeric, uuid, uuid, text, uuid, date)
  to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. The audit trigger fought a shop's teardown
-- ══════════════════════════════════════════════════════════════════════════
--
-- Deleting an organization cascades into every table the trigger watches, and
-- each cascaded delete fired the trigger, which tried to write an audit row
-- naming an organization whose row had already gone:
--
--     insert or update on table "audit_logs" violates foreign key constraint
--     "audit_logs_organization_id_fkey"
--
-- The trail for a shop cannot outlive the shop, so the trigger now checks that
-- the organization still exists and stays quiet when it does not. Nothing else
-- changes: within a live organization, every insert, real update and delete is
-- still recorded.

create or replace function app.record_audit()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $fn$
declare
  v_new      jsonb;
  v_old      jsonb;
  v_org      uuid;
  v_entity   uuid;
  v_action   text;
  v_entity_t text := tg_table_name;
  v_actor    uuid := auth.uid();
begin
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;

  -- A no-op update is not an audited event. `updated_at` is excluded because
  -- the BEFORE trigger has already touched it, so every save would otherwise
  -- look like a change.
  if tg_op = 'UPDATE' and (v_new - 'updated_at') = (v_old - 'updated_at') then
    return null;
  end if;

  -- Every audited table carries organization_id; a row without one cannot be
  -- attributed to a shop, and writing it would corrupt the tenancy scope the
  -- view is filtered by.
  v_org := coalesce(v_new ->> 'organization_id', v_old ->> 'organization_id')::uuid;
  if v_org is null then
    return null;
  end if;

  -- Torn down shop: the cascade is removing this row because the organization
  -- is going. There is no one left to read the trail, and writing it would
  -- abort the delete with a foreign-key violation mid-cascade.
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;

  v_entity := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  v_action := case tg_op
    when 'INSERT' then 'create'
    when 'UPDATE' then 'update'
    else 'delete'
  end;

  insert into public.audit_logs
        (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (v_org, v_actor, v_action, v_entity_t, v_entity, v_old, v_new);

  return null;
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_028_analytics.sql
-- ══════════════════════════════════════════════════════════════════════

-- 028 — Analytics: measure × dimension, one engine (spec §22).
--
-- §22 asks for a framework, not a handful of charts: a set of measures that
-- can be sliced by a set of dimensions, with filters, so "revenue by category"
-- and "revenue by day" are the same computation wearing different clothes.
-- Anything less drifts. The failure mode is familiar — the dashboard says
-- ৳12,400 for today while the sales report says ৳12,300 and nobody can say
-- which is right.
--
-- So each measure has exactly one definition, written down here once:
--
--   takings   money through the till, tax included          Σ sales.total
--   revenue   the shop's own money, tax taken out           Σ (total − tax)
--   profit    revenue minus what the goods cost             Σ sales.profit
--   tax       collected for the government                  Σ sales.tax_total
--   discount  given away, line and order discounts          Σ sales.discount_total
--   cogs      cost of the goods actually sold               Σ sales.cogs
--   orders    completed sales
--   items     units sold
--   avg_order takings ÷ orders
--
-- Item-level slices (category, product, variant) have one subtlety. When an
-- order discount is applied to the whole bill, the lines no longer add up to
-- the total, and a naive report shows categories summing to ৳1,000 on a bill
-- the customer paid ৳900 for. The order discount is therefore allocated across
-- the lines in proportion to their totals, so Takings by category equals
-- Takings by day as arithmetic rather than as hope. Allocation rounds to the
-- cent per group, leaving the one residual every retail system has.
--
-- The statement is generated rather than written out sixty times. The
-- (family × dimension) matrix is a whitelist, every identifier in the emitted
-- SQL comes from it, and the alternative — sixty aggregate branches hand
-- copied — is where the sixth one gets pasted wrong. A validator check asserts
-- that Takings by category really does equal Takings by day, so the property
-- is enforced, not merely intended.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Which measure can be sliced by which dimension
-- ══════════════════════════════════════════════════════════════════════════

create or replace function app.analytics_family(p_measure text, p_dimension text)
returns text
language sql
immutable
as $fn$
  select case
    when p_measure in ('takings', 'revenue', 'profit', 'tax', 'discount', 'cogs',
                       'orders', 'items', 'avg_order') then
      case when p_dimension in ('day', 'week', 'month', 'hour', 'weekday',
                                'category', 'product', 'variant', 'customer',
                                'cashier', 'payment_method', 'branch')
           then 'sales' end

    when p_measure = 'refunds' then
      case when p_dimension in ('day', 'week', 'month', 'customer', 'cashier')
           then 'returns' end

    when p_measure = 'expenses' then
      case when p_dimension in ('day', 'week', 'month', 'expense_category')
           then 'expenses' end

    when p_measure in ('purchases', 'purchase_due') then
      case when p_dimension in ('day', 'week', 'month', 'supplier')
           then 'purchases' end
  end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. The statement generator
-- ══════════════════════════════════════════════════════════════════════════
--
-- Returns one SELECT with a fixed shape — (key, label, value, secondary,
-- sort_key) — for a single period. The caller runs it twice, for this period
-- and for the one before it, and pairs the two rowsets up.

create or replace function app.analytics_sql(
  p_dimension text,
  p_measure   text,
  p_org       uuid,
  p_branch    uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_tz        text,
  p_filters   jsonb,
  p_limit     int
)
returns text
language plpgsql
stable
as $fn$
declare
  v_family   text := app.analytics_family(p_measure, p_dimension);
  v_from     text;
  v_where    text;
  v_key      text;
  v_label    text;
  v_sort     text;
  v_value    text;
  v_second   text;
  v_order    text;
  v_by_items boolean := p_dimension in ('category', 'product', 'variant');
  v_filter   text;
begin
  if v_family is null then
    raise exception 'unsupported_combination: % by %', p_measure, p_dimension
      using errcode = '22023';
  end if;

  -- ── The window and tenancy predicate every family shares ───────────────
  v_filter := format(
    ' and s.organization_id = %L and s.created_at >= %L and s.created_at < %L',
    p_org, p_from, p_to
  );
  if p_branch is not null then
    v_filter := v_filter || format(' and s.branch_id = %L', p_branch);
  end if;
  if p_filters ? 'customer_id' then
    v_filter := v_filter || format(' and s.customer_id = %L', (p_filters ->> 'customer_id')::uuid);
  end if;
  if p_filters ? 'cashier_id' then
    v_filter := v_filter || format(' and s.created_by = %L', (p_filters ->> 'cashier_id')::uuid);
  end if;
  if p_filters ? 'method_id' then
    v_filter := v_filter || format(
      ' and exists (select 1 from public.sale_payments spf
                     where spf.sale_id = s.id and spf.method_id = %L)',
      (p_filters ->> 'method_id')::uuid
    );
  end if;
  if p_filters ? 'category_id' then
    v_filter := v_filter || format(
      ' and exists (select 1 from public.sale_items sif
                     join public.products pf on pf.id = sif.product_id
                    where sif.sale_id = s.id and pf.category_id = %L)',
      (p_filters ->> 'category_id')::uuid
    );
  end if;

  -- ── Dimension: key, label, ordering, grouping ─────────────────────────
  v_order := 'sort_key asc';
  case p_dimension
    when 'day' then
      v_key   := format('to_char(s.created_at at time zone %L, ''YYYY-MM-DD'')', p_tz);
      v_label := format('to_char(s.created_at at time zone %L, ''DD Mon'')', p_tz);
      v_sort  := format('min(date_trunc(''day'', s.created_at at time zone %L))', p_tz);
    when 'week' then
      v_key   := format('to_char(date_trunc(''week'', s.created_at at time zone %L), ''IYYY-"W"IW'')', p_tz);
      v_label := format('''Wk '' || to_char(date_trunc(''week'', s.created_at at time zone %L), ''IW'')', p_tz);
      v_sort  := format('min(date_trunc(''week'', s.created_at at time zone %L))', p_tz);
    when 'month' then
      v_key   := format('to_char(s.created_at at time zone %L, ''YYYY-MM'')', p_tz);
      v_label := format('to_char(s.created_at at time zone %L, ''Mon YYYY'')', p_tz);
      v_sort  := format('min(date_trunc(''month'', s.created_at at time zone %L))', p_tz);
    when 'hour' then
      v_key   := format('lpad(extract(hour from s.created_at at time zone %L)::int::text, 2, ''0'')', p_tz);
      v_label := format('lpad(extract(hour from s.created_at at time zone %L)::int::text, 2, ''0'') || '':00''', p_tz);
      v_sort  := format('min(extract(hour from s.created_at at time zone %L)::int)', p_tz);
    when 'weekday' then
      v_key   := format('extract(isodow from s.created_at at time zone %L)::int::text', p_tz);
      v_label := format('to_char(s.created_at at time zone %L, ''Dy'')', p_tz);
      v_sort  := format('min(extract(isodow from s.created_at at time zone %L)::int)', p_tz);
    when 'category' then
      v_key   := 'coalesce(pc.id::text, ''none'')';
      v_label := 'coalesce(pc.name, ''Uncategorised'')';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'product' then
      v_key   := 'si.product_id::text';
      v_label := 'si.product_name';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'variant' then
      v_key   := 'si.variant_id::text';
      v_label := 'si.product_name || coalesce('' · '' || v.name_suffix, '''')';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'customer' then
      v_key   := 'coalesce(s.customer_id::text, ''walk-in'')';
      v_label := 'coalesce(cu.name, ''Walk-in'')';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'cashier' then
      v_key   := 's.created_by::text';
      v_label := 'app.actor_email(s.created_by)';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'payment_method' then
      v_key   := 'sp.method_id::text';
      v_label := 'pm.name';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'branch' then
      v_key   := 's.branch_id::text';
      v_label := 'b.name';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'expense_category' then
      v_key   := 'coalesce(e.category_id::text, ''none'')';
      v_label := 'coalesce(ec.name, ''Uncategorised'')';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'supplier' then
      v_key   := 'p.supplier_id::text';
      v_label := 'coalesce(sup.name, ''No supplier'')';
      v_sort  := '0::numeric';
      v_order := 'value desc';
  end case;

  -- ── Family: joins, measure, secondary measure ─────────────────────────
  if v_family = 'sales' and v_by_items then
    -- Item slices. `si` is an enriched sale_items row that carries the share
    -- of the order-level discount this line must absorb; every measure below
    -- is then a plain sum over lines.
    v_from := format(
      '(select si0.*,
              case when coalesce(pool.line_pool, 0) > 0
                   then greatest(s0.discount_total - coalesce(pool.line_disc, 0), 0)
                        / pool.line_pool
                   else 0 end as order_share
         from public.sale_items si0
         join public.sales s0 on s0.id = si0.sale_id
         left join (
           select si2.sale_id,
                  sum(si2.line_total)     as line_pool,
                  sum(si2.discount_total) as line_disc
             from public.sale_items si2
            group by 1
         ) pool on pool.sale_id = si0.sale_id) si
       join public.sales s          on s.id = si.sale_id
       join public.products p       on p.id = si.product_id
       left join public.product_categories pc on pc.id = p.category_id
       left join public.product_variants v    on v.id = si.variant_id'
    );
    v_value := case p_measure
      when 'takings'  then 'round(sum(si.line_total * (1 - si.order_share)), 2)'
      when 'revenue'  then 'round(sum(si.line_total * (1 - si.order_share) - si.tax_total), 2)'
      when 'profit'   then 'round(sum(si.line_total * (1 - si.order_share) - si.tax_total - si.line_cogs), 2)'
      when 'tax'      then 'round(sum(si.tax_total), 2)'
      when 'discount' then 'round(sum(si.discount_total + si.line_total * si.order_share), 2)'
      when 'cogs'     then 'round(sum(si.line_cogs), 2)'
      when 'orders'   then 'count(distinct si.sale_id)::numeric'
      when 'items'    then 'round(sum(si.quantity), 3)'
      when 'avg_order' then 'round(sum(si.line_total * (1 - si.order_share)) / nullif(count(distinct si.sale_id), 0), 2)'
      else '0::numeric'
    end;
    v_second := case
      when p_measure in ('orders', 'items') then 'round(sum(si.line_total * (1 - si.order_share)), 2)'
      else 'round(sum(si.quantity), 3)'
    end;
    v_where := format(
      ' where s.status in (''COMPLETED'', ''PARTIALLY_PAID'', ''PARTIALLY_REFUNDED'')%s',
      v_filter
    );

  elsif v_family = 'sales' and p_dimension = 'payment_method' then
    -- Paid money by method. It reads `sale_payments`, not `sales`, because a
    -- split bill has no single method and attributing the whole of it to one
    -- would be a fiction the payment-mix chart then repeats.
    v_from := 'public.sale_payments sp
               join public.sales s on s.id = sp.sale_id
               join public.payment_methods pm on pm.id = sp.method_id';
    v_where := format(
      ' where s.status in (''COMPLETED'', ''PARTIALLY_PAID'', ''PARTIALLY_REFUNDED'')%s',
      v_filter
    );
    v_value  := 'round(sum(sp.amount), 2)';
    v_second := 'count(distinct s.id)::numeric';

  elsif v_family = 'sales' then
    -- Sale slices: every measure is already a column on `sales`.
    v_from := 'public.sales s
               left join public.branches b  on b.id = s.branch_id
               left join public.customers cu on cu.id = s.customer_id';
    v_value := case p_measure
      when 'takings'   then 'round(sum(s.total), 2)'
      when 'revenue'   then 'round(sum(s.total - s.tax_total), 2)'
      when 'profit'    then 'round(sum(s.profit), 2)'
      when 'tax'       then 'round(sum(s.tax_total), 2)'
      when 'discount'  then 'round(sum(s.discount_total), 2)'
      when 'cogs'      then 'round(sum(s.cogs), 2)'
      when 'orders'    then 'count(*)::numeric'
      when 'items'     then 'round((select coalesce(sum(si.quantity), 0)
                                      from public.sale_items si where si.sale_id = s.id), 3)'
      when 'avg_order' then 'round(sum(s.total) / nullif(count(*), 0), 2)'
      else '0::numeric'
    end;
    v_second := case
      when p_measure in ('orders', 'items') then 'round(sum(s.total), 2)'
      else 'count(*)::numeric'
    end;
    v_where := format(
      ' where s.status in (''COMPLETED'', ''PARTIALLY_PAID'', ''PARTIALLY_REFUNDED'')%s',
      v_filter
    ) || case when p_dimension = 'cashier' then ' and s.created_by is not null' else '' end;

  elsif v_family = 'returns' then
    v_from := 'public.sale_returns sr
               join public.sales s      on s.id = sr.sale_id
               left join public.customers cu on cu.id = s.customer_id
               left join public.branches b   on b.id = s.branch_id';
    v_value  := 'round(sum(sr.refund_total), 2)';
    v_second := 'count(*)::numeric';
    v_where  := format(
      ' where sr.organization_id = %L and sr.created_at >= %L and sr.created_at < %L%s',
      p_org, p_from, p_to,
      case when p_branch is not null then format(' and sr.branch_id = %L', p_branch) else '' end
    ) || case when p_dimension = 'cashier' then ' and s.created_by is not null' else '' end;
    -- The time columns differ between families, so point the dimension
    -- expressions at the return's own timestamp.
    -- Returns have their own timestamp; the dimension expressions built for
    -- `sales` are re-pointed at it rather than duplicated.
    v_key   := replace(v_key, 's.created_at', 'sr.created_at');
    v_label := replace(v_label, 's.created_at', 'sr.created_at');
    v_sort  := replace(v_sort,  's.created_at', 'sr.created_at');

  elsif v_family = 'expenses' then
    v_from := 'public.expenses e
               left join public.expense_categories ec on ec.id = e.category_id';
    v_value  := 'round(sum(e.amount), 2)';
    v_second := 'count(*)::numeric';
    v_where  := format(
      ' where e.organization_id = %L and e.deleted_at is null
          and e.expense_date >= (%L::timestamptz at time zone %L)::date
          and e.expense_date <  (%L::timestamptz at time zone %L)::date%s',
      p_org, p_from, p_tz, p_to, p_tz,
      case when p_branch is not null then format(' and e.branch_id = %L', p_branch) else '' end
    );
    -- Expenses carry a DATE, not a timestamp, so the time dimensions are
    -- rebuilt here. Shifting a date through a time zone is where a report
    -- silently loses a day: `date::timestamp at time zone tz` is a
    -- timestamptz that renders in the *session's* zone, so an expense on the
    -- 1st shows up under the 31st. A date is already a calendar day; leave it.
    case p_dimension
      when 'day' then
        v_key   := 'to_char(e.expense_date, ''YYYY-MM-DD'')';
        v_label := 'to_char(e.expense_date, ''DD Mon'')';
        v_sort  := 'min(e.expense_date::timestamp)';
      when 'week' then
        v_key   := 'to_char(date_trunc(''week'', e.expense_date::timestamp), ''IYYY-"W"IW'')';
        v_label := '''Wk '' || to_char(date_trunc(''week'', e.expense_date::timestamp), ''IW'')';
        v_sort  := 'min(date_trunc(''week'', e.expense_date::timestamp))';
      when 'month' then
        v_key   := 'to_char(e.expense_date, ''YYYY-MM'')';
        v_label := 'to_char(e.expense_date, ''Mon YYYY'')';
        v_sort  := 'min(date_trunc(''month'', e.expense_date::timestamp))';
      else
        null;
    end case;

  else
    v_from := 'public.purchases p
               left join public.suppliers sup on sup.id = p.supplier_id
               left join public.branches b    on b.id = p.branch_id';
    v_value := case p_measure
      when 'purchase_due' then 'round(sum(p.total - p.paid_total), 2)'
      else 'round(sum(p.total), 2)'
    end;
    v_second := 'count(*)::numeric';
    -- Purchases have no soft-delete column: a cancelled order stays in the
    -- book with CANCELLED, which is what a shop wants to see in the history.
    v_where  := format(
      ' where p.organization_id = %L
          and p.status <> ''DRAFT'' and p.created_at >= %L and p.created_at < %L%s',
      p_org, p_from, p_to,
      case when p_branch is not null then format(' and p.branch_id = %L', p_branch) else '' end
    );
    v_key   := replace(v_key, 's.created_at', 'p.created_at');
    v_label := replace(v_label, 's.created_at', 'p.created_at');
    v_sort  := replace(v_sort,  's.created_at', 'p.created_at');
  end if;

  -- Ranking dimensions sort by the measure itself, so that the caller can
  -- re-sort a page deterministically and the page the LIMIT kept is the top of
  -- the list rather than an arbitrary slice of it.
  --
  -- Time dimensions sort by `min(period)`. It looks redundant — every row in
  -- the group shares the period — but ORDER BY has to name something the
  -- GROUP BY produced, and a bare `date_trunc(...)` in the sort is an
  -- ungrouped column as far as Postgres is concerned.
  if v_order = 'value desc' then
    v_sort  := v_value;
    v_order := 'sort_key desc';
  end if;

  return format(
    'select %s as key, %s as label, %s as value, %s as secondary, %s as sort_key
       from %s
       %s
      group by 1, 2
      order by %s%s',
    v_key, v_label, v_value, v_second, v_sort, v_from, v_where, v_order,
    -- p_limit = 0 asks for the whole period: the caller uses it to total a
    -- series without shipping its rows. LIMIT 0 would mean "nothing", which is
    -- how a "total" quietly becomes zero.
    case when p_limit > 0 then format(' limit %s', p_limit) else '' end
  );
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. The period, in the branch's own time zone
-- ══════════════════════════════════════════════════════════════════════════
--
-- "Today" is today where the shop is, not where the server is (docs/09 #14).
-- A shop in Dhaka closing at 11pm must not see the last hour of trading fall
-- into tomorrow because the database runs in UTC.

create or replace function app.analytics_window(
  p_branch_id uuid,
  p_period    text,
  p_from      date default null,
  p_to        date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_tz text;
  v_currency char(3);
  v_today date;
  v_start date;
  v_end date;
  v_prev_start date;
  v_prev_end date;
begin
  select b.organization_id, coalesce(b.timezone, o.timezone), o.currency
    into v_org, v_tz, v_currency
    from public.branches b
    join public.organizations o on o.id = b.organization_id
   where b.id = p_branch_id;

  if v_org is null then
    raise exception 'branch_not_found: %', p_branch_id using errcode = 'P0002';
  end if;

  v_today := (now() at time zone v_tz)::date;

  case p_period
    when 'day' then
      v_start := v_today;                     v_end := v_today + 1;
      v_prev_start := v_today - 1;            v_prev_end := v_today;
    when 'week' then
      v_start := date_trunc('week', v_today::timestamp)::date;
      v_end   := v_start + 7;
      v_prev_start := v_start - 7;            v_prev_end := v_start;
    when 'month' then
      v_start := date_trunc('month', v_today::timestamp)::date;
      v_end   := (v_start + interval '1 month')::date;
      v_prev_start := (v_start - interval '1 month')::date; v_prev_end := v_start;
    when 'quarter' then
      v_start := date_trunc('quarter', v_today::timestamp)::date;
      v_end   := (v_start + interval '3 months')::date;
      v_prev_start := (v_start - interval '3 months')::date; v_prev_end := v_start;
    when 'year' then
      v_start := date_trunc('year', v_today::timestamp)::date;
      v_end   := (v_start + interval '1 year')::date;
      v_prev_start := (v_start - interval '1 year')::date;  v_prev_end := v_start;
    else  -- custom: the caller's dates, previous = the same span before it
      v_start := coalesce(p_from, v_today - 29);
      v_end   := coalesce(p_to, v_today) + 1;
      if v_end <= v_start then
        raise exception 'invalid_range: % to %', v_start, v_end using errcode = '22023';
      end if;
      v_prev_start := v_start - (v_end - v_start);
      v_prev_end   := v_start;
  end case;

  return jsonb_build_object(
    'org', v_org, 'timezone', v_tz, 'currency', v_currency,
    'today', v_today,
    'from', v_start, 'to', v_end,          -- [from, to) in branch-local dates
    'prev_from', v_prev_start, 'prev_to', v_prev_end,
    'label', case p_period
               when 'day'     then to_char(v_start, 'DD Mon YYYY')
               when 'week'    then 'Week ' || to_char(v_start, 'IW, YYYY')
               when 'month'   then to_char(v_start, 'Mon YYYY')
               when 'quarter' then 'Q' || to_char(v_start, 'Q YYYY')
               when 'year'    then to_char(v_start, 'YYYY')
               else to_char(v_start, 'DD Mon YYYY') || ' – ' || to_char(v_end - 1, 'DD Mon YYYY')
             end
  );
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. Run one slice, with the comparison period attached
-- ══════════════════════════════════════════════════════════════════════════
--
-- Internal: it performs no permission check of its own, so it stays revoked
-- from the client roles (018's rule). Every public entry point below is one
-- `require_permission` line plus a call to this.

create or replace function app.analytics_run(
  p_branch_id   uuid,
  p_dimension   text,
  p_measure     text,
  p_period      text     default 'month',
  p_from        date     default null,
  p_to          date     default null,
  p_filters     jsonb    default '{}'::jsonb,
  p_limit       int      default 200,
  p_with_totals boolean  default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_win    jsonb;
  v_org    uuid;
  v_tz text;
  v_currency text;
  v_from   timestamptz;
  v_to timestamptz;
  v_p_from timestamptz;
  v_p_to timestamptz;
  v_dir    text;
  v_rows   jsonb;
  v_prev jsonb;
  v_tot    numeric;
  v_tot_sec numeric;
  v_ptot   numeric;
  v_ptot_sec numeric;
  v_sql    text;
  v_psql text;
  v_out    jsonb;
begin
  v_win      := app.analytics_window(p_branch_id, p_period, p_from, p_to);
  v_org      := (v_win ->> 'org')::uuid;
  v_tz       := v_win ->> 'timezone';
  v_currency := v_win ->> 'currency';

  v_from   := ((v_win ->> 'from')::date::timestamp AT TIME ZONE v_tz);
  v_to     := ((v_win ->> 'to')::date::timestamp AT TIME ZONE v_tz);
  v_p_from := ((v_win ->> 'prev_from')::date::timestamp AT TIME ZONE v_tz);
  v_p_to   := ((v_win ->> 'prev_to')::date::timestamp AT TIME ZONE v_tz);

  -- Ranking dimensions read best biggest-first; time reads oldest-first.
  v_dir := case when p_dimension in ('category', 'product', 'variant', 'customer',
                                     'cashier', 'payment_method', 'branch',
                                     'expense_category', 'supplier')
                then 'desc' else 'asc' end;

  -- Rows and their totals are two statements: the totals must cover the whole
  -- period, not the page. `p_limit = 0` emits no LIMIT at all, so the total is
  -- a single aggregate pass with no rows leaving the server.
  if p_with_totals then
    execute format(
      'select coalesce(sum(r.value), 0), coalesce(sum(r.secondary), 0) from (%s) r',
      app.analytics_sql(p_dimension, p_measure, v_org, p_branch_id, v_from, v_to, v_tz, p_filters, 0)
    ) into v_tot, v_tot_sec;

    execute format(
      'select coalesce(sum(r.value), 0), coalesce(sum(r.secondary), 0) from (%s) r',
      app.analytics_sql(p_dimension, p_measure, v_org, p_branch_id, v_p_from, v_p_to, v_tz, p_filters, 0)
    ) into v_ptot, v_ptot_sec;
  end if;

  v_psql := app.analytics_sql(p_dimension, p_measure, v_org, p_branch_id,
                              v_p_from, v_p_to, v_tz, p_filters, 0);
  execute format('select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (%s) q', v_psql) into v_prev;

  v_sql := app.analytics_sql(p_dimension, p_measure, v_org, p_branch_id,
                             v_from, v_to, v_tz, p_filters, p_limit);
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
              ''key'', r.key, ''label'', r.label,
              ''value'', r.value, ''secondary'', r.secondary,
              ''prev'', coalesce(pm.value, 0), ''prev_secondary'', coalesce(pm.secondary, 0)
            ) order by r.sort_key %s, r.label), ''[]''::jsonb)
       from (%s) r
       left join (select * from jsonb_to_recordset(%L::jsonb)
                    as t(key text, value numeric, secondary numeric)) pm
              on pm.key = r.key',
    v_dir, v_sql, v_prev
  ) into v_rows;

  v_out := jsonb_build_object(
    'dimension', p_dimension,
    'measure', p_measure,
    'period', p_period,
    'label', (v_win ->> 'label'),
    'timezone', v_tz,
    'currency', v_currency,
    'from', v_win -> 'from',
    'to', v_win -> 'to',
    'previous', jsonb_build_object('from', v_win -> 'prev_from', 'to', v_win -> 'prev_to'),
    'series', v_rows
  );

  if p_with_totals then
    v_out := v_out || jsonb_build_object('totals', jsonb_build_object(
      'value', coalesce(v_tot, 0),
      'secondary', coalesce(v_tot_sec, 0),
      'prev', v_ptot,
      'prev_secondary', v_ptot_sec,
      'delta_pct', case
        when v_ptot is null then null
        when v_ptot = 0 then null
        else round((v_tot - v_ptot) / v_ptot * 100, 1)
      end
    ));
  end if;

  return v_out;
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. The questions the owner actually asks (spec §56)
-- ══════════════════════════════════════════════════════════════════════════
--
-- The dashboard is not a wall of numbers; it is the answers. Each item is one
-- question, the answer as the shop's own currency or a short phrase, a note
-- with the context that makes the number trustworthy, and the screen that
-- shows the detail. The answers are computed from the same engine as the
-- charts, so a chip and a bar can never disagree.

create or replace function app.bi_item(
  p_id       text,
  p_question text,
  p_kind     text,      -- money | count | qty | text — how to render `value`
  p_value    text,
  p_note     text,
  p_link     text,
  p_icon     text
)
returns jsonb
language sql
immutable
as $fn$
  select jsonb_build_object(
    'id', p_id, 'question', p_question, 'kind', p_kind,
    'value', p_value, 'note', p_note, 'link', p_link, 'icon', p_icon
  )
$fn$;

create or replace function app.bi_answers_internal(p_branch_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_win jsonb;
  v_org uuid;
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_out jsonb := '[]'::jsonb;
  v_money numeric;
  v_cnt numeric;
  v_txt text;
  v_pct numeric;
  v_r jsonb;
  v_day_takings numeric;   -- today's takings, kept for the later percentages
  v_yday_avg numeric;
begin
  v_win  := app.analytics_window(p_branch_id, 'custom', p_day, p_day);
  v_org  := (v_win ->> 'org')::uuid;
  v_tz   := v_win ->> 'timezone';
  v_from := (p_day::timestamp AT TIME ZONE v_tz);
  v_to   := ((p_day + 1)::timestamp AT TIME ZONE v_tz);

  -- 1 · What did we take today?
  select coalesce(sum(s.total), 0), count(*) into v_day_takings, v_cnt
    from public.sales s
   where s.branch_id = p_branch_id and s.created_at >= v_from and s.created_at < v_to
     and s.status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED');
  select coalesce(avg(s.total), 0) into v_yday_avg
    from public.sales s
   where s.branch_id = p_branch_id
     and s.created_at >= ((p_day - 1)::timestamp AT TIME ZONE v_tz)
     and s.created_at <  v_from
     and s.status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED');
  v_out := v_out || jsonb_build_array(app.bi_item(
    'takings_today', 'How much did we take today?', 'money', v_day_takings::text,
    format('%s orders · average bill %s · yesterday''s average %s',
           v_cnt::int,
           to_char(coalesce(v_day_takings / nullif(v_cnt, 0), 0), 'FM999999990.00'),
           to_char(v_yday_avg, 'FM999999990.00')),
    '/sales', 'payments'));

  -- 2 · Did we make money today?
  select coalesce(sum(s.profit), 0) into v_money
    from public.sales s
   where s.branch_id = p_branch_id and s.created_at >= v_from and s.created_at < v_to
     and s.status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED');
  v_out := v_out || jsonb_build_array(app.bi_item(
    'profit_today', 'Are we in profit today?', 'money', v_money::text,
    format('margin %s%% of takings · after cost of goods, before expenses',
           to_char(case when v_day_takings > 0 then v_money / v_day_takings * 100 else 0 end, 'FM990.0')),
    '/reports?report=profit', 'trending_up'));

  -- 3 · What is selling?
  v_r := app.analytics_run(p_branch_id, 'product', 'items', 'month', null, null, '{}'::jsonb, 5, false);
  select string_agg(x ->> 'label', ', ') into v_txt
    from jsonb_array_elements(v_r -> 'series') x;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'top_products', 'What are the best sellers this month?', 'text',
    coalesce(v_txt, 'nothing sold yet'),
    coalesce((v_r -> 'series' -> 0 ->> 'label'), 'nothing') || ' leads with '
      || round(coalesce((v_r -> 'series' -> 0 ->> 'value')::numeric, 0))::text || ' units sold',
    '/reports?report=product_performance', 'star'));

  -- 4 · Which parts of the shop earn?
  v_r := app.analytics_run(p_branch_id, 'category', 'takings', 'month', null, null, '{}'::jsonb, 6, false);
  select coalesce(sum((x ->> 'value')::numeric), 0) into v_money
    from jsonb_array_elements(v_r -> 'series') x;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'category_mix', 'What sells by category this month?', 'text',
    coalesce(v_r -> 'series' -> 0 ->> 'label', 'no sales yet'),
    format('%s%% of takings · %s categories with sales',
           case when v_money > 0
                then round(coalesce((v_r -> 'series' -> 0 ->> 'value')::numeric, 0) / v_money * 100)
                else 0 end,
           jsonb_array_length(v_r -> 'series')),
    '/analytics?dimension=category&measure=takings', 'category'));

  -- 5 · How do they pay?
  v_r := app.analytics_run(p_branch_id, 'payment_method', 'takings', 'custom', p_day, p_day, '{}'::jsonb, 6, false);
  select coalesce(sum((x ->> 'value')::numeric), 0) into v_money
    from jsonb_array_elements(v_r -> 'series') x;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'payment_mix', 'How are customers paying today?', 'text',
    coalesce(v_r -> 'series' -> 0 ->> 'label', 'no payments yet'),
    case when v_money > 0 then
      format('%s%% of today''s takings · %s method(s) used',
             round(coalesce((v_r -> 'series' -> 0 ->> 'value')::numeric, 0) / v_money * 100),
             jsonb_array_length(v_r -> 'series'))
    else 'no payments taken yet today' end,
    '/analytics?dimension=payment_method&measure=takings&period=day', 'credit_card'));

  -- 6 · How much cash is on the premises?
  select coalesce(sum(opening_cash + cash_in - cash_out + sales_cash - refund_cash - expense_cash), 0),
         count(*)
    into v_money, v_cnt
    from public.register_sessions
   where branch_id = p_branch_id and closed_at is null;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'cash_in_drawer', 'How much cash is in the drawer right now?', 'money', v_money::text,
    case when v_cnt = 0 then 'no register is open' else format('%s register(s) open', v_cnt::int) end,
    '/register', 'point_of_sale'));

  -- 7 · Who owes us?
  select coalesce(sum(c.balance), 0), count(*) into v_money, v_cnt
    from public.customers c
   where c.organization_id = v_org and c.deleted_at is null and c.balance > 0;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'receivable', 'Who owes us money?', 'money', v_money::text,
    format('%s customer(s) carrying a balance', v_cnt::int),
    '/customers', 'account_balance_wallet'));

  -- 8 · Who do we owe?
  select coalesce(sum(sup.balance), 0), count(*) into v_money, v_cnt
    from public.suppliers sup
   where sup.organization_id = v_org and sup.deleted_at is null and sup.balance > 0;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'payable', 'What do we owe suppliers?', 'money', v_money::text,
    format('%s supplier(s) with an outstanding balance', v_cnt::int),
    '/suppliers', 'local_shipping'));

  -- 9 · What must we reorder?
  select count(distinct ls.product_id) into v_cnt
    from public.low_stock ls
   where ls.organization_id = v_org;
  select string_agg(x.name, ', ') into v_txt
    from (select ls.name, sum(ls.quantity) as quantity
            from public.low_stock ls
           where ls.organization_id = v_org
           group by ls.name
           order by 2 asc
           limit 3) x;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'reorder', 'What needs reordering?', 'count', v_cnt::int::text,
    case when v_cnt = 0 then 'nothing is below its reorder point'
         else format('running out first: %s', coalesce(v_txt, '—')) end,
    '/reports?report=low_stock', 'inventory_2'));

  -- 10 · What did we spend?
  select coalesce(sum(e.amount), 0), count(*) into v_money, v_cnt
    from public.expenses e
   where e.branch_id = p_branch_id and e.expense_date = p_day and e.deleted_at is null;
  v_r := app.analytics_run(p_branch_id, 'expense_category', 'expenses', 'month', null, null, '{}'::jsonb, 1, false);
  v_out := v_out || jsonb_build_array(app.bi_item(
    'spend_today', 'What did we spend today?', 'money', v_money::text,
    format('%s expense entr(ies)', v_cnt::int)
      || case when jsonb_array_length(v_r -> 'series') = 0 then ''
              else format(' · biggest category this month: %s', v_r -> 'series' -> 0 ->> 'label') end,
    '/expenses', 'receipt_long'));

  -- 11 · When is the shop busy?
  v_r := app.analytics_run(p_branch_id, 'hour', 'takings', 'custom', p_day, p_day, '{}'::jsonb, 24, false);
  select coalesce(sum((x ->> 'value')::numeric), 0) into v_money
    from jsonb_array_elements(v_r -> 'series') x;
  select x ->> 'label', round((x ->> 'value')::numeric, 2)
    into v_txt, v_pct   -- v_pct reused here as the busiest hour's takings
    from jsonb_array_elements(v_r -> 'series') x
   order by (x ->> 'value')::numeric desc limit 1;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'peak_hour', 'When is the shop busiest today?', 'text',
    coalesce(v_txt, 'no sales yet today'),
    case when coalesce(v_pct, 0) > 0
         then format('%s of the day''s takings · %s%% of the day',
                     to_char(v_pct, 'FM999999990.00'),
                     round(v_pct / v_day_takings * 100))
         else 'nothing sold yet today' end,
    '/analytics?dimension=hour&measure=takings&period=day', 'schedule'));

  -- 12 · What are we giving away in discounts?
  v_r := app.analytics_run(p_branch_id, 'month', 'discount', 'month', null, null, '{}'::jsonb, 1, true);
  v_money := coalesce((v_r -> 'totals' ->> 'value')::numeric, 0);
  v_out := v_out || jsonb_build_array(app.bi_item(
    'discount_month', 'How much did we discount this month?', 'money', v_money::text,
    case when v_money = 0 then 'no discounts given this month'
         else format('%s%% of the month''s takings',
                     case when coalesce((v_r -> 'totals' ->> 'secondary')::numeric, 0) > 0
                          then round(v_money / (v_r -> 'totals' ->> 'secondary')::numeric * 100)
                          else 0 end)
    end,
    '/reports?report=sales', 'sell'));

  -- 13 · What came back?
  v_r := app.analytics_run(p_branch_id, 'day', 'refunds', 'custom', p_day, p_day, '{}'::jsonb, 1, true);
  v_money := coalesce((v_r -> 'totals' ->> 'value')::numeric, 0);
  v_out := v_out || jsonb_build_array(app.bi_item(
    'refunds_today', 'What did we refund today?', 'money', v_money::text,
    format('%s return(s) · %s%% of today''s takings',
           coalesce((v_r -> 'totals' ->> 'secondary')::numeric, 0)::int,
           case when v_day_takings > 0 then round(v_money / v_day_takings * 100) else 0 end),
    '/sales', 'undo'));

  -- 14 · Anything parked?
  select count(*), coalesce(sum(s.total), 0) into v_cnt, v_money
    from public.sales s
   where s.branch_id = p_branch_id and s.status = 'HELD';
  v_out := v_out || jsonb_build_array(app.bi_item(
    'held_sales', 'Is anything parked and forgotten?', 'count', v_cnt::int::text,
    case when v_cnt = 0 then 'no held bills'
         else format('worth %s waiting to be completed', to_char(v_money, 'FM999999990.00')) end,
    '/sales?status=HELD', 'pause_circle'));

  return v_out;
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 6. The public API
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.analytics_query(
  p_branch_id uuid,
  p_dimension text default 'day',
  p_measure   text default 'takings',
  p_period    text default 'month',
  p_from      date default null,
  p_to        date default null,
  p_filters   jsonb default '{}'::jsonb,
  p_limit     int default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare v_win jsonb;
begin
  v_win := app.analytics_window(p_branch_id, p_period, p_from, p_to);
  perform app.require_org((v_win ->> 'org')::uuid);
  perform app.require_permission('analytics.view');
  return app.analytics_run(p_branch_id, p_dimension, p_measure, p_period, p_from, p_to,
                           p_filters, least(greatest(p_limit, 1), 500))
         || jsonb_build_object('answers', public.bi_answers(p_branch_id, (v_win ->> 'today')::date));
end
$fn$;

create or replace function public.bi_answers(p_branch_id uuid, p_day date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare v_win jsonb;
begin
  v_win := app.analytics_window(p_branch_id, 'custom', p_day, p_day);
  perform app.require_org((v_win ->> 'org')::uuid);

  -- Either screen may show the answers: the dashboard is where an owner meets
  -- them, the analytics screen is where they dig in. A role that holds one
  -- permission but not the other still gets its questions answered.
  if not (app.has_permission('dashboard.view') or app.has_permission('analytics.view')) then
    raise exception 'permission_denied: %', 'dashboard.view' using errcode = '42501';
  end if;

  return app.bi_answers_internal(p_branch_id, p_day);
end
$fn$;

-- ── The dashboard, now built on the engine ────────────────────────────────
--
-- 016's function computed the eight widgets by hand; it keeps that job (the
-- widgets are unchanged and still the one definition of each number) but moves
-- to `app` so that this wrapper can add what Phase 5 needs — the trend lines,
-- the rankings and the answers — without copying any of it. Everything the
-- client sees still arrives from a single call (docs/09 #10).

alter function public.dashboard_summary(uuid, date) set schema app;
alter function app.dashboard_summary(uuid, date) rename to dashboard_widgets;

revoke execute on function app.dashboard_widgets(uuid, date) from public, anon, authenticated;

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
  v_org uuid;
  v_out jsonb;
begin
  v_out := app.dashboard_widgets(p_branch_id, p_day);   -- checks org + dashboard.view

  select b.organization_id into v_org
    from public.branches b where b.id = p_branch_id;

  return v_out || jsonb_build_object(
    'answers', public.bi_answers(p_branch_id, p_day),

    -- Thirty days of takings and profit for the trend chart; two statements
    -- each, both aggregates, no rows travelling.
    'trend_days', app.analytics_run(p_branch_id, 'day', 'takings', 'custom',
                                    p_day - 29, p_day, '{}'::jsonb, 31, false),
    'trend_profit', app.analytics_run(p_branch_id, 'day', 'profit', 'custom',
                                      p_day - 29, p_day, '{}'::jsonb, 31, false),
    'trend_months', app.analytics_run(p_branch_id, 'month', 'takings', 'year',
                                      null, null, '{}'::jsonb, 12, false),
    'rank_products', app.analytics_run(p_branch_id, 'product', 'takings', 'month',
                                       null, null, '{}'::jsonb, 5, false),
    'rank_categories', app.analytics_run(p_branch_id, 'category', 'takings', 'month',
                                         null, null, '{}'::jsonb, 6, false),
    'generated_at', now()
  );
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 7. What can be asked
-- ══════════════════════════════════════════════════════════════════════════
--
-- The pickers on the analytics screen are built from this, not from a list
-- written in TypeScript. The supported (measure × dimension) pairs come from
-- the same matrix the generator uses, so a combination that would answer
-- `unsupported_combination` is never offered in the first place — and adding
-- a measure here makes it selectable without touching the client.

create or replace function app.measure_meta(p_measure text)
returns jsonb
language sql
immutable
as $fn$
  select jsonb_build_object(
    'id', p_measure,
    'label', case p_measure
      when 'takings'       then 'Takings'
      when 'orders'        then 'Orders'
      when 'items'         then 'Units sold'
      when 'avg_order'     then 'Average bill'
      when 'profit'        then 'Profit'
      when 'revenue'       then 'Revenue (excl. tax)'
      when 'cogs'          then 'Cost of goods'
      when 'discount'      then 'Discount given'
      when 'tax'           then 'Tax collected'
      when 'refunds'       then 'Refunds'
      when 'expenses'      then 'Expenses'
      when 'purchases'     then 'Purchases'
      when 'purchase_due'  then 'Still owed to suppliers'
    end,
    'money', p_measure <> all (array['orders', 'items']),
    'unit', case
      when p_measure = 'orders' then 'bills'
      when p_measure = 'items' then 'units'
      when p_measure = 'refunds' then 'money'
      when p_measure = 'expenses' then 'money'
      else 'money' end,
    'description', case p_measure
      when 'takings'   then 'Money through the till, tax included.'
      when 'revenue'   then 'Takings with the tax taken out — what the shop actually earned.'
      when 'profit'    then 'Revenue minus the cost of the goods sold.'
      when 'orders'    then 'How many bills were closed.'
      when 'items'     then 'How many units left the shop.'
      when 'avg_order' then 'Takings divided by orders.'
      when 'cogs'      then 'Weighted average cost of the goods sold.'
      when 'discount'  then 'Line discounts and order discounts together.'
      when 'tax'       then 'Collected on behalf of the government.'
      when 'refunds'   then 'Money returned to customers.'
      when 'expenses'  then 'Money spent on everything that is not stock.'
      when 'purchases' then 'Stock bought from suppliers.'
      when 'purchase_due' then 'Purchase value not yet paid.'
    end
  )
$fn$;

create or replace function app.dimension_meta(p_dimension text)
returns jsonb
language sql
immutable
as $fn$
  select jsonb_build_object(
    'id', p_dimension,
    'label', case p_dimension
      when 'day' then 'Day' when 'week' then 'Week' when 'month' then 'Month'
      when 'hour' then 'Hour of day' when 'weekday' then 'Day of week'
      when 'category' then 'Category' when 'product' then 'Product'
      when 'variant' then 'Variant' when 'customer' then 'Customer'
      when 'cashier' then 'Cashier' when 'payment_method' then 'Payment method'
      when 'branch' then 'Branch' when 'expense_category' then 'Expense category'
      when 'supplier' then 'Supplier'
    end,
    'group', case
      when p_dimension in ('day', 'week', 'month', 'hour', 'weekday') then 'Time'
      when p_dimension in ('category', 'product', 'variant') then 'Catalogue'
      when p_dimension in ('customer', 'cashier', 'supplier', 'branch') then 'People'
      when p_dimension = 'payment_method' then 'Money'
      else 'Money' end,
    'kind', case
      when p_dimension in ('day', 'week', 'month', 'hour', 'weekday') then 'time'
      when p_dimension in ('customer', 'cashier', 'supplier', 'branch') then 'entity'
      else 'entity' end
  )
$fn$;

create or replace function public.analytics_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_measures text[] := array['takings', 'orders', 'items', 'avg_order', 'profit',
                             'revenue', 'cogs', 'discount', 'tax', 'refunds',
                             'expenses', 'purchases', 'purchase_due'];
  v_dimensions text[] := array['day', 'week', 'month', 'hour', 'weekday',
                               'category', 'product', 'variant', 'customer',
                               'cashier', 'payment_method', 'branch',
                               'expense_category', 'supplier'];
  v_measures_out jsonb := '[]'::jsonb;
  v_dimensions_out jsonb := '[]'::jsonb;
  v_combos jsonb := '[]'::jsonb;
  m text;
  d text;
begin
  perform app.require_permission('analytics.view');

  foreach m in array v_measures loop
    v_measures_out := v_measures_out || jsonb_build_array(app.measure_meta(m));
  end loop;

  foreach d in array v_dimensions loop
    v_dimensions_out := v_dimensions_out || jsonb_build_array(app.dimension_meta(d));
  end loop;

  foreach m in array v_measures loop
    foreach d in array v_dimensions loop
      if app.analytics_family(m, d) is not null then
        v_combos := v_combos || jsonb_build_array(
          jsonb_build_object('measure', m, 'dimension', d)
        );
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'measures', v_measures_out,
    'dimensions', v_dimensions_out,
    'periods', jsonb_build_array(
      jsonb_build_object('id', 'day', 'label', 'Today'),
      jsonb_build_object('id', 'week', 'label', 'This week'),
      jsonb_build_object('id', 'month', 'label', 'This month'),
      jsonb_build_object('id', 'quarter', 'label', 'This quarter'),
      jsonb_build_object('id', 'year', 'label', 'This year'),
      jsonb_build_object('id', 'custom', 'label', 'Custom range')
    ),
    'combos', v_combos
  );
end
$fn$;

-- ── Grants (018's rule: reachable by name, authorized by permission) ──────
revoke execute on function app.analytics_family(text, text) from public, anon, authenticated;
revoke execute on function app.analytics_sql(text, text, uuid, uuid, timestamptz, timestamptz, text, jsonb, int)
  from public, anon, authenticated;
revoke execute on function app.analytics_window(uuid, text, date, date) from public, anon, authenticated;
revoke execute on function app.analytics_run(uuid, text, text, text, date, date, jsonb, int, boolean)
  from public, anon, authenticated;
revoke execute on function app.bi_answers_internal(uuid, date) from public, anon, authenticated;
revoke execute on function app.bi_item(text, text, text, text, text, text, text) from public, anon, authenticated;

revoke execute on function app.measure_meta(text) from public, anon, authenticated;
revoke execute on function app.dimension_meta(text) from public, anon, authenticated;

grant execute on function public.analytics_query(uuid, text, text, text, date, date, jsonb, int)
  to authenticated;
grant execute on function public.analytics_catalog() to authenticated;
grant execute on function public.bi_answers(uuid, date) to authenticated;
grant execute on function public.dashboard_summary(uuid, date) to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_029_reports.sql
-- ══════════════════════════════════════════════════════════════════════

-- 029 — Reports: eleven questions, one framework (spec §23).
--
-- §23 wants reports that filter, search, sort and paginate, and the tempting
-- shortcut is to write each one as its own screen, its own query and its own
-- CSV encoder. That is how a shop ends up with a sales CSV whose column order
-- differs from the sales table on screen, and a "profit" column that means
-- something slightly different in each.
--
-- So there is one framework:
--
--   app.report_spec()  a declarative description of a report — its columns,
--                      its FROM/WHERE, what may be sorted, what may be
--                      searched, which columns carry a total
--   public.report_rows()   runs it with filters, search, sort, pagination,
--                      and returns rows + columns + row count + totals
--   public.report_catalog() the list of reports, from the same specs
--
-- The screen, the CSV export and the print view all read `report_rows`, so the
-- exported file is the table with commas — not a second implementation that
-- has to be kept in step. Sorting keys are whitelisted through the spec, and
-- every value is interpolated as a quoted literal: no text from a client ever
-- becomes SQL.
--
-- Measures written down here come from the Phase 5 engine and keep its
-- definitions: takings include tax, revenue does not, profit is revenue minus
-- cost of goods.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Two views the reports stand on
-- ══════════════════════════════════════════════════════════════════════════
--
-- `security_invoker` because a view without it runs as its owner and would
-- hand every organization's stock to any signed-in user (docs/09 #5).

create or replace view public.inventory_valuation
with (security_invoker = true) as
  select sb.organization_id,
         w.branch_id,
         sb.warehouse_id,
         w.name          as warehouse_name,
         p.id            as product_id,
         p.name          as product_name,
         p.sku,
         p.reorder_point,
         pc.name         as category_name,
         v.id            as variant_id,
         v.name_suffix   as variant_name,
         sb.quantity,
         sb.avg_unit_cost,
         round(sb.quantity * sb.avg_unit_cost, 2) as stock_value,
         case
           when not p.track_stock then 'untracked'
           when sb.quantity <= 0 then 'out'
           when sb.quantity <= p.reorder_point then 'low'
           else 'ok'
         end             as stock_state
    from public.stock_balances sb
    join public.products p          on p.id = sb.product_id
    join public.product_variants v  on v.id = sb.variant_id
    join public.warehouses w        on w.id = sb.warehouse_id
    left join public.product_categories pc on pc.id = p.category_id
   where p.deleted_at is null;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. What a report is
-- ══════════════════════════════════════════════════════════════════════════
--
-- Returns the spec as jsonb. Everything in it is written by this migration —
-- the only values that vary with a caller are quoted as literals.

create or replace function app.report_spec(
  p_report text,
  p_org    uuid,
  p_branch uuid,
  p_from   timestamptz,
  p_to     timestamptz,
  p_filters jsonb
)
returns jsonb
language plpgsql
stable
as $fn$
declare
  v_org_filter text;
  v_from_lit text;
  v_to_lit text;
  v_spec jsonb;
  v_type text;
  v_method uuid;
begin
  v_org_filter := format('%L', p_org);
  v_from_lit   := format('%L', p_from);
  v_to_lit     := format('%L', p_to);

  v_type   := nullif(p_filters ->> 'type', '');
  v_method := nullif(p_filters ->> 'method_id', '')::uuid;

  case p_report

  when 'sales' then
    v_spec := jsonb_build_object(
      'title', 'Sales',
      'group', 'Money',
      'description', 'Every completed bill in the period, with what it earned.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','invoice_no','label','Invoice','type','text'),
        jsonb_build_object('key','created_at','label','When','type','date'),
        jsonb_build_object('key','customer_name','label','Customer','type','text'),
        jsonb_build_object('key','cashier','label','Cashier','type','text'),
        jsonb_build_object('key','status','label','Status','type','status'),
        jsonb_build_object('key','subtotal','label','Subtotal','type','money','align','right'),
        jsonb_build_object('key','discount_total','label','Discount','type','money','align','right'),
        jsonb_build_object('key','tax_total','label','Tax','type','money','align','right'),
        jsonb_build_object('key','total','label','Total','type','money','align','right'),
        jsonb_build_object('key','refunded','label','Refunded','type','money','align','right'),
        jsonb_build_object('key','profit','label','Profit','type','money','align','right')
      ),
      'select', 'sd.id, sd.invoice_no, sd.created_at, sd.customer_name,
                 app.actor_email(sd.created_by) as cashier, sd.status,
                 sd.subtotal, sd.discount_total, sd.tax_total, sd.total,
                 coalesce(rf.refunded, 0) as refunded, sd.profit',
      'from', format('public.sales_detail sd
                      left join lateral (
                        select round(sum(sr.refund_total), 2) as refunded
                          from public.sale_returns sr where sr.sale_id = sd.id
                      ) rf on true'),
      'where', format('sd.organization_id = %L
                       and sd.created_at >= %s and sd.created_at < %s%s',
                      p_org, v_from_lit, v_to_lit,
                      case when p_branch is not null
                           then format(' and sd.branch_id = %L', p_branch) else '' end),
      'search', 'sd.invoice_no || '' '' || coalesce(sd.customer_name, '''')',
      'sort', jsonb_build_object('created_at','sd.created_at','total','sd.total',
                                 'profit','sd.profit','discount_total','sd.discount_total',
                                 'invoice_no','sd.invoice_no','refunded','coalesce(rf.refunded, 0)'),
      'default_sort', 'created_at',
      'totals', jsonb_build_array('subtotal','discount_total','tax_total','total','refunded','profit')
    );

  when 'profit' then
    v_spec := jsonb_build_object(
      'title', 'Profit',
      'group', 'Money',
      'description', 'Revenue, cost of goods and margin per bill — the same figures the P&L reads.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','invoice_no','label','Invoice','type','text'),
        jsonb_build_object('key','created_at','label','When','type','date'),
        jsonb_build_object('key','customer_name','label','Customer','type','text'),
        jsonb_build_object('key','revenue','label','Revenue','type','money','align','right'),
        jsonb_build_object('key','cogs','label','Cost of goods','type','money','align','right'),
        jsonb_build_object('key','profit','label','Profit','type','money','align','right'),
        jsonb_build_object('key','margin','label','Margin %','type','percent','align','right')
      ),
      'select', 'sd.invoice_no, sd.created_at, sd.customer_name,
                 round(sd.total - sd.tax_total, 2) as revenue,
                 sd.cogs, sd.profit,
                 round((sd.total - sd.tax_total - sd.cogs)
                       / nullif(sd.total - sd.tax_total, 0) * 100, 1) as margin',
      'from', 'public.sales_detail sd',
      'where', format('sd.organization_id = %L
                       and sd.created_at >= %s and sd.created_at < %s%s',
                      p_org, v_from_lit, v_to_lit,
                      case when p_branch is not null
                           then format(' and sd.branch_id = %L', p_branch) else '' end),
      'search', 'sd.invoice_no || '' '' || coalesce(sd.customer_name, '''')',
      'sort', jsonb_build_object('created_at','sd.created_at','revenue','revenue',
                                 'cogs','sd.cogs','profit','sd.profit','margin','margin'),
      'default_sort', 'created_at',
      'totals', jsonb_build_array('revenue','cogs','profit')
    );

  when 'inventory' then
    v_spec := jsonb_build_object(
      'title', 'Inventory',
      'group', 'Stock',
      'description', 'What is on the shelves right now, at weighted average cost.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','sku','label','SKU','type','text'),
        jsonb_build_object('key','product_name','label','Product','type','text'),
        jsonb_build_object('key','variant_name','label','Variant','type','text'),
        jsonb_build_object('key','category_name','label','Category','type','text'),
        jsonb_build_object('key','warehouse_name','label','Location','type','text'),
        jsonb_build_object('key','quantity','label','On hand','type','qty','align','right'),
        jsonb_build_object('key','avg_unit_cost','label','Unit cost','type','money','align','right'),
        jsonb_build_object('key','stock_value','label','Value','type','money','align','right'),
        jsonb_build_object('key','reorder_point','label','Reorder at','type','qty','align','right'),
        jsonb_build_object('key','stock_state','label','State','type','status')
      ),
      'select', 'iv.sku, iv.product_name, iv.variant_name, iv.category_name,
                 iv.warehouse_name, iv.quantity, iv.avg_unit_cost, iv.stock_value,
                 iv.reorder_point, iv.stock_state',
      'from', 'public.inventory_valuation iv',
      'where', format('iv.organization_id = %L%s%s',
                      p_org,
                      case when p_branch is not null
                           then format(' and iv.branch_id = %L', p_branch) else '' end,
                      case when v_type = 'low' then ' and iv.stock_state in (''low'', ''out'')'
                           when v_type = 'untracked' then ' and iv.stock_state = ''untracked'''
                           else '' end),
      'search', 'iv.product_name || '' '' || coalesce(iv.sku, '''') || '' '' || coalesce(iv.category_name, '''')',
      'sort', jsonb_build_object('product_name','iv.product_name','quantity','iv.quantity',
                                 'stock_value','iv.stock_value','avg_unit_cost','iv.avg_unit_cost',
                                 'sku','iv.sku','category_name','iv.category_name'),
      'default_sort', 'stock_value',
      'totals', jsonb_build_array('quantity','stock_value')
    );

  when 'product_performance' then
    v_spec := jsonb_build_object(
      'title', 'Product performance',
      'group', 'Selling',
      'description', 'Units, takings, cost and profit per item — including what came back.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','product_name','label','Product','type','text'),
        jsonb_build_object('key','variant_name','label','Variant','type','text'),
        jsonb_build_object('key','units_sold','label','Units','type','qty','align','right'),
        jsonb_build_object('key','orders','label','Bills','type','int','align','right'),
        jsonb_build_object('key','takings','label','Takings','type','money','align','right'),
        jsonb_build_object('key','cogs','label','Cost of goods','type','money','align','right'),
        jsonb_build_object('key','profit','label','Profit','type','money','align','right'),
        jsonb_build_object('key','margin','label','Margin %','type','percent','align','right'),
        jsonb_build_object('key','returned_qty','label','Returned','type','qty','align','right'),
        jsonb_build_object('key','returned_value','label','Refunded','type','money','align','right')
      ),
      'select', 'si.product_name, si.variant_name, si.sku,
                 sum(si.quantity) as units_sold,
                 count(distinct si.sale_id) as orders,
                 round(sum(si.line_total * (1 - si.order_share)), 2) as takings,
                 round(sum(si.line_cogs), 2) as cogs,
                 round(sum(si.line_total * (1 - si.order_share) - si.tax_total - si.line_cogs), 2) as profit,
                 round(sum(si.line_total * (1 - si.order_share) - si.tax_total - si.line_cogs)
                       / nullif(sum(si.line_total * (1 - si.order_share) - si.tax_total), 0) * 100, 1) as margin,
                 coalesce(ret.returned_qty, 0) as returned_qty,
                 coalesce(ret.returned_value, 0) as returned_value',
      'from', format('(select si0.product_id, si0.variant_id, si0.product_name,
                             v0.name_suffix as variant_name, si0.sku,
                             si0.quantity, si0.tax_total, si0.line_total, si0.line_cogs,
                             si0.sale_id,
                             case when coalesce(pool.line_pool, 0) > 0
                                  then greatest(s0.discount_total - coalesce(pool.line_disc, 0), 0)
                                       / pool.line_pool
                                  else 0 end as order_share
                        from public.sale_items si0
                        join public.sales s0 on s0.id = si0.sale_id
                        left join public.product_variants v0 on v0.id = si0.variant_id
                        left join (
                          select si2.sale_id, sum(si2.line_total) as line_pool,
                                 sum(si2.discount_total) as line_disc
                            from public.sale_items si2 group by 1
                        ) pool on pool.sale_id = si0.sale_id
                       where s0.organization_id = %L
                         and s0.created_at >= %s and s0.created_at < %s
                         and s0.status in (''COMPLETED'',''PARTIALLY_PAID'',''PARTIALLY_REFUNDED'')%s
                     ) si
                     left join (
                       select sit.variant_id,
                              sum(sri.quantity)      as returned_qty,
                              round(sum(sri.refund_amount), 2) as returned_value
                         from public.sale_return_items sri
                         join public.sale_items sit on sit.id = sri.sale_item_id
                         join public.sale_returns sr on sr.id = sri.return_id
                        where sr.organization_id = %L
                          and sr.created_at >= %s and sr.created_at < %s
                        group by 1
                     ) ret on ret.variant_id = si.variant_id',
                     p_org, v_from_lit, v_to_lit,
                     case when p_branch is not null
                          then format(' and s0.branch_id = %L', p_branch) else '' end,
                     p_org, v_from_lit, v_to_lit),
      'search', 'si.product_name || '' '' || coalesce(si.sku, '''') || '' '' || coalesce(si.variant_name, '''')',
      'sort', jsonb_build_object('takings','takings','units_sold','units_sold','profit','profit',
                                 'cogs','cogs','margin','margin','returned_value','returned_value',
                                 'product_name','si.product_name'),
      'default_sort', 'takings',
      'grouped', 'si.product_id, si.variant_id, si.product_name, si.variant_name, si.sku,
                  ret.returned_qty, ret.returned_value',
      'totals', jsonb_build_array('units_sold','orders','takings','cogs','profit','returned_value')
    );

  when 'customer' then
    v_spec := jsonb_build_object(
      'title', 'Customers',
      'group', 'People',
      'description', 'Who buys, how much, and who still owes.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','name','label','Customer','type','text'),
        jsonb_build_object('key','phone','label','Phone','type','text'),
        jsonb_build_object('key','orders','label','Bills','type','int','align','right'),
        jsonb_build_object('key','takings','label','Takings','type','money','align','right'),
        jsonb_build_object('key','profit','label','Profit','type','money','align','right'),
        jsonb_build_object('key','avg_bill','label','Average bill','type','money','align','right'),
        jsonb_build_object('key','last_purchase','label','Last bought','type','date'),
        jsonb_build_object('key','balance','label','Owes us','type','money','align','right'),
        jsonb_build_object('key','store_credit','label','Store credit','type','money','align','right')
      ),
      'select', 'c.name, c.phone,
                 coalesce(a.orders, 0) as orders,
                 coalesce(a.takings, 0) as takings,
                 coalesce(a.profit, 0) as profit,
                 coalesce(a.avg_bill, 0) as avg_bill,
                 a.last_purchase,
                 c.balance, c.store_credit',
      'from', format('public.customers c
                      left join lateral (
                        select count(*) as orders,
                               round(sum(s.total), 2) as takings,
                               round(sum(s.profit), 2) as profit,
                               round(avg(s.total), 2) as avg_bill,
                               max(s.created_at) as last_purchase
                          from public.sales s
                         where s.organization_id = %L and s.customer_id = c.id
                           and s.created_at >= %s and s.created_at < %s
                           and s.status in (''COMPLETED'',''PARTIALLY_PAID'',''PARTIALLY_REFUNDED'')%s
                      ) a on true',
                     p_org, v_from_lit, v_to_lit,
                     case when p_branch is not null
                          then format(' and s.branch_id = %L', p_branch) else '' end),
      'where', format('c.organization_id = %L and c.deleted_at is null%s',
                      p_org,
                      case when v_type = 'owing' then ' and c.balance > 0' else '' end),
      'search', 'c.name || '' '' || coalesce(c.phone, '''') || '' '' || coalesce(c.email, '''')',
      'sort', jsonb_build_object('name','c.name','takings','coalesce(a.takings, 0)',
                                 'profit','coalesce(a.profit, 0)','orders','coalesce(a.orders, 0)',
                                 'balance','c.balance','last_purchase','a.last_purchase',
                                 'store_credit','c.store_credit'),
      'default_sort', 'takings',
      'totals', jsonb_build_array('orders','takings','profit','balance','store_credit')
    );

  when 'supplier' then
    v_spec := jsonb_build_object(
      'title', 'Suppliers',
      'group', 'People',
      'description', 'What we bought, what we paid, what is still owed.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','name','label','Supplier','type','text'),
        jsonb_build_object('key','phone','label','Phone','type','text'),
        jsonb_build_object('key','purchases','label','Orders','type','int','align','right'),
        jsonb_build_object('key','spend','label','Purchased','type','money','align','right'),
        jsonb_build_object('key','paid','label','Paid','type','money','align','right'),
        jsonb_build_object('key','due_in_period','label','Added to balance','type','money','align','right'),
        jsonb_build_object('key','balance','label','Owed now','type','money','align','right'),
        jsonb_build_object('key','last_purchase','label','Last order','type','date')
      ),
      'select', 'sup.name, sup.phone,
                 coalesce(a.purchases, 0) as purchases,
                 coalesce(a.spend, 0) as spend,
                 coalesce(a.paid, 0) as paid,
                 coalesce(a.due_in_period, 0) as due_in_period,
                 sup.balance,
                 a.last_purchase',
      'from', format('public.suppliers sup
                      left join lateral (
                        select count(*) as purchases,
                               round(sum(p.total), 2) as spend,
                               round(sum(p.paid_total), 2) as paid,
                               round(sum(p.total - p.paid_total), 2) as due_in_period,
                               max(p.created_at) as last_purchase
                          from public.purchases p
                         where p.organization_id = %L and p.supplier_id = sup.id
                           and p.status <> ''DRAFT''
                           and p.created_at >= %s and p.created_at < %s%s
                      ) a on true',
                     p_org, v_from_lit, v_to_lit,
                     case when p_branch is not null
                          then format(' and p.branch_id = %L', p_branch) else '' end),
      'where', format('sup.organization_id = %L and sup.deleted_at is null%s',
                      p_org,
                      case when v_type = 'owing' then ' and sup.balance > 0' else '' end),
      'search', 'sup.name || '' '' || coalesce(sup.phone, '''') || '' '' || coalesce(sup.email, '''')',
      'sort', jsonb_build_object('name','sup.name','spend','coalesce(a.spend, 0)',
                                 'paid','coalesce(a.paid, 0)','purchases','coalesce(a.purchases, 0)',
                                 'balance','sup.balance','last_purchase','a.last_purchase'),
      'default_sort', 'balance',
      'totals', jsonb_build_array('purchases','spend','paid','due_in_period','balance')
    );

  when 'expense' then
    v_spec := jsonb_build_object(
      'title', 'Expenses',
      'group', 'Money',
      'description', 'Every rupee that left the drawer that was not stock.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','expense_date','label','Date','type','date'),
        jsonb_build_object('key','category_name','label','Category','type','text'),
        jsonb_build_object('key','description','label','Description','type','text'),
        jsonb_build_object('key','method','label','Method','type','text'),
        jsonb_build_object('key','cashier','label','Recorded by','type','text'),
        jsonb_build_object('key','amount','label','Amount','type','money','align','right')
      ),
      'select', 'e.expense_date, coalesce(ec.name, ''Uncategorised'') as category_name,
                 e.description, pm.name as method,
                 app.actor_email(e.created_by) as cashier, e.amount',
      'from', 'public.expenses e
               left join public.expense_categories ec on ec.id = e.category_id
               left join public.payment_methods pm   on pm.id = e.method_id',
      'where', format('e.organization_id = %L and e.deleted_at is null
                       and e.expense_date >= (%s::timestamptz at time zone %L)::date
                       and e.expense_date <  (%s::timestamptz at time zone %L)::date%s',
                      p_org, v_from_lit, (select timezone from public.organizations where id = p_org),
                      v_to_lit, (select timezone from public.organizations where id = p_org),
                      case when p_branch is not null
                           then format(' and e.branch_id = %L', p_branch) else '' end),
      'search', 'coalesce(e.description, '''') || '' '' || coalesce(ec.name, '''')',
      'sort', jsonb_build_object('expense_date','e.expense_date','amount','e.amount',
                                 'category_name','coalesce(ec.name, '''')','description','e.description'),
      'default_sort', 'expense_date',
      'totals', jsonb_build_array('amount')
    );

  when 'payment' then
    v_spec := jsonb_build_object(
      'title', 'Payments',
      'group', 'Money',
      'description', 'Money received, by method — the drawer count starts here.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','created_at','label','When','type','date'),
        jsonb_build_object('key','invoice_no','label','Invoice','type','text'),
        jsonb_build_object('key','customer_name','label','Customer','type','text'),
        jsonb_build_object('key','method','label','Method','type','money_name'),
        jsonb_build_object('key','amount','label','Amount','type','money','align','right'),
        jsonb_build_object('key','reference','label','Reference','type','text'),
        jsonb_build_object('key','cashier','label','Taken by','type','text')
      ),
      'select', 'sp.received_at as created_at, s.invoice_no, c.name as customer_name,
                 pm.name as method, sp.amount, sp.reference,
                 app.actor_email(sp.received_by) as cashier',
      'from', 'public.sale_payments sp
               join public.sales s     on s.id = sp.sale_id
               left join public.customers c on c.id = s.customer_id
               join public.payment_methods pm on pm.id = sp.method_id',
      'where', format('sp.organization_id = %L
                       and sp.received_at >= %s and sp.received_at < %s%s%s',
                      p_org, v_from_lit, v_to_lit,
                      case when p_branch is not null
                           then format(' and s.branch_id = %L', p_branch) else '' end,
                      case when v_method is not null
                           then format(' and sp.method_id = %L', v_method) else '' end),
      'search', 's.invoice_no || '' '' || coalesce(c.name, '''') || '' '' || coalesce(sp.reference, '''')',
      'sort', jsonb_build_object('created_at','sp.received_at','amount','sp.amount',
                                 'method','pm.name','invoice_no','s.invoice_no'),
      'default_sort', 'created_at',
      'totals', jsonb_build_array('amount')
    );

  when 'cashier' then
    v_spec := jsonb_build_object(
      'title', 'Cashiers',
      'group', 'People',
      'description', 'Who sold what, and how their drawer reconciled.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','cashier','label','Cashier','type','text'),
        jsonb_build_object('key','orders','label','Bills','type','int','align','right'),
        jsonb_build_object('key','takings','label','Takings','type','money','align','right'),
        jsonb_build_object('key','avg_bill','label','Average bill','type','money','align','right'),
        jsonb_build_object('key','discount','label','Discount given','type','money','align','right'),
        jsonb_build_object('key','profit','label','Profit','type','money','align','right'),
        jsonb_build_object('key','refunds','label','Refunded','type','money','align','right'),
        jsonb_build_object('key','sessions','label','Drawers opened','type','int','align','right'),
        jsonb_build_object('key','variance','label','Cash variance','type','money','align','right')
      ),
      'select', 'a.cashier, a.orders, a.takings, a.avg_bill, a.discount, a.profit,
                 coalesce(r.refunds, 0) as refunds,
                 coalesce(rs.sessions, 0) as sessions,
                 coalesce(rs.variance, 0) as variance',
      'from', format('(select app.actor_email(s.created_by) as cashier,
                             count(*) as orders,
                             round(sum(s.total), 2) as takings,
                             round(avg(s.total), 2) as avg_bill,
                             round(sum(s.discount_total), 2) as discount,
                             round(sum(s.profit), 2) as profit,
                             s.created_by
                        from public.sales s
                       where s.organization_id = %L
                         and s.created_at >= %s and s.created_at < %s
                         and s.status in (''COMPLETED'',''PARTIALLY_PAID'',''PARTIALLY_REFUNDED'')
                         and s.created_by is not null%s
                       group by s.created_by, app.actor_email(s.created_by)
                     ) a
                     left join (
                       select sr.created_by,
                              round(sum(sr.refund_total), 2) as refunds
                         from public.sale_returns sr
                        where sr.organization_id = %L
                          and sr.created_at >= %s and sr.created_at < %s
                        group by 1
                     ) r on r.created_by = a.created_by
                     left join (
                       select opened_by,
                              count(*) as sessions,
                              round(sum(closing_cash - (opening_cash + cash_in - cash_out
                                    + sales_cash - refund_cash - expense_cash)), 2) as variance
                         from public.register_sessions
                        where organization_id = %L and closed_at is not null
                          and opened_at >= %s and opened_at < %s%s
                        group by 1
                     ) rs on rs.opened_by = a.created_by',
                     p_org, v_from_lit, v_to_lit,
                     case when p_branch is not null
                          then format(' and s.branch_id = %L', p_branch) else '' end,
                     p_org, v_from_lit, v_to_lit,
                     p_org, v_from_lit, v_to_lit,
                     case when p_branch is not null
                          then format(' and branch_id = %L', p_branch) else '' end),
      'search', 'a.cashier',
      'sort', jsonb_build_object('cashier','a.cashier','takings','a.takings','orders','a.orders',
                                 'profit','a.profit','refunds','coalesce(r.refunds, 0)',
                                 'discount','a.discount','variance','coalesce(rs.variance, 0)'),
      'default_sort', 'takings',
      'totals', jsonb_build_array('orders','takings','discount','profit','refunds','variance')
    );

  when 'low_stock' then
    v_spec := jsonb_build_object(
      'title', 'Reorder list',
      'group', 'Stock',
      'description', 'Everything at or below its reorder point, with how much is missing.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','product_name','label','Product','type','text'),
        jsonb_build_object('key','variant_name','label','Variant','type','text'),
        jsonb_build_object('key','sku','label','SKU','type','text'),
        jsonb_build_object('key','warehouse_name','label','Location','type','text'),
        jsonb_build_object('key','quantity','label','On hand','type','qty','align','right'),
        jsonb_build_object('key','reorder_point','label','Reorder at','type','qty','align','right'),
        jsonb_build_object('key','shortfall','label','Short by','type','qty','align','right'),
        jsonb_build_object('key','avg_unit_cost','label','Unit cost','type','money','align','right'),
        jsonb_build_object('key','restock_cost','label','Cost to restock','type','money','align','right')
      ),
      'select', 'ls.name as product_name, ls.name_suffix as variant_name, ls.sku,
                 ls.warehouse_name, ls.quantity, ls.reorder_point,
                 greatest(ls.reorder_point - ls.quantity, 0) as shortfall,
                 ls.avg_unit_cost,
                 round(greatest(ls.reorder_point - ls.quantity, 0) * ls.avg_unit_cost, 2) as restock_cost',
      'from', 'public.low_stock ls',
      'where', format('ls.organization_id = %L and ls.quantity <= ls.reorder_point', p_org),
      'search', 'ls.name || '' '' || coalesce(ls.sku, '''')',
      'sort', jsonb_build_object('product_name','ls.name','quantity','ls.quantity',
                                 'shortfall','shortfall','restock_cost','restock_cost',
                                 'sku','ls.sku'),
      'default_sort', 'shortfall',
      'totals', jsonb_build_array('quantity','shortfall','restock_cost')
    );

  when 'stock_movement' then
    v_spec := jsonb_build_object(
      'title', 'Stock movements',
      'group', 'Stock',
      'description', 'The ledger: every reason a quantity changed, and who changed it.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','created_at','label','When','type','date'),
        jsonb_build_object('key','product_name','label','Product','type','text'),
        jsonb_build_object('key','variant_name','label','Variant','type','text'),
        jsonb_build_object('key','warehouse_name','label','Location','type','text'),
        jsonb_build_object('key','type','label','Reason','type','status'),
        jsonb_build_object('key','delta','label','Change','type','qty','align','right'),
        jsonb_build_object('key','before_quantity','label','Before','type','qty','align','right'),
        jsonb_build_object('key','after_quantity','label','After','type','qty','align','right'),
        jsonb_build_object('key','unit_cost','label','Unit cost','type','money','align','right'),
        jsonb_build_object('key','reference_type','label','Source','type','text'),
        jsonb_build_object('key','cashier','label','By','type','text'),
        jsonb_build_object('key','note','label','Note','type','text')
      ),
      'select', 'sh.created_at, sh.product_name, sh.variant_name, sh.warehouse_name,
                 sh.type, sh.delta, sh.before_quantity, sh.after_quantity, sh.unit_cost,
                 sh.reference_type, app.actor_email(sh.user_id) as cashier, sh.note',
      'from', 'public.stock_history sh',
      'where', format('sh.organization_id = %L
                       and sh.created_at >= %s and sh.created_at < %s%s',
                      p_org, v_from_lit, v_to_lit,
                      case when p_branch is not null
                           then format(' and sh.warehouse_id in
                                  (select id from public.warehouses where branch_id = %L)', p_branch)
                           else '' end),
      'search', 'sh.product_name || '' '' || coalesce(sh.note, '''') || '' '' || coalesce(sh.type, '''')',
      'sort', jsonb_build_object('created_at','sh.created_at','product_name','sh.product_name',
                                 'delta','sh.delta','type','sh.type'),
      'default_sort', 'created_at',
      'totals', jsonb_build_array('delta')
    );

  else
    raise exception 'unknown_report: %', p_report using errcode = '22023';
  end case;

  return v_spec || jsonb_build_object('key', p_report);
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Run a report
-- ══════════════════════════════════════════════════════════════════════════
--
-- Filters, search, sort and pagination are all server-side: a shop with two
-- years of bills must not wait for a phone to download them all in order to
-- show page one. The totals and the row count come from the same statement as
-- the rows, so "431 rows, ৳1,20,000" can never describe a different set from
-- the one on screen.

create or replace function public.report_rows(
  p_report    text,
  p_branch_id uuid  default null,
  p_period    text  default 'month',
  p_from      date  default null,
  p_to        date  default null,
  p_search    text  default null,
  p_sort      text  default null,
  p_dir       text  default 'desc',
  p_limit     int   default 25,
  p_offset    int   default 0,
  p_filters   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_win jsonb;
  v_org uuid;
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_spec jsonb;
  v_sort_key text;
  v_sort_expr text;
  v_dir text;
  v_where text;
  v_search text;
  v_limit int;
  v_offset int;
  v_rows jsonb;
  v_agg jsonb;
  v_aggs text := '';
  v_col text;
  v_row_sql text;
begin
  perform app.require_permission('reports.view');

  v_win := app.analytics_window(coalesce(p_branch_id, app.current_branch_id()), p_period, p_from, p_to);
  v_org := (v_win ->> 'org')::uuid;
  perform app.require_org(v_org);
  v_tz := v_win ->> 'timezone';

  -- The window arrives as branch-local dates and becomes instants here, so a
  -- "today" report means the shop's today (docs/09 #14).
  v_from := (((v_win ->> 'from')::date)::timestamp AT TIME ZONE v_tz);
  v_to   := (((v_win ->> 'to')::date)::timestamp AT TIME ZONE v_tz);

  v_spec := app.report_spec(p_report, v_org, p_branch_id, v_from, v_to, p_filters);

  v_sort_key  := coalesce(nullif(p_sort, ''), v_spec ->> 'default_sort');
  v_sort_expr := v_spec -> 'sort' ->> v_sort_key;
  if v_sort_expr is null then
    v_sort_key  := v_spec ->> 'default_sort';
    v_sort_expr := v_spec -> 'sort' ->> v_sort_key;
  end if;
  v_dir := case when lower(coalesce(p_dir, 'desc')) = 'asc' then 'asc' else 'desc' end;

  -- A report may carry its own filters inside FROM (product performance
  -- already windows by period there), so `where` can legitimately be empty.
  v_where  := coalesce(v_spec ->> 'where', '');
  v_search := nullif(trim(coalesce(p_search, '')), '');
  if v_search is not null and (v_spec ->> 'search') is not null then
    -- strpos, not LIKE: a search for "50%" must not become a wildcard, and a
    -- name with an underscore must match itself.
    v_where := v_where ||
      case when v_where = '' then '' else ' and ' end ||
      format('strpos(lower(%s), lower(%L)) > 0', v_spec ->> 'search', v_search);
  end if;

  v_limit  := least(greatest(coalesce(p_limit, 25), 1), 50000);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  -- `order by <key> <dir>, 1` — the tiebreak is the first selected column:
  -- a page of equal values (every row with the same total) must still come
  -- back in the same order when the offset moves, or pagination silently
  -- repeats rows and drops others.
  v_row_sql := format('select %s from %s%s%s order by %s %s, 1 asc',
                      v_spec ->> 'select', v_spec ->> 'from',
                      case when v_where = '' then '' else ' where ' || v_where end,
                      case when (v_spec ->> 'grouped') is not null
                           then ' group by ' || (v_spec ->> 'grouped') else '' end,
                      v_sort_expr, v_dir);

  -- Totals and row count over the whole filtered set: the row SQL without its
  -- page, wrapped so that a per-group report totals the groups.
  -- `jsonb_array_elements_text` gives the column names as text, which is what
  -- a jsonb_build_object key wants: `%L` quotes it, so a column name can never
  -- be read as SQL.
  for v_col in select * from jsonb_array_elements_text(v_spec -> 'totals') loop
    v_aggs := v_aggs || format('%L, coalesce(round(sum(t.%I)::numeric, 2), 0), ', v_col, v_col);
  end loop;
  v_aggs := v_aggs || '''total_rows'', count(*)::int';

  execute format(
    'select jsonb_build_object(%s) from (%s) t', v_aggs, v_row_sql
  ) into v_agg;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (%s limit %s offset %s) t',
    v_row_sql, v_limit, v_offset
  ) into v_rows;

  return jsonb_build_object(
    'key', p_report,
    'title', v_spec ->> 'title',
    'group', v_spec ->> 'group',
    'description', v_spec ->> 'description',
    'columns', v_spec -> 'columns',
    'rows', v_rows,
    'totals', coalesce(v_agg, '{}'::jsonb) - 'total_rows',
    'total_rows', coalesce((v_agg ->> 'total_rows')::int,
                           (select count(*) from jsonb_array_elements(v_rows))),
    'offset', v_offset,
    'limit', v_limit,
    'sort', v_sort_key,
    'dir', v_dir,
    'search', v_search,
    'period', p_period,
    'label', v_win ->> 'label',
    'from', v_win -> 'from',
    'to', v_win -> 'to',
    'currency', v_win ->> 'currency',
    'generated_at', now()
  );
end
$fn$;

-- The report library, from the same specs the runner uses: a report that
-- appears in this list is a report that runs, with exactly these columns.
create or replace function public.report_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_key text;
  v_out jsonb := '[]'::jsonb;
  v_spec jsonb;
begin
  perform app.require_permission('reports.view');
  v_org := (app.current_org_ids())[1];

  -- No window and no branch: a catalogue entry describes the columns and the
  -- description, and the period placeholders in a spec are never executed
  -- here. Asking for "the current branch" would make the library fail for a
  -- multi-branch owner who has not picked one yet — the screen would be empty
  -- for a reason that has nothing to do with reports.
  foreach v_key in array array['sales','profit','inventory','product_performance',
                               'customer','supplier','expense','payment','cashier',
                               'low_stock','stock_movement'] loop
    v_spec := app.report_spec(v_key, v_org, null,
                              (now() - interval '1 day'), now(), '{}'::jsonb);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', v_key,
      'title', v_spec ->> 'title',
      'group', v_spec ->> 'group',
      'description', v_spec ->> 'description',
      'columns', v_spec -> 'columns'
    ));
  end loop;

  return v_out;
end
$fn$;

-- ── Grants (018's rule) ───────────────────────────────────────────────────
revoke execute on function app.report_spec(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;

grant execute on function public.report_rows(text, uuid, text, date, date, text, text, text, int, int, jsonb)
  to authenticated;
grant execute on function public.report_catalog() to authenticated;

-- The views are read through the reporting functions, which filter by
-- organization explicitly. They are not part of the client API surface.
revoke all on public.inventory_valuation from anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 20260923_030_analytics_effective_day.sql
-- ══════════════════════════════════════════════════════════════════════

-- 030 — "Today" means today where the shop is, even when the caller is silent.
--
-- The Phase 5 screens do not send a date. The browser cannot know the branch's
-- timezone, so the day is left to the database on purpose, and the repository
-- sends `p_day: null`.
--
-- What the phone audit revealed is that `default current_date` never runs for
-- a NULL argument: PostgREST passes the null through, the default is bypassed,
-- and every day-scoped statement inside the function then compared against
-- NULL. Most quietly returned zero; one — the peak-hour answer dividing by the
-- day's takings — raised `division by zero` (22012) and took the whole
-- dashboard down with it.
--
-- So NULL now means "the branch's today", resolved in exactly one place.
-- `app.effective_day` is that place; it raises `branch_not_found` for an
-- unknown branch rather than answering about a day nobody asked for.
--
-- This migration re-defines the four functions whose bodies read the day: the
-- widgets, the answer builder, `public.bi_answers` and the dashboard wrapper.
-- The parameter keeps its name and type (`p_day date`, default null now), so a
-- client that does send an explicit date — an Android replay of yesterday, a
-- report for a chosen day — is unaffected. 029's `report_rows` derives its
-- dates from the period and never needed a default.

create or replace function app.effective_day(p_branch_id uuid, p_day date)
returns date
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_tz text;
begin
  if p_day is not null then
    return p_day;
  end if;

  select coalesce(b.timezone, o.timezone)
    into v_tz
    from public.branches b
    join public.organizations o on o.id = b.organization_id
   where b.id = p_branch_id;

  if v_tz is null then
    raise exception 'branch_not_found: %', p_branch_id using errcode = 'P0002';
  end if;

  return (now() at time zone v_tz)::date;
end
$fn$;

revoke execute on function app.effective_day(uuid, date) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- The widgets (016's body, moved to `app` by 028, day-resolved here)
-- ══════════════════════════════════════════════════════════════════════════

create or replace function app.dashboard_widgets(
  p_branch_id uuid,
  p_day       date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org  uuid;
  v_day  date;
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

  -- The caller's day; NULL means "today where the shop is" (see the header).
  v_day := app.effective_day(p_branch_id, p_day);

  -- Day boundaries in the branch's timezone, never server-local (docs/09 #14).
  v_from := (v_day::timestamp AT TIME ZONE v_tz);
  v_to   := ((v_day + 1)::timestamp AT TIME ZONE v_tz);

  select jsonb_build_object(
    'date', v_day,
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
       where branch_id = p_branch_id and expense_date = v_day
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

-- ══════════════════════════════════════════════════════════════════════════
-- The answers, and the two public entry points
-- ══════════════════════════════════════════════════════════════════════════

create or replace function app.bi_answers_internal(p_branch_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_day date;
  v_win jsonb;
  v_org uuid;
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_out jsonb := '[]'::jsonb;
  v_money numeric;
  v_cnt numeric;
  v_txt text;
  v_pct numeric;
  v_r jsonb;
  v_day_takings numeric;   -- today's takings, kept for the later percentages
  v_yday_avg numeric;
begin

  -- The caller's day; NULL means "today where the shop is" (see the header).
  v_day := app.effective_day(p_branch_id, p_day);
  v_win  := app.analytics_window(p_branch_id, 'custom', v_day, v_day);
  v_org  := (v_win ->> 'org')::uuid;
  v_tz   := v_win ->> 'timezone';
  v_from := (v_day::timestamp AT TIME ZONE v_tz);
  v_to   := ((v_day + 1)::timestamp AT TIME ZONE v_tz);

  -- 1 · What did we take today?
  select coalesce(sum(s.total), 0), count(*) into v_day_takings, v_cnt
    from public.sales s
   where s.branch_id = p_branch_id and s.created_at >= v_from and s.created_at < v_to
     and s.status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED');
  select coalesce(avg(s.total), 0) into v_yday_avg
    from public.sales s
   where s.branch_id = p_branch_id
     and s.created_at >= ((v_day - 1)::timestamp AT TIME ZONE v_tz)
     and s.created_at <  v_from
     and s.status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED');
  v_out := v_out || jsonb_build_array(app.bi_item(
    'takings_today', 'How much did we take today?', 'money', v_day_takings::text,
    format('%s orders · average bill %s · yesterday''s average %s',
           v_cnt::int,
           to_char(coalesce(v_day_takings / nullif(v_cnt, 0), 0), 'FM999999990.00'),
           to_char(v_yday_avg, 'FM999999990.00')),
    '/sales', 'payments'));

  -- 2 · Did we make money today?
  select coalesce(sum(s.profit), 0) into v_money
    from public.sales s
   where s.branch_id = p_branch_id and s.created_at >= v_from and s.created_at < v_to
     and s.status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED');
  v_out := v_out || jsonb_build_array(app.bi_item(
    'profit_today', 'Are we in profit today?', 'money', v_money::text,
    format('margin %s%% of takings · after cost of goods, before expenses',
           to_char(case when v_day_takings > 0 then v_money / v_day_takings * 100 else 0 end, 'FM990.0')),
    '/reports?report=profit', 'trending_up'));

  -- 3 · What is selling?
  v_r := app.analytics_run(p_branch_id, 'product', 'items', 'month', null, null, '{}'::jsonb, 5, false);
  select string_agg(x ->> 'label', ', ') into v_txt
    from jsonb_array_elements(v_r -> 'series') x;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'top_products', 'What are the best sellers this month?', 'text',
    coalesce(v_txt, 'nothing sold yet'),
    coalesce((v_r -> 'series' -> 0 ->> 'label'), 'nothing') || ' leads with '
      || round(coalesce((v_r -> 'series' -> 0 ->> 'value')::numeric, 0))::text || ' units sold',
    '/reports?report=product_performance', 'star'));

  -- 4 · Which parts of the shop earn?
  v_r := app.analytics_run(p_branch_id, 'category', 'takings', 'month', null, null, '{}'::jsonb, 6, false);
  select coalesce(sum((x ->> 'value')::numeric), 0) into v_money
    from jsonb_array_elements(v_r -> 'series') x;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'category_mix', 'What sells by category this month?', 'text',
    coalesce(v_r -> 'series' -> 0 ->> 'label', 'no sales yet'),
    format('%s%% of takings · %s categories with sales',
           case when v_money > 0
                then round(coalesce((v_r -> 'series' -> 0 ->> 'value')::numeric, 0) / v_money * 100)
                else 0 end,
           jsonb_array_length(v_r -> 'series')),
    '/analytics?dimension=category&measure=takings', 'category'));

  -- 5 · How do they pay?
  v_r := app.analytics_run(p_branch_id, 'payment_method', 'takings', 'custom', v_day, v_day, '{}'::jsonb, 6, false);
  select coalesce(sum((x ->> 'value')::numeric), 0) into v_money
    from jsonb_array_elements(v_r -> 'series') x;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'payment_mix', 'How are customers paying today?', 'text',
    coalesce(v_r -> 'series' -> 0 ->> 'label', 'no payments yet'),
    case when v_money > 0 then
      format('%s%% of today''s takings · %s method(s) used',
             round(coalesce((v_r -> 'series' -> 0 ->> 'value')::numeric, 0) / v_money * 100),
             jsonb_array_length(v_r -> 'series'))
    else 'no payments taken yet today' end,
    '/analytics?dimension=payment_method&measure=takings&period=day', 'credit_card'));

  -- 6 · How much cash is on the premises?
  select coalesce(sum(opening_cash + cash_in - cash_out + sales_cash - refund_cash - expense_cash), 0),
         count(*)
    into v_money, v_cnt
    from public.register_sessions
   where branch_id = p_branch_id and closed_at is null;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'cash_in_drawer', 'How much cash is in the drawer right now?', 'money', v_money::text,
    case when v_cnt = 0 then 'no register is open' else format('%s register(s) open', v_cnt::int) end,
    '/register', 'point_of_sale'));

  -- 7 · Who owes us?
  select coalesce(sum(c.balance), 0), count(*) into v_money, v_cnt
    from public.customers c
   where c.organization_id = v_org and c.deleted_at is null and c.balance > 0;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'receivable', 'Who owes us money?', 'money', v_money::text,
    format('%s customer(s) carrying a balance', v_cnt::int),
    '/customers', 'account_balance_wallet'));

  -- 8 · Who do we owe?
  select coalesce(sum(sup.balance), 0), count(*) into v_money, v_cnt
    from public.suppliers sup
   where sup.organization_id = v_org and sup.deleted_at is null and sup.balance > 0;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'payable', 'What do we owe suppliers?', 'money', v_money::text,
    format('%s supplier(s) with an outstanding balance', v_cnt::int),
    '/suppliers', 'local_shipping'));

  -- 9 · What must we reorder?
  select count(distinct ls.product_id) into v_cnt
    from public.low_stock ls
   where ls.organization_id = v_org;
  select string_agg(x.name, ', ') into v_txt
    from (select ls.name, sum(ls.quantity) as quantity
            from public.low_stock ls
           where ls.organization_id = v_org
           group by ls.name
           order by 2 asc
           limit 3) x;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'reorder', 'What needs reordering?', 'count', v_cnt::int::text,
    case when v_cnt = 0 then 'nothing is below its reorder point'
         else format('running out first: %s', coalesce(v_txt, '—')) end,
    '/reports?report=low_stock', 'inventory_2'));

  -- 10 · What did we spend?
  select coalesce(sum(e.amount), 0), count(*) into v_money, v_cnt
    from public.expenses e
   where e.branch_id = p_branch_id and e.expense_date = v_day and e.deleted_at is null;
  v_r := app.analytics_run(p_branch_id, 'expense_category', 'expenses', 'month', null, null, '{}'::jsonb, 1, false);
  v_out := v_out || jsonb_build_array(app.bi_item(
    'spend_today', 'What did we spend today?', 'money', v_money::text,
    format('%s expense entr(ies)', v_cnt::int)
      || case when jsonb_array_length(v_r -> 'series') = 0 then ''
              else format(' · biggest category this month: %s', v_r -> 'series' -> 0 ->> 'label') end,
    '/expenses', 'receipt_long'));

  -- 11 · When is the shop busy?
  v_r := app.analytics_run(p_branch_id, 'hour', 'takings', 'custom', v_day, v_day, '{}'::jsonb, 24, false);
  select coalesce(sum((x ->> 'value')::numeric), 0) into v_money
    from jsonb_array_elements(v_r -> 'series') x;
  select x ->> 'label', round((x ->> 'value')::numeric, 2)
    into v_txt, v_pct   -- v_pct reused here as the busiest hour's takings
    from jsonb_array_elements(v_r -> 'series') x
   order by (x ->> 'value')::numeric desc limit 1;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'peak_hour', 'When is the shop busiest today?', 'text',
    coalesce(v_txt, 'no sales yet today'),
    case when coalesce(v_pct, 0) > 0
         then format('%s of the day''s takings · %s%% of the day',
                     to_char(v_pct, 'FM999999990.00'),
                     round(v_pct / v_day_takings * 100))
         else 'nothing sold yet today' end,
    '/analytics?dimension=hour&measure=takings&period=day', 'schedule'));

  -- 12 · What are we giving away in discounts?
  v_r := app.analytics_run(p_branch_id, 'month', 'discount', 'month', null, null, '{}'::jsonb, 1, true);
  v_money := coalesce((v_r -> 'totals' ->> 'value')::numeric, 0);
  v_out := v_out || jsonb_build_array(app.bi_item(
    'discount_month', 'How much did we discount this month?', 'money', v_money::text,
    case when v_money = 0 then 'no discounts given this month'
         else format('%s%% of the month''s takings',
                     case when coalesce((v_r -> 'totals' ->> 'secondary')::numeric, 0) > 0
                          then round(v_money / (v_r -> 'totals' ->> 'secondary')::numeric * 100)
                          else 0 end)
    end,
    '/reports?report=sales', 'sell'));

  -- 13 · What came back?
  v_r := app.analytics_run(p_branch_id, 'day', 'refunds', 'custom', v_day, v_day, '{}'::jsonb, 1, true);
  v_money := coalesce((v_r -> 'totals' ->> 'value')::numeric, 0);
  v_out := v_out || jsonb_build_array(app.bi_item(
    'refunds_today', 'What did we refund today?', 'money', v_money::text,
    format('%s return(s) · %s%% of today''s takings',
           coalesce((v_r -> 'totals' ->> 'secondary')::numeric, 0)::int,
           case when v_day_takings > 0 then round(v_money / v_day_takings * 100) else 0 end),
    '/sales', 'undo'));

  -- 14 · Anything parked?
  select count(*), coalesce(sum(s.total), 0) into v_cnt, v_money
    from public.sales s
   where s.branch_id = p_branch_id and s.status = 'HELD';
  v_out := v_out || jsonb_build_array(app.bi_item(
    'held_sales', 'Is anything parked and forgotten?', 'count', v_cnt::int::text,
    case when v_cnt = 0 then 'no held bills'
         else format('worth %s waiting to be completed', to_char(v_money, 'FM999999990.00')) end,
    '/sales?status=HELD', 'pause_circle'));

  return v_out;
end
$fn$;

create or replace function public.bi_answers(p_branch_id uuid, p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_day date;
  v_win jsonb;
begin

  -- The caller's day; NULL means "today where the shop is" (see the header).
  v_day := app.effective_day(p_branch_id, p_day);
  v_win := app.analytics_window(p_branch_id, 'custom', v_day, v_day);
  perform app.require_org((v_win ->> 'org')::uuid);

  -- Either screen may show the answers: the dashboard is where an owner meets
  -- them, the analytics screen is where they dig in. A role that holds one
  -- permission but not the other still gets its questions answered.
  if not (app.has_permission('dashboard.view') or app.has_permission('analytics.view')) then
    raise exception 'permission_denied: %', 'dashboard.view' using errcode = '42501';
  end if;

  return app.bi_answers_internal(p_branch_id, v_day);
end
$fn$;

create or replace function public.dashboard_summary(
  p_branch_id uuid,
  p_day       date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_day date;
  v_org uuid;
  v_out jsonb;
begin

  -- The caller's day; NULL means "today where the shop is" (see the header).
  v_day := app.effective_day(p_branch_id, p_day);
  v_out := app.dashboard_widgets(p_branch_id, v_day);   -- checks org + dashboard.view

  select b.organization_id into v_org
    from public.branches b where b.id = p_branch_id;

  return v_out || jsonb_build_object(
    'answers', public.bi_answers(p_branch_id, v_day),

    -- Thirty days of takings and profit for the trend chart; two statements
    -- each, both aggregates, no rows travelling.
    'trend_days', app.analytics_run(p_branch_id, 'day', 'takings', 'custom',
                                    v_day - 29, v_day, '{}'::jsonb, 31, false),
    'trend_profit', app.analytics_run(p_branch_id, 'day', 'profit', 'custom',
                                      v_day - 29, v_day, '{}'::jsonb, 31, false),
    'trend_months', app.analytics_run(p_branch_id, 'month', 'takings', 'year',
                                      null, null, '{}'::jsonb, 12, false),
    'rank_products', app.analytics_run(p_branch_id, 'product', 'takings', 'month',
                                       null, null, '{}'::jsonb, 5, false),
    'rank_categories', app.analytics_run(p_branch_id, 'category', 'takings', 'month',
                                         null, null, '{}'::jsonb, 6, false),
    'generated_at', now()
  );
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- ACLs: `create or replace` keeps existing grants, but they are restated so a
-- database rebuilt from the files lands in exactly the same state.
-- ══════════════════════════════════════════════════════════════════════════

revoke execute on function app.dashboard_widgets(uuid, date) from public, anon, authenticated;
revoke execute on function app.bi_answers_internal(uuid, date) from public, anon, authenticated;

revoke execute on function public.bi_answers(uuid, date) from public, anon;
grant execute on function public.bi_answers(uuid, date) to authenticated;

revoke execute on function public.dashboard_summary(uuid, date) from public, anon;
grant execute on function public.dashboard_summary(uuid, date) to authenticated;
