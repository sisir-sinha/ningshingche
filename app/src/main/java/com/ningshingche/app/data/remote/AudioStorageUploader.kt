package com.ningshingche.app.data.remote

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import com.ningshingche.app.data.auth.GoogleAuthMapper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

data class UploadedAudio(
    val url: String,
    val path: String,
    val sizeBytes: Long,
    val durationSeconds: Int,
    val mime: String
)

object AudioStorageUploader {

    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    suspend fun uploadMp3(
        context: Context,
        uri: Uri,
        userId: String,
        accessToken: String,
        refreshAccessToken: (() -> String?)? = null
    ): Result<UploadedAudio> = withContext(Dispatchers.IO) {
        try {
            val cleanUserId = userId.trim()
            if (cleanUserId.isBlank()) {
                return@withContext Result.failure(Exception("গান আপলোড করতে সাইন ইন থাকা আবশ্যক।"))
            }
            val resolver = context.contentResolver
            val rawMime = resolver.getType(uri).orEmpty()
            val mime = when {
                rawMime.startsWith("audio/mpeg") || rawMime == "audio/mp3" -> "audio/mpeg"
                rawMime.startsWith("audio/wav") || rawMime == "audio/x-wav" -> "audio/wav"
                rawMime.startsWith("audio/mp4") || rawMime == "audio/aac" -> "audio/mp4"
                rawMime.startsWith("audio/ogg") -> "audio/ogg"
                rawMime.startsWith("audio/flac") -> "audio/flac"
                rawMime.startsWith("audio/webm") -> "audio/webm"
                rawMime.startsWith("audio/") -> rawMime
                else -> "audio/mpeg"
            }
            val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
                ?: return@withContext Result.failure(Exception("অডিও ফাইল পড়া যায়নি।"))
            if (bytes.size > 32 * 1024 * 1024) {
                return@withContext Result.failure(Exception("MP3 ৩২ মেগাবাইটের বেশি হতে পারবে না।"))
            }
            val duration = durationSeconds(context, uri)
            val year = java.util.Calendar.getInstance().get(java.util.Calendar.YEAR)
            val path = "user/$cleanUserId/$year/${UUID.randomUUID()}.mp3"
            val url = "${SupabaseConfig.supabaseUrl.trimEnd('/')}/storage/v1/object/music/$path"
            var token = accessToken
            var attempt = 0
            while (true) {
                fun buildRequest(method: String, tok: String) = Request.Builder()
                    .url(url)
                    .addHeader("apikey", SupabaseConfig.supabaseKey)
                    .addHeader("Authorization", "Bearer $tok")
                    .addHeader("x-upsert", "false")
                    .method(method, bytes.toRequestBody(mime.toMediaType()))
                    .build()

                var (code, body) = http.newCall(buildRequest("POST", token)).execute().use { response ->
                    response.code to response.body?.string().orEmpty()
                }
                // If POST is 405 Method Not Allowed, fallback to PUT
                if (code == 405) {
                    val (putCode, putBody) = http.newCall(buildRequest("PUT", token)).execute().use { response ->
                        response.code to response.body?.string().orEmpty()
                    }
                    code = putCode
                    body = putBody
                }
                if (code in 200..299) break

                val detail = storageErrorMessage(body, code)
                val expired = GoogleAuthMapper.userFacingJwtError("$detail $body") != null ||
                    code == 401 ||
                    body.contains("exp claim", ignoreCase = true) ||
                    body.contains("token is expired", ignoreCase = true) ||
                    body.contains("jwt expired", ignoreCase = true) ||
                    body.contains("JWS Protected Header is invalid", ignoreCase = true)

                if (expired && attempt == 0) {
                    val next = refreshAccessToken?.invoke()
                    if (!next.isNullOrBlank() && next != token) {
                        token = next
                        attempt += 1
                        continue
                    }
                }
                return@withContext Result.failure(
                    Exception(GoogleAuthMapper.userFacingJwtError("$detail $body") ?: detail)
                )
            }
            val publicUrl =
                "${SupabaseConfig.supabaseUrl.trimEnd('/')}/storage/v1/object/public/music/$path"
            Result.success(
                UploadedAudio(
                    url = publicUrl,
                    path = path,
                    sizeBytes = bytes.size.toLong(),
                    durationSeconds = duration,
                    mime = mime
                )
            )
        } catch (error: Exception) {
            Result.failure(
                Exception(
                    GoogleAuthMapper.userFacingJwtError(error.message)
                        ?: error.message
                        ?: "অডিও আপলোড যায়নি।"
                )
            )
        }
    }

    private fun storageErrorMessage(body: String, code: Int): String {
        val parsed = runCatching { JSONObject(body) }.getOrNull()
        val detail = listOf("message", "error_description", "msg", "error")
            .map { parsed?.optString(it).orEmpty().trim() }
            .firstOrNull { it.isNotBlank() && it != "null" }
            .orEmpty()
        val jwtErr = GoogleAuthMapper.userFacingJwtError("$detail $body")
        if (jwtErr != null) return jwtErr
        if (body.contains("row-level security", ignoreCase = true) ||
            body.contains("violates row-level security policy", ignoreCase = true)
        ) {
            return "গান আপলোড করার অনুমতি মেলেনি (Storage RLS)। অনুগ্রহ করে Google দিয়ে আবার সাইন ইন করুন।"
        }
        return detail.takeIf { it.isNotBlank() } ?: "অডিও আপলোড যায়নি ($code)।"
    }

    private fun durationSeconds(context: Context, uri: Uri): Int {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            val ms = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            (ms / 1000L).toInt().coerceAtLeast(0)
        } catch (_: Exception) {
            0
        } finally {
            runCatching { retriever.release() }
        }
    }
}
