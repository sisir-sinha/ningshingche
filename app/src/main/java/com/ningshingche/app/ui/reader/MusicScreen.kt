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
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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

    LaunchedEffect(Unit) { viewModel.loadMusicCatalog(force = true) }

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
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { padding ->
        when {
            loading && tracks.isEmpty() -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
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
            tracks.isEmpty() -> EmptyState(
                message = "এখনো কোনো গান যোগ করা হয়নি।",
                modifier = Modifier.padding(padding)
            )
            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
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
                        Text(
                            text = "সব গান",
                            style = EditorialType.Headline,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "কণ্ঠে বিষ্ণুপ্রিয়া মণিপুরি সংস্কৃতি",
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
                        onClick = { player.play(track, tracks, expand = true) }
                    )
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
