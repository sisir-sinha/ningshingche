/**
 * @vitest-environment jsdom
 */

/**
 * Telling a scanner from a person.
 *
 * The whole feature rests on one judgement — these keystrokes came from a
 * machine — so it is worth testing from both sides: a machine-speed burst must
 * be accepted, and a human-speed one must not, because a cashier typing a
 * customer's name into the wrong box is the bug this replaces.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { listenForScans, suggestGap, type ScanEvent } from './scanner'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
  vi.restoreAllMocks()
})

/** Types `text` with `gap` ms between keys, then the terminator. */
function type(text: string, gap: number, terminator: string | null = 'Enter'): void {
  let now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)

  for (const character of text) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: character, bubbles: true }))
    now += gap
  }
  if (terminator) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: terminator, bubbles: true, cancelable: true }))
  }
}

function listen(overrides: Partial<Parameters<typeof listenForScans>[0]> = {}): {
  scans: ScanEvent[]
  rejects: string[]
} {
  const scans: ScanEvent[] = []
  const rejects: string[] = []
  cleanups.push(
    listenForScans({
      onScan: (event) => scans.push(event),
      onReject: (reason) => rejects.push(reason),
      ...overrides,
    })
  )
  return { scans, rejects }
}

describe('the wedge listener', () => {
  it('accepts a machine-speed burst', () => {
    const { scans } = listen()
    type('8901234567890', 6)

    expect(scans).toHaveLength(1)
    expect(scans[0]?.code).toBe('8901234567890')
    expect(scans[0]?.averageGapMs).toBe(6)
  })

  it('ignores a human typing the same characters', () => {
    const { scans, rejects } = listen()
    type('8901234567890', 140)

    expect(scans).toHaveLength(0)
    expect(rejects[0]).toMatch(/Typed, not scanned/)
  })

  it('ignores something too short to be a barcode', () => {
    const { scans, rejects } = listen({ minLength: 6 })
    type('123', 5)

    expect(scans).toHaveLength(0)
    expect(rejects[0]).toMatch(/Too short/)
  })

  it('strips the prefix a scanner was programmed to send', () => {
    const { scans } = listen({ prefix: '*' })
    type('*4901234567894', 5)

    expect(scans[0]?.code).toBe('4901234567894')
  })

  it('swallows the scanner’s Enter so the form behind it does not submit', () => {
    listen()
    let submitted = false
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' && !event.defaultPrevented) submitted = true
    }
    document.addEventListener('keydown', onKey)
    cleanups.push(() => document.removeEventListener('keydown', onKey))

    type('8901234567890', 5)
    expect(submitted).toBe(false)
  })

  it('keeps two scans apart instead of gluing them into one code', () => {
    const { scans } = listen()
    type('1111111111111', 5)
    type('2222222222222', 5)

    expect(scans.map((scan) => scan.code)).toEqual(['1111111111111', '2222222222222'])
  })

  it('stops listening when told to', () => {
    const { scans } = listen()
    cleanups.pop()?.()
    type('8901234567890', 5)

    expect(scans).toHaveLength(0)
  })
})

describe('the suggested threshold', () => {
  it('leaves headroom above what was measured', () => {
    // 8 ms observed must not become an 8 ms threshold: the scanner will be
    // slower on a low battery next week.
    expect(suggestGap([6, 8, 7])).toBeGreaterThan(8)
    expect(suggestGap([6, 8, 7])).toBe(20)
  })

  it('never suggests something a human could beat', () => {
    expect(suggestGap([90, 110])).toBeLessThanOrEqual(120)
  })

  it('falls back to the default with nothing measured', () => {
    expect(suggestGap([])).toBe(50)
  })
})
