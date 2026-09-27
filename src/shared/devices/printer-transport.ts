/**
 * Getting bytes from the browser to the printer.
 *
 * Four routes, because a shop counter is not one kind of machine:
 *
 *   bluetooth  Web Bluetooth GATT. The 58mm units sold with a battery.
 *   usb        WebUSB bulk transfer. The desk printer on the owner's PC.
 *   network    An HTTP bridge on the shop's LAN that owns the 9100 socket.
 *   browser    The system print dialog. No driver, no pairing, works anywhere.
 *
 * ── The one thing a browser cannot do ─────────────────────────────────────
 * It cannot open a TCP socket. A LAN printer listening on 9100 is therefore
 * unreachable from a web page *by design*, and every "network printing in the
 * browser" library either ships a helper program or is lying. We are explicit
 * about it: the shop runs a tiny bridge (or the Android wrapper provides one),
 * and this file POSTs the job to it. Saying so in the UI is better than a
 * Connect button that times out for reasons the shopkeeper cannot diagnose.
 *
 * ── Types ─────────────────────────────────────────────────────────────────
 * Web Bluetooth and WebUSB are not in TypeScript's DOM library, so the shapes
 * used here are declared locally. They are deliberately minimal: the handful
 * of members this file touches, and nothing else.
 */

import type { PrinterConfig } from './device-config'

// ── Minimal platform types ────────────────────────────────────────────────

interface GattCharacteristic {
  uuid: string
  properties: { write: boolean; writeWithoutResponse: boolean }
  writeValue(value: BufferSource): Promise<void>
  writeValueWithoutResponse?(value: BufferSource): Promise<void>
}

interface GattService {
  uuid: string
  getCharacteristics(): Promise<GattCharacteristic[]>
}

interface GattServer {
  connected: boolean
  connect(): Promise<GattServer>
  disconnect(): void
  getPrimaryServices(): Promise<GattService[]>
}

interface BluetoothDeviceLike {
  id: string
  name?: string | null
  gatt?: GattServer
}

interface BluetoothLike {
  requestDevice(options: {
    filters?: Array<Record<string, unknown>>
    optionalServices?: Array<string | number>
    acceptAllDevices?: boolean
  }): Promise<BluetoothDeviceLike>
  getDevices?(): Promise<BluetoothDeviceLike[]>
}

interface UsbEndpoint {
  endpointNumber: number
  direction: 'in' | 'out'
  type: string
}

interface UsbAlternate {
  interfaceClass: number
  endpoints: UsbEndpoint[]
}

interface UsbInterface {
  interfaceNumber: number
  alternate: UsbAlternate
}

interface UsbConfiguration {
  configurationValue: number
  interfaces: UsbInterface[]
}

interface UsbDeviceLike {
  vendorId: number
  productId: number
  serialNumber?: string | null
  productName?: string | null
  opened: boolean
  configuration: UsbConfiguration | null
  configurations: UsbConfiguration[]
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(value: number): Promise<void>
  claimInterface(value: number): Promise<void>
  releaseInterface(value: number): Promise<void>
  transferOut(endpoint: number, data: BufferSource): Promise<{ status: string }>
}

interface UsbLike {
  requestDevice(options: { filters: Array<Record<string, unknown>> }): Promise<UsbDeviceLike>
  getDevices(): Promise<UsbDeviceLike[]>
}

interface DeviceNavigator extends Navigator {
  bluetooth?: BluetoothLike
  usb?: UsbLike
}

function nav(): DeviceNavigator | null {
  return typeof navigator === 'undefined' ? null : (navigator as DeviceNavigator)
}

// ── Known services ────────────────────────────────────────────────────────

/**
 * The GATT services these printers expose, in the order worth trying.
 *
 * There is no standard "printer" profile in BLE, so every manufacturer picked
 * a serial-over-GATT service and stuck with it. `18f0` covers the Xprinter and
 * Rongta families that dominate this market; `ff00`/`ffe0` cover the generic
 * modules; the last is Nordic's UART service, used by a few rebadged units.
 */
export const PRINTER_SERVICES: string[] = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
]

export interface PairedBluetooth {
  deviceId: string
  deviceName: string
  serviceUuid: string
  characteristicUuid: string
}

export class PrinterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrinterError'
  }
}

// ── Bluetooth ─────────────────────────────────────────────────────────────

/**
 * Ask the user to pick a printer, then find a characteristic we may write to.
 *
 * The chooser must be opened from a user gesture — a click, not a load — or
 * the browser rejects it. The scan filters on the known services *and* accepts
 * all devices, because a printer that advertises none of them still shows up
 * and a shopkeeper who can see their printer in the list will pick it.
 */
export async function pairBluetoothPrinter(): Promise<PairedBluetooth> {
  const bluetooth = nav()?.bluetooth
  if (!bluetooth) throw new PrinterError('This browser has no Bluetooth support.')

  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICES,
  })

  const server = await connectGatt(device)
  const { service, characteristic } = await findWritable(server)
  server.disconnect()

  return {
    deviceId: device.id,
    deviceName: device.name ?? 'Bluetooth printer',
    serviceUuid: service.uuid,
    characteristicUuid: characteristic.uuid,
  }
}

async function connectGatt(device: BluetoothDeviceLike): Promise<GattServer> {
  const gatt = device.gatt
  if (!gatt) throw new PrinterError('That device does not expose a Bluetooth connection.')
  // A printer that was just woken can refuse the first connect; one retry
  // turns a "failed to pair" into a pause the user never notices.
  try {
    return await gatt.connect()
  } catch {
    await delay(400)
    return await gatt.connect()
  }
}

async function findWritable(server: GattServer): Promise<{ service: GattService; characteristic: GattCharacteristic }> {
  const services = await server.getPrimaryServices()
  const ordered = [...services].sort(
    (a, b) => rank(a.uuid) - rank(b.uuid)
  )

  for (const service of ordered) {
    const characteristics = await service.getCharacteristics()
    const writable = characteristics.find(
      (c) => c.properties.write || c.properties.writeWithoutResponse
    )
    if (writable) return { service, characteristic: writable }
  }
  throw new PrinterError('No writable channel on that device — it may not be a printer.')
}

function rank(uuid: string): number {
  const index = PRINTER_SERVICES.indexOf(uuid.toLowerCase())
  return index === -1 ? PRINTER_SERVICES.length : index
}

/**
 * BLE writes are capped at the connection's MTU — 20 bytes on the pessimistic
 * default, and a receipt raster is tens of kilobytes. So it goes in chunks,
 * with a breath between them: these printers have a small buffer and drop
 * whatever arrives while it is full, which shows up as a receipt missing its
 * middle rather than as an error.
 */
const BLE_CHUNK = 180
const BLE_PAUSE_MS = 18

async function sendBluetooth(config: PrinterConfig, bytes: Uint8Array): Promise<void> {
  const bluetooth = nav()?.bluetooth
  const paired = config.bluetooth
  if (!bluetooth) throw new PrinterError('This browser has no Bluetooth support.')
  if (!paired) throw new PrinterError('That printer has not been paired yet.')

  const known = (await bluetooth.getDevices?.()) ?? []
  const device = known.find((d) => d.id === paired.deviceId)
  if (!device) {
    throw new PrinterError(
      `${paired.deviceName} is not connected. Open Printer setup and pair it again — a browser forgets a Bluetooth device when its permission is cleared.`
    )
  }

  const server = await connectGatt(device)
  try {
    const services = await server.getPrimaryServices()
    const service = services.find((s) => s.uuid === paired.serviceUuid) ?? services[0]
    if (!service) throw new PrinterError('The printer exposed no services.')
    const characteristics = await service.getCharacteristics()
    const target =
      characteristics.find((c) => c.uuid === paired.characteristicUuid) ??
      characteristics.find((c) => c.properties.write || c.properties.writeWithoutResponse)
    if (!target) throw new PrinterError('The printer exposed no writable channel.')

    for (let offset = 0; offset < bytes.length; offset += BLE_CHUNK) {
      const chunk = bytes.slice(offset, offset + BLE_CHUNK)
      if (target.properties.writeWithoutResponse && target.writeValueWithoutResponse) {
        await target.writeValueWithoutResponse(chunk)
        await delay(BLE_PAUSE_MS)
      } else {
        // `writeValue` is acknowledged, so it paces itself.
        await target.writeValue(chunk)
      }
    }
  } finally {
    server.disconnect()
  }
}

// ── USB ───────────────────────────────────────────────────────────────────

export interface PairedUsb {
  vendorId: number
  productId: number
  serial: string | null
  productName: string | null
}

/** USB printer class. Filtering on it keeps mice out of the chooser. */
const USB_PRINTER_CLASS = 7

export async function pairUsbPrinter(): Promise<PairedUsb> {
  const usb = nav()?.usb
  if (!usb) throw new PrinterError('This browser has no USB support.')

  const device = await usb.requestDevice({
    filters: [{ classCode: USB_PRINTER_CLASS }, {}],
  })

  return {
    vendorId: device.vendorId,
    productId: device.productId,
    serial: device.serialNumber ?? null,
    productName: device.productName ?? null,
  }
}

async function sendUsb(config: PrinterConfig, bytes: Uint8Array): Promise<void> {
  const usb = nav()?.usb
  const paired = config.usb
  if (!usb) throw new PrinterError('This browser has no USB support.')
  if (!paired) throw new PrinterError('That printer has not been paired yet.')

  const devices = await usb.getDevices()
  const device = devices.find(
    (d) => d.vendorId === paired.vendorId && d.productId === paired.productId
  )
  if (!device) {
    throw new PrinterError(
      `${config.name} is not plugged in, or this browser has lost permission for it. Open Printer setup and pair it again.`
    )
  }

  if (!device.opened) await device.open()
  try {
    const configuration = device.configuration ?? device.configurations[0]
    if (!configuration) throw new PrinterError('The printer reported no USB configuration.')
    if (!device.configuration) await device.selectConfiguration(configuration.configurationValue)

    // Prefer the interface that says it is a printer; fall back to the first
    // one with a bulk OUT endpoint, because plenty of cheap units mislabel it.
    const candidates = configuration.interfaces
    const chosen =
      candidates.find((i) => i.alternate.interfaceClass === USB_PRINTER_CLASS && outEndpoint(i) !== null) ??
      candidates.find((i) => outEndpoint(i) !== null)
    const endpoint = chosen ? outEndpoint(chosen) : null
    if (!chosen || endpoint === null) throw new PrinterError('That USB device has no printer channel.')

    await device.claimInterface(chosen.interfaceNumber)
    try {
      // 4 KB at a time: one transferOut of a whole raster overflows the
      // driver's buffer on Windows and returns `babble`.
      for (let offset = 0; offset < bytes.length; offset += 4096) {
        const result = await device.transferOut(endpoint, bytes.slice(offset, offset + 4096))
        if (result.status !== 'ok') throw new PrinterError(`The printer rejected the job (${result.status}).`)
      }
    } finally {
      await device.releaseInterface(chosen.interfaceNumber).catch(() => undefined)
    }
  } finally {
    await device.close().catch(() => undefined)
  }
}

function outEndpoint(iface: UsbInterface): number | null {
  const endpoint = iface.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
  return endpoint ? endpoint.endpointNumber : null
}

// ── Network bridge ────────────────────────────────────────────────────────

/**
 * POSTs the raw job to a helper that owns the socket.
 *
 * The body is `application/octet-stream` — the bytes, not JSON with a base64
 * string in it — so a three-line bridge can pipe the request straight into the
 * socket without parsing anything.
 */
async function sendNetwork(config: PrinterConfig, bytes: Uint8Array): Promise<void> {
  const target = config.network
  if (!target?.bridgeUrl) {
    throw new PrinterError('This printer has no bridge address. A browser cannot open a printer socket by itself.')
  }

  const url = new URL(target.bridgeUrl)
  url.searchParams.set('host', target.host)
  url.searchParams.set('port', String(target.port))

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes.slice().buffer as ArrayBuffer,
    })
  } catch {
    throw new PrinterError(
      `Could not reach the print bridge at ${target.bridgeUrl}. Check the till and the bridge are on the same network.`
    )
  }

  if (!response.ok) {
    throw new PrinterError(`The print bridge answered ${response.status}. The printer may be off or out of paper.`)
  }
}

// ── Public surface ────────────────────────────────────────────────────────

/**
 * Send one job, honouring `copies`.
 *
 * Copies are sent as repeats of the whole job rather than by the printer's own
 * copy command, which not every model implements — and a kitchen copy that
 * silently never printed is worse than a slow one.
 */
export async function sendToPrinter(config: PrinterConfig, bytes: Uint8Array): Promise<void> {
  const copies = Math.max(1, Math.min(5, config.copies || 1))
  for (let index = 0; index < copies; index += 1) {
    switch (config.transport) {
      case 'bluetooth':
        await sendBluetooth(config, bytes)
        break
      case 'usb':
        await sendUsb(config, bytes)
        break
      case 'network':
        await sendNetwork(config, bytes)
        break
      case 'browser':
        throw new PrinterError('This printer prints through the browser dialog, not as raw bytes.')
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
