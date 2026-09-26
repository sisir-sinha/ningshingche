/**
 * Light / dark / system appearance.
 *
 * `tailwind.config.ts` has said `darkMode: 'class'` since the beginning and
 * `tokens.css` carries a full `.dark` block — every colour in the app already
 * had a dark value. Nothing ever wrote the class, so the dark theme existed
 * and could not be reached. This is the switch.
 *
 * Three states, not two. "System" is the honest default: a phone that flips
 * to dark at sunset should take the app with it, and a shop that wants the
 * bright screen all day can pin `light`. Only an explicit choice is stored,
 * so "system" keeps following the OS instead of freezing at whatever it
 * happened to be when the user first loaded the app.
 *
 * No dependency on the i18n layer or the app layer: this is a class on
 * `<html>` and a string in `localStorage`.
 */

export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

/** What is actually on screen once "system" has been resolved. */
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'mekholi.theme'

type Listener = (theme: Theme, resolved: ResolvedTheme) => void

const listeners = new Set<Listener>()
let current: Theme = readStored() ?? 'system'
let mediaBound = false

function readStored(): Theme | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    return (THEMES as readonly string[]).includes(raw ?? '') ? (raw as Theme) : null
  } catch {
    // Storage can be disabled in a WebView; an unreadable preference is not
    // a reason to fail to start.
    return null
  }
}

function writeStored(theme: Theme): void {
  try {
    // "system" is the absence of a choice, so it is removed rather than
    // written: the next OS change must still be followed.
    if (theme === 'system') globalThis.localStorage?.removeItem(STORAGE_KEY)
    else globalThis.localStorage?.setItem(STORAGE_KEY, theme)
  } catch {
    /* ignore */
  }
}

function query(): MediaQueryList | null {
  if (typeof globalThis.matchMedia !== 'function') return null
  try {
    return globalThis.matchMedia('(prefers-color-scheme: dark)')
  } catch {
    return null
  }
}

/** The preference: what the user picked, including "system". */
export function theme(): Theme {
  return current
}

/** The outcome: what the screen is showing right now. */
export function resolvedTheme(): ResolvedTheme {
  if (current !== 'system') return current
  return query()?.matches === true ? 'dark' : 'light'
}

/**
 * Write the theme onto the document.
 *
 * `class="dark"` is what Tailwind's variants key off; `color-scheme` is what
 * the browser keys off, and without it the native form controls, scrollbars
 * and autofill backgrounds stay light inside a dark page — the detail that
 * makes a hand-rolled dark mode look unfinished.
 */
export function applyTheme(): ResolvedTheme {
  const resolved = resolvedTheme()
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    root.style.colorScheme = resolved
    root.dataset.theme = current
    // The phone's status bar over the PWA.
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (meta) meta.content = resolved === 'dark' ? '#0b1120' : '#ffffff'
  }
  return resolved
}

/**
 * Choose a theme. Persisted, applied, then announced — a listener must never
 * be able to read back the previous value.
 */
export function setTheme(next: Theme): void {
  if (!(THEMES as readonly string[]).includes(next)) return
  current = next
  writeStored(next)
  const resolved = applyTheme()
  for (const listener of [...listeners]) listener(current, resolved)
}

/**
 * The topbar button: light → dark → light.
 *
 * Deliberately two-state rather than cycling through "system". A control
 * whose next state you cannot predict is a bad button; "system" stays
 * available in Settings, where it can be labelled.
 */
export function toggleTheme(): ResolvedTheme {
  setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark')
  return resolvedTheme()
}

export function onThemeChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Apply the stored preference and start following the OS.
 *
 * Called once at boot. The media listener is only interesting while the
 * preference is "system", but it is attached permanently and filtered — the
 * user can switch back to "system" without re-subscribing.
 */
export function initTheme(): ResolvedTheme {
  const resolved = applyTheme()
  if (mediaBound) return resolved
  const media = query()
  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', () => {
      if (current !== 'system') return
      const now = applyTheme()
      for (const listener of [...listeners]) listener(current, now)
    })
    mediaBound = true
  }
  return resolved
}

/** Test hook. */
export function resetThemeForTests(): void {
  listeners.clear()
  current = 'system'
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''
  }
}
