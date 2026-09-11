package com.ningshingche.app.data.music

import android.content.Context
import android.provider.Settings
import com.ningshingche.app.data.auth.GoogleAuthMapper
import com.ningshingche.app.data.local.AppDatabase
import com.ningshingche.app.data.local.MusicOfflineEntity
import com.ningshingche.app.data.local.MusicPlaylistEntity
import com.ningshingche.app.data.portal.MusicTrack
import com.ningshingche.app.data.remote.SupabaseClient
import com.ningshingche.app.data.remote.SupabaseConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

data class UserPlaylist(
    val id: String,
    val title: String,
    val kind: String,
    val trackIds: List<String>
) {
    val isLoved: Boolean get() = kind == MusicLibraryStore.KIND_LOVED
}

class MusicLibraryStore(
    context: Context,
    private val database: AppDatabase,
    private val supabase: SupabaseClient
) {
    private val appContext = context.applicationContext
    private val dao = database.musicLibraryDao()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    fun ownerId(): String = supabase.currentUser.value?.id?.takeIf { it.isNotBlank() } ?: GUEST

    fun playlists(): Flow<List<UserPlaylist>> =
        supabase.currentUser.flatMapLatest { user ->
            dao.playlists(user?.id?.takeIf { it.isNotBlank() } ?: GUEST)
        }.map { rows -> rows.map { it.toModel() } }

    fun offlineTracks(): Flow<List<MusicTrack>> =
        dao.offline().map { rows -> rows.map { it.toTrack() } }

    fun lovedIds(): Flow<Set<String>> =
        playlists().map { lists ->
            lists.firstOrNull { it.isLoved }?.trackIds?.toSet().orEmpty()
        }

    private val _loveCounts = MutableStateFlow<Map<String, Int>>(emptyMap())
    val loveCounts: StateFlow<Map<String, Int>> = _loveCounts.asStateFlow()

    fun seedLoveCounts(tracks: List<MusicTrack>) {
        if (tracks.isEmpty()) return
        _loveCounts.update { current ->
            current.toMutableMap().apply {
                tracks.forEach { track ->
                    put(track.id, maxOf(this[track.id] ?: 0, track.loveCount))
                }
            }
        }
        // The catalog only loads when there is a connection, which makes this a
        // good moment to push loves that were tapped while offline.
        flushPendingLoves()
    }

    fun offlineFile(trackId: String): File {
        val dir = File(appContext.filesDir, "music")
        if (!dir.exists()) dir.mkdirs()
        return File(dir, "$trackId.mp3")
    }

    fun isOfflineFile(trackId: String): Boolean {
        val file = offlineFile(trackId)
        return file.exists() && file.length() > 0L
    }

    suspend fun isLoved(trackId: String): Boolean = withContext(Dispatchers.IO) {
        val loved = ensureLovedPlaylist()
        trackId in loved.trackIds
    }

    suspend fun toggleLoved(track: MusicTrack): Boolean = withContext(Dispatchers.IO) {
        val loved = ensureLovedPlaylist()
        val ids = loved.trackIds.toMutableList()
        val nowLoved = if (ids.contains(track.id)) {
            ids.remove(track.id)
            false
        } else {
            ids.add(0, track.id)
            true
        }
        savePlaylist(loved.copy(trackIds = ids.distinct()))
        bumpLoveCount(track.id, nowLoved, track.loveCount)
        syncLoveRemote(track.id, nowLoved)
        nowLoved
    }

    suspend fun createPlaylist(title: String): UserPlaylist = withContext(Dispatchers.IO) {
        val name = title.trim().ifBlank { "নতুন প্লেলিস্ট" }
        val playlist = UserPlaylist(
            id = UUID.randomUUID().toString(),
            title = name,
            kind = KIND_CUSTOM,
            trackIds = emptyList()
        )
        savePlaylist(playlist)
        playlist
    }

    suspend fun addToPlaylist(playlistId: String, track: MusicTrack) = withContext(Dispatchers.IO) {
        val current = dao.playlistById(playlistId)?.toModel() ?: return@withContext
        if (current.trackIds.contains(track.id)) return@withContext
        savePlaylist(current.copy(trackIds = current.trackIds + track.id))
    }

    suspend fun removeFromPlaylist(playlistId: String, trackId: String) = withContext(Dispatchers.IO) {
        val current = dao.playlistById(playlistId)?.toModel() ?: return@withContext
        savePlaylist(current.copy(trackIds = current.trackIds.filterNot { it == trackId }))
    }

    suspend fun deletePlaylist(playlistId: String) = withContext(Dispatchers.IO) {
        val userId = ownerId()
        val current = dao.playlistById(playlistId) ?: return@withContext
        if (current.kind == KIND_LOVED) return@withContext
        dao.deletePlaylist(playlistId, userId)
        remoteDelete("music_playlists?id=eq.$playlistId")
    }

    suspend fun download(track: MusicTrack): Result<File> = withContext(Dispatchers.IO) {
        try {
            val dest = offlineFile(track.id)
            if (dest.exists() && dest.length() > 0L) {
                rememberOffline(track, dest)
                return@withContext Result.success(dest)
            }
            val url = track.streamUrl()
            if (url.isBlank()) return@withContext Result.failure(Exception("গানের ফাইল লিংক নেই।"))
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", USER_AGENT)
                .header("Accept", "*/*")
                .get()
                .build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        Exception("সংরক্ষণ যায়নি (${response.code})। লিংক মেয়াদ শেষ হতে পারে।")
                    )
                }
                val body = response.body ?: return@withContext Result.failure(Exception("ফাইল খালি।"))
                val tmp = File(dest.absolutePath + ".part")
                tmp.outputStream().use { output -> body.byteStream().copyTo(output) }
                if (dest.exists()) dest.delete()
                if (!tmp.renameTo(dest)) {
                    tmp.copyTo(dest, overwrite = true)
                    tmp.delete()
                }
            }
            rememberOffline(track, dest)
            Result.success(dest)
        } catch (error: Exception) {
            Result.failure(error)
        }
    }

    suspend fun removeOffline(trackId: String) = withContext(Dispatchers.IO) {
        offlineFile(trackId).delete()
        dao.deleteOffline(trackId)
    }


    private suspend fun rememberOffline(track: MusicTrack, file: File) {
        dao.upsertOffline(
            MusicOfflineEntity(
                trackId = track.id,
                localPath = file.absolutePath,
                title = track.title,
                artist = track.artist,
                album = track.album,
                genre = track.genre,
                description = track.description,
                thumbnailUrl = track.thumbnailUrl,
                audioUrl = track.audioUrl,
                lyrics = track.lyrics,
                durationSeconds = track.durationSeconds
            )
        )
    }

    private suspend fun ensureLovedPlaylist(): UserPlaylist {
        val userId = ownerId()
        val existing = dao.lovedPlaylist(userId)?.toModel()
        if (existing != null) return existing
        val created = UserPlaylist(
            id = UUID.randomUUID().toString(),
            title = LOVED_TITLE,
            kind = KIND_LOVED,
            trackIds = emptyList()
        )
        savePlaylist(created)
        return created
    }

    private suspend fun savePlaylist(playlist: UserPlaylist) {
        val userId = ownerId()
        dao.upsertPlaylist(
            MusicPlaylistEntity(
                id = playlist.id,
                userId = userId,
                title = playlist.title,
                kind = playlist.kind,
                trackIdsCsv = playlist.trackIds.joinToString(","),
                createdAt = System.currentTimeMillis()
            )
        )
        syncPlaylistRemote(playlist, userId)
    }

    private fun bumpLoveCount(trackId: String, liked: Boolean, fallback: Int) {
        _loveCounts.update { map ->
            val current = map[trackId] ?: fallback.coerceAtLeast(0)
            val next = if (liked) current + 1 else (current - 1).coerceAtLeast(0)
            map + (trackId to next)
        }
    }

    /**
     * The love react is public, so it works without an account: the write goes
     * through the `toggle_music_love` RPC, which resolves a signed-in listener
     * from their token and a guest from [deviceId]. The RPC returns the track's
     * fresh, trigger-computed `love_count`, so the number in the UI is the
     * number in the database.
     */
    private fun syncLoveRemote(trackId: String, liked: Boolean) {
        val count = remoteLove(trackId, liked)
        if (count == null) {
            // No connection (or the function is not deployed yet): keep it and
            // replay it the next time the catalog loads.
            rememberPendingLove(trackId, liked)
            return
        }
        forgetPendingLove(trackId)
        applyRemoteLoveCount(trackId, count)
    }

    /** Returns the new public count, or null when the call did not go through. */
    private fun remoteLove(trackId: String, liked: Boolean): Int? {
        val payload = JSONObject()
            .put("p_track_id", trackId)
            .put("p_device_id", deviceId)
            .put("p_loved", liked)
        return remoteRpc(RPC_TOGGLE_LOVE, payload)
    }

    private fun applyRemoteLoveCount(trackId: String, count: Int) {
        _loveCounts.update { map -> map + (trackId to count.coerceAtLeast(0)) }
    }

    private fun lovePrefs() =
        appContext.getSharedPreferences(DEVICE_PREFS, Context.MODE_PRIVATE)

    private fun rememberPendingLove(trackId: String, liked: Boolean) {
        lovePrefs().edit().putBoolean(LOVE_PREFIX + trackId, liked).apply()
    }

    private fun forgetPendingLove(trackId: String) {
        lovePrefs().edit().remove(LOVE_PREFIX + trackId).apply()
    }

    private fun flushPendingLoves() {
        val prefs = lovePrefs()
        val pending = prefs.all.filterKeys { it.startsWith(LOVE_PREFIX) }
        if (pending.isEmpty()) return
        scope.launch {
            pending.forEach { (key, value) ->
                val liked = value as? Boolean ?: return@forEach
                val trackId = key.removePrefix(LOVE_PREFIX)
                val count = remoteLove(trackId, liked) ?: return@forEach
                prefs.edit().remove(key).apply()
                applyRemoteLoveCount(trackId, count)
            }
        }
    }

    /**
     * Stable id for this install. ANDROID_ID is per app signing key + user, so
     * it survives restarts and updates; if a device cannot report one, a random
     * id is generated once and kept in preferences.
     */
    val deviceId: String by lazy {
        val prefs = lovePrefs()
        prefs.getString(KEY_DEVICE_ID, null)?.takeIf { it.isNotBlank() } ?: run {
            val androidId = runCatching {
                Settings.Secure.getString(appContext.contentResolver, Settings.Secure.ANDROID_ID)
            }.getOrNull()
            val value = androidId?.takeIf { it.isNotBlank() && it != LEGACY_ANDROID_ID }
                ?: UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, value).apply()
            value
        }
    }

    private fun canSync(userId: String): Boolean {
        if (userId == GUEST) return false
        return GoogleAuthMapper.isSupabaseJwt(supabase.getAuthToken())
    }

    private fun syncPlaylistRemote(playlist: UserPlaylist, userId: String) {
        if (!canSync(userId)) return
        try {
            val payload = JSONObject()
                .put("id", playlist.id)
                .put("user_id", userId)
                .put("title", playlist.title)
                .put("kind", playlist.kind)
            remoteUpsert("music_playlists", payload)
            remoteDelete("music_playlist_tracks?playlist_id=eq.${playlist.id}")
            playlist.trackIds.forEachIndexed { index, trackId ->
                val row = JSONObject()
                    .put("playlist_id", playlist.id)
                    .put("track_id", trackId)
                    .put("sort_order", index)
                remoteUpsert("music_playlist_tracks", row)
            }
        } catch (_: Exception) {
            // Room is the working copy; cloud tables may not exist yet.
        }
    }

    /**
     * Calls a PostgREST RPC. Signed in, the listener's JWT identifies them;
     * signed out, the publishable key is sent as the bearer, which PostgREST
     * resolves to the `anon` role — the only way a guest's love can be written.
     */
    private fun remoteRpc(name: String, payload: JSONObject): Int? {
        val token = supabase.getAuthToken()?.takeIf { GoogleAuthMapper.isSupabaseJwt(it) }
        val request = Request.Builder()
            .url("${SupabaseConfig.restBaseUrl}/rpc/$name")
            .addHeader("apikey", SupabaseConfig.supabaseKey)
            .addHeader("Authorization", "Bearer ${token ?: SupabaseConfig.supabaseKey}")
            .addHeader("Content-Type", "application/json")
            .post(payload.toString().toRequestBody(jsonType))
            .build()
        return try {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                // A scalar-returning function yields a bare number; tolerate a
                // one-element array just in case.
                response.body?.string()?.trim()?.trim('[', ']')?.toIntOrNull()
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun remoteUpsert(table: String, payload: JSONObject) {
        val token = supabase.getAuthToken() ?: return
        val url = "${SupabaseConfig.restBaseUrl}/$table"
        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SupabaseConfig.supabaseKey)
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
            .post(payload.toString().toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { it.body?.close() }
    }

    private fun remoteDelete(pathAndQuery: String) {
        val token = supabase.getAuthToken() ?: return
        if (!GoogleAuthMapper.isSupabaseJwt(token)) return
        val url = "${SupabaseConfig.restBaseUrl}/$pathAndQuery"
        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SupabaseConfig.supabaseKey)
            .addHeader("Authorization", "Bearer $token")
            .delete()
            .build()
        http.newCall(request).execute().use { it.body?.close() }
    }

    companion object {
        const val GUEST = "guest"
        const val KIND_LOVED = "loved"
        const val KIND_CUSTOM = "custom"
        const val LOVED_TITLE = "পছন্দের গান"
        const val USER_AGENT = "NingshingChe/1.0 (Android Music)"

        /** Migration 022 — loves a track for a guest as well as a signed-in user. */
        private const val RPC_TOGGLE_LOVE = "toggle_music_love"
        private const val DEVICE_PREFS = "ningshingche_device"
        private const val KEY_DEVICE_ID = "device_id"
        private const val LOVE_PREFIX = "love_pending:"

        /** The emulator/older builds' shared ANDROID_ID is not unique; ignore it. */
        private const val LEGACY_ANDROID_ID = "9774d56d682e549c"
    }
}

fun MusicTrack.streamUrl(preferStorage: Boolean = false): String {
    val publicStorage = storagePath.takeIf { it.isNotBlank() }?.let { path ->
        val clean = path.trim().trimStart('/')
        "${SupabaseConfig.supabaseUrl.trimEnd('/')}/storage/v1/object/public/music/$clean"
    }.orEmpty()
    val signed = audioUrl.contains("X-Amz-Algorithm", ignoreCase = true) ||
        audioUrl.contains("X-Goog-Algorithm", ignoreCase = true) ||
        audioUrl.contains("token=", ignoreCase = true)
    return when {
        preferStorage && publicStorage.isNotBlank() -> publicStorage
        signed && publicStorage.isNotBlank() -> publicStorage
        fileProvider == "supabase-storage" && publicStorage.isNotBlank() -> publicStorage
        audioUrl.isNotBlank() -> audioUrl
        else -> publicStorage
    }
}

private fun MusicPlaylistEntity.toModel(): UserPlaylist = UserPlaylist(
    id = id,
    title = title,
    kind = kind,
    trackIds = trackIdsCsv.split(',').map { it.trim() }.filter { it.isNotBlank() }
)

private fun MusicOfflineEntity.toTrack(): MusicTrack = MusicTrack(
    id = trackId,
    title = title,
    artist = artist,
    album = album,
    genre = genre,
    description = description,
    thumbnailUrl = thumbnailUrl,
    audioUrl = audioUrl,
    lyrics = lyrics,
    durationSeconds = durationSeconds,
    fileSizeMb = 0.0
)
