/**
 * The register (Phase 2 §25 operations, Phase 4 §24 reporting).
 *
 * A shop's drawer has a lifecycle and a story: it is opened with a float,
 * moves cash in and out during the day, and is closed against a count — and
 * the difference between what should be there and what is there is the single
 * most useful number in the shop. So this screen leads with that number.
 *
 * The same screen serves the cashier counting coins and the owner checking
 * yesterday: open sessions first, then the history, each row expanding into
 * the full closing report.
 */

import { h, mount } from '../../components/ui/h'
import { button, spinner } from '../../components/ui/button'
import { badge, card, emptyState } from '../../components/ui/card'
import { input, select, field, textarea } from '../../components/ui/input'
import { modal } from '../../components/feedback/modal'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { getRepositories } from '../../app/data'
import { activeOrganization, can } from '../../app/state/session'
import { salesFloor, refreshSalesFloor } from '../../app/state/sales-floor'
import { formatMoney, minorToNumber, parseMinor, type Minor } from '../../shared/domain/money'
import { translateError } from '../../app/platform/errors'
import type { RegisterReport, RegisterSessionSummary } from '../../shared/repositories/contracts'

export function registerView(): HTMLElement {
  const repos = getRepositories()
  const organization = activeOrganization()
  const currency = organization?.currency ?? 'BDT'

  const root = h('div', { class: 'flex h-full min-h-0 flex-col' })
  const statusSlot = h('div', { class: 'p-3' })
  const historySlot = h('div', { class: 'min-h-0 flex-1 overflow-y-auto px-3 pb-6' })

  let sessions: RegisterSessionSummary[] = []
  let loading = false

  async function load(): Promise<void> {
    if (loading) return
    loading = true
    mount(historySlot, h('div', { class: 'flex justify-center p-6' }, spinner()))
    try {
      const floor = salesFloor()
      if (!floor) {
        await refreshSalesFloor()
      }
      const current = salesFloor()
      if (!current) throw new Error('The shop is still loading. Try again in a moment.')

      sessions = await repos.registers.sessions(current.branchId, 30)
      renderStatus()
      renderHistory()
    } catch (error) {
      mount(
        historySlot,
        emptyState('The register could not be loaded', {
          description: translateError(error).message,
          iconName: 'error',
          action: button('Try again', { variant: 'primary', onClick: () => void load() }),
        })
      )
    } finally {
      loading = false
    }
  }

  // ── The open drawer, and what to do with it ─────────────────────────────

  function renderStatus(): void {
    const open = sessions.find((session) => session.isOpen)
    const floor = salesFloor()

    if (open) {
      mount(
        statusSlot,
        card(
          h(
            'div',
            { class: 'flex items-start justify-between gap-3' },
            h(
              'div',
              { class: 'min-w-0' },
              h('p', { class: 'text-xs font-medium text-content-muted', text: 'Drawer open' }),
              h('p', { class: 'mt-0.5 text-lg font-semibold text-content', text: open.registerName ?? 'Register' }),
              h('p', {
                class: 'text-xs text-content-muted',
                text: `Opened ${formatWhen(open.openedAt)} with ${formatMoney(open.openingCash, { currency })}`,
              })
            ),
            badge(`${open.saleCount} sale${open.saleCount === 1 ? '' : 's'}`, { tone: 'primary' })
          ),
          h(
            'div',
            { class: 'mt-3 grid grid-cols-2 gap-3 text-sm' },
            statLine('Sales', formatMoney(open.salesTotal, { currency })),
            statLine('Opening float', formatMoney(open.openingCash, { currency })),
            statLine('Refunds', formatMoney(open.refundTotal, { currency })),
            statLine('Expenses', formatMoney(open.expenseTotal, { currency }))
          ),
          h(
            'div',
            { class: 'mt-4 flex flex-wrap gap-2' },
            can('register.close') ? button('Close drawer', { variant: 'primary', icon: 'lock', onClick: () => openClose(open) }) : null,
            can('register.adjust_cash')
              ? button('Cash in / out', { variant: 'outline', icon: 'swap_vert', onClick: () => openCashMovement(open) })
              : null,
            button('Report', { variant: 'ghost', icon: 'summarize', onClick: () => void openReport(open.id) })
          )
        )
      )
      return
    }

    mount(
      statusSlot,
      card(
        h('p', { class: 'text-xs font-medium text-content-muted', text: 'Drawer closed' }),
        h('p', {
          class: 'mt-1 text-sm text-content-muted',
          text: 'Open the drawer with the float you start the day with. Every cash sale afterwards is counted against it.',
        }),
        can('register.open')
          ? h(
              'div',
              { class: 'mt-3' },
              button('Open drawer', {
                variant: 'primary',
                icon: 'lock_open',
                onClick: () => openOpen(floor?.registerId ?? null),
              })
            )
          : null
      )
    )
  }

  function statLine(label: string, value: string): HTMLElement {
    return h(
      'div',
      null,
      h('p', { class: 'text-xs text-content-muted', text: label }),
      h('p', { class: 'tabular-nums font-medium text-content', text: value })
    )
  }

  // ── Operations ──────────────────────────────────────────────────────────

  function openOpen(registerId: string | null): void {
    if (!registerId) {
      toastError('This shop has no register set up yet.')
      return
    }
    const cashInput = input({
      id: 'register-float',
      type: 'text',
      inputmode: 'decimal',
      placeholder: '0',
      autofocus: true,
    })
    const noteInput = input({ id: 'register-note', placeholder: 'Note (optional)' })
    const errorSlot = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
    const submit = button('Open drawer', { variant: 'primary', fullWidth: true, size: 'lg' })
    const dialog = modal({
      title: 'Open the drawer',
      subtitle: 'The float is the cash you are starting with — it becomes the baseline for the closing count.',
      iconName: 'lock_open',
      size: 'sm',
      footer: [h('div', { class: 'w-full' }, submit)],
    })

    mount(dialog.body, h('div', { class: 'space-y-4' }, field('Opening cash', cashInput), field('Note', noteInput), errorSlot))
    submit.addEventListener('click', () => {
      void (async () => {
        const amount = parseMinor(cashInput.value || '0')
        if (amount === null) {
          errorSlot.textContent = 'That is not an amount.'
          errorSlot.classList.remove('hidden')
          return
        }
        submit.disabled = true
        try {
          await repos.registers.open(registerId, amount, noteInput.value.trim() || undefined)
          dialog.close()
          toastSuccess('Drawer opened')
          await refreshSalesFloor()
          void load()
        } catch (error) {
          errorSlot.textContent = translateError(error).message
          errorSlot.classList.remove('hidden')
        } finally {
          submit.disabled = false
        }
      })()
    })
  }

  function openClose(session: RegisterSessionSummary): void {
    void (async () => {
      let report: RegisterReport | null = null
      try {
        report = await repos.registers.report(session.id)
      } catch {
        report = null
      }

      const cashInput = input({
        id: 'register-count',
        type: 'text',
        inputmode: 'decimal',
        placeholder: '0',
        autofocus: true,
      })
      const noteInput = textarea({ id: 'register-close-note', rows: 2, placeholder: 'Anything to explain? (optional)' })
      const varianceSlot = h('div', { class: 'text-sm' })
      const errorSlot = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
      const submit = button('Close drawer', { variant: 'primary', fullWidth: true, size: 'lg' })
      const dialog = modal({
        title: 'Close the drawer',
        subtitle: report
          ? `Expected in the drawer: ${formatMoney(report.expectedCash, { currency })}`
          : 'Count the cash and enter it.',
        iconName: 'lock',
        size: 'sm',
        footer: [h('div', { class: 'w-full' }, submit)],
      })

      // The variance is shown as it is typed, not after submission. A
      // shopkeeper who sees −৳200 appear will recount the drawer; one who sees
      // it only on the printed report has already closed it.
      cashInput.addEventListener('input', () => {
        if (!report) return
        const counted = parseMinor(cashInput.value)
        if (counted === null) {
          mount(varianceSlot)
          return
        }
        const variance = minorToNumber(counted) - minorToNumber(report.expectedCash)
        mount(
          varianceSlot,
          h(
            'div',
            { class: 'flex items-center justify-between rounded-lg border border-border p-2.5' },
            h('span', { class: 'text-content-muted', text: 'Difference' }),
            h('span', {
              class: `font-semibold tabular-nums ${
                variance === 0 ? 'text-success' : variance < 0 ? 'text-danger' : 'text-warning'
              }`,
              text: `${variance > 0 ? '+' : ''}${formatMoney(variance as Minor, { currency })}`,
            })
          )
        )
      })

      mount(
        dialog.body,
        h('div', { class: 'space-y-4' }, field('Counted cash', cashInput), varianceSlot, field('Note', noteInput), errorSlot)
      )

      submit.addEventListener('click', () => {
        void (async () => {
          const amount = parseMinor(cashInput.value)
          if (amount === null) {
            errorSlot.textContent = 'Enter the cash you counted.'
            errorSlot.classList.remove('hidden')
            return
          }
          submit.disabled = true
          try {
            await repos.registers.close(session.id, amount, noteInput.value.trim() || undefined)
            dialog.close()
            toastSuccess('Drawer closed')
            await refreshSalesFloor()
            void load()
          } catch (error) {
            errorSlot.textContent = translateError(error).message
            errorSlot.classList.remove('hidden')
          } finally {
            submit.disabled = false
          }
        })()
      })
    })()
  }

  function openCashMovement(session: RegisterSessionSummary): void {
    const amountInput = input({ id: 'cash-amount', type: 'text', inputmode: 'decimal', placeholder: '0', autofocus: true })
    const directionSelect = select({
      id: 'cash-direction',
      options: [
        { value: '1', label: 'Cash in (added to the drawer)' },
        { value: '-1', label: 'Cash out (taken from the drawer)' },
      ],
      value: '1',
    })
    const noteInput = input({ id: 'cash-note', placeholder: 'What for?' })
    const errorSlot = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
    const submit = button('Record', { variant: 'primary', fullWidth: true, size: 'lg' })
    const dialog = modal({
      title: 'Cash in / out',
      subtitle: 'Money that moved without a sale — a bank drop, a supplier paid at the door.',
      iconName: 'swap_vert',
      size: 'sm',
      footer: [h('div', { class: 'w-full' }, submit)],
    })

    mount(
      dialog.body,
      h('div', { class: 'space-y-4' }, field('Amount', amountInput, { required: true }), field('Direction', directionSelect), field('Note', noteInput), errorSlot)
    )

    submit.addEventListener('click', () => {
      void (async () => {
        const amount = parseMinor(amountInput.value)
        if (amount === null || minorToNumber(amount) <= 0) {
          errorSlot.textContent = 'Enter an amount greater than zero.'
          errorSlot.classList.remove('hidden')
          return
        }
        submit.disabled = true
        try {
          await repos.registers.cashMovement(
            session.id,
            amount,
            directionSelect.value === '1' ? 1 : -1,
            noteInput.value.trim() || undefined
          )
          dialog.close()
          toastSuccess(directionSelect.value === '1' ? 'Cash added' : 'Cash removed')
          void load()
        } catch (error) {
          errorSlot.textContent = translateError(error).message
          errorSlot.classList.remove('hidden')
        } finally {
          submit.disabled = false
        }
      })()
    })
  }

  // ── Reporting ───────────────────────────────────────────────────────────

  async function openReport(sessionId: string): Promise<void> {
    const dialog = modal({ title: 'Register report', size: 'md', iconName: 'summarize', footer: [] })
    mount(dialog.body, h('div', { class: 'flex justify-center p-6' }, spinner()))
    try {
      const report = await repos.registers.report(sessionId)
      mount(
        dialog.body,
        h(
          'div',
          { class: 'space-y-4' },
          card(
            h('p', { class: 'text-xs font-medium text-content-muted', text: 'Drawer' }),
            row('Opening float', formatMoney(report.openingCash, { currency })),
            row('Cash sales', formatMoney(report.salesCash, { currency })),
            row('Cash in', formatMoney(report.cashIn, { currency })),
            row('Cash out', `−${formatMoney(report.cashOut, { currency })}`),
            row('Refunds paid in cash', `−${formatMoney(report.refundCash, { currency })}`),
            row('Expenses paid in cash', `−${formatMoney(report.expenseCash, { currency })}`),
            h(
              'div',
              { class: 'mt-2 flex justify-between border-t border-border pt-2 font-semibold' },
              h('span', { text: 'Expected' }),
              h('span', { class: 'tabular-nums', text: formatMoney(report.expectedCash, { currency }) })
            ),
            report.closingCash !== null
              ? h(
                  'div',
                  { class: 'flex justify-between text-sm' },
                  h('span', { text: 'Counted' }),
                  h('span', { class: 'tabular-nums', text: formatMoney(report.closingCash, { currency }) })
                )
              : null,
            report.variance !== null
              ? h(
                  'div',
                  { class: 'flex justify-between text-sm font-semibold' },
                  h('span', { text: 'Difference' }),
                  h('span', {
                    class: `tabular-nums ${
                      minorToNumber(report.variance) === 0
                        ? 'text-success'
                        : minorToNumber(report.variance) < 0
                          ? 'text-danger'
                          : 'text-warning'
                    }`,
                    text: formatMoney(report.variance, { currency }),
                  })
                )
              : null
          ),
          card(
            h('p', { class: 'text-xs font-medium text-content-muted', text: 'Takings' }),
            row('Sales', `${formatMoney(report.salesTotal, { currency })} (${report.saleCount})`),
            row('Refunds', `−${formatMoney(report.refundTotal, { currency })}`),
            row('Expenses', `−${formatMoney(report.expenseTotal, { currency })}`),
            ...(report.byMethod.length > 0
              ? [
                  h('p', { class: 'mt-3 text-xs font-medium text-content-muted', text: 'By payment method' }),
                  ...report.byMethod.map((method) =>
                    row(`${method.method} (${method.count})`, formatMoney(method.amount, { currency }))
                  ),
                ]
              : [])
          )
        )
      )
    } catch (error) {
      mount(dialog.body, emptyState('Report unavailable', { description: translateError(error).message, iconName: 'error' }))
    }
  }

  function row(label: string, value: string): HTMLElement {
    return h(
      'div',
      { class: 'mt-1 flex justify-between gap-3 text-sm' },
      h('span', { class: 'text-content-muted', text: label }),
      h('span', { class: 'tabular-nums text-content', text: value })
    )
  }

  // ── History ─────────────────────────────────────────────────────────────

  function renderHistory(): void {
    const past = sessions.filter((session) => !session.isOpen)
    if (past.length === 0) {
      mount(historySlot, h('p', { class: 'py-6 text-center text-sm text-content-subtle', text: 'No closed sessions yet.' }))
      return
    }

    mount(
      historySlot,
      h(
        'div',
        { class: 'overflow-hidden rounded-xl border border-border bg-surface' },
        ...past.map((session) =>
          h(
            'div',
            { class: 'border-b border-border p-3 last:border-b-0' },
            h(
              'div',
              { class: 'flex items-start justify-between gap-3' },
              h(
                'div',
                { class: 'min-w-0' },
                h('p', { class: 'text-sm font-medium text-content', text: session.registerName ?? 'Register' }),
                h('p', {
                  class: 'text-xs text-content-muted',
                  text: `${formatWhen(session.openedAt)} → ${session.closedAt ? formatWhen(session.closedAt) : '—'}`,
                })
              ),
              session.variance === null
                ? null
                : badge(formatMoney(session.variance, { currency }), {
                    tone: minorToNumber(session.variance) === 0 ? 'success' : 'danger',
                  })
            ),
            h(
              'p',
              { class: 'mt-1 text-xs text-content-muted tabular-nums' },
              `${session.saleCount} sale${session.saleCount === 1 ? '' : 's'} · ${formatMoney(session.salesTotal, { currency })}`
            ),
            h(
              'div',
              { class: 'mt-2' },
              button('View report', { variant: 'ghost', size: 'sm', onClick: () => void openReport(session.id) })
            )
          )
        )
      )
    )
  }

  mount(
    root,
    h('div', { class: 'border-b border-border px-3 pt-3 pb-3' }, h('h1', { class: 'text-lg font-semibold text-content', text: 'Register' })),
    statusSlot,
    h('div', { class: 'px-3 pb-1' }, h('h2', { class: 'text-sm font-semibold text-content-muted', text: 'Recent sessions' })),
    historySlot
  )

  void load()
  return root
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
