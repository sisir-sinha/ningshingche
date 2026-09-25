-- Serial Numbers — behaviour, in SQL.
--
-- Ten functions, one table, and every one of them is reached only through
-- `public.plugin_rpc`, which is what binds a call to *this* shop's installed
-- copy of *this* plugin. That is why each function also guards itself: a
-- function in `public` can be called directly by anyone holding the name, so
-- `app.require_org` and `app.require_permission` are repeated in every entry
-- point rather than assumed from the caller.
--
-- The plugin owns one thing the core cannot know: which physical unit went out
-- of the door. Everything else it needs — the catalogue, the stock ledger, the
-- sale and its lines — it reads. It writes no core table. A serial is not a
-- stock movement, and capturing one is not a sale: both already happened.

-- ── The shop's own settings ───────────────────────────────────────────────
-- Read from `plugins.config` — the same place the Settings screen writes — so
-- a number shown on the screen is the number the server obeys.
create or replace function app.serial_numbers_config(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_config   jsonb := '{}'::jsonb;
  v_require  boolean := true;
  v_prefix   text := 'SN-';
  v_over     boolean := false;
begin
  select p.config into v_config
    from public.plugins p
   where p.organization_id = p_organization_id
     and p.plugin_key = 'serial-numbers';

  if v_config is null then v_config := '{}'::jsonb; end if;

  if jsonb_typeof(v_config -> 'require_capture') = 'boolean' then
    v_require := (v_config ->> 'require_capture')::boolean;
  end if;
  if btrim(coalesce(v_config ->> 'internal_prefix', '')) <> '' then
    v_prefix := btrim(v_config ->> 'internal_prefix');
  end if;
  if jsonb_typeof(v_config -> 'allow_over_stock') = 'boolean' then
    v_over := (v_config ->> 'allow_over_stock')::boolean;
  end if;

  return jsonb_build_object(
    'require_capture', v_require,
    'internal_prefix', v_prefix,
    'allow_over_stock', v_over
  );
end
$fn$;

-- ── Is this product one a shop tracks by unit? ────────────────────────────
-- The flag is a product field the plugin registers, so it lives in
-- `products.metadata` with no column of its own (spec §14, §51).
create or replace function app.serial_numbers_tracked(p_org uuid, p_product uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select (p.metadata ->> 'serial_tracked') = 'true' from public.products p
      where p.id = p_product and p.organization_id = p_org),
    false)
$fn$;

-- ── What a sale's serial-tracked lines need, and what they have ───────────
-- One call answers "what is on this sale, and what is still missing?" for both
-- the sale tab and the repair flow on the Serial Numbers screen. `missing` is
-- units that left without a unit number: quantity minus what came back minus
-- what is recorded, floored at zero so a shop that over-captured never sees a
-- negative.
create or replace function app.serial_numbers_sale_lines(p_org uuid, p_sale_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(jsonb_agg(ln.line order by ln.line ->> 'product_name', ln.line ->> 'sale_item_id'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'sale_item_id',   si.id,
               'product_id',     si.product_id,
               'variant_id',     si.variant_id,
               'product_name',   si.product_name,
               'variant_name',   si.variant_name,
               'sku',            si.sku,
               'unit_label',     si.unit_label,
               'quantity',       si.quantity,
               'returned_qty',   coalesce(si.returned_qty, 0),
               -- The counts are integers *in the payload*, not numeric that
               -- happens to be whole: `2.000` renders as the text "2.000", and
               -- casting that to integer is an error in Postgres. Every caller
               -- that reads `missing` sums it, so the cast belongs here.
               'sold_units',     greatest(0, si.quantity - coalesce(si.returned_qty, 0))::int,
               'captured',       coalesce(b.captured, 0)::int,
               'bound',          coalesce(b.bound, '[]'::jsonb),
               'missing',        greatest(0, si.quantity - coalesce(si.returned_qty, 0) - coalesce(b.captured, 0))::int
             ) as line
        from public.sale_items si
        left join lateral (
          select count(*)::int as captured,
                 jsonb_agg(jsonb_build_object(
                   'id',          s.id,
                   'serial',      s.serial,
                   'status',      s.status,
                   'source',      s.source,
                   'sold_at',     s.sold_at,
                   'returned_at', s.returned_at,
                   'released_at', s.released_at
                 ) order by s.sold_at nulls first, s.serial) as bound
            from public.plg_serial_numbers_serials s
           where s.organization_id = p_org
             and s.sale_item_id = si.id
        ) b on true
       where si.organization_id = p_org
         and si.sale_id = p_sale_id
         and app.serial_numbers_tracked(p_org, si.product_id)
    ) ln
$fn$;

-- ── The next code for a shop that does not scan ───────────────────────────
-- `SN-000007`, and never a code that already exists: the loop is what makes
-- that true, not the counter, because a shop may delete a serial and reuse the
-- number by hand.
create or replace function app.serial_numbers_next_code(p_org uuid, p_prefix text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_prefix text := coalesce(nullif(btrim(p_prefix), ''), 'SN-');
  v_seq    integer;
  v_code   text;
  v_tries  integer := 0;
begin
  select count(*)::int into v_seq
    from public.plg_serial_numbers_serials s
   where s.organization_id = p_org and s.source = 'INTERNAL';

  loop
    v_seq := v_seq + 1;
    v_code := v_prefix || lpad(v_seq::text, 6, '0');
    exit when not exists (
      select 1 from public.plg_serial_numbers_serials s
       where s.organization_id = p_org and lower(s.serial) = lower(v_code)
    );
    v_tries := v_tries + 1;
    if v_tries > 5000 then
      raise exception 'serial_codes_exhausted: %', v_prefix using errcode = 'P0001';
    end if;
  end loop;

  return v_code;
end
$fn$;

-- ── Sales that left with units unaccounted for ────────────────────────────
-- The plugin's conscience. A serial-tracked product can be sold without anyone
-- scanning anything — the till has to work whether the scanner does or not —
-- so the shop needs a list of what to fix, not a blocked sale.
create or replace function app.serial_numbers_pending(p_org uuid, p_days integer, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_out     jsonb := '[]'::jsonb;
  v_sale    record;
  v_lines   jsonb;
  v_missing integer;
begin
  for v_sale in
    select sa.id, sa.invoice_no, sa.status, sa.created_at, c.name as customer
      from public.sales sa
      left join public.customers c on c.id = sa.customer_id
     where sa.organization_id = p_org
       and sa.status in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
       and sa.created_at >= now() - make_interval(days => greatest(1, p_days))
     order by sa.created_at desc
     limit greatest(1, least(200, p_limit))
  loop
    v_lines := app.serial_numbers_sale_lines(p_org, v_sale.id);

    select coalesce(sum((ln ->> 'missing')::int), 0)::int into v_missing
      from jsonb_array_elements(v_lines) ln;

    if v_missing > 0 then
      v_out := v_out || jsonb_build_object(
        'sale_id',    v_sale.id,
        'invoice_no', v_sale.invoice_no,
        'status',     v_sale.status,
        'created_at', v_sale.created_at,
        'customer',   v_sale.customer,
        'missing',    v_missing,
        'lines',      (select coalesce(jsonb_agg(ln), '[]'::jsonb)
                         from jsonb_array_elements(v_lines) ln
                        where (ln ->> 'missing')::int > 0)
      );
    end if;
  end loop;

  return v_out;
end
$fn$;

-- ── The dashboard and the screen header ───────────────────────────────────
create or replace function public.serial_numbers_overview(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org         uuid := p_organization_id;
  v_days        integer := coalesce(nullif(p_args ->> 'days', '')::integer, 60);
  v_totals      jsonb;
  v_tracked     integer;
  v_pending     jsonb;
  v_pending_n   integer;
  v_pending_qty integer;
  v_recent      jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('serial-numbers.view');

  select jsonb_build_object(
           'total',    count(*)::int,
           'in_stock', (count(*) filter (where s.status = 'IN_STOCK'))::int,
           'sold',     (count(*) filter (where s.status = 'SOLD'))::int,
           'returned', (count(*) filter (where s.status = 'RETURNED'))::int,
           'internal', (count(*) filter (where s.source = 'INTERNAL'))::int
         ) into v_totals
    from public.plg_serial_numbers_serials s
   where s.organization_id = v_org;

  select count(*)::int into v_tracked
    from public.products p
   where p.organization_id = v_org
     and p.deleted_at is null
     and app.serial_numbers_tracked(v_org, p.id);

  v_pending := app.serial_numbers_pending(v_org, v_days, 50);
  select count(*)::int, coalesce(sum((e ->> 'missing')::int), 0)::int
    into v_pending_n, v_pending_qty
    from jsonb_array_elements(v_pending) e;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           r.id,
           'serial',       r.serial,
           'status',       r.status,
           'product_name', r.product_name,
           'invoice_no',   r.invoice_no,
           'sold_at',      r.sold_at,
           'created_at',   r.created_at
         ) order by r.created_at desc), '[]'::jsonb) into v_recent
    from (
      select s.id, s.serial, s.status, s.sold_at, s.created_at,
             p.name as product_name, sa.invoice_no
        from public.plg_serial_numbers_serials s
        left join public.products p on p.id = s.product_id
        left join public.sales sa on sa.id = s.sale_id
       where s.organization_id = v_org
       order by s.created_at desc
       limit 5
    ) r;

  return jsonb_build_object(
    'totals',           v_totals,
    'tracked_products', v_tracked,
    'pending', jsonb_build_object(
      'sales',       v_pending_n,
      'units',       v_pending_qty,
      'window_days', greatest(1, v_days),
      'scanned',     50
    ),
    'recent', v_recent,
    'config', app.serial_numbers_config(v_org)
  );
end
$fn$;

-- ── What the shop can put serials against ─────────────────────────────────
-- The add form needs three things: which products are tracked, which variants
-- each has, and which warehouses exist. One call, because three round trips on
-- a screen that a shopkeeper opens every morning is three chances to time out.
create or replace function public.serial_numbers_catalog(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org      uuid := p_organization_id;
  v_products jsonb;
  v_warehouses jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('serial-numbers.view');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',       p.id,
           'name',     p.name,
           'sku',      p.sku,
           'variants', (select count(*)::int from public.product_variants v
                         where v.product_id = p.id and v.is_active),
           'serials',  (select count(*)::int from public.plg_serial_numbers_serials s
                         where s.organization_id = v_org and s.product_id = p.id),
           'in_stock', (select count(*)::int from public.plg_serial_numbers_serials s
                         where s.organization_id = v_org and s.product_id = p.id
                           and s.status = 'IN_STOCK')
         ) order by p.name), '[]'::jsonb) into v_products
    from public.products p
   where p.organization_id = v_org
     and p.deleted_at is null
     and app.serial_numbers_tracked(v_org, p.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              w.id,
           'name',            w.name,
           'code',            w.code,
           'is_retail_floor', w.is_retail_floor
         ) order by w.is_retail_floor desc, w.name), '[]'::jsonb) into v_warehouses
    from public.warehouses w
   where w.organization_id = v_org and w.deleted_at is null;

  return jsonb_build_object(
    'products',   v_products,
    'warehouses', v_warehouses,
    'config',     app.serial_numbers_config(v_org)
  );
end
$fn$;

-- ── The variants of one product, with what is on hand ─────────────────────
-- Stock on hand is the core's number, read here so the add form can say "3 of
-- 5 units have a serial" before a shopkeeper pastes a list and finds out later.
create or replace function public.serial_numbers_variants(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org     uuid := p_organization_id;
  v_product uuid := nullif(p_args ->> 'product_id', '')::uuid;
  v_out     jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('serial-numbers.view');

  if v_product is null then
    raise exception 'serial_product_required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.products p
     where p.id = v_product and p.organization_id = v_org and p.deleted_at is null
  ) then
    raise exception 'serial_unknown_product: %', v_product using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          v.id,
           'name',        coalesce(nullif(v.name_suffix, ''), 'Default'),
           'sku',         v.sku,
           'is_default',  v.is_default,
           'is_active',   v.is_active,
           'on_hand',     coalesce((select sum(b.quantity) from public.stock_balances b
                                      where b.organization_id = v_org and b.variant_id = v.id), 0),
           'serials',     (select count(*)::int from public.plg_serial_numbers_serials s
                             where s.organization_id = v_org and s.variant_id = v.id),
           'in_stock',    (select count(*)::int from public.plg_serial_numbers_serials s
                             where s.organization_id = v_org and s.variant_id = v.id
                               and s.status = 'IN_STOCK')
         ) order by v.is_default desc, v.name_suffix nulls first), '[]'::jsonb) into v_out
    from public.product_variants v
   where v.organization_id = v_org and v.product_id = v_product;

  return jsonb_build_object('product_id', v_product, 'variants', v_out);
end
$fn$;

-- ── Registering units ─────────────────────────────────────────────────────
-- The one write that can be large: a delivery of fifty handsets is fifty
-- lines pasted at once. A unit that is already registered is skipped rather
-- than refused, because a shop re-pasting yesterday's list should not have to
-- read an error to learn that nothing is wrong.
create or replace function public.serial_numbers_add(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org       uuid := p_organization_id;
  v_variant   uuid := nullif(p_args ->> 'variant_id', '')::uuid;
  v_warehouse uuid := nullif(p_args ->> 'warehouse_id', '')::uuid;
  v_note      text := nullif(btrim(coalesce(p_args ->> 'note', '')), '');
  v_source    text := coalesce(nullif(p_args ->> 'source', ''), 'MANUAL');
  v_serials   jsonb := coalesce(p_args -> 'serials', '[]'::jsonb);
  v_product   uuid;
  v_tracked   boolean;
  v_raw       text;
  v_key       text;
  v_seen      text[] := '{}';
  v_added     integer := 0;
  v_skipped   jsonb := '[]'::jsonb;
  v_skipped_n integer := 0;
  v_stock     numeric;
  v_pool      numeric;
  v_config    jsonb;
  v_over      boolean;
begin
  perform app.require_org(v_org);
  perform app.require_permission('serial-numbers.manage');

  if v_variant is null then
    raise exception 'serial_variant_required' using errcode = '22023';
  end if;
  if jsonb_typeof(v_serials) <> 'array' or jsonb_array_length(v_serials) = 0 then
    raise exception 'serial_invalid_batch' using errcode = '22023';
  end if;
  if jsonb_array_length(v_serials) > 500 then
    raise exception 'serial_batch_too_large: % (max 500)', jsonb_array_length(v_serials)
      using errcode = '22023';
  end if;
  if v_source not in ('MANUAL', 'IMPORT') then
    raise exception 'serial_unknown_source: %', v_source using errcode = '22023';
  end if;

  select v.product_id into v_product
    from public.product_variants v
   where v.id = v_variant and v.organization_id = v_org;

  if v_product is null then
    raise exception 'serial_unknown_variant: %', v_variant using errcode = 'P0002';
  end if;

  v_tracked := app.serial_numbers_tracked(v_org, v_product);
  if not v_tracked then
    -- Refused rather than allowed quietly: a pool nobody asked for is a pool
    -- nobody maintains, and the fix is one checkbox on the product.
    raise exception 'serial_product_not_tracked: %', v_product using errcode = 'P0001';
  end if;

  if v_warehouse is null then
    select w.id into v_warehouse
      from public.warehouses w
     where w.organization_id = v_org and w.deleted_at is null
     order by w.is_retail_floor desc, w.created_at
     limit 1;
  end if;
  if v_warehouse is null then
    raise exception 'serial_no_warehouse' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.warehouses w
     where w.id = v_warehouse and w.organization_id = v_org and w.deleted_at is null
  ) then
    raise exception 'serial_unknown_warehouse: %', v_warehouse using errcode = 'P0002';
  end if;

  v_config := app.serial_numbers_config(v_org);
  v_over := (v_config ->> 'allow_over_stock')::boolean;

  select coalesce(sum(b.quantity), 0) into v_stock
    from public.stock_balances b
   where b.organization_id = v_org and b.variant_id = v_variant;

  select count(*)::int into v_pool
    from public.plg_serial_numbers_serials s
   where s.organization_id = v_org and s.variant_id = v_variant
     and s.status = 'IN_STOCK';

  for v_raw in select value from jsonb_array_elements_text(v_serials) loop
    v_key := lower(btrim(v_raw));

    if v_key = '' then
      v_skipped_n := v_skipped_n + 1;
      if v_skipped_n <= 50 then
        v_skipped := v_skipped || jsonb_build_object('serial', left(v_raw, 60), 'reason', 'empty');
      end if;
      continue;
    end if;

    if v_key = any(v_seen) then
      v_skipped_n := v_skipped_n + 1;
      if v_skipped_n <= 50 then
        v_skipped := v_skipped || jsonb_build_object('serial', left(v_raw, 60), 'reason', 'duplicate_in_list');
      end if;
      continue;
    end if;
    v_seen := v_seen || v_key;

    if length(v_raw) > 120 then
      v_skipped_n := v_skipped_n + 1;
      if v_skipped_n <= 50 then
        v_skipped := v_skipped || jsonb_build_object('serial', left(v_raw, 60), 'reason', 'too_long');
      end if;
      continue;
    end if;

    if exists (
      select 1 from public.plg_serial_numbers_serials s
       where s.organization_id = v_org and lower(s.serial) = v_key
    ) then
      v_skipped_n := v_skipped_n + 1;
      if v_skipped_n <= 50 then
        v_skipped := v_skipped || jsonb_build_object('serial', left(v_raw, 60), 'reason', 'already_registered');
      end if;
      continue;
    end if;

    -- Units are not created by being labelled: the stock ledger already says
    -- how many there are, and a shop that has more serials than stock has
    -- either miscounted or is labelling a delivery it has not received. Both
    -- are worth a sentence, so the pool cannot outgrow the shelf unless the
    -- shop says so in its settings.
    if not v_over and v_pool + 1 > v_stock then
      v_skipped_n := v_skipped_n + 1;
      if v_skipped_n <= 50 then
        v_skipped := v_skipped || jsonb_build_object('serial', left(v_raw, 60), 'reason', 'over_stock');
      end if;
      continue;
    end if;

    insert into public.plg_serial_numbers_serials
      (organization_id, product_id, variant_id, warehouse_id, serial, status, source, note, created_by)
    values
      (v_org, v_product, v_variant, v_warehouse, btrim(v_raw), 'IN_STOCK', v_source, v_note, auth.uid());

    v_added := v_added + 1;
    v_pool := v_pool + 1;
  end loop;

  return jsonb_build_object(
    'added',         v_added,
    'skipped',       v_skipped,
    'skipped_total', v_skipped_n,
    'variant_id',    v_variant,
    'warehouse_id',  v_warehouse,
    'in_stock',      v_pool,
    'stock_on_hand', v_stock,
    'over_stock',    v_over
  );
end
$fn$;

-- ── The list a shopkeeper actually looks at ───────────────────────────────
create or replace function public.serial_numbers_list(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org      uuid := p_organization_id;
  v_status   text := nullif(upper(btrim(coalesce(p_args ->> 'status', ''))), '');
  v_product  uuid := nullif(p_args ->> 'product_id', '')::uuid;
  v_variant  uuid := nullif(p_args ->> 'variant_id', '')::uuid;
  v_search   text := nullif(btrim(coalesce(p_args ->> 'search', '')), '');
  v_limit    integer := greatest(1, least(200, coalesce(nullif(p_args ->> 'limit', '')::integer, 50)));
  v_offset   integer := greatest(0, coalesce(nullif(p_args ->> 'offset', '')::integer, 0));
  v_total    integer;
  v_rows     jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('serial-numbers.view');

  if v_status is not null and v_status not in ('IN_STOCK', 'SOLD', 'RETURNED') then
    raise exception 'serial_unknown_status: %', v_status using errcode = '22023';
  end if;

  select count(*)::int into v_total
    from public.plg_serial_numbers_serials s
    left join public.products p on p.id = s.product_id
    left join public.sales sa on sa.id = s.sale_id
    left join public.customers c on c.id = s.customer_id
   where s.organization_id = v_org
     and (v_status is null or s.status = v_status)
     and (v_product is null or s.product_id = v_product)
     and (v_variant is null or s.variant_id = v_variant)
     and (
       v_search is null
       or s.serial ilike '%' || v_search || '%'
       or coalesce(p.name, '') ilike '%' || v_search || '%'
       or coalesce(sa.invoice_no, '') ilike '%' || v_search || '%'
       or coalesce(c.name, '') ilike '%' || v_search || '%'
     );

  select coalesce(jsonb_agg(row order by row ->> 'received_at' desc, row ->> 'serial'), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'id',           s.id,
               'serial',       s.serial,
               'status',       s.status,
               'source',       s.source,
               'note',         s.note,
               'product_id',   s.product_id,
               'product_name', p.name,
               'variant_id',   s.variant_id,
               'variant_name', coalesce(nullif(v.name_suffix, ''), 'Default'),
               'sku',          coalesce(v.sku, p.sku),
               'warehouse',    w.name,
               'sale_id',      s.sale_id,
               'invoice_no',   sa.invoice_no,
               'customer',     c.name,
               'received_at',  s.received_at,
               'sold_at',      s.sold_at,
               'returned_at',  s.returned_at,
               'released_at',  s.released_at
             ) as row
        from public.plg_serial_numbers_serials s
        left join public.products p on p.id = s.product_id
        left join public.product_variants v on v.id = s.variant_id
        left join public.warehouses w on w.id = s.warehouse_id
        left join public.sales sa on sa.id = s.sale_id
        left join public.customers c on c.id = s.customer_id
       where s.organization_id = v_org
         and (v_status is null or s.status = v_status)
         and (v_product is null or s.product_id = v_product)
         and (v_variant is null or s.variant_id = v_variant)
         and (
           v_search is null
           or s.serial ilike '%' || v_search || '%'
           or coalesce(p.name, '') ilike '%' || v_search || '%'
           or coalesce(sa.invoice_no, '') ilike '%' || v_search || '%'
           or coalesce(c.name, '') ilike '%' || v_search || '%'
         )
       order by s.received_at desc, s.serial
       limit v_limit offset v_offset
    ) r;

  return jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'status', coalesce(v_status, 'ALL')
  );
end
$fn$;

-- ── One sale, and what it needs ───────────────────────────────────────────
create or replace function public.serial_numbers_for_sale(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org  uuid := p_organization_id;
  v_sale uuid := nullif(p_args ->> 'sale_id', '')::uuid;
  v_head record;
  v_lines jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('serial-numbers.view');

  if v_sale is null then
    raise exception 'serial_sale_required' using errcode = '22023';
  end if;

  select sa.id, sa.invoice_no, sa.status, sa.created_at, c.name as customer
    into v_head
    from public.sales sa
    left join public.customers c on c.id = sa.customer_id
   where sa.id = v_sale and sa.organization_id = v_org;

  if not found then
    raise exception 'serial_unknown_sale: %', v_sale using errcode = 'P0002';
  end if;

  v_lines := app.serial_numbers_sale_lines(v_org, v_sale);

  return jsonb_build_object(
    'sale', jsonb_build_object(
      'id',         v_head.id,
      'invoice_no', v_head.invoice_no,
      'status',     v_head.status,
      'created_at', v_head.created_at,
      'customer',   v_head.customer
    ),
    'lines',   v_lines,
    'tracked', jsonb_array_length(v_lines) > 0,
    'missing', (select coalesce(sum((ln ->> 'missing')::int), 0)::int
                  from jsonb_array_elements(v_lines) ln)
  );
end
$fn$;

-- ── Binding a unit to the line it left on ─────────────────────────────────
-- The matching rule is the interesting part. A shop scans an IMEI; the server
-- knows which *variant* that unit is, and the sale knows which lines sold that
-- variant, but nothing anywhere knows which of two identical handsets the
-- customer picked up — because they are identical. So a scanned unit fills the
-- line that still needs one, and when two lines both need one the fuller line
-- is filled first, which is deterministic and matches how a till is used (a
-- two-handset line is rung up as one line).
create or replace function public.serial_numbers_capture(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid := p_organization_id;
  v_sale     uuid := nullif(p_args ->> 'sale_id', '')::uuid;
  v_serials  jsonb := coalesce(p_args -> 'serials', '[]'::jsonb);
  v_raw      text;
  v_key      text;
  v_seen     text[] := '{}';
  v_status   text;
  v_serial   record;
  v_item     uuid;
  v_variant_lines integer;
  v_full     integer;
  v_captured integer := 0;
  v_refused  jsonb := '[]'::jsonb;
  v_head     record;
  v_lines    jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('serial-numbers.manage');

  if v_sale is null then
    raise exception 'serial_sale_required' using errcode = '22023';
  end if;
  if jsonb_typeof(v_serials) <> 'array' or jsonb_array_length(v_serials) = 0 then
    raise exception 'serial_invalid_batch' using errcode = '22023';
  end if;
  if jsonb_array_length(v_serials) > 200 then
    raise exception 'serial_batch_too_large: % (max 200)', jsonb_array_length(v_serials)
      using errcode = '22023';
  end if;

  select sa.id, sa.status, sa.customer_id into v_head
    from public.sales sa
   where sa.id = v_sale and sa.organization_id = v_org;

  if not found then
    raise exception 'serial_unknown_sale: %', v_sale using errcode = 'P0002';
  end if;

  v_status := v_head.status;
  if v_status not in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') then
    raise exception 'serial_sale_not_capturable: %', v_status using errcode = 'P0001';
  end if;

  for v_raw in select value from jsonb_array_elements_text(v_serials) loop
    v_key := lower(btrim(v_raw));

    if v_key = '' then
      v_refused := v_refused || jsonb_build_object('serial', left(v_raw, 60), 'reason', 'empty');
      continue;
    end if;
    if v_key = any(v_seen) then
      v_refused := v_refused || jsonb_build_object('serial', left(v_raw, 60), 'reason', 'duplicate_in_list');
      continue;
    end if;
    v_seen := v_seen || v_key;

    select s.id, s.serial, s.status, s.variant_id into v_serial
      from public.plg_serial_numbers_serials s
     where s.organization_id = v_org and lower(s.serial) = v_key;

    if v_serial.id is null then
      v_refused := v_refused || jsonb_build_object('serial', left(v_raw, 60), 'reason', 'not_registered');
      continue;
    end if;

    if v_serial.status <> 'IN_STOCK' then
      v_refused := v_refused || jsonb_build_object(
        'serial', v_serial.serial, 'reason', 'not_in_stock', 'status', v_serial.status);
      continue;
    end if;

    select count(*)::int into v_variant_lines
      from public.sale_items si
     where si.organization_id = v_org and si.sale_id = v_sale and si.variant_id = v_serial.variant_id;

    if v_variant_lines = 0 then
      v_refused := v_refused || jsonb_build_object(
        'serial', v_serial.serial, 'reason', 'variant_not_on_sale');
      continue;
    end if;

    select ln.id into v_item
      from (
        select si.id,
               (si.quantity - coalesce(si.returned_qty, 0)
                 - (select count(*) from public.plg_serial_numbers_serials s2
                     where s2.sale_item_id = si.id)) as need
          from public.sale_items si
         where si.organization_id = v_org
           and si.sale_id = v_sale
           and si.variant_id = v_serial.variant_id
      ) ln
     where ln.need > 0
     order by ln.need desc, ln.id
     limit 1;

    if v_item is null then
      v_refused := v_refused || jsonb_build_object(
        'serial', v_serial.serial, 'reason', 'every_line_full');
      continue;
    end if;

    update public.plg_serial_numbers_serials s
       set status       = 'SOLD',
           sale_id      = v_sale,
           sale_item_id = v_item,
           customer_id  = v_head.customer_id,
           sold_at      = now(),
           returned_at  = null,
           released_at  = null
     where s.id = v_serial.id and s.organization_id = v_org;

    v_captured := v_captured + 1;
  end loop;

  v_lines := app.serial_numbers_sale_lines(v_org, v_sale);

  return jsonb_build_object(
    'sale_id',   v_sale,
    'captured',  v_captured,
    'refusals',  v_refused,
    'lines',     v_lines,
    'missing',   (select coalesce(sum((ln ->> 'missing')::int), 0)::int
                    from jsonb_array_elements(v_lines) ln)
  );
end
$fn$;

-- ── A code for every unit that never got one ──────────────────────────────
-- Some shops simply do not scan. Refusing to let them track anything would be
-- the wrong answer: an internal code is worse than an IMEI and far better than
-- nothing, and it is labelled as internal everywhere it appears.
create or replace function public.serial_numbers_autofill(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org     uuid := p_organization_id;
  v_sale    uuid := nullif(p_args ->> 'sale_id', '')::uuid;
  v_config  jsonb;
  v_prefix  text;
  v_head    record;
  v_lines   jsonb;
  v_line    jsonb;
  v_need    integer;
  v_i       integer;
  v_code    text;
  v_created integer := 0;
  v_codes   jsonb := '[]'::jsonb;
  v_missing integer := 0;
  v_refused jsonb := '[]'::jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('serial-numbers.manage');

  if v_sale is null then
    raise exception 'serial_sale_required' using errcode = '22023';
  end if;

  select sa.id, sa.status, sa.customer_id into v_head
    from public.sales sa
   where sa.id = v_sale and sa.organization_id = v_org;

  if not found then
    raise exception 'serial_unknown_sale: %', v_sale using errcode = 'P0002';
  end if;
  if v_head.status not in ('COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') then
    raise exception 'serial_sale_not_capturable: %', v_head.status using errcode = 'P0001';
  end if;

  v_config := app.serial_numbers_config(v_org);
  v_prefix := v_config ->> 'internal_prefix';
  if btrim(coalesce(v_prefix, '')) = '' then
    raise exception 'serial_prefix_missing' using errcode = 'P0001';
  end if;

  v_lines := app.serial_numbers_sale_lines(v_org, v_sale);

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_need := (v_line ->> 'missing')::int;
    if v_need <= 0 then
      continue;
    end if;

    for v_i in 1 .. v_need loop
      v_code := app.serial_numbers_next_code(v_org, v_prefix);

      insert into public.plg_serial_numbers_serials
        (organization_id, product_id, variant_id, warehouse_id, serial, status, source,
         sale_id, sale_item_id, customer_id, sold_at, created_by, note)
      values
        (v_org, (v_line ->> 'product_id')::uuid, (v_line ->> 'variant_id')::uuid, null,
         v_code, 'SOLD', 'INTERNAL', v_sale, (v_line ->> 'sale_item_id')::uuid,
         v_head.customer_id, now(), auth.uid(), 'Generated at capture time');

      v_created := v_created + 1;
      v_codes := v_codes || jsonb_build_object(
        'serial', v_code,
        'product_name', v_line ->> 'product_name',
        'variant_name', v_line ->> 'variant_name'
      );
    end loop;
  end loop;

  v_lines := app.serial_numbers_sale_lines(v_org, v_sale);
  select coalesce(sum((ln ->> 'missing')::int), 0)::int into v_missing
    from jsonb_array_elements(v_lines) ln;

  return jsonb_build_object(
    'sale_id',  v_sale,
    'created',  v_created,
    'prefix',   v_prefix,
    'serials',  v_codes,
    'refusals', v_refused,
    'lines',    v_lines,
    'missing',  v_missing
  );
end
$fn$;

-- ── Putting a unit back on the shelf ──────────────────────────────────────
-- A correction, not a return: the return itself belongs to `refund_sale`, and
-- after it the unit is free to be labelled, sold again, or written off. The
-- last sale is kept on the row, so releasing an IMEI never erases where it has
-- been.
create or replace function public.serial_numbers_release(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org     uuid := p_organization_id;
  v_ids     jsonb := coalesce(p_args -> 'ids', '[]'::jsonb);
  v_serials jsonb := coalesce(p_args -> 'serials', '[]'::jsonb);
  v_hit     integer := 0;
  v_count   integer := 0;
  v_rows    jsonb := '[]'::jsonb;
  v_row     record;
begin
  perform app.require_org(v_org);
  perform app.require_permission('serial-numbers.manage');

  if jsonb_typeof(v_ids) <> 'array' or jsonb_typeof(v_serials) <> 'array' then
    raise exception 'serial_invalid_batch' using errcode = '22023';
  end if;
  if jsonb_array_length(v_ids) + jsonb_array_length(v_serials) = 0 then
    raise exception 'serial_invalid_batch' using errcode = '22023';
  end if;

  for v_row in
    select s.id, s.serial, s.status
      from public.plg_serial_numbers_serials s
     where s.organization_id = v_org
       and (
         s.id in (select (value)::uuid from jsonb_array_elements_text(v_ids))
         or lower(s.serial) in (
              select lower(btrim(value)) from jsonb_array_elements_text(v_serials)
            )
       )
     order by s.serial
  loop
    v_count := v_count + 1;
    if v_row.status = 'IN_STOCK' then
      v_rows := v_rows || jsonb_build_object('serial', v_row.serial, 'reason', 'already_in_stock');
      continue;
    end if;

    update public.plg_serial_numbers_serials s
       set status = 'IN_STOCK', released_at = now()
     where s.id = v_row.id and s.organization_id = v_org;

    v_hit := v_hit + 1;
    v_rows := v_rows || jsonb_build_object('serial', v_row.serial, 'reason', 'released', 'from', v_row.status);
  end loop;

  return jsonb_build_object(
    'released', v_hit,
    'asked',    jsonb_array_length(v_ids) + jsonb_array_length(v_serials),
    'rows',     v_rows
  );
end
$fn$;

-- ── A refund already says which units came back ───────────────────────────
-- `sale_returns` records how many units of a line came back; a serial row
-- records which ones left. Nothing joins them, and this is the join: for each
-- line, the oldest captured units are marked returned — oldest first, because
-- the customer is far more likely to bring back the handset they bought first
-- than to have kept it and returned the later one. Idempotent: running it twice
-- marks nothing the second time.
create or replace function public.serial_numbers_sync_refunds(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org    uuid := p_organization_id;
  v_sale   uuid := nullif(p_args ->> 'sale_id', '')::uuid;
  v_line   record;
  v_marked integer := 0;
  v_count  integer := 0;
  v_sales  integer := 0;
  v_rows   jsonb := '[]'::jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('serial-numbers.manage');

  -- `returned_qty` says how many units came back; the serial rows say how many
  -- are already accounted for. A unit that came back and was released to the
  -- shelf counts, which is what makes a second run — or a run after a release —
  -- mark nothing again.
  for v_line in
    select si.id,
           si.sale_id,
           greatest(
             0,
             least(
               coalesce(si.returned_qty, 0)::int
                 - (select count(*)::int from public.plg_serial_numbers_serials s
                     where s.sale_item_id = si.id
                       and (s.status = 'RETURNED' or s.released_at is not null)),
               (select count(*)::int from public.plg_serial_numbers_serials s
                 where s.sale_item_id = si.id and s.status = 'SOLD')
             )
           ) as to_return
      from public.sale_items si
     where si.organization_id = v_org
       and coalesce(si.returned_qty, 0) > 0
       and (v_sale is null or si.sale_id = v_sale)
     order by si.sale_id, si.id
  loop
    if v_line.to_return <= 0 then
      continue;
    end if;

    update public.plg_serial_numbers_serials s
       set status = 'RETURNED', returned_at = now()
     where s.id in (
       select picked.id
         from (
           select s2.id, row_number() over (order by s2.sold_at nulls last, s2.serial) as rn
             from public.plg_serial_numbers_serials s2
            where s2.organization_id = v_org
              and s2.sale_item_id = v_line.id
              and s2.status = 'SOLD'
         ) picked
        where picked.rn <= v_line.to_return
     );

    get diagnostics v_count = row_count;
    if v_count > 0 then
      v_marked := v_marked + v_count;
      v_sales := v_sales + 1;
      v_rows := v_rows || jsonb_build_object('sale_item_id', v_line.id, 'marked', v_count);
    end if;
  end loop;

  return jsonb_build_object('marked', v_marked, 'lines', v_sales, 'rows', v_rows);
end
$fn$;

-- ── The list a shopkeeper works through ───────────────────────────────────
create or replace function public.serial_numbers_pending(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org   uuid := p_organization_id;
  v_days  integer := greatest(1, least(365, coalesce(nullif(p_args ->> 'days', '')::integer, 60)));
  v_limit integer := greatest(1, least(100, coalesce(nullif(p_args ->> 'limit', '')::integer, 25)));
begin
  perform app.require_org(v_org);
  perform app.require_permission('serial-numbers.view');

  return app.serial_numbers_pending(v_org, v_days, v_limit);
end
$fn$;

-- ── The report a shop that tracks units actually wants ────────────────────
-- Not "how much did we sell" — the core answers that — but "which of our
-- units are we still holding, and for how long". Slow-moving serialised stock
-- is money sitting on a shelf, and it is invisible in a stock count because
-- five handsets look like five handsets whether they arrived last week or last
-- year.
create or replace function public.serial_numbers_report(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org      uuid := p_organization_id;
  v_days     integer := greatest(1, least(365, coalesce(nullif(p_args ->> 'days', '')::integer, 30)));
  v_from     timestamptz;
  v_aging    jsonb;
  v_products jsonb;
  v_totals   jsonb;
  v_pending  jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('serial-numbers.view');

  v_from := now() - make_interval(days => v_days);

  select jsonb_build_object(
           'sold',     (count(*) filter (where s.sold_at >= v_from))::int,
           'returned', (count(*) filter (where s.returned_at >= v_from))::int,
           'in_stock', (count(*) filter (where s.status = 'IN_STOCK'))::int,
           'internal', (count(*) filter (where s.source = 'INTERNAL'))::int,
           'total',    count(*)::int
         ) into v_totals
    from public.plg_serial_numbers_serials s
   where s.organization_id = v_org;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', b.bucket, 'count', b.n) order by b.sort), '[]'::jsonb)
    into v_aging
    from (
      select case
               when now() - s.received_at < interval '30 days'  then '0-30 days'
               when now() - s.received_at < interval '90 days'  then '31-90 days'
               when now() - s.received_at < interval '180 days' then '91-180 days'
               else 'over 180 days'
             end as bucket,
             case
               when now() - s.received_at < interval '30 days'  then 1
               when now() - s.received_at < interval '90 days'  then 2
               when now() - s.received_at < interval '180 days' then 3
               else 4
             end as sort,
             count(*)::int as n
        from public.plg_serial_numbers_serials s
       where s.organization_id = v_org and s.status = 'IN_STOCK'
       group by 1, 2
    ) b;

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id',   t.product_id,
           'product_name', t.product_name,
           'sold',         t.sold,
           'in_stock',     t.in_stock
         ) order by t.sold desc, t.product_name), '[]'::jsonb) into v_products
    from (
      select p.id as product_id, p.name as product_name,
             (count(*) filter (where s.sold_at >= v_from))::int as sold,
             (count(*) filter (where s.status = 'IN_STOCK'))::int as in_stock
        from public.plg_serial_numbers_serials s
        join public.products p on p.id = s.product_id
       where s.organization_id = v_org
       group by p.id, p.name
       order by 3 desc, p.name
       limit 10
    ) t;

  v_pending := app.serial_numbers_pending(v_org, greatest(v_days, 30), 100);

  return jsonb_build_object(
    'window', jsonb_build_object(
      'days', v_days,
      'from', v_from,
      'to',   now()
    ),
    'totals',       v_totals,
    'aging',        v_aging,
    'by_product',   v_products,
    'pending_sales', jsonb_array_length(v_pending),
    'pending_units', (select coalesce(sum((e ->> 'missing')::int), 0)::int
                        from jsonb_array_elements(v_pending) e)
  );
end
$fn$;

-- ── Closing the world's access ────────────────────────────────────────────
-- The plugin's own functions are reached through `plugin_rpc`, which is what
-- checks that this shop has the plugin installed and enabled. They are granted
-- to `authenticated` anyway, deliberately: every entry point calls
-- `app.require_org` and `app.require_permission` itself, so a direct call can
-- only ever do what the caller is already allowed to do — and a shop that
-- blocked direct calls would have to trust the wrapper instead of the function.
-- The helpers in `app` are a different matter: nothing outside this plugin
-- should call them at all.
revoke execute on function app.serial_numbers_config(uuid) from public, anon, authenticated;
revoke execute on function app.serial_numbers_tracked(uuid, uuid) from public, anon, authenticated;
revoke execute on function app.serial_numbers_sale_lines(uuid, uuid) from public, anon, authenticated;
revoke execute on function app.serial_numbers_next_code(uuid, text) from public, anon, authenticated;
revoke execute on function app.serial_numbers_pending(uuid, integer, integer) from public, anon, authenticated;

revoke all on function public.serial_numbers_overview(uuid, jsonb) from public, anon;
revoke all on function public.serial_numbers_catalog(uuid, jsonb) from public, anon;
revoke all on function public.serial_numbers_variants(uuid, jsonb) from public, anon;
revoke all on function public.serial_numbers_add(uuid, jsonb) from public, anon;
revoke all on function public.serial_numbers_list(uuid, jsonb) from public, anon;
revoke all on function public.serial_numbers_for_sale(uuid, jsonb) from public, anon;
revoke all on function public.serial_numbers_capture(uuid, jsonb) from public, anon;
revoke all on function public.serial_numbers_autofill(uuid, jsonb) from public, anon;
revoke all on function public.serial_numbers_release(uuid, jsonb) from public, anon;
revoke all on function public.serial_numbers_sync_refunds(uuid, jsonb) from public, anon;
revoke all on function public.serial_numbers_pending(uuid, jsonb) from public, anon;
revoke all on function public.serial_numbers_report(uuid, jsonb) from public, anon;

grant execute on function public.serial_numbers_overview(uuid, jsonb) to authenticated;
grant execute on function public.serial_numbers_catalog(uuid, jsonb) to authenticated;
grant execute on function public.serial_numbers_variants(uuid, jsonb) to authenticated;
grant execute on function public.serial_numbers_add(uuid, jsonb) to authenticated;
grant execute on function public.serial_numbers_list(uuid, jsonb) to authenticated;
grant execute on function public.serial_numbers_for_sale(uuid, jsonb) to authenticated;
grant execute on function public.serial_numbers_capture(uuid, jsonb) to authenticated;
grant execute on function public.serial_numbers_autofill(uuid, jsonb) to authenticated;
grant execute on function public.serial_numbers_release(uuid, jsonb) to authenticated;
grant execute on function public.serial_numbers_sync_refunds(uuid, jsonb) to authenticated;
grant execute on function public.serial_numbers_pending(uuid, jsonb) to authenticated;
grant execute on function public.serial_numbers_report(uuid, jsonb) to authenticated;
