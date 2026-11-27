package com.ningshingche.app.ui.editorial

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.ningshingche.app.data.portal.ArticleSummary
import org.junit.Rule
import org.junit.Test

class NoReadingTimeUiTest {
    @get:Rule val compose = createComposeRule()
    private val article = ArticleSummary(
        id = "article", title = "A featured article", subTitle = "", slug = "article", imageUrl = "",
        categoryId = null, categoryTitle = "", categorySlug = "", authorId = null,
        authorName = "A Writer", authorImageUrl = "", tags = emptyList(), readingTimeMinutes = 20,
        viewsCount = 0, publishedDate = "2025-07-27", year = 2025,
        isSlider = true, isFeature = true, isSpecial = true
    )

    @Test fun featuredCardKeepsTitleAndAuthorButHidesEstimatedMinutes() {
        compose.setContent { MaterialTheme { RailArticleCard(article, onClick = {}) } }
        compose.onNodeWithText("A featured article").assertIsDisplayed()
        compose.onNodeWithText("A Writer", substring = true).assertIsDisplayed()
        compose.onNodeWithText("minutes", substring = true).assertDoesNotExist()
        compose.onNodeWithText("মিনিট", substring = true).assertDoesNotExist()
        compose.onNodeWithText("মি.", substring = true).assertDoesNotExist()
    }

    @Test fun heroCardDoesNotRenderItsEstimatedMinutes() {
        compose.setContent { MaterialTheme { HeroArticleCard(article, onClick = {}) } }
        compose.onNodeWithText("A featured article").assertIsDisplayed()
        compose.onNodeWithText("minutes", substring = true).assertDoesNotExist()
        compose.onNodeWithText("মিনিট", substring = true).assertDoesNotExist()
        compose.onNodeWithText("মি.", substring = true).assertDoesNotExist()
    }
}
