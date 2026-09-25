/**
 * Getting a file out of the browser, and getting a report onto paper (§23).
 *
 * Both paths exist on every device the POS runs on — a shop tablet with no
 * printer, the owner's laptop, an Android WebView — and they fail differently:
 *
 *   A download needs a Blob URL and a synthetic click. In a WebView with no
 *   download manager nothing happens, so the caller is told whether the anchor
 *   was actually clicked and can offer "copy to clipboard" as a fallback.
 *
 *   Printing needs a window with the report already laid out. We open a blank
 *   window and write into it rather than rendering a hidden iframe, because an
 *   iframe prints the whole page around it in some browsers and only the
 *   iframe in others. When a popup is blocked — common on phones — we say so
 *   instead of silently doing nothing.
 *
 * PDF is the browser's own "Save as PDF", reached through the same print
 * dialog. Calling it what it is beats shipping a PDF writer to produce a file
 * whose text cannot be selected.
 */

export interface DownloadResult {
  ok: boolean
  /** Why not, when `ok` is false — shown to the user, not logged. */
  reason?: string
}

/** Triggers a download of `content` as `filename`. */
export function downloadText(filename: string, content: string, mime = 'text/csv'): DownloadResult {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { ok: false, reason: 'This device cannot save files from the browser.' }
  }

  try {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    // Revoking immediately can cancel the download in Safari; a tick is enough.
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
      anchor.remove()
    }, 1000)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'The file could not be saved.' }
  }
}

export interface PrintResult {
  ok: boolean
  reason?: string
}

/**
 * Opens a print preview for a self-contained HTML document.
 *
 * `title` becomes the suggested filename in the Save-as-PDF dialog, which is
 * why the caller passes the same name the CSV would use.
 */
export function printDocument(html: string, title: string, autoPrint = true): PrintResult {
  if (typeof window === 'undefined') return { ok: false, reason: 'Printing is unavailable here.' }

  const win = window.open('', '_blank', 'width=1024,height=768')
  if (!win) {
    return { ok: false, reason: 'The browser blocked the print window — allow pop-ups for this site.' }
  }

  win.document.open()
  win.document.write(html)
  win.document.close()
  win.document.title = title

  if (autoPrint) {
    // The new window needs its layout before it can paginate.
    win.setTimeout(() => {
      win.focus()
      win.print()
    }, 250)
  }
  return { ok: true }
}

/**
 * The print stylesheet, inlined into the printed document.
 *
 * A report is a table of numbers: it wants small type, tight rows, a repeating
 * header and a footer that says when it was printed and for which period. The
 * app's own palette is irrelevant on paper, so this is plain black on white.
 */
export function printStyles(): string {
  return `
  * { box-sizing: border-box; }
  body { font: 11px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 18px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .meta { color: #555; font-size: 10px; margin-bottom: 10px; }
  table { border-collapse: collapse; width: 100%; }
  thead th { text-align: left; border-bottom: 1px solid #999; padding: 4px 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; color: #444; }
  tbody td { padding: 3px 6px; border-bottom: 1px solid #eee; }
  tfoot td { padding: 5px 6px; border-top: 1px solid #999; font-weight: 700; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  .footer { margin-top: 10px; color: #666; font-size: 9px; border-top: 1px solid #ddd; padding-top: 6px; }
  @page { margin: 12mm; }
`
}

/** HTML-escapes a cell for the printed document. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
