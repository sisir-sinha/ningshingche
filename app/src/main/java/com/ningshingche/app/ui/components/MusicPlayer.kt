package com.ningshingche.app.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.automirrored.filled.PlaylistPlay
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Lyrics
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ningshingche.app.data.music.UserPlaylist
import com.ningshingche.app.data.portal.MusicTrack
import com.ningshingche.app.playback.MusicController
import com.ningshingche.app.playback.MusicPlayerUiState
import com.ningshingche.app.playback.RepeatMode
import com.ningshingche.app.ui.editorial.EditorialImage
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.editorial.SocialEmbedPlayer
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.PortalMaroon
import com.ningshingche.app.ui.theme.PortalSaffron
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

val LocalMusicController = staticCompositionLocalOf<MusicController> {
    error("MusicController is not provided")
}

private enum class PlayerSheet { None, Menu, Playlist, Details, Sleep, NewPlaylist }

/** How far the player has to be pulled down before letting go puts it away. */
private val PlayerMinimizeDrag = 110.dp

/** Drag on the artwork that covers the whole volume range, quiet to loud. */
private val CoverVolumeDrag = 260.dp

/**
 * Drag on the artwork that counts as "put the player away" instead of a volume
 * change. Longer than [PlayerMinimizeDrag] because the artwork's own gesture is
 * volume, and only a deliberate pull should mean minimize there.
 */
private val CoverMinimizeDrag = 190.dp

@Composable
fun MusicMiniPlayerBar(controller: MusicController) {
    val state by controller.state.collectAsState()
    if (!state.visible || state.expanded || state.track == null) return
    MiniMusicPlayer(
        state = state,
        onExpand = controller::expand,
        onToggle = controller::togglePlayPause,
        onNext = controller::skipNext,
        onDismiss = controller::dismiss
    )
}

@Composable
fun MusicFullPlayerOverlay(controller: MusicController) {
    val state by controller.state.collectAsState()
    if (!state.visible || state.track == null) return

    LaunchedEffect(state.statusMessage) {
        if (!state.statusMessage.isNullOrBlank()) {
            delay(2800)
            controller.clearStatus()
        }
    }

    AnimatedVisibility(
        visible = state.expanded,
        enter = fadeIn() + slideInVertically { it / 6 },
        exit = fadeOut() + slideOutVertically { it / 6 },
        modifier = Modifier.fillMaxSize()
    ) {
        FullMusicPlayer(controller = controller, state = state)
    }
}

@Composable
private fun MiniMusicPlayer(
    state: MusicPlayerUiState,
    onExpand: () -> Unit,
    onToggle: () -> Unit,
    onNext: () -> Unit,
    onDismiss: () -> Unit
) {
    val track = state.track ?: return
    val tokens = LocalEditorialTokens.current
    val progress = if (state.durationMs > 0) {
        (state.positionMs.toFloat() / state.durationMs.toFloat()).coerceIn(0f, 1f)
    } else 0f

    Surface(
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 8.dp,
        shadowElevation = 12.dp,
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(2.dp)
                    .background(tokens.rule)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(progress)
                        .height(2.dp)
                        .background(tokens.accent)
                )
            }
            // Compact strip: the bar only has to say what is playing and give
            // pause / next / close, so it stays as short as the controls allow.
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onExpand)
                    .padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                CoverArt(url = track.thumbnailUrl, modifier = Modifier.size(42.dp), corner = 8.dp)
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = track.title,
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = track.artist.ifBlank { "নিংশিং চে" },
                        fontFamily = Kalpurush,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = tokens.inkMuted
                    )
                }
                MiniPlayerButton(onClick = onToggle) {
                    Icon(
                        imageVector = if (state.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (state.isPlaying) "বিরতি" else "চালান",
                        tint = tokens.accent,
                        modifier = Modifier.size(22.dp)
                    )
                }
                MiniPlayerButton(onClick = onNext, enabled = state.hasNext) {
                    Icon(
                        imageVector = Icons.Default.SkipNext,
                        contentDescription = "পরের গান",
                        tint = if (state.hasNext) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.35f),
                        modifier = Modifier.size(22.dp)
                    )
                }
                MiniPlayerButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "বন্ধ করুন",
                        tint = tokens.inkMuted,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
    }
}

/**
 * A 40dp control for the mini bar.
 *
 * [IconButton] cannot be shrunk: it enforces a 48dp minimum touch target
 * whatever size modifier it is given, which alone would keep the bar taller
 * than the artwork. The mini bar is a glanceable control strip, so it trades
 * the full touch target for height — the icons are tinted by the caller, so
 * the disabled state still reads correctly.
 */
@Composable
private fun MiniPlayerButton(
    onClick: () -> Unit,
    enabled: Boolean = true,
    content: @Composable () -> Unit
) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        content()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FullMusicPlayer(
    controller: MusicController,
    state: MusicPlayerUiState
) {
    val track = state.track ?: return
    var showQueue by remember { mutableStateOf(false) }
    BackHandler(onBack = {
        when {
            showQueue -> showQueue = false
            else -> controller.collapse()
        }
    })

    var dragging by remember { mutableStateOf(false) }
    var dragValue by remember { mutableFloatStateOf(0f) }
    var sheet by remember { mutableStateOf(PlayerSheet.None) }
    var offsetY by remember { mutableFloatStateOf(0f) }
    var skipAccum by remember { mutableFloatStateOf(0f) }
    var gestureHint by remember { mutableStateOf<String?>(null) }
    // Volume read-out shown while the artwork is dragged: -1f means nothing to
    // show, which is how the HUD hides itself without a second flag.
    var volumeHud by remember { mutableFloatStateOf(-1f) }
    var minimizeHint by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val minimizePx = with(density) { PlayerMinimizeDrag.toPx() }
    LaunchedEffect(gestureHint) {
        if (gestureHint != null) {
            delay(700)
            gestureHint = null
        }
    }
    LaunchedEffect(volumeHud, minimizeHint) {
        if (volumeHud < 0f && !minimizeHint) return@LaunchedEffect
        delay(900)
        volumeHud = -1f
        minimizeHint = false
    }
    val duration = state.durationMs.coerceAtLeast(1L)
    val sliderValue = if (dragging) dragValue else state.positionMs.toFloat().coerceIn(0f, duration.toFloat())
    val playlists by controller.library.playlists().collectAsState(initial = emptyList())
    val queue = state.queue.ifEmpty { listOf(track) }
    val playingIndex = queue.indexOfFirst { it.id == track.id }.coerceAtLeast(0)
    val pagerState = rememberPagerState(initialPage = playingIndex, pageCount = { queue.size.coerceAtLeast(1) })

    LaunchedEffect(track.id, queue.size) {
        val index = queue.indexOfFirst { it.id == track.id }
        if (index >= 0 && pagerState.currentPage != index && !pagerState.isScrollInProgress) {
            pagerState.animateScrollToPage(index)
        }
    }
    LaunchedEffect(pagerState, queue) {
        snapshotFlow { Triple(pagerState.currentPage, pagerState.currentPageOffsetFraction, pagerState.isScrollInProgress) }
            .collect { (page, fraction, scrolling) ->
                if (scrolling || abs(fraction) > 0.02f) return@collect
                val item = queue.getOrNull(page) ?: return@collect
                if (item.id != controller.state.value.track?.id) {
                    controller.playQueueItem(item)
                }
            }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer { translationY = offsetY }
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF2A120E), PortalMaroon, Color(0xFF120806))
                )
            )
            .pointerInput(showQueue, minimizePx) {
                if (showQueue) return@pointerInput
                detectVerticalDragGestures(
                    onDragEnd = {
                        // A drag this long is a minimize, and the offset is
                        // left where the finger stopped so the exit animation
                        // carries on from there.
                        if (offsetY > minimizePx) controller.collapse()
                        // Either way the offset is released rather than
                        // snapped back to zero: resetting it on release put the
                        // player back at the top for a frame right before the
                        // exit animation took it down, which read as the sheet
                        // bouncing on the way out.
                        if (offsetY > 0f) {
                            val from = offsetY
                            scope.launch {
                                animate(from, 0f, animationSpec = tween(300)) { value, _ ->
                                    offsetY = value
                                }
                            }
                        }
                    },
                    onVerticalDrag = { change, amount ->
                        if (amount > 0f || offsetY > 0f) {
                            change.consume()
                            offsetY = (offsetY + amount).coerceAtLeast(0f)
                        }
                    }
                )
            }
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier
                        .padding(top = 8.dp, bottom = 4.dp)
                        .width(42.dp)
                        .height(4.dp)
                        .clip(RoundedCornerShape(99.dp))
                        .background(Color.White.copy(alpha = 0.35f))
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = controller::collapse) {
                        Icon(
                            imageVector = Icons.Default.KeyboardArrowDown,
                            contentDescription = "ছোট করুন",
                            tint = Color.White
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        text = "এখন বাজছে",
                        fontFamily = Kalpurush,
                        color = PortalSaffron,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = { sheet = PlayerSheet.Menu }) {
                        Icon(
                            imageVector = Icons.Default.MoreVert,
                            contentDescription = "আরও",
                            tint = Color.White.copy(alpha = 0.9f)
                        )
                    }
                }
            }

            HorizontalPager(
                state = pagerState,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                userScrollEnabled = !state.showVideo,
                beyondViewportPageCount = 1
            ) { page ->
                val pageTrack = queue.getOrNull(page) ?: track
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 28.dp)
                    ) {
                        Text(
                            text = pageTrack.title,
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            fontSize = 22.sp,
                            color = Color.White,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = pageTrack.playerCreditLine(),
                            fontFamily = Kalpurush,
                            fontSize = 14.sp,
                            color = Color.White.copy(alpha = 0.88f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 4.dp, bottom = 12.dp)
                        )
                    }
                    TrackCoverCanvas(
                        pageTrack = pageTrack,
                        isCurrent = pageTrack.id == track.id,
                        state = state,
                        controller = controller,
                        gestureHint = gestureHint,
                        onGestureHint = { gestureHint = it },
                        onVolumeHud = { volumeHud = it },
                        onMinimizeDrag = { delta ->
                            // The pull on the artwork keeps moving the sheet, so
                            // the two gestures look like the same one.
                            minimizeHint = true
                            offsetY = (offsetY + delta).coerceAtLeast(0f)
                        },
                        onMinimizeFinish = {
                            minimizeHint = false
                            controller.collapse()
                            val from = offsetY
                            if (from > 0f) {
                                scope.launch {
                                    animate(from, 0f, animationSpec = tween(300)) { value, _ ->
                                        offsetY = value
                                    }
                                }
                            }
                        }
                    )
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 22.dp)
                    .padding(bottom = 10.dp)
            ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                PlayerIcon(
                    icon = if (state.liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                    tint = if (state.liked) Color(0xFFFF6B81) else Color.White,
                    label = "পছন্দ"
                ) { controller.toggleLike() }
                PlayerIcon(
                    icon = Icons.Default.Shuffle,
                    tint = if (state.shuffle) PortalSaffron else Color.White.copy(alpha = 0.7f),
                    label = "শাফেল"
                ) { controller.toggleShuffle() }
                PlayerIcon(
                    icon = if (state.repeatMode == RepeatMode.ONE) Icons.Default.RepeatOne else Icons.Default.Repeat,
                    tint = if (state.repeatMode == RepeatMode.OFF) Color.White.copy(alpha = 0.7f) else PortalSaffron,
                    label = "রিপিট"
                ) { controller.cycleRepeat() }
                PlayerIcon(
                    icon = Icons.AutoMirrored.Filled.PlaylistPlay,
                    tint = if (state.autoPlay) PortalSaffron else Color.White.copy(alpha = 0.7f),
                    label = "অটোপ্লে"
                ) { controller.toggleAutoPlay() }
                PlayerIcon(
                    icon = Icons.Default.Download,
                    tint = if (state.offline) PortalSaffron else Color.White.copy(alpha = 0.7f),
                    label = "ডাউনলোড"
                ) { controller.saveCurrentOffline() }
                PlayerIcon(
                    icon = Icons.Default.Lyrics,
                    tint = if (state.showLyrics) PortalSaffron else Color.White.copy(alpha = 0.7f),
                    label = "লিরিক"
                ) { controller.toggleLyrics() }
            }

            Slider(
                value = sliderValue,
                onValueChange = {
                    dragging = true
                    dragValue = it
                },
                onValueChangeFinished = {
                    dragging = false
                    controller.seekTo(dragValue.toLong())
                },
                valueRange = 0f..duration.toFloat(),
                thumb = {
                    Box(
                        modifier = Modifier
                            .size(14.dp)
                            .clip(CircleShape)
                            .background(PortalSaffron)
                    )
                },
                track = { sliderState ->
                    SliderDefaults.Track(
                        sliderState = sliderState,
                        modifier = Modifier.height(3.dp),
                        colors = SliderDefaults.colors(
                            thumbColor = PortalSaffron,
                            activeTrackColor = PortalSaffron,
                            inactiveTrackColor = Color.White.copy(alpha = 0.22f)
                        )
                    )
                },
                colors = SliderDefaults.colors(
                    thumbColor = PortalSaffron,
                    activeTrackColor = PortalSaffron,
                    inactiveTrackColor = Color.White.copy(alpha = 0.22f)
                )
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(formatMs(sliderValue.toLong()), color = Color.White.copy(alpha = 0.85f), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Text(formatMs(duration), color = Color.White.copy(alpha = 0.85f), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                SleepTimerControl(
                    untilMs = state.sleepUntilMs,
                    onClick = { sheet = PlayerSheet.Sleep }
                )
                IconButton(onClick = controller::skipPrevious, modifier = Modifier.size(56.dp)) {
                    Icon(Icons.Default.SkipPrevious, "আগের গান", tint = Color.White, modifier = Modifier.size(36.dp))
                }
                Surface(
                    onClick = controller::togglePlayPause,
                    shape = CircleShape,
                    color = PortalSaffron,
                    modifier = Modifier.size(76.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = if (state.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (state.isPlaying) "বিরতি" else "চালান",
                            tint = Color(0xFF2A120E),
                            modifier = Modifier.size(40.dp)
                        )
                    }
                }
                IconButton(onClick = controller::skipNext, enabled = state.hasNext, modifier = Modifier.size(56.dp)) {
                    Icon(
                        Icons.Default.SkipNext,
                        "পরের গান",
                        tint = if (state.hasNext) Color.White else Color.White.copy(alpha = 0.3f),
                        modifier = Modifier.size(36.dp)
                    )
                }
                IconButton(onClick = { showQueue = true }, modifier = Modifier.size(48.dp)) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.QueueMusic,
                        contentDescription = "তালিকা",
                        tint = Color.White,
                        modifier = Modifier.size(28.dp)
                    )
                }
            }
            }
        }

        PlayerHud(
            volume = volumeHud,
            minimize = minimizeHint,
            modifier = Modifier.align(Alignment.Center)
        )

        QueueSidebar(
            visible = showQueue,
            queue = queue,
            currentId = track.id,
            playing = state.isPlaying,
            onSelect = {
                controller.playQueueItem(it)
                showQueue = false
            },
            onClose = { showQueue = false }
        )

        if (sheet != PlayerSheet.None) {
            PlayerSheets(
                sheet = sheet,
                track = track,
                state = state,
                playlists = playlists,
                onClose = { sheet = PlayerSheet.None },
                onOpen = { sheet = it },
                controller = controller
            )
        }
    }
}

/**
 * The read-out the artwork gestures show.
 *
 * [volume] is `-1f` when there is nothing to say; [minimize] takes over once a
 * long pull is on its way to putting the player away. It only ever displays —
 * the box has no pointer handling, so a finger that is still on the artwork
 * keeps driving the gesture underneath.
 */
@Composable
private fun PlayerHud(volume: Float, minimize: Boolean, modifier: Modifier = Modifier) {
    if (!minimize && volume < 0f) return
    val level = volume.coerceIn(0f, 1f)
    Surface(
        modifier = modifier,
        color = Color.Black.copy(alpha = 0.55f),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (minimize) {
                Icon(
                    imageVector = Icons.Default.KeyboardArrowDown,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(26.dp)
                )
                Text(
                    text = "ছেড়ে দিলে ছোট হয়ে যাবে",
                    fontFamily = Kalpurush,
                    color = Color.White,
                    fontSize = 13.sp
                )
            } else {
                Text(
                    text = "ভলিউম ${bengaliDigits((level * 100f).roundToInt().toLong())}%",
                    fontFamily = Kalpurush,
                    color = Color.White,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold
                )
                Box(
                    modifier = Modifier
                        .width(132.dp)
                        .height(6.dp)
                        .clip(RoundedCornerShape(99.dp))
                        .background(Color.White.copy(alpha = 0.25f))
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(level)
                            .height(6.dp)
                            .clip(RoundedCornerShape(99.dp))
                            .background(PortalSaffron)
                    )
                }
            }
        }
    }
}

@Composable
private fun SleepTimerControl(untilMs: Long?, onClick: () -> Unit) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(untilMs) {
        while (untilMs != null) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        if (untilMs != null) {
            val left = (untilMs - now).coerceAtLeast(0L)
            Text(
                text = formatMs(left),
                color = PortalSaffron,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = Kalpurush
            )
        }
        IconButton(onClick = onClick, modifier = Modifier.size(44.dp)) {
            Icon(
                imageVector = Icons.Default.Timer,
                contentDescription = "স্লিপ টাইমার",
                tint = if (untilMs != null) PortalSaffron else Color.White.copy(alpha = 0.85f),
                modifier = Modifier.size(26.dp)
            )
        }
    }
}

@Composable
private fun QueueSidebar(
    visible: Boolean,
    queue: List<MusicTrack>,
    currentId: String,
    playing: Boolean,
    onSelect: (MusicTrack) -> Unit,
    onClose: () -> Unit
) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn() + slideInHorizontally { it },
        exit = fadeOut() + slideOutHorizontally { it },
        modifier = Modifier.fillMaxSize()
    ) {
        Row(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .background(Color.Black.copy(alpha = 0.45f))
                    .clickable(onClick = onClose)
                    .pointerInput(Unit) {
                        detectVerticalDragGestures(
                            onDragEnd = { },
                            onVerticalDrag = { change, amount ->
                                if (amount > 18f) {
                                    change.consume()
                                    onClose()
                                }
                            }
                        )
                    }
            )
            Surface(
                color = Color(0xFF1C0E0C),
                modifier = Modifier
                    .fillMaxHeight()
                    .width(304.dp)
                    .pointerInput(Unit) {
                        detectVerticalDragGestures(
                            onVerticalDrag = { change, amount ->
                                if (amount > 18f) {
                                    change.consume()
                                    onClose()
                                }
                            }
                        )
                    }
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .navigationBarsPadding()
                        .padding(horizontal = 14.dp, vertical = 12.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.CenterHorizontally)
                            .width(36.dp)
                            .height(4.dp)
                            .clip(RoundedCornerShape(99.dp))
                            .background(Color.White.copy(alpha = 0.28f))
                    )
                    Spacer(Modifier.height(12.dp))
                    Text("তালিকা", fontFamily = Kalpurush, fontWeight = FontWeight.Bold, color = Color.White, fontSize = 18.sp)
                    Spacer(Modifier.height(10.dp))
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.weight(1f)) {
                        items(queue, key = { it.id }) { item ->
                            QueueRow(
                                item = item,
                                selected = item.id == currentId,
                                playing = playing,
                                onClick = { onSelect(item) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayerSheets(

    sheet: PlayerSheet,
    track: MusicTrack,
    state: MusicPlayerUiState,
    playlists: List<UserPlaylist>,
    onClose: () -> Unit,
    onOpen: (PlayerSheet) -> Unit,
    controller: MusicController
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var newTitle by remember { mutableStateOf("") }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.45f))
            .clickable(onClick = onClose)
    ) {
        Surface(
            shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
            color = Color(0xFF1C0E0C),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .clickable(enabled = false) {}
        ) {
            Column(
                modifier = Modifier
                    .navigationBarsPadding()
                    .padding(horizontal = 18.dp, vertical = 16.dp)
            ) {
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterHorizontally)
                        .width(40.dp)
                        .height(4.dp)
                        .clip(RoundedCornerShape(99.dp))
                        .background(Color.White.copy(alpha = 0.28f))
                )
                Spacer(Modifier.height(14.dp))
                when (sheet) {
                    PlayerSheet.Menu -> {
                        SheetRow(Icons.Default.PlaylistAdd, "প্লেলিস্টে যোগ করুন") { onOpen(PlayerSheet.Playlist) }
                        SheetRow(Icons.Default.Info, "গানের বিবরণ") { onOpen(PlayerSheet.Details) }
                        SheetRow(
                            Icons.Default.Download,
                            if (state.offline) "অফলাইনে সংরক্ষিত" else "অ্যাপে MP3 সংরক্ষণ"
                        ) {
                            controller.saveCurrentOffline()
                            onClose()
                        }
                        SheetRow(Icons.Default.Timer, "স্লিপ টাইমার") { onOpen(PlayerSheet.Sleep) }
                    }
                    PlayerSheet.Playlist -> {
                        Text("প্লেলিস্টে যোগ করুন", fontFamily = Kalpurush, color = Color.White, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(10.dp))
                        playlists.filter { !it.isLoved }.forEach { playlist ->
                            SheetRow(Icons.Default.MusicNote, playlist.title) {
                                controller.addCurrentToPlaylist(playlist.id)
                                onClose()
                            }
                        }
                        SheetRow(Icons.Default.PlaylistAdd, "নতুন প্লেলিস্ট") { onOpen(PlayerSheet.NewPlaylist) }
                    }
                    PlayerSheet.NewPlaylist -> {
                        Text("নতুন প্লেলিস্ট", fontFamily = Kalpurush, color = Color.White, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(10.dp))
                        OutlinedTextField(
                            value = newTitle,
                            onValueChange = { newTitle = it },
                            placeholder = { Text("নাম লিখুন", fontFamily = Kalpurush) },
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White,
                                focusedBorderColor = PortalSaffron,
                                unfocusedBorderColor = Color.White.copy(alpha = 0.3f)
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )
                        TextButton(onClick = {
                            scope.launch {
                                val created = controller.createPlaylist(newTitle)
                                controller.addCurrentToPlaylist(created.id)
                                onClose()
                            }
                        }) {
                            Text("তৈরি করুন", fontFamily = Kalpurush, color = PortalSaffron)
                        }
                    }
                    PlayerSheet.Details -> {
                        Text(track.title, fontFamily = Kalpurush, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                        Spacer(Modifier.height(8.dp))
                        DetailLine("শিল্পী", track.artist.ifBlank { "নিংশিং চে" })
                        if (track.album.isNotBlank()) DetailLine("অ্যালবাম", track.album)
                        if (track.genre.isNotBlank()) DetailLine("ধরন", track.genre)
                        if (track.videoLink.isNotBlank()) DetailLine("ভিডিও", track.videoLink)
                        if (track.durationSeconds > 0) DetailLine("সময়", formatMs(track.durationSeconds * 1000L))
                        if (track.description.isNotBlank()) {
                            Spacer(Modifier.height(8.dp))
                            Text(track.description, fontFamily = Kalpurush, color = Color.White.copy(alpha = 0.8f), fontSize = 14.sp)
                        }
                    }
                    PlayerSheet.Sleep -> {
                        Text("স্লিপ টাইমার", fontFamily = Kalpurush, color = Color.White, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(8.dp))
                        listOf(5, 15, 30, 45, 60).forEach { minutes ->
                            SheetRow(Icons.Default.Timer, "$minutes মিনিট") {
                                controller.setSleepTimer(minutes)
                                onClose()
                            }
                        }
                        SheetRow(Icons.Default.Close, "বন্ধ করুন") {
                            controller.setSleepTimer(0)
                            onClose()
                        }
                    }
                    PlayerSheet.None -> Unit
                }
            }
        }
    }
}

@Composable
private fun SheetRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, contentDescription = null, tint = PortalSaffron, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(14.dp))
        Text(label, fontFamily = Kalpurush, color = Color.White, fontSize = 16.sp)
    }
}

@Composable
private fun DetailLine(label: String, value: String) {
    Text(
        text = "$label · $value",
        fontFamily = Kalpurush,
        color = Color.White.copy(alpha = 0.82f),
        fontSize = 14.sp,
        modifier = Modifier.padding(vertical = 2.dp)
    )
}

@Composable
private fun PlayerIcon(icon: ImageVector, tint: Color, label: String, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(40.dp)) {
        Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(22.dp))
    }
}

@Composable
private fun QueueRow(
    item: MusicTrack,
    selected: Boolean,
    playing: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) Color.White.copy(alpha = 0.12f) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        CoverArt(url = item.thumbnailUrl, modifier = Modifier.size(40.dp), corner = 8.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = item.title,
                fontFamily = Kalpurush,
                color = Color.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium
            )
            Text(
                text = item.artist.ifBlank { "নিংশিং চে" },
                fontFamily = Kalpurush,
                color = Color.White.copy(alpha = 0.65f),
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        if (selected && playing) {
            Icon(Icons.Default.MusicNote, null, tint = PortalSaffron, modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
private fun TrackCoverCanvas(
    pageTrack: MusicTrack,
    isCurrent: Boolean,
    state: MusicPlayerUiState,
    controller: MusicController,
    gestureHint: String?,
    onGestureHint: (String) -> Unit,
    onVolumeHud: (Float) -> Unit,
    onMinimizeDrag: (Float) -> Unit,
    onMinimizeFinish: () -> Unit
) {
    val showVideo = isCurrent && state.showVideo && pageTrack.hasVideo()
    val rotation by animateFloatAsState(
        targetValue = if (showVideo) 180f else 0f,
        animationSpec = tween(durationMillis = 520, easing = FastOutSlowInEasing),
        label = "coverFlip"
    )
    val density = LocalDensity.current.density
    val camera = 18f * density
    val coverVolumePx = with(LocalDensity.current) { CoverVolumeDrag.toPx() }
    val coverMinimizePx = with(LocalDensity.current) { CoverMinimizeDrag.toPx() }
    var keepVideo by remember(pageTrack.id) { mutableStateOf(false) }
    LaunchedEffect(showVideo) {
        if (showVideo) keepVideo = true
    }
    LaunchedEffect(rotation, showVideo) {
        if (!showVideo && rotation < 2f) keepVideo = false
    }

    Box(
        modifier = Modifier
            .padding(horizontal = 28.dp)
            .fillMaxWidth()
            .aspectRatio(1f)
            .shadow(24.dp, RoundedCornerShape(28.dp))
            .clip(RoundedCornerShape(28.dp))
            .pointerInput(pageTrack.id, showVideo) {
                if (showVideo) return@pointerInput
                detectTapGestures(
                    onDoubleTap = { offset ->
                        val third = size.width / 3f
                        when {
                            offset.x < third -> {
                                controller.seekBy(-5_000L)
                                onGestureHint("Backward -5s")
                            }
                            offset.x > third * 2f -> {
                                controller.seekBy(5_000L)
                                onGestureHint("Forward +5s")
                            }
                            else -> controller.togglePlayPause()
                        }
                    }
                )
            }
            // The artwork is the volume control: pull down for quiet, up for
            // loud. Horizontal swipes still reach the pager, and a long pull
            // stops being a volume change and puts the player away instead —
            // the volume the pull had already changed is put back, so the
            // listener never loses the level they had.
            .pointerInput(pageTrack.id, showVideo, coverVolumePx, coverMinimizePx) {
                if (showVideo) return@pointerInput
                var dragged = 0f
                var startVolume = 1f
                var minimizing = false
                detectVerticalDragGestures(
                    onDragStart = {
                        dragged = 0f
                        minimizing = false
                        startVolume = controller.state.value.volume
                    },
                    onDragEnd = {
                        if (minimizing) {
                            onMinimizeFinish()
                        } else {
                            onVolumeHud(-1f)
                        }
                    },
                    onVerticalDrag = { change, amount ->
                        change.consume()
                        if (minimizing) {
                            onMinimizeDrag(amount)
                        } else {
                            dragged += amount
                            if (dragged > coverMinimizePx) {
                                minimizing = true
                                controller.setVolume(startVolume)
                                onVolumeHud(-1f)
                                onMinimizeDrag(0f)
                            } else {
                                // Clamped before it is shown: a negative value
                                // is the HUD's own "nothing to say" marker, so
                                // dragging past the ends has to stop at 0% and
                                // 100% rather than hide the read-out.
                                val next = (startVolume - dragged / coverVolumePx).coerceIn(0f, 1f)
                                controller.setVolume(next)
                                onVolumeHud(next)
                            }
                        }
                    }
                )
            }
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    rotationY = rotation
                    cameraDistance = camera
                    alpha = if (rotation <= 90f) 1f else 0f
                }
        ) {
            CoverArt(
                url = pageTrack.thumbnailUrl,
                modifier = Modifier.fillMaxSize(),
                corner = 28.dp
            )
            if (state.showLyrics && isCurrent && !showVideo) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .clip(RoundedCornerShape(28.dp))
                        .background(Color(0x99000000))
                        .padding(16.dp)
                ) {
                    Text(
                        text = pageTrack.lyrics.ifBlank { "এই গানের লিরিক এখনো যোগ করা হয়নি।" },
                        fontFamily = Kalpurush,
                        color = Color.White,
                        fontSize = 16.sp,
                        lineHeight = 26.sp,
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                    )
                }
            }
        }

        if (keepVideo || rotation > 90f) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        rotationY = rotation - 180f
                        cameraDistance = camera
                        alpha = if (rotation > 90f) 1f else 0f
                    }
                    .clip(RoundedCornerShape(28.dp))
                    .background(Color.Black)
            ) {
                if (keepVideo || showVideo) {
                    SocialEmbedPlayer(
                        url = pageTrack.videoLink,
                        modifier = Modifier.fillMaxSize(),
                        autoplay = true
                    )
                }
            }
        }

        if (state.isBuffering && isCurrent && !showVideo) {
            CircularProgressIndicator(
                color = PortalSaffron,
                strokeWidth = 2.dp,
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(36.dp)
            )
        }
        gestureHint?.takeIf { isCurrent && !showVideo }?.let { hint ->
            Surface(
                color = Color.Black.copy(alpha = 0.62f),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier.align(Alignment.Center)
            ) {
                Text(
                    text = hint,
                    color = Color.White,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)
                )
            }
        }
        if (pageTrack.hasVideo() && isCurrent) {
            Surface(
                onClick = controller::toggleVideo,
                shape = CircleShape,
                color = Color.Black.copy(alpha = 0.55f),
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(12.dp)
                    .size(44.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = if (showVideo) Icons.Default.MusicNote else Icons.Default.Videocam,
                        contentDescription = if (showVideo) "অডিওতে ফিরুন" else "ভিডিও চালান",
                        tint = PortalSaffron,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun CoverArt(url: String, modifier: Modifier, corner: androidx.compose.ui.unit.Dp) {
    val shape = RoundedCornerShape(corner)
    if (url.isBlank()) {
        Box(
            modifier = modifier
                .clip(shape)
                .background(Color(0x33FFFFFF)),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Default.MusicNote, contentDescription = null, tint = PortalSaffron, modifier = Modifier.size(28.dp))
        }
    } else {
        EditorialImage(
            url = url,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            shape = shape,
            modifier = modifier
        )
    }
}

private fun formatMs(ms: Long): String {
    val total = (ms / 1000L).coerceAtLeast(0L)
    val m = total / 60
    val s = total % 60
    return "${bengaliDigits(m)}:${bengaliDigits(s).padStart(2, '০')}"
}

private fun bengaliDigits(value: Long): String {
    val map = charArrayOf('০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯')
    return value.toString().map { ch -> if (ch in '0'..'9') map[ch - '0'] else ch }.joinToString("")
}
