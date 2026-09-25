/**
 * The storage seam under the offline layer (docs/10 Phase 8).
 *
 * Three buckets, because the three things the till must keep without a network
 * are different in kind and have different lifetimes:
 *
 *   `catalog`  what this shop sells, as of the last time it was read. Only ever
 *              a cache: losing it costs a download, never data.
 *   `outbox`   sales that have been taken and not yet accepted by the server.
 *              The one bucket whose loss is unacceptable, which is why it is
 *              the one that holds no derivable data — just the payload, the
 *              reference and what happened when it was last sent.
 *   `drafts`   held carts. Client-authoritative by policy: a parked cart is the
 *              cashier's working state, and the server's copy is a convenience
 *              so another device can pick it up.
 *
 * The interface is deliberately small — get/put/all/remove/clear over named
 * buckets — because the Android client will implement exactly this shape over
 * SQLite, and because a store with a query language would invite the offline
 * path to grow its own business logic.
 *
 * Nothing here knows about Supabase, money or sales. That is `queue.ts` and
 * `catalog-cache.ts`.
 */

/** Bucket names, so a typo is a type error rather than a silent empty list. */
export type Bucket = 'catalog' | 'outbox' | 'drafts' | 'meta'

export const BUCKETS: readonly Bucket[] = ['catalog', 'outbox', 'drafts', 'meta']

/** A value with the time it was written, for staleness the UI can show. */
export interface CacheEntry<T> {
  value: T
  /** Epoch milliseconds. */
  at: number
}

export interface OfflineStore {
  get<T>(bucket: Bucket, key: string): Promise<CacheEntry<T> | null>
  put<T>(bucket: Bucket, key: string, value: T, at?: number): Promise<void>
  /** Every entry in a bucket, in insertion order where the backend keeps one. */
  all<T>(bucket: Bucket): Promise<CacheEntry<T>[]>
  remove(bucket: Bucket, key: string): Promise<void>
  clear(bucket: Bucket): Promise<void>
  /** Total entries, for the status line. Not per bucket: it is one number. */
  size(): Promise<number>
}

/** Thrown when the device has no usable store at all (private mode, storage off). */
export class OfflineStoreUnavailable extends Error {
  constructor(cause?: unknown) {
    super('This browser will not let the app keep data offline.')
    this.name = 'OfflineStoreUnavailable'
    this.cause = cause
  }
}
