/**
 * The plugin slots the core draws (spec §31, §32, §51).
 *
 * These tests are about the contract between a feature and a plugin: a feature
 * asks for "the values to show here", and the answers depend on what a plugin
 * declared — `showInPOS` on the tile, `printable` on the receipt. Getting this
 * wrong is invisible in a shop with no plugins installed, which is exactly why
 * it is pinned.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PluginRegistry } from '../shared/registry/plugin-registry'
import { EventBus } from '../shared/bus'
import {
  isPluginReportKey,
  panelLines,
  pluginReportKey,
  pluginReports,
  posFieldValues,
  printableNotes,
  runPluginReport,
} from './plugin-slots'
import { EMPTY_SESSION, sessionStore } from './state/session'
import { milli, minor } from '../shared/domain/money'
import type { CartLine } from '../shared/domain/cart'
import type { Plugin, PanelLine } from '../shared/registry/plugin-types'

function registryWith(plugin: Plugin): PluginRegistry {
  const bus = new EventBus()
  bus.onError = () => undefined
  const registry = new PluginRegistry(bus, {
    settings: () => ({ get: <T,>(_k: string, fallback: T): T => fallback, all: () => ({}), set: async () => undefined }),
    data: () => ({
      get: async <T,>(_k: string, fallback: T): Promise<T> => fallback,
      set: async () => undefined,
      remove: async () => false,
      keys: async () => [],
    }),
    db: () => ({ products: async () => [], rpc: async <T,>(): Promise<T> => null as T }),
  })
  registry.declare({
    manifest: {
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      coreApiVersion: '^1.0.0',
      description: 'A plugin with fields on the till and the slip.',
      category: 'optional',
    },
    load: async () => plugin,
  })
  return registry
}

const plugin: Plugin = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  register: (api) => {
    api.registerProductField({
      key: 'demo.batch',
      label: 'Batch number',
      type: 'text',
      storage: 'metadata',
      showInPOS: true,
      printable: true,
    })
    api.registerProductField({
      key: 'demo.notes',
      label: 'Internal notes',
      type: 'text',
      storage: 'metadata',
    })
    api.registerProductField({
      key: 'demo.expiry',
      label: 'Expiry',
      type: 'date',
      storage: 'metadata',
      showInPOS: true,
      printable: true,
      format: (value) => `in ${String(value)} days`,
    })
  },
}

let registry: PluginRegistry

beforeEach(async () => {
  registry = registryWith(plugin)
  await registry.sync(['demo'])
  // Most slots here are not permission-gated; the report tests set their own.
  sessionStore.reset({ ...EMPTY_SESSION, permissions: ['*'] })
})

afterEach(() => {
  sessionStore.reset(EMPTY_SESSION)
})

describe('POS tile values', () => {
  it('shows only the fields the plugin asked to show there', () => {
    const values = posFieldValues(registry, {
      'demo.batch': 'BT-14',
      'demo.notes': 'never shown at the till',
      'demo.expiry': 30,
    })

    expect(values.map((entry) => entry.key)).toEqual(['demo.batch', 'demo.expiry'])
  })

  it('uses the plugin’s own formatter, so the till reads like the shop writes', () => {
    const values = posFieldValues(registry, { 'demo.expiry': 30 })
    expect(values[0]?.text).toBe('in 30 days')
  })

  it('skips a field the product has no value for', () => {
    expect(posFieldValues(registry, {})).toEqual([])
    expect(posFieldValues(registry, { 'demo.batch': null })).toEqual([])
  })
})

describe('receipt notes', () => {
  it('collects the printable values per variant, labelled', () => {
    const notes = printableNotes(registry, [
      { variantId: 'v1', metadata: { 'demo.batch': 'BT-14', 'demo.expiry': 12, 'demo.notes': 'ignored' } },
      { variantId: 'v2', metadata: {} },
    ])

    expect(notes.get('v1')).toEqual(['Batch number: BT-14', 'Expiry: in 12 days'])
    expect(notes.has('v2')).toBe(false)
  })

  it('prints nothing at all when no plugin asks to', async () => {
    const bare = registryWith({ ...plugin, register: () => undefined })
    await bare.sync(['demo'])

    const notes = printableNotes(bare, [{ variantId: 'v1', metadata: { anything: 'x' } }])
    expect([...notes.keys()]).toEqual([])
  })

  it('stops printing a field the moment its plugin is switched off', async () => {
    await registry.sync([])
    const notes = printableNotes(registry, [{ variantId: 'v1', metadata: { 'demo.batch': 'BT-14' } }])
    expect([...notes.keys()]).toEqual([])
  })
})

// ── The cart a plugin is shown ────────────────────────────────────────────
//
// A POS panel that decorates the sale in front of the cashier has to know what
// is on it. The projection is the contract: what a plugin sees, and — just as
// importantly — what it does not.

function cartLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    lineId: 'line-1',
    variantId: 'v1',
    productId: 'p1',
    name: 'Soap',
    variantName: null,
    sku: 'SOAP-1',
    unitLabel: null,
    unitPrice: minor(12000),
    unitCost: 800000,
    taxRatePercent: 0,
    taxInclusive: false,
    trackStock: true,
    allowNegative: false,
    availableQty: milli(5000),
    decimalQuantity: false,
    quantity: milli(2000),
    discountType: null,
    discountValue: 0,
    ...overrides,
  }
}

describe('the cart a plugin is shown', () => {
  it('gives a plugin plain numbers, and the product’s own metadata', () => {
    const lines = panelLines([cartLine()], () => ({
      metadata: { serial_tracked: true, batch_number: 'BT-14' },
    }))

    expect(lines).toEqual<PanelLine[]>([
      {
        variantId: 'v1',
        productId: 'p1',
        name: 'Soap',
        variantName: null,
        sku: 'SOAP-1',
        quantity: 2,
        unitPrice: 120,
        metadata: { serial_tracked: true, batch_number: 'BT-14' },
      },
    ])
  })

  it('keeps a weighed line honest: 1.25 kg arrives as 1.25', () => {
    const lines = panelLines([cartLine({ quantity: milli(1250) })], () => ({ metadata: {} }))
    expect(lines[0]?.quantity).toBe(1.25)
  })

  it('falls back to no metadata for a variant the till has not seen', () => {
    // A plugin reads `metadata.serial_tracked`; an empty object means "not
    // tracked", and a plugin must never read it as "tracked by default".
    const lines = panelLines([cartLine()], () => undefined)
    expect(lines[0]?.metadata).toEqual({})
  })

  it('hands over nothing a plugin could write back', () => {
    const [line] = panelLines([cartLine()], () => ({ metadata: {} }))
    expect(Object.keys(line ?? {}).sort()).toEqual([
      'metadata',
      'name',
      'productId',
      'quantity',
      'sku',
      'unitPrice',
      'variantId',
      'variantName',
    ])
  })
})

// ── Reports ───────────────────────────────────────────────────────────────
//
// The seam that makes a plugin's report visible in the core reports screen.
// These tests are about what the *host* owes the plugin: a key that cannot
// collide, permission filtering, and a finished `ReportResult` the table and
// the exporters can both read.

const reportPlugin: Plugin = {
  id: 'demo',
  name: 'Demo Kit',
  version: '1.0.0',
  register: (api) => {
    api.registerReport({
      id: 'expiring',
      label: 'Expiring stock',
      icon: 'event_busy',
      permission: 'inventory.view',
      description: 'What is about to go off.',
      filters: { window: true, search: true },
      run: (context) => ({
        columns: [
          { key: 'product', label: 'Product', type: 'text' },
          { key: 'days', label: 'Days left', type: 'int', align: 'right' },
          { key: 'tags', label: 'Tags', type: 'text' },
        ],
        rows: [
          { product: 'Paracetamol', days: 3, secret: 'not a column' },
          // Deliberately illegal: a plugin returning something that is not a
          // cell is contained, not rendered as `[object Object]`.
          { product: 'Amoxicillin', days: -2, tags: ['rx', 'cold'] as unknown as string },
          { product: 'Ibuprofen', days: 9, tags: 42 },
        ],
        totals: { days: 10, secret: 99, product: Number.NaN, tags: Number.POSITIVE_INFINITY },
        note: 'inside 30 day(s)',
        ...(context.period === 'year' ? { currency: 'USD' } : {}),
      }),
    })
    api.registerReport({
      id: 'aging',
      label: 'Serial aging',
      icon: 'hourglass_bottom',
      filters: { window: false },
      run: () => ({ columns: [{ key: 'bucket', label: 'Bucket', type: 'text' }], rows: [] }),
    })
    api.registerReport({
      id: 'secret',
      label: 'Salary review',
      icon: 'lock',
      permission: 'payroll.view',
      run: () => ({ columns: [], rows: [] }),
    })
  },
}

async function hostWithReports(): Promise<PluginRegistry> {
  const other = registryWith(reportPlugin)
  await other.sync(['demo'])
  return other
}

const context = {
  period: 'month',
  from: null,
  to: null,
  search: '',
  branchId: 'b1',
  limit: 25,
  offset: 0,
}

describe('the reports a plugin contributes', () => {
  it('gives each one a key that cannot collide with a server report', async () => {
    const host = await hostWithReports()
    expect(pluginReports(host).map((report) => report.key)).toEqual([
      'plugin.demo.expiring',
      'plugin.demo.aging',
      'plugin.demo.secret',
    ])
    expect(pluginReportKey('demo', 'expiring')).toBe('plugin.demo.expiring')
    expect(isPluginReportKey('plugin.demo.expiring')).toBe(true)
    expect(isPluginReportKey('sales')).toBe(false)
  })

  it('groups by the plugin’s name unless the report asked for a group', async () => {
    const host = await hostWithReports()
    const [expiring, aging] = pluginReports(host)
    expect(expiring?.group).toBe('Demo')
    expect(aging?.label).toBe('Serial aging')
  })

  it('defaults to windowed and not searchable', async () => {
    const host = await hostWithReports()
    const aging = pluginReports(host).find((report) => report.id === 'aging')
    expect(aging?.filters).toEqual({ window: false, search: false })
  })

  it('hides a report whose permission the user lacks', async () => {
    const host = await hostWithReports()
    sessionStore.reset({ ...EMPTY_SESSION, permissions: ['inventory.view'] })
    expect(pluginReports(host).map((report) => report.id)).toEqual(['expiring', 'aging'])

    sessionStore.reset({ ...EMPTY_SESSION, permissions: ['*'] })
    expect(pluginReports(host).map((report) => report.id)).toContain('secret')
  })
})

describe('running one', () => {
  async function expiring() {
    const host = await hostWithReports()
    const report = pluginReports(host).find((entry) => entry.id === 'expiring')
    return { host, report: report! }
  }

  it('fills in what the host owns and leaves the plugin’s own facts alone', async () => {
    const { report } = await expiring()
    const result = await runPluginReport(report, context, {
      currency: 'BDT',
      periodLabel: 'This month',
    })

    expect(result.key).toBe('plugin.demo.expiring')
    expect(result.title).toBe('Expiring stock')
    expect(result.description).toBe('What is about to go off.')
    expect(result.currency).toBe('BDT')
    expect(result.period).toBe('month')
    expect(result.limit).toBe(25)
    expect(result.offset).toBe(0)
    expect(result.label).toBe('This month · inside 30 day(s)')
    expect(result.totalRows).toBe(3)
    // A plugin report is not sorted by the host: its rows may not even be in
    // this browser, so the headers are labels rather than buttons.
    expect(result.sort).toBe('')
  })

  it('keeps the plugin’s currency when it names one', async () => {
    const { report } = await expiring()
    const result = await runPluginReport(report, { ...context, period: 'year' }, { currency: 'BDT' })
    expect(result.currency).toBe('USD')
  })

  it('clips the rows to the page the host asked for', async () => {
    const { report } = await expiring()
    const result = await runPluginReport(report, { ...context, limit: 2 }, { currency: 'BDT' })
    expect(result.rows).toHaveLength(2)
    expect(result.totalRows).toBe(3)
    expect(result.limit).toBe(2)
  })

  it('drops a cell no column claims, and makes text of what is not scalar', async () => {
    const { report } = await expiring()
    const result = await runPluginReport(report, context, { currency: 'BDT' })

    // A stray key would otherwise reach the CSV…
    expect(result.rows[0]).toEqual({ product: 'Paracetamol', days: 3 })
    // …and an array cell becomes readable text rather than nothing at all.
    expect(result.rows[1]).toEqual({ product: 'Amoxicillin', days: -2, tags: 'rx,cold' })
    expect(result.rows[2]).toEqual({ product: 'Ibuprofen', days: 9, tags: 42 })
  })

  it('keeps only finite totals, and only for columns that exist', async () => {
    const { report } = await expiring()
    const result = await runPluginReport(report, context, { currency: 'BDT' })
    expect(result.totals).toEqual({ days: 10 })
  })

  it('claims no window for a report that declared it has none', async () => {
    const host = await hostWithReports()
    const aging = pluginReports(host).find((entry) => entry.id === 'aging')!
    const result = await runPluginReport(aging, context, {
      currency: 'BDT',
      periodLabel: 'This month',
    })
    expect(result.label).toBe('All rows')
    expect(result.rows).toEqual([])
  })

  it('lets a plugin’s failure reach the screen, which knows how to report it', async () => {
    const broken = registryWith({
      ...reportPlugin,
      register: (api) => {
        api.registerReport({
          id: 'boom',
          label: 'Boom',
          icon: 'error',
          run: () => {
            throw new Error('the batch table is not there')
          },
        })
      },
    })
    await broken.sync(['demo'])
    const report = pluginReports(broken)[0]!

    await expect(runPluginReport(report, context, { currency: 'BDT' })).rejects.toThrow(
      'the batch table is not there'
    )
  })
})
