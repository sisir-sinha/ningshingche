/**
 * The write queue: what the till did while nobody was listening.
 *
 * A sale taken offline is not a draft and not an intention — the customer has
 * paid and walked out with the goods. So the queue is the shop's record of that
 * sale, and its rules follow from that:
 *
 *   · **One at a time, oldest first.** Two sales for the same variant must
 *     arrive in the order they happened, or the stock ledger reads backwards.
 *     Sending them in parallel would leave that ordering to the network.
 *
 *   · **A lost connection stops the drain; a refusal does not.** If the
 *     network is down, the sale has not been refused by anything and will be
 *     sent later — so the drain stops and the rest stay pending. If the server
 *     *answers* and says no (insufficient stock, a closed register session),
 *     waiting will not change the answer: the write is marked failed, kept, and
 *     the drain moves on. The shopkeeper resolves it; this code never deletes
 *     somebody's sale.
 *
 *   · **The reference is generated here, once.** It is created at the moment
 *     the sale is taken and never regenerated, which is what makes a resend
 *     after an unclear outcome safe: the server recognises it (044) and returns
 *     the receipt it already wrote. A retry that minted a new reference would
 *     be a second sale.
 *
 * `classify` decides which of the two a failure is, and it is injected rather
 * than guessed here, because "was that the network or the shop's rule?" is a
 * question about the transport, not about the queue.
 */

import type { OfflineStore } from './store'

export type QueuedKind = 'sale.complete'

export type QueuedStatus = 'pending' | 'failed'

export interface QueuedWrite<TPayload = unknown> {
  /** Equals `ref`: a queued write is identified by the reference it will send. */
  id: string
  kind: QueuedKind
  /** The client reference, sent as `p_client_ref`. Never regenerated. */
  ref: string
  payload: TPayload
  createdAt: number
  attempts: number
  lastAttemptAt: number | null
  status: QueuedStatus
  /** Why the last attempt failed, in the words the cashier will read. */
  lastError: string | null
  /**
   * Anything the caller wants kept with the write but never sent.
   *
   * One use so far: the receipt the till printed, so `sales.get` can hand it
   * back while the sale is still queued. It is deliberately untyped — the queue
   * is a transport, and a transport that knows what a receipt is has opinions
   * about a domain it should not have heard of.
   */
  meta?: unknown
}

export interface DrainResult {
  sent: number
  failed: number
  /** True when the drain stopped early — the caller should try again later. */
  stopped: boolean
  /** Total left in the queue afterwards. */
  remaining: number
}

/** How a send failed, from the queue's point of view. */
export type SendFailure = 'offline' | 'refused'

export interface SendOutcome {
  ok: boolean
  failure?: SendFailure
  message?: string
}

export interface QueueOptions {
  now?: () => number
  /** Injected so a test can pin the reference without stubbing the world. */
  newRef?: () => string
}

const OUTBOX = 'outbox' as const

function defaultRef(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ref-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

export class WriteQueue {
  readonly #store: OfflineStore
  readonly #now: () => number
  readonly #newRef: () => string

  constructor(store: OfflineStore, options: QueueOptions = {}) {
    this.#store = store
    this.#now = options.now ?? (() => Date.now())
    this.#newRef = options.newRef ?? defaultRef
  }

  /**
   * Take responsibility for a write.
   *
   * The reference is minted here and handed back, so the caller can put it on
   * the receipt it shows the customer *before* the server has seen anything —
   * and so a sale that is later found on the server can be matched to the line
   * in the shop's own books.
   */
  async enqueue<TPayload>(
    kind: QueuedKind,
    payload: TPayload,
    ref?: string,
    meta?: unknown
  ): Promise<QueuedWrite<TPayload>> {
    const write: QueuedWrite<TPayload> = {
      id: ref ?? this.#newRef(),
      kind,
      ref: ref ?? this.#newRef(),
      payload,
      ...(meta !== undefined ? { meta } : {}),
      createdAt: this.#now(),
      attempts: 0,
      lastAttemptAt: null,
      status: 'pending',
      lastError: null,
    }
    // `id` and `ref` must agree: the whole safety story is "the same reference,
    // every time". A caller that supplies one supplies both.
    write.id = write.ref
    await this.#store.put(OUTBOX, write.id, write, write.createdAt)
    return write
  }

  /** One write by its reference, or null. Used to read a queued receipt back. */
  async find(id: string): Promise<QueuedWrite | null> {
    const entry = await this.#store.get<QueuedWrite>(OUTBOX, id)
    return entry?.value ?? null
  }

  /** Everything waiting, oldest first. Failed writes are included. */
  async list(): Promise<QueuedWrite[]> {
    const entries = await this.#store.all<QueuedWrite>(OUTBOX)
    return entries
      .map((entry) => entry.value)
      .sort((a, b) => a.createdAt - b.createdAt || a.ref.localeCompare(b.ref))
  }

  async pending(): Promise<QueuedWrite[]> {
    return (await this.list()).filter((write) => write.status === 'pending')
  }

  async failures(): Promise<QueuedWrite[]> {
    return (await this.list()).filter((write) => write.status === 'failed')
  }

  async size(): Promise<number> {
    return (await this.list()).length
  }

  /**
   * Send what is pending, oldest first, one at a time.
   *
   * `send` performs the actual call and reports how it failed; the queue only
   * decides what that means for the write. A successful send removes the write:
   * the server now owns that sale, and keeping a copy would invite replaying it.
   */
  async drain(send: (write: QueuedWrite) => Promise<SendOutcome>): Promise<DrainResult> {
    const all = await this.list()
    let sent = 0
    let failed = 0
    let stopped = false

    for (const write of all) {
      // Failed writes are skipped, not retried: something answered "no", and
      // asking again in a loop is how a queue becomes a denial of service. The
      // shopkeeper retries them deliberately, or discards them knowingly.
      if (write.status !== 'pending') continue

      const outcome = await send(write)
      const attempt: QueuedWrite = {
        ...write,
        attempts: write.attempts + 1,
        lastAttemptAt: this.#now(),
      }

      if (outcome.ok) {
        await this.#store.remove(OUTBOX, write.id)
        sent += 1
        continue
      }

      if (outcome.failure === 'offline') {
        // Keep it in the pending line — but record the attempt, so the status
        // line can say "tried 4 times" rather than pretending nothing happened,
        // and the question panel can show what the last error actually was
        // ("Failed to fetch" and "gateway timeout" are different problems).
        await this.#store.put(
          OUTBOX,
          write.id,
          { ...attempt, lastError: outcome.message ?? null },
          write.createdAt
        )
        stopped = true
        break
      }

      await this.#store.put(
        OUTBOX,
        write.id,
        {
          ...attempt,
          status: 'failed' as QueuedStatus,
          lastError: outcome.message ?? 'The server refused this sale.',
        },
        write.createdAt
      )
      failed += 1
    }

    return { sent, failed, stopped, remaining: await this.size() }
  }

  /** Put a failed write back in the pending line, by hand. */
  async retry(id: string): Promise<boolean> {
    const entry = await this.#store.get<QueuedWrite>(OUTBOX, id)
    if (!entry) return false
    await this.#store.put(
      OUTBOX,
      id,
      { ...entry.value, status: 'pending' as QueuedStatus, lastError: null },
      entry.value.createdAt
    )
    return true
  }

  /**
   * Throw a write away.
   *
   * Returns the write that was removed, so the caller can report exactly what
   * was discarded. Only called from an explicit human decision — the queue
   * itself never drops anything, because a sale is somebody's money.
   */
  async discard(id: string): Promise<QueuedWrite | null> {
    const entry = await this.#store.get<QueuedWrite>(OUTBOX, id)
    if (!entry) return null
    await this.#store.remove(OUTBOX, id)
    return entry.value
  }
}
