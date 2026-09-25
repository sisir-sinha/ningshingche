/**
 * Variants — the builder that lives in the product form.
 *
 * This is the plugin's whole reason to exist: a shopkeeper who sells a t-shirt
 * in three sizes and four colours should tick boxes and be done, not type
 * twelve rows. Nothing here invents product data — every row it writes is a row
 * in the core `product_variants` table, and the till, the stock ledger and the
 * sales report pick it up because they were always reading that table.
 *
 * Two rules shape the flow:
 *
 *  1. **Nothing is written until the shopkeeper says so.** Ticking values is
 *     local; the preview is a plan the server computes without writing; the
 *     build is one call that saves the axes and creates the combinations inside
 *     a single transaction. A half-built matrix cannot exist, so a shop never
 *     has to work out which of eighteen variants it already made.
 *  2. **The server owns the rules.** Whether a combination exists, how many
 *     combinations a shop may have, who may change them — all decided in
 *     Postgres, and this screen only reports what it is told.
 */

import { badge, emptyState } from '../../components/ui/card'
import { button, spinner } from '../../components/ui/button'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { field, input } from '../../components/ui/input'
import { h, mount } from '../../components/ui/h'
import type { PluginDb, Logger } from '../../shared/registry/plugin-types'
import {
  combinationsOf,
  filledAxes,
  inputToCost,
  inputToPrice,
  messageOf,
  priceLabel,
  priceToInput,
  type Catalog,
  type OptionType,
  type Plan,
  type ProductState,
  type VariantRow,
} from './helpers'

export interface BuilderDeps {
  db: PluginDb
  /** Null while the product has never been saved; the axes need a product row. */
  productId: string | null
  currency: string
  maxVariants: number
  log?: Logger
}

export function create(deps: BuilderDeps): HTMLElement {
  if (!deps.productId) {
    return emptyState('Save this product first', {
      iconName: 'grid_view',
      description:
        'Options like Size or Colour are built into combinations on a saved product. Save it, reopen it, and the builder appears here.',
    })
  }

  const productId = deps.productId

  /** Option type → the values ticked for this product. Local until built. */
  const draft = new Map<string, Set<string>>()
  let catalog: Catalog | null = null
  let state: ProductState | null = null
  let plan: Plan | null = null
  let busy = false

  const root = h('div', { class: 'space-y-4' })
  const statusLine = h('p', { class: 'text-xs text-content-muted' })
  const axesHost = h('div', { class: 'space-y-3' })
  const planHost = h('div', {})
  const variantsHost = h('div', { class: 'space-y-2' })

  mount(root, statusLine, axesHost, planHost, variantsHost)

  // ── Reading the server ──────────────────────────────────────────────────

  async function refreshAxes(): Promise<void> {
    const [nextState, nextCatalog] = await Promise.all([
      deps.db.rpc<ProductState>('axes', { product_id: productId }),
      deps.db.rpc<Catalog>('catalog'),
    ])
    state = nextState
    catalog = nextCatalog

    draft.clear()
    for (const axis of nextState.axes) {
      draft.set(axis.option_type_id, new Set(axis.value_ids))
    }
    drawAll()
  }

  function drawAll(): void {
    drawStatus()
    drawAxes()
    drawPlan()
    drawVariants()
  }

  /**
   * The first paint. It fills the same hosts the draws do — mounting a
   * "loading" block *over* them would leave the builder writing into detached
   * nodes, which is a bug that looks exactly like a slow server.
   */
  function showLoading(): void {
    mount(
      statusLine,
      h(
        'span',
        { class: 'flex items-center gap-2 text-content-muted' },
        spinner('h-4 w-4'),
        h('span', { text: 'Loading this product’s options…' })
      )
    )
    mount(axesHost, null)
    mount(planHost, null)
    mount(variantsHost, null)
  }

  // ── The line above the builder ──────────────────────────────────────────

  function drawStatus(): void {
    if (!catalog || !state) return

    const selected = filledAxes(draft)
    const counted = combinationsOf(selected)
    const built = matrixVariants().length
    const limit = catalog.config.max_variants

    const parts = [
      counted === 0
        ? 'No options chosen yet'
        : `${counted} combination${counted === 1 ? '' : 's'}`,
      `${built} built`,
      `shop limit ${limit}`,
    ]

    mount(
      statusLine,
      h('span', { class: 'text-content-muted' }, parts.join(' · ')),
      selected.length > 0 && counted > limit
        ? h(
            'span',
            { class: 'ml-2 font-medium text-danger' },
            `over the limit — remove a value or raise it in the plugin’s settings`
          )
        : null
    )
  }

  // ── Card 1: which options this product uses ─────────────────────────────

  function drawAxes(): void {
    if (!catalog || !state) return

    if (catalog.types.length === 0) {
      mount(
        axesHost,
        emptyState('No options exist yet', {
          iconName: 'add_circle',
          description:
            'Add options like Size or Colour under Inventory → Variants, then come back: they can be used on any product.',
        })
      )
      return
    }

    mount(
      axesHost,
      ...catalog.types.map((type) => axisRow(type)),
      actionRow()
    )
  }

  function axisRow(type: OptionType): HTMLElement {
    const ticked = draft.get(type.id) ?? new Set<string>()
    const on = ticked.size > 0

    const toggle = h('input', {
      type: 'checkbox',
      id: `variants-axis-${type.id}`,
      class: 'h-5 w-5 shrink-0 rounded border-input text-primary focus:ring-2 focus:ring-ring',
      checked: on,
      onChange: () => {
        if (toggle.checked) {
          if (ticked.size === 0) {
            // A shopkeeper who ticks an option means the *product's* values, so
            // start from all of them rather than an empty axis that reads as a
            // mistake.
            for (const value of type.values) ticked.add(value.id)
          }
          draft.set(type.id, ticked)
        } else {
          draft.delete(type.id)
        }
        plan = null
        drawAll()
      },
    })

    const valueChips = type.values.map((value) => {
      const pressed = ticked.has(value.id)
      return h(
        'button',
        {
          type: 'button',
          'aria-pressed': pressed ? 'true' : 'false',
          class:
            'inline-flex h-10 items-center rounded-md border px-3 text-sm font-medium ' +
            (pressed
              ? 'border-primary bg-primary/5 text-content'
              : 'border-border bg-surface text-content-muted hover:bg-surface-muted'),
          onClick: () => {
            if (ticked.has(value.id)) ticked.delete(value.id)
            else ticked.add(value.id)
            if (ticked.size > 0) draft.set(type.id, ticked)
            else draft.delete(type.id)
            plan = null
            drawAll()
          },
        },
        value.value
      )
    })

    return h(
      'div',
      { class: 'rounded-lg border border-border bg-surface p-3' },
      h(
        'div',
        { class: 'flex flex-wrap items-center gap-2' },
        h(
          'label',
          {
            class: 'flex min-w-40 flex-1 items-center gap-2 text-sm font-medium text-content',
            for: toggle.id,
          },
          toggle,
          h('span', { text: type.name }),
          h(
            'span',
            { class: 'text-xs font-normal text-content-subtle' },
            type.products > 0 ? `on ${type.products} product(s)` : 'unused so far'
          )
        ),
        type.values.length === 0
          ? h('span', { class: 'text-xs text-warning' }, 'No values yet')
          : null
      ),
      type.values.length === 0
        ? h(
            'p',
            { class: 'mt-2 text-xs text-content-muted' },
            `Add values to “${type.name}” under Inventory → Variants to use it here.`
          )
        : h('div', { class: 'mt-2 flex flex-wrap gap-1.5' }, ...valueChips)
    )
  }

  function actionRow(): HTMLElement {
    const selected = filledAxes(draft)
    const counted = combinationsOf(selected)
    const overLimit = catalog !== null && counted > catalog.config.max_variants

    const previewButton = button('Preview', {
      variant: 'outline',
      icon: 'visibility',
      size: 'sm',
      disabled: busy || counted === 0,
      onClick: () => void runPreview(),
    })

    const fresh = plan?.new ?? null
    const buildButton = button(
      fresh !== null && fresh === 0 ? 'All combinations exist' : 'Build variants',
      {
        variant: 'primary',
        icon: 'auto_awesome',
        size: 'sm',
        disabled: busy || counted === 0 || overLimit || fresh === 0,
        ...(fresh === 0
          ? { title: 'Every combination of these values already exists on this product.' }
          : {}),
        onClick: () => void runBuild(),
      }
    )

    return h(
      'div',
      { class: 'flex flex-wrap items-center gap-2' },
      previewButton,
      buildButton,
      plan === null && counted > 0
        ? h(
            'span',
            { class: 'text-xs text-content-subtle' },
            'Preview first if you want to see what would be created.'
          )
        : null
    )
  }

  // ── Card 2: the plan, before anything is written ────────────────────────

  async function runPreview(): Promise<void> {
    if (busy) return
    busy = true
    drawAxes()
    try {
      plan = await deps.db.rpc<Plan>('preview', {
        product_id: productId,
        axes: filledAxes(draft),
      })
    } catch (error) {
      plan = null
      toastError(messageOf(error))
      deps.log?.warn('preview refused', error)
    } finally {
      busy = false
      drawAll()
    }
  }

  function drawPlan(): void {
    if (!plan) {
      mount(planHost, null)
      return
    }

    const rows = plan.rows.map((row) =>
      h(
        'div',
        {
          class:
            'flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2',
        },
        h('p', { class: 'min-w-0 truncate text-sm text-content' }, row.suffix || 'No options'),
        h(
          'span',
          { class: 'shrink-0 text-xs text-content-muted' },
          Object.entries(row.option_values)
            .map(([name, value]) => `${name}: ${value}`)
            .join(' · ')
        ),
        row.exists
          ? badge('exists', { tone: 'neutral', iconName: 'check' })
          : badge('new', { tone: 'primary', iconName: 'add' })
      )
    )

    mount(
      planHost,
      h(
        'div',
        { class: 'rounded-lg border border-border bg-surface-muted/40 p-3' },
        h(
          'div',
          { class: 'mb-2 flex flex-wrap items-center justify-between gap-2' },
          h(
            'p',
            { class: 'text-sm font-medium text-content' },
            `${plan.total} combination${plan.total === 1 ? '' : 's'} · ${plan.new} to create`
          ),
          plan.new === 0
            ? h(
                'p',
                { class: 'text-xs text-content-muted' },
                'This product already has every one of them.'
              )
            : h(
                'p',
                { class: 'text-xs text-content-muted' },
                'Nothing is written until you build.'
              )
        ),
        h('div', { class: 'space-y-1.5' }, ...rows)
      )
    )
  }

  // ── Taking the action ───────────────────────────────────────────────────

  async function runBuild(): Promise<void> {
    if (busy) return
    busy = true
    drawAxes()
    try {
      const built = await deps.db.rpc<ProductState & { created: number; skipped: number }>(
        'generate',
        { product_id: productId, axes: filledAxes(draft) }
      )
      state = built
      plan = null
      toastSuccess(
        built.created === 0
          ? 'Nothing to build — every combination already exists'
          : `${built.created} variant${built.created === 1 ? '' : 's'} created`
      )
      drawAll()
    } catch (error) {
      toastError(messageOf(error))
      deps.log?.warn('build refused', error)
    } finally {
      busy = false
      drawAxes()
    }
  }

  // ── Card 3: the variants themselves ─────────────────────────────────────

  /** The built combinations — not the variant that carries the product itself. */
  function matrixVariants(): VariantRow[] {
    return (state?.variants ?? []).filter((variant) => variant.name_suffix !== null)
  }

  function drawVariants(): void {
    const variants = matrixVariants()

    if (variants.length === 0) {
      mount(
        variantsHost,
        h(
          'p',
          { class: 'text-xs text-content-muted' },
          'No variants built yet. Tick the values this product comes in and build them.'
        )
      )
      return
    }

    mount(
      variantsHost,
      h(
        'div',
        { class: 'flex items-center justify-between gap-2' },
        h('p', { class: 'text-sm font-medium text-content' }, `${variants.length} variant(s)`),
        state !== null && state.variants.some((variant) => variant.is_default)
          ? h('p', { class: 'text-xs text-content-subtle' }, 'the till defaults to the first one')
          : null
      ),
      ...variants.map((variant) => variantRow(variant)),
      bulkEditor()
    )
  }

  function variantRow(variant: VariantRow): HTMLElement {
    const sku = input({
      value: variant.sku ?? '',
      placeholder: 'SKU',
      class: 'h-10',
    })
    const price = input({
      value: priceToInput(variant.price_override),
      type: 'text',
      inputmode: 'decimal',
      placeholder: `${priceToInput(variant.price)} — inherits`,
      class: 'h-10',
    })

    const save = button('Save', {
      variant: 'outline',
      size: 'sm',
      disabled: busy,
      onClick: () => void saveVariant(variant, sku.value, price.value),
    })

    const active = h('input', {
      type: 'checkbox',
      id: `variants-active-${variant.variant_id}`,
      class: 'h-5 w-5 shrink-0 rounded border-input text-primary',
      checked: variant.is_active,
      onChange: () => {
        void updateVariant({ variant_id: variant.variant_id, is_active: active.checked })
      },
    })

    return h(
      'div',
      { class: 'rounded-lg border border-border bg-surface p-3' },
      h(
        'div',
        { class: 'mb-2 flex flex-wrap items-center justify-between gap-2' },
        h(
          'p',
          { class: 'text-sm font-medium text-content' },
          variant.name_suffix ?? 'No options'
        ),
        h(
          'span',
          { class: 'text-xs text-content-muted' },
          variant.price_override === null
            ? `inherits ${priceLabel(variant.price, deps.currency)}`
            : priceLabel(variant.price, deps.currency)
        )
      ),
      h(
        'div',
        { class: 'grid gap-2 sm:grid-cols-2' },
        field('SKU', sku, { hint: 'Left blank, the core keeps its own code.' }),
        field('Price override', price, { hint: 'Blank keeps the product’s price.' })
      ),
      h(
        'div',
        { class: 'mt-2 flex flex-wrap items-center justify-between gap-2' },
        h(
          'label',
          { class: 'flex items-center gap-2 text-xs text-content-muted', for: active.id },
          active,
          h('span', { text: 'Active' })
        ),
        save
      )
    )
  }

  async function saveVariant(variant: VariantRow, sku: string, priceText: string): Promise<void> {
    const parsed = inputToPrice(priceText)
    if (parsed === undefined) {
      toastError('That price is not a number.')
      return
    }
    await updateVariant({ variant_id: variant.variant_id, sku, price_override: parsed })
  }

  async function updateVariant(args: Record<string, unknown>): Promise<void> {
    if (busy) return
    busy = true
    try {
      await deps.db.rpc('update', args)
      // Re-read rather than patching locally: the effective price of a variant
      // depends on the product's price too, and guessing it here would be a
      // second implementation of the core's rule.
      const refreshed = await deps.db.rpc<ProductState>('axes', { product_id: productId })
      state = refreshed
      toastSuccess('Variant saved')
    } catch (error) {
      toastError(messageOf(error))
      deps.log?.warn('variant update refused', error)
    } finally {
      busy = false
      drawStatus()
      drawVariants()
    }
  }

  function bulkEditor(): HTMLElement {
    const fieldSelect = h('select', {
      class:
        'h-10 w-full rounded-md border border-input bg-surface px-3 text-base text-content sm:text-sm',
      'aria-label': 'Bulk field',
    })
    for (const [value, label] of [
      ['price', 'Selling price'],
      ['cost', 'Cost price'],
    ] as const) {
      fieldSelect.appendChild(h('option', { value, text: label, selected: value === 'price' }))
    }

    const modeSelect = h('select', {
      class:
        'h-10 w-full rounded-md border border-input bg-surface px-3 text-base text-content sm:text-sm',
      'aria-label': 'Bulk mode',
    })
    for (const [value, label] of [
      ['percent', 'Adjust by %'],
      ['set', 'Set to'],
    ] as const) {
      modeSelect.appendChild(h('option', { value, text: label, selected: value === 'percent' }))
    }

    const amount = input({ type: 'text', inputmode: 'decimal', value: '10', class: 'h-10' })

    const onlyInherited = h('input', {
      type: 'checkbox',
      id: 'variants-bulk-inherited',
      class: 'h-5 w-5 shrink-0 rounded border-input text-primary',
      checked: true,
    })

    const apply = button('Apply to all', {
      variant: 'secondary',
      size: 'sm',
      icon: 'percent',
      disabled: busy,
      onClick: () => void runBulk(fieldSelect.value, modeSelect.value, amount.value, onlyInherited.checked),
    })

    return h(
      'div',
      { class: 'rounded-lg border border-dashed border-border bg-surface-muted/40 p-3' },
      h('p', { class: 'mb-2 text-sm font-medium text-content' }, 'Price them in one pass'),
      h(
        'div',
        { class: 'grid gap-2 sm:grid-cols-3' },
        fieldSelect,
        modeSelect,
        field('Amount', amount, { hint: 'A number, e.g. 10 for +10%' })
      ),
      h(
        'div',
        { class: 'mt-2 flex flex-wrap items-center justify-between gap-2' },
        h(
          'label',
          { class: 'flex items-center gap-2 text-xs text-content-muted', for: onlyInherited.id },
          onlyInherited,
          h('span', { text: 'Only the ones still inheriting the product’s price' })
        ),
        apply
      )
    )
  }

  async function runBulk(
    fieldName: string,
    mode: string,
    amountText: string,
    onlyInherited: boolean
  ): Promise<void> {
    if (busy) return

    const raw = Number(amountText.replace(/[^0-9.-]/g, ''))
    if (!Number.isFinite(raw)) {
      toastError('Enter a number to apply.')
      return
    }

    // The server takes minor units for a price and 1/10000ths for a cost, and a
    // plain percentage for a percentage. Convert here, once.
    let value = raw
    if (mode === 'set') {
      if (fieldName === 'price') {
        const parsed = inputToPrice(amountText)
        if (parsed === undefined || parsed === null) {
          toastError('That amount is not a number.')
          return
        }
        value = parsed
      } else {
        const parsed = inputToCost(amountText)
        if (parsed === undefined || parsed === null) {
          toastError('That amount is not a number.')
          return
        }
        value = parsed
      }
    }

    busy = true
    try {
      const result = await deps.db.rpc<{ updated: number }>('bulk', {
        product_id: productId,
        field: fieldName,
        mode,
        value,
        only_inherited: onlyInherited,
      })
      const refreshed = await deps.db.rpc<ProductState>('axes', { product_id: productId })
      state = refreshed
      toastSuccess(
        result.updated === 0
          ? 'Nothing to change — no variant was left to inherit'
          : `${result.updated} variant${result.updated === 1 ? '' : 's'} re-priced`
      )
    } catch (error) {
      toastError(messageOf(error))
      deps.log?.warn('bulk change refused', error)
    } finally {
      busy = false
      drawStatus()
      drawVariants()
    }
  }

  // ── First paint ─────────────────────────────────────────────────────────

  showLoading()

  void refreshAxes().catch((error: unknown) => {
    deps.log?.warn('could not read variants', error)
    mount(
      root,
      emptyState('Variants could not be read', {
        iconName: 'error',
        description: messageOf(error),
      })
    )
  })

  return root
}
