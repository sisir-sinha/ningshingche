/**
 * Checks the live database's function permissions against the rules the
 * migrations claim to enforce.
 *
 * Why this is a tool and not a test: every other check in this repo runs
 * against a throwaway PGlite database, which executes as the owner and
 * therefore cannot see a permission at all. The rules below are *only* visible
 * in a real database with the real roles — which is exactly why they went
 * unnoticed until 042 was written, and exactly why they need a check that can
 * be re-run after every plugin.
 *
 * It reads and never writes. Three questions:
 *
 *   1. Can an anonymous caller execute a function? (`npm run check:acl`)
 *      Postgres grants EXECUTE on every new function to PUBLIC, and PUBLIC is
 *      inherited by anon. Migration 018 revoked that once; every migration
 *      after it — including each plugin's embedded SQL — reopened it. So the
 *      answer must be "none in `public`", and "only the RLS helpers in `app`".
 *
 *   2. Does anything the client actually calls depend on that default?
 *      A blanket `revoke … from public` is only safe where the intended
 *      surface holds its *own* grant. This reads the ACLs (`authenticated=X`
 *      must be an explicit entry) for every RPC name found in `src/`, so a
 *      future migration that forgets to grant cannot be mistaken for a
 *      security fix.
 *
 *   4. What happens to a function created tomorrow? (Reported, not asserted.)
 *      Postgres's built-in default for a function grants EXECUTE to PUBLIC,
 *      and default privileges are *additive* over it — `alter default
 *      privileges … revoke … from public` removes nothing (measured; 043 has
 *      the numbers). A new function therefore starts world-executable, and
 *      what keeps the database safe is the plugin host closing the world grant
 *      as it creates them, plus rule 1 above. This section prints the recorded
 *      defaults so the situation is visible rather than assumed.
 *
 *   3. Can the roles that run RLS policies execute the functions inside them?
 *      Policy expressions run as the querying role, so an `app.*` helper used
 *      in a policy must be executable by `anon`/`authenticated` — otherwise an
 *      anonymous read returns `42501 permission denied for function` instead of
 *      the empty result the policy intends (the reason 020 granted three
 *      helpers to anon in the first place).
 *
 * Usage:
 *   node tools/check-db-acl.mjs          check; exit 1 on any violation
 *   node tools/check-db-acl.mjs --report  also list the full function surface
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import dns from 'node:dns'
import pg from 'pg'

dns.setDefaultResultOrder('ipv4first')

const ROOT = join(import.meta.dirname, '..')
const SHOW_REPORT = process.argv.includes('--report')

// The only functions an anonymous caller may reach: RLS policy helpers, which
// answer `false`/`{}` for a caller with no organization (docs: migration 020).
const ANON_APP_ALLOWLIST = ['in_org', 'has_permission', 'visible_branch_ids']

// ── Credentials ───────────────────────────────────────────────────────────

function loadEnvDb() {
  const path = join(ROOT, '.env.db')
  if (!existsSync(path)) {
    console.log('no .env.db — skipping the live ACL check (nothing to connect to)')
    process.exit(0)
  }
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf('=')
    if (at > 0) out[trimmed.slice(0, at)] = trimmed.slice(at + 1)
  }
  return out
}

// ── The RPCs the client calls, read from the source ───────────────────────

function sourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full)
  }
  return out
}

function clientRpcs() {
  const names = new Set()
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\.rpc\(\s*'([a-z_]+)'/g)) names.add(match[1])
  }
  return [...names].sort()
}

// ── Run ───────────────────────────────────────────────────────────────────

const env = loadEnvDb()
const client = new pg.Client({
  host: env.MEKHOLI_DB_HOST,
  port: Number(env.MEKHOLI_DB_PORT ?? 5432),
  user: env.MEKHOLI_DB_USER,
  password: env.MEKHOLI_DB_PASSWORD,
  database: env.MEKHOLI_DB_NAME ?? 'postgres',
  ssl: { rejectUnauthorized: false },
})

const problems = []
const note = (message) => problems.push(message)

try {
  await client.connect()
  const q = async (sql, params) => (await client.query(sql, params)).rows

  const applied = (await q(
    'select count(*)::int as n from supabase_migrations.schema_migrations'
  ))[0].n
  console.log(`applied migrations: ${applied}`)

  // ── 1. Anonymous reach ──────────────────────────────────────────────────
  // Scoped to the functions this project owns, because that is the part a
  // migration can change: `pg_trgm`'s helpers are owned by `supabase_admin`,
  // and the migrations run as `postgres` (not a superuser), so `revoke` on
  // them does nothing and reports nothing. They take their input as arguments
  // and cannot read a table. Everything else must be unreachable without a
  // session — and the three RLS helpers in `app` are reachable on purpose,
  // because policy expressions run as the querying role (migration 020).
  const runner = (await q('select current_user as role'))[0].role
  const anonReach = await q(`
    select n.nspname as schema, p.proname, r.rolname as owner,
           exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') as extension
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
     where n.nspname in ('public', 'app') and p.prokind = 'f'
       and has_function_privilege('anon', p.oid, 'EXECUTE')
     order by n.nspname, r.rolname, p.proname`)

  const ours = anonReach.filter((row) => row.owner === runner)
  const foreign = anonReach.filter((row) => row.owner !== runner)

  console.log(`\nanonymous reach (functions owned by ${runner}):`)
  if (ours.length === 0) console.log('  nothing')
  for (const row of ours) console.log(`  ${row.schema}.${row.proname}`)
  for (const row of ours) {
    if (row.schema === 'app' && ANON_APP_ALLOWLIST.includes(row.proname)) continue
    note(
      `anon can execute ${row.schema}.${row.proname}() — 042 requires that only the ` +
        `RLS helpers (${ANON_APP_ALLOWLIST.join(', ')}) be reachable without a session`
    )
  }
  for (const name of ANON_APP_ALLOWLIST) {
    if (!ours.some((row) => row.schema === 'app' && row.proname === name)) {
      note(
        `anon cannot execute app.${name}() — an RLS policy calls it, so an anonymous ` +
          `read would fail with 42501 instead of returning no rows`
      )
    }
  }
  if (foreign.length > 0) {
    const byOwner = new Map()
    for (const row of foreign) byOwner.set(row.owner, (byOwner.get(row.owner) ?? 0) + 1)
    const summary = [...byOwner].map(([owner, count]) => `${count} owned by ${owner}`).join(', ')
    const allExtensions = foreign.every((row) => row.extension === true)
    console.log(`\nreachable but not ours: ${foreign.length} (${summary})`)
    console.log(
      `  all belong to an extension: ${allExtensions} — extensions cannot be revoked by ` +
        `${runner}, and their functions take their input as arguments`
    )
    if (!allExtensions) {
      for (const row of foreign.filter((r) => r.extension !== true)) {
        note(
          `${row.schema}.${row.proname}() is reachable by anon, is not ours and belongs to no ` +
            `extension — nothing can revoke it from here, and nobody owns it either`
        )
      }
    }
  }

  // ── 2. Does the app's own surface hold explicit grants? ─────────────────
  const rpcs = clientRpcs()
  const aclRows = await q(
    `select p.proname, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.proname = any($1::text[])
      group by p.proname, p.proacl`,
    [rpcs]
  )

  const onDefault = []
  for (const name of rpcs) {
    const versions = aclRows.filter((row) => row.proname === name)
    if (versions.length === 0) continue // a plugin RPC, absent until enabled
    const explicit = versions.every((row) => (row.acl ?? '').includes('authenticated=X'))
    if (!explicit) onDefault.push(name)
  }

  console.log(`\nRPCs called from src/: ${rpcs.length}`)
  if (onDefault.length > 0) {
    console.log(`  relying on the PUBLIC default (a revoke would take them away):`)
    for (const name of onDefault) console.log(`    ${name}`)
    note(
      `${onDefault.length} RPC(s) the client calls have no explicit grant to authenticated: ` +
        onDefault.join(', ')
    )
  } else {
    console.log('  every one holds its own grant to authenticated')
  }

  // ── 3. Policies may only call what both roles can execute ───────────────
  const policies = await q(
    `select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public'`
  )
  const policyFns = new Map()
  for (const row of policies) {
    const text = `${row.qual ?? ''} ${row.with_check ?? ''}`
    for (const match of text.matchAll(/\b(app|public)\.([a-z_]+)\(/g)) {
      policyFns.set(`${match[1]}.${match[2]}`, (policyFns.get(`${match[1]}.${match[2]}`) ?? 0) + 1)
    }
  }

  console.log(`\nRLS policies: ${policies.length}, calling ${policyFns.size} function(s):`)
  for (const [fn, count] of [...policyFns].sort()) {
    const [schema, name] = fn.split('.')
    const rows = await q(
      `select has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = $1 and p.proname = $2`,
      [schema, name]
    )
    if (rows.length === 0) {
      note(`a policy calls ${fn}(), which does not exist`)
      continue
    }
    const auth = rows.every((row) => row.auth === true)
    const anon = rows.every((row) => row.anon === true)
    console.log(`  ${fn.padEnd(24)} ${count} expression(s)  authenticated=${auth} anon=${anon}`)
    if (!auth) note(`a policy calls ${fn}(), which authenticated cannot execute`)
    if (!anon && schema === 'app') note(`a policy calls ${fn}(), which anon cannot execute`)
  }

  // ── 4. What a function created tomorrow would look like ─────────────────
  // Reported, not asserted, and the reason is the whole point of 043:
  // `acldefault('f')` grants EXECUTE to PUBLIC, and a stored default ACL is
  // *merged* with it, never subtracted from it — so on this platform a new
  // function always starts world-executable and no default-privilege statement
  // can change that. (A table is different: `acldefault('r')` grants the world
  // nothing, which is why Supabase's table defaults do stick.)
  //
  // So the safety of the database does not rest here. It rests on rule 1 —
  // nothing we own is reachable by an anonymous caller — which is asserted,
  // and on the plugin host, which revokes PUBLIC and anon from every function
  // a plugin creates (`app.plugin_close_world_grants`, 043). This prints what
  // is recorded so that a future reader does not have to guess.
  const defaults = await q(`
    select r.rolname as owner, n.nspname as schema,
           case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
      join pg_roles r on r.oid = d.defaclrole
      cross join lateral aclexplode(d.defaclacl) a
     where d.defaclobjtype = 'f' and n.nspname in ('public', 'app')
     order by r.rolname, n.nspname, grantee`)

  console.log(`\nfunction default privileges recorded for ${runner}:`)
  const mine = defaults.filter((row) => row.owner === runner)
  if (mine.length === 0) console.log('  (none recorded — the built-in default applies)')
  for (const row of mine) console.log(`  ${row.schema}: ${row.grantee}`)

  const hostWired = await q(`
    select pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'plugin_apply_migrations'`)
  const wired = /^\s*perform\s+app\.plugin_close_world_grants\s*\(/m.test(
    String(hostWired[0]?.body ?? '')
  )
  console.log(
    `  the plugin host closes world grants on what a plugin creates: ${wired ? 'yes' : 'NO'}`
  )
  if (!wired) {
    note(
      'app.plugin_apply_migrations does not call app.plugin_close_world_grants, so a plugin ' +
        'that forgets to revoke leaves an anonymous-callable function behind (043)'
    )
  }

  // ── Optional full surface ───────────────────────────────────────────────
  if (SHOW_REPORT) {
    const all = await q(`
      select n.nspname, p.proname,
             coalesce(p.proacl::text, '(default: PUBLIC)') as acl
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'app') and p.prokind = 'f'
       order by n.nspname, p.proname`)
    console.log(`\nfull function surface (${all.length}):`)
    for (const row of all) {
      console.log(`  ${`${row.nspname}.${row.proname}`.padEnd(38)} ${row.acl.slice(0, 100)}`)
    }
  }
} catch (error) {
  note(`the check could not run: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await client.end().catch(() => undefined)
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  · ${problem}`)
  process.exit(1)
}
console.log('\nACL check: clean')
