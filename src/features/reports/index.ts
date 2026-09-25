/** Public surface of the reports feature (Phase 5, spec §23). */

import type { Route } from '../../app/router/router'
import { reportsView } from './reports-view'

export function reportRoutes(): Route[] {
  return [
    {
      path: '/reports',
      title: 'Reports',
      permission: 'reports.view',
      render: (context) =>
        reportsView({
          initialReport: context.query.get('report') ?? undefined,
          initialPeriod: context.query.get('period') ?? undefined,
          initialSearch: context.query.get('search') ?? undefined,
          initiallyOwing: context.query.get('type') === 'owing',
        }),
    },
  ]
}

export { reportsView } from './reports-view'
export { buildReportCsv, exportReportCsv, printReport, exportReportPdf } from './report-export'
