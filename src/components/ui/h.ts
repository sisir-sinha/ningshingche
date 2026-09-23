/**
 * A tiny typed element builder.
 *
 * Vanilla TypeScript, no framework — but `document.createElement` + manual
 * property assignment gets unreadable fast in a POS with hundreds of nodes.
 * `h()` keeps the tag name, the attribute names and the return type linked,
 * so `h('input', { value })` type-checks and `h('div').dataset` still works.
 *
 * Everything else in the component kit is built on this.
 */

type AttrValue = string | number | boolean | null | undefined
export type Child = Node | string | number | null | undefined | false | readonly Child[]

/** An `on*` attribute is wired with addEventListener at runtime. */
type Handler = (event: never) => void

export interface Attrs {
  class?: string
  text?: string
  dataset?: Record<string, string>
  style?: Partial<CSSStyleDeclaration>
  [attr: string]:
    | AttrValue
    | Handler
    | Record<string, string>
    | Partial<CSSStyleDeclaration>
    | undefined
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)

  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue

      if (key === 'class') {
        el.className = String(value)
      } else if (key === 'text') {
        el.textContent = String(value)
      } else if (key === 'dataset' && typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, string>)) {
          el.dataset[k] = v
        }
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value as Partial<CSSStyleDeclaration>)
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as unknown as EventListener)
      } else if (key in el && key !== 'list' && key !== 'form') {
        // `value`, `checked`, `disabled`, `href` … set as properties so the
        // DOM reflects them immediately rather than only as attributes.
        ;(el as unknown as Record<string, unknown>)[key] = value
      } else if (value === true) {
        el.setAttribute(key, '')
      } else {
        el.setAttribute(key, String(value))
      }
    }
  }

  append(el, children)
  return el
}

/** Append children, skipping the falsy ones so `{cond && node}` works inline. */
/** `Array.isArray` does not narrow a `readonly Child[]`, so guard explicitly. */
function isChildArray(value: Child): value is readonly Child[] {
  return Array.isArray(value)
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === '') continue
    if (isChildArray(child)) {
      append(parent, child)
    } else if (child instanceof Node) {
      parent.appendChild(child)
    } else {
      parent.appendChild(document.createTextNode(String(child)))
    }
  }
}

/** Replace a container's contents in one call. */
export function mount(parent: Element, ...children: Child[]): void {
  parent.replaceChildren()
  append(parent, children)
}

/** Material Symbols Rounded icon (spec §37). */
export function icon(name: string, className = ''): HTMLSpanElement {
  return h('span', {
    class: `material-symbols-rounded select-none ${className}`.trim(),
    'aria-hidden': 'true',
    text: name,
  })
}

/** A visually hidden label, for inputs whose purpose is obvious on screen. */
export function srOnly(text: string): HTMLSpanElement {
  return h('span', { class: 'sr-only', text })
}
