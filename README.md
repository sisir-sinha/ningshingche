# Mekholi

A universal retail POS platform with a plugin architecture. One core that
serves a corner shop, a pharmacy, a mobile phone store and a multi-branch
retailer — with industry-specific behaviour delivered by plugins rather than
forks.

**Status:** Phase 1 complete. The platform layer — event bus, plugin
registry, router, auth, sidebar and command palette — is in place and the
plugin architecture is proven. Design is in [`docs/`](./docs/README.md).

---

## Quick start

```bash
npm install
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev               # http://localhost:5173
```

Run everything CI runs:

```bash
npm run check
# typecheck → lint → boundary check → 73 unit tests → 33 database assertions → build
```

---

## What is here

| Path | Contents |
|---|---|
| `docs/` | Architecture, database design, plugin system, navigation, permissions, plugin matrix, risks, roadmap |
| `supabase/migrations/` | 19 migrations — 43 tables, RLS on every one, the RPC write path |
| `supabase/seed/` | Permission catalogue + a provisioning smoke test |
| `data/shop_categories.json` | 30 business types in 7 groups, bn/en, with plugin recommendations |
| `tools/` | Migration validator and architecture boundary checker |
| `src/shared/bus/` | EventBus — typed, wildcard-aware, handler-isolated |
| `src/shared/registry/` | Plugin host — dependency ordering, failure isolation, attribution |
| `src/app/` | Router, state store, Supabase client, auth service |
| `src/features/` | Auth screen, app shell, dynamic sidebar, command palette, dashboard |
| `src/components/` | UI kit — `h()` builder, buttons, inputs, toasts, modals |
| `src/plugins/batch-expiry/` | The reference plugin, and the architecture's acceptance test |

---

## The design in five decisions

1. **Writes go through Postgres RPCs; reads go through PostgREST.**
   `complete_sale` locks the balance rows, writes the ledger, prints the
   invoice and raises the event in one transaction. Overselling is impossible
   and an Android client gets identical behaviour for free.

2. **The event chain runs in Postgres, not JavaScript.** A transactional
   outbox row is written inside the sale's transaction, so loyalty and
   accounting reactions survive a closed tab and run for every client. The
   TypeScript bus is presentational only.

3. **Plugins extend products by registering field descriptors.** The core
   product form renders fields it has never heard of, so the same form serves
   "Milk 1 Litre" and a controlled drug.

4. **Every product has a default variant.** `variant_id` is never null, which
   removes a large class of branching from the inventory engine.

5. **Authorization lives in Postgres.** `app.*` helpers are `SECURITY DEFINER`
   with a pinned `search_path`, which also avoids the RLS recursion trap.
   Frontend checks hide buttons; they never authorize.

---

## Applying the schema

```bash
supabase start
supabase db reset        # migrations/ then seed/
```

`db reset` leaves you with a provisioned demo organization ("Seed Demo Shop")
so the database is immediately usable.

The migrations are applied to a real Postgres in CI on every push — see
[`tools/README.md`](./tools/README.md).

---

## Architecture boundaries

The rule that matters: **adding a plugin must never require editing
`src/features/`.** That only holds if a plugin cannot reach into
`src/features/` at all, so it is enforced twice.

`npm run check:boundaries` resolves every import in `src/` to a real file path
and rejects:

| Rule | Effect |
|---|---|
| `plugins/` → `features/` | A plugin cannot fork the sales engine (§51 becomes impossible, not discouraged) |
| `plugins/` → `app/` | A plugin gets a `PluginAPI`, never the application |
| `plugins/<a>/` → `plugins/<b>/` | Composition via `dependencies` and events, never a direct import |
| `components/` → `features/`, `plugins/`, `app/` | The UI kit stays business-ignorant and reusable |
| `shared/domain/` → UI or I/O | Business logic stays pure and becomes the Android specification |

ESLint's `no-restricted-imports` enforces the glob-expressible subset as a
first line of defence. It matches the specifier string, so it cannot tell
`../batch-expiry` (a sibling plugin — forbidden) from `../field-helpers`
(inside the same plugin — fine); the resolver-based checker can.

No `any` anywhere (spec §59), enforced by `tsc`.

**Proven, not asserted:** `src/features/layout/navigation.test.ts` loads the
real `batch-expiry` plugin and confirms its nav item reaches the sidebar —
interleaved at its declared order, gated on its declared permission — with no
edit to any file under `src/features/`. That plugin's entire import list is one
line: `import type { Plugin, ProductField, ProductDraft } from
'../../shared/registry/plugin-types'`.

---

## Security

- RLS on all 43 tables; `app.tables_missing_rls()` fails CI if a new table
  ships unprotected.
- `EXECUTE` revoked from `anon` and `authenticated` on every function, then
  granted back only on the intended API surface. Internal helpers such as
  `apply_stock_movement` are unreachable from the client.
- The service-role key never reaches the frontend. Only `VITE_` variables do,
  and they are public by definition.

---

## Roadmap

See [`docs/10-roadmap.md`](./docs/10-roadmap.md).

| Phase | Scope |
|---|---|
| 0 | **Done** — toolchain, taxonomy, migrations, validation |
| 1 | **Done** — router, plugin registry, event bus, component kit, auth, sidebar, command palette |
| 2 | Core POS: products, cart, payments, receipts, customers, register |
| 3 | Inventory: ledger, stock in/out, transfers |
| 4 | Purchases, expenses, returns |
| 5 | Dashboard, analytics, reports |
| 6 | Plugin system hardening |
| 7 | Capability and industry plugins |
| 8 | Offline and Android readiness |
