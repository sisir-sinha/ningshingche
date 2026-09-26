/**
 * The plugin worker — where plugin code is allowed to run (spec §31, §51).
 *
 * ── Why this is not a Web Worker ─────────────────────────────────────────
 * The obvious reading of "run plugins in a worker" is `new Worker(...)`. It is
 * the wrong tool here and it is worth saying why in the file rather than in a
 * commit message: a plugin registers *closures* — a POS panel that returns DOM,
 * a middleware that reads the registry, a scan resolver that calls the shop's
 * repositories. None of that survives `structuredClone`. Moving plugins into a
 * real worker would mean a message protocol for every slot, and the plugin
 * would still have to re-enter the main thread to draw anything.
 *
 * What a shop actually needs protecting from is narrower and very real:
 *
 *   * a plugin that never resolves, holding up a sale for ever;
 *   * a plugin that throws, taking the caller down with it;
 *   * a plugin that is still working after the shopkeeper switched it off;
 *   * three plugins trampling each other's turn in an unpredictable order.
 *
 * So this is a *supervisor*: ordered, deadlined, cancellable, isolated, and
 * observable. Every piece of plugin work in the app goes through `run`, which
 * means "switched off" can be made to mean "stops mid-flight", and one slow
 * plugin can be named in a diagnostics table rather than guessed at.
 */

/** A single supervised unit of plugin work. */
export interface WorkerJob<T> {
  pluginId: string
  /** What is being run, for diagnostics: `middleware:sale.complete`. */
  action: string
  run: (signal: AbortSignal) => T | Promise<T>
  /** Overrides the worker's default budget for this one job. */
  timeoutMs?: number
}

export type JobOutcome<T> =
  | { status: 'ok'; value: T; ms: number }
  | { status: 'failed'; error: Error; ms: number }
  | { status: 'timeout'; ms: number }
  | { status: 'cancelled'; ms: number }

/** Running totals per plugin, for the Plugins screen's diagnostics. */
export interface PluginWorkerStat {
  pluginId: string
  runs: number
  failures: number
  timeouts: number
  cancellations: number
  /** Total wall time this plugin has held the worker, in milliseconds. */
  totalMs: number
  slowestMs: number
  lastAction: string
}

export interface PluginWorkerOptions {
  /** Default budget for one job. Beyond this the job is abandoned. */
  timeoutMs?: number
  /**
   * How many consecutive timeouts or failures a plugin may have before the
   * worker stops giving it turns. A plugin that is broken *now* should not be
   * asked again on every keystroke.
   */
  tripAfter?: number
  onReport?: (report: WorkerReport) => void
  now?: () => number
}

export interface WorkerReport {
  pluginId: string
  action: string
  status: JobOutcome<unknown>['status']
  ms: number
  error?: string
}

export class PluginWorker {
  readonly #timeoutMs: number
  readonly #tripAfter: number
  readonly #now: () => number
  readonly #onReport: ((report: WorkerReport) => void) | undefined

  /** One controller per plugin: cancelling a plugin cancels all of its work. */
  readonly #controllers = new Map<string, Set<AbortController>>()
  readonly #stats = new Map<string, PluginWorkerStat>()
  /** Consecutive bad outcomes. Reset by a good one. */
  readonly #strikes = new Map<string, number>()
  readonly #tripped = new Set<string>()

  constructor(options: PluginWorkerOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? 2000
    this.#tripAfter = options.tripAfter ?? 3
    this.#now = options.now ?? (() => Date.now())
    this.#onReport = options.onReport
  }

  /**
   * Runs one job under supervision. Never throws: the caller gets an outcome
   * and decides. That is the whole contract — core code should not need a
   * `try` around every plugin it consults.
   */
  async run<T>(job: WorkerJob<T>): Promise<JobOutcome<T>> {
    if (this.#tripped.has(job.pluginId)) {
      return { status: 'cancelled', ms: 0 }
    }

    const controller = new AbortController()
    this.#track(job.pluginId, controller)
    const started = this.#now()
    const budget = job.timeoutMs ?? this.#timeoutMs

    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), budget)
      })
      const work = (async () => job.run(controller.signal))()
      const result = await Promise.race([work.then((value) => ({ value })), timeout])

      if (result === 'timeout') {
        controller.abort()
        // The job may still settle later; its result is ignored, and an
        // unhandled rejection from an abandoned job must not reach the console
        // as an application error.
        void work.catch(() => undefined)
        return this.#finish(job, 'timeout', started, undefined)
      }
      if (controller.signal.aborted) {
        return this.#finish(job, 'cancelled', started, undefined)
      }
      return this.#finish(job, 'ok', started, undefined, result.value)
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error))
      if (controller.signal.aborted) return this.#finish(job, 'cancelled', started, wrapped)
      return this.#finish(job, 'failed', started, wrapped)
    } finally {
      if (timer) clearTimeout(timer)
      this.#untrack(job.pluginId, controller)
    }
  }

  /**
   * Stops everything this plugin has in flight.
   *
   * This is what makes "switched off" honest. Without it, a plugin disabled
   * while its work was awaiting a network call would still resolve afterwards
   * and write to a screen it no longer owns.
   */
  cancel(pluginId: string): number {
    const controllers = this.#controllers.get(pluginId)
    if (!controllers) return 0
    let stopped = 0
    for (const controller of controllers) {
      if (!controller.signal.aborted) {
        controller.abort()
        stopped += 1
      }
    }
    controllers.clear()
    this.#controllers.delete(pluginId)
    this.#strikes.delete(pluginId)
    this.#tripped.delete(pluginId)
    return stopped
  }

  cancelAll(): void {
    for (const pluginId of [...this.#controllers.keys()]) this.cancel(pluginId)
  }

  /** True when the worker has stopped giving this plugin turns. */
  isTripped(pluginId: string): boolean {
    return this.#tripped.has(pluginId)
  }

  /** Gives a tripped plugin its turns back — what \"Try again\" means. */
  reset(pluginId: string): void {
    this.#tripped.delete(pluginId)
    this.#strikes.delete(pluginId)
  }

  get stats(): readonly PluginWorkerStat[] {
    return [...this.#stats.values()]
  }

  statFor(pluginId: string): PluginWorkerStat | undefined {
    return this.#stats.get(pluginId)
  }

  clearStats(): void {
    this.#stats.clear()
  }

  // ── internals ───────────────────────────────────────────────────────────

  #track(pluginId: string, controller: AbortController): void {
    let set = this.#controllers.get(pluginId)
    if (!set) {
      set = new Set()
      this.#controllers.set(pluginId, set)
    }
    set.add(controller)
  }

  #untrack(pluginId: string, controller: AbortController): void {
    this.#controllers.get(pluginId)?.delete(controller)
  }

  #finish<T>(
    job: WorkerJob<T>,
    status: JobOutcome<T>['status'],
    started: number,
    error?: Error,
    value?: T
  ): JobOutcome<T> {
    const ms = this.#now() - started
    const stat = this.#stats.get(job.pluginId) ?? {
      pluginId: job.pluginId,
      runs: 0,
      failures: 0,
      timeouts: 0,
      cancellations: 0,
      totalMs: 0,
      slowestMs: 0,
      lastAction: job.action,
    }
    stat.runs += 1
    stat.totalMs += ms
    stat.slowestMs = Math.max(stat.slowestMs, ms)
    stat.lastAction = job.action
    if (status === 'failed') stat.failures += 1
    if (status === 'timeout') stat.timeouts += 1
    if (status === 'cancelled') stat.cancellations += 1
    this.#stats.set(job.pluginId, stat)

    if (status === 'ok') {
      this.#strikes.delete(job.pluginId)
    } else if (status === 'failed' || status === 'timeout') {
      const strikes = (this.#strikes.get(job.pluginId) ?? 0) + 1
      this.#strikes.set(job.pluginId, strikes)
      if (strikes >= this.#tripAfter) this.#tripped.add(job.pluginId)
    }

    this.#onReport?.({
      pluginId: job.pluginId,
      action: job.action,
      status,
      ms,
      ...(error ? { error: error.message } : {}),
    })

    if (status === 'ok') return { status, value: value as T, ms }
    if (status === 'failed') return { status, error: error ?? new Error('unknown'), ms }
    return { status, ms } as JobOutcome<T>
  }
}
