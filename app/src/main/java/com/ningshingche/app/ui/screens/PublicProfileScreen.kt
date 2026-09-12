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
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.TextButton
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.rememberCoroutineScope
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
import kotlinx.coroutines.launch
import com.ningshingche.app.data.portal.ForumActivityAnswer
import com.ningshingche.app.data.portal.ForumActivityThread
import com.ningshingche.app.data.portal.MusicTrack
import com.ningshingche.app.data.portal.Paged
import com.ningshingche.app.data.portal.ProfileItem
import com.ningshingche.app.data.portal.ProfileTotals
import com.ningshingche.app.data.portal.forumBodyText
import com.ningshingche.app.data.portal.PortalError
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
    // The lists are their own calls now, and they are paged: five rows to a page,
    // and a page only when the reader asks for one. The identity card and the
    // statistics above them come from `public_profile`; a list that fails is only
    // ever "this tab could not be read".
    loadTotals: suspend (String) -> Result<ProfileTotals> = { Result.failure(PortalError.NotFound) },
    loadPage: suspend (String, String, Int) -> Result<Paged<ProfileItem>> = { _, _, _ ->
        Result.failure(PortalError.NotFound)
    },
    onBackClick: () -> Unit,
    onArticleClick: (String) -> Unit,
    onDiscussionClick: (String) -> Unit = {}
) {
    var profile by remember(userId) { mutableStateOf<PublicProfile?>(null) }
    var error by remember(userId) { mutableStateOf<String?>(null) }
    var loading by remember(userId) { mutableStateOf(true) }
    // Bumped by Retry so the effects below run again for the same user id.
    var reloadToken by remember(userId) { mutableIntStateOf(0) }
    var selectedTab by remember(userId) { mutableIntStateOf(0) }
    // The আলোচনা tab's own filter: this reader's আলোচনা, or their উত্তর.
    var forumTab by remember(userId) { mutableIntStateOf(0) }
    val player = LocalMusicController.current

    var totals by remember(userId) { mutableStateOf(ProfileTotals()) }
    // One page per kind, kept apart so switching tabs does not throw away a page
    // the reader has already paid for.
    var pages by remember(userId) { mutableStateOf(mapOf<String, Paged<ProfileItem>>()) }
    var listError by remember(userId) { mutableStateOf<String?>(null) }
    var listLoading by remember(userId) { mutableStateOf(false) }
    var loadingMore by remember(userId) { mutableStateOf(false) }

    LaunchedEffect(userId, reloadToken) {
        loading = true
        error = null
        loadProfile(userId)
            .onSuccess { profile = it }
            .onFailure { error = it.message ?: "প্রোফাইল লোড হয়নি।" }
        loading = false
    }

    LaunchedEffect(userId, reloadToken) {
        totals = loadTotals(userId).getOrElse { ProfileTotals() }
    }

    // The four totals the tabs are labelled with, in the database's words. An
    // old database without the paging function falls back to what the profile
    // itself carried, so a tab still shows a number.
    val loaded = profile
    val shownTotals = if (totals.articles + totals.songs + totals.threads + totals.answers > 0) {
        totals
    } else {
        ProfileTotals(
            articles = loaded?.articles.orEmpty().size,
            songs = loaded?.songs.orEmpty().size,
            threads = totals.threads,
            answers = totals.answers
        )
    }

    val kind = when (selectedTab) {
        0 -> ProfileTotals.ARTICLES
        1 -> ProfileTotals.SONGS
        else -> if (forumTab == 0) ProfileTotals.THREADS else ProfileTotals.ANSWERS
    }
    val page = pages[kind] ?: Paged(emptyList(), 0)

    // Five rows, once per kind: the page a tab shows first. The guard keeps a
    // kind that already has rows from asking again on every redraw.
    LaunchedEffect(userId, kind, reloadToken) {
        val already = pages[kind]?.items.orEmpty()
        if (already.isNotEmpty() && reloadToken == 0) return@LaunchedEffect
        listLoading = true
        listError = null
        loadPage(userId, kind, 0)
            .onSuccess { loadedPage -> pages = pages + (kind to loadedPage) }
            .onFailure { listError = profileListMessage(it) }
        listLoading = false
    }

    // The next five. The offset is how many rows the screen already holds, so the
    // database sends rows the reader has not read — never the same page twice.
    val scope = rememberCoroutineScope()
    val loadMore: () -> Unit = {
        val current = pages[kind] ?: Paged(emptyList(), 0)
        if (!loadingMore && current.hasMore) {
            loadingMore = true
            listError = null
            scope.launch {
                loadPage(userId, kind, current.loaded)
                    .onSuccess { next ->
                        val held = pages[kind] ?: current
                        pages = pages + (kind to held.copy(
                            items = held.items + next.items,
                            total = next.total,
                            offset = held.offset
                        ))
                    }
                    .onFailure { listError = profileListMessage(it) }
                loadingMore = false
            }
        }
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
                    val person = profile ?: return@Box
                    // Three tabs, each with the database's own count. An empty tab
                    // is still a tab: hiding it would leave the reader wondering
                    // whether the list exists at all.
                    val tabs = listOf(
                        "প্রবন্ধ" to shownTotals.articles,
                        "গান" to shownTotals.songs,
                        "আলোচনা" to (shownTotals.threads + shownTotals.answers)
                    )
                    val activeTab = selectedTab.coerceIn(0, tabs.lastIndex)

                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .testTag("public_profile_${person.id}"),
                        // The top inset keeps the identity card clear of the app
                        // bar, whose back arrow stays put while this scrolls.
                        contentPadding = PaddingValues(top = EditorialSpace.sm, bottom = 96.dp),
                        verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
                    ) {
                        item { ProfileHeader(person) }

                        item { ProfileStatistics(person) }

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

                        // Inside আলোচনা: this reader's discussions, and the answers
                        // they wrote. Two filters, and the one that is picked is
                        // the list below — not a second copy of the same numbers.
                        if (activeTab == 2) {
                            item {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = EditorialSpace.gutter),
                                    horizontalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
                                ) {
                                    ProfileForumChip(
                                        label = "আলোচনা",
                                        count = shownTotals.threads,
                                        selected = forumTab == 0,
                                        onClick = { forumTab = 0 },
                                        testTag = "public_profile_forum_threads"
                                    )
                                    ProfileForumChip(
                                        label = "উত্তর",
                                        count = shownTotals.answers,
                                        selected = forumTab == 1,
                                        onClick = { forumTab = 1 },
                                        testTag = "public_profile_forum_answers"
                                    )
                                }
                            }
                        }

                        val rows = page.items
                        when {
                            listError != null && rows.isEmpty() -> item {
                                ErrorState(
                                    message = listError.orEmpty(),
                                    onRetry = {
                                        pages = pages - kind
                                        reloadToken += 1
                                    },
                                    modifier = Modifier.testTag("public_profile_list_error")
                                )
                            }

                            listLoading && rows.isEmpty() -> item {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(EditorialSpace.lg),
                                    contentAlignment = Alignment.Center
                                ) { CircularProgressIndicator(modifier = Modifier.size(22.dp)) }
                            }

                            rows.isEmpty() -> item {
                                EmptyState(
                                    message = when (kind) {
                                        ProfileTotals.ARTICLES -> "এই ব্যবহারকারীর এখনো কোনো প্রকাশিত প্রবন্ধ নেই।"
                                        ProfileTotals.SONGS -> "এই ব্যবহারকারীর এখনো কোনো গান প্রকাশিত হয়নি।"
                                        ProfileTotals.THREADS -> "এই ব্যবহারকারী এখনো কোনো আলোচনা শুরু করেননি।"
                                        else -> "এই ব্যবহারকারী এখনো কোনো উত্তর লেখেননি।"
                                    },
                                    modifier = Modifier
                                        .padding(EditorialSpace.lg)
                                        .testTag("public_profile_list_empty")
                                )
                            }
                        }

                        items(rows, key = { it.key }) { row ->
                            when (row) {
                                is ProfileItem.Article -> PublicArticleCard(row.article) {
                                    onArticleClick(row.article.id)
                                }

                                is ProfileItem.Song -> PublicSongCard(row.song) {
                                    // The whole list becomes the queue, in the order
                                    // the reader is looking at.
                                    player.play(
                                        row.song,
                                        rows.filterIsInstance<ProfileItem.Song>().map { it.song },
                                        expand = true
                                    )
                                }

                                is ProfileItem.Thread -> ProfileThreadRow(row.thread) {
                                    onDiscussionClick(row.thread.id)
                                }

                                is ProfileItem.Answer -> ProfileAnswerRow(row.answer) {
                                    onDiscussionClick(row.answer.discussionId)
                                }
                            }
                        }

                        // Five at a time, and the rest behind this button: the
                        // owner's rule. It is never a page of its own — the rows
                        // already on screen stay, and the next five are added.
                        if (page.hasMore) {
                            item {
                                TextButton(
                                    onClick = loadMore,
                                    enabled = !loadingMore,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .testTag("public_profile_more")
                                ) {
                                    if (loadingMore) {
                                        CircularProgressIndicator(
                                            modifier = Modifier.size(16.dp),
                                            strokeWidth = 2.dp
                                        )
                                    } else {
                                        Text(
                                            text = "আরও দেখুন (${toBengaliNumeral(page.total - page.loaded)})",
                                            fontFamily = Kalpurush,
                                            fontWeight = FontWeight.SemiBold,
                                            fontSize = 13.sp,
                                            color = LocalEditorialTokens.current.accent
                                        )
                                    }
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
// The forum rows
//
// A reader's আলোচনা and উত্তর on their public page. Both are a card with the
// subject at the top, the words under it, and a footer: the reactions as icons
// with their counts, and the date **at the right-hand edge** — the owner's rule
// for this page, and the same one the forum's own cards follow.
// ---------------------------------------------------------------------------

@Composable
private fun ProfileThreadRow(thread: ForumActivityThread, onClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(EditorialShape.card),
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .clickable(onClick = onClick)
            .testTag("public_profile_thread_${thread.id}")
    ) {
        Column(
            modifier = Modifier.padding(EditorialSpace.md),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = thread.categoryTitle,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 11.sp,
                    color = tokens.accent,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = formatBengaliDate(thread.createdAt),
                    fontFamily = Kalpurush,
                    fontSize = 11.sp,
                    color = tokens.inkMuted,
                    maxLines = 1,
                    modifier = Modifier.testTag("public_profile_thread_date_${thread.id}")
                )
            }
            Text(
                text = thread.title,
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 15.5.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            // The excerpt folds on the same hundred characters a forum card does,
            // so a profile is not the one place that shows a wall of text.
            val words = profileExcerpt(thread.excerpt)
            if (words.isNotBlank()) {
                Text(
                    text = words,
                    fontFamily = Kalpurush,
                    fontSize = 12.5.sp,
                    lineHeight = 17.sp,
                    color = tokens.inkMuted,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )
            }
            ProfileForumCounters(views = thread.views, replies = thread.replies, answered = thread.replies > 0)
        }
    }
}

@Composable
private fun ProfileAnswerRow(answer: ForumActivityAnswer, onClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(EditorialShape.card),
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .clickable(onClick = onClick)
            .testTag("public_profile_answer_${answer.id}")
    ) {
        Column(
            modifier = Modifier.padding(EditorialSpace.md),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = answer.discussionTitle,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    color = tokens.accent,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = formatBengaliDate(answer.createdAt),
                    fontFamily = Kalpurush,
                    fontSize = 11.sp,
                    color = tokens.inkMuted,
                    maxLines = 1,
                    modifier = Modifier.testTag("public_profile_answer_date_${answer.id}")
                )
            }
            val words = profileExcerpt(answer.excerpt)
            Text(
                text = words,
                fontFamily = Kalpurush,
                fontSize = 12.5.sp,
                lineHeight = 17.sp,
                color = tokens.inkMuted,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )
            // The reactions as icons, never as a row of words with numbers after
            // them: the owner has already made the forum's own row icons, and a
            // profile that spelled them out was the last place that did.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
            ) {
                ProfileReactionCount(Icons.Default.ThumbUp, "লাইক", answer.likes, "public_profile_answer_likes_${answer.id}")
                ProfileReactionCount(Icons.Default.CheckCircle, "একমত", answer.agrees, "public_profile_answer_agrees_${answer.id}")
                ProfileReactionCount(Icons.Default.ThumbDown, "অপছন্দ", answer.dislikes, "public_profile_answer_dislikes_${answer.id}")
            }
        }
    }
}

/** One reaction: an icon and its count. No words, no button — a profile is a read. */
@Composable
private fun ProfileReactionCount(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    count: Int,
    testTag: String
) {
    val tokens = LocalEditorialTokens.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.testTag(testTag)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = tokens.inkMuted,
            modifier = Modifier.size(13.dp)
        )
        Spacer(Modifier.width(3.dp))
        Text(
            text = toBengaliNumeral(count),
            fontFamily = Kalpurush,
            fontSize = 11.5.sp,
            color = tokens.inkMuted
        )
    }
}

/** Views, then answers — the same two counters a forum card carries. */
@Composable
private fun ProfileForumCounters(views: Long, replies: Int, answered: Boolean) {
    val tokens = LocalEditorialTokens.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Default.Visibility,
                contentDescription = "ভিউ",
                tint = tokens.inkMuted,
                modifier = Modifier.size(13.dp)
            )
            Spacer(Modifier.width(3.dp))
            Text(
                text = toBengaliNumeral(views),
                fontFamily = Kalpurush,
                fontSize = 11.5.sp,
                color = tokens.inkMuted
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Default.ChatBubbleOutline,
                contentDescription = "উত্তর",
                tint = if (answered) tokens.accent else tokens.inkMuted,
                modifier = Modifier.size(13.dp)
            )
            Spacer(Modifier.width(3.dp))
            Text(
                text = toBengaliNumeral(replies),
                fontFamily = Kalpurush,
                fontSize = 11.5.sp,
                color = if (answered) tokens.accent else tokens.inkMuted
            )
        }
    }
}

/** আলোচনা / উত্তর — the two filters inside the আলোচনা tab. */
@Composable
private fun ProfileForumChip(
    label: String,
    count: Int,
    selected: Boolean,
    onClick: () -> Unit,
    testTag: String
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = {
            Text(
                text = "$label (${toBengaliNumeral(count)})",
                fontFamily = Kalpurush,
                fontWeight = FontWeight.SemiBold
            )
        },
        modifier = Modifier.testTag(testTag)
    )
}

/**
 * Why a list would not load, in words a reader can act on.
 *
 * The lists come from `profile_items` — migration 033 — and PostgREST answers a
 * database without it with a 404. The owner is the one who runs the SQL, so the
 * message names the file rather than saying "server error": this is the only place
 * in the app that can tell a missing migration from a flat network.
 */
private fun profileListMessage(error: Throwable): String =
    if (error is PortalError.SchemaMissing) {
        "তালিকা পড়তে ডেটাবেস আপডেট দরকার — 033_profile_paging.sql চালান।"
    } else {
        error.message ?: "তালিকাটি লোড হয়নি।"
    }

/** How much of an excerpt a profile card shows before it ellipsises. */
private const val PROFILE_EXCERPT_CHARS = 100

/**
 * The hundred characters a profile row shows of a আলোচনা or an উত্তর, and then an
 * ellipsis — the same rule the forum's own cards follow, so a reader who taps a
 * name sees the same sentence cut in the same place twice.
 */
private fun profileExcerpt(text: String, limit: Int = PROFILE_EXCERPT_CHARS): String {
    val plain = forumBodyText(text).trim()
    if (plain.length <= limit) return plain
    return plain.take(limit).trimEnd() + "…"
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
