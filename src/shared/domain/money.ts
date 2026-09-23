/**
 * Money and quantity arithmetic (spec §59, docs/09 #5).
 *
 * Every monetary value in Postgres is `numeric(14,2)` and every quantity is
 * `numeric(14,3)`. JavaScript has neither type — only IEEE-754 doubles, where
 * `0.1 + 0.2 === 0.30000000000000004`. A POS that accumulates line totals in
 * floats will disagree with its own database by a paisa here and there, and
 * the disagreement grows with volume.
 *
 * So this module never stores money as a float. Money is an **integer count of
 * minor units** (poisha) and quantity is an **integer count of milli-units**.
 * Every intermediate is an integer; rounding happens once, at the same points
 * the database rounds, with the same rule.
 *
 * The brand types exist because "3" is ambiguous in a POS — it could be three
 * poisha, three taka or three kilograms. Mixing them is the single most common
 * money bug, and it is invisible until a customer complains. The compiler
 * catches it instead.
 */

/** Integer minor units: 100 = one whole of the currency (100 poisha = ৳1). */
export type Minor = number & { readonly __minor: unique symbol }

/** Integer milli-units: 1000 = one whole unit (1500 = 1.5 kg). */
export type Milli = number & { readonly __milli: unique symbol }

/**
 * Postgres `round(numeric, int)` rounds **half away from zero**, not half to
 * even. `round(2.5) = 3` and `round(-2.5) = -3`. Using `Math.round` (which
 * rounds half toward +∞) would diverge on negative halves — a refund line.
 */
export function roundHalfAway(value: number): number {
  if (!Number.isFinite(value)) return 0
  const sign = value < 0 ? -1 : 1
  // Adding a tiny epsilon guards against binary representation landing just
  // under .5 for a value that is exactly .5 in decimal (e.g. 1.005 * 100).
  const shifted = Math.abs(value) + Number.EPSILON * Math.abs(value)
  return sign * Math.floor(shifted + 0.5)
}

/** Round a fractional minor amount to a whole poisha, Postgres-style. */
export function toMinor(value: number): Minor {
  return roundHalfAway(value) as Minor
}

/** Brand an already-integral minor count. Truncates rather than rounds. */
export function minor(value: number): Minor {
  return Math.trunc(value) as Minor
}

/** Brand an already-integral milli count. */
export function milli(value: number): Milli {
  return Math.trunc(value) as Milli
}

const ZERO = 0 as Minor
export const ZERO_MINOR: Minor = ZERO

/**
 * Parse a user- or database-supplied money value into minor units.
 *
 * Accepts a number, a Postgres numeric rendered as text (`"1250.00"`), or
 * free-form user input (`"1,250"`, `" ৳1250.5 "`). Returns null for anything
 * that is not a finite non-negative amount — a money field is never NaN.
 */
export function parseMinor(input: string | number | null | undefined): Minor | null {
  if (input === null || input === undefined || input === '') return null
  const text = typeof input === 'number' ? String(input) : input
  const cleaned = text.replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const value = Number.parseFloat(cleaned)
  if (!Number.isFinite(value)) return null
  return toMinor(value * 100)
}

/**
 * Parse a quantity into milli-units.
 *
 * When `isDecimal` is false the value is forced to a whole number: a shop
 * selling phones cannot sell 0.5 of one, and letting the keyboard produce
 * that would create a stock balance the shop can never reconcile.
 */
export function parseMilli(
  input: string | number | null | undefined,
  options: { decimal?: boolean } = {}
): Milli | null {
  if (input === null || input === undefined || input === '') return null
  const text = typeof input === 'number' ? String(input) : input
  const cleaned = text.replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const value = Number.parseFloat(cleaned)
  if (!Number.isFinite(value)) return null
  // Truncate the *value* for countable goods, not the scaled result: typing
  // "1.5" for a phone must give 1 unit, and truncating after scaling would
  // happily return 1.5 units because 1.5 × 1000 is already an integer.
  if (!options.decimal) return (Math.trunc(value) * 1000) as Milli
  return roundHalfAway(value * 1000) as Milli
}

/** Minor units back to a float, for display and for JSON payloads. */
export function minorToNumber(value: Minor): number {
  return value / 100
}

export function milliToNumber(value: Milli): number {
  return value / 1000
}

/** Render minor units as a fixed 2-decimal string, e.g. `"1250.00"`. */
export function minorToFixed(value: Minor): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const whole = Math.trunc(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${whole}.${frac}`
}

export interface MoneyFormatOptions {
  currency?: string
  locale?: string
  /** Omit the currency symbol, e.g. inside a column already headed "৳". */
  symbol?: boolean
}

/**
 * Format minor units for display: `৳1,250.00`.
 *
 * Grouping is applied by hand rather than via `Intl.NumberFormat` because the
 * Bangladeshi lakh/crore digit grouping (`1,25,000.00`) differs from the
 * Western grouping that `en-US` produces, and a shop in Dhaka expects the
 * former. `Intl` is still consulted for the currency symbol so the function
 * stays correct for other currencies.
 */
export function formatMoney(value: Minor, options: MoneyFormatOptions = {}): string {
  const { currency = 'BDT', locale = 'en-BD', symbol = true } = options
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const whole = Math.trunc(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  const grouped = groupIndian(whole)
  const prefix = symbol ? `${currencySymbol(currency, locale)}${NON_BREAKING_THIN_SPACE}` : ''
  return `${sign}${prefix}${grouped}.${frac}`
}

/** Format a quantity: whole units collapse (`3`), decimals stay (`1.250 kg`). */
export function formatQty(
  value: Milli,
  options: { decimal?: boolean; unitLabel?: string | undefined } = {}
): string {
  const { decimal = false, unitLabel } = options
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  let body: string
  if (decimal) {
    const whole = Math.trunc(abs / 1000)
    const frac = abs % 1000
    body = frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(3, '0').replace(/0+$/, '')}`
  } else {
    body = String(roundHalfAway(abs / 1000))
  }
  return unitLabel ? `${sign}${body}${NON_BREAKING_THIN_SPACE}${unitLabel}` : `${sign}${body}`
}

/** Bangladeshi / Indian digit grouping: `1234567` → `12,34,567`. */
export function groupIndian(whole: number): string {
  const digits = String(whole)
  if (digits.length <= 3) return digits
  const last3 = digits.slice(-3)
  const rest = digits.slice(0, -3)
  // Everything left of the last three digits groups in *pairs* from the
  // right: 1,00,000 — not the Western 100,000.
  const pairs: string[] = []
  for (let end = rest.length; end > 0; end -= 2) {
    pairs.unshift(rest.slice(Math.max(0, end - 2), end))
  }
  return [...pairs, last3].join(',')
}

const NON_BREAKING_THIN_SPACE = '\u202f'

/** Currency symbol with a safe fallback when Intl cannot resolve it. */
export function currencySymbol(currency: string, locale = 'en'): string {
  const known = CURRENCY_SYMBOLS[currency.toUpperCase()]
  if (known) return known
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    }).formatToParts(0)
    return parts.find((p) => p.type === 'currency')?.value ?? currency
  } catch {
    return currency
  }
}

/** Common Bangladeshi retail tender symbols; avoids an Intl round trip. */
export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  BDT: '৳',
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  PKR: '₨',
  NPR: 'रू',
  AED: 'د.إ',
  SAR: '﷼',
  MYR: 'RM',
}
