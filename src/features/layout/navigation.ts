/**
 * The navigation model (spec §40, docs/06).
 *
 * Core items are declared here; plugin items arrive through
 * `api.registerNav()`. Both are merged into one list, filtered by permission,
 * and grouped into sections — so a plugin's item appears in the sidebar with
 * no edit to this file. That is the acceptance test for the whole
 * architecture, visible on screen.
 */

import type { NavItem } from '../../shared/registry/plugin-types'
import type { PluginRegistry } from '../../shared/registry/plugin-registry'
import { can } from '../../app/state/session'

/**
 * Sidebar sections, in display order. A plugin that names an unknown section
 * gets one created after these, rather than being dropped.
 */
export interface NavSection {
  id: string
  label: string
  /** Collapsed by default; the cashier sees five items, not thirty. */
  collapsedByDefault?: boolean
}

export const NAV_SECTIONS: NavSection[] = [
  { id: 'main', label: 'Overview' },
  { id: 'selling', label: 'Selling' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'insights', label: 'Insights', collapsedByDefault: true },
  { id: 'admin', label: 'Administration', collapsedByDefault: true },
]

/**
 * The core navigation. Every entry is gated by a permission key that exists
 * in supabase/seed/001_permissions.sql — the seed asserts that agreement.
 */
export const CORE_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', section: 'main', route: '/', permission: 'dashboard.view', order: 10 },
  { id: 'pos', label: 'Point of Sale', icon: 'point_of_sale', section: 'selling', route: '/pos', permission: 'sales.create', order: 10 },
  { id: 'sales', label: 'Sales', icon: 'receipt_long', section: 'selling', route: '/sales', permission: 'sales.view', order: 20 },
  { id: 'customers', label: 'Customers', icon: 'group', section: 'selling', route: '/customers', permission: 'customers.view', order: 30 },
  { id: 'products', label: 'Products', icon: 'inventory_2', section: 'inventory', route: '/products', permission: 'products.view', order: 10 },
  { id: 'stock', label: 'Stock', icon: 'warehouse', section: 'inventory', route: '/stock', permission: 'inventory.view', order: 20 },
  { id: 'purchases', label: 'Purchases', icon: 'local_shipping', section: 'inventory', route: '/purchases', permission: 'purchases.view', order: 30 },
  { id: 'expenses', label: 'Expenses', icon: 'payments', section: 'inventory', route: '/expenses', permission: 'expenses.view', order: 40 },
  { id: 'reports', label: 'Reports', icon: 'assessment', section: 'insights', route: '/reports', permission: 'reports.view', order: 10 },
  { id: 'analytics', label: 'Analytics', icon: 'monitoring', section: 'insights', route: '/analytics', permission: 'analytics.view', order: 20 },
  { id: 'register', label: 'Register', icon: 'point_of_sale', section: 'admin', route: '/register', permission: 'register.view', order: 10 },
  { id: 'users', label: 'Staff', icon: 'manage_accounts', section: 'admin', route: '/users', permission: 'users.view', order: 20 },
  { id: 'roles', label: 'Roles', icon: 'admin_panel_settings', section: 'admin', route: '/roles', permission: 'roles.view', order: 30 },
  { id: 'plugins', label: 'Plugins', icon: 'extension', section: 'admin', route: '/plugins', permission: 'plugins.view', order: 40 },
  { id: 'settings', label: 'Settings', icon: 'settings', section: 'admin', route: '/settings', permission: 'settings.view', order: 50 },
]

export interface NavGroup {
  section: NavSection
  items: NavItem[]
}

/**
 * Merge core and plugin items, drop what the caller cannot use, and group.
 *
 * Plugin items declaring an unknown section id get a section synthesized with
 * their own id as the label — a plugin is never silently hidden because it
 * guessed a section name wrong.
 */
export function buildNavigation(registry: PluginRegistry): NavGroup[] {
  const all: NavItem[] = [...CORE_NAV, ...registry.nav.items]

  const visible = all.filter((item) => can(item.permission))

  const known = new Map(NAV_SECTIONS.map((s) => [s.id, s]))
  const extras: NavSection[] = []

  for (const item of visible) {
    const sectionId = item.section ?? 'main'
    if (!known.has(sectionId) && !extras.some((s) => s.id === sectionId)) {
      extras.push({ id: sectionId, label: humanize(sectionId) })
    }
  }

  const sections = [...NAV_SECTIONS, ...extras]
  const groups: NavGroup[] = []

  for (const section of sections) {
    const items = visible
      .filter((item) => (item.section ?? 'main') === section.id)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label))
    if (items.length > 0) groups.push({ section, items })
  }

  return groups
}

/** `batch-expiry` → `Batch expiry`. */
function humanize(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Flat list for the command palette and for keyboard routing. */
export function flattenNavigation(registry: PluginRegistry): NavItem[] {
  return buildNavigation(registry).flatMap((g) => g.items)
}
