/**
 * Variants — the shapes its server functions return, and the small pieces of
 * arithmetic the screens need.
 *
 * Everything here is deliberately dumb: no fetching, no DOM. Keeping the
 * parsing and the money conversion in one file is what lets the builder and the
 * options screen be about layout, and the tests be about behaviour.
 */

import { formatMoney, minorToFixed, parseMinor, type Minor } from '../../shared/domain/money'

// ── What the plugin's own functions return ────────────────────────────────

export interface OptionValue {
  id: string
  value: string
  sort_order: number
}

export interface OptionType {
  id: string
  name: string
  sort_order: number
  values: OptionValue[]
  /** How many products already use this option as one of their axes. */
  products: number
}

export interface CatalogTotals {
  types: number
  values: number
  products: number
  variants: number
}

export interface Catalog {
  types: OptionType[]
  totals: CatalogTotals
  config: { max_variants: number }
}

export interface VariantRow {
  variant_id: string
  /** `S / Red`. Null on the variant that carries the product itself. */
  name_suffix: string | null
  sku: string | null
  option_values: Record<string, string>
  /** Minor units, or null when the variant inherits the product's price. */
  price_override: number | null
  /** 1/10000 units, to match `numeric(14,4)`, or null when inheriting. */
  cost_override: number | null
  image_url: string | null
  is_active: boolean
  is_default: boolean
  /** What the till would charge: the override, or the product's price. */
  price: number
  cost: number
}

export interface AxisRow {
  option_type_id: string
  name: string
  sort_order: number
  value_ids: string[]
  values: Array<{ id: string; value: string }>
}

export interface ProductState {
  product: { id: string; name: string; sku: string | null; price: number; cost: number }
  axes: AxisRow[]
  variants: VariantRow[]
}

export interface PlanRow {
  suffix: string
  option_values: Record<string, string>
  value_ids: string[]
  exists: boolean
}

export interface Plan {
  rows: PlanRow[]
  total: number
  new: number
  limit: number
}

export interface OverviewRow {
  product_id: string
  name: string
  sku: string | null
  axes: number
  variants: number
}

export interface Overview {
  products: OverviewRow[]
  limit: number
}

export interface BulkResult {
  field: 'price' | 'cost'
  mode: 'set' | 'percent'
  only_inherited: boolean
  updated: number
}

/** What an axis looks like on the wire — the shape both plans and builds take. */
export interface AxisDraft {
  option_type_id: string
  value_ids: string[]
}

// ── Combinations ──────────────────────────────────────────────────────────

/**
 * How many combinations a selection would make, counted without asking the
 * server. The preview is authoritative — it also reports what already exists —
 * but a number beside the checkboxes should not need a round trip.
 */
export function combinationsOf(axes: readonly AxisDraft[]): number {
  if (axes.length === 0) return 0
  let total = 1
  for (const axis of axes) {
    if (axis.value_ids.length === 0) return 0
    total *= axis.value_ids.length
  }
  return total
}

/** The axes a shop has actually filled in — an option with no values is not one. */
export function filledAxes(draft: Map<string, Set<string>>): AxisDraft[] {
  const out: AxisDraft[] = []
  for (const [option_type_id, values] of draft) {
    if (values.size === 0) continue
    out.push({ option_type_id, value_ids: [...values] })
  }
  return out
}

// ── Money ─────────────────────────────────────────────────────────────────

/**
 * A price override (minor units) as the text an input shows.
 *
 * An empty box means *inherit the product's price*, which is why a null is an
 * empty string and never a zero: a free variant is a real thing a shop means.
 */
export function priceToInput(price: number | null): string {
  return price === null ? '' : minorToFixed(price as Minor)
}

/** The reverse. Blank → null (inherit); something unreadable → undefined (refuse). */
export function inputToPrice(text: string): number | null | undefined {
  if (text.trim() === '') return null
  const parsed = parseMinor(text)
  return parsed === null ? undefined : parsed
}

/**
 * Cost overrides carry four decimals in the core (`numeric(14,4)`), so they are
 * not minor units: the database stores them in 1/10000ths and the plugin passes
 * that through unchanged. Converting in one place keeps that oddity from
 * spreading into the screens.
 */
export function costToInput(cost: number | null): string {
  return cost === null ? '' : (cost / 10_000).toFixed(2)
}

export function inputToCost(text: string): number | null | undefined {
  if (text.trim() === '') return null
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) return undefined
  return Math.round(value * 10_000)
}

/** A price for display, in the shop's currency. */
export function priceLabel(price: number, currency: string): string {
  return formatMoney(price as Minor, { currency })
}

// ── Errors ────────────────────────────────────────────────────────────────

/**
 * Turn a refused call into a sentence a shopkeeper can act on.
 *
 * The server is the only thing that decides these, and it raises them with a
 * machine-readable name — `variants_partial_combination: 2 of 4 combinations
 * already exist. Include every value, or remove the ones that already have
 * variants.` — so the job here is to keep the readable half and drop the code,
 * not to invent a message that could drift from the rule it describes.
 */
export function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/permission_denied/i.test(raw)) {
    return 'You do not have permission to change this shop’s variants.'
  }
  const match = /\bvariants_[a-z_]+:\s*([\s\S]+)$/.exec(raw)
  if (match?.[1]) return match[1].trim().split('\n')[0] ?? raw
  return raw
}
