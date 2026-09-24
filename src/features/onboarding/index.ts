/** Public surface of the onboarding feature. */

import type { Route } from '../../app/router/router'
import { onboardingView } from './onboarding-view'

export function onboardingRoutes(options: { onDone: () => void }): Route[] {
  return [
    {
      path: '/onboarding',
      title: 'Set up your shop',
      render: () => onboardingView(options),
    },
  ]
}

export { onboardingView } from './onboarding-view'
