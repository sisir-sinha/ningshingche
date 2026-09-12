package com.ningshingche.app.data.portal

import com.ningshingche.app.BuildConfig
import okhttp3.ConnectionSpec
import okhttp3.OkHttpClient
import okhttp3.TlsVersion
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import java.util.concurrent.TimeUnit

/**
 * Transport configuration for the **public reader** app.
 *
 * Security model
 * --------------
 * Most of what the reader asks for is content the database already publishes to
 * the world: `blogs WHERE status = 'Publish'`, plus categories, authors,
 * galleries, PDF books, videos, published comments and site settings. Those rows
 * are served by RLS policies written `to anon, authenticated`, so the publishable
 * key is enough for them, and it is what a guest sends. It is safe to ship in an
 * APK (it grants exactly the anonymous role RLS already allows) but it is still
 * injected from `.env` through the secrets Gradle plugin rather than being
 * hard-coded, so staging and production can point at different projects.
 *
 * Some calls are not public reads, though: the reader's own points
 * (`contributor_points`), the contributor board (`contributor_leaderboard`) and
 * the app-time report (`record_app_time`) are granted to `authenticated` alone
 * and answer `auth.uid()`. Sent with the publishable key they are refused even
 * for a reader who is signed in, because PostgREST never saw their token — which
 * is exactly how the board came back with "for signed-in readers" to somebody
 * who was signed in. So a **reader session token is installed here** (see
 * [installReaderSession]) and travels as the `Authorization` bearer whenever
 * there is one; a guest keeps the publishable key, exactly as before.
 */
object PortalConfig {

    private const val FALLBACK_URL = "https://slcpvmpsynkqdozvlsii.supabase.co"
    private const val FALLBACK_KEY = "sb_publishable_jqJACnQHmCMcGjt0kG6Sug_ddknIbAA"

    /** Values injected by the secrets plugin from `.env` (falls back to `.env.example`). */
    private fun env(value: String?): String =
        value?.takeIf { it.isNotBlank() && !it.startsWith("MY_") }.orEmpty()

    val baseUrl: String
        get() = env(BuildConfig.SUPABASE_URL).ifBlank { FALLBACK_URL }.trimEnd('/')

    val publishableKey: String
        get() = env(BuildConfig.SUPABASE_PUBLISHABLE_KEY).ifBlank { FALLBACK_KEY }

    /**
     * Supplies the signed-in reader's Supabase access token, or null for a guest.
     *
     * Installed once at startup by `NinghsingCheApp` through
     * [PortalProvider.installReaderSession]; the provider does the refresh, so
     * this object never has to know how a session is kept.
     */
    @Volatile
    private var readerSession: (() -> String?)? = null

    /** The token is consulted on every request; see [readerSession]. */
    fun installReaderSession(provider: () -> String?) {
        readerSession = provider
    }

    const val CONNECT_TIMEOUT_SECONDS = 15L
    const val READ_TIMEOUT_SECONDS = 25L
    const val WRITE_TIMEOUT_SECONDS = 25L

    /** Largest page the reader ever asks for. PostgREST caps server-side at 1000. */
    const val PAGE_SIZE = 20
    const val MAX_PAGE_SIZE = 100

    val moshi: Moshi by lazy {
        Moshi.Builder()
            .add(KotlinJsonAdapterFactory())
            .build()
    }

    fun okHttpClient(debug: Boolean): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .connectionSpecs(
                listOf(
                    ConnectionSpec.Builder(ConnectionSpec.MODERN_TLS)
                        .tlsVersions(TlsVersion.TLS_1_2, TlsVersion.TLS_1_3)
                        .build(),
                    ConnectionSpec.RESTRICTED_TLS
                )
            )
            .addInterceptor { chain ->
                val key = publishableKey
                // Read per request, never captured: a reader who signs in (or
                // whose token expires) must affect the very next call.
                val readerToken = readerSession?.invoke()?.takeIf { it.isNotBlank() }
                val request = chain.request().newBuilder()
                    .header("apikey", key)
                    // `header`, not `addHeader`: exactly one bearer, and it is
                    // the reader's own token when there is one.
                    .header("Authorization", "Bearer ${readerToken ?: key}")
                    .header("Accept", "application/json")
                    .build()
                chain.proceed(request)
            }

        if (debug) {
            val logging = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BASIC
                redactHeader("apikey")
                redactHeader("Authorization")
            }
            builder.addInterceptor(logging)
        }
        return builder.build()
    }

    fun retrofit(client: OkHttpClient): Retrofit = Retrofit.Builder()
        .baseUrl("$baseUrl/rest/v1/")
        .client(client)
        .addConverterFactory(MoshiConverterFactory.create(moshi))
        .build()

}
