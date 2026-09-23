/**
 * Cart arithmetic.
 *
 * The first suite is the important one: it re-runs the same scenarios that
 * `tools/validate-migrations.mjs` asserts against a real Postgres, so the
 * client preview and `public.complete_sale` cannot drift apart unnoticed.
 * If you change a formula here, change the RPC — and the migration validator
 * will tell you if you only changed one.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  addLine,
  balanceDue,
  computeTotals,
  emptyCart,
  incrementLine,
  isEmpty,
  removeLine,
  resetLineIds,
  setLineDiscount,
  setNote,
  setOrderDiscount,
  setQuantity,
  settlement,
  suggestNotes,
  toSaleItems,
  toSalePayments,
  validateCart,
  type CartLineSource,
  type PaymentEntry,
} from './cart'
import { minor, milli, type Milli, type Minor } from './money'

/** The seeded demo product: ৳250 selling, ৳150 cost, no tax. */
const RICE: CartLineSource = {
  variantId: '00000000-0000-0000-0000-00000000c002',
  productId: '00000000-0000-0000-0000-0000000000c1',
  name: 'Miniket Rice',
  variantName: null,
  sku: 'RICE-5KG',
  unitLabel: 'ea',
  unitPrice: minor(25000),
  unitCost: 1500000, // ৳150.0000
  taxRatePercent: 0,
  taxInclusive: false,
  trackStock: true,
  allowNegative: false,
  availableQty: milli(10000), // 10 units
  decimalQuantity: false,
}

/** A taxable, tax-exclusive product. */
const LAPTOP: CartLineSource = {
  ...RICE,
  variantId: 'v-laptop',
  productId: 'p-laptop',
  name: 'Laptop',
  sku: 'LAP-1',
  unitPrice: minor(5000000), // ৳50,000
  unitCost: 400000000,
  taxRatePercent: 15,
  taxInclusive: false,
  availableQty: milli(5000),
}

/** A tax-inclusive product — the total already contains the tax. */
const SOAP: CartLineSource = {
  ...RICE,
  variantId: 'v-soap',
  productId: 'p-soap',
  name: 'Soap',
  unitPrice: minor(11500), // ৳115 inclusive of 15%
  unitCost: 800000,
  taxRatePercent: 15,
  taxInclusive: true,
  availableQty: milli(100000),
}

/** Sold by weight, so fractional quantities are legal. */
const SUGAR: CartLineSource = {
  ...RICE,
  variantId: 'v-sugar',
  productId: 'p-sugar',
  name: 'Sugar',
  unitLabel: 'kg',
  unitPrice: minor(12000),
  unitCost: 950000,
  taxRatePercent: 0,
  taxInclusive: false,
  availableQty: milli(50000), // 50 kg
  decimalQuantity: true,
}

const CASH: PaymentEntry = {
  methodId: 'pm-cash',
  methodKey: 'cash',
  methodName: 'Cash',
  amount: minor(0),
}

function pay(amount: Minor, key = 'cash'): PaymentEntry {
  return { ...CASH, methodKey: key, methodName: key, amount }
}

beforeEach(() => {
  resetLineIds()
})

describe('agreement with public.complete_sale', () => {
  it('reproduces the migration validator scenario: 3 × ৳250 = ৳750', () => {
    // tools/validate-migrations.mjs asserts total 750, cogs 450, profit 300
    // for exactly this product and quantity against a real Postgres.
    const cart = addLine(emptyCart(), RICE, milli(3000))
    const totals = computeTotals(cart)

    expect(totals.subtotal).toBe(minor(75000))
    expect(totals.tax).toBe(0)
    expect(totals.discount).toBe(0)
    expect(totals.total).toBe(minor(75000))
    expect(totals.cogs).toBe(minor(45000))
    expect(totals.total - totals.cogs).toBe(minor(30000)) // profit 300
  })

  it('computes an order discount on the post-line-discount goods value', () => {
    // 3 × ৳33.33 = ৳99.99. A PERCENT discount of 10% is round(9.999) = ৳10.00.
    const odd = { ...RICE, unitPrice: minor(3333) }
    const cart = setOrderDiscount(addLine(emptyCart(), odd, milli(3000)), 'PERCENT', 10)
    const totals = computeTotals(cart)

    expect(totals.subtotal).toBe(minor(9999))
    expect(totals.discount).toBe(minor(1000))
    expect(totals.total).toBe(minor(8999))
  })

  it('rounds the subtotal at every addition, as numeric(14,2) does', () => {
    // 0.333 kg × ৳100.25 = 33.38325 → the RPC stores 33.38 per line, then adds.
    // Summing at full precision would give 99.9975 → 100.00; the database,
    // rounding per line, gives 100.02. Three lines expose the difference.
    const fractional = { ...SUGAR, unitPrice: minor(10025) }
    let cart = emptyCart()
    for (let i = 0; i < 3; i += 1) {
      cart = addLine(cart, { ...fractional, variantId: `v-frac-${i}` }, milli(333))
    }
    const totals = computeTotals(cart)

    expect(totals.subtotal).toBe(minor(3338 * 3))
    expect(totals.total).toBe(minor(3338 * 3))
  })

  it('computes tax on a tax-exclusive line the way the RPC does', () => {
    const cart = addLine(emptyCart(), LAPTOP, milli(1000))
    const totals = computeTotals(cart)

    // taxable 50000.00 × 15 / 100 = 7500.00
    expect(totals.tax).toBe(minor(750000))
    expect(totals.total).toBe(minor(5750000))
  })

  it('extracts tax from a tax-inclusive line instead of adding it', () => {
    // Regression: before migration 021 the RPC computed the inclusive line
    // total correctly and then ignored it, summing `subtotal + tax` instead.
    // A ৳115 VAT-inclusive soap charged ৳130. Verified against live Postgres.
    const cart = addLine(emptyCart(), SOAP, milli(1000))
    const totals = computeTotals(cart)

    // 115 × 15 / 115 = 15.00, and the line total stays 115.
    expect(totals.tax).toBe(minor(1500))
    expect(totals.total).toBe(minor(11500))
  })

  it('handles a mixed cart of inclusive and exclusive lines', () => {
    // Soap ৳115 inclusive (৳15 tax inside) + Laptop ৳50,000 + ৳7,500 tax.
    let cart = addLine(emptyCart(), SOAP, milli(1000))
    cart = addLine(cart, LAPTOP, milli(1000))
    const totals = computeTotals(cart)

    expect(totals.tax).toBe(minor(1500 + 750000))
    expect(totals.total).toBe(minor(11500 + 5750000))
  })

  it('clamps a FLAT line discount to the line total, never below zero', () => {
    // `least(round(value, 2), qty * price)` in the RPC.
    let cart = addLine(emptyCart(), RICE, milli(1000))
    cart = setLineDiscount(cart, cart.lines[0]!.lineId, 'FLAT', 99999900)
    const totals = computeTotals(cart)

    expect(totals.discount).toBe(minor(25000))
    expect(totals.total).toBe(0)
  })

  it('clamps a FLAT order discount to the subtotal', () => {
    let cart = addLine(emptyCart(), RICE, milli(1000))
    cart = setOrderDiscount(cart, 'FLAT', 99999900)
    const totals = computeTotals(cart)

    expect(totals.discount).toBe(minor(25000))
    expect(totals.total).toBe(0)
  })

  it('applies line and order discounts in the RPC order', () => {
    // Two lines, one with a ৳50 line discount, then 10% off the remainder.
    let cart = addLine(emptyCart(), RICE, milli(1000)) // 250
    cart = addLine(cart, LAPTOP, milli(1000)) // 50000 + 7500 tax
    cart = setLineDiscount(cart, cart.lines[0]!.lineId, 'FLAT', 5000)
    cart = setOrderDiscount(cart, 'PERCENT', 10)

    const totals = computeTotals(cart)
    // subtotal 50250.00, line discount 50.00 → basis 50200.00
    // order discount round(50200 × 10 / 100) = 5020.00
    expect(totals.subtotal).toBe(minor(5025000))
    expect(totals.discount).toBe(minor(5000 + 502000))
    expect(totals.tax).toBe(minor(750000))
    expect(totals.total).toBe(minor(5025000 - 507000 + 750000))
  })
})

describe('decimal quantities', () => {
  it('prices a weight-sold line exactly', () => {
    // 1.25 kg × ৳120 = ৳150.00 — the classic float-failure case.
    const cart = addLine(emptyCart(), SUGAR, milli(1250))
    const totals = computeTotals(cart)

    expect(totals.subtotal).toBe(minor(15000))
    expect(totals.total).toBe(minor(15000))
  })

  it('sums fractional weights without drift', () => {
    let cart = emptyCart()
    for (let i = 0; i < 10; i += 1) cart = addLine(cart, { ...SUGAR, variantId: `v-${i}` }, milli(100))
    const totals = computeTotals(cart)

    // 10 × 0.1 kg × ৳120 = ৳120.00 exactly.
    expect(totals.itemCount).toBe(milli(1000))
    expect(totals.total).toBe(minor(12000))
  })
})

describe('cart operations', () => {
  it('merges a repeat scan into the existing line', () => {
    let cart = addLine(emptyCart(), RICE, milli(1000))
    cart = addLine(cart, RICE, milli(2000))

    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0]!.quantity).toBe(milli(3000))
  })

  it('keeps different variants of one product on separate lines', () => {
    const medium = { ...RICE, variantId: 'v-m', variantName: 'M' }
    const large = { ...RICE, variantId: 'v-l', variantName: 'L' }

    let cart = addLine(emptyCart(), medium, milli(1000))
    cart = addLine(cart, large, milli(1000))

    expect(cart.lines).toHaveLength(2)
  })

  it('removes a line when its quantity reaches zero', () => {
    let cart = addLine(emptyCart(), RICE, milli(2000))
    const id = cart.lines[0]!.lineId
    cart = setQuantity(cart, id, milli(0))

    expect(cart.lines).toHaveLength(0)
    expect(isEmpty(cart)).toBe(true)
  })

  it('ignores a non-positive add', () => {
    const cart = addLine(emptyCart(), RICE, milli(0))
    expect(cart.lines).toHaveLength(0)
  })

  it('increments and decrements by one unit', () => {
    let cart = addLine(emptyCart(), RICE, milli(1000))
    const id = cart.lines[0]!.lineId
    cart = incrementLine(cart, id, milli(1000))
    expect(cart.lines[0]!.quantity).toBe(milli(2000))

    cart = incrementLine(cart, id, milli(-1000))
    expect(cart.lines[0]!.quantity).toBe(milli(1000))
  })

  it('increments by the smallest sensible step for a weight unit', () => {
    let cart = addLine(emptyCart(), SUGAR, milli(500))
    const id = cart.lines[0]!.lineId
    cart = incrementLine(cart, id, milli(250))
    expect(cart.lines[0]!.quantity).toBe(milli(750))
  })

  it('removes by id and leaves the others alone', () => {
    let cart = addLine(emptyCart(), RICE, milli(1000))
    cart = addLine(cart, LAPTOP, milli(1000))
    const id = cart.lines[0]!.lineId
    cart = removeLine(cart, id)

    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0]!.name).toBe('Laptop')
  })

  it('does not mutate the cart it was given', () => {
    const original = addLine(emptyCart(), RICE, milli(1000))
    const before = original.lines[0]!.quantity
    addLine(original, RICE, milli(1000))

    expect(original.lines[0]!.quantity).toBe(before)
    expect(original.lines).toHaveLength(1)
  })

  it('carries a customer and a note through', () => {
    let cart = addLine(emptyCart(), RICE, milli(1000))
    cart = setNote(cart, 'Delivery at 5pm')
    expect(cart.note).toBe('Delivery at 5pm')
  })
})

describe('stock guarding', () => {
  it('flags an oversold line', () => {
    const cart = addLine(emptyCart(), RICE, milli(11000)) // 11 units, 10 in stock
    const totals = computeTotals(cart)

    expect(totals.oversold).toHaveLength(1)
    expect(validateCart(cart)).toContain('Miniket Rice')
  })

  it('accepts a line at exactly the available quantity', () => {
    const cart = addLine(emptyCart(), RICE, milli(10000))
    expect(computeTotals(cart).oversold).toHaveLength(0)
    expect(validateCart(cart)).toBeNull()
  })

  it('does not flag a product that allows negative stock', () => {
    const backorder = { ...RICE, allowNegative: true }
    const cart = addLine(emptyCart(), backorder, milli(99000))
    expect(computeTotals(cart).oversold).toHaveLength(0)
  })

  it('does not flag a product whose stock is not tracked', () => {
    const service = { ...RICE, trackStock: false, availableQty: null }
    const cart = addLine(emptyCart(), service, milli(99000))
    expect(computeTotals(cart).oversold).toHaveLength(0)
  })

  it('refuses an empty cart', () => {
    expect(validateCart(emptyCart())).toBe('The cart is empty.')
  })
})

describe('settlement', () => {
  it('settles an exact payment with no change', () => {
    const result = settlement(minor(75000), [pay(minor(75000))])
    expect(result.settled).toBe(true)
    expect(result.change).toBe(0)
    expect(result.status).toBe('COMPLETED')
  })

  it('returns change on an overpayment', () => {
    const result = settlement(minor(75000), [pay(minor(100000))])
    expect(result.settled).toBe(true)
    expect(result.change).toBe(minor(25000))
  })

  it('leaves an underpayment partially paid, with no change', () => {
    // Mirrors the RPC: `paid < total` → PARTIALLY_PAID and change 0.
    const result = settlement(minor(75000), [pay(minor(50000))])
    expect(result.settled).toBe(false)
    expect(result.change).toBe(0)
    expect(result.status).toBe('PARTIALLY_PAID')
    expect(balanceDue(minor(75000), [pay(minor(50000))])).toBe(minor(25000))
  })

  it('sums a split payment across methods', () => {
    const payments = [pay(minor(30000), 'cash'), pay(minor(45000), 'bkash')]
    const result = settlement(minor(75000), payments)
    expect(result.paid).toBe(minor(75000))
    expect(result.settled).toBe(true)
    expect(balanceDue(minor(75000), payments)).toBe(0)
  })

  it('never reports a negative balance', () => {
    expect(balanceDue(minor(1000), [pay(minor(9999900))])).toBe(0)
  })
})

describe('suggestNotes', () => {
  it('breaks change into Bangladeshi notes, largest first', () => {
    const notes = suggestNotes(minor(100000 + 50000 + 2500)) // ৳1,525
    expect(notes[0]).toEqual({ denomination: minor(100000), count: 1 })
    expect(notes[1]).toEqual({ denomination: minor(50000), count: 1 })
    expect(notes).toContainEqual({ denomination: minor(2000), count: 1 })
    expect(notes).toContainEqual({ denomination: minor(500), count: 1 })
  })

  it('returns nothing for zero change', () => {
    expect(suggestNotes(minor(0))).toEqual([])
  })

  it('accounts for every paisa of the change', () => {
    const change = minor(123456)
    const total = suggestNotes(change).reduce(
      (sum, note) => sum + note.denomination * note.count,
      0
    )
    expect(total).toBe(change)
  })
})

describe('RPC payloads', () => {
  it('emits the jsonb keys complete_sale reads', () => {
    let cart = addLine(emptyCart(), RICE, milli(3000))
    cart = addLine(cart, SUGAR, milli(1250))
    const items = toSaleItems(cart)

    expect(items).toEqual([
      { variant_id: RICE.variantId, qty: 3 },
      { variant_id: SUGAR.variantId, qty: 1.25 },
    ])
  })

  it('includes a line discount only when one is set', () => {
    let cart = addLine(emptyCart(), RICE, milli(1000))
    expect(toSaleItems(cart)[0]).not.toHaveProperty('discount_type')

    cart = setLineDiscount(cart, cart.lines[0]!.lineId, 'PERCENT', 10)
    expect(toSaleItems(cart)[0]).toEqual({
      variant_id: RICE.variantId,
      qty: 1,
      discount_type: 'PERCENT',
      discount_value: 10,
    })
  })

  it('omits a zero-value discount rather than sending it', () => {
    let cart = addLine(emptyCart(), RICE, milli(1000))
    cart = setLineDiscount(cart, cart.lines[0]!.lineId, 'FLAT', 0)
    expect(toSaleItems(cart)[0]).not.toHaveProperty('discount_value')
  })

  it('emits payments as plain numbers, not minor units', () => {
    // Postgres reads `(v_pay ->> 'amount')::numeric(14,2)` — taka, not poisha.
    const payments = toSalePayments([pay(minor(75000))])
    expect(payments).toEqual([{ method_id: 'pm-cash', amount: 750 }])
  })

  it('includes a payment reference when one is given', () => {
    const payments = toSalePayments([
      { ...CASH, methodKey: 'bkash', amount: minor(50000), reference: 'TRX9F2K' },
    ])
    expect(payments).toEqual([{ method_id: 'pm-cash', amount: 500, reference: 'TRX9F2K' }])
  })
})

describe('item count', () => {
  it('sums quantities across lines, not line counts', () => {
    let cart = addLine(emptyCart(), RICE, milli(2000))
    cart = addLine(cart, SUGAR, milli(1500))
    expect(computeTotals(cart).itemCount).toBe(milli(3500) as Milli)
  })
})
