/**
 * The point of sale (spec §14, §15, §17).
 *
 * ── The keyboard target ──────────────────────────────────────────────────
 * The acceptance test for Phase 2 is "a cashier completes a sale with keyboard
 * only, in under 10 keystrokes for a single-item cash sale." The flow this
 * screen implements, with the key count:
 *
 *     r i c          3   type to search (the field is focused on arrival)
 *     Enter          1   add the highlighted product
 *     F2             1   open payment — the amount field is pre-filled
 *     Enter          1   add the tender, which settles the sale
 *                    ─
 *                    6
 *
 * Everything else is reachable by mouse, but nothing requires it. That is a
 * deliberate asymmetry: a shop counter is a keyboard-and-scanner environment
 * and the mouse is for the exceptions.
 *
 * ── Where the truth lives ────────────────────────────────────────────────
 * Prices, tax and totals are *shown* here and *decided* by `complete_sale`.
 * The receipt is printed from what the RPC returned, not from this cart, so a
 * stale price in the browser cannot reach the customer's receipt.
 */

import { h, icon, mount } from '../../components/ui/h'
import { button, iconButton, spinner } from '../../components/ui/button'
import { badge, emptyState } from '../../components/ui/card'
import { toastError, toastSuccess, toastWarning } from '../../components/feedback/toast'
import { confirm } from '../../components/feedback/modal'
import { input } from '../../components/ui/input'
import { CartStore } from './cart-store'
import { SaleService, toCartLine } from './sale-service'
import { openPaymentDialog } from './payment-dialog'
import { openCustomerDialog } from './customer-dialog'
import { openReceipt } from './receipt'
import { refreshSalesFloor, salesFloor, salesFloorStore } from '../../app/state/sales-floor'
import { activeOrganization, can } from '../../app/state/session'
import { getRepositories } from '../../app/data'
import {
  panelLines,
  pluginPanelsHost,
  posFieldValues,
  printableNotes,
  resolveScan,
  saleAdjustmentsHost,
  type AppliedAdjustment,
} from '../../app/plugin-slots'
import type { PluginRegistry } from '../../shared/registry/plugin-registry'
import type { EventBus } from '../../shared/bus/event-bus'
import type { SalesFloor, SellableProduct } from '../../shared/repositories/contracts'
import type {
  PanelContext as PluginPanelContext,
  SaleAdjustmentContext,
  SaleAdjustmentDefinition,
  SaleAdjustmentQuote,
  SaleAdjustmentRelease,
  ScanMatch,
} from '../../shared/registry/plugin-types'
import type { CustomerRow, SaleRow } from '../../shared/types/records'
import {
  formatMoney,
  formatQty,
  milli,
  minor,
  minorToNumber,
  parseMilli,
  type Milli,
  type Minor,
} from '../../shared/domain/money'
import { translateError } from '../../app/platform/errors'

export interface PosViewOptions {
  bus: EventBus
  /** The plugin host: its panels are drawn beside the cart. */
  registry: PluginRegistry
  onNavigate?: (path: string) => void
}

export function posView(options: PosViewOptions): HTMLElement {
  const floor = salesFloor()
  // The floor resolve starts when the shell mounts, but the router can render
  // this route first — a bookmarked #/pos, or a fast tap after signing in. So
  // the gate below subscribes and swaps itself for the real screen; reading
  // the floor once and giving up produced a permanent hourglass, which is
  // indistinguishable from a broken app.
  return floor ? posScreen(options, floor) : posGate(options)
}

/**
 * Holds the POS until the sales floor is resolved.
 *
 * Deliberately loud on failure: the previous version said "The shop is still
 * loading" while the resolve had already failed, so a real error looked like
 * patience. A shopkeeper cannot act on an hourglass, and neither can support.
 */
function posGate(options: PosViewOptions): HTMLElement {
  const root = h('div', { class: 'h-full min-h-0' })
  let done = false

  const render = (): void => {
    if (done) return
    const state = salesFloorStore.state

    if (state.floor) {
      done = true
      unsubscribe()
      mount(root, posScreen(options, state.floor))
      return
    }

    if (state.status === 'error') {
      done = true
      unsubscribe()
      mount(
        root,
        emptyState('The shop could not be loaded', {
          description:
            (state.error ?? 'Unknown error') +
            ' — branch, stock room and register are needed before anything can be sold.',
          iconName: 'error',
          action: button('Try again', {
            variant: 'primary',
            onClick: () => {
              // Re-entering sets the gate back to its loading state rather
              // than leaving a dead "Try again" on screen.
              mount(root, posGate(options))
              void refreshSalesFloor()
            },
          }),
        })
      )
      return
    }

    mount(
      root,
      emptyState('Loading the shop…', {
        description: 'Branch, stock room and register.',
        iconName: 'hourglass_top',
      })
    )
  }

  const unsubscribe = salesFloorStore.subscribe(render)
  if (salesFloorStore.state.status === 'idle') void refreshSalesFloor()
  render()

  return root
}

function posScreen(options: PosViewOptions, floor: SalesFloor): HTMLElement {
  const { bus, registry } = options
  const organization = activeOrganization()
  const currency = organization?.currency ?? 'BDT'

  const repos = getRepositories()
  const sales = new SaleService(repos, bus)
  const cart = new CartStore(floor.branchId)

  const root = h('div', { class: 'flex h-full min-h-0 flex-col lg:flex-row' })

  // ── Left: catalogue ─────────────────────────────────────────────────────

  let results: SellableProduct[] = []
  let highlighted = 0
  // What the till has looked at this session, by variant: the receipt prints
  // plugin fields (`printable`) from here, because a sale line carries the
  // variant and nothing else about the product.
  const seen = new Map<string, SellableProduct>()
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  // `auto-fill` rather than fixed column counts: the catalogue pane is a
  // different width on a phone, a counter tablet and a desktop, and a tile
  // narrower than ~150px cannot hold a product name and a price.
  const grid = h('div', {
    class: 'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 p-3 content-start',
  })

  const statusLine = h('p', { class: 'px-3 pb-1.5 text-xs text-content-subtle' })

  const searchField = input({
    type: 'search',
    leadingIcon: 'barcode_scanner',
    class: 'h-12 text-base',
    placeholder: 'Scan a barcode or type a product name — then Enter',
    autofocus: true,
    autocomplete: 'off',
    onInput: (value) => {
      if (searchTimer) clearTimeout(searchTimer)
      searchTimer = setTimeout(() => void runSearch(value), 150)
    },
  })

  searchField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void onEnterInSearch()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      highlighted = Math.min(highlighted + 1, results.length - 1)
      renderResults()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      highlighted = Math.max(highlighted - 1, 0)
      renderResults()
    } else if (event.key === 'Escape') {
      searchField.value = ''
      void runSearch('')
    }
  })

  async function runSearch(term: string): Promise<void> {
    const trimmed = term.trim()

    // A scanner sends a full code followed by Enter, which arrives as one
    // input event. An exact barcode hit is unambiguous, so it is added
    // immediately rather than shown as a list of one.
    if (trimmed.length >= 6 && /^[0-9A-Za-z-]+$/.test(trimmed)) {
      const scanned = await repos.catalog.findByBarcode(trimmed, floor!.warehouseId)
      if (scanned) {
        addToCart(scanned)
        searchField.value = ''
        return
      }

      // The shop's barcodes did not know this code. An add-on might: a scale
      // label carries a PLU inside it, a prepaid card carries its own number.
      // The plugin decodes, and the *core* looks the result up in the same
      // barcode table — so an add-on can never ring up something the shop does
      // not sell (docs/11 §Scan resolvers).
      const recognised = await resolveScan(registry, trimmed, {
        organizationId: organization?.organization_id ?? '',
        branchId: floor!.branchId,
        warehouseId: floor!.warehouseId,
        currency,
      })
      if (recognised) {
        const product = await repos.catalog.findByBarcode(
          recognised.match.lookupCode,
          floor!.warehouseId
        )
        if (product) {
          addToCart(product, recognised.match)
          toastSuccess(recognised.match.note ?? `${recognised.label} · ${recognised.match.lookupCode}`)
          searchField.value = ''
          void runSearch('')
          searchField.focus()
          return
        }
        // The plugin understood the code and the shop cannot sell it: say so
        // plainly rather than showing an empty search result.
        statusLine.textContent =
          `${recognised.label} read that as ${recognised.match.lookupCode}, ` +
          'but no product in this shop carries that code.'
        return
      }
    }

    try {
      const page = await repos.catalog.searchProducts({
        search: trimmed,
        warehouseId: floor!.warehouseId,
        limit: 40,
      })
      results = page.items
      highlighted = 0
      renderResults()
    } catch (error) {
      toastError(translateError(error).message)
    }
  }

  async function onEnterInSearch(): Promise<void> {
    const product = results[highlighted]
    if (!product) return
    addToCart(product)
    searchField.value = ''
    await runSearch('')
    searchField.focus()
  }

  /**
   * Adds a product to the cart. `scan` is present when the line came from a code
   * an add-on recognised: it carries the weight that was on the label, so a
   * weighed line starts at 1.250 kg rather than at the till's own step.
   *
   * A price the label printed is *shown*, never charged. Every line is priced by
   * `complete_sale` from the catalogue, so a till whose screen disagreed with its
   * receipt would be worse than one that never read the label at all — a label
   * that disagrees becomes a warning the cashier can act on instead.
   */
  function addToCart(product: SellableProduct, scan?: ScanMatch): void {
    const step: Milli = product.decimalQuantity ? milli(250) : milli(1000)
    const line = toCartLine(product)
    if (scan) warnIfLabelPriceDiffers(product, scan)
    if (scan && scan.quantity !== undefined) {
      cart.add(line, milli(Math.round(scan.quantity * 1000)))
      return
    }
    cart.add(line, step)
  }

  /**
   * A stale shelf price is the one thing a scale label cannot tell us by itself:
   * the label was printed days ago, the shop changed the price yesterday, and the
   * customer is looking at the label. Say both numbers; the cashier deals with the
   * shelf, and the receipt still carries the shop's own price.
   */
  function warnIfLabelPriceDiffers(product: SellableProduct, scan: ScanMatch): void {
    if (scan.unitPriceMinor === undefined || scan.unitPriceMinor === product.price) return
    toastWarning(
      `${scan.note ?? 'That label'} says ${formatMoney(minor(scan.unitPriceMinor), { currency })}, ` +
        `but this shop charges ${formatMoney(product.price, { currency })}. ` +
        'Charging the shop’s price.'
    )
  }

  function renderResults(): void {
    if (results.length === 0) {
      statusLine.textContent = 'No products match.'
      grid.replaceChildren(
        h('div', { class: 'col-span-full px-3 py-12 text-center' },
          icon('search_off', 'text-4xl text-content-subtle'),
          h('p', { class: 'mt-2 text-sm font-medium text-content', text: 'Nothing found' }),
          h('p', {
            class: 'mt-0.5 text-xs text-content-subtle',
            text: 'Check the spelling, or add the product first.',
          })
        )
      )
      return
    }
    statusLine.textContent = `${results.length} product${results.length === 1 ? '' : 's'}`
    grid.replaceChildren(...results.map((product, index) => productTile(product, index)))
  }

  function productTile(product: SellableProduct, index: number): HTMLElement {
    seen.set(product.variantId, product)
    const out =
      product.trackStock &&
      !product.allowNegative &&
      product.availableQty !== null &&
      product.availableQty <= 0

    return h(
      'button',
      {
        type: 'button',
        class: [
          'flex min-h-[84px] flex-col rounded-lg border p-2.5 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          index === highlighted
            ? 'border-primary bg-primary/5 ring-1 ring-primary'
            : 'border-border bg-surface hover:border-ring/50 hover:bg-surface-muted',
          out ? 'opacity-70' : '',
        ].filter(Boolean).join(' '),
        onClick: () => {
          addToCart(product)
          searchField.focus()
        },
      },
      h('p', { class: 'text-sm font-medium text-content leading-tight line-clamp-2', text: product.name }),
      product.variantName
        ? h('p', { class: 'text-xs text-content-muted mt-0.5', text: product.variantName })
        : null,
      // Plugin-registered fields the plugin asked to show here (spec §14) —
      // a batch number or an expiry the cashier can act on before ringing up.
      ...posFieldValues(registry, product.metadata).map((entry) =>
        h('p', { class: 'text-[11px] text-content-subtle mt-0.5', text: entry.text })
      ),
      // Price and stock sit on the tile's floor, so tiles line up no matter how
      // many lines the name took.
      h('div', { class: 'mt-auto flex items-end justify-between gap-1 pt-1.5' },
        h('span', {
          class: 'min-w-0 truncate text-sm font-semibold tabular-nums text-content',
          text: formatMoney(product.price, { currency }),
        }),
        product.trackStock
          ? h('span', {
              // A stock figure a cashier can read at arm's length: a quiet chip
              // when there is stock, a loud one when there is none.
              class: `shrink-0 rounded px-1.5 py-0.5 text-[11px] tabular-nums ${
                out ? 'bg-danger/10 font-medium text-danger' : 'bg-surface-muted text-content-subtle'
              }`,
              text: formatQty(product.availableQty ?? milli(0), {
                decimal: product.decimalQuantity,
              }),
            })
          : null
      )
    )
  }

  // ── Right: cart ─────────────────────────────────────────────────────────

  /**
   * Who is buying. The cart has carried a customer id since the first commit
   * and nothing ever set it, so every sale was a walk-in and no add-on could be
   * about the person at the counter (spec §19).
   */
  let attachedCustomer: CustomerRow | null = null

  const customerLine = h('div', {
    class: 'flex items-center gap-1 border-b border-border px-3 py-1.5',
  })

  // `overflow-x-hidden` is deliberate: a container with `overflow-y-auto`
  // computes `overflow-x: auto`, so one too-wide child used to hand the whole
  // cart a horizontal scrollbar. Nothing in a cart is ever meant to be read
  // sideways.
  const lineList = h('div', {
    class: 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2.5 py-2 space-y-1.5',
  })
  // Money a plugin has taken off this sale, and the strip the cashier applies it
  // from. The till owns this list, not the plugin: the *sum* is what reaches
  // `complete_sale`, and a plugin that lost track of its own quote can be told.
  let appliedAdjustments: AppliedAdjustment[] = []
  const adjustmentsSlot = h('div', { class: 'px-3' })
  const totalsBox = h('div', { class: 'border-t border-border px-3 py-2.5 space-y-1.5' })
  // Plugin panels sit between the totals and the pay button: the money is core,
  // and whatever a plugin adds about *this* sale belongs beside it.
  const panelsSlot = h('div', { class: 'px-3 pb-1' })
  const heldBadge = badge('0', { tone: 'warning', iconName: 'pause_circle' })
  /** How many lines are on the sale, beside the panel title. */
  const lineCountBadge = badge('0', { tone: 'neutral' })

  function renderCart(): void {
    const state = cart.state
    if (state.cart.lines.length === 0) {
      lineList.replaceChildren(
        h('div', { class: 'flex h-full flex-col items-center justify-center px-4 py-10 text-center' },
          h('span', {
            class: 'grid h-12 w-12 place-items-center rounded-full bg-surface-muted text-content-subtle',
          }, icon('shopping_cart', 'text-2xl')),
          h('p', { class: 'mt-3 text-sm font-medium text-content', text: 'Scan or search to start a sale.' }),
          h('p', {
            class: 'mt-1 text-xs text-content-subtle',
            text: 'Enter adds the highlighted product · F2 opens payment',
          })
        )
      )
    } else {
      lineList.replaceChildren(...state.cart.lines.map((line) => cartLine(line.lineId)))
    }

    const totals = state.totals
    totalsBox.replaceChildren(
      totalRow('Subtotal', totals.subtotal),
      ...(totals.discount > 0
        ? [totalRow('Discount', (0 - totals.discount) as Minor, 'text-success')]
        : []),
      ...(totals.tax > 0 ? [totalRow('Tax', totals.tax)] : []),
      h('div', { class: 'flex items-baseline justify-between gap-2 pt-2 border-t border-border' },
        h('span', { class: 'text-sm font-medium text-content', text: 'Total' }),
        h('span', {
          class: 'min-w-0 truncate text-2xl font-semibold text-content tabular-nums tracking-tight',
          text: formatMoney(totals.total, { currency }),
        })
      )
    )

    // The strip of what a plugin can take off *this* cart. Drawn with the
    // totals because it changes them, and re-drawn on every cart change so an
    // adjustment the cart has outgrown is withdrawn rather than honoured.
    if (registry.saleAdjustments.items.length > 0) {
      mount(
        adjustmentsSlot,
        saleAdjustmentsHost(registry, adjustmentContext(), {
          applied: appliedAdjustments,
          onApply: applyAdjustment,
          onRemove: removeAdjustment,
        })
      )
    } else {
      mount(adjustmentsSlot, null)
    }

    const count = state.cart.lines.length
    lineCountBadge.textContent = `${count} ${count === 1 ? 'item' : 'items'}`
    lineCountBadge.classList.toggle('hidden', count === 0)

    payButton.disabled = state.cart.lines.length === 0 || state.busy
    holdButton.disabled = state.cart.lines.length === 0 || state.busy
    clearButton.disabled = state.cart.lines.length === 0 || state.busy

    // Panels are re-drawn with the cart because they are about the sale in
    // front of the cashier: a loyalty panel showing the previous total would be
    // worse than no panel at all.
    mount(panelsSlot, pluginPanelsHost(registry, cartContext()))

    void refreshHeld()
  }

  /**
   * The cart as every plugin slot sees it (docs/11 §Slots).
   *
   * `total` is the cart total *including* any adjustment already applied, which
   * is what a plugin quoting a further discount has to reason about — and the
   * reason the strip is re-drawn on every cart change.
   */
  function cartContext(): PluginPanelContext {
    return {
      organizationId: organization?.organization_id ?? '',
      branchId: floor.branchId,
      currency,
      total: minorToNumber(cart.state.totals.total),
      customerId: cart.state.cart.customerId,
      // What is in the cart, for a plugin that decorates *this* sale — a
      // serial to attach to a line, a promotion that applies to what is being
      // bought (spec §51).
      lines: panelLines(cart.state.cart.lines, (variantId) => seen.get(variantId)),
    }
  }

  function renderCustomer(): void {
    if (!can('customers.view')) {
      mount(customerLine, null)
      return
    }
    mount(
      customerLine,
      button(attachedCustomer?.name ?? 'Walk-in', {
        // `md` (40px), not `sm` (32px): this spans the width of the cart panel
        // and is the only way to put a customer on the sale, so it is a
        // thumb target on a phone rather than a dense secondary control.
        size: 'md',
        variant: 'ghost',
        icon: 'person',
        ariaLabel: 'Customer on this sale',
        title: attachedCustomer ? 'Change the customer on this sale' : 'Attach a customer',
        class: 'min-w-0 flex-1 justify-start',
        onClick: () =>
          openCustomerDialog({
            current: attachedCustomer,
            currency,
            onPick: (customer) => {
              attachedCustomer = customer
              // The till's cart is what the server prices and stores, so this
              // is the only place the choice needs to land.
              cart.setCustomer(customer?.id ?? null)
              renderCustomer()
            },
          }),
      }),
      attachedCustomer
        ? h('span', {
            class: 'text-[11px] text-content-subtle truncate max-w-[45%]',
            text: attachedCustomer.phone ?? '',
          })
        : h('span', { class: 'text-[11px] text-content-subtle', text: 'optional' })
    )
  }

  function totalRow(label: string, amount: Minor, extraClass = ''): HTMLElement {
    return h('div', { class: 'flex items-baseline justify-between gap-2' },
      h('span', { class: 'min-w-0 truncate text-xs text-content-muted', text: label }),
      h('span', { class: `text-sm text-content tabular-nums ${extraClass}`.trim(), text: formatMoney(amount, { currency }) })
    )
  }

  /**
   * One line in the cart.
   *
   * ── Why this is two rows, not three columns ──────────────────────────────
   * It used to be `[name | stepper | total+delete]` in a single row, each
   * column sized by its content. At 360px the stepper and the total claimed
   * roughly 260px between them and the name was left with about 40 — so
   * "Only 0 in stock" wrapped one word per line, the line total was clipped by
   * the panel edge, and the list grew a horizontal scrollbar (an `overflow-y`
   * container computes `overflow-x: auto`, so any overflowing child shows one).
   *
   * Now the row that must never wrap — name and money — owns the full width,
   * and the controls sit underneath where they can be thumb-sized. Everything
   * that can overflow is `min-w-0` + `truncate`; nothing is wider than the
   * panel, so there is nothing left to scroll sideways.
   */
  function cartLine(lineId: string): HTMLElement {
    const state = cart.state
    const line = state.cart.lines.find((l) => l.lineId === lineId)
    if (!line) return h('div')
    const totals = state.totals.lines.find((t) => t.lineId === lineId)
    const step: Milli = line.decimalQuantity ? milli(250) : milli(1000)
    const oversold = state.totals.oversold.includes(lineId)

    const qtyInput = input({
      type: 'text',
      inputmode: 'decimal',
      value: formatQty(line.quantity, { decimal: line.decimalQuantity }),
      // Sits inside the stepper group, so it drops the control's own border
      // and rounding rather than drawing a second box inside a box.
      class: 'h-9 w-14 min-w-0 rounded-none border-0 bg-transparent px-1 text-center text-sm tabular-nums focus:ring-0',
      onEnter: (value) => {
        const parsed = parseMilli(value, { decimal: line.decimalQuantity })
        if (parsed !== null && parsed > 0) cart.setQuantity(lineId, parsed)
        else renderCart()
      },
    })
    qtyInput.setAttribute('aria-label', `Quantity of ${line.name}`)

    const stepper = h('div',
      {
        class:
          'flex items-center rounded-md border border-border bg-surface shrink-0 ' +
          'focus-within:border-ring focus-within:ring-2 focus-within:ring-ring',
      },
      iconButton('remove', 'Decrease', {
        size: 'sm',
        variant: 'ghost',
        onClick: () => cart.increment(lineId, (0 - step) as Milli),
      }),
      qtyInput,
      iconButton('add', 'Increase', {
        size: 'sm',
        variant: 'ghost',
        onClick: () => cart.increment(lineId, step),
      })
    )

    return h(
      'div',
      {
        class: `group rounded-lg border px-2.5 py-2 transition-colors ${
          oversold ? 'border-danger bg-danger/5' : 'border-border bg-surface hover:border-ring/40'
        }`.trim(),
        dataset: { lineId },
      },
      // Row 1 — what it is, and what it costs. Never wraps, never clipped.
      h('div', { class: 'flex items-start gap-2' },
        h('div', { class: 'min-w-0 flex-1' },
          h('p', { class: 'truncate text-sm font-medium leading-tight text-content', title: line.name, text: line.name }),
          line.variantName
            ? h('p', { class: 'truncate text-xs text-content-muted', text: line.variantName })
            : null
        ),
        h('p', {
          class: 'shrink-0 text-sm font-semibold tabular-nums text-content',
          text: formatMoney(totals?.total ?? (0 as Minor), { currency }),
        }),
        iconButton('close', 'Remove line', {
          size: 'sm',
          variant: 'ghost',
          class: 'shrink-0 -mr-1.5 -mt-1 text-content-subtle hover:text-danger',
          onClick: () => cart.remove(lineId),
        })
      ),
      // Row 2 — the controls, and the unit price they multiply.
      h('div', { class: 'mt-1.5 flex items-center justify-between gap-2' },
        h('p', {
          class: 'min-w-0 truncate text-xs tabular-nums text-content-subtle',
          text: `${formatMoney(line.unitPrice, { currency })} ×`,
        }),
        stepper
      ),
      // Row 3 — only when the shop cannot cover it. A full-width strip, so the
      // sentence reads as a sentence.
      oversold
        ? h('p', {
            class: 'mt-1.5 flex items-center gap-1 rounded bg-danger/10 px-1.5 py-1 text-[11px] font-medium text-danger',
            text: `Only ${formatQty(line.availableQty ?? milli(0), { decimal: line.decimalQuantity })} in stock`,
          })
        : null
    )
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  // Green, not brand: the one button on this screen that takes money is the
  // one button that must never be confused with the others.
  const payButton = button('Pay', {
    variant: 'success',
    size: 'xl',
    icon: 'payments',
    fullWidth: true,
    onClick: () => openPayment(),
  })

  const holdButton = button('Hold', {
    variant: 'outline',
    size: 'lg',
    icon: 'pause',
    onClick: () => void holdCart(),
  })

  const clearButton = button('Clear', {
    variant: 'outline',
    size: 'lg',
    icon: 'delete_sweep',
    class: 'text-danger hover:border-danger/50 hover:bg-danger-soft hover:text-danger',
    onClick: () => void clearCart(),
  })

  // ── Sale adjustments (money off, from a plugin) ─────────────────────────

  /**
   * The one order discount the sale carries is the sum of what is applied.
   *
   * `complete_sale` has taken a `FLAT` order discount since migration 012 and
   * the cart domain has modelled it since the first commit; what was missing
   * was anything a shopkeeper could press. Several plugins can contribute — a
   * loyalty redemption, later a promotion — and the sale stores one number, so
   * the host sums them here and each plugin keeps its own share in its own
   * ledger.
   */
  function syncOrderDiscount(): void {
    const sum = appliedAdjustments.reduce((total, entry) => total + entry.quote.amountMinor, 0)
    if (sum > 0) cart.setOrderDiscount('FLAT', sum)
    else if (cart.state.cart.discountValue !== 0 || cart.state.cart.discountType !== null) {
      // A discount the till cannot explain is not kept: after a reload the
      // plugin's quote is gone, and honouring an amount nothing remembers
      // would take money off every sale the cashier rings up.
      cart.setOrderDiscount(null, 0)
    }
  }

  /**
   * What every adjustment is quoted against: the sale before the order-level
   * discount, applied or not.
   *
   * Not the cart total — that already has the discount in it, so a plugin
   * quoting `min(balance, total)` would watch its own offer shrink every time
   * the strip re-drew. And an emptied cart reads as ৳0 here, which is what
   * withdraws a redemption priced for a sale that no longer exists.
   */
  function adjustmentContext(): SaleAdjustmentContext {
    const context = cartContext()
    return {
      organizationId: organization?.organization_id ?? '',
      branchId: floor!.branchId,
      currency,
      customerId: context.customerId ?? null,
      totalMinor: cart.state.totals.beforeOrderDiscount,
      ...(context.lines ? { lines: context.lines } : {}),
    }
  }

  function applyAdjustment(
    adjustment: SaleAdjustmentDefinition,
    quote: SaleAdjustmentQuote
  ): void {
    void (async () => {
      appliedAdjustments = [
        ...appliedAdjustments.filter((entry) => entry.id !== adjustment.id),
        { id: adjustment.id, source: adjustment.source ?? 'plugin', quote },
      ]
      try {
        // Money moves *here*, and only if the plugin could record it. An
        // offline till that cannot debit the customer's points must not give
        // away the shop's money — the cashier is told and can try again.
        await adjustment.onApplied?.(quote, adjustmentContext())
      } catch (error) {
        appliedAdjustments = appliedAdjustments.filter((entry) => entry.id !== adjustment.id)
        syncOrderDiscount()
        toastError(
          error instanceof Error
            ? `${adjustment.label}: ${error.message}`
            : `${adjustment.label} could not be applied.`
        )
        return
      }
      syncOrderDiscount()
    })()
  }

  function removeAdjustment(
    adjustment: SaleAdjustmentDefinition,
    quote: SaleAdjustmentQuote,
    reason: SaleAdjustmentRelease
  ): void {
    const had = appliedAdjustments.some((entry) => entry.id === adjustment.id)
    appliedAdjustments = appliedAdjustments.filter((entry) => entry.id !== adjustment.id)
    syncOrderDiscount()
    if (!had) return
    void (async () => {
      try {
        await adjustment.onReleased?.(quote, reason)
      } catch (error) {
        // The discount is off the sale either way; what is lost is the
        // plugin's own bookkeeping, which it must reconcile itself.
        toastWarning(
          error instanceof Error
            ? `${adjustment.label}: ${error.message}`
            : `${adjustment.label} could not withdraw that cleanly.`
        )
      }
    })()
  }

  /** Everything off the sale — a held cart, a cleared one, or a finished sale. */
  function releaseAll(reason: SaleAdjustmentRelease): void {
    const entries = appliedAdjustments
    appliedAdjustments = []
    syncOrderDiscount()
    for (const entry of entries) {
      const adjustment = registry.saleAdjustments.items.find((item) => item.id === entry.id)
      if (!adjustment) continue
      void Promise.resolve(adjustment.onReleased?.(entry.quote, reason)).catch((error: unknown) => {
        console.error(`[plugin-host] "${entry.source}" could not release an adjustment`, error)
      })
    }
  }

  /** Told to every plugin whose money was in the sale that just completed. */
  function settleAdjustments(settlement: {
    saleId: string
    invoiceNo: string
    stored: boolean
  }): void {
    const entries = appliedAdjustments
    appliedAdjustments = []
    if (cart.state.cart.discountValue !== 0 || cart.state.cart.discountType !== null) {
      cart.setOrderDiscount(null, 0)
    }
    for (const entry of entries) {
      const adjustment = registry.saleAdjustments.items.find((item) => item.id === entry.id)
      if (!adjustment) continue
      void Promise.resolve(adjustment.onSettled?.(entry.quote, settlement)).catch(
        (error: unknown) => {
          toastWarning(`${entry.source} could not record the discount on ${settlement.invoiceNo}.`)
          console.error(`[plugin-host] "${entry.source}" could not settle an adjustment`, error)
        }
      )
    }
  }

  function openPayment(): void {
    const state = cart.state
    const problem = state.totals.oversold.length > 0
      ? 'Some lines exceed the stock on hand. Reduce them first.'
      : null
    if (problem) {
      toastWarning(problem)
      return
    }

    void (async () => {
      let methods: Awaited<ReturnType<typeof repos.catalog.listPaymentMethods>> = []
      try {
        methods = await repos.catalog.listPaymentMethods()
      } catch (error) {
        toastError(translateError(error).message)
        return
      }
      if (methods.length === 0) {
        toastError('This shop has no payment methods configured.')
        return
      }

      openPaymentDialog({
        total: state.totals.total,
        methods,
        currency,
        onSubmit: async (payments) => {
          cart.setBusy(true)
          try {
            const result = await sales.complete({
              cart: cart.state.cart,
              payments,
              floor: floor!,
              currency,
              organizationId: organization?.organization_id ?? '',
              heldSaleId: cart.state.heldSaleId,
            })
            const heldId = cart.state.heldSaleId
            // Told before the cart goes: every plugin whose money was in this
            // sale learns which sale took it — and, offline, that the invoice
            // number is not final yet.
            settleAdjustments({
              saleId: result.sale_id,
              invoiceNo: result.invoice_no,
              stored: !result.queued,
            })
            cart.clear()
            if (result.queued) {
              // The money is real and the goods have gone; what is missing is
              // the invoice number. Saying "saved offline" is what stops the
              // cashier taking the sale a second time.
              toastWarning(
                `Saved on this device · ${formatMoney(minorFromString(result.total), { currency })}. ` +
                  'It will sync when the connection returns.'
              )
            } else {
              toastSuccess(`Sale ${result.invoice_no} · ${formatMoney(minorFromString(result.total), { currency })}`)
            }
            const sale = await repos.sales.get(result.sale_id)
            if (sale) openReceipt(sale, currency, 'Mekholi', printableNotes(registry, seen.values()))
            if (heldId) void refreshHeld()
            searchField.focus()
          } catch (error) {
            const translated = translateError(error)
            toastError(translated.message)
            throw error
          } finally {
            cart.setBusy(false)
          }
        },
      })
    })()
  }

  async function holdCart(): Promise<void> {
    cart.setBusy(true)
    try {
      // A parked sale is not this sale. The redemption goes back to the
      // customer and the cashier applies it again when the sale resumes —
      // otherwise a held cart would carry a discount no screen can undo.
      releaseAll('cleared')
      await sales.hold(cart.state.cart, floor!)
      cart.clear()
      toastSuccess('Sale held — resume it from the Held list.')
      searchField.focus()
    } catch (error) {
      toastError(translateError(error).message)
    } finally {
      cart.setBusy(false)
    }
  }

  async function clearCart(): Promise<void> {
    const ok = await confirm('Clear this cart?', {
      message: 'The items will be discarded. Hold the sale instead if you may return to it.',
      confirmLabel: 'Clear',
      tone: 'danger',
      iconName: 'delete_sweep',
    })
    if (ok) {
      releaseAll('cleared')
      cart.clear()
      searchField.focus()
    }
  }

  async function refreshHeld(): Promise<void> {
    try {
      const held = await repos.sales.held(floor!.branchId)
      heldBadge.querySelector('span:last-child')!.textContent = String(held.length)
      heldBadge.classList.toggle('hidden', held.length === 0)
      heldCount.textContent = String(held.length)
      // Nothing held, nothing shown: an empty drawer is one more thing to read
      // on a screen that is mostly read at a glance.
      heldSection.classList.toggle('hidden', held.length === 0)
      if (held.length === 0) {
        heldList.classList.add('hidden')
        heldToggle.setAttribute('aria-expanded', 'false')
        heldChevron.textContent = 'expand_more'
      }
      heldList.replaceChildren(...held.map((sale) => heldRow(sale)))
    } catch {
      // A failed badge refresh is not worth interrupting a sale for.
    }
  }

  const heldList = h('div', { class: 'space-y-1 px-3 pb-3 max-h-48 overflow-y-auto' })

  /**
   * Held sales are a drawer, not a permanent block.
   *
   * They used to sit open at the bottom of the panel under a bare "Held sales"
   * label, stealing height from the cart and reading as a stray fragment when
   * there was nothing to show. Now the section hides itself entirely when the
   * count is zero, and opens on demand.
   */
  const heldToggle = h('button', {
    type: 'button',
    class:
      'flex w-full items-center gap-2 border-t border-border px-3 py-2 text-xs font-medium ' +
      'text-content-muted hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 ' +
      'focus-visible:ring-ring',
    'aria-expanded': 'false',
  }) as HTMLButtonElement
  const heldChevron = icon('expand_more', 'text-base transition-transform')
  const heldCount = h('span', { class: 'ml-auto tabular-nums', text: '0' })
  heldToggle.append(icon('pause_circle', 'text-base'), h('span', { text: 'Held sales' }), heldCount, heldChevron)

  const heldSection = h('div', { class: 'hidden' }, heldToggle, heldList)
  heldList.classList.add('hidden')

  heldToggle.addEventListener('click', () => {
    const open = heldList.classList.toggle('hidden') === false
    heldToggle.setAttribute('aria-expanded', String(open))
    heldChevron.textContent = open ? 'expand_less' : 'expand_more'
  })

  function heldRow(sale: SaleRow): HTMLElement {
    const heldFor = Math.max(0, Math.round((Date.now() - new Date(sale.created_at).getTime()) / 60000))
    return h('div', { class: 'flex items-center justify-between gap-2 rounded-md border border-border p-2' },
      h('div', { class: 'min-w-0' },
        h('p', { class: 'text-xs font-medium text-content truncate', text: sale.customer?.name ?? 'Walk-in' }),
        h('p', { class: 'text-[11px] text-content-subtle', text: `${sale.invoice_no} · ${heldFor}m ago` })
      ),
      button('Resume', {
        size: 'sm',
        variant: 'outline',
        onClick: () => void resumeHeld(sale.id),
      })
    )
  }

  async function resumeHeld(saleId: string): Promise<void> {
    if (cart.state.cart.lines.length > 0) {
      const ok = await confirm('Replace the current cart?', {
        message: 'Resuming a held sale discards the cart on screen.',
        confirmLabel: 'Resume',
      })
      if (!ok) return
    }
    cart.setBusy(true)
    try {
      const resumed = await sales.resume(saleId, floor!.warehouseId)
      cart.replace(resumed.cart, saleId)
      // The held row carries the customer's id; the name is a lookup, and a
      // failure to fetch it must not lose the sale — the id is what the server
      // stores and what the receipt is joined from.
      attachedCustomer = resumed.customerId
        ? await repos.customers.get(resumed.customerId).catch(() => null)
        : null
      renderCustomer()
      // A held sale was parked without its adjustments (see `holdCart`), so
      // anything on it now is a discount this till cannot explain.
      releaseAll('cleared')
      syncOrderDiscount()
      toastSuccess('Held sale resumed.')
      searchField.focus()
    } catch (error) {
      toastError(translateError(error).message)
    } finally {
      cart.setBusy(false)
    }
  }

  // ── Keyboard ────────────────────────────────────────────────────────────

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'F2') {
      event.preventDefault()
      openPayment()
    } else if (event.key === 'F4') {
      event.preventDefault()
      void holdCart()
    } else if (event.key === 'F8') {
      event.preventDefault()
      void clearCart()
    } else if (event.key === '/' && document.activeElement !== searchField) {
      event.preventDefault()
      searchField.focus()
    }
  }

  const unsubscribeCart = cart.store.subscribe(() => renderCart())

  // ── Layout ──────────────────────────────────────────────────────────────

  const busyIndicator = h('div', { class: 'hidden items-center gap-2 px-3 py-1 text-xs text-content-muted' })

  root.append(
    h('section', { class: 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden' },
      // The search field is the till's front door and stays put while the grid
      // scrolls under it.
      h('div', { class: 'shrink-0 border-b border-border bg-surface px-3 pt-3 pb-2' }, searchField),
      statusLine,
      h('div', { class: 'flex-1 min-h-0 overflow-y-auto' }, grid),
      // The keyboard contract, stated where a new cashier will see it. Hidden
      // on touch-sized screens, where there are no F-keys to press.
      h('p', {
        class: 'hidden border-t border-border px-3 py-1.5 text-[11px] text-content-subtle sm:block',
        text: 'Enter add · ↑↓ choose · F2 pay · F4 hold · F8 clear',
      })
    ),
    // The cart is a fixed rail beside the catalogue on a desktop, and the
    // lower half of the screen on a phone — a counter is as often a phone in
    // portrait as it is a widescreen till, and a 360px rail squeezed into a
    // 390px viewport is neither.
    h('aside', {
      class:
        'flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-t border-border bg-surface ' +
        'lg:h-full lg:w-[380px] lg:border-l lg:border-t-0 xl:w-[420px]',
    },
      h('div', { class: 'flex items-center gap-2 border-b border-border px-3 py-2' },
        h('p', { class: 'text-sm font-semibold text-content', text: 'Current sale' }),
        lineCountBadge,
        h('div', { class: 'ml-auto' }, heldBadge)
      ),
      busyIndicator,
      customerLine,
      lineList,
      // Money off sits directly above the totals it changes, and above the
      // plugin panels that describe the sale.
      adjustmentsSlot,
      totalsBox,
      panelsSlot,
      h('div', { class: 'border-t border-border p-3 space-y-2' },
        payButton,
        h('div', { class: 'grid grid-cols-2 gap-2' }, holdButton, clearButton)
      ),
      heldSection
    )
  )

  // Initial load. The grid is populated before the first paint of results so
  // the cashier sees something immediately rather than an empty pane.
  renderCustomer()
  void runSearch('')
  // A discount restored from a draft has no plugin quote behind it any more —
  // the redemption died with the tab. Dropping it here is what stops an
  // unexplained amount coming off every sale until someone notices.
  syncOrderDiscount()
  renderCart()
  busyIndicator.append(spinner('h-3 w-3'), h('span', { text: 'Working…' }))
  cart.store.select(
    (state) => state.busy,
    (busy) => busyIndicator.classList.toggle('hidden', !busy)
  )

  document.addEventListener('keydown', onKeyDown)

  // Tear down the document listener when the router replaces this view, or the
  // F-keys keep firing against a screen that is no longer there.
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      observer.disconnect()
      document.removeEventListener('keydown', onKeyDown)
      unsubscribeCart()
      if (searchTimer) clearTimeout(searchTimer)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  return root
}

/** PostgREST returns numeric as text; convert for display. */
function minorFromString(value: string): Minor {
  return Math.round(Number(value) * 100) as Minor
}
