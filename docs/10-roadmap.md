# 10 — Implementation Roadmap

Phased per §50, with a Phase 0 added for decisions that are expensive to
reverse, and acceptance criteria per phase so "done" is testable rather than
a matter of opinion.

---

## Phase 0 — Decisions & skeleton *(before any feature code)*

**Blocked on:** your answers to the open items in [README](./README.md).

```
□ Confirm costing method (weighted average vs FIFO)     ← doc 09 #5
□ Supply shop_categories.json                           ← doc 08
□ Confirm restaurant priority                           ← doc 08 §6
□ Confirm demo data approach                            ← doc 09 #13
□ Provision Supabase project, capture URL + anon key
□ Repo scaffold: Vite + TS strict + Tailwind + ESLint boundaries
□ supabase-cli wired, first empty migration applies cleanly
□ CI: typecheck + lint + unit tests
```

**Acceptance:** `npm run dev` serves an empty shell; `supabase db reset`
applies migrations with no errors; CI green.

---

## Phase 1 — Foundation

Your §50 Phase 1, expanded.

```
Core platform
  □ Design tokens (semantic palette, light + dark)         §38
  □ Component kit: Button, Input, Select, Modal, Toast,
    DataTable, EmptyState, Skeleton, ConfirmDialog, Icon   §39
  □ Hash router with lazy routes
  □ App shell, auth shell, POS shell layouts
  □ i18n (bn ⇄ en)
  □ EventBus + event catalogue
  □ PermissionRegistry + has()
  □ NavigationRegistry + dynamic sidebar
  □ CommandRegistry + Ctrl+K palette                       §40
  □ KeyboardRegistry + configurable shortcuts              §41
  □ Settings store (namespaced, typed)
  □ Plugin registry: manifests, resolution, activate/deactivate
  □ PluginContext + definePlugin SDK                       §52

Supabase
  □ Migrations 001–004: extensions, tenancy, RBAC, app helpers
  □ RLS on all Phase 1 tables
  □ Auth: login, logout, session restore, branch switcher
  □ Edge Function: set active branch (JWT claim)

Data
  □ Repository contracts + SupabaseDataSource
  □ Session store (org, branch, user, permissions, settings)

Setup
  □ Setup wizard steps 1–6                                §34
```

**Acceptance:**
- A new user signs up, creates an organization, picks a shop type, and lands
  on an empty dashboard.
- The sidebar renders from the registry, not from markup — verified by
  enabling a stub plugin that adds a nav node and watching it appear.
- Ctrl+K opens and executes a command registered by that stub.
- Every component in the kit has a usage example page.
- `shared/domain/` has zero imports from outside itself (lint-enforced).

**Deliberately excluded:** any product, sale or stock functionality. Phase 1
is the platform; mixing features in is how the plugin boundary gets eroded
before it is ever tested.

---

## Phase 2 — Core POS

```
Catalogue
  □ Migrations 005, 007, 008: products/variants, parties, money
  □ Product list with search, filters, keyset pagination    §45
  □ Product form: basic section + "+ Advanced Options"      §8
  □ Quick Add (name, price, stock)                          §9 method 1
  □ Duplicate product                                       §9 method 3
  □ CSV import/export                                       §9 method 4
  □ Categories (tree CRUD), brands, units
  □ Product field extension registry + form rendering

Selling
  □ Migration 009: sales, items, payments, returns
  □ RPC: complete_sale, hold_sale, resume_sale
  □ POS screen: search, cart, totals, payment               §14
  □ Payment methods (configurable per org)                  §15
  □ Split payment, change due
  □ Hold / resume with sidebar badge                        §17
  □ Recent sales, sale detail
  □ Receipt data model + 80mm template                      §54
  □ Customers: list, create (name + phone), history         §19
  □ Register: open, close, cash in/out, variance            §25

Setup
  □ Setup wizard step 7: first product
```

**Acceptance:**
- A product is created in ≤ 5 fields; the advanced section stays collapsed.
- A cashier completes a sale with keyboard only, in under 10 keystrokes for a
  single-item cash sale.
- Holding a sale, serving another customer and resuming works across a
  logout/login.
- `complete_sale` cannot produce a negative balance — proven by a concurrent
  integration test firing two sales for the last unit.
- Killing the browser mid-`complete_sale` leaves either a complete sale or no
  sale, never a partial.

---

## Phase 3 — Inventory — ✅ complete 2026-09-25

```
  ✅ Migration 006: movements, balances, transfers        (already existed)
  ✅ Stock ledger with before/after + immutability trigger
  ✅ Weighted-average costing in RPCs                      doc 09 #5
  ✅ Migration 024: stock_in / stock_out / transfer_stock / stock_summary
  ✅ Stock In: scan → qty → cost → supplier → save         §13
  ✅ Stock Out: scan → qty → reason → save                 §13
  ✅ Adjustments with reason codes
  ✅ Transfers between warehouses                          §28
  ✅ Stock history per product ("why 37 units?")           §12
  ✅ Stock overview: on hand, reserved, value, low stock
  ✅ Low-stock and out-of-stock lists + reorder points
  ✅ Realtime: low-stock badge
```

Migration 024 filled the gap between 006 (the ledger) and 013 (the costing
primitive): three operations had no reachable path at all. `stock_in` carries a
unit cost — `adjust_stock` passes zero, so receiving through it would have
blended the weighted average toward zero, silently corrupting the stock
valuation. `stock_out` needs `inventory.stock_out`, not `inventory.adjust`, so
being allowed to write off damage no longer implies being allowed to post
arbitrary corrections. `transfer_stock` gives the transfer tables their first
writer.

**Acceptance — all verified by `npm run validate:migrations` (81 checks) and
the browser audit (72 checks):**

- Every balance change has a ledger row with `before + delta = after` — proven
  by a randomized property test (60 operations, deterministic seed, ~32 applied
  and ~28 refused) over which the invariant is asserted for *every* row.
  Balances are additionally checked to equal the sum of their movements, and no
  operation may drive a balance negative.
- The stock history screen explains any balance end to end: each row states
  `before → after` and the signed delta, with the reason in words.
- `UPDATE`/`DELETE` on `stock_movements` raises.
- Stock value on the dashboard equals Σ(balance × avg_cost) exactly — asserted
  in Postgres (dashboard_summary vs the direct sum) *and* end to end, by
  receiving stock over HTTP as the owner and comparing both screens' rendered
  figures with SQL.

**Deliberately deferred:** a guided stock-count workflow (walk the shelves,
enter counted quantities, post the variances as `COUNT` movements). The
`adjust` path covers correcting one product; a full count session is its own
screen and belongs with the Purchases/receiving work in Phase 4.

---

## Phase 4 — Business management — ✅ complete 2026-09-25

```
  ✅ Migration 010: purchases                               (already existed)
  ✅ Purchase orders → receive (full/partial) → supplier balance
  ✅ RPC: receive_purchase (013) · save_purchase, apply_payment (025)
  ✅ Suppliers: list, create, purchase history, balance      §20
  ✅ Expenses: categories (custom), register effect          §24
  ✅ RPC: record_expense (fixed in 027 — it had never run)
  ✅ Returns: full, partial, item-level, quantity-level      §18
  ✅ RPC: refund_sale (013) — restocks, writes the ledger row
  ✅ Refund to original method / store credit (refund_sale_to_credit, 025)
  ✅ Register session reporting (register_session_report, 025)
  ✅ Audit log viewer with actor, before and after           §31
  ✅ Sales, customers and register screens — the Phase 2 residue
```

Migration 025 supplied what was missing: creating a purchase order, paying a
supplier, refunding to store credit, reporting a register session, and —
closing a gap open since 011 — a writer for `audit_logs`, which until then was
filled only by provisioning. `app.record_audit()` is attached to eighteen
tables by a loop, so "who changed this price?" now has an answer that no code
path can forget to write.

**Acceptance — verified by `npm run validate:migrations` (112 checks), the
browser audit (138 checks at 390px) and the live project:**

- A partial receipt leaves a PO in `PARTIALLY_RECEIVED` with the right
  outstanding quantity — `PO-2026-000001`, 8 of 20 received, 12 outstanding,
  asserted in Postgres, over PostgREST as the signed-in owner, and on the
  screen. Over-receipt is refused; a received order is no longer editable.
- A refund restocks exactly the refunded quantity and writes a `RETURN_IN`
  ledger row citing the return it came from (`reference_type = 'return'`),
  verified against a live sale: 16 → 17 units and one ledger row.
- Refunding more than was sold is rejected by the database, not the UI:
  `over_refund` is raised by `refund_sale`, and `over_payment` by
  `apply_payment` (`over_receipt` likewise).
- Every audited action shows actor, before and after — a price change reads
  `300 → 275` attributed to the owner, and the entry dialog shows Actor,
  Before and After side by side.

**Three faults the deployed app found that reading the code did not:**

1. `record_expense` (014) referenced an undeclared `v_session_id`. PL/pgSQL
   resolves names at execution, so it compiled, was granted, shipped, and
   failed every call with SQLSTATE 42703 — which is *all* of §24. Fixed in
   027; the validator now executes the RPC, and a static scan asserts that
   every live function reads only the `v_*` names it declares.
2. `audit_trail` (025) joined `auth.users` under `security_invoker = on`, so
   the *caller* needed SELECT on `auth.users` — which `authenticated` must
   never have. A signed-in owner was told "You do not have permission to do
   that." Fixed in 026 with a `SECURITY DEFINER` helper, plus explicit grants
   and a privilege check in the validator (it had been testing as the owner,
   so privileges never bound).
3. The audit trigger fought a shop's teardown: cascading deletes fired it
   after the organization row was gone, aborting the delete with a foreign-key
   violation. Fixed in 027 — the trail cannot outlive the shop.

**Also fixed from the browser audit:** the modal close button measured 26×40
at phone width (a flex row compressed a 32px box), and the "Load more" and
row-level delete controls were under the 40px tap floor.

**And CI had been red since Phase 2** — for a reason worth writing down: the
login and POS-gate tests gate on `env.isSupabaseConfigured`, which is true on a
developer machine only because a gitignored `.env` exists. On a fresh checkout
it is false, so three tests failed with "expected null not to be null" on every
run, and a permanently red pipeline stops being read as a signal. Reproduced by
moving `.env` aside, fixed in `vitest.config.ts` with placeholder values, and
`npm run check` now passes with no `.env` at all — which is what CI does. The
first green CI run in the project's history is `0316cb1`.

---

## Phase 5 — Analytics — ✅ complete 2026-09-25

```
  ✅ Migration 016: reporting views + dashboard_summary
  ✅ Dashboard: 8 default widgets, single aggregate call     §21, doc 09 #10
  ✅ Charts: sales today/week/month, profit trend, top
     products, top categories, payment mix, stock value
  ✅ Analytics framework: dimensions × measures × filters    §22
  ✅ Report framework: filter, search, sort, paginate        §23
  ✅ Export: CSV, print, PDF
  ✅ Reports: sales, profit, inventory, product performance,
     customer, supplier, expense, payment, cashier, plus
     reorder list and stock movements
  ✅ BI questions from §56 answerable from the dashboard
```

**One engine, not eight screens of SQL.** 028 is the phase's core: a
`measure × dimension` matrix over a handful of families (sales, refunds,
expenses, purchases), compiled to SQL by `app.analytics_sql` and run by
`app.analytics_run`, which returns one period's series *and* the previous
period's point-for-point comparison. The dashboard (`public.dashboard_summary`)
keeps its single call and its eight widgets — 016's body now lives in
`app.dashboard_widgets` — and the same call also carries thirty days of takings
and profit, twelve months, the top products and categories, and the answers.
The Android client that arrives in Phase 8 calls these same functions; nothing
in the analytics layer is written twice.

Every slice reconciles: Σ by category = Σ by hour = Σ by day = Σ of
`sales.total`, and an order-level discount is spread across its lines in
proportion to line totals so item reports still sum to the bill (≤ 1 paisa per
sale). Money crosses the wire as minor units, always.

**The screens.** `/analytics` is the framework's face — the pickers are built
from `analytics_catalog()`, so an unsupported combination is never offered.
`/reports` runs one of eleven reports server-side: server-side sort (with a
whitelist, so a hostile sort key falls back rather than reaching SQL), search,
paging, totals for the whole filtered set, and CSV / print / PDF export from
the same rows the screen shows.

**§56 — the questions.** The specification's §56 list is not in this repo; the
questions are derived from the phase's own scope ("BI questions answerable from
the dashboard") and answered by `app.bi_answers_internal` in one payload. Each
answer carries a value, a plain-language note, and a link to the screen where
it can be acted on:

| Question | Answer key | Detail |
|---|---|---|
| How much did we take today? | `takings_today` | `/sales` |
| Are we in profit today? | `profit_today` | `/reports?report=profit` |
| What are the best sellers this month? | `top_products` | `/reports?report=product_performance` |
| What sells by category this month? | `category_mix` | `/analytics?dimension=category&measure=takings` |
| How are customers paying today? | `payment_mix` | `/analytics?dimension=payment_method&measure=takings` |
| How much cash is in the drawer? | `cash_in_drawer` | `/register` |
| Who owes us money? | `receivable` | `/customers` |
| What do we owe suppliers? | `payable` | `/suppliers` |
| What needs reordering? | `reorder` | `/reports?report=low_stock` |
| What did we spend today? | `spend_today` | `/expenses` |
| When is the shop busiest? | `peak_hour` | `/analytics?dimension=hour&measure=takings&period=day` |
| How much did we discount this month? | `discount_month` | `/reports?report=sales` |
| What did we refund today? | `refunds_today` | `/sales` |
| Anything parked? | `held_sales` | `/sales?status=HELD` |

**Acceptance — all three criteria verified in a real browser at phone size
(`tools/mobile-audit.mjs`, 164 checks, 0 failures):**

- The dashboard loads in **one round trip**: the audit records every request
  the page makes while the dashboard renders and asserts exactly one
  `dashboard_summary` call with no per-widget follow-ups.
- Every §56 question is **visible without leaving the dashboard**: fourteen
  answer cards render with their values, notes and links, drawn from the same
  payload.
- A report exported to **CSV re-imports to identical row counts**: the audit
  clicks CSV for real, waits for the download, parses the file with the same
  quote-aware counter the app uses, and compares the data rows with the count
  the report itself reported — plus the columns match the screen, in order.

**Three bugs only a real phone found** (all fixed in this phase, all now
guarded by checks):

1. `default current_date` never runs when a caller passes `NULL`, and the
   screens pass NULL on purpose (the browser cannot know the branch's
   timezone). Every day-scoped statement inside the dashboard compared against
   NULL, and the peak-hour answer divided by zero: the dashboard did not load
   at all. 030 resolves the day once, in `app.effective_day`.
2. A blank custom date was sent as `''`, which PostgREST rejects before the
   function runs — the reports screen showed nothing. The views now omit blank
   dates and the repository normalises at the boundary.
3. Both new screens rendered their skeleton *after* the data arrived — the
   loading flag was cleared in `finally`, too late for the render — so a
   finished report stayed a skeleton. Reported, not silently wrong: the audit
   failed on an empty table, which is exactly what it is for.

Also caught by the audit: the period chips and paging controls were under the
40px tap floor, and the exported-toast's close button was 20×30. All raised to
40px.

---

## Phase 6 — Plugin system hardening — ✅ complete 2026-09-25

The registry exists from Phase 1; this phase makes it production-grade.

```
  ✅ plugins, plugin_packages, plugin_migrations, plugin_data tables
  ✅ plugin_enable in the database, SECURITY DEFINER — not an Edge Function
     (031's header argues the change; §8's shape, §7's guarantees)
  ✅ Settings → Plugins: list, enable, disable, configure, error states
  ✅ Settings schema rendered from manifests                 §36
  ✅ Plugin permissions namespacing enforcement               doc 07 §3
  ✅ Wildcard impact preview before enabling                  doc 07 §4
  ✅ Product field extensions end to end: showInPOS, printable, importable
  ✅ Custom form sections, POS panels, sale tabs
  ✅ Plugin dashboard widgets
  ✅ Plugin lifecycle tests: enable → disable → enable (no leaks)
  ✅ Plugin SDK documentation (docs/11) + example plugin README
```

**The database is the boundary.** `plugin_enable` takes the plugin key and the
version the *client* is about to load, and refuses a mismatch — a bundle older
or newer than the SQL on this server never half-deploys. It applies the
package's migrations in ordinal order, transactionally: a plugin that fails
mid-install leaves nothing behind, which is asserted rather than assumed. Every
table the package created must be named `plg_<id>_*`, carry `organization_id`,
have RLS on and have at least one policy — checked against a before/after diff
of the catalogue, so the rule does not depend on the plugin choosing a name the
guard expected. An applied migration's checksum is compared on every later
enable, so a changed file is a `plugin_migration_changed` error rather than a
silent skip. Permissions are upserted into the catalogue namespaced to the
plugin; disabling keeps them, keeps the tables, and keeps the data.

**Nothing is hard-coded per plugin on the client either.** `SHIPPED_PLUGINS` in
`src/app/plugins.ts` is the only core file a new plugin touches; the Plugins
screen is built from `plugin_catalog()` and each manifest's `settingsSchema`;
the dashboard widgets, POS panels, sale tabs and product-form sections are drawn
by `src/app/plugin-slots.ts` from whatever is registered. Each slot checks its
permission, badges the plugin that contributed it, and turns a throwing plugin
into one readable line instead of a broken screen.

**Three bugs this phase found by asking for proof, not by reading code:** the
schema guard only inspected tables whose names it already expected (038); a
second copy of `plugin_enable` had been created in the private `app` schema
while the public one kept the old guard (040); and the client loaded plugins
through the admin-only `plugin_catalog` call, so a cashier could not load their
shop's plugins at all — found by searching the deployed bundle for the RPC it
should have been calling (037, and a rule in the validator so it cannot come
back).

**Acceptance:**
- The example plugin (Loyalty, minimal) is installed, enabled, used and
  disabled with no core file changes. ✅ `src/app/plugins.test.ts` loads the
  shipped pair through the real modules; the Plugins screen adds no per-plugin
  code.
- Disabling a plugin mid-session leaves the POS functional. ✅ Slots re-read the
  registry on `plugin.changed` and each host renders what is registered *now*.
- A plugin whose `activate` throws is quarantined and reported; the app runs.
  ✅ Registry tests, per-slot fallbacks, and the Plugins screen's per-plugin
  error state with one retry.
- A plugin declaring `coreApiVersion: '^99.0.0'` is refused with a readable
  message. ✅ `resolvePlugins` reports `incompatible`; the route placeholder and
  the Plugins screen both say so in words.
- **The §51 test:** a reviewer cannot find any path from `plugins/` into
  `features/` internals — enforced by lint, not by promise. ✅
  `tools/check-boundaries.mjs` resolves every import and runs nine rule cases
  first, including the four that must be refused.

**Evidence:** `npm run check` — typecheck, eslint, boundaries, 254 tests in 21
files, 40 migrations applied with 160/160 behavioural checks in real Postgres,
production build. The 160 include the plugin host end to end: packaged
permissions namespaced, a plugin table tenant-safe by construction,
`plugin_data` unreachable except through its RPCs, functions callable only
inside their own namespace and only while enabled, tampered migrations refused,
dependency disable refused, disable keeping everything, and a cashier loading
the shop's plugins while every admin call is refused. CI and Deploy green on
`1e3b6a9`; the deployed bundle carries the Plugins screen and `plugin_state`.

---

## Phase 7 — Industry plugins

Build the reusable capability plugins first, then the industry bundles that
compose them. Order chosen by reuse: each capability unlocks several
industries.

```
Capability plugins (in order)
  1. variants              ← unlocks Fashion, Shoe, Sports, Toy, Furniture
  2. batch-expiry          ← unlocks Grocery, Pharmacy, Bakery, Cosmetics
  3. serial-numbers        ← unlocks Electronics, Mobile, Appliance
  4. warranty              ← unlocks Electronics, Mobile, Appliance, Bicycle
  5. weight-scale          ← unlocks Grocery, Butcher, Bakery, Hardware
  6. loyalty               ← broad value, low risk
  7. wholesale             ← price lists, customer groups
  8. promotions            ← rules engine
  9. stocktake             ← cycle counting
 10. production            ← BOM; unlocks Bakery, Butcher, Furniture, Flower
 11. label-printing
 12. gift-cards
 13. accounting
 14. notifications

Industry bundles (each ≈ a profile row + fields + navigation)
  Shape A (days):   Bookstore, Toy/Game, Cosmetics, Sports, Luggage, Hardware
  Shape B (1–2 wk): Pharmacy, Mobile, Jewelry, Electronics, Pet
  Shape C (2–4 wk): Repair, Auto Parts (fitment), Bicycle (workshop)
  Deferred:         Restaurant — see doc 08 §6
```

**Acceptance per industry plugin:**
- A shop of that type can be created from the wizard with sensible defaults.
- The product form shows the right fields with the right ones promoted.
- At least one industry-specific report works.
- **No file under `src/features/` was modified.** This is the acceptance test
  for the entire architecture. If it fails, the plugin system has a hole —
  fix the hole, don't merge the plugin.

---

## Phase 8 — Offline & Android readiness

Not in your §50, but §42 and §43 imply it.

```
  ✅ IndexedDbDataSource implementing the repository contracts
     `src/shared/repositories/offline/` — catalog cache, outbox, drafts,
     IndexedDB store with a memory fallback. Wired in `src/app/offline.ts`;
     features still see only the contracts.
  ✅ Write queue: RPC calls serialised, replayed on reconnect
     `WriteQueue` + `SyncEngine`. Server half is migration 044: a client
     reference makes a resend return the sale it already wrote.
  ✅ Conflict policy: server wins for stock, client wins for draft sales
     Written down in doc 12 §3 rather than discovered.
  ✅ Background sync indicator + manual retry
     `features/layout/sync-indicator.ts`, with the queue panel behind it.
  ✅ OpenAPI/typed contract generated for the RPC surface
     `contracts/api-contract.json`, generated from the live database by
     `npm run contract:pull` — every RPC with its parameters and which of them
     may be omitted, every relation the clients read with its columns. Drift
     fails `npm run contract:check`; a client that names a parameter the
     contract does not have fails `npm run check:clients`; a migration that
     changes a signature fails the migration validator. Two clients are written
     against it, so it is checked by a machine rather than by reading.
  ✅ Android reference: login + POS against the same RPCs
     `android/core` is Kotlin/JVM — transport, wire shapes, the catalogue read,
     the sale RPC, the outbox, the sync engine — and it is *executed*: 
     `npm run test:android` runs its tests in a second, `npm run e2e:android`
     drives it against the live project as a separate process per command
     (offline queue, restart, refusal, retry). `android/app` is the Compose
     shell around it, source-only because it needs the Android SDK.
```

**Acceptance:** the POS completes sales with the network disabled, queues
them, and replays without duplicates or negative stock on reconnect.

Proven by `tools/e2e-http.mjs` §9c against the live project (a replayed sale
returns the stored one; stock moves once; a foreign shop's replay is refused),
by `tools/android-e2e.mjs` for the Android client (a sale queued in one process
is sent by the next one; a refusal keeps it; a retry sends it), and by
`tools/validate-migrations.mjs` against a real Postgres. Design and
guarantees: doc 12.

---

## Sequencing rationale

| Choice | Reason |
|---|---|
| Platform before features | The plugin boundary must be tested before 15 features depend on it. Retrofitting a plugin system is a rewrite. |
| Ledger before POS analytics | Profit and stock reports are meaningless without correct movements. |
| Capability plugins before industry plugins | `variants` alone unlocks five industries. Building Pharmacy first would force one-off solutions that later conflict. |
| Restaurant last | Different domain; see doc 08 §6. |
| Offline last | The repository seam makes it additive. Building it first means designing for a constraint you cannot yet test. |

---

## A note on days and time zones

`app.effective_day` exists because a shop's day is the shop's, not the server's:
a branch in Dhaka is already on tomorrow's date while the UTC clock still says
today (doc 09 §3). Two assertions in `tools/validate-migrations.mjs` compared
against the *server's* `current_date` and had therefore been passing all morning
and failing every evening, unnoticed because CI runs in the same window as the
person who wrote them. They now resolve the branch's day the way the app's own
calls do, and the check that found this is the one that reads the dashboard's
trend.

---

## Effort indication

Rough, assuming one experienced full-stack developer:

| Phase | Estimate |
|---|---|
| 0 — Decisions & skeleton | 2–3 days *(after your answers)* |
| 1 — Foundation | 3–4 weeks |
| 2 — Core POS | 4–5 weeks |
| 3 — Inventory | 2–3 weeks |
| 4 — Business management | 3 weeks |
| 5 — Analytics | 3 weeks |
| 6 — Plugin hardening | 2–3 weeks |
| 7 — Capability plugins (14) | 8–12 weeks |
| 7 — Industry bundles (~20) | 6–10 weeks |
| 8 — Offline & Android | 4–6 weeks |

**A sale can be taken at the end of Phase 2.** Everything after that adds
capability; nothing before it is optional.

---

## Phase 1 prerequisites — answered 2026-09-23

| Question | Answer |
|---|---|
| Costing method | **Weighted average.** `stock_balances.avg_unit_cost`, updated on stock-in. FIFO deferred to a plugin. |
| `shop_categories.json` | **I author it** from the 30 business types in §3, with bn/en names and plugin recommendations. Delivered as seed data, editable without code changes. |
| Restaurant | **Deferred.** Built last as an `order` aggregate wrapping the universal sale. |
| Supabase | **I generate the 16 migration files; the owner applies them.** No credentials leave the owner's machine. |
| Product name | **Mekholi.** Used in UI, setup wizard, receipts and invoice headers. "Universal" remains an architectural adjective only. |

Phase 0 is therefore unblocked. It needs no further input — only approval to
begin implementation.
