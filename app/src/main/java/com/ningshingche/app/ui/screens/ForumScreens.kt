package com.ningshingche.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ningshingche.app.data.portal.ForumCategory
import com.ningshingche.app.data.portal.ForumCategoryPage
import com.ningshingche.app.data.portal.ForumDiscussion
import com.ningshingche.app.data.portal.ForumOverview
import com.ningshingche.app.data.portal.ForumReply
import com.ningshingche.app.data.portal.ForumSearchResult
import com.ningshingche.app.data.portal.ForumText
import com.ningshingche.app.data.portal.ForumThread
import com.ningshingche.app.data.portal.PortalError
import com.ningshingche.app.ui.components.PortalAsyncImage
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.editorial.EmptyState
import com.ningshingche.app.ui.editorial.ErrorState
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.editorial.formatBengaliDate
import com.ningshingche.app.ui.editorial.toBengaliNumeral
import com.ningshingche.app.ui.theme.Kalpurush
import kotlinx.coroutines.delay

/**
 * ফোরাম — a basic forum on the same rails as the rest of the reader: the same
 * transport, the same editorial tokens, the same sign-in gate.
 *
 * Read by anyone, written by signed-in readers, which is what the database
 * enforces: the five read RPCs are granted to `anon` as well, and the two write
 * RPCs are granted to `authenticated` alone *and* raise 42501 when there is no
 * session. The app does not have to guess who may write — it asks, and a refusal
 * arrives as [PortalError.SignedOut], which is the same type the contributor
 * board answers a stale session with. Screens therefore show the gate for a
 * refusal rather than an error, and a signed-in reader whose token has simply
 * expired is offered the way back in instead of a sentence about permissions.
 *
 * The screens take suspend lambdas rather than a ViewModel, the way
 * [PublicProfileScreen] and [ContributorScreen] do: each of these pages has one
 * request and one piece of state, and a ViewModel would add a factory arm
 * without adding a behaviour.
 */

// ---------------------------------------------------------------------------
// Forum home
// ---------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForumHomeScreen(
    isSignedIn: Boolean,
    loadOverview: suspend () -> Result<ForumOverview>,
    search: suspend (String) -> Result<ForumSearchResult>,
    onBackClick: () -> Unit,
    onCategoryClick: (String) -> Unit,
    onDiscussionClick: (String) -> Unit,
    onNewDiscussion: () -> Unit,
    onSignInClick: () -> Unit
) {
    var overview by remember { mutableStateOf<ForumOverview?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var reloadToken by remember { mutableIntStateOf(0) }

    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<ForumSearchResult?>(null) }
    var searching by remember { mutableStateOf(false) }

    LaunchedEffect(reloadToken) {
        loading = true
        error = null
        loadOverview()
            .onSuccess { overview = it }
            .onFailure { error = it.message ?: "ফোরাম লোড হয়নি।" }
        loading = false
    }

    // Nothing is asked of the database for a single character — two is where a
    // word has begun — and the pause after the last keystroke is what keeps
    // typing from firing one request per letter.
    LaunchedEffect(query) {
        val term = query.trim()
        if (term.length < 2) {
            results = null
            searching = false
            return@LaunchedEffect
        }
        searching = true
        delay(300)
        search(term)
            .onSuccess { results = it }
            .onFailure { results = ForumSearchResult(term, emptyList(), 0) }
        searching = false
    }

    ForumScaffold(
        title = "ফোরাম",
        subtitle = overview?.let { "${toBengaliNumeral(it.totalDiscussions)} আলোচনা · " +
            "${toBengaliNumeral(it.totalReplies)} উত্তর" },
        onBackClick = onBackClick,
        testTag = "forum_home_screen",
        floatingAction = {
            ExtendedFloatingActionButton(
                onClick = { if (isSignedIn) onNewDiscussion() else onSignInClick() },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = Color.White,
                modifier = Modifier.testTag("forum_new_discussion")
            ) {
                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("নতুন আলোচনা", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                loading && overview == null -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) { CircularProgressIndicator() }

                overview == null -> ErrorState(
                    message = error ?: "ফোরাম পাওয়া যায়নি।",
                    onRetry = { reloadToken += 1 }
                )

                else -> {
                    val loaded = overview!!
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(bottom = 96.dp),
                        verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
                    ) {
                        item {
                            ForumSearchField(
                                query = query,
                                onQueryChange = { query = it },
                                searching = searching,
                                modifier = Modifier.padding(
                                    horizontal = EditorialSpace.gutter,
                                    vertical = EditorialSpace.xs
                                )
                            )
                        }

                        if (results != null) {
                            val found = results!!
                            item {
                                ForumSectionTitle(
                                    title = if (found.total == 0) "কিছু পাওয়া যায়নি" else "অনুসন্ধানের ফল",
                                    count = found.total.takeIf { it > 0 }
                                )
                            }
                            if (found.discussions.isEmpty()) {
                                item {
                                    EmptyState(
                                        message = "«${found.query}» — এই শব্দে কোনো আলোচনা নেই।",
                                        modifier = Modifier.padding(EditorialSpace.lg)
                                    )
                                }
                            }
                            items(found.discussions, key = { "hit-${it.id}" }) { hit ->
                                ForumDiscussionCard(hit) { onDiscussionClick(hit.id) }
                            }
                        } else {
                            if (loaded.categories.isNotEmpty()) {
                                item { ForumSectionTitle(title = "বিভাগসমূহ", count = loaded.categories.size) }
                                items(loaded.categories, key = { "cat-${it.id}" }) { category ->
                                    ForumCategoryCard(category) { onCategoryClick(category.slug) }
                                }
                            }

                            item {
                                ForumSectionTitle(
                                    title = "সাম্প্রতিক আলোচনা",
                                    count = loaded.latest.size.takeIf { it > 0 }
                                )
                            }
                            if (loaded.latest.isEmpty()) {
                                item {
                                    EmptyState(
                                        message = if (isSignedIn) {
                                            "এখনো কোনো আলোচনা হয়নি — প্রথমটা আপনি শুরু করতে পারেন।"
                                        } else {
                                            "এখনো কোনো আলোচনা হয়নি। সাইন ইন করে প্রথমটা শুরু করুন।"
                                        },
                                        modifier = Modifier.padding(EditorialSpace.lg)
                                    )
                                }
                            }
                            items(loaded.latest, key = { "thread-${it.id}" }) { discussion ->
                                ForumDiscussionCard(discussion) { onDiscussionClick(discussion.id) }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// One room
// ---------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForumCategoryScreen(
    slug: String,
    isSignedIn: Boolean,
    loadCategory: suspend (String) -> Result<ForumCategoryPage>,
    onBackClick: () -> Unit,
    onDiscussionClick: (String) -> Unit,
    onNewDiscussion: (String) -> Unit,
    onSignInClick: () -> Unit
) {
    var room by remember(slug) { mutableStateOf<ForumCategoryPage?>(null) }
    var error by remember(slug) { mutableStateOf<String?>(null) }
    var loading by remember(slug) { mutableStateOf(true) }
    var reloadToken by remember(slug) { mutableIntStateOf(0) }

    LaunchedEffect(slug, reloadToken) {
        loading = true
        error = null
        loadCategory(slug)
            .onSuccess { room = it }
            .onFailure { error = it.message ?: "এই বিভাগ পাওয়া যায়নি।" }
        loading = false
    }

    ForumScaffold(
        title = room?.category?.title ?: "আলোচনা",
        subtitle = room?.category?.description?.takeIf { it.isNotBlank() },
        onBackClick = onBackClick,
        testTag = "forum_category_screen",
        floatingAction = {
            if (room?.category?.isLocked != true) {
                ExtendedFloatingActionButton(
                    onClick = { if (isSignedIn) onNewDiscussion(slug) else onSignInClick() },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = Color.White,
                    modifier = Modifier.testTag("forum_room_new_discussion")
                ) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("নতুন আলোচনা", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                }
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                loading && room == null -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) { CircularProgressIndicator() }

                room == null -> ErrorState(
                    message = error ?: "এই বিভাগ পাওয়া যায়নি।",
                    onRetry = { reloadToken += 1 }
                )

                else -> {
                    val loaded = room!!
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(bottom = 96.dp),
                        verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
                    ) {
                        item {
                            ForumCountsRow(
                                discussions = loaded.total,
                                replies = loaded.category.replies,
                                locked = loaded.category.isLocked
                            )
                        }
                        if (loaded.discussions.isEmpty()) {
                            item {
                                EmptyState(
                                    message = "এই বিভাগে এখনো কোনো আলোচনা নেই।",
                                    modifier = Modifier.padding(EditorialSpace.lg)
                                )
                            }
                        }
                        items(loaded.discussions, key = { "room-${it.id}" }) { discussion ->
                            ForumDiscussionCard(discussion) { onDiscussionClick(discussion.id) }
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// One discussion
// ---------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForumThreadScreen(
    discussionId: String,
    isSignedIn: Boolean,
    loadThread: suspend (String, Boolean) -> Result<ForumThread>,
    postReply: suspend (String, String) -> Result<ForumReply>,
    onBackClick: () -> Unit,
    onSignInClick: () -> Unit
) {
    var thread by remember(discussionId) { mutableStateOf<ForumThread?>(null) }
    var error by remember(discussionId) { mutableStateOf<String?>(null) }
    var loading by remember(discussionId) { mutableStateOf(true) }
    var reloadToken by remember(discussionId) { mutableIntStateOf(0) }

    var draft by remember(discussionId) { mutableStateOf("") }
    var posting by remember(discussionId) { mutableStateOf(false) }
    var postError by remember(discussionId) { mutableStateOf<String?>(null) }
    var refused by remember(discussionId) { mutableStateOf(false) }

    LaunchedEffect(discussionId, reloadToken) {
        val opening = reloadToken == 0
        loading = true
        error = null
        // The first look counts as a view; a retry or a refresh after posting
        // does not, or "views" would mean "times this screen blinked".
        loadThread(discussionId, opening)
            .onSuccess { thread = it }
            .onFailure { error = it.message ?: "আলোচনা লোড হয়নি।" }
        loading = false
    }

    val draftProblem = ForumText.replyProblem(draft)
    val canPost = isSignedIn && draft.isNotBlank() && draftProblem == null && !posting

    ForumScaffold(
        title = thread?.discussion?.title ?: "আলোচনা",
        subtitle = thread?.discussion?.categoryTitle,
        onBackClick = onBackClick,
        testTag = "forum_thread_screen"
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                loading && thread == null -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) { CircularProgressIndicator() }

                thread == null -> ErrorState(
                    message = error ?: "আলোচনা পাওয়া যায়নি।",
                    onRetry = { reloadToken += 1 }
                )

                else -> {
                    val loaded = thread!!
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .imePadding(),
                        contentPadding = PaddingValues(bottom = 32.dp),
                        verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
                    ) {
                        item { ForumOpeningPost(loaded.discussion) }

                        item {
                            ForumSectionTitle(
                                title = if (loaded.replies.isEmpty()) "এখনো কোনো উত্তর নেই" else "উত্তরসমূহ",
                                count = loaded.replies.size.takeIf { it > 0 }
                            )
                        }

                        items(loaded.replies, key = { "reply-${it.id}" }) { reply ->
                            ForumReplyCard(reply)
                        }

                        item {
                            ForumReplyComposer(
                                draft = draft,
                                onDraftChange = {
                                    draft = it
                                    postError = null
                                },
                                problem = draftProblem,
                                isSignedIn = isSignedIn,
                                refused = refused,
                                posting = posting,
                                canPost = canPost,
                                error = postError,
                                onSignInClick = onSignInClick,
                                onPost = {
                                    posting = true
                                    postError = null
                                    refused = false
                                    postReply(discussionId, draft)
                                        .onSuccess {
                                            draft = ""
                                            // Re-read the thread without counting a
                                            // second view, so the new answer appears
                                            // among the others in its real place.
                                            loadThread(discussionId, false)
                                                .onSuccess { fresh -> thread = fresh }
                                        }
                                        .onFailure { failure ->
                                            refused = failure is PortalError.SignedOut
                                            postError = if (refused) {
                                                PortalError.SignedOut.SESSION_EXPIRED
                                            } else {
                                                failure.message ?: "উত্তর পাঠানো যায়নি।"
                                            }
                                        }
                                    posting = false
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// A new discussion
// ---------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewDiscussionScreen(
    preselectSlug: String,
    isSignedIn: Boolean,
    loadCategories: suspend () -> Result<List<ForumCategory>>,
    post: suspend (String, String, String) -> Result<ForumThread>,
    onBackClick: () -> Unit,
    onPosted: (String) -> Unit,
    onSignInClick: () -> Unit
) {
    var categories by remember { mutableStateOf<List<ForumCategory>?>(null) }
    LaunchedEffect(Unit) {
        loadCategories().onSuccess { categories = it }
    }
    val selectable = remember(categories) { categories.orEmpty().filter { !it.isLocked } }
    var categorySlug by remember(preselectSlug, selectable) {
        mutableStateOf(
            preselectSlug.takeIf { slug -> selectable.any { it.slug == slug } }
                ?: selectable.firstOrNull()?.slug.orEmpty()
        )
    }
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var posting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var refused by remember { mutableStateOf(false) }

    val titleProblem = ForumText.titleProblem(title)
    val bodyProblem = ForumText.bodyProblem(body)
    val canPost = isSignedIn && categorySlug.isNotBlank() && titleProblem == null &&
        bodyProblem == null && !posting

    ForumScaffold(
        title = "নতুন আলোচনা",
        subtitle = null,
        onBackClick = onBackClick,
        testTag = "forum_new_screen"
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding(),
            contentPadding = PaddingValues(
                start = EditorialSpace.gutter,
                end = EditorialSpace.gutter,
                top = EditorialSpace.sm,
                bottom = EditorialSpace.xl
            ),
            verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
        ) {
            if (!isSignedIn) {
                item { ForumSignInPrompt(onSignInClick) }
            }

            if (categories == null) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = EditorialSpace.md),
                        contentAlignment = Alignment.Center
                    ) { CircularProgressIndicator() }
                }
            }

            item {
                // Five rooms: chips show every choice at once and need no menu,
                // which is also one less API to get wrong in a build I cannot run.
                Column {
                    Text(
                        text = "বিভাগ",
                        fontFamily = Kalpurush,
                        fontSize = 12.5.sp,
                        color = LocalEditorialTokens.current.inkMuted
                    )
                    Spacer(Modifier.height(6.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .testTag("forum_new_category"),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        selectable.forEach { option ->
                            FilterChip(
                                selected = option.slug == categorySlug,
                                onClick = { categorySlug = option.slug },
                                label = {
                                    Text(
                                        text = option.title,
                                        fontFamily = Kalpurush,
                                        fontSize = 13.sp
                                    )
                                }
                            )
                        }
                    }
                }
            }

            item {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("শিরোনাম *", fontFamily = Kalpurush) },
                    supportingText = {
                        Text(
                            text = titleProblem ?: "${toBengaliNumeral(ForumText.units(title))}/" +
                                toBengaliNumeral(ForumText.TITLE_MAX),
                            fontFamily = Kalpurush,
                            color = if (titleProblem != null) MaterialTheme.colorScheme.error
                            else LocalEditorialTokens.current.inkMuted
                        )
                    },
                    isError = titleProblem != null,
                    singleLine = true,
                    textStyle = EditorialTextFieldStyle,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("forum_new_title")
                )
            }

            item {
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text("আলোচনার কথা *", fontFamily = Kalpurush) },
                    supportingText = {
                        Text(
                            text = bodyProblem ?: "${toBengaliNumeral(ForumText.units(body))} অক্ষর",
                            fontFamily = Kalpurush,
                            color = if (bodyProblem != null) MaterialTheme.colorScheme.error
                            else LocalEditorialTokens.current.inkMuted
                        )
                    },
                    isError = bodyProblem != null,
                    minLines = 6,
                    maxLines = 14,
                    textStyle = EditorialTextFieldStyle,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("forum_new_body")
                )
            }

            if (error != null) {
                item {
                    Text(
                        text = error.orEmpty(),
                        fontFamily = Kalpurush,
                        fontSize = 12.5.sp,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag("forum_new_error")
                    )
                }
            }

            item {
                Button(
                    onClick = {
                        posting = true
                        error = null
                        refused = false
                        post(categorySlug, title, body)
                            .onSuccess { created -> onPosted(created.discussion.id) }
                            .onFailure { failure ->
                                refused = failure is PortalError.SignedOut
                                error = when {
                                    refused -> PortalError.SignedOut.SESSION_EXPIRED
                                    // The database's own refusal wording is a rule,
                                    // not a bug: "at least 4 characters" is worth
                                    // showing, unlike a transport failure.
                                    failure is PortalError.Http && failure.code == 400 -> failure.message
                                    else -> failure.message ?: "আলোচনা খোলা যায়নি।"
                                }
                            }
                        posting = false
                    },
                    enabled = canPost,
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = Color.White
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("forum_new_submit")
                ) {
                    if (posting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = Color.White
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    Text("প্রকাশ করুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** The page frame every forum screen uses: a back arrow, a title, a subtitle. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ForumScaffold(
    title: String,
    subtitle: String?,
    onBackClick: () -> Unit,
    testTag: String,
    floatingAction: (@Composable () -> Unit)? = null,
    content: @Composable (PaddingValues) -> Unit
) {
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
                        if (!subtitle.isNullOrBlank()) {
                            Text(
                                text = subtitle,
                                fontFamily = Kalpurush,
                                fontSize = 11.5.sp,
                                color = LocalEditorialTokens.current.inkMuted,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBackClick, modifier = Modifier.testTag("${testTag}_back")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "পেছনে")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        },
        floatingActionButton = { floatingAction?.invoke() },
        containerColor = MaterialTheme.colorScheme.background,
        modifier = Modifier.testTag(testTag)
    ) { padding -> content(padding) }
}

@Composable
private fun ForumSectionTitle(title: String, count: Int? = null) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                start = EditorialSpace.gutter,
                end = EditorialSpace.gutter,
                top = EditorialSpace.sm,
                bottom = EditorialSpace.xxs
            ),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            fontFamily = Kalpurush,
            fontWeight = FontWeight.Bold,
            fontSize = 15.5.sp,
            color = MaterialTheme.colorScheme.onSurface
        )
        if (count != null) {
            Spacer(Modifier.width(6.dp))
            Text(
                text = toBengaliNumeral(count),
                fontFamily = Kalpurush,
                fontSize = 12.sp,
                color = LocalEditorialTokens.current.inkMuted
            )
        }
    }
}

/** The search box: three keystrokes minimum, and a clear button that clears. */
@Composable
private fun ForumSearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    searching: Boolean,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        placeholder = { Text("আলোচনা খুঁজুন", fontFamily = Kalpurush) },
        leadingIcon = {
            Icon(
                imageVector = Icons.Default.Search,
                contentDescription = null,
                tint = LocalEditorialTokens.current.inkMuted
            )
        },
        trailingIcon = {
            when {
                searching -> CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    strokeWidth = 2.dp
                )

                query.isNotEmpty() -> IconButton(onClick = { onQueryChange("") }) {
                    Icon(
                        imageVector = Icons.Default.Clear,
                        contentDescription = "মুছুন",
                        tint = LocalEditorialTokens.current.inkMuted
                    )
                }
            }
        },
        singleLine = true,
        textStyle = EditorialTextFieldStyle,
        shape = RoundedCornerShape(12.dp),
        modifier = modifier
            .fillMaxWidth()
            .testTag("forum_search")
    )
}

@Composable
private fun ForumCategoryCard(category: ForumCategory, onClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(EditorialShape.card),
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .clickable(onClick = onClick)
            .testTag("forum_category_${category.slug}")
    ) {
        Row(
            modifier = Modifier.padding(EditorialSpace.md),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(tokens.accentSoft),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = if (category.isLocked) Icons.Default.Lock else Icons.Default.Forum,
                    contentDescription = null,
                    tint = tokens.accent,
                    modifier = Modifier.size(20.dp)
                )
            }
            Spacer(Modifier.width(EditorialSpace.sm))
            Column(Modifier.weight(1f)) {
                Text(
                    text = category.title,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (category.description.isNotBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = category.description,
                        fontFamily = Kalpurush,
                        fontSize = 12.sp,
                        color = tokens.inkMuted,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            Spacer(Modifier.width(EditorialSpace.xs))
            ForumCounters(discussions = category.discussions, replies = category.replies)
        }
    }
}

/** One discussion, wherever it is listed. */
@Composable
private fun ForumDiscussionCard(discussion: ForumDiscussion, onClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(EditorialShape.card),
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .clickable(onClick = onClick)
            .testTag("forum_discussion_${discussion.id}")
    ) {
        Column(Modifier.padding(EditorialSpace.md)) {
            Text(
                text = discussion.categoryTitle,
                fontFamily = Kalpurush,
                fontSize = 11.sp,
                color = tokens.accent,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = discussion.title,
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 15.5.sp,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            if (discussion.excerpt.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = discussion.excerpt,
                    fontFamily = Kalpurush,
                    fontSize = 12.5.sp,
                    lineHeight = 19.sp,
                    color = tokens.inkMuted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Spacer(Modifier.height(EditorialSpace.sm))
            Row(verticalAlignment = Alignment.CenterVertically) {
                ForumAvatar(url = discussion.authorAvatarUrl, name = discussion.authorName, size = 22)
                Spacer(Modifier.width(6.dp))
                Text(
                    text = discussion.authorName,
                    fontFamily = Kalpurush,
                    fontSize = 12.sp,
                    color = tokens.inkSoft,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = formatBengaliDate(discussion.lastActivityAt.ifBlank { discussion.createdAt }),
                    fontFamily = Kalpurush,
                    fontSize = 11.5.sp,
                    color = tokens.inkMuted,
                    maxLines = 1
                )
                Spacer(Modifier.weight(1f))
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

/** Views and replies, as counters with their icons. */
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
        // A thread nobody has answered yet reads differently from one that has:
        // the reply count is the only counter whose colour means something.
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

/** A circle with a face, or the first letter when there is no face. */
@Composable
private fun ForumAvatar(url: String, name: String, size: Int) {
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(LocalEditorialTokens.current.surfaceSunken),
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
                fontSize = (size * 0.45f).sp,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Composable
private fun ForumCountsRow(discussions: Int, replies: Int, locked: Boolean) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(EditorialShape.card),
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.xs)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = EditorialSpace.md, vertical = EditorialSpace.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(EditorialSpace.md)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Forum,
                    contentDescription = null,
                    tint = tokens.accent,
                    modifier = Modifier.size(15.dp)
                )
                Spacer(Modifier.width(5.dp))
                Text(
                    text = "${toBengaliNumeral(discussions)} আলোচনা",
                    fontFamily = Kalpurush,
                    fontSize = 12.5.sp,
                    color = tokens.inkSoft
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.ChatBubbleOutline,
                    contentDescription = null,
                    tint = tokens.accent,
                    modifier = Modifier.size(15.dp)
                )
                Spacer(Modifier.width(5.dp))
                Text(
                    text = "${toBengaliNumeral(replies)} উত্তর",
                    fontFamily = Kalpurush,
                    fontSize = 12.5.sp,
                    color = tokens.inkSoft
                )
            }
            if (locked) {
                Spacer(Modifier.weight(1f))
                Text(
                    text = "বন্ধ",
                    fontFamily = Kalpurush,
                    fontSize = 12.sp,
                    color = tokens.inkMuted
                )
            }
        }
    }
}

/** The opening post: who wrote it, when, and what it says. */
@Composable
private fun ForumOpeningPost(discussion: ForumDiscussion) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(EditorialShape.card),
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.xs)
    ) {
        Column(Modifier.padding(EditorialSpace.md)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ForumAvatar(url = discussion.authorAvatarUrl, name = discussion.authorName, size = 36)
                Spacer(Modifier.width(EditorialSpace.sm))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = discussion.authorName,
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = formatBengaliDate(discussion.createdAt),
                        fontFamily = Kalpurush,
                        fontSize = 11.5.sp,
                        color = tokens.inkMuted
                    )
                }
                ForumCounters(
                    discussions = discussion.views,
                    replies = discussion.replies,
                    views = true
                )
            }
            Spacer(Modifier.height(EditorialSpace.sm))
            Text(
                text = discussion.body.ifBlank { discussion.excerpt },
                fontFamily = Kalpurush,
                fontSize = 14.5.sp,
                lineHeight = 24.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }
}

@Composable
private fun ForumReplyCard(reply: ForumReply) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(EditorialShape.card),
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .testTag("forum_reply_${reply.id}")
    ) {
        Column(Modifier.padding(EditorialSpace.md)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ForumAvatar(url = reply.authorAvatarUrl, name = reply.authorName, size = 28)
                Spacer(Modifier.width(EditorialSpace.xs))
                Text(
                    text = reply.authorName,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    text = formatBengaliDate(reply.createdAt),
                    fontFamily = Kalpurush,
                    fontSize = 11.5.sp,
                    color = tokens.inkMuted
                )
            }
            Spacer(Modifier.height(EditorialSpace.xs))
            Text(
                text = reply.body,
                fontFamily = Kalpurush,
                fontSize = 14.sp,
                lineHeight = 23.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }
}

/** The box under a thread: write an answer, or the way in to be able to. */
@Composable
private fun ForumReplyComposer(
    draft: String,
    onDraftChange: (String) -> Unit,
    problem: String?,
    isSignedIn: Boolean,
    refused: Boolean,
    posting: Boolean,
    canPost: Boolean,
    error: String?,
    onSignInClick: () -> Unit,
    onPost: () -> Unit
) {
    val tokens = LocalEditorialTokens.current
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(EditorialShape.card),
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.xs)
    ) {
        Column(Modifier.padding(EditorialSpace.md)) {
            if (!isSignedIn) {
                ForumSignInPrompt(onSignInClick)
                return@Column
            }

            if (refused) {
                Text(
                    text = PortalError.SignedOut.SESSION_EXPIRED,
                    fontFamily = Kalpurush,
                    fontSize = 12.5.sp,
                    color = MaterialTheme.colorScheme.error
                )
                Spacer(Modifier.height(EditorialSpace.xs))
                TextButton(onClick = onSignInClick, modifier = Modifier.testTag("forum_reply_sign_in")) {
                    Text("সাইন ইন করুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                }
                return@Column
            }

            OutlinedTextField(
                value = draft,
                onValueChange = onDraftChange,
                label = { Text("আপনার উত্তর", fontFamily = Kalpurush) },
                supportingText = {
                    Text(
                        text = problem ?: "${toBengaliNumeral(ForumText.units(draft))}/" +
                            toBengaliNumeral(ForumText.REPLY_MAX),
                        fontFamily = Kalpurush,
                        color = if (problem != null) MaterialTheme.colorScheme.error else tokens.inkMuted
                    )
                },
                isError = problem != null,
                minLines = 3,
                maxLines = 8,
                textStyle = EditorialTextFieldStyle,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("forum_reply_field")
            )
            if (error != null && !refused) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = error,
                    fontFamily = Kalpurush,
                    fontSize = 12.5.sp,
                    color = MaterialTheme.colorScheme.error
                )
            }
            Spacer(Modifier.height(EditorialSpace.xs))
            Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = onPost,
                    enabled = canPost,
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = tokens.accent,
                        contentColor = Color.White
                    ),
                    modifier = Modifier.testTag("forum_reply_submit")
                ) {
                    if (posting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(14.dp),
                            strokeWidth = 2.dp,
                            color = Color.White
                        )
                        Spacer(Modifier.width(6.dp))
                    } else {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.Send,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(Modifier.width(6.dp))
                    }
                    Text("উত্তর দিন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun ForumSignInPrompt(onSignInClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = EditorialSpace.xs)
    ) {
        Text(
            text = "লিখতে সাইন ইন করা লাগবে — পড়ার জন্য লাগবে না।",
            fontFamily = Kalpurush,
            fontSize = 13.sp,
            color = tokens.inkMuted
        )
        Spacer(Modifier.height(EditorialSpace.xs))
        Button(
            onClick = onSignInClick,
            shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = Color.White
            ),
            modifier = Modifier.testTag("forum_sign_in")
        ) {
            Text("সাইন ইন করুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
        }
    }
}

/** The field style the reader's forms use, so the forum matches them. */
private val EditorialTextFieldStyle = TextStyle(
    fontFamily = Kalpurush,
    fontSize = 14.sp
)
