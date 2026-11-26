package com.ningshingche.app.ui.editorial

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import com.ningshingche.app.data.portal.ArticleSummary
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Device check for Bengali titles and bylines at an enlarged accessibility font scale. */
class FeaturedCardTest {
    @get:Rule val compose = createComposeRule()

    @Test fun featuredTitleAndBylineAreNotClipped() {
        val title = "বিষ্ণুপ্রিয়া মণিপুরী ভাষা আন্দোলন ও তেইশে মে নিয়ে কিছু গুরুত্বপূর্ণ কথা"
        val author = "ড. কাশ্যপকরণ সিংহ"
        val article = ArticleSummary(
            id = "featured-1", title = title, subTitle = "", slug = "featured-1", imageUrl = "",
            categoryId = null, categoryTitle = "", categorySlug = "", authorId = null,
            authorName = author, authorImageUrl = "", tags = emptyList(), readingTimeMinutes = 7,
            viewsCount = 0, publishedDate = "2025-07-10", year = 2025, isSlider = false,
            isFeature = true, isSpecial = false
        )
        compose.setContent {
            val deviceDensity = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(deviceDensity, fontScale = 1.5f)) {
                MaterialTheme { RailArticleCard(article = article, onClick = {}) }
            }
        }
        listOf(title, author).forEach { text ->
            val node = compose.onNodeWithText(text, substring = text == author, useUnmergedTree = true)
            node.assertIsDisplayed()
            node.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { getResults ->
                val layouts = mutableListOf<TextLayoutResult>()
                assertTrue(getResults(layouts))
                assertTrue(layouts.isNotEmpty())
                assertFalse("Featured text overflows its layout", layouts.first().hasVisualOverflow)
            }
        }
    }
}
