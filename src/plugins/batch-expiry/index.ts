/**
 * Batch & expiry tracking plugin.
 *
 * Relevant to pharmacy, grocery, cosmetics and any shop that sells perishable
 * stock. It exists in Phase 1 for a specific reason: it is the acceptance test
 * for the architecture. This file imports nothing from `src/features/` and
 * nothing from another plugin — it receives a `PluginAPI` and describes what
 * it wants. The core renders it.
 *
 * If adding this plugin ever requires editing a file under `src/features/`,
 * the architecture has failed (spec §51).
 */

import type { Plugin, ProductField, ProductDraft } from '../../shared/registry/plugin-types'

const BATCH_KEY = 'batch_number'
const EXPIRY_KEY = 'expiry_date'

/** Warn this many days ahead. Shop-configurable later; a constant for now. */
const WARNING_WINDOW_DAYS = 90

export const batchExpiryPlugin: Plugin = {
  id: 'batch-expiry',
  name: 'Batch & Expiry',
  version: '0.1.0',
  description: 'Track batch numbers and expiry dates. Warns before stock expires.',
  icon: 'event_busy',

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
        const when = new Date(String(value))
        if (Number.isNaN(when.getTime())) return 'Enter a valid date.'
        return null
      },
      format: (value: unknown) => {
        if (!value) return '—'
        const when = new Date(String(value))
        if (Number.isNaN(when.getTime())) return '—'
        const days = Math.ceil((when.getTime() - Date.now()) / 86_400_000)
        if (days < 0) return `Expired ${Math.abs(days)} days ago`
        if (days === 0) return 'Expires today'
        return `${days} day${days === 1 ? '' : 's'} left`
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
      group: 'Inventory',
      description: 'Allows editing batch numbers and expiry dates on products.',
    })

    // ── Navigation ──────────────────────────────────────────────────────
    // Lands in the core's existing "Inventory" section. The sidebar renders
    // it without knowing this plugin exists.
    api.registerNav({
      id: 'batch-expiry',
      label: 'Expiry Watch',
      icon: 'event_busy',
      section: 'inventory',
      route: '/plugins/batch-expiry',
      permission: 'inventory.view',
      order: 35,
    })

    // ── A settings section ──────────────────────────────────────────────
    api.registerSettingsSection({
      id: 'batch-expiry',
      label: 'Batch & Expiry',
      icon: 'event_busy',
      render: () => {
        const wrap = document.createElement('div')
        wrap.className = 'space-y-3 text-sm text-content-muted'

        const note = document.createElement('p')
        note.textContent = `Stock is flagged ${WARNING_WINDOW_DAYS} days before it expires.`
        wrap.appendChild(note)

        const stored = api.storage.get<number>('warning_days', WARNING_WINDOW_DAYS)
        const label = document.createElement('label')
        label.className = 'flex items-center gap-2'
        label.textContent = 'Warn me'
        const box = document.createElement('input')
        box.type = 'number'
        box.min = '1'
        box.max = '365'
        box.value = String(stored)
        box.className =
          'h-9 w-20 rounded-md border border-input bg-surface px-2 text-sm text-content'
        box.addEventListener('change', () => {
          const days = Number.parseInt(box.value, 10)
          if (Number.isFinite(days) && days > 0) {
            api.storage.set('warning_days', days)
            api.log.debug(`warning window set to ${days} days`)
          }
        })
        label.appendChild(box)

        const suffix = document.createElement('span')
        suffix.textContent = 'days before expiry'
        label.appendChild(suffix)

        wrap.appendChild(label)
        return wrap
      },
    })

    // ── React to the domain ─────────────────────────────────────────────
    // The bus, not a direct import of the inventory feature. Note the dedupe
    // wrapper is unnecessary here because this handler only logs, but a
    // plugin that wrote anything would need it — the same event arrives
    // locally and again over Realtime.
    api.events.on('stock.adjusted', (event) => {
      api.log.debug('stock adjusted', {
        product: event.data.product_id,
        reason: event.data.reason,
      })
    })

    api.log.debug('registered', {
      fields: [batchField.key, expiryField.key],
      permission: `${api.pluginId}.adjust`,
    })
  },
}

/**
 * Pure helper exported for unit tests. Not part of the plugin contract —
 * a plugin's internals stay its own business.
 */
export function daysUntil(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const when = new Date(String(value))
  if (Number.isNaN(when.getTime())) return null
  return Math.ceil((when.getTime() - Date.now()) / 86_400_000)
}

/**
 * Reads the plugin's own fields out of a product draft. Demonstrates the
 * `metadata` storage convention: plugin values live under their key in
 * `products.metadata`, so the core needs no schema change to carry them.
 */
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
