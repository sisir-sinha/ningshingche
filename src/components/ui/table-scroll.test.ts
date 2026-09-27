/**
 * A wide table scrolls itself, not the app.
 *
 * Once the pages stopped owning inner scroll containers, a table wider than
 * the viewport had nothing to be clipped by, so it pushed the whole layout
 * sideways: the scrollbar existed, it was just on the wrong element, and the
 * top bar and sidebar went with it.
 *
 * Two classes fix it and both are load-bearing — `overflow-x-auto` on the box
 * around the table, and `min-w-0` on the box itself, because a flex or grid
 * child defaults to `min-width: auto` and will not become narrower than its
 * content no matter what overflow says.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest'
import { dataTable } from './table'

import type { ReportColumn } from '../../shared/repositories/contracts'

const COLUMNS: ReportColumn[] = [
  { key: 'name', label: 'Product', type: 'text' },
  { key: 'qty', label: 'Qty', type: 'int', align: 'right' },
  { key: 'total', label: 'Total', type: 'money', align: 'right' },
]

const ROWS = [
  { name: 'Miniket Rice 5kg', qty: 3, total: 135000 },
  { name: 'Soybean Oil 1L', qty: 2, total: 36000 },
]

describe('the reusable table', () => {
  it('puts the table in a box that scrolls sideways', () => {
    const el = dataTable({ columns: COLUMNS, rows: ROWS, currency: 'BDT' })
    const table = el.querySelector('table')!
    const box = table.parentElement!

    expect(box.className).toContain('overflow-x-auto')
    // Without this the page widens instead of the box scrolling.
    expect(box.className).toContain('min-w-0')
  })

  it('keeps the totals row inside the table, so it scrolls with the columns', () => {
    const el = dataTable({
      columns: COLUMNS,
      rows: ROWS,
      currency: 'BDT',
      totals: { total: 171000 },
    })

    const foot = el.querySelector('tfoot')
    expect(foot).not.toBeNull()
    // It used to be a sibling of the scroller: a wide table slid sideways
    // underneath a total that stayed put, and the figures stopped lining up
    // with the columns they belonged to.
    expect(foot!.closest('table')).not.toBeNull()
  })

  /**
   * Column widths follow the content.
   *
   * `w-full` on the table made every column a share of the screen rather than
   * a fit to what was in it: the same report looked different on a laptop and
   * a tablet, and a one-word status column was handed as much room as a
   * product name. `w-max` sizes to the content; `min-w-full` still fills the
   * box when there is less content than screen.
   */
  it('sizes its columns to their content, not to the screen', () => {
    const el = dataTable({ columns: COLUMNS, rows: ROWS, currency: 'BDT' })
    const table = el.querySelector('table')!

    expect(table.className).toContain('w-max')
    expect(table.className).toContain('min-w-full')
    expect(table.className).toContain('table-auto')
    // `w-full` would pin the table to the box and share the slack out again.
    expect(table.className.split(/\s+/)).not.toContain('w-full')
  })

  it('does not let the outer box widen past its parent', () => {
    const el = dataTable({ columns: COLUMNS, rows: ROWS, currency: 'BDT' })
    expect(el.className).toContain('min-w-0')
  })
})
