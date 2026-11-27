package com.ningshingche.app.ui.components

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.ningshingche.app.data.auth.EmailAuthRules
import com.ningshingche.app.data.remote.ImgBbUploader
import com.ningshingche.app.ui.i18n.t
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.leading
import com.ningshingche.app.ui.theme.textSize
import kotlinx.coroutines.launch

/**
 * The registration form.
 *
 * The form asks for names, email and a password twice, with an optional picture,
 * phone number and address. The picture is optional — an account without one shows the
 * app's own logo in its place, and refusing to create an account because somebody
 * did not want to upload a photo would be a strange door to close.
 *
 * ## The picture
 *
 * Chosen with the system picker, uploaded to ImgBB *immediately*, and only the
 * resulting URL is carried into the sign-up. Uploading first rather than after has
 * one consequence worth stating: an abandoned form leaves one orphaned image on
 * ImgBB. That is the cheaper failure — the alternative is holding bytes in memory
 * through a network round trip and a possible rotation, and losing the picture
 * when the process is killed.
 *
 * ## The passwords
 *
 * Both fields carry an eye, because a masked field with no way to look at it is
 * how a typo becomes an account nobody can sign into. The rule is eight
 * characters, stated under the field rather than only on failure, and the submit
 * stays disabled until the two match — so the failure never has to be explained.
 */
@Composable
fun RegisterForm(
    inProgress: Boolean,
    message: String?,
    onRegister: (firstName: String, lastName: String, email: String, password: String,
        avatarUrl: String, avatarDeleteUrl: String, phone: String, address: String) -> Unit,
    onSwitchToSignIn: () -> Unit
) {
    val context = LocalContext.current

    var firstName by rememberSaveable { mutableStateOf("") }
    var lastName by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    // Passwords do not belong in the Activity's saved-state Bundle.
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var address by rememberSaveable { mutableStateOf("") }
    var showPassword by rememberSaveable { mutableStateOf(false) }
    var showConfirm by rememberSaveable { mutableStateOf(false) }
    var avatarUrl by rememberSaveable { mutableStateOf("") }
    var avatarDeleteUrl by rememberSaveable { mutableStateOf("") }
    var previewUri by rememberSaveable { mutableStateOf<String?>(null) }
    // An in-flight operation cannot survive the composition; do not restore a
    // spinner after rotation or process recreation when no job is running.
    var uploading by remember { mutableStateOf(false) }
    var uploadError by rememberSaveable { mutableStateOf<String?>(null) }
    val uploadScope = rememberCoroutineScope()

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null && !uploading && !inProgress) {
            uploading = true
            uploadError = null
            uploadScope.launch {
                finishRegistrationPhotoUpload(
                    upload = { ImgBbUploader.uploadFromUri(context, uri, "avatar_${System.currentTimeMillis()}") },
                    onSuccess = { image ->
                        avatarUrl = image.displayUrl.ifBlank { image.url }
                        avatarDeleteUrl = image.deleteUrl
                        previewUri = uri.toString()
                    },
                    onFailure = { uploadError = it.message ?: t("ছবি আপলোড যায়নি।") },
                    onFinish = { uploading = false }
                )
            }
        }
    }

    val editable = !inProgress && !uploading
    val emailProblem = when {
        email.isBlank() -> null
        !EmailAuthRules.isEmail(email) -> t("সঠিক ইমেইল ঠিকানা লিখুন।")
        EmailAuthRules.isDisposable(email) ->
            t("অস্থায়ী ইমেইল দিয়ে অ্যাকাউন্ট খোলা যায় না। Gmail, Yahoo বা নিজের ডোমেইন ব্যবহার করুন।")
        else -> null
    }
    val passwordMatches = password == confirmPassword
    val canSubmit = editable &&
        firstName.isNotBlank() &&
        lastName.isNotBlank() &&
        emailProblem == null &&
        email.isNotBlank() &&
        password.length >= EmailAuthRules.MIN_PASSWORD &&
        passwordMatches

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // ------------------------------------------------------- the picture
        Box(
            modifier = Modifier
                .size(92.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .clickable(enabled = editable) { picker.launch("image/*") }
                .testTag("register_avatar"),
            contentAlignment = Alignment.Center
        ) {
            // The hosted URL survives process recreation; picker permissions may not.
            val shown = avatarUrl.ifBlank { previewUri.orEmpty() }.takeIf { it.isNotBlank() }
            when {
                uploading -> CircularProgressIndicator(
                    modifier = Modifier.size(26.dp),
                    strokeWidth = 2.5.dp
                )
                shown != null -> AsyncImage(
                    model = shown,
                    contentDescription = t("প্রোফাইল ছবি"),
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(92.dp)
                )
                else -> Text(
                    text = t("ছবি"),
                    fontFamily = Kalpurush,
                    fontSize = textSize(13),
                    lineHeight = leading(13),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        Text(
            text = if (avatarUrl.isBlank()) t("প্রোফাইল ছবি (ঐচ্ছিক)") else t("ছবি বদলাতে চাপুন"),
            fontFamily = Kalpurush,
            fontSize = textSize(12),
            lineHeight = leading(12),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
        )
        if (uploadError != null) {
            Text(
                text = t(uploadError.orEmpty()),
                fontFamily = Kalpurush,
                fontSize = textSize(12),
                lineHeight = leading(12),
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(bottom = 6.dp)
            )
            if (avatarUrl.isNotBlank()) {
                Text(
                    text = t("নতুন ছবি আপলোড হয়নি; আগের ছবিটি রাখা হয়েছে।"),
                    fontFamily = Kalpurush,
                    fontSize = textSize(12),
                    lineHeight = leading(12),
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }

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
                    .padding(vertical = 10.dp)
                    .testTag("register_message")
            )
        }

        Spacer(Modifier.height(6.dp))

        // --------------------------------------------------------- the names
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            OutlinedTextField(
                value = firstName,
                onValueChange = { firstName = it },
                label = { Text(t("প্রথম নাম"), fontFamily = Kalpurush) },
                singleLine = true,
                enabled = editable,
                modifier = Modifier
                    .weight(1f)
                    .testTag("register_first_name")
            )
            OutlinedTextField(
                value = lastName,
                onValueChange = { lastName = it },
                label = { Text(t("পদবি"), fontFamily = Kalpurush) },
                singleLine = true,
                enabled = editable,
                modifier = Modifier
                    .weight(1f)
                    .testTag("register_last_name")
            )
        }

        Spacer(Modifier.height(10.dp))

        // -------------------------------------------------------- the address
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text(t("ইমেইল"), fontFamily = Kalpurush) },
            singleLine = true,
            enabled = editable,
            isError = emailProblem != null,
            supportingText = if (emailProblem != null) {
                { Text(t(emailProblem), fontFamily = Kalpurush, fontSize = textSize(12), lineHeight = leading(12)) }
            } else null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier
                .fillMaxWidth()
                .testTag("register_email")
        )

        Spacer(Modifier.height(10.dp))

        // Optional contact details are saved to the reader's profile.
        OutlinedTextField(
            value = phone,
            onValueChange = { phone = it },
            label = { Text(t("ফোন (ঐচ্ছিক)"), fontFamily = Kalpurush) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            singleLine = true,
            enabled = editable,
            modifier = Modifier.fillMaxWidth().testTag("register_phone")
        )
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            value = address,
            onValueChange = { address = it },
            label = { Text(t("ঠিকানা (ঐচ্ছিক)"), fontFamily = Kalpurush) },
            enabled = editable,
            minLines = 1,
            maxLines = 3,
            modifier = Modifier.fillMaxWidth().testTag("register_address")
        )
        Text(
            text = t("ঠিকানা আপনার প্রকাশ্য প্রোফাইলে দেখা যেতে পারে।"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp, start = 4.dp)
        )
        Spacer(Modifier.height(10.dp))

        // ------------------------------------------------------- the passwords
        PasswordWithEye(
            value = password,
            onValueChange = { password = it },
            label = t("পাসওয়ার্ড"),
            visible = showPassword,
            onToggle = { showPassword = !showPassword },
            enabled = editable,
            tag = "register_password"
        )

        Spacer(Modifier.height(10.dp))

        PasswordWithEye(
            value = confirmPassword,
            onValueChange = { confirmPassword = it },
            label = t("পাসওয়ার্ড আবার লিখুন"),
            visible = showConfirm,
            onToggle = { showConfirm = !showConfirm },
            enabled = editable,
            isError = confirmPassword.isNotEmpty() && !passwordMatches,
            tag = "register_password_confirm"
        )

        // The rule is stated while it is wrong, not only when the button refuses.
        val tooShort = password.isNotEmpty() && password.length < EmailAuthRules.MIN_PASSWORD
        val mismatch = confirmPassword.isNotEmpty() && !passwordMatches
        Text(
            text = when {
                mismatch -> t("দুটি পাসওয়ার্ড মিলছে না।")
                tooShort -> t("অন্তত {1} অক্ষর", EmailAuthRules.MIN_PASSWORD)
                else -> t("অন্তত {1} অক্ষর", EmailAuthRules.MIN_PASSWORD)
            },
            fontFamily = Kalpurush,
            fontSize = textSize(12),
            lineHeight = leading(12),
            color = if (tooShort || mismatch)
                MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 6.dp, start = 4.dp)
        )

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = { onRegister(firstName, lastName, email, password, avatarUrl, avatarDeleteUrl, phone, address) },
            enabled = canSubmit && !inProgress,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .testTag("register_submit")
        ) {
            if (inProgress) {
                CircularProgressIndicator(
                    color = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(22.dp),
                    strokeWidth = 2.5.dp
                )
            } else {
                Text(
                    text = t("অ্যাকাউন্ট খুলুন"),
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = textSize(15),
                    lineHeight = leading(15)
                )
            }
        }

        TextButton(
            onClick = onSwitchToSignIn,
            enabled = editable,
            modifier = Modifier.testTag("register_switch_to_sign_in")
        ) {
            Text(
                text = t("আগেই অ্যাকাউন্ট আছে? সাইন ইন করুন"),
                fontFamily = Kalpurush,
                fontSize = textSize(13),
                lineHeight = leading(13)
            )
        }
    }
}

/** Do not ask the reader to register twice when only the profile save failed. */
@Composable
fun RegistrationProfileWarning(message: String, onAcknowledge: () -> Unit) {
    AlertDialog(
        onDismissRequest = {},
        title = { Text(t("প্রোফাইল সংরক্ষণ হয়নি")) },
        text = { Text(t(message)) },
        confirmButton = { TextButton(onClick = onAcknowledge) { Text(t("চালিয়ে যান")) } }
    )
}

/**
 * A masked field with an eye.
 *
 * The eye is the whole point of the component: a password typed twice into two
 * masked fields is a password nobody can check, and the failure it produces —
 * "the password does not match" — is invisible until the account is already made.
 */
@Composable
private fun PasswordWithEye(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    visible: Boolean,
    onToggle: () -> Unit,
    enabled: Boolean,
    tag: String,
    isError: Boolean = false
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label, fontFamily = Kalpurush) },
        singleLine = true,
        enabled = enabled,
        isError = isError,
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        trailingIcon = {
            IconButton(
                onClick = onToggle,
                enabled = enabled,
                modifier = Modifier.testTag("${tag}_eye")
            ) {
                Icon(
                    imageVector = if (visible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                    contentDescription = if (visible) t("পাসওয়ার্ড লুকান") else t("পাসওয়ার্ড দেখুন")
                )
            }
        },
        modifier = Modifier
            .fillMaxWidth()
            .testTag(tag)
    )
}
