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
