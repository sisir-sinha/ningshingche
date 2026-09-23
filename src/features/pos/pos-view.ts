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

import { h } from '../../components/ui/h'
import { button, iconButton, spinner } from '../../components/ui/button'
import { badge, emptyState } from '../../components/ui/card'
import { toastError, toastSuccess, toastWarning } from '../../components/feedback/toast'
import { confirm } from '../../components/feedback/modal'
import { input } from '../../components/ui/input'
import { CartStore } from './cart-store'
import { SaleService, toCartLine } from './sale-service'
import { openPaymentDialog } from './payment-dialog'
import { openReceipt } from './receipt'
import { salesFloor } from '../../app/state/sales-floor'
import { activeOrganization } from '../../app/state/session'
import { getRepositories } from '../../app/data'
import type { EventBus } from '../../shared/bus/event-bus'
import type { SellableProduct } from '../../shared/repositories/contracts'
import type { SaleRow } from '../../shared/types/records'
import {
  formatMoney,
  formatQty,
  milli,
  parseMilli,
  type Milli,
  type Minor,
} from '../../shared/domain/money'
import { translateError } from '../../app/platform/errors'

export interface PosViewOptions {
  bus: EventBus
  onNavigate?: (path: string) => void
}

export function posView(options: PosViewOptions): HTMLElement {
  const { bus } = options
  const floor = salesFloor()
  const organization = activeOrganization()
  const currency = organization?.currency ?? 'BDT'

  if (!floor) {
    return emptyState('The shop is still loading', {
      description: 'Branch, stock room and register are resolved when you sign in.',
      iconName: 'hourglass_top',
    })
  }

  const repos = getRepositories()
  const sales = new SaleService(repos, bus)
  const cart = new CartStore(floor.branchId)

  const root = h('div', { class: 'flex h-full min-h-0' })

  // ── Left: catalogue ─────────────────────────────────────────────────────

  let results: SellableProduct[] = []
  let highlighted = 0
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  const grid = h('div', {
    class: 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 p-3',
  })

  const statusLine = h('p', { class: 'px-3 pb-1 text-xs text-content-subtle' })

  const searchField = input({
    type: 'search',
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

  function addToCart(product: SellableProduct): void {
    const step: Milli = product.decimalQuantity ? milli(250) : milli(1000)
    cart.add(toCartLine(product), step)
  }

  function renderResults(): void {
    if (results.length === 0) {
      statusLine.textContent = 'No products match.'
      grid.replaceChildren(
        h('div', { class: 'col-span-full py-10 text-center text-sm text-content-subtle' },
          'Nothing found. Add the product first, or check the spelling.')
      )
      return
    }
    statusLine.textContent = `${results.length} product${results.length === 1 ? '' : 's'}`
    grid.replaceChildren(...results.map((product, index) => productTile(product, index)))
  }

  function productTile(product: SellableProduct, index: number): HTMLElement {
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
          'text-left rounded-lg border p-2.5 transition-colors min-h-[76px]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          index === highlighted
            ? 'border-primary bg-primary/5 ring-1 ring-primary'
            : 'border-border bg-surface hover:bg-surface-muted',
          out ? 'opacity-60' : '',
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
      h('div', { class: 'mt-1.5 flex items-center justify-between gap-1' },
        h('span', {
          class: 'text-sm font-semibold text-content tabular-nums',
          text: formatMoney(product.price, { currency }),
        }),
        product.trackStock
          ? h('span', {
              class: `text-[11px] tabular-nums ${out ? 'text-danger' : 'text-content-subtle'}`,
              text: formatQty(product.availableQty ?? milli(0), {
                decimal: product.decimalQuantity,
              }),
            })
          : null
      )
    )
  }

  // ── Right: cart ─────────────────────────────────────────────────────────

  const lineList = h('div', { class: 'flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1' })
  const totalsBox = h('div', { class: 'border-t border-border px-3 py-2 space-y-1' })
  const heldBadge = badge('0', { tone: 'warning', iconName: 'pause_circle' })

  function renderCart(): void {
    const state = cart.state
    if (state.cart.lines.length === 0) {
      lineList.replaceChildren(
        h('div', { class: 'py-12 text-center text-sm text-content-subtle' },
          'Scan or search to start a sale.')
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
      h('div', { class: 'flex items-baseline justify-between pt-1.5 border-t border-border' },
        h('span', { class: 'text-sm font-medium text-content', text: 'Total' }),
        h('span', {
          class: 'text-2xl font-semibold text-content tabular-nums tracking-tight',
          text: formatMoney(totals.total, { currency }),
        })
      )
    )

    payButton.disabled = state.cart.lines.length === 0 || state.busy
    holdButton.disabled = state.cart.lines.length === 0 || state.busy
    clearButton.disabled = state.cart.lines.length === 0 || state.busy
    void refreshHeld()
  }

  function totalRow(label: string, amount: Minor, extraClass = ''): HTMLElement {
    return h('div', { class: 'flex items-baseline justify-between' },
      h('span', { class: 'text-xs text-content-muted', text: label }),
      h('span', { class: `text-sm text-content tabular-nums ${extraClass}`.trim(), text: formatMoney(amount, { currency }) })
    )
  }

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
      class: 'h-8 w-16 text-center text-sm tabular-nums',
      onEnter: (value) => {
        const parsed = parseMilli(value, { decimal: line.decimalQuantity })
        if (parsed !== null && parsed > 0) cart.setQuantity(lineId, parsed)
        else renderCart()
      },
    })

    return h(
      'div',
      {
        class: `flex items-start gap-2 rounded-md border p-2 ${
          oversold ? 'border-danger bg-danger/5' : 'border-border'
        }`.trim(),
      },
      h('div', { class: 'flex-1 min-w-0' },
        h('p', { class: 'text-sm text-content leading-tight truncate', text: line.name }),
        line.variantName
          ? h('p', { class: 'text-xs text-content-muted', text: line.variantName })
          : null,
        oversold
          ? h('p', {
              class: 'text-[11px] text-danger mt-0.5',
              text: `Only ${formatQty(line.availableQty ?? milli(0), { decimal: line.decimalQuantity })} in stock`,
            })
          : null,
        h('p', { class: 'text-xs text-content-subtle tabular-nums mt-0.5', text: formatMoney(line.unitPrice, { currency }) })
      ),
      h('div', { class: 'flex items-center gap-1 shrink-0' },
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
      ),
      h('div', { class: 'text-right shrink-0' },
        h('p', { class: 'text-sm font-medium text-content tabular-nums', text: formatMoney(totals?.total ?? (0 as Minor), { currency }) }),
        iconButton('delete', 'Remove line', {
          size: 'sm',
          variant: 'ghost',
          onClick: () => cart.remove(lineId),
        })
      )
    )
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  const payButton = button('Pay', {
    variant: 'primary',
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
    variant: 'ghost',
    size: 'lg',
    icon: 'delete_sweep',
    onClick: () => void clearCart(),
  })

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
              heldSaleId: cart.state.heldSaleId,
            })
            const heldId = cart.state.heldSaleId
            cart.clear()
            toastSuccess(`Sale ${result.invoice_no} · ${formatMoney(minorFromString(result.total), { currency })}`)
            const sale = await repos.sales.get(result.sale_id)
            if (sale) openReceipt(sale, currency)
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
      cart.clear()
      searchField.focus()
    }
  }

  async function refreshHeld(): Promise<void> {
    try {
      const held = await repos.sales.held(floor!.branchId)
      heldBadge.querySelector('span:last-child')!.textContent = String(held.length)
      heldBadge.classList.toggle('hidden', held.length === 0)
      heldList.replaceChildren(
        ...held.map((sale) => heldRow(sale))
      )
    } catch {
      // A failed badge refresh is not worth interrupting a sale for.
    }
  }

  const heldList = h('div', { class: 'space-y-1' })

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
    h('section', { class: 'flex-1 min-w-0 flex flex-col border-r border-border' },
      h('div', { class: 'p-3 pb-2' }, searchField),
      statusLine,
      h('div', { class: 'flex-1 min-h-0 overflow-y-auto' }, grid),
      h('p', {
        class: 'px-3 py-1.5 text-[11px] text-content-subtle border-t border-border',
        text: 'Enter add · ↑↓ choose · F2 pay · F4 hold · F8 clear',
      })
    ),
    h('aside', { class: 'w-[360px] shrink-0 flex flex-col bg-surface' },
      h('div', { class: 'flex items-center justify-between gap-2 px-3 py-2 border-b border-border' },
        h('p', { class: 'text-sm font-semibold text-content', text: 'Current sale' }),
        heldBadge
      ),
      busyIndicator,
      lineList,
      totalsBox,
      h('div', { class: 'p-3 space-y-2 border-t border-border' },
        payButton,
        h('div', { class: 'flex gap-2' }, holdButton, clearButton)
      ),
      h('div', { class: 'px-3 pb-3 max-h-40 overflow-y-auto' },
        h('p', { class: 'text-xs font-medium text-content-muted mb-1.5', text: 'Held sales' }),
        heldList
      )
    )
  )

  // Initial load. The grid is populated before the first paint of results so
  // the cashier sees something immediately rather than an empty pane.
  void runSearch('')
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
