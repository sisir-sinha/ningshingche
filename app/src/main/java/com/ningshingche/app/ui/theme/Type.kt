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
    displayLarge = bengaliTextStyle(FontWeight.Bold, 34.sp, 42.sp),
    displayMedium = bengaliTextStyle(FontWeight.Bold, 30.sp, 38.sp),
    displaySmall = bengaliTextStyle(FontWeight.SemiBold, 26.sp, 34.sp),
    headlineLarge = bengaliTextStyle(FontWeight.Bold, 24.sp, 32.sp),
    headlineMedium = bengaliTextStyle(FontWeight.SemiBold, 22.sp, 30.sp),
    headlineSmall = bengaliTextStyle(FontWeight.Medium, 20.sp, 28.sp),
    titleLarge = bengaliTextStyle(FontWeight.Bold, 20.sp, 28.sp),
    titleMedium = bengaliTextStyle(FontWeight.SemiBold, 17.sp, 24.sp),
    titleSmall = bengaliTextStyle(FontWeight.Medium, 15.sp, 20.sp),
    bodyLarge = bengaliTextStyle(FontWeight.Normal, 18.sp, 30.sp),
    bodyMedium = bengaliTextStyle(FontWeight.Normal, 16.sp, 26.sp),
    bodySmall = bengaliTextStyle(FontWeight.Normal, 14.sp, 20.sp),
    labelLarge = bengaliTextStyle(FontWeight.SemiBold, 15.sp, 20.sp),
    labelMedium = bengaliTextStyle(FontWeight.Medium, 13.sp, 18.sp),
    labelSmall = bengaliTextStyle(FontWeight.Bold, 12.sp, 16.sp)
)
