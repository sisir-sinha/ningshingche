/**
 * The hand-rolled PDF.
 *
 * A PDF is only valid if its cross-reference offsets are byte-exact, and a
 * reader that disagrees says nothing more helpful than "cannot open". Since
 * there is no PDF reader in CI, the test reads the file the way a reader
 * would: follow `startxref` to the table, follow the table to each object, and
 * check that an object really begins there.
 */

import { describe, expect, it } from 'vitest'
import { imagePdf, mmToPt } from './pdf'

/** A stand-in for JPEG bytes — the writer embeds them without looking. */
const FAKE_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])

function build(): { bytes: Uint8Array; text: string } {
  const bytes = imagePdf({
    jpeg: FAKE_JPEG,
    pixelWidth: 576,
    pixelHeight: 1200,
    pageWidthMm: 72,
    title: 'Receipt INV-9',
  })
  return { bytes, text: Array.from(bytes, (byte) => String.fromCharCode(byte)).join('') }
}

describe('a one-image PDF', () => {
  it('looks like a PDF to anything that sniffs the first bytes', () => {
    const { text } = build()
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('marks itself binary, so a gateway does not rewrite the line endings', () => {
    const { bytes } = build()
    // The convention: a comment of four bytes above 127 on line two.
    expect([...bytes.slice(9, 13)]).toEqual([0x25, 0xe2, 0xe3, 0xcf])
  })

  it('points every xref entry at the start of a real object', () => {
    const { bytes, text } = build()
    const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1])
    expect(Number.isFinite(startxref)).toBe(true)

    const table = text.slice(startxref)
    expect(table.startsWith('xref')).toBe(true)

    const offsets = [...table.matchAll(/^(\d{10}) 00000 n/gm)].map((match) => Number(match[1]))
    expect(offsets).toHaveLength(6)

    offsets.forEach((offset, index) => {
      const here = Array.from(bytes.slice(offset, offset + 12), (b) => String.fromCharCode(b)).join('')
      expect(here.startsWith(`${index + 1} 0 obj`)).toBe(true)
    })
  })

  it('embeds the image untouched, as DCTDecode', () => {
    const { bytes, text } = build()
    expect(text).toContain('/Filter /DCTDecode')
    expect(text).toContain(`/Length ${FAKE_JPEG.length}`)
    // The exact bytes handed in are the exact bytes in the file.
    const at = text.indexOf('\xff\xd8\xff\xe0')
    expect([...bytes.slice(at, at + FAKE_JPEG.length)]).toEqual([...FAKE_JPEG])
  })

  it('sizes the page to the paper and the image’s aspect ratio', () => {
    const { text } = build()
    const box = /MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text)
    const width = Number(box?.[1])
    const height = Number(box?.[2])

    expect(width).toBeCloseTo(mmToPt(72), 1)
    // 576 × 1200 at 68mm of drawable width, plus 2mm margins top and bottom.
    const drawWidth = mmToPt(72) - mmToPt(3) * 2
    expect(height).toBeCloseTo((drawWidth * 1200) / 576 + mmToPt(3) * 2, 1)
  })

  it('escapes a title that would otherwise break the string syntax', () => {
    const bytes = imagePdf({
      jpeg: FAKE_JPEG,
      pixelWidth: 10,
      pixelHeight: 10,
      pageWidthMm: 72,
      title: 'Receipt (copy) \\ 2',
    })
    const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
    expect(text).toContain('/Title (Receipt \\(copy\\) \\\\ 2)')
  })
})
