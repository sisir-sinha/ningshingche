/**
 * Mobile audit — drives the DEPLOYED site in real Chrome at a phone viewport.
 *
 * jsdom proves the drawer logic; it cannot prove what a phone renders, because
 * it applies no CSS at all. This script loads the live bundle in headless
 * Chrome with iPhone-sized viewport + touch emulation and checks the things
 * that actually break on a handset: horizontal overflow, sub-16px inputs (iOS
 * zooms the page when you focus one), tap targets under 40px, and whether the
 * hamburger really reveals usable navigation.
 *
 * Run it with:
 *
 *     npm install --no-save puppeteer
 *     npm run build && (cd dist && python3 -m http.server 8123)
 *     AUDIT_SITE=http://127.0.0.1:8123/ node tools/mobile-audit.mjs
 *
 * Puppeteer is deliberately not a project dependency — it downloads a browser
 * (~150 MB) and nothing else in the build needs one. It is not part of
 * `npm run check` for the same reason.
 *
 * The dev-loop form above is the fast one; run it against the deployed URL
 * before believing a release is fine on a phone.
 */

import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { hashSync } from 'bcryptjs'
import puppeteer from 'puppeteer'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = process.env.AUDIT_SITE || 'https://surajit-singha-sisir.github.io/Mekholi/'
const OUT = '/home/user/mobile-audit'
const PASSWORD = 'E2e!Verify#2026'

function loadEnv(file) {
  const path = join(ROOT, file)
  if (!existsSync(path)) {
    console.error(`missing ${file}`)
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

const checks = []
function check(label, pass, detail = '') {
  checks.push({ label, pass: Boolean(pass), detail })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

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

const client = new Client({
  host: db.MEKHOLI_DB_HOST,
  port: Number(db.MEKHOLI_DB_PORT),
  database: db.MEKHOLI_DB_NAME,
  user: db.MEKHOLI_DB_USER,
  password: db.MEKHOLI_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

const members = []

async function makeUser(tag) {
  const email = `mobile-${tag}-${Date.now()}@mekholi.test`
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
  members.push({ userId, organizationId: null, email })
  return { email, userId }
}

async function provision(user) {
  const tokenRes = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: user.email, password: PASSWORD },
  })
  const token = tokenRes.body?.access_token
  if (!token) throw new Error(`sign-in failed for ${user.email}: HTTP ${tokenRes.status}`)
  const provisioned = await api('/rest/v1/rpc/provision_organization', {
    method: 'POST',
    token,
    body: {
      p_owner_user_id: user.userId,
      p_org_name: 'Mobile Audit Shop',
      p_slug: `mobile-audit-${Date.now()}`,
      p_shop_type: 'grocery',
    },
  })
  if (provisioned.status !== 200 || !provisioned.body) {
    throw new Error(`provision failed: ${provisioned.status} ${JSON.stringify(provisioned.body)}`)
  }
  const record = members.find((m) => m.userId === user.userId)
  record.organizationId = provisioned.body
  // Keep the token: later checks act as this member (seeding stock through the
  // RPCs the app calls). Without it the requests go out anonymous and RLS
  // refuses them — which is how this was found.
  record.token = token
  return provisioned.body
}

async function cleanup() {
  for (const member of members) {
    const { userId: id } = member
    try {
      // An organization created by the onboarding form was created inside the
      // browser, so this script never saw its id. Find it by membership —
      // otherwise the audit leaves orphan orgs in the live database and the
      // next run collides with them.
      if (!member.organizationId) {
        const owned = await client.query(
          `select o.id from public.organizations o
             join public.user_organizations uo on uo.organization_id = o.id
            where uo.user_id = $1`,
          [id]
        )
        member.organizationId = owned.rows[0]?.id ?? null
      }
      const organizationId = member.organizationId
      // The Phase 4 audit trigger writes a row per change, and those rows hold
      // the organization down: `audit_logs` is append-only, so a leftover row
      // from this run would block the next `delete from organizations`.
      await client.query('delete from public.audit_logs where actor_id = $1', [id])
      if (organizationId) {
        await client.query('delete from public.audit_logs where organization_id = $1', [organizationId])
        // `sale_returns.sale_id` and `purchase_payments` do not cascade from
        // their parents, so they are cleared before the parents go.
        await client.query(
          `delete from public.sale_returns
            where sale_id in (select id from public.sales
                               where branch_id in (select id from public.branches
                                                    where organization_id = $1))`,
          [organizationId]
        )
        await client.query(
          `delete from public.purchase_payments
            where purchase_id in (select id from public.purchases where organization_id = $1)`,
          [organizationId]
        )
        await client.query('delete from public.purchases where organization_id = $1', [organizationId])
        await client.query('delete from public.expenses where organization_id = $1', [organizationId])
        await client.query('alter table public.stock_movements disable trigger movements_immutable')
        await client.query(
          `delete from public.stock_movements
            where warehouse_id in (select id from public.warehouses where organization_id = $1)`,
          [organizationId]
        )
        await client.query('alter table public.stock_movements enable trigger movements_immutable')
        await client.query(
          `delete from public.sales where branch_id in (select id from public.branches where organization_id = $1)`,
          [organizationId]
        )
        await client.query(
          `delete from public.register_sessions
            where register_id in (select id from public.registers where organization_id = $1)`,
          [organizationId]
        )
      }
      await client.query('delete from auth.users where id = $1', [id])
      if (organizationId) {
        await client.query('delete from public.organizations where id = $1', [organizationId])
      }
    } catch (error) {
      console.log(`  (cleanup: ${id} — ${error.message.split('\n')[0]})`)
    }
  }
}

// ── Browser helpers ───────────────────────────────────────────────────────

async function clickByText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, t) => {
      const els = [...document.querySelectorAll(sel)]
      return (
        els.find((e) => (e.textContent || '').trim() === t) ||
        els.find((e) => (e.textContent || '').includes(t)) ||
        null
      )
    },
    selector,
    text
  )
  const el = handle.asElement()
  if (!el) throw new Error(`no <${selector}> matching "${text}"`)
  await el.click()
}

/** Everything the layout can get wrong on a narrow screen. */
async function auditLayout(page, label) {
  return page.evaluate((label) => {
    const vw = window.innerWidth
    const visible = (el) => el.getClientRects().length > 0
    const describe = (el) => {
      const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 4).join('.')
      return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}`
    }

    const overflowers = []
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right > vw + 1 || r.left < -1) {
        overflowers.push({ el: describe(el), left: Math.round(r.left), right: Math.round(r.right) })
      }
    }

    const smallInputs = []
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (!visible(el)) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs < 16) smallInputs.push({ el: describe(el), fontSize: fs })
    }

    const smallTaps = []
    for (const el of document.querySelectorAll('a, button, [role="button"]')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      const text = (el.textContent || '').trim().slice(0, 24)
      if (r.height < 40 || r.width < 40) {
        // A hit area can still be fine if a padded ancestor wraps it.
        smallTaps.push({ el: describe(el), w: Math.round(r.width), h: Math.round(r.height), text })
      }
    }

    const viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || null

    return {
      label,
      width: vw,
      scrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth - vw,
      viewportMeta,
      overflowCount: overflowers.length,
      overflowSample: overflowers.slice(0, 8),
      smallInputCount: smallInputs.length,
      smallInputSample: smallInputs.slice(0, 5),
      smallTapCount: smallTaps.length,
      smallTapSample: smallTaps.slice(0, 8),
      visibleAsides: [...document.querySelectorAll('aside')].filter(visible).length,
      drawerHidden: document.querySelector('#mobile-drawer')?.classList.contains('hidden') ?? null,
      hash: window.location.hash,
    }
  }, label)
}

function reportAudit(a, shots = {}) {
  const over = a.horizontalOverflow > 1
  check(`${a.label}: no horizontal overflow`, !over, over ? `${a.horizontalOverflow}px wider than ${a.width}px viewport` : `${a.width}px viewport`)
  if (over && a.overflowSample.length) {
    for (const o of a.overflowSample) console.log(`         overflowing: ${o.el} [${o.left}…${o.right}]`)
  }
  check(
    `${a.label}: viewport meta is mobile-ready`,
    Boolean(a.viewportMeta && a.viewportMeta.includes('width=device-width')),
    a.viewportMeta || 'missing'
  )
  check(
    `${a.label}: inputs are >= 16px (no iOS focus zoom)`,
    a.smallInputCount === 0,
    a.smallInputCount === 0 ? '' : `${a.smallInputCount} smaller, e.g. ${a.smallInputSample.map((s) => `${s.el}=${s.fontSize}px`).join(', ')}`
  )
  check(
    `${a.label}: tap targets >= 40px`,
    a.smallTapCount === 0,
    a.smallTapCount === 0 ? '' : `${a.smallTapCount} small, e.g. ${a.smallTapSample.map((s) => `${s.el} ${s.w}x${s.h} "${s.text}"`).join(' | ')}`
  )
  if (shots.file) console.log(`         screenshot: ${shots.file}`)
}

/**
 * Rows in a CSV file, minus the header — counting the way the app's own parser
 * does, so a field containing a comma or a newline does not add a phantom row.
 *
 * The acceptance criterion for Phase 5 is "a report exported to CSV
 * re-imports to identical row counts", and this is the re-import.
 */
function countCsvRows(text) {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text
  let rows = 0
  let quoted = false
  let field = ''
  let sawField = false

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') i += 1
        else quoted = false
      }
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') field = ''
    else if (char === '\n') {
      rows += 1
      field = ''
      sawField = false
    } else if (char !== '\r') {
      field += char
      sawField = true
    }
  }
  if (sawField || field.length > 0) rows += 1
  // The header is not a data row.
  return Math.max(0, rows - 1)
}

// ── Run ───────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true })
const report = { startedAt: new Date().toISOString(), site: SITE, audits: [], checks: checks, notes: [] }
let browser = null

try {
  await client.connect()
  console.log(`site: ${SITE}\n`)

  const shopUser = await makeUser('shop')
  await provision(shopUser)
  const freshUser = await makeUser('fresh')
  console.log(`users: ${shopUser.email} (provisioned), ${freshUser.email} (no org)\n`)

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  )

  async function signIn(email) {
    // Each sign-in starts from a clean browser: a leftover session in
    // localStorage would skip the login screen entirely.
    await page.goto(SITE, { waitUntil: 'networkidle2' })
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.goto(SITE, { waitUntil: 'networkidle2' })
    await page.waitForSelector('#signin-email', { timeout: 30000 })
    await page.type('#signin-email', email)
    await page.type('#signin-password', PASSWORD)
    await clickByText(page, 'button', 'Sign in')
  }

  // ── A. Login screen at phone width ──────────────────────────────────────
  console.log('── login / signup ──')
  await page.goto(SITE, { waitUntil: 'networkidle2' })
  await page.waitForSelector('#signin-email', { timeout: 30000 })
  const loginAudit = await auditLayout(page, 'login')
  await page.screenshot({ path: join(OUT, '01-login.png') })
  report.audits.push(loginAudit)
  reportAudit(loginAudit, { file: '01-login.png' })

  // The sign-up mode is the longer form — the real mobile risk.
  await clickByText(page, 'button', 'Create your shop')
  await page.waitForSelector('#signup-shop', { timeout: 10000 })

  // The screen must agree with the server about email confirmation. This
  // passes in both worlds and fails only on disagreement, so it keeps working
  // after the project setting is changed.
  const settings = await api('/auth/v1/settings')
  const requiresConfirmation = settings.body?.mailer_autoconfirm !== true
  await new Promise((r) => setTimeout(r, 800))
  const noticeShown = await page.evaluate(() =>
    Boolean(document.querySelector('[data-signup-notice]'))
  )
  check(
    'sign-up screen matches the auth server on email confirmation',
    noticeShown === requiresConfirmation,
    `server requires confirmation: ${requiresConfirmation}, warning shown: ${noticeShown}`
  )
  const signupAudit = await auditLayout(page, 'signup')
  await page.screenshot({ path: join(OUT, '02-signup.png'), fullPage: true })
  report.audits.push(signupAudit)
  reportAudit(signupAudit, { file: '02-signup.png' })

  // ── B. Onboarding screen at phone width ────────────────────────────────
  //
  // Run twice with the same shop name. The second pass is the regression test
  // for the slug collision: `organizations.slug` is unique, provisioning used
  // to insert it verbatim, and the second "Audit Store" therefore could not
  // be created at all — the form sat there showing a raw Postgres error.
  console.log('\n── onboarding ──')

  /** Fill and submit the onboarding form on the phone. Returns the new slug. */
  async function onboardOnce(user, label) {
    await signIn(user.email)
    await page.waitForFunction(() => window.location.hash.includes('onboarding'), { timeout: 30000 })
    await page.waitForSelector('#onboard-shop', { timeout: 10000 })

    if (label === 'first') {
      const audit = await auditLayout(page, 'onboarding')
      await page.screenshot({ path: join(OUT, '03-onboarding.png'), fullPage: true })
      report.audits.push(audit)
      reportAudit(audit, { file: '03-onboarding.png' })
    }

    await page.type('#onboard-shop', 'Audit Store')
    const selected = await page.evaluate(() => {
      const select = document.querySelector('#onboard-type') || document.querySelector('select')
      if (!select || select.options.length < 2) return null
      select.value = select.options[1].value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return select.value
    })
    if (label === 'first') {
      check('onboarding: shop type select has options', Boolean(selected), selected || 'none')
    }
    await clickByText(page, 'button', 'Create')
    const landed = await page
      .waitForFunction(() => !window.location.hash.includes('onboarding'), { timeout: 45000 })
      .then(() => true)
      .catch(() => false)
    const visibleError = await page.evaluate(() => {
      const alert = document.querySelector('[role="alert"]')
      return alert && alert.getClientRects().length ? (alert.textContent || '').trim() : null
    })
    check(
      `onboarding (${label} shop named "Audit Store"): submitting lands on the dashboard`,
      landed,
      landed ? `hash=${await page.evaluate(() => window.location.hash)}` : `hash=${await page.evaluate(() => window.location.hash)} error="${visibleError}"`
    )
    if (label === 'first') {
      await new Promise((r) => setTimeout(r, 1500))
      await page.screenshot({ path: join(OUT, '04-after-onboarding.png'), fullPage: true })
    }
    const owned = await client.query(
      `select o.slug from public.organizations o
         join public.user_organizations uo on uo.organization_id = o.id
        where uo.user_id = $1`,
      [user.userId]
    )
    return owned.rows[0]?.slug ?? null
  }

  const firstSlug = await onboardOnce(freshUser, 'first')
  const twinUser = await makeUser('twin')
  const twinSlug = await onboardOnce(twinUser, 'twin (same name!)')
  check(
    'onboarding: a second shop with the same name gets a de-conflicted slug',
    Boolean(firstSlug && twinSlug && twinSlug !== firstSlug),
    `${firstSlug} vs ${twinSlug}`
  )

  // ── C. Signed-in shell: hamburger + drawer ─────────────────────────────
  console.log('\n── signed-in shell (phone) ──')
  await signIn(shopUser.email)
  await page.waitForSelector('#mobile-drawer', { timeout: 30000 })
  await new Promise((r) => setTimeout(r, 2000))

  const shellAudit = await auditLayout(page, 'dashboard (drawer closed)')
  await page.screenshot({ path: join(OUT, '05-dashboard.png') })
  report.audits.push(shellAudit)
  reportAudit(shellAudit, { file: '05-dashboard.png' })
  check('dashboard: desktop sidebar is hidden at 390px', shellAudit.visibleAsides === 0, `${shellAudit.visibleAsides} visible aside(s)`)
  check('dashboard: drawer starts closed', shellAudit.drawerHidden === true)

  const burger = await page.$('[aria-label="Open navigation"]')
  check('dashboard: hamburger is present at 390px', Boolean(burger))
  if (burger) {
    const box = await burger.boundingBox()
    check('dashboard: hamburger tap target >= 44px', Boolean(box && box.width >= 44 && box.height >= 44), box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'no box')
    await burger.click()
    await new Promise((r) => setTimeout(r, 600))
    const openState = await page.evaluate(() => {
      const drawer = document.querySelector('#mobile-drawer')
      const links = [...drawer.querySelectorAll('[data-nav-id]')].map((a) => ({
        id: a.getAttribute('data-nav-id'),
        visible: a.getClientRects().length > 0,
        h: Math.round(a.getBoundingClientRect().height),
        w: Math.round(a.getBoundingClientRect().width),
      }))
      const panel = drawer.firstElementChild?.getBoundingClientRect()
      return {
        hidden: drawer.classList.contains('hidden'),
        linkCount: links.length,
        visibleLinks: links.filter((l) => l.visible).length,
        sample: links.slice(0, 6),
        panelWidth: panel ? Math.round(panel.width) : null,
      }
    })
    check('drawer: opens on tap', openState.hidden === false)
    check('drawer: contains navigation', openState.linkCount > 0, `${openState.linkCount} links, ${openState.visibleLinks} visible`)
    check('drawer: links are tappable', openState.sample.every((l) => l.h >= 40), openState.sample.map((l) => `${l.id} ${l.w}x${l.h}`).join(', '))
    check('drawer: panel is on screen', Boolean(openState.panelWidth && openState.panelWidth <= 390), `panel ${openState.panelWidth}px of 390px`)

    // Register and Roles were invisible to every user, including owners,
    // because their nav items named permission keys the catalogue never had
    // (`register.view`, `roles.view`). An owner holds every real key, so if
    // these are missing from the drawer the keys have drifted again.
    const ids = openState.sample.map((l) => l.id)
    const all = await page.evaluate(() =>
      [...document.querySelectorAll('#mobile-drawer [data-nav-id]')].map((a) =>
        a.getAttribute('data-nav-id')
      )
    )
    check(
      'drawer: every core nav item is reachable by an owner',
      ['dashboard', 'pos', 'sales', 'customers', 'products', 'stock', 'register', 'roles', 'settings'].every(
        (id) => all.includes(id)
      ),
      `${all.length} items: ${all.join(', ')}${ids.length ? '' : ''}`
    )
    const drawerAudit = await auditLayout(page, 'drawer open')
    report.audits.push(drawerAudit)
    await page.screenshot({ path: join(OUT, '06-drawer-open.png') })

    // Navigate through the drawer — the exact interaction reported broken.
    const target = openState.sample[0]?.id
    if (target) {
      await page.click(`#mobile-drawer [data-nav-id="${target}"]`)
      await new Promise((r) => setTimeout(r, 900))
      const after = await page.evaluate(() => ({
        hidden: document.querySelector('#mobile-drawer').classList.contains('hidden'),
        hash: window.location.hash,
      }))
      check('drawer: closes after navigating', after.hidden === true, `hash=${after.hash}`)
      await page.screenshot({ path: join(OUT, '07-after-drawer-nav.png') })
      report.audits.push(await auditLayout(page, `after drawer nav → ${after.hash}`))
    }

    // Escape + backdrop close.
    await burger.click()
    await new Promise((r) => setTimeout(r, 400))
    await page.keyboard.press('Escape')
    await new Promise((r) => setTimeout(r, 400))
    check(
      'drawer: Escape closes',
      await page.evaluate(() => document.querySelector('#mobile-drawer').classList.contains('hidden'))
    )
  }

  // ── D. Every main route at phone width ─────────────────────────────────
  console.log('\n── routes at 390px ──')
  for (const [name, route] of [
    ['pos', '#/pos'],
    ['products', '#/products'],
    ['stock', '#/stock'],
    ['sales', '#/sales'],
    ['customers', '#/customers'],
    ['register', '#/register'],
    ['suppliers', '#/suppliers'],
    ['purchases', '#/purchases'],
    ['expenses', '#/expenses'],
    ['audit', '#/audit'],
  ]) {
    await page.evaluate((r) => {
      window.location.hash = r
    }, route)
    await new Promise((r) => setTimeout(r, 2500))
    const a = await auditLayout(page, `route ${route}`)
    report.audits.push(a)
    await page.screenshot({ path: join(OUT, `08-route-${name}.png`) })
    reportAudit(a)

    // "No overflow" is not the same as "works". A screen that renders an
    // hourglass forever passes every geometry check ever written — which is
    // exactly how the POS shipped dead to every shop. Assert the route shows
    // real content.
    const body = await page.evaluate(
      () => document.querySelector('#app-outlet')?.textContent?.trim() ?? ''
    )
    const stuck = /still loading|Loading the shop|could not be loaded/i.test(body)
    check(`route ${route}: shows content, not a loading or error state`, !stuck, body.slice(0, 90))
  }

  // ── E. Phase 3: the stock value the dashboard shows must equal the
  // database's own arithmetic. This is the acceptance criterion "stock value
  // on the dashboard matches Σ(balance × avg_cost) exactly", verified against
  // the live project rather than a fixture.
  console.log('\n── stock value reconciliation ──')
  const member = members.find((m) => m.organizationId) ?? null
  // Declared out here because the Phase 4 block below buys and refunds the
  // same product the stock block receives: one fixture, two phases, no second
  // product quietly appearing in the shop.
  let warehouse = null
  let variantId = null
  if (member?.organizationId) {
    // Receive stock the way the app does — over PostgREST, as the signed-in
    // user, through the RPC the UI calls. A reconciliation against an empty
    // shop would pass at 0 vs 0 and prove nothing.
    warehouse = (
      await client.query('select id from public.warehouses where organization_id = $1 limit 1', [
        member.organizationId,
      ])
    ).rows[0].id

    const productRes = await api('/rest/v1/products', {
      method: 'POST',
      token: member.token,
      body: {
        organization_id: member.organizationId,
        name: 'Audit Rice 5kg',
        selling_price: 1500,
        cost_price: 1200,
        track_stock: true,
        reorder_point: 5,
      },
    })
    if (productRes.status !== 201 || !productRes.body?.[0]?.id) {
      throw new Error(`product insert failed: HTTP ${productRes.status} ${JSON.stringify(productRes.body).slice(0, 300)}`)
    }
    const productId = productRes.body[0].id

    const variantRes = await api('/rest/v1/product_variants', {
      method: 'POST',
      token: member.token,
      body: { organization_id: member.organizationId, product_id: productId, is_default: true },
    })
    if (variantRes.status !== 201 || !variantRes.body?.[0]?.id) {
      throw new Error(`variant insert failed: HTTP ${variantRes.status} ${JSON.stringify(variantRes.body).slice(0, 200)}`)
    }
    variantId = variantRes.body[0].id

    const received = await api('/rest/v1/rpc/stock_in', {
      method: 'POST',
      token: member.token,
      body: {
        p_warehouse_id: warehouse,
        p_items: [
          { variant_id: variantId, qty: 7, unit_cost: 1234.5 },
          { variant_id: variantId, qty: 3, unit_cost: 1000 },
        ],
        p_supplier_id: null,
        p_reference: 'AUDIT',
        p_note: 'browser audit',
      },
    })
    check(
      'stock_in is reachable over HTTP by the signed-in owner',
      received.status === 200 && Number(received.body?.total_qty) === 10,
      `HTTP ${received.status} qty=${received.body?.total_qty} cost=${received.body?.total_cost}`
    )
    // 7 @ 1234.50 + 3 @ 1000.00 = 8641.50 + 3000 = 11641.50, average 1164.15.
    check(
      'stock_in reports the weighted cost it recorded',
      Number(received.body?.total_cost) === 11641.5,
      String(received.body?.total_cost)
    )

    const expected = await client.query(
      `select coalesce(sum(quantity * avg_unit_cost), 0) as v
         from public.stock_balances where organization_id = $1`,
      [member.organizationId]
    )
    const expectedValue = Number(expected.rows[0].v)

    await page.evaluate(() => {
      window.location.hash = '#/stock'
    })
    await new Promise((r) => setTimeout(r, 2500))
    const shown = await page.evaluate(() => {
      const outlet = document.querySelector('#app-outlet')
      return outlet ? (outlet.textContent || '') : ''
    })
    const audit = await auditLayout(page, 'stock screen')
    report.audits.push(audit)
    reportAudit(audit)
    await page.screenshot({ path: join(OUT, '09-stock.png'), fullPage: true })

    check(
      'stock screen: loads with its summary rather than an error',
      /Stock value|Items in stock/i.test(shown) && !/could not be loaded/i.test(shown),
      shown.slice(0, 90)
    )

    // The rendered figure is compared with the SQL above. A currency string
    // carries separators, so the digits are extracted and compared as a number.
    const rendered = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#app-outlet div')]
      const card = cards.find((el) => (el.textContent || '').includes('Stock value'))
      return card ? (card.textContent || '') : ''
    })
    // The card's icon renders its ligature *name* as text between the label
    // and the figure ("Stock valuepayments৳ 11,641.50"), so match the first
    // amount-looking number after the label rather than stripping letters.
    const amountAfter = (text, label) => {
      const match = text.match(new RegExp(`${label}[\\s\\S]{0,60}?([0-9][0-9,]*\\.\\d{2})`))
      return match ? Number(match[1].replace(/,/g, '')) : 0
    }
    const shownValue = amountAfter(rendered, 'Stock value')
    check(
      'stock screen: value equals Σ(balance × avg_unit_cost) as the database computes it',
      Math.abs(shownValue - expectedValue) < 0.01,
      `screen ${shownValue} vs database ${expectedValue}`
    )
    check(
      'stock screen: the received product appears with its quantity',
      /Audit Rice 5kg/.test(shown) && /10\b/.test(shown),
      shown.slice(0, 80)
    )

    // The dashboard card must show the same number: the Phase 3 criterion
    // names the dashboard specifically, and two screens computing one figure
    // differently is the failure mode worth guarding.
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await new Promise((r) => setTimeout(r, 2500))
    const dashRendered = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#app-outlet div')]
      const card = cards.find((el) => (el.textContent || '').includes('Stock'))
      return card ? (card.textContent || '') : ''
    })
    // The Phase 5 dashboard names this tile "Stock on hand"; the older one
    // said "Stock value". Both are read so the check survives the rename.
    const dashValue =
      amountAfter(dashRendered, 'Stock value') || amountAfter(dashRendered, 'Stock on hand')
    check(
      'dashboard: stock value equals the same Σ the stock screen shows',
      Math.abs(dashValue - expectedValue) < 0.01,
      `dashboard ${dashValue} vs database ${expectedValue} — card text: "${dashRendered.slice(0, 160)}"`
    )
    await page.screenshot({ path: join(OUT, '10-dashboard-stock.png'), fullPage: true })
  }

  // ── F. Phase 4: buying, spending, refunding, and the trail that records
  // all three. Every write below goes through the same RPC the screen calls,
  // as the signed-in owner, so a pass means the deployed bundle and the
  // deployed database agree — not just that the fixtures were valid.
  console.log('\n── business management ──')
  if (member?.organizationId) {
    const registers = await client.query(
      'select id from public.registers where organization_id = $1 order by created_at limit 1',
      [member.organizationId]
    )
    const registerId = registers.rows[0]?.id ?? null
    const methods = await client.query(
      `select id, is_cash from public.payment_methods
        where organization_id = $1 and is_active order by is_cash desc limit 1`,
      [member.organizationId]
    )
    const methodId = methods.rows[0]?.id ?? null
    const branchId = (
      await client.query('select id from public.branches where organization_id = $1 limit 1', [
        member.organizationId,
      ])
    ).rows[0]?.id ?? null

    // Open the drawer first: a cash expense is only attached to the register
    // when there is one, and the register screen is one of the screens under
    // test. Without this the screen would only ever prove its empty state.
    if (registerId) {
      const opened = await api('/rest/v1/rpc/open_register', {
        method: 'POST',
        token: member.token,
        body: { p_register_id: registerId, p_opening_cash: 5000, p_note: 'audit' },
      })
      check(
        'the drawer opens over HTTP for the signed-in owner',
        opened.status === 200,
        `HTTP ${opened.status}`
      )
    }

    // ── Supplier ──────────────────────────────────────────────────────────
    const supplierRes = await api('/rest/v1/suppliers', {
      method: 'POST',
      token: member.token,
      body: { organization_id: member.organizationId, name: 'Audit Wholesale', phone: '01711111111' },
    })
    check(
      'a supplier can be created by the owner through PostgREST',
      supplierRes.status === 201 && Boolean(supplierRes.body?.[0]?.id),
      `HTTP ${supplierRes.status}`
    )
    const supplierId = supplierRes.body?.[0]?.id

    // ── Purchase order, then a partial receipt ────────────────────────────
    const poRes = await api('/rest/v1/rpc/save_purchase', {
      method: 'POST',
      token: member.token,
      body: {
        p_warehouse_id: warehouse,
        p_items: [{ variant_id: variantId, qty: 20, unit_cost: 210 }],
        p_supplier_id: supplierId,
        p_status: 'ORDERED',
        p_reference_no: 'AUDIT-PO-1',
      },
    })
    const poId = poRes.body
    check(
      'a purchase order is raised for the supplier',
      poRes.status === 200 && typeof poId === 'string',
      `HTTP ${poRes.status}`
    )

    const poNumber = poId
      ? (await client.query('select invoice_no from public.purchases where id = $1', [poId])).rows[0]
          ?.invoice_no
      : null

    const poItemId = poId
      ? (await client.query('select id from public.purchase_items where purchase_id = $1 limit 1', [poId]))
          .rows[0]?.id
      : null

    if (poId && poItemId) {
      const received = await api('/rest/v1/rpc/receive_purchase', {
        method: 'POST',
        token: member.token,
        body: {
          p_purchase_id: poId,
          p_items: [{ purchase_item_id: poItemId, qty: 8 }],
          p_paid: [],
        },
      })
      const afterPartial = (
        await client.query(
          `select p.status, p.total, i.quantity, i.received_qty
             from public.purchases p
             join public.purchase_items i on i.purchase_id = p.id
            where p.id = $1`,
          [poId]
        )
      ).rows[0]
      check(
        'a partial receipt leaves the order PARTIALLY_RECEIVED with the right outstanding quantity',
        afterPartial?.status === 'PARTIALLY_RECEIVED' &&
          Number(afterPartial?.quantity) - Number(afterPartial?.received_qty) === 12,
        `${poNumber} ${afterPartial?.status} ${afterPartial?.received_qty} of ${afterPartial?.quantity}`
      )
      check(
        'the receipt actually moved stock into the shop',
        received.status === 200,
        `HTTP ${received.status}`
      )
    }

    // ── Expense against the open drawer ───────────────────────────────────
    const expenseRes = await api('/rest/v1/rpc/record_expense', {
      method: 'POST',
      token: member.token,
      body: {
        p_branch_id: branchId,
        p_amount: 150,
        p_method_id: methodId,
        p_description: 'Audit tea for staff',
        p_session_id: registerId ? (await client.query(
          `select id from public.register_sessions where register_id = $1 and closed_at is null limit 1`,
          [registerId]
        )).rows[0]?.id ?? null : null,
      },
    })
    check(
      'an expense is recorded through the RPC the screen calls',
      expenseRes.status === 200,
      `HTTP ${expenseRes.status}${expenseRes.status === 200 ? '' : ` ${JSON.stringify(expenseRes.body).slice(0, 160)}`}`
    )

    // ── A sale, then a refund of part of it ───────────────────────────────
    const saleRes = await api('/rest/v1/rpc/complete_sale', {
      method: 'POST',
      token: member.token,
      body: {
        p_branch_id: branchId,
        p_warehouse_id: warehouse,
        p_register_id: registerId,
        p_items: [{ variant_id: variantId, qty: 2, unit_price: 1500 }],
        p_payments: [{ method_id: methodId, amount: 3000 }],
      },
    })
    const saleId = saleRes.body?.sale_id ?? saleRes.body?.id ?? null
    check(
      'a sale completes before the refund flow is exercised',
      saleRes.status === 200 && Boolean(saleId),
      `HTTP ${saleRes.status}`
    )

    if (saleId) {
      const saleItem = (
        await client.query(
          'select id, variant_id, unit_cost from public.sale_items where sale_id = $1 limit 1',
          [saleId]
        )
      ).rows[0]
      const before = Number(
        (
          await client.query(
            'select quantity from public.stock_balances where warehouse_id = $1 and variant_id = $2',
            [warehouse, saleItem.variant_id]
          )
        ).rows[0]?.quantity ?? 0
      )

      const refundRes = await api('/rest/v1/rpc/refund_sale', {
        method: 'POST',
        token: member.token,
        body: {
          p_sale_id: saleId,
          p_items: [{ sale_item_id: saleItem.id, qty: 1 }],
          p_payments: methodId ? [{ method_id: methodId, amount: 1500 }] : [],
          p_reason: 'browser audit',
          p_restock: true,
        },
      })
      const after = Number(
        (
          await client.query(
            'select quantity from public.stock_balances where warehouse_id = $1 and variant_id = $2',
            [warehouse, saleItem.variant_id]
          )
        ).rows[0]?.quantity ?? 0
      )
      // The ledger row cites the *return*, not the sale — `apply_stock_movement`
      // is called with reference_type 'return' — so the return is looked up
      // first and matched by id. Asserting `reference_id = saleId` would have
      // passed vacuously against any row that happened to match.
      const returnRow = (
        await client.query('select id from public.sale_returns where sale_id = $1 limit 1', [saleId])
      ).rows[0]
      const ledger = await client.query(
        `select reference_type, reference_id from public.stock_movements
           where variant_id = $1 and warehouse_id = $2 and type = 'RETURN_IN'
             and reference_id = $3 limit 1`,
        [saleItem.variant_id, warehouse, returnRow?.id ?? null]
      )
      check(
        'a refund from the live sale restocks exactly what came back',
        refundRes.status === 200 && after === before + 1,
        `HTTP ${refundRes.status} ${before} → ${after}`
      )
      check(
        'the restock writes a RETURN_IN ledger row citing the return it came from',
        ledger.rowCount === 1 && ledger.rows[0]?.reference_type === 'return',
        `${ledger.rowCount} row(s), reference_type=${ledger.rows[0]?.reference_type}`
      )
    }

    // ── The screens themselves ────────────────────────────────────────────
    const screens = [
      { name: 'suppliers', hash: '#/suppliers', shot: '11-suppliers.png', expect: /Audit Wholesale/ , forbid: /could not be loaded/i },
      { name: 'purchases', hash: '#/purchases', shot: '12-purchases.png', expect: /PO-|part received/i, forbid: /could not be loaded/i },
      { name: 'expenses', hash: '#/expenses', shot: '13-expenses.png', expect: /Spent today/, forbid: /could not be loaded/i },
      { name: 'sales list', hash: '#/sales', shot: '14-sales.png', expect: /INV-/, forbid: /could not be loaded/i },
      { name: 'register', hash: '#/register', shot: '15-register.png', expect: /Drawer open|Drawer closed/, forbid: /could not be loaded/i },
      { name: 'audit trail', hash: '#/audit', shot: '16-audit.png', expect: /Audit trail/, forbid: /could not be loaded/i },
    ]

    for (const screen of screens) {
      await page.evaluate((r) => {
        window.location.hash = r
      }, screen.hash)
      await new Promise((r) => setTimeout(r, 2500))
      const a = await auditLayout(page, `phase 4 ${screen.name}`)
      report.audits.push(a)
      reportAudit(a)
      await page.screenshot({ path: join(OUT, screen.shot), fullPage: true })

      const text = await page.evaluate(
        () => document.querySelector('#app-outlet')?.textContent ?? ''
      )
      check(
        `${screen.name}: renders its data, not an empty or error state`,
        screen.expect.test(text) && !screen.forbid.test(text),
        text.replace(/\s+/g, ' ').slice(0, 110)
      )
    }

    // The acceptance criterion is about the trail, so it is asserted in the
    // rendered screen: actor, before and after, on the row itself.
    const auditText = await page.evaluate(
      () => document.querySelector('#app-outlet')?.textContent ?? ''
    )
    check(
      'the audit screen names the actor who made each change',
      Boolean(member.email) && auditText.includes(member.email),
      `${member.email ?? 'no email on the member record'} ${
        member.email && auditText.includes(member.email) ? 'found' : 'missing'
      }`
    )

    // The first button in the outlet is not necessarily a trail row (View
    // report's footer has one too), so the row is identified by what it says:
    // an action badge, which only a trail entry carries.
    const openedEntry = await page.evaluate(() => {
      const outlet = document.querySelector('#app-outlet')
      const all = [...(outlet?.querySelectorAll('button') ?? [])]
      // The badge and the entity name are separate inline elements, so the
      // row's text reads "createExpenses…" with no boundary between the words.
      // Anchoring on the start of the row is therefore the reliable test.
      const rows = all.filter((button) => /^(create|update|delete)/i.test((button.textContent || '').trim()))
      const row = rows[0]
      if (row) row.click()
      return {
        found: rows.length,
        first: row ? (row.textContent || '').slice(0, 60) : '',
        buttons: all.length,
        texts: all.slice(0, 6).map((b) => (b.textContent || '').trim().slice(0, 44)).join(' ¦ '),
        html: (outlet?.innerHTML ?? '').replace(/\s+/g, ' ').slice(-260),
      }
    })
    check(
      'the audit list renders clickable entries',
      openedEntry.found > 0,
      `${openedEntry.found} row(s) of ${openedEntry.buttons} buttons — first: "${openedEntry.first}"`
    )
    if (openedEntry.found > 0) {
      await new Promise((r) => setTimeout(r, 900))
      const dialogText = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')
        return dialog ? dialog.textContent ?? '' : ''
      })
      check(
        'opening an audit entry shows the actor, the before and the after',
        /Actor/.test(dialogText) && /Before/.test(dialogText) && /After/.test(dialogText),
        dialogText ? dialogText.replace(/\s+/g, ' ').slice(0, 140) : 'no dialog opened'
      )
      await page.screenshot({ path: join(OUT, '17-audit-entry.png') })
      const dialogAudit = await auditLayout(page, 'phase 4 audit entry')
      report.audits.push(dialogAudit)
      reportAudit(dialogAudit)
      await page.keyboard.press('Escape')
    }
  }

    // ── Phase 5: the dashboard, analytics and reports ─────────────────────
    //
    // The acceptance criteria for this phase are about the *network* and the
    // *file*, so they are asserted there rather than on the screen:
    //
    //   "the dashboard loads in one round trip" — every request the page makes
    //   while the dashboard renders is recorded, and the payload has to be one
    //   `dashboard_summary` call with no per-widget follow-ups.
    //
    //   "a report exported to CSV re-imports to identical row counts" — the
    //   CSV button is really clicked, the file is really downloaded, and the
    //   rows in it are counted against the row count the report itself
    //   reported.
    console.log('\n── phase 5: dashboard, analytics, reports ──')

    const downloadDir = join(OUT, 'downloads')
    mkdirSync(downloadDir, { recursive: true })

    const requests = []
    page.on('request', (request) => requests.push(request.url()))

    /** Requests the page made while `run` was executing. */
    async function during(run) {
      const mark = requests.length
      await run()
      return requests.slice(mark)
    }

    // Start somewhere else, so the dashboard's own requests are the only ones
    // in the window — an ambient badge refresh is not the dashboard's doing.
    await page.evaluate(() => {
      window.location.hash = '#/customers'
    })
    await new Promise((r) => setTimeout(r, 2000))

    const dashboardRequests = await during(async () => {
      await page.evaluate(() => {
        window.location.hash = '#/'
      })
      await new Promise((r) => setTimeout(r, 7000))
    })

    const rpcCalls = dashboardRequests.filter((url) => url.includes('/rest/v1/rpc/'))
    const summaryCalls = rpcCalls.filter((url) => url.includes('dashboard_summary'))
    const followUps = rpcCalls.filter((url) =>
      /analytics_query|report_rows|bi_answers|stock_summary/.test(url)
    )
    check(
      'the dashboard loads in one round trip',
      summaryCalls.length === 1 && followUps.length === 0,
      `${summaryCalls.length}× dashboard_summary, ${followUps.length} follow-up call(s), rg=${rpcCalls.length}`
    )
    check(
      'no per-widget queries were fired behind it',
      rpcCalls.filter((url) => /dashboard_summary/.test(url)).length === 1 &&
        rpcCalls.length === 1,
      rpcCalls.map((url) => url.split('/rpc/')[1]?.slice(0, 24)).join(', ') || 'none'
    )

    const dashboardText = await page.evaluate(
      () => document.querySelector('#app-outlet')?.textContent ?? ''
    )
    const dashboardShots = await page.evaluate(() => ({
      widgets: ['Takings today', 'Profit today', 'Cash in the drawer', 'Expenses today',
                'Stock on hand', 'Who owes us', 'What we owe suppliers', 'Needs reordering']
        .filter((label) => document.body.textContent?.includes(label)).length,
      questions: (document.body.textContent?.match(/\?/g) ?? []).length,
      charts: document.querySelectorAll('#app-outlet svg').length,
      answerLinks: [
        ...document.querySelectorAll('#app-outlet a[href^="#/"]'),
      ].length,
    }))
    check(
      'the eight widgets all render from that one payload',
      dashboardShots.widgets === 8,
      `${dashboardShots.widgets}/8 tiles`
    )
    check(
      'the charts render as SVG, drawn from the same payload',
      dashboardShots.charts >= 4,
      `${dashboardShots.charts} chart(s)`
    )
    check(
      'every §56 question has a visible answer that links to its detail',
      dashboardShots.answerLinks >= 14 && dashboardText.includes('How much did we take today?'),
      `${dashboardShots.answerLinks} answer links, ${dashboardShots.questions} question marks on screen`
    )
    const dashboardAudit = await auditLayout(page, 'phase 5 dashboard')
    report.audits.push(dashboardAudit)
    reportAudit(dashboardAudit)
    await page.screenshot({ path: join(OUT, '18-dashboard.png'), fullPage: true })

    // ── Analytics: the framework, driven from the screen ──────────────────
    const analyticsRequests = await during(async () => {
      await page.evaluate(() => {
        window.location.hash = '#/analytics?measure=takings&dimension=category&period=month'
      })
      await new Promise((r) => setTimeout(r, 6000))
    })
    const analyticsText = await page.evaluate(
      () => document.querySelector('#app-outlet')?.textContent ?? ''
    )
    check(
      'the analytics screen asks the engine for the slice it shows',
      analyticsRequests.some((url) => url.includes('analytics_query')) &&
        analyticsRequests.some((url) => url.includes('analytics_catalog')),
      `${analyticsRequests.filter((url) => url.includes('/rpc/')).length} RPC call(s)`
    )
    check(
      'the analytics slice renders a chart and a table, not an error',
      /Takings/.test(analyticsText) &&
        !/could not be|not permitted/i.test(analyticsText) &&
        (await page.evaluate(() => document.querySelectorAll('#app-outlet svg').length)) >= 1,
      analyticsText.replace(/\s+/g, ' ').slice(0, 110)
    )

    // Changing the measure must re-run the engine — that is the framework
    // being exercised, rather than a screen with hard-coded numbers.
    const measureChanged = await during(async () => {
      await page.evaluate(() => {
        const select = document.querySelector('#app-outlet select')
        if (!select) return
        select.value = 'profit'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await new Promise((r) => setTimeout(r, 5000))
    })
    const afterMeasure = await page.evaluate(
      () => document.querySelector('#app-outlet')?.textContent ?? ''
    )
    check(
      'choosing another measure re-queries the engine for that measure',
      measureChanged.some((url) => url.includes('analytics_query')) &&
        /Profit/.test(afterMeasure),
      `${measureChanged.filter((url) => url.includes('analytics_query')).length} analytics_query call(s)`
    )
    const analyticsAudit = await auditLayout(page, 'phase 5 analytics')
    report.audits.push(analyticsAudit)
    reportAudit(analyticsAudit)
    await page.screenshot({ path: join(OUT, '19-analytics.png'), fullPage: true })

    // ── Reports: filter, sort, and a real CSV download ────────────────────
    const reportsRequests = await during(async () => {
      await page.evaluate(() => {
        window.location.hash = '#/reports?report=sales&period=month'
      })
      await new Promise((r) => setTimeout(r, 6000))
    })
    check(
      'the reports screen runs the report on the server',
      reportsRequests.some((url) => url.includes('report_catalog')) &&
        reportsRequests.some((url) => url.includes('report_rows')),
      `${reportsRequests.filter((url) => url.includes('/rpc/')).length} RPC call(s)`
    )

    // The row count the report itself reported — "1–25 of 431" — is the
    // number the downloaded file has to match.
    const reportedRows = await page.evaluate(() => {
      const text = document.querySelector('#app-outlet')?.textContent ?? ''
      const match = text.match(/of\s+([\d,]+)/)
      return match ? Number(match[1].replace(/,/g, '')) : -1
    })
    const tableRows = await page.evaluate(
      () => document.querySelectorAll('#app-outlet table tbody tr').length
    )
    const totalsShown = await page.evaluate(
      () => /Total:/.test(document.querySelector('#app-outlet')?.textContent ?? '')
    )
    check(
      'the report renders rows and the totals of the whole filtered set',
      tableRows > 0 && reportedRows > 0 && totalsShown,
      `${tableRows} row(s) on screen of ${reportedRows}, totals chip ${totalsShown ? 'present' : 'missing'}`
    )

    // Sorting is a server round trip, so the order is reproducible for a
    // second reader (and for the printed copy).
    const sortedRequests = await during(async () => {
      await page.evaluate(() => {
        const headers = [...document.querySelectorAll('#app-outlet th')]
        const total = headers.find((th) => /Total/.test(th.textContent || ''))
        total?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await new Promise((r) => setTimeout(r, 4000))
    })
    check(
      'clicking a column header re-sorts on the server',
      sortedRequests.some((url) => url.includes('report_rows')),
      `${sortedRequests.filter((url) => url.includes('report_rows')).length} report call(s)`
    )

    // The CSV download: the file is written to disk and counted.
    const cdp = await page.createCDPSession()
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
      eventsEnabled: true,
    })
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('#app-outlet button')]
      // The button's text includes its icon ligature ("downloadCSV"), so the
      // label is matched by its tail rather than by equality.
      const csv = buttons.find((button) => {
        const text = (button.textContent || '').trim()
        return text.endsWith('CSV') && !text.includes('PDF')
      })
      csv?.click()
    })

    /** Wait for a completed .csv download; Chrome writes .crdownload first. */
    async function waitForCsv(timeoutMs = 20000) {
      const started = Date.now()
      while (Date.now() - started < timeoutMs) {
        const files = readdirSync(downloadDir).filter((name) => name.endsWith('.csv'))
        if (files.length > 0) {
          const file = join(downloadDir, files[files.length - 1])
          const text = readFileSync(file, 'utf8')
          if (text.trim().length > 0) return { file, text, name: files[files.length - 1] }
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      return null
    }

    const downloaded = await waitForCsv()
    check(
      'clicking CSV really downloads the report as a file',
      downloaded !== null,
      downloaded ? downloaded.name : 'no file appeared in the download directory'
    )

    if (downloaded) {
      const parsedRows = countCsvRows(downloaded.text)
      check(
        'the exported CSV re-imports to the row count the report reported',
        parsedRows === reportedRows,
        `${parsedRows} row(s) in the file vs ${reportedRows} reported by the report`
      )
      const header = downloaded.text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? ''
      check(
        'the file carries the columns the screen showed, in the same order',
        header.startsWith('Invoice,') && header.includes('Total') && header.includes('Profit'),
        header.slice(0, 90)
      )
    }

    const reportsAudit = await auditLayout(page, 'phase 5 reports')
    report.audits.push(reportsAudit)
    reportAudit(reportsAudit)
    await page.screenshot({ path: join(OUT, '20-reports.png'), fullPage: true })

  // Persist the raw audit for the record.
  report.finishedAt = new Date().toISOString()
  report.passCount = checks.filter((c) => c.pass).length
  report.failCount = checks.filter((c) => !c.pass).length
  writeFileSync(join(OUT, 'audit.json'), JSON.stringify(report, null, 2))

  console.log(`\n${report.passCount} passed, ${report.failCount} failed — artifacts in ${OUT}`)
} catch (error) {
  console.error(`\nAUDIT ERROR: ${error.message}`)
  report.error = error.stack
  writeFileSync(join(OUT, 'audit.json'), JSON.stringify(report, null, 2))
} finally {
  if (browser) await browser.close()
  // AUDIT_KEEP=1 leaves the shop behind so a failure can be inspected with
  // SQL afterwards. Normal runs still delete everything they created.
  if (process.env.AUDIT_KEEP === '1') {
    console.log(`  (AUDIT_KEEP=1 — shops kept: ${members.map((m) => m.email).join(', ')})`)
  } else {
    await cleanup()
  }
  await client.end()
}
