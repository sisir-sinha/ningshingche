package com.ningshingche.app.ui.editorial

import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.ui.unit.sp
import com.ningshingche.app.ui.theme.bengaliTextStyle

/**
 * "Modern editorial" design system, in the palette নীলা-কালি — indigo ink.
 *
 * The look is still borrowed from long-form magazine apps: a quiet paper
 * background, a single confident accent, hairline rules instead of heavy
 * dividers, and a real typographic hierarchy — a serif display face for
 * headlines and a neutral text face for body copy. Cards stay flat; hierarchy
 * comes from scale, weight and whitespace rather than shadows.
 *
 * What changed, and why it is a family rather than a colour swap: the paper is
 * now **cool** rather than warm (a bluish grey-white, the colour of newsprint
 * under office light) and the accent is **indigo**, with a gold second for the
 * one other thing a screen may point at. The previous palette was warm paper,
 * maroon and saffron; the pair that replaces it is deliberately lower in
 * saturation, so a photograph on a card is the brightest thing on the screen.
 *
 * Every value here is a token, and every screen reads the token — which is the
 * only way a palette change stays a palette change. The three files that sit
 * outside the theme (the music player, the PDF reader, the splash) take the
 * light twins from `ui/theme/Color.kt` instead, because they paint on near-black
 * rather than on paper.
 *
 * Bengali is the primary content language, so line heights are generous
 * (Bengali glyphs have tall ascenders and hanging matras) and the body scale
 * starts at 16 sp rather than the Material default of 14.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

object EditorialPalette {
    // Cool neutrals — the "paper" the magazine is printed on. A bluish
    // off-white rather than a warm cream, so the paper never competes with a
    // photograph for the reader's eye.
    val Paper = Color(0xFFF7F8FB)
    val PaperSunken = Color(0xFFEDF0F7)
    val Surface = Color(0xFFFFFFFF)
    val SurfaceVariant = Color(0xFFF1F3F8)

    // Ink
    val Ink = Color(0xFF131722)
    val InkSoft = Color(0xFF414A5C)
    val InkMuted = Color(0xFF6E7787)

    // Rules and borders: hairlines, not dividers.
    val Rule = Color(0xFFDDE2EC)
    val RuleStrong = Color(0xFFC3CBD9)

    // Accents. Indigo is the masthead colour; gold is the single point of
    // emphasis per screen — used sparingly, never on two things at once.
    val Indigo = Color(0xFF2F4B8F)
    val IndigoSoft = Color(0xFFE7ECF8)
    val Gold = Color(0xFFB4761B)
    val GoldSoft = Color(0xFFFBF0DC)

    val Success = Color(0xFF1E7A54)
    val Warning = Color(0xFFB4761B)
    val Danger = Color(0xFFB4232A)

    // Dark theme: a near-black with a blue cast, and the two accents lifted
    // until they read on it.
    val DarkBg = Color(0xFF0D1017)
    val DarkSurface = Color(0xFF141926)
    val DarkSurfaceVariant = Color(0xFF1B2130)
    val DarkInk = Color(0xFFEDF0F7)
    val DarkInkSoft = Color(0xFFC3CAD8)
    val DarkInkMuted = Color(0xFF8C95A6)
    val DarkRule = Color(0xFF252C3B)
    val DarkIndigo = Color(0xFF93B0E6)
    val DarkIndigoSoft = Color(0xFF1D2740)
    val DarkGold = Color(0xFFE3B368)
}

/** Semantic tokens that sit on top of the Material colour scheme. */
data class EditorialTokens(
    val rule: Color,
    val ruleStrong: Color,
    val inkSoft: Color,
    val inkMuted: Color,
    val accent: Color,
    val accentSoft: Color,
    val surfaceSunken: Color,
    val isDark: Boolean
)

private val LightTokens = EditorialTokens(
    rule = EditorialPalette.Rule,
    ruleStrong = EditorialPalette.RuleStrong,
    inkSoft = EditorialPalette.InkSoft,
    inkMuted = EditorialPalette.InkMuted,
    accent = EditorialPalette.Indigo,
    accentSoft = EditorialPalette.IndigoSoft,
    surfaceSunken = EditorialPalette.PaperSunken,
    isDark = false
)

private val DarkTokens = EditorialTokens(
    rule = EditorialPalette.DarkRule,
    ruleStrong = EditorialPalette.DarkRule,
    inkSoft = EditorialPalette.DarkInkSoft,
    inkMuted = EditorialPalette.DarkInkMuted,
    accent = EditorialPalette.DarkIndigo,
    accentSoft = EditorialPalette.DarkIndigoSoft,
    surfaceSunken = EditorialPalette.DarkSurfaceVariant,
    isDark = true
)

val LocalEditorialTokens = staticCompositionLocalOf { LightTokens }

private val LightScheme = lightColorScheme(
    primary = EditorialPalette.Indigo,
    onPrimary = Color.White,
    primaryContainer = EditorialPalette.IndigoSoft,
    onPrimaryContainer = EditorialPalette.Indigo,
    secondary = EditorialPalette.Gold,
    onSecondary = Color.White,
    secondaryContainer = EditorialPalette.GoldSoft,
    onSecondaryContainer = Color(0xFF6B4708),
    background = EditorialPalette.Paper,
    onBackground = EditorialPalette.Ink,
    surface = EditorialPalette.Surface,
    onSurface = EditorialPalette.Ink,
    surfaceVariant = EditorialPalette.SurfaceVariant,
    onSurfaceVariant = EditorialPalette.InkSoft,
    outline = EditorialPalette.Rule,
    outlineVariant = EditorialPalette.Rule,
    error = EditorialPalette.Danger,
    scrim = Color(0x99131722)
)

private val DarkScheme = darkColorScheme(
    primary = EditorialPalette.DarkIndigo,
    onPrimary = Color(0xFF0A1730),
    primaryContainer = EditorialPalette.DarkIndigoSoft,
    onPrimaryContainer = EditorialPalette.DarkIndigo,
    secondary = EditorialPalette.DarkGold,
    onSecondary = Color(0xFF33240B),
    secondaryContainer = Color(0xFF33280F),
    onSecondaryContainer = EditorialPalette.DarkGold,
    background = EditorialPalette.DarkBg,
    onBackground = EditorialPalette.DarkInk,
    surface = EditorialPalette.DarkSurface,
    onSurface = EditorialPalette.DarkInk,
    surfaceVariant = EditorialPalette.DarkSurfaceVariant,
    onSurfaceVariant = EditorialPalette.DarkInkSoft,
    outline = EditorialPalette.DarkRule,
    outlineVariant = EditorialPalette.DarkRule,
    error = Color(0xFFFF9A8F),
    scrim = Color(0xCC000000)
)

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

    val Masthead = bengaliTextStyle(FontWeight.Bold, 26.sp, 32.sp)

    val Display = bengaliTextStyle(FontWeight.Bold, 34.sp, 42.sp, displayAlignment)

    val Headline = bengaliTextStyle(FontWeight.SemiBold, 24.sp, 32.sp, displayAlignment)

    val Title = bengaliTextStyle(FontWeight.SemiBold, 19.sp, 27.sp, displayAlignment)

    val Subtitle = bengaliTextStyle(FontWeight.SemiBold, 15.sp, 23.sp)

    val Body = bengaliTextStyle(FontWeight.Normal, 16.sp, 27.sp)

    val BodySmall = bengaliTextStyle(FontWeight.Normal, 14.sp, 23.sp)

    val Caption = bengaliTextStyle(FontWeight.Normal, 12.sp, 18.sp)

    /** Small caps–style section eyebrows. Uppercase Latin, normal Bengali. */
    val Eyebrow = bengaliTextStyle(FontWeight.Bold, 12.sp, 16.sp)

    /** Drop-cap-capable lede paragraph for the article reader. */
    val Lede = bengaliTextStyle(FontWeight.Medium, 18.sp, 31.sp)
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

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

@Composable
fun EditorialTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    CompositionLocalProvider(LocalEditorialTokens provides if (darkTheme) DarkTokens else LightTokens) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkScheme else LightScheme,
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

