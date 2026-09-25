/**
 * The audit trail (spec §31).
 *
 * A shop's audit log answers three questions, in order: who changed this, what
 * did it look like before, and what does it look like now. So the list carries
 * the actor and the entity, and the detail is a before/after table — not a
 * pretty diff, because "300 → 275" is what a shopkeeper reads, and a
 * character-level diff of two JSON blobs is not.
 *
 * The trail is written by a database trigger (`app.record_audit`), so it
 * cannot be skipped by a path through the API that nobody remembered to
 * instrument. This screen is read-only for exactly that reason: there is no
 * button here that could rewrite history.
 */

import { h, mount } from '../../components/ui/h'
import { button, spinner } from '../../components/ui/button'
import { badge, card, emptyState } from '../../components/ui/card'
import { searchInput, select } from '../../components/ui/input'
import { modal } from '../../components/feedback/modal'
import { getRepositories } from '../../app/data'
import { translateError } from '../../app/platform/errors'
import type { AuditEntry } from '../../shared/repositories/contracts'

const ACTION_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  create: 'success',
  update: 'warning',
  delete: 'danger',
}

export function auditView(): HTMLElement {
  const repos = getRepositories()

  let entityType = ''
  let action = ''
  let search = ''
  let rows: AuditEntry[] = []
  let cursor: string | null = null
  let loading = false
  let entityTypes: string[] = []

  const root = h('div', { class: 'flex h-full min-h-0 flex-col' })
  const headSlot = h('div', { class: 'space-y-2 border-b border-border p-3' })
  const listSlot = h('div', { class: 'min-h-0 flex-1 overflow-y-auto p-3' })
  const footerSlot = h('div', { class: 'border-t border-border p-3' })

  async function reload(): Promise<void> {
    if (loading) return
    loading = true
    cursor = null
    mount(listSlot, h('div', { class: 'flex justify-center p-6' }, spinner()))
    try {
      if (entityTypes.length === 0) {
        try {
          entityTypes = await repos.audit.entityTypes()
        } catch {
          entityTypes = []
        }
      }
      const page = await repos.audit.list({
        limit: 40,
        ...(entityType ? { entityType } : {}),
        ...(action ? { action } : {}),
        ...(search.trim() ? { search } : {}),
      })
      rows = page.items
      cursor = page.nextCursor
      renderHead()
      render()
    } catch (error) {
      mount(listSlot, emptyState('The audit trail could not be loaded', { description: translateError(error).message, iconName: 'error' }))
    } finally {
      loading = false
      renderFooter()
    }
  }

  async function loadMore(): Promise<void> {
    if (!cursor || loading) return
    loading = true
    try {
      const page = await repos.audit.list({
        limit: 40,
        cursor,
        ...(entityType ? { entityType } : {}),
        ...(action ? { action } : {}),
        ...(search.trim() ? { search } : {}),
      })
      rows = [...rows, ...page.items]
      cursor = page.nextCursor
      render()
    } catch (error) {
      mount(
        footerSlot,
        h('p', { class: 'text-xs text-danger', text: translateError(error).message })
      )
    } finally {
      loading = false
      renderFooter()
    }
  }

  function renderHead(): void {
    const entitySelect = select({
      id: 'audit-entity',
      options: [{ value: '', label: 'Everything' }, ...entityTypes.map((type) => ({ value: type, label: humanizeEntity(type) }))],
      value: entityType,
      onChange: (value) => {
        entityType = value
        void reload()
      },
    })
    const actionSelect = select({
      id: 'audit-action',
      options: [
        { value: '', label: 'Any change' },
        { value: 'create', label: 'Created' },
        { value: 'update', label: 'Updated' },
        { value: 'delete', label: 'Deleted' },
      ],
      value: action,
      onChange: (value) => {
        action = value
        void reload()
      },
    })
    const searchBox = searchInput('Search the actor’s email or a field value…', (value) => {
      search = value
      void reload()
    })

    mount(headSlot, h('div', { class: 'grid gap-2 sm:grid-cols-2' }, entitySelect, actionSelect), searchBox)
  }

  function render(): void {
    if (rows.length === 0) {
      mount(
        listSlot,
        emptyState('No changes recorded', {
          description: 'Every edit to products, prices, customers, stock and settings lands here automatically, with the person who made it.',
          iconName: 'history',
        })
      )
      return
    }

    mount(
      listSlot,
      h(
        'div',
        { class: 'overflow-hidden rounded-xl border border-border bg-surface' },
        ...rows.map((entry) =>
          h(
            'button',
            {
              type: 'button',
              class:
                'flex w-full min-h-[64px] items-start gap-3 border-b border-border p-3 text-left last:border-b-0 ' +
                'hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              onclick: () => openEntry(entry),
            },
            h(
              'div',
              { class: 'min-w-0 flex-1' },
              h(
                'div',
                { class: 'flex flex-wrap items-center gap-2' },
                badge(entry.action, { tone: ACTION_TONES[entry.action] ?? 'neutral' }),
                h('span', { class: 'text-sm font-medium text-content', text: humanizeEntity(entry.entityType) }),
                h('span', { class: 'text-xs tabular-nums text-content-subtle', text: shortId(entry.entityId) })
              ),
              h('p', {
                class: 'mt-0.5 truncate text-xs text-content-muted',
                text: `${entry.actorEmail ?? 'Unknown user'} · ${formatWhen(entry.createdAt)}`,
              }),
              h('p', { class: 'mt-0.5 truncate text-xs text-content-subtle', text: summaryLine(entry) })
            )
          )
        )
      )
    )
  }

  function renderFooter(): void {
    mount(
      footerSlot,
      h(
        'div',
        { class: 'flex items-center justify-between gap-3' },
        h('p', { class: 'text-xs text-content-subtle', text: `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}${cursor ? ' · more' : ''}` }),
        cursor ? button('Load more', { variant: 'outline', onClick: () => void loadMore() }) : null
      )
    )
  }

  /** Actor, before, after — the three things the acceptance criteria name. */
  function openEntry(entry: AuditEntry): void {
    const fields = collectFields(entry)
    const dialog = modal({
      title: `${humanizeEntity(entry.entityType)} ${entry.action}`,
      subtitle: `${entry.actorEmail ?? 'Unknown user'} · ${formatWhen(entry.createdAt)}`,
      iconName: 'history',
      size: 'lg',
      footer: [],
    })

    mount(
      dialog.body,
      h(
        'div',
        { class: 'space-y-4' },
        card(
          h('p', { class: 'text-xs font-medium text-content-muted', text: 'Who and what' }),
          row('Actor', entry.actorEmail ?? 'Unknown user'),
          row('Action', entry.action),
          row('Record', `${humanizeEntity(entry.entityType)} · ${entry.entityId ?? '—'}`),
          row('When', formatWhen(entry.createdAt))
        ),
        fields.length > 0
          ? card(
              h(
                'div',
                { class: 'grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 text-sm' },
                h('span', { class: 'text-xs font-medium text-content-muted', text: 'Field' }),
                h('span', { class: 'text-xs font-medium text-content-muted', text: 'Before' }),
                h('span', { class: 'text-xs font-medium text-content-muted', text: 'After' }),
                ...fields.flatMap((field) => [
                  h('span', { class: 'truncate text-content-muted', text: field.label }),
                  h('span', {
                    class: `truncate tabular-nums ${field.changed ? 'text-danger line-through' : 'text-content-subtle'}`,
                    text: field.before,
                  }),
                  h('span', {
                    class: `truncate tabular-nums ${field.changed ? 'font-medium text-success' : 'text-content-subtle'}`,
                    text: field.after,
                  }),
                ])
              )
            )
          : card(h('p', { class: 'text-sm text-content-muted', text: 'No field values were recorded for this change.' }))
      )
    )
  }

  function row(label: string, value: string): HTMLElement {
    return h(
      'div',
      { class: 'mt-1 flex justify-between gap-3 text-sm' },
      h('span', { class: 'text-content-muted', text: label }),
      h('span', { class: 'truncate text-content', text: value })
    )
  }

  mount(
    root,
    h('div', { class: 'px-3 pt-3' }, h('h1', { class: 'text-lg font-semibold text-content', text: 'Audit trail' })),
    headSlot,
    listSlot,
    footerSlot
  )

  void reload()
  return root
}

interface FieldDiff {
  label: string
  before: string
  after: string
  changed: boolean
}

/** Union of the before and after keys, so a removed field still shows. */
function collectFields(entry: AuditEntry): FieldDiff[] {
  const before = entry.before ?? {}
  const after = entry.after ?? {}
  const noisy = new Set(['organization_id', 'updated_at', 'created_at'])

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !noisy.has(key))
    .sort()

  return keys.map((key) => {
    const from = render(before[key])
    const to = render(after[key])
    return { label: humanizeEntity(key), before: from, after: to, changed: from !== to }
  })
}

function render(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function summaryLine(entry: AuditEntry): string {
  const fields = collectFields(entry).filter((field) => field.changed)
  if (fields.length === 0) return 'No field values changed'
  return fields
    .slice(0, 3)
    .map((field) => `${field.label}: ${field.before} → ${field.after}`)
    .join('  ·  ')
}

function humanizeEntity(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function shortId(id: string | null): string {
  if (!id) return ''
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
