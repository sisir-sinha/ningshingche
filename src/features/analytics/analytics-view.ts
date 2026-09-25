/**
 * Analytics (spec §22).
 *
 * The framework made visible: pick a measure, pick a dimension, pick a period,
 * and see the same number the dashboard shows for that slice — because it is
 * the same engine answering both (see migration 028).
 *
 * The screen is deliberately three controls and one result. A shop owner does
 * not want a query builder; they want "takings by category this month" in two
 * taps, and then the comparison against last month, which is the part that
 * turns a number into a decision.
 *
 * The pickers are built from `analytics_catalog()`, so an unsupported
 * combination — "expenses by product" — is not offered rather than failing
 * when chosen.
 */

import { h, icon, mount } from '../../components/ui/h'
import { button } from '../../components/ui/button'
import { badge, emptyState, skeleton } from '../../components/ui/card'
import { input, field, select } from '../../components/ui/input'
import { barChart, lineChart, donutChart, chartCard } from '../../components/ui/chart'
import { dataTable } from '../../components/ui/table'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { getRepositories } from '../../app/data'
import { salesFloor } from '../../app/state/sales-floor'
import { formatMoney, minor, type Minor } from '../../shared/domain/money'
import { translateError } from '../../app/platform/errors'
import { toCsv } from '../../shared/export/csv'
import { downloadText } from '../../shared/export/download'
import type {
  AnalyticsCatalog,
  AnalyticsSlice,
  BiAnswer,
} from '../../shared/repositories/contracts'

export interface AnalyticsViewOptions {
  /** From the URL: `#/analytics?dimension=category&measure=takings`. */
  initialDimension?: string | undefined
  initialMeasure?: string | undefined
  initialPeriod?: string | undefined
  /** Answers are rendered above the slice, as on the dashboard. */
  showAnswers?: boolean
}

export function analyticsView(options: AnalyticsViewOptions = {}): HTMLElement {
  const repos = getRepositories()
  let catalog: AnalyticsCatalog | null = null
  let dimension = options.initialDimension ?? 'day'
  let measure = options.initialMeasure ?? 'takings'
  let period = options.initialPeriod ?? 'month'
  let from = ''
  let to = ''
  let slice: AnalyticsSlice | null = null
  let answers: BiAnswer[] = []
  let loading = false

  const root = h('div', { class: 'flex h-full min-h-0 flex-col' })
  const controlsSlot = h('div', { class: 'space-y-3 border-b border-border p-3' })
  const bodySlot = h('div', { class: 'min-h-0 flex-1 space-y-3 overflow-y-auto p-3' })

  const currency = () => slice?.currency ?? 'BDT'
  const money = (value: number): Minor => minor(Math.trunc(value))

  /** Dimensions that can be sliced by the chosen measure, in catalogue order. */
  function dimensionOptions(): { value: string; label: string }[] {
    if (!catalog) return []
    const allowed = new Set(
      catalog.combos.filter((combo) => combo.measure === measure).map((combo) => combo.dimension)
    )
    return catalog.dimensions
      .filter((entry) => allowed.has(entry.id))
      .map((entry) => ({ value: entry.id, label: `${entry.group} · ${entry.label}` }))
  }

  function measureOptions(): { value: string; label: string }[] {
    if (!catalog) return []
    const allowed = new Set(
      catalog.combos.filter((combo) => combo.dimension === dimension).map((combo) => combo.measure)
    )
    return catalog.measures
      .filter((entry) => allowed.has(entry.id))
      .map((entry) => ({ value: entry.id, label: entry.label }))
  }

  function currentMeasure() {
    return catalog?.measures.find((entry) => entry.id === measure) ?? null
  }

  function currentDimension() {
    return catalog?.dimensions.find((entry) => entry.id === dimension) ?? null
  }

  function renderControls(): void {
    if (!catalog) return
    const measureMeta = currentMeasure()

    mount(
      controlsSlot,
      h(
        'div',
        { class: 'flex flex-wrap items-end gap-2' },
        h(
          'div',
          { class: 'min-w-40 flex-1' },
          field(
            'Measure',
            select({
              value: measure,
              options: measureOptions(),
              onChange: (value) => {
                measure = value
                renderControls()
                void reload()
              },
            })
          )
        ),
        h(
          'div',
          { class: 'min-w-40 flex-1' },
          field(
            'Sliced by',
            select({
              value: dimension,
              options: dimensionOptions(),
              onChange: (value) => {
                dimension = value
                renderControls()
                void reload()
              },
            })
          )
        ),
        h(
          'div',
          { class: 'flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1' },
          ...(catalog.periods.map((entry) =>
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
                  renderControls()
                  void reload()
                },
              },
              entry.label
            )
          ) as HTMLElement[])
        ),
        period === 'custom'
          ? input({
              type: 'date',
              label: 'From',
              value: from,
              onChange: (value) => {
                from = value
                void reload()
              },
            })
          : null,
        period === 'custom'
          ? input({
              type: 'date',
              label: 'To',
              value: to,
              onChange: (value) => {
                to = value
                void reload()
              },
            })
          : null,
        button('CSV', {
          variant: 'secondary',
          icon: 'download',
          class: 'shrink-0',
          onClick: () => exportCsv(),
        })
      ),
      h('p', {
        class: 'text-xs text-content-muted',
        text: measureMeta?.description ?? 'Pick a measure to see what it means.',
      })
    )
  }

  function renderSlice(): void {
    if (loading) {
      mount(
        bodySlot,
        h('div', { class: 'space-y-2' }, ...Array.from({ length: 4 }, () => skeleton('h-24 w-full')))
      )
      return
    }
    if (!slice) {
      mount(bodySlot, emptyState('Nothing to analyse yet', { iconName: 'monitoring' }))
      return
    }

    const current = slice
    const isTime = currentDimension()?.kind === 'time'
    const points = current.series
    const chartData = points.map((point) => ({
      label: point.label,
      value: point.value,
      compare: current.totals ? point.prev : undefined,
    }))

    const cards: HTMLElement[] = []

    // ── Headline: this period against the previous one ──────────────────
    if (current.totals) {
      const totals = current.totals
      const delta = totals.deltaPct
      const up = delta !== null && delta >= 0
      cards.push(
        h(
          'div',
          { class: 'rounded-lg border border-border bg-surface p-4' },
          h(
            'div',
            { class: 'flex flex-wrap items-end justify-between gap-3' },
            h(
              'div',
              null,
              h('p', { class: 'text-xs font-medium text-content-muted', text: `${label()}, ${slice.label}` }),
              h('p', {
                class: 'mt-1 text-3xl font-semibold tabular-nums tracking-tight text-content',
                text: current.money
                  ? formatMoney(money(totals.value), { currency: currency() })
                  : new Intl.NumberFormat('en-IN').format(totals.value),
              }),
              h('p', {
                class: 'mt-1 text-xs text-content-muted',
                text:
                  totals.prev === null
                    ? 'no comparison period'
                    : `${current.money ? formatMoney(money(totals.prev), { currency: currency() }) : new Intl.NumberFormat('en-IN').format(totals.prev)} in the previous ${current.period}`,
              })
            ),
            h(
              'div',
              { class: 'flex shrink-0 items-center gap-2' },
              delta === null
                ? null
                : badge(`${up ? '+' : ''}${delta.toFixed(1)}% vs previous`, {
                    tone: up ? 'success' : 'danger',
                    iconName: up ? 'trending_up' : 'trending_down',
                  }),
              badge(periodLabel(current.period), { tone: 'neutral', iconName: 'event' })
            )
          )
        )
      )
    }

    // ── The Bestseller question: "who are the best sellers?"
    if (isTime) {
      cards.push(
        chartCard({
          title: `${label()} by ${currentDimension()?.label.toLowerCase() ?? 'day'}`,
          ...(current.money
            ? { subtitle: 'Solid bars are this period; faint bars are the period before.' }
            : {}),
          body: barChart(chartData, {
            money: current.money,
            currency: currency(),
            ariaLabel: `${label()} by ${dimension}`,
          }),
        })
      )
    } else {
      cards.push(
        chartCard({
          title: label(),
          subtitle: `Top ${Math.min(points.length, 6)} of ${points.length} by ${current.dimension.replace(/_/g, ' ')}`,
          body: (() => {
            const data = points.slice(0, 6).map((point) => ({ label: point.label, value: point.value }))
            return highestShare(data) >= 0.6
              ? donutChart(data, { money: current.money, currency: currency(), ariaLabel: `${label()} share` })
              : barChart(data, {
                  money: current.money,
                  currency: currency(),
                  height: 60 + data.length * 26,
                  ariaLabel: `${label()} by ${dimension}`,
                })
          })(),
        })
      )
    }

    // ── Profit trend reads better as a line than as bars ────────────────
    if (isTime && measure === 'profit') {
      cards.push(
        chartCard({
          title: 'Profit trend',
          subtitle: 'The line that decides whether the month is working.',
          body: lineChart(chartData, { money: true, currency: currency(), ariaLabel: 'Profit trend' }),
        })
      )
    }

    // ── Every point, sortable and exportable ────────────────────────────
    cards.push(
      h(
        'div',
        null,
        dataTable({
          columns: [
            { key: 'label', label: currentDimension()?.label ?? 'Slice', type: 'text' },
            { key: 'value', label: label(), type: current.money ? 'money' : 'qty', align: 'right' },
            {
              key: 'secondary',
              label: current.measure === 'orders' ? 'Takings (৳)' : 'Orders',
              type: current.measure === 'orders' ? 'money' : 'qty',
              align: 'right',
            },
            {
              key: 'prev',
              label: `Previous ${current.period}`,
              type: current.money ? 'money' : 'qty',
              align: 'right',
            },
            { key: 'change', label: 'Change', type: 'percent', align: 'right' },
          ],
          rows: points.map((point) => ({
            label: point.label,
            value: point.value,
            secondary:
              current.measure === 'orders'
                ? toMinorLike(point.secondary)
                : point.secondary,
            prev: point.prev,
            change: point.prev > 0 ? ((point.value - point.prev) / point.prev) * 100 : 0,
          })),
          totals: current.totals
            ? { value: current.totals.value, secondary: current.totals.secondary, prev: current.totals.prev ?? 0 }
            : undefined,
          currency: currency(),
          emptyTitle: 'No rows for this slice',
          emptyDescription: 'Try another period — this one has no activity in it.',
        })
      )
    )

    // ── The morning questions, answered from the same engine ────────────
    if (options.showAnswers !== false && answers.length > 0) {
      cards.push(answersPanel(answers))
    }

    mount(bodySlot, ...cards)
  }

  /** The measure's own label, e.g. "Takings". */
  function label(): string {
    return measureLabel(slice?.measure ?? measure)
  }

  function measureLabel(id: string): string {
    return catalog?.measures.find((entry) => entry.id === id)?.label ?? id
  }

  /** Orders slices carry takings in `secondary`; both are minor units. */
  function toMinorLike(value: number): number {
    return minor(Math.trunc(value))
  }

  function periodLabel(id: string): string {
    return catalog?.periods.find((entry) => entry.id === id)?.label ?? id
  }

  function highestShare(data: readonly { value: number }[]): number {
    const total = data.reduce((sum, entry) => sum + entry.value, 0)
    const top = data.reduce((max, entry) => Math.max(max, entry.value), 0)
    return total > 0 ? top / total : 0
  }

  async function reload(): Promise<void> {
    if (loading) return
    loading = true
    renderSlice()
    try {
      const branchId = salesFloor()?.branchId
      if (!branchId) throw new Error('No branch is available for this user')
      const [nextSlice, nextAnswers] = await Promise.all([
        repos.analytics.slice({
          branchId,
          dimension,
          measure,
          period,
          // Blank dates are omitted rather than sent as '' — same reason as
          // the reports screen: an empty string is not a valid date.
          ...(period === 'custom' && from.trim() && to.trim() ? { from, to } : {}),
        }),
        repos.analytics.answers({ branchId }),
      ])
      slice = nextSlice
      answers = nextAnswers
      // Clear the flag first: `renderSlice` shows the skeleton while loading,
      // and the `finally` below runs too late for the slice to be drawn.
      loading = false
      renderSlice()
    } catch (error) {
      slice = null
      mount(
        bodySlot,
        emptyState('That slice could not be computed', {
          description: translateError(error).message,
          iconName: 'error',
        })
      )
    } finally {
      loading = false
    }
  }

  function exportCsv(): void {
    if (!slice) {
      toastError('Nothing to export yet')
      return
    }
    const content = toCsv(
      [
        { key: 'label', label: currentDimension()?.label ?? 'Slice' },
        { key: 'value', label: label() },
        { key: 'prev', label: `Previous ${slice.period}` },
      ],
      slice.series.map((point) => ({
        label: point.label,
        value: point.value,
        prev: point.prev,
      })),
      { bom: true }
    )
    const written = downloadText(`${measure}-by-${dimension}-${slice.from}-to-${slice.to}.csv`, content)
    if (written.ok) toastSuccess('Slice exported to CSV')
    else toastError(written.reason ?? 'The file could not be saved')
  }

  return (() => {
    root.append(controlsSlot, bodySlot)
    mount(bodySlot, h('div', { class: 'space-y-2' }, skeleton('h-24 w-full'), skeleton('h-24 w-full')))
    void (async () => {
      try {
        catalog = await repos.analytics.catalog()
        if (!catalog.combos.some((combo) => combo.measure === measure && combo.dimension === dimension)) {
          const fallback = catalog.combos[0]
          if (fallback) {
            measure = fallback.measure
            dimension = fallback.dimension
          }
        }
        renderControls()
        await reload()
      } catch (error) {
        mount(
          bodySlot,
          emptyState('Analytics is unavailable', {
            description: translateError(error).message,
            iconName: 'error',
          })
        )
      }
    })()
    return root
  })()
}

/**
 * The §56 question list, rendered as cards.
 *
 * Shared by the dashboard and this screen on purpose: the questions are the
 * same questions, and two renderings would eventually answer them differently.
 */
export function answersPanel(answers: readonly BiAnswer[], currency = 'BDT'): HTMLElement {
  return h(
    'div',
    { class: 'rounded-lg border border-border bg-surface p-4' },
    h(
      'div',
      { class: 'mb-3 flex items-center gap-2' },
      icon('quiz', 'text-content-muted'),
      h('h3', { class: 'text-sm font-semibold text-content', text: 'What the owner asks' }),
      badge(`${answers.length} answered`, { tone: 'neutral' })
    ),
    h(
      'div',
      { class: 'grid gap-2 sm:grid-cols-2 xl:grid-cols-3' },
      ...answers.map((answer) =>
        h(
          'a',
          {
            href: `#${answer.link}`,
            class:
              'group flex flex-col gap-1 rounded-md border border-border p-3 hover:border-primary/40 hover:bg-primary/5',
          },
          h(
            'div',
            { class: 'flex items-start gap-2' },
            icon(answer.icon, 'text-content-muted text-base mt-0.5 shrink-0'),
            h('p', { class: 'text-xs font-medium text-content-muted', text: answer.question })
          ),
          h('p', {
            class: 'text-lg font-semibold tabular-nums text-content',
            text: answerText(answer, currency),
          }),
          h('p', { class: 'text-xs text-content-subtle', text: answer.note })
        )
      )
    )
  )
}

/** An answer as text: money from branded minor units, counts as numbers. */
export function answerText(answer: BiAnswer, currency = 'BDT'): string {
  if (answer.kind === 'money' && answer.amount !== null) {
    return formatMoney(answer.amount, { currency })
  }
  if ((answer.kind === 'count' || answer.kind === 'qty') && answer.count !== null) {
    return new Intl.NumberFormat('en-IN').format(answer.count)
  }
  return answer.value
}
