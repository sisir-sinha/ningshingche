/**
 * Loyalty (lite) — behaviour.
 *
 * A complete worked example of the SDK: it owns SQL (a table and three
 * functions), reads core data through the one projection it is allowed
 * (`ctx.db.products()`), writes through its own functions (`ctx.db.rpc`), and
 * appears in five host surfaces — a sidebar item with a lazily-loaded screen, a
 * dashboard widget, a POS panel, a sale tab and a settings form.
 *
 * Everything the shopkeeper sees is rendered by the *core*; this file only
 * describes it. That is the §51 boundary.
 */

import { badge, stat } from '../../components/ui/card'
import { button } from '../../components/ui/button'
import { h, srOnly } from '../../components/ui/h'
import type { PanelContext, Plugin, PluginPageModule } from '../../shared/registry/plugin-types'
import { AUTO_AWARD_KEY, POINTS_PER_CURRENCY_KEY, loyaltyLiteManifest } from './manifest'

export interface LoyaltyTotals {
  accounts: number
  points: number
  top: Array<{ customer_id: string; customer: string; points: number; lifetime_points: number }>
}

/** Points a sale of this size earns, rounded down so a shop never over-awards. */
export function pointsFor(total: number, pointsPerCurrency: number): number {
  if (!Number.isFinite(total) || total <= 0 || pointsPerCurrency <= 0) return 0
  return Math.floor(total * pointsPerCurrency)
}

export function formatPoints(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value)
}

export const loyaltyLitePlugin: Plugin = {
  id: loyaltyLiteManifest.id,
  name: loyaltyLiteManifest.name,
  version: loyaltyLiteManifest.version,
  description: loyaltyLiteManifest.description,
  ...(loyaltyLiteManifest.icon ? { icon: loyaltyLiteManifest.icon } : {}),
  dependencies: [...(loyaltyLiteManifest.dependencies ?? [])],

  register(api) {
    for (const permission of loyaltyLiteManifest.permissions ?? []) {
      api.registerPermission({
        key: permission.key,
        label: permission.label,
        group: permission.group,
        ...(permission.description ? { description: permission.description } : {}),
      })
    }

    api.registerNav({
      id: 'loyalty-lite',
      label: 'Loyalty',
      icon: 'card_membership',
      section: 'selling',
      route: '/plugins/loyalty-lite',
      permission: 'loyalty-lite.view',
      order: 40,
    })

    api.registerRoute({
      path: '/plugins/loyalty-lite',
      title: 'Loyalty',
      permission: 'loyalty-lite.view',
      load: async (): Promise<PluginPageModule> => {
        const page = await import('./accounts')
        return page.create({ db: api.db })
      },
    })

    api.registerDashboardWidget({
      id: 'loyalty-lite.summary',
      title: 'Loyalty',
      size: 'sm',
      permission: 'loyalty-lite.view',
      render: async () => {
        const totals = await loadTotals(api)
        return h(
          'div',
          { class: 'flex flex-col gap-2' },
          srOnly(`Loyalty: ${totals.accounts} account(s), ${totals.points} points issued`),
          stat('Points issued', formatPoints(totals.points), {
            iconName: 'card_membership',
            hint: `${totals.accounts} account(s)`,
          }),
          totals.top.length > 0
            ? h(
                'p',
                { class: 'truncate text-xs text-content-muted' },
                `Top: ${totals.top[0]?.customer ?? ''} — ${formatPoints(totals.top[0]?.points ?? 0)}`
              )
            : h('p', { class: 'text-xs text-content-muted' }, 'No points awarded yet.')
        )
      },
    })

    // ── POS panel: what this sale is worth in points ─────────────────────
    api.registerPOSPanel({
      id: 'loyalty-lite.pos',
      label: 'Loyalty points',
      permission: 'loyalty-lite.view',
      render: (context: PanelContext) => {
        const rate = api.settings.get<number>(POINTS_PER_CURRENCY_KEY, 1)
        const points = pointsFor(context.total ?? 0, rate)

        const award = button(
          context.customerId ? `Award ${formatPoints(points)} point(s)` : 'Attach a customer to award',
          {
            size: 'sm',
            variant: 'secondary',
            icon: 'card_membership',
            disabled: !context.customerId || points <= 0 || context.total === undefined,
            onClick: () => {
              if (!context.customerId) return
              void api.db
                .rpc('award', { customer_id: context.customerId, points })
                .then(() => api.log.debug('awarded', { points }))
                .catch((error: unknown) =>
                  api.log.warn('award failed', error instanceof Error ? error.message : error)
                )
            },
          }
        )

        return h(
          'div',
          { class: 'flex flex-wrap items-center justify-between gap-2' },
          h(
            'p',
            { class: 'text-xs text-content-muted' },
            `${formatPoints(points)} point(s) at ${rate}/unit`
          ),
          award
        )
      },
    })

    // ── Sale tab: this customer's balance ────────────────────────────────
    api.registerSaleTab({
      id: 'loyalty-lite.sale',
      label: 'Loyalty',
      permission: 'loyalty-lite.view',
      render: async (context: PanelContext) => {
        if (!context.customerId) {
          // Answer without a round trip: a walk-in sale has nothing to show.
          return h('p', { class: 'text-sm text-content-muted' }, 'This sale has no customer attached.')
        }
        const totals = await loadTotals(api)
        const row = totals.top.find((entry) => entry.customer_id === context.customerId)
        if (!row) {
          return h(
            'p',
            { class: 'text-sm text-content-muted' },
            'This customer has no loyalty account yet. Award points from the POS screen.'
          )
        }
        return h(
          'div',
          { class: 'flex flex-wrap items-center gap-3' },
          badge(`${formatPoints(row.points)} point(s)`, { tone: 'info', iconName: 'card_membership' }),
          h('p', { class: 'text-xs text-content-muted' }, `${formatPoints(row.lifetime_points)} lifetime`)
        )
      },
    })

    // ── Auto-award, off by default ───────────────────────────────────────
    // Idempotent on the event id: the same sale arrives once locally and again
    // over Realtime (doc 02 §3), and a shop must not be charged twice.
    //
    // Two guards, because each covers a different failure:
    //   * `inFlight` covers the concurrent case — both deliveries of one event
    //     arrive before either has written anything down;
    //   * the recent-id ring in `api.data` covers the replay case — a
    //     delivery that arrives after a reload, when no memory survived.
    // The ring is a ring and not a single id: a replay of an *older* event
    // after a newer one would slip past a one-slot memory.
    const inFlight = new Set<string>()
    const RECENT_LIMIT = 50

    api.events.on('sale.completed', (event) => {
      if (!api.settings.get<boolean>(AUTO_AWARD_KEY, false)) return
      const customerId = event.data.customer_id
      // Domain events carry `numeric` as text, exactly as Postgres returned it
      // (doc 02 §3) — parse it here rather than assuming a number.
      const total = Number(event.data.total)
      if (!customerId || !Number.isFinite(total)) return
      const points = pointsFor(total, api.settings.get<number>(POINTS_PER_CURRENCY_KEY, 1))
      if (points <= 0) return
      if (inFlight.has(event.id)) return
      inFlight.add(event.id)

      void (async () => {
        try {
          const recent = await api.data.get<string[]>('recent_sale_events', [])
          if (recent.includes(event.id)) return

          await api.db.rpc('award', { customer_id: customerId, points })
          await api.data.set('recent_sale_events', [event.id, ...recent].slice(0, RECENT_LIMIT))
        } catch (error: unknown) {
          // Nothing is written down, so a later delivery can retry the award.
          inFlight.delete(event.id)
          api.log.warn('auto-award failed', error instanceof Error ? error.message : error)
        }
      })()
    })

    api.log.debug('registered', { pointsPerCurrency: api.settings.get(POINTS_PER_CURRENCY_KEY, 1) })
  },
}

/**
 * Read the plugin's own totals function.
 *
 * Coerced rather than trusted: this renders inside the *core's* sale screen, so
 * an unexpected payload must not be able to break a screen the plugin merely
 * decorates.
 */
async function loadTotals(api: {
  db: { rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> }
}): Promise<LoyaltyTotals> {
  try {
    const raw = await api.db.rpc<Partial<LoyaltyTotals>>('totals', { limit: 5 })
    return {
      accounts: typeof raw?.accounts === 'number' ? raw.accounts : 0,
      points: typeof raw?.points === 'number' ? raw.points : 0,
      top: Array.isArray(raw?.top) ? raw.top : [],
    }
  } catch {
    return { accounts: 0, points: 0, top: [] }
  }
}

export default loyaltyLitePlugin
