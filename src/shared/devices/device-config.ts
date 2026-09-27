/**
 * What this device is plugged into (spec §54, devices).
 *
 * ── Why this is per-device and not per-shop ───────────────────────────────
 * A printer is not a property of the business, it is a property of the counter
 * the tablet is standing on. Shop settings sync to every till; a Bluetooth MAC
 * address must not. The branch's second till has its own printer, the owner's
 * laptop has none, and a paired USB device cannot even be described in a way
 * another machine could use — WebUSB and Web Bluetooth hand out handles that
 * are scoped to the browser profile that did the pairing.
 *
 * So configuration lives in `localStorage`, keyed per device, and nothing here
 * ever reaches the network. The one thing that *is* shop-wide — "auto-print
 * after a sale" as a policy — stays in organization settings where it already
 * was; this file only records how to reach the hardware.
 */

export type PrinterTransport = 'bluetooth' | 'usb' | 'network' | 'browser'

export interface PrinterConfig {
  /** Stable id for this entry — not the device's own id. */
  id: string
  name: string
  transport: PrinterTransport
  paperWidth: 58 | 80
  /**
   * Raster (bitmap) or the printer's built-in font.
   *
   * Raster is the default because Bangla does not exist in any thermal
   * printer's character ROM. See `escpos.ts`.
   */
  mode: 'raster' | 'text'
  copies: number
  cut: boolean
  openDrawer: boolean
  /** Print the moment a sale completes, with no dialog in the way. */
  autoPrint: boolean

  /** Web Bluetooth: what `requestDevice` returned, so we can re-pair silently. */
  bluetooth?: undefined | {
    deviceId: string
    deviceName: string
    serviceUuid: string
    characteristicUuid: string
  }

  /** WebUSB: enough to find the same device again in `getDevices()`. */
  usb?: undefined | {
    vendorId: number
    productId: number
    serial: string | null
    productName: string | null
  }

  /**
   * LAN printer.
   *
   * A browser cannot open a TCP socket to port 9100, and no amount of wishing
   * changes that — so a network printer is reached through a small HTTP bridge
   * on the shop's own network, which does the socket. `bridgeUrl` is that
   * endpoint; `host`/`port` are what it should connect to.
   */
  network?: undefined | {
    host: string
    port: number
    bridgeUrl: string
  }
}

export interface ScannerConfig {
  /**
   * Keyboard-wedge (the scanner types) or Web Serial (the scanner streams).
   *
   * Every cheap scanner is a wedge: it pretends to be a USB keyboard and there
   * is nothing to configure at the browser end, only to *recognise*.
   */
  mode: 'wedge' | 'serial'
  /**
   * Below this gap between keystrokes, the keys came from a machine.
   *
   * A fast human types at roughly 120 ms between characters; a scanner is
   * under 20 ms. 50 ms separates them with room on both sides, and the setup
   * page measures the shop's actual scanner so this can be tuned rather than
   * guessed.
   */
  maxKeyGapMs: number
  /** Shorter than this is somebody typing, not a barcode. */
  minLength: number
  /** Characters the scanner is programmed to send before/after the code. */
  prefix: string
  suffix: 'enter' | 'tab' | 'none'
  /** Beep on a good read, from the browser rather than the scanner. */
  beep: boolean
  /** Serial mode only. */
  baudRate: number
}

export interface DeviceSettings {
  printers: PrinterConfig[]
  activePrinterId: string | null
  scanner: ScannerConfig
}

const STORAGE_KEY = 'mekholi.devices.v1'

export const DEFAULT_SCANNER: ScannerConfig = {
  mode: 'wedge',
  maxKeyGapMs: 50,
  minLength: 4,
  prefix: '',
  suffix: 'enter',
  beep: true,
  baudRate: 9600,
}

export function defaultSettings(): DeviceSettings {
  return { printers: [], activePrinterId: null, scanner: { ...DEFAULT_SCANNER } }
}

/** A printer entry with every optional field filled in. */
export function newPrinter(partial: Partial<PrinterConfig> & { name: string; transport: PrinterTransport }): PrinterConfig {
  return {
    id: partial.id ?? `prn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: partial.name,
    transport: partial.transport,
    paperWidth: partial.paperWidth ?? 80,
    mode: partial.mode ?? 'raster',
    copies: partial.copies ?? 1,
    cut: partial.cut ?? true,
    openDrawer: partial.openDrawer ?? false,
    autoPrint: partial.autoPrint ?? false,
    bluetooth: partial.bluetooth,
    usb: partial.usb,
    network: partial.network,
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Safari in private mode throws on access rather than returning null.
    return null
  }
}

/**
 * Read the device's configuration.
 *
 * Tolerant on purpose: a half-written or older record returns defaults for the
 * parts it cannot understand rather than throwing, because the alternative is
 * a till that will not boot over a printer preference.
 */
export function loadDeviceSettings(): DeviceSettings {
  const store = storage()
  if (!store) return defaultSettings()

  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings()
    const parsed = JSON.parse(raw) as Partial<DeviceSettings>
    const printers = Array.isArray(parsed.printers) ? parsed.printers.filter(isPrinter) : []
    const activeId = typeof parsed.activePrinterId === 'string' ? parsed.activePrinterId : null
    return {
      printers,
      // An active id pointing at a printer that has been deleted is the same
      // as no printer at all, and saying so here saves every caller a check.
      activePrinterId: printers.some((p) => p.id === activeId) ? activeId : (printers[0]?.id ?? null),
      scanner: { ...DEFAULT_SCANNER, ...(parsed.scanner ?? {}) },
    }
  } catch {
    return defaultSettings()
  }
}

export function saveDeviceSettings(settings: DeviceSettings): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // A full or blocked storage is not worth interrupting a sale for.
  }
}

/** The printer a sale should go to, or null when none is set up. */
export function activePrinter(settings: DeviceSettings = loadDeviceSettings()): PrinterConfig | null {
  return settings.printers.find((printer) => printer.id === settings.activePrinterId) ?? null
}

function isPrinter(value: unknown): value is PrinterConfig {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<PrinterConfig>
  return typeof candidate.id === 'string' && typeof candidate.name === 'string'
}

// ── Browser capability ────────────────────────────────────────────────────

export interface Capability {
  supported: boolean
  /** Why not — shown to the shopkeeper, who cannot read a feature-detect. */
  reason: string
}

interface NavigatorWithDevices extends Navigator {
  bluetooth?: unknown
  usb?: unknown
  serial?: unknown
}

/**
 * What this browser can actually talk to.
 *
 * Worth being blunt in the UI about: Web Bluetooth and WebUSB do not exist in
 * Safari or on any iOS browser (they are all Safari underneath), and they
 * require a secure context everywhere else. A shop on an iPad has to use the
 * network bridge or the system print dialog, and it is kinder to say that on
 * the setup page than to let them tap Pair and watch nothing happen.
 */
export function capabilities(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): Record<'bluetooth' | 'usb' | 'serial', Capability> {
  const device = nav as NavigatorWithDevices | undefined
  const secure = typeof window === 'undefined' ? true : window.isSecureContext !== false

  const check = (present: boolean, name: string): Capability => {
    if (!present) {
      return {
        supported: false,
        reason: `${name} is not available in this browser. Chrome, Edge or Samsung Internet on Android, Windows, macOS or Linux support it; Safari and every browser on iOS do not.`,
      }
    }
    if (!secure) {
      return { supported: false, reason: `${name} needs a secure connection (https).` }
    }
    return { supported: true, reason: '' }
  }

  return {
    bluetooth: check(Boolean(device?.bluetooth), 'Web Bluetooth'),
    usb: check(Boolean(device?.usb), 'WebUSB'),
    serial: check(Boolean(device?.serial), 'Web Serial'),
  }
}
