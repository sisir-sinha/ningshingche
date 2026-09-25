-- 025 — Business management: purchase orders, supplier payments, store credit,
-- register reporting, and a real audit trail.
--
-- Phase 3 gave inventory its operations. This migration gives the rest of the
-- business its paperwork, and closes a gap that had been open since 011: the
-- `audit_logs` table existed, had a read policy gated on `audit.view`, and was
-- written by exactly one caller — provisioning. Every other action a
-- shopkeeper takes left no trace, so "who changed this price?" had no answer.
--
-- What already existed and is deliberately not duplicated here:
--   * `receive_purchase` (013) — full and partial receipt, supplier balance,
--     PURCHASE ledger rows, status transitions.
--   * `refund_sale` (013) — item-level refunds, RETURN_IN restock rows
--     referencing the original sale item, over-refund refused by the database.
--   * `record_expense` (014) — expense row plus the register's cash effect.
-- What was missing: creating the purchase order in the first place, paying a
-- supplier, refunding to store credit, reporting a register session, and
-- auditing any of it.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. The audit trail
-- ══════════════════════════════════════════════════════════════════════════
--
-- One generic trigger function, attached to the tables a shopkeeper can be
-- surprised by — prices, master data, commitments, permissions. Deliberately
-- NOT attached to the operational tables:
--
--   * `sales`, `sale_items`, `purchase_items` already have their own immutable
--     records and dedicated history screens; auditing them again would double
--     the write cost of every sale for information the shop can already see.
--   * `stock_movements` IS the audit trail for stock, by construction.
--
-- So the rule is: the ledger tables explain *transactions*; this explains
-- *configuration and commitments*. The acceptance criterion for the phase —
-- "every audited action shows actor, before and after" — is met by the
-- `audit_trail` view below, which joins the actor's email.

create or replace function app.record_audit()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $fn$
declare
  v_new      jsonb;
  v_old      jsonb;
  v_org      uuid;
  v_entity   uuid;
  v_action   text;
  v_entity_t text := tg_table_name;
  v_actor    uuid := auth.uid();
begin
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;

  -- A no-op update is not an audited event. `updated_at` is excluded because
  -- the BEFORE trigger has already touched it, so every save would otherwise
  -- look like a change.
  if tg_op = 'UPDATE' and (v_new - 'updated_at') = (v_old - 'updated_at') then
    return null;
  end if;

  -- Every audited table carries organization_id; a row without one cannot be
  -- attributed to a shop, and writing it would corrupt the tenancy scope the
  -- view is filtered by.
  v_org := coalesce(v_new ->> 'organization_id', v_old ->> 'organization_id')::uuid;
  if v_org is null then
    return null;
  end if;

  v_entity := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  v_action := case tg_op
    when 'INSERT' then 'create'
    when 'UPDATE' then 'update'
    else 'delete'
  end;

  insert into public.audit_logs
        (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (v_org, v_actor, v_action, v_entity_t, v_entity, v_old, v_new);

  return null;
end
$fn$;

-- Attached in a loop so the list reads as one decision rather than thirteen.
do $$
declare
  v_table text;
  v_tables text[] := array[
    'products',            -- price, cost, reorder point, active flag
    'product_variants',
    'categories',
    'brands',
    'units',
    'taxes',
    'customers',
    'suppliers',
    'purchases',           -- ordering a supplier is a commitment
    'expenses',
    'expense_categories',
    'payment_methods',
    'warehouses',
    'branches',
    'roles',
    'role_permissions',
    'user_roles',
    'settings'
  ];
begin
  foreach v_table in array v_tables loop
    -- Skip anything this deployment does not have, so the migration stays
    -- runnable against a partial schema rather than failing on a missing table.
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = v_table) then
      execute format('drop trigger if exists audit_%s on public.%I', v_table, v_table);
      execute format(
        'create trigger audit_%s after insert or update or delete on public.%I
           for each row execute function app.record_audit()',
        v_table, v_table
      );
    end if;
  end loop;
end
$$;

/**
 * The audit trail as a screen reads it: actor, when, what, and the before and
 * after images side by side.
 *
 * `security_invoker=on` so every caller goes through `audit_logs_select` — the
 * permission check and the organization scope are the table's, not the view's,
 * which is what stops this from being a hole in the tenancy wall.
 */
create or replace view public.audit_trail as
  select a.id,
         a.organization_id,
         a.created_at,
         a.action,
         a.entity_type,
         a.entity_id,
         a.actor_id,
         u.email          as actor_email,
         a.before,
         a.after,
         a.metadata
    from public.audit_logs a
    left join auth.users u on u.id = a.actor_id;

alter view public.audit_trail set (security_invoker = on);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Purchase orders
-- ══════════════════════════════════════════════════════════════════════════
--
-- `receive_purchase` could already receive an order; nothing could create one,
-- so `purchases` could only be filled by hand. This is the missing verb.
--
-- Two states are settable here: DRAFT (being written) and ORDERED (sent to the
-- supplier). Receipt moves it on from there. Creating an order is the moment
-- the shop owes money, so that is when the supplier's balance moves — not at
-- receipt, which changes where the goods are, not what they cost.
create or replace function public.save_purchase(
  p_warehouse_id uuid,
  p_items        jsonb,               -- [{variant_id, qty, unit_cost, tax_rate?}]
  p_supplier_id  uuid      default null,
  p_purchase_id  uuid      default null,   -- null creates, set to edit
  p_status       text      default 'ORDERED',
  p_reference_no text      default null,   -- the supplier's own invoice number
  p_note         text      default null,
  p_expected_at  date      default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid;
  v_branch   uuid;
  v_id       uuid := coalesce(p_purchase_id, gen_random_uuid());
  v_status   public.purchase_status;
  v_existing public.purchases;
  v_prev_status public.purchase_status;
  v_seq      bigint;
  v_no       text;
  v_item     jsonb;
  v_variant  uuid;
  v_product  uuid;
  v_name     text;
  v_qty      numeric(14,3);
  v_cost     numeric(14,4);
  v_rate     numeric(6,4);
  v_line     numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_tax      numeric(14,2) := 0;
  v_total    numeric(14,2) := 0;
  v_old_total numeric(14,2) := 0;
begin
  select organization_id, branch_id into v_org, v_branch
    from public.warehouses where id = p_warehouse_id and deleted_at is null;
  if v_org is null then
    raise exception 'warehouse_not_found: %', p_warehouse_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('purchases.create');

  v_status := upper(coalesce(p_status, 'ORDERED'))::public.purchase_status;
  if v_status not in ('DRAFT', 'ORDERED') then
    raise exception 'purchase_status_not_settable: %', v_status
      using errcode = '22023', hint = 'DRAFT or ORDERED';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  if p_supplier_id is not null then
    if not exists (select 1 from public.suppliers
                    where id = p_supplier_id and organization_id = v_org and deleted_at is null) then
      raise exception 'supplier_not_found: %', p_supplier_id using errcode = 'P0002';
    end if;
  end if;

  if p_purchase_id is not null then
    select * into v_existing from public.purchases where id = p_purchase_id;
    if v_existing.id is null then
      raise exception 'purchase_not_found: %', p_purchase_id using errcode = 'P0002';
    end if;
    if v_existing.organization_id <> v_org then
      raise exception 'purchase_belongs_to_another_organization' using errcode = '42501';
    end if;
    v_prev_status := v_existing.status;
    v_old_total := v_existing.total;

    -- Once goods have arrived the order is a record of what happened, not a
    -- plan. Editing it would desynchronise `received_qty` from what is on the
    -- shelf, and the ledger would no longer explain the balance.
    if exists (select 1 from public.purchase_items
                where purchase_id = p_purchase_id and received_qty > 0) then
      raise exception 'purchase_already_received' using errcode = '22023';
    end if;
    if v_existing.status in ('RECEIVED', 'CANCELLED') then
      raise exception 'purchase_not_editable: %', v_existing.status using errcode = '22023';
    end if;
  end if;

  -- Line arithmetic, summed the same way every other total in this schema is:
  -- round per line, then accumulate, so the printed total matches the lines a
  -- supplier would check by hand.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant := (v_item ->> 'variant_id')::uuid;
    v_qty     := (v_item ->> 'qty')::numeric(14,3);
    v_cost    := coalesce((v_item ->> 'unit_cost')::numeric(14,4), 0);
    v_rate    := coalesce((v_item ->> 'tax_rate')::numeric(6,4), 0);

    if v_variant is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item: %', v_item using errcode = '22023';
    end if;

    select product_id into v_product
      from public.product_variants
     where id = v_variant and organization_id = v_org;
    if v_product is null then
      raise exception 'variant_not_found: %', v_variant using errcode = 'P0002';
    end if;

    v_line := round(v_qty * v_cost, 2);
    v_subtotal := v_subtotal + v_line;
    v_tax := v_tax + round(v_line * v_rate, 2);
  end loop;
  v_total := v_subtotal + v_tax;

  if p_purchase_id is null then
    v_seq := public.next_sequence(v_org, 'purchase:' || to_char(now(), 'YYYY'));
    v_no := 'PO-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 6, '0');

    insert into public.purchases (
      id, organization_id, branch_id, warehouse_id, supplier_id, reference_no,
      invoice_no, status, subtotal, tax_total, total, note, expected_at, created_by
    ) values (
      v_id, v_org, v_branch, p_warehouse_id, p_supplier_id, p_reference_no,
      v_no, v_status, v_subtotal, v_tax, v_total, p_note, p_expected_at, auth.uid()
    );
  else
    update public.purchases
       set supplier_id  = p_supplier_id,
           reference_no = p_reference_no,
           status       = v_status,
           subtotal     = v_subtotal,
           tax_total    = v_tax,
           total        = v_total,
           note         = p_note,
           expected_at  = p_expected_at
     where id = v_id;
    delete from public.purchase_items where purchase_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant := (v_item ->> 'variant_id')::uuid;
    v_qty     := (v_item ->> 'qty')::numeric(14,3);
    v_cost    := coalesce((v_item ->> 'unit_cost')::numeric(14,4), 0);
    v_rate    := coalesce((v_item ->> 'tax_rate')::numeric(6,4), 0);

    select pv.product_id, p.name into v_product, v_name
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
     where pv.id = v_variant;

    insert into public.purchase_items (
      organization_id, purchase_id, variant_id, product_id, product_name,
      quantity, unit_cost, tax_rate, line_total
    ) values (
      v_org, v_id, v_variant, v_product, v_name,
      v_qty, v_cost, v_rate, round(v_qty * v_cost * (1 + v_rate), 2)
    );
  end loop;

  -- The supplier's balance is what the shop owes. It moves when an order is
  -- placed, when an ordered total or supplier changes, and when a payment is
  -- made — never on receipt, which is about goods, not money.
  --
  -- Expressed as "release what was committed, then commit the new figure"
  -- rather than as a delta, because a delta gets the paid portion wrong: money
  -- already transferred is still money owed against the *new* total, and must
  -- not be released when the old total is withdrawn.
  if p_purchase_id is not null
     and v_prev_status = 'ORDERED'
     and v_existing.supplier_id is not null then
    update public.suppliers
       set balance = balance - (v_old_total - v_existing.paid_total)
     where id = v_existing.supplier_id;
  end if;

  if v_status = 'ORDERED' and p_supplier_id is not null then
    update public.suppliers
       set balance = balance + (v_total - coalesce(v_existing.paid_total, 0))
     where id = p_supplier_id;
  end if;

  return v_id;
end
$fn$;

create or replace function public.cancel_purchase(
  p_purchase_id uuid,
  p_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_po   public.purchases;
  v_back numeric(14,2);
begin
  select * into v_po from public.purchases where id = p_purchase_id;
  if v_po.id is null then
    raise exception 'purchase_not_found: %', p_purchase_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_po.organization_id);
  perform app.require_permission('purchases.approve');

  if v_po.status = 'CANCELLED' then
    return jsonb_build_object('purchase_id', p_purchase_id, 'status', 'CANCELLED', 'released', 0);
  end if;
  -- Cancelling after goods arrived would leave stock on the shelf that no
  -- order explains. Returns to supplier are their own operation (§18).
  if exists (select 1 from public.purchase_items
              where purchase_id = p_purchase_id and received_qty > 0) then
    raise exception 'purchase_already_received' using errcode = '22023';
  end if;

  -- Only what is still owed is released: payments already made are a real
  -- transfer of money and stay on the supplier's account as an advance.
  v_back := case when v_po.status = 'ORDERED' then v_po.total - v_po.paid_total else 0 end;

  if v_po.supplier_id is not null and v_back <> 0 then
    update public.suppliers set balance = balance - v_back where id = v_po.supplier_id;
  end if;

  update public.purchases
     set status = 'CANCELLED',
         note   = coalesce(p_reason, note)
   where id = p_purchase_id;

  return jsonb_build_object(
    'purchase_id', p_purchase_id, 'status', 'CANCELLED', 'released', v_back
  );
end
$fn$;

-- ── Paying a supplier ────────────────────────────────────────────────────
--
-- Goods arrive on credit and are paid later, partly, in cash or by transfer.
-- `receive_purchase` accepts a payment at the counter; this is the standing
-- operation for settling up afterwards.
create or replace function public.apply_payment(
  p_supplier_id uuid,
  p_amount      numeric(14,2),
  p_method_id   uuid,
  p_purchase_id uuid default null,
  p_reference   text default null,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid;
  v_supplier public.suppliers;
  v_po       public.purchases;
  v_balance  numeric(14,2);
  v_id       uuid := gen_random_uuid();
begin
  select * into v_supplier from public.suppliers where id = p_supplier_id;
  if v_supplier.id is null then
    raise exception 'supplier_not_found: %', p_supplier_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_supplier.organization_id);
  perform app.require_permission('purchases.create');

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;
  if not exists (select 1 from public.payment_methods
                  where id = p_method_id and organization_id = v_supplier.organization_id) then
    raise exception 'payment_method_not_found: %', p_method_id using errcode = 'P0002';
  end if;

  if p_purchase_id is not null then
    select * into v_po from public.purchases where id = p_purchase_id;
    if v_po.id is null then
      raise exception 'purchase_not_found: %', p_purchase_id using errcode = 'P0002';
    end if;
    if v_po.supplier_id is distinct from p_supplier_id then
      raise exception 'purchase_belongs_to_another_supplier' using errcode = '22023';
    end if;
    if p_amount > (v_po.total - v_po.paid_total) then
      raise exception 'over_payment: outstanding %', (v_po.total - v_po.paid_total)
        using errcode = '22023';
    end if;

    insert into public.purchase_payments
          (id, organization_id, purchase_id, method_id, amount, reference)
    values (v_id, v_supplier.organization_id, p_purchase_id, p_method_id, p_amount,
            coalesce(p_reference, p_note));

    update public.purchases
       set paid_total = paid_total + p_amount
     where id = p_purchase_id;
  else
    -- An unallocated payment sits on the supplier's account and pays down the
    -- balance without naming an order (a monthly settlement, typically).
    -- purchase_payments requires a purchase, so nothing is inserted here; the
    -- balance movement is the record, and it is audited.
    insert into public.outbox
          (organization_id, event_type, aggregate_type, aggregate_id, payload)
    values (v_supplier.organization_id, 'supplier.payment', 'supplier', p_supplier_id,
            jsonb_build_object('amount', p_amount, 'method_id', p_method_id,
                               'reference', coalesce(p_reference, p_note)));
  end if;

  update public.suppliers set balance = balance - p_amount where id = p_supplier_id
  returning balance into v_balance;

  return jsonb_build_object(
    'payment_id', v_id,
    'amount', p_amount,
    'supplier_balance', v_balance,
    'purchase_id', p_purchase_id
  );
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Refund to store credit
-- ══════════════════════════════════════════════════════════════════════════
--
-- The common case at a Bangladeshi counter: the customer has lost the receipt
-- and wants the value kept for them rather than cash back. Wrapping
-- `refund_sale` rather than reimplementing it means the stock movement, the
-- over-refund guard and the return-number sequence all behave identically to a
-- cash refund — there is one refund implementation, not two.
create or replace function public.refund_sale_to_credit(
  p_sale_id  uuid,
  p_items    jsonb,               -- [{sale_item_id, qty}]
  p_reason   text    default null,
  p_restock  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale     public.sales;
  v_result   jsonb;
  v_total    numeric(14,2);
  v_credit   numeric(14,2);
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null then
    raise exception 'sale_not_found: %', p_sale_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_sale.organization_id);
  perform app.require_permission('sales.refund');

  -- Store credit needs somebody to hold it. The alternative — cash back — is
  -- `refund_sale`, and the UI offers it whenever this refuses.
  if v_sale.customer_id is null then
    raise exception 'sale_has_no_customer'
      using errcode = '22023',
            hint = 'Refund to the original payment method, or serve a named customer';
  end if;

  v_result := public.refund_sale(p_sale_id, p_items, '[]'::jsonb, p_reason, p_restock);
  v_total := (v_result ->> 'refund_total')::numeric(14,2);

  update public.customers
     set store_credit = store_credit + v_total
   where id = v_sale.customer_id
  returning store_credit into v_credit;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_sale.organization_id, 'customer.credit', 'customer', v_sale.customer_id,
          jsonb_build_object('sale_id', p_sale_id,
                             'return_id', v_result ->> 'return_id',
                             'amount', v_total, 'store_credit', v_credit));

  return v_result || jsonb_build_object('store_credit', v_credit, 'customer_id', v_sale.customer_id);
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. Register session reporting
-- ══════════════════════════════════════════════════════════════════════════
--
-- `close_register` already computes the expected cash and the variance. What a
-- shopkeeper also needs is the breakdown: what was sold, by which method, and
-- what left the drawer. One call, so the screen cannot show a total that
-- disagrees with its own parts.
create or replace function public.register_session_report(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_session public.register_sessions;
begin
  select * into v_session from public.register_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'session_not_found: %', p_session_id using errcode = 'P0002';
  end if;

  -- Whoever closes the drawer has to reconcile it, so that is the permission
  -- this needs — not the reporting one, which a cashier may not hold.
  perform app.require_org(v_session.organization_id);
  perform app.require_permission('register.close');

  return jsonb_build_object(
    'session_id',    v_session.id,
    'register_id',   v_session.register_id,
    'branch_id',     v_session.branch_id,
    'opened_at',     v_session.opened_at,
    'closed_at',     v_session.closed_at,
    'is_open',       v_session.closed_at is null,
    'opening_cash',  v_session.opening_cash,
    'cash_in',       v_session.cash_in,
    'cash_out',      v_session.cash_out,
    'sales_cash',    v_session.sales_cash,
    'refund_cash',   v_session.refund_cash,
    'expense_cash',  v_session.expense_cash,
    'expected_cash', v_session.opening_cash + v_session.cash_in - v_session.cash_out
                       + v_session.sales_cash - v_session.refund_cash - v_session.expense_cash,
    'closing_cash',  v_session.closing_cash,
    'variance',      v_session.variance,
    'sale_count', coalesce((
      select count(*) from public.sales s
       where s.session_id = p_session_id
         and s.status in ('COMPLETED', 'PARTIALLY_PAID')), 0),
    'sales_total', coalesce((
      select sum(s.total) from public.sales s
       where s.session_id = p_session_id
         and s.status in ('COMPLETED', 'PARTIALLY_PAID')), 0),
    'refund_total', coalesce((
      select sum(r.refund_total)
        from public.sale_returns r
        join public.sales s on s.id = r.sale_id
       where s.session_id = p_session_id), 0),
    'expense_total', coalesce((
      select sum(e.amount) from public.expenses e
       where e.session_id = p_session_id and e.deleted_at is null), 0),
    -- Cash by method, because "where did the money come from" is the question
    -- the drawer count provokes.
    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object(
               'method_id', m.id,
               'method',    m.name,
               'is_cash',   m.is_cash,
               'amount',    agg.total,
               'count',     agg.n)
             order by m.sort_order, m.name)
        from (
          select sp.method_id, sum(sp.amount) as total, count(*) as n
            from public.sale_payments sp
            join public.sales s on s.id = sp.sale_id
           where s.session_id = p_session_id
             and s.status in ('COMPLETED', 'PARTIALLY_PAID')
           group by sp.method_id
        ) agg
        join public.payment_methods m on m.id = agg.method_id), '[]'::jsonb)
  );
end
$fn$;

/**
 * Sessions with their totals, for the register screen's history list.
 *
 * The aggregates live here rather than in three client queries so the list and
 * the closing report are computed from the same definition — a register whose
 * list says ৳12,400 and whose report says ৳12,300 is a drawer that can never be
 * reconciled.
 */
create or replace view public.register_session_summary as
  select rs.id,
         rs.organization_id,
         rs.branch_id,
         rs.register_id,
         r.name  as register_name,
         rs.opened_at,
         rs.closed_at,
         (rs.closed_at is null) as is_open,
         rs.opening_cash,
         rs.closing_cash,
         rs.variance,
         rs.cash_in,
         rs.cash_out,
         rs.sales_cash,
         rs.refund_cash,
         rs.expense_cash,
         coalesce((
           select sum(s.total) from public.sales s
            where s.session_id = rs.id
              and s.status in ('COMPLETED', 'PARTIALLY_PAID')), 0) as sales_total,
         coalesce((
           select count(*) from public.sales s
            where s.session_id = rs.id
              and s.status in ('COMPLETED', 'PARTIALLY_PAID')), 0) as sale_count,
         coalesce((
           select sum(sr.refund_total)
             from public.sale_returns sr
             join public.sales s on s.id = sr.sale_id
            where s.session_id = rs.id), 0) as refund_total,
         coalesce((
           select sum(e.amount) from public.expenses e
            where e.session_id = rs.id and e.deleted_at is null), 0) as expense_total
    from public.register_sessions rs
    left join public.registers r on r.id = rs.register_id;

alter view public.register_session_summary set (security_invoker = on);

-- ══════════════════════════════════════════════════════════════════════════
-- 5. Grants
-- ══════════════════════════════════════════════════════════════════════════
-- Same rule as every migration before this one: the client gets the operation,
-- never a table write that would let it reimplement the arithmetic.
grant execute on function public.save_purchase(uuid, jsonb, uuid, uuid, text, text, text, date) to authenticated;
grant execute on function public.cancel_purchase(uuid, text) to authenticated;
grant execute on function public.apply_payment(uuid, numeric, uuid, uuid, text, text) to authenticated;
grant execute on function public.refund_sale_to_credit(uuid, jsonb, text, boolean) to authenticated;
grant execute on function public.register_session_report(uuid) to authenticated;
