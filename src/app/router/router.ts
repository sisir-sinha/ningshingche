/**
 * Hash router with permission guards (spec §40).
 *
 * Hash routing rather than History routing because the app must run from
 * `file://` and from a static host with no rewrite rules — an Android
 * WebView bundle is exactly that case.
 *
 * A route can declare a `permission`. The guard is consulted before the view
 * renders, so an unauthorized user never sees a partially-built screen.
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

export class Router {
  readonly #routes: CompiledRoute[] = []
  #container: HTMLElement
  #guard: RouterOptions['guard']
  #onNavigate: RouterOptions['onNavigate']
  #onError: RouterOptions['onError']
  #fallback: string
  #current: { route: Route; ctx: RouteContext } | null = null
  #started = false
  #onHashChange = (): void => {
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
    this.#started = true
    window.addEventListener('hashchange', this.#onHashChange)
    void this.#resolve()
  }

  stop(): void {
    window.removeEventListener('hashchange', this.#onHashChange)
    this.#started = false
  }

  get current(): Route | null {
    return this.#current?.route ?? null
  }

  get currentContext(): RouteContext | null {
    return this.#current?.ctx ?? null
  }

  navigate(to: string, options: { replace?: boolean } = {}): void {
    const target = `#${to.startsWith('/') ? to : `/${to}`}`
    if (window.location.hash === target) {
      void this.#resolve()
      return
    }
    if (options.replace) {
      window.history.replaceState(null, '', target)
      void this.#resolve()
    } else {
      window.location.hash = target
    }
  }

  /** Re-render the current route without changing the URL. */
  refresh(): void {
    void this.#resolve()
  }

  // ── Resolution ────────────────────────────────────────────────────────

  #parse(): { path: string; query: URLSearchParams } {
    const raw = window.location.hash.replace(/^#/, '') || '/'
    const [pathPart, queryPart = ''] = raw.split('?')
    return {
      path: pathPart === '' ? '/' : (pathPart as string),
      query: new URLSearchParams(queryPart),
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
      if (path !== this.#fallback) {
        this.navigate(this.#fallback, { replace: true })
      }
      return
    }

    const { compiled, params } = matched

    // Ask the outgoing view whether it is safe to leave (unsaved cart, etc.).
    if (this.#current && this.#current.route !== compiled.route) {
      const leave = this.#current.route.beforeLeave
      if (leave) {
        const ok = await leave()
        if (!ok) {
          // Restore the hash without re-triggering resolution.
          window.history.replaceState(null, '', `#${this.#current.ctx.path}`)
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
      // A navigation may have happened while we awaited the view.
      if (this.#parse().path !== path) return
      this.#container.appendChild(view)
      this.#current = { route: compiled.route, ctx }
      document.title = compiled.route.title ? `${compiled.route.title} · Mekholi` : 'Mekholi'
      this.#onNavigate?.(compiled.route, ctx)
    } catch (error) {
      if (this.#onError) {
        this.#onError(error, compiled.route)
      } else {
        console.error(`[router] "${compiled.route.path}" failed to render`, error)
      }
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
