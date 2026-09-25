-- 028 — Analytics: measure × dimension, one engine (spec §22).
--
-- §22 asks for a framework, not a handful of charts: a set of measures that
-- can be sliced by a set of dimensions, with filters, so "revenue by category"
-- and "revenue by day" are the same computation wearing different clothes.
-- Anything less drifts. The failure mode is familiar — the dashboard says
-- ৳12,400 for today while the sales report says ৳12,300 and nobody can say
-- which is right.
--
-- So each measure has exactly one definition, written down here once:
--
--   takings   money through the till, tax included          Σ sales.total
--   revenue   the shop's own money, tax taken out           Σ (total − tax)
--   profit    revenue minus what the goods cost             Σ sales.profit
--   tax       collected for the government                  Σ sales.tax_total
--   discount  given away, line and order discounts          Σ sales.discount_total
--   cogs      cost of the goods actually sold               Σ sales.cogs
--   orders    completed sales
--   items     units sold
--   avg_order takings ÷ orders
--
-- Item-level slices (category, product, variant) have one subtlety. When an
-- order discount is applied to the whole bill, the lines no longer add up to
-- the total, and a naive report shows categories summing to ৳1,000 on a bill
-- the customer paid ৳900 for. The order discount is therefore allocated across
-- the lines in proportion to their totals, so Takings by category equals
-- Takings by day as arithmetic rather than as hope. Allocation rounds to the
-- cent per group, leaving the one residual every retail system has.
--
-- The statement is generated rather than written out sixty times. The
-- (family × dimension) matrix is a whitelist, every identifier in the emitted
-- SQL comes from it, and the alternative — sixty aggregate branches hand
-- copied — is where the sixth one gets pasted wrong. A validator check asserts
-- that Takings by category really does equal Takings by day, so the property
-- is enforced, not merely intended.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Which measure can be sliced by which dimension
-- ══════════════════════════════════════════════════════════════════════════

create or replace function app.analytics_family(p_measure text, p_dimension text)
returns text
language sql
immutable
as $fn$
  select case
    when p_measure in ('takings', 'revenue', 'profit', 'tax', 'discount', 'cogs',
                       'orders', 'items', 'avg_order') then
      case when p_dimension in ('day', 'week', 'month', 'hour', 'weekday',
                                'category', 'product', 'variant', 'customer',
                                'cashier', 'payment_method', 'branch')
           then 'sales' end

    when p_measure = 'refunds' then
      case when p_dimension in ('day', 'week', 'month', 'customer', 'cashier')
           then 'returns' end

    when p_measure = 'expenses' then
      case when p_dimension in ('day', 'week', 'month', 'expense_category')
           then 'expenses' end

    when p_measure in ('purchases', 'purchase_due') then
      case when p_dimension in ('day', 'week', 'month', 'supplier')
           then 'purchases' end
  end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. The statement generator
-- ══════════════════════════════════════════════════════════════════════════
--
-- Returns one SELECT with a fixed shape — (key, label, value, secondary,
-- sort_key) — for a single period. The caller runs it twice, for this period
-- and for the one before it, and pairs the two rowsets up.

create or replace function app.analytics_sql(
  p_dimension text,
  p_measure   text,
  p_org       uuid,
  p_branch    uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_tz        text,
  p_filters   jsonb,
  p_limit     int
)
returns text
language plpgsql
stable
as $fn$
declare
  v_family   text := app.analytics_family(p_measure, p_dimension);
  v_from     text;
  v_where    text;
  v_key      text;
  v_label    text;
  v_sort     text;
  v_value    text;
  v_second   text;
  v_order    text;
  v_by_items boolean := p_dimension in ('category', 'product', 'variant');
  v_filter   text;
begin
  if v_family is null then
    raise exception 'unsupported_combination: % by %', p_measure, p_dimension
      using errcode = '22023';
  end if;

  -- ── The window and tenancy predicate every family shares ───────────────
  v_filter := format(
    ' and s.organization_id = %L and s.created_at >= %L and s.created_at < %L',
    p_org, p_from, p_to
  );
  if p_branch is not null then
    v_filter := v_filter || format(' and s.branch_id = %L', p_branch);
  end if;
  if p_filters ? 'customer_id' then
    v_filter := v_filter || format(' and s.customer_id = %L', (p_filters ->> 'customer_id')::uuid);
  end if;
  if p_filters ? 'cashier_id' then
    v_filter := v_filter || format(' and s.created_by = %L', (p_filters ->> 'cashier_id')::uuid);
  end if;
  if p_filters ? 'method_id' then
    v_filter := v_filter || format(
      ' and exists (select 1 from public.sale_payments spf
                     where spf.sale_id = s.id and spf.method_id = %L)',
      (p_filters ->> 'method_id')::uuid
    );
  end if;
  if p_filters ? 'category_id' then
    v_filter := v_filter || format(
      ' and exists (select 1 from public.sale_items sif
                     join public.products pf on pf.id = sif.product_id
                    where sif.sale_id = s.id and pf.category_id = %L)',
      (p_filters ->> 'category_id')::uuid
    );
  end if;

  -- ── Dimension: key, label, ordering, grouping ─────────────────────────
  v_order := 'sort_key asc';
  case p_dimension
    when 'day' then
      v_key   := format('to_char(s.created_at at time zone %L, ''YYYY-MM-DD'')', p_tz);
      v_label := format('to_char(s.created_at at time zone %L, ''DD Mon'')', p_tz);
      v_sort  := format('min(date_trunc(''day'', s.created_at at time zone %L))', p_tz);
    when 'week' then
      v_key   := format('to_char(date_trunc(''week'', s.created_at at time zone %L), ''IYYY-"W"IW'')', p_tz);
      v_label := format('''Wk '' || to_char(date_trunc(''week'', s.created_at at time zone %L), ''IW'')', p_tz);
      v_sort  := format('min(date_trunc(''week'', s.created_at at time zone %L))', p_tz);
    when 'month' then
      v_key   := format('to_char(s.created_at at time zone %L, ''YYYY-MM'')', p_tz);
      v_label := format('to_char(s.created_at at time zone %L, ''Mon YYYY'')', p_tz);
      v_sort  := format('min(date_trunc(''month'', s.created_at at time zone %L))', p_tz);
    when 'hour' then
      v_key   := format('lpad(extract(hour from s.created_at at time zone %L)::int::text, 2, ''0'')', p_tz);
      v_label := format('lpad(extract(hour from s.created_at at time zone %L)::int::text, 2, ''0'') || '':00''', p_tz);
      v_sort  := format('min(extract(hour from s.created_at at time zone %L)::int)', p_tz);
    when 'weekday' then
      v_key   := format('extract(isodow from s.created_at at time zone %L)::int::text', p_tz);
      v_label := format('to_char(s.created_at at time zone %L, ''Dy'')', p_tz);
      v_sort  := format('min(extract(isodow from s.created_at at time zone %L)::int)', p_tz);
    when 'category' then
      v_key   := 'coalesce(pc.id::text, ''none'')';
      v_label := 'coalesce(pc.name, ''Uncategorised'')';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'product' then
      v_key   := 'si.product_id::text';
      v_label := 'si.product_name';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'variant' then
      v_key   := 'si.variant_id::text';
      v_label := 'si.product_name || coalesce('' · '' || v.name_suffix, '''')';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'customer' then
      v_key   := 'coalesce(s.customer_id::text, ''walk-in'')';
      v_label := 'coalesce(cu.name, ''Walk-in'')';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'cashier' then
      v_key   := 's.created_by::text';
      v_label := 'app.actor_email(s.created_by)';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'payment_method' then
      v_key   := 'sp.method_id::text';
      v_label := 'pm.name';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'branch' then
      v_key   := 's.branch_id::text';
      v_label := 'b.name';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'expense_category' then
      v_key   := 'coalesce(e.category_id::text, ''none'')';
      v_label := 'coalesce(ec.name, ''Uncategorised'')';
      v_sort  := '0::numeric';
      v_order := 'value desc';
    when 'supplier' then
      v_key   := 'p.supplier_id::text';
      v_label := 'coalesce(sup.name, ''No supplier'')';
      v_sort  := '0::numeric';
      v_order := 'value desc';
  end case;

  -- ── Family: joins, measure, secondary measure ─────────────────────────
  if v_family = 'sales' and v_by_items then
    -- Item slices. `si` is an enriched sale_items row that carries the share
    -- of the order-level discount this line must absorb; every measure below
    -- is then a plain sum over lines.
    v_from := format(
      '(select si0.*,
              case when coalesce(pool.line_pool, 0) > 0
                   then greatest(s0.discount_total - coalesce(pool.line_disc, 0), 0)
                        / pool.line_pool
                   else 0 end as order_share
         from public.sale_items si0
         join public.sales s0 on s0.id = si0.sale_id
         left join (
           select si2.sale_id,
                  sum(si2.line_total)     as line_pool,
                  sum(si2.discount_total) as line_disc
             from public.sale_items si2
            group by 1
         ) pool on pool.sale_id = si0.sale_id) si
       join public.sales s          on s.id = si.sale_id
       join public.products p       on p.id = si.product_id
       left join public.product_categories pc on pc.id = p.category_id
       left join public.product_variants v    on v.id = si.variant_id'
    );
    v_value := case p_measure
      when 'takings'  then 'round(sum(si.line_total * (1 - si.order_share)), 2)'
      when 'revenue'  then 'round(sum(si.line_total * (1 - si.order_share) - si.tax_total), 2)'
      when 'profit'   then 'round(sum(si.line_total * (1 - si.order_share) - si.tax_total - si.line_cogs), 2)'
      when 'tax'      then 'round(sum(si.tax_total), 2)'
      when 'discount' then 'round(sum(si.discount_total + si.line_total * si.order_share), 2)'
      when 'cogs'     then 'round(sum(si.line_cogs), 2)'
      when 'orders'   then 'count(distinct si.sale_id)::numeric'
      when 'items'    then 'round(sum(si.quantity), 3)'
      when 'avg_order' then 'round(sum(si.line_total * (1 - si.order_share)) / nullif(count(distinct si.sale_id), 0), 2)'
      else '0::numeric'
    end;
    v_second := case
      when p_measure in ('orders', 'items') then 'round(sum(si.line_total * (1 - si.order_share)), 2)'
      else 'round(sum(si.quantity), 3)'
    end;
    v_where := format(
      ' where s.status in (''COMPLETED'', ''PARTIALLY_PAID'', ''PARTIALLY_REFUNDED'')%s',
      v_filter
    );

  elsif v_family = 'sales' and p_dimension = 'payment_method' then
    -- Paid money by method. It reads `sale_payments`, not `sales`, because a
    -- split bill has no single method and attributing the whole of it to one
    -- would be a fiction the payment-mix chart then repeats.
    v_from := 'public.sale_payments sp
               join public.sales s on s.id = sp.sale_id
               join public.payment_methods pm on pm.id = sp.method_id';
    v_where := format(
      ' where s.status in (''COMPLETED'', ''PARTIALLY_PAID'', ''PARTIALLY_REFUNDED'')%s',
      v_filter
    );
    v_value  := 'round(sum(sp.amount), 2)';
    v_second := 'count(distinct s.id)::numeric';

  elsif v_family = 'sales' then
    -- Sale slices: every measure is already a column on `sales`.
    v_from := 'public.sales s
               left join public.branches b  on b.id = s.branch_id
               left join public.customers cu on cu.id = s.customer_id';
    v_value := case p_measure
      when 'takings'   then 'round(sum(s.total), 2)'
      when 'revenue'   then 'round(sum(s.total - s.tax_total), 2)'
      when 'profit'    then 'round(sum(s.profit), 2)'
      when 'tax'       then 'round(sum(s.tax_total), 2)'
      when 'discount'  then 'round(sum(s.discount_total), 2)'
      when 'cogs'      then 'round(sum(s.cogs), 2)'
      when 'orders'    then 'count(*)::numeric'
      when 'items'     then 'round((select coalesce(sum(si.quantity), 0)
                                      from public.sale_items si where si.sale_id = s.id), 3)'
      when 'avg_order' then 'round(sum(s.total) / nullif(count(*), 0), 2)'
      else '0::numeric'
    end;
    v_second := case
      when p_measure in ('orders', 'items') then 'round(sum(s.total), 2)'
      else 'count(*)::numeric'
    end;
    v_where := format(
      ' where s.status in (''COMPLETED'', ''PARTIALLY_PAID'', ''PARTIALLY_REFUNDED'')%s',
      v_filter
    ) || case when p_dimension = 'cashier' then ' and s.created_by is not null' else '' end;

  elsif v_family = 'returns' then
    v_from := 'public.sale_returns sr
               join public.sales s      on s.id = sr.sale_id
               left join public.customers cu on cu.id = s.customer_id
               left join public.branches b   on b.id = s.branch_id';
    v_value  := 'round(sum(sr.refund_total), 2)';
    v_second := 'count(*)::numeric';
    v_where  := format(
      ' where sr.organization_id = %L and sr.created_at >= %L and sr.created_at < %L%s',
      p_org, p_from, p_to,
      case when p_branch is not null then format(' and sr.branch_id = %L', p_branch) else '' end
    ) || case when p_dimension = 'cashier' then ' and s.created_by is not null' else '' end;
    -- The time columns differ between families, so point the dimension
    -- expressions at the return's own timestamp.
    -- Returns have their own timestamp; the dimension expressions built for
    -- `sales` are re-pointed at it rather than duplicated.
    v_key   := replace(v_key, 's.created_at', 'sr.created_at');
    v_label := replace(v_label, 's.created_at', 'sr.created_at');
    v_sort  := replace(v_sort,  's.created_at', 'sr.created_at');

  elsif v_family = 'expenses' then
    v_from := 'public.expenses e
               left join public.expense_categories ec on ec.id = e.category_id';
    v_value  := 'round(sum(e.amount), 2)';
    v_second := 'count(*)::numeric';
    v_where  := format(
      ' where e.organization_id = %L and e.deleted_at is null
          and e.expense_date >= (%L::timestamptz at time zone %L)::date
          and e.expense_date <  (%L::timestamptz at time zone %L)::date%s',
      p_org, p_from, p_tz, p_to, p_tz,
      case when p_branch is not null then format(' and e.branch_id = %L', p_branch) else '' end
    );
    -- Expenses carry a DATE, not a timestamp, so the time dimensions are
    -- rebuilt here. Shifting a date through a time zone is where a report
    -- silently loses a day: `date::timestamp at time zone tz` is a
    -- timestamptz that renders in the *session's* zone, so an expense on the
    -- 1st shows up under the 31st. A date is already a calendar day; leave it.
    case p_dimension
      when 'day' then
        v_key   := 'to_char(e.expense_date, ''YYYY-MM-DD'')';
        v_label := 'to_char(e.expense_date, ''DD Mon'')';
        v_sort  := 'min(e.expense_date::timestamp)';
      when 'week' then
        v_key   := 'to_char(date_trunc(''week'', e.expense_date::timestamp), ''IYYY-"W"IW'')';
        v_label := '''Wk '' || to_char(date_trunc(''week'', e.expense_date::timestamp), ''IW'')';
        v_sort  := 'min(date_trunc(''week'', e.expense_date::timestamp))';
      when 'month' then
        v_key   := 'to_char(e.expense_date, ''YYYY-MM'')';
        v_label := 'to_char(e.expense_date, ''Mon YYYY'')';
        v_sort  := 'min(date_trunc(''month'', e.expense_date::timestamp))';
      else
        null;
    end case;

  else
    v_from := 'public.purchases p
               left join public.suppliers sup on sup.id = p.supplier_id
               left join public.branches b    on b.id = p.branch_id';
    v_value := case p_measure
      when 'purchase_due' then 'round(sum(p.total - p.paid_total), 2)'
      else 'round(sum(p.total), 2)'
    end;
    v_second := 'count(*)::numeric';
    -- Purchases have no soft-delete column: a cancelled order stays in the
    -- book with CANCELLED, which is what a shop wants to see in the history.
    v_where  := format(
      ' where p.organization_id = %L
          and p.status <> ''DRAFT'' and p.created_at >= %L and p.created_at < %L%s',
      p_org, p_from, p_to,
      case when p_branch is not null then format(' and p.branch_id = %L', p_branch) else '' end
    );
    v_key   := replace(v_key, 's.created_at', 'p.created_at');
    v_label := replace(v_label, 's.created_at', 'p.created_at');
    v_sort  := replace(v_sort,  's.created_at', 'p.created_at');
  end if;

  -- Ranking dimensions sort by the measure itself, so that the caller can
  -- re-sort a page deterministically and the page the LIMIT kept is the top of
  -- the list rather than an arbitrary slice of it.
  --
  -- Time dimensions sort by `min(period)`. It looks redundant — every row in
  -- the group shares the period — but ORDER BY has to name something the
  -- GROUP BY produced, and a bare `date_trunc(...)` in the sort is an
  -- ungrouped column as far as Postgres is concerned.
  if v_order = 'value desc' then
    v_sort  := v_value;
    v_order := 'sort_key desc';
  end if;

  return format(
    'select %s as key, %s as label, %s as value, %s as secondary, %s as sort_key
       from %s
       %s
      group by 1, 2
      order by %s%s',
    v_key, v_label, v_value, v_second, v_sort, v_from, v_where, v_order,
    -- p_limit = 0 asks for the whole period: the caller uses it to total a
    -- series without shipping its rows. LIMIT 0 would mean "nothing", which is
    -- how a "total" quietly becomes zero.
    case when p_limit > 0 then format(' limit %s', p_limit) else '' end
  );
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. The period, in the branch's own time zone
-- ══════════════════════════════════════════════════════════════════════════
--
-- "Today" is today where the shop is, not where the server is (docs/09 #14).
-- A shop in Dhaka closing at 11pm must not see the last hour of trading fall
-- into tomorrow because the database runs in UTC.

create or replace function app.analytics_window(
  p_branch_id uuid,
  p_period    text,
  p_from      date default null,
  p_to        date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_tz text;
  v_currency char(3);
  v_today date;
  v_start date;
  v_end date;
  v_prev_start date;
  v_prev_end date;
begin
  select b.organization_id, coalesce(b.timezone, o.timezone), o.currency
    into v_org, v_tz, v_currency
    from public.branches b
    join public.organizations o on o.id = b.organization_id
   where b.id = p_branch_id;

  if v_org is null then
    raise exception 'branch_not_found: %', p_branch_id using errcode = 'P0002';
  end if;

  v_today := (now() at time zone v_tz)::date;

  case p_period
    when 'day' then
      v_start := v_today;                     v_end := v_today + 1;
      v_prev_start := v_today - 1;            v_prev_end := v_today;
    when 'week' then
      v_start := date_trunc('week', v_today::timestamp)::date;
      v_end   := v_start + 7;
      v_prev_start := v_start - 7;            v_prev_end := v_start;
    when 'month' then
      v_start := date_trunc('month', v_today::timestamp)::date;
      v_end   := (v_start + interval '1 month')::date;
      v_prev_start := (v_start - interval '1 month')::date; v_prev_end := v_start;
    when 'quarter' then
      v_start := date_trunc('quarter', v_today::timestamp)::date;
      v_end   := (v_start + interval '3 months')::date;
      v_prev_start := (v_start - interval '3 months')::date; v_prev_end := v_start;
    when 'year' then
      v_start := date_trunc('year', v_today::timestamp)::date;
      v_end   := (v_start + interval '1 year')::date;
      v_prev_start := (v_start - interval '1 year')::date;  v_prev_end := v_start;
    else  -- custom: the caller's dates, previous = the same span before it
      v_start := coalesce(p_from, v_today - 29);
      v_end   := coalesce(p_to, v_today) + 1;
      if v_end <= v_start then
        raise exception 'invalid_range: % to %', v_start, v_end using errcode = '22023';
      end if;
      v_prev_start := v_start - (v_end - v_start);
      v_prev_end   := v_start;
  end case;

  return jsonb_build_object(
    'org', v_org, 'timezone', v_tz, 'currency', v_currency,
    'today', v_today,
    'from', v_start, 'to', v_end,          -- [from, to) in branch-local dates
    'prev_from', v_prev_start, 'prev_to', v_prev_end,
    'label', case p_period
               when 'day'     then to_char(v_start, 'DD Mon YYYY')
               when 'week'    then 'Week ' || to_char(v_start, 'IW, YYYY')
               when 'month'   then to_char(v_start, 'Mon YYYY')
               when 'quarter' then 'Q' || to_char(v_start, 'Q YYYY')
               when 'year'    then to_char(v_start, 'YYYY')
               else to_char(v_start, 'DD Mon YYYY') || ' – ' || to_char(v_end - 1, 'DD Mon YYYY')
             end
  );
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. Run one slice, with the comparison period attached
-- ══════════════════════════════════════════════════════════════════════════
--
-- Internal: it performs no permission check of its own, so it stays revoked
-- from the client roles (018's rule). Every public entry point below is one
-- `require_permission` line plus a call to this.

create or replace function app.analytics_run(
  p_branch_id   uuid,
  p_dimension   text,
  p_measure     text,
  p_period      text     default 'month',
  p_from        date     default null,
  p_to          date     default null,
  p_filters     jsonb    default '{}'::jsonb,
  p_limit       int      default 200,
  p_with_totals boolean  default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_win    jsonb;
  v_org    uuid;
  v_tz text;
  v_currency text;
  v_from   timestamptz;
  v_to timestamptz;
  v_p_from timestamptz;
  v_p_to timestamptz;
  v_dir    text;
  v_rows   jsonb;
  v_prev jsonb;
  v_tot    numeric;
  v_tot_sec numeric;
  v_ptot   numeric;
  v_ptot_sec numeric;
  v_sql    text;
  v_psql text;
  v_out    jsonb;
begin
  v_win      := app.analytics_window(p_branch_id, p_period, p_from, p_to);
  v_org      := (v_win ->> 'org')::uuid;
  v_tz       := v_win ->> 'timezone';
  v_currency := v_win ->> 'currency';

  v_from   := ((v_win ->> 'from')::date::timestamp AT TIME ZONE v_tz);
  v_to     := ((v_win ->> 'to')::date::timestamp AT TIME ZONE v_tz);
  v_p_from := ((v_win ->> 'prev_from')::date::timestamp AT TIME ZONE v_tz);
  v_p_to   := ((v_win ->> 'prev_to')::date::timestamp AT TIME ZONE v_tz);

  -- Ranking dimensions read best biggest-first; time reads oldest-first.
  v_dir := case when p_dimension in ('category', 'product', 'variant', 'customer',
                                     'cashier', 'payment_method', 'branch',
                                     'expense_category', 'supplier')
                then 'desc' else 'asc' end;

  -- Rows and their totals are two statements: the totals must cover the whole
  -- period, not the page. `p_limit = 0` emits no LIMIT at all, so the total is
  -- a single aggregate pass with no rows leaving the server.
  if p_with_totals then
    execute format(
      'select coalesce(sum(r.value), 0), coalesce(sum(r.secondary), 0) from (%s) r',
      app.analytics_sql(p_dimension, p_measure, v_org, p_branch_id, v_from, v_to, v_tz, p_filters, 0)
    ) into v_tot, v_tot_sec;

    execute format(
      'select coalesce(sum(r.value), 0), coalesce(sum(r.secondary), 0) from (%s) r',
      app.analytics_sql(p_dimension, p_measure, v_org, p_branch_id, v_p_from, v_p_to, v_tz, p_filters, 0)
    ) into v_ptot, v_ptot_sec;
  end if;

  v_psql := app.analytics_sql(p_dimension, p_measure, v_org, p_branch_id,
                              v_p_from, v_p_to, v_tz, p_filters, 0);
  execute format('select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (%s) q', v_psql) into v_prev;

  v_sql := app.analytics_sql(p_dimension, p_measure, v_org, p_branch_id,
                             v_from, v_to, v_tz, p_filters, p_limit);
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
              ''key'', r.key, ''label'', r.label,
              ''value'', r.value, ''secondary'', r.secondary,
              ''prev'', coalesce(pm.value, 0), ''prev_secondary'', coalesce(pm.secondary, 0)
            ) order by r.sort_key %s, r.label), ''[]''::jsonb)
       from (%s) r
       left join (select * from jsonb_to_recordset(%L::jsonb)
                    as t(key text, value numeric, secondary numeric)) pm
              on pm.key = r.key',
    v_dir, v_sql, v_prev
  ) into v_rows;

  v_out := jsonb_build_object(
    'dimension', p_dimension,
    'measure', p_measure,
    'period', p_period,
    'label', (v_win ->> 'label'),
    'timezone', v_tz,
    'currency', v_currency,
    'from', v_win -> 'from',
    'to', v_win -> 'to',
    'previous', jsonb_build_object('from', v_win -> 'prev_from', 'to', v_win -> 'prev_to'),
    'series', v_rows
  );

  if p_with_totals then
    v_out := v_out || jsonb_build_object('totals', jsonb_build_object(
      'value', coalesce(v_tot, 0),
      'secondary', coalesce(v_tot_sec, 0),
      'prev', v_ptot,
      'prev_secondary', v_ptot_sec,
      'delta_pct', case
        when v_ptot is null then null
        when v_ptot = 0 then null
        else round((v_tot - v_ptot) / v_ptot * 100, 1)
      end
    ));
  end if;

  return v_out;
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. The questions the owner actually asks (spec §56)
-- ══════════════════════════════════════════════════════════════════════════
--
-- The dashboard is not a wall of numbers; it is the answers. Each item is one
-- question, the answer as the shop's own currency or a short phrase, a note
-- with the context that makes the number trustworthy, and the screen that
-- shows the detail. The answers are computed from the same engine as the
-- charts, so a chip and a bar can never disagree.

create or replace function app.bi_item(
  p_id       text,
  p_question text,
  p_kind     text,      -- money | count | qty | text — how to render `value`
  p_value    text,
  p_note     text,
  p_link     text,
  p_icon     text
)
returns jsonb
language sql
immutable
as $fn$
  select jsonb_build_object(
    'id', p_id, 'question', p_question, 'kind', p_kind,
    'value', p_value, 'note', p_note, 'link', p_link, 'icon', p_icon
  )
$fn$;

create or replace function app.bi_answers_internal(p_branch_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
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
  v_win  := app.analytics_window(p_branch_id, 'custom', p_day, p_day);
  v_org  := (v_win ->> 'org')::uuid;
  v_tz   := v_win ->> 'timezone';
  v_from := (p_day::timestamp AT TIME ZONE v_tz);
  v_to   := ((p_day + 1)::timestamp AT TIME ZONE v_tz);

  -- 1 · What did we take today?
  select coalesce(sum(s.total), 0), count(*) into v_day_takings, v_cnt
    from public.sales s
   where s.branch_id = p_branch_id and s.created_at >= v_from and s.created_at < v_to
     and s.status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED');
  select coalesce(avg(s.total), 0) into v_yday_avg
    from public.sales s
   where s.branch_id = p_branch_id
     and s.created_at >= ((p_day - 1)::timestamp AT TIME ZONE v_tz)
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
  v_r := app.analytics_run(p_branch_id, 'payment_method', 'takings', 'custom', p_day, p_day, '{}'::jsonb, 6, false);
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
   where e.branch_id = p_branch_id and e.expense_date = p_day and e.deleted_at is null;
  v_r := app.analytics_run(p_branch_id, 'expense_category', 'expenses', 'month', null, null, '{}'::jsonb, 1, false);
  v_out := v_out || jsonb_build_array(app.bi_item(
    'spend_today', 'What did we spend today?', 'money', v_money::text,
    format('%s expense entr(ies)', v_cnt::int)
      || case when jsonb_array_length(v_r -> 'series') = 0 then ''
              else format(' · biggest category this month: %s', v_r -> 'series' -> 0 ->> 'label') end,
    '/expenses', 'receipt_long'));

  -- 11 · When is the shop busy?
  v_r := app.analytics_run(p_branch_id, 'hour', 'takings', 'custom', p_day, p_day, '{}'::jsonb, 24, false);
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
  v_r := app.analytics_run(p_branch_id, 'day', 'refunds', 'custom', p_day, p_day, '{}'::jsonb, 1, true);
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

-- ══════════════════════════════════════════════════════════════════════════
-- 6. The public API
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.analytics_query(
  p_branch_id uuid,
  p_dimension text default 'day',
  p_measure   text default 'takings',
  p_period    text default 'month',
  p_from      date default null,
  p_to        date default null,
  p_filters   jsonb default '{}'::jsonb,
  p_limit     int default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare v_win jsonb;
begin
  v_win := app.analytics_window(p_branch_id, p_period, p_from, p_to);
  perform app.require_org((v_win ->> 'org')::uuid);
  perform app.require_permission('analytics.view');
  return app.analytics_run(p_branch_id, p_dimension, p_measure, p_period, p_from, p_to,
                           p_filters, least(greatest(p_limit, 1), 500))
         || jsonb_build_object('answers', public.bi_answers(p_branch_id, (v_win ->> 'today')::date));
end
$fn$;

create or replace function public.bi_answers(p_branch_id uuid, p_day date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare v_win jsonb;
begin
  v_win := app.analytics_window(p_branch_id, 'custom', p_day, p_day);
  perform app.require_org((v_win ->> 'org')::uuid);

  -- Either screen may show the answers: the dashboard is where an owner meets
  -- them, the analytics screen is where they dig in. A role that holds one
  -- permission but not the other still gets its questions answered.
  if not (app.has_permission('dashboard.view') or app.has_permission('analytics.view')) then
    raise exception 'permission_denied: %', 'dashboard.view' using errcode = '42501';
  end if;

  return app.bi_answers_internal(p_branch_id, p_day);
end
$fn$;

-- ── The dashboard, now built on the engine ────────────────────────────────
--
-- 016's function computed the eight widgets by hand; it keeps that job (the
-- widgets are unchanged and still the one definition of each number) but moves
-- to `app` so that this wrapper can add what Phase 5 needs — the trend lines,
-- the rankings and the answers — without copying any of it. Everything the
-- client sees still arrives from a single call (docs/09 #10).

alter function public.dashboard_summary(uuid, date) set schema app;
alter function app.dashboard_summary(uuid, date) rename to dashboard_widgets;

revoke execute on function app.dashboard_widgets(uuid, date) from public, anon, authenticated;

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
  v_org uuid;
  v_out jsonb;
begin
  v_out := app.dashboard_widgets(p_branch_id, p_day);   -- checks org + dashboard.view

  select b.organization_id into v_org
    from public.branches b where b.id = p_branch_id;

  return v_out || jsonb_build_object(
    'answers', public.bi_answers(p_branch_id, p_day),

    -- Thirty days of takings and profit for the trend chart; two statements
    -- each, both aggregates, no rows travelling.
    'trend_days', app.analytics_run(p_branch_id, 'day', 'takings', 'custom',
                                    p_day - 29, p_day, '{}'::jsonb, 31, false),
    'trend_profit', app.analytics_run(p_branch_id, 'day', 'profit', 'custom',
                                      p_day - 29, p_day, '{}'::jsonb, 31, false),
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
-- 7. What can be asked
-- ══════════════════════════════════════════════════════════════════════════
--
-- The pickers on the analytics screen are built from this, not from a list
-- written in TypeScript. The supported (measure × dimension) pairs come from
-- the same matrix the generator uses, so a combination that would answer
-- `unsupported_combination` is never offered in the first place — and adding
-- a measure here makes it selectable without touching the client.

create or replace function app.measure_meta(p_measure text)
returns jsonb
language sql
immutable
as $fn$
  select jsonb_build_object(
    'id', p_measure,
    'label', case p_measure
      when 'takings'       then 'Takings'
      when 'orders'        then 'Orders'
      when 'items'         then 'Units sold'
      when 'avg_order'     then 'Average bill'
      when 'profit'        then 'Profit'
      when 'revenue'       then 'Revenue (excl. tax)'
      when 'cogs'          then 'Cost of goods'
      when 'discount'      then 'Discount given'
      when 'tax'           then 'Tax collected'
      when 'refunds'       then 'Refunds'
      when 'expenses'      then 'Expenses'
      when 'purchases'     then 'Purchases'
      when 'purchase_due'  then 'Still owed to suppliers'
    end,
    'money', p_measure <> all (array['orders', 'items']),
    'unit', case
      when p_measure = 'orders' then 'bills'
      when p_measure = 'items' then 'units'
      when p_measure = 'refunds' then 'money'
      when p_measure = 'expenses' then 'money'
      else 'money' end,
    'description', case p_measure
      when 'takings'   then 'Money through the till, tax included.'
      when 'revenue'   then 'Takings with the tax taken out — what the shop actually earned.'
      when 'profit'    then 'Revenue minus the cost of the goods sold.'
      when 'orders'    then 'How many bills were closed.'
      when 'items'     then 'How many units left the shop.'
      when 'avg_order' then 'Takings divided by orders.'
      when 'cogs'      then 'Weighted average cost of the goods sold.'
      when 'discount'  then 'Line discounts and order discounts together.'
      when 'tax'       then 'Collected on behalf of the government.'
      when 'refunds'   then 'Money returned to customers.'
      when 'expenses'  then 'Money spent on everything that is not stock.'
      when 'purchases' then 'Stock bought from suppliers.'
      when 'purchase_due' then 'Purchase value not yet paid.'
    end
  )
$fn$;

create or replace function app.dimension_meta(p_dimension text)
returns jsonb
language sql
immutable
as $fn$
  select jsonb_build_object(
    'id', p_dimension,
    'label', case p_dimension
      when 'day' then 'Day' when 'week' then 'Week' when 'month' then 'Month'
      when 'hour' then 'Hour of day' when 'weekday' then 'Day of week'
      when 'category' then 'Category' when 'product' then 'Product'
      when 'variant' then 'Variant' when 'customer' then 'Customer'
      when 'cashier' then 'Cashier' when 'payment_method' then 'Payment method'
      when 'branch' then 'Branch' when 'expense_category' then 'Expense category'
      when 'supplier' then 'Supplier'
    end,
    'group', case
      when p_dimension in ('day', 'week', 'month', 'hour', 'weekday') then 'Time'
      when p_dimension in ('category', 'product', 'variant') then 'Catalogue'
      when p_dimension in ('customer', 'cashier', 'supplier', 'branch') then 'People'
      when p_dimension = 'payment_method' then 'Money'
      else 'Money' end,
    'kind', case
      when p_dimension in ('day', 'week', 'month', 'hour', 'weekday') then 'time'
      when p_dimension in ('customer', 'cashier', 'supplier', 'branch') then 'entity'
      else 'entity' end
  )
$fn$;

create or replace function public.analytics_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_measures text[] := array['takings', 'orders', 'items', 'avg_order', 'profit',
                             'revenue', 'cogs', 'discount', 'tax', 'refunds',
                             'expenses', 'purchases', 'purchase_due'];
  v_dimensions text[] := array['day', 'week', 'month', 'hour', 'weekday',
                               'category', 'product', 'variant', 'customer',
                               'cashier', 'payment_method', 'branch',
                               'expense_category', 'supplier'];
  v_measures_out jsonb := '[]'::jsonb;
  v_dimensions_out jsonb := '[]'::jsonb;
  v_combos jsonb := '[]'::jsonb;
  m text;
  d text;
begin
  perform app.require_permission('analytics.view');

  foreach m in array v_measures loop
    v_measures_out := v_measures_out || jsonb_build_array(app.measure_meta(m));
  end loop;

  foreach d in array v_dimensions loop
    v_dimensions_out := v_dimensions_out || jsonb_build_array(app.dimension_meta(d));
  end loop;

  foreach m in array v_measures loop
    foreach d in array v_dimensions loop
      if app.analytics_family(m, d) is not null then
        v_combos := v_combos || jsonb_build_array(
          jsonb_build_object('measure', m, 'dimension', d)
        );
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'measures', v_measures_out,
    'dimensions', v_dimensions_out,
    'periods', jsonb_build_array(
      jsonb_build_object('id', 'day', 'label', 'Today'),
      jsonb_build_object('id', 'week', 'label', 'This week'),
      jsonb_build_object('id', 'month', 'label', 'This month'),
      jsonb_build_object('id', 'quarter', 'label', 'This quarter'),
      jsonb_build_object('id', 'year', 'label', 'This year'),
      jsonb_build_object('id', 'custom', 'label', 'Custom range')
    ),
    'combos', v_combos
  );
end
$fn$;

-- ── Grants (018's rule: reachable by name, authorized by permission) ──────
revoke execute on function app.analytics_family(text, text) from public, anon, authenticated;
revoke execute on function app.analytics_sql(text, text, uuid, uuid, timestamptz, timestamptz, text, jsonb, int)
  from public, anon, authenticated;
revoke execute on function app.analytics_window(uuid, text, date, date) from public, anon, authenticated;
revoke execute on function app.analytics_run(uuid, text, text, text, date, date, jsonb, int, boolean)
  from public, anon, authenticated;
revoke execute on function app.bi_answers_internal(uuid, date) from public, anon, authenticated;
revoke execute on function app.bi_item(text, text, text, text, text, text, text) from public, anon, authenticated;

revoke execute on function app.measure_meta(text) from public, anon, authenticated;
revoke execute on function app.dimension_meta(text) from public, anon, authenticated;

grant execute on function public.analytics_query(uuid, text, text, text, date, date, jsonb, int)
  to authenticated;
grant execute on function public.analytics_catalog() to authenticated;
grant execute on function public.bi_answers(uuid, date) to authenticated;
grant execute on function public.dashboard_summary(uuid, date) to authenticated;
