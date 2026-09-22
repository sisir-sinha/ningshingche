-- Mekholi Lite — COMPLETE Supabase Schema (fresh project)
-- Run FULL file in Supabase Dashboard → SQL Editor → Run
-- Works on empty project (creates stores/products/orders) AND on existing Mekholi (patches)
-- Vanilla TS + History API (no hash) • 22 Sep 2026

-- Enable pgcrypto for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ========== 1) BASE TABLES (create if not exists — for fresh Supabase project) ==========
create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trial_starts_at timestamptz default now(),
  trial_ends_at timestamptz default (now() + interval '7 days'),
  subscription_status text default 'trialing' check (subscription_status in ('trialing','active','expired'))
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  store_id uuid references stores(id),
  full_name text,
  auth_provider text,
  role text check (role in ('owner','manager','cashier'))
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade,
  name text not null
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  name text not null,
  barcode text,
  price numeric(10,2) not null check (price >= 0),
  cost_price numeric(10,2),
  stock_quantity integer default 0
);
create index if not exists idx_products_store on products(store_id);
create index if not exists idx_products_barcode on products(barcode);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade,
  cashier_id uuid references profiles(id),
  receipt_number text not null,
  subtotal numeric(10,2) not null,
  tax_amount numeric(10,2) default 0,
  discount_amount numeric(10,2) default 0,
  total_amount numeric(10,2) not null,
  payment_method text check (payment_method in ('cash','card','qr','split','bkash','nagad','rocket','upay','bangla_qr','due','bank')) default 'cash',
  created_at timestamptz default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  product_id uuid references products(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null
);

-- ========== 2) BANGLADESH LITE PATCH (add BDT/VAT/Baki columns) ==========
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

-- Create customers/suppliers BEFORE altering orders (FK needs to exist)
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

-- Now safe to patch orders (customers exists)
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

-- ========== 3) NEW TABLES (Bangladesh Lite) ==========
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

-- ========== 4) TRIGGERS (stock & due) ==========
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

-- 7-day trial auto-provision (from your Mekholi doc — keep if not exists)
create or replace function public.handle_new_user_signup()
returns trigger as $$
declare new_store_id uuid;
begin
  insert into public.stores (name, trial_starts_at, trial_ends_at, subscription_status)
  values (coalesce(NEW.raw_user_meta_data->>'store_name', 'My Mekholi Store'), now(), now() + interval '7 days', 'trialing')
  returning id into new_store_id;
  insert into public.profiles (id, store_id, full_name, auth_provider, role)
  values (NEW.id, new_store_id, coalesce(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.raw_app_meta_data->>'provider', 'owner');
  return NEW;
end; $$ language plpgsql security definer;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user_signup();

-- ========== 5) RLS (tenant isolation by store_id) — recursion-safe via helper ==========
-- Helper that bypasses RLS (SECURITY DEFINER) — prevents infinite recursion on profiles
create or replace function public.current_store_id()
returns uuid language sql security definer set search_path = public stable as $$
  select store_id from public.profiles where id = auth.uid() limit 1
$$;

-- Enable RLS for core tables
do $$
declare t text;
begin
  foreach t in array array['stores','profiles','categories','products','orders','order_items']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Policies for core (use helper, not subquery on profiles which recurses)
drop policy if exists "Tenant Isolation Policy for Products" on products;
create policy "Tenant Isolation Policy for Products" on products for all using (store_id = public.current_store_id());
drop policy if exists "Tenant isolation - stores" on stores;
create policy "Tenant isolation - stores" on stores for all using (id = public.current_store_id());
drop policy if exists "Tenant isolation - profiles" on profiles;
create policy "Tenant isolation - profiles" on profiles for all using (id = auth.uid() or store_id = public.current_store_id());
drop policy if exists "Tenant isolation - categories" on categories;
create policy "Tenant isolation - categories" on categories for all using (store_id = public.current_store_id());
drop policy if exists "Tenant isolation - orders" on orders;
create policy "Tenant isolation - orders" on orders for all using (store_id = public.current_store_id());
drop policy if exists "Tenant isolation - order_items" on order_items;
create policy "Tenant isolation - order_items" on order_items for all using (order_id in (select id from orders where store_id = public.current_store_id()));

-- Policies for new Lite tables
do $$
declare t text;
begin
  foreach t in array array['customers','suppliers','khata_entries','purchases','expenses','vat_profiles','cash_drawer_logs','returns']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Tenant isolation" on %I', t);
    execute format('create policy "Tenant isolation" on %I for all using (store_id = public.current_store_id())', t);
  end loop;
  -- purchase_items via purchases
  execute 'alter table purchase_items enable row level security';
  execute 'drop policy if exists "Tenant isolation" on purchase_items';
  execute 'create policy "Tenant isolation" on purchase_items for all using (purchase_id in (select id from purchases where store_id = public.current_store_id()))';
end $$;

-- Verify: select * from stores limit 1; select * from customers limit 1;
