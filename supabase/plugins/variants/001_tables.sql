create table if not exists public.plg_variants_product_axes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  option_type_id  uuid not null references public.product_option_types(id) on delete cascade,
  value_ids       jsonb not null default '[]'::jsonb,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (product_id, option_type_id)
);

create index if not exists plg_variants_product_axes_org_idx
  on public.plg_variants_product_axes(organization_id, product_id);

alter table public.plg_variants_product_axes enable row level security;

drop policy if exists plg_variants_product_axes_select on public.plg_variants_product_axes;
create policy plg_variants_product_axes_select on public.plg_variants_product_axes
  for select using (
    app.in_org(organization_id) and app.has_permission('variants.view')
  );

drop policy if exists plg_variants_product_axes_write on public.plg_variants_product_axes;
create policy plg_variants_product_axes_write on public.plg_variants_product_axes
  for all using (
    app.in_org(organization_id) and app.has_permission('variants.manage')
  )
  with check (
    app.in_org(organization_id) and app.has_permission('variants.manage')
  );

grant select, insert, update, delete on public.plg_variants_product_axes to authenticated;
