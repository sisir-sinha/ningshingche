package com.ningshingche.app.ui.editorial

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.dp
import com.ningshingche.app.ui.theme.bengaliTextStyle
import com.ningshingche.app.ui.theme.textSize
import com.ningshingche.app.ui.theme.leading

/**
 * "Modern editorial" design system — the theme itself.
 *
 * The look is borrowed from long-form magazine apps: a quiet paper background, one
 * confident accent, hairline rules instead of heavy dividers, and a real
 * typographic hierarchy (a serif display face for headlines, a neutral text face
 * for body copy). Cards stay flat; hierarchy comes from scale, weight and
 * whitespace rather than shadows. Bengali is the primary content language, so line
 * heights are generous — Bengali glyphs have tall ascenders and hanging matras —
 * and the body scale starts at 16 sp rather than Material's 14.
 *
 * **The colours are not in this file.** They live in
 * [EditorialPalettes], five presets plus one the reader builds on a colour wheel,
 * and this file turns the chosen palette into two things:
 *
 *  * [EditorialTokens], which every screen reads through [LocalEditorialTokens]
 *    instead of naming a colour — the reason a palette change is a palette change;
 *  * the Material [ColorScheme], so Material's own components (a switch, a dialog,
 *    a progress bar) arrive already wearing the palette.
 *
 * Everything a screen may paint with is a token: the four surfaces, three inks, two
 * rules, the accent and its fill, what is written on the accent, the second accent,
 * one tint for artwork, and three status colours. Nothing here is light or dark at
 * file scope any more — [EditorialTheme] decides that per palette, per screen.
 */

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * The palette, reduced to the side that is on screen.
 *
 * [paper] is what a page sits on and [surface] is what a card sits on; [surfaceSunken]
 * is the recessed one (a search bar, a rail's background), and [surfaceVariant] is the
 * card that needs to be a shade off the surface without a border.
 *
 * [accentOverArt] exists because a tint that reads on paper does not read on a
 * photograph: it is the palette's dark side, where every colour was chosen to be
 * legible on near-black.
 */
data class EditorialTokens(
    val paper: Color,
    val surface: Color,
    val surfaceVariant: Color,
    val surfaceSunken: Color,
    val ink: Color,
    val inkSoft: Color,
    val inkMuted: Color,
    val rule: Color,
    val ruleStrong: Color,
    val accent: Color,
    val accentSoft: Color,
    val onAccent: Color,
    val second: Color,
    val secondSoft: Color,
    val accentOverArt: Color,
    /**
     * The accent for the pale chip that is drawn *over* artwork — the play badge, the
     * "now playing" wave. The dark side of the scale in both themes, because the chip
     * under it is near-white in both: an accent that follows the theme would be a light
     * blue on a white chip at night, which is no ink at all.
     */
    val accentDeep: Color,
    /**
     * The palette's paper for a document that is paged rather than scrolled — the
     * PDF reader's page. It is the light side in both themes on purpose: a page of a
     * scanned book is white, and only the reader's night mode turns it dark.
     */
    val pagePaper: Color,
    val isDark: Boolean
)

/** One palette's side, as the tokens screens read. */
fun EditorialPaletteSpec.tokens(darkSide: Boolean): EditorialTokens {
    val side = if (darkSide) dark else light
    return EditorialTokens(
        paper = side.paper,
        surface = side.surface,
        surfaceVariant = side.surfaceVariant,
        surfaceSunken = side.paperSunken,
        ink = side.ink,
        inkSoft = side.inkSoft,
        inkMuted = side.inkMuted,
        rule = side.rule,
        ruleStrong = side.ruleStrong,
        accent = side.accent,
        accentSoft = side.accentSoft,
        onAccent = side.onAccent,
        second = side.second,
        secondSoft = side.secondSoft,
        accentOverArt = dark.second,
        accentDeep = light.accent,
        pagePaper = light.paper,
        isDark = darkSide
    )
}

/** What a screen paints with before a theme has been provided — the default palette. */
val LocalEditorialTokens = staticCompositionLocalOf { EditorialPalettes.default.tokens(false) }

/**
 * The Material scheme, built from the same side.
 *
 * Material's own colours are the palette's: `primary` is the accent, `secondary` the
 * second accent, `surfaceVariant` a card, `outline` a rule, `error` the palette's
 * danger. A component nobody re-styled therefore still belongs to the palette.
 */
private fun schemeOf(side: PaletteSide, isDark: Boolean): ColorScheme {
    val base = if (isDark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = side.accent,
        onPrimary = side.onAccent,
        primaryContainer = side.accentSoft,
        onPrimaryContainer = side.accent,
        secondary = side.second,
        onSecondary = side.onSecond,
        secondaryContainer = side.secondSoft,
        onSecondaryContainer = side.second,
        background = side.paper,
        onBackground = side.ink,
        surface = side.surface,
        onSurface = side.ink,
        surfaceVariant = side.surfaceVariant,
        onSurfaceVariant = side.inkSoft,
        outline = side.rule,
        outlineVariant = side.rule,
        error = side.danger,
        scrim = if (isDark) Color(0xCC000000) else side.ink.copy(alpha = 0.62f)
    )
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

/**
 * Headlines use [FontFamily.Serif] (Noto Serif on virtually every device, with a
 * Bengali fallback when the system ships one); body copy uses the system sans so
 * Bengali conjuncts render from the device's Noto Sans Bengali.
 *
 * `LineHeightStyle.Alignment.Proportional` keeps the first and last line of a
 * headline from carrying extra leading, which is what makes serif display type
 * look vertically off-centre at large sizes.
 */
object EditorialType {
    private val displayAlignment = LineHeightStyle(
        alignment = LineHeightStyle.Alignment.Proportional,
        trim = LineHeightStyle.Trim.None
    )

    val Masthead = bengaliTextStyle(FontWeight.Bold, textSize(26), textSize(32))

    val Display = bengaliTextStyle(FontWeight.Bold, textSize(34), textSize(42), displayAlignment)

    val Headline = bengaliTextStyle(FontWeight.SemiBold, textSize(24), leading(24), displayAlignment)

    val Title = bengaliTextStyle(FontWeight.SemiBold, textSize(19), leading(19), displayAlignment)

    val Subtitle = bengaliTextStyle(FontWeight.SemiBold, textSize(15), leading(15))

    val Body = bengaliTextStyle(FontWeight.Normal, textSize(16), leading(16))

    val BodySmall = bengaliTextStyle(FontWeight.Normal, textSize(14), leading(14))

    val Caption = bengaliTextStyle(FontWeight.Normal, textSize(12), leading(12))

    /** Small caps–style section eyebrows. Uppercase Latin, normal Bengali. */
    val Eyebrow = bengaliTextStyle(FontWeight.Bold, textSize(12), textSize(16))

    /** Drop-cap-capable lede paragraph for the article reader. */
    val Lede = bengaliTextStyle(FontWeight.Medium, textSize(18), leading(18))
}

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

object EditorialSpace {
    val xxs = 4.dp
    val xs = 8.dp
    val sm = 12.dp
    val md = 16.dp
    val lg = 24.dp
    val xl = 32.dp
    val xxl = 48.dp

    /** Horizontal page gutter. */
    val gutter = 20.dp
}

object EditorialShape {
    val card = 14.dp
    val sheet = 20.dp
    val chip = 999.dp
    val thumb = 10.dp
}

/**
 * The hairline that gives a card its edge — one definition, used everywhere.
 *
 * The owner's note: *"I see my Forum, Profile, Dashboard, Has limited borders,
 * bottom border."* Those three screens painted their cards with a surface colour
 * and a `tonalElevation`, and nothing else: on the app's paper the tint is a
 * couple of steps off the background, so what a reader sees is a faint edge, and
 * at the bottom where the elevation shadow falls. Every other screen in the app
 * draws an actual rule — `tokens.rule` in `EditorialComponents`, the palette's
 * own hairline colour.
 *
 * So a card that sits on the paper gets this stroke, from the palette, at the
 * width the palette was drawn for. It is a function rather than a constant so it
 * follows the reader's theme: the same call is legible on all six palettes,
 * light and dark, because `rule` is derived per side (see
 * `EditorialPalettes.kt`) rather than picked once.
 */
@Composable
fun cardBorder(): BorderStroke = BorderStroke(1.dp, LocalEditorialTokens.current.rule)

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/**
 * Puts a palette on screen: the reader's choice, in light or in dark.
 *
 * @param palette what to paint with — see [EditorialPalettes]. The default is the
 *   app's own নীলা-কালি, so a screen previewed outside the app still looks like the app.
 * @param darkTheme false for the paper side, true for the night side. The reader's
 *   choice of SYSTEM / LIGHT / DARK is turned into this boolean once, in
 *   `MainActivity`, and the app opens on DARK unless they change it.
 */
@Composable
fun EditorialTheme(
    palette: EditorialPaletteSpec = EditorialPalettes.default,
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val side = if (darkTheme) palette.dark else palette.light
    CompositionLocalProvider(
        LocalEditorialTokens provides palette.tokens(darkTheme)
    ) {
        MaterialTheme(
            colorScheme = schemeOf(side, darkTheme),
            typography = com.ningshingche.app.ui.theme.EditorialTypography,
            content = content
        )
    }
}

fun toBengaliNumeral(number: Number): String {
    val bnDigits = charArrayOf('০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯')
    return number.toString().map { ch ->
        if (ch in '0'..'9') bnDigits[ch - '0'] else ch
    }.joinToString("")
}

