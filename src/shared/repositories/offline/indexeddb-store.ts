/**
 * The IndexedDB store — the one that survives a reload.
 *
 * Written against the raw API rather than a library: the shape needed is four
 * operations over named buckets, and a dependency for that would be a
 * dependency the Android client cannot use anyway.
 *
 * Design notes that matter:
 *
 *   · One object store per bucket, keyed by string. The `at` timestamp is
 *     stored beside the value rather than derived from the key, so a cached
 *     row's age can be shown without knowing when it was written.
 *
 *   · Every operation opens a fresh transaction. Holding one open across
 *     awaits is how a browser decides the page is hung; IndexedDB transactions
 *     close themselves as soon as the microtask queue drains.
 *
 *   · Failures are surfaced as `OfflineStoreUnavailable`, so the caller can
 *     fall back to memory and *say so* rather than quietly behaving as if the
 *     shop had no history.
 */

import {
  BUCKETS,
  OfflineStoreUnavailable,
  type Bucket,
  type CacheEntry,
  type OfflineStore,
} from './store'

const DB_NAME = 'mekholi'
const DB_VERSION = 1

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new OfflineStoreUnavailable('indexedDB is undefined'))
      return
    }
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(new OfflineStoreUnavailable(error))
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      for (const bucket of BUCKETS) {
        if (!db.objectStoreNames.contains(bucket)) {
          db.createObjectStore(bucket, { keyPath: 'key' })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new OfflineStoreUnavailable(req.error))
    // A blocked upgrade means another tab holds an older version open. Waiting
    // forever would hang the till, so the store is reported unavailable and the
    // caller falls back to memory.
    req.onblocked = () => reject(new OfflineStoreUnavailable('another tab is holding an old database open'))
  })
}

interface Row {
  key: string
  value: unknown
  at: number
}

export async function createIndexedDbStore(now: () => number = () => Date.now()): Promise<OfflineStore> {
  const db = await open()

  const tx = <T>(bucket: Bucket, mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      let transaction: IDBTransaction
      try {
        transaction = db.transaction(bucket, mode)
      } catch (error) {
        reject(new OfflineStoreUnavailable(error))
        return
      }
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
      run(transaction.objectStore(bucket)).then(resolve).catch(reject)
    })
  }

  const store: OfflineStore = {
    async get<T>(bucket: Bucket, key: string) {
      const row = await tx<Row | undefined>(bucket, 'readonly', (objectStore) => request(objectStore.get(key)))
      return row ? ({ value: row.value as T, at: row.at } as CacheEntry<T>) : null
    },

    async put<T>(bucket: Bucket, key: string, value: T, at?: number) {
      await tx(bucket, 'readwrite', (objectStore) =>
        request(objectStore.put({ key, value, at: at ?? now() } satisfies Row))
      )
    },

    async all<T>(bucket: Bucket) {
      // `getAll` returns rows in key order; the queue sorts by its own
      // timestamp, so key order never decides what is sent first.
      const rows = await tx<Row[]>(bucket, 'readonly', (objectStore) => request(objectStore.getAll()))
      return rows.map((row) => ({ value: row.value as T, at: row.at }))
    },

    async remove(bucket: Bucket, key: string) {
      await tx(bucket, 'readwrite', (objectStore) => request(objectStore.delete(key)))
    },

    async clear(bucket: Bucket) {
      await tx(bucket, 'readwrite', (objectStore) => request(objectStore.clear()))
    },

    async size() {
      let total = 0
      for (const bucket of BUCKETS) {
        total += await tx<number>(bucket, 'readonly', (objectStore) => request(objectStore.count()))
      }
      return total
    },
  }

  return store
}

/**
 * IndexedDB where it exists, memory where it does not.
 *
 * Returns the store and whether it persists, because a till that queues a sale
 * into memory should tell the cashier that closing the tab loses it. Silently
 * pretending is the one behaviour that is not acceptable here.
 */
export async function openOfflineStore(
  now: () => number = () => Date.now()
): Promise<{ store: OfflineStore; persistent: boolean; reason?: string }> {
  const memory = await import('./memory-store')
  try {
    return { store: await createIndexedDbStore(now), persistent: true }
  } catch (error) {
    return {
      store: memory.createMemoryStore(now),
      persistent: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
