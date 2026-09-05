package com.ningshingche.app.comments

import android.app.Application
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.ningshingche.app.ui.editorial.EditorialTheme
import com.ningshingche.app.ui.reader.ArticleCommentForm
import com.ningshingche.app.ui.reader.CommentFormState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w411dp-h891dp")
class ArticleCommentFormTest {
    @get:Rule val compose = createComposeRule()

    @Test fun `phone is optional and clicking submit does not prematurely erase draft`() {
        var form by mutableStateOf(CommentFormState(detailsLoaded = true))
        var submits = 0
        compose.setContent {
            EditorialTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    ArticleCommentForm(form, null, false, { form = it }, { submits++ })
                }
            }
        }
        compose.onNodeWithTag("comment_submit").assertIsNotEnabled()
        compose.onNodeWithTag("comment_name").performTextInput("Anonymous reader")
        compose.onNodeWithTag("comment_content").performScrollTo().performTextInput("Keep until accepted")
        compose.onNodeWithTag("comment_submit").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle {
            assertEquals(1, submits)
            assertEquals("", form.phone)
            assertEquals("", form.email)
            assertEquals("Keep until accepted", form.content)
        }
    }

    @Test fun `saved details are visible and phone input reaches the controlled form state`() {
        var form by mutableStateOf(CommentFormState(name = "Saved reader", email = "reader@example.test",
            phone = "+880", detailsLoaded = true))
        compose.setContent {
            EditorialTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    ArticleCommentForm(form, null, false, { form = it }, {})
                }
            }
        }
        compose.onNodeWithTag("comment_name").assertTextContains("Saved reader")
        compose.onNodeWithTag("comment_email").assertTextContains("reader@example.test")
        compose.onNodeWithTag("comment_phone").assertTextContains("+880").performTextReplacement("+8801700000000")
        compose.runOnIdle {
            assertEquals("+8801700000000", form.phone)
            assertEquals("", form.content)
        }
        compose.onNodeWithTag("comment_submit").assertIsNotEnabled()
    }

    @Test fun `posting disables editing and prevents duplicate submit taps`() {
        val form = CommentFormState(name = "Reader", content = "Sending", detailsLoaded = true)
        compose.setContent {
            EditorialTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    ArticleCommentForm(form, "Sending", true, {}, {})
                }
            }
        }
        for (tag in listOf("comment_name", "comment_email", "comment_phone", "comment_content", "comment_submit")) {
            compose.onNodeWithTag(tag).assertIsNotEnabled()
        }
    }
}
