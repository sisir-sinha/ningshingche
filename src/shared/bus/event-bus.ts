/**
 * EventBus — presentational event coordination (spec §36, §52).
 *
 * NOT the authority. The canonical event chain is the transactional outbox in
 * Postgres: loyalty accrual and accounting postings are triggers, so they
 * survive a closed tab and run identically for an Android client. This bus
 * only coordinates what is on screen.
 *
 * Guarantees:
 *  - Handlers are isolated; one throwing handler cannot block its siblings.
 *  - `on`/`once` return an unsubscribe function, so a view cannot leak a
 *    listener past its own lifetime.
 *  - Wildcard and per-aggregate subscriptions are first class.
 */

import type { AnyEvent, EventName, EventOfType } from './events'

/** Storage shape. The public API is fully typed; this cast is internal only. */
type StoredListener = (event: AnyEvent) => void

export type Listener<K extends EventName> = (event: EventOfType<K>) => void
export type Unsubscribe = () => void

interface WildcardSubscription {
  /** Original pattern, kept for diagnostics. */
  pattern: string
  matcher: RegExp
  listener: StoredListener
}

export interface BusStats {
  emitted: number
  delivered: number
  errors: number
}

/**
 * Turns a subscription pattern into a matcher.
 *   `sale.completed` → exact match only
 *   `sale.*`         → any event whose aggregate is `sale`
 *   `*`              → every event
 */
function compile(pattern: string): RegExp {
  if (pattern === '*') return /^.+$/
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`^${prefix}\\.`)
  }
  const exact = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${exact}$`)
}

export class EventBus {
  readonly #exact = new Map<EventName, Set<StoredListener>>()
  readonly #wildcards: WildcardSubscription[] = []
  #stats: BusStats = { emitted: 0, delivered: 0, errors: 0 }
  /** Set by tests to inspect what a handler threw. */
  #errorHook: ((error: unknown, type: EventName) => void) | null = null

  on<K extends EventName>(type: K, listener: Listener<K>): Unsubscribe {
    const stored = listener as unknown as StoredListener
    let bucket = this.#exact.get(type)
    if (!bucket) {
      bucket = new Set()
      this.#exact.set(type, bucket)
    }
    bucket.add(stored)
    return () => {
      bucket?.delete(stored)
      if (bucket && bucket.size === 0) this.#exact.delete(type)
    }
  }

  once<K extends EventName>(type: K, listener: Listener<K>): Unsubscribe {
    const off = this.on(type, (event) => {
      off()
      listener(event)
    })
    return off
  }

  /**
   * Subscribe to a pattern: `sale.*` or `*`. Used by the plugin host, which
   * cannot know at compile time which events a plugin will care about.
   */
  onPattern(pattern: string, listener: (event: AnyEvent) => void): Unsubscribe {
    const sub: WildcardSubscription = { pattern, matcher: compile(pattern), listener }
    this.#wildcards.push(sub)
    return () => {
      const at = this.#wildcards.indexOf(sub)
      if (at >= 0) this.#wildcards.splice(at, 1)
    }
  }

  /** Spec §36: `bus.onDomain('sale', handler)`. */
  onDomain(aggregate: string, listener: (event: AnyEvent) => void): Unsubscribe {
    return this.onPattern(`${aggregate}.*`, listener)
  }

  emit<K extends EventName>(type: K, event: EventOfType<K>): void {
    this.#stats.emitted += 1
    const payload = event as unknown as AnyEvent
    const name = type as EventName

    const exact = this.#exact.get(name)
    if (exact) {
      // Copy before iterating: a `once` handler unsubscribes mid-dispatch.
      for (const listener of [...exact]) this.#invoke(listener, payload, name)
    }

    for (const sub of [...this.#wildcards]) {
      if (sub.matcher.test(name)) this.#invoke(sub.listener, payload, name)
    }
  }

  #invoke(listener: StoredListener, event: AnyEvent, name: EventName): void {
    this.#stats.delivered += 1
    try {
      listener(event)
    } catch (error) {
      this.#stats.errors += 1
      if (this.#errorHook) {
        this.#errorHook(error, name)
      } else {
        console.error(`[event-bus] handler for "${name}" threw`, error)
      }
    }
  }

  /** Number of live exact-match listeners. Used by tests and the diagnostics view. */
  get listenerCount(): number {
    let n = this.#wildcards.length
    for (const bucket of this.#exact.values()) n += bucket.size
    return n
  }

  get stats(): Readonly<BusStats> {
    return this.#stats
  }

  /** Route handler failures somewhere other than the console. */
  set onError(hook: ((error: unknown, type: EventName) => void) | null) {
    this.#errorHook = hook
  }

  /** Drop everything. Called on logout so no view outlives its session. */
  clear(): void {
    this.#exact.clear()
    this.#wildcards.length = 0
  }
}

/**
 * Wraps a handler so it ignores repeat deliveries of the same event id.
 *
 * The same domain event arrives twice in normal operation — once from the
 * local RPC return, once from Realtime. Handlers must not double-apply.
 */
export function dedupe<A extends { id: string }, R>(
  handler: (event: A) => R,
  capacity = 512
): (event: A) => R | undefined {
  const seen = new Set<string>()
  const order: string[] = []
  return (event) => {
    if (seen.has(event.id)) return undefined
    seen.add(event.id)
    order.push(event.id)
    if (order.length > capacity) {
      const evicted = order.shift()
      if (evicted) seen.delete(evicted)
    }
    return handler(event)
  }
}
