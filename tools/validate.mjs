#!/usr/bin/env node
// Extracts ```sql blocks from the design docs and applies them to a real
// Postgres (PGlite, WASM build) to prove the DDL is valid.
//
// Usage: node tools/validate-schema.mjs
//
// Blocks are applied in MIGRATION order (doc 04 §13), not narrative order —
// the narrative groups tables by topic, migrations group them by dependency.

import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const DOC = process.argv[2] ?? 'docs/04-database-design.md'
const src = readFileSync(DOC, 'utf8')

// Pull out every fenced sql block, in document order.
const blocks = []
const re = /```sql\n([\s\S]*?)```/g
let m
while ((m = re.exec(src)) !== null) blocks.push(m[1].trim())

// Split a block into statements, honouring $$ dollar-quoting, 'strings',
// -- comments and /* */ comments.
function splitStatements(sql) {
  const out = []
  let cur = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const two = sql.slice(i, i + 2)
    if (two === '--') {
      const nl = sql.indexOf('\n', i)
      const end = nl === -1 ? sql.length : nl
      cur += sql.slice(i, end)
      i = end
      continue
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? sql.length : end + 2
      cur += sql.slice(i, stop)
      i = stop
      continue
    }
    if (two === '$$') {
      const end = sql.indexOf('$$', i + 2)
      const stop = end === -1 ? sql.length : end + 2
      cur += sql.slice(i, stop)
      i = stop
      continue
    }
    if (c === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue }
          break
        }
        j++
      }
      cur += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      i++
      continue
    }
    cur += c
    i++
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

// Flatten to a single statement list, keeping a label for each.
const statements = []
blocks.forEach((b, bi) => {
  for (const s of splitStatements(b)) {
    const label = s.split('\n').find((l) => l.trim() && !l.trim().startsWith('--')) ?? ''
    statements.push({ block: bi, label: label.trim().slice(0, 90), sql: s })
  }
})

// Strip leading comment lines so `-- note\nCREATE TABLE x` classifies as a
// table, not as "other".
function stripLeadingComments(sql) {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .trim()
}

// Identify each statement by the object it creates, so we can reorder.
function keyOf(s) {
  const t = stripLeadingComments(s.sql)
  const grab = (re) => (t.match(re)?.[1] ?? '').toLowerCase()
  if (/^create\s+(or\s+replace\s+)?function/i.test(t)) return 'fn:' + grab(/function\s+([\w.]+)/i)
  if (/^create\s+type/i.test(t)) return 'type:' + grab(/type\s+(\w+)/i)
  if (/^create\s+table/i.test(t)) return 'tbl:' + grab(/table\s+(?:if\s+not\s+exists\s+)?([\w.]+)/i)
  if (/^create\s+(unique\s+)?index/i.test(t)) return 'idx:' + grab(/index\s+(?:concurrently\s+)?(\w+)/i)
  if (/^create\s+schema/i.test(t)) return 'schema:' + grab(/schema\s+(?:if\s+not\s+exists\s+)?(\w+)/i)
  if (/^create\s+extension/i.test(t)) return 'ext:' + grab(/extension\s+(?:if\s+not\s+exists\s+)?(\w+)/i)
  if (/^create\s+trigger/i.test(t)) return 'trg:' + grab(/trigger\s+(\w+)/i)
  if (/^create\s+policy/i.test(t)) return 'pol:' + grab(/policy\s+(\w+)/i)
  if (/^alter\s+table/i.test(t)) return 'alter:' + grab(/table\s+([\w.]+)/i)
  return 'other:' + s.label
}

// ---- Bootstrap stubs: things Supabase provides that PGlite does not. -------
const bootstrap = [
  `CREATE SCHEMA IF NOT EXISTS auth`,
  `CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text)`,
  // Supabase provides these; PGlite does not. Stub them so the RLS policies
  // and helpers — the security-critical part of the schema — get exercised
  // rather than skipped.
  `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
     $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$`,
  `CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
     $$ SELECT coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb $$`,
  `CREATE SCHEMA IF NOT EXISTS app`,
]

const db = new PGlite()
let trgmAvailable = false
try {
  await db.exec(`CREATE EXTENSION pg_trgm`)
  trgmAvailable = true
} catch {
  // not available; we'll skip trgm indexes and say so
}

const results = { ok: [], fail: [], skipped: [] }

async function run(sql, label) {
  try {
    await db.exec(sql)
    results.ok.push(label)
    return true
  } catch (e) {
    results.fail.push({ label, error: String(e.message ?? e).split('\n')[0] })
    return false
  }
}

for (const s of bootstrap) await run(s, 'bootstrap: ' + s.slice(0, 40))

// The narrative groups tables by topic; migrations group them by dependency.
// Rather than hardcoding an order here, apply by fixpoint: keep retrying the
// un-applied statements until a pass makes no progress. Whatever still fails
// after that is a genuine error, not an ordering artifact.
await db.exec(`SET check_function_bodies = off`) // allow forward refs in SQL functions

let pending = [...statements]
let progress = true
let passes = 0
while (progress && pending.length) {
  passes++
  progress = false
  const remaining = []
  for (const s of pending) {
    const k = keyOf(s)
    if (!trgmAvailable && (/gin_trgm_ops/.test(s.sql) || /extension\s+(if\s+not\s+exists\s+)?pg_trgm/i.test(s.sql))) {
      results.skipped.push({ label: k, reason: 'pg_trgm unavailable in WASM build' })
      progress = true
      continue
    }
    // Prose examples, not DDL: a bind-parameter query, and a fragment that
    // lives inside the complete_sale function body.
    if (/^\s*SELECT/i.test(stripLeadingComments(s.sql)) && /\$\d/.test(s.sql)) {
      results.skipped.push({ label: k, reason: 'illustrative query with bind params' })
      progress = true
      continue
    }
    if (/\bv_org\b/.test(s.sql)) {
      results.skipped.push({ label: k, reason: 'fragment from complete_sale body' })
      progress = true
      continue
    }
    try {
      await db.exec(s.sql)
      results.ok.push(k)
      progress = true
    } catch (e) {
      remaining.push({ ...s, key: k, lastError: String(e.message ?? e).split('\n')[0] })
    }
  }
  pending = remaining
}

for (const s of pending) results.fail.push({ label: s.key ?? keyOf(s), error: s.lastError })

// ---- Report -------------------------------------------------------------
console.log(`source:            ${DOC}`)
console.log(`sql blocks:        ${blocks.length}`)
console.log(`statements:        ${statements.length}`)
console.log(`pg_trgm available: ${trgmAvailable}`)
console.log(`fixpoint passes:   ${passes}`)
console.log(`applied ok:        ${results.ok.length}`)
console.log(`skipped:           ${results.skipped.length}`)
console.log(`failed:            ${results.fail.length}`)

if (results.skipped.length) {
  console.log('\n-- skipped --')
  for (const s of results.skipped) console.log(`  ${s.label}  (${s.reason})`)
}

if (results.fail.length) {
  console.log('\n-- FAILED --')
  for (const f of results.fail) console.log(`  ${f.label}\n      ${f.error}`)
  process.exitCode = 1
} else {
  console.log('\nAll applied statements succeeded.')
}

// Verify the objects we care about actually exist.
const tables = await db.query(`
  SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' ORDER BY table_name`)
console.log(`\npublic tables created: ${tables.rows.length}`)
console.log(tables.rows.map((r) => r.table_name).join(', '))

const stockCols = await db.query(`
  SELECT column_name, data_type, numeric_precision, numeric_scale
    FROM information_schema.columns
   WHERE table_name = 'sales' AND column_name IN ('total','cogs','profit','discount_value')
   ORDER BY column_name`)
console.log('\nsales money/quantity columns:')
for (const r of stockCols.rows) {
  console.log(`  ${r.column_name.padEnd(16)} ${r.data_type}(${r.numeric_precision ?? '-'},${r.numeric_scale ?? '-'})`)
}

const rls = await db.query(`
  SELECT count(*)::int AS n FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity`)
const pol = await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`)
const fns = await db.query(`
  SELECT n.nspname || '.' || p.proname AS f
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' ORDER BY 1`)
console.log(`\ntables with RLS enabled: ${rls.rows[0].n}`)
console.log(`RLS policies created:    ${pol.rows[0].n}`)
console.log(`app.* helpers:           ${fns.rows.map((r) => r.f).join(', ')}`)

await db.close()

