/**
 * Loyalty (lite) — the SDK's worked example, tested through the plugin API.
 *
 * The interesting property is the auto-award listener: a sale event arrives
 * twice (once locally, once over Realtime) and the customer must be credited
 * exactly once per event id.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PluginRegistry } from '../../shared/registry/plugin-registry'
import { EventBus } from '../../shared/bus/event-bus'
import { validateManifest } from '../../shared/registry/plugin-manifest'
import type {
  Plugin,
  PluginDataStore,
  PluginDb,
  PluginManifest,
  PluginSettings,
} from '../../shared/registry/plugin-types'
import loyaltyLitePlugin, { formatPoints, pointsFor } from './index'
import { AUTO_AWARD_KEY, POINTS_PER_CURRENCY_KEY, loyaltyLiteManifest } from './manifest'

const ORG = '11111111-1111-1111-1111-111111111111'

// ── The dependency, as a fixture ──────────────────────────────────────────
//
// Loyalty declares a dependency, and that dependency is a real plugin that
// happens to live in a sibling folder — which a plugin may not import
// (spec §51: compose through `dependencies` and events, never a direct
// import). So the host mechanics are tested here against a stand-in carrying
// the same manifest facts, and the check that this bundle's *shipped* pair
// agrees lives in src/app/plugins.test.ts, where composition belongs.

const dependencyManifest: PluginManifest = {
  id: 'batch-expiry',
  name: 'Dependency (fixture)',
  version: '1.0.0',
  coreApiVersion: '^1.0.0',
  description: 'Stands in for whatever loyalty depends on.',
  category: 'optional',
}

const dependencyPlugin: Plugin = {
  id: 'batch-expiry',
  name: 'Dependency (fixture)',
  version: '1.0.0',
  register: (api) => {
    api.registerDashboardWidget({
      id: 'batch-expiry.expiring',
      title: 'Expiring soon',
      size: 'sm',
      render: () => document.createElement('div'),
    })
  },
}

let bus: EventBus
let registry: PluginRegistry
let rpc: Array<{ fn: string; args?: Record<string, unknown> }>
let data: Map<string, unknown>
let settings: Map<string, unknown>
let failNextRpc: boolean

function makeRegistry(): PluginRegistry {
  const store: PluginSettings = {
    get: <T,>(key: string, fallback: T): T =>
      settings.has(key) ? (settings.get(key) as T) : fallback,
    all: () => Object.fromEntries(settings),
    set: async (key, value) => {
      settings.set(key, value)
    },
  }
  const bag: PluginDataStore = {
    get: async <T,>(key: string, fallback: T): Promise<T> =>
      data.has(key) ? (data.get(key) as T) : fallback,
    set: async (key, value) => {
      data.set(key, value)
    },
    remove: async (key) => data.delete(key),
    keys: async () => [...data.keys()],
  }
  const db: PluginDb = {
    products: async () => [],
    rpc: async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
      if (failNextRpc) throw new Error('permission denied')
      rpc.push({ fn, ...(args ? { args } : {}) })
      return { ok: true } as T
    },
  }
  return new PluginRegistry(bus, {
    settings: () => store,
    data: () => bag,
    db: () => db,
  })
}

/**
 * One delivery of one sale.
 *
 * `envelopeId` and `saleId` are separate on purpose. In the running app the two
 * deliveries of a sale carry *different* envelope ids — the client's echo
 * fabricates one, and the Realtime delivery carries the outbox row's — so the
 * thing a handler can rely on is the sale, not the delivery.
 */
function saleEvent(
  envelopeId: string,
  total: number,
  customerId: string | null,
  saleId = `s-${envelopeId}`
): void {
  bus.emit('sale.completed', {
    id: envelopeId,
    organization_id: ORG,
    aggregate: 'sale',
    type: 'sale.completed',
    data: {
      sale_id: saleId,
      invoice_no: `INV-${saleId}`,
      branch_id: 'b1',
      customer_id: customerId,
      // Postgres returns `numeric` as text and the outbox passes it through
      // unchanged; the plugin is expected to parse it.
      total: total.toFixed(2),
    },
    created_at: '2026-09-25T10:00:00Z',
    version: 1,
  })
}

beforeEach(async () => {
  bus = new EventBus()
  bus.onError = () => undefined
  rpc = []
  data = new Map()
  settings = new Map()
  failNextRpc = false
  registry = makeRegistry()
  registry.declare({ manifest: dependencyManifest, load: async () => dependencyPlugin })
  registry.declare({ manifest: loyaltyLiteManifest, load: async () => loyaltyLitePlugin })
  // Loyalty depends on batch-expiry, so enabling it enables both.
  await registry.sync(['loyalty-lite'])
})

describe('manifest', () => {
  it('is valid, and would be refused if it defined a core permission', () => {
    expect(() => validateManifest(loyaltyLiteManifest)).not.toThrow()
    expect(() =>
      validateManifest({ ...loyaltyLiteManifest, permissions: [{ key: 'sales.create', label: 'x', group: 'sales' }] })
    ).toThrow()
  })

  it('declares a dependency, so it cannot be enabled on its own', async () => {
    expect(loyaltyLiteManifest.dependencies).toEqual(['batch-expiry'])
    expect(registry.loadedIds).toEqual(['batch-expiry', 'loyalty-lite'])
    expect(registry.resolution?.autoEnabled).toEqual(['batch-expiry'])
  })
})

describe('points', () => {
  it('floors the award so a shop never over-credits', () => {
    expect(pointsFor(100.9, 1)).toBe(100)
    expect(pointsFor(100, 0.5)).toBe(50)
  })

  it('awards nothing for a free sale or a zero rate', () => {
    expect(pointsFor(0, 1)).toBe(0)
    expect(pointsFor(-5, 1)).toBe(0)
    expect(pointsFor(100, 0)).toBe(0)
  })

  it('formats for the shop’s locale', () => {
    expect(formatPoints(12345)).toMatch(/12,345/)
  })
})

describe('registration', () => {
  it('appears on the surfaces a shop uses, all permission-namespaced', () => {
    expect(registry.nav.items.map((item) => item.id)).toContain('loyalty-lite')
    expect(registry.routes.items.map((route) => route.path)).toContain('/plugins/loyalty-lite')
    expect(registry.posPanels.items.map((panel) => panel.id)).toEqual(['loyalty-lite.pos'])
    expect(registry.saleTabs.items.map((tab) => tab.id)).toEqual(['loyalty-lite.sale'])
    // The dependency contributes its own widget; this test is about loyalty's.
    const widgets = registry.widgets.items.filter((widget) => widget.source === 'loyalty-lite')
    expect(widgets.map((widget) => widget.id)).toEqual(['loyalty-lite.summary'])

    const keys = registry.permissions.items
      .filter((permission) => permission.source === 'loyalty-lite')
      .map((permission) => permission.key)
      .sort()
    expect(keys).toEqual(['loyalty-lite.manage', 'loyalty-lite.view'])
  })
})

describe('auto-award', () => {
  it('does nothing while the setting is off', async () => {
    saleEvent('e1', 250, 'cust-1')
    await Promise.resolve()

    expect(rpc).toHaveLength(0)
  })

  it('credits a customer once per sale, even though the sale arrives twice', async () => {
    settings.set(AUTO_AWARD_KEY, true)
    settings.set(POINTS_PER_CURRENCY_KEY, 2)

    saleEvent('e2', 100, 'cust-1')
    saleEvent('e2', 100, 'cust-1') // the Realtime replay of the same row
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rpc).toHaveLength(1)
    expect(rpc[0]?.fn).toBe('award')
    expect(rpc[0]?.args).toEqual({ customer_id: 'cust-1', points: 200 })
    expect(data.get('recent_sale_events')).toEqual(['s-e2'])
  })

  it('credits once when the two deliveries carry different envelope ids', async () => {
    settings.set(AUTO_AWARD_KEY, true)

    // The client's own echo when the sale is taken…
    saleEvent('local-9f31', 100, 'cust-7', 'sale-9f31')
    // …and the authority's, over Realtime, carrying the outbox row's id. The
    // ids differ, so a guard keyed on `event.id` — which this plugin used to
    // have — credited the customer twice for every sale in the shop.
    saleEvent('8b2c-row', 100, 'cust-7', 'sale-9f31')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rpc).toHaveLength(1)
    expect(data.get('recent_sale_events')).toEqual(['sale-9f31'])
  })

  it('ignores a walk-in sale, which has no customer to credit', async () => {
    settings.set(AUTO_AWARD_KEY, true)
    saleEvent('e3', 100, null)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rpc).toHaveLength(0)
  })

  it('does not remember an event whose award failed, so a retry can still happen', async () => {
    settings.set(AUTO_AWARD_KEY, true)
    failNextRpc = true

    saleEvent('e4', 100, 'cust-9')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rpc).toHaveLength(0)
    expect(data.has('recent_sale_events')).toBe(false)

    // The retry — the Realtime delivery that arrives a moment later, with the
    // row's own envelope id — lands.
    failNextRpc = false
    saleEvent('e4-row', 100, 'cust-9', 's-e4')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rpc).toHaveLength(1)
    expect(data.get('recent_sale_events')).toEqual(['s-e4'])
  })

  it('ignores a replay of an older event after a newer one', async () => {
    settings.set(AUTO_AWARD_KEY, true)

    saleEvent('e5', 100, 'cust-1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    saleEvent('e6', 100, 'cust-1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    // A late delivery of the *first* event, after a reload took the in-memory
    // guard with it. A one-slot memory would credit this customer twice.
    saleEvent('e5', 100, 'cust-1')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rpc).toHaveLength(2)
    expect(data.get('recent_sale_events')).toEqual(['s-e6', 's-e5'])
  })
})

describe('the POS panel', () => {
  it('offers the award only when a customer is attached and points are due', async () => {
    const panel = registry.posPanels.items[0]
    const context = { organizationId: ORG, branchId: 'b1', currency: 'BDT', total: 250 }

    const withCustomer = await panel?.render({ ...context, customerId: 'cust-1' })
    const without = await panel?.render({ ...context, customerId: null })

    const enabled = withCustomer?.querySelector('button')
    const disabled = without?.querySelector('button')
    expect(enabled?.disabled).toBe(false)
    expect(enabled?.textContent).toContain('Award 250')
    expect(disabled?.disabled).toBe(true)
    expect(disabled?.textContent).toContain('Attach a customer')
  })

  it('awards through the plugin’s own function when pressed', async () => {
    const panel = registry.posPanels.items[0]
    const el = await panel?.render({
      organizationId: ORG,
      branchId: 'b1',
      currency: 'BDT',
      total: 40,
      customerId: 'cust-2',
    })
    el?.querySelector('button')?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rpc[0]?.fn).toBe('award')
    expect(rpc[0]?.args).toEqual({ customer_id: 'cust-2', points: 40 })
  })
})

describe('the sale tab', () => {
  it('says a sale has no customer rather than showing zeros', async () => {
    const tab = registry.saleTabs.items[0]
    const el = await tab?.render({
      organizationId: ORG,
      branchId: 'b1',
      currency: 'BDT',
      customerId: null,
    })

    expect(el?.textContent).toMatch(/no customer attached/)
  })
})

describe('disable', () => {
  it('removes every surface the plugin installed', async () => {
    await registry.sync([])

    // Disabling the dependent plugin disables its dependency too: the resolver
    // computes the closure from what is enabled, and nothing asked for
    // batch-expiry on its own.
    expect(registry.posPanels.items).toHaveLength(0)
    expect(registry.saleTabs.items).toHaveLength(0)
    expect(registry.widgets.items).toHaveLength(0)
    expect(registry.routes.items).toHaveLength(0)
    expect(registry.permissions.items).toHaveLength(0)
    expect(registry.nav.items).toHaveLength(0)
    expect(registry.loadedIds).toEqual([])
  })
})
