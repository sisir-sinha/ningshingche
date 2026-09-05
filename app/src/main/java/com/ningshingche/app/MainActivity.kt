package com.ningshingche.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ningshingche.app.data.model.AppThemeMode
import com.ningshingche.app.data.model.ReaderPreferences
import com.ningshingche.app.ui.editorial.EditorialTheme
import com.ningshingche.app.ui.reader.EditorialReaderApp
import kotlinx.coroutines.launch

/**
 * Host activity for the public reader.
 *
 * All navigation lives in [EditorialReaderApp]; this class owns the theme
 * (system / light / dark, read from DataStore) and the edge-to-edge window.
 */
class MainActivity : ComponentActivity() {

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        requestNotificationPermissionIfNeeded()

        val app = (application as? NinghsingCheApp) ?: NinghsingCheApp.instance

        setContent {
            val preferences by app.preferencesRepository.readerPreferences
                .collectAsStateWithLifecycle(initialValue = ReaderPreferences())
            val coroutineScope = rememberCoroutineScope()

            val darkTheme = when (preferences.appThemeMode) {
                AppThemeMode.SYSTEM -> isSystemInDarkTheme()
                AppThemeMode.LIGHT -> false
                AppThemeMode.DARK -> true
            }

            EditorialTheme(darkTheme = darkTheme) {
                EditorialReaderApp(
                    app = app,
                    isDark = darkTheme,
                    onToggleTheme = {
                        coroutineScope.launch {
                            val nextMode = if (darkTheme) AppThemeMode.LIGHT else AppThemeMode.DARK
                            app.preferencesRepository.updateAppThemeMode(nextMode)
                        }
                    },
                    modifier = Modifier
                )
            }
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
