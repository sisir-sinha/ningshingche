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

/**
 * The product fields this shop type wants in front of it.
 *
 * `promotedProductFields` names *metadata keys* — a plugin's `ProductField.key`,
 * or a field an industry bundle registers when it ships. The keys are compared
 * as written, because a near miss is silent: `batch_no` beside a plugin's
 * `batch_number` promotes nothing at all, and a promotion that does nothing
 * looks exactly like a promotion that works.
 *
 * A key no plugin registers is not an error — it is a field some industry
 * bundle will contribute (`model_no`, `carat`, `isbn`), and until then it is
 * simply inert. That is why this list is advisory data and not a registry.
 */
export function promotedFieldsFor(
  taxonomy: ShopCategoryTaxonomy,
  shopTypeId: string | null | undefined
): readonly string[] {
  if (!shopTypeId) return []
  return findShopType(taxonomy, shopTypeId)?.recommendations.promotedProductFields ?? []
}

/**
 * Splits plugin-registered fields into the two sections the product form
 * draws, honouring the shop type's promotions.
 *
 * A field a shop type promotes moves from the collapsed section into the basic
 * one — the whole point of the taxonomy (docs/08 §2). Everything else keeps the
 * section the plugin asked for, so a plugin never needs to know which shop it
 * is in, and a shop type never needs the plugin to change.
 *
 * Pure, and separate from the form, because "which fields does this shop see
 * first" is a rule worth testing without a DOM.
 */
export function splitPluginFields<T extends { key: string; section?: 'basic' | 'advanced' }>(
  fields: readonly T[],
  promoted: readonly string[]
): { basic: T[]; advanced: T[] } {
  const wanted = new Set(promoted)
  const basic: T[] = []
  const advanced: T[] = []

  for (const field of fields) {
    if ((field.section ?? 'basic') === 'basic' || wanted.has(field.key)) basic.push(field)
    else advanced.push(field)
  }

  return { basic, advanced }
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
