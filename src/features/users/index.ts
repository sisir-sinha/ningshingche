import type { Route } from '../../app/router/router'
import { usersView } from './users-view'

export function userRoutes(): Route[] {
  return [
    {
      path: '/users',
      title: 'Staff',
      permission: 'users.view',
      render: () => usersView(),
    },
  ]
}

export { usersView }
