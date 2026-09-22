// Tiny vanilla pub/sub store — ~60 lines
export function createStore<T extends object>(initial: T) {
  let state = reactive(initial) as T
  const subs = new Set<() => void>()
  function reactive<O extends object>(obj: O): O {
    return new Proxy(obj, {
      set(t: any, k: string | symbol, v: any) {
        t[k] = v
        subs.forEach(fn => fn())
        return true
      }
    })
  }
  return {
    get(): T { return state },
    set(patch: Partial<T>) { Object.assign(state, patch) },
    patch(fn: (s: T) => void) { fn(state); subs.forEach(f => f()) },
    subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn) },
    reset() { state = reactive({ ...initial } as T); subs.forEach(f => f()) }
  }
}
