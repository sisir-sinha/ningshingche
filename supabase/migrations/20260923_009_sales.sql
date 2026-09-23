-- 009 — Sales: sales, items, payments, returns.
--
-- Snapshotting (docs/09 #4): unit_price, unit_cost, product_name, sku and
-- tax_rate are copied onto sale_items at sale time. Editing a price or cost
-- next month must not rewrite last month's profit.

create type public.sale_status as enum (
  'DRAFT',
  'HELD',
  'COMPLETED',
  'PARTIALLY_PAID',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED'
);

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
