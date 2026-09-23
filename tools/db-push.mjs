/**
 * Applies supabase/migrations/ to a real Supabase database.
 *
 * Why this exists alongside `supabase db push`: the CLI needs either an access
 * token or a linked project, and it will not run in an environment without
 * them. This script needs only `.env.db` and a network route to the pooler.
 * It writes to `supabase_migrations.schema_migrations` in the same shape the
 * CLI uses, so the two can be interchanged later.
 *
 * Usage:
 *   node tools/db-push.mjs            apply pending migrations
 *   node tools/db-push.mjs --status   show what is applied and what is not
 *   node tools/db-push.mjs --seed     also run supabase/seed/ (idempotent)
 *   node tools/db-push.mjs --force    re-run everything, ignoring the ledger
 *
 * Connection notes:
 *  - Port 5432 (session mode), never 6543. Migrations run DDL and
 *    `alter publication`, and transaction-mode pooling breaks both.
 *  - `ssl` is required against Supabase; the pooler presents a valid cert but
 *    we do not pin a CA here.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import dns from 'node:dns'
import pg from 'pg'
import { splitStatements } from './sql-split.mjs'

const { Client } = pg

// Many sandboxes have no IPv6 route and Supabase's direct host is IPv6-only.
dns.setDefaultResultOrder('ipv4first')

const ROOT = join(import.meta.dirname, '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const SEED_DIR = join(ROOT, 'supabase', 'seed')

const ARGS = new Set(process.argv.slice(2))
const SHOW_STATUS = ARGS.has('--status')
const WITH_SEED = ARGS.has('--seed')
const FORCE = ARGS.has('--force')

// ── Credentials ───────────────────────────────────────────────────────────

function loadEnvDb() {
  const path = join(ROOT, '.env.db')
  if (!existsSync(path)) {
    console.error(
      'missing .env.db\n\n' +
        'Create it (it is gitignored) with:\n' +
        '  MEKHOLI_DB_HOST=aws-0-<region>.pooler.supabase.com\n' +
        '  MEKHOLI_DB_PORT=5432\n' +
        '  MEKHOLI_DB_USER=postgres.<project-ref>\n' +
        '  MEKHOLI_DB_PASSWORD=<database password>\n' +
        '  MEKHOLI_DB_NAME=postgres\n'
    )
    process.exit(1)
  }
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf('=')
    if (at < 0) continue
    out[trimmed.slice(0, at)] = trimmed.slice(at + 1)
  }
  const required = ['MEKHOLI_DB_HOST', 'MEKHOLI_DB_USER', 'MEKHOLI_DB_PASSWORD']
  const missing = required.filter((key) => !out[key])
  if (missing.length > 0) {
    console.error(`.env.db is missing: ${missing.join(', ')}`)
    process.exit(1)
  }
  return out
}

const env = loadEnvDb()

// ── Connect ───────────────────────────────────────────────────────────────

const client = new Client({
  host: env.MEKHOLI_DB_HOST,
  port: Number(env.MEKHOLI_DB_PORT ?? 5432),
  user: env.MEKHOLI_DB_USER,
  password: env.MEKHOLI_DB_PASSWORD,
  database: env.MEKHOLI_DB_NAME ?? 'postgres',
  connectionTimeoutMillis: 20000,
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()
} catch (error) {
  console.error(`could not connect to ${env.MEKHOLI_DB_HOST}: ${String(error.message).split('\n')[0]}`)
  process.exit(1)
}

const ident = await client.query('select current_user as u, current_database() as d, version() as v')
console.log(`connected: ${ident.rows[0].u}@${ident.rows[0].d}`)
console.log(`server:    ${String(ident.rows[0].v).split(',')[0]}\n`)

// ── Ledger ────────────────────────────────────────────────────────────────
// Same schema the Supabase CLI uses, so `supabase migration list` stays
// meaningful if the project is ever linked to the CLI.

await client.query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version    text primary key,
    statements text[],
    name       text,
    applied_at timestamptz not null default now()
  );
`)

const appliedRows = await client.query(
  'select version from supabase_migrations.schema_migrations'
)
const applied = new Set(appliedRows.rows.map((r) => r.version))

function filesIn(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

const migrations = filesIn(MIGRATIONS_DIR)
const pending = migrations.filter((f) => FORCE || !applied.has(f.replace(/\.sql$/, '')))

// ── Status ────────────────────────────────────────────────────────────────

if (SHOW_STATUS) {
  console.log('migrations:')
  for (const file of migrations) {
    const version = file.replace(/\.sql$/, '')
    console.log(`  ${applied.has(version) ? '✓ applied ' : '· pending '} ${file}`)
  }
  console.log(`\n${applied.size}/${migrations.length} applied, ${pending.length} pending`)

  const tables = await client.query(`
    select count(*)::int as n from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`)
  const policies = await client.query(
    `select count(*)::int as n from pg_policies where schemaname = 'public'`
  )
  console.log(`public tables: ${tables.rows[0].n}   RLS policies: ${policies.rows[0].n}`)
  await client.end()
  process.exit(0)
}

if (pending.length === 0) {
  console.log('nothing to apply — all migrations already recorded')
} else {
  console.log(`applying ${pending.length} migration(s):\n`)
}

// ── Apply ─────────────────────────────────────────────────────────────────

let failures = 0
let statements = 0

for (const file of pending) {
  const version = file.replace(/\.sql$/, '')
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
  const parts = splitStatements(sql)

  await client.query('begin')
  try {
    for (const statement of parts) {
      await client.query(statement)
      statements += 1
    }
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, statements, name)
       values ($1, $2, $3)
       on conflict (version) do update set applied_at = now()`,
      [version, parts, version]
    )
    await client.query('commit')
    console.log(`  ✓ ${file}  (${parts.length} statements)`)
  } catch (error) {
    await client.query('rollback')
    failures += 1
    const first = String(error.message).split('\n')[0]
    console.log(`  ✗ ${file}\n      ${first}`)
    if (error.position) {
      const at = Number(error.position)
      console.log(`      near: ${sql.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' ')}`)
    }
    // Stop rather than apply later migrations on top of a broken base.
    break
  }
}

// ── Seeds ─────────────────────────────────────────────────────────────────

if (WITH_SEED && failures === 0) {
  const seeds = filesIn(SEED_DIR)
  console.log(`\nrunning ${seeds.length} seed file(s) — these must be idempotent:\n`)
  for (const file of seeds) {
    const parts = splitStatements(readFileSync(join(SEED_DIR, file), 'utf8'))
    await client.query('begin')
    try {
      for (const statement of parts) await client.query(statement)
      await client.query('commit')
      console.log(`  ✓ ${file}  (${parts.length} statements)`)
    } catch (error) {
      await client.query('rollback')
      failures += 1
      console.log(`  ✗ ${file}\n      ${String(error.message).split('\n')[0]}`)
      break
    }
  }
}

// ── Reload PostgREST ──────────────────────────────────────────────────────
// PostgREST caches the schema. Applying DDL by direct SQL bypasses the reload
// the Supabase CLI would normally trigger, and the API keeps serving a stale
// (or empty) schema until it is told otherwise. Without this, newly added
// functions answer 404 no matter what the grants say.
if (failures === 0) {
  await client.query(`notify pgrst, 'reload schema'`)
  await client.query(`notify pgrst, 'reload config'`)
  console.log('\nnotified PostgREST to reload its schema cache')
}

// ── Summary ───────────────────────────────────────────────────────────────

const tables = await client.query(`
  select count(*)::int as n from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE'`)
const policies = await client.query(
  `select count(*)::int as n from pg_policies where schemaname = 'public'`)
const missingRls = await client.query(`select * from app.tables_missing_rls()`)

console.log(`\nstatements run:  ${statements}`)
console.log(`failures:        ${failures}`)
console.log(`public tables:   ${tables.rows[0].n}`)
console.log(`RLS policies:    ${policies.rows[0].n}`)
console.log(`tables w/o RLS:  ${missingRls.rows.length}`)
if (missingRls.rows.length > 0) {
  console.log(`  → ${missingRls.rows.map((r) => r.table_name).join(', ')}`)
}

await client.end()

if (failures > 0) {
  console.log('\nfailed — see above')
  process.exit(1)
}
console.log('\ndone')
