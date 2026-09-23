/**
 * Permission matching tests.
 *
 * `matchesPermission` is a client-side transcription of `app.has_permission`
 * in supabase/migrations/20260923_004_app_helpers.sql. If the two disagree the
 * UI offers buttons the database refuses, so the wildcard cases are pinned
 * here. The server-side expansion is asserted separately by
 * tools/validate-migrations.mjs.
 */

import { describe, it, expect } from 'vitest'
import { matchesPermission } from './session'

const held = (...keys: string[]): ReadonlySet<string> => new Set(keys)

describe('matchesPermission', () => {
  it('allows an exact match', () => {
    expect(matchesPermission(held('sales.create'), 'sales.create')).toBe(true)
  })

  it('denies a key that was never granted', () => {
    expect(matchesPermission(held('sales.create'), 'sales.refund')).toBe(false)
  })

  it('treats an empty requirement as no requirement', () => {
    // Nav items and plugin routes omit `permission` entirely.
    expect(matchesPermission(held(), undefined)).toBe(true)
    expect(matchesPermission(held('sales.create'), undefined)).toBe(true)
  })

  it('honours the owner wildcard', () => {
    expect(matchesPermission(held('*'), 'sales.create')).toBe(true)
    expect(matchesPermission(held('*'), 'users.delete')).toBe(true)
    expect(matchesPermission(held('*'), 'anything.at.all')).toBe(true)
  })

  it('honours a resource wildcard', () => {
    const admin = held('sales.*')
    expect(matchesPermission(admin, 'sales.create')).toBe(true)
    expect(matchesPermission(admin, 'sales.refund')).toBe(true)
    expect(matchesPermission(admin, 'products.create')).toBe(false)
  })

  it('does not treat a partial key as a wildcard', () => {
    // `sales` alone must not grant `sales.create`.
    expect(matchesPermission(held('sales'), 'sales.create')).toBe(false)
  })

  it('does not let one resource match another with a shared prefix', () => {
    // `sale.*` must not grant `sales.create`.
    expect(matchesPermission(held('sale.*'), 'sales.create')).toBe(false)
  })

  it('does not let a wildcard in the middle of a key apply', () => {
    expect(matchesPermission(held('sales.c*'), 'sales.create')).toBe(false)
  })

  it('handles a key with more than two segments', () => {
    // The rule is `split_part(key, '.', 1) || '.*'`, so only the first
    // segment participates in the wildcard.
    expect(matchesPermission(held('plugins.*'), 'plugins.batch-expiry.adjust')).toBe(true)
    expect(matchesPermission(held('plugins.batch-expiry.*'), 'plugins.batch-expiry.adjust')).toBe(false)
  })

  it('denies everything for an empty permission set', () => {
    expect(matchesPermission(held(), 'dashboard.view')).toBe(false)
  })

  it('matches the seeded role shapes from the migrations', () => {
    // Mirrors supabase/migrations/20260923_017_provisioning.sql.
    const owner = held('*')
    const cashier = held('sales.create', 'sales.hold', 'sales.resume', 'sales.view')
    const manager = held('sales.*', 'products.*', 'inventory.*')

    expect(matchesPermission(owner, 'users.delete')).toBe(true)
    expect(matchesPermission(cashier, 'sales.create')).toBe(true)
    expect(matchesPermission(cashier, 'sales.refund')).toBe(false)
    expect(matchesPermission(cashier, 'sales.discount')).toBe(false)
    expect(matchesPermission(manager, 'inventory.adjust')).toBe(true)
    expect(matchesPermission(manager, 'users.delete')).toBe(false)
  })
})
