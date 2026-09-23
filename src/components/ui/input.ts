/**
 * Form controls (spec §14, §38).
 *
 * The whole point of `field()` is minimal data entry: one call produces a
 * labelled control with an error slot already wired up, so a form can render
 * a validation failure without restructuring anything.
 */

import { h, icon } from './h'

export interface FieldOptions {
  label?: string
  hint?: string
  error?: string | null
  required?: boolean
  class?: string
}

export interface InputOptions extends FieldOptions {
  id?: string
  type?: 'text' | 'number' | 'password' | 'email' | 'date' | 'datetime-local' | 'search' | 'tel'
  value?: string
  placeholder?: string
  autocomplete?: string
  inputmode?: 'numeric' | 'decimal' | 'text' | 'tel' | 'email'
  min?: number | string
  max?: number | string
  step?: number | string
  maxlength?: number
  autofocus?: boolean
  readonly?: boolean
  disabled?: boolean
  /** Leading icon inside the control, e.g. `search` or a currency symbol. */
  leadingIcon?: string
  /** Trailing text inside the control, e.g. `BDT`. */
  suffix?: string
  onInput?: (value: string, el: HTMLInputElement) => void
  onChange?: (value: string, el: HTMLInputElement) => void
  onEnter?: (value: string, el: HTMLInputElement) => void
}

/**
 * A labelled input with an error slot.
 * Returns the input; read `.value` or use `onInput`.
 */
export function input(options: InputOptions = {}): HTMLInputElement {
  const {
    id,
    type = 'text',
    value = '',
    placeholder,
    autocomplete,
    inputmode,
    min,
    max,
    step,
    maxlength,
    readonly,
    disabled,
    onInput,
    onChange,
    onEnter,
  } = options

  const el = h('input', {
    id,
    type,
    value,
    placeholder,
    autocomplete,
    inputmode,
    min,
    max,
    step,
    maxlength,
    // exactOptionalPropertyTypes rejects `autofocus: undefined`, so pass it
    // only when it was actually requested.
    ...(options.autofocus === true ? { autofocus: true } : {}),
    readonly,
    disabled,
    class:
      'w-full h-11 rounded-md border border-input bg-surface px-3 text-sm text-content ' +
      'placeholder:text-content-subtle ' +
      'focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring ' +
      'disabled:opacity-60 disabled:bg-surface-muted',
  })

  if (onInput) el.addEventListener('input', () => onInput(el.value, el))
  if (onChange) el.addEventListener('change', () => onChange(el.value, el))
  if (onEnter) {
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        onEnter(el.value, el)
      }
    })
  }

  return el
}

export interface TextAreaOptions extends FieldOptions {
  id?: string
  value?: string
  placeholder?: string
  rows?: number
  maxlength?: number
  onInput?: (value: string) => void
}

export function textarea(options: TextAreaOptions = {}): HTMLTextAreaElement {
  const { id, value = '', placeholder, rows = 3, maxlength, onInput } = options
  const el = h('textarea', {
    id,
    value,
    placeholder,
    rows,
    maxlength,
    class:
      'w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-content ' +
      'placeholder:text-content-subtle resize-y ' +
      'focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring',
  })
  if (onInput) el.addEventListener('input', () => onInput(el.value))
  return el
}

export interface SelectOptions extends FieldOptions {
  id?: string
  value?: string
  options: readonly { value: string; label: string }[]
  placeholder?: string
  onChange?: (value: string) => void
}

export function select(options: SelectOptions): HTMLSelectElement {
  const { id, value, options: items, placeholder, onChange } = options
  const el = h('select', {
    id,
    class:
      'w-full h-11 rounded-md border border-input bg-surface px-3 text-sm text-content ' +
      'focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring',
  })

  if (placeholder) {
    el.appendChild(h('option', { value: '', text: placeholder, disabled: true, selected: value === undefined || value === '' }))
  }
  for (const item of items) {
    el.appendChild(
      h('option', { value: item.value, text: item.label, selected: item.value === value })
    )
  }

  if (value) el.value = value
  if (onChange) el.addEventListener('change', () => onChange(el.value))
  return el
}

export interface CheckboxOptions extends FieldOptions {
  checked?: boolean
  label: string
  onChange?: (checked: boolean) => void
}

export function checkbox(options: CheckboxOptions): HTMLLabelElement {
  const { checked = false, label, onChange } = options
  const box = h('input', {
    type: 'checkbox',
    checked,
    class:
      'h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring cursor-pointer',
  })
  if (onChange) box.addEventListener('change', () => onChange(box.checked))

  return h(
    'label',
    { class: 'inline-flex items-center gap-2 text-sm text-content cursor-pointer select-none' },
    box,
    h('span', { text: label })
  )
}

/**
 * Wraps a control in a label, hint and error slot.
 *
 * Returns the wrapper plus helpers so a form can set an error later without
 * hunting for the node:
 *   const f = field('Sale price', priceInput)
 *   f.setError('Must be greater than zero')
 */
export function field(
  labelText: string | undefined,
  control: HTMLElement,
  options: FieldOptions = {}
): HTMLElement & { setError: (message: string | null) => void; control: HTMLElement } {
  const { hint, required, class: extraClass = '' } = options

  const errorSlot = h('p', { class: 'mt-1 text-xs text-danger hidden', role: 'alert' })
  const hintSlot = hint ? h('p', { class: 'mt-1 text-xs text-content-subtle', text: hint }) : null

  const labelEl = labelText
    ? h(
        'label',
        { class: 'mb-1.5 block text-sm font-medium text-content', for: control.id || undefined },
        labelText,
        required ? h('span', { class: 'text-danger ml-0.5', text: '*', 'aria-hidden': 'true' }) : null
      )
    : null

  const wrap = h(
    'div',
    { class: `w-full ${extraClass}`.trim() },
    labelEl,
    control,
    errorSlot,
    hintSlot
  ) as unknown as HTMLElement & {
    setError: (message: string | null) => void
    control: HTMLElement
  }

  wrap.control = control
  wrap.setError = (message) => {
    if (message) {
      errorSlot.textContent = message
      errorSlot.classList.remove('hidden')
      control.setAttribute('aria-invalid', 'true')
    } else {
      errorSlot.textContent = ''
      errorSlot.classList.add('hidden')
      control.removeAttribute('aria-invalid')
    }
  }

  if (options.error) wrap.setError(options.error)
  return wrap
}

/** A search box with an icon and a clear button. */
export function searchInput(
  placeholder: string,
  onSearch: (value: string) => void,
  options: { autofocus?: boolean; id?: string } = {}
): HTMLDivElement {
  let debounce: ReturnType<typeof setTimeout> | undefined

  const el = input({
    ...(options.id ? { id: options.id } : {}),
    type: 'search',
    placeholder,
    ...(options.autofocus === true ? { autofocus: true } : {}),
    autocomplete: 'off',
    class: 'pl-9',
  })

  const clear = h('button', {
    type: 'button',
    class:
      'absolute right-2 top-1/2 -translate-y-1/2 text-content-subtle hover:text-content ' +
      'hidden h-6 w-6 items-center justify-center rounded',
    'aria-label': 'Clear search',
  })
  clear.appendChild(icon('close', 'text-base'))
  clear.addEventListener('click', () => {
    el.value = ''
    clear.classList.add('hidden')
    onSearch('')
    el.focus()
  })

  el.addEventListener('input', () => {
    clear.classList.toggle('hidden', el.value === '')
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => onSearch(el.value), 150)
  })

  return h(
    'div',
    { class: 'relative w-full' },
    h('span', {
      class:
        'material-symbols-rounded absolute left-2.5 top-1/2 -translate-y-1/2 text-content-subtle text-lg pointer-events-none',
      'aria-hidden': 'true',
      text: 'search',
    }),
    el,
    clear
  )
}
