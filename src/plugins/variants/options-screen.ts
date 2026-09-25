/**
 * Variants — the shop-wide screen behind Inventory → Variants.
 *
 * Options are shared across the catalogue on purpose: a shop defines “Size”
 * with S, M and L once, and every shirt product then picks from that list. This
 * screen is where that list is kept, and where a shopkeeper can see how much of
 * the catalogue is actually using it.
 *
 * Renaming is safe and deleting is not, which is the whole design. A rename
 * travels: the server rewrites the option name on every variant built from it,
 * so `Colour` becoming `Colour (Pantone)` cannot leave variants pointing at a
 * name that no longer exists. A delete is refused while anything uses it, and
 * says how much does.
 */

import { badge, emptyState, stat } from '../../components/ui/card'
import { button, iconButton, spinner } from '../../components/ui/button'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { field, input } from '../../components/ui/input'
import { h, icon, mount } from '../../components/ui/h'
import type { PluginDb, PluginPageContext, PluginPageModule } from '../../shared/registry/plugin-types'
import { messageOf, type Catalog, type OptionType, type Overview } from './helpers'

export interface OptionsDeps {
  db: PluginDb
}

export function create(deps: OptionsDeps): PluginPageModule {
  return {
    render: (context: PluginPageContext): HTMLElement => {
      const body = h('div', { class: 'space-y-4 p-1' })
      let catalog: Catalog | null = null
      let overview: Overview | null = null
      let busy = false

      const statRow = h('div', { class: 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4' })
      const addHost = h('div', {})
      const listHost = h('div', { class: 'space-y-3' })
      const productsHost = h('div', { class: 'space-y-2' })

      mount(
        body,
        h(
          'div',
          { class: 'flex flex-wrap items-end justify-between gap-2' },
          h(
            'div',
            {},
            h('h1', { class: 'text-lg font-semibold text-content' }, 'Variants'),
            h(
              'p',
              { class: 'text-xs text-content-muted max-w-2xl' },
              'Options a product can be built from — Size, Colour, Capacity. Define them once here, then choose them while adding a product.'
            )
          ),
          h(
            'p',
            { class: 'text-xs text-content-subtle' },
            `shop ${context.organizationId.slice(0, 8)}…`
          )
        ),
        statRow,
        addHost,
        listHost,
        h('h2', { class: 'pt-2 text-sm font-medium text-content' }, 'Products using options'),
        productsHost
      )

      // ── Reading ─────────────────────────────────────────────────────────

      async function load(): Promise<void> {
        const loading = h(
          'div',
          { class: 'flex items-center gap-2 p-3 text-sm text-content-muted' },
          spinner('h-4 w-4'),
          h('span', { text: 'Loading options…' })
        )
        mount(listHost, loading)
        try {
          const [nextCatalog, nextOverview] = await Promise.all([
            deps.db.rpc<Catalog>('catalog'),
            deps.db.rpc<Overview>('overview', { limit: 50 }),
          ])
          catalog = nextCatalog
          overview = nextOverview
          draw()
        } catch (error) {
          mount(
            listHost,
            emptyState('Options could not be read', {
              iconName: 'error',
              description: messageOf(error),
            })
          )
        }
      }

      function draw(): void {
        if (!catalog) return
        drawStats()
        drawAdd()
        drawOptions()
        drawProducts()
      }

      // ── Counts ──────────────────────────────────────────────────────────

      function drawStats(): void {
        if (!catalog) return
        const { totals } = catalog
        mount(
          statRow,
          stat('Options', String(totals.types), {
            iconName: 'category',
            hint: 'Size, Colour, Capacity…',
          }),
          stat('Values', String(totals.values), {
            iconName: 'list',
            hint: 'every S, M, L and Red',
          }),
          stat('Products with options', String(totals.products), {
            iconName: 'inventory_2',
            hint: 'something to choose between',
          }),
          stat('Variants built', String(totals.variants), {
            iconName: 'grid_view',
            hint: `this shop allows ${catalog.config.max_variants} per product`,
          })
        )
      }

      // ── Adding an option, and its values ────────────────────────────────

      function drawAdd(): void {
        const name = input({ placeholder: 'Size, Colour, Capacity…', class: 'h-10' })

        const add = button('Add option', {
          variant: 'primary',
          size: 'sm',
          icon: 'add',
          disabled: busy,
          onClick: () => void submit(),
        })

        const submit = async (): Promise<void> => {
          const value = name.value.trim()
          if (value === '') {
            toastError('Give the option a name first.')
            return
          }
          await call(() => deps.db.rpc('save_type', { name: value }), `“${value}” added`)
          name.value = ''
        }
        name.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') void submit()
        })

        mount(
          addHost,
          h(
            'div',
            { class: 'rounded-lg border border-border bg-surface p-3' },
            h(
              'div',
              { class: 'grid items-end gap-2 sm:grid-cols-[1fr_auto]' },
              field('New option', name, {
                hint: 'Examples: Size, Colour, Capacity, Pack size.',
              }),
              add
            )
          )
        )
      }

      // ── The options themselves ──────────────────────────────────────────

      function drawOptions(): void {
        if (!catalog) return

        if (catalog.types.length === 0) {
          mount(
            listHost,
            emptyState('No options yet', {
              iconName: 'category',
              description:
                'Add “Size” above with values S, M and L, and every product can then be built in those sizes.',
            })
          )
          return
        }

        mount(listHost, ...catalog.types.map((type) => optionCard(type)))
      }

      function optionCard(type: OptionType): HTMLElement {
        const rename = input({ value: type.name, class: 'h-10' })

        const saveName = async (): Promise<void> => {
          const name = rename.value.trim()
          if (name === '' || name === type.name) return
          await call(
            () => deps.db.rpc('save_type', { id: type.id, name }),
            `Renamed to “${name}” on every variant that uses it`
          )
        }

        const newValue = input({ placeholder: 'Add a value…', class: 'h-10' })

        const addValue = async (): Promise<void> => {
          const value = newValue.value.trim()
          if (value === '') return
          await call(
            () => deps.db.rpc('save_value', { option_type_id: type.id, value }),
            `“${value}” added to ${type.name}`
          )
          newValue.value = ''
        }

        // Enter does what the button beside the box does.
        rename.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') void saveName()
        })
        newValue.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') void addValue()
        })

        const remove = iconButton(
          'delete',
          type.products > 0
            ? `${type.name} is used by ${type.products} product(s) — remove it from them first`
            : `Delete the option “${type.name}”`,
          {
            size: 'sm',
            variant: 'ghost',
            disabled: type.products > 0,
            onClick: () => void deleteType(type),
          }
        )

        return h(
          'div',
          { class: 'rounded-lg border border-border bg-surface p-3' },
          h(
            'div',
            { class: 'mb-2 flex flex-wrap items-center justify-between gap-2' },
            h(
              'p',
              { class: 'text-xs text-content-muted' },
              type.products === 0
                ? 'Not used by any product yet'
                : `on ${type.products} product${type.products === 1 ? '' : 's'}`
            )
          ),
          h(
            'div',
            { class: 'flex flex-wrap items-end gap-2' },
            h('div', { class: 'min-w-48 flex-1' }, field('Option', rename, { hint: 'Renaming rewrites it on the variants that carry it.' })),
            iconButton('check', `Save the name of ${type.name}`, {
              size: 'sm',
              variant: 'secondary',
              disabled: busy,
              onClick: () => void saveName(),
            }),
            remove
          ),
          h(
            'div',
            { class: 'mt-3 flex flex-wrap gap-1.5' },
            ...type.values.map((value) => valueChip(type, value)),
            type.values.length === 0
              ? h('p', { class: 'text-xs text-content-muted' }, 'No values yet.')
              : null
          ),
          h(
            'div',
            { class: 'mt-3 grid items-end gap-2 sm:grid-cols-[1fr_auto]' },
            newValue,
            button('Add value', {
              variant: 'outline',
              size: 'sm',
              icon: 'add',
              disabled: busy,
              onClick: () => void addValue(),
            })
          )
        )
      }

      function valueChip(type: OptionType, value: { id: string; value: string }): HTMLElement {
        return h(
          'span',
          {
            class:
              'inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2.5 py-1 text-sm text-content',
          },
          icon('label', 'text-sm text-content-subtle'),
          h('span', { text: value.value }),
          h(
            'button',
            {
              type: 'button',
              class: 'ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-surface',
              'aria-label': `Remove ${value.value} from ${type.name}`,
              disabled: busy,
              onClick: () => void deleteValue(type, value),
            },
            icon('close', 'text-sm')
          )
        )
      }

      // ── Products using options ──────────────────────────────────────────

      function drawProducts(): void {
        if (!overview) return

        if (overview.products.length === 0) {
          mount(
            productsHost,
            h(
              'p',
              { class: 'text-xs text-content-muted' },
              'No product has options yet. Open a product, expand Advanced options, and build its variations.'
            )
          )
          return
        }

        mount(
          productsHost,
          ...overview.products.map((row) =>
            h(
              'div',
              {
                class:
                  'flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3',
              },
              h(
                'div',
                { class: 'min-w-0' },
                h('p', { class: 'truncate text-sm font-medium text-content' }, row.name),
                h(
                  'p',
                  { class: 'text-xs text-content-muted' },
                  `${row.axes} option${row.axes === 1 ? '' : 's'} · ${row.variants} variant${row.variants === 1 ? '' : 's'}`
                )
              ),
              badge(row.sku ?? 'no code', { tone: 'neutral' })
            )
          )
        )
      }

      // ── Writes ──────────────────────────────────────────────────────────

      /** One refusal path for every button, so the screen never half-changes. */
      async function call(action: () => Promise<unknown>, success: string): Promise<void> {
        if (busy) return
        busy = true
        try {
          await action()
          toastSuccess(success)
          busy = false
          await load()
        } catch (error) {
          busy = false
          toastError(messageOf(error))
        }
      }

      async function deleteType(type: OptionType): Promise<void> {
        await call(() => deps.db.rpc('delete_type', { id: type.id }), `“${type.name}” deleted`)
      }

      async function deleteValue(
        type: OptionType,
        value: { id: string; value: string }
      ): Promise<void> {
        await call(
          () => deps.db.rpc('delete_value', { id: value.id }),
          `“${value.value}” removed from ${type.name}`
        )
      }

      void load()
      return body
    },
  }
}
