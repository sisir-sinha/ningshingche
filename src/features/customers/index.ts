/** Public surface of the customers feature (spec §19). */

import type { Route } from '../../app/router/router'
import { customersView } from './customers-view'

export interface CustomerRoutesOptions {
  onNavigate: (path: string) => void
}

export function customerRoutes(options: CustomerRoutesOptions): Route[] {
  return [
    {
      path: '/customers',
      title: 'Customers',
      permission: 'customers.view',
      render: () => customersView({ onNavigate: options.onNavigate }),
    },
  ]
}

export { customersView } from './customers-view'
