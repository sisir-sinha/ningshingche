package com.ningshingche.app.playback

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.offline.CacheWriter
import com.ningshingche.app.data.music.MusicLibraryStore
import com.ningshingche.app.data.music.streamUrl
import com.ningshingche.app.data.portal.MusicTrack
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Shared ExoPlayer disk cache so Music-page prefetch and playback use the same bytes.
 * Heads of tracks are downloaded in the background; play then starts from cache.
 */
@UnstableApi
object MusicStreamCache {

    const val HEAD_BYTES = 1_500_000L
    const val NEXT_BYTES = 6_000_000L
    private const val MAX_CACHE_BYTES = 256L * 1024 * 1024

    private val lock = Any()
    private var cache: SimpleCache? = null

    fun cache(context: Context): SimpleCache = synchronized(lock) {
        cache ?: SimpleCache(
            File(context.applicationContext.cacheDir, "music-exo"),
            LeastRecentlyUsedCacheEvictor(MAX_CACHE_BYTES),
            StandaloneDatabaseProvider(context.applicationContext)
        ).also { cache = it }
    }

    fun httpFactory(): DefaultHttpDataSource.Factory =
        DefaultHttpDataSource.Factory()
            .setUserAgent(MusicLibraryStore.USER_AGENT)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(12_000)
            .setReadTimeoutMs(20_000)
            .setKeepPostFor302Redirects(true)

    fun dataSourceFactory(context: Context): CacheDataSource.Factory {
        val disk = cache(context)
        return CacheDataSource.Factory()
            .setCache(disk)
            .setUpstreamDataSourceFactory(httpFactory())
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
    }

    suspend fun prefetch(
        context: Context,
        tracks: List<MusicTrack>,
        library: MusicLibraryStore,
        bytes: Long = HEAD_BYTES,
        limit: Int = 12
    ) = withContext(Dispatchers.IO) {
        val gate = Semaphore(2)
        val batch = tracks.filter { it.hasPlayableSource() && !library.isOfflineFile(it.id) }.take(limit)
        coroutineScope {
            batch.map { track ->
                async {
                    gate.withPermit {
                        runCatching { cacheHead(context, track, bytes) }
                    }
                }
            }.awaitAll()
        }
    }

    private suspend fun cacheHead(context: Context, track: MusicTrack, bytes: Long) {
        val url = track.streamUrl()
        if (url.isBlank() || url.startsWith("file:", ignoreCase = true)) return
        val disk = cache(context)
        val key = track.id
        if (disk.isCached(key, 0, bytes)) return
        val dataSource = dataSourceFactory(context).createDataSource()
        val spec = DataSpec.Builder()
            .setUri(url)
            .setPosition(0)
            .setLength(bytes)
            .setKey(key)
            .build()
        CacheWriter(dataSource, spec, /* temporaryBuffer = */ null, /* progress = */ null).cache()
    }
}
