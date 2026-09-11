package com.ningshingche.app.data.portal

import java.net.URLEncoder

/**
 * Builds the PostgREST filter behind the reader's search box.
 *
 * Everything here was checked against the live database rather than assumed —
 * each rule below exists because the obvious version of it failed:
 *
 * 1. **A word inside the article must be findable.** Searching only `title`,
 *    `sub_title` and `slug` answers nothing to a reader who types a place they
 *    read in a piece (`কমলগঞ্জ` appears in three articles, none of them titled
 *    with it), so the body and the author are searched too.
 * 2. **`tags` and `tag_keys` are `text[]`**, so `tags.ilike.…` is a Postgres
 *    `42883` ("operator does not exist: text[] ~~* unknown"); they are exact-keyword
 *    filters (`cs.{}`) and stay out of free-text search.
 * 3. **Several words are separate conditions.** `"মণিপুরী ব্যান্ড"` as one
 *    pattern matches nothing; as two conditions it finds
 *    `বাংলাদেশে মণিপুরী যত ব্যান্ড`. One word needs no wrapper, so it is sent as
 *    `or=(…)`; two or more become `and=(or(…),or(…))`.
 * 4. **Punctuation must not break the expression.** PostgREST decodes the
 *    parameter *before* parsing it, so a comma or bracket typed by the reader
 *    used to end in `PGRST100`. Values are quoted — the escaping PostgREST
 *    provides inside expressions; percent-encoding does not protect them.
 *
 * The value is percent-encoded once, at the end, because the API methods send
 * these parameters with `encoded = true`. Java's `URLEncoder` leaves `.`, `-`,
 * `*` and `_` alone, so the wildcards travel raw and arrive as wildcards.
 */
object SearchQuery {

    /** Text columns a term is matched against; see (2) for why `tags` is absent. */
    val COLUMNS = listOf("title", "sub_title", "slug", "author_name", "content")

    /** Words beyond this are ignored — a fifth condition adds nothing useful. */
    const val MAX_TERMS = 4

    /** The shortest query worth sending; shorter terms match too much. */
    const val MIN_LENGTH = 2

    /** PostgREST filter parameter and its value, e.g. `or` + `(title.ilike."*গান*")`. */
    data class Filter(val parameter: String, val value: String)

    /** The reader's text as search terms: whitespace-separated, capped, blanks removed. */
    fun terms(raw: String): List<String> =
        raw.trim().split(WHITESPACE)
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .take(MAX_TERMS)

    /**
     * A `like`/`ilike` pattern for one term: quoted, wildcard on both sides, with
     * any quote or backslash in the reader's own text escaped.
     */
    fun likeValue(term: String): String {
        val escaped = term.replace("\\", "\\\\").replace("\"", "\\\"")
        return "\"*$escaped*\""
    }

    /** One term against every column, as the parenthesised list `or=` expects. */
    fun conditionFor(term: String): String =
        "(" + COLUMNS.joinToString(",") { "$it.ilike.${likeValue(term)}" } + ")"

    /**
     * The filter for the whole query, or null when it is too short to run.
     */
    fun build(raw: String): Filter? {
        val trimmed = raw.trim()
        if (trimmed.length < MIN_LENGTH) return null
        val terms = terms(trimmed)
        if (terms.isEmpty()) return null
        return if (terms.size == 1) {
            Filter("or", conditionFor(terms[0]))
        } else {
            // Each word is its own `or` group; `and` requires all of them.
            Filter("and", "(" + terms.joinToString(",") { "or${conditionFor(it)}" } + ")")
        }
    }

    /** Percent-encodes a filter value for transport (`+` is not a space here). */
    fun encode(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private val WHITESPACE = Regex("\\s+")
}
