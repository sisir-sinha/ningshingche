package com.ningshingche.app.data.remote

import java.io.InputStream

internal object BookPdfPolicy {
    const val IMGBB_THRESHOLD = 25L * 1024 * 1024
    private val signature = "%PDF-".toByteArray(Charsets.US_ASCII)

    fun hasPdfSignature(input: InputStream): Boolean {
        val header = ByteArray(signature.size)
        var n = 0
        while (n < header.size) {
            val read = input.read(header, n, header.size - n)
            if (read <= 0) break
            n += read
        }
        return n == signature.size && header.contentEquals(signature)
    }

    /** Stops at the threshold even for large streams; equality uses Satoru. */
    fun belowImgBbThreshold(input: InputStream): Boolean {
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (total < IMGBB_THRESHOLD) {
            val n = input.read(buffer, 0, minOf(buffer.size.toLong(), IMGBB_THRESHOLD - total).toInt())
            if (n < 0) return true
            if (n == 0) throw java.io.IOException("Could not read PDF size")
            total += n
        }
        return false
    }
}
