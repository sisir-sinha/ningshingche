/**
 * Translation, and the locale the app is currently speaking.
 *
 * The Language select in Settings used to write a column and change nothing
 * on screen: there was no i18n layer at all, so "বাংলা" was a preference the
 * app stored and then ignored. This is that layer.
 *
 * Deliberately small — no dependency, no async bundle loading, no ICU. Two
 * dictionaries live in `strings.ts`, `t()` reads one of them, and a listener
 * tells the shell to redraw. Everything the shop sees comes from one call:
 *
 *     t('nav.stock')                  → "Stock"  /  "স্টক"
 *     t('settings.partialFailure', { message })
 *
 * Bangla digits are part of speaking Bangla: ৳১,২৫০.৫০ is what a Bangladeshi
 * shopkeeper reads on a receipt, so `formatNumber` and the money formatter go
 * through `Intl` with the active tag rather than hard-coding `en-BD`.
 */

import { DICTIONARIES, LOCALES, LOCALE_TAGS, type Locale, type StringKey } from './strings'

export { LOCALES, LOCALE_NAMES, LOCALE_TAGS, type Locale, type StringKey } from './strings'

const STORAGE_KEY = 'mekholi.locale'
const DEFAULT_LOCALE: Locale = 'en'

type Listener = (locale: Locale) => void

const listeners = new Set<Listener>()
let current: Locale = readStored() ?? DEFAULT_LOCALE

/** Narrows an arbitrary string — a database column — to a locale we ship. */
export function asLocale(value: string | null | undefined): Locale | null {
  const tag = (value ?? '').trim().toLowerCase().split('-')[0] ?? ''
  return (LOCALES as readonly string[]).includes(tag) ? (tag as Locale) : null
}

function readStored(): Locale | null {
  try {
    return asLocale(globalThis.localStorage?.getItem(STORAGE_KEY))
  } catch {
    // A WebView with storage disabled is not a reason to fail to start.
    return null
  }
}

function writeStored(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale)
  } catch {
    /* ignore */
  }
}

/** The locale in force right now. */
export function locale(): Locale {
  return current
}

/** The BCP-47 tag for `Intl`, e.g. `bn-BD`. */
export function localeTag(): string {
  return LOCALE_TAGS[current]
}

/**
 * Switches language.
 *
 * Persisted first, then announced: a listener that reloads part of the UI
 * must never read the old value back out of storage. A no-op when the locale
 * has not actually changed, so a Settings save does not redraw the shell for
 * nothing.
 */
export function setLocale(next: Locale | string | null | undefined, options: { silent?: boolean } = {}): boolean {
  const resolved = asLocale(typeof next === 'string' ? next : null) ?? (next as Locale | null)
  if (!resolved || !(LOCALES as readonly string[]).includes(resolved)) return false
  if (resolved === current) {
    applyToDocument()
    return false
  }
  current = resolved
  writeStored(resolved)
  applyToDocument()
  if (options.silent !== true) {
    for (const listener of [...listeners]) listener(current)
  }
  return true
}

/** Subscribe to language changes. Returns the unsubscribe. */
export function onLocaleChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Keeps `<html lang>` honest. Screen readers, `:lang()` rules and the
 * browser's own hyphenation all read it, and Bangla rendered with an `en`
 * lang attribute picks the wrong font on several Android builds.
 */
export function applyToDocument(): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = current
}

/**
 * Look up a string.
 *
 * Falls back to English, then to the key itself. A missing translation shows
 * a usable English word rather than a developer token — a shop should never
 * be shown `settings.taxRate`.
 */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const template = DICTIONARIES[current][key] ?? DICTIONARIES.en[key] ?? String(key)
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  )
}

/** Numbers in the active locale's digits. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(localeTag(), options).format(value)
  } catch {
    return String(value)
  }
}

/** Dates in the active locale, defaulting to a short readable form. */
export function formatDate(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(
      localeTag(),
      options ?? { dateStyle: 'medium', timeStyle: 'short' }
    ).format(date)
  } catch {
    return date.toISOString()
  }
}

/** Test hook: drops every listener and returns to English. */
export function resetI18nForTests(): void {
  listeners.clear()
  current = DEFAULT_LOCALE
}
