package com.ningshingche.app.comments

import android.app.Application
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import com.ningshingche.app.ui.editorial.EditorialTheme
import com.ningshingche.app.ui.reader.ArticleCommentForm
import com.ningshingche.app.ui.reader.CommentFormState
import com.ningshingche.app.ui.reader.CommentSignInPrompt
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

    @Test fun `guest sees sign in action`() {
        var clicks = 0
        compose.setContent { EditorialTheme { CommentSignInPrompt { clicks++ } } }
        compose.onNodeWithTag("comment_sign_in_button").performClick()
        compose.onNodeWithTag("article_comment_form").assertDoesNotExist()
        compose.runOnIdle { assertEquals(1, clicks) }
    }
    @Test fun `registered reader can submit but draft is not erased before success`() {
        var form by mutableStateOf(CommentFormState(name = "Reader", detailsLoaded = true, identityFromAccount = true))
        var submits = 0
        compose.setContent { EditorialTheme { Column(Modifier.verticalScroll(rememberScrollState())) {
            ArticleCommentForm(form, null, false, { form = it }, { submits++ })
        } } }
        compose.onNodeWithTag("comment_submit").assertIsNotEnabled()
        compose.onNodeWithTag("comment_content").performScrollTo().performTextInput("Keep until accepted")
        compose.onNodeWithTag("comment_submit").performScrollTo().assertIsEnabled().performClick()
        compose.onNodeWithTag("comment_name").assertDoesNotExist()
        compose.runOnIdle { assertEquals(1, submits); assertEquals("Keep until accepted", form.content) }
    }
    @Test fun `posting disables editing and duplicate submission`() {
        val form = CommentFormState(name = "Reader", content = "Sending", detailsLoaded = true, identityFromAccount = true)
        compose.setContent { EditorialTheme { ArticleCommentForm(form, "Sending", true, {}, {}) } }
        compose.onNodeWithTag("comment_content").assertIsNotEnabled()
        compose.onNodeWithTag("comment_submit").assertIsNotEnabled()
    }
}
