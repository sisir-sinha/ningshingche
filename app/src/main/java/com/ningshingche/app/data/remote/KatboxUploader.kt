package com.ningshingche.app.data.remote

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * Catbox.moe uploader matching the public API that
 * [katbox](https://github.com/Olivki/katbox) wraps.
 *
 * Anonymous file upload (no userhash):
 * ```
 * POST https://catbox.moe/user/api.php
 * reqtype=fileupload
 * fileToUpload=<bytes>
 * ```
 * The body of a successful response is the public URL, e.g.
 * `https://files.catbox.moe/eh871k.mp3`.
 */
object KatboxUploader {

    const val API_URL = "https://catbox.moe/user/api.php"
    const val MAX_BYTES = 200L * 1024L * 1024L

    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)
        .writeTimeout(180, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    suspend fun uploadFromUri(context: Context, uri: Uri): Result<UploadedAudio> =
        withContext(Dispatchers.IO) {
            try {
                val resolver = context.contentResolver
                val mime = resolver.getType(uri)?.takeIf { it.startsWith("audio/") } ?: "audio/mpeg"
                val filename = displayName(context, uri)
                if (!looksLikeAudio(filename, mime)) {
                    return@withContext Result.failure(Exception("শুধু MP3 বা অডিও ফাইল আপলোড করুন।"))
                }
                val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: return@withContext Result.failure(Exception("অডিও ফাইল পড়া যায়নি।"))
                if (bytes.size > MAX_BYTES) {
                    return@withContext Result.failure(Exception("অডিও ২০০ মেগাবাইটের বেশি হতে পারবে না।"))
                }
                val duration = durationSeconds(context, uri)
                uploadBytes(bytes, filename, mime, duration)
            } catch (error: Exception) {
                Result.failure(error)
            }
        }

    /**
     * Same as `Catbox.upload(bytes, filename)` in katbox.
     */
    suspend fun uploadBytes(
        bytes: ByteArray,
        filename: String,
        mime: String = "audio/mpeg",
        durationSeconds: Int = 0,
        userHash: String = ""
    ): Result<UploadedAudio> = withContext(Dispatchers.IO) {
        try {
            val safeName = sanitizeFilename(filename)
            val form = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("reqtype", "fileupload")
                .addFormDataPart(
                    "fileToUpload",
                    safeName,
                    bytes.toRequestBody(mime.toMediaType())
                )
            if (userHash.isNotBlank()) {
                form.addFormDataPart("userhash", userHash.trim())
            }
            val request = Request.Builder()
                .url(API_URL)
                .header("User-Agent", "NingshingChe/1.0 (Katbox Catbox uploader)")
                .header("Accept", "text/plain, */*")
                .post(form.build())
                .build()
            http.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty().trim()
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        Exception(humanError(body, response.code))
                    )
                }
                val url = extractUrl(body)
                    ?: return@withContext Result.failure(
                        Exception(humanError(body, response.code))
                    )
                Result.success(
                    UploadedAudio(
                        url = url,
                        path = url.substringAfterLast('/'),
                        sizeBytes = bytes.size.toLong(),
                        durationSeconds = durationSeconds,
                        mime = mime
                    )
                )
            }
        } catch (error: Exception) {
            Result.failure(error)
        }
    }

    private fun extractUrl(body: String): String? {
        val match = Regex("""https?://(?:files\.)?catbox\.moe/\S+""", RegexOption.IGNORE_CASE)
            .find(body)
            ?.value
            ?.trim()
            ?.trimEnd('.', ',', ')', ']', '"', '\'')
        if (!match.isNullOrBlank()) {
            return if (match.startsWith("http://")) match.replaceFirst("http://", "https://") else match
        }
        return if (body.startsWith("https://") && !body.contains('<')) body.lineSequence().firstOrNull()?.trim() else null
    }

    private fun humanError(body: String, code: Int): String {
        val plain = body.replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ").trim()
        return when {
            plain.contains("flood", true) || plain.contains("rate", true) ->
                "Catbox সাময়িকভাবে ব্যস্ত। কিছুক্ষণ পর আবার চেষ্টা করুন।"
            plain.contains("file type", true) || plain.contains("not allowed", true) ->
                "এই অডিও ফরম্যাট Catbox গ্রহণ করেনি।"
            plain.isNotBlank() && plain.length < 180 && !plain.contains('<') ->
                plain
            else -> "Catbox-এ আপলোড যায়নি ($code)।"
        }
    }

    private fun looksLikeAudio(filename: String, mime: String): Boolean {
        if (mime.startsWith("audio/")) return true
        val lower = filename.lowercase()
        return listOf(".mp3", ".m4a", ".aac", ".ogg", ".wav", ".flac", ".webm").any { lower.endsWith(it) }
    }

    private fun sanitizeFilename(name: String): String {
        val trimmed = name.substringAfterLast('/').substringAfterLast('\\').ifBlank { "audio.mp3" }
        val cleaned = trimmed.replace(Regex("[^A-Za-z0-9._-]"), "-").replace(Regex("-+"), "-")
        return if (cleaned.contains('.')) cleaned else "$cleaned.mp3"
    }

    private fun displayName(context: Context, uri: Uri): String {
        var name = "audio.mp3"
        runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val value = cursor.getString(0)
                        if (!value.isNullOrBlank()) name = value
                    }
                }
        }
        return sanitizeFilename(name)
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
