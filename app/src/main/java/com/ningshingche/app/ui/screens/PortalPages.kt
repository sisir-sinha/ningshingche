package com.ningshingche.app.ui.screens

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import kotlinx.coroutines.launch
import com.ningshingche.app.ui.components.categoryIconFor
import com.ningshingche.app.data.model.Article
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.Tab
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ningshingche.app.data.portal.IssueTags
import com.ningshingche.app.ui.components.ArticleListItemCard
import com.ningshingche.app.ui.components.NingshingCheBrandLogo
import com.ningshingche.app.ui.components.PortalAsyncImage
import com.ningshingche.app.ui.components.VerifiedBadge
import com.ningshingche.app.ui.editorial.ArticleRow
import com.ningshingche.app.ui.editorial.EmptyState
import com.ningshingche.app.ui.editorial.ErrorState
import com.ningshingche.app.ui.editorial.GalleryGrid
import com.ningshingche.app.ui.editorial.Hairline
import com.ningshingche.app.ui.editorial.LoadingFeed
import com.ningshingche.app.ui.editorial.SectionHeader
import com.ningshingche.app.ui.reader.AuthorFacet
import com.ningshingche.app.ui.reader.ExploreUiState
import com.ningshingche.app.ui.reader.ExploreViewModel
import com.ningshingche.app.ui.reader.SocialUiState
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.viewmodel.HomeViewModel

/** One swipeable tab on the Featured page: "সব" or a single category. */
private data class FeaturedTab(
    val key: String,
    val title: String,
    val iconName: String?,
    val articles: List<Article>
)

/**
 * "ফিচার্ড প্রবন্ধসমূহ" — featured + editor's-pick articles.
 *
 * Same layout language as Explore: a pinned top bar, a pinned icon tab strip
 * ("সব" followed by one tab per category that has featured articles) and a
 * [HorizontalPager] so the reader can swipe left/right between categories.
 * Pull-to-refresh re-syncs the catalogue.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeaturedScreen(
    viewModel: HomeViewModel,
    onBackClick: () -> Unit = {},
    onArticleClick: (String) -> Unit
) {
    val articles by viewModel.allArticles.collectAsStateWithLifecycle()
    val syncState by viewModel.syncState.collectAsStateWithLifecycle()

    val featuredArticles = remember(articles) {
        val filtered = articles.filter { it.isFeatured || it.isEditorialPick }
        if (filtered.isNotEmpty()) filtered else articles
    }

    val tabs = remember(featuredArticles) {
        val byCategory = featuredArticles
            .filter { it.category.isNotBlank() }
            .groupBy { it.categorySlug.ifBlank { it.category } }
            .map { (slug, items) ->
                FeaturedTab(
                    key = slug,
                    title = items.first().category,
                    iconName = null,
                    articles = items
                )
            }
            .sortedWith(compareByDescending<FeaturedTab> { it.articles.size }.thenBy { it.title })
        listOf(FeaturedTab(key = "all", title = "সব", iconName = "star", articles = featuredArticles)) + byCategory
    }

    val pagerState = rememberPagerState(pageCount = { tabs.size })
    val coroutineScope = rememberCoroutineScope()

    // If the data set shrinks (e.g. after a refresh) keep the pager in range.
    LaunchedEffect(tabs.size) {
        if (pagerState.currentPage >= tabs.size && tabs.isNotEmpty()) {
            pagerState.scrollToPage(tabs.lastIndex)
        }
    }

    Scaffold(
        modifier = Modifier.testTag("featured_screen"),
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Column(modifier = Modifier.fillMaxWidth()) {
                CenterAlignedTopAppBar(
                    title = {
                        Text(
                            text = "ফিচার্ড প্রবন্ধসমূহ",
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = onBackClick, modifier = Modifier.testTag("featured_back_button")) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "পেছনে",
                                tint = MaterialTheme.colorScheme.onSurface
                            )
                        }
                    },
                    actions = {
                        NingshingCheBrandLogo(
                            size = 28.dp,
                            modifier = Modifier.padding(end = 12.dp)
                        )
                    },
                    colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    )
                )
                if (tabs.size > 1) {
                    ScrollableTabRow(
                        selectedTabIndex = pagerState.currentPage.coerceIn(0, tabs.lastIndex),
                        containerColor = MaterialTheme.colorScheme.surface,
                        edgePadding = 12.dp,
                        indicator = { tabPositions ->
                            val index = pagerState.currentPage
                            if (index in tabPositions.indices) {
                                TabRowDefaults.SecondaryIndicator(
                                    modifier = Modifier.tabIndicatorOffset(tabPositions[index]),
                                    color = MaterialTheme.colorScheme.primary,
                                    height = 3.dp
                                )
                            }
                        },
                        divider = { Hairline() }
                    ) {
                        tabs.forEachIndexed { index, tab ->
                            val isSelected = pagerState.currentPage == index
                            val tint = if (isSelected) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant
                            Tab(
                                selected = isSelected,
                                onClick = { coroutineScope.launch { pagerState.animateScrollToPage(index) } },
                                modifier = Modifier.testTag("featured_tab_${tab.key}"),
                                text = {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        Icon(
                                            imageVector = if (tab.key == "all") Icons.Default.Star
                                            else categoryIconFor(tab.iconName, tab.title),
                                            contentDescription = null,
                                            tint = tint,
                                            modifier = Modifier.size(16.dp)
                                        )
                                        Text(
                                            text = tab.title,
                                            fontFamily = Kalpurush,
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                            color = tint,
                                            fontSize = 14.sp,
                                            maxLines = 1
                                        )
                                        if (tab.key != "all") {
                                            Text(
                                                text = IssueTags.toBengaliDigits(tab.articles.size),
                                                fontFamily = Kalpurush,
                                                fontSize = 11.sp,
                                                color = tint.copy(alpha = 0.8f)
                                            )
                                        }
                                    }
                                }
                            )
                        }
                    }
                }
            }
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = syncState.isSyncing,
            onRefresh = { viewModel.refreshFromWebsite() },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (tabs.isEmpty() || featuredArticles.isEmpty()) {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    item { EmptyState(message = "কোনো ফিচার্ড প্রবন্ধ পাওয়া যায়নি।") }
                }
            } else {
                HorizontalPager(
                    state = pagerState,
                    modifier = Modifier
                        .fillMaxSize()
                        .testTag("featured_pager"),
                    beyondViewportPageCount = 1,
                    key = { tabs[it].key }
                ) { page ->
                    val tab = tabs[page]
                    LazyColumn(
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier
                            .fillMaxSize()
                            .testTag("featured_list_${tab.key}")
                    ) {
                        items(tab.articles, key = { it.id }) { article ->
                            ArticleListItemCard(article, onClick = { onArticleClick(article.id) })
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PortalPageScaffold(
    title: String,
    onBackClick: () -> Unit,
    testTag: String,
    content: @Composable (PaddingValues) -> Unit
) {
    Scaffold(
        modifier = Modifier.testTag(testTag),
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Text(
                        text = title,
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "পেছনে",
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                },
                actions = {
                    NingshingCheBrandLogo(
                        size = 28.dp,
                        modifier = Modifier.padding(end = 12.dp)
                    )
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        content = content
    )
}

/** "লেখক" — every author from the live `authors` table with article counts. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthorsDirectoryScreen(
    viewModel: ExploreViewModel,
    onBackClick: () -> Unit,
    onAuthorClick: (String) -> Unit
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    PortalPageScaffold(title = "লেখক", onBackClick = onBackClick, testTag = "authors_directory_screen") { padding ->
        PullToRefreshBox(
            isRefreshing = (state as? ExploreUiState.Ready)?.isRefreshing == true,
            onRefresh = { viewModel.load(force = true) },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (val current = state) {
                ExploreUiState.Loading -> LoadingFeed()
                is ExploreUiState.Error -> ErrorState(message = current.message, onRetry = { viewModel.load(force = true) })
                is ExploreUiState.Ready -> LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize()
                ) {
                    item { PageIntro("লেখক", "নিংশিং চে তথ্যকোষের লেখক ও গবেষকবৃন্দ") }
                    if (current.data.authors.isEmpty()) {
                        item { EmptyState(message = "কোনো লেখক পাওয়া যায়নি।") }
                    }
                    items(current.data.authors, key = { it.author.id }) { facet ->
                        AuthorDirectoryRow(facet = facet, onClick = { onAuthorClick(facet.author.id) })
                    }
                }
            }
        }
    }
}

@Composable
private fun AuthorDirectoryRow(facet: AuthorFacet, onClick: () -> Unit) {
    val author = facet.author
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .testTag("author_${author.id}")
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            PortalAsyncImage(
                url = author.imageUrl,
                contentDescription = author.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .size(52.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer)
            )
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = author.name,
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    if (author.isVerified) {
                        Spacer(Modifier.width(4.dp))
                        VerifiedBadge(size = 15.dp)
                    }
                }
                if (author.designation.isNotBlank()) {
                    Text(
                        text = author.designation,
                        fontFamily = Kalpurush,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.primary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Text(
                    text = "${IssueTags.toBengaliDigits(facet.articleCount)}টি প্রবন্ধ" +
                        if (author.location.isNotBlank()) " • ${author.location}" else "",
                    fontFamily = Kalpurush,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

/** "আমার সম্পর্কে" — static portal information with a link to the website page. */
@Composable
fun AboutScreen(onBackClick: () -> Unit) {
    val uri = LocalUriHandler.current
    PortalPageScaffold(title = "আমার সম্পর্কে", onBackClick = onBackClick, testTag = "about_screen") { padding ->
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            item { PageIntro("আমার সম্পর্কে", "নিংশিং চে — বিষ্ণুপ্রিয়া মণিপুরি তথ্যকোষ") }
            item {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
                ) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            "নিংশিং চে বিষ্ণুপ্রিয়া মণিপুরি ভাষা, সাহিত্য, ইতিহাস ও সংস্কৃতির ডিজিটাল তথ্যকোষ। পোর্টালটি তিলকপুর, কমলগঞ্জ, মৌলভীবাজার, সিলেট থেকে পরিচালিত।",
                            fontFamily = Kalpurush,
                            fontSize = 16.sp,
                            lineHeight = 26.sp,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text("ঠিকানা: তিলকপুর, কমলগঞ্জ, মৌলভীবাজার, সিলেট", fontFamily = Kalpurush, fontSize = 15.sp)
                        Text("ফোন: +880 9638-781890", fontFamily = Kalpurush, fontSize = 15.sp)
                        TextButton(onClick = { uri.openUri("https://ningshingche.com/about-us") }) {
                            Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null)
                            Text("  ningshingche.com/about-us", fontFamily = Kalpurush)
                        }
                    }
                }
            }
        }
    }
}

/**
 * "সামাজিক কার্যকলাপ" — the portal's photo gallery entries filed under
 * "সমাজ ও সংস্কৃতি" (live `galleries` table), followed by articles from the
 * matching category.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SocialActivitiesScreen(
    viewModel: ExploreViewModel,
    onBackClick: () -> Unit,
    onArticleClick: (String) -> Unit
) {
    val state by viewModel.socialState.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.loadSocial() }

    PortalPageScaffold(title = "সামাজিক কার্যকলাপ", onBackClick = onBackClick, testTag = "social_activities_screen") { padding ->
        PullToRefreshBox(
            isRefreshing = (state as? SocialUiState.Ready)?.isRefreshing == true,
            onRefresh = { viewModel.loadSocial(force = true) },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (val current = state) {
                SocialUiState.Loading -> LoadingFeed()
                is SocialUiState.Error -> ErrorState(message = current.message, onRetry = { viewModel.loadSocial(force = true) })
                is SocialUiState.Ready -> LazyColumn(
                    contentPadding = PaddingValues(bottom = 24.dp),
                    modifier = Modifier.fillMaxSize()
                ) {
                    item {
                        Box(Modifier.padding(16.dp)) {
                            PageIntro("সামাজিক কার্যকলাপ", "সমাজ, সংগঠন ও সাংস্কৃতিক উদ্যোগ")
                        }
                    }
                    if (current.galleries.isNotEmpty()) {
                        item {
                            GalleryGrid(items = current.galleries, onItemClick = { })
                        }
                    }
                    if (current.articles.isEmpty() && current.galleries.isEmpty()) {
                        item { EmptyState(message = "এখনো কোনো সামাজিক কার্যকলাপের লেখা প্রকাশিত হয়নি।") }
                    }
                    if (current.articles.isNotEmpty()) {
                        item {
                            SectionHeader(title = "লেখাসমূহ", subtitle = "সমাজ ও সংস্কৃতি বিভাগ থেকে")
                        }
                        items(current.articles, key = { it.id }) { article ->
                            ArticleRow(article = article, onClick = { onArticleClick(article.id) })
                            Hairline(modifier = Modifier.padding(horizontal = 20.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PageIntro(title: String, subtitle: String) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Star, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text(title, fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            }
            Text(subtitle, fontFamily = Kalpurush, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        }
    }
}
