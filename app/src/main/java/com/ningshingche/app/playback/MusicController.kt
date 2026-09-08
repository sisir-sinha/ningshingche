package com.ningshingche.app.playback

import android.content.ComponentName
import android.content.Context
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.ningshingche.app.data.portal.MusicTrack
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
    val hasPrevious: Boolean = false
)

class MusicController(context: Context) {

    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var ticker: Job? = null
    private var pending: (() -> Unit)? = null

    private val _state = MutableStateFlow(MusicPlayerUiState())
    val state: StateFlow<MusicPlayerUiState> = _state.asStateFlow()

    fun ensureConnected() {
        if (controller != null || controllerFuture != null) return
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
                    pending?.invoke()
                    pending = null
                    syncFromPlayer()
                    startTicker()
                }
            },
            ContextCompat.getMainExecutor(appContext)
        )
    }

    fun play(track: MusicTrack, queue: List<MusicTrack>, expand: Boolean = true) {
        val list = queue.filter { it.audioUrl.isNotBlank() }.ifEmpty { listOf(track) }
        val index = list.indexOfFirst { it.id == track.id }.coerceAtLeast(0)
        ensureConnected()
        val start = {
            val player = controller ?: return@start
            player.setMediaItems(list.map { it.toMediaItem() }, index, 0L)
            player.prepare()
            player.play()
            _state.update {
                it.copy(
                    visible = true,
                    expanded = expand,
                    track = list.getOrNull(index) ?: track,
                    queue = list
                )
            }
        }
        if (controller != null) start() else pending = start
        _state.update {
            it.copy(
                visible = true,
                expanded = expand,
                track = list.getOrNull(index) ?: track,
                queue = list
            )
        }
    }

    fun togglePlayPause() {
        val player = controller ?: return
        if (player.isPlaying) player.pause() else player.play()
    }

    fun skipNext() {
        controller?.seekToNextMediaItem()
    }

    fun skipPrevious() {
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

    fun expand() {
        if (_state.value.visible) _state.update { it.copy(expanded = true) }
    }

    fun collapse() {
        _state.update { it.copy(expanded = false) }
    }

    fun dismiss() {
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
            controller?.seekToDefaultPosition(index)
            controller?.play()
            _state.update { it.copy(track = track, expanded = true) }
        } else {
            play(track, queue.ifEmpty { listOf(track) })
        }
    }

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            syncFromPlayer()
        }
    }

    private fun syncFromPlayer() {
        val player = controller ?: return
        val mediaId = player.currentMediaItem?.mediaId
        val queue = _state.value.queue
        val track = queue.firstOrNull { it.id == mediaId } ?: _state.value.track
        val duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 }
            ?: ((track?.durationSeconds ?: 0) * 1000L)
        _state.update {
            it.copy(
                isPlaying = player.isPlaying,
                isBuffering = player.playbackState == Player.STATE_BUFFERING,
                track = track,
                positionMs = player.currentPosition.coerceAtLeast(0L),
                durationMs = duration.coerceAtLeast(0L),
                hasNext = player.hasNextMediaItem(),
                hasPrevious = player.hasPreviousMediaItem() || player.currentPosition > 0L,
                visible = it.visible || player.mediaItemCount > 0
            )
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
}

internal fun MusicTrack.toMediaItem(): MediaItem {
    return MediaItem.Builder()
        .setMediaId(id)
        .setUri(audioUrl)
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
