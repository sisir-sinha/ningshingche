package com.ningshingche.app.data.portal

import java.text.Normalizer

/**
 * Tag normalisation shared by every screen that touches `blogs.tags`.
 *
 * The database is hand-edited, so the same annual issue appears under several
 * spellings — `নিংশিং চে - ২০২৩`, `নিংশিং চে-২০২৩`, `নিংশিং চে-2023`, `#নিংশিংচে ২০২৩` …
 * This object is the Kotlin twin of `backend/assets/js/tags.js`: everything
 * goes through [keyOf], which ignores whitespace, dash style, letter case, a
 * leading `#` and Bengali-vs-ASCII digits, so all spellings of one issue (or
 * one topic tag) collapse to a single comparison key.
 *
 * Keys are also what migration 013 stores in `blogs.tag_keys`, so a client that
 * talks to a database with that migration installed and one that does not can
 * share the same code paths.
 */
object IssueTags {

    private const val BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯"
    private const val ISSUE_LABEL_PREFIX = "নিংশিং চে"
    private const val ISSUE_KEY_PREFIX = "নিংশিংচে-"
    private val ISSUE_PATTERN = Regex("^(?:নিংশিংচে|ningshingche|ningshing-che)-?(\\d{4})$")
    private val DASHES = Regex("[–—−]")
    private val WHITESPACE = Regex("\\s+")

    fun toAsciiDigits(value: String): String = buildString(value.length) {
        for (ch in value) {
            val idx = BENGALI_DIGITS.indexOf(ch)
            append(if (idx >= 0) ('0' + idx) else ch)
        }
    }

    fun toBengaliDigits(value: String): String = buildString(value.length) {
        for (ch in value) append(if (ch in '0'..'9') BENGALI_DIGITS[ch - '0'] else ch)
    }

    fun toBengaliDigits(value: Int): String = toBengaliDigits(value.toString())

    /** Display form: NFC, trimmed, single spaces, no leading `#`. */
    fun clean(tag: String?): String =
        Normalizer.normalize(tag.orEmpty(), Normalizer.Form.NFC)
            .trimStart('#')
            .replace(WHITESPACE, " ")
            .trim()

    /** Raw normalisation: lower-case, ASCII digits, plain hyphen, no whitespace. */
    fun normalize(tag: String?): String =
        toAsciiDigits(clean(tag))
            .lowercase()
            .replace(DASHES, "-")
            .replace(WHITESPACE, "")

    /** Four-digit year of an annual-issue tag, or `null` for a topic tag. */
    fun issueYear(tag: String?): Int? =
        ISSUE_PATTERN.find(normalize(tag))?.groupValues?.get(1)?.toIntOrNull()

    fun isIssue(tag: String?): Boolean = issueYear(tag) != null

    /** Stable key shared by every spelling of the same issue, e.g. `নিংশিংচে-2025`. */
    fun issueKey(year: Int): String = "$ISSUE_KEY_PREFIX$year"

    /** Comparison key: issue tags collapse to [issueKey], everything else to [normalize]. */
    fun keyOf(tag: String?): String = issueYear(tag)?.let { issueKey(it) } ?: normalize(tag)

    /** Canonical display label, e.g. `নিংশিং চে-২০২৫`. */
    fun issueLabel(year: Int): String = "$ISSUE_LABEL_PREFIX-${toBengaliDigits(year)}"

    /**
     * Concrete spellings to send to PostgREST when migration 013 is not
     * installed (`tags=ov.{…}` matches exact strings only).
     */
    fun issueVariants(year: Int): List<String> {
        val ascii = year.toString()
        val bengali = toBengaliDigits(ascii)
        return listOf(bengali, ascii).flatMap { digits ->
            listOf(
                "$ISSUE_LABEL_PREFIX - $digits", "$ISSUE_LABEL_PREFIX-$digits", "$ISSUE_LABEL_PREFIX $digits",
                "$ISSUE_LABEL_PREFIX – $digits", "$ISSUE_LABEL_PREFIX — $digits", "নিংশিংচে-$digits", "নিংশিংচে $digits"
            )
        }.distinct()
    }

    /** True when any of [tags] is a spelling of the same tag as [needle]. */
    fun matches(tags: List<String>, needle: String): Boolean {
        val expected = keyOf(needle)
        if (expected.isBlank()) return false
        return tags.any { keyOf(it) == expected }
    }

    /** True when any of [tags] is the annual-issue tag for [year]. */
    fun matchesIssue(tags: List<String>, year: Int): Boolean = tags.any { issueYear(it) == year }

    /**
     * Accepts what a user might type or tap — `২০২৫`, `2025`, `নিংশিং চে - ২০২৫`
     * or `নিংশিংচে-2025` — and returns the issue year, if it is one.
     */
    fun parseYear(value: String?): Int? {
        val trimmed = clean(value)
        if (trimmed.isEmpty()) return null
        toAsciiDigits(trimmed).toIntOrNull()?.let { if (it in 1900..2199) return it }
        return issueYear(trimmed)
    }

}
