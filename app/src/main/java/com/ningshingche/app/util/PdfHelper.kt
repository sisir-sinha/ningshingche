package com.ningshingche.app.util

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.ningshingche.app.data.model.PdfDocument as NinghsingPdfDocument
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit

object PdfHelper {

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()


    suspend fun downloadPdfFile(context: Context, doc: NinghsingPdfDocument): File = withContext(Dispatchers.IO) {
        val cacheDir = File(context.cacheDir, "pdf_cache").apply { mkdirs() }
        val targetFile = File(cacheDir, "${doc.id}_${doc.year}.pdf")
        if (targetFile.exists() && targetFile.length() > 2048 && looksLikePdf(targetFile)) {
            return@withContext targetFile
        }
        if (targetFile.exists()) targetFile.delete()

        val url = doc.pdfUrl.ifBlank { doc.downloadUrl }
        if (url.isBlank()) throw IOException("পিডিএফ লিংক পাওয়া যায়নি।")

        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "NingshingCheApp/1.0")
            .header("Accept", "application/pdf,*/*")
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("পিডিএফ ডাউনলোড হয়নি (${response.code})")
            }
            val body = response.body ?: throw IOException("পিডিএফ খালি এসেছে।")
            FileOutputStream(targetFile).use { output ->
                body.byteStream().copyTo(output)
            }
        }
        if (!looksLikePdf(targetFile)) {
            targetFile.delete()
            throw IOException("ফাইলটি একটি বৈধ পিডিএফ নয়।")
        }
        targetFile
    }


    private fun looksLikePdf(file: File): Boolean {
        if (!file.exists() || file.length() < 8) return false
        return try {
            FileInputStream(file).use { input ->
                val header = ByteArray(5)
                if (input.read(header) < 5) return false
                header.decodeToString() == "%PDF-"
            }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun savePdfToDownloads(context: Context, doc: NinghsingPdfDocument): Result<String> = withContext(Dispatchers.IO) {
        try {
            val sourceFile = downloadPdfFile(context, doc)
            val targetFileName = "${doc.title.replace(" ", "_")}_v${doc.year}.pdf"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val contentValues = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, targetFileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Ningshingche_PDFs")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }

                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                    ?: resolver.insert(MediaStore.Files.getContentUri("external"), contentValues)

                if (uri != null) {
                    resolver.openOutputStream(uri).use { outStream ->
                        if (outStream == null) throw IOException("Failed to open output stream")
                        FileInputStream(sourceFile).use { inStream ->
                            inStream.copyTo(outStream)
                        }
                    }

                    contentValues.clear()
                    contentValues.put(MediaStore.MediaColumns.IS_PENDING, 0)
                    resolver.update(uri, contentValues, null, null)

                    return@withContext Result.success("Downloads/Ningshingche_PDFs/$targetFileName ফোল্ডারে সংরক্ষিত হয়েছে!")
                }
            }

            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val destDir = File(downloadsDir, "Ningshingche_PDFs").apply { mkdirs() }
            val destFile = File(destDir, targetFileName)

            FileInputStream(sourceFile).use { inStream ->
                FileOutputStream(destFile).use { outStream ->
                    inStream.copyTo(outStream)
                }
            }

            Result.success("ডাউনলোড ফোল্ডারে সংরক্ষিত হয়েছে: ${destFile.name}")
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun sharePdfFile(context: Context, doc: NinghsingPdfDocument, file: File): Boolean {
        return try {
            val pdfUri: Uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.provider",
                file
            )

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, pdfUri)
                putExtra(Intent.EXTRA_SUBJECT, "${doc.title} — নিংশিং চে PDF আর্কাইভ")
                putExtra(
                    Intent.EXTRA_TEXT,
                    "${doc.title} (${doc.edition}) — বিষ্ণুপ্রিয়া মণিপুরি ডিজিটাল তথ্যকোষ 'নিংশিং চে' থেকে সংগৃহীত। https://ningshingche.com"
                )
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            val chooser = Intent.createChooser(shareIntent, "PDF প্রকাশনা শেয়ার করুন")
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(chooser)
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    fun openInExternalApp(context: Context, file: File): Boolean {
        return try {
            val pdfUri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.provider",
                file
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(pdfUri, "application/pdf")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(Intent.createChooser(intent, "পিডিএফ খুলুন"))
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }
}

/** Thread-safe on-demand page renderer. Close when the viewer leaves. */
class PdfSession(file: File) : AutoCloseable {
    private val lock = Any()
    private val pfd: ParcelFileDescriptor =
        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer: PdfRenderer = PdfRenderer(pfd)
    val pageCount: Int = renderer.pageCount

    fun render(pageIndex: Int, widthPx: Int): Bitmap {
        synchronized(lock) {
            val page = renderer.openPage(pageIndex)
            try {
                val targetWidth = widthPx.coerceIn(320, 2400)
                val targetHeight = ((page.height.toFloat() / page.width) * targetWidth)
                    .toInt()
                    .coerceAtLeast(1)
                val bitmap = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
                Canvas(bitmap).drawColor(Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                return bitmap
            } finally {
                page.close()
            }
        }
    }

    override fun close() {
        synchronized(lock) {
            runCatching { renderer.close() }
            runCatching { pfd.close() }
        }
    }
}
