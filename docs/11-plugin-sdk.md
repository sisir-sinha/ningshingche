# Writing a Mekholi plugin

*A plugin adds a capability a shop can switch on. This is the contract; the two
plugins in `src/plugins/` are the worked examples.*

---

## The one rule

> **Never re-implement universal functionality inside a plugin (spec §51).**

A plugin may not import from `src/features/`, may not import another plugin, and
may not hold a Supabase client. It receives a `PluginAPI`, describes what it
wants, and the core draws it. This is not a convention: `tools/check-boundaries.mjs`
resolves every import in `src/plugins/**` and fails the build if one crosses a
line. Running `npm run check` before you finish tells you the same thing a
reviewer would.

```
src/plugins/<your-plugin>/
  manifest.ts   ← pure data: what it is, what it needs, what it may do
  index.ts      ← behaviour: register(api) and nothing else
  <anything>.ts ← your own modules — nobody outside your folder imports them
```

`manifest.ts` is imported at boot for **every** plugin, enabled or not, because
the Plugins screen has to list it. `index.ts` is a dynamic import the registry
calls only when the shop switches the plugin on, so a disabled plugin ships no
behaviour and costs nothing.

---

## 1. The manifest

```ts
import type { PluginManifest } from '../../shared/registry/plugin-types'

export const MY_KEY = 'warranty.expires_on'

export const myManifest: PluginManifest = {
  id: 'warranty',                     // also your permission namespace and table prefix
  name: 'Warranty',
  version: '1.0.0',
  coreApiVersion: '^1.0.0',           // the API you were written against
  category: 'industry',               // 'core' | 'optional' | 'industry'
  icon: 'verified_user',              // Material Symbols Rounded ligature
  description: 'One sentence a shopkeeper would recognise as useful.',
  dataOwnership: 'persistent',        // disabling keeps the shop's data (the default)
  dependencies: ['batch-expiry'],     // other plugin ids; they load first, and
                                      // cannot be disabled while you are on
  conflicts: [],
  permissions: [
    {
      key: 'warranty.manage',         // MUST start with '<id>.' — see below
      label: 'Manage warranties',
      category: 'products',
      description: 'What the role may do.',
    },
  ],
  settingsSchema: [
    {
      key: 'default_months',
      label: 'Default warranty length (months)',
      type: 'number',
      default: 12,
      min: 1,
      max: 120,
      helpText: 'Shown in the product form; the shop can change it per product.',
    },
  ],
}
```

**Permissions must be namespaced to you.** `warranty.manage` is yours;
`settings.manage` is refused at load with a readable error, because a plugin
that could mint a core key would inherit grants the shop never gave it
(docs/07 §3). The same rule is enforced in the database when the plugin is
enabled, so a manifest edited to lie cannot get further than the client.

**Settings are declared, not drawn.** `settingsSchema` is rendered by the core
into the plugin's settings form, stored in `plugins.config`, and readable
through `api.settings`. Add a field and it appears; there is no form to write.

---

## 2. The behaviour

```ts
import { h } from '../../components/ui/h'
import type { Plugin, PanelContext } from '../../shared/registry/plugin-types'
import { MY_KEY, myManifest } from './manifest'

const myPlugin: Plugin = {
  id: myManifest.id,
  name: myManifest.name,
  version: myManifest.version,

  register(api) {
    // Read your settings — never hard-code what a shop should decide.
    const months = api.settings.get<number>('default_months', 12)

    // A field on the product form. `metadata` means the core persists it into
    // products.metadata for free; `table` means you own a plg_warranty_* table
    // and handle saving yourself.
    api.registerProductField({
      key: MY_KEY,
      label: 'Warranty ends',
      type: 'date',
      section: 'advanced',        // 'basic' shows immediately, 'advanced' is collapsed
      storage: 'metadata',
      showInPOS: true,            // the cashier sees it on the till
      printable: true,            // and it prints under the line on the receipt
      importable: true,           // and travels in product CSV import/export
      validate: (value) => (value && Number.isNaN(Date.parse(String(value))) ? 'Enter a valid date.' : null),
      format: (value) => new Date(String(value)).toLocaleDateString('en-GB'),
    })

    // Something a shopkeeper opens. The route is a lazy import, so nothing of
    // your screen is sent to a browser until someone clicks it.
    api.registerNav({
      id: myManifest.id,
      label: 'Warranties',
      icon: 'verified_user',
      section: 'inventory',
      route: '/plugins/warranty',
      permission: 'warranty.manage',
      order: 40,
    })
    api.registerRoute({
      path: '/plugins/warranty',
      title: 'Warranties',
      permission: 'warranty.manage',
      load: async () => ({ default: () => h('div', { class: 'p-4' }, 'Your screen here.') }),
    })

    // A tile on the dashboard, a panel beside the cart, a tab on a sale.
    api.registerDashboardWidget({
      id: 'warranty.active',
      title: 'Warranties running',
      size: 'sm',
      permission: 'warranty.manage',
      render: async () => h('p', { class: 'text-2xl font-semibold' }, String(await countActive(api))),
    })
    api.registerPOSPanel({
      id: 'warranty.pos',
      label: 'Warranty',
      permission: 'warranty.manage',
      render: async (context: PanelContext) => h('p', { class: 'text-xs' }, `Cart total: ${context.total ?? 0}`),
    })

    // React to the shop happening. Events are delivered at-least-once, so make
    // your handler idempotent on `event.id` — the same sale arrives once
    // locally and again over Realtime.
    api.events.on('sale.completed', (event) => {
      if (!api.settings.get<boolean>('auto_register', false)) return
      // event.data carries numbers as text, exactly as Postgres returned them.
      const total = Number(event.data.total)
      void api.db
        .rpc('register', { sale_id: event.data.sale_id, total })
        .catch((error) => api.log.warn('warranty not registered', error))
    })

    api.log.debug('registered', { months })
  },

  // Optional. Called on logout and when the plugin is switched off: release
  // timers, intervals and listeners you created outside `api.events`.
  dispose() {},
}

export default myPlugin
```

---

## 3. What the host gives you

| On `api` | What it is | Notes |
| --- | --- | --- |
| `api.pluginId` | your id | prefix anything you store with it |
| `api.settings` | org-scoped settings, backed by `plugins.config` | `get(key, fallback)`, `all()`, `set(key, value)` |
| `api.data` | org-scoped storage, backed by the RLS-protected `plugin_data` table | `get/set/remove/keys`, all async; values are JSON |
| `api.db.products()` | the one read projection over core data | id, name, sku, price, track_stock, is_active, reorder_point, metadata |
| `api.db.rpc(fn, args)` | your own server functions | `db.rpc('register', {…})` calls `public.<id>_register($1, $2)` |
| `api.events` | the app's event bus | `on('sale.completed' \| 'sale.refunded' \| 'stock.changed' \| …, handler)` |
| `api.log` | namespaced logger | `debug/info/warn/error`, always prefixed with your id |
| `api.storage` | per-device scratch space | for UI preferences only — never shop data |

**Any other core table is not yours to read.** If you need something the
projection does not carry, ask for it in the projection rather than working
around it: a plugin with a database handle would be a plugin with every shop's
data.

### Your own server functions

Write them in a migration (`supabase/migrations/<n>_<name>.sql`), in the
`public` schema, named `<id>_<fn>` with hyphens replaced by underscores, taking
`(p_organization_id uuid, p_args jsonb)`. The bridge checks the name against
`pg_proc`, so a function that does not exist is refused rather than guessed at.
Inside the function, prove who is asking:

```sql
create or replace function public.warranty_register(p_organization_id uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform app.require_org(p_organization_id);        -- caller belongs to this shop
  perform app.require_permission('warranty.manage'); -- and may do this
  -- … your work …
  return jsonb_build_object('ok', true);
end
$fn$;

revoke all on function public.warranty_register(uuid, jsonb) from public;
grant execute on function public.warranty_register(uuid, jsonb) to authenticated;
```

If you own tables, name them `plg_warranty_<thing>`, give them
`organization_id`, turn RLS **on**, and add at least one policy. The server
checks exactly that when the plugin is enabled, and refuses the whole install if
any table you created breaks it — a plugin cannot half-install and it cannot
leak another shop's rows.

---

## 4. Shipping it

1. Add the manifest and a `load` to `SHIPPED_PLUGINS` in `src/app/plugins.ts`.
   That is the *only* core file a new plugin touches.
2. Seed the package in a migration: a row in `plugin_packages`, one row per SQL
   file in `plugin_package_migrations` (with `md5(sql)` as the checksum), and a
   row in `plugin_package_permissions` for each permission. The validator
   compares those rows with your manifest — id, version and every permission key
   — so the two cannot drift apart.
3. `npm run check`. It runs the type checker, the linter, the boundary rules,
   your tests, the migration validator (which replays every migration in a real
   Postgres and then exercises the plugin lifecycle) and a production build.
4. Switch it on in **Settings → Plugins**. It is switched on for one shop only;
   the preview that appears first names any role that would silently gain your
   permissions through a wildcard.

Checklist before you call it done:

- [ ] `manifest.id` matches your folder, your migration's `plugin_key`, and the
      prefix of every permission and table you own.
- [ ] Every handler that reacts to an event is idempotent on `event.id`.
- [ ] Every value that crosses the boundary is parsed, not trusted — an
      unexpected payload must not be able to break the core screen you decorate.
- [ ] Switching the plugin off leaves the app working, and switching it back on
      loses nothing.
- [ ] No import reaches into `src/features/`, another plugin, or an app store.
- [ ] Your screen renders for a role that holds only your permissions.

---

## 5. Why it is built this way

`docs/05-plugin-architecture.md` has the design and its reasoning;
`docs/07-permissions-architecture.md` §3–§4 covers namespacing and wildcard
impact; `docs/09-risks-and-decisions.md` records what was tried and abandoned.
The short version:

- **Descriptions, not code injection.** The core renders; the plugin describes.
  That is what keeps a plugin from needing a core edit to exist.
- **Declarative always, behavioural on demand.** The catalog is honest about a
  plugin that is switched off, and a switched-off plugin is not in the bundle
  the browser pays for.
- **The database is the boundary that holds.** Permissions, tables, tenancy and
  checksums are enforced in Postgres, because client-side rules are advice.
