// Cross-checks the Mermaid ERD in doc 04 against the tables the DDL creates.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const doc = readFileSync(process.argv[2] ?? 'docs/04-database-design.md', 'utf8')
const erd = doc.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? ''

// Collect entity names from relationship lines: `A ||--o{ B : label`
const entities = new Set()
for (const line of erd.split('\n')) {
  const m = line.match(/^\s*(\w+)\s+([|o{}]+--+[|o{}]+)\s+(\w+)\s*:/)
  if (m) { entities.add(m[1]); entities.add(m[3]) }
}

const db = new PGlite()
await db.exec(`CREATE SCHEMA auth`)
await db.exec(`CREATE TABLE auth.users (id uuid PRIMARY KEY, email text)`)
await db.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT null::uuid $$`)
await db.exec(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$`)

// Reuse the validator's extraction by shelling out would duplicate logic;
// instead re-run the same fixpoint here.
const blocks = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map(m => m[1].trim())
function split(sql) {
  const out = []; let cur = '', i = 0
  while (i < sql.length) {
    const c = sql[i], two = sql.slice(i, i + 2)
    if (two === '--') { const n = sql.indexOf('\n', i); const e = n === -1 ? sql.length : n; cur += sql.slice(i, e); i = e; continue }
    if (two === '/*') { const e = sql.indexOf('*/', i + 2); const s2 = e === -1 ? sql.length : e + 2; cur += sql.slice(i, s2); i = s2; continue }
    if (two === '$$') { const e = sql.indexOf('$$', i + 2); const s2 = e === -1 ? sql.length : e + 2; cur += sql.slice(i, s2); i = s2; continue }
    if (c === "'") { let j = i + 1; while (j < sql.length) { if (sql[j] === "'") { if (sql[j+1] === "'") { j += 2; continue } break } j++ } cur += sql.slice(i, j+1); i = j+1; continue }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue }
    cur += c; i++
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
let stmts = blocks.flatMap(split)
await db.exec(`SET check_function_bodies = off`)
let pending = stmts, prog = true
while (prog && pending.length) {
  prog = false; const rest = []
  for (const s of pending) {
    if (/gin_trgm_ops|pg_trgm|\$\d|\bv_org\b/.test(s)) continue
    try { await db.exec(s); prog = true } catch { rest.push(s) }
  }
  pending = rest
}

const { rows } = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)
const created = new Set(rows.map(r => r.table_name))

const KNOWN_EXTERNAL = new Set(['users'])  // auth.users, provided by Supabase

const missing = [...entities].filter(e => !created.has(e) && !KNOWN_EXTERNAL.has(e))
const notInErd = [...created].filter(t => !entities.has(t) && !t.startsWith('plg_'))

console.log(`ERD entities:        ${entities.size}`)
console.log(`tables created:      ${created.size}`)
console.log(`\nIn ERD but NOT created by DDL: ${missing.length ? missing.join(', ') : '(none)'}`)
console.log(`Created but not drawn in ERD:  ${notInErd.length ? notInErd.join(', ') : '(none)'}`)
await db.close()
