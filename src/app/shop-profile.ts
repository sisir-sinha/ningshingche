/**
 * The active shop's type, and what it changes about the app.
 *
 * The taxonomy (`data/shop_categories.json`) is authored data, not code: adding
 * a business type or changing what it promotes is an edit to that file, never
 * to a feature (spec §3, docs/08 §2). This module is the one place the app
 * joins it to the session — the wizard writes `organizations.shop_type`, the
 * session payload carries it back (047), and everything else asks here.
 *
 * Deliberately tiny: a lookup and a cache-free computation, because the values
 * are needed while a form is being drawn and a stale copy would be worse than
 * recomputing.
 */

import taxonomyJson from '../../data/shop_categories.json'
import { activeOrganization } from './state/session'
import {
  findShopType,
  promotedFieldsFor,
  type ResolvedShopType,
  type ShopCategoryTaxonomy,
} from '../shared/types/shop-profile'

const taxonomy = taxonomyJson as unknown as ShopCategoryTaxonomy

/** The taxonomy as shipped, for screens that list or search shop types. */
export function shopTaxonomy(): ShopCategoryTaxonomy {
  return taxonomy
}

/** The active shop's type, or undefined when the shop was created without one. */
export function activeShopType(): ResolvedShopType | undefined {
  return findShopType(taxonomy, activeOrganization()?.shop_type ?? '')
}

/**
 * The product fields the active shop type promotes out of the collapsed
 * section. Empty for a shop with no type, so the form falls back to what each
 * plugin asked for.
 */
export function activePromotedFields(): readonly string[] {
  return promotedFieldsFor(taxonomy, activeOrganization()?.shop_type)
}
