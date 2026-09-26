/**
 * One page, one scrollbar.
 *
 * A screen used to be a viewport-height box with its own inner scroller: the
 * page header stayed frozen, the list scrolled inside a sub-region, and the
 * shared table froze its `thead` on top of that. Three scroll contexts on one
 * screen — the wheel did something different depending on where the pointer
 * was, and on a phone the list got a fraction of the height it could have had.
 *
 * The rule is now: a page flows into the app's scrolling outlet, and the only
 * thing pinned anywhere is the app's own top bar. This test reads the source
 * rather than the DOM, because the thing to prevent is a class being *typed*
 * again — jsdom has no layout engine and would happily report a sticky element
 * as fine.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sources(path)
    if (!path.endsWith('.ts') || path.endsWith('.test.ts')) return []
    return [path]
  })
}

/** The one element allowed to stay put, and the file that owns it. */
const TOPBAR = join('src', 'features', 'layout', 'app-shell.ts')

describe('page scrolling', () => {
  it('pins nothing but the app’s top bar', () => {
    const offenders = sources('src')
      .filter((path) => path !== TOPBAR)
      .filter((path) => {
        const text = readFileSync(path, 'utf8')
        // Only class strings count: prose in a comment explaining why
        // something is *not* sticky must stay allowed.
        return /class:\s*(?:\[[^\]]*)?['"`][^'"`]*\bsticky\b/.test(text)
      })

    expect(offenders).toEqual([])
  })

  it('gives a page no scroll container of its own', () => {
    // `h-full` + `overflow-y-auto` on a page root is the shape of the old
    // pattern: a box the size of the viewport with a scroller inside it.
    const offenders = sources(join('src', 'features'))
      .filter((path) => !path.includes('layout'))
      .filter((path) => !/(dialog|palette|modal|receipt|login-view)/.test(path))
      .flatMap((path) => {
        const text = readFileSync(path, 'utf8')
        return [...text.matchAll(/class:\s*'([^']*)'/g)]
          .map((match) => match[1] ?? '')
          .filter((cls) => cls.includes('overflow-y-auto') && /\b(flex-1|h-full)\b/.test(cls))
          .map((cls) => `${path}: ${cls}`)
      })
      // The till is two fixed panes by design — a cart that scrolled away
      // while the cashier browsed the catalogue would be worse, and it is a
      // counter surface rather than a page you read.
      .filter((entry) => !entry.includes(join('features', 'pos')))

    expect(offenders).toEqual([])
  })
})
