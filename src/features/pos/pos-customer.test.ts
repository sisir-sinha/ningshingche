/**
 * Attaching a customer at the till (spec §19).
 *
 * The cart has had a `customerId` since the first commit, `complete_sale` has
 * taken `p_customer_id` since migration 012, and the receipt has printed
 * `Walk-in` for every sale this shop ever took — because no screen set it. A
 * loyalty plugin could not exist until that changed: points belong to a person,
 * and a redemption belonging to nobody cannot be reversed.
 *
 * These tests pin the whole path — the till's own control, the search, adding a
 * customer the shop does not have yet, and the id reaching `complete_sale` —
 * plus the cross-seam rule that matters most: an adjustment quoted for *this*
 * customer is withdrawn the moment the customer goes.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { posView } from './pos-view'
import { splitQuery, describe as describeCustomer } from './customer-dialog'
import { salesFloorStore } from '../../app/state/sales-floor'
import type * as SalesFloorModule from '../../app/state/sales-floor'
import { EventBus } from '../../shared/bus'
import { PluginRegistry } from '../../shared/registry/plugin-registry'
import { milli, minor } from '../../shared/domain/money'
import type { Plugin, SaleAdjustmentContext } from '../../shared/registry/plugin-types'
import type { SellableProduct } from '../../shared/repositories/contracts'
import type { CustomerRow } from '../../shared/types/records'

const FLOOR = {
  branchId: 'b-1',
  branchName: 'Main Store',
  warehouseId: 'w-1',
  warehouseName: 'Shop Floor',
  registerId: 'r-1',
  registerName: 'Counter 1',
  sessionId: null,
}

const RICE: SellableProduct = {
  productId: 'p-rice',
  variantId: 'v-rice',
  name: 'Miniket rice',
  variantName: null,
  sku: '1234561',
  imageUrl: null,
  price: minor(20000),
  cost: 15000,
  taxRatePercent: 0,
  taxInclusive: true,
  trackStock: true,
  allowNegative: false,
  availableQty: milli(500_000),
  unitLabel: 'kg',
  decimalQuantity: false,
  categoryName: 'Rice & Grains',
  metadata: {},
}

function customer(id: string, name: string, phone: string | null = null): CustomerRow {
  return {
    id,
    name,
    phone,
    email: null,
    address: null,
    credit_limit: '0.00',
    balance: '0.00',
    store_credit: '0.00',
    note: null,
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

const RAHIMA = customer('c-1', 'Rahima Begum', '01712345678')
const KARIM = customer('c-2', 'Karim Mia', '01898765432')

let directory: CustomerRow[] = []
let searched: string[] = []
let created: Array<{ name: string; phone?: string | null }> = []
let completed: Array<Record<string, unknown>> = []
let permissions: string[] = [
  'customers.view',
  'customers.create',
  'sales.create',
  'loyalty.redeem',
]
let quoteRequiresCustomer = true
let released: string[] = []
let quotedFor: Array<string | null> = []

vi.mock('../../app/data', () => ({
  getRepositories: () => ({
    catalog: {
      findByBarcode: async (code: string) => (code.trim() === RICE.sku ? RICE : null),
      searchProducts: async () => ({ items: [], total: 0, limit: 40, offset: 0 }),
      listPaymentMethods: async () => [
        { id: 'pm-1', key: 'cash', name: 'Cash', isActive: true, requiresReference: false },
      ],
    },
    customers: {
      list: async (query: { search?: string }) => {
        searched.push(query.search ?? '')
        const term = (query.search ?? '').trim().toLowerCase()
        const items = directory.filter(
          (row) =>
            term === '' ||
            row.name.toLowerCase().includes(term) ||
            (row.phone ?? '').includes(term)
        )
        return { items, total: items.length, limit: 20 }
      },
      get: async (id: string) => directory.find((row) => row.id === id) ?? null,
      create: async (draft: { name: string; phone?: string | null }) => {
        created.push(draft)
        const row = customer(`c-${directory.length + 1}`, draft.name, draft.phone ?? null)
        directory = [...directory, row]
        return row
      },
    },
    sales: {
      complete: async (input: Record<string, unknown>) => {
        completed.push(input)
        return {
          sale_id: 'sale-1',
          invoice_no: 'INV-2026-000001',
          status: 'COMPLETED',
          subtotal: '200.00',
          discount: '0.00',
          tax: '0.00',
          total: '200.00',
          paid: '200.00',
          change_due: '0.00',
          queued: false,
        }
      },
      get: async () => null,
    },
  }),
}))

vi.mock('../../app/state/session', () => ({
  activeOrganization: () => ({
    organization_id: 'org-1',
    name: 'Mekholi Store',
    currency: 'BDT',
  }),
  can: (permission?: string) => permission === undefined || permissions.includes(permission),
}))

vi.mock('../../app/state/sales-floor', async (importOriginal) => {
  const actual = await importOriginal<typeof SalesFloorModule>()
  return { ...actual, salesFloor: () => FLOOR, refreshSalesFloor: async () => undefined }
})

/** A plugin whose offer exists only while a customer is on the sale. */
function loyaltyPlugin(): Plugin {
  return {
    id: 'loyalty',
    name: 'Loyalty',
    version: '1.0.0',
    register: (api) => {
      api.registerSaleAdjustment({
        id: 'loyalty.redeem',
        label: 'Loyalty',
        permission: 'loyalty.redeem',
        quote: (context: SaleAdjustmentContext) => {
          quotedFor.push(context.customerId)
          if (!quoteRequiresCustomer || !context.customerId) return null
          return { amountMinor: 5000, label: 'Redeem 500 points', token: `rd-${context.customerId}` }
        },
        onReleased: (quote, reason) => {
          released.push(`${quote.token}:${reason}`)
        },
      })
    },
  }
}

async function build(plugins: Plugin[] = [loyaltyPlugin()]): Promise<HTMLElement> {
  const bus = new EventBus()
  bus.onError = () => undefined
  const registry = new PluginRegistry(bus, {
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
  for (const plugin of plugins) {
    registry.declare({
      manifest: {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        coreApiVersion: '^1.0.0',
        description: '',
        category: 'optional',
      },
      load: async () => plugin,
    })
  }
  await registry.sync(plugins.map((plugin) => plugin.id))

  salesFloorStore.set({ status: 'ready', floor: FLOOR })
  const view = posView({ bus, registry })
  document.body.append(view)
  return view
}

async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function scan(view: HTMLElement, code = '1234561'): Promise<void> {
  const field = view.querySelector<HTMLInputElement>('input')!
  field.value = code
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 250))
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
}

const textOf = (node: Element): string => node.textContent ?? ''

function buttonNamed(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((candidate) =>
    (candidate.textContent ?? '').includes(text)
  )
  if (!found) throw new Error(`no button containing "${text}"`)
  return found
}

function hasButton(root: ParentNode, text: string): boolean {
  return [...root.querySelectorAll('button')].some((candidate) =>
    (candidate.textContent ?? '').includes(text)
  )
}

function customerButton(view: HTMLElement): HTMLButtonElement {
  const found = view.querySelector<HTMLButtonElement>('button[aria-label="Customer on this sale"]')
  // It is the only way to attach a customer, and it spans the cart panel, so
  // it is a thumb target on a phone: `md` (40px), never `sm` (32px). The
  // phone audit fails any control under 40px.
  expect(found?.classList.contains('h-10')).toBe(true)
  expect(found?.classList.contains('h-8')).toBe(false)
  if (!found) throw new Error('the till has no customer control')
  return found
}

/** Opens the attach dialog and types into its search field. */
async function openDialog(view: HTMLElement, term?: string): Promise<HTMLElement> {
  customerButton(view).click()
  await settle()
  const dialog = document.querySelector<HTMLElement>('[aria-modal="true"]')
  if (!dialog) throw new Error('the dialog did not open')
  if (term !== undefined) {
    const field = dialog.querySelector<HTMLInputElement>('input[type="search"]')!
    field.value = term
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 250))
    await settle()
  }
  return dialog
}

beforeEach(() => {
  directory = [RAHIMA, KARIM]
  searched = []
  created = []
  completed = []
  released = []
  quotedFor = []
  permissions = ['customers.view', 'customers.create', 'sales.create', 'loyalty.redeem']
  quoteRequiresCustomer = true
  localStorage.clear()
  salesFloorStore.reset({ status: 'idle', floor: null, error: null, generation: 0 })
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('the customer on the sale', () => {
  it('says walk-in until somebody is attached', async () => {
    const view = await build()

    expect(textOf(view)).toContain('Walk-in')
    expect(textOf(view)).toContain('optional')
  })

  it('searches the shop’s customers and attaches the one picked', async () => {
    const view = await build()
    const dialog = await openDialog(view, 'rahi')

    expect(searched).toContain('rahi')
    expect(textOf(dialog)).toContain('Rahima Begum')
    expect(textOf(dialog)).toContain('01712345678')
    // Karim does not match, and is not offered.
    expect(textOf(dialog)).not.toContain('Karim Mia')

    buttonNamed(dialog, 'Rahima Begum').click()
    await settle()

    expect(textOf(view)).toContain('Rahima Begum')
    expect(document.querySelector('[aria-modal="true"]')).toBeNull()
  })

  it('puts the customer on the sale the server stores', async () => {
    const view = await build()
    await scan(view)
    const dialog = await openDialog(view, '01712345678')
    buttonNamed(dialog, 'Rahima Begum').click()
    await settle()

    buttonNamed(view, 'Pay').click()
    await settle()
    const payDialog = document.querySelector<HTMLElement>('[aria-modal="true"]') ?? document.body
    payDialog
      .querySelector<HTMLInputElement>('input[inputmode="decimal"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle(12)

    // The id — not the name — is what `complete_sale` stores, and it is the
    // whole reason a loyalty plugin can be about this customer at all.
    expect(completed).toHaveLength(1)
    expect(completed[0]?.customerId).toBe('c-1')
  })

  it('adds a customer the shop does not have yet, from what was typed', async () => {
    const view = await build()
    const dialog = await openDialog(view, 'Nasrin Akter')

    expect(textOf(dialog)).toContain('Nobody matches yet')
    buttonNamed(dialog, 'Add “Nasrin Akter”').click()
    await settle()

    expect(created).toEqual([{ name: 'Nasrin Akter', phone: null }])
    expect(textOf(view)).toContain('Nasrin Akter')
  })

  it('reads a phone number as a phone number, not a name', async () => {
    // §19 is name and phone; the shop should not have to say which it typed.
    expect(splitQuery('Nasrin Akter')).toEqual({ name: 'Nasrin Akter', phone: null })
    expect(splitQuery('01712 345678')).toEqual({ name: '01712 345678', phone: '01712 345678' })
    expect(splitQuery('+8801712345678')).toEqual({
      name: '+8801712345678',
      phone: '+8801712345678',
    })
    // Six digits is a phone; five is a price list, a table number, or a typo.
    expect(splitQuery('12345').phone).toBeNull()

    const view = await build()
    const dialog = await openDialog(view, '01911122233')
    buttonNamed(dialog, 'Add “01911122233”').click()
    await settle()
    expect(created).toEqual([{ name: '01911122233', phone: '01911122233' }])
  })

  it('takes a customer off again, and the plugin’s offer with them', async () => {
    const view = await build()
    await scan(view)
    const dialog = await openDialog(view, 'Rahima')
    buttonNamed(dialog, 'Rahima Begum').click()
    await settle()

    // The plugin's offer is quoted for this customer, and only now: a walk-in
    // has no balance, so the seam is asked and answers nothing.
    expect(quotedFor).toContain(null)
    expect(quotedFor.at(-1)).toBe('c-1')
    expect(textOf(view)).toContain('Redeem 500 points')
    buttonNamed(view, 'Apply').click()
    await settle()
    expect(textOf(view)).toContain('150.00')

    // …and the cashier makes it a walk-in again. The redemption belonged to
    // Rahima, so it goes back to her rather than staying on a sale that is no
    // longer hers.
    const again = await openDialog(view, '')
    buttonNamed(again, 'Make it a walk-in').click()
    await settle()

    expect(released).toEqual(['rd-c-1:invalid'])
    expect(textOf(view)).toContain('Walk-in')
    expect(textOf(view)).not.toContain('Discount')
    expect(textOf(view)).toContain('200.00')
  })

  it('offers nothing to a cashier who may not look customers up', async () => {
    permissions = ['sales.create']
    const view = await build()

    expect(view.querySelector('button[aria-label="Customer on this sale"]')).toBeNull()
    expect(textOf(view)).not.toContain('optional')
    // And the plugin is quoted with no customer: the seam never sees one.
    expect(quotedFor.every((id) => id === null)).toBe(true)
  })

  it('does not offer “add” to a cashier who may only view', async () => {
    permissions = ['customers.view', 'sales.create']
    const view = await build()

    // Looking up is what makes the loyalty panel worth anything, and it still
    // works…
    const found = await openDialog(view, 'Rahima')
    expect(textOf(found)).toContain('Rahima Begum')
    buttonNamed(found, 'Rahima Begum').click()
    await settle()
    expect(textOf(view)).toContain('Rahima Begum')

    // …but a customer the shop does not have cannot be created by someone who
    // may only look.
    const missing = await openDialog(view, 'Nasrin Akter')
    expect(hasButton(missing, 'Add “Nasrin Akter”')).toBe(false)
    expect(created).toEqual([])
  })

  it('describes a customer by what tells two of them apart', () => {
    expect(describeCustomer(RAHIMA, 'BDT')).toBe('01712345678')
    expect(describeCustomer(customer('c-9', 'Nobody'), 'BDT')).toBe('No phone number')
    expect(describeCustomer(customer('c-9', 'Credit holder'), 'BDT')).toBe('No phone number')
    expect(
      describeCustomer({ ...customer('c-3', 'Anon', '017'), store_credit: '250.00' }, 'BDT')
    ).toContain('in credit')
  })
})
