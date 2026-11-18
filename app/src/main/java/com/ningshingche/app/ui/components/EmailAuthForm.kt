package com.ningshingche.app.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ningshingche.app.ui.i18n.t
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.leading
import com.ningshingche.app.ui.theme.textSize

/**
 * Email and password, beside the Google button.
 *
 * One section does three jobs, because they are the same amount of typing and a
 * separate screen for each would be three places to keep in step: sign in, create
 * an account, and recover a forgotten password.
 *
 * Recovery is three steps and they are driven by the view model's flags, not by
 * local state, so a rotation does not lose the reader's place:
 *
 *   [resetCodeSent] false          ask for the address
 *   [resetCodeSent] true           ask for the six-digit code
 *   [passwordResetActive] true     ask for the new password
 *
 * The last step exists because accepting the code *signs the reader in*: without
 * it the screen would navigate away before a new password had been chosen, and the
 * old one would still work.
 */
@Composable
fun EmailAuthSection(
    inProgress: Boolean,
    message: String?,
    resetCodeSent: Boolean,
    passwordResetActive: Boolean,
    onSignIn: (String, String) -> Unit,
    onSendResetCode: (String) -> Unit,
    onVerifyResetCode: (String, String) -> Unit,
    onSaveNewPassword: (String) -> Unit,
    onCancelReset: () -> Unit,
    onOpenRegistration: () -> Unit
) {
    var recovering by rememberSaveable { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var confirmPassword by rememberSaveable { mutableStateOf("") }

    val editable = !inProgress

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        if (message != null) {
            Text(
                text = message,
                fontFamily = Kalpurush,
                fontSize = textSize(13),
                lineHeight = leading(13),
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp)
                    .testTag("email_auth_message")
            )
        }

        when {
            // ------------------------------------------------ new password
            passwordResetActive -> {
                Text(
                    text = t("নতুন পাসওয়ার্ড দিন"),
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = textSize(16),
                    lineHeight = leading(16),
                    color = MaterialTheme.colorScheme.onBackground
                )
                Spacer(Modifier.height(12.dp))
                PasswordField(
                    value = password,
                    onValueChange = { password = it },
                    label = t("নতুন পাসওয়ার্ড"),
                    enabled = editable,
                    tag = "email_new_password"
                )
                Spacer(Modifier.height(10.dp))
                PasswordField(
                    value = confirmPassword,
                    onValueChange = { confirmPassword = it },
                    label = t("আবার লিখুন"),
                    enabled = editable,
                    tag = "email_new_password_confirm"
                )
                Spacer(Modifier.height(14.dp))
                SubmitButton(
                    label = t("পাসওয়ার্ড সংরক্ষণ করুন"),
                    inProgress = inProgress,
                    enabled = editable && password.length >= MIN_PASSWORD && password == confirmPassword,
                    tag = "email_save_password",
                    onClick = { onSaveNewPassword(password) }
                )
            }

            // ------------------------------------------------- recovery
            recovering -> {
                Text(
                    text = if (resetCodeSent) t("মেইলে আসা কোডটি দিন") else t("পাসওয়ার্ড ভুলে গেছেন?"),
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = textSize(16),
                    lineHeight = leading(16),
                    color = MaterialTheme.colorScheme.onBackground
                )
                Spacer(Modifier.height(12.dp))
                EmailField(
                    value = email,
                    onValueChange = { email = it },
                    enabled = editable,
                    tag = "email_recover_address"
                )
                if (resetCodeSent) {
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = it.filter { ch -> ch.isDigit() }.take(CODE_LENGTH) },
                        label = { Text(t("৬ সংখ্যার কোড"), fontFamily = Kalpurush) },
                        singleLine = true,
                        enabled = editable,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("email_recover_code")
                    )
                }
                Spacer(Modifier.height(14.dp))
                SubmitButton(
                    label = if (resetCodeSent) t("কোড যাচাই করুন") else t("কোড পাঠান"),
                    inProgress = inProgress,
                    enabled = editable && email.isNotBlank() && (!resetCodeSent || code.length == CODE_LENGTH),
                    tag = if (resetCodeSent) "email_verify_code" else "email_send_code",
                    onClick = {
                        if (resetCodeSent) onVerifyResetCode(email, code) else onSendResetCode(email)
                    }
                )
                TextButton(
                    onClick = {
                        recovering = false
                        code = ""
                        onCancelReset()
                    },
                    enabled = editable,
                    modifier = Modifier.testTag("email_recover_cancel")
                ) {
                    Text(
                        text = t("সাইন ইনে ফিরুন"),
                        fontFamily = Kalpurush,
                        fontSize = textSize(13),
                        lineHeight = leading(13)
                    )
                }
            }

            // ---------------------------------------------- sign in / sign up
            else -> {
                EmailField(
                    value = email,
                    onValueChange = { email = it },
                    enabled = editable,
                    tag = "email_address"
                )
                Spacer(Modifier.height(10.dp))
                PasswordField(
                    value = password,
                    onValueChange = { password = it },
                    label = t("পাসওয়ার্ড"),
                    enabled = editable,
                    tag = "email_password"
                )
                Spacer(Modifier.height(14.dp))
                SubmitButton(
                    label = t("সাইন ইন করুন"),
                    inProgress = inProgress,
                    enabled = editable && email.isNotBlank() && password.isNotEmpty(),
                    tag = "email_sign_in",
                    onClick = { onSignIn(email, password) }
                )
                // Registration is a different form, with names and a picture, and it
                // lives on the first-run screen where a new reader meets it. A second
                // signup here would be a poorer copy that has to be kept in step.
                TextButton(
                    onClick = onOpenRegistration,
                    enabled = editable,
                    modifier = Modifier.testTag("email_open_registration")
                ) {
                    Text(
                        text = t("নতুন? অ্যাকাউন্ট খুলুন"),
                        fontFamily = Kalpurush,
                        fontSize = textSize(13),
                        lineHeight = leading(13)
                    )
                }
                TextButton(
                    onClick = { recovering = true },
                    enabled = editable,
                    modifier = Modifier.testTag("email_forgot_password")
                ) {
                    Text(
                        text = t("পাসওয়ার্ড ভুলে গেছেন?"),
                        fontFamily = Kalpurush,
                        fontSize = textSize(13),
                        lineHeight = leading(13),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

/**
 * Kept here rather than imported from the data layer: the form needs the same
 * number, and a UI package that reaches into `data.auth` for a constant ends up
 * reaching for the rest of it.
 */
private const val MIN_PASSWORD = 8

private const val CODE_LENGTH = 6

@Composable
private fun EmailField(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    tag: String
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(t("ইমেইল"), fontFamily = Kalpurush) },
        singleLine = true,
        enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        modifier = Modifier
            .fillMaxWidth()
            .testTag(tag)
    )
}

@Composable
private fun PasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    enabled: Boolean,
    tag: String
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label, fontFamily = Kalpurush) },
        singleLine = true,
        enabled = enabled,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier
            .fillMaxWidth()
            .testTag(tag)
    )
}

@Composable
private fun SubmitButton(
    label: String,
    inProgress: Boolean,
    enabled: Boolean,
    tag: String,
    onClick: () -> Unit
) {
    Button(
        onClick = onClick,
        enabled = enabled && !inProgress,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .testTag(tag)
    ) {
        if (inProgress) {
            CircularProgressIndicator(
                color = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(22.dp),
                strokeWidth = 2.5.dp
            )
        } else {
            Text(
                text = label,
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = textSize(15),
                lineHeight = leading(15)
            )
        }
    }
}
