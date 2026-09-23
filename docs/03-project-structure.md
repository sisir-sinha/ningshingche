# 03 — Project Structure

> **How these boundaries are enforced.** The rules below are checked by
> `tools/check-boundaries.mjs`, which resolves every import under `src/` to a
> real file path and rejects a violation with a non-zero exit. It runs in
> `npm run check` and in CI. ESLint's `no-restricted-imports` covers the
> glob-expressible subset as a first line of defence, but it matches the
> specifier string and so cannot distinguish a sibling-plugin import from an
> intra-plugin one — the resolver-based checker can, and it is authoritative.

## 1. Proposed layout

Your sketch (§49) has three directories whose ownership overlaps: `pages/`,
`modules/` and `plugins/` all contain screens. Below, ownership is
unambiguous — every directory answers "who is allowed to write here?"

```
universal-pos/
├── public/
│   ├── favicon.svg
│   └── manifest.json
│
├── src/
│   ├── app/                    # Bootstrap only. No features.
│   │   ├── bootstrap.ts        #   the 12-step sequence from doc 02 §6
│   │   ├── app.ts              #   app shell: mounts layout + router outlet
│   │   └── env.ts              #   typed env access
│   │
│   ├── core/                   # THE PLATFORM. Owned by core team only.
│   │   ├── plugins/            #   registry, loader, dependency resolver, SDK types
│   │   │   ├── registry.ts
│   │   │   ├── loader.ts
│   │   │   ├── deps.ts         #   topological sort, cycle detection
│   │   │   └── sdk.ts          #   public plugin-facing API
│   │   ├── events/             #   EventBus, event catalogue, outbox bridge
│   │   ├── navigation/         #   NavigationRegistry, tree builder
│   │   ├── commands/           #   CommandRegistry (Ctrl+K)
│   │   ├── shortcuts/          #   KeyboardRegistry, configurable bindings
│   │   ├── rbac/               #   PermissionRegistry, has(), guard()
│   │   ├── router/             #   hash router, route table, lazy loading
│   │   ├── settings/           #   typed settings store, namespaced
│   │   ├── widgets/            #   DashboardWidgetRegistry
│   │   ├── i18n/               #   bn ⇄ en
│   │   ├── theme/              #   design tokens, dark mode
│   │   └── audit/              #   client-side audit helper (server does the real work)
│   │
│   ├── components/             # GENERIC UI KIT. No business knowledge.
│   │   ├── button/  input/  select/  combobox/  search-input/
│   │   ├── date-picker/  modal/  drawer/  dropdown/  tabs/
│   │   ├── card/  data-table/  pagination/  badge/  toast/
│   │   ├── alert/  tooltip/  command-palette/  empty-state/
│   │   ├── skeleton/  confirm-dialog/  form/  icon/
│   │   └── index.ts            #   barrel export
│   │
│   ├── layouts/
│   │   ├── app-shell.ts        #   sidebar + topbar + outlet (desktop)
│   │   ├── auth-shell.ts       #   centred card (login / setup wizard)
│   │   └── pos-shell.ts        #   full-bleed POS, no sidebar chrome
│   │
│   ├── features/               # CORE BUSINESS MODULES. Each self-contained.
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── pos/                #   cart, checkout, hold, payment, receipt
│   │   ├── products/
│   │   ├── categories/
│   │   ├── inventory/          #   stock in/out/adjust/transfer/history
│   │   ├── purchases/
│   │   ├── customers/
│   │   ├── suppliers/
│   │   ├── expenses/
│   │   ├── register/           #   cash sessions
│   │   ├── returns/
│   │   ├── reports/
│   │   ├── analytics/
│   │   ├── users/
│   │   ├── settings/
│   │   ├── setup-wizard/       #   §34
│   │   └── plugins-admin/      #   enable/disable/configure plugins
│   │       └── ... each contains:
│   │           ├── pages/          # route-level screens
│   │           ├── components/     # feature-specific UI
│   │           ├── services/       # orchestration
│   │           ├── store.ts        # feature state
│   │           └── index.ts        # public surface + nav/route registration
│   │
│   ├── plugins/                # PLUGINS. Each is a self-contained package.
│   │   ├── variants/
│   │   ├── batch-expiry/
│   │   ├── serial-numbers/
│   │   ├── warranty/
│   │   ├── weight-scale/
│   │   ├── loyalty/
│   │   ├── wholesale/
│   │   ├── promotions/
│   │   ├── gift-cards/
│   │   ├── label-printing/
│   │   ├── accounting/
│   │   ├── stocktake/
│   │   ├── production/         #   BOM / manufacturing
│   │   ├── notifications/
│   │   └── industry/
│   │       ├── grocery/  fashion/  electronics/  mobile/
│   │       ├── pharmacy/  repair/  jewelry/  bookstore/
│   │       ├── hardware/  auto-parts/  pet/  bakery/
│   │       └── ...
│   │       └── ... each contains:
│   │           ├── manifest.ts     # data only — safe to read without executing
│   │           ├── index.ts        # activate(ctx)
│   │           ├── pages/          # optional, lazy loaded
│   │           ├── components/
│   │           ├── hooks/          # event handlers
│   │           └── migrations/     # SQL, namespaced
│   │
│   ├── shared/
│   │   ├── domain/             # PURE LOGIC. Zero I/O. The Android spec.
│   │   │   ├── cart.ts         #   cartReducer
│   │   │   ├── pricing.ts      #   discounts, price lists
│   │   │   ├── tax.ts          #   tax rules engine
│   │   │   ├── stock.ts        #   movement math, costing
│   │   │   ├── invoice.ts      #   totals, change due, rounding
│   │   │   └── validation.ts
│   │   ├── repositories/       # interfaces + Supabase implementations
│   │   │   ├── contracts/      #   ProductRepository, SaleRepository, …
│   │   │   ├── supabase/       #   PostgREST + RPC implementations
│   │   │   ├── demo/           #   DemoDataSource
│   │   │   └── index.ts        #   composition root
│   │   ├── services/           # cross-feature services
│   │   ├── stores/             # session store, org store
│   │   ├── types/              # shared types, generated from DB where possible
│   │   ├── utils/              # format, date, money, id, debounce
│   │   └── config/             # defaults, constants, feature flags
│   │
│   └── styles/
│       ├── tokens.css          # semantic design tokens (light + dark)
│       ├── base.css
│       └── components.css
│
├── supabase/
│   ├── migrations/             # numbered, e.g. 20260923_001_core.sql
│   ├── functions/              # Edge Functions
│   ├── seed/                   # permissions, roles, payment methods, categories
│   └── config.toml
│
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json               # strict: true, noUncheckedIndexedAccess
└── README.md
```

---

## 2. Differences from your sketch, and why

| Your sketch | Proposed | Reason |
|---|---|---|
| `pages/` + `modules/` at top level | `features/<x>/pages/` | Two places to put a screen guarantees drift. Co-locating pages with their feature means deleting a feature deletes its screens. |
| `services/` at top level | `features/<x>/services/` + `shared/services/` | A sale service belongs to the sales feature. Only genuinely cross-cutting services are shared. |
| `stores/` at top level | `features/<x>/store.ts` + `shared/stores/` | Same reasoning. Global store dir becomes a dumping ground. |
| `modules/` | `features/` | "module" is ambiguous — it could mean plugin. "feature" is unambiguous. |
| `repositories/` at top level | `shared/repositories/` with `contracts/` and impls split | The *interface* is what domain and services depend on; implementations are swappable (Supabase / IndexedDB / Demo). Splitting them makes §42 real. |
| — | `shared/domain/` added | Your sketch has no home for pure logic, so it would leak into services. This directory is the Android specification. |
| `types/` at top level | `shared/types/` | Same grouping. |

Net effect: **8 top-level source directories** (`app`, `core`, `components`,
`layouts`, `features`, `plugins`, `shared`, `styles`) instead of 12. Fewer,
each with a single clear owner.

---

## 3. Ownership rules

Enforced by review, and by ESLint `no-restricted-imports` boundaries.

| Rule | Rationale |
|---|---|
| `components/` may not import from `features/`, `plugins/`, `shared/repositories/` or Supabase | Keeps the UI kit reusable. This is the most commonly broken rule in the wild. |
| `shared/domain/` may not import anything outside `shared/domain/` and `shared/types/` | Purity is the point. If it needs I/O it is a service. |
| `features/<a>/` may not import from `features/<b>/` internals — only from `features/<b>/index.ts` | Prevents feature spaghetti. Cross-feature needs go through `shared/services/` or events. |
| `plugins/<x>/` may not import from `features/` at all | Plugins see only `core/`, `components/`, `shared/` and their `PluginContext`. This is what makes §51 structurally impossible rather than a policy. |
| `plugins/<x>/` may not import from `plugins/<y>/` | Plugins compose through declared `dependencies` and events, never direct imports. |
| No `any`. No `@ts-ignore` without a linked issue | §59 |

That fourth rule is the important one. **A plugin physically cannot reach the
sales engine's internals**, so it cannot fork it. The anti-pattern in §51 is
prevented by module boundaries, not by convention.

---

## 4. What a plugin looks like on disk

```
src/plugins/pharmacy/
├── manifest.ts          # pure data, no side effects
├── index.ts             # export default { manifest, activate }
├── hooks/
│   └── on-sale-completed.ts
├── pages/
│   ├── medicines.ts
│   ├── expiry-tracking.ts
│   └── prescriptions.ts
├── components/
│   └── expiry-badge.ts
└── migrations/
    └── 001_medicines.sql
```

`manifest.ts` is imported eagerly at startup to build the Plugins admin page
and resolve dependencies. `index.ts` and `pages/` are loaded lazily and only
when the plugin is enabled. A disabled plugin costs a few hundred bytes, not
its whole bundle.

---

## 5. Tooling

| Tool | Purpose |
|---|---|
| Vite | Build, HMR, `base` handling for Pages deploy |
| TypeScript `strict` + `noUncheckedIndexedAccess` | §59 |
| Tailwind CSS | Styling, design tokens via `theme.extend` |
| ESLint + `import/no-restricted-paths` | Enforces §3 boundaries mechanically |
| Vitest | Unit tests for `shared/domain/` (highest value, cheapest to test) |
| supabase-cli | Local Postgres, migration generation, type generation |

Type generation note: `supabase gen types typescript` produces `Database`
types. Use them for PostgREST reads; hand-write types for RPC payloads, since
the generator's function types are awkward to consume.
