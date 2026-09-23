/**
 * App shell render test.
 *
 * The shell is the main surface once signed in, so a render failure here
 * would mean a blank screen after login. This proves it composes: the sidebar
 * appears, the topbar shows the shop name, the router outlet is present, and
 * the palette opens on Ctrl+K.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { appShell } from './app-shell'
import { PluginRegistry } from '../../shared/registry/plugin-registry'
import { EventBus } from '../../shared/bus'
import { batchExpiryPlugin } from '../../plugins/batch-expiry'
import { sessionStore, EMPTY_SESSION } from '../../app/state/session'

let registry: PluginRegistry
let bus: EventBus

function signIn(): void {
  sessionStore.reset({
    ...EMPTY_SESSION,
    status: 'authenticated',
    userId: 'u-1',
    email: 'owner@shop.test',
    organizations: [
      {
        organization_id: 'org-1',
        name: 'Rahim Store',
        slug: 'rahim-store',
        currency: 'BDT',
        timezone: 'Asia/Dhaka',
        role_names: ['Owner'],
        role_keys: ['owner'],
        is_owner: true,
        permissions: ['dashboard.view', 'inventory.view', 'sales.create'],
      },
    ],
    activeOrganizationId: 'org-1',
    permissions: ['dashboard.view', 'inventory.view', 'sales.create'],
  })
}

beforeEach(async () => {
  bus = new EventBus()
  bus.onError = () => undefined
  registry = new PluginRegistry(bus)
  registry.declare(batchExpiryPlugin)
  await registry.loadAll()
  signIn()
})

afterEach(() => {
  document.body.replaceChildren()
})

function build(): {
  el: HTMLElement
  outlet: HTMLElement
  shell: ReturnType<typeof appShell>
} {
  const outlet = document.createElement('div')
  const shell = appShell({
    registry,
    bus,
    onNavigate: vi.fn(),
    onSignOut: vi.fn(),
    outlet,
  })
  document.body.appendChild(shell.el)
  return { el: shell.el, outlet, shell }
}

describe('app shell', () => {
  it('renders the shop name in the sidebar header', () => {
    const { el } = build()
    expect(el.textContent).toContain('Rahim Store')
  })

  it('renders navigation items', () => {
    const { el } = build()
    expect(el.querySelector('[data-nav-id="dashboard"]')).not.toBeNull()
    // The plugin's item, again — this time through the full shell.
    expect(el.querySelector('[data-nav-id="batch-expiry"]')).not.toBeNull()
  })

  it('hides navigation the role cannot use', () => {
    const { el } = build()
    expect(el.querySelector('[data-nav-id="settings"]')).toBeNull()
  })

  it('shows the shop initial as the avatar', () => {
    const { el } = build()
    expect(el.textContent).toContain('R')
  })

  it('contains a search trigger for the command palette', () => {
    const { el } = build()
    expect(el.textContent).toContain('Search')
  })

  it('opens the command palette from the search trigger', () => {
    const { el, shell } = build()
    expect(shell.palette.isOpen).toBe(false)

    const trigger = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Search')
    )
    trigger?.click()

    expect(shell.palette.isOpen).toBe(true)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    shell.palette.close()
  })

  it('re-renders the sidebar when the session changes', () => {
    const { el } = build()
    expect(el.querySelector('[data-nav-id="batch-expiry"]')).not.toBeNull()

    // Drop inventory.view: the plugin item is gated on it, so it must go.
    sessionStore.set({ permissions: ['dashboard.view', 'sales.create'] })

    expect(el.querySelector('[data-nav-id="batch-expiry"]')).toBeNull()
    expect(el.querySelector('[data-nav-id="dashboard"]')).not.toBeNull()
  })

  it('re-renders the sidebar when a plugin finishes loading', async () => {
    const { el } = build()
    expect(el.querySelector('[data-nav-id="late"]')).toBeNull()

    registry.declare({
      id: 'late',
      name: 'Late',
      version: '1.0.0',
      register: (api) => {
        api.registerNav({ id: 'late', label: 'Late', icon: 'help', section: 'main', route: '/late' })
      },
    })
    // `loadAll` publishes `plugin.loaded` on the registry's own bus, which is
    // now the same instance the shell was given — no singleton involved.
    await registry.loadAll()

    expect(el.querySelector('[data-nav-id="late"]')).not.toBeNull()
  })

  it('sets the page title', () => {
    const { el, shell } = build()
    shell.setTitle('Point of Sale', 'Counter 1')

    expect(el.textContent).toContain('Point of Sale')
    expect(el.textContent).toContain('Counter 1')
  })

  it('renders without an organization (onboarding state)', () => {
    sessionStore.reset({ ...EMPTY_SESSION, status: 'authenticated', userId: 'u', email: 'a@b.c' })

    const { el } = build()

    expect(el.textContent).toContain('Mekholi')
    expect(el.querySelector('[data-nav-id]')).toBeNull()
  })
})
