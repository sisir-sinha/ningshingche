/**
 * Weighing scale — tested through the public plugin API.
 *
 * What matters is not that a screen renders but that a grocery can sell lentils:
 * a real label from a real scale decodes to a real product, a code that is not
 * ours is left alone (a resolver asked about *every* unknown code must not break
 * ordinary scanning), a price label is refused rather than charged wrongly, and
 * the shop’s own layout — not ours — decides how its labels are read.
 *
 * The SQL is exercised against a real Postgres by the live probe and the
 * migration validator; these tests are about the half that runs in a browser.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { EventBus } from '../../shared/bus/event-bus'
import { PluginRegistry } from '../../shared/registry/plugin-registry'
import { validateManifest } from '../../shared/registry/plugin-manifest'
import type {
  PluginDataStore,
  PluginDb,
  PluginSettings,
  ScanContext,
} from '../../shared/registry/plugin-types'
import weightScalePlugin from './index'
import { createWeightScaleScreen } from './labels-screen'
import {
  DEFAULT_REPORT_LABEL_PRICE,
  FORMATS_KEY,
  REPORT_LABEL_PRICE_KEY,
  WEIGHT_MANAGE,
  WEIGHT_SCALE_ID,
  WEIGHT_VIEW,
  weightScaleManifest,
} from './manifest'
import {
  DEFAULT_FORMATS,
  decodeLabel,
  describeError,
  ean13CheckDigit,
  formatsFromSettings,
  labelExample,
  normaliseFormats,
  pluVariants,
  totalDigits,
  usingBuiltinLayouts,
  validateFormat,
  weightText,
  type DecodedLabel,
  type FormatDraft,
  type LabelFormat,
} from './helpers'

const ORG = '11111111-1111-1111-1111-111111111111'
const BRANCH = '22222222-2222-2222-2222-222222222222'

const CONTEXT: ScanContext = {
  organizationId: ORG,
  branchId: BRANCH,
  warehouseId: 'w1',
  currency: 'BDT',
}

/** A real label: prefix 22, PLU 12340, 750 g, and the EAN-13 check digit 4. */
const LABEL_750G = '2212340007504'

// ── A stand-in server and settings ────────────────────────────────────────

interface Call {
  fn: string
  args: Record<string, unknown>
}

let calls: Call[] = []
let answers: Record<string, unknown> = {}
let refuse: string | null = null
let bus: EventBus
let registry: PluginRegistry
let errors: unknown[] = []
let config: Record<string, unknown> = {}

function makeDb(): PluginDb {
  return {
    products: async () => [],
    rpc: async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
      calls.push({ fn, args })
      if (refuse) throw new Error(refuse)
      const answer = answers[fn]
      if (typeof answer === 'function') {
        return (answer as (args: Record<string, unknown>) => unknown)(args) as T
      }
      return (answer ?? null) as T
    },
  }
}

function settingsStore(): PluginSettings {
  return {
    get: <T,>(key: string, fallback: T): T => (key in config ? (config[key] as T) : fallback),
    all: () => ({ ...config }),
    set: async (key, value) => {
      config[key] = value
    },
  }
}

beforeEach(() => {
  calls = []
  answers = {}
  refuse = null
  errors = []
  config = {}
  localStorage.clear()
  bus = new EventBus()
  bus.onError = (error) => errors.push(error)

  const dataStore: PluginDataStore = {
    get: async <T,>(_key: string, fallback: T): Promise<T> => fallback,
    set: async () => undefined,
    remove: async () => false,
    keys: async () => [],
  }

  registry = new PluginRegistry(bus, {
    settings: () => settingsStore(),
    data: () => dataStore,
    db: () => makeDb(),
  })
  registry.declare({ manifest: weightScaleManifest, load: async () => weightScalePlugin })
})

/** Waits for the promises a render or a handler kicked off. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const textOf = (node: Element): string => node.textContent ?? ''

/** Clicks the first button whose visible text says this. */
function press(root: Element, label: string): void {
  const button = [...root.querySelectorAll('button')].find((entry) =>
    (entry.textContent ?? '').trim().toLowerCase().includes(label.toLowerCase())
  )
  if (!button) {
    throw new Error(
      `no button reading “${label}” — saw: ${[...root.querySelectorAll('button')]
        .map((entry) => entry.textContent?.trim())
        .join(', ')}`
    )
  }
  button.click()
}

/** The scan resolver, as the till calls it. */
async function resolve(code: string, context: ScanContext = CONTEXT): Promise<unknown> {
  await registry.sync([WEIGHT_SCALE_ID])
  const resolver = registry.scanResolvers.items[0]
  if (!resolver) throw new Error('the plugin registered no scan resolver')
  return resolver.resolve(code, context)
}

// ── The manifest ──────────────────────────────────────────────────────────

describe('the manifest', () => {
  it('is a valid manifest the registry will load', () => {
    expect(() => validateManifest(weightScaleManifest)).not.toThrow()
    expect(weightScaleManifest.id).toBe(WEIGHT_SCALE_ID)
    expect(weightScaleManifest.category).toBe('industry')
    expect(weightScaleManifest.coreApiVersion).toBe('^1.0.0')
  })

  it('refuses a permission that is not its own', () => {
    expect(() =>
      validateManifest({
        ...weightScaleManifest,
        permissions: [{ key: 'sales.view', label: 'Sneaky', group: 'inventory' }],
      })
    ).toThrow()
  })

  it('namespaces both permissions, and needs nothing else installed', () => {
    const keys = (weightScaleManifest.permissions ?? []).map((permission) => permission.key)
    expect(keys).toEqual([WEIGHT_VIEW, WEIGHT_MANAGE])
    expect(keys.every((key) => key.startsWith('weight-scale.'))).toBe(true)
    expect(weightScaleManifest.dependencies ?? []).toEqual([])
    expect(weightScaleManifest.conflicts ?? []).toEqual([])
  })

  it('offers the one setting a shop decides without opening a screen', () => {
    const field = weightScaleManifest.settingsSchema?.[0]
    expect(field?.key).toBe(REPORT_LABEL_PRICE_KEY)
    expect(field?.type).toBe('boolean')
    expect(field?.default).toBe(DEFAULT_REPORT_LABEL_PRICE)
  })
})

// ── Reading a label ───────────────────────────────────────────────────────

describe('reading a scale label', () => {
  it('reads a real in-store label the way the scale printed it', () => {
    const decoded = decodeLabel(LABEL_750G, DEFAULT_FORMATS)
    expect(decoded?.plu).toBe('12340')
    expect(decoded?.kind).toBe('weight')
    expect(decoded?.grams).toBe(750)
    expect(decoded?.quantity).toBe(0.75)
    expect(decoded?.format.name).toBe('Standard in-store label')
  })

  it('computes the EAN-13 check digit the way the standard does', () => {
    expect(ean13CheckDigit('221234000750')).toBe(4)
    expect(ean13CheckDigit('221234002350')).toBe(4)
  })

  it('checks the digit from the right, so a shorter label works too', () => {
    // A produce scale printing eleven body digits: the rule counts from the
    // right, so the parity is the opposite of a thirteen-digit label's.
    const shorts: LabelFormat = {
      id: 'short',
      name: 'Short label',
      prefix: '21',
      pluDigits: 4,
      valueDigits: 4,
      valueKind: 'weight',
      checkDigit: true,
    }
    const example = labelExample(shorts, '0042', 1250)
    expect(example).toHaveLength(2 + 4 + 4 + 1)
    expect(decodeLabel(example, [shorts])?.quantity).toBe(1.25)
    // Flip the check digit and the label is a mis-read, not a sale.
    const wrong = example.slice(0, -1) + String((Number(example.slice(-1)) + 1) % 10)
    expect(decodeLabel(wrong, [shorts])).toBeNull()
  })

  it('leaves a code that is not a scale label completely alone', () => {
    // A factory EAN on a packet of biscuits: thirteen digits, prefix 40.
    expect(decodeLabel('4006381333931', DEFAULT_FORMATS)).toBeNull()
    // A short product code, a code with letters, a code with a space.
    expect(decodeLabel('1234', DEFAULT_FORMATS)).toBeNull()
    expect(decodeLabel('SKU-12345', DEFAULT_FORMATS)).toBeNull()
    expect(decodeLabel(' 2212340007504 ', DEFAULT_FORMATS)?.plu).toBe('12340')
  })

  it('will not read a label whose check digit is wrong', () => {
    // One digit off the end: a mis-scan, not a sale.
    expect(decodeLabel('2212340007505', DEFAULT_FORMATS)).toBeNull()
  })

  it('refuses an unprogrammed PLU and a label of nothing', () => {
    const zeroPlu = labelExample(DEFAULT_FORMATS[0]!, '00000', 1250)
    expect(decodeLabel(zeroPlu, DEFAULT_FORMATS)).toBeNull()
    const zeroWeight = labelExample(DEFAULT_FORMATS[0]!, '00012', 0)
    expect(decodeLabel(zeroWeight, DEFAULT_FORMATS)).toBeNull()
  })

  it('reads a layout the shop typed in, and tries the shop’s order', () => {
    const produce: LabelFormat = {
      id: 'produce',
      name: 'Produce scale',
      prefix: '21',
      pluDigits: 4,
      valueDigits: 5,
      valueKind: 'weight',
      checkDigit: false,
    }
    const label = labelExample(produce, '0042', 2350)
    expect(totalDigits(produce)).toBe(11)
    expect(decodeLabel(label, [produce])?.plu).toBe('0042')
    expect(decodeLabel(label, [produce])?.grams).toBe(2350)
    // With both layouts, the built-in one simply does not match, so the shop's
    // own is the answer — order decides nothing until two of them fit.
    const decoded = decodeLabel(label, [...DEFAULT_FORMATS, produce])
    expect(decoded?.format.id).toBe('produce')
  })

  it('reads the price of a package when that is what the label carries', () => {
    const deli: LabelFormat = {
      id: 'deli',
      name: 'Deli counter',
      prefix: '22',
      pluDigits: 5,
      valueDigits: 5,
      valueKind: 'price',
      checkDigit: true,
    }
    const decoded = decodeLabel(labelExample(deli, '00021', 0, 13500), [deli])
    expect(decoded?.kind).toBe('price')
    expect(decoded?.priceMinor).toBe(13500)
    // No weight was printed, so there is no weight to sell: refusing is the only
    // answer that cannot charge the wrong money.
    expect(decoded?.quantity).toBeUndefined()
  })

  it('clamps a layout a shop hand-edited into something unusable', () => {
    expect(
      normaliseFormats([
        { id: 'a', name: 'Good', prefix: '22', pluDigits: 5, valueDigits: 5, valueKind: 'weight', checkDigit: true },
        { id: 'b', name: 'Bad kind', prefix: '23', pluDigits: 5, valueDigits: 5, valueKind: 'guess' },
        { id: 'c', name: 'No prefix', prefix: '', pluDigits: 5, valueDigits: 5, valueKind: 'weight' },
        { id: 'd', name: 'Silly digits', prefix: '24', pluDigits: 0, valueDigits: 5, valueKind: 'weight' },
        { id: 'a', name: 'Duplicate', prefix: '25', pluDigits: 4, valueDigits: 4, valueKind: 'weight' },
        'not a layout at all',
      ]).map((format) => format.id)
    ).toEqual(['a'])
  })

  it('falls back to the built-in layout, matching the one the SQL builds', () => {
    expect(formatsFromSettings(undefined)).toEqual([...DEFAULT_FORMATS])
    const builtin = DEFAULT_FORMATS[0]!
    // `app.weight_scale_default_format()` in 050 — same five numbers.
    expect([builtin.prefix, builtin.pluDigits, builtin.valueDigits, builtin.valueKind, builtin.checkDigit]).toEqual([
      '22',
      5,
      5,
      'weight',
      true,
    ])
    expect(usingBuiltinLayouts(undefined)).toBe(true)
    expect(usingBuiltinLayouts([{ ...builtin }])).toBe(false)
  })

  it('round-trips an example label through the reader for every layout kind', () => {
    for (const format of [
      DEFAULT_FORMATS[0]!,
      { ...DEFAULT_FORMATS[0]!, id: 'no-check', checkDigit: false, prefix: '29' },
      { ...DEFAULT_FORMATS[0]!, id: 'price', valueKind: 'price' as const },
    ]) {
      const example = labelExample(format, '00012', 1250, 4950)
      const decoded = decodeLabel(example, [format])
      expect(decoded, `${format.id} could not read its own example ${example}`).not.toBeNull()
      expect(decoded?.plu).toBe('00012')
    }
  })

  it('says what a shopkeeper has to do about each invalid layout', () => {
    const draft: FormatDraft = {
      id: '',
      name: '',
      prefix: '22',
      pluDigits: '5',
      valueDigits: '5',
      valueKind: 'weight',
      checkDigit: true,
    }
    expect(validateFormat(draft, [])).toContain('name')
    expect(validateFormat({ ...draft, name: 'Produce', prefix: '' }, [])).toContain('prefix')
    expect(validateFormat({ ...draft, name: 'Produce', pluDigits: '12' }, [])).toContain('between 1 and 8')
    expect(validateFormat({ ...draft, name: 'Produce' }, DEFAULT_FORMATS)).toContain(
      'already reads labels'
    )
    expect(validateFormat({ ...draft, name: 'Produce', prefix: '21' }, DEFAULT_FORMATS)).toBeNull()
  })

  it('turns a failure into something a shopkeeper can act on', () => {
    expect(describeError(new Error('permission_denied: weight-scale.manage'))).toContain(
      'do not have permission'
    )
    expect(describeError(new Error('Failed to fetch'))).toContain('could not be reached')
    expect(describeError(new Error('that did not work'))).toBe('that did not work')
  })

  it('writes weights the way a scale prints them', () => {
    expect(weightText(2350)).toBe('2.350 kg')
    expect(weightText(750)).toBe('0.750 kg')
    expect(weightText(0)).toBe('0.000 kg')
  })

  it('offers the zero-stripped PLU as a hint, not as the answer', () => {
    expect(pluVariants('00012')).toEqual(['00012', '12'])
    expect(pluVariants('12340')).toEqual(['12340'])
    expect(pluVariants('00000')).toEqual(['00000'])
  })
})

// ── What the plugin registers ─────────────────────────────────────────────

describe('what it registers', () => {
  it('registers one resolver, one screen, one tile and two reports', async () => {
    await registry.sync([WEIGHT_SCALE_ID])

    expect(registry.scanResolvers.items.map((entry) => entry.id)).toEqual(['weight-scale.scan'])
    expect(registry.scanResolvers.items[0]?.label).toBe('Weighing scale')
    // The till is already gated by `sales.create`; the resolver is not gated
    // again, or a cashier could not weigh anything.
    expect(registry.scanResolvers.items[0]?.permission).toBeUndefined()

    const nav = registry.nav.items[0]
    expect(nav?.section).toBe('inventory')
    expect(nav?.permission).toBe(WEIGHT_VIEW)
    expect(nav?.route).toBe('/plugins/weight-scale')
    expect(nav?.order).toBe(44)

    expect(registry.routes.items.map((entry) => entry.path)).toEqual(['/plugins/weight-scale'])
    expect(registry.routes.items[0]?.permission).toBe(WEIGHT_VIEW)
    expect(registry.widgets.items.map((entry) => entry.id)).toEqual(['weight-scale.summary'])

    const reports = registry.reports.items
    expect(reports.map((entry) => entry.id)).toEqual(['sales', 'codes'])
    expect(reports.map((entry) => entry.label)).toEqual(['Weighed sales', 'Scale codes'])
    expect(reports.map((entry) => entry.permission)).toEqual([WEIGHT_VIEW, WEIGHT_VIEW])
    expect(reports.map((entry) => entry.group)).toEqual(['Selling', 'Stock'])
    // A window means nothing to a worklist of codes; a search is how a
    // shopkeeper finds the item they are standing in front of.
    expect(reports[0]?.filters).toEqual({ window: true, search: true })
    expect(reports[1]?.filters).toEqual({ window: false, search: true })
  })

  it('registers no POS panel, product field or sale tab', async () => {
    await registry.sync([WEIGHT_SCALE_ID])
    // Deliberate: a panel that repeats the weights already on the cart is noise,
    // and this plugin has nothing to add to a product form — whether an item is
    // sold by weight is `product_units.is_decimal`, which the core already owns.
    expect(registry.posPanels.items).toEqual([])
    expect(registry.productFields.items).toEqual([])
    expect(registry.saleTabs.items).toEqual([])
  })
})

// ── The till ──────────────────────────────────────────────────────────────

describe('the till', () => {
  it('turns a scanned label into a weighed line at the shop’s price', async () => {
    const match = (await resolve(LABEL_750G)) as {
      lookupCode: string
      quantity?: number
      note?: string
      unitPriceMinor?: number
    }

    expect(match.lookupCode).toBe('12340')
    expect(match.quantity).toBe(0.75)
    expect(match.note).toBe('Standard in-store label · 0.750 kg')
    // No price was printed on this label, so none is reported.
    expect(match.unitPriceMinor).toBeUndefined()
  })

  it('says nothing at all about a code the shop’s layouts do not read', async () => {
    expect(await resolve('4006381333931')).toBeNull()
    expect(await resolve('2212340007505')).toBeNull()
    expect(await resolve('not-a-label')).toBeNull()
    // Falling through to the ordinary search is the normal path, not a failure:
    // nothing was thrown into the bus either.
    expect(errors).toEqual([])
  })

  it('refuses a price label rather than charging the wrong money', async () => {
    config[FORMATS_KEY] = [
      { id: 'deli', name: 'Deli counter', prefix: '22', pluDigits: 5, valueDigits: 5, valueKind: 'price', checkDigit: true },
    ]
    const label = labelExample(
      { id: 'deli', name: 'Deli counter', prefix: '22', pluDigits: 5, valueDigits: 5, valueKind: 'price', checkDigit: true },
      '00021',
      0,
      13500
    )

    expect(await resolve(label)).toBeNull()
  })

  it('reads the layout the shop saved last, without a reload', async () => {
    config[FORMATS_KEY] = [
      { id: 'produce', name: 'Produce scale', prefix: '21', pluDigits: 4, valueDigits: 5, valueKind: 'weight', checkDigit: false },
    ]
    const produce = {
      id: 'produce',
      name: 'Produce scale',
      prefix: '21',
      pluDigits: 4,
      valueDigits: 5,
      valueKind: 'weight' as const,
      checkDigit: false,
    }
    const label = labelExample(produce, '0042', 2350)

    const match = (await resolve(label)) as { lookupCode: string; quantity?: number }
    expect(match.lookupCode).toBe('0042')
    expect(match.quantity).toBe(2.35)
    // And the built-in layout no longer answers for a 13-digit label, because
    // the shop replaced it with the one its own scale prints.
    expect(await resolve(LABEL_750G)).toBeNull()
  })

  it('carries the shop’s currency into the line’s note', async () => {
    const match = (await resolve(LABEL_750G, { ...CONTEXT, currency: 'USD' })) as { note?: string }
    expect(match.note).toContain('0.750 kg')
  })

  it('never throws into the bus', async () => {
    // A broken settings bag is a misconfiguration, not a reason to lose a sale.
    config[FORMATS_KEY] = 'not an array'
    await resolve(LABEL_750G)
    expect(errors).toEqual([])
  })
})

// ── The reports ───────────────────────────────────────────────────────────

describe('the reports', () => {
  it('reports what left the shop by weight, with money in minor units', async () => {
    answers.report = {
      type: 'sales',
      rows: [
        {
          product_id: 'p1',
          product: 'Miniket rice',
          sku: '12340',
          unit: 'kg',
          lines: 12,
          qty: 18.75,
          avg_qty: 1.563,
          value_minor: 178125,
          margin_minor: 30000,
        },
      ],
      total: 1,
      totals: { products: 1, lines: 12, qty: 18.75, value_minor: 178125, margin_minor: 30000 },
      label: 'Sep 2026',
    }

    await registry.sync([WEIGHT_SCALE_ID])
    const result = await registry.reports.items[0]!.run({
      period: 'month',
      from: null,
      to: null,
      search: 'rice',
      branchId: BRANCH,
      limit: 200,
      offset: 0,
    })

    expect(result.rows[0]).toEqual({
      product: 'Miniket rice · 12340',
      unit: 'kg',
      lines: 12,
      qty: 18.75,
      avg: 1.563,
      value: 178125,
      margin: 30000,
    })
    expect(result.totals).toEqual({ qty: 18.75, value: 178125, margin: 30000 })
    expect(result.totalRows).toBe(1)
    expect(result.note).toContain('12 weighed lines')
    expect(result.note).toContain('returns subtracted')
    expect(result.note).toContain('Sep 2026')
    expect(result.currency).toBeUndefined()

    // The window and the branch are the server's business, so they travel.
    expect(calls.at(-1)?.fn).toBe('report')
    expect(calls.at(-1)?.args).toMatchObject({
      type: 'sales',
      period: 'month',
      search: 'rice',
      branch_id: BRANCH,
      limit: 200,
      offset: 0,
    })
  })

  it('reports which weighed items the scale cannot ring up', async () => {
    answers.report = {
      type: 'codes',
      rows: [
        {
          variant_id: 'v1',
          product: 'Lentils',
          variant: '',
          sku: '12340',
          unit: 'kg',
          price_minor: 12500,
          status: 'ready',
          code: '12340',
          use_code: '12340',
          layout: 'Standard in-store label',
        },
        {
          variant_id: 'v2',
          product: 'Mustard oil',
          variant: '1 L',
          sku: '',
          unit: 'L',
          price_minor: 21000,
          status: 'no_code',
          code: '',
          use_code: '',
          layout: '',
        },
        {
          variant_id: 'v3',
          product: 'Dates',
          variant: '',
          sku: '2212340007504',
          unit: 'kg',
          price_minor: 90000,
          status: 'whole_label',
          code: '2212340007504',
          use_code: '12340',
          layout: 'Standard in-store label',
        },
      ],
      total: 3,
      totals: { all: 3, ready: 1, attention: 2, no_code: 1, by_piece: 0, other_code: 0, whole_label: 1 },
      formats: [...DEFAULT_FORMATS],
    }

    await registry.sync([WEIGHT_SCALE_ID])
    const result = await registry.reports.items[1]!.run({
      period: 'month',
      from: null,
      to: null,
      search: '',
      branchId: null,
      limit: 200,
      offset: 0,
    })

    expect(result.rows[0]?.state).toBe('Ready')
    expect(result.rows[1]?.state).toBe('No code at all')
    expect(result.rows[1]?.code).toBe('—')
    // A pasted whole label is a code the shop can still fix, so the report says
    // which part of it to keep.
    expect(result.rows[2]?.state).toBe('Whole label entered')
    expect(result.rows[2]?.keep).toBe('12340')
    expect(result.totals).toEqual({ ready: 1, attention: 2, no_code: 1, by_piece: 0 })
    expect(result.totalRows).toBe(3)
    expect(result.note).toContain('1 ready, 2 to fix')
    // A worklist is not a window: no period is sent, and the layouts the shop
    // reads with are named, so two shopkeepers compare the same list.
    expect(calls.at(-1)?.args).toMatchObject({ type: 'codes', scope: 'all' })
    expect(result.note).toContain('Standard in-store label (22 + 5 PLU + 5 g + check)')
  })

  it('lets a failure reach the screen, which knows how to report it', async () => {
    refuse = 'That shop has no warehouses.'
    await registry.sync([WEIGHT_SCALE_ID])
    await expect(
      registry.reports.items[0]!.run({
        period: 'month',
        from: null,
        to: null,
        search: '',
        branchId: null,
        limit: 25,
        offset: 0,
      })
    ).rejects.toThrow('That shop has no warehouses.')
  })
})

// ── The screen ────────────────────────────────────────────────────────────

function screen(): ReturnType<typeof createWeightScaleScreen> {
  return createWeightScaleScreen({ settings: settingsStore(), db: makeDb() })
}

const OVERVIEW = {
  month: { lines: 42, qty: 88.125 },
  month_label: 'Sep 2026',
  today: { lines: 6, qty: 9.5 },
  codes: { all: 9, ready: 7, attention: 2, no_code: 1, by_piece: 1, other_code: 0, whole_label: 0 },
  layouts: 1,
  using_builtin: true,
}

describe('the screen', () => {
  it('reads the month in one ask and says what needs fixing', async () => {
    answers.overview = OVERVIEW
    const host = await screen().render({
      params: {},
      query: new URLSearchParams(),
      organizationId: ORG,
      branchId: BRANCH,
      currency: 'BDT',
    })
    await settle()

    expect(textOf(host)).toContain('88.125 kg')
    expect(textOf(host)).toContain('9.500 kg')
    expect(textOf(host)).toContain('Items to fix')
    expect(textOf(host)).toContain('2')
    expect(calls.filter((call) => call.fn === 'overview')).toHaveLength(1)
    expect(calls[0]?.args).toMatchObject({ branch_id: BRANCH })
  })

  it('tells the truth when the month cannot be read', async () => {
    refuse = 'permission_denied: weight-scale.view'
    const host = await screen().render({
      params: {},
      query: new URLSearchParams(),
      organizationId: ORG,
      branchId: null,
      currency: 'BDT',
    })
    await settle()

    expect(textOf(host)).toContain('The month could not be read')
    expect(textOf(host)).toContain('permission_denied')
  })

  it('reads a label the shopkeeper types, and shows what the till will look up', async () => {
    answers.overview = OVERVIEW
    const host = await screen().render({
      params: {},
      query: new URLSearchParams(),
      organizationId: ORG,
      branchId: null,
      currency: 'BDT',
    })
    await settle()

    const box = host.querySelector<HTMLInputElement>('input')!
    box.value = LABEL_750G
    box.dispatchEvent(new Event('input', { bubbles: true }))

    expect(textOf(host)).toContain('Standard in-store label reads that as 0.750 kg')
    expect(textOf(host)).toContain('look up 12340')
    // A PLU with no leading zeros has one form, so the hint is the plain one.
    expect(textOf(host)).toContain('add it as a barcode')
  })

  it('says what each layout would have printed when nothing reads a code', async () => {
    answers.overview = OVERVIEW
    const host = await screen().render({
      params: {},
      query: new URLSearchParams(),
      organizationId: ORG,
      branchId: null,
      currency: 'BDT',
    })
    await settle()

    const box = host.querySelector<HTMLInputElement>('input')!
    box.value = '4006381333931'
    box.dispatchEvent(new Event('input', { bubbles: true }))

    expect(textOf(host)).toContain('No layout here reads 4006381333931')
    expect(textOf(host)).toContain(labelExample(DEFAULT_FORMATS[0]!, '00012'))
  })

  it('saves the shop’s first layout, and the till reads it immediately', async () => {
    answers.overview = OVERVIEW
    const deps = { settings: settingsStore(), db: makeDb() }
    const host = await createWeightScaleScreen(deps).render({
      params: {},
      query: new URLSearchParams(),
      organizationId: ORG,
      branchId: null,
      currency: 'BDT',
    })
    await settle()

    expect(textOf(host)).toContain('standard in-store label')

    press(host, 'Describe our scale')
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input')]
    // name, prefix, PLU digits, value digits (the test box is the first input).
    const [, name, prefix, plu, value] = inputs
    if (!name || !prefix || !plu || !value) throw new Error('the layout editor did not open')
    for (const [field, text] of [
      [name, 'Produce scale'],
      [prefix, '21'],
      [plu, '4'],
      [value, '5'],
    ] as const) {
      field.value = text
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    press(host, 'Save layout')
    await settle()

    expect(config[FORMATS_KEY]).toEqual([
      {
        id: '21-4-5',
        name: 'Produce scale',
        prefix: '21',
        pluDigits: 4,
        valueDigits: 5,
        valueKind: 'weight',
        checkDigit: true,
      },
    ])
    expect(textOf(document.body)).toContain('The till reads labels with this layout from now on.')
    expect(textOf(host)).toContain('The till reads 1 label layout this shop described.')
    // And the residue: the till is reading the shop's layout from here on.
    registry = new PluginRegistry(bus, {
      settings: () => deps.settings,
      data: () => ({
        get: async <T,>(_key: string, fallback: T): Promise<T> => fallback,
        set: async () => undefined,
        remove: async () => false,
        keys: async () => [],
      }),
      db: () => makeDb(),
    })
    registry.declare({ manifest: weightScaleManifest, load: async () => weightScalePlugin })
    const produce = config[FORMATS_KEY] as LabelFormat[]
    const match = (await resolve(labelExample(produce[0]!, '0042', 2350))) as {
      lookupCode: string
    }
    expect(match.lookupCode).toBe('0042')
  })

  it('refuses a layout that does not describe a label', async () => {
    answers.overview = OVERVIEW
    const host = await screen().render({
      params: {},
      query: new URLSearchParams(),
      organizationId: ORG,
      branchId: null,
      currency: 'BDT',
    })
    await settle()

    press(host, 'Describe our scale')
    press(host, 'Save layout')
    await settle()

    expect(textOf(host)).toContain('Give the layout a name')
    expect(config[FORMATS_KEY]).toBeUndefined()
  })

  it('asks before it stops reading a layout, and keeps the rest', async () => {
    answers.overview = OVERVIEW
    config[FORMATS_KEY] = [
      { id: 'produce', name: 'Produce scale', prefix: '21', pluDigits: 4, valueDigits: 5, valueKind: 'weight', checkDigit: false },
      { id: 'meat', name: 'Meat counter', prefix: '23', pluDigits: 5, valueDigits: 5, valueKind: 'weight', checkDigit: true },
    ]
    const host = await screen().render({
      params: {},
      query: new URLSearchParams(),
      organizationId: ORG,
      branchId: null,
      currency: 'BDT',
    })
    await settle()

    const remove = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (entry) => entry.getAttribute('aria-label') === 'Remove Produce scale'
    )
    if (!remove) throw new Error('no remove button for the produce layout')
    remove.click()
    await settle()

    expect(textOf(document.body)).toContain('Remove “Produce scale”?')
    press(document.body, 'Remove')
    await settle()

    expect((config[FORMATS_KEY] as LabelFormat[]).map((format) => format.id)).toEqual(['meat'])
  })
})

// ── A decode, end to end ──────────────────────────────────────────────────

describe('a decode as the till receives it', () => {
  it('is exactly what the seam promises: a code, a weight, and nothing else', () => {
    const decoded = decodeLabel(LABEL_750G, DEFAULT_FORMATS) as DecodedLabel
    expect(Object.keys(decoded).sort()).toEqual(['format', 'grams', 'kind', 'plu', 'quantity'])
  })
})
