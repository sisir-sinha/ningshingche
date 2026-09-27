/**
 * Scanner setup.
 *
 * The page's whole value is the diagnosis, so that is what is tested: a real
 * scan reports as accepted, a human typing the same digits reports as typing —
 * with the measured number in the message, because "it did not work" is what
 * the shop already knew — and the suggested threshold can be adopted with one
 * tap and survives a reload.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scannerSetupView } from './scanner-setup-view'
import { loadDeviceSettings } from '../../shared/devices/device-config'

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function mount(): HTMLElement {
  const view = scannerSetupView()
  document.body.appendChild(view)
  return view
}

/** Types `text` with `gap` ms between keys, then Enter. */
function type(text: string, gap: number): void {
  let now = 5000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  for (const character of text) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: character, bubbles: true }))
    now += gap
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

function textOf(el: HTMLElement): string {
  return el.textContent ?? ''
}

function attempts(view: HTMLElement): string[] {
  return [...view.querySelectorAll('[data-attempt]')].map((row) => row.getAttribute('attempt') ?? row.getAttribute('data-attempt') ?? '')
}

beforeEach(() => {
  localStorage.clear()
  document.body.replaceChildren()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the test box', () => {
  it('waits for a scan before claiming anything', () => {
    const view = mount()
    expect(textOf(view)).toContain('Waiting for a scan')
  })

  it('accepts a scanner-speed read and shows what it measured', async () => {
    const view = mount()
    type('8901234567890', 6)
    await settle()

    expect(attempts(view)).toEqual(['ok'])
    expect(textOf(view)).toContain('8901234567890')
    expect(textOf(view)).toContain('6 ms between keys')
  })

  it('tells a cashier that what they did was typing, with the number', async () => {
    const view = mount()
    type('8901234567890', 150)
    await settle()

    expect(attempts(view)).toEqual(['rejected'])
    expect(textOf(view)).toContain('150 ms between keys')
    expect(textOf(view)).toContain('treats anything over 50 ms as typing')
  })

  it('keeps only the last few attempts — it is a diagnosis, not a log', async () => {
    const view = mount()
    for (let i = 0; i < 7; i += 1) {
      type(`890123456789${i}`, 6)
      await settle()
    }
    expect(attempts(view)).toHaveLength(5)
  })
})

describe('tuning it to this shop’s hardware', () => {
  it('offers a threshold that fits the scanner, with headroom', async () => {
    const view = mount()
    type('8901234567890', 8)
    await settle()

    const adopt = [...view.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Use '))
    expect(adopt).toBeDefined()
    // 8 ms measured must not become an 8 ms threshold.
    expect(adopt?.textContent).toContain('20 ms')

    adopt?.click()
    await settle()

    expect(loadDeviceSettings().scanner.maxKeyGapMs).toBe(20)
  })

  it('saves a hand-typed setting for the next visit', async () => {
    const view = mount()
    const minLength = [...view.querySelectorAll('input')].find(
      (box) => box.value === '4'
    )
    expect(minLength).toBeDefined()
    if (minLength) {
      minLength.value = '8'
      minLength.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await settle()

    expect(loadDeviceSettings().scanner.minLength).toBe(8)
  })

  it('refuses a nonsense threshold rather than breaking every scan', async () => {
    const view = mount()
    const gap = [...view.querySelectorAll('input')].find((box) => box.value === '50')
    if (gap) {
      gap.value = '-99'
      gap.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await settle()

    expect(loadDeviceSettings().scanner.maxKeyGapMs).toBe(5)
  })
})

describe('the help', () => {
  it('names the layout trap, which is the most common cause of gibberish', () => {
    const view = mount()
    expect(textOf(view)).toContain('keyboard layout')
  })
})
