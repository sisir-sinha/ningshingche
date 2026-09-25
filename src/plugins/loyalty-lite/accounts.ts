/** The Loyalty screen. Fetched only when the plugin is enabled and opened. */

import { emptyState } from '../../components/ui/card'
import { h, mount } from '../../components/ui/h'
import type { PluginDb, PluginPageContext, PluginPageModule } from '../../shared/registry/plugin-types'
import { formatPoints, type LoyaltyTotals } from './index'

export interface AccountsDeps {
  db: PluginDb
}

export function create(deps: AccountsDeps): PluginPageModule {
  return {
    render: (context: PluginPageContext): HTMLElement => {
      const body = h('div', { class: 'space-y-2 p-3' }, h('p', { class: 'text-sm text-content-muted' }, 'Loading accounts…'))

      void (async () => {
        let totals: LoyaltyTotals
        try {
          totals = await deps.db.rpc<LoyaltyTotals>('totals', { limit: 50 })
        } catch (error) {
          mount(
            body,
            emptyState('Loyalty could not be read', {
              description: error instanceof Error ? error.message : String(error),
              iconName: 'error',
            })
          )
          return
        }

        if (totals.accounts === 0) {
          mount(
            body,
            emptyState('No points awarded yet', {
              description:
                'Award points from the POS screen while a customer is attached, or turn on automatic awarding in the plugin settings.',
              iconName: 'card_membership',
            })
          )
          return
        }

        mount(
          body,
          h(
            'div',
            { class: 'flex flex-wrap items-center justify-between gap-2' },
            h(
              'p',
              { class: 'text-xs text-content-muted' },
              `${totals.accounts} account(s) · ${formatPoints(totals.points)} points issued`
            ),
            h('p', { class: 'text-xs text-content-subtle' }, `shop ${context.organizationId.slice(0, 8)}…`)
          ),
          ...totals.top.map((entry) =>
            h(
              'div',
              {
                class:
                  'flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3',
              },
              h('p', { class: 'min-w-0 truncate text-sm font-medium text-content' }, entry.customer),
              h(
                'p',
                { class: 'shrink-0 text-sm tabular-nums text-content' },
                `${formatPoints(entry.points)} pts`
              )
            )
          )
        )
      })()

      return body
    },
  }
}
