package com.ningshingche.app.data.auth

import android.content.Context
import com.ningshingche.app.data.remote.SupabaseClient
import com.ningshingche.app.data.remote.UserProfile
import kotlinx.coroutines.flow.StateFlow
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Reader Google authentication: Credential Manager → Supabase Auth ID-token grant
 * → upsert `profiles` → persisted session.
 *
 * CMS email/password login stays on [SupabaseClient.signIn] and is not replaced.
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
            val tokenResult = identityClient.requestIdToken(activityContext)
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
