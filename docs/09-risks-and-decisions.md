# 09 — Architectural Risks & Decisions

Sixteen problems that would surface in production, and what the design does
about each. Ordered by how expensive they are to fix late.

---

### 1. Plugin data polluting the core schema

**Risk:** Every industry needs extra product fields. The natural move — adding
`expiry_date`, `imei`, `carat`, `isbn`, `frame_size` to `products` — produces
a 60-column table where 90% of cells are null, every query pays for columns
it doesn't use, and each new industry requires a core migration.

**Decision:** Three-tier storage.

| Tier | Use | Cost |
|---|---|---|
| Core columns | Universally needed: name, price, cost, category, reorder point | Always present |
| `products.metadata` jsonb | Sparse plugin fields, not queried in hot paths | Free, unindexed |
| `plg_<id>_<table>` | Fields that are filtered, sorted, indexed or joined | One join |

The plugin loader decides the tier from the field descriptor's `storage`
property. A plugin author declares `expiry_date` as `table` because the
expiry report filters on it, and `salt_composition` as `metadata` because
nothing queries it.

**If we get this wrong:** retrofitting is a painful data migration across
every organization. Deciding now is cheap.

---

### 2. Non-atomic multi-table writes

**Risk:** Completing a sale touches 7 tables. Client-side inserts can
half-fail: sale recorded, stock not decremented. The shop sells stock it
doesn't have, and the ledger stops explaining itself.

**Decision:** All stock/money writes are `SECURITY DEFINER` Postgres functions
in one transaction with `SELECT … FOR UPDATE` on the balance rows. See
[02](./02-architecture.md) §2.

**Corollary:** concurrent cashiers on the last unit are serialised by the row
lock. One wins, the other gets a clean "insufficient stock" — not a negative
balance discovered at month-end.

---

### 3. RLS policy recursion

**Risk:** A policy on `sales` that joins `user_roles` triggers RLS on
`user_roles`, which joins `roles`, which triggers RLS on `roles`… Postgres
either errors with "infinite recursion detected in policy" or silently
performs very badly.

The previous codebase in this repository shipped a `supabase/fix_rls_recursion.sql`
— this exact bug was hit before.

**Decision:**

- `user_organizations` is a flat junction table with a trivially permissive
  self-read policy (`user_id = auth.uid()`). No further joins.
- `app.current_org_ids()` and `app.has_permission()` are `SECURITY DEFINER`
  with `SET search_path = public`, so they read the underlying tables
  **without re-entering RLS**.
- Policies call those functions and nothing else.

**The rule to hold:** no RLS policy may reference a table that itself has a
policy referencing another table. Helpers break the chain.

---

### 4. Profit reports that change retroactively

**Risk:** Profit is `revenue − cost`. If cost is looked up live from
`products.cost_price`, then editing a cost price in October rewrites July's
profit reports. The owner's historical numbers are not stable. This is a
trust-destroying bug that is invisible in testing.

**Decision:** `sale_items.unit_cost` and `line_cogs` are snapshotted at sale
time inside `complete_sale`. `sales.profit` is a `GENERATED` column over
stored values. Historical reports are immutable.

**Same principle** applies to `product_name`, `sku` and `tax_rate` on
`sale_items` — a product rename must not alter an old invoice.

---

### 5. Costing method ambiguity

**Risk:** "What did this cost?" has three legitimate answers (FIFO, LIFO,
weighted average). If the system doesn't pick one explicitly, reports become
indefensible and an accountant will reject them.

**Decision (confirmed 2026-09-23):** Weighted average, stored as
`stock_balances.avg_unit_cost`, updated on every stock-in:

```
new_avg = (old_qty × old_avg + in_qty × in_cost) / (old_qty + in_qty)
```

FIFO ships as a plugin adding `stock_cost_layers`, overriding the costing
function without changing the ledger. Closed — no revaluation migration
needed, because the decision was made before any stock data existed.

---

### 6. Variant / batch / serial confusion

**Risk:** These are three different things and naive systems conflate them.
A variant is a *type* (Red/M) with a quantity. A batch is a *lot* with a
quantity and expiry. A serial is a *single physical unit*. Storing a phone's
IMEI as a "variant" works until someone sells two of the same model.

**Decision:** Three separate structures, all optional, all feeding one ledger.

| Structure | Grain | Stock |
|---|---|---|
| `product_variants` | per type | `stock_balances` quantity |
| `plg_batch_stock_batches` | per lot | quantity per batch, sums to balance |
| `plg_serial_product_serials` | per unit | one row per unit, `status` = in_stock / sold / returned |

Reconciliation is enforced: batch quantities must sum to the variant balance;
serials in `in_stock` must equal the variant balance. A trigger checks this,
so drift is caught at write time rather than at stocktake.

**The default-variant rule** ([04](./04-database-design.md) §2) means
non-variant products traverse identical code.

---

### 7. Event chain reliability

**Risk:** `sale.completed → loyalty → accounting → analytics → notification`
run in JavaScript means: tab closed → points lost; Android sale → chain never
runs; one plugin throws → the rest are skipped.

**Decision:** Two layers ([02](./02-architecture.md) §3).

- Authoritative reactions are Postgres triggers on a **transactional outbox**
  written inside the sale's transaction. The event exists iff the sale exists.
- The JS bus is presentational only: toasts, widget refresh, cache
  invalidation.
- Handlers are **idempotent** and receive `event.id`; redelivery after a
  Realtime reconnect must be a no-op.
- A failing handler is logged and skipped; it cannot block siblings.

---

### 8. Plugin version skew

**Risk:** A plugin compiled against core v1 runs on core v2 and fails at
runtime with an opaque `undefined is not a function`.

**Decision:** `coreApiVersion` semver range on every manifest, checked during
resolution. Incompatible plugins are **skipped and reported in the UI**, never
loaded. The `plugins` table records the installed version per organization so
different shops can run different plugin versions.

The stability contract is narrow and explicit: `PluginContext` in
`core/plugins/sdk.ts`. Adding a method is minor; changing a signature is
major.

---

### 9. Search latency at the till

**Risk:** POS search is the highest-frequency interaction in the system. If it
takes 400 ms, the cashier's rhythm breaks and the system feels broken
regardless of features.

**Decision:**

- `pg_trgm` GIN index on a trigger-maintained `search_text`
  (name + sku + brand + variant barcodes + SKUs).
- Resolution order: exact barcode → exact SKU → trigram similarity. Stop at
  first hit.
- 150 ms debounce, but **instant** on Enter — a scanner sends a full code
  plus newline, so the scanner path never waits for a debounce.
- Result cache keyed by query, invalidated on `product.*` events.
- Keyboard-only operation: the cashier never touches the mouse.

Trigram handles "sam a15" → "Samsung Galaxy A15". Do not add Elasticsearch or
a vector search until a shop exceeds ~50k products.

---

### 10. Dashboard N+1 queries

**Risk:** Eight widgets = eight queries, each scanning `sales`. Dashboard
load time grows linearly with data volume and the first thing an owner sees
every morning is slow.

**Decision:** One `dashboard_summary(branch_id, day)` function returning all
aggregates as a single jsonb payload. Charts read from the same response.
Materialised views behind it if a shop's volume demands it.

Same function serves the Android dashboard — one implementation of "today's
numbers," not two that drift.

---

### 11. Held sales as a second source of truth

**Risk:** Storing held carts in `localStorage` or a separate table means they
vanish on device change, don't appear in reports, and need a second code path.

**Decision:** A held sale is `sales.status = 'HELD'`. Same table, same
queries, survives logout, visible from any register in the branch, and the
"held count" sidebar badge is a plain count query.

---

### 12. Register session concurrency

**Risk:** Two cashiers open the same drawer. Expected cash becomes
meaningless and the variance report is useless.

**Decision:** Partial unique index —
`CREATE UNIQUE INDEX one_open_session_per_register ON register_sessions(register_id) WHERE closed_at IS NULL`.
The database rejects the second open with a clear error. No application-level
check needed, no race window.

---

### 13. Demo mode leaking into production

**Risk:** A runtime `if (isDemo)` scattered through services means demo
shortcuts ship to production and someone finds them.

**Decision:** Demo is a `DataSource` implementation selected at bootstrap from
a **build-time** flag (`VITE_ENABLE_DEMO`). Vite tree-shakes `DemoDataSource`
out of production bundles entirely, so the code is not merely unreachable —
it is absent. No business code may reference demo state.

---

### 14. Timezone bugs in "today's sales"

**Risk:** Storing `timestamp` (no zone) or filtering by server-local date
makes "today" wrong for any shop not in the server's zone — and wrong twice a
year for shops in DST-observing regions. Bangladesh does not observe DST, but
the platform must not assume every customer is in Dhaka.

**Decision:** `timestamptz` everywhere. Day boundaries computed with the
branch timezone:

```sql
WHERE created_at >= date_trunc('day', p_day::timestamptz AT TIME ZONE b.timezone)
                  AT TIME ZONE b.timezone
```

`organizations.timezone` and per-branch override. The frontend renders in the
same zone. This is decided once, in one helper, and never re-derived.

---

### 15. Frontend bundle bloat from plugins

**Risk:** Importing every plugin statically means a corner shop downloads
pharmacy, repair and auto-parts code they will never run.

**Decision:**

- Manifests are eagerly imported (tiny, pure data).
- `index.ts`, pages, components and widgets are **dynamic imports** — separate
  chunks loaded only when the plugin is enabled and the route is visited.
- Route-level code splitting for every core feature too.
- Target: core bundle < 250 KB gzipped.

---

### 16. Tax hardcoding

**Risk:** The previous codebase in this repository hardcoded Mushak 6.3. That
is correct for Bangladesh and wrong everywhere else — and §15 explicitly
forbids it. A tax assumption baked into core blocks every non-BD market.

**Decision:** `taxes` is a per-organization table of rules (rate, inclusive
flag, applicability). `shared/domain/tax.ts` is a pure rule engine. Mushak,
GST, VAT and US sales tax are all *seed data*, and a shop with no tax simply
has no rows.

Invoice templates follow the same rule: the Mushak 6.3 format is a
*template*, selected per organization, not a code path.

---

## Summary table

| # | Risk | Cost if deferred | Mitigation cost now |
|---|---|---|---|
| 1 | Plugin data in core schema | Very high | Low |
| 2 | Non-atomic writes | Very high | Low |
| 3 | RLS recursion | High | Low |
| 4 | Retroactive profit | High | Low |
| 5 | Costing method | High | Closed — weighted average |
| 6 | Variant/batch/serial | High | Medium |
| 7 | Event reliability | High | Medium |
| 8 | Version skew | Medium | Low |
| 9 | Search latency | Medium | Low |
| 10 | Dashboard N+1 | Medium | Low |
| 11 | Held sales split | Medium | Low |
| 12 | Register concurrency | Medium | Low |
| 13 | Demo leakage | Medium | Low |
| 14 | Timezones | Medium | Low |
| 15 | Bundle bloat | Low | Low |
| 16 | Tax hardcoding | Medium | Low |

Every one of these is cheap to get right during design and expensive to fix
after data exists. That is why this document precedes implementation.
