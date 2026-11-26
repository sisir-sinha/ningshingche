package com.ningshingche.app.ui.screens

import com.ningshingche.app.data.model.PdfDocument
import java.util.Locale

/** Preview four so the fifth book makes a useful See more action. */
internal const val LIBRARY_PREVIEW_COUNT = 4

internal data class LibrarySection(
    val key: String,
    val title: String,
    val isNingshingChe: Boolean,
    val books: List<PdfDocument>
)

private fun normalizedLibraryText(value: String): String = value.trim()
    .lowercase(Locale.ROOT)
    .map { if (it in '০'..'৯') ('0'.code + (it - '০')).toChar() else it }
    .joinToString("")
    .replace(Regex("\\s+"), " ")

internal fun isNingshingCheBook(book: PdfDocument): Boolean {
    val title = normalizedLibraryText(book.title)
    return title.startsWith("নিংশিং চে") || title.startsWith("নিংশিংচে") ||
        title.startsWith("ningshing che") || title.startsWith("ningshingche")
}

/** Group by the dashboard category name, not the ASCII-only category slug. */
internal fun librarySections(books: List<PdfDocument>, query: String): List<LibrarySection> {
    val needle = normalizedLibraryText(query)
    val matching = books.filter { book ->
        needle.isBlank() || listOf(book.title, book.authorOrEditor, book.edition, book.category,
            book.year.takeIf { it > 0 }?.toString().orEmpty(), book.description)
            .any { normalizedLibraryText(it).contains(needle) }
    }
    val official = matching.filter(::isNingshingCheBook)
    val other = matching.filterNot(::isNingshingCheBook).groupBy {
        normalizedLibraryText(it.category).ifBlank { "__uncategorized__" }
    }
    return buildList {
        if (official.isNotEmpty()) add(LibrarySection("ningshing-che", "নিংশিং চে", true, official))
        other.entries.sortedBy { it.key }.forEach { (key, docs) ->
            add(LibrarySection("category:$key", docs.first().category.trim(), false, docs))
        }
    }
}
