/**
 * Reports (spec §23).
 *
 * One screen for eleven reports. The library is on the left (a select on a
 * phone), the filters in a bar above the table, and everything the table shows
 * — columns, rows, totals, row count — arrives from the server in one call.
 *
 * Why one screen rather than eleven: eleven screens means eleven places to fix
 * a formatting bug, eleven chances for one report to sort differently, and
 * eleven exports. Here the report *is* a row in a catalogue, and adding the
 * twelfth is a migration, not a feature.
 *
 * The screen keeps its state in the URL (`#/reports?report=profit&period=month`),
 * so a link from the dashboard's answer cards lands on the right report, and
 * the back button returns to the report the owner was reading.
 */

import { h, icon, mount } from '../../components/ui/h'
import { button, iconButton } from '../../components/ui/button'
import { badge, emptyState, skeleton } from '../../components/ui/card'
import { input, field, searchInput, select } from '../../components/ui/input'
import { dataTable } from '../../components/ui/table'
import { pagination } from '../../components/ui/pagination'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { getRepositories } from '../../app/data'
import { salesFloor } from '../../app/state/sales-floor'
import { formatMoney, minor, type Minor } from '../../shared/domain/money'
import { translateError } from '../../app/platform/errors'
import { exportReportCsv, printReport, exportReportPdf } from './report-export'
import type {
  ReportColumn,
  ReportResult,
  ReportSummary,
} from '../../shared/repositories/contracts'

export interface ReportsViewOptions {
  /** From the URL: `#/reports?report=profit`. */
  initialReport?: string | undefined
  initialPeriod?: string | undefined
  initialSearch?: string | undefined
  initiallyOwing?: boolean | undefined
}

const PERIODS: { id: string; label: string }[] = [
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom' },
]

/** Reports where "show only rows with an outstanding balance" is meaningful. */
const OWING_REPORTS = new Set(['customer', 'supplier'])
/** Reports where a stock-state filter is meaningful. */
const STOCK_FILTER_REPORTS = new Set(['inventory'])

const ROW_LIMIT_CEILING = 50_000

export function reportsView(options: ReportsViewOptions = {}): HTMLElement {
  const repos = getRepositories()

  let catalog: ReportSummary[] = []
  let reportKey = options.initialReport ?? 'sales'
  let period = options.initialPeriod ?? 'month'
  let from = ''
  let to = ''
  let search = options.initialSearch ?? ''
  let sort = ''
  let dir: 'asc' | 'desc' = 'desc'
  let limit = 25
  let offset = 0
  let owing = options.initiallyOwing ?? false
  let stockState = ''
  let result: ReportResult | null = null
  let loading = false

  const root = h('div', { class: 'flex h-full min-h-0 flex-col' })
  const librarySlot = h('div', { class: 'hidden w-64 shrink-0 overflow-y-auto border-r border-border p-3 lg:block' })
  const controlsSlot = h('div', { class: 'space-y-3 border-b border-border p-3' })
  const bodySlot = h('div', { class: 'min-h-0 flex-1 overflow-y-auto' })

  // ── The report library ───────────────────────────────────────────────
  function renderLibrary(): void {
    const groups = new Map<string, ReportSummary[]>()
    for (const report of catalog) {
      const list = groups.get(report.group) ?? []
      list.push(report)
      groups.set(report.group, list)
    }

    mount(
      librarySlot,
      h('p', { class: 'mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-content-subtle', text: 'Reports' }),
      ...[...groups.entries()].map(([group, reports]) =>
        h(
          'div',
          { class: 'mb-3' },
          h('p', { class: 'mb-1 px-1 text-xs font-medium text-content-muted', text: group }),
          h(
            'div',
            { class: 'space-y-0.5' },
            ...reports.map((report) =>
              h(
                'button',
                {
                  type: 'button',
                  class:
                    'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ' +
                    (report.key === reportKey
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-content hover:bg-surface-muted'),
                  onclick: () => {
                    if (report.key === reportKey) return
                    reportKey = report.key
                    offset = 0
                    sort = ''
                    dir = 'desc'
                    search = ''
                    owing = false
                    stockState = ''
                    renderLibrary()
                    void reload()
                  },
                },
                icon(report.key === reportKey ? 'assessment' : 'table_chart', 'text-base shrink-0'),
                h('span', { class: 'truncate', text: report.title })
              )
            )
          )
        )
      )
    )
  }

  // ── Filters and actions ──────────────────────────────────────────────
  function renderControls(): void {
    const report = catalog.find((entry) => entry.key === reportKey)
    const custom = period === 'custom'

    const fromInput = input({
      type: 'date',
      value: from,
      label: 'From',
      onChange: (value) => {
        from = value
        offset = 0
        void reload()
      },
    })
    const toInput = input({
      type: 'date',
      value: to,
      label: 'To',
      onChange: (value) => {
        to = value
        offset = 0
        void reload()
      },
    })

    mount(
      controlsSlot,
      h(
        'div',
        { class: 'flex flex-wrap items-center gap-2' },
        // Phone: the library is a select, because a 64-wide sidebar on a
        // 360px-wide screen leaves no room for the table.
        h(
          'div',
          { class: 'w-full lg:hidden' },
          field(
            undefined,
            select({
              value: reportKey,
              options: catalog.map((entry) => ({ value: entry.key, label: entry.title })),
              onChange: (value) => {
                reportKey = value
                offset = 0
                sort = ''
                search = ''
                renderLibrary()
                void reload()
              },
            })
          )
        ),
        h(
          'div',
          { class: 'flex flex-wrap items-center gap-1.5' },
          h(
            'div',
            { class: 'flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1' },
            ...PERIODS.map((entry) =>
              h(
                'button',
                {
                  type: 'button',
                  class:
                    'h-10 rounded-md px-2.5 text-xs font-medium ' +
                    (entry.id === period
                      ? 'bg-primary text-white'
                      : 'text-content-muted hover:bg-surface-muted'),
                  onclick: () => {
                    period = entry.id
                    offset = 0
                    renderControls()
                    void reload()
                  },
                },
                entry.label
              )
            )
          ),
          custom ? fromInput : null,
          custom ? toInput : null
        ),
        h(
          'div',
          { class: 'ml-auto flex flex-wrap items-center gap-1.5' },
          OWING_REPORTS.has(reportKey)
            ? button(owing ? 'Only balances' : 'All rows', {
                variant: owing ? 'primary' : 'secondary',
                icon: 'filter_alt',
                onClick: () => {
                  owing = !owing
                  offset = 0
                  renderControls()
                  void reload()
                },
              })
            : null,
          STOCK_FILTER_REPORTS.has(reportKey)
            ? select({
                value: stockState,
                options: [
                  { value: '', label: 'All stock' },
                  { value: 'low', label: 'Low or out of stock' },
                  { value: 'untracked', label: 'Untracked items' },
                ],
                onChange: (value) => {
                  stockState = value
                  offset = 0
                  void reload()
                },
              })
            : null,
          iconButton('refresh', 'Refresh', { onClick: () => void reload() }),
          button('CSV', { variant: 'secondary', icon: 'download', onClick: () => void doExport('csv') }),
          button('Print', { variant: 'secondary', icon: 'print', onClick: () => void doExport('print') }),
          button('PDF', { variant: 'secondary', icon: 'picture_as_pdf', onClick: () => void doExport('pdf') })
        )
      ),
      h(
        'div',
        { class: 'flex flex-wrap items-center gap-2' },
        h(
          'div',
          { class: 'w-full sm:max-w-xs' },
          searchInput('Search invoices, names, SKUs…', (value) => {
            search = value
            offset = 0
            void reload()
          })
        ),
        h('span', {
          class: 'text-xs text-content-subtle',
          text: search ? `Searching “${search}” in ${report?.title ?? reportKey}` : '',
        })
      ),
      report
        ? h('p', { class: 'text-xs text-content-muted', text: report.description })
        : null
    )
  }

  // ── The table ────────────────────────────────────────────────────────
  function renderBody(): void {
    if (loading) {
      mount(
        bodySlot,
        h(
          'div',
          { class: 'space-y-2 p-3' },
          ...Array.from({ length: 8 }, () => skeleton('h-9 w-full'))
        )
      )
      return
    }

    if (!result) {
      mount(bodySlot, emptyState('Report unavailable', { iconName: 'error' }))
      return
    }

    const columns: ReportColumn[] = result.columns
    const table = dataTable({
      columns,
      rows: result.rows,
      totals: result.totals,
      sort: result.sort,
      dir: result.dir,
      currency: result.currency,
      onSort: (key) => {
        if (sort === key) {
          dir = dir === 'asc' ? 'desc' : 'asc'
        } else {
          sort = key
          // A new column starts descending — biggest first is what a report is
        // usually read for — and a second click flips it.
        dir = 'desc'
        }
        offset = 0
        void reload()
      },
      emptyTitle: 'No rows for these filters',
      emptyDescription: 'Widen the period, clear the search, or check another report.',
    })

    mount(
      bodySlot,
      h(
        'div',
        { class: 'p-3' },
        h(
          'div',
          { class: 'mb-2 flex flex-wrap items-end justify-between gap-2' },
          h(
            'div',
            { class: 'min-w-0' },
            h('h2', { class: 'text-base font-semibold text-content', text: result.title }),
            h('p', {
              class: 'text-xs text-content-muted',
              text: `${result.label} · ${result.totalRows} row(s) · generated ${new Date(result.generatedAt || Date.now()).toLocaleTimeString()}`,
            })
          ),
          h(
            'div',
            { class: 'flex flex-wrap gap-1.5' },
            ...totalChips(result)
          )
        ),
        table,
        pagination({
          offset: result.offset,
          limit: result.limit,
          totalRows: result.totalRows,
          onPage: (next) => {
            offset = next
            void reload()
          },
          onLimit: (next) => {
            limit = next
            offset = 0
            void reload()
          },
        })
      )
    )
  }

  /** The headline totals of the filtered set, as chips above the table. */
  function totalChips(result: ReportResult): HTMLElement[] {
    const chips: HTMLElement[] = []
    for (const column of result.columns) {
      const value = result.totals[column.key]
      if (value === undefined) continue
      if (column.type === 'money') {
        chips.push(
          badge(`${column.label}: ${formatMoney(minor(Math.trunc(value)) as Minor, { currency: result.currency })}`, {
            tone: 'primary',
          })
        )
      } else if (column.type === 'qty' || column.type === 'int') {
        chips.push(badge(`${column.label}: ${new Intl.NumberFormat('en-IN').format(value)}`, { tone: 'neutral' }))
      }
    }
    return chips
  }

  // ── Loading and exporting ────────────────────────────────────────────
  function query(overrides: Partial<{ limit: number; offset: number }> = {}): Parameters<typeof repos.reports.run>[0] | null {
    const branchId = salesFloor()?.branchId
    if (!branchId) return null
    const filters: Record<string, string> = {}
    if (owing) filters.type = 'owing'
    if (stockState) filters.type = stockState

    return {
      branchId,
      report: reportKey,
      period,
      // A blank date is not a date: sending '' makes PostgREST reject the
      // request before the function runs ("invalid input syntax for type
      // date"), so the keys are only sent when the owner actually picked a
      // custom range.
      ...(period === 'custom' && from.trim() && to.trim() ? { from, to } : {}),
      search,
      sort,
      dir,
      limit: overrides.limit ?? limit,
      offset: overrides.offset ?? offset,
      filters,
    }
  }

  async function reload(): Promise<void> {
    if (loading) return
    loading = true
    renderBody()
    try {
      const request = query()
      if (!request) throw new Error('No branch is available for this user')
      result = await repos.reports.run(request)
      // `renderBody` draws the table only when it is not loading; the flag has
      // to be cleared *before* the render, or the finished report stays a
      // skeleton (the flag is cleared in `finally`, which runs after).
      loading = false
      renderBody()
    } catch (error) {
      result = null
      mount(
        bodySlot,
        emptyState('This report could not be loaded', {
          description: translateError(error).message,
          iconName: 'error',
        })
      )
    } finally {
      loading = false
    }
  }

  /**
   * Exports always use the whole filtered set, not the visible page.
   *
   * One extra fetch, with the ceiling raised, and the file carries every row
   * the filters match — which is what "export the report" means to the person
   * clicking it.
   */
  async function doExport(kind: 'csv' | 'print' | 'pdf'): Promise<void> {
    try {
      const request = query({ limit: ROW_LIMIT_CEILING, offset: 0 })
      if (!request) throw new Error('No branch is available for this user')
      const full = await repos.reports.run(request)

      if (kind === 'csv') {
        const written = exportReportCsv(full)
        if (written.ok) {
          toastSuccess(`Exported ${full.rows.length} row(s) to CSV`)
        } else {
          toastError(written.reason ?? 'The file could not be saved')
        }
        return
      }

      const printed = kind === 'print' ? printReport(full) : exportReportPdf(full)
      if (printed.ok) {
        toastSuccess(
          kind === 'print'
            ? 'Print view opened'
            : 'Choose “Save as PDF” in the print dialog'
        )
      } else {
        toastError(printed.reason ?? 'The print window could not be opened')
      }
    } catch (error) {
      toastError(translateError(error).message)
    }
  }

  return (() => {
    root.append(
      h(
        'div',
        { class: 'flex min-h-0 flex-1' },
        librarySlot,
        h('div', { class: 'flex min-w-0 flex-1 flex-col' }, controlsSlot, bodySlot)
      )
    )
    mount(bodySlot, h('div', { class: 'p-3' }, skeleton('h-9 w-full')))
    void (async () => {
      try {
        catalog = await repos.reports.catalog()
        if (!catalog.some((entry) => entry.key === reportKey)) {
          reportKey = catalog[0]?.key ?? 'sales'
        }
        renderLibrary()
        renderControls()
        await reload()
      } catch (error) {
        mount(
          bodySlot,
          emptyState('The report library could not be loaded', {
            description: translateError(error).message,
            iconName: 'error',
          })
        )
      }
    })()
    return root
  })()
}
