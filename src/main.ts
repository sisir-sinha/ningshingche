/**
 * Application bootstrap.
 *
 * Order matters:
 *   1. Environment check — fail loudly and legibly if Supabase is absent.
 *   2. Plugins load before the first render, so the sidebar is already complete.
 *   3. The session is restored, which decides login screen versus shell.
 *   4. The router starts last, because its guards read the session.
 *
 * One router, not two. When signed in, the shell mounts and the router renders
 * into the shell's outlet; when signed out, the login view replaces the whole
 * root and the router is stopped. A second nested router would mean two sets
 * of guards to keep in step.
 */

import './styles/base.css'
import { env } from './app/env'
import { Router, type Route } from './app/router/router'
import { appShell, type AppShell } from './features/layout/app-shell'
import { loginView, notConfiguredView } from './features/auth/login-view'
import { dashboardView } from './features/dashboard/dashboard-view'
import { PluginRegistry } from './shared/registry/plugin-registry'
import { batchExpiryPlugin } from './plugins/batch-expiry'
import { eventBus } from './shared/bus'
import { mountToasts, toastError } from './components/feedback/toast'
import { installShortcuts } from './features/layout/command-palette'
import { bootstrapSession, signOut, needsOnboarding } from './app/platform/auth'
import { refreshSalesFloor, watchOrganization } from './app/state/sales-floor'
import { watchStockAlerts, watchVisibility } from './app/state/stock-alerts'
import { CORE_NAV } from './features/layout/navigation'
import { placeholderView } from './features/layout/placeholder-view'
import { resetRepositories } from './app/data'
import { posRoutes } from './features/pos'
import { productRoutes } from './features/products'
import { stockRoutes } from './features/stock'
import { salesRoutes } from './features/sales'
import { customerRoutes } from './features/customers'
import { supplierRoutes } from './features/suppliers'
import { purchaseRoutes } from './features/purchases'
import { expenseRoutes } from './features/expenses'
import { registerRoutes } from './features/register'
import { auditRoutes } from './features/audit'
import { onboardingRoutes } from './features/onboarding'
import { sessionStore, can } from './app/state/session'
import { translateError } from './app/platform/errors'
import { h } from './components/ui/h'
import { button } from './components/ui/button'
import { emptyState } from './components/ui/card'

const mountPoint = document.getElementById('app')
if (!mountPoint) throw new Error('#app mount point missing from index.html')
/** Non-null alias: `root` would lose its narrowing inside nested closures. */
const root: HTMLElement = mountPoint

// ── 1. Environment ────────────────────────────────────────────────────────

if (!env.isSupabaseConfigured) {
  root.replaceChildren(notConfiguredView())
  console.warn('[mekholi] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set')
}

// ── 2. Plugins ────────────────────────────────────────────────────────────
// Declared here and nowhere else. Adding a plugin means adding one line to
// this array; the sidebar, the product form and the palette pick it up
// without any other file changing.

const registry = new PluginRegistry(eventBus)
registry.declare(batchExpiryPlugin)

// ── 3. Toasts and shortcuts ───────────────────────────────────────────────

const unmountToasts = mountToasts()

let shell: AppShell | null = null

/** Installed in enterApp, released in leaveApp, so a re-login re-subscribes. */
let unwatchOrganization: () => void = () => {}
let unwatchStockAlerts: () => void = () => {}
let unwatchVisibility: () => void = () => {}

const uninstallShortcuts = installShortcuts(registry, [
  { combo: 'ctrl+k', handler: () => shell?.palette.open() },
])

// ── 4. Router ─────────────────────────────────────────────────────────────

/**
 * The router renders routes into this element and the shell mounts this same
 * element. They must be one and the same: handing the router a detached
 * container means every view renders into memory and the page stays blank —
 * which is exactly the bug this comment now prevents. Module-scoped so it
 * survives sign-out/sign-in cycles.
 */
const outlet = h('div', { class: 'h-full' })

/**
 * Every route requires a permission. The guard redirects to the onboarding
 * view when the account exists but has no shop, and to `/forbidden` when the
 * role lacks the key. There is no `/login` route: signing out unmounts the
 * shell and stops the router, which is a clearer state than a route that
 * renders differently depending on the session.
 */
const routes: Route[] = [
  {
    path: '/',
    title: 'Dashboard',
    permission: 'dashboard.view',
    render: () => dashboardView(registry, { onNavigate: (path) => router.navigate(path) }),
  },
  ...posRoutes({ bus: eventBus }),
  ...productRoutes(registry),
  ...stockRoutes({ onNavigate: (path) => router.navigate(path) }),
  ...salesRoutes(),
  ...customerRoutes({ onNavigate: (path) => router.navigate(path) }),
  ...supplierRoutes({ onNavigate: (path) => router.navigate(path) }),
  ...purchaseRoutes(),
  ...expenseRoutes(),
  ...registerRoutes(),
  ...auditRoutes(),
  {
    path: '/forbidden',
    title: 'Not permitted',
    render: () =>
      h(
        'div',
        { class: 'p-6' },
        emptyState('You do not have access to that page', {
          description: 'Ask the shop owner to grant your role the permission.',
          iconName: 'lock',
          action: button('Back to dashboard', { variant: 'primary', onClick: () => router.navigate('/') }),
        })
      ),
  },
  ...onboardingRoutes({ onDone: () => router.navigate('/') }),
]

const router = new Router({
  container: outlet,
  fallback: '/',
  guard: (route) => {
    if (sessionStore.state.status !== 'authenticated') return null
    if (needsOnboarding()) return route.path === '/onboarding' ? null : '/onboarding'
    if (can(route.permission)) return null
    return '/forbidden'
  },
  onNavigate: (route) => shell?.setTitle(route.title),
  onError: (error, route) => {
    const translated = translateError(error)
    console.error(`[router] ${route.path}`, error)
    toastError(`${route.title}: ${translated.message}`)
  },
})
// Every item the sidebar advertises must lead somewhere. The router silently
// redirects an unknown path to the dashboard, so an unbuilt screen looked
// like a broken menu rather than a screen that does not exist yet. Deriving
// the gap from the route table above means each placeholder disappears on its
// own the moment the real route is registered — there is no list to keep in
// step by hand.
const registered = new Set(routes.map((route) => route.path))
const placeholders: Route[] = CORE_NAV.filter((item) => !registered.has(item.route)).map(
  (item) => ({
    path: item.route,
    title: item.label,
    // exactOptionalPropertyTypes: an absent permission is a different thing
    // from a permission that happens to be undefined.
    ...(item.permission ? { permission: item.permission } : {}),
    render: () => placeholderView({ item, onBack: () => router.navigate('/') }),
  })
)

router.addAll([...routes, ...placeholders])

// ── 5. Shell mount and teardown ───────────────────────────────────────────

function enterApp(): void {
  // Branch, warehouse and register are resolved here rather than lazily by
  // each screen: the POS cannot render a priced product without knowing which
  // stock room to read, and three screens resolving it independently is three
  // chances to show a half-loaded counter.
  //
  // Subscribed here, not in boot(): signing in through the form calls this
  // function directly, and a subscription installed only on the
  // session-already-exists path meant switching shops stopped re-resolving the
  // floor for the rest of that browser session.
  unwatchOrganization()
  unwatchOrganization = watchOrganization()
  void refreshSalesFloor()

  // The low-stock badge is ambient: it must be right without the stock screen
  // being open, and on a device that never writes stock of its own — hence the
  // Realtime subscription rather than a refresh-on-my-own-changes.
  unwatchStockAlerts()
  unwatchStockAlerts = watchStockAlerts()

  // A tablet that slept through the afternoon must not wake up showing the
  // count it had at lunchtime.
  unwatchVisibility()
  unwatchVisibility = watchVisibility()

  shell = appShell({
    registry,
    bus: eventBus,
    onNavigate: (path) => router.navigate(path),
    onSignOut: () => void leaveApp(),
    outlet,
  })

  root.replaceChildren(shell.el)
  router.start()
  eventBus.emit('app.ready', { type: 'app.ready', data: undefined })
}

async function leaveApp(): Promise<void> {
  router.stop()
  shell?.el.remove()
  shell = null
  unwatchOrganization()
  unwatchStockAlerts()
  unwatchVisibility()
  resetRepositories()
  await signOut()
  root.replaceChildren(loginView({ onAuthenticated: enterApp }))
}

// ── 6. Boot ───────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  const results = await registry.loadAll()
  for (const registration of results) {
    if (registration.status !== 'loaded') {
      console.warn(
        `[mekholi] plugin "${registration.plugin.id}" is ${registration.status}`,
        registration.error ?? ''
      )
    }
  }

  try {
    await bootstrapSession()
  } catch (error) {
    const translated = translateError(error)
    sessionStore.set({ ...sessionStore.state, status: 'error', error: translated.message })
    toastError(translated.message)
  }

  if (sessionStore.state.status === 'authenticated' && !env.isSupabaseConfigured) {
    // Cannot happen in practice, but the state machine should not deadlock.
    root.replaceChildren(notConfiguredView())
    return
  }

  if (sessionStore.state.status === 'authenticated') {
    enterApp()
  } else {
    root.replaceChildren(loginView({ onAuthenticated: enterApp }))
  }
}

window.addEventListener('beforeunload', () => {
  uninstallShortcuts()
  unmountToasts()
  registry.disposeAll()
  eventBus.clear()
})

void boot()

// ── Diagnostics ───────────────────────────────────────────────────────────
// Exposed on window so a plugin failure or a permission mismatch can be
// inspected in the console without adding a debug build.

declare global {
  interface Window {
    mekholi?: {
      registry: PluginRegistry
      bus: typeof eventBus
      session: typeof sessionStore
      env: typeof env
      router: Router
    }
  }
}

window.mekholi = { registry, bus: eventBus, session: sessionStore, env, router }
