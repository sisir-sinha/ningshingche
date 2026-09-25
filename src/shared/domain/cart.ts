/**
 * The cart (spec §14, docs/03 §3).
 *
 * This file is pure: no DOM, no I/O, no Supabase. It is the arithmetic that a
 * cashier's receipt depends on, so it is the most-tested code in the project
 * and the part an Android client would port verbatim.
 *
 * ── It must agree with the database ──────────────────────────────────────
 * `public.complete_sale` recomputes every total server-side; the client's
 * numbers are a preview, never the authority. If the two diverge the receipt
 * shows one figure and the sale row stores another, which is a support call
 * nobody can resolve. So the formulas below are a deliberate transcription of
 * `supabase/migrations/20260923_012_rpc_sale.sql` **as amended by 021**:
 *
 *     v_line_disc := case
 *       when PERCENT then round(qty * price * value / 100, 2)
 *       when FLAT    then least(round(value, 2), qty * price)
 *       else 0 end
 *     v_taxable := round(qty * price - v_line_disc, 2)
 *     v_tax     := inclusive ? round(taxable * r / (100 + r), 2)
 *                            : round(taxable * r / 100, 2)
 *     v_line_total := inclusive ? taxable : taxable + tax
 *     v_subtotal   += round(qty * price, 2)     -- rounded at every addition
 *     v_cogs       += round(qty * cost, 2)
 *     v_line_sum   += v_line_total
 *     total = v_line_sum - order_discount
 *
 * `cart.test.ts` re-runs the same scenarios the migration validator asserts
 * against Postgres, so a change to either side that breaks the agreement
 * fails locally before it reaches a shop.
 */

import {
  formatQty,
  minorToNumber,
  roundHalfAway,
  type Milli,
  type Minor,
} from './money'

export type DiscountType = 'FLAT' | 'PERCENT'

/**
 * A unit cost is `numeric(14,4)` in Postgres — finer than money, because a
 * per-gram cost has to be. Stored here as integer ten-thousandths of a taka.
 */
export type CostMicro = number

/**
 * An exact money amount scaled 1000×, so `qty × price` can be accumulated
 * without rounding. Postgres keeps `v_subtotal` at full precision until the
 * final `numeric(14,2)` assignment; this mirrors that.
 */
type MicroMinor = number

export interface CartLineSource {
  variantId: string
  productId: string
  name: string
  variantName?: string | null
  sku?: string | null
  unitLabel?: string | null
  unitPrice: Minor
  /** Ten-thousandths of a taka, matching `products.cost_price numeric(14,4)`. */
  unitCost: CostMicro
  /** Percent, e.g. 15 for 15%. Matches `taxes.rate numeric(6,4)`. */
  taxRatePercent: number
  taxInclusive: boolean
  trackStock: boolean
  allowNegative: boolean
  /** Null when stock is not tracked for this product. */
  availableQty: Milli | null
  /** True for weight/volume units, so 1.25 kg is a legal quantity. */
  decimalQuantity: boolean
}

export interface CartLine extends CartLineSource {
  /** Stable within the cart, so DOM nodes can be reused across renders. */
  lineId: string
  quantity: Milli
  discountType: DiscountType | null
  /** Percent for PERCENT, whole minor units for FLAT. */
  discountValue: number
}

export interface LineTotals {
  lineId: string
  /** `qty × price`, before any discount. Exact. */
  gross: Minor
  discount: Minor
  taxable: Minor
  tax: Minor
  /** What the customer pays for this line. */
  total: Minor
  cogs: Minor
}

export interface CartTotals {
  lines: LineTotals[]
  subtotal: Minor
  /**
   * The sale as the goods price it, before the order-level discount — the
   * number a plugin quoting money off must reason about.
   *
   * It is deliberately not `total`: the order discount is a slot a plugin
   * writes to, so a plugin that quoted against `total` would quote a smaller
   * amount every time its own discount was applied, and would have no way to
   * notice that a cart had shrunk out from under a discount it already gave.
   */
  beforeOrderDiscount: Minor
  /** Line discounts plus the order-level discount. */
  discount: Minor
  tax: Minor
  total: Minor
  cogs: Minor
  /** Lines whose quantity exceeds what the warehouse holds. */
  oversold: string[]
  itemCount: Milli
}

export interface Cart {
  lines: CartLine[]
  discountType: DiscountType | null
  discountValue: number
  customerId: string | null
  note: string
}

export function emptyCart(): Cart {
  return { lines: [], discountType: null, discountValue: 0, customerId: null, note: '' }
}

export function isEmpty(cart: Cart): boolean {
  return cart.lines.length === 0
}

let lineCounter = 0
function nextLineId(): string {
  lineCounter += 1
  return `line-${Date.now().toString(36)}-${lineCounter.toString(36)}`
}

/** Reset the id counter; used by tests so snapshots are deterministic. */
export function resetLineIds(): void {
  lineCounter = 0
}

/**
 * Add a product, or increase its quantity when it is already in the cart.
 *
 * Merging on the variant — not the product — is what makes a sized t-shirt
 * behave correctly: M and L are the same product and must stay two lines.
 */
export function addLine(cart: Cart, source: CartLineSource, quantity: Milli): Cart {
  if (quantity <= 0) return cart
  const existing = cart.lines.find((line) => line.variantId === source.variantId)
  if (existing) {
    return setQuantity(cart, existing.lineId, (existing.quantity + quantity) as Milli)
  }
  const line: CartLine = {
    ...source,
    lineId: nextLineId(),
    quantity,
    discountType: null,
    discountValue: 0,
  }
  return { ...cart, lines: [...cart.lines, line] }
}

export function setQuantity(cart: Cart, lineId: string, quantity: Milli): Cart {
  const lines = cart.lines.flatMap((line) => {
    if (line.lineId !== lineId) return [line]
    // Zero removes the line. A POS with a separate delete button and a
    // quantity field that cannot reach zero is a POS with two ways to do
    // one job; cashiers notice.
    if (quantity <= 0) return []
    return [{ ...line, quantity }]
  })
  return { ...cart, lines }
}

export function incrementLine(cart: Cart, lineId: string, by: Milli): Cart {
  const line = cart.lines.find((l) => l.lineId === lineId)
  if (!line) return cart
  return setQuantity(cart, lineId, (line.quantity + by) as Milli)
}

export function removeLine(cart: Cart, lineId: string): Cart {
  return { ...cart, lines: cart.lines.filter((line) => line.lineId !== lineId) }
}

export function setLineDiscount(
  cart: Cart,
  lineId: string,
  discountType: DiscountType | null,
  discountValue: number
): Cart {
  return {
    ...cart,
    lines: cart.lines.map((line) =>
      line.lineId === lineId ? { ...line, discountType, discountValue } : line
    ),
  }
}

export function setOrderDiscount(
  cart: Cart,
  discountType: DiscountType | null,
  discountValue: number
): Cart {
  return { ...cart, discountType, discountValue }
}

export function setCustomer(cart: Cart, customerId: string | null): Cart {
  return { ...cart, customerId }
}

export function setNote(cart: Cart, note: string): Cart {
  return { ...cart, note }
}

// ── Totals ────────────────────────────────────────────────────────────────

/**
 * Per-line arithmetic. Mirrors the body of the `for v_item` loop in
 * `complete_sale` exactly, including which intermediates get rounded.
 *
 * Every `numeric(14,2)` assignment in the RPC rounds, so the same rounding
 * points are reproduced here — `v_taxable` in particular is rounded *before*
 * the tax is computed from it, and getting that order wrong drifts by a paisa
 * on fractional quantities.
 */
function lineTotals(line: CartLine): LineTotals {
  const grossMicro: MicroMinor = line.quantity * line.unitPrice
  const grossExact = grossMicro / 1000

  let discount: Minor = 0 as Minor
  if (line.discountType === 'PERCENT' && line.discountValue > 0) {
    discount = roundHalfAway((grossMicro / 100000) * line.discountValue) as Minor
  } else if (line.discountType === 'FLAT' && line.discountValue > 0) {
    discount = roundHalfAway(Math.min(roundHalfAway(line.discountValue), grossExact)) as Minor
  }

  // `v_taxable numeric(14,2)` — the assignment rounds.
  const taxable = roundHalfAway(grossExact - discount) as Minor

  const rate = line.taxRatePercent
  let tax: Minor = 0 as Minor
  if (rate > 0) {
    tax = (
      line.taxInclusive
        ? roundHalfAway((taxable * rate) / (100 + rate))
        : roundHalfAway((taxable * rate) / 100)
    ) as Minor
  }

  // For an inclusive line the tax is already inside `taxable`; adding it
  // would charge the customer twice. See migration 021.
  const total = (line.taxInclusive ? taxable : taxable + tax) as Minor

  return {
    lineId: line.lineId,
    gross: roundHalfAway(grossExact) as Minor,
    discount,
    taxable,
    tax,
    total,
    cogs: roundHalfAway((line.quantity * line.unitCost) / 100000) as Minor,
  }
}

/**
 * Cart totals, including the order-level discount.
 *
 * The order discount applies to `subtotal - line_discounts`, matching the
 * `elsif` block in the RPC. Both FLAT and PERCENT are clamped so a discount
 * can never drive the total negative — the database raises `negative_total`
 * otherwise, and it is better to prevent that in the UI than to show the
 * cashier a Postgres error.
 */
export function computeTotals(cart: Cart): CartTotals {
  const lines = cart.lines.map(lineTotals)

  // `v_subtotal` is `numeric(14,2)`, so the RPC rounds on *every* addition,
  // not once at the end. Accumulating at full precision would drift from the
  // database on fractional quantities.
  let subtotal = 0
  let lineDiscount = 0
  let tax = 0
  let cogs = 0
  let lineSum = 0
  let itemCount = 0

  for (let i = 0; i < cart.lines.length; i += 1) {
    const line = cart.lines[i]
    const totals = lines[i]
    if (!line || !totals) continue
    subtotal = roundHalfAway(subtotal + (line.quantity * line.unitPrice) / 1000)
    lineDiscount += totals.discount
    tax += totals.tax
    cogs += totals.cogs
    lineSum += totals.total
    itemCount += line.quantity
  }

  // The order discount applies to the goods value after line discounts.
  let orderDiscount = 0
  const basis = subtotal - lineDiscount
  if (cart.discountType === 'PERCENT' && cart.discountValue > 0) {
    orderDiscount = roundHalfAway((basis * cart.discountValue) / 100)
  } else if (cart.discountType === 'FLAT' && cart.discountValue > 0) {
    orderDiscount = Math.min(roundHalfAway(cart.discountValue), basis)
  }

  return {
    lines,
    subtotal: subtotal as Minor,
    beforeOrderDiscount: Math.max(lineSum, 0) as Minor,
    discount: Math.min(lineDiscount + orderDiscount, subtotal) as Minor,
    tax: tax as Minor,
    // Sum of line totals, minus only the order-level discount — never
    // `subtotal - discount + tax`, which double-charges inclusive lines.
    total: Math.max(lineSum - orderDiscount, 0) as Minor,
    cogs: cogs as Minor,
    oversold: cart.lines
      .filter(
        (line) =>
          line.trackStock &&
          !line.allowNegative &&
          line.availableQty !== null &&
          line.quantity > line.availableQty
      )
      .map((line) => line.lineId),
    itemCount: itemCount as Milli,
  }
}

// ── Payments ──────────────────────────────────────────────────────────────

export interface PaymentEntry {
  methodId: string
  methodKey: string
  methodName: string
  amount: Minor
  /** Free text: a bKash trxid, the last four of a card. */
  reference?: string
}

/**
 * Amount still owed. Never negative — an overpayment is change, not debt.
 */
export function balanceDue(total: Minor, payments: readonly PaymentEntry[]): Minor {
  let paid = 0
  for (const payment of payments) paid += payment.amount
  return Math.max(total - paid, 0) as Minor
}

/**
 * Change to hand back, and whether the sale is settled.
 *
 * Mirrors the RPC: `paid < total` leaves the sale `PARTIALLY_PAID` with no
 * change, because credit is a deliberate act (a khata entry), not the
 * automatic result of underpaying.
 */
export function settlement(
  total: Minor,
  payments: readonly PaymentEntry[]
): { paid: Minor; change: Minor; settled: boolean; status: 'COMPLETED' | 'PARTIALLY_PAID' } {
  let paid = 0
  for (const payment of payments) paid += payment.amount
  const settled = paid >= total
  return {
    paid: paid as Minor,
    change: settled ? ((paid - total) as Minor) : (0 as Minor),
    settled,
    status: settled ? 'COMPLETED' : 'PARTIALLY_PAID',
  }
}

/** Round-robin common Bangladeshi notes against a change amount. */
export const NOTE_DENOMINATIONS: readonly Minor[] = [
  100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1,
] as unknown as readonly Minor[]

export function suggestNotes(change: Minor): { denomination: Minor; count: number }[] {
  let remaining = change
  const out: { denomination: Minor; count: number }[] = []
  for (const denomination of NOTE_DENOMINATIONS) {
    if (remaining <= 0) break
    const count = Math.floor(remaining / denomination)
    if (count > 0) {
      out.push({ denomination, count })
      remaining = (remaining - count * denomination) as Minor
    }
  }
  return out
}

// ── Payloads ──────────────────────────────────────────────────────────────

/** The `p_items` jsonb shape `complete_sale` and `hold_sale` both read. */
export interface SaleItemPayload {
  variant_id: string
  qty: number
  discount_type?: DiscountType
  discount_value?: number
}

/** The `p_payments` jsonb shape `complete_sale` reads. */
export interface SalePaymentPayload {
  method_id: string
  amount: number
  reference?: string
}

/**
 * Serialise the cart for the RPC.
 *
 * Zero-valued discount fields are omitted rather than sent as null: the RPC
 * does `v_item ->> 'discount_type'` and compares the text, so an absent key
 * and an explicit null behave identically there — but the audit log and any
 * future Edge Function reader sees a smaller, clearer payload.
 */
export function toSaleItems(cart: Cart): SaleItemPayload[] {
  return cart.lines.map((line) => {
    const payload: SaleItemPayload = {
      variant_id: line.variantId,
      qty: line.quantity / 1000,
    }
    if (line.discountType && line.discountValue > 0) {
      payload.discount_type = line.discountType
      payload.discount_value = line.discountValue
    }
    return payload
  })
}

export function toSalePayments(payments: readonly PaymentEntry[]): SalePaymentPayload[] {
  return payments.map((payment) => {
    const payload: SalePaymentPayload = {
      method_id: payment.methodId,
      amount: minorToNumber(payment.amount),
    }
    if (payment.reference) payload.reference = payment.reference
    return payload
  })
}

// ── Display helpers ───────────────────────────────────────────────────────

/** One row of the on-screen cart, pre-rendered as strings. */
export function describeLine(line: CartLine, totals: LineTotals): string {
  const qty = formatQty(line.quantity, {
    decimal: line.decimalQuantity,
    ...(line.unitLabel ? { unitLabel: line.unitLabel } : {}),
  })
  return `${line.name}${line.variantName ? ` · ${line.variantName}` : ''} — ${qty} @ ${minorToNumber(
    line.unitPrice
  ).toFixed(2)} = ${minorToNumber(totals.total).toFixed(2)}`
}

/**
 * Guard used by both the POS and the sale service.
 *
 * Returns a message the cashier can act on, or null when the sale may
 * proceed. Stock is the database's call — this only prevents an obvious
 * round trip that would fail.
 */
export function validateCart(cart: Cart): string | null {
  if (cart.lines.length === 0) return 'The cart is empty.'
  const totals = computeTotals(cart)
  for (const lineId of totals.oversold) {
    const line = cart.lines.find((l) => l.lineId === lineId)
    if (!line) continue
    const have = line.availableQty ?? (0 as Milli)
    return `${line.name}: requested ${formatQty(line.quantity)}, ${formatQty(have)} in stock.`
  }
  if (totals.total <= 0 && cart.lines.length > 0) return 'The total cannot be zero or negative.'
  return null
}
