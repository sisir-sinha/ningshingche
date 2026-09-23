/**
 * Receipts (spec §54).
 *
 * Two halves, deliberately separated. `buildReceipt` turns a sale row into a
 * plain data structure — no DOM, no formatting — and `renderReceipt` turns
 * that into an 80mm layout. The split matters because the data model is what
 * an Android client, an email sender and a fiscal-reporting integration all
 * need, while the 80mm template is one of several possible renderings.
 *
 * 80mm thermal stock is 72mm printable inside the margins. At 96dpi that is
 * about 272px, so the layout is fixed to that width rather than made
 * responsive: a receipt that reflows is a receipt that does not fit the paper.
 */

import { h } from '../../components/ui/h'
import { formatMoney, formatQty, milli, minor, type Minor } from '../../shared/domain/money'
import type { SaleRow } from '../../shared/types/records'

// ── Data model ────────────────────────────────────────────────────────────

export interface ReceiptLine {
  name: string
  variant: string | null
  /** Already carries the unit symbol, e.g. `1.5 kg` or `3 ea`. */
  quantity: string
  unitPrice: string
  lineTotal: string
}

export interface ReceiptData {
  shopName: string
  invoiceNo: string
  status: string
  soldAt: string
  cashier: string
  customer: string
  currency: string
  lines: ReceiptLine[]
  subtotal: string
  discount: string
  tax: string
  total: string
  paid: string
  change: string
  note: string | null
}

/**
 * Turn a stored sale into a receipt.
 *
 * Reads only the columns the sale actually has. Nothing here recomputes a
 * total: the numbers on the paper are the numbers Postgres stored, so a
 * reprint months later matches the original.
 */
export function buildReceipt(sale: SaleRow, shopName: string): ReceiptData {
  const money = (value: string | null | undefined): string =>
    formatMoney(minor(Math.round(Number(value ?? 0) * 100) as Minor), {
      currency: sale.currency,
    })

  return {
    shopName,
    invoiceNo: sale.invoice_no,
    status: humanStatus(sale.status),
    soldAt: new Date(sale.completed_at ?? sale.created_at).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    cashier: sale.created_by ?? '—',
    customer: sale.customer?.name ?? 'Walk-in',
    currency: sale.currency,
    lines: (sale.items ?? []).map((item) => ({
      name: item.product_name,
      variant: item.variant_name,
      quantity: formatQty(milli(Math.round(Number(item.quantity) * 1000)), {
        decimal: !Number.isInteger(Number(item.quantity)),
        unitLabel: item.unit_label ?? undefined,
      }),
      unitPrice: money(item.unit_price),
      lineTotal: money(item.line_total),
    })),
    subtotal: money(sale.subtotal),
    discount: money(sale.discount_total),
    tax: money(sale.tax_total),
    total: money(sale.total),
    paid: money(sale.paid_total),
    change: money(sale.change_due),
    note: sale.note,
  }
}

function humanStatus(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'Paid'
    case 'PARTIALLY_PAID':
      return 'Part paid'
    case 'REFUNDED':
      return 'Refunded'
    case 'PARTIALLY_REFUNDED':
      return 'Part refunded'
    default:
      return status
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────

/** 72mm at 96dpi, which is the printable width inside 80mm stock. */
const RECEIPT_WIDTH_PX = 272

const RECEIPT_CSS = `
  .mekholi-receipt {
    width: ${RECEIPT_WIDTH_PX}px;
    margin: 0 auto;
    padding: 8px 4px 16px;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.45;
    color: #000;
    background: #fff;
  }
  .mekholi-receipt h1 { font-size: 14px; text-align: center; margin: 0 0 2px; letter-spacing: .04em; }
  .mekholi-receipt .center { text-align: center; }
  .mekholi-receipt .rule { border-top: 1px dashed #000; margin: 6px 0; }
  .mekholi-receipt table { width: 100%; border-collapse: collapse; }
  .mekholi-receipt td { vertical-align: top; padding: 1px 0; }
  .mekholi-receipt td.num { text-align: right; white-space: nowrap; }
  .mekholi-receipt .muted { opacity: .75; }
  .mekholi-receipt .big { font-size: 14px; font-weight: 700; }
  @media print {
    body { margin: 0; background: #fff; }
    body > *:not(#mekholi-print-root) { display: none !important; }
    #mekholi-print-root { position: static; inset: auto; background: #fff; padding: 0; overflow: visible; }
    .mekholi-receipt-actions { display: none !important; }
    @page { size: 80mm auto; margin: 2mm; }
  }
`

/**
 * Show the receipt and offer to print it.
 *
 * Rendered into a dedicated root that the print stylesheet isolates, so
 * printing produces the receipt alone rather than the POS screen with a
 * receipt floating over it.
 */
export function openReceipt(sale: SaleRow, currency: string, shopName = 'Mekholi'): { close: () => void } {
  const data = buildReceipt(sale, shopName)
  void currency

  const overlay = h('div', {
    id: 'mekholi-print-root',
    class: 'fixed inset-0 z-50 overflow-y-auto bg-content/40 p-4',
    style: { backdropFilter: 'blur(2px)' },
  })

  const close = (): void => {
    overlay.remove()
    document.removeEventListener('keydown', onKey)
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') close()
  }
  document.addEventListener('keydown', onKey)

  const actions = h(
    'div',
    { class: 'mekholi-receipt-actions mx-auto mb-3 flex max-w-[272px] gap-2' },
    h('button', {
      type: 'button',
      class: 'flex-1 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium',
      text: 'Print',
      onclick: () => window.print(),
    }),
    h('button', {
      type: 'button',
      class: 'flex-1 h-9 rounded-md border border-border bg-surface text-content text-sm font-medium',
      text: 'Close',
      onclick: () => close(),
    })
  )

  overlay.append(h('style', { text: RECEIPT_CSS }), actions, renderReceipt(data))
  document.body.appendChild(overlay)
  return { close }
}

/** The 80mm layout. Pure: give it data, get a node. */
export function renderReceipt(data: ReceiptData): HTMLElement {
  const row = (label: string, value: string, strong = false): HTMLElement =>
    h('tr', {},
      h('td', { class: strong ? 'big' : '', text: label }),
      h('td', { class: `num ${strong ? 'big' : ''}`.trim(), text: value })
    )

  return h(
    'div',
    { class: 'mekholi-receipt' },
    h('h1', { text: data.shopName }),
    h('p', { class: 'center muted', text: data.invoiceNo }),
    h('p', { class: 'center muted', text: `${data.soldAt} · ${data.status}` }),
    h('p', { class: 'center muted', text: `Served: ${data.customer}` }),

    h('div', { class: 'rule' }),

    h('table', {},
      h('tbody', {},
        ...data.lines.flatMap((line) => [
          h('tr', {}, h('td', { colspan: '2', text: line.name })),
          ...(line.variant ? [h('tr', {}, h('td', { colspan: '2', class: 'muted', text: `  ${line.variant}` }))] : []),
          h('tr', {},
            h('td', { class: 'muted', text: `  ${line.quantity} × ${line.unitPrice}` }),
            h('td', { class: 'num', text: line.lineTotal })
          ),
        ])
      )
    ),

    h('div', { class: 'rule' }),

    h('table', {},
      h('tbody', {},
        row('Subtotal', data.subtotal),
        ...(Number(data.discount.replace(/[^0-9.-]/g, '')) > 0 ? [row('Discount', `-${data.discount}`)] : []),
        ...(Number(data.tax.replace(/[^0-9.-]/g, '')) > 0 ? [row('Tax', data.tax)] : []),
        row('TOTAL', data.total, true),
        row('Paid', data.paid),
        row('Change', data.change)
      )
    ),

    ...(data.note ? [h('div', { class: 'rule' }), h('p', { class: 'muted', text: data.note })] : []),

    h('div', { class: 'rule' }),
    h('p', { class: 'center muted', text: 'Thank you' })
  )
}
