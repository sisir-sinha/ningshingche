package com.ningshingche.app.util

import com.ningshingche.app.data.model.ContentLanguage
import java.text.ParsePosition
import java.util.Locale
import java.util.TimeZone

/** Presentation formatting only. Database IDs, search keys and content remain unchanged. */
internal object LocalizedFormatting {
    private val bnLocale = Locale("bn", "BD")
    private val dates = java.util.concurrent.ConcurrentHashMap<String, String>()
    private val monthsBn = listOf("জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
        "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর")
    private val monthsEn = listOf("January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December")

    fun digits(text: String, language: ContentLanguage): String {
        if (language != ContentLanguage.ENGLISH) return bengaliDigits(text)
        if (text.none { it in '০'..'৯' }) return text
        return buildString(text.length) {
            for (ch in text) append(if (ch in '০'..'৯') ('0'.code + (ch - '০')).toChar() else ch)
        }
    }

    private fun locale(language: ContentLanguage) =
        if (language == ContentLanguage.ENGLISH) Locale.US else bnLocale

    private fun cached(key: String, calculate: () -> String): String {
        dates[key]?.let { return it }
        val result = calculate()
        if (dates.size > 1024) dates.clear()
        dates[key] = result
        return result
    }

    /** A published date is a calendar date, so do not shift it across time zones. */
    fun date(input: String, language: ContentLanguage): String {
        if (input.isBlank()) return ""
        val key = "date|$language|${TimeZone.getDefault().id}|$input"
        return cached(key) {
            val ascii = digits(input.trim(), ContentLanguage.ENGLISH)
            val iso = ascii.take(10)
            val parsed = if (iso.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) {
                val parser = DateFormats.of("yyyy-MM-dd").apply {
                    isLenient = false
                    timeZone = TimeZone.getDefault()
                }
                parser.parse(iso, ParsePosition(0))
            } else null
            if (parsed != null) {
                val formatter = DateFormats.of("d MMMM, yyyy", locale(language)).apply {
                    timeZone = TimeZone.getDefault()
                }
                digits(formatter.format(parsed), language)
            } else {
                // Some older records store a preformatted Bengali date rather than ISO.
                var result = digits(input, language)
                if (language == ContentLanguage.ENGLISH) {
                    monthsBn.forEachIndexed { index, month -> result = result.replace(month, monthsEn[index]) }
                }
                result
            }
        }
    }

    /** Supabase timestamps are UTC when no offset is supplied; display in the device zone. */
    fun dateTime(input: String, language: ContentLanguage): String {
        if (input.isBlank()) return ""
        val key = "datetime|$language|${TimeZone.getDefault().id}|$input"
        return cached(key) {
            val source = digits(input.trim(), ContentLanguage.ENGLISH).replace(' ', 'T')
                .replace(Regex("\\.\\d+(?=Z|[+-]\\d\\d(?::?\\d\\d)?|$)"), "")
                .replace(Regex("([+-]\\d\\d)(\\d\\d)$"), "$1:$2")
                .replace(Regex("([+-]\\d\\d)$"), "$1:00")
            val hasOffset = Regex("(Z|[+-]\\d\\d:\\d\\d)$").containsMatchIn(source)
            val pattern = if (hasOffset) "yyyy-MM-dd'T'HH:mm:ssXXX" else "yyyy-MM-dd'T'HH:mm:ss"
            val parsed = runCatching {
                val position = ParsePosition(0)
                val value = DateFormats.of(pattern, Locale.US, utc = true).apply { isLenient = false }
                    .parse(source, position)
                value.takeIf { position.index == source.length }
            }.getOrNull()
            if (parsed == null) return@cached date(input, language)
            val zone = TimeZone.getDefault()
            val date = DateFormats.of("d MMMM", locale(language)).apply { timeZone = zone }.format(parsed)
            if (language == ContentLanguage.ENGLISH) {
                val clock = DateFormats.of("h:mm a", Locale.US).apply { timeZone = zone }.format(parsed)
                "$date, $clock"
            } else {
                val clock = DateFormats.of("h:mm", Locale.US).apply { timeZone = zone }.format(parsed)
                val hour = DateFormats.of("H", Locale.US).apply { timeZone = zone }.format(parsed).toInt()
                bengaliDigits("$date, $clock ${if (hour < 12) "পূর্বাহ্ণ" else "অপরাহ্ণ"}")
            }
        }
    }

}
