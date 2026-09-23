# Schema validation tools

These verify that the SQL in the design documents is real, not decorative.
They run the DDL against a genuine Postgres engine (PGlite — Postgres
compiled to WASM), so syntax errors, bad foreign keys, invalid constraint
expressions and malformed policies all fail loudly.

## Setup

```bash
npm install --no-save @electric-sql/pglite
```

## Run

```bash
node tools/validate-schema.mjs docs/04-database-design.md
node tools/erd-check.mjs       docs/04-database-design.md
```

`validate-schema.mjs` extracts every ```sql block, splits it into statements
(honouring `$$` function bodies, strings and comments) and applies them by
fixpoint until no pass makes progress. Whatever still fails is a genuine
error, not a dependency-ordering artifact.

`erd-check.mjs` cross-checks the Mermaid ERD against the tables the DDL
actually creates. "In ERD but NOT created" must always be empty — that
direction catches the diagram promising a table the schema does not have.

## Known skips

PGlite has no `pg_trgm`, so the three trigram indexes and the
`CREATE EXTENSION pg_trgm` line are skipped, not failed. They are valid on
real Postgres/Supabase. Prose snippets (a bind-parameter example query and a
fragment from the `complete_sale` body) are also skipped — they are not DDL.

Wire both into CI before Phase 1 lands.
