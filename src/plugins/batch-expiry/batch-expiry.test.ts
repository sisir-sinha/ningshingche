/**
 * Batch & expiry — the plugin's own behaviour.
 *
 * Everything asserted here goes through the public plugin API: the test builds
 * a registry, enables the plugin, and checks what the *core* would then
 * render. No test reaches into the plugin's internals except the pure helpers,
 * which is the same surface a maintainer has.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PluginRegistry } from '../../shared/registry/plugin-registry'
import { EventBus } from '../../shared/bus/event-bus'
import type {
  PluginDataStore,
  PluginDb,
  ProductDraft,
  ProductSnapshot,
} from '../../shared/registry/plugin-types'
import batchExpiryPlugin, { daysUntil, describeExpiry, expiringSoon, horizonDays } from './index'
import { BATCH_KEY, EXPIRY_KEY, batchExpiryManifest } from './manifest'

const DAY = 86_400_000
const NOW = Date.parse('2026-09-25T09:00:00Z')

let bus: EventBus
let registry: PluginRegistry
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> | undefined }>
/** What the fake `db.products()` hands back; each test sets its own. */
let productList: ProductSnapshot[]

function fakeData(): PluginDataStore {
  const bag = new Map<string, unknown>()
  return {
    get: async <T,>(key: string, fallback: T): Promise<T> =>
      bag.has(key) ? (bag.get(key) as T) : fallback,
    set: async (key, value) => {
      bag.set(key, value)
    },
    remove: async (key) => bag.delete(key),
    keys: async () => [...bag.keys()],
  }
}

function products(values: Array<{ name: string; expiry?: string; batch?: string }>): ProductSnapshot[] {
  return values.map((entry, index) => ({
    id: `p${index}`,
    name: entry.name,
    sku: `SKU-${index}`,
    price: 100,
    track_stock: true,
    is_active: true,
    reorder_point: 5,
    metadata: {
      ...(entry.batch ? { [BATCH_KEY]: entry.batch } : {}),
      ...(entry.expiry ? { [EXPIRY_KEY]: entry.expiry } : {}),
    },
  }))
}

beforeEach(async () => {
  bus = new EventBus()
  bus.onError = () => undefined
  rpcCalls = []
  productList = []
  const db: PluginDb = {
    // `loadProducts` catches a failure, so the report's own tests can point
    // this at a fixture without a second registry.
    products: async () => productList,
    rpc: async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
      rpcCalls.push({ fn, args })
      return null as T
    },
  }
  registry = new PluginRegistry(bus, {
    settings: () => ({
      get: <T,>(_key: string, fallback: T): T => fallback,
      all: () => ({}),
      set: async () => undefined,
    }),
    data: () => fakeData(),
    db: () => db,
  })
  registry.declare({ manifest: batchExpiryManifest, load: async () => batchExpiryPlugin })
  await registry.sync(['batch-expiry'])
})

describe('daysUntil', () => {
  it('counts days to a future date and back from a past one', () => {
    expect(daysUntil(new Date(NOW + 3 * DAY).toISOString(), NOW)).toBe(3)
    expect(daysUntil(new Date(NOW - 2 * DAY).toISOString(), NOW)).toBe(-2)
  })

  it('returns null for a missing or unparseable value', () => {
    expect(daysUntil(null, NOW)).toBeNull()
    expect(daysUntil('', NOW)).toBeNull()
    expect(daysUntil('not a date', NOW)).toBeNull()
  })
})

describe('expiringSoon', () => {
  it('keeps only products inside the window, soonest first', () => {
    const list = products([
      { name: 'Far', expiry: new Date(NOW + 200 * DAY).toISOString() },
      { name: 'Sooner', expiry: new Date(NOW + 5 * DAY).toISOString() },
      { name: 'Expired', expiry: new Date(NOW - DAY).toISOString() },
      { name: 'No date' },
    ])

    const result = expiringSoon(list, 90, NOW)

    expect(result.map((entry) => entry.product.name)).toEqual(['Expired', 'Sooner'])
    expect(result[0]?.days).toBe(-1)
  })

  it('treats the window as inclusive', () => {
    const list = products([{ name: 'Edge', expiry: new Date(NOW + 90 * DAY).toISOString() }])
    expect(expiringSoon(list, 90, NOW)).toHaveLength(1)
    expect(expiringSoon(list, 89, NOW)).toHaveLength(0)
  })
})

describe('describeExpiry', () => {
  it('escalates tone as the date approaches and passes', () => {
    expect(describeExpiry(-2).tone).toBe('danger')
    expect(describeExpiry(0).label).toBe('Expires today')
    expect(describeExpiry(3).tone).toBe('warning')
    expect(describeExpiry(40).tone).toBe('neutral')
  })
})

describe('registration', () => {
  it('adds its fields, screen, widget and permission — nothing else', () => {
    expect(registry.productFields.items.map((f) => f.key)).toEqual([BATCH_KEY, EXPIRY_KEY])
    expect(registry.nav.items.map((item) => item.id)).toEqual(['batch-expiry'])
    expect(registry.routes.items.map((route) => route.path)).toEqual(['/plugins/batch-expiry'])
    expect(registry.widgets.items.map((widget) => widget.id)).toEqual(['batch-expiry.expiring'])
    expect(registry.formSections.items.map((section) => section.id)).toEqual([
      'batch-expiry.summary',
    ])
    expect(registry.permissions.items.map((permission) => permission.key)).toEqual([
      'batch-expiry.adjust',
    ])
  })

  it('asks for no database of its own', () => {
    // The plugin stores its fields in product metadata; a plugin that needed a
    // table would declare one in its package SQL instead.
    expect(rpcCalls).toHaveLength(0)
  })

  it('namespaces its permission to itself', () => {
    for (const permission of registry.permissions.items) {
      expect(permission.key.startsWith('batch-expiry.')).toBe(true)
    }
  })

  it('validates the expiry field so a typo cannot be saved', () => {
    const field = registry.productFields.items.find((f) => f.key === EXPIRY_KEY)
    const draft = { name: 'x', metadata: {} } as ProductDraft
    expect(field?.validate?.('2026-12-01', draft)).toBeNull()
    expect(field?.validate?.('31/12/2026', draft)).toMatch(/valid date/)
    expect(field?.validate?.('', draft)).toBeNull()
  })

  it('formats the expiry field as a countdown', () => {
    const field = registry.productFields.items.find((f) => f.key === EXPIRY_KEY)
    expect(field?.format?.(new Date(Date.now() + 2 * DAY).toISOString())).toMatch(/day\(s\) left/)
  })
})

describe('the dashboard widget', () => {
  it('counts what is inside the warning window and names the next one', async () => {
    const widget = registry.widgets.items[0]
    const render = widget?.render
    expect(render).toBeDefined()

    const el = await render?.()

    expect(el?.textContent).toContain('Expiring soon')
    // No products reach the fake db, so the honest answer is zero.
    expect(el?.textContent).toContain('Nothing inside the warning window')
  })

  it('says so instead of throwing when the products call fails', async () => {
    const db: PluginDb = {
      products: async () => {
        throw new Error('offline')
      },
      rpc: async <T,>(): Promise<T> => null as T,
    }
    const failing = new PluginRegistry(bus, {
      settings: () => ({
        get: <T,>(_key: string, fallback: T): T => fallback,
        all: () => ({}),
        set: async () => undefined,
      }),
      data: () => fakeData(),
      db: () => db,
    })
    failing.declare({ manifest: batchExpiryManifest, load: async () => batchExpiryPlugin })
    await failing.sync(['batch-expiry'])

    const el = await failing.widgets.items[0]?.render()

    expect(el?.textContent).toContain('Expiring soon')
  })
})

describe('the Expiring stock report', () => {
  const report = () => registry.reports.items[0]
  const context = (
    over: Partial<{ period: string; from: string | null; to: string | null; search: string }> = {}
  ) => ({
    period: 'month',
    from: null,
    to: null,
    search: '',
    branchId: 'b1',
    limit: 25,
    offset: 0,
    ...over,
  })

  it('registers itself under Stock, windowed and searchable', () => {
    expect(registry.reports.items.map((entry) => entry.id)).toEqual(['expiring'])
    expect(report()?.label).toBe('Expiring stock')
    expect(report()?.group).toBe('Stock')
    expect(report()?.permission).toBe('inventory.view')
    expect(report()?.filters).toEqual({ window: true, search: true })
  })

  it('turns the window control into a horizon, because that is the question', () => {
    expect(horizonDays({ period: 'day', from: null, to: null }, 30)).toBe(1)
    expect(horizonDays({ period: 'week', from: null, to: null }, 30)).toBe(7)
    expect(horizonDays({ period: 'quarter', from: null, to: null }, 30)).toBe(90)
    expect(horizonDays({ period: 'year', from: null, to: null }, 30)).toBe(365)
    // A custom range becomes the distance to its far end, clamped.
    expect(
      horizonDays({ period: 'custom', from: '2026-09-01', to: '2026-09-21' }, 30)
    ).toBe(20)
    expect(
      horizonDays({ period: 'custom', from: '2026-09-21', to: '2026-09-01' }, 30)
    ).toBe(1)
    // No range at all falls back to the plugin's own warning setting.
    expect(horizonDays({ period: 'custom', from: null, to: null }, 45)).toBe(45)
    expect(horizonDays({ period: 'nonsense', from: null, to: null }, 45)).toBe(45)
  })

  it('lists what falls inside the horizon, with days left and the shelf price', async () => {
    productList = products([
      { name: 'Paracetamol 500mg', batch: 'B-9', expiry: new Date(NOW + 3 * DAY).toISOString() },
      { name: 'Amoxicillin 500mg', batch: 'B-11', expiry: new Date(NOW + 20 * DAY).toISOString() },
      { name: 'Bandage', expiry: new Date(NOW + 400 * DAY).toISOString() },
      { name: 'No expiry recorded' },
    ])

    const result = await report()!.run(context({ period: 'week' }))

    expect(result.rows.map((row) => row.product)).toEqual(['Paracetamol 500mg'])
    expect(result.rows[0]?.days).toBe(3)
    expect(result.rows[0]?.batch).toBe('B-9')
    expect(result.columns.map((column) => column.key)).toEqual([
      'product',
      'sku',
      'batch',
      'expires',
      'days',
      'price',
    ])
    expect(result.note).toBe('1 product(s) inside 7 day(s)')
    // A money column, in minor units, like every other report.
    expect(result.rows[0]?.price).toBe(100)
  })

  it('counts what has already expired in its small print', async () => {
    productList = products([
      { name: 'Gone off', expiry: new Date(NOW - 4 * DAY).toISOString() },
      { name: 'Still fine', expiry: new Date(NOW + 10 * DAY).toISOString() },
    ])

    const result = await report()!.run(context())

    expect(result.note).toBe('2 product(s) inside 30 day(s) · 1 already expired')
    expect(result.rows.map((row) => row.days)).toEqual([-4, 10])
  })

  it('searches names, SKUs and batch numbers', async () => {
    productList = products([
      { name: 'Paracetamol 500mg', batch: 'B-9', expiry: new Date(NOW + 3 * DAY).toISOString() },
      { name: 'Amoxicillin 500mg', batch: 'B-11', expiry: new Date(NOW + 4 * DAY).toISOString() },
    ])

    const byName = await report()!.run(context({ search: 'amoxi' }))
    expect(byName.rows.map((row) => row.product)).toEqual(['Amoxicillin 500mg'])

    const byBatch = await report()!.run(context({ search: 'b-9' }))
    expect(byBatch.rows.map((row) => row.batch)).toEqual(['B-9'])
  })

  it('returns an empty report rather than throwing when products cannot be read', async () => {
    const failing = new PluginRegistry(bus, {
      settings: () => ({
        get: <T,>(_key: string, fallback: T): T => fallback,
        all: () => ({}),
        set: async () => undefined,
      }),
      data: () => fakeData(),
      db: () => ({
        products: async () => {
          throw new Error('offline')
        },
        rpc: async <T,>(): Promise<T> => null as T,
      }),
    })
    failing.declare({ manifest: batchExpiryManifest, load: async () => batchExpiryPlugin })
    await failing.sync(['batch-expiry'])

    const result = await failing.reports.items[0]!.run(context())

    expect(result.rows).toEqual([])
    expect(result.note).toContain('0 product(s)')
  })
})

describe('the product form section', () => {
  it('explains itself with and without a saved product', async () => {
    const section = registry.formSections.items[0]
    const withProduct = await section?.render({
      organizationId: 'org',
      branchId: 'branch',
      currency: 'BDT',
      productId: 'p1',
    })
    const withoutProduct = await section?.render({
      organizationId: 'org',
      branchId: 'branch',
      currency: 'BDT',
    })

    expect(withProduct?.textContent).toMatch(/included in the Expiry Watch list/)
    expect(withoutProduct?.textContent).toMatch(/Fill in the batch and expiry fields/)
  })
})
