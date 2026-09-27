/**
 * The receipt as a picture, a PDF, and a stream of printer bytes.
 *
 * ── Why the canvas is the source for all three ────────────────────────────
 * A receipt in this market has Bangla on it: the shop's name, often the
 * customer's, sometimes the product. That single fact decides the whole
 * design.
 *
 *   * A thermal printer's built-in fonts have no Bangla glyphs, so text mode
 *     prints `????????`.
 *   * A PDF needs an embedded font for Bangla, which means shipping ~400 kB of
 *     Noto Sans Bengali to every till.
 *   * The browser, meanwhile, already has the fonts and a shaping engine, and
 *     has already laid the receipt out on screen.
 *
 * So the browser draws it once into a canvas at printer resolution, and the
 * image feeds the PNG download, the PDF, and the printer's raster mode. One
 * layout, three outputs, no font problem anywhere — and what the cashier sees
 * on screen is pixel-for-pixel what comes out of the machine.
 */

import {
  EscPosBuilder,
  columnsFor,
  dotsFor,
  monochrome,
  needsRaster,
  type PaperWidth,
} from '../../shared/devices/escpos'
import type { PrinterConfig } from '../../shared/devices/device-config'
import { imagePdf } from '../../shared/export/pdf'
import type { ReceiptData } from './receipt'

// ── Canvas layout ─────────────────────────────────────────────────────────

interface Row {
  text: string
  /** Right-hand column, printed flush right on the same baseline. */
  right?: string
  size: number
  bold?: boolean
  align?: 'left' | 'center'
  /** Extra space above, in device pixels. */
  spaceBefore?: number
  rule?: boolean
}

/**
 * The receipt as a list of rows.
 *
 * Kept separate from the drawing so the layout can be reasoned about — and
 * tested — without a canvas, which is exactly what jsdom does not have.
 */
export function receiptRows(data: ReceiptData, base: number): Row[] {
  const rows: Row[] = [
    { text: data.shopName, size: base * 1.6, bold: true, align: 'center' },
    { text: data.invoiceNo, size: base * 0.95, align: 'center' },
    { text: `${data.soldAt} · ${data.status}`, size: base * 0.85, align: 'center' },
    { text: `Served: ${data.customer}`, size: base * 0.85, align: 'center' },
    { text: '', size: base * 0.4, rule: true },
  ]

  for (const line of data.lines) {
    rows.push({ text: line.name, size: base })
    if (line.variant) rows.push({ text: `  ${line.variant}`, size: base * 0.85 })
    rows.push({ text: `  ${line.quantity} × ${line.unitPrice}`, right: line.lineTotal, size: base * 0.9 })
    for (const note of line.notes) rows.push({ text: `  ${note}`, size: base * 0.8 })
  }

  rows.push({ text: '', size: base * 0.4, rule: true })
  rows.push({ text: 'Subtotal', right: data.subtotal, size: base * 0.95 })
  if (hasValue(data.discount)) rows.push({ text: 'Discount', right: `-${data.discount}`, size: base * 0.95 })
  if (hasValue(data.tax)) rows.push({ text: 'Tax', right: data.tax, size: base * 0.95 })
  rows.push({ text: 'TOTAL', right: data.total, size: base * 1.25, bold: true, spaceBefore: base * 0.3 })
  rows.push({ text: 'Paid', right: data.paid, size: base * 0.95 })
  rows.push({ text: 'Change', right: data.change, size: base * 0.95 })

  if (data.note) {
    rows.push({ text: '', size: base * 0.4, rule: true })
    rows.push({ text: data.note, size: base * 0.85, align: 'center' })
  }

  rows.push({ text: '', size: base * 0.4, rule: true })
  rows.push({ text: 'Thank you', size: base * 0.95, align: 'center' })
  return rows
}

function hasValue(money: string): boolean {
  return Number(money.replace(/[^0-9.-]/g, '')) > 0
}

export interface CanvasOptions {
  paperWidth?: PaperWidth
  /** Override the pixel width — the PNG download uses a wider one for screens. */
  dots?: number
}

/**
 * Draw the receipt at printer resolution.
 *
 * 203 dpi is what every one of these printers is, so 576 dots is exactly the
 * 72mm printable area of 80mm stock. Drawing at that size means the raster is
 * sent 1:1 with no resampling — resampled thermal output looks like a fax.
 */
export function receiptCanvas(data: ReceiptData, options: CanvasOptions = {}): HTMLCanvasElement {
  const paper = options.paperWidth ?? 80
  const width = options.dots ?? dotsFor(paper)
  const base = Math.round(width / 24)
  const margin = Math.round(width * 0.035)
  const rows = receiptRows(data, base)

  const canvas = document.createElement('canvas')
  const measure = canvas.getContext('2d')
  if (!measure) {
    throw new Error('This browser cannot draw the receipt image.')
  }

  // Two passes: measure, then draw. Wrapping is done here rather than left to
  // the canvas, which has no concept of it.
  const laid: Array<Row & { lines: string[] }> = []
  let height = margin
  for (const row of rows) {
    measure.font = fontFor(row, base)
    const available = width - margin * 2 - (row.right ? measure.measureText(row.right).width + base : 0)
    const lines = row.rule ? [''] : wrap(measure, row.text, available)
    height += (row.spaceBefore ?? 0) + lines.length * lineHeight(row.size) + (row.rule ? base : 0)
    laid.push({ ...row, lines })
  }
  height += margin

  canvas.width = width
  canvas.height = Math.ceil(height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot draw the receipt image.')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#000000'
  context.textBaseline = 'top'

  let y = margin
  for (const row of laid) {
    y += row.spaceBefore ?? 0

    if (row.rule) {
      const at = y + base / 2
      context.fillRect(margin, at, width - margin * 2, Math.max(1, Math.round(base / 12)))
      y += base
      continue
    }

    context.font = fontFor(row, base)
    for (const [index, text] of row.lines.entries()) {
      const at = y + index * lineHeight(row.size)
      if (row.align === 'center') {
        context.textAlign = 'center'
        context.fillText(text, width / 2, at)
        context.textAlign = 'left'
      } else {
        context.fillText(text, margin, at)
      }
      // The money column sits on the first line of a wrapped label, which is
      // where a reader's eye goes looking for it.
      if (row.right && index === 0) {
        context.textAlign = 'right'
        context.fillText(row.right, width - margin, at)
        context.textAlign = 'left'
      }
    }
    y += row.lines.length * lineHeight(row.size)
  }

  return canvas
}

function lineHeight(size: number): number {
  return Math.round(size * 1.35)
}

function fontFor(row: Row, base: number): string {
  const weight = row.bold ? '700' : '400'
  const size = Math.round(row.size || base)
  // A stack, not a font: whichever of these the device has, the Bangla will
  // shape correctly because the browser falls back per-glyph.
  return `${weight} ${size}px "Noto Sans Bengali", "Hind Siliguri", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`
}

function wrap(context: CanvasRenderingContext2D, text: string, available: number): string[] {
  if (text === '') return ['']
  if (context.measureText(text).width <= available) return [text]

  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (context.measureText(candidate).width <= available || current === '') {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current !== '') lines.push(current)
  return lines
}

// ── Files ─────────────────────────────────────────────────────────────────

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The receipt image could not be created.'))),
      type,
      quality
    )
  })
}

/** PNG of the receipt, at twice printer resolution so it reads on a phone. */
export async function receiptPng(data: ReceiptData, paper: PaperWidth = 80): Promise<Blob> {
  return canvasBlob(receiptCanvas(data, { paperWidth: paper, dots: dotsFor(paper) * 2 }), 'image/png')
}

/**
 * PDF of the receipt, sized to the paper it was meant for.
 *
 * JPEG rather than PNG inside: `DCTDecode` lets the bytes go in untouched,
 * while a PNG would have to be decoded and re-deflated to become a valid PDF
 * image stream. Quality 0.92 on black-on-white text is visually lossless.
 */
export async function receiptPdf(data: ReceiptData, paper: PaperWidth = 80): Promise<Blob> {
  const canvas = receiptCanvas(data, { paperWidth: paper, dots: dotsFor(paper) * 2 })
  const jpeg = new Uint8Array(await (await canvasBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer())
  const bytes = imagePdf({
    jpeg,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    // The printable area, not the stock: 72mm of 80mm, 48mm of 58mm.
    pageWidthMm: paper === 58 ? 48 : 72,
    marginMm: 2,
    title: `Receipt ${data.invoiceNo}`,
  })
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
}

// ── Printer bytes ─────────────────────────────────────────────────────────

/**
 * The receipt as an ESC/POS job.
 *
 * Raster mode sends the same picture the PNG shows; text mode sends
 * characters, which is faster and sharper but ASCII-only. A shop whose receipt
 * contains a non-ASCII character is switched to raster whatever the setting
 * says — printing `????` is not a preference anyone chose.
 */
export function escPosJob(data: ReceiptData, config: PrinterConfig): Uint8Array {
  const paper = config.paperWidth
  const builder = new EscPosBuilder().init().codePage('cp437')
  const mustRaster = config.mode === 'raster' || receiptNeedsRaster(data)

  if (mustRaster) {
    const canvas = receiptCanvas(data, { paperWidth: paper })
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot render the receipt for printing.')

    // Sent in bands. A single `GS v 0` of a 1500-row receipt overruns the
    // print buffer on most of these units and comes out as half a receipt.
    const band = 128
    for (let top = 0; top < canvas.height; top += band) {
      const rows = Math.min(band, canvas.height - top)
      const image = context.getImageData(0, top, canvas.width, rows)
      builder.raster(canvas.width, rows, monochrome({ width: canvas.width, height: rows, data: image.data }))
    }
  } else {
    const width = columnsFor(paper)
    builder.align('center').size(2, 2).bold(true).line(data.shopName).size(1, 1).bold(false)
    builder.line(data.invoiceNo).line(`${data.soldAt} · ${data.status}`).line(`Served: ${data.customer}`)
    builder.align('left').rule(width)

    for (const line of data.lines) {
      builder.line(line.name)
      if (line.variant) builder.line(`  ${line.variant}`)
      builder.columns(`  ${line.quantity} x ${line.unitPrice}`, line.lineTotal, width)
      for (const note of line.notes) builder.line(`  ${note}`)
    }

    builder.rule(width)
    builder.columns('Subtotal', data.subtotal, width)
    if (hasValue(data.discount)) builder.columns('Discount', `-${data.discount}`, width)
    if (hasValue(data.tax)) builder.columns('Tax', data.tax, width)
    builder.bold(true).size(1, 2).columns('TOTAL', data.total, width).size(1, 1).bold(false)
    builder.columns('Paid', data.paid, width)
    builder.columns('Change', data.change, width)
    if (data.note) builder.rule(width).line(data.note)
    builder.rule(width).align('center').line('Thank you').align('left')
  }

  if (config.openDrawer) builder.openDrawer()
  if (config.cut) builder.cut(true)
  else builder.feed(4)

  return builder.build()
}

/** Is there anything on this receipt a thermal font cannot print? */
export function receiptNeedsRaster(data: ReceiptData): boolean {
  const text = [
    data.shopName,
    data.customer,
    data.note ?? '',
    ...data.lines.flatMap((line) => [line.name, line.variant ?? '', ...line.notes]),
  ].join(' ')
  return needsRaster(text)
}
