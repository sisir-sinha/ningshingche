package com.example.ui.reader

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Comment
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.FormatQuote
import androidx.compose.material.icons.filled.FormatSize
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.example.data.ai.AiChatMessage
import com.example.data.ai.NinghsingCheAiAssistant
import com.example.data.portal.ArticleDetail
import com.example.data.portal.ArticleSummary
import com.example.data.portal.AuthorRef
import com.example.data.portal.CommentItem
import com.example.data.portal.permalinkOf
import com.example.data.remote.AuthorProfiles
import com.example.ui.components.MarkdownFormattedText
import com.example.ui.components.VerifiedBadge
import com.example.ui.editorial.ArticleRow
import com.example.ui.editorial.EditorialShape
import com.example.ui.editorial.EditorialSpace
import com.example.ui.editorial.EditorialType
import com.example.ui.editorial.ErrorState
import com.example.ui.editorial.Hairline
import com.example.ui.editorial.LoadingFeed
import com.example.ui.editorial.LocalEditorialTokens
import com.example.ui.editorial.SectionHeader
import com.example.ui.editorial.formatBengaliDate
import com.example.ui.editorial.toBengaliNumeral
import com.example.ui.theme.Kalpurush
import kotlinx.coroutines.launch

/**
 * Article Reading Screen for NingshingChe Reader.
 *
 * Features:
 * - Kalpurush font definition applied across all titles, buttons, links, and content
 * - Interactive Font Size and Line Spacing control
 * - Voice Synthesis (Text-to-Speech) player bar
 * - Small author image + 2-row layout (Row 1: Author name & designation, Row 2: Date & reading time)
 * - Clickable author navigating to Author profile
 * - WYSIWYG HTML article content rendering (headings, blockquotes, lists, bold/italic, code, links)
 * - 100% width images with tap-to-enlarge modal dialog and zoom/pan support
 * - Rounded category badge with fill color and border
 * - Clickable tag chips navigating to category/tag search
 * - Redesigned modern comment section with user avatars and feedback
 * - Tactile haptic vibration on long-press of links and tags
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleScreen(
    viewModel: ArticleViewModel,
    onBackClick: () -> Unit,
    onRelatedClick: (String) -> Unit,
    onCategoryClick: (String) -> Unit = { },
    onAuthorClick: (String) -> Unit = { },
    onTagClick: (String) -> Unit = { },
    modifier: Modifier = Modifier
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current

    var fontSizeSp by remember { mutableFloatStateOf(17.5f) }
    var lineSpacingMultiplier by remember { mutableFloatStateOf(1.65f) }
    var showFontSizeSheet by remember { mutableStateOf(false) }
    var showAiSheet by remember { mutableStateOf(false) }

    var ttsPlayState by remember { mutableStateOf(TtsPlayState.IDLE) }
    var ttsErrorMessage by remember { mutableStateOf<String?>(null) }
    val ttsController = remember {
        ArticleTtsController(
            context = context,
            onStateChange = { newState -> ttsPlayState = newState },
            onError = { msg -> ttsErrorMessage = msg }
        )
    }

    DisposableEffect(Unit) {
        onDispose {
            ttsController.shutdown()
        }
    }

    val listState = rememberLazyListState()
    val readingProgress by remember {
        derivedStateOf {
            val totalItems = listState.layoutInfo.totalItemsCount
            if (totalItems <= 1) {
                0f
            } else {
                val lastVisibleItem = listState.layoutInfo.visibleItemsInfo.lastOrNull()
                if (lastVisibleItem == null) {
                    0f
                } else if (lastVisibleItem.index >= totalItems - 1) {
                    1f
                } else {
                    val firstVisibleIndex = listState.firstVisibleItemIndex.toFloat()
                    val firstVisibleOffset = listState.firstVisibleItemScrollOffset.toFloat()
                    val estimatedItemHeight = lastVisibleItem.size.toFloat().coerceAtLeast(1f)
                    val currentPosition = firstVisibleIndex + (firstVisibleOffset / estimatedItemHeight)
                    (currentPosition / (totalItems - 1).toFloat()).coerceIn(0f, 1f)
                }
            }
        }
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            Column(modifier = Modifier.fillMaxWidth()) {
                TopAppBar(
                    title = { },
                    navigationIcon = {
                        IconButton(onClick = onBackClick) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "পেছনে")
                        }
                    },
                    actions = {
                        // Voice Play/Pause button (before text control)
                        val readyArticle = (state as? ArticleUiState.Ready)?.article
                        IconButton(
                            onClick = {
                                if (readyArticle != null) {
                                    when (ttsPlayState) {
                                        TtsPlayState.PLAYING -> ttsController.pause()
                                        TtsPlayState.PAUSED -> ttsController.resume()
                                        TtsPlayState.INITIALIZING -> { /* waiting */ }
                                        TtsPlayState.IDLE, TtsPlayState.COMPLETED, TtsPlayState.ERROR -> {
                                            ttsErrorMessage = null
                                            ttsController.start(readyArticle.title, readyArticle.html)
                                        }
                                    }
                                }
                            },
                            enabled = readyArticle != null
                        ) {
                            when (ttsPlayState) {
                                TtsPlayState.INITIALIZING -> {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(20.dp),
                                        strokeWidth = 2.dp,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                }
                                TtsPlayState.PLAYING -> {
                                    Icon(
                                        imageVector = Icons.Default.Pause,
                                        contentDescription = "ভয়েস থামান",
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                }
                                TtsPlayState.PAUSED -> {
                                    Icon(
                                        imageVector = Icons.Default.PlayArrow,
                                        contentDescription = "ভয়েস পুনরায় চালু করুন",
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                }
                                TtsPlayState.IDLE, TtsPlayState.COMPLETED, TtsPlayState.ERROR -> {
                                    Icon(
                                        imageVector = Icons.Default.PlayArrow,
                                        contentDescription = "ভয়েস শুনুন",
                                        tint = MaterialTheme.colorScheme.onSurface
                                    )
                                }
                            }
                        }

                        // Font Size Control Button
                        IconButton(onClick = { showFontSizeSheet = true }) {
                            Icon(Icons.Default.FormatSize, contentDescription = "অক্ষরের আকার")
                        }

                        // Share Button
                        IconButton(onClick = {
                            val article = (state as? ArticleUiState.Ready)?.article ?: return@IconButton
                            val send = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, "${article.title}\n${permalinkOf(article.summary.slug)}")
                                putExtra(Intent.EXTRA_SUBJECT, article.title)
                            }
                            context.startActivity(Intent.createChooser(send, "শেয়ার করুন"))
                        }) {
                            Icon(Icons.Default.Share, contentDescription = "শেয়ার")
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background
                    )
                )
                // Reading percentage bar as bottom border bar of the sticky top bar
                LinearProgressIndicator(
                    progress = { readingProgress },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(3.dp),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f),
                )
            }
        },
        floatingActionButton = {
            val readyState = state as? ArticleUiState.Ready
            if (readyState != null) {
                FloatingActionButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        showAiSheet = true
                    },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.padding(bottom = 8.dp, end = 4.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.AutoAwesome,
                            contentDescription = "নিবন্ধ এআই সহায়িকা",
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            text = "এআই সহায়িকা",
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.5.sp
                        )
                    }
                }
            }
        }
    ) { padding ->
        val isRefreshing = (state as? ArticleUiState.Ready)?.isRefreshing == true

        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { viewModel.refresh() },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (val current = state) {
                ArticleUiState.Loading -> LoadingFeed()

                is ArticleUiState.Error -> ErrorState(
                    message = current.message,
                    onRetry = { viewModel.retry() }
                )

                is ArticleUiState.Ready -> {
                    ArticleReaderContent(
                        article = current.article,
                        author = current.author,
                        comments = current.comments,
                        related = current.related,
                        padding = PaddingValues(0.dp),
                        fontSizeSp = fontSizeSp,
                        lineSpacingMultiplier = lineSpacingMultiplier,
                        listState = listState,
                        onRelatedClick = onRelatedClick,
                        onCategoryClick = onCategoryClick,
                        onAuthorClick = onAuthorClick,
                        onTagClick = onTagClick,
                        onOpenLink = { url ->
                            try {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                            } catch (_: Exception) { }
                        },
                        onPostComment = { name, email, body ->
                            viewModel.postComment(name, email, body)
                        },
                        commentStatus = viewModel.commentStatus.collectAsState().value,
                        isPostingComment = viewModel.isPostingComment.collectAsState().value
                    )

                    // Font Size & Spacing Bottom Sheet
                    if (showFontSizeSheet) {
                        FontSizeControlBottomSheet(
                            fontSizeSp = fontSizeSp,
                            lineSpacing = lineSpacingMultiplier,
                            onFontSizeChange = { fontSizeSp = it },
                            onLineSpacingChange = { lineSpacingMultiplier = it },
                            onReset = {
                                fontSizeSp = 17.5f
                                lineSpacingMultiplier = 1.65f
                            },
                            onDismiss = { showFontSizeSheet = false }
                        )
                    }

                    // Grounded Article AI Assistant Bottom Sheet
                    if (showAiSheet) {
                        ArticleAiAssistantBottomSheet(
                            article = current.article,
                            authorName = current.author?.name ?: current.article.summary.authorName,
                            category = current.article.summary.categoryTitle,
                            onDismiss = { showAiSheet = false }
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
private fun ArticleReaderContent(
    article: ArticleDetail,
    author: AuthorRef?,
    comments: List<CommentItem>,
    related: List<ArticleSummary>,
    padding: PaddingValues,
    fontSizeSp: Float,
    lineSpacingMultiplier: Float,
    listState: LazyListState = rememberLazyListState(),
    onRelatedClick: (String) -> Unit,
    onCategoryClick: (String) -> Unit,
    onAuthorClick: (String) -> Unit,
    onTagClick: (String) -> Unit,
    onOpenLink: (String) -> Unit,
    onPostComment: (String, String, String) -> Unit,
    commentStatus: String?,
    isPostingComment: Boolean
) {
    val tokens = LocalEditorialTokens.current
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    var enlargedHeroImageUrl by remember { mutableStateOf<String?>(null) }

    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxSize()
            .padding(padding),
        contentPadding = PaddingValues(bottom = EditorialSpace.xxl)
    ) {
        // 1. Hero Image (100% width, tap to enlarge modal)
        if (article.summary.imageUrl.isNotBlank()) {
            item {
                FullWidthArticleImage(
                    url = article.summary.imageUrl,
                    alt = article.title,
                    onClick = { enlargedHeroImageUrl = article.summary.imageUrl },
                    onLongClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        triggerTactileVibration(context)
                    },
                    modifier = Modifier.padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.sm)
                )
            }
        }

        // 2. Article Header (Category Badge, Publication Date, Title, Subtitle, Reading Stats, Author Profile)
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.sm)
            ) {
                // Row with Category Pill and Publication Date
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    // Category Pill with rounded border and fill color
                    ArticleCategoryPill(
                        categoryTitle = article.summary.categoryTitle,
                        categorySlug = article.summary.categorySlug.ifBlank { article.summary.categoryId.orEmpty() },
                        onClick = { onCategoryClick(it) },
                        onLongClick = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            triggerTactileVibration(context)
                        }
                    )

                    // Publishing date on Title section
                    if (article.summary.publishedDate.isNotBlank()) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(tokens.surfaceSunken)
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.CalendarMonth,
                                contentDescription = null,
                                modifier = Modifier.size(13.dp),
                                tint = tokens.accent
                            )
                            Text(
                                text = formatBengaliDate(article.summary.publishedDate).ifBlank { article.summary.publishedDate },
                                fontFamily = Kalpurush,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }

                Spacer(Modifier.height(EditorialSpace.sm))

                // Headline
                Text(
                    text = article.title,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 26.sp,
                    lineHeight = 35.sp,
                    color = MaterialTheme.colorScheme.onSurface
                )

                // Subtitle / Lede
                if (article.summary.subTitle.isNotBlank()) {
                    Spacer(Modifier.height(EditorialSpace.xs))
                    Text(
                        text = article.summary.subTitle,
                        fontFamily = Kalpurush,
                        fontSize = 17.sp,
                        lineHeight = 25.sp,
                        color = tokens.inkSoft
                    )
                }

                // Reading time & views below title
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.padding(top = EditorialSpace.xs, bottom = EditorialSpace.sm)
                ) {
                    if (article.summary.readingTimeMinutes > 0) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(3.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Schedule,
                                contentDescription = null,
                                modifier = Modifier.size(13.dp),
                                tint = tokens.inkMuted
                            )
                            Text(
                                text = "${toBengaliNumeral(article.summary.readingTimeMinutes)} মিনিট পাঠ",
                                fontFamily = Kalpurush,
                                fontSize = 12.sp,
                                color = tokens.inkMuted
                            )
                        }
                    }
                    if (article.summary.viewsCount > 0) {
                        if (article.summary.readingTimeMinutes > 0) {
                            Text("•", fontSize = 10.sp, color = tokens.inkMuted)
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(3.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Visibility,
                                contentDescription = null,
                                modifier = Modifier.size(13.dp),
                                tint = tokens.inkMuted
                            )
                            Text(
                                text = "${toBengaliNumeral(article.summary.viewsCount.toInt())} বার পঠিত",
                                fontFamily = Kalpurush,
                                fontSize = 12.sp,
                                color = tokens.inkMuted
                            )
                        }
                    }
                }

                Spacer(Modifier.height(EditorialSpace.xs))

                // Author image (small, left col) + Name & Designation (right col)
                ArticleAuthorMetaCard(
                    authorName = article.summary.authorName,
                    authorId = article.summary.authorId.orEmpty(),
                    authorImageUrl = author?.imageUrl ?: article.summary.authorImageUrl,
                    authorDesignation = author?.designation.orEmpty(),
                    isVerified = author?.isVerified == true || AuthorProfiles.isOfficial(author?.imageUrl ?: article.summary.authorImageUrl),
                    onAuthorClick = { onAuthorClick(it) },
                    onLongClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        triggerTactileVibration(context)
                    }
                )

                Spacer(Modifier.height(EditorialSpace.md))
                Hairline()
            }
        }

        // 3. Article Content (WYSIWYG HTML rendering)
        item {
            RichHtmlArticleBody(
                html = article.html,
                fontSizeSp = fontSizeSp,
                lineSpacingMultiplier = lineSpacingMultiplier,
                onOpenLink = onOpenLink,
                modifier = Modifier.padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.sm)
            )
        }

        // 4. Tags as Clickable Links
        if (article.summary.tags.isNotEmpty()) {
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.md)
                ) {
                    Text(
                        text = "ট্যাগসমূহ",
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = tokens.inkMuted
                    )
                    Spacer(Modifier.height(EditorialSpace.xs))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        article.summary.tags.forEach { tag ->
                            Surface(
                                shape = RoundedCornerShape(EditorialShape.chip),
                                color = tokens.surfaceSunken,
                                border = BorderStroke(1.dp, tokens.rule),
                                modifier = Modifier.combinedClickable(
                                    onClick = { onTagClick(tag) },
                                    onLongClick = {
                                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                        triggerTactileVibration(context)
                                    }
                                )
                            ) {
                                Text(
                                    text = "#$tag",
                                    fontFamily = Kalpurush,
                                    fontWeight = FontWeight.Medium,
                                    fontSize = 13.sp,
                                    color = tokens.accent,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                                )
                            }
                        }
                    }
                }
            }
        }

        // 5. Media attachments (Video / PDF)
        if (article.videoLink.isNotBlank() || article.pdfLink.isNotBlank()) {
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.sm),
                    horizontalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
                ) {
                    if (article.videoLink.isNotBlank()) {
                        FilledTonalButton(
                            onClick = { onOpenLink(article.videoLink) },
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("ভিডিও দেখুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (article.pdfLink.isNotBlank()) {
                        FilledTonalButton(
                            onClick = { onOpenLink(article.pdfLink) },
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Icon(Icons.Default.PictureAsPdf, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("পিডিএফ বই", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }

        // 6. Comments Section (Redesigned)
        item {
            Hairline(modifier = Modifier.padding(vertical = EditorialSpace.md))
            SectionHeader(
                title = "মন্তব্য",
                subtitle = if (comments.isEmpty()) "এখনো কোনো মন্তব্য নেই" else "${comments.size}টি মন্তব্য"
            )
        }

        if (comments.isEmpty()) {
            item {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = tokens.surfaceSunken,
                    border = BorderStroke(1.dp, tokens.rule.copy(alpha = 0.5f)),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.xs)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            imageVector = Icons.Default.Comment,
                            contentDescription = null,
                            tint = tokens.inkMuted,
                            modifier = Modifier.size(28.dp)
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = "প্রথম মন্তব্যটি আপনিই লিখুন।",
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "অনুমোদনের পর আপনার মন্তব্য এখানে প্রকাশিত হবে।",
                            fontFamily = Kalpurush,
                            fontSize = 13.sp,
                            color = tokens.inkMuted
                        )
                    }
                }
            }
        } else {
            items(comments, key = { it.id }) { comment ->
                ModernCommentCard(comment = comment)
            }
        }

        // Comment Input Form
        item {
            ModernCommentForm(
                status = commentStatus,
                isPosting = isPostingComment,
                onSubmit = onPostComment
            )
        }

        // 7. Related Articles
        if (related.isNotEmpty()) {
            item {
                Spacer(Modifier.height(EditorialSpace.md))
                SectionHeader(title = "এগুলোও পড়ুন")
            }
            items(related, key = { it.id }) { articleSummary ->
                ArticleRow(
                    article = articleSummary,
                    onClick = { onRelatedClick(articleSummary.id) }
                )
                Hairline(modifier = Modifier.padding(horizontal = EditorialSpace.gutter))
            }
        }
    }

    // Modal dialog for hero image enlargement
    enlargedHeroImageUrl?.let { url ->
        ImageEnlargeModal(
            imageUrl = url,
            onDismiss = { enlargedHeroImageUrl = null }
        )
    }
}

/**
 * Category badge on the article with rounded border and fill color.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ArticleCategoryPill(
    categoryTitle: String,
    categorySlug: String,
    onClick: (String) -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = tokens.accentSoft,
        border = BorderStroke(1.2.dp, tokens.accent.copy(alpha = 0.45f)),
        modifier = modifier.combinedClickable(
            onClick = { onClick(categorySlug) },
            onLongClick = onLongClick
        )
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(tokens.accent)
            )
            Spacer(Modifier.width(7.dp))
            Text(
                text = categoryTitle,
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp,
                color = tokens.accent
            )
        }
    }
}

/**
 * Author & Metadata Row:
 * Left Column: Small Author Image (no badge overlay)
 * Right Column:
 *   - Row 1: Author name & verified badge
 *   - Row 2: Author designation
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ArticleAuthorMetaCard(
    authorName: String,
    authorId: String,
    authorImageUrl: String,
    authorDesignation: String,
    isVerified: Boolean,
    onAuthorClick: (String) -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val tokens = LocalEditorialTokens.current
    val resolvedAvatar = remember(authorName, authorImageUrl) {
        AuthorProfiles.resolve(authorName, authorImageUrl)
    }

    Surface(
        shape = RoundedCornerShape(14.dp),
        color = tokens.surfaceSunken.copy(alpha = 0.6f),
        border = BorderStroke(1.dp, tokens.rule.copy(alpha = 0.7f)),
        modifier = modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = { onAuthorClick(authorId) },
                onLongClick = onLongClick
            )
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Left Column: Small Author Image (Clean avatar, no badge overlay)
            AsyncImage(
                model = resolvedAvatar,
                contentDescription = authorName,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .size(46.dp)
                    .clip(CircleShape)
                    .border(1.5.dp, tokens.accent.copy(alpha = 0.4f), CircleShape)
                    .background(tokens.accentSoft)
            )

            Spacer(Modifier.width(12.dp))

            // Right Column:
            Column(modifier = Modifier.weight(1f)) {
                // Row 1: Author name & Verified Badge (Badge stays ONLY on name)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        text = authorName,
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (isVerified) {
                        VerifiedBadge(size = 15.dp)
                    }
                }

                Spacer(Modifier.height(2.dp))

                val designationText = authorDesignation.ifBlank { "লেখক • নিংশিং চে" }
                Text(
                    text = designationText,
                    fontFamily = Kalpurush,
                    fontSize = 13.sp,
                    color = tokens.accent,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

/**
 * Modern Highlighted Comment Card with left accent strip, user avatar badge, Kalpurush typography, and clean contrast.
 */
@Composable
private fun ModernCommentCard(comment: CommentItem) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
        border = BorderStroke(1.2.dp, tokens.accent.copy(alpha = 0.25f)),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter, vertical = 6.dp)
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            // Left accent highlight strip
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height(84.dp)
                    .background(tokens.accent)
            )

            Column(modifier = Modifier.padding(14.dp).weight(1f)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        // User initial avatar
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(tokens.accent.copy(alpha = 0.15f))
                                .border(1.dp, tokens.accent.copy(alpha = 0.35f), CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = comment.name.trim().take(1).uppercase().ifBlank { "প" },
                                fontFamily = Kalpurush,
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp,
                                color = tokens.accent
                            )
                        }

                        Column {
                            Text(
                                text = comment.name,
                                fontFamily = Kalpurush,
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            if (comment.address.isNotBlank()) {
                                Text(
                                    text = comment.address,
                                    fontFamily = Kalpurush,
                                    fontSize = 12.sp,
                                    color = tokens.inkMuted
                                )
                            }
                        }
                    }

                    if (comment.createdAt.isNotBlank()) {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = tokens.surfaceSunken,
                            border = BorderStroke(0.8.dp, tokens.rule)
                        ) {
                            Text(
                                text = formatBengaliDate(comment.createdAt),
                                fontFamily = Kalpurush,
                                fontSize = 11.5.sp,
                                color = tokens.inkMuted,
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp)
                            )
                        }
                    }
                }

                Spacer(Modifier.height(10.dp))

                Text(
                    text = comment.content,
                    fontFamily = Kalpurush,
                    fontSize = 14.5.sp,
                    lineHeight = 22.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.95f)
                )
            }
        }
    }
}

/**
 * Modern Highlighted Comment Submission Form with styled fields and Kalpurush font.
 */
@Composable
private fun ModernCommentForm(
    status: String?,
    isPosting: Boolean,
    onSubmit: (String, String, String) -> Unit
) {
    val tokens = LocalEditorialTokens.current
    var name by remember { mutableStateOf(TextFieldValue("")) }
    var email by remember { mutableStateOf(TextFieldValue("")) }
    var body by remember { mutableStateOf(TextFieldValue("")) }

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        border = BorderStroke(1.2.dp, tokens.accent.copy(alpha = 0.35f)),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.md)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(30.dp)
                        .clip(CircleShape)
                        .background(tokens.accentSoft),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Comment,
                        contentDescription = null,
                        tint = tokens.accent,
                        modifier = Modifier.size(16.dp)
                    )
                }
                Text(
                    text = "মন্তব্য প্রকাশ করুন",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.5.sp,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }

            Spacer(Modifier.height(12.dp))

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("আপনার নাম *", fontFamily = Kalpurush) },
                singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Kalpurush, fontSize = 15.sp),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = tokens.accent,
                    unfocusedBorderColor = tokens.rule
                ),
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("ইমেইল (ঐচ্ছিক)", fontFamily = Kalpurush) },
                singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Kalpurush, fontSize = 15.sp),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = tokens.accent,
                    unfocusedBorderColor = tokens.rule
                ),
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = body,
                onValueChange = { body = it },
                label = { Text("আপনার মূল্যবান মন্তব্য *", fontFamily = Kalpurush) },
                minLines = 3,
                textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Kalpurush, fontSize = 15.sp),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = tokens.accent,
                    unfocusedBorderColor = tokens.rule
                ),
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(Modifier.height(12.dp))

            Button(
                onClick = {
                    if (name.text.isNotBlank() && body.text.isNotBlank()) {
                        onSubmit(name.text, email.text, body.text)
                        body = TextFieldValue("")
                    }
                },
                enabled = !isPosting && name.text.isNotBlank() && body.text.isNotBlank(),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = tokens.accent,
                    contentColor = Color.White
                ),
                modifier = Modifier.fillMaxWidth()
            ) {
                if (isPosting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = Color.White
                    )
                    Spacer(Modifier.width(8.dp))
                } else {
                    Icon(
                        imageVector = Icons.Default.Send,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(Modifier.width(8.dp))
                }
                Text("মন্তব্য জমা দিন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }

            if (!status.isNullOrBlank()) {
                Spacer(Modifier.height(10.dp))
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = tokens.accentSoft,
                    border = BorderStroke(1.dp, tokens.accent.copy(alpha = 0.3f)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = status,
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Medium,
                        fontSize = 13.sp,
                        color = tokens.accent,
                        modifier = Modifier.padding(10.dp)
                    )
                }
            }
        }
    }
}

/**
 * Grounded Article AI Assistant Bottom Sheet
 * Responds strictly based on the article content.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleAiAssistantBottomSheet(
    article: ArticleDetail,
    authorName: String,
    category: String,
    onDismiss: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val tokens = LocalEditorialTokens.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var messages by remember {
        mutableStateOf(
            listOf(
                AiChatMessage(
                    role = "assistant",
                    text = "নমস্কার! আমি এই নিবন্ধের এআই সহায়িকা।\n\n📌 **\"${article.title}\"** নিবন্ধটির যেকোনো তথ্য, বিশ্লেষণ বা মূল ভাব সম্পর্কে জানতে নিচের দ্রুত প্রশ্ন বেছে নিন অথবা নিচে আপনার প্রশ্ন লিখুন।"
                )
            )
        )
    }
    var inputText by remember { mutableStateOf(TextFieldValue("")) }
    var isLoading by remember { mutableStateOf(false) }

    fun askQuestion(promptText: String) {
        val cleanPrompt = promptText.trim()
        if (cleanPrompt.isBlank() || isLoading) return

        messages = messages + AiChatMessage(role = "user", text = cleanPrompt)
        inputText = TextFieldValue("")
        isLoading = true

        scope.launch {
            try {
                val response = NinghsingCheAiAssistant.answerArticleSpecificQuestion(
                    articleId = article.summary.id,
                    articleTitle = article.title,
                    articleAuthor = authorName,
                    articleCategory = category,
                    articleHtml = article.html,
                    userQuestion = cleanPrompt
                )
                messages = messages + AiChatMessage(role = "assistant", text = response)
            } catch (e: Exception) {
                messages = messages + AiChatMessage(
                    role = "assistant",
                    text = "দুঃখিত, উত্তর তৈরি করতে সমস্যা হয়েছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।"
                )
            } finally {
                isLoading = false
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .padding(bottom = 20.dp)
        ) {
            // Top Bar
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primaryContainer),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.AutoAwesome,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                    Column {
                        Text(
                            text = "নিবন্ধ এআই সহায়িকা",
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            fontSize = 17.sp,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "শুধুমাত্র এই নিবন্ধের তথ্যের ভিত্তিতে উত্তর প্রদান করা হয়",
                            fontFamily = Kalpurush,
                            fontSize = 11.5.sp,
                            color = tokens.inkMuted
                        )
                    }
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "বন্ধ করুন")
                }
            }

            Spacer(Modifier.height(8.dp))

            // Quick Prompt Chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                val promptSuggestions = listOf(
                    "📌 সম্পূর্ণ সারসংক্ষেপ" to "এই নিবন্ধের একটি সংক্ষিপ্ত ও গোছানো সারসংক্ষেপ দিন।",
                    "💡 মূল শিক্ষণীয় বিষয়" to "এই নিবন্ধ থেকে কী কী মূল বিষয় বা শিক্ষা পাওয়া যায়?",
                    "🎯 লেখকের বক্তব্য" to "এই নিবন্ধে লেখকের মূল বক্তব্য ও লক্ষ্য কী?",
                    "❓ প্রশ্নোত্তর বিশ্লেষণ" to "নিবন্ধটির সবচেয়ে গুরুত্বপূর্ণ ৩টি প্রশ্নোত্তর তৈরি করে দিন।"
                )

                promptSuggestions.forEach { (label, prompt) ->
                    Surface(
                        shape = RoundedCornerShape(20.dp),
                        color = tokens.accentSoft,
                        border = BorderStroke(1.dp, tokens.accent.copy(alpha = 0.35f)),
                        modifier = Modifier.clickable(enabled = !isLoading) { askQuestion(prompt) }
                    ) {
                        Text(
                            text = label,
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.5.sp,
                            color = tokens.accent,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // Chat Message List
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(300.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(tokens.surfaceSunken.copy(alpha = 0.4f))
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(messages) { msg ->
                    val isUser = msg.role == "user"
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start
                    ) {
                        Surface(
                            shape = RoundedCornerShape(
                                topStart = 14.dp,
                                topEnd = 14.dp,
                                bottomStart = if (isUser) 14.dp else 2.dp,
                                bottomEnd = if (isUser) 2.dp else 14.dp
                            ),
                            color = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                            border = if (!isUser) BorderStroke(1.dp, tokens.rule) else null,
                            shadowElevation = if (!isUser) 1.dp else 0.dp,
                            modifier = Modifier.fillMaxWidth(0.92f)
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                if (isUser) {
                                    Text(
                                        text = msg.text,
                                        fontFamily = Kalpurush,
                                        fontSize = 14.5.sp,
                                        color = MaterialTheme.colorScheme.onPrimary
                                    )
                                } else {
                                    MarkdownFormattedText(
                                        markdown = msg.text,
                                        fontSizeSp = 14.5f,
                                        lineHeightSp = 21f,
                                        color = MaterialTheme.colorScheme.onSurface
                                    )

                                    Spacer(Modifier.height(6.dp))

                                    // Copy answer button
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.End
                                    ) {
                                        IconButton(
                                            onClick = {
                                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                                val clip = ClipData.newPlainText("Article AI Answer", msg.text)
                                                clipboard?.setPrimaryClip(clip)
                                                Toast.makeText(context, "উত্তর কপি করা হয়েছে", Toast.LENGTH_SHORT).show()
                                            },
                                            modifier = Modifier.size(28.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.ContentCopy,
                                                contentDescription = "কপি করুন",
                                                modifier = Modifier.size(14.dp),
                                                tint = tokens.inkMuted
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (isLoading) {
                    item {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.padding(6.dp)
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.primary
                            )
                            Text(
                                text = "নিবন্ধ থেকে উত্তর তৈরি করা হচ্ছে...",
                                fontFamily = Kalpurush,
                                fontSize = 13.sp,
                                color = tokens.inkMuted
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // Text Input Box
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = inputText,
                    onValueChange = { inputText = it },
                    placeholder = {
                        Text(
                            "এই নিবন্ধ সম্পর্কে প্রশ্ন লিখুন...",
                            fontFamily = Kalpurush,
                            fontSize = 14.sp
                        )
                    },
                    singleLine = true,
                    textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Kalpurush, fontSize = 14.5.sp),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = tokens.accent,
                        unfocusedBorderColor = tokens.rule
                    ),
                    modifier = Modifier.weight(1f)
                )

                IconButton(
                    onClick = { askQuestion(inputText.text) },
                    enabled = !isLoading && inputText.text.isNotBlank(),
                    modifier = Modifier
                        .size(46.dp)
                        .clip(CircleShape)
                        .background(
                            if (!isLoading && inputText.text.isNotBlank())
                                MaterialTheme.colorScheme.primary
                            else
                                MaterialTheme.colorScheme.outlineVariant
                        )
                ) {
                    Icon(
                        imageVector = Icons.Default.Send,
                        contentDescription = "পাঠান",
                        tint = Color.White,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
    }
}

/**
 * Font Size & Line Spacing Control Bottom Sheet with live preview in Kalpurush font.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FontSizeControlBottomSheet(
    fontSizeSp: Float,
    lineSpacing: Float,
    onFontSizeChange: (Float) -> Unit,
    onLineSpacingChange: (Float) -> Unit,
    onReset: () -> Unit,
    onDismiss: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val tokens = LocalEditorialTokens.current

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 12.dp)
                .padding(bottom = 24.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "পঠন সেটিংস (Font & Spacing)",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = MaterialTheme.colorScheme.onSurface
                )
                IconButton(onClick = onReset) {
                    Icon(
                        imageVector = Icons.Default.RestartAlt,
                        contentDescription = "রিসেট",
                        tint = tokens.accent
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            // Font Size Control
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "অক্ষরের আকার",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp
                )
                Text(
                    text = "${fontSizeSp.toInt()} sp",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    color = tokens.accent
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                FilledTonalIconButton(
                    onClick = { onFontSizeChange((fontSizeSp - 1f).coerceIn(14f, 28f)) },
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(Icons.Default.Remove, contentDescription = "ছোট করুন")
                }
                Slider(
                    value = fontSizeSp,
                    onValueChange = onFontSizeChange,
                    valueRange = 14f..28f,
                    steps = 13,
                    colors = SliderDefaults.colors(
                        thumbColor = tokens.accent,
                        activeTrackColor = tokens.accent
                    ),
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 8.dp)
                )
                FilledTonalIconButton(
                    onClick = { onFontSizeChange((fontSizeSp + 1f).coerceIn(14f, 28f)) },
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(Icons.Default.Add, contentDescription = "বড় করুন")
                }
            }

            Spacer(Modifier.height(12.dp))

            // Line Spacing Control
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "লাইনের ফাঁক (Line Spacing)",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp
                )
                Text(
                    text = String.format("%.1fx", lineSpacing),
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    color = tokens.accent
                )
            }

            Slider(
                value = lineSpacing,
                onValueChange = onLineSpacingChange,
                valueRange = 1.3f..2.2f,
                colors = SliderDefaults.colors(
                    thumbColor = tokens.accent,
                    activeTrackColor = tokens.accent
                ),
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(Modifier.height(12.dp))

            // Live Preview Card
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = tokens.surfaceSunken,
                border = BorderStroke(1.dp, tokens.rule),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Text(
                        text = "লাইভ প্রিভিউ (কালপুরুষ ফন্ট):",
                        fontFamily = Kalpurush,
                        fontSize = 12.sp,
                        color = tokens.inkMuted
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = "বিষ্ণুপ্রিয়া মণিপুরি ভাষা ও সংস্কৃতির ডিজিটাল সংকলন — নিংশিং চে।",
                        fontFamily = Kalpurush,
                        fontSize = fontSizeSp.sp,
                        lineHeight = (fontSizeSp * lineSpacing).sp,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }
    }
}
