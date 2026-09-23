/**
 * Plugin host tests.
 *
 * These cover the properties the architecture depends on: a plugin cannot take
 * the application down with it, dependencies load first, cycles are refused
 * rather than deadlocked, and every registration is attributable so it can be
 * torn down.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PluginRegistry, LocalPluginStorage } from './plugin-registry'
import { EventBus } from '../bus/event-bus'
import type { Plugin } from './plugin-types'

let bus: EventBus
let registry: PluginRegistry

beforeEach(() => {
  bus = new EventBus()
  bus.onError = () => undefined // keep handler errors out of the test log
  registry = new PluginRegistry(bus)
})

function plugin(id: string, options: Partial<Plugin> = {}): Plugin {
  return { id, name: id, version: '1.0.0', register: () => undefined, ...options }
}

describe('PluginRegistry — loading', () => {
  it('loads a plugin and marks it loaded', async () => {
    registry.declare(plugin('alpha', { register: vi.fn() }))

    const results = await registry.loadAll()

    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('loaded')
    expect(results[0]?.loadedAt).toBeDefined()
  })

  it('awaits an async register', async () => {
    let finished = false
    registry.declare(
      plugin('async-one', {
        register: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          finished = true
        },
      })
    )

    await registry.loadAll()

    expect(finished).toBe(true)
  })

  it('rejects a duplicate plugin id', () => {
    registry.declare(plugin('alpha'))
    expect(() => registry.declare(plugin('alpha'))).toThrow(/declared twice/)
  })

  it('loads dependencies before dependents', async () => {
    const order: string[] = []
    // Declared in the wrong order on purpose.
    registry.declare(
      plugin('child', {
        dependencies: ['parent'],
        register: () => {
          order.push('child')
        },
      })
    )
    registry.declare(
      plugin('parent', {
        register: () => {
          order.push('parent')
        },
      })
    )

    await registry.loadAll()

    expect(order).toEqual(['parent', 'child'])
  })

  it('resolves a three-deep chain declared in reverse', async () => {
    const order: string[] = []
    const push = (id: string): void => {
      order.push(id)
    }
    registry.declare(plugin('c', { dependencies: ['b'], register: () => push('c') }))
    registry.declare(plugin('b', { dependencies: ['a'], register: () => push('b') }))
    registry.declare(plugin('a', { register: () => push('a') }))

    await registry.loadAll()

    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('refuses a dependency cycle instead of hanging', async () => {
    registry.declare(plugin('x', { dependencies: ['y'], register: vi.fn() }))
    registry.declare(plugin('y', { dependencies: ['x'], register: vi.fn() }))

    const results = await registry.loadAll()

    expect(results.every((r) => r.status === 'error')).toBe(true)
    expect(results[0]?.error).toMatch(/dependency cycle/)
  })

  it('skips a plugin whose dependency failed to load', async () => {
    registry.declare(
      plugin('broken', {
        register: () => {
          throw new Error('nope')
        },
      })
    )
    registry.declare(plugin('dependent', { dependencies: ['broken'], register: vi.fn() }))

    const results = await registry.loadAll()

    expect(results.find((r) => r.plugin.id === 'broken')?.status).toBe('error')
    expect(results.find((r) => r.plugin.id === 'dependent')?.status).toBe('skipped')
    expect(results.find((r) => r.plugin.id === 'dependent')?.error).toMatch(/missing or failed dependency/)
  })

  it('skips a plugin depending on one that was never declared', async () => {
    registry.declare(plugin('orphan', { dependencies: ['ghost'], register: vi.fn() }))

    const results = await registry.loadAll()

    expect(results[0]?.status).toBe('skipped')
    expect(results[0]?.error).toMatch(/ghost/)
  })
})

describe('PluginRegistry — failure isolation', () => {
  it('keeps loading after a plugin throws', async () => {
    const loaded: string[] = []
    registry.declare(
      plugin('explodes', {
        register: () => {
          throw new Error('kaboom')
        },
      })
    )
    registry.declare(
      plugin('survivor', {
        register: () => {
          loaded.push('survivor')
        },
      })
    )

    const results = await registry.loadAll()

    expect(results.find((r) => r.plugin.id === 'explodes')?.status).toBe('error')
    expect(results.find((r) => r.plugin.id === 'explodes')?.error).toBe('kaboom')
    expect(loaded).toEqual(['survivor'])
  })

  it('undoes a throwing plugin’s partial registrations', async () => {
    registry.declare(
      plugin('half-done', {
        register: (api) => {
          api.registerNav({ id: 'ghost', label: 'Ghost', icon: 'help', route: '/ghost' })
          api.registerProductField({ key: 'ghost', label: 'Ghost', type: 'text', storage: 'metadata' })
          throw new Error('failed midway')
        },
      })
    )

    await registry.loadAll()

    // Without this, a failed plugin would leave dead entries in the sidebar
    // and the product form.
    expect(registry.nav.items).toHaveLength(0)
    expect(registry.productFields.items).toHaveLength(0)
  })

  it('announces load outcomes on the bus', async () => {
    const events: { id: string; ok: boolean }[] = []
    bus.on('plugin.loaded', (event) => events.push({ id: event.data.plugin_id, ok: event.data.ok }))

    registry.declare(
      plugin('good', {
        register: () => undefined,
      })
    )
    registry.declare(
      plugin('bad', {
        register: () => {
          throw new Error('x')
        },
      })
    )

    await registry.loadAll()

    expect(events).toEqual([
      { id: 'good', ok: true },
      { id: 'bad', ok: false },
    ])
  })
})

describe('PluginRegistry — registration attribution', () => {
  it('stamps every registration with its originating plugin', async () => {
    registry.declare(
      plugin('expiry', {
        register: (api) => {
          api.registerNav({ id: 'watch', label: 'Expiry', icon: 'event', route: '/expiry' })
          api.registerProductField({ key: 'batch', label: 'Batch', type: 'text', storage: 'metadata' })
          api.registerPermission({ key: 'expiry.adjust', label: 'Adjust', group: 'Inventory' })
          api.registerShortcut({ combo: 'F9', action: 'expiry.check', label: 'Check expiry', handler: () => undefined })
        },
      })
    )

    await registry.loadAll()

    expect(registry.nav.items[0]?.source).toBe('expiry')
    expect(registry.productFields.items[0]?.source).toBe('expiry')
    expect(registry.permissions.items[0]?.source).toBe('expiry')
    expect(registry.shortcuts.items[0]?.source).toBe('expiry')
  })

  it('copies registrations so a plugin cannot mutate them afterwards', async () => {
    const original = { id: 'x', label: 'Original', icon: 'help', route: '/x' }
    registry.declare(
      plugin('mutator', {
        register: (api) => {
          api.registerNav(original)
          original.label = 'Mutated after the fact'
        },
      })
    )

    await registry.loadAll()

    expect(registry.nav.items[0]?.label).toBe('Original')
  })

  it('disposeAll removes everything and resets plugins to declared', async () => {
    const disposed: string[] = []
    registry.declare(
      plugin('alpha', {
        register: (api) => {
          api.registerNav({ id: 'a', label: 'A', icon: 'help', route: '/a' })
        },
        dispose: () => {
          disposed.push('alpha')
        },
      })
    )

    await registry.loadAll()
    expect(registry.nav.items).toHaveLength(1)

    registry.disposeAll()

    expect(disposed).toEqual(['alpha'])
    expect(registry.nav.items).toHaveLength(0)
    expect(registry.list()[0]?.status).toBe('declared')
  })
})

describe('PluginAPI — services', () => {
  it('namespaces storage per plugin so two plugins cannot collide', async () => {
    let alphaRead: unknown
    let betaRead: unknown

    registry.declare(
      plugin('alpha', {
        register: (api) => {
          api.storage.set('shared-key', 'from alpha')
          alphaRead = api.storage.get('shared-key', null)
        },
      })
    )
    registry.declare(
      plugin('beta', {
        register: (api) => {
          betaRead = api.storage.get('shared-key', 'default')
        },
      })
    )

    await registry.loadAll()

    expect(alphaRead).toBe('from alpha')
    expect(betaRead).toBe('default')
  })

  it('exposes the bus so plugins can react without importing a feature', async () => {
    const seen: string[] = []
    registry.declare(
      plugin('listener', {
        register: (api) => {
          api.events.onDomain('sale', (event) => seen.push(event.type))
        },
      })
    )

    await registry.loadAll()
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
    registry.declare(
      plugin('chatty', {
        register: (api) => api.log.debug('hello'),
      })
    )

    await registry.loadAll()

    expect(spy.mock.calls[0]?.[0]).toBe('[plugin:chatty]')
    spy.mockRestore()
  })
})

describe('LocalPluginStorage', () => {
  it('falls back to memory when localStorage is unavailable', () => {
    const storage = new LocalPluginStorage('test', undefined)

    storage.set('key', { nested: true })

    expect(storage.get('key', null)).toEqual({ nested: true })
    expect(storage.keys()).toEqual(['key'])
  })

  it('returns the fallback for a missing or corrupt key', () => {
    const storage = new LocalPluginStorage('test', undefined)

    expect(storage.get('absent', 'fallback')).toBe('fallback')

    storage.set('bad', { ok: true })
    // Overwrite with something that is not valid JSON.
    storage.delete('bad')
    expect(storage.get('bad', 'fallback')).toBe('fallback')
  })

  it('deletes a key', () => {
    const storage = new LocalPluginStorage('test', undefined)
    storage.set('key', 1)

    storage.delete('key')

    expect(storage.get('key', null)).toBeNull()
  })
})
