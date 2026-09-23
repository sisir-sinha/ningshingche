/**
 * The application's single EventBus instance.
 *
 * One bus, exported once, so a plugin and the view it affects are guaranteed
 * to be talking to the same object. Constructed here rather than in `main.ts`
 * because the plugin registry needs it at import time.
 */

import { EventBus, dedupe } from './event-bus'

export const eventBus = new EventBus()

export { EventBus, dedupe }
export type { Listener, Unsubscribe, BusStats } from './event-bus'
export * from './events'
