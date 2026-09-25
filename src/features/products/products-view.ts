/**
 * Products (spec §8, §9, §45).
 *
 * ── Minimal data entry ───────────────────────────────────────────────────
 * The quick-add row takes three fields: name, price, stock. Everything else
 * has a sensible default, because the fastest way to make a shop stop using
 * software is to make adding a product feel like filling in a tax form.
 *
 * The full form is the same form with an "+ Advanced options" section that
 * stays collapsed. It is one component with a disclosure, not two screens —
 * two forms for one entity is how the two drift apart.
 *
 * ── Plugin fields ────────────────────────────────────────────────────────
 * The form renders whatever `registry.productFields` contains, so a plugin
 * adding an expiry date appears here with no edit to this file. Fields marked
 * `advanced` land in the collapsed section — unless the *shop type* promotes
 * them, which is the other half of the same idea: a pharmacy should meet the
 * expiry date on the way in, a bookstore should never meet it at all, and
 * neither of those is the plugin's decision to make (docs/08 §2, spec §8).
 *
 * Promotion is data: `data/shop_categories.json` names the keys, the session
 * carries the shop's type (migration 047), and `splitPluginFields` does the
 * rest. A field a shop type promotes is the same field a plugin registered —
 * nothing is duplicated and no plugin learns which shop it is in.
 */

import { h } from '../../components/ui/h'
import { button, iconButton, spinner } from '../../components/ui/button'
import { input, select, checkbox, field, searchInput, textarea } from '../../components/ui/input'
import { badge, emptyState, panel } from '../../components/ui/card'
import { modal } from '../../components/feedback/modal'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { confirm } from '../../components/feedback/modal'
import { getRepositories } from '../../app/data'
import { pluginFormSectionsHost } from '../../app/plugin-slots'
import { bindDrafts, clearDraft, restoreDraft } from '../../app/state/drafts'
import { translateError } from '../../app/platform/errors'
import { activeOrganization } from '../../app/state/session'
import { activePromotedFields } from '../../app/shop-profile'
import { splitPluginFields } from '../../shared/types/shop-profile'
import type { PluginRegistry } from '../../shared/registry/plugin-registry'
import type { ProductField } from '../../shared/registry/plugin-types'
import type { Brand, Category, ProductRow, Tax, Unit } from '../../shared/types/records'
import { formatMoney, minor, type Minor } from '../../shared/domain/money'

export interface ProductsViewOptions {
  registry: PluginRegistry
  onOpenProduct?: (id: string) => void
}

export function productsView(options: ProductsViewOptions): HTMLElement {
  const repos = getRepositories()
  const currency = activeOrganization()?.currency ?? 'BDT'

  let rows: ProductRow[] = []
  let cursor: string | null = null
  let searchTerm = ''
  let loading = false

  const tableBody = h('tbody')
  const listBox = h('div', { class: 'flex-1 min-h-0 overflow-y-auto' })

  async function load(reset: boolean): Promise<void> {
    if (loading) return
    loading = true
    if (reset) {
      cursor = null
      rows = []
    }
    try {
      const page = await repos.products.list({
        limit: 25,
        cursor,
        ...(searchTerm ? { search: searchTerm } : {}),
      })
      rows = reset ? page.items : [...rows, ...page.items]
      cursor = page.nextCursor
      render()
    } catch (error) {
      toastError(translateError(error).message)
    } finally {
      loading = false
    }
  }

  function render(): void {
    if (rows.length === 0) {
      listBox.replaceChildren(
        emptyState(searchTerm ? 'No products match that search' : 'No products yet', {
          description: searchTerm
            ? 'Try a different name, SKU or barcode.'
            : 'Add your first product — a name and a price is enough to start selling.',
          iconName: 'inventory_2',
          action: button('Add product', { variant: 'primary', icon: 'add', onClick: () => openForm(null) }),
        })
      )
      return
    }

    listBox.replaceChildren(
      panel(
        h('table', { class: 'w-full text-sm' },
          h('thead', { class: 'text-left text-xs text-content-muted border-b border-border' },
            h('tr', {},
              h('th', { class: 'px-3 py-2 font-medium', text: 'Product' }),
              h('th', { class: 'px-3 py-2 font-medium', text: 'SKU' }),
              h('th', { class: 'px-3 py-2 font-medium text-right', text: 'Price' }),
              h('th', { class: 'px-3 py-2 font-medium text-right', text: 'Cost' }),
              h('th', { class: 'px-3 py-2 font-medium text-center', text: 'Stock' }),
              h('th', { class: 'px-3 py-2 w-24' })
            )
          ),
          tableBody
        )
      )
    )

    tableBody.replaceChildren(...rows.map(productRow))

    if (cursor) {
      listBox.append(
        h('div', { class: 'p-3 text-center' },
          button('Load more', { variant: 'outline', onClick: () => void load(false) })
        )
      )
    }
  }

  function productRow(product: ProductRow): HTMLElement {
    const price = minor(Math.round(Number(product.selling_price) * 100) as Minor)
    return h('tr', { class: 'border-b border-border hover:bg-surface-muted' },
      h('td', { class: 'px-3 py-2' },
        h('button', {
          type: 'button',
          class: 'text-left font-medium text-content hover:underline',
          text: product.name,
          onClick: () => openForm(product.id),
        })
      ),
      h('td', { class: 'px-3 py-2 text-content-muted font-mono text-xs', text: product.sku ?? '—' }),
      h('td', { class: 'px-3 py-2 text-right tabular-nums text-content', text: formatMoney(price, { currency }) }),
      h('td', { class: 'px-3 py-2 text-right tabular-nums text-content-muted', text: Number(product.cost_price).toFixed(2) }),
      h('td', { class: 'px-3 py-2 text-center' },
        product.track_stock
          ? badge('Tracked', { tone: 'neutral' })
          : badge('Not tracked', { tone: 'info' })
      ),
      h('td', { class: 'px-3 py-2' },
        h('div', { class: 'flex justify-end gap-1' },
          iconButton('content_copy', 'Duplicate', {
            size: 'sm',
            variant: 'ghost',
            onClick: () => void duplicate(product),
          }),
          iconButton('delete', 'Archive', {
            size: 'sm',
            variant: 'ghost',
            onClick: () => void archive(product),
          })
        )
      )
    )
  }

  async function duplicate(product: ProductRow): Promise<void> {
    try {
      const copy = await repos.products.duplicate(product.id)
      toastSuccess(`Copied as “${copy.name}”`)
      await load(true)
    } catch (error) {
      toastError(translateError(error).message)
    }
  }

  async function archive(product: ProductRow): Promise<void> {
    const ok = await confirm(`Archive “${product.name}”?`, {
      message: 'It disappears from the POS and the list. Past sales keep their record of it.',
      confirmLabel: 'Archive',
      tone: 'danger',
      iconName: 'archive',
    })
    if (!ok) return
    try {
      await repos.products.archive(product.id)
      toastSuccess('Archived')
      await load(true)
    } catch (error) {
      toastError(translateError(error).message)
    }
  }

  async function openForm(id: string | null): Promise<void> {
    let product: ProductRow | null = null
    if (id) {
      product = await repos.products.get(id)
      if (!product) {
        toastError('That product no longer exists.')
        return
      }
    }
    openProductForm({
      product,
      registry: options.registry,
      onSaved: () => void load(true),
    })
  }

  const root = h('div', { class: 'flex h-full flex-col p-4' },
    h('div', { class: 'mb-3 flex items-center gap-2' },
      h('div', { class: 'flex-1 max-w-sm' },
        searchInput('Search by name, SKU or barcode', (value) => {
          searchTerm = value
          void load(true)
        })
      ),
      h('div', { class: 'flex-1' }),
      button('Quick add', { variant: 'outline', icon: 'bolt', onClick: () => openQuickAdd() }),
      button('Add product', { variant: 'primary', icon: 'add', onClick: () => void openForm(null) })
    ),
    listBox
  )

  void load(true)
  return root

  function openQuickAdd(): void {
    const nameInput = input({ placeholder: 'e.g. Miniket Rice 5kg', autofocus: true })
    const priceInput = input({ type: 'text', inputmode: 'decimal', placeholder: '0.00' })
    const stockInput = input({ type: 'text', inputmode: 'decimal', placeholder: '0' })
    const errorSlot = h('p', { class: 'text-sm text-danger mt-2 hidden' })

    const dialog = modal({
      title: 'Quick add product',
      subtitle: 'Three fields. Everything else can wait.',
      iconName: 'bolt',
      size: 'sm',
      footer: [
        button('Cancel', { variant: 'ghost', onClick: () => dialog.close() }),
        button('Save', {
          variant: 'primary',
          icon: 'check',
          onClick: () => void save(),
        }),
      ],
    })

    async function save(): Promise<void> {
      errorSlot.classList.add('hidden')
      const name = nameInput.value.trim()
      const price = Number(priceInput.value.replace(/[^0-9.]/g, ''))
      if (!name) {
        errorSlot.textContent = 'A product needs a name.'
        errorSlot.classList.remove('hidden')
        return
      }
      if (!Number.isFinite(price) || price < 0) {
        errorSlot.textContent = 'Enter a selling price.'
        errorSlot.classList.remove('hidden')
        return
      }
      try {
        await repos.products.create({
          name,
          selling_price: price,
          cost_price: 0,
          tax_inclusive: false,
          reorder_point: 0,
          track_stock: true,
          allow_negative: false,
          is_active: true,
          metadata: {},
        })
        clearDraft('products.quickAdd')
        dialog.close()
        toastSuccess(`“${name}” added`)
        await load(true)
      } catch (error) {
        errorSlot.textContent = translateError(error).message
        errorSlot.classList.remove('hidden')
      }
    }

    dialog.body.replaceChildren(
      h('div', { class: 'space-y-3' },
        field('Name', nameInput, { required: true }),
        h('div', { class: 'grid grid-cols-2 gap-3' },
          field('Selling price', priceInput, { required: true }),
          field('Opening stock', stockInput, { hint: 'Saved as a stock-in at zero cost' })
        ),
        errorSlot
      )
    )

    // Survives a failed save or an accidental close; cleared only once the
    // product actually exists.
    bindDrafts(dialog.body, 'products.quickAdd')

    for (const el of [nameInput, priceInput, stockInput]) {
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void save()
        }
      })
    }
  }
}

// ── Full form ─────────────────────────────────────────────────────────────

interface FormOptions {
  product: ProductRow | null
  registry: PluginRegistry
  onSaved: () => void
}

function openProductForm(options: FormOptions): void {
  const { product, registry, onSaved } = options
  const repos = getRepositories()
  const currency = activeOrganization()?.currency ?? 'BDT'
  const draftKey = `products.form.${product?.id ?? 'new'}`

  let categories: Category[] = []
  let brands: Brand[] = []
  let units: Unit[] = []
  let taxes: Tax[] = []

  const nameInput = input({ value: product?.name ?? '', autofocus: true })
  const skuInput = input({ value: product?.sku ?? '', placeholder: 'Auto-generated if blank' })
  const priceInput = input({
    type: 'text',
    inputmode: 'decimal',
    value: product?.selling_price ?? '',
  })
  const costInput = input({
    type: 'text',
    inputmode: 'decimal',
    value: product?.cost_price ?? '',
  })
  const descriptionInput = textarea({ value: product?.description ?? '', rows: 2 })
  const taxInclusiveBox = checkbox({ label: 'Price includes tax', checked: product?.tax_inclusive ?? false })
  const trackStockBox = checkbox({ label: 'Track stock', checked: product?.track_stock ?? true })
  const allowNegativeBox = checkbox({ label: 'Allow selling below zero', checked: product?.allow_negative ?? false })
  const activeBox = checkbox({ label: 'Active (sellable)', checked: product?.is_active ?? true })
  const reorderInput = input({ type: 'text', inputmode: 'decimal', value: product?.reorder_point ?? '0' })

  const categorySelect = select({ options: [], placeholder: 'No category' })
  const brandSelect = select({ options: [], placeholder: 'No brand' })
  const unitSelect = select({ options: [], placeholder: 'Each' })
  const taxSelect = select({ options: [], placeholder: 'No tax' })

  const errorSlot = h('p', { class: 'text-sm text-danger mt-2 hidden' })
  const saveButton = button(product ? 'Save changes' : 'Create product', {
    variant: 'primary',
    icon: 'check',
    onClick: () => void save(),
  })

  const dialog = modal({
    title: product ? 'Edit product' : 'New product',
    subtitle: 'Only the name is required.',
    iconName: 'inventory_2',
    size: 'lg',
    footer: [
      button('Cancel', { variant: 'ghost', onClick: () => dialog.close() }),
      saveButton,
    ],
  })

  // Plugin-registered fields, split by the section the plugin asked for — and
  // by what this shop type promotes out of it. A promoted field is drawn in the
  // basic section, once, and the fields a shop type does not name keep exactly
  // the section their plugin chose.
  const pluginFields = registry.productFields.items
  const { basic: basicPluginFields, advanced: advancedPluginFields } = splitPluginFields(
    pluginFields,
    activePromotedFields()
  )
  const pluginInputs = new Map<string, HTMLElement & { value?: string }>()

  function renderPluginField(definition: ProductField): HTMLElement {
    const metadata = (product?.metadata ?? {}) as Record<string, unknown>
    const current = metadata[definition.key]
    const value = typeof current === 'string' || typeof current === 'number' ? String(current) : ''

    let control: HTMLElement
    switch (definition.type) {
      case 'select':
        control = select({
          options: definition.options ?? [],
          value,
          placeholder: definition.placeholder ?? 'Choose…',
        })
        break
      case 'boolean': {
        let checked = current === true
        control = checkbox({
          label: definition.placeholder ?? '',
          checked,
          onChange: (next) => {
            checked = next
          },
        })
        ;(control as HTMLElement & { readBoolean: () => boolean }).readBoolean = () => checked
        break
      }
      case 'textarea':
        control = textarea({ value, placeholder: definition.placeholder })
        break
      case 'number':
      case 'money':
        control = input({ type: 'text', inputmode: 'decimal', value, placeholder: definition.placeholder })
        break
      case 'date':
        control = input({ type: 'date', value })
        break
      case 'datetime':
        control = input({ type: 'datetime-local', value })
        break
      default:
        control = input({ value, placeholder: definition.placeholder })
    }

    pluginInputs.set(definition.key, control as HTMLElement & { value?: string })
    return field(definition.label, control, { required: definition.required === true })
  }

  // Advanced section, collapsed until asked for (spec §8).
  const advancedBody = h('div', { class: 'hidden grid grid-cols-2 gap-3 pt-3' })
  const advancedToggle = button('Advanced options', {
    variant: 'ghost',
    size: 'sm',
    trailingIcon: 'expand_more',
    onClick: () => {
      const open = advancedBody.classList.toggle('hidden') === false
      advancedToggle.querySelector('.material-symbols-rounded')!.textContent = open
        ? 'expand_less'
        : 'expand_more'
    },
  })

  async function save(): Promise<void> {
    errorSlot.classList.add('hidden')
    const name = nameInput.value.trim()
    if (!name) {
      errorSlot.textContent = 'A product needs a name.'
      errorSlot.classList.remove('hidden')
      return
    }

    // Plugin validators run before anything is sent, so a plugin can reject a
    // save without the database being the first to notice.
    const draftMetadata: Record<string, unknown> = {}
    for (const definition of pluginFields) {
      const control = pluginInputs.get(definition.key)
      if (!control) continue
      const controlRecord = control as unknown as {
        readBoolean?: () => boolean
        value?: string
      }
      const raw =
        typeof controlRecord.readBoolean === 'function'
          ? controlRecord.readBoolean()
          : controlRecord.value ?? ''
      draftMetadata[definition.key] = raw
      const problem = definition.validate?.(raw, {
        name,
        price: Number(priceInput.value) || null,
        cost_price: Number(costInput.value) || null,
        track_stock: true,
        metadata: draftMetadata,
      })
      if (problem) {
        errorSlot.textContent = `${definition.label}: ${problem}`
        errorSlot.classList.remove('hidden')
        return
      }
    }

    const payload = {
      name,
      sku: skuInput.value.trim() || null,
      description: descriptionInput.value.trim() || null,
      category_id: categorySelect.value || null,
      brand_id: brandSelect.value || null,
      unit_id: unitSelect.value || null,
      tax_id: taxSelect.value || null,
      selling_price: Number(priceInput.value.replace(/[^0-9.]/g, '')) || 0,
      cost_price: Number(costInput.value.replace(/[^0-9.]/g, '')) || 0,
      tax_inclusive: taxInclusiveBox.querySelector('input')?.checked ?? false,
      reorder_point: Number(reorderInput.value.replace(/[^0-9.]/g, '')) || 0,
      track_stock: trackStockBox.querySelector('input')?.checked ?? true,
      allow_negative: allowNegativeBox.querySelector('input')?.checked ?? false,
      is_active: activeBox.querySelector('input')?.checked ?? true,
      metadata: { ...(product?.metadata ?? {}), ...draftMetadata },
    }

    saveButton.disabled = true
    try {
      if (product) {
        await repos.products.update(product.id, payload)
        toastSuccess('Product updated')
      } else {
        await repos.products.create(payload)
        toastSuccess('Product created')
      }
      clearDraft(draftKey)
      dialog.close()
      onSaved()
    } catch (error) {
      errorSlot.textContent = translateError(error).message
      errorSlot.classList.remove('hidden')
      saveButton.disabled = false
    }
  }

  dialog.body.replaceChildren(
    h('div', { class: 'space-y-3' },
      field('Name', nameInput, { required: true }),
      h('div', { class: 'grid grid-cols-2 gap-3' },
        field('Selling price', priceInput, { required: true }),
        field('Cost price', costInput, { hint: 'Used for profit and stock value' })
      ),
      ...basicPluginFields.map(renderPluginField),
      pluginFormSectionsHost(registry, {
        organizationId: activeOrganization()?.organization_id ?? '',
        branchId: null,
        currency,
        ...(product?.id ? { productId: product.id } : {}),
      }),
      field('Description', descriptionInput),

      advancedToggle,
      advancedBody
    ),
    errorSlot
  )

  advancedBody.append(
    field('SKU', skuInput, { hint: 'Leave blank to keep the current code' }),
    field('Category', categorySelect),
    field('Brand', brandSelect),
    field('Unit', unitSelect),
    field('Tax', taxSelect),
    field('Reorder point', reorderInput),
    h('div', { class: 'col-span-2 space-y-2 pt-1' },
      taxInclusiveBox,
      trackStockBox,
      allowNegativeBox,
      activeBox
    ),
    ...advancedPluginFields.map(renderPluginField),
    pluginFormSectionsHost(
      registry,
      {
        organizationId: activeOrganization()?.organization_id ?? '',
        branchId: null,
        currency,
        ...(product?.id ? { productId: product.id } : {}),
      },
      'advanced'
    )
  )

  // Bind after every field exists, including the plugin-rendered ones.
  bindDrafts(dialog.body, draftKey)

  void (async () => {
    const busy = spinner('h-4 w-4')
    advancedBody.prepend(busy)
    try {
      const [c, b, u, t] = await Promise.all([
        repos.catalog.listCategories(),
        repos.catalog.listBrands(),
        repos.catalog.listUnits(),
        repos.catalog.listTaxes(),
      ])
      categories = c
      brands = b
      units = u
      taxes = t
      fill(categorySelect, categories.map((x) => ({ value: x.id, label: x.name })), product?.category_id ?? null)
      fill(brandSelect, brands.map((x) => ({ value: x.id, label: x.name })), product?.brand_id ?? null)
      fill(unitSelect, units.map((x) => ({ value: x.id, label: `${x.name} (${x.symbol})` })), product?.unit_id ?? null)
      fill(taxSelect, taxes.map((x) => ({ value: x.id, label: `${x.name} (${x.rate}%)` })), product?.tax_id ?? null)
      restoreDraft(dialog.body, draftKey)
    } catch (error) {
      toastError(translateError(error).message)
    } finally {
      busy.remove()
    }
  })()
}

function fill(
  target: HTMLSelectElement,
  options: { value: string; label: string }[],
  selected: string | null
): void {
  const placeholder = target.options[0]
  target.replaceChildren()
  if (placeholder) target.appendChild(placeholder)
  for (const option of options) {
    target.appendChild(h('option', { value: option.value, text: option.label }))
  }
  if (selected) target.value = selected
}
