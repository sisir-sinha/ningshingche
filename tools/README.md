# Validation tools

Two independent checkers, both run by `npm run check` and by CI.

```bash
npm run validate:migrations   # the database is real and behaves
npm run check:boundaries      # the architecture holds
```

---

## `check-boundaries.mjs` — architecture enforcement

The rule that matters for this project is: **adding an industry plugin must
never require editing `src/features/`.** That only holds if a plugin cannot
reach into `src/features/` in the first place, so the boundary is enforced
rather than documented.

Every import under `src/` is resolved to a real file path, then checked
against the layer rules:

| From | May not import | Why |
|---|---|---|
| `plugins/<id>/` | `features/`, `app/` | A plugin gets a `PluginAPI`, never the application (spec §51) |
| `plugins/<a>/` | `plugins/<b>/` | Compose via `dependencies` and events |
| `components/` | `features/`, `plugins/`, `app/` | The UI kit stays business-ignorant |
| `shared/domain/` | `app/`, `components/`, `features/`, `plugins/`, I/O | Business logic stays pure — it is the Android specification |
| `shared/` | `features/`, `plugins/` | Dependencies run downward only |

Why not rely on ESLint alone: `no-restricted-imports` matches the *specifier
string*, so it can forbid `**/features/**` but cannot tell `../batch-expiry`
(a sibling plugin — forbidden) from `../field-helpers` (inside the same
plugin — fine). Resolving to a path removes the ambiguity.

Exits non-zero on any violation, listing the importing file, the specifier,
and the rule that was broken.

---

## `validate-migrations.mjs` — schema validation

`validate-migrations.mjs` is the single schema check. It applies every file in
`supabase/migrations/` and `supabase/seed/`, in filename order, to a real
Postgres engine (PGlite — Postgres compiled to WASM), then runs assertions
against the resulting database.

This is what keeps the schema honest: a broken foreign key, a malformed RLS
policy, a plpgsql syntax error or a bad function signature fails here rather
than on the owner's machine.

```bash
npm run validate:migrations
```

## What it verifies

**Structural**

- All 18 migrations and both seeds apply cleanly
- Table count, RLS policy count, and the presence of the 23 API functions
- `app.tables_missing_rls()` returns empty — a new table cannot ship unprotected
- The Mermaid ERD in `docs/04` names no table the migrations fail to create

**Behavioral**

- An unbalanced `stock_movements` row is rejected by the `CHECK`
- `stock_movements` is append-only (`UPDATE` raises)
- A second open session on one register is rejected
- Money columns are `numeric`, never `float`
- `sales.profit` is a generated column
- A product cannot have two default variants
- `next_sequence` is monotonic and gap-free

**End to end** — a real sale against the seeded organization:

- The signed-in owner resolves their organization and holds `sales.create`
- Stock in → register open → `complete_sale`
- Sale completes, total is right, invoice number is formatted
- Stock decrements and the ledger balances (`before + delta = after`)
- Profit is captured at sale time
- A `sale.completed` event lands in the outbox
- The register records the cash
- **Overselling is rejected by the database**
- A user outside the organization is refused
- A cashier holds `sales.create` but not `sales.refund`

## Known skips

PGlite has no `pg_trgm`, so `CREATE EXTENSION pg_trgm` and the three trigram
indexes are skipped — four statements. They are valid on real
Postgres/Supabase; Supabase ships the extension.

## Shared code

`sql-split.mjs` splits SQL into statements while honouring `$$` dollar-quoting,
single-quoted strings and both comment forms. A naive `split(';')` corrupts
every plpgsql function body.

## On the design docs

`docs/04-database-design.md` contains illustrative DDL. **The migrations are
the authoritative schema.** The docs explain the design; if the two disagree,
the migration is correct and the doc is stale.
