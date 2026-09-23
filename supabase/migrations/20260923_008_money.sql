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
