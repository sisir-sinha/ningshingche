package com.ningshingche.app.ui.reader

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.ExperimentalFoundationApi
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
import kotlinx.coroutines.launch
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.screens.ContributorList
import com.ningshingche.app.ui.theme.Kalpurush
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import com.ningshingche.app.data.portal.ArticleSummary
import com.ningshingche.app.data.portal.AuthorRef
import com.ningshingche.app.data.portal.CategoryRef
import com.ningshingche.app.data.portal.PdfBook
import com.ningshingche.app.data.portal.VideoItem
import com.ningshingche.app.ui.components.LocalMusicController
import com.ningshingche.app.ui.editorial.EditorialFooter
import com.ningshingche.app.ui.components.AccountHeaderButton
import com.ningshingche.app.ui.components.HomeSkeletonLayout
import com.ningshingche.app.ui.editorial.AiAssistantHomeBanner
import com.ningshingche.app.ui.editorial.AnimatedHamburgerIcon
import com.ningshingche.app.ui.editorial.ArticleRail
import com.ningshingche.app.ui.editorial.ArticleRow
import com.ningshingche.app.ui.editorial.AuthorRail
import com.ningshingche.app.ui.editorial.CategoryRail
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.editorial.EmptyState
import com.ningshingche.app.ui.editorial.ErrorState
import com.ningshingche.app.ui.editorial.GalleryGrid
import com.ningshingche.app.ui.editorial.GalleryModalDialog
import com.ningshingche.app.ui.editorial.VideoPlayerDialog
import com.ningshingche.app.ui.editorial.Hairline
import com.ningshingche.app.ui.editorial.HeroArticleCard
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.editorial.NumberedArticleCard
import com.ningshingche.app.ui.editorial.PdfRail
import com.ningshingche.app.ui.editorial.SectionHeader
import com.ningshingche.app.ui.editorial.MusicRail
import com.ningshingche.app.ui.editorial.VideoRail
import kotlinx.coroutines.launch

/**
 * Home — the magazine's front page.
 *
 * Structure, top to bottom:
 * masthead (Fixed top bar with animated hamburger & logo) →
 * hero carousel (auto sliding, is_slider filter) →
 * AI Assistant Banner →
 * category rail (first article thumb backdrop, Kalpurush) →
 * featured rail (is_featured filter, All Featured navigation) →
 * numbered specials →
 * gallery strip (in-app modal dialog) →
 * PDF shelf (in-app PDF reader) →
 * video rail →
 * running latest list.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onArticleClick: (String) -> Unit,
    onCategoryClick: (CategoryRef) -> Unit,
    onAuthorClick: (AuthorRef) -> Unit,
    onSearchClick: () -> Unit,
    onPdfClick: (PdfBook) -> Unit,
    onSeeAllPdf: (() -> Unit)? = null,
    onSeeAllLatest: () -> Unit,
    onSeeAllFeatured: () -> Unit = {},
    onSeeAllCategories: (() -> Unit)? = null,
    onSeeAllSpecial: (() -> Unit)? = null,
    onSeeAllVideos: () -> Unit = {},
    onSeeAllMusic: () -> Unit = {},
    onSeeAllContributors: () -> Unit = {},
    onContributorClick: (String) -> Unit = {},
    onMenuClick: () -> Unit = {},
    onAiClick: () -> Unit = {},
    onAiPrompt: (String) -> Unit = {},
    onLoginClick: () -> Unit = {},
    onDashboardClick: () -> Unit = {},
    onProfileClick: () -> Unit = {},
    onNotificationsClick: () -> Unit = {},
    unreadCount: Int = 0,
    onLogoutClick: () -> Unit = {},
    isSignedIn: Boolean = false,
    avatarUrl: String = "",
    onNavigate: (String) -> Unit = {},
    onOpenLink: (String) -> Unit = {},
    modifier: Modifier = Modifier
) {
    val state by viewModel.state.collectAsState()
    val contributors by viewModel.contributors.collectAsState()
    LaunchedEffect(isSignedIn) { viewModel.loadContributors(isSignedIn) }
    val offlineNotice by viewModel.offlineNotice.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val isRefreshing = (state as? HomeUiState.Ready)?.isRefreshing == true
    val pullToRefreshState = rememberPullToRefreshState()

    LaunchedEffect(offlineNotice) {
        offlineNotice?.let { snackbarHostState.showSnackbar(it) }
    }

    Scaffold(
        modifier = modifier,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    // No text "Ningshing Che" as per design mandate
                },
                navigationIcon = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(start = 4.dp)
                    ) {
                        IconButton(
                            onClick = onMenuClick,
                            modifier = Modifier.testTag("hamburger_menu_button")
                        ) {
                            AnimatedHamburgerIcon(tint = MaterialTheme.colorScheme.onSurface)
                        }
                        // Brand wordmark (text, not the logo image). Tapping it
                        // scrolls the feed back to the top.
                        Text(
                            text = "নিংশিং চে",
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            fontSize = 21.sp,
                            lineHeight = 24.sp,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .clickable {
                                    coroutineScope.launch {
                                        listState.animateScrollToItem(0)
                                    }
                                }
                                .padding(horizontal = 6.dp, vertical = 4.dp)
                                .testTag("brand_wordmark_home_button")
                        )
                    }
                },
                actions = {
                    AccountHeaderButton(
                        isSignedIn = isSignedIn,
                        avatarUrl = avatarUrl,
                        onLoginClick = onLoginClick,
                        onDashboardClick = onDashboardClick,
                        onProfileClick = onProfileClick,
                        onNotificationsClick = onNotificationsClick,
                        unreadCount = unreadCount,
                        onLogoutClick = onLogoutClick
                    )
                    IconButton(
                        onClick = onSearchClick,
                        modifier = Modifier.testTag("search_top_button")
                    ) {
                        Icon(Icons.Default.Search, contentDescription = "অনুসন্ধান")
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { viewModel.load(force = true) },
            state = pullToRefreshState,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (val current = state) {
                HomeUiState.Loading -> {
                    Box(modifier = Modifier.fillMaxSize()) {
                        HomeSkeletonLayout()
                    }
                }

                is HomeUiState.Error -> ErrorState(
                    message = current.message,
                    onRetry = { viewModel.load(force = true) },
                    modifier = Modifier.fillMaxSize()
                )

                is HomeUiState.Ready -> HomeContent(
                    feed = current.feed,
                    listState = listState,
                    onArticleClick = onArticleClick,
                    onCategoryClick = onCategoryClick,
                    onAuthorClick = onAuthorClick,
                    onPdfClick = onPdfClick,
                    onSeeAllPdf = onSeeAllPdf,
                    onSeeAllLatest = onSeeAllLatest,
                    onSeeAllFeatured = onSeeAllFeatured,
                    onSeeAllCategories = onSeeAllCategories,
                    onSeeAllSpecial = onSeeAllSpecial,
                    onSeeAllVideos = onSeeAllVideos,
                    onSeeAllMusic = onSeeAllMusic,
                    onAiClick = onAiClick,
                    onAiPrompt = onAiPrompt,
                    onNavigate = onNavigate,
                    onOpenLink = onOpenLink
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun HomeContent(
    feed: com.ningshingche.app.data.portal.HomeFeed,
    listState: LazyListState,
    onArticleClick: (String) -> Unit,
    onCategoryClick: (CategoryRef) -> Unit,
    onAuthorClick: (AuthorRef) -> Unit,
    onPdfClick: (PdfBook) -> Unit,
    onSeeAllPdf: (() -> Unit)? = null,
    onSeeAllLatest: () -> Unit,
    onSeeAllFeatured: () -> Unit,
    onSeeAllCategories: (() -> Unit)? = null,
    onSeeAllSpecial: (() -> Unit)? = null,
    onSeeAllVideos: () -> Unit,
    onSeeAllMusic: () -> Unit,
    onAiClick: () -> Unit,
    onAiPrompt: (String) -> Unit = {},
    onNavigate: (String) -> Unit = {},
    onOpenLink: (String) -> Unit = {}
) {
    val context = LocalContext.current
    val musicController = LocalMusicController.current
    LaunchedEffect(feed.music) {
        if (feed.music.isNotEmpty()) musicController.prefetchCatalog(feed.music)
    }
    // Index (not the item) so the viewer can page through the whole gallery.
    var selectedGalleryIndex by remember { mutableStateOf<Int?>(null) }
    var selectedVideo by remember { mutableStateOf<VideoItem?>(null) }

    // Aggregate all articles for category thumb lookup
    val allArticles = remember(feed) {
        (feed.hero + feed.featured + feed.special + feed.latest).distinctBy { it.id }
    }

    // Filter hero slider articles: prioritize isSlider == true
    val heroArticles = remember(feed.hero) {
        val sliderOnly = feed.hero.filter { it.isSlider }
        if (sliderOnly.isNotEmpty()) sliderOnly else feed.hero
    }

    // Filter featured articles: prioritize isFeature == true
    val featuredArticles = remember(feed.featured, feed.latest) {
        val featOnly = feed.featured.filter { it.isFeature }
        if (featOnly.isNotEmpty()) featOnly else feed.featured
    }

    // Interactive in-app gallery viewer - swipe left/right for the next/previous photo.
    selectedGalleryIndex?.let { index ->
        GalleryModalDialog(
            items = feed.gallery,
            initialIndex = index,
            onDismiss = { selectedGalleryIndex = null },
            onShare = { item ->
                val sendIntent = Intent().apply {
                    action = Intent.ACTION_SEND
                    putExtra(
                        Intent.EXTRA_TEXT,
                        "${item.title}\n${item.description}\n${item.imageUrl}\n\nনিংশিং চে"
                    )
                    type = "text/plain"
                }
                context.startActivity(Intent.createChooser(sendIntent, "ছবি শেয়ার করুন"))
            }
        )
    }

    // In-app video player (YouTube iframe / Facebook video plugin in a WebView).
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

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        // The scaffold already keeps the list clear of the system navigation
        // bar, and the mini player takes its own row at the bottom rather than
        // floating over the list, so a big trailing pad would only show as an
        // empty band under the footer.
        contentPadding = PaddingValues(bottom = EditorialSpace.xs)
    ) {
        // 1. Hero Section Carousel (Auto Sliding)
        if (feed.settings.heroSliderEnabled && heroArticles.isNotEmpty()) {
            item {
                HeroCarousel(hero = heroArticles, onArticleClick = onArticleClick)
            }
        }

        // 2. AI Assistant Banner (Placed right after Hero Carousel)
        item {
            AiAssistantHomeBanner(
                onAiClick = onAiClick,
                onPromptClick = onAiPrompt,
                modifier = Modifier.padding(top = EditorialSpace.xs, bottom = EditorialSpace.xs)
            )
        }

        // 3. Category Section (Visual Cards with first article thumbnail)
        if (feed.categories.isNotEmpty()) {
            item {
                Spacer(Modifier.height(EditorialSpace.xs))
                CategoryRail(
                    categories = feed.categories,
                    articles = allArticles,
                    selectedSlug = null,
                    onSelect = onCategoryClick,
                    onSeeAll = onSeeAllCategories
                )
                Spacer(Modifier.height(EditorialSpace.sm))
                Hairline()
            }
        }

        // 4. Featured Section (Articles with is_featured == true)
        if (feed.settings.featuredEnabled && featuredArticles.isNotEmpty()) {
            item {
                ArticleRail(
                    title = "ফিচার্ড",
                    articles = featuredArticles,
                    onArticleClick = { onArticleClick(it.id) },
                    onSeeAll = onSeeAllFeatured
                )
            }
        }

        // 5. Latest articles — sits above বিশেষ নির্বাচন. "সব" opens the Featured page.
        if (feed.latest.isNotEmpty()) {
            item {
                SectionHeader(
                    title = "সাম্প্রতিক",
                    actionLabel = "সব",
                    onAction = onSeeAllLatest
                )
            }
            items(feed.latest.take(5), key = { it.id }) { article ->
                ArticleRow(article = article, onClick = { onArticleClick(article.id) })
                Hairline(modifier = Modifier.padding(horizontal = EditorialSpace.gutter))
            }
        } else {
            item {
                EmptyState(message = "এখনো কোনো প্রবন্ধ প্রকাশিত হয়নি।")
            }
        }

        // 6. Special Curated Section
        if (feed.special.isNotEmpty() && feed.settings.specialEnabled) {
            item {
                Column(modifier = Modifier.fillMaxWidth()) {
                    SectionHeader(
                        title = "বিশেষ নির্বাচন",
                        actionLabel = if (onSeeAllSpecial != null) "সব" else null,
                        onAction = onSeeAllSpecial
                    )
                    feed.special.forEachIndexed { index, article ->
                        NumberedArticleCard(
                            index = index + 1,
                            article = article,
                            onClick = { onArticleClick(article.id) }
                        )
                        if (index < feed.special.lastIndex) {
                            Hairline(
                                modifier = Modifier.padding(
                                    horizontal = EditorialSpace.gutter,
                                    vertical = EditorialSpace.xxs
                                )
                            )
                        }
                    }
                }
            }
        }

        // 7. Photo Gallery (ছবি ঘর - In-App Modal Box)
        if (feed.gallery.isNotEmpty()) {
            item {
                GalleryGrid(
                    items = feed.gallery,
                    onItemClick = { item ->
                        selectedGalleryIndex = feed.gallery.indexOf(item)
                    }
                )
            }
        }

        // 7. Books & Periodicals (বই ও সাময়িকী - In-App PDF Reader)
        if (feed.pdfBooks.isNotEmpty()) {
            item {
                PdfRail(
                    books = feed.pdfBooks,
                    onBookClick = onPdfClick,
                    onSeeAll = onSeeAllPdf
                )
            }
        }

        // 9. Video Rail
        if (feed.videos.isNotEmpty()) {
            item {
                VideoRail(
                    videos = feed.videos,
                    onVideoClick = { selectedVideo = it },
                    onSeeAll = onSeeAllVideos
                )
            }
        }

        if (feed.music.isNotEmpty()) {
            item {
                MusicRail(
                    tracks = feed.music,
                    onTrackClick = { musicController.play(it, feed.music, expand = true) },
                    onSeeAll = onSeeAllMusic
                )
            }
        }

        // Contributor board. Only for a signed-in reader: the owner asked for it
        // to be that way, and the request itself is gated in the view model, so
        // a guest does not even ask.
        if (isSignedIn && contributors.isNotEmpty()) {
            item {
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    shape = RoundedCornerShape(16.dp),
                    tonalElevation = 1.dp,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = EditorialSpace.gutter)
                ) {
                    Column(Modifier.padding(vertical = EditorialSpace.sm)) {
                        SectionHeader(
                            title = "এই মাসের সেরা অবদানকারী",
                            subtitle = "প্রবন্ধ, গান ও অ্যাপে সময় — সব মিলিয়ে",
                            actionLabel = "সব দেখুন",
                            onAction = onSeeAllContributors,
                            modifier = Modifier.padding(horizontal = 0.dp)
                        )
                        ContributorList(
                            contributors = contributors,
                            onContributorClick = onContributorClick
                        )
                    }
                }
            }
        }

        // 10. Authors Rail
        if (feed.authors.isNotEmpty()) {
            item { AuthorRail(authors = feed.authors, onAuthorClick = onAuthorClick) }
        }

        item { Spacer(Modifier.height(EditorialSpace.xl)) }

        item {
            EditorialFooter(
                settings = feed.settings,
                onNavigate = onNavigate,
                onOpenLink = onOpenLink
            )
        }
    }
}

/**
 * Editorial Hero Section.
 * Clean, user-driven carousel with smooth swiping and indicators.
 */
/** Hero slides are a touch taller than the 16:10 default used elsewhere. */
private const val HERO_ASPECT_RATIO = 4f / 3f

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun HeroCarousel(
    hero: List<ArticleSummary>,
    onArticleClick: (String) -> Unit
) {
    if (hero.isEmpty()) return

    if (hero.size == 1) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = EditorialSpace.gutter)
        ) {
            HeroArticleCard(
                article = hero[0],
                onClick = { onArticleClick(hero[0].id) },
                aspectRatio = HERO_ASPECT_RATIO
            )
        }
        return
    }

    val pagerState = rememberPagerState(pageCount = { hero.size })
    val coroutineScope = rememberCoroutineScope()

    Column(modifier = Modifier.fillMaxWidth()) {
        HorizontalPager(
            state = pagerState,
            contentPadding = PaddingValues(horizontal = EditorialSpace.gutter),
            pageSpacing = EditorialSpace.md,
            modifier = Modifier.fillMaxWidth()
        ) { page ->
            HeroArticleCard(
                article = hero[page],
                onClick = { onArticleClick(hero[page].id) },
                aspectRatio = HERO_ASPECT_RATIO
            )
        }

        // Sleek interactive indicator pills
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = EditorialSpace.sm, bottom = EditorialSpace.xs),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            val tokens = LocalEditorialTokens.current
            repeat(hero.size) { index ->
                val selected = pagerState.currentPage == index
                val width by animateDpAsState(
                    targetValue = if (selected) 22.dp else 7.dp,
                    label = "hero_dot_width"
                )
                Box(
                    modifier = Modifier
                        .padding(horizontal = 3.dp)
                        .height(6.dp)
                        .width(width)
                        .clip(CircleShape)
                        .background(if (selected) tokens.accent else tokens.ruleStrong.copy(alpha = 0.5f))
                        .clickable {
                            coroutineScope.launch {
                                pagerState.animateScrollToPage(index)
                            }
                        }
                )
            }
        }
    }
}

