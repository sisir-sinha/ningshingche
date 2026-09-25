/** Public surface of the suppliers feature (spec §20). */

import type { Route } from '../../app/router/router'
import { suppliersView } from './suppliers-view'

export interface SupplierRoutesOptions {
  onNavigate: (path: string) => void
}

export function supplierRoutes(options: SupplierRoutesOptions): Route[] {
  return [
    {
      path: '/suppliers',
      title: 'Suppliers',
      permission: 'suppliers.view',
      render: () => suppliersView({ onNavigate: options.onNavigate }),
    },
  ]
}

export { suppliersView } from './suppliers-view'
