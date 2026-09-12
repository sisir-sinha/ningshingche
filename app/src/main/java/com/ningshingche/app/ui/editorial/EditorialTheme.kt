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
 * "Modern editorial" design system.
 *
 * The look is borrowed from long-form magazine apps: a warm paper background, a
 * single confident accent, hairline rules instead of heavy dividers, and a real
 * typographic hierarchy — a serif display face for headlines and a neutral text
 * face for body copy. Cards stay flat; hierarchy comes from scale, weight and
 * whitespace rather than shadows.
 *
 * Bengali is the primary content language, so line heights are generous
 * (Bengali glyphs have tall ascenders and hanging matras) and the body scale
 * starts at 16 sp rather than the Material default of 14.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

object EditorialPalette {
    // Warm neutrals — the "paper" the magazine is printed on.
    val Paper = Color(0xFFFDFBF7)
    val PaperSunken = Color(0xFFF6F1E8)
    val Surface = Color(0xFFFFFFFF)
    val SurfaceVariant = Color(0xFFF1EBE0)

    // Ink
    val Ink = Color(0xFF1A1512)
    val InkSoft = Color(0xFF4A423A)
    val InkMuted = Color(0xFF7A6E62)

    // Rules and borders: hairlines, not dividers.
    val Rule = Color(0xFFE3DACD)
    val RuleStrong = Color(0xFFCDBCAA)

    // Accents. Maroon is the masthead colour, saffron is the single point of
    // emphasis per screen — used sparingly, never on two things at once.
    val Maroon = Color(0xFF7A2E1E)
    val MaroonSoft = Color(0xFFF2E4DE)
    val Saffron = Color(0xFFD97706)
    val SaffronSoft = Color(0xFFFDF0DC)

    val Success = Color(0xFF2F6B4F)
    val Warning = Color(0xFFB45309)
    val Danger = Color(0xFFB42318)

    // Dark theme
    val DarkBg = Color(0xFF12100E)
    val DarkSurface = Color(0xFF1C1917)
    val DarkSurfaceVariant = Color(0xFF272320)
    val DarkInk = Color(0xFFF7F2EA)
    val DarkInkSoft = Color(0xFFD8CFC3)
    val DarkInkMuted = Color(0xFF9C9186)
    val DarkRule = Color(0xFF322C27)
    val DarkMaroon = Color(0xFFE9A08C)
    val DarkSaffron = Color(0xFFF0A94B)
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
    accent = EditorialPalette.Maroon,
    accentSoft = EditorialPalette.MaroonSoft,
    surfaceSunken = EditorialPalette.PaperSunken,
    isDark = false
)

private val DarkTokens = EditorialTokens(
    rule = EditorialPalette.DarkRule,
    ruleStrong = EditorialPalette.DarkRule,
    inkSoft = EditorialPalette.DarkInkSoft,
    inkMuted = EditorialPalette.DarkInkMuted,
    accent = EditorialPalette.DarkMaroon,
    accentSoft = Color(0xFF33231D),
    surfaceSunken = EditorialPalette.DarkSurfaceVariant,
    isDark = true
)

val LocalEditorialTokens = staticCompositionLocalOf { LightTokens }

private val LightScheme = lightColorScheme(
    primary = EditorialPalette.Maroon,
    onPrimary = Color.White,
    primaryContainer = EditorialPalette.MaroonSoft,
    onPrimaryContainer = EditorialPalette.Maroon,
    secondary = EditorialPalette.Saffron,
    onSecondary = Color.White,
    secondaryContainer = EditorialPalette.SaffronSoft,
    onSecondaryContainer = Color(0xFF7A4A08),
    background = EditorialPalette.Paper,
    onBackground = EditorialPalette.Ink,
    surface = EditorialPalette.Surface,
    onSurface = EditorialPalette.Ink,
    surfaceVariant = EditorialPalette.SurfaceVariant,
    onSurfaceVariant = EditorialPalette.InkSoft,
    outline = EditorialPalette.Rule,
    outlineVariant = EditorialPalette.Rule,
    error = EditorialPalette.Danger,
    scrim = Color(0x991A1512)
)

private val DarkScheme = darkColorScheme(
    primary = EditorialPalette.DarkMaroon,
    onPrimary = Color(0xFF3B1710),
    primaryContainer = Color(0xFF33231D),
    onPrimaryContainer = EditorialPalette.DarkMaroon,
    secondary = EditorialPalette.DarkSaffron,
    onSecondary = Color(0xFF3B2408),
    secondaryContainer = Color(0xFF33280F),
    onSecondaryContainer = EditorialPalette.DarkSaffron,
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

