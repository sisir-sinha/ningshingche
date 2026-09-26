/**
 * What a plugin costs, and whether this shop is entitled to run it.
 *
 * Only Warranty is free. Everything else is a subscription, because a shop
 * that pays for a capability expects it to be maintained, and a capability
 * nobody pays for is the first thing to rot.
 *
 * Two decisions worth stating:
 *
 *   * **The entitlement is checked by the engine, not by the screen.** A
 *     plugin without a licence is `blocked` at load time, exactly like a
 *     plugin with a missing dependency. Hiding a button is not enforcement.
 *   * **The trial is real and it expires.** A shop gets `trialDays` from the
 *     first time it switches a paid plugin on; when that runs out the plugin
 *     stops loading and says so, rather than quietly continuing to work.
 *
 * The licence itself lives in the plugin's own `plugins.config` under a
 * reserved key, so it is per-shop, survives a reload, and syncs to every
 * device the way every other plugin setting does. This is honest bookkeeping,
 * not DRM: a shop determined to edit its own database can. The point is that
 * the app never *accidentally* runs something nobody agreed to pay for.
 */

export interface PluginPricing {
  plan: 'free' | 'paid'
  /** Whole taka per month. Zero for a free plugin. */
  priceBdt: number
  /** Days of full access when a paid plugin is first switched on. */
  trialDays?: number
}

/** The reserved settings key the licence is kept under. */
export const LICENCE_KEY = '__licence'

export interface StoredLicence {
  /** `trial` while the free period runs, `paid` once a shop has subscribed. */
  plan: 'trial' | 'paid'
  /** ISO date the entitlement began. */
  startedAt: string
  /** ISO date it lapses. Absent means it does not. */
  expiresAt?: string
}

export type LicenceStatus = 'free' | 'trial' | 'active' | 'expired' | 'unlicensed'

export interface Licence {
  status: LicenceStatus
  /** True when the engine may load the plugin. */
  entitled: boolean
  priceBdt: number
  /** Whole days remaining on a trial, floored at zero. */
  daysLeft: number | null
  /** One line a person can act on. */
  summary: string
}

const DAY_MS = 86_400_000

export function readLicence(value: unknown): StoredLicence | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const plan = record['plan']
  const startedAt = record['startedAt']
  if ((plan !== 'trial' && plan !== 'paid') || typeof startedAt !== 'string') return null
  const expiresAt = record['expiresAt']
  return {
    plan,
    startedAt,
    ...(typeof expiresAt === 'string' ? { expiresAt } : {}),
  }
}

/** The price line shown on the plugin card. */
export function priceLabel(pricing: PluginPricing | undefined): string {
  if (!pricing || pricing.plan === 'free' || pricing.priceBdt <= 0) return 'Free'
  return `৳${pricing.priceBdt.toLocaleString('en-BD')}/month`
}

/**
 * Decides entitlement from the plugin's price and the shop's stored licence.
 *
 * Pure, and takes `now` — a subscription that expires is the kind of logic
 * that must be testable without waiting a month.
 */
export function licenceFor(
  pricing: PluginPricing | undefined,
  config: Record<string, unknown> | undefined,
  now: Date = new Date()
): Licence {
  const price = pricing?.priceBdt ?? 0
  if (!pricing || pricing.plan === 'free' || price <= 0) {
    return { status: 'free', entitled: true, priceBdt: 0, daysLeft: null, summary: 'Free, for ever.' }
  }

  const stored = readLicence(config?.[LICENCE_KEY])
  if (!stored) {
    return {
      status: 'unlicensed',
      entitled: false,
      priceBdt: price,
      daysLeft: null,
      summary: `${priceLabel(pricing)} — not subscribed.`,
    }
  }

  if (!stored.expiresAt) {
    return {
      status: 'active',
      entitled: true,
      priceBdt: price,
      daysLeft: null,
      summary: `Subscribed — ${priceLabel(pricing)}.`,
    }
  }

  const expires = Date.parse(stored.expiresAt)
  const daysLeft = Number.isNaN(expires) ? 0 : Math.max(0, Math.ceil((expires - now.getTime()) / DAY_MS))
  if (daysLeft <= 0) {
    return {
      status: 'expired',
      entitled: false,
      priceBdt: price,
      daysLeft: 0,
      summary:
        stored.plan === 'trial'
          ? `The trial ended. Subscribe for ${priceLabel(pricing)} to switch it back on.`
          : `The subscription lapsed. Renew for ${priceLabel(pricing)}.`,
    }
  }

  return {
    status: stored.plan === 'trial' ? 'trial' : 'active',
    entitled: true,
    priceBdt: price,
    daysLeft,
    summary:
      stored.plan === 'trial'
        ? `Trial — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left, then ${priceLabel(pricing)}.`
        : `Subscribed — renews in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
  }
}

/** The licence a shop gets when it starts a trial today. */
export function startTrial(pricing: PluginPricing, now: Date = new Date()): StoredLicence {
  const days = pricing.trialDays ?? 14
  return {
    plan: 'trial',
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
  }
}

/** The licence a shop gets when it subscribes. One month, renewed on payment. */
export function startSubscription(now: Date = new Date()): StoredLicence {
  return {
    plan: 'paid',
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * DAY_MS).toISOString(),
  }
}
