package com.ningshingche.app.data.auth

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.credentials.Credential
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException

data class GoogleIdTokenPayload(
    val idToken: String,
    val rawNonce: String
)

fun Context.findActivity(): Activity? {
    var current: Context = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}

/**
 * Native Google account picker via Credential Manager.
 *
 * Explicit "Continue with Google" uses [GetSignInWithGoogleOption] (account
 * chooser). [GetGoogleIdOption] (One Tap) is a fallback only — it often
 * reports "no credentials" even when a Google account is on the device.
 */
class GoogleIdentityClient(
    private val credentialManagerFactory: (Context) -> CredentialManager = { CredentialManager.create(it) }
) {

    suspend fun requestIdToken(activityContext: Context): Result<GoogleIdTokenPayload> {
        val activity = activityContext.findActivity()
            ?: return Result.failure(
                GoogleAuthException.Failed("Google sign-in must be started from the app screen.")
            )
        val (rawNonce, hashedNonce) = GoogleAuthMapper.newNoncePair()
        val manager = credentialManagerFactory(activity)

        val buttonResult = request(
            manager = manager,
            activity = activity,
            request = GetCredentialRequest.Builder()
                .addCredentialOption(
                    GetSignInWithGoogleOption.Builder(GoogleAuthConfig.WEB_CLIENT_ID)
                        .setNonce(hashedNonce)
                        .build()
                )
                .build(),
            rawNonce = rawNonce
        )
        if (buttonResult.isSuccess) return buttonResult
        val buttonError = buttonResult.exceptionOrNull()
        if (buttonError is GoogleAuthException.Cancelled) return buttonResult
        if (buttonError is GoogleAuthException.Network) return buttonResult

        val oneTapResult = request(
            manager = manager,
            activity = activity,
            request = GetCredentialRequest.Builder()
                .addCredentialOption(
                    GetGoogleIdOption.Builder()
                        .setFilterByAuthorizedAccounts(false)
                        .setServerClientId(GoogleAuthConfig.WEB_CLIENT_ID)
                        .setNonce(hashedNonce)
                        .setAutoSelectEnabled(false)
                        .build()
                )
                .build(),
            rawNonce = rawNonce
        )
        if (oneTapResult.isSuccess) return oneTapResult

        val oneTapError = oneTapResult.exceptionOrNull()
        return when {
            oneTapError is GoogleAuthException.Cancelled -> oneTapResult
            buttonError is GoogleAuthException.NoAccount ||
                oneTapError is GoogleAuthException.NoAccount ->
                Result.failure(GoogleAuthException.NoAccount())
            else -> Result.failure(
                GoogleAuthException.Failed("Google sign-in failed.")
            )
        }
    }

    private suspend fun request(
        manager: CredentialManager,
        activity: Activity,
        request: GetCredentialRequest,
        rawNonce: String
    ): Result<GoogleIdTokenPayload> {
        return try {
            val response = manager.getCredential(context = activity, request = request)
            parseCredential(response.credential, rawNonce)
        } catch (cancelled: GetCredentialCancellationException) {
            Result.failure(GoogleAuthException.Cancelled())
        } catch (missing: NoCredentialException) {
            Result.failure(GoogleAuthException.NoAccount())
        } catch (_: GoogleIdTokenParsingException) {
            Result.failure(GoogleAuthException.Failed("Google identity token could not be read."))
        } catch (error: GetCredentialException) {
            Result.failure(mapCredentialError(error))
        } catch (error: Throwable) {
            if (GoogleAuthMapper.isNetworkFailure(error)) {
                Result.failure(GoogleAuthException.Network())
            } else if (GoogleAuthMapper.isCancellation(error)) {
                Result.failure(GoogleAuthException.Cancelled())
            } else if (GoogleAuthMapper.isNoAccount(error)) {
                Result.failure(GoogleAuthException.NoAccount())
            } else {
                Result.failure(GoogleAuthException.Failed("Google sign-in failed."))
            }
        }
    }

    private fun parseCredential(credential: Credential, rawNonce: String): Result<GoogleIdTokenPayload> {
        if (credential is CustomCredential &&
            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        ) {
            val googleIdTokenCredential = GoogleIdTokenCredential.createFrom(credential.data)
            val idToken = googleIdTokenCredential.idToken
            return if (idToken.isBlank()) {
                Result.failure(GoogleAuthException.Failed("Google identity token was empty."))
            } else {
                Result.success(GoogleIdTokenPayload(idToken = idToken, rawNonce = rawNonce))
            }
        }
        return Result.failure(GoogleAuthException.Failed("Unexpected Google credential type."))
    }

    private fun mapCredentialError(error: GetCredentialException): GoogleAuthException {
        return when {
            GoogleAuthMapper.isCancellation(error) -> GoogleAuthException.Cancelled()
            GoogleAuthMapper.isNoAccount(error) -> GoogleAuthException.NoAccount()
            GoogleAuthMapper.isNetworkFailure(error) -> GoogleAuthException.Network()
            else -> GoogleAuthException.Failed("Google sign-in failed.")
        }
    }
}
