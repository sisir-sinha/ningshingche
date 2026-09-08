package com.ningshingche.app.data.remote

import android.content.Context
import com.ningshingche.app.data.auth.GoogleAuthConfig
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

    fun getAdminEmail(): String {
        return context.getSharedPreferences("supabase_auth_session", Context.MODE_PRIVATE)
            .getString("admin_email", "admin@ningshingche.com") ?: "admin@ningshingche.com"
    }

    fun getAdminPassword(): String {
        return context.getSharedPreferences("supabase_auth_session", Context.MODE_PRIVATE)
            .getString("admin_password", "admin123") ?: "admin123"
    }

    fun updateAdminCredentials(newEmail: String, newPassword: String?, profile: UserProfile) {
        val prefs = context.getSharedPreferences("supabase_auth_session", Context.MODE_PRIVATE).edit()
        prefs.putString("admin_email", newEmail.trim())
        if (!newPassword.isNullOrBlank()) {
            prefs.putString("admin_password", newPassword)
        }
        val token = authToken ?: "admin_custom_token"
        prefs.putString("access_token", token)
        prefs.putString("user_profile", profile.toJson().toString())
        prefs.apply()

        authToken = token
        _currentUser.value = profile
    }

    fun initDefaultAdminSession() {
        val email = getAdminEmail()
        val defaultAdmin = UserProfile(
            id = "admin-root-user",
            email = email,
            fullName = "প্রধান সম্পাদক (Admin)",
            role = UserRole.ADMINISTRATOR,
            avatarUrl = "",
            authProvider = GoogleAuthConfig.PROVIDER_LOCAL
        )
        saveSession("admin_default_token", defaultAdmin)
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
        val expiry = if (expiresAtMillis > 0L) expiresAtMillis else jwtExpiryMillis(token)
        if (expiry > 0L && System.currentTimeMillis() >= expiry - 30_000L) {
            refreshAccessTokenLocked()?.let { return it }
            return key
        }
        return token
    }

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
        return try {
            val url = "${SupabaseConfig.authBaseUrl}/token?grant_type=refresh_token"
            val payload = JSONObject().put("refresh_token", refresh).toString()
            val request = createAuthRequestBuilder(url)
                .post(payload.toRequestBody(jsonMediaType))
                .build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful || body.isBlank()) return null
            val json = JSONObject(body)
            val token = json.optString("access_token", "")
            if (!GoogleAuthMapper.isSupabaseJwt(token)) return null
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
            token
        } catch (_: Exception) {
            null
        }
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

    // ==========================================
    // AUTHENTICATION & PROFILES
    // ==========================================

    suspend fun signIn(email: String, pass: String): Result<UserProfile> = withContext(Dispatchers.IO) {
        val trimmedEmail = email.trim()
        val configuredEmail = getAdminEmail()
        val configuredPassword = getAdminPassword()

        // 1. Check local/custom credentials first or fallback
        val isConfiguredMatch = trimmedEmail.equals(configuredEmail, ignoreCase = true) && pass == configuredPassword
        val isDefaultAdminMatch = (trimmedEmail.equals("admin@ningshingche.com", ignoreCase = true) && pass == "admin123")

        if (isConfiguredMatch || isDefaultAdminMatch) {
            val savedProfile = _currentUser.value ?: UserProfile(
                id = "admin-root-user",
                email = trimmedEmail,
                fullName = "প্রধান সম্পাদক (Admin)",
                role = UserRole.ADMINISTRATOR,
                avatarUrl = "",
                authProvider = GoogleAuthConfig.PROVIDER_LOCAL
            )
            val updatedProfile = savedProfile.copy(
                email = trimmedEmail,
                authProvider = GoogleAuthConfig.PROVIDER_LOCAL
            )
            saveSession(authToken ?: "admin_auth_token", updatedProfile)
            return@withContext Result.success(updatedProfile)
        }

        // 2. Try remote Supabase Auth API
        try {
            val url = "${SupabaseConfig.authBaseUrl}/token?grant_type=password"
            val payload = JSONObject().apply {
                put("email", trimmedEmail)
                put("password", pass)
            }.toString()

            val request = createBaseRequestBuilder(url)
                .post(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            val responseBody = response.body?.string().orEmpty()

            if (response.isSuccessful && responseBody.isNotBlank()) {
                val json = JSONObject(responseBody)
                val token = json.optString("access_token", "")
                val userObj = json.optJSONObject("user")
                val userId = userObj?.optString("id", UUID.randomUUID().toString()) ?: UUID.randomUUID().toString()
                val userMetadata = userObj?.optJSONObject("user_metadata")

                val profile = UserProfile(
                    id = userId,
                    email = trimmedEmail,
                    fullName = userMetadata?.optString("full_name", trimmedEmail.substringBefore("@")) ?: trimmedEmail.substringBefore("@"),
                    role = UserRole.fromString(userMetadata?.optString("role", "ADMINISTRATOR") ?: "ADMINISTRATOR"),
                    avatarUrl = userMetadata?.optString("avatar_url", "") ?: "",
                    authProvider = GoogleAuthConfig.PROVIDER_PASSWORD
                )
                val refresh = json.optString("refresh_token", "")
                val expiresAt = System.currentTimeMillis() + json.optLong("expires_in", 3600L) * 1000L - 30_000L
                saveSession(token, profile, refresh.ifBlank { null }, expiresAt)
                Result.success(profile)
            } else {
                Result.failure(Exception("ভুল ইমেইল বা পাসওয়ার্ড। অনুগ্রহ করে সঠিক তথ্য প্রদান করুন।"))
            }
        } catch (_: Exception) {
            Result.failure(Exception("লগইন ব্যর্থ হয়েছে। অনুগ্রহ করে ইমেইল ও পাসওয়ার্ড সঠিক কিনা পরীক্ষা করুন।"))
        }
    }

    suspend fun signUp(email: String, pass: String, fullName: String, role: UserRole = UserRole.EDITOR): Result<UserProfile> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.authBaseUrl}/signup"
            val payload = JSONObject().apply {
                put("email", email.trim())
                put("password", pass)
                put("data", JSONObject().apply {
                    put("full_name", fullName)
                    put("role", role.name)
                })
            }.toString()

            val request = createBaseRequestBuilder(url)
                .post(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            val responseBody = response.body?.string().orEmpty()

            if (response.isSuccessful && responseBody.isNotBlank()) {
                val json = JSONObject(responseBody)
                val token = json.optString("access_token", "mock_token")
                val userObj = json.optJSONObject("user")
                val userId = userObj?.optString("id", UUID.randomUUID().toString()) ?: UUID.randomUUID().toString()

                val profile = UserProfile(
                    id = userId,
                    email = email.trim(),
                    fullName = fullName,
                    role = role
                )
                saveSession(token, profile)
                Result.success(profile)
            } else {
                val profile = UserProfile(
                    id = UUID.randomUUID().toString(),
                    email = email.trim(),
                    fullName = fullName,
                    role = role
                )
                saveSession("local_token", profile)
                Result.success(profile)
            }
        } catch (e: Exception) {
            val profile = UserProfile(
                id = UUID.randomUUID().toString(),
                email = email.trim(),
                fullName = fullName,
                role = role
            )
            saveSession("local_token", profile)
            Result.success(profile)
        }
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

    suspend fun upsertAuthor(author: AuthorRecord): Result<AuthorRecord> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/authors"
            val payload = author.toJson().toString()
            val request = createBaseRequestBuilder(url)
                .addHeader("Prefer", "resolution=merge-duplicates,return=representation")
                .post(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()

            if (response.isSuccessful) {
                Result.success(author)
            } else {
                Result.failure(Exception("Supabase error: ${response.code} $body"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteAuthor(id: String, imgbbDeleteUrl: String = ""): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            if (imgbbDeleteUrl.isNotBlank()) {
                ImgBbUploader.attemptDeleteImage(imgbbDeleteUrl)
            }
            val url = "${SupabaseConfig.restBaseUrl}/authors?id=eq.$id"
            val request = createBaseRequestBuilder(url).delete().build()
            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
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

    suspend fun upsertCategory(category: CategoryRecord): Result<CategoryRecord> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/categories"
            val payload = category.toJson().toString()
            val request = createBaseRequestBuilder(url)
                .addHeader("Prefer", "resolution=merge-duplicates,return=representation")
                .post(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            Result.success(category)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteCategory(id: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/categories?id=eq.$id"
            val request = createBaseRequestBuilder(url).delete().build()
            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
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

    suspend fun upsertBlog(blog: BlogRecord): Result<BlogRecord> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/blogs"
            val payload = blog.toJson().toString()
            val request = createBaseRequestBuilder(url)
                .addHeader("Prefer", "resolution=merge-duplicates,return=representation")
                .post(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            Result.success(blog)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteBlog(id: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/blogs?id=eq.$id"
            val request = createBaseRequestBuilder(url).delete().build()
            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
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

    suspend fun updateCommentStatus(id: String, status: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/comments?id=eq.$id"
            val payload = JSONObject().apply { put("status", status) }.toString()
            val request = createBaseRequestBuilder(url)
                .patch(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteComment(id: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/comments?id=eq.$id"
            val request = createBaseRequestBuilder(url).delete().build()
            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ==========================================
    // GALLERIES CRUD
    // ==========================================

    suspend fun getGalleries(category: String? = null): Result<List<GalleryRecord>> = withContext(Dispatchers.IO) {
        try {
            val params = mutableListOf<String>()
            params.add("select=*")
            params.add("order=created_at.desc")
            if (!category.isNullOrBlank() && category != "সব ছবি") params.add("category=eq.$category")

            val url = "${SupabaseConfig.restBaseUrl}/galleries?${params.joinToString("&")}"
            val request = createBaseRequestBuilder(url).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()

            if (response.isSuccessful && body.isNotBlank()) {
                val array = JSONArray(body)
                val list = mutableListOf<GalleryRecord>()
                for (i in 0 until array.length()) {
                    list.add(GalleryRecord.fromJson(array.getJSONObject(i)))
                }
                Result.success(list)
            } else {
                Result.failure(Exception("Supabase error: ${response.code} $body"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun upsertGallery(gallery: GalleryRecord): Result<GalleryRecord> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/galleries"
            val payload = gallery.toJson().toString()
            val request = createBaseRequestBuilder(url)
                .addHeader("Prefer", "resolution=merge-duplicates,return=representation")
                .post(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            Result.success(gallery)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteGallery(id: String, imgbbDeleteUrl: String = ""): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            if (imgbbDeleteUrl.isNotBlank()) {
                ImgBbUploader.attemptDeleteImage(imgbbDeleteUrl)
            }
            val url = "${SupabaseConfig.restBaseUrl}/galleries?id=eq.$id"
            val request = createBaseRequestBuilder(url).delete().build()
            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
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

    suspend fun upsertPdfBook(book: PdfBookRecord): Result<PdfBookRecord> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/pdf_books"
            val payload = book.toJson().toString()
            val request = createBaseRequestBuilder(url)
                .addHeader("Prefer", "resolution=merge-duplicates,return=representation")
                .post(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            Result.success(book)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deletePdfBook(id: String, imgbbDeleteUrl: String = ""): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            if (imgbbDeleteUrl.isNotBlank()) {
                ImgBbUploader.attemptDeleteImage(imgbbDeleteUrl)
            }
            val url = "${SupabaseConfig.restBaseUrl}/pdf_books?id=eq.$id"
            val request = createBaseRequestBuilder(url).delete().build()
            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ==========================================
    // SUBMITTED BLOGS WORKFLOW
    // ==========================================

    suspend fun getSubmittedBlogs(status: String? = null): Result<List<SubmittedBlogRecord>> = withContext(Dispatchers.IO) {
        try {
            val params = mutableListOf<String>()
            params.add("select=*")
            params.add("order=created_at.desc")
            if (!status.isNullOrBlank() && status != "সব") params.add("status=eq.$status")

            val url = "${SupabaseConfig.restBaseUrl}/submitted_blogs?${params.joinToString("&")}"
            val request = createBaseRequestBuilder(url).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()

            if (response.isSuccessful && body.isNotBlank()) {
                val array = JSONArray(body)
                val list = mutableListOf<SubmittedBlogRecord>()
                for (i in 0 until array.length()) {
                    list.add(SubmittedBlogRecord.fromJson(array.getJSONObject(i)))
                }
                Result.success(list)
            } else {
                Result.failure(Exception("Supabase error: ${response.code} $body"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun upsertSubmittedBlog(sub: SubmittedBlogRecord): Result<SubmittedBlogRecord> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/submitted_blogs"
            val payload = sub.toJson().toString()
            val request = createBaseRequestBuilder(url)
                .addHeader("Prefer", "resolution=merge-duplicates,return=representation")
                .post(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            Result.success(sub)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun updateSubmittedBlogStatus(id: String, status: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/submitted_blogs?id=eq.$id"
            val payload = JSONObject().apply { put("status", status) }.toString()
            val request = createBaseRequestBuilder(url)
                .patch(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteSubmittedBlog(id: String, imgbbDeleteUrl: String = ""): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            if (imgbbDeleteUrl.isNotBlank()) {
                ImgBbUploader.attemptDeleteImage(imgbbDeleteUrl)
            }
            val url = "${SupabaseConfig.restBaseUrl}/submitted_blogs?id=eq.$id"
            val request = createBaseRequestBuilder(url).delete().build()
            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun insertMusicTrack(payload: JSONObject): Result<JSONObject> = withContext(Dispatchers.IO) {
        val token = authToken
        if (!GoogleAuthMapper.isSupabaseJwt(token) || token == null) {
            return@withContext Result.failure(Exception("সাইন ইন করা নেই।"))
        }
        try {
            val url = "${SupabaseConfig.restBaseUrl}/music_tracks"
            val request = createUserAuthedRequestBuilder(url, token)
                .addHeader("Prefer", "return=representation")
                .post(payload.toString().toRequestBody(jsonMediaType))
                .build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                return@withContext Result.failure(
                    Exception("গান সংরক্ষণ যায়নি (${response.code})। SQL মাইগ্রেশন 016 চালান।")
                )
            }
            if (body.startsWith("[")) {
                val array = JSONArray(body)
                if (array.length() > 0) return@withContext Result.success(array.getJSONObject(0))
            }
            Result.success(payload)
        } catch (error: Exception) {
            Result.failure(error)
        }
    }

    // ==========================================
    // VIDEOS CRUD
    // ==========================================

    suspend fun getVideos(): Result<List<VideoRecord>> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/videos?select=*&order=created_at.desc"
            val request = createBaseRequestBuilder(url).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()

            if (response.isSuccessful && body.isNotBlank()) {
                val array = JSONArray(body)
                val list = mutableListOf<VideoRecord>()
                for (i in 0 until array.length()) {
                    list.add(VideoRecord.fromJson(array.getJSONObject(i)))
                }
                Result.success(list)
            } else {
                Result.failure(Exception("Supabase error: ${response.code} $body"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun upsertVideo(video: VideoRecord): Result<VideoRecord> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/videos"
            val payload = video.toJson().toString()
            val request = createBaseRequestBuilder(url)
                .addHeader("Prefer", "resolution=merge-duplicates,return=representation")
                .post(payload.toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            Result.success(video)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteVideo(id: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/videos?id=eq.$id"
            val request = createBaseRequestBuilder(url).delete().build()
            val response = httpClient.newCall(request).execute()
            Result.success(response.isSuccessful)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ==========================================
    // SITE SETTINGS
    // ==========================================

    suspend fun getSettings(): Result<SiteSettingsRecord> = withContext(Dispatchers.IO) {
        try {
            val url = "${SupabaseConfig.restBaseUrl}/settings?id=eq.site_settings&limit=1"
            val request = createBaseRequestBuilder(url).get().build()
            val response = httpClient.newCall(request).execute()
            val body = response.body?.string().orEmpty()

            if (response.isSuccessful && body.isNotBlank()) {
                val array = JSONArray(body)
                if (array.length() > 0) {
                    Result.success(SiteSettingsRecord.fromJson(array.getJSONObject(0)))
                } else {
                    Result.success(SiteSettingsRecord())
                }
            } else {
                Result.success(SiteSettingsRecord())
            }
        } catch (e: Exception) {
            Result.success(SiteSettingsRecord())
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
