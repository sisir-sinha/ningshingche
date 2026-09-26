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

  it('does not let the outer box widen past its parent', () => {
    const el = dataTable({ columns: COLUMNS, rows: ROWS, currency: 'BDT' })
    expect(el.className).toContain('min-w-0')
  })
})
