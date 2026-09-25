/**
 * The capture card — the one piece of UI that both the sale tab and the
 * “still needs a number” list put on screen.
 *
 * It answers one question about one sale: which units left without a number,
 * and what should happen to them. Every write is a named call to the shop's
 * own server function (`capture`, `autofill`, `release`, `sync_refunds`), so
 * the card has no opinion the database does not already hold — and it re-reads
 * the sale after each write rather than guessing what changed.
 *
 * A cashier without `serial-numbers.manage` sees the same card and gets a
 * sentence back from the server instead of a disabled button they cannot
 * explain.
 */

import { badge } from '../../components/ui/card'
import { button } from '../../components/ui/button'
import { toastError, toastSuccess, toastWarning } from '../../components/feedback/toast'
import { input } from '../../components/ui/input'
import { h, mount } from '../../components/ui/h'
import { DEFAULT_INTERNAL_PREFIX } from './manifest'
import type { PluginDb } from '../../shared/registry/plugin-types'
import {
  describeError,
  missingLabel,
  reasonLabel,
  statusLabel,
  statusTone,
  type AutofillResult,
  type BoundSerial,
  type CaptureResult,
  type ReleaseResult,
  type SaleInfo,
  type SaleLine,
  type SyncResult,
} from './helpers'

export interface CaptureDeps {
  db: PluginDb
  settings: { get<T>(key: string, fallback: T): T }
  /** Called after any successful write, so a host can refresh its totals. */
  onChanged?: (() => void) | undefined
}

export interface CaptureOptions {
  /** Shown above the card — the invoice, usually. */
  title?: string | undefined
  /** Render the card without its own heading, for a list that already has one. */
  bare?: boolean | undefined
}

export function captureCard(deps: CaptureDeps, saleId: string, options: CaptureOptions = {}): HTMLElement {
  const host = h('div', { class: 'space-y-3' })
  let info: SaleInfo | null = null

  function draw(): void {
    if (!info) return
    const lines = info.lines
    const prefix = deps.settings.get<string>('internal_prefix', DEFAULT_INTERNAL_PREFIX)

    if (!info.tracked) {
      mount(
        host,
        h(
          'p',
          { class: 'text-sm text-content-muted' },
          'No serial-tracked product on this sale. Mark a product as serial-tracked on its form to start tracking its units.'
        )
      )
      return
    }

    const heading = options.bare
      ? null
      : h(
          'div',
          { class: 'flex flex-wrap items-center gap-2' },
          h('p', { class: 'text-sm font-medium text-content', text: options.title ?? 'Serial numbers' }),
          badge(missingLabel(info.missing), { tone: info.missing > 0 ? 'warning' : 'success' })
        )

    const needsWork = lines.filter((line) => line.missing > 0)
    const hasReturns = lines.some((line) => line.returned_qty > 0)

    mount(
      host,
      heading,
      ...needsWork.map((line) => lineCard(line, prefix)),
      needsWork.length > 0 ? attachForm() : null,
      needsWork.length === 0
        ? h(
            'p',
            { class: 'text-sm text-content-muted' },
            'Every unit on this sale has a number. It is on the invoice, and on the receipt as soon as it is reprinted.'
          )
        : null,
      hasReturns
        ? h(
            'div',
            { class: 'flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3' },
            h(
              'p',
              { class: 'text-xs text-content-muted' },
              'Units came back on a return. Mark the returned ones so they are not counted as sold.'
            ),
            button('Mark returned units', {
              size: 'sm',
              variant: 'secondary',
              icon: 'assignment_return',
              onClick: () => void syncRefunds(),
            })
          )
        : null
    )
  }

  function lineCard(line: SaleLine, prefix: string): HTMLElement {
    const name = line.variant_name ? `${line.product_name} — ${line.variant_name}` : line.product_name
    const chips = line.bound.map((entry) => boundChip(entry))
    const scanner = input({
      placeholder: 'Scan or type a serial number',
      leadingIcon: 'barcode',
      autocomplete: 'off',
      onEnter: (value) => void attach(value, scanner),
    })

    return h(
      'div',
      { class: 'rounded-lg border border-border bg-surface p-3 space-y-2' },
      h(
        'div',
        { class: 'flex flex-wrap items-center justify-between gap-2' },
        h(
          'div',
          { class: 'min-w-0' },
          h('p', { class: 'truncate text-sm font-medium text-content', text: name }),
          h(
            'p',
            { class: 'text-xs text-content-muted' },
            `${line.sold_units} unit(s) on the invoice · ${line.captured} recorded` +
              (line.returned_qty > 0 ? ` · ${line.returned_qty} returned` : '')
          )
        ),
        badge(missingLabel(line.missing), { tone: 'warning' })
      ),
      chips.length > 0 ? h('div', { class: 'flex flex-wrap gap-1.5' }, ...chips) : null,
      h(
        'div',
        { class: 'flex flex-wrap items-center gap-2' },
        h('div', { class: 'min-w-[12rem] flex-1' }, scanner),
        button('Attach', {
          size: 'sm',
          variant: 'primary',
          icon: 'add_link',
          onClick: () => void attach(scanner.value, scanner),
        }),
        prefix.trim() !== '' && line.missing > 0
          ? button(`Generate ${line.missing} code(s)`, {
              size: 'sm',
              variant: 'ghost',
              icon: 'auto_fix_high',
              title: `Mints ${prefix}… codes for units nobody scanned`,
              onClick: () => void autofill(),
            })
          : null
      )
    )
  }

  function boundChip(entry: BoundSerial): HTMLElement {
    const chip = h(
      'span',
      {
        class:
          'inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted pl-2 pr-1 py-0.5',
      },
      h('span', { class: 'font-mono text-xs text-content', text: entry.serial }),
      badge(statusLabel(entry.status), { tone: statusTone(entry.status) }),
      button('Release', {
        size: 'sm',
        variant: 'ghost',
        icon: 'undo',
        title: 'Put this unit back in stock (the sale stays on its history)',
        onClick: () => void release(entry),
      })
    )
    if (entry.source === 'INTERNAL') {
      chip.prepend(badge('internal', { tone: 'neutral' }))
    }
    return chip
  }

  function attachForm(): HTMLElement {
    // One box for the whole sale: the server knows which line a unit belongs
    // to from the unit's own variant, so the shopkeeper does not have to.
    const scanner = input({
      placeholder: 'Scan any unit on this sale',
      leadingIcon: 'qr_code_scanner',
      autocomplete: 'off',
      onEnter: (value) => void attach(value, scanner),
    })
    return h(
      'div',
      { class: 'flex items-center gap-2' },
      h('div', { class: 'flex-1' }, scanner),
      button('Attach', {
        size: 'sm',
        variant: 'secondary',
        icon: 'add_link',
        onClick: () => void attach(scanner.value, scanner),
      })
    )
  }

  // ── Writes ──────────────────────────────────────────────────────────────

  async function attach(value: string, control: HTMLInputElement): Promise<void> {
    const serial = value.trim()
    if (serial === '') return
    await run(async () => {
      const result = await deps.db.rpc<CaptureResult>('capture', { sale_id: saleId, serials: [serial] })
      control.value = ''
      if (result.captured > 0) {
        toastSuccess(`${serial} attached to ${info?.sale.invoice_no ?? 'this sale'}.`)
        return true
      }
      const refusal = result.refusals[0]
      toastWarning(refusal ? `${refusal.serial}: ${reasonLabel(refusal.reason)}` : 'Nothing was attached.')
      return false
    }, 'capture')
  }

  async function autofill(): Promise<void> {
    await run(async () => {
      const result = await deps.db.rpc<AutofillResult>('autofill', { sale_id: saleId })
      if (result.created > 0) {
        toastSuccess(`${result.created} internal code(s) created, starting at ${result.serials[0]?.serial ?? ''}.`)
      } else {
        toastWarning('Nothing was left to generate.')
      }
      return result.created > 0
    }, 'autofill')
  }

  async function release(entry: BoundSerial): Promise<void> {
    await run(async () => {
      const result = await deps.db.rpc<ReleaseResult>('release', { ids: [entry.id] })
      const row = result.rows.find((candidate) => candidate.serial === entry.serial)
      if (result.released > 0) {
        toastSuccess(`${entry.serial} is back in stock.`)
        return true
      }
      toastWarning(`${entry.serial}: ${reasonLabel(row?.reason ?? 'nothing_to_do')}`)
      return false
    }, 'release')
  }

  async function syncRefunds(): Promise<void> {
    await run(async () => {
      const result = await deps.db.rpc<SyncResult>('sync_refunds', { sale_id: saleId })
      toastSuccess(
        result.marked === 0
          ? 'Nothing to mark — every returned unit is accounted for.'
          : `${result.marked} unit(s) marked as returned.`
      )
      return true
    }, 'sync_refunds')
  }

  /** Re-reads the sale after a write, so the card never shows a guess. */
  async function run(action: () => Promise<boolean>, what: string): Promise<void> {
    try {
      const changed = await action()
      if (changed) {
        await load()
        deps.onChanged?.()
      }
    } catch (error) {
      const message = describeError(error)
      console.error(`[serial-numbers] ${what} failed`, error)
      toastError(`Serial numbers: ${message}`)
    }
  }

  async function load(): Promise<void> {
    try {
      info = await deps.db.rpc<SaleInfo>('for_sale', { sale_id: saleId })
      draw()
    } catch (error) {
      mount(
        host,
        h('p', { class: 'text-sm text-danger' }, `Serial numbers could not be read: ${describeError(error)}`)
      )
    }
  }

  mount(host, h('p', { class: 'text-sm text-content-muted' }, 'Reading serial numbers…'))
  void load()

  return host
}
