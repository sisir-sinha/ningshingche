package com.ningshingche.app.data.auth

import com.ningshingche.app.data.remote.UserProfile
import com.ningshingche.app.data.remote.UserRole
import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import kotlinx.coroutines.TimeoutCancellationException

sealed class GoogleAuthException(message: String) : Exception(message) {
    class Cancelled : GoogleAuthException("cancelled")
    class NoAccount : GoogleAuthException("no_google_account")
    class Network : GoogleAuthException("network")
    class InProgress : GoogleAuthException("in_progress")
    class Failed(message: String) : GoogleAuthException(message)
}

object GoogleAuthMapper {

    fun sha256Hex(raw: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(raw.toByteArray(Charsets.UTF_8))
        return digest.joinToString(separator = "") { byte -> "%02x".format(byte) }
    }

    fun newNoncePair(): Pair<String, String> {
        val raw = UUID.randomUUID().toString()
        return raw to sha256Hex(raw)
    }

    /**
     * Supabase hashes the nonce we send and compares it to the ID-token claim.
     * Send the raw nonce only when Google stored our SHA-256 hex in the token.
     * If Google omitted the claim (common on some Play services builds), send
     * nothing — a nonce in the request with none in the token is rejected.
     */
    fun supabaseNonce(idToken: String, rawNonce: String): String {
        if (rawNonce.isBlank() || idToken.isBlank()) return ""
        val claim = idTokenNonceClaim(idToken) ?: return ""
        if (claim.isBlank()) return ""
        val hashed = sha256Hex(rawNonce)
        return if (claim.equals(hashed, ignoreCase = true)) rawNonce else ""
    }

    fun idTokenNonceClaim(idToken: String): String? {
        val parts = idToken.split('.')
        if (parts.size < 2) return null
        return try {
            val payload = parts[1]
            val padded = payload + "=".repeat((4 - payload.length % 4) % 4)
            val decoded = Base64.getUrlDecoder().decode(padded)
            val json = JSONObject(String(decoded, Charsets.UTF_8))
            if (!json.has("nonce")) null else json.optString("nonce")
        } catch (_: Exception) {
            null
        }
    }

    fun isNonceAuthError(error: Throwable): Boolean {
        val message = error.message.orEmpty().lowercase()
        return message.contains("nonce")
    }

    fun isDeveloperConsoleError(error: Throwable): Boolean {
        val message = error.message.orEmpty()
        return message.contains("28444") ||
            message.contains("Developer console is not set up correctly", ignoreCase = true)
    }

    const val DEVELOPER_CONSOLE_MESSAGE =
        "Google কনসোলে এই অ্যাপের প্যাকেজ নাম (com.ningshingche.app) ও সাইনিং SHA-1 মিলছে না। Debug ও Release দুই SHA-1 Android OAuth ক্লায়েন্টে যোগ করুন।"

    fun isSupabaseJwt(token: String?): Boolean {
        if (token.isNullOrBlank()) return false
        if (token.count { it == '.' } < 2 || token.length <= 40) return false
        val payload = jwtPayload(token) ?: return true
        val iss = payload.optString("iss")
        if (iss.contains("accounts.google.com", ignoreCase = true) ||
            iss.contains("google", ignoreCase = true)
        ) {
            return false
        }
        val role = payload.optString("role")
        val aud = payload.optString("aud")
        return role == "authenticated" ||
            aud == "authenticated" ||
            iss.contains("supabase", ignoreCase = true)
    }

    fun jwtPayload(token: String): JSONObject? {
        return try {
            val payload = token.split('.').getOrNull(1) ?: return null
            val padded = payload + "=".repeat((4 - payload.length % 4) % 4)
            val decoded = android.util.Base64.decode(
                padded,
                android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP
            )
            JSONObject(String(decoded, Charsets.UTF_8))
        } catch (_: Exception) {
            null
        }
    }

    fun sessionExpiredMessage(): String =
        "সেশন শেষ হয়েছে। Google দিয়ে আবার সাইন ইন করে গান আপলোড করুন।"

    fun userFacingJwtError(raw: String?): String? {
        val text = raw.orEmpty()
        if (text.contains("exp claim", ignoreCase = true) ||
            text.contains("iat claim", ignoreCase = true) ||
            text.contains("nbf claim", ignoreCase = true) ||
            text.contains("invalid JWT", ignoreCase = true) ||
            text.contains("jwt expired", ignoreCase = true)
        ) {
            return sessionExpiredMessage()
        }
        return null
    }

    fun profileFromAuthUser(user: JSONObject): UserProfile {
        val metadata = user.optJSONObject("user_metadata") ?: JSONObject()
        val email = firstNonBlank(
            user.optString("email"),
            metadata.optString("email")
        )
        val fullName = firstNonBlank(
            metadata.optString("full_name"),
            metadata.optString("name"),
            email.substringBefore("@")
        ).ifBlank { "পাঠক" }
        val split = splitDisplayName(fullName)
        val firstName = firstNonBlank(metadata.optString("given_name"), split.first)
        val lastName = firstNonBlank(metadata.optString("family_name"), split.second)
        val avatarUrl = firstNonBlank(
            metadata.optString("avatar_url"),
            metadata.optString("picture")
        )
        val id = user.optString("id").ifBlank { UUID.randomUUID().toString() }
        return UserProfile(
            id = id,
            email = email,
            fullName = fullName,
            role = UserRole.AUTHOR,
            avatarUrl = avatarUrl,
            createdAt = user.optString("created_at", ""),
            updatedAt = user.optString("updated_at", ""),
            authProvider = GoogleAuthConfig.PROVIDER_GOOGLE,
            firstName = firstName,
            lastName = lastName
        )
    }

    fun splitDisplayName(fullName: String): Pair<String, String> {
        val trimmed = fullName.trim()
        if (trimmed.isBlank()) return "" to ""
        val parts = trimmed.split(Regex("\\s+"), limit = 2)
        return parts[0] to parts.getOrNull(1).orEmpty()
    }

    fun firstNonBlank(vararg values: String?): String {
        for (value in values) {
            val trimmed = value?.trim().orEmpty()
            if (trimmed.isNotBlank() && trimmed != "null") return trimmed
        }
        return ""
    }

    fun isCancellation(error: Throwable): Boolean {
        if (error is GoogleAuthException.Cancelled) return true
        // TimeoutCancellationException's class name contains "Cancellation" but
        // it is not the user dismissing the account picker.
        if (error is TimeoutCancellationException) return false
        val name = error::class.java.name
        val message = error.message.orEmpty()
        if (name.contains("TimeoutCancellation", ignoreCase = true)) return false
        return name.contains("GetCredentialCancellation", ignoreCase = true) ||
            (name.contains("CancellationException", ignoreCase = true) &&
                message.contains("cancel", ignoreCase = true) &&
                !message.contains("timed out", ignoreCase = true)) ||
            message.contains("User cancelled the selector", ignoreCase = true) ||
            message.contains("activity is cancelled by the user", ignoreCase = true)
    }

    fun isNoAccount(error: Throwable): Boolean {
        if (error is GoogleAuthException.NoAccount) return true
        val name = error::class.java.name
        val message = error.message.orEmpty()
        return name.contains("NoCredential", ignoreCase = true) ||
            message.contains("No credentials", ignoreCase = true)
    }

    fun isNetworkFailure(error: Throwable): Boolean {
        if (error is GoogleAuthException.Network) return true
        var current: Throwable? = error
        while (current != null) {
            if (current is UnknownHostException ||
                current is ConnectException ||
                current is SocketTimeoutException
            ) {
                return true
            }
            if (current is IOException) {
                val message = current.message.orEmpty().lowercase()
                if (message.contains("unable to resolve host") ||
                    message.contains("failed to connect") ||
                    message.contains("network") ||
                    message.contains("timeout")
                ) {
                    return true
                }
            }
            current = current.cause
        }
        return false
    }

    fun userMessage(error: Throwable): String {
        return when {
            isCancellation(error) -> ""
            error is GoogleAuthException.InProgress -> ""
            isNoAccount(error) ->
                "এই ডিভাইসে কোনো Google অ্যাকাউন্ট পাওয়া যায়নি। একটি Google অ্যাকাউন্ট যোগ করে আবার চেষ্টা করুন।"
            isNetworkFailure(error) ->
                "Unable to connect. Please check your internet connection and try again."
            isDeveloperConsoleError(error) -> DEVELOPER_CONSOLE_MESSAGE
            error is TimeoutCancellationException ->
                "Google সাইন-ইন সময় শেষ হয়েছে। আবার চেষ্টা করুন।"
            error is GoogleAuthException.Failed -> {
                val message = error.message?.trim().orEmpty()
                when {
                    message.isBlank() ||
                        message == "Google sign-in failed." ||
                        message == "Supabase authentication failed." ||
                        message.startsWith("nonce_mismatch") ->
                        "Google দিয়ে প্রবেশ করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।"
                    isDeveloperConsoleError(error) -> DEVELOPER_CONSOLE_MESSAGE
                    message.contains("timed out", ignoreCase = true) ->
                        "Google সাইন-ইন সময় শেষ হয়েছে। আবার চেষ্টা করুন।"
                    else -> message
                }
            }
            else -> "Google দিয়ে প্রবেশ করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।"
        }
    }
}
