package com.ningshingche.app.data.remote

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
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
        accessToken: String
    ): Result<UploadedAudio> = withContext(Dispatchers.IO) {
        try {
            val resolver = context.contentResolver
            val mime = resolver.getType(uri)?.takeIf { it.startsWith("audio/") } ?: "audio/mpeg"
            val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
                ?: return@withContext Result.failure(Exception("অডিও ফাইল পড়া যায়নি।"))
            if (bytes.size > 32 * 1024 * 1024) {
                return@withContext Result.failure(Exception("MP3 ৩২ মেগাবাইটের বেশি হতে পারবে না।"))
            }
            val duration = durationSeconds(context, uri)
            val year = java.util.Calendar.getInstance().get(java.util.Calendar.YEAR)
            val path = "user/$userId/$year/${UUID.randomUUID()}.mp3"
            val url = "${SupabaseConfig.supabaseUrl.trimEnd('/')}/storage/v1/object/music/$path"
            val request = Request.Builder()
                .url(url)
                .addHeader("apikey", SupabaseConfig.supabaseKey)
                .addHeader("Authorization", "Bearer $accessToken")
                .addHeader("x-upsert", "false")
                .put(bytes.toRequestBody(mime.toMediaType()))
                .build()
            http.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val detail = runCatching { JSONObject(body).optString("message") }.getOrNull().orEmpty()
                    val combined = "$detail $body"
                    val message = when {
                        combined.contains("exp claim", ignoreCase = true) ||
                            combined.contains("invalid JWT", ignoreCase = true) ||
                            response.code == 401 ->
                            "সেশন শেষ হয়েছে। Google দিয়ে আবার সাইন ইন করে গান আপলোড করুন।"
                        else -> detail.takeIf { it.isNotBlank() } ?: "অডিও আপলোড যায়নি (${response.code})।"
                    }
                    return@withContext Result.failure(Exception(message))
                }
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
            Result.failure(error)
        }
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
