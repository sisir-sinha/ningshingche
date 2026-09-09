package com.ningshingche.app.ui.reader

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Favorite
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ningshingche.app.data.music.MusicCatalogIndex
import com.ningshingche.app.data.music.UserPlaylist
import com.ningshingche.app.data.portal.MusicTrack
import com.ningshingche.app.ui.components.LocalMusicController
import com.ningshingche.app.ui.editorial.EditorialImage
import com.ningshingche.app.ui.editorial.EditorialShape
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.editorial.EditorialType
import com.ningshingche.app.ui.editorial.EmptyState
import com.ningshingche.app.ui.editorial.ErrorState
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.theme.Kalpurush
import kotlinx.coroutines.launch

private enum class MusicTab { All, Genres, Artists, Albums, Playlists, Loved, Offline }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MusicScreen(
    viewModel: HomeViewModel,
    onBackClick: () -> Unit,
    onGenreClick: (String) -> Unit = {},
    onArtistClick: (String) -> Unit = {},
    onAlbumClick: (String) -> Unit = {},
    modifier: Modifier = Modifier
) {
    val tracks by viewModel.musicCatalog.collectAsState()
    val loading by viewModel.musicLoading.collectAsState()
    val error by viewModel.musicError.collectAsState()
    val player = LocalMusicController.current
    val playlists by player.library.playlists().collectAsState(initial = emptyList())
    val lovedIds by player.library.lovedIds().collectAsState(initial = emptySet())
    val offline by player.library.offlineTracks().collectAsState(initial = emptyList())
    val pagerState = rememberPagerState(pageCount = { MusicTab.entries.size })
    val tab = MusicTab.entries[pagerState.currentPage]
    var query by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    fun goToTab(target: MusicTab) {
        scope.launch { pagerState.animateScrollToPage(target.ordinal) }
    }

    LaunchedEffect(Unit) { viewModel.loadMusicCatalog(force = true) }
    LaunchedEffect(tracks) {
        if (tracks.isNotEmpty()) player.prefetchCatalog(tracks)
    }

    val byId = remember(tracks, offline) {
        (tracks + offline).associateBy { it.id }
    }
    val filtered = remember(tracks, query) {
        tracks.filter { MusicCatalogIndex.matches(it, query) }
    }
    val genreShelves = remember(tracks, query) {
        MusicCatalogIndex.genres(tracks).filter {
            query.isBlank() || it.name.contains(query, ignoreCase = true)
        }
    }
    val artistShelves = remember(tracks, query) {
        MusicCatalogIndex.artists(tracks).filter {
            query.isBlank() || it.name.contains(query, ignoreCase = true)
        }
    }
    val albumShelves = remember(tracks, query) {
        MusicCatalogIndex.albums(tracks).filter {
            query.isBlank() || it.name.contains(query, ignoreCase = true)
        }
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
            LazyRow(
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = EditorialSpace.gutter),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                item { MusicTabChip("সব", tab == MusicTab.All) { goToTab(MusicTab.All) } }
                item { MusicTabChip("ধরন", tab == MusicTab.Genres) { goToTab(MusicTab.Genres) } }
                item { MusicTabChip("শিল্পী", tab == MusicTab.Artists) { goToTab(MusicTab.Artists) } }
                item { MusicTabChip("অ্যালবাম", tab == MusicTab.Albums) { goToTab(MusicTab.Albums) } }
                item { MusicTabChip("প্লেলিস্ট", tab == MusicTab.Playlists) { goToTab(MusicTab.Playlists) } }
                item { MusicTabChip("পছন্দ", tab == MusicTab.Loved) { goToTab(MusicTab.Loved) } }
                item { MusicTabChip("অফলাইন", tab == MusicTab.Offline) { goToTab(MusicTab.Offline) } }
            }

            if (tab in setOf(MusicTab.All, MusicTab.Genres, MusicTab.Artists, MusicTab.Albums)) {
                MusicSearchField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.padding(
                        horizontal = EditorialSpace.gutter,
                        vertical = EditorialSpace.sm
                    )
                )
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
                tab == MusicTab.Genres -> MusicShelfGrid(
                    shelves = genreShelves,
                    empty = if (query.isBlank()) "কোনো ধরন নেই।" else "কোনো ধরন মেলেনি।",
                    onOpen = { onGenreClick(it.name) }
                )
                tab == MusicTab.Artists -> MusicShelfGrid(
                    shelves = artistShelves,
                    empty = if (query.isBlank()) "কোনো শিল্পী নেই।" else "কোনো শিল্পী মেলেনি।",
                    onOpen = { onArtistClick(it.name) }
                )
                tab == MusicTab.Albums -> MusicShelfGrid(
                    shelves = albumShelves,
                    empty = if (query.isBlank()) "কোনো অ্যালবাম নেই।" else "কোনো অ্যালবাম মেলেনি।",
                    onOpen = { onAlbumClick(it.name) }
                )
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
                    MusicTrackList(
                        title = "পছন্দের গান",
                        subtitle = "আপনার সংরক্ষিত প্লেলিস্ট",
                        tracks = loved,
                        empty = "এখনো কোনো গান পছন্দ করা হয়নি।",
                        onPlay = { track -> player.play(track, loved, expand = true) },
                        onArtistClick = onArtistClick,
                        onAlbumClick = onAlbumClick,
                        onGenreClick = onGenreClick
                    )
                }
                tab == MusicTab.Offline -> MusicTrackList(
                    title = "অফলাইন",
                    subtitle = "এই ডিভাইসে সংরক্ষিত MP3",
                    tracks = offline,
                    empty = "কোনো গান অ্যাপে সংরক্ষণ করা হয়নি।",
                    onPlay = { track -> player.play(track, offline, expand = true) },
                    onArtistClick = onArtistClick,
                    onAlbumClick = onAlbumClick,
                    onGenreClick = onGenreClick
                )
                else -> MusicTrackList(
                    title = if (query.isBlank()) "সব গান" else "খোঁজার ফলাফল",
                    subtitle = if (query.isBlank()) {
                        "কণ্ঠে বিষ্ণুপ্রিয়া মণিপুরি সংস্কৃতি"
                    } else {
                        "${filtered.size}টি গান"
                    },
                    tracks = filtered,
                    empty = if (query.isBlank()) "এখনো কোনো গান যোগ করা হয়নি।" else "কোনো গান মেলেনি।",
                    onPlay = { track -> player.play(track, filtered, expand = true) },
                    onArtistClick = onArtistClick,
                    onAlbumClick = onAlbumClick,
                    onGenreClick = onGenreClick
                )
            }
        }
    }

    if (creating) {
        AlertDialog(
            onDismissRequest = { creating = false },
            title = { Text("নতুন প্লেলিস্ট", fontFamily = Kalpurush) },
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
        contentPadding = PaddingValues(bottom = 24.dp, top = EditorialSpace.md)
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
