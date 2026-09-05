package com.ningshingche.app.data.auth

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.SystemClock
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

data class GoogleIdTokenResult(
    val idToken: String,
    val rawNonce: String
)

/**
 * Explicit "Continue with Google" uses [GetSignInWithGoogleOption] (account
 * picker). [GetGoogleIdOption] is a fallback for devices where the button
 * flow is unavailable. Credential Manager requires a started [Activity].
 */
class GoogleIdentityClient {

    suspend fun requestGoogleIdToken(context: Context): GoogleIdTokenResult {
        val activity = context.findActivity()
            ?: throw GoogleAuthException.Failed(
                "Google সাইন-ইন খোলার জন্য অ্যাপ স্ক্রিন প্রয়োজন। আবার চেষ্টা করুন।"
            )
        if (activity.isFinishing || activity.isDestroyed) {
            throw GoogleAuthException.Failed(
                "Google সাইন-ইন খোলার জন্য অ্যাপ স্ক্রিন প্রয়োজন। আবার চেষ্টা করুন।"
            )
        }

        val manager = CredentialManager.create(activity)
        val (rawNonce, hashedNonce) = GoogleAuthMapper.newNoncePair()
        val attempts = listOf(
            Attempt("siwg-nonce") { signInWithGoogleRequest(hashedNonce) },
            Attempt("siwg") { signInWithGoogleRequest(nonce = null) },
            Attempt("onetap-nonce") { oneTapRequest(hashedNonce) },
            Attempt("onetap") { oneTapRequest(nonce = null) }
        )

        var lastError: Throwable? = null
        for ((index, attempt) in attempts.withIndex()) {
            val started = SystemClock.elapsedRealtime()
            try {
                val result = requestOnce(manager, activity, attempt.build(), rawNonce)
                Log.i(TAG, "Google ID token via ${attempt.name}")
                return result
            } catch (error: Throwable) {
                val elapsed = SystemClock.elapsedRealtime() - started
                lastError = error
                Log.w(TAG, "Google credential ${attempt.name} failed (${error.javaClass.simpleName})")
                if (shouldStopFallbacks(error, elapsed, isFirst = index == 0)) {
                    throw mapError(error)
                }
            }
        }
        throw mapError(lastError ?: GoogleAuthException.Failed("Google sign-in failed."))
    }

    private suspend fun requestOnce(
        manager: CredentialManager,
        activity: Activity,
        request: GetCredentialRequest,
        rawNonce: String
    ): GoogleIdTokenResult {
        val response = manager.getCredential(context = activity, request = request)
        val googleCredential = GoogleIdTokenCredential.createFrom(response.credential.data)
        val idToken = googleCredential.idToken
        if (idToken.isBlank()) {
            throw GoogleAuthException.Failed("Google sign-in failed.")
        }
        val nonceForSupabase = GoogleAuthMapper.supabaseNonce(idToken, rawNonce)
        return GoogleIdTokenResult(idToken = idToken, rawNonce = nonceForSupabase)
    }

    private fun signInWithGoogleRequest(nonce: String?): GetCredentialRequest {
        val option = GetSignInWithGoogleOption.Builder(GoogleAuthConfig.WEB_CLIENT_ID)
            .apply { if (!nonce.isNullOrBlank()) setNonce(nonce) }
            .build()
        return GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build()
    }

    private fun oneTapRequest(nonce: String?): GetCredentialRequest {
        val option = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .setServerClientId(GoogleAuthConfig.WEB_CLIENT_ID)
            .apply { if (!nonce.isNullOrBlank()) setNonce(nonce) }
            .build()
        return GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build()
    }

    private fun shouldStopFallbacks(error: Throwable, elapsedMs: Long, isFirst: Boolean): Boolean {
        if (GoogleAuthMapper.isDeveloperConsoleError(error)) return true
        if (error is GoogleAuthException.Failed &&
            GoogleAuthMapper.isDeveloperConsoleError(Exception(error.message))
        ) {
            return true
        }
        val cancelled = GoogleAuthMapper.isCancellation(error) ||
            error is GetCredentialCancellationException
        if (cancelled && elapsedMs >= USER_CANCEL_MS && isFirst) return true
        return false
    }

    private fun mapError(error: Throwable): GoogleAuthException {
        if (error is GoogleAuthException) return error
        return when {
            GoogleAuthMapper.isCancellation(error) || error is GetCredentialCancellationException ->
                GoogleAuthException.Cancelled()
            error is NoCredentialException || GoogleAuthMapper.isNoAccount(error) ->
                GoogleAuthException.NoAccount()
            GoogleAuthMapper.isDeveloperConsoleError(error) ->
                GoogleAuthException.Failed(GoogleAuthMapper.DEVELOPER_CONSOLE_MESSAGE)
            GoogleAuthMapper.isNetworkFailure(error) ->
                GoogleAuthException.Network()
            error is GetCredentialException ->
                GoogleAuthException.Failed("Google sign-in failed.")
            else -> GoogleAuthException.Failed("Google sign-in failed.")
        }
    }

    private data class Attempt(
        val name: String,
        val build: () -> GetCredentialRequest
    )

    companion object {
        private const val TAG = "NingshingCheAuth"
        private const val USER_CANCEL_MS = 800L
    }
}

internal fun Context.findActivity(): Activity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}
