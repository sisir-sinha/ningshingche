/**
 * The reports screen with a plugin's report in it (spec §23, §31, §51).
 *
 * This is the host half of the plugin-reports acceptance: a plugin *describes*
 * rows, and the core screen — its library, its table, its window and search
 * controls, its export path — draws them. Until this landed, `registerReport`
 * put a definition into a registry that nothing read, so a plugin could
 * describe a report no shopkeeper could ever open.
 *
 * The plugin here is a stand-in: what is under test is the seam, not any one
 * plugin's arithmetic. Serial Numbers and Batch & Expiry pin their own reports
 * in their own tests.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reportsView } from './reports-view'
import { EventBus } from '../../shared/bus/event-bus'
import { PluginRegistry } from '../../shared/registry/plugin-registry'
import type {
  Plugin,
  PluginDataStore,
  PluginDb,
  PluginSettings,
  ReportRunContext,
} from '../../shared/registry/plugin-types'
import type { ReportResult } from '../../shared/repositories/contracts'
// Named purely so the mock below can hand back the *real* module with two
// functions replaced: the app builds its plugin host from this module too, and
// a half-mocked session would break it in ways a test should never invent.
import type * as sessionModule from '../../app/state/session'

// ── The core half of the screen ───────────────────────────────────────────

const salesResult: ReportResult = {
  key: 'sales',
  title: 'Sales',
  group: 'Selling',
  description: 'Every completed sale.',
  columns: [
    { key: 'invoice_no', label: 'Invoice', type: 'text' },
    { key: 'total', label: 'Total', type: 'money' },
  ],
  rows: [{ invoice_no: 'INV-2026-000001', total: 11500 }],
  totals: { total: 11500 },
  totalRows: 1,
  offset: 0,
  limit: 25,
  sort: '',
  dir: 'desc',
  search: null,
  period: 'month',
  label: 'This month',
  from: '2026-09-01',
  to: '2026-09-30',
  currency: 'BDT',
  generatedAt: '2026-09-26T10:00:00.000Z',
}

const catalogMock = vi.fn(async () => [
  {
    key: 'sales',
    title: 'Sales',
    group: 'Selling',
    description: 'Every completed sale.',
    columns: salesResult.columns,
  },
])
const runMock = vi.fn(async (_query: unknown) => salesResult)

let permissions = new Set(['reports.view'])

vi.mock('../../app/data', () => ({
  getRepositories: () => ({ reports: { catalog: catalogMock, run: runMock } }),
}))

vi.mock('../../app/state/session', async (importOriginal) => {
  const actual = await importOriginal<typeof sessionModule>()
  return {
    ...actual,
    can: (required?: string) =>
      !required || permissions.has('*') || permissions.has(required),
    activeOrganization: () => ({ currency: 'BDT' }),
  }
})

vi.mock('../../app/state/sales-floor', () => ({
  salesFloor: () => ({ branchId: 'branch-1' }),
}))

// ── A plugin with three reports ───────────────────────────────────────────

let asked: { id: string; context: ReportRunContext }[] = []

const reportPlugin: Plugin = {
  id: 'demo',
  name: 'Demo Kit',
  version: '1.0.0',
  register: (api) => {
    api.registerReport({
      id: 'expiring',
      label: 'Expiring stock',
      icon: 'event_busy',
      group: 'Stock',
      permission: 'inventory.view',
      description: 'Products whose batch expiry falls inside the period you pick.',
      filters: { window: true, search: true },
      run: (context) => {
        asked.push({ id: 'expiring', context })
        return {
          columns: [
            { key: 'product', label: 'Product', type: 'text' },
            { key: 'days', label: 'Days left', type: 'int', align: 'right' },
            { key: 'value', label: 'Value', type: 'money', align: 'right' },
          ],
          rows: [
            { product: 'Amoxicillin 500mg', days: 12, value: 40000 },
            { product: 'Paracetamol 500mg', days: -3, value: 12500 },
          ],
          totals: { value: 52500 },
          note: '2 product(s) inside 30 day(s) · 1 already expired',
        }
      },
    })

    api.registerReport({
      id: 'shelf-aging',
      label: 'Shelf aging',
      icon: 'hourglass_bottom',
      group: 'Stock',
      permission: 'inventory.view',
      filters: { window: false },
      run: (context) => {
        asked.push({ id: 'shelf-aging', context })
        return {
          columns: [{ key: 'bucket', label: 'Time on the shelf', type: 'text' }],
          rows: [{ bucket: 'over 180 days' }],
        }
      },
    })

    api.registerReport({
      id: 'payroll',
      label: 'Salary review',
      icon: 'lock',
      permission: 'payroll.view',
      run: () => ({ columns: [], rows: [] }),
    })
  },
}

let registry: PluginRegistry

beforeEach(async () => {
  permissions = new Set(['reports.view', 'inventory.view'])
  asked = []
  catalogMock.mockClear()
  runMock.mockClear()
  document.body.replaceChildren()

  const bus = new EventBus()
  bus.onError = () => undefined
  const settings: PluginSettings = {
    get: <T,>(_key: string, fallback: T): T => fallback,
    all: () => ({}),
    set: async () => undefined,
  }
  const data: PluginDataStore = {
    get: async <T,>(_key: string, fallback: T): Promise<T> => fallback,
    set: async () => undefined,
    remove: async () => false,
    keys: async () => [],
  }
  const db: PluginDb = {
    products: async () => [],
    rpc: async <T,>(): Promise<T> => null as T,
  }
  registry = new PluginRegistry(bus, {
    settings: () => settings,
    data: () => data,
    db: () => db,
  })
  registry.declare({
    manifest: {
      id: 'demo',
      name: 'Demo Kit',
      version: '1.0.0',
      coreApiVersion: '^1.0.0',
      description: 'A kit with reports in it.',
      category: 'optional',
    },
    load: async () => reportPlugin,
  })
  await registry.sync(['demo'])
})

afterEach(() => {
  document.body.replaceChildren()
})

/** Flushes the promises a render kicked off. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

function button(view: HTMLElement, label: string): HTMLButtonElement {
  const found = [...view.querySelectorAll('button')].find((candidate) =>
    (candidate.textContent ?? '').includes(label)
  )
  expect(found, `no button labelled “${label}”`).toBeTruthy()
  return found as HTMLButtonElement
}

async function open(label: string, initialReport?: string): Promise<HTMLElement> {
  const view = reportsView({ registry, ...(initialReport ? { initialReport } : {}) })
  document.body.append(view)
  await settle()
  if (!initialReport) {
    button(view, label).click()
    await settle()
  }
  return view
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('the library', () => {
  it('lists a plugin’s report beside the built-ins, under the group it chose', async () => {
    const view = await open('Expiring stock')

    expect(view.textContent).toContain('Sales')
    expect(view.textContent).toContain('Selling')
    expect(view.textContent).toContain('Expiring stock')
    expect(view.textContent).toContain('Stock')
  })

  it('hides a report whose permission the signed-in user lacks', async () => {
    const view = await open('Expiring stock')

    expect(view.textContent).not.toContain('Salary review')
  })

  it('opens a plugin report from a URL, because the key is a link', async () => {
    // `#/reports?report=plugin.demo.expiring` — the same shape the dashboard
    // links with, and no position in a list to go stale.
    const view = await open('Expiring stock', 'plugin.demo.expiring')

    expect(view.textContent).toContain('Amoxicillin 500mg')
  })
})

describe('running a plugin report', () => {
  it('draws the plugin’s rows in the core table, with its totals', async () => {
    const view = await open('Expiring stock')

    expect(asked).toHaveLength(1)
    expect(view.textContent).toContain('Amoxicillin 500mg')
    expect(view.textContent).toContain('Paracetamol 500mg')
    // The plugin's small print lands in the subtitle, next to the window the
    // host chose — the same shape a built-in report has.
    expect(view.textContent).toContain('already expired')
    expect(view.textContent).toContain('This month')
    // …and the money column is totalled like any other report's.
    expect(view.textContent).toContain('Value')
  })

  it('asks with the screen’s own filters rather than a second vocabulary', async () => {
    await open('Expiring stock')

    expect(asked[0]?.context).toMatchObject({
      period: 'month',
      from: null,
      to: null,
      search: '',
      branchId: 'branch-1',
      limit: 25,
      offset: 0,
    })
  })

  it('offers the window control to a windowed report, and withholds it from the rest', async () => {
    const windowed = await open('Expiring stock')
    expect(windowed.textContent).toContain('This quarter')

    const plain = await open('Shelf aging')
    expect(plain.textContent).not.toContain('This quarter')
    expect(plain.textContent).toContain('over 180 days')
  })

  it('withholds the search box from a report that cannot be searched', async () => {
    await open('Expiring stock')
    expect(document.querySelector('input[type="search"]')).toBeTruthy()

    document.body.replaceChildren()
    await open('Shelf aging')
    expect(document.querySelector('input[type="search"]')).toBeNull()
  })

  it('exports the whole filtered set, exactly as a built-in does', async () => {
    const view = await open('Expiring stock')
    asked = []

    button(view, 'CSV').click()
    await settle()

    // “Export the report” means every matching row, not the page on screen —
    // for a plugin report too, even though the ceiling is far above one page.
    expect(asked[0]?.context.offset).toBe(0)
    expect(asked[0]?.context.limit).toBeGreaterThan(10_000)
  })

  it('says so, on the screen, when a plugin’s report throws', async () => {
    const broken = new PluginRegistry(new EventBus(), {
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
    broken.declare({
      manifest: {
        id: 'broken',
        name: 'Broken Kit',
        version: '1.0.0',
        coreApiVersion: '^1.0.0',
        description: 'Throws.',
        category: 'optional',
      },
      load: async () => ({
        id: 'broken',
        name: 'Broken Kit',
        version: '1.0.0',
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
      }),
    })
    await broken.sync(['broken'])

    const view = reportsView({ registry: broken })
    document.body.append(view)
    await settle()
    button(view, 'Boom').click()
    await settle()

    expect(view.textContent).toContain('This report could not be loaded')
    expect(view.textContent).toContain('the batch table is not there')
  })
})

describe('the built-ins', () => {
  it('still go to the server, through exactly the path they always did', async () => {
    // A plugin report is on the shelf beside them and changes nothing: the
    // eleven built-ins still arrive from the server, through the same call.
    const view = await open('Expiring stock')
    expect(runMock).toHaveBeenCalledTimes(1)
    expect(runMock.mock.calls[0]?.[0]).toMatchObject({ report: 'sales', period: 'month' })

    button(view, 'Sales').click()
    await settle()

    expect(runMock).toHaveBeenCalledTimes(2)
    expect(view.textContent).toContain('INV-2026-000001')
  })
})
