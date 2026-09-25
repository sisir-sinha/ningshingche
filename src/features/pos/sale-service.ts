/**
 * Sale orchestration (spec §14, §17; docs/02 §2).
 *
 * Thin by design. The cart holds intent, `complete_sale` holds truth, and this
 * file only moves between them: it serialises the cart, calls the RPC, and
 * publishes what happened. There is no pricing, no stock check and no total
 * here — all three live in Postgres, which is what lets an Android client call
 * the same function and get the same answer (spec §43).
 */

import type { EventBus } from '../../shared/bus/event-bus'
import {
  addLine,
  computeTotals,
  emptyCart,
  setCustomer,
  setLineDiscount,
  setNote,
  toSaleItems,
  toSalePayments,
  type Cart,
  type PaymentEntry,
} from '../../shared/domain/cart'
import { parseMilli } from '../../shared/domain/money'
import type { Repositories, SellableProduct } from '../../shared/repositories/contracts'
import type { SalesFloor } from '../../shared/repositories/contracts'
import type { CartLineSource } from '../../shared/domain/cart'
import type { CompletedSale } from '../../shared/types/records'

export interface CompleteSaleInput {
  cart: Cart
  payments: PaymentEntry[]
  floor: SalesFloor
  /** The shop's currency, for the slip the till prints when it is offline. */
  currency: string
  /** Cancels the held row this cart came from, in the same transaction. */
  heldSaleId?: string | null
}

export class SaleService {
  readonly #repos: Repositories
  readonly #bus: EventBus

  constructor(repos: Repositories, bus: EventBus) {
    this.#repos = repos
    this.#bus = bus
  }

  /**
   * Take payment.
   *
   * The client's totals are sent as intent only — the RPC recomputes them from
   * the catalogue. If the two disagree the returned figure is the one that was
   * stored, and the receipt is printed from that, never from the cart.
   */
  async complete(input: CompleteSaleInput): Promise<CompletedSale> {
    const { cart, payments, floor, currency } = input
    const totals = computeTotals(cart)
    if (totals.oversold.length > 0) {
      // The database would refuse this too; failing here saves a round trip and
      // lets the UI point at the offending line rather than at a SQL error.
      throw new Error('One or more lines exceed the available stock.')
    }

    const result = await this.#repos.sales.complete({
      branchId: floor.branchId,
      registerId: floor.registerId,
      warehouseId: floor.warehouseId,
      customerId: cart.customerId,
      items: toSaleItems(cart),
      payments: toSalePayments(payments),
      ...(cart.discountType ? { discountType: cart.discountType } : {}),
      ...(cart.discountValue > 0 ? { discountValue: cart.discountValue } : {}),
      ...(cart.note ? { note: cart.note } : {}),
      heldSaleId: input.heldSaleId ?? null,
      // The till's copy of what it just sold. Only the offline layer reads it,
      // and only when the sale could not be sent: the wire payload has no
      // product names or prices, because pricing belongs to the server.
      local: { cart, currency, sessionId: floor.sessionId },
    })

    // The outbox is the authority and will deliver `sale.completed` over
    // Realtime. This local emit exists so the dashboard and the register panel
    // update immediately rather than a beat later; handlers dedupe on event id.
    this.#bus.emit('sale.completed', {
      id: `local-${result.sale_id}`,
      organization_id: '',
      aggregate: 'sale',
      type: 'sale.completed',
      data: {
        sale_id: result.sale_id,
        invoice_no: result.invoice_no,
        branch_id: floor.branchId,
        customer_id: cart.customerId,
        total: result.total,
      },
      created_at: new Date().toISOString(),
      version: 1,
    })

    return result
  }

  /** Park the cart on the server so it survives a logout (spec §17). */
  async hold(cart: Cart, floor: SalesFloor): Promise<string> {
    return this.#repos.sales.hold({
      branchId: floor.branchId,
      items: toSaleItems(cart),
      customerId: cart.customerId,
      ...(cart.note ? { note: cart.note } : {}),
    })
  }

  /**
   * Pull a held cart back and rebuild it.
   *
   * The held row stores variant ids and quantities; prices are deliberately
   * re-read from the catalogue rather than replayed, because a shop may have
   * repriced the product while the cart was parked and the cashier must sell
   * at today's price, not the one on a stale draft.
   */
  async resume(saleId: string, warehouseId: string): Promise<{ cart: Cart; customerId: string | null; note: string }> {
    const resumed = await this.#repos.sales.resume(saleId)

    // Built through the domain functions rather than by hand: they own line
    // identity, the merge rule for repeated variants and the discount shape,
    // and a second implementation of those here would be a second place for
    // them to be wrong.
    let cart = setCustomer(setNote(emptyCart(), resumed.note ?? ''), resumed.customer_id)

    for (const item of resumed.items) {
      const product = await this.#repos.catalog.findByVariantId(item.variant_id, warehouseId)
      // A variant deleted while the cart was parked simply drops out. Failing
      // the whole resume would strand the cashier with nothing.
      if (!product) continue

      const quantity = parseMilli(item.qty, { decimal: product.decimalQuantity })
      if (quantity === null || quantity <= 0) continue

      cart = addLine(cart, toCartLine(product), quantity)

      const discount = Number(item.discount_value ?? 0)
      if (item.discount_type && discount > 0) {
        const line = cart.lines[cart.lines.length - 1]
        if (line) cart = setLineDiscount(cart, line.lineId, item.discount_type, discount)
      }
    }

    return { cart, customerId: resumed.customer_id, note: resumed.note ?? '' }
  }
}

/**
 * A catalogue row becomes a cart line.
 *
 * Kept here rather than in the domain because it depends on the repository's
 * shape; `shared/domain/cart.ts` knows only about `CartLineSource` and must
 * stay free of I/O types.
 */
export function toCartLine(product: SellableProduct): CartLineSource {
  return {
    variantId: product.variantId,
    productId: product.productId,
    name: product.name,
    variantName: product.variantName,
    sku: product.sku,
    unitLabel: product.unitLabel,
    unitPrice: product.price,
    unitCost: product.cost,
    taxRatePercent: product.taxRatePercent,
    taxInclusive: product.taxInclusive,
    trackStock: product.trackStock,
    allowNegative: product.allowNegative,
    availableQty: product.availableQty,
    decimalQuantity: product.decimalQuantity,
  }
}
