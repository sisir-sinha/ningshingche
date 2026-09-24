/**
 * The screen a shopkeeper sees for navigation that is declared but not built.
 *
 * The sidebar is the product's own roadmap: it advertises Sales, Stock,
 * Reports and the rest because those screens are coming. Until this view
 * existed, tapping one of them did nothing at all — the router has no route,
 * so it quietly bounced back to the dashboard, and the click read as a broken
 * menu. Silence is the one thing it must never be: this says what the screen
 * will do and when it arrives.
 *
 * It is temporary by construction. `main.ts` derives the placeholder list from
 * the route table it actually registered, so the moment a real route exists
 * for `/sales`, this view stops rendering for it — there is no list to
 * remember to update.
 */

import { h } from '../../components/ui/h'
import { iconButton } from '../../components/ui/button'
import { emptyState } from '../../components/ui/card'
import type { NavItem } from '../../shared/registry/plugin-types'

/** What each declared-but-unbuilt screen will do, and which phase delivers it. */
export const COMING_SOON: Record<string, { phase: string; note: string }> = {
  '/sales': { phase: 'Phase 2', note: 'Recent sales, sale detail, reprint a receipt.' },
  '/customers': { phase: 'Phase 2', note: 'Customer list, quick create, purchase history.' },
  '/register': { phase: 'Phase 2', note: 'Open the drawer, cash in and out, close with variance.' },
  '/stock': { phase: 'Phase 3', note: 'Stock in and out, ledger history, low-stock watch.' },
  '/purchases': { phase: 'Phase 4', note: 'Purchase orders, receiving, supplier balances.' },
  '/expenses': { phase: 'Phase 4', note: 'Expense entries and their effect on the register.' },
  '/users': { phase: 'Phase 4', note: 'Staff accounts, roles and per-branch access.' },
  '/roles': { phase: 'Phase 4', note: 'Role editor over the permission catalogue.' },
  '/reports': { phase: 'Phase 5', note: 'Sales, profit and inventory reports.' },
  '/analytics': { phase: 'Phase 5', note: 'Dimensions × measures, charted.' },
  '/plugins': { phase: 'Phase 6', note: 'Install, enable and configure industry plugins.' },
  '/settings': { phase: 'Phase 4', note: 'Shop details, taxes, receipt and device settings.' },
}

export interface PlaceholderOptions {
  item: NavItem
  onBack?: () => void
}

export function placeholderView(options: PlaceholderOptions): HTMLElement {
  const { item, onBack } = options
  const detail = COMING_SOON[item.route]

  return h(
    'div',
    { class: 'p-3 sm:p-6' },
    h(
      'div',
      {
        class:
          'mx-auto max-w-lg rounded-xl border border-border bg-surface ' +
          'shadow-sm',
      },
      h(
        'div',
        { class: 'flex items-center gap-2 border-b border-border p-3' },
        onBack
          ? iconButton('arrow_back', 'Back to dashboard', { variant: 'ghost', onClick: onBack })
          : null,
        h('span', { class: 'material-symbols-rounded text-content-muted', 'aria-hidden': 'true', text: item.icon }),
        h('h1', { class: 'text-base font-semibold text-content', text: item.label })
      ),
      emptyState(item.label, {
        description:
          (detail?.note ?? 'This screen is declared but not built yet.') +
          (detail ? ` Arriving in ${detail.phase}.` : ''),
        iconName: 'construction',
      })
    )
  )
}
