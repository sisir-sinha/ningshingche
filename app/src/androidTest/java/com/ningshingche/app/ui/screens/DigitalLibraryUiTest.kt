package com.ningshingche.app.ui.screens

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import com.ningshingche.app.data.model.PdfDocument
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class DigitalLibraryUiTest {
    @get:Rule val compose = createComposeRule()

    private fun books(count: Int) = (1..count).map { n ->
        PdfDocument(id = "$n", title = "নিংশিং চে $n", edition = "", category = "বার্ষিক সংখ্যা",
            categorySlug = "annual", year = 2026, authorOrEditor = "", pageCount = 0, fileSizeMb = 0f,
            pdfUrl = "https://example.com/$n.pdf", coverImageUrl = "", description = "")
    }

    @Test fun fifthBookAppearsWhenSeeMoreIsPressedAndCanOpen() {
        var opened = ""
        compose.setContent {
            MaterialTheme {
                LibrarySectionRow(LibrarySection("official", "নিংশিং চে", true, books(5)),
                    onOpen = { opened = it }, onDownload = {})
            }
        }
        compose.onNodeWithTag("library_official_badge").assertIsDisplayed()
        compose.onNodeWithTag("library_book_5").assertDoesNotExist()
        compose.onNodeWithTag("library_more_official").assertIsDisplayed().performClick()
        compose.onNodeWithTag("library_row_official").performScrollToNode(hasTestTag("library_book_5"))
        compose.onNodeWithTag("library_book_5").assertIsDisplayed().performClick()
        assertEquals("5", opened)
    }

    @Test fun fewerThanFiveBooksHaveNoSeeMore() {
        compose.setContent {
            MaterialTheme {
                LibrarySectionRow(LibrarySection("other", "সাময়িকী", false, books(4)), {}, {})
            }
        }
        compose.onNodeWithTag("library_more_other").assertDoesNotExist()
        compose.onNodeWithTag("library_official_badge").assertDoesNotExist()
    }
}
