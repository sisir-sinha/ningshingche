-- 055 — when a sale line was rung up.
--
-- `sale_items` has been missing a timestamp since 009, and nothing noticed
-- until a screen tried to sort by one: opening any sale from Stock → History
-- answered `42703 column sale_items.created_at does not exist` and showed
-- "Could not open the sale". A refund screen brought down by a sort key.
--
-- The column is worth having for its own sake, not only to make that query
-- legal:
--
--   * **Line order.** A sale's lines have no ordinal. Physical order stands in
--     for one, and physical order is not stable — refunding a line updates
--     `returned_qty`, which rewrites the row at the end of the heap, so the
--     list reshuffles itself while the cashier is using it. Every other table
--     in this schema already sorts by `created_at`; this one could not.
--
--   * **`clock_timestamp()`, not `now()`.** `now()` is the transaction's start
--     time, identical for every line of a sale, which would leave the order
--     exactly as undefined as it is today. `clock_timestamp()` advances within
--     the transaction, so the lines come back in the order `complete_sale`
--     inserted them — the order the cashier scanned them in.
--
--   * **No RPC changes.** The default fills the column on insert, so
--     `complete_sale`, `hold_sale` and every other writer keep working
--     untouched. That matters: there are four insert sites across three
--     migrations, and editing all of them to pass a line number is a much
--     larger change with a much larger blast radius.
--
-- Backfilled from the parent sale rather than from `now()`: a receipt reprinted
-- next year should say when the sale happened, not when this migration ran.

alter table public.sale_items
  add column if not exists created_at timestamptz not null default clock_timestamp();

-- Existing rows all carry the migration's own timestamp from the default, so
-- they are corrected to the sale they belong to. Within one sale they then
-- share a value and fall back to insertion order, which is no worse than
-- today and no better — only new sales get true per-line ordering.
update public.sale_items si
   set created_at = s.created_at
  from public.sales s
 where s.id = si.sale_id
   and si.created_at <> s.created_at;

comment on column public.sale_items.created_at is
  'When this line was written. Defaults to clock_timestamp() so the lines of '
  'one sale keep the order they were rung up in; now() would give them all the '
  'same value.';

-- The lookup this fixes is always "the lines of one sale, in order", so the
-- index carries the sort key rather than leaving Postgres to sort the handful
-- of rows it found by `sale_id`. Cheap, and it makes the plan explicit.
create index if not exists sale_items_sale_created_idx
  on public.sale_items(sale_id, created_at);
