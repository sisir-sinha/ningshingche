# 02 — System Architecture

## 1. Layers

```
┌─────────────────────────────────────────────────────────────┐
│  PRESENTATION                                               │
│  layouts · pages · components (generic UI kit)              │
│  No business rules. No SQL. No fetch.                       │
├─────────────────────────────────────────────────────────────┤
│  APPLICATION SERVICES                                       │
│  SaleService · InventoryService · ProductService · …        │
│  Orchestration, validation, transaction boundaries.         │
│  Framework-free. Unit-testable without a DOM.               │
├─────────────────────────────────────────────────────────────┤
│  DOMAIN  (pure TypeScript, zero I/O)                        │
│  cartReducer · pricingEngine · taxEngine · stockMath        │
│  Deterministic. The Android app's rules mirror this.        │
├─────────────────────────────────────────────────────────────┤
│  REPOSITORIES  (interfaces)                                 │
│  ProductRepository · SaleRepository · StockRepository       │
├─────────────────────────────────────────────────────────────┤
│  DATA SOURCES  (swap-in implementations)                    │
│  SupabaseDataSource   ← v1                                  │
│  IndexedDbDataSource  ← future offline (§42)                │
│  DemoDataSource       ← demo mode (§47)                     │
├─────────────────────────────────────────────────────────────┤
│  SUPABASE                                                   │
│  PostgREST (reads) · RPC (writes) · RLS · Realtime          │
│  Storage · Auth · Edge Functions                            │
└─────────────────────────────────────────────────────────────┘
```

**Dependency rule:** arrows point down only. `domain/` imports nothing from
above it. This is what makes §42 (offline) and §43 (Android) achievable
rather than aspirational — the business logic is already extracted by the
time you need it.

### Why services and domain are separate

`domain/` is pure: `calculateCartTotals(cart, taxRules, discounts) → Totals`.
No async, no Supabase, no state.

`services/` is impure: it loads the tax rules, calls the domain function,
persists the result, emits events.

This split is the single most valuable thing for the Android rewrite. The
domain layer becomes the specification the Kotlin implementation is tested
against.

---

## 2. The write path — Postgres RPC, not client inserts

### The rule

> **Reads** use PostgREST directly (`.select()`, filters, pagination, joins).
> **Writes that touch money or stock** call a Postgres function.

### Example: completing a sale

The naive approach — seven client-side inserts:

```ts
// NEVER DO THIS
await supabase.from('sales').insert(sale)
await supabase.from('sale_items').insert(items)
await supabase.from('stock_movements').insert(movements)
await supabase.from('stock_balances').upsert(balances)
await supabase.from('sale_payments').insert(payments)
await supabase.from('register_sessions').update(cashTotal)
await supabase.from('audit_logs').insert(audit)
```

Any of these can fail after others succeed. A network drop at step 4 leaves a
sale recorded with no stock movement. RLS must be written per-table and can
drift. Android would have to reimplement all seven.

The actual approach — one call:

```ts
const { data, error } = await supabase.rpc('complete_sale', {
  p_branch_id: branchId,
  p_customer_id: customerId ?? null,
  p_register_id: registerId,
  p_items: [
    { product_id, variant_id, qty: 2, unit_price: 450, discount: 0, tax_rate: 0 }
  ],
  p_payments: [{ method_id, amount: 900, reference: null }],
  p_discount: { type: 'PERCENT', value: 5 },
  p_note: null
})
// returns { sale_id, invoice_no, total, change_due }
```

Inside Postgres, in a single transaction:

```
1.  SELECT ... FOR UPDATE on stock_balances rows   ← locks, prevents oversell
2.  validate quantities against available stock
3.  INSERT sales (status = COMPLETED)
4.  INSERT sale_items
5.  INSERT stock_movements (one per line, with before/after qty)
6.  UPDATE stock_balances
7.  INSERT sale_payments
8.  UPDATE register_sessions (cash_expected)
9.  INSERT outbox event 'sale.completed'           ← triggers the plugin chain
10. audit trigger fires
COMMIT
```

Consequences worth stating plainly:

- **Overselling is impossible.** The `FOR UPDATE` lock serialises concurrent
  cashiers on the same product row.
- **Partial failure is impossible.** It commits whole or rolls back whole.
- **Android calls the identical function.** §43 satisfied by construction.
- **Offline replay works later.** One queued call, atomic.
- **RLS is written once** on the function, not per table per operation.

### Which operations are RPCs

| Function | Purpose |
|---|---|
| `complete_sale` | Sale → items → stock → payments → register → outbox |
| `hold_sale` / `resume_sale` | Draft lifecycle |
| `refund_sale` | Full / partial / item-level refund, restocks |
| `receive_purchase` | PO → stock in → supplier balance |
| `adjust_stock` | Adjustment with reason, writes ledger |
| `transfer_stock` | Warehouse A → B, two ledger rows |
| `open_register` / `close_register` | Session lifecycle with variance |
| `record_expense` | Expense + payment + register effect |
| `apply_payment` | Customer credit payment |

Everything else — creating a product, editing a customer, adding a category —
is a plain PostgREST insert guarded by RLS. Those are single-table, cannot
half-fail, and don't need a transaction.

**Do not RPC-ify everything.** That would be slower and harder to read. The
test is: *does this operation span tables or mutate stock/money?*

---

## 3. The event system — two layers

Your spec (§6) describes:

```
Sale Completed → Inventory → Loyalty → Accounting → Analytics → Notification
```

Implemented purely in JavaScript, this chain is unreliable:

| Failure | Result |
|---|---|
| Tab closed after payment | Loyalty points never awarded |
| Network drops mid-chain | Accounting entry missing, no retry |
| Sale created by Android app | Chain never runs at all |
| Two plugins throw | Later plugins never execute |

So the chain is split.

### Layer 1 — Authoritative (Postgres)

`complete_sale` inserts into an **outbox** table inside the same transaction:

```sql
CREATE TABLE outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  event_type    text NOT NULL,          -- 'sale.completed'
  aggregate_id  uuid NOT NULL,          -- the sale id
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz             -- null until handled
);
```

Because the insert shares the sale's transaction, **the event exists if and
only if the sale exists.** No dual-write problem.

Postgres triggers on the outbox then perform the mandatory reactions —
loyalty accrual, accounting journal — also transactionally. Realtime is
enabled on `outbox` so clients see events appear.

### Layer 2 — Presentational (TypeScript EventBus)

```ts
interface EventBus {
  on<T extends EventName>(type: T, handler: Handler<Payload[T]>): Unsubscribe
  emit<T extends EventName>(type: T, payload: Payload[T]): void
  once<T extends EventName>(type: T, handler: Handler<Payload[T]>): Unsubscribe
}
```

Used for: toasts, dashboard widget refresh, cache invalidation, POS
animations, "held sales" badge counts. Losing one of these costs a stale
widget, not money.

The bridge: a Realtime subscription on `outbox` re-emits each row into the JS
bus, so plugins subscribe to one API regardless of origin.

### Event catalogue

```
product.created / updated / deleted
sale.created / held / resumed / completed / cancelled / refunded / partially_refunded
purchase.created / received / cancelled
stock.in / out / adjusted / transferred / counted
customer.created / updated / deleted
supplier.created / updated
payment.received / refunded
expense.recorded / deleted
register.opened / closed
user.logged_in / logged_out / permission_changed
day.opened / day.closed
plugin.enabled / disabled / configured
```

### Ordering and idempotency

Plugins register with a numeric `priority`. Handlers must be **idempotent** —
the bridge may redeliver after a reconnect. Every handler receives
`event.id` and is expected to no-op on repeats. This is a plugin-SDK
contract, documented in [05](./05-plugin-architecture.md).

---

## 4. Data source abstraction

```ts
interface DataSource {
  products: ProductRepository
  sales: SaleRepository
  stock: StockRepository
  customers: CustomerRepository
  // …
}
```

Three implementations:

| Impl | When | Notes |
|---|---|---|
| `SupabaseDataSource` | Production, v1 | PostgREST reads + RPC writes |
| `IndexedDbDataSource` | Offline (future) | Writes queue in an outbox; replay on reconnect |
| `DemoDataSource` | Demo mode (§47) | In-memory + seeded; never touches network |

Selected once at bootstrap. **No business code may check `isDemo`** — see
[09](./09-risks-and-decisions.md) #13.

### Why this matters for offline

The repository interface is the seam. Adding IndexedDB means implementing the
interface and swapping the registration — not editing 40 call sites. And
because writes are already atomic single calls, an offline queue is a list of
RPC invocations, which replay cleanly.

---

## 5. Frontend runtime

Vanilla TypeScript, no framework. The pieces needed:

| Concern | Approach |
|---|---|
| Reactivity | Small signal/store primitive (`createStore<T>`) — ~80 lines, no dependency |
| Components | Functions returning `HTMLElement`, or template strings + `render()` |
| Routing | Hash-based router with route table; lazy `import()` per route |
| Code splitting | Every plugin and every route is a dynamic import |
| State | Per-feature stores + a session store (auth, org, branch, register) |
| Styling | Tailwind utility classes + semantic design tokens |
| Icons | Material Symbols Rounded primary; Font Awesome 6 for brand/missing glyphs |

### Component contract

Every component in `components/` is generic and business-ignorant:

```ts
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: IconRef
  loading?: boolean
  disabled?: boolean
  onClick?: () => void
}
export function Button(props: ButtonProps): HTMLButtonElement
```

No component in `components/` may import from `services/`, `repositories/` or
Supabase. That rule is what keeps them reusable across plugins.

---

## 6. Bootstrap sequence

```
1. Load config (env, build flags)
2. Create Supabase client (anon key only)
3. Restore session → if none, route to /login
4. Load organization, branches, active branch
5. Load user roles → resolve effective permissions
6. Load enabled plugins (from `plugins` table)
7. Resolve plugin dependency graph → topological order
8. activate() each plugin with its PluginContext
9. Build navigation tree (core nodes + plugin nodes, filtered by permission)
10. Register commands, shortcuts, widgets
11. Mount layout, route to default page
12. Open Realtime channels (outbox, held sales, low stock)
```

Steps 6–10 are why the sidebar, command palette and dashboard are all dynamic:
they are *built after* plugins activate, never hardcoded.

---

## 7. Performance strategy (§45)

| Concern | Approach |
|---|---|
| POS search latency | `pg_trgm` GIN index on `products.search_text`; 150 ms debounce; result cache keyed by query; keyboard-driven so typing never blocks |
| Product list | Keyset pagination, not `OFFSET` |
| Dashboard | Single Postgres view/RPC returning all widget aggregates in one round trip, not 8 queries |
| Bundle | Route-level and plugin-level dynamic import; core bundle target < 250 KB gz |
| Realtime | Subscribe to `outbox` filtered by `organization_id` and a small event allow-list. Never subscribe to `products` wholesale. |
| Config | Organization settings, payment methods, tax rules, categories cached in the session store; invalidated on `settings.updated` event |

### The dashboard query problem

Eight widgets as eight queries = 8 round trips on every load, and each one
re-scans `sales`. Instead:

```sql
CREATE FUNCTION dashboard_summary(p_branch_id uuid, p_day date)
RETURNS jsonb  -- { today_sales, order_count, gross_profit, items_sold,
               --   low_stock_count, out_of_stock_count, pending_payments,
               --   customer_count, sales_by_hour[], top_products[], … }
```

One call. Charts read from the same payload. This is also exactly what the
Android dashboard will call.

---

## 8. Environments & configuration

```
.env.example
  VITE_SUPABASE_URL=
  VITE_SUPABASE_ANON_KEY=
  VITE_APP_ENV=development        # development | staging | production
  VITE_ENABLE_DEMO=false          # build-time gate for DemoDataSource
```

`VITE_ENABLE_DEMO` is read at build time and used to tree-shake the demo data
source out of production bundles entirely. Never a runtime toggle.

**No service-role key anywhere in the frontend.** Anything needing it lives in
a Supabase Edge Function.
