// Vanilla History Router — no hash, History API only
// Now base-aware for GitHub Pages project site (/Mekholi/) via Vite BASE_URL
export type ViewContext = { params: Record<string,string>; query: URLSearchParams; path: string }
export type ViewFn = (ctx: ViewContext) => string | HTMLElement | Promise<string | HTMLElement>
export type Route = { path: string; view: ViewFn | (() => Promise<{ default: ViewFn }>); guard?: () => boolean | string | Promise<boolean | string>; title?: string }

function getBase(): string {
  try{
    const b: any = (import.meta as any)?.env?.BASE_URL
    if(typeof b === 'string' && b && b !== '/') return b.endsWith('/') ? b : b + '/'
  }catch{}
  return '/'
}
function withoutBase(path: string): string {
  const base = getBase()
  if(base === '/' ) return path
  // base like /Mekholi/ — strip it if present
  if(path === base.slice(0,-1)) return '/' // /Mekholi -> /
  if(path.startsWith(base)) {
    const stripped = path.slice(base.length - 1) // keep leading /
    return stripped || '/'
  }
  return path
}
function withBase(path: string): string {
  const base = getBase()
  if(base === '/' ) return path
  if(path.startsWith(base)) return path
  // ensure single slash
  const cleanBase = base.replace(/\/$/, '')
  return cleanBase + (path.startsWith('/') ? path : '/' + path)
}

export function createRouter(routes: Route[], mount: HTMLElement) {
  function normalize(path: string){
    if(!path) return '/'
    // decode and remove trailing slash except root
    try{ path = decodeURI(path) }catch{}
    if(path.length>1 && path.endsWith('/')) path = path.slice(0,-1)
    return path || '/'
  }
  function match(pathname: string) {
    const stripped = withoutBase(pathname)
    const npath = normalize(stripped)
    for (const r of routes) {
      const keys: string[] = []
      const rPath = normalize(r.path)
      const pattern = new RegExp('^' + rPath.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '$')
      const m = npath.match(pattern)
      if (m) return { route: r, params: Object.fromEntries(keys.map((k, i) => [k, m[i+1]])) }
    }
    return null
  }

  async function render() {
    const url = new URL(location.href)
    const hit = match(url.pathname)
    if (!hit) {
      mount.innerHTML = `
        <div class="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
          <div class="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center text-3xl mb-4">🗺️</div>
          <h1 class="text-2xl font-extrabold text-slate-900">পৃষ্ঠা পাওয়া যায়নি — 404</h1>
          <p class="text-slate-500 mt-2 max-w-md">The page <code class="bg-slate-100 px-2 py-0.5 rounded text-xs">${url.pathname}</code> doesn’t exist.</p>
          <a href="${withBase('/')}" data-link class="mt-6 inline-flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-full font-semibold hover:bg-black transition">← Go Home</a>
        </div>`
      return
    }
    if (hit.route.guard) {
      // show lightweight loading while guard resolves (prevents flash of protected view)
      mount.innerHTML = `<div class="min-h-[50vh] grid place-items-center p-8"><div class="flex flex-col items-center gap-3"><div class="w-8 h-8 rounded-full border-2 border-slate-200 border-t-slate-900 dark:border-slate-700 dark:border-t-white animate-spin"></div><div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">Checking session…</div></div></div>`
      const g = await hit.route.guard()
      if (typeof g === 'string') { navigate(g); return }
      if (!g) return
    }
    // resolve view (support lazy import)
    let mod: any = hit.route.view
    // if it's a lazy loader returning promise with default
    if (mod.length === 0) {
      try {
        const res: any = await (mod as Function)()
        if (res && res.default) mod = res.default
      } catch { /* direct function */ }
    }
    const fn: ViewFn = typeof mod === 'function' ? mod as ViewFn : mod.default
    const out = await fn({ params: hit.params, query: url.searchParams, path: url.pathname })
    mount.innerHTML = ''
    if (typeof out === 'string') mount.innerHTML = out
    else mount.appendChild(out)
    if (hit.route.title) document.title = hit.route.title
    window.scrollTo({ top: 0, behavior: 'instant' as any })
    // re-bind data-link clicks inside new view
    bindLinks()
    // dispatch event for page-specific init
    window.dispatchEvent(new CustomEvent('mk:navigate', { detail: { path: url.pathname } }))
  }

  function navigate(path: string) {
    // ensure base prefix for pushes (so /login -> /Mekholi/login on Pages)
    const url = new URL(path, location.origin)
    const withBasePath = withBase(url.pathname) + url.search + url.hash
    history.pushState({}, '', withBasePath)
    render()
  }

  function bindLinks() {
    // already handled globally, but ensure view internal links work
  }

  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
    if (!a) return
    const href = a.getAttribute('href')!
    // allow data-no-router or external
    if (a.hasAttribute('data-no-router')) return
    if (a.target === '_blank' || a.hasAttribute('download')) return
    if (href.startsWith('http') && !href.startsWith(location.origin)) return
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return
    if (href.startsWith('#')) return
    // only handle same-origin path navigations
    try {
      const url = new URL(href, location.origin)
      if (url.origin !== location.origin) return
      // if href is hash-only, let browser handle
      if (href.startsWith('#')) return
      e.preventDefault()
      navigate(url.pathname + url.search + url.hash.replace(/^#/, ''))
    } catch {}
  })

  window.addEventListener('popstate', render)
  // initial
  render()
  return { navigate, render }
}
