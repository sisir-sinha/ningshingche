-- Loyalty — the points a shop owes its customers.
--
-- Points are money the shop has promised to hand back, so the point of this
-- plugin is that the promise is *countable*: an append-only ledger of every
-- movement, each row naming the sale it came from, and never a stored balance
-- that a crash can leave half-written. `points` and `lifetime_points` on the
-- account are the ledger's sum, kept in the same transaction that writes the
-- row — a cache, not a second truth, and `loyalty_audit` in the functions file
-- is the check that the two still agree.
--
-- Three tables, and deliberately only three:
--
--   * `plg_loyalty_accounts` — one row per customer who has ever earned
--     anything, with the tier derived from `lifetime_points` on read.
--   * `plg_loyalty_ledger`  — append-only. EARN (a sale), REVERSAL (a return
--     took the points back), REDEEM (money off, from the till), RELEASE (a
--     redemption the customer never used), ADJUST (a shopkeeper's correction).
--   * `plg_loyalty_state`   — the watermark: which sales have been walked.
--
-- Two things are deliberately *not* here:
--
--   * **The rule.** How many points a taka earns, what a point is worth, the
--     tier ladder — all of it is shop settings, read on every write. A rule
--     change is meant to apply to tomorrow, not to rewrite last month, which
--     works because each ledger row stores the rate it was written with.
--   * **Expiry.** Points that expire need a walk of the ledger in order to
--     decide which earn a redemption consumed, and that is a policy with a
--     screen behind it. Every earn row is kept forever, so it can arrive later
--     without a data migration. Saying "not yet" is honest; a half-built expiry
--     that silently burns points is not.
--
-- The customer is the account key, so a shop can see that a walk-in earned
-- nothing — which is the whole reason the till grew a customer control for this
-- plugin to exist.

create table if not exists public.plg_loyalty_accounts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  customer_id      uuid not null references public.customers(id) on delete cascade,
  -- The ledger's sum. Integer points: a shop promises a number of points, not
  -- a fraction of one, and rounding at the end of a sum is how a balance drifts
  -- by one from the rows it claims to be the sum of.
  points           integer not null default 0 check (points >= 0),
  lifetime_points  integer not null default 0 check (lifetime_points >= 0),
  note             text,
  joined_at        timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A customer cannot be two accounts in the same shop.
  constraint plg_loyalty_accounts_unique unique (organization_id, customer_id)
);

create index if not exists plg_loyalty_accounts_points_idx
  on public.plg_loyalty_accounts (organization_id, points desc);

-- `lifetime_points` never falls, so the tier ladder is a read of this number
-- rather than a stored tier that a rule change would leave lying.
create index if not exists plg_loyalty_accounts_lifetime_idx
  on public.plg_loyalty_accounts (organization_id, lifetime_points desc);

drop trigger if exists plg_loyalty_accounts_touch on public.plg_loyalty_accounts;
create trigger plg_loyalty_accounts_touch
  before update on public.plg_loyalty_accounts
  for each row execute function public.set_updated_at();

-- ── The ledger ────────────────────────────────────────────────────────────

create table if not exists public.plg_loyalty_ledger (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  account_id       uuid not null references public.plg_loyalty_accounts(id) on delete cascade,
  customer_id      uuid not null references public.customers(id) on delete cascade,
  kind             text not null
                     check (kind in ('EARN', 'REVERSAL', 'REDEEM', 'RELEASE', 'ADJUST')),
  -- Signed: EARN/ADJUST/RELEASE add, REDEEM/REVERSAL subtract.
  points           integer not null,
  -- What the points were worth to the customer, on a redemption. Money the
  -- shop actually gave away, in minor units — the number a report adds up.
  money_minor      bigint check (money_minor is null or money_minor >= 0),
  -- The rule in force when this row was written: both halves of it, so a
  -- reversal of this row months later reproduces it exactly rather than
  -- guessing from today's ladder.
  rate             numeric,
  bonus            integer not null default 0,
  -- A redemption is reserved *before* the sale exists: the money is already off
  -- the till's total when the cashier presses Apply. `token` is the till's
  -- handle for that reservation and `sale_id` names the sale it was spent on,
  -- which arrives a moment later (or, offline, an hour later).
  token            text,
  sale_id          uuid references public.sales(id) on delete set null,
  sale_return_id   uuid references public.sale_returns(id) on delete set null,
  note             text,
  created_by       uuid,
  created_at       timestamptz not null default now()
);

-- One credit per sale, ever. This is what makes it safe to reconcile from the
-- `sales` table on any screen the shopkeeper opens, twice, on two devices: the
-- second walk finds the row and writes nothing.
create unique index if not exists plg_loyalty_ledger_earn_idx
  on public.plg_loyalty_ledger (organization_id, sale_id)
  where kind = 'EARN';

-- And one reversal per return: a sale can be returned in parts, and each part
-- takes back its own share.
create unique index if not exists plg_loyalty_ledger_reversal_idx
  on public.plg_loyalty_ledger (organization_id, sale_id, sale_return_id)
  where kind = 'REVERSAL';

-- One reservation per token, so a retried `loyalty_redeem` (the till that lost
-- the answer) cannot debit the customer twice…
create unique index if not exists plg_loyalty_ledger_token_idx
  on public.plg_loyalty_ledger (organization_id, token)
  where kind = 'REDEEM';

-- …and one release per reservation, for the same reason on the way back.
create unique index if not exists plg_loyalty_ledger_release_idx
  on public.plg_loyalty_ledger (organization_id, token)
  where kind = 'RELEASE';

create index if not exists plg_loyalty_ledger_account_idx
  on public.plg_loyalty_ledger (organization_id, account_id, created_at desc);

-- The worklist: reservations that never found a sale.
create index if not exists plg_loyalty_ledger_open_idx
  on public.plg_loyalty_ledger (organization_id, created_at)
  where kind = 'REDEEM' and sale_id is null;

-- ── The watermark ─────────────────────────────────────────────────────────

create table if not exists public.plg_loyalty_state (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- The moment of the last walk, not "sales completed before this": a till that
  -- sold offline replays an hour later, and the row it writes is new to the
  -- table even though the sale itself happened earlier. The walk re-reads a few
  -- minutes behind this mark, and the ledger's own unique index is what makes
  -- the overlap cost nothing.
  synced_through  timestamptz not null default now(),
  last_synced_at  timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists plg_loyalty_state_touch on public.plg_loyalty_state;
create trigger plg_loyalty_state_touch
  before update on public.plg_loyalty_state
  for each row execute function public.set_updated_at();

-- ── Tenant safety ─────────────────────────────────────────────────────────
-- Every table a plugin creates is org-scoped, RLS-on, and readable only by the
-- permission that owns it. `app.plugin_assert_plugin_schema` refuses to enable
-- the plugin at all if any of that is missing, so this section is the plugin's
-- entry ticket rather than its good intentions.

alter table public.plg_loyalty_accounts enable row level security;
alter table public.plg_loyalty_ledger enable row level security;
alter table public.plg_loyalty_state enable row level security;

-- Reading the register needs `loyalty.view`; everything that moves a point goes
-- through a function that checks a stronger permission (`loyalty.manage` for a
-- correction, `loyalty.redeem` at the till). Direct writes are granted to
-- nobody: the ledger is append-only and the balance is its sum, which is a
-- property only a function can keep.
drop policy if exists plg_loyalty_accounts_select on public.plg_loyalty_accounts;
create policy plg_loyalty_accounts_select on public.plg_loyalty_accounts
  for select using (app.in_org(organization_id) and app.has_permission('loyalty.view'));

drop policy if exists plg_loyalty_ledger_select on public.plg_loyalty_ledger;
create policy plg_loyalty_ledger_select on public.plg_loyalty_ledger
  for select using (app.in_org(organization_id) and app.has_permission('loyalty.view'));

drop policy if exists plg_loyalty_state_select on public.plg_loyalty_state;
create policy plg_loyalty_state_select on public.plg_loyalty_state
  for select using (app.in_org(organization_id) and app.has_permission('loyalty.view'));

grant select on public.plg_loyalty_accounts to authenticated;
grant select on public.plg_loyalty_ledger to authenticated;
grant select on public.plg_loyalty_state to authenticated;
