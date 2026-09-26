/**
 * Loyalty — the register behind the sidebar item.
 *
 * A shopkeeper opens this to answer one of three questions, and the screen is
 * built around them in that order:
 *
 *   * *"Who are my regulars, and what do I owe them?"* — the member list, with
 *     what each balance is worth in money, because a points number alone is not
 *     a number a shop can act on.
 *   * *"What happened to Rahim's points?"* — one customer's ledger, every row
 *     naming the invoice it came from. Nothing here is a running total that
 *     cannot be defended; the balance is literally the sum of the rows shown.
 *   * *"Someone gave the wrong points."* — a correction with a reason, and the
 *     redemptions that never found an invoice, which are the only points the
 *     shop can still give back.
 *
 * The rules live where they belong: the three numbers are the plugin's settings
 * (rendered by the core in Settings → Plugins, so a shop that never opens this
 * screen can still set them), and the *tier ladder* is on the screen beside the
 * register it describes — a list of rows with three fields is not something a
 * settings form can render honestly.
 */

import { badge, card, cardHeader, emptyState, panel, skeleton, stat } from '../../components/ui/card'
import { button, iconButton } from '../../components/ui/button'
import { field, input } from '../../components/ui/input'
import { h, mount } from '../../components/ui/h'
import { confirm } from '../../components/feedback/modal'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { formatMoney, minor } from '../../shared/domain/money'
import type {
  PluginDb,
  PluginPageContext,
  PluginPageModule,
  PluginSettings,
} from '../../shared/registry/plugin-types'
import {
  DEFAULT_MIN_REDEEM,
  DEFAULT_POINTS_PER_CURRENCY,
  DEFAULT_REDEEM_RATE,
  MIN_REDEEM_KEY,
  POINTS_PER_CURRENCY_KEY,
  REDEEM_RATE_KEY,
} from './manifest'
import {
  DEFAULT_TIERS,
  formatPoints,
  ledgerLabel,
  moneyFor,
  normaliseTiers,
  ruleFrom,
  TIERS_KEY,
  tierFor,
  wholePoints,
  type AccountRecord,
  type LedgerEntryRecord,
  type LoyaltyRule,
  type LoyaltyTier,
  type MemberPage,
  type MemberRecord,
} from './helpers'

export interface ScreenDeps {
  settings: PluginSettings
  db: PluginDb
}

interface Overview {
  members: number
  active_month: number
  points_out: number
  value_minor: number
  earned_month: number
  month_label: string
  open_reservations: number
  drift: number
}

export function createLoyaltyScreen(deps: ScreenDeps): PluginPageModule {
  return {
    render: async (context: PluginPageContext): Promise<HTMLElement> => {
      const root = h('div', { class: 'space-y-4 p-4' })
      const headerHost = h('div')
      const glanceHost = h('div', { class: 'grid gap-3 sm:grid-cols-3' })
      const listHost = h('div')
      const detailHost = h('div')

      let search = ''
      let members: MemberRecord[] = []
      let total = 0
      let selected: string | null = null
      let ladderOpen = false
      let busy = true

      /** The shop's rule, as the SQL and the till both read it. */
      const rule = (): LoyaltyRule =>
        ruleFrom(
          deps.settings.get<number>(POINTS_PER_CURRENCY_KEY, DEFAULT_POINTS_PER_CURRENCY),
          deps.settings.get<number>(REDEEM_RATE_KEY, DEFAULT_REDEEM_RATE),
          deps.settings.get<number>(MIN_REDEEM_KEY, DEFAULT_MIN_REDEEM),
          deps.settings.get<LoyaltyTier[]>(TIERS_KEY, [...DEFAULT_TIERS])
        )

      const ladder = (): LoyaltyTier[] =>
        normaliseTiers(deps.settings.get<LoyaltyTier[]>(TIERS_KEY, [...DEFAULT_TIERS]))

      const money = (value: number): string =>
        formatMoney(minor(value), { currency: context.currency })

      // ── The shop at a glance ────────────────────────────────────────────
      function renderHeader(): void {
        mount(
          headerHost,
          cardHeader('Loyalty', {
            subtitle:
              'Points a customer has earned on completed sales. A walk-in earns nothing — attach a customer at the till.',
            iconName: 'card_membership',
            actions: [
              button('Tier ladder', {
                size: 'sm',
                variant: 'ghost',
                icon: 'workspace_premium',
                onClick: () => {
                  ladderOpen = !ladderOpen
                  renderLadder()
                },
              }),
              button('Refresh', {
                size: 'sm',
                variant: 'secondary',
                icon: 'refresh',
                onClick: () => void reload(),
              }),
            ],
          })
        )
      }

      async function renderGlance(): Promise<void> {
        mount(glanceHost, skeleton('h-24'), skeleton('h-24'), skeleton('h-24'))
        try {
          const overview = await deps.db.rpc<Overview>('overview', {})
          mount(
            glanceHost,
            stat('Points owed', formatPoints(overview.points_out), {
              iconName: 'card_membership',
              hint: `${overview.members} member${overview.members === 1 ? '' : 's'}`,
            }),
            stat('Worth', money(overview.value_minor), {
              iconName: 'payments',
              hint: `${formatPoints(rule().redeemRate)} points = 1`,
            }),
            stat(`${overview.month_label} points`, formatPoints(overview.earned_month), {
              iconName: 'trending_up',
              hint: `${overview.active_month} customer${overview.active_month === 1 ? '' : 's'} active`,
            })
          )
        } catch (error) {
          mount(
            glanceHost,
            card(
              h('p', { class: 'text-sm text-danger' }, describe(error)),
              h('p', { class: 'mt-1 text-xs text-content-muted' }, 'The shop’s points could not be read.')
            )
          )
        }
      }

      /** Everything on the screen, in the order the screen reads it. */
      async function reload(): Promise<void> {
        await renderGlance()
        await loadMembers()
        await renderDetail()
      }

      // ── The register ────────────────────────────────────────────────────
      const searchField = input({
        type: 'search',
        placeholder: 'Find a customer by name or phone',
        leadingIcon: 'search',
        onInput: (value) => {
          search = value
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => void loadMembers(), 200)
        },
      })
      let timer: ReturnType<typeof setTimeout> | undefined

      async function loadMembers(): Promise<void> {
        busy = true
        renderList()
        try {
          const page = await deps.db.rpc<MemberPage>('members', {
            search: search.trim(),
            limit: 50,
            offset: 0,
          })
          members = page.rows
          total = page.total
        } catch (error) {
          members = []
          total = 0
          toastError(describe(error))
        } finally {
          busy = false
          renderList()
        }
      }

      function renderList(): void {
        const rows = members.map((member) =>
          h(
            'button',
            {
              type: 'button',
              class:
                'w-full flex items-center justify-between gap-3 border-b border-border px-3 py-2 ' +
                'text-left last:border-0 hover:bg-surface-muted ' +
                (selected === member.customer_id ? 'bg-surface-muted' : ''),
              onClick: () => {
                selected = member.customer_id
                renderList()
                void renderDetail()
              },
            },
            h(
              'div',
              { class: 'min-w-0' },
              h('p', { class: 'truncate text-sm text-content', text: member.customer }),
              h('p', {
                class: 'truncate text-xs text-content-muted',
                text: [member.phone ?? 'No phone', `${formatPoints(member.lifetime_points)} earned ever`].join(
                  ' · '
                ),
              })
            ),
            h(
              'div',
              { class: 'shrink-0 text-right' },
              h('p', { class: 'text-sm font-semibold text-content tabular-nums', text: formatPoints(member.points) }),
              h('p', { class: 'text-[11px] text-content-muted tabular-nums', text: money(member.value_minor) })
            ),
            badge(member.tier?.name ?? 'Member', {
              tone: (member.tier?.bonus ?? 0) > 0 ? 'success' : 'neutral',
              iconName: 'workspace_premium',
            })
          )
        )

        mount(
          listHost,
          panel(
            h(
              'div',
              { class: 'flex items-center gap-2 border-b border-border p-3' },
              h('span', { class: 'text-sm font-semibold text-content', text: 'Members' }),
              badge(`${total}`, { tone: 'neutral' }),
              h('div', { class: 'ml-auto w-64' }, searchField)
            ),
            busy
              ? h('div', { class: 'space-y-2 p-3' }, skeleton('h-10'), skeleton('h-10'), skeleton('h-10'))
              : rows.length === 0
                ? h(
                    'div',
                    { class: 'p-3' },
                    emptyState('Nobody has earned points yet', {
                      description: search
                        ? 'No member matches that. Points are earned on completed sales with a customer attached — the till has a customer control above the cart.'
                        : 'Attach a customer at the till, and their first sale earns the first points.',
                      iconName: 'card_membership',
                    })
                  )
                : h('div', {}, ...rows)
          )
        )
      }

      // ── One customer ────────────────────────────────────────────────────
      async function renderDetail(): Promise<void> {
        if (!selected) {
          mount(detailHost, null)
          return
        }
        const customerId = selected
        mount(detailHost, panel(h('div', { class: 'p-3' }, skeleton('h-6'), skeleton('h-24'))))

        let account: AccountRecord
        try {
          account = await deps.db.rpc<AccountRecord>('account', { customer_id: customerId, limit: 60 })
        } catch (error) {
          mount(detailHost, card(h('p', { class: 'text-sm text-danger' }, describe(error))))
          return
        }
        if (selected !== customerId) return

        const points = Number(account.points ?? 0)
        const lifetime = Number(account.lifetime_points ?? 0)
        const tier = account.tier ?? { name: 'Member', from: 0, bonus: 0 }
        const ledger = (account.ledger ?? []) as LedgerEntryRecord[]
        const open = account.open ?? []

        mount(
          detailHost,
          card(
            cardHeader(account.customer ?? 'Customer', {
              subtitle: [account.phone ?? 'No phone', `${formatPoints(lifetime)} points earned ever`]
                .filter(Boolean)
                .join(' · '),
              iconName: 'person',
              actions: [
                badge(tier.name ?? 'Member', {
                  tone: (tier.bonus ?? 0) > 0 ? 'success' : 'neutral',
                  iconName: 'workspace_premium',
                }),
                button('Adjust points', {
                  size: 'sm',
                  variant: 'secondary',
                  icon: 'tune',
                  onClick: () => adjustDialog(customerId, account.customer ?? 'this customer'),
                }),
              ],
            }),
            h(
              'div',
              { class: 'flex flex-wrap items-baseline gap-x-4 gap-y-1' },
              h('p', { class: 'text-2xl font-semibold text-content tabular-nums', text: formatPoints(points) }),
              h('p', { class: 'text-sm text-content-muted', text: `worth ${money(moneyFor(points, rule()))}` })
            ),

            // The open reservations: the only points the shop can give back,
            // and the reason a redemption is not a quiet spend.
            open.length > 0
              ? h(
                  'div',
                  { class: 'mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3' },
                  h('p', {
                    class: 'text-xs font-medium text-content',
                    text:
                      `${open.length} redemption${open.length === 1 ? '' : 's'} never reached an invoice — ` +
                      'the till took the points off, and no sale was completed.',
                  }),
                  h(
                    'div',
                    { class: 'mt-2 space-y-1' },
                    ...open.map((entry) =>
                      h(
                        'div',
                        { class: 'flex items-center justify-between gap-2 text-xs' },
                        h('span', {
                          class: 'text-content-muted',
                          text: `${formatPoints(Number(entry.points ?? 0))} points`,
                        }),
                        button('Give them back', {
                          size: 'sm',
                          variant: 'ghost',
                          icon: 'undo',
                          onClick: () => void release(entry.token ?? ''),
                        })
                      )
                    )
                  )
                )
              : null,

            h('p', { class: 'mt-4 mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-subtle', text: 'Every movement' }),
            ledger.length === 0
              ? h('p', { class: 'text-xs text-content-muted' }, 'Nothing has moved on this account yet.')
              : h(
                  'div',
                  { class: 'space-y-1' },
                  ...ledger.map((entry) =>
                    h(
                      'div',
                      { class: 'flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 text-xs last:border-0' },
                      h(
                        'div',
                        { class: 'min-w-0' },
                        h(
                          'p',
                          { class: 'text-content' },
                          `${ledgerLabel(entry.kind)}${entry.invoice_no ? ` · ${entry.invoice_no}` : ''}`
                        ),
                        h('p', { class: 'text-content-subtle', text: when(entry.created_at) })
                      ),
                      h(
                        'span',
                        {
                          class: `tabular-nums shrink-0 ${entry.points >= 0 ? 'text-success' : 'text-content'}`,
                          text: `${entry.points >= 0 ? '+' : '−'}${formatPoints(Math.abs(entry.points))}`,
                        }
                      )
                    )
                  )
                )
          )
        )
      }

      async function release(token: string): Promise<void> {
        if (token === '') return
        const ok = await confirm('Give these points back?', {
          message:
            'The redemption never reached a sale. The customer keeps the points, and the ledger records why.',
          confirmLabel: 'Give them back',
        })
        if (!ok) return
        try {
          await deps.db.rpc('release', { token, reason: 'Not used' })
          toastSuccess('The points are back on the account.')
        } catch (error) {
          toastError(describe(error))
        }
        await renderGlance()
        await loadMembers()
        await renderDetail()
      }

      function adjustDialog(customerId: string, name: string): void {
        let amount = ''
        let why = ''

        const amountField = field(
          'Points to add or remove',
          input({
            placeholder: 'e.g. 250, or -250 to take points away',
            inputmode: 'text',
            onInput: (value) => {
              amount = value
            },
          }),
          { hint: 'Whole points. A correction is recorded in the ledger with your name and this reason.' }
        )
        const whyField = field(
          'Why',
          input({
            placeholder: 'Wrong points on invoice INV-…',
            onInput: (value) => {
              why = value
            },
          })
        )

        // The core's confirm dialog takes no fields, so this is a card rather
        // than a prompt: the honesty of the action *is* the reason, and a
        // `window.confirm` cannot collect one.
        mount(
          detailHost,
          card(
            cardHeader(`Adjust ${name}’s points`, { iconName: 'tune' }),
            h('div', { class: 'space-y-3' }, amountField, whyField),
            h(
              'div',
              { class: 'mt-3 flex justify-end gap-2' },
              button('Cancel', { variant: 'ghost', onClick: () => void renderDetail() }),
              button('Save the correction', {
                variant: 'primary',
                icon: 'save',
                onClick: () => void saveAdjustment(customerId),
              })
            )
          )
        )

        async function saveAdjustment(id: string): Promise<void> {
          const points = wholePoints(amount)
          if (points === null) {
            toastError('Enter a whole number of points, and not zero.')
            return
          }
          if (why.trim() === '') {
            toastError('A correction needs a reason — it is what the ledger will say.')
            return
          }
          try {
            await deps.db.rpc('adjust', { customer_id: id, points, note: why.trim() })
            toastSuccess(`${points > 0 ? 'Added' : 'Removed'} ${formatPoints(Math.abs(points))} points.`)
          } catch (error) {
            toastError(describe(error))
            return
          }
          await renderGlance()
          await loadMembers()
          await renderDetail()
        }
      }

      // ── The ladder ──────────────────────────────────────────────────────
      const ladderHost = h('div')

      function renderLadder(): void {
        if (!ladderOpen) {
          mount(ladderHost, null)
          return
        }

        const rows = ladder().map((tier, index) => {
          const nameInput = input({
            value: tier.name,
            leadingIcon: 'workspace_premium',
            onInput: (value) => {
              tier.name = value
            },
          })
          const fromInput = input({
            type: 'number',
            value: String(tier.from),
            min: 0,
            disabled: index === 0,
            onInput: (value) => {
              tier.from = Number(value)
            },
          })
          const bonusInput = input({
            type: 'number',
            value: String(tier.bonus),
            min: 0,
            suffix: '%',
            onInput: (value) => {
              tier.bonus = Number(value)
            },
          })
          return h(
            'div',
            { class: 'grid gap-2 sm:grid-cols-[1fr_10rem_8rem_auto] items-end' },
            field('Tier', nameInput),
            field('From points', fromInput, { hint: index === 0 ? 'Always the first rung' : undefined }),
            field('Extra points', bonusInput),
            iconButton('delete', `Remove ${tier.name}`, {
              variant: 'ghost',
              disabled: index === 0,
              onClick: () => {
                const next = ladder().filter((entry) => entry !== tier)
                void saveLadder(next)
              },
            })
          )
        })

        mount(
          ladderHost,
          card(
            cardHeader('Tier ladder', {
              subtitle:
                'A customer’s tier is read from what they have earned ever — never stored — so changing this relabels the whole shop at once.',
              iconName: 'workspace_premium',
            }),
            h('div', { class: 'space-y-3' }, ...rows),
            h(
              'div',
              { class: 'mt-3 flex justify-between gap-2' },
              button('Add a tier', {
                size: 'sm',
                variant: 'ghost',
                icon: 'add',
                onClick: () => void saveLadder([...ladder(), { name: 'New tier', from: 10000, bonus: 75 }]),
              }),
              button('Save the ladder', {
                size: 'sm',
                variant: 'primary',
                icon: 'save',
                onClick: () => void saveLadder(ladder()),
              })
            )
          )
        )
      }

      async function saveLadder(next: LoyaltyTier[]): Promise<void> {
        const clean = normaliseTiers(next)
        try {
          await deps.settings.set(TIERS_KEY, clean)
          toastSuccess(`The ladder now has ${clean.length} tier${clean.length === 1 ? '' : 's'}.`)
        } catch (error) {
          toastError(describe(error))
          return
        }
        renderLadder()
        await renderGlance()
      }

      // ── Mount ───────────────────────────────────────────────────────────
      renderHeader()
      renderList()
      root.append(headerHost, glanceHost, ladderHost, listHost, detailHost)
      await renderGlance()
      await loadMembers()
      return root
    },
  }
}

/** A timestamp a shopkeeper reads, not an ISO string. */
export function when(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = String((error as { message: unknown }).message)
    // Postgres raises `loyalty_insufficient_points: 500 asked for, 120 on the
    // account` — the second half is the sentence a shopkeeper needs.
    const colon = message.indexOf(':')
    if (colon > -1 && message.startsWith('loyalty_')) return message.slice(colon + 1).trim()
    return message
  }
  return 'Something went wrong.'
}

export { tierFor }
