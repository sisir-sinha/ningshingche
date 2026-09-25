/**
 * The composition root, tested where composition belongs.
 *
 * A plugin may not import another plugin (spec §51) — the two shipped plugins
 * prove that by each reaching the host only through the `PluginAPI`. Which
 * means the question "do these two, as shipped, fit together?" has no home
 * inside either of them. It has this one: the app layer declares what the
 * bundle ships, so the app layer is where the declared set is checked.
 *
 * These are the facts that would otherwise be discovered by a shopkeeper:
 * a dependency naming a plugin nobody ships, two plugins minting the same
 * permission key, a manifest that fails validation at import time.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterAll } from 'vitest'
import { SHIPPED_PLUGINS, declareShippedPlugins, pluginRegistry } from './plugins'
import { validateManifest } from '../shared/registry/plugin-manifest'

const manifests = SHIPPED_PLUGINS.map((shipped) => shipped.manifest)
const ids = manifests.map((manifest) => manifest.id)

describe('what this bundle ships', () => {
  it('ships plugins whose manifests all validate', () => {
    expect(manifests.length).toBeGreaterThanOrEqual(2)

    const problems = manifests
      .map((manifest) => {
        try {
          validateManifest(manifest)
          return null
        } catch (error) {
          return `${manifest.id}: ${(error as Error).message}`
        }
      })
      .filter((problem): problem is string => problem !== null)

    expect(problems).toEqual([])
    expect(declareShippedPlugins()).toEqual([])
  })

  it('declares each plugin once, with a unique permission namespace', () => {
    expect(new Set(ids).size).toBe(ids.length)

    const keys = manifests.flatMap((manifest) =>
      (manifest.permissions ?? []).map((permission) => permission.key)
    )
    expect(new Set(keys).size).toBe(keys.length)
    for (const manifest of manifests) {
      for (const permission of manifest.permissions ?? []) {
        expect(permission.key.startsWith(`${manifest.id}.`)).toBe(true)
      }
    }
  })

  it('only depends on plugins this bundle also ships', () => {
    // The one thing two plugins cannot check about each other from inside
    // themselves: that the dependency actually exists in the bundle.
    const unknown = manifests.flatMap((manifest) =>
      (manifest.dependencies ?? [])
        .filter((dependency) => !ids.includes(dependency))
        .map((dependency) => `${manifest.id} depends on ${dependency}`)
    )

    expect(unknown).toEqual([])
  })

  it('agrees with itself about versions and the core API', () => {
    for (const manifest of manifests) {
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(manifest.coreApiVersion).toMatch(/[\d*^~>]/)
    }
  })
})

describe('the host, loading the shipped set', () => {
  afterAll(async () => {
    // The registry is a singleton for the app's lifetime; a test that leaves
    // plugins loaded would leak into the next file that imports it.
    await pluginRegistry.sync([])
  })

  it('knows every shipped plugin before loading any of them', () => {
    const declared = pluginRegistry.list().map((registration) => registration.id)
    for (const id of ids) expect(declared).toContain(id)
  })

  it('loads a plugin and its dependency together, through the real modules', async () => {
    await pluginRegistry.sync(['loyalty-lite'])

    expect(pluginRegistry.loadedIds).toEqual(['batch-expiry', 'loyalty-lite'])
    expect(pluginRegistry.resolution?.autoEnabled).toEqual(['batch-expiry'])

    // Both plugins reached the host, so both contributed what they describe.
    const sources = new Set(pluginRegistry.nav.items.map((item) => item.source))
    expect(sources.has('batch-expiry')).toBe(true)
    expect(sources.has('loyalty-lite')).toBe(true)
  })

  it('leaves nothing behind when the shop switches everything off', async () => {
    await pluginRegistry.sync([])

    expect(pluginRegistry.loadedIds).toEqual([])
    expect(pluginRegistry.nav.items).toEqual([])
    expect(pluginRegistry.widgets.items).toEqual([])
    expect(pluginRegistry.posPanels.items).toEqual([])
    expect(pluginRegistry.saleTabs.items).toEqual([])
    expect(pluginRegistry.formSections.items).toEqual([])
  })
})
