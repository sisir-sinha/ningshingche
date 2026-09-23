/** Public surface of the products feature. */

import type { Route } from '../../app/router/router'
import { productsView } from './products-view'
import type { PluginRegistry } from '../../shared/registry/plugin-registry'

export function productRoutes(registry: PluginRegistry): Route[] {
  return [
    {
      path: '/products',
      title: 'Products',
      permission: 'products.view',
      render: () => productsView({ registry }),
    },
  ]
}

export { productsView } from './products-view'
