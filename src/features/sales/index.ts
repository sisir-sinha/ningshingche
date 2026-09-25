/**
 * Public surface of the sales feature (Phase 2 §19, Phase 4 returns §18).
 *
 * The list screen and the refund flow are the same surface: a return starts by
 * finding the sale, so they are one screen with one entry point.
 */

import type { Route } from '../../app/router/router'
import { salesView } from './sales-view'

export function salesRoutes(): Route[] {
  return [
    {
      path: '/sales',
      title: 'Sales',
      permission: 'sales.view',
      render: () => salesView(),
    },
  ]
}

export { salesView } from './sales-view'
