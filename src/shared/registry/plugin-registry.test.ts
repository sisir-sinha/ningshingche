/**
 * Plugin host tests.
 *
 * The properties the architecture rests on: a plugin cannot take the app down
 * with it, dependencies load first, a cycle is refused rather than deadlocked,
 * nothing survives a disable, and every registration is attributable so it can
 * be torn down. The extras added in Phase 6 are the ones a shop notices —
 * a plugin the server does not ship, a core API too new, and enabling and
 * disabling the same plugin repeatedly without leaking a single registration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PluginRegistry, LocalPluginStorage, MemoryStorage } from './plugin-registry'
import { EventBus } from '../bus/event-bus'
import { CORE_PLUGIN_API_VERSION } from './plugin-manifest'
import type { Plugin, PluginAPI, PluginManifest, ShippedPlugin } from './plugin-types'

let bus: EventBus
let registry: PluginRegistry

beforeEach(() => {
  bus = new EventBus()
  bus.onError = () => undefined // keep handler errors out of the test log
  registry = new PluginRegistry(bus)
})

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    coreApiVersion: '^1.0.0',
    category: 'optional',
    description: `${id} plugin`,
    ...overrides,
  }
}

function shipped(id: string, body?: Partial<Plugin>): ShippedPlugin {
  return {
    manifest: manifest(id, body?.dependencies ? { dependencies: body.dependencies } : {}),
    load: async (): Promise<Plugin> => ({
      id,
      name: id,
      version: '1.0.0',
      register: () => undefined,
      ...body,
    }),
  }
}

describe('PluginRegistry — sync', () => {
  it('loads an enabled plugin and leaves the rest disabled', async () => {
    registry.declare(shipped('alpha', { register: vi.fn() }))
    registry.declare(shipped('beta', { register: vi.fn() }))

    const results = await registry.sync(['alpha'])

    expect(results.find((r) => r.id === 'alpha')?.status).toBe('loaded')
    expect(results.find((r) => r.id === 'beta')?.status).toBe('disabled')
    expect(registry.loadedIds).toEqual(['alpha'])
  })

  it('awaits an async register', async () => {
    let finished = false
    registry.declare(
      shipped('async-one', {
        register: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          finished = true
        },
      })
    )

    await registry.sync(['async-one'])

    expect(finished).toBe(true)
  })

  it('rejects a duplicate plugin id', () => {
    registry.declare(shipped('alpha'))
    expect(() => registry.declare(shipped('alpha'))).toThrow(/declared twice/)
  })

  it('loads dependencies before dependents', async () => {
    const order: string[] = []
    // Declared in the wrong order on purpose.
    registry.declare(
      shipped('child', {
        dependencies: ['parent'],
        register: () => {
          order.push('child')
        },
      })
    )
    registry.declare(
      shipped('parent', {
        register: () => {
          order.push('parent')
        },
      })
    )

    await registry.sync(['child'])

    expect(order).toEqual(['parent', 'child'])
    // The dependency was not asked for by the shop; the screen must say so.
    expect(registry.resolution?.autoEnabled).toEqual(['parent'])
  })

  it('resolves a three-deep chain declared in reverse', async () => {
    const order: string[] = []
    registry.declare(
      shipped('c', {
        dependencies: ['b'],
        register: () => {
          order.push('c')
        },
      })
    )
    registry.declare(
      shipped('b', {
        dependencies: ['a'],
        register: () => {
          order.push('b')
        },
      })
    )
    registry.declare(
      shipped('a', {
        register: () => {
          order.push('a')
        },
      })
    )

    await registry.sync(['c'])

    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('blocks a cycle with a readable message instead of hanging', async () => {
    registry.declare(shipped('x', { dependencies: ['y'], register: vi.fn() }))
    registry.declare(shipped('y', { dependencies: ['x'], register: vi.fn() }))

    const results = await registry.sync(['x'])

    expect(results.every((r) => r.status === 'blocked')).toBe(true)
    expect(results[0]?.error).toMatch(/cycle: x → y → x/)
  })

  it('blocks a plugin whose dependency this server does not ship', async () => {
    registry.declare(shipped('orphan', { dependencies: ['ghost'], register: vi.fn() }))

    const results = await registry.sync(['orphan'])

    expect(results[0]?.status).toBe('blocked')
    expect(results[0]?.error).toMatch(/requires "ghost"/)
  })

  it('blocks a plugin that needs a newer core API than this bundle implements', async () => {
    registry.declare({
      manifest: manifest('from-the-future', { coreApiVersion: '^9.0.0' }),
      load: async () => ({ id: 'from-the-future', name: 'x', version: '1.0.0', register: vi.fn() }),
    })

    const results = await registry.sync(['from-the-future'])

    expect(results[0]?.status).toBe('blocked')
    expect(results[0]?.error).toMatch(CORE_PLUGIN_API_VERSION)
  })

  it('still loads the rest of the shop when one plugin is blocked', async () => {
    registry.declare(shipped('broken', { dependencies: ['ghost'], register: vi.fn() }))
    registry.declare(shipped('fine', { register: vi.fn() }))

    const results = await registry.sync(['broken', 'fine'])

    expect(results.find((r) => r.id === 'broken')?.status).toBe('blocked')
    expect(results.find((r) => r.id === 'fine')?.status).toBe('loaded')
  })
})

describe('PluginRegistry — failure isolation', () => {
  it('keeps loading after a plugin throws', async () => {
    const loaded: string[] = []
    registry.declare(
      shipped('explodes', {
        register: () => {
          throw new Error('kaboom')
        },
      })
    )
    registry.declare(
      shipped('survivor', {
        register: () => {
          loaded.push('survivor')
        },
      })
    )

    const results = await registry.sync(['explodes', 'survivor'])

    const failed = results.find((r) => r.id === 'explodes')
    expect(failed?.status).toBe('error')
    expect(failed?.error).toBe('kaboom')
    expect(loaded).toEqual(['survivor'])
  })

  it('undoes a throwing plugin’s partial registrations', async () => {
    registry.declare(
      shipped('half-done', {
        register: (api) => {
          api.registerNav({ id: 'ghost', label: 'Ghost', icon: 'help', route: '/ghost' })
          api.registerProductField({ key: 'ghost', label: 'Ghost', type: 'text', storage: 'metadata' })
          api.registerDashboardWidget({ id: 'ghost.tile', title: 'Ghost', render: () => document.body })
          throw new Error('failed midway')
        },
      })
    )

    await registry.sync(['half-done'])

    // Without this, a failed plugin would leave dead entries in the sidebar,
    // the product form and the dashboard.
    expect(registry.nav.items).toHaveLength(0)
    expect(registry.productFields.items).toHaveLength(0)
    expect(registry.widgets.items).toHaveLength(0)
  })

  it('announces load outcomes on the bus', async () => {
    const events: { id: string; ok: boolean }[] = []
    bus.on('plugin.loaded', (event) => events.push({ id: event.data.plugin_id, ok: event.data.ok }))

    registry.declare(shipped('good'))
    registry.declare(
      shipped('bad', {
        register: () => {
          throw new Error('x')
        },
      })
    )

    await registry.sync(['good', 'bad'])

    expect(events).toEqual([
      { id: 'good', ok: true },
      { id: 'bad', ok: false },
    ])
  })

  it('announces the loaded set once per sync that changed something', async () => {
    const changes: string[][] = []
    bus.on('plugin.changed', (event) => changes.push([...(event.data?.loaded ?? [])]))
    registry.declare(shipped('alpha'))

    await registry.sync(['alpha'])
    await registry.sync(['alpha'])

    expect(changes).toEqual([['alpha']])
  })
})

describe('PluginRegistry — lifecycle', () => {
  it('survives enable → disable → enable with no leaked registrations', async () => {
    let disposals = 0
    registry.declare(
      shipped('alpha', {
        register: (api) => {
          api.registerNav({ id: 'a', label: 'A', icon: 'help', route: '/plugins/alpha' })
          api.registerDashboardWidget({ id: 'alpha.tile', title: 'A', render: () => document.body })
        },
        dispose: () => {
          disposals += 1
        },
      })
    )

    await registry.sync(['alpha'])
    await registry.sync([])
    await registry.sync(['alpha'])

    expect(disposals).toBe(1)
    expect(registry.nav.items).toHaveLength(1)
    expect(registry.widgets.items).toHaveLength(1)
  })

  it('unload removes every surface the plugin owned, and nothing else', async () => {
    registry.declare(
      shipped('keeper', {
        register: (api) => {
          api.registerNav({ id: 'k', label: 'K', icon: 'help', route: '/plugins/keeper' })
        },
      })
    )
    registry.declare(
      shipped('leaver', {
        register: (api) => {
          api.registerNav({ id: 'l', label: 'L', icon: 'help', route: '/plugins/leaver' })
          api.registerPermission({ key: 'leaver.manage', label: 'Manage', group: 'other' })
        },
        dispose: vi.fn(),
      })
    )

    await registry.sync(['keeper', 'leaver'])
    await registry.sync(['keeper'])

    expect(registry.nav.items.map((item) => item.id)).toEqual(['k'])
    expect(registry.permissions.items).toHaveLength(0)
    expect(registry.loadedIds).toEqual(['keeper'])
    expect(registry.list().find((r) => r.id === 'leaver')?.status).toBe('disabled')
  })

  it('disposeAll tears everything down and forgets the resolution', async () => {
    const disposed: string[] = []
    registry.declare(
      shipped('alpha', {
        register: (api) => {
          api.registerNav({ id: 'a', label: 'A', icon: 'help', route: '/plugins/alpha' })
        },
        dispose: () => {
          disposed.push('alpha')
        },
      })
    )

    await registry.sync(['alpha'])
    expect(registry.nav.items).toHaveLength(1)

    registry.disposeAll()

    expect(disposed).toEqual(['alpha'])
    expect(registry.nav.items).toHaveLength(0)
    expect(registry.resolution).toBeNull()
    expect(registry.list()[0]?.status).toBe('disabled')
  })
})

describe('PluginRegistry — registration attribution', () => {
  it('stamps every registration with its originating plugin', async () => {
    registry.declare(
      shipped('expiry', {
        register: (api) => {
          api.registerNav({ id: 'watch', label: 'Expiry', icon: 'event', route: '/plugins/expiry' })
          api.registerProductField({ key: 'batch', label: 'Batch', type: 'text', storage: 'metadata' })
          api.registerPermission({ key: 'expiry.adjust', label: 'Adjust', group: 'inventory' })
          api.registerShortcut({
            combo: 'F9',
            action: 'expiry.check',
            label: 'Check expiry',
            handler: () => undefined,
          })
          api.registerRoute({ path: '/plugins/expiry', title: 'Expiry', load: async () => ({ render: () => document.body }) })
          api.registerPOSPanel({ id: 'expiry.pos', label: 'Expiry', render: () => document.body })
          api.registerSaleTab({ id: 'expiry.sale', label: 'Expiry', render: () => document.body })
          api.registerFormSection({ id: 'expiry.form', label: 'Expiry', render: () => document.body })
        },
      })
    )

    await registry.sync(['expiry'])

    for (const surface of [
      registry.nav,
      registry.productFields,
      registry.permissions,
      registry.shortcuts,
      registry.routes,
      registry.posPanels,
      registry.saleTabs,
      registry.formSections,
    ]) {
      expect(surface.items[0]?.source).toBe('expiry')
    }
  })

  it('copies registrations so a plugin cannot mutate them afterwards', async () => {
    const original = { id: 'x', label: 'Original', icon: 'help', route: '/plugins/x' }
    registry.declare(
      shipped('mutator', {
        register: (api) => {
          api.registerNav(original)
          original.label = 'Mutated after the fact'
        },
      })
    )

    await registry.sync(['mutator'])

    expect(registry.nav.items[0]?.label).toBe('Original')
  })

  it('rejects a module that loads under the wrong id', async () => {
    registry.declare({
      manifest: manifest('expected'),
      load: async () => ({ id: 'something-else', name: 'x', version: '1.0.0', register: vi.fn() }),
    })

    const results = await registry.sync(['expected'])

    expect(results[0]?.status).toBe('error')
    expect(results[0]?.error).toMatch(/declares id "something-else"/)
  })
})

describe('PluginAPI — services', () => {
  it('namespaces local storage per plugin so two plugins cannot collide', async () => {
    let alphaRead: unknown
    let betaRead: unknown

    registry.declare(
      shipped('alpha', {
        register: (api) => {
          api.storage.set('shared-key', 'from alpha')
          alphaRead = api.storage.get('shared-key', null)
        },
      })
    )
    registry.declare(
      shipped('beta', {
        register: (api) => {
          betaRead = api.storage.get('shared-key', 'default')
        },
      })
    )

    await registry.sync(['alpha', 'beta'])

    expect(alphaRead).toBe('from alpha')
    expect(betaRead).toBe('default')
  })

  it('exposes the bus so plugins can react without importing a feature', async () => {
    const seen: string[] = []
    registry.declare(
      shipped('listener', {
        register: (api) => {
          api.events.onDomain('sale', (event) => seen.push(event.type))
        },
      })
    )

    await registry.sync(['listener'])
    bus.emit('sale.completed', {
      id: 'e1',
      organization_id: 'o',
      aggregate: 'sale',
      type: 'sale.completed',
      data: { sale_id: 's', invoice_no: 'i', branch_id: 'b', customer_id: null, total: '1' },
      created_at: 'now',
      version: 1,
    })

    expect(seen).toEqual(['sale.completed'])
  })

  it('prefixes the logger with the plugin id', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    registry.declare(shipped('chatty', { register: (api) => api.log.debug('hello') }))

    await registry.sync(['chatty'])

    expect(spy.mock.calls[0]?.[0]).toBe('[plugin:chatty]')
    spy.mockRestore()
  })

  it('hands the plugin its host services, scoped to itself', async () => {
    const seen: string[] = []
    registry.declare(
      shipped('hosted', {
        register: async (api: PluginAPI) => {
          seen.push(api.pluginId)
          await api.data.set('seen', 1)
          seen.push(String(await api.data.get('seen', 0)))
          seen.push(String(api.settings.get('missing', 'fallback')))
          api.registerDashboardWidget({ id: 'hosted.tile', title: 'T', render: () => document.body })
        },
      })
    )

    await registry.sync(['hosted'])

    expect(seen).toEqual(['hosted', '1', 'fallback'])
    expect(registry.widgets.items[0]?.source).toBe('hosted')
  })
})

describe('LocalPluginStorage', () => {
  it('falls back to memory when localStorage is unavailable', () => {
    const storage = new LocalPluginStorage('test', undefined)

    storage.set('key', { nested: true })

    expect(storage.get('key', null)).toEqual({ nested: true })
    expect(storage.keys()).toEqual(['key'])
  })

  it('returns the fallback for a missing key', () => {
    const storage = new LocalPluginStorage('test', undefined)
    expect(storage.get('absent', 'fallback')).toBe('fallback')
  })

  it('deletes a key', () => {
    const storage = new LocalPluginStorage('test', undefined)
    storage.set('key', 1)

    storage.delete('key')

    expect(storage.get('key', null)).toBeNull()
  })

  it('survives storage that throws (private mode, quota)', () => {
    const hostile = new MemoryStorage()
    hostile.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => new LocalPluginStorage('test', hostile).set('k', 1)).not.toThrow()
  })
})
