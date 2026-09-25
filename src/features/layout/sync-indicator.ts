/**
 * The sync indicator: the one place the shop is told what the till is holding.
 *
 * It replaces a chip that read `navigator.onLine` and printed "Online" or
 * "Offline" — a claim the browser cannot actually make (a captive portal says
 * online) and, worse, one that said nothing about the sales sitting in the
 * queue. A cashier who cannot tell whether the last three sales reached the
 * server re-takes them by hand, which is the failure this phase exists to
 * prevent.
 *
 * So the chip reports what is *known*: how many sales are waiting, whether a
 * send is in flight, and how many the server refused. The refused ones open a
 * panel, because "3 sales refused" is not something a shopkeeper can act on
 * without seeing which ones and why.
 *
 * It also reports sales the device is holding for **another** shop. A shared
 * till changes hands, and those sales are not lost — they wait for their own
 * shop's session. Saying so is the difference between "the morning's sales are
 * still here" and a shopkeeper wondering whether to write them down again.
 */

import { badge } from '../../components/ui/card'
import { button, spinner } from '../../components/ui/button'
import { h } from '../../components/ui/h'
import { modal } from '../../components/feedback/modal'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { formatWhen } from '../../components/ui/table'
import { offlineStatus, type OfflineUiStatus } from '../../app/state/offline'
import { offlineRuntime } from '../../app/offline'

export function syncIndicator(): HTMLElement {
  const dot = h('span', { class: 'h-2 w-2 rounded-full bg-success', 'aria-hidden': 'true' })
  const busy = spinner('h-3 w-3')
  busy.classList.add('hidden')
  const label = h('span', { class: 'text-xs text-content-muted', text: 'Online' })

  const chip = h(
    'button',
    {
      type: 'button',
      class:
        'flex h-10 items-center gap-1.5 rounded-full border border-border bg-surface px-3 ' +
        'text-left hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
      title: 'Sales waiting to sync',
      onClick: () => void openQueue(),
    },
    dot,
    busy,
    label
  )

  const render = (status: OfflineUiStatus): void => {
    busy.classList.toggle('hidden', !status.syncing)

    let tone = 'bg-success'
    let text = 'Online'
    if (status.failed > 0) {
      tone = 'bg-danger'
      text = `${status.failed} refused`
    } else if (status.pending > 0) {
      tone = 'bg-warning'
      text = status.syncing ? `Sending ${status.pending}…` : `${status.pending} waiting`
    } else if (!status.online) {
      tone = 'bg-danger'
      text = 'Offline'
    } else if (status.foreign > 0) {
      tone = 'bg-warning'
      text = `${status.foreign} for another shop`
    } else if (!status.persistent) {
      // The one state worth shouting about: the queue does not survive a
      // reload, so closing the tab loses whatever is in it.
      tone = 'bg-warning'
      text = 'Not saving offline'
    }

    dot.className = `h-2 w-2 rounded-full ${tone}`
    label.textContent = text
    chip.setAttribute(
      'aria-label',
      `${text}. ${status.pending} waiting to sync, ${status.failed} refused${
        status.foreign > 0 ? `, ${status.foreign} waiting for another shop` : ''
      }. ${status.online ? 'Connected' : 'No connection'}.`
    )
    // Only worth a click when there is something behind it.
    chip.classList.toggle(
      'cursor-default',
      status.pending === 0 && status.failed === 0 && status.foreign === 0
    )
  }

  render(offlineStatus.state)
  const unsubscribe = offlineStatus.subscribe(render)

  // The shell is rebuilt on sign-out and the chip goes with it; dropping the
  // subscription then keeps `offlineStatus` from accumulating dead listeners
  // across logins.
  const observer = new MutationObserver(() => {
    if (!chip.isConnected) {
      unsubscribe()
      observer.disconnect()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  return chip
}

/** The queue, in full, with the two things a person can do about it. */
export async function openQueue(): Promise<void> {
  const runtime = offlineRuntime()
  if (!runtime) return

  const failures = await runtime.failures()
  const pending = await runtime.pending()
  const stranded = await runtime.stranded()

  const dialog = modal({
    title: 'Sales waiting to sync',
    subtitle:
      pending === 0 && failures.length === 0 && stranded === 0
        ? 'Everything the till has taken has reached the server.'
        : `${pending} waiting · ${failures.length} refused. Refused sales are kept until somebody decides.`,
    iconName: 'cloud_sync',
    size: 'lg',
  })

  const list = h('div', { class: 'space-y-3' })

  if (stranded > 0) {
    // Not this session's to send, and not lost. The distinction matters: the
    // one thing a cashier does with a sale they think is missing is take it
    // again, which is how a shop ends up with two.
    list.appendChild(
      h(
        'div',
        { class: 'rounded-md border border-warning/40 bg-warning/5 p-3' },
        h('p', {
          class: 'text-sm text-content',
          text: `${stranded} sale(s) belong to another shop signed in on this device`,
        }),
        h('p', {
          class: 'mt-0.5 text-xs text-content-muted',
          text:
            'They are kept, and will be sent when somebody signs in to that shop again. ' +
            'Nobody else can send them — and they are not a mistake to fix by hand.',
        })
      )
    )
  }

  if (pending > 0) {
    list.appendChild(
      h(
        'div',
        { class: 'flex items-center justify-between gap-3 rounded-md border border-border p-3' },
        h(
          'div',
          { class: 'min-w-0' },
          h('p', {
            class: 'text-sm text-content',
            text: `${pending} sale(s) will be sent when the connection allows`,
          }),
          h('p', {
            class: 'text-xs text-content-subtle',
            text: 'They are stored on this device. A sale sent twice is only ever recorded once.',
          })
        ),
        button('Send now', {
          size: 'sm',
          variant: 'outline',
          onClick: (event) => {
            const target = event.currentTarget as HTMLButtonElement
            target.disabled = true
            void runtime
              .drain()
              .then(() => runtime.pending())
              .then((left) => {
                if (left === 0) {
                  toastSuccess('Everything is synced.')
                  dialog.close()
                } else {
                  toastError(`${left} sale(s) still waiting — the connection did not come through.`)
                }
              })
              .finally(() => {
                target.disabled = false
              })
          },
        })
      )
    )
  }

  for (const failure of failures) {
    const row = h('div', { class: 'rounded-md border border-danger/40 bg-danger/5 p-3' })

    row.appendChild(
      h(
        'div',
        { class: 'flex items-start justify-between gap-3' },
        h(
          'div',
          { class: 'min-w-0' },
          h('p', {
            class: 'text-sm font-medium text-content',
            text: `Sale ${failure.ref.slice(0, 8)} · ${formatWhen(
              new Date(failure.createdAt).toISOString()
            )}`,
          }),
          h('p', { class: 'mt-0.5 text-xs break-words text-content-muted', text: failure.message }),
          h('p', {
            class: 'mt-0.5 text-[11px] text-content-subtle',
            text: `Tried ${failure.attempts} time(s)`,
          })
        ),
        badge('Refused', { tone: 'danger' })
      )
    )

    row.appendChild(
      h(
        'div',
        { class: 'mt-2 flex flex-wrap gap-2' },
        button('Try again', {
          size: 'sm',
          variant: 'outline',
          onClick: () => {
            void runtime.retry(failure.ref).then(() => {
              toastSuccess('Sent again.')
              dialog.close()
            })
          },
        }),
        button('Discard', {
          size: 'sm',
          variant: 'ghost',
          onClick: () => {
            void confirmDiscard(failure.ref).then((ok) => {
              if (!ok) return
              void runtime.discard(failure.ref).then(() => {
                toastSuccess('Discarded.')
                dialog.close()
              })
            })
          },
        })
      )
    )

    list.appendChild(row)
  }

  if (pending === 0 && failures.length === 0) {
    list.appendChild(h('p', { class: 'text-sm text-content-muted', text: 'Nothing is waiting.' }))
  }

  dialog.body.appendChild(list)
}

/**
 * Ask before a sale is forgotten. Closing the dialog any other way (Esc, the
 * backdrop, the X) counts as "keep it": the safe answer is the default one.
 */
async function confirmDiscard(ref: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let answered = false
    const answer = (value: boolean): void => {
      if (answered) return
      answered = true
      dialog.close()
      resolve(value)
    }

    const dialog = modal({
      title: 'Discard this sale?',
      subtitle: `Reference ${ref.slice(0, 8)}`,
      iconName: 'warning',
      size: 'sm',
      onClose: () => answer(false),
      footer: [
        button('Keep it', { variant: 'outline', onClick: () => answer(false) }),
        button('Discard', { variant: 'danger', onClick: () => answer(true) }),
      ],
    })

    dialog.body.appendChild(
      h(
        'p',
        { class: 'text-sm text-content-muted' },
        'The server refused it and the customer has already left with the goods. Discarding ' +
          'forgets it here — it will not appear in any report, and the stock it should have ' +
          'moved will not move.'
      )
    )
  })
}
