/**
 * Minimal observable store.
 *
 * No framework, no proxy magic: `state` is an immutable snapshot, `set`
 * replaces it, subscribers are told. `select` exists because most views care
 * about one field and should not re-render when an unrelated one changes.
 */

export type StoreListener<T> = (state: Readonly<T>) => void

export class Store<T extends object> {
  #state: T
  readonly #listeners = new Set<StoreListener<T>>()

  constructor(initial: T) {
    this.#state = initial
  }

  get state(): Readonly<T> {
    return this.#state
  }

  set(patch: Partial<T>): void {
    let changed = false
    for (const key of Object.keys(patch) as (keyof T)[]) {
      if (!Object.is(this.#state[key], patch[key])) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.#state = { ...this.#state, ...patch }
    this.#notify()
  }

  update(transform: (current: T) => T): void {
    const next = transform(this.#state)
    if (Object.is(next, this.#state)) return
    this.#state = next
    this.#notify()
  }

  subscribe(listener: StoreListener<T>): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Subscribe to a derived value. Fires only when the projection changes. */
  select<U>(selector: (state: Readonly<T>) => U, listener: (value: U) => void): () => void {
    let last = selector(this.#state)
    return this.subscribe((state) => {
      const next = selector(state)
      if (Object.is(next, last)) return
      last = next
      listener(next)
    })
  }

  /** Read a derived value once. */
  pick<U>(selector: (state: Readonly<T>) => U): U {
    return selector(this.#state)
  }

  reset(state: T): void {
    this.#state = state
    this.#notify()
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(this.#state)
      } catch (error) {
        console.error('[store] subscriber threw', error)
      }
    }
  }
}
