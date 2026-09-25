/**
 * Serial Numbers — the parts that are arithmetic and text, kept away from the
 * DOM so they can be tested without one.
 *
 * Everything here is pure: the shape of what the server returns, how a pasted
 * list becomes serials, what a refusal is called in a sentence, and the sheet a
 * shop prints for a delivery. The screens are in `serials-screen.ts`, the
 * reusable capture card in `capture.ts`, and the registration in `index.ts`.
 */

import { SERIAL_TRACKED_KEY } from './manifest'
import type { PanelLine } from '../../shared/registry/plugin-types'

// ── What the server returns ───────────────────────────────────────────────

export type SerialStatus = 'IN_STOCK' | 'SOLD' | 'RETURNED'

export interface SerialRow {
  id: string
  serial: string
  status: SerialStatus
  source: 'MANUAL' | 'IMPORT' | 'INTERNAL'
  note: string | null
  product_id: string
  product_name: string | null
  variant_id: string
  variant_name: string | null
  sku: string | null
  warehouse: string | null
  sale_id: string | null
  invoice_no: string | null
  customer: string | null
  received_at: string
  sold_at: string | null
  returned_at: string | null
  released_at: string | null
}

/** A unit as it appears on a sale. `status` is the unit's status now. */
export interface BoundSerial {
  id: string
  serial: string
  status: SerialStatus
  source: SerialRow['source']
  sold_at: string | null
  returned_at: string | null
  released_at: string | null
}

export interface SaleLine {
  sale_item_id: string
  product_id: string
  variant_id: string
  product_name: string
  variant_name: string | null
  sku: string | null
  unit_label: string | null
  quantity: number
  returned_qty: number
  sold_units: number
  captured: number
  bound: BoundSerial[]
  missing: number
}

export interface SaleInfo {
  sale: {
    id: string
    invoice_no: string | null
    status: string
    created_at: string
    customer: string | null
  }
  lines: SaleLine[]
  tracked: boolean
  missing: number
}

export interface PendingSale {
  sale_id: string
  invoice_no: string | null
  status: string
  created_at: string
  customer: string | null
  missing: number
  lines: SaleLine[]
}

export interface SerialConfig {
  require_capture: boolean
  internal_prefix: string
  allow_over_stock: boolean
}

export interface TrackedProduct {
  id: string
  name: string
  sku: string | null
  variants: number
  serials: number
  in_stock: number
}

export interface WarehouseOption {
  id: string
  name: string
  code: string | null
  is_retail_floor: boolean
}

export interface Catalog {
  products: TrackedProduct[]
  warehouses: WarehouseOption[]
  config: SerialConfig
}

export interface VariantRow {
  id: string
  name: string
  sku: string | null
  is_default: boolean
  is_active: boolean
  on_hand: number
  serials: number
  in_stock: number
}

export interface Overview {
  totals: { total: number; in_stock: number; sold: number; returned: number; internal: number }
  tracked_products: number
  pending: { sales: number; units: number; window_days: number; scanned: number }
  recent: Array<{
    id: string
    serial: string
    status: SerialStatus
    product_name: string | null
    invoice_no: string | null
    sold_at: string | null
    created_at: string
  }>
  config: SerialConfig
}

export interface SerialReport {
  window: { days: number; from: string; to: string }
  totals: { sold: number; returned: number; in_stock: number; internal: number; total: number }
  aging: Array<{ bucket: string; count: number }>
  by_product: Array<{ product_id: string; product_name: string; sold: number; in_stock: number }>
  pending_sales: number
  pending_units: number
}

export interface SerialPage {
  rows: SerialRow[]
  total: number
  limit: number
  offset: number
  status: string
}

export interface Refusal {
  serial: string
  reason: string
  status?: string
}

export interface CaptureResult {
  sale_id: string
  captured: number
  refusals: Refusal[]
  lines: SaleLine[]
  missing: number
}

export interface AutofillResult {
  sale_id: string
  created: number
  prefix: string
  serials: Array<{ serial: string; product_name: string; variant_name: string | null }>
  lines: SaleLine[]
  missing: number
}

export interface AddResult {
  added: number
  skipped: Array<{ serial: string; reason: string }>
  skipped_total: number
  variant_id: string
  warehouse_id: string
  in_stock: number
  stock_on_hand: number
  over_stock: boolean
}

export interface ReleaseResult {
  released: number
  asked: number
  rows: Array<{ serial: string; reason: string; from?: string }>
}

export interface SyncResult {
  marked: number
  lines: number
}

// ── A pasted list ─────────────────────────────────────────────────────────

export interface ParsedSerials {
  /** Unique, trimmed, in the order they were pasted. */
  serials: string[]
  /** Entries dropped because an earlier line already carried them. */
  duplicates: string[]
  /** Blank lines, which are not worth a word of complaint. */
  blanks: number
  /** Entries past the batch limit, so the screen can say how many were left. */
  overflow: number
}

/** The server refuses more than this in one call. */
export const MAX_BATCH = 500

/**
 * A delivery arrives as a column pasted out of a spreadsheet, a scanner's
 * keyboard wedge, or a phone's notes app. So: one per line, but also
 * comma-, tab- and semicolon-separated, because every one of those shows up.
 *
 * Duplicates within one paste are dropped rather than refused: a shop pasting
 * a list twice should be told that nothing is wrong, not handed an error.
 */
export function parseSerials(text: string, limit: number = MAX_BATCH): ParsedSerials {
  const out: ParsedSerials = { serials: [], duplicates: [], blanks: 0, overflow: 0 }
  const seen = new Set<string>()

  for (const raw of text.split(/[\n\r,;\t]+/)) {
    const serial = raw.trim()
    if (serial === '') {
      out.blanks += 1
      continue
    }
    const key = serial.toLowerCase()
    if (seen.has(key)) {
      out.duplicates.push(serial)
      continue
    }
    seen.add(key)
    if (out.serials.length >= limit) {
      out.overflow += 1
      continue
    }
    out.serials.push(serial)
  }

  return out
}

// ── Sentences for a shopkeeper ────────────────────────────────────────────

/**
 * The server answers in names — `over_stock`, `not_registered` — because a
 * name is stable and a sentence is not. Both halves are worth having: the name
 * is what the code tests, the sentence is what the shopkeeper reads.
 */
export function reasonLabel(reason: string): string {
  switch (reason) {
    case 'already_registered':
      return 'already registered'
    case 'over_stock':
      return 'more units than the shop has in stock'
    case 'empty':
      return 'nothing scanned'
    case 'too_long':
      return 'longer than 120 characters'
    case 'duplicate_in_list':
      return 'listed twice'
    case 'not_registered':
      return 'not registered in this shop'
    case 'not_in_stock':
      return 'already out of stock — it was sold or returned'
    case 'variant_not_on_sale':
      return 'does not belong to a product on this sale'
    case 'every_line_full':
      return 'this sale already has a unit number for every one of them'
    case 'permission_denied':
      return 'your role does not allow this'
    case 'serial_product_not_tracked':
      return 'this product is not marked as serial-tracked yet'
    case 'serial_unknown_variant':
      return 'that variant is not this shop’s'
    case 'serial_unknown_sale':
      return 'that sale is not this shop’s'
    case 'serial_unknown_product':
      return 'that product is not this shop’s'
    case 'serial_unknown_warehouse':
      return 'that warehouse is not this shop’s'
    case 'serial_batch_too_large':
      return 'too many unit numbers in one go'
    case 'serial_prefix_missing':
      return 'set a prefix for internal codes in the plugin settings first'
    case 'serial_sale_not_capturable':
      return 'this sale is not finished yet — a held or cancelled sale has no units to attach'
    case 'serial_not_found':
      return 'no such unit number in this shop'
    case 'serial_pool_over_stock':
      return 'more units than the shop has in stock'
    case 'forbidden':
      return 'your role does not allow this'
    case 'plugin_not_enabled':
      return 'this shop does not have Serial Numbers switched on'
    case 'plugin_rpc_unknown':
      return 'this plugin version does not match the shop’s server'
    default:
      return reason.replace(/^(serial|plugin)_/, '').replace(/_/g, ' ')
  }
}

/**
 * The sentence for a thrown error.
 *
 * The server refuses by name — `permission_denied: serial-numbers.view`,
 * `serial_product_not_tracked: <uuid>` — and a screen that shows the raw string
 * is showing a shopkeeper a database code. A known name becomes a sentence; an
 * unknown one is passed through, because inventing a sentence for an error we
 * do not recognise would be worse than quoting it.
 */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const [head = '', ...rest] = message.split(':')
  const key = head.trim()
  const detail = rest.join(':').trim()
  const known = [
    'permission_denied',
    'forbidden',
    'plugin_not_enabled',
    'plugin_rpc_unknown',
    'serial_product_not_tracked',
    'serial_unknown_variant',
    'serial_unknown_product',
    'serial_unknown_sale',
    'serial_unknown_warehouse',
    'serial_batch_too_large',
    'serial_prefix_missing',
    'serial_sale_not_capturable',
    'serial_not_found',
    'serial_pool_over_stock',
  ]
  if (known.includes(key)) return reasonLabel(key)
  return detail === '' ? message : `${key}: ${detail}`
}

export function statusLabel(status: SerialStatus | string): string {
  switch (status) {
    case 'IN_STOCK':
      return 'In stock'
    case 'SOLD':
      return 'Sold'
    case 'RETURNED':
      return 'Returned'
    default:
      return String(status)
  }
}

export function statusTone(status: SerialStatus | string): 'success' | 'info' | 'warning' | 'neutral' {
  switch (status) {
    case 'IN_STOCK':
      return 'success'
    case 'SOLD':
      return 'info'
    case 'RETURNED':
      return 'warning'
    default:
      return 'neutral'
  }
}

/** `2 units still need a number`, or `nothing left to do`. */
export function missingLabel(missing: number): string {
  if (missing <= 0) return 'every unit has a number'
  return missing === 1 ? '1 unit still needs a number' : `${missing} units still need a number`
}

// ── The till ──────────────────────────────────────────────────────────────

/** The cart lines whose product asked to be tracked by unit. */
export function trackedLines(lines: readonly PanelLine[] | undefined): PanelLine[] {
  return (lines ?? []).filter((line) => line.metadata[SERIAL_TRACKED_KEY] === true)
}

/** A scan taken at the till, before it belongs to a sale. */
export interface PendingScan {
  serial: string
  /** The line it was scanned for, as the panel understood the cart. */
  variantId: string
  at: number
}

/**
 * Which line a scan belongs to, from the panel's point of view.
 *
 * The panel keeps this only to show "2 of 3 scanned": the *server* decides
 * where a unit actually goes, from the unit's own variant. Two identical
 * handsets are identical, and guessing here cannot make the invoice wrong.
 */
export function lineForScan(lines: readonly PanelLine[], scans: readonly PendingScan[]): PanelLine | null {
  let best: PanelLine | null = null
  let bestNeed = 0
  for (const line of lines) {
    const taken = scans.filter((scan) => scan.variantId === line.variantId).length
    const need = line.quantity - taken
    if (need > bestNeed) {
      best = line
      bestNeed = need
    }
  }
  return best
}

export function scansFor(scans: readonly PendingScan[], variantId: string): PendingScan[] {
  return scans.filter((scan) => scan.variantId === variantId)
}

/** How many units each tracked line still needs, in the panel's own view. */
export function tillSummary(
  lines: readonly PanelLine[],
  scans: readonly PendingScan[]
): Array<{ name: string; quantity: number; scanned: number; missing: number }> {
  return trackedLines(lines).map((line) => {
    const scanned = Math.min(scansFor(scans, line.variantId).length, line.quantity)
    return {
      name: line.variantName ? `${line.name} — ${line.variantName}` : line.name,
      quantity: line.quantity,
      scanned,
      missing: Math.max(0, line.quantity - scanned),
    }
  })
}

// ── Paper ─────────────────────────────────────────────────────────────────

/** Escapes the five characters that can end a spreadsheet paste's day. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The sheet a shop prints when a delivery arrives: one line per unit, big
 * enough to read while holding a handset, with the product it belongs to.
 *
 * A plain HTML string rather than a rendered element, so the calling screen
 * can hand it to a print window — and so this can be tested without a DOM.
 */
export function printableSheet(
  title: string,
  rows: readonly { serial: string; product: string; variant?: string | null; when?: string | null }[]
): string {
  const lines = rows
    .map(
      (row) =>
        `    <tr><td class="s">${escapeHtml(row.serial)}</td>` +
        `<td>${escapeHtml(row.product)}${row.variant ? ` — ${escapeHtml(row.variant)}` : ''}</td>` +
        `<td class="m">${escapeHtml(row.when ?? '')}</td></tr>`
    )
    .join('\n')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 13px/1.45 system-ui, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  p.meta { margin: 0 0 16px; color: #555; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #ddd; padding: 5px 6px; text-align: left; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
  td.s { font-family: ui-monospace, monospace; font-size: 14px; }
  td.m { color: #555; white-space: nowrap; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${rows.length} unit(s) · printed ${escapeHtml(new Date().toISOString().slice(0, 10))}</p>
<table>
  <thead><tr><th>Serial</th><th>Product</th><th>When</th></tr></thead>
  <tbody>
${lines}
  </tbody>
</table>
</body>
</html>`
}
