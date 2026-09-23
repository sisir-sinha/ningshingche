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

  it('loads the declared plugins before the first render', () => {
    const registry = window.mekholi?.registry
    expect(registry).toBeDefined()

    const results = registry?.list() ?? []
    expect(results).toHaveLength(1)
    expect(results[0]?.plugin.id).toBe('batch-expiry')
    expect(results[0]?.status).toBe('loaded')
  })

  it('has the plugin’s product fields registered', () => {
    const fields = window.mekholi?.registry.productFields.items ?? []
    const keys = fields.map((f) => f.key)

    expect(keys).toContain('batch_number')
    expect(keys).toContain('expiry_date')
    // Attribution: the sidebar and product form need to know who added these.
    expect(fields.every((f) => f.source === 'batch-expiry')).toBe(true)
  })

  it('has the plugin’s nav item registered', () => {
    const nav = window.mekholi?.registry.nav.items ?? []
    const item = nav.find((n) => n.id === 'batch-expiry')

    expect(item).toBeDefined()
    expect(item?.section).toBe('inventory')
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
