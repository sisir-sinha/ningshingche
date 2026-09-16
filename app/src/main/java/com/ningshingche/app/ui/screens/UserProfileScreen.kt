package com.ningshingche.app.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.ningshingche.app.ui.editorial.cardBorder
import com.ningshingche.app.ui.editorial.toBengaliNumeral
import com.ningshingche.app.ui.theme.textSize
import com.ningshingche.app.ui.theme.leading
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.viewmodel.ReaderMetrics
import com.ningshingche.app.ui.viewmodel.ReaderWorkspaceViewModel

/**
 * The reader's own view count, at the top of প্রোফাইল.
 *
 * The owner asked this page to show the total view, and asked whether it is real.
 * It is: the figure comes from `user_view_totals` — the counting engine's own sum,
 * which counts one view per visit whoever the visitor is, a play only once the
 * song has been listened to, and the threads the reader started — and it is the
 * same call the dashboard's ভিউ section reads, so the two pages show one number.
 *
 * The line under the total says what it is made of. A total you cannot take apart
 * is a number to be trusted rather than read, and the parts are how a reader knows
 * that the six discussions nobody seems to open are counted at all.
 *
 * On a database that has not run `036_view_logic.sql` yet the totals are zero and
 * the line stays quiet: `userViewTotals` answers with null rather than with a
 * guess, and this card shows ০ the way every other empty count in the app does.
 */
@Composable
private fun ProfileViewsCard(metrics: ReaderMetrics) {
    Surface(
        border = cardBorder(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .testTag("profile_views_card")
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    Icons.Default.Visibility,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
                Text(
                    text = toBengaliNumeral(metrics.totalViews),
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = textSize(24),
                    lineHeight = leading(24),
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = "মোট ভিউ",
                    fontFamily = Kalpurush,
                    fontSize = textSize(13),
                    lineHeight = leading(13),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            // Four words and their numbers, separated by a middot — the same four
            // the public profile page prints, and the same string keys, so a
            // translator fills each word once.
            Text(
                text = listOf(
                    "প্রবন্ধ ${toBengaliNumeral(metrics.articleViews)}",
                    "গান ${toBengaliNumeral(metrics.musicViews)}",
                    "আলোচনা ${toBengaliNumeral(metrics.forumViews)}",
                    "পাঠক ${toBengaliNumeral(metrics.visitors)}"
                ).joinToString("  ·  "),
                fontFamily = Kalpurush,
                fontSize = textSize(11.5),
                lineHeight = leading(11.5),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.testTag("profile_views_breakdown")
            )
            if (metrics.minutesListened > 0L) {
                Text(
                    text = "শোনা ${toBengaliNumeral(metrics.minutesListened)} মিনিট",
                    fontFamily = Kalpurush,
                    fontSize = textSize(11.5),
                    lineHeight = leading(11.5),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserProfileScreen(
    viewModel: ReaderWorkspaceViewModel,
    onBackClick: () -> Unit
) {
    val context = LocalContext.current
    val user by viewModel.currentUser.collectAsStateWithLifecycle()
    val saving by viewModel.isSaving.collectAsStateWithLifecycle()
    val uploading by viewModel.avatarUploading.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val metrics by viewModel.metrics.collectAsStateWithLifecycle()

    var firstName by remember { mutableStateOf("") }
    var lastName by remember { mutableStateOf("") }
    var about by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var facebook by remember { mutableStateOf("") }
    var designation by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var website by remember { mutableStateOf("") }

    LaunchedEffect(user?.id, user?.updatedAt, user?.avatarUrl) {
        // The view counts, from the database, the moment the page opens — the same
        // call the dashboard's ভিউ section reads, so the two cannot disagree.
        viewModel.refreshViews()
        val current = user ?: return@LaunchedEffect
        firstName = current.displayFirstName
        lastName = current.displayLastName
        about = current.about
        phone = current.phone
        address = current.address
        facebook = current.facebookId
        designation = current.designation
        location = current.location
        website = current.website
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) viewModel.uploadAvatar(context, uri)
    }

    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(message) {
        val text = message ?: return@LaunchedEffect
        if (text.isBlank()) return@LaunchedEffect
        snackbarHostState.showSnackbar(text)
        viewModel.clearMessage()
    }

    val signedIn = user
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("প্রোফাইল", fontFamily = Kalpurush, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBackClick, modifier = Modifier.testTag("profile_back_button")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "ফিরুন")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)
            )
        }
    ) { padding ->
        if (signedIn == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("সাইন ইন করা নেই।", fontFamily = Kalpurush)
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (!signedIn.isProfileComplete) {
                Surface(
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "ড্যাশবোর্ড ও নতুন প্রবন্ধ ব্যবহার করতে প্রোফাইলের সব আবশ্যক ঘর পূরণ করুন।",
                        fontFamily = Kalpurush,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }

            Box(contentAlignment = Alignment.BottomEnd) {
                Surface(shape = CircleShape, modifier = Modifier.size(96.dp)) {
                    if (signedIn.avatarUrl.isNotBlank()) {
                        AsyncImage(
                            model = signedIn.avatarUrl,
                            contentDescription = "প্রোফাইল ছবি",
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize().clip(CircleShape)
                        )
                    } else {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(48.dp))
                        }
                    }
                }
                IconButton(
                    onClick = { picker.launch("image/*") },
                    modifier = Modifier.testTag("profile_photo_button")
                ) {
                    if (uploading) {
                        CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.CameraAlt, contentDescription = "ছবি আপডেট")
                    }
                }
            }
            Text("প্রোফাইল ছবি (ImgBB)", fontFamily = Kalpurush, fontSize = textSize(12), lineHeight = leading(12), color = MaterialTheme.colorScheme.onSurfaceVariant)

            ProfileViewsCard(metrics)

            OutlinedTextField(
                value = firstName,
                onValueChange = { firstName = it },
                label = { Text("নামের প্রথম অংশ", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth().testTag("profile_first_name")
            )
            OutlinedTextField(
                value = lastName,
                onValueChange = { lastName = it },
                label = { Text("নামের শেষ অংশ", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth().testTag("profile_last_name")
            )
            OutlinedTextField(
                value = signedIn.email,
                onValueChange = {},
                readOnly = true,
                enabled = false,
                label = { Text("ইমেইল (পরিবর্তন করা যায় না)", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = about,
                onValueChange = { about = it },
                label = { Text("নিজের সম্পর্কে", fontFamily = Kalpurush) },
                minLines = 3,
                modifier = Modifier.fillMaxWidth().testTag("profile_about")
            )
            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it },
                label = { Text("ফোন নম্বর", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth().testTag("profile_phone")
            )
            OutlinedTextField(
                value = address,
                onValueChange = { address = it },
                label = { Text("ঠিকানা", fontFamily = Kalpurush) },
                minLines = 2,
                modifier = Modifier.fillMaxWidth().testTag("profile_address")
            )
            OutlinedTextField(
                value = facebook,
                onValueChange = { facebook = it },
                label = { Text("Facebook আইডি / লিংক", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth().testTag("profile_facebook")
            )
            OutlinedTextField(
                value = designation,
                onValueChange = { designation = it },
                label = { Text("পদবি / পরিচয় (ঐচ্ছিক)", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = location,
                onValueChange = { location = it },
                label = { Text("জেলা / দেশ (ঐচ্ছিক)", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = website,
                onValueChange = { website = it },
                label = { Text("ওয়েবসাইট (ঐচ্ছিক)", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth()
            )

            if (!message.isNullOrBlank()) {
                Text(
                    text = message.orEmpty(),
                    fontFamily = Kalpurush,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            Button(
                onClick = {
                    viewModel.saveProfile(
                        signedIn.copy(
                            firstName = firstName.trim(),
                            lastName = lastName.trim(),
                            fullName = "${firstName.trim()} ${lastName.trim()}".trim(),
                            about = about.trim(),
                            phone = phone.trim(),
                            address = address.trim(),
                            facebookId = facebook.trim(),
                            designation = designation.trim(),
                            location = location.trim(),
                            website = website.trim()
                        )
                    )
                },
                enabled = !saving && !uploading,
                modifier = Modifier.fillMaxWidth().height(48.dp).testTag("profile_save_button")
            ) {
                if (saving) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                } else {
                    Text("প্রোফাইল সংরক্ষণ করুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
