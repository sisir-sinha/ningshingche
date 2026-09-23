# 01 — Requirements Analysis

The classification below is the foundation of the whole system. Every feature
in your spec has been assigned to exactly one of three buckets. Getting this
wrong is what produces "Pharmacy POS with its own sales engine" (§51).

**The test applied:** *If a feature were removed, could the shop still take a
sale and know its stock?* If yes → plugin. If no → core.

---

## 1. Universal core — always present, cannot be disabled

These are in the core bundle, unconditionally. They are not plugins and have
no enable toggle.

### Tenancy & identity

| Feature | Spec | Note |
|---|---|---|
| Organization / branch / warehouse | §27, §28 | Single-branch shops get one row each; the shape is identical at 1 branch and 200 |
| Supabase Auth + session | §44 | Email/password first, magic link and phone later |
| Users, roles, permissions | §26 | Granular `resource.action` strings |
| Audit log | §31 | Written by Postgres triggers, not application code |
| Settings store | §36 | Namespaced key/value with typed schema |

### Catalogue

| Feature | Spec | Note |
|---|---|---|
| Products (minimal model) | §8, §10 | Name, selling price, cost price, category, stock |
| Categories (hierarchical) | §7 | Tree, unlimited depth |
| Units of measure | §10 | Each, kg, litre, dozen, metre — configurable |
| Product search | §55 | `pg_trgm` + tsvector; "sam a15" → "Samsung Galaxy A15" |
| Barcodes (scan + lookup) | §9 | Scanning is universal; **label printing** is a plugin |

Note on barcodes: your spec lists a Barcode Plugin (§4, §32). Scanning into the
POS is universal — a convenience store without a scanner is broken. What is
genuinely optional is *label generation and printing*, which is where the
plugin lives. Recommendation: rename to **Label Printing Plugin**.

### Selling

| Feature | Spec | Note |
|---|---|---|
| POS screen + cart | §14 | Keyboard, scanner and touch driven |
| Sales, sale items | §16 | Statuses DRAFT → HELD → COMPLETED → … |
| Hold / resume | §17 | Draft rows in `sales`, not a separate store |
| Payments, split payment | §15 | Methods configurable per organization |
| Basic refund (full + item level) | §18 | Exchange is a plugin |
| Receipts | §54 | Data model core; templates core; **printer drivers** are plugins |
| Register / cashier session | §25 | Opening float, cash in/out, close, variance |

### Stock

| Feature | Spec | Note |
|---|---|---|
| Stock ledger (append-only movements) | §12 | The answer to "why 37 units?" |
| Stock balances (materialised current) | §12 | Per product × variant × warehouse |
| Stock in / out / adjust | §13 | Four fields, one screen |
| Low-stock / out-of-stock | §21 | Derived from `reorder_point` |
| Stock transfers | §28 | Warehouse A → B |

### People & money

| Feature | Spec | Note |
|---|---|---|
| Customers (name + phone) | §19 | Everything else optional |
| Suppliers | §20 | |
| Purchases + receive | §7 | Purchase order → receive → stock in |
| Expenses + categories | §24 | |
| Tax (rules, not rates) | §29 | Must not hardcode VAT/Mushak or US sales tax |

### Platform

| Feature | Spec | Note |
|---|---|---|
| Plugin registry + SDK | §4, §5, §52 | Core infrastructure |
| Event bus | §6 | See [02](./02-architecture.md) for the two-layer split |
| Dynamic navigation | §7 | |
| Command palette | §40 | Plugins contribute commands |
| Keyboard shortcuts | §41 | Configurable |
| Component system | §39 | |
| Design tokens + dark mode | §38 | |
| Dashboard shell | §21 | Widgets core; plugin widgets registered |
| Report framework | §23 | Engine core; individual reports partly plugin |
| Analytics framework | §22 | Dimensions + measures core |

---

## 2. Optional plugins — capability, industry-agnostic

Enabled by any shop that needs them. These are the reusable building blocks
that industry plugins *compose* rather than reimplement.

| Plugin | Adds | Composed by |
|---|---|---|
| **Variants** | Variant matrix, option types (size/colour), per-variant stock & price | Fashion, Shoe, Sports |
| **Batch & Expiry** | Batch tracking, FEFO picking, expiry alerts | Grocery, Pharmacy, Bakery, Cosmetics |
| **Serial Numbers** | One row per unit, serial capture at sale, IMEI | Electronics, Mobile, Appliance |
| **Warranty** | Warranty terms, claim tracking | Electronics, Appliance, Bicycle |
| **Weight & Scale** | Decimal quantities, tare, scale integration | Butcher, Bakery, Grocery, Hardware |
| **Loyalty** | Points, tiers, redemption, store credit | Any |
| **Wholesale / Price Lists** | Customer groups, tiered pricing, per-branch prices | Any, esp. Wholesale |
| **Promotions** | BOGO, bundles, time-boxed discounts, coupon codes | Any |
| **Gift Cards** | Issue, redeem, balance | Any |
| **Label Printing** | Barcode label templates, thermal printing | Any |
| **Accounting** | Journal entries, COGS, trial balance, export | Any |
| **Returns & Exchange** | Exchange workflow, store-credit refunds (beyond basic refund) | Any |
| **Delivery** | Delivery orders, rider assignment, zones | Any |
| **Stocktake** | Cycle counting, count sessions, variance approval | Any |
| **Multi-currency** | FX rates, per-sale currency | Border shops, Wholesale |
| **Notifications** | SMS / WhatsApp / Email on events | Any |
| **Production / BOM** | Recipes, raw material consumption, yield | Bakery, Butcher, Furniture |

### The Production plugin deserves a note

Your list includes Bakery, Butcher and Furniture. All three *manufacture*:
flour → bread, carcass → cuts, timber → table. Without a bill-of-materials
plugin, those shops cannot represent their core operation — they sell items
they never "purchased." This is a real gap in the spec's plugin list (§4, §32)
and it is added here.

---

## 3. Industry plugins — thin, compositional

An industry plugin is **not** a feature set. It is a bundle that does three
things and nothing more:

1. Declares which **optional plugins** it wants enabled by default
2. Registers **product field extensions** for its domain
3. Adds **navigation** and **reports** specific to its domain

It never implements sales, stock or payments.

### The three shapes of industry plugin

**Shape A — Field-only.** Adds columns to the product concept. No new
workflow. Cheapest, most common.

> Bookstore: `isbn`, `author`, `publisher`, `edition`, `binding`
> Cosmetics: `shade`, `volume_ml`, `ingredient_list`
> Toy/Game: `age_min`, `age_max`, `platform`, `franchise`

**Shape B — Field + workflow.** Adds an entity graph the core doesn't have.

> Mobile Phone Shop: `imei_1`, `imei_2` + IMEI registry lookup + network lock status
> Jewelry: `carat`, `metal_weight_g`, `making_charge`, `certificate_no` + valuation workflow
> Pharmacy: `salt_composition`, `dosage_form`, `strength`, `schedule` (controlled drug class), `prescription_required` + prescription capture

**Shape C — New domain entities.** Requires genuinely new tables and screens.

> Auto Parts: **vehicle fitment** — year / make / model / engine compatibility graph. This is the largest single industry extension and cannot be faked with metadata.
> Repair: repair orders, devices, technicians, status pipeline, parts consumed.
> Bicycle: frame size + workshop service scheduling (overlaps Repair).
> Restaurant: see the caveat below.

### The restaurant problem

Restaurant is listed in §4 and §32 but is **not retail**. It needs tables,
covers, courses, kitchen routing, modifiers, split-by-item bills and course
timing. Forcing it into a retail sale model produces a bad restaurant system
and a polluted retail core.

Recommendation: build it as a plugin that introduces an `order` aggregate
*wrapping* the universal sale — a table session opens an order, courses are
sent to the kitchen, the bill closes into a normal universal sale. Universal
stock, payments, receipts and reporting all still apply. But schedule it last
and treat it as a separate product surface, not a peer of Grocery.

---

## 4. Explicitly rejected

Recording these so the decision is not silently re-litigated later.

| Idea | Why rejected |
|---|---|
| Per-industry product tables (`pharmacy_products`, `clothing_products`) | Destroys universal search, reporting and stock. The field-extension registry solves the same need without it. |
| `product.stock` as a single integer column | Cannot answer §12. Balance is derived from the ledger. |
| JS-only event chain for stock/loyalty | Loses data on client death; unusable from Android. See [02](./02-architecture.md) §2. |
| EAV table for product attributes | Unqueryable, unindexable, no type safety. Metadata jsonb + plugin tables instead. |
| Separate held-sales store | Held sale is `sales.status = 'HELD'`. One table, one query path. |
| Hardcoded bKash/Nagad or Visa/PayPal | §15. `payment_methods` is a per-organization table, seeded not coded. |
| Hardcoded VAT / Mushak 6.3 | Tax rules table. The previous codebase in this repo hardcoded Mushak — that is exactly what §15 forbids. |
| Frontend permission checks as authorisation | §44. RLS + `has_permission()` in Postgres. |
| Service-role key in the browser | §44. Edge Functions only. |

---

## 5. Universal vs plugin — summary counts

| Bucket | Count |
|---|---|
| Core, non-optional | ~30 features |
| Optional capability plugins | 17 |
| Industry plugins (Shape A) | ~12 |
| Industry plugins (Shape B) | ~5 |
| Industry plugins (Shape C) | ~4 |

The ratio matters: **roughly 70% of the value is universal.** If the plugin
system is heavier than the core, the split is wrong.
