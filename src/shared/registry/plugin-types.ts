/**
 * The plugin contract (spec §31, §51).
 *
 * A plugin never imports a feature module and never calls the database
 * directly. It receives a scoped `PluginAPI` and registers *descriptions* of
 * things — a nav item, a product field, an entity. The core renders them.
 *
 * That indirection is the whole point: because the core owns the product form
 * and the cart, a plugin adding an expiry date cannot fork the sales engine.
 */

import type { EventBus } from '../bus/event-bus'

// ── Nav ───────────────────────────────────────────────────────────────────

export interface NavItem {
  id: string
  label: string
  /** Material Symbols Rounded ligature name. */
  icon: string
  /** Sidebar section; unknown ids fall back to a section created on the fly. */
  section?: string
  route: string
  /** Permission key gating visibility. Omit for always-visible items. */
  permission?: string
  /** Lower sorts first within a section. Defaults to 100. */
  order?: number
  /** Live badge count, re-read on each sidebar render. */
  badge?: () => number | string | null
  /** Set by the host. Never author this. */
  source?: string
}

// ── Product fields (spec §14, §51) ────────────────────────────────────────

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'money'
  | 'date'
  | 'datetime'
  | 'select'
  | 'boolean'

export interface FieldOption {
  value: string
  label: string
}

export interface ProductField {
  key: string
  label: string
  type: FieldType
  options?: FieldOption[]
  /** Progressive disclosure: `advanced` fields stay collapsed by default. */
  section?: 'basic' | 'advanced'
  required?: boolean
  placeholder?: string
  min?: number
  max?: number
  step?: number
  /**
   * `metadata` → the core persists it into `products.metadata` for free.
   * `table`    → the plugin owns a `plg_<id>_*` table and handles persistence
   *              itself through the API it registers.
   */
  storage: 'metadata' | 'table'
  /** Return an error string to block save, or null to accept. */
  validate?: (value: unknown, product: ProductDraft) => string | null
  /** Hide the field unless the product already warrants it. */
  visible?: (product: ProductDraft) => boolean
  format?: (value: unknown) => string
  /** Set by the host. Never author this. */
  source?: string
}

/**
 * The shape the product form hands to field validators. Core columns are
 * typed; plugin-owned values arrive in `metadata`.
 */
export interface ProductDraft {
  id?: string
  name: string
  sku?: string | null
  price: number | null
  cost_price: number | null
  track_stock: boolean
  metadata: Record<string, unknown>
  [extra: string]: unknown
}

// ── Entities, permissions, reports, settings ──────────────────────────────

export interface EntityDefinition {
  id: string
  label: string
  icon: string
  route: string
  permission?: string
  order?: number
  /** Set by the host. Never author this. */
  source?: string
}

export interface PermissionDefinition {
  key: string
  label: string
  group: string
  description?: string
  /** Set by the host. Never author this. */
  source?: string
}

export interface ReportDefinition {
  id: string
  label: string
  icon: string
  permission?: string
  render: () => HTMLElement | Promise<HTMLElement>
  /** Set by the host. Never author this. */
  source?: string
}

export interface SettingsSectionDefinition {
  id: string
  label: string
  icon: string
  permission?: string
  render: () => HTMLElement | Promise<HTMLElement>
  /** Set by the host. Never author this. */
  source?: string
}

export interface ShortcutDefinition {
  /** e.g. `F2`, `Ctrl+K`, `Ctrl+Shift+P` */
  combo: string
  action: string
  label: string
  handler: () => void
  /** Set by the host. Never author this. */
  source?: string
}

// ── Services handed to plugins ────────────────────────────────────────────

/**
 * Namespaced key/value storage. Backed by localStorage in Phase 1 and by the
 * RLS-protected `plugin_data` table in Phase 6 — the interface is already
 * plugin-scoped so the swap is invisible to plugin authors.
 */
export interface PluginStorage {
  get<T>(key: string, fallback: T): T
  set(key: string, value: unknown): void
  delete(key: string): void
  keys(): string[]
}

export interface Logger {
  debug(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  error(message: string, detail?: unknown): void
}

/**
 * What a plugin can reach. Deliberately narrow: no fetch, no Supabase client,
 * no router navigation, no access to other plugins. Anything a plugin needs
 * beyond this must be added here explicitly, which keeps the surface reviewable.
 */
export interface PluginAPI {
  readonly pluginId: string
  readonly events: EventBus
  readonly storage: PluginStorage
  readonly log: Logger

  registerNav(item: NavItem): void
  registerProductField(field: ProductField): void
  registerEntity(entity: EntityDefinition): void
  registerPermission(permission: PermissionDefinition): void
  registerReport(report: ReportDefinition): void
  registerSettingsSection(section: SettingsSectionDefinition): void
  registerShortcut(shortcut: ShortcutDefinition): void
}

export interface Plugin {
  /** Stable identifier. Also the permission namespace and the storage prefix. */
  id: string
  name: string
  version: string
  description?: string
  icon?: string
  /** Plugin ids that must load first. Cycles are rejected at load time. */
  dependencies?: string[]
  register(api: PluginAPI): void | Promise<void>
  /** Called on logout and on unload. Must release timers and listeners. */
  dispose?(): void
}

export type PluginStatus = 'declared' | 'loaded' | 'error' | 'skipped'

export interface PluginRegistration {
  plugin: Plugin
  status: PluginStatus
  error?: string
  loadedAt?: string
}
