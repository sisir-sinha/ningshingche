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

import { setMoneyLocaleProvider } from '../domain/money'
import { DICTIONARIES, LOCALES, LOCALE_TAGS, type Locale, type PluralKey, type StringKey } from './strings'

export { LOCALES, LOCALE_NAMES, LOCALE_TAGS, type Locale, type PluralKey, type StringKey } from './strings'

const STORAGE_KEY = 'mekholi.locale'
const DEFAULT_LOCALE: Locale = 'en'

type Listener = (locale: Locale) => void

const listeners = new Set<Listener>()
let current: Locale = readStored() ?? DEFAULT_LOCALE

/**
 * Money is formatted in `shared/domain`, which must stay pure and therefore
 * cannot read this module. Hand it a live provider once, here, instead of
 * threading a locale through 109 call sites: `formatMoney` now answers in
 * ৳১,২৫০.০০ the moment the shop switches to Bangla.
 */
setMoneyLocaleProvider(() => LOCALE_TAGS[current])

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

/** Has this device made an explicit language choice? */
export function hasStoredLocale(): boolean {
  return readStored() !== null
}

/**
 * Apply the shop's saved language — but never over a choice made here.
 *
 * Settings reloads the shop profile on every render, and it used to call
 * `setLocale(settings.locale)` unconditionally. Picking বাংলা therefore
 * switched the language, which redrew the shell, which re-ran the load,
 * which set the language straight back to whatever the database still said.
 * The select flicked back to the old value and the language looked
 * un-switchable. The shop default now only fills a device that has not
 * chosen for itself.
 */
export function applyShopLocale(value: string | null | undefined): boolean {
  if (hasStoredLocale()) return false
  return setLocale(value)
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
  // Neither shipped language is right-to-left, but the attribute has to be
  // written rather than assumed: the day an Urdu or Arabic catalogue lands,
  // the shell must not need editing for the layout to mirror.
  document.documentElement.dir = RTL_LOCALES.has(current) ? 'rtl' : 'ltr'
}

const RTL_LOCALES = new Set<string>(['ar', 'ur', 'fa', 'he'])

/**
 * Look up a string.
 *
 * Falls back to English, then to the key itself. A missing translation shows
 * a usable English word rather than a developer token — a shop should never
 * be shown `settings.taxRate`.
 *
 * Pass a `count` and the key is treated as a plural *family*: `t('pos.items',
 * { count: 3 })` looks for `pos.items.other`, `t(..., { count: 1 })` for
 * `pos.items.one`. The category comes from `Intl.PluralRules`, not from
 * `count === 1`, because "one" is not a universal rule and hard-coding it is
 * how English leaks into every other language. `{count}` is substituted in
 * the locale's own digits.
 */
export function t(key: StringKey | PluralKey, vars?: TranslateVars): string {
  const resolvedKey = vars && typeof vars.count === 'number' ? pluralKey(key, vars.count) : key
  const template = lookup(resolvedKey) ?? lookup(key) ?? String(key)
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return match
    const value = vars[name]
    return typeof value === 'number' ? formatNumber(value) : String(value)
  })
}

export type TranslateVars = Record<string, string | number> & { count?: number }

/**
 * Active dictionary, then English, then nothing — and a note in the ledger of
 * keys nobody has translated, so `missingTranslations()` can report them
 * instead of the gap being discovered by a shopkeeper.
 */
function lookup(key: string): string | undefined {
  const active = DICTIONARIES[current][key as StringKey]
  if (active !== undefined) return active
  const english = DICTIONARIES.en[key as StringKey]
  if (english !== undefined) {
    if (current !== 'en') noteMissing(current, key)
    return english
  }
  return undefined
}

const missing = new Map<Locale, Set<string>>()

function noteMissing(loc: Locale, key: string): void {
  let seen = missing.get(loc)
  if (!seen) {
    seen = new Set()
    missing.set(loc, seen)
  }
  if (seen.has(key)) return
  seen.add(key)
  if (isDev()) console.warn(`[i18n] no ${loc} translation for "${key}" — showing English`)
}

function isDev(): boolean {
  try {
    return import.meta.env?.DEV === true
  } catch {
    return false
  }
}

/**
 * Every key that had to fall back to English this session, per locale.
 *
 * Used by the language test and worth a look in the console before a
 * release: a screen the translator never saw shows up here the first time
 * anyone opens it.
 */
export function missingTranslations(loc: Locale = current): string[] {
  return [...(missing.get(loc) ?? [])].sort()
}

/** Test hook. */
export function clearMissingTranslations(): void {
  missing.clear()
}

/**
 * `key` + the CLDR plural category for `count`, e.g. `cart.items.one`.
 *
 * Falls back to the `.other` member when the exact category is not in the
 * catalogue: most languages need two forms, and writing `few`/`many` for
 * every key when only Bangla and English ship would be noise.
 */
export function pluralKey(key: StringKey | PluralKey, count: number): StringKey {
  const category = pluralCategory(count)
  const exact = `${key}.${category}` as StringKey
  if (DICTIONARIES[current][exact] !== undefined || DICTIONARIES.en[exact] !== undefined) return exact
  return `${key}.other` as StringKey
}

const pluralRules = new Map<Locale, Intl.PluralRules | null>()

function pluralCategory(count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(current)
  if (rules === undefined) {
    try {
      rules = new Intl.PluralRules(localeTag())
    } catch {
      rules = null
    }
    pluralRules.set(current, rules)
  }
  if (!rules) return count === 1 ? 'one' : 'other'
  return rules.select(count)
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

/** Money-shaped number: two decimals, locale digits, no currency symbol. */
export function formatDecimal(value: number, fractionDigits = 2): string {
  return formatNumber(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

/**
 * "2 hours ago", "in 3 days" — in the active language.
 *
 * Audit rows and sync banners were printing raw timestamps; a relative
 * phrase is what a person actually reads. The unit is chosen by size, and
 * anything older than a month falls back to a real date, because "47 days
 * ago" is worse than "12 Aug 2026".
 */
export function formatRelativeTime(value: Date | string | number, now: Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = (date.getTime() - now.getTime()) / 1000
  const abs = Math.abs(seconds)
  if (abs > 30 * 86400) return formatDate(date, { dateStyle: 'medium' })
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    abs < 45 ? ['second', 1]
    : abs < 45 * 60 ? ['minute', 60]
    : abs < 22 * 3600 ? ['hour', 3600]
    : ['day', 86400]
  try {
    return new Intl.RelativeTimeFormat(localeTag(), { numeric: 'auto' }).format(
      Math.round(seconds / size),
      unit
    )
  } catch {
    return formatDate(date, { dateStyle: 'medium' })
  }
}

/** "Rice, Dal and Oil" — joined the way the active language joins lists. */
export function formatList(items: readonly string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
  const clean = items.filter((item) => item.trim() !== '')
  if (clean.length === 0) return ''
  try {
    return new Intl.ListFormat(localeTag(), { style: 'long', type }).format(clean)
  } catch {
    return clean.join(', ')
  }
}

/**
 * Translate static markup in place.
 *
 * Views built with `h()` call `t()` directly, but the two HTML entry points
 * (`index.html`, `app.html`) and any server-rendered fragment cannot. They
 * mark up the text instead:
 *
 *     <h1 data-i18n="shell.title"></h1>
 *     <input data-i18n-attr="placeholder:shell.search">
 *     <span data-i18n="cart.items" data-i18n-count="3"></span>
 *
 * and this walks the tree once per language change. Re-running it is safe —
 * it always writes, never appends.
 */
export function translateTree(root: ParentNode | null | undefined = globalThis.document?.body): void {
  if (!root) return
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n as StringKey | undefined
    if (!key) continue
    const raw = node.dataset.i18nCount
    const count = raw === undefined ? undefined : Number(raw)
    node.textContent =
      count === undefined || Number.isNaN(count) ? t(key) : t(key as PluralKey, { count })
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const pair of (node.dataset.i18nAttr ?? '').split(',')) {
      const [attr, key] = pair.split(':').map((part) => part.trim())
      if (!attr || !key) continue
      node.setAttribute(attr, t(key as StringKey))
    }
  }
}

/** Test hook: drops every listener and returns to English. */
export function resetI18nForTests(): void {
  listeners.clear()
  current = DEFAULT_LOCALE
  try {
    // The stored choice has to go too, or `applyShopLocale` in the next test
    // sees a device that has already made up its mind.
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  missing.clear()
  pluralRules.clear()
}
