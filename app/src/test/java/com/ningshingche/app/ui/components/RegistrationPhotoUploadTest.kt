package com.ningshingche.app.ui.components

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class RegistrationPhotoUploadTest {
    @Test fun successFinishesAndReturnsTheUploadedPhoto() = runBlocking {
        var loading = true
        var image = ""
        var error: Throwable? = null
        finishRegistrationPhotoUpload(
            upload = { Result.success("photo-url") },
            onSuccess = { image = it }, onFailure = { error = it }, onFinish = { loading = false }
        )
        assertEquals("photo-url", image)
        assertNull(error)
        assertFalse(loading)
    }

    @Test fun failureDoesNotReplacePreviousPhotoAndStopsLoading() = runBlocking {
        var loading = true
        var image = "previous-url"
        var error: Throwable? = null
        finishRegistrationPhotoUpload(
            upload = { Result.failure<String>(IllegalStateException("offline")) },
            onSuccess = { image = it }, onFailure = { error = it }, onFinish = { loading = false }
        )
        assertEquals("previous-url", image)
        assertEquals("offline", error?.message)
        assertFalse(loading)
    }

    @Test fun thrownFailureAndCancellationBothStopLoading() = runBlocking {
        var loading = true
        var error: Throwable? = null
        finishRegistrationPhotoUpload<String>(
            upload = { throw IllegalStateException("failed") },
            onSuccess = {}, onFailure = { error = it }, onFinish = { loading = false }
        )
        assertEquals("failed", error?.message)
        assertFalse(loading)
        loading = true
        try {
            finishRegistrationPhotoUpload<String>(
                upload = { throw CancellationException("cancelled") },
                onSuccess = {}, onFailure = { fail("cancellation is not a user-facing error") },
                onFinish = { loading = false }
            )
            fail("cancellation must propagate")
        } catch (_: CancellationException) {
            assertFalse(loading)
        }
    }
}
