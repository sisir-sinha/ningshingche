/**
 * Loyalty — the arithmetic, mirrored in TypeScript.
 *
 * Every number here also exists in `supabase/plugins/loyalty/002_functions.sql`
 * (`app.loyalty_points_for`, `app.loyalty_money_for`, `app.loyalty_tier`), and
 * the two must agree *exactly*: the till tells the customer "you earned 18
 * points" a moment before the ledger is written, and a screen that promises a
 * different number than the shop records is a support call nobody can win.
 *
 * That is why the maths is integer-only in both places. A rate with two
 * decimals becomes `rate_x100` (a whole number of hundredths), money is minor
 * units, and every division rounds down at the same point in the same order:
 *
 *     base   = floor(total_minor × rate_x100 / 10000)
 *     points = floor(base × (100 + bonus) / 100)
 *     money  = floor(points × 10000 / redeem_x100)
 *
 * The two steps matter. Rounding once at the end — money × rate × bonus, then
 * divide — gives a different answer for fractional rates, and it would give a
 * different answer again in SQL, where `numeric` is exact and a JavaScript
 * `number` is not.
 */

export const LOYALTY_ID = 'loyalty'

/** Read a customer's points and every movement that made them. */
export const LOYALTY_VIEW = 'loyalty.view'

/** Take points off the sale at the till, and give them back when it is abandoned. */
export const LOYALTY_REDEEM = 'loyalty.redeem'

/** Correct a balance, and set the shop's own rule. */
export const LOYALTY_MANAGE = 'loyalty.manage'

/** Config keys, read by this plugin's screens and by its own SQL. */
export const POINTS_PER_CURRENCY_KEY = 'points_per_currency'
export const REDEEM_RATE_KEY = 'redeem_rate'
export const MIN_REDEEM_KEY = 'min_redeem_points'
export const TIERS_KEY = 'tiers'

export const DEFAULT_POINTS_PER_CURRENCY = 1
export const DEFAULT_REDEEM_RATE = 100
export const DEFAULT_MIN_REDEEM = 100

export interface LoyaltyTier {
  name: string
  /** The lifetime points at which this tier starts. */
  from: number
  /** Percent more points this tier earns, e.g. 25 for a quarter more. */
  bonus: number
}

/**
 * The ladder a shop gets if it changes nothing. Ordered, and the first rung
 * always starts at zero, because a customer with no points is still a customer
 * and "no tier" is not a thing a screen can show.
 */
export const DEFAULT_TIERS: readonly LoyaltyTier[] = [
  { name: 'Bronze', from: 0, bonus: 0 },
  { name: 'Silver', from: 1000, bonus: 25 },
  { name: 'Gold', from: 5000, bonus: 50 },
]

export interface LoyaltyRule {
  pointsPerCurrency: number
  redeemRate: number
  minRedeemPoints: number
  tiers: LoyaltyTier[]
}

/** The shop's rule, with every value pulled into a shape the maths can use. */
export function ruleFrom(pointsPerCurrency: number, redeemRate: number, minRedeem: number, tiers: readonly LoyaltyTier[]): LoyaltyRule {
  return {
    pointsPerCurrency: clamp(round2(pointsPerCurrency), 0, 1000),
    redeemRate: clamp(Math.round(redeemRate) || DEFAULT_REDEEM_RATE, 1, 100000),
    minRedeemPoints: clamp(Math.round(minRedeem) || DEFAULT_MIN_REDEEM, 1, 1_000_000),
    tiers: normaliseTiers(tiers),
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

/** The ladder, cleaned and ordered, with a floor at zero. */
export function normaliseTiers(tiers: readonly LoyaltyTier[]): LoyaltyTier[] {
  const clean = tiers
    .map((tier) => ({
      name: typeof tier.name === 'string' && tier.name.trim() !== '' ? tier.name.trim() : 'Tier',
      from: clamp(Math.round(tier.from), 0, 1_000_000_000),
      bonus: clamp(Math.round(tier.bonus), 0, 1000),
    }))
    .sort((a, b) => a.from - b.from || a.name.localeCompare(b.name))

  if (clean.length === 0 || clean[0]?.from !== 0) {
    // A customer with no points is still a customer: the ladder always has a
    // bottom rung, even if the shop deleted every row it wrote.
    clean.unshift({ name: 'Member', from: 0, bonus: 0 })
  }
  return clean
}

/**
 * Points a sale of this size earns: the base from the money, then the tier's
 * bonus on the base. Same two steps, same two roundings, as the server.
 */
export function pointsFor(totalMinor: number, rule: LoyaltyRule, tier?: LoyaltyTier | null): number {
  const rateX100 = Math.round(rule.pointsPerCurrency * 100)
  if (!Number.isFinite(totalMinor) || totalMinor <= 0 || rateX100 <= 0) return 0
  const base = Math.floor((totalMinor * rateX100) / 10_000)
  const bonus = Math.max(0, Math.round(tier?.bonus ?? 0))
  return Math.max(0, Math.floor((base * (100 + bonus)) / 100))
}

/** What a number of points is worth to the customer, in minor units. */
export function moneyFor(points: number, rule: LoyaltyRule): number {
  if (!Number.isFinite(points) || points <= 0) return 0
  const redeemX100 = Math.round(rule.redeemRate * 100)
  return Math.floor((points * 10_000) / Math.max(redeemX100, 1))
}

/** How many points it takes to take this much off a sale. Rounded up: a shop
 *  never gives a paisa away for nothing. */
export function pointsForMoney(moneyMinor: number, rule: LoyaltyRule): number {
  if (!Number.isFinite(moneyMinor) || moneyMinor <= 0) return 0
  const redeemX100 = Math.round(rule.redeemRate * 100)
  return Math.ceil((moneyMinor * redeemX100) / 10_000)
}

/** The tier a lifetime total sits in. */
export function tierFor(lifetimePoints: number, rule: LoyaltyRule): LoyaltyTier {
  const reached = rule.tiers.filter((tier) => tier.from <= Math.max(0, lifetimePoints))
  return reached[reached.length - 1] ?? { name: 'Member', from: 0, bonus: 0 }
}

/** The next rung, so a customer can be told how far they have to go. */
export function nextTier(lifetimePoints: number, rule: LoyaltyRule): LoyaltyTier | null {
  return rule.tiers.find((tier) => tier.from > Math.max(0, lifetimePoints)) ?? null
}

/**
 * The most a customer can take off a sale of this size, in points.
 *
 * Capped by the sale itself: a redemption worth more than the cart is money the
 * shop cannot give, and the till would clamp it silently — the customer would
 * have paid points for a discount they never received.
 */
export function maxRedeemable(balancePoints: number, totalMinor: number, rule: LoyaltyRule): number {
  const affordable = Math.floor((Math.max(0, totalMinor) * Math.max(1, rule.redeemRate)) / 100)
  return Math.max(0, Math.min(Math.floor(balancePoints), affordable))
}

/** The points that would be spent to take `totalMinor` off, within the rules. */
export function redeemOffer(
  balancePoints: number,
  totalMinor: number,
  rule: LoyaltyRule
): { points: number; moneyMinor: number } | null {
  const spendable = maxRedeemable(balancePoints, totalMinor, rule)
  if (spendable < rule.minRedeemPoints) return null

  // Offer whole rungs of the minimum, so the cashier is not asked to hand back
  // an odd number of points the shop would then have to explain.
  const step = rule.minRedeemPoints
  const points = Math.floor(spendable / step) * step
  if (points < step) return null

  const moneyMinor = moneyFor(points, rule)
  if (moneyMinor <= 0) return null
  return { points, moneyMinor }
}

/** `1,240` — points are read, not computed, by the person looking at them. */
export function formatPoints(value: number): string {
  return new Intl.NumberFormat('en-IN').format(Math.round(value))
}

/** What a kind of ledger row is called on screen. */
export const LEDGER_LABEL: Readonly<Record<string, string>> = {
  EARN: 'Earned',
  REVERSAL: 'Returned',
  REDEEM: 'Redeemed',
  RELEASE: 'Given back',
  ADJUST: 'Corrected',
}

export function ledgerLabel(kind: string): string {
  return LEDGER_LABEL[kind] ?? kind
}

/**
 * A token the till can recognise again: one per *redemption*, not per cart.
 *
 * The counter is what makes two quotes in the same millisecond different
 * tokens. Without it, moving the cart twice inside a millisecond would hand the
 * till the same handle for both quotes, and the second one — the one the
 * cashier actually pressed — would look like the one already spent.
 */
let redemptionSeq = 0

export function redemptionToken(customerId: string, points: number, now: number): string {
  redemptionSeq += 1
  return `rd-${customerId.slice(0, 8)}-${points}-${now}-${redemptionSeq}`
}

export interface AccountSnapshot {
  customerId: string
  member: boolean
  customer: string | null
  points: number
  lifetimePoints: number
  valueMinor: number
  tier: LoyaltyTier
  minRedeemPoints: number
  open: Array<{ token: string; points: number; moneyMinor: number; note: string | null }>
}

/** The server's answer, pulled into the shape the screens use. */
export function snapshotFrom(account: AccountRecord): AccountSnapshot {
  return {
    customerId: account.customer_id,
    member: account.member === true,
    customer: account.customer ?? null,
    points: Number(account.points ?? 0),
    lifetimePoints: Number(account.lifetime_points ?? 0),
    valueMinor: Number(account.value_minor ?? 0),
    tier: {
      name: account.tier?.name ?? 'Member',
      from: Number(account.tier?.from ?? 0),
      bonus: Number(account.tier?.bonus ?? 0),
    },
    minRedeemPoints: Number(account.min_redeem_points ?? 0),
    open: (account.open ?? []).map((entry) => ({
      token: entry.token ?? '',
      points: Number(entry.points ?? 0),
      moneyMinor: Number(entry.money_minor ?? 0),
      note: entry.note ?? null,
    })),
  }
}

/** One point, if it is a point at all. */
export function wholePoints(value: unknown): number | null {
  const points = typeof value === 'string' ? Number(value) : value
  if (typeof points !== 'number' || !Number.isInteger(points) || points === 0) return null
  return points
}

// ── The shapes the server's functions return ──────────────────────────────

export interface AccountRecord {
  customer_id: string
  member: boolean
  customer?: string | null
  phone?: string | null
  points?: number
  lifetime_points?: number
  value_minor?: number
  min_redeem_points?: number
  tier?: { id?: string; name?: string; from?: number; bonus?: number }
  ledger?: LedgerEntryRecord[]
  open?: Array<{
    token?: string
    points?: number
    money_minor?: number
    note?: string | null
  }>
}

export interface LedgerEntryRecord {
  id: string
  kind: string
  points: number
  money_minor: number | null
  sale_id: string | null
  invoice_no: string | null
  token: string | null
  note: string | null
  created_at: string
}

export interface MemberRecord {
  customer_id: string
  customer: string
  phone: string | null
  points: number
  lifetime_points: number
  tier: { id?: string; name?: string; from?: number; bonus?: number }
  value_minor: number
  joined_at: string
  last_activity_at: string
}

export interface MemberPage {
  rows: MemberRecord[]
  total: number
}
