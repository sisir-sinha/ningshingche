package com.ningshingche.app.ui.i18n

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import com.ningshingche.app.data.model.ContentLanguage

/**
 * Interface language plumbing.
 *
 * Every user-visible string is written in Bengali at its call site and wrapped
 * in [t]. Bengali is therefore the source text — the app is complete without a
 * single translation — and the other languages are layered on top: the table
 * provided here holds the translations fetched from the dashboard, and anything
 * missing falls back to the Bengali original.
 *
 * Values are passed as numbered slots, so a translation can move them where its
 * grammar wants them:
 *
 *     t("গান {1}টি", toBengaliNumeral(count))
 */
data class TranslationTable(
    val language: ContentLanguage = ContentLanguage.BENGALI,
    val strings: Map<String, String> = emptyMap()
) {
    /** How many strings this language translates. */
    val size: Int get() = strings.size
}

val LocalTranslations = staticCompositionLocalOf { TranslationTable() }

/** The language the interface is rendering in. */
val contentLanguage: ContentLanguage
    @Composable @ReadOnlyComposable get() = LocalTranslations.current.language

/** Bengali source text in, the reader's language out. */
fun translate(table: TranslationTable, bengali: String, vararg args: Any?): String {
    val text = if (table.language == ContentLanguage.BENGALI) {
        bengali
    } else {
        table.strings[bengali]?.takeIf { it.isNotBlank() } ?: bengali
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
    translate(LocalTranslations.current, bengali, *args)
