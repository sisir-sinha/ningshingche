/**
 * The acceptance test for the plugin architecture.
 *
 * The claim is: adding an industry plugin requires ZERO edits under
 * src/features/. These tests verify the observable half of that claim — a
 * plugin's registered nav item appears in the navigation model and in the
 * rendered sidebar, without this feature module knowing the plugin exists.
 *
 * The structural half (a plugin cannot import src/features/) is enforced by
 * tools/check-boundaries.mjs.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PluginRegistry } from '../../shared/registry/plugin-registry'
import { EventBus } from '../../shared/bus/event-bus'
import { batchExpiryPlugin } from '../../plugins/batch-expiry'
import { batchExpiryManifest } from '../../plugins/batch-expiry/manifest'
import { buildNavigation, CORE_NAV } from './navigation'
import { sidebar } from './sidebar'
import { sessionStore, EMPTY_SESSION } from '../../app/state/session'

let bus: EventBus
let registry: PluginRegistry

/** Sign in as a role holding every permission the nav needs. */
function signInAs(keys: string[]): void {
  sessionStore.reset({
    ...EMPTY_SESSION,
    status: 'authenticated',
    userId: 'u-1',
    email: 'owner@shop.test',
    organizations: [
      {
        organization_id: 'org-1',
        name: 'Test Shop',
        slug: 'test-shop',
        currency: 'BDT',
        timezone: 'Asia/Dhaka',
        role_names: ['Owner'],
        role_keys: ['owner'],
        shop_type: 'grocery',
        is_owner: true,
        permissions: keys,
      },
    ],
    activeOrganizationId: 'org-1',
    permissions: keys,
  })
}

const ALL_KEYS = [
  'dashboard.view', 'sales.view', 'sales.create', 'customers.view', 'products.view',
  'inventory.view', 'purchases.view', 'expenses.view', 'reports.view', 'analytics.view',
  'register.open', 'users.view', 'roles.manage', 'plugins.view', 'settings.view',
]

beforeEach(async () => {
  bus = new EventBus()
  bus.onError = () => undefined
  registry = new PluginRegistry(bus)
  registry.declare({ manifest: batchExpiryManifest, load: async () => batchExpiryPlugin })
  await registry.sync(['batch-expiry'])
  signInAs(ALL_KEYS)
})

describe('navigation model', () => {
  it('includes core items', () => {
    const groups = buildNavigation(registry)
    const ids = groups.flatMap((g) => g.items.map((i) => i.id))

    expect(ids).toContain('dashboard')
    expect(ids).toContain('pos')
    expect(CORE_NAV.length).toBeGreaterThanOrEqual(15)
  })

  it('includes the plugin item with no edit to this module', () => {
    const groups = buildNavigation(registry)
    const item = groups.flatMap((g) => g.items).find((i) => i.id === 'batch-expiry')

    expect(item).toBeDefined()
    expect(item?.label).toBe('Expiry Watch')
    expect(item?.source).toBe('batch-expiry')
  })

  it('places the plugin item in the core section it asked for', () => {
    const groups = buildNavigation(registry)
    const inventory = groups.find((g) => g.section.id === 'inventory')

    expect(inventory).toBeDefined()
    expect(inventory?.items.map((i) => i.id)).toContain('batch-expiry')
  })

  it('orders the plugin item among the core items, not appended at the end', () => {
    const groups = buildNavigation(registry)
    const inventory = groups.find((g) => g.section.id === 'inventory')
    const order = inventory?.items.map((i) => `${i.order}:${i.id}`) ?? []

    // Catalogue is the deliberate gap after Products; batch-expiry declares
    // order 35, purchases 30, expenses 40 — so it sits between them.
    expect(order).toEqual(['10:products', '15:catalogue', '20:stock', '30:purchases', '35:batch-expiry', '40:expenses'])
  })

  it('creates a section for an unknown section id rather than dropping the item', () => {
    registry.declare({
      manifest: {
        id: 'lonely',
        name: 'Lonely',
        version: '1.0.0',
        coreApiVersion: '^1.0.0',
        category: 'optional',
        description: 'lonely',
      },
      load: async () => ({
        id: 'lonely',
        name: 'Lonely',
        version: '1.0.0',
        register: (api) => {
          api.registerNav({
            id: 'lonely-page',
            label: 'Lonely Page',
            icon: 'help',
            section: 'a-brand-new-section',
            route: '/lonely',
          })
        },
      }),
    })

    return registry.sync(['batch-expiry', 'lonely']).then(() => {
      const groups = buildNavigation(registry)
      const section = groups.find((g) => g.section.id === 'a-brand-new-section')

      expect(section).toBeDefined()
      expect(section?.section.label).toBe('A brand new section')
      expect(section?.items.map((i) => i.id)).toEqual(['lonely-page'])
    })
  })

  it('hides items the role cannot use', () => {
    // A cashier: selling and stock, nothing administrative.
    signInAs(['dashboard.view', 'sales.view', 'sales.create', 'products.view', 'inventory.view'])

    const groups = buildNavigation(registry)
    const ids = groups.flatMap((g) => g.items.map((i) => i.id))

    expect(ids).toContain('pos')
    expect(ids).not.toContain('users')
    expect(ids).not.toContain('settings')
    // The plugin item is gated on inventory.view, which the cashier has.
    expect(ids).toContain('batch-expiry')
  })

  it('drops the plugin item when the role loses its permission', () => {
    signInAs(['dashboard.view', 'sales.view', 'sales.create'])

    const ids = buildNavigation(registry).flatMap((g) => g.items.map((i) => i.id))

    expect(ids).not.toContain('batch-expiry')
  })

  it('produces no groups at all for a role with no permissions', () => {
    signInAs([])

    expect(buildNavigation(registry)).toEqual([])
  })
})

describe('rendered sidebar', () => {
  const options = {
    shopName: 'Test Shop',
    shopInitial: 'T',
    onNavigate: vi.fn(),
    onOpenPalette: vi.fn(),
    onSignOut: vi.fn(),
  }

  it('renders the plugin item into the DOM', () => {
    const el = sidebar({ registry, ...options })

    const link = el.querySelector('[data-nav-id="batch-expiry"]')
    expect(link).not.toBeNull()
    expect(link?.textContent).toContain('Expiry Watch')
    expect(link?.getAttribute('href')).toBe('/plugins/batch-expiry')
  })

  it('renders every core item the role can see', () => {
    const el = sidebar({ registry, ...options })
    const ids = [...el.querySelectorAll('[data-nav-id]')].map((n) => n.getAttribute('data-nav-id'))

    expect(ids).toContain('dashboard')
    expect(ids).toContain('pos')
    expect(ids).toContain('settings')
    expect(ids).toContain('batch-expiry')
  })

  it('calls onNavigate with the route when an item is clicked', () => {
    const onNavigate = vi.fn()
    const el = sidebar({ registry, ...options, onNavigate })

    const link = el.querySelector<HTMLElement>('[data-nav-id="batch-expiry"]')
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(onNavigate).toHaveBeenCalledWith('/plugins/batch-expiry')
  })

  it('shows an explanatory message when the role can see nothing', () => {
    signInAs([])
    const el = sidebar({ registry, ...options })

    expect(el.textContent).toContain('No features available for your role.')
  })

  it('reflects a plugin loaded after the sidebar was built', async () => {
    // `sidebar()` is a pure render function; the shell re-renders it when the
    // `plugin.loaded` bus event fires. This test pins the half that matters:
    // a rebuild picks up the late plugin without any other change.
    registry.declare({
      manifest: {
        id: 'latecomer',
        name: 'Latecomer',
        version: '1.0.0',
        coreApiVersion: '^1.0.0',
        category: 'optional',
        description: 'latecomer',
      },
      load: async () => ({
        id: 'latecomer',
        name: 'Latecomer',
        version: '1.0.0',
        register: (api) => {
          api.registerNav({ id: 'late', label: 'Late Page', icon: 'help', section: 'main', route: '/late' })
        },
      }),
    })

    const el = sidebar({ registry, ...options })
    expect(el.querySelector('[data-nav-id="late"]')).toBeNull()

    await registry.sync(['batch-expiry', 'latecomer'])

    const rebuilt = sidebar({ registry, ...options })
    expect(rebuilt.querySelector('[data-nav-id="late"]')).not.toBeNull()
  })
})
