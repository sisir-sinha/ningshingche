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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CollectionsBookmark
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ningshingche.app.data.portal.ArticleSummary
import com.ningshingche.app.data.portal.IssueSummary
import com.ningshingche.app.data.portal.IssueTags
import com.ningshingche.app.ui.components.ExploreSkeletonLayout
import com.ningshingche.app.ui.components.PortalAsyncImage
import com.ningshingche.app.ui.components.VerifiedBadge
import com.ningshingche.app.ui.components.categoryIconFor
import com.ningshingche.app.ui.editorial.AnimatedHamburgerIcon
import com.ningshingche.app.ui.editorial.ArticleRow
import com.ningshingche.app.ui.editorial.EmptyState
import com.ningshingche.app.ui.editorial.ErrorState
import com.ningshingche.app.ui.editorial.Hairline
import com.ningshingche.app.ui.navigation.ExploreTab
import com.ningshingche.app.ui.reader.AuthorFacet
import com.ningshingche.app.ui.reader.CategoryFacet
import com.ningshingche.app.ui.reader.ExploreData
import com.ningshingche.app.ui.reader.ExploreUiState
import com.ningshingche.app.ui.reader.ExploreViewModel
import com.ningshingche.app.ui.theme.Kalpurush
import kotlinx.coroutines.launch

/**
 * "অন্বেষণ ও সংগ্রহ" — categories, authors, annual issues and popular picks.
 *
 * Layout: a pinned top bar (hamburger + title + search) and a pinned tab strip,
 * then a [HorizontalPager] so the user can swipe between tabs. Every page is a
 * [PullToRefreshBox]; pulling down reloads all four tabs from the live API.
 *
 * @param initialTab tab to open first (from the `explore?tab=` route argument).
 * @param tabRequest latest tab explicitly requested from the drawer, paired
 *   with a nonce so repeating the same request still switches the pager.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExploreScreen(
    viewModel: ExploreViewModel,
    initialTab: ExploreTab,
    tabRequest: Pair<Int, ExploreTab>? = null,
    onMenuClick: () -> Unit,
    onSearchClick: () -> Unit,
    onArticleClick: (String) -> Unit,
    onCategoryClick: (String) -> Unit,
    onAuthorClick: (String) -> Unit,
    onIssueClick: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val offlineNotice by viewModel.offlineNotice.collectAsStateWithLifecycle()
    val tabs = remember { ExploreTab.entries }
    val pagerState = rememberPagerState(initialPage = initialTab.ordinal) { tabs.size }
    val coroutineScope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val pullToRefreshState = rememberPullToRefreshState()
    val isRefreshing = (state as? ExploreUiState.Ready)?.isRefreshing == true

    LaunchedEffect(initialTab) {
        if (pagerState.currentPage != initialTab.ordinal) {
            pagerState.animateScrollToPage(initialTab.ordinal)
        }
    }
    LaunchedEffect(tabRequest) {
        val requested = tabRequest?.second ?: return@LaunchedEffect
        if (pagerState.currentPage != requested.ordinal) {
            pagerState.animateScrollToPage(requested.ordinal)
        }
    }
    LaunchedEffect(offlineNotice) {
        offlineNotice?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearOfflineNotice()
        }
    }

    Scaffold(
        modifier = modifier.testTag("explore_screen"),
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Column(modifier = Modifier.fillMaxWidth()) {
                TopAppBar(
                    title = {
                        Column {
                            Text(
                                text = "অন্বেষণ ও সংগ্রহ",
                                fontFamily = Kalpurush,
                                fontWeight = FontWeight.Bold,
                                fontSize = 19.sp,
                                lineHeight = 22.sp,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = "বিভাগ, লেখক, বার্ষিক সংখ্যা ও নির্বাচিত লেখা",
                                fontFamily = Kalpurush,
                                fontSize = 12.sp,
                                lineHeight = 14.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    },
                    navigationIcon = {
                        IconButton(
                            onClick = onMenuClick,
                            modifier = Modifier.testTag("hamburger_menu_button")
                        ) {
                            AnimatedHamburgerIcon(tint = MaterialTheme.colorScheme.onSurface)
                        }
                    },
                    actions = {
                        IconButton(
                            onClick = onSearchClick,
                            modifier = Modifier.testTag("explore_search_button")
                        ) {
                            Icon(Icons.Default.Search, contentDescription = "অনুসন্ধান")
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.surface,
                        scrolledContainerColor = MaterialTheme.colorScheme.surface
                    )
                )
                ExploreTabStrip(
                    tabs = tabs,
                    selectedIndex = pagerState.currentPage,
                    onSelect = { index -> coroutineScope.launch { pagerState.animateScrollToPage(index) } }
                )
            }
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
                ExploreUiState.Loading -> Box(modifier = Modifier.fillMaxSize()) {
                    ExploreSkeletonLayout()
                }

                is ExploreUiState.Error -> ErrorState(
                    message = current.message,
                    onRetry = { viewModel.load(force = true) },
                    modifier = Modifier.fillMaxSize()
                )

                is ExploreUiState.Ready -> HorizontalPager(
                    state = pagerState,
                    modifier = Modifier
                        .fillMaxSize()
                        .testTag("explore_pager"),
                    beyondViewportPageCount = 1,
                    key = { tabs[it].key }
                ) { page ->
                    ExplorePage(
                        tab = tabs[page],
                        data = current.data,
                        onArticleClick = onArticleClick,
                        onCategoryClick = onCategoryClick,
                        onAuthorClick = onAuthorClick,
                        onIssueClick = onIssueClick
                    )
                }
            }
        }
    }
}

@Composable
private fun ExploreTabStrip(
    tabs: List<ExploreTab>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit
) {
    val icons = remember {
        mapOf(
            ExploreTab.Categories to Icons.Default.CollectionsBookmark,
            ExploreTab.Authors to Icons.Default.People,
            ExploreTab.Issues to Icons.Default.CalendarMonth,
            ExploreTab.Popular to Icons.Default.Star
        )
    }
    ScrollableTabRow(
        selectedTabIndex = selectedIndex,
        containerColor = MaterialTheme.colorScheme.surface,
        edgePadding = 12.dp,
        indicator = { tabPositions ->
            if (selectedIndex in tabPositions.indices) {
                TabRowDefaults.SecondaryIndicator(
                    modifier = Modifier.tabIndicatorOffset(tabPositions[selectedIndex]),
                    color = MaterialTheme.colorScheme.primary,
                    height = 3.dp
                )
            }
        },
        divider = { Hairline() }
    ) {
        tabs.forEachIndexed { index, tab ->
            val isSelected = selectedIndex == index
            val tint = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
            Tab(
                selected = isSelected,
                onClick = { onSelect(index) },
                modifier = Modifier.testTag("explore_tab_$index"),
                text = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = icons.getValue(tab),
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
                    }
                }
            )
        }
    }
}

@Composable
private fun ExplorePage(
    tab: ExploreTab,
    data: ExploreData,
    onArticleClick: (String) -> Unit,
    onCategoryClick: (String) -> Unit,
    onAuthorClick: (String) -> Unit,
    onIssueClick: (Int) -> Unit
) {
    when (tab) {
        ExploreTab.Categories -> {
            if (data.categories.isEmpty()) {
                ScrollableEmpty("কোনো বিভাগ পাওয়া যায়নি।")
                return
            }
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .fillMaxSize()
                    .testTag("explore_categories_list")
            ) {
                items(data.categories, key = { it.category.id }) { facet ->
                    CategoryFacetCard(facet = facet, onClick = { onCategoryClick(facet.category.slug) })
                }
            }
        }

        ExploreTab.Authors -> {
            if (data.authors.isEmpty()) {
                ScrollableEmpty("কোনো লেখক পাওয়া যায়নি।")
                return
            }
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .fillMaxSize()
                    .testTag("explore_authors_list")
            ) {
                items(data.authors, key = { it.author.id }) { facet ->
                    AuthorFacetCard(facet = facet, onClick = { onAuthorClick(facet.author.id) })
                }
            }
        }

        ExploreTab.Issues -> {
            if (data.issues.isEmpty()) {
                ScrollableEmpty("এখনো কোনো বার্ষিক সংখ্যা প্রকাশিত হয়নি।")
                return
            }
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .fillMaxSize()
                    .testTag("explore_archives_list")
            ) {
                items(data.issues, key = { it.year }) { issue ->
                    IssueCard(issue = issue, onClick = { onIssueClick(issue.year) })
                }
            }
        }

        ExploreTab.Popular -> {
            if (data.popular.isEmpty()) {
                ScrollableEmpty("এখনো কোনো নির্বাচিত লেখা নেই।")
                return
            }
            LazyColumn(
                contentPadding = PaddingValues(bottom = 32.dp),
                modifier = Modifier
                    .fillMaxSize()
                    .testTag("explore_popular_list")
            ) {
                items(data.popular, key = { it.id }) { article ->
                    PopularArticleRow(article = article, onClick = { onArticleClick(article.id) })
                }
            }
        }
    }
}

/** Empty state inside a scrollable container so pull-to-refresh still works. */
@Composable
private fun ScrollableEmpty(message: String) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item { EmptyState(message = message) }
    }
}

@Composable
private fun PopularArticleRow(article: ArticleSummary, onClick: () -> Unit) {
    Column {
        ArticleRow(article = article, onClick = onClick)
        if (article.isSpecial || article.isFeature) {
            Row(
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.Star,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(12.dp)
                )
                Text(
                    text = if (article.isSpecial) "নির্বাচিত লেখা" else "ফিচার্ড",
                    fontFamily = Kalpurush,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
        Hairline(modifier = Modifier.padding(horizontal = 20.dp))
    }
}

@Composable
private fun CountChip(text: String) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        shape = RoundedCornerShape(12.dp)
    ) {
        Text(
            text = text,
            fontFamily = Kalpurush,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
        )
    }
}

@Composable
private fun CategoryFacetCard(facet: CategoryFacet, onClick: () -> Unit) {
    val category = facet.category
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .testTag("category_card_${category.slug}")
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.size(42.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = categoryIconFor(category.iconName, category.title),
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = category.title,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = category.subTitle.ifBlank { "${category.title} বিষয়ে প্রকাশিত প্রবন্ধসমূহ" },
                    fontFamily = Kalpurush,
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
            CountChip("${IssueTags.toBengaliDigits(facet.articleCount)}টি")
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}

@Composable
private fun AuthorFacetCard(facet: AuthorFacet, onClick: () -> Unit) {
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
            Box {
                PortalAsyncImage(
                    url = author.imageUrl,
                    contentDescription = author.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(54.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer)
                )
                if (author.isVerified) {
                    VerifiedBadge(modifier = Modifier.align(Alignment.BottomEnd), size = 18.dp)
                }
            }
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
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.padding(top = 2.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Description,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(12.dp)
                    )
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
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}

@Composable
private fun IssueCard(issue: IssueSummary, onClick: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .testTag("archive_${issue.year}")
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.size(56.dp)
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier.fillMaxSize()
                ) {
                    Icon(
                        imageVector = Icons.Default.CalendarMonth,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = issue.bengaliYear,
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Black,
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = issue.label,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = "বার্ষিক সংখ্যা • ${issue.bengaliYear} সালে প্রকাশিত লেখাসমূহ",
                    fontFamily = Kalpurush,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(4.dp))
                CountChip("${IssueTags.toBengaliDigits(issue.articleCount)}টি প্রবন্ধ")
            }
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}
