/**
 * Boot smoke test.
 *
 * This imports the real `main.ts` in a DOM and asserts the application comes
 * up. It is the only check that proves the wiring works end to end: a valid
 * module graph (which `vite build` already proves) says nothing about whether
 * the bootstrap sequence actually runs, whether the plugin registers its
 * fields before the first render, or whether the login screen appears.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

/** Wait for the bootstrap promise chain to settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('application bootstrap', () => {
  let root: HTMLElement

  beforeAll(async () => {
    root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    // The Supabase env vars are absent in tests, so the app takes the
    // "not configured" path and then renders the login screen.
    await import('./main')
    await settle()
  })

  afterAll(() => {
    vi.resetModules()
  })

  it('mounts something into #app', () => {
    expect(root.children.length).toBeGreaterThan(0)
    expect(root.textContent?.length ?? 0).toBeGreaterThan(0)
  })

  it('declares every plugin this bundle ships', () => {
    const registry = window.mekholi?.registry
    expect(registry).toBeDefined()

    const ids = (registry?.list() ?? []).map((entry) => entry.id).sort()
    expect(ids).toEqual(['batch-expiry', 'loyalty-lite', 'serial-numbers', 'variants', 'warranty'])
  })

  it('leaves plugins disabled until a shop enables them', () => {
    // Without Supabase there is no shop and therefore no plugin state: the
    // app must still come up, with core screens and no plugin surfaces.
    const registry = window.mekholi?.registry
    const statuses = (registry?.list() ?? []).map((entry) => entry.status)
    expect(statuses.every((status) => status === 'disabled')).toBe(true)
  })

  it('keeps plugin product fields out of the form until the plugin is on', () => {
    const keys = (window.mekholi?.registry.productFields.items ?? []).map((f) => f.key)
    expect(keys).toHaveLength(0)
  })

  it('keeps plugin navigation out of the sidebar until the plugin is on', () => {
    const nav = window.mekholi?.registry.nav.items ?? []
    expect(nav.find((item) => item.id === 'batch-expiry')).toBeUndefined()
  })

  it('renders the login screen when there is no session', () => {
    const status = window.mekholi?.session.state.status
    expect(status).toBe('anonymous')

    // The login card's heading.
    expect(root.textContent).toContain('Sign in')
  })

  it('exposes the diagnostics handle', () => {
    expect(window.mekholi?.bus).toBeDefined()
    expect(window.mekholi?.session).toBeDefined()
    expect(window.mekholi?.router).toBeDefined()
  })
})
