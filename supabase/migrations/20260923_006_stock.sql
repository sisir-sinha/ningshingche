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
