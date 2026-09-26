/**
 * The plugin engine: the worker, the middleware chain, and the money.
 *
 * These are the three things the engine promises that a shopkeeper can feel:
 *
 *   · a plugin that misbehaves costs the till one deadline, not a sale;
 *   · switching a plugin off stops it *now*, including work already in flight;
 *   · a plugin nobody has paid for does not run.
 */

import { describe, it, expect, vi } from 'vitest'
import { PluginWorker } from './plugin-worker'
import { runMiddleware, type MiddlewareDefinition } from './plugin-middleware'
import {
  LICENCE_KEY,
  licenceFor,
  priceLabel,
  startSubscription,
  startTrial,
  type PluginPricing,
} from './plugin-licence'

const FREE: PluginPricing = { plan: 'free', priceBdt: 0 }
const PAID: PluginPricing = { plan: 'paid', priceBdt: 499, trialDays: 14 }

describe('the worker', () => {
  it('returns an outcome instead of throwing, so callers need no try/catch', async () => {
    const worker = new PluginWorker()
    const outcome = await worker.run({
      pluginId: 'loyalty',
      action: 'test',
      run: () => {
        throw new Error('boom')
      },
    })
    expect(outcome.status).toBe('failed')
    expect(outcome).toMatchObject({ status: 'failed' })
  })

  it('gives up on a plugin that never finishes', async () => {
    const worker = new PluginWorker({ timeoutMs: 20 })
    const outcome = await worker.run({
      pluginId: 'hung',
      action: 'test',
      run: () => new Promise(() => undefined),
    })
    expect(outcome.status).toBe('timeout')
  })

  it('stops work in flight when the plugin is switched off', async () => {
    const worker = new PluginWorker({ timeoutMs: 500 })
    let aborted = false
    const running = worker.run({
      pluginId: 'loyalty',
      action: 'test',
      run: (signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true
            resolve('stopped')
          })
        }),
    })
    // The shopkeeper flips the switch while the plugin is mid-call.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(worker.cancel('loyalty')).toBe(1)

    await running
    expect(aborted).toBe(true)
  })

  it('stops asking a plugin that keeps failing', async () => {
    const worker = new PluginWorker({ timeoutMs: 10, tripAfter: 2 })
    const job = {
      pluginId: 'bad',
      action: 'test',
      run: () => {
        throw new Error('nope')
      },
    }
    await worker.run(job)
    expect(worker.isTripped('bad')).toBe(false)
    await worker.run(job)
    expect(worker.isTripped('bad')).toBe(true)

    // A tripped plugin is skipped without being run at all.
    const run = vi.fn()
    await worker.run({ pluginId: 'bad', action: 'test', run })
    expect(run).not.toHaveBeenCalled()

    // …until it is given another chance, which is what \"Try again\" means.
    worker.reset('bad')
    await worker.run({ pluginId: 'bad', action: 'test', run })
    expect(run).toHaveBeenCalled()
  })

  it('counts what each plugin cost, so slowness can be named', async () => {
    const worker = new PluginWorker()
    await worker.run({ pluginId: 'loyalty', action: 'middleware:sale.complete', run: () => 1 })
    const stat = worker.statFor('loyalty')!
    expect(stat.runs).toBe(1)
    expect(stat.lastAction).toBe('middleware:sale.complete')
  })
})

const mw = (source: string, extra: Partial<MiddlewareDefinition> = {}): MiddlewareDefinition => ({
  action: 'sale.complete',
  source,
  handler: async (_ctx, next) => next(),
  ...extra,
})

describe('the middleware chain', () => {
  it('runs plugins in declared priority, not import order', async () => {
    const seen: string[] = []
    const chain = [
      mw('c', { priority: 300, handler: async (_c, next) => { seen.push('c'); return next() } }),
      mw('a', { priority: 10, handler: async (_c, next) => { seen.push('a'); return next() } }),
      mw('b', { priority: 100, handler: async (_c, next) => { seen.push('b'); return next() } }),
    ]
    const result = await runMiddleware('sale.complete', { total: 100 }, chain, new PluginWorker())
    expect(seen).toEqual(['a', 'b', 'c'])
    expect(result.ok).toBe(true)
  })

  it('lets a plugin change the payload, visibly', async () => {
    const chain = [
      mw('loyalty', {
        handler: async (ctx, next) => {
          ;(ctx.payload as { note?: string }).note = 'points awarded'
          return next()
        },
      }),
    ]
    const result = await runMiddleware('sale.complete', { note: '' }, chain, new PluginWorker())
    expect(result.payload.note).toBe('points awarded')
  })

  it('lets a plugin refuse the action, and says which one did', async () => {
    const after = vi.fn()
    const chain = [
      mw('serial-numbers', {
        priority: 1,
        handler: (ctx) => ctx.reject('Scan the serial number first.'),
      }),
      mw('loyalty', { priority: 2, handler: after }),
    ]
    const result = await runMiddleware('sale.complete', {}, chain, new PluginWorker())

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('Scan the serial number first.')
    expect(result.vetoedBy).toBe('serial-numbers')
    // A veto stops the chain: nothing behind it runs.
    expect(after).not.toHaveBeenCalled()
  })

  it('carries on past a plugin that throws, and names it', async () => {
    const reached = vi.fn(async (_c: unknown, next: () => Promise<void>) => next())
    const chain = [
      mw('broken', { priority: 1, handler: () => { throw new Error('undefined is not a function') } }),
      mw('loyalty', { priority: 2, handler: reached as never }),
    ]
    const result = await runMiddleware('sale.complete', {}, chain, new PluginWorker())

    expect(result.ok).toBe(true)
    expect(result.skipped).toEqual([{ pluginId: 'broken', why: 'undefined is not a function' }])
    // The shop keeps selling.
    expect(reached).toHaveBeenCalled()
  })

  it('carries on past a plugin that hangs', async () => {
    const chain = [
      mw('hung', { handler: () => new Promise(() => undefined) }),
    ]
    const result = await runMiddleware('sale.complete', {}, chain, new PluginWorker({ timeoutMs: 20 }))
    expect(result.ok).toBe(true)
    expect(result.skipped[0]!.pluginId).toBe('hung')
    expect(result.skipped[0]!.why).toContain('longer than its turn allows')
  })

  it('ignores middleware registered for a different action', async () => {
    const other = vi.fn()
    const chain = [mw('loyalty', { action: 'stock.adjust', handler: other })]
    const result = await runMiddleware('sale.complete', {}, chain, new PluginWorker())
    expect(other).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })
})

describe('what a plugin costs', () => {
  it('says free plainly', () => {
    const licence = licenceFor(FREE, {})
    expect(licence.status).toBe('free')
    expect(licence.entitled).toBe(true)
    expect(priceLabel(FREE)).toBe('Free')
  })

  it('refuses a paid plugin with no licence', () => {
    const licence = licenceFor(PAID, {})
    expect(licence.entitled).toBe(false)
    expect(licence.summary).toContain('৳499/month')
  })

  it('counts the trial down, then stops', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const config = { [LICENCE_KEY]: startTrial(PAID, now) }

    const early = licenceFor(PAID, config, new Date('2026-01-05T00:00:00Z'))
    expect(early.status).toBe('trial')
    expect(early.entitled).toBe(true)
    expect(early.daysLeft).toBe(10)

    const late = licenceFor(PAID, config, new Date('2026-02-01T00:00:00Z'))
    expect(late.status).toBe('expired')
    expect(late.entitled).toBe(false)
    expect(late.summary).toContain('trial ended')
  })

  it('treats a subscription as a subscription', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const licence = licenceFor(PAID, { [LICENCE_KEY]: startSubscription(now) }, now)
    expect(licence.status).toBe('active')
    expect(licence.entitled).toBe(true)
  })

  it('ignores a licence that is not one', () => {
    expect(licenceFor(PAID, { [LICENCE_KEY]: 'yes please' }).entitled).toBe(false)
    expect(licenceFor(PAID, { [LICENCE_KEY]: { plan: 'free' } }).entitled).toBe(false)
  })
})
