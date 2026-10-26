package com.ningshingche.app.util

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * Date formatters, built once per pattern per thread.
 *
 * `SimpleDateFormat` is not thread-safe, so each thread keeps its own copy — and
 * building one is the expensive part: the pattern is compiled and the locale's
 * month and weekday names are loaded. Building one inside a list row means
 * building it again for every visible row on every pass of a scroll, which is
 * what made the reading list and the notification list heavy.
 *
 * `java.time` would not need any of this, but `minSdk` is 24 and this module does
 * not enable core library desugaring, so `java.time.*` would throw on Android 7.
 */
internal object DateFormats {

    private val cache = ThreadLocal.withInitial { HashMap<String, SimpleDateFormat>(8) }

    /** A formatter for [pattern], in [locale], reading [utc] if asked. */
    fun of(pattern: String, locale: Locale = Locale.US, utc: Boolean = false): SimpleDateFormat {
        val key = if (utc) "$pattern|$locale|utc" else "$pattern|$locale"
        val mine = cache.get()!!
        mine[key]?.let { return it }
        val formatter = SimpleDateFormat(pattern, locale)
        if (utc) formatter.timeZone = TimeZone.getTimeZone("UTC")
        mine[key] = formatter
        return formatter
    }
}
