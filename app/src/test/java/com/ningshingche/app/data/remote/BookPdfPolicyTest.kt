package com.ningshingche.app.data.remote

import java.io.ByteArrayInputStream
import java.io.InputStream
import org.junit.Assert.*
import org.junit.Test

class BookPdfPolicyTest {
    private fun sized(n: Long) = object : InputStream() {
        var left = n
        override fun read(): Int { if (left <= 0) return -1; left--; return 0 }
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (left <= 0) return -1
            val count = minOf(left, len.toLong()).toInt(); left -= count; return count
        }
    }
    @Test fun recognizesPdfSignatureNotExtension() {
        assertTrue(BookPdfPolicy.hasPdfSignature(ByteArrayInputStream("%PDF-1.7".toByteArray())))
        assertFalse(BookPdfPolicy.hasPdfSignature(ByteArrayInputStream("PNG".toByteArray())))
        assertFalse(BookPdfPolicy.hasPdfSignature(ByteArrayInputStream("%PDF".toByteArray())))
    }
    @Test fun strictThresholdAndLargeStreams() {
        val limit = BookPdfPolicy.IMGBB_THRESHOLD
        assertTrue(BookPdfPolicy.belowImgBbThreshold(sized(limit - 1)))
        assertFalse(BookPdfPolicy.belowImgBbThreshold(sized(limit)))
        assertFalse(BookPdfPolicy.belowImgBbThreshold(sized(limit + 200_000_000)))
    }
    @Test fun failsForAStreamThatMakesNoProgress() {
        val stuck = object : InputStream() {
            override fun read(): Int = 0
            override fun read(b: ByteArray, off: Int, len: Int): Int = 0
        }
        assertTrue(runCatching { BookPdfPolicy.belowImgBbThreshold(stuck) }.isFailure)
    }
}
