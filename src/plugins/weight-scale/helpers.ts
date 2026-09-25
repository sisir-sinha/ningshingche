/**
 * Weighing scale — reading a label, and everything that follows from it.
 *
 * This file is the whole of the plugin's intelligence and it touches nothing but
 * its arguments: no registry, no database, no DOM. That is deliberate — the
 * till asks this code a question on every scan, offline, in a shop with a queue
 * at the counter, and the answer has to be the same on a phone in a market as it
 * is on a laptop in an office.
 *
 * ── What a scale label is ──────────────────────────────────────────────────
 *
 * A shop's scale prints an in-store EAN-13: an in-store prefix (`22`, `21`,
 * `29`…), then the product's **PLU** — the number the shopkeeper programmed into
 * the scale — then the **weight in grams** (or, on some counters, the price of
 * the package), then a check digit. The label is not in the shop's barcode
 * table and never will be: it is unique to that weighing, so there is nothing to
 * add to the catalogue. The PLU inside it *is* in the catalogue — as the
 * product's code — and that is the bridge the till walks across.
 *
 * ── What we will not do ────────────────────────────────────────────────────
 *
 * We do not guess. A code that does not fit a layout the shop described returns
 * `null`, and the till falls through to its ordinary search, which is exactly
 * what it did before this plugin existed. A resolver is asked about *every* code
 * the shop's own barcodes did not match, so a plugin that "recognised" too much
 * would quietly break ordinary scanning — the worst possible bug in a POS,
 * because it would look like the scanner.
 *
 * And we never invent a price. A weight label carries grams; the shop's price
 * does that arithmetic, in `complete_sale`, on the server, for every line.
 * A price label carries a price *we* cannot charge — so it is read here, shown
 * in the plugin's screen, and refused at the till (see docs/10 §Phase 7: the
 * core cannot override a line's price yet).
 */

import { formatMoney, minor } from '../../shared/domain/money'
import type { ScanMatch } from '../../shared/registry/plugin-types'

// ── A layout ───────────────────────────────────────────────────────────────

/**
 * One way this shop's scale prints a label.
 *
 * Two scales in one shop routinely disagree — the produce scale prints five PLU
 * digits and the meat counter's prints four — so a layout is **data the shop
 * owns**, not a constant. What is fixed is the meaning: a weight field is grams,
 * a price field is minor units, and the PLU is matched exactly as printed.
 */
export interface LabelFormat {
  id: string
  name: string
  /** What an in-store label starts with, digits only. */
  prefix: string
  /** How many digits the scale uses for the product's PLU. */
  pluDigits: number
  /** How many digits it uses for the weight or the price. */
  valueDigits: number
  /** What those digits mean. */
  valueKind: 'weight' | 'price'
  /** A real EAN-13 ends in a check digit; a cheap label printer may not. */
  checkDigit: boolean
  /** True for the layout this plugin ships with, until the shop replaces it. */
  builtin?: boolean
}

/**
 * The layout a shop gets before it describes its own — and the one `app.
 * weight_scale_default_format()` builds in SQL, value for value.
 *
 * The standard in-store label: `22`, five PLU digits, five value digits read as
 * grams, and an EAN-13 check digit. A grocery that installs this plugin and does
 * nothing else can weigh lentils today; the moment it tells the till what its
 * scale really prints, the shop's own layout wins.
 */
export const DEFAULT_FORMATS: readonly LabelFormat[] = [
  {
    id: 'standard',
    name: 'Standard in-store label',
    prefix: '22',
    pluDigits: 5,
    valueDigits: 5,
    valueKind: 'weight',
    checkDigit: true,
    builtin: true,
  },
]

const MAX_PREFIX = 4
const MAX_PLU_DIGITS = 8
const MAX_VALUE_DIGITS = 6

const digits = (value: unknown): string => String(value ?? '').replace(/[^0-9]/g, '')

const asBool = (value: unknown): boolean =>
  value === true || value === 'true' || value === 't' || value === 1 || value === '1' || value === 'yes'

/** A layout as the shop typed it, or `null` if nothing usable is left. */
export function normaliseFormat(raw: unknown): LabelFormat | null {
  if (typeof raw !== 'object' || raw === null) return null
  const input = raw as Record<string, unknown>

  const prefix = digits(input.prefix)
  const pluDigits = Number(digits(input.pluDigits))
  const valueDigits = Number(digits(input.valueDigits))
  const valueKind = String(input.valueKind ?? 'weight').toLowerCase()

  if (prefix === '' || prefix.length > MAX_PREFIX) return null
  if (!Number.isInteger(pluDigits) || pluDigits < 1 || pluDigits > MAX_PLU_DIGITS) return null
  if (!Number.isInteger(valueDigits) || valueDigits < 1 || valueDigits > MAX_VALUE_DIGITS) return null
  if (valueKind !== 'weight' && valueKind !== 'price') return null

  const id = typeof input.id === 'string' && input.id.trim() !== '' ? input.id.trim() : `${prefix}-${pluDigits}-${valueDigits}`
  const name = typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : 'Label'

  const format: LabelFormat = {
    id,
    name,
    prefix,
    pluDigits,
    valueDigits,
    valueKind,
    checkDigit: asBool(input.checkDigit),
  }
  if (asBool(input.builtin)) format.builtin = true
  return format
}

/**
 * Every usable layout in a list, first id wins.
 *
 * A shop can hand-edit `plugins.config` — or arrive from a version that shaped
 * these fields differently — and the till must not read a label *wrongly* as a
 * result. Clamping is therefore asymmetric on purpose: a bad layout is dropped
 * (and the shop sees one fewer layout in the screen), never bent into something
 * that scans a kilo of rice as 250 g.
 */
export function normaliseFormats(raw: unknown): LabelFormat[] {
  if (!Array.isArray(raw)) return []
  const out: LabelFormat[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const format = normaliseFormat(entry)
    if (!format || seen.has(format.id)) continue
    seen.add(format.id)
    out.push(format)
  }
  return out
}

/** What the shop's settings say, with the built-in layout when they say nothing. */
export function formatsFromSettings(raw: unknown): LabelFormat[] {
  const formats = normaliseFormats(raw)
  return formats.length > 0 ? formats : DEFAULT_FORMATS.map((format) => ({ ...format }))
}

// ── Decoding a label ───────────────────────────────────────────────────────

export interface DecodedLabel {
  format: LabelFormat
  /** The PLU exactly as the scale printed it. */
  plu: string
  kind: 'weight' | 'price'
  /** Sale units, for a weight label: `2.35` for 2350 g. */
  quantity?: number
  /** Grams, for a weight label. */
  grams?: number
  /** What the label itself said, for a price label. */
  priceMinor?: number
}

/** How many digits a complete label from this layout has. */
export function totalDigits(format: LabelFormat): number {
  return format.prefix.length + format.pluDigits + format.valueDigits + (format.checkDigit ? 1 : 0)
}

/**
 * The check digit for a body of digits: the rightmost body digit counts three
 * times, the next once, and so on — the rule every EAN and UPC uses.
 *
 * Counted from the *right* on purpose. For a thirteen-digit label that is
 * exactly the EAN-13 rule, and it also does the right thing for a shop whose
 * scale prints twelve, which is the case that catches people out.
 */
export function checkDigitFor(body: string): number {
  let sum = 0
  for (let index = 0; index < body.length; index += 1) {
    const fromRight = body.length - 1 - index
    const digit = Number(body[index] ?? '0')
    sum += fromRight % 2 === 0 ? digit * 3 : digit
  }
  return (10 - (sum % 10)) % 10
}

/** The EAN-13 check digit for the first twelve digits of a label. */
export function ean13CheckDigit(first12: string): number {
  return checkDigitFor(first12)
}

export function isValidEan13(code: string): boolean {
  if (!/^[0-9]{13}$/.test(code)) return false
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

/**
 * What this code means, or `null` for "not ours".
 *
 * Formats are tried **in the shop's order**, and the first that fits wins: a shop
 * with two scales tells us which one to try first by the order it arranged them
 * in, and a code is only ever one thing.
 */
export function decodeLabel(code: string, formats: readonly LabelFormat[]): DecodedLabel | null {
  const clean = code.trim()
  // A scale label is a number. A code with letters or punctuation in it is a
  // product barcode, and answering it here would shadow the catalogue.
  if (clean === '' || !/^[0-9]+$/.test(clean)) return null

  for (const format of formats ?? []) {
    if (clean.length !== totalDigits(format)) continue
    if (!clean.startsWith(format.prefix)) continue
    // The check digit guards against a mis-read code, which is what a scanner
    // at a busy counter produces — and it guards whatever length this shop's
    // scale prints, not only thirteen digits.
    if (format.checkDigit && checkDigitFor(clean.slice(0, -1)) !== Number(clean.slice(-1))) continue

    const plu = clean.slice(format.prefix.length, format.prefix.length + format.pluDigits)
    const rawValue = clean.slice(format.prefix.length + format.pluDigits)
    const value = Number(format.checkDigit ? rawValue.slice(0, -1) : rawValue)

    // A scale that has not been programmed for an item prints its zero PLU, and
    // a label of zero grams is a mis-read rather than a sale of nothing.
    if (/^0+$/.test(plu) || !Number.isFinite(value) || value <= 0) continue

    if (format.valueKind === 'weight') {
      return { format, plu, kind: 'weight', grams: value, quantity: value / 1000 }
    }
    return { format, plu, kind: 'price', priceMinor: value }
  }

  return null
}

// ── Saying it out loud ─────────────────────────────────────────────────────

/** `2.350 kg` — three decimals, the way a scale prints. */
export function weightText(grams: number): string {
  return `${(grams / 1000).toFixed(3)} kg`
}

export function moneyText(minorUnits: number, currency: string): string {
  return formatMoney(minor(Math.round(minorUnits)), { currency })
}

/** What the label said, in one phrase: a weight, or the price on the package. */
export function labelValueText(decoded: DecodedLabel, currency: string): string {
  if (decoded.kind === 'weight') return weightText(decoded.grams ?? 0)
  return moneyText(decoded.priceMinor ?? 0, currency)
}

/** `22 + 5 PLU + 5 g + check` — how a shopkeeper compares two layouts. */
export function formatSummary(format: LabelFormat): string {
  const value = format.valueKind === 'weight' ? `${format.valueDigits} g` : `${format.valueDigits} price`
  return `${format.prefix} + ${format.pluDigits} PLU + ${value}${format.checkDigit ? ' + check' : ''}`
}

/**
 * A label this layout could print, for the shop to hold against a real one.
 *
 * The PLU and the value are the shopkeeper's to choose (a real PLU, a real
 * weight), because the *shape* is the thing being checked, not the numbers.
 */
export function labelExample(format: LabelFormat, plu = '', grams = 1250, priceMinor = 4950): string {
  const pluDigits = (plu || '1').replace(/[^0-9]/g, '').padStart(format.pluDigits, '0').slice(-format.pluDigits)
  const value = format.valueKind === 'weight' ? String(grams) : String(priceMinor)
  const valueDigits = value.padStart(format.valueDigits, '0').slice(-format.valueDigits)
  const body = `${format.prefix}${pluDigits}${valueDigits}`
  if (!format.checkDigit) return body
  return body + String(checkDigitFor(body))
}

/**
 * The PLUs worth trying for a printed code, first the exact one.
 *
 * Zero-padding is the one place a shop's data and a scale's output routinely
 * disagree: the scale prints `00012` because its field is five digits wide, and
 * a shopkeeper may have entered the PLU as `12`. We hand the till the code as
 * printed — the honest answer, and the one the shop can fix by looking — and the
 * screen shows both forms so the fix takes a second.
 */
export function pluVariants(plu: string): string[] {
  const trimmed = plu.replace(/^0+/, '')
  return trimmed === '' || trimmed === plu ? [plu] : [plu, trimmed]
}

/** The line a cashier reads when a label is recognised: `Meat scale · 2.350 kg`. */
export function labelNote(decoded: DecodedLabel): string {
  return `${decoded.format.name} · ${labelValueText(decoded, '')}`.replace(' ·  · ', ' · ')
}

/**
 * The decode, as the till's scan resolver wants it.
 *
 * Weight labels become a line at the weight on the label, and that is the whole
 * point of the plugin: a 2.350 kg label adds 2.350 kg. `unitPriceMinor` is
 * attached only when the shop asked to see it and only as information — the core
 * compares it with the shelf price and warns; it never becomes the price charged.
 */
export function scanMatch(
  decoded: DecodedLabel,
  options: { reportLabelPrice: boolean; currency: string }
): ScanMatch {
  const match: ScanMatch = {
    lookupCode: decoded.plu,
    note: `${decoded.format.name} · ${labelValueText(decoded, options.currency)}`,
  }
  if (decoded.kind === 'weight' && decoded.quantity !== undefined) match.quantity = decoded.quantity
  if (
    decoded.kind === 'price' &&
    options.reportLabelPrice &&
    decoded.priceMinor !== undefined
  ) {
    match.unitPriceMinor = decoded.priceMinor
  }
  return match
}

// ── Describing a layout, for the screen ────────────────────────────────────

export interface FormatDraft {
  id: string
  name: string
  prefix: string
  pluDigits: string
  valueDigits: string
  valueKind: 'weight' | 'price'
  checkDigit: boolean
}

export function emptyDraft(): FormatDraft {
  return {
    id: '',
    name: '',
    prefix: '',
    pluDigits: '5',
    valueDigits: '5',
    valueKind: 'weight',
    checkDigit: true,
  }
}

export function draftOf(format: LabelFormat): FormatDraft {
  return {
    id: format.id,
    name: format.name,
    prefix: format.prefix,
    pluDigits: String(format.pluDigits),
    valueDigits: String(format.valueDigits),
    valueKind: format.valueKind,
    checkDigit: format.checkDigit,
  }
}

/** A stable id for a layout, from what the shopkeeper typed. */
export function formatIdFor(prefix: string, pluDigits: string, valueDigits: string): string {
  const clean = (value: string): string => digits(value) || '0'
  return `${clean(prefix)}-${clean(pluDigits)}-${clean(valueDigits)}`
}

/**
 * What is wrong with a layout the shop just typed, or `null`.
 *
 * Phrased as what to do rather than what is invalid — this is read by a
 * shopkeeper holding a label from their own scale, not by a programmer.
 */
export function validateFormat(draft: FormatDraft, existing: readonly LabelFormat[]): string | null {
  if (draft.name.trim() === '') return 'Give the layout a name you will recognise — “Produce scale”, say.'
  if (draft.prefix.replace(/[^0-9]/g, '') === '') return 'The prefix is the first digits on the label, before the PLU — usually 22 or 21.'
  if (draft.prefix.replace(/[^0-9]/g, '').length > MAX_PREFIX) return `A prefix is at most ${MAX_PREFIX} digits.`

  const pluDigits = Number(digits(draft.pluDigits))
  const valueDigits = Number(digits(draft.valueDigits))
  if (!Number.isInteger(pluDigits) || pluDigits < 1 || pluDigits > MAX_PLU_DIGITS) {
    return `The PLU is between 1 and ${MAX_PLU_DIGITS} digits — count the digits your scale uses for it.`
  }
  if (!Number.isInteger(valueDigits) || valueDigits < 1 || valueDigits > MAX_VALUE_DIGITS) {
    return `The weight is between 1 and ${MAX_VALUE_DIGITS} digits — five is usual, in grams.`
  }

  const candidate: LabelFormat = {
    id: formatIdFor(draft.prefix, draft.pluDigits, draft.valueDigits),
    name: draft.name.trim() === '' ? 'Label' : draft.name.trim(),
    prefix: draft.prefix.replace(/[^0-9]/g, ''),
    pluDigits,
    valueDigits,
    valueKind: draft.valueKind,
    checkDigit: draft.checkDigit,
  }

  // Two layouts that read the same codes are not a mistake the till can resolve:
  // it tries them in order and the first one wins, so the other would be a row
  // in this list that never does anything.
  const clash = existing.find(
    (format) =>
      format.id !== draft.id &&
      (format.id === candidate.id ||
        (format.prefix === candidate.prefix && totalDigits(format) === totalDigits(candidate)))
  )
  if (clash) {
    return `“${clash.name}” already reads labels with this prefix and these digit counts — the till would try that one first.`
  }

  return null
}

/** A layout that would read the same code as another one, if any. */
export function clashesWith(format: LabelFormat, existing: readonly LabelFormat[]): LabelFormat | null {
  for (const other of existing) {
    if (other.id === format.id) continue
    if (other.prefix !== format.prefix) continue
    if (totalDigits(other) !== totalDigits(format)) continue
    return other
  }
  return null
}

/** One line naming every layout the till will try, in order. */
export function formatsNote(formats: readonly LabelFormat[]): string {
  if (formats.length === 0) return 'No layout described yet.'
  return formats.map((format) => `${format.name} (${formatSummary(format)})`).join(' · ')
}

/**
 * What went wrong, in words a shopkeeper can act on.
 *
 * The server is the gate on everything this plugin writes: the settings screen
 * writes the same `plugins.config` row a report reads, and the database decides
 * who may write it. So the commonest failure here is not a bug — it is a user
 * who may see the scale but not describe it, and the message has to say that
 * rather than show a PostgREST string.
 */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (message.includes('permission_denied')) {
    return 'You do not have permission to change how this shop’s labels are read.'
  }
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'The shop could not be reached. Try again when you are back online.'
  }
  return message === '' ? 'That could not be saved.' : message
}

/** `builtin` layouts are read from `DEFAULT_FORMATS`, not from the shop's config. */
export function usingBuiltinLayouts(raw: unknown): boolean {
  return normaliseFormats(raw).length === 0
}
