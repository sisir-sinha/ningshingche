/** Public surface of the expenses feature (spec §24). */

import type { Route } from '../../app/router/router'
import { expensesView } from './expenses-view'

export function expenseRoutes(): Route[] {
  return [
    {
      path: '/expenses',
      title: 'Expenses',
      permission: 'expenses.view',
      render: () => expensesView(),
    },
  ]
}

export { expensesView } from './expenses-view'
