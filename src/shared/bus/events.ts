/**
 * The event vocabulary (spec §36, §52).
 *
 * Two families share one bus:
 *
 *   Domain events  — raised by Postgres triggers into the transactional
 *                    outbox. These are the authority. The client sees them
 *                    either because it made the change itself or because
 *                    Supabase Realtime replayed the outbox row.
 *
 *   Local events   — client-only. Nothing in the database knows about them.
 *
 * The same domain event routinely arrives **twice**: once as a client-side echo
 * (the screen that made the change updates immediately) and once over Realtime,
 * carrying the outbox row the trigger wrote. Those two deliveries do **not**
 * share an envelope id — the client cannot know the row id before the row
 * exists, so its echo carries a fabricated one.
 *
 * So the rule for anything with a lasting effect is:
 *
 *   · dedupe on the **aggregate's own id**, `event.data.<aggregate>_id`, which
 *     is the same in both deliveries and is what the effect is *about*;
 *   · never on `event.id`, which is only stable for deliveries of the same row.
 *
 * `id` is still the key to use when you are holding the row itself (a Realtime
 * replay of a row you already handled), and for logging.
 */

/** Every domain event carries this envelope. */
export interface DomainEvent<
  TAggregate extends string,
  TType extends string,
  TData,
> {
  /** Outbox primary key — stable across deliveries, so use it for dedupe. */
  id: string
  organization_id: string
  aggregate: TAggregate
  type: TType
  data: TData
  created_at: string
  version: number
}

// ── Domain event payloads ─────────────────────────────────────────────────
// Field names mirror the triggers in supabase/migrations/20260923_016_reporting.sql.

export interface SaleCreatedData {
  sale_id: string
  invoice_no: string
}

export interface SaleCompletedData {
  sale_id: string
  invoice_no: string
  branch_id: string
  customer_id: string | null
  total: string
}

export interface SaleRefundedData {
  sale_id: string
  invoice_no: string
  refund_id: string
}

export interface StockAdjustedData {
  product_id: string
  variant_id: string
  branch_id: string
  quantity: string
  reason: string
}

export interface PurchaseReceivedData {
  purchase_id: string
  supplier_id: string | null
}

export interface ProductSavedData {
  product_id: string
  name: string
}

export interface PartySavedData {
  party_id: string
  name: string
  party_type: 'CUSTOMER' | 'SUPPLIER'
}

export interface RegisterSessionData {
  session_id: string
  register_id: string
}

/** The full domain vocabulary. Add a trigger → add a row here. */
export interface DomainEventMap {
  'sale.created': DomainEvent<'sale', 'sale.created', SaleCreatedData>
  'sale.completed': DomainEvent<'sale', 'sale.completed', SaleCompletedData>
  'sale.refunded': DomainEvent<'sale', 'sale.refunded', SaleRefundedData>
  'stock.adjusted': DomainEvent<'stock', 'stock.adjusted', StockAdjustedData>
  'purchase.received': DomainEvent<'purchase', 'purchase.received', PurchaseReceivedData>
  'product.saved': DomainEvent<'product', 'product.saved', ProductSavedData>
  'party.saved': DomainEvent<'party', 'party.saved', PartySavedData>
  'register.opened': DomainEvent<'register', 'register.opened', RegisterSessionData>
  'register.closed': DomainEvent<'register', 'register.closed', RegisterSessionData>
}

// ── Local events ──────────────────────────────────────────────────────────

export interface LocalEvent<TType extends string, TData> {
  type: TType
  data: TData
}

export interface LocalEventMap {
  /** Emitted once the router is mounted and the first route has rendered. */
  'app.ready': LocalEvent<'app.ready', undefined>
  'app.offline': LocalEvent<'app.offline', { online: boolean }>
  /** A plugin finished loading, or failed to (per plugin, for diagnostics). */
  'plugin.loaded': LocalEvent<'plugin.loaded', { plugin_id: string; ok: boolean; error?: string }>
  /**
   * The loaded set changed — enabling or disabling a plugin in Settings
   * Plugins. Screens that read plugin registrations (sidebar, product form,
   * POS panels, dashboard) rebuild on this rather than on a page reload.
   */
  'plugin.changed': LocalEvent<
    'plugin.changed',
    { loaded: readonly string[]; enabled: readonly string[] }
  >
  'ui.toast': LocalEvent<
    'ui.toast',
    { message: string; tone: 'info' | 'success' | 'warning' | 'error'; timeout?: number }
  >
  'ui.navigate': LocalEvent<'ui.navigate', { to: string; replace?: boolean }>
  'ui.palette.open': LocalEvent<'ui.palette.open', { query?: string }>
  /** The active organization or the caller's permissions changed. */
  'session.changed': LocalEvent<'session.changed', { organization_id: string }>
  /**
   * A sale was taken and kept on this device because the shop's server could
   * not be reached (docs/12 §5).
   *
   * Deliberately **not** `sale.completed`. That event means "this shop has this
   * sale": it is what the ledger, the reports and any plugin crediting the
   * customer react to, and a queued sale is not that yet — the server may
   * refuse it, and the invoice number on the slip is the till's own guess. The
   * authority's `sale.completed` arrives over Realtime when the queue drains.
   */
  'sale.queued': LocalEvent<
    'sale.queued',
    {
      sale_id: string
      invoice_no: string
      branch_id: string
      customer_id: string | null
      total: string
      /** The device's reference, which stays the same across every attempt. */
      client_ref: string
    }
  >
}

export type MekholiEvents = DomainEventMap & LocalEventMap
export type EventName = keyof MekholiEvents
export type EventOfType<K extends EventName> = MekholiEvents[K]

/** Any event, for wildcard subscribers. */
export type AnyEvent = MekholiEvents[EventName]

/** The domain-event half of the union, for narrowing. */
export type AnyDomainEvent = DomainEventMap[keyof DomainEventMap]

/** True for outbox events, false for client-only ones. */
export function isDomainEvent(event: AnyEvent): event is AnyDomainEvent {
  return 'id' in event && 'organization_id' in event && 'aggregate' in event
}
