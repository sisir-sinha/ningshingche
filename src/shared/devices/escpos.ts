/**
 * ESC/POS — the language thermal printers actually speak.
 *
 * Every counter printer sold in this market (Xprinter, Gprinter, Rongta, EPPOS,
 * the unbranded 58mm units) understands Epson's ESC/POS, whether it is wired
 * over Bluetooth SPP, USB bulk or a LAN socket. The transport differs; the
 * bytes do not. So the bytes live here, alone, with no knowledge of how they
 * reach the paper — which is also what makes them testable without a printer.
 *
 * ── Why bitmap mode is the default for this shop ──────────────────────────
 * A thermal printer's built-in fonts are 8-bit code pages. CP437, CP850,
 * CP1252 — none of them contain a single Bangla glyph. A receipt printed as
 * *text* for a shop in Sunamganj comes out as question marks, and no
 * combination of `ESC t` fixes it because the glyphs are not in the hardware.
 *
 * The way round it is `GS v 0`: send the receipt as a 1-bit raster of the
 * layout the browser already drew. Bangla, the shop's logo and a QR code all
 * print, because by then they are pixels. It is slower — roughly a second
 * more per receipt — so plain ASCII receipts can still use text mode, and the
 * setup page lets the shop choose.
 */

// ── Bytes ─────────────────────────────────────────────────────────────────

const ESC = 0x1b
const GS = 0x1d

export type Align = 'left' | 'center' | 'right'

/** Code pages the `ESC t` selector understands, by the name a human picks. */
export const CODE_PAGES: Record<string, number> = {
  /** US ASCII + box drawing. The safe default; every printer has it. */
  cp437: 0,
  /** Western European — accented Latin. */
  cp850: 2,
  /** Windows Latin-1. */
  cp1252: 16,
}

/**
 * Builds one print job.
 *
 * Deliberately mutable and chainable: a receipt is written top to bottom, and
 * modelling that as a fold over an immutable structure buys nothing but
 * ceremony.
 */
export class EscPosBuilder {
  #bytes: number[] = []

  /** Raw bytes, for a command this class does not wrap. */
  raw(...bytes: number[]): this {
    this.#bytes.push(...bytes)
    return this
  }

  /** `ESC @` — reset. Always first: the previous job may have left bold on. */
  init(): this {
    return this.raw(ESC, 0x40)
  }

  /** `ESC t n` — select the character code page. */
  codePage(page: keyof typeof CODE_PAGES | number): this {
    const n = typeof page === 'number' ? page : (CODE_PAGES[page] ?? 0)
    return this.raw(ESC, 0x74, n)
  }

  /** `ESC a n` */
  align(where: Align): this {
    return this.raw(ESC, 0x61, where === 'center' ? 1 : where === 'right' ? 2 : 0)
  }

  /** `ESC E n` */
  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0)
  }

  /** `ESC - n` */
  underline(on: boolean): this {
    return this.raw(ESC, 0x2d, on ? 1 : 0)
  }

  /**
   * `GS ! n` — character magnification, 1–8 in each axis.
   *
   * The total is the shop name and nothing else: doubling every heading on
   * 58mm paper leaves no room for the numbers, which are the point.
   */
  size(width: number, height: number): this {
    const w = Math.min(8, Math.max(1, Math.round(width))) - 1
    const h = Math.min(8, Math.max(1, Math.round(height))) - 1
    return this.raw(GS, 0x21, (w << 4) | h)
  }

  /** A line of text, encoded for the printer's code page, plus a newline. */
  line(text = ''): this {
    this.#bytes.push(...encodeAscii(text), 0x0a)
    return this
  }

  /** Text with no newline — for building a row out of parts. */
  text(text: string): this {
    this.#bytes.push(...encodeAscii(text))
    return this
  }

  /**
   * `left` flush left, `right` flush right, padded to the paper's width.
   *
   * This is how a total lines up on thermal paper: there are no tab stops and
   * no proportional metrics, only a fixed number of columns.
   */
  columns(left: string, right: string, width: number): this {
    // One space is reserved: a label long enough to touch the amount is a
    // label that has run into it, and `1,250.00` glued to a product name is
    // unreadable on 58mm paper.
    const room = Math.max(0, width - right.length - 1)
    const head = left.length > room ? left.slice(0, room) : left
    const gap = ' '.repeat(Math.max(1, width - head.length - right.length))
    return this.line(`${head}${gap}${right}`)
  }

  /** A full-width rule, e.g. `--------`. */
  rule(width: number, character = '-'): this {
    return this.line(character.repeat(Math.max(1, width)))
  }

  /** `ESC d n` — feed n lines. */
  feed(lines = 1): this {
    return this.raw(ESC, 0x64, Math.min(255, Math.max(0, Math.round(lines))))
  }

  /**
   * `GS V` — cut.
   *
   * Partial by default: a full cut on a printer with no auto-cutter jams it,
   * and partial leaves a tab the customer tears off, which is what a shop
   * expects. The feed before the cut is not optional — without it the cutter
   * sits above the last three lines and slices the total in half.
   */
  cut(partial = true, feedBefore = 3): this {
    if (feedBefore > 0) this.feed(feedBefore)
    return this.raw(GS, 0x56, partial ? 0x42 : 0x41, 0x00)
  }

  /**
   * `ESC p` — kick the cash drawer.
   *
   * The drawer is wired to the printer's RJ11 port, so "open the till" is a
   * print command. Pin 2 is the near-universal wiring; pin 5 exists and is
   * offered because a handful of drawers use it.
   */
  openDrawer(pin: 2 | 5 = 2): this {
    return this.raw(ESC, 0x70, pin === 5 ? 1 : 0, 0x19, 0xfa)
  }

  /**
   * `GS v 0` — print a 1-bit raster.
   *
   * `data` is one bit per pixel, MSB first, rows padded to whole bytes, 1 =
   * black. That is exactly what `monochrome()` produces from a canvas.
   */
  raster(width: number, height: number, data: Uint8Array): this {
    const bytesPerRow = Math.ceil(width / 8)
    this.raw(GS, 0x76, 0x30, 0x00)
    this.raw(bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff)
    this.raw(height & 0xff, (height >> 8) & 0xff)
    this.#bytes.push(...data)
    return this
  }

  /** The job. */
  build(): Uint8Array {
    return Uint8Array.from(this.#bytes)
  }

  get length(): number {
    return this.#bytes.length
  }
}

/**
 * Text → printer bytes.
 *
 * Anything outside ASCII becomes `?`. That is not laziness: the alternative is
 * a silent mojibake receipt. A shop printing Bangla should be in raster mode,
 * and the setup page says so in as many words.
 */
export function encodeAscii(text: string): number[] {
  const out: number[] = []
  for (const character of text) {
    const code = character.codePointAt(0) ?? 63
    out.push(code < 0x80 ? code : 0x3f)
  }
  return out
}

/** Does this string need raster mode to print at all? */
export function needsRaster(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7f]/.test(text)
}

// ── Raster conversion ─────────────────────────────────────────────────────

export interface Bitmap {
  width: number
  height: number
  /** RGBA, four bytes per pixel — i.e. `CanvasRenderingContext2D.getImageData`. */
  data: Uint8ClampedArray | Uint8Array
}

/**
 * RGBA → 1 bit per pixel, packed MSB first.
 *
 * `threshold` is on luminance, not on the raw channels: a mid-grey logo has to
 * decide one way or the other, and perceived brightness is the decision a
 * human would make. Transparent pixels count as white — a PNG logo with an
 * alpha background otherwise prints as a solid black square.
 */
export function monochrome(bitmap: Bitmap, threshold = 128): Uint8Array {
  const { width, height, data } = bitmap
  const bytesPerRow = Math.ceil(width / 8)
  const out = new Uint8Array(bytesPerRow * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const alpha = data[index + 3] ?? 255
      const r = data[index] ?? 255
      const g = data[index + 1] ?? 255
      const b = data[index + 2] ?? 255
      // Rec. 601 luma, then composite onto white by the alpha.
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      const value = alpha === 255 ? luma : luma * (alpha / 255) + 255 * (1 - alpha / 255)
      if (value < threshold) {
        const byte = y * bytesPerRow + (x >> 3)
        out[byte] = (out[byte] ?? 0) | (0x80 >> (x & 7))
      }
    }
  }

  return out
}

// ── Paper ─────────────────────────────────────────────────────────────────

export type PaperWidth = 58 | 80

/**
 * Printable dots across the paper, at the 203 dpi every one of these printers
 * uses.
 *
 * Not the paper width: 80mm stock is 72mm printable and 58mm stock is 48mm,
 * because the mechanism cannot reach the edge. Sending a raster wider than
 * this does not overflow — the printer silently drops the right-hand side,
 * which is worse.
 */
export function dotsFor(paper: PaperWidth): number {
  return paper === 58 ? 384 : 576
}

/** Characters per line in the printer's default font A (12 dots wide). */
export function columnsFor(paper: PaperWidth): number {
  return paper === 58 ? 32 : 48
}
