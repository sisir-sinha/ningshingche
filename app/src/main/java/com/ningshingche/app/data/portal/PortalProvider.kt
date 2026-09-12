package com.ningshingche.app.data.portal

import com.ningshingche.app.BuildConfig

/**
 * Builds the singleton [PortalRepository].
 *
 * Called once from `NinghsingCheApp.onCreate()`. Keeping construction here means
 * the rest of the app only ever sees the repository interface, and swapping in a
 * fake (for previews or tests) is a one-line change.
 */
object PortalProvider {

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
        val client = PortalConfig.okHttpClient(debug = BuildConfig.DEBUG)
        val api = PortalConfig.retrofit(client).create(PortalApi::class.java)
        return PortalRepository(api)
    }
}
