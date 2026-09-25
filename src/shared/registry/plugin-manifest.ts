/**
 * Manifest rules and dependency resolution (docs/05 §2, §6; docs/07 §3).
 *
 * Pure functions, no DOM and no I/O, because these are the rules the docs
 * argue for — and rules that live in prose get violated:
 *
 *   * a plugin's permissions must be namespaced to it, or a careless plugin
 *     could mint `settings.manage` and inherit every admin grant (docs/07 §3);
 *   * a plugin needing a newer core API is skipped with a readable message,
 *     not loaded into a half-working state (docs/05 §9);
 *   * a dependency cycle is reported with the ids involved, and everything
 *     else still loads (docs/05 §6, step 4);
 *   * resolution happens on manifests only, so a broken plugin cannot fail
 *     before we know which plugin broke.
 */

import type { PluginManifest, ShippedPlugin } from './plugin-types'

/** The core plugin API this bundle implements (docs/05 §9). */
export const CORE_PLUGIN_API_VERSION = '1.0.0'

export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginManifestError'
  }
}

const ID_PATTERN = /^[a-z][a-z0-9-]{0,40}$/
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/

export function parseVersion(value: string): [number, number, number] | null {
  const match = VERSION_PATTERN.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * The range syntax the manifest may use, and nothing more:
 *   `*`          any version
 *   `1.2.3`      exactly
 *   `^1.2.3`     same major
 *   `~1.2.3`     same major and minor
 *   `>=1.2.3`    at least
 *
 * Deliberately small. A plugin that needs a richer range is asking for a
 * dependency manager, which is not what this is.
 */
export function satisfiesRange(range: string, version: string): boolean {
  const trimmed = range.trim()
  if (trimmed === '' || trimmed === '*') return true

  const actual = parseVersion(version)
  if (!actual) return false

  const operator = trimmed[0]
  const bare = operator === '^' || operator === '~' || operator === '>' ? trimmed.slice(1) : trimmed

  if (operator === '>') {
    const wanted = parseVersion(bare.replace(/^=/, ''))
    if (!wanted) return false
    return compare(actual, wanted) >= 0
  }

  const wanted = parseVersion(bare)
  if (!wanted) return false

  if (operator === '^') {
    // ^1.2.3 → >=1.2.3 <2.0.0 ; ^0.4.1 → >=0.4.1 <0.5.0
    if (wanted[0] > 0) return actual[0] === wanted[0] && compare(actual, wanted) >= 0
    return actual[0] === 0 && actual[1] === wanted[1] && compare(actual, wanted) >= 0
  }

  if (operator === '~') {
    return compare(actual, wanted) >= 0 && actual[0] === wanted[0] && actual[1] === wanted[1]
  }

  return compare(actual, wanted) === 0
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

/** Throws `PluginManifestError` on the first problem it finds. */
export function validateManifest(manifest: PluginManifest): void {
  if (!ID_PATTERN.test(manifest.id)) {
    throw new PluginManifestError(
      `plugin id "${manifest.id}" must be lower-case, start with a letter and use dashes`
    )
  }
  if (manifest.name.trim() === '') {
    throw new PluginManifestError(`${manifest.id}: name is required`)
  }
  if (!parseVersion(manifest.version)) {
    throw new PluginManifestError(
      `${manifest.id}: version "${manifest.version}" is not semver (x.y.z)`
    )
  }
  if (!parseVersion(manifest.coreApiVersion.replace(/^[\^~>=]+/, ''))) {
    throw new PluginManifestError(
      `${manifest.id}: coreApiVersion "${manifest.coreApiVersion}" is not a semver range`
    )
  }
  if (!['core', 'optional', 'industry'].includes(manifest.category)) {
    throw new PluginManifestError(`${manifest.id}: unknown category "${manifest.category}"`)
  }

  for (const permission of manifest.permissions ?? []) {
    // The privilege-escalation guard. A plugin is not allowed to define a key
    // outside its own namespace, ever (docs/07 §3).
    if (!permission.key.startsWith(`${manifest.id}.`)) {
      throw new PluginManifestError(
        `${manifest.id}: permission "${permission.key}" must be namespaced as ` +
          `"${manifest.id}.…" — a plugin may not define core permissions`
      )
    }
    if (permission.label.trim() === '') {
      throw new PluginManifestError(`${manifest.id}: permission "${permission.key}" needs a label`)
    }
  }

  const settingKeys = (manifest.settingsSchema ?? []).map((field) => field.key)
  if (new Set(settingKeys).size !== settingKeys.length) {
    throw new PluginManifestError(`${manifest.id}: duplicate setting keys`)
  }

  if ((manifest.dependencies ?? []).includes(manifest.id)) {
    throw new PluginManifestError(`${manifest.id}: depends on itself`)
  }
}

export interface Resolution {
  /** Manifests to load, dependencies first. */
  order: PluginManifest[]
  /** Asked for by this shop. */
  enabled: string[]
  /** Enabled because something enabled depends on them (the toggle is locked). */
  autoEnabled: string[]
  /** Enabled, but a dependency is not shipped by this server. */
  missing: Array<{ plugin: string; dependency: string }>
  /** Enabled, but its core API requirement cannot be met. */
  incompatible: Array<{ plugin: string; required: string; core: string }>
  /** Enabled together, but declared incompatible with each other. */
  conflicts: Array<{ plugin: string; conflictsWith: string }>
  /** Dependency loops, reported with their members. */
  cycles: string[][]
}

/**
 * What to load for a given `enabled` set, and what is wrong with the request.
 *
 * Nothing here throws: a shop with one broken plugin still opens, and the
 * problem is on the Plugins screen next to the toggle that caused it.
 */
export function resolvePlugins(
  shipped: readonly ShippedPlugin[],
  enabledKeys: readonly string[],
  options: { coreVersion?: string } = {}
): Resolution {
  const core = options.coreVersion ?? CORE_PLUGIN_API_VERSION
  const byId = new Map(shipped.map((entry) => [entry.manifest.id, entry.manifest]))

  const enabled = enabledKeys.filter((key) => byId.has(key))
  const closure = new Set<string>()
  const autoEnabled = new Set<string>()
  const missing: Resolution['missing'] = []

  const addWithDependencies = (id: string, explicitly: boolean, seen: Set<string>): void => {
    if (seen.has(id)) return
    seen.add(id)
    const manifest = byId.get(id)
    if (!manifest) return
    closure.add(id)
    if (!explicitly) autoEnabled.add(id)
    for (const dependency of manifest.dependencies ?? []) {
      if (!byId.has(dependency)) {
        missing.push({ plugin: id, dependency })
        continue
      }
      addWithDependencies(dependency, false, seen)
    }
  }

  for (const id of enabled) addWithDependencies(id, true, new Set())

  // Cycles: walk the closure with a colouring DFS so the message names the
  // exact loop rather than "cycle detected" (docs/05 §6).
  const cycles: string[][] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const visit = (id: string): void => {
    const status = state.get(id)
    if (status === 'done') return
    if (status === 'visiting') {
      const at = stack.indexOf(id)
      cycles.push(stack.slice(at >= 0 ? at : 0).concat(id))
      return
    }
    state.set(id, 'visiting')
    stack.push(id)
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      if (closure.has(dependency)) visit(dependency)
    }
    stack.pop()
    state.set(id, 'done')
  }
  for (const id of closure) visit(id)

  const cyclic = new Set(cycles.flat())
  const incompatible = [...closure]
    .filter((id) => !cyclic.has(id))
    .map((id) => ({ manifest: byId.get(id) }))
    .filter(
      (entry): entry is { manifest: PluginManifest } =>
        entry.manifest !== undefined &&
        !satisfiesRange(entry.manifest.coreApiVersion, core)
    )
    .map((entry) => ({
      plugin: entry.manifest.id,
      required: entry.manifest.coreApiVersion,
      core,
    }))

  const conflicts: Resolution['conflicts'] = []
  for (const id of closure) {
    for (const other of byId.get(id)?.conflicts ?? []) {
      if (closure.has(other) && id < other) conflicts.push({ plugin: id, conflictsWith: other })
    }
  }

  const blocked = new Set<string>([
    ...missing.map((entry) => entry.plugin),
    ...incompatible.map((entry) => entry.plugin),
    ...cyclic,
  ])

  // Kahn again, now over the loadable subset, dependencies first.
  const loadable = [...closure].filter((id) => !blocked.has(id))
  const placed: string[] = []
  const done = new Set<string>()
  let remaining = loadable.slice()
  while (remaining.length > 0) {
    const ready = remaining.filter((id) =>
      (byId.get(id)?.dependencies ?? []).every((dependency) => done.has(dependency))
    )
    if (ready.length === 0) {
      // Only reachable if a blocked dependency left a hole; the rest still loads.
      break
    }
    for (const id of ready) {
      placed.push(id)
      done.add(id)
    }
    remaining = remaining.filter((id) => !done.has(id))
  }

  return {
    order: placed
      .map((id) => byId.get(id))
      .filter((manifest): manifest is PluginManifest => manifest !== undefined),
    enabled: [...enabled],
    autoEnabled: [...autoEnabled].filter((id) => !enabled.includes(id)).sort(),
    missing,
    incompatible,
    conflicts,
    cycles,
  }
}
