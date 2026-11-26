package com.ningshingche.app.ui.screens

import com.ningshingche.app.data.model.PdfDocument
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LibrarySectionsTest {
    private fun book(id: String, title: String, category: String = "বার্ষিক সংখ্যা", year: Int = 2023) =
        PdfDocument(id = id, title = title, category = category, categorySlug = "---", year = year,
            authorOrEditor = "অঞ্জন সিংহ", edition = "প্রথম", pageCount = 10, fileSizeMb = 1f,
            pdfUrl = "https://example.com/$id.pdf", coverImageUrl = "", description = "পুরোনো সংকলন")

    @Test fun firstRowIsOnlyNingshingCheAndOtherCategoriesAreDistinct() {
        val books = listOf(book("a", "অন্য বই", "সাময়িকী"),
            book("b", "নিংশিং চে - ২০২৩ সংখ্যা"), book("c", "আরেক বই", "স্মারকপত্র"))
        val sections = librarySections(books, "")
        assertTrue(sections.first().isNingshingChe)
        assertEquals(listOf("b"), sections.first().books.map { it.id })
        assertEquals(setOf("সাময়িকী", "স্মারকপত্র"), sections.drop(1).map { it.title }.toSet())
        assertEquals(setOf("a", "b", "c"), sections.flatMap { it.books }.map { it.id }.toSet())
    }

    @Test fun searchFindsTitlesAuthorsCategoriesAndEitherDigitStyle() {
        val books = listOf(book("a", "নিংশিং চে - ২০২৩ সংখ্যা"), book("b", "কুমেই", "সাময়িকী", 2009))
        assertEquals(listOf("b"), librarySections(books, "সাময়িকী").flatMap { it.books }.map { it.id })
        assertEquals(listOf("a"), librarySections(books, "2023").flatMap { it.books }.map { it.id })
        assertEquals(listOf("b"), librarySections(books, "২০০৯").flatMap { it.books }.map { it.id })
        assertEquals(2, librarySections(books, "অঞ্জন").flatMap { it.books }.size)
        assertTrue(librarySections(books, "not found").isEmpty())
    }

    @Test fun fifthBookStartsTheSeeMoreThreshold() {
        assertEquals(4, LIBRARY_PREVIEW_COUNT)
        assertFalse((1..4).map { book("$it", "book $it") }.size > LIBRARY_PREVIEW_COUNT)
        assertTrue((1..5).map { book("$it", "book $it") }.size > LIBRARY_PREVIEW_COUNT)
    }
}
