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

/**
 * The same, computed once per string.
 *
 * The inputs are the literals the app is written with — a fixed set of about a
 * thousand, not a stream — so a small map settles after the first pass and the
 * regex stops running. The cap is a guard, not a policy: a caller passing a
 * string built at runtime would otherwise grow this for ever.
 */
private val looseKeys = java.util.concurrent.ConcurrentHashMap<String, String>(1024)

internal fun looseKeyOf(text: String): String {
    looseKeys[text]?.let { return it }
    val key = looseKey(text)
    if (looseKeys.size < 4096) looseKeys[text] = key
    return key
}

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
    //
    // Nothing at all in the file is the common case (Bengali out of the box, and
    // every language before its first publish), and it is answered without
    // touching the second map: the loose lookup normalises the string first —
    // a regex and two allocations — and a screen asks this function about a
    // thousand times per pass, which is not a price to pay for nothing.
    val exact = table.strings[bengali]
    val text = if (exact != null && exact.isNotBlank()) {
        exact
    } else if (table.loose.isEmpty()) {
        bengali
    } else {
        val loose = table.loose[looseKeyOf(bengali)]
        if (loose != null && loose.isNotBlank()) loose else bengali
    }
    if (args.isEmpty()) return text
    var filled = text
    args.forEachIndexed { index, value ->
        filled = filled.replace("{${index + 1}}", value?.toString().orEmpty())
    }
    return filled
}

fun t(bengali: String, vararg args: Any?): String = tNow(bengali, *args)

/**
 * The lookup itself: Bengali source text in, the reader's language out.
 *
 * It is deliberately a plain function and not a composable. The app says
 * `t("…")` everywhere — in a screen, in an `onClick` body, in a `LaunchedEffect`,
 * in a view model that builds the message a screen shows later, in a data class's
 * `toString`. Only some of those are places a composable may be called from, and
 * a call site that is wrong in that way is a build failure, not a fallback. One
 * plain function cannot be wrong anywhere.
 *
 * Recomposition is the app's job instead, and it is done at the root: the reader
 * host reads the table and keys the navigation graph on it, so a language swap
 * rebuilds every screen — and the app's root recomposes whenever the table
 * changes, which redraws everything outside the graph as well. The table itself
 * lives in [Translations], installed by [Translations.install] from the root.
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
