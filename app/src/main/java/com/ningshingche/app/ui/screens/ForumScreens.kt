package com.ningshingche.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Reply
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.ningshingche.app.data.local.ForumDraftStore
import com.ningshingche.app.data.portal.ForumActivity
import com.ningshingche.app.data.portal.ForumCategory
import com.ningshingche.app.data.portal.ForumCategoryPage
import com.ningshingche.app.data.portal.ForumDiscussion
import com.ningshingche.app.data.portal.ForumOverview
import com.ningshingche.app.data.portal.ForumReactionState
import com.ningshingche.app.data.portal.ForumReply
import com.ningshingche.app.data.portal.ForumSearchResult
import com.ningshingche.app.data.portal.ForumText
import com.ningshingche.app.data.portal.ForumThread
import com.ningshingche.app.data.portal.PortalError
import com.ningshingche.app.data.remote.ImgBbUploader
import com.ningshingche.app.ui.components.HtmlContentEditor
import com.ningshingche.app.ui.components.PortalAsyncImage
import com.ningshingche.app.ui.editorial.EditorialShape
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.editorial.EmptyState
import com.ningshingche.app.ui.editorial.ErrorState
import com.ningshingche.app.ui.editorial.Hairline
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.editorial.formatBengaliDate
import com.ningshingche.app.ui.editorial.toBengaliNumeral
import com.ningshingche.app.ui.reader.RichHtmlArticleBody
import com.ningshingche.app.ui.theme.Kalpurush
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * ফোরাম — a basic forum on the same rails as the rest of the reader.
 *
 * Four screens in one file, because they are four views of one subject and the
 * shared vocabulary between them (a card, a counter, an author block) is longer
 * than any of them on its own.
 *
 * What the second pass added, all of it asked for by the owner:
 *
 *   * বিভাগসমূহ is an inline rail that scrolls sideways, not a stack of cards;
 *   * সাম্প্রতিক আলোচনা has a filter — সাম্প্রতিক, জনপ্রিয় (most answers),
 *     অনুমোদিত (the threads the admin opened);
 *   * a new thread can carry an ImgBB cover image, and its body is written in the
 *     app's rich editor in its compact shape — bold, italic, underline, a list
 *     and an image, with no selection popup;
 *   * the composer and every reply box remember what was typed until it posts;
 *   * answers take reactions from a long press — লাইক, অপছন্দ, একমত;
 *   * a long body folds behind a small **আরও দেখুন**, with no border and no fill;
 *   * answers can be answered, indented once and never twice, with only the
 *     newest reply under each one until **সব উত্তর দেখুন** is tapped;
 *   * উত্তরসমূহ has its own filter — শীর্ষ (most liked or agreed) and সাম্প্রতিক;
 *   * an author's picture and name open their public page;
 *   * the top bar carries the notification bell rather than a search icon. The
 *     search *field* is still there, because a forum that cannot be searched is
 *     not a forum; the icon is what the owner did not want.
 *
 * Nothing here holds content of its own: rooms are rows, threads are rows, and a
 * number on a card is a number the database sent.
 */

private const val FORUM_SEARCH_DELAY_MS = 300L
private const val FORUM_SEARCH_MIN_CHARS = 2

/** How long a body may be before it folds, before anything is measured. */
private const val FORUM_FOLD_CHARS = 240

// ---------------------------------------------------------------------------
// ফোরাম — the home
// ---------------------------------------------------------------------------

@Composable
fun ForumHomeScreen(
    isSignedIn: Boolean,
    loadOverview: suspend (String) -> Result<ForumOverview>,
    search: suspend (String) -> Result<ForumSearchResult>,
    onCategoryClick: (String) -> Unit,
    onDiscussionClick: (String) -> Unit,
    onAuthorClick: (String) -> Unit,
    onNewDiscussion: () -> Unit,
    onSignInClick: () -> Unit,
    onNotificationsClick: () -> Unit,
    unreadCount: Int = 0
) {
    val tokens = LocalEditorialTokens.current
    var overview by remember { mutableStateOf<ForumOverview?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var reloadToken by remember { mutableIntStateOf(0) }
    var order by remember { mutableStateOf(ForumOverview.ORDER_RECENT) }

    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<ForumSearchResult?>(null) }
    var searching by remember { mutableStateOf(false) }

    LaunchedEffect(reloadToken, order) {
        loading = true
        error = null
        loadOverview(order)
            .onSuccess { overview = it }
            .onFailure { error = it.message ?: "ফোরাম লোড হয়নি।" }
        loading = false
    }

    // Nothing is asked of the database for a single character — two is where a
    // word has begun — and the pause after the last keystroke is what keeps
    // typing from firing one request per letter.
    LaunchedEffect(query) {
        val term = query.trim()
        if (term.length < FORUM_SEARCH_MIN_CHARS) {
            results = null
            searching = false
            return@LaunchedEffect
        }
        searching = true
        delay(FORUM_SEARCH_DELAY_MS)
        search(term)
            .onSuccess { results = it }
            .onFailure { results = ForumSearchResult(term, emptyList(), 0) }
        searching = false
    }

    ForumScaffold(
        title = "ফোরাম",
        subtitle = overview?.let {
            "আলোচনা ${toBengaliNumeral(it.totalDiscussions)} · উত্তর ${toBengaliNumeral(it.totalReplies)}"
        } ?: "নিংশিং চে পাঠকদের আলোচনা",
        onBackClick = null,
        onNotificationsClick = onNotificationsClick,
        unreadCount = unreadCount,
        onRefreshClick = { reloadToken += 1 }
    ) { padding ->
        when {
            loading && overview == null -> ForumLoading(Modifier.padding(padding))
            error != null && overview == null -> ErrorState(
                message = error.orEmpty(),
                onRetry = { reloadToken += 1 },
                modifier = Modifier
                    .padding(padding)
                    .testTag("forum_home_error")
            )
            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .testTag("forum_home_screen"),
                contentPadding = PaddingValues(bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
            ) {
                item {
                    ForumSearchField(
                        value = query,
                        onValueChange = { query = it },
                        searching = searching
                    )
                }

                val found = results
                if (found != null) {
                    item { ForumSectionTitle("অনুসন্ধানের ফল", found.total) }
                    if (found.discussions.isEmpty()) {
                        item {
                            EmptyState(
                                message = "«${found.query}» — এই শব্দে কোনো আলোচনা নেই।",
                                modifier = Modifier.testTag("forum_search_empty")
                            )
                        }
                    } else {
                        items(found.discussions, key = { "search-${it.id}" }) { discussion ->
                            ForumDiscussionCard(
                                discussion = discussion,
                                onClick = { onDiscussionClick(discussion.id) }
                            )
                        }
                    }
                    return@LazyColumn
                }

                val loaded = overview ?: return@LazyColumn

                // বিভাগসমূহ — inline and scrollable, the way the owner asked for
                // it: rooms are a row you push sideways through, not a page of
                // cards you scroll past to reach the discussions.
                item { ForumSectionTitle("বিভাগসমূহ", loaded.categories.size) }
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = EditorialSpace.gutter)
                            .testTag("forum_category_rail"),
                        horizontalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
                    ) {
                        loaded.categories.forEach { category ->
                            ForumRoomChip(
                                category = category,
                                onClick = { onCategoryClick(category.slug) }
                            )
                        }
                    }
                }

                item {
                    Column(Modifier.padding(top = EditorialSpace.sm)) {
                        ForumSectionTitle(
                            title = "সাম্প্রতিক আলোচনা",
                            count = loaded.latest.size,
                            modifier = Modifier.padding(horizontal = EditorialSpace.gutter)
                        )
                        ForumOrderChips(
                            selected = order,
                            officialCount = loaded.officialCount,
                            onSelect = { order = it }
                        )
                    }
                }

                if (loaded.latest.isEmpty()) {
                    item {
                        EmptyState(
                            message = when (order) {
                                ForumOverview.ORDER_OFFICIAL -> "এখনো প্রশাসকের কোনো আলোচনা নেই।"
                                ForumOverview.ORDER_POPULAR -> "এখনো কোনো আলোচনায় উত্তর আসেনি।"
                                else -> "এখনো কোনো আলোচনা হয়নি। প্রথম আলোচনাটি আপনিই শুরু করুন।"
                            },
                            modifier = Modifier.testTag("forum_latest_empty")
                        )
                    }
                } else {
                    items(loaded.latest, key = { "latest-${it.id}" }) { discussion ->
                        ForumDiscussionCard(
                            discussion = discussion,
                            onClick = { onDiscussionClick(discussion.id) },
                            onAuthorClick = { onAuthorClick(discussion.authorId) }
                        )
                    }
                }

                item { Spacer(Modifier.height(EditorialSpace.md)) }
            }
        }
    }

    if (isSignedIn) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(EditorialSpace.lg),
            contentAlignment = Alignment.BottomEnd
        ) {
            ExtendedFloatingActionButton(
                onClick = onNewDiscussion,
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("নতুন আলোচনা", fontFamily = Kalpurush, fontWeight = FontWeight.Bold) },
                containerColor = tokens.accent,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .testTag("forum_new_discussion")
            )
        }
    } else {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(EditorialSpace.lg),
            contentAlignment = Alignment.BottomEnd
        ) {
            ExtendedFloatingActionButton(
                onClick = onSignInClick,
                icon = { Icon(Icons.Default.Lock, contentDescription = null) },
                text = { Text("সাইন ইন করুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold) },
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .testTag("forum_sign_in")
            )
        }
    }
}

/** সাম্প্রতিক / জনপ্রিয় / অনুমোদিত — what the discussion list is ordered by. */
@Composable
private fun ForumOrderChips(
    selected: String,
    officialCount: Int,
    onSelect: (String) -> Unit
) {
    val tokens = LocalEditorialTokens.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.xxs)
            .testTag("forum_order_chips"),
        horizontalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
    ) {
        ForumOrderChip(
            label = "সাম্প্রতিক",
            icon = Icons.Default.Refresh,
            selected = selected == ForumOverview.ORDER_RECENT,
            onClick = { onSelect(ForumOverview.ORDER_RECENT) },
            modifier = Modifier.testTag("forum_order_recent")
        )
        ForumOrderChip(
            label = "জনপ্রিয়",
            icon = Icons.Default.TrendingUp,
            selected = selected == ForumOverview.ORDER_POPULAR,
            onClick = { onSelect(ForumOverview.ORDER_POPULAR) },
            modifier = Modifier.testTag("forum_order_popular")
        )
        ForumOrderChip(
            label = if (officialCount > 0) {
                "অনুমোদিত (${toBengaliNumeral(officialCount)})"
            } else {
                "অনুমোদিত"
            },
            icon = Icons.Default.Verified,
            selected = selected == ForumOverview.ORDER_OFFICIAL,
            onClick = { onSelect(ForumOverview.ORDER_OFFICIAL) },
            modifier = Modifier.testTag("forum_order_official")
        )
        Spacer(Modifier.width(EditorialSpace.xs))
        Text(
            text = "কোন আলোচনা দেখাবে",
            fontFamily = Kalpurush,
            fontSize = 11.sp,
            color = tokens.inkMuted,
            modifier = Modifier.align(Alignment.CenterVertically)
        )
    }
}

@Composable
private fun ForumOrderChip(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label, fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold) },
        leadingIcon = {
            Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp))
        },
        modifier = modifier
    )
}

/**
 * One room, inline. The count is the database's, and tapping it opens the room.
 */
@Composable
private fun ForumRoomChip(category: ForumCategory, onClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(EditorialShape.card),
        color = tokens.surfaceSunken,
        modifier = Modifier
            .width(184.dp)
            .clip(RoundedCornerShape(EditorialShape.card))
            .testTag("forum_category_${category.slug}")
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clickableRow(onClick)
                .padding(EditorialSpace.sm),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.xxs)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = category.title,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                if (category.isLocked) {
                    Icon(
                        imageVector = Icons.Default.Lock,
                        contentDescription = null,
                        tint = tokens.inkMuted,
                        modifier = Modifier.size(13.dp)
                    )
                }
            }
            if (category.description.isNotBlank()) {
                Text(
                    text = category.description,
                    fontFamily = Kalpurush,
                    fontSize = 11.5.sp,
                    color = tokens.inkMuted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
            ForumCountsRow(
                discussions = category.discussions,
                replies = category.replies,
                locked = false
            )
        }
    }
}

// ---------------------------------------------------------------------------
// One room
// ---------------------------------------------------------------------------

@Composable
fun ForumCategoryScreen(
    slug: String,
    isSignedIn: Boolean,
    loadCategory: suspend (String) -> Result<ForumCategoryPage>,
    onDiscussionClick: (String) -> Unit,
    onAuthorClick: (String) -> Unit,
    onNewDiscussion: (String) -> Unit,
    onSignInClick: () -> Unit,
    onBackClick: () -> Unit
) {
    val tokens = LocalEditorialTokens.current
    var page by remember { mutableStateOf<ForumCategoryPage?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var reloadToken by remember { mutableIntStateOf(0) }

    LaunchedEffect(slug, reloadToken) {
        loading = true
        error = null
        loadCategory(slug)
            .onSuccess { page = it }
            .onFailure { error = it.message ?: "আলোচনা লোড হয়নি।" }
        loading = false
    }

    ForumScaffold(
        title = page?.category?.title ?: "আলোচনা",
        subtitle = page?.category?.description?.takeIf { it.isNotBlank() }
            ?: "এই বিভাগের আলোচনাগুলো",
        onBackClick = onBackClick,
        onRefreshClick = { reloadToken += 1 }
    ) { padding ->
        when {
            loading && page == null -> ForumLoading(Modifier.padding(padding))
            error != null && page == null -> ErrorState(
                message = error.orEmpty(),
                onRetry = { reloadToken += 1 },
                modifier = Modifier
                    .padding(padding)
                    .testTag("forum_category_error")
            )
            page == null -> EmptyState(
                message = "এই বিভাগ পাওয়া যায়নি।",
                modifier = Modifier
                    .padding(padding)
                    .testTag("forum_category_missing")
            )
            page?.discussions?.isEmpty() == true -> EmptyState(
                message = "এই বিভাগে এখনো কোনো আলোচনা হয়নি।",
                modifier = Modifier
                    .padding(padding)
                    .testTag("forum_category_empty")
            )
            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .testTag("forum_category_screen"),
                contentPadding = PaddingValues(
                    top = EditorialSpace.sm,
                    bottom = 96.dp
                ),
                verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
            ) {
                item {
                    ForumSectionTitle("আলোচনাসমূহ", page?.total ?: 0)
                }
                items(page?.discussions.orEmpty(), key = { it.id }) { discussion ->
                    ForumDiscussionCard(
                        discussion = discussion,
                        onClick = { onDiscussionClick(discussion.id) },
                        onAuthorClick = { onAuthorClick(discussion.authorId) }
                    )
                }
            }
        }
    }

    val room = page?.category
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(EditorialSpace.lg),
        contentAlignment = Alignment.BottomEnd
    ) {
        ExtendedFloatingActionButton(
            onClick = {
                if (isSignedIn && room?.isLocked != true) onNewDiscussion(slug) else onSignInClick()
            },
            icon = {
                Icon(
                    imageVector = if (isSignedIn) Icons.Default.Add else Icons.Default.Lock,
                    contentDescription = null
                )
            },
            text = {
                Text(
                    text = when {
                        room?.isLocked == true -> "বিভাগ বন্ধ"
                        isSignedIn -> "নতুন আলোচনা"
                        else -> "সাইন ইন করুন"
                    },
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold
                )
            },
            containerColor = if (isSignedIn) tokens.accent else MaterialTheme.colorScheme.secondaryContainer,
            modifier = Modifier.testTag("forum_new_category")
        )
    }
}

// ---------------------------------------------------------------------------
// One discussion, its answers, and their answers
// ---------------------------------------------------------------------------

@Composable
fun ForumThreadScreen(
    discussionId: String,
    isSignedIn: Boolean,
    loadThread: suspend (String, Boolean) -> Result<ForumThread>,
    postReply: suspend (String, String, String) -> Result<ForumReply>,
    react: suspend (String, String) -> Result<ForumReactionState>,
    draftStore: ForumDraftStore,
    onSignInClick: () -> Unit,
    onAuthorClick: (String) -> Unit,
    onBackClick: () -> Unit
) {
    val tokens = LocalEditorialTokens.current
    val scope = rememberCoroutineScope()

    var thread by remember { mutableStateOf<ForumThread?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var reloadToken by remember { mutableIntStateOf(0) }

    var answerOrder by remember { mutableStateOf(ForumThread.ANSWER_RECENT) }
    var expandedBodies by remember { mutableStateOf(setOf<String>()) }
    var expandedThreads by remember { mutableStateOf(setOf<String>()) }

    var replyBody by remember { mutableStateOf("") }
    var replyTarget by remember { mutableStateOf("") }
    var posting by remember { mutableStateOf(false) }
    var replyError by remember { mutableStateOf<String?>(null) }

    var reactionTarget by remember { mutableStateOf<ForumReply?>(null) }

    LaunchedEffect(discussionId, reloadToken) {
        loading = true
        error = null
        // Counting the view only on the first load: a refresh is the same reader
        // looking again, not a second reader.
        loadThread(discussionId, reloadToken == 0)
            .onSuccess { thread = it }
            .onFailure { error = it.message ?: "আলোচনা খোলা যায়নি।" }
        loading = false
    }

    // The draft comes back when the screen does, and is saved as it changes.
    LaunchedEffect(discussionId) {
        val saved = draftStore.reply(discussionId)
        if (saved != null) {
            replyBody = saved.body
            replyTarget = saved.parentId
        }
    }
    LaunchedEffect(replyBody, replyTarget, discussionId) {
        if (!isSignedIn) return@LaunchedEffect
        delay(FORUM_SEARCH_DELAY_MS)
        draftStore.saveReply(discussionId, ForumDraftStore.ReplyDraft(replyBody, replyTarget))
    }

    val submit: () -> Unit = submit@{
        val body = replyBody.trim()
        if (!forumHasText(body)) return@submit
        scope.launch {
            posting = true
            replyError = null
            postReply(discussionId, body, replyTarget)
                .onSuccess { posted ->
                    // Folded in locally, then re-read with countView = false so
                    // the answer arrives with the counts the database kept.
                    thread = thread?.with(posted)
                    replyBody = ""
                    replyTarget = ""
                    draftStore.clearReply(discussionId)
                    thread = loadThread(discussionId, false).getOrNull() ?: thread
                }
                .onFailure { failure ->
                    replyError = failure.message ?: "উত্তর পাঠানো যায়নি।"
                }
            posting = false
        }
    }

    val reactTo: (ForumReply, String) -> Unit = { reply, kind ->
        reactionTarget = null
        scope.launch {
            react(reply.id, kind).onSuccess { state ->
                thread = thread?.with(
                    reply.copy(
                        likes = state.likes,
                        dislikes = state.dislikes,
                        agrees = state.agrees,
                        myReaction = state.mine
                    )
                )
            }
        }
    }

    ForumScaffold(
        title = thread?.discussion?.title ?: "আলোচনা",
        subtitle = thread?.discussion?.let {
            "${it.categoryTitle} · ${formatBengaliDate(it.createdAt)}"
        } ?: "লোড হচ্ছে…",
        onBackClick = onBackClick,
        // Refreshing re-reads without counting a second view — the reader is the
        // same reader looking again.
        onRefreshClick = { reloadToken += 1 }
    ) { padding ->
        when {
            loading && thread == null -> ForumLoading(Modifier.padding(padding))
            error != null && thread == null -> ErrorState(
                message = error.orEmpty(),
                onRetry = { reloadToken += 1 },
                modifier = Modifier
                    .padding(padding)
                    .testTag("forum_thread_error")
            )
            thread == null -> EmptyState(
                message = "আলোচনা পাওয়া যায়নি।",
                modifier = Modifier
                    .padding(padding)
                    .testTag("forum_thread_missing")
            )
            else -> {
                val loaded = thread ?: return@ForumScaffold
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .testTag("forum_thread_screen"),
                    contentPadding = PaddingValues(bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
                ) {
                    item {
                        ForumOpeningPost(
                            discussion = loaded.discussion,
                            expanded = expandedBodies.contains(loaded.discussion.id),
                            onToggleExpand = {
                                expandedBodies = expandedBodies.toggle(loaded.discussion.id)
                            },
                            onAuthorClick = { onAuthorClick(loaded.discussion.authorId) }
                        )
                    }

                    item {
                        Column {
                            ForumSectionTitle(
                                title = "উত্তরসমূহ",
                                count = loaded.answers.size,
                                modifier = Modifier.padding(horizontal = EditorialSpace.gutter)
                            )
                            ForumAnswerOrderChips(
                                selected = answerOrder,
                                onSelect = { answerOrder = it }
                            )
                        }
                    }

                    if (loaded.answers.isEmpty()) {
                        item {
                            EmptyState(
                                message = "এখনো কেউ উত্তর দেয়নি। আপনিই প্রথম উত্তর দিন।",
                                modifier = Modifier.testTag("forum_answers_empty")
                            )
                        }
                    }

                    items(loaded.answersIn(answerOrder), key = { it.id }) { answer ->
                        ForumAnswerCard(
                            answer = answer,
                            replies = loaded.repliesUnder(answer.id),
                            showAll = expandedThreads.contains(answer.id),
                            expanded = expandedBodies.contains(answer.id),
                            onToggleExpand = { expandedBodies = expandedBodies.toggle(answer.id) },
                            onToggleAll = { expandedThreads = expandedThreads.toggle(answer.id) },
                            onAuthorClick = onAuthorClick,
                            onReply = { replyTarget = answer.id; replyBody = "" },
                            onReact = { target -> reactionTarget = target }
                        )
                    }

                    item {
                        if (isSignedIn) {
                            ForumReplyComposer(
                                body = replyBody,
                                onBodyChange = { replyBody = it },
                                targetName = loaded.replies.firstOrNull { it.id == replyTarget }?.authorName,
                                onClearTarget = { replyTarget = "" },
                                posting = posting,
                                error = replyError,
                                onSubmit = submit
                            )
                        } else {
                            ForumSignInPrompt(onSignInClick)
                        }
                    }

                    if (!isSignedIn) {
                        item {
                            Surface(
                                shape = RoundedCornerShape(EditorialShape.card),
                                color = tokens.accentSoft,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = EditorialSpace.gutter)
                            ) {
                                Row(
                                    modifier = Modifier.padding(EditorialSpace.sm),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Lock,
                                        contentDescription = null,
                                        tint = tokens.accent,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(Modifier.width(EditorialSpace.xs))
                                    Text(
                                        text = "উত্তর দিতে ও প্রতিক্রিয়া জানাতে সাইন ইন করুন।",
                                        fontFamily = Kalpurush,
                                        fontSize = 12.sp,
                                        color = tokens.inkSoft
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // The long press: three reactions, one tap, and the same tap takes it back.
    reactionTarget?.let { target ->
        ForumReactionDialog(
            reply = target,
            onDismiss = { reactionTarget = null },
            onPick = { kind -> reactTo(target, kind) }
        )
    }
}

/** শীর্ষ / সাম্প্রতিক — the order the answers are read in. */
@Composable
private fun ForumAnswerOrderChips(selected: String, onSelect: (String) -> Unit) {
    val tokens = LocalEditorialTokens.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.xxs)
            .testTag("forum_answer_chips"),
        horizontalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
    ) {
        FilterChip(
            selected = selected == ForumThread.ANSWER_TOP,
            onClick = { onSelect(ForumThread.ANSWER_TOP) },
            label = { Text("শীর্ষ উত্তর", fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold) },
            leadingIcon = { Icon(Icons.Default.TrendingUp, contentDescription = null, modifier = Modifier.size(16.dp)) },
            modifier = Modifier.testTag("forum_answers_top")
        )
        FilterChip(
            selected = selected == ForumThread.ANSWER_RECENT,
            onClick = { onSelect(ForumThread.ANSWER_RECENT) },
            label = { Text("সাম্প্রতিক", fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold) },
            leadingIcon = { Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp)) },
            modifier = Modifier.testTag("forum_answers_recent")
        )
        Spacer(Modifier.width(EditorialSpace.xs))
        Text(
            text = "বেশি লাইক বা একমত থাকা উত্তর আগে",
            fontFamily = Kalpurush,
            fontSize = 11.sp,
            color = tokens.inkMuted,
            modifier = Modifier.align(Alignment.CenterVertically)
        )
    }
}

/**
 * One answer, with its own answers under it.
 *
 * The indentation is one step and only one: an answer to an answer is attached to
 * the answer it belongs to (the database folds it there as well), so nothing
 * marches off the right of the screen however long the argument runs.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ForumAnswerCard(
    answer: ForumReply,
    replies: List<ForumReply>,
    showAll: Boolean,
    expanded: Boolean,
    onToggleExpand: () -> Unit,
    onToggleAll: () -> Unit,
    onAuthorClick: (String) -> Unit,
    onReply: () -> Unit,
    onReact: (ForumReply) -> Unit
) {
    val tokens = LocalEditorialTokens.current
    val shown = if (showAll) replies else replies.takeLast(1)
    val hidden = (replies.size - shown.size).coerceAtLeast(0)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter),
        verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
    ) {
        Surface(
            shape = RoundedCornerShape(EditorialShape.card),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 1.dp,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(EditorialShape.card))
                .combinedClickable(
                    onLongClick = { onReact(answer) },
                    onClick = { }
                )
                .testTag("forum_answer_${answer.id}")
        ) {
            Column(
                modifier = Modifier.padding(EditorialSpace.sm),
                verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
            ) {
                ForumAuthorRow(
                    name = answer.authorName,
                    avatarUrl = answer.authorAvatarUrl,
                    date = answer.createdAt,
                    onClick = { onAuthorClick(answer.authorId) }
                )
                ForumBody(
                    html = answer.body,
                    expanded = expanded || !answer.isLong,
                    canExpand = answer.isLong,
                    onToggleExpand = onToggleExpand,
                    testTag = "forum_answer_body_${answer.id}"
                )
                ForumReactionRow(
                    reply = answer,
                    onReact = { onReact(answer) }
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(
                        onClick = onReply,
                        modifier = Modifier.testTag("forum_reply_to_${answer.id}")
                    ) {
                        Icon(
                            imageVector = Icons.Default.Reply,
                            contentDescription = null,
                            modifier = Modifier.size(15.dp)
                        )
                        Spacer(Modifier.width(EditorialSpace.xxs))
                        Text(
                            text = "উত্তর দিন",
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.5.sp
                        )
                    }
                    if (replies.isNotEmpty()) {
                        TextButton(
                            onClick = onToggleAll,
                            modifier = Modifier.testTag("forum_replies_toggle_${answer.id}")
                        ) {
                            Text(
                                text = if (showAll) {
                                    "উত্তরগুলো লুকান"
                                } else {
                                    "সব উত্তর দেখুন (${toBengaliNumeral(replies.size)})"
                                },
                                fontFamily = Kalpurush,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 12.5.sp,
                                color = tokens.accent
                            )
                        }
                    }
                }
            }
        }

        if (replies.isNotEmpty() && hidden > 0) {
            Text(
                text = "আরও ${toBengaliNumeral(hidden)} টি উত্তর — সব উত্তর দেখুন চাপুন",
                fontFamily = Kalpurush,
                fontSize = 11.5.sp,
                color = tokens.inkMuted,
                modifier = Modifier.padding(start = EditorialSpace.md)
            )
        }

        // One step in, never two: the answers to this answer live here.
        shown.forEach { nested ->
            ForumNestedReply(
                reply = nested,
                expanded = expanded,
                onToggleExpand = onToggleExpand,
                onAuthorClick = onAuthorClick,
                onReply = onReply,
                onReact = onReact
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ForumNestedReply(
    reply: ForumReply,
    expanded: Boolean,
    onToggleExpand: () -> Unit,
    onAuthorClick: (String) -> Unit,
    onReply: () -> Unit,
    onReact: (ForumReply) -> Unit
) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(EditorialShape.card),
        color = tokens.surfaceSunken,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = EditorialSpace.md)
            .clip(RoundedCornerShape(EditorialShape.card))
            .combinedClickable(onLongClick = { onReact(reply) }, onClick = { })
            .testTag("forum_reply_${reply.id}")
    ) {
        Column(
            modifier = Modifier.padding(EditorialSpace.sm),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.xxs)
        ) {
            ForumAuthorRow(
                name = reply.authorName,
                avatarUrl = reply.authorAvatarUrl,
                date = reply.createdAt,
                small = true,
                onClick = { onAuthorClick(reply.authorId) }
            )
            ForumBody(
                html = reply.body,
                expanded = expanded || !reply.isLong,
                canExpand = reply.isLong,
                onToggleExpand = onToggleExpand,
                testTag = "forum_reply_body_${reply.id}"
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                ForumReactionRow(reply = reply, onReact = { onReact(reply) })
                Spacer(Modifier.weight(1f))
                TextButton(
                    onClick = onReply,
                    modifier = Modifier.testTag("forum_reply_nested_to_${reply.id}")
                ) {
                    Text(
                        text = "উত্তর",
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 12.sp
                    )
                }
            }
        }
    }
}

/** The three reactions, as counts — and the reader's own, in the accent colour. */
@Composable
private fun ForumReactionRow(reply: ForumReply, onReact: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
    ) {
        ForumReactionCount(
            label = "লাইক",
            count = reply.likes,
            mine = reply.myReaction == ForumReply.REACTION_LIKE,
            onClick = onReact,
            modifier = Modifier.testTag("forum_likes_${reply.id}")
        )
        ForumReactionCount(
            label = "একমত",
            count = reply.agrees,
            mine = reply.myReaction == ForumReply.REACTION_AGREE,
            onClick = onReact,
            modifier = Modifier.testTag("forum_agrees_${reply.id}")
        )
        ForumReactionCount(
            label = "অপছন্দ",
            count = reply.dislikes,
            mine = reply.myReaction == ForumReply.REACTION_DISLIKE,
            onClick = onReact,
            modifier = Modifier.testTag("forum_dislikes_${reply.id}")
        )
        if (!reply.hasReactions) {
            Text(
                text = "চেপে ধরে প্রতিক্রিয়া দিন",
                fontFamily = Kalpurush,
                fontSize = 10.5.sp,
                color = tokens.inkMuted
            )
        }
    }
}

@Composable
private fun ForumReactionCount(
    label: String,
    count: Int,
    mine: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val tokens = LocalEditorialTokens.current
    val colour = if (mine) tokens.accent else tokens.inkMuted
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(EditorialShape.chip))
            .clickableRow(onClick)
            .padding(horizontal = EditorialSpace.xs, vertical = EditorialSpace.xxs),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            fontFamily = Kalpurush,
            fontSize = 11.5.sp,
            fontWeight = if (mine) FontWeight.Bold else FontWeight.Normal,
            color = colour
        )
        Spacer(Modifier.width(EditorialSpace.xxs))
        Text(
            text = toBengaliNumeral(count),
            fontFamily = Kalpurush,
            fontSize = 11.5.sp,
            fontWeight = FontWeight.Bold,
            color = colour
        )
    }
}

/** The long-press popup: লাইক, অপছন্দ, একমত. */
@Composable
private fun ForumReactionDialog(
    reply: ForumReply,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit
) {
    val tokens = LocalEditorialTokens.current
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(EditorialShape.sheet),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 3.dp,
            modifier = Modifier.testTag("forum_reaction_dialog")
        ) {
            Column(
                modifier = Modifier.padding(EditorialSpace.md),
                verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
            ) {
                Text(
                    text = reply.authorName,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp
                )
                Text(
                    text = "প্রতিক্রিয়া জানান",
                    fontFamily = Kalpurush,
                    fontSize = 12.sp,
                    color = tokens.inkMuted
                )
                Hairline()
                ReactionChoice(
                    label = "লাইক",
                    count = reply.likes,
                    selected = reply.myReaction == ForumReply.REACTION_LIKE,
                    onClick = { onPick(ForumReply.REACTION_LIKE) },
                    testTag = "forum_react_like"
                )
                ReactionChoice(
                    label = "অপছন্দ",
                    count = reply.dislikes,
                    selected = reply.myReaction == ForumReply.REACTION_DISLIKE,
                    onClick = { onPick(ForumReply.REACTION_DISLIKE) },
                    testTag = "forum_react_dislike"
                )
                ReactionChoice(
                    label = "একমত",
                    count = reply.agrees,
                    selected = reply.myReaction == ForumReply.REACTION_AGREE,
                    onClick = { onPick(ForumReply.REACTION_AGREE) },
                    testTag = "forum_react_agree"
                )
            }
        }
    }
}

@Composable
private fun ReactionChoice(
    label: String,
    count: Int,
    selected: Boolean,
    onClick: () -> Unit,
    testTag: String
) {
    val tokens = LocalEditorialTokens.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(EditorialShape.chip))
            .clickableRow(onClick)
            .padding(vertical = EditorialSpace.xs)
            .testTag(testTag),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            fontFamily = Kalpurush,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
            fontSize = 14.sp,
            color = if (selected) tokens.accent else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = if (selected) "আপনার প্রতিক্রিয়া" else toBengaliNumeral(count),
            fontFamily = Kalpurush,
            fontSize = 12.sp,
            color = if (selected) tokens.accent else tokens.inkMuted
        )
    }
}

// ---------------------------------------------------------------------------
// Opening a thread
// ---------------------------------------------------------------------------

@Composable
fun NewDiscussionScreen(
    preselectSlug: String,
    isSignedIn: Boolean,
    loadCategories: suspend (String) -> Result<List<ForumCategory>>,
    draftStore: ForumDraftStore,
    post: suspend (String, String, String, String, String) -> Result<ForumThread>,
    onPosted: (ForumThread) -> Unit,
    onSignInClick: () -> Unit,
    onBackClick: () -> Unit
) {
    val tokens = LocalEditorialTokens.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var rooms by remember { mutableStateOf<List<ForumCategory>?>(null) }
    var categoriesError by remember { mutableStateOf<String?>(null) }

    var categorySlug by remember { mutableStateOf(preselectSlug.trim()) }
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var coverUrl by remember { mutableStateOf("") }
    var coverDeleteUrl by remember { mutableStateOf("") }
    var coverUploading by remember { mutableStateOf(false) }
    var coverError by remember { mutableStateOf<String?>(null) }

    var posting by remember { mutableStateOf(false) }
    var postError by remember { mutableStateOf<String?>(null) }
    var restored by remember { mutableStateOf(false) }

    LaunchedEffect(preselectSlug) {
        loadCategories(preselectSlug)
            .onSuccess { rooms = it }
            .onFailure { categoriesError = it.message ?: "বিভাগ লোড হয়নি।" }
    }

    // What was left half-written comes back, cover and all.
    LaunchedEffect(Unit) {
        val saved = draftStore.composer()
        if (saved != null) {
            if (saved.categorySlug.isNotBlank()) categorySlug = saved.categorySlug
            title = saved.title
            body = saved.body
            coverUrl = saved.coverImageUrl
            coverDeleteUrl = saved.coverDeleteUrl
        }
        restored = true
    }

    // Saved as it is typed, so nothing is lost to a phone call or a wrong turn.
    LaunchedEffect(restored, categorySlug, title, body, coverUrl, coverDeleteUrl) {
        if (!restored) return@LaunchedEffect
        delay(FORUM_SEARCH_DELAY_MS)
        draftStore.saveComposer(
            ForumDraftStore.ComposerDraft(
                categorySlug = categorySlug,
                title = title,
                body = body,
                coverImageUrl = coverUrl,
                coverDeleteUrl = coverDeleteUrl
            )
        )
    }

    val coverPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            coverUploading = true
            coverError = null
            ImgBbUploader.uploadFromUri(context, uri, "forum_cover_${System.currentTimeMillis()}")
                .onSuccess { image ->
                    coverUrl = image.displayUrl.ifBlank { image.url }
                    coverDeleteUrl = image.deleteUrl
                }
                .onFailure { coverError = it.message ?: "ছবি আপলোড হয়নি।" }
            coverUploading = false
        }
    }

    val titleProblem = ForumText.titleProblem(title)
    // The editor answers with HTML; what is counted and refused is the text in
    // it, so `<p></p>` is an empty post and not eight characters of one.
    val bodyProblem = ForumText.bodyProblem(forumPlainText(body))
    val canPost = isSignedIn && categorySlug.isNotBlank() && titleProblem == null &&
        bodyProblem == null && !posting

    ForumScaffold(
        title = "নতুন আলোচনা",
        subtitle = rooms?.firstOrNull { it.slug == categorySlug }?.title
            ?: "বিভাগ বেছে নিন",
        onBackClick = onBackClick
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .testTag("forum_new_screen"),
            contentPadding = PaddingValues(
                start = EditorialSpace.gutter,
                end = EditorialSpace.gutter,
                top = EditorialSpace.sm,
                bottom = 96.dp
            ),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
        ) {
            item {
                ForumSectionTitle("বিভাগ", rooms?.size)
                when {
                    rooms == null && categoriesError == null -> ForumInlineLoading()
                    categoriesError != null -> Text(
                        text = categoriesError.orEmpty(),
                        fontFamily = Kalpurush,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.error
                    )
                    else -> Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .testTag("forum_room_picker"),
                        horizontalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
                    ) {
                        rooms.orEmpty().forEach { room ->
                            FilterChip(
                                selected = room.slug == categorySlug,
                                onClick = { categorySlug = room.slug },
                                label = {
                                    Text(room.title, fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold)
                                },
                                enabled = !room.isLocked,
                                modifier = Modifier.testTag("forum_new_category_${room.slug}")
                            )
                        }
                    }
                }
            }

            item {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("শিরোনাম", fontFamily = Kalpurush) },
                    isError = title.isNotBlank() && titleProblem != null,
                    supportingText = {
                        Text(
                            text = titleProblem ?: "${toBengaliNumeral(ForumText.units(title))} অক্ষর",
                            fontFamily = Kalpurush,
                            fontSize = 11.sp
                        )
                    },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("forum_new_title")
                )
            }

            item {
                ForumCoverPicker(
                    coverUrl = coverUrl,
                    uploading = coverUploading,
                    error = coverError,
                    onPick = { coverPicker.launch("image/*") },
                    onRemove = {
                        coverUrl = ""
                        coverDeleteUrl = ""
                    }
                )
            }

            item {
                Text(
                    text = "আলোচনার কথা *",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp
                )
                Spacer(Modifier.height(EditorialSpace.xs))
                // The article composer's editor in its compact shape: the same
                // editing surface, without the selection popup the owner did not
                // want over a forum post.
                HtmlContentEditor(
                    value = body,
                    onValueChange = { body = it },
                    editorHeight = 220,
                    selectionPopup = false,
                    compact = true,
                    placeholder = "আলোচনার কথা লিখুন…",
                    testTag = "forum_new_body"
                )
                if (bodyProblem != null && forumHasText(body)) {
                    Text(
                        text = bodyProblem,
                        fontFamily = Kalpurush,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(top = EditorialSpace.xxs)
                    )
                }
            }

            postError?.let { message ->
                item {
                    Text(
                        text = message,
                        fontFamily = Kalpurush,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag("forum_new_error")
                    )
                }
            }

            item {
                Button(
                    onClick = {
                        scope.launch {
                            posting = true
                            postError = null
                            post(categorySlug, title, body, coverUrl, coverDeleteUrl)
                                .onSuccess { created ->
                                    // Cleared only here: the draft has been posted,
                                    // and there is nothing to come back to.
                                    draftStore.clearComposer()
                                    onPosted(created)
                                }
                                .onFailure { failure ->
                                    postError = when (failure) {
                                        is PortalError.SignedOut -> PortalError.SignedOut.SESSION_EXPIRED
                                        else -> failure.message ?: "আলোচনা খোলা যায়নি।"
                                    }
                                }
                            posting = false
                        }
                    },
                    enabled = canPost,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = tokens.accent,
                        contentColor = MaterialTheme.colorScheme.onPrimary
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("forum_new_submit")
                ) {
                    if (posting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    } else {
                        Icon(Icons.Default.Send, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(EditorialSpace.xs))
                        Text(
                            text = "আলোচনা খুলুন",
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }

            if (!isSignedIn) {
                item { ForumSignInPrompt(onSignInClick) }
            }

            item {
                Text(
                    text = "লেখা জমা না হওয়া পর্যন্ত এখানে সংরক্ষিত থাকে — ফিরে এলে যা লিখেছিলেন তাই পাবেন।",
                    fontFamily = Kalpurush,
                    fontSize = 11.sp,
                    color = tokens.inkMuted
                )
            }
        }
    }
}

/** The optional ImgBB cover: pick, see, or take it back. */
@Composable
private fun ForumCoverPicker(
    coverUrl: String,
    uploading: Boolean,
    error: String?,
    onPick: () -> Unit,
    onRemove: () -> Unit
) {
    val tokens = LocalEditorialTokens.current
    Column(verticalArrangement = Arrangement.spacedBy(EditorialSpace.xxs)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "কভার ছবি (ঐচ্ছিক)",
                fontFamily = Kalpurush,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                modifier = Modifier.weight(1f)
            )
            TextButton(onClick = onPick, enabled = !uploading, modifier = Modifier.testTag("forum_cover_pick")) {
                Icon(Icons.Default.Image, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(EditorialSpace.xxs))
                Text(
                    text = if (coverUrl.isBlank()) "ছবি যোগ করুন" else "ছবি বদলান",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 12.5.sp
                )
            }
            if (coverUrl.isNotBlank()) {
                TextButton(onClick = onRemove, modifier = Modifier.testTag("forum_cover_remove")) {
                    Text("সরান", fontFamily = Kalpurush, fontSize = 12.5.sp, color = tokens.inkMuted)
                }
            }
        }
        when {
            uploading -> ForumInlineLoading()
            coverUrl.isNotBlank() -> Surface(
                shape = RoundedCornerShape(EditorialShape.card),
                color = tokens.surfaceSunken,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(160.dp)
            ) {
                PortalAsyncImage(
                    url = coverUrl,
                    contentDescription = "কভার ছবি",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .fillMaxSize()
                        .testTag("forum_cover_preview")
                )
            }
            else -> Text(
                text = error ?: "ছবি ImgBB-তে আপলোড হবে; না দিলেও আলোচনা খোলা যাবে।",
                fontFamily = Kalpurush,
                fontSize = 11.sp,
                color = if (error != null) MaterialTheme.colorScheme.error else tokens.inkMuted
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Pieces the four screens share
// ---------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ForumScaffold(
    title: String,
    subtitle: String,
    onBackClick: (() -> Unit)?,
    onNotificationsClick: (() -> Unit)? = null,
    unreadCount: Int = 0,
    onRefreshClick: (() -> Unit)? = null,
    content: @Composable (PaddingValues) -> Unit
) {
    val tokens = LocalEditorialTokens.current
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = title,
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            fontSize = 17.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = subtitle,
                            fontFamily = Kalpurush,
                            fontSize = 11.5.sp,
                            color = tokens.inkMuted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                },
                navigationIcon = {
                    if (onBackClick != null) {
                        IconButton(
                            onClick = onBackClick,
                            modifier = Modifier.testTag("forum_back")
                        ) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "পেছনে")
                        }
                    }
                },
                // The bell, not a magnifier: the forum is searched with the field
                // on the page, and the one thing the top bar is for here is the
                // reader's notices.
                actions = {
                    // A forum is read again and again; the refresh is one tap
                    // rather than a screen the reader has to leave and re-enter.
                    if (onRefreshClick != null) {
                        IconButton(
                            onClick = onRefreshClick,
                            modifier = Modifier.testTag("forum_refresh")
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = "রিফ্রেশ"
                            )
                        }
                    }
                    if (onNotificationsClick != null) {
                        Box {
                            IconButton(
                                onClick = onNotificationsClick,
                                modifier = Modifier.testTag("forum_notifications")
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Notifications,
                                    contentDescription = "বিজ্ঞপ্তি"
                                )
                            }
                            if (unreadCount > 0) {
                                ForumUnreadBadge(
                                    count = unreadCount,
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .padding(top = 6.dp, end = 4.dp)
                                )
                            }
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        content = content
    )
}

/** The unread dot on the bell. */
@Composable
private fun ForumUnreadBadge(count: Int, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.error)
            .padding(horizontal = 5.dp, vertical = 1.dp)
    ) {
        Text(
            text = toBengaliNumeral(count),
            fontFamily = Kalpurush,
            fontSize = 9.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onError
        )
    }
}

@Composable
private fun ForumSectionTitle(title: String, count: Int? = null, modifier: Modifier = Modifier) {
    val tokens = LocalEditorialTokens.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.xs),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            fontFamily = Kalpurush,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            modifier = Modifier.weight(1f)
        )
        if (count != null) {
            Text(
                text = toBengaliNumeral(count),
                fontFamily = Kalpurush,
                fontSize = 12.sp,
                color = tokens.inkMuted
            )
        }
    }
}

@Composable
private fun ForumSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    searching: Boolean
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text("আলোচনা খুঁজুন", fontFamily = Kalpurush) },
        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
        trailingIcon = {
            when {
                searching -> CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.dp
                )
                value.isNotBlank() -> IconButton(onClick = { onValueChange("") }) {
                    Icon(Icons.Default.Clear, contentDescription = "মুছুন")
                }
            }
        },
        singleLine = true,
        textStyle = TextStyle(fontFamily = Kalpurush, fontSize = 14.sp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .testTag("forum_search")
    )
}

@Composable
private fun ForumDiscussionCard(
    discussion: ForumDiscussion,
    onClick: () -> Unit,
    onAuthorClick: (() -> Unit)? = null
) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(EditorialShape.card),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .clip(RoundedCornerShape(EditorialShape.card))
            .testTag("forum_discussion_${discussion.id}")
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clickableRow(onClick)
                .padding(EditorialSpace.sm),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
        ) {
            if (discussion.hasCover) {
                Surface(
                    shape = RoundedCornerShape(EditorialShape.thumb),
                    color = tokens.surfaceSunken,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(132.dp)
                ) {
                    PortalAsyncImage(
                        url = discussion.coverImageUrl,
                        contentDescription = discussion.title,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = discussion.categoryTitle,
                    fontFamily = Kalpurush,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = tokens.accent,
                    modifier = Modifier.weight(1f)
                )
                if (discussion.isOfficial) {
                    OfficialBadge()
                }
            }

            Text(
                text = discussion.title,
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )

            if (discussion.excerpt.isNotBlank()) {
                Text(
                    text = discussion.excerpt,
                    fontFamily = Kalpurush,
                    fontSize = 12.5.sp,
                    color = tokens.inkMuted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Hairline()

            Row(verticalAlignment = Alignment.CenterVertically) {
                ForumAvatar(
                    url = discussion.authorAvatarUrl,
                    name = discussion.authorName,
                    size = 24
                )
                Spacer(Modifier.width(EditorialSpace.xs))
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clickableRowOrNull(onAuthorClick)
                ) {
                    Text(
                        text = discussion.authorName,
                        fontFamily = Kalpurush,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = formatBengaliDate(discussion.lastActivityAt),
                        fontFamily = Kalpurush,
                        fontSize = 10.5.sp,
                        color = tokens.inkMuted
                    )
                }
                ForumCounters(
                    discussions = discussion.views,
                    replies = discussion.replies,
                    views = true,
                    answered = discussion.hasReplies
                )
            }
        }
    }
}

/** অনুমোদিত — the admin opened this one. */
@Composable
private fun OfficialBadge() {
    val tokens = LocalEditorialTokens.current
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(EditorialShape.chip))
            .background(tokens.accentSoft)
            .padding(horizontal = EditorialSpace.xs, vertical = 1.dp)
            .testTag("forum_official_badge"),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.Default.Verified,
            contentDescription = null,
            tint = tokens.accent,
            modifier = Modifier.size(12.dp)
        )
        Spacer(Modifier.width(3.dp))
        Text(
            text = "অনুমোদিত",
            fontFamily = Kalpurush,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            color = tokens.accent
        )
    }
}

private fun Modifier.clickableRow(onClick: () -> Unit): Modifier = clickable(onClick = onClick)

private fun Modifier.clickableRowOrNull(onClick: (() -> Unit)?): Modifier =
    if (onClick == null) this else clickable(onClick = onClick)

/** What the reader typed, without the editor's markup. */
private fun forumPlainText(html: String): String =
    html.replace(Regex("<[^>]*>"), " ").replace("&nbsp;", " ").trim()

/** Whether the editor has anything in it, empty markup aside. */
private fun forumHasText(html: String): Boolean = forumPlainText(html).isNotBlank()

/** The room card's counters, for a room seen on its own. */
@Composable
private fun ForumCountsRow(discussions: Number, replies: Number, locked: Boolean) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
    ) {
        ForumCounter(Icons.Default.Forum, discussions)
        ForumCounter(
            icon = Icons.Default.ChatBubbleOutline,
            value = replies,
            tint = if (replies.toInt() > 0) LocalEditorialTokens.current.accent else LocalEditorialTokens.current.inkMuted
        )
        if (locked) {
            ForumCounter(Icons.Default.Lock, 0)
        }
    }
}

@Composable
private fun ForumCounters(
    discussions: Number = 0,
    replies: Number = 0,
    views: Boolean = false,
    answered: Boolean = false
) {
    val tokens = LocalEditorialTokens.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        if (views) {
            ForumCounter(Icons.Default.Visibility, discussions)
        } else {
            ForumCounter(Icons.Default.Forum, discussions)
        }
        // A thread nobody has answered yet reads differently from one that has.
        ForumCounter(
            icon = Icons.Default.ChatBubbleOutline,
            value = replies,
            tint = if (answered) tokens.accent else tokens.inkMuted
        )
    }
}

@Composable
private fun ForumCounter(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    value: Number,
    tint: Color = LocalEditorialTokens.current.inkMuted
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(13.dp)
        )
        Spacer(Modifier.width(3.dp))
        Text(
            text = toBengaliNumeral(value),
            fontFamily = Kalpurush,
            fontSize = 11.5.sp,
            color = tint
        )
    }
}

@Composable
private fun ForumAvatar(url: String, name: String, size: Int) {
    val tokens = LocalEditorialTokens.current
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(tokens.surfaceSunken),
        contentAlignment = Alignment.Center
    ) {
        if (url.isNotBlank()) {
            PortalAsyncImage(
                url = url,
                contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Text(
                text = name.trim().take(1).ifBlank { "ন" },
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = (size / 2).sp,
                color = tokens.accent
            )
        }
    }
}

/** Picture, name, date — the whole block opens the reader's public page. */
@Composable
private fun ForumAuthorRow(
    name: String,
    avatarUrl: String,
    date: String,
    onClick: () -> Unit,
    small: Boolean = false
) {
    val tokens = LocalEditorialTokens.current
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(EditorialShape.thumb))
            .clickableRow(onClick)
            .testTag("forum_author_$name"),
        verticalAlignment = Alignment.CenterVertically
    ) {
        ForumAvatar(url = avatarUrl, name = name, size = if (small) 22 else 28)
        Spacer(Modifier.width(EditorialSpace.xs))
        Column {
            Text(
                text = name,
                fontFamily = Kalpurush,
                fontWeight = FontWeight.SemiBold,
                fontSize = if (small) 12.sp else 13.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = formatBengaliDate(date),
                fontFamily = Kalpurush,
                fontSize = 10.5.sp,
                color = tokens.inkMuted
            )
        }
    }
}

/**
 * A body, folded until asked for.
 *
 * Folded it is drawn as an annotated string — cheap, and never more than a screen
 * tall. Opened it goes through the app's article renderer, which is what knows
 * how to draw the images the editor can insert.
 */
@Composable
private fun ForumBody(
    html: String,
    expanded: Boolean,
    canExpand: Boolean,
    onToggleExpand: () -> Unit,
    testTag: String
) {
    val tokens = LocalEditorialTokens.current
    Column(verticalArrangement = Arrangement.spacedBy(EditorialSpace.xxs)) {
        if (expanded) {
            RichHtmlArticleBody(
                html = html,
                fontSizeSp = 14f,
                lineSpacingMultiplier = 1.4f,
                onOpenLink = { },
                modifier = Modifier.testTag(testTag)
            )
        } else {
            com.ningshingche.app.ui.components.HtmlFormattedText(
                html = html,
                fontSize = 14.sp,
                maxLines = 6,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.testTag(testTag)
            )
        }
        if (canExpand) {
            // Small, plain, no border and no fill — the owner asked for exactly
            // that, and a boxed button would shout over the text it is hiding.
            Text(
                text = if (expanded) "কম দেখান" else "আরও দেখুন",
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp,
                color = tokens.accent,
                modifier = Modifier
                    .clip(RoundedCornerShape(EditorialShape.thumb))
                    .clickableRow(onToggleExpand)
                    .padding(vertical = EditorialSpace.xxs)
                    .testTag("${testTag}_more")
            )
        }
    }
}

/** The opening post, with its cover and its numbers. */
@Composable
private fun ForumOpeningPost(
    discussion: ForumDiscussion,
    expanded: Boolean,
    onToggleExpand: () -> Unit,
    onAuthorClick: () -> Unit
) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(EditorialShape.card),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .testTag("forum_opening_post")
    ) {
        Column(
            modifier = Modifier.padding(EditorialSpace.sm),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
        ) {
            if (discussion.hasCover) {
                Surface(
                    shape = RoundedCornerShape(EditorialShape.thumb),
                    color = tokens.surfaceSunken,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(172.dp)
                ) {
                    PortalAsyncImage(
                        url = discussion.coverImageUrl,
                        contentDescription = discussion.title,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = discussion.categoryTitle,
                    fontFamily = Kalpurush,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = tokens.accent,
                    modifier = Modifier.weight(1f)
                )
                if (discussion.isOfficial) OfficialBadge()
            }

            Text(
                text = discussion.title,
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp
            )

            ForumAuthorRow(
                name = discussion.authorName,
                avatarUrl = discussion.authorAvatarUrl,
                date = discussion.createdAt,
                onClick = onAuthorClick
            )

            Hairline()

            ForumBody(
                html = discussion.body,
                expanded = expanded || discussion.body.length <= FORUM_FOLD_CHARS,
                canExpand = discussion.body.length > FORUM_FOLD_CHARS ||
                    discussion.body.contains("<img", ignoreCase = true),
                onToggleExpand = onToggleExpand,
                testTag = "forum_opening_body"
            )

            ForumCounters(
                discussions = discussion.views,
                replies = discussion.replies,
                views = true,
                answered = discussion.hasReplies
            )
        }
    }
}

/** The box a reply is written in: the editor, a target line, and send. */
@Composable
private fun ForumReplyComposer(
    body: String,
    onBodyChange: (String) -> Unit,
    targetName: String?,
    onClearTarget: () -> Unit,
    posting: Boolean,
    error: String?,
    onSubmit: () -> Unit
) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(EditorialShape.card),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .testTag("forum_reply_box")
    ) {
        Column(
            modifier = Modifier.padding(EditorialSpace.sm),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = if (targetName != null) "$targetName কে উত্তর" else "আপনার উত্তর",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    modifier = Modifier.weight(1f)
                )
                if (targetName != null) {
                    TextButton(onClick = onClearTarget, modifier = Modifier.testTag("forum_reply_target_clear")) {
                        Text("বাতিল", fontFamily = Kalpurush, fontSize = 12.sp, color = tokens.inkMuted)
                    }
                }
            }

            HtmlContentEditor(
                value = body,
                onValueChange = onBodyChange,
                editorHeight = 200,
                selectionPopup = false,
                compact = true,
                placeholder = "উত্তর লিখুন…",
                testTag = "forum_reply_field"
            )

            error?.let { message ->
                Text(
                    text = message,
                    fontFamily = Kalpurush,
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("forum_reply_error")
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "খসড়া স্বয়ংক্রিয়ভাবে সংরক্ষিত",
                    fontFamily = Kalpurush,
                    fontSize = 10.5.sp,
                    color = tokens.inkMuted,
                    modifier = Modifier.weight(1f)
                )
                Button(
                    onClick = onSubmit,
                    enabled = !posting && ForumText.replyProblem(forumPlainText(body)) == null,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = tokens.accent,
                        contentColor = MaterialTheme.colorScheme.onPrimary
                    ),
                    modifier = Modifier.testTag("forum_reply_submit")
                ) {
                    if (posting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    } else {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.Send,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(Modifier.width(EditorialSpace.xxs))
                        Text(
                            text = "পাঠান",
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ForumSignInPrompt(onSignInClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(EditorialShape.card),
        color = tokens.surfaceSunken,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .testTag("forum_reply_sign_in")
    ) {
        Column(
            modifier = Modifier.padding(EditorialSpace.md),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
        ) {
            Text(
                text = "উত্তর দিতে সাইন ইন করুন",
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp
            )
            Text(
                text = "পড়া যায় সবার — লেখা যায় নিজের নামে।",
                fontFamily = Kalpurush,
                fontSize = 12.sp,
                color = tokens.inkSoft
            )
            Button(
                onClick = onSignInClick,
                colors = ButtonDefaults.buttonColors(
                    containerColor = tokens.accent,
                    contentColor = MaterialTheme.colorScheme.onPrimary
                )
            ) {
                Text("সাইন ইন করুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun ForumLoading(modifier: Modifier = Modifier) {
    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun ForumInlineLoading() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(EditorialSpace.xs))
        Text("লোড হচ্ছে…", fontFamily = Kalpurush, fontSize = 12.sp)
    }
}

private fun Set<String>.toggle(id: String): Set<String> =
    if (contains(id)) this - id else this + id

/**
 * The forum on a reader's own dashboard and public page: three counts and the
 * two lists behind them. Shared because both places answer the same question,
 * and a second copy would eventually answer it differently.
 */
@Composable
fun ForumActivityBlock(
    activity: ForumActivity,
    onOpenDiscussion: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val tokens = LocalEditorialTokens.current
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
        ) {
            ForumActivityCount("আলোচনা", activity.discussions, Modifier.weight(1f))
            ForumActivityCount("উত্তর", activity.replies, Modifier.weight(1f))
            ForumActivityCount("প্রতিক্রিয়া", activity.reactions, Modifier.weight(1f))
        }
        if (!activity.hasAnything) {
            Text(
                text = "এখনো ফোরামে কিছু লেখা হয়নি।",
                fontFamily = Kalpurush,
                fontSize = 12.sp,
                color = tokens.inkMuted
            )
        }
        activity.threads.forEach { thread ->
            Surface(
                shape = RoundedCornerShape(EditorialShape.card),
                color = tokens.surfaceSunken,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(EditorialShape.card))
                    .clickableRow { onOpenDiscussion(thread.id) }
                    .testTag("forum_activity_thread_${thread.id}")
            ) {
                Column(
                    modifier = Modifier.padding(EditorialSpace.sm),
                    verticalArrangement = Arrangement.spacedBy(EditorialSpace.xxs)
                ) {
                    Text(
                        text = thread.title,
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.5.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "${thread.categoryTitle} · ${formatBengaliDate(thread.createdAt)}",
                        fontFamily = Kalpurush,
                        fontSize = 10.5.sp,
                        color = tokens.inkMuted
                    )
                    ForumCounters(
                        discussions = thread.views,
                        replies = thread.replies,
                        views = true,
                        answered = thread.replies > 0
                    )
                }
            }
        }
        activity.answers.take(5).forEach { answer ->
            Surface(
                shape = RoundedCornerShape(EditorialShape.card),
                color = tokens.surfaceSunken,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(EditorialShape.card))
                    .clickableRow { onOpenDiscussion(answer.discussionId) }
                    .testTag("forum_activity_reply_${answer.id}")
            ) {
                Column(
                    modifier = Modifier.padding(EditorialSpace.sm),
                    verticalArrangement = Arrangement.spacedBy(EditorialSpace.xxs)
                ) {
                    Text(
                        text = answer.discussionTitle,
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = answer.excerpt,
                        fontFamily = Kalpurush,
                        fontSize = 12.sp,
                        color = tokens.inkMuted,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "লাইক ${toBengaliNumeral(answer.likes)} · " +
                            "একমত ${toBengaliNumeral(answer.agrees)} · " +
                            "অপছন্দ ${toBengaliNumeral(answer.dislikes)} · " +
                            formatBengaliDate(answer.createdAt),
                        fontFamily = Kalpurush,
                        fontSize = 10.5.sp,
                        color = tokens.inkMuted
                    )
                }
            }
        }
    }
}

/**
 * The reader's own forum work, as a dashboard card.
 *
 * [activity] is null until the call answers, and a failure is only ever "we do
 * not know" — the card says so and offers the forum itself, rather than showing
 * a zero that would read as "you have written nothing".
 */
@Composable
fun ForumCard(
    activity: ForumActivity?,
    onOpenForum: () -> Unit,
    onOpenThread: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(EditorialShape.card),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(EditorialSpace.sm),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Forum,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.width(EditorialSpace.xs))
                Text(
                    text = "ফোরামে আপনার কাজ",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    modifier = Modifier.weight(1f)
                )
                TextButton(onClick = onOpenForum, modifier = Modifier.testTag("dashboard_forum_open")) {
                    Text(
                        text = "ফোরামে যান",
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 12.5.sp,
                        color = tokens.accent
                    )
                }
            }
            Hairline()
            if (activity == null) {
                Text(
                    text = "ফোরামের হিসাব লোড হচ্ছে…",
                    fontFamily = Kalpurush,
                    fontSize = 12.sp,
                    color = tokens.inkMuted
                )
            } else {
                ForumActivityBlock(
                    activity = activity,
                    onOpenDiscussion = onOpenThread
                )
            }
        }
    }
}

@Composable
private fun ForumActivityCount(label: String, value: Int, modifier: Modifier = Modifier) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(EditorialShape.card),
        color = tokens.surfaceSunken,
        modifier = modifier
    ) {
        Column(
            modifier = Modifier.padding(vertical = EditorialSpace.xs),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = toBengaliNumeral(value),
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                color = tokens.accent
            )
            Text(
                text = label,
                fontFamily = Kalpurush,
                fontSize = 10.5.sp,
                color = tokens.inkMuted
            )
        }
    }
}
