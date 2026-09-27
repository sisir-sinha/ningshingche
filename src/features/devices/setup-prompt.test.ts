/**
 * "Set up the printer first" has to lead somewhere.
 *
 * The bug this pins: a network printer with no bridge address answered with a
 * sentence about browsers being unable to open sockets. It was accurate and it
 * was useless — the shopkeeper had not finished the form, and nothing on the
 * screen led back to it. A refusal the user cannot act on is a dead end.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promptDeviceSetup, reportPrintFailure, requirePrinterSetup } from './setup-prompt'
import { setNavigator } from '../../app/router/navigation'
import { PrinterError, printerSetupRequired } from '../../shared/devices/printer-transport'

const toastText = (): string => document.body.textContent ?? ''

const actionButton = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => (button.textContent ?? '').trim() === label
  )

beforeEach(() => {
  document.body.replaceChildren()
  setNavigator(null)
})

afterEach(() => {
  document.body.replaceChildren()
  setNavigator(null)
})

describe('the prompt that sends a shopkeeper to the setup page', () => {
  it('leads with the instruction and carries the cause underneath', () => {
    setNavigator(() => undefined)
    promptDeviceSetup('printer', 'This printer has no bridge address yet.')

    expect(toastText()).toContain('Set up the printer first.')
    expect(toastText()).toContain('This printer has no bridge address yet.')
  })

  it('opens the printer setup page when the button is pressed', () => {
    const navigate = vi.fn()
    setNavigator(navigate)
    promptDeviceSetup('printer', 'Nothing paired.')

    const button = actionButton('Printer setup')
    expect(button).toBeDefined()
    button!.click()
    expect(navigate).toHaveBeenCalledWith('/printer-setup')
  })

  it('sends a scanner fault to the scanner page instead', () => {
    const navigate = vi.fn()
    setNavigator(navigate)
    promptDeviceSetup('scanner', 'Serial mode is unsupported here.')

    actionButton('Scanner setup')!.click()
    expect(navigate).toHaveBeenCalledWith('/scanner-setup')
  })

  it('names the page in words when there is no router to ask', () => {
    // The Android wrapper and any embedded surface: a button that did nothing
    // would be worse than a sentence that tells them where to look.
    promptDeviceSetup('printer', 'No printer has been added yet.')

    expect(actionButton('Printer setup')).toBeUndefined()
    expect(toastText()).toContain('Open Settings → Printer setup.')
  })
})

describe('telling a setup failure from a printer failure', () => {
  it('offers the setup page when the printer was never finished', () => {
    setNavigator(() => undefined)
    reportPrintFailure(printerSetupRequired('This printer has not been paired yet.'))

    expect(toastText()).toContain('Set up the printer first.')
    expect(actionButton('Printer setup')).toBeDefined()
  })

  it('does not offer it for an empty paper roll', () => {
    // A settings page is not the answer to a printer that is switched off, and
    // sending the cashier there mid-queue would waste their time.
    setNavigator(() => undefined)
    reportPrintFailure(new PrinterError('The print bridge answered 502.'))

    expect(toastText()).toContain('The print bridge answered 502.')
    expect(toastText()).not.toContain('Set up the printer first.')
    expect(actionButton('Printer setup')).toBeUndefined()
  })

  it('falls back to plain words for something that is not an Error at all', () => {
    reportPrintFailure({ weird: true }, 'The printer did not answer.')
    expect(toastText()).toContain('The printer did not answer.')
  })
})

describe('no printer configured at all', () => {
  it('prompts, and reports that it prompted', () => {
    setNavigator(() => undefined)
    expect(requirePrinterSetup(null)).toBe(true)
    expect(toastText()).toContain('No printer has been added yet.')
  })

  it('stays out of the way when there is one', () => {
    expect(requirePrinterSetup({ id: 'prn-1' })).toBe(false)
    expect(toastText()).toBe('')
  })
})
