#!/usr/bin/env node
/**
 * The Android reference, executed against the live project.
 *
 * `android/app` is a Compose shell and needs an Android SDK and an emulator, so
 * it cannot run on a build agent. `android/core` is plain Kotlin/JVM, and that
 * is deliberate: the data layer — transport, wire shapes, the catalogue read,
 * the sale RPC, the outbox, the sync engine — is where the risk is, and it runs
 * anywhere a JDK does. This script compiles it, runs the reference CLI
 * (`android/core/.../cli/Main.kt`) as a **separate process per command**, and
 * then checks the database rather than the CLI's own output.
 *
 * That separation is the point of the offline checks. The outbox is a file, the
 * till is switched off between commands, and a sale queued in one process has
 * to be sent by the next one. A drained outbox therefore proves persistence,
 * not just an in-memory queue that happened to survive a function call.
 *
 * Five runs, in the order a bad day happens:
 *
 *   1. `pos`      — a sale over a working connection, then the same request
 *                   again: the server returns the sale it already has.
 *   2. `offline`  — a sale through a transport pointed at a dead address. The
 *                   write is kept; nothing is sent.
 *   3. `sync`     — a new process drains it, and the database gains one sale.
 *   4. `sync` x2  — running it again changes nothing.
 *   5. the refusal — a *different shop's* owner replays this shop's reference:
 *                   the server says no, and the sale must still be in the
 *                   outbox afterwards, because "the server refused" and "the
 *                   uplink is gone" are different failures and only one of them
 *                   is the customer's problem. Then the rightful owner drains it.
 *
 * The authority is always the database. The CLI prints lines a human can read
 * (`key value...`), and every assertion here is paired with a query.
 *
 * Usage:  npm run e2e:android     (needs .env and .env.db; first run downloads
 *                                  the Kotlin compiler into ~/.cache/mekholi-android)
 */

import pg from 'pg'
import { hashSync } from 'bcryptjs'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCore, runtimeClasspath } from './android-build.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv(file) {
  const path = join(ROOT, file)
  if (!existsSync(path)) {
    console.error(`missing ${file} — cannot run the end-to-end check`)
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

const app = loadEnv('.env')
const db = loadEnv('.env.db')

const SUPABASE_URL = app.VITE_SUPABASE_URL
const ANON_KEY = app.VITE_SUPABASE_ANON_KEY
const PASSWORD = 'E2e!Android#2026'

const checks = []
function check(label, pass, detail = '') {
  checks.push({ label, pass: Boolean(pass), detail })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

const client = new pg.Client({
  host: db.MEKHOLI_DB_HOST,
  port: Number(db.MEKHOLI_DB_PORT),
  user: db.MEKHOLI_DB_USER,
  password: db.MEKHOLI_DB_PASSWORD,
  database: db.MEKHOLI_DB_NAME,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 60000,
})

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { apikey: ANON_KEY }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    headers.Prefer = 'return=representation'
  }
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: response.status, body: parsed }
}

/**
 * Run one CLI command in its own JVM.
 *
 * A fresh process every time, which is the honest model of a phone that was
 * closed: nothing carries over except what reached disk.
 */
function run(command, env = {}) {
  const result = spawnSync(
    'java',
    ['-cp', runtimeClasspath(), 'dev.mekholi.core.cli.MainKt', command],
    {
      encoding: 'utf8',
      // The harness must fail, not hang: a network call that never returns is
      // exactly the failure this whole phase exists to handle.
      timeout: 120_000,
      env: { ...process.env, ...env },
    }
  )
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  return { code: result.status, output, lines: output.trim().split('\n') }
}

/** `sale INV-2026-000003 4b1c…` → `{ invoice: 'INV-2026-000003', id: '4b1c…' }` */
function field(output, key) {
  const line = output
    .split('\n')
    .find((candidate) => candidate.startsWith(`${key} `))
  return line ? line.slice(key.length + 1).trim() : null
}

let workdir = null
const members = []

async function cleanup() {
  for (const { userId, organizationId } of members) {
    try {
      await client.query('delete from public.audit_logs where actor_id = $1', [userId])
      // The movement ledger rejects DELETE by design; teardown lifts the guard
      // and puts it straight back.
      await client.query('alter table public.stock_movements disable trigger movements_immutable')
      await client.query(
        `delete from public.stock_movements
          where warehouse_id in (select id from public.warehouses where organization_id = $1)`,
        [organizationId]
      )
      await client.query('alter table public.stock_movements enable trigger movements_immutable')
      await client.query(
        `delete from public.sales
          where branch_id in (select id from public.branches where organization_id = $1)`,
        [organizationId]
      )
      await client.query(
        `delete from public.register_sessions
          where register_id in (select id from public.registers where organization_id = $1)`,
        [organizationId]
      )
      await client.query('delete from auth.users where id = $1', [userId])
      await client.query('delete from public.organizations where id = $1', [organizationId])
    } catch (error) {
      console.log(`  (cleanup: could not remove test user ${userId} — ${error.message.split('\n')[0]})`)
    }
  }
  if (workdir) rmSync(workdir, { recursive: true, force: true })
}

try {
  // ── 0. The core compiles ────────────────────────────────────────────────
  console.log('building the Kotlin core…')
  const build = await buildCore({})
  check(
    'the Kotlin core compiles from source',
    existsSync(join(ROOT, 'android', 'core', 'build', 'mekholi-core.jar')),
    build.built ? `${build.sources} file(s)` : build.reason
  )

  await client.connect()
  console.log(`project: ${SUPABASE_URL}\n`)

  // ── 1. A shop, and a second shop to be refused by ───────────────────────
  async function makeMember(tag) {
    const email = `e2e-android-${tag}-${Date.now()}@mekholi.test`
    const created = await client.query(
      `insert into auth.users
         (instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, confirmation_token, recovery_token,
          email_change, email_change_token_new, email_change_token_current,
          reauthentication_token, phone_change, phone_change_token,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
               'authenticated', 'authenticated', $1, $2, now(),
               '', '', '', '', '', '', '', '',
               '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
               now(), now())
       returning id`,
      [email, hashSync(PASSWORD, 10)]
    )
    const userId = created.rows[0].id

    // Sign in before provisioning: `provision_organization` is not callable
    // anonymously, and a real signup reaches it with the token the sign-in
    // just returned.
    const tokenRes = await api('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email, password: PASSWORD },
    })
    const token = tokenRes.body?.access_token
    if (!token) throw new Error(`sign-in failed for ${tag}: HTTP ${tokenRes.status}`)

    const provisioned = await api('/rest/v1/rpc/provision_organization', {
      method: 'POST',
      token,
      body: {
        p_owner_user_id: userId,
        p_org_name: `Android E2E ${tag}`,
        p_slug: `e2e-android-${tag}-${Date.now()}`,
        p_shop_type: 'grocery',
      },
    })
    const organizationId = provisioned.body
    if (provisioned.status !== 200 || !organizationId) {
      throw new Error(
        `provision_organization failed for ${tag}: HTTP ${provisioned.status} ` +
          `${JSON.stringify(provisioned.body).slice(0, 160)}`
      )
    }

    const pick = async (sql, params = [organizationId]) =>
      (await client.query(sql, params)).rows[0]

    const member = {
      email,
      userId,
      token,
      organizationId,
      branch: (await pick('select id from public.branches where organization_id=$1 limit 1')).id,
      warehouse: (await pick('select id from public.warehouses where organization_id=$1 limit 1')).id,
      register: (await pick('select id from public.registers where organization_id=$1 limit 1')).id,
      cash: (
        await pick('select id from public.payment_methods where organization_id=$1 and is_cash limit 1')
      ).id,
    }
    members.push({ userId, organizationId })
    return member
  }

  const shop = await makeMember('a')
  const other = await makeMember('b')
  // The token below is for the harness's own seeding writes. The CLI signs in
  // for itself, with the same credentials — which is what the first check
  // asserts, and why a broken sign-in cannot hide behind this one.
  const member = { ...shop }
  console.log(`shop:  ${shop.email} → org ${shop.organizationId}`)
  console.log(`other: ${other.email} → org ${other.organizationId} (for the refusal)\n`)

  // ── 2. A product with stock, read through the same catalogue the POS uses ─
  const productRes = await api('/rest/v1/products?select=id', {
    method: 'POST',
    token: member.token,
    body: {
      organization_id: shop.organizationId,
      name: 'Android E2E widget',
      selling_price: '40.00',
      cost_price: '25.0000',
      track_stock: true,
      is_active: true,
      metadata: {},
    },
  })
  const productId = productRes.body?.[0]?.id
  if (!productId) throw new Error(`product insert failed: HTTP ${productRes.status}`)

  const variantRes = await api('/rest/v1/product_variants?select=id', {
    method: 'POST',
    token: member.token,
    body: { organization_id: shop.organizationId, product_id: productId, is_default: true },
  })
  const variantId = variantRes.body?.[0]?.id
  if (!variantId) throw new Error(`variant insert failed: HTTP ${variantRes.status}`)

  const seeded = 20
  await client.query(
    `insert into public.stock_balances
       (organization_id, warehouse_id, variant_id, product_id, quantity, avg_unit_cost)
     values ($1, $2, $3, $4, $5, 25)
     on conflict (warehouse_id, variant_id)
     do update set quantity = $5`,
    [shop.organizationId, shop.warehouse, variantId, productId, seeded]
  )

  const openRegister = await api('/rest/v1/rpc/open_register', {
    method: 'POST',
    token: member.token,
    body: { p_register_id: shop.register, p_opening_cash: 500 },
  })
  check('a till session is open for the reference client to sell into', openRegister.status === 200, `HTTP ${openRegister.status}`)

  // ── 3. The environment the reference CLI reads ───────────────────────────
  workdir = mkdtempSync(join(tmpdir(), 'mekholi-android-'))
  const outboxPath = join(workdir, 'outbox.json')
  const baseEnv = {
    MEKHOLI_SUPABASE_URL: SUPABASE_URL,
    MEKHOLI_ANON_KEY: ANON_KEY,
    MEKHOLI_EMAIL: shop.email,
    MEKHOLI_PASSWORD: PASSWORD,
    MEKHOLI_BRANCH_ID: shop.branch,
    MEKHOLI_VARIANT_ID: variantId,
    MEKHOLI_METHOD_ID: shop.cash,
    MEKHOLI_QTY: '1',
    MEKHOLI_OUTBOX: outboxPath,
    // Port 1 refuses instantly: this is what a dropped uplink looks like to the
    // transport, and it makes the offline run deterministic rather than a race.
    MEKHOLI_OFFLINE_URL: 'http://127.0.0.1:1',
  }

  const salesInShop = async () =>
    Number(
      (
        await client.query('select count(*)::int as n from public.sales where organization_id = $1', [
          shop.organizationId,
        ])
      ).rows[0].n
    )
  const saleByRef = async (ref) =>
    (
      await client.query(
        'select id, invoice_no, total, client_ref, status from public.sales where client_ref = $1',
        [ref]
      )
    ).rows
  const stockOf = async () =>
    Number(
      (
        await client.query(
          'select quantity from public.stock_balances where warehouse_id = $1 and variant_id = $2',
          [shop.warehouse, variantId]
        )
      ).rows[0]?.quantity
    )

  // ── 4. `pos`: sign in, resolve the floor, read the catalogue, sell ───────
  const pos = run('pos', baseEnv)
  check('the reference client runs under a plain JVM', pos.code === 0, pos.output.trim().split('\n').pop())
  check('it signs in through GoTrue with the publishable key', field(pos.output, 'signed-in') === shop.userId, field(pos.output, 'signed-in') ?? 'no line')
  check(
    'it resolves the shop, the branch, the warehouse and an open register',
    field(pos.output, 'org')?.startsWith(shop.organizationId) &&
      field(pos.output, 'floor') === `${shop.branch} ${shop.warehouse} ${shop.register}`,
    field(pos.output, 'floor') ?? 'no line'
  )
  const catalogLine = field(pos.output, 'catalog')
  check(
    'it reads the catalogue row and its availability',
    catalogLine?.includes(variantId) && Number(catalogLine?.match(/available=(\S+)/)?.[1]) === seeded,
    catalogLine ?? 'no line'
  )

  const saleLine = field(pos.output, 'sale')
  // `field` has already stripped the key, so the line starts with the invoice.
  const [invoice, saleId] = saleLine?.split(/\s+/) ?? []
  const printedTotal = Number(saleLine?.match(/total=(\S+)/)?.[1])
  const clientRef = field(pos.output, 'client-ref')
  const firstRows = await saleByRef(clientRef)

  check(
    'it takes a sale through complete_sale',
    /^INV-\d{4}-\d{6}$/.test(invoice ?? '') && Boolean(saleId),
    saleLine ?? 'no line'
  )
  check(
    'and the client’s own arithmetic agrees with the server’s',
    printedTotal === 40 && Number(firstRows[0]?.total) === printedTotal,
    `client=${printedTotal} server=${firstRows[0]?.total ?? 'n/a'}`
  )
  check(
    'it mints the reference before the first attempt',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clientRef ?? ''),
    clientRef ?? 'no line'
  )
  check(
    'the sale is in the database under that reference',
    firstRows.length === 1 && firstRows[0].invoice_no === invoice,
    `rows=${firstRows.length} invoice=${firstRows[0]?.invoice_no ?? 'n/a'}`
  )

  // The same request, sent twice. This is the property that makes an offline
  // till safe: a timeout after the server committed must not create a twin.
  const replayLine = field(pos.output, 'replay')
  check(
    'resending the same request returns the sale already stored',
    replayLine === `${invoice} ${saleId} same=true`,
    replayLine ?? 'no line'
  )
  check(
    'and the shop holds exactly one sale for it',
    (await salesInShop()) === 1 && (await saleByRef(clientRef)).length === 1,
    `sales=${await salesInShop()} rows=${(await saleByRef(clientRef)).length}`
  )
  check('the sale moved stock once', (await stockOf()) === seeded - 1, `${seeded} → ${await stockOf()}`)

  // ── 5. `offline`: the uplink is gone, the shop is not closed ────────────
  const beforeOffline = await salesInShop()
  const offline = run('offline', baseEnv)
  const offlineRef = field(offline.output, 'queued')?.split(/\s+/)[0]
  check(
    'a sale taken through a dead connection is queued, not lost',
    offline.code === 0 && /^[0-9a-f-]{36}$/.test(offlineRef ?? '') &&
      field(offline.output, 'queued')?.includes('remaining=1'),
    field(offline.output, 'queued') ?? offline.output.trim().split('\n')[0]
  )
  check(
    'and nothing about it reached the server',
    (await salesInShop()) === beforeOffline && (await saleByRef(offlineRef)).length === 0,
    `sales=${await salesInShop()} rows=${(await saleByRef(offlineRef)).length}`
  )
  const onDisk = existsSync(outboxPath) ? readFileSync(outboxPath, 'utf8') : ''
  check(
    'the queue is on disk, in a file the next process will find',
    onDisk.includes(offlineRef) && onDisk.includes('sale.complete'),
    `${onDisk.length} bytes at ${outboxPath}`
  )

  // ── 6. `sync`: a new process drains it ──────────────────────────────────
  const sync = run('sync', baseEnv)
  check(
    'the next process finds the queued sale and sends it',
    field(sync.output, 'waiting')?.startsWith(offlineRef) && field(sync.output, 'drained') === 'sent=1 failed=0 remaining=0',
    `${field(sync.output, 'waiting') ?? 'no waiting line'} | ${field(sync.output, 'drained') ?? 'no drained line'}`
  )
  check(
    'the queue reports itself settled',
    field(sync.output, 'status') === 'pending=0 settled=true',
    field(sync.output, 'status') ?? 'no line'
  )
  const syncedRows = await saleByRef(offlineRef)
  check(
    'the server numbered it and stored exactly one sale',
    syncedRows.length === 1 && /^INV-\d{4}-\d{6}$/.test(syncedRows[0].invoice_no),
    `rows=${syncedRows.length} invoice=${syncedRows[0]?.invoice_no ?? 'n/a'}`
  )
  check(
    'the till’s total matches the server’s',
    Number(syncedRows[0]?.total) === 40,
    `total=${syncedRows[0]?.total ?? 'n/a'}`
  )
  check(
    'and the replay moved stock once, not twice',
    (await stockOf()) === seeded - 2,
    `${seeded} → ${await stockOf()}`
  )
  const movements = await client.query(
    'select count(*)::int as n from public.stock_movements where reference_id = $1',
    [syncedRows[0]?.id ?? null]
  )
  check('one movement was written for it', movements.rows[0].n === 1, `movements=${movements.rows[0].n}`)

  // Running it again is what a shop does when it is not sure whether it worked.
  const again = run('sync', baseEnv)
  check(
    'running the sync again changes nothing',
    field(again.output, 'drained') === 'sent=0 failed=0 remaining=0' &&
      (await salesInShop()) === 2,
    `${field(again.output, 'drained') ?? 'no line'} | sales=${await salesInShop()}`
  )

  // ── 7. The refusal: the server said no, so the sale stays ───────────────
  //
  // A different shop's owner replays this shop's reference. That is refused —
  // and the write has to survive the refusal. If a refusal discarded it, the
  // shop would lose money and never know; the only failure allowed to drop a
  // sale is a human pressing Discard.
  const second = run('offline', baseEnv)
  const refusedRef = field(second.output, 'queued')?.split(/\s+/)[0]
  const foreignSync = run('sync', { ...baseEnv, MEKHOLI_EMAIL: other.email, MEKHOLI_PASSWORD: PASSWORD })
  check(
    'a refused replay is reported as a refusal, not as a lost connection',
    /forbidden|permission|refused/i.test(field(foreignSync.output, 'failed') ?? '') &&
      field(foreignSync.output, 'drained') === 'sent=0 failed=1 remaining=1',
    `${field(foreignSync.output, 'failed') ?? 'no failed line'} | ${field(foreignSync.output, 'drained') ?? 'no drained line'}`
  )
  // Parked as a *failure*, not as pending: pending means "will be sent", and a
  // refusal will be refused again until something changes.
  check(
    'the refused sale is still queued, and still not in the shop',
    field(foreignSync.output, 'status') === 'pending=0 settled=false' &&
      (await saleByRef(refusedRef)).length === 0 &&
      readFileSync(outboxPath, 'utf8').includes(refusedRef),
    `rows=${(await saleByRef(refusedRef)).length}`
  )

  // A refusal parks the write until a person asks for it again — the same
  // "Try again" the till's queue panel offers — so the rescue is the `retry`
  // command, not a plain drain.
  const rescue = run('retry', baseEnv)
  check(
    'the rightful owner retries it, and the sale is not lost',
    field(rescue.output, 'requeued') === '1' &&
      field(rescue.output, 'drained') === 'sent=1 failed=0 remaining=0' &&
      (await salesInShop()) === 3 &&
      (await saleByRef(refusedRef)).length === 1,
    `${field(rescue.output, 'drained') ?? 'no line'} | rows=${(await saleByRef(refusedRef)).length}`
  )
  check(
    'three sales, three receipts, and stock that agrees',
    (await stockOf()) === seeded - 3,
    `${seeded} → ${await stockOf()}`
  )

  // ── 8. The contract this client was written against ─────────────────────
  const contract = JSON.parse(readFileSync(join(ROOT, 'contracts', 'api-contract.json'), 'utf8'))
  const completeSale = contract.rpc.complete_sale
  check(
    'the generated contract describes the RPC the client just used',
    Boolean(completeSale) && completeSale.params.some((param) => param.name === 'p_client_ref'),
    `params=${completeSale?.params.length ?? 0}`
  )
  check(
    'and it still describes the catalogue the client reads',
    Object.keys(contract.relations.pos_catalog?.columns ?? {}).length > 10,
    `columns=${Object.keys(contract.relations.pos_catalog?.columns ?? {}).length}`
  )
} catch (error) {
  check('the run completed without throwing', false, error.message.split('\n')[0])
} finally {
  await cleanup()
  await client.end()
}

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} Android end-to-end checks passed`)
if (failed.length > 0) process.exit(1)
console.log(
  '\nThe Kotlin reference signs in, reads the catalogue, sells, queues offline,\n' +
    'survives a restart and a refusal, and agrees with the database.'
)
