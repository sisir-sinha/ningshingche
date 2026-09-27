/**
 * Public surface of the POS feature.
 *
 * Everything another part of the app may touch lives here. Internal modules —
 * the cart store, the sale service, the payment dialog — stay private, so
 * `tools/check-boundaries.mjs` can reject a sibling feature reaching past this
 * file.
 */

import type { Route } from '../../app/router/router'
import { posView } from './pos-view'
import type { EventBus } from '../../shared/bus/event-bus'
import type { PluginRegistry } from '../../shared/registry/plugin-registry'

export interface PosRoutesOptions {
  bus: EventBus
  /** The host, so panels registered by enabled plugins are drawn in the cart. */
  registry: PluginRegistry
}

export function posRoutes(options: PosRoutesOptions): Route[] {
  return [
    {
      path: '/pos',
      title: 'Point of Sale',
      permission: 'sales.create',
      render: () => posView({ bus: options.bus, registry: options.registry }),
    },
  ]
}

export { posView } from './pos-view'
export { openReceipt, showReceipt, buildReceipt, renderReceipt, printReceipt, saveReceiptFile } from './receipt'
export type { ReceiptData, ReceiptLine } from './receipt'
export { SaleService } from './sale-service'
// Receipt output. Printer setup renders a sample through exactly the path a
// real sale takes, which is the only way a test page proves anything.
export { escPosJob, receiptCanvas, receiptPdf, receiptPng, receiptNeedsRaster } from '../../shared/receipt/export'
