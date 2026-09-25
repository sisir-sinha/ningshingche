/**
 * Public surface of the register feature (Phase 2 §25, Phase 4 reporting).
 *
 * One screen: the drawer that is open, what to do with it, and the history of
 * the ones that closed — each with its report.
 */

import type { Route } from '../../app/router/router'
import { registerView } from './register-view'

export function registerRoutes(): Route[] {
  return [
    {
      path: '/register',
      title: 'Register',
      permission: 'register.open',
      render: () => registerView(),
    },
  ]
}

export { registerView } from './register-view'
