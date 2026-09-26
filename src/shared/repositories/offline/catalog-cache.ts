/**
 * The catalogue, kept where the till can still read it.
 *
 * A POS that cannot show its products when the wifi drops is not offline — it
 * is broken with extra steps. So every successful read feeds a local copy, and
 * when the network is gone the same questions are answered from it.
 *
 * What is deliberately *not* cached is anything that decides money or stock:
 *
 *   · Prices are cached for display, and the server recomputes them at
 *     completion from the same catalogue rows. A stale price on screen is a
 *     display problem; a stale price in a sale is impossible, because
 *     `complete_sale` never reads a price the client sends (§44, docs/02 §2).
 *   · Availability shown offline is the last known balance, and it is labelled
 *     as such (`cachedAt`). It is never used to refuse a sale: refusing would
 *     turn "we might not have it" into "we will not sell it". The server
 *     decides, and its answer is what the queue records (roadmap: server wins
 *     for stock).
 *
 * The cached shape is `SellableProduct` — the contract's own row — rather than
 * a copy of it, so the offline grid renders through exactly the code the online
 * one uses and cannot drift into a second interpretation of a product.
 */

import type {
  CatalogRepository,
  ProductQuery,
  SellableProduct,
} from '../contracts'
import type { CacheEntry, OfflineStore } from './store'

const CATALOG = 'catalog' as const
const META = 'meta' as const

/** Keys for the small lists, which live beside the products in the same bucket. */
const LIST_KEYS: Record<string, string> = {
  categories: 'list:categories',
  brands: 'list:brands',
  units: 'list:units',
  taxes: 'list:taxes',
  payment_methods: 'list:paymentMethods',
}

export interface CatalogCacheOptions {
  now?: () => number
  /**
   * How many rows a warming pass will pull. A shop with more products than
   * this keeps working offline for everything it has opened and for its whole
   * first page; the cap stops a phone from downloading a warehouse.
   */
  warmLimit?: number
  /** Rows per page while warming. */
  pageSize?: number
}

export interface CatalogCache {
  repository: CatalogRepository
  /** Pull the catalogue into the cache. Safe to call often; cheap when fresh. */
  warm(warehouseId: string): Promise<{ rows: number; complete: boolean }>
  /** When the local copy was last refreshed, or null if it never was. */
  cachedAt(): Promise<number | null>
  /** How many products the local copy holds. */
  size(): Promise<number>
  /** Forget everything. Used on sign-out, so a shared till keeps nothing. */
  clear(): Promise<void>
}

const PRODUCT_PREFIX = 'product:'

/** Cheap, deterministic normalisation for the offline search. */
function normalise(value: string): string {
  return value.trim().toLowerCase()
}

function matches(row: SellableProduct, query: ProductQuery): boolean {
  if (query.categoryId && row.categoryName === null) return false
  if (query.onlyInStock && row.trackStock && (row.availableQty ?? 0) <= 0) return false
  const search = query.search ? normalise(query.search) : ''
  if (search === '') return true
  return (
    normalise(row.name).includes(search) ||
    normalise(row.variantName ?? '').includes(search) ||
    normalise(row.sku ?? '') === search ||
    normalise(row.sku ?? '').includes(search)
  )
}

export function createCatalogCache(
  next: CatalogRepository,
  store: OfflineStore,
  options: CatalogCacheOptions = {}
): CatalogCache {
  const now = options.now ?? (() => Date.now())
  const warmLimit = options.warmLimit ?? 2000
  const pageSize = options.pageSize ?? 200

  const remember = async (rows: SellableProduct[]): Promise<void> => {
    for (const row of rows) {
      await store.put(CATALOG, `${PRODUCT_PREFIX}${row.variantId}`, row)
    }
  }

  const cachedRows = async (): Promise<SellableProduct[]> => {
    const entries = await store.all<SellableProduct>(CATALOG)
    return entries.map((entry) => entry.value).filter((row) => row !== null && row !== undefined)
  }

  const rememberList = async <T>(key: string, value: T): Promise<void> => {
    await store.put(META, key, value)
  }

  const cachedList = async <T>(key: string): Promise<CacheEntry<T> | null> => store.get<T>(META, key)

  /**
   * Read through: the network first, the cache when it cannot be reached.
   *
   * The fallback's answer is three-valued, and the difference matters:
   *
   *   a value      the cache answers this
   *   `null`       the cache's answer is *nothing here* — a barcode the shop
   *                does not stock, which is a real answer a till can give
   *   `undefined`  the cache cannot answer — and then the original error is
   *                re-thrown, because an empty category list or an empty
   *                catalogue is a far worse lie than "the connection is down"
   */
  const readThrough = async <T>(
    read: () => Promise<T>,
    fallback: () => Promise<T | null | undefined>
  ): Promise<T> => {
    try {
      return await read()
    } catch (error) {
      const cached = await fallback()
      if (cached !== undefined) return cached as T
      throw error
    }
  }

  const repository: CatalogRepository = {
    async searchProducts(query) {
      try {
        const page = await next.searchProducts(query)
        await remember(page.items)
        await store.put(META, 'catalog:at', now())
        return page
      } catch (error) {
        const cached = await cachedRows()
        // No catalogue at all: this is not the moment to show an empty shop.
        if (cached.length === 0) throw error
        const rows = cached.filter((row) => matches(row, query))
        // Paging offline is over a stable, sorted snapshot: the same query
        // returns the same order twice, so a cursor that is really an offset
        // is honest here even though the online cursor is opaque.
        const offset = Number(query.cursor ?? 0) || 0
        const limit = query.limit ?? pageSize
        rows.sort((a, b) => a.name.localeCompare(b.name) || a.variantId.localeCompare(b.variantId))
        const slice = rows.slice(offset, offset + limit)
        return {
          items: slice,
          nextCursor: offset + limit < rows.length ? String(offset + limit) : null,
        }
      }
    },

    async findByBarcode(code, warehouseId) {
      return readThrough(
        () => next.findByBarcode(code, warehouseId),
        async () => {
          const rows = await cachedRows()
          // "No product matches that code" is a real answer — but only from a
          // catalogue that is actually here. With nothing cached the till has
          // no business claiming the shop does not sell the item.
          if (rows.length === 0) return undefined
          const wanted = normalise(code)
          return rows.find((row) => normalise(row.sku ?? '') === wanted) ?? null
        }
      )
    },

    async findByVariantId(variantId, warehouseId) {
      return readThrough(
        () => next.findByVariantId(variantId, warehouseId),
        async () => {
          const entry = await store.get<SellableProduct>(CATALOG, `${PRODUCT_PREFIX}${variantId}`)
          if (entry) return entry.value
          // Same rule as the barcode: a cache with rows in it may say "not
          // here"; an empty one may not.
          return (await cachedRows()).length === 0 ? undefined : null
        }
      )
    },

    listCategories: () =>
      readThrough(
        () => next.listCategories(),
        async () => (await cachedList<Awaited<ReturnType<CatalogRepository['listCategories']>>>('list:categories'))?.value
      ),
    createCategory: (name, parentId) => next.createCategory(name, parentId),
    listBrands: () =>
      readThrough(
        () => next.listBrands(),
        async () => (await cachedList<Awaited<ReturnType<CatalogRepository['listBrands']>>>('list:brands'))?.value
      ),
    createBrand: (name) => next.createBrand(name),
    listUnits: () =>
      readThrough(
        () => next.listUnits(),
        async () => (await cachedList<Awaited<ReturnType<CatalogRepository['listUnits']>>>('list:units'))?.value
      ),
    listTaxes: () =>
      readThrough(
        () => next.listTaxes(),
        async () => (await cachedList<Awaited<ReturnType<CatalogRepository['listTaxes']>>>('list:taxes'))?.value
      ),
    listPaymentMethods: () =>
      readThrough(
        () => next.listPaymentMethods(),
        async () => (await cachedList<Awaited<ReturnType<CatalogRepository['listPaymentMethods']>>>('list:paymentMethods'))?.value
      ),
  }

  /**
   * The lists are cached on the way *out*, not through `readThrough`: the
   * wrapper above can only store what the caller asked for, and a warm pass
   * should leave the shop able to render its filters offline too.
   */
  const warming = async (warehouseId: string): Promise<{ rows: number; complete: boolean }> => {
    let rows = 0
    let cursor: string | null = null
    let complete = false

    for (let guard = 0; guard < 50; guard += 1) {
      const page: Awaited<ReturnType<CatalogRepository['searchProducts']>> = await next.searchProducts({
        warehouseId,
        limit: pageSize,
        ...(cursor ? { cursor } : {}),
      })
      await remember(page.items)
      rows += page.items.length
      cursor = page.nextCursor
      if (!cursor || rows >= warmLimit) {
        complete = cursor === null
        break
      }
    }

    const [categories, brands, units, taxes, methods] = await Promise.all([
      next.listCategories(),
      next.listBrands(),
      next.listUnits(),
      next.listTaxes(),
      next.listPaymentMethods(),
    ])
    await Promise.all([
      rememberList(LIST_KEYS.categories!, categories),
      rememberList(LIST_KEYS.brands!, brands),
      rememberList(LIST_KEYS.units!, units),
      rememberList(LIST_KEYS.taxes!, taxes),
      rememberList(LIST_KEYS.payment_methods!, methods),
      store.put(META, 'catalog:at', now()),
      store.put(META, 'catalog:count', rows),
    ])

    return { rows, complete }
  }

  return {
    repository,
    warm: warming,
    async cachedAt() {
      const entry = await store.get<number>(META, 'catalog:at')
      return entry?.value ?? null
    },
    async size() {
      return (await cachedRows()).length
    },
    async clear() {
      await store.clear(CATALOG)
    },
  }
}
