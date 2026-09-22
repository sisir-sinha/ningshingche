-- Mekholi Lite — Full Supabase Schema (Vanilla TS, No framework)
-- Run in Supabase Dashboard → SQL Editor
-- Compatible with your handle_new_user_signup() trigger (keeps 7-day trial)

-- Enable pgcrypto for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ========== STORES & PROFILES (keep your existing, patch below) ==========
-- If you already ran Mekholi POS doc schema, these ALTERs are safe (IF NOT EXISTS)
-- Uncomment if starting fresh:
-- create table if not exists stores (
--   id uuid primary key default gen_random_uuid(),
--   name text not null,
--   trial_starts_at timestamptz default now(),
--   trial_ends_at timestamptz default (now() + interval '7 days'),
--   subscription_status text default 'trialing' check (subscription_status in ('trialing','active','expired'))
-- );
-- create table if not exists profiles (
--   id uuid primary key references auth.users(id) on delete cascade,
--   store_id uuid references stores(id),
--   full_name text,
--   auth_provider text,
--   role text check (role in ('owner','manager','cashier'))
-- );

-- PATCH existing stores/products/orders for Bangladesh Lite
alter table stores add column if not exists bin text;
alter table stores add column if not exists address text;
alter table stores add column if not exists phone text;
alter table stores add column if not exists currency text default 'BDT';
alter table stores add column if not exists vat_enabled boolean default false;
alter table stores add column if not exists default_vat_rate numeric(4,2) default 0;

alter table products add column if not exists unit text default 'pcs';
alter table products add column if not exists sku text;
alter table products add column if not exists variant text;
alter table products add column if not exists wholesale_price numeric(10,2);
alter table products add column if not exists low_stock_alert int default 5;
alter table products add column if not exists vat_rate numeric(4,2) default 0;
alter table products add column if not exists is_loose boolean default false;
alter table products add column if not exists image_url text;

-- orders patches (client_uuid for offline idempotency, bin snapshot, vat)
alter table orders add column if not exists customer_id uuid references customers(id);
alter table orders add column if not exists is_due boolean default false;
alter table orders add column if not exists due_amount numeric(10,2) default 0;
alter table orders add column if not exists mfs_trxid text;
alter table orders add column if not exists vat_rate numeric(4,2);
alter table orders add column if not exists vat_amount numeric(10,2) default 0;
alter table orders add column if not exists discount_type text default 'amount' check (discount_type in ('amount','percent'));
alter table orders add column if not exists note text;
alter table orders add column if not exists client_uuid text unique;
alter table orders add column if not exists bin_snapshot text;

alter table order_items add column if not exists vat_rate numeric(4,2) default 0;
alter table order_items add column if not exists vat_amount numeric(10,2) default 0;
alter table order_items add column if not exists unit_snapshot text;

-- ========== NEW TABLES (Bangladesh Lite) ==========
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  name text not null,
  phone text not null,
  address text,
  due_balance numeric(10,2) default 0,
  total_purchase numeric(12,2) default 0,
  created_at timestamptz default now(),
  unique(store_id, phone)
);
create index if not exists idx_customers_phone on customers(phone);
create index if not exists idx_customers_store on customers(store_id);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  name text not null,
  phone text,
  address text,
  due_balance numeric(10,2) default 0,
  created_at timestamptz default now()
);

create table if not exists khata_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  customer_id uuid references customers(id) on delete set null,
  supplier_id uuid references suppliers(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  type text check (type in ('dilam','pelam')) not null,
  amount numeric(10,2) not null check (amount > 0),
  note text,
  sms_sent boolean default false,
  client_uuid text unique,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  supplier_id uuid references suppliers(id),
  receipt_no text not null,
  subtotal numeric(10,2) not null,
  discount_amount numeric(10,2) default 0,
  total_amount numeric(10,2) not null,
  paid_amount numeric(10,2) default 0,
  created_at timestamptz default now()
);
create table if not exists purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid references purchases(id) on delete cascade not null,
  product_id uuid references products(id) not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit_cost numeric(10,2) not null
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  category text check (category in ('rent','electricity','staff','transport','other')) not null,
  amount numeric(10,2) not null,
  note text,
  expense_date date default current_date,
  created_at timestamptz default now()
);

create table if not exists vat_profiles (
  store_id uuid primary key references stores(id) on delete cascade,
  bin text not null,
  vat_area_code text,
  default_vat_rate numeric(4,2) default 15,
  mushak_enabled boolean default true
);

create table if not exists cash_drawer_logs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  opened_at timestamptz default now(),
  closed_at timestamptz,
  opening_cash numeric(10,2) default 0,
  expected_cash numeric(10,2),
  closing_cash numeric(10,2),
  difference numeric(10,2),
  opened_by uuid references profiles(id)
);

create table if not exists returns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade not null,
  order_id uuid references orders(id) not null,
  reason text,
  refund_amount numeric(10,2) not null,
  refund_method text check (refund_method in ('cash','bkash','nagad','due_adjust')),
  created_at timestamptz default now()
);

-- ========== TRIGGERS (stock & due) ==========
create or replace function deduct_stock() returns trigger as $$
begin update products set stock_quantity = stock_quantity - NEW.quantity where id = NEW.product_id; return NEW; end; $$ language plpgsql;
drop trigger if exists trg_deduct on order_items;
create trigger trg_deduct after insert on order_items for each row execute function deduct_stock();

create or replace function add_stock() returns trigger as $$
begin update products set stock_quantity = stock_quantity + NEW.quantity where id = NEW.product_id; return NEW; end; $$ language plpgsql;
drop trigger if exists trg_add on purchase_items;
create trigger trg_add after insert on purchase_items for each row execute function add_stock();

create or replace function update_due() returns trigger as $$
begin
  if NEW.customer_id is not null then
    update customers set due_balance = due_balance + (case when NEW.type='dilam' then NEW.amount else -NEW.amount end) where id = NEW.customer_id;
  elsif NEW.supplier_id is not null then
    update suppliers set due_balance = due_balance + (case when NEW.type='dilam' then NEW.amount else -NEW.amount end) where id = NEW.supplier_id;
  end if; return NEW; end; $$ language plpgsql;
drop trigger if exists trg_due on khata_entries;
create trigger trg_due after insert on khata_entries for each row execute function update_due();

-- ========== RLS (copy your tenant isolation) ==========
-- Enable RLS and add tenant policy for new tables (repeat for each)
do $$
declare t text;
begin
  foreach t in array array['customers','suppliers','khata_entries','purchases','purchase_items','expenses','vat_profiles','cash_drawer_logs','returns']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Tenant isolation" on %I', t);
    execute format('create policy "Tenant isolation" on %I for all using (store_id in (select store_id from profiles where id = auth.uid()))', t);
  end loop;
end $$;

-- ========== SEED CHECK ==========
-- Verify: select * from stores limit 1; select * from customers limit 1;
