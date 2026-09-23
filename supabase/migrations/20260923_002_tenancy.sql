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
