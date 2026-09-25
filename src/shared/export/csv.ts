/**
 * CSV (spec §23, §68).
 *
 * Written by hand rather than pulled in as a dependency, because the format is
 * small and the failure mode of getting it wrong is silent: a customer name
 * containing a comma shifts every column, and the shopkeeper who re-imports
 * the file gets a name in the amount column and blames the software.
 *
 * So: RFC 4180 quoting (quote when the field contains a comma, a quote or a
 * line break; double the quotes inside), CRLF row endings, and a UTF-8 BOM
 * option for the one case that needs it — Excel on Windows, which otherwise
 * reads a ৳ sign as mojibake. The parser here is the counterpart used by the
 * tests and by the import path, so an export/import round trip is checked
 * rather than assumed.
 */

export type CsvValue = string | number | boolean | null | undefined

export interface CsvColumn {
  key: string
  label: string
}

export interface CsvOptions {
  /** Prepend a UTF-8 BOM so Excel reads non-ASCII currency symbols. */
  bom?: boolean
  /** Row separator; the default is the RFC's CRLF. */
  eol?: '\r\n' | '\n'
}

/**
 * One field, quoted only when it must be.
 *
 * Numbers are written as plain decimal text — `1234.5`, never `1,234.50` — so
 * that a spreadsheet and a re-import both see a number. Formatting for the
 * eye belongs on the screen.
 */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  const raw = typeof value === 'number' ? numberToPlain(value) : String(value)
  if (!/[",\r\n]/.test(raw)) return raw
  return `"${raw.replace(/"/g, '""')}"`
}

/** 1.1e21 and 0.30000000000000004 both need to survive as written text. */
function numberToPlain(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value)
  return String(Number(value.toFixed(10)))
}

/**
 * Rows to CSV text.
 *
 * The header is the columns' labels, not their keys: the file is read by a
 * person, and "Invoice" is a better first cell than "invoice_no".
 */
export function toCsv(
  columns: readonly CsvColumn[],
  rows: readonly Record<string, CsvValue>[],
  options: CsvOptions = {}
): string {
  const eol = options.eol ?? '\r\n'
  const lines: string[] = []
  lines.push(columns.map((column) => csvField(column.label)).join(','))
  for (const row of rows) {
    lines.push(columns.map((column) => csvField(row[column.key])).join(','))
  }
  return (options.bom ? '\uFEFF' : '') + lines.join(eol) + eol
}

/**
 * CSV text back to rows.
 *
 * A small state machine, not `split(',')`, so quoted fields containing commas
 * or newlines survive the trip. Returns arrays of strings, in file order,
 * including the header row — which is what a re-import needs to compare row
 * counts against what was exported.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0

  const source = text.startsWith('\uFEFF') ? text.slice(1) : text

  while (index < source.length) {
    const char = source[index] as string

    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }

    if (char === '"') {
      quoted = true
      index += 1
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      index += 1
      continue
    }
    if (char === '\r' || char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      index += char === '\r' && source[index + 1] === '\n' ? 2 : 1
      continue
    }
    field += char
    index += 1
  }

  // A trailing newline must not create a phantom empty row — that is exactly
  // the off-by-one that makes "re-import to identical row counts" fail.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/** Rows parsed from a CSV string, minus the header. */
export function csvRowCount(text: string): number {
  return Math.max(0, parseCsv(text).length - 1)
}

/**
 * A filename that sorts and reads well: `sales-2026-09-25.csv`.
 *
 * Microseconds and a random suffix are deliberately absent — a shopkeeper
 * emailing two exports of the same report wants to tell them apart by their
 * date range, and the report period is already in the name.
 */
export function csvFilename(reportKey: string, label: string): string {
  const safe = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${reportKey}-${safe || 'export'}.csv`
}
