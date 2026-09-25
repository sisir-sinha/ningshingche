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

import { describe, it, expect, beforeEach } from 'vitest'
import { PluginRegistry } from '../shared/registry/plugin-registry'
import { EventBus } from '../shared/bus'
import { posFieldValues, printableNotes } from './plugin-slots'
import type { Plugin } from '../shared/registry/plugin-types'

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
