package com.ningshingche.app.data.remote

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Song-file upload host used by the Add Song flow (`upload.satoru.click`).
 *
 * The endpoint is Catbox-compatible: one multipart POST carrying
 * `reqtype=fileupload` and `fileToUpload`, answered with the public URL as
 * plain text. Verified against the live service: 200, a `https://…/files/<id>.<ext>`
 * body, and a file that downloads back with the right content type.
 *
 * Why this instead of Supabase Storage: it needs no session and accepts files
 * up to [MAX_BYTES], where the `music` bucket RLS and the 32 MB request cap had
 * to be satisfied first. Songs uploaded here land as `file_provider = 'url'`,
 * which `MusicTrack.streamUrl()` already plays.
 *
 * The body is streamed from the content resolver rather than read into memory,
 * so a 200 MB track cannot OOM the app. [SupabaseClient.uploadUserMusicFile]
 * stays as the fallback when this host is unreachable.
 */
object SatoruUploadClient {

    const val HOST = "https://upload.satoru.click"
    const val UPLOAD_ENDPOINT = "$HOST/user/api.php"

    /** The host's documented ceiling; enforced here so the failure is immediate. */
    const val MAX_BYTES = 200L * 1024 * 1024

    private const val USER_AGENT = "NingshingChe/1.0 (Android Music)"
    private const val BUFFER_BYTES = 64 * 1024

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.MINUTES)
        .readTimeout(2, TimeUnit.MINUTES)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    /** What the picker shows about the chosen file, before anything is sent. */
    data class SongFile(
        val displayName: String,
        val mimeType: String,
        val sizeBytes: Long
    )

    /** Where a song ended up. `storagePath` stays empty for this host. */
    data class UploadedSong(
        val publicUrl: String,
        val storagePath: String,
        val sizeBytes: Long
    )

    /**
     * A file of any kind on the same host.
     *
     * The forum's attachments ride here: a PDF is not a song, but it is a
     * document the host will keep and hand back a URL for, and Supabase Storage
     * would want a session and a bucket policy for the same result. The name is
     * carried along because the app shows it on the thread — a document is its
     * icon and its file name, and a URL's last path segment is neither.
     */
    data class UploadedFile(
        val publicUrl: String,
        val displayName: String,
        val mimeType: String,
        val sizeBytes: Long
    )

    fun describe(context: Context, uri: Uri, fallbackName: String = "song.mp3"): SongFile {
        var name = fallbackName
        var size = 0L
        runCatching {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (cursor.moveToFirst()) {
                    if (nameIndex >= 0) {
                        cursor.getString(nameIndex)?.takeIf { it.isNotBlank() }?.let { name = it }
                    }
                    if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
                }
            }
        }
        // Some providers answer with a content:// id instead of a file name.
        if (name.contains('/') || name.startsWith("content:")) {
            name = uri.lastPathSegment.orEmpty().substringAfterLast('/').ifBlank { fallbackName }
        }
        val mime = context.contentResolver.getType(uri)
            ?: mimeForName(name)
        return SongFile(displayName = name, mimeType = mime, sizeBytes = size.coerceAtLeast(0L))
    }

    fun isTooLarge(sizeBytes: Long): Boolean = sizeBytes > MAX_BYTES

    suspend fun uploadAudio(context: Context, uri: Uri): Result<UploadedSong> =
        withContext(Dispatchers.IO) {
            val file = describe(context, uri)
            if (isTooLarge(file.sizeBytes)) {
                return@withContext Result.failure(Exception("ফাইল ২০০ এমবি-র বেশি হতে পারে না।"))
            }
            try {
                val url = sendFile(context, uri, file.displayName, file.mimeType, file.sizeBytes)
                Result.success(
                    UploadedSong(
                        publicUrl = url,
                        storagePath = "",
                        sizeBytes = file.sizeBytes
                    )
                )
            } catch (error: Exception) {
                Result.failure(error)
            }
        }

    /**
     * Anything the host will take: a PDF, a page, a picture the image host would
     * refuse. The caller is told the name and the type as well as the URL, so a
     * thread can draw a chip with the file's own name on it.
     */
    suspend fun uploadAttachment(context: Context, uri: Uri): Result<UploadedFile> =
        withContext(Dispatchers.IO) {
            val file = describe(context, uri, fallbackName = "attachment.pdf")
            if (isTooLarge(file.sizeBytes)) {
                return@withContext Result.failure(Exception("সংযুক্তি ২০০ এমবি-র বেশি হতে পারে না।"))
            }
            val name = withExtension(file.displayName, file.mimeType)
            try {
                val url = sendFile(context, uri, name, file.mimeType, file.sizeBytes)
                Result.success(
                    UploadedFile(
                        publicUrl = url,
                        displayName = name,
                        mimeType = file.mimeType,
                        sizeBytes = file.sizeBytes
                    )
                )
            } catch (error: Exception) {
                Result.failure(error)
            }
        }

    /** One multipart POST to the host, and the URL it answers with. */
    private fun sendFile(
        context: Context,
        uri: Uri,
        name: String,
        mimeType: String,
        sizeBytes: Long
    ): String {
        val part = UriUploadBody(
            context = context,
            uri = uri,
            contentType = mimeType.toMediaTypeOrNull(),
            declaredLength = sizeBytes
        )
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("reqtype", "fileupload")
            .addFormDataPart("fileToUpload", name, part)
            .build()
        val request = Request.Builder()
            .url(UPLOAD_ENDPOINT)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "text/plain")
            .post(body)
            .build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty().trim()
            if (!response.isSuccessful) throw IOException(uploadError(response.code, text))
            if (!text.startsWith("http")) throw IOException("আপলোড সার্ভার ঠিকানা দেয়নি।")
            return text.substringBefore('\n').trim()
        }
    }

    /** The host decides the type by the extension, so a file without one gets it. */
    private fun withExtension(name: String, mimeType: String): String {
        val clean = name.substringAfterLast('/').trim().ifBlank { "attachment" }
        if (clean.contains('.')) return clean
        return "$clean.${extensionFor(mimeType)}"
    }

    private fun extensionFor(mimeType: String): String = when (mimeType.lowercase()) {
        "application/pdf" -> "pdf"
        "image/png" -> "png"
        "image/webp" -> "webp"
        "image/gif" -> "gif"
        "image/heic", "image/heif" -> "heic"
        "text/plain" -> "txt"
        else -> if (mimeType.startsWith("image/")) "jpg" else "bin"
    }

    private fun uploadError(code: Int, body: String): String {
        val lower = body.lowercase()
        return when {
            code == 413 || lower.contains("too large") || lower.contains("size") ->
                "ফাইল ২০০ এমবি-র বেশি হতে পারে না।"
            code >= 500 -> "আপলোড সার্ভার এখন সাড়া দিচ্ছে না ($code)।"
            else -> "গান আপলোড যায়নি ($code)।"
        }
    }

    private fun mimeForName(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "wav" -> "audio/wav"
        "ogg", "opus" -> "audio/ogg"
        "m4a", "mp4" -> "audio/mp4"
        "aac" -> "audio/aac"
        "flac" -> "audio/flac"
        else -> "audio/mpeg"
    }

    /** Streams the picked file straight into the request instead of buffering it. */
    private class UriUploadBody(
        private val context: Context,
        private val uri: Uri,
        private val contentType: MediaType?,
        private val declaredLength: Long
    ) : RequestBody() {

        override fun contentType(): MediaType? = contentType

        override fun contentLength(): Long = declaredLength

        override fun writeTo(sink: BufferedSink) {
            val input = context.contentResolver.openInputStream(uri)
                ?: throw IOException("ফাইল খোলা যায়নি।")
            input.use { stream ->
                val buffer = ByteArray(BUFFER_BYTES)
                while (true) {
                    val read = stream.read(buffer)
                    if (read < 0) break
                    if (read > 0) sink.write(buffer, 0, read)
                }
            }
        }
    }
}
