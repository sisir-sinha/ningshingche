package com.ningshingche.app.data.remote

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Best-effort ImgBB for small files, then the existing document host. */
object BookPdfUploader {
    private val http = OkHttpClient.Builder().connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS).writeTimeout(10, TimeUnit.MINUTES).build()

    private fun isPdf(context: Context, uri: Uri): Boolean =
        context.contentResolver.openInputStream(uri)?.use { BookPdfPolicy.hasPdfSignature(it) } ?: false

    // Size metadata can be absent or wrong. Scan up to the threshold, not the
    // whole large document, before deciding which host to try.
    private fun isSmallerThanThreshold(context: Context, uri: Uri): Boolean =
        context.contentResolver.openInputStream(uri)?.use { BookPdfPolicy.belowImgBbThreshold(it) } ?: false

    private fun isHostedPdf(url: String): Boolean {
        val parsed = url.toHttpUrlOrNull() ?: return false
        if (parsed.scheme != "https" || parsed.host !in setOf("upload.satoru.click", "i.ibb.co")) return false
        return try {
            http.newCall(Request.Builder().url(url).header("Range", "bytes=0-4").get().build()).execute().use { response ->
                if (!response.isSuccessful) return@use false
                val input = response.body?.byteStream() ?: return@use false
                BookPdfPolicy.hasPdfSignature(input)
            }
        } catch (_: IOException) { false }
    }

    private fun tryImgBb(context: Context, uri: Uri): String? {
        val key = SupabaseConfig.imgbbApiKey
        if (key.isBlank() || key.startsWith("MY_")) return null
        val file = object : RequestBody() {
            override fun contentType() = "application/pdf".toMediaType()
            override fun writeTo(sink: BufferedSink) {
                val input = context.contentResolver.openInputStream(uri) ?: throw IOException("Cannot open PDF")
                input.use { stream ->
                    val bytes = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val n = stream.read(bytes)
                        if (n < 0) break
                        total += n
                        if (total >= BookPdfPolicy.IMGBB_THRESHOLD) throw IOException("PDF grew beyond ImgBB threshold")
                        sink.write(bytes, 0, n)
                    }
                }
            }
        }
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("key", key).addFormDataPart("image", "book.pdf", file).build()
        return try {
            http.newCall(Request.Builder().url(SupabaseConfig.imgbbUploadUrl).post(body).build()).execute().use { response ->
                if (!response.isSuccessful) return@use null
                val json = JSONObject(response.body?.string().orEmpty())
                val url = json.optJSONObject("data")?.optString("url").orEmpty()
                url.takeIf { it.isNotBlank() && isHostedPdf(it) }
            }
        } catch (_: Exception) { null }
    }

    suspend fun upload(context: Context, uri: Uri): Result<SatoruUploadClient.UploadedFile> = withContext(Dispatchers.IO) {
        try {
            if (!isPdf(context, uri)) return@withContext Result.failure(IllegalArgumentException("শুধু বৈধ PDF ফাইল নির্বাচন করুন।"))
            val info = SatoruUploadClient.describe(context, uri, "book.pdf")
            if (isSmallerThanThreshold(context, uri)) {
                val url = tryImgBb(context, uri)
                if (url != null) return@withContext Result.success(SatoruUploadClient.UploadedFile(url, info.displayName, "application/pdf", info.sizeBytes))
            }
            val uploaded = SatoruUploadClient.uploadBookPdf(context, uri).getOrThrow()
            if (!isHostedPdf(uploaded.publicUrl)) throw IOException("আপলোড করা PDF যাচাই করা যায়নি।")
            Result.success(uploaded)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { Result.failure(e) }
    }
}
