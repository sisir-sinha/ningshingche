package com.ningshingche.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The brand's own colours — the palette নীলা-কালি, indigo ink.
 *
 * Two families, and the rule that keeps them apart:
 *
 *  * **Reading surfaces** — paper, a card, the reader — take [BrandIndigo] for the
 *    masthead and for the single accent a screen is allowed, with [BrandGold] as
 *    the one other thing worth pointing at.
 *  * **Dark surfaces** — the music player, the PDF reader's chrome, the splash at
 *    night — take the lighter pair, [BrandIndigoLight] and [BrandGoldLight]. A
 *    colour that reads as ink on paper disappears on near-black, which is the
 *    whole reason the light pair exists.
 *
 * [com.ningshingche.app.ui.editorial.EditorialPalette] is the theme's own copy of
 * the same values and is what a screen inside [EditorialTheme] should read. These
 * are for the screens that sit outside it — the media panels, the splash, the
 * drawer — and for a **slab**, which is brand rather than theme and keeps its
 * colour in both light and dark.
 *
 * This file used to carry 28 tokens, 25 of which nothing referenced: an Amber
 * scale, a Sepia set, night-paper text colours and five category accents, all
 * left over from earlier designs and all still in the old palette's values.
 * Repainting the theme was the moment to drop them — a palette is a promise about
 * what the app draws with, and a token nobody reads cannot make one. The live
 * three (the maroon, the saffron and the dark background) are the names below.
 */

// The brand ------------------------------------------------------------------

/** The masthead on paper, every slab, and the accent on a light surface. */
val BrandIndigo = Color(0xFF2F4B8F)

/** The indigo through a gradient — the archive header, a coverless book's spine. */
val BrandIndigoDeep = Color(0xFF263C73)

/** Its light twin: the accent on a dark surface, and the dark theme's own. */
val BrandIndigoLight = Color(0xFF93B0E6)

/** The second accent, on paper. */
val BrandGold = Color(0xFFB4761B)

/** The second accent on dark, on a slab, or over artwork. */
val BrandGoldLight = Color(0xFFE3B368)

/** What is written on a gold fill: a dark ink, never white. */
val BrandOnGold = Color(0xFF131722)

// Panels ---------------------------------------------------------------------

/**
 * The near-black behind artwork — the music player, the reader's chrome, a
 * cover's scrim. One family, so the app's dark surfaces match one another
 * instead of each keeping its own brown.
 */
val PanelDeep = Color(0xFF0B0E14)
val Panel = Color(0xFF141926)
val PanelSoft = Color(0xFF1B2130)
val PanelRule = Color(0xFF2A3141)

/** Text on a panel, and its two quiet neighbours. */
val PanelInk = Color(0xFFEDF0F7)
val PanelInkMuted = Color(0xFFC3CAD8)

/** An unselected chip on a panel: white at a fifth, so the fill shows through. */
val PanelChip = Color(0x33EDF0F7)

/** The app's dark canvas — what [com.ningshingche.app.ui.editorial.EditorialTheme] paints at night. */
val BrandDarkCanvas = Color(0xFF0D1017)
