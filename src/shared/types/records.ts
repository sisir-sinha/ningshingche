/**
 * Shared row and payload types (docs/03 §1, spec §42).
 *
 * These mirror the database exactly. `supabase gen types typescript` would
 * generate the table rows, but the RPC payloads are hand-written anyway and
 * mixing generated and hand-written shapes in one codebase is how drift
 * starts — so everything here is written against the migrations, and
 * `tools/validate-migrations.mjs` is what catches a mismatch.
 *
 * Postgres `numeric` arrives over PostgREST as a **string**, not a number.
 * That is deliberate on Supabase's part: a double cannot represent
 * `numeric(14,2)` exactly. Every money and quantity field below is therefore
 * `string`, and the repository layer converts to `Minor`/`Milli` at the
 * boundary so no feature ever parses a numeric itself.
 */

// ── Catalogue ─────────────────────────────────────────────────────────────

/** A row of `public.pos_catalog` (migration 022), pricing already resolved. */
export interface PosCatalogRow {
  organization_id: string
  product_id: string
  name: string
  sku: string | null
  description: string | null
  image_url: string | null
  track_stock: boolean
  allow_negative: boolean
  tax_inclusive: boolean
  category_id: string | null
  category_name: string | null
  reorder_point: string
  metadata: Record<string, unknown>
  variant_id: string
  variant_name: string | null
  effective_sku: string | null
  price: string
  cost: string
  is_default: boolean
  unit_label: string | null
  decimal_quantity: boolean
  tax_rate: string
  warehouse_id: string | null
  available: string
}

export interface Category {
  id: string
  name: string
  slug: string
  parent_id: string | null
  sort_order: number
  is_active: boolean
}

export interface Brand {
  id: string
  name: string
}

export interface Unit {
  id: string
  name: string
  symbol: string
  is_decimal: boolean
  sort_order: number
}

export interface Tax {
  id: string
  name: string
  rate: string
  is_inclusive: boolean
  is_active: boolean
}

export interface PaymentMethod {
  id: string
  key: string
  name: string
  type: string
  is_cash: boolean
  is_active: boolean
  sort_order: number
  icon: string | null
  config: Record<string, unknown>
}

// ── Products ──────────────────────────────────────────────────────────────

export interface ProductRow {
  id: string
  organization_id: string
  name: string
  sku: string | null
  description: string | null
  category_id: string | null
  brand_id: string | null
  unit_id: string | null
  tax_id: string | null
  selling_price: string
  cost_price: string
  tax_inclusive: boolean
  reorder_point: string
  track_stock: boolean
  allow_negative: boolean
  is_active: boolean
  image_url: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface VariantRow {
  id: string
  product_id: string
  is_default: boolean
  sku: string | null
  name_suffix: string | null
  price_override: string | null
  cost_override: string | null
  is_active: boolean
}

/** What the product form submits. Absent optional keys mean "leave as is". */
export interface ProductDraft {
  name: string
  sku?: string | null
  description?: string | null
  category_id?: string | null
  brand_id?: string | null
  unit_id?: string | null
  tax_id?: string | null
  selling_price: number
  cost_price: number
  tax_inclusive: boolean
  reorder_point: number
  track_stock: boolean
  allow_negative: boolean
  is_active: boolean
  image_url?: string | null
  metadata: Record<string, unknown>
}

// ── Selling ───────────────────────────────────────────────────────────────

export type SaleStatus =
  | 'DRAFT'
  | 'HELD'
  | 'COMPLETED'
  | 'PARTIALLY_PAID'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'

export interface SaleRow {
  id: string
  invoice_no: string
  status: SaleStatus
  branch_id: string
  register_id: string | null
  session_id: string | null
  customer_id: string | null
  currency: string
  subtotal: string
  discount_total: string
  discount_type: 'FLAT' | 'PERCENT' | null
  discount_value: string | null
  tax_total: string
  total: string
  paid_total: string
  change_due: string
  cogs: string
  profit: string
  note: string | null
  created_at: string
  completed_at: string | null
  created_by: string | null
  customer?: { id: string; name: string; phone: string | null } | null
  items?: SaleItemRow[]
  payments?: SalePaymentRow[]
}

export interface SaleItemRow {
  id: string
  variant_id: string
  product_id: string
  product_name: string
  variant_name: string | null
  sku: string | null
  unit_label: string | null
  quantity: string
  unit_price: string
  unit_cost: string
  discount_type: 'FLAT' | 'PERCENT' | null
  discount_value: string | null
  discount_total: string
  tax_rate: string
  tax_total: string
  line_total: string
  line_cogs: string
  returned_qty: string
}

export interface SalePaymentRow {
  id: string
  method_id: string
  amount: string
  reference: string | null
  created_at: string
  method?: { key: string; name: string } | null
}

/** What `public.complete_sale` returns. Money as strings, per PostgREST. */
export interface CompletedSale {
  sale_id: string
  invoice_no: string
  status: SaleStatus
  subtotal: string
  discount: string
  tax: string
  total: string
  paid: string
  change_due: string
  /**
   * Set only by the offline layer (docs/10 Phase 8): the sale is in the queue,
   * the server has not seen it, and the totals above are the till's own
   * arithmetic rather than the stored ones. A screen that prints a receipt must
   * read this before trusting the numbers.
   */
  queued?: boolean
  /** The queue's reference, present exactly when `queued` is. */
  client_ref?: string | null
}

/** What `public.resume_sale` returns (migration 021). */
export interface ResumedSale {
  sale_id: string
  customer_id: string | null
  note: string | null
  items: {
    variant_id: string
    qty: string
    discount_type: 'FLAT' | 'PERCENT' | null
    discount_value: string | null
  }[]
}

// ── Parties ───────────────────────────────────────────────────────────────

export interface CustomerRow {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  credit_limit: string
  balance: string
  store_credit: string
  note: string | null
  created_at: string
}

export interface CustomerDraft {
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  note?: string | null
}

// ── Register ──────────────────────────────────────────────────────────────

export interface RegisterRow {
  id: string
  branch_id: string
  name: string
  is_active: boolean
}

export interface RegisterSessionRow {
  id: string
  register_id: string
  branch_id: string
  opened_at: string
  closed_at: string | null
  opening_cash: string
  closing_cash: string | null
  expected_cash: string | null
  sales_cash: string
  cash_in: string
  cash_out: string
  status: string
  opened_by: string | null
}

// ── Paging ────────────────────────────────────────────────────────────────

/**
 * Keyset pagination (spec §45).
 *
 * Offset pagination (`range(500, 549)`) gets slower as the offset grows and
 * silently duplicates or skips rows when a sale lands mid-scroll — which on a
 * busy shop floor is constantly. Keyset paging asks for "rows after this
 * cursor" and is both constant-time and stable under inserts.
 */
export interface Page<T> {
  items: T[]
  /** Opaque; pass back as `cursor` to fetch the next page. Null when done. */
  nextCursor: string | null
}

export interface PageRequest {
  /** Rows to fetch. The API caps this; do not ask for a thousand. */
  limit?: number
  cursor?: string | null
}
