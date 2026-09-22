-- FIX: infinite recursion detected in policy for relation "profiles"
-- Run this in Supabase SQL Editor (1 click) — fixes current DB immediately
-- Root cause: policy on profiles queried profiles itself → recursion

-- 1) Helper function that bypasses RLS (SECURITY DEFINER)
create or replace function public.current_store_id()
returns uuid
language sql
security definer
set search_path = public
stable as $$
  select store_id from public.profiles where id = auth.uid() limit 1
$$;

-- 2) Fix profiles policy — allow user to see own row + same-store rows via helper
drop policy if exists "Tenant isolation - profiles" on profiles;
create policy "Tenant isolation - profiles" on profiles
for all using (
  id = auth.uid() 
  or store_id = public.current_store_id()
);

-- 3) Fix stores policy to use helper (avoids recursion)
drop policy if exists "Tenant isolation - stores" on stores;
create policy "Tenant isolation - stores" on stores
for all using (id = public.current_store_id());

-- 4) Fix other core policies to use helper (faster + no recursion)
drop policy if exists "Tenant Isolation Policy for Products" on products;
create policy "Tenant Isolation Policy for Products" on products
for all using (store_id = public.current_store_id());

drop policy if exists "Tenant isolation - categories" on categories;
create policy "Tenant isolation - categories" on categories
for all using (store_id = public.current_store_id());

drop policy if exists "Tenant isolation - orders" on orders;
create policy "Tenant isolation - orders" on orders
for all using (store_id = public.current_store_id());

drop policy if exists "Tenant isolation - order_items" on order_items;
create policy "Tenant isolation - order_items" on order_items
for all using (order_id in (select id from orders where store_id = public.current_store_id()));

-- 5) Fix Lite tables (except purchase_items which joins via purchases)
do $$
declare t text;
begin
  foreach t in array array['customers','suppliers','khata_entries','purchases','expenses','vat_profiles','cash_drawer_logs','returns']
  loop
    execute format('drop policy if exists "Tenant isolation" on %I', t);
    execute format('create policy "Tenant isolation" on %I for all using (store_id = public.current_store_id())', t);
  end loop;
end $$;

drop policy if exists "Tenant isolation" on purchase_items;
create policy "Tenant isolation" on purchase_items
for all using (purchase_id in (select id from purchases where store_id = public.current_store_id()));

-- Verify: should return no error now
-- select * from profiles limit 1;
-- select * from stores limit 1;
