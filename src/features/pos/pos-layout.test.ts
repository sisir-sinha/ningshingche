/**
 * The till's layout, and the controls on it.
 *
 * The cart panel shipped broken: the line was three content-sized columns in
 * one row, so at 360px the name was squeezed to a few pixels, "Only 0 in
 * stock" wrapped one word per line, the line total was clipped by the panel
 * edge, and the list grew a horizontal scrollbar. The quantity box was
 * full-width because `input({ class })` was accepted by the type and dropped
 * by the implementation.
 *
 * jsdom has no layout engine, so these tests pin the structural decisions that
 * caused it — the row grouping, the narrowing classes, the overflow rule — and
 * then re-check that every control on the panel still does its job.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { posView } from './pos-view'
import { salesFloorStore } from '../../app/state/sales-floor'
import type * as SalesFloorModule from '../../app/state/sales-floor'
import { EventBus } from '../../shared/bus'
import { PluginRegistry } from '../../shared/registry/plugin-registry'
import { milli, minor } from '../../shared/domain/money'
import type { SellableProduct } from '../../shared/repositories/contracts'

const FLOOR = {
  branchId: 'b-1',
  branchName: 'Main Store',
  warehouseId: 'w-1',
  warehouseName: 'Shop Floor',
  registerId: 'r-1',
  registerName: 'Counter 1',
  sessionId: null,
}

/** The product from the screenshot: priced ৳450.00, and nothing in stock. */
const KALA_JAM: SellableProduct = {
  productId: 'p-1',
  variantId: 'v-1',
  name: 'Kala Jam (copy)',
  variantName: null,
  sku: 'KJ-1',
  imageUrl: null,
  price: minor(45000),
  cost: 30000,
  taxRatePercent: 0,
  taxInclusive: true,
  trackStock: true,
  allowNegative: false,
  availableQty: milli(0),
  unitLabel: 'pc',
  decimalQuantity: false,
  categoryName: 'Sweets',
  metadata: {},
}

let held: unknown[] = []

vi.mock('../../app/data', () => ({
  getRepositories: () => ({
    catalog: {
      findByBarcode: async () => null,
      searchProducts: async () => ({ items: [KALA_JAM], total: 1, limit: 40, offset: 0 }),
    },
    sales: { held: async () => held },
    customers: { get: async () => null },
  }),
}))

vi.mock('../../app/state/session', () => ({
  activeOrganization: () => ({ organization_id: 'org-1', name: 'Sisir Enterprise', currency: 'BDT' }),
  can: () => true,
}))

vi.mock('../../app/state/sales-floor', async (importOriginal) => {
  const actual = await importOriginal<typeof SalesFloorModule>()
  return { ...actual, salesFloor: () => FLOOR, refreshSalesFloor: async () => undefined }
})

function emptyRegistry(): PluginRegistry {
  const bus = new EventBus()
  bus.onError = () => undefined
  return new PluginRegistry(bus, {
    settings: () => ({
      get: <T,>(_key: string, fallback: T): T => fallback,
      all: () => ({}),
      set: async () => undefined,
    }),
    data: () => ({
      get: async <T,>(_key: string, fallback: T): Promise<T> => fallback,
      set: async () => undefined,
      remove: async () => false,
      keys: async () => [],
    }),
    db: () => ({ products: async () => [], rpc: async <T,>(): Promise<T> => null as T }),
  })
}

async function build(): Promise<HTMLElement> {
  const bus = new EventBus()
  bus.onError = () => undefined
  salesFloorStore.set({ status: 'ready', floor: FLOOR })
  const view = posView({ bus, registry: emptyRegistry() })
  document.body.append(view)
  await settle()
  return view
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Taps the first product tile, the way a cashier does on a touch screen. */
async function addProduct(view: HTMLElement): Promise<void> {
  const tile = view.querySelector<HTMLButtonElement>('.grid button')
  tile?.click()
  await settle()
}

const cartLines = (view: HTMLElement): HTMLElement[] =>
  [...view.querySelectorAll<HTMLElement>('[data-line-id]')]

const qtyBox = (view: HTMLElement): HTMLInputElement =>
  view.querySelector<HTMLInputElement>('[data-line-id] input')!

const byLabel = (view: HTMLElement, label: string): HTMLButtonElement =>
  view.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

beforeEach(() => {
  held = []
  localStorage.clear()
  salesFloorStore.reset({ status: 'idle', floor: null, error: null, generation: 0 })
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('the cart line', () => {
  it('keeps the name and the money on one row, and the controls on another', async () => {
    const view = await build()
    await addProduct(view)

    const [line] = cartLines(view)
    expect(line).toBeDefined()

    // Row 1 holds the name and the line total; the name truncates rather than
    // squeezing the row. Row 2 holds the stepper.
    const name = line!.querySelector('p.truncate')
    expect(name?.textContent).toBe('Kala Jam (copy)')
    expect(line!.textContent).toContain('450.00')
    expect(line!.querySelector('input')).not.toBeNull()
  })

  it('gives the quantity box a narrow width — the class is no longer dropped', async () => {
    const view = await build()
    await addProduct(view)

    const box = qtyBox(view)
    expect(box.className).toContain('w-14')
    expect(box.className).toContain('text-center')
    // The regression: the UI kit's own `w-full h-11` used to win outright.
    expect(box.className).toContain('h-9')
  })

  it('states the stock shortfall as one sentence, not one word per line', async () => {
    const view = await build()
    await addProduct(view)

    const [line] = cartLines(view)
    const warning = [...line!.querySelectorAll('p')].find((p) =>
      (p.textContent ?? '').includes('in stock')
    )
    // One element carrying the whole sentence is what stops it stacking
    // vertically inside a squeezed column.
    expect(warning?.textContent).toBe('Only 0 in stock')
    expect(warning?.className).toContain('text-danger')
  })

  it('never lets the cart scroll sideways', async () => {
    const view = await build()
    await addProduct(view)

    const list = cartLines(view)[0]!.parentElement!
    expect(list.className).toContain('overflow-y-auto')
    expect(list.className).toContain('overflow-x-hidden')
  })

  it('labels the quantity box for a screen reader', async () => {
    const view = await build()
    await addProduct(view)
    expect(qtyBox(view).getAttribute('aria-label')).toBe('Quantity of Kala Jam (copy)')
  })
})

describe('the controls still work', () => {
  it('adds a product by tapping its tile', async () => {
    const view = await build()
    expect(cartLines(view)).toHaveLength(0)
    await addProduct(view)
    expect(cartLines(view)).toHaveLength(1)
    expect(qtyBox(view).value).toBe('1')
  })

  it('steps the quantity up and down', async () => {
    const view = await build()
    await addProduct(view)

    byLabel(view, 'Increase').click()
    await settle()
    expect(qtyBox(view).value).toBe('2')

    byLabel(view, 'Decrease').click()
    await settle()
    expect(qtyBox(view).value).toBe('1')
  })

  it('takes a typed quantity on Enter', async () => {
    const view = await build()
    await addProduct(view)

    const box = qtyBox(view)
    box.value = '7'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()

    expect(qtyBox(view).value).toBe('7')
    // 7 × ৳450.00 — the till multiplies, the server prices.
    expect(view.textContent).toContain('3,150.00')
  })

  it('refuses a quantity that is not a number, and keeps the old one', async () => {
    const view = await build()
    await addProduct(view)

    const box = qtyBox(view)
    box.value = 'abc'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()

    expect(qtyBox(view).value).toBe('1')
  })

  it('removes a line', async () => {
    const view = await build()
    await addProduct(view)

    byLabel(view, 'Remove line').click()
    await settle()

    expect(cartLines(view)).toHaveLength(0)
    expect(view.textContent).toContain('Scan or search to start a sale.')
  })

  it('counts the lines beside the panel title', async () => {
    const view = await build()
    await addProduct(view)
    expect(view.textContent).toContain('1 item')

    byLabel(view, 'Increase').click()
    await settle()
    // A second unit of the same product is still one line.
    expect(view.textContent).toContain('1 item')
  })

  it('enables Pay, Hold and Clear only once something is in the cart', async () => {
    const view = await build()
    const labelled = (text: string): HTMLButtonElement =>
      [...view.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text))!

    expect(labelled('Pay').disabled).toBe(true)
    expect(labelled('Hold').disabled).toBe(true)
    expect(labelled('Clear').disabled).toBe(true)

    await addProduct(view)

    expect(labelled('Pay').disabled).toBe(false)
    expect(labelled('Hold').disabled).toBe(false)
    expect(labelled('Clear').disabled).toBe(false)
  })
})

describe('the panel itself', () => {
  it('shows an empty state instead of a bare sentence', async () => {
    const view = await build()
    expect(view.textContent).toContain('Scan or search to start a sale.')
    expect(view.textContent).toContain('Enter adds the highlighted product')
  })

  it('hides the held-sales drawer when nothing is held', async () => {
    const view = await build()
    const toggle = [...view.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Held sales')
    )
    expect(toggle?.closest('div')?.className).toContain('hidden')
  })

  it('opens the held-sales drawer when there is something in it', async () => {
    held = [
      {
        id: 's-1',
        invoice_no: 'INV-0007',
        created_at: new Date().toISOString(),
        customer: { name: 'Rahim Uddin' },
      },
    ]
    const view = await build()
    await settle()

    const toggle = [...view.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Held sales')
    )!
    expect(toggle.closest('div')?.className).not.toContain('hidden')

    toggle.click()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(view.textContent).toContain('INV-0007')
    expect(view.textContent).toContain('Rahim Uddin')
  })

  it('stacks on a phone and becomes a rail on a desktop', async () => {
    const view = await build()
    const aside = view.querySelector('aside')!
    expect(aside.className).toContain('w-full')
    expect(aside.className).toContain('lg:w-[380px]')
    expect(view.className).toContain('flex-col')
    expect(view.className).toContain('lg:flex-row')
  })
})
