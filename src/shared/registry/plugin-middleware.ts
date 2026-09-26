/**
 * Middleware — the seam plugins act *through* rather than *around*.
 *
 * Until now a plugin could add screens, panels and fields, but it could not
 * take part in something the core was already doing. Anything that wanted to —
 * loyalty adjusting a total, warranty writing a promise when a sale completes,
 * a scale reading a label — had to be wired into the core by name, which is
 * exactly the coupling the plugin system exists to avoid (spec §51).
 *
 * A middleware is a plugin's turn in a core action:
 *
 *     api.registerMiddleware({
 *       action: 'sale.complete',
 *       handler: async (ctx, next) => {
 *         ctx.payload.note = 'seen by loyalty'
 *         return next()
 *       },
 *     })
 *
 * The rules, all of them deliberate:
 *
 *   * **Ordered, and the order is declared.** `priority` ascending, ties broken
 *     by registration order. Two plugins that both adjust a total must not
 *     depend on module import order for the answer.
 *   * **A plugin may veto.** Returning `ctx.reject(reason)` stops the chain and
 *     the core is told who stopped it and why. A sale that must not happen is
 *     more important than a plugin that is polite.
 *   * **A plugin may not silently break the action.** A handler that throws or
 *     never resolves is skipped by the worker's deadline, recorded against that
 *     plugin, and the chain carries on. The shop keeps selling.
 *   * **Payload changes are visible, not magical.** Middleware mutates
 *     `ctx.payload`, and the caller receives the payload back; nothing is
 *     patched behind the caller's back.
 */

import type { PluginWorker } from './plugin-worker'

export interface MiddlewareContext<P> {
  readonly action: string
  /** The value flowing through the chain. Middleware may modify it. */
  payload: P
  /** Who is running this chain — the core, always. Never a plugin. */
  readonly origin: string
  /** Stop the chain. The caller sees `{ ok: false, reason, pluginId }`. */
  reject: (reason: string) => MiddlewareVeto
  /** Read-only note for the diagnostics trail. */
  note: (message: string) => void
}

export interface MiddlewareVeto {
  readonly __veto: true
  reason: string
}

export type MiddlewareNext = () => Promise<void | MiddlewareVeto>

export interface MiddlewareDefinition<P = unknown> {
  /** The core action this takes part in, e.g. `sale.complete`. */
  action: string
  /** Ascending. Default 100. */
  priority?: number
  handler: (ctx: MiddlewareContext<P>, next: MiddlewareNext) => void | MiddlewareVeto | Promise<void | MiddlewareVeto>
  /** Per-handler budget; falls back to the worker's default. */
  timeoutMs?: number
  /** Filled in by the host. */
  source?: string
}

export interface DispatchResult<P> {
  ok: boolean
  payload: P
  /** Set when a plugin vetoed. */
  reason?: string
  /** The plugin that vetoed, or that was skipped. */
  vetoedBy?: string
  /** Plugins whose turn was abandoned — timed out, threw, or was cancelled. */
  skipped: Array<{ pluginId: string; why: string }>
  notes: string[]
  ms: number
}

export function isVeto(value: unknown): value is MiddlewareVeto {
  return typeof value === 'object' && value !== null && '__veto' in value
}

/**
 * Runs the chain for one action.
 *
 * Every handler runs inside the worker, so \"a plugin hung\" costs the caller
 * the deadline once rather than for ever, and a plugin that has been switched
 * off mid-chain is cancelled rather than finished.
 */
export async function runMiddleware<P>(
  action: string,
  payload: P,
  middleware: readonly MiddlewareDefinition[],
  worker: PluginWorker,
  options: { origin?: string; now?: () => number } = {}
): Promise<DispatchResult<P>> {
  const now = options.now ?? (() => Date.now())
  const started = now()
  const chain = middleware
    .filter((entry) => entry.action === action)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (a.entry.priority ?? 100) - (b.entry.priority ?? 100) || a.index - b.index)
    .map(({ entry }) => entry)

  const skipped: DispatchResult<P>['skipped'] = []
  const notes: string[] = []
  const context: MiddlewareContext<P> = {
    action,
    payload,
    origin: options.origin ?? 'core',
    reject: (reason) => ({ __veto: true, reason }),
    note: (message) => notes.push(message),
  }

  for (const entry of chain) {
    const pluginId = entry.source ?? 'unknown'
    // `next` exists so a handler reads like middleware everywhere else does.
    // The chain is driven by this loop, not by recursion, so a handler that
    // forgets to call `next` cannot silently swallow the plugins behind it —
    // it only gives up its own turn.
    let calledNext = false
    const next: MiddlewareNext = async () => {
      calledNext = true
    }

    const outcome = await worker.run<void | MiddlewareVeto>({
      pluginId,
      action: `middleware:${action}`,
      ...(entry.timeoutMs !== undefined ? { timeoutMs: entry.timeoutMs } : {}),
      run: async () => entry.handler(context as MiddlewareContext<unknown>, next),
    })

    if (outcome.status === 'ok' && isVeto(outcome.value)) {
      return {
        ok: false,
        payload: context.payload,
        reason: outcome.value.reason,
        vetoedBy: pluginId,
        skipped,
        notes,
        ms: now() - started,
      }
    }

    if (outcome.status === 'failed') {
      skipped.push({ pluginId, why: outcome.error.message })
    } else if (outcome.status === 'timeout') {
      skipped.push({ pluginId, why: `took longer than its turn allows (${outcome.ms}ms)` })
    } else if (outcome.status === 'cancelled') {
      skipped.push({ pluginId, why: 'switched off while it was working' })
    } else if (!calledNext) {
      // Not an error: a handler that only reads the payload has no reason to
      // call `next`. Recorded so the trail is complete.
      notes.push(`${pluginId} did not call next()`)
    }
  }

  return { ok: true, payload: context.payload, skipped, notes, ms: now() - started }
}
