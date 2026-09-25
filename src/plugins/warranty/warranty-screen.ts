/**
 * Warranty — the shop-wide screen behind Inventory → Warranty.
 *
 * Four questions, in the order a shop asks them:
 *
 *   1. What did we promise and never write down? — the work queue at the top,
 *      because a customer holding a slip the shop cannot find is the failure
 *      this plugin exists to prevent.
 *   2. What is still covered? — the register: filter by what is running out,
 *      what has run out, what is void, what is in the workshop.
 *   3. Where is one particular promise? — the search box, which looks up a unit
 *      number, an invoice, or a customer's name or telephone.
 *   4. What has all of this cost? — the claims queue, with the money spent.
 *
 * Everything is read through `db.rpc`, so the shop's own server decides what a
 * shopkeeper may see (docs/11 §4). Nothing here writes anything the server has
 * not agreed to: the plugin owns two tables, and it does not touch the core's.
 */

import { badge, card, cardHeader, stat } from '../../components/ui/card'
import { button, spinner } from '../../components/ui/button'
import { dataTable } from '../../components/ui/table'
import { pagination } from '../../components/ui/pagination'
import { field, input, select } from '../../components/ui/input'
import { modal } from '../../components/feedback/modal'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { h, mount } from '../../components/ui/h'
import type {
  PluginDb,
  PluginPageContext,
  PluginPageModule,
  PluginSettings,
} from '../../shared/registry/plugin-types'
import { coverCard } from './cover-card'
import {
  claimStatusLabel,
  coverageLabel,
  coverageOf,
  daysLeftLabel,
  describeError,
  moneyLabel,
  monthsLabel,
  unitLabel,
  type ClaimPage,
  type ClaimRow,
  type Overview,
  type PendingQueue,
  type RegisterResult,
  type UnitPage,
  type UnitRow,
} from './helpers'
import { DEFAULT_WARN_DAYS, PENDING_WINDOW_DAYS, WARN_DAYS_KEY } from './manifest'

export interface ScreenDeps {
  db: PluginDb
  settings: PluginSettings
}

const PAGE_SIZE = 25

const SCOPE_FILTERS = [
  { value: 'active', label: 'Covered now' },
  { value: 'expiring', label: 'Running out' },
  { value: 'expired', label: 'Already ended' },
  { value: 'claimed', label: 'Been in for repair' },
  { value: 'void', label: 'Dropped' },
  { value: 'all', label: 'Everything, newest first' },
]

const CLAIM_FILTERS = [
  { value: 'OPEN', label: 'Still open' },
  { value: 'CLOSED', label: 'Finished' },
  { value: 'ALL', label: 'Every claim' },
]

export function create(deps: ScreenDeps): PluginPageModule {
  return {
    render: (context: PluginPageContext): HTMLElement => {
      // Money is the shop's, and the shop's currency arrives with the page
      // rather than being guessed (docs/11 §4).
      const currency = context.currency

      let overview: Overview | null = null
      let queue: PendingQueue | null = null
      let page: UnitPage | null = null
      let claims: ClaimPage | null = null

      let scope = 'active'
      let search = ''
      let offset = 0
      let claimFilter = 'OPEN'
      let claimSearch = ''
      let claimOffset = 0
      let busy = false

      const warnDays = (): number =>
        deps.settings.get<number>(WARN_DAYS_KEY, DEFAULT_WARN_DAYS) || DEFAULT_WARN_DAYS

      const body = h('div', { class: 'space-y-4 p-1' })
      const statRow = h('div', { class: 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4' })
      const queueHost = h('div', {})
      const registerHost = h('div', {})
      const claimsHost = h('div', {})

      mount(
        body,
        h(
          'div',
          { class: 'flex flex-wrap items-end justify-between gap-2' },
          h(
            'div',
            {},
            h('h1', { class: 'text-lg font-semibold text-content' }, 'Warranty'),
            h(
              'p',
              { class: 'max-w-2xl text-xs text-content-muted' },
              'Every promise this shop has made — which unit, until when, to whom — and what keeping them has cost.'
            )
          ),
          h('p', { class: 'text-xs text-content-subtle' }, `shop ${context.organizationId.slice(0, 8)}…`)
        ),
        statRow,
        queueHost,
        registerHost,
        claimsHost
      )

      // ── Reading ─────────────────────────────────────────────────────────

      async function load(): Promise<void> {
        mount(queueHost, loadingRow('Reading what the shop owes…'))
        try {
          const [nextOverview, nextQueue, nextPage, nextClaims] = await Promise.all([
            deps.db.rpc<Overview>('overview'),
            deps.db.rpc<PendingQueue>('pending', {
              days: PENDING_WINDOW_DAYS,
              limit: 20,
            }),
            // Two readers, one search box: a typed search is a *lookup* — the
            // counter's question, "is this covered?" — and browsing a scope is
            // the register. Asking one function to be both would make the
            // ordering depend on whether anybody had typed.
            search.trim().length >= 2
              ? deps.db.rpc<UnitPage>('lookup', { q: search.trim() })
              : deps.db.rpc<UnitPage>('list', { status: scope, search: '', limit: PAGE_SIZE, offset }),
            deps.db.rpc<ClaimPage>('claims', {
              status: claimFilter,
              search: claimSearch.trim(),
              limit: PAGE_SIZE,
              offset: claimOffset,
            }),
          ])
          overview = nextOverview
          queue = nextQueue
          page = nextPage
          claims = nextClaims
        } catch (error) {
          mount(queueHost, h('p', { class: 'text-sm text-content-muted', text: describeError(error) }))
          return
        }
        draw()
      }

      async function act(work: () => Promise<string | null>): Promise<void> {
        if (busy) return
        busy = true
        try {
          const message = await work()
          if (message) toastSuccess(message)
          await load()
        } catch (error) {
          toastError(describeError(error))
        } finally {
          busy = false
        }
      }

      function openSaleCard(saleId: string, ref: string): void {
        const dialog = modal({
          title: 'Warranty cover',
          subtitle: ref,
          iconName: 'verified_user',
          size: 'lg',
          footer: [button('Done', { variant: 'secondary', onClick: () => dialog.close() })],
          onClose: () => void load(),
        })
        dialog.body.appendChild(
          coverCard(
            { db: deps.db, settings: deps.settings, currency: currency },
            saleId,
            { bare: true, onChange: () => undefined }
          )
        )
      }

      // ── Drawing ─────────────────────────────────────────────────────────

      function draw(): void {
        drawStats()
        drawQueue()
        drawRegister()
        drawClaims()
      }

      function drawStats(): void {
        if (!overview) {
          mount(statRow)
          return
        }
        const totals = overview.totals
        mount(
          statRow,
          stat('Cover in force', String(totals.active), {
            iconName: 'verified_user',
            hint: `${totals.units} promise${totals.units === 1 ? '' : 's'} ever written`,
          }),
          stat('Running out', String(totals.expiring), {
            iconName: 'hourglass_bottom',
            tone: totals.expiring > 0 ? 'warning' : 'neutral',
            hint: `inside ${warnDays()} days`,
          }),
          stat('Open claims', String(totals.claims_open), {
            iconName: 'build',
            tone: totals.claims_open > 0 ? 'info' : 'neutral',
            hint: `${totals.claims_total} claim${totals.claims_total === 1 ? '' : 's'} ever`,
          }),
          stat('Claims have cost', moneyLabel(totals.claims_cost_minor, currency), {
            iconName: 'payments',
            hint:
              totals.claims_cost_open_minor > 0
                ? `${moneyLabel(totals.claims_cost_open_minor, currency)} still open`
                : 'all claims settled',
          })
        )
      }

      function drawQueue(): void {
        if (!queue || !overview) {
          mount(queueHost)
          return
        }
        if (queue.rows.length === 0) {
          mount(
            queueHost,
            card(
              cardHeader('Nothing owed', {
                subtitle: `Every sale in the last ${queue.window_days} days that promised cover has it on record.`,
                iconName: 'task_alt',
              }),
              h(
                'p',
                { class: 'text-sm text-content-muted' },
                'Cover is written when the sale completes; a sale taken offline, or before this plugin was switched on, is listed here until somebody writes it.'
              )
            )
          )
          return
        }

        mount(
          queueHost,
          card(
            cardHeader('Sales that still owe a promise', {
              subtitle: `${queue.rows.length} of ${queue.total} · ${queue.units_total} unit${
                queue.units_total === 1 ? '' : 's'
              } missing, since ${queue.from}`,
              iconName: 'pending_actions',
              actions: [
                badge(`${queue.units_total} missing`, {
                  tone: queue.units_total > 0 ? 'warning' : 'success',
                }),
              ],
            }),
            h(
              'div',
              { class: 'divide-y divide-border' },
              ...queue.rows.map((row) =>
                h(
                  'div',
                  { class: 'flex flex-wrap items-center justify-between gap-2 py-3' },
                  h(
                    'div',
                    { class: 'min-w-0' },
                    h(
                      'p',
                      { class: 'text-sm text-content' },
                      `${row.invoice_no ?? 'sale'} · ${
                        row.product_name ? `${row.product_name}${row.units_missing > 1 ? ' and more' : ''}` : ''
                      }`
                    ),
                    h(
                      'p',
                      { class: 'text-xs text-content-muted' },
                      `${row.sold_on ?? ''}${row.customer ? ` · ${row.customer}` : ''} · ${
                        row.units_missing
                      } unit${row.units_missing === 1 ? '' : 's'} · ${
                        row.months === null ? 'shop default' : monthsLabel(row.months)
                      }`
                    )
                  ),
                  h(
                    'div',
                    { class: 'flex items-center gap-1' },
                    button('Register cover', {
                      size: 'sm',
                      variant: 'primary',
                      icon: 'verified_user',
                      onClick: () =>
                        void act(async () => {
                          const result = await deps.db.rpc<RegisterResult>('register', {
                            sale_id: row.sale_id,
                          })
                          return result.created === 0
                            ? 'Nothing on that sale carries cover.'
                            : `${result.created} promise${result.created === 1 ? '' : 's'} written on ${result.invoice_no ?? 'the sale'}.`
                        }),
                    }),
                    button('Open the sale', {
                      size: 'sm',
                      variant: 'ghost',
                      icon: 'open_in_new',
                      onClick: () => openSaleCard(row.sale_id, row.invoice_no ?? ''),
                    })
                  )
                )
              )
            )
          )
        )
      }

      function registerTable(): HTMLElement {
        const rows = page?.rows ?? []
        return h(
          'div',
          { class: 'space-y-2' },
          dataTable({
            columns: [
              { key: 'product', label: 'Product', type: 'text' },
              { key: 'unit', label: 'Unit', type: 'text' },
              { key: 'customer', label: 'Customer', type: 'text' },
              { key: 'invoice', label: 'Invoice', type: 'text' },
              { key: 'ends', label: 'Covered until', type: 'date' },
              { key: 'left', label: 'Days left', type: 'int', align: 'right' },
              { key: 'state', label: 'State', type: 'text' },
              { key: 'claim', label: 'Claim', type: 'text' },
            ],
            rows: rows.map((row) => registerCells(row, warnDays())),
            currency: currency,
            emptyTitle: search.trim() === '' ? 'Nothing in this filter' : 'No promise matches',
            emptyDescription:
              search.trim() === ''
                ? 'Cover appears here the moment a sale that promised it is registered.'
                : `Nothing in this shop matches “${search.trim()}”. Try a unit number, an invoice, or a customer.`,
            onRowClick: (cells) => {
              const saleId = String(cells.sale_id ?? '')
              if (saleId !== '') openSaleCard(saleId, String(cells.invoice_no ?? ''))
            },
          }),
          page && page.total > 0
            ? h(
                'div',
                { class: 'flex items-center justify-between gap-2' },
                pagination({
                  offset: page.offset,
                  limit: page.limit,
                  totalRows: page.total,
                  onPage: (next) => {
                    offset = next
                    void load()
                  },
                }),
                h(
                  'p',
                  { class: 'text-xs text-content-subtle' },
                  'Click a row to work on that sale’s cover.'
                )
              )
            : null
        )
      }

      function registerCells(row: UnitRow, warn: number): Record<string, string | number | null> {
        const coverage = coverageOf(row, warn)
        return {
          product: row.variant_name ? `${row.product_name} — ${row.variant_name}` : row.product_name,
          unit: unitLabel(row),
          customer: row.customer ?? (row.customer_id ? '—' : 'walk-in'),
          invoice: row.invoice_no ?? '—',
          ends: row.status === 'VOID' ? null : row.ends_on,
          left: row.status === 'VOID' ? null : row.days_left,
          state:
            row.status === 'VOID'
              ? `Dropped — ${row.void_reason ?? 'no reason given'}`
              : `${coverageLabel(coverage)} · ${daysLeftLabel(row.days_left)}`,
          claim: row.claim ? `${row.claim.claim_no} · ${claimStatusLabel(row.claim.status)}` : '—',
          // Carried for the row click rather than shown: a table is for reading.
          sale_id: row.sale_id,
          invoice_no: row.invoice_no,
        }
      }

      function drawRegister(): void {
        if (!page) {
          mount(registerHost)
          return
        }

        const searchBox = input({
          type: 'search',
          value: search,
          placeholder: 'Unit number, invoice, customer or telephone',
          leadingIcon: 'search',
          onEnter: (value) => {
            search = value
            offset = 0
            void load()
          },
        })
        searchBox.addEventListener('change', () => {
          search = searchBox.value
          offset = 0
          void load()
        })

        mount(
          registerHost,
          card(
            cardHeader('The register', {
              subtitle:
                page.total === 0
                  ? 'No promises to show.'
                  : `${page.total} promise${page.total === 1 ? '' : 's'}${
                      search.trim() ? ` matching “${search.trim()}”` : ''
                    }`,
              iconName: 'fact_check',
            }),
            h(
              'div',
              { class: 'flex flex-wrap items-end gap-2' },
              h(
                'div',
                { class: 'w-full sm:w-72' },
                field(
                  'Show',
                  select({
                    value: scope,
                    options: SCOPE_FILTERS,
                    onChange: (value) => {
                      scope = value
                      offset = 0
                      void load()
                    },
                  })
                )
              ),
              h('div', { class: 'flex-1 min-w-56' }, searchBox),
              search.trim() !== ''
                ? button('Clear', {
                    size: 'sm',
                    variant: 'ghost',
                    icon: 'close',
                    onClick: () => {
                      search = ''
                      offset = 0
                      void load()
                    },
                  })
                : null
            ),
            registerTable()
          )
        )
      }

      function drawClaims(): void {
        if (!claims) {
          mount(claimsHost)
          return
        }

        const claimSearchBox = input({
          type: 'search',
          value: claimSearch,
          placeholder: 'Slip number, product or what was reported',
          leadingIcon: 'search',
          onEnter: (value) => {
            claimSearch = value
            claimOffset = 0
            void load()
          },
        })
        claimSearchBox.addEventListener('change', () => {
          claimSearch = claimSearchBox.value
          claimOffset = 0
          void load()
        })

        mount(
          claimsHost,
          card(
            cardHeader('Claims', {
              subtitle:
                claims.total === 0
                  ? 'No claims in this filter.'
                  : `${claims.total} claim${claims.total === 1 ? '' : 's'} · ${
                      claims.rows.filter((row) => row.status !== 'CLOSED').length
                    } on this page not finished`,
              iconName: 'build',
              actions: [
                badge(
                  moneyLabel(
                    claims.rows.reduce((total, row) => total + row.cost_minor, 0),
                    currency
                  ),
                  { tone: 'neutral', iconName: 'payments' }
                ),
              ],
            }),
            h(
              'div',
              { class: 'flex flex-wrap items-end gap-2' },
              h(
                'div',
                { class: 'w-full sm:w-56' },
                field(
                  'Show',
                  select({
                    value: claimFilter,
                    options: CLAIM_FILTERS,
                    onChange: (value) => {
                      claimFilter = value
                      claimOffset = 0
                      void load()
                    },
                  })
                )
              ),
              h('div', { class: 'flex-1 min-w-56' }, claimSearchBox)
            ),
            dataTable({
              columns: [
                { key: 'claim_no', label: 'Slip', type: 'text' },
                { key: 'opened', label: 'Reported', type: 'date' },
                { key: 'product', label: 'Product', type: 'text' },
                { key: 'unit', label: 'Unit', type: 'text' },
                { key: 'customer', label: 'Customer', type: 'text' },
                { key: 'state', label: 'State', type: 'text' },
                { key: 'days', label: 'Days open', type: 'int', align: 'right' },
                { key: 'cost', label: 'Cost', type: 'money', align: 'right' },
              ],
              rows: claims.rows.map((row) => claimCells(row)),
              currency: currency,
              emptyTitle: 'No claims here',
              emptyDescription:
                'A claim is opened from the unit it belongs to — find it in the register above, or on the sale itself.',
              onRowClick: (cells) => {
                const saleId = String(cells.sale_id ?? '')
                if (saleId !== '') openSaleCard(saleId, String(cells.claim_no ?? ''))
              },
            }),
            claims.total > 0
              ? pagination({
                  offset: claims.offset,
                  limit: claims.limit,
                  totalRows: claims.total,
                  onPage: (next) => {
                    claimOffset = next
                    void load()
                  },
                })
              : null
          )
        )
      }

      void load()
      return body
    },
  }
}

function claimCells(row: ClaimRow): Record<string, string | number | null> {
  return {
    claim_no: row.claim_no,
    opened: row.opened_on,
    product: row.product_name,
    unit: unitLabel(row),
    customer: row.customer ?? 'walk-in',
    state:
      claimStatusLabel(row.status) +
      (row.closed_on ? ` ${row.closed_on}` : '') +
      (row.issue ? ` · ${row.issue}` : ''),
    days: row.days_open,
    cost: row.cost_minor,
    sale_id: row.sale_id,
    warranty_id: row.warranty_id,
  }
}

function loadingRow(message: string): HTMLElement {
  return h(
    'div',
    { class: 'flex items-center gap-2 p-3 text-sm text-content-muted' },
    spinner(),
    h('span', { text: message })
  )
}
