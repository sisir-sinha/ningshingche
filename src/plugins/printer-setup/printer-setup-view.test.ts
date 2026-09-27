/**
 * Printer setup.
 *
 * The behaviour worth pinning is not the layout but the honesty: on a device
 * that cannot do Bluetooth — an iPad, which is half the tablets in these shops
 * — the button must be disabled *and* say why, rather than opening a chooser
 * that never appears. The rest is the round trip: pair, configure, and have
 * the choice survive a reload.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as DeviceConfig from '../../shared/devices/device-config'

const pairBluetoothPrinter = vi.fn(async () => ({
  deviceId: 'bt-1',
  deviceName: 'Xprinter XP-58',
  serviceUuid: '000018f0-0000-1000-8000-00805f9b34fb',
  characteristicUuid: '00002af1-0000-1000-8000-00805f9b34fb',
}))
const sendToPrinter = vi.fn(async (_config: unknown, _bytes: Uint8Array) => undefined)

vi.mock('../../shared/devices/printer-transport', () => ({
  pairBluetoothPrinter,
  pairUsbPrinter: vi.fn(async () => ({ vendorId: 0x04b8, productId: 0x0202, serial: null, productName: 'TM-T20' })),
  sendToPrinter,
  PrinterError: Error,
}))

vi.mock('../../app/state/session', () => ({
  activeOrganization: () => ({ organization_id: 'org-1', name: 'Rahim Store', currency: 'BDT' }),
  can: () => true,
}))

let hasBluetooth = true
vi.mock('../../shared/devices/device-config', async (importOriginal) => {
  const actual = await importOriginal<typeof DeviceConfig>()
  return {
    ...actual,
    capabilities: () => ({
      bluetooth: hasBluetooth
        ? { supported: true, reason: '' }
        : { supported: false, reason: 'Web Bluetooth is not available in this browser. Safari and every browser on iOS do not support it.' },
      usb: { supported: true, reason: '' },
      serial: { supported: true, reason: '' },
    }),
  }
})

const { printerSetupView } = await import('./printer-setup-view')
const { loadDeviceSettings } = await import('../../shared/devices/device-config')

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function mount(): HTMLElement {
  // The shop's name is handed in by the host now: a plugin may not read the
  // session for itself (spec §51).
  const view = printerSetupView({ shopName: 'Rahim Store' })
  document.body.appendChild(view)
  return view
}

function addButton(view: HTMLElement, transport: string): HTMLButtonElement {
  const found = view.querySelector<HTMLButtonElement>(`button[data-add="${transport}"]`)
  if (!found) throw new Error(`no Add button for ${transport}`)
  return found
}

function textOf(el: HTMLElement): string {
  return el.textContent ?? ''
}

beforeEach(() => {
  localStorage.clear()
  document.body.replaceChildren()
  hasBluetooth = true
  vi.clearAllMocks()
})

describe('what the page offers', () => {
  it('starts by admitting there is no printer, without hiding the alternatives', () => {
    const view = mount()

    expect(textOf(view)).toContain('No printer on this till yet')
    // An iPad has no Bluetooth and no USB, and must not be left with nothing.
    expect(textOf(view)).toContain('System dialog')
    expect(textOf(view)).toContain('PDF')
  })

  it('disables what this browser cannot do, and says why', () => {
    hasBluetooth = false
    const view = mount()

    expect(addButton(view, 'bluetooth').disabled).toBe(true)
    expect(textOf(view)).toMatch(/Safari|iOS/)
    // USB is still offered: one missing API must not disable the others.
    expect(addButton(view, 'usb').disabled).toBe(false)
  })
})

describe('pairing', () => {
  it('adds the paired printer and makes it the default', async () => {
    const view = mount()
    addButton(view, 'bluetooth').click()
    await settle()

    expect(pairBluetoothPrinter).toHaveBeenCalled()
    expect(textOf(view)).toContain('Xprinter XP-58')
    expect(textOf(view)).toContain('Default')

    const saved = loadDeviceSettings()
    expect(saved.printers).toHaveLength(1)
    expect(saved.activePrinterId).toBe(saved.printers[0]?.id)
    // Image mode by default, because the receipt has Bangla on it.
    expect(saved.printers[0]?.mode).toBe('raster')
  })

  it('does not shout at a cashier who closed the chooser', async () => {
    pairBluetoothPrinter.mockRejectedValueOnce(new Error('User cancelled the requestDevice() chooser.'))
    const view = mount()
    addButton(view, 'bluetooth').click()
    await settle()

    expect(loadDeviceSettings().printers).toHaveLength(0)
    expect(textOf(view)).toContain('No printer on this till yet')
  })

  it('keeps the settings across a reload of the page', async () => {
    const first = mount()
    addButton(first, 'bluetooth').click()
    await settle()

    document.body.replaceChildren()
    const second = mount()
    expect(textOf(second)).toContain('Xprinter XP-58')
  })
})

describe('a network printer', () => {
  it('is added ready to configure, and says why a bridge is needed', async () => {
    const view = mount()
    addButton(view, 'network').click()
    await settle()

    expect(textOf(view)).toContain('Network printer')
    // The single most misunderstood part of "wifi printing" in a browser.
    expect(textOf(view)).toContain('cannot open a printer socket')
    expect(textOf(view)).toContain('Bridge URL')
  })
})

describe('testing it', () => {
  it('sends a test page the shop cannot mistake for a sale', async () => {
    const view = mount()
    addButton(view, 'bluetooth').click()
    await settle()

    const test = [...view.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Test page'))
    expect(test).toBeDefined()
    test?.click()
    await settle()

    expect(sendToPrinter).toHaveBeenCalledTimes(1)
    const bytes = sendToPrinter.mock.calls[0]?.[1] as Uint8Array
    const text = String.fromCharCode(...bytes)
    expect(text).toContain('TEST')
    expect(text).toContain('Rahim Store')
    // It ends with a cut, like a real receipt would.
    expect([...bytes.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00])
  })
})
