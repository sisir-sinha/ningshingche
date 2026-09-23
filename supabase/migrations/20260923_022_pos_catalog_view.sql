-- 022 — The POS catalogue read path.
--
-- The point-of-sale screen needs one thing: "given what the cashier typed,
-- give me sellable products with their price, tax and stock." Assembled from
-- PostgREST that is five embedded resources plus two coalesces that the client
-- would have to redo on every keystroke — and every client (web, Android)
-- would have to agree on.
--
-- A view puts the coalescing where the columns are defined, so the rule
-- "a variant's price falls back to its product's price" exists once. The
-- client asks for rows; it never re-derives pricing.
--
-- `security_invoker = on` is the important line. Without it the view runs as
-- its owner and bypasses the row-level security on every table underneath,
-- which would hand any signed-in user every organization's catalogue. With it
-- the view is merely a saved query and the underlying policies still apply.

create or replace view public.pos_catalog
with (security_invoker = on)
as
select
  p.organization_id,
  p.id                                        as product_id,
  p.name,
  p.sku,
  p.description,
  p.image_url,
  p.track_stock,
  p.allow_negative,
  p.tax_inclusive,
  p.category_id,
  p.brand_id,
  p.reorder_point,
  p.search_text,
  p.metadata,
  v.id                                        as variant_id,
  v.name_suffix                               as variant_name,
  coalesce(v.sku, p.sku)                      as effective_sku,
  -- Price and cost resolution lives here and nowhere else. A variant may
  -- override either; when it does not, it inherits the product's.
  coalesce(v.price_override, p.selling_price) as price,
  coalesce(v.cost_override,  p.cost_price)    as cost,
  v.is_default,
  u.symbol                                    as unit_label,
  coalesce(u.is_decimal, false)               as decimal_quantity,
  coalesce(t.rate, 0)                         as tax_rate,
  c.name                                      as category_name,
  sb.warehouse_id,
  coalesce(sb.quantity, 0)                    as available
from public.products p
join public.product_variants v
  on v.product_id = p.id
 and v.deleted_at is null
 and v.is_active
left join public.product_units u on u.id = p.unit_id
left join public.taxes t         on t.id = p.tax_id and t.is_active
left join public.product_categories c on c.id = p.category_id
left join public.stock_balances sb    on sb.variant_id = v.id
where p.deleted_at is null
  and p.is_active;

comment on view public.pos_catalog is
  'One row per sellable variant per warehouse, with pricing already resolved. '
  'Read-only; security_invoker so the underlying RLS policies still apply.';

-- Barcode lookup needs no new index: `product_barcodes` already carries a
-- unique constraint on (organization_id, code), and a unique constraint is an
-- index. The POS resolves a scan by querying that table for the variant id
-- and then reading pos_catalog, so both steps are index-backed.

-- The sale list is always "this branch, newest first, one page". Without this
-- index the sales screen sorts the whole table on every navigation.
create index if not exists sales_branch_recent_idx
  on public.sales(branch_id, created_at desc, id desc)
  where status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED');

-- Held sales are polled for the sidebar badge; they are few and short-lived.
create index if not exists sales_held_idx
  on public.sales(organization_id, created_at desc)
  where status = 'HELD';
