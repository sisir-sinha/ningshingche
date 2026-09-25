/**
 * A sale the server has not seen yet, in the shape the receipt code already
 * knows how to print.
 *
 * The customer paid and is standing there. "The internet is down, I cannot give
 * you a slip" is not an answer a shop can give, so the till prints one from what
 * it knows. Two rules make that honest rather than a second source of truth:
 *
 *   · The money on the slip is the cart's own arithmetic (`computeTotals`),
 *     which is the same code that drew the total on screen a second earlier.
 *     Nothing here re-prices anything.
 *   · It is marked. The row says it is not final, and the printed receipt
 *     carries the reference the customer keeps — which is also the reference
 *     the queue will send, so the slip can be matched to the stored sale once
 *     the connection returns.
 *
 * `buildReceipt` is reused unchanged: the offline path feeds it a `SaleRow`
 * instead of teaching it a second input shape.
 */

import { computeTotals, type Cart } from '../../domain/cart'
import { minorToFixed, type Minor } from '../../domain/money'
import type { SaleItemRow, SaleRow } from '../../types/records'

export interface OfflineSaleInput {
  /** The queue's reference — minted once, at the moment of the sale. */
  ref: string
  cart: Cart
  branchId: string
  registerId: string | null
  sessionId: string | null
  currency: string
  /** ISO timestamp; injected so a test can pin the printed time. */
  at: string
  note?: string | null
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

/** The label the slip carries instead of an invoice number it does not have. */
export const OFFLINE_LABEL = 'Not yet numbered'

/**
 * The customer-facing reference: the last six characters, upper case.
 *
 * A UUID is unreadable across a counter. Six characters collide eventually, and
 * that is acceptable here because it is a *label*, not a key — the queue and the
 * server both use the whole reference.
 */
export function shortRef(ref: string): string {
  return ref.replace(/-/g, '').slice(-6).toUpperCase()
}

export function offlineSaleRow(input: OfflineSaleInput): SaleRow {
  const totals = computeTotals(input.cart)
  const money = (value: Minor): string => minorToFixed(value)

  const items: SaleItemRow[] = input.cart.lines.map((line) => {
    const lineTotals = totals.lines.find((entry) => entry.lineId === line.lineId)
    return {
      id: line.lineId,
      variant_id: line.variantId,
      product_id: line.productId,
      product_name: line.name,
      variant_name: line.variantName ?? null,
      sku: line.sku ?? null,
      unit_label: line.unitLabel ?? null,
      quantity: String(line.quantity / 1000),
      unit_price: money(line.unitPrice),
      unit_cost: minorToFixed(Math.round(line.unitCost / 100) as Minor),
      discount_type: line.discountType,
      discount_value: line.discountValue > 0 ? String(line.discountValue) : null,
      discount_total: money(lineTotals?.discount ?? (0 as Minor)),
      tax_rate: String(line.taxRatePercent),
      tax_total: money(lineTotals?.tax ?? (0 as Minor)),
      line_total: money(lineTotals?.total ?? (0 as Minor)),
      line_cogs: money(lineTotals?.cogs ?? (0 as Minor)),
      returned_qty: '0',
    }
  })

  return {
    id: input.ref,
    invoice_no: OFFLINE_LABEL,
    // COMPLETED, because to the shop it is: the goods have left and the money
    // is in the drawer. What is unresolved is the *number*, and that is what
    // the status line and the note spell out.
    status: 'COMPLETED',
    branch_id: input.branchId,
    register_id: input.registerId,
    session_id: input.sessionId,
    customer_id: input.cart.customerId,
    currency: input.currency,
    subtotal: money(totals.subtotal),
    discount_total: money(totals.discount),
    discount_type: input.cart.discountType,
    discount_value: input.cart.discountValue > 0 ? String(input.cart.discountValue) : null,
    tax_total: money(totals.tax),
    total: money(totals.total),
    paid_total: money(totals.total),
    change_due: money(0 as Minor),
    cogs: money(totals.cogs),
    profit: money((totals.total - totals.tax - totals.cogs) as Minor),
    // The shop's own note if there is one, and the reference line otherwise.
    // Empty strings are not notes: a cart with `note: ''` (the cart's default)
    // must not lose the one thing that makes the slip findable later.
    note:
      firstNonEmpty(input.note, input.cart.note) ??
      `Offline sale · reference ${shortRef(input.ref)}`,
    created_at: input.at,
    completed_at: input.at,
    created_by: null,
    customer: null,
    items,
  }
}
