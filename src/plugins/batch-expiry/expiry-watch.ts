/**
 * The Expiry Watch screen. Only fetched when the plugin is enabled and the
 * user opens the route — the sidebar can list the plugin without this code
 * ever reaching the browser.
 */

import { badge, emptyState } from '../../components/ui/card'
import { button } from '../../components/ui/button'
import { h, mount } from '../../components/ui/h'
import type { PluginDb, PluginPageContext, PluginPageModule } from '../../shared/registry/plugin-types'
import { BATCH_KEY, EXPIRY_KEY, DEFAULT_WARNING_DAYS } from './manifest'
import { describeExpiry, daysUntil, expiringSoon } from './index'

export interface ExpiryWatchDeps {
  db: PluginDb
  warningDays: () => number
  /** Injected by the host's route wrapper; defaults to a hash navigation. */
  onOpenProduct?: (productId: string) => void
}

export function create(deps: ExpiryWatchDeps): PluginPageModule {
  return {
    render: (context: PluginPageContext): HTMLElement => {
      const warningDays = deps.warningDays() || DEFAULT_WARNING_DAYS
      const body = h(
        'div',
        { class: 'space-y-2 p-3' },
        h('p', { class: 'text-sm text-content-muted' }, 'Checking stock…')
      )

      void (async () => {
        let products
        try {
          products = await deps.db.products()
        } catch (error) {
          mount(
            body,
            emptyState('Expiry could not be checked', {
              description: error instanceof Error ? error.message : String(error),
              iconName: 'error',
            })
          )
          return
        }

        const expiring = expiringSoon(products, warningDays)
        const header = h(
          'div',
          { class: 'flex flex-wrap items-center justify-between gap-2' },
          h(
            'p',
            { class: 'text-xs text-content-muted' },
            `${expiring.length} product(s) inside ${warningDays} days · shop ${context.organizationId.slice(0, 8)}…`
          )
        )

        if (expiring.length === 0) {
          mount(
            body,
            header,
            emptyState('Nothing expires soon', {
              description:
                'Batch and expiry live on the product form under Advanced options; anything inside the warning window shows here.',
              iconName: 'event_available',
            })
          )
          return
        }

        mount(
          body,
          header,
          ...expiring.map((entry) => {
            const described = describeExpiry(entry.days)
            const batch = entry.product.metadata[BATCH_KEY]
            const expiry = entry.product.metadata[EXPIRY_KEY]
            return h(
              'div',
              {
                class:
                  'flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3',
              },
              h(
                'div',
                { class: 'min-w-0' },
                h('p', { class: 'truncate text-sm font-medium text-content' }, entry.product.name),
                h(
                  'p',
                  { class: 'truncate text-xs text-content-muted' },
                  [
                    entry.product.sku ?? 'no SKU',
                    typeof batch === 'string' ? `batch ${batch}` : null,
                    typeof expiry === 'string' ? `expires ${expiry}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                )
              ),
              h(
                'div',
                { class: 'flex shrink-0 items-center gap-2' },
                badge(described.label, { tone: described.tone }),
                button('Open', {
                  size: 'sm',
                  variant: 'ghost',
                  icon: 'open_in_new',
                  onClick: () => {
                    if (deps.onOpenProduct) deps.onOpenProduct(entry.product.id)
                    else {
                      const base = new URL(import.meta.env.BASE_URL || './', window.location.href).pathname
                      const prefix = base === '/' ? '' : base.replace(/\/$/, '')
                      window.history.pushState(null, '', `${prefix}/products/${entry.product.id}`)
                      window.dispatchEvent(new PopStateEvent('popstate'))
                    }
                  },
                })
              )
            )
          })
        )
      })()

      return body
    },
  }
}

export { daysUntil }
