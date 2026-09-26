/**
 * History API router with permission guards.
 *
 * The deployed app is a static GitHub Pages site, so `public/404.html` sends
 * direct deep links back to the application entry point. Navigation itself
 * stays on real paths: links are copyable, browser back/forward works, and a
 * legacy `#/settings` URL is migrated once rather than becoming a second
 * routing system.
 */

export interface RouteContext {
  /** Named path parameters: `/products/:id` → `{ id: '…' }`. */
  params: Record<string, string>
  query: URLSearchParams
  path: string
}

export interface Route {
  /** `/pos`, `/products/:id`, `/plugins/:id/settings` */
  path: string
  title: string
  /** Permission key required to enter. Omit for public routes (e.g. login). */
  permission?: string
  render: (ctx: RouteContext) => HTMLElement | Promise<HTMLElement>
  /** Called when leaving the route. Return false to cancel navigation. */
  beforeLeave?: () => boolean | Promise<boolean>
}

export interface RouterOptions {
  container: HTMLElement
  fallback?: string
  /** Return a path to redirect to, or null to allow. */
  guard?: (route: Route) => string | null | Promise<string | null>
  onNavigate?: (route: Route, ctx: RouteContext) => void
  onError?: (error: unknown, route: Route) => void
}

interface CompiledRoute {
  route: Route
  matcher: RegExp
  paramNames: string[]
}

/** The configured Vite base, resolved to an absolute path for this page. */
export function appBasePath(): string {
  const raw = new URL(import.meta.env.BASE_URL || './', window.location.href).pathname
  const normalised = raw.endsWith('/') ? raw : `${raw}/`
  return normalised === '//' ? '/' : normalised
}

/** The route portion of the current browser URL, excluding the deploy prefix. */
export function appPath(): string {
  const base = appBasePath()
  const pathname = window.location.pathname
  if (base === '/') return pathname || '/'
  if (pathname === base.slice(0, -1) || pathname === base) return '/'
  if (pathname.startsWith(base)) return `/${pathname.slice(base.length)}`
  return pathname || '/'
}

/** `/products/:id/edit` → `^/products/([^/]+)/edit$`, `['id']`. */
function compile(path: string): { matcher: RegExp; paramNames: string[] } {
  const paramNames: string[] = []
  const pattern = path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1))
        return '([^/]+)'
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return { matcher: new RegExp(`^${pattern}$`), paramNames }
}

function absoluteRoute(to: string): string {
  const route = to.startsWith('/') ? to : `/${to}`
  const base = appBasePath()
  return `${base === '/' ? '' : base.slice(0, -1)}${route}` || '/'
}

function migrateLegacyLocation(): void {
  const hash = window.location.hash
  if (hash.startsWith('#/')) {
    const legacy = hash.slice(1)
    window.history.replaceState(null, '', `${absoluteRoute(legacy)}${window.location.search}`)
    return
  }

  // GitHub Pages' 404 page stores the deep link here before returning to the
  // entry point. sessionStorage is used only for this one hand-off and is
  // removed immediately, so a later reload never replays an old route.
  try {
    const saved = sessionStorage.getItem('mekholi.page-redirect')
    if (!saved) return
    sessionStorage.removeItem('mekholi.page-redirect')
    const parsed = JSON.parse(saved) as { path?: string; search?: string }
    if (typeof parsed.path === 'string' && parsed.path.startsWith('/')) {
      window.history.replaceState(null, '', `${absoluteRoute(parsed.path)}${parsed.search ?? ''}`)
    }
  } catch {
    // Storage may be disabled. The root route remains a safe fallback.
  }
}

export class Router {
  readonly #routes: CompiledRoute[] = []
  #container: HTMLElement
  #guard: RouterOptions['guard']
  #onNavigate: RouterOptions['onNavigate']
  #onError: RouterOptions['onError']
  #fallback: string
  #current: { route: Route; ctx: RouteContext } | null = null
  #started = false
  #onPopState = (): void => {
    void this.#resolve()
  }

  constructor(options: RouterOptions) {
    this.#container = options.container
    this.#guard = options.guard
    this.#onNavigate = options.onNavigate
    this.#onError = options.onError
    this.#fallback = options.fallback ?? '/'
  }

  add(route: Route): this {
    const { matcher, paramNames } = compile(route.path)
    this.#routes.push({ route, matcher, paramNames })
    return this
  }

  addAll(routes: readonly Route[]): this {
    for (const route of routes) this.add(route)
    return this
  }

  start(): void {
    if (this.#started) return
    migrateLegacyLocation()
    this.#started = true
    window.addEventListener('popstate', this.#onPopState)
    void this.#resolve()
  }

  stop(): void {
    window.removeEventListener('popstate', this.#onPopState)
    this.#started = false
  }

  get current(): Route | null {
    return this.#current?.route ?? null
  }

  get currentContext(): RouteContext | null {
    return this.#current?.ctx ?? null
  }

  navigate(to: string, options: { replace?: boolean } = {}): void {
    const target = absoluteRoute(to)
    const current = `${window.location.pathname}${window.location.search}`
    const next = `${target}${to.includes('?') ? '' : ''}`
    if (current === next) {
      void this.#resolve()
      return
    }
    if (options.replace) window.history.replaceState(null, '', target)
    else window.history.pushState(null, '', target)
    void this.#resolve()
  }

  /** Re-render the current route without changing the URL. */
  refresh(): void {
    void this.#resolve()
  }

  // ── Resolution ────────────────────────────────────────────────────────

  #parse(): { path: string; query: URLSearchParams } {
    return {
      path: appPath().split('?')[0] || '/',
      query: new URLSearchParams(window.location.search),
    }
  }

  #match(path: string): { compiled: CompiledRoute; params: Record<string, string> } | null {
    for (const compiled of this.#routes) {
      const m = compiled.matcher.exec(path)
      if (m) {
        const params: Record<string, string> = {}
        compiled.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(m[i + 1] ?? '')
        })
        return { compiled, params }
      }
    }
    return null
  }

  async #resolve(): Promise<void> {
    const { path, query } = this.#parse()
    const matched = this.#match(path)

    if (!matched) {
      if (path !== this.#fallback) this.navigate(this.#fallback, { replace: true })
      return
    }

    const { compiled, params } = matched

    if (this.#current && this.#current.route !== compiled.route) {
      const leave = this.#current.route.beforeLeave
      if (leave) {
        const ok = await leave()
        if (!ok) {
          this.navigate(this.#current.ctx.path, { replace: true })
          return
        }
      }
    }

    if (this.#guard) {
      const redirect = await this.#guard(compiled.route)
      if (redirect !== null && redirect !== path) {
        this.navigate(redirect, { replace: true })
        return
      }
    }

    const ctx: RouteContext = { params, query, path }
    this.#container.replaceChildren()

    try {
      const view = await compiled.route.render(ctx)
      if (this.#parse().path !== path) return
      this.#container.appendChild(view)
      this.#current = { route: compiled.route, ctx }
      document.title = compiled.route.title ? `${compiled.route.title} · Mekholi` : 'Mekholi'
      this.#onNavigate?.(compiled.route, ctx)
    } catch (error) {
      if (this.#onError) this.#onError(error, compiled.route)
      else console.error(`[router] "${compiled.route.path}" failed to render`, error)
      this.#container.appendChild(this.#errorView(compiled.route, error))
    }
  }

  #errorView(route: Route, error: unknown): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'p-6'
    const title = document.createElement('h1')
    title.className = 'text-lg font-semibold mb-2'
    title.textContent = `Could not load ${route.title}`
    const detail = document.createElement('p')
    detail.className = 'text-sm text-content-muted font-mono'
    detail.textContent = error instanceof Error ? error.message : String(error)
    wrap.append(title, detail)
    return wrap
  }
}
