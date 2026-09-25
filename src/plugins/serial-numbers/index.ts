/**
 * Serial Numbers — behaviour.
 *
 * The plugin for shops that sell things with a number of their own: handsets,
 * appliances, engines, bicycles, jewellery. The core already tracks *five*
 * units; this tracks which five.
 *
 * Three ideas hold it together:
 *
 *   · **A unit is not a stock movement.** Registering a serial does not add
 *     stock and selling one does not remove it — the ledger already did both.
 *     The plugin owns exactly one fact the core cannot know: which physical
 *     unit went out. It writes no core table (spec §51).
 *
 *   · **Capturing is a label, not a gate.** A till must sell what is in front
 *     of it whether or not anyone scans. So nothing here blocks a sale; the
 *     plugin collects what it was told at the till, attaches it to the sale
 *     when the sale exists, and puts everything unattached on a list.
 *
 *   · **The server decides where a unit goes.** Two identical handsets are
 *     identical, so the till's guess about which line a scan belongs to is
 *     only a display detail. `serial_numbers_capture` matches the unit by its
 *     own variant and refuses anything that does not belong to that sale.
 *
 * This file imports nothing from `src/features/` and nothing from another
 * plugin. If adding it ever requires editing a feature, the architecture has
 * failed (spec §51).
 */

import { badge, stat } from '../../components/ui/card'
import { button } from '../../components/ui/button'
import { toastSuccess, toastWarning } from '../../components/feedback/toast'
import { input } from '../../components/ui/input'
import { h, mount, srOnly } from '../../components/ui/h'
import type {
  PanelContext,
  Plugin,
  PluginAPI,
  PluginPageModule,
  ProductDraft,
} from '../../shared/registry/plugin-types'
import { captureCard } from './capture'
import {
  missingLabel,
  reasonLabel,
  lineForScan,
  tillSummary,
  trackedLines,
  type CaptureResult,
  type Overview,
  type PendingScan,
  type SyncResult,
} from './helpers'
import {
  DEFAULT_INTERNAL_PREFIX,
  DEFAULT_REQUIRE_CAPTURE,
  INTERNAL_PREFIX_KEY,
  REQUIRE_CAPTURE_KEY,
  SERIAL_TRACKED_KEY,
  SERIALS_MANAGE,
  SERIALS_VIEW,
  TILL_PENDING_KEY,
  serialNumbersManifest,
} from './manifest'

/** Where the till keeps scans it has not managed to attach to a sale yet. */
const PENDING_KEY = TILL_PENDING_KEY
/** How many unattached scans a till will hold before it stops taking more. */
const PENDING_LIMIT = 100

// ── The till's scans, on the device ───────────────────────────────────────
//
// `api.storage` is this device's own localStorage, and that is deliberate: a
// serial scanned thirty seconds before checkout must survive a refresh, and it
// must not appear on the other till across the shop. The shop's *shared* state
// lives in the plugin's tables; this is a shopping list, not a record.

function readScans(api: PluginAPI): PendingScan[] {
  const raw = api.storage.get<unknown>(PENDING_KEY, [])
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const record = entry as Record<string, unknown>
    if (typeof record.serial !== 'string' || typeof record.variantId !== 'string') return []
    return [{ serial: record.serial, variantId: record.variantId, at: Number(record.at) || 0 }]
  })
}

function writeScans(api: PluginAPI, scans: readonly PendingScan[]): void {
  api.storage.set(PENDING_KEY, scans)
}

/** True when this shop asked to be told about units that left unnumbered. */
function flagsUnexplained(api: PluginAPI): boolean {
  return api.settings.get<boolean>(REQUIRE_CAPTURE_KEY, DEFAULT_REQUIRE_CAPTURE)
}

export const serialNumbersPlugin: Plugin = {
  id: serialNumbersManifest.id,
  name: serialNumbersManifest.name,
  version: serialNumbersManifest.version,
  description: serialNumbersManifest.description,
  ...(serialNumbersManifest.icon ? { icon: serialNumbersManifest.icon } : {}),

  register(api) {
    for (const permission of serialNumbersManifest.permissions ?? []) {
      api.registerPermission({
        key: permission.key,
        label: permission.label,
        group: permission.group,
        ...(permission.description ? { description: permission.description } : {}),
      })
    }

    // ── The product field ───────────────────────────────────────────────
    // `storage: 'metadata'` means the core persists it into `products.metadata`
    // with no plugin-owned column and no extra code — and it travels to the
    // till with the catalogue, which is what the POS panel reads to know which
    // lines need a number.
    api.registerProductField({
      key: SERIAL_TRACKED_KEY,
      label: 'Serial tracking',
      type: 'boolean',
      section: 'advanced',
      storage: 'metadata',
      placeholder: 'Track a serial number for every unit',
      importable: true,
      // A shop that switches this on for a product with stock on the shelf
      // should be told what the pool expects, not left to discover it.
      validate: (value: unknown, product: ProductDraft) => {
        if (value !== true) return null
        if (product.track_stock === false) {
          return 'Serial numbers track individual units, which needs stock tracking turned on.'
        }
        return null
      },
    })

    // ── Navigation, and the screen behind it ────────────────────────────
    api.registerNav({
      id: 'serial-numbers',
      label: 'Serial Numbers',
      icon: 'qr_code_scanner',
      section: 'inventory',
      route: '/plugins/serial-numbers',
      permission: SERIALS_VIEW,
      order: 38,
      badge: () => pendingBadge(api),
    })

    api.registerRoute({
      path: '/plugins/serial-numbers',
      title: 'Serial Numbers',
      permission: SERIALS_VIEW,
      load: async (): Promise<PluginPageModule> => {
        const page = await import('./serials-screen')
        return page.create({ db: api.db, settings: api.settings })
      },
    })

    // ── The dashboard tile ──────────────────────────────────────────────
    api.registerDashboardWidget({
      id: 'serial-numbers.summary',
      title: 'Serial numbers',
      size: 'sm',
      permission: SERIALS_VIEW,
      render: () => summaryTile(api),
    })

    // ── The till: scan while the customer is still at the counter ───────
    api.registerPOSPanel({
      id: 'serial-numbers.till',
      label: 'Unit numbers',
      permission: SERIALS_VIEW,
      render: (context) => tillPanel(api, context),
    })

    // ── The finished sale: what left, and what is still missing ─────────
    api.registerSaleTab({
      id: 'serial-numbers.sale',
      label: 'Unit numbers',
      permission: SERIALS_VIEW,
      render: (context) => {
        if (!context.saleId) {
          return h('p', { class: 'text-sm text-content-muted' }, 'This sale is not stored yet.')
        }
        return captureCard({ db: api.db, settings: api.settings }, context.saleId)
      },
    })

    // ── The product form ───────────────────────────────────────────────
    api.registerFormSection({
      id: 'serial-numbers.product',
      label: 'Units',
      section: 'advanced',
      permission: SERIALS_VIEW,
      render: (context) => productSection(api, context.productId),
    })

    // ── Attaching the till's scans, once the sale exists ───────────────
    // The same event arrives twice — the till's own echo and the Realtime row
    // — so one sale is flushed once, and a sale is identified by its own id
    // (shared/bus/events.ts).
    //
    // A sale taken while the shop was offline cannot be captured here: the
    // plugin cannot reach the server, so nothing is forgotten either — the
    // scans stay on the device and the *sale* stays on the “needs a number”
    // list until somebody attaches them from the sale. That list is what makes
    // this limitation safe rather than silent.
    const flushed = new Set<string>()
    let tillBranch: string | null = null

    api.events.on('sale.completed', (event) => {
      const queue = readScans(api)
      if (queue.length === 0) return
      const saleId = event.data.sale_id
      if (!saleId || flushed.has(saleId)) return
      // Another till's sale is not this till's to attach: the units scanned
      // here are physically here.
      if (tillBranch !== null && event.data.branch_id !== tillBranch) return

      flushed.add(saleId)
      void (async () => {
        try {
          const result = await api.db.rpc<CaptureResult>('capture', {
            sale_id: saleId,
            serials: queue.map((scan) => scan.serial),
          })
          const refused = new Set(result.refusals.map((refusal) => refusal.serial.toLowerCase()))
          // Whatever was refused stays on the till: it may belong to the next
          // sale, or to no sale at all until somebody registers it.
          writeScans(
            api,
            queue.filter((scan) => refused.has(scan.serial.toLowerCase()))
          )
          if (result.captured > 0) {
            toastSuccess(`${result.captured} unit number(s) attached to this sale.`)
          }
          for (const refusal of result.refusals.slice(0, 3)) {
            toastWarning(`${refusal.serial}: ${reasonLabel(refusal.reason)}`)
          }
        } catch (error) {
          // Nothing is dropped: the scans stay on the device, and the sale is
          // on the list of sales that still need a number.
          flushed.delete(saleId)
          api.log.warn('serial capture failed', error instanceof Error ? error.message : error)
        }
      })()
    })

    // ── A refund already knows which units came back ────────────────────
    // The event is a *trigger*, never the authority: the server re-derives the
    // returned units from `sale_returns` and is idempotent, so a second
    // delivery of the same event marks nothing again. A cashier who lacks
    // `serial-numbers.manage` simply gets a refused call, and the sale still
    // shows the manual button.
    api.events.on('sale.refunded', (event) => {
      const saleId = event.data.sale_id
      if (!saleId) return
      void api.db
        .rpc<SyncResult>('sync_refunds', { sale_id: saleId })
        .then((result) => {
          if (result.marked > 0) {
            toastSuccess(`${result.marked} returned unit(s) marked as back.`)
          }
        })
        .catch((error: unknown) =>
          api.log.debug('refund sync skipped', error instanceof Error ? error.message : error)
        )
    })

    api.log.debug('registered', {
      field: SERIAL_TRACKED_KEY,
      permission: SERIALS_MANAGE,
      prefix: api.settings.get<string>(INTERNAL_PREFIX_KEY, DEFAULT_INTERNAL_PREFIX),
    })

    // ── The till panel ──────────────────────────────────────────────────

    function tillPanel(pluginApi: PluginAPI, context: PanelContext): HTMLElement {
      if (context.branchId) tillBranch = context.branchId
      const host = h('div', { class: 'space-y-2' })

      function draw(): void {
        const lines = context.lines ?? []
        const scans = readScans(pluginApi)
        const summary = tillSummary(lines, scans)

        if (summary.length === 0 && scans.length === 0) {
          mount(
            host,
            h(
              'p',
              { class: 'text-xs text-content-muted' },
              'No serial-tracked product in this cart.'
            )
          )
          return
        }

        const scanner = input({
          placeholder: 'Scan or type a unit number',
          leadingIcon: 'qr_code_scanner',
          autocomplete: 'off',
          onEnter: (value) => take(value, scanner),
        })

        mount(
          host,
          srOnly(
            summary.length === 0
              ? 'No serial-tracked product in this cart.'
              : `Unit numbers: ${summary.map((line) => `${line.name} ${line.scanned} of ${line.quantity}`).join(', ')}`
          ),
          ...summary.map((line) =>
            h(
              'div',
              { class: 'flex items-center justify-between gap-2' },
              h('p', { class: 'min-w-0 truncate text-xs text-content', text: line.name }),
              badge(`${line.scanned}/${line.quantity}`, {
                tone: line.missing === 0 ? 'success' : 'warning',
              })
            )
          ),
          h(
            'div',
            { class: 'flex items-center gap-2' },
            h('div', { class: 'flex-1' }, scanner),
            button('Add', {
              size: 'sm',
              variant: 'secondary',
              icon: 'add_link',
              onClick: () => take(scanner.value, scanner),
            })
          ),
          scans.length > 0
            ? h(
                'div',
                { class: 'space-y-1' },
                ...scans.map((scan) =>
                  h(
                    'div',
                    { class: 'flex items-center justify-between gap-2' },
                    h('span', { class: 'truncate font-mono text-xs text-content', text: scan.serial }),
                    button('Remove', {
                      size: 'sm',
                      variant: 'ghost',
                      icon: 'close',
                      ariaLabel: `Remove ${scan.serial}`,
                      onClick: () => {
                        writeScans(
                          pluginApi,
                          readScans(pluginApi).filter((entry) => entry.serial !== scan.serial)
                        )
                        draw()
                      },
                    })
                  )
                ),
                h(
                  'p',
                  { class: 'text-[11px] text-content-subtle' },
                  'Attached to the invoice the moment this sale is completed.'
                )
              )
            : null
        )
      }

      function take(value: string, control: HTMLInputElement): void {
        const serial = value.trim()
        if (serial === '') return
        const scans = readScans(pluginApi)
        if (scans.some((scan) => scan.serial.toLowerCase() === serial.toLowerCase())) {
          toastWarning(`${serial} is already scanned for this sale.`)
          control.value = ''
          return
        }
        if (scans.length >= PENDING_LIMIT) {
          toastWarning(`This till is holding ${scans.length} unscanned unit numbers — attach them first.`)
          return
        }
        // Only a line that asked to be tracked can claim a scan; a charger in
        // the same cart must not look like the thing being scanned.
        const line = lineForScan(trackedLines(context.lines), scans)
        writeScans(pluginApi, [...scans, { serial, variantId: line?.variantId ?? '', at: Date.now() }])
        control.value = ''
        draw()
      }

      draw()
      return host
    }
  },
}

// ── The sidebar badge ─────────────────────────────────────────────────────

/**
 * The number a shopkeeper should act on, on the sidebar itself.
 *
 * `overview` is one round trip per sidebar render, and the sidebar renders on
 * navigation — too often for a count that changes when a delivery arrives. So
 * the badge is answered from the plugin's own data key, which the screen and
 * the dashboard tile refresh, and falls back to nothing at all.
 */
function pendingBadge(api: PluginAPI): number | null {
  const cached = api.storage.get<number>('pending_units', 0)
  return flagsUnexplained(api) && cached > 0 ? cached : null
}

// ── The dashboard tile ────────────────────────────────────────────────────

async function summaryTile(api: PluginAPI): Promise<HTMLElement> {
  let overview: Overview | null = null
  try {
    overview = await api.db.rpc<Overview>('overview')
    api.storage.set('pending_units', overview.pending.units)
  } catch {
    // A tile must never be the reason the dashboard fails to draw.
    return h('p', { class: 'text-xs text-content-muted' }, 'Serial numbers could not be read.')
  }

  const waiting = overview.pending.units
  const loud = flagsUnexplained(api)
  const recent = overview.recent[0]

  return h(
    'div',
    { class: 'flex flex-col gap-2' },
    srOnly(`Serial numbers: ${overview.totals.in_stock} in stock, ${waiting} waiting for a number`),
    stat('Units in stock', String(overview.totals.in_stock), {
      iconName: 'qr_code_scanner',
      tone: waiting > 0 && loud ? 'warning' : 'neutral',
      hint: `${overview.totals.sold} sold · ${overview.tracked_products} tracked product(s)`,
    }),
    recent
      ? h(
          'p',
          { class: 'truncate text-xs text-content-muted' },
          `Last: ${recent.serial} — ${recent.product_name ?? ''}`
        )
      : h('p', { class: 'text-xs text-content-muted' }, 'No unit registered yet.'),
    waiting > 0 && loud
      ? h(
          'p',
          { class: 'text-xs text-warning' },
          `${missingLabel(waiting)} across ${overview.pending.sales} sale(s).`
        )
      : null
  )
}

// ── The product form section ──────────────────────────────────────────────

async function productSection(api: PluginAPI, productId: string | undefined): Promise<HTMLElement> {
  if (!productId) {
    return h(
      'p',
      { class: 'text-xs text-content-muted' },
      'Tick “Track a serial number for every unit” above, then register this product’s units from Inventory → Serial Numbers.'
    )
  }

  try {
    const result = await api.db.rpc<{
      variants: Array<{ name: string; on_hand: number; serials: number; in_stock: number }>
    }>('variants', { product_id: productId })

    const onHand = result.variants.reduce((total, variant) => total + Number(variant.on_hand), 0)
    const registered = result.variants.reduce((total, variant) => total + Number(variant.serials), 0)
    const inStock = result.variants.reduce((total, variant) => total + Number(variant.in_stock), 0)

    if (registered === 0) {
      return h(
        'p',
        { class: 'text-xs text-content-muted' },
        `No unit registered for this product yet. Register them from Inventory → Serial Numbers${
          onHand > 0 ? ` — ${onHand} unit(s) are on hand.` : '.'
        }`
      )
    }

    return h(
      'div',
      { class: 'flex flex-wrap items-center gap-2' },
      badge(`${registered} unit(s) with a number`, { tone: 'info', iconName: 'qr_code_scanner' }),
      badge(`${inStock} in stock`, { tone: inStock === 0 ? 'neutral' : 'success' }),
      h('p', { class: 'text-xs text-content-muted' }, 'Manage them from Inventory → Serial Numbers.')
    )
  } catch {
    return h('p', { class: 'text-xs text-content-subtle' }, 'Unit numbers could not be read.')
  }
}

// ── The parts a test drives directly ──────────────────────────────────────
// Exported from the plugin's entry point rather than reached for by path, so
// the tests exercise the same surface the host composes.

export { captureCard } from './capture'
export { TILL_PENDING_KEY } from './manifest'
// The screen is reached by path, not re-exported here: the route loads it with
// `import('./serials-screen')`, and re-exporting it from this file would drag
// the whole page into the entry chunk and undo that.

export default serialNumbersPlugin
