/**
 * Plugin host (spec §31, §51, §52).
 *
 * Responsibilities:
 *  - Load plugins in dependency order, rejecting cycles before anything runs.
 *  - Isolate failures: a plugin that throws during registration is marked
 *    `error` and the rest of the application still boots.
 *  - Stamp every registration with its originating plugin so it can be torn
 *    down cleanly, and so the diagnostics view can answer "who added this?".
 *
 * Plugins are handed a `PluginAPI`, never the application. That boundary is
 * what makes spec §51 ("never duplicate universal functionality inside a
 * plugin") structurally enforced rather than a code-review hope.
 */

import type { EventBus } from '../bus/event-bus'
import type {
  EntityDefinition,
  Logger,
  NavItem,
  PermissionDefinition,
  Plugin,
  PluginAPI,
  PluginRegistration,
  PluginStorage,
  ProductField,
  ReportDefinition,
  SettingsSectionDefinition,
  ShortcutDefinition,
} from './plugin-types'

// ── Storage ───────────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'mekholi.plugin'

export class LocalPluginStorage implements PluginStorage {
  #store: Storage

  constructor(
    readonly pluginId: string,
    store: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage
  ) {
    // Fall back to an in-memory map when localStorage is unavailable
    // (private mode, sandboxed iframe, SSR).
    this.#store = store ?? new MemoryStorage()
  }

  #key(key: string): string {
    return `${STORAGE_PREFIX}.${this.pluginId}.${key}`
  }

  get<T>(key: string, fallback: T): T {
    try {
      const raw = this.#store.getItem(this.#key(key))
      if (raw === null) return fallback
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  set(key: string, value: unknown): void {
    try {
      this.#store.setItem(this.#key(key), JSON.stringify(value))
    } catch {
      // Quota exceeded or storage disabled — a plugin must not crash the app.
    }
  }

  delete(key: string): void {
    try {
      this.#store.removeItem(this.#key(key))
    } catch {
      /* no-op */
    }
  }

  keys(): string[] {
    const prefix = `${STORAGE_PREFIX}.${this.pluginId}.`
    const out: string[] = []
    for (let i = 0; i < this.#store.length; i += 1) {
      const k = this.#store.key(i)
      if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length))
    }
    return out
  }
}

class MemoryStorage implements Storage {
  #map = new Map<string, string>()
  get length(): number {
    return this.#map.size
  }
  clear(): void {
    this.#map.clear()
  }
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null
  }
  key(index: number): string | null {
    const keys = [...this.#map.keys()]
    return index >= 0 && index < keys.length ? (keys[index] as string) : null
  }
  removeItem(key: string): void {
    this.#map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value)
  }
}

// ── Logger ────────────────────────────────────────────────────────────────

function makeLogger(pluginId: string): Logger {
  const tag = `[plugin:${pluginId}]`
  return {
    debug: (m, d) => console.debug(tag, m, d ?? ''),
    warn: (m, d) => console.warn(tag, m, d ?? ''),
    error: (m, d) => console.error(tag, m, d ?? ''),
  }
}

// ── Ordered registration list ─────────────────────────────────────────────

/** Insertion-ordered collection with per-owner tracking for teardown. */
class Registry<T> {
  readonly #items: T[] = []
  readonly #owner = new Map<T, string>()

  add(item: T, pluginId: string): void {
    this.#items.push(item)
    this.#owner.set(item, pluginId)
  }

  removeOwnedBy(pluginId: string): number {
    let removed = 0
    for (let i = this.#items.length - 1; i >= 0; i -= 1) {
      const item = this.#items[i]
      if (item === undefined) continue
      if (this.#owner.get(item) === pluginId) {
        this.#owner.delete(item)
        this.#items.splice(i, 1)
        removed += 1
      }
    }
    return removed
  }

  clear(): void {
    this.#items.length = 0
    this.#owner.clear()
  }

  get items(): readonly T[] {
    return this.#items
  }
}

// ── The host ──────────────────────────────────────────────────────────────

export class PluginRegistry {
  readonly #registrations = new Map<string, PluginRegistration>()
  readonly #declared: Plugin[] = []

  readonly nav = new Registry<NavItem>()
  readonly productFields = new Registry<ProductField>()
  readonly entities = new Registry<EntityDefinition>()
  readonly permissions = new Registry<PermissionDefinition>()
  readonly reports = new Registry<ReportDefinition>()
  readonly settingsSections = new Registry<SettingsSectionDefinition>()
  readonly shortcuts = new Registry<ShortcutDefinition>()

  #disposed = new Map<string, () => void>()

  constructor(private readonly events: EventBus) {}

  /** Declare a plugin. Nothing runs until `loadAll`. */
  declare(plugin: Plugin): void {
    if (this.#registrations.has(plugin.id)) {
      throw new Error(`plugin "${plugin.id}" declared twice`)
    }
    this.#registrations.set(plugin.id, { plugin, status: 'declared' })
    this.#declared.push(plugin)
  }

  /**
   * Load every declared plugin in dependency order.
   * Returns the registrations so the caller can surface failures.
   */
  async loadAll(): Promise<readonly PluginRegistration[]> {
    const order = this.#sort()

    for (const plugin of order) {
      const registration = this.#registrations.get(plugin.id)
      if (!registration) continue

      const missing = (plugin.dependencies ?? []).filter((d) => {
        const dep = this.#registrations.get(d)
        return !dep || dep.status !== 'loaded'
      })

      if (missing.length > 0) {
        registration.status = 'skipped'
        registration.error = `missing or failed dependency: ${missing.join(', ')}`
        this.#announce(plugin.id, false, registration.error)
        continue
      }

      const api = this.#apiFor(plugin.id)
      try {
        await plugin.register(api)
        registration.status = 'loaded'
        registration.loadedAt = new Date().toISOString()
        this.#disposed.set(plugin.id, () => plugin.dispose?.())
        this.#announce(plugin.id, true)
      } catch (error) {
        registration.status = 'error'
        registration.error = error instanceof Error ? error.message : String(error)
        // Undo anything this plugin registered before it threw.
        this.#removeOwnedBy(plugin.id)
        console.error(`[plugin-host] "${plugin.id}" failed to load`, error)
        this.#announce(plugin.id, false, registration.error)
      }
    }

    return [...this.#registrations.values()]
  }

  /** Tear down every loaded plugin. Called on logout. */
  disposeAll(): void {
    for (const [id, dispose] of this.#disposed) {
      try {
        dispose()
      } catch (error) {
        console.error(`[plugin-host] "${id}" failed to dispose`, error)
      }
    }
    this.#disposed.clear()
    this.nav.clear()
    this.productFields.clear()
    this.entities.clear()
    this.permissions.clear()
    this.reports.clear()
    this.settingsSections.clear()
    this.shortcuts.clear()
    for (const registration of this.#registrations.values()) {
      registration.status = 'declared'
      delete registration.error
      delete registration.loadedAt
    }
  }

  list(): readonly PluginRegistration[] {
    return [...this.#registrations.values()]
  }

  get(id: string): PluginRegistration | undefined {
    return this.#registrations.get(id)
  }

  // ── Internals ─────────────────────────────────────────────────────────

  #announce(pluginId: string, ok: boolean, error?: string): void {
    this.events.emit('plugin.loaded', {
      type: 'plugin.loaded',
      data: error === undefined ? { plugin_id: pluginId, ok } : { plugin_id: pluginId, ok, error },
    })
  }

  /**
   * Kahn's algorithm. Cycles are reported with the ids involved so the error
   * message is actionable rather than "cycle detected".
   */
  #sort(): Plugin[] {
    const declared = new Set(this.#declared.map((p) => p.id))
    const ordered: Plugin[] = []
    const placed = new Set<string>()
    let remaining = [...this.#declared]

    while (remaining.length > 0) {
      const ready = remaining.filter((p) =>
        (p.dependencies ?? []).every((d) => placed.has(d) || !declared.has(d))
      )
      if (ready.length === 0) {
        for (const plugin of remaining) {
          const registration = this.#registrations.get(plugin.id)
          if (registration) {
            registration.status = 'error'
            registration.error = `dependency cycle among: ${remaining.map((p) => p.id).join(', ')}`
          }
        }
        return ordered
      }
      for (const plugin of ready) {
        ordered.push(plugin)
        placed.add(plugin.id)
      }
      remaining = remaining.filter((p) => !placed.has(p.id))
    }

    return ordered
  }

  #removeOwnedBy(pluginId: string): void {
    this.nav.removeOwnedBy(pluginId)
    this.productFields.removeOwnedBy(pluginId)
    this.entities.removeOwnedBy(pluginId)
    this.permissions.removeOwnedBy(pluginId)
    this.reports.removeOwnedBy(pluginId)
    this.settingsSections.removeOwnedBy(pluginId)
    this.shortcuts.removeOwnedBy(pluginId)
  }

  #apiFor(pluginId: string): PluginAPI {
    const log = makeLogger(pluginId)
    return {
      pluginId,
      events: this.events,
      storage: new LocalPluginStorage(pluginId),
      log,

      registerNav: (item) => this.nav.add({ ...item, source: pluginId }, pluginId),
      registerProductField: (field) =>
        this.productFields.add({ ...field, source: pluginId }, pluginId),
      registerEntity: (entity) => this.entities.add({ ...entity, source: pluginId }, pluginId),
      registerPermission: (permission) =>
        this.permissions.add({ ...permission, source: pluginId }, pluginId),
      registerReport: (report) => this.reports.add({ ...report, source: pluginId }, pluginId),
      registerSettingsSection: (section) =>
        this.settingsSections.add({ ...section, source: pluginId }, pluginId),
      registerShortcut: (shortcut) =>
        this.shortcuts.add({ ...shortcut, source: pluginId }, pluginId),
    }
  }
}
