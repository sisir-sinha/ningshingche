# 06 — Navigation Architecture

The sidebar is **never hardcoded**. It is a tree assembled at runtime from
three inputs, in this order:

```
core navigation nodes
      +
plugin navigation nodes
      ↓
filtered by the user's effective permissions
      ↓
sorted by group → order
      ↓
rendered
```

---

## 1. The node model

```ts
interface IconRef {
  set: 'material' | 'fa'
  name: string                    // 'point_of_sale' | 'fa-solid fa-prescription'
}

interface NavigationNode {
  /** Stable, globally unique. Plugin nodes must be prefixed: 'pharmacy.medicines'. */
  readonly id: string
  readonly label: string
  readonly icon?: IconRef

  /** Omit to make this a pure group header (cannot be navigated to). */
  readonly path?: string

  /** Attach under an existing node. Omit for top level. */
  readonly parentId?: string

  /** Sort within siblings. Gaps of 10 leave room for later inserts. */
  readonly order?: number

  /** Hidden unless the user holds this permission. */
  readonly permission?: string

  /** Set automatically for plugin-contributed nodes. */
  readonly pluginId?: string

  /** Live counter — held sales, low stock, pending repairs. */
  readonly badge?: () => number | Promise<number>

  /** Group nodes collapse by default when true. */
  readonly collapsedByDefault?: boolean

  readonly hidden?: boolean
}
```

`parentId` referencing an existing node is what lets a plugin graft itself
into the core tree. The Loyalty plugin puts "Loyalty Accounts" *under*
Customers rather than creating a fourth top-level section — the sidebar stays
short as plugins accumulate.

---

## 2. Core tree

The base structure from §7, with IDs and permissions:

```
dashboard                     dashboard.view
pos                           sales.view
├── pos.new                   sales.create
├── pos.held                  sales.view          (badge: held count)
├── pos.recent                sales.view
└── pos.returns               sales.refund
products                      products.view
├── products.all              products.view
├── products.categories       products.view
├── products.brands           products.view
├── products.units            settings.manage
└── products.price-lists      products.view
inventory                     inventory.view
├── inventory.overview        inventory.view
├── inventory.in              inventory.stock_in
├── inventory.out             inventory.stock_out
├── inventory.adjustments     inventory.adjust
├── inventory.transfers       inventory.transfer
└── inventory.history         inventory.view
purchases                     purchases.view
├── purchases.orders          purchases.view
├── purchases.receive         purchases.receive
└── purchases.history         purchases.view
customers                     customers.view
suppliers                     suppliers.view
expenses                      expenses.view
reports                       reports.view
analytics                     analytics.view
users                         users.manage
settings                      settings.manage
plugins                       plugins.manage
```

---

## 3. Plugin grafts

| Plugin | Grafts |
|---|---|
| **Pharmacy** | top-level `Pharmacy` → Medicines, Expiry Tracking *(badge: expiring ≤30d)*, Prescription Sales |
| **Repair** | top-level `Repair` → Repair Orders, Devices, Technicians, Repair Status *(badge: awaiting pickup)* |
| **Variants (Fashion)** | under `products` → Sizes, Colours, Collections |
| **Serial Numbers** | under `inventory` → Serial Lookup |
| **Warranty** | under `customers` → Warranty Claims |
| **Loyalty** | under `customers` → Loyalty Accounts, Points Adjustments |
| **Wholesale** | under `products` → Price Lists, Customer Groups |
| **Stocktake** | under `inventory` → Stocktake Sessions |
| **Production** | top-level `Production` → Recipes, Production Runs, Raw Materials |
| **Accounting** | top-level `Accounting` → Journal, COGS, Trial Balance |
| **Auto Parts** | top-level `Fitment` → Vehicles, Compatibility |

Result for a pharmacy:

```
Dashboard
POS
Products
Inventory
Purchases
Customers
  └── Loyalty Accounts          ← loyalty plugin
Suppliers
Expenses
Pharmacy                        ← pharmacy plugin
  ├── Medicines
  ├── Expiry Tracking    (12)   ← live badge
  └── Prescription Sales
Reports
Analytics
Settings
Plugins
```

Two plugins added nine entries and zero core edits.

---

## 4. Registry and resolution

```ts
class NavigationRegistry {
  add(node: NavigationNode): Dispose
  /** Returns a permission-filtered, sorted tree. Recomputed on:
   *  plugin enable/disable, permission change, locale change. */
  resolve(): NavigationTree
  /** Called when a badge's source store changes. */
  invalidateBadges(): void
}

interface NavigationTree {
  nodes: NavigationBranch[]
}
interface NavigationBranch {
  node: NavigationNode
  children: NavigationBranch[]
  visibleCount: number          // 0 → prune the whole branch
}
```

### Pruning rule

A group with no visible children is removed entirely. A cashier who cannot
see Reports, Analytics, Users, Settings or Plugins gets a six-item sidebar,
not a twelve-item sidebar with greyed-out entries. Empty chrome is noise.

---

## 5. Badges

Badges are functions, not stored values, so the sidebar never holds stale
counts.

```ts
{
  id: 'pos.held',
  badge: () => heldSalesStore.count,     // synchronous store read
}
{
  id: 'pharmacy.expiry',
  badge: async () => {                   // cached, refreshed on an event
    return cache.get('expiring-soon') ?? await fetchExpiringCount()
  },
}
```

Refresh triggers: `sale.held`, `sale.resumed`, `stock.in`, and a 60-second
poll for time-based badges (expiry counts change without any user action).
Badges are capped at `99+`.

---

## 6. Responsive behaviour (§48)

| Breakpoint | Sidebar |
|---|---|
| ≥ 1280 px | Expanded, labels visible |
| 1024–1279 px | Collapsed to icons; expands on hover |
| 768–1023 px | Off-canvas drawer, hamburger toggle |
| < 768 px | No sidebar. Bottom tab bar with the 5 highest-priority nodes + a "More" sheet holding the rest |

The mobile rule is important: **the bottom bar is not a shrunken sidebar.**
It shows Dashboard, POS, Products, Sales and More. The POS route itself uses
a separate full-bleed layout with no chrome at all, because a cashier's
tablet should be nothing but the register.

Priority for the bottom bar comes from a `mobilePriority` field on the node,
defaulting to `order`. Plugins can set it, so a repair shop can put Repair
Orders in the bottom five.

---

## 7. Why not a config file

A `sidebar.json` was considered and rejected: it cannot express permission
gating, live badges, plugin contributions or lazy route binding. It would
become a second source of truth that drifts from the router. The tree is
built from the same registrations that drive routing and the command palette,
so those three can never disagree about what exists.
