package com.ningshingche.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ningshingche.app.data.model.AppThemeMode
import com.ningshingche.app.data.model.ReaderPreferences
import com.ningshingche.app.notifications.routeFromLaunchIntent
import com.ningshingche.app.ui.editorial.EditorialTheme
import com.ningshingche.app.ui.reader.EditorialReaderApp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/**
 * Host activity for the public reader.
 *
 * All navigation lives in [EditorialReaderApp]; this class owns the theme
 * (system / light / dark, read from DataStore) and the edge-to-edge window.
 *
 * Keyboard: [enableEdgeToEdge] opts out of decor fitting, so `adjustResize`
 * does not shrink the window. The root [imePadding] lifts the entire app by
 * the software-keyboard height so every focused field stays visible.
 */
class MainActivity : ComponentActivity() {

    private val pendingRoute = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        pendingRoute.value = routeFromLaunchIntent(intent)

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
                Box(Modifier.fillMaxSize().imePadding()) {
                    EditorialReaderApp(
                        app = app,
                        isDark = darkTheme,
                        themeMode = preferences.appThemeMode,
                        pendingRoute = pendingRoute,
                        onPendingRouteConsumed = { pendingRoute.value = null },
                        onCycleTheme = {
                            // System (default) → Light → Dark → System …
                            coroutineScope.launch {
                                val nextMode = when (preferences.appThemeMode) {
                                    AppThemeMode.SYSTEM -> AppThemeMode.LIGHT
                                    AppThemeMode.LIGHT -> AppThemeMode.DARK
                                    AppThemeMode.DARK -> AppThemeMode.SYSTEM
                                }
                                app.preferencesRepository.updateAppThemeMode(nextMode)
                            }
                        },
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingRoute.value = routeFromLaunchIntent(intent)
    }
}
