/** Public surface of the audit feature (spec §31). */

import type { Route } from '../../app/router/router'
import { auditView } from './audit-view'

export function auditRoutes(): Route[] {
  return [
    {
      path: '/audit',
      title: 'Audit trail',
      permission: 'audit.view',
      render: () => auditView(),
    },
  ]
}

export { auditView } from './audit-view'
