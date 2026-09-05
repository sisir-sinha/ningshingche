package com.ningshingche.app.data.auth

import android.content.Context
import com.ningshingche.app.data.remote.SupabaseClient
import com.ningshingche.app.data.remote.UserProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

class GoogleAuthRepository(
    private val supabaseClient: SupabaseClient,
    private val identityClient: GoogleIdentityClient = GoogleIdentityClient()
) {
    val currentUser: StateFlow<UserProfile?> = supabaseClient.currentUser

    private val signInMutex = Mutex()

    suspend fun signInWithGoogle(activityContext: Context): Result<UserProfile> {
        if (signInMutex.isLocked) {
            return Result.failure(GoogleAuthException.InProgress())
        }
        return signInMutex.withLock {
            try {
                val google = withTimeout(180_000L) {
                    withContext(Dispatchers.Main) {
                        identityClient.requestGoogleIdToken(activityContext)
                    }
                }
                val authResult = withTimeout(45_000L) {
                    supabaseClient.signInWithGoogleIdToken(
                        idToken = google.idToken,
                        rawNonce = google.rawNonce
                    )
                }
                authResult.onSuccess { profile ->
                    supabaseClient.upsertReaderProfile(profile)
                }
                authResult
            } catch (error: TimeoutCancellationException) {
                Result.failure(
                    GoogleAuthException.Failed("Google সাইন-ইন সময় শেষ হয়েছে। আবার চেষ্টা করুন।")
                )
            } catch (error: GoogleAuthException) {
                Result.failure(error)
            } catch (error: Exception) {
                Result.failure(mapFailure(error))
            }
        }
    }

    suspend fun signOut() {
        supabaseClient.signOutRemote()
    }

    private fun mapFailure(error: Throwable): GoogleAuthException {
        return when {
            GoogleAuthMapper.isCancellation(error) -> GoogleAuthException.Cancelled()
            GoogleAuthMapper.isNoAccount(error) -> GoogleAuthException.NoAccount()
            GoogleAuthMapper.isNetworkFailure(error) -> GoogleAuthException.Network()
            GoogleAuthMapper.isDeveloperConsoleError(error) ->
                GoogleAuthException.Failed(GoogleAuthMapper.DEVELOPER_CONSOLE_MESSAGE)
            else -> GoogleAuthException.Failed("Google sign-in failed.")
        }
    }
}
