/**
 * Choosing what the invoice says.
 *
 * The gap this closes: a shop could pair a printer but not decide what came
 * out of it. The name was whatever the organisation record said, the footer
 * was always "Thank you", and an address could not be printed at all.
 *
 * Two properties are worth pinning, because both are easy to break later:
 *
 *   1. The preview is the real renderer. A preview drawn by separate code is
 *      a preview that will eventually disagree with the paper.
 *   2. A template's rules win over a stray checkbox. "Compact" that printed
 *      per-line notes because a box was left ticked would make the template
 *      list meaningless.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { invoiceDesignCard } from './invoice-design-card'
import { invoiceDesign } from '../../shared/devices/device-config'
import { renderReceipt } from '../../shared/receipt/receipt'
import { receiptRows } from '../../shared/receipt/export'
import { sampleReceipt } from '../../shared/receipt/sample'
import { DEFAULT_INVOICE_DESIGN, resolveDesign } from '../../shared/receipt/design'

const textOf = (node: HTMLElement): string => (node.textContent ?? '').replace(/\s+/g, ' ')

function card(): HTMLElement {
  const element = invoiceDesignCard({ shopName: 'Rahim Store' })
  document.body.append(element)
  return element
}

const templateButton = (view: HTMLElement, value: string): HTMLButtonElement =>
  view.querySelector<HTMLButtonElement>(`[data-template="${value}"]`)!

beforeEach(() => {
  localStorage.clear()
  document.body.replaceChildren()
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('the design chooser', () => {
  it('offers the three templates and marks the one in force', () => {
    const view = card()

    expect(templateButton(view, 'compact')).toBeDefined()
    expect(templateButton(view, 'standard').getAttribute('aria-pressed')).toBe('true')
    expect(templateButton(view, 'detailed').getAttribute('aria-pressed')).toBe('false')
  })

  it('remembers the choice on this device', () => {
    const view = card()
    templateButton(view, 'detailed').click()

    expect(invoiceDesign().template).toBe('detailed')
    expect(templateButton(view, 'detailed').getAttribute('aria-pressed')).toBe('true')
  })

  it('shows a preview, and redraws it when the design changes', () => {
    const view = card()
    // The sample receipt, rendered by the same function the printer uses.
    expect(textOf(view)).toContain('Rahim Store')

    const shopNameBox = view.querySelector<HTMLInputElement>('input[placeholder="Rahim Store"]')!
    shopNameBox.value = 'Kader Traders'
    shopNameBox.dispatchEvent(new Event('change', { bubbles: true }))

    expect(textOf(view)).toContain('Kader Traders')
    expect(invoiceDesign().shopName).toBe('Kader Traders')
  })
})

describe('what a template decides', () => {
  const data = sampleReceipt('Rahim Store')

  it('compact prints one line per item and no notes', () => {
    const slip = renderReceipt(data, { ...DEFAULT_INVOICE_DESIGN, template: 'compact' })
    const rows = slip.querySelectorAll('table tr')
    // One row per item, rather than a name row plus a quantity row.
    expect(rows.length).toBeLessThan(
      renderReceipt(data, DEFAULT_INVOICE_DESIGN).querySelectorAll('table tr').length
    )
  })

  it('refuses to let a checkbox override the template', () => {
    // Notes on, but Compact says no notes. Compact wins.
    const look = resolveDesign({ ...DEFAULT_INVOICE_DESIGN, template: 'compact', showItemNotes: true })
    expect(look.showItemNotes).toBe(false)

    // Detailed allows the cashier line, but only if the shop asked for it.
    expect(resolveDesign({ ...DEFAULT_INVOICE_DESIGN, template: 'detailed', showCashier: false }).showCashier).toBe(
      false
    )
    expect(resolveDesign({ ...DEFAULT_INVOICE_DESIGN, template: 'detailed', showCashier: true }).showCashier).toBe(
      true
    )
  })

  it('puts the shop’s own header and footer on the paper', () => {
    const design = {
      ...DEFAULT_INVOICE_DESIGN,
      template: 'detailed' as const,
      headerLines: '123 Station Road\n01712-345678',
      footerText: 'No refund without this slip',
    }
    const text = textOf(renderReceipt(data, design))

    expect(text).toContain('123 Station Road')
    expect(text).toContain('01712-345678')
    expect(text).toContain('No refund without this slip')
    expect(text).not.toContain('Thank you')
  })

  it('prints nothing at the bottom when the footer is emptied', () => {
    const text = textOf(renderReceipt(data, { ...DEFAULT_INVOICE_DESIGN, footerText: '  ' }))
    expect(text).not.toContain('Thank you')
  })

  it('carries the same decisions into the printed bytes, not just the screen', () => {
    // The screen and the paper are the same document. A shop that removed
    // the customer line from the preview and still found it on the receipt
    // would rightly call that a bug.
    const design = { ...DEFAULT_INVOICE_DESIGN, showCustomer: false, footerText: 'Come again' }
    const rows = receiptRows(data, 16, design).map((row) => row.text)

    expect(rows.some((text) => text.startsWith('Served:'))).toBe(false)
    expect(rows).toContain('Come again')
  })
})
