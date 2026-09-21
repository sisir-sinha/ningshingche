package com.ningshingche.app.util

/** `০১২৩৪৫৬৭৮৯`, indexed by the ASCII digit it stands for. */
internal const val BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯"

/**
 * The digits of [text] in Bengali numerals, and nothing else changed.
 *
 * One pass and one string, because this is called from list rows: the original
 * `text.map { … }.joinToString("")` allocated a list, a boxed character per digit
 * and a string for every number on the screen, on every pass of a scroll.
 */
fun bengaliDigits(text: String): String {
    var ascii = false
    for (ch in text) if (ch in '0'..'9') { ascii = true; break }
    if (!ascii) return text
    return buildString(text.length) {
        for (ch in text) append(if (ch in '0'..'9') BENGALI_DIGITS[ch - '0'] else ch)
    }
}

/** A number, written the way a Bengali reader counts. */
fun toBengaliDigits(number: Number): String = bengaliDigits(number.toString())
