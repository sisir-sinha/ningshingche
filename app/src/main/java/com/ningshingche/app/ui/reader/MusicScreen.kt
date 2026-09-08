package com.ningshingche.app.ui.reader

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ningshingche.app.data.music.UserPlaylist
import com.ningshingche.app.data.portal.MusicTrack
import com.ningshingche.app.ui.components.LocalMusicController
import com.ningshingche.app.ui.editorial.EditorialImage
import com.ningshingche.app.ui.editorial.EditorialShape
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.editorial.EditorialType
import com.ningshingche.app.ui.editorial.EmptyState
import com.ningshingche.app.ui.editorial.ErrorState
import com.ningshingche.app.ui.editorial.Hairline
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import kotlinx.coroutines.launch

private enum class MusicTab { All, Playlists, Loved, Offline }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MusicScreen(
    viewModel: HomeViewModel,
    onBackClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val tracks by viewModel.musicCatalog.collectAsState()
    val loading by viewModel.musicLoading.collectAsState()
    val error by viewModel.musicError.collectAsState()
    val player = LocalMusicController.current
    val playlists by player.library.playlists().collectAsState(initial = emptyList())
    val lovedIds by player.library.lovedIds().collectAsState(initial = emptySet())
    val offline by player.library.offlineTracks().collectAsState(initial = emptyList())
    var tab by remember { mutableStateOf(MusicTab.All) }
    var creating by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { viewModel.loadMusicCatalog(force = true) }

    val byId = remember(tracks, offline) {
        (tracks + offline).associateBy { it.id }
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "সঙ্গীত",
                        style = EditorialType.Title,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "পেছনে")
                    }
                },
                actions = {
                    if (tab == MusicTab.Playlists) {
                        IconButton(onClick = { creating = true }) {
                            Icon(Icons.Default.Add, contentDescription = "নতুন প্লেলিস্ট")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = EditorialSpace.gutter),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                MusicTabChip("সব", tab == MusicTab.All) { tab = MusicTab.All }
                MusicTabChip("প্লেলিস্ট", tab == MusicTab.Playlists) { tab = MusicTab.Playlists }
                MusicTabChip("পছন্দ", tab == MusicTab.Loved) { tab = MusicTab.Loved }
                MusicTabChip("অফলাইন", tab == MusicTab.Offline) { tab = MusicTab.Offline }
            }

            when {
                loading && tracks.isEmpty() && tab == MusicTab.All -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(
                        color = LocalEditorialTokens.current.accent,
                        strokeWidth = 2.dp
                    )
                }
                tab == MusicTab.All && tracks.isEmpty() && !error.isNullOrBlank() -> ErrorState(
                    message = error.orEmpty(),
                    onRetry = { viewModel.loadMusicCatalog(force = true) }
                )
                tab == MusicTab.All && tracks.isEmpty() -> EmptyState(message = "এখনো কোনো গান যোগ করা হয়নি।")
                tab == MusicTab.Playlists -> PlaylistPane(
                    playlists = playlists.filter { !it.isLoved },
                    catalog = byId,
                    onPlay = { playlist ->
                        val queue = playlist.trackIds.mapNotNull { byId[it] }
                        queue.firstOrNull()?.let { player.play(it, queue, expand = true) }
                    },
                    onDelete = { scope.launch { player.library.deletePlaylist(it.id) } }
                )
                tab == MusicTab.Loved -> {
                    val loved = playlists.firstOrNull { it.isLoved }?.trackIds.orEmpty()
                        .ifEmpty { lovedIds.toList() }
                        .mapNotNull { byId[it] }
                    TrackList(
                        title = "পছন্দের গান",
                        subtitle = "আপনার সংরক্ষিত প্লেলিস্ট",
                        tracks = loved,
                        empty = "এখনো কোনো গান পছন্দ করা হয়নি।"
                    ) { track -> player.play(track, loved, expand = true) }
                }
                tab == MusicTab.Offline -> TrackList(
                    title = "অফলাইন",
                    subtitle = "এই ডিভাইসে সংরক্ষিত MP3",
                    tracks = offline,
                    empty = "কোনো গান অ্যাপে সংরক্ষণ করা হয়নি।"
                ) { track -> player.play(track, offline, expand = true) }
                else -> TrackList(
                    title = "সব গান",
                    subtitle = "কণ্ঠে বিষ্ণুপ্রিয়া মণিপুরি সংস্কৃতি",
                    tracks = tracks,
                    empty = "এখনো কোনো গান যোগ করা হয়নি।"
                ) { track -> player.play(track, tracks, expand = true) }
            }
        }
    }

    if (creating) {
        AlertDialog(
            onDismissRequest = { creating = false },
            title = { Text("নতুন প্লেলিস্ট", fontFamily = com.ningshingche.app.ui.theme.Kalpurush) },
            text = {
                OutlinedTextField(
                    value = newName,
                    onValueChange = { newName = it },
                    singleLine = true,
                    placeholder = { Text("প্লেলিস্টের নাম") }
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        player.createPlaylist(newName)
                        newName = ""
                        creating = false
                    }
                }) { Text("তৈরি") }
            },
            dismissButton = {
                TextButton(onClick = { creating = false }) { Text("বাতিল") }
            }
        )
    }
}

@Composable
private fun MusicTabChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label, style = EditorialType.Caption) },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = tokens.accent.copy(alpha = 0.16f),
            selectedLabelColor = tokens.accent
        )
    )
}

@Composable
private fun TrackList(
    title: String,
    subtitle: String,
    tracks: List<MusicTrack>,
    empty: String,
    onPlay: (MusicTrack) -> Unit
) {
    if (tracks.isEmpty()) {
        EmptyState(message = empty)
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 96.dp)
    ) {
        item {
            Column(
                modifier = Modifier.padding(
                    horizontal = EditorialSpace.gutter,
                    vertical = EditorialSpace.md
                )
            ) {
                Hairline()
                Spacer(Modifier.height(EditorialSpace.md))
                Text(text = title, style = EditorialType.Headline, color = MaterialTheme.colorScheme.onSurface)
                Text(
                    text = subtitle,
                    style = EditorialType.Caption,
                    color = LocalEditorialTokens.current.inkMuted,
                    modifier = Modifier.padding(top = 4.dp)
                )
                Spacer(Modifier.height(EditorialSpace.sm))
                Hairline()
            }
        }
        items(tracks, key = { it.id }) { track ->
            MusicCatalogCard(track = track, onClick = { onPlay(track) })
        }
    }
}

@Composable
private fun PlaylistPane(
    playlists: List<UserPlaylist>,
    catalog: Map<String, MusicTrack>,
    onPlay: (UserPlaylist) -> Unit,
    onDelete: (UserPlaylist) -> Unit
) {
    if (playlists.isEmpty()) {
        EmptyState(message = "প্লেলিস্ট তৈরি করতে উপরের + চাপুন।")
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 96.dp, top = EditorialSpace.md)
    ) {
        items(playlists, key = { it.id }) { playlist ->
            Card(
                onClick = { onPlay(playlist) },
                shape = RoundedCornerShape(EditorialShape.card),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.sm)
            ) {
                Row(
                    modifier = Modifier.padding(EditorialSpace.md),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val cover = playlist.trackIds.firstNotNullOfOrNull { catalog[it]?.thumbnailUrl }.orEmpty()
                    if (cover.isNotBlank()) {
                        EditorialImage(
                            url = cover,
                            contentDescription = playlist.title,
                            modifier = Modifier.size(56.dp)
                        )
                    } else {
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = LocalEditorialTokens.current.accent.copy(alpha = 0.14f),
                        modifier = Modifier.size(56.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.Favorite, contentDescription = null, tint = LocalEditorialTokens.current.accent)
                        }
                    }
                    }
                    Spacer(Modifier.width(EditorialSpace.md))
                    Column(Modifier.weight(1f)) {
                        Text(playlist.title, style = EditorialType.Title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            text = "${playlist.trackIds.size}টি গান",
                            style = EditorialType.Caption,
                            color = LocalEditorialTokens.current.inkMuted
                        )
                    }
                    TextButton(onClick = { onDelete(playlist) }) { Text("মুছুন") }
                }
            }
        }
    }
}

@Composable
private fun MusicCatalogCard(
    track: MusicTrack,
    onClick: () -> Unit
) {
    val tokens = LocalEditorialTokens.current
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(EditorialShape.card),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.sm)
    ) {
        Row(
            modifier = Modifier.padding(EditorialSpace.md),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box {
                EditorialImage(
                    url = track.thumbnailUrl,
                    contentDescription = track.title,
                    modifier = Modifier.size(72.dp)
                )
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = tokens.accent.copy(alpha = 0.92f),
                    modifier = Modifier
                        .align(Alignment.Center)
                        .size(28.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.PlayArrow,
                            contentDescription = "চালান",
                            tint = Color.White,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }
            Spacer(Modifier.width(EditorialSpace.md))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = track.title,
                    style = EditorialType.Title,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                val subtitle = listOf(track.artist, track.album).filter { it.isNotBlank() }.joinToString(" · ")
                if (subtitle.isNotBlank()) {
                    Text(
                        text = subtitle,
                        style = EditorialType.Caption,
                        color = tokens.inkMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (track.genre.isNotBlank()) {
                    Text(
                        text = track.genre,
                        style = EditorialType.Caption,
                        color = tokens.accent,
                        maxLines = 1
                    )
                }
            }
        }
    }
}
