-- 016 — Reporting: the dashboard aggregate and supporting views.
--
-- One function, one round trip (docs/09 #10). Eight widgets as eight queries
-- means eight scans of `sales` every morning; this computes them together.
-- The Android dashboard calls the same function, so "today's numbers" has
-- exactly one implementation.

create or replace function public.dashboard_summary(
  p_branch_id uuid,
  p_day       date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org  uuid;
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
  v_out  jsonb;
begin
  select b.organization_id, coalesce(b.timezone, o.timezone)
    into v_org, v_tz
    from public.branches b
    join public.organizations o on o.id = b.organization_id
   where b.id = p_branch_id;

  if v_org is null then
    raise exception 'branch_not_found: %', p_branch_id using errcode = 'P0002';
  end if;
  perform app.require_org(v_org);
  perform app.require_permission('dashboard.view');

  -- Day boundaries in the branch's timezone, never server-local (docs/09 #14).
  v_from := (p_day::timestamp AT TIME ZONE v_tz);
  v_to   := ((p_day + 1)::timestamp AT TIME ZONE v_tz);

  select jsonb_build_object(
    'date', p_day,
    'timezone', v_tz,
    'currency', (select currency from public.organizations where id = v_org),

    'today_sales', coalesce((
      select sum(total) from public.sales
       where branch_id = p_branch_id
         and status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
         and created_at >= v_from and created_at < v_to), 0),

    'order_count', coalesce((
      select count(*) from public.sales
       where branch_id = p_branch_id
         and status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
         and created_at >= v_from and created_at < v_to), 0),

    'gross_profit', coalesce((
      select sum(profit) from public.sales
       where branch_id = p_branch_id
         and status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
         and created_at >= v_from and created_at < v_to), 0),

    'items_sold', coalesce((
      select sum(si.quantity)
        from public.sale_items si
        join public.sales s on s.id = si.sale_id
       where s.branch_id = p_branch_id
         and s.status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
         and s.created_at >= v_from and s.created_at < v_to), 0),

    'discount_given', coalesce((
      select sum(discount_total) from public.sales
       where branch_id = p_branch_id
         and created_at >= v_from and created_at < v_to), 0),

    'tax_collected', coalesce((
      select sum(tax_total) from public.sales
       where branch_id = p_branch_id
         and created_at >= v_from and created_at < v_to), 0),

    'today_expenses', coalesce((
      select sum(amount) from public.expenses
       where branch_id = p_branch_id and expense_date = p_day
         and deleted_at is null), 0),

    'refunds_today', coalesce((
      select sum(refund_total) from public.sale_returns sr
       where sr.branch_id = p_branch_id
         and sr.created_at >= v_from and sr.created_at < v_to), 0),

    'held_sales', coalesce((
      select count(*) from public.sales
       where branch_id = p_branch_id and status = 'HELD'), 0),

    'pending_payments', coalesce((
      select sum(total - paid_total) from public.sales
       where branch_id = p_branch_id and status = 'PARTIALLY_PAID'), 0),

    'customer_count', (
      select count(*) from public.customers
       where organization_id = v_org and deleted_at is null),

    'out_of_stock', coalesce((
      select count(distinct sb.product_id)
        from public.stock_balances sb
        join public.products p on p.id = sb.product_id
       where sb.organization_id = v_org
         and p.track_stock and p.is_active and p.deleted_at is null
         and sb.quantity <= 0), 0),

    'low_stock', coalesce((
      select count(distinct sb.product_id)
        from public.stock_balances sb
        join public.products p on p.id = sb.product_id
       where sb.organization_id = v_org
         and p.track_stock and p.is_active and p.deleted_at is null
         and sb.quantity > 0
         and sb.quantity <= p.reorder_point), 0),

    'stock_value', coalesce((
      select sum(sb.quantity * sb.avg_unit_cost)
        from public.stock_balances sb
       where sb.organization_id = v_org), 0),

    'expected_cash', (
      select sum(opening_cash + cash_in - cash_out
                 + sales_cash - refund_cash - expense_cash)
        from public.register_sessions
       where branch_id = p_branch_id and closed_at is null),

    'sales_by_hour', coalesce((
      select jsonb_agg(jsonb_build_object(
               'hour', h, 'total', t) order by h)
        from (
          select extract(hour from s.created_at at time zone v_tz)::int as h,
                 sum(s.total) as t
            from public.sales s
           where s.branch_id = p_branch_id
             and s.status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
             and s.created_at >= v_from and s.created_at < v_to
           group by 1
        ) x), '[]'::jsonb),

    'payment_mix', coalesce((
      select jsonb_agg(jsonb_build_object(
               'method', m.name, 'total', t) order by t desc)
        from (
          select sp.method_id, sum(sp.amount) as t
            from public.sale_payments sp
            join public.sales s on s.id = sp.sale_id
           where s.branch_id = p_branch_id
             and s.created_at >= v_from and s.created_at < v_to
           group by 1
        ) y
        join public.payment_methods m on m.id = y.method_id), '[]'::jsonb),

    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', product_name, 'qty', q, 'revenue', rev) order by rev desc)
        from (
          select si.product_name,
                 sum(si.quantity) as q,
                 sum(si.line_total) as rev
            from public.sale_items si
            join public.sales s on s.id = si.sale_id
           where s.branch_id = p_branch_id
             and s.status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
             and s.created_at >= v_from and s.created_at < v_to
           group by 1
           order by rev desc
           limit 10
        ) z), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$fn$;

-- Stock ledger with product context — the answer to "why 37 units?" (§12).
create or replace view public.stock_history as
  select sm.id,
         sm.organization_id,
         sm.warehouse_id,
         w.name          as warehouse_name,
         sm.variant_id,
         sm.product_id,
         p.name          as product_name,
         v.name_suffix   as variant_name,
         sm.type,
         sm.quantity,
         sm.direction,
         sm.quantity * sm.direction as delta,
         sm.before_quantity,
         sm.after_quantity,
         sm.unit_cost,
         sm.reference_type,
         sm.reference_id,
         sm.user_id,
         sm.note,
         sm.created_at
    from public.stock_movements sm
    join public.products p         on p.id = sm.product_id
    join public.product_variants v on v.id = sm.variant_id
    join public.warehouses w       on w.id = sm.warehouse_id;

-- Sales with profit and cashier, for report tables and CSV export.
create or replace view public.sales_detail as
  select s.id,
         s.organization_id,
         s.branch_id,
         b.name       as branch_name,
         s.invoice_no,
         s.status,
         s.customer_id,
         c.name       as customer_name,
         s.subtotal,
         s.discount_total,
         s.tax_total,
         s.total,
         s.paid_total,
         s.cogs,
         s.profit,
         s.created_by,
         s.created_at,
         s.completed_at
    from public.sales s
    join public.branches b    on b.id = s.branch_id
    left join public.customers c on c.id = s.customer_id;

-- Low stock across an organization, for the reorder screen and badge.
create or replace view public.low_stock as
  select p.id            as product_id,
         p.organization_id,
         p.name,
         p.sku,
         v.id            as variant_id,
         v.name_suffix,
         sb.warehouse_id,
         w.name          as warehouse_name,
         sb.quantity,
         p.reorder_point,
         sb.avg_unit_cost,
         (sb.quantity * sb.avg_unit_cost) as stock_value
    from public.stock_balances sb
    join public.products p         on p.id = sb.product_id
    join public.product_variants v on v.id = sb.variant_id
    join public.warehouses w       on w.id = sb.warehouse_id
   where p.track_stock
     and p.is_active
     and p.deleted_at is null
     and sb.quantity <= p.reorder_point;

-- Realtime: clients subscribe to outbox filtered by organization so the JS
-- EventBus can mirror authoritative events (docs/02 §3).
alter publication supabase_realtime add table public.outbox;
