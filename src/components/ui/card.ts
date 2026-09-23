/** Cards, panels, badges, empty states — the static surfaces (spec §38). */

import { h, icon, type Child } from './h'

/** A bordered surface. Variadic so callers can list children inline. */
export function card(...children: Child[]): HTMLDivElement {
  return h(
    'div',
    { class: 'rounded-lg border border-border bg-surface p-4' },
    ...children
  )
}

/** Same surface, no padding — for tables that carry their own. */
export function panel(...children: Child[]): HTMLDivElement {
  return h('div', { class: 'rounded-lg border border-border bg-surface' }, ...children)
}

export function cardHeader(
  title: string,
  options: { subtitle?: string; actions?: Child | Child[]; iconName?: string } = {}
): HTMLDivElement {
  const { subtitle, actions, iconName } = options
  return h(
    'div',
    { class: 'mb-3 flex items-start justify-between gap-3' },
    h(
      'div',
      { class: 'flex items-start gap-2.5 min-w-0' },
      iconName ? icon(iconName, 'text-content-muted text-xl mt-0.5 shrink-0') : null,
      h(
        'div',
        { class: 'min-w-0' },
        h('h3', { class: 'text-sm font-semibold text-content truncate', text: title }),
        subtitle ? h('p', { class: 'text-xs text-content-muted mt-0.5', text: subtitle }) : null
      )
    ),
    actions
      ? h('div', { class: 'flex items-center gap-1.5 shrink-0' }, ...(Array.isArray(actions) ? actions : [actions]))
      : null
  )
}

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-content-muted border-border',
  primary: 'bg-primary/10 text-primary border-primary/20',
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  danger: 'bg-danger/10 text-danger border-danger/20',
  info: 'bg-info/10 text-info border-info/20',
}

export function badge(
  label: string,
  options: { tone?: BadgeTone; iconName?: string; class?: string } = {}
): HTMLSpanElement {
  const { tone = 'neutral', iconName, class: extraClass = '' } = options
  return h(
    'span',
    {
      class:
        `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ` +
        `text-xs font-medium whitespace-nowrap ${BADGE_TONES[tone]} ${extraClass}`.trim(),
    },
    iconName ? icon(iconName, 'text-sm') : null,
    h('span', { text: label })
  )
}

/** Large metric tile for the dashboard. */
export function stat(
  label: string,
  value: string,
  options: { iconName?: string; tone?: BadgeTone; delta?: string; hint?: string } = {}
): HTMLDivElement {
  const { iconName, tone = 'neutral', delta, hint } = options
  return h(
    'div',
    { class: 'rounded-lg border border-border bg-surface p-4' },
    h(
      'div',
      { class: 'flex items-center justify-between gap-2 mb-2' },
      h('p', { class: 'text-xs font-medium text-content-muted', text: label }),
      iconName ? icon(iconName, 'text-content-subtle text-lg') : null
    ),
    h('p', { class: 'text-2xl font-semibold text-content tabular-nums tracking-tight', text: value }),
    delta
      ? h('p', {
          class: `mt-1 text-xs font-medium ${delta.startsWith('-') ? 'text-danger' : 'text-success'}`,
          text: delta,
        })
      : hint
        ? h('p', { class: 'mt-1 text-xs text-content-subtle', text: hint })
        : null,
    tone === 'neutral' ? null : h('span', { class: 'hidden', dataset: { tone } })
  )
}

export function emptyState(
  title: string,
  options: { description?: string; iconName?: string; action?: Child } = {}
): HTMLDivElement {
  const { description, iconName = 'inbox', action } = options
  return h(
    'div',
    { class: 'flex flex-col items-center justify-center py-12 px-6 text-center' },
    h('span', {
      class: 'material-symbols-rounded text-content-subtle text-5xl mb-3',
      'aria-hidden': 'true',
      text: iconName,
    }),
    h('p', { class: 'text-sm font-medium text-content', text: title }),
    description ? h('p', { class: 'mt-1 text-xs text-content-muted max-w-sm', text: description }) : null,
    action ? h('div', { class: 'mt-4' }, action) : null
  )
}

export function skeleton(className = 'h-4 w-full'): HTMLDivElement {
  return h('div', {
    class: `${className} animate-pulse rounded bg-surface-muted`,
    'aria-hidden': 'true',
  })
}
