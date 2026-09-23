/**
 * The shop-category taxonomy and the profile that maps a category onto
 * plugins, fields and seed data.
 *
 * This is the seam that keeps business types out of the core (spec §3):
 * adding a shop type means adding data, never editing `src/features/`.
 * See docs/08-plugin-matrix.md.
 */

/** Which POS panel layout a shop type starts from. */
export type POSLayout = 'grid' | 'list' | 'grid-with-quick-keys'

/** Plugin recommendations attached to a business type. */
export interface ShopTypeRecommendations {
  /** Enabled automatically. The owner may uncheck any of them. */
  readonly plugins: readonly string[]
  /** Offered, but off by default. */
  readonly suggested?: readonly string[]
  /**
   * Product fields promoted out of "+ Advanced Options" into the basic
   * section, so a pharmacy sees `expiry_date` immediately and a bookstore
   * never sees it at all (spec §8, §57).
   */
  readonly promotedProductFields?: readonly string[]
  readonly units?: readonly string[]
  readonly categories?: readonly string[]
  readonly paymentMethods?: readonly string[]
  readonly taxProfile?: string
  readonly posLayout?: POSLayout
}

export interface ShopCategory {
  readonly id: string
  readonly name: string
  /** Bengali label. Bengali is a first-class locale, not an afterthought. */
  readonly name_bn?: string
  readonly parentId: string | null
  readonly icon?: string
  /** Present on leaf categories only; groups are structural. */
  readonly recommends?: ShopTypeRecommendations
  readonly children?: readonly ShopCategory[]
}

export interface ShopCategoryTaxonomy {
  readonly version: number
  readonly note?: string
  readonly categories: readonly ShopCategory[]
}

/** A flattened leaf, resolved once at bootstrap for fast lookup. */
export interface ResolvedShopType {
  readonly id: string
  readonly name: string
  readonly nameBn: string | undefined
  readonly groupName: string
  readonly recommendations: ShopTypeRecommendations
}

/** Every plugin id referenced anywhere in the taxonomy, for validation. */
export const KNOWN_PLUGIN_IDS = [
  'variants',
  'batch-expiry',
  'serial-numbers',
  'warranty',
  'weight-scale',
  'loyalty',
  'wholesale',
  'promotions',
  'gift-cards',
  'label-printing',
  'accounting',
  'returns-exchange',
  'delivery',
  'stocktake',
  'multi-currency',
  'notifications',
  'production',
  'repair',
  'pharmacy',
  'fashion',
  'electronics',
  'mobile',
  'jewelry',
  'bookstore',
  'hardware',
  'auto-parts',
  'pet',
  'bakery',
  'restaurant',
] as const

export type KnownPluginId = (typeof KNOWN_PLUGIN_IDS)[number]

/** Flattens the tree into leaves with their group label attached. */
export function resolveShopTypes(
  taxonomy: ShopCategoryTaxonomy,
): readonly ResolvedShopType[] {
  const out: ResolvedShopType[] = []

  for (const group of taxonomy.categories) {
    for (const leaf of group.children ?? []) {
      out.push({
        id: leaf.id,
        name: leaf.name,
        nameBn: leaf.name_bn,
        groupName: group.name,
        recommendations: leaf.recommends ?? { plugins: [] },
      })
    }
  }

  return out
}

/** Finds a leaf by id, searching one level of children. */
export function findShopType(
  taxonomy: ShopCategoryTaxonomy,
  id: string,
): ResolvedShopType | undefined {
  return resolveShopTypes(taxonomy).find((t) => t.id === id)
}
