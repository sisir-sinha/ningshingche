/**
 * Stock history screen test.
 *
 * The Phase 3 acceptance criterion is that "the stock history screen explains
 * any balance end to end" — so the thing worth testing is not that rows render
 * but that each row states the arithmetic: before → after, and the signed
 * delta. A ledger that shows only quantities is a list, not an explanation.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { stockHistoryView } from './stock-history-view'
import { milli, minor } from '../../shared/domain/money'

const movement = (over: Record<string, unknown> = {}) => ({
  id: 'm-1',
  createdAt: '2026-09-25T10:00:00.000Z',
  type: 'PURCHASE',
  direction: 1 as const,
  quantity: milli(10_000),
  delta: milli(10_000),
  beforeQuantity: milli(7_000),
  afterQuantity: milli(17_000),
  unitCost: minor(15_000),
  warehouseId: 'w-1',
  warehouseName: 'Shop Floor',
  variantId: 'v-1',
  productName: 'Basmati Rice 5kg',
  variantName: null,
  referenceType: 'stock_in',
  referenceId: null,
  note: null,
  userId: 'u-1',
  ...over,
})

const stockRow = {
  variantId: 'v-1',
  productId: 'p-1',
  productName: 'Basmati Rice 5kg',
  variantName: null,
  sku: 'RICE-5',
  warehouseId: 'w-1',
  warehouseName: 'Shop Floor',
  quantity: milli(17_000),
  avgUnitCost: minor(15_000),
  stockValue: minor(2_550_000),
  reorderPoint: milli(5_000),
  trackStock: true,
  isLow: false,
  isOut: false,
  updatedAt: '2026-09-25T10:00:00.000Z',
}

vi.mock('../../app/data', () => ({
  getRepositories: () => ({
    stock: {
      history: vi.fn(async () => ({
        items: [
          movement(),
          movement({
            id: 'm-2',
            type: 'SALE',
            direction: -1 as const,
            delta: milli(-3_000),
            quantity: milli(3_000),
            beforeQuantity: milli(17_000),
            afterQuantity: milli(14_000),
          }),
          movement({
            id: 'm-3',
            type: 'DAMAGE',
            direction: -1 as const,
            delta: milli(-2_000),
            quantity: milli(2_000),
            beforeQuantity: milli(14_000),
            afterQuantity: milli(12_000),
            note: 'bottle cracked',
          }),
        ],
        nextCursor: null,
      })),
      list: vi.fn(async () => ({ items: [stockRow], nextCursor: null })),
      listWarehouses: vi.fn(async () => []),
      summary: vi.fn(async () => ({
        stockValue: minor(2_550_000),
        variantsInStock: 1,
        lowStock: 0,
        outOfStock: 0,
        warehouses: 1,
        movementsToday: 3,
      })),
    },
  }),
}))

vi.mock('../../app/state/session', () => ({
  activeOrganization: () => ({ currency: 'BDT' }),
  can: () => true,
}))

vi.mock('../../app/state/stock-alerts', () => ({
  refreshStockAlerts: vi.fn(async () => undefined),
  stockAlertStore: {
    state: { lowStock: 0, outOfStock: 0, error: null, loaded: true },
    subscribe: () => () => undefined,
  },
  lowStockCount: () => 0,
}))

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  document.body.replaceChildren()
})

async function render(): Promise<HTMLElement> {
  const view = stockHistoryView({ variantId: 'v-1', onBack: () => undefined })
  document.body.appendChild(view)
  await vi.waitFor(() => {
    expect(view.textContent).toContain('Received')
  })
  return view
}

describe('stock history', () => {
  it('shows the movement in words a shopkeeper uses, not the enum', async () => {
    const view = await render()
    expect(view.textContent).toContain('Received')
    expect(view.textContent).toContain('Sold')
    // DAMAGE is a database word; "Damaged" is what happened.
    expect(view.textContent).toContain('Damaged')
    expect(view.textContent).not.toContain('ADJUSTMENT_OUT')
  })

  it('states the arithmetic for every movement: before → after', async () => {
    const view = await render()
    const text = view.textContent ?? ''
    expect(text).toContain('7 → 17')
    expect(text).toContain('17 → 14')
    expect(text).toContain('14 → 12')
  })

  it('shows the signed delta', async () => {
    const view = await render()
    const text = view.textContent ?? ''
    expect(text).toContain('+10')
    expect(text).toContain('−3')
  })

  it('shows the note when there is one', async () => {
    const view = await render()
    expect(view.textContent).toContain('bottle cracked')
  })

  it('shows the current balance in the header', async () => {
    const view = await render()
    await vi.waitFor(() => {
      expect(view.textContent).toContain('on hand')
    })
    expect(view.textContent).toContain('Basmati Rice 5kg')
  })
})
