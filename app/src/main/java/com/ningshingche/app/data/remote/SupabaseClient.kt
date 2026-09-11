package com.ningshingche.app.data.remote

import android.content.Context
import com.ningshingche.app.data.auth.GoogleAuthException
import com.ningshingche.app.data.auth.GoogleAuthMapper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

class SupabaseClient(private val context: Context) {

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val _currentUser = MutableStateFlow<UserProfile?>(null)
    val currentUser: StateFlow<UserProfile?> = _currentUser.asStateFlow()

    private var authToken: String? = null
    private var refreshToken: String? = null
    private var expiresAtMillis: Long = 0L

    init {
        // Initialize default administrator session
        loadStoredSession()
    }

    private fun loadStoredSession() {
        val prefs = context.getSharedPreferences("supabase_auth_session", Context.MODE_PRIVATE)
        val token = prefs.getString("access_token", null)
        val userJsonStr = prefs.getString("user_profile", null)

        if (!token.isNullOrBlank() && !userJsonStr.isNullOrBlank()) {
            try {
                authToken = token
                refreshToken = prefs.getString("refresh_token", null)
                expiresAtMillis = prefs.getLong("expires_at", 0L)
                _currentUser.value = UserProfile.fromJson(JSONObject(userJsonStr))
            } catch (_: Exception) {
                _currentUser.value = null
            }
        } else {
            _currentUser.value = null
        }
    }

    fun saveSession(
        token: String,
        profile: UserProfile,
        newRefreshToken: String? = refreshToken,
        expiresAt: Long = expiresAtMillis
    ) {
        authToken = token
        refreshToken = newRefreshToken
        expiresAtMillis = expiresAt
        _currentUser.value = profile
        context.getSharedPreferences("supabase_auth_session", Context.MODE_PRIVATE)
            .edit()
            .putString("access_token", token)
            .putString("refresh_token", newRefreshToken)
            .putLong("expires_at", expiresAt)
            .putString("user_profile", profile.toJson().toString())
            .apply()
    }

    fun clearSession() {
        authToken = null
        refreshToken = null
        expiresAtMillis = 0L
        _currentUser.value = null
        context.getSharedPreferences("supabase_auth_session", Context.MODE_PRIVATE)
            .edit()
            .remove("access_token")
            .remove("refresh_token")
            .remove("expires_at")
            .remove("user_profile")
            .apply()
    }

    fun getAuthToken(): String? = authToken

    @Synchronized
    private fun sessionBearer(): String {
        val key = SupabaseConfig.supabaseKey
        val token = authToken
        if (!GoogleAuthMapper.isSupabaseJwt(token) || token == null) return key
        val jwtExp = jwtExpiryMillis(token)
        val expiry = when {
            jwtExp > 0L -> jwtExp
            expiresAtMillis > 0L -> expiresAtMillis
            else -> 0L
        }
        // Refresh two minutes early so a slow request still has a valid exp.
        if (expiry <= 0L || System.currentTimeMillis() >= expiry - 120_000L) {
            refreshAccessTokenLocked()?.let { return it }
            if (expiry > 0L && System.currentTimeMillis() >= expiry) return key
        }
        return token
    }

    /** User JWT only — never the publishable/anon key, which Storage treats as unauthenticated. */
    private fun sessionUserJwt(): String? {
        val refreshed = sessionBearer()
        if (GoogleAuthMapper.isSupabaseJwt(refreshed)) return refreshed
        return authToken.takeIf { GoogleAuthMapper.isSupabaseJwt(it) }
    }

    private fun jwtSubject(token: String): String =
        GoogleAuthMapper.jwtPayload(token)?.optString("sub").orEmpty().trim()

    private fun jwtExpiryMillis(token: String): Long {
        return try {
            val payload = token.split('.').getOrNull(1) ?: return 0L
            val padded = payload + "=".repeat((4 - payload.length % 4) % 4)
            val decoded = android.util.Base64.decode(
                padded,
                android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP
            )
            JSONObject(String(decoded, Charsets.UTF_8)).optLong("exp", 0L) * 1000L
        } catch (_: Exception) {
            0L
        }
    }

    @Synchronized
    private fun refreshAccessTokenLocked(): String? {
        val refresh = refreshToken ?: return null
        val url = "${SupabaseConfig.authBaseUrl}/token?grant_type=refresh_token"
        val payload = JSONObject().put("refresh_token", refresh).toString()
        val bearers = listOfNotNull(SupabaseConfig.supabaseKey, authToken).distinct()
        for (bearer in bearers) {
            try {
                val request = createAuthRequestBuilder(url, bearer = bearer)
                    .post(payload.toRequestBody(jsonMediaType))
                    .build()
                httpClient.newCall(request).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful || body.isBlank()) return@use
                    val json = JSONObject(body)
                    val token = json.optString("access_token", "")
                    if (token.count { it == '.' } < 2) return@use
                    val nextRefresh = json.optString("refresh_token", refresh)
                    val expiresAt = System.currentTimeMillis() + json.optLong("expires_in", 3600L) * 1000L - 30_000L
                    val profile = _currentUser.value
                    if (profile != null) {
                        saveSession(token, profile, nextRefresh.ifBlank { refresh }, expiresAt)
                    } else {
                        authToken = token
                        refreshToken = nextRefresh.ifBlank { refresh }
                        expiresAtMillis = expiresAt
                    }
                    return token
                }
            } catch (_: Exception) {
                // Try the next Authorization value.
            }
        }
        return null
    }

    private fun createBaseRequestBuilder(url: String): Request.Builder {
        val key = SupabaseConfig.supabaseKey
        val bearer = sessionBearer()
        return Request.Builder()
            .url(url)
            .addHeader("apikey", key)
            .addHeader("Authorization", "Bearer $bearer")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "return=representation")
    }

    fun signOut() {
        val token = authToken
        clearSession()
        if (GoogleAuthMapper.isSupabaseJwt(token) && token != null) {
            val request = createAuthRequestBuilder("${SupabaseConfig.authBaseUrl}/logout", bearer = token)
                .post("{}".toRequestBody(jsonMediaType))
                .build()
            httpClient.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: okhttp3.Call, e: IOException) = Unit
                override fun onResponse(call: okhttp3.Call, response: Response) {
                    response.close()
                }
            })
        }
    }

    suspend fun signOutRemote() = withContext(Dispatchers.IO) {
        signOut()
    }

    /**
     * Native Google ID-token grant. The ID token is sent only to Supabase Auth
     * and is never logged or shown in the UI.
     */
    suspend fun signInWithGoogleIdToken(idToken: String, rawNonce: String): Result<UserProfile> =
        withContext(Dispatchers.IO) {
            try {
                val firstAttempt: Result<UserProfile>? = exchangeGoogleIdToken(idToken, rawNonce)
                val secondAttempt: Result<UserProfile>? = firstAttempt
                    ?: if (rawNonce.isNotBlank()) exchangeGoogleIdToken(idToken, "") else null
                secondAttempt
                    ?: Result.failure(GoogleAuthException.Failed("Supabase authentication failed."))
            } catch (error: Exception) {
                if (GoogleAuthMapper.isNetworkFailure(error)) {
                    Result.failure(GoogleAuthException.Network())
                } else {
                    Result.failure(GoogleAuthException.Failed("Supabase authentication failed."))
                }
            }
        }

    private fun exchangeGoogleIdToken(idToken: String, rawNonce: String): Result<UserProfile>? {
        val url = "${SupabaseConfig.authBaseUrl}/token?grant_type=id_token"
        val payload = JSONObject().apply {
            put("provider", "google")
            put("id_token", idToken)
            if (rawNonce.isNotBlank()) put("nonce", rawNonce)
        }.toString()
        val request = createAuthRequestBuilder(url)
            .post(payload.toRequestBody(jsonMediaType))
            .build()
        httpClient.newCall(request).execute().use { response ->
            val responseBody = response.body?.string().orEmpty()
            if (response.isSuccessful && responseBody.isNotBlank()) {
                val json = JSONObject(responseBody)
                val token = json.optString("access_token", "")
                if (!GoogleAuthMapper.isSupabaseJwt(token)) return null
                val userObj = json.optJSONObject("user") ?: return null
                val profile = GoogleAuthMapper.profileFromAuthUser(userObj)
                val refresh = json.optString("refresh_token", "")
                val expiresAt = System.currentTimeMillis() +
                    json.optLong("expires_in", 3600L) * 1000L - 30_000L
                saveSession(token, profile, refresh.ifBlank { null }, expiresAt)
                return Result.success(profile)
            }
            if (response.code >= 500) {
                return Result.failure(GoogleAuthException.Network())
            }
            val authError = googleIdTokenAuthError(responseBody)
            if (rawNonce.isNotBlank() && GoogleAuthMapper.isNonceAuthError(authError)) {
                return null
            }
            return Result.failure(authError)
        }
    }

    private fun googleIdTokenAuthError(body: String): GoogleAuthException {
        val parsed = runCatching { JSONObject(body) }.getOrNull()
        val detail = listOf("error_description", "msg", "error", "message")
            .map { parsed?.optString(it).orEmpty().trim() }
            .firstOrNull { it.isNotBlank() && it != "null" }
            .orEmpty()
        val combined = "$detail $body"
        return when {
            GoogleAuthMapper.isNonceAuthError(Exception(combined)) ->
                GoogleAuthException.Failed("nonce_mismatch")
            combined.contains("audience", ignoreCase = true) ->
                GoogleAuthException.Failed(
                    "Google ও Supabase-এ Web Client ID মিলছে না। Dashboard → Authentication → Google-এ Web Client ID দিন।"
                )
            combined.contains("provider", ignoreCase = true) &&
                combined.contains("disabled", ignoreCase = true) ->
                GoogleAuthException.Failed(
                    "Supabase-এ Google সাইন-ইন চালু নেই। Authentication → Providers → Google চালু করুন।"
                )
            else -> GoogleAuthException.Failed("Supabase authentication failed.")
        }
    }

    /**
     * Idempotent upsert of the signed-in Google user into `public.profiles`.
     * Existing completed fields are never overwritten by Google defaults.
     * Missing table or RLS errors do not fail the login.
     */
    suspend fun upsertReaderProfile(profile: UserProfile): Result<UserProfile> = withContext(Dispatchers.IO) {
        val token = authToken
        if (!GoogleAuthMapper.isSupabaseJwt(token) || token == null) {
            return@withContext Result.success(profile)
        }
        try {
            val existing = fetchReaderProfile(profile.id, token)
            val merged = mergeGoogleProfile(profile, existing)
            val payload = readerProfilePayload(merged, includeEmail = existing == null)
            if (existing != null) {
                val url = "${SupabaseConfig.restBaseUrl}/profiles?id=eq.${profile.id}"
                val request = createUserAuthedRequestBuilder(url, token)
                    .patch(payload.toString().toRequestBody(jsonMediaType))
                    .build()
                httpClient.newCall(request).execute().use { it.body?.close() }
            } else {
                val url = "${SupabaseConfig.restBaseUrl}/profiles"
                val request = createUserAuthedRequestBuilder(url, token)
                    .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
                    .post(payload.toString().toRequestBody(jsonMediaType))
                    .build()
                httpClient.newCall(request).execute().use { it.body?.close() }
            }
            val hydrated = fetchReaderProfile(profile.id, token)?.let { row ->
                UserProfile.fromJson(row).copy(
                    role = profile.role,
                    authProvider = profile.authProvider,
                    email = profile.email.ifBlank { UserProfile.fromJson(row).email }
                )
            } ?: merged
            saveSession(token, hydrated, refreshToken, expiresAtMillis)
            Result.success(hydrated)
        } catch (_: Exception) {
            Result.success(profile)
        }
    }

    suspend fun updateReaderProfile(profile: UserProfile): Result<UserProfile> = withContext(Dispatchers.IO) {
        val token = authToken
        if (!GoogleAuthMapper.isSupabaseJwt(token) || token == null) {
            return@withContext Result.failure(Exception("সাইন ইন করা নেই।"))
        }
        try {
            val completed = profile.copy(
                fullName = profile.composedFullName(),
                profileCompleted = profile.isProfileComplete
            )
            val payload = readerProfilePayload(completed, includeEmail = false)
            payload.put("profile_completed", completed.isProfileComplete)
            val url = "${SupabaseConfig.restBaseUrl}/profiles?id=eq.${profile.id}"
            val request = createUserAuthedRequestBuilder(url, token)
                .addHeader("Prefer", "return=representation")
                .patch(payload.toString().toRequestBody(jsonMediaType))
                .build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                return@withContext Result.failure(
                    Exception("প্রোফাইল সংরক্ষণ যায়নি (${response.code})। SQL মাইগ্রেশন 006 চালানো হয়েছে কি?")
                )
            }
            val saved = if (body.startsWith("[")) {
                val array = JSONArray(body)
                if (array.length() > 0) UserProfile.fromJson(array.getJSONObject(0)) else completed
            } else completed
            val hydrated = saved.copy(
                role = profile.role,
                authProvider = profile.authProvider,
                email = profile.email
            )
            saveSession(token, hydrated, refreshToken, expiresAtMillis)
            Result.success(hydrated)
        } catch (error: Exception) {
            Result.failure(error)
        }
    }

    suspend fun syncNotificationsEnabled(enabled: Boolean): Result<Boolean> = withContext(Dispatchers.IO) {
        val token = authToken
        val userId = _currentUser.value?.id.orEmpty()
        if (!GoogleAuthMapper.isSupabaseJwt(token) || token == null || userId.isBlank()) {
            return@withContext Result.success(false)
        }
        try {
            val url = "${SupabaseConfig.restBaseUrl}/profiles?id=eq.$userId"
            val payload = JSONObject().put("notifications_enabled", enabled).toString()
            val request = createUserAuthedRequestBuilder(url, token)
                .patch(payload.toRequestBody(jsonMediaType))
                .build()
            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
        } catch (_: Exception) {
            Result.success(false)
        }
    }

    suspend fun getMySubmittedBlogs(userId: String, email: String): Result<List<SubmittedBlogRecord>> =
        withContext(Dispatchers.IO) {
            try {
                val params = mutableListOf("select=*", "order=created_at.desc")
                val filter = when {
                    userId.isNotBlank() -> "user_id=eq.$userId"
                    email.isNotBlank() -> "writer_email=eq.${java.net.URLEncoder.encode(email, "UTF-8")}"
                    else -> return@withContext Result.success(emptyList())
                }
                params.add(filter)
                val url = "${SupabaseConfig.restBaseUrl}/submitted_blogs?${params.joinToString("&")}"
                var response = httpClient.newCall(createBaseRequestBuilder(url).get().build()).execute()
                var body = response.body?.string().orEmpty()
                if (response.code == 401) {
                    refreshAccessTokenLocked()
                    response = httpClient.newCall(createBaseRequestBuilder(url).get().build()).execute()
                    body = response.body?.string().orEmpty()
                }
                if (response.isSuccessful) {
                    val array = JSONArray(body.ifBlank { "[]" })
                    val list = mutableListOf<SubmittedBlogRecord>()
                    for (i in 0 until array.length()) {
                        list.add(SubmittedBlogRecord.fromJson(array.getJSONObject(i)))
                    }
                    Result.success(list)
                } else if (response.code == 401 || response.code == 403) {
                    Result.success(emptyList())
                } else {
                    Result.failure(Exception("প্রবন্ধ তালিকা লোড হয়নি (${response.code})"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    suspend fun getMyComments(userId: String, email: String): Result<List<CommentRecord>> =
        withContext(Dispatchers.IO) {
            try {
                val params = mutableListOf("select=*", "order=created_at.desc")
                val filter = when {
                    userId.isNotBlank() -> "or=(user_id.eq.$userId,email.eq.${java.net.URLEncoder.encode(email, "UTF-8")})"
                    email.isNotBlank() -> "email=eq.${java.net.URLEncoder.encode(email, "UTF-8")}"
                    else -> return@withContext Result.success(emptyList())
                }
                params.add(filter)
                val url = "${SupabaseConfig.restBaseUrl}/comments?${params.joinToString("&")}"
                var response = httpClient.newCall(createBaseRequestBuilder(url).get().build()).execute()
                var body = response.body?.string().orEmpty()
                if (response.code == 401) {
                    refreshAccessTokenLocked()
                    response = httpClient.newCall(createBaseRequestBuilder(url).get().build()).execute()
                    body = response.body?.string().orEmpty()
                }
                if (response.isSuccessful) {
                    val array = JSONArray(body.ifBlank { "[]" })
                    val list = mutableListOf<CommentRecord>()
                    for (i in 0 until array.length()) {
                        list.add(CommentRecord.fromJson(array.getJSONObject(i)))
                    }
                    Result.success(list)
                } else if (response.code == 401 || response.code == 403) {
                    Result.success(emptyList())
                } else {
                    Result.failure(Exception("মন্তব্য তালিকা লোড হয়নি (${response.code})"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    suspend fun submitReaderArticle(sub: SubmittedBlogRecord): Result<SubmittedBlogRecord> =
        withContext(Dispatchers.IO) {
            try {
                val url = "${SupabaseConfig.restBaseUrl}/submitted_blogs"
                val payload = sub.toJson()
                payload.put("status", "Pending")
                val request = createBaseRequestBuilder(url)
                    .addHeader("Prefer", "return=representation")
                    .post(payload.toString().toRequestBody(jsonMediaType))
                    .build()
                val response = httpClient.newCall(request).execute()
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        Exception("লেখা জমা যায়নি (${response.code})। প্রোফাইল সম্পূর্ণ করে আবার চেষ্টা করুন।")
                    )
                }
                if (body.startsWith("[")) {
                    val array = JSONArray(body)
                    if (array.length() > 0) {
                        return@withContext Result.success(SubmittedBlogRecord.fromJson(array.getJSONObject(0)))
                    }
                }
                Result.success(sub)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    suspend fun getMyNotifications(): Result<List<UserNotificationRecord>> = withContext(Dispatchers.IO) {
        val token = authToken
        if (!GoogleAuthMapper.isSupabaseJwt(token) || token == null) {
            return@withContext Result.success(emptyList())
        }
        try {
            val url = "${SupabaseConfig.restBaseUrl}/user_notifications?select=*&order=created_at.desc"
            val request = createUserAuthedRequestBuilder(url, token).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                return@withContext Result.success(emptyList())
            }
            val array = JSONArray(body.ifBlank { "[]" })
            val list = mutableListOf<UserNotificationRecord>()
            for (i in 0 until array.length()) {
                list.add(UserNotificationRecord.fromJson(array.getJSONObject(i)))
            }
            Result.success(list)
        } catch (_: Exception) {
            Result.success(emptyList())
        }
    }

    suspend fun upsertNotification(notice: UserNotificationRecord): Result<UserNotificationRecord> =
        withContext(Dispatchers.IO) {
            val token = authToken
            if (!GoogleAuthMapper.isSupabaseJwt(token) || token == null) {
                return@withContext Result.success(notice)
            }
            try {
                val url = "${SupabaseConfig.restBaseUrl}/user_notifications"
                val request = createUserAuthedRequestBuilder(url, token)
                    .addHeader("Prefer", "resolution=merge-duplicates,return=representation")
                    .post(notice.toJson().toString().toRequestBody(jsonMediaType))
                    .build()
                httpClient.newCall(request).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (response.isSuccessful && body.startsWith("[")) {
                        val array = JSONArray(body)
                        if (array.length() > 0) {
                            return@withContext Result.success(UserNotificationRecord.fromJson(array.getJSONObject(0)))
                        }
                    }
                }
                Result.success(notice)
            } catch (_: Exception) {
                Result.success(notice)
            }
        }

    suspend fun markNotificationRead(id: String): Result<Boolean> = withContext(Dispatchers.IO) {
        val token = authToken
        if (!GoogleAuthMapper.isSupabaseJwt(token) || token == null || id.isBlank()) {
            return@withContext Result.success(false)
        }
        try {
            val url = "${SupabaseConfig.restBaseUrl}/user_notifications?id=eq.$id"
            val payload = JSONObject().put("is_read", true).toString()
            val request = createUserAuthedRequestBuilder(url, token)
                .patch(payload.toRequestBody(jsonMediaType))
                .build()
            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
        } catch (_: Exception) {
            Result.success(false)
        }
    }

    suspend fun markAllNotificationsRead(): Result<Boolean> = withContext(Dispatchers.IO) {
        val token = authToken
        val userId = _currentUser.value?.id.orEmpty()
        if (!GoogleAuthMapper.isSupabaseJwt(token) || token == null || userId.isBlank()) {
            return@withContext Result.success(false)
        }
        try {
            val url = "${SupabaseConfig.restBaseUrl}/user_notifications?user_id=eq.$userId&is_read=eq.false"
            val payload = JSONObject().put("is_read", true).toString()
            val request = createUserAuthedRequestBuilder(url, token)
                .patch(payload.toRequestBody(jsonMediaType))
                .build()
            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
        } catch (_: Exception) {
            Result.success(false)
        }
    }

    suspend fun getAdminMessages(): Result<List<AdminMessageRecord>> = withContext(Dispatchers.IO) {
        val token = authToken
        if (!GoogleAuthMapper.isSupabaseJwt(token) || token == null) {
            return@withContext Result.success(emptyList())
        }
        try {
            val url = "${SupabaseConfig.restBaseUrl}/admin_messages?select=*&order=created_at.asc"
            val request = createUserAuthedRequestBuilder(url, token).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                return@withContext Result.success(emptyList())
            }
            val array = JSONArray(body.ifBlank { "[]" })
            val list = mutableListOf<AdminMessageRecord>()
            for (i in 0 until array.length()) {
                list.add(AdminMessageRecord.fromJson(array.getJSONObject(i)))
            }
            Result.success(list)
        } catch (_: Exception) {
            Result.success(emptyList())
        }
    }

    suspend fun sendAdminMessage(body: String): Result<AdminMessageRecord> =
        withContext(Dispatchers.IO) {
            val token = authToken
            val userId = _currentUser.value?.id.orEmpty()
            if (!GoogleAuthMapper.isSupabaseJwt(token) || token == null) {
                return@withContext Result.failure(Exception("সাইন ইন করা নেই।"))
            }
            if (userId.isBlank() || body.isBlank()) {
                return@withContext Result.failure(Exception("বার্তা লিখুন।"))
            }
            try {
                val record = AdminMessageRecord(
                    userId = userId,
                    sender = "user",
                    subject = "",
                    body = body.trim()
                )
                val url = "${SupabaseConfig.restBaseUrl}/admin_messages"
                val request = createUserAuthedRequestBuilder(url, token)
                    .addHeader("Prefer", "return=representation")
                    .post(record.toJson().toString().toRequestBody(jsonMediaType))
                    .build()
                val response = httpClient.newCall(request).execute()
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        Exception("বার্তা পাঠানো যায়নি (${response.code})। SQL মাইগ্রেশন 007 চালান।")
                    )
                }
                if (responseBody.startsWith("[")) {
                    val array = JSONArray(responseBody)
                    if (array.length() > 0) {
                        return@withContext Result.success(AdminMessageRecord.fromJson(array.getJSONObject(0)))
                    }
                }
                Result.success(record)
            } catch (error: Exception) {
                Result.failure(error)
            }
        }

    suspend fun markAdminMessagesRead(): Result<Boolean> = withContext(Dispatchers.IO) {
        val token = authToken
        val userId = _currentUser.value?.id.orEmpty()
        if (!GoogleAuthMapper.isSupabaseJwt(token) || token == null || userId.isBlank()) {
            return@withContext Result.success(false)
        }
        try {
            val url = "${SupabaseConfig.restBaseUrl}/admin_messages?user_id=eq.$userId&sender=eq.admin&is_read=eq.false"
            val payload = JSONObject().put("is_read", true).toString()
            val request = createUserAuthedRequestBuilder(url, token)
                .patch(payload.toRequestBody(jsonMediaType))
                .build()
            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
        } catch (_: Exception) {
            Result.success(false)
        }
    }

    private fun mergeGoogleProfile(google: UserProfile, existing: JSONObject?): UserProfile {
        if (existing == null) return google
        val stored = UserProfile.fromJson(existing)
        val first = stored.firstName.ifBlank { google.firstName }
        val last = stored.lastName.ifBlank { google.lastName }
        val avatar = stored.avatarUrl.ifBlank { google.avatarUrl }
        val name = listOf(first, last).filter { it.isNotBlank() }.joinToString(" ")
            .ifBlank { stored.fullName.ifBlank { google.fullName } }
        return google.copy(
            fullName = name,
            firstName = first,
            lastName = last,
            avatarUrl = avatar,
            about = stored.about.ifBlank { google.about },
            phone = stored.phone.ifBlank { google.phone },
            address = stored.address.ifBlank { google.address },
            facebookId = stored.facebookId.ifBlank { google.facebookId },
            designation = stored.designation.ifBlank { google.designation },
            location = stored.location.ifBlank { google.location },
            website = stored.website.ifBlank { google.website },
            imgbbDeleteUrl = stored.imgbbDeleteUrl.ifBlank { google.imgbbDeleteUrl },
            profileCompleted = stored.profileCompleted || stored.isProfileComplete,
            email = google.email.ifBlank { stored.email }
        )
    }

    private fun readerProfilePayload(profile: UserProfile, includeEmail: Boolean): JSONObject {
        return JSONObject().apply {
            put("id", profile.id)
            put("name", profile.composedFullName())
            put("first_name", profile.displayFirstName)
            put("last_name", profile.displayLastName)
            put("avatar_url", profile.avatarUrl)
            put("about", profile.about)
            put("phone", profile.phone)
            put("address", profile.address)
            put("facebook_id", profile.facebookId)
            put("designation", profile.designation)
            put("location", profile.location)
            put("website", profile.website)
            put("imgbb_delete_url", profile.imgbbDeleteUrl)
            if (includeEmail && profile.email.isNotBlank()) put("email", profile.email)
        }
    }

    private fun fetchReaderProfile(userId: String, token: String): JSONObject? {
        val url = "${SupabaseConfig.restBaseUrl}/profiles?id=eq.$userId&select=*&limit=1"
        val request = createUserAuthedRequestBuilder(url, token).get().build()
        val response = httpClient.newCall(request).execute()
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful || body.isBlank()) return null
        val array = JSONArray(body)
        return if (array.length() > 0) array.getJSONObject(0) else null
    }

    private fun createAuthRequestBuilder(url: String, bearer: String? = null): Request.Builder {
        val key = SupabaseConfig.supabaseKey
        val access = bearer ?: key
        return Request.Builder()
            .url(url)
            .addHeader("apikey", key)
            .addHeader("Authorization", "Bearer $access")
            .addHeader("Content-Type", "application/json")
    }

    private fun createUserAuthedRequestBuilder(url: String, userJwt: String): Request.Builder {
        val key = SupabaseConfig.supabaseKey
        val refreshed = sessionBearer()
        val bearer = when {
            GoogleAuthMapper.isSupabaseJwt(refreshed) -> refreshed
            GoogleAuthMapper.isSupabaseJwt(userJwt) -> userJwt
            else -> key
        }
        return Request.Builder()
            .url(url)
            .addHeader("apikey", key)
            .addHeader("Authorization", "Bearer $bearer")
            .addHeader("Content-Type", "application/json")
    }

    // ==========================================
    // AUTHORS CRUD
    // ==========================================

    suspend fun getAuthors(): Result<List<AuthorRecord>> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/authors?select=*&order=created_at.desc"
            val request = createBaseRequestBuilder(url).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()

            if (response.isSuccessful && body.isNotBlank()) {
                val array = JSONArray(body)
                val list = mutableListOf<AuthorRecord>()
                for (i in 0 until array.length()) {
                    list.add(AuthorRecord.fromJson(array.getJSONObject(i)))
                }
                Result.success(list)
            } else {
                Result.failure(Exception("Supabase response: ${response.code} $body"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ==========================================
    // CATEGORIES CRUD
    // ==========================================

    suspend fun getCategories(): Result<List<CategoryRecord>> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/categories?select=*&order=created_at.asc"
            val request = createBaseRequestBuilder(url).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()

            if (response.isSuccessful && body.isNotBlank()) {
                val array = JSONArray(body)
                val list = mutableListOf<CategoryRecord>()
                for (i in 0 until array.length()) {
                    list.add(CategoryRecord.fromJson(array.getJSONObject(i)))
                }
                Result.success(list)
            } else {
                Result.failure(Exception("Supabase response: ${response.code} $body"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ==========================================
    // BLOGS CRUD
    // ==========================================

    suspend fun getBlogs(
        query: String? = null,
        categoryId: String? = null,
        authorId: String? = null,
        status: String? = null,
        limit: Int = 100,
        offset: Int = 0
    ): Result<List<BlogRecord>> = withContext(Dispatchers.IO) {
        try {
            val params = mutableListOf<String>()
            params.add("select=*")
            params.add("order=created_at.desc")
            params.add("limit=$limit")
            params.add("offset=$offset")

            if (!categoryId.isNullOrBlank()) params.add("category_id=eq.$categoryId")
            if (!authorId.isNullOrBlank()) params.add("author_id=eq.$authorId")
            if (!status.isNullOrBlank()) params.add("status=eq.$status")
            if (!query.isNullOrBlank()) params.add("title=ilike.*${query.trim()}*")

            val url = "${SupabaseConfig.restBaseUrl}/blogs?${params.joinToString("&")}"
            val request = createBaseRequestBuilder(url).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()

            if (response.isSuccessful && body.isNotBlank()) {
                val array = JSONArray(body)
                val list = mutableListOf<BlogRecord>()
                for (i in 0 until array.length()) {
                    list.add(BlogRecord.fromJson(array.getJSONObject(i)))
                }
                Result.success(list)
            } else {
                Result.failure(Exception("Supabase response: ${response.code} $body"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getBlogById(idOrSlug: String): Result<BlogRecord?> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/blogs?or=(id.eq.$idOrSlug,slug.eq.$idOrSlug)&limit=1"
            val request = createBaseRequestBuilder(url).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()

            if (response.isSuccessful && body.isNotBlank()) {
                val array = JSONArray(body)
                if (array.length() > 0) {
                    Result.success(BlogRecord.fromJson(array.getJSONObject(0)))
                } else {
                    Result.success(null)
                }
            } else {
                Result.failure(Exception("Supabase error: ${response.code}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ==========================================
    // COMMENTS CRUD
    // ==========================================

    suspend fun getComments(blogId: String? = null, status: String? = null): Result<List<CommentRecord>> = withContext(Dispatchers.IO) {
        try {
            val params = mutableListOf<String>()
            params.add("select=*")
            params.add("order=created_at.desc")
            if (!blogId.isNullOrBlank()) params.add("blog_id=eq.$blogId")
            if (!status.isNullOrBlank()) params.add("status=eq.$status")

            val url = "${SupabaseConfig.restBaseUrl}/comments?${params.joinToString("&")}"
            val request = createBaseRequestBuilder(url).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()

            if (response.isSuccessful && body.isNotBlank()) {
                val array = JSONArray(body)
                val list = mutableListOf<CommentRecord>()
                for (i in 0 until array.length()) {
                    list.add(CommentRecord.fromJson(array.getJSONObject(i)))
                }
                Result.success(list)
            } else {
                Result.failure(Exception("Supabase response: ${response.code} $body"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun upsertComment(comment: CommentRecord): Result<CommentRecord> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/comments"
            val payload = comment.toJson().toString()
            val request = createBaseRequestBuilder(url)
                .addHeader("Prefer", "resolution=merge-duplicates,return=representation")
                .post(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            Result.success(comment)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ==========================================
    // PDF BOOKS CRUD
    // ==========================================

    suspend fun getPdfBooks(): Result<List<PdfBookRecord>> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/pdf_books?select=*&order=created_at.desc"
            val request = createBaseRequestBuilder(url).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()

            if (response.isSuccessful && body.isNotBlank()) {
                val array = JSONArray(body)
                val list = mutableListOf<PdfBookRecord>()
                for (i in 0 until array.length()) {
                    list.add(PdfBookRecord.fromJson(array.getJSONObject(i)))
                }
                Result.success(list)
            } else {
                Result.failure(Exception("Supabase error: ${response.code} $body"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun parseContentRangeTotal(response: okhttp3.Response): Int {
        val range = response.header("Content-Range").orEmpty()
        val total = range.substringAfterLast("/", "").trim()
        if (total.isBlank() || total == "*") return 0
        return total.toIntOrNull() ?: 0
    }

    suspend fun getMyMusicTracks(userId: String): Result<List<SubmittedMusicRecord>> =
        withContext(Dispatchers.IO) {
            val clean = userId.trim()
            if (clean.isBlank()) return@withContext Result.success(emptyList())
            try {
                val url = "${SupabaseConfig.restBaseUrl}/music_tracks?select=*&user_id=eq.$clean&order=created_at.desc"
                val request = createBaseRequestBuilder(url).get().build()
                val response = httpClient.newCall(request).execute()
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) return@withContext Result.success(emptyList())
                val array = JSONArray(body.ifBlank { "[]" })
                val list = mutableListOf<SubmittedMusicRecord>()
                for (i in 0 until array.length()) {
                    list.add(SubmittedMusicRecord.fromJson(array.getJSONObject(i)))
                }
                Result.success(list)
            } catch (_: Exception) {
                Result.success(emptyList())
            }
        }

    data class MusicUpload(
        val publicUrl: String,
        val storagePath: String,
        val sizeBytes: Long
    )

    suspend fun uploadUserMusicFile(context: Context, userId: String, uri: android.net.Uri): Result<MusicUpload> =
        withContext(Dispatchers.IO) {
            val jwt = sessionUserJwt()
                ?: return@withContext Result.failure(Exception("সাইন ইন করা নেই। আবার প্রবেশ করুন।"))
            val uid = jwtSubject(jwt).ifBlank { userId.trim() }
            if (uid.isBlank()) {
                return@withContext Result.failure(Exception("সাইন ইন করা নেই। আবার প্রবেশ করুন।"))
            }
            val resolver = context.contentResolver
            val reported = resolver.getType(uri).orEmpty()
            val ext = when {
                reported.contains("wav", true) -> "wav"
                reported.contains("ogg", true) -> "ogg"
                reported.contains("aac", true) || reported.contains("m4a", true) || reported.contains("mp4", true) -> "m4a"
                reported.contains("flac", true) -> "flac"
                else -> "mp3"
            }
            val mime = when (ext) {
                "wav" -> "audio/wav"
                "ogg" -> "audio/ogg"
                "m4a" -> "audio/mp4"
                "flac" -> "audio/flac"
                else -> "audio/mpeg"
            }
            val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
                ?: return@withContext Result.failure(Exception("অডিও ফাইল পড়া যায়নি।"))
            if (bytes.isEmpty()) {
                return@withContext Result.failure(Exception("অডিও ফাইল খালি।"))
            }
            if (bytes.size > 32 * 1024 * 1024) {
                return@withContext Result.failure(Exception("ফাইল ৩২ এমবি-র বেশি হতে পারবে না।"))
            }
            val path = "user/$uid/${UUID.randomUUID()}.$ext"
            val encodedPath = path.split('/').joinToString("/") {
                java.net.URLEncoder.encode(it, Charsets.UTF_8.name()).replace("+", "%20")
            }
            val url = "${SupabaseConfig.storageBaseUrl}/object/music/$encodedPath"
            val client = httpClient.newBuilder()
                .writeTimeout(180, TimeUnit.SECONDS)
                .readTimeout(180, TimeUnit.SECONDS)
                .build()
            val request = Request.Builder()
                .url(url)
                .addHeader("apikey", SupabaseConfig.supabaseKey)
                .addHeader("Authorization", "Bearer $jwt")
                .addHeader("x-upsert", "false")
                .post(bytes.toRequestBody(mime.toMediaType()))
                .build()
            val response = client.newCall(request).execute()
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception(storageUploadError(response.code, body)))
            }
            Result.success(
                MusicUpload(
                    publicUrl = SupabaseConfig.musicPublicUrl(path),
                    storagePath = path,
                    sizeBytes = bytes.size.toLong()
                )
            )
        }

    private fun storageUploadError(code: Int, body: String): String {
        val lower = body.lowercase()
        return when {
            code == 401 || lower.contains("unauthorized") || lower.contains("accessdenied") ||
                lower.contains("row-level security") ->
                "অডিও আপলোডের অনুমতি নেই। আবার সাইন ইন করে চেষ্টা করুন।"
            lower.contains("mime") || lower.contains("invalidrequest") ->
                "এই অডিও ফর্ম্যাট সাপোর্টেড নয়। এমপি৩ নির্বাচন করুন।"
            code == 413 || lower.contains("payload") || lower.contains("size") ->
                "ফাইল ৩২ এমবি-র বেশি হতে পারবে না।"
            else -> "অডিও আপলোড যায়নি ($code)।"
        }
    }

    suspend fun submitReaderMusic(
        title: String,
        artist: String,
        album: String,
        genre: String,
        audioUrl: String,
        thumbnailUrl: String,
        userId: String,
        storagePath: String = "",
        durationSeconds: Int = 0,
        fileSizeMb: Double = 0.0
    ): Result<SubmittedMusicRecord> = withContext(Dispatchers.IO) {
        val jwt = sessionUserJwt()
            ?: return@withContext Result.failure(Exception("সাইন ইন করা নেই। আবার প্রবেশ করুন।"))
        val ownerId = jwtSubject(jwt).ifBlank { userId.trim() }
        try {
            val record = SubmittedMusicRecord(
                id = UUID.randomUUID().toString(),
                title = title.trim(),
                artist = artist.trim(),
                album = album.trim(),
                genre = genre.trim(),
                thumbnailUrl = thumbnailUrl,
                audioUrl = audioUrl.trim()
            )
            val sizeMb = kotlin.math.round(fileSizeMb.coerceAtLeast(0.0) * 100.0) / 100.0
            val payload = JSONObject().apply {
                put("id", record.id)
                put("title", record.title)
                put("artist", record.artist)
                put("album", record.album)
                put("genre", record.genre)
                put("thumbnail_url", record.thumbnailUrl)
                put("audio_url", record.audioUrl)
                put("user_id", ownerId)
                put("file_provider", if (storagePath.isNotBlank()) "supabase-storage" else "url")
                put("file_storage_path", storagePath)
                put("duration_seconds", durationSeconds.coerceAtLeast(0))
                put("file_size_mb", sizeMb)
            }
            val url = "${SupabaseConfig.restBaseUrl}/music_tracks"
            val request = createUserAuthedRequestBuilder(url, jwt)
                .addHeader("Prefer", "return=representation")
                .post(payload.toString().toRequestBody(jsonMediaType))
                .build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val denied = response.code == 401 || response.code == 403 ||
                    body.contains("row-level security", ignoreCase = true)
                val message = if (denied) {
                    "গান জমা যায়নি। আবার সাইন ইন করে চেষ্টা করুন।"
                } else {
                    "গান জমা যায়নি (${response.code})। প্রোফাইল সম্পূর্ণ করে আবার চেষ্টা করুন।"
                }
                return@withContext Result.failure(Exception(message))
            }
            if (body.startsWith("[")) {
                val array = JSONArray(body)
                if (array.length() > 0) {
                    return@withContext Result.success(SubmittedMusicRecord.fromJson(array.getJSONObject(0)))
                }
            }
            Result.success(record)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun countMyMusicTracks(userId: String): Int = withContext(Dispatchers.IO) {
        val clean = userId.trim()
        if (clean.isBlank() || clean.length != 36 || runCatching { java.util.UUID.fromString(clean) }.isFailure) {
            return@withContext 0
        }
        try {
            val url = "${SupabaseConfig.restBaseUrl}/music_tracks?select=id&user_id=eq.$clean"
            val request = createBaseRequestBuilder(url)
                .header("Prefer", "count=exact")
                .header("Range", "0-0")
                .get()
                .build()
            val response = httpClient.newCall(request).execute()
            response.body?.close()
            if (!response.isSuccessful) 0 else parseContentRangeTotal(response)
        } catch (_: Exception) {
            0
        }
    }

    suspend fun sumBlogViewsForAuthor(authorName: String): Int = withContext(Dispatchers.IO) {
        if (authorName.isBlank()) return@withContext 0
        try {
            val encoded = java.net.URLEncoder.encode(authorName, "UTF-8")
            val url = "${SupabaseConfig.restBaseUrl}/blogs?select=views_count&author_name=eq.$encoded&limit=1000"
            val request = createBaseRequestBuilder(url).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful || body.isBlank()) return@withContext 0
            val array = JSONArray(body)
            var sum = 0
            for (i in 0 until array.length()) {
                sum += array.getJSONObject(i).optInt("views_count", 0)
            }
            sum
        } catch (_: Exception) {
            0
        }
    }

    suspend fun updateSettings(settings: SiteSettingsRecord): Result<SiteSettingsRecord> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/settings"
            val payload = settings.toJson().toString()
            val request = createBaseRequestBuilder(url)
                .addHeader("Prefer", "resolution=merge-duplicates,return=representation")
                .post(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            Result.success(settings)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
