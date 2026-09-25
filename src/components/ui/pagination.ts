/**
 * Pagination controls (spec §23).
 *
 * Server-side paging, so the control only ever asks for a window: the report
 * function takes `limit`/`offset` and returns the size of the whole filtered
 * set. That is what lets the footer say "26–50 of 431" truthfully — the total
 * arrives with the page rather than from a second count query that could
 * disagree with it.
 */

import { h, icon } from './h'

export interface PaginationOptions {
  offset: number
  limit: number
  totalRows: number
  onPage: (offset: number) => void
  onLimit?: (limit: number) => void
}

export function pagination(options: PaginationOptions): HTMLElement {
  const { offset, limit, totalRows } = options
  const first = totalRows === 0 ? 0 : offset + 1
  const last = Math.min(offset + limit, totalRows)
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(totalRows / limit))

  const step = (delta: number): void => {
    const next = Math.max(0, Math.min(offset + delta * limit, Math.max(0, (pages - 1) * limit)))
    if (next !== offset) options.onPage(next)
  }

  const pageButton = (
    label: string,
    iconName: string,
    disabled: boolean,
    onClick: () => void
  ): HTMLButtonElement =>
    h(
      'button',
      {
        type: 'button',
        class:
          // h-10/min-w-10 keeps the hit area at the 40px floor the mobile
          // audit enforces on every screen (paging on a phone is thumb work).
          'inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium ' +
          (disabled
            ? 'cursor-not-allowed text-content-subtle opacity-60'
            : 'text-content hover:bg-surface-muted'),
        disabled,
        'aria-label': label,
        onclick: () => {
          if (!disabled) onClick()
        },
      },
      icon(iconName, 'text-base'),
      h('span', { class: 'hidden sm:inline', text: label })
    )

  const limitSelect = options.onLimit
    ? h(
        'label',
        { class: 'flex items-center gap-1.5 text-xs text-content-muted' },
        h('span', { class: 'hidden sm:inline', text: 'Rows' }),
        (() => {
          const select = h('select', {
            class:
              // 16px text: anything smaller makes iOS zoom the page when the
              // select is focused, which the audit (rightly) refuses.
              'h-10 rounded-md border border-input bg-surface px-2 text-base text-content ' +
              'focus:outline-none focus:ring-2 focus:ring-ring',
          })
          for (const size of [25, 50, 100, 250]) {
            select.appendChild(
              h('option', { value: String(size), text: String(size), selected: size === limit })
            )
          }
          select.addEventListener('change', () => options.onLimit?.(Number(select.value)))
          return select
        })()
      )
    : null

  return h(
    'div',
    { class: 'flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-content-muted' },
    h('p', {
      class: 'tabular-nums',
      text:
        totalRows === 0
          ? 'No rows'
          : `${new Intl.NumberFormat('en-IN').format(first)}–${new Intl.NumberFormat('en-IN').format(last)} of ${new Intl.NumberFormat('en-IN').format(totalRows)}`,
    }),
    h(
      'div',
      { class: 'flex items-center gap-1.5' },
      limitSelect,
      pageButton('First', 'first_page', offset === 0, () => options.onPage(0)),
      pageButton('Previous', 'chevron_left', offset === 0, () => step(-1)),
      h('span', {
        class: 'px-1 tabular-nums',
        text: `Page ${page} of ${pages}`,
      }),
      pageButton('Next', 'chevron_right', last >= totalRows, () => step(1)),
      pageButton('Last', 'last_page', last >= totalRows, () => options.onPage((pages - 1) * limit))
    )
  )
}
