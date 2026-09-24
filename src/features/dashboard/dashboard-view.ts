/**
 * Dashboard — Phase 1 status view.
 *
 * Deliberately not a sales dashboard yet: there are no sales until Phase 2.
 * What it does show is the platform working — which plugins loaded, which
 * product fields they contributed, and what the signed-in role can reach.
 * That is the Phase 1 deliverable, and it is the evidence the plugin
 * architecture holds.
 */

import { h, icon, mount } from '../../components/ui/h'
import { card, cardHeader, badge, stat, emptyState } from '../../components/ui/card'
import { button } from '../../components/ui/button'
import { getRepositories } from '../../app/data'
import { stockAlertStore, refreshStockAlerts } from '../../app/state/stock-alerts'
import { formatMoney } from '../../shared/domain/money'
import type { PluginRegistry } from '../../shared/registry/plugin-registry'
import { sessionStore, activeOrganization } from '../../app/state/session'
import { eventBus } from '../../shared/bus'

export interface DashboardOptions {
  onNavigate?: (path: string) => void
}

export function dashboardView(registry: PluginRegistry, options: DashboardOptions = {}): HTMLElement {
  const session = sessionStore.state
  const org = activeOrganization()
  const onNavigate = options.onNavigate

  return h(
    'div',
    { class: 'mx-auto max-w-6xl space-y-4 p-4 lg:p-6' },

    // Greeting
    h(
      'div',
      { class: 'flex flex-wrap items-end justify-between gap-3' },
      h(
        'div',
        null,
        h('h2', {
          class: 'text-xl font-semibold text-content',
          text: org ? org.name : 'Your shop',
        }),
        h('p', {
          class: 'mt-0.5 text-sm text-content-muted',
          text: `Signed in as ${session.email ?? '—'} · ${session.organizations.length} shop(s)`,
        })
      ),
      h(
        'div',
        { class: 'flex items-center gap-2' },
        session.organizations.flatMap((o) => o.role_names).map((role) =>
          badge(role, { tone: 'primary', iconName: 'shield' })
        )
      )
    ),

    // Inventory at a glance. The value comes from `stock_summary`, which
    // computes Σ(quantity × avg_unit_cost) the same way the stock screen does —
    // the Phase 3 acceptance test asserts the two are equal exactly, so neither
    // may grow its own arithmetic.
    stockCard(onNavigate),

    // Platform vitals
    h(
      'div',
      { class: 'grid grid-cols-2 gap-3 lg:grid-cols-4' },
      stat('Plugins loaded', String(registry.list().filter((p) => p.status === 'loaded').length), {
        iconName: 'extension',
        hint: `${registry.list().length} declared`,
      }),
      stat('Product fields', String(registry.productFields.items.length), {
        iconName: 'view_agenda',
        hint: 'all contributed by plugins',
      }),
      stat('Permissions held', String(session.permissions.length), {
        iconName: 'verified_user',
        hint: 'granted by your role',
      }),
      stat('Plugin nav items', String(registry.nav.items.length), {
        iconName: 'explore',
        hint: 'added to the sidebar with no feature edits',
      })
    ),

    h(
      'div',
      { class: 'grid gap-4 lg:grid-cols-2' },
      pluginsCard(registry),
      productFieldsCard(registry)
    ),

    permissionsCard(),

    h('div', null, nextStepsCard())
  )
}

/**
 * Stock value and the two counts worth acting on.
 *
 * The counts come from the shared alert store — the same number the sidebar
 * badge shows, so the two can never disagree — while the value is fetched here
 * because only this card displays money. `stock_summary` computes it as
 * Σ(quantity × avg_unit_cost), the same expression the stock screen uses; the
 * Phase 3 acceptance test asserts those two are equal exactly, so neither may
 * grow its own arithmetic.
 */
function stockCard(onNavigate?: (path: string) => void): HTMLElement {
  const currency = activeOrganization()?.currency ?? 'BDT'

  const valueSlot = h('p', {
    class: 'mt-1 text-2xl font-semibold tabular-nums text-content',
    text: '—',
  })
  const countsSlot = h('div', { class: 'mt-3 flex flex-wrap gap-2' })
  const noteSlot = h('p', { class: 'mt-2 text-xs text-content-subtle' })

  let stockValue: number | null = null
  let failure: string | null = null

  const render = (): void => {
    const { lowStock, outOfStock } = stockAlertStore.state

    valueSlot.textContent = stockValue === null ? '—' : formatMoney(stockValue as never, { currency })

    mount(
      countsSlot,
      badge(`${lowStock} low`, {
        tone: lowStock > 0 ? 'warning' : 'neutral',
        iconName: 'trending_down',
      }),
      badge(`${outOfStock} out`, {
        tone: outOfStock > 0 ? 'danger' : 'neutral',
        iconName: 'production_quantity_limits',
      })
    )

    mount(
      noteSlot,
      h('span', {
        text: failure
          ? failure
          : lowStock > 0 || outOfStock > 0
            ? 'Tap to see what needs reordering'
            : 'Everything is above its reorder point',
      })
    )
  }

  const unsubscribe = stockAlertStore.subscribe(render)
  const load = async (): Promise<void> => {
    try {
      const summary = await getRepositories().stock.summary()
      stockValue = summary.stockValue
      failure = null
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Stock value is unavailable right now.'
    }
    // The view may have been replaced while this was in flight; writing into a
    // detached node would leak the subscription.
    if (!valueSlot.isConnected) {
      unsubscribe()
      return
    }
    render()
  }

  render()
  void refreshStockAlerts().then(load)

  if (onNavigate) {
    const go = (): void => onNavigate('/stock')
    countsSlot.addEventListener('click', go)
    countsSlot.classList.add('cursor-pointer')
    valueSlot.classList.add('cursor-pointer')
    valueSlot.addEventListener('click', go)
  }

  return card(
    cardHeader('Stock', { subtitle: 'What is on the shelves, and what it cost', iconName: 'warehouse' }),
    // The label is not decoration: "৳ 11,641.50" on its own does not say
    // whether it is what the stock cost, what it would sell for, or today's
    // take. The Phase 3 acceptance test reads this figure off the screen, so
    // it also has to be unambiguous to a human reading it.
    h('p', { class: 'text-xs font-medium text-content-muted', text: 'Stock value' }),
    valueSlot,
    countsSlot,
    noteSlot
  )
}

function pluginsCard(registry: PluginRegistry): HTMLElement {
  const registrations = registry.list()

  const rows = registrations.map((registration) => {
    const { plugin, status, error } = registration
    const tone = status === 'loaded' ? 'success' : status === 'error' ? 'danger' : 'neutral'

    return h(
      'div',
      { class: 'flex items-start gap-3 rounded-md border border-border p-3' },
      h(
        'span',
        {
          class:
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-content-muted',
        },
        icon(plugin.icon ?? 'extension', 'text-lg')
      ),
      h(
        'div',
        { class: 'min-w-0 flex-1' },
        h(
          'div',
          { class: 'flex items-center gap-2' },
          h('p', { class: 'text-sm font-medium text-content', text: plugin.name }),
          badge(plugin.version, { tone: 'neutral' })
        ),
        h('p', { class: 'mt-0.5 text-xs text-content-muted', text: plugin.description ?? '' }),
        h('p', { class: 'mt-1 font-mono text-[10px] text-content-subtle', text: plugin.id }),
        error ? h('p', { class: 'mt-1 text-xs text-danger', text: error }) : null
      ),
      badge(status, { tone: tone === 'neutral' ? 'neutral' : tone, iconName: status === 'loaded' ? 'check' : 'info' })
    )
  })

  return card(
    cardHeader('Plugins', {
      subtitle: 'Declared in code, loaded at boot',
      iconName: 'extension',
      actions: button('Reload', {
        size: 'md',
        variant: 'ghost',
        onClick: () => window.location.reload(),
      }),
    }),
    rows.length > 0
      ? h('div', { class: 'space-y-2' }, ...rows)
      : emptyState('No plugins declared', {
          description: 'Plugins live in src/plugins/. Phase 6 adds the loader.',
          iconName: 'extension_off',
        })
  )
}

function productFieldsCard(registry: PluginRegistry): HTMLElement {
  const fields = registry.productFields.items

  return card(
    cardHeader('Plugin product fields', {
      subtitle: 'The core product form renders these without knowing them',
      iconName: 'view_agenda',
    }),
    fields.length === 0
      ? emptyState('No plugin fields yet', { iconName: 'view_agenda' })
      : h(
          'div',
          { class: 'overflow-x-auto' },
          h(
            'table',
            { class: 'w-full text-sm' },
            h(
              'thead',
              null,
              h(
                'tr',
                { class: 'border-b border-border text-left text-xs text-content-subtle' },
                h('th', { class: 'py-2 pr-3 font-medium', text: 'Field' }),
                h('th', { class: 'py-2 pr-3 font-medium', text: 'Type' }),
                h('th', { class: 'py-2 pr-3 font-medium', text: 'Section' }),
                h('th', { class: 'py-2 pr-3 font-medium', text: 'Storage' }),
                h('th', { class: 'py-2 font-medium', text: 'From' })
              )
            ),
            h(
              'tbody',
              null,
              ...fields.map((field) =>
                h(
                  'tr',
                  { class: 'border-b border-border/50 last:border-0' },
                  h('td', { class: 'py-2 pr-3 text-content', text: field.label }),
                  h('td', { class: 'py-2 pr-3 font-mono text-xs text-content-muted', text: field.type }),
                  h('td', { class: 'py-2 pr-3 text-content-muted', text: field.section ?? 'basic' }),
                  h('td', { class: 'py-2 pr-3 text-content-muted', text: field.storage }),
                  h(
                    'td',
                    { class: 'py-2' },
                    badge(field.source ?? 'core', { tone: 'primary' })
                  )
                )
              )
            )
          )
        )
  )
}

function permissionsCard(): HTMLElement {
  const permissions = [...sessionStore.state.permissions].sort()

  if (permissions.length === 0) {
    return card(
      cardHeader('Permissions', { iconName: 'verified_user' }),
      emptyState('No permissions loaded', {
        description: 'Sign in to load your role permissions from the server.',
        iconName: 'lock',
      })
    )
  }

  // Group by resource so a long list stays readable.
  const grouped = new Map<string, string[]>()
  for (const key of permissions) {
    const resource = key.split('.')[0] ?? 'other'
    const action = key.split('.')[1] ?? key
    const bucket = grouped.get(resource)
    if (bucket) {
      bucket.push(action)
    } else {
      grouped.set(resource, [action])
    }
  }

  return card(
    cardHeader('What your role can do', {
      subtitle: `${permissions.length} permissions, expanded server-side from your role`,
      iconName: 'verified_user',
    }),
    h(
      'div',
      { class: 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3' },
      ...[...grouped.entries()].map(([resource, actions]) =>
        h(
          'div',
          { class: 'rounded-md border border-border p-2.5' },
          h('p', { class: 'text-xs font-semibold text-content capitalize', text: resource }),
          h('p', { class: 'mt-1 text-xs text-content-muted', text: actions.join(' · ') })
        )
      )
    )
  )
}

function nextStepsCard(): HTMLElement {
  const steps = [
    { phase: 'Phase 2', label: 'Core POS', detail: 'Take a real sale end to end' },
    { phase: 'Phase 3', label: 'Inventory', detail: 'Stock in/out, transfers, ledger' },
    { phase: 'Phase 4', label: 'Business management', detail: 'Purchases, expenses, returns' },
    { phase: 'Phase 5', label: 'Analytics', detail: 'Dashboard, reports, insights' },
  ]

  return card(
    cardHeader('Roadmap', { subtitle: 'Where this is going', iconName: 'route' }),
    h(
      'div',
      { class: 'space-y-2' },
      ...steps.map((step) =>
        h(
          'div',
          { class: 'flex items-center gap-3 rounded-md bg-surface-muted p-2.5' },
          badge(step.phase, { tone: 'neutral' }),
          h(
            'div',
            { class: 'min-w-0 flex-1' },
            h('p', { class: 'text-sm font-medium text-content', text: step.label }),
            h('p', { class: 'text-xs text-content-muted', text: step.detail })
          ),
          icon('arrow_forward', 'text-content-subtle text-base')
        )
      )
    ),
    h('div', { class: 'mt-3' },
      button('Test the event bus', {
        size: 'md',
        variant: 'outline',
        icon: 'bolt',
        onClick: () => {
          eventBus.emit('ui.toast', {
            type: 'ui.toast',
            data: { message: 'EventBus → toast works.', tone: 'success' },
          })
        },
      })
    )
  )
}
