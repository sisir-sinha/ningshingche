-- 010 — Purchases: orders, items, payments.

create type public.purchase_status as enum (
  'DRAFT',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED'
);

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
