create or replace function app.variants_config(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_max integer := 200;
  v_json jsonb;
begin
  select p.config -> 'max_variants' into v_json
    from public.plugins p
   where p.organization_id = p_organization_id
     and p.plugin_key = 'variants';

  if v_json is not null and jsonb_typeof(v_json) = 'number' then
    v_max := greatest(1, least(2000, (v_json::text)::integer));
  end if;

  return jsonb_build_object('max_variants', v_max);
end
$fn$;

-- A stable, readable code for an option value: `Red / XL` → `red-xl`. Two
-- values that collapse to the same code keep their own ids, so the code is a
-- convenience and never an identity.
create or replace function app.variants_code(p_text text)
returns text
language sql
immutable
as $fn$
  select coalesce(nullif(btrim(regexp_replace(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g')), ''), 'value');
$fn$;

-- The generator's plan: every combination of the selected values. Used for the
-- preview (shown before anything is written) and again inside the transaction
-- that actually creates the variants, so what the shopkeeper saw is exactly
-- what they get. Pure: no writes, no side effects.
create or replace function app.variants_plan(
  p_organization_id uuid,
  p_product_id uuid,
  p_axes jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_axes jsonb;
  v_axis record;
  v_value_ids uuid[];
  v_value_names text[];
  v_combos jsonb[];
  v_heads jsonb := '[]'::jsonb;
  v_combo jsonb;
  v_head jsonb;
  v_existing uuid;
  v_i integer;
  v_rows jsonb := '[]'::jsonb;
  v_suffix text;
  v_seen_suffixes text[] := '{}';
begin
  -- The caller's axes win when it has them: the product form previews the axes
  -- on screen, saved or not. With nothing to go on, the planner reads what the
  -- shop saved. Either way the rest of this function sees one shape, so a
  -- preview and the build that follows it cannot disagree.
  v_axes := case
    when jsonb_typeof(p_axes) = 'array' and jsonb_array_length(p_axes) > 0 then p_axes
    else coalesce((
      select jsonb_agg(
               jsonb_build_object('option_type_id', a.option_type_id, 'value_ids', a.value_ids)
               order by a.sort_order, a.option_type_id)
        from public.plg_variants_product_axes a
       where a.organization_id = p_organization_id
         and a.product_id = p_product_id), '[]'::jsonb)
  end;

  for v_axis in
    select axes.pos,
           (axes.value ->> 'option_type_id')::uuid as option_type_id,
           (select t.name from public.product_option_types t
             where t.id = (axes.value ->> 'option_type_id')::uuid
               and t.organization_id = p_organization_id) as name,
           jsonb_array_length(coalesce(axes.value -> 'value_ids', '[]'::jsonb)) as requested,
           (select array_agg(x.id order by x.sort_order, x.value)
              from public.product_option_values x
             where x.option_type_id = (axes.value ->> 'option_type_id')::uuid
               and x.id in (
                 select (elem)::uuid
                   from jsonb_array_elements_text(coalesce(axes.value -> 'value_ids', '[]'::jsonb)) as elem
               )) as ids,
           (select array_agg(x.value order by x.sort_order, x.value)
              from public.product_option_values x
             where x.option_type_id = (axes.value ->> 'option_type_id')::uuid
               and x.id in (
                 select (elem)::uuid
                   from jsonb_array_elements_text(coalesce(axes.value -> 'value_ids', '[]'::jsonb)) as elem
               )) as names
      from jsonb_array_elements(v_axes) with ordinality as axes(value, pos)
     order by axes.pos
  loop
    v_value_ids := v_axis.ids;
    v_value_names := v_axis.names;

    if v_axis.name is null then
      raise exception 'variants_unknown_option_type: %', v_axis.option_type_id
        using errcode = 'P0001';
    end if;

    if v_axis.requested > 0
       and coalesce(array_length(v_value_ids, 1), 0) <> v_axis.requested then
      raise exception 'variants_unknown_option_value: a selected value does not belong to option "%"',
        v_axis.name using errcode = 'P0001';
    end if;

    if v_value_ids is null or array_length(v_value_ids, 1) = 0 then
      raise exception 'variants_axis_empty: option "%" has no values selected',
        v_axis.name using errcode = 'P0001';
    end if;

    v_combos := array[]::jsonb[];
    if jsonb_array_length(v_heads) = 0 then
      for v_i in 1 .. array_length(v_value_ids, 1) loop
        v_combos := v_combos || jsonb_build_object(
          'ids', jsonb_build_array(v_value_ids[v_i]::text),
          'names', jsonb_build_array(v_value_names[v_i]));
      end loop;
    else
      for v_head in select value from jsonb_array_elements(v_heads) loop
        for v_i in 1 .. array_length(v_value_ids, 1) loop
          v_combos := v_combos || jsonb_build_object(
            'ids', (v_head -> 'ids') || jsonb_build_array(v_value_ids[v_i]::text),
            'names', (v_head -> 'names') || jsonb_build_array(v_value_names[v_i]));
        end loop;
      end loop;
    end if;

    select coalesce(jsonb_agg(combo), '[]'::jsonb) into v_heads
      from unnest(v_combos) as combo;
  end loop;

  for v_combo in select value from jsonb_array_elements(v_heads) loop
    v_suffix := array_to_string(
      array(select jsonb_array_elements_text(v_combo -> 'names')), ' / ');

    if v_suffix = any(v_seen_suffixes) then
      raise exception 'variants_duplicate_combination: "%" appears twice in this plan',
        v_suffix using errcode = 'P0001';
    end if;
    v_seen_suffixes := v_seen_suffixes || v_suffix;

    select pv.id into v_existing
      from public.product_variants pv
     where pv.organization_id = p_organization_id
       and pv.product_id = p_product_id
       and pv.deleted_at is null
       and pv.option_values @> (
         select jsonb_object_agg(t.name, x.value)
           from jsonb_array_elements_text(v_combo -> 'ids') as elem
           join public.product_option_values x on x.id = (elem)::uuid
           join public.product_option_types t on t.id = x.option_type_id
       )
     limit 1;
    if not found then
      v_existing := null;
    end if;

    v_rows := v_rows || jsonb_build_object(
      'suffix', v_suffix,
      'option_values', (
        select jsonb_object_agg(t.name, x.value)
          from jsonb_array_elements_text(v_combo -> 'ids') as elem
          join public.product_option_values x on x.id = (elem)::uuid
          join public.product_option_types t on t.id = x.option_type_id
      ),
      'value_ids', v_combo -> 'ids',
      'exists', v_existing is not null
    );
  end loop;

  return jsonb_build_object(
    'rows', v_rows,
    'total', jsonb_array_length(v_rows),
    'new', (select count(*) from jsonb_array_elements(v_rows) r where (r ->> 'exists')::boolean is not true)
  );
end
$fn$;

-- Everything the product form's Variations section needs, in one call: the
-- product's axes with their values expanded, every variant it has, and what
-- each variant inherits when it carries no override.
create or replace function app.variants_product_state(
  p_organization_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_product public.products;
  v_axes jsonb;
  v_variants jsonb;
begin
  select p.* into v_product
    from public.products p
   where p.id = p_product_id
     and p.organization_id = p_organization_id;

  if not found then
    raise exception 'variants_unknown_product: %', p_product_id using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'option_type_id', a.option_type_id,
           'name', t.name,
           'sort_order', a.sort_order,
           'value_ids', a.value_ids,
           'values', coalesce((
             select jsonb_agg(jsonb_build_object('id', x.id, 'value', x.value) order by x.sort_order, x.value)
               from public.product_option_values x
              where x.option_type_id = a.option_type_id
                and x.id in (select (elem)::uuid from jsonb_array_elements_text(a.value_ids) as elem)
           ), '[]'::jsonb)
         ) order by a.sort_order, t.name), '[]'::jsonb)
    into v_axes
    from public.plg_variants_product_axes a
    join public.product_option_types t on t.id = a.option_type_id
   where a.organization_id = p_organization_id
     and a.product_id = p_product_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', pv.id,
           'name_suffix', pv.name_suffix,
           'sku', pv.sku,
           'option_values', pv.option_values,
           'price_override', case when pv.price_override is null then null
                                  else round(pv.price_override * 100)::bigint end,
           'cost_override', case when pv.cost_override is null then null
                                 else round(pv.cost_override * 10000)::bigint end,
           'image_url', pv.image_url,
           'is_active', pv.is_active,
           'is_default', pv.is_default,
           'price', round(coalesce(pv.price_override, v_product.selling_price) * 100)::bigint,
           'cost', round(coalesce(pv.cost_override, v_product.cost_price) * 10000)::bigint
         ) order by pv.name_suffix nulls first, pv.created_at), '[]'::jsonb)
    into v_variants
    from public.product_variants pv
   where pv.organization_id = p_organization_id
     and pv.product_id = p_product_id
     and pv.deleted_at is null;

  return jsonb_build_object(
    'product', jsonb_build_object(
      'id', v_product.id,
      'name', v_product.name,
      'sku', v_product.sku,
      'price', round(v_product.selling_price * 100)::bigint,
      'cost', round(v_product.cost_price * 10000)::bigint
    ),
    'axes', v_axes,
    'variants', v_variants
  );
end
$fn$;

-- The shop's ceiling on one product's matrix, in one place: the preview, the
-- build, and saving the axes all refuse with the same numbers.
create or replace function app.variants_assert_limit(
  p_organization_id uuid,
  p_total integer
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_allowed integer := (app.variants_config(p_organization_id) ->> 'max_variants')::integer;
begin
  if coalesce(p_total, 0) > v_allowed then
    raise exception 'variants_limit_exceeded: % combinations is more than this shop allows (%)',
      p_total, v_allowed using errcode = 'P0001';
  end if;
end
$fn$;

-- ── The plugin's public surface ───────────────────────────────────────────
--
-- Every function below is reached through `public.plugin_rpc(org, 'variants',
-- <fn>, args)`, which resolves the name to `public.variants_<fn>` and requires
-- the plugin to be enabled. Each one re-checks the organization and the
-- permission itself, because `security definer` means the RPC bridge's checks
-- are the only thing standing between a caller and these writes.

create or replace function public.variants_catalog(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('variants.view');

  return jsonb_build_object(
    'types', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'name', t.name,
               'sort_order', t.sort_order,
               'values', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', x.id, 'value', x.value, 'sort_order', x.sort_order)
                        order by x.sort_order, x.value)
                   from public.product_option_values x
                  where x.option_type_id = t.id), '[]'::jsonb),
               'products', (
                 select count(*)
                   from public.plg_variants_product_axes a
                  where a.organization_id = p_organization_id
                    and a.option_type_id = t.id)
             ) order by t.sort_order, t.name)
        from public.product_option_types t
       where t.organization_id = p_organization_id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'types', (select count(*) from public.product_option_types t
                 where t.organization_id = p_organization_id),
      'values', (select count(*) from public.product_option_values x
                  where x.organization_id = p_organization_id),
      'products', (select count(distinct a.product_id)
                     from public.plg_variants_product_axes a
                    where a.organization_id = p_organization_id),
      'variants', (select count(*) from public.product_variants pv
                    where pv.organization_id = p_organization_id
                      and pv.deleted_at is null
                      and pv.option_values <> '{}'::jsonb)
    ),
    'config', app.variants_config(p_organization_id)
  );
end
$fn$;

create or replace function public.variants_overview(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_limit integer := greatest(1, least(200, coalesce((p_args ->> 'limit')::integer, 50)));
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('variants.view');

  return jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(entry order by entry ->> 'name')
        from (
          select jsonb_build_object(
                   'product_id', p.id,
                   'name', p.name,
                   'sku', p.sku,
                   'axes', (
                     select count(*)
                       from public.plg_variants_product_axes a
                      where a.organization_id = p_organization_id
                        and a.product_id = p.id),
                   'variants', (
                     select count(*)
                       from public.product_variants pv
                      where pv.organization_id = p_organization_id
                        and pv.product_id = p.id
                        and pv.deleted_at is null)
                 ) as entry
            from public.products p
           where p.organization_id = p_organization_id
             and p.deleted_at is null
             and exists (
               select 1 from public.product_variants pv
                where pv.product_id = p.id
                  and pv.option_values <> '{}'::jsonb)
           order by p.name
           limit v_limit
        ) entries), '[]'::jsonb)
  );
end
$fn$;

create or replace function public.variants_save_type(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid := nullif(p_args ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p_args ->> 'name', ''));
  v_sort integer := (p_args ->> 'sort_order')::integer;
  v_old_name text;
  v_created boolean := false;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('variants.manage');

  if v_name = '' then
    raise exception 'variants_invalid_args: an option needs a name' using errcode = 'P0001';
  end if;

  if v_id is null then
    -- Typed in order and kept in that order: an option added without a
    -- sort_order lands after the ones already there, so a shopkeeper who types
    -- Size, then Colour, sees Size first.
    v_sort := coalesce(
      v_sort,
      (select max(t.sort_order) + 1
         from public.product_option_types t
        where t.organization_id = p_organization_id),
      1);

    insert into public.product_option_types (organization_id, name, sort_order)
    values (p_organization_id, v_name, v_sort)
    on conflict (organization_id, name) do update
       set sort_order = excluded.sort_order
    returning id into v_id;
    v_created := true;
  else
    select t.name into v_old_name
      from public.product_option_types t
     where t.id = v_id
       and t.organization_id = p_organization_id;

    if not found then
      raise exception 'variants_unknown_option_type: %', v_id using errcode = 'P0001';
    end if;

    update public.product_option_types t
       set name = v_name,
           sort_order = coalesce(v_sort, t.sort_order)
     where t.id = v_id
       and t.organization_id = p_organization_id;

    -- A rename rewrites the keys already stamped on this shop's variants, so a
    -- variant's option values can never outlive the option name they were
    -- built from.
    if v_old_name is distinct from v_name then
      update public.product_variants pv
         set option_values = (pv.option_values - v_old_name)
                             || jsonb_build_object(v_name, pv.option_values -> v_old_name)
       where pv.organization_id = p_organization_id
         and pv.option_values ? v_old_name;
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'name', v_name, 'created', v_created);
end
$fn$;

create or replace function public.variants_delete_type(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid := nullif(p_args ->> 'id', '')::uuid;
  v_name text;
  v_on_products integer := 0;
  v_on_variants integer := 0;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('variants.manage');

  select t.name into v_name
    from public.product_option_types t
   where t.id = v_id
     and t.organization_id = p_organization_id;

  if not found then
    raise exception 'variants_unknown_option_type: %', v_id using errcode = 'P0001';
  end if;

  select count(*) into v_on_products
    from public.plg_variants_product_axes a
   where a.organization_id = p_organization_id
     and a.option_type_id = v_id;

  if v_on_products > 0 then
    raise exception 'variants_option_type_in_use: "%" is used by % product(s). Remove it from them first.',
      v_name, v_on_products using errcode = 'P0001';
  end if;

  select count(*) into v_on_variants
    from public.product_variants pv
   where pv.organization_id = p_organization_id
     and pv.option_values ? v_name;

  if v_on_variants > 0 then
    raise exception 'variants_option_type_in_use: % variant(s) still carry a "%" value.',
      v_on_variants, v_name using errcode = 'P0001';
  end if;

  delete from public.product_option_types t
   where t.id = v_id
     and t.organization_id = p_organization_id;

  return jsonb_build_object('id', v_id, 'deleted', true);
end
$fn$;

create or replace function public.variants_save_value(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid := nullif(p_args ->> 'id', '')::uuid;
  v_type uuid := nullif(p_args ->> 'option_type_id', '')::uuid;
  v_value text := btrim(coalesce(p_args ->> 'value', ''));
  v_sort integer := (p_args ->> 'sort_order')::integer;
  v_created boolean := false;
  v_old_value text;
  v_type_name text;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('variants.manage');

  if v_value = '' then
    raise exception 'variants_invalid_args: a value needs text' using errcode = 'P0001';
  end if;

  if v_id is null then
    if v_type is null then
      raise exception 'variants_invalid_args: option_type_id is required' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.product_option_types t
       where t.id = v_type and t.organization_id = p_organization_id
    ) then
      raise exception 'variants_unknown_option_type: %', v_type using errcode = 'P0001';
    end if;

    v_sort := coalesce(
      v_sort,
      (select max(x.sort_order) + 1
         from public.product_option_values x
        where x.option_type_id = v_type
          and x.organization_id = p_organization_id),
      1);

    insert into public.product_option_values
          (organization_id, option_type_id, value, sort_order)
    values (p_organization_id, v_type, v_value, v_sort)
    on conflict (option_type_id, value) do update
       set sort_order = excluded.sort_order
    returning id into v_id;
    v_created := true;
  else
    select x.value, t.name into v_old_value, v_type_name
      from public.product_option_values x
      join public.product_option_types t on t.id = x.option_type_id
     where x.id = v_id
       and x.organization_id = p_organization_id;

    if not found then
      raise exception 'variants_unknown_option_value: %', v_id using errcode = 'P0001';
    end if;

    update public.product_option_values x
       set value = v_value,
           sort_order = coalesce(v_sort, x.sort_order)
     where x.id = v_id
       and x.organization_id = p_organization_id;

    -- A typo fixed in the picker is fixed on every variant already carrying it,
    -- so a variant's option values never point at a value that no longer exists.
    if v_old_value is distinct from v_value then
      update public.product_variants pv
         set option_values = jsonb_set(pv.option_values, array[v_type_name], to_jsonb(v_value))
       where pv.organization_id = p_organization_id
         and pv.option_values ->> v_type_name = v_old_value;
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'value', v_value, 'created', v_created);
end
$fn$;

create or replace function public.variants_delete_value(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid := nullif(p_args ->> 'id', '')::uuid;
  v_value text;
  v_used integer := 0;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('variants.manage');

  select x.value into v_value
    from public.product_option_values x
   where x.id = v_id
     and x.organization_id = p_organization_id;

  if not found then
    raise exception 'variants_unknown_option_value: %', v_id using errcode = 'P0001';
  end if;

  select count(*) into v_used
    from public.plg_variants_product_axes a
   where a.organization_id = p_organization_id
     and a.value_ids @> jsonb_build_array(v_id::text);

  if v_used > 0 then
    raise exception 'variants_option_value_in_use: "%" is used by % product(s).',
      v_value, v_used using errcode = 'P0001';
  end if;

  select count(*) into v_used
    from public.product_variants pv
   where pv.organization_id = p_organization_id
     and exists (
       select 1 from jsonb_each_text(pv.option_values) e
        where e.value = v_value);

  if v_used > 0 then
    raise exception 'variants_option_value_in_use: % variant(s) still carry "%".',
      v_used, v_value using errcode = 'P0001';
  end if;

  delete from public.product_option_values x
   where x.id = v_id
     and x.organization_id = p_organization_id;

  return jsonb_build_object('id', v_id, 'deleted', true);
end
$fn$;

create or replace function public.variants_axes(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_product uuid := nullif(p_args ->> 'product_id', '')::uuid;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('variants.view');

  if v_product is null then
    raise exception 'variants_invalid_args: product_id is required' using errcode = 'P0001';
  end if;

  return app.variants_product_state(p_organization_id, v_product);
end
$fn$;

create or replace function public.variants_set_axes(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_product uuid := nullif(p_args ->> 'product_id', '')::uuid;
  v_axis jsonb;
  v_type uuid;
  v_value_ids jsonb;
  v_clean jsonb;
  v_seen text[] := '{}';
  v_order integer := 0;
  v_plan jsonb;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('variants.manage');

  if v_product is null then
    raise exception 'variants_invalid_args: product_id is required' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.products p
     where p.id = v_product and p.organization_id = p_organization_id and p.deleted_at is null
  ) then
    raise exception 'variants_unknown_product: %', v_product using errcode = 'P0001';
  end if;

  if p_args -> 'axes' is null or jsonb_typeof(p_args -> 'axes') <> 'array' then
    raise exception 'variants_invalid_args: axes must be an array' using errcode = 'P0001';
  end if;

  -- Everything is validated before anything is written: an axis naming an
  -- option this shop does not have, or a combination larger than the shop's
  -- limit, leaves the product exactly as it was.
  for v_axis in select value from jsonb_array_elements(p_args -> 'axes') loop
    v_type := nullif(v_axis ->> 'option_type_id', '')::uuid;
    if v_type is null then
      raise exception 'variants_invalid_args: every axis needs an option_type_id' using errcode = 'P0001';
    end if;
    if v_type::text = any(v_seen) then
      raise exception 'variants_duplicate_axis: the same option appears twice' using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_type::text;

    if not exists (
      select 1 from public.product_option_types t
       where t.id = v_type and t.organization_id = p_organization_id
    ) then
      raise exception 'variants_unknown_option_type: %', v_type using errcode = 'P0001';
    end if;

    v_value_ids := coalesce(v_axis -> 'value_ids', '[]'::jsonb);
    if jsonb_typeof(v_value_ids) <> 'array' or jsonb_array_length(v_value_ids) = 0 then
      raise exception 'variants_axis_empty: every option needs at least one value' using errcode = 'P0001';
    end if;

    select coalesce(jsonb_agg(x.id order by x.sort_order, x.value), '[]'::jsonb)
      into v_clean
      from public.product_option_values x
     where x.option_type_id = v_type
       and x.organization_id = p_organization_id
       and x.id in (select (elem)::uuid from jsonb_array_elements_text(v_value_ids) as elem);

    if jsonb_array_length(v_clean) <> jsonb_array_length(v_value_ids) then
      raise exception 'variants_unknown_option_value: a selected value does not belong to this option'
        using errcode = 'P0001';
    end if;
  end loop;

  delete from public.plg_variants_product_axes a
   where a.organization_id = p_organization_id
     and a.product_id = v_product
     and a.option_type_id::text <> all (v_seen);

  for v_axis in select value from jsonb_array_elements(p_args -> 'axes') loop
    v_type := (v_axis ->> 'option_type_id')::uuid;
    select coalesce(jsonb_agg(x.id order by x.sort_order, x.value), '[]'::jsonb)
      into v_clean
      from public.product_option_values x
     where x.option_type_id = v_type
       and x.organization_id = p_organization_id
       and x.id in (
         select (elem)::uuid
           from jsonb_array_elements_text(coalesce(v_axis -> 'value_ids', '[]'::jsonb)) as elem);

    insert into public.plg_variants_product_axes
          (organization_id, product_id, option_type_id, value_ids, sort_order)
    values (p_organization_id, v_product, v_type, v_clean, v_order)
    on conflict (product_id, option_type_id) do update
       set value_ids = excluded.value_ids,
           sort_order = excluded.sort_order;

    v_order := v_order + 1;
  end loop;

  v_plan := app.variants_plan(p_organization_id, v_product, p_args -> 'axes');
  perform app.variants_assert_limit(p_organization_id, (v_plan ->> 'total')::integer);

  return app.variants_product_state(p_organization_id, v_product);
end
$fn$;

create or replace function public.variants_preview(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_product uuid := nullif(p_args ->> 'product_id', '')::uuid;
  v_plan jsonb;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('variants.view');

  if v_product is null then
    raise exception 'variants_invalid_args: product_id is required' using errcode = 'P0001';
  end if;

  v_plan := app.variants_plan(p_organization_id, v_product, p_args -> 'axes');
  perform app.variants_assert_limit(p_organization_id, (v_plan ->> 'total')::integer);

  return v_plan
         || jsonb_build_object(
              'limit', (app.variants_config(p_organization_id) ->> 'max_variants')::integer);
end
$fn$;

create or replace function public.variants_generate(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_product uuid := nullif(p_args ->> 'product_id', '')::uuid;
  v_plan jsonb;
  v_row jsonb;
  v_new integer := 0;
  v_existing integer := 0;
  v_default_count integer;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('variants.manage');

  if v_product is null then
    raise exception 'variants_invalid_args: product_id is required' using errcode = 'P0001';
  end if;

  if p_args ? 'axes' then
    perform public.variants_set_axes(p_organization_id, p_args);
  end if;

  v_plan := app.variants_plan(
    p_organization_id, v_product, coalesce(p_args -> 'axes', '[]'::jsonb));

  if coalesce((v_plan ->> 'total')::integer, 0) = 0 then
    raise exception 'variants_axis_empty: choose at least one option and one value'
      using errcode = 'P0001';
  end if;

  perform app.variants_assert_limit(p_organization_id, (v_plan ->> 'total')::integer);

  -- All-or-nothing, decided before a single row is written: a generator that
  -- left fourteen of eighteen combinations behind would be worse than one that
  -- refused and said why.
  select count(*) into v_existing
    from jsonb_array_elements(v_plan -> 'rows') r
   where (r ->> 'exists')::boolean is true;
  v_new := (v_plan ->> 'total')::integer - v_existing;

  if v_new > 0 and v_existing > 0 then
    raise exception 'variants_partial_combination: % of % combinations already exist. Include every value, or remove the ones that already have variants.',
      v_existing, (v_plan ->> 'total') using errcode = 'P0001';
  end if;

  if v_new = 0 then
    return (app.variants_product_state(p_organization_id, v_product))
           || jsonb_build_object('created', 0, 'skipped', v_existing);
  end if;

  for v_row in select value from jsonb_array_elements(v_plan -> 'rows') loop
    if (v_row ->> 'exists')::boolean is true then
      continue;
    end if;

    insert into public.product_variants
          (organization_id, product_id, name_suffix, sku, option_values, is_default, is_active)
    values (
      p_organization_id,
      v_product,
      v_row ->> 'suffix',
      -- A suffix that reads the same twice still gets a distinct, stable SKU.
      app.variants_code(v_row ->> 'suffix')
        || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)),
      v_row -> 'option_values',
      false,
      true
    );
  end loop;

  select count(*) into v_default_count
    from public.product_variants pv
   where pv.organization_id = p_organization_id
     and pv.product_id = v_product
     and pv.deleted_at is null
     and pv.is_default;

  if v_default_count = 0 then
    update public.product_variants pv
       set is_default = true
     where pv.organization_id = p_organization_id
       and pv.product_id = v_product
       and pv.deleted_at is null
       and pv.name_suffix is not null
       and pv.id = (
         select pv2.id from public.product_variants pv2
          where pv2.organization_id = p_organization_id
            and pv2.product_id = v_product
            and pv2.deleted_at is null
            and pv2.name_suffix is not null
          order by pv2.name_suffix
          limit 1);
  end if;

  return (app.variants_product_state(p_organization_id, v_product)) || jsonb_build_object(
    'created', v_new,
    'skipped', v_existing
  );
end
$fn$;

create or replace function public.variants_update(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_variant uuid := nullif(p_args ->> 'variant_id', '')::uuid;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('variants.manage');

  if v_variant is null then
    raise exception 'variants_invalid_args: variant_id is required' using errcode = 'P0001';
  end if;

  -- An empty string clears an override back to "inherit the product" — the
  -- dialog's blank field means exactly that, and JSON null may not reach here.
  update public.product_variants pv
     set sku = case when p_args ? 'sku' then nullif(btrim(p_args ->> 'sku'), '') else pv.sku end,
         name_suffix = case when p_args ? 'name_suffix' then nullif(btrim(p_args ->> 'name_suffix'), '') else pv.name_suffix end,
         price_override = case
           when p_args ? 'price_override' then
             case when coalesce(p_args ->> 'price_override', '') = '' then null
                  else ((p_args ->> 'price_override')::numeric / 100)::numeric(14,2) end
           else pv.price_override end,
         cost_override = case
           when p_args ? 'cost_override' then
             case when coalesce(p_args ->> 'cost_override', '') = '' then null
                  else ((p_args ->> 'cost_override')::numeric / 10000)::numeric(14,4) end
           else pv.cost_override end,
         image_url = case when p_args ? 'image_url' then nullif(btrim(p_args ->> 'image_url'), '') else pv.image_url end,
         is_active = case when p_args ? 'is_active' then coalesce((p_args ->> 'is_active')::boolean, true) else pv.is_active end
   where pv.id = v_variant
     and pv.organization_id = p_organization_id
     and pv.deleted_at is null;

  if not found then
    raise exception 'variants_unknown_variant: %', v_variant using errcode = 'P0001';
  end if;

  return jsonb_build_object('variant_id', v_variant, 'updated', true);
end
$fn$;

-- Re-pricing the matrix in one call. The rows are the variants that carry
-- option values: a variant with none is the product itself, and the product's
-- own price is not something "all variants +10%" should move behind the
-- shopkeeper's back.
create or replace function public.variants_bulk(
  p_organization_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_product uuid := nullif(p_args ->> 'product_id', '')::uuid;
  v_field text := coalesce(p_args ->> 'field', 'price');
  v_mode text := coalesce(p_args ->> 'mode', 'set');
  v_value numeric := coalesce((p_args ->> 'value')::numeric, 0);
  v_only_inherited boolean := coalesce((p_args ->> 'only_inherited')::boolean, false);
  v_affected integer := 0;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('variants.manage');

  if v_product is null then
    raise exception 'variants_invalid_args: product_id is required' using errcode = 'P0001';
  end if;

  if v_field not in ('price', 'cost') then
    raise exception 'variants_invalid_args: field must be price or cost' using errcode = 'P0001';
  end if;

  if v_mode not in ('set', 'percent') then
    raise exception 'variants_invalid_args: mode must be set or percent' using errcode = 'P0001';
  end if;

  if v_field = 'price' then
    if v_mode = 'set' then
      update public.product_variants pv
         set price_override = (v_value / 100)::numeric(14,2)
       where pv.organization_id = p_organization_id
         and pv.product_id = v_product
         and pv.deleted_at is null
         and pv.option_values <> '{}'::jsonb
         and (not v_only_inherited or pv.price_override is null);
    else
      update public.product_variants pv
         set price_override = round(
               coalesce(pv.price_override, p.selling_price) * (1 + v_value / 100), 2)::numeric(14,2)
        from public.products p
       where p.id = pv.product_id
         and pv.organization_id = p_organization_id
         and pv.product_id = v_product
         and pv.deleted_at is null
         and pv.option_values <> '{}'::jsonb
         and (not v_only_inherited or pv.price_override is null);
    end if;
  else
    if v_mode = 'set' then
      update public.product_variants pv
         set cost_override = (v_value / 10000)::numeric(14,4)
       where pv.organization_id = p_organization_id
         and pv.product_id = v_product
         and pv.deleted_at is null
         and pv.option_values <> '{}'::jsonb
         and (not v_only_inherited or pv.cost_override is null);
    else
      update public.product_variants pv
         set cost_override = round(
               coalesce(pv.cost_override, p.cost_price) * (1 + v_value / 100), 4)::numeric(14,4)
        from public.products p
       where p.id = pv.product_id
         and pv.organization_id = p_organization_id
         and pv.product_id = v_product
         and pv.deleted_at is null
         and pv.option_values <> '{}'::jsonb
         and (not v_only_inherited or pv.cost_override is null);
    end if;
  end if;

  get diagnostics v_affected = row_count;

  return jsonb_build_object(
    'field', v_field,
    'mode', v_mode,
    'only_inherited', v_only_inherited,
    'updated', v_affected
  );
end
$fn$;

-- The private helpers are reachable only from inside the public functions
-- below (which run as the definer), never from the API surface itself.
revoke execute on function app.variants_config(uuid) from public, anon, authenticated;
revoke execute on function app.variants_assert_limit(uuid, integer) from public, anon, authenticated;
revoke execute on function app.variants_code(text) from public, anon, authenticated;
revoke execute on function app.variants_plan(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function app.variants_product_state(uuid, uuid) from public, anon, authenticated;

-- Reached only through `public.plugin_rpc`, which resolves the name itself.
-- `anon` gets nothing: this plugin has no anonymous surface.
revoke all on function public.variants_catalog(uuid, jsonb) from public;
revoke all on function public.variants_overview(uuid, jsonb) from public;
revoke all on function public.variants_save_type(uuid, jsonb) from public;
revoke all on function public.variants_delete_type(uuid, jsonb) from public;
revoke all on function public.variants_save_value(uuid, jsonb) from public;
revoke all on function public.variants_delete_value(uuid, jsonb) from public;
revoke all on function public.variants_axes(uuid, jsonb) from public;
revoke all on function public.variants_set_axes(uuid, jsonb) from public;
revoke all on function public.variants_preview(uuid, jsonb) from public;
revoke all on function public.variants_generate(uuid, jsonb) from public;
revoke all on function public.variants_update(uuid, jsonb) from public;
revoke all on function public.variants_bulk(uuid, jsonb) from public;

grant execute on function public.variants_catalog(uuid, jsonb) to authenticated;
grant execute on function public.variants_overview(uuid, jsonb) to authenticated;
grant execute on function public.variants_save_type(uuid, jsonb) to authenticated;
grant execute on function public.variants_delete_type(uuid, jsonb) to authenticated;
grant execute on function public.variants_save_value(uuid, jsonb) to authenticated;
grant execute on function public.variants_delete_value(uuid, jsonb) to authenticated;
grant execute on function public.variants_axes(uuid, jsonb) to authenticated;
grant execute on function public.variants_set_axes(uuid, jsonb) to authenticated;
grant execute on function public.variants_preview(uuid, jsonb) to authenticated;
grant execute on function public.variants_generate(uuid, jsonb) to authenticated;
grant execute on function public.variants_update(uuid, jsonb) to authenticated;
grant execute on function public.variants_bulk(uuid, jsonb) to authenticated;
