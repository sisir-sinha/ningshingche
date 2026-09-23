-- 005 — Catalogue: categories, brands, units, products, variants, barcodes.
--
-- The default-variant rule (docs/04 §2): every product has at least one
-- variant row. Products without options get a single anonymous variant with
-- is_default = true. That keeps variant_id NOT NULL everywhere downstream and
-- removes null-handling from the entire inventory engine.

create table public.product_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id       uuid references public.product_categories(id) on delete set null,
  name            text not null,
  slug            text not null,
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, parent_id, slug),
  constraint categories_no_self_parent check (parent_id is distinct from id)
);

create trigger product_categories_updated_at
  before update on public.product_categories
  for each row execute function public.set_updated_at();

create index product_categories_org_idx
  on public.product_categories(organization_id, parent_id)
  where deleted_at is null;

create table public.product_brands (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create trigger product_brands_updated_at
  before update on public.product_brands
  for each row execute function public.set_updated_at();

create table public.product_units (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,          -- 'Each','kg','Litre','Dozen','Metre'
  symbol          text not null,          -- 'ea','kg','L','dz','m'
  is_decimal      boolean not null default false,  -- weight/volume-sold?
  sort_order      integer not null default 0,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.taxes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  rate            numeric(6,4) not null check (rate >= 0 and rate <= 100),
  is_inclusive    boolean not null default false,
  applies_to      text not null default 'products'
                    check (applies_to in ('products', 'services', 'both')),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create trigger taxes_updated_at
  before update on public.taxes
  for each row execute function public.set_updated_at();

create table public.products (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  category_id       uuid references public.product_categories(id),
  brand_id          uuid references public.product_brands(id),
  unit_id           uuid references public.product_units(id),
  tax_id            uuid references public.taxes(id),
  name              text not null,
  sku               text,
  description       text,
  selling_price     numeric(14,2) not null default 0 check (selling_price >= 0),
  cost_price        numeric(14,4) not null default 0 check (cost_price >= 0),
  wholesale_price   numeric(14,2),
  tax_inclusive     boolean not null default false,
  reorder_point     numeric(14,3) not null default 0,
  allow_negative    boolean not null default false,
  track_stock       boolean not null default true,
  is_active         boolean not null default true,
  image_url         text,
  -- Plugin-owned sparse attributes, typed by field descriptors (docs/05 §5).
  metadata          jsonb not null default '{}'::jsonb,
  -- Maintained by trigger; see the search index below.
  search_text       text,
  deleted_at        timestamptz,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create index products_org_active_idx
  on public.products(organization_id, is_active)
  where deleted_at is null;
create index products_category_idx on public.products(category_id);
create index products_brand_idx on public.products(brand_id);

create table public.product_variants (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  is_default      boolean not null default false,
  sku             text,
  name_suffix     text,                   -- 'Red / M'
  option_values   jsonb not null default '{}'::jsonb,
  price_override  numeric(14,2),          -- null = inherit products.selling_price
  cost_override   numeric(14,4),          -- null = inherit products.cost_price
  image_url       text,
  is_active       boolean not null default true,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger product_variants_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

create unique index one_default_variant_per_product
  on public.product_variants(product_id)
  where is_default;

create index product_variants_product_idx
  on public.product_variants(product_id)
  where deleted_at is null;

create table public.product_barcodes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant_id      uuid not null references public.product_variants(id) on delete cascade,
  code            text not null,
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  -- A barcode resolves to exactly one thing within an organization.
  unique (organization_id, code)
);

create index product_barcodes_variant_idx on public.product_barcodes(variant_id);

create table public.product_option_types (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,          -- 'Size','Colour'
  sort_order      integer not null default 0,
  unique (organization_id, name)
);

create table public.product_option_values (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  option_type_id  uuid not null references public.product_option_types(id) on delete cascade,
  value           text not null,
  sort_order      integer not null default 0,
  unique (option_type_id, value)
);

create table public.product_images (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant_id      uuid not null references public.product_variants(id) on delete cascade,
  url             text not null,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);

create index product_images_variant_idx on public.product_images(variant_id);

-- Search (spec §55). Maintained by trigger rather than a generated column so
-- it can join brand and variant barcodes, which a generated column cannot.
create or replace function public.refresh_product_search_text()
returns trigger
language plpgsql
as $$
declare
  v_brand text;
  v_extra text;
begin
  select b.name into v_brand
    from public.product_brands b
   where b.id = new.brand_id;

  select string_agg(
           concat_ws(' ', v.sku, coalesce(bc.codes, '')),
           ' '
         )
    into v_extra
    from public.product_variants v
    left join lateral (
      select string_agg(pb.code, ' ') as codes
        from public.product_barcodes pb
       where pb.variant_id = v.id
    ) bc on true
   where v.product_id = new.id
     and v.deleted_at is null;

  new.search_text := lower(
    concat_ws(' ', new.name, new.sku, v_brand, v_extra)
  );
  return new;
end;
$$;

create trigger products_search_text_tgr
  before insert or update on public.products
  for each row
  execute function public.refresh_product_search_text();

-- Trigram similarity handles partial, typo-tolerant input: "sam a15" matches
-- "samsung galaxy a15". Both indexes are what make POS search feel instant.
create index products_trgm_idx
  on public.products using gin (search_text gin_trgm_ops);

create index product_barcodes_trgm_idx
  on public.product_barcodes using gin (code gin_trgm_ops);
