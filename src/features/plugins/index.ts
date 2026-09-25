/**
 * Public surface of the plugins feature (spec §31, §51).
 *
 * One screen: what this server ships, what this shop has switched on, and the
 * settings each plugin declares. Reached from the sidebar as *Plugins* and
 * named in every "switch it on in Settings → Plugins" message the app shows —
 * so the route is `/plugins`, and the placeholder that used to live there is
 * gone because a real route now occupies it.
 */

import type { Route } from '../../app/router/router'
import { pluginsView } from './plugins-view'

export function pluginAdminRoutes(): Route[] {
  return [
    {
      path: '/plugins',
      title: 'Plugins',
      permission: 'plugins.view',
      render: () => pluginsView(),
    },
  ]
}

export { pluginsView } from './plugins-view'
