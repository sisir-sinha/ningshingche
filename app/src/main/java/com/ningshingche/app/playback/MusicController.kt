@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

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
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.ningshingche.app.ui.i18n.tNow

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
    val volume: Float = 1f,
    /** The track's public play count, as the database last reported it. */
    val viewsCount: Long = 0L,
    val offline: Boolean = false,
    val downloading: Boolean = false,
    val showLyrics: Boolean = false,
    val showVideo: Boolean = false,
    val sleepUntilMs: Long? = null,
    val statusMessage: String? = null,
    val error: String? = null
)

/**
 * A play is worth counting once thirty seconds of the track have been heard — or
 * half of it, for a track shorter than a minute ([MusicController.validListenMs]).
 * The same number is the threshold in the database's `music_valid_seconds`.
 */
private const val VALID_LISTEN_MS = 30_000L

/** How often the minutes of a continuing listen are reported. */
private const val LISTEN_REPORT_MS = 60_000L

/**
 * The most the position can advance between two ticks (400 ms) before the jump is
 * a seek rather than playback. Generous, because a buffering player can report a
 * slightly larger step than the tick interval.
 */
private const val MAX_TICK_ADVANCE_MS = 2_000L

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

    /**
     * Called with the seconds of a song that were actually *heard* since the last
     * report — the application wires it to the view counter, and keeping it a
     * plain callback leaves the player free of any knowledge of the network.
     *
     * It fires once the track has been listened to for long enough to be a play,
     * every [LISTEN_REPORT_MS] after that, and once more when the listening stops
     * — paused, finished, or the next song started. The database decides what the
     * seconds are worth: it counts the play and keeps the minutes.
     */
    var onListened: ((String, Int) -> Unit)? = null

    /** The last track the UI was told about, so the count resets once per track. */
    private var lastAnnouncedViewId: String? = null

    // --- What has actually been heard of the track that is playing -----------
    //
    // A play used to be counted the moment a track *started*, which is a count of
    // taps rather than of listening: skip through ten songs in ten seconds and
    // ten plays were recorded. The meter below reads the player's position on
    // every tick and adds only what moved while it was playing, so a seek, a
    // rewind and a buffering stall contribute nothing.
    private var meterTrackId: String = ""

    /**
     * The threshold of the track the meter is *on*, not of whatever is playing now:
     * when a song ends, the listening being flushed belongs to the song that ended,
     * and it has to be judged by that song's length.
     */
    private var meterValidMs: Long = VALID_LISTEN_MS
    private var listenedMs: Long = 0L
    private var reportedMs: Long = 0L
    private var lastPositionMs: Long = 0L

    private val _state = MutableStateFlow(MusicPlayerUiState())
    val state: StateFlow<MusicPlayerUiState> = _state.asStateFlow()

    /**
     * Id of the track the player is on, or `""` when nothing is loaded.
     *
     * A list of songs has to mark the row that is playing, and collecting
     * [state] for that would recompose every row on every position tick.
     * This collapses to one emission per track change.
     */
    val nowPlayingId: StateFlow<String> = _state
        .map { it.track?.id.orEmpty() }
        .distinctUntilChanged()
        .stateIn(scope, SharingStarted.Eagerly, "")

    /** Whether the loaded track is actually playing, for the same reason as [nowPlayingId]. */
    val isPlayingNow: StateFlow<Boolean> = _state
        .map { it.isPlaying }
        .distinctUntilChanged()
        .stateIn(scope, SharingStarted.Eagerly, false)

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
                    val message = tNow("প্লেয়ার চালু হয়নি। আবার চেষ্টা করুন।")
                    _state.update { it.copy(error = message) }
                    AppToasts.show(message)
                }
            },
            ContextCompat.getMainExecutor(appContext)
        )
    }

    fun play(track: MusicTrack, queue: List<MusicTrack>, expand: Boolean = true) {
        // Tapping the row of the song that is already loaded only brings the
        // player back up. Rebuilding the media items would restart the track at
        // 0:00 and throw away the listener's place in it, which is not what a
        // second tap on the same song means.
        val loaded = _state.value
        val player = controller
        if (player != null && loaded.visible && loaded.track?.id == track.id) {
            _state.update { it.copy(expanded = expand, error = null) }
            if (!player.isPlaying) {
                applyPlaybackFlags(player)
                player.play()
            }
            return
        }
        val list = queue.filter { it.hasPlayableSource() }.ifEmpty {
            listOf(track).filter { it.hasPlayableSource() }
        }
        if (list.isEmpty()) {
            _state.update {
                it.copy(
                    visible = true,
                    expanded = expand,
                    track = track,
                    error = tNow("এই গানের অডিও ফাইল নেই।")
                )
            }
            AppToasts.show(tNow("এই গানের অডিও ফাইল নেই।"))
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
        announceStarted(list.getOrNull(index) ?: track)
        prefetch(list.drop(index).take(3), MusicStreamCache.NEXT_BYTES)
    }

    fun prefetchCatalog(tracks: List<MusicTrack>) {
        library.seedLoveCounts(tracks)
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

    /**
     * Puts the track's own count on screen while the database's answer is on its
     * way. The report itself is not sent from here any more: a play is worth
     * counting once it has been listened to, which is [meterListening]'s job.
     */
    private fun announceStarted(track: MusicTrack) {
        if (track.id == lastAnnouncedViewId) return
        lastAnnouncedViewId = track.id
        _state.update { it.copy(viewsCount = track.viewsCount) }
    }

    /**
     * How long a song has to be heard before it counts as a play.
     *
     * Thirty seconds, or half the track when the track is shorter than a minute —
     * the same rule the database applies in `music_valid_seconds`, computed from
     * the same number (the catalogue's duration, not the player's, so the two
     * cannot disagree about a file whose metadata is wrong).
     */
    private fun validListenMs(track: MusicTrack?): Long {
        val seconds = track?.durationSeconds ?: 0
        if (seconds <= 0) return VALID_LISTEN_MS
        val half = ((seconds + 1) / 2).toLong() * 1000L
        return minOf(VALID_LISTEN_MS, half)
    }

    /**
     * Keeps the meter, and reports when there is something to report.
     *
     * Called from the ticker that is already running for the progress bar, so
     * this costs nothing extra: the position it reads is the position that bar is
     * drawn from.
     */
    private fun meterListening(player: MediaController, track: MusicTrack?) {
        val id = track?.id.orEmpty()
        if (id != meterTrackId) {
            // The previous song keeps whatever it earned before the switch — judged
            // by its own threshold, which is why the flush happens first.
            reportListening()
            meterTrackId = id
            meterValidMs = validListenMs(track)
            listenedMs = 0L
            reportedMs = 0L
            lastPositionMs = player.currentPosition
            return
        }
        if (id.isBlank()) return

        val position = player.currentPosition
        val delta = position - lastPositionMs
        lastPositionMs = position

        // Only forward movement, and only as much as a tick can play: a seek
        // throws the position by minutes, a rewind sends it negative, and a stall
        // repeats it. None of the three is listening.
        if (player.isPlaying && delta in 0..MAX_TICK_ADVANCE_MS) listenedMs += delta

        if (!player.isPlaying) {
            // Paused, finished or stopped: send what has been heard and wait.
            reportListening()
            return
        }
        val due = if (reportedMs == 0L) meterValidMs else reportedMs + LISTEN_REPORT_MS
        if (listenedMs >= due) reportListening()
    }

    /**
     * Sends the listening the database has not been told about yet.
     *
     * Nothing is sent for a track that has not reached its own threshold — that
     * play does not exist yet, and the database would refuse the seconds anyway.
     * Once it has been reached, the tail of the listening is sent too, so a
     * paused or finished song keeps the minutes it earned.
     */
    private fun reportListening() {
        val id = meterTrackId
        if (id.isBlank()) return
        if (reportedMs == 0L && listenedMs < meterValidMs) return
        val seconds = ((listenedMs - reportedMs) / 1000L).toInt()
        if (seconds <= 0) return
        reportedMs = listenedMs
        onListened?.invoke(id, seconds)
    }

    /**
     * Applies the total the database reported for [trackId].
     *
     * Ignored when the listener has already moved on: the answer belongs to the
     * song that started it, not to whatever is playing by the time it lands.
     */
    fun applyServerViewCount(trackId: String, count: Long) {
        val current = _state.value
        if (current.track?.id != trackId) return
        _state.update { it.copy(viewsCount = count.coerceAtLeast(0L)) }
    }

    fun expand() {
        if (_state.value.visible) _state.update { it.copy(expanded = true) }
    }

    /**
     * Sets the playback volume, `0f`…`1f`.
     *
     * The value is kept in the UI state as well as pushed to the player, so a
     * drag on the artwork while the media session is still connecting lands on
     * the right volume instead of being forgotten.
     */
    fun setVolume(value: Float) {
        val clamped = value.coerceIn(0f, 1f)
        controller?.volume = clamped
        _state.update { it.copy(volume = clamped) }
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
        // The volume the listener chose outlives the player being closed.
        _state.value = MusicPlayerUiState(volume = _state.value.volume)
    }

    fun playQueueItem(track: MusicTrack) {
        val queue = _state.value.queue
        val index = queue.indexOfFirst { it.id == track.id }
        if (index >= 0) {
            // Same rule as [play]: a second tap on the song that is already up
            // keeps its position instead of starting it over.
            val alreadyLoaded = _state.value.track?.id == track.id
            hideVideo(resumeAudio = false)
            if (!alreadyLoaded) controller?.seekToDefaultPosition(index)
            val player = controller
            if (player != null && !player.isPlaying) player.play()
            _state.update {
                it.copy(
                    track = track,
                    expanded = true,
                    error = null,
                    showVideo = false,
                    viewsCount = if (alreadyLoaded) it.viewsCount else track.viewsCount
                )
            }
            refreshTrackFlags(track)
            if (!alreadyLoaded) announceStarted(track)
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
        toggleLikeFor(track)
    }

    fun toggleLikeFor(track: MusicTrack) {
        scope.launch {
            val liked = withContext(Dispatchers.IO) { library.toggleLoved(track) }
            if (_state.value.track?.id == track.id) {
                _state.update { it.copy(liked = liked) }
            }
            if (liked) {
                AppToasts.undo("Added to Liked Songs") {
                    scope.launch {
                        withContext(Dispatchers.IO) { library.toggleLoved(track) }
                        if (_state.value.track?.id == track.id) {
                            _state.update { it.copy(liked = false) }
                        }
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
            _state.update { it.copy(sleepUntilMs = null, statusMessage = tNow("স্লিপ টাইমার বন্ধ")) }
            return
        }
        val until = System.currentTimeMillis() + minutes * 60_000L
        _state.update { it.copy(sleepUntilMs = until, statusMessage = tNow("স্লিপ টাইমার {1} মিনিট", minutes)) }
        sleepJob = scope.launch {
            delay(minutes * 60_000L)
            controller?.pause()
            _state.update { it.copy(sleepUntilMs = null, statusMessage = tNow("স্লিপ টাইমার শেষ")) }
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
        player.volume = current.volume.coerceIn(0f, 1f)
    }

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            syncFromPlayer()
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO && !_state.value.autoPlay) {
                controller?.pause()
            }
            // Auto-advance and a press of next both land here, and both mean a
            // new song has started, so both are a play to count. A playlist
            // being (re)built is not: that reason is filtered out, and the
            // explicit announce in play() covers the track the listener chose.
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO ||
                reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK
            ) {
                val id = mediaItem?.mediaId
                val started = _state.value.queue.firstOrNull { it.id == id }
                if (started != null) announceStarted(started)
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
                    tNow("গানের লিংক মেয়াদ শেষ বা বন্ধ। ড্যাশবোর্ড থেকে MP3 আবার আপলোড করুন।")
                detail.contains("404") -> tNow("গানের ফাইল পাওয়া যায়নি।")
                detail.contains("Unable to connect", true) || detail.contains("UnknownHost") ->
                    tNow("ইন্টারনেট সংযোগ নেই।")
                else -> tNow("গান বাজানো যায়নি। ফাইল লিংক যাচাই করুন।")
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
                    // The same position the bar above is drawn from is what the
                    // listening meter counts, and what it counts is what the
                    // database is told.
                    meterListening(player, _state.value.track)
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
                .setArtist(artist.ifBlank { tNow("নিংশিং চে") })
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
