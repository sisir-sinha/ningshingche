package com.ningshingche.app.data.auth

import android.content.Context
import com.ningshingche.app.data.remote.SupabaseClient
import com.ningshingche.app.data.remote.UserProfile
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withTimeout
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Reader Google authentication: Credential Manager (Sign in with Google) →
 * Supabase Auth ID-token grant → upsert `profiles` → persisted session.
 */
class GoogleAuthRepository(
    private val supabaseClient: SupabaseClient,
    private val identityClient: GoogleIdentityClient = GoogleIdentityClient()
) {

    val currentUser: StateFlow<UserProfile?> = supabaseClient.currentUser

    private val inProgress = AtomicBoolean(false)

    suspend fun signInWithGoogle(activityContext: Context): Result<UserProfile> {
        if (!inProgress.compareAndSet(false, true)) {
            return Result.failure(GoogleAuthException.InProgress())
        }
        return try {
            val tokenResult = try {
                withTimeout(90_000) {
                    identityClient.requestIdToken(activityContext)
                }
            } catch (_: TimeoutCancellationException) {
                Result.failure(GoogleAuthException.Failed("Google sign-in timed out. Try again."))
            }
            val payload = tokenResult.getOrElse { return Result.failure(it) }
            val authResult = supabaseClient.signInWithGoogleIdToken(
                idToken = payload.idToken,
                rawNonce = payload.rawNonce
            )
            authResult.onSuccess { profile ->
                supabaseClient.upsertReaderProfile(profile)
            }
            authResult
        } finally {
            inProgress.set(false)
        }
    }

    suspend fun signOut() {
        supabaseClient.signOutRemote()
    }

    fun signOutLocal() {
        supabaseClient.signOut()
    }
}
