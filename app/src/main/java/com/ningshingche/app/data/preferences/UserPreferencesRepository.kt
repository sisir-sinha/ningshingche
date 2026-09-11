package com.ningshingche.app.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.ningshingche.app.data.model.AppThemeMode
import com.ningshingche.app.data.model.ContentLanguage
import com.ningshingche.app.data.model.PdfFitMode
import com.ningshingche.app.data.model.PdfReaderSettings
import com.ningshingche.app.data.model.ReaderPreferences
import com.ningshingche.app.data.model.ReaderThemeMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

import androidx.datastore.preferences.core.emptyPreferences
import kotlinx.coroutines.flow.catch
import java.io.IOException

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "ningshingche_settings")

class UserPreferencesRepository(private val context: Context) {

    private object Keys {
        val FONT_SIZE = floatPreferencesKey("font_size")
        val LINE_SPACING = floatPreferencesKey("line_spacing")
        val THEME_MODE = stringPreferencesKey("theme_mode")
        val APP_THEME_MODE = stringPreferencesKey("app_theme_mode")
        val CONTENT_LANGUAGE = stringPreferencesKey("content_language")
        val LANGUAGE_CHOSEN = booleanPreferencesKey("language_chosen")
        val TTS_SPEED = floatPreferencesKey("tts_speed")
        val NOTIF_ENABLED = booleanPreferencesKey("notif_enabled")
        val NOTIF_NEW_ARTICLES = booleanPreferencesKey("notif_new_articles")
        val NOTIF_FEATURED = booleanPreferencesKey("notif_featured")
        val NOTIF_VIDEOS = booleanPreferencesKey("notif_videos")
        val NOTIF_PDFS = booleanPreferencesKey("notif_pdfs")
        val NOTIF_SYSTEM = booleanPreferencesKey("notif_system")
        val NOTIF_OTHER = booleanPreferencesKey("notif_other")
        val ONBOARDING_COMPLETE = booleanPreferencesKey("onboarding_complete")
        val PDF_BOOK_VIEW = booleanPreferencesKey("pdf_book_view")
        val PDF_NIGHT = booleanPreferencesKey("pdf_night")
        val PDF_SNAP = booleanPreferencesKey("pdf_snap")
        val PDF_DOUBLE_TAP = booleanPreferencesKey("pdf_double_tap")
        val PDF_ANNOTATIONS = booleanPreferencesKey("pdf_annotations")
        val PDF_KEEP_SCREEN = booleanPreferencesKey("pdf_keep_screen")
        val PDF_SCROLL_HANDLE = booleanPreferencesKey("pdf_scroll_handle")
        val PDF_SPACING = intPreferencesKey("pdf_spacing")
        val PDF_FIT = stringPreferencesKey("pdf_fit")
    }

    val readerPreferences: Flow<ReaderPreferences> = context.dataStore.data
        .catch { exception ->
            if (exception is IOException) {
                emit(emptyPreferences())
            } else {
                emit(emptyPreferences())
            }
        }
        .map { preferences ->
        val fontSize = preferences[Keys.FONT_SIZE] ?: 18f
        val lineSpacing = preferences[Keys.LINE_SPACING] ?: 1.6f
        val themeModeStr = preferences[Keys.THEME_MODE] ?: ReaderThemeMode.PAPER.name
        val themeMode = try {
            ReaderThemeMode.valueOf(themeModeStr)
        } catch (_: Exception) {
            ReaderThemeMode.PAPER
        }
        // Default is System (follows the device dark-mode setting).
        val appThemeModeStr = preferences[Keys.APP_THEME_MODE] ?: AppThemeMode.SYSTEM.name
        val appThemeMode = try {
            AppThemeMode.valueOf(appThemeModeStr)
        } catch (_: Exception) {
            AppThemeMode.SYSTEM
        }
        // Default is Bengali: the interface as originally written.
        val languageChosen = preferences[Keys.LANGUAGE_CHOSEN] ?: false
        val contentLanguageStr = preferences[Keys.CONTENT_LANGUAGE] ?: ContentLanguage.BENGALI.name
        val contentLanguage = try {
            ContentLanguage.valueOf(contentLanguageStr)
        } catch (_: Exception) {
            ContentLanguage.BENGALI
        }
        val ttsSpeed = preferences[Keys.TTS_SPEED] ?: 1.0f
        val notifEnabled = preferences[Keys.NOTIF_ENABLED] ?: true
        val notifNew = preferences[Keys.NOTIF_NEW_ARTICLES] ?: true
        val notifFeatured = preferences[Keys.NOTIF_FEATURED] ?: true
        val notifVideos = preferences[Keys.NOTIF_VIDEOS] ?: true
        val notifPdfs = preferences[Keys.NOTIF_PDFS] ?: true
        val notifSystem = preferences[Keys.NOTIF_SYSTEM] ?: true
        val notifOther = preferences[Keys.NOTIF_OTHER] ?: true
        val onboardingComplete = preferences[Keys.ONBOARDING_COMPLETE] ?: false

        ReaderPreferences(
            fontSizeSp = fontSize,
            lineSpacingMultiplier = lineSpacing,
            themeMode = themeMode,
            appThemeMode = appThemeMode,
            contentLanguage = contentLanguage,
            languageChosen = languageChosen,
            ttsSpeed = ttsSpeed,
            notificationsEnabled = notifEnabled,
            notificationNewArticles = notifNew,
            notificationFeatured = notifFeatured,
            notificationVideos = notifVideos,
            notificationPdfs = notifPdfs,
            notificationSystem = notifSystem,
            notificationOther = notifOther,
            onboardingComplete = onboardingComplete
        )
    }




    suspend fun updateAppThemeMode(mode: AppThemeMode) {
        context.dataStore.edit { preferences ->
            preferences[Keys.APP_THEME_MODE] = mode.name
        }
    }

    suspend fun updateContentLanguage(language: ContentLanguage) {
        context.dataStore.edit { preferences ->
            preferences[Keys.CONTENT_LANGUAGE] = language.name
        }
    }


    suspend fun updateNotificationsEnabled(enabled: Boolean) {
        context.dataStore.edit { preferences ->
            preferences[Keys.NOTIF_ENABLED] = enabled
        }
    }

    suspend fun updateNotificationNew(enabled: Boolean) {
        context.dataStore.edit { preferences ->
            preferences[Keys.NOTIF_NEW_ARTICLES] = enabled
        }
    }

    suspend fun updateNotificationFeatured(enabled: Boolean) {
        context.dataStore.edit { preferences ->
            preferences[Keys.NOTIF_FEATURED] = enabled
        }
    }

    suspend fun updateNotificationVideos(enabled: Boolean) {
        context.dataStore.edit { preferences ->
            preferences[Keys.NOTIF_VIDEOS] = enabled
        }
    }

    suspend fun updateNotificationPdfs(enabled: Boolean) {
        context.dataStore.edit { preferences ->
            preferences[Keys.NOTIF_PDFS] = enabled
        }
    }

    suspend fun updateNotificationSystem(enabled: Boolean) {
        context.dataStore.edit { preferences ->
            preferences[Keys.NOTIF_SYSTEM] = enabled
        }
    }

    suspend fun updateNotificationOther(enabled: Boolean) {
        context.dataStore.edit { preferences ->
            preferences[Keys.NOTIF_OTHER] = enabled
        }
    }

    /** Called from the first-launch language screen, once a language is picked. */
    suspend fun markLanguageChosen(chosen: Boolean = true) {
        context.dataStore.edit { preferences ->
            preferences[Keys.LANGUAGE_CHOSEN] = chosen
        }
    }

    suspend fun markOnboardingComplete() {
        context.dataStore.edit { preferences ->
            preferences[Keys.ONBOARDING_COMPLETE] = true
        }
    }

    val pdfReaderSettings: Flow<PdfReaderSettings> = context.dataStore.data
        .catch { exception ->
            if (exception is IOException) emit(emptyPreferences()) else emit(emptyPreferences())
        }
        .map { preferences ->
            val fit = try {
                PdfFitMode.valueOf(preferences[Keys.PDF_FIT] ?: PdfFitMode.BOTH.name)
            } catch (_: Exception) {
                PdfFitMode.BOTH
            }
            PdfReaderSettings(
                bookView = preferences[Keys.PDF_BOOK_VIEW] ?: true,
                nightMode = preferences[Keys.PDF_NIGHT] ?: false,
                snapPages = preferences[Keys.PDF_SNAP] ?: true,
                doubleTapZoom = preferences[Keys.PDF_DOUBLE_TAP] ?: true,
                annotations = preferences[Keys.PDF_ANNOTATIONS] ?: true,
                keepScreenOn = preferences[Keys.PDF_KEEP_SCREEN] ?: true,
                scrollHandle = preferences[Keys.PDF_SCROLL_HANDLE] ?: true,
                spacingDp = (preferences[Keys.PDF_SPACING] ?: 8).coerceIn(0, 32),
                fitMode = fit
            )
        }

    suspend fun updatePdfReaderSettings(settings: PdfReaderSettings) {
        context.dataStore.edit { preferences ->
            preferences[Keys.PDF_BOOK_VIEW] = settings.bookView
            preferences[Keys.PDF_NIGHT] = settings.nightMode
            preferences[Keys.PDF_SNAP] = settings.snapPages
            preferences[Keys.PDF_DOUBLE_TAP] = settings.doubleTapZoom
            preferences[Keys.PDF_ANNOTATIONS] = settings.annotations
            preferences[Keys.PDF_KEEP_SCREEN] = settings.keepScreenOn
            preferences[Keys.PDF_SCROLL_HANDLE] = settings.scrollHandle
            preferences[Keys.PDF_SPACING] = settings.spacingDp.coerceIn(0, 32)
            preferences[Keys.PDF_FIT] = settings.fitMode.name
        }
    }

    suspend fun pdfLastPage(pdfId: String): Int {
        if (pdfId.isBlank()) return 0
        val key = intPreferencesKey("pdf_last_page_$pdfId")
        return try {
            context.dataStore.data
                .catch { emit(emptyPreferences()) }
                .map { it[key] ?: 0 }
                .first()
        } catch (_: Exception) {
            0
        }
    }

    suspend fun savePdfLastPage(pdfId: String, page: Int) {
        if (pdfId.isBlank()) return
        val key = intPreferencesKey("pdf_last_page_$pdfId")
        context.dataStore.edit { it[key] = page.coerceAtLeast(0) }
    }
}
