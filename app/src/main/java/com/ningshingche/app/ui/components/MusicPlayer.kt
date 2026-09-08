package com.ningshingche.app.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ningshingche.app.data.portal.MusicTrack
import com.ningshingche.app.playback.MusicController
import com.ningshingche.app.playback.MusicPlayerUiState
import com.ningshingche.app.ui.editorial.EditorialImage
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.PortalMaroon
import com.ningshingche.app.ui.theme.PortalSaffron

val LocalMusicController = staticCompositionLocalOf<MusicController> {
    error("MusicController is not provided")
}

@Composable
fun BoxScope.MusicPlayerOverlay(
    controller: MusicController
) {
    val state by controller.state.collectAsState()
    if (!state.visible || state.track == null) return

    AnimatedVisibility(
        visible = state.expanded,
        enter = fadeIn() + slideInVertically { it / 6 },
        exit = fadeOut() + slideOutVertically { it / 6 },
        modifier = Modifier.fillMaxSize()
    ) {
        FullMusicPlayer(
            state = state,
            onCollapse = controller::collapse,
            onDismiss = controller::dismiss,
            onToggle = controller::togglePlayPause,
            onNext = controller::skipNext,
            onPrevious = controller::skipPrevious,
            onSeek = controller::seekTo,
            onQueueItem = controller::playQueueItem
        )
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

@Composable
private fun FullMusicPlayer(
    state: MusicPlayerUiState,
    onCollapse: () -> Unit,
    onDismiss: () -> Unit,
    onToggle: () -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onSeek: (Long) -> Unit,
    onQueueItem: (MusicTrack) -> Unit
) {
    val track = state.track ?: return
    BackHandler(onBack = onCollapse)

    var dragging by remember { mutableStateOf(false) }
    var dragValue by remember { mutableFloatStateOf(0f) }
    val duration = state.durationMs.coerceAtLeast(1L)
    val sliderValue = if (dragging) dragValue else state.positionMs.toFloat().coerceIn(0f, duration.toFloat())

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF2A120E), PortalMaroon, Color(0xFF120806))
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = 22.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onCollapse) {
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
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "বন্ধ করুন",
                        tint = Color.White.copy(alpha = 0.85f)
                    )
                }
            }

            Spacer(Modifier.height(12.dp))
            CoverArt(
                url = track.thumbnailUrl,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp)
                    .aspectRatio(1f)
                    .shadow(28.dp, RoundedCornerShape(28.dp)),
                corner = 28.dp
            )
            Spacer(Modifier.height(28.dp))
            Text(
                text = track.title,
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 26.sp,
                lineHeight = 34.sp,
                color = Color.White,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = buildString {
                    append(track.artist.ifBlank { "নিংশিং চে" })
                    if (track.album.isNotBlank()) append("  ·  ${track.album}")
                },
                fontFamily = Kalpurush,
                fontSize = 15.sp,
                color = Color.White.copy(alpha = 0.78f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 6.dp)
            )
            if (track.genre.isNotBlank()) {
                Text(
                    text = track.genre,
                    fontFamily = Kalpurush,
                    fontSize = 13.sp,
                    color = PortalSaffron,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }

            Spacer(Modifier.height(18.dp))
            Slider(
                value = sliderValue,
                onValueChange = {
                    dragging = true
                    dragValue = it
                },
                onValueChangeFinished = {
                    dragging = false
                    onSeek(dragValue.toLong())
                },
                valueRange = 0f..duration.toFloat(),
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
                Text(formatMs(sliderValue.toLong()), color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp)
                Text(formatMs(duration), color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp)
            }

            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onPrevious, modifier = Modifier.size(56.dp)) {
                    Icon(
                        imageVector = Icons.Default.SkipPrevious,
                        contentDescription = "আগের গান",
                        tint = Color.White,
                        modifier = Modifier.size(36.dp)
                    )
                }
                Surface(
                    onClick = onToggle,
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
                IconButton(onClick = onNext, enabled = state.hasNext, modifier = Modifier.size(56.dp)) {
                    Icon(
                        imageVector = Icons.Default.SkipNext,
                        contentDescription = "পরের গান",
                        tint = if (state.hasNext) Color.White else Color.White.copy(alpha = 0.3f),
                        modifier = Modifier.size(36.dp)
                    )
                }
            }

            if (state.queue.size > 1) {
                Spacer(Modifier.height(18.dp))
                Text(
                    text = "তালিকা",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    color = Color.White.copy(alpha = 0.9f),
                    fontSize = 15.sp
                )
                Spacer(Modifier.height(8.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(state.queue, key = { it.id }) { item ->
                        val selected = item.id == track.id
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(if (selected) Color.White.copy(alpha = 0.12f) else Color.Transparent)
                                .clickable { onQueueItem(item) }
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
                            if (selected && state.isPlaying) {
                                Icon(
                                    imageVector = Icons.Default.MusicNote,
                                    contentDescription = null,
                                    tint = PortalSaffron,
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    }
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
