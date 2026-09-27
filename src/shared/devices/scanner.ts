/**
 * Reading a barcode scanner that pretends to be a keyboard.
 *
 * Almost every scanner a shop in this market will buy is a *keyboard wedge*:
 * it types the barcode into whatever has focus and presses Enter. That is why
 * scanning "just works" in the POS search box — and why it silently fails
 * everywhere else, because if the cashier's focus is in the quantity field the
 * barcode goes in there instead.
 *
 * This listener fixes that by watching the whole document and telling a scan
 * apart from typing by *speed*. A human's fastest burst is about 80–120 ms
 * between characters; a scanner is 2–15 ms and perfectly even. Below the
 * threshold the keys came from a machine, and the machine's input belongs to
 * the till rather than to whichever box has the caret.
 *
 * The alternative — hunting for a prefix character the scanner was programmed
 * to send — is what most POS systems do, and it means every replacement
 * scanner has to be reprogrammed from a manual nobody kept.
 */

import { DEFAULT_SCANNER, type ScannerConfig } from './device-config'

export interface ScanEvent {
  /** The barcode, prefix and terminator stripped. */
  code: string
  /** Milliseconds from first key to last — under ~100 ms for a real scanner. */
  durationMs: number
  /** Average gap between keystrokes; what the setup page displays. */
  averageGapMs: number
  keys: number
}

export interface ScannerOptions extends Partial<ScannerConfig> {
  onScan: (event: ScanEvent) => void
  /** Every burst, including the ones rejected — the setup page shows these. */
  onReject?: (reason: string, event: ScanEvent) => void
  target?: Document | HTMLElement
}

/**
 * Starts listening. Returns the stop function.
 *
 * Nothing is captured or prevented until a burst has *proved* itself, so a
 * cashier typing a customer's name is never interfered with: the keys reach
 * the focused field as normal, and only when the whole burst turns out to be
 * machine-fast is `onScan` called.
 */
export function listenForScans(options: ScannerOptions): () => void {
  const config: ScannerConfig = { ...DEFAULT_SCANNER, ...options }
  const target = options.target ?? (typeof document === 'undefined' ? null : document)
  if (!target) return () => undefined

  let buffer = ''
  let firstAt = 0
  let lastAt = 0
  let gaps: number[] = []

  function reset(): void {
    buffer = ''
    firstAt = 0
    lastAt = 0
    gaps = []
  }

  function finish(): void {
    if (buffer === '') return

    const durationMs = lastAt - firstAt
    const averageGapMs = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
    const raw = buffer
    reset()

    const stripped = config.prefix && raw.startsWith(config.prefix) ? raw.slice(config.prefix.length) : raw
    const event: ScanEvent = { code: stripped, durationMs, averageGapMs, keys: raw.length }

    if (stripped.length < config.minLength) {
      options.onReject?.(`Too short — ${stripped.length} characters, minimum is ${config.minLength}.`, event)
      return
    }
    if (averageGapMs > config.maxKeyGapMs) {
      options.onReject?.(
        `Typed, not scanned — ${Math.round(averageGapMs)} ms between keys, the limit is ${config.maxKeyGapMs} ms.`,
        event
      )
      return
    }

    options.onScan(event)
  }

  function onKeyDown(event: Event): void {
    const key = event as KeyboardEvent
    const now = performance.now()

    // A gap longer than the threshold ends whatever came before: two scans in
    // a row must not be glued into one barcode.
    if (buffer !== '' && now - lastAt > config.maxKeyGapMs * 4) {
      finish()
    }

    const terminator =
      (config.suffix === 'enter' && key.key === 'Enter') || (config.suffix === 'tab' && key.key === 'Tab')

    if (terminator) {
      if (buffer !== '') {
        // The Enter belongs to the scanner, not to the form behind it.
        key.preventDefault()
        finish()
      }
      return
    }

    // Printable single characters only. Modifier chords are a person.
    if (key.key.length !== 1 || key.ctrlKey || key.metaKey || key.altKey) {
      if (buffer !== '') finish()
      return
    }

    if (buffer === '') {
      firstAt = now
    } else {
      gaps.push(now - lastAt)
    }
    lastAt = now
    buffer += key.key

    // No terminator configured: settle on the gap alone.
    if (config.suffix === 'none') {
      window.setTimeout(() => {
        if (buffer !== '' && performance.now() - lastAt >= config.maxKeyGapMs * 4) finish()
      }, config.maxKeyGapMs * 5)
    }
  }

  target.addEventListener('keydown', onKeyDown, true)
  return () => target.removeEventListener('keydown', onKeyDown, true)
}

/**
 * A short beep, generated rather than fetched.
 *
 * A scanner's own beeper says "I read something"; this says "the till took
 * it", which is the part the cashier actually needs at a noisy counter. No
 * audio file, so there is nothing to 404 offline.
 */
export function beep(ok = true): void {
  type AudioCtor = new () => AudioContext
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : ((window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }).AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext)
  if (!Ctor) return

  try {
    const context = new Ctor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'square'
    oscillator.frequency.value = ok ? 1760 : 220
    gain.gain.value = 0.04
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + (ok ? 0.06 : 0.22))
    oscillator.onended = () => void context.close()
  } catch {
    // Audio is a nicety; a till that cannot beep still sells.
  }
}

/**
 * What the measured burst suggests the threshold should be.
 *
 * Rounded up to the next 5 ms with headroom, because a scanner's gaps vary a
 * little with battery and USB polling, and a threshold sitting exactly on the
 * observed average starts dropping scans a week later.
 */
export function suggestGap(samples: readonly number[]): number {
  if (samples.length === 0) return DEFAULT_SCANNER.maxKeyGapMs
  const worst = Math.max(...samples)
  return Math.min(120, Math.max(15, Math.ceil((worst * 2.5) / 5) * 5))
}
