/**
 * Serial Numbers — the shop-wide screen behind Inventory → Serial Numbers.
 *
 * Four questions, in the order a shop asks them:
 *
 *   1. What left without a number? — the sales at the top, each fixable in
 *      place, because a shopkeeper who has to go and find the sale will not.
 *   2. What did we just receive? — paste a delivery in and the pool grows.
 *   3. Where is a particular unit? — the list, searchable by number, invoice
 *      or customer, which is the whole reason the table exists.
 *   4. What are we sitting on? — units in stock, oldest first, because
 *      serialised stock is money and it is invisible in a stock count.
 *
 * Everything is read through `db.rpc`, so a shop's own server decides what a
 * shopkeeper may see (docs/11 §4).
 */

import { badge, card, cardHeader, emptyState, stat } from '../../components/ui/card'
import { button, spinner } from '../../components/ui/button'
import { dataTable } from '../../components/ui/table'
import { field, input, select, textarea } from '../../components/ui/input'
import { toastError, toastSuccess, toastWarning } from '../../components/feedback/toast'
import { h, mount } from '../../components/ui/h'
import type {
  PluginDb,
  PluginPageContext,
  PluginPageModule,
  PluginSettings,
} from '../../shared/registry/plugin-types'
import { captureCard } from './capture'
import {
  describeError,
  parseSerials,
  printableSheet,
  reasonLabel,
  statusLabel,
  statusTone,
  missingLabel,
  type AddResult,
  type Catalog,
  type Overview,
  type PendingSale,
  type SerialPage,
  type SerialReport,
  type SerialRow,
  type VariantRow,
} from './helpers'
import { PENDING_WINDOW_DAYS } from './manifest'

export interface ScreenDeps {
  db: PluginDb
  settings: PluginSettings
}

const PAGE_SIZE = 50
const STATUS_FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'IN_STOCK', label: 'In stock' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'RETURNED', label: 'Returned' },
]

/** Opens a print window with the sheet, or says why it could not. */
function printSheet(title: string, rows: Parameters<typeof printableSheet>[1]): void {
  const sheet = printableSheet(title, rows)
  const opened = window.open('', '_blank')
  if (!opened) {
    // A blocked pop-up must not silently lose the list.
    navigator.clipboard?.writeText(sheet).then(
      () => toastSuccess('The print window was blocked, so the sheet was copied to the clipboard.'),
      () => toastError('The print window was blocked. Allow pop-ups for this site and try again.')
    )
    return
  }
  opened.document.write(sheet)
  opened.document.close()
  opened.focus()
}

export function create(deps: ScreenDeps): PluginPageModule {
  return {
    render: (context: PluginPageContext): HTMLElement => {
      let overview: Overview | null = null
      let catalog: Catalog | null = null
      let pending: PendingSale[] = []
      let page: SerialPage | null = null
      let report: SerialReport | null = null
      let reportDays = 30
      let openSale: string | null = null
      let selected: SerialRow | null = null

      let filterStatus = ''
      let filterSearch = ''
      let offset = 0

      // The register form's own state, so a re-draw never loses what a
      // shopkeeper picked.
      let chosenProduct = ''
      let chosenVariant = ''
      let chosenWarehouse = ''
      let variants: VariantRow[] = []

      const body = h('div', { class: 'space-y-4 p-1' })
      const statRow = h('div', { class: 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4' })
      const pendingHost = h('div', { class: 'space-y-2' })
      const registerHost = h('div', {})
      const listHost = h('div', { class: 'space-y-2' })
      const reportHost = h('div', {})

      mount(
        body,
        h(
          'div',
          { class: 'flex flex-wrap items-end justify-between gap-2' },
          h(
            'div',
            {},
            h('h1', { class: 'text-lg font-semibold text-content' }, 'Serial Numbers'),
            h(
              'p',
              { class: 'max-w-2xl text-xs text-content-muted' },
              'One row per physical unit — an IMEI, an engine number, a case number. Register what you receive, and the till attaches what you sell.'
            )
          ),
          h('p', { class: 'text-xs text-content-subtle' }, `shop ${context.organizationId.slice(0, 8)}…`)
        ),
        statRow,
        pendingHost,
        registerHost,
        listHost,
        reportHost
      )

      // ── Reading ─────────────────────────────────────────────────────────

      async function load(): Promise<void> {
        mount(listHost, h('div', { class: 'flex items-center gap-2 p-3 text-sm text-content-muted' }, spinner(), h('span', { text: 'Loading serial numbers…' })))
        try {
          const [nextOverview, nextCatalog, nextPending] = await Promise.all([
            deps.db.rpc<Overview>('overview'),
            deps.db.rpc<Catalog>('catalog'),
            deps.db.rpc<PendingSale[]>('pending', { days: PENDING_WINDOW_DAYS, limit: 25 }),
          ])
          overview = nextOverview
          catalog = nextCatalog
          pending = nextPending
          if (!chosenProduct && catalog.products[0]) chosenProduct = catalog.products[0].id
          if (!chosenWarehouse && catalog.warehouses[0]) chosenWarehouse = catalog.warehouses[0].id
          await loadVariants()
          await loadPage()
          await loadReport()
          draw()
        } catch (error) {
          mount(
            listHost,
            emptyState('Serial numbers could not be read', {
              iconName: 'error',
              description: describeError(error),
            })
          )
        }
      }

      async function loadVariants(): Promise<void> {
        if (!chosenProduct) {
          variants = []
          chosenVariant = ''
          return
        }
        try {
          const result = await deps.db.rpc<{ variants: VariantRow[] }>('variants', {
            product_id: chosenProduct,
          })
          variants = result.variants
          if (!variants.some((variant) => variant.id === chosenVariant)) {
            chosenVariant = variants[0]?.id ?? ''
          }
        } catch (error) {
          variants = []
          toastError(`Variants could not be read: ${describeError(error)}`)
        }
      }

      async function loadPage(): Promise<void> {
        try {
          page = await deps.db.rpc<SerialPage>('list', {
            status: filterStatus,
            search: filterSearch,
            limit: PAGE_SIZE,
            offset,
          })
          drawList()
        } catch (error) {
          mount(
            listHost,
            emptyState('The list could not be read', { iconName: 'error', description: describeError(error) })
          )
        }
      }

      async function loadReport(): Promise<void> {
        try {
          report = await deps.db.rpc<SerialReport>('report', { days: reportDays })
          drawReport()
        } catch {
          // A report is the least important thing on this screen: if it fails
          // the list and the capture list are still exactly what the shop
          // came for.
          report = null
          mount(reportHost, null)
        }
      }

      // ── Drawing ─────────────────────────────────────────────────────────

      function draw(): void {
        drawStats()
        drawPending()
        drawRegister()
        drawList()
        drawReport()
      }

      function drawStats(): void {
        if (!overview) return
        const { totals, pending: waiting } = overview
        const loud = overview.config.require_capture !== false
        mount(
          statRow,
          stat('In stock', String(totals.in_stock), { iconName: 'inventory', hint: `${totals.total} registered` }),
          stat('Sold', String(totals.sold), { iconName: 'sell', hint: `${totals.returned} returned` }),
          stat('Internally coded', String(totals.internal), {
            iconName: 'auto_fix_high',
            hint: `prefix ${overview.config.internal_prefix || '—'}`,
          }),
          stat('Left without a number', String(waiting.units), {
            iconName: 'rule',
            tone: waiting.units > 0 && loud ? 'warning' : 'neutral',
            hint: `${waiting.sales} sale(s) in ${waiting.window_days} day(s)`,
          })
        )
      }

      function drawPending(): void {
        if (pending.length === 0) {
          mount(
            pendingHost,
            card(
              cardHeader('Needs a number', {
                subtitle:
                  'Sales of serial-tracked products with units nobody scanned. Nothing is blocked — this is the list to work through.',
              }),
              h(
                'p',
                { class: 'px-4 pb-4 text-sm text-content-muted' },
                overview && overview.tracked_products === 0
                  ? 'No product is marked as serial-tracked yet. Open a product, tick “Track a serial number for every unit”, and this screen starts working.'
                  : 'Nothing outstanding. Every unit that left has a number.'
              )
            )
          )
          return
        }

        const cards = pending.map((sale) =>
          card(
            h(
              'div',
              { class: 'flex flex-wrap items-center justify-between gap-2 p-4' },
              h(
                'div',
                { class: 'min-w-0' },
                h(
                  'p',
                  { class: 'text-sm font-medium text-content' },
                  `${sale.invoice_no ?? 'Invoice'}${sale.customer ? ` · ${sale.customer}` : ''}`
                ),
                h(
                  'p',
                  { class: 'text-xs text-content-muted' },
                  `${sale.lines.map((line) => `${line.product_name} × ${line.sold_units}`).join(', ')}`
                )
              ),
              h(
                'div',
                { class: 'flex items-center gap-2' },
                badge(missingLabel(sale.missing), { tone: 'warning' }),
                button(openSale === sale.sale_id ? 'Close' : 'Fix now', {
                  size: 'sm',
                  variant: openSale === sale.sale_id ? 'ghost' : 'primary',
                  icon: openSale === sale.sale_id ? 'expand_less' : 'edit',
                  onClick: () => {
                    openSale = openSale === sale.sale_id ? null : sale.sale_id
                    drawPending()
                  },
                })
              )
            ),
            openSale === sale.sale_id
              ? h(
                  'div',
                  { class: 'border-t border-border p-3' },
                  captureCard(
                    { db: deps.db, settings: deps.settings, onChanged: () => void reloadAfterWrite() },
                    sale.sale_id
                  )
                )
              : null
          )
        )

        mount(
          pendingHost,
          h(
            'div',
            { class: 'flex items-center justify-between gap-2' },
            h('h2', { class: 'text-sm font-medium text-content' }, 'Needs a number'),
            h('p', { class: 'text-xs text-content-subtle' }, `${pending.length} sale(s)`)
          ),
          ...cards
        )
      }

      function drawRegister(): void {
        if (!catalog) return

        if (catalog.products.length === 0) {
          mount(
            registerHost,
            card(
              cardHeader('Register units', {
                subtitle:
                  'Mark a product as serial-tracked first: open the product, and tick “Track a serial number for every unit” under Advanced options.',
              })
            )
          )
          return
        }

        const productSelect = select({
          options: catalog.products.map((product) => ({
            value: product.id,
            label: `${product.name}${product.sku ? ` (${product.sku})` : ''} — ${product.serials} unit(s)`,
          })),
          value: chosenProduct,
          onChange: (value) => {
            chosenProduct = value
            void loadVariants().then(() => {
              drawRegister()
              drawStats()
            })
          },
        })

        const variantOptions = variants.map((variant) => ({
          value: variant.id,
          label: `${variant.name} — ${variant.in_stock} of ${variant.on_hand} unit(s) have a number`,
        }))
        const variantSelect = select({
          options: variantOptions,
          value: chosenVariant,
          placeholder: variantOptions.length === 0 ? 'No variants yet' : 'Choose a variant',
          onChange: (value) => {
            chosenVariant = value
          },
        })

        const warehouseSelect = select({
          options: catalog.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name })),
          value: chosenWarehouse,
          placeholder: 'Choose a warehouse',
          onChange: (value) => {
            chosenWarehouse = value
          },
        })

        const pasted = textarea({
          placeholder: 'One per line — a column pasted from a delivery note works\n356938035643809\n356938035643810',
          class: 'font-mono min-h-[7rem]',
        })

        const addButton = button('Add units', {
          variant: 'primary',
          icon: 'playlist_add',
          onClick: () => void addUnits(pasted),
        })

        const chosen = variants.find((variant) => variant.id === chosenVariant)

        mount(
          registerHost,
          card(
            cardHeader('Register units', {
              subtitle:
                'Register what you received. The stock ledger already knows how many there are — this says which ones.',
            }),
            h(
              'div',
              { class: 'grid gap-3 px-4 pb-4 sm:grid-cols-3' },
              field('Product', productSelect),
              field('Variant', variantSelect),
              field('Warehouse', warehouseSelect)
            ),
            h(
              'div',
              { class: 'space-y-2 px-4 pb-4' },
              field('Serial numbers', pasted, {
                hint: chosen
                  ? `${chosen.in_stock} of ${chosen.on_hand} unit(s) on hand already have a number.`
                  : 'A unit with no number is invisible: register the ones you receive.',
              }),
              h('div', { class: 'flex flex-wrap items-center gap-2' }, addButton)
            )
          )
        )
      }

      function drawList(): void {
        if (!page) return
        const rows = page.rows
        const total = page.total

        const search = input({
          value: filterSearch,
          placeholder: 'Number, product, invoice or customer',
          leadingIcon: 'search',
          type: 'search',
          onEnter: (value) => {
            filterSearch = value.trim()
            offset = 0
            void loadPage()
          },
        })
        // `searchInput` debounces; here Enter and the button are enough, since
        // a shopkeeper searching an IMEI knows the exact string.
        const statusSelect = select({
          options: STATUS_FILTERS,
          value: filterStatus,
          onChange: (value) => {
            filterStatus = value
            offset = 0
            void loadPage()
          },
        })

        mount(
          listHost,
          card(
            cardHeader('Units', {
              subtitle: `${total} unit(s)`,
              actions: [
                button('Print list', {
                  size: 'sm',
                  variant: 'ghost',
                  icon: 'print',
                  disabled: rows.length === 0,
                  onClick: () =>
                    printSheet(
                      'Serial numbers',
                      rows.map((row) => ({
                        serial: row.serial,
                        product: row.product_name ?? '',
                        variant: row.variant_name,
                        when: row.sold_at ?? row.received_at,
                      }))
                    ),
                }),
              ],
            }),
            h(
              'div',
              { class: 'grid gap-3 px-4 pb-3 sm:grid-cols-2' },
              field('Find', search, { hint: 'Press Enter to search.' }),
              field('Show', statusSelect)
            ),
            rows.length === 0
              ? h(
                  'p',
                  { class: 'px-4 pb-4 text-sm text-content-muted' },
                  total === 0 && filterStatus === '' && filterSearch === ''
                    ? 'No unit has been registered yet. Paste a delivery into Register units above.'
                    : 'Nothing matches that filter.'
                )
              : dataTable({
                  columns: [
                    { key: 'serial', label: 'Serial', type: 'text' },
                    { key: 'product', label: 'Product', type: 'text' },
                    { key: 'status', label: 'Status', type: 'status' },
                    { key: 'invoice_no', label: 'Invoice', type: 'text' },
                    { key: 'sold_at', label: 'Sold', type: 'date' },
                    { key: 'received_at', label: 'Registered', type: 'date' },
                  ],
                  rows: rows.map((row) => ({
                    serial: row.serial,
                    product: row.variant_name
                      ? `${row.product_name ?? ''} — ${row.variant_name}`
                      : (row.product_name ?? ''),
                    status: row.status,
                    invoice_no: row.invoice_no ?? '—',
                    sold_at: row.sold_at ?? '',
                    received_at: row.received_at,
                  })),
                  onRowClick: (row) => {
                    selected = rows.find((candidate) => candidate.serial === row.serial) ?? null
                    drawSelected()
                  },
                }),
            h('div', { class: 'px-4 pb-4' }, pager(total)),
            selected ? selectedRow(selected) : null
          )
        )
      }

      function pager(total: number): HTMLElement {
        const from = total === 0 ? 0 : offset + 1
        const to = Math.min(offset + PAGE_SIZE, total)
        return h(
          'div',
          { class: 'flex items-center justify-between gap-2 pt-2' },
          h('p', { class: 'text-xs text-content-muted' }, `${from}–${to} of ${total}`),
          h(
            'div',
            { class: 'flex gap-2' },
            button('Previous', {
              size: 'sm',
              variant: 'secondary',
              icon: 'chevron_left',
              disabled: offset === 0,
              onClick: () => {
                offset = Math.max(0, offset - PAGE_SIZE)
                void loadPage()
              },
            }),
            button('Next', {
              size: 'sm',
              variant: 'secondary',
              trailingIcon: 'chevron_right',
              disabled: to >= total,
              onClick: () => {
                offset += PAGE_SIZE
                void loadPage()
              },
            })
          )
        )
      }

      /** The actions a row offers, shown below the table rather than inside it. */
      function selectedRow(row: SerialRow): HTMLElement {
        const actions: HTMLElement[] = [
          button('Copy number', {
            size: 'sm',
            variant: 'ghost',
            icon: 'content_copy',
            onClick: () => {
              navigator.clipboard?.writeText(row.serial).then(
                () => toastSuccess(`${row.serial} copied.`),
                () => toastWarning('The clipboard is not available in this browser.')
              )
            },
          }),
        ]

        if (row.status !== 'IN_STOCK') {
          actions.push(
            button('Return to stock', {
              size: 'sm',
              variant: 'secondary',
              icon: 'undo',
              onClick: () => void release(row),
            })
          )
        }

        return h(
          'div',
          { class: 'flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 pb-4 pt-3' },
          h(
            'div',
            { class: 'flex flex-wrap items-center gap-2' },
            h('span', { class: 'font-mono text-sm text-content', text: row.serial }),
            badge(statusLabel(row.status), { tone: statusTone(row.status) }),
            badge(row.source.toLowerCase(), { tone: 'neutral' }),
            h(
              'span',
              { class: 'text-xs text-content-muted' },
              [
                row.product_name,
                row.variant_name && row.variant_name !== 'Default' ? row.variant_name : null,
                row.warehouse,
                row.invoice_no ? `invoice ${row.invoice_no}` : null,
                row.customer,
                row.released_at ? 'released to stock' : null,
              ]
                .filter(Boolean)
                .join(' · ')
            )
          ),
          h('div', { class: 'flex flex-wrap items-center gap-2' }, ...actions)
        )
      }

      function drawSelected(): void {
        drawList()
      }

      function drawReport(): void {
        if (!report) {
          mount(reportHost, null)
          return
        }

        mount(
          reportHost,
          card(
            cardHeader('Units in hand', {
              subtitle: `Registered, sold and returned over the last ${report.window.days} day(s).`,
              actions: [
                select({
                  options: [
                    { value: '30', label: '30 days' },
                    { value: '90', label: '90 days' },
                    { value: '365', label: '1 year' },
                  ],
                  value: String(reportDays),
                  onChange: (value) => {
                    reportDays = Number(value)
                    void loadReport()
                  },
                }),
              ],
            }),
            h(
              'div',
              { class: 'flex flex-wrap gap-2 px-4' },
              badge(`${report.totals.sold} sold`, { tone: 'info', iconName: 'sell' }),
              badge(`${report.totals.returned} returned`, { tone: 'warning', iconName: 'assignment_return' }),
              badge(`${report.totals.in_stock} in stock`, { tone: 'success', iconName: 'inventory' }),
              report.pending_units > 0
                ? badge(`${report.pending_units} waiting for a number`, { tone: 'danger', iconName: 'rule' })
                : null
            ),
            h(
              'div',
              { class: 'grid gap-3 p-4 sm:grid-cols-2' },
              h(
                'div',
                {},
                h('p', { class: 'mb-2 text-xs font-medium text-content-muted' }, 'How long we have held them'),
                report.aging.length === 0
                  ? h('p', { class: 'text-xs text-content-subtle' }, 'Nothing in stock.')
                  : h(
                      'div',
                      { class: 'space-y-1' },
                      ...report.aging.map((bucket) =>
                        h(
                          'div',
                          { class: 'flex items-center justify-between gap-2 text-sm' },
                          h('span', { class: 'text-content-muted', text: bucket.bucket }),
                          h('span', { class: 'tabular-nums text-content', text: String(bucket.count) })
                        )
                      )
                    )
              ),
              h(
                'div',
                {},
                h('p', { class: 'mb-2 text-xs font-medium text-content-muted' }, 'By product'),
                report.by_product.length === 0
                  ? h('p', { class: 'text-xs text-content-subtle' }, 'Nothing to show yet.')
                  : h(
                      'div',
                      { class: 'space-y-1' },
                      ...report.by_product.map((entry) =>
                        h(
                          'div',
                          { class: 'flex items-center justify-between gap-2 text-sm' },
                          h('span', { class: 'min-w-0 truncate text-content', text: entry.product_name }),
                          h(
                            'span',
                            { class: 'shrink-0 tabular-nums text-content-muted' },
                            `${entry.sold} sold · ${entry.in_stock} in stock`
                          )
                        )
                      )
                    )
              )
            )
          )
        )
      }

      // ── Writes ──────────────────────────────────────────────────────────

      async function reloadAfterWrite(): Promise<void> {
        // Read again rather than patch what is on screen: the numbers a
        // shopkeeper is about to act on must be the server's, not this
        // screen's guess at them.
        try {
          const [nextOverview, nextPending] = await Promise.all([
            deps.db.rpc<Overview>('overview'),
            deps.db.rpc<PendingSale[]>('pending', { days: PENDING_WINDOW_DAYS, limit: 25 }),
          ])
          overview = nextOverview
          pending = nextPending
          await loadPage()
          await loadVariants()
          drawStats()
          drawPending()
          drawRegister()
          await loadReport()
        } catch (error) {
          toastError(`Could not refresh: ${describeError(error)}`)
        }
      }

      async function addUnits(pasted: HTMLTextAreaElement): Promise<void> {
        const parsed = parseSerials(pasted.value)
        if (parsed.serials.length === 0) {
          toastWarning('Nothing to add — paste one serial number per line.')
          return
        }
        if (!chosenVariant) {
          toastWarning('Choose a variant first.')
          return
        }

        try {
          const result = await deps.db.rpc<AddResult>('add', {
            variant_id: chosenVariant,
            warehouse_id: chosenWarehouse || undefined,
            serials: parsed.serials,
          })

          const reasons = new Map<string, number>()
          for (const skipped of result.skipped) {
            reasons.set(skipped.reason, (reasons.get(skipped.reason) ?? 0) + 1)
          }
          const detail = [...reasons.entries()]
            .map(([reason, count]) => `${count} ${reasonLabel(reason)}`)
            .join(', ')

          if (result.added > 0) {
            toastSuccess(`${result.added} unit(s) registered.${detail ? ` Skipped: ${detail}.` : ''}`)
            pasted.value = ''
          } else {
            toastWarning(`Nothing was registered${detail ? `: ${detail}.` : '.'}`)
          }
          if (result.skipped_total > result.skipped.length) {
            toastWarning(`${result.skipped_total - result.skipped.length} more were skipped for the same reasons.`)
          }
          if (parsed.duplicates.length > 0) {
            toastWarning(`${parsed.duplicates.length} entry(ies) were listed twice and counted once.`)
          }

          await reloadAfterWrite()
        } catch (error) {
          toastError(`Units were not registered: ${describeError(error)}`)
        }
      }

      async function release(row: SerialRow): Promise<void> {
        try {
          const result = await deps.db.rpc<{ released: number }>('release', { ids: [row.id] })
          if (result.released > 0) {
            toastSuccess(`${row.serial} is back in stock.`)
          } else {
            toastWarning(`${row.serial} is already in stock.`)
          }
          selected = null
          await reloadAfterWrite()
        } catch (error) {
          toastError(`${row.serial} was not released: ${describeError(error)}`)
        }
      }

      void load()
      return body
    },
  }
}
