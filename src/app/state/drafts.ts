/**
 * Form draft persistence.
 *
 * Every form saves what the user has typed to localStorage on every
 * keystroke, and the draft is only removed when the form submits
 * successfully. A shopkeeper who types a 12-field product form and then hits
 * a network error — or a signup that runs into an email rate limit — should
 * never have to type it again.
 *
 * Two deliberate exclusions:
 *
 *  - Password fields are never persisted. A draft is meant to survive a
 *    refresh, not to become a plaintext credential store on a shared POS
 *    machine.
 *  - Drafts are keyed per form, not per user, because the login screen is
 *    precisely where we do not yet know who the user is. Keys should
 *    therefore never contain user data — `products.form.new`, not
 *    `products.form.<email>`.
 */

const PREFIX = 'mekholi.draft.'
const DEBOUNCE_MS = 250

type DraftValues = Record<string, string>

export function loadDraft(key: string): DraftValues | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const out: DraftValues = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return null
  }
}

export function saveDraft(key: string, values: DraftValues): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(values))
  } catch {
    // Quota or private-mode failure: losing the draft is acceptable, throwing
    // into the user's keystroke handler is not.
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* nothing useful to do */
  }
}

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

/** Fields we never persist: passwords, and anything opted out explicitly. */
function isDraftable(field: Field): boolean {
  if (field.type === 'password') return false
  return field.dataset.noDraft === undefined
}

/**
 * Stable per-field key. `id` first because that is what these forms set;
 * `name` next; positional index last so an anonymous field still round-trips.
 */
function fieldKey(field: Field, index: number): string {
  return field.id || field.name || `#${index}`
}

function fieldsIn(root: HTMLElement): Field[] {
  return Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select'
  )).filter(isDraftable)
}

function readField(field: Field): string {
  if (field instanceof HTMLInputElement && field.type === 'checkbox') {
    return field.checked ? '1' : ''
  }
  return field.value
}

function writeField(field: Field, value: string): void {
  if (field instanceof HTMLInputElement && field.type === 'checkbox') {
    field.checked = value === '1'
    return
  }
  // A select whose saved option no longer exists keeps its current value
  // rather than jumping to a blank entry.
  if (field instanceof HTMLSelectElement && ![...field.options].some((o) => o.value === value)) {
    return
  }
  field.value = value
}

/**
 * Re-apply the stored draft to `root`. For forms whose `select` options
 * arrive asynchronously: a select restored before its options exist keeps its
 * old value (writeField refuses to blank it), so the caller restores again
 * once the options have landed.
 */
export function restoreDraft(root: HTMLElement, key: string): void {
  const saved = loadDraft(key)
  if (!saved) return
  fieldsIn(root).forEach((field, index) => {
    const value = saved[fieldKey(field, index)]
    if (typeof value === 'string') writeField(field, value)
  })
}

export interface DraftBinding {
  /** Call after a successful submit — not before. */
  clear: () => void
  /** Detach the listeners (the draft stays stored). */
  unbind: () => void
}

/**
 * Restore any saved draft into `root`, then keep it updated as the user
 * types. Call once per form, after its fields exist in the DOM.
 */
export function bindDrafts(root: HTMLElement, key: string): DraftBinding {
  const saved = loadDraft(key)
  const fields = fieldsIn(root)

  if (saved) {
    fields.forEach((field, index) => {
      const value = saved[fieldKey(field, index)]
      if (typeof value === 'string') writeField(field, value)
    })
  }

  let timer: ReturnType<typeof setTimeout> | null = null

  const persist = (): void => {
    // Re-query rather than caching: forms like the product editor add and
    // remove plugin fields after this runs.
    const values: DraftValues = {}
    fieldsIn(root).forEach((field, index) => {
      values[fieldKey(field, index)] = readField(field)
    })
    saveDraft(key, values)
  }

  const onInput = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(persist, DEBOUNCE_MS)
  }

  root.addEventListener('input', onInput)
  root.addEventListener('change', onInput)

  return {
    clear: () => clearDraft(key),
    unbind: () => {
      if (timer) clearTimeout(timer)
      root.removeEventListener('input', onInput)
      root.removeEventListener('change', onInput)
    },
  }
}
