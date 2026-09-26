import type { Route } from '../../app/router/router'
import { settingsView } from './settings-view'

export function settingsRoutes(): Route[] {
  return [
    {
      path: '/settings',
      title: 'Settings',
      permission: 'settings.view',
      render: () => settingsView(),
    },
  ]
}

export { settingsView }
