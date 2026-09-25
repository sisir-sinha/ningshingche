/**
 * Toast notifications (spec §39).
 *
 * Driven by the `ui.toast` bus event rather than a direct function call, so
 * anything — a plugin, an RPC error handler, a Realtime message — can raise
 * a notification without importing this module.
 */

import { h, icon } from '../ui/h'
import { eventBus } from '../../shared/bus'

export type ToastTone = 'info' | 'success' | 'warning' | 'error'

const TONES: Record<ToastTone, { bar: string; iconName: string; text: string }> = {
  info: { bar: 'bg-info', iconName: 'info', text: 'text-info' },
  success: { bar: 'bg-success', iconName: 'check_circle', text: 'text-success' },
  warning: { bar: 'bg-warning', iconName: 'warning', text: 'text-warning' },
  error: { bar: 'bg-danger', iconName: 'error', text: 'text-danger' },
}

const DEFAULT_TIMEOUT: Record<ToastTone, number> = {
  info: 4000,
  success: 3000,
  warning: 6000,
  error: 8000,
}

let container: HTMLDivElement | null = null

function ensureContainer(): HTMLDivElement {
  if (container && container.isConnected) return container
  container = h('div', {
    class:
      'pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] ' +
      'flex-col gap-2',
    role: 'region',
    'aria-label': 'Notifications',
  })
  document.body.appendChild(container)
  return container
}

export interface ToastOptions {
  tone?: ToastTone
  timeout?: number
  /** Optional action button, e.g. "Undo". */
  action?: { label: string; onClick: () => void }
  title?: string
}

export function toast(message: string, options: ToastOptions = {}): () => void {
  const { tone = 'info', action, title } = options
  const timeout = options.timeout ?? DEFAULT_TIMEOUT[tone]
  const style = TONES[tone]
  const host = ensureContainer()

  let timer: ReturnType<typeof setTimeout> | undefined

  const close = (): void => {
    if (timer) clearTimeout(timer)
    el.classList.add('opacity-0', 'translate-y-1')
    setTimeout(() => el.remove(), 150)
  }

  const dismiss = h('button', {
    type: 'button',
    class:
      // A 40px hit area: the close affordance is thumb-operated on a phone.
      'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-content-subtle hover:text-content ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'aria-label': 'Dismiss',
    onclick: close,
  })
  dismiss.appendChild(icon('close', 'text-base'))

  const actionButton = action
    ? h('button', {
        type: 'button',
        class:
          'shrink-0 rounded px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        text: action.label,
        onclick: () => {
          action.onClick()
          close()
        },
      })
    : null

  const el = h(
    'div',
    {
      class:
        'pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-lg ' +
        'border border-border bg-surface-raised p-3 pl-4 shadow-lg ' +
        'transition-all duration-150 animate-slide-up',
      role: tone === 'error' ? 'alert' : 'status',
      'aria-live': tone === 'error' ? 'assertive' : 'polite',
    },
    h('span', { class: `absolute inset-y-0 left-0 w-1 ${style.bar}`, 'aria-hidden': 'true' }),
    icon(style.iconName, `${style.text} text-lg mt-0.5 shrink-0`),
    h(
      'div',
      { class: 'min-w-0 flex-1' },
      title ? h('p', { class: 'text-sm font-semibold text-content', text: title }) : null,
      h('p', { class: 'text-sm text-content break-words', text: message })
    ),
    actionButton,
    dismiss
  )

  host.appendChild(el)

  if (timeout > 0) timer = setTimeout(close, timeout)
  return close
}

/** Convenience wrappers used throughout the app. */
export const toastSuccess = (message: string, options?: ToastOptions): (() => void) =>
  toast(message, { ...options, tone: 'success' })
export const toastError = (message: string, options?: ToastOptions): (() => void) =>
  toast(message, { ...options, tone: 'error' })
export const toastWarning = (message: string, options?: ToastOptions): (() => void) =>
  toast(message, { ...options, tone: 'warning' })

/** Wire the bus to the renderer. Called once at boot. */
export function mountToasts(): () => void {
  return eventBus.on('ui.toast', (event) => {
    const { message, tone, timeout } = event.data
    toast(message, {
      tone,
      ...(timeout === undefined ? {} : { timeout }),
    })
  })
}
