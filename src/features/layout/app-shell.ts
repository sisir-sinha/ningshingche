/**
 * The application shell (docs/06).
 *
 * Sidebar + topbar + a router outlet. The shell owns no business logic; it
 * renders what the navigation model and the router give it. A plugin that
 * registers a nav item gets a sidebar entry and a route target with no change
 * to this file.
 */

import { h, mount } from '../../components/ui/h'
import { iconButton } from '../../components/ui/button'
import { syncIndicator } from './sync-indicator'
import { sidebar, markActive } from './sidebar'
import { CommandPalette } from './command-palette'
import type { PluginRegistry } from '../../shared/registry/plugin-registry'
import { sessionStore, activeOrganization, can } from '../../app/state/session'
import { appPath } from '../../app/router/router'
import { selectOrganization } from '../../app/platform/auth'
import type { EventBus } from '../../shared/bus'

export interface AppShellOptions {
  registry: PluginRegistry
  /**
   * The bus the registry was constructed with. Injected rather than imported
   * from the singleton, so the shell cannot silently listen to a different
   * bus than the one plugins publish to.
   */
  bus: EventBus
  onNavigate: (path: string) => void
  onSignOut: () => void
  /** The element the router renders into. */
  outlet: HTMLElement
}

export interface AppShell {
  el: HTMLElement
  outlet: HTMLElement
  palette: CommandPalette
  /** Re-render the sidebar — call after permissions or plugins change. */
  refreshNav: () => void
  setTitle: (title: string, subtitle?: string) => void
}

export function appShell(options: AppShellOptions): AppShell {
  const { registry, bus, onNavigate, onSignOut, outlet } = options

  /**
   * The two homes of the same sidebar. The host owns the width — 240px docked
   * beside the content, off-canvas below `lg` — and the aside fills it.
   */
  const sidebarHost = h('div', { class: 'hidden h-full w-60 shrink-0 lg:block' })
  /** Fills the drawer panel, whose width the panel itself decides. */
  const drawerHost = h('div', { class: 'h-full w-full' })

  // ── Mobile drawer ───────────────────────────────────────────────────────
  // A shop counter is often a phone or a tablet in portrait, so the sidebar
  // has to survive a narrow viewport as an off-canvas panel rather than
  // disappear. The previous version of this drawer was an empty overlay:
  // the hamburger darkened the screen and rendered no navigation at all.
  const drawerPanel = h(
    'div',
    // Slightly wider than the docked rail — thumbs and longer labels — and the
    // aside inside fills it edge to edge.
    { class: 'flex h-full w-72 max-w-[85vw] flex-col bg-surface shadow-2xl' },
    drawerHost
  )
  const drawer = h(
    'div',
    {
      id: 'mobile-drawer',
      class: 'fixed inset-0 z-[80] hidden bg-black/40 lg:hidden',
      'aria-hidden': 'true',
    },
    drawerPanel
  )

  const onDrawerKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeDrawer()
  }

  function closeDrawer(): void {
    drawer.classList.add('hidden')
    drawer.setAttribute('aria-hidden', 'true')
    document.removeEventListener('keydown', onDrawerKey)
  }

  function openDrawer(): void {
    // Re-render so permissions or plugins that changed since the last open
    // are reflected the moment the panel slides in.
    renderSidebar()
    drawer.classList.remove('hidden')
    drawer.setAttribute('aria-hidden', 'false')
    document.addEventListener('keydown', onDrawerKey)
  }

  function toggleDrawer(): void {
    if (drawer.classList.contains('hidden')) openDrawer()
    else closeDrawer()
  }

  // Tapping the dimmed backdrop closes; tapping the panel does not.
  drawer.addEventListener('click', (event) => {
    if (event.target === drawer) closeDrawer()
  })
  const titleEl = h('h1', { class: 'truncate text-base font-semibold text-content', text: 'Mekholi' })
  const subtitleEl = h('p', { class: 'truncate text-xs text-content-muted' })

  const palette = new CommandPalette({
    registry,
    onNavigate,
    extraCommands: () => [
      {
        id: 'app:signout',
        label: 'Sign out',
        icon: 'logout',
        group: 'Actions',
        keywords: 'sign out logout exit',
        run: onSignOut,
      },
      {
        id: 'app:refresh',
        label: 'Reload this page',
        icon: 'refresh',
        group: 'Actions',
        keywords: 'reload refresh retry',
        run: () => window.location.reload(),
      },
    ],
  })

  const org = activeOrganization()
  const shopName = org?.name ?? sessionStore.state.email ?? 'Mekholi'
  const shopInitial = shopName.charAt(0).toUpperCase()

  const hasMultipleOrgs = sessionStore.state.organizations.length > 1

  const renderSidebar = (): void => {
    const common = { registry, shopName, shopInitial }
    // The footer is built per instance: it is a single DOM element, and a
    // node shared between both sidebars would end up mounted in only one.
    const desktopFooter = hasMultipleOrgs ? buildOrgSwitcher() : undefined
    const drawerFooter = hasMultipleOrgs ? buildOrgSwitcher() : undefined

    mount(
      sidebarHost,
      sidebar({
        ...common,
        onNavigate,
        onOpenPalette: () => palette.open(),
        onSignOut,
        ...(desktopFooter ? { footer: desktopFooter } : {}),
      })
    )
    markActive(sidebarHost, currentPath())

    // The drawer gets its own instance whose every escape hatch — navigating,
    // opening the palette, signing out — closes it first. A drawer that stays
    // open over the page it just navigated to is how mobile UIs end up
    // feeling broken.
    mount(
      drawerHost,
      sidebar({
        ...common,
        onNavigate: (path) => {
          closeDrawer()
          onNavigate(path)
        },
        onOpenPalette: () => {
          closeDrawer()
          palette.open()
        },
        onSignOut: () => {
          closeDrawer()
          onSignOut()
        },
        ...(drawerFooter ? { footer: drawerFooter } : {}),
      })
    )
    markActive(drawerHost, currentPath())
  }

  const shell = h(
    'div',
    // `app-shell` (base.css) rather than `h-screen`: on a phone 100vh is the
    // height with the browser toolbar hidden, so the shell overshoots the
    // visible area, the document scrolls, and the topbar leaves the top of the
    // screen. The class is 100dvh with a vh fallback.
    //
    // No `overflow-hidden` here. It looks harmless and it was, but it silently
    // disables the topbar's `sticky`: an ancestor with a non-visible overflow
    // becomes the sticky element's scroll container, so the bar stuck to a box
    // that was itself scrolling away. Nothing needed the clipping — every
    // overlay in the app (drawer, palette, modal, receipt) is `fixed`, and
    // `main` clips its own overflow because it scrolls on one axis.
    { class: 'app-shell flex w-full bg-surface-muted' },

    // Sidebar — off-canvas below lg. The host owns the width; the aside fills
    // it, so the docked rail and the drawer are the same component at two
    // widths rather than two widths fighting inside one component.
    sidebarHost,

    h(
      'div',
      // `min-h-0` is the whole fix for the blank strip under the app. A flex
      // child's `min-height` defaults to `auto`, i.e. its content height, so
      // this column refused to shrink below whatever the current screen
      // wanted. The column then grew past the shell's 100dvh, the body
      // scrolled, and the overshoot showed as empty space below the page —
      // every screen, most visibly the POS, whose right rail is tall.
      { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },

      // Topbar — pinned to the top of the shell. The bar is a sibling of the
      // scrolling outlet, so it does not move when a view scrolls; `sticky`
      // makes that guarantee explicit for any future scroll container, and the
      // layer sits above page content but below the drawer (z-80) and toasts.
      h(
        'header',
        {
          class:
            'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4',
        },
        iconButton('menu', 'Open navigation', {
          variant: 'ghost',
          // 48px: the one control that has to be hit with a thumb, one-handed,
          // while the other hand is holding a customer's change.
          size: 'lg',
          class: 'lg:hidden',
          onClick: () => toggleDrawer(),
        }),
        h(
          'div',
          { class: 'min-w-0 flex-1' },
          titleEl,
          subtitleEl
        ),
        h(
          'div',
          { class: 'flex items-center gap-1' },
          syncIndicator(),
          headerActions(() =>
            bus.emit('ui.toast', {
              type: 'ui.toast',
              data: { message: 'Press Ctrl+K to search pages and actions.', tone: 'info' },
            })
          )
        )
      ),

      // Router outlet
      // Same reason: without `min-h-0` the outlet's own height wins over
      // `flex-1` and `overflow-y-auto` never engages, so a tall view pushes
      // the document instead of scrolling inside the frame.
      h('main', { class: 'min-h-0 flex-1 overflow-y-auto', id: 'app-outlet' }, outlet)
    ),

    drawer
  )

  renderSidebar()

  // Permissions can change when the organization is switched.
  sessionStore.subscribe(() => renderSidebar())

  // A plugin finishing its load may have added nav items.
  bus.on('plugin.loaded', () => renderSidebar())

  return {
    el: shell,
    outlet,
    palette,
    refreshNav: renderSidebar,
    setTitle: (title, subtitle) => {
      titleEl.textContent = title
      if (subtitle === undefined || subtitle === '') {
        subtitleEl.textContent = ''
        subtitleEl.classList.add('hidden')
      } else {
        subtitleEl.textContent = subtitle
        subtitleEl.classList.remove('hidden')
      }
    },
  }
}

function currentPath(): string {
  return appPath().split('?')[0] || '/'
}

function headerActions(onHelp: () => void): HTMLElement {
  const actions = h('div', { class: 'flex items-center gap-1' })

  if (can('register.open')) {
    actions.appendChild(iconButton('point_of_sale', 'Open register', { variant: 'ghost' }))
  }
  actions.appendChild(
    iconButton('help', 'Help', { variant: 'ghost', onClick: onHelp })
  )
  return actions
}

function buildOrgSwitcher(): HTMLElement {
  const orgs = sessionStore.state.organizations
  const active = sessionStore.state.activeOrganizationId

  const list = h('select', {
    class:
      'w-full h-9 rounded-md border border-border bg-surface px-2 text-xs text-content ' +
      'focus:outline-none focus:ring-2 focus:ring-ring',
    'aria-label': 'Switch shop',
  })
  for (const org of orgs) {
    list.appendChild(
      h('option', {
        value: org.organization_id,
        text: org.name,
        selected: org.organization_id === active,
      })
    )
  }

  list.addEventListener('change', () => {
    // Same path as every other organization switch: updates the store, swaps
    // permissions, and emits `session.changed`.
    selectOrganization(list.value)
  })

  return h('div', { class: 'px-1 pb-1' }, list)
}


