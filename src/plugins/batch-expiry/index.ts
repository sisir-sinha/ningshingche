/**
 * Batch & expiry — behaviour.
 *
 * Relevant to pharmacy, grocery, cosmetics and anything else that sells
 * perishable stock. It is also this architecture's acceptance test: the file
 * imports nothing from `src/features/` and nothing from another plugin. It
 * receives a `PluginAPI` and describes what it wants; the core renders it.
 *
 * If adding this plugin ever requires editing a file under `src/features/`,
 * the architecture has failed (spec §51).
 */

import { stat } from '../../components/ui/card'
import { h, srOnly } from '../../components/ui/h'
import type {
  Plugin,
  PluginDb,
  PluginPageModule,
  ProductDraft,
  ProductField,
  ProductSnapshot,
} from '../../shared/registry/plugin-types'
import { BATCH_KEY, DEFAULT_WARNING_DAYS, EXPIRY_KEY, batchExpiryManifest } from './manifest'

const MS_PER_DAY = 86_400_000

export function daysUntil(value: unknown, now: number = Date.now()): number | null {
  if (value === null || value === undefined || value === '') return null
  const when = new Date(String(value))
  if (Number.isNaN(when.getTime())) return null
  return Math.ceil((when.getTime() - now) / MS_PER_DAY)
}

/** Reads this plugin's fields out of a product draft, via `products.metadata`. */
export function readBatchFields(draft: ProductDraft): {
  batchNumber: string | null
  expiryDate: string | null
} {
  const batch = draft.metadata[BATCH_KEY]
  const expiry = draft.metadata[EXPIRY_KEY]
  return {
    batchNumber: typeof batch === 'string' && batch !== '' ? batch : null,
    expiryDate: typeof expiry === 'string' && expiry !== '' ? expiry : null,
  }
}

/** Products whose expiry falls inside the warning window, soonest first. */
export function expiringSoon(
  products: readonly ProductSnapshot[],
  warningDays: number,
  now: number = Date.now()
): Array<{ product: ProductSnapshot; days: number }> {
  const out: Array<{ product: ProductSnapshot; days: number }> = []
  for (const product of products) {
    const days = daysUntil(product.metadata[EXPIRY_KEY], now)
    if (days === null || days > warningDays) continue
    out.push({ product, days })
  }
  return out.sort((a, b) => a.days - b.days)
}

export function describeExpiry(days: number): {
  label: string
  tone: 'danger' | 'warning' | 'neutral'
} {
  if (days < 0) return { label: `Expired ${Math.abs(days)} day(s) ago`, tone: 'danger' }
  if (days === 0) return { label: 'Expires today', tone: 'danger' }
  if (days <= 7) return { label: `${days} day(s) left`, tone: 'warning' }
  return { label: `${days} day(s) left`, tone: 'neutral' }
}

export const batchExpiryPlugin: Plugin = {
  id: batchExpiryManifest.id,
  name: batchExpiryManifest.name,
  version: batchExpiryManifest.version,
  description: batchExpiryManifest.description,
  ...(batchExpiryManifest.icon ? { icon: batchExpiryManifest.icon } : {}),

  register(api) {
    // ── Product fields ──────────────────────────────────────────────────
    // `storage: 'metadata'` means the core persists these into
    // products.metadata with no plugin-owned table and no extra code.

    const batchField: ProductField = {
      key: BATCH_KEY,
      label: 'Batch number',
      type: 'text',
      section: 'advanced',
      storage: 'metadata',
      placeholder: 'e.g. BT-2026-0142',
    }

    const expiryField: ProductField = {
      key: EXPIRY_KEY,
      label: 'Expiry date',
      type: 'date',
      section: 'advanced',
      storage: 'metadata',
      validate: (value: unknown) => {
        if (value === null || value === undefined || value === '') return null
        return daysUntil(value) === null ? 'Enter a valid date.' : null
      },
      format: (value: unknown) => {
        const days = daysUntil(value)
        return days === null ? '—' : describeExpiry(days).label
      },
    }

    api.registerProductField(batchField)
    api.registerProductField(expiryField)

    // ── A permission of its own ─────────────────────────────────────────
    // Namespaced with the plugin id, so it can never collide with a core key
    // or with another plugin's.
    api.registerPermission({
      key: `${api.pluginId}.adjust`,
      label: 'Edit batch and expiry details',
      group: 'inventory',
      description: 'Allows editing batch numbers and expiry dates on products.',
    })

    // ── Navigation, and the screen behind it ────────────────────────────
    // The route is a lazy import, so a disabled plugin ships no page code to
    // the browser at all (docs/05 §1).
    api.registerNav({
      id: 'batch-expiry',
      label: 'Expiry Watch',
      icon: 'event_busy',
      section: 'inventory',
      route: '/plugins/batch-expiry',
      permission: 'inventory.view',
      order: 35,
    })

    api.registerRoute({
      path: '/plugins/batch-expiry',
      title: 'Expiry Watch',
      permission: 'inventory.view',
      load: async (): Promise<PluginPageModule> => {
        const page = await import('./expiry-watch')
        return page.create({
          db: api.db,
          warningDays: () => api.settings.get<number>('warning_days', DEFAULT_WARNING_DAYS),
        })
      },
    })

    // ── A dashboard widget ──────────────────────────────────────────────
    api.registerDashboardWidget({
      id: 'batch-expiry.expiring',
      title: 'Expiring soon',
      size: 'sm',
      permission: 'inventory.view',
      render: () => expiringTile(api),
    })

    // ── A section inside the product form ───────────────────────────────
    // The fields above cover the common case; this shows what a plugin does
    // when it needs more than a field.
    api.registerFormSection({
      id: 'batch-expiry.summary',
      label: 'Batch & expiry',
      section: 'advanced',
      permission: 'inventory.view',
      render: (context) =>
        h(
          'p',
          { class: 'text-xs text-content-muted' },
          context.productId
            ? 'Batch and expiry are stored on this product and included in the Expiry Watch list.'
            : 'Fill in the batch and expiry fields above to include this product in Expiry Watch.'
        ),
    })

    api.log.debug('registered', {
      fields: [batchField.key, expiryField.key],
      permission: `${api.pluginId}.adjust`,
    })
  },
}

async function loadProducts(db: PluginDb): Promise<ProductSnapshot[]> {
  try {
    return await db.products()
  } catch {
    // A widget or page must never be the reason the screen fails to draw.
    return []
  }
}

async function expiringTile(api: {
  db: PluginDb
  settings: { get<T>(key: string, fallback: T): T }
}): Promise<HTMLElement> {
  const warningDays = api.settings.get<number>('warning_days', DEFAULT_WARNING_DAYS)
  const expiring = expiringSoon(await loadProducts(api.db), warningDays)
  const overdue = expiring.filter((entry) => entry.days <= 0).length

  return h(
    'div',
    { class: 'flex flex-col gap-2' },
    srOnly(`Expiring soon: ${expiring.length} product(s) inside ${warningDays} days`),
    stat('Expiring soon', String(expiring.length), {
      iconName: 'event_busy',
      tone: overdue > 0 ? 'danger' : 'neutral',
      hint: `inside ${warningDays} day(s)`,
    }),
    expiring.length > 0
      ? h(
          'p',
          { class: 'truncate text-xs text-content-muted' },
          `Next: ${expiring[0]?.product.name ?? ''} — ${describeExpiry(expiring[0]?.days ?? 0).label}`
        )
      : h('p', { class: 'text-xs text-content-muted' }, 'Nothing inside the warning window.')
  )
}

export default batchExpiryPlugin
