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

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
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
  members.push({ userId, organizationId: null })
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
  members.find((m) => m.userId === user.userId).organizationId = provisioned.body
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
      await client.query('delete from public.audit_logs where actor_id = $1', [id])
      if (organizationId) {
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
    ['sales', '#/sales'],
    ['customers', '#/customers'],
    ['register', '#/register'],
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
  await cleanup()
  await client.end()
}
