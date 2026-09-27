/**
 * The printer language, checked byte by byte.
 *
 * These assertions look pedantic — `1b 40` for init, `1d 56` for cut — and
 * that is exactly the point: there is no printer in CI, so the only way to
 * know a receipt will come out right is to know the bytes are right. A wrong
 * byte here is not a wrong pixel, it is a printer that prints nothing and
 * gives no reason.
 */

import { describe, expect, it } from 'vitest'
import {
  CODE_PAGES,
  EscPosBuilder,
  columnsFor,
  dotsFor,
  encodeAscii,
  monochrome,
  needsRaster,
} from './escpos'

describe('the command bytes', () => {
  it('starts a job with a reset', () => {
    expect([...new EscPosBuilder().init().build()]).toEqual([0x1b, 0x40])
  })

  it('writes a line as ASCII with a newline after it', () => {
    expect([...new EscPosBuilder().line('Hi').build()]).toEqual([0x48, 0x69, 0x0a])
  })

  it('replaces what the printer has no glyph for, rather than inventing one', () => {
    // A Bangla receipt in text mode is question marks — which is why the
    // caller is expected to use raster, and why `needsRaster` exists.
    expect(encodeAscii('চাল')).toEqual([0x3f, 0x3f, 0x3f])
    expect(needsRaster('চাল')).toBe(true)
    expect(needsRaster('Rice 5kg')).toBe(false)
  })

  it('pads a money row so the amount lands on the right margin', () => {
    const bytes = new EscPosBuilder().columns('Subtotal', '530.00', 32).build()
    const text = String.fromCharCode(...bytes).trimEnd()
    expect(text).toHaveLength(32)
    expect(text.endsWith('530.00')).toBe(true)
  })

  it('never lets a long label push the amount off the paper', () => {
    const label = 'A product name far longer than the paper is wide'
    const text = String.fromCharCode(...new EscPosBuilder().columns(label, '99.00', 32).build()).trimEnd()
    expect(text).toHaveLength(32)
    expect(text.endsWith('99.00')).toBe(true)
  })

  it('feeds before it cuts, so the cutter is past the last line', () => {
    const bytes = [...new EscPosBuilder().cut(true).build()]
    expect(bytes).toEqual([0x1b, 0x64, 3, 0x1d, 0x56, 0x42, 0x00])
  })

  it('kicks the drawer on pin 2 by default', () => {
    expect([...new EscPosBuilder().openDrawer().build()]).toEqual([0x1b, 0x70, 0, 0x19, 0xfa])
    expect([...new EscPosBuilder().openDrawer(5).build()]).toEqual([0x1b, 0x70, 1, 0x19, 0xfa])
  })

  it('clamps magnification to what the command can express', () => {
    // `GS ! n` packs two 3-bit values; asking for 20× must not overflow into
    // the neighbouring nibble and turn into an unrelated command.
    expect([...new EscPosBuilder().size(20, 20).build()]).toEqual([0x1d, 0x21, 0x77])
    expect([...new EscPosBuilder().size(1, 1).build()]).toEqual([0x1d, 0x21, 0x00])
  })

  it('selects a code page by name', () => {
    expect([...new EscPosBuilder().codePage('cp1252').build()]).toEqual([0x1b, 0x74, CODE_PAGES.cp1252])
  })
})

describe('raster mode', () => {
  it('sends the row width in bytes, not in dots', () => {
    // The classic GS v 0 bug: passing 576 where the printer wants 72.
    const data = new Uint8Array(72 * 2)
    const bytes = [...new EscPosBuilder().raster(576, 2, data).build()]
    expect(bytes.slice(0, 4)).toEqual([0x1d, 0x76, 0x30, 0x00])
    expect(bytes.slice(4, 6)).toEqual([72, 0])
    expect(bytes.slice(6, 8)).toEqual([2, 0])
    expect(bytes).toHaveLength(8 + data.length)
  })

  it('packs eight pixels to a byte, most significant bit first', () => {
    // One black pixel at x=0 and one at x=7 of an 8-wide row.
    const rgba = new Uint8ClampedArray(8 * 4).fill(255)
    for (const x of [0, 7]) {
      rgba[x * 4] = 0
      rgba[x * 4 + 1] = 0
      rgba[x * 4 + 2] = 0
    }
    expect([...monochrome({ width: 8, height: 1, data: rgba })]).toEqual([0b10000001])
  })

  it('treats a transparent pixel as white, not as black', () => {
    // A logo with an alpha background otherwise prints as a solid block.
    const rgba = new Uint8ClampedArray([0, 0, 0, 0])
    expect([...monochrome({ width: 1, height: 1, data: rgba })]).toEqual([0])
  })
})

describe('paper', () => {
  it('knows the printable area, which is narrower than the paper', () => {
    // 80mm stock is 72mm printable: 576 dots at 203dpi, not 640.
    expect(dotsFor(80)).toBe(576)
    expect(dotsFor(58)).toBe(384)
    expect(columnsFor(80)).toBe(48)
    expect(columnsFor(58)).toBe(32)
  })
})
