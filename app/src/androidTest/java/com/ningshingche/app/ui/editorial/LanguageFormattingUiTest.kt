package com.ningshingche.app.ui.editorial

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.ningshingche.app.data.model.ContentLanguage
import com.ningshingche.app.data.portal.ArticleSummary
import com.ningshingche.app.data.portal.CategoryRef
import com.ningshingche.app.ui.i18n.TranslationTable
import com.ningshingche.app.ui.i18n.Translations
import org.junit.After
import org.junit.Rule
import org.junit.Test

class LanguageFormattingUiTest {
    @get:Rule val compose = createComposeRule()
    private val article = ArticleSummary(
        id = "article", title = "A title", subTitle = "", slug = "article", imageUrl = "",
        categoryId = null, categoryTitle = "", categorySlug = "", authorId = null,
        authorName = "", authorImageUrl = "", tags = emptyList(), readingTimeMinutes = 0,
        viewsCount = 0, publishedDate = "2025-07-27", year = 2025,
        isSlider = false, isFeature = false, isSpecial = true
    )

    @After fun restoreLanguage() { Translations.install(TranslationTable()) }

    @Test fun datesAllAndSpecialNumbersSwitchWithLanguage() {
        val language = mutableStateOf(ContentLanguage.BENGALI)
        compose.setContent {
            val selected = language.value
            Translations.install(TranslationTable(selected, mapOf("সব" to "All", "ক্যাটাগরি" to "Categories")))
            MaterialTheme {
                Column {
                    CategoryRail(listOf(CategoryRef("cat", "History", "", "history", "")),
                        onSelect = {}, onSeeAll = {})
                    NumberedArticleCard(index = 1, article = article, onClick = {})
                }
            }
        }
        compose.onNodeWithText("১").assertIsDisplayed()
        compose.runOnIdle { language.value = ContentLanguage.ENGLISH }
        compose.onNodeWithText("Categories").assertIsDisplayed()
        compose.onNodeWithText("All").assertIsDisplayed()
        compose.onNodeWithText("1").assertIsDisplayed()
        compose.onNodeWithText("27 July, 2025", substring = true).assertIsDisplayed()
    }
}
