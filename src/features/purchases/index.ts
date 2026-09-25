/**
 * Public surface of the purchases feature (spec §20, §23).
 *
 * `supplierId` comes from the query string so `/purchases?supplier=…` — the
 * link the suppliers screen offers — lands on a form already filled in.
 */

import type { Route } from '../../app/router/router'
import { purchasesView } from './purchases-view'

export function purchaseRoutes(): Route[] {
  return [
    {
      path: '/purchases',
      title: 'Purchases',
      permission: 'purchases.view',
      render: (context) => purchasesView({ supplierId: context.query.get('supplier') ?? undefined }),
    },
  ]
}

export { purchasesView } from './purchases-view'
