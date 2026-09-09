package com.ningshingche.app.ui.reader

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ningshingche.app.data.music.MusicCatalogIndex
import com.ningshingche.app.data.music.MusicGenres
import com.ningshingche.app.data.music.MusicShelf
import com.ningshingche.app.data.music.MusicShelfKind
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
import com.ningshingche.app.ui.theme.Kalpurush

@Composable
internal fun MusicSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "গান, শিল্পী, অ্যালবাম, ধরন…"
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = true,
        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
        trailingIcon = {
            if (value.isNotEmpty()) {
                IconButton(onClick = { onValueChange("") }) {
                    Icon(Icons.Default.Close, contentDescription = "মুছুন")
                }
            }
        },
        placeholder = { Text(placeholder, fontFamily = Kalpurush) },
        modifier = modifier.fillMaxWidth()
    )
}

@Composable
internal fun MusicTrackList(
    title: String,
    subtitle: String,
    tracks: List<MusicTrack>,
    empty: String,
    onPlay: (MusicTrack) -> Unit,
    onArtistClick: (String) -> Unit = {},
    onAlbumClick: (String) -> Unit = {},
    onGenreClick: (String) -> Unit = {}
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
            MusicCatalogCard(
                track = track,
                onClick = { onPlay(track) },
                onArtistClick = onArtistClick,
                onAlbumClick = onAlbumClick,
                onGenreClick = onGenreClick
            )
        }
    }
}

@Composable
internal fun MusicShelfGrid(
    shelves: List<MusicShelf>,
    empty: String,
    onOpen: (MusicShelf) -> Unit
) {
    if (shelves.isEmpty()) {
        EmptyState(message = empty)
        return
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 148.dp),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = EditorialSpace.gutter,
            end = EditorialSpace.gutter,
            top = EditorialSpace.md,
            bottom = 96.dp
        ),
        horizontalArrangement = Arrangement.spacedBy(EditorialSpace.md),
        verticalArrangement = Arrangement.spacedBy(EditorialSpace.md)
    ) {
        items(shelves, key = { "${it.kind}-${it.name}" }) { shelf ->
            MusicShelfCard(shelf = shelf, onClick = { onOpen(shelf) })
        }
    }
}

@Composable
private fun MusicShelfCard(shelf: MusicShelf, onClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    val round = shelf.kind == MusicShelfKind.Artist
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(EditorialShape.card),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(EditorialSpace.sm)) {
            EditorialImage(
                url = shelf.imageUrl,
                contentDescription = shelf.name,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .clip(if (round) CircleShape else RoundedCornerShape(12.dp))
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = shelf.name,
                style = EditorialType.Title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontFamily = Kalpurush
            )
            Text(
                text = "${shelf.trackCount}টি গান",
                style = EditorialType.Caption,
                color = tokens.inkMuted,
                maxLines = 1
            )
        }
    }
}

@Composable
internal fun MusicCatalogCard(
    track: MusicTrack,
    onClick: () -> Unit,
    onArtistClick: (String) -> Unit = {},
    onAlbumClick: (String) -> Unit = {},
    onGenreClick: (String) -> Unit = {}
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
                if (track.artist.isNotBlank()) {
                    Text(
                        text = track.artist,
                        style = EditorialType.Caption,
                        color = tokens.inkMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clickable { onArtistClick(track.artist) }
                    )
                }
                if (track.album.isNotBlank()) {
                    Text(
                        text = track.album,
                        style = EditorialType.Caption,
                        color = tokens.inkMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clickable { onAlbumClick(track.album) }
                    )
                }
                val genres = MusicGenres.parse(track.genre)
                if (genres.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        genres.take(3).forEach { genre ->
                            Text(
                                text = genre,
                                style = EditorialType.Caption,
                                color = tokens.accent,
                                maxLines = 1,
                                modifier = Modifier.clickable { onGenreClick(genre) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MusicEntityScreen(
    kind: MusicShelfKind,
    name: String,
    viewModel: HomeViewModel,
    onBackClick: () -> Unit,
    onArtistClick: (String) -> Unit,
    onAlbumClick: (String) -> Unit,
    onGenreClick: (String) -> Unit
) {
    val tracks by viewModel.musicCatalog.collectAsState()
    val loading by viewModel.musicLoading.collectAsState()
    val error by viewModel.musicError.collectAsState()
    val player = LocalMusicController.current
    LaunchedEffect(Unit) { viewModel.loadMusicCatalog() }

    val matched = remember(tracks, kind, name) {
        MusicCatalogIndex.tracksFor(kind, name, tracks)
    }
    val shelf = remember(tracks, kind, name) {
        MusicCatalogIndex.shelf(kind, name, tracks)
    }
    val heading = when (kind) {
        MusicShelfKind.Genre -> "ধরন"
        MusicShelfKind.Artist -> "শিল্পী"
        MusicShelfKind.Album -> "অ্যালবাম"
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = shelf?.name ?: name,
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
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { padding ->
        when {
            loading && tracks.isEmpty() -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    color = LocalEditorialTokens.current.accent,
                    strokeWidth = 2.dp
                )
            }
            tracks.isEmpty() && !error.isNullOrBlank() -> ErrorState(
                message = error.orEmpty(),
                onRetry = { viewModel.loadMusicCatalog(force = true) },
                modifier = Modifier.padding(padding)
            )
            matched.isEmpty() -> EmptyState(
                message = "এই $heading-এ কোনো গান নেই।",
                modifier = Modifier.padding(padding)
            )
            else -> {
                val round = kind == MusicShelfKind.Artist
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(padding),
                    contentPadding = PaddingValues(bottom = 96.dp)
                ) {
                    item {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.md),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            EditorialImage(
                                url = shelf?.imageUrl.orEmpty(),
                                contentDescription = shelf?.name ?: name,
                                modifier = Modifier
                                    .size(if (round) 128.dp else 168.dp)
                                    .clip(if (round) CircleShape else RoundedCornerShape(18.dp))
                            )
                            Spacer(Modifier.height(EditorialSpace.md))
                            Text(
                                text = shelf?.name ?: name,
                                style = EditorialType.Headline,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = heading + " · ${matched.size}টি গান",
                                style = EditorialType.Caption,
                                color = LocalEditorialTokens.current.inkMuted,
                                modifier = Modifier.padding(top = 4.dp)
                            )
                            val bio = shelf?.description.orEmpty()
                            if (bio.isNotBlank()) {
                                Spacer(Modifier.height(EditorialSpace.sm))
                                Text(
                                    text = bio,
                                    style = EditorialType.Body,
                                    color = LocalEditorialTokens.current.inkSoft
                                )
                            }
                            Spacer(Modifier.height(EditorialSpace.md))
                            Button(onClick = {
                                matched.firstOrNull()?.let { player.play(it, matched, expand = true) }
                            }) {
                                Icon(Icons.Default.PlayArrow, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text("সব চালান", fontFamily = Kalpurush)
                            }
                            Spacer(Modifier.height(EditorialSpace.md))
                            Hairline()
                        }
                    }
                    items(matched, key = { it.id }) { track ->
                        MusicCatalogCard(
                            track = track,
                            onClick = { player.play(track, matched, expand = true) },
                            onArtistClick = onArtistClick,
                            onAlbumClick = onAlbumClick,
                            onGenreClick = onGenreClick
                        )
                    }
                }
            }
        }
    }
}
