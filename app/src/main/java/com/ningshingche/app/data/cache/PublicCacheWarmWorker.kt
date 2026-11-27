package com.ningshingche.app.data.cache

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.ningshingche.app.data.portal.PortalApi
import com.ningshingche.app.data.portal.PortalProvider
import com.ningshingche.app.data.portal.PortalRepository
import com.ningshingche.app.ui.components.normalizePortalImageUrl
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.util.concurrent.TimeUnit

/** Incrementally warm public home content on unmetered Wi-Fi; never download media. */
class PublicCacheWarmWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (!onUnmeteredWifi()) return Result.retry()
        val api = PortalProvider.warmingApi() ?: return Result.retry()
        return try {
            val feed = PortalRepository(api).homeFeed().getOrNull() ?: return Result.retry()
            val articles = (feed.latest + feed.hero + feed.featured).distinctBy { it.id }.take(12)
            for (article in articles) {
                currentCoroutineContext().ensureActive()
                if (!onUnmeteredWifi()) return Result.retry()
                // This read does not call article(), which would record a fake view.
                api.blogs(select = PortalApi.BLOG_DETAIL_COLUMNS, id = "eq.${article.id}",
                    status = "eq.Publish", limit = 1)
            }
            val images = (articles.map { it.imageUrl } + feed.authors.map { it.imageUrl } +
                feed.gallery.map { it.imageUrl } + feed.pdfBooks.map { it.coverUrl } +
                feed.music.map { it.thumbnailUrl } + feed.videos.map { it.thumbnailUrl })
                .map { normalizePortalImageUrl(it) }.filter { raw ->
                    val url = raw.toHttpUrlOrNull()
                    url != null && url.scheme == "https" && url.querySize == 0 &&
                        url.username.isEmpty() && url.password.isEmpty()
                }.distinct().take(30)
            for (url in images) {
                currentCoroutineContext().ensureActive()
                if (!onUnmeteredWifi()) return Result.retry()
                applicationContext.imageLoader.execute(ImageRequest.Builder(applicationContext)
                    .data(url).size(512).memoryCachePolicy(CachePolicy.DISABLED).build())
            }
            PortalProvider.notifyPublicCacheChanged()
            Result.success()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Result.retry()
        }
    }

    private fun onUnmeteredWifi(): Boolean {
        val manager = applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = manager.activeNetwork?.let { manager.getNetworkCapabilities(it) } ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    companion object {
        fun schedule(context: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED)
                .setRequiresBatteryNotLow(true).build()
            val manager = WorkManager.getInstance(context)
            manager.enqueueUniqueWork("public_cache_warm_once", ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<PublicCacheWarmWorker>().setConstraints(constraints).build())
            manager.enqueueUniquePeriodicWork("public_cache_warm_periodic", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<PublicCacheWarmWorker>(12, TimeUnit.HOURS).setConstraints(constraints).build())
        }
    }
}
