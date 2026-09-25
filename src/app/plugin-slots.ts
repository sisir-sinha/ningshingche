/**
 * Plugin slots inside core screens (spec §31, §51; docs/05 §7).
 *
 * A plugin describes *what it wants to add* — a dashboard widget, a POS panel,
 * a tab on a sale, a section in the product form — and the core draws it. That
 * is the whole reason adding a plugin never requires editing a feature: the
 * feature asks this module for its slots and renders whatever is registered.
 *
 * Three rules hold for every host in this file, because they are what make a
 * third-party plugin safe to switch on:
 *
 *  1. **Permission first.** A slot whose `permission` the signed-in user lacks
 *     is not rendered at all — the plugin never sees data it should not.
 *  2. **Nothing breaks the screen.** A plugin whose render throws is replaced
 *     by one line naming the plugin; the cart, the sale and the form still
 *     work. The shop loses a decoration, not a shift.
 *  3. **The shop can tell who added it.** Every slot carries a small
 *     attribution badge, so a shopkeeper never has to guess whether a panel is
 *     the core app or an add-on.
 *
 * Slots re-read the registry on `plugin.changed`, so switching a plugin on in
 * Settings makes its widget appear without a reload — and the subscription
 * unsubscribes itself when the screen it belongs to is gone.
 */

import { h, icon, mount } from '../components/ui/h'
import { badge } from '../components/ui/card'
import { eventBus } from '../shared/bus'
import { pluginRegistry } from './plugins'
import { can } from './state/session'
import type { PluginRegistry } from '../shared/registry/plugin-registry'
import type {
  FormSectionDefinition,
  DashboardWidgetDefinition,
  PanelContext,
  PanelDefinition,
  TabDefinition,
} from '../shared/registry/plugin-types'

/** Who contributed a slot — shown on every one of them. */
function attribution(source: string | undefined): HTMLElement | null {
  if (!source) return null
  const name = pluginRegistry.get(source)?.manifest.name ?? source
  return badge(name, { tone: 'neutral', iconName: 'extension', class: 'plugin-attribution' })
}

function failed(source: string | undefined, label: string, error: unknown): HTMLElement {
  const name = pluginRegistry.get(source ?? '')?.manifest.name ?? source ?? 'A plugin'
  const message = error instanceof Error ? error.message : String(error)
  // Logged as well as shown: a shopkeeper sees a tidier sentence than a stack.
  console.error(`[plugin-host] "${source ?? '?'}" could not draw ${label}`, error)
  return h(
    'p',
    { class: 'text-xs text-danger' },
    `${name} could not draw ${label}: ${message}`
  )
}

/**
 * Re-render this host when the set of loaded plugins changes.
 *
 * Deliberately self-cleaning: the listener unsubscribes the first time it fires
 * after the host has been detached, so no router changes were needed to avoid
 * leaking a subscription per screen visit.
 */
export function watchPluginSlots(host: HTMLElement, redraw: () => void): void {
  const unsubscribe = eventBus.on('plugin.changed', () => {
    if (!host.isConnected) {
      unsubscribe()
      return
    }
    redraw()
  })
}

function visible<T extends { permission?: string }>(items: readonly T[]): T[] {
  return items.filter((item) => can(item.permission))
}

// ── Dashboard widgets ─────────────────────────────────────────────────────

/**
 * The plugin widgets, as one grid section.
 *
 * Rendered below the core widgets rather than mixed into them: a shopkeeper
 * scanning the top row is reading the shop's own numbers, and those must never
 * depend on a plugin being present.
 */
export function pluginWidgetsHost(registry: PluginRegistry): HTMLElement {
  const host = h('div', { class: 'space-y-2' })

  async function draw(): Promise<void> {
    const widgets = visible<DashboardWidgetDefinition>(registry.widgets.items)
    if (widgets.length === 0) {
      mount(host, null)
      return
    }

    mount(host, h('p', { class: 'text-xs font-semibold uppercase tracking-wide text-content-subtle', text: 'From your plugins' }))

    const tilePromises = widgets.map(async (widget) => {
      try {
        const body = await widget.render()
        return h(
          'div',
          {
            class:
              'rounded-lg border border-border bg-surface p-4 ' +
              (widget.size === 'wide' ? 'sm:col-span-2' : ''),
          },
          h(
            'div',
            { class: 'mb-2 flex items-start justify-between gap-2' },
            h('p', { class: 'text-xs font-medium text-content-muted', text: widget.title }),
            attribution(widget.source)
          ),
          body
        )
      } catch (error) {
        return h(
          'div',
          { class: 'rounded-lg border border-border bg-surface p-4' },
          failed(widget.source, `the “${widget.title}” widget`, error)
        )
      }
    })

    const tiles = await Promise.all(tilePromises)
    mount(host, h('div', { class: 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4' }, ...tiles))
  }

  void draw()
  watchPluginSlots(host, () => void draw())
  return host
}

// ── POS panels ────────────────────────────────────────────────────────────

/**
 * Panels beside the cart.
 *
 * `context.total` is the live cart total, and the POS re-renders these on every
 * cart change (see `pos-view`), which is what lets a loyalty panel offer the
 * award *for this sale* rather than for the last one.
 */
export function pluginPanelsHost(registry: PluginRegistry, context: PanelContext): HTMLElement {
  const host = h('div', { class: 'space-y-2' })

  async function draw(): Promise<void> {
    const panels = visible<PanelDefinition>(registry.posPanels.items)
    if (panels.length === 0) {
      mount(host, null)
      return
    }

    const rendered = await Promise.all(
      panels.map(async (panel) => {
        try {
          const body = await panel.render(context)
          return h(
            'div',
            { class: 'rounded-lg border border-border bg-surface-muted p-3' },
            h(
              'div',
              { class: 'mb-1.5 flex items-center justify-between gap-2' },
              h('p', { class: 'text-xs font-semibold text-content', text: panel.label }),
              attribution(panel.source)
            ),
            body
          )
        } catch (error) {
          return h('div', { class: 'rounded-lg border border-border bg-surface-muted p-3' }, failed(panel.source, 'its panel', error))
        }
      })
    )

    mount(host, ...rendered)
  }

  void draw()
  watchPluginSlots(host, () => void draw())
  return host
}

// ── Sale tabs ─────────────────────────────────────────────────────────────

/**
 * Tabs on a sale (spec §54's sibling).
 *
 * A tab strip rather than a stack because a sale detail is already long: the
 * customer's balance belongs behind one tap, not at the bottom of a scroll. The
 * strip is hidden entirely when no plugin contributes a tab, so the core sale
 * view looks exactly as it did before any plugin was installed.
 */
export function pluginSaleTabsHost(registry: PluginRegistry, context: PanelContext): HTMLElement {
  const host = h('div', { class: 'space-y-2' })
  let selected: string | null = null

  async function draw(): Promise<void> {
    const tabs = visible<TabDefinition>(registry.saleTabs.items)
    if (tabs.length === 0) {
      mount(host, null)
      return
    }

    const active = tabs.find((tab) => tab.id === selected) ?? tabs[0]
    if (!active) return

    const strip = h(
      'div',
      { class: 'flex flex-wrap gap-1.5', role: 'tablist' },
      ...tabs.map((tab) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': tab.id === active.id ? 'true' : 'false',
            class:
              'inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium ' +
              (tab.id === active.id
                ? 'border-primary bg-primary/5 text-content'
                : 'border-border bg-surface text-content-muted hover:bg-surface-muted'),
            onClick: () => {
              selected = tab.id
              void draw()
            },
          },
          icon('extension', 'text-base'),
          h('span', { text: tab.label })
        )
      )
    )

    const body = h('div', { class: 'rounded-lg border border-border bg-surface p-3' })
    try {
      mount(body, await active.render(context))
    } catch (error) {
      mount(body, failed(active.source, `the “${active.label}” tab`, error))
    }

    mount(host, strip, body)
  }

  void draw()
  watchPluginSlots(host, () => void draw())
  return host
}

// ── Product-form sections ─────────────────────────────────────────────────

/**
 * Sections a plugin adds to the product form.
 *
 * `storage: 'table'` plugins own their tables and handle saving themselves;
 * `metadata` plugins get their values carried in `products.metadata` by the
 * core form. This host only draws the section and reports which one it is, so
 * the form can hand back the right values on submit.
 */
export function pluginFormSectionsHost(
  registry: PluginRegistry,
  context: PanelContext,
  section: FormSectionDefinition['section'] = 'basic'
): HTMLElement {
  const host = h('div', { class: 'space-y-3' })

  async function draw(): Promise<void> {
    const sections = visible<FormSectionDefinition>(registry.formSections.items).filter(
      (entry) => (entry.section ?? 'basic') === section
    )
    if (sections.length === 0) {
      mount(host, null)
      return
    }

    const rendered = await Promise.all(
      sections.map(async (entry) => {
        try {
          const body = await entry.render(context)
          return h(
            'div',
            { class: 'border-t border-border pt-3' },
            h(
              'div',
              { class: 'mb-2 flex items-center justify-between gap-2' },
              h('p', { class: 'text-sm font-medium text-content', text: entry.label }),
              attribution(entry.source)
            ),
            body
          )
        } catch (error) {
          return h('div', { class: 'border-t border-border pt-3' }, failed(entry.source, `the “${entry.label}” section`, error))
        }
      })
    )

    mount(host, ...rendered)
  }

  void draw()
  watchPluginSlots(host, () => void draw())
  return host
}
