# 05 — Plugin Architecture

Your §5 interface is a reasonable starting point, but it has four problems
that would surface within a few months. They are fixed below.

| Problem in the draft | Fix |
|---|---|
| `enabled: boolean` on the plugin object | Enable-state is per-organization data in the `plugins` table. The plugin *definition* is static code. Mixing them means you can't render the Plugins admin page without executing plugin code. |
| `hooks?: PluginHook[]` as static data | Hooks need runtime access to services. Static arrays force plugins to import core internals to do anything — the exact coupling §51 forbids. |
| No `coreApiVersion` | A plugin built against core v1 loaded into core v2 breaks at runtime with an opaque error. |
| `initialize()` only | No way to tear down subscriptions, timers or Realtime channels on disable. Memory leak per enable/disable cycle. |
| No mechanism to extend the product model | The whole point of §8/§10/§57. Added as `productFields`. |

---

## 1. Manifest / behaviour split

The central decision: **a plugin is two things, and only one of them is code.**

```ts
// manifest.ts — PURE DATA. No imports from core. No side effects.
export const manifest = {
  id: 'pharmacy',
  name: 'Pharmacy',
  version: '1.0.0',
  coreApiVersion: '^1.0.0',
  description: 'Batch, expiry, prescription and controlled-drug support.',
  category: 'industry',
  // ...
} satisfies PluginManifest

// index.ts — BEHAVIOUR. Lazy loaded only when enabled.
import type { POSPlugin } from '@/core/plugins/sdk'
export default {
  manifest,
  async activate(ctx) { /* ... */ },
  async deactivate() { /* ... */ },
} satisfies POSPlugin
```

Why this matters concretely:

- The **Plugins admin page** lists all plugins with names, versions,
  descriptions and dependency status by importing only manifests — a few
  hundred bytes each.
- **Dependency resolution** happens before any plugin code runs, so a
  circular dependency is a clean error message, not a stack overflow.
- A **disabled plugin costs nothing** at runtime. Its `index.ts` and pages
  are separate dynamic-import chunks that never load.

---

## 2. The manifest

```ts
type PluginCategory = 'core' | 'optional' | 'industry'

interface PluginManifest {
  /** Stable, never changes. Used as the DB key and CSS/SQL namespace. */
  readonly id: string
  readonly name: string
  /** Semver of this plugin. */
  readonly version: string
  /** Semver range of the core plugin API this plugin requires. */
  readonly coreApiVersion: string
  readonly description: string
  readonly category: PluginCategory
  readonly author?: string
  readonly icon?: IconRef

  /** Plugin IDs that must be enabled first. Loaded in topological order. */
  readonly dependencies?: readonly string[]
  /** Plugins that conflict — enabling both is an error. */
  readonly conflicts?: readonly string[]

  /** Permissions this plugin contributes. Always namespaced `id.*`. */
  readonly permissions?: readonly PermissionDefinition[]

  /** Sidebar contributions. */
  readonly navigation?: readonly NavigationNode[]

  /** Route contributions. Lazy — the loader only gets the import thunk. */
  readonly routes?: readonly RouteDefinition[]

  /** Ctrl+K contributions. */
  readonly commands?: readonly CommandDefinition[]

  /** Keyboard shortcuts. */
  readonly shortcuts?: readonly ShortcutDefinition[]

  /** Dashboard widget contributions. */
  readonly dashboardWidgets?: readonly WidgetDefinition[]

  /** Settings schema — rendered automatically under Settings → this plugin. */
  readonly settingsSchema?: readonly SettingField[]

  /** Product form field extensions. The key extension point. */
  readonly productFields?: readonly ProductFieldExtension[]

  /** Customer/supplier field extensions, same mechanism. */
  readonly customerFields?: readonly EntityFieldExtension[]

  /** Event types this plugin publishes, for documentation and validation. */
  readonly events?: readonly string[]

  /** SQL migrations shipped with the plugin, applied on enable. */
  readonly migrations?: readonly string[]

  /** Can a shop owner disable this without losing data? */
  readonly dataOwnership?: 'transient' | 'persistent'
}
```

---

## 3. The plugin contract

```ts
interface POSPlugin {
  readonly manifest: PluginManifest
  /** Called once when enabled. Synchronous registration + async setup. */
  activate(ctx: PluginContext): void | Promise<void>
  /** Called on disable, logout, or hot reload. Must release everything. */
  deactivate?(): void | Promise<void>
}
```

`deactivate` is not optional in spirit. Anything a plugin subscribes to, it
must be able to unsubscribe from. The context hands out disposer-returning
registration functions precisely so this is mechanical:

```ts
const disposers: Array<() => void> = []

activate(ctx) {
  disposers.push(ctx.events.on('sale.completed', onSale))
  disposers.push(ctx.navigation.add(myNavNode))
  disposers.push(ctx.commands.register(myCommand))
}

deactivate() {
  disposers.forEach(d => d())
  disposers.length = 0
}
```

---

## 4. The PluginContext

The only surface a plugin may touch. It is injected, never imported — which
is what makes the module boundary in [03](./03-project-structure.md) §3
enforceable rather than aspirational.

```ts
interface PluginContext {
  /** This plugin's manifest, plus its resolved config. */
  readonly plugin: { id: string; config: Readonly<Record<string, unknown>> }

  /** Subscribe and emit. Handlers must be idempotent (doc 02 §3). */
  readonly events: EventBus

  /** Sidebar contributions. */
  readonly navigation: {
    add(node: NavigationNode): Dispose
    addGroup(group: NavigationGroup): Dispose
  }

  /** Ctrl+K contributions. */
  readonly commands: {
    register(cmd: CommandDefinition): Dispose
  }

  /** Route contributions. */
  readonly routes: {
    add(route: RouteDefinition): Dispose
  }

  /** Permission checks. Never grants. */
  readonly permissions: {
    has(key: string): boolean
  }

  /** Dashboard widgets. */
  readonly widgets: {
    register(widget: WidgetDefinition): Dispose
  }

  /** Typed, org-scoped settings for this plugin only. */
  readonly settings: {
    get<T>(key: string, fallback: T): T
    set(key: string, value: unknown): Promise<void>
    onChange(handler: (key: string, value: unknown) => void): Dispose
  }

  /**
   * Data access. Scoped to the current organization and branch automatically —
   * a plugin cannot construct a cross-tenant query even by trying.
   * Writes to stock/money must go through `rpc`, never direct table inserts.
   */
  readonly db: {
    from<T extends keyof PluginTables>(table: T): QueryBuilder<PluginTables[T]>
    rpc<T extends keyof PluginFunctions>(fn: T, args: PluginArgs[T]): Promise<PluginResult[T]>
  }

  /** Register custom UI into core-owned surfaces. */
  readonly ui: {
    /** Adds a section to the product form (where productFields aren't enough). */
    registerProductFormSection(section: FormSection): Dispose
    /** Adds a panel to the POS screen (e.g. repair status strip). */
    registerPOSPanel(panel: POSPanel): Dispose
    /** Adds a tab to the sale detail view. */
    registerSaleTab(tab: TabDefinition): Dispose
  }

  readonly i18n: {
    t(key: string, vars?: Record<string, unknown>): string
    addTranslations(locale: string, dict: Record<string, string>): void
  }

  readonly logger: Logger
  readonly storage: {                          // Supabase Storage, org-scoped prefix
    upload(path: string, file: File): Promise<string>
  }
  readonly session: {                          // read-only
    organizationId: string
    branchId: string
    userId: string
    currency: string
    timezone: string
  }
}
```

### What a plugin deliberately cannot do

| Cannot | Why |
|---|---|
| Import another plugin | Composition is via `dependencies` + events. Direct imports create the coupling graph §51 warns about. |
| Call `supabase.from('sales').insert()` | Not in the context. Sales go through `complete_sale`. |
| Read another organization's rows | `ctx.db` is pre-scoped; RLS is the backstop. |
| Grant permissions | `permissions.has()` only. Grants are an admin action in core. |
| Register a core permission key | Plugin permission keys are validated to start with `<plugin.id>.` on load. |
| Block another plugin's event handler | Handlers run in priority order and are isolated; a throw is logged and the next handler runs. |

---

## 5. Product field extensions

This is the mechanism that makes one product form serve every industry
(§8, §10, §57).

```ts
interface ProductFieldExtension {
  /** Unique within the plugin. Stored as `<pluginId>.<id>` in metadata. */
  readonly id: string
  readonly label: string
  readonly type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect' | 'textarea'
  readonly options?: readonly { value: string; label: string }[]

  /** Progressive disclosure. 'basic' fields are always visible. */
  readonly section: 'basic' | 'advanced' | 'inventory' | 'pricing'

  readonly required?: boolean
  readonly placeholder?: string
  readonly helpText?: string
  readonly defaultValue?: unknown

  /** Validation. */
  readonly validation?: {
    min?: number
    max?: number
    pattern?: string
    message?: string
  }

  /**
   * Where the value lives.
   *   'metadata' — products.metadata jsonb. Cheap, sparse, not indexed.
   *   table      — plugin-owned column, for fields that are queried or indexed.
   */
  readonly storage:
    | { kind: 'metadata' }
    | { kind: 'table'; table: string; column: string }

  /** Show in the POS product info popover? */
  readonly showInPOS?: boolean
  /** Include in CSV import/export? */
  readonly importable?: boolean
  /** Include on the printed receipt? */
  readonly printable?: boolean
  /** Sort within its section. */
  readonly order?: number
}
```

### Worked example — Pharmacy

```ts
productFields: [
  { id: 'salt_composition', label: 'Salt / Composition', type: 'text',
    section: 'advanced', storage: { kind: 'metadata' }, importable: true },

  { id: 'dosage_form', label: 'Dosage Form', type: 'select', section: 'advanced',
    options: [
      { value: 'tablet', label: 'Tablet' },
      { value: 'capsule', label: 'Capsule' },
      { value: 'syrup', label: 'Syrup' },
      { value: 'injection', label: 'Injection' },
    ],
    storage: { kind: 'metadata' } },

  { id: 'strength', label: 'Strength', type: 'text', section: 'advanced',
    storage: { kind: 'metadata' } },

  { id: 'requires_prescription', label: 'Prescription Required', type: 'boolean',
    section: 'advanced', defaultValue: false,
    storage: { kind: 'metadata' } },

  { id: 'controlled_schedule', label: 'Controlled Drug Schedule', type: 'select',
    section: 'advanced',
    options: [
      { value: 'none', label: 'Not controlled' },
      { value: 'ii', label: 'Schedule II' },
      { value: 'iii', label: 'Schedule III' },
    ],
    storage: { kind: 'metadata' } },
]
```

The core product form has never heard of "salt composition." It renders a
text input in the Advanced section because the descriptor says so. Add a
Bookstore plugin and the same form grows `isbn`, `author`, `publisher` — with
zero core changes.

### How the form consumes it

```ts
// features/products/components/product-form.ts
const basic    = coreFields.filter(f => f.section === 'basic')
const advanced = [...coreAdvancedFields, ...fieldRegistry.forSection('advanced')]

render(basic)
render(collapsible('+ Advanced Options', () => render(advanced)))
```

`+ Advanced Options` stays closed by default. A shop owner creating "Milk 1
Litre" sees five fields. A pharmacist creating a controlled drug expands it
and sees fifteen more. §57 satisfied by construction, not by discipline.

---

## 6. Registry, loading, dependencies

```ts
class PluginRegistry {
  private readonly manifests = new Map<string, PluginManifest>()
  private readonly active = new Map<string, POSPlugin>()

  register(manifest: PluginManifest): void
  /** Topological order, filtered to enabled, with dependency closure. */
  resolveLoadOrder(enabledKeys: string[]): ResolutionResult
  async activateAll(ctxFactory: (id: string) => PluginContext): Promise<void>
  async deactivate(id: string): Promise<void>
}

interface ResolutionResult {
  order: string[]
  /** Requested but unavailable — surfaced in the UI, not thrown. */
  missing: Array<{ plugin: string; missingDependency: string }>
  cycles: string[][]
  incompatible: Array<{ plugin: string; required: string; actual: string }>
}
```

### Resolution algorithm

```
1. Load every manifest (cheap).
2. Read `plugins` table → set of enabled keys for this organization.
3. Expand: for each enabled plugin, add its `dependencies` transitively.
     A dependency that is disabled is auto-enabled (it cannot be turned off
     while something depends on it — the UI greys out its toggle).
4. Detect cycles (Tarjan). Report, do not crash.
5. Check `coreApiVersion` against the running core version with a semver
   range test. Incompatible plugins are skipped and listed in the UI.
6. Check `conflicts`. Report.
7. Topologically sort.
8. Apply pending migrations for newly enabled plugins (see §8).
9. activate() in order. An activation failure marks that plugin 'error',
   continues with the rest, and reports it.
```

Step 9 is deliberate: **one broken plugin must not take down the shop's
POS.** A plugin that throws on load is quarantined and shown in
Settings → Plugins with its error.

---

## 7. The `registerPlugin` SDK

Your §52 sketch, refined:

```ts
import { definePlugin } from '@/core/plugins/sdk'

export default definePlugin({
  manifest,

  activate(ctx) {
    // 1. React to core events
    ctx.events.on('sale.completed', {
      priority: 100,
      handler: async (sale) => { /* award loyalty points */ },
    })

    // 2. Contribute navigation
    ctx.navigation.add({
      id: 'loyalty.accounts',
      parentId: 'customers',
      label: ctx.i18n.t('loyalty.nav.accounts'),
      icon: { set: 'material', name: 'card_membership' },
      path: '/loyalty/accounts',
      permission: 'loyalty.view',
      order: 30,
    })

    // 3. Contribute routes (lazy)
    ctx.routes.add({
      path: '/loyalty/accounts',
      permission: 'loyalty.view',
      load: () => import('./pages/accounts'),
    })

    // 4. Contribute a command
    ctx.commands.register({
      id: 'loyalty.lookup',
      title: 'Look up loyalty account',
      icon: { set: 'material', name: 'search' },
      keywords: ['points', 'member'],
      run: () => ctx.routes.go('/loyalty/accounts'),
    })

    // 5. Contribute a dashboard widget
    ctx.widgets.register({
      id: 'loyalty.summary',
      title: 'Loyalty',
      size: 'sm',
      load: () => import('./widgets/summary'),
    })
  },

  deactivate() { /* disposers run */ },
})
```

`definePlugin` is a typed identity function whose only runtime job is to
validate the manifest and freeze it. It gives plugin authors autocomplete and
a compile-time guarantee that they used the real API.

---

## 8. Plugin migrations

Plugins ship SQL. Applied when a plugin is enabled, recorded so it runs once.

```sql
CREATE TABLE plugin_migrations (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plugin_key      text NOT NULL,
  version         text NOT NULL,
  filename        text NOT NULL,
  checksum        text NOT NULL,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, plugin_key, filename)
);
```

Applied by an Edge Function using the service role, because the browser
cannot run DDL. Flow:

```
User clicks "Enable" in Settings → Plugins
  → POST /functions/v1/plugin-enable  { pluginKey, version }
  → Edge Function (service role):
       verify checksum against the shipped manifest
       apply pending migrations in filename order inside a transaction
       insert into plugins (enabled = true)
       insert into permissions for any new plugin permissions
  → client reloads plugin set and re-runs resolution
```

**Plugin tables must carry `organization_id` and RLS.** The Edge Function
inspects each created table and refuses the migration if either is missing —
a plugin cannot accidentally create a world-readable table.

---

## 9. Versioning and compatibility

```
core plugin API version:  1.0.0
plugin declares:          coreApiVersion: '^1.0.0'
```

| Core | Plugin range | Result |
|---|---|---|
| 1.2.0 | `^1.0.0` | Load |
| 1.0.0 | `^1.1.0` | Skip — plugin needs a newer core |
| 2.0.0 | `^1.0.0` | Skip — breaking core change |

Core API changes follow semver: adding a context method is minor, changing a
signature is major. The `PluginContext` type is the contract; it lives in
`core/plugins/sdk.ts` and is the single file whose stability the whole
ecosystem depends on.

The `plugins` table records the installed version per organization, so a shop
on an old plugin version keeps working until its admin updates.

---

## 10. Plugin settings

Declared in the manifest, rendered by core, stored per organization:

```ts
settingsSchema: [
  { key: 'pointsPerCurrency', label: 'Points per currency unit',
    type: 'number', default: 1, min: 0, step: 0.1,
    helpText: 'How many points a customer earns per 1 unit of currency spent.' },
  { key: 'redemptionRate', label: 'Redemption rate',
    type: 'number', default: 100, min: 1,
    helpText: 'Points needed to equal 1 unit of currency.' },
  { key: 'roundToTier', label: 'Round points up to tier', type: 'boolean',
    default: false },
]
```

Core renders this under Settings → Plugins → Loyalty with validation from the
schema. The plugin reads values with `ctx.settings.get('pointsPerCurrency', 1)`
— never by querying the settings table itself.

This is why §36 ("plugin settings appear automatically") needs no special
casing in the Settings feature.

---

## 11. What is and isn't in scope for v1

| Capability | v1 | Later |
|---|---|---|
| Manifest + registry + load order | ✅ | |
| Event subscriptions | ✅ | |
| Navigation, routes, commands, widgets | ✅ | |
| Permissions contributions | ✅ | |
| Product field extensions | ✅ | |
| Settings schema | ✅ | |
| Plugin migrations via Edge Function | ✅ | |
| Custom form sections / POS panels | ✅ (minimal) | Richer slot system |
| Remote / third-party plugins | ❌ | Signed bundles from a registry |
| Plugin marketplace | ❌ | |
| Sandboxing (iframe / worker isolation) | ❌ | Required before third-party plugins |
| Plugin-to-plugin APIs | ❌ | Only if a real need appears |

The remote-plugin row is the important boundary. Everything above assumes
plugins are **first-party code in the same bundle**. Letting strangers ship
code requires sandboxing, CSP, capability revocation and a review process.
That is a different project, and the design above does not preclude it —
the context object is already a capability object rather than a global import.
