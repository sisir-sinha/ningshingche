package com.ningshingche.app.ui.screens

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.Article
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Comment
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Mail
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Publish
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.ningshingche.app.data.remote.AdminMessageRecord
import com.ningshingche.app.data.remote.CommentRecord
import com.ningshingche.app.data.remote.ImgBbUploader
import com.ningshingche.app.data.remote.SubmittedBlogRecord
import com.ningshingche.app.data.remote.SubmittedMusicRecord
import com.ningshingche.app.data.remote.UserNotificationRecord
import com.ningshingche.app.data.portal.MusicTrack
import com.ningshingche.app.data.portal.ViewDay
import com.ningshingche.app.data.remote.UserProfile
import com.ningshingche.app.data.remote.messageAttachmentUrls
import com.ningshingche.app.data.remote.shortDateTime
import com.ningshingche.app.ui.components.AppToasts
import com.ningshingche.app.ui.editorial.Hairline
import com.ningshingche.app.ui.editorial.toBengaliNumeral
import com.ningshingche.app.ui.components.LocalMusicController
import com.ningshingche.app.ui.reader.RichHtmlArticleBody
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.viewmodel.ReaderMetrics
import com.ningshingche.app.ui.viewmodel.ReaderWorkspaceViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

private const val PAGE_SIZE = 5
private const val MESSAGE_WINDOW = 10
private const val TAB_HOME = 0
private const val TAB_NOTICES = 1
private const val TAB_MESSAGES = 2
private const val TAB_CONTENT = 3
private const val TAB_COMMENTS = 4
private val TickGreen = Color(0xFF25D366)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserDashboardScreen(
    viewModel: ReaderWorkspaceViewModel,
    onBackClick: () -> Unit,
    onCompleteProfile: () -> Unit,
    onNewArticle: () -> Unit,
    onNewMusic: () -> Unit = {},
    // Suspends until the article route knows whether it has somewhere to go:
    // `false` means the submission has nothing published behind it, and the
    // dashboard shows its own preview instead.
    onOpenArticle: suspend (SubmittedBlogRecord) -> Boolean = { false },
    onOpenComment: (CommentRecord) -> Unit = {},
    initialTab: Int = 0,
    focusMessageId: String = "",
    focusContentId: String = "",
    focusCommentId: String = ""
) {
    val user by viewModel.currentUser.collectAsStateWithLifecycle()
    val articles by viewModel.articles.collectAsStateWithLifecycle()
    val tracks by viewModel.tracks.collectAsStateWithLifecycle()
    val comments by viewModel.comments.collectAsStateWithLifecycle()
    val notifications by viewModel.notifications.collectAsStateWithLifecycle()
    val messages by viewModel.adminMessages.collectAsStateWithLifecycle()
    val metrics by viewModel.metrics.collectAsStateWithLifecycle()
    val viewSeries by viewModel.viewSeries.collectAsStateWithLifecycle()
    val loading by viewModel.isLoading.collectAsStateWithLifecycle()
    val saving by viewModel.isSaving.collectAsStateWithLifecycle()
    val status by viewModel.message.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val pagerState = rememberPagerState(
        initialPage = initialTab.coerceIn(0, TAB_COMMENTS),
        pageCount = { 5 }
    )
    // Focus targets for the action tabs. Seeded from the navigation
    // arguments when the dashboard is opened from another screen and
    // updated by [openNotice] when a notice is tapped inside the
    // dashboard itself.
    var messageFocus by remember { mutableStateOf(focusMessageId) }
    var contentFocus by remember { mutableStateOf(focusContentId) }
    var commentFocus by remember { mutableStateOf(focusCommentId) }
    var fabOpen by remember { mutableStateOf(false) }
    val noticeUnread = notifications.count { !it.isRead }
    val onNoticesTab = pagerState.currentPage == TAB_NOTICES
    val onMessagesTab = pagerState.currentPage == TAB_MESSAGES
    val onContentTab = pagerState.currentPage == TAB_CONTENT

    LaunchedEffect(user?.id) {
        if (user != null) viewModel.refresh()
    }
    // Seeing the list is what clears the counter — the badge used to stay lit
    // until every card had been tapped one by one. Keyed on the unread count,
    // not just the tab, so a background inbox refresh that re-lights the badge
    // is cleared again while the page is still on screen.
    //
    // Waiting for the swipe to settle is what makes this safe with the tabs
    // swipeable: a page the pager is still travelling over is not a page the
    // reader has arrived at, so a hand that keeps moving past Notices no longer
    // clears the whole inbox on the way.
    val restingOnNotices = onNoticesTab && !pagerState.isScrollInProgress
    val messageUnread = messages.count { it.isFromAdmin && !it.isRead }
    LaunchedEffect(restingOnNotices, noticeUnread) {
        if (restingOnNotices && noticeUnread > 0) viewModel.markAllNotificationsRead()
    }
    LaunchedEffect(onMessagesTab, messageUnread) {
        if (onMessagesTab && messageUnread > 0) viewModel.markAdminMessagesRead()
    }
    // A tapped notice slides the pager to its own tab (like a manual
    // swipe) and focuses + highlights the matching card there instead of
    // pushing a second dashboard screen on top.
    val openNotice: (UserNotificationRecord) -> Unit = { notice ->
        viewModel.markNotificationRead(notice.id)
        val targetTab = when {
            notice.isAdminMessage || notice.kind == "staff_notice" -> TAB_MESSAGES
            notice.isComment -> TAB_COMMENTS
            else -> TAB_CONTENT
        }
        when (targetTab) {
            TAB_MESSAGES -> messageFocus = notice.relatedId
            TAB_COMMENTS -> commentFocus = notice.relatedId
            else -> contentFocus = notice.relatedId
        }
        scope.launch { pagerState.animateScrollToPage(targetTab) }
    }
    LaunchedEffect(initialTab) {
        pagerState.scrollToPage(initialTab.coerceIn(0, TAB_COMMENTS))
    }
    LaunchedEffect(onContentTab) {
        if (!onContentTab) fabOpen = false
    }
    BackHandler(enabled = onNoticesTab) {
        scope.launch { pagerState.animateScrollToPage(TAB_HOME) }
    }

    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(status) {
        val text = status ?: return@LaunchedEffect
        if (text.isBlank()) return@LaunchedEffect
        snackbarHostState.showSnackbar(text)
        viewModel.clearMessage()
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Dashboard, contentDescription = null)
                        Text(
                            "আমার ড্যাশবোর্ড",
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier
                                .weight(1f)
                                .padding(start = 8.dp, end = 4.dp)
                        )
                        IconButton(
                            onClick = {
                                scope.launch {
                                    if (pagerState.currentPage == TAB_NOTICES) {
                                        pagerState.animateScrollToPage(TAB_HOME)
                                    } else {
                                        pagerState.animateScrollToPage(TAB_NOTICES)
                                    }
                                }
                            },
                            modifier = Modifier.testTag("user_dashboard_notices")
                        ) {
                            BadgedBox(
                                badge = {
                                    if (noticeUnread > 0) {
                                        Badge {
                                            Text(
                                                if (noticeUnread > 99) "99+" else noticeUnread.toString(),
                                                fontSize = 10.sp
                                            )
                                        }
                                    }
                                }
                            ) {
                                Icon(
                                    Icons.Default.Notifications,
                                    contentDescription = "বিজ্ঞপ্তি",
                                    // The bell is the notifications page itself, so while that
                                    // page is on screen it switches to the accent colour to
                                    // show the current tab instead of looking idle.
                                    tint = if (onNoticesTab) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    }
                                )
                            }
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBackClick, modifier = Modifier.testTag("user_dashboard_back")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "ফিরুন")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)
            )
        },
        floatingActionButton = {
            if (onContentTab) {
                Column(
                    horizontalAlignment = Alignment.End,
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    AnimatedVisibility(visible = fabOpen, enter = fadeIn() + scaleIn(), exit = fadeOut() + scaleOut()) {
                        Column(
                            horizontalAlignment = Alignment.End,
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            SpeedDialItem("প্রবন্ধ যোগ", Icons.AutoMirrored.Filled.Article) {
                                fabOpen = false
                                if (user?.isProfileComplete == true) onNewArticle() else onCompleteProfile()
                            }
                            SpeedDialItem("গান যোগ", Icons.Default.LibraryMusic) {
                                fabOpen = false
                                if (user?.isProfileComplete == true) onNewMusic() else onCompleteProfile()
                            }
                        }
                    }
                    FloatingActionButton(
                        onClick = { fabOpen = !fabOpen },
                        modifier = Modifier.testTag("user_dashboard_new_article")
                    ) {
                        Icon(
                            if (fabOpen) Icons.Default.Close else Icons.Default.Add,
                            contentDescription = "যোগ করুন"
                        )
                    }
                }
            }
        },
        bottomBar = {
            DashboardBottomBar(
                selected = pagerState.currentPage,
                onSelect = { page -> scope.launch { pagerState.animateScrollToPage(page) } }
            )
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = loading,
            onRefresh = { viewModel.refresh() },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
        ) {
            // Tabs swipe again, the way they do everywhere else in the app.
            // The reason swiping was switched off — a hand travelling past the
            // notices list marked the whole inbox read — is handled by the
            // settling check above instead of by taking the gesture away.
            HorizontalPager(
                state = pagerState,
                userScrollEnabled = true,
                modifier = Modifier.fillMaxSize()
            ) { page ->
                when (page) {
                    TAB_HOME -> HomePane(
                        user = user,
                        metrics = metrics,
                        viewSeries = viewSeries,
                        viewSeriesDays = viewModel.viewSeriesDays,
                        articles = articles,
                        tracks = tracks,
                        comments = comments,
                        onEditProfile = onCompleteProfile
                    )
                    TAB_NOTICES -> NoticePane(notifications, openNotice)
                    TAB_MESSAGES -> MessagePane(
                        messages = messages,
                        saving = saving,
                        focusMessageId = messageFocus,
                        onSend = { body -> viewModel.sendAdminMessage(body) },
                        onReload = { viewModel.refreshInbox(markSeen = false) }
                    )
                    TAB_CONTENT -> ContentPane(
                        articles = articles,
                        tracks = tracks,
                        focusId = contentFocus,
                        onOpenArticle = onOpenArticle,
                    )
                    else -> CommentPane(
                        comments = comments,
                        focusId = commentFocus,
                        onOpen = onOpenComment
                    )
                }
            }
        }
    }
}

@Composable
private fun SpeedDialItem(label: String, icon: ImageVector, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Surface(shape = RoundedCornerShape(8.dp), tonalElevation = 3.dp) {
            Text(
                label,
                fontFamily = Kalpurush,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
            )
        }
        SmallFloatingActionButton(onClick = onClick) {
            Icon(icon, contentDescription = label)
        }
    }
}

@Composable
private fun DashboardBottomBar(
    selected: Int,
    onSelect: (Int) -> Unit
) {
    NavigationBar {
        NavigationBarItem(
            selected = selected == TAB_HOME,
            onClick = { onSelect(TAB_HOME) },
            icon = { Icon(Icons.Default.Home, contentDescription = null) },
            label = { Text("ঘর", fontFamily = Kalpurush, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        )
        NavigationBarItem(
            selected = selected == TAB_MESSAGES,
            onClick = { onSelect(TAB_MESSAGES) },
            icon = { Icon(Icons.Default.Mail, contentDescription = null) },
            label = { Text("বার্তা", fontFamily = Kalpurush, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        )
        NavigationBarItem(
            selected = selected == TAB_CONTENT,
            onClick = { onSelect(TAB_CONTENT) },
            icon = { Icon(Icons.AutoMirrored.Filled.Article, contentDescription = null) },
            label = { Text("কন্টেন্ট", fontFamily = Kalpurush, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        )
        NavigationBarItem(
            selected = selected == TAB_COMMENTS,
            onClick = { onSelect(TAB_COMMENTS) },
            icon = { Icon(Icons.Default.Comment, contentDescription = null) },
            label = { Text("মন্তব্য", fontFamily = Kalpurush, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        )
    }
}

@Composable
private fun HomePane(
    user: UserProfile?,
    metrics: ReaderMetrics,
    viewSeries: List<ViewDay>,
    viewSeriesDays: Int,
    articles: List<SubmittedBlogRecord>,
    tracks: List<SubmittedMusicRecord>,
    comments: List<CommentRecord>,
    onEditProfile: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        UserInfoCard(user = user, onEditProfile = onEditProfile)
        if (user?.isProfileComplete != true) {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "প্রোফাইল অসম্পূর্ণ। নতুন প্রবন্ধ বা গান জমা দিতে আগে প্রোফাইল পূরণ করুন।",
                        fontFamily = Kalpurush
                    )
                    Button(onClick = onEditProfile, modifier = Modifier.testTag("complete_profile_cta")) {
                        Text("প্রোফাইল সম্পাদনা", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        MetricsGrid(metrics = metrics)
        // The one graph that comes from the server: the views the database has
        // counted on the reader's articles and songs, day by day.
        ViewsOverTimeChart(
            series = viewSeries,
            totalViews = metrics.totalViews,
            days = viewSeriesDays
        )
        // Graphs of the reader's own records, drawn from the same local lists
        // the tabs show — no extra requests.
        ContributionCharts(
            articles = articles,
            tracks = tracks,
            comments = comments
        )
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun NoticePane(
    notifications: List<UserNotificationRecord>,
    onOpen: (UserNotificationRecord) -> Unit
) {
    var limit by remember { mutableIntStateOf(PAGE_SIZE) }
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        if (notifications.isEmpty()) {
            item { EmptyHint("এখনো কোনো বিজ্ঞপ্তি নেই। প্রবন্ধ বা মন্তব্য প্রকাশিত হলে এখানে দেখাবে।") }
        } else {
            items(notifications.take(limit), key = { "n-${it.id}" }) { notice ->
                NotificationCard(notice = notice, onOpen = { onOpen(notice) })
            }
            if (limit < notifications.size) {
                item {
                    OutlinedButton(
                        onClick = { limit = (limit + PAGE_SIZE).coerceAtMost(notifications.size) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("আরও দেখুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(88.dp)) }
    }
}

private enum class ContentFilter { All, Articles, Songs }

@Composable
private fun ContentPane(
    articles: List<SubmittedBlogRecord>,
    tracks: List<SubmittedMusicRecord>,
    focusId: String = "",
    onOpenArticle: suspend (SubmittedBlogRecord) -> Boolean
) {
    var limit by remember { mutableIntStateOf(PAGE_SIZE) }
    var filter by remember { mutableStateOf(ContentFilter.All) }
    // The card whose preview is open, if any. A preview stands in for the
    // article screen until the piece is published, so it never pushes a route.
    var preview by remember { mutableStateOf<SubmittedBlogRecord?>(null) }
    val scope = rememberCoroutineScope()
    val player = LocalMusicController.current
    // Songs are catalogue rows, so the dashboard's own list is the queue the
    // player opens with.
    val musicQueue = remember(tracks) { tracks.map { it.toMusicTrack() } }
    val rows = remember(articles, tracks, filter) {
        val articleRows = if (filter != ContentFilter.Songs) {
            articles.map {
                ContentRow(it.id, false, it.title, it.writerName, it.status, it.thumbnail, it, null, it.createdAt)
            }
        } else emptyList()
        val musicRows = if (filter != ContentFilter.Articles) {
            tracks.map {
                ContentRow(
                    id = it.id,
                    isMusic = true,
                    title = it.title,
                    subtitle = listOf(it.artist, it.album).filter { s -> s.isNotBlank() }.joinToString(" · ").ifBlank { "গান" },
                    // A song in the catalogue is live in the app's music screen,
                    // which is also where tapping the row sends the reader.
                    status = "Published",
                    thumbnail = it.thumbnailUrl,
                    article = null,
                    music = it,
                    createdAt = it.createdAt
                )
            }
        } else emptyList()
        (articleRows + musicRows).sortedByDescending { it.createdAt }
    }
    val listState = rememberLazyListState()
    // Highlight the focused card (opened from a notice) until it fades.
    var highlightOn by remember(focusId) { mutableStateOf(focusId.isNotBlank()) }

    // Widen the page window so the focused card is visible without
    // tapping "আরও দেখুন" first.
    LaunchedEffect(focusId, rows) {
        if (focusId.isBlank()) return@LaunchedEffect
        val idx = rows.indexOfFirst { it.id == focusId }
        if (idx >= 0 && idx >= limit) limit = (idx + 1).coerceAtMost(rows.size)
    }
    // Scroll once the focused card is inside the rendered window.
    LaunchedEffect(focusId, rows, limit) {
        if (focusId.isBlank()) return@LaunchedEffect
        val idx = rows.indexOfFirst { it.id == focusId }
        if (idx in 0 until minOf(rows.size, limit)) {
            listState.animateScrollToItem(idx)
        }
    }
    LaunchedEffect(focusId) {
        if (focusId.isBlank()) return@LaunchedEffect
        delay(3000)
        highlightOn = false
    }
    LazyColumn(
        state = listState,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(
                    selected = filter == ContentFilter.All,
                    onClick = { filter = ContentFilter.All; limit = PAGE_SIZE },
                    label = { Text("সব", fontFamily = Kalpurush) }
                )
                FilterChip(
                    selected = filter == ContentFilter.Articles,
                    onClick = { filter = ContentFilter.Articles; limit = PAGE_SIZE },
                    label = { Text("প্রবন্ধ", fontFamily = Kalpurush) },
                    leadingIcon = {
                        Icon(Icons.AutoMirrored.Filled.Article, contentDescription = null, modifier = Modifier.size(16.dp))
                    }
                )
                FilterChip(
                    selected = filter == ContentFilter.Songs,
                    onClick = { filter = ContentFilter.Songs; limit = PAGE_SIZE },
                    label = { Text("গান", fontFamily = Kalpurush) },
                    leadingIcon = {
                        Icon(Icons.Default.MusicNote, contentDescription = null, modifier = Modifier.size(16.dp))
                    }
                )
            }
        }
        if (rows.isEmpty()) {
            item {
                EmptyHint(
                    when (filter) {
                        ContentFilter.Articles -> "এখনো কোনো প্রবন্ধ জমা দেননি।"
                        ContentFilter.Songs -> "এখনো কোনো গান জমা দেননি।"
                        ContentFilter.All -> "এখনো কোনো প্রবন্ধ বা গান জমা দেননি।"
                    }
                )
            }
        } else {
            items(rows.take(limit), key = { it.id }) { row ->
                ContentCard(
                    row = row,
                    highlighted = highlightOn && row.id == focusId,
                    onOpen = {
                        val article = row.article
                        when {
                            article == null -> {
                                // A song: open it where the app keeps it — the
                                // player, with the dashboard's songs as the queue.
                                val track = row.music?.toMusicTrack() ?: return@ContentCard
                                if (track.hasPlayableSource()) {
                                    player.play(track, musicQueue.ifEmpty { listOf(track) }, expand = true)
                                } else {
                                    AppToasts.show("এই গানের অডিও ফাইল নেই।")
                                }
                            }
                            isPublishedStatus(article.status) -> scope.launch {
                                // Published: straight into the app. If the blog
                                // cannot be opened after all — the conversion can
                                // still be sitting as a draft — the preview is a
                                // better landing than an error screen.
                                if (!onOpenArticle(article)) preview = article
                            }
                            else -> preview = article
                        }
                    }
                )
            }
            if (limit < rows.size) {
                item {
                    OutlinedButton(
                        onClick = { limit = (limit + PAGE_SIZE).coerceAtMost(rows.size) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("আরও দেখুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(88.dp)) }
    }

    preview?.let { article ->
        ArticlePreviewDialog(article = article, onDismiss = { preview = null })
    }
}

/**
 * How a submission will look once it is published.
 *
 * The card in the list carries a status, and a reader who taps a piece that is
 * still pending needs to see what they sent rather than an error, so the same
 * body renderer the article screen uses draws the submission here.
 */
@Composable
private fun ArticlePreviewDialog(article: SubmittedBlogRecord, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.surface,
            modifier = Modifier
                .fillMaxWidth(0.94f)
                .fillMaxHeight(0.92f)
                .testTag("content_preview_dialog")
        ) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 16.dp, end = 6.dp, top = 10.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "এভাবে প্রকাশিত হবে",
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        modifier = Modifier.weight(1f)
                    )
                    ContentStatusChip(status = article.status)
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "বন্ধ করুন")
                    }
                }
                Hairline()
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    if (article.thumbnail.isNotBlank()) {
                        AsyncImage(
                            model = article.thumbnail,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(180.dp)
                                .clip(RoundedCornerShape(12.dp))
                        )
                    }
                    Text(
                        text = article.title.ifBlank { "শিরোনামহীন" },
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 21.sp,
                        lineHeight = 30.sp
                    )
                    if (article.contentTitle.isNotBlank()) {
                        Text(
                            text = article.contentTitle,
                            fontFamily = Kalpurush,
                            fontSize = 15.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Text(
                        text = listOf(article.writerName, article.writerDesignation)
                            .filter { it.isNotBlank() }
                            .joinToString(" · "),
                        fontFamily = Kalpurush,
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Hairline()
                    RichHtmlArticleBody(
                        html = article.content,
                        fontSizeSp = 16f,
                        lineSpacingMultiplier = 1.35f,
                        // Nothing to open inside a preview: the body is there
                        // to be read, and a link in a submission that is not
                        // live should not walk the reader out of the dashboard.
                        onOpenLink = { AppToasts.show("প্রকাশিত হলে লিংকটি কাজ করবে।") }
                    )
                    Spacer(Modifier.height(20.dp))
                }
            }
        }
    }
}

private data class ContentRow(
    val id: String,
    val isMusic: Boolean,
    val title: String,
    val subtitle: String,
    /** Raw moderation status; the chip on the card is what translates it. */
    val status: String,
    val thumbnail: String,
    val article: SubmittedBlogRecord?,
    val music: SubmittedMusicRecord?,
    val createdAt: String
)

/** A song as the player wants it. The catalogue row is the only source here. */
private fun SubmittedMusicRecord.toMusicTrack(): MusicTrack = MusicTrack(
    id = id,
    title = title,
    artist = artist,
    album = album,
    genre = genre,
    description = "",
    thumbnailUrl = thumbnailUrl,
    audioUrl = audioUrl,
    durationSeconds = 0,
    fileSizeMb = 0.0
)

@Composable
private fun CommentPane(
    comments: List<CommentRecord>,
    focusId: String = "",
    onOpen: (CommentRecord) -> Unit
) {
    var limit by remember { mutableIntStateOf(PAGE_SIZE) }
    val listState = rememberLazyListState()
    // Notice related ids may be the comment's own id (DB trigger) or the
    // article's blog id (app-generated inbox sync) — accept both.
    val focusedComment = remember(focusId, comments) {
        if (focusId.isBlank()) null
        else comments.firstOrNull { it.id == focusId || it.blogId == focusId }
    }
    // Highlight the focused card (opened from a notice) until it fades.
    var highlightOn by remember(focusId) { mutableStateOf(focusId.isNotBlank()) }

    // Widen the page window so the focused card is visible without
    // tapping "আরও দেখুন" first.
    LaunchedEffect(focusId, focusedComment, comments) {
        if (focusedComment == null) return@LaunchedEffect
        val idx = comments.indexOf(focusedComment)
        if (idx >= 0 && idx >= limit) limit = (idx + 1).coerceAtMost(comments.size)
    }
    // Scroll once the focused card is inside the rendered window.
    LaunchedEffect(focusId, focusedComment, comments, limit) {
        if (focusedComment == null) return@LaunchedEffect
        val idx = comments.indexOf(focusedComment)
        if (idx in 0 until minOf(comments.size, limit)) {
            listState.animateScrollToItem(idx)
        }
    }
    LaunchedEffect(focusId) {
        if (focusId.isBlank()) return@LaunchedEffect
        delay(3000)
        highlightOn = false
    }
    LazyColumn(
        state = listState,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        if (comments.isEmpty()) {
            item { EmptyHint("আপনার কোনো মন্তব্য পাওয়া যায়নি।") }
        } else {
            items(comments.take(limit), key = { "c-${it.id}" }) { comment ->
                CommentStatusCard(
                    comment = comment,
                    highlighted = highlightOn && focusedComment != null && comment.id == focusedComment.id,
                    onOpen = { onOpen(comment) }
                )
            }
            if (limit < comments.size) {
                item {
                    OutlinedButton(
                        onClick = { limit = (limit + PAGE_SIZE).coerceAtMost(comments.size) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("আরও দেখুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(88.dp)) }
    }
}

@Composable
private fun MessagePane(
    messages: List<AdminMessageRecord>,
    saving: Boolean,
    focusMessageId: String,
    onSend: (String) -> Unit,
    onReload: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var body by remember { mutableStateOf("") }
    var attaching by remember { mutableStateOf(false) }
    var pendingUrls by remember { mutableStateOf(listOf<String>()) }
    var previewUrl by remember { mutableStateOf<String?>(null) }
    val ordered = remember(messages) { messages.sortedBy { it.createdAt } }
    var window by remember { mutableIntStateOf(MESSAGE_WINDOW) }
    val visible = remember(ordered, window) { ordered.takeLast(window.coerceAtMost(ordered.size.coerceAtLeast(0))) }
    val listState = rememberLazyListState()

    LaunchedEffect(ordered.lastOrNull()?.id) {
        if (visible.isNotEmpty()) listState.scrollToItem(visible.lastIndex)
    }
    LaunchedEffect(focusMessageId, visible) {
        if (focusMessageId.isBlank()) return@LaunchedEffect
        val idx = visible.indexOfFirst { it.id == focusMessageId }
        if (idx >= 0) listState.animateScrollToItem(idx)
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            attaching = true
            val mime = context.contentResolver.getType(uri).orEmpty()
            val result = if (mime.contains("pdf", true) || uri.toString().endsWith(".pdf", true)) {
                val preview = renderPdfPreview(context, uri)
                if (preview != null) {
                    ImgBbUploader.uploadBitmap(preview, "pdf_${System.currentTimeMillis()}")
                } else {
                    Result.failure(IllegalArgumentException("পিডিএফ পড়া যায়নি।"))
                }
            } else {
                ImgBbUploader.uploadFromUri(context, uri, "msg_${System.currentTimeMillis()}")
            }
            result.onSuccess { image ->
                val url = image.displayUrl.ifBlank { image.url }
                pendingUrls = pendingUrls + url
                if (mime.contains("pdf", true)) {
                    body = if (body.isBlank()) "📎 পিডিএফ সংযুক্ত" else body
                }
            }
            attaching = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (window < ordered.size) {
                    item(key = "older") {
                        TextButton(
                            onClick = { window = (window + MESSAGE_WINDOW).coerceAtMost(ordered.size) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("আগের বার্তা লোড করুন", fontFamily = Kalpurush)
                        }
                    }
                }
                if (ordered.isEmpty()) {
                    item { EmptyHint("অ্যাডমিনকে প্রশ্ন বা অনুরোধ পাঠান। উত্তর এখানে দেখাবে।") }
                }
                items(visible, key = { it.id }) { item ->
                    ChatBubble(item, onOpenImage = { previewUrl = it })
                }
            }
            IconButton(
                onClick = {
                    if (visible.isNotEmpty()) {
                        scope.launch { listState.animateScrollToItem(visible.lastIndex) }
                    }
                },
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(12.dp)
                    .testTag("dashboard_scroll_latest")
            ) {
                Icon(Icons.Default.KeyboardArrowDown, contentDescription = "নিচে যান")
            }
        }

        if (pendingUrls.isNotEmpty()) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                pendingUrls.forEach { url ->
                    Box {
                        AsyncImage(
                            model = url,
                            contentDescription = null,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 80.dp, max = 220.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { previewUrl = url }
                        )
                        IconButton(
                            onClick = { pendingUrls = pendingUrls.filterNot { it == url } },
                            modifier = Modifier.align(Alignment.TopEnd).size(28.dp)
                        ) {
                            Icon(Icons.Default.Close, contentDescription = "সরান")
                        }
                    }
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            IconButton(onClick = onReload, modifier = Modifier.testTag("dashboard_admin_message_reload")) {
                Icon(Icons.Default.Refresh, contentDescription = "রিলোড")
            }
            IconButton(
                onClick = { picker.launch("*/*") },
                enabled = !attaching,
                modifier = Modifier.testTag("dashboard_admin_message_attach")
            ) {
                Icon(Icons.Default.AttachFile, contentDescription = "ছবি বা পিডিএফ")
            }
            OutlinedTextField(
                value = body,
                onValueChange = { body = it },
                label = { Text("বার্তা", fontFamily = Kalpurush) },
                minLines = 1,
                maxLines = 4,
                modifier = Modifier.weight(1f).testTag("dashboard_admin_message_body")
            )
            IconButton(
                onClick = {
                    val extra = pendingUrls.joinToString("\n") { it }
                    val payload = listOf(body.trim(), extra).filter { it.isNotBlank() }.joinToString("\n\n")
                    onSend(payload)
                    body = ""
                    pendingUrls = emptyList()
                },
                enabled = !saving && !attaching && (body.isNotBlank() || pendingUrls.isNotEmpty()),
                modifier = Modifier.testTag("dashboard_admin_message_send")
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "পাঠান")
            }
        }
    }

    val openPreview = previewUrl
    if (openPreview != null) {
        ImagePreviewDialog(url = openPreview, onDismiss = { previewUrl = null })
    }
}

@Composable
private fun ImagePreviewDialog(url: String, onDismiss: () -> Unit) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.94f)),
            contentAlignment = Alignment.Center
        ) {
            ZoomableChatImage(url = url)
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
            ) {
                Icon(Icons.Default.Close, contentDescription = "বন্ধ", tint = Color.White)
            }
        }
    }
}

@Composable
private fun ZoomableChatImage(url: String) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var lastTapAt by remember { mutableLongStateOf(0L) }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .clipToBounds()
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    val touchSlop = viewConfiguration.touchSlop
                    var zoom = 1f
                    var pan = Offset.Zero
                    var pastTouchSlop = false
                    var pinched = false
                    do {
                        val event = awaitPointerEvent()
                        val zoomChange = event.calculateZoom()
                        val panChange = event.calculatePan()
                        val fingers = event.changes.count { it.pressed }
                        if (fingers >= 2) pinched = true
                        if (!pastTouchSlop) {
                            zoom *= zoomChange
                            pan += panChange
                            val minDim = kotlin.math.min(size.width, size.height).toFloat()
                            val zoomMotion = kotlin.math.abs(1f - zoom) * minDim
                            if (pinched || zoomMotion > touchSlop || pan.getDistance() > touchSlop) {
                                pastTouchSlop = true
                            }
                        }
                        if (pastTouchSlop) {
                            val next = (scale * zoomChange).coerceIn(1f, 6f)
                            scale = next
                            offset = if (next <= 1.01f) Offset.Zero else offset + panChange
                            event.changes.forEach { change ->
                                if (change.positionChanged()) change.consume()
                            }
                        }
                    } while (event.changes.any { it.pressed })
                    if (!pastTouchSlop && !pinched) {
                        val now = System.currentTimeMillis()
                        if (now - lastTapAt < 300L) {
                            lastTapAt = 0L
                            if (scale > 1.05f) {
                                scale = 1f
                                offset = Offset.Zero
                            } else {
                                scale = 2.75f
                            }
                        } else {
                            lastTapAt = now
                        }
                    }
                }
            },
        contentAlignment = Alignment.Center
    ) {
        AsyncImage(
            model = url,
            contentDescription = "ছবি",
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offset.x
                    translationY = offset.y
                }
        )
    }
}

@Composable
private fun ChatBubble(item: AdminMessageRecord, onOpenImage: (String) -> Unit) {
    val fromAdmin = item.isFromAdmin
    val images = remember(item.body) { messageAttachmentUrls(item.body) }
    val text = images.fold(item.body) { acc, url -> acc.replace(url, "") }.trim()
    Box(modifier = Modifier.fillMaxWidth()) {
        Surface(
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (fromAdmin) 4.dp else 16.dp,
                bottomEnd = if (fromAdmin) 16.dp else 4.dp
            ),
            color = if (fromAdmin) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.secondaryContainer,
            modifier = Modifier
                .align(if (fromAdmin) Alignment.CenterStart else Alignment.CenterEnd)
                .widthIn(max = 320.dp)
                .testTag("dashboard_message_${item.id}")
        ) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    if (fromAdmin) "অ্যাডমিন" else "আপনি",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp
                )
                if (text.isNotBlank()) {
                    Text(text, fontFamily = Kalpurush, fontSize = 15.sp)
                }
                images.forEach { url ->
                    AsyncImage(
                        model = url,
                        contentDescription = "সংযুক্তি",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 120.dp, max = 360.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { onOpenImage(url) }
                    )
                }
                Row(
                    modifier = Modifier.align(Alignment.End),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (item.createdAt.isNotBlank()) {
                        Text(
                            shortDateTime(item.createdAt),
                            fontFamily = Kalpurush,
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    if (!fromAdmin) {
                        Icon(
                            imageVector = if (item.isRead) Icons.Default.DoneAll else Icons.Default.Done,
                            contentDescription = if (item.isRead) "দেখা হয়েছে" else "পাঠানো হয়েছে",
                            tint = if (item.isRead) TickGreen else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun UserInfoCard(
    user: UserProfile?,
    onEditProfile: () -> Unit
) {
    val name = user?.composedFullName().orEmpty().ifBlank { "পাঠক" }
    val designation = user?.designation.orEmpty().ifBlank { "—" }
    Surface(
        shape = RoundedCornerShape(16.dp),
        tonalElevation = 2.dp,
        modifier = Modifier
            .fillMaxWidth()
            .testTag("dashboard_user_info")
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(shape = CircleShape, modifier = Modifier.size(64.dp)) {
                if (!user?.avatarUrl.isNullOrBlank()) {
                    AsyncImage(
                        model = user?.avatarUrl,
                        contentDescription = "প্রোফাইল ছবি",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize().clip(CircleShape)
                    )
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(36.dp))
                    }
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(name, fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                Text(
                    designation,
                    fontFamily = Kalpurush,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            IconButton(
                onClick = onEditProfile,
                modifier = Modifier.testTag("dashboard_edit_profile")
            ) {
                Icon(Icons.Default.Edit, contentDescription = "প্রোফাইল সম্পাদনা")
            }
        }
    }
}

@Composable
private fun MetricsGrid(metrics: ReaderMetrics) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("dashboard_metrics")) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            MetricCard("প্রবন্ধ", metrics.totalArticles.toString(), Icons.AutoMirrored.Filled.Article, Modifier.weight(1f))
            MetricCard("গান", metrics.songs.toString(), Icons.Default.MusicNote, Modifier.weight(1f))
            MetricCard("অপেক্ষমাণ", metrics.pendingArticles.toString(), Icons.Default.HourglassTop, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            MetricCard("প্রকাশিত", metrics.publishedArticles.toString(), Icons.Default.Publish, Modifier.weight(1f))
            MetricCard("মন্তব্য", metrics.comments.toString(), Icons.Default.Comment, Modifier.weight(1f))
            MetricCard(
                "ভিউ",
                toBengaliNumeral(metrics.totalViews),
                Icons.Default.Visibility,
                Modifier.weight(1f)
            )
        }
        // The view counter split, so the total above can be read.
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            MetricCard(
                "প্রবন্ধ ভিউ",
                toBengaliNumeral(metrics.articleViews),
                Icons.AutoMirrored.Filled.Article,
                Modifier.weight(1f)
            )
            MetricCard(
                "গান ভিউ",
                toBengaliNumeral(metrics.musicViews),
                Icons.Default.MusicNote,
                Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun MetricCard(label: String, value: String, icon: ImageVector, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(value, fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 20.sp)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(14.dp)
                )
                Text(
                    label,
                    fontFamily = Kalpurush,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun EmptyHint(text: String) {
    Text(text, fontFamily = Kalpurush, modifier = Modifier.padding(vertical = 8.dp))
}

@Composable
private fun NotificationCard(
    notice: UserNotificationRecord,
    onOpen: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = if (notice.isRead) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.primaryContainer,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .testTag("dashboard_notice_${notice.id}")
    ) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(
                imageVector = when {
                    notice.isComment -> Icons.Default.Comment
                    notice.isAdminMessage || notice.kind == "staff_notice" -> Icons.Default.Mail
                    else -> Icons.AutoMirrored.Filled.Article
                },
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
            Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.weight(1f)) {
                Text(notice.title, fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                if (notice.body.isNotBlank()) {
                    Text(notice.body, fontFamily = Kalpurush, fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
                }
                Text(
                    when {
                        notice.isComment -> "মন্তব্য"
                        notice.isAdminMessage || notice.kind == "staff_notice" -> "বার্তা"
                        notice.isArticle -> "প্রবন্ধ"
                        else -> notice.kind
                    },
                    fontFamily = Kalpurush,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            // Every row opens something, so it carries a chevron like any other
            // navigable list item.
            Icon(
                Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .align(Alignment.CenterVertically)
                    .size(18.dp)
            )
        }
    }
}

@Composable
private fun ContentCard(row: ContentRow, highlighted: Boolean = false, onOpen: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = if (highlighted) MaterialTheme.colorScheme.primaryContainer
        else MaterialTheme.colorScheme.surface,
        tonalElevation = if (highlighted) 3.dp else 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .testTag("dashboard_content_${row.id}")
    ) {
        Row(Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .clip(RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center
            ) {
                if (row.thumbnail.isNotBlank()) {
                    AsyncImage(
                        model = row.thumbnail,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    Icon(
                        if (row.isMusic) Icons.Default.MusicNote else Icons.AutoMirrored.Filled.Article,
                        contentDescription = null,
                        modifier = Modifier.size(28.dp)
                    )
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(row.title, fontFamily = Kalpurush, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    if (row.isMusic) "গান · ${row.subtitle}" else row.subtitle,
                    fontFamily = Kalpurush,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            // Where the piece stands, on the right of the card where a reader
            // scans for it: pending, published, rejected, under review.
            ContentStatusChip(
                status = row.status,
                modifier = Modifier
                    .align(Alignment.CenterVertically)
                    .padding(start = 6.dp)
            )
        }
    }
}

/**
 * The state of one submission as a small chip.
 *
 * Tinted rather than coloured text so it stays readable on the light and the
 * dark surface the card is drawn on.
 */
@Composable
private fun ContentStatusChip(status: String, modifier: Modifier = Modifier) {
    val label = statusLabel(status)
    if (label.isBlank()) return
    val tint = when (status.lowercase()) {
        "published", "approved" -> Color(0xFF2E9E5B)
        "rejected" -> Color(0xFFE05252)
        "reviewed" -> Color(0xFF4A90D9)
        else -> Color(0xFFD98A1F)
    }
    Surface(
        color = tint.copy(alpha = 0.16f),
        shape = RoundedCornerShape(999.dp),
        modifier = modifier
    ) {
        Text(
            text = label,
            fontFamily = Kalpurush,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = tint,
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
        )
    }
}

@Composable
private fun CommentStatusCard(comment: CommentRecord, highlighted: Boolean = false, onOpen: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = if (highlighted) MaterialTheme.colorScheme.primaryContainer
        else MaterialTheme.colorScheme.surface,
        tonalElevation = if (highlighted) 3.dp else 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .testTag("dashboard_comment_${comment.id}")
    ) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Default.Comment, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.weight(1f)) {
                if (comment.blogTitle.isNotBlank()) {
                    Text(comment.blogTitle, fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
                Text(comment.content, fontFamily = Kalpurush, fontSize = 14.sp, maxLines = 4, overflow = TextOverflow.Ellipsis)
                Text(
                    if (comment.isPublished) "প্রকাশিত" else "পর্যালোচনায়",
                    fontFamily = Kalpurush,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

private fun statusLabel(status: String): String {
    return when (status.lowercase()) {
        "pending" -> "অপেক্ষমাণ"
        "published", "approved" -> "প্রকাশিত"
        "rejected" -> "প্রত্যাখ্যাত"
        "reviewed" -> "পর্যালোচিত"
        else -> status
    }
}

/** Whether the piece is out in the app, and so has somewhere to open to. */
private fun isPublishedStatus(status: String): Boolean {
    val value = status.lowercase()
    return value == "published" || value == "approved"
}

private fun renderPdfPreview(context: android.content.Context, uri: Uri): Bitmap? {
    return runCatching {
        val pfd = context.contentResolver.openFileDescriptor(uri, "r") ?: return null
        pfd.use { descriptor ->
            val renderer = PdfRenderer(descriptor)
            renderer.use { pdf ->
                if (pdf.pageCount <= 0) return null
                pdf.openPage(0).use { page ->
                    val bitmap = Bitmap.createBitmap(
                        page.width.coerceAtLeast(1),
                        page.height.coerceAtLeast(1),
                        Bitmap.Config.ARGB_8888
                    )
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    bitmap
                }
            }
        }
    }.getOrNull()
}
