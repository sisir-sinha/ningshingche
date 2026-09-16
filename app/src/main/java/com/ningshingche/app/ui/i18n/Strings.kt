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
 * Bengali is layered on in the same way. Its file is normally empty, and then
 * every lookup misses and the compiled string is shown; a row entered on the
 * dashboard's Languages page (key `লেখক`, value `লেখকবৃন্দ`) replaces that
 * wording wherever the app says `লেখক`. The key never changes, so an editor can
 * rewrite the Bengali without the app losing track of which string it is.
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

    /**
     * The same table keyed loosely, so a translation survives the punctuation
     * difference a person typing a CSV will not notice: `অডিও ফাইল পড়া যায়নি`
     * and `অডিও ফাইল পড়া যায়নি।` are the same string to a reader. Exact matches
     * still win — this map is only consulted second.
     */
    val loose: Map<String, String> by lazy {
        strings.entries.associate { (key, value) -> looseKey(key) to value }
    }
}

/** Trimmed, single-spaced, and without trailing sentence punctuation. */
internal fun looseKey(text: String): String =
    text.trim().replace(WHITESPACE, " ").trimEnd('।', '.', '!', '?', ' ', '\u200b')

private val WHITESPACE = Regex("\\s+")

val LocalTranslations = staticCompositionLocalOf { TranslationTable() }

/** The language the interface is rendering in. */
val contentLanguage: ContentLanguage
    @Composable @ReadOnlyComposable get() = LocalTranslations.current.language

/** Bengali source text in, the reader's language out. */
fun translate(table: TranslationTable, bengali: String, vararg args: Any?): String {
    // The file wins whenever it has this string — for Bengali as well, where a
    // row means an editor rewrote that wording. Anything absent or blank stays
    // exactly as compiled, which is what every key looks like by default.
    val text = table.strings[bengali]?.takeIf { it.isNotBlank() }
        ?: table.loose[looseKey(bengali)]?.takeIf { it.isNotBlank() }
        ?: bengali
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

/**
 * The same lookup where a composable is not allowed.
 *
 * Most of the app can call [t] — it reads the composition, so a language swap
 * redraws the screens that used it. Some places cannot: an `onClick` body, a
 * `LaunchedEffect`, a coroutine, a data class's `toString`, and the view models
 * that build the message a screen later shows. Compose forbids a composable call
 * in any of those, and the alternative — translating the message at the screen
 * instead — would mean every message in the app being rebuilt one at a time.
 *
 * So the table is also kept here, installed by [Translations.install] on every
 * composition of the app's root. `tNow("…")` is a plain function call and works
 * anywhere. Messages built at the moment an event happens (a tap, a failed
 * request) are read exactly once and are therefore never stale.
 */
fun tNow(bengali: String, vararg args: Any?): String =
    translate(Translations.current, bengali, *args)

/** Where [tNow] finds the table: the one the app is rendering in right now. */
object Translations {
    @Volatile
    var current: TranslationTable = TranslationTable()
        private set

    /** Called from the app's root. Cheap enough to run on every composition. */
    fun install(table: TranslationTable) {
        current = table
    }
}
