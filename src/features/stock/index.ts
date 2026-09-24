/**
 * Public surface of the stock feature (Phase 3).
 *
 * Two screens: the overview, and the ledger for one variant. The four
 * operations live in a dialog opened from the overview, because they are the
 * same act with different fields.
 */

import type { Route } from '../../app/router/router'
import { stockView } from './stock-view'
import { stockHistoryView } from './stock-history-view'

export interface StockRoutesOptions {
  onNavigate: (path: string) => void
}

export function stockRoutes(options: StockRoutesOptions): Route[] {
  return [
    {
      path: '/stock',
      title: 'Stock',
      permission: 'inventory.view',
      render: () => stockView({ onNavigate: options.onNavigate }),
    },
    {
      path: '/stock/history/:variantId',
      title: 'Stock history',
      permission: 'inventory.view',
      render: (context) =>
        stockHistoryView({
          variantId: context.params.variantId ?? '',
          onBack: () => options.onNavigate('/stock'),
        }),
    },
  ]
}

export { stockView } from './stock-view'
export { stockHistoryView } from './stock-history-view'
export { openStockDialog } from './stock-dialog'
