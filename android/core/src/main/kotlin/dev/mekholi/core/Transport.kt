package dev.mekholi.core

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Where the Android app is pointed, and with what.
 *
 * `anonKey` is the publishable key. There is no service-role key anywhere in
 * this module, and there will not be one: it would bypass RLS, and the whole
 * tenancy story rests on RLS holding for every caller (spec §44).
 */
data class MekholiConfig(
    val baseUrl: String,
    val anonKey: String,
)

/** One request, in the only shape this client ever needs. */
data class HttpRequest(
    val method: String,
    val path: String,
    val body: String? = null,
    /** The GoTrue access token, when a call is made as a signed-in user. */
    val token: String? = null,
    val headers: Map<String, String> = emptyMap(),
)

data class HttpResponse(val status: Int, val body: String) {
    val isSuccess: Boolean get() = status in 200..299
}

/**
 * The network seam.
 *
 * Everything above this interface is pure logic — payload building, the
 * outbox, the sync loop — which is what makes those parts testable without a
 * device, without a server and, in this repository, without an emulator.
 */
interface Transport {
    fun send(request: HttpRequest): HttpResponse
}

/**
 * "We could not ask" as distinct from "the server said no".
 *
 * The offline queue turns on this difference: a connection that failed is
 * retried forever, an answer is not. A `Transport` that could not be reached
 * throws this; a response with any status does not.
 */
class NetworkUnavailableException(message: String, cause: Throwable? = null) : IOException(message, cause)

/**
 * The platform's own HTTP client.
 *
 * Deliberately `HttpURLConnection` and not OkHttp or Retrofit: a reference
 * client whose only dependency is the platform is one nobody has to upgrade,
 * and it keeps the demonstration honest — the RPC surface is reachable with
 * what Android already ships.
 */
class HttpTransport(private val config: MekholiConfig) : Transport {

    override fun send(request: HttpRequest): HttpResponse {
        val url = URL(config.baseUrl.trimEnd('/') + request.path)
        val connection = try {
            url.openConnection() as HttpURLConnection
        } catch (error: IOException) {
            throw NetworkUnavailableException("could not reach ${config.baseUrl}", error)
        }

        try {
            connection.requestMethod = request.method
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            // PostgREST answers in JSON, and asks for the affected row back so
            // a write is confirmed by the row it wrote rather than by a 201.
            connection.setRequestProperty("apikey", config.anonKey)
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Prefer", "return=representation")
            request.token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            for ((key, value) in request.headers) connection.setRequestProperty(key, value)

            if (request.body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(request.body.toByteArray(Charsets.UTF_8)) }
            }

            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return HttpResponse(status, body)
        } catch (error: IOException) {
            // A dropped connection mid-request lands here — including the case
            // that matters most: the server may have committed the sale and the
            // answer never arrived. The outbox exists for that case, and it is
            // why the reference is minted before the first attempt.
            throw NetworkUnavailableException("request to $url failed", error)
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val TIMEOUT_MS = 20_000
    }
}
