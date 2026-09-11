package com.ningshingche.app.ui.i18n

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import com.ningshingche.app.data.model.ContentLanguage

/**
 * Interface language plumbing.
 *
 * Every user-visible string is written in Bengali at its call site and wrapped
 * in [t] (or [translate] outside composition). Bengali is therefore the source
 * text — the app is complete without a single translation — and Bishnupriya
 * Manipuri is layered on top: [BISHNUPRIYA] holds the translated strings and
 * anything missing falls back to the Bengali original.
 *
 * The table is generated from `i18n/strings_inventory.csv`, the file a reviewer
 * fills in (`python3 i18n/generate_strings.py`). Nothing here is guessed: an
 * empty table means the app reads exactly as it always did.
 *
 * Strings with values are written with numbered slots, so a translation can
 * move the value where its grammar wants it:
 *
 *     t("গান {1}টি", toBengaliNumeral(count))
 */

val LocalContentLanguage = staticCompositionLocalOf { ContentLanguage.BENGALI }

/** The current interface language, for the few places that need to branch. */
val contentLanguage: ContentLanguage
    @Composable @ReadOnlyComposable get() = LocalContentLanguage.current

/** True when the interface is running in Bishnupriya Manipuri. */
val isBishnupriya: Boolean
    @Composable @ReadOnlyComposable get() = LocalContentLanguage.current == ContentLanguage.BISHNUPRIYA

/**
 * Bengali source text in, the reader's language out.
 *
 * One argument means no slots; more arguments fill `{1}`, `{2}`, … in that
 * order. Values arrive already formatted (numerals included), because the
 * translator cannot know what a number is.
 */
fun translate(language: ContentLanguage, bengali: String, vararg args: Any?): String {
    val text = if (language == ContentLanguage.BISHNUPRIYA) {
        BISHNUPRIYA[bengali] ?: bengali
    } else {
        bengali
    }
    if (args.isEmpty()) return text
    var filled = text
    args.forEachIndexed { index, value ->
        filled = filled.replace("{${index + 1}}", value?.toString().orEmpty())
    }
    return filled
}

@Composable
@ReadOnlyComposable
fun t(bengali: String, vararg args: Any?): String =
    translate(LocalContentLanguage.current, bengali, *args)

/** How much of the interface is translated, for the progress line in Settings. */
fun bishnupriyaCoverage(): Pair<Int, Int> = BISHNUPRIYA.size to BISHNUPRIYA_SOURCE_COUNT
