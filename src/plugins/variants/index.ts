/**
 * Variants — behaviour.
 *
 * The first of the Phase 7 capability plugins, and the one that proves the
 * architecture's hardest claim (spec §51): a plugin that *builds core data* can
 * still add no storage of its own. Everything a variant is — the options, the
 * combinations, the per-variant price and SKU — lives in the tables the core
 * already had (`product_option_types`, `product_option_values`,
 * `product_variants`), so the till, the stock ledger, the sales report and the
 * held-cart resume path all keep working without knowing this plugin exists.
 *
 * What the plugin contributes is the *workflow*: defining the shop's options
 * once, turning them into combinations for a product, and pricing those
 * combinations in a pass. That is the part a shopkeeper would otherwise do by
 * hand, and the part no core screen should grow a special case for.
 *
 * It registers three things, and each one is a description the core renders:
 *   · a screen (Inventory → Variants) for the shop's options
 *   · a section inside the product form, where combinations are built
 *   · a dashboard tile saying how much of the catalogue is built out
 */

import { emptyState, stat } from '../../components/ui/card'
import { h, srOnly } from '../../components/ui/h'
import type { Plugin, PluginDb } from '../../shared/registry/plugin-types'
import {
  DEFAULT_MAX_VARIANTS,
  MAX_VARIANTS_KEY,
  variantsManifest,
} from './manifest'
import type { Catalog } from './helpers'

export const VARIANTS_VIEW = 'variants.view'
export const VARIANTS_MANAGE = 'variants.manage'

export const variantsPlugin: Plugin = {
  id: variantsManifest.id,
  name: variantsManifest.name,
  version: variantsManifest.version,
  description: variantsManifest.description,
  ...(variantsManifest.icon ? { icon: variantsManifest.icon } : {}),

  register(api) {
    for (const permission of variantsManifest.permissions ?? []) {
      api.registerPermission({
        key: permission.key,
        label: permission.label,
        group: permission.group,
        ...(permission.description ? { description: permission.description } : {}),
      })
    }

    // ── The shop's options ────────────────────────────────────────────────
    api.registerNav({
      id: 'variants',
      label: 'Variants',
      icon: 'grid_view',
      section: 'inventory',
      route: '/plugins/variants',
      permission: VARIANTS_VIEW,
      order: 30,
    })

    api.registerRoute({
      path: '/plugins/variants',
      title: 'Variants',
      permission: VARIANTS_VIEW,
      load: async () => {
        const page = await import('./options-screen')
        return page.create({ db: api.db })
      },
    })

    // ── The builder inside the product form ───────────────────────────────
    // `advanced` because it is the next step after naming a product and
    // pricing it, not a question every product needs answering — progressive
    // disclosure (spec §12). A product that has no variants never expands it.
    api.registerFormSection({
      id: 'variants.builder',
      label: 'Variations',
      section: 'advanced',
      permission: VARIANTS_VIEW,
      render: async (context) => {
        // Fetched when the shop actually expands the section, so a shop that
        // never touches variants never downloads the builder.
        const builder = await import('./builder')
        return builder.create({
          db: api.db,
          productId: context.productId ?? null,
          currency: context.currency,
          maxVariants: api.settings.get<number>(MAX_VARIANTS_KEY, DEFAULT_MAX_VARIANTS),
          log: api.log,
        })
      },
    })

    // ── How much of the catalogue is built out ────────────────────────────
    api.registerDashboardWidget({
      id: 'variants.summary',
      title: 'Variants',
      size: 'sm',
      permission: VARIANTS_VIEW,
      render: () => variantsTile(api.db),
    })

    api.log.debug('registered', {
      permissions: variantsManifest.permissions?.map((permission) => permission.key) ?? [],
    })
  },
}

async function variantsTile(db: PluginDb): Promise<HTMLElement> {
  let catalog: Catalog
  try {
    catalog = await db.rpc<Catalog>('catalog')
  } catch {
    // A tile must never be the reason a dashboard fails to draw.
    return emptyState('Variants could not be read', { iconName: 'error' })
  }

  const { totals } = catalog
  const unbuilt = totals.values === 0

  return h(
    'div',
    { class: 'flex flex-col gap-2' },
    srOnly(
      `Variants: ${totals.types} option(s), ${totals.products} product(s) with options, ${totals.variants} variant(s) built`
    ),
    stat('Variants built', new Intl.NumberFormat('en-IN').format(totals.variants), {
      iconName: 'grid_view',
      tone: unbuilt ? 'warning' : 'neutral',
      hint:
        totals.products === 0
          ? 'no product uses options yet'
          : `across ${totals.products} product(s) · ${totals.values} value(s)`,
    }),
    h(
      'p',
      { class: 'truncate text-xs text-content-muted' },
      totals.types === 0
        ? 'No options defined — add Size or Colour under Inventory → Variants.'
        : `${totals.types} option(s): ${catalog.types.map((type) => type.name).join(', ')}`
    )
  )
}

export default variantsPlugin
