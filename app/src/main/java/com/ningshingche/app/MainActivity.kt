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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/**
 * Host activity for the public reader.
 *
 * All navigation lives in [EditorialReaderApp]; this class owns the theme
 * (system / light / dark, read from DataStore) and the edge-to-edge window.
 *
 * The first-install steps are not decided here: they are a destination of the
 * reader's navigation (`ReaderRoute.FirstRun`), so the splash leads into them
 * rather than appearing after them.
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
                    // The reader opens on the splash; a first install goes from
                    // there into the three-step flow (language, sign-in,
                    // notifications) inside the reader's own navigation, so the
                    // steps, their dots and the finish share one screen instead
                    // of being separate destinations reached from here.
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

    /**
     * Foreground time is contributor points (migration 026), so the clock starts
     * and stops with the activity rather than with a screen: moving between
     * screens is one session, and leaving the app is the end of it.
     */
    override fun onStart() {
        super.onStart()
        (application as? NinghsingCheApp)?.appTimeTracker?.onForeground()
    }

    override fun onStop() {
        (application as? NinghsingCheApp)?.appTimeTracker?.onBackground()
        super.onStop()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingRoute.value = routeFromLaunchIntent(intent)
    }
}
