/**
 * A PDF writer, in about a hundred lines.
 *
 * ── Why not a library ─────────────────────────────────────────────────────
 * The obvious answer is jsPDF or pdf-lib. Both are 300–800 kB, and both would
 * be carried by every till on a 2G connection in order to do one thing: put a
 * receipt on a page. Worse, neither solves the problem this app actually has —
 * a PDF font has to be *embedded* to render Bangla, so a text-based PDF from a
 * library still needs a 400 kB Noto Sans Bengali subsetted into it.
 *
 * So the receipt is rendered by the browser (which already has the fonts, the
 * shaping engine and the layout) into a canvas, and this file wraps the
 * resulting JPEG in the smallest valid PDF that shows it. The output is a few
 * dozen bytes larger than the image itself.
 *
 * The cost is honest and worth stating: the text in this PDF is not
 * selectable, because it is a picture of text. For an 80mm receipt that is the
 * right trade — it is a picture of a receipt in every other respect too.
 *
 * ── The format ────────────────────────────────────────────────────────────
 * A PDF is a header, a set of numbered objects, a cross-reference table giving
 * each object's byte offset, and a trailer pointing at the table. The offsets
 * are why this is written against a byte array rather than a string: one
 * multi-byte character anywhere and every offset after it is wrong, which
 * produces a file that some readers open and others reject.
 */

/** 72 points to the inch; 25.4 mm to the inch. */
export function mmToPt(mm: number): number {
  return (mm * 72) / 25.4
}

export interface ImagePdfOptions {
  /** JPEG bytes. DCTDecode embeds them as-is — no re-encoding. */
  jpeg: Uint8Array
  /** Pixel dimensions of that JPEG. */
  pixelWidth: number
  pixelHeight: number
  /** Printed width. The height follows from the aspect ratio. */
  pageWidthMm: number
  /** White space around the image, in millimetres. */
  marginMm?: number
  title?: string
}

/**
 * One image, one page, sized to the paper.
 *
 * The page is as tall as the receipt needs, not A4: a 300mm-long page is
 * perfectly legal PDF and is what a continuous-roll receipt *is*. Printing it
 * to A4 still works — the driver scales to fit.
 */
export function imagePdf(options: ImagePdfOptions): Uint8Array {
  const { jpeg, pixelWidth, pixelHeight, pageWidthMm, marginMm = 3, title = 'Receipt' } = options

  const margin = mmToPt(marginMm)
  const pageWidth = mmToPt(pageWidthMm)
  const drawWidth = Math.max(1, pageWidth - margin * 2)
  const drawHeight = (drawWidth * pixelHeight) / Math.max(1, pixelWidth)
  const pageHeight = drawHeight + margin * 2

  const objects: Array<string | Uint8Array> = []

  // 1 — catalogue
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  // 2 — page tree
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  // 3 — the page
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(pageWidth)} ${round(pageHeight)}] ` +
      `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`
  )
  // 4 — content stream: place the image
  const content =
    `q\n${round(drawWidth)} 0 0 ${round(drawHeight)} ${round(margin)} ${round(margin)} cm\n/Im0 Do\nQ\n`
  objects.push(streamObject(`<< /Length ${utf8(content).length} >>`, utf8(content)))
  // 5 — the image itself
  objects.push(
    streamObject(
      `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
      jpeg
    )
  )
  // 6 — document information
  objects.push(`<< /Title (${escapeString(title)}) /Producer (Mekholi) >>`)

  return assemble(objects)
}

// ── Assembly ──────────────────────────────────────────────────────────────

function streamObject(dictionary: string, data: Uint8Array): Uint8Array {
  return concat([utf8(`${dictionary}\nstream\n`), data, utf8('\nendstream')])
}

function assemble(objects: Array<string | Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let cursor = 0

  const push = (chunk: Uint8Array): void => {
    parts.push(chunk)
    cursor += chunk.length
  }

  // `%PDF-1.4`, then a comment of high bytes. That second line is what tells
  // an FTP client or a mail gateway the file is binary; without it some of
  // them "helpfully" rewrite the line endings and corrupt the stream.
  push(utf8('%PDF-1.4\n'))
  push(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  objects.forEach((object, index) => {
    offsets.push(cursor)
    push(utf8(`${index + 1} 0 obj\n`))
    push(typeof object === 'string' ? utf8(object) : object)
    push(utf8('\nendobj\n'))
  })

  const xrefOffset = cursor
  const count = objects.length + 1
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, '0')} 00000 n \n`
  }
  push(utf8(xref))
  push(
    utf8(
      `trailer\n<< /Size ${count} /Root 1 0 R /Info ${objects.length} 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF\n`
    )
  )

  return concat(parts)
}

function utf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text)
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff
  return out
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** PDF strings are parenthesised, so the parentheses have to be escaped. */
function escapeString(value: string): string {
  return value.replace(/[\\()]/g, (character) => `\\${character}`)
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}
