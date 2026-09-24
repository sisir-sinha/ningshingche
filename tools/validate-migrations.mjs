#!/usr/bin/env node
// Applies supabase/migrations/*.sql, in filename order, to a real Postgres
// engine (PGlite — Postgres compiled to WASM).
//
// This is the check that keeps the schema honest. Unlike validate-schema.mjs,
// which reads illustrative SQL out of the design docs, this executes the
// actual migrations the way `supabase db reset` would, so a broken foreign
// key, a malformed policy or a plpgsql syntax error fails here rather than
// on the owner's machine.
//
//   node tools/validate-migrations.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { splitStatements, statementLabel } from './sql-split.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'supabase', 'migrations')

const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

// ── Static check: every `create type` must be guarded ────────────────────
//
// `create type` has no `if not exists`, and dropping tables does not drop
// enums — so an unguarded one makes the whole migration set fragile to a
// partial re-run (the 42710 "type already exists" failure that a manual
// SQL-editor replay hits first). splitStatements respects dollar-quoting, so
// a guarded create lives inside one `do $$ … $$;` statement and only a bare
// create type surfaces here.
const unguardedCreateTypes = []
for (const file of files) {
  const sql = readFileSync(join(dir, file), 'utf8')
  for (const stmt of splitStatements(sql)) {
    if (/^\s*create\s+type\b/i.test(stmt)) {
      unguardedCreateTypes.push(`${file}: ${stmt.split('\n')[0].trim()}`)
    }
  }
}
if (files.length === 0) {
  console.error(`no migrations found in ${dir}`)
  process.exit(1)
}

const db = new PGlite()

// Supabase provides these; PGlite does not. Stub them so the RLS policies,
// auth.* helpers and the Realtime publication are all exercised rather than
// skipped — the authorization layer is the part that most needs proving.
await db.exec(`
  -- Supabase creates these roles; PGlite does not. Without them the grants
  -- migration cannot be exercised at all.
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;

  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text
  );
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE AS
    $$ SELECT coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb $$;
  CREATE PUBLICATION supabase_realtime;
`)

// pg_trgm is unavailable in the WASM build. The two trigram indexes and the
// CREATE EXTENSION line are the only statements affected; both are valid on
// real Postgres/Supabase.
const SKIP = /gin_trgm_ops|create\s+extension\s+if\s+not\s+exists\s+pg_trgm/i

const results = { ok: [], skipped: [], failed: [] }
let skippedStatements = 0

for (const file of files) {
  const sql = readFileSync(join(dir, file), 'utf8')
  const statements = splitStatements(sql)
  const runnable = statements.filter((s) => !SKIP.test(s))
  const omitted = statements.length - runnable.length
  skippedStatements += omitted

  if (omitted > 0) results.skipped.push({ file, omitted })
  if (runnable.length === 0) continue

  for (const stmt of runnable) {
    try {
      await db.exec(stmt)
      results.ok.push(file)
    } catch (e) {
      results.failed.push({
        file,
        statement: statementLabel(stmt),
        error: String(e.message ?? e).split('\n')[0],
      })
      // A failed statement usually cascades; stop this file but keep going so
      // one run surfaces every independent problem.
      break
    }
  }
}

// ── Seeds ─────────────────────────────────────────────────────────────────
// Run after migrations, exactly as `supabase db reset` would. The seeds carry
// their own self-verification (the permission catalogue assertion and the
// provision_organization smoke test), so a failure here is meaningful.
const seedDir = join(root, 'supabase', 'seed')
let seedFiles = []
try {
  seedFiles = readdirSync(seedDir).filter((f) => f.endsWith('.sql')).sort()
} catch {
  /* no seeds yet */
}

const seedResults = { ok: 0, failed: [] }
for (const file of seedFiles) {
  const sql = readFileSync(join(seedDir, file), 'utf8')
  for (const stmt of splitStatements(sql)) {
    try {
      await db.exec(stmt)
      seedResults.ok++
    } catch (e) {
      seedResults.failed.push({
        file,
        statement: statementLabel(stmt),
        error: String(e.message ?? e).split('\n')[0],
      })
      break
    }
  }
}

const filesOk = new Set(results.ok.map((f) => f)).size
console.log(`migrations found:  ${files.length}`)
console.log(`files applied:     ${filesOk}`)
console.log(`statements run:    ${results.ok.length}`)
console.log(`statements skipped: ${skippedStatements} (pg_trgm — unavailable in WASM)`)
console.log(`failures:          ${results.failed.length}`)
console.log(`\nseeds applied:     ${seedFiles.length}`)
console.log(`seed statements:   ${seedResults.ok}`)
console.log(`seed failures:     ${seedResults.failed.length}`)

if (results.failed.length) {
  console.log('\n-- FAILED --')
  for (const f of results.failed) {
    console.log(`  ${f.file}`)
    console.log(`      stmt: ${f.statement}`)
    console.log(`      ${f.error}`)
  }
  process.exitCode = 1
}

if (seedResults.failed.length) {
  console.log('\n-- SEED FAILED --')
  for (const f of seedResults.failed) {
    console.log(`  ${f.file}`)
    console.log(`      stmt: ${f.statement}`)
    console.log(`      ${f.error}`)
  }
  process.exitCode = 1
}

if (process.exitCode) {
  await db.close()
  process.exit(1)
}

// ── Structural assertions ─────────────────────────────────────────────────
const q = async (sql) => (await db.query(sql)).rows

const tables = await q(`
  select table_name from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE'
   order by table_name`)

const noRls = await q(`select * from app.tables_missing_rls()`)
const policies = await q(`select count(*)::int as n from pg_policies where schemaname = 'public'`)
const policies_text = await q(`select qual, with_check from pg_policies where schemaname = 'public'`)
const functions = await q(`
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','app')
     and p.proname in (
       'complete_sale','hold_sale','resume_sale','refund_sale',
       'apply_stock_movement','adjust_stock','receive_purchase',
       'open_register','close_register','register_cash_movement','record_expense',
       'dashboard_summary','next_sequence',
       'session_payload','provision_organization',
       'current_org_ids','in_org','current_branch_id','has_permission',
       'visible_branch_ids','in_visible_branch','require_permission','require_org',
       'tables_missing_rls'
     )
   order by 1`)

console.log(`\ntables:           ${tables.length}`)
console.log(`RLS policies:     ${policies[0].n}`)
console.log(`tables w/o RLS:   ${noRls.length}${noRls.length ? ' → ' + noRls.map((r) => r.table_name).join(', ') : ''}`)
console.log(`\nkey functions present (${functions.length}):`)
for (const f of functions) console.log(`  ${f.f}`)

// ── Behavioral assertions ─────────────────────────────────────────────────
const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const runChecks = async () => {
// The ledger invariant: every movement must balance, and the balance must
// equal the sum of its movements. Seeded and exercised below.
console.log('\n-- behavioral checks --')

check(
  'every create type is guarded against re-runs',
  unguardedCreateTypes.length === 0,
  unguardedCreateTypes.join('; ')
)

// Seed a minimal org so the ledger constraint can be exercised.
try {
await db.exec(`
  INSERT INTO auth.users (id, email)
  VALUES ('00000000-0000-0000-0000-000000000001', 'owner@test.local');

  INSERT INTO public.organizations (id, name, slug, currency)
  VALUES ('00000000-0000-0000-0000-000000000001', 'Test Org', 'test-org', 'BDT');

  INSERT INTO public.branches (id, organization_id, name, code)
  VALUES ('00000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-000000000001', 'Main', 'MAIN');

  INSERT INTO public.warehouses (id, organization_id, branch_id, name, code, is_retail_floor)
  VALUES ('00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000b1', 'Floor', 'FLOOR', true);

  INSERT INTO public.products (id, organization_id, name, selling_price, cost_price)
  VALUES ('00000000-0000-0000-0000-0000000000f1',
          '00000000-0000-0000-0000-000000000001', 'Test Product', 100, 60);

  INSERT INTO public.product_variants (id, organization_id, product_id, is_default)
  VALUES ('00000000-0000-0000-0000-0000000000e1',
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000f1', true);
`)
} catch (e) {
  console.error('  seed failed: ' + String(e.message ?? e).split('\n')[0])
  process.exit(1)
}

// 1. The movements_arithmetic CHECK rejects an unbalanced row.
let rejected = false
try {
  await db.exec(`
    INSERT INTO public.stock_movements
      (organization_id, warehouse_id, variant_id, product_id, type,
       quantity, direction, before_quantity, after_quantity)
    VALUES ('00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-0000000000a1',
            '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000f1',
            'PURCHASE', 10, 1, 0, 99)
  `)
} catch {
  rejected = true
}
check('unbalanced stock movement is rejected by CHECK', rejected)

// 2. The ledger is append-only.
await db.exec(`
  INSERT INTO public.stock_movements
    (organization_id, warehouse_id, variant_id, product_id, type,
     quantity, direction, before_quantity, after_quantity, unit_cost)
  VALUES ('00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000e1',
          '00000000-0000-0000-0000-0000000000f1',
          'PURCHASE', 10, 1, 0, 10, 60)
`)
let immutable = false
try {
  await db.exec(`UPDATE public.stock_movements SET quantity = 999`)
} catch {
  immutable = true
}
check('stock_movements is append-only (UPDATE blocked)', immutable)

// 3. One open register session per register.
await db.exec(`
  INSERT INTO public.registers (id, organization_id, branch_id, name, code)
  VALUES ('00000000-0000-0000-0000-0000000000d1',
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000b1', 'Counter 1', 'C1');
  INSERT INTO public.register_sessions
    (organization_id, register_id, branch_id, opened_by, opening_cash)
  VALUES ('00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000d1',
          '00000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-000000000001', 500);
`)
let dupSession = false
try {
  await db.exec(`
    INSERT INTO public.register_sessions
      (organization_id, register_id, branch_id, opened_by, opening_cash)
    VALUES ('00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000b1',
            '00000000-0000-0000-0000-000000000001', 500)
  `)
} catch {
  dupSession = true
}
check('second open session on one register is rejected', dupSession)

// 4. Money columns are exact numerics, never floats.
const money = await q(`
  select column_name, data_type from information_schema.columns
   where table_name = 'sales' and column_name in ('total','cogs','profit')
   order by column_name`)
check(
  'sales money columns are numeric, not float',
  money.length === 3 && money.every((r) => r.data_type === 'numeric'),
  money.map((r) => `${r.column_name}:${r.data_type}`).join(' ')
)

// 5. Profit is generated, so it cannot drift from its inputs.
const profitCol = await q(`
  select is_generated from information_schema.columns
   where table_name = 'sales' and column_name = 'profit'`)
check('sales.profit is a generated column', profitCol[0]?.is_generated === 'ALWAYS')

// 6. Default-variant uniqueness.
let dupDefault = false
try {
  await db.exec(`
    INSERT INTO public.product_variants
      (organization_id, product_id, is_default)
    VALUES ('00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-0000000000f1', true)
  `)
} catch {
  dupDefault = true
}
check('a product cannot have two default variants', dupDefault)

// 7. next_sequence produces gap-free, monotonically increasing values.
const seqs = []
for (let i = 0; i < 5; i++) {
  const r = await q(`select public.next_sequence(
    '00000000-0000-0000-0000-000000000001', 'invoice:2026')::int as n`)
  seqs.push(r[0].n)
}
check(
  'next_sequence is monotonic and gap-free',
  seqs.every((n, i) => n === i + 1),
  seqs.join(',')
)

}

try {
  await runChecks()
} catch (e) {
  console.log(`  ERROR  ${String(e.message ?? e).split('\n')[0]}`)
  checks.push({ name: 'unexpected error', pass: false })
}

// ── End-to-end: complete_sale ─────────────────────────────────────────────
// The seed provisions a demo organization with an owner, roles and payment
// methods. Signing in as that owner and running a real sale proves the whole
// write path: authorization → stock lock → ledger → invoice → register →
// outbox. This is the check that would catch a broken RPC.
const seeded = await q(`
  select o.id as org, b.id as branch, w.id as warehouse, r.id as register,
         (select id from public.payment_methods
           where organization_id = o.id and key = 'cash') as cash,
         '00000000-0000-0000-0000-00000000dead' as owner
    from public.organizations o
    join public.branches b    on b.organization_id = o.id
    join public.warehouses w  on w.organization_id = o.id and w.is_retail_floor
    join public.registers r   on r.organization_id = o.id
   where o.slug = 'seed-demo-shop'
   limit 1`)

if (seeded.length === 0) {
  check('seeded demo organization exists', false, 'seed-demo-shop not found')
} else {
  const s = seeded[0]
  await db.exec(`select set_config('request.jwt.claim.sub', '${s.owner}', false)`)

  const canSee = await q(`select app.current_org_ids() as orgs`)
  check(
    'signed-in owner resolves their organization',
    canSee[0].orgs.includes(s.org),
    String(canSee[0].orgs)
  )

  const isOwner = await q(`select app.has_permission('sales.create') as ok`)
  check('owner holds sales.create via the * wildcard', isOwner[0].ok === true)

  // A product with stock.
  await db.exec(`
    INSERT INTO public.products (id, organization_id, name, selling_price, cost_price, track_stock)
    VALUES ('00000000-0000-0000-0000-00000000c001', '${s.org}', 'E2E Widget', 250, 150, true);
    INSERT INTO public.product_variants (id, organization_id, product_id, is_default)
    VALUES ('00000000-0000-0000-0000-00000000c002', '${s.org}',
            '00000000-0000-0000-0000-00000000c001', true);
  `)

  const afterStockIn = await q(`
    select public.apply_stock_movement(
      '${s.warehouse}', '00000000-0000-0000-0000-00000000c002',
      'PURCHASE', 10, 150, 'test', null, null)::numeric as qty`)
  check('stock-in records 10 units', Number(afterStockIn[0].qty) === 10, String(afterStockIn[0].qty))

  const session = await q(`
    select public.open_register('${s.register}', 1000, null) as id`)
  check('register opens', Boolean(session[0].id))

  const sale = await q(`
    select public.complete_sale(
      '${s.branch}',
      jsonb_build_array(jsonb_build_object(
        'variant_id', '00000000-0000-0000-0000-00000000c002',
        'qty', 3)),
      jsonb_build_array(jsonb_build_object(
        'method_id', '${s.cash}', 'amount', 750)),
      '${s.register}', null, null, null, null, null) as r`)

  const result = sale[0].r
  check('complete_sale returns COMPLETED', result.status === 'COMPLETED', String(result.status))
  check('sale total is 3 × 250', Number(result.total) === 750, String(result.total))
  check('invoice number is formatted', /^INV-\d{4}-\d{6}$/.test(result.invoice_no), result.invoice_no)

  const bal = await q(`
    select quantity from public.stock_balances
     where warehouse_id = '${s.warehouse}'
       and variant_id = '00000000-0000-0000-0000-00000000c002'`)
  check('stock decremented 10 → 7', Number(bal[0].quantity) === 7, String(bal[0].quantity))

  const ledger = await q(`
    select type, before_quantity, after_quantity, unit_cost
      from public.stock_movements
     where variant_id = '00000000-0000-0000-0000-00000000c002'
     order by created_at`)
  check(
    'ledger has balanced PURCHASE and SALE rows',
    ledger.length === 2 &&
      ledger[0].type === 'PURCHASE' &&
      ledger[1].type === 'SALE' &&
      Number(ledger[1].before_quantity) === 10 &&
      Number(ledger[1].after_quantity) === 7,
    ledger.map((r) => `${r.type}:${r.before_quantity}→${r.after_quantity}`).join(' ')
  )

  const profit = await q(`
    select cogs, profit from public.sales where invoice_no = '${result.invoice_no}'`)
  check(
    'profit captured at sale time (750 − 3×150 = 300)',
    Number(profit[0].cogs) === 450 && Number(profit[0].profit) === 300,
    `cogs=${profit[0].cogs} profit=${profit[0].profit}`
  )

  const outbox = await q(`
    select event_type from public.outbox
     where organization_id = '${s.org}' and aggregate_type = 'sale'`)
  check(
    'sale.completed event written to the outbox',
    outbox.some((r) => r.event_type === 'sale.completed'),
    outbox.map((r) => r.event_type).join(',')
  )

  const cash = await q(`
    select sales_cash, opening_cash from public.register_sessions where id = '${session[0].id}'`)
  check(
    'register tracked the cash sale',
    Number(cash[0].sales_cash) === 750 && Number(cash[0].opening_cash) === 1000,
    `sales_cash=${cash[0].sales_cash}`
  )

  // Overselling must be impossible — the whole point of the row lock.
  let blocked = false
  try {
    await db.exec(`
      select public.complete_sale(
        '${s.branch}',
        jsonb_build_array(jsonb_build_object(
          'variant_id', '00000000-0000-0000-0000-00000000c002',
          'qty', 999)),
        jsonb_build_array(jsonb_build_object(
          'method_id', '${s.cash}', 'amount', 1)),
        '${s.register}', null, null, null, null, null)`)
  } catch (e) {
    blocked = /insufficient_stock/.test(String(e.message ?? e))
  }
  check('overselling is rejected by the database', blocked)

  // ── Migration 021: tax-inclusive pricing must not double-charge ──────────
  //
  // Before 021 complete_sale computed the correct inclusive line total and
  // then ignored it, summing `subtotal - discount + tax` instead. Since
  // `subtotal` already contains the VAT for an inclusive product, the VAT was
  // charged twice. Found by porting the client cart arithmetic to
  // src/shared/domain/cart.ts and diffing it against the RPC.
  await db.exec(`
    INSERT INTO public.taxes (id, organization_id, name, rate, is_inclusive, applies_to)
    VALUES ('00000000-0000-0000-0000-000000007a01', '${s.org}',
            'VAT 15%', 15, false, 'products');
    INSERT INTO public.products (id, organization_id, name, selling_price, cost_price,
                                 tax_id, tax_inclusive, track_stock)
    VALUES ('00000000-0000-0000-0000-000000007b01', '${s.org}', 'Inclusive Soap',
            115, 80, '00000000-0000-0000-0000-000000007a01', true, false);
    INSERT INTO public.product_variants (id, organization_id, product_id, is_default)
    VALUES ('00000000-0000-0000-0000-000000007c01', '${s.org}',
            '00000000-0000-0000-0000-000000007b01', true);
  `)

  const inclusive = await q(`
    select public.complete_sale(
      '${s.branch}',
      jsonb_build_array(jsonb_build_object(
        'variant_id', '00000000-0000-0000-0000-000000007c01', 'qty', 1)),
      jsonb_build_array(jsonb_build_object(
        'method_id', '${s.cash}', 'amount', 115)),
      '${s.register}', null, null, null, null, null) as r`)

  check(
    'tax-inclusive product charges its shelf price, not price + VAT (021)',
    Number(inclusive[0].r.total) === 115,
    `total=${inclusive[0].r.total} tax=${inclusive[0].r.tax}`
  )
  check(
    'the VAT inside an inclusive price is still reported (021)',
    Number(inclusive[0].r.tax) === 15,
    `tax=${inclusive[0].r.tax}`
  )

  const mixed = await q(`
    select public.complete_sale(
      '${s.branch}',
      jsonb_build_array(
        jsonb_build_object('variant_id', '00000000-0000-0000-0000-000000007c01', 'qty', 1),
        jsonb_build_object('variant_id', '00000000-0000-0000-0000-00000000c002', 'qty', 1)),
      jsonb_build_array(jsonb_build_object(
        'method_id', '${s.cash}', 'amount', 365)),
      '${s.register}', null, null, null, null, null) as r`)
  check(
    'a mixed inclusive/exclusive cart totals correctly (021)',
    Number(mixed[0].r.total) === 365,
    `total=${mixed[0].r.total} (soap 115 inclusive + widget 250 untaxed)`
  )

  // An order-level discount must still reduce the total after 021.
  const discounted = await q(`
    select public.complete_sale(
      p_branch_id    => '${s.branch}',
      p_items        => jsonb_build_array(jsonb_build_object(
        'variant_id', '00000000-0000-0000-0000-00000000c002', 'qty', 2)),
      p_payments     => jsonb_build_array(jsonb_build_object(
        'method_id', '${s.cash}', 'amount', 450)),
      p_register_id  => '${s.register}',
      p_discount_type  => 'FLAT',
      p_discount_value => 50
    ) as r`)
  check(
    'an order-level FLAT discount still applies after 021',
    Number(discounted[0].r.total) === 450 && Number(discounted[0].r.discount) === 50,
    `total=${discounted[0].r.total} discount=${discounted[0].r.discount}`
  )

  // ── Migration 021: the hold / resume loop must close ─────────────────────
  const held = await q(`
    select public.hold_sale(
      '${s.branch}',
      jsonb_build_array(jsonb_build_object(
        'variant_id', '00000000-0000-0000-0000-00000000c002', 'qty', 2,
        'discount_type', 'FLAT', 'discount_value', 50)),
      null, 'customer went to the car') as id`)
  check('hold_sale returns an id', Boolean(held[0].id), String(held[0].id))

  const resumed = await q(`select public.resume_sale('${held[0].id}') as r`)
  const resumedItems = resumed[0].r.items
  check(
    'resume_sale returns the stored lines (021)',
    Array.isArray(resumedItems) && resumedItems.length === 1,
    JSON.stringify(resumedItems)
  )
  check(
    'resume_sale returns the per-line discount hold_sale stored (021)',
    resumedItems[0]?.discount_type === 'FLAT'
      && Number(resumedItems[0]?.discount_value) === 50,
    JSON.stringify(resumedItems[0])
  )

  const stillHeld = await q(`select status from public.sales where id = '${held[0].id}'`)
  check(
    'a resumed hold stays HELD until its sale lands (021)',
    stillHeld[0].status === 'HELD',
    String(stillHeld[0].status)
  )

  // Named notation: with ten parameters and several untyped NULLs, positional
  // calls leave Postgres guessing at types. Naming them is unambiguous and
  // survives a future parameter being inserted in the middle.
  const completedFromHold = await q(`
    select public.complete_sale(
      p_branch_id      => '${s.branch}',
      p_items          => jsonb_build_array(jsonb_build_object(
        'variant_id', '00000000-0000-0000-0000-00000000c002', 'qty', 2,
        'discount_type', 'FLAT', 'discount_value', 50)),
      p_payments       => jsonb_build_array(jsonb_build_object(
        'method_id', '${s.cash}', 'amount', 450)),
      p_register_id    => '${s.register}',
      p_held_sale_id   => '${held[0].id}'
    ) as r`)
  check(
    'a resumed cart completes through complete_sale (021)',
    completedFromHold[0].r.status === 'COMPLETED',
    String(completedFromHold[0].r.status)
  )

  const heldAfter = await q(`select status from public.sales where id = '${held[0].id}'`)
  check(
    'completing a resumed cart cancels its hold atomically (021)',
    heldAfter[0].status === 'CANCELLED',
    String(heldAfter[0].status)
  )

  const heldRowsInReports = await q(`
    select count(*)::int as n from public.sales
     where organization_id = '${s.org}'
       and status in ('COMPLETED','PARTIALLY_PAID','PARTIALLY_REFUNDED')
       and invoice_no like 'HELD-%'`)
  check(
    'no held cart is ever counted as a sale',
    heldRowsInReports[0].n === 0,
    String(heldRowsInReports[0].n)
  )

  // An unauthorized user must not be able to sell.
  await db.exec(`
    INSERT INTO auth.users (id, email)
    VALUES ('00000000-0000-0000-0000-00000000beef', 'intruder@test.local')
    ON CONFLICT DO NOTHING;
    select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000beef', false)`)
  // An outsider must be refused. A user with no user_organizations row is
  // stopped by require_org ('forbidden'); one with membership but no role is
  // stopped by require_permission ('permission_denied'). Either proves the
  // check is server-side, so accept both.
  let denied = false
  let denialReason = ''
  try {
    await db.exec(`
      select public.complete_sale(
        '${s.branch}',
        jsonb_build_array(jsonb_build_object(
          'variant_id', '00000000-0000-0000-0000-00000000c002',
          'qty', 1)),
        jsonb_build_array(jsonb_build_object(
          'method_id', '${s.cash}', 'amount', 250)),
        '${s.register}', null, null, null, null, null)`)
  } catch (e) {
    denialReason = String(e.message ?? e).split('\n')[0]
    denied = /permission_denied|forbidden/.test(denialReason)
  }
  check('a user outside the organization cannot complete a sale', denied, denialReason)

  // A member with a role lacking the permission must also be refused. This is
  // the case that matters for a cashier trying to refund.
  await db.exec(`
    INSERT INTO auth.users (id, email)
    VALUES ('00000000-0000-0000-0000-00000000cafe', 'cashier@test.local')
    ON CONFLICT DO NOTHING;
    INSERT INTO public.user_organizations (user_id, organization_id)
    VALUES ('00000000-0000-0000-0000-00000000cafe', '${s.org}')
    ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, organization_id, role_id)
    SELECT '00000000-0000-0000-0000-00000000cafe', '${s.org}', id
      FROM public.roles WHERE organization_id = '${s.org}' AND key = 'cashier';
    select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cafe', false)`)

  const cashierCan = await q(`select app.has_permission('sales.create') as yes,
                                     app.has_permission('sales.refund') as no`)
  check(
    'cashier holds sales.create but not sales.refund',
    cashierCan[0].yes === true && cashierCan[0].no === false,
    `create=${cashierCan[0].yes} refund=${cashierCan[0].no}`
  )

  await db.exec(`select set_config('request.jwt.claim.sub', '', false)`)

}

// ── ERD consistency ───────────────────────────────────────────────────────
// The Mermaid ERD in the design doc must not promise a table the migrations
// fail to create. Checked against the live schema, not against the doc's own
// illustrative DDL, so the migrations stay the single source of truth.
const tableNames = new Set(tables.map((r) => r.table_name))
let erdMissing = []
try {
  const doc = readFileSync(join(root, 'docs', '04-database-design.md'), 'utf8')
  const erd = doc.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? ''
  const entities = new Set()
  for (const line of erd.split('\n')) {
    const m = line.match(/^\s*(\w+)\s+[|o{}]+--+[|o{}]+\s+(\w+)\s*:/)
    if (m) {
      entities.add(m[1])
      entities.add(m[2])
    }
  }
  // `users` is auth.users, provided by Supabase rather than our migrations.
  erdMissing = [...entities].filter((e) => !tableNames.has(e) && e !== 'users')
  check(
    'ERD references no table the migrations fail to create',
    erdMissing.length === 0,
    erdMissing.length ? erdMissing.join(', ') : `${entities.size} entities`
  )
} catch {
  check('ERD consistency (doc not found)', false)
}

// ── Session payload (migration 019) ─────────────────────────────────────
// Verified here rather than inside the migration: it needs the seeded demo
// organization, and seeds are applied after migrations. The preceding
// assertion left the JWT claim pointing at a role-less user, so restore the
// owner first.
await db.query(`select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dead', false)`)
const payloadRows = await q(`select public.session_payload()::text as p`)
const payload = JSON.parse(payloadRows[0].p)
check(
  'session_payload lists the owner organization',
  payload.organizations.length === 1,
  `${payload.organizations.length} org(s)`
)
const ownerOrg = payload.organizations[0] ?? { name: '(none)', is_owner: false, permissions: [] }
check('session_payload carries org identity', ownerOrg.name === 'Seed Demo Shop', ownerOrg.name)
check('session_payload marks the owner', ownerOrg.is_owner === true, String(ownerOrg.is_owner))
check(
  'session_payload exposes stable role keys',
  Array.isArray(ownerOrg.role_keys) && ownerOrg.role_keys.includes('owner'),
  JSON.stringify(ownerOrg.role_keys)
)
check(
  'session_payload expands the owner wildcard into concrete keys',
  ownerOrg.permissions.includes('sales.create') && ownerOrg.permissions.includes('users.delete'),
  `${ownerOrg.permissions.length} keys`
)
check(
  'session_payload does not leak the raw wildcard to the client',
  !ownerOrg.permissions.includes('*'),
  ownerOrg.permissions.includes('*') ? 'leaked *' : 'expanded'
)

// A cashier must not receive what the owner received. Scoped to the owner's
// organization explicitly — an unqualified `(select id from organizations)`
// returns more than one row as soon as a second org exists.
const CASHIER = '11111111-1111-1111-1111-111111111111'
await db.query(`insert into auth.users (id, email) values ('${CASHIER}', 'cashier@example.com')`)
await db.query(`
  insert into public.user_organizations (user_id, organization_id, is_active)
  values ('${CASHIER}', '${ownerOrg.organization_id}', true)
`)
const cashierRole = await q(`
  select id::text as id from public.roles
   where key = 'cashier' and organization_id = '${ownerOrg.organization_id}'`)
if (cashierRole.length !== 1) {
  check('cashier role exists in the demo organization', false, `${cashierRole.length} rows`)
} else {
  await db.query(`
    insert into public.user_roles (user_id, role_id, organization_id)
    values ('${CASHIER}', '${cashierRole[0].id}', '${ownerOrg.organization_id}')`)
}
await db.query(`select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false)`)
const cashierRows = await q(`select public.session_payload()::text as p`)
const cashierPayload = JSON.parse(cashierRows[0].p)
const cashierOrg = cashierPayload.organizations[0] ?? { is_owner: true, permissions: [] }
check('cashier holds sales.create', cashierOrg.permissions.includes('sales.create'))
check(
  'cashier does not hold sales.refund',
  !cashierOrg.permissions.includes('sales.refund'),
  cashierOrg.permissions.filter((k) => k.startsWith('sales.')).join(',')
)
check('cashier is not flagged as owner', cashierOrg.is_owner === false, String(cashierOrg.is_owner))
check(
  'cashier is denied the owner-only wildcard',
  !cashierOrg.permissions.includes('*') && !cashierOrg.permissions.includes('users.delete'),
  `users.delete=${cashierOrg.permissions.includes('users.delete')}`
)
await db.query(`select set_config('request.jwt.claim.sub', null, false)`)

// ── RLS helper executability ──────────────────────────────────────────────
// PGlite runs as superuser, so GRANT/REVOKE are never enforced at runtime and
// a missing EXECUTE grant is invisible to every other assertion here. It is
// not invisible on a real Supabase project: RLS policy expressions run as the
// *querying* role, so an ungranted helper turns every anonymous read into
// `42501 permission denied for function …` instead of an empty result.
//
// This check reads the recorded ACLs, which PGlite does maintain, and compares
// them against the functions the policies actually call.
const policyFns = new Map()
for (const row of policies_text) {
  for (const expr of [row.qual, row.with_check]) {
    if (!expr) continue
    for (const m of String(expr).matchAll(/\bapp\.([a-z_]+)\s*\(/g)) {
      policyFns.set(m[1], (policyFns.get(m[1]) ?? 0) + 1)
    }
  }
}

for (const [name, refs] of [...policyFns.entries()].sort()) {
  const g = await q(`
    select has_function_privilege('anon', p.oid, 'EXECUTE')::text          as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE')::text as auth
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = '${name}'`)
  const row = g[0] ?? { anon: 'missing', auth: 'missing' }
  check(
    `app.${name} is executable by anon and authenticated (${refs} policy refs)`,
    row.anon === 'true' && row.auth === 'true',
    `anon=${row.anon} authenticated=${row.auth}`
  )
}

// The internal helpers must stay unreachable — that is the other half of the
// grant story. If one of these ever becomes callable from the client, the
// stock ledger can be written directly.
for (const name of ['apply_stock_movement', 'next_sequence']) {
  const g = await q(`
    select has_function_privilege('anon', p.oid, 'EXECUTE')::text          as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE')::text as auth
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '${name}'`)
  const row = g[0] ?? { anon: 'missing', auth: 'missing' }
  check(
    `internal helper ${name} stays revoked from anon and authenticated`,
    row.anon === 'false' && row.auth === 'false',
    `anon=${row.anon} authenticated=${row.auth}`
  )
}

// ── Client-facing RPC reachability ────────────────────────────────────────
// Two distinct failure modes, both invisible to PGlite at runtime because it
// runs as superuser:
//
//   42725 "is not unique" — adding a parameter with `create or replace` leaves
//     the old signature in place, so an existing call matches two overloads.
//     Migration 021 did exactly this until the old signature was dropped.
//
//   42501 "permission denied" — `drop function` takes the grant with it, so a
//     re-created function is unreachable until it is granted again.
for (const name of ['complete_sale', 'hold_sale', 'resume_sale', 'refund_sale',
                    'open_register', 'close_register', 'register_cash_movement']) {
  const g = await q(`
    select count(*)::int as overloads,
           bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text as auth,
           bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))::text          as anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '${name}'`)
  const row = g[0] ?? { overloads: 0, auth: 'missing', anon: 'missing' }
  check(
    `${name} has exactly one overload, granted to authenticated only`,
    row.overloads === 1 && row.auth === 'true' && row.anon === 'false',
    `overloads=${row.overloads} authenticated=${row.auth} anon=${row.anon}`
  )
}

// ── The POS catalogue view ────────────────────────────────────────────────
// `security_invoker` is the difference between a saved query and a data leak.
// A view without it executes as its owner, so it would return every
// organization's catalogue to any signed-in user regardless of the RLS
// policies on the tables underneath. PGlite does not enforce RLS, so this is
// the only place the property is checked.
const viewRow = await q(`
  select c.reloptions::text as opts
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'pos_catalog' and c.relkind = 'v'`)
check(
  'pos_catalog exists and runs as the invoker, so underlying RLS applies',
  viewRow.length === 1 && /security_invoker=(true|on)/.test(String(viewRow[0].opts ?? '')),
  viewRow[0] ? String(viewRow[0].opts) : 'view missing'
)

// A variant with a price override must win over the product's price, and one
// without must inherit it. That resolution happens in the view, so if it is
// wrong every client is wrong in the same way at once.
const priced = await q(`
  select pos.price as inherited
    from public.pos_catalog pos
   where pos.product_id = '00000000-0000-0000-0000-000000007b01'`)
check(
  'pos_catalog resolves a variant price from its product when not overridden',
  priced.length === 1 && Number(priced[0].inherited) === 115,
  priced[0] ? String(priced[0].inherited) : 'no row'
)

// ── Slugs survive a name collision (023) ─────────────────────────────────
//
// Two shops called "Rahim Store" is the normal case in a Bangladeshi bazaar.
// Before 023 the second signup died on organizations_slug_key and the
// shopkeeper got a raw Postgres error instead of a shop.
const twinA = await q(`
  insert into public.organizations (id, name, slug)
  values (gen_random_uuid(), 'Rahim Store', 'rahim-store')
  returning slug`)
const twinB = await q(`
  insert into public.organizations (id, name, slug)
  values (gen_random_uuid(), 'Rahim Store', 'rahim-store')
  returning slug`)
const twinC = await q(`
  insert into public.organizations (id, name, slug)
  values (gen_random_uuid(), 'Rahim Store', 'rahim-store')
  returning slug`)
check(
  'a second organization with a colliding slug is created, not rejected',
  twinA.length === 1 && twinB.length === 1 && twinC.length === 1,
  [twinA, twinB, twinC].map((r) => r[0]?.slug).join(', ')
)
check(
  'colliding slugs are de-conflicted with a numeric suffix',
  twinA[0]?.slug === 'rahim-store' &&
    twinB[0]?.slug === 'rahim-store-2' &&
    twinC[0]?.slug === 'rahim-store-3',
  [twinA, twinB, twinC].map((r) => r[0]?.slug).join(', ')
)

// A slug the caller hand-rolled is normalised rather than trusted: the
// database is the last word on what a slug may look like, because an
// unslugified value fails the same way a collision does.
const messy = await q(`
  insert into public.organizations (id, name, slug)
  values (gen_random_uuid(), 'Karim & Sons', '  Karim & Sons!  ')
  returning slug`)
check(
  'a malformed slug is normalised on the way in',
  messy[0]?.slug === 'karim-sons',
  messy[0] ? String(messy[0].slug) : 'no row'
)

// and a name that slugifies to nothing at all (Bengali, emoji) still lands.
const nameless = await q(`
  insert into public.organizations (id, name, slug)
  values (gen_random_uuid(), 'মায়ের দোয়া স্টোর', '')
  returning slug`)
check(
  'a slug that normalises to nothing falls back rather than failing',
  nameless[0]?.slug === 'shop',
  nameless[0] ? String(nameless[0].slug) : 'no row'
)

// ── Phase 3 — inventory operations and the ledger invariants ─────────────
//
// The acceptance criteria for this phase are properties, not examples: every
// balance change must have a ledger row where before + delta = after, the
// balance must equal the sum of its movements, and the stock value the
// dashboard reports must equal Σ(quantity × avg_unit_cost) exactly. A handful
// of hand-picked cases cannot show that, so the first check below drives
// randomized operation sequences and then verifies the invariants over every
// row they produced.
if (seeded.length !== 0) {
  const s = seeded[0]

  // The checks above end with the JWT claim cleared or switched to another
  // user; the stock operations all call app.require_org, so re-establish the
  // signed-in owner before exercising them.
  await db.query(`select set_config('request.jwt.claim.sub', '${s.owner}', false)`)

  // A second warehouse to transfer into, and a variant used only by these
  // checks so their arithmetic is not entangled with the sale above.
  await db.exec(`
    INSERT INTO public.warehouses (id, organization_id, name, code, is_retail_floor)
    VALUES ('00000000-0000-0000-0000-00000000d001', '${s.org}', 'Back Room', 'BACK', false)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.products (id, organization_id, name, selling_price, cost_price, track_stock, reorder_point)
    VALUES ('00000000-0000-0000-0000-00000000d002', '${s.org}', 'Invariant Widget', 200, 100, true, 5)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.product_variants (id, organization_id, product_id, is_default)
    VALUES ('00000000-0000-0000-0000-00000000d003', '${s.org}',
            '00000000-0000-0000-0000-00000000d002', true)
    ON CONFLICT (id) DO NOTHING;
  `)

  // ── Weighted-average costing ────────────────────────────────────────────
  //
  // 10 @ 100 then 10 @ 200 is 150 a unit. Getting this wrong is invisible
  // until a profit report is wrong, so it is worth asserting directly.
  await q(`select public.stock_in('${s.warehouse}',
             jsonb_build_array(jsonb_build_object('variant_id', '00000000-0000-0000-0000-00000000d003', 'qty', 10, 'unit_cost', 100)),
             null, 'AVG-1', null)`)
  await q(`select public.stock_in('${s.warehouse}',
             jsonb_build_array(jsonb_build_object('variant_id', '00000000-0000-0000-0000-00000000d003', 'qty', 10, 'unit_cost', 200)),
             null, 'AVG-2', null)`)

  const avg = await q(`select quantity, avg_unit_cost from public.stock_balances
                        where warehouse_id = '${s.warehouse}' and variant_id = '00000000-0000-0000-0000-00000000d003'`)
  check(
    'weighted average blends two receipts: 10@100 + 10@200 → 150',
    Number(avg[0].quantity) === 20 && Number(avg[0].avg_unit_cost) === 150,
    `qty=${avg[0].quantity} avg=${avg[0].avg_unit_cost}`
  )

  // Stock out must not move the average — the units left at the cost they
  // came in at, whatever the new market price is.
  await q(`select public.stock_out('${s.warehouse}',
             jsonb_build_array(jsonb_build_object('variant_id', '00000000-0000-0000-0000-00000000d003', 'qty', 5)),
             'damage', 'bottles broke')`)
  const afterOut = await q(`select quantity, avg_unit_cost from public.stock_balances
                             where warehouse_id = '${s.warehouse}' and variant_id = '00000000-0000-0000-0000-00000000d003'`)
  check(
    'stock out leaves the average untouched',
    Number(afterOut[0].quantity) === 15 && Number(afterOut[0].avg_unit_cost) === 150,
    `qty=${afterOut[0].quantity} avg=${afterOut[0].avg_unit_cost}`
  )

  const damageRow = await q(`select type, note from public.stock_movements
                              where variant_id = '00000000-0000-0000-0000-00000000d003'
                                and direction = -1 order by created_at desc limit 1`)
  check(
    'a damage write-off lands on the ledger as DAMAGE, not a generic adjustment',
    damageRow[0]?.type === 'DAMAGE',
    String(damageRow[0]?.type)
  )

  // ── Unknown reasons are refused ─────────────────────────────────────────
  let badReason = null
  try {
    await q(`select public.stock_out('${s.warehouse}',
               jsonb_build_array(jsonb_build_object('variant_id', '00000000-0000-0000-0000-00000000d003', 'qty', 1)),
               'banana', null)`)
  } catch (error) {
    badReason = String(error.message ?? error)
  }
  check('stock out refuses a reason outside the allow-list', /unknown_reason/.test(String(badReason)), String(badReason).slice(0, 60))

  // ── Transfers conserve value ────────────────────────────────────────────
  const valueBefore = await q(`select coalesce(sum(quantity * avg_unit_cost), 0) as v
                                 from public.stock_balances where organization_id = '${s.org}'`)
  const transferId = await q(`select public.transfer_stock('${s.warehouse}', '00000000-0000-0000-0000-00000000d001',
      jsonb_build_array(jsonb_build_object('variant_id', '00000000-0000-0000-0000-00000000d003', 'qty', 4)), 'nightly move') as id`)
  const moved = await q(`select warehouse_id, quantity, avg_unit_cost from public.stock_balances
                          where variant_id = '00000000-0000-0000-0000-00000000d003' order by warehouse_id`)
  const valueAfter = await q(`select coalesce(sum(quantity * avg_unit_cost), 0) as v
                                from public.stock_balances where organization_id = '${s.org}'`)
  const dest = moved.find((r) => r.warehouse_id === '00000000-0000-0000-0000-00000000d001')
  const src = moved.find((r) => r.warehouse_id === s.warehouse)
  check(
    'a transfer moves stock and conserves the shop\'s stock value exactly',
    Boolean(transferId[0].id) &&
      Number(src.quantity) === 11 &&
      Number(dest.quantity) === 4 &&
      Number(valueBefore[0].v) === Number(valueAfter[0].v),
    `src=${src.quantity} dest=${dest.quantity} value ${valueBefore[0].v} → ${valueAfter[0].v}`
  )
  check(
    'the receiving warehouse inherits the sending warehouse\'s cost',
    Number(dest.avg_unit_cost) === Number(src.avg_unit_cost),
    `${src.avg_unit_cost} vs ${dest.avg_unit_cost}`
  )
  check(
    'a transfer writes both legs with a shared reference',
    (await q(`select count(*)::int as n from public.stock_movements
               where reference_id = '${transferId[0].id}'
                 and type in ('TRANSFER_OUT','TRANSFER_IN')`))[0].n === 2,
    'expected 2 legs'
  )

  // ── Over-issue is refused, and leaves nothing behind ─────────────────────
  let overIssue = null
  const rowsBefore = (await q(`select count(*)::int as n from public.stock_movements`))[0].n
  try {
    await q(`select public.stock_out('${s.warehouse}',
               jsonb_build_array(jsonb_build_object('variant_id', '00000000-0000-0000-0000-00000000d003', 'qty', 99999)),
               'loss', null)`)
  } catch (error) {
    overIssue = String(error.message ?? error)
  }
  const rowsAfter = (await q(`select count(*)::int as n from public.stock_movements`))[0].n
  check('issuing more than is on hand is refused', /insufficient_stock/.test(String(overIssue)), String(overIssue).slice(0, 50))
  check('a refused issue writes no ledger rows at all', rowsBefore === rowsAfter, `${rowsBefore} → ${rowsAfter}`)

  // ── The property test ───────────────────────────────────────────────────
  //
  // Randomized operation sequences, then the invariants over everything they
  // produced. A deterministic LCG keeps the run reproducible: when this fails,
  // the seed in the message is enough to replay it by hand.
  let seed = 20260925
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const pick = (options) => options[Math.floor(rand() * options.length)]
  const variant = '00000000-0000-0000-0000-00000000d003'
  const warehouseA = s.warehouse
  const warehouseB = '00000000-0000-0000-0000-00000000d001'
  let applied = 0
  let refused = 0

  for (let i = 0; i < 60; i++) {
    const qty = 1 + Math.floor(rand() * 12)
    try {
      const op = pick(['in', 'in', 'out', 'adjust', 'adjust', 'transfer'])
      if (op === 'in') {
        await q(`select public.stock_in('${warehouseA}',
                   jsonb_build_array(jsonb_build_object('variant_id', '${variant}', 'qty', ${qty}, 'unit_cost', ${50 + Math.floor(rand() * 150)})),
                   null, 'fuzz', null)`)
      } else if (op === 'out') {
        await q(`select public.stock_out('${warehouseA}',
                   jsonb_build_array(jsonb_build_object('variant_id', '${variant}', 'qty', ${qty})),
                   '${pick(['damage', 'loss', 'expired', 'theft', 'other'])}', 'fuzz')`)
      } else if (op === 'adjust') {
        await q(`select public.adjust_stock('${warehouseA}', '${variant}', ${qty},
                   '${pick(['damage', 'loss', 'expired'])}',
                   ${pick([1, -1])}, 'fuzz')`)
      } else {
        await q(`select public.transfer_stock('${warehouseA}', '${warehouseB}',
                   jsonb_build_array(jsonb_build_object('variant_id', '${variant}', 'qty', ${qty})), 'fuzz')`)
      }
      applied++
    } catch {
      // Refusals are expected — the point is that they leave no trace.
      refused++
    }
  }

  const unbalanced = await q(`
    select count(*)::int as n from public.stock_movements
     where before_quantity + (quantity * direction) <> after_quantity`)
  check(
    `every one of ${applied} randomized operations wrote before + delta = after`,
    unbalanced[0].n === 0,
    unbalanced[0].n === 0 ? `${refused} refused cleanly` : `${unbalanced[0].n} unbalanced rows (seed ${seed})`
  )

  // The balance is a cache of the ledger. If they ever disagree, every number
  // the shop sees is wrong.
  const drifted = await q(`
    select sb.warehouse_id, sb.variant_id, sb.quantity, coalesce(sum(sm.quantity * sm.direction), 0) as ledger_qty
      from public.stock_balances sb
      left join public.stock_movements sm
        on sm.warehouse_id = sb.warehouse_id and sm.variant_id = sb.variant_id
     group by sb.warehouse_id, sb.variant_id, sb.quantity
    having sb.quantity <> coalesce(sum(sm.quantity * sm.direction), 0)`)
  check(
    'every balance equals the sum of its ledger movements',
    drifted.length === 0,
    drifted.length ? `${drifted.length} drifted balances, e.g. ${JSON.stringify(drifted[0])}` : 'all reconcile'
  )

  const negative = await q(`
    select count(*)::int as n from public.stock_balances sb
      join public.products p on p.id = sb.product_id
     where sb.quantity < 0 and not p.allow_negative`)
  check('no operation drove a balance negative', negative[0].n === 0, `${negative[0].n} negative balances`)

  // ── The dashboard number and the stock screen must agree exactly ─────────
  const summary = await q(`select public.stock_summary('${s.org}') as r`)
  const direct = await q(`select coalesce(sum(quantity * avg_unit_cost), 0) as v
                            from public.stock_balances where organization_id = '${s.org}'`)
  const dashboard = await q(`select public.dashboard_summary('${s.branch}', current_date) as r`)
  check(
    'stock_summary equals Σ(quantity × avg_unit_cost) exactly',
    Number(summary[0].r.stock_value) === Number(direct[0].v),
    `${summary[0].r.stock_value} vs ${direct[0].v}`
  )
  check(
    'the dashboard stock value equals the stock screen value exactly',
    Number(dashboard[0].r.stock_value) === Number(direct[0].v),
    `dashboard ${dashboard[0].r.stock_value} vs Σ ${direct[0].v}`
  )
  check(
    'stock_summary counts low and out of stock separately',
    summary[0].r.low_stock >= 0 && summary[0].r.out_of_stock >= 0 && 'variants_in_stock' in summary[0].r,
    `in stock=${summary[0].r.variants_in_stock} low=${summary[0].r.low_stock} out=${summary[0].r.out_of_stock}`
  )

  // ── Cross-tenant transfer is refused ────────────────────────────────────
  await db.exec(`
    INSERT INTO public.organizations (id, name, slug) VALUES
      ('00000000-0000-0000-0000-00000000e001', 'Other Shop', 'fuzz-other-shop')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.warehouses (id, organization_id, name, code, is_retail_floor) VALUES
      ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000e001', 'Their Room', 'THEIRS', true)
    ON CONFLICT (id) DO NOTHING;
  `)
  let crossTenant = null
  try {
    await q(`select public.transfer_stock('${warehouseA}', '00000000-0000-0000-0000-00000000e002',
               jsonb_build_array(jsonb_build_object('variant_id', '${variant}', 'qty', 1)), null)`)
  } catch (error) {
    crossTenant = String(error.message ?? error)
  }
  check(
    'stock cannot be transferred into another shop',
    /cannot transfer between organizations/.test(String(crossTenant)),
    String(crossTenant).slice(0, 50)
  )

  // ── The client still cannot reach the ledger primitive ──────────────────
  const primitiveGrants = await q(`
    select has_function_privilege('authenticated', 'public.apply_stock_movement(uuid, uuid, public.stock_movement_type, numeric, numeric, text, uuid, text)', 'EXECUTE') as ok`)
  check(
    'the new operations did not hand the ledger primitive to clients',
    primitiveGrants[0].ok === false,
    `apply_stock_movement executable by authenticated: ${primitiveGrants[0].ok}`
  )

  // Leave the session as it was found: the checks after this one load the
  // seed state and should not inherit a signed-in user.
  await db.query(`select set_config('request.jwt.claim.sub', null, false)`)
}

// ── Every permission key the client names must exist (023-era guard) ─────
//
// The catalogue is the contract between the database and the UI. Two nav
// items referenced `register.view` and `roles.view`, keys that have never
// existed, so `can()` answered false for everyone and the Register and Roles
// screens were invisible in every shop — an absence, which is exactly the
// kind of bug nobody reports. Scanning src/ for the keys the client asks for
// turns it into a build failure.
const srcFiles = []
const walkSrc = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walkSrc(path)
    // Tests carry fixtures, not the product's vocabulary.
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) srcFiles.push(path)
  }
}
walkSrc(join(root, 'src'))

const referenced = new Map()
const take = (file, key) => {
  if (!referenced.has(key)) referenced.set(key, file.replace(root + '/', ''))
}
for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/\bcan\(\s*'([^']+)'/g)) take(file, m[1])
  for (const m of text.matchAll(/\bpermission:\s*'([^']+)'/g)) take(file, m[1])
  for (const m of text.matchAll(/\brequirePermission\(\s*'([^']+)'/g)) take(file, m[1])
}

const catalogueRows = await q('select key from public.permissions')
const catalogue = new Set(catalogueRows.map((r) => r.key))
const unknownKeys = [...referenced.entries()]
  .filter(([key]) => !catalogue.has(key))
  .map(([key, file]) => `${key} (${file})`)
  .sort()

check(
  'every permission key referenced in src/ exists in the catalogue',
  unknownKeys.length === 0,
  unknownKeys.length ? unknownKeys.join(', ') : `${referenced.size} keys checked`
)

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} behavioral checks passed`)

await db.close()

if (failed.length || noRls.length) process.exit(1)
console.log('\nAll migrations applied and all assertions passed.')
