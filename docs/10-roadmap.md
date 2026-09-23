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

## Phase 3 — Inventory

```
  □ Migration 006: movements, balances, transfers
  □ Stock ledger with before/after + immutability trigger
  □ Weighted-average costing in RPCs                        doc 09 #5
  □ Stock In: scan → qty → cost → supplier → save           §13
  □ Stock Out: scan → qty → reason → save                   §13
  □ Adjustments with reason codes
  □ Transfers between warehouses                            §28
  □ Stock history per product ("why 37 units?")             §12
  □ Stock overview: on hand, reserved, value, low stock
  □ Low-stock and out-of-stock lists + reorder points
  □ Realtime: low-stock badge
```

**Acceptance:**
- Every balance change has a ledger row whose `before + delta = after`; a
  property test asserts this over randomized operation sequences.
- The stock history screen explains any balance end to end.
- `UPDATE`/`DELETE` on `stock_movements` raises.
- Stock value on the dashboard matches `Σ(balance × avg_cost)` exactly.

---

## Phase 4 — Business management

```
  □ Migration 010: purchases
  □ Purchase orders → receive (full/partial) → supplier balance
  □ RPC: receive_purchase, apply_payment
  □ Suppliers: list, create, purchase history, balance      §20
  □ Expenses: categories (custom), attachments, register effect  §24
  □ RPC: record_expense
  □ Returns: full, partial, item-level, quantity-level      §18
  □ RPC: refund_sale (restocks, reverses ledger)
  □ Refund to original method / store credit
  □ Register session reporting
  □ Audit log viewer                                        §31
```

**Acceptance:**
- A partial receipt leaves a PO in `PARTIALLY_RECEIVED` with correct
  outstanding quantities.
- A refund restocks exactly the refunded quantity and writes a `RETURN_IN`
  ledger row referencing the original sale item.
- Refunding more than was sold is rejected by the database, not the UI.
- Every audited action shows actor, before and after.

---

## Phase 5 — Analytics

```
  □ Migration 016: reporting views + dashboard_summary
  □ Dashboard: 8 default widgets, single aggregate call     §21, doc 09 #10
  □ Charts: sales today/week/month, profit trend, top
    products, top categories, payment mix, stock value
  □ Analytics framework: dimensions × measures × filters    §22
  □ Report framework: filter, search, sort, paginate        §23
  □ Export: CSV, print, PDF
  □ Reports: sales, profit, inventory, product performance,
    customer, supplier, expense, payment, cashier
  □ BI questions from §56 answerable from the dashboard
```

**Acceptance:**
- Dashboard loads in one round trip — verified in the network tab.
- Every question in §56 has a visible answer without leaving the dashboard
  or analytics screens.
- A report exported to CSV re-imports to identical row counts.

---

## Phase 6 — Plugin system hardening

The registry exists from Phase 1; this phase makes it production-grade.

```
  □ plugins, plugin_migrations tables
  □ Edge Function: plugin-enable (migrations + permissions)
  □ Settings → Plugins: list, enable, disable, configure, error states
  □ Settings schema rendering from manifests                §36
  □ Plugin permissions namespacing enforcement              doc 07 §3
  □ Wildcard impact preview before enabling                 doc 07 §4
  □ Product field extensions end to end (basic/advanced promotion)
  □ Custom form sections, POS panels, sale tabs
  □ Plugin dashboard widgets
  □ Plugin lifecycle tests: enable → disable → enable (no leaks)
  □ Plugin SDK documentation + an example plugin repo README
```

**Acceptance:**
- The example plugin (Loyalty, minimal) is installed, enabled, used and
  disabled with no core file changes.
- Disabling a plugin mid-session leaves the POS functional.
- A plugin whose `activate` throws is quarantined and reported; the app runs.
- A plugin declaring `coreApiVersion: '^99.0.0'` is refused with a readable
  message.
- **The §51 test:** a reviewer cannot find any path from `plugins/` into
  `features/` internals — enforced by lint, not by promise.

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
  □ IndexedDbDataSource implementing the repository contracts
  □ Write queue: RPC calls serialised, replayed on reconnect
  □ Conflict policy: server wins for stock, client wins for draft sales
  □ Background sync indicator + manual retry
  □ OpenAPI/typed contract generated for the RPC surface
  □ Android reference: login + POS against the same RPCs
```

**Acceptance:** the POS completes sales with the network disabled, queues
them, and replays without duplicates or negative stock on reconnect.

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

## What I need to start Phase 1

1. **Costing method** — weighted average (recommended) or FIFO?
2. **`shop_categories.json`** — attach it, or confirm I should author the
   taxonomy from the 30 business types in §3.
3. **Restaurant** — in scope for this build, or deferred?
4. **Supabase project** — do you want me to generate migrations for you to
   apply, or will you provision and hand me the URL + anon key?
5. **Product name** — the spec says "Universal POS." The repository is
   currently named `Mekholi`. Which should the UI show?
