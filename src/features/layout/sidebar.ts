/**
 * The sidebar (spec §40, docs/06).
 *
 * Rendered from `buildNavigation()`, which means a plugin's nav item appears
 * here without this file knowing it exists. Sections with many entries start
 * collapsed so a cashier sees five buttons, not thirty.
 */

import { h, icon } from '../../components/ui/h'
import { buildNavigation } from './navigation'
import type { PluginRegistry } from '../../shared/registry/plugin-registry'

export interface SidebarOptions {
  registry: PluginRegistry
  shopName: string
  shopInitial: string
  /** Called with the target path; the shell owns the router. */
  onNavigate: (path: string) => void
  onOpenPalette: () => void
  onSignOut: () => void
  /** Extra entries pinned to the footer, e.g. an org switcher. */
  footer?: HTMLElement
}

const COLLAPSED_KEY = 'mekholi.sidebar.collapsed'

export function sidebar(options: SidebarOptions): HTMLElement {
  const { registry, shopName, shopInitial, onNavigate, onOpenPalette, onSignOut, footer } = options

  const collapsedSections = new Set<string>(readCollapsed())

  const nav = h('nav', {
    // The nav is the sidebar's scroll container, so it is the thing that owns
    // a scrollbar. `scrollbar-slim` keeps the affordance while stopping the
    // platform's default width from eating the right-hand edge of the rail.
    class: 'flex-1 overflow-y-auto px-2 py-3 space-y-4 scrollbar-slim',
    'aria-label': 'Main navigation',
  })

  const groups = buildNavigation(registry)

  for (const group of groups) {
    const isCollapsible = groups.length > 1 && group.section.collapsedByDefault === true
    const collapsed = collapsedSections.has(group.section.id)

    const listId = `nav-section-${group.section.id}`
    const list = h('ul', { id: listId, class: 'space-y-0.5', role: 'list' })

    for (const item of group.items) {
      list.appendChild(navItem(item, onNavigate))
    }

    const header = h(
      'button',
      {
        type: 'button',
        class:
          'flex w-full items-center justify-between rounded px-2 py-1 text-[11px] font-semibold ' +
          'uppercase tracking-wider text-content-subtle hover:text-content-muted ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'aria-expanded': String(!collapsed),
        'aria-controls': listId,
      },
      h('span', { text: group.section.label }),
      icon(collapsed ? 'chevron_right' : 'expand_more', 'text-sm transition-transform')
    )

    if (isCollapsible) {
      header.addEventListener('click', () => {
        const nowCollapsed = !collapsedSections.has(group.section.id)
        if (nowCollapsed) {
          collapsedSections.add(group.section.id)
        } else {
          collapsedSections.delete(group.section.id)
        }
        writeCollapsed(collapsedSections)
        list.classList.toggle('hidden', nowCollapsed)
        header.setAttribute('aria-expanded', String(!nowCollapsed))
        header.lastElementChild?.replaceChildren(
          icon(nowCollapsed ? 'chevron_right' : 'expand_more', 'text-sm')
        )
      })
    } else {
      // Not collapsible: render as a static label, not a button.
      header.disabled = true
      header.classList.add('cursor-default')
    }

    if (collapsed) list.classList.add('hidden')

    nav.append(h('div', null, header, list))
  }

  if (groups.length === 0) {
    nav.appendChild(
      h(
        'p',
        { class: 'px-2 py-4 text-xs text-content-subtle', text: 'No features available for your role.' }
      )
    )
  }

  return h(
    'aside',
    {
      // `w-full`, not `w-60`: the width belongs to the host, which is two
      // different things — 240px docked beside the content, up to 288px inside
      // the mobile drawer. When the aside carried its own `w-60`, the drawer's
      // extra 48px showed as a strip of the panel's white background down the
      // right-hand side of the navigation.
      class:
        'flex h-full w-full shrink-0 flex-col border-r border-border bg-surface-muted',
      'aria-label': 'Sidebar',
    },
    // Shop identity
    h(
      'div',
      { class: 'flex items-center gap-2.5 border-b border-border px-3 py-3' },
      h(
        'span',
        {
          class:
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary ' +
            'text-sm font-bold text-primary-foreground',
          text: shopInitial,
          'aria-hidden': 'true',
        }
      ),
      h(
        'div',
        { class: 'min-w-0 flex-1' },
        h('p', { class: 'truncate text-sm font-semibold text-content', text: shopName }),
        h('p', { class: 'truncate text-[11px] text-content-subtle', text: 'Mekholi' })
      )
    ),

    // Search / palette trigger
    h(
      'div',
      { class: 'px-3 pt-3' },
      h(
        'button',
        {
          type: 'button',
          class:
            'flex h-9 w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 ' +
            'text-sm text-content-subtle hover:border-ring hover:text-content-muted ' +
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          onclick: onOpenPalette,
        },
        icon('search', 'text-base'),
        h('span', { class: 'flex-1 text-left', text: 'Search…' }),
        h('kbd', {
          // Hidden on touch-sized screens: a keyboard shortcut hint is noise
          // on a phone, and it steals width from the search label.
          class:
            'hidden rounded border border-border bg-surface-muted px-1.5 py-0.5 ' +
            'font-mono text-[10px] text-content-subtle sm:inline-block',
          text: 'Ctrl K',
        })
      )
    ),

    nav,

    h(
      'div',
      { class: 'border-t border-border p-2 space-y-1' },
      footer ?? null,
      h(
        'button',
        {
          type: 'button',
          class:
            'flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-content-muted ' +
            'hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 ' +
            'focus-visible:ring-ring',
          onclick: onSignOut,
        },
        icon('logout', 'text-lg'),
        h('span', { text: 'Sign out' })
      )
    )
  )
}

function navItem(
  item: { id: string; label: string; icon: string; route: string; badge?: () => number | string | null },
  onNavigate: (path: string) => void
): HTMLLIElement {
  const link = h(
    'a',
    {
      href: `#${item.route}`,
      class:
        'group flex min-h-[44px] items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ' +
        'text-content-muted hover:bg-surface hover:text-content ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      dataset: { navId: item.id },
    },
    icon(item.icon, 'text-lg shrink-0'),
    h('span', { class: 'flex-1 truncate', text: item.label })
  )

  link.addEventListener('click', (event) => {
    event.preventDefault()
    onNavigate(item.route)
  })

  const badgeValue = item.badge?.()
  if (badgeValue !== null && badgeValue !== undefined && badgeValue !== '' && badgeValue !== 0) {
    link.appendChild(
      h('span', {
        class:
          'ml-auto rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-semibold ' +
          'text-danger-foreground tabular-nums',
        text: String(badgeValue),
      })
    )
  }

  return h('li', null, link)
}

/** Mark the item matching the current path. Called by the shell on navigate. */
export function markActive(sidebarEl: HTMLElement, path: string): void {
  for (const el of sidebarEl.querySelectorAll<HTMLElement>('[data-nav-id]')) {
    el.classList.remove('bg-surface', 'text-content', 'font-medium')
    el.removeAttribute('aria-current')
  }

  // Longest prefix wins so `/products/123` highlights `products`.
  let best: HTMLElement | null = null
  let bestLength = -1
  for (const el of sidebarEl.querySelectorAll<HTMLElement>('[data-nav-id]')) {
    const href = el.getAttribute('href') ?? ''
    const route = href.startsWith('#') ? href.slice(1) : href
    if (route === path || (route !== '/' && path.startsWith(`${route}/`))) {
      if (route.length > bestLength) {
        best = el
        bestLength = route.length
      }
    } else if (route === '/' && path === '/') {
      best = el
      bestLength = 1
    }
  }

  if (best) {
    best.classList.add('bg-surface', 'text-content', 'font-medium')
    best.setAttribute('aria-current', 'page')
  }
}

function readCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function writeCollapsed(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]))
  } catch {
    /* persistence is a nicety, not a requirement */
  }
}
