/**
 * "Set up the printer first" — with the way there attached.
 *
 * A till that says *no* must also say *where*. The old network-printer message
 * explained the web platform's socket restriction to a shopkeeper who had
 * simply not filled in a field yet: true, unhelpful, and a dead end, because
 * nothing on screen led to the page that fixes it.
 *
 * So a device that is not set up gets one toast shape everywhere: the
 * instruction as the headline, the specific cause underneath it, and a button
 * that opens the setup page. The instruction leads because it is the part
 * that is true for everyone; the cause follows for whoever is diagnosing.
 */

import { toastError } from '../../components/feedback/toast'
import { canNavigate, goTo } from '../../app/router/navigation'
import { PrinterError } from '../../shared/devices/printer-transport'

export type DeviceKind = 'printer' | 'scanner'

// The setup screens are plugin screens now, so they live under `/plugins/`.
// A shop with the plugin switched off lands on the host's own "this plugin is
// switched off" page, which is a better answer than a dead link — and a
// truer one than pretending the screen exists.
const PAGE: Record<DeviceKind, string> = {
  printer: '/plugins/printer-setup',
  scanner: '/plugins/barcode-scanner',
}

const LINK_LABEL: Record<DeviceKind, string> = {
  printer: 'Printer setup',
  scanner: 'Scanner setup',
}

const INSTRUCTION: Record<DeviceKind, string> = {
  printer: 'Set up the printer first.',
  scanner: 'Set up the scanner first.',
}

/**
 * Tell the cashier the device is not ready, and offer the page that fixes it.
 *
 * `detail` is the specific cause and sits under the headline. When no router
 * is registered — the Android wrapper, a test — the page is named in the text
 * instead of being hidden behind a button that would do nothing.
 */
export function promptDeviceSetup(kind: DeviceKind, detail?: string): void {
  const linked = canNavigate()
  const parts = [detail, linked ? null : `Open Settings → ${LINK_LABEL[kind]}.`].filter(Boolean)

  toastError(parts.join(' '), {
    title: INSTRUCTION[kind],
    // `exactOptionalPropertyTypes`: the key is absent when there is nowhere
    // to go, rather than present and undefined.
    ...(linked ? { action: { label: LINK_LABEL[kind], onClick: (): void => void goTo(PAGE[kind]) } } : {}),
  })
}

/**
 * Report a print failure the right way round.
 *
 * Setup failures get the linked prompt; everything else — no paper, printer
 * switched off, bridge unreachable — is a plain error, because a settings page
 * is not the answer to an empty paper roll.
 */
export function reportPrintFailure(error: unknown, fallback = 'The printer did not answer.'): void {
  if (error instanceof PrinterError && error.setupRequired) {
    promptDeviceSetup('printer', error.message)
    return
  }
  toastError(error instanceof Error ? error.message : fallback)
}

/** True when there is no usable printer configured at all. */
export function requirePrinterSetup(printer: unknown): printer is null {
  if (printer) return false
  promptDeviceSetup('printer', 'No printer has been added yet.')
  return true
}
