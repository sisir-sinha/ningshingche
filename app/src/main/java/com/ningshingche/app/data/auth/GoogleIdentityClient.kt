package com.ningshingche.app.data.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException


data class GoogleIdTokenPayload(
    val idToken: String,
    val rawNonce: String
)

/**
 * Native Google account picker via Credential Manager.
 * Requests an ID token whose audience is the **Web** OAuth client ID so
 * Supabase Auth can verify it. No browser redirect or custom scheme is used.
 */
class GoogleIdentityClient(
    private val credentialManagerFactory: (Context) -> CredentialManager = { CredentialManager.create(it) }
) {

    suspend fun requestIdToken(activityContext: Context): Result<GoogleIdTokenPayload> {
        val (rawNonce, hashedNonce) = GoogleAuthMapper.newNoncePair()
        return try {
            val googleIdOption = GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(false)
                .setServerClientId(GoogleAuthConfig.WEB_CLIENT_ID)
                .setNonce(hashedNonce)
                .setAutoSelectEnabled(false)
                .build()

            val request = GetCredentialRequest.Builder()
                .addCredentialOption(googleIdOption)
                .build()

            val credentialManager = credentialManagerFactory(activityContext)
            val response = credentialManager.getCredential(
                context = activityContext,
                request = request
            )
            val credential = response.credential
            if (credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                val googleIdTokenCredential = GoogleIdTokenCredential.createFrom(credential.data)
                val idToken = googleIdTokenCredential.idToken
                if (idToken.isBlank()) {
                    Result.failure(GoogleAuthException.Failed("Google identity token was empty."))
                } else {
                    Result.success(GoogleIdTokenPayload(idToken = idToken, rawNonce = rawNonce))
                }
            } else {
                Result.failure(GoogleAuthException.Failed("Unexpected Google credential type."))
            }
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
            } else {
                Result.failure(GoogleAuthException.Failed("Google sign-in failed."))
            }
        }
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
