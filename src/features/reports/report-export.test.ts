/**
 * Report export tests (Phase 5, spec §23).
 *
 * The acceptance criterion is a round trip: what the report returns as rows is
 * what the file contains, to the row. These tests pin the two ways that could
 * stop being true — a totals row sneaking into the data, and money being
 * written in a way a spreadsheet reads as text.
 */

import { describe, it, expect } from 'vitest'
import { buildReportCsv, csvRows, reportFilename } from './report-export'
import { parseCsv, csvRowCount } from '../../shared/export/csv'
import { cellText } from '../../components/ui/table'
import type { ReportResult } from '../../shared/repositories/contracts'

function result(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    key: 'sales',
    title: 'Sales',
    group: 'Money',
    description: 'Every completed bill in the period.',
    columns: [
      { key: 'invoice_no', label: 'Invoice', type: 'text' },
      { key: 'created_at', label: 'When', type: 'date' },
      { key: 'customer_name', label: 'Customer', type: 'text' },
      { key: 'total', label: 'Total', type: 'money', align: 'right' },
      { key: 'profit', label: 'Profit', type: 'money', align: 'right' },
    ],
    rows: [
      {
        invoice_no: 'INV-1',
        created_at: '2026-09-24T10:15:00+06:00',
        customer_name: 'Karim, Sons',
        // Money is minor units all the way to the screen (Phase 5).
        total: 125050,
        profit: 22000,
      },
      {
        invoice_no: 'INV-2',
        created_at: '2026-09-25T11:30:00+06:00',
        customer_name: 'Nadia "N" Begum',
        total: 9999,
        profit: 0,
      },
      {
        invoice_no: 'INV-3',
        created_at: '2026-09-25T18:00:00+06:00',
        customer_name: null,
        total: 500,
        profit: -200,
      },
    ],
    totals: { total: 135548, profit: 21800 },
    totalRows: 3,
    offset: 0,
    limit: 25,
    sort: 'created_at',
    dir: 'desc',
    search: null,
    period: 'month',
    label: 'Sep 2026',
    from: '2026-09-01',
    to: '2026-09-30',
    currency: 'BDT',
    generatedAt: '2026-09-25T12:00:00.000Z',
    ...overrides,
  }
}

describe('report CSV export', () => {
  it('exports exactly the rows the report returned — no totals row', () => {
    const text = buildReportCsv(result())
    expect(csvRowCount(text)).toBe(3)
    expect(parseCsv(text)).toHaveLength(4)
  })

  it('re-imports to the same row count the report reported', () => {
    for (const totalRows of [0, 1, 3, 250]) {
      const rows = Array.from({ length: totalRows }, (_, index) => ({
        invoice_no: `INV-${index}`,
        created_at: '2026-09-25T10:00:00+06:00',
        customer_name: `Customer ${index}`,
        total: 100 * (index + 1),
        profit: 10 * (index + 1),
      }))
      const payload = result({ rows, totalRows })
      const parsed = csvRowCount(buildReportCsv(payload))
      expect(parsed).toBe(payload.rows.length)
    }
  })

  it('writes money as a plain two-decimal number so a spreadsheet sees a number', () => {
    const text = buildReportCsv(result())
    const parsed = parseCsv(text)
    const header = parsed[0] ?? []

    const totalColumn = header.indexOf('Total')
    expect(totalColumn).toBeGreaterThan(-1)
    expect(parsed[1]?.[totalColumn]).toBe('1250.50')
    expect(parsed[2]?.[totalColumn]).toBe('99.99')
    expect(Number(parsed[3]?.[totalColumn])).toBe(5)
  })

  it('keeps a comma in a customer name from shifting the columns', () => {
    const parsed = parseCsv(buildReportCsv(result()))
    expect(parsed[1]).toEqual([
      'INV-1',
      '2026-09-24T10:15:00+06:00',
      'Karim, Sons',
      '1250.50',
      '220.00',
    ])
  })

  it('leaves a missing value empty rather than writing "null"', () => {
    const parsed = parseCsv(buildReportCsv(result()))
    expect(parsed[3]?.[2]).toBe('')
  })

  it('names the file after the report and its period', () => {
    expect(reportFilename(result(), 'csv')).toBe('sales-2026-09-01-to-2026-09-30.csv')
    expect(reportFilename(result(), 'pdf')).toBe('sales-2026-09-01-to-2026-09-30.pdf')
  })

  it('converts every money cell from minor units, and nothing else', () => {
    const rows = csvRows(result())
    expect(rows[0]?.total).toBe('1250.50')
    expect(rows[0]?.invoice_no).toBe('INV-1')
    expect(rows[0]?.profit).toBe('220.00')
  })
})

describe('report cells on screen', () => {
  it('formats money from minor units, with lakh grouping', () => {
    expect(cellText(125050, { type: 'money' })).toContain('1,250.50')
  })

  it('trims trailing zeros from quantities but keeps the fraction', () => {
    expect(cellText(17, { type: 'qty' })).toBe('17')
    expect(cellText(0.5, { type: 'qty' })).toBe('0.5')
    expect(cellText(1.25, { type: 'qty' })).toBe('1.25')
  })

  it('shows an em dash for an empty cell', () => {
    expect(cellText(null, { type: 'text' })).toBe('—')
  })

  it('formats a percentage to one decimal', () => {
    expect(cellText(22.5, { type: 'percent' })).toBe('22.5%')
  })
})
