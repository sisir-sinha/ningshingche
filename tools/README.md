# Validation tools

Four tools: two check the code, two operate on a real database.

```bash
npm run validate:migrations   # the schema is real and behaves   (local, PGlite)
npm run check:boundaries      # the architecture holds           (local, no DB)
npm run db:status             # what is applied on the live project
npm run db:push               # apply pending migrations to the live project
npm run db:reset              # DESTRUCTIVE: drop public, re-apply everything
```

---

## `db-push.mjs` / `db-reset.mjs` — operating on a real Supabase project

These are the hosted equivalent of `supabase db push` and `supabase db reset`,
which both need either an access token or a local stack. These need only
`.env.db` (gitignored) and a network route to the pooler.

```
MEKHOLI_DB_HOST=aws-0-<region>.pooler.supabase.com
MEKHOLI_DB_PORT=5432          # session mode — never 6543
MEKHOLI_DB_USER=postgres.<project-ref>
MEKHOLI_DB_PASSWORD=<database password>
MEKHOLI_DB_NAME=postgres
```

Three things that are easy to get wrong, all handled here:

1. **Port 5432, not 6543.** Migrations run DDL and `alter publication`, which
   transaction-mode pooling breaks.
2. **IPv4.** Supabase's direct host is IPv6-only on newer projects, and many
   sandboxes have no IPv6 route. The pooler has an A record.
3. **PostgREST caches the schema.** Applying DDL by direct SQL bypasses the
   reload the Supabase CLI performs, so new functions answer `404` until the
   cache is refreshed. Both tools end with `notify pgrst, 'reload schema'`.

`db-reset.mjs` drops only `public` (plus the `app` schema). It leaves
`auth.*`, `storage.*` and `realtime.*` alone, so **user accounts survive a
reset** — they can still sign in, they simply have no shop until they
re-onboard. It also drops the trigger on `auth.users` that pointed into
`public`, because leaving it would break every future signup.

It requires `--yes` and prints an inventory first.

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
| `features/<a>/` | `features/<b>/` internals | Only `features/<b>/index.ts` is public; cross-feature needs go through shared services or events |
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
