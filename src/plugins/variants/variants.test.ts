/**
 * Variants — the builder and the options screen, tested through the plugin API.
 *
 * What matters here is not that a screen renders but that it asks the server
 * for the right things and writes nothing until the shopkeeper says so. The
 * server functions themselves are exercised against a real Postgres by
 * `npm run validate:migrations`; these tests are about the half that runs in
 * the browser: the wire shapes, the money conversion, and the refusal path.
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
} from '../../shared/registry/plugin-types'
import variantsPlugin, { VARIANTS_MANAGE, VARIANTS_VIEW } from './index'
import {
  DEFAULT_MAX_VARIANTS,
  MAX_VARIANTS_KEY,
  variantsManifest,
} from './manifest'
import { create as createBuilder } from './builder'
import { create as createOptionsScreen } from './options-screen'
import {
  combinationsOf,
  costToInput,
  filledAxes,
  inputToCost,
  inputToPrice,
  messageOf,
  priceToInput,
  type Catalog,
  type ProductState,
} from './helpers'

const ORG = '11111111-1111-1111-1111-111111111111'
const PRODUCT = '22222222-2222-2222-2222-222222222222'

// ── Fixtures ──────────────────────────────────────────────────────────────

const catalog: Catalog = {
  types: [
    {
      id: 'size',
      name: 'Size',
      sort_order: 1,
      products: 2,
      values: [
        { id: 's', value: 'S', sort_order: 1 },
        { id: 'm', value: 'M', sort_order: 2 },
      ],
    },
    {
      id: 'colour',
      name: 'Colour',
      sort_order: 2,
      products: 1,
      values: [
        { id: 'red', value: 'Red', sort_order: 1 },
        { id: 'blue', value: 'Blue', sort_order: 2 },
      ],
    },
  ],
  totals: { types: 2, values: 4, products: 2, variants: 4 },
  config: { max_variants: DEFAULT_MAX_VARIANTS },
}

const emptyState: ProductState = {
  product: { id: PRODUCT, name: 'T-Shirt', sku: 'TS-1', price: 25000, cost: 1500000 },
  axes: [],
  variants: [
    {
      variant_id: 'v-default',
      name_suffix: null,
      sku: null,
      option_values: {},
      price_override: null,
      cost_override: null,
      image_url: null,
      is_active: true,
      is_default: true,
      price: 25000,
      cost: 1500000,
    },
  ],
}

function builtState(): ProductState {
  const rows = [
    { suffix: 'S / Red', ids: ['s', 'red'] },
    { suffix: 'S / Blue', ids: ['s', 'blue'] },
    { suffix: 'M / Red', ids: ['m', 'red'] },
    { suffix: 'M / Blue', ids: ['m', 'blue'] },
  ]
  return {
    ...emptyState,
    axes: [
      { option_type_id: 'size', name: 'Size', sort_order: 0, value_ids: ['s', 'm'], values: [{ id: 's', value: 'S' }, { id: 'm', value: 'M' }] },
      { option_type_id: 'colour', name: 'Colour', sort_order: 1, value_ids: ['red', 'blue'], values: [{ id: 'red', value: 'Red' }, { id: 'blue', value: 'Blue' }] },
    ],
    variants: [
      ...emptyState.variants,
      ...rows.map((row, index) => ({
        variant_id: `v-${index + 1}`,
        name_suffix: row.suffix,
        sku: `TS-${index + 1}`,
        option_values: { Size: row.suffix.split(' / ')[0] ?? '', Colour: row.suffix.split(' / ')[1] ?? '' },
        price_override: null,
        cost_override: null,
        image_url: null,
        is_active: true,
        is_default: index === 0,
        price: 25000,
        cost: 1500000,
      })),
    ],
  }
}

// ── A fake server ─────────────────────────────────────────────────────────

interface Call {
  fn: string
  args: Record<string, unknown>
}

let calls: Call[]
let state: ProductState
let refuse: { fn: string; message: string } | null
let bus: EventBus
let registry: PluginRegistry
let rpc: PluginDb['rpc']

function makeDb(): PluginDb {
  return {
    products: async () => [],
    rpc: async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
      calls.push({ fn, args })
      if (refuse && refuse.fn === fn) throw new Error(refuse.message)
      if (fn === 'catalog') return catalog as T
      if (fn === 'axes') return state as T
      if (fn === 'preview') {
        const axes = args.axes as Array<{ option_type_id: string; value_ids: string[] }>
        const total = combinationsOf(axes)
        return {
          rows: [],
          total,
          new: total,
          limit: catalog.config.max_variants,
        } as T
      }
      if (fn === 'generate') {
        state = builtState()
        return { ...state, created: 4, skipped: 0 } as T
      }
      if (fn === 'overview') {
        return {
          products: [{ product_id: PRODUCT, name: 'T-Shirt', sku: 'TS-1', axes: 2, variants: 4 }],
          limit: 50,
        } as T
      }
      return { ok: true } as T
    },
  }
}

beforeEach(() => {
  calls = []
  state = emptyState
  refuse = null
  bus = new EventBus()
  bus.onError = () => undefined
  rpc = makeDb().rpc

  const settingsStore: PluginSettings = {
    get: <T,>(_key: string, fallback: T): T => fallback,
    all: () => ({}),
    set: async () => undefined,
  }
  const dataStore: PluginDataStore = {
    get: async <T,>(_key: string, fallback: T): Promise<T> => fallback,
    set: async () => undefined,
    remove: async () => false,
    keys: async () => [],
  }
  registry = new PluginRegistry(bus, {
    settings: () => settingsStore,
    data: () => dataStore,
    db: () => ({ products: async () => [], rpc }),
  })
  registry.declare({ manifest: variantsManifest, load: async () => variantsPlugin })
})

/**
 * Wait for the promises a render kicks off.
 *
 * A timer tick, repeated: every pending microtask (the `Promise.all` over two
 * RPCs, the re-draw that follows it) has run by the time a macrotask is
 * reached, which is not true of counting microtasks by hand.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function textOf(node: Element): string {
  return node.textContent ?? ''
}

/** The page module's `render` is allowed to be async; ours is not, but types
 *  do not know that, so every test awaits it. */
async function openOptionsScreen(): Promise<HTMLElement> {
  const page = createOptionsScreen({ db: { products: async () => [], rpc } })
  return await page.render({
    params: {},
    query: new URLSearchParams(),
    organizationId: ORG,
    branchId: null,
    currency: 'BDT',
  })
}

function checkboxes(el: Element): HTMLInputElement[] {
  return [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
}

function buttonsNamed(root: Element, label: string): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')].filter((button) =>
    (button.textContent ?? '').includes(label)
  )
}

// ── Manifest ──────────────────────────────────────────────────────────────

describe('manifest', () => {
  it('is valid, and would be refused if it minted a core permission', () => {
    expect(() => validateManifest(variantsManifest)).not.toThrow()
    expect(() =>
      validateManifest({
        ...variantsManifest,
        permissions: [{ key: 'products.create', label: 'x', group: 'products' }],
      })
    ).toThrow()
  })

  it('namespaces every permission to the plugin', () => {
    for (const permission of variantsManifest.permissions ?? []) {
      expect(permission.key.startsWith('variants.')).toBe(true)
    }
  })

  it('declares the settings key the server actually reads', () => {
    // `app.variants_config` reads `config -> 'max_variants'`; a manifest that
    // declared anything else would show a shop a number nothing obeys.
    expect(MAX_VARIANTS_KEY).toBe('max_variants')
    expect(variantsManifest.settingsSchema?.map((field) => field.key)).toEqual([MAX_VARIANTS_KEY])
    expect(variantsManifest.version).toBe('1.0.0')
  })
})

// ── Registration ──────────────────────────────────────────────────────────

describe('registration', () => {
  it('appears where a shopkeeper would look for it', async () => {
    await registry.sync(['variants'])

    expect(registry.nav.items.map((item) => item.id)).toEqual(['variants'])
    expect(registry.nav.items[0]?.section).toBe('inventory')
    expect(registry.routes.items.map((route) => route.path)).toEqual(['/plugins/variants'])
    expect(registry.formSections.items.map((section) => section.id)).toEqual(['variants.builder'])
    expect(registry.formSections.items[0]?.section).toBe('advanced')
    expect(registry.widgets.items.map((widget) => widget.id)).toEqual(['variants.summary'])

    const keys = registry.permissions.items.map((permission) => permission.key).sort()
    expect(keys).toEqual([VARIANTS_MANAGE, VARIANTS_VIEW])
  })

  it('asks for no dependency, so it can be switched on alone', () => {
    expect(variantsManifest.dependencies ?? []).toEqual([])
  })
})

// ── The arithmetic ────────────────────────────────────────────────────────

describe('combinations', () => {
  it('multiplies the values of every axis', () => {
    expect(
      combinationsOf([
        { option_type_id: 'size', value_ids: ['s', 'm', 'l'] },
        { option_type_id: 'colour', value_ids: ['red', 'blue'] },
      ])
    ).toBe(6)
  })

  it('is zero when nothing is chosen, or when an axis has no values', () => {
    expect(combinationsOf([])).toBe(0)
    expect(
      combinationsOf([{ option_type_id: 'size', value_ids: [] }])
    ).toBe(0)
  })

  it('drops options with nothing ticked from what is sent to the server', () => {
    const draft = new Map<string, Set<string>>([
      ['size', new Set(['s', 'm'])],
      ['colour', new Set()],
    ])
    expect(filledAxes(draft)).toEqual([{ option_type_id: 'size', value_ids: ['s', 'm'] }])
  })
})

describe('money', () => {
  it('shows an empty box for a variant that inherits the product price', () => {
    expect(priceToInput(null)).toBe('')
    expect(priceToInput(27500)).toBe('275.00')
  })

  it('separates “clear the override” from “that is not a number”', () => {
    expect(inputToPrice('')).toBeNull()
    expect(inputToPrice('250')).toBe(25000)
    expect(inputToPrice(' 1,250.50 ')).toBe(125050)
    expect(inputToPrice('abc')).toBeUndefined()
  })

  it('keeps costs in the 1/10000ths the core stores', () => {
    expect(costToInput(1500000)).toBe('150.00')
    expect(inputToCost('150')).toBe(1500000)
    expect(inputToCost('')).toBeNull()
    expect(inputToCost('nope')).toBeUndefined()
  })
})

describe('refusals read like sentences', () => {
  it('drops the server’s error code and keeps the explanation', () => {
    expect(
      messageOf(
        new Error(
          'variants_partial_combination: 2 of 4 combinations already exist. Include every value, or remove the ones that already have variants.'
        )
      )
    ).toBe(
      '2 of 4 combinations already exist. Include every value, or remove the ones that already have variants.'
    )
  })

  it('turns a missing permission into something a shopkeeper can act on', () => {
    expect(messageOf(new Error('permission_denied: variants.manage'))).toMatch(
      /do not have permission/i
    )
  })
})

// ── The builder in the product form ───────────────────────────────────────

describe('the builder', () => {
  it('asks the shop to save the product first when there is nothing to build on', () => {
    const el = createBuilder({
      db: { products: async () => [], rpc },
      productId: null,
      currency: 'BDT',
      maxVariants: DEFAULT_MAX_VARIANTS,
    })
    expect(textOf(el)).toMatch(/save this product first/i)
    expect(calls).toEqual([])
  })

  it('shows the shop’s options with nothing ticked on a product that has none', async () => {
    const el = createBuilder({
      db: { products: async () => [], rpc },
      productId: PRODUCT,
      currency: 'BDT',
      maxVariants: DEFAULT_MAX_VARIANTS,
    })
    await settle()

    expect(calls.map((call) => call.fn).sort()).toEqual(['axes', 'catalog'])
    expect(textOf(el)).toMatch(/No options chosen yet/)
    // Unticking everything means no axes at all.
    expect(textOf(el)).toMatch(/Size/)
    expect(buttonsNamed(el, 'Build variants')[0]?.disabled).toBe(true)
    expect(buttonsNamed(el, 'Preview')[0]?.disabled).toBe(true)
  })

  it('previews without writing: the only call is the preview itself', async () => {
    const el = createBuilder({
      db: { products: async () => [], rpc },
      productId: PRODUCT,
      currency: 'BDT',
      maxVariants: DEFAULT_MAX_VARIANTS,
    })
    await settle()
    calls.length = 0

    // Tick Size (which selects all its values) and Colour.
    for (const box of checkboxes(el)) {
      box.checked = true
      box.dispatchEvent(new Event('change'))
    }
    await settle()

    const preview = buttonsNamed(el, 'Preview')[0]
    expect(preview?.disabled).toBe(false)
    preview?.click()
    await settle()

    expect(calls.map((call) => call.fn)).toEqual(['preview'])
    expect(calls[0]?.args.axes).toEqual([
      { option_type_id: 'size', value_ids: ['s', 'm'] },
      { option_type_id: 'colour', value_ids: ['red', 'blue'] },
    ])
    expect(textOf(el)).toMatch(/4 combinations/)
  })

  it('builds in one call, and the new variants appear with their prices', async () => {
    const el = createBuilder({
      db: { products: async () => [], rpc },
      productId: PRODUCT,
      currency: 'BDT',
      maxVariants: DEFAULT_MAX_VARIANTS,
    })
    await settle()
    calls.length = 0

    for (const box of checkboxes(el)) {
      box.checked = true
      box.dispatchEvent(new Event('change'))
    }
    await settle()
    buttonsNamed(el, 'Build variants')[0]?.click()
    await settle()

    expect(calls.map((call) => call.fn)).toEqual(['generate'])
    expect(textOf(el)).toMatch(/4 variant\(s\)/)
    // Each variant row shows the price it would charge, inherited or not.
    expect(textOf(el)).toMatch(/inherits/)
    expect(textOf(el)).toMatch(/S \/ Red/)
  })

  it('a refusal from the server is shown, and nothing is retried behind it', async () => {
    const el = createBuilder({
      db: { products: async () => [], rpc },
      productId: PRODUCT,
      currency: 'BDT',
      maxVariants: DEFAULT_MAX_VARIANTS,
    })
    await settle()
    calls.length = 0
    refuse = {
      fn: 'preview',
      message: 'variants_limit_exceeded: 6 combinations is more than this shop allows (3)',
    }

    for (const box of checkboxes(el)) {
      box.checked = true
      box.dispatchEvent(new Event('change'))
    }
    await settle()
    buttonsNamed(el, 'Preview')[0]?.click()
    await settle()

    expect(calls.map((call) => call.fn)).toEqual(['preview'])
    // The section still works: no plan is claimed, and the buttons stay usable.
    expect(textOf(el)).not.toMatch(/combination\(s\) · /)
    expect(buttonsNamed(el, 'Preview')[0]?.disabled).toBe(false)
  })

  it('saves a single variant with the override in minor units', async () => {
    state = builtState()
    const el = createBuilder({
      db: { products: async () => [], rpc },
      productId: PRODUCT,
      currency: 'BDT',
      maxVariants: DEFAULT_MAX_VARIANTS,
    })
    await settle()
    calls.length = 0

    const priceBox = el.querySelector<HTMLInputElement>('input[inputmode="decimal"]')
    if (priceBox) priceBox.value = '199.50'
    buttonsNamed(el, 'Save')[0]?.click()
    await settle()

    expect(calls.map((call) => call.fn)).toEqual(['update', 'axes'])
    expect(calls[0]?.args).toMatchObject({
      variant_id: 'v-1',
      price_override: 19950,
    })
  })
})

// ── The options screen ────────────────────────────────────────────────────

describe('the options screen', () => {
  it('lists the shop’s options with their values and what uses them', async () => {
    const el = await openOptionsScreen()
    await settle()

    expect(calls.map((call) => call.fn).sort()).toEqual(['catalog', 'overview'])
    expect(textOf(el)).toMatch(/Size/)
    expect(textOf(el)).toMatch(/Colour/)
    expect(textOf(el)).toMatch(/on 2 products/)
    expect(textOf(el)).toMatch(/T-Shirt/)
  })

  it('offers to delete an option only when nothing uses it', async () => {
    const el = await openOptionsScreen()
    await settle()

    const deletes = [...el.querySelectorAll('button')].filter((button) =>
      (button.getAttribute('aria-label') ?? '').startsWith('Delete the option')
    )
    // Both fixture options are in use by products, so neither can be deleted.
    expect(deletes).toEqual([])
  })

  it('adds an option through the server, then re-reads', async () => {
    const el = await openOptionsScreen()
    await settle()
    calls.length = 0

    const nameBox = el.querySelector<HTMLInputElement>('input[placeholder="Size, Colour, Capacity…"]')
    if (nameBox) nameBox.value = 'Capacity'
    buttonsNamed(el, 'Add option')[0]?.click()
    await settle()

    expect(calls[0]).toMatchObject({ fn: 'save_type', args: { name: 'Capacity' } })
    expect(calls.map((call) => call.fn)).toContain('catalog')
  })

  it('shows the server’s reason when a delete is refused', async () => {
    const el = await openOptionsScreen()
    await settle()
    calls.length = 0
    refuse = {
      fn: 'delete_value',
      message: 'variants_option_value_in_use: 3 variant(s) still carry "Red".',
    }

    const chips = [...el.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove"]')]
    chips[0]?.click()
    await settle()

    expect(calls.map((call) => call.fn)).toEqual(['delete_value'])
    expect(textOf(el)).toMatch(/Size/) // the screen is intact
  })
})
