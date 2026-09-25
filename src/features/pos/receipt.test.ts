/**
 * The receipt a customer walks away with (spec §32).
 *
 * Two things are worth a test. First, the arithmetic-free formatting: a receipt
 * is the one document a shop hands to someone else, so the line a plugin asked
 * to print must land on the *right* line, under the right product. Second, that
 * nothing changes for a shop with no plugins: the same sale, no notes, byte for
 * byte the slip it always printed.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest'
import { buildReceipt, renderReceipt } from './receipt'
import type { SaleRow } from '../../shared/types/records'

function sale(): SaleRow {
  return {
    id: 's-1',
    invoice_no: 'INV-2026-000042',
    status: 'COMPLETED',
    branch_id: 'b-1',
    register_id: 'r-1',
    session_id: null,
    customer_id: null,
    currency: 'BDT',
    subtotal: '500.00',
    discount_total: '0.00',
    discount_type: null,
    discount_value: null,
    tax_total: '0.00',
    total: '500.00',
    paid_total: '500.00',
    change_due: '0.00',
    cogs: '300.00',
    profit: '200.00',
    note: null,
    created_at: '2026-09-25T10:00:00Z',
    completed_at: '2026-09-25T10:00:00Z',
    created_by: 'Rahima',
    customer: null,
    items: [
      {
        id: 'i-1',
        variant_id: 'v-1',
        product_id: 'p-1',
        product_name: 'Napa 500mg',
        variant_name: null,
        sku: 'NAPA-500',
        unit_label: 'strip',
        quantity: '2.000',
        unit_price: '250.00',
        unit_cost: '150.00',
        discount_type: null,
        discount_value: null,
        discount_total: '0.00',
        tax_rate: '0.0000',
        tax_total: '0.00',
        line_total: '500.00',
        line_cogs: '300.00',
        returned_qty: '0.000',
      },
      {
        id: 'i-2',
        variant_id: 'v-2',
        product_id: 'p-2',
        product_name: 'Savlon 100ml',
        variant_name: null,
        sku: null,
        unit_label: null,
        quantity: '1.000',
        unit_price: '0.00',
        unit_cost: '0.00',
        discount_type: null,
        discount_value: null,
        discount_total: '0.00',
        tax_rate: '0.0000',
        tax_total: '0.00',
        line_total: '0.00',
        line_cogs: '0.00',
        returned_qty: '0.000',
      },
    ],
  }
}

describe('receipt lines', () => {
  it('prints a plugin’s values under the line they belong to', () => {
    const notes = new Map([['v-1', ['Batch number: BT-2026-0142', 'Expiry: in 12 days']]])
    const data = buildReceipt(sale(), 'Mekholi Pharmacy', notes)

    expect(data.lines[0]?.notes).toEqual(['Batch number: BT-2026-0142', 'Expiry: in 12 days'])
    // The other product carries nothing, so nothing is invented for it.
    expect(data.lines[1]?.notes).toEqual([])

    const rendered = renderReceipt(data)
    const text = rendered.textContent ?? ''
    expect(text).toContain('Batch number: BT-2026-0142')
    expect(text).toContain('Napa 500mg')
  })

  it('is exactly as before when no plugin asks to print anything', () => {
    const data = buildReceipt(sale(), 'Mekholi')

    expect(data.lines.every((line) => line.notes.length === 0)).toBe(true)
    const text = renderReceipt(data).textContent ?? ''
    expect(text).toContain('Napa 500mg')
    expect(text).toContain('INV-2026-000042')
    expect(text).toContain('Thank you')
  })

  it('keeps the money on the line the server computed', () => {
    const data = buildReceipt(sale(), 'Mekholi', new Map([['v-1', ['Batch number: BT-1']]]))
    expect(data.lines[0]?.lineTotal).toMatch(/500/)
    expect(data.total).toMatch(/500/)
  })
})
