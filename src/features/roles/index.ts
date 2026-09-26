import type { Route } from '../../app/router/router'
import { rolesView } from './roles-view'

export function roleRoutes(): Route[] {
  return [
    {
      path: '/roles',
      title: 'Roles',
      permission: 'roles.manage',
      render: () => rolesView(),
    },
  ]
}

export { rolesView }
