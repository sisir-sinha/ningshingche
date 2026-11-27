package com.ningshingche.app.data.portal

import com.ningshingche.app.BuildConfig
import android.content.Context
import com.ningshingche.app.data.cache.PublicResponseCache
import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * Builds the singleton [PortalRepository].
 *
 * Called once from `NinghsingCheApp.onCreate()`. Keeping construction here means
 * the rest of the app only ever sees the repository interface, and swapping in a
 * fake (for previews or tests) is a one-line change.
 */
object PortalProvider {

    @Volatile private var publicCache: PublicResponseCache? = null

    fun installPublicCache(context: Context) {
        if (publicCache != null) return
        synchronized(this) {
            if (publicCache == null) publicCache = PublicResponseCache(
                directory = context.applicationContext.cacheDir.resolve("public-portal-v1"),
                apiHost = PortalConfig.baseUrl.toHttpUrl().host,
                publicKey = PortalConfig.publishableKey,
                projections = mapOf(
                    "blogs" to setOf(PortalApi.BLOG_LIST_COLUMNS, PortalApi.BLOG_DETAIL_COLUMNS, PortalApi.FACET_COLUMNS),
                    "blog_tag_counts" to setOf(PortalApi.TAG_COUNT_COLUMNS),
                    "categories" to setOf(PortalApi.CATEGORY_COLUMNS),
                    "authors" to setOf(PortalApi.AUTHOR_COLUMNS),
                    "galleries" to setOf(PortalApi.GALLERY_COLUMNS),
                    "pdf_books" to setOf(PortalApi.PDF_COLUMNS),
                    "videos" to setOf(PortalApi.VIDEO_COLUMNS),
                    "music_tracks" to setOf(PortalApi.MUSIC_COLUMNS, PortalApi.MUSIC_COLUMNS_WITH_LYRICS,
                        PortalApi.MUSIC_COLUMNS_WITH_VIDEO, PortalApi.MUSIC_COLUMNS_WITH_META,
                        PortalApi.MUSIC_COLUMNS_WITH_LOVE, PortalApi.MUSIC_COLUMNS_WITH_VIEWS),
                    "settings" to setOf(PortalApi.SETTINGS_COLUMNS),
                    "comments" to setOf(PortalApi.COMMENT_COLUMNS, PortalApi.COMMENT_COLUMNS_WITHOUT_AVATAR)
                )
            )
        }
    }

    fun cacheChanges() = publicCache?.changes
    fun warmingApi(): PortalApi? = publicCache?.warmingClient()?.let { PortalConfig.retrofit(it).create(PortalApi::class.java) }
    fun clearPublicCache() { runCatching { publicCache?.clear() } }
    fun notifyPublicCacheChanged() { publicCache?.notifyChanged() }
    fun refreshPublicCacheSoon() { publicCache?.allowImmediateRefresh() }

    @Volatile
    private var repository: PortalRepository? = null

    /**
     * Hands the transport the signed-in reader's token, so the calls that answer
     * `auth.uid()` (the contributor board, their own points, app time) speak for
     * that reader instead of arriving as a guest. A guest's requests keep the
     * publishable key, which is everything the public reads need.
     *
     * Call before the first request — `NinghsingCheApp.onCreate()` does.
     */
    fun installReaderSession(provider: () -> String?) = PortalConfig.installReaderSession(provider)

    fun repository(): PortalRepository = repository ?: synchronized(this) {
        repository ?: create().also { repository = it }
    }


    private fun create(): PortalRepository {
        val client = PortalConfig.okHttpClient(debug = BuildConfig.DEBUG, publicCache = publicCache)
        val api = PortalConfig.retrofit(client).create(PortalApi::class.java)
        return PortalRepository(api)
    }
}
