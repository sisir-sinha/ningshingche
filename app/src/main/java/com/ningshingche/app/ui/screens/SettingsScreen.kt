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
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
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
import androidx.compose.material.icons.filled.ColorLens
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.ningshingche.app.data.model.AppPalette
import com.ningshingche.app.data.model.AppThemeMode
import com.ningshingche.app.data.model.ContentLanguage
import com.ningshingche.app.ui.components.GoogleSignInButton
import com.ningshingche.app.ui.editorial.EditorialPalettes
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.editorial.PaletteSide
import com.ningshingche.app.ui.i18n.LocalTranslations
import com.ningshingche.app.ui.i18n.t
import com.ningshingche.app.ui.theme.textSize
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.viewmodel.SettingsViewModel
import com.ningshingche.app.util.ApkManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

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
                            fontSize = textSize(18)
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
                                fontSize = textSize(13),
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
                                                fontSize = textSize(15)
                                            )
                                        )
                                        if (signedIn.email.isNotBlank()) {
                                            Text(
                                                text = signedIn.email,
                                                style = MaterialTheme.typography.bodySmall.copy(
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                    fontSize = textSize(12)
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
                                    Text("লগ আউট", fontWeight = FontWeight.Bold, fontSize = textSize(13))
                                }
                            } else {
                                Text(
                                    text = "Google অ্যাকাউন্ট দিয়ে প্রবেশ করুন। একবার সাইন-ইন করলে অ্যাপ বন্ধ করলেও সেশন থাকবে।",
                                    style = MaterialTheme.typography.bodySmall.copy(
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        fontSize = textSize(12)
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

            // রঙের প্যালেট — what colour the app is painted with.
            //
            // It comes before the light/dark choice, because this is the question that
            // decides what light and dark each mean: every palette carries both sides,
            // and the one below only picks which side is on screen.
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.ColorLens,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp)
                        )
                        Text(
                            text = "রঙের প্যালেট",
                            style = MaterialTheme.typography.labelMedium.copy(
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary,
                                fontSize = textSize(13)
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
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Text(
                                text = "যে রঙে অ্যাপটি পড়তে চান সেটি বেছে নিন — প্রতিটি প্যালেটে লাইট ও ডার্ক দুটি রূপ আছে।",
                                style = MaterialTheme.typography.bodySmall.copy(
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontSize = textSize(12)
                                )
                            )

                            val tokens = LocalEditorialTokens.current
                            // The reader's own palette, built from the wheel — shown as the
                            // sixth card so its swatches move as they turn it.
                            val custom = remember(preferences.customHue, preferences.customSaturation) {
                                EditorialPalettes.custom(preferences.customHue, preferences.customSaturation)
                            }
                            val choices = EditorialPalettes.presets + custom
                            choices.chunked(3).forEach { row ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .testTag("palette_row"),
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    row.forEach { spec ->
                                        val side = if (tokens.isDark) spec.dark else spec.light
                                        PaletteCard(
                                            label = spec.label,
                                            swatches = listOf(side.paper, side.accent, side.second),
                                            isSelected = preferences.appPalette == spec.id,
                                            modifier = Modifier
                                                .weight(1f)
                                                .testTag("palette_card_" + spec.id.name.lowercase()),
                                            onClick = { viewModel.updateAppPalette(spec.id) }
                                        )
                                    }
                                    // A short last row keeps its columns rather than stretching.
                                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                                }
                            }

                            // What the chosen palette is for, in its own words.
                            val chosen = choices.firstOrNull { it.id == preferences.appPalette }
                            if (chosen != null) {
                                Text(
                                    text = chosen.note,
                                    style = MaterialTheme.typography.bodySmall.copy(
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        fontSize = textSize(11.5)
                                    )
                                )
                            }

                            if (preferences.appPalette == AppPalette.CUSTOM) {
                                PaletteWheelBlock(
                                    hue = preferences.customHue,
                                    saturation = preferences.customSaturation,
                                    onWheelChange = { hue, strength -> viewModel.updateCustomWheel(hue, strength) }
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
                                fontSize = textSize(13),
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
                                    fontSize = textSize(12)
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
                                fontSize = textSize(13)
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
                                    fontSize = textSize(12)
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
                                                fontSize = textSize(15),
                                                color = MaterialTheme.colorScheme.onSurface
                                            )
                                            Text(
                                                text = t("অ্যাপের ভাষা — বদলাতে টিপুন"),
                                                fontSize = textSize(11),
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
                                fontSize = textSize(13),
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
                                            fontSize = textSize(15)
                                        )
                                    )
                                    Text(
                                        text = "সংস্করণ ${apkInfo.versionName} • সাইজ: ${apkInfo.sizeFormatted}",
                                        style = MaterialTheme.typography.bodySmall.copy(
                                            color = MaterialTheme.colorScheme.primary,
                                            fontWeight = FontWeight.SemiBold,
                                            fontSize = textSize(12)
                                        )
                                    )
                                    Text(
                                        text = "ইনস্টল্ড ডিভাইস থেকে সরাসরি সংগৃহীত অফিশিয়াল প্যাকেজ",
                                        style = MaterialTheme.typography.bodySmall.copy(
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            fontSize = textSize(11)
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
                                                fontSize = textSize(12)
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
                                        Text(text = "সংরক্ষণ হচ্ছে...", fontSize = textSize(12))
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
                                            fontSize = textSize(12)
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
                                        fontSize = textSize(12)
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
                                fontSize = textSize(17)
                            )
                        )
                        Text(
                            text = "বিষ্ণুপ্রিয়া মণিপুরি ভাষা, সাহিত্য, ইতিহাস, সংস্কৃতি ও ঐতিহ্যের একমাত্র প্রামাণ্য ও মুক্ত ডিজিটাল তথ্যকোষ ও আর্কাইভ।",
                            style = MaterialTheme.typography.bodySmall.copy(
                                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.9f),
                                fontSize = textSize(12),
                                lineHeight = textSize(18)
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
                            fontSize = textSize(12)
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
                            fontSize = textSize(12)
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
                                                fontSize = textSize(11)
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
                                                fontSize = textSize(11)
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
                            fontSize = textSize(10)
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
                    fontSize = textSize(14)
                )
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall.copy(
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = textSize(11)
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
        border = BorderStroke(if (isSelected) 2.dp else 1.dp, if (isSelected) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline),
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
                fontSize = textSize(12)
            )
        }
    }
}


// ---------------------------------------------------------------------------
// Palette picker
// ---------------------------------------------------------------------------

/** One palette in the picker: its three colours and its name. */
@Composable
private fun PaletteCard(
    label: String,
    swatches: List<Color>,
    isSelected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            if (isSelected) 2.dp else 1.dp,
            if (isSelected) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline
        ),
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .clickable { onClick() }
    ) {
        Column(
            modifier = Modifier.padding(vertical = 12.dp, horizontal = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(7.dp)
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                swatches.forEach { colour ->
                    Box(
                        modifier = Modifier
                            .size(15.dp)
                            .clip(CircleShape)
                            .background(colour)
                            .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape)
                    )
                }
            }
            Text(
                text = label,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = textSize(11.5),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

/** How big the wheel is drawn, and how thick the hue ring is. */
private val PALETTE_WHEEL_SIZE = 176.dp
private val PALETTE_WHEEL_RING = 22.dp

/**
 * The wheel, plus the two previews that say what it means.
 *
 * Hue is the angle and strength is the distance from the middle, so one finger
 * answers both — and the colour under the finger is the colour the marker names,
 * because the ring's sweep starts where `atan2` does (3 o'clock, clockwise).
 *
 * A drag does not write to storage on every pixel: the position is local while the
 * finger moves, and lands once it has been still for a moment.
 */
@Composable
private fun PaletteWheelBlock(
    hue: Int,
    saturation: Int,
    onWheelChange: (Int, Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var localHue by remember(hue) { mutableIntStateOf(hue) }
    var localStrength by remember(saturation) { mutableIntStateOf(saturation) }

    LaunchedEffect(localHue, localStrength) {
        if (localHue != hue || localStrength != saturation) {
            delay(260)
            onWheelChange(localHue, localStrength)
        }
    }

    val preview = remember(localHue, localStrength) {
        EditorialPalettes.custom(localHue, localStrength)
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        PaletteWheel(
            hue = localHue,
            saturation = localStrength,
            onChange = { h, s -> localHue = h; localStrength = s }
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            PalettePreviewCard("লাইট", preview.light, Modifier.weight(1f))
            PalettePreviewCard("ডার্ক", preview.dark, Modifier.weight(1f))
        }
        Text(
            text = "চাকা ঘুরিয়ে রঙ, কেন্দ্র থেকে দূরে টেনে গাঢ়তা — দুটোই এক আঙুলে।",
            style = MaterialTheme.typography.bodySmall.copy(
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = textSize(11)
            ),
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun PaletteWheel(
    hue: Int,
    saturation: Int,
    onChange: (Int, Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val density = LocalDensity.current
    val ringPx = with(density) { PALETTE_WHEEL_RING.toPx() }
    val sidePx = with(density) { PALETTE_WHEEL_SIZE.toPx() }
    val midRadius = (sidePx - ringPx) / 2f
    val strength = saturation.coerceIn(0, 100) / 100f

    Canvas(
        modifier = modifier
            .size(PALETTE_WHEEL_SIZE)
            .testTag("palette_wheel")
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull() ?: continue
                        val dx = change.position.x - sidePx / 2f
                        val dy = change.position.y - sidePx / 2f
                        val degrees = (Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat() + 360f) % 360f
                        val distance = sqrt(dx * dx + dy * dy)
                        val reach = ((distance - ringPx / 2f) / midRadius).coerceIn(0f, 1f)
                        onChange(degrees.toInt(), (reach * 100f).roundToInt())
                        change.consume()
                    }
                }
            }
    ) {
        // The hue ring: a full sweep, one colour every 15°.
        drawArc(
            brush = Brush.sweepGradient(List(25) { step -> Color.hsl((step * 15f) % 360f, 1f, 0.5f) }),
            startAngle = 0f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = Offset(ringPx / 2f, ringPx / 2f),
            size = Size(sidePx - ringPx, sidePx - ringPx),
            style = Stroke(width = ringPx)
        )
        // The strength, as a disc that grows from the middle.
        drawCircle(
            color = Color.hsl(hue.toFloat(), strength, 0.5f).copy(alpha = 0.22f),
            radius = (midRadius - ringPx / 2f) * strength,
            center = Offset(sidePx / 2f, sidePx / 2f)
        )
        // Where the finger left it.
        val radians = Math.toRadians(hue.toDouble())
        val marker = Offset(
            sidePx / 2f + cos(radians).toFloat() * midRadius,
            sidePx / 2f + sin(radians).toFloat() * midRadius
        )
        drawCircle(color = Color.White, radius = ringPx * 0.44f, center = marker)
        drawCircle(
            color = Color.hsl(hue.toFloat(), strength.coerceAtLeast(0.35f), 0.45f),
            radius = ringPx * 0.30f,
            center = marker
        )
    }
}

/** A palette's side, as the reader will meet it: paper, ink, a rule and an accent. */
@Composable
private fun PalettePreviewCard(label: String, side: PaletteSide, modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = side.paper,
        border = BorderStroke(1.dp, side.ruleStrong),
        modifier = modifier
    ) {
        Column(
            modifier = Modifier.padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(side.accent)
                )
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(side.second)
                )
                Text(
                    text = label,
                    color = side.ink,
                    fontWeight = FontWeight.Bold,
                    fontSize = textSize(11.5)
                )
            }
            Text(text = "পাঠ্য লেখা", color = side.inkSoft, fontSize = textSize(11))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(side.rule)
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(6.dp))
                    .background(side.accent)
                    .padding(vertical = 4.dp)
            ) {
                Text(
                    text = "অ্যাকসেন্ট",
                    color = side.onAccent,
                    fontSize = textSize(10.5),
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.align(Alignment.Center)
                )
            }
        }
    }
}
