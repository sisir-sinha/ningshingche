/**
 * Warranty — the parts that are arithmetic and text, kept away from the DOM so
 * they can be tested without one.
 *
 * Everything here is pure: the shape of what the server returns, how a product
 * field becomes a promise, what a claim may become next, and the certificate a
 * shop prints for a customer. The screen is in `warranty-screen.ts`, the card
 * that decorates a sale in `cover-card.ts`, and the registration in `index.ts`.
 */

import { formatMoney, minor, parseMinor } from '../../shared/domain/money'
import type { PanelLine } from '../../shared/registry/plugin-types'
import { MAX_UNITS_PER_LINE, WARRANTY_MONTHS_KEY } from './manifest'

const MS_PER_DAY = 86_400_000

// ── What the server returns ───────────────────────────────────────────────

export type ClaimStatus = 'OPEN' | 'APPROVED' | 'REPAIRING' | 'REPLACED' | 'REJECTED' | 'CLOSED'
export type WarrantyStatus = 'ACTIVE' | 'VOID'

export interface ClaimSummary {
  id: string
  claim_no: string
  status: ClaimStatus
  opened_on: string
  closed_on: string | null
  cost_minor: number
  issue: string | null
  resolution: string | null
}

export interface UnitRow {
  id: string
  product_id: string | null
  product_name: string
  variant_name: string | null
  unit_label: string | null
  unit_index: number
  months: number
  provider: string
  terms: string | null
  starts_on: string
  ends_on: string
  days_left: number
  status: WarrantyStatus
  void_reason: string | null
  voided_at: string | null
  note: string | null
  created_at: string
  customer: string | null
  customer_phone: string | null
  customer_id: string | null
  invoice_no: string | null
  sale_id: string | null
  sale_status: string | null
  sold_on: string | null
  claims_count: number
  claim: ClaimSummary | null
}

export interface ClaimRow extends ClaimSummary {
  days_open: number
  warranty_id: string
  product_name: string
  variant_name: string | null
  unit_label: string | null
  unit_index: number
  months: number
  starts_on: string
  ends_on: string
  warranty_status: WarrantyStatus
  covered_until_days: number
  sale_id: string | null
  invoice_no: string | null
  customer: string | null
  customer_phone: string | null
}

/** One line of a sale, as the promise it will become. */
export interface SaleLineCover {
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
  months: number | null
  registered: number
  missing: number
}

export interface SaleCover {
  sale: {
    id: string
    invoice_no: string | null
    status: string
    sold_on: string | null
    customer: string | null
  }
  today: string
  lines: SaleLineCover[]
  units: UnitRow[]
  missing: number
}

export interface RegisterResult {
  sale_id: string
  invoice_no: string | null
  created: number
  existing: number
  skipped_lines: number
  capped_lines: number
  starts_on: string
  units: UnitRow[]
  lines?: SaleLineCover[]
}

export interface PendingSale {
  sale_id: string
  invoice_no: string | null
  status: string
  sold_on: string | null
  customer: string | null
  units_missing: number
  product_name: string | null
  months: number | null
  lines: SaleLineCover[]
}

export interface PendingQueue {
  rows: PendingSale[]
  total: number
  units_total: number
  limit: number
  window_days: number
  from: string
  today: string
}

export interface WarrantyConfig {
  cover_all_lines: boolean
  default_months: number
  warn_days: number
  claim_prefix: string
}

export interface Overview {
  totals: {
    units: number
    active: number
    expiring: number
    expired: number
    void: number
    products: number
    claims_total: number
    claims_open: number
    claims_cost_minor: number
    claims_cost_open_minor: number
  }
  recent: Array<{
    id: string
    product_name: string
    unit_label: string | null
    unit_index: number
    months: number
    ends_on: string
    days_left: number
    status: WarrantyStatus
    invoice_no: string | null
    customer: string | null
  }>
  today: string
  pending: { sales: number; units: number; window_days: number }
  config: WarrantyConfig
}

export interface UnitPage {
  rows: UnitRow[]
  total: number
  limit: number
  offset: number
  scope: string
  today: string
}

export interface ClaimPage {
  rows: ClaimRow[]
  total: number
  limit: number
  offset: number
  status: string
  today: string
}

export interface OpenClaimResult {
  claim_id: string
  claim_no: string
  status: ClaimStatus
  opened_on: string
  warranty_id: string
  unit_label: string | null
  product_name: string
  covered_until: string
  was_expired: boolean
  cost_minor: number
}

export interface ClaimMoveResult {
  claim_id: string
  claim_no: string
  status: ClaimStatus
  was: ClaimStatus
  closed_on: string | null
  cost_minor: number
  warranty_id: string
}

export interface VoidResult {
  warranty_id: string
  voided: boolean
  already_void: boolean
  unit_label: string | null
  product_name?: string
}

export interface ExpiringReport {
  type: 'expiring'
  rows: UnitRow[]
  total: number
  limit: number
  offset: number
  totals: { units: number; expired: number; claims: number }
  today: string
  horizon_days: number
  ends_to: string
}

export interface ClaimsReport {
  type: 'claims'
  rows: ClaimRow[]
  total: number
  limit: number
  offset: number
  totals: { claims: number; open: number; replaced: number; rejected: number; cost_minor: number }
  today: string
  from: string
  to: string
}

// ── The product field ─────────────────────────────────────────────────────

/**
 * What a product says about its own cover, in months.
 *
 * A blank, a zero or something unreadable all mean the same thing to a shop:
 * this product does not promise anything by itself — which is a different thing
 * from promising zero months, and the reason the register falls back to the
 * shop's own rule rather than inventing one.
 */
export function monthsFromProduct(metadata: Record<string, unknown> | undefined): number | null {
  const raw = metadata?.[WARRANTY_MONTHS_KEY]
  if (raw === null || raw === undefined || raw === '') return null
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.min(600, Math.round(value))
}

/** The sentence a shopkeeper reads where the field would otherwise be empty. */
export function monthsLabel(months: number | null | undefined): string {
  if (months === null || months === undefined || !Number.isFinite(months)) return 'No cover'
  if (months <= 0) return 'No cover'
  if (months === 1) return '1 month'
  if (months % 12 === 0) {
    const years = months / 12
    return years === 1 ? '1 year' : `${years} years`
  }
  return `${months} months`
}

// ── The promise a cart will make ──────────────────────────────────────────

export interface CoverRule {
  coverAll: boolean
  defaultMonths: number
}

/**
 * Which lines of a cart will be promised, and for how long — the till's answer
 * to "what am I promising here?".
 *
 * The order of authority is the server's, mirrored: an explicit product value
 * wins, then the shop's "cover everything I sell" rule. A line with neither is
 * not promised at all, so the panel never implies cover the shop did not offer.
 */
export function coveredLines(
  lines: readonly PanelLine[] | undefined,
  rule: CoverRule
): Array<{ line: PanelLine; months: number }> {
  const out: Array<{ line: PanelLine; months: number }> = []
  for (const line of lines ?? []) {
    const own = monthsFromProduct(line.metadata)
    const months = own ?? (rule.coverAll ? Math.max(0, Math.round(rule.defaultMonths)) : 0)
    if (months > 0) out.push({ line, months })
  }
  return out
}

/** What the till shows above the cart: how many units, and for how long. */
export function tillSummary(
  lines: readonly PanelLine[] | undefined,
  rule: CoverRule
): { lines: number; units: number; months: number[]; label: string } {
  const covered = coveredLines(lines, rule)
  const units = covered.reduce(
    (total, entry) => total + Math.min(MAX_UNITS_PER_LINE, Math.max(1, Math.floor(entry.line.quantity))),
    0
  )
  const months = [...new Set(covered.map((entry) => entry.months))].sort((a, b) => a - b)

  if (covered.length === 0) {
    return { lines: 0, units: 0, months: [], label: 'Nothing in this cart carries cover.' }
  }

  const span =
    months.length === 1
      ? monthsLabel(months[0])
      : `${monthsLabel(months[0])} to ${monthsLabel(months[months.length - 1])}`
  const unitLabel = units === 1 ? '1 unit' : `${units} units`
  return {
    lines: covered.length,
    units,
    months,
    label: `${unitLabel} on ${covered.length === 1 ? '1 line' : `${covered.length} lines`} · ${span}`,
  }
}

/**
 * The day a promise of `months` months ends, from a start date.
 *
 * Calendar months, and computed in UTC so a browser six hours ahead of UTC
 * cannot turn the 31st into the 1st. Postgres clamps an impossible day-of-month
 * the same way a wall calendar does, and so does this.
 */
export function endDateFor(startISO: string, months: number): string | null {
  const start = new Date(`${String(startISO).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(start.getTime())) return null
  const year = start.getUTCFullYear()
  const month = start.getUTCMonth()
  const day = start.getUTCDate()
  const targetMonth = month + Math.max(0, Math.round(months))
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate()
  const end = new Date(Date.UTC(year, targetMonth, Math.min(day, lastDay)))
  return end.toISOString().slice(0, 10)
}

// ── Reading a promise ─────────────────────────────────────────────────────

export type Coverage = 'void' | 'claimed' | 'expired' | 'expiring' | 'live'

/**
 * What a row *is*, as a shopkeeper would say it. Derived rather than stored —
 * the server keeps ACTIVE or VOID, which is what a person did, and never an
 * `EXPIRED` that would be wrong every night between midnight and the job.
 */
export function coverageOf(
  row: { status: WarrantyStatus; days_left: number; claim?: ClaimSummary | null },
  warnDays: number,
  options: { hideClaims?: boolean } = {}
): Coverage {
  if (row.status === 'VOID') return 'void'
  if (!options.hideClaims && row.claim && row.claim.status !== 'CLOSED' && row.claim.status !== 'REJECTED') {
    return 'claimed'
  }
  if (row.days_left < 0) return 'expired'
  if (row.days_left <= warnDays) return 'expiring'
  return 'live'
}

export function coverageLabel(coverage: Coverage): string {
  switch (coverage) {
    case 'void':
      return 'Void'
    case 'claimed':
      return 'In for repair'
    case 'expired':
      return 'Expired'
    case 'expiring':
      return 'Expiring'
    default:
      return 'Covered'
  }
}

export function coverageTone(coverage: Coverage): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  switch (coverage) {
    case 'void':
      return 'neutral'
    case 'claimed':
      return 'info'
    case 'expired':
      return 'danger'
    case 'expiring':
      return 'warning'
    default:
      return 'success'
  }
}

/** `Covered for another 2 years`, `Expired 41 days ago`. */
export function daysLeftLabel(days: number): string {
  if (days < 0) {
    const past = Math.abs(days)
    return `Ended ${past === 1 ? 'yesterday' : `${past} days ago`}`
  }
  if (days === 0) return 'Ends today'
  if (days === 1) return 'Ends tomorrow'
  if (days < 60) return `${days} days left`
  if (days < 365) return `${Math.round(days / 30)} months left`
  const years = Math.round((days / 365) * 10) / 10
  return `${years} year${years === 1 ? '' : 's'} left`
}

/** How a unit is named on a row: its own label, or its number within the line. */
export function unitLabel(row: { unit_label: string | null; unit_index: number }): string {
  const label = row.unit_label?.trim()
  if (label) return label
  return `Unit ${row.unit_index}`
}

export function missingCoverLabel(missing: number): string {
  if (missing <= 0) return 'every promised unit is on record'
  return missing === 1 ? '1 unit still has no promise' : `${missing} units still have no promise`
}

// ── Claims ────────────────────────────────────────────────────────────────

export function claimStatusLabel(status: ClaimStatus | string): string {
  switch (status) {
    case 'OPEN':
      return 'Reported'
    case 'APPROVED':
      return 'Approved'
    case 'REPAIRING':
      return 'In the workshop'
    case 'REPLACED':
      return 'Replaced'
    case 'REJECTED':
      return 'Refused'
    case 'CLOSED':
      return 'Closed'
    default:
      return String(status)
  }
}

export function claimTone(status: ClaimStatus | string): 'info' | 'warning' | 'success' | 'danger' | 'neutral' {
  switch (status) {
    case 'OPEN':
      return 'warning'
    case 'APPROVED':
      return 'info'
    case 'REPAIRING':
      return 'info'
    case 'REPLACED':
      return 'success'
    case 'REJECTED':
      return 'danger'
    case 'CLOSED':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function isFinished(status: ClaimStatus | string): boolean {
  return status === 'REPLACED' || status === 'REJECTED' || status === 'CLOSED'
}

/**
 * What a claim may become next — the same ladder the server enforces.
 *
 * Mirrored rather than fetched because a button that offers a move the server
 * will refuse is worse than no button: the shopkeeper loses the slip number
 * they were reading. A test pins this list against the server's rules, and the
 * server refuses anything this list gets wrong.
 */
export function nextClaimStatuses(status: ClaimStatus | string): ClaimStatus[] {
  switch (status) {
    case 'OPEN':
      return ['APPROVED', 'REPAIRING', 'REPLACED', 'REJECTED', 'CLOSED']
    case 'APPROVED':
      return ['REPAIRING', 'REPLACED', 'REJECTED', 'CLOSED', 'OPEN']
    case 'REPAIRING':
      return ['REPLACED', 'REJECTED', 'CLOSED', 'APPROVED']
    default:
      return []
  }
}

/** `Refused: cover ended on 12 Mar 2027`. */
export function claimNextLabel(status: ClaimStatus): string {
  switch (status) {
    case 'APPROVED':
      return 'Approve'
    case 'REPAIRING':
      return 'Send to workshop'
    case 'REPLACED':
      return 'Replaced'
    case 'REJECTED':
      return 'Refuse'
    case 'CLOSED':
      return 'Close'
    default:
      return 'Reported'
  }
}

// ── Money ─────────────────────────────────────────────────────────────────

/** `৳1,255.50` — the core's own formatter, so a plugin cannot print money differently. */
export function moneyLabel(minorUnits: number, currency: string): string {
  return formatMoney(minor(Math.round(minorUnits)), { currency })
}

/** `1255.5` or `৳1,255.50` typed by a shopkeeper, as minor units. */
export function costToMinor(text: string): number | null {
  const parsed = parseMinor(text)
  return parsed === null ? null : Number(parsed)
}

export function sumMinor(values: readonly number[]): number {
  return values.reduce((total, value) => total + Math.round(value), 0)
}

// ── Sentences for a shopkeeper ────────────────────────────────────────────

/**
 * The server answers in names — `warranty_expired`, `warranty_claim_open` —
 * because a name is stable and a sentence is not. Both halves are worth having:
 * the name is what the code tests, the sentence is what the shopkeeper reads.
 */
export function reasonLabel(reason: string): string {
  switch (reason) {
    case 'warranty_not_found':
      return 'no cover has ever been recorded for that unit'
    case 'warranty_is_void':
      return 'that cover was voided — open the register to see why'
    case 'warranty_expired':
      return 'the cover on that unit has ended — honour it anyway if the shop chooses to'
    case 'warranty_claim_open':
      return 'there is already a claim open on that unit'
    case 'warranty_claim_finished':
      return 'that claim is finished and cannot be changed'
    case 'warranty_claim_not_found':
      return 'no such claim in this shop'
    case 'warranty_illegal_transition':
      return 'a claim cannot move that way'
    case 'warranty_reason_required':
      return 'say why the cover is being dropped'
    case 'warranty_required':
      return 'choose a unit first'
    case 'warranty_label_too_long':
      return 'that number is longer than 120 characters'
    case 'warranty_sale_required':
      return 'no sale was named'
    case 'warranty_unknown_sale':
      return 'that sale is not this shop’s'
    case 'warranty_sale_not_sold':
      return 'a sale that is not finished has nothing to promise'
    case 'warranty_search_too_short':
      return 'type at least two characters'
    case 'warranty_unknown_scope':
      return 'the register does not know that filter'
    case 'warranty_unknown_claim_status':
      return 'no such claim status'
    case 'warranty_unknown_report':
      return 'this plugin version does not have that report'
    case 'warranty_package_unsafe':
      return 'the plugin’s tables are not tenant-safe — this build must not be used'
    case 'permission_denied':
      return 'your role does not allow this'
    case 'forbidden':
      return 'your role does not allow this'
    case 'plugin_not_enabled':
      return 'this shop does not have Warranty switched on'
    case 'plugin_rpc_unknown':
      return 'this plugin version does not match the shop’s server'
    default:
      return reason.replace(/^(warranty|plugin)_/, '').replace(/_/g, ' ')
  }
}

/**
 * The sentence for a thrown error.
 *
 * The server refuses by name — `permission_denied: warranty.view`,
 * `warranty_expired: Fridge (ended 2027-03-12)` — and a screen that shows the
 * raw string is showing a shopkeeper a database code. A known name becomes a
 * sentence with its detail kept; an unknown one is passed through, because
 * inventing a sentence for an error we do not recognise would be worse than
 * quoting it.
 */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const [head = '', ...rest] = message.split(':')
  const key = head.trim()
  const detail = rest.join(':').trim()
  const known = [
    'warranty_not_found',
    'warranty_is_void',
    'warranty_expired',
    'warranty_claim_open',
    'warranty_claim_finished',
    'warranty_claim_not_found',
    'warranty_illegal_transition',
    'warranty_reason_required',
    'warranty_required',
    'warranty_label_too_long',
    'warranty_sale_required',
    'warranty_unknown_sale',
    'warranty_sale_not_sold',
    'warranty_search_too_short',
    'warranty_unknown_scope',
    'warranty_unknown_claim_status',
    'warranty_unknown_report',
    'warranty_package_unsafe',
    'permission_denied',
    'forbidden',
    'plugin_not_enabled',
    'plugin_rpc_unknown',
  ]
  if (!known.includes(key)) return detail === '' ? message : `${key}: ${detail}`
  const sentence = reasonLabel(key)
  return detail === '' ? sentence : `${sentence} (${detail})`
}

// ── Paper ─────────────────────────────────────────────────────────────────

/** Escapes the five characters that can end a paste’s day. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface CertificateInput {
  /** The promise's own terms line, written by the server from the shop's name. */
  terms?: string | null
  product: string
  variant?: string | null
  unit?: string | null
  months: number
  starts_on: string
  ends_on: string
  invoice_no?: string | null
  customer?: string | null
  claim_no?: string | null
}

/**
 * The slip a shop hands over with a big-ticket sale: what is covered, until
 * when, and where to bring it.
 *
 * A plain HTML string rather than a rendered element, so the calling screen can
 * hand it to a print window — and so this can be tested without a DOM.
 */
export function certificate(input: CertificateInput): string {
  const rows: Array<[string, string]> = [
    ['Item', input.variant ? `${input.product} — ${input.variant}` : input.product],
    ['Unit', input.unit && input.unit !== '' ? input.unit : '—'],
    ['Cover', monthsLabel(input.months)],
    ['From', input.starts_on],
    ['Until', input.ends_on],
    ['Invoice', input.invoice_no ?? '—'],
    ['Customer', input.customer ?? '—'],
  ]
  if (input.claim_no) rows.push(['Claim', input.claim_no])
  if (input.terms) rows.push(['Guaranteed by', input.terms])

  const body = rows
    .map(([label, value]) => `    <tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('\n')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Warranty — ${escapeHtml(input.product)}</title>
<style>
  body { font: 13px/1.5 system-ui, sans-serif; margin: 32px; color: #111; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  p.meta { margin: 0 0 18px; color: #555; }
  table { border-collapse: collapse; width: 100%; max-width: 520px; }
  th, td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { width: 32%; color: #555; font-weight: 600; }
  p.note { margin-top: 18px; color: #555; max-width: 520px; }
</style>
</head>
<body>
<h1>Warranty certificate</h1>
<p class="meta">Printed ${escapeHtml(new Date().toISOString().slice(0, 10))}</p>
<table>
  <tbody>
${body}
  </tbody>
</table>
<p class="note">Keep this slip. Bring it with the item and the shop can find the promise in seconds.</p>
</body>
</html>`
}

/** True when a promise ends inside the next `warnDays` — used for tiles and chips. */
export function endsWithin(row: { ends_on: string; status: WarrantyStatus }, today: string, warnDays: number): boolean {
  if (row.status !== 'ACTIVE') return false
  const end = Date.parse(`${row.ends_on.slice(0, 10)}T00:00:00Z`)
  const from = Date.parse(`${today.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(end) || Number.isNaN(from)) return false
  const days = Math.round((end - from) / MS_PER_DAY)
  return days >= 0 && days <= warnDays
}
