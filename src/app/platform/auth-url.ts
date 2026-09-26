/**
 * The URL side of OAuth returns.
 *
 * When Google (or any provider) sends a browser back, GoTrue appends the
 * result to the redirect URL — a session in the fragment under the implicit
 * flow, a `?code=` under PKCE, or an `error_description` when the sign-in was
 * refused. Three things can go wrong with that, and this module is the defence
 * against all three:
 *
 *  1. **The tokens stay in the address bar.** They are a live credential, and
 *     a URL outlives the page: history, a shared screenshot, a bug report. The
 *     app moves to PKCE so the callback carries a single-use code instead, but
 *     a browser that already had an implicit-flow session can still present
 *     one, so the fragments are stripped here either way.
 *  2. **The fragment collides with the router.** Mekholi routes on
 *     `window.location.hash` (`#/pos`), and an implicit return is *also* a
 *     fragment (`#access_token=…`). Stripping has to leave a real route alone.
 *  3. **A refusal is silent.** `error=access_denied` is a perfectly good
 *     explanation for "clicking Continue with Google did nothing"; without
 *     reading it the app just shows the login screen again.
 *
 * Pure functions, no DOM, so they can be tested without a browser.
 */

/** Everything GoTrue may append: the session (implicit), the code (PKCE), an error. */
const AUTH_PARAM_KEYS = new Set([
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'expires_at',
  'expires_in',
  'token_type',
  'sb',
  'code',
  'error',
  'error_code',
  'error_description',
])

export interface AuthCallback {
  /** The URL with every auth parameter removed. */
  href: string
  /** What the provider said went wrong, if anything. */
  error: string | null
}

/**
 * Where the provider should send the browser back to.
 *
 * `base` is Vite's `BASE_URL`, and this project builds with `base: './'` so the
 * bundle works from any sub-path (GitHub Pages serves it at `/Mekholi/`). A
 * relative base has to be resolved against the **current page**, not against
 * the origin: `new URL('./', 'https://host')` is `https://host/`, which would
 * silently drop the sub-path and send production users to the Pages root. This
 * resolves against `href` so `'./'` and an absolute `'/Mekholi/'` both land on
 * the same place.
 *
 * The result must match an entry under Authentication → URL Configuration →
 * Redirect URLs. When it does not, GoTrue does **not** error: it silently
 * substitutes the project's Site URL, which is how a signed-in production user
 * ends up back on `http://localhost:5173` holding a valid session.
 */
export function buildRedirectUrl(href: string, base: string): string {
  return new URL(base, href).toString()
}

/** True when a fragment is a route (`#/pos`) rather than auth parameters. */
function isRouteFragment(fragment: string): boolean {
  return fragment.startsWith('/')
}

/**
 * Remove every auth parameter from a URL, keeping anything else — including a
 * route fragment and unrelated query parameters.
 */
export function stripAuthParams(href: string): AuthCallback {
  const url = new URL(href)
  const rawHash = url.hash.replace(/^#/, '')
  // Only read the fragment as parameters when it is not a route: `#/pos` would
  // otherwise be parsed as the parameter `/pos`.
  const fragment = isRouteFragment(rawHash) ? new URLSearchParams() : new URLSearchParams(rawHash)

  // `error_description` is the sentence; `error` is the code. Prefer the
  // sentence, and fall back to the code when there is no sentence.
  const error =
    url.searchParams.get('error_description') ??
    fragment.get('error_description') ??
    url.searchParams.get('error') ??
    fragment.get('error')

  for (const key of AUTH_PARAM_KEYS) url.searchParams.delete(key)

  if (rawHash !== '' && !isRouteFragment(rawHash)) {
    const params = fragment
    let touched = false
    for (const key of AUTH_PARAM_KEYS) {
      if (params.has(key)) {
        params.delete(key)
        touched = true
      }
    }
    if (touched) {
      const rest = params.toString()
      url.hash = rest === '' ? '' : `#${rest}`
    }
  }

  // `URL` keeps a bare '?' when the last parameter is removed.
  const search = url.searchParams.toString() === '' ? '' : url.search
  return { href: `${url.origin}${url.pathname}${search}${url.hash}`, error }
}

/**
 * Read a provider callback, clean the address bar, and report what went wrong.
 *
 * Call this **after** the auth client has consumed the URL: supabase-js reads
 * the callback when it is constructed (`detectSessionInUrl`), so stripping
 * first would throw the session away before it was read.
 */
export function consumeAuthCallback(href: string = window.location.href): string | null {
  const { href: cleaned, error } = stripAuthParams(href)
  if (cleaned !== href) window.history.replaceState(null, '', cleaned)
  return error
}
