package com.ningshingche.app.ui.components

import kotlinx.coroutines.CancellationException

/** Always finish the spinner, including on failure, cancellation or an exception. */
internal suspend fun <T> finishRegistrationPhotoUpload(
    upload: suspend () -> Result<T>,
    onSuccess: (T) -> Unit,
    onFailure: (Throwable) -> Unit,
    onFinish: () -> Unit
) {
    try {
        upload().onSuccess(onSuccess).onFailure(onFailure)
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Exception) {
        onFailure(error)
    } finally {
        onFinish()
    }
}
