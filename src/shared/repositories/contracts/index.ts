/**
 * Repository contracts (docs/03 §3, spec §42, §43).
 *
 * These interfaces are the seam the whole offline and Android story rests on.
 * A feature asks a contract for data; it never imports `@supabase/supabase-js`.
 * Swapping PostgREST for IndexedDB, or for a queue that replays writes when
 * the connection returns, is then a change to the composition root and nothing
 * else — which is what makes "Android needs no rewrite" a property of the
 * code rather than a hope.
 *
 * Two rules the contracts enforce by shape:
 *
 *   Reads are plain queries. Writes go through named operations that map
 *   one-to-one onto Postgres RPCs, because the RPC is where the row locks,
 *   the stock check and the ledger write happen together. A write method that
 *   took a partial row would invite a client to reimplement that logic.
 *
 *   Money and quantities cross the boundary as branded integers, never as
 *   strings. Postgres returns `numeric` as text; the Supabase implementation
 *   converts, so no feature ever parses a number itself and no feature can
 *   accidentally send a float where the database wants 14,2.
 */

import type {
  Brand,
  Category,
  CompletedSale,
  CustomerDraft,
  CustomerRow,
  Page,
  PageRequest,
  PaymentMethod,
  ProductDraft,
  ProductRow,
  RegisterRow,
  RegisterSessionRow,
  ResumedSale,
  SaleRow,
  Tax,
  Unit,
  VariantRow,
} from '../../types/records'
import type { Cart, PaymentEntry, SaleItemPayload, SalePaymentPayload } from '../../domain/cart'
import type { Milli, Minor } from '../../domain/money'

/** One row of the POS grid, with money and stock already converted. */
export interface SellableProduct {
  productId: string
  variantId: string
  name: string
  variantName: string | null
  sku: string | null
  imageUrl: string | null
  price: Minor
  /** Ten-thousandths of a taka, matching `numeric(14,4)`. */
  cost: number
  taxRatePercent: number
  taxInclusive: boolean
  trackStock: boolean
  allowNegative: boolean
  availableQty: Milli | null
  unitLabel: string | null
  decimalQuantity: boolean
  categoryName: string | null
}

export interface ProductQuery extends PageRequest {
  /** Matched against the trigram-indexed `search_text`, plus exact SKU. */
  search?: string
  categoryId?: string | null
  /** Hide products that cannot be sold right now. */
  onlyInStock?: boolean
  categoryIdOrNull?: never
}

export interface CatalogRepository {
  /** The POS hot path: search, priced, with stock for one warehouse. */
  searchProducts(query: ProductQuery & { warehouseId: string }): Promise<Page<SellableProduct>>

  /** Exact barcode hit, or null. A scan is never a fuzzy match. */
  findByBarcode(code: string, warehouseId: string): Promise<SellableProduct | null>

  /**
   * One variant by id. Used to rebuild a held cart, where the stored rows are
   * variant ids and quantities and nothing else.
   */
  findByVariantId(variantId: string, warehouseId: string): Promise<SellableProduct | null>

  listCategories(): Promise<Category[]>
  listBrands(): Promise<Brand[]>
  listUnits(): Promise<Unit[]>
  listTaxes(): Promise<Tax[]>
  listPaymentMethods(): Promise<PaymentMethod[]>
}

export interface ProductRepository {
  list(query: ProductQuery): Promise<Page<ProductRow>>
  get(id: string): Promise<ProductRow | null>
  /** Includes variants, so the form can render and re-submit them. */
  getWithVariants(id: string): Promise<{ product: ProductRow; variants: VariantRow[] } | null>
  create(draft: ProductDraft): Promise<ProductRow>
  update(id: string, draft: Partial<ProductDraft>): Promise<ProductRow>
  /** Soft delete. Nothing in Mekholi hard-deletes a row a sale can reference. */
  archive(id: string): Promise<void>
  /** Spec §9 method 3: copy everything except the identity and the SKU. */
  duplicate(id: string): Promise<ProductRow>
}

export interface SaleRepository {
  /**
   * The only way a sale is written. Maps to `public.complete_sale`, which
   * locks the stock rows, checks the balance, writes the ledger and emits the
   * outbox event in one transaction.
   */
  complete(input: {
    branchId: string
    registerId: string | null
    warehouseId: string | null
    customerId: string | null
    items: SaleItemPayload[]
    payments: SalePaymentPayload[]
    discountType?: 'FLAT' | 'PERCENT'
    discountValue?: number
    note?: string
    /** Cancels the held row this cart came from, atomically (migration 021). */
    heldSaleId?: string | null
  }): Promise<CompletedSale>

  hold(input: {
    branchId: string
    items: SaleItemPayload[]
    customerId: string | null
    note?: string
  }): Promise<string>

  resume(saleId: string): Promise<ResumedSale>

  /** Newest first, this branch only. */
  list(query: PageRequest & { branchId: string; status?: string[] }): Promise<Page<SaleRow>>
  /** The sales list for a shop, across branches, for the Sales screen. */
  listAll(query: PageRequest & { status?: string; search?: string; from?: string; to?: string }): Promise<Page<SalesListRow>>
  detail(id: string): Promise<SaleDetail | null>
  get(id: string): Promise<SaleRow | null>
  held(branchId: string): Promise<SaleRow[]>
  byCustomer(customerId: string, query?: PageRequest): Promise<Page<SaleRow>>
}

export interface CustomerRepository {
  list(query: PageRequest & { search?: string }): Promise<Page<CustomerRow>>
  get(id: string): Promise<CustomerRow | null>
  /** Spec §19: name and phone are enough. Everything else is optional. */
  create(draft: CustomerDraft): Promise<CustomerRow>
  update(id: string, draft: Partial<CustomerDraft>): Promise<CustomerRow>
}

export interface RegisterRepository {
  list(branchId: string): Promise<RegisterRow[]>
  currentSession(branchId: string): Promise<RegisterSessionRow | null>
  open(registerId: string, openingCash: Minor, note?: string): Promise<string>
  close(sessionId: string, closingCash: Minor, note?: string): Promise<void>
  /** `direction` is 1 for cash in and -1 for cash out, as the RPC expects. */
  cashMovement(sessionId: string, amount: Minor, direction: 1 | -1, note?: string): Promise<void>
  /** Recent sessions for the register screen's history. */
  sessions(branchId: string, limit?: number): Promise<RegisterSessionSummary[]>
  /** The closing report: expected vs counted, and where the money came from. */
  report(sessionId: string): Promise<RegisterReport>
}

/**
 * Everything a screen needs to know about *where* it is selling.
 *
 * Resolved once per session rather than per screen: the branch decides the
 * warehouse, the warehouse decides stock, and the register decides where the
 * cash is counted. Getting these out of step is the bug that shows up as a
 * sale recorded against the wrong shop.
 */
export interface SalesFloor {
  branchId: string
  branchName: string
  warehouseId: string
  warehouseName: string
  registerId: string | null
  registerName: string | null
  sessionId: string | null
}

export interface OrganizationRepository {
  /** The branch this user sells from, and the resources hanging off it. */
  salesFloor(branchId: string): Promise<SalesFloor>
  listBranches(): Promise<{ id: string; name: string; code: string | null; is_primary: boolean }[]>
}

/**
 * The whole data surface, so a feature takes one dependency rather than six.
 *
 * Deliberately not a god object: it composes the narrow contracts above and
 * adds nothing of its own. A feature that only reads the catalogue can still
 * depend on `CatalogRepository` directly, which keeps its real requirements
 * visible in its signature.
 */
// ── Inventory (Phase 3) ───────────────────────────────────────────────────

/**
 * One line of the stock list: a variant in a warehouse, with what it is worth.
 *
 * Quantities are `Milli` (thousandths) and money is `Minor`, converted at the
 * repository boundary so no screen parses a numeric itself — the same rule the
 * rest of the data surface follows.
 */
export interface StockRow {
  variantId: string
  productId: string
  productName: string
  variantName: string | null
  sku: string | null
  warehouseId: string
  warehouseName: string
  quantity: Milli
  avgUnitCost: Minor
  stockValue: Minor
  reorderPoint: Milli
  trackStock: boolean
  isLow: boolean
  isOut: boolean
  updatedAt: string
}

/** A ledger entry, with the before/after that makes it an explanation. */
export interface StockMovementRow {
  id: string
  createdAt: string
  type: string
  direction: 1 | -1
  quantity: Milli
  /** Signed: positive for stock in, negative for stock out. */
  delta: Milli
  beforeQuantity: Milli
  afterQuantity: Milli
  unitCost: Minor
  warehouseId: string
  warehouseName: string
  variantId: string
  productName: string
  variantName: string | null
  referenceType: string | null
  referenceId: string | null
  note: string | null
  userId: string | null
}

/** The numbers the stock screen header and the dashboard card both show. */
export interface StockSummary {
  stockValue: Minor
  variantsInStock: number
  lowStock: number
  outOfStock: number
  warehouses: number
  movementsToday: number
}

export interface StockLineInput {
  variantId: string
  qty: Milli
  /** Omitted on a receipt means "use the product's last known cost". */
  unitCost?: Minor
}

/** What a stock operation reports back, for the confirmation message. */
export interface StockOperationResult {
  lineCount: number
  totalQty: Milli
  /** Receipts only. */
  totalCost?: Minor
  /** Transfers only. */
  transferId?: string
}

/** Query for the stock list. Every filter is optional and composes. */
export interface StockQuery extends PageRequest {
  search?: string
  warehouseId?: string
  /** The tabs above the list. */
  filter?: 'all' | 'low' | 'out'
}

/** A warehouse the stock screens can move stock between. */
export interface WarehouseOption {
  id: string
  name: string
  isRetailFloor: boolean
}

export interface StockRepository {
  /** One page of stock, newest movement first within each product. */
  list(query: StockQuery): Promise<Page<StockRow>>
  /** The ledger for one variant — the answer to "why 37 units?". */
  history(variantId: string, query: PageRequest & { warehouseId?: string }): Promise<Page<StockMovementRow>>
  /** Recent movements across the shop, for the overview's activity list. */
  recent(query: PageRequest & { warehouseId?: string }): Promise<Page<StockMovementRow>>
  summary(): Promise<StockSummary>

  listWarehouses(): Promise<WarehouseOption[]>

  /**
   * Writes. Each maps to exactly one Postgres function, because the function
   * is where the row lock, the stock check and the ledger write happen
   * together — a client that wrote the balance itself would be a second
   * implementation of the invariant.
   */
  stockIn(
    warehouseId: string,
    lines: StockLineInput[],
    options?: { supplierId?: string | null; reference?: string | null; note?: string | null }
  ): Promise<StockOperationResult>
  stockOut(
    warehouseId: string,
    lines: { variantId: string; qty: Milli }[],
    reason: string,
    note?: string | null
  ): Promise<StockOperationResult>
  transfer(
    fromWarehouseId: string,
    toWarehouseId: string,
    lines: { variantId: string; qty: Milli }[],
    note?: string | null
  ): Promise<StockOperationResult>
  adjust(
    warehouseId: string,
    variantId: string,
    qty: Milli,
    reason: string,
    direction: 1 | -1,
    note?: string | null
  ): Promise<void>
  /** Reorder point lives on the product; editing it is a product update. */
  setReorderPoint(productId: string, reorderPoint: Milli): Promise<void>
}

// ── Purchasing and suppliers (Phase 4) ────────────────────────────────────

/**
 * A supplier, with the balance the shop owes them.
 *
 * `balance` is positive when the shop owes money and negative when the
 * supplier holds an advance — the same sign convention `receive_purchase` and
 * `apply_payment` maintain in the database.
 */
export interface SupplierRow {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  note: string | null
  balance: Minor
  createdAt: string
  updatedAt: string
}

export interface SupplierDraft {
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  note?: string | null
}

export interface PurchaseRow {
  id: string
  invoiceNo: string
  referenceNo: string | null
  status: 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED'
  supplierId: string | null
  supplierName: string | null
  warehouseId: string
  warehouseName: string | null
  subtotal: Minor
  taxTotal: Minor
  total: Minor
  paidTotal: Minor
  /** What is still owed on this order. */
  outstanding: Minor
  note: string | null
  expectedAt: string | null
  createdAt: string
  receivedAt: string | null
}

export interface PurchaseItemRow {
  id: string
  variantId: string
  productName: string
  variantName: string | null
  quantity: Milli
  receivedQty: Milli
  /** quantity − received_qty: what is still to come. */
  outstanding: Milli
  unitCost: Minor
  lineTotal: Minor
}

export interface PurchasePaymentRow {
  id: string
  amount: Minor
  methodId: string
  methodName: string | null
  reference: string | null
  paidAt: string
}

export interface PurchaseDetail {
  purchase: PurchaseRow
  items: PurchaseItemRow[]
  payments: PurchasePaymentRow[]
}

export interface PurchaseDraftLine {
  variantId: string
  qty: Milli
  unitCost: Minor
  taxRate?: number
}

export interface PurchaseRepository {
  list(query: PageRequest & { status?: string; supplierId?: string; search?: string }): Promise<Page<PurchaseRow>>
  get(id: string): Promise<PurchaseDetail | null>
  /** Creates when `id` is absent. Returns the purchase id. */
  save(input: {
    id?: string
    warehouseId: string
    supplierId: string | null
    lines: PurchaseDraftLine[]
    status: 'DRAFT' | 'ORDERED'
    referenceNo?: string | null
    note?: string | null
    expectedAt?: string | null
  }): Promise<string>
  receive(
    id: string,
    lines: { purchaseItemId: string; qty: Milli; unitCost?: Minor }[],
    payments: { methodId: string; amount: Minor; reference?: string }[]
  ): Promise<{ status: string; receivedValue: Minor; paid: Minor }>
  cancel(id: string, reason?: string | null): Promise<{ released: Minor }>
  pay(input: {
    supplierId: string
    amount: Minor
    methodId: string
    purchaseId?: string | null
    reference?: string | null
  }): Promise<{ supplierBalance: Minor }>
}

export interface SupplierRepository {
  list(query: PageRequest & { search?: string }): Promise<Page<SupplierRow>>
  get(id: string): Promise<SupplierRow | null>
  create(draft: SupplierDraft): Promise<SupplierRow>
  update(id: string, draft: Partial<SupplierDraft>): Promise<SupplierRow>
  /** What we bought from them, newest first — the supplier's history. */
  purchases(supplierId: string, query?: PageRequest): Promise<Page<PurchaseRow>>
}

// ── Expenses (Phase 4) ────────────────────────────────────────────────────

export interface ExpenseRow {
  id: string
  expenseDate: string
  amount: Minor
  categoryId: string | null
  categoryName: string | null
  methodId: string | null
  methodName: string | null
  isCash: boolean
  description: string | null
  attachmentUrl: string | null
  sessionId: string | null
  createdAt: string
}

export interface ExpenseCategoryRow {
  id: string
  name: string
  isSystem: boolean
}

export interface ExpenseRepository {
  list(query: PageRequest & { from?: string; to?: string; categoryId?: string; search?: string }): Promise<Page<ExpenseRow>>
  /** Today's total, for the header. */
  totalForDay(date: string): Promise<Minor>
  create(input: {
    branchId: string
    amount: Minor
    categoryId?: string | null
    methodId?: string | null
    description?: string | null
    sessionId?: string | null
    expenseDate?: string
  }): Promise<string>
  update(id: string, patch: { amount?: Minor; categoryId?: string | null; description?: string | null }): Promise<void>
  /** Soft delete: `deleted_at`, so the register's history stays reconcilable. */
  remove(id: string): Promise<void>
  categories(): Promise<ExpenseCategoryRow[]>
  createCategory(name: string): Promise<ExpenseCategoryRow>
  removeCategory(id: string): Promise<void>
}

// ── Returns (Phase 4, spec §18) ───────────────────────────────────────────

export interface SaleReturnRow {
  id: string
  returnNo: string
  createdAt: string
  reason: string | null
  restock: boolean
  refundTotal: Minor
  items: { saleItemId: string; quantity: Milli; refundAmount: Minor; productName: string }[]
}

export interface RefundResult {
  returnId: string
  refundTotal: Minor
  saleStatus: string
  /** Present on a store-credit refund. */
  storeCredit?: Minor
}

export interface SalesListRow {
  id: string
  invoiceNo: string
  status: string
  customerId: string | null
  customerName: string | null
  branchName: string | null
  total: Minor
  paidTotal: Minor
  createdAt: string
  completedAt: string | null
}

export interface SaleDetail {
  sale: SalesListRow
  items: {
    id: string
    productName: string
    variantName: string | null
    quantity: Milli
    returnedQty: Milli
    unitPrice: Minor
    lineTotal: Minor
  }[]
  payments: { id: string; methodName: string | null; amount: Minor; receivedAt: string }[]
  returns: SaleReturnRow[]
}

export interface ReturnsRepository {
  /** Refund to the original payment methods. */
  refund(input: {
    saleId: string
    lines: { saleItemId: string; qty: Milli }[]
    payments: { methodId: string; amount: Minor; reference?: string }[]
    reason?: string | null
    restock?: boolean
  }): Promise<RefundResult>
  /** Refund to the customer's store credit instead of cash. */
  refundToCredit(input: {
    saleId: string
    lines: { saleItemId: string; qty: Milli }[]
    reason?: string | null
    restock?: boolean
  }): Promise<RefundResult>
}

// ── Register reporting (Phase 4) ──────────────────────────────────────────

/**
 * A session as the register screen lists it, with the day's totals already
 * aggregated. Computed by the `register_session_summary` view so the list and
 * the closing report cannot disagree about what a session took.
 */
export interface RegisterSessionSummary {
  id: string
  registerId: string
  registerName: string | null
  branchId: string
  openedAt: string
  closedAt: string | null
  isOpen: boolean
  openingCash: Minor
  closingCash: Minor | null
  variance: Minor | null
  salesTotal: Minor
  saleCount: number
  refundTotal: Minor
  expenseTotal: Minor
}

export interface RegisterReport {
  sessionId: string
  isOpen: boolean
  openedAt: string
  closedAt: string | null
  openingCash: Minor
  cashIn: Minor
  cashOut: Minor
  salesCash: Minor
  refundCash: Minor
  expenseCash: Minor
  expectedCash: Minor
  closingCash: Minor | null
  variance: Minor | null
  saleCount: number
  salesTotal: Minor
  refundTotal: Minor
  expenseTotal: Minor
  byMethod: { methodId: string; method: string; isCash: boolean; amount: Minor; count: number }[]
}

// ── Audit trail (Phase 4, spec §31) ───────────────────────────────────────

export interface AuditEntry {
  id: string
  createdAt: string
  action: 'create' | 'update' | 'delete'
  entityType: string
  entityId: string | null
  actorId: string | null
  actorEmail: string | null
  /** The row as it was; null for a create. */
  before: Record<string, unknown> | null
  /** The row as it became; null for a delete. */
  after: Record<string, unknown> | null
}

export interface AuditRepository {
  list(query: PageRequest & {
    entityType?: string
    actorId?: string
    action?: string
    entityId?: string
    search?: string
  }): Promise<Page<AuditEntry>>
  entityTypes(): Promise<string[]>
}

export interface Repositories {
  readonly catalog: CatalogRepository
  readonly products: ProductRepository
  readonly sales: SaleRepository
  readonly customers: CustomerRepository
  readonly registers: RegisterRepository
  readonly organization: OrganizationRepository
  readonly stock: StockRepository
  readonly suppliers: SupplierRepository
  readonly purchases: PurchaseRepository
  readonly expenses: ExpenseRepository
  readonly returns: ReturnsRepository
  readonly audit: AuditRepository
}

/** Re-exported so features can build payloads without importing the domain. */
export type { Cart, PaymentEntry, SaleItemPayload, SalePaymentPayload }
