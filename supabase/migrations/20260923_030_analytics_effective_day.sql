-- 030 — "Today" means today where the shop is, even when the caller is silent.
--
-- The Phase 5 screens do not send a date. The browser cannot know the branch's
-- timezone, so the day is left to the database on purpose, and the repository
-- sends `p_day: null`.
--
-- What the phone audit revealed is that `default current_date` never runs for
-- a NULL argument: PostgREST passes the null through, the default is bypassed,
-- and every day-scoped statement inside the function then compared against
-- NULL. Most quietly returned zero; one — the peak-hour answer dividing by the
-- day's takings — raised `division by zero` (22012) and took the whole
-- dashboard down with it.
--
-- So NULL now means "the branch's today", resolved in exactly one place.
-- `app.effective_day` is that place; it raises `branch_not_found` for an
-- unknown branch rather than answering about a day nobody asked for.
--
-- This migration re-defines the four functions whose bodies read the day: the
-- widgets, the answer builder, `public.bi_answers` and the dashboard wrapper.
-- The parameter keeps its name and type (`p_day date`, default null now), so a
-- client that does send an explicit date — an Android replay of yesterday, a
-- report for a chosen day — is unaffected. 029's `report_rows` derives its
-- dates from the period and never needed a default.

create or replace function app.effective_day(p_branch_id uuid, p_day date)
returns date
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_tz text;
begin
  if p_day is not null then
    return p_day;
  end if;

  select coalesce(b.timezone, o.timezone)
    into v_tz
    from public.branches b
    join public.organizations o on o.id = b.organization_id
   where b.id = p_branch_id;

  if v_tz is null then
    raise exception 'branch_not_found: %', p_branch_id using errcode = 'P0002';
  end if;

  return (now() at time zone v_tz)::date;
end
$fn$;

revoke execute on function app.effective_day(uuid, date) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- The widgets (016's body, moved to `app` by 028, day-resolved here)
-- ══════════════════════════════════════════════════════════════════════════

create or replace function app.dashboard_widgets(
  p_branch_id uuid,
  p_day       date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org  uuid;
  v_day  date;
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

  -- The caller's day; NULL means "today where the shop is" (see the header).
  v_day := app.effective_day(p_branch_id, p_day);

  -- Day boundaries in the branch's timezone, never server-local (docs/09 #14).
  v_from := (v_day::timestamp AT TIME ZONE v_tz);
  v_to   := ((v_day + 1)::timestamp AT TIME ZONE v_tz);

  select jsonb_build_object(
    'date', v_day,
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
       where branch_id = p_branch_id and expense_date = v_day
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

-- ══════════════════════════════════════════════════════════════════════════
-- The answers, and the two public entry points
-- ══════════════════════════════════════════════════════════════════════════

create or replace function app.bi_answers_internal(p_branch_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_day date;
  v_win jsonb;
  v_org uuid;
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_out jsonb := '[]'::jsonb;
  v_money numeric;
  v_cnt numeric;
  v_txt text;
  v_pct numeric;
  v_r jsonb;
  v_day_takings numeric;   -- today's takings, kept for the later percentages
  v_yday_avg numeric;
begin

  -- The caller's day; NULL means "today where the shop is" (see the header).
  v_day := app.effective_day(p_branch_id, p_day);
  v_win  := app.analytics_window(p_branch_id, 'custom', v_day, v_day);
  v_org  := (v_win ->> 'org')::uuid;
  v_tz   := v_win ->> 'timezone';
  v_from := (v_day::timestamp AT TIME ZONE v_tz);
  v_to   := ((v_day + 1)::timestamp AT TIME ZONE v_tz);

  -- 1 · What did we take today?
  select coalesce(sum(s.total), 0), count(*) into v_day_takings, v_cnt
    from public.sales s
   where s.branch_id = p_branch_id and s.created_at >= v_from and s.created_at < v_to
     and s.status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED');
  select coalesce(avg(s.total), 0) into v_yday_avg
    from public.sales s
   where s.branch_id = p_branch_id
     and s.created_at >= ((v_day - 1)::timestamp AT TIME ZONE v_tz)
     and s.created_at <  v_from
     and s.status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED');
  v_out := v_out || jsonb_build_array(app.bi_item(
    'takings_today', 'How much did we take today?', 'money', v_day_takings::text,
    format('%s orders · average bill %s · yesterday''s average %s',
           v_cnt::int,
           to_char(coalesce(v_day_takings / nullif(v_cnt, 0), 0), 'FM999999990.00'),
           to_char(v_yday_avg, 'FM999999990.00')),
    '/sales', 'payments'));

  -- 2 · Did we make money today?
  select coalesce(sum(s.profit), 0) into v_money
    from public.sales s
   where s.branch_id = p_branch_id and s.created_at >= v_from and s.created_at < v_to
     and s.status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED');
  v_out := v_out || jsonb_build_array(app.bi_item(
    'profit_today', 'Are we in profit today?', 'money', v_money::text,
    format('margin %s%% of takings · after cost of goods, before expenses',
           to_char(case when v_day_takings > 0 then v_money / v_day_takings * 100 else 0 end, 'FM990.0')),
    '/reports?report=profit', 'trending_up'));

  -- 3 · What is selling?
  v_r := app.analytics_run(p_branch_id, 'product', 'items', 'month', null, null, '{}'::jsonb, 5, false);
  select string_agg(x ->> 'label', ', ') into v_txt
    from jsonb_array_elements(v_r -> 'series') x;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'top_products', 'What are the best sellers this month?', 'text',
    coalesce(v_txt, 'nothing sold yet'),
    coalesce((v_r -> 'series' -> 0 ->> 'label'), 'nothing') || ' leads with '
      || round(coalesce((v_r -> 'series' -> 0 ->> 'value')::numeric, 0))::text || ' units sold',
    '/reports?report=product_performance', 'star'));

  -- 4 · Which parts of the shop earn?
  v_r := app.analytics_run(p_branch_id, 'category', 'takings', 'month', null, null, '{}'::jsonb, 6, false);
  select coalesce(sum((x ->> 'value')::numeric), 0) into v_money
    from jsonb_array_elements(v_r -> 'series') x;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'category_mix', 'What sells by category this month?', 'text',
    coalesce(v_r -> 'series' -> 0 ->> 'label', 'no sales yet'),
    format('%s%% of takings · %s categories with sales',
           case when v_money > 0
                then round(coalesce((v_r -> 'series' -> 0 ->> 'value')::numeric, 0) / v_money * 100)
                else 0 end,
           jsonb_array_length(v_r -> 'series')),
    '/analytics?dimension=category&measure=takings', 'category'));

  -- 5 · How do they pay?
  v_r := app.analytics_run(p_branch_id, 'payment_method', 'takings', 'custom', v_day, v_day, '{}'::jsonb, 6, false);
  select coalesce(sum((x ->> 'value')::numeric), 0) into v_money
    from jsonb_array_elements(v_r -> 'series') x;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'payment_mix', 'How are customers paying today?', 'text',
    coalesce(v_r -> 'series' -> 0 ->> 'label', 'no payments yet'),
    case when v_money > 0 then
      format('%s%% of today''s takings · %s method(s) used',
             round(coalesce((v_r -> 'series' -> 0 ->> 'value')::numeric, 0) / v_money * 100),
             jsonb_array_length(v_r -> 'series'))
    else 'no payments taken yet today' end,
    '/analytics?dimension=payment_method&measure=takings&period=day', 'credit_card'));

  -- 6 · How much cash is on the premises?
  select coalesce(sum(opening_cash + cash_in - cash_out + sales_cash - refund_cash - expense_cash), 0),
         count(*)
    into v_money, v_cnt
    from public.register_sessions
   where branch_id = p_branch_id and closed_at is null;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'cash_in_drawer', 'How much cash is in the drawer right now?', 'money', v_money::text,
    case when v_cnt = 0 then 'no register is open' else format('%s register(s) open', v_cnt::int) end,
    '/register', 'point_of_sale'));

  -- 7 · Who owes us?
  select coalesce(sum(c.balance), 0), count(*) into v_money, v_cnt
    from public.customers c
   where c.organization_id = v_org and c.deleted_at is null and c.balance > 0;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'receivable', 'Who owes us money?', 'money', v_money::text,
    format('%s customer(s) carrying a balance', v_cnt::int),
    '/customers', 'account_balance_wallet'));

  -- 8 · Who do we owe?
  select coalesce(sum(sup.balance), 0), count(*) into v_money, v_cnt
    from public.suppliers sup
   where sup.organization_id = v_org and sup.deleted_at is null and sup.balance > 0;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'payable', 'What do we owe suppliers?', 'money', v_money::text,
    format('%s supplier(s) with an outstanding balance', v_cnt::int),
    '/suppliers', 'local_shipping'));

  -- 9 · What must we reorder?
  select count(distinct ls.product_id) into v_cnt
    from public.low_stock ls
   where ls.organization_id = v_org;
  select string_agg(x.name, ', ') into v_txt
    from (select ls.name, sum(ls.quantity) as quantity
            from public.low_stock ls
           where ls.organization_id = v_org
           group by ls.name
           order by 2 asc
           limit 3) x;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'reorder', 'What needs reordering?', 'count', v_cnt::int::text,
    case when v_cnt = 0 then 'nothing is below its reorder point'
         else format('running out first: %s', coalesce(v_txt, '—')) end,
    '/reports?report=low_stock', 'inventory_2'));

  -- 10 · What did we spend?
  select coalesce(sum(e.amount), 0), count(*) into v_money, v_cnt
    from public.expenses e
   where e.branch_id = p_branch_id and e.expense_date = v_day and e.deleted_at is null;
  v_r := app.analytics_run(p_branch_id, 'expense_category', 'expenses', 'month', null, null, '{}'::jsonb, 1, false);
  v_out := v_out || jsonb_build_array(app.bi_item(
    'spend_today', 'What did we spend today?', 'money', v_money::text,
    format('%s expense entr(ies)', v_cnt::int)
      || case when jsonb_array_length(v_r -> 'series') = 0 then ''
              else format(' · biggest category this month: %s', v_r -> 'series' -> 0 ->> 'label') end,
    '/expenses', 'receipt_long'));

  -- 11 · When is the shop busy?
  v_r := app.analytics_run(p_branch_id, 'hour', 'takings', 'custom', v_day, v_day, '{}'::jsonb, 24, false);
  select coalesce(sum((x ->> 'value')::numeric), 0) into v_money
    from jsonb_array_elements(v_r -> 'series') x;
  select x ->> 'label', round((x ->> 'value')::numeric, 2)
    into v_txt, v_pct   -- v_pct reused here as the busiest hour's takings
    from jsonb_array_elements(v_r -> 'series') x
   order by (x ->> 'value')::numeric desc limit 1;
  v_out := v_out || jsonb_build_array(app.bi_item(
    'peak_hour', 'When is the shop busiest today?', 'text',
    coalesce(v_txt, 'no sales yet today'),
    case when coalesce(v_pct, 0) > 0
         then format('%s of the day''s takings · %s%% of the day',
                     to_char(v_pct, 'FM999999990.00'),
                     round(v_pct / v_day_takings * 100))
         else 'nothing sold yet today' end,
    '/analytics?dimension=hour&measure=takings&period=day', 'schedule'));

  -- 12 · What are we giving away in discounts?
  v_r := app.analytics_run(p_branch_id, 'month', 'discount', 'month', null, null, '{}'::jsonb, 1, true);
  v_money := coalesce((v_r -> 'totals' ->> 'value')::numeric, 0);
  v_out := v_out || jsonb_build_array(app.bi_item(
    'discount_month', 'How much did we discount this month?', 'money', v_money::text,
    case when v_money = 0 then 'no discounts given this month'
         else format('%s%% of the month''s takings',
                     case when coalesce((v_r -> 'totals' ->> 'secondary')::numeric, 0) > 0
                          then round(v_money / (v_r -> 'totals' ->> 'secondary')::numeric * 100)
                          else 0 end)
    end,
    '/reports?report=sales', 'sell'));

  -- 13 · What came back?
  v_r := app.analytics_run(p_branch_id, 'day', 'refunds', 'custom', v_day, v_day, '{}'::jsonb, 1, true);
  v_money := coalesce((v_r -> 'totals' ->> 'value')::numeric, 0);
  v_out := v_out || jsonb_build_array(app.bi_item(
    'refunds_today', 'What did we refund today?', 'money', v_money::text,
    format('%s return(s) · %s%% of today''s takings',
           coalesce((v_r -> 'totals' ->> 'secondary')::numeric, 0)::int,
           case when v_day_takings > 0 then round(v_money / v_day_takings * 100) else 0 end),
    '/sales', 'undo'));

  -- 14 · Anything parked?
  select count(*), coalesce(sum(s.total), 0) into v_cnt, v_money
    from public.sales s
   where s.branch_id = p_branch_id and s.status = 'HELD';
  v_out := v_out || jsonb_build_array(app.bi_item(
    'held_sales', 'Is anything parked and forgotten?', 'count', v_cnt::int::text,
    case when v_cnt = 0 then 'no held bills'
         else format('worth %s waiting to be completed', to_char(v_money, 'FM999999990.00')) end,
    '/sales?status=HELD', 'pause_circle'));

  return v_out;
end
$fn$;

create or replace function public.bi_answers(p_branch_id uuid, p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_day date;
  v_win jsonb;
begin

  -- The caller's day; NULL means "today where the shop is" (see the header).
  v_day := app.effective_day(p_branch_id, p_day);
  v_win := app.analytics_window(p_branch_id, 'custom', v_day, v_day);
  perform app.require_org((v_win ->> 'org')::uuid);

  -- Either screen may show the answers: the dashboard is where an owner meets
  -- them, the analytics screen is where they dig in. A role that holds one
  -- permission but not the other still gets its questions answered.
  if not (app.has_permission('dashboard.view') or app.has_permission('analytics.view')) then
    raise exception 'permission_denied: %', 'dashboard.view' using errcode = '42501';
  end if;

  return app.bi_answers_internal(p_branch_id, v_day);
end
$fn$;

create or replace function public.dashboard_summary(
  p_branch_id uuid,
  p_day       date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_day date;
  v_org uuid;
  v_out jsonb;
begin

  -- The caller's day; NULL means "today where the shop is" (see the header).
  v_day := app.effective_day(p_branch_id, p_day);
  v_out := app.dashboard_widgets(p_branch_id, v_day);   -- checks org + dashboard.view

  select b.organization_id into v_org
    from public.branches b where b.id = p_branch_id;

  return v_out || jsonb_build_object(
    'answers', public.bi_answers(p_branch_id, v_day),

    -- Thirty days of takings and profit for the trend chart; two statements
    -- each, both aggregates, no rows travelling.
    'trend_days', app.analytics_run(p_branch_id, 'day', 'takings', 'custom',
                                    v_day - 29, v_day, '{}'::jsonb, 31, false),
    'trend_profit', app.analytics_run(p_branch_id, 'day', 'profit', 'custom',
                                      v_day - 29, v_day, '{}'::jsonb, 31, false),
    'trend_months', app.analytics_run(p_branch_id, 'month', 'takings', 'year',
                                      null, null, '{}'::jsonb, 12, false),
    'rank_products', app.analytics_run(p_branch_id, 'product', 'takings', 'month',
                                       null, null, '{}'::jsonb, 5, false),
    'rank_categories', app.analytics_run(p_branch_id, 'category', 'takings', 'month',
                                         null, null, '{}'::jsonb, 6, false),
    'generated_at', now()
  );
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- ACLs: `create or replace` keeps existing grants, but they are restated so a
-- database rebuilt from the files lands in exactly the same state.
-- ══════════════════════════════════════════════════════════════════════════

revoke execute on function app.dashboard_widgets(uuid, date) from public, anon, authenticated;
revoke execute on function app.bi_answers_internal(uuid, date) from public, anon, authenticated;

revoke execute on function public.bi_answers(uuid, date) from public, anon;
grant execute on function public.bi_answers(uuid, date) to authenticated;

revoke execute on function public.dashboard_summary(uuid, date) from public, anon;
grant execute on function public.dashboard_summary(uuid, date) to authenticated;
