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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ningshingche.app.data.model.AppThemeMode
import com.ningshingche.app.data.model.ReaderPreferences
import com.ningshingche.app.notifications.routeFromLaunchIntent
import com.ningshingche.app.ui.editorial.EditorialTheme
import com.ningshingche.app.ui.i18n.LocalTranslations
import com.ningshingche.app.ui.i18n.TranslationTable
import com.ningshingche.app.ui.reader.EditorialReaderApp
import com.ningshingche.app.ui.screens.LanguageSetupScreen
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
            // Null until DataStore answers, so the language screen cannot flash
            // for a reader who answered that question long ago.
            val stored by app.preferencesRepository.readerPreferences
                .collectAsStateWithLifecycle(initialValue = null)
            val preferences = stored ?: ReaderPreferences()
            val coroutineScope = rememberCoroutineScope()

            val darkTheme = when (preferences.appThemeMode) {
                AppThemeMode.SYSTEM -> isSystemInDarkTheme()
                AppThemeMode.LIGHT -> false
                AppThemeMode.DARK -> true
            }

            // Interface language: the cached table shows immediately, and a
            // refresh runs whenever the reader switches language, so a language
            // file edited in the dashboard arrives without an app update.
            val language = preferences.contentLanguage
            val strings by app.translations.strings(language)
                .collectAsStateWithLifecycle()
            val table = TranslationTable(language = language, strings = strings)

            // The table reaches every screen from here, so no screen has to read
            // preferences or the repository itself.
            CompositionLocalProvider(
                LocalTranslations provides table
            ) {
                EditorialTheme(darkTheme = darkTheme) {
                    if (stored == null) return@EditorialTheme // first frame only
                    // First launch: the language question, on its own, before
                    // anything else. Afterwards it lives in Settings only.
                    if (!preferences.languageChosen) {
                        LanguageSetupScreen(
                            selected = preferences.contentLanguage,
                            onSelect = { language ->
                                coroutineScope.launch {
                                    // Downloads that language's file immediately,
                                    // so the reader continues into a translated app.
                                    app.preferencesRepository.updateContentLanguage(language)
                                    app.translations.refresh(language)
                                }
                            },
                            onContinue = {
                                coroutineScope.launch {
                                    app.preferencesRepository.markLanguageChosen()
                                }
                            }
                        )
                    } else {
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
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingRoute.value = routeFromLaunchIntent(intent)
    }
}
