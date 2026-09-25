-- 048 — the plugin product projection, repaired.
--
-- `public.plugin_products` (034) has been reading `p.price`, a column
-- `products` has not had since the money work renamed it. On the live database
-- that is not a subtlety: the body is parsed when it *runs*, not when it is
-- created, so the function exists, looks fine in a catalogue dump, and raises
--
--     column p.price does not exist
--
-- the moment a plugin calls `db.products()`. Every plugin that reads products
-- has therefore been quietly doing without them — Batch & Expiry's watch list
-- and its dashboard tile have been showing an empty shop — because both of
-- them catch the failure and render "nothing to see" rather than an error.
--
-- The offline validator could not catch it, and that is worth writing down
-- rather than fixing silently: `npm run validate:migrations` builds its
-- database from these files and only calls the functions it has assertions
-- for. A green check is not a migration (docs/10).
--
-- Two changes, both small:
--
--   * `selling_price` is the column, and it is money, so it crosses as **minor
--     units** — the same integer convention as every other money value a
--     client decodes. A plugin should not have to know how many decimals a
--     currency has, and `0.00` in a float is how reports drift.
--
--   * the shape stays exactly as it was. A projection is a promise to plugins,
--     including any third party's, so this is a repair and not a redesign.

create or replace function public.plugin_products(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid := p_organization_id;
begin
  perform app.require_org(v_org);
  perform app.require_permission('products.view');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id,
             'name', p.name,
             'sku', p.sku,
             -- Minor units, like every money value that crosses to a client.
             'price', case
                        when p.selling_price is null then null
                        else round(p.selling_price * 100)::bigint
                      end,
             'track_stock', p.track_stock,
             'is_active', p.is_active,
             'reorder_point', p.reorder_point,
             -- Plugin fields live in metadata (docs/05 §5), so this is the
             -- column a plugin actually reads.
             'metadata', coalesce(p.metadata, '{}'::jsonb)
           ) order by p.name)
      from public.products p
     where p.organization_id = v_org
       and p.deleted_at is null
  ), '[]'::jsonb);
end
$fn$;

comment on function public.plugin_products(uuid) is
  'Products as a plugin may read them (migration 034, repaired in 048): the '
  'fields a plugin can legitimately care about, with money in minor units.';
