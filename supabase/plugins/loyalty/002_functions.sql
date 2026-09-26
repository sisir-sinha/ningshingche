-- Loyalty — the arithmetic and the only writers of a point.
--
-- The shape of this plugin follows from one decision: **a customer's points are
-- a projection of the shop's own sales, not a message that has to arrive.**
--
-- The obvious way to build loyalty is a listener on `sale.completed` that
-- awards points afterwards. It is also the way that loses points: a till that
-- dies between the sale and the award never awards them, a phone that was
-- offline awards them twice, and Android has to reimplement the rule in Kotlin
-- (docs/01 §2 lists exactly this as a rejected design). So the rule lives here,
-- in SQL, and `loyalty_sync` walks the sales table: every completed sale with a
-- customer gets one EARN row, and a unique index makes the second walk — on
-- another device, an hour later, after a crash — write nothing.
--
-- That makes the plugin *self-healing* rather than merely fast: whatever the
-- till does, opening the loyalty screen (or the dashboard tile, or the customer
-- panel) reconciles the shop, and the ledger is the answer to "where did these
-- points come from?" — every row names its sale.
--
-- The other half is redemption, and it runs the other way round. The till takes
-- money off the sale *now* (`PluginAPI.registerSaleAdjustment`), so the points
-- are reserved *before* the sale exists: `loyalty_redeem` debits them against a
-- token, and `loyalty_settle` binds the token to the invoice a moment later. If
-- the customer walks away, the reservation is visible in the shop's own
-- worklist and `loyalty_release` hands the points back — a shop is never left
-- holding points it cannot account for, and a customer can never spend the same
-- points twice.

-- ── The rule, as the shop set it ──────────────────────────────────────────

create or replace function app.loyalty_config(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_config jsonb := '{}'::jsonb;
  v_rate   numeric;
  v_value  numeric;
  v_min    integer;
  v_tiers  jsonb;
begin
  select p.config into v_config
    from public.plugins p
   where p.organization_id = p_organization_id
     and p.plugin_key = 'loyalty';

  -- A rate of "points per one unit of currency", with at most two decimals —
  -- the settings screen offers a number with `step: 0.1`, and a third decimal
  -- would make the same receipt earn differently on two devices.
  v_rate := coalesce(nullif(v_config ->> 'points_per_currency', '')::numeric, 1);
  if v_rate < 0 or v_rate > 1000 then v_rate := 1; end if;
  v_rate := round(v_rate, 2);

  -- How many points equal one unit of currency. 100 points to the taka is the
  -- default, which makes a point worth a paisa and a redemption easy to read.
  v_value := coalesce(nullif(v_config ->> 'redeem_rate', '')::numeric, 100);
  if v_value < 1 or v_value > 100000 then v_value := 100; end if;

  v_min := coalesce(nullif(v_config ->> 'min_redeem_points', '')::integer, 100);
  if v_min < 1 or v_min > 1000000 then v_min := 100; end if;

  v_tiers := app.loyalty_tiers(v_config -> 'tiers');

  return jsonb_build_object(
    'points_per_currency', v_rate,
    'rate_x100',           round(v_rate * 100)::integer,
    'redeem_rate',         v_value,
    'redeem_x100',         round(v_value * 100)::integer,
    'min_redeem_points',   v_min,
    'tiers',               v_tiers
  );
end
$fn$;

-- The ladder, cleaned and ordered, with a default a shop can just keep.
--
-- A tier is derived from `lifetime_points` on every read — never stored — so a
-- shopkeeper who renames "Gold" or moves the threshold sees the whole shop
-- relabelled at once, and no customer can be left holding a tier the ladder no
-- longer has. `bonus` is the percent of extra points that tier earns.
create or replace function app.loyalty_tiers(p_tiers jsonb)
returns jsonb
language plpgsql
immutable
as $fn$
declare
  v_default jsonb := jsonb_build_array(
    jsonb_build_object('id', 'bronze', 'name', 'Bronze', 'from', 0,    'bonus', 0),
    jsonb_build_object('id', 'silver', 'name', 'Silver', 'from', 1000, 'bonus', 25),
    jsonb_build_object('id', 'gold',   'name', 'Gold',   'from', 5000, 'bonus', 50)
  );
  v_clean jsonb := '[]'::jsonb;
  v_row   record;
begin
  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) = 0 then
    return v_default;
  end if;

  for v_row in
    select
      coalesce(nullif(trim(t ->> 'name'), ''), 'Tier')                       as name,
      greatest(coalesce(nullif(t ->> 'from', '')::numeric, 0), 0)::integer    as from_points,
      least(greatest(coalesce(nullif(t ->> 'bonus', '')::numeric, 0), 0), 1000)::integer as bonus
      from jsonb_array_elements(p_tiers) as t
  loop
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'id',    lower(regexp_replace(v_row.name, '[^a-zA-Z0-9]+', '-', 'g')),
      'name',  v_row.name,
      'from',  v_row.from_points,
      'bonus', v_row.bonus
    ));
  end loop;

  -- A ladder out of order is a ladder a shopkeeper cannot read; sort it and
  -- make sure somebody is always at the bottom of it.
  v_clean := (
    select coalesce(jsonb_agg(entry order by (entry ->> 'from')::integer, entry ->> 'name'), '[]'::jsonb)
      from jsonb_array_elements(v_clean) as entry
  );

  if (v_clean -> 0 ->> 'from')::integer <> 0 then
    v_clean := jsonb_build_array(
      jsonb_build_object('id', 'member', 'name', 'Member', 'from', 0, 'bonus', 0)
    ) || v_clean;
  end if;

  return v_clean;
end
$fn$;

-- Points a sale of this size earns, in two exact integer steps.
--
-- `total_minor * rate_x100 / 10000` is the base; the tier's bonus is applied to
-- the *base*, not to the money, so the two roundings are the same two the
-- client does (`src/plugins/loyalty/helpers.ts`) — a receipt that says "you
-- earned 18 points" and a ledger that says 19 is a support call nobody can win.
-- Rounded down: a shop never promises a fraction of a point it does not have.
create or replace function app.loyalty_points_for(
  p_total_minor bigint,
  p_rate_x100   integer,
  p_bonus       integer
)
returns integer
language sql
immutable
as $fn$
  select greatest(
    floor(floor(greatest(p_total_minor, 0)::numeric * greatest(p_rate_x100, 0) / 10000)
          * (100 + greatest(coalesce(p_bonus, 0), 0)) / 100)::integer,
    0)
$fn$;

-- What a number of points is worth in money, and the other way round. Both are
-- exact integer arithmetic for the same reason.
create or replace function app.loyalty_money_for(p_points integer, p_redeem_x100 integer)
returns bigint
language sql
immutable
as $fn$
  select floor(greatest(p_points, 0)::numeric * 10000 / greatest(p_redeem_x100, 1))::bigint
$fn$;

create or replace function app.loyalty_points_for_money(p_money_minor bigint, p_redeem_x100 integer)
returns integer
language sql
immutable
as $fn$
  select ceil(greatest(p_money_minor, 0)::numeric * greatest(p_redeem_x100, 1) / 10000)::integer
$fn$;

-- The tier a lifetime total sits in: the highest rung it has reached.
create or replace function app.loyalty_tier(p_lifetime integer, p_tiers jsonb)
returns jsonb
language sql
immutable
as $fn$
  select coalesce(
    (select e
       from jsonb_array_elements(p_tiers) as e
      where (e ->> 'from')::integer <= greatest(coalesce(p_lifetime, 0), 0)
      order by (e ->> 'from')::integer desc
      limit 1),
    jsonb_build_object('id', 'member', 'name', 'Member', 'from', 0, 'bonus', 0))
$fn$;

-- The account, created on first use. Nothing else in this file writes a row
-- without one.
create or replace function app.loyalty_account_ensure(p_org uuid, p_customer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  select a.id into v_id
    from public.plg_loyalty_accounts a
   where a.organization_id = p_org
     and a.customer_id = p_customer_id;

  if v_id is not null then return v_id; end if;

  insert into public.plg_loyalty_accounts (organization_id, customer_id)
  values (p_org, p_customer_id)
  on conflict (organization_id, customer_id) do nothing;

  select a.id into v_id
    from public.plg_loyalty_accounts a
   where a.organization_id = p_org
     and a.customer_id = p_customer_id;

  return v_id;
end
$fn$;

-- ── The walk: sales become points, once each ──────────────────────────────

-- Reconcile the shop's points with the shop's sales.
--
-- One pass over two ranges — sales the shop has taken since somebody last
-- looked, and returns against sales already credited — and every write is
-- guarded by a unique index rather than by "we have probably not done this
-- yet". Safe to call on every screen open; the shop pays for the sales it has
-- taken since somebody last looked, and nothing at all when there are none.
--
-- Two details are what make this safe rather than merely fast:
--
--   * the window is re-scanned with a **five-minute overlap**, because a sale
--     inserted by a transaction that had not committed when we last looked
--     would otherwise be stepped over for ever — and "for ever" is a long time
--     to owe a customer points. The unique index makes the overlap an index
--     probe, not a second credit;
--   * a sale is caught by **when it was recorded, not when it happened**. A
--     till that sold offline replays an hour later, and the row it writes is
--     new to this table even though its `completed_at` is in the past.
create or replace function app.loyalty_sync(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_config   jsonb   := app.loyalty_config(p_org);
  v_rate     integer := (v_config ->> 'rate_x100')::integer;
  v_tiers    jsonb   := v_config -> 'tiers';
  v_from     timestamptz;
  v_now      timestamptz := now();
  v_earned   integer := 0;
  v_reversed integer := 0;
  v_sales    integer := 0;
  v_account  uuid;
  v_points   integer;
  v_bonus    integer;
  v_row      record;
begin
  select s.synced_through into v_from
    from public.plg_loyalty_state s
   where s.organization_id = p_org;

  if v_from is null then
    -- First walk: everything the shop still has. A shop that installs loyalty
    -- in its third year starts its customers with the points they have already
    -- earned, which is the only answer a shopkeeper will accept.
    v_from := '-infinity'::timestamptz;
  else
    v_from := v_from - interval '5 minutes';
  end if;

  -- ── Sales that earned something and have not been credited ─────────────
  for v_row in
    select sa.id, sa.customer_id, sa.total, sa.completed_at,
           coalesce(a.lifetime_points, 0) as lifetime
      from public.sales sa
      left join public.plg_loyalty_accounts a
        on a.organization_id = sa.organization_id
       and a.customer_id = sa.customer_id
     where sa.organization_id = p_org
       and sa.customer_id is not null
       and sa.status = 'COMPLETED'
       and greatest(sa.created_at, coalesce(sa.completed_at, sa.created_at)) > v_from
       and not exists (
         select 1 from public.plg_loyalty_ledger l
          where l.organization_id = p_org
            and l.sale_id = sa.id
            and l.kind = 'EARN'
       )
     order by greatest(sa.created_at, coalesce(sa.completed_at, sa.created_at))
  loop
    v_bonus  := (app.loyalty_tier(v_row.lifetime, v_tiers) ->> 'bonus')::integer;
    v_points := app.loyalty_points_for(round(v_row.total * 100)::bigint, v_rate, v_bonus);
    v_sales  := v_sales + 1;

    -- A sale worth no points is still *walked*: the ledger says "this sale
    -- earned nothing", which is a different fact from "nobody has looked".
    v_account := app.loyalty_account_ensure(p_org, v_row.customer_id);

    insert into public.plg_loyalty_ledger
          (organization_id, account_id, customer_id, kind, points, rate, bonus, sale_id, created_at)
    values (p_org, v_account, v_row.customer_id, 'EARN', v_points,
            (v_config ->> 'points_per_currency')::numeric, v_bonus, v_row.id,
            coalesce(v_row.completed_at, v_now))
    on conflict do nothing;

    if v_points <> 0 then
      update public.plg_loyalty_accounts a
         set points          = a.points + v_points,
             lifetime_points = a.lifetime_points + greatest(v_points, 0),
             last_activity_at = greatest(a.last_activity_at, coalesce(v_row.completed_at, v_now))
       where a.id = v_account;
      v_earned := v_earned + v_points;
    end if;
  end loop;

  -- ── Returns against sales we credited ──────────────────────────────────
  --
  -- A returned kilo must stop counting as sold, and it must stop counting at
  -- the rate it was credited at: the earn row stores the rate, so a shop that
  -- changes the rule next month still reverses this month correctly.
  for v_row in
    select r.id as return_id, r.sale_id, r.refund_total, r.return_no, r.created_at,
           l.account_id, l.customer_id, l.rate, l.bonus, a.points as held
      from public.sale_returns r
      join public.plg_loyalty_ledger l
        on l.organization_id = r.organization_id
       and l.sale_id = r.sale_id
       and l.kind = 'EARN'
      join public.plg_loyalty_accounts a on a.id = l.account_id
     where r.organization_id = p_org
       and not exists (
         select 1 from public.plg_loyalty_ledger x
          where x.organization_id = p_org
            and x.sale_id = r.sale_id
            and x.sale_return_id = r.id
            and x.kind = 'REVERSAL'
       )
     order by r.created_at
  loop
    -- Money back, points back — at the rate *and the tier bonus* that sale was
    -- credited with. Both travel on the earn row, so a rule change next month
    -- still reverses this month's return correctly.
    v_points := -app.loyalty_points_for(
      round(v_row.refund_total * 100)::bigint,
      round(coalesce(v_row.rate, 0) * 100)::integer,
      coalesce(v_row.bonus, 0)
    );

    -- Points the customer has already spent are the shop's loss, not a debt:
    -- a return takes back what is still on the account and no more. Clamping
    -- the *row* rather than the balance is what keeps the account exactly the
    -- sum of its ledger — `loyalty_overview` reports the drift if it ever is
    -- not, and a clamp in the balance would have manufactured that drift.
    v_points := greatest(v_points, -v_row.held);

    insert into public.plg_loyalty_ledger
          (organization_id, account_id, customer_id, kind, points, rate, bonus,
           sale_id, sale_return_id, note, created_at)
    values (p_org, v_row.account_id, v_row.customer_id, 'REVERSAL', v_points,
            v_row.rate, coalesce(v_row.bonus, 0), v_row.sale_id, v_row.return_id,
            'Return ' || v_row.return_no, v_row.created_at)
    on conflict do nothing;

    if v_points <> 0 then
      update public.plg_loyalty_accounts a
         set points = a.points + v_points,
             last_activity_at = greatest(a.last_activity_at, v_row.created_at)
       where a.id = v_row.account_id;
      v_reversed := v_reversed + v_points;
    end if;
  end loop;

  insert into public.plg_loyalty_state (organization_id, synced_through, last_synced_at)
  values (p_org, v_now, v_now)
  on conflict (organization_id) do update
     set synced_through = greatest(public.plg_loyalty_state.synced_through, excluded.synced_through),
         last_synced_at = excluded.last_synced_at;

  return jsonb_build_object('sales', v_sales, 'earned', v_earned, 'reversed', v_reversed);
end
$fn$;

-- ── What the shop looks at ────────────────────────────────────────────────

-- The register: who is a member, what they hold, and which tier that buys.
create or replace function app.loyalty_members(p_org uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_search text := nullif(trim(coalesce(p_args ->> 'search', '')), '');
  v_limit  integer := least(greatest(coalesce(nullif(p_args ->> 'limit', '')::integer, 25), 1), 200);
  v_offset integer := greatest(coalesce(nullif(p_args ->> 'offset', '')::integer, 0), 0);
  v_config jsonb := app.loyalty_config(p_org);
  v_tiers  jsonb := v_config -> 'tiers';
  v_redeem integer := (v_config ->> 'redeem_x100')::integer;
  v_rows   jsonb;
  v_total  integer;
begin
  select
    coalesce(jsonb_agg(entry order by (entry ->> 'points')::integer desc, entry ->> 'customer'), '[]'::jsonb),
    count(*)::integer
    into v_rows, v_total
    from (
      select jsonb_build_object(
               'customer_id',     a.customer_id,
               'customer',        c.name,
               'phone',           c.phone,
               'points',          a.points,
               'lifetime_points', a.lifetime_points,
               'tier',            app.loyalty_tier(a.lifetime_points, v_tiers),
               'value_minor',     app.loyalty_money_for(a.points, v_redeem),
               'joined_at',       a.joined_at,
               'last_activity_at', a.last_activity_at
             ) as entry
        from public.plg_loyalty_accounts a
        join public.customers c
          on c.id = a.customer_id
         and c.deleted_at is null
       where a.organization_id = p_org
         and (
           v_search is null
           or c.name ilike '%' || v_search || '%'
           or coalesce(c.phone, '') like '%' || v_search || '%'
         )
       order by a.points desc, c.name
       limit v_limit offset v_offset
    ) as page;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end
$fn$;

-- One customer's account: the balance, the tier, and what made it that.
create or replace function app.loyalty_account(p_org uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_customer uuid := nullif(p_args ->> 'customer_id', '')::uuid;
  v_limit    integer := least(greatest(coalesce(nullif(p_args ->> 'limit', '')::integer, 30), 1), 200);
  v_config   jsonb := app.loyalty_config(p_org);
  v_account  record;
  v_ledger   jsonb;
  v_open     jsonb;
begin
  -- The till's own read: a cashier may hold `loyalty.redeem` without
  -- `loyalty.view` — the balance in front of them is part of giving the money
  -- away — but a cashier with neither is not told anything about a customer.
  if not app.in_org(p_org) then
    raise exception 'forbidden: organization %', p_org using errcode = '42501';
  end if;
  if not (app.has_permission('loyalty.view') or app.has_permission('loyalty.redeem')) then
    raise exception 'permission_denied: loyalty.view' using errcode = '42501';
  end if;

  if v_customer is null then
    raise exception 'loyalty_customer_required' using errcode = '22023';
  end if;

  select a.id, a.points, a.lifetime_points, a.joined_at, a.last_activity_at,
         c.name, c.phone
    into v_account
    from public.plg_loyalty_accounts a
    join public.customers c on c.id = a.customer_id
   where a.organization_id = p_org
     and a.customer_id = v_customer;

  if not found then
    -- Not a member yet is an ordinary answer, not an error: the customer panel
    -- asks about every customer the cashier attaches.
    return jsonb_build_object(
      'customer_id', v_customer,
      'member',      false,
      'points',      0,
      'lifetime_points', 0,
      'value_minor', 0,
      'min_redeem_points', (v_config ->> 'min_redeem_points')::integer,
      'redeem_rate', (v_config ->> 'redeem_rate')::numeric,
      'tier', app.loyalty_tier(0, v_config -> 'tiers'),
      'ledger', '[]'::jsonb,
      'open', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(entry order by entry ->> 'created_at' desc), '[]'::jsonb)
    into v_ledger
    from (
      select jsonb_build_object(
               'id',          l.id,
               'kind',        l.kind,
               'points',      l.points,
               'money_minor', l.money_minor,
               'sale_id',     l.sale_id,
               'invoice_no',  s.invoice_no,
               'token',       l.token,
               'note',        l.note,
               'created_at',  l.created_at
             ) as entry
        from public.plg_loyalty_ledger l
        left join public.sales s on s.id = l.sale_id
       where l.organization_id = p_org
         and l.account_id = v_account.id
       order by l.created_at desc
       limit v_limit
    ) as page;

  -- Reservations the customer has not used yet: money is off a sale, or about
  -- to be. The shopkeeper sees them because they are the only points that can
  -- be given back.
  select coalesce(jsonb_agg(jsonb_build_object(
           'token',    l.token,
           'points',   -l.points,
           'money_minor', l.money_minor,
           'created_at', l.created_at,
           'note',     l.note
         ) order by l.created_at desc), '[]'::jsonb)
    into v_open
    from public.plg_loyalty_ledger l
   where l.organization_id = p_org
     and l.account_id = v_account.id
     and l.kind = 'REDEEM'
     and l.sale_id is null
     and not exists (
       select 1 from public.plg_loyalty_ledger x
        where x.organization_id = p_org
          and x.kind = 'RELEASE'
          and x.token = l.token
     );

  return jsonb_build_object(
    'customer_id',       v_customer,
    'member',            true,
    'customer',          v_account.name,
    'phone',             v_account.phone,
    'points',            v_account.points,
    'lifetime_points',   v_account.lifetime_points,
    'value_minor',       app.loyalty_money_for(v_account.points, (v_config ->> 'redeem_x100')::integer),
    'min_redeem_points', (v_config ->> 'min_redeem_points')::integer,
    'redeem_rate',       (v_config ->> 'redeem_rate')::numeric,
    'tier',              app.loyalty_tier(v_account.lifetime_points, v_config -> 'tiers'),
    'tiers',             v_config -> 'tiers',
    'joined_at',         v_account.joined_at,
    'last_activity_at',  v_account.last_activity_at,
    'ledger',            v_ledger,
    'open',              v_open
  );
end
$fn$;

-- ── The plugin's public face, as the bridge dispatches it ────────────────
--
-- `plugin_rpc` calls `public.loyalty_<fn>(uuid, jsonb)` and nothing else, so
-- every read the app makes has a public name. Each one checks who is asking,
-- and each one *catches the shop up* before it answers: the walk is what turns
-- the shop's own sales into points, and a screen that skipped it would show a
-- number that is true of yesterday. The walk is an index probe when there is
-- nothing new, which is the usual case.

create or replace function public.loyalty_members(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('loyalty.view');
  perform app.loyalty_sync(p_organization_id);
  return app.loyalty_members(p_organization_id, p_args);
end
$fn$;

-- The till's own read, and the one place `loyalty.redeem` is enough on its own:
-- a cashier who may hand money back has to be able to see what the customer
-- holds. It stays volatile because it walks the shop's sales first.
create or replace function public.loyalty_account(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform app.require_org(p_organization_id);

  if not app.has_permission('loyalty.view') and not app.has_permission('loyalty.redeem') then
    raise exception 'permission_denied: loyalty.view' using errcode = '42501';
  end if;

  perform app.loyalty_sync(p_organization_id);
  return app.loyalty_account(p_organization_id, p_args);
end
$fn$;

-- ── The two things that move a point, and the cashier's one ───────────────

-- Take the points for money the till is about to give away.
--
-- Called *before* the sale exists, with a token the till made. The debit is
-- real and immediate — that is what stops the same points being spent at two
-- tills — and the token is what lets the shop undo it if the customer changes
-- their mind.
create or replace function public.loyalty_redeem(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid := p_organization_id;
  v_customer uuid := nullif(p_args ->> 'customer_id', '')::uuid;
  v_token    text := nullif(trim(coalesce(p_args ->> 'token', '')), '');
  v_points   integer := coalesce(nullif(p_args ->> 'points', '')::integer, 0);
  v_config   jsonb := app.loyalty_config(p_organization_id);
  v_account  record;
  v_existing record;
  v_money    bigint;
  v_min      integer;
begin
  perform app.require_org(v_org);
  perform app.require_permission('loyalty.redeem');

  if v_customer is null or v_token is null then
    raise exception 'loyalty_redeem_invalid: a customer and a token are required'
      using errcode = '22023';
  end if;
  if v_points <= 0 then
    raise exception 'loyalty_redeem_invalid: % is not a number of points', v_points
      using errcode = '22023';
  end if;

  -- A retried call — the till lost the answer, the phone resends — returns the
  -- reservation that already exists rather than taking the points twice.
  select l.points, l.money_minor, l.account_id into v_existing
    from public.plg_loyalty_ledger l
   where l.organization_id = v_org
     and l.kind = 'REDEEM'
     and l.token = v_token;

  if found then
    return jsonb_build_object(
      'token',  v_token,
      'points', -v_existing.points,
      'money_minor', v_existing.money_minor,
      'replayed', true
    );
  end if;

  v_min := (v_config ->> 'min_redeem_points')::integer;
  if v_points < v_min then
    raise exception 'loyalty_below_minimum: this shop redeems in steps of % points or more', v_min
      using errcode = 'P0001';
  end if;

  select a.id, a.points into v_account
    from public.plg_loyalty_accounts a
   where a.organization_id = v_org
     and a.customer_id = v_customer
     for update;

  if not found then
    raise exception 'loyalty_no_account: this customer has not earned any points yet'
      using errcode = 'P0001';
  end if;

  if v_account.points < v_points then
    raise exception 'loyalty_insufficient_points: % points asked for, % on the account',
      v_points, v_account.points using errcode = 'P0001';
  end if;

  v_money := app.loyalty_money_for(v_points, (v_config ->> 'redeem_x100')::integer);

  insert into public.plg_loyalty_ledger
        (organization_id, account_id, customer_id, kind, points, money_minor, rate, token, note, created_by)
  values (v_org, v_account.id, v_customer, 'REDEEM', -v_points, v_money,
          (v_config ->> 'redeem_rate')::numeric,
          v_token, nullif(trim(coalesce(p_args ->> 'note', '')), ''), auth.uid());

  update public.plg_loyalty_accounts a
     set points = a.points - v_points,
         last_activity_at = now()
   where a.id = v_account.id;

  return jsonb_build_object(
    'token',       v_token,
    'points',      v_points,
    'money_minor', v_money,
    'points_after', v_account.points - v_points,
    'replayed',    false
  );
end
$fn$;

-- Bind a reservation to the sale it paid for.
--
-- The till tells the plugin the invoice number it just printed. Offline it says
-- `stored: false` and this is not called at all — the settlement happens when
-- the queued sale reaches the server, or the reservation stays visible in the
-- worklist until a shopkeeper decides what happened to it.
create or replace function public.loyalty_settle(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org    uuid := p_organization_id;
  v_token  text := nullif(trim(coalesce(p_args ->> 'token', '')), '');
  v_sale   uuid := nullif(p_args ->> 'sale_id', '')::uuid;
  v_ledger record;
begin
  perform app.require_org(v_org);
  perform app.require_permission('loyalty.redeem');

  if v_token is null or v_sale is null then
    raise exception 'loyalty_settle_invalid: a token and a sale are required' using errcode = '22023';
  end if;

  -- The sale must belong to this shop. A settlement that named another shop's
  -- invoice would be a way to make one shop's discounts look like another's.
  if not exists (
    select 1 from public.sales s
     where s.id = v_sale and s.organization_id = v_org
  ) then
    raise exception 'loyalty_settle_unknown_sale: %', v_sale using errcode = 'P0001';
  end if;

  select l.id, l.sale_id, l.points into v_ledger
    from public.plg_loyalty_ledger l
   where l.organization_id = v_org
     and l.kind = 'REDEEM'
     and l.token = v_token
   for update;

  if not found then
    raise exception 'loyalty_unknown_token: %', v_token using errcode = 'P0001';
  end if;

  -- Settling is idempotent: the same token against the same sale says nothing
  -- new, and against a *different* sale it is refused rather than moved.
  if v_ledger.sale_id is not null and v_ledger.sale_id <> v_sale then
    raise exception 'loyalty_already_settled: token % paid for another sale', v_token
      using errcode = 'P0001';
  end if;

  update public.plg_loyalty_ledger l
     set sale_id = v_sale
   where l.id = v_ledger.id
     and l.sale_id is null;

  return jsonb_build_object('token', v_token, 'sale_id', v_sale, 'points', -v_ledger.points);
end
$fn$;

-- Hand the points back: the money never left the till.
create or replace function public.loyalty_release(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org   uuid := p_organization_id;
  v_token text := nullif(trim(coalesce(p_args ->> 'token', '')), '');
  v_reason text := nullif(trim(coalesce(p_args ->> 'reason', '')), '');
  v_ledger record;
  v_done boolean;
begin
  perform app.require_org(v_org);
  perform app.require_permission('loyalty.redeem');

  if v_token is null then
    raise exception 'loyalty_unknown_token: a token is required' using errcode = '22023';
  end if;

  select l.id, l.account_id, l.customer_id, l.points, l.money_minor, l.sale_id
    into v_ledger
    from public.plg_loyalty_ledger l
   where l.organization_id = v_org
     and l.kind = 'REDEEM'
     and l.token = v_token
   for update;

  if not found then
    raise exception 'loyalty_unknown_token: %', v_token using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.plg_loyalty_ledger x
     where x.organization_id = v_org and x.kind = 'RELEASE' and x.token = v_token
  ) into v_done;

  if v_done then
    return jsonb_build_object('token', v_token, 'released', true, 'replayed', true);
  end if;

  -- A reservation that reached a sale is not a reservation: the shop gave the
  -- money away and the points are spent. Undoing that is a manual adjustment,
  -- with a name against it (`loyalty_adjust`), not a quiet release.
  if v_ledger.sale_id is not null then
    raise exception 'loyalty_already_spent: those points paid for an invoice'
      using errcode = 'P0001';
  end if;

  insert into public.plg_loyalty_ledger
        (organization_id, account_id, customer_id, kind, points, money_minor, token, note, created_by)
  values (v_org, v_ledger.account_id, v_ledger.customer_id, 'RELEASE', -v_ledger.points,
          v_ledger.money_minor, v_token, coalesce(v_reason, 'Not used'), auth.uid());

  update public.plg_loyalty_accounts a
     set points = a.points + (-v_ledger.points),
         last_activity_at = now()
   where a.id = v_ledger.account_id;

  return jsonb_build_object('token', v_token, 'released', true, 'points', -v_ledger.points);
end
$fn$;

-- A shopkeeper's correction, with a reason and a name against it.
--
-- This is the only way points move without a sale behind them, so it is the
-- only one that needs `loyalty.manage` rather than the till's `loyalty.redeem`.
create or replace function public.loyalty_adjust(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid := p_organization_id;
  v_customer uuid := nullif(p_args ->> 'customer_id', '')::uuid;
  v_points   integer := coalesce(nullif(p_args ->> 'points', '')::integer, 0);
  v_note     text := nullif(trim(coalesce(p_args ->> 'note', '')), '');
  v_account  uuid;
  v_balance  integer;
begin
  perform app.require_org(v_org);
  perform app.require_permission('loyalty.manage');

  if v_customer is null or v_points = 0 then
    raise exception 'loyalty_adjust_invalid: a customer and a non-zero number of points are required'
      using errcode = '22023';
  end if;
  if v_note is null then
    raise exception 'loyalty_adjust_reason: every correction needs a reason' using errcode = '22023';
  end if;

  v_account := app.loyalty_account_ensure(v_org, v_customer);

  select a.points into v_balance
    from public.plg_loyalty_accounts a
   where a.id = v_account
   for update;

  if v_balance + v_points < 0 then
    raise exception 'loyalty_below_zero: the account holds % points', v_balance
      using errcode = 'P0001';
  end if;

  insert into public.plg_loyalty_ledger
        (organization_id, account_id, customer_id, kind, points, note, created_by)
  values (v_org, v_account, v_customer, 'ADJUST', v_points, v_note, auth.uid());

  update public.plg_loyalty_accounts a
     set points          = a.points + v_points,
         lifetime_points = a.lifetime_points + greatest(v_points, 0),
         last_activity_at = now()
   where a.id = v_account;

  return jsonb_build_object(
    'customer_id', v_customer,
    'points',      v_balance + v_points,
    'change',      v_points
  );
end
$fn$;

-- ── The two reports and the tile ──────────────────────────────────────────

create or replace function public.loyalty_report(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org  uuid := p_organization_id;
  v_type text := lower(coalesce(nullif(p_args ->> 'type', ''), 'members'));
begin
  perform app.require_org(v_org);
  perform app.require_permission('loyalty.view');

  -- A report a shopkeeper acts on is a report of today's shop.
  perform app.loyalty_sync(v_org);

  if v_type = 'members' then
    return app.loyalty_report_members(v_org, p_args);
  end if;

  if v_type = 'ledger' then
    return app.loyalty_report_ledger(v_org, p_args);
  end if;

  raise exception 'loyalty_unknown_report: %', v_type using errcode = '22023';
end
$fn$;

-- Who is worth looking after: points held, what those points are worth, and
-- what the customer has spent to get them.
create or replace function app.loyalty_report_members(p_org uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_config jsonb := app.loyalty_config(p_org);
  v_tiers  jsonb := v_config -> 'tiers';
  v_search text := nullif(trim(coalesce(p_args ->> 'search', '')), '');
  v_limit  integer := least(greatest(coalesce(nullif(p_args ->> 'limit', '')::integer, 25), 1), 500);
  v_offset integer := greatest(coalesce(nullif(p_args ->> 'offset', '')::integer, 0), 0);
  v_rows   jsonb;
  v_total  integer;
  v_totals jsonb;
begin
  with members as (
    select a.id,
           a.customer_id,
           c.name                as customer,
           c.phone,
           a.points,
           a.lifetime_points,
           app.loyalty_tier(a.lifetime_points, v_tiers) as tier,
           app.loyalty_money_for(a.points, (v_config ->> 'redeem_x100')::integer) as value_minor,
           a.last_activity_at,
           coalesce(spent.value_minor, 0) as spent_minor
      from public.plg_loyalty_accounts a
      join public.customers c on c.id = a.customer_id and c.deleted_at is null
      left join (
        select l.customer_id, sum(round(s.total * 100))::bigint as value_minor
          from public.plg_loyalty_ledger l
          join public.sales s on s.id = l.sale_id
         where l.organization_id = p_org
           and l.kind = 'EARN'
         group by l.customer_id
      ) as spent on spent.customer_id = a.customer_id
     where a.organization_id = p_org
       and (
         v_search is null
         or c.name ilike '%' || v_search || '%'
         or coalesce(c.phone, '') like '%' || v_search || '%'
       )
  ),
  ranked as (
    select *, row_number() over (order by points desc, customer) as rank
      from members
  ),
  page as (
    select * from ranked order by rank limit v_limit offset v_offset
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'customer',        customer,
      'phone',           phone,
      'tier',            tier ->> 'name',
      'points',          points,
      'value_minor',     value_minor,
      'lifetime_points', lifetime_points,
      'spent_minor',     spent_minor,
      'last_activity_at', last_activity_at
    ) order by rank), '[]'::jsonb),
    (select count(*)::integer from members),
    jsonb_build_object(
      'points',     coalesce((select sum(points) from page), 0),
      'value_minor', coalesce((select sum(value_minor) from page), 0),
      'members',    (select count(*)::integer from page)
    )
    into v_rows, v_total, v_totals
    from page;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'totals', v_totals);
end
$fn$;

-- Every point that moved, newest first, with the sale or the reason beside it.
-- This is the report a shopkeeper opens when a customer disagrees with the
-- balance: nothing here is a stored running total, and every row can be
-- defended.
create or replace function app.loyalty_report_ledger(p_org uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_from   timestamptz := nullif(p_args ->> 'from', '')::timestamptz;
  v_to     timestamptz := nullif(p_args ->> 'to', '')::timestamptz;
  v_search text := nullif(trim(coalesce(p_args ->> 'search', '')), '');
  v_limit  integer := least(greatest(coalesce(nullif(p_args ->> 'limit', '')::integer, 25), 1), 500);
  v_offset integer := greatest(coalesce(nullif(p_args ->> 'offset', '')::integer, 0), 0);
  v_rows   jsonb;
  v_total  integer;
  v_totals jsonb;
begin
  with movements as (
    select l.created_at,
           c.name  as customer,
           l.kind,
           l.points,
           l.money_minor,
           coalesce(s.invoice_no, '') as invoice_no,
           coalesce(l.note, '')      as note
      from public.plg_loyalty_ledger l
      join public.customers c on c.id = l.customer_id
      left join public.sales s on s.id = l.sale_id
     where l.organization_id = p_org
       and (v_from is null or l.created_at >= v_from)
       and (v_to   is null or l.created_at <  v_to)
       and (
         v_search is null
         or c.name ilike '%' || v_search || '%'
         or coalesce(s.invoice_no, '') ilike '%' || v_search || '%'
       )
  ),
  page as (
    select * from movements order by created_at desc limit v_limit offset v_offset
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'date',       created_at,
      'customer',   customer,
      'kind',       kind,
      'points',     points,
      'money_minor', coalesce(money_minor, 0),
      'invoice_no', invoice_no,
      'note',       note
    ) order by created_at desc), '[]'::jsonb),
    (select count(*)::integer from movements),
    jsonb_build_object(
      'earned',   coalesce((select sum(points) from page where kind in ('EARN')), 0),
      'spent',    coalesce((select sum(points) from page where kind = 'REDEEM'), 0),
      'given_back', coalesce((select sum(points) from page where kind = 'RELEASE'), 0),
      'reversed', coalesce((select sum(points) from page where kind in ('REVERSAL', 'ADJUST')), 0),
      'net',      coalesce((select sum(points) from page), 0)
    )
    into v_rows, v_total, v_totals
    from page;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'totals', v_totals);
end
$fn$;

-- The dashboard tile: what the shop owes, and what it gave away this month.
--
-- `drift` is the honest part. `points` is a cache of the ledger's sum, written
-- in the same transaction as the row it caches — and this is the number that
-- says so. A shop that ever sees it non-zero has found a bug in this plugin
-- rather than a broken shop, and the ledger is still the truth.
create or replace function public.loyalty_overview(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org    uuid := p_organization_id;
  v_branch uuid := nullif(p_args ->> 'branch_id', '')::uuid;
  v_config jsonb := app.loyalty_config(p_organization_id);
  v_tz     text;
  v_from   date;
  v_to     date;
  v_from_ts timestamptz;
  v_to_ts   timestamptz;
  v_synced jsonb;
  v_month  record;
  v_all    record;
begin
  perform app.require_org(v_org);
  perform app.require_permission('loyalty.view');

  -- The shop's own month, not the server's: a till in Dhaka closing at 23:50 on
  -- the 31st is still in that month, and a tile that says otherwise is a number
  -- a shopkeeper will not believe.
  select coalesce(b.timezone, o.timezone)
    into v_tz
    from public.organizations o
    left join public.branches b on b.id = v_branch and b.organization_id = o.id
   where o.id = v_org;

  if v_tz is null then
    raise exception 'org_not_found: %', v_org using errcode = 'P0002';
  end if;

  v_from := date_trunc('month', (now() at time zone v_tz)::date::timestamp)::date;
  v_to   := (v_from + interval '1 month')::date;
  v_from_ts := v_from::timestamp at time zone v_tz;
  v_to_ts   := v_to::timestamp at time zone v_tz;

  -- Opening the tile catches the shop up, so the numbers on it are the shop's
  -- own sales a beat ago rather than whenever somebody last opened the screen.
  v_synced := app.loyalty_sync(v_org);

  select
    coalesce(sum(l.points), 0)::integer          as points,
    coalesce(sum(l.money_minor), 0)::bigint      as money_minor,
    count(distinct l.customer_id)::integer       as customers
    into v_month
    from public.plg_loyalty_ledger l
   where l.organization_id = v_org
     and l.created_at >= v_from_ts
     and l.created_at < v_to_ts
     and l.kind in ('EARN', 'REVERSAL');

  select
    coalesce(sum(a.points), 0)::integer                          as points,
    count(*)::integer                                            as members,
    count(*) filter (where a.last_activity_at >= v_from_ts)::integer as active
    into v_all
    from public.plg_loyalty_accounts a
   where a.organization_id = v_org;

  return jsonb_build_object(
    'members',        v_all.members,
    'active_month',   v_all.active,
    'points_out',     v_all.points,
    'value_minor',    app.loyalty_money_for(v_all.points, (v_config ->> 'redeem_x100')::integer),
    'earned_month',   v_month.points,
    'month_label',    to_char(v_from, 'Mon YYYY'),
    'redeem_rate',    (v_config ->> 'redeem_rate')::numeric,
    'min_redeem_points', (v_config ->> 'min_redeem_points')::integer,
    -- A reservation that was handed back is not waiting for anything: the
    -- shopkeeper's worklist is what is *still* outstanding, and a list that
    -- kept items they had already cleared would train them to ignore it.
    'open_reservations',
      (select count(*)::integer from public.plg_loyalty_ledger l
        where l.organization_id = v_org
          and l.kind = 'REDEEM'
          and l.sale_id is null
          and not exists (
            select 1 from public.plg_loyalty_ledger x
             where x.organization_id = v_org
               and x.kind = 'RELEASE'
               and x.token = l.token
          )),
    'drift',
      (select count(*)::integer
         from public.plg_loyalty_accounts a
        where a.organization_id = v_org
          and a.points <> coalesce(
            (select sum(l.points) from public.plg_loyalty_ledger l
              where l.account_id = a.id), 0)),
    'synced',         v_synced
  );
end
$fn$;
