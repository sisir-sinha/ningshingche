/**
 * Appearance tests.
 *
 * The dark palette was in `tokens.css` and `darkMode: 'class'` was in the
 * Tailwind config, but nothing ever wrote the class — the theme existed and
 * was unreachable. These hold the switch to its promises: a choice sticks to
 * the device, "system" keeps following the OS instead of freezing, and the
 * document gets both the class Tailwind reads and the `color-scheme` the
 * browser reads for native controls.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  applyTheme,
  initTheme,
  onThemeChange,
  resetThemeForTests,
  resolvedTheme,
  setTheme,
  theme,
  toggleTheme,
} from './index'

/** Stand in for the OS setting. */
function mockPrefersDark(dark: boolean): { fire: (next: boolean) => void } {
  let matches = dark
  const handlers: ((event: MediaQueryListEvent) => void)[] = []
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return matches
    },
    addEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) => handlers.push(handler),
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
  return {
    fire: (next: boolean) => {
      matches = next
      for (const handler of handlers) handler({ matches: next } as MediaQueryListEvent)
    },
  }
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    resetThemeForTests()
    vi.unstubAllGlobals()
    document.documentElement.dataset.theme = ''
  })

  it('follows the device when nothing has been chosen', () => {
    mockPrefersDark(true)
    expect(theme()).toBe('system')
    expect(resolvedTheme()).toBe('dark')
    applyTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('writes the class Tailwind reads and the color-scheme the browser reads', () => {
    setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('remembers an explicit choice, and only an explicit one', () => {
    setTheme('dark')
    expect(localStorage.getItem('mekholi.theme')).toBe('dark')
    // "System" is the absence of a preference: storing it would freeze the
    // app at today's OS setting forever.
    setTheme('system')
    expect(localStorage.getItem('mekholi.theme')).toBeNull()
  })

  it('toggles between exactly two states from whatever is on screen', () => {
    mockPrefersDark(false)
    expect(toggleTheme()).toBe('dark')
    expect(theme()).toBe('dark')
    expect(toggleTheme()).toBe('light')
  })

  it('announces a change to everyone listening', () => {
    const seen: string[] = []
    onThemeChange((next, resolved) => seen.push(`${next}:${resolved}`))
    setTheme('dark')
    expect(seen).toEqual(['dark:dark'])
  })

  it('keeps following the OS while the preference is "system"', () => {
    const os = mockPrefersDark(false)
    initTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    os.fire(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('stops following the OS once the user has picked', () => {
    const os = mockPrefersDark(false)
    initTheme()
    setTheme('light')
    os.fire(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('refuses a theme it does not ship', () => {
    setTheme('neon' as never)
    expect(theme()).toBe('system')
  })

  it('survives a runtime with no matchMedia at all', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(() => initTheme()).not.toThrow()
    expect(resolvedTheme()).toBe('light')
  })
})
