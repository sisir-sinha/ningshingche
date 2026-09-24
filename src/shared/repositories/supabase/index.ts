/**
 * The PostgREST + RPC data source (docs/02 §2).
 *
 * The split is the whole design: **reads** go through PostgREST, which is
 * cacheable, composable and works offline against a mirror; **writes** go
 * through Postgres functions, because a sale has to lock the stock rows, check
 * the balance, move the ledger and publish the outbox event as one atomic act.
 * A client that inserted `sales`, `sale_items` and `stock_movements` itself
 * would have to reimplement all four and get the locking wrong.
 *
 * The client is injected rather than imported. `shared/` stays free of the app
 * layer, the repositories become testable against a stub, and swapping in an
 * IndexedDB implementation later touches the composition root only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Brand,
  Category,
  CompletedSale,
  CustomerRow,
  Page,
  PaymentMethod,
  PosCatalogRow,
  ProductRow,
  RegisterRow,
  RegisterSessionRow,
  ResumedSale,
  SaleRow,
  Tax,
  Unit,
  VariantRow,
} from '../../types/records'
import type {
  CatalogRepository,
  CustomerRepository,
  OrganizationRepository,
  ProductRepository,
  RegisterRepository,
  StockMovementRow,
  StockOperationResult,
  StockRepository,
  StockRow,
  WarehouseOption,
  Repositories,
  SaleRepository,
  SellableProduct,
  SalesFloor,
} from '../contracts'
import {
  milli,
  milliToNumber,
  minor,
  minorToNumber,
  type Milli,
  type Minor,
} from '../../domain/money'
import type { SaleItemPayload, SalePaymentPayload } from '../../domain/cart'

// ── Conversion ────────────────────────────────────────────────────────────
// Postgres `numeric` crosses PostgREST as a string. Converting here, once, is
// what stops a feature from doing `Number(row.total)` somewhere and silently
// losing precision on a large invoice.

function toMinor(value: string | number | null | undefined): Minor {
  if (value === null || value === undefined || value === '') return minor(0)
  return minor(Math.round(Number(value) * 100))
}

function toMilli(value: string | number | null | undefined): Milli {
  if (value === null || value === undefined || value === '') return milli(0)
  return milli(Math.round(Number(value) * 1000))
}

/** Cost is `numeric(14,4)`, finer than money; kept as integer ten-thousandths. */
function toCost(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  return Math.round(Number(value) * 10000)
}

function toRate(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  return Number(value)
}

/** PostgREST reports failure by setting `error`; throw so callers use try/catch. */
function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw result.error
  return result.data as T
}

const MAX_LIMIT = 200

function clampLimit(limit: number | undefined, fallback: number): number {
  const value = limit ?? fallback
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)))
}

// ── Keyset pagination ─────────────────────────────────────────────────────

/**
 * Cursor for `(created_at desc, id desc)`.
 *
 * Offset paging would both slow down as the offset grows and shift rows when
 * a sale lands while the cashier scrolls — on a shop floor that is constantly.
 * The cursor is the last row's sort key, base64 so it is opaque and URL-safe.
 */
function encodeCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`)
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = atob(cursor).split('|')
    if (!createdAt || !id) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

/**
 * The one method this module needs from a query builder, named structurally.
 *
 * `PostgrestFilterBuilder` takes up to eight type parameters that describe the
 * generated schema. Naming it here would couple this file to generated types
 * the project deliberately does not use; describing the single method it
 * actually calls does not.
 */
interface Chainable<Self> {
  or(filters: string, options?: { foreignTable?: string }): Self
}

/** Apply "rows strictly after the cursor" to a time-ordered query. */
function afterCursor<T extends Chainable<T>>(builder: T, cursor: string | null | undefined): T {
  if (!cursor) return builder
  const decoded = decodeCursor(cursor)
  if (!decoded) return builder
  // Nested and() inside or() is how PostgREST expresses the tuple comparison
  // `(created_at, id) < (c, i)` — there is no row-value operator in the API.
  return builder.or(
    `created_at.lt.${decoded.createdAt},and(created_at.eq.${decoded.createdAt},id.lt.${decoded.id})`
  )
}

function paginate<T extends { id: string; created_at: string }>(
  rows: T[],
  limit: number
): Page<T> {
  const last = rows[rows.length - 1]
  const hasMore = rows.length === limit
  return {
    items: rows,
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  }
}

/**
 * Cursor for `stock_balances`, which has no `id`/`created_at` of its own —
 * it is keyed by (warehouse, variant) and updated in place. Paging on
 * `(updated_at, variant_id)` keeps the same "rows after this point" guarantee.
 */
function encodeStockCursor(updatedAt: string, variantId: string): string {
  return btoa(`${updatedAt}|${variantId}`)
}

function decodeStockCursor(cursor: string): { updatedAt: string; variantId: string } | null {
  try {
    const [updatedAt, variantId] = atob(cursor).split('|')
    if (!updatedAt || !variantId) return null
    return { updatedAt, variantId }
  } catch {
    return null
  }
}

function stockAfterCursor<T extends Chainable<T>>(builder: T, cursor: string | null | undefined): T {
  if (!cursor) return builder
  const decoded = decodeStockCursor(cursor)
  if (!decoded) return builder
  return builder.or(
    `updated_at.lt.${decoded.updatedAt},and(updated_at.eq.${decoded.updatedAt},variant_id.lt.${decoded.variantId})`
  )
}

function stockNextCursor(rows: { updated_at: string; variant_id: string }[], limit: number): string | null {
  const last = rows[rows.length - 1]
  if (rows.length < limit || !last) return null
  return encodeStockCursor(last.updated_at, last.variant_id)
}

/** Escape the characters PostgREST treats as operators inside an `or` value. */
function likeTerm(search: string): string {
  return search.trim().replace(/[,()]/g, ' ').replace(/\s+/g, ' ')
}

// ── Catalogue ─────────────────────────────────────────────────────────────

function toSellable(row: PosCatalogRow): SellableProduct {
  return {
    productId: row.product_id,
    variantId: row.variant_id,
    name: row.name,
    variantName: row.variant_name,
    sku: row.effective_sku,
    imageUrl: row.image_url,
    price: toMinor(row.price),
    cost: toCost(row.cost),
    taxRatePercent: toRate(row.tax_rate),
    taxInclusive: row.tax_inclusive,
    trackStock: row.track_stock,
    allowNegative: row.allow_negative,
    // A variant with no balance row has never been stocked: 0, not unknown.
    availableQty: row.track_stock ? toMilli(row.available) : null,
    unitLabel: row.unit_label,
    decimalQuantity: row.decimal_quantity,
    categoryName: row.category_name,
  }
}

const CATALOG_SELECT = [
  'organization_id',
  'product_id',
  'name',
  'sku',
  'description',
  'image_url',
  'track_stock',
  'allow_negative',
  'tax_inclusive',
  'category_id',
  'category_name',
  'reorder_point',
  'metadata',
  'variant_id',
  'variant_name',
  'effective_sku',
  'price',
  'cost',
  'is_default',
  'unit_label',
  'decimal_quantity',
  'tax_rate',
  'warehouse_id',
  'available',
].join(',')

function createCatalog(client: SupabaseClient, organizationId: () => string | null): CatalogRepository {
  return {
    async searchProducts(query) {
      const limit = clampLimit(query.limit, 24)
      // Unstocked variants have a null warehouse_id and must still appear —
      // a brand-new product with no stock yet is exactly what a shop adds
      // first, and hiding it would look like a failed save.
      let builder = client
        .from('pos_catalog')
        .select(CATALOG_SELECT)
        .or(`warehouse_id.eq.${query.warehouseId},warehouse_id.is.null`)
        .order('name', { ascending: true })
        .limit(limit)

      const search = likeTerm(query.search ?? '')
      if (search) {
        builder = builder.or(`search_text.ilike.*${search}*,name.ilike.*${search}*`)
      }
      if (query.categoryId) builder = builder.eq('category_id', query.categoryId)
      if (query.onlyInStock) builder = builder.gt('available', 0)

      const rows = unwrap(await builder.returns<PosCatalogRow[]>())
      return { items: rows.map(toSellable), nextCursor: null }
    },

    async findByVariantId(variantId, warehouseId) {
      const rows = unwrap(
        await client
          .from('pos_catalog')
          .select(CATALOG_SELECT)
          .eq('variant_id', variantId)
          .or(`warehouse_id.eq.${warehouseId},warehouse_id.is.null`)
          .limit(1)
          .returns<PosCatalogRow[]>()
      )
      const row = rows[0]
      return row ? toSellable(row) : null
    },

    async findByBarcode(code, warehouseId) {
      const trimmed = code.trim()
      if (!trimmed) return null
      const hits = unwrap(
        await client
          .from('product_barcodes')
          .select('variant_id')
          .eq('code', trimmed)
          .limit(1)
          .returns<{ variant_id: string }[]>()
      )
      const variantId = hits[0]?.variant_id
      if (!variantId) return null

      const rows = unwrap(
        await client
          .from('pos_catalog')
          .select(CATALOG_SELECT)
          .eq('variant_id', variantId)
          .or(`warehouse_id.eq.${warehouseId},warehouse_id.is.null`)
          .limit(1)
          .returns<PosCatalogRow[]>()
      )
      const row = rows[0]
      return row ? toSellable(row) : null
    },

    async listCategories() {
      const rows = unwrap(
        await client
          .from('product_categories')
          .select('id,name,slug,parent_id,sort_order,is_active')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('sort_order')
          .order('name')
          .returns<Category[]>()
      )
      return rows
    },

    async listBrands() {
      return unwrap(
        await client
          .from('product_brands')
          .select('id,name')
          .is('deleted_at', null)
          .order('name')
          .returns<Brand[]>()
      )
    },

    async listUnits() {
      return unwrap(
        await client
          .from('product_units')
          .select('id,name,symbol,is_decimal,sort_order')
          .is('deleted_at', null)
          .order('sort_order')
          .order('name')
          .returns<Unit[]>()
      )
    },

    async listTaxes() {
      return unwrap(
        await client
          .from('taxes')
          .select('id,name,rate,is_inclusive,is_active')
          .eq('is_active', true)
          .order('rate')
          .returns<Tax[]>()
      )
    },

    async listPaymentMethods() {
      return unwrap(
        await client
          .from('payment_methods')
          .select('id,key,name,type,is_cash,is_active,sort_order,icon,config')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('sort_order')
          .returns<PaymentMethod[]>()
      )
    },
  }
  // `organizationId` is intentionally unused: RLS scopes every read to the
  // caller's organization, so filtering again in the client would be a second
  // source of truth that can disagree with the database.
  void organizationId
}

// ── Products ──────────────────────────────────────────────────────────────

const PRODUCT_SELECT = [
  'id',
  'name',
  'sku',
  'description',
  'category_id',
  'brand_id',
  'unit_id',
  'tax_id',
  'selling_price',
  'cost_price',
  'tax_inclusive',
  'reorder_point',
  'track_stock',
  'allow_negative',
  'is_active',
  'image_url',
  'metadata',
  'created_at',
].join(',')

/** `numeric` goes back as a fixed string, never a float in scientific form. */
function numeric(value: number, decimals: number): string {
  return value.toFixed(decimals)
}

/**
 * The tenant id every write must carry.
 *
 * `organization_id` is NOT NULL with no column default and there is no
 * `app.org_id()` SQL helper, so PostgREST cannot infer it. Omitting it does
 * not produce a not-null error either — the RLS insert policy evaluates
 * `app.in_org(null)` and answers 42501, which reads like a permissions bug
 * when it is really a missing column. Say so plainly instead.
 */
function requireOrg(organizationId: () => string | null): string {
  const id = organizationId()
  if (!id) {
    throw new Error('No active organization. Select a shop before saving.')
  }
  return id
}

function createProducts(
  client: SupabaseClient,
  organizationId: () => string | null
): ProductRepository {
  return {
    async list(query) {
      const limit = clampLimit(query.limit, 25)
      let builder = client
        .from('products')
        .select(PRODUCT_SELECT)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit)

      builder = afterCursor(builder, query.cursor)

      const search = query.search?.trim()
      if (search) builder = builder.ilike('search_text', `%${search.toLowerCase()}%`)
      if (query.categoryId) builder = builder.eq('category_id', query.categoryId)

      return paginate(unwrap(await builder.returns<ProductRow[]>()), limit)
    },

    async get(id) {
      const rows = unwrap(
        await client
          .from('products')
          .select(PRODUCT_SELECT)
          .eq('id', id)
          .is('deleted_at', null)
          .limit(1)
          .returns<ProductRow[]>()
      )
      return rows[0] ?? null
    },

    async getWithVariants(id) {
      const product = await this.get(id)
      if (!product) return null
      const variants = unwrap(
        await client
          .from('product_variants')
          .select('id,product_id,is_default,sku,name_suffix,price_override,cost_override,is_active')
          .eq('product_id', id)
          .is('deleted_at', null)
          .order('is_default', { ascending: false })
          .returns<VariantRow[]>()
      )
      return { product, variants }
    },

    async create(draft) {
      // The default variant is created in the same round trip. A product
      // without one cannot be sold — `sale_items.variant_id` is NOT NULL and
      // `complete_sale` resolves stock per variant — so leaving that to a
      // second call would leave a window where the product is unsellable.
      const inserted = unwrap(
        await client
          .from('products')
          .insert({
            organization_id: requireOrg(organizationId),
            name: draft.name,
            sku: draft.sku ?? null,
            description: draft.description ?? null,
            category_id: draft.category_id ?? null,
            brand_id: draft.brand_id ?? null,
            unit_id: draft.unit_id ?? null,
            tax_id: draft.tax_id ?? null,
            selling_price: numeric(draft.selling_price, 2),
            cost_price: numeric(draft.cost_price, 4),
            tax_inclusive: draft.tax_inclusive,
            reorder_point: numeric(draft.reorder_point, 3),
            track_stock: draft.track_stock,
            allow_negative: draft.allow_negative,
            is_active: draft.is_active,
            image_url: draft.image_url ?? null,
            metadata: draft.metadata,
          })
          .select(PRODUCT_SELECT)
          .limit(1)
          .returns<ProductRow[]>()
      )
      const product = inserted[0]
      if (!product) throw new Error('The product was not created')

      const variantError = await client
        .from('product_variants')
        .insert({
          organization_id: requireOrg(organizationId),
          product_id: product.id,
          is_default: true,
        })
      if (variantError.error) throw variantError.error

      return product
    },

    async update(id, draft) {
      const patch: Record<string, unknown> = {}
      if (draft.name !== undefined) patch.name = draft.name
      if (draft.sku !== undefined) patch.sku = draft.sku
      if (draft.description !== undefined) patch.description = draft.description
      if (draft.category_id !== undefined) patch.category_id = draft.category_id
      if (draft.brand_id !== undefined) patch.brand_id = draft.brand_id
      if (draft.unit_id !== undefined) patch.unit_id = draft.unit_id
      if (draft.tax_id !== undefined) patch.tax_id = draft.tax_id
      if (draft.selling_price !== undefined) patch.selling_price = numeric(draft.selling_price, 2)
      if (draft.cost_price !== undefined) patch.cost_price = numeric(draft.cost_price, 4)
      if (draft.tax_inclusive !== undefined) patch.tax_inclusive = draft.tax_inclusive
      if (draft.reorder_point !== undefined) patch.reorder_point = numeric(draft.reorder_point, 3)
      if (draft.track_stock !== undefined) patch.track_stock = draft.track_stock
      if (draft.allow_negative !== undefined) patch.allow_negative = draft.allow_negative
      if (draft.is_active !== undefined) patch.is_active = draft.is_active
      if (draft.image_url !== undefined) patch.image_url = draft.image_url
      if (draft.metadata !== undefined) patch.metadata = draft.metadata

      const updated = unwrap(
        await client
          .from('products')
          .update(patch)
          .eq('id', id)
          .select(PRODUCT_SELECT)
          .limit(1)
          .returns<ProductRow[]>()
      )
      const product = updated[0]
      if (!product) throw new Error('The product was not updated')
      return product
    },

    async archive(id) {
      const { error } = await client
        .from('products')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', id)
      if (error) throw error
    },

    async duplicate(id) {
      const source = await this.get(id)
      if (!source) throw new Error('Product not found')
      return this.create({
        name: `${source.name} (copy)`,
        // No SKU: it is unique per organization and a copied code would
        // either collide or silently create two products with one barcode.
        // `create` supplies the tenant id, so it is not repeated here.
        sku: null,
        description: source.description,
        category_id: source.category_id,
        brand_id: source.brand_id,
        unit_id: source.unit_id,
        tax_id: source.tax_id,
        selling_price: Number(source.selling_price),
        cost_price: Number(source.cost_price),
        tax_inclusive: source.tax_inclusive,
        reorder_point: Number(source.reorder_point),
        track_stock: source.track_stock,
        allow_negative: source.allow_negative,
        is_active: true,
        image_url: source.image_url,
        metadata: { ...source.metadata, duplicated_from: id },
      })
    },
  }
}

// ── Sales ─────────────────────────────────────────────────────────────────

function createSales(client: SupabaseClient): SaleRepository {
  return {
    async complete(input) {
      // Named arguments: with ten parameters and several optional ones, a
      // positional call silently mis-binds when a parameter is inserted.
      const args: Record<string, unknown> = {
        p_branch_id: input.branchId,
        p_items: input.items,
        p_payments: input.payments,
      }
      if (input.registerId) args.p_register_id = input.registerId
      if (input.customerId) args.p_customer_id = input.customerId
      if (input.warehouseId) args.p_warehouse_id = input.warehouseId
      if (input.discountType) args.p_discount_type = input.discountType
      if (input.discountValue !== undefined && input.discountValue > 0) {
        args.p_discount_value = input.discountValue
      }
      if (input.note) args.p_note = input.note
      if (input.heldSaleId) args.p_held_sale_id = input.heldSaleId

      const { data, error } = await client.rpc('complete_sale', args)
      if (error) throw error
      return data as CompletedSale
    },

    async hold(input) {
      const args: Record<string, unknown> = {
        p_branch_id: input.branchId,
        p_items: input.items,
      }
      if (input.customerId) args.p_customer_id = input.customerId
      if (input.note) args.p_note = input.note

      const { data, error } = await client.rpc('hold_sale', args)
      if (error) throw error
      return data as string
    },

    async resume(saleId) {
      const { data, error } = await client.rpc('resume_sale', { p_sale_id: saleId })
      if (error) throw error
      return data as ResumedSale
    },

    async list(query) {
      const limit = clampLimit(query.limit, 25)
      let builder = client
        .from('sales')
        .select(
          'id,invoice_no,status,branch_id,register_id,session_id,customer_id,currency,' +
            'subtotal,discount_total,discount_type,discount_value,tax_total,total,' +
            'paid_total,change_due,cogs,profit,note,created_at,completed_at,created_by,' +
            'customer:customers(id,name,phone)'
        )
        .eq('branch_id', query.branchId)
        .not('status', 'in', '(DRAFT,CANCELLED)')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit)

      builder = afterCursor(builder, query.cursor)
      if (query.status && query.status.length > 0) {
        builder = builder.in('status', query.status)
      }

      return paginate(unwrap(await builder.returns<SaleRow[]>()), limit)
    },

    async get(id) {
      const rows = unwrap(
        await client
          .from('sales')
          .select(
            'id,invoice_no,status,branch_id,register_id,session_id,customer_id,currency,' +
              'subtotal,discount_total,discount_type,discount_value,tax_total,total,' +
              'paid_total,change_due,cogs,profit,note,created_at,completed_at,created_by,' +
              'customer:customers(id,name,phone),' +
              'items:sale_items(id,variant_id,product_id,product_name,variant_name,sku,' +
              'unit_label,quantity,unit_price,unit_cost,discount_type,discount_value,' +
              'discount_total,tax_rate,tax_total,line_total,line_cogs,returned_qty),' +
              'payments:sale_payments(id,method_id,amount,reference,created_at,' +
              'method:payment_methods(key,name))'
          )
          .eq('id', id)
          .limit(1)
          .returns<SaleRow[]>()
      )
      return rows[0] ?? null
    },

    async held(branchId) {
      return unwrap(
        await client
          .from('sales')
          .select(
            'id,invoice_no,status,branch_id,register_id,session_id,customer_id,currency,' +
              'subtotal,discount_total,discount_type,discount_value,tax_total,total,' +
              'paid_total,change_due,cogs,profit,note,created_at,completed_at,created_by,' +
              'customer:customers(id,name,phone)'
          )
          .eq('branch_id', branchId)
          .eq('status', 'HELD')
          .order('created_at', { ascending: false })
          .returns<SaleRow[]>()
      )
    },

    async byCustomer(customerId, query) {
      const limit = clampLimit(query?.limit, 25)
      let builder = client
        .from('sales')
        .select(
          'id,invoice_no,status,branch_id,register_id,session_id,customer_id,currency,' +
            'subtotal,discount_total,discount_type,discount_value,tax_total,total,' +
            'paid_total,change_due,cogs,profit,note,created_at,completed_at,created_by'
        )
        .eq('customer_id', customerId)
        .in('status', ['COMPLETED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'])
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit)

      builder = afterCursor(builder, query?.cursor)
      return paginate(unwrap(await builder.returns<SaleRow[]>()), limit)
    },
  }
}

// ── Customers ─────────────────────────────────────────────────────────────

const CUSTOMER_SELECT =
  'id,name,phone,email,address,credit_limit,balance,store_credit,note,created_at'

function createCustomers(
  client: SupabaseClient,
  organizationId: () => string | null
): CustomerRepository {
  return {
    async list(query) {
      const limit = clampLimit(query.limit, 25)
      let builder = client
        .from('customers')
        .select(CUSTOMER_SELECT)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit)

      builder = afterCursor(builder, query.cursor)
      const search = query.search?.trim()
      if (search) {
        builder = builder.or(`name.ilike.*${likeTerm(search)}*,phone.ilike.*${likeTerm(search)}*`)
      }

      return paginate(unwrap(await builder.returns<CustomerRow[]>()), limit)
    },

    async get(id) {
      const rows = unwrap(
        await client
          .from('customers')
          .select(CUSTOMER_SELECT)
          .eq('id', id)
          .is('deleted_at', null)
          .limit(1)
          .returns<CustomerRow[]>()
      )
      return rows[0] ?? null
    },

    async create(draft) {
      const inserted = unwrap(
        await client
          .from('customers')
          .insert({
            organization_id: requireOrg(organizationId),
            name: draft.name,
            phone: draft.phone ?? null,
            email: draft.email ?? null,
            address: draft.address ?? null,
            note: draft.note ?? null,
          })
          .select(CUSTOMER_SELECT)
          .limit(1)
          .returns<CustomerRow[]>()
      )
      const customer = inserted[0]
      if (!customer) throw new Error('The customer was not created')
      return customer
    },

    async update(id, draft) {
      const patch: Record<string, unknown> = {}
      if (draft.name !== undefined) patch.name = draft.name
      if (draft.phone !== undefined) patch.phone = draft.phone
      if (draft.email !== undefined) patch.email = draft.email
      if (draft.address !== undefined) patch.address = draft.address
      if (draft.note !== undefined) patch.note = draft.note
      const updated = unwrap(
        await client
          .from('customers')
          .update(patch)
          .eq('id', id)
          .select(CUSTOMER_SELECT)
          .limit(1)
          .returns<CustomerRow[]>()
      )
      const customer = updated[0]
      if (!customer) throw new Error('The customer was not updated')
      return customer
    },
  }
}

// ── Register ──────────────────────────────────────────────────────────────

const SESSION_SELECT =
  'id,register_id,branch_id,opened_at,closed_at,opening_cash,closing_cash,' +
  'expected_cash,sales_cash,cash_in,cash_out,status,opened_by'

function createRegisters(client: SupabaseClient): RegisterRepository {
  return {
    async list(branchId) {
      return unwrap(
        await client
          .from('registers')
          .select('id,branch_id,name,is_active')
          .eq('branch_id', branchId)
          .eq('is_active', true)
          .order('name')
          .returns<RegisterRow[]>()
      )
    },

    async currentSession(branchId) {
      const rows = unwrap(
        await client
          .from('register_sessions')
          .select(SESSION_SELECT)
          .eq('branch_id', branchId)
          .eq('status', 'OPEN')
          .order('opened_at', { ascending: false })
          .limit(1)
          .returns<RegisterSessionRow[]>()
      )
      return rows[0] ?? null
    },

    async open(registerId, openingCash, note) {
      const args: Record<string, unknown> = {
        p_register_id: registerId,
        p_opening_cash: openingCash / 100,
      }
      if (note) args.p_note = note
      const { data, error } = await client.rpc('open_register', args)
      if (error) throw error
      return data as string
    },

    async close(sessionId, closingCash, note) {
      const args: Record<string, unknown> = {
        p_session_id: sessionId,
        p_closing_cash: closingCash / 100,
      }
      if (note) args.p_note = note
      const { error } = await client.rpc('close_register', args)
      if (error) throw error
    },

    async cashMovement(sessionId, amount, direction, note) {
      const args: Record<string, unknown> = {
        p_session_id: sessionId,
        p_amount: amount / 100,
        p_direction: direction,
      }
      if (note) args.p_note = note
      const { error } = await client.rpc('register_cash_movement', args)
      if (error) throw error
    },
  }
}

// ── Organization ──────────────────────────────────────────────────────────

function createOrganization(client: SupabaseClient): OrganizationRepository {
  return {
    async salesFloor(branchId) {
      const branches = unwrap(
        await client
          .from('branches')
          .select('id,name')
          .eq('id', branchId)
          .is('deleted_at', null)
          .limit(1)
          .returns<{ id: string; name: string }[]>()
      )
      const branch = branches[0]
      if (!branch) throw new Error('Branch not found')

      // The retail-floor warehouse first, because that is the one
      // complete_sale decrements when the client does not name one.
      const warehouses = unwrap(
        await client
          .from('warehouses')
          .select('id,name,is_retail_floor')
          .eq('branch_id', branchId)
          .is('deleted_at', null)
          .order('is_retail_floor', { ascending: false })
          .returns<{ id: string; name: string }[]>()
      )
      const warehouse = warehouses[0]
      if (!warehouse) throw new Error('This branch has no stock location')

      const registers = unwrap(
        await client
          .from('registers')
          .select('id,name')
          .eq('branch_id', branchId)
          .eq('is_active', true)
          .order('name')
          .returns<{ id: string; name: string }[]>()
      )

      // A register session is open while `closed_at` is null. There is no
      // `status` column on this table — filtering on one made PostgREST answer
      // 400 (column does not exist), which failed the whole floor resolve and
      // left the POS stuck on "The shop is still loading" for every shop.
      const sessions = unwrap(
        await client
          .from('register_sessions')
          .select('id')
          .eq('branch_id', branchId)
          .is('closed_at', null)
          .order('opened_at', { ascending: false })
          .limit(1)
          .returns<{ id: string }[]>()
      )

      return {
        branchId: branch.id,
        branchName: branch.name,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        registerId: registers[0]?.id ?? null,
        registerName: registers[0]?.name ?? null,
        sessionId: sessions[0]?.id ?? null,
      }
    },

    async listBranches() {
      return unwrap(
        await client
          .from('branches')
          .select('id,name,code,is_primary')
          .is('deleted_at', null)
          .order('is_primary', { ascending: false })
          .order('name')
          .returns<{ id: string; name: string; code: string | null; is_primary: boolean }[]>()
      )
    },
  }
}

// ── Stock (Phase 3) ───────────────────────────────────────────────────────

/** A row of the joined stock view, as PostgREST returns it (numeric = text). */
interface StockBalanceRow {
  quantity: string
  avg_unit_cost: string
  warehouse_id: string
  variant_id: string
  product_id: string
  updated_at: string
  warehouses: { name: string } | { name: string }[] | null
  product_variants:
    | { name_suffix: string | null; sku: string | null }
    | { name_suffix: string | null; sku: string | null }[]
    | null
  products:
    | { name: string; reorder_point: string; track_stock: boolean }
    | { name: string; reorder_point: string; track_stock: boolean }[]
    | null
}

interface MovementRowRaw {
  id: string
  created_at: string
  type: string
  direction: number
  quantity: string
  before_quantity: string
  after_quantity: string
  unit_cost: string
  warehouse_id: string
  warehouse_name: string
  variant_id: string
  product_name: string
  variant_name: string | null
  reference_type: string | null
  reference_id: string | null
  note: string | null
  user_id: string | null
}

/** PostgREST embeds a to-one join as an object, but the types say either. */
function embedded<T>(value: T | T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function toStockRow(row: StockBalanceRow): StockRow {
  const variant = embedded(row.product_variants)
  const product = embedded(row.products)
  const warehouse = embedded(row.warehouses)
  const quantity = toMilli(row.quantity)
  const reorderPoint = toMilli(product?.reorder_point)
  const avgUnitCost = toMinor(row.avg_unit_cost)
  return {
    variantId: row.variant_id,
    productId: row.product_id,
    productName: product?.name ?? 'Unknown product',
    variantName: variant?.name_suffix ?? null,
    sku: variant?.sku ?? null,
    warehouseId: row.warehouse_id,
    warehouseName: warehouse?.name ?? '—',
    quantity,
    avgUnitCost,
    // Rounded to a minor unit once, here, so the screens agree with each
    // other and with `stock_summary` (which rounds the same way).
    stockValue: toMinor(Number(row.quantity) * Number(row.avg_unit_cost)),
    reorderPoint,
    trackStock: product?.track_stock ?? true,
    isLow: Boolean(product?.track_stock) && quantity > 0 && quantity <= reorderPoint,
    isOut: Boolean(product?.track_stock) && quantity <= 0,
    updatedAt: row.updated_at,
  }
}

function toMovementRow(row: MovementRowRaw): StockMovementRow {
  const quantity = toMilli(row.quantity)
  const direction: 1 | -1 = row.direction < 0 ? -1 : 1
  return {
    id: row.id,
    createdAt: row.created_at,
    type: row.type,
    direction,
    quantity,
    delta: toMilli(Number(row.quantity) * direction),
    beforeQuantity: toMilli(row.before_quantity),
    afterQuantity: toMilli(row.after_quantity),
    // Displayed, not multiplied: rounding to a minor unit here is what the
    // screen shows anyway, and the exact figure stays in the ledger.
    unitCost: toMinor(row.unit_cost),
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
    variantId: row.variant_id,
    productName: row.product_name,
    variantName: row.variant_name,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    note: row.note,
    userId: row.user_id,
  }
}

const STOCK_SELECT = [
  'quantity',
  'avg_unit_cost',
  'warehouse_id',
  'variant_id',
  'product_id',
  'updated_at',
  'warehouses(name)',
  'product_variants(name_suffix,sku)',
  'products(name,reorder_point,track_stock)',
].join(',')

const MOVEMENT_SELECT = [
  'id',
  'created_at',
  'type',
  'direction',
  'quantity',
  'before_quantity',
  'after_quantity',
  'unit_cost',
  'warehouse_id',
  'warehouse_name',
  'variant_id',
  'product_name',
  'variant_name',
  'reference_type',
  'reference_id',
  'note',
  'user_id',
].join(',')

function createStock(
  client: SupabaseClient,
  organizationId: () => string | null
): StockRepository {
  return {
    async list(query) {
      const limit = clampLimit(query.limit, 25)
      let builder = client
        .from('stock_balances')
        .select(STOCK_SELECT)
        .order('updated_at', { ascending: false })
        .order('variant_id', { ascending: false })
        .limit(limit)

      builder = stockAfterCursor(builder, query.cursor)

      if (query.warehouseId) builder = builder.eq('warehouse_id', query.warehouseId)

      const rows = unwrap(await builder.returns<StockBalanceRow[]>())
      let items = rows.map(toStockRow)

      // Search, the low/out filters and the "worth showing at all" rule are
      // applied after the join, because they depend on the product rows and on
      // arithmetic across two of them. The alternative — filtering in SQL —
      // would need a view, and the visible set is a page of 25, so the cost is
      // bounded and the code stays in one place.
      const search = query.search?.trim().toLowerCase()
      if (search) {
        items = items.filter(
          (row) =>
            row.productName.toLowerCase().includes(search) ||
            (row.variantName ?? '').toLowerCase().includes(search) ||
            (row.sku ?? '').toLowerCase().includes(search)
        )
      }
      if (query.filter === 'low') items = items.filter((row) => row.isLow)
      if (query.filter === 'out') items = items.filter((row) => row.isOut)

      return { items, nextCursor: stockNextCursor(rows, limit) }
    },

    async history(variantId, query) {
      const limit = clampLimit(query.limit, 50)
      let builder = client
        .from('stock_history')
        .select(MOVEMENT_SELECT)
        .eq('variant_id', variantId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit)

      builder = afterCursor(builder, query.cursor)
      if (query.warehouseId) builder = builder.eq('warehouse_id', query.warehouseId)

      const rows = unwrap(await builder.returns<MovementRowRaw[]>())
      return { items: rows.map(toMovementRow), nextCursor: paginate(rows, limit).nextCursor }
    },

    async recent(query) {
      const limit = clampLimit(query.limit, 15)
      let builder = client
        .from('stock_history')
        .select(MOVEMENT_SELECT)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit)

      builder = afterCursor(builder, query.cursor)
      if (query.warehouseId) builder = builder.eq('warehouse_id', query.warehouseId)

      const rows = unwrap(await builder.returns<MovementRowRaw[]>())
      return { items: rows.map(toMovementRow), nextCursor: paginate(rows, limit).nextCursor }
    },

    async summary() {
      const raw = unwrap(
        await client.rpc('stock_summary', { p_organization_id: requireOrg(organizationId) })
      ) as {
        stock_value: string
        variants_in_stock: number
        low_stock: number
        out_of_stock: number
        warehouses: number
        movements_today: number
      }
      return {
        stockValue: toMinor(raw.stock_value),
        variantsInStock: Number(raw.variants_in_stock),
        lowStock: Number(raw.low_stock),
        outOfStock: Number(raw.out_of_stock),
        warehouses: Number(raw.warehouses),
        movementsToday: Number(raw.movements_today),
      }
    },

    async listWarehouses() {
      const rows = unwrap(
        await client
          .from('warehouses')
          .select('id,name,is_retail_floor')
          .is('deleted_at', null)
          .order('is_retail_floor', { ascending: false })
          .order('name')
          .returns<{ id: string; name: string; is_retail_floor: boolean }[]>()
      )
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        isRetailFloor: row.is_retail_floor,
      })) satisfies WarehouseOption[]
    },

    async stockIn(warehouseId, lines, options) {
      const result = unwrap(
        await client.rpc('stock_in', {
          p_warehouse_id: warehouseId,
          // Quantities and costs go back as plain numbers: PostgREST casts
          // them into numeric(14,3) / numeric(14,4), and the branded types
          // exist to stop accidental arithmetic, not to reach the wire.
          p_items: lines.map((line) => ({
            variant_id: line.variantId,
            qty: milliToNumber(line.qty),
            ...(line.unitCost === undefined ? {} : { unit_cost: minorToNumber(line.unitCost) }),
          })),
          p_supplier_id: options?.supplierId ?? null,
          p_reference: options?.reference ?? null,
          p_note: options?.note ?? null,
        })
      ) as { line_count: number; total_qty: string; total_cost: string }
      return {
        lineCount: Number(result.line_count),
        totalQty: toMilli(result.total_qty),
        totalCost: toMinor(result.total_cost),
      } satisfies StockOperationResult
    },

    async stockOut(warehouseId, lines, reason, note) {
      const result = unwrap(
        await client.rpc('stock_out', {
          p_warehouse_id: warehouseId,
          p_items: lines.map((line) => ({
            variant_id: line.variantId,
            qty: milliToNumber(line.qty),
          })),
          p_reason: reason,
          p_note: note ?? null,
        })
      ) as { line_count: number; total_qty: string }
      return {
        lineCount: Number(result.line_count),
        totalQty: toMilli(result.total_qty),
      } satisfies StockOperationResult
    },

    async transfer(fromWarehouseId, toWarehouseId, lines, note) {
      const transferId = unwrap(
        await client.rpc('transfer_stock', {
          p_from_warehouse_id: fromWarehouseId,
          p_to_warehouse_id: toWarehouseId,
          p_items: lines.map((line) => ({
            variant_id: line.variantId,
            qty: milliToNumber(line.qty),
          })),
          p_note: note ?? null,
        })
      ) as string
      const totalQty = lines.reduce((sum, line) => sum + milliToNumber(line.qty), 0)
      return {
        lineCount: lines.length,
        totalQty: milli(totalQty),
        transferId,
      } satisfies StockOperationResult
    },

    async adjust(warehouseId, variantId, qty, reason, direction, note) {
      unwrap(
        await client.rpc('adjust_stock', {
          p_warehouse_id: warehouseId,
          p_variant_id: variantId,
          p_quantity: milliToNumber(qty),
          p_reason: reason,
          p_direction: direction,
          p_note: note ?? null,
        })
      )
    },

    async setReorderPoint(productId, reorderPoint) {
      const rows = unwrap(
        await client
          .from('products')
          .update({ reorder_point: milliToNumber(reorderPoint) })
          .eq('id', productId)
          .select('id')
          .returns<{ id: string }[]>()
      )
      if (rows.length === 0) throw new Error('Product not found, or you cannot edit it.')
    },
  }
}

// ── Composition ───────────────────────────────────────────────────────────

/**
 * Build the whole data surface for one signed-in user.
 *
 * `organizationId` is a getter rather than a value because the user can switch
 * shops without a reload; reading it lazily means the repositories follow the
 * session instead of pinning the organization they were built with.
 */
export function createSupabaseRepositories(
  client: SupabaseClient,
  organizationId: () => string | null
): Repositories {
  return {
    catalog: createCatalog(client, organizationId),
    products: createProducts(client, organizationId),
    customers: createCustomers(client, organizationId),
    sales: createSales(client),
    registers: createRegisters(client),
    organization: createOrganization(client),
    stock: createStock(client, organizationId),
  }
}

export type { SaleItemPayload, SalePaymentPayload, SalesFloor }
