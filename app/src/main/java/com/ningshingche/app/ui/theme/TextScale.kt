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
 * How much air a line of text is given, as a multiple of its own size — the
 * second half of the same dial, and the answer to the owner's next note:
 * *"App text gapping is too much."*
 *
 * It was. Measured, not guessed: `kalpurush.ttf` declares `ascent 1000`,
 * `descent -400`, `lineGap 175`, so left to its own devices the face wants
 * **1.575 x the type size** between baselines, and the app's own styles were set
 * no tighter — `bodyLarge` at 1.67, the editorial `Body` at 1.69 and its `Lede`
 * at 1.72, and the article reader at **1.65**. The tallest glyph in the font
 * reaches 1.435 x the size from the descender to the ascender, so all of that
 * extra air was air and nothing else: Bengali paragraphs came out as loose lists
 * of separate lines instead of text.
 *
 * [APP_LEADING] is the app's own leading, and it is close to the floor the ink
 * actually needs — see [DISPLAY_LEADING] for the one exception.
 */
const val APP_LEADING = 1.45f

/**
 * Display sizes set tighter than body text, the way type has always been set: a
 * 26 sp heading with 1.45 leading looks unset, not generous. A lede paragraph
 * declared at 18 sp is still body text and still gets [APP_LEADING].
 */
const val DISPLAY_LEADING = 1.3f

/** Where text counts as display — the size as the app declares it. */
private const val DISPLAY_FROM_SP = 20f

/** A declared size after the scale and the floor — the size actually drawn. */
internal fun drawnSize(size: Number): Float =
    (size.toFloat() * APP_TEXT_SCALE).coerceAtLeast(MIN_READABLE_SP)

/**
 * A text size the app declares, scaled and floored — `textSize(12)` where a size
 * used to be written as `12.sp`.
 */
fun textSize(size: Number): TextUnit = drawnSize(size).sp

/**
 * The line box that belongs to a text of that size — `lineHeight = leading(12)`
 * beside `fontSize = textSize(12), lineHeight = leading(12)`.
 *
 * Every text in the app states both, because a line box that is *inherited* is a
 * line box the text did not ask for: Material's `bodyLarge` would hand a 13 sp
 * caption a 30 sp line, and the font's own metrics would hand it 1.575 of itself.
 * The leading follows the size, so text of any size sits in a box cut for it.
 */
fun leading(size: Number): TextUnit {
    val drawn = drawnSize(size)
    val ratio = if (size.toFloat() >= DISPLAY_FROM_SP) DISPLAY_LEADING else APP_LEADING
    return (drawn * ratio).sp
}
