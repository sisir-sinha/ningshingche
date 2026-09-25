/**
 * Warranty — the card that decorates one sale.
 *
 * It answers the three questions a shop asks about a finished sale, in the
 * order they are asked:
 *
 *   1. What did this sale promise? — the lines, with the months each one
 *      carries, because a promise the shop cannot see is a promise it will
 *      forget.
 *   2. Did the promise get written down? — the units on record, and the ones
 *      still missing, with the button that writes them.
 *   3. What has happened since? — an expired promise, a unit in the workshop,
 *      a unit nobody has named, and the slip that goes home with the customer.
 *
 * The same component is used by the sale tab in the core and by the work queue
 * on the Warranty screen: one implementation, so the two can never disagree
 * about what a sale owes.
 */

import { badge } from '../../components/ui/card'
import { button, spinner } from '../../components/ui/button'
import { field, input } from '../../components/ui/input'
import { modal } from '../../components/feedback/modal'
import { toastError, toastSuccess, toastWarning } from '../../components/feedback/toast'
import { h, mount } from '../../components/ui/h'
import type { PluginDb, PluginSettings } from '../../shared/registry/plugin-types'
import {
  certificate,
  claimStatusLabel,
  claimTone,
  coverageLabel,
  coverageOf,
  coverageTone,
  costToMinor,
  daysLeftLabel,
  describeError,
  missingCoverLabel,
  monthsLabel,
  nextClaimStatuses,
  unitLabel,
  type OpenClaimResult,
  type ClaimMoveResult,
  type RegisterResult,
  type SaleCover,
  type UnitRow,
  type VoidResult,
} from './helpers'
import {
  AUTO_REGISTER_KEY,
  DEFAULT_AUTO_REGISTER,
  DEFAULT_CLAIM_PREFIX,
  DEFAULT_WARN_DAYS,
  WARN_DAYS_KEY,
} from './manifest'

export interface CoverDeps {
  db: PluginDb
  settings: PluginSettings
  currency: string
}

export interface CoverOptions {
  /** Drop the heading when a card around it already carries one. */
  bare?: boolean
  title?: string
  /** Called after anything changes, so a screen can refresh its counters. */
  onChange?: () => void
}

/** Opens a print window with the certificate, or says why it could not. */
export function printCertificate(html: string): void {
  const opened = window.open('', '_blank')
  if (!opened) {
    // A blocked pop-up must not silently lose the slip.
    navigator.clipboard?.writeText(html).then(
      () => toastSuccess('The print window was blocked, so the certificate was copied to the clipboard.'),
      () => toastError('The print window was blocked. Allow pop-ups for this site and try again.')
    )
    return
  }
  opened.document.write(html)
  opened.document.close()
  opened.focus()
}

export function certificateFor(row: UnitRow, shopTerms?: string | null): string {
  return certificate({
    terms: row.terms ?? shopTerms ?? null,
    product: row.product_name,
    variant: row.variant_name,
    unit: row.unit_label,
    months: row.months,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    invoice_no: row.invoice_no,
    customer: row.customer,
    claim_no: row.claim?.claim_no ?? null,
  })
}

export function coverCard(deps: CoverDeps, saleId: string, options: CoverOptions = {}): HTMLElement {
  const host = h('div', { class: 'space-y-3' })
  let info: SaleCover | null = null
  let busy = false
  /** The unit whose label is being typed, so a redraw does not lose the caret. */
  let naming: string | null = null

  const warnDays = (): number =>
    deps.settings.get<number>(WARN_DAYS_KEY, DEFAULT_WARN_DAYS) || DEFAULT_WARN_DAYS

  async function refresh(): Promise<void> {
    try {
      info = await deps.db.rpc<SaleCover>('for_sale', { sale_id: saleId })
    } catch (error) {
      mount(
        host,
        h('p', { class: 'text-sm text-content-muted', text: describeError(error) })
      )
      return
    }
    draw()
  }

  async function act(work: () => Promise<string | null>): Promise<void> {
    if (busy) return
    busy = true
    draw()
    try {
      const message = await work()
      if (message) toastSuccess(message)
      await refresh()
      options.onChange?.()
    } catch (error) {
      toastError(describeError(error))
    } finally {
      busy = false
      draw()
    }
  }

  function register(): void {
    void act(async () => {
      const result = await deps.db.rpc<RegisterResult>('register', { sale_id: saleId })
      if (result.created === 0) {
        return result.existing > 0
          ? 'Every unit on this sale already has its promise on record.'
          : 'Nothing on this sale carries warranty cover.'
      }
      return `${result.created} unit${result.created === 1 ? '' : 's'} promised until ${result.units[0]?.ends_on ?? ''}.`
    })
  }

  function openClaim(row: UnitRow): void {
    const issue = input({ placeholder: 'What is wrong with it?', autofocus: true })
    const cost = input({ type: 'text', placeholder: '0.00', inputmode: 'decimal' })
    const dialog = modal({
      title: `Open a claim — ${row.product_name}`,
      subtitle: `${unitLabel(row)} · covered until ${row.ends_on}`,
      iconName: 'build',
      footer: [
        button('Cancel', { variant: 'ghost', onClick: () => dialog.close() }),
        button('Open claim', {
          icon: 'assignment_add',
          onClick: () => {
            const minorCost = cost.value.trim() === '' ? 0 : costToMinor(cost.value)
            if (minorCost === null) {
              toastWarning('Enter the amount spent so far as a number, or leave it empty.')
              return
            }
            dialog.close()
            void act(async () => {
              const result = await deps.db.rpc<OpenClaimResult>('open_claim', {
                warranty_id: row.id,
                issue: issue.value.trim(),
                cost_minor: minorCost,
              })
              return `Claim ${result.claim_no} opened.`
            })
          },
        }),
      ],
    })

    mount(
      dialog.body,
      h(
        'div',
        { class: 'space-y-4' },
        field('What the customer reported', issue, {
          hint: 'Goes on the slip, so whoever does the work knows what to look for.',
        }),
        field('Cost so far', cost, {
          hint: `Optional. Leave empty until the workshop has quoted — this is what the claim cost the shop, in ${deps.currency}.`,
        })
      )
    )
  }

  function moveClaim(row: UnitRow): void {
    const claim = row.claim
    if (!claim) return
    const resolution = input({ placeholder: 'What was done?', autofocus: true })
    const cost = input({ type: 'text', value: (claim.cost_minor / 100).toFixed(2), inputmode: 'decimal' })
    const steps = nextClaimStatuses(claim.status)
    const dialog = modal({
      title: `Claim ${claim.claim_no}`,
      subtitle: `${row.product_name} · ${unitLabel(row)}`,
      iconName: 'assignment',
      footer: [
        button('Close', { variant: 'ghost', onClick: () => dialog.close() }),
        ...steps.map((status) =>
          button(status === 'REPLACED' ? 'Replaced' : status === 'REJECTED' ? 'Refuse' : status === 'CLOSED' ? 'Finish' : status === 'REPAIRING' ? 'To workshop' : 'Approve', {
            variant: status === 'REJECTED' ? 'danger' : status === 'REPLACED' ? 'success' : 'secondary',
            size: 'sm',
            onClick: () => {
              const parsed = costToMinor(cost.value)
              if (parsed === null) {
                toastWarning('Enter the cost as a number.')
                return
              }
              dialog.close()
              void act(async () => {
                const result = await deps.db.rpc<ClaimMoveResult>('claim', {
                  claim_id: claim.id,
                  status,
                  resolution: resolution.value.trim(),
                  cost_minor: parsed,
                })
                return `Claim ${result.claim_no} is now ${claimStatusLabel(result.status).toLowerCase()}.`
              })
            },
          })
        ),
      ],
    })

    mount(
      dialog.body,
      h(
        'div',
        { class: 'space-y-4' },
        h(
          'div',
          { class: 'flex flex-wrap items-center gap-2' },
          badge(claimStatusLabel(claim.status), { tone: claimTone(claim.status) }),
          h('p', { class: 'text-xs text-content-muted', text: `Opened ${claim.opened_on}` })
        ),
        claim.issue
          ? h('p', { class: 'text-sm text-content', text: `Reported: ${claim.issue}` })
          : null,
        field('What was done', resolution, { hint: 'Kept on the slip for whoever reads it next.' }),
        field('Cost to the shop', cost, { hint: `In ${deps.currency}. The claim reports total this.` })
      )
    )
  }

  function voidCover(row: UnitRow): void {
    const reason = input({ placeholder: 'Refunded in full, goodwill replacement…', autofocus: true })
    const dialog = modal({
      title: `Drop the cover — ${row.product_name}`,
      subtitle: `${unitLabel(row)} · covered until ${row.ends_on}`,
      iconName: 'block',
      size: 'sm',
      footer: [
        button('Keep it', { variant: 'ghost', onClick: () => dialog.close() }),
        button('Drop cover', {
          variant: 'danger',
          onClick: () => {
            if (reason.value.trim() === '') {
              toastWarning('Say why the cover is being dropped.')
              return
            }
            dialog.close()
            void act(async () => {
              const result = await deps.db.rpc<VoidResult>('void', {
                warranty_id: row.id,
                reason: reason.value.trim(),
              })
              return result.already_void
                ? 'That cover had already been dropped.'
                : 'Cover dropped. The record stays in the register.'
            })
          },
        }),
      ],
    })
    mount(
      dialog.body,
      h(
        'div',
        { class: 'space-y-3' },
        h(
          'p',
          { class: 'text-sm text-content-muted' },
          'The promise is not deleted — a shop that dropped one last March may have to prove it. It stops counting as cover and stops appearing in the expiring report.'
        ),
        field('Why', reason)
      )
    )
  }

  function saveLabel(row: UnitRow, control: HTMLInputElement): void {
    const value = control.value.trim()
    void act(async () => {
      await deps.db.rpc('label', { warranty_id: row.id, unit_label: value })
      naming = null
      return value === '' ? 'Unit number cleared.' : `Unit is now ${value}.`
    })
  }

  function unitsTable(rows: readonly UnitRow[]): HTMLElement {
    return h(
      'div',
      { class: 'divide-y divide-border' },
      ...rows.map((row) => {
        const coverage = coverageOf(row, warnDays())
        const actions: HTMLElement[] = []

        if (naming === row.id) {
          const control = input({
            value: row.unit_label ?? '',
            placeholder: 'IMEI, case number, plate…',
            autofocus: true,
            onEnter: (value, el) => {
              el.value = value
              saveLabel(row, el)
            },
          })
          actions.push(
            h(
              'div',
              { class: 'flex items-center gap-2' },
              h('div', { class: 'w-44' }, control),
              button('Save', { size: 'sm', variant: 'secondary', onClick: () => saveLabel(row, control) }),
              button('Cancel', {
                size: 'sm',
                variant: 'ghost',
                onClick: () => {
                  naming = null
                  draw()
                },
              })
            )
          )
        } else {
          actions.push(
            button(row.unit_label ? 'Rename unit' : 'Name unit', {
              size: 'sm',
              variant: 'ghost',
              icon: 'edit',
              onClick: () => {
                naming = row.id
                draw()
              },
            })
          )
        }

        if (row.status === 'ACTIVE') {
          if (row.claim) {
            actions.push(
              button('Work the claim', {
                size: 'sm',
                variant: 'secondary',
                icon: 'assignment',
                onClick: () => moveClaim(row),
              })
            )
          } else {
            actions.push(
              button('Open claim', {
                size: 'sm',
                variant: 'secondary',
                icon: 'build',
                onClick: () => openClaim(row),
              })
            )
          }
          actions.push(
            button('Drop cover', {
              size: 'sm',
              variant: 'ghost',
              icon: 'block',
              onClick: () => voidCover(row),
            })
          )
        }

        actions.push(
          button('Certificate', {
            size: 'sm',
            variant: 'ghost',
            icon: 'print',
            onClick: () => printCertificate(certificateFor(row)),
          })
        )

        return h(
          'div',
          { class: 'flex flex-wrap items-start justify-between gap-2 py-3' },
          h(
            'div',
            { class: 'min-w-0 space-y-1' },
            h(
              'div',
              { class: 'flex flex-wrap items-center gap-2' },
              h('span', { class: 'font-medium text-content', text: unitLabel(row) }),
              badge(coverageLabel(coverage), { tone: coverageTone(coverage) }),
              h('span', { class: 'text-xs text-content-muted', text: monthsLabel(row.months) })
            ),
            h(
              'p',
              { class: 'text-xs text-content-muted' },
              `${row.starts_on} → ${row.ends_on} · ${daysLeftLabel(row.days_left)}` +
                (row.status === 'VOID' && row.void_reason ? ` · dropped: ${row.void_reason}` : '') +
                (row.claim ? ` · claim ${row.claim.claim_no} (${claimStatusLabel(row.claim.status)})` : '')
            )
          ),
          h('div', { class: 'flex flex-wrap items-center gap-1' }, ...actions)
        )
      })
    )
  }

  function draw(): void {
    if (!info) {
      mount(host, h('div', { class: 'flex items-center gap-2 text-sm text-content-muted' }, spinner(), h('span', { text: 'Reading the promises…' })))
      return
    }

    const auto = deps.settings.get<boolean>(AUTO_REGISTER_KEY, DEFAULT_AUTO_REGISTER)
    const covered = info.lines.filter((line) => line.months !== null || line.registered > 0)
    const sold = ['COMPLETED', 'PARTIALLY_PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(info.sale.status)

    const head = options.bare
      ? null
      : h(
          'div',
          { class: 'flex flex-wrap items-center justify-between gap-2' },
          h(
            'div',
            { class: 'flex flex-wrap items-center gap-2' },
            h('p', { class: 'text-sm font-medium text-content', text: options.title ?? 'Warranty' }),
            badge(missingCoverLabel(info.missing), { tone: info.missing > 0 ? 'warning' : 'success' })
          ),
          h(
            'div',
            { class: 'flex flex-wrap items-center gap-1' },
            info.missing > 0
              ? button(auto ? 'Write the promises' : 'Register cover', {
                  size: 'sm',
                  variant: 'primary',
                  icon: 'verified_user',
                  onClick: register,
                })
              : null,
            info.units.length > 0
              ? button('Print all certificates', {
                  size: 'sm',
                  variant: 'ghost',
                  icon: 'print',
                  onClick: () => {
                    const printable = info?.units[0]
                    if (printable) printCertificate(certificateFor(printable))
                  },
                })
              : null
          )
        )

    if (!sold) {
      mount(
        host,
        head,
        h(
          'p',
          { class: 'text-sm text-content-muted' },
          'This sale is not finished, so it has promised nothing yet. Cover is written once the goods are sold.'
        )
      )
      return
    }

    mount(
      host,
      head,
      h(
        'p',
        { class: 'text-xs text-content-muted' },
        `${info.sale.invoice_no ?? 'sale'} · ${info.sale.sold_on ?? ''}${
          info.sale.customer ? ` · ${info.sale.customer}` : ''
        }`
      ),
      covered.length === 0
        ? h(
            'p',
            { class: 'text-sm text-content-muted' },
            'Nothing on this sale carries warranty cover. Put warranty months on the product to promise one.'
          )
        : h(
            'div',
            { class: 'space-y-1' },
            ...covered.map((line) =>
              h(
                'div',
                { class: 'flex flex-wrap items-center justify-between gap-2 text-sm' },
                h(
                  'span',
                  { class: 'text-content' },
                  line.variant_name ? `${line.product_name} — ${line.variant_name}` : line.product_name
                ),
                h(
                  'span',
                  { class: 'text-xs text-content-muted' },
                  `${line.sold_units} unit${line.sold_units === 1 ? '' : 's'} · ${
                    line.months === null ? 'shop default' : monthsLabel(line.months)
                  } · ${line.registered} on record${line.missing > 0 ? ` · ${line.missing} missing` : ''}`
                )
              )
            )
          ),
      info.units.length > 0 ? unitsTable(info.units) : null,
      info.missing > 0 && !auto
        ? h(
            'p',
            { class: 'text-xs text-content-warning' },
            'Promises are not written automatically for this shop — press ‘Register cover’ when the sale is done.'
          )
        : null
    )
  }

  void refresh()
  return host
}

/** The claim prefix, for a screen that wants to name the next slip. */
export function claimPrefix(settings: PluginSettings): string {
  return settings.get<string>('claim_prefix', DEFAULT_CLAIM_PREFIX) || DEFAULT_CLAIM_PREFIX
}
