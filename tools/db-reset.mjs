/**
 * Drops the public schema's contents and re-applies every migration + seed.
 *
 * This is the hosted-database equivalent of `supabase db reset`, which needs a
 * local stack. It is DESTRUCTIVE: everything in `public` goes.
 *
 * It does NOT touch:
 *   - `auth.*`      — user accounts survive; they can still sign in
 *   - `storage.*`   — uploaded files survive
 *   - `realtime.*`, `extensions.*`, `pgsodium*`, `vault.*`
 *
 * It does drop the trigger on `auth.users` that points into `public`, because
 * leaving it would break every future signup once its function is gone.
 *
 * Usage:  node tools/db-reset.mjs --yes
 * The --yes flag is required; without it the script prints what it would drop
 * and exits.
 */

import dns from 'node:dns'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { splitStatements } from './sql-split.mjs'

const { Client } = pg
dns.setDefaultResultOrder('ipv4first')

const ROOT = join(import.meta.dirname, '..')
const CONFIRMED = process.argv.includes('--yes')

function loadEnv() {
  const path = join(ROOT, '.env.db')
  if (!existsSync(path)) {
    console.error('missing .env.db — see tools/db-push.mjs for the format')
    process.exit(1)
  }
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const at = t.indexOf('=')
    if (at > 0) out[t.slice(0, at)] = t.slice(at + 1)
  }
  return out
}

const env = loadEnv()
const client = new Client({
  host: env.MEKHOLI_DB_HOST,
  port: Number(env.MEKHOLI_DB_PORT ?? 5432),
  user: env.MEKHOLI_DB_USER,
  password: env.MEKHOLI_DB_PASSWORD,
  database: env.MEKHOLI_DB_NAME ?? 'postgres',
  connectionTimeoutMillis: 20000,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
const ident = await client.query('select current_database() as d')
console.log(`connected to ${ident.rows[0].d}\n`)

// ── Inventory ─────────────────────────────────────────────────────────────

const tables = (
  await client.query(`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by 1`)
).rows.map((r) => r.table_name)

// Functions owned by an extension (pg_trgm and friends) must be left alone —
// dropping them breaks the extension.
const functions = (
  await client.query(`
    select n.nspname || '.' || p.proname || '(' ||
           pg_get_function_identity_arguments(p.oid) || ')' as sig,
           p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
     where n.nspname in ('public', 'app') and d.objid is null
     order by 1`)
).rows

// Triggers on auth.users that call into public — these would break on signup.
const authTriggers = (
  await client.query(`
    select trigger_name from information_schema.triggers
     where event_object_schema = 'auth' and event_object_table = 'users'
     group by trigger_name`)
).rows.map((r) => r.trigger_name)

console.log(`would drop: ${tables.length} table(s), ${functions.length} function(s), ${authTriggers.length} auth.users trigger(s)`)
if (tables.length > 0) console.log(`  tables:    ${tables.join(', ')}`)
if (authTriggers.length > 0) console.log(`  triggers:  ${authTriggers.join(', ')}`)

if (!CONFIRMED) {
  console.log('\nnothing dropped — re-run with --yes to confirm')
  await client.end()
  process.exit(0)
}

// ── Drop ──────────────────────────────────────────────────────────────────

console.log('\ndropping:')

for (const trigger of authTriggers) {
  try {
    await client.query(`drop trigger if exists "${trigger}" on auth.users`)
    console.log(`  ✓ trigger auth.users.${trigger}`)
  } catch (error) {
    console.log(`  ✗ trigger auth.users.${trigger}: ${String(error.message).split('\n')[0]}`)
  }
}

// Cascade handles foreign keys, indexes, RLS policies and row triggers.
for (const table of tables) {
  try {
    await client.query(`drop table if exists public."${table}" cascade`)
  } catch (error) {
    console.log(`  ✗ table ${table}: ${String(error.message).split('\n')[0]}`)
  }
}
console.log(`  ✓ ${tables.length} table(s)`)

for (const fn of functions) {
  try {
    await client.query(`drop function if exists ${fn.sig} cascade`)
  } catch (error) {
    console.log(`  ✗ function ${fn.sig}: ${String(error.message).split('\n')[0]}`)
  }
}
console.log(`  ✓ ${functions.length} function(s)`)

// Sequences left behind by dropped tables.
const sequences = (
  await client.query(`
    select sequence_name from information_schema.sequences
     where sequence_schema = 'public' order by 1`)
).rows
for (const seq of sequences) {
  await client.query(`drop sequence if exists public."${seq.sequence_name}" cascade`)
}
if (sequences.length > 0) console.log(`  ✓ ${sequences.length} sequence(s)`)

// Custom types — enums and domains — belong to no table and no function, so
// they survive everything dropped above. Leaving them behind makes the
// re-apply fail immediately: migration 006 opens with
// `create type public.stock_movement_type` and dies with
// "type already exists". Only ours are dropped; a type owned by an extension
// must be left alone for the same reason as its functions.
const customTypes = (
  await client.query(`
    select t.typname, t.typtype
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      left join pg_depend d on d.objid = t.oid and d.deptype = 'e'
     where n.nspname = 'public'
       and t.typtype in ('e', 'd')
       and d.objid is null
     order by 1`)
).rows
for (const type of customTypes) {
  const keyword = type.typtype === 'd' ? 'domain' : 'type'
  try {
    await client.query(`drop ${keyword} if exists public."${type.typname}" cascade`)
  } catch (error) {
    console.log(`  ✗ ${keyword} ${type.typname}: ${String(error.message).split('\n')[0]}`)
  }
}
if (customTypes.length > 0) {
  console.log(`  ✓ ${customTypes.length} custom type(s): ${customTypes.map((t) => t.typname).join(', ')}`)
}

// The `app` schema holds only our helpers, so it can go entirely.
await client.query('drop schema if exists app cascade')
await client.query('truncate table supabase_migrations.schema_migrations')
console.log('  ✓ app schema and migration ledger')

// ── Re-apply ──────────────────────────────────────────────────────────────

const MIG = join(ROOT, 'supabase', 'migrations')
const SEED = join(ROOT, 'supabase', 'seed')
const { readdirSync } = await import('node:fs')

const apply = async (dir, label) => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  console.log(`\napplying ${files.length} ${label}:`)
  let ok = 0
  for (const file of files) {
    const parts = splitStatements(readFileSync(join(dir, file), 'utf8'))
    await client.query('begin')
    try {
      for (const statement of parts) await client.query(statement)
      if (dir === MIG) {
        await client.query(
          `insert into supabase_migrations.schema_migrations (version, statements, name)
           values ($1, $2, $1) on conflict (version) do update set applied_at = now()`,
          [file.replace(/\.sql$/, ''), parts]
        )
      }
      await client.query('commit')
      ok += 1
      console.log(`  ✓ ${file}  (${parts.length})`)
    } catch (error) {
      await client.query('rollback')
      console.log(`  ✗ ${file}\n      ${String(error.message).split('\n')[0]}`)
      await client.end()
      process.exit(1)
    }
  }
  return ok
}

await apply(MIG, 'migration(s)')
await apply(SEED, 'seed file(s)')

// ── Reload PostgREST ──────────────────────────────────────────────────────
// See tools/db-push.mjs: direct SQL does not trigger the cache reload that the
// Supabase CLI performs, so the API serves a stale schema without this.
await client.query(`notify pgrst, 'reload schema'`)
await client.query(`notify pgrst, 'reload config'`)
console.log('\nnotified PostgREST to reload its schema cache')

// ── Verify ────────────────────────────────────────────────────────────────

const after = await client.query(`
  select
    (select count(*)::int from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE') as tables,
    (select count(*)::int from pg_policies where schemaname='public') as policies`)
const missing = await client.query('select * from app.tables_missing_rls()')

console.log(`\npublic tables:  ${after.rows[0].tables}`)
console.log(`RLS policies:   ${after.rows[0].policies}`)
console.log(`tables w/o RLS: ${missing.rows.length}${missing.rows.length ? ' → ' + missing.rows.map((r) => r.table_name).join(', ') : ''}`)

const remaining = await client.query('select count(*)::int as n from auth.users')
console.log(`auth.users:     ${remaining.rows[0].n} (untouched)`)

await client.end()
console.log('\nreset complete')
