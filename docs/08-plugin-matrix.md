# 08 — Plugin Matrix (Industry Adaptation)

> ## Blocked on `shop_categories.json`
>
> The file referenced in §3, §33 and §58 was **never attached**. Nothing
> matching `*shop_categor*` exists in the workspace.
>
> This document therefore defines:
> 1. The **shape** the file must have for the system to consume it
> 2. The **mapping mechanism** from category → plugins
> 3. A complete matrix for the **16 industries named explicitly in your spec**
>
> The exhaustive per-category mapping is generated mechanically from the file
> once you supply it. It is a data task, not a design task — the design below
> does not change when the file arrives.

---

## 1. Required file shape

For the setup wizard (§34) and smart defaults (§35) to work, the taxonomy must
carry more than names. Minimum viable shape:

```json
{
  "version": 1,
  "categories": [
    {
      "id": "grocery",
      "name": "Grocery Store",
      "name_bn": "মুদি দোকান",
      "parentId": null,
      "icon": "shopping_basket",
      "children": [
        { "id": "grocery.mini-mart", "name": "Mini Mart", "parentId": "grocery" },
        { "id": "grocery.organic",   "name": "Organic Store", "parentId": "grocery" }
      ]
    }
  ]
}
```

Optional but strongly useful — if the file lacks these, the mapping table in
§4 becomes the source instead:

```json
{
  "id": "pharmacy",
  "name": "Pharmacy",
  "recommends": {
    "plugins": ["batch-expiry", "production"],
    "productFields": ["expiry_date", "batch_no"],
    "units": ["Each", "Strip", "Bottle"],
    "categories": ["Medicines", "Surgical", "Baby Care", "Personal Care"],
    "paymentMethods": ["Cash", "Mobile Banking", "Card"],
    "taxProfile": "vat-standard"
  }
}
```

If the attached file has a different shape, send it and I will write the
adapter — the taxonomy is treated as **data**, so shape differences are
contained to one loader module and never leak into core.

---

## 2. The mapping mechanism

Categories do **not** map to plugins in code. They map in a table.

```ts
interface ShopTypeProfile {
  /** Category id from the taxonomy. */
  categoryId: string

  /** Plugins enabled automatically. The user can uncheck any of them. */
  defaultPlugins: string[]
  /** Shown as suggestions, not auto-enabled. */
  suggestedPlugins: string[]

  /** Product fields surfaced in the BASIC section rather than Advanced. */
  promotedProductFields: string[]
  /** Product fields hidden entirely — this shop will never use them. */
  hiddenProductFields: string[]

  /** Seeded categories, units, payment methods, tax profile. */
  seed: {
    categories: string[]
    units: string[]
    paymentMethods: string[]
    taxProfile: string
  }

  /** Which POS panel layout to start from. */
  posLayout: 'grid' | 'list' | 'grid-with-quick-keys'
}
```

Stored as seed data (`supabase/seed/007_shop_profiles.sql`), editable per
organization afterwards. **Nothing about a shop type is compiled into the
application** — §3's "do not hardcode each business type" is satisfied
structurally.

### What "promoted" means

The single most useful lever for §8. A pharmacy promotes `expiry_date` and
`batch_no` into the *basic* product form, so they are not buried under
"+ Advanced Options." A bookstore does not promote them at all, so they
never appear. Same form, same code, different shop.

---

## 3. Reading the matrix

Legend:

- **●** enabled by default
- **○** suggested, off by default
- **—** not applicable

Plugin columns are abbreviated. Full names in [01](./01-requirements-analysis.md) §2.

---

## 4. Matrix — the 16 industries named in your spec

### Core capabilities

| Industry | Var | Batch | Serial | Warr | Weight | Loyalty | Whole | Promo | Prod | Stock-take |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Grocery / Supermarket | ○ | ● | — | — | ● | ○ | ○ | ● | — | ● |
| Convenience Store | — | ○ | — | — | — | ● | — | ● | — | ○ |
| Bakery | ○ | ● | — | — | ● | ● | — | ● | ● | ● |
| Butcher | — | ● | — | — | ● | ○ | ○ | — | ● | ● |
| Clothing / Fashion | ● | — | — | — | — | ● | ○ | ● | — | ● |
| Shoe Store | ● | — | — | — | — | ● | — | ● | — | ● |
| Jewelry | ● | — | ● | ● | ● | ● | — | — | ○ | ● |
| Pharmacy | ○ | ● | — | — | — | ● | ○ | — | — | ● |
| Cosmetics | ● | ● | — | — | — | ● | ○ | ● | — | ● |
| Electronics | ○ | — | ● | ● | — | ○ | ○ | ● | — | ● |
| Computer Shop | ● | — | ● | ● | — | ○ | ○ | — | ● | ● |
| Mobile Phone Shop | — | — | ● | ● | — | ● | ○ | ● | — | ● |
| Repair Shop | — | — | ○ | ● | — | ● | — | — | — | ○ |
| Bookstore | ○ | — | — | — | — | ● | ○ | ● | — | ● |
| Toy / Game Store | ● | — | — | — | — | ● | ○ | ● | — | ● |
| Furniture | ● | — | — | ● | — | ○ | ○ | — | ● | ○ |
| Hardware | ○ | — | — | — | ● | ○ | ● | — | ○ | ● |
| Appliance | — | — | ● | ● | — | ○ | ○ | ● | — | ● |
| Flower Shop | ○ | ● | — | — | ○ | ● | — | ● | ● | ○ |
| Garden Center | ○ | ● | — | — | ● | ○ | ○ | ● | ● | ○ |
| Pet Shop | ● | ● | — | — | ● | ● | ○ | ● | — | ● |
| Auto Parts | ● | — | ○ | ● | — | ○ | ● | — | — | ● |
| Sports Shop | ● | — | ○ | ○ | — | ● | ○ | ● | — | ● |
| Bicycle Shop | ● | — | ● | ● | — | ● | — | — | — | ● |
| Luggage | ● | — | — | ● | — | ○ | ○ | ● | — | ● |
| Department Store | ● | ○ | ○ | ○ | ○ | ● | ● | ● | — | ● |
| Wholesale | ○ | ● | — | — | ● | ○ | ● | ● | — | ● |
| Restaurant ⚠ | ● | ● | — | — | ● | ● | — | ● | ● | — |

⚠ See §6.

### Industry-specific fields and navigation

| Industry | Product fields added | Extra navigation |
|---|---|---|
| Grocery | `shelf_location` | — |
| Bakery | `recipe_id`, `produced_at`, `best_before_hours` | Production → Recipes, Production Runs |
| Butcher | `cut`, `origin`, `grade` | Production → Cutting/Yield |
| Fashion | `size`, `colour`, `material`, `season`, `collection` | Fashion → Sizes, Colours, Collections |
| Shoe | `size`, `width`, `colour` | Fashion → Sizes |
| Jewelry | `carat`, `metal`, `metal_weight_g`, `stone`, `making_charge`, `certificate_no`, `hallmark` | Jewelry → Valuations, Certificates |
| Pharmacy | `salt_composition`, `dosage_form`, `strength`, `requires_prescription`, `controlled_schedule`, `manufacturer`, `license_no` | Pharmacy → Medicines, Expiry Tracking, Prescriptions |
| Cosmetics | `shade`, `volume_ml`, `ingredients`, `cruelty_free` | — |
| Electronics | `model_no`, `specs` (jsonb), `voltage`, `warranty_months` | Electronics → Warranty Claims |
| Computer | `specs` (cpu/ram/storage/gpu), `build_id` | Builds → Custom PCs |
| Mobile | `imei_1`, `imei_2`, `network_lock`, `storage_gb`, `ram_gb`, `colour` | Mobile → IMEI Registry, Warranty |
| Repair | — (device entity, not product) | Repair → Orders, Devices, Technicians, Status |
| Bookstore | `isbn`, `author`, `publisher`, `edition`, `binding`, `language`, `pages` | Books → Authors, Publishers |
| Toy / Game | `age_min`, `age_max`, `platform`, `franchise`, `players` | — |
| Furniture | `dimensions`, `material`, `assembly_required`, `made_to_order` | Furniture → Made-to-Order |
| Hardware | `grade`, `dimensions`, `sold_by_length` | — |
| Appliance | `model_no`, `energy_rating`, `warranty_months`, `installation_required` | Appliance → Installations |
| Flower | `occasion`, `vase_life_days`, `arrangement` | Production → Arrangements |
| Garden | `plant_type`, `pot_size`, `season`, `sunlight`, `watering` | — |
| Pet | `breed`, `life_stage`, `is_live_animal`, `care_notes` | Pets → Live Animals |
| Auto Parts | `oem_no`, `fitment` (year/make/model graph), `position` | Fitment → Vehicles, Compatibility |
| Sports | `size`, `sport`, `level` | — |
| Bicycle | `frame_size`, `wheel_size`, `service_interval_km` | Workshop → Services |
| Luggage | `dimensions`, `capacity_l`, `material`, `warranty_years` | — |
| Department | `department`, `floor`, `counter` | Departments |
| Wholesale | `pack_size`, `min_order_qty`, `tier_prices` | Wholesale → Price Lists, Customer Groups |
| Restaurant | `course`, `modifiers`, `kitchen_station`, `prep_time_min` | Floor → Tables, Orders, Kitchen |

---

## 5. Three worked examples (§33)

### Grocery

```
Profile: grocery
Default plugins:   inventory, batch-expiry, weight-scale, promotions, stocktake
Suggested:         variants, loyalty, wholesale, production
Promoted fields:   expiry_date, batch_no, shelf_location
Hidden fields:     imei_1, carat, frame_size, controlled_schedule, …
Seed units:        Each, kg, Gram, Litre, Dozen, Pack
Seed categories:   Rice & Grains, Oil & Ghee, Spices, Snacks, Beverages,
                   Dairy, Household, Personal Care
POS layout:        grid-with-quick-keys (top 20 fast movers pinned)
Tax profile:       vat-standard
Payment methods:   Cash, Mobile Banking, Card
```

Why `weight-scale` is default and not optional: a grocery that cannot sell
1.250 kg of lentils cannot operate. Why `variants` is *suggested*: most
grocery SKUs have no size/colour axis, and enabling it clutters every product
form for no benefit.

### Clothing

```
Profile: fashion
Default plugins:   variants, loyalty, promotions, stocktake
Suggested:         wholesale, gift-cards
Promoted fields:   size, colour, material, season
Hidden fields:     expiry_date, batch_no, imei_1, salt_composition, …
Seed units:        Each, Pair, Set
Seed categories:   Men, Women, Kids, Accessories, Footwear
Variant axes:      Colour × Size (matrix generator builds 18 SKUs from 3×6)
POS layout:        grid
```

The variant matrix generator is the key UX piece: the owner picks
"Colour: Red, Blue" and "Size: S, M, L" and the system creates six variants
with inherited pricing, editable in bulk. Entering them one by one would make
the Variants plugin unusable.

### Electronics

```
Profile: electronics
Default plugins:   serial-numbers, warranty, stocktake
Suggested:         variants, wholesale, promotions, repair
Promoted fields:   model_no, warranty_months, specs
Hidden fields:     expiry_date, salt_composition, carat, …
Seed units:        Each, Pair, Set
Seed categories:   TV & Display, Audio, Home Appliance, Accessories, Cables
POS behaviour:     serial number prompt appears at sale time, per unit
Reports added:     Warranty Expiry, Serial Traceability
```

Serial capture at POS is the critical flow: scanning the product adds the
line, then the screen prompts for each unit's serial. Skipping it must be
possible (a permission: `serial.skip`) but audited, because untracked serials
destroy warranty traceability.

---

## 6. The restaurant problem

Restaurant appears in §4 and §32 but is **not retail**, and pretending
otherwise damages both systems.

| Retail assumes | Restaurant needs |
|---|---|
| Stock decrements at sale | Stock decrements per *recipe*, at kitchen send |
| One item = one line | Modifiers, courses, combos |
| Pay then leave | Open a table, add rounds, settle later |
| No time dimension | Prep time, course sequencing, kitchen routing |
| Customer optional | Covers, reservations, table state |

Forcing this into `sale_items` produces a restaurant system that cannot
sequence courses and a retail core polluted with `kitchen_station` and
`table_no`.

**Recommendation:** the Restaurant plugin introduces an `order` aggregate
that *wraps* the universal sale.

```
Table opened  →  order created (no sale yet)
Course sent   →  kitchen ticket, recipe consumes stock via PRODUCTION_OUT
Round added   →  order lines accumulate
Bill settled  →  complete_sale(order → sale)     ← the universal path
```

Universal payments, receipts, refunds, reporting and stock all still apply at
settlement. But it is a distinct surface with its own screens, and it should
be scheduled **last**, not alongside Grocery.

If restaurants are a priority for you, say so now — it changes the Phase 7
ordering and needs the `order` aggregate designed up front rather than
retrofitted.

---

## 7. What the setup wizard does with this (§34, §35)

```
Step 1  Business Name           → organizations.name
Step 2  Business Type           → organizations.shop_type (from taxonomy)
                                  → loads ShopTypeProfile
Step 3  Currency                → organizations.currency
Step 4  Tax Settings            → taxes rows from profile.taxProfile
Step 5  Payment Methods         → payment_methods rows from profile
Step 6  Plugins                 → profile.defaultPlugins pre-checked
                                  profile.suggestedPlugins shown as suggestions
                                  user may change anything
Step 7  First Product           → product form with profile.promotedProductFields
                                  in the basic section
Step 8  Complete                → create org, branch, warehouse, register,
                                  owner role, open first register
```

Step 6 shows one line per plugin with a plain-language description of what it
does — not a checkbox wall. Default plugins are pre-checked and grouped as
"Recommended for a Pharmacy"; suggested ones sit under "You can add these
later" so they do not compete visually.

Step 7 is deliberately last-but-one: by then the form already shows the right
fields, so the first product feels natural rather than like a 30-field
ordeal.

---

## 8. Extending the matrix

Adding an industry is a **data change plus, at most, one plugin**:

| Scenario | Work required |
|---|---|
| New shop type using existing capabilities (e.g. "Vape Shop") | One `ShopTypeProfile` row. No code. |
| New shop type needing a few fields (e.g. "Music Store" needs `artist`, `label`) | One profile row + a small Shape-A plugin with `productFields`. |
| New shop type needing new entities (e.g. "Optician" needs prescriptions + frame fitting) | One profile row + a Shape-C plugin with migrations, pages, navigation. |

The core is never touched. That is the acceptance test for the whole
architecture: **if adding an industry requires editing `src/features/`, the
plugin system has failed.**
