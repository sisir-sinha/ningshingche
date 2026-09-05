package com.ningshingche.app.data.auth

import com.ningshingche.app.data.remote.UserProfile
import com.ningshingche.app.data.remote.UserRole
import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.MessageDigest
import java.util.UUID

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

    fun isSupabaseJwt(token: String?): Boolean {
        if (token.isNullOrBlank()) return false
        return token.count { it == '.' } >= 2 && token.length > 40
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
        val name = error::class.java.name
        return name.contains("Cancellation", ignoreCase = true) ||
            name.contains("Canceled", ignoreCase = true) ||
            name.contains("Cancelled", ignoreCase = true)
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
            error is GoogleAuthException.Failed ->
                error.message?.takeIf { it.isNotBlank() }
                    ?: "Google দিয়ে প্রবেশ করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।"
            else -> "Google দিয়ে প্রবেশ করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।"
        }
    }
}
