package com.ningshingche.app.data.music

import android.content.Context
import com.ningshingche.app.data.auth.GoogleAuthMapper
import com.ningshingche.app.data.local.AppDatabase
import com.ningshingche.app.data.local.MusicOfflineEntity
import com.ningshingche.app.data.local.MusicPlaylistEntity
import com.ningshingche.app.data.portal.MusicTrack
import com.ningshingche.app.data.remote.SupabaseClient
import com.ningshingche.app.data.remote.SupabaseConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
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

    suspend fun offlineTrack(trackId: String): MusicTrack? = withContext(Dispatchers.IO) {
        dao.offlineById(trackId)?.toTrack()
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
