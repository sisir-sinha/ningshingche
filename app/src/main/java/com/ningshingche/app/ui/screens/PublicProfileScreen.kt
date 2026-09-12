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
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Stars
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.WorkOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ningshingche.app.data.portal.MusicTrack
import com.ningshingche.app.data.portal.PublicArticle
import com.ningshingche.app.data.portal.PublicProfile
import com.ningshingche.app.ui.components.LocalMusicController
import com.ningshingche.app.ui.components.PortalAsyncImage
import com.ningshingche.app.ui.editorial.EditorialImage
import com.ningshingche.app.ui.editorial.EditorialShape
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.editorial.EmptyState
import com.ningshingche.app.ui.editorial.ErrorState
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.editorial.formatBengaliDate
import com.ningshingche.app.ui.editorial.toBengaliNumeral
import com.ningshingche.app.ui.theme.Kalpurush

/**
 * A registered reader's public page.
 *
 * Everything published by one user — the songs they uploaded and the articles
 * their submissions were turned into — with the totals the database keeps, led
 * by who they are: name, then what they do, then where they are. Those three
 * lines come from `profiles` and are simply absent when the reader has not
 * filled them in; nothing here invents a designation or an address.
 *
 * The two lists are tabs rather than one long column, each ordered most-read
 * first, and every row carries its published date. Reached by tapping a name on
 * a song, a contributor card or an author byline, and readable by anyone — a
 * guest included — because the data comes from the `public_profile` RPC
 * (migration 024, extended by 028), which never returns contact details.
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
    var selectedTab by remember(userId) { mutableIntStateOf(0) }
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
                    val articles = remember(loaded) { loaded.articlesByViews }
                    val songs = remember(loaded) { loaded.songsByViews }
                    // An empty tab is still a tab: hiding it would leave the
                    // reader wondering whether the article list exists at all.
                    val tabs = listOf(
                        "প্রবন্ধ" to articles.size,
                        "গান" to songs.size
                    )
                    val activeTab = selectedTab.coerceIn(0, tabs.lastIndex)

                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .testTag("public_profile_${loaded.id}"),
                        // The top inset keeps the identity card clear of the app
                        // bar, whose back arrow stays put while this scrolls.
                        contentPadding = PaddingValues(top = EditorialSpace.sm, bottom = 96.dp),
                        verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
                    ) {
                        item { ProfileHeader(loaded) }

                        item { ProfileStatistics(loaded) }

                        item {
                            TabRow(
                                selectedTabIndex = activeTab,
                                containerColor = MaterialTheme.colorScheme.surface,
                                contentColor = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.testTag("public_profile_tabs")
                            ) {
                                tabs.forEachIndexed { index, (label, count) ->
                                    Tab(
                                        selected = index == activeTab,
                                        onClick = { selectedTab = index },
                                        text = {
                                            Text(
                                                text = "$label (${toBengaliNumeral(count)})",
                                                fontFamily = Kalpurush,
                                                fontWeight = if (index == activeTab) {
                                                    FontWeight.Bold
                                                } else {
                                                    FontWeight.Normal
                                                },
                                                fontSize = 14.sp,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        },
                                        modifier = Modifier.testTag("public_profile_tab_$index")
                                    )
                                }
                            }
                        }

                        if (activeTab == 0) {
                            if (articles.isEmpty()) {
                                item {
                                    EmptyState(
                                        message = "এই ব্যবহারকারীর এখনো কোনো প্রকাশিত প্রবন্ধ নেই।",
                                        modifier = Modifier.padding(EditorialSpace.lg)
                                    )
                                }
                            }
                            items(articles, key = { "article-${it.id}" }) { article ->
                                PublicArticleCard(article) { onArticleClick(article.id) }
                            }
                        } else {
                            if (songs.isEmpty()) {
                                item {
                                    EmptyState(
                                        message = "এই ব্যবহারকারীর এখনো কোনো গান প্রকাশিত হয়নি।",
                                        modifier = Modifier.padding(EditorialSpace.lg)
                                    )
                                }
                            }
                            items(songs, key = { "song-${it.id}" }) { track ->
                                PublicSongCard(track) {
                                    // The whole list becomes the queue, in the
                                    // order the reader is looking at.
                                    player.play(track, songs, expand = true)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Name, then what they do, then where they are — in that order, and only real. */
@Composable
private fun ProfileHeader(profile: PublicProfile) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(EditorialShape.card),
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = EditorialSpace.lg, vertical = EditorialSpace.lg),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(88.dp)
                    .clip(CircleShape)
                    .background(tokens.surfaceSunken),
                contentAlignment = Alignment.Center
            ) {
                if (profile.avatarUrl.isNotBlank()) {
                    PortalAsyncImage(
                        url = profile.avatarUrl,
                        contentDescription = profile.name,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    Text(
                        text = profile.name.trim().take(1).ifBlank { "ন" },
                        fontFamily = Kalpurush,
                        fontSize = 34.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }

            Spacer(Modifier.height(EditorialSpace.sm))
            Text(
                text = profile.name,
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.testTag("public_profile_name")
            )

            // Designation: what they call themselves, or the one thing that is
            // true of every account here. Never a made-up job title.
            Spacer(Modifier.height(2.dp))
            ProfileDetailLine(
                icon = Icons.Default.WorkOutline,
                text = profile.designation.ifBlank { "পাঠক" },
                muted = profile.designation.isBlank(),
                testTag = "public_profile_designation"
            )

            // Address: the first line of it, and only if there is one.
            if (profile.shortAddress.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                ProfileDetailLine(
                    icon = Icons.Default.Place,
                    text = profile.shortAddress,
                    muted = false,
                    testTag = "public_profile_address"
                )
            }
        }
    }
}

@Composable
private fun ProfileDetailLine(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
    muted: Boolean,
    testTag: String
) {
    val tokens = LocalEditorialTokens.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (muted) tokens.inkMuted else tokens.accent,
            modifier = Modifier.size(13.dp)
        )
        Spacer(Modifier.width(5.dp))
        Text(
            text = text,
            fontFamily = Kalpurush,
            fontSize = 13.sp,
            color = if (muted) tokens.inkMuted else tokens.inkSoft,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.testTag(testTag)
        )
    }
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** The three numbers the owner asked for: views, points, and this month's. */
@Composable
private fun ProfileStatistics(profile: PublicProfile) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(EditorialShape.card),
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .testTag("public_profile_statistics")
    ) {
        Row(
            modifier = Modifier.padding(vertical = EditorialSpace.md),
            verticalAlignment = Alignment.CenterVertically
        ) {
            StatisticTile(
                icon = Icons.Default.Visibility,
                value = profile.totalViews,
                label = "মোট ভিউ",
                tint = tokens.accent,
                modifier = Modifier.weight(1f)
            )
            StatisticDivider()
            StatisticTile(
                icon = Icons.Default.Stars,
                value = profile.points.toLong(),
                label = "মোট পয়েন্ট",
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.weight(1f)
            )
            StatisticDivider()
            StatisticTile(
                icon = Icons.Default.EmojiEvents,
                value = profile.monthPoints.toLong(),
                label = "এই মাসের পয়েন্ট",
                tint = tokens.accent,
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun StatisticTile(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    value: Long,
    label: String,
    tint: Color,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.padding(horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(16.dp)
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = toBengaliNumeral(value),
            fontFamily = Kalpurush,
            fontWeight = FontWeight.Bold,
            fontSize = 18.sp,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            // "এই মাসের পয়েন্ট" is the longest label on the row: two lines are
            // allowed rather than letting it push the numbers apart.
            text = label,
            fontFamily = Kalpurush,
            fontSize = 11.5.sp,
            color = LocalEditorialTokens.current.inkMuted,
            maxLines = 2,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun StatisticDivider() {
    Box(
        modifier = Modifier
            .height(38.dp)
            .width(1.dp)
            .background(LocalEditorialTokens.current.rule)
    )
}

// ---------------------------------------------------------------------------
// The two lists
// ---------------------------------------------------------------------------

/** One article, with what it was published in, when, and how often it was read. */
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
            .testTag("public_article_${article.id}")
    ) {
        Row(
            modifier = Modifier.padding(EditorialSpace.md),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(RoundedCornerShape(EditorialShape.thumb))
                    .background(tokens.surfaceSunken),
                contentAlignment = Alignment.Center
            ) {
                if (article.thumbnailUrl.isNotBlank()) {
                    PortalAsyncImage(
                        url = article.thumbnailUrl,
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
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    lineHeight = 22.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(4.dp))
                // The published date is the point of the row, so it is shown
                // even when the article has no category.
                ArticleFactRow(
                    category = article.categoryTitle,
                    date = formatBengaliDate(article.publishedAt),
                    views = article.viewsCount
                )
            }
        }
    }
}

/** One song, with the date it was uploaded and how often it was played. */
@Composable
private fun PublicSongCard(track: MusicTrack, onPlay: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(EditorialShape.card),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .clickable(onClick = onPlay)
            .testTag("public_song_${track.id}")
    ) {
        Row(
            modifier = Modifier.padding(EditorialSpace.md),
            verticalAlignment = Alignment.CenterVertically
        ) {
            EditorialImage(
                url = track.thumbnailUrl,
                contentDescription = track.title,
                modifier = Modifier.size(64.dp)
            )
            Spacer(Modifier.width(EditorialSpace.md))
            Column(Modifier.weight(1f)) {
                Text(
                    text = track.title,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    lineHeight = 22.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(4.dp))
                ArticleFactRow(
                    category = listOf(track.artist, track.album)
                        .filter { it.isNotBlank() }
                        .joinToString(" · "),
                    date = formatBengaliDate(track.createdAt),
                    views = track.viewsCount,
                    viewsLabel = "বার শোনা"
                )
            }
            Spacer(Modifier.width(EditorialSpace.xs))
            Icon(
                imageVector = Icons.Default.MusicNote,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
        }
    }
}

/**
 * The facts under a row: the date, the category or artist, and the view count.
 * Each is dropped when it is empty, so a row never shows a stray separator.
 */
@Composable
private fun ArticleFactRow(
    category: String,
    date: String,
    views: Long,
    viewsLabel: String = "বার পঠিত"
) {
    val tokens = LocalEditorialTokens.current
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        val meta = listOf(category, date).filter { it.isNotBlank() }.joinToString(" · ")
        if (meta.isNotBlank()) {
            Text(
                text = meta,
                fontFamily = Kalpurush,
                fontSize = 12.sp,
                color = tokens.inkMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Default.Visibility,
                contentDescription = null,
                tint = tokens.accent,
                modifier = Modifier.size(13.dp)
            )
            Spacer(Modifier.width(4.dp))
            Text(
                text = "${toBengaliNumeral(views)} $viewsLabel",
                fontFamily = Kalpurush,
                fontSize = 12.sp,
                color = tokens.inkSoft
            )
        }
    }
}
