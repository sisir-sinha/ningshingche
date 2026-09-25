-- The serial-number pool.
--
-- One row is one physical unit a shop can pick up and hand to a customer: an
-- IMEI, an engine number, a watch's case number. It is not a product field,
-- because a shop does not own "the serial number of an iPhone 15" — it owns
-- *this* handset, and the whole point of tracking it is that the shop knows
-- exactly which unit left, on which invoice, and when.
--
-- So this table is deliberately thin. It records identity (`serial`), what the
-- unit is (`variant_id`), where it is (`warehouse_id`), and where it went
-- (`sale_id` / `sale_item_id`). Everything about *selling* a unit — the price,
-- the stock ledger, the invoice — stays in the core tables, and the plugin
-- never writes to them. That is spec §51: the universal thing stays universal,
-- and what a jewellery or mobile shop does differently becomes a plugin.
--
-- `status` is the truth; the sale columns are the last binding. A returned
-- unit goes back to the shelf by being released, which leaves `sale_id` in
-- place so the unit's history survives the round trip.

create table if not exists public.plg_serial_numbers_serials (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  variant_id      uuid not null references public.product_variants(id) on delete cascade,
  warehouse_id    uuid references public.warehouses(id) on delete set null,
  serial          text not null,
  status          text not null default 'IN_STOCK'
                    check (status in ('IN_STOCK', 'SOLD', 'RETURNED')),
  -- MANUAL: typed or scanned in. IMPORT: pasted as a list. INTERNAL: minted by
  -- the plugin for a shop that does not scan, so the units are still traceable.
  source          text not null default 'MANUAL'
                    check (source in ('MANUAL', 'IMPORT', 'INTERNAL')),
  note            text,
  sale_id         uuid references public.sales(id) on delete set null,
  sale_item_id    uuid references public.sale_items(id) on delete set null,
  customer_id     uuid references public.customers(id) on delete set null,
  received_at     timestamptz not null default now(),
  sold_at         timestamptz,
  returned_at     timestamptz,
  released_at     timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A unit cannot be sold without a sale to be sold on. This is the constraint
  -- that makes "the serial is on the invoice" a fact rather than a hope.
  constraint plg_serial_numbers_sold_needs_sale
    check (status <> 'SOLD' or sale_id is not null)
);

-- One serial, one unit, per shop. Case-insensitive because a human typing an
-- IMEI will not agree with a barcode scanner about case, and two rows for one
-- handset is exactly the failure this table exists to prevent.
create unique index if not exists plg_serial_numbers_org_serial_idx
  on public.plg_serial_numbers_serials (organization_id, lower(serial));

create index if not exists plg_serial_numbers_variant_idx
  on public.plg_serial_numbers_serials (organization_id, variant_id, status);

-- The sale tab asks "what went out on this sale?" on every open.
create index if not exists plg_serial_numbers_sale_idx
  on public.plg_serial_numbers_serials (organization_id, sale_id);

create index if not exists plg_serial_numbers_item_idx
  on public.plg_serial_numbers_serials (sale_item_id)
  where sale_item_id is not null;

drop trigger if exists plg_serial_numbers_serials_touch on public.plg_serial_numbers_serials;
create trigger plg_serial_numbers_serials_touch
  before update on public.plg_serial_numbers_serials
  for each row execute function public.set_updated_at();

alter table public.plg_serial_numbers_serials enable row level security;

-- Reading needs `serial-numbers.view`, writing needs `serial-numbers.manage`.
-- Both are the plugin's own keys, so a shop can let a stock clerk look up an
-- IMEI without letting them move one.
drop policy if exists plg_serial_numbers_serials_select on public.plg_serial_numbers_serials;
create policy plg_serial_numbers_serials_select on public.plg_serial_numbers_serials
  for select using (
    app.in_org(organization_id) and app.has_permission('serial-numbers.view')
  );

drop policy if exists plg_serial_numbers_serials_write on public.plg_serial_numbers_serials;
create policy plg_serial_numbers_serials_write on public.plg_serial_numbers_serials
  for all using (
    app.in_org(organization_id) and app.has_permission('serial-numbers.manage')
  )
  with check (
    app.in_org(organization_id) and app.has_permission('serial-numbers.manage')
  );

grant select, insert, update, delete on public.plg_serial_numbers_serials to authenticated;
