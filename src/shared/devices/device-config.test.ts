/**
 * @vitest-environment jsdom
 */

/**
 * The device's own configuration.
 *
 * Two behaviours are worth guarding above all: a corrupt record must not stop
 * the till booting, and an active printer that has been deleted must not stay
 * "active" — a sale that prints to nothing is the failure mode this store
 * exists to prevent.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  activePrinter,
  capabilities,
  defaultSettings,
  loadDeviceSettings,
  newPrinter,
  saveDeviceSettings,
} from './device-config'

beforeEach(() => {
  localStorage.clear()
})

describe('remembering the hardware', () => {
  it('starts with nothing configured', () => {
    expect(loadDeviceSettings()).toEqual(defaultSettings())
  })

  it('round-trips a printer', () => {
    const printer = newPrinter({ name: 'Xprinter XP-58', transport: 'bluetooth' })
    saveDeviceSettings({ ...defaultSettings(), printers: [printer], activePrinterId: printer.id })

    const loaded = loadDeviceSettings()
    expect(loaded.printers[0]?.name).toBe('Xprinter XP-58')
    expect(activePrinter(loaded)?.id).toBe(printer.id)
  })

  it('defaults a new printer to image mode, because Bangla has to print', () => {
    expect(newPrinter({ name: 'x', transport: 'usb' }).mode).toBe('raster')
    expect(newPrinter({ name: 'x', transport: 'usb' }).paperWidth).toBe(80)
  })

  it('does not point at a printer that has been removed', () => {
    const kept = newPrinter({ name: 'Kept', transport: 'usb' })
    saveDeviceSettings({ ...defaultSettings(), printers: [kept], activePrinterId: 'deleted-one' })

    // Falls back to what is actually there rather than reporting a printer
    // the shop no longer has.
    expect(loadDeviceSettings().activePrinterId).toBe(kept.id)
    expect(activePrinter(loadDeviceSettings())?.name).toBe('Kept')
  })

  it('survives a corrupt record instead of taking the till down with it', () => {
    localStorage.setItem('mekholi.devices.v1', '{not json at all')
    expect(loadDeviceSettings()).toEqual(defaultSettings())
  })

  it('fills in settings an older version never wrote', () => {
    localStorage.setItem('mekholi.devices.v1', JSON.stringify({ printers: [], scanner: { minLength: 9 } }))
    const loaded = loadDeviceSettings()
    expect(loaded.scanner.minLength).toBe(9)
    // The fields that record knew nothing about come back as defaults.
    expect(loaded.scanner.maxKeyGapMs).toBe(50)
    expect(loaded.scanner.suffix).toBe('enter')
  })
})

describe('what this browser can reach', () => {
  it('says why, not just no', () => {
    const none = capabilities({} as Navigator)
    expect(none.bluetooth.supported).toBe(false)
    // The shopkeeper reads this, so it has to name the browsers that do work.
    expect(none.bluetooth.reason).toMatch(/Safari|iOS/)
  })

  it('accepts a browser that has the APIs', () => {
    const full = capabilities({ bluetooth: {}, usb: {}, serial: {} } as unknown as Navigator)
    expect(full.bluetooth.supported).toBe(true)
    expect(full.usb.supported).toBe(true)
  })
})
