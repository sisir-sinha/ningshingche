/**
 * Builds `supabase/schema.sql` — the whole schema in one file.
 *
 * The migrations remain the source of truth: this is a faithful, in-order
 * concatenation with a header, generated so the schema can be read (or
 * applied elsewhere) without paging through 22 files. Regenerate after any
 * migration change:
 *
 *     npm run build:schema
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')
const OUT = join(ROOT, 'supabase', 'schema.sql')

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
if (files.length === 0) {
  console.error('no migrations found — nothing to build')
  process.exit(1)
}

const header = `-- Mekholi — full database schema.
--
-- GENERATED FILE — do not edit. Built by tools/build-schema.mjs from the
-- migrations in supabase/migrations/, which remain the source of truth.
-- Regenerate with: npm run build:schema
--
-- ${files.length} migrations concatenated in order. Running this file on a
-- fresh Postgres 15+ database (with the Supabase roles and auth schema
-- present) produces the same schema the migrations do.

`

const parts = files.map((file) => {
  const body = readFileSync(join(MIGRATIONS, file), 'utf8')
  return `-- ══════════════════════════════════════════════════════════════════════
-- ${file}
-- ══════════════════════════════════════════════════════════════════════

${body.trimEnd()}
`
})

writeFileSync(OUT, header + parts.join('\n'))
const bytes = readFileSync(OUT).length
console.log(`supabase/schema.sql — ${files.length} migrations, ${(bytes / 1024).toFixed(0)} KB`)
