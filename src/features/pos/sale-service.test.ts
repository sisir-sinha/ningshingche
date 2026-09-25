/**
 * What the till announces after a sale.
 *
 * The POS publishes on the bus so the screen updates immediately, and plugins
 * listen: loyalty-lite credits a customer when a sale completes. That makes the
 * *wording* of the event a correctness question, not a naming one — and the two
 * cases are genuinely different facts:
 *
 *   · the server took the sale → `sale.completed`, carrying the invoice number
 *     the shop's books now hold;
 *   · the connection was gone → `sale.queued`, carrying the till's own guess at
 *     a number, on a sale the server has not seen and may still refuse.
 *
 * Announcing the second as the first is how a shop credits points for a sale it
 * never made, and how a dashboard counts money that has not arrived.
 */

import { describe, it, expect } from 'vitest'
import { SaleService, toCartLine } from './sale-service'
import { EventBus } from '../../shared/bus'
import { addLine, emptyCart } from '../../shared/domain/cart'
import type { Repositories, SalesFloor, SellableProduct } from '../../shared/repositories/contracts'
import type { CompletedSale } from '../../shared/types/records'
import type { Milli, Minor } from '../../shared/domain/money'

const FLOOR: SalesFloor = {
  branchId: 'b-1',
  branchName: 'Main Store',
  warehouseId: 'w-1',
  warehouseName: 'Shop Floor',
  registerId: 'r-1',
  registerName: 'Counter 1',
  sessionId: 's-1',
}

const SOAP: SellableProduct = {
  productId: 'p-soap',
  variantId: 'v-soap',
  name: 'Soap',
  variantName: null,
  sku: null,
  imageUrl: null,
  price: 10000 as Minor,
  cost: 0,
  taxRatePercent: 0,
  taxInclusive: false,
  trackStock: true,
  allowNegative: false,
  availableQty: 5000 as Milli,
  unitLabel: 'pc',
  decimalQuantity: false,
  categoryName: 'Home',
  metadata: {},
}

const CART = addLine(
  emptyCart(),
  toCartLine(SOAP),
  1000 as Milli
)

const CASH = { methodId: 'm-cash', methodKey: 'cash', methodName: 'Cash' }

/** A repository surface with only the sale call the service makes. */
function repos(complete: () => Promise<CompletedSale>): Repositories {
  return { sales: { complete } } as unknown as Repositories
}

function completed(overrides: Partial<CompletedSale> = {}): CompletedSale {
  return {
    sale_id: 'sale-1',
    invoice_no: 'INV-2026-000001',
    status: 'COMPLETED',
    subtotal: '100.00',
    discount: '0.00',
    tax: '0.00',
    total: '100.00',
    paid: '100.00',
    change_due: '0.00',
    ...overrides,
  }
}

async function takeSale(
  bus: EventBus,
  result: CompletedSale,
  organizationId: string | null = 'org-1'
): Promise<void> {
  const service = new SaleService(repos(async () => result), bus)
  await service.complete({
    cart: CART,
    payments: [{ ...CASH, amount: 10000 as Minor }],
    floor: FLOOR,
    currency: 'BDT',
    organizationId,
  })
}

describe('what the till announces', () => {
  it('announces a stored sale as completed, under the shop that took it', async () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.on('sale.completed', (event) => seen.push(`${event.organization_id}:${event.data.sale_id}`))

    await takeSale(bus, completed())

    expect(seen).toEqual(['org-1:sale-1'])
  })

  it('invents no domain event when there is no shop to attribute it to', async () => {
    // An event saying a sale happened in no shop is not a fact anybody can act
    // on, and a handler counting by organization would be corrupted by it.
    // (The POS gate makes this unreachable; this is the belt.)
    const bus = new EventBus()
    const events: unknown[] = []
    bus.on('sale.completed', (event) => events.push(event))

    await takeSale(bus, completed(), null)

    expect(events).toEqual([])
  })

  it('announces a queued sale as queued — never as completed', async () => {
    const bus = new EventBus()
    const completedEvents: unknown[] = []
    const queued: string[] = []
    bus.on('sale.completed', (event) => completedEvents.push(event))
    bus.on('sale.queued', (event) => queued.push(`${event.data.client_ref}:${event.data.total}`))

    await takeSale(
      bus,
      completed({ invoice_no: 'Not yet numbered', queued: true, client_ref: 'ref-9', total: '100.00' })
    )

    // Nothing in the shop's books has happened yet: the till's own arithmetic is
    // on this event, and the invoice number is a label, not a number.
    expect(completedEvents).toEqual([])
    expect(queued).toEqual(['ref-9:100.00'])
  })
})
