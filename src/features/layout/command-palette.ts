/**
 * Command palette (spec §39 — "keyboard first, mouse optional").
 *
 * A cashier should never have to hunt through a menu. Ctrl+K, type three
 * letters, Enter. Results come from navigation, plugin-registered shortcuts,
 * and anything a plugin contributes through `registerShortcut`.
 */

import { h, icon } from '../../components/ui/h'
import { flattenNavigation } from './navigation'
import type { PluginRegistry } from '../../shared/registry/plugin-registry'

export interface Command {
  id: string
  label: string
  icon: string
  /** Section header in the result list. */
  group: string
  /** Lowercase haystack for matching. */
  keywords: string
  run: () => void
  /** Shown right-aligned, e.g. `Ctrl P`. */
  hint?: string
}

export interface PaletteOptions {
  registry: PluginRegistry
  onNavigate: (path: string) => void
  /** Extra commands from the shell: sign out, switch shop, toggle theme. */
  extraCommands?: () => Command[]
}

const MAX_RESULTS = 8

export class CommandPalette {
  readonly #registry: PluginRegistry
  readonly #onNavigate: (path: string) => void
  readonly #extra: () => Command[]

  #backdrop: HTMLDivElement | null = null
  #listEl: HTMLUListElement | null = null
  #inputEl: HTMLInputElement | null = null
  #results: Command[] = []
  #cursor = 0
  #keyHandler: ((event: KeyboardEvent) => void) | null = null

  constructor(options: PaletteOptions) {
    this.#registry = options.registry
    this.#onNavigate = options.onNavigate
    this.#extra = options.extraCommands ?? (() => [])
  }

  /** Collect every command the caller is entitled to see. */
  #commands(): Command[] {
    const nav: Command[] = flattenNavigation(this.#registry).map((item) => ({
      id: `nav:${item.id}`,
      label: item.label,
      icon: item.icon,
      group: 'Go to',
      keywords: `${item.label} ${item.route}`.toLowerCase(),
      run: () => this.#onNavigate(item.route),
    }))

    const shortcuts: Command[] = this.#registry.shortcuts.items.map((s) => ({
      id: `shortcut:${s.action}`,
      label: s.label,
      icon: 'keyboard_command_key',
      group: 'Actions',
      keywords: `${s.label} ${s.action}`.toLowerCase(),
      hint: s.combo,
      run: () => s.handler(),
    }))

    return [...nav, ...shortcuts, ...this.#extra()]
  }

  open(initialQuery = ''): void {
    if (this.#backdrop) return

    this.#inputEl = h('input', {
      type: 'text',
      class:
        'h-12 w-full border-b border-border bg-transparent px-4 text-sm text-content ' +
        'placeholder:text-content-subtle focus:outline-none',
      placeholder: 'Search pages and actions…',
      autocomplete: 'off',
      spellcheck: false,
      value: initialQuery,
      'aria-label': 'Search pages and actions',
      'aria-controls': 'palette-results',
    })
    this.#inputEl.addEventListener('input', () => this.#search(this.#inputEl?.value ?? ''))

    this.#listEl = h('ul', {
      id: 'palette-results',
      class: 'max-h-80 overflow-y-auto p-2',
      role: 'listbox',
      'aria-label': 'Results',
    })

    const panel = h(
      'div',
      {
        class:
          'w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface shadow-2xl ' +
          'animate-slide-up',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Command palette',
      },
      this.#inputEl,
      this.#listEl
    )

    this.#backdrop = h('div', {
      class: 'fixed inset-0 z-[95] flex items-start justify-center bg-black/40 pt-[15vh] px-4 animate-fade-in',
    })
    this.#backdrop.appendChild(panel)
    this.#backdrop.addEventListener('mousedown', (event) => {
      if (event.target === this.#backdrop) this.close()
    })

    this.#keyHandler = (event: KeyboardEvent): void => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          this.close()
          break
        case 'ArrowDown':
          event.preventDefault()
          this.#move(1)
          break
        case 'ArrowUp':
          event.preventDefault()
          this.#move(-1)
          break
        case 'Enter': {
          event.preventDefault()
          const chosen = this.#results[this.#cursor]
          if (chosen) {
            this.close()
            chosen.run()
          }
          break
        }
        default:
          break
      }
    }
    document.addEventListener('keydown', this.#keyHandler, true)
    document.body.appendChild(this.#backdrop)
    this.#inputEl.focus()
    this.#search(initialQuery)
  }

  close(): void {
    if (this.#keyHandler) document.removeEventListener('keydown', this.#keyHandler, true)
    this.#backdrop?.remove()
    this.#backdrop = null
    this.#listEl = null
    this.#inputEl = null
    this.#results = []
    this.#cursor = 0
  }

  get isOpen(): boolean {
    return this.#backdrop !== null
  }

  // ── Matching ──────────────────────────────────────────────────────────

  /**
   * Subsequence match with a bonus for prefix and word-boundary hits, so
   * "pos" beats "expenses" for the query "po" and "cust" finds "Customers".
   */
  #score(query: string, haystack: string): number {
    if (query === '') return 1
    if (haystack.startsWith(query)) return 100
    if (haystack.includes(query)) return 60

    let score = 0
    let qi = 0
    let previousMatched = false
    for (let hi = 0; hi < haystack.length && qi < query.length; hi += 1) {
      if (haystack[hi] === query[qi]) {
        score += previousMatched ? 3 : 5
        qi += 1
        previousMatched = true
      } else {
        previousMatched = false
      }
    }
    return qi === query.length ? score : 0
  }

  #search(rawQuery: string): void {
    const query = rawQuery.trim().toLowerCase()
    const all = this.#commands()

    const scored = all
      .map((command) => ({ command, score: this.#score(query, `${command.label} ${command.keywords}`) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label))

    this.#results = scored.slice(0, MAX_RESULTS).map((entry) => entry.command)
    this.#cursor = 0
    this.#render()
  }

  #move(delta: number): void {
    if (this.#results.length === 0) return
    this.#cursor = (this.#cursor + delta + this.#results.length) % this.#results.length
    this.#render()
    this.#listEl?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }

  #render(): void {
    const list = this.#listEl
    if (!list) return
    list.replaceChildren()

    if (this.#results.length === 0) {
      list.appendChild(
        h(
          'li',
          { class: 'px-3 py-6 text-center text-sm text-content-subtle', text: 'No matches.' }
        )
      )
      return
    }

    let lastGroup = ''
    this.#results.forEach((command, index) => {
      if (command.group !== lastGroup) {
        lastGroup = command.group
        list.appendChild(
          h('li', {
            class: 'px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-content-subtle',
            text: command.group,
            role: 'presentation',
          })
        )
      }

      const selected = index === this.#cursor
      const row = h(
        'li',
        {
          class:
            `flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ` +
            (selected ? 'bg-primary/10 text-content' : 'text-content-muted hover:bg-surface-muted'),
          role: 'option',
          'aria-selected': String(selected),
          dataset: { selected: String(selected) },
        },
        icon(command.icon, 'text-lg shrink-0'),
        h('span', { class: 'flex-1 truncate', text: command.label }),
        command.hint
          ? h('kbd', {
              class:
                'rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono ' +
                'text-[10px] text-content-subtle',
              text: command.hint,
            })
          : null
      )

      row.addEventListener('mouseenter', () => {
        this.#cursor = index
        this.#render()
      })
      row.addEventListener('click', () => {
        this.close()
        command.run()
      })

      list.appendChild(row)
    })
  }
}

/**
 * Global shortcut dispatcher. Registered combos from plugins and the shell are
 * matched here, so a plugin can bind `F4` without touching document itself.
 */
export function installShortcuts(
  registry: PluginRegistry,
  extras: readonly { combo: string; handler: () => void }[] = []
): () => void {
  const normalize = (combo: string): string =>
    combo
      .toLowerCase()
      .split('+')
      .map((part) => part.trim())
      .sort()
      .join('+')

  const handler = (event: KeyboardEvent): void => {
    const parts: string[] = []
    if (event.ctrlKey) parts.push('ctrl')
    if (event.metaKey) parts.push('meta')
    if (event.shiftKey) parts.push('shift')
    if (event.altKey) parts.push('alt')
    parts.push(event.key.toLowerCase())
    const pressed = normalize(parts.join('+'))

    const bound: { combo: string; run: () => void }[] = [
      ...registry.shortcuts.items.map((s) => ({ combo: s.combo, run: s.handler })),
      ...extras.map((e) => ({ combo: e.combo, run: e.handler })),
    ]
    const match = bound.find((entry) => normalize(entry.combo) === pressed)

    if (match) {
      event.preventDefault()
      match.run()
    }
  }

  document.addEventListener('keydown', handler)
  return () => document.removeEventListener('keydown', handler)
}
