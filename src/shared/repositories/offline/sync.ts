/**
 * The sync engine: what happens between "the wifi came back" and "the till is
 * up to date".
 *
 * It owns three decisions, and nothing else:
 *
 *   · *When to try.* `navigator.onLine` is a hint, not a fact — a captive
 *     portal, a dead uplink and a sleeping laptop all report `true`. So the
 *     flag only ever speeds things up; the queue's own answers decide whether
 *     the shop is really connected, and a manual retry always tries.
 *
 *   · *What a failure means.* Handled by the injected classifier (see
 *     `queue.ts`): the network is "try later", an answer from the server is
 *     "somebody has to decide". This file never guesses.
 *
 *   · *What the cashier is told.* A status object with counts and the last
 *     error, published on every change so the shell can render it. Silence is
 *     the failure mode to avoid: a queued sale nobody mentions is a sale
 *     somebody will re-take by hand.
 */

import type { DrainResult, QueuedWrite, SendOutcome } from './queue'
import type { WriteQueue } from './queue'

export interface SyncStatus {
  /** The browser's opinion, which is why it is labelled as such. */
  online: boolean
  pending: number
  failed: number
  syncing: boolean
  /** Epoch ms of the last successful drain, or null if none has happened. */
  lastSyncedAt: number | null
  lastError: string | null
  /** False when the store could not survive a reload (private mode). */
  persistent: boolean
}

/** The last attempt's outcome, per write — what the failure list shows. */
export interface SyncFailure {
  ref: string
  kind: string
  createdAt: number
  attempts: number
  message: string
}

export interface Connectivity {
  isOnline(): boolean
  /** Returns an unsubscribe function. Fires on both directions. */
  onChange(listener: (online: boolean) => void): () => void
}

export interface SyncEngineOptions {
  queue: WriteQueue
  /** Performs the real call for one queued write. Injected: see `createSaleSender`. */
  send: (write: QueuedWrite) => Promise<SendOutcome>
  connectivity: Connectivity
  onStatus?: (status: SyncStatus) => void
  now?: () => number
  /** How often to try while there is something waiting and the flag says online. */
  intervalMs?: number
  /** Timer hooks, so a test drives the clock instead of waiting for it. */
  setTimer?: (fn: () => void, ms: number) => number
  clearTimer?: (handle: number) => void
  persistent?: boolean
}

export class SyncEngine {
  readonly #options: SyncEngineOptions
  readonly #now: () => number
  #status: SyncStatus
  #unsubscribe: (() => void) | null = null
  #timer: number | null = null
  #draining: Promise<DrainResult> | null = null

  constructor(options: SyncEngineOptions) {
    this.#options = options
    this.#now = options.now ?? (() => Date.now())
    this.#status = {
      online: options.connectivity.isOnline(),
      pending: 0,
      failed: 0,
      syncing: false,
      lastSyncedAt: null,
      lastError: null,
      persistent: options.persistent ?? true,
    }
  }

  get status(): SyncStatus {
    return this.#status
  }

  /** Attach to the browser's connectivity events and read the queue once. */
  async start(): Promise<SyncStatus> {
    if (this.#unsubscribe) return this.#status

    this.#unsubscribe = this.#options.connectivity.onChange((online) => {
      this.#publish({ online })
      if (online) void this.drain()
    })

    await this.refresh()
    if (this.#status.online && this.#status.pending > 0) void this.drain()
    this.#schedule()
    return this.#status
  }

  stop(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = null
    if (this.#timer !== null && this.#options.clearTimer) this.#options.clearTimer(this.#timer)
    this.#timer = null
  }

  /** Recompute the counts from the queue, and publish. */
  async refresh(): Promise<SyncStatus> {
    const [pending, failed] = await Promise.all([
      this.#options.queue.pending(),
      this.#options.queue.failures(),
    ])
    this.#publish({ pending: pending.length, failed: failed.length })
    return this.#status
  }

  /** The failed writes, for the panel that lets a shopkeeper resolve them. */
  async failures(): Promise<SyncFailure[]> {
    const writes = await this.#options.queue.failures()
    return writes.map((write) => ({
      ref: write.ref,
      kind: write.kind,
      createdAt: write.createdAt,
      attempts: write.attempts,
      message: write.lastError ?? 'The server refused this sale.',
    }))
  }

  /** Try now, whether or not the browser thinks there is a connection. */
  async drain(): Promise<DrainResult> {
    if (this.#draining) return this.#draining

    this.#draining = (async () => {
      this.#publish({ syncing: true })
      try {
        const result = await this.#options.queue.drain(this.#options.send)
        if (result.sent > 0 && !result.stopped) {
          this.#publish({ lastSyncedAt: this.#now(), lastError: null })
        }
        return result
      } finally {
        this.#draining = null
        this.#publish({ syncing: false })
        await this.refresh()
        this.#schedule()
      }
    })()

    return this.#draining
  }

  /** Put a refused write back in line and try again. A human decided this. */
  async retry(ref: string): Promise<void> {
    await this.#options.queue.retry(ref)
    await this.refresh()
    await this.drain()
  }

  /** Throw a queued sale away. Only ever from an explicit choice. */
  async discard(ref: string): Promise<QueuedWrite | null> {
    const removed = await this.#options.queue.discard(ref)
    await this.refresh()
    return removed
  }

  /** Tell the engine something was just queued — try now if it can. */
  notifyQueued(): void {
    if (this.#status.online) void this.drain()
  }

  #publish(patch: Partial<SyncStatus>): void {
    const next: SyncStatus = { ...this.#status, ...patch }
    const changed = (Object.keys(next) as (keyof SyncStatus)[]).some((key) => next[key] !== this.#status[key])
    if (!changed) return
    this.#status = next
    this.#options.onStatus?.(next)
  }

  /**
   * One timer, re-armed rather than repeated: a drain that is still running
   * when the timer fires changes nothing, and a `setInterval` racing a slow
   * upload is how a queue sends the same sale twice.
   */
  #schedule(): void {
    const { setTimer, clearTimer, intervalMs } = this.#options
    if (!setTimer || !clearTimer) return
    if (this.#timer !== null) {
      clearTimer(this.#timer)
      this.#timer = null
    }
    if (this.#status.pending === 0 || !this.#status.online) return
    this.#timer = setTimer(() => {
      this.#timer = null
      void this.drain()
    }, intervalMs ?? 20_000)
  }
}

/**
 * The sender the engine should use for queued sales.
 *
 * Two things it gets right that a naive wrapper would not:
 *
 *   · `23505` is a **success**. It is the unique index on `(organization_id,
 *     client_ref)` saying another attempt already wrote this sale — exactly
 *     what happened, and exactly what the queue wanted. Treating it as a
 *     failure would leave the shop chasing a sale it already has.
 *   · The error is classified before it is returned, so "the network is gone"
 *     and "the shop refused this" take different paths through the queue.
 */
export function createSaleSender(
  complete: (payload: never) => Promise<unknown>,
  classify: (error: unknown) => 'offline' | 'refused',
  describe: (error: unknown) => string
): (write: QueuedWrite) => Promise<SendOutcome> {
  return async (write) => {
    try {
      await complete(write.payload as never)
      return { ok: true }
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
      if (code === '23505') return { ok: true }
      const failure = classify(error)
      return { ok: false, failure, message: describe(error) }
    }
  }
}

/** The browser's connectivity, in the shape the engine wants. */
export function browserConnectivity(target: Window = window): Connectivity {
  return {
    isOnline: () => target.navigator.onLine,
    onChange(listener) {
      const onOnline = (): void => listener(true)
      const onOffline = (): void => listener(false)
      target.addEventListener('online', onOnline)
      target.addEventListener('offline', onOffline)
      return () => {
        target.removeEventListener('online', onOnline)
        target.removeEventListener('offline', onOffline)
      }
    },
  }
}
