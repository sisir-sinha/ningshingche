-- 053 — deleting a product for real.
--
-- Until now `products.archive()` was the only way out: it set `deleted_at`
-- and every list filtered the row away. That is the right default for a shop
-- with history — a sale that references a deleted product would be a report
-- that cannot be reconstructed — but it is the wrong answer for the case that
-- actually happens all day during setup: a typo, a duplicate, a test product.
-- The owner deletes it, it vanishes from the screen, and it is still sitting
-- in the table forever. There is no trash view in Mekholi, so an archived row
-- is unreachable *and* undeletable.
--
-- So: a real DELETE, with the one guard that matters.
--
--   * A product that appears on a **sale**, a **return** or a **purchase** is
--     refused, with a message naming the count. Those rows are the shop's
--     books; losing the product they point at would corrupt every report that
--     joins them. Archive remains the answer for that product, and the client
--     offers it in the same breath.
--
--   * Anything else goes, along with the rows that only exist to describe it:
--     stock balances, the stock ledger, transfer lines. Variants, barcodes and
--     images already cascade from `products` (005, 041).
--
-- Why a function rather than `.delete()` from the client:
--
--   * `stock_movements.product_id` and `stock_transfer_items.product_id` have
--     no `on delete cascade` (006), and RLS makes both tables SELECT-only for
--     clients — they are written by RPC. A browser therefore *cannot* clear
--     them, and the plain delete fails with a foreign-key violation on any
--     product that was ever stocked. That is the bug this function exists to
--     fix, not a theoretical one.
--
--   * The permission check belongs next to the delete. `products.delete` is
--     deliberately not in the default staff role (017), so a cashier who finds
--     the button still cannot use it.

create or replace function public.delete_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org        uuid;
  v_name       text;
  v_sales      bigint;
  v_returns    bigint;
  v_purchases  bigint;
begin
  select organization_id, name
    into v_org, v_name
    from public.products
   where id = p_product_id;

  if v_org is null then
    -- Already gone. Deleting twice is not an error worth surfacing: the
    -- caller wanted the row absent, and it is.
    return;
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('products.delete');

  select count(*) into v_sales
    from public.sale_items
   where product_id = p_product_id;

  select count(*) into v_returns
    from public.sale_return_items sri
    join public.sale_items si on si.id = sri.sale_item_id
   where si.product_id = p_product_id;

  select count(*) into v_purchases
    from public.purchase_items
   where product_id = p_product_id;

  if v_sales > 0 or v_returns > 0 or v_purchases > 0 then
    raise exception using
      errcode = 'restrict_violation',
      message = format(
        '%s is on %s sale line(s), %s return line(s) and %s purchase line(s).',
        v_name, v_sales, v_returns, v_purchases
      ),
      hint = 'Archive it instead — deleting it would break past reports.';
  end if;

  -- Description, not history: these rows say what the stock *is*, and there
  -- is no stock once the product is gone.
  delete from public.stock_transfer_items where product_id = p_product_id;
  delete from public.stock_movements       where product_id = p_product_id;
  delete from public.stock_balances        where product_id = p_product_id;

  -- Variants, barcodes, option values and images cascade from here.
  delete from public.products where id = p_product_id;
end
$fn$;

comment on function public.delete_product(uuid) is
  'Hard-deletes a product and the rows that merely describe it (stock '
  'balances, ledger, transfer lines). Refuses when a sale, return or '
  'purchase references it — archive those instead. Requires products.delete.';

-- Signed-in callers only. The function is SECURITY DEFINER, so leaving the
-- default PUBLIC grant in place would hand an anonymous visitor the owner's
-- delete rights.
revoke execute on function public.delete_product(uuid) from public, anon;
grant  execute on function public.delete_product(uuid) to authenticated;
