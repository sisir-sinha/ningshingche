/**
 * Taking the money.
 *
 * Two faults shipped together and produced the screenshot that started this:
 *
 *   1. The dialog re-labelled its primary button with
 *      `submitButton.querySelector('span')`, which finds the *icon* span when
 *      the button has an icon. \"Still owed ৳900.00\" was being written into a
 *      Material Symbols element and drawn as glyph soup across the real label.
 *   2. The button was disabled until a tender had been added, and the only way
 *      to add one was the Enter key. On a ৳900.00 sale with ৳900.00 already
 *      typed into the amount field, a touch-screen cashier had no way forward.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openPaymentDialog } from './payment-dialog'
import { minor } from '../../shared/domain/money'
import type { PaymentMethod } from '../../shared/types/records'

const CASH = { id: 'm-1', key: 'CASH', name: 'Cash', icon: 'payments' } as unknown as PaymentMethod
const CARD = { id: 'm-2', key: 'CARD', name: 'Card', icon: 'credit_card' } as unknown as PaymentMethod

const submitButton = (): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.className.includes('w-full')
  )!

const label = (): string => submitButton().querySelector('[data-label]')!.textContent ?? ''

const amountBox = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>('input[inputmode=decimal]')!

const type = (value: string): void => {
  const box = amountBox()
  box.value = value
  box.dispatchEvent(new Event('input', { bubbles: true }))
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => document.body.replaceChildren())
afterEach(() => document.body.replaceChildren())

describe('the button that takes the money', () => {
  it('writes its label into the label, not into the icon', async () => {
    openPaymentDialog({ total: minor(90000), methods: [CASH], currency: 'BDT', onSubmit: () => undefined })
    await settle()

    const icon = submitButton().querySelector('.material-symbols-rounded, [class*=material-symbols]')
    // The icon is still an icon — the only thing an icon font can render.
    expect(icon?.textContent).toBe('check_circle')
    expect(label()).not.toContain('Still owed')
  })

  it('offers to complete the sale when the pre-filled amount already covers it', async () => {
    openPaymentDialog({ total: minor(90000), methods: [CASH], currency: 'BDT', onSubmit: () => undefined })
    await settle()

    // The field opens pre-filled with the balance. That is a payable sale.
    expect(amountBox().value).toBe('900.00')
    expect(label()).toBe('Complete sale')
    expect(submitButton().disabled).toBe(false)
  })

  it('completes the sale on a click, with no keyboard anywhere', async () => {
    const onSubmit = vi.fn()
    openPaymentDialog({ total: minor(90000), methods: [CASH], currency: 'BDT', onSubmit })
    await settle()

    submitButton().click()
    await settle()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]![0]).toEqual([
      { methodId: 'm-1', methodKey: 'CASH', methodName: 'Cash', amount: 90000 },
    ])
  })

  it('names the change before the cashier commits to it', async () => {
    openPaymentDialog({ total: minor(90000), methods: [CASH], currency: 'BDT', onSubmit: () => undefined })
    await settle()

    type('1000')
    expect(label()).toBe('Complete · change 100.00')
  })

  it('offers a part payment as a part payment, not as a dead end', async () => {
    openPaymentDialog({ total: minor(90000), methods: [CASH], currency: 'BDT', onSubmit: () => undefined })
    await settle()

    type('500')
    expect(label()).toBe('Add 500.00 · 400.00 left')
    expect(submitButton().disabled).toBe(false)
  })

  it('takes a split payment entirely by click', async () => {
    const onSubmit = vi.fn()
    openPaymentDialog({ total: minor(90000), methods: [CASH, CARD], currency: 'BDT', onSubmit })
    await settle()

    type('500')
    submitButton().click()
    await settle()
    expect(onSubmit).not.toHaveBeenCalled()

    // The rest on a card.
    ;[...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Card'))!
      .click()
    type('400')
    submitButton().click()
    await settle()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]![0]).toHaveLength(2)
  })

  it('says what is owed, and refuses, when the field is empty', async () => {
    openPaymentDialog({ total: minor(90000), methods: [CASH], currency: 'BDT', onSubmit: () => undefined })
    await settle()

    type('')
    expect(label()).toBe('Still owed 900.00')
    expect(submitButton().disabled).toBe(true)
  })
})
