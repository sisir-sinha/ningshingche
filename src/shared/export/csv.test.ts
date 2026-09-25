/**
 * CSV tests (Phase 5 acceptance: "a report exported to CSV re-imports to
 * identical row counts").
 *
 * The round trip is the test. Everything else here exists to protect it: a
 * field with a comma, a quote, a newline or an accented name must come back
 * out of `parseCsv` as exactly what went in, and the trailing newline must not
 * invent a row.
 */

import { describe, it, expect } from 'vitest'
import { csvField, csvRowCount, csvFilename, parseCsv, toCsv } from './csv'

describe('csvField', () => {
  it('leaves a plain value alone', () => {
    expect(csvField('Rice')).toBe('Rice')
    expect(csvField(42)).toBe('42')
  })

  it('quotes anything containing a comma, a quote or a line break', () => {
    expect(csvField('Karim, Sons')).toBe('"Karim, Sons"')
    expect(csvField('12" pipe')).toBe('"12"" pipe"')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
  })

  it('writes numbers as plain decimals, never grouped or exponential', () => {
    expect(csvField(1234.5)).toBe('1234.5')
    expect(csvField(0.1 + 0.2)).toBe('0.3')
    expect(csvField(12)).toBe('12')
  })

  it('writes null and undefined as empty', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })
})

describe('parseCsv', () => {
  it('reads quoted fields containing commas', () => {
    expect(parseCsv('a,b\n"x,y",z\n')).toEqual([
      ['a', 'b'],
      ['x,y', 'z'],
    ])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('name\n"12"" pipe"\n')[1]).toEqual(['12" pipe'])
  })

  it('ignores the trailing newline instead of inventing an empty row', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toHaveLength(2)
    expect(csvRowCount('a,b\r\n1,2\r\n')).toBe(1)
  })

  it('strips a BOM', () => {
    expect(parseCsv('\uFEFFa,b\n1,2\n')[0]).toEqual(['a', 'b'])
  })
})

describe('toCsv', () => {
  const columns = [
    { key: 'invoice', label: 'Invoice' },
    { key: 'customer', label: 'Customer' },
    { key: 'total', label: 'Total' },
  ]

  const rows = [
    { invoice: 'INV-1', customer: 'Karim, Sons', total: 1250.5 },
    { invoice: 'INV-2', customer: 'Nadia "N" Begum', total: 0 },
    { invoice: 'INV-3', customer: 'Multi\nline', total: 99.99 },
  ]

  it('writes the column labels as the header, in order', () => {
    expect(toCsv(columns, rows).split('\r\n')[0]).toBe('Invoice,Customer,Total')
  })

  it('round-trips: parsing an export gives back the same rows', () => {
    const text = toCsv(columns, rows)
    const parsed = parseCsv(text)

    expect(parsed).toHaveLength(rows.length + 1)
    expect(csvRowCount(text)).toBe(rows.length)

    rows.forEach((row, index) => {
      const parsedRow = parsed[index + 1]
      expect(parsedRow?.[0]).toBe(row.invoice)
      expect(parsedRow?.[1]).toBe(row.customer)
      expect(parsedRow?.[2]).toBe(String(row.total))
    })
  })

  it('can prefix a BOM so Excel reads a ৳-bearing file correctly', () => {
    const text = toCsv(columns, [{ invoice: '৳১', customer: 'Rahim', total: 5 }], { bom: true })
    expect(text.startsWith('\uFEFF')).toBe(true)
    expect(parseCsv(text)[1]?.[0]).toBe('৳১')
  })

  it('handles an empty result set as a header-only file', () => {
    const text = toCsv(columns, [])
    expect(csvRowCount(text)).toBe(0)
    expect(parseCsv(text)).toHaveLength(1)
  })
})

describe('csvFilename', () => {
  it('turns a period label into a filename that sorts by date', () => {
    expect(csvFilename('sales', '01 Sep 2026 – 25 Sep 2026')).toBe(
      'sales-01-sep-2026-25-sep-2026.csv'
    )
  })

  it('falls back to "export" when the label has no usable characters', () => {
    expect(csvFilename('sales', '——')).toBe('sales-export.csv')
  })
})
