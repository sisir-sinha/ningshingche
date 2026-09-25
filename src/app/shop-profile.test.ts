/**
 * The shop type, joined to the data that ships with the bundle.
 *
 * `src/shared/types/shop-profile.test.ts` tests the rules with a fixture
 * taxonomy. This file tests the *authored* taxonomy — `data/shop_categories.json`
 * — against the plugins that actually ship, because the failure mode here is
 * silent: a promoted key that no plugin registers, or a key spelled differently
 * from the plugin's own (`batch_no` beside `batch_number`), promotes nothing at
 * all and looks exactly like a promotion that works.
 *
 * It also exercises the seam end to end without a database: sign in as a
 * pharmacy, ask which fields it promotes, and see a plugin field land in the
 * basic section of the product form.
 */

import { describe, it, expect, afterEach } from 'vitest'
import taxonomyJson from '../../data/shop_categories.json'
import { activePromotedFields, activeShopType, shopTaxonomy } from './shop-profile'
import { sessionStore, EMPTY_SESSION, type OrganizationMembership } from './state/session'
import { BATCH_KEY, EXPIRY_KEY } from '../plugins/batch-expiry/manifest'
import { SERIAL_TRACKED_KEY } from '../plugins/serial-numbers/manifest'
import {
  KNOWN_PLUGIN_IDS,
  promotedFieldsFor,
  resolveShopTypes,
  splitPluginFields,
  type ShopCategoryTaxonomy,
} from '../shared/types/shop-profile'
import type { ProductField } from '../shared/registry/plugin-types'

const taxonomy = taxonomyJson as unknown as ShopCategoryTaxonomy
const shopTypes = resolveShopTypes(taxonomy)

/** The keys the four shipped plugins register as product fields. */
const SHIPPED_FIELD_KEYS = [BATCH_KEY, EXPIRY_KEY, SERIAL_TRACKED_KEY]

function membership(shopType: string | null): OrganizationMembership {
  return {
    organization_id: '11111111-1111-1111-1111-111111111111',
    name: 'Test Shop',
    slug: 'test-shop',
    currency: 'BDT',
    timezone: 'Asia/Dhaka',
    shop_type: shopType,
    role_names: ['Owner'],
    role_keys: ['owner'],
    is_owner: true,
    permissions: ['products.view', 'products.manage'],
  }
}

function signInAs(shopType: string | null): void {
  sessionStore.reset({
    ...EMPTY_SESSION,
    status: 'authenticated',
    userId: '22222222-2222-2222-2222-222222222222',
    organizations: [membership(shopType)],
    activeOrganizationId: '11111111-1111-1111-1111-111111111111',
  })
}

afterEach(() => sessionStore.reset(EMPTY_SESSION))

describe('the authored taxonomy', () => {
  it('is the file the bundle ships', () => {
    expect(shopTaxonomy().categories.length).toBeGreaterThan(0)
    expect(shopTypes.length).toBeGreaterThan(20)
  })

  it('only recommends plugins the type system knows', () => {
    for (const type of shopTypes) {
      for (const id of [...type.recommendations.plugins, ...(type.recommendations.suggested ?? [])]) {
        expect(KNOWN_PLUGIN_IDS, `${type.id} recommends ${id}`).toContain(id)
      }
    }
  })

  it('names each shipped plugin’s own field keys where it recommends that plugin', () => {
    // serial-numbers: a shop that gets the plugin by default must meet the
    // checkbox that switches it on for a product.
    for (const type of shopTypes) {
      if (!type.recommendations.plugins.includes('serial-numbers')) continue
      expect(type.recommendations.promotedProductFields ?? [], type.id).toContain(
        SERIAL_TRACKED_KEY
      )
    }
  })

  it('does not promote a near miss of a plugin’s own key', () => {
    // `batch_no` was in this file while the plugin registers `batch_number`:
    // the promotion was a no-op and nothing anywhere said so.
    for (const type of shopTypes) {
      for (const key of type.recommendations.promotedProductFields ?? []) {
        for (const shipped of SHIPPED_FIELD_KEYS) {
          if (key === shipped) continue
          expect(
            key.startsWith(shipped) || shipped.startsWith(key),
            `${type.id} promotes “${key}”, which is one letter away from the shipped key “${shipped}”`
          ).toBe(false)
        }
      }
    }
  })

  it('keeps IMEIs off the product, because the plugin keeps them per unit', () => {
    const mobile = shopTypes.find((type) => type.id === 'mobile')
    expect(mobile?.recommendations.plugins).toContain('serial-numbers')
    const promoted = promotedFieldsFor(taxonomy, 'mobile')
    expect(promoted).toContain(SERIAL_TRACKED_KEY)
    expect(promoted).not.toContain('imei_1')
    expect(promoted).not.toContain('imei_2')
  })
})

describe('a signed-in shop, and what its product form shows', () => {
  const fields: ProductField[] = [
    { key: BATCH_KEY, label: 'Batch number', type: 'text', section: 'advanced', storage: 'metadata' },
    { key: EXPIRY_KEY, label: 'Expiry date', type: 'date', section: 'advanced', storage: 'metadata' },
    { key: SERIAL_TRACKED_KEY, label: 'Serial tracking', type: 'boolean', section: 'advanced', storage: 'metadata' },
  ]

  it('resolves the active shop type through the session', () => {
    signInAs('pharmacy')
    expect(activeShopType()?.name).toBe('Pharmacy')
    signInAs('no-such-shop')
    expect(activeShopType()).toBeUndefined()
    expect(activePromotedFields()).toEqual([])
  })

  it('a pharmacy meets both batch fields, a convenience store only the expiry date', () => {
    signInAs('pharmacy')
    const pharmacy = splitPluginFields(fields, activePromotedFields())
    expect(pharmacy.basic.map((field) => field.key)).toEqual([BATCH_KEY, EXPIRY_KEY])
    expect(pharmacy.advanced.map((field) => field.key)).toEqual([SERIAL_TRACKED_KEY])

    // The same three fields, a different shop type: `batch_number` is not named
    // by a convenience store, so it stays where the plugin put it. One plugin,
    // two forms, and the plugin never learns which shop it is in.
    signInAs('convenience')
    const convenience = splitPluginFields(fields, activePromotedFields())
    expect(convenience.basic.map((field) => field.key)).toEqual([EXPIRY_KEY])
    expect(convenience.advanced.map((field) => field.key)).toEqual([
      BATCH_KEY,
      SERIAL_TRACKED_KEY,
    ])
  })

  it('a mobile shop meets serial tracking, and a grocery meets both batch fields', () => {
    signInAs('mobile')
    expect(splitPluginFields(fields, activePromotedFields()).basic.map((f) => f.key)).toEqual([
      SERIAL_TRACKED_KEY,
    ])

    signInAs('grocery')
    expect(splitPluginFields(fields, activePromotedFields()).basic.map((f) => f.key)).toEqual([
      BATCH_KEY,
      EXPIRY_KEY,
    ])
  })

  it('a shop whose type promotes none of them keeps every field where the plugin put it', () => {
    signInAs('bookstore')
    const { basic, advanced } = splitPluginFields(fields, activePromotedFields())
    expect(basic).toEqual([])
    expect(advanced).toHaveLength(3)
  })

  it('falls back to the plugin’s own sections for a shop with no type at all', () => {
    signInAs(null)
    expect(activeShopType()).toBeUndefined()
    const { basic, advanced } = splitPluginFields(fields, activePromotedFields())
    expect(basic).toEqual([])
    expect(advanced).toHaveLength(3)
  })
})
