/**
 * Held carts, and the one place the client is allowed to be authoritative.
 *
 * The roadmap's conflict policy is short: *server wins for stock, client wins
 * for drafts*. Stock is the shop's truth and only the database may decide it.
 * A parked cart is different — it is the cashier's working state, it is worth
 * nothing to anybody else, and the shop that cannot park a cart while the
 * connection is down is a shop that loses the cart.
 *
 * So a hold taken offline is written here and returns an id prefixed `draft:`.
 * The prefix is the whole mechanism: `resume` and `held` look at it and know
 * whether they are reading a local draft or a server row, with no guessing and
 * no shadow copy that could disagree with the server about a cart that *was*
 * parked online.
 *
 * A draft stores the cart, not prices. When it is resumed the prices are read
 * again from the catalogue — a shop may have repriced the item while the cart
 * was parked, and the customer must be charged today's price (the rule
 * `resume_sale` already follows).
 */

import type { ResumedSale, SaleRow } from '../../types/records'
import { milliToNumber, minorToFixed, type Milli, type Minor } from '../../domain/money'
import type { OfflineStore } from './store'

const DRAFTS = 'drafts' as const

/** The prefix that makes a local draft recognisable everywhere. */
export const DRAFT_PREFIX = 'draft:'

export interface LocalDraft {
  id: string
  branchId: string
  customerId: string | null
  note: string
  createdAt: number
  items: { variantId: string; qty: number; discountType?: 'FLAT' | 'PERCENT'; discountValue?: number }[]
}

export function isLocalDraft(id: string): boolean {
  return id.startsWith(DRAFT_PREFIX)
}

function newDraftId(): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}`
  return `${DRAFT_PREFIX}${suffix}`
}

export interface DraftStore {
  save(input: Omit<LocalDraft, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): Promise<LocalDraft>
  get(id: string): Promise<LocalDraft | null>
  list(branchId: string): Promise<LocalDraft[]>
  remove(id: string): Promise<void>
  /** The draft's shape as the resume path expects it. */
  asResumed(draft: LocalDraft): ResumedSale
  /** A draft as the held-cart list renders it. Money is unknown until priced. */
  asRow(draft: LocalDraft): SaleRow
}

export function createDraftStore(store: OfflineStore, now: () => number = () => Date.now()): DraftStore {
  return {
    async save(input) {
      const draft: LocalDraft = {
        id: input.id ?? newDraftId(),
        branchId: input.branchId,
        customerId: input.customerId,
        note: input.note,
        createdAt: input.createdAt ?? now(),
        items: input.items,
      }
      await store.put(DRAFTS, draft.id, draft, draft.createdAt)
      return draft
    },

    async get(id) {
      const entry = await store.get<LocalDraft>(DRAFTS, id)
      return entry?.value ?? null
    },

    async list(branchId) {
      const entries = await store.all<LocalDraft>(DRAFTS)
      return entries
        .map((entry) => entry.value)
        .filter((draft) => draft.branchId === branchId)
        .sort((a, b) => a.createdAt - b.createdAt)
    },

    async remove(id) {
      await store.remove(DRAFTS, id)
    },

    asResumed(draft) {
      return {
        sale_id: draft.id,
        customer_id: draft.customerId,
        note: draft.note,
        items: draft.items.map((item) => ({
          variant_id: item.variantId,
          // Decimal units, not milli: `resume_sale` returns
          // `sale_items.quantity` as numeric text ('1.5'), and the resume path
          // parses it with `parseMilli`. A draft that said '1500' here would
          // come back a thousand times too large.
          qty: String(milliToNumber(item.qty as Milli)),
          // Required-but-nullable on `ResumedSale`, matching what `resume_sale`
          // returns: a caller that reads `discount_type` should not have to
          // care whether the cart was parked online or offline.
          discount_type: item.discountType ?? null,
          discount_value: item.discountValue === undefined ? null : String(item.discountValue),
        })),
      }
    },

    asRow(draft) {
      // Totals are zero and stay zero: a parked cart has no price until it is
      // resumed and re-priced from the catalogue. The list shows who it is for
      // and how long it has been parked, which is what a cashier needs to pick
      // the right one.
      // Money is the server's own notation ('0.00'), because these strings are
      // read by the same code that reads a stored sale.
      const zero = minorToFixed(0 as Minor)
      return {
        id: draft.id,
        invoice_no: 'Draft',
        status: 'HELD',
        branch_id: draft.branchId,
        register_id: null,
        session_id: null,
        customer_id: draft.customerId,
        currency: '',
        subtotal: zero,
        discount_total: zero,
        discount_type: null,
        discount_value: null,
        tax_total: zero,
        total: zero,
        paid_total: zero,
        change_due: zero,
        cogs: zero,
        profit: zero,
        note: draft.note,
        created_at: new Date(draft.createdAt).toISOString(),
        completed_at: null,
        created_by: null,
        customer: null,
      }
    },
  }
}
