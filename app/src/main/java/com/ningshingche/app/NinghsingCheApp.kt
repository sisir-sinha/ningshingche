package com.ningshingche.app

import android.app.Application
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.ningshingche.app.data.preferences.CommenterPreferencesRepository
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import coil.memory.MemoryCache
import com.ningshingche.app.data.ai.NinghsingCheAiAssistant
import com.ningshingche.app.data.auth.GoogleAuthRepository
import com.ningshingche.app.data.local.AppDatabase
import com.ningshingche.app.data.local.ForumDraftStore
import com.ningshingche.app.data.preferences.UserPreferencesRepository
import com.ningshingche.app.data.portal.PortalProvider
import com.ningshingche.app.data.portal.PortalRepository
import com.ningshingche.app.data.remote.NingshingCheWebsiteClient
import com.ningshingche.app.data.remote.SupabaseClient
import com.ningshingche.app.data.repository.ArticleRepository
import com.ningshingche.app.notifications.AppNotificationManager
import com.ningshingche.app.notifications.ContentCheckWorker
import com.ningshingche.app.notifications.ContentUpdateNotifier
import com.ningshingche.app.notifications.SeenContentStore
import com.ningshingche.app.data.i18n.TranslationRepository
import com.ningshingche.app.analytics.AppTimeTracker
import com.ningshingche.app.data.music.MusicLibraryStore
import com.ningshingche.app.playback.MusicController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

class NinghsingCheApp : Application(), ImageLoaderFactory {

    /**
     * Application-lifetime scope for the small fire-and-forget jobs the app
     * kicks off at startup — the view count that follows a track starting is
     * the first one: it must finish even if the screen that started it is gone.
     */
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    lateinit var database: AppDatabase
        private set

    lateinit var articleRepository: ArticleRepository
        private set

    lateinit var preferencesRepository: UserPreferencesRepository
        private set

    lateinit var commenterPreferencesRepository: CommenterPreferencesRepository
        private set

    lateinit var aiAssistant: NinghsingCheAiAssistant
        private set

    lateinit var websiteClient: NingshingCheWebsiteClient
        private set

    lateinit var supabaseClient: SupabaseClient
        private set

    lateinit var googleAuthRepository: GoogleAuthRepository
        private set

    /** Public Supabase client for reading and moderated anonymous comments. */
    lateinit var portalRepository: PortalRepository
        private set

    lateinit var appNotificationManager: AppNotificationManager
        private set

    lateinit var contentUpdateNotifier: ContentUpdateNotifier
        private set

    lateinit var musicLibraryStore: MusicLibraryStore
        private set

    lateinit var musicController: MusicController
        private set

    /** Foreground time, which is part of the contributor points (migration 026). */
    lateinit var appTimeTracker: AppTimeTracker
        private set

    /** Interface language files, fetched from the dashboard and cached on disk. */
    lateinit var translations: TranslationRepository
        private set

    /**
     * Half-written forum posts and replies, kept until they are posted.
     *
     * Preferences, not the database: a draft is a few hundred bytes that has to
     * be readable the instant a composer opens, and nothing joins on it.
     */
    lateinit var forumDraftStore: ForumDraftStore
        private set

    /** Shared OkHttp client used by both the Portal API and Coil image loading,
     *  so TCP connection pools, TLS handshakes and DNS caches are reused across
     *  all network calls, reducing per-request overhead significantly. */
    private var _imageOkHttpClient: OkHttpClient? = null
    private val imageOkHttpClient: OkHttpClient
        get() {
            val existing = _imageOkHttpClient
            if (existing != null) return existing
            return OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .addInterceptor { chain ->
                    val request = chain.request().newBuilder()
                        .addHeader("Accept", "image/webp,image/png,image/jpeg,image/*,*/*;q=0.8")
                        .build()
                    chain.proceed(request)
                }
                .build()
                .also { _imageOkHttpClient = it }
        }

    override fun newImageLoader(): ImageLoader {
        return ImageLoader.Builder(this)
            // Memory cache — 25 % of available heap, plenty for a reading app
            .memoryCache {
                MemoryCache.Builder(this)
                    .maxSizePercent(0.25)
                    .build()
            }
            // Disk cache — 250 MB on the file system; survives app restarts.
            // Using cacheDir.resolve("coil") keeps it inside the app's private
            // cache directory, which Android can reclaim when storage is low.
            .diskCache {
                DiskCache.Builder()
                    .directory(cacheDir.resolve("coil"))
                    .maxSizeBytes(250L * 1024 * 1024) // 250 MB
                    .build()
            }
            // Reuse the shared OkHttp client so connections and TLS sessions
            // are pooled together with the rest of the app's networking.
            .okHttpClient(imageOkHttpClient)
            .crossfade(true)
            .build()
    }

    override fun onCreate() {
        super.onCreate()
        instance = this

        // Safe global exception handler to log any startup issues
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            android.util.Log.e("NinghsingCheApp", "Uncaught exception on thread ${thread.name}: ${throwable.message}", throwable)
            defaultHandler?.uncaughtException(thread, throwable)
        }

        preferencesRepository = UserPreferencesRepository(this)
        commenterPreferencesRepository = CommenterPreferencesRepository(
            PreferenceDataStoreFactory.create {
                noBackupFilesDir.resolve("commenter_details.preferences_pb")
            }
        )
        database = AppDatabase.getInstance(this)
        websiteClient = NingshingCheWebsiteClient()
        supabaseClient = SupabaseClient(this)
        googleAuthRepository = GoogleAuthRepository(supabaseClient)
        // The reader's own token travels with portal requests from here on, so a
        // signed-in reader is a signed-in reader as far as the database is
        // concerned too: the contributor board, their points and the app-time
        // report are granted to `authenticated` and refuse the publishable key.
        // Guests are unaffected — the provider answers null and the transport
        // falls back to the key, which is all the public reads need.
        PortalProvider.installReaderSession { supabaseClient.readerAuthToken() }
        articleRepository = ArticleRepository(database, supabaseClient, websiteClient)
        portalRepository = PortalProvider.repository()
        val musicStore = MusicLibraryStore(this, database, supabaseClient)
        musicLibraryStore = musicStore
        // Guest views are counted per device, the same identity the guest love
        // react uses, so one phone is one viewer for both.
        portalRepository.guestViewerId = musicStore.deviceId
        musicController = MusicController(this, musicStore)
        appTimeTracker = AppTimeTracker(this, portalRepository, supabaseClient)
        // The player reports what it starts; the count itself belongs to the
        // database, so the song's total in the UI is read back from the RPC.
        musicController.onTrackStarted = { trackId ->
            if (android.os.Build.FINGERPRINT != "robolectric") {
                appScope.launch {
                    val total = portalRepository.recordMusicView(trackId).getOrNull()
                    if (total != null) musicController.applyServerViewCount(trackId, total)
                }
            }
        }
        forumDraftStore = ForumDraftStore(this)
        translations = TranslationRepository(this)
        if (android.os.Build.FINGERPRINT != "robolectric") {
            musicController.ensureConnected()
        }
        aiAssistant = NinghsingCheAiAssistant(articleRepository, portalRepository)
        appNotificationManager = AppNotificationManager(this).also { it.createChannels() }
        contentUpdateNotifier = ContentUpdateNotifier(
            context = this,
            seenStore = SeenContentStore(this),
            notifications = appNotificationManager,
            preferencesRepository = preferencesRepository
        )
        ContentCheckWorker.schedule(this)
    }

    companion object {
        lateinit var instance: NinghsingCheApp
            private set
    }
}