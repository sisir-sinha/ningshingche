-- 021 — Correct sale totals for tax-inclusive pricing; close the hold loop.
--
-- Two defects, both found by writing the client-side cart arithmetic in
-- src/shared/domain/cart.ts and checking it against the database.
--
-- 1. TAX-INCLUSIVE PRODUCTS WERE OVERCHARGED.
--    complete_sale computed v_line_total correctly for an inclusive line
--    (v_taxable, tax already inside) and then never used it, summing
--    `v_subtotal - v_discount_total + v_tax_total` instead. v_subtotal
--    already contains the VAT for an inclusive product, so the VAT was added
--    a second time. Proven against live Postgres: a ৳115 VAT-inclusive soap
--    with a 15% rate charged ৳130. Every shop using inclusive pricing —
--    the normal case for Bangladeshi retail — was overcharging by the tax.
--
--    Fixed by summing v_line_total into v_line_sum and using that. For an
--    all-tax-exclusive cart the old and new expressions are identical, so
--    existing behaviour is preserved where it was already correct.
--
-- 2. A RESUMED SALE COULD NEVER BE COMPLETED.
--    resume_sale flipped HELD → DRAFT, but complete_sale always inserts a
--    new row, so the DRAFT was orphaned and the hold list kept showing a
--    cart that had already been served. resume_sale now returns the stored
--    lines so the client can rebuild the cart, and leaves the row HELD;
--    complete_sale takes p_held_sale_id and cancels it atomically.
--
--    hold_sale also now persists per-line discounts, which it previously
--    discarded — resuming a discounted cart silently lost the discount.

-- The old 9-parameter signature must be dropped explicitly. `create or
-- replace` only replaces a function whose signature matches exactly, so
-- adding p_held_sale_id would otherwise leave two overloads behind — and
-- every existing 9-argument call would then fail with
-- "function public.complete_sale(...) is not unique" (SQLSTATE 42725).
-- The migration validator caught this; a call site that had not been
-- exercised yet would have found it in production instead.
drop function if exists public.complete_sale(
  uuid, jsonb, jsonb, uuid, uuid, uuid, text, numeric, text
);

create or replace function public.complete_sale(
  p_branch_id      uuid,
  p_items          jsonb,
  p_payments       jsonb,
  p_register_id    uuid     default null,
  p_customer_id    uuid     default null,
  p_warehouse_id   uuid     default null,
  p_discount_type  text     default null,
  p_discount_value numeric  default null,
  p_note           text     default null,
  -- The HELD row this cart was resumed from, if any. Cancelled in the same
  -- transaction so a crash cannot leave a stale hold on the sidebar.
  p_held_sale_id   uuid     default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org            uuid;
  v_warehouse      uuid;
  v_session        uuid;
  v_currency       char(3);
  v_sale_id        uuid := gen_random_uuid();
  v_invoice_no     text;
  v_seq            bigint;
  v_item           jsonb;
  v_variant        uuid;
  v_product        uuid;
  v_qty            numeric(14,3);
  v_unit_price     numeric(14,2);
  v_unit_cost      numeric(14,4);
  v_balance        numeric(14,3);
  v_allow_negative boolean;
  v_track_stock    boolean;
  v_tax_rate       numeric(6,4);
  v_tax_inclusive  boolean;
  v_disc_type      text;
  v_disc_value     numeric(14,4);
  v_line_disc      numeric(14,2);
  v_taxable        numeric(14,2);
  v_tax            numeric(14,2);
  v_line_total     numeric(14,2);
  v_subtotal       numeric(14,2) := 0;
  v_tax_total      numeric(14,2) := 0;
  v_discount_total numeric(14,2) := 0;
  v_line_sum       numeric(14,2) := 0;
  v_order_disc     numeric(14,2) := 0;
  v_held_org       uuid;
  v_cogs           numeric(14,2) := 0;
  v_total          numeric(14,2);
  v_paid           numeric(14,2) := 0;
  v_change         numeric(14,2) := 0;
  v_status         public.sale_status;
  v_pay            jsonb;
  v_cash_amount    numeric(14,2) := 0;
  v_name           text;
  v_suffix         text;
  v_sku            text;
  v_unit_label     text;
begin
  -- ── Authorization ───────────────────────────────────────────────────────
  select organization_id into v_org from public.branches
   where id = p_branch_id and deleted_at is null;
  if v_org is null then
    raise exception 'branch_not_found: %', p_branch_id using errcode = 'P0002';
  end if;
  perform app.require_org(v_org);
  perform app.require_permission('sales.create');

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  select currency into v_currency from public.organizations where id = v_org;

  -- Default to the branch's retail floor, else its first warehouse.
  v_warehouse := coalesce(
    p_warehouse_id,
    (select id from public.warehouses
      where organization_id = v_org and branch_id = p_branch_id
        and is_retail_floor and deleted_at is null
      order by created_at limit 1),
    (select id from public.warehouses
      where organization_id = v_org and branch_id = p_branch_id
        and deleted_at is null
      order by created_at limit 1)
  );
  if v_warehouse is null then
    raise exception 'no_warehouse_for_branch: %', p_branch_id using errcode = 'P0002';
  end if;

  -- The register session the sale belongs to, if one is open.
  select rs.id into v_session
    from public.register_sessions rs
   where rs.register_id = p_register_id and rs.closed_at is null
   limit 1;

  -- ── Invoice number and sale shell ───────────────────────────────────────
  -- Created before the line items, because sale_items and sale_payments carry
  -- a foreign key to it. Totals start at zero and are finalised below.
  v_seq := public.next_sequence(v_org, 'invoice:' || to_char(now(), 'YYYY'));
  v_invoice_no := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 6, '0');

  insert into public.sales (
    id, organization_id, branch_id, register_id, session_id, invoice_no,
    customer_id, status, currency, note, created_by
  ) values (
    v_sale_id, v_org, p_branch_id, p_register_id, v_session, v_invoice_no,
    p_customer_id, 'DRAFT', v_currency, p_note, auth.uid()
  );

  -- ── Line items ──────────────────────────────────────────────────────────
  -- Balance rows must exist before FOR UPDATE has anything to lock.
  insert into public.stock_balances
        (organization_id, warehouse_id, variant_id, product_id)
  select v_org, v_warehouse, v.id, v.product_id
    from jsonb_array_elements(p_items) as i
    join public.product_variants v on v.id = (i ->> 'variant_id')::uuid
  on conflict (warehouse_id, variant_id) do nothing;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant := (v_item ->> 'variant_id')::uuid;
    v_qty     := (v_item ->> 'qty')::numeric(14,3);

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity: %', v_item::text using errcode = '22023';
    end if;

    select p.id, p.name, p.sku, p.track_stock, p.allow_negative, p.tax_inclusive,
           coalesce(v.price_override, p.selling_price),
           coalesce(v.cost_override, p.cost_price),
           coalesce(t.rate, 0),
           u.symbol
      into v_product, v_name, v_sku, v_track_stock, v_allow_negative,
           v_tax_inclusive, v_unit_price, v_unit_cost, v_tax_rate, v_unit_label
      from public.product_variants v
      join public.products p on p.id = v.product_id
      left join public.taxes t on t.id = p.tax_id and t.is_active
      left join public.product_units u on u.id = p.unit_id
     where v.id = v_variant and v.deleted_at is null;

    if v_product is null then
      raise exception 'variant_not_found: %', v_variant using errcode = 'P0002';
    end if;

    select name_suffix into v_suffix
      from public.product_variants where id = v_variant;

    -- Lock the balance row. This is what makes concurrent sales safe.
    select quantity into v_balance
      from public.stock_balances
     where warehouse_id = v_warehouse and variant_id = v_variant
     for update;

    if v_track_stock and not v_allow_negative and v_balance < v_qty then
      raise exception 'insufficient_stock: % has %, needs %',
        v_name, v_balance, v_qty
        using errcode = 'P0003';
    end if;

    -- Per-line discount.
    v_disc_type  := v_item ->> 'discount_type';
    v_disc_value := coalesce((v_item ->> 'discount_value')::numeric(14,4), 0);
    v_line_disc := case
      when v_disc_type = 'PERCENT'
        then round(v_qty * v_unit_price * v_disc_value / 100.0, 2)
      when v_disc_type = 'FLAT'
        then least(round(v_disc_value, 2), v_qty * v_unit_price)
      else 0
    end;

    v_taxable := v_qty * v_unit_price - v_line_disc;

    if v_tax_inclusive then
      v_tax        := round(v_taxable * v_tax_rate / (100 + v_tax_rate), 2);
      v_line_total := v_taxable;
    else
      v_tax        := round(v_taxable * v_tax_rate / 100.0, 2);
      v_line_total := v_taxable + v_tax;
    end if;

    insert into public.sale_items (
      sale_id, organization_id, variant_id, product_id, product_name,
      variant_name, sku, unit_label, quantity, unit_price, unit_cost,
      discount_type, discount_value, discount_total, tax_rate, tax_total,
      line_total, line_cogs
    ) values (
      v_sale_id, v_org, v_variant, v_product, v_name,
      v_suffix, v_sku, v_unit_label, v_qty, v_unit_price, v_unit_cost,
      v_disc_type, nullif(v_disc_value, 0), v_line_disc, v_tax_rate, v_tax,
      v_line_total, round(v_qty * v_unit_cost, 2)
    );

    -- Ledger + balance, in the same transaction, under the same lock.
    if v_track_stock then
      insert into public.stock_movements (
        organization_id, warehouse_id, variant_id, product_id, type,
        quantity, direction, before_quantity, after_quantity, unit_cost,
        reference_type, reference_id, user_id
      ) values (
        v_org, v_warehouse, v_variant, v_product, 'SALE',
        v_qty, -1, v_balance, v_balance - v_qty, v_unit_cost,
        'sale', v_sale_id, auth.uid()
      );

      update public.stock_balances
         set quantity = quantity - v_qty
       where warehouse_id = v_warehouse and variant_id = v_variant;
    end if;

    v_subtotal       := v_subtotal + (v_qty * v_unit_price);
    v_discount_total := v_discount_total + v_line_disc;
    v_tax_total      := v_tax_total + v_tax;
    v_cogs           := v_cogs + round(v_qty * v_unit_cost, 2);
    v_line_sum       := v_line_sum + v_line_total;
  end loop;

  -- ── Order-level discount ────────────────────────────────────────────────
  --
  -- The total is the sum of the per-line totals, NOT
  -- `subtotal - discount + tax`. For a tax-INCLUSIVE line the selling price
  -- already contains the VAT, so adding v_tax_total on top charged the
  -- customer twice: a ৳115 VAT-inclusive soap was being sold for ৳130.
  -- Summing v_line_total handles both tax conventions with one formula, and
  -- for an all-exclusive cart the two expressions are algebraically
  -- identical, so shops that do not use inclusive pricing see no change.
  if p_discount_type = 'PERCENT' and coalesce(p_discount_value, 0) > 0 then
    v_order_disc := round((v_subtotal - v_discount_total) * p_discount_value / 100.0, 2);
  elsif p_discount_type = 'FLAT' and coalesce(p_discount_value, 0) > 0 then
    v_order_disc := least(round(p_discount_value, 2), v_subtotal - v_discount_total);
  end if;

  v_discount_total := v_discount_total + v_order_disc;
  v_total := v_line_sum - v_order_disc;
  if v_total < 0 then
    raise exception 'negative_total' using errcode = '22023';
  end if;

  -- ── Payments ────────────────────────────────────────────────────────────
  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    insert into public.sale_payments
          (sale_id, organization_id, method_id, amount, reference, received_by)
    values (v_sale_id, v_org,
            (v_pay ->> 'method_id')::uuid,
            (v_pay ->> 'amount')::numeric(14,2),
            v_pay ->> 'reference',
            auth.uid());

    v_paid := v_paid + (v_pay ->> 'amount')::numeric(14,2);

    if exists (select 1 from public.payment_methods
                where id = (v_pay ->> 'method_id')::uuid and is_cash) then
      v_cash_amount := v_cash_amount + (v_pay ->> 'amount')::numeric(14,2);
    end if;
  end loop;

  if v_paid < v_total then
    v_status := 'PARTIALLY_PAID';
  else
    v_status := 'COMPLETED';
    v_change := v_paid - v_total;
  end if;

  -- ── Finalise the sale ───────────────────────────────────────────────────
  -- The row was created up front (see above) so that sale_items and
  -- sale_payments had a parent to reference. Totals are only known now.
  update public.sales
     set status         = v_status,
         subtotal       = v_subtotal,
         discount_total = v_discount_total,
         discount_type  = p_discount_type,
         discount_value = p_discount_value,
         tax_total      = v_tax_total,
         total          = v_total,
         paid_total     = v_paid,
         change_due     = v_change,
         cogs           = v_cogs,
         completed_at   = case when v_status = 'COMPLETED' then now() end
   where id = v_sale_id;

  -- ── Close out the held cart this sale came from ─────────────────────────
  -- Held rows are cart bookmarks, not financial documents. Cancelling inside
  -- the same transaction means a crash can neither leave a stale hold on the
  -- sidebar nor cancel a hold whose sale never landed.
  if p_held_sale_id is not null then
    select organization_id into v_held_org
      from public.sales where id = p_held_sale_id;
    if v_held_org is distinct from v_org then
      raise exception 'held_sale_not_found: %', p_held_sale_id using errcode = 'P0002';
    end if;
    update public.sales
       set status = 'CANCELLED'
     where id = p_held_sale_id and status in ('HELD', 'DRAFT');
  end if;

  -- ── Register cash ───────────────────────────────────────────────────────
  if v_session is not null then
    update public.register_sessions
       set sales_cash = sales_cash + v_cash_amount
     where id = v_session;
  end if;

  -- ── Outbox: the authoritative event chain (docs/02 §3) ──────────────────
  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'sale.completed', 'sale', v_sale_id, jsonb_build_object(
    'sale_id',    v_sale_id,
    'invoice_no', v_invoice_no,
    'branch_id',  p_branch_id,
    'total',      v_total,
    'paid',       v_paid,
    'cogs',       v_cogs,
    'customer_id', p_customer_id
  ));

  return jsonb_build_object(
    'sale_id',    v_sale_id,
    'invoice_no', v_invoice_no,
    'status',     v_status,
    'subtotal',   v_subtotal,
    'discount',   v_discount_total,
    'tax',        v_tax_total,
    'total',      v_total,
    'paid',       v_paid,
    'change_due', v_change
  );
end;
$fn$;

-- Held sales are rows, not a second source of truth (docs/09 #11).

-- ── Hold / resume ─────────────────────────────────────────────────────────
-- A held sale is a cart bookmark, not a financial document: reports count
-- only COMPLETED, PARTIALLY_PAID and PARTIALLY_REFUNDED, so these rows are
-- invisible to the numbers either way.

create or replace function public.hold_sale(
  p_branch_id   uuid,
  p_items       jsonb,
  p_customer_id uuid default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid;
  v_id       uuid := gen_random_uuid();
  v_seq      bigint;
  v_total    numeric(14,2) := 0;
  v_item     jsonb;
  v_price    numeric(14,2);
  v_qty      numeric(14,3);
  v_variant  uuid;
  v_product  uuid;
  v_name     text;
  v_d_type   text;
  v_d_value  numeric(14,4);
  v_d_total  numeric(14,2);
begin
  select organization_id into v_org from public.branches where id = p_branch_id;
  perform app.require_org(v_org);
  perform app.require_permission('sales.hold');

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  v_seq := public.next_sequence(v_org, 'held');

  insert into public.sales (
    id, organization_id, branch_id, invoice_no, customer_id, status,
    currency, total, note, created_by
  )
  select v_id, v_org, p_branch_id,
         'HELD-' || lpad(v_seq::text, 6, '0'),
         p_customer_id, 'HELD',
         o.currency, 0, p_note, auth.uid()
    from public.organizations o where o.id = v_org;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant := (v_item ->> 'variant_id')::uuid;
    v_qty     := (v_item ->> 'qty')::numeric(14,3);
    v_d_type  := v_item ->> 'discount_type';
    v_d_value := coalesce((v_item ->> 'discount_value')::numeric(14,4), 0);

    select p.id, p.name, coalesce(v.price_override, p.selling_price)
      into v_product, v_name, v_price
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.id = v_variant;

    -- Same discount maths as complete_sale, so the held cart shows the
    -- figure the cashier will actually be asked to pay on resume.
    v_d_total := case
      when v_d_type = 'PERCENT'
        then round(v_qty * v_price * v_d_value / 100.0, 2)
      when v_d_type = 'FLAT'
        then least(round(v_d_value, 2), v_qty * v_price)
      else 0
    end;

    insert into public.sale_items (
      sale_id, organization_id, variant_id, product_id, product_name,
      quantity, unit_price, discount_type, discount_value, discount_total,
      line_total
    ) values (
      v_id, v_org, v_variant, v_product, v_name,
      v_qty, v_price, v_d_type, nullif(v_d_value, 0), v_d_total,
      v_qty * v_price - v_d_total
    );

    v_total := v_total + (v_qty * v_price);
  end loop;

  update public.sales set total = v_total, subtotal = v_total where id = v_id;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'sale.held', 'sale', v_id,
          jsonb_build_object('sale_id', v_id, 'total', v_total));

  return v_id;
end;
$fn$;

create or replace function public.resume_sale(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org    uuid;
  v_status public.sale_status;
  v_row    public.sales;
begin
  select organization_id, status into v_org, v_status
    from public.sales where id = p_sale_id;

  if v_org is null then
    raise exception 'sale_not_found: %', p_sale_id using errcode = 'P0001';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('sales.resume');

  if v_status <> 'HELD' then
    raise exception 'sale_not_held: status is %', v_status using errcode = '22023';
  end if;

  select * into v_row from public.sales where id = p_sale_id;

  -- Deliberately NOT flipping the row to DRAFT. The caller rebuilds its cart
  -- from the returned lines and then calls complete_sale(p_held_sale_id =>
  -- p_sale_id), which cancels this row in the same transaction as the sale.
  -- Leaving it HELD means a cashier who resumes and then walks away has not
  -- destroyed the only copy of that cart.
  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'sale.resumed', 'sale', p_sale_id,
          jsonb_build_object('sale_id', p_sale_id));

  return jsonb_build_object(
    'sale_id',     p_sale_id,
    'customer_id', v_row.customer_id,
    'note',        v_row.note,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'variant_id',     i.variant_id,
               'qty',            i.quantity,
               'discount_type',  i.discount_type,
               'discount_value', i.discount_value))
        from public.sale_items i
       where i.sale_id = p_sale_id
    ), '[]'::jsonb)
  );
end;
$fn$;

-- ── Grants ────────────────────────────────────────────────────────────────
-- Dropping the old signature dropped its grant with it, so the new one has to
-- be granted again or every authenticated call fails with 42501. EXECUTE here
-- is reachability, not authorization: each function still calls
-- app.require_permission() itself.

revoke execute on function public.complete_sale(
  uuid, jsonb, jsonb, uuid, uuid, uuid, text, numeric, text, uuid
) from anon, public;

grant execute on function public.complete_sale(
  uuid, jsonb, jsonb, uuid, uuid, uuid, text, numeric, text, uuid
) to authenticated;

-- hold_sale and resume_sale kept their signatures, so their grants from
-- migration 018 survive the `create or replace`. Re-asserting them anyway so
-- this file is self-contained if the migration order is ever replayed.
grant execute on function public.hold_sale(uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.resume_sale(uuid) to authenticated;
