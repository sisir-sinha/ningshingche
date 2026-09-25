/**
 * Exporting a report: CSV, print and PDF (spec §23, §68).
 *
 * The export reads the *same* `ReportResult` the table is rendered from — same
 * rows, same columns, same order — so the file cannot disagree with the screen.
 * That is the whole reason this module takes a result rather than a query: a
 * second fetch could see a sale that arrived in between.
 *
 * Two deliberate choices:
 *
 *   The CSV has no totals row. A totals row in a data file is a row that is
 *   not data, and it breaks the round trip this phase is measured on: export,
 *   re-import, same row count. Totals live on screen and on the printed page.
 *
 *   The CSV is the *whole* filtered set, not the visible page — the caller
 *   fetches it with a large limit before calling in, because a shopkeeper who
 *   filters to August and exports expects August, not the first 25 rows of it.
 */

import { toCsv, type CsvColumn } from '../../shared/export/csv'
import { downloadText, printDocument, printStyles, escapeHtml } from '../../shared/export/download'
import { cellText, formatWhen } from '../../components/ui/table'
import { minor, minorToFixed } from '../../shared/domain/money'
import type { ReportResult } from '../../shared/repositories/contracts'
import type { DownloadResult, PrintResult } from '../../shared/export/download'

/** `sales-2026-09-01-2026-09-25.csv` — the range is the useful part. */
export function reportFilename(result: ReportResult, extension: string): string {
  const from = result.from.slice(0, 10)
  const to = result.to.slice(0, 10)
  return `${result.key}-${from}-to-${to}.${extension}`
}

/**
 * Money leaves as a plain decimal with two places — `1234.50`, never
 * `৳1,234.50` — so a spreadsheet reads a number and a re-import round-trips
 * exactly.
 */
export function csvRows(result: ReportResult): Record<string, string | number | null>[] {
  return result.rows.map((row) => {
    const converted: Record<string, string | number | null> = {}
    for (const column of result.columns) {
      const value = row[column.key] ?? null
      if (value === null) {
        converted[column.key] = null
      } else if (column.type === 'money') {
        // `minorToFixed` writes 125000 as "1250.00": a number a spreadsheet
        // reads as a number, and the same one the screen shows.
        converted[column.key] = minorToFixed(minor(Math.trunc(Number(value))))
      } else if (column.type === 'date') {
        converted[column.key] = String(value)
      } else if (column.type === 'int' || column.type === 'qty' || column.type === 'percent') {
        converted[column.key] = Number(value)
      } else {
        converted[column.key] = String(value)
      }
    }
    return converted
  })
}

export function buildReportCsv(result: ReportResult): string {
  const columns: CsvColumn[] = result.columns.map((column) => ({
    key: column.key,
    label: column.label,
  }))
  return toCsv(columns, csvRows(result), { bom: true })
}

/** Writes the CSV and reports whether the device actually saved it. */
export function exportReportCsv(result: ReportResult): DownloadResult {
  return downloadText(reportFilename(result, 'csv'), buildReportCsv(result), 'text/csv')
}

/**
 * The printable document: title, the filters that produced it, the table, the
 * totals row and a footer. Self-contained — no stylesheet links, because it is
 * written into a blank window that has none.
 */
export function buildReportHtml(result: ReportResult): string {
  const header = result.columns
    .map(
      (column) =>
        `<th class="${column.align === 'right' ? 'num' : ''}">${escapeHtml(column.label)}</th>`
    )
    .join('')

  const body = result.rows
    .map(
      (row) =>
        `<tr>${result.columns
          .map((column) => {
            const value = row[column.key] ?? null
            const text = cellText(value, column, result.currency)
            return `<td class="${column.align === 'right' ? 'num' : ''}">${escapeHtml(text)}</td>`
          })
          .join('')}</tr>`
    )
    .join('')

  const totals = Object.keys(result.totals).length
    ? `<tfoot><tr>${result.columns
        .map((column) => {
          const total = result.totals[column.key]
          const text = total === undefined ? '' : cellText(total, column, result.currency)
          return `<td class="${column.align === 'right' ? 'num' : ''}">${escapeHtml(text)}</td>`
        })
        .join('')}</tr></tfoot>`
    : ''

  const filters = [
    `Period: ${escapeHtml(result.label)}`,
    result.search ? `Search: “${escapeHtml(result.search)}”` : null,
    `Rows: ${result.totalRows}`,
    `Sorted by ${escapeHtml(result.sort)} ${result.dir}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(result.title)}</title>
<style>${printStyles()}</style></head>
<body>
  <h1>${escapeHtml(result.title)}</h1>
  <p class="meta">${escapeHtml(result.description)}</p>
  <p class="meta">${filters}</p>
  <table><thead><tr>${header}</tr></thead><tbody>${body}</tbody>${totals}</table>
  <p class="footer">Mekholi · ${escapeHtml(result.title)} · ${escapeHtml(filters)} · printed ${escapeHtml(
    formatWhen(new Date().toISOString())
  )}</p>
</body></html>`
}

/** Opens the print dialog. The waitress keeps it; the owner files it. */
export function printReport(result: ReportResult): PrintResult {
  return printDocument(buildReportHtml(result), `${result.title} — ${result.label}`, true)
}

/**
 * "PDF" is the browser's Save-as-PDF, reached through the same print dialog.
 *
 * The document carries the report's own title so the suggested filename is the
 * report rather than "document.pdf". Shipping a PDF writer to produce a file
 * whose numbers cannot be copied out of it would be a worse answer.
 */
export function exportReportPdf(result: ReportResult): PrintResult {
  return printDocument(buildReportHtml(result), reportFilename(result, 'pdf'), true)
}
