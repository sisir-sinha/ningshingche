/**
 * Loyalty — behaviour.
 *
 * Two halves, and they run in opposite directions:
 *
 *   * **Earning is derived.** The rule lives in SQL and `loyalty_sync` walks the
 *     shop's own sales; this file never awards a point for a sale. That is why a
 *     till that dies between the sale and the award loses nothing, why an
 *     offline sale earns when it reaches the server rather than when a listener
 *     happened to be attached, and why Android needs no second implementation
 *     of the rule (spec §43). Opening the screen — or the tile, or the till
 *     panel — is what catches the shop up.
 *   * **Redemption is immediate.** The till takes money off the sale *now*, so
 *     the points are reserved against a token before the sale exists and bound
 *     to the invoice a moment later (`PluginAPI.registerSaleAdjustment`). If the
 *     customer walks away, the reservation is visible and releasable rather than
 *     silently spent.
 *
 * Everything the shopkeeper sees is drawn by the core: a screen, a tile, a till
 * panel, a sale tab and two reports. That is the §51 boundary — the plugin
 * describes, the host renders, and no feature file was edited to add any of it.
 */

import { badge, stat } from '../../components/ui/card'
import { h, srOnly } from '../../components/ui/h'
import { formatMoney, minor } from '../../shared/domain/money'
import type {
  PanelContext,
  Plugin,
  PluginAPI,
  PluginPageModule,
  PluginReportResult,
  ReportRunContext,
} from '../../shared/registry/plugin-types'
import {
  DEFAULT_MIN_REDEEM,
  DEFAULT_POINTS_PER_CURRENCY,
  DEFAULT_REDEEM_RATE,
  loyaltyManifest,
  MIN_REDEEM_KEY,
  POINTS_PER_CURRENCY_KEY,
  REDEEM_RATE_KEY,
} from './manifest'
import {
  DEFAULT_TIERS,
  formatPoints,
  ledgerLabel,
  LOYALTY_REDEEM,
  LOYALTY_VIEW,
  moneyFor,
  normaliseTiers,
  pointsFor,
  redemptionToken,
  redeemOffer,
  ruleFrom,
  snapshotFrom,
  TIERS_KEY,
  type AccountRecord,
  type AccountSnapshot,
  type LedgerEntryRecord,
  type LoyaltyRule,
  type LoyaltyTier,
  type MemberPage,
  type MemberRecord,
} from './helpers'

/** The rule as the shop has set it, for the maths on this screen. */
export function ruleOf(api: PluginAPI): LoyaltyRule {
  return ruleFrom(
    api.settings.get<number>(POINTS_PER_CURRENCY_KEY, DEFAULT_POINTS_PER_CURRENCY),
    api.settings.get<number>(REDEEM_RATE_KEY, DEFAULT_REDEEM_RATE),
    api.settings.get<number>(MIN_REDEEM_KEY, DEFAULT_MIN_REDEEM),
    api.settings.get<LoyaltyTier[]>(TIERS_KEY, [...DEFAULT_TIERS])
  )
}

/** The shop's ladder, cleaned — the same list the SQL derives tiers from. */
export function tiersOf(api: PluginAPI): LoyaltyTier[] {
  return normaliseTiers(api.settings.get<LoyaltyTier[]>(TIERS_KEY, [...DEFAULT_TIERS]))
}

/**
 * A customer's account, remembered for this session.
 *
 * The till asks on every cart change — add a line, change a quantity, attach a
 * customer — and the answer only changes when something is written. So it is
 * fetched once per customer and dropped whenever this plugin writes anything.
 */
export function accountCache(api: PluginAPI): {
  get: (customerId: string) => Promise<AccountSnapshot>
  forget: (customerId?: string) => void
} {
  const cache = new Map<string, Promise<AccountSnapshot>>()

  return {
    get(customerId: string): Promise<AccountSnapshot> {
      const hit = cache.get(customerId)
      if (hit) return hit

      // Nothing else is watching a customer's balance, and the till asks about
      // one customer per sale — so the cache holds one customer, not a cart's
      // worth of them.
      if (cache.size > 4) cache.clear()

      const pending = api.db
        .rpc<AccountRecord>('account', { customer_id: customerId, limit: 30 })
        .then(snapshotFrom)
        .catch((error: unknown) => {
          // A failed read is not a zero balance: drop the cache so the next
          // cart change tries again, and answer "not a member" so the till
          // shows nothing rather than a wrong number.
          cache.delete(customerId)
          throw error
        })

      cache.set(customerId, pending)
      return pending
    },
    forget(customerId?: string): void {
      if (customerId) cache.delete(customerId)
      else cache.clear()
    },
  }
}

export const loyaltyPlugin: Plugin = {
  id: loyaltyManifest.id,
  name: loyaltyManifest.name,
  version: loyaltyManifest.version,
  description: loyaltyManifest.description,
  ...(loyaltyManifest.icon ? { icon: loyaltyManifest.icon } : {}),

  register(api) {
    for (const permission of loyaltyManifest.permissions ?? []) {
      api.registerPermission({
        key: permission.key,
        label: permission.label,
        group: permission.group,
        ...(permission.description ? { description: permission.description } : {}),
      })
    }

    const accounts = accountCache(api)

    /**
     * The redemption the till is currently offering, one per customer.
     *
     * One, not a list: the host re-quotes on every cart change, so a map keyed
     * by token would grow with every tap of the keypad and leave the shop with
     * a pile of reservations nobody means to spend. Keyed by customer, the
     * latest quote is the only live one — and `onApplied` refuses a quote the
     * till has already moved past (`token` is checked, not assumed).
     */
    const offers = new Map<string, { token: string; points: number; moneyMinor: number }>()

    // ── The till: money off, from points the customer has already earned ──
    api.registerSaleAdjustment({
      id: 'loyalty.redeem',
      label: 'Loyalty',
      permission: LOYALTY_REDEEM,

      /**
       * What this customer's points are worth on this sale, or nothing.
       *
       * Read-only, and it must stay that way: the host asks again on every cart
       * change, so spending here would spend twice.
       */
      quote: async (context) => {
        if (!context.customerId) return null
        const account = await accounts.get(context.customerId)
        if (!account.member) return null

        const rule = ruleOf(api)
        const offer = redeemOffer(account.points, context.totalMinor, rule)
        if (!offer) return null

        const token = redemptionToken(context.customerId, offer.points, Date.now())
        offers.set(context.customerId, { token, points: offer.points, moneyMinor: offer.moneyMinor })

        return {
          amountMinor: offer.moneyMinor,
          label: `Redeem ${formatPoints(offer.points)} points`,
          note:
            `${formatPoints(offer.points)} points · ` +
            `${formatMoney(minor(offer.moneyMinor), { currency: context.currency })} off`,
          token,
        }
      },

      // The money moves here, and only if the shop could record it: the points
      // are debited server-side before a single paisa comes off the sale. A
      // throw here is what stops the discount reaching the customer's bill.
      onApplied: async (quote, context) => {
        const offer = context.customerId ? offers.get(context.customerId) : undefined
        if (!context.customerId || !quote.token || offer?.token !== quote.token || offer.points <= 0) {
          throw new Error('this redemption is not the one being offered any more')
        }

        await api.db.rpc('redeem', {
          customer_id: context.customerId,
          points: offer.points,
          token: offer.token,
        })
        offers.delete(context.customerId)
        accounts.forget(context.customerId)
      },

      // The customer changed their mind, or the cart moved out from under the
      // quote: the points go back, and the ledger says who gave them back.
      onReleased: async (quote, reason) => {
        if (!quote.token) return
        await api.db.rpc('release', { token: quote.token, reason })
        for (const [customerId, offer] of offers) {
          if (offer.token === quote.token) offers.delete(customerId)
        }
        accounts.forget()
      },

      // The invoice this redemption paid for. Offline, `stored` is false and
      // the reservation waits: it is visible in the shop's worklist, and the
      // next sync links it or a shopkeeper releases it.
      onSettled: async (quote, settlement) => {
        if (!quote.token || !settlement.stored) {
          api.log.debug('a redemption is waiting for its invoice', {
            token: quote.token,
            invoice: settlement.invoiceNo,
          })
          return
        }
        await api.db.rpc('settle', { token: quote.token, sale_id: settlement.saleId })
        for (const [customerId, offer] of offers) {
          if (offer.token === quote.token) offers.delete(customerId)
        }
        accounts.forget()
      },
    })

    // ── The till panel: who this is, and what the sale earns them ─────────
    api.registerPOSPanel({
      id: 'loyalty.pos',
      label: 'Loyalty',
      permission: LOYALTY_REDEEM,
      render: (context: PanelContext) => renderTillPanel(api, accounts, context),
    })

    // ── The sale tab: what this customer holds, after the sale ────────────
    api.registerSaleTab({
      id: 'loyalty.sale',
      label: 'Loyalty',
      permission: LOYALTY_VIEW,
      render: (context: PanelContext) => renderSaleTab(api, accounts, context),
    })

    // ── Navigation, and the register behind it ────────────────────────────
    api.registerNav({
      id: 'loyalty',
      label: 'Loyalty',
      icon: 'card_membership',
      section: 'customers',
      route: '/plugins/loyalty',
      permission: LOYALTY_VIEW,
      order: 30,
    })

    api.registerRoute({
      path: '/plugins/loyalty',
      title: 'Loyalty',
      permission: LOYALTY_VIEW,
      load: async (): Promise<PluginPageModule> => {
        const screen = await import('./loyalty-screen')
        return screen.createLoyaltyScreen({ settings: api.settings, db: api.db })
      },
    })

    // ── The dashboard tile ────────────────────────────────────────────────
    api.registerDashboardWidget({
      id: 'loyalty.summary',
      title: 'Loyalty',
      size: 'sm',
      permission: LOYALTY_VIEW,
      render: () => renderTile(api),
    })

    // ── The reports ───────────────────────────────────────────────────────
    api.registerReport({
      id: 'members',
      label: 'Loyalty members',
      icon: 'card_membership',
      group: 'Customers',
      permission: LOYALTY_VIEW,
      description:
        'Who the shop’s regulars are, what they hold, and what those points are worth.',
      filters: { window: false, search: true },
      run: (context) => membersReport(api, context),
    })

    api.registerReport({
      id: 'ledger',
      label: 'Points ledger',
      icon: 'receipt_long',
      group: 'Customers',
      permission: LOYALTY_VIEW,
      description: 'Every point that moved, and the sale or the reason beside it.',
      filters: { window: true, search: true },
      run: (context) => ledgerReport(api, context),
    })
  },
}

// ── The till's panel ──────────────────────────────────────────────────────

/**
 * What the cashier needs before deciding anything: who this is, what they hold,
 * and what the sale in front of them is about to earn them.
 *
 * The offer itself is not here — it is the strip above the totals, where the
 * host puts money off the sale, because the amount has to be the host's
 * (`PluginAPI.registerSaleAdjustment`) and two places offering the same
 * redemption would be two chances to press it twice.
 */
export async function renderTillPanel(
  api: PluginAPI,
  accounts: { get: (customerId: string) => Promise<AccountSnapshot>; forget: (id?: string) => void },
  context: PanelContext
): Promise<HTMLElement> {
  if (!context.customerId) {
    return h('p', { class: 'text-xs text-content-subtle' }, 'Attach a customer to see their points.')
  }

  let account: AccountSnapshot
  try {
    account = await accounts.get(context.customerId)
  } catch {
    return h('p', { class: 'text-xs text-content-muted' }, 'The points could not be read just now.')
  }

  if (!account.member) {
    return h(
      'p',
      { class: 'text-xs text-content-subtle' },
      'This customer has not earned any points yet.'
    )
  }

  const rule = ruleOf(api)
  const totalMinor = Math.round((context.total ?? 0) * 100)
  const earning = pointsFor(totalMinor, rule, account.tier)
  const currency = context.currency

  return h(
    'div',
    { class: 'flex flex-col gap-1.5' },
    srOnly(`${account.customer ?? 'The customer'} holds ${account.points} points`),
    h(
      'div',
      { class: 'flex items-baseline justify-between gap-2' },
      h('span', { class: 'text-sm font-semibold text-content tabular-nums', text: formatPoints(account.points) }),
      badge(account.tier.name, { tone: account.tier.bonus > 0 ? 'success' : 'neutral', iconName: 'workspace_premium' })
    ),
    h(
      'p',
      { class: 'text-[11px] text-content-muted' },
      `${formatMoney(minor(account.valueMinor), { currency })} in points` +
        (earning > 0 ? ` · this sale earns ${formatPoints(earning)}` : '')
    ),
    account.open.length > 0
      ? h(
          'p',
          { class: 'text-[11px] text-warning' },
          `${account.open.length} redemption${account.open.length === 1 ? '' : 's'} waiting for an invoice`
        )
      : null
  )
}

// ── The sale tab ──────────────────────────────────────────────────────────

export async function renderSaleTab(
  api: PluginAPI,
  accounts: { get: (customerId: string) => Promise<AccountSnapshot> },
  context: PanelContext
): Promise<HTMLElement> {
  if (!context.customerId) {
    return h('p', { class: 'text-xs text-content-subtle' }, 'This was a walk-in sale.')
  }

  let account: AccountSnapshot
  try {
    account = await accounts.get(context.customerId)
  } catch {
    return h('p', { class: 'text-xs text-content-muted' }, 'The points could not be read just now.')
  }

  const entries = await ledgerFor(api, context.customerId)
  const movements: LedgerEntryRecord[] = entries.slice(0, 8)

  return h(
    'div',
    { class: 'flex flex-col gap-2' },
    h(
      'div',
      { class: 'flex items-baseline justify-between gap-2' },
      h('span', { class: 'text-xs text-content-muted', text: account.customer ?? 'Customer' }),
      h('span', {
        class: 'text-sm font-semibold text-content tabular-nums',
        text: `${formatPoints(account.points)} points`,
      })
    ),
    movements.length === 0
      ? h('p', { class: 'text-xs text-content-subtle' }, 'No points have moved on this account yet.')
      : h(
          'div',
          { class: 'space-y-1' },
          ...movements.map((entry) =>
            h(
              'div',
              { class: 'flex items-baseline justify-between gap-2 text-xs' },
              h(
                'span',
                { class: 'text-content-muted truncate' },
                entry.invoice_no
                  ? `${ledgerLabel(entry.kind)} · ${entry.invoice_no}`
                  : ledgerLabel(entry.kind)
              ),
              h('span', {
                class: `tabular-nums ${entry.points >= 0 ? 'text-success' : 'text-content'}`,
                text: `${entry.points >= 0 ? '+' : '−'}${formatPoints(Math.abs(entry.points))}`,
              })
            )
          )
        )
  )
}

async function ledgerFor(api: PluginAPI, customerId: string): Promise<LedgerEntryRecord[]> {
  const account = await api.db.rpc<AccountRecord>('account', { customer_id: customerId, limit: 10 })
  return account.ledger ?? []
}

// ── The dashboard tile ────────────────────────────────────────────────────

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

export async function renderTile(api: PluginAPI): Promise<HTMLElement> {
  let overview: Overview
  try {
    overview = await api.db.rpc<Overview>('overview', {})
  } catch (error) {
    return h(
      'p',
      { class: 'text-xs text-content-muted' },
      error instanceof Error ? error.message : 'Loyalty could not be read just now.'
    )
  }

  const rule = ruleOf(api)
  return h(
    'div',
    { class: 'flex flex-col gap-2' },
    srOnly(
      `${overview.members} members holding ${overview.points_out} points, worth ` +
        `${formatMoney(minor(overview.value_minor), { currency: 'BDT' })}`
    ),
    stat('Points owed', formatPoints(overview.points_out), {
      iconName: 'card_membership',
      hint: `${overview.members} member${overview.members === 1 ? '' : 's'} · ${overview.active_month} active this month`,
    }),
    h(
      'p',
      { class: 'text-xs text-content-muted' },
      `Worth ${formatMoney(minor(overview.value_minor), { currency: 'BDT' })} at ${formatPoints(rule.redeemRate)} points to 1`
    ),
    overview.earned_month !== 0
      ? h(
          'p',
          { class: 'text-[11px] text-content-subtle' },
          `${overview.month_label}: ${overview.earned_month >= 0 ? '+' : '−'}${formatPoints(Math.abs(overview.earned_month))} points`
        )
      : null,
    overview.open_reservations > 0
      ? h(
          'p',
          { class: 'text-[11px] text-warning' },
          `${overview.open_reservations} redemption${overview.open_reservations === 1 ? '' : 's'} waiting for an invoice`
        )
      : null,
    // The one number that says this plugin's cache agrees with its ledger.
    overview.drift > 0
      ? h(
          'p',
          { class: 'text-[11px] text-danger' },
          `${overview.drift} account${overview.drift === 1 ? '' : 's'} disagree with the ledger — open Loyalty`
        )
      : null
  )
}

// ── The reports ───────────────────────────────────────────────────────────

export async function membersReport(
  api: PluginAPI,
  context: ReportRunContext
): Promise<PluginReportResult> {
  const page = await api.db.rpc<MemberPage>('report', {
    type: 'members',
    search: context.search,
    limit: context.limit,
    offset: context.offset,
  })

  return {
    columns: [
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'tier', label: 'Tier', type: 'status' },
      { key: 'points', label: 'Points', type: 'int', align: 'right' },
      { key: 'value', label: 'Worth', type: 'money', align: 'right' },
      { key: 'lifetime', label: 'Earned ever', type: 'int', align: 'right' },
      { key: 'last', label: 'Last seen', type: 'date' },
    ],
    rows: page.rows.map((row: MemberRecord) => ({
      customer: row.phone ? `${row.customer} · ${row.phone}` : row.customer,
      tier: row.tier?.name ?? 'Member',
      points: row.points,
      value: row.value_minor,
      lifetime: row.lifetime_points,
      last: row.last_activity_at,
    })),
    totals: {
      points: page.rows.reduce((sum, row) => sum + row.points, 0),
      value: page.rows.reduce((sum, row) => sum + row.value_minor, 0),
    },
    totalRows: page.total,
    note: 'Points are what the shop still owes these customers; "earned ever" is what they have spent to get them.',
  }
}

export async function ledgerReport(
  api: PluginAPI,
  context: ReportRunContext
): Promise<PluginReportResult> {
  const page = await api.db.rpc<{
    rows: Array<{
      date: string
      customer: string
      kind: string
      points: number
      money_minor: number
      invoice_no: string
      note: string
    }>
    total: number
    totals: Record<string, number>
  }>('report', {
    type: 'ledger',
    period: context.period,
    from: context.from,
    to: context.to,
    search: context.search,
    limit: context.limit,
    offset: context.offset,
  })

  return {
    columns: [
      { key: 'date', label: 'When', type: 'date' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'kind', label: 'Movement', type: 'status' },
      { key: 'points', label: 'Points', type: 'int', align: 'right' },
      { key: 'money', label: 'Money', type: 'money', align: 'right' },
      { key: 'invoice', label: 'Invoice', type: 'text' },
      { key: 'note', label: 'Note', type: 'text' },
    ],
    rows: page.rows.map((row) => ({
      date: row.date,
      customer: row.customer,
      kind: ledgerLabel(row.kind),
      points: row.points,
      money: row.money_minor,
      invoice: row.invoice_no,
      note: row.note,
    })),
    totals: {
      points: page.totals?.net ?? 0,
      money: page.totals?.spent ?? 0,
    },
    totalRows: page.total,
    note:
      `Earned ${formatPoints(page.totals?.earned ?? 0)} · ` +
      `redeemed ${formatPoints(Math.abs(page.totals?.spent ?? 0))} · ` +
      `given back ${formatPoints(page.totals?.given_back ?? 0)} · ` +
      `returned ${formatPoints(Math.abs(page.totals?.reversed ?? 0))}`,
  }
}

export { moneyFor }
export default loyaltyPlugin
