# Universal POS — Architecture & Design

**Status:** Design phase — awaiting approval before Phase 1 implementation
**Date:** 2026-09-23
**Scope:** Requirements analysis, system architecture, database design, plugin system, navigation, permissions, plugin matrix, risks, roadmap

---

## How to read this

| # | Document | Covers |
|---|---|---|
| 01 | [Requirements Analysis](./01-requirements-analysis.md) | What is universal vs. what is a plugin. The single most important classification in the project. |
| 02 | [System Architecture](./02-architecture.md) | Layering, data flow, why writes go through Postgres RPCs, the two-layer event model. |
| 03 | [Project Structure](./03-project-structure.md) | Directory layout and ownership rules. |
| 04 | [Database Design](./04-database-design.md) | Schema, DDL, RLS, stock ledger, costing, indexes. |
| 05 | [Plugin Architecture](./05-plugin-architecture.md) | Manifest/context split, lifecycle, dependencies, SDK. |
| 06 | [Navigation Architecture](./06-navigation-architecture.md) | Dynamic sidebar generation. |
| 07 | [Permissions Architecture](./07-permissions-architecture.md) | RBAC model, namespacing, server-side enforcement. |
| 08 | [Plugin Matrix](./08-plugin-matrix.md) | Industry adaptation. **Partially blocked on `shop_categories.json`.** |
| 09 | [Risks & Decisions](./09-risks-and-decisions.md) | 16 architectural problems and the chosen solutions. |
| 10 | [Roadmap](./10-roadmap.md) | Phased delivery plan. |

---

## The five decisions that shape everything

If you only read one section, read this.

### 1. Business logic lives in Postgres, not TypeScript

Every write that mutates money or stock goes through a Postgres function
(`complete_sale`, `receive_purchase`, `adjust_stock`, `refund_sale`). Not a
sequence of client-side inserts.

Consequences:

- Stock can never go negative, because the decrement is inside a transaction
  with a row lock.
- The Android app gets identical behaviour for free — it calls the same
  functions. No backend rewrite, no logic drift. This is requirement §43.
- Offline replay becomes possible later, because a queued operation is one
  atomic call, not eight inserts that can half-succeed.

Reads go direct through PostgREST (faster, filterable, paginated). **Writes
through RPC, reads through PostgREST.**

### 2. The event system has two layers, and only one of them is authoritative

The chain in your spec — `sale.completed → inventory → loyalty → accounting →
analytics → notification` — **must not run in JavaScript.** If the browser
closes mid-chain, loyalty points are lost. If Android sends the sale, the JS
chain never runs at all.

| Layer | Where | Used for | Guarantees |
|---|---|---|---|
| **Authoritative** | Postgres triggers + transactional outbox table | Anything that must not be lost: stock, loyalty, accounting | Atomic, survives client death, runs for every client including Android |
| **Presentational** | TypeScript `EventBus` | Toasts, widget refresh, cache invalidation, POS animations | Best-effort, in-process |

The JS bus *mirrors* DB events (delivered via Supabase Realtime on the outbox
table) so plugins can react in the UI without owning correctness.

### 3. Plugins extend products by registering fields, not by forking the model

A pharmacy needs `expiry_date`. An electronics shop needs `imei`. A clothing
store needs `size`/`colour`. The core `products` table must not accumulate 40
nullable columns.

Plugins register **field descriptors**:

```ts
productFields: [{ id: 'expiry_date', label: 'Expiry Date', type: 'date',
                  section: 'advanced', storage: 'metadata' }]
```

The core product form renders descriptors it has never heard of. Storage is
either `products.metadata` (sparse, rarely queried) or a plugin-owned table
(hot, indexed, joinable). This is what makes §8 and §57 work: the *same* form
serves "Milk 1 Litre" and a pharmacy.

### 4. Three distinct inventory models, not one

Conflating these is the most common way a POS rots:

| Model | Example | Unit of stock |
|---|---|---|
| **Variant matrix** | T-shirt, Red/M | One balance per variant |
| **Batch** | Milk, expiry 12 Oct | Quantity per batch, FEFO picking |
| **Serialized** | Phone, IMEI 356… | One row *per physical unit* |

A shop may use all three simultaneously. They are separate core tables
(`product_variants`, `stock_batches`, `product_serials`), all optional, all
feeding the same `stock_movements` ledger.

### 5. Multi-tenancy is enforced in Postgres and nowhere else

`organization_id` on every tenant table. RLS policies built on a
`SECURITY DEFINER` helper reading a `user_organizations` junction table —
which also avoids the RLS recursion trap (the previous codebase in this repo
had a `fix_rls_recursion.sql`; that bug is designed out from the start, see
[09](./09-risks-and-decisions.md) #3).

Frontend permission checks hide buttons. They never authorise anything.

---

## The schema is verified, not asserted

`tools/validate-schema.mjs` extracts every SQL block from doc 04 and applies
it to a real Postgres engine (PGlite, WASM build). Current result: **88
statements applied, 0 failures, 43 tables created**, 5 RLS policies and 4
`app.*` helper functions. `tools/erd-check.mjs` confirms the ERD references no
table the DDL fails to create. See [tools/README.md](../tools/README.md).

---

## Open items

| Item | Status |
|---|---|
| `shop_categories.json` | **Not received.** Referenced in §3/§33/§58 but never attached. Doc 08 defines the *shape* the file must have and provides a matrix for the 16 industries named in your spec. The full per-category mapping is generated from the file once supplied. |
| Costing method | Recommendation: weighted-average default, FIFO as a plugin. Needs your confirmation — it changes the ledger. See [09](./09-risks-and-decisions.md) #6. |
| Restaurant support | Flagged as the one "industry" that may exceed the universal model (tables, kitchen, courses). See [08](./08-plugin-matrix.md#the-restaurant-problem). |
| Demo data strategy | Must be build-time isolated, not a runtime flag. See [09](./09-risks-and-decisions.md) #13. |
