/**
 * End-to-end verification over real HTTP.
 *
 * `tools/validate-migrations.mjs` runs against PGlite and proves the schema.
 * That is necessary but not sufficient: PGlite is a superuser, so it cannot
 * tell you whether RLS lets a *signed-in shopkeeper* read their own catalogue,
 * whether PostgREST exposes an RPC, or whether the publishable key is accepted.
 * Those are exactly the things that broke on the live project and passed
 * locally.
 *
 * This script closes that gap. It provisions a throwaway user with a known
 * password, signs in through GoTrue the way the browser does, and then walks
 * the whole client path:
 *
 *     sign in → session_payload → pos_catalog read → create product
 *             → complete_sale → read the stored sale back
 *
 * Every step is an ordinary HTTPS request with the publishable key, so a
 * failure here is a failure the app would hit.
 *
 * Usage:  npm run e2e            (needs .env and .env.db)
 *
 * The user it creates is marked with a recognizable email and removed at the
 * end, along with everything the run wrote.
 */

import pg from 'pg'
import { hashSync } from 'bcryptjs'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
const PASSWORD = 'E2e!Verify#2026'

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
    // PostgREST only echoes the affected rows when asked. supabase-js sets
    // this whenever you chain .select(); a bare fetch does not, and you get a
    // 201 with an empty body that looks like a failed insert.
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

let orgId = null
/** Every user this run created, so cleanup can remove all of them. */
const members = []

async function cleanup() {
  // Delete in dependency order: the sale names the register session, the
  // session names whoever opened it, and provisioning wrote an audit row
  // naming the actor. Cascade then clears user_organizations and user_roles.
  for (const { userId: id, organizationId } of members) {
    try {
      await client.query('delete from public.audit_logs where actor_id = $1', [id])
      // stock_movements is an append-only ledger: the `movements_immutable`
      // trigger (fired by `prevent_movement_mutation()`) rejects DELETE
      // outright, which is the point of the table. This script connects as
      // postgres, so it can lift the trigger for the teardown and put it
      // straight back.
      await client.query(
        'alter table public.stock_movements disable trigger movements_immutable'
      )
      await client.query(
        `delete from public.stock_movements
          where warehouse_id in (select id from public.warehouses where organization_id = $1)`,
        [organizationId]
      )
      await client.query(
        'alter table public.stock_movements enable trigger movements_immutable'
      )
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
      await client.query('delete from auth.users where id = $1', [id])
      // The organization outlives its owner by design — a shop is not deleted
      // when a staff account is — so it has to go explicitly. Cascade clears
      // the branch, warehouse, register, catalogue and parties with it.
      await client.query('delete from public.organizations where id = $1', [organizationId])
    } catch (error) {
      console.log(`  (cleanup: could not remove test user ${id} — ${error.message.split('\n')[0]})`)
    }
  }
}

try {
  await client.connect()
  console.log(`project: ${SUPABASE_URL}\n`)

  // ── 1. Provision a signed-in-capable user ───────────────────────────────
  //
  // A real password hash in auth.users, not a hand-made JWT. GoTrue verifies
  // the bcrypt digest itself, so this exercises the same code path the login
  // form does — including the publishable-key check that a forged token
  // would skip.
  // GoTrue stores its one-time tokens as empty strings, not NULL. Leaving
  // them NULL makes the password grant fail with an unhelpful
  // "Database error querying schema", which cost a round of debugging to find
  // by diffing against a row GoTrue had created itself.
  /**
   * Provision one signed-in shopkeeper.
   *
   * Two of them, not one: the tenant-isolation checks below only mean
   * something if there is a second shop for the first user to try to reach.
   */
  async function makeMember(tag) {
    const email = `e2e-${tag}-${Date.now()}@mekholi.test`
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

    const tokenRes = await api('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email, password: PASSWORD },
    })
    const token = tokenRes.body?.access_token
    if (!token) throw new Error(`sign-in failed for ${tag}: HTTP ${tokenRes.status}`)

    // Provision through PostgREST as the user, exactly the way the app's
    // signup and onboarding screens do it — not as postgres via SQL. This is
    // the call that silently produced organization-less accounts in the
    // field, so it is the call the harness must exercise.
    const slug = `e2e-${tag}-${Date.now()}`
    const provisioned = await api('/rest/v1/rpc/provision_organization', {
      method: 'POST',
      token,
      body: {
        p_owner_user_id: userId,
        p_org_name: `E2E ${tag} Shop`,
        p_slug: slug,
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

    const pick = async (sql) =>
      (await client.query(sql, [organizationId])).rows[0]

    const member = {
      userId,
      email,
      organizationId,
      token,
      branch: (await pick('select id from public.branches where organization_id=$1 limit 1')).id,
      warehouse: (await pick('select id from public.warehouses where organization_id=$1 limit 1')).id,
      register: (await pick('select id from public.registers where organization_id=$1 limit 1')).id,
      cash: (
        await pick("select id from public.payment_methods where organization_id=$1 and is_cash limit 1")
      ).id,
    }
    members.push({ userId, organizationId })
    console.log(`${tag}: ${email} -> org ${organizationId}`)
    return member
  }

  const member = await makeMember('a')
  const intruder = await makeMember('b')
  orgId = member.organizationId
  console.log()

  // ── 2a. Sign-ups must not need an email round trip ───────────────────────
  //
  // The harness creates its users by inserting straight into auth.users with
  // email_confirmed_at = now(), so it passes whether or not the project
  // requires confirmation — which is exactly how real signups stayed broken
  // while every check was green. This asserts the project setting itself.
  const authSettings = await api('/auth/v1/settings')
  const autoconfirm = authSettings.body?.mailer_autoconfirm === true
  check(
    'sign-ups do not require email confirmation (mailer_autoconfirm)',
    autoconfirm,
    autoconfirm
      ? 'confirmed server-side'
      : 'ACTION NEEDED: turn off "Confirm email" in Supabase → Authentication → Sign In / Providers → Email'
  )

  // ── 2. The token the whole run uses came from a real password grant ──────
  const token = member.token
  check(
    'GoTrue accepts the publishable key and issues a token',
    typeof token === 'string' && token.length > 20
  )

  // ── 3. The session payload the shell renders from ───────────────────────
  const payload = await api('/rest/v1/rpc/session_payload', { method: 'POST', body: {}, token })
  // The RPC returns a jsonb object, so PostgREST hands back that object
  // directly rather than wrapping it in an array.
  const membership = payload.body?.organizations?.[0]
  check(
    'session_payload returns the membership over HTTP',
    payload.status === 200 && Boolean(membership),
    `HTTP ${payload.status}`
  )
  check(
    'the membership carries concrete permissions, never a bare *',
    Array.isArray(membership?.permissions) &&
      membership.permissions.length > 0 &&
      !membership.permissions.includes('*'),
    `${membership?.permissions?.length ?? 0} keys`
  )
  check(
    'the membership says this user owns the shop',
    membership?.is_owner === true
  )

  // ── 4. RLS actually scopes the read ─────────────────────────────────────
  const otherOrg = await api(
    "/rest/v1/pos_catalog?select=product_id&limit=200",
    { token }
  )
  check(
    'pos_catalog is readable by a signed-in member',
    otherOrg.status === 200 && Array.isArray(otherOrg.body),
    `HTTP ${otherOrg.status}`
  )

  const { branch, warehouse, register, cash } = member

  // ── 5. Write through PostgREST, exactly as the product form does ────────
  const taxInclusive = true
  const productRes = await api(
    '/rest/v1/products?select=id,name,selling_price',
    {
      method: 'POST',
      token,
      body: {
        // organization_id is NOT NULL with no default, so PostgREST cannot
        // infer it; the client has to name the tenant explicitly.
        organization_id: orgId,
        name: 'E2E VAT-inclusive soap',
        selling_price: '115.00',
        cost_price: '80.0000',
        tax_inclusive: taxInclusive,
        track_stock: false,
        is_active: true,
        metadata: {},
      },
    }
  )
  const product = Array.isArray(productRes.body) ? productRes.body[0] : null
  check(
    'RLS lets a member insert a product through PostgREST',
    productRes.status === 201 && Boolean(product?.id),
    `HTTP ${productRes.status}`
  )
  if (!product?.id) throw new Error('product insert failed — cannot continue')

  // Give it a tax row so the inclusive path is really exercised.
  const taxId = (
    await client.query(
      `insert into public.taxes (organization_id, name, rate, is_inclusive, applies_to)
       values ($1, 'VAT 15%', 15, false, 'products') returning id`,
      [orgId]
    )
  ).rows[0].id
  await client.query('update public.products set tax_id=$1 where id=$2', [taxId, product.id])

  const variantRes = await api('/rest/v1/product_variants?select=id', {
    method: 'POST',
    token,
    body: { organization_id: orgId, product_id: product.id, is_default: true },
  })
  const variant = Array.isArray(variantRes.body) ? variantRes.body[0] : null
  check(
    'the default variant is created through PostgREST',
    variantRes.status === 201 && Boolean(variant?.id),
    `HTTP ${variantRes.status}`
  )
  if (!variant?.id) throw new Error('variant insert failed — cannot continue')

  // ── 6. The catalogue read the POS renders ───────────────────────────────
  const catalog = await api(
    `/rest/v1/pos_catalog?select=name,price,tax_rate,tax_inclusive,variant_id` +
      `&variant_id=eq.${variant.id}`,
    { token }
  )
  const row = Array.isArray(catalog.body) ? catalog.body[0] : null
  check(
    'pos_catalog returns the new product with pricing resolved',
    catalog.status === 200 && row?.name === 'E2E VAT-inclusive soap' && Number(row?.price) === 115,
    `HTTP ${catalog.status} price=${row?.price ?? 'n/a'}`
  )
  check(
    'pos_catalog carries the tax rate the POS needs',
    Number(row?.tax_rate) === 15 && row?.tax_inclusive === true,
    `rate=${row?.tax_rate} inclusive=${row?.tax_inclusive}`
  )

  // ── 7. Take the sale through the RPC ────────────────────────────────────
  const openRes = await api('/rest/v1/rpc/open_register', {
    method: 'POST',
    token,
    body: { p_register_id: register, p_opening_cash: 1000 },
  })
  check('open_register is reachable over HTTP', openRes.status === 200, `HTTP ${openRes.status}`)

  const saleRes = await api('/rest/v1/rpc/complete_sale', {
    method: 'POST',
    token,
    body: {
      p_branch_id: branch,
      p_items: [{ variant_id: variant.id, qty: 1 }],
      p_payments: [{ method_id: cash, amount: 115 }],
      p_register_id: register,
      p_warehouse_id: warehouse,
    },
  })
  const sale = saleRes.body
  check(
    'complete_sale is reachable over HTTP with the publishable key',
    saleRes.status === 200 && Boolean(sale?.sale_id),
    `HTTP ${saleRes.status}${saleRes.status === 200 ? '' : ` ${JSON.stringify(sale).slice(0, 160)}`}`
  )
  if (!sale?.sale_id) throw new Error('complete_sale failed — cannot continue')

  check('the sale completed', sale.status === 'COMPLETED', String(sale.status))
  check(
    'a VAT-inclusive sale charges the shelf price, not price + VAT',
    Number(sale.total) === 115,
    `total=${sale.total} tax=${sale.tax}`
  )
  check('the invoice number is formatted', /^INV-\d{4}-\d{6}$/.test(sale.invoice_no ?? ''), sale.invoice_no)

  // ── 8. Read it back the way the sales screen does ───────────────────────
  const stored = await api(
    `/rest/v1/sales?select=invoice_no,total,tax_total,status,items:sale_items(product_name,line_total)` +
      `&id=eq.${sale.sale_id}`,
    { token }
  )
  const storedRow = Array.isArray(stored.body) ? stored.body[0] : null
  check(
    'the sales screen can read the sale back with its items',
    stored.status === 200 && Number(storedRow?.total) === 115 && storedRow?.items?.length === 1,
    `HTTP ${stored.status} total=${storedRow?.total} items=${storedRow?.items?.length ?? 0}`
  )

  // ── 9. Internal helpers must stay unreachable ───────────────────────────
  const internal = await api('/rest/v1/rpc/apply_stock_movement', {
    method: 'POST',
    token,
    body: { p_warehouse_id: warehouse, p_variant_id: variant.id, p_type: 'PURCHASE', p_quantity: 100, p_unit_cost: 0 },
  })
  // 403 rather than 404: EXECUTE is revoked from `authenticated`, so
  // PostgREST sees the function but refuses it. Either status is a block;
  // what must never happen is a 200.
  check(
    'apply_stock_movement is not callable by the client',
    internal.status >= 400,
    `HTTP ${internal.status}`
  )

  // ── 9b. The race the roadmap asks to be proven ──────────────────────────
  //
  // Two sales, one unit of stock, fired at the same time. `complete_sale`
  // locks the stock balance FOR UPDATE and re-reads the quantity inside that
  // lock, so exactly one of these can win. If it checked the quantity before
  // taking the lock, both would pass and the shop would oversell — which is
  // the kind of bug that only shows up on a busy Saturday.
  const lastProduct = await api('/rest/v1/products?select=id', {
    method: 'POST',
    token,
    body: {
      organization_id: orgId,
      name: 'E2E last-unit widget',
      selling_price: '50.00',
      cost_price: '30.0000',
      track_stock: true,
      is_active: true,
      metadata: {},
    },
  })
  const lastProductId = lastProduct.body?.[0]?.id
  const lastVariant = await api('/rest/v1/product_variants?select=id', {
    method: 'POST',
    token,
    body: { organization_id: orgId, product_id: lastProductId, is_default: true },
  })
  const lastVariantId = lastVariant.body?.[0]?.id

  // Seed exactly one unit. apply_stock_movement is deliberately not callable
  // from the client, so the harness writes the balance directly — it is
  // setting up the scenario, not testing that path.
  await client.query(
    `insert into public.stock_balances
       (organization_id, warehouse_id, variant_id, product_id, quantity, avg_unit_cost)
     values ($1, $2, $3, $4, 1, 30)
     on conflict (warehouse_id, variant_id)
     do update set quantity = 1`,
    [orgId, warehouse, lastVariantId, lastProductId]
  )

  const raceResults = await Promise.all([
    api('/rest/v1/rpc/complete_sale', {
      method: 'POST',
      token,
      body: {
        p_branch_id: branch,
        p_items: [{ variant_id: lastVariantId, qty: 1 }],
        p_payments: [{ method_id: cash, amount: 50 }],
        p_warehouse_id: warehouse,
      },
    }),
    api('/rest/v1/rpc/complete_sale', {
      method: 'POST',
      token,
      body: {
        p_branch_id: branch,
        p_items: [{ variant_id: lastVariantId, qty: 1 }],
        p_payments: [{ method_id: cash, amount: 50 }],
        p_warehouse_id: warehouse,
      },
    }),
  ])
  const winners = raceResults.filter((r) => r.status === 200)
  const losers = raceResults.filter((r) => r.status >= 400)

  check(
    'two simultaneous sales for the last unit: exactly one wins',
    winners.length === 1 && losers.length === 1,
    `statuses=${raceResults.map((r) => r.status).join(', ')}`
  )
  check(
    'the loser is refused with insufficient_stock',
    /insufficient_stock/i.test(JSON.stringify(losers[0]?.body ?? '')),
    JSON.stringify(losers[0]?.body ?? '').slice(0, 100)
  )

  const afterRace = (
    await client.query(
      'select quantity from public.stock_balances where warehouse_id=$1 and variant_id=$2',
      [warehouse, lastVariantId]
    )
  ).rows[0]
  check(
    'stock lands on zero, never negative',
    afterRace && Number(afterRace.quantity) === 0,
    `quantity=${afterRace?.quantity ?? 'n/a'}`
  )

  const raceSales = await client.query(
    `select count(*)::int as n from public.sale_items
      where variant_id = $1`,
    [lastVariantId]
  )
  check(
    'the refused sale left no partial rows behind',
    raceSales.rows[0].n === 1,
    `sale_items rows=${raceSales.rows[0].n}`
  )

  // ── 10. Cross-tenant isolation ──────────────────────────────────────────
  //
  // The second shopkeeper is an owner of their own shop, so they hold the
  // `inventory.adjust` permission legitimately. These checks therefore cannot
  // be satisfied by "does the caller have the permission" — only by the
  // function also checking *which shop* the row belongs to. adjust_stock is
  // SECURITY DEFINER and so bypasses RLS entirely, which makes that internal
  // `app.require_org` call the only thing standing between one shop and
  // another's inventory.
  const attack = await api('/rest/v1/rpc/adjust_stock', {
    method: 'POST',
    token: intruder.token,
    body: {
      p_warehouse_id: warehouse,
      p_variant_id: variant.id,
      p_quantity: 999,
      p_reason: 'damage',
      p_direction: -1,
    },
  })
  check(
    'an owner of another shop cannot adjust this shop\'s stock',
    attack.status >= 400,
    `HTTP ${attack.status}${attack.status >= 400 ? '' : ' — STOCK WAS MUTATED ACROSS TENANTS'}`
  )

  const stillThere = (
    await client.query('select quantity from public.stock_balances where variant_id=$1', [variant.id])
  ).rows[0]
  check(
    'the attacked stock level is unchanged',
    !stillThere || Number(stillThere.quantity) !== -999,
    `quantity=${stillThere?.quantity ?? '(no balance row)'}`
  )

  const leak = await api(`/rest/v1/sales?select=id&branch_id=eq.${branch}`, {
    token: intruder.token,
  })
  check(
    'a member of one shop cannot read another shop\'s sales',
    leak.status === 200 && Array.isArray(leak.body) && leak.body.length === 0,
    `HTTP ${leak.status} rows=${Array.isArray(leak.body) ? leak.body.length : 'n/a'}`
  )
} catch (error) {
  check('the run completed without throwing', false, error.message.split('\n')[0])
} finally {
  await cleanup()
  await client.end()
}

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} end-to-end checks passed`)
if (failed.length > 0) process.exit(1)
console.log('\nSign-in, RLS, PostgREST reads and the sale RPC all work over real HTTP.')
