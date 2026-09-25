-- Weighing scale — the numbers, in SQL.
--
-- This plugin's *reading* is not here. A scale label is decoded in the browser
-- (`src/plugins/weight-scale/helpers.ts`) because the seam that makes any of
-- this possible — `PluginAPI.registerScanResolver` — is a decode-only contract:
-- a resolver is handed a code and hands back a code, which the core then looks
-- up in the shop's own barcode table. What can only be done here is arithmetic
-- over what already happened: what left the shop by weight, and which of the
-- things the shop sells by weight its own scale cannot ring up at all.
--
-- There is no table here, and that is deliberate. Every fact this plugin needs
-- already lives in core data: a variant's code is `product_barcodes`, its price
-- is `product_variants.price_override` falling back to `products.selling_price`,
-- a weighed line is a `sale_items` row whose product's unit is decimal
-- (`product_units.is_decimal`), and the shop's label layouts are
-- `plugins.config.label_formats` — the same JSONB the Settings screen writes and
-- the till reads. A `plg_weight_scale_*` copy of the catalogue would be a second
-- answer to "what does this shop sell, for how much, and by which code", and the
-- two answers would disagree the first time a price changed (spec §51).
--
-- Two entry points, both reads: `weight_scale_report` (the two reports) and
-- `weight_scale_overview` (the dashboard tile). Neither writes anything, so a
-- grocery can install this plugin, look at it, and change nothing about its
-- shop until it decides to.
--
-- The shop's label layouts are **data**, not code, because two scales in one
-- shop routinely disagree: the produce scale prints `22` + five PLU digits +
-- five grams, the meat counter's prints `21` + four + five, and neither is
-- wrong. What is *not* configurable is the meaning of the digits — a weight
-- field is grams, a price field is minor units, and PLUs are matched exactly as
-- the scale prints them. A shop that wants a layout the shopkeeper cannot
-- describe in these terms is a shop that needs a different plugin, not a switch
-- nobody understands.

-- ── The shop's own label layouts ──────────────────────────────────────────
-- Read from `plugins.config` — the same place the Settings screen and the
-- plugin's own screen write — so the layout a report was built from is the
-- layout the till is using.

-- What the shop filled in, with nothing invented.
create or replace function app.weight_scale_config(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_config jsonb := '{}'::jsonb;
begin
  select p.config into v_config
    from public.plugins p
   where p.organization_id = p_organization_id
     and p.plugin_key = 'weight-scale';

  return coalesce(v_config, '{}'::jsonb);
end
$fn$;

-- One layout, cleaned up, or null if a shopkeeper's typo leaves nothing usable.
--
-- A layout is: an in-store prefix, the number of digits the scale uses for the
-- product's PLU, the number of digits it uses for the weight or price, whether
-- the label carries a trailing check digit (a real EAN-13 does), and what those
-- value digits mean. Clamping here rather than in the editor means a hand-edited
-- `plugins.config` cannot make the till read a label wrongly — it can only make
-- a layout unusable, which is visible.
create or replace function app.weight_scale_format(p_format jsonb)
returns jsonb
language plpgsql
immutable
as $fn$
declare
  v_prefix text := regexp_replace(coalesce(p_format ->> 'prefix', ''), '[^0-9]', '', 'g');
  v_plu    integer;
  v_value  integer;
  v_kind   text := lower(coalesce(p_format ->> 'value_kind', p_format ->> 'valueKind', 'weight'));
  v_check  boolean;
begin
  if v_prefix = '' or length(v_prefix) > 4 then return null; end if;

  v_plu := coalesce(nullif(regexp_replace(coalesce(p_format ->> 'plu_digits',
                 p_format ->> 'pluDigits', ''), '[^0-9]', '', 'g'), '')::int, 0);
  v_value := coalesce(nullif(regexp_replace(coalesce(p_format ->> 'value_digits',
                   p_format ->> 'valueDigits', ''), '[^0-9]', '', 'g'), '')::int, 0);

  if v_plu < 1 or v_plu > 8 then return null; end if;
  if v_value < 1 or v_value > 6 then return null; end if;

  if v_kind not in ('weight', 'price') then return null; end if;

  v_check := case lower(coalesce(p_format ->> 'check_digit', p_format ->> 'checkDigit', 'false'))
               when 'true' then true when 't' then true when '1' then true
               when 'yes' then true else false end;

  return jsonb_build_object(
    'id',           coalesce(nullif(btrim(p_format ->> 'id'), ''), v_prefix || '-' || v_plu || '-' || v_value),
    'name',         coalesce(nullif(btrim(p_format ->> 'name'), ''), 'Label'),
    'prefix',       v_prefix,
    'plu_digits',   v_plu,
    'value_digits', v_value,
    'value_kind',   v_kind,
    'check_digit',  v_check,
    'total_digits', length(v_prefix) + v_plu + v_value + (case when v_check then 1 else 0 end)
  );
end
$fn$;

-- The built-in layout, used until the shop describes its own.
--
-- This mirrors `DEFAULT_FORMATS[0]` in `helpers.ts` exactly: the standard
-- in-store label every scale can be programmed to print (EAN-13, prefix 2x,
-- five PLU digits, five value digits, check digit), reading the value as grams.
-- A shop that installs this plugin and does nothing else can weigh lentils
-- today; the moment it tells us what its scale really prints, the shop's own
-- layout wins. Keep the two in step — `weight-scale.test.ts` pins the halves.
create or replace function app.weight_scale_default_format()
returns jsonb
language sql
immutable
as $fn$
  select jsonb_build_object(
    'id', 'standard', 'name', 'Standard in-store label',
    'prefix', '22', 'plu_digits', 5, 'value_digits', 5,
    'value_kind', 'weight', 'check_digit', true, 'total_digits', 13,
    'builtin', true
  )
$fn$;

-- Every usable layout this shop has, or the built-in one.
create or replace function app.weight_scale_formats(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_raw    jsonb;
  v_format jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_seen   jsonb := '[]'::jsonb;
begin
  v_raw := app.weight_scale_config(p_org) -> 'formats';

  if jsonb_typeof(v_raw) = 'array' then
    for v_format in select value from jsonb_array_elements(v_raw)
    loop
      v_format := app.weight_scale_format(v_format);
      -- Two layouts with the same id would make "which layout read this?" a
      -- coin toss; first one wins, the way the till reads them in order.
      if v_format is not null and not (v_seen @> jsonb_build_array(v_format ->> 'id')) then
        v_seen := v_seen || jsonb_build_array(v_format ->> 'id');
        v_out  := v_out || jsonb_build_array(v_format);
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_out) = 0 then
    return jsonb_build_array(app.weight_scale_default_format());
  end if;

  return v_out;
end
$fn$;

-- Could this layout have printed this code, and which part of it is the code to
-- keep?
--
--  · `plu`   — the shop entered the product's PLU exactly as the scale prints
--              it: scanning a label finds the product. This is the goal.
--  · `label` — the shop entered a *whole* label (thirteen digits) as the
--              product's code. It happens, it is invisible until a cashier
--              scans one, and the PLU inside it is what should have been kept.
--  · null    — not this layout.
--
-- A code is treated as digits only: a scale label is a number, and a shop that
-- has typed spaces or a hyphen into a PLU has a code the scanner will never
-- match, so the honest answer is "not printable" rather than a fuzzy match.
create or replace function app.weight_scale_fits(p_format jsonb, p_code text)
returns text
language plpgsql
immutable
as $fn$
declare
  v_code text := btrim(coalesce(p_code, ''));
begin
  if v_code = '' or v_code !~ '^[0-9]+$' then return null; end if;

  if length(v_code) = (p_format ->> 'plu_digits')::int then
    return 'plu';
  end if;

  if length(v_code) = (p_format ->> 'total_digits')::int
     and v_code like (p_format ->> 'prefix') || '%' then
    return 'label';
  end if;

  return null;
end
$fn$;

-- The PLU inside a code a layout could have printed — what the shop should keep.
create or replace function app.weight_scale_plu(p_format jsonb, p_code text)
returns text
language plpgsql
immutable
as $fn$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_kind text;
begin
  v_kind := app.weight_scale_fits(p_format, v_code);
  if v_kind = 'plu' then return v_code; end if;
  if v_kind = 'label' then
    return substr(v_code, length(p_format ->> 'prefix') + 1, (p_format ->> 'plu_digits')::int);
  end if;
  return null;
end
$fn$;

-- ── The window ────────────────────────────────────────────────────────────
--
-- The same six buttons the core reports use (`day` … `year`, `custom`), turned
-- into a half-open range of **branch-local** days: `[from, to)`.
--
-- This is a copy of `app.analytics_window`'s case, not a call to it, because a
-- plugin's report may be asked for the whole shop (no branch) and
-- `analytics_window` needs one to find its timezone. The timezone question is
-- the one that matters here: a grocery's evening trade must land on the evening
-- it happened in *Dhaka*, not in UTC, or a report run after 6 pm would quietly
-- lose the day's weighing (`20:00 UTC` is already tomorrow).
create or replace function app.weight_scale_window(
  p_org    uuid,
  p_branch uuid,
  p_period text,
  p_from   date,
  p_to     date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_tz    text;
  v_today date;
  v_start date;
  v_end   date;
begin
  select coalesce(b.timezone, o.timezone)
    into v_tz
    from public.organizations o
    left join public.branches b on b.id = p_branch and b.organization_id = o.id
   where o.id = p_org;

  if v_tz is null then
    raise exception 'org_not_found: %', p_org using errcode = 'P0002';
  end if;

  v_today := (now() at time zone v_tz)::date;

  case lower(coalesce(p_period, 'month'))
    when 'day'     then v_start := v_today;
                        v_end   := v_today + 1;
    when 'week'    then v_start := date_trunc('week', v_today::timestamp)::date;
                        v_end   := v_start + 7;
    when 'quarter' then v_start := date_trunc('quarter', v_today::timestamp)::date;
                        v_end   := (v_start + interval '3 months')::date;
    when 'year'    then v_start := date_trunc('year', v_today::timestamp)::date;
                        v_end   := (v_start + interval '1 year')::date;
    when 'custom'  then v_start := coalesce(p_from, v_today - 29);
                        v_end   := coalesce(p_to, v_today) + 1;
    else                v_start := date_trunc('month', v_today::timestamp)::date;
                        v_end   := (v_start + interval '1 month')::date;
  end case;

  if v_end <= v_start then
    raise exception 'invalid_range: % to %', v_start, v_end using errcode = '22023';
  end if;

  return jsonb_build_object(
    'timezone', v_tz, 'today', v_today, 'from', v_start, 'to', v_end,
    'label', case lower(coalesce(p_period, 'month'))
               when 'day'     then to_char(v_start, 'DD Mon YYYY')
               when 'week'    then 'Week ' || to_char(v_start, 'IW, YYYY')
               when 'quarter' then 'Q' || to_char(v_start, 'Q YYYY')
               when 'year'    then to_char(v_start, 'YYYY')
               when 'custom'  then to_char(v_start, 'DD Mon YYYY') || ' – ' || to_char(v_end - 1, 'DD Mon YYYY')
               else to_char(v_start, 'Mon YYYY')
             end
  );
end
$fn$;

-- ── What left the shop by weight ──────────────────────────────────────────
--
-- One row per product that sold by weight, biggest flow first, because that is
-- the order a shopkeeper reads: what moved, how much of it, what it earned.
--
-- "Sold by weight" is decided by the product's **unit** (`is_decimal`), not by
-- whether a quantity happened to have a fraction: 1.000 kg of rice is a weight
-- sale, and 2 tins of milk is not, and the till already agrees with both because
-- the same flag drives its step size and its keypad.
--
-- Returns are subtracted, not ignored: `returned_qty` is what came back, and a
-- report that counted it as sold would overstate exactly the figure a shopkeeper
-- uses to decide how much to buy next week.
create or replace function app.weight_scale_sales(p_org uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_win    jsonb;
  v_from   date;
  v_to     date;
  v_search text := nullif(btrim(coalesce(p_args ->> 'search', '')), '');
  v_limit  integer := greatest(1, least(1000, coalesce((p_args ->> 'limit')::int, 200)));
  v_offset integer := greatest(0, coalesce((p_args ->> 'offset')::int, 0));
  v_rows   jsonb;
  v_total  integer;
  v_totals jsonb;
begin
  v_win  := app.weight_scale_window(p_org, nullif(p_args ->> 'branch_id', '')::uuid,
                                    p_args ->> 'period', nullif(p_args ->> 'from', '')::date,
                                    nullif(p_args ->> 'to', '')::date);
  v_from := (v_win ->> 'from')::date;
  v_to   := (v_win ->> 'to')::date;

  with lines as (
    select si.product_id,
           si.product_name,
           coalesce(si.sku, '')                             as sku,
           coalesce(si.unit_label, '')                      as unit_label,
           si.quantity - si.returned_qty                    as net_qty,
           round(si.line_total * (si.quantity - si.returned_qty) / nullif(si.quantity, 0), 2) as net_value,
           round(si.line_cogs  * (si.quantity - si.returned_qty) / nullif(si.quantity, 0), 2) as net_cost
      from public.sale_items si
      join public.sales sa on sa.id = si.sale_id
      join public.products pr on pr.id = si.product_id
      left join public.product_units u on u.id = pr.unit_id
     where si.organization_id = p_org
       and sa.organization_id = p_org
       and sa.status in ('COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED')
       and coalesce(u.is_decimal, false)
       and (sa.created_at at time zone (v_win ->> 'timezone'))::date >= v_from
       and (sa.created_at at time zone (v_win ->> 'timezone'))::date <  v_to
       and (nullif(p_args ->> 'branch_id', '') is null or sa.branch_id = (p_args ->> 'branch_id')::uuid)
       and (v_search is null
            or si.product_name ilike '%' || v_search || '%'
            or coalesce(si.sku, '') ilike '%' || v_search || '%')
  ),
  grouped as (
    select product_id,
           min(product_name)                       as product_name,
           max(sku)                                as sku,
           max(unit_label)                         as unit_label,
           count(*)::int                           as lines,
           sum(net_qty)                            as qty,
           sum(net_value)                          as value,
           sum(net_cost)                           as cost
      from lines
     group by product_id
  )
  select coalesce(jsonb_agg(entry order by sort_qty desc, sort_name), '[]'::jsonb), count(*)::int
    into v_rows, v_total
    from (
      select jsonb_build_object(
               'product_id', product_id,
               'product',    product_name,
               'sku',        sku,
               'unit',       unit_label,
               'lines',      lines,
               'qty',        round(qty, 3),
               'avg_qty',    round(qty / nullif(lines, 0), 3),
               'value_minor', coalesce(round(value * 100), 0)::bigint,
               'margin_minor', coalesce(round((value - cost) * 100), 0)::bigint
             ) as entry,
             qty as sort_qty,
             product_name as sort_name
        from grouped
       order by qty desc, product_name
       limit v_limit offset v_offset
    ) page;

  select jsonb_build_object(
           'products', count(distinct product_id)::int,
           'lines',    coalesce(sum(lines), 0)::int,
           'qty',      round(coalesce(sum(qty), 0), 3),
           'value_minor',  coalesce(round(sum(value) * 100), 0)::bigint,
           'margin_minor', coalesce(round(sum(value - cost) * 100), 0)::bigint
         )
    into v_totals
    from (
      select si.product_id,
             count(*)::int as lines,
             sum(si.quantity - si.returned_qty) as qty,
             sum(round(si.line_total * (si.quantity - si.returned_qty) / nullif(si.quantity, 0), 2)) as value,
             sum(round(si.line_cogs  * (si.quantity - si.returned_qty) / nullif(si.quantity, 0), 2)) as cost
        from public.sale_items si
        join public.sales sa on sa.id = si.sale_id
        join public.products pr on pr.id = si.product_id
        left join public.product_units u on u.id = pr.unit_id
       where si.organization_id = p_org
         and sa.organization_id = p_org
         and sa.status in ('COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED')
         and coalesce(u.is_decimal, false)
         and (sa.created_at at time zone (v_win ->> 'timezone'))::date >= v_from
         and (sa.created_at at time zone (v_win ->> 'timezone'))::date <  v_to
         and (nullif(p_args ->> 'branch_id', '') is null or sa.branch_id = (p_args ->> 'branch_id')::uuid)
         and (v_search is null
              or si.product_name ilike '%' || v_search || '%'
              or coalesce(si.sku, '') ilike '%' || v_search || '%')
       group by si.product_id
    ) all_rows;

  return jsonb_build_object(
    'type', 'sales', 'rows', v_rows, 'total', v_total,
    'limit', v_limit, 'offset', v_offset, 'totals', v_totals,
    'from', v_win -> 'from', 'to', v_win -> 'to', 'label', v_win -> 'label',
    'timezone', v_win ->> 'timezone'
  );
end
$fn$;

-- ── What the scale cannot ring up ─────────────────────────────────────────
--
-- The weight-scale question a shopkeeper cannot answer by looking at shelves:
-- *which of the things I sell by weight will my scale fail to sell today?*
--
-- Four ways a weighed item fails at the till, and one way it succeeds:
--
--   · `ready`       the product carries a code the scale can print, as a PLU.
--   · `whole_label` the shop pasted a whole thirteen-digit label in as the code.
--                   It scans… if the scale ever prints that exact weight again.
--   · `other_code`  the code is not one the shop's layouts can print (a factory
--                   EAN on a loose item, a mistyped PLU): scanning a label finds
--                   nothing.
--   · `no_code`     nothing to print: the scale has no PLU for this product, so
--                   no label can ever ring it up. The cashier has to search for
--                   it by name, which is exactly what this plugin exists to stop.
--   · `by_piece`    the product has a code that *looks* like a PLU but is sold by
--                   the piece: scanning a label rings up one piece at the piece
--                   price, which is the only failure here that charges the wrong
--                   money rather than none.
--
-- Rows are ordered worst first, because this is a worklist, not a catalogue.
create or replace function app.weight_scale_codes(p_org uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_formats jsonb := app.weight_scale_formats(p_org);
  v_search  text := nullif(btrim(coalesce(p_args ->> 'search', '')), '');
  v_scope   text := lower(coalesce(nullif(p_args ->> 'scope', ''), 'all'));
  v_limit   integer := greatest(1, least(1000, coalesce((p_args ->> 'limit')::int, 200)));
  v_offset  integer := greatest(0, coalesce((p_args ->> 'offset')::int, 0));
  v_out     jsonb := '{}'::jsonb;
begin
  with fmts as (
    select value as f from jsonb_array_elements(v_formats)
  ),
  variants as (
    select pv.id                                        as variant_id,
           p.id                                         as product_id,
           p.name                                       as product_name,
           coalesce(pv.name_suffix, '')                 as variant_name,
           coalesce(pv.sku, p.sku, '')                  as sku,
           coalesce(u.symbol, '')                       as unit,
           coalesce(u.is_decimal, false)                as by_weight,
           coalesce(pv.price_override, p.selling_price) as price,
           (select count(*)::int from public.product_barcodes b
             where b.organization_id = p_org and b.variant_id = pv.id) as code_count,
           fits.rank      as fit_rank,
           fits.scan_code as scan_code,
           fits.use_code  as use_code,
           fits.fit_name  as fit_name
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      left join public.product_units u on u.id = p.unit_id
      left join lateral (
        select min(m.rank) as rank,
               (array_agg(m.code     order by m.rank, m.is_primary desc, m.code))[1] as scan_code,
               (array_agg(m.plu      order by m.rank, m.is_primary desc, m.code))[1] as use_code,
               (array_agg(m.fit_name order by m.rank, m.is_primary desc, m.code))[1] as fit_name
          from (
            select b.code,
                   b.is_primary,
                   case app.weight_scale_fits(f.f, b.code) when 'plu' then 1 else 2 end as rank,
                   coalesce(app.weight_scale_plu(f.f, b.code), b.code) as plu,
                   coalesce(f.f ->> 'name', 'Label') as fit_name
              from public.product_barcodes b
              cross join fmts f
             where b.organization_id = p_org
               and b.variant_id = pv.id
               and app.weight_scale_fits(f.f, b.code) is not null
          ) m
      ) fits on true
     where pv.organization_id = p_org
       and pv.deleted_at is null and pv.is_active
       and p.deleted_at is null and p.is_active
  ),
  judged as (
    select *,
           case
             when not by_weight and fit_rank is not null then 'by_piece'
             when by_weight and code_count = 0            then 'no_code'
             when by_weight and fit_rank = 1              then 'ready'
             when by_weight and fit_rank = 2              then 'whole_label'
             when by_weight                                then 'other_code'
             else 'by_piece'
           end as status,
           case
             when not by_weight and fit_rank is not null then 1
             when by_weight and code_count = 0            then 2
             when by_weight and fit_rank = 2              then 3
             when by_weight and fit_rank is null          then 4
             else 5
           end as severity
      from variants
     where by_weight or fit_rank is not null
  ),
  ranked as (
    select *
      from judged
     where (v_scope = 'all'
            or (v_scope = 'attention' and status <> 'ready')
            or v_scope = status)
       and (v_search is null
            or product_name ilike '%' || v_search || '%'
            or variant_name ilike '%' || v_search || '%'
            or sku ilike '%' || v_search || '%')
  ),
  page as (
    select coalesce(jsonb_agg(entry order by severity, product_name, variant_name), '[]'::jsonb) as rows,
           count(*)::int as total
      from (
        select jsonb_build_object(
                 'variant_id',  variant_id,
                 'product_id',  product_id,
                 'product',     product_name,
                 'variant',     variant_name,
                 'sku',         sku,
                 'unit',        unit,
                 'price_minor', coalesce(round(price * 100), 0)::bigint,
                 'status',      status,
                 'code',        coalesce(scan_code, ''),
                 'use_code',    coalesce(use_code, ''),
                 'layout',      coalesce(fit_name, '')
               ) as entry,
               severity, product_name, variant_name
          from ranked
         order by severity, product_name, variant_name
         limit v_limit offset v_offset
      ) limited
  ),
  counted as (
    select count(*)::int                                      as all_rows,
           count(*) filter (where status = 'ready')::int       as ready,
           count(*) filter (where status <> 'ready')::int      as attention,
           count(*) filter (where status = 'no_code')::int     as no_code,
           count(*) filter (where status = 'by_piece')::int    as by_piece,
           count(*) filter (where status = 'other_code')::int  as other_code,
           count(*) filter (where status = 'whole_label')::int as whole_label
      from judged
  )
  select jsonb_build_object(
           'type', 'codes', 'rows', page.rows, 'total', page.total,
           'limit', v_limit, 'offset', v_offset,
           'totals', jsonb_build_object(
             'all',         counted.all_rows,
             'ready',       counted.ready,
             'attention',   counted.attention,
             'no_code',     counted.no_code,
             'by_piece',    counted.by_piece,
             'other_code',  counted.other_code,
             'whole_label', counted.whole_label
           ),
           'formats', v_formats
         )
    into v_out
    from page, counted;

  return v_out;
end
$fn$;

-- ── The two reports ───────────────────────────────────────────────────────
--
-- `weight_scale_report` is one entry point with two subjects, the way the
-- warranty plugin's report is: the till's reports screen asks a plugin by id,
-- and a shop does not install half a plugin.
create or replace function public.weight_scale_report(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org  uuid := p_organization_id;
  v_type text := lower(coalesce(nullif(p_args ->> 'type', ''), 'sales'));
begin
  perform app.require_org(v_org);
  perform app.require_permission('weight-scale.view');

  if v_type = 'sales' then
    return app.weight_scale_sales(v_org, p_args);
  end if;

  if v_type = 'codes' then
    return app.weight_scale_codes(v_org, p_args);
  end if;

  raise exception 'weight_scale_unknown_report: %', v_type using errcode = '22023';
end
$fn$;

-- ── The dashboard tile ────────────────────────────────────────────────────
--
-- Two numbers a grocery acts on: how much went over the counter by weight this
-- month, and how many weighed items the scale cannot sell. The first is the size
-- of the weighed half of the business; the second is the work.
--
-- A tile is drawn on every dashboard, so it asks for one page of one row: the
-- counts come from `weight_scale_codes`, which is already the only place that
-- knows how many variants are ready and how many are not.
create or replace function app.weight_scale_moved(
  p_org    uuid,
  p_branch uuid,
  p_from   date,
  p_to     date,
  p_tz     text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
           'lines', count(*)::int,
           'qty',   round(coalesce(sum(si.quantity - si.returned_qty), 0), 3)
         )
    from public.sale_items si
    join public.sales sa on sa.id = si.sale_id
    join public.products pr on pr.id = si.product_id
    left join public.product_units u on u.id = pr.unit_id
   where si.organization_id = p_org
     and sa.organization_id = p_org
     and sa.status in ('COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED')
     and coalesce(u.is_decimal, false)
     and (sa.created_at at time zone p_tz)::date >= p_from
     and (sa.created_at at time zone p_tz)::date <  p_to
     and (p_branch is null or sa.branch_id = p_branch)
$fn$;

create or replace function public.weight_scale_overview(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org     uuid := p_organization_id;
  v_branch  uuid := nullif(p_args ->> 'branch_id', '')::uuid;
  v_month   jsonb;
  v_today   jsonb;
  v_period  jsonb;
  v_day     jsonb;
  v_codes   jsonb;
  v_formats jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('weight-scale.view');

  v_period := app.weight_scale_window(v_org, v_branch, 'month', null, null);
  v_day    := app.weight_scale_window(v_org, v_branch, 'day', null, null);

  v_month := app.weight_scale_moved(v_org, v_branch, (v_period ->> 'from')::date,
                                    (v_period ->> 'to')::date, v_period ->> 'timezone');
  v_today := app.weight_scale_moved(v_org, v_branch, (v_day ->> 'from')::date,
                                    (v_day ->> 'to')::date, v_day ->> 'timezone');

  -- One row is enough: the counts are computed over every variant regardless of
  -- the page, which is the whole point of asking for them here.
  v_codes   := app.weight_scale_codes(v_org, jsonb_build_object('limit', 1));
  v_formats := app.weight_scale_formats(v_org);

  return jsonb_build_object(
    'month',         v_month,
    'month_label',   v_period -> 'label',
    'today',         v_today,
    'codes',         v_codes -> 'totals',
    'layouts',       jsonb_array_length(v_formats),
    'using_builtin', coalesce((v_formats -> 0 ->> 'builtin')::boolean, false)
  );
end
$fn$;
