/** Public surface of the analytics feature (Phase 5, spec §21–§22). */

import type { Route } from '../../app/router/router'
import { analyticsView, answersPanel, answerText } from './analytics-view'

export function analyticsRoutes(): Route[] {
  return [
    {
      path: '/analytics',
      title: 'Analytics',
      permission: 'analytics.view',
      render: (context) =>
        analyticsView({
          initialDimension: context.query.get('dimension') ?? undefined,
          initialMeasure: context.query.get('measure') ?? undefined,
          initialPeriod: context.query.get('period') ?? undefined,
        }),
    },
  ]
}

export { analyticsView, answersPanel, answerText }
