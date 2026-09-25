/**
 * Offline wiring (docs/10 Phase 8).
 *
 * The composition root decides *which* repositories the app talks to; this file
 * decides that the till keeps working when the answer is "none of them". It is
 * the only place that knows a browser database, a connectivity flag and a
 * background queue exist — features keep depending on the contracts, which is
 * what makes the offline story additive rather than a second app.
 *
 * Lifecycle: `startOffline` runs after the session resolves (it needs the
 * organization to know which shop's catalogue to warm) and before the shell
 * mounts, so the first screen the cashier sees is already the offline-capable
 * one. `stopOffline` runs on sign-out, and forgets the cached catalogue with
 * it — a shared till must not keep the previous shop's products, or for that
 * matter its queued sales.
 */

import { getSupabase } from './platform/supabase'
import { offlineStatus } from './state/offline'
import { sessionStore } from './state/session'
import { createSupabaseRepositories } from '../shared/repositories/supabase'
import { openOfflineStore } from '../shared/repositories/offline/indexeddb-store'
import {
  createOfflineRepositories,
  defaultClassify,
  describeFailure,
  type OfflineRepositories,
} from '../shared/repositories/offline'
import {
  browserConnectivity,
  createSaleSender,
  SyncEngine,
  type Connectivity,
  type SyncStatus,
} from '../shared/repositories/offline/sync'
import type { Repositories } from '../shared/repositories/contracts'

export interface OfflineRuntime {
  engine: SyncEngine
  repositories: Repositories
  /** Pull the catalogue in for this warehouse. */
  warm(warehouseId: string): Promise<{ rows: number; complete: boolean }>
  /** Everything queued but not yet accepted by the server. */
  pending(): Promise<number>
  /** What the shop has to resolve by hand. */
  failures(): Promise<SyncFailureView[]>
  retry(ref: string): Promise<void>
  discard(ref: string): Promise<void>
  /** Try again right now, whether or not the browser says it is online. */
  drain(): Promise<void>
  stop(): Promise<void>
}

export interface SyncFailureView {
  ref: string
  kind: string
  createdAt: number
  attempts: number
  message: string
}

/** The live runtime, or null before sign-in. */
let runtime: OfflineRuntime | null = null

export function offlineRuntime(): OfflineRuntime | null {
  return runtime
}

/**
 * Wrap the app's repositories with the offline layer and start syncing.
 *
 * `connectivity` is injectable so a test can own the online/offline flag the
 * way a browser would; everything else is read from the environment.
 */
export async function startOffline(options: {
  connectivity?: Connectivity
  setTimer?: (fn: () => void, ms: number) => number
  clearTimer?: (handle: number) => void
  now?: () => number
} = {}): Promise<OfflineRuntime> {
  if (runtime) return runtime

  const client = getSupabase()
  if (!client) throw new Error('Supabase is not configured')

  const opened = await openOfflineStore(options.now)
  if (!opened.persistent) {
    // Said out loud, once: a till whose queue dies with the tab is worth
    // knowing about before the connection does.
    console.warn(`[mekholi] offline storage is in-memory only — ${opened.reason ?? 'no IndexedDB'}`)
  }

  const raw = createSupabaseRepositories(client, () => sessionStore.state.activeOrganizationId)

  const offline: OfflineRepositories = createOfflineRepositories(raw, {
    store: opened.store,
    persistent: opened.persistent,
    ...(options.now ? { now: options.now } : {}),
  })

  const engine = new SyncEngine({
    queue: offline.queue,
    connectivity: options.connectivity ?? browserConnectivity(),
    // The *unwrapped* repository: the offline wrapper would queue a failure
    // again, and a queue that re-queues its own retries never drains.
    send: createSaleSender(
      (payload) => raw.sales.complete(payload as Parameters<Repositories['sales']['complete']>[0]),
      defaultClassify,
      describeFailure
    ),
    onStatus: (status: SyncStatus) => publish(status),
    persistent: opened.persistent,
    ...(options.setTimer ? { setTimer: options.setTimer } : {}),
    ...(options.clearTimer ? { clearTimer: options.clearTimer } : {}),
    ...(options.now ? { now: options.now } : {}),
  })

  await engine.start()

  runtime = {
    engine,
    repositories: offline.repositories,
    warm: (warehouseId) => offline.warm(warehouseId),
    pending: async () => (await offline.queue.pending()).length,
    failures: () => engine.failures(),
    async retry(ref) {
      await engine.retry(ref)
    },
    async discard(ref) {
      await engine.discard(ref)
    },
    async drain() {
      await engine.drain()
    },
    async stop() {
      engine.stop()
      // Queued sales go with the session: they belong to a shop and a user,
      // and the next person at this till is neither.
      await offline.queue.list().then(async (writes) => {
        for (const write of writes) await offline.queue.discard(write.ref)
      })
      await offline.cache.clear()
      runtime = null
    },
  }

  return runtime
}

/** Push engine status into the app store the shell renders from. */
function publish(status: SyncStatus): void {
  offlineStatus.set({
    online: status.online,
    pending: status.pending,
    failed: status.failed,
    syncing: status.syncing,
    lastSyncedAt: status.lastSyncedAt,
    lastError: status.lastError,
    persistent: status.persistent,
  })
}
