package com.ningshingche.app.ui.reader

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ningshingche.app.data.portal.VideoItem
import com.ningshingche.app.ui.editorial.EditorialImage
import com.ningshingche.app.ui.editorial.EditorialShape
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.editorial.EditorialType
import com.ningshingche.app.ui.editorial.EmptyState
import com.ningshingche.app.ui.editorial.Hairline
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.editorial.VideoPlayerDialog

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideosScreen(
    viewModel: HomeViewModel,
    onBackClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val videos by viewModel.videoCatalog.collectAsState()
    val loading by viewModel.videosLoading.collectAsState()
    val context = LocalContext.current
    var selectedVideo by remember { mutableStateOf<VideoItem?>(null) }

    LaunchedEffect(Unit) { viewModel.loadVideoCatalog() }

    selectedVideo?.let { video ->
        VideoPlayerDialog(
            video = video,
            onDismiss = { selectedVideo = null },
            onOpenExternal = { url ->
                if (url.isNotBlank()) {
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    }
                }
            }
        )
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "ভিডিও",
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
            loading && videos.isEmpty() -> Box(
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
            videos.isEmpty() -> EmptyState(
                message = "এখনো কোনো ভিডিও প্রকাশিত হয়নি।",
                modifier = Modifier.padding(padding)
            )
            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(bottom = EditorialSpace.xxl)
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
                            text = "সব ভিডিও",
                            style = EditorialType.Headline,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "নড়াচড়া ও কণ্ঠে সংস্কৃতি",
                            style = EditorialType.Caption,
                            color = LocalEditorialTokens.current.inkMuted,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                        Spacer(Modifier.height(EditorialSpace.sm))
                        Hairline()
                    }
                }
                items(videos, key = { it.id }) { video ->
                    VideoCatalogCard(
                        video = video,
                        onClick = { selectedVideo = video }
                    )
                }
            }
        }
    }
}

@Composable
private fun VideoCatalogCard(
    video: VideoItem,
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
        Column {
            Box {
                EditorialImage(
                    url = video.thumbnailUrl,
                    contentDescription = video.title,
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(16f / 9f)
                )
                Surface(
                    shape = RoundedCornerShape(EditorialShape.chip),
                    color = Color(0xCC1A1512),
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(EditorialSpace.sm)
                ) {
                    Text(
                        text = video.platform.ifBlank { "ভিডিও" },
                        style = EditorialType.Caption,
                        color = Color.White,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = tokens.accent.copy(alpha = 0.92f),
                    modifier = Modifier.align(Alignment.Center)
                ) {
                    Icon(
                        imageVector = Icons.Default.PlayArrow,
                        contentDescription = "চালান",
                        tint = Color.White,
                        modifier = Modifier.padding(10.dp)
                    )
                }
            }
            Column(Modifier.padding(EditorialSpace.md), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = video.title,
                    style = EditorialType.Title,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                if (video.description.isNotBlank()) {
                    Text(
                        text = video.description,
                        style = EditorialType.BodySmall,
                        color = tokens.inkSoft,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}
