package com.ningshingche.app.data.music

/** Canonical music genres for the dashboard and in-app upload forms. */
object MusicGenres {
    val ALL: List<String> = listOf(
        "লোকগীতি",
        "প্রেম",
        "বিরহ",
        "নৃত্য",
        "পালা-কীর্তন",
        "ভজন",
        "রাস",
        "রাখুয়াল",
        "আরতী",
        "সরাত",
        "ধ্রুমেল",
        "হোলি কীর্তন",
        "পল্লী",
        "আধ্যাত্মিক",
        "উৎসব",
        "দেশাত্মবোধক",
        "শিশু",
        "ঐতিহ্যবাহী",
        "আধুনিক",
        "চলচ্চিত্র",
        "ফোক-ফিউশন",
        "রিমিক্স",
        "বাদ্যযন্ত্র",
        "রক"
    )

    fun parse(raw: String): List<String> =
        raw.split(',', '،', '\t', '\n', ';')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()

    fun join(items: List<String>): String = items.joinToString(", ")
}
