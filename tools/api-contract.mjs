#!/usr/bin/env node
/**
 * The API contract, generated rather than written by hand.
 *
 * `contracts/api-contract.json` is what a *client author* needs and nothing
 * more: every RPC with its parameter names, types and whether it is required;
 * every relation the clients read, with its columns and types. Two clients
 * speak to this API — TypeScript in the browser, Kotlin on Android — and they
 * must be able to develop against the same document without guessing.
 *
 * It is generated from the **database catalogue**, which is where PostgREST
 * reads its own description from. (This project's `/rest/v1/` OpenAPI document
 * is behind a secret API key, which the clients must never hold — so asking the
 * catalogue is not a workaround, it is the same truth read one step earlier.)
 * Generating it this way also proves something the OpenAPI document would not:
 * a function is only in the contract if `authenticated` may **execute** it, so
 * an accidental revoke — or an accidental grant — shows up as a contract change
 * rather than as a 403 in the field.
 *
 * Three guards keep it honest:
 *
 *   · `npm run contract:check` re-reads the live database and fails when the
 *     surface has drifted from the checked-in file.
 *   · `npm run check:clients` (offline) fails when either client names an RPC
 *     parameter or a column the contract does not have.
 *   · `npm run validate:migrations` (offline) fails when a migration defines a
 *     function the contract does not describe, so the artifact cannot quietly
 *     fall behind the schema.
 *
 * Usage:
 *   node tools/api-contract.mjs            # read the database and write the artifact
 *   node tools/api-contract.mjs --check    # fail if the artifact is stale
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACT = join(ROOT, 'contracts', 'api-contract.json')
const CHECK = process.argv.includes('--check')

/**
 * The relations the clients read. Not every table: `stock_movements` and the
 * audit log are deliberately not client-readable, and a contract that listed
 * them would invite a client to try.
 */
const CLIENT_READS = [
  'pos_catalog',
  'products',
  'product_variants',
  'product_categories',
  'brands',
  'units',
  'taxes',
  'payment_methods',
  'customers',
  'branches',
  'warehouses',
  'registers',
  'register_sessions',
  'sales',
  'sale_items',
  'product_barcodes',
  'organizations',
  'plugins',
  'plugin_state',
]

/**
 * Every function a plugin package defines.
 *
 * A plugin's SQL is applied into `public` when a shop enables the plugin, so on
 * a database where someone has enabled loyalty-lite its `loyalty_lite_award`
 * would otherwise turn up in the contract. It is not part of the contract: a
 * client reaches a plugin through `public.plugin_rpc`, by name, and the plugin's
 * own functions are checked against `supabase/plugins/` by the migration
 * validator. So they are excluded by name, whatever state the database is in.
 */
function pluginFunctionNames() {
  const names = new Set()
  const scan = (text) => {
    for (const match of text.matchAll(/create (?:or replace )?function\s+([\w.]+)/gi)) {
      names.add(match[1].split('.').pop())
    }
  }
  const pluginsDir = join(ROOT, 'supabase', 'plugins')
  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir, { recursive: true })) {
      if (String(entry).endsWith('.sql')) {
        scan(readFileSync(join(pluginsDir, String(entry)), 'utf8'))
      }
    }
  }
  // Package SQL is also embedded in migrations, inside $plg$ … $plg$ blocks,
  // which is how a plugin ships before anything enables it.
  const migrationsDir = join(ROOT, 'supabase', 'migrations')
  for (const file of readdirSync(migrationsDir)) {
    if (!file.endsWith('.sql')) continue
    const text = readFileSync(join(migrationsDir, file), 'utf8')
    for (const block of text.matchAll(/\$plg\$([\s\S]*?)\$plg\$/g)) scan(block[1])
  }
  return [...names].sort()
}

function loadEnv(file) {
  const path = join(ROOT, file)
  if (!existsSync(path)) {
    console.error(`missing ${file} — the contract is generated from the live database`)
    process.exit(1)
  }
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (line.startsWith('#') || i < 0) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const db = loadEnv('.env.db')

/**
 * The RPC surface: public functions the authenticated role may execute.
 *
 * Excluded, and each exclusion is a decision:
 *   · `trigger`-returning functions — `set_updated_at`, the audit writers —
 *     are not RPCs, and PostgREST does not expose them either.
 *   · anything `authenticated` cannot execute is not a client RPC. That is how
 *     `apply_stock_movement` (the ledger's only writer) stays out of it.
 */
const RPC_QUERY = `
select p.proname as name,
       pg_get_function_result(p.oid) as returns,
       coalesce(p.pronargdefaults, 0) as defaults,
       coalesce(
         jsonb_agg(
           jsonb_build_object(
             'name', par.parameter_name,
             'type', par.data_type,
             'mode', par.parameter_mode
           )
           order by par.ordinal_position
         ) filter (where par.parameter_name is not null),
         '[]'::jsonb
       ) as params
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join information_schema.parameters par
    on par.specific_name = p.proname || '_' || p.oid
 where n.nspname = 'public'
   and p.prokind = 'f'
   and pg_get_function_result(p.oid) not in ('trigger', 'event_trigger')
   and has_function_privilege('authenticated', p.oid, 'EXECUTE')
   -- Not the shop's API: the pg_trgm extension's own helpers live in public
   -- too, are executable by everyone, and belong to the extension. A client has
   -- no business calling them and no way to learn anything from them.
   and not exists (
     select 1 from pg_depend d
      where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
   )
   -- And not a plugin's own function: those arrive with plugin_enable.
   and p.proname <> all($1::text[])
 group by p.oid, p.proname, p.pronargdefaults
 order by p.proname
`

const RELATION_QUERY = `
select c.relname as name,
       c.relkind as kind,
       a.attname as column_name,
       format_type(a.atttypid, a.atttypmod) as type,
       a.attnotnull as not_null
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
 where n.nspname = 'public'
   and c.relname = any($1)
   and c.relkind in ('r', 'v', 'm', 'p')
   and a.attnum > 0
   and not a.attisdropped
 order by c.relname, a.attnum
`

/** Build the artifact from the two queries. */
function build(rpcRows, relationRows, version) {
  // The RPC a client calls by name. Two overloads of one name would collide, and
  // PostgREST cannot tell them apart either — so that is an error, not a merge.
  const rpc = {}
  for (const row of rpcRows) {
    if (rpc[row.name]) {
      throw new Error(
        `two SQL functions are named '${row.name}': PostgREST cannot choose between ` +
          'overloads, and neither can a client. Rename one, or drop the other signature.'
      )
    }
    const defaults = Number(row.defaults)
    const params = row.params.map((param, index) => ({
      name: param.name,
      type: param.type,
      // Postgres only allows defaults on trailing parameters, so "has a default"
      // is a property of the position, and that is exactly what a client needs
      // to know about whether it must send the argument.
      required: index < row.params.length - defaults,
    }))
    rpc[row.name] = { returns: row.returns, params }
  }

  const relations = {}
  for (const row of relationRows) {
    const entry = relations[row.name] ?? (relations[row.name] = { columns: {} })
    entry.columns[row.column_name] = row.not_null ? `${row.type} not null` : row.type
  }

  return {
    // Written by `npm run contract:pull`. Do not edit by hand: `contract:check`
    // compares it with the live database and `check:clients` compares both
    // clients with it.
    generatedFrom: db.MEKHOLI_DB_HOST ? 'live database' : 'unknown',
    generatedBy: 'tools/api-contract.mjs',
    migrations: version,
    rpc,
    relations,
  }
}

/** What changed, in the words a person reading a failure needs. */
function diff(before, after) {
  const changes = []

  const rpcNames = new Set([...Object.keys(before.rpc ?? {}), ...Object.keys(after.rpc)])
  for (const name of [...rpcNames].sort()) {
    const was = before.rpc?.[name]
    const now = after.rpc[name]
    if (!was) changes.push(`+ rpc ${name}`)
    else if (!now) changes.push(`- rpc ${name}`)
    else {
      const params = (entry) => entry.params.map((p) => p.name).join(',')
      if (params(was) !== params(now)) {
        changes.push(`~ rpc ${name} params: (${params(was)}) → (${params(now)})`)
      }
      if (was.returns !== now.returns) {
        changes.push(`~ rpc ${name} returns: ${was.returns} → ${now.returns}`)
      }
    }
  }

  const relationNames = new Set([
    ...Object.keys(before.relations ?? {}),
    ...Object.keys(after.relations),
  ])
  for (const name of [...relationNames].sort()) {
    const was = before.relations?.[name]
    const now = after.relations[name]
    if (!was) changes.push(`+ relation ${name}`)
    else if (!now) changes.push(`- relation ${name}`)
    else {
      const columns = (entry) => Object.keys(entry.columns)
      const added = columns(now).filter((column) => !columns(was).includes(column))
      const removed = columns(was).filter((column) => !columns(now).includes(column))
      if (added.length) changes.push(`~ relation ${name} + columns: ${added.join(', ')}`)
      if (removed.length) changes.push(`~ relation ${name} − columns: ${removed.join(', ')}`)
    }
  }

  return changes
}

const client = new Client({
  host: db.MEKHOLI_DB_HOST,
  port: Number(db.MEKHOLI_DB_PORT),
  user: db.MEKHOLI_DB_USER,
  password: db.MEKHOLI_DB_PASSWORD,
  database: db.MEKHOLI_DB_NAME,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
const [{ rows: rpcRows }, { rows: relationRows }] = await Promise.all([
  client.query(RPC_QUERY, [pluginFunctionNames()]),
  client.query(RELATION_QUERY, [CLIENT_READS]),
])
const applied = await client.query('select count(*)::int as n from supabase_migrations.schema_migrations')
await client.end()

const contract = build(rpcRows, relationRows, applied.rows[0].n)

if (CHECK) {
  if (!existsSync(ARTIFACT)) {
    console.error('contracts/api-contract.json is missing — run `npm run contract:pull`')
    process.exit(1)
  }
  const checkedIn = JSON.parse(readFileSync(ARTIFACT, 'utf8'))
  const changes = diff(checkedIn, contract)
  if (changes.length === 0) {
    console.log(
      `contract up to date: ${Object.keys(contract.rpc).length} RPCs, ` +
        `${Object.keys(contract.relations).length} relations`
    )
    process.exit(0)
  }
  console.error('the live surface has drifted from contracts/api-contract.json:\n')
  for (const change of changes) console.error(`  ${change}`)
  console.error('\nrun `npm run contract:pull` and commit the result')
  process.exit(1)
}

mkdirSync(dirname(ARTIFACT), { recursive: true })
writeFileSync(ARTIFACT, JSON.stringify(contract, null, 2) + '\n')

console.log(
  `wrote contracts/api-contract.json: ${Object.keys(contract.rpc).length} RPCs, ` +
    `${Object.keys(contract.relations).length} relations, migrations=${contract.migrations}`
)
