-- 049 — The Warranty plugin, seeded as a package.
--
-- every promise the shop makes, on record: which unit, until when, to whom, and what keeping those promises cost.
--
-- The SQL below lives in `supabase/plugins/warranty/` as real files, one per
-- migration, and is read from disk here byte for byte — the same arrangement
-- 041 introduced for variants and every capability plugin since has kept. The
-- validator compares every embedded copy against the file it came from, and
-- against the bundle's manifest, so a version, a permission key or a statement
-- cannot drift between the two halves of a plugin.
--
-- Enabling a plugin runs these files through `app.plugin_apply_migrations`:
-- checksums are recorded in `plugin_migrations`, the tenancy guard refuses a
-- table that is not org-scoped, and the world grant is closed on every function
-- the package creates before the call returns.

-- ── The package ──────────────────────────────────────────────────────────
insert into public.plugin_packages
      (plugin_key, name, category, version, core_api_version, description,
       dependencies, conflicts)
values ('warranty', 'Warranty', 'optional', '1.0.0', '^1.0.0',
        'A warranty is a promise a sale makes: which unit, until when, to whom, and what it cost to keep — with claims against it.',
        '{}', '{}')
on conflict (plugin_key) do update
   set name = excluded.name,
       category = excluded.category,
       version = excluded.version,
       core_api_version = excluded.core_api_version,
       description = excluded.description,
       dependencies = excluded.dependencies,
       conflicts = excluded.conflicts;

-- permissions
insert into public.plugin_package_permissions
      (plugin_key, key, label, category, description)
values
  ('warranty', 'warranty.view', 'See warranty cover', 'service',
   'Look up what a unit is covered by, when the cover ends, and whether it has been in for repair.'),
  ('warranty', 'warranty.manage', 'Write and honour warranty cover', 'service',
   'Record the promises a sale makes, name the units they cover, open claims and settle them.')
on conflict (plugin_key, key) do update
   set label = excluded.label,
       category = excluded.category,
       description = excluded.description;

-- ── The plugin's SQL, one row per file ───────────────────────────────────
do $seed$
declare
  v_file text;
  v_ordinal integer;
  v_sql text;
begin
  -- ── 001_tables.sql ─────────────────────────────────────────────────
  v_file := '001_tables.sql';
  v_ordinal := 1;
  v_sql := $plg_1$-- The thing a shop promises, and the thing it has to honour.
--
-- A warranty is not a product field and not an invoice line: it is a promise
-- *made at a moment*, about *a thing*, to *a customer*, and it comes back years
-- later to be honoured. That is why it gets its own table rather than another
-- column in `products.metadata`.
--
-- What that means in practice:
--
--   · **The promise is a snapshot.** `months`, `provider` and `terms` are copied
--     from the product when the sale happens. A shop that changes its warranty
--     terms next March has not changed what it promised in January, and the row
--     that would otherwise silently mutate is the row a customer brings back.
--
--   · **Dates, not timestamps.** `starts_on` is the day the promise began, in
--     the shop's own timezone, and `ends_on` is `starts_on` + `months`. Both are
--     `date`, so nothing here can be shifted by a timezone, a DST boundary or a
--     server running UTC while the shop is six hours ahead.
--
--   · **Coverage is derived, never stored.** No cron job flips a row to
--     "expired" at midnight; `status` records only what an *administrator* did
--     (a promise is `ACTIVE` until somebody voids it — a refund, a friendly
--     replacement, a data-entry correction). Whether it is still in force today
--     is `ends_on` against the shop's today, which is why the rows cannot be
--     wrong by a day.
--
--   · **The unit is what is covered, not the product.** Two identical handsets
--     are two promises with two end dates. `unit_label` carries the serial or
--     IMEI when the shop has one, and `unit_index` distinguishes the units of
--     one invoice line when it does not — without either, a claim on the second
--     of three phones is unanswerable.

create table if not exists public.plg_warranty_warranties (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Nullable: a shop may cover something it did not sell — a repair, a
  -- trade-in, stock transferred in from another branch of the same owner.
  sale_id         uuid references public.sales(id) on delete set null,
  sale_item_id    uuid references public.sale_items(id) on delete set null,
  product_id      uuid references public.products(id) on delete set null,
  variant_id      uuid references public.product_variants(id) on delete set null,
  customer_id     uuid references public.customers(id) on delete set null,
  -- What was promised, in words that survive the product being renamed or
  -- deleted. `product_id` is for reporting; these are for the shopkeeper and
  -- for the receipt.
  product_name    text not null,
  variant_name    text,
  -- The unit's own identity, when the shop has it: an IMEI, an engine number, a
  -- case number. Free text because only the serial-numbers plugin knows the
  -- difference between a tracked unit and a typed one, and this plugin does not
  -- reach into another plugin's tables.
  unit_label      text,
  unit_index      integer not null default 1 check (unit_index >= 1),
  months          integer not null check (months between 0 and 600),
  provider        text not null default 'SHOP'
                    check (provider in ('SHOP', 'MANUFACTURER', 'DISTRIBUTOR', 'SUPPLIER')),
  terms           text,
  starts_on       date not null,
  ends_on         date not null,
  -- ACTIVE or VOID. Never "EXPIRED": expiry is a fact about today, and today
  -- moves. A stored 'EXPIRED' would be wrong every night between midnight and
  -- whenever the job ran.
  status          text not null default 'ACTIVE' check (status in ('ACTIVE', 'VOID')),
  void_reason     text,
  voided_at       timestamptz,
  note            text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint plg_warranty_ends_after_start check (ends_on >= starts_on)
);

-- One promise per unit per invoice line. This is what makes registering cover
-- idempotent: the sale completing twice, a till retrying, or a shopkeeper
-- clicking twice all end with the same three rows rather than six.
create unique index if not exists plg_warranty_unit_idx
  on public.plg_warranty_warranties (organization_id, sale_item_id, unit_index)
  where status = 'ACTIVE';

create index if not exists plg_warranty_org_status_idx
  on public.plg_warranty_warranties (organization_id, status, ends_on);

create index if not exists plg_warranty_org_sale_idx
  on public.plg_warranty_warranties (organization_id, sale_id);

-- Looking a unit up by its number is the one query made across the counter, so
-- it gets its own index. Case-insensitive for the same reason serial numbers
-- are: a human typing an IMEI will not agree with a scanner about case.
create index if not exists plg_warranty_unit_label_idx
  on public.plg_warranty_warranties (organization_id, lower(unit_label));

create index if not exists plg_warranty_customer_idx
  on public.plg_warranty_warranties (organization_id, customer_id);

drop trigger if exists plg_warranty_warranties_touch on public.plg_warranty_warranties;
create trigger plg_warranty_warranties_touch
  before update on public.plg_warranty_warranties
  for each row execute function public.set_updated_at();

alter table public.plg_warranty_warranties enable row level security;

-- Reading needs `warranty.view`, writing needs `warranty.manage`. Both are the
-- plugin's own keys, so a shop can let the counter look up whether a unit is
-- still covered without letting them open or close a claim.
drop policy if exists plg_warranty_warranties_select on public.plg_warranty_warranties;
create policy plg_warranty_warranties_select on public.plg_warranty_warranties
  for select using (
    app.in_org(organization_id) and app.has_permission('warranty.view')
  );

drop policy if exists plg_warranty_warranties_write on public.plg_warranty_warranties;
create policy plg_warranty_warranties_write on public.plg_warranty_warranties
  for all using (
    app.in_org(organization_id) and app.has_permission('warranty.manage')
  )
  with check (
    app.in_org(organization_id) and app.has_permission('warranty.manage')
  );

grant select, insert, update, delete on public.plg_warranty_warranties to authenticated;

-- ── Claims ────────────────────────────────────────────────────────────────
--
-- What happens when the promise is called in. A claim is a small state machine
-- — reported, approved, in the workshop, replaced, refused, closed — with the
-- money the shop spent on it, because "which of my warranties cost me money"
-- is the question a warranty report is opened for.
--
-- `claim_no` is a document number in the shop's own sequence (`WC-2026-000004`),
-- minted through the core's `next_sequence` like an invoice number is. A
-- workshop gives the customer a slip; the slip needs a number a human can read.

create table if not exists public.plg_warranty_claims (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warranty_id     uuid not null references public.plg_warranty_warranties(id) on delete cascade,
  claim_no        text not null,
  status          text not null default 'OPEN'
                    check (status in ('OPEN', 'APPROVED', 'REPAIRING', 'REPLACED', 'REJECTED', 'CLOSED')),
  opened_on       date not null,
  closed_on       date,
  reported_issue  text,
  resolution      text,
  -- What honouring the claim cost the shop. Major units in the column, minor
  -- units across the API (see `warranty_*`), like every other money value the
  -- clients decode.
  cost            numeric(14, 2) not null default 0 check (cost >= 0),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A finished claim has a date it finished; an open one does not. Storing one
  -- without the other is how a report ends up counting a claim in two months.
  constraint plg_warranty_claims_closed_needs_date
    check ((status in ('REPLACED', 'REJECTED', 'CLOSED')) = (closed_on is not null))
);

create unique index if not exists plg_warranty_claims_no_idx
  on public.plg_warranty_claims (organization_id, claim_no);

create index if not exists plg_warranty_claims_warranty_idx
  on public.plg_warranty_claims (organization_id, warranty_id, status);

create index if not exists plg_warranty_claims_opened_idx
  on public.plg_warranty_claims (organization_id, opened_on);

-- A claim arrives while another is still open on the same unit: that is two
-- shopkeepers working the same counter, and it should be one slip, not two.
-- Enforced here rather than in a function because it is a fact about the table.
create unique index if not exists plg_warranty_claims_one_open_idx
  on public.plg_warranty_claims (warranty_id)
  where status in ('OPEN', 'APPROVED', 'REPAIRING');

drop trigger if exists plg_warranty_claims_touch on public.plg_warranty_claims;
create trigger plg_warranty_claims_touch
  before update on public.plg_warranty_claims
  for each row execute function public.set_updated_at();

alter table public.plg_warranty_claims enable row level security;

drop policy if exists plg_warranty_claims_select on public.plg_warranty_claims;
create policy plg_warranty_claims_select on public.plg_warranty_claims
  for select using (
    app.in_org(organization_id) and app.has_permission('warranty.view')
  );

drop policy if exists plg_warranty_claims_write on public.plg_warranty_claims;
create policy plg_warranty_claims_write on public.plg_warranty_claims
  for all using (
    app.in_org(organization_id) and app.has_permission('warranty.manage')
  )
  with check (
    app.in_org(organization_id) and app.has_permission('warranty.manage')
  );

grant select, insert, update, delete on public.plg_warranty_claims to authenticated;
$plg_1$;

  insert into public.plugin_package_migrations
        (plugin_key, filename, version, ordinal, checksum, sql)
  values ('warranty', v_file, '1.0.0', v_ordinal, md5(v_sql), v_sql)
  on conflict (plugin_key, filename) do update
     set version = excluded.version,
         ordinal = excluded.ordinal,
         checksum = excluded.checksum,
         sql = excluded.sql;
  -- ── 002_functions.sql ─────────────────────────────────────────────────
  v_file := '002_functions.sql';
  v_ordinal := 2;
  v_sql := $plg_2$-- Warranty — behaviour, in SQL.
--
-- Twelve entry points, two tables, and one rule that shapes everything here:
-- **a warranty is a promise made at the till, not a field on a product.** The
-- product says how long the shop *intends* to cover what it sells; this plugin
-- records what it actually promised, to whom, about which unit, on which day,
-- and what it cost the shop to keep that promise.
--
-- Three consequences, all of them deliberate:
--
--   · **The promise is written after the sale exists.** `starts_on` is the
--     business day of the sale in the branch's own timezone, and the unit it
--     covers is a `sale_item` — neither is knowable before the sale is stored.
--     So registration is a separate call the till makes once the sale is in,
--     and it is idempotent: the same sale registered twice is one set of
--     promises, because a till may retry and a shopkeeper may click twice.
--
--   · **Expiry is a fact about today, not a status.** Nothing here flips a row
--     to `EXPIRED` at midnight; `status` is ACTIVE or VOID, which is what a
--     person did. `days_left` is computed against the shop's today, so a report
--     run at 00:05 and one run at 23:55 agree, and no timezone can move the
--     last day of a promise.
--
--   · **The plugin writes no core table.** It reads the sale, its lines, the
--     product, the customer and the branch; it writes only its own two tables
--     (spec §51). A claim is not a sale and a replacement is not a stock
--     movement: when the shop hands a replacement over it rings it up like
--     anything else, and the ledger stays the core's.
--
-- Every entry point is reached through `public.plugin_rpc`, which binds the call
-- to *this* shop's installed copy of *this* plugin — but a function in `public`
-- can also be called directly by anyone who knows its name, so each one guards
-- itself with `app.require_org` and `app.require_permission` rather than
-- trusting its caller. Every one of them also filters on `organization_id`
-- itself, because a SECURITY DEFINER function reads past RLS as the owner: the
-- policies are the second gate, not the only one.

-- ── The shop's own settings ───────────────────────────────────────────────
-- Read from `plugins.config` — the same place the Settings screen writes — so
-- the number a screen shows is the number the server obeys.
create or replace function app.warranty_config(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_config jsonb := '{}'::jsonb;
  v_cover  boolean := false;
  v_months integer := 12;
  v_warn   integer := 30;
  v_prefix text := 'WC-';
begin
  select p.config into v_config
    from public.plugins p
   where p.organization_id = p_organization_id
     and p.plugin_key = 'warranty';

  if v_config is null then v_config := '{}'::jsonb; end if;

  if jsonb_typeof(v_config -> 'cover_all_lines') = 'boolean' then
    v_cover := (v_config ->> 'cover_all_lines')::boolean;
  end if;

  -- A number typed into a settings field can arrive as a string, a float or
  -- nothing at all; clamp what is usable and ignore the rest.
  if (v_config ->> 'default_months') ~ '^[0-9]{1,3}(\.[0-9]+)?$' then
    v_months := greatest(0, least(120, round((v_config ->> 'default_months')::numeric)::int));
  end if;
  if (v_config ->> 'warn_days') ~ '^[0-9]{1,4}(\.[0-9]+)?$' then
    v_warn := greatest(1, least(365, round((v_config ->> 'warn_days')::numeric)::int));
  end if;
  if btrim(coalesce(v_config ->> 'claim_prefix', '')) <> '' then
    v_prefix := left(btrim(v_config ->> 'claim_prefix'), 8);
  end if;

  return jsonb_build_object(
    'cover_all_lines', v_cover,
    'default_months',  v_months,
    'warn_days',       v_warn,
    'claim_prefix',    v_prefix
  );
end
$fn$;

-- ── One day, in the shop's own timezone ───────────────────────────────────
-- Every date this plugin writes or counts comes from here. A promise that ends
-- on the 14th has to end on the 14th the shopkeeper is standing in — not on the
-- UTC day, and not on whatever day the server happens to think it is.
create or replace function app.warranty_day(p_org uuid, p_branch_id uuid, p_when timestamptz)
returns date
language sql
stable
security definer
set search_path = public
as $fn$
  select case
           when p_when is null then null
           else (p_when at time zone coalesce(b.timezone, o.timezone))::date
         end
    from public.organizations o
    left join public.branches b on b.id = p_branch_id and b.organization_id = o.id
   where o.id = p_org
$fn$;

create or replace function app.warranty_today(p_org uuid, p_branch_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(app.warranty_day(p_org, p_branch_id, now()), current_date)
$fn$;

-- ── What a product promises, before anybody sells it ──────────────────────
-- `warranty_months` is a product field the plugin registers, so it lives in
-- `products.metadata` with no column of its own (spec §14, §51) — and it is the
-- key the shop taxonomy promotes for electronics, computer, mobile and
-- appliance shops. Absent, blank or unparseable means "this product promises
-- nothing", which is a different thing from zero.
create or replace function app.warranty_months_for(p_org uuid, p_product uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $fn$
  select case
           when (p.metadata ->> 'warranty_months') ~ '^[0-9]{1,3}(\.[0-9]+)?$'
             then greatest(0, least(600, round((p.metadata ->> 'warranty_months')::numeric)::int))
           else null
         end
    from public.products p
   where p.id = p_product and p.organization_id = p_org
$fn$;

-- ── The last day of the promise ───────────────────────────────────────────
-- Adding calendar months, not `+ 30 * months` days: a one-year promise made on
-- 5 March 2026 ends on 5 March 2027, which is the date a customer will say out
-- loud. Postgres clamps an impossible day-of-month (31 January + 1 month is the
-- 28th, or the 29th in a leap year), which is what a wall calendar does and not
-- what interval arithmetic on seconds does.
create or replace function app.warranty_end(p_start date, p_months integer)
returns date
language sql
immutable
as $fn$
  select (p_start + make_interval(months => greatest(0, p_months)))::date
$fn$;

-- ── One promise, as a screen reads it ─────────────────────────────────────
-- The projection the register, the counter lookup, the sale card and both
-- reports share. Money is **minor units** across the API (`cost_minor`), while
-- the column keeps major units, which is the arrangement every other client
-- already decodes.
create or replace function app.warranty_page(p_org uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_scope   text := lower(coalesce(nullif(p_args ->> 'scope', ''), 'all'));
  v_search  text := btrim(coalesce(p_args ->> 'search', ''));
  v_limit   integer := greatest(1, least(500, coalesce((p_args ->> 'limit')::int, 50)));
  v_offset  integer := greatest(0, coalesce((p_args ->> 'offset')::int, 0));
  v_warn    integer := greatest(1, coalesce((p_args ->> 'warn_days')::int, 30));
  v_sale    uuid := nullif(p_args ->> 'sale_id', '')::uuid;
  v_product uuid := nullif(p_args ->> 'product_id', '')::uuid;
  v_ends_fr date := nullif(p_args ->> 'ends_from', '')::date;
  v_ends_to date := nullif(p_args ->> 'ends_to', '')::date;
  v_by_date boolean;
  v_today   date;
  v_rows    jsonb := '[]'::jsonb;
  v_total   integer := 0;
begin
  if v_scope not in ('all', 'active', 'expiring', 'expired', 'void', 'claimed') then
    raise exception 'warranty_unknown_scope: %', v_scope using errcode = '22023';
  end if;

  -- A register of promises is read by the date it runs out; everything else is
  -- a history, read newest first.
  v_by_date := v_scope in ('active', 'expiring', 'expired');
  v_today   := app.warranty_today(p_org, null);

  select count(*)::int into v_total
    from public.plg_warranty_warranties w
    left join public.sales sa on sa.id = w.sale_id
    left join public.customers c on c.id = w.customer_id
   where w.organization_id = p_org
     and (v_sale is null or w.sale_id = v_sale)
     and (v_product is null or w.product_id = v_product)
     and (v_ends_fr is null or w.ends_on >= v_ends_fr)
     and (v_ends_to is null or w.ends_on <= v_ends_to)
     and case v_scope
           when 'active'   then w.status = 'ACTIVE'
           when 'expiring' then w.status = 'ACTIVE' and w.ends_on >= v_today
                                 and w.ends_on <= v_today + v_warn
           when 'expired'  then w.status = 'ACTIVE' and w.ends_on < v_today
           when 'void'     then w.status = 'VOID'
           when 'claimed'  then exists (
                 select 1 from public.plg_warranty_claims cl
                  where cl.organization_id = p_org and cl.warranty_id = w.id)
           else true
         end
     and (
       v_search = ''
       or w.product_name ilike '%' || v_search || '%'
       or coalesce(w.variant_name, '') ilike '%' || v_search || '%'
       or coalesce(w.unit_label, '') ilike '%' || v_search || '%'
       or coalesce(sa.invoice_no, '') ilike '%' || v_search || '%'
       or coalesce(c.name, '') ilike '%' || v_search || '%'
       or coalesce(c.phone, '') ilike '%' || v_search || '%'
     );

  select coalesce(jsonb_agg(page.row_json order by
                  -- `id` is the tiebreak on every branch: a paged list without
                  -- one can repeat or skip a row between pages.
                  case when v_by_date then page.ends_on end asc,
                  case when v_by_date then page.id end asc,
                  case when not v_by_date then page.created_at end desc,
                  page.id asc
                ), '[]'::jsonb)
    into v_rows
    from (
      select w.id,
             w.ends_on,
             w.created_at,
             jsonb_build_object(
               'id',             w.id,
               'product_id',     w.product_id,
               'product_name',   w.product_name,
               'variant_name',   w.variant_name,
               'unit_label',     w.unit_label,
               'unit_index',     w.unit_index,
               'months',         w.months,
               'provider',       w.provider,
               'terms',          w.terms,
               'starts_on',      w.starts_on,
               'ends_on',        w.ends_on,
               'days_left',      (w.ends_on - v_today),
               'status',         w.status,
               'void_reason',    w.void_reason,
               'voided_at',      w.voided_at,
               'note',           w.note,
               'created_at',     w.created_at,
               'customer',       c.name,
               'customer_phone', c.phone,
               'customer_id',    w.customer_id,
               'invoice_no',     sa.invoice_no,
               'sale_id',        w.sale_id,
               'sale_status',    sa.status,
               'sold_on',        app.warranty_day(p_org, sa.branch_id,
                                    coalesce(sa.completed_at, sa.created_at)),
               -- Two subqueries rather than a lateral aggregate: with no claims
               -- a lateral would still hand back an object of nulls, and the
               -- screen would show a claim that does not exist.
               'claims_count',   (select count(*)::int from public.plg_warranty_claims cl
                                   where cl.organization_id = p_org and cl.warranty_id = w.id),
               'claim',          (select jsonb_build_object(
                                           'id',         cl2.id,
                                           'claim_no',   cl2.claim_no,
                                           'status',     cl2.status,
                                           'opened_on',  cl2.opened_on,
                                           'closed_on',  cl2.closed_on,
                                           'cost_minor', round(cl2.cost * 100)::int,
                                           'issue',      cl2.reported_issue,
                                           'resolution', cl2.resolution)
                                    from public.plg_warranty_claims cl2
                                   where cl2.organization_id = p_org and cl2.warranty_id = w.id
                                   order by cl2.opened_on desc, cl2.created_at desc
                                   limit 1)
             ) as row_json
        from public.plg_warranty_warranties w
        left join public.sales sa on sa.id = w.sale_id
        left join public.customers c on c.id = w.customer_id
       where w.organization_id = p_org
         and (v_sale is null or w.sale_id = v_sale)
         and (v_product is null or w.product_id = v_product)
         and (v_ends_fr is null or w.ends_on >= v_ends_fr)
         and (v_ends_to is null or w.ends_on <= v_ends_to)
         and case v_scope
               when 'active'   then w.status = 'ACTIVE'
               when 'expiring' then w.status = 'ACTIVE' and w.ends_on >= v_today
                                     and w.ends_on <= v_today + v_warn
               when 'expired'  then w.status = 'ACTIVE' and w.ends_on < v_today
               when 'void'     then w.status = 'VOID'
               when 'claimed'  then exists (
                     select 1 from public.plg_warranty_claims cl3
                      where cl3.organization_id = p_org and cl3.warranty_id = w.id)
               else true
             end
         and (
           v_search = ''
           or w.product_name ilike '%' || v_search || '%'
           or coalesce(w.variant_name, '') ilike '%' || v_search || '%'
           or coalesce(w.unit_label, '') ilike '%' || v_search || '%'
           or coalesce(sa.invoice_no, '') ilike '%' || v_search || '%'
           or coalesce(c.name, '') ilike '%' || v_search || '%'
           or coalesce(c.phone, '') ilike '%' || v_search || '%'
         )
       order by case when v_by_date then w.ends_on end asc,
                case when v_by_date then w.id end asc,
                case when not v_by_date then w.created_at end desc,
                w.id asc
       limit v_limit
      offset v_offset
    ) page;

  return jsonb_build_object(
    'rows',   v_rows,
    'total',  v_total,
    'limit',  v_limit,
    'offset', v_offset,
    'scope',  v_scope,
    'today',  v_today
  );
end
$fn$;

-- ── The claims queue, as a screen reads it ────────────────────────────────
-- "Open" is the shop's word for work that is not finished yet, so it covers
-- reported, approved and in the workshop; `CLOSED` covers the three ways a
-- claim ends. The individual statuses stay available for a shop that wants to
-- see only replacements.
create or replace function app.warranty_claim_rows(p_org uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_status   text := upper(coalesce(nullif(p_args ->> 'status', ''), 'OPEN'));
  v_search   text := btrim(coalesce(p_args ->> 'search', ''));
  v_limit    integer := greatest(1, least(500, coalesce((p_args ->> 'limit')::int, 50)));
  v_offset   integer := greatest(0, coalesce((p_args ->> 'offset')::int, 0));
  v_from     date := nullif(p_args ->> 'from', '')::date;
  v_to       date := nullif(p_args ->> 'to', '')::date;
  v_warranty uuid := nullif(p_args ->> 'warranty_id', '')::uuid;
  v_rows     jsonb := '[]'::jsonb;
  v_total    integer := 0;
  v_today    date;
begin
  if v_status not in ('OPEN', 'ALL', 'CLOSED', 'REPAIRING', 'APPROVED', 'REPLACED', 'REJECTED') then
    raise exception 'warranty_unknown_claim_status: %', v_status using errcode = '22023';
  end if;

  v_today := app.warranty_today(p_org, null);

  select count(*)::int into v_total
    from public.plg_warranty_claims cl
    join public.plg_warranty_warranties w on w.id = cl.warranty_id
   where cl.organization_id = p_org
     and (v_warranty is null or cl.warranty_id = v_warranty)
     and (v_from is null or cl.opened_on >= v_from)
     and (v_to is null or cl.opened_on <= v_to)
     and case v_status
           when 'ALL'    then true
           when 'OPEN'   then cl.status in ('OPEN', 'APPROVED', 'REPAIRING')
           when 'CLOSED' then cl.status in ('CLOSED', 'REPLACED', 'REJECTED')
           else cl.status = v_status
         end
     and (
       v_search = ''
       or cl.claim_no ilike '%' || v_search || '%'
       or w.product_name ilike '%' || v_search || '%'
       or coalesce(w.unit_label, '') ilike '%' || v_search || '%'
       or coalesce(cl.reported_issue, '') ilike '%' || v_search || '%'
     );

  select coalesce(jsonb_agg(page.row_json order by page.opened_on desc, page.id asc), '[]'::jsonb)
    into v_rows
    from (
      select cl.id, cl.opened_on,
             jsonb_build_object(
               'id',                 cl.id,
               'claim_no',           cl.claim_no,
               'status',             cl.status,
               'opened_on',          cl.opened_on,
               'closed_on',          cl.closed_on,
               'days_open',          coalesce(cl.closed_on, v_today) - cl.opened_on,
               'issue',              cl.reported_issue,
               'resolution',         cl.resolution,
               'cost_minor',         round(cl.cost * 100)::int,
               'warranty_id',        w.id,
               'product_name',       w.product_name,
               'variant_name',       w.variant_name,
               'unit_label',         w.unit_label,
               'unit_index',         w.unit_index,
               'months',             w.months,
               'starts_on',          w.starts_on,
               'ends_on',            w.ends_on,
               'warranty_status',    w.status,
               'covered_until_days', (w.ends_on - v_today),
               'sale_id',            w.sale_id,
               'invoice_no',         sa.invoice_no,
               'customer',           c.name,
               'customer_phone',     c.phone
             ) as row_json
        from public.plg_warranty_claims cl
        join public.plg_warranty_warranties w on w.id = cl.warranty_id
        left join public.sales sa on sa.id = w.sale_id
        left join public.customers c on c.id = w.customer_id
       where cl.organization_id = p_org
         and (v_warranty is null or cl.warranty_id = v_warranty)
         and (v_from is null or cl.opened_on >= v_from)
         and (v_to is null or cl.opened_on <= v_to)
         and case v_status
               when 'ALL'    then true
               when 'OPEN'   then cl.status in ('OPEN', 'APPROVED', 'REPAIRING')
               when 'CLOSED' then cl.status in ('CLOSED', 'REPLACED', 'REJECTED')
               else cl.status = v_status
             end
         and (
           v_search = ''
           or cl.claim_no ilike '%' || v_search || '%'
           or w.product_name ilike '%' || v_search || '%'
           or coalesce(w.unit_label, '') ilike '%' || v_search || '%'
           or coalesce(cl.reported_issue, '') ilike '%' || v_search || '%'
         )
       order by cl.opened_on desc, cl.id asc
       limit v_limit
      offset v_offset
    ) page;

  return jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'status', v_status, 'today', v_today
  );
end
$fn$;

-- ── What a sale's lines promise, and what is already written ──────────────
-- The single answer to "what is on this sale and what does it owe?" for the
-- till card, the sale tab and the work queue. `missing` counts units that
-- should be covered and have no promise yet — floored at zero, so a shop that
-- registered cover twice never sees a negative.
create or replace function app.warranty_sale_lines(p_org uuid, p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_config jsonb := app.warranty_config(p_org);
  v_cover  boolean := (v_config ->> 'cover_all_lines')::boolean;
  v_default integer := (v_config ->> 'default_months')::int;
begin
  return (
    select coalesce(jsonb_agg(ln.line order by ln.line ->> 'product_name', ln.line ->> 'sale_item_id'), '[]'::jsonb)
      from (
        select jsonb_build_object(
                 'sale_item_id', si.id,
                 'product_id',   si.product_id,
                 'variant_id',   si.variant_id,
                 'product_name', si.product_name,
                 'variant_name', si.variant_name,
                 'sku',          si.sku,
                 'unit_label',   si.unit_label,
                 'quantity',     si.quantity,
                 'returned_qty', coalesce(si.returned_qty, 0),
                 -- Integers in the payload, not numerics that happen to be
                 -- whole: `2.000` renders as the text "2.000", and casting that
                 -- to an integer is an error in Postgres.
                 'sold_units',   greatest(0, ceil(si.quantity - coalesce(si.returned_qty, 0)))::int,
                 -- What this line promises: the product's own field, or the
                 -- shop's "cover everything" rule. A sale-level override is
                 -- applied by whoever writes the promises, not here.
                 'months',       coalesce(
                                   app.warranty_months_for(p_org, si.product_id),
                                   case when v_cover then v_default end),
                 'registered',   (select count(*)::int from public.plg_warranty_warranties w
                                   where w.organization_id = p_org and w.sale_item_id = si.id
                                     and w.status = 'ACTIVE'),
                 'missing',      case
                                   when coalesce(
                                          app.warranty_months_for(p_org, si.product_id),
                                          case when v_cover then v_default end) is null
                                     -- A line nobody promised anything about owes nothing:
                                     -- the queue is for promises that were made and not
                                     -- recorded, not for every product in the shop.
                                     then 0
                                   else greatest(0,
                                          least(50, greatest(0, ceil(si.quantity - coalesce(si.returned_qty, 0)))::int)
                                          - (select count(*)::int from public.plg_warranty_warranties w2
                                              where w2.organization_id = p_org and w2.sale_item_id = si.id
                                                and w2.status = 'ACTIVE'))::int
                                 end
               ) as line
          from public.sale_items si
         where si.sale_id = p_sale_id and si.organization_id = p_org
      ) ln
  );
end
$fn$;

-- ── Writing the promises for one sale ─────────────────────────────────────
-- The heart of the plugin, and the one place that decides what a sale owes.
--
-- Idempotent by construction rather than by a guard: each unit is one row, and
-- the partial unique index on (organization_id, sale_item_id, unit_index) where
-- the promise is ACTIVE means a second call inserts nothing. So a till that
-- retries, a shopkeeper who clicks twice and a Realtime redelivery all converge
-- on the same set of promises.
--
-- What it does *not* do is invent cover. A line is promised because the sale
-- asked for it (`p_months`), because the product carries a `warranty_months`
-- field, or because this shop chose to cover everything it sells — in that
-- order of authority.
create or replace function app.warranty_register_sale(
  p_org uuid,
  p_sale_id uuid,
  p_months integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_config  jsonb;
  v_cover   boolean;
  v_default integer;
  v_terms   text;
  v_sale    record;
  v_customer uuid;
  v_today   date;
  v_line    record;
  v_months  integer;
  v_units   integer;
  v_taken   integer;
  v_made    integer := 0;
  v_have    integer := 0;
  v_capped  integer := 0;
  v_skipped integer := 0;
  v_index   integer;
  v_label   text;
  v_units_json jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1 from public.plugins pl
     where pl.organization_id = p_org and pl.plugin_key = 'warranty' and pl.enabled
  ) then
    raise exception 'plugin_not_enabled: %', 'warranty' using errcode = 'P0001';
  end if;

  select sa.id, sa.invoice_no, sa.branch_id, sa.status, sa.customer_id
    into v_sale
    from public.sales sa
   where sa.id = p_sale_id and sa.organization_id = p_org;

  if not found then
    raise exception 'warranty_unknown_sale: %', p_sale_id using errcode = 'P0002';
  end if;

  -- A draft or a held sale has not sold anything yet, and a cancelled one sold
  -- nothing at all: promising cover on either would be standing behind a sale
  -- that never happened.
  if v_sale.status not in ('COMPLETED', 'PARTIALLY_PAID', 'REFUNDED', 'PARTIALLY_REFUNDED') then
    raise exception 'warranty_sale_not_sold: % (%)', p_sale_id, v_sale.status using errcode = 'P0001';
  end if;

  v_customer := v_sale.customer_id;
  v_config  := app.warranty_config(p_org);
  v_cover   := (v_config ->> 'cover_all_lines')::boolean;
  v_default := (v_config ->> 'default_months')::int;
  -- The promise starts on the day the shop sold it, in the shop's own timezone
  -- — not on the day a client happened to register it.
  v_today   := app.warranty_today(p_org, v_sale.branch_id);
  v_terms   := 'Covered by ' || coalesce(
                 (select o.name from public.organizations o where o.id = p_org), 'the shop');

  for v_line in
    select si.id, si.product_id, si.variant_id, si.product_name, si.variant_name,
           coalesce(si.unit_label, '') as unit_label,
           greatest(0, ceil(si.quantity - coalesce(si.returned_qty, 0)))::int as sold_units
      from public.sale_items si
     where si.sale_id = p_sale_id and si.organization_id = p_org
     order by si.product_name, si.id
  loop
    if v_line.sold_units <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_months := coalesce(
      case when p_months is not null and p_months > 0 then p_months end,
      app.warranty_months_for(p_org, v_line.product_id),
      case when v_cover then v_default end
    );

    if v_months is null or v_months <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_months := least(600, v_months);

    -- A line of 500 identical bolts is not 500 promises: nobody will ever look
    -- one of them up. The cap is loud in the result (`capped_lines`) rather
    -- than silent, and a shop that means it promises per unit by selling them
    -- separately.
    v_units := least(50, v_line.sold_units);
    if v_line.sold_units > v_units then
      v_capped := v_capped + 1;
    end if;

    select count(*)::int into v_taken
      from public.plg_warranty_warranties w
     where w.organization_id = p_org
       and w.sale_item_id = v_line.id
       and w.status = 'ACTIVE';

    v_have := v_have + least(v_taken, v_units);

    for v_index in (v_taken + 1)..v_units loop
      -- A single unit can carry the line's own label. Several cannot share it,
      -- so they are numbered and the shop labels them from the register.
      v_label := nullif(btrim(v_line.unit_label), '');
      if v_label is not null and v_units > 1 then
        v_label := null;
      end if;

      insert into public.plg_warranty_warranties
            (organization_id, sale_id, sale_item_id, product_id, variant_id,
             customer_id, product_name, variant_name, unit_label, unit_index,
             months, provider, terms, starts_on, ends_on, created_by)
      values (p_org, p_sale_id, v_line.id, v_line.product_id, v_line.variant_id,
              v_customer, v_line.product_name, v_line.variant_name,
              v_label, v_index, v_months, 'SHOP', v_terms, v_today,
              app.warranty_end(v_today, v_months), auth.uid())
      on conflict do nothing;

      -- `on conflict do nothing` leaves FOUND false when the promise is already
      -- there, which is exactly the count this returns.
      if found then
        v_made := v_made + 1;
      end if;
    end loop;
  end loop;

  select coalesce(jsonb_agg(u order by (u ->> 'ends_on'), (u ->> 'unit_index')::int), '[]'::jsonb)
    into v_units_json
    from jsonb_array_elements(
           app.warranty_page(p_org, jsonb_build_object('sale_id', p_sale_id, 'limit', 500)) -> 'rows'
         ) u;

  return jsonb_build_object(
    'sale_id',       p_sale_id,
    'invoice_no',    v_sale.invoice_no,
    'created',       v_made,
    'existing',      v_have,
    'skipped_lines', v_skipped,
    'capped_lines',  v_capped,
    'starts_on',     v_today,
    'units',         v_units_json
  );
end
$fn$;

-- ── Claim numbers ─────────────────────────────────────────────────────────
-- A workshop hands the customer a slip, and the slip needs a number a human can
-- read and quote on the telephone. Minted through the core's own
-- `next_sequence`, like an invoice number is, because that is the only place in
-- this system where numbers are guaranteed distinct under concurrency.
create or replace function app.warranty_claim_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prefix text := app.warranty_config(p_org) ->> 'claim_prefix';
  v_seq    bigint;
begin
  v_seq := public.next_sequence(p_org, 'warranty-claim:' || to_char(now(), 'YYYY'));
  return v_prefix || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 6, '0');
end
$fn$;

-- ── The register ──────────────────────────────────────────────────────────
-- `product_id` is what the product form asks with: "what have I promised about
-- *this* product" is a question the server answers, not one the browser guesses
-- by filtering a page of the shop's newest promises — which would undercount
-- every popular product and say so with a straight face.
create or replace function public.warranty_list(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org  uuid := p_organization_id;
  v_args jsonb := coalesce(p_args, '{}'::jsonb);
  v_warn integer;
begin
  perform app.require_org(v_org);
  perform app.require_permission('warranty.view');

  v_warn := greatest(1, least(365, coalesce(
              (v_args ->> 'warn_days')::int,
              (app.warranty_config(v_org) ->> 'warn_days')::int)));

  return app.warranty_page(v_org, jsonb_build_object(
    'scope',      lower(coalesce(nullif(v_args ->> 'status', ''), 'all')),
    'search',     coalesce(v_args ->> 'search', ''),
    'product_id', coalesce(v_args ->> 'product_id', ''),
    'limit',      coalesce(v_args ->> 'limit', '50'),
    'offset',     coalesce(v_args ->> 'offset', '0'),
    'warn_days',  v_warn
  ));
end
$fn$;

-- ── The counter lookup ────────────────────────────────────────────────────
-- The one thing a shop does with a warranty while the customer is standing in
-- front of it: find the promise. The same reader as the register, ordered by
-- what runs out first, and it answers with the claims — because "has this been
-- in before?" is the next question at the counter.
create or replace function public.warranty_lookup(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org  uuid := p_organization_id;
  v_q    text := btrim(coalesce(p_args ->> 'q', ''));
  v_page jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('warranty.view');

  -- Two characters, because a search of one letter is not a lookup — it is the
  -- whole register, and it would answer with the shop's entire history.
  if length(v_q) < 2 then
    raise exception 'warranty_search_too_short' using errcode = '22023';
  end if;

  v_page := app.warranty_page(v_org, jsonb_build_object('search', v_q, 'limit', 25));

  return jsonb_build_object(
    'q',     v_q,
    'today', v_page -> 'today',
    'total', (v_page ->> 'total')::int,
    'rows',  v_page -> 'rows'
  );
end
$fn$;

-- ── The till's questions about one sale ───────────────────────────────────
create or replace function public.warranty_for_sale(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org  uuid := p_organization_id;
  v_sale uuid := nullif(p_args ->> 'sale_id', '')::uuid;
  v_row  record;
  v_page jsonb;
  v_lines jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('warranty.view');

  if v_sale is null then
    raise exception 'warranty_sale_required' using errcode = '22023';
  end if;

  select sa.id, sa.invoice_no, sa.status, sa.branch_id, c.name as customer,
         app.warranty_day(v_org, sa.branch_id, coalesce(sa.completed_at, sa.created_at)) as sold_on,
         app.warranty_today(v_org, sa.branch_id) as today
    into v_row
    from public.sales sa
    left join public.customers c on c.id = sa.customer_id
   where sa.id = v_sale and sa.organization_id = v_org;

  if not found then
    raise exception 'warranty_unknown_sale: %', v_sale using errcode = 'P0002';
  end if;

  v_page  := app.warranty_page(v_org, jsonb_build_object('sale_id', v_sale, 'limit', 500));
  v_lines := app.warranty_sale_lines(v_org, v_sale);

  return jsonb_build_object(
    'sale', jsonb_build_object(
      'id',         v_row.id,
      'invoice_no', v_row.invoice_no,
      'status',     v_row.status,
      'sold_on',    v_row.sold_on,
      'customer',   v_row.customer
    ),
    'today', v_row.today,
    'lines', v_lines,
    'units', v_page -> 'rows',
    'missing', coalesce((
      select sum((ln ->> 'missing')::int)::int from jsonb_array_elements(v_lines) ln
    ), 0)
  );
end
$fn$;

-- ── Writing cover ─────────────────────────────────────────────────────────
create or replace function public.warranty_register(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org    uuid := p_organization_id;
  v_sale   uuid := nullif(p_args ->> 'sale_id', '')::uuid;
  v_months integer := case when coalesce(p_args ->> 'months', '') ~ '^[0-9]{1,3}$'
                             then (p_args ->> 'months')::int end;
begin
  perform app.require_org(v_org);
  perform app.require_permission('warranty.manage');

  if v_sale is null then
    raise exception 'warranty_sale_required' using errcode = '22023';
  end if;

  return app.warranty_register_sale(v_org, v_sale, v_months)
    || jsonb_build_object('lines', app.warranty_sale_lines(v_org, v_sale));
end
$fn$;

-- ── Naming the unit ───────────────────────────────────────────────────────
-- Three identical handsets are three promises, and the shop has to be able to
-- say *which* one is on the counter. Free text, because only the serial-numbers
-- plugin knows the difference between a tracked unit and a typed one, and this
-- plugin does not reach into another plugin's tables.
create or replace function public.warranty_label(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org   uuid := p_organization_id;
  v_id    uuid := nullif(p_args ->> 'warranty_id', '')::uuid;
  v_label text := btrim(coalesce(p_args ->> 'unit_label', ''));
  v_row   record;
begin
  perform app.require_org(v_org);
  perform app.require_permission('warranty.manage');

  if v_id is null then
    raise exception 'warranty_required' using errcode = '22023';
  end if;
  if length(v_label) > 120 then
    raise exception 'warranty_label_too_long' using errcode = '22023';
  end if;

  update public.plg_warranty_warranties w
     set unit_label = nullif(v_label, '')
   where w.id = v_id and w.organization_id = v_org
  returning w.id, w.unit_label, w.product_name, w.unit_index into v_row;

  if not found then
    raise exception 'warranty_not_found: %', v_id using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'warranty_id',  v_row.id,
    'unit_label',   v_row.unit_label,
    'product_name', v_row.product_name,
    'unit_index',   v_row.unit_index
  );
end
$fn$;

-- ── Withdrawing the promise ───────────────────────────────────────────────
-- A refund, a goodwill replacement, or a row somebody typed twice. The row is
-- not deleted: a shop that voided a promise last March may have to prove it,
-- and an audit trail that can be erased is not one.
create or replace function public.warranty_void(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org    uuid := p_organization_id;
  v_id     uuid := nullif(p_args ->> 'warranty_id', '')::uuid;
  v_reason text := btrim(coalesce(p_args ->> 'reason', ''));
  v_row    record;
begin
  perform app.require_org(v_org);
  perform app.require_permission('warranty.manage');

  if v_id is null then
    raise exception 'warranty_required' using errcode = '22023';
  end if;
  -- Every void says why. A promise silently withdrawn is a promise the shop
  -- cannot defend when the customer comes back holding the receipt.
  if v_reason = '' then
    raise exception 'warranty_reason_required' using errcode = '22023';
  end if;

  select w.id, w.status, w.unit_label, w.product_name into v_row
    from public.plg_warranty_warranties w
   where w.id = v_id and w.organization_id = v_org;

  if not found then
    raise exception 'warranty_not_found: %', v_id using errcode = 'P0002';
  end if;

  if v_row.status = 'VOID' then
    return jsonb_build_object('warranty_id', v_id, 'voided', false, 'already_void', true,
                              'unit_label', v_row.unit_label, 'product_name', v_row.product_name);
  end if;

  if exists (
    select 1 from public.plg_warranty_claims cl
     where cl.organization_id = v_org and cl.warranty_id = v_id
       and cl.status in ('OPEN', 'APPROVED', 'REPAIRING')
  ) then
    raise exception 'warranty_claim_open: %', v_id using errcode = 'P0001';
  end if;

  update public.plg_warranty_warranties w
     set status = 'VOID', void_reason = left(v_reason, 200), voided_at = now()
   where w.id = v_id and w.organization_id = v_org;

  return jsonb_build_object(
    'warranty_id', v_id, 'voided', true, 'already_void', false,
    'unit_label', v_row.unit_label, 'product_name', v_row.product_name
  );
end
$fn$;

-- ── Opening a claim ───────────────────────────────────────────────────────
-- The counter conversation: the customer brings something back, the shop looks
-- the promise up and opens a slip. Refusals are named, because each one has a
-- different sentence at the counter —
--
--   `warranty_not_found`  — "I cannot find cover for that unit."
--   `warranty_is_void`    — "this one was voided; here is why."
--   `warranty_expired`    — "cover ended on the 14th" — and the shop may still
--                            choose to honour it, which is `past_goodwill`.
--   `warranty_claim_open` — "there is already a slip open for that unit."
create or replace function public.warranty_open_claim(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid := p_organization_id;
  v_id       uuid := nullif(p_args ->> 'warranty_id', '')::uuid;
  v_label    text := btrim(coalesce(p_args ->> 'unit_label', ''));
  v_issue    text := btrim(coalesce(p_args ->> 'issue', ''));
  v_goodwill boolean := coalesce((p_args ->> 'past_goodwill')::boolean, false);
  v_cost     numeric := 0;
  v_today    date;
  v_row      record;
  v_claim_id uuid;
  v_claim_no text;
begin
  perform app.require_org(v_org);
  perform app.require_permission('warranty.manage');

  if coalesce(p_args ->> 'cost_minor', '') ~ '^[0-9]{1,12}$' then
    v_cost := round((p_args ->> 'cost_minor')::numeric) / 100;
  end if;

  if v_id is null and v_label <> '' then
    select w.id into v_id
      from public.plg_warranty_warranties w
     where w.organization_id = v_org and lower(w.unit_label) = lower(v_label)
     order by (w.status = 'ACTIVE') desc, w.ends_on desc
     limit 1;

    if v_id is null then
      raise exception 'warranty_not_found: %', v_label using errcode = 'P0002';
    end if;
  end if;

  select w.id, w.status, w.ends_on, w.unit_label, w.product_name,
         app.warranty_today(v_org, sa.branch_id) as today
    into v_row
    from public.plg_warranty_warranties w
    left join public.sales sa on sa.id = w.sale_id
   where w.id = v_id and w.organization_id = v_org;

  if not found then
    raise exception 'warranty_not_found: %', coalesce(v_id::text, v_label) using errcode = 'P0002';
  end if;

  v_today := coalesce(v_row.today, current_date);

  if v_row.status = 'VOID' then
    raise exception 'warranty_is_void: %', v_id using errcode = 'P0001';
  end if;

  if v_row.ends_on < v_today and not v_goodwill then
    raise exception 'warranty_expired: % (ended %)', v_row.product_name, v_row.ends_on
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.plg_warranty_claims cl
     where cl.organization_id = v_org and cl.warranty_id = v_id
       and cl.status in ('OPEN', 'APPROVED', 'REPAIRING')
  ) then
    raise exception 'warranty_claim_open: %', v_id using errcode = 'P0001';
  end if;

  v_claim_no := app.warranty_claim_number(v_org);

  insert into public.plg_warranty_claims
        (organization_id, warranty_id, claim_no, status, opened_on, reported_issue, cost, created_by)
  values (v_org, v_id, v_claim_no, 'OPEN', v_today, nullif(v_issue, ''), v_cost, auth.uid())
  returning id into v_claim_id;

  return jsonb_build_object(
    'claim_id',      v_claim_id,
    'claim_no',      v_claim_no,
    'status',        'OPEN',
    'opened_on',     v_today,
    'warranty_id',   v_id,
    'unit_label',    v_row.unit_label,
    'product_name',  v_row.product_name,
    'covered_until', v_row.ends_on,
    'was_expired',   v_row.ends_on < v_today,
    'cost_minor',    round(v_cost * 100)::int
  );
end
$fn$;

-- ── Moving a claim along ──────────────────────────────────────────────────
-- Reported → approved → in the workshop → replaced, refused or closed. A claim
-- can go straight from reported into the workshop, because at a counter the
-- person taking it in *is* the approval; and one step back is allowed, because
-- shopkeepers mis-click and a telephone call can change what a workshop is
-- doing. What is not allowed is a *finished* claim changing: a closed slip that
-- can silently reopen is not a record of anything.
--
-- Whatever the status, the money spent and the resolution are editable: they
-- are what the shop learned while doing the work.
create or replace function public.warranty_claim(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org        uuid := p_organization_id;
  v_id         uuid := nullif(p_args ->> 'claim_id', '')::uuid;
  v_status     text := upper(btrim(coalesce(p_args ->> 'status', '')));
  v_resolution text := nullif(btrim(coalesce(p_args ->> 'resolution', '')), '');
  v_cost       numeric;
  v_closed     boolean;
  v_allowed    boolean := false;
  v_today      date;
  v_row        record;
begin
  perform app.require_org(v_org);
  perform app.require_permission('warranty.manage');

  if v_id is null then
    raise exception 'warranty_claim_required' using errcode = '22023';
  end if;

  select cl.id, cl.claim_no, cl.status, cl.opened_on, cl.closed_on, cl.cost,
         cl.warranty_id, app.warranty_today(v_org, sa.branch_id) as today
    into v_row
    from public.plg_warranty_claims cl
    join public.plg_warranty_warranties w on w.id = cl.warranty_id
    left join public.sales sa on sa.id = w.sale_id
   where cl.id = v_id and cl.organization_id = v_org;

  if not found then
    raise exception 'warranty_claim_not_found: %', v_id using errcode = 'P0002';
  end if;

  if v_status = '' then
    v_status := v_row.status;
  end if;

  if v_status not in ('OPEN', 'APPROVED', 'REPAIRING', 'REPLACED', 'REJECTED', 'CLOSED') then
    raise exception 'warranty_unknown_claim_status: %', v_status using errcode = '22023';
  end if;

  if v_row.status in ('REPLACED', 'REJECTED', 'CLOSED') and v_status <> v_row.status then
    raise exception 'warranty_claim_finished: % (%)', v_row.claim_no, v_row.status
      using errcode = 'P0001';
  end if;

  v_allowed := case v_row.status
                 when 'OPEN'      then v_status in ('OPEN', 'APPROVED', 'REPAIRING', 'REPLACED', 'REJECTED', 'CLOSED')
                 when 'APPROVED'  then v_status in ('OPEN', 'APPROVED', 'REPAIRING', 'REPLACED', 'REJECTED', 'CLOSED')
                 when 'REPAIRING' then v_status in ('APPROVED', 'REPAIRING', 'REPLACED', 'REJECTED', 'CLOSED')
                 else v_status = v_row.status
               end;

  if not v_allowed then
    raise exception 'warranty_illegal_transition: % -> %', v_row.status, v_status
      using errcode = 'P0001';
  end if;

  -- The table's own constraint ties a finishing date to a finishing status, so
  -- the two cannot drift: a claim was closed on a day, or it is not closed.
  v_closed := v_status in ('REPLACED', 'REJECTED', 'CLOSED');
  v_today  := coalesce(v_row.today, current_date);

  if coalesce(p_args ->> 'cost_minor', '') ~ '^[0-9]{1,12}$' then
    v_cost := round((p_args ->> 'cost_minor')::numeric) / 100;
  end if;

  update public.plg_warranty_claims cl
     set status     = v_status,
         closed_on  = case when v_closed then coalesce(cl.closed_on, v_today) else null end,
         resolution = coalesce(v_resolution, cl.resolution),
         cost       = coalesce(v_cost, cl.cost)
   where cl.id = v_id and cl.organization_id = v_org;

  return jsonb_build_object(
    'claim_id',    v_id,
    'claim_no',    v_row.claim_no,
    'status',      v_status,
    'was',         v_row.status,
    'closed_on',   case when v_closed then coalesce(v_row.closed_on, v_today) else null end,
    'cost_minor',  round(coalesce(v_cost, v_row.cost) * 100)::int,
    'warranty_id', v_row.warranty_id
  );
end
$fn$;

-- ── The claims queue ──────────────────────────────────────────────────────
create or replace function public.warranty_claims(p_organization_id uuid, p_args jsonb)
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
  perform app.require_permission('warranty.view');
  return app.warranty_claim_rows(v_org, coalesce(p_args, '{}'::jsonb));
end
$fn$;

-- ── The work queue: sales that should have cover and do not ───────────────
-- Cover is written when the till tells the server the sale is in. Three things
-- can stop that: the plugin was switched on after the sale, the till was
-- offline, or the sale was entered by somebody who never opened the warranty
-- card. None of them should leave a customer holding a promise nobody recorded,
-- so this queue lists every sale in the window that owes cover, with how many
-- units are missing.
create or replace function public.warranty_pending(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org   uuid := p_organization_id;
  v_days  integer := greatest(1, least(365, coalesce((p_args ->> 'days')::int, 60)));
  v_limit integer := greatest(1, least(200, coalesce((p_args ->> 'limit')::int, 50)));
  v_from  date;
  v_today date;
  v_out   jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('warranty.view');

  v_today := app.warranty_today(v_org, null);
  v_from  := v_today - v_days;

  with owed as (
    select sa.id as sale_id,
           sa.invoice_no,
           sa.status,
           sa.branch_id,
           coalesce(sa.completed_at, sa.created_at) as sold_at,
           c.name as customer,
           app.warranty_sale_lines(v_org, sa.id) as lines
      from public.sales sa
      join public.organizations o on o.id = sa.organization_id
      left join public.branches b on b.id = sa.branch_id
      left join public.customers c on c.id = sa.customer_id
     where sa.organization_id = v_org
       and sa.status in ('COMPLETED', 'PARTIALLY_PAID', 'REFUNDED', 'PARTIALLY_REFUNDED')
       -- The window is a business-day window, so its lower edge is midnight in
       -- the shop's own timezone — not midnight UTC, which is 6am in Dhaka.
       and coalesce(sa.completed_at, sa.created_at)
             >= (v_from::timestamp at time zone coalesce(b.timezone, o.timezone))
  ),
  owing as (
    select o.*, m.units, m.first_product, m.first_months, m.lines as missing_lines
      from owed o
      cross join lateral (
        select coalesce(sum((ln ->> 'missing')::int), 0)::int as units,
               (select ln2 ->> 'product_name' from jsonb_array_elements(o.lines) ln2
                 where (ln2 ->> 'missing')::int > 0 limit 1) as first_product,
               (select (ln2 ->> 'months')::int from jsonb_array_elements(o.lines) ln2
                 where (ln2 ->> 'missing')::int > 0 and ln2 ->> 'months' is not null limit 1) as first_months,
               coalesce(jsonb_agg(ln order by ln ->> 'product_name')
                        filter (where (ln ->> 'missing')::int > 0), '[]'::jsonb) as lines
          from jsonb_array_elements(o.lines) ln
      ) m
     where m.units > 0
  ),
  totals as (
    select count(*)::int as sales, coalesce(sum(units), 0)::int as units from owing
  )
  select jsonb_build_object(
           'rows', coalesce((
             select jsonb_agg(page.row_json)
               from (
                 select jsonb_build_object(
                          'sale_id',       o.sale_id,
                          'invoice_no',    o.invoice_no,
                          'status',        o.status,
                          'sold_on',       app.warranty_day(v_org, o.branch_id, o.sold_at),
                          'customer',      o.customer,
                          'units_missing', o.units,
                          'product_name',  o.first_product,
                          'months',        o.first_months,
                          'lines',         o.missing_lines
                        ) as row_json
                   from owing o
                  order by o.sold_at desc, o.sale_id asc
                  limit v_limit
               ) page), '[]'::jsonb),
           'total',       (select sales from totals),
           'units_total', (select units from totals),
           'limit',       v_limit,
           'window_days', v_days,
           'from',        v_from,
           'today',       v_today
         )
    into v_out;

  return v_out;
end
$fn$;

-- ── The dashboard and the header ──────────────────────────────────────────
create or replace function public.warranty_overview(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org     uuid := p_organization_id;
  v_config  jsonb;
  v_today   date;
  v_warn    integer;
  v_totals  jsonb;
  v_claims  jsonb;
  v_recent  jsonb;
  v_pending jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('warranty.view');

  v_config := app.warranty_config(v_org);
  v_warn   := (v_config ->> 'warn_days')::int;
  v_today  := app.warranty_today(v_org, null);

  select jsonb_build_object(
           'units',    count(*)::int,
           'active',   count(*) filter (where w.status = 'ACTIVE')::int,
           'expiring', count(*) filter (where w.status = 'ACTIVE' and w.ends_on >= v_today
                                          and w.ends_on <= v_today + v_warn)::int,
           'expired',  count(*) filter (where w.status = 'ACTIVE' and w.ends_on < v_today)::int,
           'void',     count(*) filter (where w.status = 'VOID')::int,
           'products', count(distinct w.product_id)::int
         )
    into v_totals
    from public.plg_warranty_warranties w
   where w.organization_id = v_org;

  select jsonb_build_object(
           'claims_total',            count(*)::int,
           'claims_open',             count(*) filter (where cl.status in ('OPEN', 'APPROVED', 'REPAIRING'))::int,
           'claims_cost_minor',       coalesce(round(sum(cl.cost) * 100), 0)::int,
           'claims_cost_open_minor',  coalesce(round(sum(cl.cost) filter (
                                        where cl.status in ('OPEN', 'APPROVED', 'REPAIRING')) * 100), 0)::int
         )
    into v_claims
    from public.plg_warranty_claims cl
   where cl.organization_id = v_org;

  select coalesce(jsonb_agg(recent.row_json), '[]'::jsonb)
    into v_recent
    from (
      select jsonb_build_object(
               'id',           w.id,
               'product_name', w.product_name,
               'unit_label',   w.unit_label,
               'unit_index',   w.unit_index,
               'months',       w.months,
               'ends_on',      w.ends_on,
               'days_left',    (w.ends_on - v_today),
               'status',       w.status,
               'invoice_no',   sa.invoice_no,
               'customer',     c.name
             ) as row_json
        from public.plg_warranty_warranties w
        left join public.sales sa on sa.id = w.sale_id
        left join public.customers c on c.id = w.customer_id
       where w.organization_id = v_org
       order by w.created_at desc, w.id asc
       limit 5
    ) recent;

  -- One call, one page: the queue is read here only for its two totals, so the
  -- page itself is asked for the smallest it can be.
  v_pending := public.warranty_pending(v_org, jsonb_build_object('days', 60, 'limit', 1));

  return jsonb_build_object(
    'totals', v_totals || coalesce(v_claims, '{}'::jsonb),
    'recent', v_recent,
    'today',  v_today,
    'pending', jsonb_build_object(
                 'sales',       (v_pending ->> 'total')::int,
                 'units',       (v_pending ->> 'units_total')::int,
                 'window_days', (v_pending ->> 'window_days')::int
               ),
    'config', v_config
  );
end
$fn$;

-- ── The two reports ───────────────────────────────────────────────────────
-- Rows the core reports screen draws, exports and prints like its own. Neither
-- report invents a second definition of a covered unit: they read the same
-- projection the register does, so an exported file cannot disagree with the
-- screen it came from.
create or replace function public.warranty_report(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org    uuid := p_organization_id;
  v_type   text := lower(coalesce(nullif(p_args ->> 'type', ''), 'expiring'));
  v_days   integer := greatest(1, least(730, coalesce((p_args ->> 'days')::int, 90)));
  v_limit  integer := greatest(1, least(2000, coalesce((p_args ->> 'limit')::int, 200)));
  v_offset integer := greatest(0, coalesce((p_args ->> 'offset')::int, 0));
  v_from   date := nullif(p_args ->> 'from', '')::date;
  v_to     date := nullif(p_args ->> 'to', '')::date;
  v_today  date;
  v_page   jsonb;
  v_claims jsonb;
  v_totals jsonb;
begin
  perform app.require_org(v_org);
  perform app.require_permission('warranty.view');

  v_today := app.warranty_today(v_org, null);

  if v_type = 'expiring' then
    -- A window control on an expiry report cannot mean "trade in August": the
    -- question is always how far ahead to look. So the same six buttons answer
    -- that instead, and the window becomes a horizon in days.
    v_page := app.warranty_page(v_org, jsonb_build_object(
      'scope',     case when coalesce((p_args ->> 'include_expired')::boolean, false)
                        then 'active' else 'expiring' end,
      'ends_to',   to_char(v_today + v_days, 'YYYY-MM-DD'),
      'limit',     v_limit,
      'offset',    v_offset,
      'warn_days', v_days
    ));

    select jsonb_build_object(
             'units',    (v_page ->> 'total')::int,
             'expired',  (select count(*)::int from public.plg_warranty_warranties w
                           where w.organization_id = v_org and w.status = 'ACTIVE'
                             and w.ends_on < v_today),
             'claims',   (select count(*)::int from public.plg_warranty_warranties w
                           where w.organization_id = v_org and w.status = 'ACTIVE'
                             and w.ends_on <= v_today + v_days
                             and exists (select 1 from public.plg_warranty_claims cl
                                          where cl.organization_id = v_org
                                            and cl.warranty_id = w.id))
           ) into v_totals;

    return jsonb_build_object(
      'type', 'expiring', 'rows', v_page -> 'rows', 'total', (v_page ->> 'total')::int,
      'limit', v_limit, 'offset', v_offset, 'totals', v_totals,
      'today', v_today, 'horizon_days', v_days, 'ends_to', to_char(v_today + v_days, 'YYYY-MM-DD')
    );
  end if;

  if v_type = 'claims' then
    v_claims := app.warranty_claim_rows(v_org, jsonb_build_object(
      'status', 'ALL',
      'from',   to_char(coalesce(v_from, v_today - v_days), 'YYYY-MM-DD'),
      'to',     to_char(coalesce(v_to, v_today), 'YYYY-MM-DD'),
      'limit',  v_limit,
      'offset', v_offset
    ));

    select jsonb_build_object(
             'claims',     (v_claims ->> 'total')::int,
             'open',       count(*) filter (where cl.status in ('OPEN', 'APPROVED', 'REPAIRING'))::int,
             'replaced',   count(*) filter (where cl.status = 'REPLACED')::int,
             'rejected',   count(*) filter (where cl.status = 'REJECTED')::int,
             'cost_minor', coalesce(round(sum(cl.cost) * 100), 0)::int
           )
      into v_totals
      from public.plg_warranty_claims cl
     where cl.organization_id = v_org
       and cl.opened_on between coalesce(v_from, v_today - v_days) and coalesce(v_to, v_today);

    return jsonb_build_object(
      'type', 'claims', 'rows', v_claims -> 'rows', 'total', (v_claims ->> 'total')::int,
      'limit', v_limit, 'offset', v_offset, 'totals', v_totals,
      'today', v_today,
      'from', to_char(coalesce(v_from, v_today - v_days), 'YYYY-MM-DD'),
      'to',   to_char(coalesce(v_to, v_today), 'YYYY-MM-DD')
    );
  end if;

  raise exception 'warranty_unknown_report: %', v_type using errcode = '22023';
end
$fn$;

-- ── Tenant safety, by construction ────────────────────────────────────────
-- Both tables carry RLS, an organization_id and policies; this repeats the
-- check 038 runs over every package, because a plugin that ships a table
-- without them must fail when it is enabled in development rather than quietly
-- in a shop.
do $verify$
declare
  v_missing text[] := '{}';
  v_table   text;
begin
  foreach v_table in array array['plg_warranty_warranties', 'plg_warranty_claims']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_table
         and c.relkind = 'r' and c.relrowsecurity
    ) then
      v_missing := v_missing || (v_table || ' (rls)');
    end if;
    if not exists (
      select 1 from information_schema.columns col
       where col.table_schema = 'public' and col.table_name = v_table
         and col.column_name = 'organization_id'
    ) then
      v_missing := v_missing || (v_table || ' (organization_id)');
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    raise exception 'warranty_package_unsafe: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;
end
$verify$;
$plg_2$;

  insert into public.plugin_package_migrations
        (plugin_key, filename, version, ordinal, checksum, sql)
  values ('warranty', v_file, '1.0.0', v_ordinal, md5(v_sql), v_sql)
  on conflict (plugin_key, filename) do update
     set version = excluded.version,
         ordinal = excluded.ordinal,
         checksum = excluded.checksum,
         sql = excluded.sql;
end
$seed$;

-- ── The package is complete ──────────────────────────────────────────────
-- The same shape 041 ends with: a package that shipped half its files would
-- install a plugin whose functions call tables that do not exist, and the
-- failure would surface in a shop rather than here.
do $verify$
declare
  v_missing text[] := '{}';
  v_file text;
begin
  foreach v_file in array array['001_tables.sql', '002_functions.sql']
  loop
    if not exists (
      select 1 from public.plugin_package_migrations m
       where m.plugin_key = 'warranty' and m.filename = v_file
    ) then
      v_missing := v_missing || v_file;
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    raise exception 'warranty_package_incomplete: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;

  if (select count(*) from public.plugin_package_permissions p where p.plugin_key = 'warranty') <> 2 then
    raise exception 'warranty_package_incomplete: permission rows' using errcode = 'P0001';
  end if;

  if (select count(*) from public.plugin_package_migrations m where m.plugin_key = 'warranty') <> 2 then
    raise exception 'warranty_package_incomplete: migration rows' using errcode = 'P0001';
  end if;
end
$verify$;
