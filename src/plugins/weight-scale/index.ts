/**
 * Weighing scale — behaviour.
 *
 * The plugin for shops that sell by weight: a grocery, a butcher, a produce
 * stall, an oil shop. Its subject is not a product or a promise — it is *a code
 * that is not in the catalogue*. A scale label is printed per weighing, so it
 * can never be a row in the shop's barcode table, and before scan resolvers the
 * till had nowhere to ask what one meant. Everything here follows from reading
 * that label correctly:
 *
 *   · **The shop describes its own labels.** Two scales in one shop routinely
 *     print differently — five PLU digits here, four there — so a layout is
 *     data the shop owns (`plugins.config.formats`), not a constant. What is
 *     fixed is the meaning of the digits: a weight field is grams, a price field
 *     is minor units, and the PLU is matched exactly as the scale printed it.
 *
 *   · **The till decodes; the shop prices.** A resolver hands the core a code
 *     and a weight, and the core looks the code up in the same barcode table it
 *     has always used. So the label adds 2.350 kg of a product the shop really
 *     sells, at the shop's price, on a device that may be offline — and a plugin
 *     can never ring up something the catalogue does not have (spec §51).
 *
 *   · **Nothing is guessed.** A code that does not fit a layout returns `null`
 *     and the till does exactly what it did before this plugin existed. A
 *     resolver is asked about *every* code the shop's barcodes did not match, so
 *     over-eager recognition would break ordinary scanning — the worst bug a POS
 *     can have, because it would look like the scanner.
 *
 *   · **What cannot be read is looked at.** The reports answer the two questions
 *     a grocery cannot answer from the shelf: what left the shop by weight, and
 *     which of the items it sells by weight its own scale cannot ring up at all.
 *
 * This file imports nothing from `src/features/` and nothing from another
 * plugin. If adding it ever requires editing a feature, the architecture has
 * failed (spec §51).
 */

import { stat } from '../../components/ui/card'
import { h } from '../../components/ui/h'
import type {
  Plugin,
  PluginAPI,
  PluginPageModule,
  PluginReportResult,
  ReportRunContext,
  ScanContext,
  ScanMatch,
} from '../../shared/registry/plugin-types'
import {
  decodeLabel,
  formatsFromSettings,
  formatSummary,
  scanMatch,
  weightText,
  type LabelFormat,
} from './helpers'
import {
  DEFAULT_REPORT_LABEL_PRICE,
  FORMATS_KEY,
  REPORT_LABEL_PRICE_KEY,
  WEIGHT_SCALE_ID,
  WEIGHT_VIEW,
  weightScaleManifest,
} from './manifest'

// ── What the server gives back ─────────────────────────────────────────────

interface MovedRow {
  lines: number
  qty: number
}

interface Overview {
  month: MovedRow
  month_label: string
  today: MovedRow
  codes: { all: number; ready: number; attention: number; no_code: number; by_piece: number }
  layouts: number
  using_builtin: boolean
}

interface SalesRow {
  product_id: string
  product: string
  sku: string
  unit: string
  lines: number
  qty: number
  avg_qty: number
  value_minor: number
  margin_minor: number
}

interface SalesPage {
  rows: SalesRow[]
  total: number
  totals: { products: number; lines: number; qty: number; value_minor: number; margin_minor: number }
  label: string
}

type CodeStatus = 'ready' | 'whole_label' | 'other_code' | 'no_code' | 'by_piece'

interface CodeRow {
  variant_id: string
  product: string
  variant: string
  sku: string
  unit: string
  price_minor: number
  status: CodeStatus
  code: string
  use_code: string
  layout: string
}

interface CodePage {
  rows: CodeRow[]
  total: number
  totals: {
    all: number
    ready: number
    attention: number
    no_code: number
    by_piece: number
    other_code: number
    whole_label: number
  }
  formats: LabelFormat[]
}

/** How a shopkeeper reads a status, and why it costs them money. */
const STATUS_LABEL: Record<CodeStatus, string> = {
  ready: 'Ready',
  whole_label: 'Whole label entered',
  other_code: 'Code the scale cannot print',
  no_code: 'No code at all',
  by_piece: 'Sold by the piece',
}

const STATUS_NOTE: Record<CodeStatus, string> = {
  ready: 'Scanning a label finds this item.',
  whole_label:
    'A whole label was entered as the product’s code, so scanning finds it only when the scale prints that exact weight again. Keep the PLU part of the code instead.',
  other_code:
    'This code is not one the shop’s label layouts can print. Program the scale with this code, or the item entered for it.',
  no_code:
    'Nothing for the scale to print, so no label can ever ring this up. The cashier has to search for it by name.',
  by_piece:
    'A scale label would ring this up as one piece at the piece price — the only failure here that charges the wrong money.',
}

export const weightScalePlugin: Plugin = {
  id: WEIGHT_SCALE_ID,
  name: weightScaleManifest.name,
  version: weightScaleManifest.version,
  description: weightScaleManifest.description,
  ...(weightScaleManifest.icon ? { icon: weightScaleManifest.icon } : {}),

  register(api) {
    for (const permission of weightScaleManifest.permissions ?? []) {
      api.registerPermission({
        key: permission.key,
        label: permission.label,
        group: permission.group,
        ...(permission.description ? { description: permission.description } : {}),
      })
    }

    /** The layouts to read with, straight from settings on every scan. */
    function layouts(): LabelFormat[] {
      return formatsFromSettings(api.settings.get<unknown>(FORMATS_KEY, []))
    }

    // ── The till ────────────────────────────────────────────────────────
    // Asked about every code the shop's own barcodes did not match, so this
    // function has exactly two jobs: recognise what is ours, and be quiet about
    // everything else.
    api.registerScanResolver({
      id: 'weight-scale.scan',
      label: 'Weighing scale',
      resolve: (code: string, context: ScanContext): ScanMatch | null => {
        const decoded = decodeLabel(code, layouts())
        if (!decoded) return null

        if (decoded.kind === 'price') {
          // The label carries what the customer pays for that package, and the
          // core prices every line from the catalogue — so a price label cannot
          // be honoured without over- or under-charging. Refusing is the only
          // answer that cannot charge the wrong money; the shop sees the layout
          // and what it means in the plugin's screen (docs/10 §Phase 7).
          api.log.warn('a price label cannot be sold at the till yet', {
            code: code.trim(),
            price_minor: decoded.priceMinor,
          })
          return null
        }

        return scanMatch(decoded, {
          reportLabelPrice: api.settings.get<boolean>(
            REPORT_LABEL_PRICE_KEY,
            DEFAULT_REPORT_LABEL_PRICE
          ),
          currency: context.currency,
        })
      },
    })

    // ── Navigation, and the screen behind it ────────────────────────────
    api.registerNav({
      id: 'weight-scale',
      label: 'Weighing scale',
      icon: 'scale',
      section: 'inventory',
      route: '/plugins/weight-scale',
      permission: WEIGHT_VIEW,
      order: 44,
    })

    api.registerRoute({
      path: '/plugins/weight-scale',
      title: 'Weighing scale',
      permission: WEIGHT_VIEW,
      load: async (): Promise<PluginPageModule> => {
        const screen = await import('./labels-screen')
        return screen.createWeightScaleScreen({ settings: api.settings, db: api.db })
      },
    })

    // ── The dashboard tile ──────────────────────────────────────────────
    api.registerDashboardWidget({
      id: 'weight-scale.summary',
      title: 'Sold by weight',
      size: 'sm',
      permission: WEIGHT_VIEW,
      render: () => summaryTile(api),
    })

    // ── The reports ─────────────────────────────────────────────────────
    // "What left the shop by weight" belongs with the selling reports; "which
    // of my items can the scale not sell" belongs with the stock worklists,
    // because that is the drawer a shopkeeper opens when something needs doing.
    api.registerReport({
      id: 'sales',
      label: 'Weighed sales',
      icon: 'scale',
      group: 'Selling',
      permission: WEIGHT_VIEW,
      description: 'What left the shop by weight, product by product, with returns already subtracted.',
      filters: { window: true, search: true },
      run: (context) => weighedSales(api, context),
    })

    api.registerReport({
      id: 'codes',
      label: 'Scale codes',
      icon: 'barcode_scanner',
      group: 'Stock',
      permission: WEIGHT_VIEW,
      description: 'Which of the items this shop sells by weight its own scale can ring up — and which it cannot.',
      filters: { window: false, search: true },
      run: (context) => scaleCodes(api, context),
    })
  },

  // Nothing to release: the plugin holds no timers, no listeners and no state
  // between scans. Every scan reads the layouts the shop has saved *now*, so a
  // layout a shopkeeper fixes takes effect on the next label without a reload.
  dispose() {},
}

// ── The dashboard tile ─────────────────────────────────────────────────────

async function summaryTile(api: PluginAPI): Promise<HTMLElement> {
  try {
    // A dashboard widget is not told which branch the user is looking at, so
    // this is the whole shop — which is what a tile on a front page should be.
    const data = await api.db.rpc<Overview>('overview', {})
    const kg = weightText(Math.round((data.month?.qty ?? 0) * 1000))
    const todo = data.codes?.attention ?? 0

    return h(
      'div',
      { class: 'space-y-3' },
      h(
        'div',
        { class: 'grid grid-cols-2 gap-2' },
        stat('This month', kg, {
          iconName: 'scale',
          hint: `${data.month?.lines ?? 0} line${(data.month?.lines ?? 0) === 1 ? '' : 's'}`,
        }),
        stat('Today', weightText(Math.round((data.today?.qty ?? 0) * 1000)), {
          iconName: 'today',
          hint: `${data.today?.lines ?? 0} line${(data.today?.lines ?? 0) === 1 ? '' : 's'}`,
        })
      ),
      todo > 0
        ? h(
            'p',
            { class: 'text-xs text-content-muted' },
            `${todo} weighed item${todo === 1 ? '' : 's'} the scale cannot ring up — Reports → Scale codes.`
          )
        : h(
            'p',
            { class: 'text-xs text-content-muted' },
            `Every one of the ${data.codes?.all ?? 0} weighed items has a code the scale can print.`
          )
    )
  } catch (error) {
    api.log.warn('the weighing summary could not be read', error)
    return h('p', { class: 'text-sm text-content-muted' }, 'The weighing summary could not be read.')
  }
}

// ── Report: what left the shop by weight ───────────────────────────────────

async function weighedSales(
  api: PluginAPI,
  context: ReportRunContext
): Promise<PluginReportResult> {
  const page = await api.db.rpc<SalesPage>('report', {
    type: 'sales',
    period: context.period,
    from: context.from,
    to: context.to,
    search: context.search,
    branch_id: context.branchId,
    limit: context.limit,
    offset: context.offset,
  })

  return {
    columns: [
      { key: 'product', label: 'Product', type: 'text' },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'lines', label: 'Lines', type: 'int', align: 'right' },
      { key: 'qty', label: 'Sold', type: 'qty', align: 'right' },
      { key: 'avg', label: 'Per line', type: 'qty', align: 'right' },
      { key: 'value', label: 'Value', type: 'money', align: 'right' },
      { key: 'margin', label: 'Margin', type: 'money', align: 'right' },
    ],
    rows: page.rows.map((row) => ({
      product: row.sku ? `${row.product} · ${row.sku}` : row.product,
      unit: row.unit,
      lines: row.lines,
      qty: row.qty,
      avg: row.avg_qty,
      value: row.value_minor,
      margin: row.margin_minor,
    })),
    totals: {
      qty: page.totals?.qty ?? 0,
      value: page.totals?.value_minor ?? 0,
      margin: page.totals?.margin_minor ?? 0,
    },
    totalRows: page.total,
    note:
      `${page.totals?.lines ?? 0} weighed line${(page.totals?.lines ?? 0) === 1 ? '' : 's'} ` +
      `across ${page.totals?.products ?? 0} product${(page.totals?.products ?? 0) === 1 ? '' : 's'}` +
      `${page.label ? ` · ${page.label}` : ''} · returns subtracted`,
  }
}

// ── Report: what the scale cannot ring up ──────────────────────────────────

async function scaleCodes(api: PluginAPI, context: ReportRunContext): Promise<PluginReportResult> {
  const page = await api.db.rpc<CodePage>('report', {
    type: 'codes',
    scope: 'all',
    search: context.search,
    limit: context.limit,
    offset: context.offset,
  })

  const totals = page.totals ?? {
    all: 0,
    ready: 0,
    attention: 0,
    no_code: 0,
    by_piece: 0,
    other_code: 0,
    whole_label: 0,
  }
  const layouts = (page.formats ?? []).map((format) => `${format.name} (${formatSummary(format)})`)

  return {
    columns: [
      { key: 'product', label: 'Product', type: 'text' },
      { key: 'state', label: 'State', type: 'text' },
      { key: 'code', label: 'On the product', type: 'text' },
      { key: 'keep', label: 'What the scale prints', type: 'text' },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'price', label: 'Price', type: 'money', align: 'right' },
    ],
    rows: page.rows.map((row) => ({
      product: row.variant ? `${row.product} · ${row.variant}` : row.product,
      state: STATUS_LABEL[row.status] ?? row.status,
      code: row.code === '' ? '—' : row.code,
      keep: row.status === 'whole_label' ? row.use_code : row.status === 'ready' ? row.code : '—',
      unit: row.unit,
      price: row.price_minor,
    })),
    totals: {
      ready: totals.ready,
      attention: totals.attention,
      no_code: totals.no_code,
      by_piece: totals.by_piece,
    },
    totalRows: page.total,
    note:
      `${totals.all} weighed item${totals.all === 1 ? '' : 's'} · ` +
      `${totals.ready} ready, ${totals.attention} to fix` +
      (totals.by_piece > 0 ? ` (${totals.by_piece} ringing up by the piece)` : '') +
      (layouts.length > 0 ? ` · reading ${layouts.join(', ')}` : ''),
  }
}

/** Exported so the screen and the tests word a state exactly as the report does. */
export { STATUS_LABEL, STATUS_NOTE }

export default weightScalePlugin
