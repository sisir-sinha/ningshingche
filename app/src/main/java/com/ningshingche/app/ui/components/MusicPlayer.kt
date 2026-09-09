package com.ningshingche.app.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
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
import androidx.compose.material.icons.filled.Share
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
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.PortalMaroon
import com.ningshingche.app.ui.theme.PortalSaffron
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlinx.coroutines.launch

val LocalMusicController = staticCompositionLocalOf<MusicController> {
    error("MusicController is not provided")
}

private enum class PlayerSheet { None, Menu, Playlist, Details, Sleep, NewPlaylist }

@Composable
fun BoxScope.MusicPlayerOverlay(
    controller: MusicController
) {
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
    AnimatedVisibility(
        visible = !state.expanded,
        enter = slideInVertically { it } + fadeIn(),
        exit = slideOutVertically { it } + fadeOut(),
        modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth()
    ) {
        MiniMusicPlayer(
            state = state,
            onExpand = controller::expand,
            onToggle = controller::togglePlayPause,
            onNext = controller::skipNext,
            onDismiss = controller::dismiss
        )
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
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onExpand)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                CoverArt(url = track.thumbnailUrl, modifier = Modifier.size(52.dp), corner = 10.dp)
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = track.title,
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = track.artist.ifBlank { "নিংশিং চে" },
                        fontFamily = Kalpurush,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = tokens.inkMuted
                    )
                }
                IconButton(onClick = onToggle) {
                    Icon(
                        imageVector = if (state.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (state.isPlaying) "বিরতি" else "চালান",
                        tint = tokens.accent
                    )
                }
                IconButton(onClick = onNext, enabled = state.hasNext) {
                    Icon(
                        imageVector = Icons.Default.SkipNext,
                        contentDescription = "পরের গান",
                        tint = if (state.hasNext) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.35f)
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "বন্ধ করুন",
                        tint = tokens.inkMuted
                    )
                }
            }
        }
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
    LaunchedEffect(gestureHint) {
        if (gestureHint != null) {
            delay(700)
            gestureHint = null
        }
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
            .pointerInput(showQueue) {
                if (showQueue) return@pointerInput
                detectVerticalDragGestures(
                    onDragEnd = {
                        if (offsetY > 120f) controller.collapse()
                        offsetY = 0f
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
                .padding(horizontal = 22.dp)
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
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

            Spacer(Modifier.height(8.dp))
            HorizontalPager(
                state = pagerState,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false),
                beyondViewportPageCount = 1
            ) { page ->
                val pageTrack = queue.getOrNull(page) ?: track
                Column(modifier = Modifier.fillMaxWidth()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 18.dp)
                            .aspectRatio(1f)
                            .shadow(28.dp, RoundedCornerShape(28.dp))
                            .pointerInput(pageTrack.id) {
                                detectTapGestures(
                                    onDoubleTap = { offset ->
                                        val third = size.width / 3f
                                        when {
                                            offset.x < third -> {
                                                controller.seekBy(-5_000L)
                                                gestureHint = "Backward -5s"
                                            }
                                            offset.x > third * 2f -> {
                                                controller.seekBy(5_000L)
                                                gestureHint = "Forward +5s"
                                            }
                                            else -> controller.togglePlayPause()
                                        }
                                    }
                                )
                            }
                    ) {
                        CoverArt(url = pageTrack.thumbnailUrl, modifier = Modifier.fillMaxSize(), corner = 28.dp)
                        if (state.isBuffering && pageTrack.id == track.id) {
                            CircularProgressIndicator(
                                color = PortalSaffron,
                                strokeWidth = 2.dp,
                                modifier = Modifier
                                    .align(Alignment.Center)
                                    .size(36.dp)
                            )
                        }
                        gestureHint?.let { hint ->
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
                    }
                    Spacer(Modifier.height(20.dp))
                    Text(
                        text = pageTrack.title,
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 24.sp,
                        lineHeight = 32.sp,
                        color = Color.White,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = buildString {
                            append(pageTrack.artist.ifBlank { "নিংশিং চে" })
                            if (pageTrack.album.isNotBlank()) append("  ·  ${pageTrack.album}")
                        },
                        fontFamily = Kalpurush,
                        fontSize = 15.sp,
                        color = Color.White.copy(alpha = 0.78f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }

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

            if (state.showLyrics) {
                Spacer(Modifier.height(8.dp))
                Text("লিরিক", fontFamily = Kalpurush, fontWeight = FontWeight.Bold, color = Color.White, fontSize = 15.sp)
                Spacer(Modifier.height(6.dp))
                Text(
                    text = track.lyrics.ifBlank { "এই গানের লিরিক এখনো যোগ করা হয়নি।" },
                    fontFamily = Kalpurush,
                    color = Color.White.copy(alpha = 0.86f),
                    fontSize = 15.sp,
                    lineHeight = 24.sp,
                    modifier = Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                )
            } else {
                Spacer(Modifier.weight(1f))
            }
        }

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
