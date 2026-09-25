/**
 * Charts (spec §21, §22, §38).
 *
 * Hand-drawn SVG rather than a charting library. Three reasons, in order of
 * how much they matter here:
 *
 *   1. A POS on a shop tablet, over a phone hotspot, should not carry 200 KB
 *      of charting runtime to draw thirty bars. This file is a few kilobytes
 *      and adds nothing to the dependency list that an offline Android build
 *      would then have to ship.
 *   2. The charts must read from the analytics engine's own numbers, so the
 *      question "why does the bar say 12,400 and the table 12,300?" never
 *      arises. A library would want its own data shape; this takes the one we
 *      already have.
 *   3. Money is integer minor units in this codebase. Formatting a bar's
 *      label through the same `formatMoney` the rest of the app uses is a line
 *      of code, not an adapter.
 *
 * Every chart renders as a single `<svg>` with a viewBox, so it scales to the
 * container on a phone without a resize listener.
 */

import { h, type Child } from './h'
import { formatMoney, minor, type Minor } from '../../shared/domain/money'

export interface ChartDatum {
  label: string
  value: number
  /** Set when `value` is money in minor units, so the axis and labels format it. */
  money?: boolean
  /** Optional comparison value, drawn as a ghost behind the bar or a second line. */
  compare?: number | undefined
}

export interface ChartOptions {
  height?: number
  money?: boolean
  currency?: string
  /** Cap on how many bars/points to draw; the rest are summarised as "…". */
  maxPoints?: number
  /** Highlight index, e.g. the selected point on the analytics screen. */
  highlight?: number
  /** Value labels on the bars — off by default, on for rankings. */
  showValues?: boolean
  emptyMessage?: string
  ariaLabel?: string
}

const NS = 'http://www.w3.org/2000/svg'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Compact money for an axis: 1.2k rather than ৳1,200.00.
 *
 * Axis labels are read at a glance and a crowded axis is unreadable, so the
 * full precision belongs in the tooltip (the `title` element) instead.
 */
export function compactNumber(value: number, money = false, currency = 'BDT'): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const unit = money ? abs / 100 : abs
  if (unit >= 10_000_000) return `${sign}${currency === 'BDT' ? '' : ''}${(unit / 10_000_000).toFixed(1)}cr`
  if (unit >= 100_000) return `${sign}${(unit / 100_000).toFixed(1)}L`
  if (unit >= 1000) return `${sign}${(unit / 1000).toFixed(unit >= 10_000 ? 0 : 1)}k`
  if (money) return `${sign}${unit.toFixed(0)}`
  return `${sign}${unit}`
}

function formatValue(value: number, options: ChartOptions): string {
  return options.money
    ? formatMoney(minor(Math.trunc(value)) as Minor, { currency: options.currency ?? 'BDT' })
    : new Intl.NumberFormat('en-IN').format(value)
}

/** Wraps raw SVG markup in an element that scales and carries an aria label. */
function svgElement(markup: string, options: ChartOptions, width: number): HTMLDivElement {
  const height = options.height ?? 160
  const holder = h('div', { class: 'w-full' })
  holder.innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" ` +
    `aria-label="${escapeXml(options.ariaLabel ?? 'chart')}" ` +
    `class="block w-full" style="height:${height}px">${markup}</svg>`
  return holder
}

/**
 * Vertical bars — the shape for a time series (takings by day).
 *
 * The compare value draws as a hollow bar behind the solid one, which is how
 * "this month against last" reads at a glance without a legend.
 */
export function barChart(data: readonly ChartDatum[], options: ChartOptions = {}): HTMLElement {
  if (data.length === 0) return emptyChart(options)

  const width = 640
  const height = options.height ?? 160
  const padding = { top: 12, right: 8, bottom: 22, left: 34 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const points = data.slice(-(options.maxPoints ?? 31))
  const max = Math.max(
    ...points.map((point) => Math.max(point.value, point.compare ?? 0)),
    0
  )
  const scale = max > 0 ? plotHeight / max : 0
  const slot = plotWidth / points.length
  const barWidth = Math.max(2, Math.min(slot * 0.62, 26))

  const bars: string[] = []
  points.forEach((point, index) => {
    const centre = padding.left + slot * index + slot / 2
    const x = centre - barWidth / 2
    const value = point.value
    const barHeight = Math.max(value > 0 ? 2 : 0, value * scale)
    const y = padding.top + plotHeight - barHeight
    const title = `${point.label}: ${formatValue(value, options)}`

    if (point.compare !== undefined && point.compare > 0) {
      const compareHeight = Math.max(2, point.compare * scale)
      const compareY = padding.top + plotHeight - compareHeight
      bars.push(
        `<rect x="${(x - 2).toFixed(1)}" y="${compareY.toFixed(1)}" width="${(barWidth + 4).toFixed(1)}" ` +
          `height="${compareHeight.toFixed(1)}" rx="2" fill="currentColor" opacity="0.12"></rect>`
      )
    }

    bars.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" ` +
        `height="${barHeight.toFixed(1)}" rx="2" fill="currentColor" ` +
        `opacity="${options.highlight === undefined || options.highlight === index ? 0.85 : 0.35}">` +
        `<title>${escapeXml(title)}</title></rect>`
    )
  })

  // Three gridlines: zero, half, max. More than that is noise on a phone.
  const gridlines = [0, 0.5, 1].map((fraction) => {
    const y = padding.top + plotHeight - plotHeight * fraction
    const label = compactNumber(max * fraction, options.money, options.currency)
    return (
      `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" ` +
      `stroke="currentColor" stroke-width="1" opacity="0.12"></line>` +
      `<text x="${padding.left - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" ` +
      `fill="currentColor" opacity="0.6">${escapeXml(label)}</text>`
    )
  })

  // Label every nth bar so the axis stays legible on a narrow screen.
  const step = Math.max(1, Math.ceil(points.length / 7))
  const axisLabels = points
    .map((point, index) => {
      if (index % step !== 0 && index !== points.length - 1) return ''
      const centre = padding.left + slot * index + slot / 2
      return (
        `<text x="${centre.toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="9" ` +
        `fill="currentColor" opacity="0.6">${escapeXml(point.label)}</text>`
      )
    })
    .join('')

  return svgElement(
    `<g class="text-primary">${bars.join('')}${gridlines.join('')}</g>${axisLabels}`,
    options,
    width
  )
}

/**
 * Ranked horizontal bars — the shape for "top products", where the labels do
 * not fit under a vertical bar.
 */
export function rankedBars(data: readonly ChartDatum[], options: ChartOptions = {}): HTMLElement {
  if (data.length === 0) return emptyChart(options)

  const points = data.slice(0, options.maxPoints ?? 6)
  const max = Math.max(...points.map((point) => point.value), 0)
  const rowHeight = 26
  const width = 640
  const height = points.length * rowHeight + 8
  const labelWidth = 190
  const valueWidth = options.showValues === false ? 0 : 96
  const barSpace = width - labelWidth - valueWidth - 8

  const rows = points.map((point, index) => {
    const y = index * rowHeight + 4
    const barWidth = max > 0 ? Math.max(2, (point.value / max) * barSpace) : 0
    const title = `${point.label}: ${formatValue(point.value, options)}`
    return (
      `<text x="0" y="${y + 15}" font-size="11" fill="currentColor" opacity="0.85">` +
        `${escapeXml(point.label.length > 26 ? `${point.label.slice(0, 25)}…` : point.label)}</text>` +
      `<rect x="${labelWidth}" y="${y + 4}" width="${barSpace}" height="14" rx="3" ` +
        `fill="currentColor" opacity="0.08"></rect>` +
      `<rect x="${labelWidth}" y="${y + 4}" width="${barWidth.toFixed(1)}" height="14" rx="3" ` +
        `fill="currentColor" opacity="${options.highlight === undefined || options.highlight === index ? 0.8 : 0.4}">` +
        `<title>${escapeXml(title)}</title></rect>` +
      (valueWidth > 0
        ? `<text x="${width}" y="${y + 15}" text-anchor="end" font-size="11" font-weight="600" ` +
          `fill="currentColor">${escapeXml(formatValue(point.value, options))}</text>`
        : '')
    )
  })

  return svgElement(`<g class="text-primary">${rows.join('')}</g>`, { ...options, height }, width)
}

/**
 * A line with a soft area under it — the profit trend.
 *
 * `compare` draws as a dashed second line, so the two series are compared
 * without a legend occupying the plot.
 */
export function lineChart(data: readonly ChartDatum[], options: ChartOptions = {}): HTMLElement {
  if (data.length === 0) return emptyChart(options)

  const width = 640
  const height = options.height ?? 160
  const padding = { top: 12, right: 8, bottom: 22, left: 34 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const points = data.slice(-(options.maxPoints ?? 31))
  const max = Math.max(...points.map((point) => Math.max(point.value, point.compare ?? 0)), 0)
  const min = Math.min(...points.map((point) => Math.min(point.value, point.compare ?? point.value, 0)), 0)
  const span = max - min || 1
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0

  const toXY = (value: number, index: number): [number, number] => [
    padding.left + stepX * index,
    padding.top + plotHeight - ((value - min) / span) * plotHeight,
  ]

  const path = points
    .map((point, index) => {
      const [x, y] = toXY(point.value, index)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const area =
    `${path} L${(padding.left + stepX * (points.length - 1)).toFixed(1)},${(padding.top + plotHeight).toFixed(1)} ` +
    `L${padding.left.toFixed(1)},${(padding.top + plotHeight).toFixed(1)} Z`

  const comparePath = points.some((point) => point.compare !== undefined)
    ? points
        .map((point, index) => {
          const [x, y] = toXY(point.compare ?? 0, index)
          return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
        })
        .join(' ')
    : ''

  const dots = points
    .map((point, index) => {
      const [x, y] = toXY(point.value, index)
      return (
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="currentColor">` +
        `<title>${escapeXml(`${point.label}: ${formatValue(point.value, options)}`)}</title></circle>`
      )
    })
    .join('')

  const zeroLine =
    min < 0
      ? (() => {
          const y = padding.top + plotHeight - ((0 - min) / span) * plotHeight
          return `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" stroke="currentColor" stroke-width="1" opacity="0.25"></line>`
        })()
      : ''

  const step = Math.max(1, Math.ceil(points.length / 7))
  const axisLabels = points
    .map((point, index) => {
      if (index % step !== 0 && index !== points.length - 1) return ''
      const [x] = toXY(point.value, index)
      return `<text x="${x.toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">${escapeXml(point.label)}</text>`
    })
    .join('')

  const gridlines = [0, 0.5, 1].map((fraction) => {
    const y = padding.top + plotHeight - plotHeight * fraction
    return (
      `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" ` +
      `stroke="currentColor" stroke-width="1" opacity="0.12"></line>` +
      `<text x="${padding.left - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" ` +
      `fill="currentColor" opacity="0.6">${escapeXml(compactNumber(min + span * fraction, options.money, options.currency))}</text>`
    )
  })

  return svgElement(
    `<g class="text-primary">` +
      `<path d="${area}" fill="currentColor" opacity="0.08"></path>` +
      (comparePath ? `<path d="${comparePath}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.4"></path>` : '') +
      `<path d="${path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>` +
      `${dots}${gridlines.join('')}${zeroLine}</g>${axisLabels}`,
    options,
    width
  )
}

export interface DonutSegment {
  label: string
  value: number
}

/**
 * Payment mix: a donut, because the parts are shares of one whole — the day's
 * takings — and the reader's question is "how much of it was cash?".
 */
export function donutChart(
  segments: readonly DonutSegment[],
  options: ChartOptions = {}
): HTMLElement {
  const positive = segments.filter((segment) => segment.value > 0)
  if (positive.length === 0) return emptyChart(options)

  const total = positive.reduce((sum, segment) => sum + segment.value, 0)
  const size = 180
  const radius = 70
  const thickness = 26
  const centre = size / 2
  // Slate → teal → amber … fixed order, so the same method keeps the same
  // colour between the dashboard and the analytics screen.
  const colours = ['#0f766e', '#f59e0b', '#6366f1', '#ef4444', '#14b8a6', '#8b5cf6']

  let angle = -Math.PI / 2
  const arcs = positive.map((segment, index) => {
    const share = segment.value / total
    const sweep = share * Math.PI * 2
    const start = angle
    const end = angle + sweep
    angle = end

    // A full circle cannot be drawn as one arc; nudge the end point instead.
    const largeArc = sweep > Math.PI ? 1 : 0
    const x1 = centre + radius * Math.cos(start)
    const y1 = centre + radius * Math.sin(start)
    const x2 = centre + radius * Math.cos(end - (sweep >= Math.PI * 2 ? 0.0001 : 0))
    const y2 = centre + radius * Math.sin(end - (sweep >= Math.PI * 2 ? 0.0001 : 0))
    const colour = colours[index % colours.length] ?? '#0f766e'

    return (
      `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" ` +
      `fill="none" stroke="${colour}" stroke-width="${thickness}" stroke-linecap="butt">` +
      `<title>${escapeXml(
        `${segment.label}: ${formatValue(segment.value, { ...options, money: true })} (${(share * 100).toFixed(1)}%)`
      )}</title></path>`
    )
  })

  const label = options.money === false ? '' : formatValue(total, { ...options, money: true })

  const holder = h('div', { class: 'flex flex-wrap items-center justify-center gap-4' })
  const svgHolder = h('div', { class: 'shrink-0' })
  svgHolder.innerHTML =
    `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" ` +
    `aria-label="${escapeXml(options.ariaLabel ?? 'share of total')}">${arcs.join('')}` +
    `<text x="${centre}" y="${centre - 2}" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor">${escapeXml(label)}</text>` +
    `<text x="${centre}" y="${centre + 14}" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">total</text>` +
    `</svg>`

  const legend = h(
    'div',
    { class: 'min-w-40 flex-1 space-y-1.5' },
    ...positive.map((segment, index) =>
      h(
        'div',
        { class: 'flex items-center justify-between gap-3 text-xs' },
        h(
          'span',
          { class: 'flex min-w-0 items-center gap-2' },
          h('span', {
            class: 'h-2.5 w-2.5 shrink-0 rounded-full',
            style: { backgroundColor: colours[index % colours.length] ?? '#0f766e' },
          }),
          h('span', { class: 'truncate text-content-muted', text: segment.label })
        ),
        h('span', {
          class: 'shrink-0 font-medium tabular-nums text-content',
          text: `${((segment.value / total) * 100).toFixed(0)}%`,
        })
      )
    )
  )

  holder.append(svgHolder, legend)
  return holder
}

function emptyChart(options: ChartOptions): HTMLDivElement {
  return h(
    'div',
    {
      class: 'flex items-center justify-center rounded-md border border-dashed border-border py-10',
    },
    h('p', { class: 'text-xs text-content-subtle', text: options.emptyMessage ?? 'No data for this period yet' })
  )
}

/**
 * A sparkline: the trend of one number, with no axis and no labels.
 *
 * On a widget tile it answers "is this going up?" in a glance, which is all a
 * tile has room for; the full chart is one tap away.
 */
export function sparkline(values: readonly number[], options: { class?: string } = {}): HTMLDivElement {
  const width = 120
  const height = 32
  const holder = h('div', { class: options.class ?? 'w-24' })

  if (values.length < 2) {
    holder.innerHTML = ''
    return holder
  }

  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const stepX = width / (values.length - 1)
  const path = values
    .map((value, index) => {
      const x = index * stepX
      const y = height - ((value - min) / span) * (height - 4) - 2
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  holder.innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" class="block h-8 w-full text-primary" ` +
    `preserveAspectRatio="none" aria-hidden="true">` +
    `<path d="${path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path></svg>`
  return holder
}

/** Chart in a labelled card, the form every dashboard chart takes. */
export function chartCard(options: {
  title: string
  subtitle?: string
  iconName?: string
  actions?: Child | Child[]
  body: Child
  class?: string
}): HTMLElement {
  return h(
    'div',
    { class: `rounded-lg border border-border bg-surface p-4 ${options.class ?? ''}`.trim() },
    h(
      'div',
      { class: 'mb-2 flex items-start justify-between gap-2' },
      h(
        'div',
        { class: 'min-w-0' },
        h('h3', { class: 'text-sm font-semibold text-content', text: options.title }),
        options.subtitle
          ? h('p', { class: 'mt-0.5 text-xs text-content-muted', text: options.subtitle })
          : null
      ),
      options.actions
        ? h('div', { class: 'flex shrink-0 items-center gap-1.5' }, ...(Array.isArray(options.actions) ? options.actions : [options.actions]))
        : null
    ),
    options.body
  )
}

/** Kept for callers that need the namespace (e.g. tests building SVG). */
export const SVG_NS = NS
