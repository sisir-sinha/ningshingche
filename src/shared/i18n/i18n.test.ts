// @vitest-environment jsdom
/**
 * Language tests.
 *
 * The Language select in Settings wrote a column and changed nothing on
 * screen, because there was no translation layer behind it. These tests hold
 * the new one to its three promises: a key resolves to the active language,
 * a missing Bangla string falls back to readable English rather than a token,
 * and switching announces itself so the shell can redraw.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  asLocale,
  clearMissingTranslations,
  formatList,
  formatNumber,
  formatRelativeTime,
  locale,
  missingTranslations,
  onLocaleChange,
  pluralKey,
  resetI18nForTests,
  setLocale,
  t,
  translateTree,
} from './index'
import { bn, en } from './strings'
import { formatMoney, minor, parseMinor, westernDigits, type Minor } from '../domain/money'

describe('t', () => {
  beforeEach(() => resetI18nForTests())

  it('answers in English by default', () => {
    expect(t('nav.stock')).toBe('Stock')
    expect(t('settings.title')).toBe('Settings')
  })

  it('answers in Bangla once switched', () => {
    setLocale('bn')
    expect(t('nav.stock')).toBe('স্টক')
    expect(t('settings.shopName')).toBe('দোকানের নাম')
    expect(t('shell.signOut')).toBe('সাইন আউট')
  })

  it('fills placeholders', () => {
    expect(t('settings.partialFailure', { message: 'permission denied' })).toBe(
      'Some settings could not be loaded: permission denied'
    )
    setLocale('bn')
    expect(t('settings.partialFailure', { message: 'x' })).toContain('x')
  })

  it('falls back to English rather than showing a key', () => {
    setLocale('bn')
    // A key with no Bangla entry must still read as words.
    const key = 'settings.currencyHint'
    const translated = t(key)
    expect(translated).not.toBe(key)
    expect(translated.length).toBeGreaterThan(0)
  })
})

describe('setLocale', () => {
  beforeEach(() => resetI18nForTests())

  it('announces a real change exactly once', () => {
    const seen: string[] = []
    onLocaleChange((next) => seen.push(next))
    expect(setLocale('bn')).toBe(true)
    expect(seen).toEqual(['bn'])
  })

  it('stays quiet when the language did not change', () => {
    const listener = vi.fn()
    onLocaleChange(listener)
    expect(setLocale('en')).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('ignores a language the app does not ship', () => {
    setLocale('fr')
    expect(locale()).toBe('en')
  })

  it('accepts a regional tag from the database', () => {
    expect(asLocale('bn-BD')).toBe('bn')
    expect(asLocale('EN')).toBe('en')
    expect(asLocale(null)).toBeNull()
    expect(asLocale('de')).toBeNull()
  })
})

describe('formatNumber', () => {
  beforeEach(() => resetI18nForTests())

  it('uses Bangla digits when the shop reads Bangla', () => {
    expect(formatNumber(1250)).toBe('1,250')
    setLocale('bn')
    // bn-BD groups lakh-style and uses Bengali numerals.
    expect(formatNumber(1250)).toMatch(/[০-৯]/)
  })
})

describe('the catalogue itself', () => {
  it('has no empty Bangla strings', () => {
    for (const [key, value] of Object.entries(bn)) {
      expect(value, key).toBeTruthy()
    }
  })

  it('translates no key that English does not define', () => {
    const englishKeys = new Set(Object.keys(en))
    for (const key of Object.keys(bn)) expect(englishKeys.has(key), key).toBe(true)
  })

  it('covers every navigation and settings label in Bangla', () => {
    const mustTranslate = Object.keys(en).filter(
      (key) => key.startsWith('nav.') || key.startsWith('settings.') || key.startsWith('shell.')
    )
    const missing = mustTranslate.filter((key) => !(key in bn))
    expect(missing).toEqual([])
  })
})


describe('plurals', () => {
  beforeEach(() => resetI18nForTests())

  it('picks the English form by CLDR category, not by count === 1', () => {
    expect(t('common.itemCount', { count: 1 })).toBe('1 item')
    expect(t('common.itemCount', { count: 3 })).toBe('3 items')
    expect(t('common.itemCount', { count: 0 })).toBe('0 items')
  })

  it('reads the count in the active locale\'s digits', () => {
    setLocale('bn')
    const text = t('common.itemCount', { count: 3 })
    expect(text).toMatch(/[০-৯]/)
    expect(text).not.toMatch(/[0-9]/)
  })

  it('falls back to .other when the exact category is not written', () => {
    // English has no `.many`; a count that would select it still resolves.
    expect(pluralKey('common.dayCount', 7)).toBe('common.dayCount.other')
    expect(t('common.dayCount', { count: 7 })).toBe('7 days')
  })
})

describe('missing translations', () => {
  beforeEach(() => {
    resetI18nForTests()
    clearMissingTranslations()
  })

  it('records the keys that had to fall back to English', () => {
    // The Bangla catalogue is complete today, so the gap has to be staged:
    // this is the mechanism that will catch the next key someone adds in
    // English only.
    const catalogue = bn as Record<string, string | undefined>
    const saved = catalogue['nav.stock']
    delete catalogue['nav.stock']
    try {
      setLocale('bn')
      expect(t('nav.stock')).toBe('Stock')
      expect(missingTranslations('bn')).toContain('nav.stock')
    } finally {
      catalogue['nav.stock'] = saved
    }
  })

  it('records nothing for a key the active language does translate', () => {
    setLocale('bn')
    t('nav.stock')
    expect(missingTranslations('bn')).not.toContain('nav.stock')
  })
})

describe('formatRelativeTime', () => {
  beforeEach(() => resetI18nForTests())
  const now = new Date('2026-09-27T12:00:00Z')

  it('says how long ago in words', () => {
    expect(formatRelativeTime(new Date('2026-09-27T10:00:00Z'), now)).toBe('2 hours ago')
    expect(formatRelativeTime(new Date('2026-09-27T12:00:10Z'), now)).toMatch(/now|second/)
  })

  it('gives up on a relative phrase past a month', () => {
    const long = formatRelativeTime(new Date('2026-01-05T12:00:00Z'), now)
    expect(long).not.toMatch(/ago/)
    expect(long).toMatch(/2026/)
  })

  it('returns empty for a date it cannot read', () => {
    expect(formatRelativeTime('not a date', now)).toBe('')
  })
})

describe('formatList', () => {
  beforeEach(() => resetI18nForTests())

  it('joins the way the language joins', () => {
    expect(formatList(['Rice', 'Dal', 'Oil'])).toBe('Rice, Dal, and Oil')
    expect(formatList([])).toBe('')
    expect(formatList(['Rice', ''])).toBe('Rice')
  })
})

describe('translateTree', () => {
  beforeEach(() => resetI18nForTests())

  it('fills text, attributes and counted text from markup', () => {
    document.body.innerHTML = `
      <h1 data-i18n="nav.stock"></h1>
      <input data-i18n-attr="placeholder:shell.search,aria-label:shell.search">
      <span data-i18n="common.itemCount" data-i18n-count="2"></span>
    `
    translateTree(document.body)
    expect(document.querySelector('h1')?.textContent).toBe('Stock')
    expect(document.querySelector('input')?.getAttribute('placeholder')).toBe(t('shell.search'))
    expect(document.querySelector('input')?.getAttribute('aria-label')).toBe(t('shell.search'))
    expect(document.querySelector('span')?.textContent).toBe('2 items')
  })

  it('rewrites rather than appends when the language changes', () => {
    document.body.innerHTML = '<h1 data-i18n="nav.stock"></h1>'
    translateTree(document.body)
    setLocale('bn')
    translateTree(document.body)
    expect(document.querySelector('h1')?.textContent).toBe('স্টক')
  })
})

describe('money follows the language', () => {
  beforeEach(() => resetI18nForTests())

  it('keeps Western digits in English', () => {
    expect(formatMoney(minor(125000) as Minor, { symbol: false })).toBe('1,250.00')
  })

  it('switches to Bengali numerals with the locale', () => {
    setLocale('bn')
    const shown = formatMoney(minor(125000) as Minor, { symbol: false })
    expect(shown).toBe('১,২৫০.০০')
    // Lakh grouping survives the digit swap.
    expect(formatMoney(minor(12500000) as Minor, { symbol: false })).toBe('১,২৫,০০০.০০')
  })

  it('still writes Western digits when the caller needs a machine-readable amount', () => {
    setLocale('bn')
    expect(formatMoney(minor(125000) as Minor, { symbol: false, digits: 'latin' })).toBe('1,250.00')
  })

  it('reads a price typed on a Bangla keyboard', () => {
    expect(westernDigits('১২৫০.৫০')).toBe('1250.50')
    expect(parseMinor('৳ ১,২৫০.৫০')).toBe(125050)
  })
})

describe('applyToDocument', () => {
  beforeEach(() => resetI18nForTests())

  it('writes lang and a direction the shell can rely on', () => {
    setLocale('bn')
    expect(document.documentElement.lang).toBe('bn')
    expect(document.documentElement.dir).toBe('ltr')
  })
})

describe('the plural catalogue', () => {
  it('has a Bangla entry for every English key', () => {
    const untranslated = Object.keys(en).filter((key) => !(key in bn))
    expect(untranslated).toEqual([])
  })


  it('translates every plural family into Bangla', () => {
    const families = Object.keys(en).filter((key) => /\.(one|other)$/.test(key))
    expect(families.length).toBeGreaterThan(0)
    expect(families.filter((key) => !(key in bn))).toEqual([])
  })
})
