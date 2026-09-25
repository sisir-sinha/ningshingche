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
import { resolvePlugins, validateManifest, type Resolution } from './plugin-manifest'
import type {
  DashboardWidgetDefinition,
  EntityDefinition,
  FormSectionDefinition,
  Logger,
  NavItem,
  PanelDefinition,
  PermissionDefinition,
  PluginAPI,
  PluginDataStore,
  PluginDb,
  PluginManifest,
  PluginRegistration,
  PluginSettings,
  PluginStorage,
  ProductField,
  ReportDefinition,
  RouteDefinition,
  ScanResolverDefinition,
  SettingsSectionDefinition,
  ShippedPlugin,
  ShortcutDefinition,
  TabDefinition,
} from './plugin-types'

/**
 * What the host lends a plugin beyond the event bus: its settings (backed by
 * `plugins.config`) and its org-scoped data (backed by `plugin_data`). The
 * registry does not know about Supabase — `main.ts` wires these — which is why
 * the registry stays testable without a network.
 */
export interface PluginHostServices {
  settings: (pluginId: string) => PluginSettings
  data: (pluginId: string) => PluginDataStore
  db: (pluginId: string) => PluginDb
}

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

export class MemoryStorage implements Storage {
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
  readonly #shipped = new Map<string, ShippedPlugin>()
  readonly #registrations = new Map<string, PluginRegistration>()
  readonly #disposers = new Map<string, () => void>()
  #resolution: Resolution | null = null
  #enabled: readonly string[] = []

  readonly nav = new Registry<NavItem>()
  readonly productFields = new Registry<ProductField>()
  readonly entities = new Registry<EntityDefinition>()
  readonly permissions = new Registry<PermissionDefinition>()
  readonly reports = new Registry<ReportDefinition>()
  readonly settingsSections = new Registry<SettingsSectionDefinition>()
  readonly shortcuts = new Registry<ShortcutDefinition>()
  readonly widgets = new Registry<DashboardWidgetDefinition>()
  readonly scanResolvers = new Registry<ScanResolverDefinition>()
  readonly posPanels = new Registry<PanelDefinition>()
  readonly saleTabs = new Registry<TabDefinition>()
  readonly formSections = new Registry<FormSectionDefinition>()
  readonly routes = new Registry<RouteDefinition>()

  constructor(
    private readonly events: EventBus,
    private readonly host: PluginHostServices = defaultHostServices()
  ) {}

  /** Declare what this bundle ships. Manifests are validated immediately. */
  declare(shipped: ShippedPlugin): void {
    const id = shipped.manifest.id
    if (this.#shipped.has(id)) throw new Error(`plugin "${id}" declared twice`)
    validateManifest(shipped.manifest)
    this.#shipped.set(id, shipped)
    this.#registrations.set(id, { id, manifest: shipped.manifest, status: 'disabled' })
  }

  /**
   * Make the loaded set match `enabledKeys`: load what should be running,
   * unload what should not. Called at boot and again whenever a shop enables
   * or disables a plugin — which is what keeps the POS working mid-session
   * rather than needing a reload (docs/05 §6).
   */
  async sync(enabledKeys: readonly string[]): Promise<readonly PluginRegistration[]> {
    const resolution = resolvePlugins([...this.#shipped.values()], enabledKeys)
    this.#resolution = resolution
    this.#enabled = [...enabledKeys]

    const wanted = new Set(resolution.order.map((manifest) => manifest.id))
    for (const id of [...this.#disposers.keys()]) {
      if (!wanted.has(id)) this.unload(id)
    }

    const blocked = new Map<string, string>()
    for (const entry of resolution.incompatible) {
      blocked.set(
        entry.plugin,
        `needs core plugin API ${entry.required}; this app implements ${entry.core}`
      )
    }
    for (const entry of resolution.missing) {
      blocked.set(entry.plugin, `requires "${entry.dependency}", which is not installed`)
    }
    for (const cycle of resolution.cycles) {
      for (const id of cycle) blocked.set(id, `dependency cycle: ${cycle.join(' → ')}`)
    }

    for (const registration of this.#registrations.values()) {
      if (registration.status === 'loaded') continue
      const reason = blocked.get(registration.id)
      if (reason !== undefined) {
        registration.status = 'blocked'
        registration.error = reason
        continue
      }
      if (!wanted.has(registration.id)) {
        registration.status = 'disabled'
        delete registration.error
      }
    }

    let changed = false
    for (const manifest of resolution.order) {
      const registration = this.#registrations.get(manifest.id)
      const shipped = this.#shipped.get(manifest.id)
      if (!registration || !shipped || registration.status === 'loaded') continue

      try {
        const plugin = await shipped.load()
        if (plugin.id !== manifest.id) {
          throw new Error(`module loaded for "${manifest.id}" declares id "${plugin.id}"`)
        }
        await plugin.register(this.#apiFor(manifest))
        const dispose = (): void => plugin.dispose?.()
        this.#disposers.set(manifest.id, dispose)
        registration.status = 'loaded'
        registration.loadedAt = new Date().toISOString()
        delete registration.error
        changed = true
        this.#announce(manifest.id, true)
      } catch (error) {
        // Quarantine, do not crash: one broken plugin must not take the shop's
        // POS with it (docs/05 §6, step 9).
        registration.status = 'error'
        registration.error = error instanceof Error ? error.message : String(error)
        this.#removeOwnedBy(manifest.id)
        console.error(`[plugin-host] "${manifest.id}" failed to load`, error)
        this.#announce(manifest.id, false, registration.error)
      }
    }

    if (changed) {
      this.events.emit('plugin.changed', {
        type: 'plugin.changed',
        data: {
          loaded: [...this.#disposers.keys()],
          enabled: this.#enabled,
        },
      })
    }

    return this.list()
  }

  /** Tear one plugin down: its registrations, then its own disposer. */
  unload(pluginId: string): number {
    const dispose = this.#disposers.get(pluginId)
    if (dispose) {
      try {
        dispose()
      } catch (error) {
        console.error(`[plugin-host] "${pluginId}" failed to dispose`, error)
      }
      this.#disposers.delete(pluginId)
    }

    const removed = this.#removeOwnedBy(pluginId)
    const registration = this.#registrations.get(pluginId)
    if (registration) {
      registration.status = 'disabled'
      delete registration.error
      delete registration.loadedAt
    }
    return removed
  }

  /** What the last `sync` decided, for the Plugins screen's diagnostics. */
  get resolution(): Resolution | null {
    return this.#resolution
  }

  /** Ids currently loaded by this bundle (not the shop's toggles). */
  get loadedIds(): readonly string[] {
    return [...this.#disposers.keys()]
  }

  /** Tear down every loaded plugin. Called on logout. */
  disposeAll(): void {
    for (const [id] of [...this.#disposers]) this.unload(id)
    this.nav.clear()
    this.productFields.clear()
    this.entities.clear()
    this.permissions.clear()
    this.reports.clear()
    this.settingsSections.clear()
    this.shortcuts.clear()
    this.widgets.clear()
    this.posPanels.clear()
    this.saleTabs.clear()
    this.formSections.clear()
    this.routes.clear()
    this.#resolution = null
    this.#enabled = []
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

  /** Every registration list this host keeps — the teardown checklist. */
  #registries(): Array<{ removeOwnedBy: (id: string) => number }> {
    return [
      this.nav,
      this.productFields,
      this.entities,
      this.permissions,
      this.reports,
      this.settingsSections,
      this.shortcuts,
      this.widgets,
      this.scanResolvers,
      this.posPanels,
      this.saleTabs,
      this.formSections,
      this.routes,
    ]
  }

  #removeOwnedBy(pluginId: string): number {
    let removed = 0
    for (const registry of this.#registries()) removed += registry.removeOwnedBy(pluginId)
    return removed
  }

  #apiFor(manifest: PluginManifest): PluginAPI {
    const pluginId = manifest.id
    const log = makeLogger(pluginId)
    return {
      pluginId,
      events: this.events,
      storage: new LocalPluginStorage(pluginId),
      log,
      settings: this.host.settings(pluginId),
      data: this.host.data(pluginId),

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
      registerDashboardWidget: (widget) =>
        this.widgets.add({ ...widget, source: pluginId }, pluginId),
      registerScanResolver: (resolver) =>
        this.scanResolvers.add({ ...resolver, source: pluginId }, pluginId),
      registerPOSPanel: (panel) => this.posPanels.add({ ...panel, source: pluginId }, pluginId),
      registerSaleTab: (tab) => this.saleTabs.add({ ...tab, source: pluginId }, pluginId),
      registerFormSection: (section) =>
        this.formSections.add({ ...section, source: pluginId }, pluginId),
      registerRoute: (route) => this.routes.add({ ...route, source: pluginId }, pluginId),
      db: this.host.db(pluginId),
    }
  }

}

/**
 * Used when nothing wires the host — unit tests, and any screen rendered
 * without a session. Memory-backed, so a plugin always gets an answer.
 */
function defaultHostServices(): PluginHostServices {
  const config = new Map<string, Record<string, unknown>>()
  const data = new Map<string, Map<string, unknown>>()
  return {
    settings: (pluginId) => {
      let store = config.get(pluginId)
      if (!store) {
        store = {}
        config.set(pluginId, store)
      }
      const bag = store
      return {
        get: <T,>(key: string, fallback: T): T => (key in bag ? (bag[key] as T) : fallback),
        all: () => ({ ...bag }),
        set: async (key, value) => {
          bag[key] = value
        },
      }
    },
    data: (pluginId): PluginDataStore => {
      let bag = data.get(pluginId)
      if (!bag) {
        bag = new Map<string, unknown>()
        data.set(pluginId, bag)
      }
      const store = bag
      return {
        get: async <T,>(key: string, fallback: T): Promise<T> =>
          store.has(key) ? (store.get(key) as T) : fallback,
        set: async (key, value) => {
          store.set(key, value)
        },
        remove: async (key) => store.delete(key),
        keys: async () => [...store.keys()],
      }
    },
    db: () => ({
      products: async () => [],
      rpc: async () => {
        throw new Error('plugin database access is not wired in this environment')
      },
    }),
  }
}
