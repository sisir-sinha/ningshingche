package com.ningshingche.app.ui.screens

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Reply
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.ningshingche.app.data.local.ForumDraftStore
import com.ningshingche.app.data.portal.ForumActivity
import com.ningshingche.app.data.portal.ForumAttachment
import com.ningshingche.app.data.portal.forumBodyAttachments
import com.ningshingche.app.data.portal.forumBodyDocs
import com.ningshingche.app.data.portal.forumBodyImages
import com.ningshingche.app.data.portal.forumBodyMarkup
import com.ningshingche.app.data.portal.forumBodyText
import com.ningshingche.app.data.portal.forumHasText
import com.ningshingche.app.data.portal.forumPlainText
import com.ningshingche.app.data.portal.forumWithAttachments
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
import com.ningshingche.app.data.remote.ForumAttachmentUploader
import com.ningshingche.app.data.remote.ImgBbUploader
import com.ningshingche.app.ui.components.AttachmentViewer
import com.ningshingche.app.ui.components.HtmlContentEditor
import com.ningshingche.app.ui.components.HtmlEditorController
import com.ningshingche.app.ui.components.PortalAsyncImage
import com.ningshingche.app.ui.editorial.EditorialShape
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.editorial.EmptyState
import com.ningshingche.app.ui.editorial.ErrorState
import com.ningshingche.app.ui.editorial.Hairline
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.editorial.formatBengaliDate
import com.ningshingche.app.ui.editorial.formatBengaliDateTime
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
 * The shape of the third pass, after the owner read the second one:
 *
 *   * the top of every screen has room to breathe, and the forum's own bar
 *     carries a back arrow — no bell: notices belong to the dashboard, and the
 *     bar was being asked to do too much;
 *   * বিভাগসমূহ is one line — `বিভাগসমূহ (৫)` and a chevron — that opens
 *     sideways-scrolling room cards, zipped on the first load and animated both
 *     ways. A room is wider than it was, and its two lines of text sit close
 *     together;
 *   * সাম্প্রতিক আলোচনা and উত্তরসমূহ are filters and nothing else: no line of
 *     explanation under them, and the number a filter stands for is on the chip;
 *   * a discussion's title is bigger, and an author is a picture with a name and
 *     a date beside it — never a name stacked over an empty gap;
 *   * reactions are icons. On a card they are icons with their counts; on a long
 *     press they are three icons in a row and nothing else — no words, no
 *     numbers, no "chепе ধরে প্রতিক্রিয়া দিন";
 *   * an answer and its answers are one card: the replies are indented well
 *     inside it, behind a line that runs down their left, so the whole argument
 *     reads as the answer it belongs to;
 *   * the reply box is not always there. The thread carries one button —
 *     উত্তর যোগ করুন, bottom right — and the box expands from the bottom of the
 *     screen when it is asked for and shrinks away when it is done with;
 *   * files are attached, never typed: a paperclip on the row under the box takes
 *     up to five pictures and PDFs, each drawn beside it with a cross to take it
 *     back, and all of them are appended to the post on its way out;
 *   * a picture in a post is a small preview and a PDF is its icon and its name —
 *     never a URL, and never the boxed "obj" the text renderer keeps for an image
 *     it cannot draw. A tap opens either one large, with a download beside it.
 *
 * Nothing here holds content of its own: rooms are rows, threads are rows, and a
 * number on a card is a number the database sent.
 */

private const val FORUM_SEARCH_DELAY_MS = 300L
private const val FORUM_SEARCH_MIN_CHARS = 2

/** How long a body may be before it folds, before anything is measured. */
private const val FORUM_FOLD_CHARS = 240

/** A room card, wider than the first pass: two lines of Bengali need the room. */
private const val FORUM_ROOM_WIDTH = 232

/** Room above and below a section, so nothing starts against the app bar. */
private val FORUM_TOP_SPACE = EditorialSpace.md

/** How far a reply is indented inside its answer. */
private val FORUM_REPLY_INDENT = 22.dp

/** The reply box's first height, and the ceiling it grows to. */
private const val FORUM_COMPOSER_HEIGHT = 96
private const val FORUM_COMPOSER_MAX = 240

/** How long the box takes to arrive, before the keyboard is asked for. */
private const val FORUM_COMPOSER_APPEAR_MS = 260L

/** What a file attached to a draft is drawn as, on the row under the box. */
private val FORUM_ATTACHMENT_THUMB = 44.dp

/** What a file attached to a *post* is drawn as, under its words. */
private val FORUM_ATTACHMENT_PREVIEW = 96.dp

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
    onBackClick: () -> Unit
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
        onBackClick = onBackClick,
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
                contentPadding = PaddingValues(
                    top = FORUM_TOP_SPACE,
                    bottom = 96.dp
                ),
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
                                onClick = { onDiscussionClick(discussion.id) },
                                onAuthorClick = { onAuthorClick(discussion.authorId) }
                            )
                        }
                    }
                    return@LazyColumn
                }

                val loaded = overview ?: return@LazyColumn

                // বিভাগসমূহ — one line, and the rooms behind a chevron. The owner
                // asked for it zipped on the first load: a reader arriving at the
                // forum wants the discussions, and the rooms are one tap away.
                item {
                    ForumRoomsSection(
                        categories = loaded.categories,
                        onCategoryClick = { slug -> onCategoryClick(slug) }
                    )
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

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(EditorialSpace.lg),
        contentAlignment = Alignment.BottomEnd
    ) {
        if (isSignedIn) {
            ExtendedFloatingActionButton(
                onClick = onNewDiscussion,
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("নতুন আলোচনা", fontFamily = Kalpurush, fontWeight = FontWeight.Bold) },
                containerColor = tokens.accent,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.testTag("forum_new_discussion")
            )
        } else {
            ExtendedFloatingActionButton(
                onClick = onSignInClick,
                icon = { Icon(Icons.Default.Lock, contentDescription = null) },
                text = { Text("সাইন ইন করুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold) },
                modifier = Modifier.testTag("forum_sign_in")
            )
        }
    }
}

/**
 * বিভাগসমূহ: a heading with the count, a chevron, and the rooms.
 *
 * `AnimatedVisibility` rather than a conditional: the owner asked for the
 * transition, and a section that appears by teleporting reads as a glitch on a
 * phone. Zipped to start — [expanded] begins false — and the chevron turns as it
 * opens, so the control says which way the section is going before it goes.
 */
@Composable
private fun ForumRoomsSection(
    categories: List<ForumCategory>,
    onCategoryClick: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    val arrow by animateFloatAsState(
        targetValue = if (expanded) 180f else 0f,
        animationSpec = tween(durationMillis = 220),
        label = "forum-rooms-arrow"
    )

    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded }
                .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.xs)
                .testTag("forum_category_toggle"),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "বিভাগসমূহ (${toBengaliNumeral(categories.size)})",
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                modifier = Modifier.weight(1f)
            )
            Icon(
                imageVector = Icons.Default.KeyboardArrowDown,
                contentDescription = if (expanded) "বিভাগ গুটিয়ে নিন" else "বিভাগ দেখুন",
                tint = LocalEditorialTokens.current.inkMuted,
                modifier = Modifier
                    .size(22.dp)
                    .graphicsLayer(rotationZ = arrow)
            )
        }

        AnimatedVisibility(
            visible = expanded,
            enter = expandVertically(animationSpec = tween(durationMillis = 220)) +
                fadeIn(animationSpec = tween(durationMillis = 200)),
            exit = shrinkVertically(animationSpec = tween(durationMillis = 200)) +
                fadeOut(animationSpec = tween(durationMillis = 140))
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = EditorialSpace.gutter)
                    .testTag("forum_category_rail"),
                horizontalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
            ) {
                categories.forEach { category ->
                    ForumRoomChip(
                        category = category,
                        onClick = { onCategoryClick(category.slug) }
                    )
                }
            }
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
 *
 * Wider than the first pass and tighter inside it: the description sits directly
 * under the title — two lines of Bengali with a gap between them read as two
 * separate things.
 */
@Composable
private fun ForumRoomChip(category: ForumCategory, onClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(EditorialShape.card),
        color = tokens.surfaceSunken,
        modifier = Modifier
            .width(FORUM_ROOM_WIDTH.dp)
            .clip(RoundedCornerShape(EditorialShape.card))
            .clickable(onClick = onClick)
            .testTag("forum_category_${category.slug}")
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = EditorialSpace.sm, vertical = 10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = category.title,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.5.sp,
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
                    lineHeight = 13.5.sp,
                    color = tokens.inkMuted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 1.dp)
                )
            }
            Box(Modifier.padding(top = EditorialSpace.xs)) {
                ForumCountsRow(
                    discussions = category.discussions,
                    replies = category.replies,
                    locked = false
                )
            }
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
                    top = FORUM_TOP_SPACE,
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

/**
 * What the thread screen has already read.
 *
 * Scoped to the destination, so it survives leaving the screen and coming back —
 * to an author's page and back, or an activity being rebuilt — without either
 * blanking the thread or asking the database for it twice. It also holds the
 * answer to "has this reader's view been counted", which used to be worked out
 * from the screen's own lifetime: a rebuilt screen counted the same reader
 * again. A view is counted once per discussion per visit, which is what the
 * database meant by it in the first place.
 */
class ForumThreadHolder : ViewModel() {
    var thread: ForumThread? by mutableStateOf(null)

    /** Whether the one view this visit is worth has already been counted. */
    var counted: Boolean = false
        private set

    fun markCounted() {
        counted = true
    }
}

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
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val editor = remember { HtmlEditorController() }
    val density = LocalDensity.current

    // The thread lives in the destination's own view model: the screen can be
    // rebuilt (a return from a profile, a rebuilt activity) and the answers are
    // still here, so nothing flashes a spinner over content that never left.
    val holder: ForumThreadHolder = viewModel()
    val thread = holder.thread
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(holder.thread == null) }
    var reloadToken by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }

    var answerOrder by remember { mutableStateOf(ForumThread.ANSWER_RECENT) }
    var expandedBodies by remember { mutableStateOf(setOf<String>()) }
    var expandedThreads by remember { mutableStateOf(setOf<String>()) }

    var replyBody by remember { mutableStateOf("") }
    var attachments by remember { mutableStateOf(listOf<ForumAttachment>()) }
    var replyTarget by remember { mutableStateOf("") }
    var posting by remember { mutableStateOf(false) }
    var replyError by remember { mutableStateOf<String?>(null) }
    var attaching by remember { mutableStateOf(false) }
    // The box is not on the screen until it is asked for: a thread is read far
    // more often than it is answered, and a permanent editor at the bottom of
    // every reading is a screen that is two-thirds a thread.
    var composerOpen by remember { mutableStateOf(false) }

    var reactionTarget by remember { mutableStateOf<ForumReply?>(null) }
    var viewerAttachment by remember { mutableStateOf<ForumAttachment?>(null) }

    // Opening the box: the animation takes this long, and the keyboard is asked
    // for after it, so the two movements do not fight each other.
    val openComposer: (String) -> Unit = { parentId ->
        if (parentId.isNotBlank()) replyTarget = parentId
        composerOpen = true
    }

    // Back, in the order the reader expects: the keyboard first, then the box,
    // then the screen. The box's handler is disabled while the keyboard is up,
    // so the keyboard always wins the first press.
    // `WindowInsets.ime` is a composable getter, so it is read in composition;
    // what the derived state watches is the *plain* call on it, which reads the
    // snapshot state the insets live in.
    val ime = WindowInsets.ime
    val keyboardUp by remember {
        derivedStateOf { ime.getBottom(density) > 0 }
    }
    BackHandler(enabled = composerOpen && !keyboardUp) {
        composerOpen = false
        editor.dismiss()
    }
    BackHandler(enabled = keyboardUp) { editor.dismiss() }

    // The keyboard follows the box in, once the box has arrived.
    LaunchedEffect(composerOpen) {
        if (!composerOpen) return@LaunchedEffect
        delay(FORUM_COMPOSER_APPEAR_MS)
        editor.focus()
    }

    LaunchedEffect(discussionId, reloadToken) {
        // A refresh of a thread that is already on screen shows a thin line, not
        // a spinner: the reader is looking at the answers, not at a blank page.
        if (holder.thread == null) loading = true else refreshing = true
        error = null
        // The view is counted once per discussion per destination: a rebuild of
        // this screen is the same reader looking again, and so is a refresh.
        val countView = reloadToken == 0 && !holder.counted
        loadThread(discussionId, countView)
            .onSuccess { loaded ->
                if (countView) holder.markCounted()
                holder.thread = loaded
            }
            .onFailure { error = it.message ?: "আলোচনা খোলা যায়নি।" }
        loading = false
        refreshing = false
    }

    // The draft comes back when the screen does, and is saved as it changes. A
    // draft with words in it opens the box: a half-written answer behind a button
    // is a half-written answer the reader has to remember they wrote.
    LaunchedEffect(discussionId) {
        val saved = draftStore.reply(discussionId)
        if (saved != null) {
            replyBody = saved.body
            replyTarget = saved.parentId
            attachments = saved.attachments
            if (forumHasText(saved.body) || saved.attachments.isNotEmpty()) composerOpen = true
        }
    }
    LaunchedEffect(replyBody, replyTarget, attachments, discussionId, isSignedIn) {
        if (!isSignedIn) return@LaunchedEffect
        delay(FORUM_SEARCH_DELAY_MS)
        draftStore.saveReply(
            discussionId,
            ForumDraftStore.ReplyDraft(replyBody, replyTarget, attachments)
        )
    }

    // Pictures and PDFs together, five at most. Each file is uploaded as it is
    // taken, so the row fills in front of the reader instead of after them.
    val attachmentPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            attaching = true
            replyError = null
            val picked = uris.take(ForumAttachmentUploader.roomLeft(attachments.size))
            if (picked.size < uris.size) {
                replyError =
                    "একটি উত্তরে সর্বোচ্চ ${toBengaliNumeral(ForumAttachmentUploader.MAX_FILES)}টি ফাইল যুক্ত করা যাবে।"
            }
            picked.forEachIndexed { index, uri ->
                ForumAttachmentUploader.upload(context, uri, index)
                    .onSuccess { file -> attachments = attachments + file }
                    .onFailure { failure ->
                        replyError = failure.message ?: "ফাইল যুক্ত করা যায়নি।"
                    }
            }
            attaching = false
        }
    }

    val submit: () -> Unit = submit@{
        val body = replyBody.trim()
        if (!forumHasText(body)) return@submit
        scope.launch {
            posting = true
            replyError = null
            // The pictures are attached, never typed: they are appended to the
            // post here, on their way out, and never appear in the editor.
            postReply(discussionId, forumWithAttachments(body, attachments), replyTarget)
                .onSuccess { posted ->
                    // Folded in locally, then re-read with countView = false so
                    // the answer arrives with the counts the database kept.
                    holder.thread = holder.thread?.with(posted)
                    // Sent: the box closes and what was in it — words and files
                    // alike — is cleared here and in the draft. The editor is
                    // emptied through its own handle as well, because a WebView
                    // that still holds the caret will not take a value from the
                    // outside; a draft is for what has not been posted.
                    replyBody = ""
                    replyTarget = ""
                    attachments = emptyList()
                    composerOpen = false
                    editor.clear()
                    editor.dismiss()
                    draftStore.clearReply(discussionId)
                    holder.thread = loadThread(discussionId, false).getOrNull() ?: holder.thread
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
                holder.thread = holder.thread?.with(
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
        refreshing = refreshing,
        onBackClick = onBackClick,
        // Refreshing re-reads without counting a second view — the reader is the
        // same reader looking again.
        onRefreshClick = { reloadToken += 1 },
        bottomBar = {
            if (isSignedIn) {
                // One seat, two occupants: a Box, not a Column, so the button on
                // its way out and the box on its way in overlap instead of
                // stacking — the bottom bar never grows to twice its size while
                // the two trade places.
                Box(contentAlignment = Alignment.BottomCenter) {
                    // The box grows out of the bottom of the screen while the
                    // button that asked for it shrinks away, and back on the way
                    // out.
                    AnimatedVisibility(
                        visible = composerOpen,
                        enter = expandVertically(expandFrom = Alignment.Bottom) + fadeIn(),
                        exit = shrinkVertically(shrinkTowards = Alignment.Bottom) + fadeOut()
                    ) {
                        ForumReplyComposer(
                            body = replyBody,
                            onBodyChange = { replyBody = it },
                            attachments = attachments,
                            attaching = attaching,
                            onAttach = {
                                attachmentPicker.launch(ForumAttachmentUploader.PICKER_TYPES)
                            },
                            onRemoveAttachment = { file -> attachments = attachments - file },
                            targetName = thread?.replies
                                ?.firstOrNull { it.id == replyTarget }
                                ?.authorName,
                            onClearTarget = { replyTarget = "" },
                            onCollapse = {
                                composerOpen = false
                                editor.dismiss()
                            },
                            posting = posting,
                            error = replyError,
                            onSubmit = submit,
                            controller = editor
                        )
                    }
                    AnimatedVisibility(
                        visible = !composerOpen,
                        enter = expandVertically(expandFrom = Alignment.Bottom) + fadeIn(),
                        exit = shrinkVertically(shrinkTowards = Alignment.Bottom) + fadeOut()
                    ) {
                        ForumReplyLauncher(onClick = { openComposer("") })
                    }
                }
            } else {
                ForumSignInPrompt(onSignInClick)
            }
        }
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
                        // A tap on anything that is not a control puts the
                        // keyboard away. Controls consume their own taps, so this
                        // only ever sees the taps that had no other job.
                        .pointerInput(Unit) {
                            detectTapGestures(onTap = { editor.dismiss() })
                        }
                        .testTag("forum_thread_screen"),
                    contentPadding = PaddingValues(
                        top = FORUM_TOP_SPACE,
                        bottom = EditorialSpace.lg
                    ),
                    verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
                ) {
                    item {
                        ForumOpeningPost(
                            discussion = loaded.discussion,
                            expanded = expandedBodies.contains(loaded.discussion.id),
                            onToggleExpand = {
                                expandedBodies = expandedBodies.toggle(loaded.discussion.id)
                            },
                            onAuthorClick = { onAuthorClick(loaded.discussion.authorId) },
                            onCardClick = { editor.dismiss() },
                            onOpenAttachment = { file -> viewerAttachment = file }
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
                        // The card's own expansion set: its body, and each of the
                        // replies inside it, fold on their own id.
                        ForumAnswerCard(
                            answer = answer,
                            replies = loaded.repliesUnder(answer.id),
                            showAll = expandedThreads.contains(answer.id),
                            expanded = expandedBodies.contains(answer.id),
                            onToggleExpand = { expandedBodies = expandedBodies.toggle(answer.id) },
                            onToggleAll = { expandedThreads = expandedThreads.toggle(answer.id) },
                            onAuthorClick = onAuthorClick,
                            onReply = { openComposer(answer.id) },
                            onReact = { target -> reactionTarget = target },
                            onCardClick = { editor.dismiss() },
                            onOpenAttachment = { file -> viewerAttachment = file },
                            expandedIds = expandedBodies
                        )
                    }

                    item { Spacer(Modifier.height(EditorialSpace.sm)) }
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

    // An attachment as large as the phone will show it.
    viewerAttachment?.let { file ->
        AttachmentViewer(
            attachment = file,
            onDismiss = { viewerAttachment = null }
        )
    }
}

/** শীর্ষ / সাম্প্রতিক — the order the answers are read in, and nothing else. */
@Composable
private fun ForumAnswerOrderChips(selected: String, onSelect: (String) -> Unit) {
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
    }
}

/**
 * One answer, with its own answers inside it.
 *
 * The replies are drawn *within* the answer's card, indented 22 dp and behind a
 * line down their left: the owner asked for the argument to read as one answer,
 * and one card with a marked-out inside is what that looks like. The indentation
 * is one step and only one — an answer to an answer is attached to the answer it
 * belongs to, in the database as well as here, so nothing marches off the right
 * of the screen however long the argument runs.
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
    onReact: (ForumReply) -> Unit,
    onCardClick: () -> Unit,
    onOpenAttachment: (ForumAttachment) -> Unit,
    expandedIds: Set<String> = emptySet()
) {
    val tokens = LocalEditorialTokens.current
    val shown = if (showAll) replies else replies.takeLast(1)
    val hidden = (replies.size - shown.size).coerceAtLeast(0)

    Surface(
        shape = RoundedCornerShape(EditorialShape.card),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .clip(RoundedCornerShape(EditorialShape.card))
            .combinedClickable(
                onLongClick = { onReact(answer) },
                onClick = onCardClick
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
                showTime = true,
                avatarSize = 34,
                nameSize = 13.5.sp,
                onClick = { onAuthorClick(answer.authorId) }
            )
            ForumBody(
                html = answer.body,
                expanded = expanded || !answer.isLong,
                canExpand = answer.isLong,
                onToggleExpand = onToggleExpand,
                onOpenAttachment = onOpenAttachment,
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

            if (replies.isNotEmpty()) {
                Hairline()
                if (hidden > 0) {
                    Text(
                        text = "আরও ${toBengaliNumeral(hidden)} টি উত্তর — সব উত্তর দেখুন চাপুন",
                        fontFamily = Kalpurush,
                        fontSize = 11.sp,
                        color = tokens.inkMuted,
                        modifier = Modifier.padding(start = FORUM_REPLY_INDENT)
                    )
                }
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = FORUM_REPLY_INDENT)
                        // A line down the left of the replies: they are inside
                        // this answer, and the line is what says so.
                        .drawBehind {
                            val stroke = 2.dp.toPx()
                            drawRoundRect(
                                color = tokens.accentSoft,
                                topLeft = Offset(0f, 0f),
                                size = Size(stroke, size.height),
                                cornerRadius = CornerRadius(stroke)
                            )
                        }
                        .padding(start = EditorialSpace.sm),
                    verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
                ) {
                    shown.forEach { nested ->
                        ForumNestedReply(
                            reply = nested,
                            expanded = expandedIds.contains(nested.id),
                            onToggleExpand = onToggleExpand,
                            onAuthorClick = onAuthorClick,
                            onReply = onReply,
                            onReact = onReact,
                            onCardClick = onCardClick,
                            onOpenAttachment = onOpenAttachment
                        )
                    }
                }
            }
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
    onReact: (ForumReply) -> Unit,
    onCardClick: () -> Unit,
    onOpenAttachment: (ForumAttachment) -> Unit
) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(EditorialShape.thumb),
        color = tokens.surfaceSunken,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(EditorialShape.thumb))
            .combinedClickable(
                onLongClick = { onReact(reply) },
                onClick = onCardClick
            )
            .testTag("forum_reply_${reply.id}")
    ) {
        Column(
            modifier = Modifier.padding(EditorialSpace.sm),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
        ) {
            ForumAuthorRow(
                name = reply.authorName,
                avatarUrl = reply.authorAvatarUrl,
                date = reply.createdAt,
                showTime = true,
                avatarSize = 26,
                nameSize = 12.5.sp,
                onClick = { onAuthorClick(reply.authorId) }
            )
            ForumBody(
                html = reply.body,
                expanded = expanded || !reply.isLong,
                canExpand = reply.isLong,
                onToggleExpand = onToggleExpand,
                onOpenAttachment = onOpenAttachment,
                testTag = "forum_reply_body_${reply.id}"
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                ForumReactionRow(reply = reply, onReact = { onReact(reply) }, small = true)
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

/**
 * The three reactions as icons — the count beside each one, and the reader's own
 * in the accent colour.
 *
 * The owner asked for icons instead of words: "লাইক" under every answer, three
 * times, is a wall of text where a thumb would do; the counts stay, because the
 * counts are what the thread is read by.
 */
@Composable
private fun ForumReactionRow(
    reply: ForumReply,
    onReact: () -> Unit,
    small: Boolean = false
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
    ) {
        ForumReactionCount(
            icon = Icons.Default.ThumbUp,
            label = "লাইক",
            count = reply.likes,
            mine = reply.myReaction == ForumReply.REACTION_LIKE,
            onClick = onReact,
            small = small,
            modifier = Modifier.testTag("forum_likes_${reply.id}")
        )
        ForumReactionCount(
            icon = Icons.Default.CheckCircle,
            label = "একমত",
            count = reply.agrees,
            mine = reply.myReaction == ForumReply.REACTION_AGREE,
            onClick = onReact,
            small = small,
            modifier = Modifier.testTag("forum_agrees_${reply.id}")
        )
        ForumReactionCount(
            icon = Icons.Default.ThumbDown,
            label = "অপছন্দ",
            count = reply.dislikes,
            mine = reply.myReaction == ForumReply.REACTION_DISLIKE,
            onClick = onReact,
            small = small,
            modifier = Modifier.testTag("forum_dislikes_${reply.id}")
        )
    }
}

@Composable
private fun ForumReactionCount(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    count: Int,
    mine: Boolean,
    onClick: () -> Unit,
    small: Boolean,
    modifier: Modifier = Modifier
) {
    val tokens = LocalEditorialTokens.current
    val colour = if (mine) tokens.accent else tokens.inkMuted
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(EditorialShape.chip))
            .clickable(onClick = onClick)
            .padding(horizontal = EditorialSpace.xs, vertical = EditorialSpace.xxs),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = colour,
            modifier = Modifier.size(if (small) 14.dp else 16.dp)
        )
        Spacer(Modifier.width(EditorialSpace.xxs))
        Text(
            text = toBengaliNumeral(count),
            fontFamily = Kalpurush,
            fontSize = if (small) 11.sp else 11.5.sp,
            fontWeight = if (mine) FontWeight.Bold else FontWeight.Normal,
            color = colour
        )
    }
}

/**
 * The long-press popup: লাইক, অপছন্দ, একমত — three icons in a row.
 *
 * The name of the answer's author is not repeated here (the card it was pressed
 * on is right behind it), and neither are the counts: this is a control, not a
 * summary, and the summary is on the card.
 */
@Composable
private fun ForumReactionDialog(
    reply: ForumReply,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(EditorialShape.sheet),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 3.dp,
            modifier = Modifier.testTag("forum_reaction_dialog")
        ) {
            Row(
                modifier = Modifier.padding(horizontal = EditorialSpace.sm, vertical = EditorialSpace.xs),
                horizontalArrangement = Arrangement.spacedBy(EditorialSpace.xs),
                verticalAlignment = Alignment.CenterVertically
            ) {
                ReactionChoice(
                    icon = Icons.Default.ThumbUp,
                    label = "লাইক",
                    selected = reply.myReaction == ForumReply.REACTION_LIKE,
                    onClick = { onPick(ForumReply.REACTION_LIKE) },
                    testTag = "forum_react_like"
                )
                ReactionChoice(
                    icon = Icons.Default.CheckCircle,
                    label = "একমত",
                    selected = reply.myReaction == ForumReply.REACTION_AGREE,
                    onClick = { onPick(ForumReply.REACTION_AGREE) },
                    testTag = "forum_react_agree"
                )
                ReactionChoice(
                    icon = Icons.Default.ThumbDown,
                    label = "অপছন্দ",
                    selected = reply.myReaction == ForumReply.REACTION_DISLIKE,
                    onClick = { onPick(ForumReply.REACTION_DISLIKE) },
                    testTag = "forum_react_dislike"
                )
            }
        }
    }
}

@Composable
private fun ReactionChoice(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    testTag: String
) {
    val tokens = LocalEditorialTokens.current
    IconButton(
        onClick = onClick,
        modifier = Modifier
            .size(48.dp)
            .clip(CircleShape)
            .background(if (selected) tokens.accentSoft else Color.Transparent)
            .testTag(testTag)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = if (selected) tokens.accent else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.size(24.dp)
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
    var attachments by remember { mutableStateOf(listOf<ForumAttachment>()) }
    var attaching by remember { mutableStateOf(false) }
    var attachError by remember { mutableStateOf<String?>(null) }

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
            attachments = saved.attachments
        }
        restored = true
    }

    // Saved as it is typed, so nothing is lost to a phone call or a wrong turn.
    LaunchedEffect(restored, categorySlug, title, body, coverUrl, coverDeleteUrl, attachments) {
        if (!restored) return@LaunchedEffect
        delay(FORUM_SEARCH_DELAY_MS)
        draftStore.saveComposer(
            ForumDraftStore.ComposerDraft(
                categorySlug = categorySlug,
                title = title,
                body = body,
                coverImageUrl = coverUrl,
                coverDeleteUrl = coverDeleteUrl,
                attachments = attachments
            )
        )
    }

    // The same picker the reply box uses: pictures and PDFs, five at most.
    val attachmentPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            attaching = true
            attachError = null
            val picked = uris.take(ForumAttachmentUploader.roomLeft(attachments.size))
            if (picked.size < uris.size) {
                attachError =
                    "একটি আলোচনায় সর্বোচ্চ ${toBengaliNumeral(ForumAttachmentUploader.MAX_FILES)}টি ফাইল যুক্ত করা যাবে।"
            }
            picked.forEachIndexed { index, uri ->
                ForumAttachmentUploader.upload(context, uri, index)
                    .onSuccess { file -> attachments = attachments + file }
                    .onFailure { failure ->
                        attachError = failure.message ?: "ফাইল যুক্ত করা যায়নি।"
                    }
            }
            attaching = false
        }
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
                top = FORUM_TOP_SPACE,
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
                // The article composer's editor in its compact shape: bold,
                // italic, underline and a list, without the selection popup the
                // owner did not want over a forum post. A thread's picture is its
                // cover, so there is nothing to attach here.
                HtmlContentEditor(
                    value = body,
                    onValueChange = { body = it },
                    editorHeight = 180,
                    selectionPopup = false,
                    compact = true,
                    maxGrow = 420,
                    placeholder = "আলোচনার কথা লিখুন…",
                    testTag = "forum_new_body"
                )
                // The cover is the thread's face; these are its files, and they
                // are attached the same way a reply's are.
                ForumAttachmentRow(
                    attachments = attachments,
                    attaching = attaching,
                    onAttach = { attachmentPicker.launch(ForumAttachmentUploader.PICKER_TYPES) },
                    onRemove = { file -> attachments = attachments - file },
                    tagPrefix = "forum_new",
                    modifier = Modifier.padding(top = EditorialSpace.xs)
                )
                attachError?.let { message ->
                    Text(
                        text = message,
                        fontFamily = Kalpurush,
                        fontSize = 11.5.sp,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag("forum_new_attach_error")
                    )
                }
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
                            // The files ride with the body, on their way out — and
                            // only here, so nothing is inserted into the writing.
                            post(
                                categorySlug,
                                title,
                                forumWithAttachments(body, attachments),
                                coverUrl,
                                coverDeleteUrl
                            )
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
                        Icon(
                    imageVector = Icons.AutoMirrored.Filled.Send,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
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
    refreshing: Boolean = false,
    onRefreshClick: (() -> Unit)? = null,
    bottomBar: (@Composable () -> Unit)? = null,
    content: @Composable (PaddingValues) -> Unit
) {
    val tokens = LocalEditorialTokens.current
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column(Modifier.padding(vertical = EditorialSpace.xxs)) {
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
                // No bell here: notices are the dashboard's, and the forum's bar
                // belongs to the forum. The search is on the page itself, where a
                // field can be tapped and typed into.
                actions = {
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
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
            // A refresh behind content that is already on screen: a line under
            // the bar says so without taking the thread off the page.
            if (refreshing) {
                LinearProgressIndicator(
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("forum_thread_refreshing")
                )
            }
        },
        bottomBar = { bottomBar?.invoke() },
        content = content
    )
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
            .clip(RoundedCornerShape(EditorialShape.card))
            .testTag("forum_discussion_${discussion.id}")
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
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
                fontSize = 17.sp,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )

            if (discussion.excerpt.isNotBlank()) {
                Text(
                    text = discussion.excerpt,
                    fontFamily = Kalpurush,
                    fontSize = 12.5.sp,
                    lineHeight = 15.sp,
                    color = tokens.inkMuted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Hairline()

            Row(verticalAlignment = Alignment.CenterVertically) {
                ForumAuthorRow(
                    name = discussion.authorName,
                    avatarUrl = discussion.authorAvatarUrl,
                    date = discussion.lastActivityAt,
                    avatarSize = 36,
                    nameSize = 13.sp,
                    onClick = onAuthorClick,
                    modifier = Modifier.weight(1f)
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

/** What the reader typed, without the editor's markup. */
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

/**
 * Picture, then the name with the date beside it.
 *
 * The owner's note was that the name and the date were stacked with a gap
 * between them; they are one line now, the date in the muted ink and a size
 * down. [showTime] adds the clock, which is what an answer needs and a
 * discussion card does not.
 */
@Composable
private fun ForumAuthorRow(
    name: String,
    avatarUrl: String,
    date: String,
    onClick: () -> Unit,
    avatarSize: Int = 34,
    nameSize: androidx.compose.ui.unit.TextUnit = 13.sp,
    showTime: Boolean = false,
    modifier: Modifier = Modifier
) {
    val tokens = LocalEditorialTokens.current
    val stamp = if (showTime) formatBengaliDateTime(date) else formatBengaliDate(date)
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(EditorialShape.thumb))
            .clickable(onClick = onClick)
            .testTag("forum_author_$name"),
        verticalAlignment = Alignment.CenterVertically
    ) {
        ForumAvatar(url = avatarUrl, name = name, size = avatarSize)
        Spacer(Modifier.width(EditorialSpace.xs))
        Text(
            text = name,
            fontFamily = Kalpurush,
            fontWeight = FontWeight.SemiBold,
            fontSize = nameSize,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            // The name gives way before the date does: a clipped name is still
            // a name, a clipped date is a number that lies.
            modifier = Modifier.weight(1f, fill = false)
        )
        if (stamp.isNotBlank()) {
            Spacer(Modifier.width(6.dp))
            Text(
                text = stamp,
                fontFamily = Kalpurush,
                fontSize = 10.5.sp,
                color = tokens.inkMuted,
                maxLines = 1
            )
        }
    }
}

/**
 * A body, folded until asked for, and its attachments under it.
 *
 * The words and the files are asked for separately, and that is the whole of the
 * fix the owner needed twice: a body with a picture in it used to be handed to
 * the text renderer whole, and HtmlCompat draws an `<img>` as U+FFFC — the one
 * character the platform keeps for "an object I cannot draw", which a reader sees
 * as a boxed "obj". The picture is drawn by the app now, as a preview, and the
 * text renderer never sees it.
 *
 * Folding counts the words only ([ForumReply.isLong]), so a short answer with a
 * file in it no longer hides behind a "see more" for the sake of a tag.
 */
@Composable
private fun ForumBody(
    html: String,
    expanded: Boolean,
    canExpand: Boolean,
    onToggleExpand: () -> Unit,
    onOpenAttachment: (ForumAttachment) -> Unit,
    testTag: String
) {
    val tokens = LocalEditorialTokens.current
    val markup = forumBodyMarkup(html)
    val images = forumBodyImages(html)
    val docs = forumBodyDocs(html)
    Column(verticalArrangement = Arrangement.spacedBy(EditorialSpace.xxs)) {
        if (markup.isNotBlank()) {
            if (expanded) {
                RichHtmlArticleBody(
                    html = markup,
                    fontSizeSp = 14f,
                    lineSpacingMultiplier = 1.4f,
                    onOpenLink = { },
                    modifier = Modifier.testTag(testTag)
                )
            } else {
                com.ningshingche.app.ui.components.HtmlFormattedText(
                    html = markup,
                    fontSize = 14.sp,
                    maxLines = 6,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.testTag(testTag)
                )
            }
        }
        if (images.isNotEmpty() || docs.isNotEmpty()) {
            // Pictures first, then documents: a name tells a reader nothing about
            // a picture, and a picture tells them nothing about a page.
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(EditorialSpace.xs),
                verticalAlignment = Alignment.CenterVertically
            ) {
                images.forEach { url ->
                    ForumAttachmentPreview(
                        file = ForumAttachment.fromReference(url, ""),
                        onClick = onOpenAttachment
                    )
                }
                docs.forEach { doc ->
                    ForumAttachmentPreview(file = doc, onClick = onOpenAttachment)
                }
            }
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
                    .clickable(onClick = onToggleExpand)
                    .padding(vertical = EditorialSpace.xxs)
                    .testTag("${testTag}_more")
            )
        }
    }
}

/**
 * One attached file, as a post shows it: a picture as a small preview, a
 * document as its icon and its name. A tap opens the viewer.
 */
@Composable
private fun ForumAttachmentPreview(file: ForumAttachment, onClick: (ForumAttachment) -> Unit) {
    val tokens = LocalEditorialTokens.current
    if (file.isPdf) {
        Surface(
            shape = RoundedCornerShape(EditorialShape.thumb),
            color = tokens.surfaceSunken,
            modifier = Modifier
                .clip(RoundedCornerShape(EditorialShape.thumb))
                .clickable { onClick(file) }
                .testTag("forum_body_attachment")
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(
                    start = EditorialSpace.xs,
                    end = EditorialSpace.sm,
                    top = EditorialSpace.xs,
                    bottom = EditorialSpace.xs
                )
            ) {
                Icon(
                    imageVector = Icons.Default.PictureAsPdf,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.error
                )
                Spacer(Modifier.width(EditorialSpace.xs))
                Text(
                    text = file.label,
                    fontFamily = Kalpurush,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 168.dp)
                )
            }
        }
    } else {
        PortalAsyncImage(
            url = file.url,
            contentDescription = file.label,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .size(FORUM_ATTACHMENT_PREVIEW)
                .clip(RoundedCornerShape(EditorialShape.thumb))
                .clickable { onClick(file) }
                .testTag("forum_body_attachment")
        )
    }
}

/** The opening post, with its cover and its numbers. */
@Composable
private fun ForumOpeningPost(
    discussion: ForumDiscussion,
    expanded: Boolean,
    onToggleExpand: () -> Unit,
    onAuthorClick: () -> Unit,
    onCardClick: () -> Unit,
    onOpenAttachment: (ForumAttachment) -> Unit
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
            .clickable(onClick = onCardClick)
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
                showTime = true,
                avatarSize = 38,
                nameSize = 13.5.sp,
                onClick = onAuthorClick
            )

            Hairline()

            ForumBody(
                html = discussion.body,
                // The opening post folds on its words like an answer does; its
                // pictures are previews under the text, not a reason to hide it.
                expanded = expanded || forumBodyText(discussion.body).length <= FORUM_FOLD_CHARS,
                canExpand = forumBodyText(discussion.body).length > FORUM_FOLD_CHARS,
                onToggleExpand = onToggleExpand,
                onOpenAttachment = onOpenAttachment,
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

/**
 * উত্তর যোগ করুন — the one control a thread shows when nobody is writing in it.
 *
 * A button, and only a button: it sits in the corner over the page's own
 * background rather than inside a full-width bar with a tone of its own. The
 * owner's words were that the strip it used to live in "occupied BG over the
 * bottom of the page" — the page is a page, and the button is a control on it.
 * The scaffold still reserves the button's height, so nothing the thread says is
 * ever underneath it.
 */
@Composable
private fun ForumReplyLauncher(onClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(
                start = EditorialSpace.gutter,
                end = EditorialSpace.gutter,
                top = EditorialSpace.xs,
                bottom = EditorialSpace.xs
            )
            .testTag("forum_reply_launcher"),
        contentAlignment = Alignment.CenterEnd
    ) {
        ExtendedFloatingActionButton(
            onClick = onClick,
            containerColor = tokens.accent,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            elevation = FloatingActionButtonDefaults.elevation(
                defaultElevation = 4.dp,
                pressedElevation = 8.dp
            ),
            modifier = Modifier.testTag("forum_reply_open")
        ) {
            Icon(
                imageVector = Icons.Default.Reply,
                contentDescription = null,
                modifier = Modifier.size(16.dp)
            )
            Spacer(Modifier.width(EditorialSpace.xs))
            Text(
                text = "উত্তর যোগ করুন",
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 13.5.sp
            )
        }
    }
}

/**
 * The reply box, once it has been asked for.
 *
 * It starts at [FORUM_COMPOSER_HEIGHT] — a reply is usually a line or two, and a
 * box the height of a paragraph is a box that has taken the thread off the
 * screen — and grows with what is written in it up to [FORUM_COMPOSER_MAX], after
 * which it scrolls inside itself. The keyboard lifts the whole strip
 * (`imePadding`) rather than covering it.
 *
 * Four buttons over the text — bold, italic, underline, a list — and nothing
 * else: the owner took the picture button out of this row, because files are
 * attached on the row under the box, where a picture cannot be dropped into the
 * middle of a sentence by a mistimed tap. [onCollapse] is the chevron that puts
 * the box away without posting anything; the draft stays where it is.
 */
@Composable
private fun ForumReplyComposer(
    body: String,
    onBodyChange: (String) -> Unit,
    attachments: List<ForumAttachment>,
    attaching: Boolean,
    onAttach: () -> Unit,
    onRemoveAttachment: (ForumAttachment) -> Unit,
    targetName: String?,
    onClearTarget: () -> Unit,
    onCollapse: () -> Unit,
    posting: Boolean,
    error: String?,
    onSubmit: () -> Unit,
    controller: HtmlEditorController
) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 3.dp,
        shadowElevation = 8.dp,
        modifier = Modifier
            .fillMaxWidth()
            .imePadding()
            .navigationBarsPadding()
            .testTag("forum_reply_box")
    ) {
        Column(
            modifier = Modifier.padding(
                start = EditorialSpace.sm,
                end = EditorialSpace.sm,
                top = EditorialSpace.xs,
                bottom = EditorialSpace.xs
            ),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.xxs)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = targetName?.let { "$it কে উত্তর" } ?: "নতুন উত্তর",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                    color = if (targetName != null) tokens.accent else tokens.inkMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                if (targetName != null) {
                    TextButton(
                        onClick = onClearTarget,
                        modifier = Modifier.testTag("forum_reply_target_clear")
                    ) {
                        Text("বাতিল", fontFamily = Kalpurush, fontSize = 12.sp, color = tokens.inkMuted)
                    }
                }
                IconButton(
                    onClick = onCollapse,
                    modifier = Modifier
                        .size(30.dp)
                        .testTag("forum_reply_collapse")
                ) {
                    Icon(
                        imageVector = Icons.Default.KeyboardArrowDown,
                        contentDescription = "লেখা বন্ধ করুন",
                        modifier = Modifier.size(18.dp),
                        tint = tokens.inkMuted
                    )
                }
            }

            HtmlContentEditor(
                value = body,
                onValueChange = onBodyChange,
                editorHeight = FORUM_COMPOSER_HEIGHT,
                maxGrow = FORUM_COMPOSER_MAX,
                selectionPopup = false,
                compact = true,
                placeholder = "উত্তর লিখুন…",
                testTag = "forum_reply_field",
                controller = controller
            )

            // The files live here, on the row with the button that added them —
            // never over the formatting buttons, and never in the text.
            ForumAttachmentRow(
                attachments = attachments,
                attaching = attaching,
                onAttach = onAttach,
                onRemove = onRemoveAttachment,
                tagPrefix = "forum_reply"
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

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
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

/**
 * The paperclip, and what it has taken so far.
 *
 * Five files at most, pictures and PDFs: a picture is drawn as itself, small,
 * with a cross on its corner; a document is drawn as its icon and its file name,
 * because a page of text cannot be a thumbnail and a reader who attached three
 * PDFs has to be able to tell them apart. The cross is on every file, pictures
 * and documents alike, and taking one back never touches the others.
 *
 * [tagPrefix] lets the two composers that use this row — the reply box and the
 * new-thread composer — be driven apart in a UI test.
 */
@Composable
private fun ForumAttachmentRow(
    attachments: List<ForumAttachment>,
    attaching: Boolean,
    onAttach: () -> Unit,
    onRemove: (ForumAttachment) -> Unit,
    tagPrefix: String,
    modifier: Modifier = Modifier
) {
    val tokens = LocalEditorialTokens.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(EditorialSpace.xs)
    ) {
        IconButton(
            onClick = onAttach,
            enabled = !attaching && ForumAttachmentUploader.canAdd(attachments.size),
            modifier = Modifier
                .size(32.dp)
                .testTag("${tagPrefix}_attach")
        ) {
            if (attaching) {
                CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
            } else {
                Icon(
                    imageVector = Icons.Default.AttachFile,
                    contentDescription = "ফাইল সংযুক্ত করুন",
                    modifier = Modifier.size(18.dp),
                    tint = tokens.inkMuted
                )
            }
        }
        attachments.forEach { file ->
            if (file.isPdf) {
                Surface(
                    shape = RoundedCornerShape(EditorialShape.thumb),
                    color = tokens.surfaceSunken,
                    modifier = Modifier.testTag("${tagPrefix}_attachment")
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(
                            start = EditorialSpace.xs,
                            end = EditorialSpace.xxs,
                            top = EditorialSpace.xxs,
                            bottom = EditorialSpace.xxs
                        )
                    ) {
                        Icon(
                            imageVector = Icons.Default.PictureAsPdf,
                            contentDescription = null,
                            modifier = Modifier.size(15.dp),
                            tint = MaterialTheme.colorScheme.error
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = file.label,
                            fontFamily = Kalpurush,
                            fontSize = 11.5.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 132.dp)
                        )
                    }
                }
            } else {
                Box(modifier = Modifier.size(FORUM_ATTACHMENT_THUMB).testTag("${tagPrefix}_attachment")) {
                    PortalAsyncImage(
                        url = file.url,
                        contentDescription = file.label,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(RoundedCornerShape(EditorialShape.thumb))
                    )
                }
            }
            IconButton(
                onClick = { onRemove(file) },
                modifier = Modifier
                    .size(22.dp)
                    .testTag("${tagPrefix}_attachment_remove")
            ) {
                Icon(
                    imageVector = Icons.Default.Clear,
                    contentDescription = "সংযুক্তি সরান",
                    modifier = Modifier
                        .size(14.dp)
                        .background(MaterialTheme.colorScheme.surface, CircleShape),
                    tint = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

@Composable
private fun ForumSignInPrompt(onSignInClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = tokens.surfaceSunken,
        tonalElevation = 3.dp,
        shadowElevation = 8.dp,
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .testTag("forum_reply_sign_in")
    ) {
        Row(
            modifier = Modifier.padding(EditorialSpace.sm),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = "উত্তর দিতে সাইন ইন করুন",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp
                )
                Text(
                    text = "পড়া যায় সবার — লেখা যায় নিজের নামে।",
                    fontFamily = Kalpurush,
                    fontSize = 11.5.sp,
                    color = tokens.inkSoft
                )
            }
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
                    .clickable { onOpenDiscussion(thread.id) }
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
                    .clickable { onOpenDiscussion(answer.discussionId) }
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
                            formatBengaliDateTime(answer.createdAt),
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
    /** Asked for a bigger page when the database has more than this card holds. */
    onLoadMore: (() -> Unit)? = null,
    loadingMore: Boolean = false,
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
                // Five items to a page, and the rest behind this button — which
                // is the owner's rule for the dashboard's forum section. The
                // database is asked again for a bigger window each time, so the
                // list is never a copy of what the app already had.
                if (onLoadMore != null) {
                    TextButton(
                        onClick = { if (!loadingMore) onLoadMore() },
                        enabled = !loadingMore,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("dashboard_forum_more")
                    ) {
                        if (loadingMore) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(15.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Text(
                                text = "আরও লোড করুন",
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
