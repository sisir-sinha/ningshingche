import './styles/base.css'
import { env } from '@/app/env'
import { resolveShopTypes } from '@/shared/types/shop-profile'
import taxonomy from '../data/shop_categories.json'
import type { ShopCategoryTaxonomy } from '@/shared/types/shop-profile'

/**
 * Phase 0 entry point.
 *
 * Deliberately minimal: the platform (router, plugin registry, component kit,
 * auth) arrives in Phase 1. What this proves today is that the toolchain,
 * the design tokens, the icon sets and the taxonomy loader all work.
 */

function icon(name: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'material-symbols-rounded text-content-muted'
  el.setAttribute('aria-hidden', 'true')
  el.textContent = name
  return el
}

function stat(label: string, value: string, iconName: string): HTMLElement {
  const card = document.createElement('div')
  card.className =
    'flex items-center gap-3 rounded-lg border border-border bg-surface-raised p-4'

  card.append(icon(iconName))

  const body = document.createElement('div')
  const v = document.createElement('div')
  v.className = 'text-2xl font-semibold tabular'
  v.textContent = value
  const l = document.createElement('div')
  l.className = 'text-sm text-content-muted'
  l.textContent = label
  body.append(v, l)

  card.append(body)
  return card
}

function bootstrap(): void {
  const root = document.getElementById('app')
  if (!root) throw new Error('#app mount point not found')

  const resolved = resolveShopTypes(taxonomy as ShopCategoryTaxonomy)
  const plugins = new Set<string>()
  for (const t of resolved) {
    for (const p of t.recommendations.plugins) plugins.add(p)
    for (const p of t.recommendations.suggested ?? []) plugins.add(p)
  }

  const shell = document.createElement('main')
  shell.className = 'mx-auto flex min-h-full max-w-3xl flex-col gap-8 p-8'

  const header = document.createElement('header')
  header.className = 'space-y-1'

  const title = document.createElement('h1')
  title.className = 'text-3xl font-bold tracking-tight'
  title.textContent = env.appName

  const subtitle = document.createElement('p')
  subtitle.className = 'text-content-muted'
  subtitle.textContent =
    'Universal retail POS platform · Phase 0 — foundation'

  header.append(title, subtitle)

  const grid = document.createElement('div')
  grid.className = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4'
  grid.append(
    stat('Business types', String(resolved.length), 'storefront'),
    stat('Capability plugins', String(plugins.size), 'extension'),
    stat('Environment', env.environment, 'terminal'),
    stat('Supabase', env.isSupabaseConfigured ? 'connected' : 'not configured',
      env.isSupabaseConfigured ? 'cloud_done' : 'cloud_off'),
  )

  const note = document.createElement('div')
  note.className =
    'rounded-lg border border-border bg-surface-muted p-5 text-sm leading-relaxed text-content-muted'
  note.innerHTML = `
    <p class="mb-2 font-medium text-content">What is in place</p>
    <ul class="list-disc space-y-1 pl-5">
      <li>Vite + strict TypeScript + Tailwind, with the semantic token system from spec §38.</li>
      <li>16 Supabase migrations — 43 tables, RLS on every one, and the RPC write path.</li>
      <li>ESLint boundaries that make the §51 anti-pattern impossible, not just discouraged.</li>
      <li>Schema validation that runs the migrations against a real Postgres on every change.</li>
    </ul>`

  const list = document.createElement('div')
  const listTitle = document.createElement('h2')
  listTitle.className = 'text-sm font-semibold uppercase tracking-wide text-content-subtle'
  listTitle.textContent = 'Supported business types'
  const chips = document.createElement('div')
  chips.className = 'mt-3 flex flex-wrap gap-2'
  for (const t of resolved) {
    const chip = document.createElement('span')
    chip.className =
      'rounded-full border border-border bg-surface-raised px-3 py-1 text-sm'
    chip.textContent = t.nameBn ? `${t.name} · ${t.nameBn}` : t.name
    chips.append(chip)
  }
  list.append(listTitle, chips)

  shell.append(header, grid, note, list)
  root.replaceChildren(shell)
}

try {
  bootstrap()
} catch (error) {
  const root = document.getElementById('app')
  if (root) {
    root.textContent = `Mekholi failed to start: ${String(error)}`
  }
  console.error('[mekholi] bootstrap failed', error)
}
