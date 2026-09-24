-- 024 — Stock operations: receive, issue, transfer, and the overview numbers.
--
-- Migration 006 created the ledger, 013 the costing primitive, and 016 the
-- reporting views. What was missing was the middle: the operations a
-- shopkeeper actually performs. Three of them had no reachable path at all:
--
--   * Stock In could not carry a cost. `adjust_stock` passes 0 as the unit
--     cost, so receiving 20 units at ৳85 through it would have blended the
--     weighted average toward zero — silently corrupting the stock valuation
--     that the dashboard reports.
--   * Stock Out required `inventory.adjust`, which is the wrong permission
--     for "40 bottles broke": a cashier who may write off damage should not
--     thereby be able to post arbitrary corrections.
--   * Transfers had tables (`stock_transfers`, `stock_transfer_items`) and no
--     function. The tables could only be filled by hand.
--
-- Every function here delegates to `apply_stock_movement`, so the ledger
-- invariant (before + delta = after, and the balance equalling the sum of its
-- movements) holds for operations written years from now too. Nothing writes
-- `stock_balances` directly.

-- ── Stock in ─────────────────────────────────────────────────────────────
--
-- The receiving desk. Scan or pick the product, type the quantity and what it
-- cost, optionally name the supplier. Cost defaults to the variant's last
-- known cost so the common case is two fields.
create or replace function public.stock_in(
  p_warehouse_id uuid,
  p_items        jsonb,              -- [{variant_id, qty, unit_cost?}]
  p_supplier_id  uuid    default null,
  p_reference    text    default null,
  p_note         text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid;
  v_supplier uuid;
  v_item     jsonb;
  v_variant  uuid;
  v_qty      numeric(14,3);
  v_cost     numeric(14,4);
  v_after    numeric(14,3);
  v_before   numeric(14,3);
  v_lines    jsonb := '[]'::jsonb;
  v_qty_sum  numeric(14,3) := 0;
  v_cost_sum numeric(14,2) := 0;
  v_count    int := 0;
begin
  select organization_id into v_org from public.warehouses where id = p_warehouse_id;
  if v_org is null then
    raise exception 'warehouse_not_found: %', p_warehouse_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('inventory.stock_in');

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  -- A supplier named on a receipt must belong to the same shop, or the
  -- ledger row would point across tenants.
  if p_supplier_id is not null then
    select id into v_supplier
      from public.suppliers
     where id = p_supplier_id and organization_id = v_org and deleted_at is null;
    if v_supplier is null then
      raise exception 'supplier_not_found: %', p_supplier_id using errcode = 'P0002';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant := (v_item->>'variant_id')::uuid;
    v_qty     := (v_item->>'qty')::numeric(14,3);

    if v_variant is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item: %', v_item using errcode = '22023';
    end if;

    -- Falls back to the variant's last cost, then the product's, so a
    -- shopkeeper who does not remember the price is not forced to invent one.
    v_cost := coalesce(
      nullif(v_item->>'unit_cost', '')::numeric(14,4),
      (select cost_override from public.product_variants where id = v_variant),
      (select cost_price from public.products
        where id = (select product_id from public.product_variants where id = v_variant)),
      0
    );

    v_after := public.apply_stock_movement(
      p_warehouse_id, v_variant, 'PURCHASE', v_qty, v_cost,
      'stock_in', p_supplier_id, p_note
    );

    -- `after` minus the quantity received is `before`, exactly: the movement
    -- just written moved the balance by +qty. Reading it back from the ledger
    -- would be a second query for a number already known.
    v_before := v_after - v_qty;

    v_lines := v_lines || jsonb_build_object(
      'variant_id', v_variant, 'qty', v_qty, 'unit_cost', v_cost,
      'before', v_before, 'after', v_after
    );
    v_qty_sum  := v_qty_sum + v_qty;
    v_cost_sum := v_cost_sum + round(v_qty * v_cost, 2);
    v_count    := v_count + 1;
  end loop;

  return jsonb_build_object(
    'warehouse_id', p_warehouse_id,
    'supplier_id',  p_supplier_id,
    'reference',    p_reference,
    'lines',        v_lines,
    'line_count',   v_count,
    'total_qty',    v_qty_sum,
    'total_cost',   v_cost_sum
  );
end
$fn$;

-- ── Stock out ────────────────────────────────────────────────────────────
--
-- Damage, loss, expiry, theft: stock that left without being sold. The reason
-- picks the movement type, because "why did 37 become 33?" is the whole point
-- of the ledger and 'ADJUSTMENT_OUT' for a broken bottle answers nothing.
create or replace function public.stock_out(
  p_warehouse_id uuid,
  p_items        jsonb,              -- [{variant_id, qty}]
  p_reason       text,
  p_note         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org     uuid;
  v_reason  text := lower(btrim(coalesce(p_reason, '')));
  v_type    public.stock_movement_type;
  v_item    jsonb;
  v_variant uuid;
  v_qty     numeric(14,3);
  v_after   numeric(14,3);
  v_lines   jsonb := '[]'::jsonb;
  v_qty_sum numeric(14,3) := 0;
  v_count   int := 0;
begin
  select organization_id into v_org from public.warehouses where id = p_warehouse_id;
  if v_org is null then
    raise exception 'warehouse_not_found: %', p_warehouse_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('inventory.stock_out');

  if v_reason = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  -- An allow-list rather than a free string: the reason reaches the ledger as
  -- an enum, and an unknown one would silently become a generic adjustment.
  v_type := case v_reason
    when 'damage'  then 'DAMAGE'::public.stock_movement_type
    when 'damaged' then 'DAMAGE'::public.stock_movement_type
    when 'loss'    then 'LOSS'::public.stock_movement_type
    when 'lost'    then 'LOSS'::public.stock_movement_type
    when 'theft'   then 'LOSS'::public.stock_movement_type
    when 'expired' then 'EXPIRED'::public.stock_movement_type
    when 'expiry'  then 'EXPIRED'::public.stock_movement_type
    when 'other'   then 'ADJUSTMENT_OUT'::public.stock_movement_type
    else null
  end;
  if v_type is null then
    raise exception 'unknown_reason: %', p_reason
      using errcode = '22023',
            hint = 'damage, loss, theft, expired or other';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant := (v_item->>'variant_id')::uuid;
    v_qty     := (v_item->>'qty')::numeric(14,3);

    if v_variant is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item: %', v_item using errcode = '22023';
    end if;

    v_after := public.apply_stock_movement(
      p_warehouse_id, v_variant, v_type, v_qty, 0,
      'stock_out', null, coalesce(nullif(btrim(coalesce(p_note, '')), ''), v_reason)
    );

    v_lines := v_lines || jsonb_build_object(
      'variant_id', v_variant, 'qty', v_qty,
      'before', v_after + v_qty, 'after', v_after, 'reason', v_reason
    );
    v_qty_sum := v_qty_sum + v_qty;
    v_count   := v_count + 1;
  end loop;

  return jsonb_build_object(
    'warehouse_id', p_warehouse_id,
    'reason',       v_reason,
    'type',         v_type,
    'lines',        v_lines,
    'line_count',   v_count,
    'total_qty',    v_qty_sum
  );
end
$fn$;

-- ── Transfer between warehouses ──────────────────────────────────────────
--
-- One call, two movements per line, one shared cost. The cost matters: the
-- receiving warehouse must inherit the *sending* warehouse's average, or a
-- transfer would change what the shop's stock is worth — value is conserved
-- across a move, and any other behaviour is a bug the accounts would find
-- later and blame on the ledger.
create or replace function public.transfer_stock(
  p_from_warehouse_id uuid,
  p_to_warehouse_id   uuid,
  p_items             jsonb,          -- [{variant_id, qty}]
  p_note              text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org_from uuid;
  v_org_to   uuid;
  v_transfer uuid := gen_random_uuid();
  v_item     jsonb;
  v_variant  uuid;
  v_product  uuid;
  v_qty      numeric(14,3);
  v_avg      numeric(14,4);
begin
  select organization_id into v_org_from from public.warehouses where id = p_from_warehouse_id;
  select organization_id into v_org_to   from public.warehouses where id = p_to_warehouse_id;

  if v_org_from is null then
    raise exception 'warehouse_not_found: %', p_from_warehouse_id using errcode = 'P0002';
  end if;
  if v_org_to is null then
    raise exception 'warehouse_not_found: %', p_to_warehouse_id using errcode = 'P0002';
  end if;
  if v_org_from <> v_org_to then
    raise exception 'cannot transfer between organizations' using errcode = '42501';
  end if;
  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'transfer_to_same_warehouse' using errcode = '22023';
  end if;

  perform app.require_org(v_org_from);
  perform app.require_permission('inventory.transfer');

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;

  insert into public.stock_transfers
        (id, organization_id, from_warehouse_id, to_warehouse_id, status, note, created_by)
  values (v_transfer, v_org_from, p_from_warehouse_id, p_to_warehouse_id,
          'received', p_note, auth.uid());

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant := (v_item->>'variant_id')::uuid;
    v_qty     := (v_item->>'qty')::numeric(14,3);

    if v_variant is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item: %', v_item using errcode = '22023';
    end if;

    select product_id into v_product from public.product_variants where id = v_variant;
    if v_product is null then
      raise exception 'variant_not_found: %', v_variant using errcode = 'P0002';
    end if;

    -- Captured before the outbound movement, so both legs carry the same cost
    -- even though the outbound write is what settles the average.
    select avg_unit_cost into v_avg
      from public.stock_balances
     where warehouse_id = p_from_warehouse_id and variant_id = v_variant;
    v_avg := coalesce(v_avg, 0);

    insert into public.stock_transfer_items
          (organization_id, transfer_id, variant_id, product_id, quantity, unit_cost)
    values (v_org_from, v_transfer, v_variant, v_product, v_qty, v_avg);

    perform public.apply_stock_movement(
      p_from_warehouse_id, v_variant, 'TRANSFER_OUT', v_qty, v_avg,
      'stock_transfer', v_transfer, p_note
    );
    perform public.apply_stock_movement(
      p_to_warehouse_id, v_variant, 'TRANSFER_IN', v_qty, v_avg,
      'stock_transfer', v_transfer, p_note
    );
  end loop;

  return v_transfer;
end
$fn$;

-- ── The overview numbers ─────────────────────────────────────────────────
--
-- One call for the stock screen's header and the dashboard's stock card, so
-- the two can never disagree. `value` is the same expression the dashboard
-- summary uses (Σ quantity × avg_unit_cost) — the acceptance test for Phase 3
-- compares them for exact equality, so they must be computed the same way
-- rather than merely consistently.
create or replace function public.stock_summary(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid := p_organization_id;
begin
  -- The organization is passed explicitly rather than inferred: a user can
  -- belong to several shops, and the "active" one is a client-side choice.
  -- require_org rejects an id the caller is not a member of, so passing it is
  -- not a widening of access.
  perform app.require_org(v_org);
  perform app.require_permission('inventory.view');

  return jsonb_build_object(
    'stock_value', coalesce((
      select sum(sb.quantity * sb.avg_unit_cost)
        from public.stock_balances sb
       where sb.organization_id = v_org), 0),
    'variants_in_stock', coalesce((
      select count(*)
        from public.stock_balances sb
       where sb.organization_id = v_org and sb.quantity > 0), 0),
    'low_stock', coalesce((
      select count(*) from public.low_stock l where l.organization_id = v_org), 0),
    -- Out of stock is not the same as low: a shop reorders the two
    -- differently, so the screen reports them separately.
    'out_of_stock', coalesce((
      select count(*)
        from public.stock_balances sb
        join public.products p on p.id = sb.product_id
       where sb.organization_id = v_org
         and p.track_stock and p.is_active and p.deleted_at is null
         and sb.quantity <= 0), 0),
    'warehouses', coalesce((
      select count(*) from public.warehouses w
       where w.organization_id = v_org and w.deleted_at is null), 0),
    'movements_today', coalesce((
      select count(*) from public.stock_movements sm
       where sm.organization_id = v_org
         and sm.created_at >= date_trunc('day', now())), 0)
  );
end
$fn$;

-- ── Grants ───────────────────────────────────────────────────────────────
-- Same rule as 018: the client gets the operation, never the ledger
-- primitive. `apply_stock_movement` stays revoked from `authenticated`.
grant execute on function public.stock_in(uuid, jsonb, uuid, text, text) to authenticated;
grant execute on function public.stock_out(uuid, jsonb, text, text) to authenticated;
grant execute on function public.transfer_stock(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.stock_summary(uuid) to authenticated;

-- ── Realtime for the low-stock badge ─────────────────────────────────────
-- 016 added only `outbox`. A balance change is what makes a badge stale, and
-- RLS is applied to realtime rows, so a client receives only its own shop's
-- balances. Guarded: the publication may not exist outside Supabase.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.stock_balances;
    exception
      when duplicate_object then null;
    end;
  end if;
end
$$;
