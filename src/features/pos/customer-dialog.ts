/**
 * Attaching a customer to the sale (spec §19).
 *
 * The cart has modelled a customer since the first commit — `Cart.customerId`,
 * `p_customer_id` on `complete_sale`, `sales.customer_id`, and a receipt that
 * prints the name — and nothing in the till ever set it. Every sale was a
 * walk-in: a shop could not say who bought what, and no add-on could be about
 * the person standing at the counter, which is why a loyalty screen could say
 * "attach a customer to award points" and no cashier could.
 *
 * So this is deliberately small, and deliberately core. A customer is a name
 * and a phone number (§19); everything else is optional. The dialog searches
 * what the shop already has, and — when the search finds nobody and the user
 * may create — offers to add exactly what was typed, because that is the moment
 * the shopkeeper has the information and the reason to write it down.
 */

import { h, mount } from '../../components/ui/h'
import { button, spinner } from '../../components/ui/button'
import { modal } from '../../components/feedback/modal'
import { input, field } from '../../components/ui/input'
import { toastError } from '../../components/feedback/toast'
import { can } from '../../app/state/session'
import { getRepositories } from '../../app/data'
import { translateError } from '../../app/platform/errors'
import { formatMoney } from '../../shared/domain/money'
import type { CustomerRow } from '../../shared/types/records'
import { parseMinor } from '../../shared/domain/money'
import type { Minor } from '../../shared/domain/money'

export interface CustomerDialogOptions {
  /** The customer on the sale now, if any. */
  current: CustomerRow | null
  currency: string
  onPick: (customer: CustomerRow | null) => void
}

/**
 * What the shop typed, split into a name and a phone number when it is one.
 *
 * A phone number is digits, spaces, dashes and an optional leading `+`; a name
 * is not. Getting this wrong is how a shop ends up with a customer called
 * `01712345678` and no way to phone them.
 */
export function splitQuery(query: string): { name: string; phone: string | null } {
  const name = query.trim()
  const digits = name.replace(/[\s-]/g, '')
  const isPhone = /^\+?\d{6,15}$/.test(digits)
  return { name, phone: isPhone ? name : null }
}

/** The line under a name: what tells two customers apart at a glance. */
export function describe(customer: CustomerRow, currency: string): string {
  const parts: string[] = []
  if (customer.phone) parts.push(customer.phone)
  if (customer.email) parts.push(customer.email)
  const credit = parseMinor(customer.store_credit) ?? (0 as Minor)
  if (credit > 0) parts.push(`${formatMoney(credit, { currency })} in credit`)
  return parts.length > 0 ? parts.join(' · ') : 'No phone number'
}

export function openCustomerDialog(options: CustomerDialogOptions): { close: () => void } {
  const { current, currency, onPick } = options
  const repos = getRepositories()

  let results: CustomerRow[] = []
  let query = ''
  let busy = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const dialog = modal({
    title: current ? 'Change the customer' : 'Attach a customer',
    subtitle: 'Name and phone number are enough — everything else is optional.',
    iconName: 'person_add',
    size: 'md',
    dismissible: true,
  })

  const search = input({
    type: 'search',
    placeholder: 'Search by name or phone',
    autofocus: true,
    autocomplete: 'off',
    leadingIcon: 'search',
    onInput: (value) => {
      query = value
      if (timer) clearTimeout(timer)
      // The same 200 ms the catalogue search uses: a scanner or a fast typist
      // finishes the word before the shop's database is asked anything.
      timer = setTimeout(() => void run(query), 200)
    },
    onEnter: () => {
      // Enter takes the first match, so a cashier holding a phone number never
      // reaches for the mouse.
      const first = results[0]
      if (first) pick(first)
      else void run(query)
    },
  })

  const listBox = h('div', { class: 'space-y-1' })
  const statusLine = h('p', { class: 'text-xs text-content-muted' })
  const busyLine = h('div', { class: 'hidden items-center gap-2 text-xs text-content-muted' })

  async function run(term: string): Promise<void> {
    busy = true
    draw()
    try {
      const page = await repos.customers.list({ search: term.trim(), limit: 20 })
      results = page.items
    } catch (error) {
      results = []
      toastError(translateError(error).message)
    } finally {
      busy = false
      draw()
    }
  }

  function draw(): void {
    const rows: HTMLElement[] = []

    if (current) {
      rows.push(
        h(
          'div',
          {
            class:
              'flex items-center justify-between gap-2 rounded-lg border border-border ' +
              'bg-surface-muted px-3 py-2',
          },
          h(
            'div',
            { class: 'min-w-0' },
            h('p', { class: 'truncate text-sm font-medium text-content', text: current.name }),
            h('p', { class: 'truncate text-xs text-content-muted', text: describe(current, currency) })
          ),
          button('Make it a walk-in', {
            size: 'sm',
            variant: 'ghost',
            icon: 'close',
            onClick: () => {
              onPick(null)
              dialog.close()
            },
          })
        )
      )
    }

    for (const customer of results) {
      if (customer.id === current?.id) continue
      rows.push(
        h(
          'button',
          {
            type: 'button',
            class:
              'w-full flex items-center justify-between gap-2 rounded-lg border border-border ' +
              'bg-surface px-3 py-2 text-left hover:bg-surface-muted',
            onClick: () => pick(customer),
          },
          h(
            'div',
            { class: 'min-w-0' },
            h('p', { class: 'truncate text-sm text-content', text: customer.name }),
            h('p', { class: 'truncate text-xs text-content-muted', text: describe(customer, currency) })
          ),
          customer.balance !== '0.00'
            ? h('span', {
                class: 'shrink-0 text-xs tabular-nums text-content-muted',
                text: `owes ${formatMoney(parseMinor(customer.balance) ?? (0 as Minor), { currency })}`,
              })
            : null
        )
      )
    }

    // Only offered when the search came back empty: "add what I typed" beside
    // three matches is a way to create a near-duplicate of the customer the
    // shopkeeper was about to pick.
    const typed = splitQuery(query)
    if (can('customers.create') && typed.name !== '' && results.length === 0 && !busy) {
      rows.push(
        button(`Add “${typed.name}”`, {
          size: 'sm',
          variant: 'secondary',
          icon: 'person_add',
          fullWidth: true,
          onClick: () => void create(typed.name, typed.phone),
        })
      )
    }

    mount(listBox, ...rows)
    statusLine.textContent = busy
      ? ''
      : results.length === 0
        ? current
          ? ''
          : 'Nobody matches yet — type a name to add a customer.'
        : `${results.length} match${results.length === 1 ? '' : 'es'}`
    busyLine.classList.toggle('hidden', !busy)
  }

  async function create(name: string, phone: string | null): Promise<void> {
    busy = true
    draw()
    try {
      const created = await repos.customers.create({ name, phone })
      pick(created)
    } catch (error) {
      toastError(translateError(error).message)
      busy = false
      draw()
    }
  }

  function pick(customer: CustomerRow): void {
    onPick(customer)
    dialog.close()
  }

  busyLine.append(spinner('h-3 w-3'), h('span', { text: 'Looking…' }))

  dialog.body.append(
    field('Find the customer', search),
    h('div', { class: 'mt-3' }, busyLine, listBox),
    h('div', { class: 'mt-2' }, statusLine)
  )

  void run('')

  return { close: dialog.close }
}
