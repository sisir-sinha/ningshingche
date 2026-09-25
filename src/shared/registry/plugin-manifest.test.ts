/**
 * Manifest rules and resolution.
 *
 * These are the guarantees docs/05 and docs/07 make to a shopkeeper, expressed
 * as rules rather than paragraphs. The namespace rule in particular is the
 * privilege-escalation guard: a plugin that could define `settings.manage`
 * would inherit every admin grant in the shop.
 */

import { describe, it, expect } from 'vitest'
import {
  CORE_PLUGIN_API_VERSION,
  PluginManifestError,
  parseVersion,
  resolvePlugins,
  satisfiesRange,
  validateManifest,
} from './plugin-manifest'
import type { PluginManifest, ShippedPlugin } from './plugin-types'

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    coreApiVersion: '^1.0.0',
    category: 'optional',
    description: `${id}`,
    ...overrides,
  }
}

function shipped(id: string, overrides: Partial<PluginManifest> = {}): ShippedPlugin {
  return {
    manifest: manifest(id, overrides),
    load: async () => ({ id, name: id, version: '1.0.0', register: () => undefined }),
  }
}

describe('satisfiesRange', () => {
  it('accepts anything for a bare or star range', () => {
    expect(satisfiesRange('*', '1.2.3')).toBe(true)
    expect(satisfiesRange('', '1.2.3')).toBe(true)
  })

  it('pins with an exact version', () => {
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true)
    expect(satisfiesRange('1.2.3', '1.2.4')).toBe(false)
  })

  it('treats caret as same-major (and same-minor below 1.0)', () => {
    expect(satisfiesRange('^1.2.3', '1.9.0')).toBe(true)
    expect(satisfiesRange('^1.2.3', '2.0.0')).toBe(false)
    expect(satisfiesRange('^1.2.3', '1.2.2')).toBe(false)
    expect(satisfiesRange('^0.4.1', '0.4.9')).toBe(true)
    expect(satisfiesRange('^0.4.1', '0.5.0')).toBe(false)
  })

  it('treats tilde as same-major-and-minor', () => {
    expect(satisfiesRange('~1.2.3', '1.2.9')).toBe(true)
    expect(satisfiesRange('~1.2.3', '1.3.0')).toBe(false)
  })

  it('reads >= as a floor', () => {
    expect(satisfiesRange('>=1.2.3', '1.2.3')).toBe(true)
    expect(satisfiesRange('>=1.2.3', '9.0.0')).toBe(true)
    expect(satisfiesRange('>=1.2.3', '1.2.2')).toBe(false)
  })

  it('refuses a range it cannot parse rather than guessing', () => {
    expect(satisfiesRange('^1.x', '1.2.3')).toBe(false)
  })

  it('parses a version or reports null', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion(' 2.0.10 ')).toEqual([2, 0, 10])
    expect(parseVersion('1.2')).toBeNull()
  })
})

describe('validateManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(() => validateManifest(manifest('batch-expiry'))).not.toThrow()
  })

  it('requires an id that can be used as a permission namespace', () => {
    expect(() => validateManifest(manifest('Batch Expiry'))).toThrow(PluginManifestError)
    expect(() => validateManifest(manifest('1st-plugin'))).toThrow(/must be lower-case/)
  })

  it('requires semver for itself and a range for the core API', () => {
    expect(() => validateManifest(manifest('a', { version: '1.0' }))).toThrow(/not semver/)
    expect(() => validateManifest(manifest('a', { coreApiVersion: 'latest' }))).toThrow(
      /not a semver range/
    )
  })

  it('refuses a plugin that defines a permission outside its namespace', () => {
    // The escalation this prevents: `settings.manage` would be granted to
    // every admin through their existing wildcard.
    expect(() =>
      validateManifest(
        manifest('sneaky', {
          permissions: [{ key: 'settings.manage', label: 'Settings', group: 'admin' }],
        })
      )
    ).toThrow(/"sneaky\.…"/)
  })

  it('refuses a permission with an empty label', () => {
    expect(() =>
      validateManifest(
        manifest('quiet', { permissions: [{ key: 'quiet.view', label: '  ', group: 'other' }] })
      )
    ).toThrow(/needs a label/)
  })

  it('refuses duplicate setting keys', () => {
    expect(() =>
      validateManifest(
        manifest('dupe', {
          settingsSchema: [
            { key: 'days', label: 'Days', type: 'number' },
            { key: 'days', label: 'Days again', type: 'number' },
          ],
        })
      )
    ).toThrow(/duplicate setting keys/)
  })

  it('refuses a self-dependency', () => {
    expect(() => validateManifest(manifest('loop', { dependencies: ['loop'] }))).toThrow(
      /depends on itself/
    )
  })
})

describe('resolvePlugins', () => {
  it('loads an enabled plugin and reports the rest as not asked for', () => {
    const resolution = resolvePlugins([shipped('a'), shipped('b')], ['a'])

    expect(resolution.order.map((m) => m.id)).toEqual(['a'])
    expect(resolution.autoEnabled).toEqual([])
  })

  it('ignores an enabled key the server does not ship', () => {
    const resolution = resolvePlugins([shipped('a')], ['a', 'ghost'])

    expect(resolution.order.map((m) => m.id)).toEqual(['a'])
    expect(resolution.missing).toEqual([])
  })

  it('pulls in a dependency and marks it as automatic', () => {
    const resolution = resolvePlugins(
      [shipped('child', { dependencies: ['parent'] }), shipped('parent')],
      ['child']
    )

    expect(resolution.order.map((m) => m.id)).toEqual(['parent', 'child'])
    expect(resolution.autoEnabled).toEqual(['parent'])
  })

  it('reports a dependency the server does not ship, and blocks only that plugin', () => {
    const resolution = resolvePlugins(
      [shipped('child', { dependencies: ['ghost'] }), shipped('fine')],
      ['child', 'fine']
    )

    expect(resolution.missing).toEqual([{ plugin: 'child', dependency: 'ghost' }])
    expect(resolution.order.map((m) => m.id)).toEqual(['fine'])
  })

  it('reports an incompatible core API and blocks only that plugin', () => {
    const resolution = resolvePlugins(
      [shipped('future', { coreApiVersion: '^2.0.0' }), shipped('now')],
      ['future', 'now'],
      { coreVersion: CORE_PLUGIN_API_VERSION }
    )

    expect(resolution.incompatible).toEqual([
      { plugin: 'future', required: '^2.0.0', core: CORE_PLUGIN_API_VERSION },
    ])
    expect(resolution.order.map((m) => m.id)).toEqual(['now'])
  })

  it('reports a declared conflict once, and still loads both sides', () => {
    const resolution = resolvePlugins(
      [shipped('one', { conflicts: ['two'] }), shipped('two', { conflicts: ['one'] })],
      ['one', 'two']
    )

    expect(resolution.conflicts).toEqual([{ plugin: 'one', conflictsWith: 'two' }])
    expect(resolution.order.map((m) => m.id)).toEqual(['one', 'two'])
  })

  it('names every member of a cycle and loads the plugins outside it', () => {
    const resolution = resolvePlugins(
      [
        shipped('x', { dependencies: ['y'] }),
        shipped('y', { dependencies: ['z'] }),
        shipped('z', { dependencies: ['x'] }),
        shipped('free'),
      ],
      ['x', 'free']
    )

    const cycle = resolution.cycles[0] ?? []
    expect(resolution.cycles).toHaveLength(1)
    // A closed loop: every member named once, starting point repeated at the
    // end so the message reads `x → y → z → x`.
    expect(cycle[0]).toBe(cycle[cycle.length - 1])
    expect([...new Set(cycle)].sort()).toEqual(['x', 'y', 'z'])
    expect(resolution.order.map((m) => m.id)).toEqual(['free'])
  })

  it('orders a chain dependencies-first even when the shop asked for the last one', () => {
    const resolution = resolvePlugins(
      [
        shipped('third', { dependencies: ['second'] }),
        shipped('second', { dependencies: ['first'] }),
        shipped('first'),
      ],
      ['third']
    )

    expect(resolution.order.map((m) => m.id)).toEqual(['first', 'second', 'third'])
    expect(resolution.autoEnabled.sort()).toEqual(['first', 'second'])
  })
})
