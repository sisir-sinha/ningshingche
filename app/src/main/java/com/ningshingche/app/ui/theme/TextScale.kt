package com.ningshingche.app.ui.theme

import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/**
 * How large text is, everywhere — in one dial.
 *
 * The owner's note: *"Increase font size all in the app. I see the font size is
 * small."* They were right, and the reason was not one setting: the app had nearly
 * four hundred sizes written by hand, from 10 sp up, and the small end of that
 * range was doing the work that matters — labels, counts, bylines, timestamps,
 * every number on a card. Bengali is harder to read small than Latin is: a
 * conjunct is several glyphs stacked into one square, and the matras sit above and
 * below the base letter, so a 10 sp label is not a small label, it is a smudge.
 *
 * So every size in the app is now this function, and the two numbers below are the
 * whole of the decision:
 *
 *  * [APP_TEXT_SCALE] moves everything together, and nothing is sized outside it.
 *    One dial, not four hundred: raising the app's text again is this number and a
 *    rebuild, not a search through every screen.
 *  * [MIN_READABLE_SP] is the floor. Scaling alone would have left 10 sp at
 *    11.2 sp — bigger and still unreadable — so the smallest text is lifted to a
 *    size a Bengali letter can actually be seen at. Order is kept: an 11 sp label
 *    stays smaller than a 12 sp one, both are simply legible now.
 *
 * The heading sizes are moved by the same factor, so the page's hierarchy is the
 * one it always had, only larger — a scale, not a redesign. The WebView that draws
 * the rich-text editor takes the same factor into its CSS, so writing in the forum
 * is the same size as reading it.
 *
 * `backend/tests/app-text-scale.test.cjs` holds this to its word: it reads every
 * size in the app, and fails if a new one is written outside this file.
 */
const val APP_TEXT_SCALE = 1.12f

/** The smallest size text may be drawn at, before the scale. */
const val MIN_READABLE_SP = 12.5f

/**
 * A text size the app declares, scaled and floored — `textSize(12)` where a size
 * used to be written as `12.sp`.
 *
 * Both `fontSize` and `lineHeight` go through it: a line height left behind would
 * cram a larger script into the same leading, which is how Bengali conjuncts end
 * up touching.
 */
fun textSize(size: Number): TextUnit =
    (size.toFloat() * APP_TEXT_SCALE).coerceAtLeast(MIN_READABLE_SP).sp
