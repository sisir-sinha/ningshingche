-- The thing a shop promises, and the thing it has to honour.
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
