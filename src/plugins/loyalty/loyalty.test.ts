/**
 * Loyalty — tested through the public plugin API, plus the arithmetic the SQL
 * and the browser have to agree on to the paisa.
 *
 * The tests that matter are the ones a shop would notice:
 *
 *   * a cashier is never offered more money off than the customer holds, or
 *     more than the cart is worth;
 *   * the points come off the account *before* the money comes off the sale,
 *     and the till is told to re-read the balance afterwards — a stale balance
 *     is the second redemption the shop never agreed to;
 *   * an abandoned redemption is visible and reversable, because "the points
 *     went somewhere" is the complaint this plugin exists to be able to answer;
 *   * the rule is in settings, so a shop that never opens the screen can still
 *     change what a point is worth.
 *
 * The server half — the ledger, the watermark walk, the idempotency of a
 * retried redemption — is exercised against a real Postgres by the live probe
 * and the migration validator. There is deliberately no test here that asserts
 * the *server's* arithmetic: `helpers.ts` and `002_functions.sql` must agree,
 * and the only way to know that is the probe, which runs both.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { EventBus } from '../../shared/bus/event-bus'
import { PluginRegistry } from '../../shared/registry/plugin-registry'
import { validateManifest } from '../../shared/registry/plugin-manifest'
import type {
  PluginDataStore,
  PluginDb,
  PluginPageContext,
  PluginSettings,
  SaleAdjustmentContext,
  SaleAdjustmentDefinition,
} from '../../shared/registry/plugin-types'
import { createLoyaltyScreen } from './loyalty-screen'
import loyaltyPlugin, { accountCache, ruleOf, tiersOf } from './index'
import {
  DEFAULT_MIN_REDEEM,
  DEFAULT_POINTS_PER_CURRENCY,
  DEFAULT_REDEEM_RATE,
  loyaltyManifest,
  MIN_REDEEM_KEY,
  POINTS_PER_CURRENCY_KEY,
  REDEEM_RATE_KEY,
} from './manifest'
import {
  DEFAULT_TIERS,
  formatPoints,
  ledgerLabel,
  LOYALTY_MANAGE,
  LOYALTY_REDEEM,
  LOYALTY_VIEW,
  maxRedeemable,
  moneyFor,
  nextTier,
  normaliseTiers,
  pointsFor,
  pointsForMoney,
  redemptionToken,
  redeemOffer,
  ruleFrom,
  snapshotFrom,
  TIERS_KEY,
  tierFor,
  wholePoints,
  type AccountRecord,
  type LoyaltyRule,
} from './helpers'

const ORG = '11111111-1111-1111-1111-111111111111'
const BRANCH = '22222222-2222-2222-2222-222222222222'

const PAGE: PluginPageContext = {
  params: {},
  query: new URLSearchParams(),
  organizationId: ORG,
  branchId: BRANCH,
  currency: 'BDT',
}

/** The default rule: a point a unit, a hundred points to the unit back. */
const RULE: LoyaltyRule = ruleFrom(
  DEFAULT_POINTS_PER_CURRENCY,
  DEFAULT_REDEEM_RATE,
  DEFAULT_MIN_REDEEM,
  DEFAULT_TIERS
)

// ── A stand-in server and settings ────────────────────────────────────────

interface Call {
  fn: string
  args: Record<string, unknown>
}

let calls: Call[] = []
let answers: Record<string, unknown> = {}
let refuse: string | null = null
let config: Record<string, unknown> = {}
let bus: EventBus
let registry: PluginRegistry

function makeDb(): PluginDb {
  return {
    products: async () => [],
    rpc: async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
      calls.push({ fn, args })
      if (refuse) throw new Error(refuse)
      const answer = answers[fn]
      if (typeof answer === 'function') {
        return (answer as (args: Record<string, unknown>) => unknown)(args) as T
      }
      return (answer ?? null) as T
    },
  }
}

function settingsStore(): PluginSettings {
  return {
    get: <T,>(key: string, fallback: T): T => (key in config ? (config[key] as T) : fallback),
    all: () => ({ ...config }),
    set: async (key, value) => {
      config[key] = value
    },
  }
}

beforeEach(() => {
  calls = []
  answers = {}
  refuse = null
  config = {}
  document.body.replaceChildren()
  bus = new EventBus()

  const dataStore: PluginDataStore = {
    get: async <T,>(_key: string, fallback: T): Promise<T> => fallback,
    set: async () => undefined,
    remove: async () => false,
    keys: async () => [],
  }

  registry = new PluginRegistry(bus, {
    settings: () => settingsStore(),
    data: () => dataStore,
    db: () => makeDb(),
  })
  registry.declare({ manifest: loyaltyManifest, load: async () => loyaltyPlugin })
})

/** Waits for the promises a render or a handler kicked off. */
const settle = async (rounds = 6): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const textOf = (node: Element): string => node.textContent ?? ''

/** Clicks the first button whose visible text says this, within `root`. */
function press(root: Element, label: string): void {
  const target = [...root.querySelectorAll('button')].find((entry) =>
    (entry.textContent ?? '').trim().toLowerCase().includes(label.toLowerCase())
  )
  if (!target) {
    throw new Error(
      `no button reading “${label}” — saw: ${[...root.querySelectorAll('button')]
        .map((entry) => entry.textContent?.trim())
        .join(', ')}`
    )
  }
  target.click()
}

/** The open confirm dialog, as the app draws it. */
function dialog(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[aria-modal="true"]')
  if (!el) throw new Error('no dialog is open')
  return el
}

/** The plugin's sale adjustment, as the till sees it. */
async function adjustment(): Promise<SaleAdjustmentDefinition> {
  await registry.sync([loyaltyManifest.id])
  const item = registry.saleAdjustments.items[0]
  if (!item) throw new Error('the plugin registered no sale adjustment')
  return item
}

const TILL: SaleAdjustmentContext = {
  organizationId: ORG,
  branchId: BRANCH,
  currency: 'BDT',
  customerId: 'c-1',
  totalMinor: 20000,
}

/** An account with a balance, as `loyalty_account` answers. */
function member(points: number, lifetime = points, tier?: string): AccountRecord {
  return {
    customer_id: 'c-1',
    member: true,
    customer: 'Rahim Uddin',
    phone: '+8801700000000',
    points,
    lifetime_points: lifetime,
    value_minor: moneyFor(points, RULE),
    tier: tier === undefined ? { name: 'Bronze', from: 0, bonus: 0 } : { name: tier, from: 0, bonus: 0 },
    min_redeem_points: DEFAULT_MIN_REDEEM,
    ledger: [],
    open: [],
  }
}

function screen(): ReturnType<typeof createLoyaltyScreen> {
  return createLoyaltyScreen({ settings: settingsStore(), db: makeDb() })
}

// ── The manifest ──────────────────────────────────────────────────────────

describe('the manifest', () => {
  it('is a valid manifest the registry will load', () => {
    expect(() => validateManifest(loyaltyManifest)).not.toThrow()
    expect(loyaltyManifest.id).toBe('loyalty')
    expect(loyaltyManifest.coreApiVersion).toBe('^1.0.0')
  })

  it('namespaces its three permissions and needs nothing else installed', () => {
    const keys = (loyaltyManifest.permissions ?? []).map((permission) => permission.key)
    expect(keys).toEqual([LOYALTY_VIEW, LOYALTY_REDEEM, LOYALTY_MANAGE])
    expect(keys.every((key) => key.startsWith('loyalty.'))).toBe(true)
    // The till's permission is separate from the register's on purpose: a
    // cashier gives money off without being able to read the shop's customer
    // list, and correcting a balance is a manager's act.
    expect(loyaltyManifest.dependencies ?? []).toEqual([])
    expect(loyaltyManifest.conflicts ?? []).toEqual([])
  })

  it('refuses a permission that is not its own', () => {
    expect(() =>
      validateManifest({
        ...loyaltyManifest,
        permissions: [{ key: 'sales.view', label: 'Sneaky', group: 'customers' }],
      })
    ).toThrow()
  })

  it('lets a shop change what a point is worth without opening a screen', () => {
    const schema = loyaltyManifest.settingsSchema ?? []
    expect(schema.map((entry) => entry.key)).toEqual([
      POINTS_PER_CURRENCY_KEY,
      REDEEM_RATE_KEY,
      MIN_REDEEM_KEY,
    ])
    expect(schema.every((entry) => entry.type === 'number')).toBe(true)
    expect(schema.map((entry) => entry.default)).toEqual([
      DEFAULT_POINTS_PER_CURRENCY,
      DEFAULT_REDEEM_RATE,
      DEFAULT_MIN_REDEEM,
    ])
    // The ladder is deliberately not a settings field: it is rows of three
    // fields, which a schema of text/number/boolean/select cannot render.
    expect(schema.some((entry) => entry.key === TIERS_KEY)).toBe(false)
  })
})

// ── The arithmetic ────────────────────────────────────────────────────────

describe('what a sale earns', () => {
  it('earns a point a unit at the default rule', () => {
    expect(pointsFor(20000, RULE)).toBe(200)
    expect(pointsFor(199, RULE)).toBe(1)
    expect(pointsFor(0, RULE)).toBe(0)
    expect(pointsFor(-500, RULE)).toBe(0)
  })

  it('rounds down at the same two points the server does', () => {
    // A fractional rate is the case that separates the two-step formula from
    // the one everybody writes first: money x rate x bonus / 100, in one go.
    const half: LoyaltyRule = { ...RULE, pointsPerCurrency: 0.5 }
    expect(pointsFor(19900, half)).toBe(99) // floor(199.0 x 0.5) = 99
    expect(pointsFor(10100, half)).toBe(50) // floor(50.5) = 50

    // The bonus applies to the base, after the first rounding — and the bonus
    // belongs to the tier the customer is *in*, not the one they are reaching.
    const gold = tierFor(5000, RULE)
    expect(pointsFor(10100, RULE, gold)).toBe(151) // floor(101 x 1.5) = 151
    expect(pointsFor(10100, RULE, tierFor(1200, RULE))).toBe(126) // floor(101 x 1.25)
    expect(pointsFor(10100, RULE, tierFor(0, RULE))).toBe(101)
  })

  it('never earns on a sale that earned nothing', () => {
    expect(pointsFor(10000, { ...RULE, pointsPerCurrency: 0 })).toBe(0)
    expect(pointsFor(Number.NaN, RULE)).toBe(0)
  })

  it('reads the tier from what was earned ever, never from the balance', () => {
    expect(tierFor(0, RULE).name).toBe('Bronze')
    expect(tierFor(999, RULE).name).toBe('Bronze')
    expect(tierFor(1000, RULE).name).toBe('Silver')
    expect(tierFor(4999, RULE).name).toBe('Silver')
    expect(tierFor(5000, RULE).name).toBe('Gold')
    expect(tierFor(-10, RULE).name).toBe('Bronze')
    expect(nextTier(1200, RULE)?.name).toBe('Gold')
    expect(nextTier(5000, RULE)).toBeNull()
  })
})

describe('what a point is worth', () => {
  it('prices a balance at the shop’s rate', () => {
    // An eighth of both conversions, spelled out: 1 unit earns 1 point,
    // 100 points buy 1 unit back, so a point is a paisa.
    expect(pointsFor(100, RULE)).toBe(1)
    expect(moneyFor(1, RULE)).toBe(1)
    expect(moneyFor(100, RULE)).toBe(100) // 1.00
    expect(moneyFor(250, RULE)).toBe(250) // 2.50
    expect(moneyFor(0, RULE)).toBe(0)
    // A rate of 1000 means 1,000 points to the unit — a tenth of a paisa each.
    expect(moneyFor(100, { ...RULE, redeemRate: 1000 })).toBe(10)
  })

  it('rounds a money amount up to the points it costs', () => {
    expect(pointsForMoney(25000, RULE)).toBe(25000) // 250.00 costs 25,000 points
    expect(pointsForMoney(1, RULE)).toBe(1) // a paisa costs a point, never zero
    expect(pointsForMoney(0, RULE)).toBe(0)
    // The two conversions are inverses of each other, which is what makes the
    // till's promise and the server's ledger the same number.
    expect(moneyFor(pointsForMoney(9999, RULE), RULE)).toBe(9999)
  })

  it('never offers more off a sale than the cart is worth', () => {
    // 5,000 points is 50.00 — but the cart is 20.00.
    expect(maxRedeemable(5000, 2000, RULE)).toBe(2000)
    // …nor more than the customer holds.
    expect(maxRedeemable(150, 20000, RULE)).toBe(150)
    expect(maxRedeemable(0, 20000, RULE)).toBe(0)
  })

  it('offers redemption in whole rungs of the shop’s minimum', () => {
    const offer = redeemOffer(1250, 20000, RULE)
    expect(offer).toEqual({ points: 1200, moneyMinor: 1200 }) // 1,200 points = 12.00

    // Below the minimum, no offer at all — a shop that asks for 100 points
    // does not want a hundred conversations about 40.
    expect(redeemOffer(99, 20000, RULE)).toBeNull()
    // Exactly the minimum is a rung.
    expect(redeemOffer(100, 20000, RULE)).toEqual({ points: 100, moneyMinor: 100 })
    // A cart smaller than the smallest redemption offers nothing rather than
    // a discount bigger than the sale.
    expect(redeemOffer(5000, 50, RULE)).toBeNull()
  })

  it('keeps the ladder ordered, floored at zero, whatever the shop typed', () => {
    const ladder = normaliseTiers([
      { name: 'Gold', from: 5000, bonus: 50 },
      { name: '  ', from: -20, bonus: -5 },
    ])
    // The unnamed row survives as the bottom rung — a shopkeeper who blanked a
    // name meant to keep the tier, and a tier with no name is still a tier.
    expect(ladder[0]).toEqual({ name: 'Tier', from: 0, bonus: 0 })
    expect(ladder[1]).toEqual({ name: 'Gold', from: 5000, bonus: 50 })
    // An empty ladder still has a rung to stand on.
    expect(normaliseTiers([])).toEqual([{ name: 'Member', from: 0, bonus: 0 }])
  })

  it('cleans up whatever the settings bag holds', () => {
    expect(ruleOf({ settings: { get: <T,>(_k: string, fallback: T) => fallback } } as never).tiers).toEqual(
      normaliseTiers(DEFAULT_TIERS)
    )
    expect(tiersOf({ settings: { get: <T,>(_k: string, fallback: T) => fallback } } as never).length).toBe(3)
  })

  it('reads a rule back out of the settings bag, clamped', () => {
    const stored = settingsStore()
    const api = { settings: stored } as never
    expect(ruleOf(api).redeemRate).toBe(DEFAULT_REDEEM_RATE)

    config[REDEEM_RATE_KEY] = 0 // a shop cannot mean "a point is worth nothing"
    config[POINTS_PER_CURRENCY_KEY] = 5000 // …nor "every sale earns 5,000 points a unit"
    const clamped = ruleOf(api)
    expect(clamped.redeemRate).toBe(DEFAULT_REDEEM_RATE)
    expect(clamped.pointsPerCurrency).toBe(1000)
  })

  it('writes a token the till can recognise again', () => {
    const token = redemptionToken('c-1-abcdef', 250, 1700000000000)
    expect(token).toMatch(/^rd-c-1-abcd-250-1700000000000-\d+$/)
    expect(redemptionToken('c-1-abcdef', 250, 1700000000001)).not.toBe(token)
    expect(redemptionToken('c-2', 250, 1700000000000)).not.toBe(token)
    // Two quotes in the same millisecond are still two different redemptions.
    expect(redemptionToken('c-1-abcdef', 250, 1700000000000)).not.toBe(
      redemptionToken('c-1-abcdef', 250, 1700000000000)
    )
  })

  it('reads a points entry the way a shopkeeper would', () => {
    expect(formatPoints(12400)).toBe('12,400')
    expect(ledgerLabel('REVERSAL')).toBe('Returned')
    expect(ledgerLabel('SOMETHING')).toBe('SOMETHING')
    expect(wholePoints('250')).toBe(250)
    expect(wholePoints('-40')).toBe(-40)
    expect(wholePoints('2.5')).toBeNull()
    expect(wholePoints(0)).toBeNull()
    expect(wholePoints('')).toBeNull()
  })

  it('turns the server’s answer into the shape the screens use', () => {
    const snapshot = snapshotFrom({
      ...member(250, 1250, 'Silver'),
      open: [{ token: 'rd-1', points: 100, money_minor: 10000, note: 'not used' }],
    })
    expect(snapshot).toMatchObject({
      customerId: 'c-1',
      member: true,
      points: 250,
      lifetimePoints: 1250,
      minRedeemPoints: DEFAULT_MIN_REDEEM,
    })
    expect(snapshot.tier.name).toBe('Silver')
    expect(snapshot.open).toEqual([
      { token: 'rd-1', points: 100, moneyMinor: 10000, note: 'not used' },
    ])
    // A customer with no account is not a member, and holds nothing.
    const nobody = snapshotFrom({ customer_id: 'c-9', member: false })
    expect(nobody.member).toBe(false)
    expect(nobody.points).toBe(0)
    expect(nobody.open).toEqual([])
  })
})

// ── The till ──────────────────────────────────────────────────────────────

describe('the till', () => {
  it('offers money off when the customer has points — and only then', async () => {
    const definition = await adjustment()
    expect(definition.id).toBe('loyalty.redeem')
    expect(definition.label).toBe('Loyalty')
    expect(definition.permission).toBe(LOYALTY_REDEEM)
    expect(definition.source).toBe(loyaltyManifest.id)

    answers.account = member(1250, 8000, 'Silver')
    const quote = await definition.quote(TILL)
    expect(quote).not.toBeNull()
    expect(quote?.amountMinor).toBe(1200) // 1,200 points at 100 points to 1.00
    expect(quote?.label).toBe('Redeem 1,200 points')
    expect(quote?.note).toContain('1,200 points')
    expect(quote?.note).toContain('12.00')
    expect(quote?.token).toMatch(/^rd-/)

    // A walk-in has no account to spend.
    expect(await definition.quote({ ...TILL, customerId: null })).toBeNull()
  })

  it('offers nothing to a customer who has not earned anything', async () => {
    const definition = await adjustment()
    answers.account = { customer_id: 'c-1', member: false, points: 0, min_redeem_points: 100 }
    expect(await definition.quote(TILL)).toBeNull()

    answers.account = member(40) // a member, below the shop's minimum
    expect(await definition.quote(TILL)).toBeNull()
  })

  it('reads the balance once per customer, not once per cart change', async () => {
    const definition = await adjustment()
    answers.account = member(1250)
    await definition.quote(TILL)
    await definition.quote(TILL)
    await definition.quote(TILL)
    expect(calls.filter((call) => call.fn === 'account')).toHaveLength(1)
  })

  it('takes the points out of the account before the money leaves the sale', async () => {
    // The order is the whole point: money moves only if the shop can record it,
    // so the redemption is written first and a failure to write it must throw.
    const definition = await adjustment()
    answers.account = member(1250)
    const quote = await definition.quote(TILL)
    expect(quote).not.toBeNull()

    await definition.onApplied?.(quote!, TILL)
    const redeem = calls.filter((call) => call.fn === 'redeem')
    expect(redeem).toHaveLength(1)
    expect(redeem[0]?.args).toEqual({ customer_id: 'c-1', points: 1200, token: quote?.token })

    // …and the cashier's next glance at the panel is a fresh read, not a
    // balance that still contains points the customer just spent.
    await definition.quote(TILL)
    expect(calls.filter((call) => call.fn === 'account').length).toBeGreaterThan(1)
  })

  it('refuses to move money for a quote it is no longer offering', async () => {
    const definition = await adjustment()
    answers.account = member(1250)
    const quote = await definition.quote(TILL)

    // The host froze the quote, but the cart has moved since and the till has
    // been re-quoted — the points behind that older quote are not the ones this
    // plugin would be debiting, so it refuses instead of guessing.
    await definition.quote(TILL)
    await expect(definition.onApplied?.(quote!, TILL)).rejects.toThrow(/not the one being offered/)

    // A quote with no token at all, and a sale with no customer, are the same
    // refusal: there is nothing to debit.
    const current = await definition.quote(TILL)
    await expect(
      definition.onApplied?.({ amountMinor: 5000, label: 'Redeem 500 points' }, TILL)
    ).rejects.toThrow(/not the one being offered/)
    await expect(definition.onApplied?.(current!, { ...TILL, customerId: null })).rejects.toThrow()
    expect(calls.filter((call) => call.fn === 'redeem')).toHaveLength(0)
  })

  it('fails loudly when the shop cannot record the redemption', async () => {
    const definition = await adjustment()
    answers.account = member(1250)
    const quote = await definition.quote(TILL)
    refuse = 'loyalty_insufficient_points: 1200 asked for, 100 on the account'
    await expect(definition.onApplied?.(quote!, TILL)).rejects.toThrow(/insufficient/)
  })

  it('gives points back when the redemption is abandoned, and says why', async () => {
    const definition = await adjustment()
    answers.account = member(1250)
    const quote = await definition.quote(TILL)
    await definition.onReleased?.(quote!, 'removed')
    expect(calls.filter((call) => call.fn === 'release')[0]?.args).toEqual({
      token: quote?.token,
      reason: 'removed',
    })
    // The reason travels: "cleared" and "invalid" read differently on the
    // ledger, and the difference is what a shopkeeper audits.
    await definition.onReleased?.(quote!, 'cleared')
    expect(calls.filter((call) => call.fn === 'release')[1]?.args.reason).toBe('cleared')
    // A quote with no token has nothing to give back.
    await definition.onReleased?.({ amountMinor: 100, label: 'x' }, 'removed')
    expect(calls.filter((call) => call.fn === 'release')).toHaveLength(2)
  })

  it('binds the redemption to its invoice, and waits when there is no invoice', async () => {
    const definition = await adjustment()
    answers.account = member(1250)
    const quote = await definition.quote(TILL)

    // An offline sale has no server id yet: the reservation waits, visibly.
    await definition.onSettled?.(quote!, { saleId: 's-1', invoiceNo: 'INV-1', stored: false })
    expect(calls.filter((call) => call.fn === 'settle')).toHaveLength(0)

    await definition.onSettled?.(quote!, { saleId: 's-1', invoiceNo: 'INV-1', stored: true })
    expect(calls.filter((call) => call.fn === 'settle')[0]?.args).toEqual({
      token: quote?.token,
      sale_id: 's-1',
    })
  })

  it('tells the cashier who this is and what the sale will earn them', async () => {
    const definition = await adjustment()
    void definition
    answers.account = member(1250, 8000, 'Silver')
    const api = {
      db: makeDb(),
      settings: settingsStore(),
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    }
    const { accountCache: cache } = await import('./index')
    const accounts = cache(api as never)
    const panel = await loyaltyPluginPanelRender(api as never, accounts, TILL)
    expect(textOf(panel)).toContain('1,250')
    expect(textOf(panel)).toContain('Silver')
    expect(textOf(panel)).toContain('in points')
    expect(textOf(panel)).toContain('this sale earns')
  })

  it('says nothing rather than a wrong number when the points cannot be read', async () => {
    const api = {
      db: makeDb(),
      settings: settingsStore(),
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    }
    refuse = 'network'
    const panel = await loyaltyPluginPanelRender(api as never, accountCache(api as never), TILL)
    expect(textOf(panel)).toContain('could not be read')
  })

  it('asks a walk-in for a customer rather than inventing one', async () => {
    const api = {
      db: makeDb(),
      settings: settingsStore(),
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    }
    const panel = await loyaltyPluginPanelRender(api as never, accountCache(api as never), {
      ...TILL,
      customerId: null,
    })
    expect(textOf(panel)).toContain('Attach a customer')
  })
})

/** The plugin's till panel, reached the way the POS reaches it. */
async function loyaltyPluginPanelRender(
  api: never,
  accounts: ReturnType<typeof accountCache>,
  context: SaleAdjustmentContext
): Promise<HTMLElement> {
  const mod = await import('./index')
  return mod.renderTillPanel(api, accounts, {
    organizationId: context.organizationId,
    branchId: context.branchId,
    currency: context.currency,
    customerId: context.customerId,
    total: context.totalMinor / 100,
    lines: [],
  })
}

// ── The screen ────────────────────────────────────────────────────────────

describe('the register', () => {
  const overview = {
    members: 42,
    active_month: 17,
    points_out: 12400,
    value_minor: 1240000,
    earned_month: 900,
    month_label: 'Sep 2026',
    open_reservations: 1,
    drift: 0,
  }

  const memberPage = {
    rows: [
      {
        customer_id: 'c-1',
        customer: 'Rahim Uddin',
        phone: '+8801700000000',
        points: 1250,
        lifetime_points: 8000,
        tier: { name: 'Silver', from: 1000, bonus: 25 },
        value_minor: 1250,
        joined_at: '2026-01-01T00:00:00.000Z',
        last_activity_at: '2026-09-20T10:00:00.000Z',
      },
    ],
    total: 1,
  }

  it('shows the shop what it owes, and what that is worth', async () => {
    answers.overview = overview
    answers.members = memberPage
    const view = await screen().render(PAGE)
    await settle()

    expect(textOf(view)).toContain('Loyalty')
    expect(textOf(view)).toContain('12,400')
    expect(textOf(view)).toContain('12,400.00')
    expect(textOf(view)).toContain('Sep 2026')
    expect(textOf(view)).toContain('42 members')
  })

  it('lists the members with a balance a shop can act on', async () => {
    answers.overview = overview
    answers.members = memberPage
    const view = await screen().render(PAGE)
    await settle()

    expect(textOf(view)).toContain('Rahim Uddin')
    expect(textOf(view)).toContain('1,250')
    expect(textOf(view)).toContain('Silver')
    expect(textOf(view)).toContain('12.50') // what the balance is worth
    expect(textOf(view)).toContain('8,000 earned ever')
  })

  it('explains an empty register rather than showing a blank list', async () => {
    answers.overview = { ...overview, members: 0, points_out: 0, value_minor: 0, earned_month: 0 }
    answers.members = { rows: [], total: 0 }
    const view = await screen().render(PAGE)
    await settle()

    expect(textOf(view)).toContain('Nobody has earned points yet')
    expect(textOf(view)).toContain('Attach a customer at the till')
  })

  it('shows every movement on one customer’s account, invoices and all', async () => {
    answers.overview = overview
    answers.members = memberPage
    answers.account = {
      ...member(1250, 8000, 'Silver'),
      ledger: [
        {
          id: 'l-2',
          kind: 'REDEEM',
          points: -1200,
          money_minor: 12000,
          sale_id: 's-1',
          invoice_no: 'INV-0007',
          token: 'rd-1',
          note: null,
          created_at: '2026-09-20T10:00:00.000Z',
        },
        {
          id: 'l-1',
          kind: 'EARN',
          points: 2450,
          money_minor: null,
          sale_id: 's-0',
          invoice_no: 'INV-0006',
          token: null,
          note: null,
          created_at: '2026-09-19T10:00:00.000Z',
        },
      ],
      open: [],
    }

    const view = await screen().render(PAGE)
    await settle()
    press(view, 'Rahim Uddin')
    await settle()

    expect(textOf(view)).toContain('Every movement')
    expect(textOf(view)).toContain('Redeemed · INV-0007')
    expect(textOf(view)).toContain('−1,200')
    expect(textOf(view)).toContain('Earned · INV-0006')
    expect(textOf(view)).toContain('+2,450')
    expect(textOf(view)).toContain('worth')
  })

  it('surfaces a redemption that never reached an invoice, and can give it back', async () => {
    answers.overview = { ...overview, open_reservations: 1 }
    answers.members = memberPage
    answers.account = {
      ...member(1250, 8000, 'Silver'),
      ledger: [],
      open: [{ token: 'rd-1', points: 1200, money_minor: 12000, note: null }],
    }

    const view = await screen().render(PAGE)
    await settle()
    press(view, 'Rahim Uddin')
    await settle()

    expect(textOf(view)).toContain('never reached an invoice')
    press(view, 'Give them back')
    await settle()
    // The confirmation is the core's dialog, and it is the shopkeeper's act.
    expect(textOf(dialog())).toContain('Give these points back?')
    press(dialog(), 'Give them back')
    await settle()

    const release = calls.filter((call) => call.fn === 'release')
    expect(release[0]?.args).toEqual({ token: 'rd-1', reason: 'Not used' })
  })

  it('corrects a balance only with a reason, and only in whole points', async () => {
    answers.overview = overview
    answers.members = memberPage
    answers.account = { ...member(1250, 8000, 'Silver'), ledger: [], open: [] }

    const view = await screen().render(PAGE)
    await settle()
    press(view, 'Rahim Uddin')
    await settle()
    press(view, 'Adjust points')
    await settle()

    // No reason yet: nothing is written.
    press(view, 'Save the correction')
    await settle()
    expect(calls.filter((call) => call.fn === 'adjust')).toHaveLength(0)

    const inputs = [...view.querySelectorAll('input')]
    const amount = inputs.find((entry) => entry.placeholder.includes('250'))
    const why = inputs.find((entry) => entry.placeholder.includes('Wrong points'))
    expect(amount).toBeDefined()
    expect(why).toBeDefined()
    if (amount) {
      amount.value = '250'
      amount.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (why) {
      why.value = 'missed a sale on 12 Sep'
      why.dispatchEvent(new Event('input', { bubbles: true }))
    }

    press(view, 'Save the correction')
    await settle()
    const adjust = calls.filter((call) => call.fn === 'adjust')
    expect(adjust[0]?.args).toEqual({
      customer_id: 'c-1',
      points: 250,
      note: 'missed a sale on 12 Sep',
    })
  })

  it('edits the ladder in place and saves it cleaned', async () => {
    answers.overview = overview
    answers.members = memberPage
    const stored = settingsStore()
    const view = await createLoyaltyScreen({ settings: stored, db: makeDb() }).render(PAGE)
    await settle()

    press(view, 'Tier ladder')
    await settle()
    expect(textOf(view)).toContain('Tier ladder')
    // The rungs are editable fields, so the names live in the inputs.
    const values = (): string[] => [...view.querySelectorAll('input')].map((entry) => entry.value)
    expect(values()).toContain('Bronze')
    expect(values()).toContain('Silver')
    expect(values()).toContain('Gold')
    // The first rung cannot be removed: a customer with no points is still a
    // customer, and a ladder with no bottom is a ladder with no tier.
    const removes = [...view.querySelectorAll('button[aria-label^="Remove"]')]
    expect(removes).toHaveLength(3)
    expect((removes[0] as HTMLButtonElement).disabled).toBe(true)

    press(view, 'Add a tier')
    await settle()
    expect(values()).toContain('New tier')
    press(view, 'Save the ladder')
    await settle()

    const saved = stored.get<unknown[]>(TIERS_KEY, [])
    expect(saved).toHaveLength(4)
    expect(saved[3]).toEqual({ name: 'New tier', from: 10000, bonus: 75 })
  })

  it('says so when the shop’s points cannot be read', async () => {
    refuse = 'loyalty_permission_denied: loyalty.view'
    const view = await screen().render(PAGE)
    await settle()
    // The screen keeps its shape and says what it cannot answer…
    expect(textOf(view)).toContain('The shop’s points could not be read.')
    // …and the reason reaches the shopkeeper as a toast.
    expect(textOf(document.body)).toContain('loyalty.view')
  })
})

// ── The reports ───────────────────────────────────────────────────────────

describe('the reports', () => {
  it('reads the member book off the server, paged', async () => {
    answers.report = {
      rows: [
        {
          customer_id: 'c-1',
          customer: 'Rahim Uddin',
          phone: '+8801700000000',
          points: 1250,
          lifetime_points: 8000,
          tier: { name: 'Silver', from: 1000, bonus: 25 },
          value_minor: 1250,
          joined_at: '2026-01-01T00:00:00.000Z',
          last_activity_at: '2026-09-20T10:00:00.000Z',
        },
      ],
      total: 1,
    }

    const mod = await import('./index')
    const api = {
      db: makeDb(),
      settings: settingsStore(),
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    }
    const result = await mod.membersReport(api as never, {
      period: 'month',
      from: null,
      to: null,
      search: '',
      branchId: null,
      limit: 25,
      offset: 0,
    })

    expect(calls.find((call) => call.fn === 'report')?.args).toMatchObject({
      type: 'members',
      limit: 25,
      offset: 0,
    })
    expect(result.columns.map((column) => column.key)).toContain('points')
    expect(result.rows[0]).toMatchObject({ customer: 'Rahim Uddin · +8801700000000', tier: 'Silver' })
    expect(result.totals).toEqual({ points: 1250, value: 1250 })
    expect(result.totalRows).toBe(1)
    expect(result.note).toContain('still owes')
  })

  it('reads the ledger into a report with the movements named', async () => {
    answers.report = {
      rows: [
        {
          date: '2026-09-20T10:00:00.000Z',
          customer: 'Rahim Uddin',
          kind: 'REVERSAL',
          points: -245,
          money_minor: 0,
          invoice_no: 'INV-0006',
          note: 'Return R-12',
        },
      ],
      total: 1,
      totals: { earned: 2450, spent: -1200, reversed: -245, given_back: 0, net: 1005 },
    }

    const mod = await import('./index')
    const api = {
      db: makeDb(),
      settings: settingsStore(),
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    }
    const result = await mod.ledgerReport(api as never, {
      period: 'quarter',
      from: null,
      to: null,
      search: 'rahim',
      branchId: null,
      limit: 25,
      offset: 0,
    })

    expect(calls.find((call) => call.fn === 'report')?.args).toMatchObject({
      type: 'ledger',
      period: 'quarter',
      search: 'rahim',
    })
    expect(result.rows[0]).toMatchObject({ kind: 'Returned', points: -245, invoice: 'INV-0006' })
    expect(result.note).toContain('Earned 2,450')
    expect(result.note).toContain('redeemed 1,200')
    expect(result.note).toContain('returned 245')
  })
})

// ── The surfaces a shop actually sees ─────────────────────────────────────

describe('the surfaces', () => {
  it('adds a sidebar item, a screen, a tile and two reports', async () => {
    await registry.sync([loyaltyManifest.id])

    expect(registry.nav.items.map((item) => item.id)).toEqual(['loyalty'])
    expect(registry.nav.items[0]?.section).toBe('customers')
    expect(registry.nav.items[0]?.permission).toBe(LOYALTY_VIEW)
    expect(registry.routes.items.map((route) => route.path)).toEqual(['/plugins/loyalty'])
    expect(registry.widgets.items.map((widget) => widget.id)).toEqual(['loyalty.summary'])
    expect(registry.posPanels.items.map((panel) => panel.id)).toEqual(['loyalty.pos'])
    expect(registry.saleTabs.items.map((tab) => tab.id)).toEqual(['loyalty.sale'])
    expect(registry.reports.items.map((report) => report.id).sort()).toEqual(['ledger', 'members'])
    expect(registry.permissions.items.map((permission) => permission.key).sort()).toEqual([
      LOYALTY_MANAGE,
      LOYALTY_REDEEM,
      LOYALTY_VIEW,
    ])
  })

  it('tells the shop what its points are costing it, and what it owes', async () => {
    const api = {
      db: makeDb(),
      settings: settingsStore(),
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    }
    answers.overview = {
      members: 42,
      active_month: 17,
      points_out: 12400,
      value_minor: 1240000,
      earned_month: -900,
      month_label: 'Sep 2026',
      open_reservations: 2,
      drift: 1,
    }

    const mod = await import('./index')
    const tile = await mod.renderTile(api as never)
    expect(textOf(tile)).toContain('12,400')
    expect(textOf(tile)).toContain('42 members')
    expect(textOf(tile)).toContain('−900 points')
    expect(textOf(tile)).toContain('2 redemptions waiting')
    // The one number that says the cache agrees with the ledger.
    expect(textOf(tile)).toContain('disagree with the ledger')
  })

  it('draws nothing clever when the tile cannot be read', async () => {
    const api = {
      db: makeDb(),
      settings: settingsStore(),
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    }
    refuse = 'loyalty_org_not_found'
    const mod = await import('./index')
    expect(textOf(await mod.renderTile(api as never))).toContain('org_not_found')
  })
})
