package com.ningshingche.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Article
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Visibility
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.ningshingche.app.data.portal.PublicArticle
import com.ningshingche.app.data.portal.PublicProfile
import com.ningshingche.app.ui.components.LocalMusicController
import com.ningshingche.app.ui.editorial.EditorialImage
import com.ningshingche.app.ui.editorial.EditorialShape
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.editorial.EditorialType
import com.ningshingche.app.ui.editorial.EmptyState
import com.ningshingche.app.ui.editorial.ErrorState
import com.ningshingche.app.ui.editorial.Hairline
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.editorial.toBengaliNumeral
import com.ningshingche.app.ui.theme.Kalpurush

/**
 * A registered reader's public page.
 *
 * Everything published by one user: the songs they uploaded and the articles
 * their submissions were turned into, with the totals the database keeps. It is
 * reached by tapping an uploader's name on a song, and it is readable by anyone
 * — a guest included — because the data comes from the `public_profile` RPC,
 * which returns published content and a name, never the writer's contact
 * details.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PublicProfileScreen(
    userId: String,
    loadProfile: suspend (String) -> Result<PublicProfile>,
    onBackClick: () -> Unit,
    onArticleClick: (String) -> Unit
) {
    var profile by remember(userId) { mutableStateOf<PublicProfile?>(null) }
    var error by remember(userId) { mutableStateOf<String?>(null) }
    var loading by remember(userId) { mutableStateOf(true) }
    // Bumped by Retry so the effect below runs again for the same user id.
    var reloadToken by remember(userId) { mutableIntStateOf(0) }
    val player = LocalMusicController.current

    LaunchedEffect(userId, reloadToken) {
        loading = true
        error = null
        loadProfile(userId)
            .onSuccess { profile = it }
            .onFailure { error = it.message ?: "প্রোফাইল লোড হয়নি।" }
        loading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = profile?.name ?: "ব্যবহারকারীর পাতা",
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 17.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBackClick, modifier = Modifier.testTag("public_profile_back")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "পেছনে")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                loading && profile == null -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) { CircularProgressIndicator() }

                profile == null -> ErrorState(
                    message = error ?: "এই ব্যবহারকারীর পাতা পাওয়া যায়নি।",
                    onRetry = {
                        error = null
                        loading = true
                        reloadToken += 1
                    }
                )

                else -> {
                    val loaded = profile!!
                    val songs = remember(loaded.id) { loaded.songs }
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .testTag("public_profile_${loaded.id}"),
                        contentPadding = PaddingValues(bottom = 88.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        item { ProfileHeader(loaded) }

                        if (songs.isNotEmpty()) {
                            item { SectionTitle("গান", songs.size) }
                            items(songs, key = { "song-${it.id}" }) { track ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = EditorialSpace.gutter),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Surface(
                                        shape = RoundedCornerShape(EditorialShape.card),
                                        color = MaterialTheme.colorScheme.surface,
                                        modifier = Modifier
                                            .weight(1f)
                                            .clickable {
                                                player.play(
                                                    track,
                                                    songs,
                                                    expand = true
                                                )
                                            }
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(EditorialSpace.md),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            EditorialImage(
                                                url = track.thumbnailUrl,
                                                contentDescription = track.title,
                                                modifier = Modifier.size(56.dp)
                                            )
                                            Spacer(Modifier.width(EditorialSpace.md))
                                            Column(Modifier.weight(1f)) {
                                                Text(
                                                    text = track.title,
                                                    style = EditorialType.Title,
                                                    maxLines = 2,
                                                    overflow = TextOverflow.Ellipsis
                                                )
                                                val credit = listOf(track.artist, track.album)
                                                    .filter { it.isNotBlank() }
                                                    .joinToString(" · ")
                                                if (credit.isNotBlank()) {
                                                    Text(
                                                        text = credit,
                                                        style = EditorialType.Caption,
                                                        color = LocalEditorialTokens.current.inkMuted,
                                                        maxLines = 1,
                                                        overflow = TextOverflow.Ellipsis
                                                    )
                                                }
                                                if (track.viewsCount > 0L) {
                                                    Text(
                                                        text = "${toBengaliNumeral(track.viewsCount)} বার শোনা",
                                                        style = EditorialType.Caption,
                                                        color = LocalEditorialTokens.current.inkMuted
                                                    )
                                                }
                                            }
                                            Icon(
                                                imageVector = Icons.Default.MusicNote,
                                                contentDescription = null,
                                                tint = MaterialTheme.colorScheme.primary
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        if (loaded.articles.isNotEmpty()) {
                            item { SectionTitle("প্রবন্ধ", loaded.articles.size) }
                            items(loaded.articles, key = { "article-${it.id}" }) { article ->
                                PublicArticleCard(article) { onArticleClick(article.id) }
                            }
                        }

                        if (songs.isEmpty() && loaded.articles.isEmpty()) {
                            item {
                                EmptyState(
                                    message = "এই ব্যবহারকারীর এখনো কিছু প্রকাশিত হয়নি।",
                                    modifier = Modifier.padding(EditorialSpace.lg)
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
private fun ProfileHeader(profile: PublicProfile) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.sm)
    ) {
        Column(
            modifier = Modifier.padding(EditorialSpace.lg),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .clip(CircleShape)
                        .background(tokens.surfaceSunken),
                    contentAlignment = Alignment.Center
                ) {
                    if (profile.avatarUrl.isNotBlank()) {
                        AsyncImage(
                            model = profile.avatarUrl,
                            contentDescription = profile.name,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        Text(
                            text = profile.name.trim().take(1).ifBlank { "ন" },
                            fontFamily = Kalpurush,
                            fontSize = 26.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
                Spacer(Modifier.width(EditorialSpace.md))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = profile.name,
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 19.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "নিংশিং চে-র পাঠক ও স্রষ্টা",
                        style = EditorialType.Caption,
                        color = tokens.inkMuted
                    )
                }
            }
            Hairline()
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                HeaderStat("মোট ভিউ", profile.totalViews)
                HeaderStat("প্রবন্ধ", profile.articles.size.toLong())
                HeaderStat("গান", profile.songs.size.toLong())
            }
        }
    }
}

@Composable
private fun HeaderStat(label: String, value: Long) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Default.Visibility,
                contentDescription = null,
                tint = LocalEditorialTokens.current.accent,
                modifier = Modifier.size(13.dp)
            )
            Spacer(Modifier.width(4.dp))
            Text(
                text = toBengaliNumeral(value),
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 17.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
        Text(
            text = label,
            style = EditorialType.Caption,
            color = LocalEditorialTokens.current.inkMuted
        )
    }
}

@Composable
private fun SectionTitle(title: String, count: Int) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            fontFamily = Kalpurush,
            fontWeight = FontWeight.Bold,
            fontSize = 16.sp
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = toBengaliNumeral(count),
            style = EditorialType.Caption,
            color = LocalEditorialTokens.current.inkMuted
        )
    }
}

@Composable
private fun PublicArticleCard(article: PublicArticle, onOpen: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(EditorialShape.card),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .clickable(onClick = onOpen)
    ) {
        Row(
            modifier = Modifier.padding(EditorialSpace.md),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(tokens.surfaceSunken),
                contentAlignment = Alignment.Center
            ) {
                if (article.thumbnailUrl.isNotBlank()) {
                    AsyncImage(
                        model = article.thumbnailUrl,
                        contentDescription = article.title,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Article,
                        contentDescription = null,
                        tint = tokens.inkMuted
                    )
                }
            }
            Spacer(Modifier.width(EditorialSpace.md))
            Column(Modifier.weight(1f)) {
                Text(
                    text = article.title,
                    style = EditorialType.Title,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                val meta = listOf(article.categoryTitle, article.publishedAt.take(10))
                    .filter { it.isNotBlank() }
                    .joinToString(" · ")
                if (meta.isNotBlank()) {
                    Text(
                        text = meta,
                        style = EditorialType.Caption,
                        color = tokens.inkMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (article.viewsCount > 0L) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Visibility,
                            contentDescription = null,
                            tint = tokens.inkMuted,
                            modifier = Modifier.size(13.dp)
                        )
                        Text(
                            text = "${toBengaliNumeral(article.viewsCount)} বার পঠিত",
                            style = EditorialType.Caption,
                            color = tokens.inkMuted
                        )
                    }
                }
            }
        }
    }
}
