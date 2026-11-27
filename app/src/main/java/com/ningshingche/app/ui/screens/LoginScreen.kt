package com.ningshingche.app.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ningshingche.app.ui.components.EmailAuthSection
import com.ningshingche.app.ui.components.RegisterForm
import com.ningshingche.app.ui.components.RegistrationProfileWarning
import com.ningshingche.app.ui.components.GoogleSignInButton
import com.ningshingche.app.ui.components.NingshingCheBrandLogo
import com.ningshingche.app.ui.theme.textSize
import com.ningshingche.app.ui.theme.leading
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.viewmodel.SettingsViewModel
import com.ningshingche.app.ui.i18n.t

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    viewModel: SettingsViewModel,
    onBackClick: () -> Unit,
    onSignedIn: () -> Unit
) {
    val context = LocalContext.current
    val currentUser by viewModel.currentUser.collectAsStateWithLifecycle()
    val inProgress by viewModel.googleAuthInProgress.collectAsStateWithLifecycle()
    val message by viewModel.googleAuthMessage.collectAsStateWithLifecycle()
    val emailInProgress by viewModel.emailAuthInProgress.collectAsStateWithLifecycle()
    val emailMessage by viewModel.emailAuthMessage.collectAsStateWithLifecycle()
    val registrationWarning by viewModel.registrationProfileWarning.collectAsStateWithLifecycle()
    BackHandler(enabled = emailInProgress) { /* Let the auth operation finish. */ }
    val resetCodeSent by viewModel.resetCodeSent.collectAsStateWithLifecycle()
    val passwordResetActive by viewModel.passwordResetActive.collectAsStateWithLifecycle()

    // Registration needs names and a picture, so it is the full form rather than a
    // third mode of the sign-in section. Reached from Settings → sign in, and from
    // the first-run screen, which opens its own copy directly.
    var registering by rememberSaveable { mutableStateOf(false) }

    // Step two of password recovery signs the reader in, so a non-null user is not
    // by itself a reason to leave this screen: until the new password is saved,
    // navigating away would leave the old one working and the new one unset.
    LaunchedEffect(currentUser?.id, passwordResetActive, emailInProgress, inProgress, registrationWarning) {
        if (currentUser != null && !passwordResetActive && !emailInProgress && !inProgress && registrationWarning == null) {
            onSignedIn()
        }
    }
    registrationWarning?.let { warning ->
        RegistrationProfileWarning(warning, viewModel::acknowledgeRegistrationProfileWarning)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(t("সাইন ইন"), fontFamily = Kalpurush, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBackClick, enabled = !emailInProgress && !inProgress, modifier = Modifier.testTag("login_back_button")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = t("ফিরুন"))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            NingshingCheBrandLogo(size = 72.dp)
            Spacer(Modifier.height(16.dp))
            Text(
                text = t("নিংশিং চে"),
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = textSize(26),
                lineHeight = leading(26),
                color = MaterialTheme.colorScheme.onBackground
            )
            Text(
                text = t("ইমেইল বা Google অ্যাকাউন্ট দিয়ে প্রবেশ করুন"),
                fontFamily = Kalpurush,
                fontSize = textSize(14),
                lineHeight = leading(14),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp, bottom = 28.dp)
            )

            if (!message.isNullOrBlank()) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 16.dp)
                ) {
                    Text(
                        text = message.orEmpty(),
                        style = MaterialTheme.typography.bodySmall.copy(
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            fontWeight = FontWeight.Medium
                        ),
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }

            if (registering) {
                RegisterForm(
                    inProgress = emailInProgress || inProgress,
                    message = emailMessage,
                    onRegister = { firstName, lastName, email, password, avatarUrl, avatarDeleteUrl, phone, address ->
                        viewModel.signUpWithEmail(
                            firstName = firstName,
                            lastName = lastName,
                            email = email,
                            password = password,
                            avatarUrl = avatarUrl,
                            avatarDeleteUrl = avatarDeleteUrl,
                            phone = phone,
                            address = address
                        )
                    },
                    onSwitchToSignIn = { registering = false }
                )
                Spacer(Modifier.height(10.dp))
                GoogleSignInButton(
                    isLoading = inProgress,
                    enabled = !inProgress && !emailInProgress,
                    onClick = { viewModel.signInWithGoogle(context) }
                )
            } else {
                EmailAuthSection(
                    inProgress = emailInProgress || inProgress,
                    message = emailMessage,
                    resetCodeSent = resetCodeSent,
                    passwordResetActive = passwordResetActive,
                    onSignIn = { email, password -> viewModel.signInWithEmail(email, password) },
                    onSendResetCode = { email -> viewModel.sendResetCode(email) },
                    onVerifyResetCode = { email, code -> viewModel.verifyResetCode(email, code) },
                    onSaveNewPassword = { password -> viewModel.saveNewPassword(password) },
                    onCancelReset = { viewModel.cancelPasswordReset() },
                    onOpenRegistration = { registering = true }
                )

                Text(
                    text = t("অথবা"),
                    fontFamily = Kalpurush,
                    fontSize = textSize(13),
                    lineHeight = leading(13),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 14.dp)
                )

                GoogleSignInButton(
                    isLoading = inProgress,
                    enabled = !inProgress && !emailInProgress,
                    onClick = { viewModel.signInWithGoogle(context) }
                )
            }
        }
    }
}
