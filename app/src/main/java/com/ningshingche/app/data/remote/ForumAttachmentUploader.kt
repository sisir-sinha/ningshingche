package com.ningshingche.app.data.remote

import android.content.Context
import android.net.Uri
import com.ningshingche.app.data.portal.ForumAttachment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The forum's attachments: five files at most, pictures and PDFs only.
 *
 * A picture goes to ImgBB, which is where the app's pictures already go and
 * which has a delete link the poster may want later; a PDF goes to the same
 * Catbox-compatible host the music uploader uses, because ImgBB takes images and
 * nothing else. Either way the app is handed back one [ForumAttachment] — a URL,
 * a name, a type — and never a raw string, so a document keeps its name all the
 * way to the chip on the thread.
 *
 * The limits are the owner's: five files, pictures and PDFs. A file of any other
 * kind is refused here rather than uploaded and refused there, and the refusal
 * is in Bengali because the reader is the one who has to pick again.
 */
object ForumAttachmentUploader {

    /** How many files one post may carry. */
    const val MAX_FILES = 5

    const val MIME_PDF = "application/pdf"

    /** What the system picker offers: pictures and PDFs, and nothing else. */
    val PICKER_TYPES = arrayOf("image/*", MIME_PDF)

    /** A picture larger than this is refused before it is read into memory. */
    private const val MAX_IMAGE_BYTES = 32L * 1024 * 1024

    /** The document host's own ceiling. */
    private const val MAX_DOCUMENT_BYTES = SatoruUploadClient.MAX_BYTES

    fun isSupported(mimeType: String, name: String): Boolean {
        val mime = mimeType.lowercase()
        if (mime.startsWith("image/")) return true
        if (mime == MIME_PDF) return true
        // Some providers answer with the generic type for a PDF; the name decides.
        return name.trim().lowercase().endsWith(".pdf") && (mime.isBlank() || mime == "application/octet-stream")
    }

    /** Where the picker's answer goes. Never throws: the caller shows the message. */
    suspend fun upload(context: Context, uri: Uri, index: Int): Result<ForumAttachment> =
        withContext(Dispatchers.IO) {
            val file = SatoruUploadClient.describe(context, uri, fallbackName = "attachment")
            val name = file.displayName
            val mime = file.mimeType
            if (!isSupported(mime, name)) {
                return@withContext Result.failure(
                    IllegalArgumentException("শুধু ছবি ও পিডিএফ ফাইল যুক্ত করা যাবে।")
                )
            }
            val isPdf = isSupportedPdf(mime, name)
            if (isPdf && file.sizeBytes > MAX_DOCUMENT_BYTES) {
                return@withContext Result.failure(
                    IllegalArgumentException("পিডিএফ ২০০ এমবি-র বেশি হতে পারে না।")
                )
            }
            if (!isPdf && file.sizeBytes > MAX_IMAGE_BYTES) {
                return@withContext Result.failure(
                    IllegalArgumentException("ছবির আকার ৩২ মেগাবাইটের বেশি হতে পারে না।")
                )
            }
            val stamp = System.currentTimeMillis()
            if (isPdf) {
                SatoruUploadClient.uploadAttachment(context, uri).mapCatching { uploaded ->
                    ForumAttachment(
                        url = uploaded.publicUrl,
                        name = uploaded.displayName.ifBlank { name },
                        mimeType = MIME_PDF,
                        sizeBytes = uploaded.sizeBytes
                    )
                }
            } else {
                ImgBbUploader.uploadFromUri(context, uri, "forum_attach_${index}_$stamp")
                    .mapCatching { image ->
                        val url = image.displayUrl.ifBlank { image.url }
                        if (url.isBlank()) throw IllegalStateException("ছবির ঠিকানা পাওয়া যায়নি।")
                        ForumAttachment(
                            url = url,
                            name = name,
                            mimeType = mime.ifBlank { "image/jpeg" },
                            sizeBytes = file.sizeBytes
                        )
                    }
            }
        }

    private fun isSupportedPdf(mimeType: String, name: String): Boolean =
        mimeType.equals(MIME_PDF, ignoreCase = true) || name.trim().lowercase().endsWith(".pdf")

    /** True when another file may still be added. */
    fun canAdd(current: Int): Boolean = current < MAX_FILES

    /** How many of the picked files a post can still take. */
    fun roomLeft(current: Int): Int = (MAX_FILES - current).coerceAtLeast(0)
}
