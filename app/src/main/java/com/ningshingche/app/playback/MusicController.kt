@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package com.ningshingche.app.playback

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.ningshingche.app.data.music.MusicLibraryStore
import com.ningshingche.app.data.music.UserPlaylist
import com.ningshingche.app.data.music.streamUrl
import com.ningshingche.app.data.portal.MusicTrack
import com.ningshingche.app.ui.components.AppToasts
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class RepeatMode { OFF, ALL, ONE }

data class MusicPlayerUiState(
    val visible: Boolean = false,
    val expanded: Boolean = false,
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val track: MusicTrack? = null,
    val queue: List<MusicTrack> = emptyList(),
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val hasNext: Boolean = false,
    val hasPrevious: Boolean = false,
    val shuffle: Boolean = false,
    val repeatMode: RepeatMode = RepeatMode.OFF,
    val autoPlay: Boolean = true,
    val liked: Boolean = false,
    val offline: Boolean = false,
    val downloading: Boolean = false,
    val showLyrics: Boolean = false,
    val showVideo: Boolean = false,
    val sleepUntilMs: Long? = null,
    val statusMessage: String? = null,
    val error: String? = null
)

class MusicController(
    context: Context,
    val library: MusicLibraryStore
) {

    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var ticker: Job? = null
    private var sleepJob: Job? = null
    private var pending: (() -> Unit)? = null
    private var retriedStorage = false
    private var resumeAfterVideo = false

    private val _state = MutableStateFlow(MusicPlayerUiState())
    val state: StateFlow<MusicPlayerUiState> = _state.asStateFlow()

    private val isRobolectric: Boolean by lazy {
        android.os.Build.FINGERPRINT == "robolectric" ||
            runCatching { Class.forName("org.robolectric.Robolectric") }.isSuccess
    }

    fun ensureConnected() {
        if (isRobolectric) return
        if (controller != null) return
        val existing = controllerFuture
        if (existing != null && !existing.isDone) return
        if (existing != null && existing.isDone && controller == null) {
            controllerFuture = null
        }
        val token = SessionToken(
            appContext,
            ComponentName(appContext, MusicPlaybackService::class.java)
        )
        val future = MediaController.Builder(appContext, token).buildAsync()
        controllerFuture = future
        future.addListener(
            {
                runCatching {
                    val ready = future.get()
                    controller = ready
                    ready.addListener(listener)
                    applyPlaybackFlags(ready)
                    pending?.invoke()
                    pending = null
                    syncFromPlayer()
                    startTicker()
                }.onFailure {
                    controllerFuture = null
                    val message = "প্লেয়ার চালু হয়নি। আবার চেষ্টা করুন।"
                    _state.update { it.copy(error = message) }
                    AppToasts.show(message)
                }
            },
            ContextCompat.getMainExecutor(appContext)
        )
    }

    fun play(track: MusicTrack, queue: List<MusicTrack>, expand: Boolean = true) {
        val list = queue.filter { it.hasPlayableSource() }.ifEmpty {
            listOf(track).filter { it.hasPlayableSource() }
        }
        if (list.isEmpty()) {
            _state.update {
                it.copy(
                    visible = true,
                    expanded = expand,
                    track = track,
                    error = "এই গানের অডিও ফাইল নেই।"
                )
            }
            AppToasts.show("এই গানের অডিও ফাইল নেই।")
            return
        }
        val index = list.indexOfFirst { it.id == track.id }.coerceAtLeast(0)
        retriedStorage = false
        ensureConnected()
        val start = {
            val player = controller
            if (player != null) {
                applyPlaybackFlags(player)
                player.setMediaItems(list.map { it.toMediaItem(library) }, index, 0L)
                player.prepare()
                player.playWhenReady = true
                player.play()
            }
        }
        if (controller != null) start() else pending = start
        _state.update {
            it.copy(
                visible = true,
                expanded = expand,
                track = list.getOrNull(index) ?: track,
                queue = list,
                error = null,
                statusMessage = null,
                showLyrics = false,
                showVideo = false
            )
        }
        refreshTrackFlags(list.getOrNull(index) ?: track)
        prefetch(list.drop(index).take(3), MusicStreamCache.NEXT_BYTES)
    }

    fun prefetchCatalog(tracks: List<MusicTrack>) {
        prefetch(tracks, MusicStreamCache.HEAD_BYTES, limit = 12)
    }

    private fun prefetch(tracks: List<MusicTrack>, bytes: Long, limit: Int = tracks.size) {
        if (tracks.isEmpty()) return
        scope.launch(Dispatchers.IO) {
            runCatching {
                MusicStreamCache.prefetch(appContext, tracks, library, bytes = bytes, limit = limit)
            }
        }
    }

    fun togglePlayPause() {
        if (_state.value.showVideo) {
            hideVideo(resumeAudio = true)
            return
        }
        val player = controller ?: return
        if (player.isPlaying) player.pause() else player.play()
    }

    fun skipNext() {
        hideVideo(resumeAudio = false)
        controller?.seekToNextMediaItem()
    }

    fun skipPrevious() {
        hideVideo(resumeAudio = false)
        val player = controller ?: return
        if (player.currentPosition > 3_000L) {
            player.seekTo(0L)
        } else {
            player.seekToPreviousMediaItem()
        }
    }

    fun seekTo(positionMs: Long) {
        controller?.seekTo(positionMs.coerceAtLeast(0L))
        _state.update { it.copy(positionMs = positionMs.coerceAtLeast(0L)) }
    }

    fun seekBy(deltaMs: Long) {
        val player = controller ?: return
        val duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: _state.value.durationMs
        val next = (player.currentPosition + deltaMs).coerceIn(0L, duration.coerceAtLeast(0L))
        player.seekTo(next)
        _state.update { it.copy(positionMs = next) }
    }

    fun expand() {
        if (_state.value.visible) _state.update { it.copy(expanded = true) }
    }

    fun collapse() {
        _state.update { it.copy(expanded = false) }
    }

    fun dismiss() {
        clearSleepTimer()
        controller?.run {
            pause()
            stop()
            clearMediaItems()
        }
        _state.value = MusicPlayerUiState()
    }

    fun playQueueItem(track: MusicTrack) {
        val queue = _state.value.queue
        val index = queue.indexOfFirst { it.id == track.id }
        if (index >= 0) {
            hideVideo(resumeAudio = false)
            controller?.seekToDefaultPosition(index)
            controller?.play()
            _state.update { it.copy(track = track, expanded = true, error = null, showVideo = false) }
            refreshTrackFlags(track)
        } else {
            play(track, queue.ifEmpty { listOf(track) })
        }
    }

    fun toggleShuffle() {
        setShuffle(!_state.value.shuffle, announce = true)
    }

    fun setShuffle(enabled: Boolean, announce: Boolean = false) {
        controller?.shuffleModeEnabled = enabled
        _state.update { it.copy(shuffle = enabled) }
        if (announce) {
            if (enabled) {
                AppToasts.undo("Shuffle Turned ON") { setShuffle(false, announce = false) }
            } else {
                AppToasts.show("Shuffle Turned OFF")
            }
        }
    }

    fun cycleRepeat() {
        val next = when (_state.value.repeatMode) {
            RepeatMode.OFF -> RepeatMode.ALL
            RepeatMode.ALL -> RepeatMode.ONE
            RepeatMode.ONE -> RepeatMode.OFF
        }
        controller?.repeatMode = next.toPlayerRepeat()
        _state.update { it.copy(repeatMode = next) }
    }

    fun toggleAutoPlay() {
        val next = !_state.value.autoPlay
        _state.update { it.copy(autoPlay = next) }
        if (next) {
            AppToasts.undo("Autoplay Turned ON") {
                _state.update { it.copy(autoPlay = false) }
            }
        } else {
            AppToasts.show("Autoplay Turned OFF")
        }
    }

    fun toggleLyrics() {
        if (_state.value.showVideo) hideVideo(resumeAudio = false)
        _state.update { it.copy(showLyrics = !it.showLyrics) }
    }

    fun toggleVideo() {
        val track = _state.value.track ?: return
        if (track.videoLink.isBlank()) return
        if (_state.value.showVideo) {
            hideVideo(resumeAudio = true)
            return
        }
        resumeAfterVideo = _state.value.isPlaying
        controller?.pause()
        _state.update { it.copy(showVideo = true, showLyrics = false) }
    }

    fun hideVideo(resumeAudio: Boolean = false) {
        if (!_state.value.showVideo) return
        val shouldResume = resumeAudio && resumeAfterVideo
        resumeAfterVideo = false
        _state.update { it.copy(showVideo = false) }
        if (shouldResume) controller?.play()
    }

    fun toggleLike() {
        val track = _state.value.track ?: return
        scope.launch {
            val liked = withContext(Dispatchers.IO) { library.toggleLoved(track) }
            _state.update { it.copy(liked = liked) }
            if (liked) {
                AppToasts.undo("Added to Liked Songs") {
                    scope.launch {
                        withContext(Dispatchers.IO) { library.toggleLoved(track) }
                        _state.update { it.copy(liked = false) }
                    }
                }
            } else {
                AppToasts.show("Removed from Liked Songs")
            }
        }
    }

    fun saveCurrentOffline() {
        val track = _state.value.track ?: return
        if (_state.value.downloading) return
        _state.update { it.copy(downloading = true, error = null) }
        scope.launch {
            val result = withContext(Dispatchers.IO) { library.download(track) }
            val saved = result.isSuccess || library.isOfflineFile(track.id)
            _state.update {
                it.copy(
                    downloading = false,
                    offline = saved,
                    error = result.exceptionOrNull()?.message
                )
            }
            if (saved) {
                AppToasts.undo("Song downloaded for offline") {
                    scope.launch {
                        withContext(Dispatchers.IO) { library.removeOffline(track.id) }
                        _state.update { it.copy(offline = false) }
                    }
                }
            } else {
                AppToasts.show(result.exceptionOrNull()?.message ?: "Download failed")
            }
        }
    }

    fun addCurrentToPlaylist(playlistId: String) {
        val track = _state.value.track ?: return
        scope.launch {
            withContext(Dispatchers.IO) { library.addToPlaylist(playlistId, track) }
            AppToasts.undo("Added to playlist") {
                scope.launch {
                    withContext(Dispatchers.IO) { library.removeFromPlaylist(playlistId, track.id) }
                }
            }
        }
    }

    suspend fun createPlaylist(title: String): UserPlaylist =
        withContext(Dispatchers.IO) { library.createPlaylist(title) }

    fun setSleepTimer(minutes: Int) {
        sleepJob?.cancel()
        if (minutes <= 0) {
            _state.update { it.copy(sleepUntilMs = null, statusMessage = "স্লিপ টাইমার বন্ধ") }
            return
        }
        val until = System.currentTimeMillis() + minutes * 60_000L
        _state.update { it.copy(sleepUntilMs = until, statusMessage = "স্লিপ টাইমার $minutes মিনিট") }
        sleepJob = scope.launch {
            delay(minutes * 60_000L)
            controller?.pause()
            _state.update { it.copy(sleepUntilMs = null, statusMessage = "স্লিপ টাইমার শেষ") }
        }
    }

    fun clearStatus() {
        _state.update { it.copy(statusMessage = null) }
    }

    private fun refreshTrackFlags(track: MusicTrack) {
        scope.launch {
            val liked = withContext(Dispatchers.IO) { library.isLoved(track.id) }
            _state.update {
                it.copy(
                    liked = liked,
                    offline = library.isOfflineFile(track.id)
                )
            }
        }
    }

    private fun applyPlaybackFlags(player: Player) {
        val current = _state.value
        player.shuffleModeEnabled = current.shuffle
        player.repeatMode = current.repeatMode.toPlayerRepeat()
    }

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            syncFromPlayer()
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO && !_state.value.autoPlay) {
                controller?.pause()
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            val track = _state.value.track
            val player = controller
            if (!retriedStorage && track != null && player != null && track.storagePath.isNotBlank()) {
                retriedStorage = true
                val index = player.currentMediaItemIndex.coerceAtLeast(0)
                player.replaceMediaItem(index, track.toMediaItem(library, preferStorage = true))
                player.prepare()
                player.play()
                return
            }
            val detail = (error.cause?.message ?: error.message).orEmpty()
            val message = when {
                detail.contains("403") || detail.contains("401") ||
                    detail.contains("Permission") || detail.contains("403 Forbidden") ->
                    "গানের লিংক মেয়াদ শেষ বা বন্ধ। ড্যাশবোর্ড থেকে MP3 আবার আপলোড করুন।"
                detail.contains("404") -> "গানের ফাইল পাওয়া যায়নি।"
                detail.contains("Unable to connect", true) || detail.contains("UnknownHost") ->
                    "ইন্টারনেট সংযোগ নেই।"
                else -> "গান বাজানো যায়নি। ফাইল লিংক যাচাই করুন।"
            }
            _state.update { it.copy(isPlaying = false, isBuffering = false, error = message) }
            AppToasts.show(message)
        }
    }

    private fun syncFromPlayer() {
        val player = controller ?: return
        val mediaId = player.currentMediaItem?.mediaId
        val queue = _state.value.queue
        val track = queue.firstOrNull { it.id == mediaId } ?: _state.value.track
        val duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 }
            ?: ((track?.durationSeconds ?: 0) * 1000L)
        val previousId = _state.value.track?.id
        _state.update {
            it.copy(
                isPlaying = player.isPlaying,
                isBuffering = player.playbackState == Player.STATE_BUFFERING,
                track = track,
                positionMs = player.currentPosition.coerceAtLeast(0L),
                durationMs = duration.coerceAtLeast(0L),
                hasNext = player.hasNextMediaItem(),
                hasPrevious = player.hasPreviousMediaItem() || player.currentPosition > 0L,
                visible = it.visible || player.mediaItemCount > 0,
                shuffle = player.shuffleModeEnabled,
                repeatMode = player.repeatMode.toUiRepeat(),
                error = if (player.playerError == null) it.error else it.error
            )
        }
        if (track != null && track.id != previousId) {
            retriedStorage = false
            refreshTrackFlags(track)
            val index = queue.indexOfFirst { it.id == track.id }
            if (index >= 0) prefetch(queue.drop(index + 1).take(2), MusicStreamCache.NEXT_BYTES)
        }
    }

    private fun startTicker() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                val player = controller
                if (player != null && _state.value.visible) {
                    val duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 }
                        ?: _state.value.durationMs
                    _state.update {
                        it.copy(
                            isPlaying = player.isPlaying,
                            isBuffering = player.playbackState == Player.STATE_BUFFERING,
                            positionMs = player.currentPosition.coerceAtLeast(0L),
                            durationMs = duration.coerceAtLeast(0L)
                        )
                    }
                }
                delay(400)
            }
        }
    }

    private fun clearSleepTimer() {
        sleepJob?.cancel()
        sleepJob = null
    }
}

internal fun MusicTrack.toMediaItem(
    library: MusicLibraryStore,
    preferStorage: Boolean = false
): MediaItem {
    val local = library.offlineFile(id)
    val uri: Uri = if (local.exists() && local.length() > 0L) {
        Uri.fromFile(local)
    } else {
        streamUrl(preferStorage).toUri()
    }
    return MediaItem.Builder()
        .setMediaId(id)
        .setUri(uri)
        .setCustomCacheKey(id)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(title)
                .setArtist(artist.ifBlank { "নিংশিং চে" })
                .setAlbumTitle(album.takeIf { it.isNotBlank() })
                .setArtworkUri(thumbnailUrl.takeIf { it.isNotBlank() }?.toUri())
                .setGenre(genre.takeIf { it.isNotBlank() })
                .setDescription(description.takeIf { it.isNotBlank() })
                .build()
        )
        .build()
}

private fun RepeatMode.toPlayerRepeat(): Int = when (this) {
    RepeatMode.OFF -> Player.REPEAT_MODE_OFF
    RepeatMode.ALL -> Player.REPEAT_MODE_ALL
    RepeatMode.ONE -> Player.REPEAT_MODE_ONE
}

private fun Int.toUiRepeat(): RepeatMode = when (this) {
    Player.REPEAT_MODE_ONE -> RepeatMode.ONE
    Player.REPEAT_MODE_ALL -> RepeatMode.ALL
    else -> RepeatMode.OFF
}
