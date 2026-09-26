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
import { asLocale, formatNumber, locale, onLocaleChange, resetI18nForTests, setLocale, t } from './index'
import { bn, en } from './strings'

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
