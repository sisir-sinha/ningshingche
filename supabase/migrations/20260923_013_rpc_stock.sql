-- 013 — Stock and purchase RPCs: adjust, transfer, receive, refund.

-- Weighted-average costing (docs/09 #5, decision 2026-09-23):
--   in  → new_avg = (qty*avg + in_qty*in_cost) / (qty + in_qty)
--   out → cost is the current average; the average does not change
create or replace function public.apply_stock_movement(
  p_warehouse_id   uuid,
  p_variant_id     uuid,
  p_type           public.stock_movement_type,
  p_quantity       numeric(14,3),
  p_unit_cost      numeric(14,4) default 0,
  p_reference_type text default null,
  p_reference_id   uuid default null,
  p_note           text default null
)
returns numeric(14,3)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org       uuid;
  v_product   uuid;
  v_dir       smallint;
  v_before    numeric(14,3);
  v_after     numeric(14,3);
  v_avg       numeric(14,4);
  v_track     boolean;
  v_allow_neg boolean;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity_must_be_positive' using errcode = '22023';
  end if;

  select organization_id, product_id into v_org, v_product
    from public.product_variants where id = p_variant_id;
  if v_product is null then
    raise exception 'variant_not_found: %', p_variant_id using errcode = 'P0002';
  end if;

  select track_stock, allow_negative into v_track, v_allow_neg
    from public.products where id = v_product;

  if not v_track then
    return 0;
  end if;

  v_dir := case
    when p_type in ('PURCHASE','RETURN_IN','ADJUSTMENT_IN','TRANSFER_IN',
                    'OPENING_STOCK','COUNT','PRODUCTION_IN') then 1
    else -1
  end;

  insert into public.stock_balances
        (organization_id, warehouse_id, variant_id, product_id)
  values (v_org, p_warehouse_id, p_variant_id, v_product)
  on conflict (warehouse_id, variant_id) do nothing;

  select quantity, avg_unit_cost into v_before, v_avg
    from public.stock_balances
   where warehouse_id = p_warehouse_id and variant_id = p_variant_id
   for update;

  v_after := v_before + (p_quantity * v_dir);

  if v_after < 0 and not v_allow_neg then
    raise exception 'insufficient_stock: has %, needs %', v_before, p_quantity
      using errcode = 'P0003';
  end if;

  -- Weighted average only moves on stock-in.
  if v_dir = 1 then
    if v_after = 0 then
      v_avg := p_unit_cost;
    else
      v_avg := round(
        (v_before * v_avg + p_quantity * p_unit_cost) / v_after, 4
      );
    end if;
  end if;

  insert into public.stock_movements (
    organization_id, warehouse_id, variant_id, product_id, type, quantity,
    direction, before_quantity, after_quantity, unit_cost,
    reference_type, reference_id, user_id, note
  ) values (
    v_org, p_warehouse_id, p_variant_id, v_product, p_type, p_quantity,
    v_dir, v_before, v_after,
    case when v_dir = 1 then p_unit_cost else v_avg end,
    p_reference_type, p_reference_id, auth.uid(), p_note
  );

  update public.stock_balances
     set quantity = v_after, avg_unit_cost = v_avg
   where warehouse_id = p_warehouse_id and variant_id = p_variant_id;

  return v_after;
end;
$fn$;

create or replace function public.adjust_stock(
  p_warehouse_id uuid,
  p_variant_id   uuid,
  p_quantity     numeric(14,3),
  p_reason       text,
  p_direction    smallint default 1,
  p_note         text default null
)
returns numeric(14,3)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org  uuid;
  v_type public.stock_movement_type;
begin
  select organization_id into v_org from public.warehouses where id = p_warehouse_id;
  if v_org is null then
    raise exception 'warehouse_not_found: %', p_warehouse_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('inventory.adjust');

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  v_type := case
    when p_direction = 1 then 'ADJUSTMENT_IN'::public.stock_movement_type
    else case lower(p_reason)
           when 'damage'  then 'DAMAGE'::public.stock_movement_type
           when 'loss'    then 'LOSS'::public.stock_movement_type
           when 'expired' then 'EXPIRED'::public.stock_movement_type
           else 'ADJUSTMENT_OUT'::public.stock_movement_type
         end
  end;

  return public.apply_stock_movement(
    p_warehouse_id, p_variant_id, v_type, p_quantity, 0,
    'adjustment', null, coalesce(p_note, p_reason)
  );
end;
$fn$;

create or replace function public.receive_purchase(
  p_purchase_id uuid,
  p_items       jsonb,            -- [{purchase_item_id, qty, unit_cost?}]
  p_paid        jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_po      public.purchases;
  v_item    jsonb;
  v_pi      public.purchase_items;
  v_qty     numeric(14,3);
  v_cost    numeric(14,4);
  v_added   numeric(14,2) := 0;
  v_pay     jsonb;
  v_paid    numeric(14,2) := 0;
  v_all_in  boolean;
begin
  select * into v_po from public.purchases where id = p_purchase_id;
  if v_po.id is null then
    raise exception 'purchase_not_found: %', p_purchase_id using errcode = 'P0002';
  end if;
  perform app.require_org(v_po.organization_id);
  perform app.require_permission('purchases.receive');

  if v_po.status in ('RECEIVED', 'CANCELLED') then
    raise exception 'purchase_not_receivable: %', v_po.status using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_pi from public.purchase_items
     where id = (v_item ->> 'purchase_item_id')::uuid
       and purchase_id = p_purchase_id;
    if v_pi.id is null then
      raise exception 'purchase_item_not_found' using errcode = 'P0002';
    end if;

    v_qty  := (v_item ->> 'qty')::numeric(14,3);
    v_cost := coalesce((v_item ->> 'unit_cost')::numeric(14,4), v_pi.unit_cost);

    if v_qty <= 0 or v_pi.received_qty + v_qty > v_pi.quantity then
      raise exception 'over_receipt: item % (% received, requesting %)',
        v_pi.id, v_pi.received_qty, v_qty using errcode = '22023';
    end if;

    perform public.apply_stock_movement(
      v_po.warehouse_id, v_pi.variant_id, 'PURCHASE', v_qty, v_cost,
      'purchase', p_purchase_id
    );

    update public.purchase_items
       set received_qty = received_qty + v_qty
     where id = v_pi.id;

    v_added := v_added + (v_qty * v_cost);
  end loop;

  for v_pay in select * from jsonb_array_elements(p_paid)
  loop
    insert into public.purchase_payments
          (organization_id, purchase_id, method_id, amount, reference)
    values (v_po.organization_id, p_purchase_id,
            (v_pay ->> 'method_id')::uuid,
            (v_pay ->> 'amount')::numeric(14,2), v_pay ->> 'reference');
    v_paid := v_paid + (v_pay ->> 'amount')::numeric(14,2);
  end loop;

  update public.purchases
     set paid_total = paid_total + v_paid
   where id = p_purchase_id;

  if v_po.supplier_id is not null and v_paid > 0 then
    update public.suppliers
       set balance = balance - v_paid
     where id = v_po.supplier_id;
  end if;

  select bool_and(received_qty >= quantity) into v_all_in
    from public.purchase_items where purchase_id = p_purchase_id;

  update public.purchases
     set status = case
           when v_all_in then 'RECEIVED'::public.purchase_status
           else 'PARTIALLY_RECEIVED'::public.purchase_status
         end,
         received_at = case when v_all_in then now() else received_at end
   where id = p_purchase_id;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_po.organization_id, 'purchase.received', 'purchase', p_purchase_id,
          jsonb_build_object('purchase_id', p_purchase_id, 'value', v_added));

  return jsonb_build_object(
    'purchase_id', p_purchase_id,
    'received_value', v_added,
    'paid', v_paid,
    'status', (select status from public.purchases where id = p_purchase_id)
  );
end;
$fn$;

-- Refund: item-level and quantity-level, restocking where appropriate
-- (spec §18). Guarded by the database, not the UI — refunding more than was
-- sold is impossible here even with a hand-crafted request.
create or replace function public.refund_sale(
  p_sale_id uuid,
  p_items   jsonb,               -- [{sale_item_id, qty}]
  p_payments jsonb,              -- [{method_id, amount}] (amounts negative)
  p_reason  text default null,
  p_restock boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale    public.sales;
  v_return_id uuid := gen_random_uuid();
  v_seq     bigint;
  v_item    jsonb;
  v_si      public.sale_items;
  v_qty     numeric(14,3);
  v_refund  numeric(14,2);
  v_total   numeric(14,2) := 0;
  v_pay     jsonb;
  v_paid    numeric(14,2) := 0;
  v_wh      uuid;
  v_new_status public.sale_status;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null then
    raise exception 'sale_not_found: %', p_sale_id using errcode = 'P0002';
  end if;
  perform app.require_org(v_sale.organization_id);
  perform app.require_permission('sales.refund');

  if v_sale.status in ('DRAFT', 'HELD', 'CANCELLED') then
    raise exception 'sale_not_refundable: %', v_sale.status using errcode = '22023';
  end if;

  select warehouse_id into v_wh from public.stock_movements
   where reference_type = 'sale' and reference_id = p_sale_id
   order by created_at limit 1;

  v_seq := public.next_sequence(v_sale.organization_id,
                                'return:' || to_char(now(), 'YYYY'));

  insert into public.sale_returns (
    id, sale_id, organization_id, branch_id, return_no, reason, restock, created_by
  ) values (
    v_return_id, p_sale_id, v_sale.organization_id, v_sale.branch_id,
    'RET-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 6, '0'),
    p_reason, p_restock, auth.uid()
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_si from public.sale_items
     where id = (v_item ->> 'sale_item_id')::uuid and sale_id = p_sale_id;
    if v_si.id is null then
      raise exception 'sale_item_not_found' using errcode = 'P0002';
    end if;

    v_qty := (v_item ->> 'qty')::numeric(14,3);

    if v_qty <= 0 or v_si.returned_qty + v_qty > v_si.quantity then
      raise exception 'over_refund: item % (% of % already returned)',
        v_si.id, v_si.returned_qty, v_si.quantity using errcode = '22023';
    end if;

    v_refund := round(v_si.line_total * (v_qty / v_si.quantity), 2);

    insert into public.sale_return_items
          (organization_id, return_id, sale_item_id, quantity, refund_amount)
    values (v_sale.organization_id, v_return_id, v_si.id, v_qty, v_refund);

    update public.sale_items
       set returned_qty = returned_qty + v_qty
     where id = v_si.id;

    if p_restock and v_wh is not null then
      perform public.apply_stock_movement(
        v_wh, v_si.variant_id, 'RETURN_IN', v_qty, v_si.unit_cost,
        'return', v_return_id
      );
    end if;

    v_total := v_total + v_refund;
  end loop;

  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    insert into public.sale_return_payments
          (organization_id, return_id, method_id, amount, reference)
    values (v_sale.organization_id, v_return_id,
            (v_pay ->> 'method_id')::uuid,
            -abs((v_pay ->> 'amount')::numeric(14,2)),
            v_pay ->> 'reference');
    v_paid := v_paid + abs((v_pay ->> 'amount')::numeric(14,2));
  end loop;

  update public.sale_returns set refund_total = v_total where id = v_return_id;

  select case
           when coalesce(sum(returned_qty), 0) >= (select sum(quantity) from public.sale_items where sale_id = p_sale_id)
             then 'REFUNDED'::public.sale_status
           else 'PARTIALLY_REFUNDED'::public.sale_status
         end
    into v_new_status
    from public.sale_items where sale_id = p_sale_id and returned_qty > 0;

  update public.sales set status = v_new_status where id = p_sale_id;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_sale.organization_id, 'sale.refunded', 'sale', p_sale_id,
          jsonb_build_object('sale_id', p_sale_id, 'return_id', v_return_id,
                             'refund_total', v_total, 'restocked', p_restock));

  return jsonb_build_object(
    'return_id', v_return_id,
    'refund_total', v_total,
    'refunded_to_methods', v_paid,
    'sale_status', v_new_status
  );
end;
$fn$;
