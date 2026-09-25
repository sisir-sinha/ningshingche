-- 044 — A queued sale can be sent twice; it can only be sold once.
--
-- The till has to keep selling when the connection drops (docs/10 Phase 8).
-- That means sales are queued on the device and sent when the network comes
-- back — and it means the device cannot know whether an attempt landed before
-- the connection died. So the server remembers, and the reference it remembers
-- by is generated on the device *before* the first attempt.
--
-- `client_ref` is that reference: unique per shop, nullable (a sale taken from
-- a device that never went offline has none), and the second half of the
-- guarantee. A repeat of the same reference returns the receipt the first
-- attempt produced — same invoice number, same totals, no second sale, no
-- second stock movement. The unique index is the backstop for the one race the
-- pre-check cannot close: two attempts in flight at the same instant. The
-- loser gets `unique_violation`, and the queue's retry then finds the sale and
-- returns it, so the outcome is still one sale — never two, and never a
-- negative balance.
--
-- §44's rule holds throughout: this is a client telling the server "I already
-- sent this", and the server deciding. Nothing about prices, stock or totals
-- moves to the client.

-- ── The reference ─────────────────────────────────────────────────────────
alter table public.sales add column if not exists client_ref text;

comment on column public.sales.client_ref is
  'The device-generated identity of an offline sale (044). Unique per organization; NULL for sales taken online.';

-- Partial, so the thousands of online sales with no reference do not collide on
-- NULL, and so the index stays small — it only ever holds the queued ones.
create unique index if not exists sales_client_ref_key
  on public.sales (organization_id, client_ref)
  where client_ref is not null;

-- ── One receipt shape ─────────────────────────────────────────────────────
-- `complete_sale` computes its totals in variables, and a replayed sale has
-- only the stored row. Building the payload in one place means a replayed
-- receipt cannot drift from a fresh one — the property the offline queue
-- depends on, since the shop compares the two.
create or replace function app.sale_receipt(p_sale_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'sale_id',    s.id,
    'invoice_no', s.invoice_no,
    'status',     s.status,
    'subtotal',   s.subtotal,
    'discount',   s.discount_total,
    'tax',        s.tax_total,
    'total',      s.total,
    'paid',       s.paid_total,
    'change_due', s.change_due
  )
    from public.sales s
   where s.id = p_sale_id;
$fn$;

-- Private: it returns any sale in any shop by id, so it is not client API.
revoke execute on function app.sale_receipt(uuid) from public, anon, authenticated;

-- ── The old signature goes first ──────────────────────────────────────────
-- Adding a defaulted parameter with `create or replace` leaves the old
-- signature in place, and a call that omits the new argument then matches both
-- (42725 "is not unique") — the failure migration 021 hit. Dropping takes the
-- grants with it, which is why they are restated below.
drop function if exists public.complete_sale(
  uuid, jsonb, jsonb, uuid, uuid, uuid, text, numeric, text, uuid
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
  p_held_sale_id   uuid     default null,
  -- The offline queue's identity for this sale, generated on the device before
  -- the first attempt (044). Re-sending the same reference returns the sale
  -- that was already written instead of writing a second one, which is what
  -- makes a replay safe after a reply is lost: the till that queued the sale
  -- cannot know whether its call reached the server before the connection
  -- dropped, so the server has to be the one that remembers.
  p_client_ref     text     default null
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
  v_existing       uuid;
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

  -- ── Replay ──────────────────────────────────────────────────────────────
  -- A queued sale is sent again whenever the device cannot tell whether the
  -- first attempt landed. This is the answer to that: the reference is unique
  -- per shop, so a repeat returns the receipt the first attempt produced —
  -- same invoice number, same totals, no second sale, no second stock
  -- movement. Placed after the permission check so the reference cannot be
  -- used as a lookup oracle by somebody who may not sell.
  if p_client_ref is not null then
    select s.id into v_existing
      from public.sales s
     where s.organization_id = v_org
       and s.client_ref = p_client_ref;

    if found then
      return app.sale_receipt(v_existing);
    end if;
  end if;

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
    customer_id, status, currency, note, created_by, client_ref
  ) values (
    v_sale_id, v_org, p_branch_id, p_register_id, v_session, v_invoice_no,
    p_customer_id, 'DRAFT', v_currency, p_note, auth.uid(), p_client_ref
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

  -- The same shape the replay branch returns, from one place, so a replayed
  -- receipt and a fresh one cannot drift apart.
  return app.sale_receipt(v_sale_id);
end;
$fn$;

-- Restated, not inherited: `drop function` deleted the old grant, and a client
-- that cannot execute `complete_sale` cannot sell anything.
revoke execute on function public.complete_sale(
  uuid, jsonb, jsonb, uuid, uuid, uuid, text, numeric, text, uuid, text
) from public, anon;
grant execute on function public.complete_sale(
  uuid, jsonb, jsonb, uuid, uuid, uuid, text, numeric, text, uuid, text
) to authenticated;

-- ── Assert what the queue depends on ──────────────────────────────────────
-- The behavioural proof needs a shop with stock to sell, which the seeds
-- provide and a migration does not have; the validator completes the same sale
-- twice and compares the receipts. What is checked here is that the mechanism
-- is deployed and not merely described: the column, the index, and the two
-- halves of the idempotent path inside the function that will run.
do $verify$
declare
  v_body text;
  v_index boolean;
  v_column boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'sales' and column_name = 'client_ref'
  ) into v_column;

  if v_column is not true then
    raise exception 'offline_replay_unprepared: sales.client_ref is missing' using errcode = 'P0001';
  end if;

  select exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'sales_client_ref_key'
  ) into v_index;

  if v_index is not true then
    raise exception 'offline_replay_unguarded: the unique index on client_ref is missing, so two in-flight attempts could both write'
      using errcode = 'P0001';
  end if;

  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_sale';

  if position('p_client_ref' in v_body) = 0 then
    raise exception 'offline_replay_unwired: complete_sale does not accept a client reference'
      using errcode = 'P0001';
  end if;

  if position('app.sale_receipt' in v_body) = 0 then
    raise exception 'offline_replay_unsplit: complete_sale does not return the shared receipt shape'
      using errcode = 'P0001';
  end if;

  -- The reference must not be a lookup oracle: the early return has to come
  -- after the permission check. Compared by the lookup's own line rather than
  -- by `p_client_ref`, which also appears in the signature above it.
  if position('select s.id into v_existing' in v_body) < position('require_permission' in v_body) then
    raise exception 'offline_replay_leaky: the replay branch runs before the permission check'
      using errcode = 'P0001';
  end if;
end
$verify$;
