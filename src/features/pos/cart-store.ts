/**
 * Cart state (spec §14, §17).
 *
 * Persisted to localStorage on every change, because a POS browser reloads for
 * reasons nobody plans: a Windows update, a cashier leaning on F5, a crash. A
 * cart that lives only in memory turns each of those into a customer standing
 * at the counter while the shop re-types their order.
 *
 * The persisted cart is a *draft*, never a financial record. The sale row
 * appears only when `complete_sale` commits, so a stale draft cannot leak into
 * the numbers — the reports count COMPLETED, PARTIALLY_PAID and
 * PARTIALLY_REFUNDED and nothing else.
 *
 * The key includes the branch so two counters sharing one machine cannot
 * resume each other's cart.
 */

import { Store } from '../../app/state/store'
import {
  addLine,
  computeTotals,
  emptyCart,
  isEmpty,
  removeLine,
  setCustomer,
  setLineDiscount,
  setNote,
  setOrderDiscount,
  setQuantity,
  type Cart,
  type CartLine,
  type CartLineSource,
  type CartTotals,
  type DiscountType,
} from '../../shared/domain/cart'
import { milli, type Milli, type Minor } from '../../shared/domain/money'

export interface CartState {
  cart: Cart
  totals: CartTotals
  /** Id of the held sale this cart was resumed from, if any. */
  heldSaleId: string | null
  /** Set while a write is in flight, so buttons can disable themselves. */
  busy: boolean
}

function storageKey(branchId: string): string {
  return `mekholi.pos.cart.${branchId}`
}

/**
 * Rebuild a cart from localStorage.
 *
 * Defensive on purpose: the shape is versioned by nothing but the code that
 * wrote it, and a cart written by yesterday's build must not be able to throw
 * during boot. Anything malformed is discarded rather than half-parsed — a
 * lost draft is a minor annoyance, a crashed POS is a closed shop.
 */
function loadPersisted(branchId: string): Cart | null {
  try {
    const raw = localStorage.getItem(storageKey(branchId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null

    const record = parsed as {
      lines?: unknown
      cart?: unknown
      customerId?: unknown
      note?: unknown
    }
    if (!Array.isArray(record.lines)) return null

    const lines: CartLine[] = []
    record.lines.forEach((entry, index) => {
      if (typeof entry !== 'object' || entry === null) return
      const raw = entry as Record<string, unknown>
      if (
        typeof raw.variantId !== 'string' ||
        typeof raw.productId !== 'string' ||
        typeof raw.name !== 'string' ||
        typeof raw.unitPrice !== 'number' ||
        typeof raw.quantity !== 'number' ||
        raw.quantity <= 0
      ) {
        // A line without a price or a quantity cannot be sold. Dropping it is
        // better than dropping the whole cart the cashier already built.
        return
      }
      const discountType =
        raw.discountType === 'FLAT' || raw.discountType === 'PERCENT'
          ? raw.discountType
          : null
      lines.push({
        lineId: `restored-${index}`,
        variantId: raw.variantId,
        productId: raw.productId,
        name: raw.name,
        variantName: typeof raw.variantName === 'string' ? raw.variantName : null,
        sku: typeof raw.sku === 'string' ? raw.sku : null,
        unitLabel: typeof raw.unitLabel === 'string' ? raw.unitLabel : null,
        unitPrice: raw.unitPrice as Minor,
        unitCost: typeof raw.unitCost === 'number' ? raw.unitCost : 0,
        taxRatePercent: typeof raw.taxRatePercent === 'number' ? raw.taxRatePercent : 0,
        taxInclusive: raw.taxInclusive === true,
        trackStock: raw.trackStock !== false,
        allowNegative: raw.allowNegative === true,
        availableQty: typeof raw.availableQty === 'number' ? (raw.availableQty as Milli) : null,
        decimalQuantity: raw.decimalQuantity === true,
        quantity: raw.quantity as Milli,
        discountType,
        discountValue:
          discountType !== null && typeof raw.discountValue === 'number' ? raw.discountValue : 0,
      })
    })

    if (lines.length === 0) return null

    const cartRecord = record.cart
    const discountType =
      cartRecord && typeof cartRecord === 'object'
        ? (cartRecord as { discountType?: unknown }).discountType
        : null

    return {
      lines,
      discountType:
        discountType === 'FLAT' || discountType === 'PERCENT' ? discountType : null,
      discountValue: 0,
      customerId: typeof record.customerId === 'string' ? record.customerId : null,
      note: typeof record.note === 'string' ? record.note : '',
    }
  } catch {
    return null
  }
}

export class CartStore {
  readonly store: Store<CartState>
  readonly branchId: string

  constructor(branchId: string) {
    this.branchId = branchId
    const restored = loadPersisted(branchId)
    const cart = restored ?? emptyCart()
    this.store = new Store<CartState>({
      cart,
      totals: computeTotals(cart),
      heldSaleId: null,
      busy: false,
    })

    // Persist on every change. `select` on the cart object identity means this
    // fires once per mutation rather than once per render.
    this.store.select(
      (state) => state.cart,
      (cart) => this.#persist(cart)
    )
  }

  get state(): CartState {
    return this.store.state
  }

  #persist(cart: Cart): void {
    try {
      if (isEmpty(cart)) {
        localStorage.removeItem(storageKey(this.branchId))
        return
      }
      localStorage.setItem(
        storageKey(this.branchId),
        JSON.stringify({
          lines: cart.lines,
          cart: { discountType: cart.discountType, discountValue: cart.discountValue },
          customerId: cart.customerId,
          note: cart.note,
        })
      )
    } catch {
      // Private browsing and a full quota both throw here. Losing the draft
      // is acceptable; blocking the sale is not.
    }
  }

  #commit(cart: Cart, patch: Partial<CartState> = {}): void {
    this.store.set({ cart, totals: computeTotals(cart), ...patch })
  }

  add(product: CartLineSource, quantity: Milli = milli(1000)): void {
    this.#commit(addLine(this.state.cart, product, quantity))
  }

  setQuantity(lineId: string, quantity: Milli): void {
    this.#commit(setQuantity(this.state.cart, lineId, quantity))
  }

  increment(lineId: string, by: Milli): void {
    const line = this.state.cart.lines.find((l) => l.lineId === lineId)
    if (!line) return
    this.setQuantity(lineId, (line.quantity + by) as Milli)
  }

  remove(lineId: string): void {
    this.#commit(removeLine(this.state.cart, lineId))
  }

  setLineDiscount(lineId: string, type: DiscountType | null, value: number): void {
    this.#commit(setLineDiscount(this.state.cart, lineId, type, value))
  }

  setOrderDiscount(type: DiscountType | null, value: number): void {
    this.#commit(setOrderDiscount(this.state.cart, type, value))
  }

  setCustomer(customerId: string | null): void {
    this.#commit(setCustomer(this.state.cart, customerId))
  }

  setNote(note: string): void {
    this.#commit(setNote(this.state.cart, note))
  }

  /** Adopt a cart rebuilt from a resumed hold. */
  replace(cart: Cart, heldSaleId: string | null): void {
    this.store.set({ cart, totals: computeTotals(cart), heldSaleId, busy: false })
  }

  clear(): void {
    this.store.set({ cart: emptyCart(), totals: computeTotals(emptyCart()), heldSaleId: null, busy: false })
  }

  setBusy(busy: boolean): void {
    this.store.set({ busy })
  }
}
