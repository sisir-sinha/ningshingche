/**
 * Modal dialog (spec §39).
 *
 * Focus is trapped while open and restored to the triggering element on
 * close — the cashier works from the keyboard, and a dialog that steals focus
 * permanently makes the POS unusable without a mouse.
 */

import { h, icon, type Child } from '../ui/h'
import { button, iconButton } from '../ui/button'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface ModalOptions {
  title: string
  subtitle?: string
  iconName?: string
  /** `sm` 24rem · `md` 32rem · `lg` 44rem · `xl` 60rem */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Omit to render a bare dialog and own the footer yourself. */
  footer?: Child[]
  onClose?: () => void
  /** Set false to require an explicit action rather than allowing Esc/backdrop. */
  dismissible?: boolean
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const

export interface Modal {
  el: HTMLDivElement
  body: HTMLDivElement
  close: () => void
}

export function modal(options: ModalOptions): Modal {
  const { title, subtitle, iconName, size = 'md', footer, onClose, dismissible = true } = options

  let previouslyFocused: HTMLElement | null = null
  let keyHandler: ((event: KeyboardEvent) => void) | null = null

  const close = (): void => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler, true)
    backdrop.remove()
    previouslyFocused?.focus()
    onClose?.()
  }

  const body = h('div', { class: 'p-4' })

  const panel = h(
    'div',
    {
      class:
        `relative w-full ${SIZES[size]} max-h-[90vh] flex flex-col rounded-lg border border-border ` +
        'bg-surface shadow-xl animate-slide-up',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    },
    h(
      'div',
      { class: 'flex items-start justify-between gap-3 border-b border-border p-4' },
      h(
        'div',
        { class: 'flex items-start gap-2.5 min-w-0' },
        iconName ? icon(iconName, 'text-content-muted text-xl mt-0.5 shrink-0') : null,
        h(
          'div',
          { class: 'min-w-0' },
          h('h2', { class: 'text-base font-semibold text-content', text: title }),
          subtitle ? h('p', { class: 'text-xs text-content-muted mt-0.5', text: subtitle }) : null
        )
      ),
      // Default size, not `sm`: a 32px close button is under the 40px tap
      // floor on a phone, and the modal's close is the one control a user
      // reaches for when a dialog is in the way. The mobile audit caught it
      // the moment a dialog was opened at 390px.
      // `shrink-0` matters as much as the size: in a flex row a 40px box
      // compresses to 26px when the title is long, which is how this measured
      // 26×40 at 390px even after the size was raised.
      dismissible
        ? iconButton('close', 'Close', { variant: 'ghost', class: 'shrink-0', onClick: close })
        : null
    ),
    h('div', { class: 'flex-1 overflow-y-auto' }, body),
    footer ? h('div', { class: 'flex items-center justify-end gap-2 border-t border-border p-4' }, ...footer) : null
  )

  const backdrop = h('div', {
    class:
      'fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4 animate-fade-in',
  })
  backdrop.appendChild(panel)

  if (dismissible) {
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close()
    })
  }

  keyHandler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null
    )
    if (focusable.length === 0) {
      event.preventDefault()
      panel.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  previouslyFocused = document.activeElement as HTMLElement | null
  document.addEventListener('keydown', keyHandler, true)
  document.body.appendChild(backdrop)

  // Focus the first control, or the panel itself when there is nothing to focus.
  const initial = panel.querySelector<HTMLElement>(FOCUSABLE)
  if (initial) {
    initial.focus()
  } else {
    panel.tabIndex = -1
    panel.focus()
  }

  return { el: backdrop, body, close }
}

/** A yes/no confirmation. Resolves rather than taking callbacks. */
export function confirm(
  title: string,
  options: {
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    tone?: 'primary' | 'danger'
    iconName?: string
  } = {}
): Promise<boolean> {
  const {
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'primary',
    iconName = 'help',
  } = options

  return new Promise<boolean>((resolve) => {
    let settled = false
    const settle = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
      dialog.close()
    }

    const dialog = modal({
      title,
      iconName,
      size: 'sm',
      onClose: () => settle(false),
      footer: [
        button(cancelLabel, { variant: 'ghost', onClick: () => settle(false) }),
        button(confirmLabel, { variant: tone, onClick: () => settle(true) }),
      ],
    })

    if (message) {
      dialog.body.appendChild(h('p', { class: 'text-sm text-content-muted', text: message }))
    }
  })
}
