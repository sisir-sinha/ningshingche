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
// Type-only, and only the two shapes a report is made of — those types already
// exist because the eleven built-in reports return them.
import type { ReportColumn, ReportRow } from '../repositories/contracts'

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
  /**
   * Show this value on the POS product tile — where a cashier deciding what to
   * ring up can act on it. Only meaningful for `storage: 'metadata'`, since
   * that is the value the catalogue carries to the till.
   */
  showInPOS?: boolean
  /**
   * Print this value under the line on the receipt (spec §32) — the batch
   * number a pharmacy needs on the slip, the warranty code a repair shop
   * quotes. The POS passes what it knows at the till; if the product was not
   * scanned in this session the line simply prints without it.
   */
  printable?: boolean
  /**
   * Include this value as a column in product CSV import/export (spec §14).
   *
   * Declared now, read by the CSV screen when it lands: the flag is part of a
   * plugin's contract with the core, and a plugin author should not have to
   * guess whether their field can travel.
   */
  importable?: boolean
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

/**
 * A report a plugin contributes to the *core* reports screen (spec §23, §31).
 *
 * A plugin does not draw its report. It returns the rows, and the host draws
 * them with the same table, the same totals chips, the same paging and the same
 * CSV/print/PDF exporters as the eleven built-in reports — so a shopkeeper
 * cannot tell which reports shipped with the app and which one arrived with an
 * add-on, and an export can never disagree with the screen it came from.
 *
 * That is a deliberate choice against `render: () => HTMLElement`: an element
 * would have been three lines shorter for a plugin and would have made the
 * export buttons above it useless, because they read a `ReportResult` rather
 * than a DOM node. A plugin that needs something other than a table owns a
 * screen instead — `registerRoute` is right there.
 */
export interface ReportDefinition {
  id: string
  label: string
  /** Material Symbols Rounded ligature name. */
  icon: string
  permission?: string
  /**
   * Library group, e.g. “Pharmacy”. Defaults to the plugin's own name, so a
   * one-report plugin has no decision to make here.
   */
  group?: string
  /** One line under the title — what the rows are, in the shopkeeper's words. */
  description?: string
  /**
   * Which core filters to show above the table. A windowed report that cannot
   * be searched should not be handed a search box that does nothing.
   * Defaults: `{ window: true, search: false }`.
   */
  filters?: { window?: boolean; search?: boolean }
  /** The rows for the filters the host passed in. */
  run: (context: ReportRunContext) => PluginReportResult | Promise<PluginReportResult>
  /** Set by the host. Never author this. */
  source?: string
}

/** What the host knows when it asks a plugin for a report. */
export interface ReportRunContext {
  /** `day` | `week` | `month` | `quarter` | `year` | `custom`. */
  period: string
  /** ISO dates, only when the shopkeeper picked a custom range. */
  from: string | null
  to: string | null
  /** What the shopkeeper typed in the search box, when the host shows one. */
  search: string
  /** The branch the till is on, when there is one. */
  branchId: string | null
  /** The page being drawn. A plugin may page on the server or return all rows. */
  limit: number
  offset: number
}

/**
 * What a plugin hands back. Deliberately smaller than the `ReportResult` the
 * host renders: the title, the label, the currency, the timestamp and the
 * paging facts are the host's business, because eleven reports must not each
 * decide what “1–25 of 431” means.
 *
 * Money is **minor units** in `rows` and `totals`, like every other report — a
 * float that has already been rounded once prints wrong.
 */
export interface PluginReportResult {
  columns: ReportColumn[]
  rows: ReportRow[]
  totals?: Record<string, number>
  /**
   * How many rows the filters match in total. Omit it when you returned them
   * all and the host will say so itself.
   */
  totalRows?: number
  /** Defaults to the shop's currency. */
  currency?: string
  /** Small print under the table — a window, a caveat, what is still missing. */
  note?: string
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

/**
 * Org-scoped plugin data (docs/05 §4). Asynchronous because it lives in the
 * database, not in the browser: the same plugin must see the same values from
 * an Android client (Phase 8), and per-device localStorage cannot do that.
 *
 * `storage` above stays synchronous and per-device; `data` is the shared one.
 */
export interface PluginDataStore {
  get<T>(key: string, fallback: T): Promise<T>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<boolean>
  keys(): Promise<string[]>
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
export interface DashboardWidgetDefinition {
  id: string
  title: string
  /** `sm` spans one tile, `wide` two — same scale as the core widgets. */
  size?: 'sm' | 'wide'
  permission?: string
  render: () => HTMLElement | Promise<HTMLElement>
  /** Set by the host. Never author this. */
  source?: string
}

/** Extra UI inside core-owned surfaces (docs/05 §5-§7). */
export interface PanelDefinition {
  id: string
  label: string
  permission?: string
  render: (context: PanelContext) => HTMLElement | Promise<HTMLElement>
  /** Set by the host. Never author this. */
  source?: string
}

export interface TabDefinition {
  id: string
  label: string
  permission?: string
  render: (context: PanelContext) => HTMLElement | Promise<HTMLElement>
  /** Set by the host. Never author this. */
  source?: string
}

export interface FormSectionDefinition {
  id: string
  label: string
  /** `advanced` sections live behind “+ Advanced options”. */
  section?: 'basic' | 'advanced'
  permission?: string
  render: (context: PanelContext) => HTMLElement | Promise<HTMLElement>
  /** Set by the host. Never author this. */
  source?: string
}

/**
 * A code the till scanned that the shop's own barcodes did not match.
 *
 * The till resolves a scan in three steps, and this is the middle one: the
 * shop's barcode table first (authoritative, and offline-cached), then the
 * plugins, then an ordinary search. A plugin in the middle is how a scale label
 * printed by the shop's own weighing machine — `2212340007504`, which is not a
 * product barcode and never will be — becomes a sale.
 *
 * A resolver **decodes and nothing else**: it answers with a code the core can
 * look up, not with a product. A plugin cannot invent a product the shop does
 * not sell, cannot price something the catalogue does not price, and needs no
 * access to the catalogue to be useful. `Gift Cards` turns a card number into
 * its own code, a weighing scale turns a label into its PLU.
 */
export interface ScanContext {
  organizationId: string
  branchId: string | null
  warehouseId: string
  currency: string
}

/** What a resolver decided a code means. */
export interface ScanMatch {
  /** The code the core should look up — usually a PLU. */
  lookupCode: string
  /** Sale units: `2.35` for a 2.350 kg label. Defaults to one. */
  quantity?: number
  /** Minor units per unit, when the label itself carried the price. */
  unitPriceMinor?: number
  /** One line for the cashier, e.g. `Scale label · 2.350 kg`. */
  note?: string
}

export interface ScanResolverDefinition {
  id: string
  /** Shown to the cashier when the code is recognised but cannot be sold. */
  label: string
  permission?: string
  /**
   * `null` means “not mine”. A resolver is asked on every scan that misses the
   * barcode table, so it must answer quickly and must not guess: a wrong answer
   * rings up the wrong product, which is worse than no answer at all.
   */
  resolve: (code: string, context: ScanContext) => ScanMatch | null | Promise<ScanMatch | null>
  /** Set by the host. Never author this. */
  source?: string
}

/**
 * One line of the till's cart, as a plugin may see it.
 *
 * A plugin that decorates a sale needs to know what is *on* the sale. Without
 * this a serial-number panel can offer a box to scan into and no way to say
 * which line the unit belongs to, and a promotions panel cannot see what the
 * customer is actually buying — both would have to guess from the total.
 *
 * Deliberately a projection and not the cart itself: no line ids, no
 * discounts, no tax breakdown, nothing a plugin could mutate. Quantity and
 * price are plain numbers, because a plugin has no business knowing about
 * milli-units, and `metadata` is the product's own — which is where a plugin's
 * registered product fields live.
 */
export interface PanelLine {
  variantId: string
  productId: string
  name: string
  variantName: string | null
  sku: string | null
  quantity: number
  unitPrice: number
  metadata: Record<string, unknown>
}

/**
 * What a slot's `render` receives. The ids are the ones the host is showing;
 * nothing here can read the database, which is what keeps a plugin's panel a
 * description of the sale rather than a second implementation of it.
 */
export interface PanelContext {
  organizationId: string
  branchId: string | null
  currency: string
  /** Present on sale-scoped slots (sale tab, POS panel with a cart). */
  saleId?: string
  customerId?: string | null
  total?: number
  /**
   * The cart, on the POS panel. Absent on slots that are not the till.
   *
   * A plugin's POS panel is re-drawn whenever the cart changes, so this is
   * always the cart in front of the cashier — and a plugin that keeps state
   * across those redraws keeps it in its own closure, not in the DOM.
   */
  lines?: readonly PanelLine[]
  /** Present on the product form. */
  productId?: string
}

/** A plugin's declarative description — data only, cheap to import. */
export interface PluginManifest {
  /** Stable id. Also the permission namespace and the SQL table prefix. */
  id: string
  name: string
  version: string
  /** Semver range of the core plugin API this plugin requires. */
  coreApiVersion: string
  description: string
  category: 'core' | 'optional' | 'industry'
  icon?: string
  author?: string
  dependencies?: readonly string[]
  conflicts?: readonly string[]
  permissions?: readonly PermissionDefinition[]
  settingsSchema?: readonly SettingField[]
  /** `persistent` means disabling keeps the shop's data (the default). */
  dataOwnership?: 'transient' | 'persistent'
}

export interface SettingField {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select'
  default?: unknown
  min?: number
  max?: number
  step?: number
  options?: readonly FieldOption[]
  placeholder?: string
  helpText?: string
}

export interface PluginAPI {
  readonly pluginId: string
  readonly events: EventBus
  readonly storage: PluginStorage
  readonly log: Logger

  /** Org-scoped settings, backed by `plugins.config`. */
  readonly settings: PluginSettings
  /** Org-scoped data, backed by `plugin_data` (the RLS-protected table). */
  readonly data: PluginDataStore
  /** Core reads and the plugin's own RPCs. */
  readonly db: PluginDb

  registerNav(item: NavItem): void
  registerProductField(field: ProductField): void
  registerEntity(entity: EntityDefinition): void
  registerPermission(permission: PermissionDefinition): void
  registerReport(report: ReportDefinition): void
  registerSettingsSection(section: SettingsSectionDefinition): void
  registerShortcut(shortcut: ShortcutDefinition): void
  registerDashboardWidget(widget: DashboardWidgetDefinition): void
  registerScanResolver(resolver: ScanResolverDefinition): void
  registerPOSPanel(panel: PanelDefinition): void
  registerSaleTab(tab: TabDefinition): void
  registerFormSection(section: FormSectionDefinition): void
  registerRoute(route: RouteDefinition): void
}

/**
 * The narrow data surface a plugin gets (docs/05 §4). Reads go through one
 * projection; writes go through the plugin's own functions by name. A plugin
 * cannot name a core table or a core RPC here — the host would not forward it.
 */
export interface PluginDb {
  products(): Promise<ProductSnapshot[]>
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>
}

export interface ProductSnapshot {
  id: string
  name: string
  sku: string | null
  price: number | null
  track_stock: boolean
  is_active: boolean
  reorder_point: number | null
  metadata: Record<string, unknown>
}

/** A screen a plugin contributes. Loaded lazily, like everything else. */
export interface PluginPageContext {
  params: Record<string, string>
  query: URLSearchParams
  organizationId: string
  branchId: string | null
  currency: string
}

export interface PluginPageModule {
  render: (ctx: PluginPageContext) => HTMLElement | Promise<HTMLElement>
}

export interface RouteDefinition {
  path: string
  title: string
  permission?: string
  load: () => Promise<PluginPageModule>
  /** Set by the host. Never author this. */
  source?: string
}

export interface PluginSettings {
  get<T>(key: string, fallback: T): T
  all(): Readonly<Record<string, unknown>>
  set(key: string, value: unknown): Promise<void>
}

/** A plugin as shipped in this bundle: cheap manifest plus a lazy body. */
export interface ShippedPlugin {
  manifest: PluginManifest
  /** Only called when the plugin is enabled — a disabled plugin costs nothing. */
  load: () => Promise<Plugin>
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

export type PluginStatus =
  | 'disabled'
  | 'loaded'
  | 'error'
  | 'incompatible'
  | 'blocked'

export interface PluginRegistration {
  id: string
  manifest: PluginManifest
  status: PluginStatus
  error?: string
  loadedAt?: string
}
