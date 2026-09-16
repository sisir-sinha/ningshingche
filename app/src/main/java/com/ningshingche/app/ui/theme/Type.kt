package com.ningshingche.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontLoadingStrategy
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.Hyphens
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.TextUnit
import com.ningshingche.app.R

/**
 * Kalpurush ships as a single Regular TTF. Motorola (and some other OEMs) will
 * fall back to the system Bengali face whenever a Text asks for Medium/Bold
 * unless every weight is mapped to that same file.
 */
private fun kalpurushFace(weight: FontWeight) = Font(
    resId = R.font.kalpurush,
    weight = weight,
    loadingStrategy = FontLoadingStrategy.Blocking
)

val Kalpurush: FontFamily = FontFamily(
    kalpurushFace(FontWeight.Thin),
    kalpurushFace(FontWeight.ExtraLight),
    kalpurushFace(FontWeight.Light),
    kalpurushFace(FontWeight.Normal),
    kalpurushFace(FontWeight.Medium),
    kalpurushFace(FontWeight.SemiBold),
    kalpurushFace(FontWeight.Bold),
    kalpurushFace(FontWeight.ExtraBold),
    kalpurushFace(FontWeight.Black)
)

/**
 * Bengali must not use Latin tracking or locale line-breaking. Negative
 * letterSpacing and LineBreak.Paragraph split conjuncts onto new lines
 * (e.g. "ফিচারড" → "ফিচা / ড", "সব" stacked vertically).
 */
internal fun bengaliTextStyle(
    fontWeight: FontWeight = FontWeight.Normal,
    fontSize: TextUnit,
    lineHeight: TextUnit,
    lineHeightStyle: LineHeightStyle? = null
): TextStyle = TextStyle(
    fontFamily = Kalpurush,
    fontWeight = fontWeight,
    fontSize = fontSize,
    lineHeight = lineHeight,
    letterSpacing = 0.sp,
    lineBreak = LineBreak.Simple,
    hyphens = Hyphens.None,
    lineHeightStyle = lineHeightStyle
)

val EditorialTypography = Typography(
    displayLarge = bengaliTextStyle(FontWeight.Bold, textSize(34), textSize(42)),
    displayMedium = bengaliTextStyle(FontWeight.Bold, textSize(30), textSize(38)),
    displaySmall = bengaliTextStyle(FontWeight.SemiBold, textSize(26), textSize(34)),
    headlineLarge = bengaliTextStyle(FontWeight.Bold, textSize(24), textSize(32)),
    headlineMedium = bengaliTextStyle(FontWeight.SemiBold, textSize(22), textSize(30)),
    headlineSmall = bengaliTextStyle(FontWeight.Medium, textSize(20), textSize(28)),
    titleLarge = bengaliTextStyle(FontWeight.Bold, textSize(20), textSize(28)),
    titleMedium = bengaliTextStyle(FontWeight.SemiBold, textSize(17), textSize(24)),
    titleSmall = bengaliTextStyle(FontWeight.Medium, textSize(15), textSize(20)),
    bodyLarge = bengaliTextStyle(FontWeight.Normal, textSize(18), textSize(30)),
    bodyMedium = bengaliTextStyle(FontWeight.Normal, textSize(16), textSize(26)),
    bodySmall = bengaliTextStyle(FontWeight.Normal, textSize(14), textSize(20)),
    labelLarge = bengaliTextStyle(FontWeight.SemiBold, textSize(15), textSize(20)),
    labelMedium = bengaliTextStyle(FontWeight.Medium, textSize(13), textSize(18)),
    labelSmall = bengaliTextStyle(FontWeight.Bold, textSize(12), textSize(16))
)
