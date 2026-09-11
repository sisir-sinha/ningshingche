package com.ningshingche.app.ui.screens

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Android
import androidx.compose.material.icons.filled.BrightnessAuto
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CleaningServices
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.ningshingche.app.data.model.AppThemeMode
import com.ningshingche.app.ui.components.GoogleSignInButton
import com.ningshingche.app.ui.viewmodel.SettingsViewModel
import com.ningshingche.app.util.ApkManager
import kotlinx.coroutines.launch
import com.ningshingche.app.data.model.ContentLanguage
import com.ningshingche.app.ui.i18n.LocalTranslations
import com.ningshingche.app.ui.i18n.t
import com.ningshingche.app.ui.theme.Kalpurush

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onBackClick: () -> Unit
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val preferences by viewModel.preferences.collectAsStateWithLifecycle()
    val currentUser by viewModel.currentUser.collectAsStateWithLifecycle()
    val googleAuthInProgress by viewModel.googleAuthInProgress.collectAsStateWithLifecycle()
    val googleAuthMessage by viewModel.googleAuthMessage.collectAsStateWithLifecycle()
    // How many strings the current language file translates, shown so the
    // reader knows what to expect from a half-finished translation.
    val translations = LocalTranslations.current

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    val apkInfo = remember(context) { ApkManager.getInstalledApkInfo(context) }
    var isSavingApk by remember { mutableStateOf(false) }
    var downloadResultMsg by remember { mutableStateOf<String?>(null) }

    // Sticky default header: a Material top app bar that stays pinned while the
    // list below scrolls and respects the status-bar inset.
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "সেটিংস",
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                            fontSize = 18.sp
                        )
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = onBackClick,
                        modifier = Modifier.testTag("settings_back_button")
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "পেছনে",
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    scrolledContainerColor = MaterialTheme.colorScheme.surface
                ),
                modifier = Modifier.testTag("settings_top_bar")
            )
        },
        containerColor = MaterialTheme.colorScheme.background
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Person,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp)
                        )
                        Text(
                            text = "অ্যাকাউন্ট",
                            style = MaterialTheme.typography.labelMedium.copy(
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary,
                                fontSize = 13.sp,
                            )
                        )
                    }

                    Surface(
                        shape = RoundedCornerShape(18.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            val signedIn = currentUser
                            if (signedIn != null) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                                ) {
                                    Surface(
                                        shape = CircleShape,
                                        color = MaterialTheme.colorScheme.primaryContainer,
                                        modifier = Modifier.size(52.dp)
                                    ) {
                                        if (signedIn.avatarUrl.isNotBlank()) {
                                            AsyncImage(
                                                model = signedIn.avatarUrl,
                                                contentDescription = signedIn.fullName,
                                                modifier = Modifier
                                                    .size(52.dp)
                                                    .clip(CircleShape)
                                            )
                                        } else {
                                            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                                                Icon(
                                                    imageVector = Icons.Default.AccountCircle,
                                                    contentDescription = null,
                                                    tint = MaterialTheme.colorScheme.primary,
                                                    modifier = Modifier.size(32.dp)
                                                )
                                            }
                                        }
                                    }
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = signedIn.fullName.ifBlank { "পাঠক" },
                                            style = MaterialTheme.typography.titleMedium.copy(
                                                fontWeight = FontWeight.Bold,
                                                fontSize = 15.sp
                                            )
                                        )
                                        if (signedIn.email.isNotBlank()) {
                                            Text(
                                                text = signedIn.email,
                                                style = MaterialTheme.typography.bodySmall.copy(
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                    fontSize = 12.sp
                                                )
                                            )
                                        }
                                    }
                                }
                                OutlinedButton(
                                    onClick = { viewModel.signOutAccount() },
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .testTag("settings_sign_out_button")
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.ExitToApp,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("লগ আউট", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                }
                            } else {
                                Text(
                                    text = "Google অ্যাকাউন্ট দিয়ে প্রবেশ করুন। একবার সাইন-ইন করলে অ্যাপ বন্ধ করলেও সেশন থাকবে।",
                                    style = MaterialTheme.typography.bodySmall.copy(
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        fontSize = 12.sp
                                    )
                                )
                                if (!googleAuthMessage.isNullOrBlank()) {
                                    Surface(
                                        color = MaterialTheme.colorScheme.errorContainer,
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.fillMaxWidth()
                                    ) {
                                        Text(
                                            text = googleAuthMessage.orEmpty(),
                                            style = MaterialTheme.typography.bodySmall.copy(
                                                color = MaterialTheme.colorScheme.onErrorContainer,
                                                fontWeight = FontWeight.Medium
                                            ),
                                            modifier = Modifier.padding(10.dp)
                                        )
                                    }
                                }
                                GoogleSignInButton(
                                    isLoading = googleAuthInProgress,
                                    enabled = !googleAuthInProgress,
                                    onClick = { viewModel.signInWithGoogle(context) }
                                )
                            }
                        }
                    }
                }
            }

            // 1. App Theme Mode Selection (Dark / White / System)
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Palette,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp)
                        )
                        Text(
                            text = "অ্যাপ থিম নির্বাচন",
                            style = MaterialTheme.typography.labelMedium.copy(
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary,
                                fontSize = 13.sp,
                            )
                        )
                    }

                    Surface(
                        shape = RoundedCornerShape(18.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Text(
                                text = "আপনার পছন্দের প্রদর্শন শৈলী নির্বাচন করুন:",
                                style = MaterialTheme.typography.bodySmall.copy(
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontSize = 12.sp
                                )
                            )

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                ThemeModeCard(
                                    title = "সাদা / লাইট",
                                    icon = Icons.Default.LightMode,
                                    isSelected = preferences.appThemeMode == AppThemeMode.LIGHT,
                                    modifier = Modifier.weight(1f),
                                    onClick = { viewModel.updateAppThemeMode(AppThemeMode.LIGHT) }
                                )

                                ThemeModeCard(
                                    title = "ডার্ক থিম",
                                    icon = Icons.Default.DarkMode,
                                    isSelected = preferences.appThemeMode == AppThemeMode.DARK,
                                    modifier = Modifier.weight(1f),
                                    onClick = { viewModel.updateAppThemeMode(AppThemeMode.DARK) }
                                )

                                ThemeModeCard(
                                    title = "সিস্টেম",
                                    icon = Icons.Default.BrightnessAuto,
                                    isSelected = preferences.appThemeMode == AppThemeMode.SYSTEM,
                                    modifier = Modifier.weight(1f),
                                    onClick = { viewModel.updateAppThemeMode(AppThemeMode.SYSTEM) }
                                )
                            }
                        }
                    }
                }
            }

            // 1b. Interface language (Bengali / Bishnupriya Manipuri)
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Translate,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp)
                        )
                        Text(
                            text = t("ভাষা"),
                            style = MaterialTheme.typography.labelMedium.copy(
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary,
                                fontSize = 13.sp
                            )
                        )
                    }
                    Surface(
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Text(
                                text = if (preferences.contentLanguage == ContentLanguage.BENGALI) {
                                    t("ইন্টারফেসের ভাষা। বাংলা মূল ভাষা; অন্য ভাষা বাছলে অনুবাদ ডাউনলোড হবে।")
                                } else {
                                    t(
                                        "ইন্টারফেসের ভাষা। অনুবাদ না থাকা লেখা বাংলাতেই থাকবে ({1}টি অনুবাদ লোড হয়েছে)।",
                                        translations.size
                                    )
                                },
                                style = MaterialTheme.typography.bodySmall.copy(
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontSize = 12.sp
                                )
                            )
                            // One line showing the language in use; tapping it opens
                            // the three choices. The first-launch screen shows the
                            // same three as cards — here a menu keeps the row short.
                            var languageMenuOpen by remember { mutableStateOf(false) }
                            Box {
                                Surface(
                                    shape = RoundedCornerShape(12.dp),
                                    color = MaterialTheme.colorScheme.surface,
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .clickable { languageMenuOpen = true }
                                ) {
                                    Row(
                                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.Translate,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.size(20.dp)
                                        )
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(
                                                text = preferences.contentLanguage.displayName(),
                                                fontFamily = Kalpurush,
                                                fontWeight = FontWeight.Bold,
                                                fontSize = 15.sp,
                                                color = MaterialTheme.colorScheme.onSurface
                                            )
                                            Text(
                                                text = t("অ্যাপের ভাষা — বদলাতে টিপুন"),
                                                fontSize = 11.sp,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                        Icon(
                                            imageVector = Icons.Default.KeyboardArrowDown,
                                            contentDescription = t("ভাষা বাছাই করুন"),
                                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }
                                DropdownMenu(
                                    expanded = languageMenuOpen,
                                    onDismissRequest = { languageMenuOpen = false }
                                ) {
                                    ContentLanguage.entries.forEach { language ->
                                        val isCurrent = language == preferences.contentLanguage
                                        DropdownMenuItem(
                                            text = {
                                                Row(
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                                ) {
                                                    Icon(
                                                        imageVector = if (isCurrent) {
                                                            Icons.Default.CheckCircle
                                                        } else {
                                                            Icons.Default.Translate
                                                        },
                                                        contentDescription = null,
                                                        tint = if (isCurrent) {
                                                            MaterialTheme.colorScheme.primary
                                                        } else {
                                                            MaterialTheme.colorScheme.onSurfaceVariant
                                                        },
                                                        modifier = Modifier.size(18.dp)
                                                    )
                                                    Text(
                                                        text = language.displayName(),
                                                        fontFamily = Kalpurush,
                                                        fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
                                                        color = MaterialTheme.colorScheme.onSurface
                                                    )
                                                }
                                            },
                                            onClick = {
                                                languageMenuOpen = false
                                                // Switching downloads that language's file.
                                                viewModel.updateContentLanguage(language)
                                            }
                                        )
                                    }
                                }
                            }
                            // Language files are edited in the dashboard; this pulls
                            // the latest copy without waiting for the next launch.
                            val refreshToastMessage = t("ভাষা ফাইল আনতে শুরু হয়েছে।")
                            OutlinedButton(
                                onClick = {
                                    viewModel.refreshTranslations()
                                    Toast.makeText(context, refreshToastMessage, Toast.LENGTH_SHORT).show()
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text(t("অনুবাদ হালনাগাদ করুন"), fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }

            // 2. Download Ningshingche APK (Direct Local APK from Installed Device)
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.FileDownload,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp)
                        )
                        Text(
                            text = "নিংশিং চে APK ডাউনলোড (সরাসরি লোকাল প্যাকেজ)",
                            style = MaterialTheme.typography.labelMedium.copy(
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary,
                                fontSize = 13.sp,
                            )
                        )
                    }

                    Surface(
                        shape = RoundedCornerShape(18.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Surface(
                                    shape = RoundedCornerShape(12.dp),
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(48.dp)
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(
                                            imageVector = Icons.Default.Android,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.onPrimary,
                                            modifier = Modifier.size(28.dp)
                                        )
                                    }
                                }

                                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(
                                        text = "Ningshingche Android App",
                                        style = MaterialTheme.typography.titleMedium.copy(
                                            fontWeight = FontWeight.Bold,
                                            color = MaterialTheme.colorScheme.onSurface,
                                            fontSize = 15.sp
                                        )
                                    )
                                    Text(
                                        text = "সংস্করণ ${apkInfo.versionName} • সাইজ: ${apkInfo.sizeFormatted}",
                                        style = MaterialTheme.typography.bodySmall.copy(
                                            color = MaterialTheme.colorScheme.primary,
                                            fontWeight = FontWeight.SemiBold,
                                            fontSize = 12.sp
                                        )
                                    )
                                    Text(
                                        text = "ইনস্টল্ড ডিভাইস থেকে সরাসরি সংগৃহীত অফিশিয়াল প্যাকেজ",
                                        style = MaterialTheme.typography.bodySmall.copy(
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            fontSize = 11.sp
                                        )
                                    )
                                }
                            }

                            // Download status message banner
                            if (downloadResultMsg != null) {
                                Surface(
                                    shape = RoundedCornerShape(10.dp),
                                    color = MaterialTheme.colorScheme.primaryContainer,
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Row(
                                        modifier = Modifier.padding(10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.CheckCircle,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.size(18.dp)
                                        )
                                        Text(
                                            text = downloadResultMsg.orEmpty(),
                                            style = MaterialTheme.typography.bodySmall.copy(
                                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                                                fontWeight = FontWeight.Medium,
                                                fontSize = 12.sp
                                            )
                                        )
                                    }
                                }
                            }

                            // Action buttons
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Button(
                                    onClick = {
                                        coroutineScope.launch {
                                            isSavingApk = true
                                            val result = ApkManager.saveApkToDownloads(context)
                                            isSavingApk = false
                                            result.onSuccess { msg ->
                                                downloadResultMsg = msg
                                                Toast.makeText(context, "APK সফলভাবে ডাউনলোড ফোল্ডারে সংরক্ষিত হয়েছে!", Toast.LENGTH_LONG).show()
                                            }.onFailure { err ->
                                                downloadResultMsg = "সংরক্ষণ ব্যর্থ: ${err.message}"
                                                Toast.makeText(context, "APK সংরক্ষণ ব্যর্থ হয়েছে", Toast.LENGTH_SHORT).show()
                                            }
                                        }
                                    },
                                    enabled = !isSavingApk,
                                    shape = RoundedCornerShape(12.dp),
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = MaterialTheme.colorScheme.primary,
                                        contentColor = MaterialTheme.colorScheme.onPrimary
                                    ),
                                    modifier = Modifier
                                        .weight(1f)
                                        .testTag("settings_download_apk_button")
                                ) {
                                    if (isSavingApk) {
                                        CircularProgressIndicator(
                                            color = MaterialTheme.colorScheme.onPrimary,
                                            strokeWidth = 2.dp,
                                            modifier = Modifier.size(16.dp)
                                        )
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text(text = "সংরক্ষণ হচ্ছে...", fontSize = 12.sp)
                                    } else {
                                        Icon(
                                            imageVector = Icons.Default.Download,
                                            contentDescription = null,
                                            modifier = Modifier.size(16.dp)
                                        )
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text(
                                            text = "APK সংরক্ষণ করুন",
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 12.sp
                                        )
                                    }
                                }

                                OutlinedButton(
                                    onClick = {
                                        val success = ApkManager.shareInstalledApk(context)
                                        if (!success) {
                                            Toast.makeText(context, "APK শেয়ার প্রস্তুত করা সম্ভব হয়নি", Toast.LENGTH_SHORT).show()
                                        }
                                    },
                                    shape = RoundedCornerShape(12.dp),
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
                                    colors = ButtonDefaults.outlinedButtonColors(
                                        contentColor = MaterialTheme.colorScheme.primary
                                    ),
                                    modifier = Modifier
                                        .weight(1f)
                                        .testTag("settings_share_apk_button")
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Share,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = "APK শেয়ার করুন",
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 12.sp
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // 3. About Ninghsing Che Card
            item {
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = MaterialTheme.colorScheme.primaryContainer,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = "নিংশিং চে — বিষ্ণুপ্রিয়া মণিপুরি তথ্যকোষ",
                            style = MaterialTheme.typography.titleLarge.copy(
                                fontFamily = Kalpurush,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                                fontSize = 17.sp
                            )
                        )
                        Text(
                            text = "বিষ্ণুপ্রিয়া মণিপুরি ভাষা, সাহিত্য, ইতিহাস, সংস্কৃতি ও ঐতিহ্যের একমাত্র প্রামাণ্য ও মুক্ত ডিজিটাল তথ্যকোষ ও আর্কাইভ।",
                            style = MaterialTheme.typography.bodySmall.copy(
                                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.9f),
                                fontSize = 12.sp,
                                lineHeight = 18.sp
                            )
                        )

                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .clickable {
                                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://ningshingche.com/"))
                                    context.startActivity(intent)
                                }
                                .padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.OpenInNew,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(16.dp)
                            )
                            Text(
                                text = "ningshingche.com ওয়েবসাইটে যান",
                                style = MaterialTheme.typography.labelMedium.copy(
                                    color = MaterialTheme.colorScheme.primary,
                                    fontWeight = FontWeight.Bold
                                )
                            )
                        }
                    }
                }
            }

            // 3. Notifications Section
            item {
                fun enableAndAskOs(onEnable: (Boolean) -> Unit): (Boolean) -> Unit = { enabled ->
                    onEnable(enabled)
                    if (enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        val granted = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.POST_NOTIFICATIONS
                        ) == PackageManager.PERMISSION_GRANTED
                        if (!granted) {
                            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "বিজ্ঞপ্তি ও আপডেট",
                        style = MaterialTheme.typography.labelMedium.copy(
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                            fontSize = 12.sp
                        )
                    )

                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                            NotificationSwitchRow(
                                title = "সব বিজ্ঞপ্তি",
                                subtitle = "অ্যান্ড্রয়েড সিস্টেম নোটিফিকেশন চালু রাখুন",
                                checked = preferences.notificationsEnabled,
                                onCheckedChange = enableAndAskOs { viewModel.toggleNotificationsEnabled(it) }
                            )
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                            NotificationSwitchRow(
                                title = "নতুন প্রবন্ধ",
                                subtitle = "নতুন প্রকাশিত প্রবন্ধ এলে জানান",
                                checked = preferences.notificationNewArticles,
                                enabled = preferences.notificationsEnabled,
                                onCheckedChange = enableAndAskOs { viewModel.toggleNewArticlesNotif(it) }
                            )
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                            NotificationSwitchRow(
                                title = "নির্বাচিত প্রবন্ধ",
                                subtitle = "ফিচার্ড ও সম্পাদকীয় পছন্দ",
                                checked = preferences.notificationFeatured,
                                enabled = preferences.notificationsEnabled,
                                onCheckedChange = { viewModel.toggleFeaturedNotif(it) }
                            )
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                            NotificationSwitchRow(
                                title = "নতুন ভিডিও",
                                subtitle = "ভিডিও আর্কাইভে নতুন সংযোজন",
                                checked = preferences.notificationVideos,
                                enabled = preferences.notificationsEnabled,
                                onCheckedChange = { viewModel.toggleVideosNotif(it) }
                            )
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                            NotificationSwitchRow(
                                title = "নতুন PDF বই",
                                subtitle = "ডিজিটাল বই ও পত্রিকা প্রকাশিত হলে",
                                checked = preferences.notificationPdfs,
                                enabled = preferences.notificationsEnabled,
                                onCheckedChange = { viewModel.togglePdfsNotif(it) }
                            )
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                            NotificationSwitchRow(
                                title = "সিস্টেম আপডেট",
                                subtitle = "অ্যাপ সংস্করণ ও সাইট হালনাগাদ",
                                checked = preferences.notificationSystem,
                                enabled = preferences.notificationsEnabled,
                                onCheckedChange = { viewModel.toggleSystemNotif(it) }
                            )
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                            NotificationSwitchRow(
                                title = "অন্যান্য",
                                subtitle = "গ্যালারি ও বাকি আপডেট",
                                checked = preferences.notificationOther,
                                enabled = preferences.notificationsEnabled,
                                onCheckedChange = { viewModel.toggleOtherNotif(it) }
                            )
                        }
                    }
                }
            }

            // 4. Storage & Cache
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "মেমরি ও অফলাইন ক্যাশ ব্যবস্থাপনা",
                        style = MaterialTheme.typography.labelMedium.copy(
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                            fontSize = 12.sp
                        )
                    )

                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        viewModel.clearCache()
                                        Toast
                                            .makeText(context, "ক্যাশ খালি করা হয়েছে এবং তথ্য হালনাগাদ করা হয়েছে", Toast.LENGTH_SHORT)
                                            .show()
                                    }
                                    .padding(16.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.CleaningServices,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                    Column {
                                        Text(
                                            text = "অফলাইন ক্যাশ সিঙ্ক ও পরিষ্কার করুন",
                                            style = MaterialTheme.typography.bodyMedium.copy(
                                                fontWeight = FontWeight.SemiBold,
                                                color = MaterialTheme.colorScheme.onSurface
                                            )
                                        )
                                        Text(
                                            text = "নতুন প্রবন্ধসমূহ পুনরায় সিঙ্ক করবে",
                                            style = MaterialTheme.typography.bodySmall.copy(
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                fontSize = 11.sp
                                            )
                                        )
                                    }
                                }
                            }

                            HorizontalDivider(color = MaterialTheme.colorScheme.outline)

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        viewModel.clearHistory()
                                        Toast
                                            .makeText(context, "পঠন ইতিহাস মুছে ফেলা হয়েছে", Toast.LENGTH_SHORT)
                                            .show()
                                    }
                                    .padding(16.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.DeleteSweep,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                    Column {
                                        Text(
                                            text = "পঠন ইতিহাস রিসেট করুন",
                                            style = MaterialTheme.typography.bodyMedium.copy(
                                                fontWeight = FontWeight.SemiBold,
                                                color = MaterialTheme.colorScheme.onSurface
                                            )
                                        )
                                        Text(
                                            text = "সাম্প্রতিক পঠিত তালিকা মুছে ফেলুন",
                                            style = MaterialTheme.typography.bodySmall.copy(
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                fontSize = 11.sp
                                            )
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 5. App Info
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = "সংস্করণ ১.০.০ (অফিশিয়াল সংস্করণ)",
                        style = MaterialTheme.typography.labelSmall.copy(
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    )
                    Text(
                        text = "কপিরাইট © নিংশিং চে • সর্বস্বত্ব সংরক্ষিত",
                        style = MaterialTheme.typography.labelSmall.copy(
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                            fontSize = 10.sp
                        )
                    )
                }
            }
        }
    }
}

@Composable
private fun NotificationSwitchRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontSize = 14.sp
                )
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall.copy(
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.sp
                )
            )
        }
        Switch(
            checked = checked && enabled,
            onCheckedChange = onCheckedChange,
            enabled = enabled,
            colors = SwitchDefaults.colors(
                checkedThumbColor = MaterialTheme.colorScheme.primary,
                checkedTrackColor = MaterialTheme.colorScheme.primaryContainer
            )
        )
    }
}

@Composable
private fun ThemeModeCard(
    title: String,
    icon: ImageVector,
    isSelected: Boolean,
    modifier: Modifier = Modifier,
    previewBg: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.surface,
    previewFg: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface,
    onClick: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = previewBg,
        border = BorderStroke(if (isSelected) 2.dp else 1.dp, if (isSelected) androidx.compose.ui.graphics.Color(0xFFFF8C00) else MaterialTheme.colorScheme.outline),
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .clickable { onClick() }
    ) {
        Column(
            modifier = Modifier.padding(vertical = 14.dp, horizontal = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = title,
                tint = previewFg,
                modifier = Modifier.size(24.dp)
            )
            Text(
                text = title,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                color = previewFg,
                fontSize = 12.sp
            )
        }
    }
}
