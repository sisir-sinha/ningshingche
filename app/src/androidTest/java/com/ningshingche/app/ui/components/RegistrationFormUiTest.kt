package com.ningshingche.app.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class RegistrationFormUiTest {
    @get:Rule val compose = createComposeRule()
    private val submissions = mutableListOf<List<String>>()

    private fun openForm() {
        compose.setContent {
            MaterialTheme {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    RegisterForm(inProgress = false, message = null,
                        onRegister = { first, last, email, password, photo, deleteUrl, phone, address ->
                            submissions += listOf(first, last, email, password, photo, deleteUrl, phone, address)
                        }, onSwitchToSignIn = {})
                }
            }
        }
    }
    private fun enter(tag: String, value: String) {
        compose.onNodeWithTag(tag).performScrollTo().performTextInput(value)
    }
    private fun fillRequired() {
        enter("register_first_name", "Reader")
        enter("register_last_name", "Name")
        enter("register_email", "reader@example.com")
        enter("register_password", "password123")
        enter("register_password_confirm", "password123")
    }
    @Test fun signupWorksWithoutPhotoPhoneOrAddress() {
        openForm()
        fillRequired()
        compose.onNodeWithTag("register_submit").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(listOf("", "", "", ""), submissions.single().takeLast(4)) }
    }
    @Test fun optionalPhoneAndAddressReachSignup() {
        openForm()
        enter("register_phone", "+8801712345678")
        enter("register_address", "Sylhet")
        fillRequired()
        compose.onNodeWithTag("register_submit").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(listOf("+8801712345678", "Sylhet"), submissions.single().takeLast(2)) }
    }
}
