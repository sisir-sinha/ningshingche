/**
 * Recording an expense — the submit button.
 *
 * The reported symptom was "submit not working", and it was three faults
 * stacked so that they looked like one dead button:
 *
 *   1. The screen posted `branchId: ''` whenever the sales floor had not
 *      resolved yet. Postgres rejects the empty string as a uuid (22P02).
 *   2. That error's message, `invalid input syntax for type uuid: ""`, was
 *      stripped at the colon by the translator and reached the dialog as
 *      two quote marks — a red line with nothing in it.
 *   3. Enter did nothing, and the button showed no busy state, so the only
 *      remaining feedback was a tap that appeared to be ignored.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { expensesView } from './expenses-view'
import { toMinor } from '../../shared/domain/money'

interface ExpenseInput {
  branchId: string
  amount: number
  methodId: string | null
  sessionId: string | null
}
const create = vi.fn(async (_input: ExpenseInput) => 'e-1')
const listExpenses = vi.fn(async () => ({ items: [], nextCursor: null }))

vi.mock('../../app/data', () => ({
  getRepositories: () => ({
    expenses: {
      list: listExpenses,
      totalForDay: vi.fn(async () => toMinor(0)),
      categories: vi.fn(async () => [{ id: 'c-1', name: 'Rent', isSystem: true }]),
      create,
      remove: vi.fn(),
      createCategory: vi.fn(),
      removeCategory: vi.fn(),
    },
    catalog: {
      listPaymentMethods: vi.fn(async () => [{ id: 'm-1', name: 'Cash', is_cash: true, is_active: true }]),
    },
  }),
}))

vi.mock('../../app/state/session', () => ({
  activeOrganization: () => ({ organization_id: 'org-1', currency: 'BDT' }),
  can: () => true,
}))

let floor: { branchId: string; sessionId: string | null } | null = null
let resolvesTo: { branchId: string; sessionId: string | null } | null = null
const refreshSalesFloor = vi.fn(async () => {
  floor = resolvesTo
  return floor
})

vi.mock('../../app/state/sales-floor', () => ({
  salesFloor: () => floor,
  refreshSalesFloor: () => refreshSalesFloor(),
}))

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

/** Buttons carry an icon ligature in a sibling span; match on the label. */
const byLabel = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find(
    (b) => (b.querySelector('[data-label]')?.textContent ?? b.textContent ?? '').trim() === text
  )

const shownError = (): string =>
  [...document.querySelectorAll<HTMLElement>('[role="alert"]')]
    .filter((node) => !node.classList.contains('hidden'))
    .map((node) => node.textContent ?? '')
    .join(' ')
    .trim()

async function openForm(): Promise<void> {
  document.body.append(expensesView())
  await settle()
  byLabel('Record an expense')?.click()
  await settle()
}

const amountField = (): HTMLInputElement => document.querySelector<HTMLInputElement>('#expense-amount')!

beforeEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
  floor = { branchId: 'b-1', sessionId: null }
  resolvesTo = { branchId: 'b-1', sessionId: null }
})

describe('recording an expense', () => {
  it('records it, and says so', async () => {
    await openForm()
    amountField().value = '500'
    byLabel('Record expense')?.click()
    await settle()

    expect(shownError()).toBe('')
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[0]).toMatchObject({ branchId: 'b-1', amount: 50000, methodId: 'm-1' })
  })

  it('resolves the branch first rather than posting an empty one', async () => {
    // Opening Expenses straight from a cold start: the floor has not been
    // asked for yet. It used to send branchId: '' and let the database
    // refuse it.
    floor = null
    await openForm()
    amountField().value = '500'
    byLabel('Record expense')?.click()
    await settle()

    expect(refreshSalesFloor).toHaveBeenCalled()
    expect(create.mock.calls[0]?.[0]).toMatchObject({ branchId: 'b-1' })
  })

  it('explains itself when the shop genuinely has no branch', async () => {
    floor = null
    resolvesTo = null
    await openForm()
    amountField().value = '500'
    byLabel('Record expense')?.click()
    await settle()

    expect(create).not.toHaveBeenCalled()
    expect(shownError()).toContain('no branch')
    // And the button comes back, rather than staying disabled forever.
    expect(byLabel('Record expense')?.disabled).toBe(false)
  })

  it('records on Enter, from the amount the shopkeeper just typed', async () => {
    await openForm()
    const amount = amountField()
    amount.value = '500'
    amount.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()

    expect(create).toHaveBeenCalledTimes(1)
  })

  it('refuses an empty or zero amount, and says which', async () => {
    await openForm()
    byLabel('Record expense')?.click()
    await settle()

    expect(create).not.toHaveBeenCalled()
    expect(shownError()).toContain('greater than zero')
  })

  it('shows the drawer reason instead of a database complaint', async () => {
    floor = { branchId: 'b-1', sessionId: null }
    await openForm()
    amountField().value = '500'
    const checkbox = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!
    checkbox.checked = true
    byLabel('Record expense')?.click()
    await settle()

    expect(create).not.toHaveBeenCalled()
    expect(shownError()).toContain('No drawer is open')
  })

  it('never reports a failure as an empty message', async () => {
    create.mockRejectedValueOnce(
      Object.assign(new Error('invalid input syntax for type uuid: ""'), { code: '22P02' })
    )
    await openForm()
    amountField().value = '500'
    byLabel('Record expense')?.click()
    await settle()

    const message = shownError()
    expect(message.replace(/["'\s]/g, '').length).toBeGreaterThan(10)
    expect(message).toContain('try again')
  })

  it('will not fire twice while the first save is in flight', async () => {
    let release = (): void => {}
    create.mockImplementationOnce(
      async () => new Promise<string>((resolve) => { release = () => resolve('e-1') })
    )
    await openForm()
    amountField().value = '500'

    const submit = byLabel('Record expense')!
    submit.click()
    await settle()
    expect(submit.disabled).toBe(true)
    expect(submit.textContent).toContain('Recording')

    submit.click()
    amountField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(create).toHaveBeenCalledTimes(1)

    release()
    await settle()
  })
})
