import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

interface MekholiDB extends DBSchema {
  products: { key: string; value: any; indexes: { 'barcode': string; 'name': string } }
  customers: { key: string; value: any; indexes: { 'phone': string } }
  outbox: { key: number; value: { id?: number; table: string; payload: any; tries: number; ts: number; error?: string }; indexes: { 'table': string } }
  meta: { key: string; value: any }
}

let dbPromise: Promise<IDBPDatabase<MekholiDB>> | null = null

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<MekholiDB>('mekholi', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('products')) {
          const s = db.createObjectStore('products', { keyPath: 'id' })
          s.createIndex('barcode', 'barcode')
          s.createIndex('name', 'name')
        }
        if (!db.objectStoreNames.contains('customers')) {
          const s = db.createObjectStore('customers', { keyPath: 'id' })
          s.createIndex('phone', 'phone')
        }
        if (!db.objectStoreNames.contains('outbox')) {
          const s = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
          s.createIndex('table', 'table')
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
      }
    })
  }
  return dbPromise!
}

export async function enqueue(table: string, payload: any) {
  const db = await getDB()
  // save payload in its own store for local read (optional)
  try { if (table === 'products' || table === 'customers') await db.put(table as any, payload) } catch {}
  await db.add('outbox', { table, payload, tries: 0, ts: Date.now() })
  trySync()
}

export async function getOutboxCount(): Promise<number> {
  const db = await getDB()
  return db.count('outbox')
}

export async function trySync(): Promise<void> {
  if (!navigator.onLine) return
  const { supabase, isSupabaseConfigured } = await import('./supabase')
  if (!isSupabaseConfigured) return
  const db = await getDB()
  const tx = db.transaction('outbox', 'readwrite')
  const all = await tx.store.getAll()
  for (const item of all) {
    try {
      const { error } = await supabase.from(item.table as any).upsert(item.payload, { onConflict: 'client_uuid' } as any)
      if (error) throw error
      await tx.store.delete(item.id!)
    } catch (e: any) {
      item.tries += 1
      item.error = e?.message || String(e)
      if (item.tries > 10) {
        // leave in outbox, will show banner
      }
      await tx.store.put(item)
      break // stop on first failure, retry later
    }
  }
  await tx.done
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => trySync())
  setInterval(() => trySync(), 30000)
}
