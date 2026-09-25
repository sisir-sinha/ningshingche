/**
 * The in-memory store.
 *
 * Two jobs, and neither is "a fallback nobody should use":
 *
 *   1. The tests. The queue's semantics — serial send, stop on a network
 *      error, keep going past a business refusal, never drop a write — are the
 *      part worth testing, and they are testable without a browser database.
 *   2. A browser that refuses IndexedDB (private mode, storage disabled, an
 *      embedded webview). The app then still runs, still sells, and says so;
 *      what it loses is surviving a reload, which is a smaller failure than
 *      refusing to open the till.
 *
 * Insertion order is kept, because the queue drains oldest first and a test
 * that cannot see the order cannot check that it does.
 */

import { BUCKETS, type Bucket, type CacheEntry, type OfflineStore } from './store'

export function createMemoryStore(now: () => number = () => Date.now()): OfflineStore {
  const buckets = new Map<Bucket, Map<string, CacheEntry<unknown>>>()
  for (const bucket of BUCKETS) buckets.set(bucket, new Map())

  const bucketOf = (bucket: Bucket): Map<string, CacheEntry<unknown>> => {
    const existing = buckets.get(bucket)
    if (existing) return existing
    const created = new Map<string, CacheEntry<unknown>>()
    buckets.set(bucket, created)
    return created
  }

  return {
    async get<T>(bucket: Bucket, key: string) {
      const entry = bucketOf(bucket).get(key)
      return entry ? ({ value: entry.value as T, at: entry.at } as CacheEntry<T>) : null
    },
    async put<T>(bucket: Bucket, key: string, value: T, at?: number) {
      // Re-putting an existing key keeps its position: a queue that reordered
      // itself every time a write was touched would replay out of order.
      bucketOf(bucket).set(key, { value, at: at ?? now() })
    },
    async all<T>(bucket: Bucket) {
      return [...bucketOf(bucket).values()] as CacheEntry<T>[]
    },
    async remove(bucket: Bucket, key: string) {
      bucketOf(bucket).delete(key)
    },
    async clear(bucket: Bucket) {
      bucketOf(bucket).clear()
    },
    async size() {
      let total = 0
      for (const bucket of buckets.values()) total += bucket.size
      return total
    },
  }
}
