/** Public surface of catalogue management. */

import type { Route } from '../../app/router/router'
import { catalogueView } from './catalogue-view'

export function catalogueRoutes(): Route[] {
  return [
    {
      path: '/catalogue',
      title: 'Catalogue',
      permission: 'products.view',
      render: () => catalogueView(),
    },
  ]
}

export { catalogueView } from './catalogue-view'
