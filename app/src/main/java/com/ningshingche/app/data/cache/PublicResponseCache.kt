package com.ningshingche.app.data.cache

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.Cache
import okhttp3.CacheControl
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * A bounded, expendable cache for explicitly public PostgREST GETs only.
 * Public reads always use the anonymous key: a reader's token, cookies and
 * personalized RPC/write responses must never enter this shared cache.
 * A hit is returned without waiting for the network; a throttled revalidation
 * happens independently. Offline and server errors leave the last good copy.
 */
class PublicResponseCache(
    directory: File,
    private val apiHost: String,
    private val publicKey: String,
    private val projections: Map<String, Set<String>>,
    maxBytes: Long = 64L * 1024 * 1024,
    private val refreshIntervalMs: Long = TimeUnit.MINUTES.toMillis(10),
    private val clock: () -> Long = System::currentTimeMillis
) {
    private val disk = Cache(directory, maxBytes)
    private val lastCheck = ConcurrentHashMap<String, Long>()
    private val pending = ConcurrentHashMap.newKeySet<String>()
    private val changesMutable = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val changes: SharedFlow<Unit> = changesMutable
    @Volatile private var refreshClient: OkHttpClient? = null

    /** Exact host, method, resource and projection allowlist; search terms are excluded. */
    fun eligible(request: Request): Boolean {
        val url = request.url
        if (request.method != "GET" || request.cacheControl.noStore || url.scheme != "https" || url.host != apiHost) return false
        if (request.header("Cookie") != null || request.header("Range") != null) return false
        val parts = url.pathSegments
        if (parts.size != 3 || parts[0] != "rest" || parts[1] != "v1") return false
        val table = parts[2]
        if (url.queryParameterValues("select").size != 1 || url.queryParameter("select") !in (projections[table] ?: return false)) return false
        if (url.queryParameterNames.any { it in setOf("or", "and", "title", "search") }) return false
        if (table == "blogs" || table == "comments") {
            if (url.queryParameterValues("status") != listOf("eq.Publish")) return false
        }
        return true
    }

    private fun anonymous(request: Request): Request = request.newBuilder()
        .header("Authorization", "Bearer $publicKey")
        .header("apikey", publicKey)
        .removeHeader("Cookie")
        .build()

    val interceptor = Interceptor { chain ->
        val original = chain.request()
        if (!eligible(original)) return@Interceptor chain.proceed(original.newBuilder()
            .cacheControl(CacheControl.Builder().noStore().build()).build())
        val publicRequest = anonymous(original)
        if (original.cacheControl.noCache) return@Interceptor chain.proceed(publicRequest)
        val cached = chain.proceed(publicRequest.newBuilder().cacheControl(CacheControl.FORCE_CACHE).build())
        if (cached.code != 504 && cached.cacheResponse != null) {
            refresh(publicRequest)
            cached
        } else {
            cached.close()
            chain.proceed(publicRequest)
        }
    }

    /** Only turn anonymous, successful, explicitly allowed JSON into cache entries. */
    val networkInterceptor = Interceptor { chain ->
        val request = chain.request()
        val response = chain.proceed(request)
        if (eligible(request) && request.header("Authorization") == "Bearer $publicKey") {
            if (safeResponse(response)) {
                response.newBuilder()
                    .removeHeader("Set-Cookie")
                    .header("Cache-Control", "public, max-age=${response.cacheControl.maxAgeSeconds.takeIf { it > 0 }?.coerceAtMost(600) ?: 600}")
                    .build()
            } else {
                // OkHttp may otherwise store no-cache/private responses and
                // later satisfy FORCE_CACHE with them. Explicitly forbid writes.
                response.newBuilder().header("Cache-Control", "no-store").build()
            }
        } else {
            // Network interceptors also run on redirects. A redirect target is
            // not automatically an allowlisted public resource.
            response.newBuilder().header("Cache-Control", "no-store").build()
        }
    }

    private fun safeResponse(response: Response): Boolean {
        val cookies = response.headers.values("Set-Cookie")
        val onlyCloudflareCookies = cookies.all { cookie ->
            cookie.startsWith("__cf_bm=") || cookie.startsWith("_cfuvid=")
        }
        val cc = response.cacheControl
        return response.code == 200 &&
            response.header("Content-Type").orEmpty().contains("application/json", ignoreCase = true) &&
            !cc.noStore && !cc.noCache && !cc.mustRevalidate && !cc.isPrivate && cc.maxAgeSeconds != 0 &&
            onlyCloudflareCookies && response.headers.values("Vary").flatMap { it.split(',') }.none { it.trim() == "*" }
    }

    /** Install both clients around one Cache; the background client skips cache-first interception. */
    fun install(builder: OkHttpClient.Builder): OkHttpClient {
        builder.cache(disk).addInterceptor(interceptor).addNetworkInterceptor(networkInterceptor)
        val foreground = builder.build()
        refreshClient = foreground.newBuilder().apply {
            interceptors().remove(interceptor)
            // The session interceptor runs earlier; never let it reattach a
            // reader token to the anonymous refresh or prefetch request.
            addInterceptor { chain ->
                val request = chain.request()
                chain.proceed(if (eligible(request)) anonymous(request).newBuilder()
                    .cacheControl(CacheControl.FORCE_NETWORK).build() else request.newBuilder()
                    .cacheControl(CacheControl.Builder().noStore().build()).build())
            }
        }.build()
        return foreground
    }

    /** Network-first client for constrained background warming. */
    fun warmingClient(): OkHttpClient = checkNotNull(refreshClient)

    private fun refresh(request: Request) {
        val client = refreshClient ?: return
        val key = request.url.toString()
        val now = clock()
        val last = lastCheck[key]
        if (last != null && now >= last && now - last < refreshIntervalMs) return
        if (!pending.add(key)) return
        if (lastCheck.size > 2048) lastCheck.clear()
        lastCheck[key] = now
        client.newCall(request.newBuilder().cacheControl(CacheControl.FORCE_NETWORK).build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { pending.remove(key) }
            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use {
                        if (it.code in setOf(401, 403, 404, 410) || (it.isSuccessful && !safeResponse(it))) {
                            // Access revoked or server forbids caching: don't continue
                            // serving the previously public response indefinitely.
                            val urls = disk.urls()
                            while (urls.hasNext()) if (urls.next() == key) urls.remove()
                            changesMutable.tryEmit(Unit)
                        } else if (it.isSuccessful) {
                            // Drain without allocating a second copy; OkHttp commits its disk entry on EOF.
                            val source = it.body?.source()
                            val buffer = okio.Buffer()
                            while (source != null && source.read(buffer, 8192) != -1L) buffer.clear()
                            changesMutable.tryEmit(Unit)
                        }
                    }
                } catch (_: IOException) {
                    // Keep last good cache on network or disk errors.
                } finally { pending.remove(key) }
            }
        })
    }

    fun notifyChanged() { changesMutable.tryEmit(Unit) }
    fun allowImmediateRefresh() { lastCheck.clear() }

    fun close() = disk.close()

    fun clear() {
        disk.evictAll()
        lastCheck.clear()
    }
}
