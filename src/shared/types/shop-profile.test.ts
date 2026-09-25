/**
 * The shop-type seam — the rules, without a DOM or a database.
 *
 * `promotedProductFields` is the taxonomy's promise that a pharmacy meets its
 * expiry date on the way in and a bookstore never meets it at all. These tests
 * are about the machinery that keeps that promise: which keys a shop type asks
 * for, and how a plugin-registered field is drawn because of it.
 */

import { describe, it, expect } from 'vitest'
import {
  KNOWN_PLUGIN_IDS,
  promotedFieldsFor,
  resolveShopTypes,
  splitPluginFields,
  type ShopCategoryTaxonomy,
} from './shop-profile'

const taxonomy: ShopCategoryTaxonomy = {
  version: 1,
  categories: [
    {
      id: 'health',
      name: 'Health & Beauty',
      parentId: null,
      children: [
        {
          id: 'pharmacy',
          name: 'Pharmacy',
          parentId: 'health',
          recommends: {
            plugins: ['batch-expiry'],
            promotedProductFields: ['expiry_date', 'requires_prescription'],
          },
        },
        { id: 'barber', name: 'Barber', parentId: 'health' },
      ],
    },
  ],
}

/** Two advanced plugin fields, in the order a plugin registered them. */
const fields = [
  { key: 'batch_number', label: 'Batch number', section: 'advanced' as const },
  { key: 'expiry_date', label: 'Expiry date', section: 'advanced' as const },
  { key: 'shelf_location', label: 'Shelf', section: 'advanced' as const },
]

describe('what a shop type promotes', () => {
  it('returns the fields the taxonomy names for that type', () => {
    expect(promotedFieldsFor(taxonomy, 'pharmacy')).toEqual([
      'expiry_date',
      'requires_prescription',
    ])
  })

  it('promotes nothing for a shop with no type, an unknown type, or no list', () => {
    expect(promotedFieldsFor(taxonomy, null)).toEqual([])
    expect(promotedFieldsFor(taxonomy, undefined)).toEqual([])
    expect(promotedFieldsFor(taxonomy, 'a-shop-that-does-not-exist')).toEqual([])
    expect(promotedFieldsFor(taxonomy, 'barber')).toEqual([])
  })

  it('finds leaves through the group they hang under', () => {
    expect(resolveShopTypes(taxonomy).map((type) => type.id)).toEqual(['pharmacy', 'barber'])
  })
})

describe('splitting the product form', () => {
  it('moves a promoted field into the basic section and leaves the rest alone', () => {
    const { basic, advanced } = splitPluginFields(fields, ['expiry_date'])

    expect(basic.map((field) => field.key)).toEqual(['expiry_date'])
    expect(advanced.map((field) => field.key)).toEqual(['batch_number', 'shelf_location'])
  })

  it('keeps the order the plugin registered, promoted fields included', () => {
    // Grocery promotes both batch fields: the form must show them in the order
    // the plugin declared, not re-ordered by promotion.
    const { basic } = splitPluginFields(fields, ['expiry_date', 'batch_number'])
    expect(basic.map((field) => field.key)).toEqual(['batch_number', 'expiry_date'])
  })

  it('leaves a field alone when the shop type does not name it', () => {
    const { basic, advanced } = splitPluginFields(fields, ['isbn'])
    expect(basic).toEqual([])
    expect(advanced).toHaveLength(3)
  })

  it('treats a field with no section as basic, promoted or not', () => {
    const { basic, advanced } = splitPluginFields(
      [{ key: 'always_visible' }, { key: 'hidden', section: 'advanced' as const }],
      []
    )
    expect(basic.map((field) => field.key)).toEqual(['always_visible'])
    expect(advanced.map((field) => field.key)).toEqual(['hidden'])
  })

  it('promotes nothing when the plugin declares nothing', () => {
    expect(splitPluginFields([], ['expiry_date'])).toEqual({ basic: [], advanced: [] })
  })
})

describe('the ids the taxonomy is allowed to name', () => {
  it('lists serial-numbers among the plugin ids the taxonomy may reference', () => {
    // The type is derived from this list, so a typo in a shop type's plugins is
    // caught by the compiler rather than by a shop that silently gets nothing.
    expect(KNOWN_PLUGIN_IDS).toContain('serial-numbers')
    expect(KNOWN_PLUGIN_IDS).toContain('batch-expiry')
  })
})
